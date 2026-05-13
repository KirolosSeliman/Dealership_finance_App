alter table company_cash_transactions
  add column if not exists reversed_transaction_id uuid,
  add column if not exists correction_of_transaction_id uuid,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references profiles(id),
  add column if not exists void_reason text;

alter table external_cash_transactions
  add column if not exists reversed_transaction_id uuid,
  add column if not exists correction_of_transaction_id uuid,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references profiles(id),
  add column if not exists void_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_cash_reversed_transaction_fk'
  ) then
    alter table company_cash_transactions
      add constraint company_cash_reversed_transaction_fk
      foreign key (reversed_transaction_id) references company_cash_transactions(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'company_cash_correction_of_transaction_fk'
  ) then
    alter table company_cash_transactions
      add constraint company_cash_correction_of_transaction_fk
      foreign key (correction_of_transaction_id) references company_cash_transactions(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'external_cash_reversed_transaction_fk'
  ) then
    alter table external_cash_transactions
      add constraint external_cash_reversed_transaction_fk
      foreign key (reversed_transaction_id) references external_cash_transactions(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'external_cash_correction_of_transaction_fk'
  ) then
    alter table external_cash_transactions
      add constraint external_cash_correction_of_transaction_fk
      foreign key (correction_of_transaction_id) references external_cash_transactions(id);
  end if;
end $$;

create index if not exists company_cash_reversed_transaction_idx on company_cash_transactions (reversed_transaction_id);
create index if not exists company_cash_correction_of_transaction_idx on company_cash_transactions (correction_of_transaction_id);
create index if not exists external_cash_reversed_transaction_idx on external_cash_transactions (reversed_transaction_id);
create index if not exists external_cash_correction_of_transaction_idx on external_cash_transactions (correction_of_transaction_id);

create or replace function company_cash_transaction_effect(p_type text, p_amount numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_type in ('company_cash_withdrawn', 'vehicle_cost_paid') then -coalesce(p_amount, 0)
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
    else coalesce(p_amount, 0)
  end;
$$;

create or replace function reverse_company_cash_transaction(
  p_organization_id uuid,
  p_transaction_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  original company_cash_transactions%rowtype;
  reversal_id uuid;
  reversal_type text;
  reversal_effect numeric;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  perform 1 from organizations where id = p_organization_id for update;

  select *
  into original
  from company_cash_transactions
  where id = p_transaction_id
    and organization_id = p_organization_id
  for update;

  if original.id is null or original.deleted_at is not null then
    raise exception 'cash transaction not found';
  end if;

  if original.voided_at is not null or original.reversed_transaction_id is not null then
    raise exception 'cash transaction is already reversed';
  end if;

  if original.correction_of_transaction_id is not null then
    raise exception 'reversal transactions cannot be reversed directly';
  end if;

  if original.source_vehicle_id is not null or original.source_expense_id is not null then
    raise exception 'system-generated cash transactions must be corrected through the vehicle or sale workflow';
  end if;

  reversal_type := case
    when company_cash_transaction_effect(original.type, original.amount) >= 0 then 'company_cash_withdrawn'
    else 'company_cash_added'
  end;
  reversal_effect := company_cash_transaction_effect(reversal_type, original.amount);

  if organization_company_cash_balance(p_organization_id) + reversal_effect < 0 then
    raise exception 'Reversing this transaction would make company cash negative.';
  end if;

  insert into company_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    correction_of_transaction_id,
    created_by
  )
  values (
    p_organization_id,
    reversal_type,
    original.amount,
    current_date,
    'Reversal of ' || original.type || coalesce(': ' || clean_reason, ''),
    original.id,
    auth.uid()
  )
  returning id into reversal_id;

  update company_cash_transactions
  set reversed_transaction_id = reversal_id,
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = coalesce(clean_reason, 'Reversed from cash management.'),
      updated_at = now()
  where id = original.id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'cash_transaction_reversed',
    'cash_transaction',
    original.id,
    'Reversed company cash transaction ' || original.id || ' with reversal ' || reversal_id || '. Reason: ' || coalesce(clean_reason, 'No reason provided'),
    auth.uid()
  );

  return reversal_id;
end;
$$;

create or replace function reverse_external_cash_transaction(
  p_organization_id uuid,
  p_transaction_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  original external_cash_transactions%rowtype;
  reversal_id uuid;
  reversal_type text;
  reversal_effect numeric;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  perform 1 from organizations where id = p_organization_id for update;

  select *
  into original
  from external_cash_transactions
  where id = p_transaction_id
    and organization_id = p_organization_id
  for update;

  if original.id is null or original.deleted_at is not null then
    raise exception 'cash transaction not found';
  end if;

  if original.voided_at is not null or original.reversed_transaction_id is not null then
    raise exception 'cash transaction is already reversed';
  end if;

  if original.correction_of_transaction_id is not null then
    raise exception 'reversal transactions cannot be reversed directly';
  end if;

  if original.source_vehicle_id is not null or original.source_expense_id is not null then
    raise exception 'system-generated cash transactions must be corrected through the vehicle or sale workflow';
  end if;

  reversal_type := case
    when external_cash_transaction_effect(original.type, original.amount) >= 0 then 'external_cash_personally_removed'
    else 'external_commission_earned'
  end;
  reversal_effect := external_cash_transaction_effect(reversal_type, original.amount);

  if organization_external_cash_balance(p_organization_id) + reversal_effect < 0 then
    raise exception 'Reversing this transaction would make external cash negative.';
  end if;

  insert into external_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    correction_of_transaction_id,
    created_by
  )
  values (
    p_organization_id,
    reversal_type,
    original.amount,
    current_date,
    'Reversal of ' || original.type || coalesce(': ' || clean_reason, ''),
    original.id,
    auth.uid()
  )
  returning id into reversal_id;

  update external_cash_transactions
  set reversed_transaction_id = reversal_id,
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = coalesce(clean_reason, 'Reversed from cash management.'),
      updated_at = now()
  where id = original.id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'cash_transaction_reversed',
    'cash_transaction',
    original.id,
    'Reversed external cash transaction ' || original.id || ' with reversal ' || reversal_id || '. Reason: ' || coalesce(clean_reason, 'No reason provided'),
    auth.uid()
  );

  return reversal_id;
end;
$$;

revoke execute on function reverse_company_cash_transaction(uuid, uuid, text) from public;
revoke execute on function reverse_external_cash_transaction(uuid, uuid, text) from public;
grant execute on function reverse_company_cash_transaction(uuid, uuid, text) to authenticated;
grant execute on function reverse_external_cash_transaction(uuid, uuid, text) to authenticated;
