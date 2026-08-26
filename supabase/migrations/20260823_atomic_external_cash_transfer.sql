alter table company_cash_transactions
  add column if not exists transfer_pair_id uuid;

alter table external_cash_transactions
  add column if not exists transfer_pair_id uuid;

create unique index if not exists company_cash_transfer_pair_unique_idx
  on company_cash_transactions (transfer_pair_id)
  where transfer_pair_id is not null;

create unique index if not exists external_cash_transfer_pair_unique_idx
  on external_cash_transactions (transfer_pair_id)
  where transfer_pair_id is not null;

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
        'external_vehicle_expense_paid'
      )
    );

create or replace function require_cash_transfer_pair_on_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    tg_table_name = 'external_cash_transactions'
    and new.type in ('external_cash_transferred_to_company', 'external_transfer_returned')
    and new.transfer_pair_id is null
  ) or (
    tg_table_name = 'external_cash_transactions'
    and new.type in ('external_cash_transferred_to_company', 'external_transfer_returned')
    and coalesce(current_setting('dealer_flow.atomic_transfer_rpc', true), '') <> 'on'
  ) or (
    tg_table_name = 'company_cash_transactions'
    and new.type = 'external_transfer_received'
    and new.transfer_pair_id is null
  ) or (
    tg_table_name = 'company_cash_transactions'
    and new.type = 'external_transfer_received'
    and coalesce(current_setting('dealer_flow.atomic_transfer_rpc', true), '') <> 'on'
  ) then
    raise exception 'System-generated cash transfer rows must have a transfer pair.';
  end if;

  return new;
end;
$$;

drop trigger if exists require_external_cash_transfer_pair on external_cash_transactions;
create trigger require_external_cash_transfer_pair
before insert on external_cash_transactions
for each row execute function require_cash_transfer_pair_on_insert();

drop trigger if exists require_company_cash_transfer_pair on company_cash_transactions;
create trigger require_company_cash_transfer_pair
before insert on company_cash_transactions
for each row execute function require_cash_transfer_pair_on_insert();

create or replace function prevent_paired_cash_transaction_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.transfer_pair_id is not null then
    if new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or new.type is distinct from old.type
      or new.amount is distinct from old.amount
      or new.date is distinct from old.date
      or new.note is distinct from old.note
      or new.source_vehicle_id is distinct from old.source_vehicle_id
      or new.source_expense_id is distinct from old.source_expense_id
      or new.created_at is distinct from old.created_at
      or new.created_by is distinct from old.created_by
      or new.transfer_pair_id is distinct from old.transfer_pair_id
      or new.correction_of_transaction_id is distinct from old.correction_of_transaction_id
      or new.deleted_at is distinct from old.deleted_at
      or new.deleted_by is distinct from old.deleted_by
      or new.deletion_note is distinct from old.deletion_note
    then
      raise exception 'Paired external transfers cannot be edited directly. Reverse the transfer and create a new one.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_paired_company_cash_transaction_update on company_cash_transactions;
create trigger prevent_paired_company_cash_transaction_update
before update on company_cash_transactions
for each row execute function prevent_paired_cash_transaction_update();

drop trigger if exists prevent_paired_external_cash_transaction_update on external_cash_transactions;
create trigger prevent_paired_external_cash_transaction_update
before update on external_cash_transactions
for each row execute function prevent_paired_cash_transaction_update();

create or replace function transfer_external_cash_to_company(
  p_organization_id uuid,
  p_amount numeric,
  p_date date,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  transfer_pair uuid;
  effective_date date := coalesce(p_date, current_date);
  clean_note text := nullif(trim(coalesce(p_note, '')), '');
  external_note text := 'External → Company transfer';
  company_note text := 'Received from External Cash';
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 999999999 then
    raise exception 'transfer amount must be positive and no greater than 999999999';
  end if;

  perform 1
  from organizations
  where id = p_organization_id
  for update;

  if not found then
    raise exception 'organization not found';
  end if;

  if organization_external_cash_balance(p_organization_id) < p_amount then
    raise exception 'External cash action exceeds available balance.';
  end if;

  if clean_note is not null then
    external_note := external_note || ': ' || clean_note;
    company_note := company_note || ': ' || clean_note;
  end if;

  perform set_config('dealer_flow.atomic_transfer_rpc', 'on', true);
  transfer_pair := gen_random_uuid();

  insert into external_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    transfer_pair_id,
    created_by
  )
  values (
    p_organization_id,
    'external_cash_transferred_to_company',
    p_amount,
    effective_date,
    external_note,
    transfer_pair,
    auth.uid()
  );

  insert into company_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    transfer_pair_id,
    created_by
  )
  values (
    p_organization_id,
    'external_transfer_received',
    p_amount,
    effective_date,
    company_note,
    transfer_pair,
    auth.uid()
  );

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'external_cash_transferred_to_company',
    'cash_transfer',
    transfer_pair,
    'Transferred $' || to_char(p_amount, 'FM999999999990.00') || ' from External Cash to Company Cash.'
      || case when clean_note is null then '' else ' Note: ' || clean_note end,
    auth.uid()
  );

  return transfer_pair;
