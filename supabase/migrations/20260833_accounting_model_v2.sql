-- Dealer Flow Accounting Model V2.
-- Forward-only and additive: legacy columns, rows, RPCs, and semantics remain
-- available for historical data. New writes use the V2 RPCs below.

alter table sales
  add column if not exists accounting_model_version smallint,
  add column if not exists sale_price_before_tax numeric(12,2),
  add column if not exists sales_tax_rate numeric(6,4),
  add column if not exists sales_tax_amount numeric(12,2),
  add column if not exists customer_total numeric(12,2),
  add column if not exists company_payment_amount numeric(12,2),
  add column if not exists external_payment_amount numeric(12,2),
  add column if not exists company_cost_basis numeric(12,2),
  add column if not exists company_gross_cash_invested numeric(12,2),
  add column if not exists recoverable_company_tax numeric(12,2),
  add column if not exists tax_settlement_amount numeric(12,2),
  add column if not exists profit_tax_rate numeric(6,4),
  add column if not exists gross_profit numeric(12,2),
  add column if not exists external_vehicle_cost numeric(12,2),
  add column if not exists tracked_net_profit numeric(12,2);

alter table vehicles
  add column if not exists accounting_model_version smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_accounting_model_version_valid') then
    alter table vehicles add constraint vehicles_accounting_model_version_valid
      check (accounting_model_version is null or accounting_model_version = 2);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_accounting_model_version_valid') then
    alter table sales add constraint sales_accounting_model_version_valid
      check (accounting_model_version is null or accounting_model_version = 2);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_accounting_v2_amounts_valid') then
    alter table sales add constraint sales_accounting_v2_amounts_valid check (
      accounting_model_version is null
      or (
        sale_price_before_tax is not null and sale_price_before_tax >= 0
        and sales_tax_rate is not null and sales_tax_rate between 0 and 1
        and sales_tax_amount is not null and sales_tax_amount >= 0
        and customer_total is not null and customer_total >= 0
        and company_payment_amount is not null and company_payment_amount >= 0
        and external_payment_amount is not null and external_payment_amount >= 0
        and company_cost_basis is not null and company_cost_basis >= 0
        and company_gross_cash_invested is not null and company_gross_cash_invested >= 0
        and recoverable_company_tax is not null and recoverable_company_tax >= 0
        and tax_settlement_amount is not null
        and profit_tax_rate is not null and profit_tax_rate between 0 and 1
        and gross_profit is not null
        and profit_tax_due is not null and profit_tax_due >= 0
        and external_vehicle_cost is not null and external_vehicle_cost >= 0
        and tracked_net_profit is not null
        and round((sale_price_before_tax * sales_tax_rate)::numeric, 2) = sales_tax_amount
        and round((sale_price_before_tax + sales_tax_amount)::numeric, 2) = customer_total
        and round((company_payment_amount + external_payment_amount)::numeric, 2) = customer_total
        and round((sale_price_before_tax - company_cost_basis)::numeric, 2) = gross_profit
        and profit_tax_due = greatest(0::numeric, round((gross_profit * profit_tax_rate)::numeric, 2))
        and round((recoverable_company_tax - sales_tax_amount)::numeric, 2) = tax_settlement_amount
        and round((gross_profit - profit_tax_due - external_vehicle_cost)::numeric, 2) = tracked_net_profit
      )
    );
  end if;
end $$;

create index if not exists sales_accounting_model_version_idx
  on sales (organization_id, accounting_model_version);

alter table company_cash_transactions
  drop constraint if exists company_cash_type_valid,
  add constraint company_cash_type_valid check (
    type in (
      'company_cash_added',
      'company_cash_withdrawn',
      'vehicle_cost_paid',
      'vehicle_cost_refunded',
      'paper_sale_received',
      'external_transfer_received',
      'sale_payment_received',
      'vehicle_tax_refund_received',
      'vehicle_tax_payment_made',
      'profit_tax_paid',
      'profit_tax_refunded'
    )
  );

alter table external_cash_transactions
  drop constraint if exists external_cash_type_valid,
  add constraint external_cash_type_valid check (
    type in (
      'external_cash_added',
      'external_commission_earned',
      'external_cash_transferred_to_company',
      'external_transfer_returned',
      'external_cash_personally_removed',
      'external_vehicle_expense_paid',
      'external_vehicle_expense_refunded',
      'external_sale_payment_received'
    )
  );

create index if not exists company_cash_source_sale_v2_idx
  on company_cash_transactions (organization_id, source_sale_id, type);
create index if not exists external_cash_source_sale_v2_idx
  on external_cash_transactions (organization_id, source_sale_id, type);

