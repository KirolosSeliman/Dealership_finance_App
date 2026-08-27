-- Keep vehicle expense creation, correction, and voiding inside one database
-- transaction. This migration supersedes the earlier RPC implementation
-- without rewriting any historical rows.

alter table vehicle_expenses
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references profiles(id),
  add column if not exists void_reason text;

-- Archive refunds and expense-void refunds are both system-generated. The
-- setting is transaction-local and cannot be supplied by a normal client RPC.
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
      and coalesce(current_setting('dealer_flow.expense_void_rpc', true), '') <> 'on'
    then
      raise exception 'Vehicle cost refund rows are system-generated.';
    end if;
    if new.source_vehicle_id is null or new.correction_of_transaction_id is null then
      raise exception 'Vehicle cost refund rows require source and correction links.';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and (
      old.type in ('vehicle_cost_refunded', 'external_vehicle_expense_refunded')
      or new.type in ('vehicle_cost_refunded', 'external_vehicle_expense_refunded')
    )
  then
    raise exception 'Vehicle cost refund rows cannot be edited or deleted.';
  end if;

  if tg_op = 'DELETE'
    and old.type in ('vehicle_cost_refunded', 'external_vehicle_expense_refunded')
    and coalesce(current_setting('dealer_flow.purge_vehicle_rpc', true), '') <> 'on'
  then
    raise exception 'Vehicle cost refund rows cannot be edited or deleted.';
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

create or replace function create_vehicle_expense_with_cash_impact(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_recurring_template_id uuid,
  p_category expense_category,
  p_amount_before_tax numeric,
  p_tax_rate numeric,
  p_tax_amount numeric,
  p_total_amount numeric,
  p_funding_source text,
  p_date date,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  expense_id uuid;
  clean_funding_source text;
  clean_note text;
  clean_amount_before_tax numeric := coalesce(p_amount_before_tax, 0);
  clean_tax_rate numeric := coalesce(p_tax_rate, 0);
  clean_tax_amount numeric := coalesce(p_tax_amount, 0);
  clean_total_amount numeric := coalesce(p_total_amount, 0);
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
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

  clean_funding_source := coalesce(nullif(trim(p_funding_source), ''), 'company_cash');
  if clean_funding_source not in ('company_cash', 'external_cash') then
    raise exception 'funding source is invalid';
  end if;

  if p_category is null
    or clean_amount_before_tax < 0
    or clean_tax_rate < 0
    or clean_tax_rate > 1
    or clean_tax_amount < 0
    or clean_total_amount < 0
    or round((clean_amount_before_tax * clean_tax_rate)::numeric, 2) <> round(clean_tax_amount::numeric, 2)
    or round((clean_amount_before_tax + clean_tax_amount)::numeric, 2) <> round(clean_total_amount::numeric, 2)
  then
    raise exception 'expense amounts are invalid';
  end if;

  if clean_funding_source = 'company_cash'
    and clean_total_amount > organization_company_cash_balance(p_organization_id) then
    raise exception 'Company cash does not have enough available balance for this expense.';
  end if;

  if clean_funding_source = 'external_cash'
    and clean_total_amount > organization_external_cash_balance(p_organization_id) then
    raise exception 'External cash does not have enough available balance for this expense.';
  end if;

  clean_note := nullif(trim(coalesce(p_note, '')), '');

  insert into vehicle_expenses (
    organization_id,
    vehicle_id,
    recurring_template_id,
    category,
    amount_before_tax,
    tax_rate,
    tax_amount,
    total_amount,
    funding_source,
    date,
    note,
    created_by
  )
  values (
    p_organization_id,
    p_vehicle_id,
    p_recurring_template_id,
    p_category,
    clean_amount_before_tax,
    clean_tax_rate,
    clean_tax_amount,
    clean_total_amount,
    clean_funding_source,
    coalesce(p_date, current_date),
    clean_note,
    auth.uid()
  )
  returning id into expense_id;

  if clean_total_amount > 0 and clean_funding_source = 'company_cash' then
    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_expense_id, created_by
    )
    values (
      p_organization_id, 'vehicle_cost_paid', clean_total_amount, coalesce(p_date, current_date),
      'Vehicle expense: ' || coalesce(clean_note, p_category::text), p_vehicle_id, expense_id, auth.uid()
    );
  elsif clean_total_amount > 0 and clean_funding_source = 'external_cash' then
    insert into external_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_expense_id, created_by
    )
    values (
      p_organization_id, 'external_vehicle_expense_paid', clean_total_amount, coalesce(p_date, current_date),
      'Vehicle expense: ' || coalesce(clean_note, p_category::text), p_vehicle_id, expense_id, auth.uid()
    );
  end if;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'expense_added', 'vehicle', p_vehicle_id, p_category::text, auth.uid());

  return expense_id;
end;
$$;

