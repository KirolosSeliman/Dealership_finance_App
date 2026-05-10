create table if not exists recurring_vehicle_expense_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  category expense_category not null default 'other',
  amount_before_tax numeric(12,2) not null default 0,
  tax_behavior text not null default 'no_tax',
  tax_rate numeric(6,4) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  default_funding_source text not null default 'company_cash',
  auto_apply_to_new_vehicles boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references profiles(id),
  constraint recurring_expense_amounts_valid check (amount_before_tax >= 0 and tax_amount >= 0 and total_amount >= 0),
  constraint recurring_expense_tax_rate_valid check (tax_rate >= 0 and tax_rate <= 1),
  constraint recurring_expense_tax_behavior_valid check (tax_behavior in ('no_tax', 'add_15_percent', 'custom')),
  constraint recurring_expense_funding_source_valid check (default_funding_source in ('company_cash', 'external_cash'))
);

alter table vehicle_expenses
  add column if not exists recurring_template_id uuid references recurring_vehicle_expense_templates(id),
  add column if not exists funding_source text not null default 'company_cash';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vehicle_expense_funding_source_valid'
  ) then
    alter table vehicle_expenses
      add constraint vehicle_expense_funding_source_valid check (funding_source in ('company_cash', 'external_cash'));
  end if;
end $$;

alter table company_cash_transactions
  add column if not exists source_expense_id uuid;

alter table external_cash_transactions
  add column if not exists source_expense_id uuid;

alter table company_cash_transactions drop constraint if exists company_cash_transactions_source_expense_id_fkey;
alter table company_cash_transactions drop constraint if exists company_cash_source_expense_fk;
alter table company_cash_transactions
  add constraint company_cash_source_expense_fk foreign key (source_expense_id) references vehicle_expenses(id) on delete set null;

alter table external_cash_transactions drop constraint if exists external_cash_transactions_source_expense_id_fkey;
alter table external_cash_transactions drop constraint if exists external_cash_source_expense_fk;
alter table external_cash_transactions
  add constraint external_cash_source_expense_fk foreign key (source_expense_id) references vehicle_expenses(id) on delete set null;

do $$
begin
  alter table external_cash_transactions drop constraint if exists external_cash_type_valid;
  alter table external_cash_transactions add constraint external_cash_type_valid
    check (type in (
      'external_commission_earned',
      'external_cash_transferred_to_company',
      'external_cash_personally_removed',
      'external_vehicle_expense_paid'
    ));
exception
  when duplicate_object then null;
end $$;

alter table recurring_vehicle_expense_templates enable row level security;

drop policy if exists "read recurring vehicle expense templates" on recurring_vehicle_expense_templates;
create policy "read recurring vehicle expense templates"
on recurring_vehicle_expense_templates
for select
using (is_org_member(organization_id));

drop policy if exists "insert recurring vehicle expense templates" on recurring_vehicle_expense_templates;
create policy "insert recurring vehicle expense templates"
on recurring_vehicle_expense_templates
for insert
with check (has_org_role(organization_id, array['owner','admin']::app_role[]));

drop policy if exists "update recurring vehicle expense templates" on recurring_vehicle_expense_templates;
create policy "update recurring vehicle expense templates"
on recurring_vehicle_expense_templates
for update
using (has_org_role(organization_id, array['owner','admin']::app_role[]))
with check (has_org_role(organization_id, array['owner','admin']::app_role[]));

drop policy if exists "insert company expense cash impact" on company_cash_transactions;
create policy "insert company expense cash impact"
on company_cash_transactions
for insert
with check (
  type = 'vehicle_cost_paid'
  and source_expense_id is not null
  and source_vehicle_id is not null
  and has_org_role(organization_id, array['owner','admin','member']::app_role[])
);

drop policy if exists "update company expense cash impact" on company_cash_transactions;
create policy "update company expense cash impact"
on company_cash_transactions
for update
using (
  type = 'vehicle_cost_paid'
  and source_expense_id is not null
  and source_vehicle_id is not null
  and has_org_role(organization_id, array['owner','admin','member']::app_role[])
)
with check (
  type = 'vehicle_cost_paid'
  and source_expense_id is not null
  and source_vehicle_id is not null
  and has_org_role(organization_id, array['owner','admin','member']::app_role[])
);

drop policy if exists "insert external expense cash impact" on external_cash_transactions;
create policy "insert external expense cash impact"
on external_cash_transactions
for insert
with check (
  type = 'external_vehicle_expense_paid'
  and source_expense_id is not null
  and source_vehicle_id is not null
  and has_org_role(organization_id, array['owner','admin','member']::app_role[])
);

drop policy if exists "update external expense cash impact" on external_cash_transactions;
create policy "update external expense cash impact"
on external_cash_transactions
for update
using (
  type = 'external_vehicle_expense_paid'
  and source_expense_id is not null
  and source_vehicle_id is not null
  and has_org_role(organization_id, array['owner','admin','member']::app_role[])
)
with check (
  type = 'external_vehicle_expense_paid'
  and source_expense_id is not null
  and source_vehicle_id is not null
  and has_org_role(organization_id, array['owner','admin','member']::app_role[])
);

create index if not exists recurring_vehicle_expense_templates_org_idx
  on recurring_vehicle_expense_templates (organization_id, is_active, deleted_at);
create index if not exists vehicle_expenses_template_idx on vehicle_expenses (recurring_template_id);
create index if not exists company_cash_source_expense_idx on company_cash_transactions (source_expense_id);
create index if not exists external_cash_source_expense_idx on external_cash_transactions (source_expense_id);

drop trigger if exists set_recurring_vehicle_expense_templates_updated_at on recurring_vehicle_expense_templates;
create trigger set_recurring_vehicle_expense_templates_updated_at
before update on recurring_vehicle_expense_templates
for each row execute function set_updated_at();

create or replace function organization_company_cash_balance(org_id uuid)
returns numeric
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(
    case
      when type in ('company_cash_withdrawn', 'vehicle_cost_paid') then -amount
      else amount
    end
  ), 0)
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
  select coalesce(sum(
    case
      when type in ('external_cash_transferred_to_company', 'external_cash_personally_removed', 'external_vehicle_expense_paid') then -amount
      else amount
    end
  ), 0)
  from external_cash_transactions
  where organization_id = org_id
    and deleted_at is null;
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
  purchase_tax numeric(12,2);
  purchase_total numeric(12,2);
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
    coalesce(p_purchase_source, 'other'::purchase_source),
    coalesce(p_status, 'purchased'::vehicle_status),
    p_listed_price,
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning id into new_vehicle_id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'vehicle_created', 'vehicle', new_vehicle_id, 'Vehicle created', auth.uid());

  if coalesce(p_purchase_price, 0) > 0 then
    purchase_tax := round((p_purchase_price * 0.05)::numeric, 2);
    purchase_total := round((p_purchase_price + purchase_tax)::numeric, 2);

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
      0.05,
      purchase_tax,
      purchase_total,
      'company_cash',
      coalesce(p_purchase_date, current_date),
      'Automatic 5% purchase tax',
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
      'Vehicle purchase price and 5% tax',
      new_vehicle_id,
      new_expense_id,
      auth.uid()
    );

    insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
    values (p_organization_id, 'expense_added', 'vehicle', new_vehicle_id, 'Automatic 5% purchase tax', auth.uid());
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
