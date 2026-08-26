alter table company_cash_transactions
  drop constraint if exists company_cash_type_valid,
  add constraint company_cash_type_valid
    check (
      type in (
        'company_cash_added',
        'company_cash_withdrawn',
        'vehicle_cost_paid',
        'vehicle_cost_refunded',
        'paper_sale_received',
        'external_transfer_received'
      )
    );

alter table external_cash_transactions
  drop constraint if exists external_cash_type_valid,
  add constraint external_cash_type_valid
    check (
      type in (
        'external_cash_added',
        'external_commission_earned',
        'external_cash_transferred_to_company',
        'external_transfer_returned',
        'external_cash_personally_removed',
        'external_vehicle_expense_paid',
        'external_vehicle_expense_refunded'
      )
    );

create unique index if not exists company_vehicle_cost_refund_original_unique_idx
  on company_cash_transactions (correction_of_transaction_id)
  where type = 'vehicle_cost_refunded'
    and correction_of_transaction_id is not null;

create unique index if not exists external_vehicle_expense_refund_original_unique_idx
  on external_cash_transactions (correction_of_transaction_id)
  where type = 'external_vehicle_expense_refunded'
    and correction_of_transaction_id is not null;

create or replace function company_cash_transaction_effect(p_type text, p_amount numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_type in ('company_cash_withdrawn', 'vehicle_cost_paid') then -coalesce(p_amount, 0)
    when p_type = 'vehicle_cost_refunded' then coalesce(p_amount, 0)
    else coalesce(p_amount, 0)
  end;
$$;

create or replace function external_cash_transaction_effect(p_type text, p_amount numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_type in ('external_cash_transferred_to_company', 'external_cash_personally_removed', 'external_vehicle_expense_paid') then -coalesce(p_amount, 0)
    when p_type = 'external_vehicle_expense_refunded' then coalesce(p_amount, 0)
    else coalesce(p_amount, 0)
  end;
$$;

create or replace function organization_company_cash_balance(org_id uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(company_cash_transaction_effect(type, amount)), 0)
  from company_cash_transactions
  where organization_id = org_id
    and deleted_at is null;
$$;

create or replace function organization_external_cash_balance(org_id uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(external_cash_transaction_effect(type, amount)), 0)
  from external_cash_transactions
  where organization_id = org_id
    and deleted_at is null;
$$;

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
  then
    raise exception 'Vehicle archive refund rows cannot be edited or deleted.';
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

create or replace function archive_vehicle(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  company_original company_cash_transactions%rowtype;
  external_original external_cash_transactions%rowtype;
  refund_id uuid;
  clean_reason text;
  company_refund_count integer := 0;
  external_refund_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
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

  if vehicle_record.archived_at is not null then
    raise exception 'vehicle already archived';
  end if;

  if exists (
    select 1
    from sales
    where organization_id = p_organization_id
      and vehicle_id = p_vehicle_id
      and voided_at is null
      and status = 'active'
  ) then
    raise exception 'Sold vehicles with an active sale cannot be archived. Void the sale first.';
  end if;

  clean_reason := nullif(left(trim(coalesce(p_reason, '')), 500), '');
  perform set_config('dealer_flow.archive_vehicle_rpc', 'on', true);

  for company_original in
    select *
    from company_cash_transactions
    where organization_id = p_organization_id
      and source_vehicle_id = p_vehicle_id
      and type = 'vehicle_cost_paid'
      and deleted_at is null
      and correction_of_transaction_id is null
      and reversed_transaction_id is null
      and voided_at is null
    order by id
    for update
  loop
    insert into company_cash_transactions (
      organization_id,
      type,
      amount,
      date,
      note,
      source_vehicle_id,
      source_expense_id,
      correction_of_transaction_id,
      created_by
    )
    values (
      p_organization_id,
      'vehicle_cost_refunded',
      company_original.amount,
      current_date,
      'Vehicle archive refund'
        || coalesce(': ' || nullif(trim(company_original.note), ''), '')
        || coalesce('. Reason: ' || clean_reason, ''),
      p_vehicle_id,
      company_original.source_expense_id,
      company_original.id,
      auth.uid()
    )
    returning id into refund_id;

    update company_cash_transactions
    set reversed_transaction_id = refund_id,
        voided_at = now(),
        voided_by = auth.uid(),
        void_reason = 'Vehicle archived'
          || coalesce(': ' || clean_reason, ''),
        updated_at = now()
    where id = company_original.id;

    company_refund_count := company_refund_count + 1;
  end loop;

  for external_original in
    select *
    from external_cash_transactions
    where organization_id = p_organization_id
      and source_vehicle_id = p_vehicle_id
      and type = 'external_vehicle_expense_paid'
      and deleted_at is null
      and correction_of_transaction_id is null
      and reversed_transaction_id is null
      and voided_at is null
    order by id
    for update
  loop
    insert into external_cash_transactions (
      organization_id,
      type,
      amount,
      date,
      note,
      source_vehicle_id,
      source_expense_id,
      correction_of_transaction_id,
      created_by
    )
    values (
      p_organization_id,
      'external_vehicle_expense_refunded',
      external_original.amount,
      current_date,
      'Vehicle archive refund'
        || coalesce(': ' || nullif(trim(external_original.note), ''), '')
        || coalesce('. Reason: ' || clean_reason, ''),
      p_vehicle_id,
      external_original.source_expense_id,
      external_original.id,
      auth.uid()
    )
    returning id into refund_id;

    update external_cash_transactions
    set reversed_transaction_id = refund_id,
        voided_at = now(),
        voided_by = auth.uid(),
        void_reason = 'Vehicle archived'
          || coalesce(': ' || clean_reason, ''),
        updated_at = now()
    where id = external_original.id;

    external_refund_count := external_refund_count + 1;
  end loop;

  update vehicles
  set archived_at = now(),
      archived_by = auth.uid(),
      archive_reason = clean_reason,
      updated_at = now()
  where id = p_vehicle_id
    and organization_id = p_organization_id;

  insert into activity_logs (
    organization_id,
    action,
    entity_type,
    entity_id,
    message,
    created_by
  )
  values (
    p_organization_id,
    'vehicle_archived',
    'vehicle',
    p_vehicle_id,
    'Vehicle archived. Active vehicle cost payments refunded: company '
      || company_refund_count
      || ', external '
      || external_refund_count
      || '. Financial, tax, sale, cash, attachment, and activity records were preserved.'
      || case when clean_reason is null then '' else ' Reason: ' || clean_reason end,
    auth.uid()
  );
end;
$$;

revoke all on function archive_vehicle(uuid, uuid, text) from public;
grant execute on function archive_vehicle(uuid, uuid, text) to authenticated;