create or replace function update_vehicle_expense_with_cash_impact(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_expense_id uuid,
  p_category expense_category,
  p_amount_before_tax numeric,
  p_tax_rate numeric,
  p_tax_amount numeric,
  p_total_amount numeric,
  p_date date,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  expense_record vehicle_expenses%rowtype;
  clean_note text;
  clean_amount_before_tax numeric := coalesce(p_amount_before_tax, 0);
  clean_tax_rate numeric := coalesce(p_tax_rate, 0);
  clean_tax_amount numeric := coalesce(p_tax_amount, 0);
  clean_total_amount numeric := coalesce(p_total_amount, 0);
  current_company_impact numeric(12,2) := 0;
  current_external_impact numeric(12,2) := 0;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
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

  select *
  into expense_record
  from vehicle_expenses
  where id = p_expense_id
    and vehicle_id = p_vehicle_id
    and organization_id = p_organization_id
  for update;

  if expense_record.id is null then
    raise exception 'expense not found';
  end if;

  if expense_record.voided_at is not null then
    raise exception 'voided expenses cannot be edited';
  end if;

  if expense_record.funding_source not in ('company_cash', 'external_cash') then
    raise exception 'funding source is invalid';
  end if;

  if p_category is null
    or clean_amount_before_tax < 0
    or clean_tax_rate < 0
    or clean_tax_rate > 1
    or clean_tax_amount < 0
    or clean_total_amount < 0
    or round((clean_amount_before_tax * clean_tax_rate)::numeric, 2) <> round(clean_tax_amount::numeric, 2)
    or round((clean_amount_before_tax + clean_tax_amount)::numeric, 2) <> round(clean_total_amount::numeric, 2)
  then
    raise exception 'expense amounts are invalid';
  end if;

  perform 1
  from company_cash_transactions
  where organization_id = p_organization_id
    and source_expense_id = p_expense_id
    and deleted_at is null
    and voided_at is null
    and reversed_transaction_id is null
  for update;

  perform 1
  from external_cash_transactions
  where organization_id = p_organization_id
    and source_expense_id = p_expense_id
    and deleted_at is null
    and voided_at is null
    and reversed_transaction_id is null
  for update;

  select coalesce(sum(amount), 0)
  into current_company_impact
  from company_cash_transactions
  where organization_id = p_organization_id
    and source_expense_id = p_expense_id
    and deleted_at is null
    and voided_at is null
    and reversed_transaction_id is null;

  select coalesce(sum(amount), 0)
  into current_external_impact
  from external_cash_transactions
  where organization_id = p_organization_id
    and source_expense_id = p_expense_id
    and deleted_at is null
    and voided_at is null
    and reversed_transaction_id is null;

  if expense_record.funding_source = 'company_cash'
    and clean_total_amount > organization_company_cash_balance(p_organization_id) + current_company_impact then
    raise exception 'Company cash does not have enough available balance for this expense.';
  end if;

  if expense_record.funding_source = 'external_cash'
    and clean_total_amount > organization_external_cash_balance(p_organization_id) + current_external_impact then
    raise exception 'External cash does not have enough available balance for this expense.';
  end if;

  clean_note := nullif(trim(coalesce(p_note, '')), '');

  update vehicle_expenses
  set category = p_category,
      amount_before_tax = clean_amount_before_tax,
      tax_rate = clean_tax_rate,
      tax_amount = clean_tax_amount,
      total_amount = clean_total_amount,
      date = coalesce(p_date, current_date),
      note = clean_note,
      updated_at = now()
  where id = p_expense_id
    and vehicle_id = p_vehicle_id
    and organization_id = p_organization_id;

  if expense_record.funding_source = 'company_cash' then
    if clean_total_amount = 0 then
      update company_cash_transactions
      set deleted_at = now(),
          deleted_by = auth.uid(),
          deletion_note = 'Vehicle expense amount corrected to zero.',
          updated_at = now()
      where organization_id = p_organization_id
        and source_expense_id = p_expense_id
        and deleted_at is null
        and voided_at is null
        and reversed_transaction_id is null;
    else
      update company_cash_transactions
      set amount = clean_total_amount,
          date = coalesce(p_date, current_date),
          note = 'Vehicle expense: ' || coalesce(clean_note, p_expense_id::text),
          updated_at = now()
      where organization_id = p_organization_id
        and source_expense_id = p_expense_id
        and deleted_at is null
        and voided_at is null
        and reversed_transaction_id is null;

      if not found then
        insert into company_cash_transactions (
          organization_id, type, amount, date, note, source_vehicle_id, source_expense_id, created_by
        )
        values (
          p_organization_id, 'vehicle_cost_paid', clean_total_amount, coalesce(p_date, current_date),
          'Vehicle expense: ' || coalesce(clean_note, p_expense_id::text), p_vehicle_id, p_expense_id, auth.uid()
        );
      end if;
    end if;
  else
    if clean_total_amount = 0 then
      update external_cash_transactions
      set deleted_at = now(),
          deleted_by = auth.uid(),
          deletion_note = 'Vehicle expense amount corrected to zero.',
          updated_at = now()
      where organization_id = p_organization_id
        and source_expense_id = p_expense_id
        and deleted_at is null
        and voided_at is null
        and reversed_transaction_id is null;
    else
      update external_cash_transactions
      set amount = clean_total_amount,
          date = coalesce(p_date, current_date),
          note = 'Vehicle expense: ' || coalesce(clean_note, p_expense_id::text),
          updated_at = now()
      where organization_id = p_organization_id
        and source_expense_id = p_expense_id
        and deleted_at is null
        and voided_at is null
        and reversed_transaction_id is null;

      if not found then
        insert into external_cash_transactions (
          organization_id, type, amount, date, note, source_vehicle_id, source_expense_id, created_by
        )
        values (
          p_organization_id, 'external_vehicle_expense_paid', clean_total_amount, coalesce(p_date, current_date),
          'Vehicle expense: ' || coalesce(clean_note, p_expense_id::text), p_vehicle_id, p_expense_id, auth.uid()
        );
      end if;
    end if;
  end if;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'expense_updated', 'vehicle', p_vehicle_id, p_category::text, auth.uid());
