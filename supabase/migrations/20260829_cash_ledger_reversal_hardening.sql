-- Dealer Flow V2: cash ledger mutation hardening.
-- Manual edits use atomic RPCs. Cash history is corrected by reversal, never deletion.

drop policy if exists "update company cash" on company_cash_transactions;
drop policy if exists "update company expense cash impact" on company_cash_transactions;
drop policy if exists "update external cash" on external_cash_transactions;
drop policy if exists "update external expense cash impact" on external_cash_transactions;

create or replace function prevent_unlinked_system_cash_reversal()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  linked_reversal boolean := false;
begin
  if tg_op = 'UPDATE'
    and old.source_sale_id is not null
    and old.reversed_transaction_id is null
    and new.reversed_transaction_id is not null
  then
    if tg_table_name = 'company_cash_transactions' then
      select exists (
        select 1
        from company_cash_transactions reversal
        where reversal.correction_of_transaction_id = old.id
          and reversal.source_sale_id is not null
      )
      into linked_reversal;
    else
      select exists (
        select 1
        from external_cash_transactions reversal
        where reversal.correction_of_transaction_id = old.id
          and reversal.source_sale_id is not null
      )
      into linked_reversal;
    end if;

    if not linked_reversal then
      raise exception 'Sale-linked cash transactions must be reversed through the sale workflow.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_unlinked_company_sale_cash_reversal on company_cash_transactions;
create trigger prevent_unlinked_company_sale_cash_reversal
before update on company_cash_transactions
for each row execute function prevent_unlinked_system_cash_reversal();

drop trigger if exists prevent_unlinked_external_sale_cash_reversal on external_cash_transactions;
create trigger prevent_unlinked_external_sale_cash_reversal
before update on external_cash_transactions
for each row execute function prevent_unlinked_system_cash_reversal();

create or replace function update_manual_company_cash_transaction(
  p_organization_id uuid,
  p_transaction_id uuid,
  p_amount numeric,
  p_date date,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  original company_cash_transactions%rowtype;
  clean_amount numeric := round(coalesce(p_amount, 0), 2);
  clean_note text := nullif(trim(coalesce(p_note, '')), '');
  projected_balance numeric;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if p_date is null or clean_amount <= 0 then
    raise exception 'Cash transaction amount and date are required.';
  end if;

  perform 1
  from organizations
  where id = p_organization_id
  for update;

  if not found then
    raise exception 'organization not found';
  end if;

  select *
  into original
  from company_cash_transactions
  where id = p_transaction_id
    and organization_id = p_organization_id
  for update;

  if original.id is null or original.deleted_at is not null then
    raise exception 'cash transaction not found';
  end if;

  if original.transfer_pair_id is not null then
    raise exception 'Paired external transfers cannot be edited directly. Reverse the transfer and create a new one.';
  end if;

  if original.source_vehicle_id is not null
    or original.source_expense_id is not null
    or original.source_sale_id is not null
  then
    raise exception 'System-generated cash transactions cannot be edited.';
  end if;

  if original.correction_of_transaction_id is not null
    or original.reversed_transaction_id is not null
    or original.voided_at is not null
  then
    raise exception 'Reversal entries cannot be edited.';
  end if;

  projected_balance := organization_company_cash_balance(p_organization_id)
    - company_cash_transaction_effect(original.type, original.amount)
    + company_cash_transaction_effect(original.type, clean_amount);
  if projected_balance < 0 then
    raise exception 'This edit would make company cash negative.';
  end if;

  update company_cash_transactions
  set amount = clean_amount,
      date = p_date,
      note = clean_note,
      updated_at = now()
  where id = original.id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'cash_transaction_updated',
    'cash_transaction',
    original.id,
    'Manual company cash transaction updated.',
    auth.uid()
  );
end;
$$;

create or replace function update_manual_external_cash_transaction(
  p_organization_id uuid,
  p_transaction_id uuid,
  p_amount numeric,
  p_date date,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  original external_cash_transactions%rowtype;
  clean_amount numeric := round(coalesce(p_amount, 0), 2);
  clean_note text := nullif(trim(coalesce(p_note, '')), '');
  projected_balance numeric;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if p_date is null or clean_amount <= 0 then
    raise exception 'Cash transaction amount and date are required.';
  end if;

  perform 1
  from organizations
  where id = p_organization_id
  for update;

  if not found then
    raise exception 'organization not found';
  end if;

  select *
  into original
  from external_cash_transactions
  where id = p_transaction_id
    and organization_id = p_organization_id
  for update;

  if original.id is null or original.deleted_at is not null then
    raise exception 'cash transaction not found';
  end if;

  if original.transfer_pair_id is not null then
    raise exception 'Paired external transfers cannot be edited directly. Reverse the transfer and create a new one.';
  end if;

  if original.source_vehicle_id is not null
    or original.source_expense_id is not null
    or original.source_sale_id is not null
  then
    raise exception 'System-generated cash transactions cannot be edited.';
  end if;

  if original.correction_of_transaction_id is not null
    or original.reversed_transaction_id is not null
    or original.voided_at is not null
  then
    raise exception 'Reversal entries cannot be edited.';
  end if;

  projected_balance := organization_external_cash_balance(p_organization_id)
    - external_cash_transaction_effect(original.type, original.amount)
    + external_cash_transaction_effect(original.type, clean_amount);
  if projected_balance < 0 then
    raise exception 'This edit would make external cash negative.';
  end if;

  update external_cash_transactions
  set amount = clean_amount,
      date = p_date,
      note = clean_note,
      updated_at = now()
  where id = original.id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'cash_transaction_updated',
    'cash_transaction',
    original.id,
    'Manual external cash transaction updated.',
    auth.uid()
  );
end;
$$;

revoke execute on function update_manual_company_cash_transaction(uuid, uuid, numeric, date, text) from public;
revoke execute on function update_manual_company_cash_transaction(uuid, uuid, numeric, date, text) from anon;
revoke execute on function update_manual_external_cash_transaction(uuid, uuid, numeric, date, text) from public;
revoke execute on function update_manual_external_cash_transaction(uuid, uuid, numeric, date, text) from anon;
grant execute on function update_manual_company_cash_transaction(uuid, uuid, numeric, date, text) to authenticated;
grant execute on function update_manual_external_cash_transaction(uuid, uuid, numeric, date, text) to authenticated;
