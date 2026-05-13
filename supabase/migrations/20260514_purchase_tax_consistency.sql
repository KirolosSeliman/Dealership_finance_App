create or replace function calculate_purchase_tax_rate(p_purchase_source purchase_source)
returns numeric
language sql
immutable
set search_path = public
as $$
  -- Keep in sync with src/lib/domain/constants.ts PURCHASE_TAX_RATE_BY_SOURCE.
  select case
    when p_purchase_source = 'OpenLane'::purchase_source then 0.05::numeric
    else 0::numeric
  end;
$$;

create or replace function create_vehicle_with_defaults(
  p_organization_id uuid,
  p_vin text,
  p_year integer,
  p_make text,
  p_model text,
  p_trim text,
  p_color text,
  p_mileage integer,
  p_purchase_price numeric,
  p_purchase_date date,
  p_purchase_source purchase_source,
  p_status vehicle_status,
  p_listed_price numeric,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_vehicle_id uuid;
  new_expense_id uuid;
  purchase_tax_rate numeric(6,4);
  purchase_tax numeric(12,2);
  purchase_total numeric(12,2);
  purchase_source purchase_source;
  purchase_note text;
  template recurring_vehicle_expense_templates%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
  end if;

  perform 1 from organizations where id = p_organization_id;
  if not found then
    raise exception 'organization not found';
  end if;

  if coalesce(p_purchase_price, 0) < 0 then
    raise exception 'purchase price must not be negative';
  end if;

  purchase_source := coalesce(p_purchase_source, 'other'::purchase_source);

  insert into vehicles (
    organization_id,
    vin,
    year,
    make,
    model,
    trim,
    color,
    mileage,
    purchase_price,
    purchase_date,
    purchase_source,
    status,
    listed_price,
    notes,
    created_by
  )
  values (
    p_organization_id,
    upper(trim(coalesce(p_vin, ''))),
    p_year,
    nullif(trim(coalesce(p_make, '')), ''),
    nullif(trim(coalesce(p_model, '')), ''),
    nullif(trim(coalesce(p_trim, '')), ''),
    nullif(trim(coalesce(p_color, '')), ''),
    p_mileage,
    coalesce(p_purchase_price, 0),
    coalesce(p_purchase_date, current_date),
    purchase_source,
    coalesce(p_status, 'purchased'::vehicle_status),
    p_listed_price,
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning id into new_vehicle_id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'vehicle_created', 'vehicle', new_vehicle_id, 'Vehicle created', auth.uid());

  if coalesce(p_purchase_price, 0) > 0 then
    purchase_tax_rate := calculate_purchase_tax_rate(purchase_source);
    purchase_tax := round((p_purchase_price * purchase_tax_rate)::numeric, 2);
    purchase_total := round((p_purchase_price + purchase_tax)::numeric, 2);
    purchase_note := case
      when purchase_tax_rate > 0 then 'Vehicle purchase price with OpenLane 5% purchase tax'
      else 'Vehicle purchase price'
    end;

    if organization_company_cash_balance(p_organization_id) < purchase_total then
      raise exception 'Company cash does not have enough available balance for this vehicle purchase.';
    end if;

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
      new_vehicle_id,
      'vehicle_purchase_price',
      p_purchase_price,
      purchase_tax_rate,
      purchase_tax,
      purchase_total,
      'company_cash',
      coalesce(p_purchase_date, current_date),
      purchase_note,
      auth.uid()
    )
    returning id into new_expense_id;

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
      purchase_total,
      coalesce(p_purchase_date, current_date),
      purchase_note,
      new_vehicle_id,
      new_expense_id,
      auth.uid()
    );

    insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
    values (p_organization_id, 'expense_added', 'vehicle', new_vehicle_id, purchase_note, auth.uid());
  end if;

  for template in
    select *
    from recurring_vehicle_expense_templates
    where organization_id = p_organization_id
      and auto_apply_to_new_vehicles = true
      and is_active = true
      and deleted_at is null
    order by created_at asc
  loop
    if template.default_funding_source = 'company_cash' and organization_company_cash_balance(p_organization_id) < template.total_amount then
      raise exception 'Company cash does not have enough available balance for recurring expense %. ', template.name;
    end if;
    if template.default_funding_source = 'external_cash' and organization_external_cash_balance(p_organization_id) < template.total_amount then
      raise exception 'External cash does not have enough available balance for recurring expense %. ', template.name;
    end if;

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
      new_vehicle_id,
      template.id,
      template.category,
      template.amount_before_tax,
      template.tax_rate,
      template.tax_amount,
      template.total_amount,
      template.default_funding_source,
      coalesce(p_purchase_date, current_date),
      coalesce(template.description, template.name),
      auth.uid()
    )
    returning id into new_expense_id;

    if template.total_amount > 0 and template.default_funding_source = 'company_cash' then
      insert into company_cash_transactions (
        organization_id, type, amount, date, note, source_vehicle_id, source_expense_id, created_by
      )
      values (
        p_organization_id, 'vehicle_cost_paid', template.total_amount, coalesce(p_purchase_date, current_date),
        'Vehicle recurring expense: ' || template.name, new_vehicle_id, new_expense_id, auth.uid()
      );
    elsif template.total_amount > 0 and template.default_funding_source = 'external_cash' then
      insert into external_cash_transactions (
        organization_id, type, amount, date, note, source_vehicle_id, source_expense_id, created_by
      )
      values (
        p_organization_id, 'external_vehicle_expense_paid', template.total_amount, coalesce(p_purchase_date, current_date),
        'Vehicle recurring expense: ' || template.name, new_vehicle_id, new_expense_id, auth.uid()
      );
    end if;

    insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
    values (p_organization_id, 'expense_added', 'vehicle', new_vehicle_id, 'Automatic recurring expense: ' || template.name, auth.uid());
  end loop;

  return new_vehicle_id;
end;
$$;

revoke all on function calculate_purchase_tax_rate(purchase_source) from public;
grant execute on function calculate_purchase_tax_rate(purchase_source) to authenticated;
revoke all on function create_vehicle_with_defaults(uuid, text, integer, text, text, text, text, integer, numeric, date, purchase_source, vehicle_status, numeric, text) from public;
grant execute on function create_vehicle_with_defaults(uuid, text, integer, text, text, text, text, integer, numeric, date, purchase_source, vehicle_status, numeric, text) to authenticated;