create or replace function company_cash_transaction_effect(p_type text, p_amount numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_type in ('company_cash_withdrawn', 'vehicle_cost_paid', 'vehicle_tax_payment_made', 'profit_tax_paid')
      then -coalesce(p_amount, 0)
    else coalesce(p_amount, 0)
  end;
$$;

create or replace function external_cash_transaction_effect(p_type text, p_amount numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_type in ('external_cash_transferred_to_company', 'external_cash_personally_removed', 'external_vehicle_expense_paid')
      then -coalesce(p_amount, 0)
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

create or replace function calculate_vehicle_accounting_v2(
  p_organization_id uuid,
  p_vehicle_id uuid
)
returns table (
  company_cost_basis numeric,
  company_gross_cash_invested numeric,
  recoverable_company_tax numeric,
  external_vehicle_cost numeric
)
language sql
security definer
stable
set search_path = public
as $$
  with vehicle_row as (
    select id, purchase_price
    from vehicles
    where id = p_vehicle_id
      and organization_id = p_organization_id
  ),
  active_expenses as (
    select e.*
    from vehicle_expenses e
    where e.vehicle_id = p_vehicle_id
      and e.organization_id = p_organization_id
      and e.voided_at is null
  ),
  totals as (
    select
      coalesce(sum(case when e.funding_source <> 'external_cash' then e.amount_before_tax else 0 end), 0) as basis,
      coalesce(sum(case when e.funding_source <> 'external_cash' then e.total_amount else 0 end), 0) as gross_cash,
      coalesce(sum(case when e.funding_source <> 'external_cash' and e.tax_amount > 0 then e.tax_amount else 0 end), 0) as recoverable_tax,
      coalesce(sum(case when e.funding_source = 'external_cash' then e.total_amount else 0 end), 0) as external_cost,
      exists (select 1 from active_expenses p where p.category = 'vehicle_purchase_price') as has_purchase_expense
    from active_expenses e
  )
  select
    round((totals.basis + case when not totals.has_purchase_expense then coalesce(v.purchase_price, 0) else 0 end)::numeric, 2),
    round((totals.gross_cash + case when not totals.has_purchase_expense then coalesce(v.purchase_price, 0) else 0 end)::numeric, 2),
    round(totals.recoverable_tax::numeric, 2),
    round(totals.external_cost::numeric, 2)
  from vehicle_row v
  cross join totals;
$$;

create or replace function create_vehicle_with_defaults_v2(
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
  p_purchase_tax_rate numeric,
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
  clean_purchase_price numeric(12,2) := round(coalesce(p_purchase_price, 0), 2);
  clean_purchase_rate numeric(6,4) := round(coalesce(p_purchase_tax_rate, 0), 4);
  purchase_tax numeric(12,2);
  purchase_total numeric(12,2);
  clean_purchase_date date := coalesce(p_purchase_date, current_date);
  purchase_source_value purchase_source := coalesce(p_purchase_source, 'other'::purchase_source);
  purchase_note text;
  template recurring_vehicle_expense_templates%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then raise exception 'not allowed'; end if;
  if not exists (select 1 from organizations where id = p_organization_id) then raise exception 'organization not found'; end if;
  if p_purchase_price is null or p_purchase_tax_rate is null
    or clean_purchase_price < 0 or clean_purchase_price <> p_purchase_price
    or clean_purchase_rate < 0 or clean_purchase_rate > 1 or clean_purchase_rate <> p_purchase_tax_rate
  then
    raise exception 'purchase price and tax rate must be valid cent amounts';
  end if;

  insert into vehicles (
    organization_id, vin, year, make, model, trim, color, mileage,
    purchase_price, purchase_date, purchase_source, accounting_model_version, status, listed_price, notes, created_by
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
    clean_purchase_price,
    clean_purchase_date,
    purchase_source_value,
    2,
    coalesce(p_status, 'purchased'::vehicle_status),
    p_listed_price,
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning id into new_vehicle_id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'vehicle_created', 'vehicle', new_vehicle_id, 'Vehicle created with Accounting Model V2 purchase tax.', auth.uid());

  if clean_purchase_price > 0 then
    purchase_tax := round((clean_purchase_price * clean_purchase_rate)::numeric, 2);
    purchase_total := round((clean_purchase_price + purchase_tax)::numeric, 2);
    purchase_note := 'Vehicle purchase price with ' || to_char(clean_purchase_rate * 100, 'FM990D##') || '% purchase tax';

    if organization_company_cash_balance(p_organization_id) < purchase_total then
      raise exception 'Company cash does not have enough available balance for this vehicle purchase.';
    end if;

    insert into vehicle_expenses (
      organization_id, vehicle_id, category, amount_before_tax, tax_rate,
      tax_amount, total_amount, funding_source, date, note, created_by
    )
    values (
      p_organization_id, new_vehicle_id, 'vehicle_purchase_price', clean_purchase_price,
      clean_purchase_rate, purchase_tax, purchase_total, 'company_cash', clean_purchase_date,
      purchase_note, auth.uid()
    )
    returning id into new_expense_id;

    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_expense_id, created_by
    )
    values (
      p_organization_id, 'vehicle_cost_paid', purchase_total, clean_purchase_date,
      purchase_note, new_vehicle_id, new_expense_id, auth.uid()
    );

    insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
    values (p_organization_id, 'expense_added', 'vehicle', new_vehicle_id, purchase_note, auth.uid());
  end if;

  for template in
    select * from recurring_vehicle_expense_templates
    where organization_id = p_organization_id
      and auto_apply_to_new_vehicles = true
      and is_active = true
      and deleted_at is null
    order by created_at asc
  loop
    if template.default_funding_source = 'company_cash'
      and organization_company_cash_balance(p_organization_id) < template.total_amount
    then
      raise exception 'Company cash does not have enough available balance for recurring expense %. ', template.name;
    end if;
    if template.default_funding_source = 'external_cash'
      and organization_external_cash_balance(p_organization_id) < template.total_amount
    then
      raise exception 'External cash does not have enough available balance for recurring expense %. ', template.name;
    end if;

    insert into vehicle_expenses (
      organization_id, vehicle_id, recurring_template_id, category, amount_before_tax,
      tax_rate, tax_amount, total_amount, funding_source, date, note, created_by
    )
    values (
      p_organization_id, new_vehicle_id, template.id, template.category, template.amount_before_tax,
      template.tax_rate, template.tax_amount, template.total_amount, template.default_funding_source,
      clean_purchase_date, coalesce(template.description, template.name), auth.uid()
    )
    returning id into new_expense_id;

    if template.total_amount > 0 and template.default_funding_source = 'company_cash' then
      insert into company_cash_transactions (
        organization_id, type, amount, date, note, source_vehicle_id, source_expense_id, created_by
      )
      values (
        p_organization_id, 'vehicle_cost_paid', template.total_amount, clean_purchase_date,
        'Vehicle recurring expense: ' || template.name, new_vehicle_id, new_expense_id, auth.uid()
      );
    elsif template.total_amount > 0 and template.default_funding_source = 'external_cash' then
      insert into external_cash_transactions (
        organization_id, type, amount, date, note, source_vehicle_id, source_expense_id, created_by
      )
      values (
        p_organization_id, 'external_vehicle_expense_paid', template.total_amount, clean_purchase_date,
        'Vehicle recurring expense: ' || template.name, new_vehicle_id, new_expense_id, auth.uid()
      );
    end if;

    insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
    values (p_organization_id, 'expense_added', 'vehicle', new_vehicle_id, 'Automatic recurring expense: ' || template.name, auth.uid());
  end loop;

  return new_vehicle_id;
end;
$$;

create or replace function correct_vehicle_purchase_accounting_v2(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_purchase_price numeric,
  p_purchase_date date,
  p_purchase_source purchase_source,
  p_purchase_tax_rate numeric,
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
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
  clean_price numeric(12,2) := round(coalesce(p_purchase_price, 0), 2);
  clean_rate numeric(6,4) := round(coalesce(p_purchase_tax_rate, 0), 4);
  clean_date date := coalesce(p_purchase_date, current_date);
  new_tax numeric(12,2);
  new_total numeric(12,2);
  old_cash_impact numeric(12,2) := 0;
  cash_impact_count integer := 0;
  old_purchase_tax_rate numeric(6,4) := 0;
  old_purchase_tax_amount numeric(12,2) := 0;
  old_purchase_total numeric(12,2) := 0;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then raise exception 'not allowed'; end if;
  if clean_reason is null then raise exception 'Purchase correction reason is required.'; end if;
  if p_purchase_price is null or p_purchase_tax_rate is null
    or clean_price < 0 or clean_price <> p_purchase_price
    or clean_rate < 0 or clean_rate > 1 or clean_rate <> coalesce(p_purchase_tax_rate, 0)
    or p_purchase_source is null
  then raise exception 'Purchase details are invalid.'; end if;

  perform 1 from organizations where id = p_organization_id for update;
  if not found then raise exception 'organization not found'; end if;

  select * into vehicle_record
  from vehicles
  where id = p_vehicle_id and organization_id = p_organization_id
  for update;
  if vehicle_record.id is null or vehicle_record.archived_at is not null then raise exception 'vehicle not found'; end if;
  if vehicle_record.status = 'sold'::vehicle_status or exists (
    select 1 from sales where organization_id = p_organization_id and vehicle_id = p_vehicle_id
  ) then raise exception 'Sold vehicle purchase details require the sale correction workflow.'; end if;
  if exists (
    select 1 from vehicle_expenses
    where organization_id = p_organization_id and vehicle_id = p_vehicle_id
      and category = 'vehicle_purchase_price' and voided_at is not null
  ) then raise exception 'Voided purchase expenses require a dedicated financial correction review.'; end if;

  select * into purchase_expense
  from vehicle_expenses
  where organization_id = p_organization_id and vehicle_id = p_vehicle_id
    and category = 'vehicle_purchase_price' and voided_at is null
  order by created_at asc
  limit 1
  for update;

  if purchase_expense.id is not null then
    old_purchase_tax_rate := coalesce(purchase_expense.tax_rate, 0);
    old_purchase_tax_amount := coalesce(purchase_expense.tax_amount, 0);
    old_purchase_total := coalesce(purchase_expense.total_amount, 0);
    select count(*), coalesce(sum(amount), 0)
    into cash_impact_count, old_cash_impact
    from company_cash_transactions
    where organization_id = p_organization_id
      and source_expense_id = purchase_expense.id
      and type = 'vehicle_cost_paid'
      and deleted_at is null and voided_at is null
      and reversed_transaction_id is null and correction_of_transaction_id is null;
    if cash_impact_count > 1 then raise exception 'Multiple active cash impacts exist for this purchase expense; correction was blocked.'; end if;
  end if;

  new_tax := round((clean_price * clean_rate)::numeric, 2);
  new_total := round((clean_price + new_tax)::numeric, 2);
  if purchase_expense.id is not null and cash_impact_count = 1 and new_total <= 0 then
    raise exception 'Existing paid purchases cannot be corrected to zero through this workflow.';
  end if;
  if new_total > organization_company_cash_balance(p_organization_id) + old_cash_impact then
    raise exception 'Company cash does not have enough available balance for this purchase correction.';
  end if;

  update vehicles
  set purchase_price = clean_price, purchase_date = clean_date, purchase_source = p_purchase_source,
      accounting_model_version = 2, updated_at = now()
  where id = vehicle_record.id and organization_id = p_organization_id;

  if purchase_expense.id is not null then
    update vehicle_expenses
    set amount_before_tax = clean_price, tax_rate = clean_rate, tax_amount = new_tax,
        total_amount = new_total, date = clean_date,
        note = 'Corrected vehicle purchase. Reason: ' || clean_reason, updated_at = now()
    where id = purchase_expense.id;

    if cash_impact_count = 0 and new_total > 0 then
      insert into company_cash_transactions (
        organization_id, type, amount, date, note, source_vehicle_id, source_expense_id, created_by
      )
      values (
        p_organization_id, 'vehicle_cost_paid', new_total, clean_date,
        'Corrected vehicle purchase. Reason: ' || clean_reason, p_vehicle_id, purchase_expense.id, auth.uid()
      );
    elsif cash_impact_count = 1 then
      update company_cash_transactions
      set amount = new_total, date = clean_date,
          note = 'Corrected vehicle purchase. Reason: ' || clean_reason, updated_at = now()
      where organization_id = p_organization_id and source_expense_id = purchase_expense.id
        and type = 'vehicle_cost_paid' and deleted_at is null and voided_at is null
        and reversed_transaction_id is null and correction_of_transaction_id is null;
    end if;
  elsif new_total > 0 then
    insert into vehicle_expenses (
      organization_id, vehicle_id, category, amount_before_tax, tax_rate, tax_amount,
      total_amount, funding_source, date, note, created_by
    )
    values (
      p_organization_id, p_vehicle_id, 'vehicle_purchase_price', clean_price, clean_rate,
      new_tax, new_total, 'company_cash', clean_date,
      'Corrected vehicle purchase. Reason: ' || clean_reason, auth.uid()
    )
    returning * into purchase_expense;

    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_expense_id, created_by
    )
    values (
      p_organization_id, 'vehicle_cost_paid', new_total, clean_date,
      'Corrected vehicle purchase. Reason: ' || clean_reason, p_vehicle_id, purchase_expense.id, auth.uid()
    );
  end if;

  insert into vehicle_corrections (organization_id, vehicle_id, correction_type, old_values, new_values, reason, created_by)
  values (
    p_organization_id, p_vehicle_id, 'purchase',
    jsonb_build_object(
      'purchase_price', vehicle_record.purchase_price,
      'purchase_date', vehicle_record.purchase_date,
      'purchase_source', vehicle_record.purchase_source,
      'purchase_tax_rate', old_purchase_tax_rate,
      'purchase_tax_amount', old_purchase_tax_amount,
      'purchase_gross_amount', old_purchase_total
    ),
    jsonb_build_object(
      'purchase_price', clean_price,
      'purchase_date', clean_date,
      'purchase_source', p_purchase_source,
      'purchase_tax_rate', clean_rate,
      'purchase_tax_amount', new_tax,
      'purchase_gross_amount', new_total
    ),
    clean_reason,
    auth.uid()
  );

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'vehicle_purchase_corrected', 'vehicle', p_vehicle_id,
    'Vehicle purchase corrected with Accounting Model V2 tax rate. Reason: ' || clean_reason, auth.uid());
end;
$$;

create or replace function record_vehicle_sale_accounting_v2(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_sale_date date,
  p_sale_price_before_tax numeric,
  p_sales_tax_rate numeric,
  p_company_payment_amount numeric,
  p_external_payment_amount numeric,
  p_buyer_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  sale_id uuid;
  buyer_contact_id uuid;
  company_cost_basis numeric(12,2);
  company_gross_cash_invested numeric(12,2);
  recoverable_company_tax numeric(12,2);
  external_vehicle_cost numeric(12,2);
  sale_price numeric(12,2) := round(coalesce(p_sale_price_before_tax, 0), 2);
  sales_tax_rate numeric(6,4) := round(coalesce(p_sales_tax_rate, 0), 4);
  sales_tax_amount numeric(12,2);
  customer_total numeric(12,2);
  company_payment numeric(12,2) := round(coalesce(p_company_payment_amount, 0), 2);
  external_payment numeric(12,2) := round(coalesce(p_external_payment_amount, 0), 2);
  tax_settlement numeric(12,2);
  gross_profit numeric(12,2);
  profit_tax_due numeric(12,2);
  tracked_net_profit numeric(12,2);
  effective_date date := coalesce(p_sale_date, current_date);
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then raise exception 'not allowed'; end if;
  if sales_tax_rate <> 0.05 then raise exception 'Accounting Model V2 sales tax rate must be 5%%.'; end if;
  if p_sale_price_before_tax is null or p_sales_tax_rate is null
    or p_company_payment_amount is null or p_external_payment_amount is null
    or sale_price < 0 or sale_price <> p_sale_price_before_tax
    or company_payment < 0 or company_payment <> coalesce(p_company_payment_amount, 0)
    or external_payment < 0 or external_payment <> coalesce(p_external_payment_amount, 0)
  then raise exception 'Sale amounts must be nonnegative cent amounts.'; end if;

  sales_tax_amount := round((sale_price * sales_tax_rate)::numeric, 2);
  customer_total := round((sale_price + sales_tax_amount)::numeric, 2);
  if round((company_payment + external_payment)::numeric, 2) <> customer_total then
    raise exception 'Company and external payments must equal the customer total exactly.';
  end if;

  perform 1 from organizations where id = p_organization_id for update;
  if not found then raise exception 'organization not found'; end if;
  select * into vehicle_record
  from vehicles
  where id = p_vehicle_id and organization_id = p_organization_id
  for update;
  if vehicle_record.id is null or vehicle_record.archived_at is not null then raise exception 'vehicle not found'; end if;
  if exists (
    select 1 from sales where organization_id = p_organization_id and vehicle_id = p_vehicle_id
      and voided_at is null and status = 'active'
  ) then raise exception 'this vehicle already has an active sale record'; end if;

  select a.company_cost_basis, a.company_gross_cash_invested, a.recoverable_company_tax, a.external_vehicle_cost
  into company_cost_basis, company_gross_cash_invested, recoverable_company_tax, external_vehicle_cost
  from calculate_vehicle_accounting_v2(p_organization_id, p_vehicle_id) a;
  if company_cost_basis is null then raise exception 'vehicle accounting basis could not be calculated'; end if;

  tax_settlement := round((recoverable_company_tax - sales_tax_amount)::numeric, 2);
  gross_profit := round((sale_price - company_cost_basis)::numeric, 2);
  profit_tax_due := greatest(0, round((gross_profit * 0.22)::numeric, 2));
  tracked_net_profit := round((gross_profit - profit_tax_due - external_vehicle_cost)::numeric, 2);

  if organization_company_cash_balance(p_organization_id) + company_payment + greatest(tax_settlement, 0) - greatest(-tax_settlement, 0) - profit_tax_due < 0 then
    raise exception 'Sale tax settlement and profit tax would make company cash negative.';
  end if;

  if nullif(trim(coalesce(p_buyer_name, '')), '') is not null then
    insert into contacts (organization_id, type, full_name, phone, email, address, notes, created_by)
    values (
      p_organization_id, 'buyer', trim(p_buyer_name), nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_email, '')), ''), nullif(trim(coalesce(p_address, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''), auth.uid()
    )
    returning id into buyer_contact_id;
    insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
    values (p_organization_id, 'contact_created', 'contact', buyer_contact_id, trim(p_buyer_name), auth.uid());
  end if;

  insert into sales (
    organization_id, vehicle_id, contact_id, sale_date,
    vehicle_total_cost, taxable_profit_amount, profit_tax_due,
    paper_sale_price, real_client_payment, external_commission,
    accounting_model_version, sale_price_before_tax, sales_tax_rate, sales_tax_amount,
    customer_total, company_payment_amount, external_payment_amount,
    company_cost_basis, company_gross_cash_invested, recoverable_company_tax,
    tax_settlement_amount, profit_tax_rate, gross_profit, external_vehicle_cost,
    tracked_net_profit, notes, status, created_by
  )
  values (
    p_organization_id, p_vehicle_id, buyer_contact_id, effective_date,
    company_cost_basis, gross_profit, profit_tax_due,
    sale_price, customer_total, external_payment,
    2, sale_price, sales_tax_rate, sales_tax_amount,
    customer_total, company_payment, external_payment,
    company_cost_basis, company_gross_cash_invested, recoverable_company_tax,
    tax_settlement, 0.22, gross_profit, external_vehicle_cost,
    tracked_net_profit, nullif(trim(coalesce(p_notes, '')), ''), 'active', auth.uid()
  )
  returning id into sale_id;

  update vehicles set status = 'sold', accounting_model_version = 2, updated_at = now()
  where id = p_vehicle_id and organization_id = p_organization_id;

  if company_payment > 0 then
    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, created_by
    )
    values (
      p_organization_id, 'sale_payment_received', company_payment, effective_date,
      'Company-routed V2 sale payment received', p_vehicle_id, sale_id, auth.uid()
    );
  end if;
  if external_payment > 0 then
    insert into external_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, created_by
    )
    values (
      p_organization_id, 'external_sale_payment_received', external_payment, effective_date,
      'External-routed V2 sale payment received', p_vehicle_id, sale_id, auth.uid()
    );
  end if;
  if tax_settlement > 0 then
    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, created_by
    )
    values (
      p_organization_id, 'vehicle_tax_refund_received', tax_settlement, effective_date,
      'V2 recoverable vehicle tax refund/credit received', p_vehicle_id, sale_id, auth.uid()
    );
  elsif tax_settlement < 0 then
    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, created_by
    )
    values (
      p_organization_id, 'vehicle_tax_payment_made', abs(tax_settlement), effective_date,
      'V2 vehicle tax settlement paid', p_vehicle_id, sale_id, auth.uid()
    );
  end if;
  if profit_tax_due > 0 then
    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, created_by
    )
    values (
      p_organization_id, 'profit_tax_paid', profit_tax_due, effective_date,
      'V2 estimated profit tax paid', p_vehicle_id, sale_id, auth.uid()
    );
  end if;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'vehicle_sold', 'vehicle', p_vehicle_id, 'Accounting Model V2 sale recorded.', auth.uid());
  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'cash_transaction_created', 'sale', sale_id, 'V2 sale cash, tax settlement, and profit tax rows generated.', auth.uid());

  return sale_id;
