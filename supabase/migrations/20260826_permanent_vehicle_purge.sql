create or replace function prevent_vehicle_archive_refund_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
    and new.type in ('vehicle_cost_refunded', 'external_vehicle_expense_refunded')
  then
    if coalesce(current_setting('dealer_flow.archive_vehicle_rpc', true), '') <> 'on'
      or new.source_vehicle_id is null
      or new.correction_of_transaction_id is null
    then
      raise exception 'Vehicle archive refund rows are system-generated.';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and (
      old.type in ('vehicle_cost_refunded', 'external_vehicle_expense_refunded')
      or new.type in ('vehicle_cost_refunded', 'external_vehicle_expense_refunded')
    )
  then
    raise exception 'Vehicle archive refund rows cannot be edited or deleted.';
  end if;

  if tg_op = 'DELETE'
    and old.type in ('vehicle_cost_refunded', 'external_vehicle_expense_refunded')
    and coalesce(current_setting('dealer_flow.purge_vehicle_rpc', true), '') <> 'on'
  then
    raise exception 'Vehicle archive refund rows cannot be edited or deleted.';
  end if;

  if tg_op = 'DELETE'
    and old.type in ('vehicle_cost_paid', 'external_vehicle_expense_paid')
    and (old.voided_at is not null or old.reversed_transaction_id is not null)
    and coalesce(current_setting('dealer_flow.purge_vehicle_rpc', true), '') <> 'on'
  then
    raise exception 'Reversed vehicle cost payments cannot be edited or deleted.';
  end if;

  if tg_op = 'UPDATE'
    and old.type in ('vehicle_cost_paid', 'external_vehicle_expense_paid')
    and (old.voided_at is not null or old.reversed_transaction_id is not null)
  then
    raise exception 'Reversed vehicle cost payments cannot be edited or deleted.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_company_vehicle_archive_refund_mutation on company_cash_transactions;
create trigger prevent_company_vehicle_archive_refund_mutation
before insert or update or delete on company_cash_transactions
for each row execute function prevent_vehicle_archive_refund_mutation();

drop trigger if exists prevent_external_vehicle_archive_refund_mutation on external_cash_transactions;
create trigger prevent_external_vehicle_archive_refund_mutation
before insert or update or delete on external_cash_transactions
for each row execute function prevent_vehicle_archive_refund_mutation();

