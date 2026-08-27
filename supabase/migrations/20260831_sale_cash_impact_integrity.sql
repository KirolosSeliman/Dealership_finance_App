-- Dealer Flow V2: make sale void/correction fail closed when cash links are ambiguous.
-- The functions keep their existing signatures so deployed clients remain compatible.

create or replace function void_vehicle_sale_atomic(
  p_organization_id uuid,
  p_sale_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_record sales%rowtype;
  vehicle_record vehicles%rowtype;
  company_original_id uuid;
  external_original_id uuid;
  company_reversal_id uuid;
  external_reversal_id uuid;
  company_cash_impact_count integer := 0;
  external_cash_impact_count integer := 0;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if clean_reason is null then
    raise exception 'Sale void reason is required.';
  end if;

  perform 1
  from organizations
  where id = p_organization_id
  for update;

  if not found then
    raise exception 'organization not found';
  end if;

  select *
  into sale_record
  from sales
  where id = p_sale_id
    and organization_id = p_organization_id
  for update;

  if sale_record.id is null then
    raise exception 'sale not found';
  end if;

  if sale_record.voided_at is not null or sale_record.status <> 'active' then
    raise exception 'sale is already voided or corrected';
  end if;

  select *
  into vehicle_record
  from vehicles
  where id = sale_record.vehicle_id
    and organization_id = p_organization_id
  for update;

  if vehicle_record.id is null then
    raise exception 'vehicle not found';
  end if;

  if sale_record.paper_sale_price > 0 then
    perform 1
    from company_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
      and correction_of_transaction_id is null
      and type = 'paper_sale_received'
      and amount = sale_record.paper_sale_price
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      )
    for update;

    select count(*)::integer
    into company_cash_impact_count
    from company_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
      and correction_of_transaction_id is null
      and type = 'paper_sale_received'
      and amount = sale_record.paper_sale_price
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      );

    if company_cash_impact_count = 0 then
      raise exception 'Sale cash impact is missing; sale void was blocked.';
    end if;
    if company_cash_impact_count > 1 then
      raise exception 'Multiple active sale cash impacts exist; sale void was blocked.';
    end if;

    select id
    into company_original_id
    from company_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
      and correction_of_transaction_id is null
      and type = 'paper_sale_received'
      and amount = sale_record.paper_sale_price
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      )
    order by created_at asc
    limit 1
    for update;

    if organization_company_cash_balance(p_organization_id) - sale_record.paper_sale_price < 0 then
      raise exception 'Voiding this sale would make company cash negative.';
    end if;

    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, correction_of_transaction_id, created_by
    )
    values (
      p_organization_id,
      'company_cash_withdrawn',
      sale_record.paper_sale_price,
      current_date,
      'Sale void reversal: ' || clean_reason,
      sale_record.vehicle_id,
      sale_record.id,
      company_original_id,
      auth.uid()
    )
    returning id into company_reversal_id;

    update company_cash_transactions
    set reversed_transaction_id = company_reversal_id,
        voided_at = now(),
        voided_by = auth.uid(),
        void_reason = clean_reason,
        updated_at = now()
    where id = company_original_id;
  end if;

  if sale_record.external_commission > 0 then
    perform 1
    from external_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
      and correction_of_transaction_id is null
      and type = 'external_commission_earned'
      and amount = sale_record.external_commission
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      )
    for update;

    select count(*)::integer
    into external_cash_impact_count
    from external_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
      and correction_of_transaction_id is null
      and type = 'external_commission_earned'
      and amount = sale_record.external_commission
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      );

    if external_cash_impact_count = 0 then
      raise exception 'Sale cash impact is missing; sale void was blocked.';
    end if;
    if external_cash_impact_count > 1 then
      raise exception 'Multiple active sale cash impacts exist; sale void was blocked.';
    end if;

    select id
    into external_original_id
    from external_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
      and correction_of_transaction_id is null
      and type = 'external_commission_earned'
      and amount = sale_record.external_commission
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      )
    order by created_at asc
    limit 1
    for update;

    if organization_external_cash_balance(p_organization_id) - sale_record.external_commission < 0 then
      raise exception 'Voiding this sale would make external cash negative.';
    end if;

    insert into external_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, correction_of_transaction_id, created_by
    )
    values (
      p_organization_id,
      'external_cash_personally_removed',
      sale_record.external_commission,
      current_date,
      'Sale void reversal: ' || clean_reason,
      sale_record.vehicle_id,
      sale_record.id,
      external_original_id,
      auth.uid()
    )
    returning id into external_reversal_id;

    update external_cash_transactions
    set reversed_transaction_id = external_reversal_id,
        voided_at = now(),
        voided_by = auth.uid(),
        void_reason = clean_reason,
        updated_at = now()
    where id = external_original_id;
  end if;

  update sales
  set status = 'voided',
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = clean_reason,
      updated_at = now()
  where id = sale_record.id;

  update vehicles
  set status = 'listed_for_sale',
      updated_at = now()
  where id = sale_record.vehicle_id
    and organization_id = p_organization_id
    and status = 'sold';

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'sale_voided',
    'sale',
    sale_record.id,
    'Sale voided. Reason: ' || clean_reason,
    auth.uid()
  );

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'cash_transaction_reversed',
    'sale',
    sale_record.id,
    'Sale cash impacts reversed.',
    auth.uid()
  );

  return sale_record.id;
end;
$$;

create or replace function correct_vehicle_sale_atomic(
  p_organization_id uuid,
  p_sale_id uuid,
  p_sale_date date,
  p_taxable_profit_amount numeric,
  p_real_client_payment numeric,
  p_buyer_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_notes text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  old_sale sales%rowtype;
  new_sale_id uuid;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if clean_reason is null then
    raise exception 'Sale correction reason is required.';
  end if;

  perform 1
  from organizations
  where id = p_organization_id
  for update;

  if not found then
    raise exception 'organization not found';
  end if;

  select *
  into old_sale
  from sales
  where id = p_sale_id
    and organization_id = p_organization_id
  for update;

  if old_sale.id is null then
    raise exception 'sale not found';
  end if;

  perform void_vehicle_sale_atomic(p_organization_id, p_sale_id, 'Corrected sale: ' || clean_reason);

  new_sale_id := record_vehicle_sale_atomic(
    p_organization_id,
    old_sale.vehicle_id,
    p_sale_date,
    p_taxable_profit_amount,
    p_real_client_payment,
    p_buyer_name,
    p_phone,
    p_email,
    p_address,
    p_notes
  );

  if nullif(trim(coalesce(p_buyer_name, '')), '') is null and old_sale.contact_id is not null then
    update sales
    set contact_id = old_sale.contact_id
    where id = new_sale_id;
  end if;

  update sales
  set status = 'corrected',
      corrected_by_sale_id = new_sale_id,
      updated_at = now()
  where id = old_sale.id;

  update sales
  set correction_of_sale_id = old_sale.id,
      updated_at = now()
  where id = new_sale_id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'sale_corrected',
    'sale',
    new_sale_id,
    'Sale correction created from ' || old_sale.id || '. Reason: ' || clean_reason,
    auth.uid()
  );

  return new_sale_id;
end;
$$;

revoke execute on function void_vehicle_sale_atomic(uuid, uuid, text) from public;
revoke execute on function correct_vehicle_sale_atomic(uuid, uuid, date, numeric, numeric, text, text, text, text, text, text) from public;
grant execute on function void_vehicle_sale_atomic(uuid, uuid, text) to authenticated;
grant execute on function correct_vehicle_sale_atomic(uuid, uuid, date, numeric, numeric, text, text, text, text, text, text) to authenticated;
