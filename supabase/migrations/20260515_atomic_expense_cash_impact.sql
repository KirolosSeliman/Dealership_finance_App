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

  if coalesce(p_amount_before_tax, 0) < 0
    or coalesce(p_tax_rate, 0) < 0
    or coalesce(p_tax_rate, 0) > 1
    or coalesce(p_tax_amount, 0) < 0
    or coalesce(p_total_amount, 0) < 0 then
    raise exception 'expense amounts are invalid';
  end if;

  if clean_funding_source = 'company_cash'
    and coalesce(p_total_amount, 0) > organization_company_cash_balance(p_organization_id) then
    raise exception 'Company cash does not have enough available balance for this expense.';
  end if;

  if clean_funding_source = 'external_cash'
    and coalesce(p_total_amount, 0) > organization_external_cash_balance(p_organization_id) then
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
    coalesce(p_amount_before_tax, 0),
    coalesce(p_tax_rate, 0),
    coalesce(p_tax_amount, 0),
    coalesce(p_total_amount, 0),
    clean_funding_source,
    coalesce(p_date, current_date),
    clean_note,
    auth.uid()
  )
  returning id into expense_id;

  if coalesce(p_total_amount, 0) > 0 and clean_funding_source = 'company_cash' then
    insert into company_cash_transactions (
      organization_id,
      type,
      amount,
      date,
      note,
      source_vehicle_id,
      source_expense_id,
      created_by
    )
    values (
      p_organization_id,
      'vehicle_cost_paid',
      coalesce(p_total_amount, 0),
      coalesce(p_date, current_date),
      'Vehicle expense: ' || coalesce(clean_note, p_category::text),
      p_vehicle_id,
      expense_id,
      auth.uid()
    );
  elsif coalesce(p_total_amount, 0) > 0 and clean_funding_source = 'external_cash' then
    insert into external_cash_transactions (
      organization_id,
      type,
      amount,
      date,
      note,
      source_vehicle_id,
      source_expense_id,
      created_by
    )
    values (
      p_organization_id,
      'external_vehicle_expense_paid',
      coalesce(p_total_amount, 0),
      coalesce(p_date, current_date),
      'Vehicle expense: ' || coalesce(clean_note, p_category::text),
      p_vehicle_id,
      expense_id,
      auth.uid()
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

  if expense_record.funding_source not in ('company_cash', 'external_cash') then
    raise exception 'funding source is invalid';
  end if;

  if coalesce(p_amount_before_tax, 0) < 0
    or coalesce(p_tax_rate, 0) < 0
    or coalesce(p_tax_rate, 0) > 1
    or coalesce(p_tax_amount, 0) < 0
    or coalesce(p_total_amount, 0) < 0 then
    raise exception 'expense amounts are invalid';
  end if;

  perform 1
  from company_cash_transactions
  where organization_id = p_organization_id
    and source_expense_id = p_expense_id
    and deleted_at is null
  for update;

  perform 1
  from external_cash_transactions
  where organization_id = p_organization_id
    and source_expense_id = p_expense_id
    and deleted_at is null
  for update;

  select coalesce(sum(amount), 0)
  into current_company_impact
  from company_cash_transactions
  where organization_id = p_organization_id
    and source_expense_id = p_expense_id
    and deleted_at is null;

  select coalesce(sum(amount), 0)
  into current_external_impact
  from external_cash_transactions
  where organization_id = p_organization_id
    and source_expense_id = p_expense_id
    and deleted_at is null;

  if expense_record.funding_source = 'company_cash'
    and coalesce(p_total_amount, 0) > organization_company_cash_balance(p_organization_id) + current_company_impact then
    raise exception 'Company cash does not have enough available balance for this expense.';
  end if;

  if expense_record.funding_source = 'external_cash'
    and coalesce(p_total_amount, 0) > organization_external_cash_balance(p_organization_id) + current_external_impact then
    raise exception 'External cash does not have enough available balance for this expense.';
  end if;

  clean_note := nullif(trim(coalesce(p_note, '')), '');

  update vehicle_expenses
  set category = p_category,
      amount_before_tax = coalesce(p_amount_before_tax, 0),
      tax_rate = coalesce(p_tax_rate, 0),
      tax_amount = coalesce(p_tax_amount, 0),
      total_amount = coalesce(p_total_amount, 0),
      date = coalesce(p_date, current_date),
      note = clean_note,
      updated_at = now()
  where id = p_expense_id
    and vehicle_id = p_vehicle_id
    and organization_id = p_organization_id;

  if expense_record.funding_source = 'company_cash' then
    update company_cash_transactions
    set amount = coalesce(p_total_amount, 0),
        date = coalesce(p_date, current_date),
        note = 'Vehicle expense: ' || coalesce(clean_note, p_expense_id::text),
        updated_at = now()
    where organization_id = p_organization_id
      and source_expense_id = p_expense_id
      and deleted_at is null;

    if not found and coalesce(p_total_amount, 0) > 0 then
      insert into company_cash_transactions (
        organization_id, type, amount, date, note, source_vehicle_id, source_expense_id, created_by
      )
      values (
        p_organization_id, 'vehicle_cost_paid', coalesce(p_total_amount, 0), coalesce(p_date, current_date),
        'Vehicle expense: ' || coalesce(clean_note, p_expense_id::text), p_vehicle_id, p_expense_id, auth.uid()
      );
    end if;
  else
    update external_cash_transactions
    set amount = coalesce(p_total_amount, 0),
        date = coalesce(p_date, current_date),
        note = 'Vehicle expense: ' || coalesce(clean_note, p_expense_id::text),
        updated_at = now()
    where organization_id = p_organization_id
      and source_expense_id = p_expense_id
      and deleted_at is null;

    if not found and coalesce(p_total_amount, 0) > 0 then
      insert into external_cash_transactions (
        organization_id, type, amount, date, note, source_vehicle_id, source_expense_id, created_by
      )
      values (
        p_organization_id, 'external_vehicle_expense_paid', coalesce(p_total_amount, 0), coalesce(p_date, current_date),
        'Vehicle expense: ' || coalesce(clean_note, p_expense_id::text), p_vehicle_id, p_expense_id, auth.uid()
      );
    end if;
  end if;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'expense_updated', 'vehicle', p_vehicle_id, p_category::text, auth.uid());
end;
$$;

revoke all on function create_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, text, date, text) from public;
grant execute on function create_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, text, date, text) to authenticated;

revoke all on function update_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, date, text) from public;
grant execute on function update_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, date, text) to authenticated;