create or replace function purge_vehicle_completely(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_confirmation_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  v_sale_ids uuid[] := '{}'::uuid[];
  v_expense_ids uuid[] := '{}'::uuid[];
  v_contact_ids uuid[] := '{}'::uuid[];
  v_company_cash_ids uuid[] := '{}'::uuid[];
  v_external_cash_ids uuid[] := '{}'::uuid[];
  v_attachment_ids uuid[] := '{}'::uuid[];
  v_valuation_ids uuid[] := '{}'::uuid[];
  v_storage_paths text[] := '{}'::text[];
  v_expected_confirmation text;
  v_normalized_confirmation text;
  v_current_company_balance numeric := 0;
  v_current_external_balance numeric := 0;
  v_projected_company_balance numeric := 0;
  v_projected_external_balance numeric := 0;
  v_deleted_activity_logs integer := 0;
  v_deleted_tax_reports integer := 0;
  v_deleted_valuation_comparables integer := 0;
  v_deleted_valuations integer := 0;
  v_deleted_prediction_logs integer := 0;
  v_deleted_feedback integer := 0;
  v_deleted_corrections integer := 0;
  v_deleted_contacts integer := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  perform 1
  from organizations
  where id = p_organization_id
  for update;

  if not found then
    raise exception 'organization not found';
  end if;

  select *
  into vehicle_record
  from vehicles
  where id = p_vehicle_id
    and organization_id = p_organization_id
  for update;

  if vehicle_record.id is null then
    raise exception 'vehicle not found';
  end if;

  v_expected_confirmation := 'DELETE ' || coalesce(nullif(upper(trim(vehicle_record.vin)), ''), upper(p_vehicle_id::text));
  v_normalized_confirmation := upper(trim(coalesce(p_confirmation_text, '')));
  if v_normalized_confirmation <> v_expected_confirmation then
    raise exception 'confirmation text is incorrect';
  end if;

  with recursive sale_closure(id) as (
    select s.id
    from sales s
    where s.organization_id = p_organization_id
      and s.vehicle_id = p_vehicle_id

    union

    select candidate.id
    from sales candidate
    join sales current_sale on current_sale.id = sale_closure.id
    where candidate.organization_id = p_organization_id
      and (
        candidate.corrected_by_sale_id = current_sale.id
        or candidate.correction_of_sale_id = current_sale.id
        or current_sale.corrected_by_sale_id = candidate.id
        or current_sale.correction_of_sale_id = candidate.id
      )
  )
  select coalesce(array_agg(id), '{}'::uuid[])
  into v_sale_ids
  from sale_closure;

  if exists (
    select 1
    from sales
    where id = any(v_sale_ids)
      and vehicle_id <> p_vehicle_id
  ) then
    raise exception 'Sale correction chain references another vehicle. The vehicle cannot be purged safely.';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_expense_ids
  from vehicle_expenses
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  select coalesce(array_agg(distinct contact_id) filter (where contact_id is not null), '{}'::uuid[])
  into v_contact_ids
  from sales
  where organization_id = p_organization_id
    and id = any(v_sale_ids);

  if exists (
    select 1
    from sales
    where organization_id = p_organization_id
      and contact_id = any(v_contact_ids)
      and vehicle_id <> p_vehicle_id
  ) then
    raise exception 'Buyer contact is shared with another vehicle sale. The vehicle cannot be purged without affecting unrelated records.';
  end if;

  with recursive company_cash_closure(id) as (
    select c.id
    from company_cash_transactions c
    where c.organization_id = p_organization_id
      and (
        c.source_vehicle_id = p_vehicle_id
        or c.source_expense_id = any(v_expense_ids)
        or c.source_sale_id = any(v_sale_ids)
      )

    union

    select candidate.id
    from company_cash_transactions candidate
    join company_cash_transactions current_row on current_row.id = company_cash_closure.id
    where candidate.organization_id = p_organization_id
      and (
        candidate.reversed_transaction_id = current_row.id
        or candidate.correction_of_transaction_id = current_row.id
        or current_row.reversed_transaction_id = candidate.id
        or current_row.correction_of_transaction_id = candidate.id
      )
  )
  select coalesce(array_agg(id), '{}'::uuid[])
  into v_company_cash_ids
  from company_cash_closure;

  with recursive external_cash_closure(id) as (
    select c.id
    from external_cash_transactions c
    where c.organization_id = p_organization_id
      and (
        c.source_vehicle_id = p_vehicle_id
        or c.source_expense_id = any(v_expense_ids)
        or c.source_sale_id = any(v_sale_ids)
      )

    union

    select candidate.id
    from external_cash_transactions candidate
    join external_cash_transactions current_row on current_row.id = external_cash_closure.id
    where candidate.organization_id = p_organization_id
      and (
        candidate.reversed_transaction_id = current_row.id
        or candidate.correction_of_transaction_id = current_row.id
        or current_row.reversed_transaction_id = candidate.id
        or current_row.correction_of_transaction_id = candidate.id
      )
  )
  select coalesce(array_agg(id), '{}'::uuid[])
  into v_external_cash_ids
  from external_cash_closure;

  perform 1
  from company_cash_transactions
  where organization_id = p_organization_id
    and id = any(v_company_cash_ids)
  for update;

  perform 1
  from external_cash_transactions
  where organization_id = p_organization_id
    and id = any(v_external_cash_ids)
  for update;

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_attachment_ids
  from attachments
  where organization_id = p_organization_id
    and (
      vehicle_id = p_vehicle_id
      or expense_id = any(v_expense_ids)
      or sale_id = any(v_sale_ids)
      or contact_id = any(v_contact_ids)
      or company_cash_transaction_id = any(v_company_cash_ids)
      or external_cash_transaction_id = any(v_external_cash_ids)
    );

  select coalesce(array_agg(distinct url_or_path order by url_or_path) filter (
    where url_or_path like ('organizations/' || p_organization_id::text || '/%')
  ), '{}'::text[])
  into v_storage_paths
  from attachments
  where id = any(v_attachment_ids);

  if vehicle_record.main_photo_path like ('organizations/' || p_organization_id::text || '/%') then
    v_storage_paths := array_append(v_storage_paths, vehicle_record.main_photo_path);
  end if;

  select coalesce(array_agg(distinct path order by path), '{}'::text[])
  into v_storage_paths
  from unnest(v_storage_paths) as paths(path)
  where path like ('organizations/' || p_organization_id::text || '/%');

  v_current_company_balance := coalesce(organization_company_cash_balance(p_organization_id), 0);
  v_current_external_balance := coalesce(organization_external_cash_balance(p_organization_id), 0);

  v_projected_company_balance := v_current_company_balance - coalesce((
    select sum(
      case
        when c.deleted_at is null then company_cash_transaction_effect(c.type, c.amount)
        else 0
      end
    )
    from company_cash_transactions c
    where c.id = any(v_company_cash_ids)
  ), 0);

  v_projected_external_balance := v_current_external_balance - coalesce((
    select sum(
      case
        when c.deleted_at is null then external_cash_transaction_effect(c.type, c.amount)
        else 0
      end
    )
    from external_cash_transactions c
    where c.id = any(v_external_cash_ids)
  ), 0);

  if v_projected_company_balance < 0 then
    raise exception 'Vehicle cannot be permanently deleted because removing its financial history would make Company Cash negative. Resolve downstream cash usage first.';
  end if;

  if v_projected_external_balance < 0 then
    raise exception 'Vehicle cannot be permanently deleted because removing its financial history would make External Cash negative. Resolve downstream cash usage first.';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_valuation_ids
  from vehicle_valuations
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  perform set_config('dealer_flow.purge_vehicle_rpc', 'on', true);

  delete from attachments
  where id = any(v_attachment_ids);

  delete from company_cash_transactions
  where organization_id = p_organization_id
    and id = any(v_company_cash_ids);

  delete from external_cash_transactions
  where organization_id = p_organization_id
    and id = any(v_external_cash_ids);

  delete from sales
  where organization_id = p_organization_id
    and id = any(v_sale_ids);

  delete from vehicle_expenses
  where organization_id = p_organization_id
    and id = any(v_expense_ids);

  delete from contacts
  where organization_id = p_organization_id
    and id = any(v_contact_ids);
  get diagnostics v_deleted_contacts = row_count;

  delete from activity_logs
  where organization_id = p_organization_id
    and (
      (entity_type = 'vehicle' and entity_id = p_vehicle_id)
      or (entity_type = 'sale' and entity_id = any(v_sale_ids))
      or (entity_type = 'contact' and entity_id = any(v_contact_ids))
      or (entity_type in ('expense', 'vehicle_expense') and entity_id = any(v_expense_ids))
      or (entity_type = 'cash_transaction' and (
        entity_id = any(v_company_cash_ids) or entity_id = any(v_external_cash_ids)
      ))
    );
  get diagnostics v_deleted_activity_logs = row_count;

  delete from tax_reports
  where organization_id = p_organization_id;
  get diagnostics v_deleted_tax_reports = row_count;

  delete from vehicle_valuation_comparables
  where organization_id = p_organization_id
    and vehicle_valuation_id = any(v_valuation_ids);
  get diagnostics v_deleted_valuation_comparables = row_count;

  delete from valuation_feedback
  where organization_id = p_organization_id
    and (
      vehicle_id = p_vehicle_id
      or vehicle_valuation_id = any(v_valuation_ids)
    );
  get diagnostics v_deleted_feedback = row_count;

  delete from ml_prediction_logs
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;
  get diagnostics v_deleted_prediction_logs = row_count;

  delete from vehicle_valuations
  where organization_id = p_organization_id
    and id = any(v_valuation_ids);
  get diagnostics v_deleted_valuations = row_count;

  delete from vehicle_corrections
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;
  get diagnostics v_deleted_corrections = row_count;

  delete from vehicles
  where id = p_vehicle_id
    and organization_id = p_organization_id;

  return jsonb_build_object(
    'vehicleId', p_vehicle_id,
    'vehicleVin', nullif(vehicle_record.vin, ''),
    'deletedExpenses', coalesce(cardinality(v_expense_ids), 0),
    'deletedSales', coalesce(cardinality(v_sale_ids), 0),
    'deletedContacts', v_deleted_contacts,
    'deletedCompanyCashRows', coalesce(cardinality(v_company_cash_ids), 0),
    'deletedExternalCashRows', coalesce(cardinality(v_external_cash_ids), 0),
    'deletedAttachments', coalesce(cardinality(v_attachment_ids), 0),
    'deletedActivityLogs', v_deleted_activity_logs,
    'deletedValuationComparables', v_deleted_valuation_comparables,
    'deletedValuations', v_deleted_valuations,
    'deletedPredictionLogs', v_deleted_prediction_logs,
    'deletedValuationFeedback', v_deleted_feedback,
    'deletedVehicleCorrections', v_deleted_corrections,
    'invalidatedTaxReports', v_deleted_tax_reports,
    'storagePaths', to_jsonb(v_storage_paths)
  );
end;
$$;

revoke all on function purge_vehicle_completely(uuid, uuid, text) from public;
grant execute on function purge_vehicle_completely(uuid, uuid, text) to authenticated;