end;
$$;

create or replace function reverse_external_cash_transfer_pair(
  p_organization_id uuid,
  p_transfer_pair_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  external_original external_cash_transactions%rowtype;
  company_original company_cash_transactions%rowtype;
  reversal_pair uuid;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if p_transfer_pair_id is null then
    raise exception 'Cash transfer pair is incomplete or invalid.';
  end if;

  perform 1
  from organizations
  where id = p_organization_id
  for update;

  if not found then
    raise exception 'organization not found';
  end if;

  select *
  into external_original
  from external_cash_transactions
  where organization_id = p_organization_id
    and transfer_pair_id = p_transfer_pair_id
    and type = 'external_cash_transferred_to_company'
    and correction_of_transaction_id is null
  for update;

  select *
  into company_original
  from company_cash_transactions
  where organization_id = p_organization_id
    and transfer_pair_id = p_transfer_pair_id
    and type = 'external_transfer_received'
    and correction_of_transaction_id is null
  for update;

  if external_original.id is null
    or company_original.id is null
    or external_original.organization_id is distinct from company_original.organization_id
    or external_original.amount is distinct from company_original.amount
    or external_original.transfer_pair_id is distinct from company_original.transfer_pair_id
    or external_original.deleted_at is not null
    or company_original.deleted_at is not null
    or external_original.reversed_transaction_id is not null
    or company_original.reversed_transaction_id is not null
    or external_original.voided_at is not null
    or company_original.voided_at is not null
  then
    raise exception 'Cash transfer pair is incomplete or invalid.';
  end if;

  if organization_company_cash_balance(p_organization_id) < external_original.amount then
    raise exception 'Reversing this transfer would make company cash negative.';
  end if;

  perform set_config('dealer_flow.atomic_transfer_rpc', 'on', true);
  reversal_pair := gen_random_uuid();

  insert into external_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    transfer_pair_id,
    correction_of_transaction_id,
    created_by
  )
  values (
    p_organization_id,
    'external_transfer_returned',
    external_original.amount,
    current_date,
    'Reversal: external-to-company transfer returned'
      || coalesce(': ' || clean_reason, ''),
    reversal_pair,
    external_original.id,
    auth.uid()
  );

  insert into company_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    transfer_pair_id,
    correction_of_transaction_id,
    created_by
  )
  values (
    p_organization_id,
    'company_cash_withdrawn',
    company_original.amount,
    current_date,
    'Reversal: external transfer receipt returned'
      || coalesce(': ' || clean_reason, ''),
    reversal_pair,
    company_original.id,
    auth.uid()
  );

  update external_cash_transactions
  set reversed_transaction_id = (
        select id
        from external_cash_transactions
        where transfer_pair_id = reversal_pair
          and correction_of_transaction_id = external_original.id
      ),
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = coalesce(clean_reason, 'Reversed from cash management.'),
      updated_at = now()
  where id = external_original.id;

  update company_cash_transactions
  set reversed_transaction_id = (
        select id
        from company_cash_transactions
        where transfer_pair_id = reversal_pair
          and correction_of_transaction_id = company_original.id
      ),
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = coalesce(clean_reason, 'Reversed from cash management.'),
      updated_at = now()
  where id = company_original.id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'external_cash_transfer_reversed',
    'cash_transfer',
    p_transfer_pair_id,
    'Reversed $' || to_char(external_original.amount, 'FM999999999990.00')
      || ' external-to-company transfer. Reason: '
      || coalesce(clean_reason, 'No reason provided')
      || '. Reversal pair: ' || reversal_pair,
    auth.uid()
  );

  return reversal_pair;
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

  if original.transfer_pair_id is not null
    and original.type = 'external_transfer_received'
    and original.correction_of_transaction_id is null
  then
    raise exception 'Paired cash transfers must be reversed as a complete transfer.';
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

  if original.transfer_pair_id is not null
    and original.type = 'external_cash_transferred_to_company'
    and original.correction_of_transaction_id is null
  then
    raise exception 'Paired cash transfers must be reversed as a complete transfer.';
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

revoke execute on function transfer_external_cash_to_company(uuid, numeric, date, text) from public;
grant execute on function transfer_external_cash_to_company(uuid, numeric, date, text) to authenticated;

revoke execute on function reverse_external_cash_transfer_pair(uuid, uuid, text) from public;
grant execute on function reverse_external_cash_transfer_pair(uuid, uuid, text) to authenticated;