end;
$$;

create or replace function void_vehicle_sale_accounting_v2(
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
  company_original company_cash_transactions%rowtype;
  external_original external_cash_transactions%rowtype;
  expected_company integer := 0;
  expected_external integer := 0;
  company_count integer := 0;
  external_count integer := 0;
  projected_company numeric;
  projected_external numeric;
  reversal_type text;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then raise exception 'not allowed'; end if;
  if clean_reason is null then raise exception 'Sale void reason is required.'; end if;
  perform 1 from organizations where id = p_organization_id for update;
  if not found then raise exception 'organization not found'; end if;

  select * into sale_record from sales
  where id = p_sale_id and organization_id = p_organization_id
  for update;
  if sale_record.id is null then raise exception 'sale not found'; end if;
  if sale_record.accounting_model_version <> 2 then raise exception 'Sale is legacy; use the legacy correction workflow.'; end if;
  if sale_record.voided_at is not null or sale_record.status <> 'active' then raise exception 'sale is already voided or corrected'; end if;

  select * into vehicle_record from vehicles
  where id = sale_record.vehicle_id and organization_id = p_organization_id
  for update;
  if vehicle_record.id is null then raise exception 'vehicle not found'; end if;

  expected_company := (case when coalesce(sale_record.company_payment_amount, 0) > 0 then 1 else 0 end)
    + (case when coalesce(sale_record.tax_settlement_amount, 0) <> 0 then 1 else 0 end)
    + (case when coalesce(sale_record.profit_tax_due, 0) > 0 then 1 else 0 end);
  expected_external := case when coalesce(sale_record.external_payment_amount, 0) > 0 then 1 else 0 end;

  select count(*) into company_count
  from company_cash_transactions
  where organization_id = p_organization_id and source_sale_id = sale_record.id
    and type in ('sale_payment_received', 'vehicle_tax_refund_received', 'vehicle_tax_payment_made', 'profit_tax_paid')
    and deleted_at is null and voided_at is null and reversed_transaction_id is null
    and correction_of_transaction_id is null;
  if company_count <> expected_company then raise exception 'V2 sale company cash impacts are missing or duplicated; sale void was blocked.'; end if;

  select count(*) into external_count
  from external_cash_transactions
  where organization_id = p_organization_id and source_sale_id = sale_record.id
    and type = 'external_sale_payment_received'
    and deleted_at is null and voided_at is null and reversed_transaction_id is null
    and correction_of_transaction_id is null;
  if external_count <> expected_external then raise exception 'V2 sale external cash impacts are missing or duplicated; sale void was blocked.'; end if;

  select organization_company_cash_balance(p_organization_id)
    - coalesce(sum(company_cash_transaction_effect(type, amount)), 0)
  into projected_company
  from company_cash_transactions
  where organization_id = p_organization_id and source_sale_id = sale_record.id
    and type in ('sale_payment_received', 'vehicle_tax_refund_received', 'vehicle_tax_payment_made', 'profit_tax_paid')
    and deleted_at is null and voided_at is null and reversed_transaction_id is null
    and correction_of_transaction_id is null;
  if projected_company < 0 then raise exception 'Voiding this sale would make company cash negative.'; end if;

  select organization_external_cash_balance(p_organization_id)
    - coalesce(sum(external_cash_transaction_effect(type, amount)), 0)
  into projected_external
  from external_cash_transactions
  where organization_id = p_organization_id and source_sale_id = sale_record.id
    and type = 'external_sale_payment_received'
    and deleted_at is null and voided_at is null and reversed_transaction_id is null
    and correction_of_transaction_id is null;
  if projected_external < 0 then raise exception 'Voiding this sale would make external cash negative.'; end if;

  for company_original in
    select * from company_cash_transactions
    where organization_id = p_organization_id and source_sale_id = sale_record.id
      and type in ('sale_payment_received', 'vehicle_tax_refund_received', 'vehicle_tax_payment_made', 'profit_tax_paid')
      and deleted_at is null and voided_at is null and reversed_transaction_id is null
      and correction_of_transaction_id is null
    order by id
    for update
  loop
    reversal_type := case company_original.type
      when 'sale_payment_received' then 'company_cash_withdrawn'
      when 'vehicle_tax_refund_received' then 'vehicle_tax_payment_made'
      when 'vehicle_tax_payment_made' then 'vehicle_tax_refund_received'
      when 'profit_tax_paid' then 'profit_tax_refunded'
      else null
    end;
    if reversal_type is null then raise exception 'Unsupported V2 company cash reversal type.'; end if;
    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id,
      correction_of_transaction_id, created_by
    )
    values (
      p_organization_id, reversal_type, company_original.amount, current_date,
      'V2 sale void reversal: ' || clean_reason, sale_record.vehicle_id, sale_record.id,
      company_original.id, auth.uid()
    );
    update company_cash_transactions
    set reversed_transaction_id = (
      select id from company_cash_transactions
      where organization_id = p_organization_id
        and correction_of_transaction_id = company_original.id
        and source_sale_id = sale_record.id
      order by created_at desc limit 1
    ), voided_at = now(), voided_by = auth.uid(), void_reason = clean_reason, updated_at = now()
    where id = company_original.id;
  end loop;

  for external_original in
    select * from external_cash_transactions
    where organization_id = p_organization_id and source_sale_id = sale_record.id
      and type = 'external_sale_payment_received'
      and deleted_at is null and voided_at is null and reversed_transaction_id is null
      and correction_of_transaction_id is null
    for update
  loop
    insert into external_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id,
      correction_of_transaction_id, created_by
    )
    values (
      p_organization_id, 'external_cash_personally_removed', external_original.amount, current_date,
      'V2 sale void reversal: ' || clean_reason, sale_record.vehicle_id, sale_record.id,
      external_original.id, auth.uid()
    );
    update external_cash_transactions
    set reversed_transaction_id = (
      select id from external_cash_transactions
      where organization_id = p_organization_id
        and correction_of_transaction_id = external_original.id
        and source_sale_id = sale_record.id
      order by created_at desc limit 1
    ), voided_at = now(), voided_by = auth.uid(), void_reason = clean_reason, updated_at = now()
    where id = external_original.id;
  end loop;

  update sales
  set status = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = clean_reason, updated_at = now()
  where id = sale_record.id;
  update vehicles set status = 'listed_for_sale', updated_at = now()
  where id = sale_record.vehicle_id and organization_id = p_organization_id and status = 'sold';

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'sale_voided', 'sale', sale_record.id,
    'Accounting Model V2 sale voided. Reason: ' || clean_reason, auth.uid());
  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'cash_transaction_reversed', 'sale', sale_record.id,
    'All V2 sale-linked cash impacts were reversed by source ID.', auth.uid());
  return sale_record.id;