end;
$$;

create or replace function void_vehicle_expense_with_cash_reversal(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_expense_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  expense_record vehicle_expenses%rowtype;
  company_original company_cash_transactions%rowtype;
  external_original external_cash_transactions%rowtype;
  reversal_id uuid;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if clean_reason is null or length(clean_reason) < 3 then
    raise exception 'Expense void reason is required.';
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

  select *
  into expense_record
  from vehicle_expenses
  where id = p_expense_id
    and vehicle_id = p_vehicle_id
    and organization_id = p_organization_id
  for update;

  if expense_record.id is null then
    raise exception 'expense not found';
  end if;

  if expense_record.voided_at is not null then
    raise exception 'expense is already voided';
  end if;

  if expense_record.funding_source = 'company_cash' then
    select *
    into company_original
    from company_cash_transactions
    where organization_id = p_organization_id
      and source_expense_id = p_expense_id
      and type = 'vehicle_cost_paid'
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
    order by created_at asc
    limit 1
    for update;

    if expense_record.total_amount > 0 and company_original.id is null then
      raise exception 'expense cash impact is missing; void was blocked to protect the ledger.';
    end if;

    if company_original.id is not null then
      perform set_config('dealer_flow.expense_void_rpc', 'on', true);
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
        'Voided vehicle expense: ' || clean_reason,
        p_vehicle_id,
        p_expense_id,
        company_original.id,
        auth.uid()
      )
      returning id into reversal_id;

      update company_cash_transactions
      set reversed_transaction_id = reversal_id,
          voided_at = now(),
          voided_by = auth.uid(),
          void_reason = clean_reason,
          updated_at = now()
      where id = company_original.id;
    end if;
  elsif expense_record.funding_source = 'external_cash' then
    select *
    into external_original
    from external_cash_transactions
    where organization_id = p_organization_id
      and source_expense_id = p_expense_id
      and type = 'external_vehicle_expense_paid'
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
    order by created_at asc
    limit 1
    for update;

    if expense_record.total_amount > 0 and external_original.id is null then
      raise exception 'expense cash impact is missing; void was blocked to protect the ledger.';
    end if;

    if external_original.id is not null then
      perform set_config('dealer_flow.expense_void_rpc', 'on', true);
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
        'Voided vehicle expense: ' || clean_reason,
        p_vehicle_id,
        p_expense_id,
        external_original.id,
        auth.uid()
      )
      returning id into reversal_id;

      update external_cash_transactions
      set reversed_transaction_id = reversal_id,
          voided_at = now(),
          voided_by = auth.uid(),
          void_reason = clean_reason,
          updated_at = now()
      where id = external_original.id;
    end if;
  else
    raise exception 'funding source is invalid';
  end if;

  update vehicle_expenses
  set voided_at = now(),
      voided_by = auth.uid(),
      void_reason = clean_reason,
      updated_at = now()
  where id = p_expense_id
    and organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'expense_voided',
    'vehicle',
    p_vehicle_id,
    'Vehicle expense voided. Cash impact reversed. Reason: ' || clean_reason,
    auth.uid()
  );
end;
$$;

-- The historical hard-delete function remains in migration history for
-- existing databases, but is no longer callable by application users.
revoke all on function delete_vehicle_expense(uuid) from public;
revoke all on function delete_vehicle_expense(uuid) from authenticated;
drop policy if exists "delete expenses" on vehicle_expenses;

revoke all on function create_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, text, date, text) from public;
grant execute on function create_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, text, date, text) to authenticated;
revoke all on function update_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, date, text) from public;
grant execute on function update_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, date, text) to authenticated;
revoke all on function void_vehicle_expense_with_cash_reversal(uuid, uuid, uuid, text) from public;
grant execute on function void_vehicle_expense_with_cash_reversal(uuid, uuid, uuid, text) to authenticated;
