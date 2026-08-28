-- Dealer Flow V2: close data-drift cases in purchase corrections.
-- This forward replacement preserves the existing correction RPC signature.

create or replace function correct_vehicle_purchase(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_purchase_price numeric,
  p_purchase_date date,
  p_purchase_source purchase_source,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  purchase_expense vehicle_expenses%rowtype;
  old_cash_impact numeric := 0;
  cash_impact_count integer := 0;
  new_tax_rate numeric := 0;
  new_tax numeric := 0;
  new_total numeric := 0;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if clean_reason is null then
    raise exception 'Purchase correction reason is required.';
  end if;

  if coalesce(p_purchase_price, 0) < 0 or p_purchase_source is null then
    raise exception 'Purchase details are invalid.';
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

  if vehicle_record.id is null or vehicle_record.archived_at is not null then
    raise exception 'vehicle not found';
  end if;

  if exists (
    select 1
    from sales
    where organization_id = p_organization_id
      and vehicle_id = p_vehicle_id
  ) or vehicle_record.status = 'sold'::vehicle_status then
    raise exception 'Sold vehicle purchase details require the sale correction workflow.';
  end if;

  if exists (
    select 1
    from vehicle_expenses
    where organization_id = p_organization_id
      and vehicle_id = p_vehicle_id
      and category = 'vehicle_purchase_price'
      and voided_at is not null
  ) then
    raise exception 'Voided purchase expenses require a dedicated financial correction review.';
  end if;

  select *
  into purchase_expense
  from vehicle_expenses
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id
    and category = 'vehicle_purchase_price'
    and voided_at is null
  order by created_at asc
  limit 1
  for update;

  if purchase_expense.id is not null then
    perform 1
    from company_cash_transactions
    where organization_id = p_organization_id
      and source_expense_id = purchase_expense.id
      and type = 'vehicle_cost_paid'
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
    for update;

    select count(*), coalesce(sum(amount), 0)
    into cash_impact_count, old_cash_impact
    from company_cash_transactions
    where organization_id = p_organization_id
      and source_expense_id = purchase_expense.id
      and type = 'vehicle_cost_paid'
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null;

    if cash_impact_count > 1 then
      raise exception 'Multiple active cash impacts exist for this purchase expense; correction was blocked.';
    end if;
  end if;

  new_tax_rate := calculate_purchase_tax_rate(p_purchase_source);
  new_tax := round(coalesce(p_purchase_price, 0) * new_tax_rate, 2);
  new_total := round(coalesce(p_purchase_price, 0) + new_tax, 2);

  if purchase_expense.id is not null and cash_impact_count = 1 and new_total <= 0 then
    raise exception 'Existing paid purchases cannot be corrected to zero through this workflow.';
  end if;

  if new_total > organization_company_cash_balance(p_organization_id) + old_cash_impact then
    raise exception 'Company cash does not have enough available balance for this purchase correction.';
  end if;

  update vehicles
  set purchase_price = coalesce(p_purchase_price, 0),
      purchase_date = coalesce(p_purchase_date, current_date),
      purchase_source = p_purchase_source,
      updated_at = now()
  where id = vehicle_record.id;

  if purchase_expense.id is not null then
    update vehicle_expenses
    set amount_before_tax = coalesce(p_purchase_price, 0),
        tax_rate = new_tax_rate,
        tax_amount = new_tax,
        total_amount = new_total,
        date = coalesce(p_purchase_date, current_date),
        note = 'Corrected vehicle purchase. Reason: ' || clean_reason,
        updated_at = now()
    where id = purchase_expense.id;

    if cash_impact_count = 0 and new_total > 0 then
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
        new_total,
        coalesce(p_purchase_date, current_date),
        'Corrected vehicle purchase. Reason: ' || clean_reason,
        p_vehicle_id,
        purchase_expense.id,
        auth.uid()
      );
    elsif cash_impact_count = 1 then
      update company_cash_transactions
      set amount = new_total,
          date = coalesce(p_purchase_date, current_date),
          note = 'Corrected vehicle purchase. Reason: ' || clean_reason,
          updated_at = now()
      where organization_id = p_organization_id
        and source_expense_id = purchase_expense.id
        and type = 'vehicle_cost_paid'
        and deleted_at is null
        and voided_at is null
        and reversed_transaction_id is null;
    end if;
  elsif new_total > 0 then
    insert into vehicle_expenses (
      organization_id,
      vehicle_id,
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
      'vehicle_purchase_price',
      coalesce(p_purchase_price, 0),
      new_tax_rate,
      new_tax,
      new_total,
      'company_cash',
      coalesce(p_purchase_date, current_date),
      'Corrected vehicle purchase. Reason: ' || clean_reason,
      auth.uid()
    )
    returning * into purchase_expense;

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
      new_total,
      coalesce(p_purchase_date, current_date),
      'Corrected vehicle purchase. Reason: ' || clean_reason,
      p_vehicle_id,
      purchase_expense.id,
      auth.uid()
    );
  end if;

  insert into vehicle_corrections (organization_id, vehicle_id, correction_type, old_values, new_values, reason, created_by)
  values (
    p_organization_id,
    p_vehicle_id,
    'purchase',
    jsonb_build_object(
      'purchase_price', vehicle_record.purchase_price,
      'purchase_date', vehicle_record.purchase_date,
      'purchase_source', vehicle_record.purchase_source
    ),
    jsonb_build_object(
      'purchase_price', coalesce(p_purchase_price, 0),
      'purchase_date', coalesce(p_purchase_date, current_date),
      'purchase_source', p_purchase_source,
      'tax_rate', new_tax_rate,
      'tax_amount', new_tax,
      'cash_impact', new_total
    ),
    clean_reason,
    auth.uid()
  );

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'vehicle_purchase_corrected',
    'vehicle',
    p_vehicle_id,
    'Vehicle purchase corrected. Reason: ' || clean_reason,
    auth.uid()
  );
end;
$$;

revoke execute on function correct_vehicle_purchase(uuid, uuid, numeric, date, purchase_source, text) from public;
revoke execute on function correct_vehicle_purchase(uuid, uuid, numeric, date, purchase_source, text) from anon;
grant execute on function correct_vehicle_purchase(uuid, uuid, numeric, date, purchase_source, text) to authenticated;