end;
$$;

create or replace function correct_vehicle_sale_accounting_v2(
  p_organization_id uuid,
  p_sale_id uuid,
  p_sale_date date,
  p_sale_price_before_tax numeric,
  p_sales_tax_rate numeric,
  p_company_payment_amount numeric,
  p_external_payment_amount numeric,
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
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then raise exception 'not allowed'; end if;
  if clean_reason is null then raise exception 'Sale correction reason is required.'; end if;
  perform 1 from organizations where id = p_organization_id for update;
  if not found then raise exception 'organization not found'; end if;
  select * into old_sale from sales where id = p_sale_id and organization_id = p_organization_id for update;
  if old_sale.id is null then raise exception 'sale not found'; end if;
  if old_sale.accounting_model_version <> 2 then raise exception 'Legacy sales require the legacy correction workflow.'; end if;
  if old_sale.voided_at is not null or old_sale.status <> 'active' then raise exception 'sale is already voided or corrected'; end if;

  perform void_vehicle_sale_accounting_v2(p_organization_id, p_sale_id, 'Corrected sale: ' || clean_reason);
  new_sale_id := record_vehicle_sale_accounting_v2(
    p_organization_id, old_sale.vehicle_id, p_sale_date, p_sale_price_before_tax,
    p_sales_tax_rate, p_company_payment_amount, p_external_payment_amount,
    p_buyer_name, p_phone, p_email, p_address, p_notes
  );

  if nullif(trim(coalesce(p_buyer_name, '')), '') is null and old_sale.contact_id is not null then
    update sales set contact_id = old_sale.contact_id, updated_at = now() where id = new_sale_id;
  end if;
  update sales set status = 'corrected', corrected_by_sale_id = new_sale_id, updated_at = now() where id = old_sale.id;
  update sales set correction_of_sale_id = old_sale.id, updated_at = now() where id = new_sale_id;
  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'sale_corrected', 'sale', new_sale_id,
    'Accounting Model V2 sale correction created from ' || old_sale.id || '. Reason: ' || clean_reason, auth.uid());
  return new_sale_id;
end;
$$;

revoke all on function calculate_vehicle_accounting_v2(uuid, uuid) from public;
revoke all on function calculate_vehicle_accounting_v2(uuid, uuid) from anon;
revoke all on function calculate_vehicle_accounting_v2(uuid, uuid) from authenticated;
revoke all on function create_vehicle_with_defaults_v2(uuid, text, integer, text, text, text, text, integer, numeric, date, purchase_source, numeric, vehicle_status, numeric, text) from public;
revoke all on function create_vehicle_with_defaults_v2(uuid, text, integer, text, text, text, text, integer, numeric, date, purchase_source, numeric, vehicle_status, numeric, text) from anon;
grant execute on function create_vehicle_with_defaults_v2(uuid, text, integer, text, text, text, text, integer, numeric, date, purchase_source, numeric, vehicle_status, numeric, text) to authenticated;
revoke all on function correct_vehicle_purchase_accounting_v2(uuid, uuid, numeric, date, purchase_source, numeric, text) from public;
revoke all on function correct_vehicle_purchase_accounting_v2(uuid, uuid, numeric, date, purchase_source, numeric, text) from anon;
grant execute on function correct_vehicle_purchase_accounting_v2(uuid, uuid, numeric, date, purchase_source, numeric, text) to authenticated;
revoke all on function record_vehicle_sale_accounting_v2(uuid, uuid, date, numeric, numeric, numeric, numeric, text, text, text, text, text) from public;
revoke all on function record_vehicle_sale_accounting_v2(uuid, uuid, date, numeric, numeric, numeric, numeric, text, text, text, text, text) from anon;
grant execute on function record_vehicle_sale_accounting_v2(uuid, uuid, date, numeric, numeric, numeric, numeric, text, text, text, text, text) to authenticated;
revoke all on function void_vehicle_sale_accounting_v2(uuid, uuid, text) from public;
revoke all on function void_vehicle_sale_accounting_v2(uuid, uuid, text) from anon;
grant execute on function void_vehicle_sale_accounting_v2(uuid, uuid, text) to authenticated;
revoke all on function correct_vehicle_sale_accounting_v2(uuid, uuid, date, numeric, numeric, numeric, numeric, text, text, text, text, text, text) from public;
revoke all on function correct_vehicle_sale_accounting_v2(uuid, uuid, date, numeric, numeric, numeric, numeric, text, text, text, text, text, text) from anon;
grant execute on function correct_vehicle_sale_accounting_v2(uuid, uuid, date, numeric, numeric, numeric, numeric, text, text, text, text, text, text) to authenticated;
