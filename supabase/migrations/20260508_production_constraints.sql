do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_purchase_price_nonnegative') then
    alter table vehicles add constraint vehicles_purchase_price_nonnegative check (purchase_price >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vehicles_listed_price_nonnegative') then
    alter table vehicles add constraint vehicles_listed_price_nonnegative check (listed_price is null or listed_price >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vehicles_mileage_nonnegative') then
    alter table vehicles add constraint vehicles_mileage_nonnegative check (mileage is null or mileage >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'vehicle_expenses_amounts_valid') then
    alter table vehicle_expenses add constraint vehicle_expenses_amounts_valid
      check (amount_before_tax >= 0 and tax_rate >= 0 and tax_rate <= 1 and tax_amount >= 0 and total_amount >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'sales_amounts_valid') then
    alter table sales add constraint sales_amounts_valid
      check (
        vehicle_total_cost >= 0
        and taxable_profit_amount >= 0
        and profit_tax_due >= 0
        and paper_sale_price >= 0
        and real_client_payment >= 0
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'sales_one_per_vehicle') then
    alter table sales add constraint sales_one_per_vehicle unique (vehicle_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'company_cash_amount_positive') then
    alter table company_cash_transactions add constraint company_cash_amount_positive check (amount > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'company_cash_type_valid') then
    alter table company_cash_transactions add constraint company_cash_type_valid
      check (type in ('company_cash_added', 'company_cash_withdrawn', 'vehicle_cost_paid', 'paper_sale_received', 'external_transfer_received'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'external_cash_amount_positive') then
    alter table external_cash_transactions add constraint external_cash_amount_positive check (amount > 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'external_cash_type_valid') then
    alter table external_cash_transactions add constraint external_cash_type_valid
      check (type in ('external_commission_earned', 'external_cash_transferred_to_company', 'external_cash_personally_removed'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'contacts_budget_valid') then
    alter table contacts add constraint contacts_budget_valid
      check (
        (budget_min is null or budget_min >= 0)
        and (budget_max is null or budget_max >= 0)
        and (budget_min is null or budget_max is null or budget_min <= budget_max)
      );
  end if;
end $$;

create or replace function assert_vehicle_expense_org_match()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  vehicle_org uuid;
begin
  select organization_id into vehicle_org from vehicles where id = new.vehicle_id;
  if vehicle_org is null or vehicle_org <> new.organization_id then
    raise exception 'expense vehicle organization mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists vehicle_expenses_org_match on vehicle_expenses;
create trigger vehicle_expenses_org_match
before insert or update on vehicle_expenses
for each row execute function assert_vehicle_expense_org_match();

create or replace function assert_sale_org_match()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  vehicle_org uuid;
  contact_org uuid;
begin
  select organization_id into vehicle_org from vehicles where id = new.vehicle_id;
  if vehicle_org is null or vehicle_org <> new.organization_id then
    raise exception 'sale vehicle organization mismatch';
  end if;

  if new.contact_id is not null then
    select organization_id into contact_org from contacts where id = new.contact_id;
    if contact_org is null or contact_org <> new.organization_id then
      raise exception 'sale contact organization mismatch';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sales_org_match on sales;
create trigger sales_org_match
before insert or update on sales
for each row execute function assert_sale_org_match();

drop policy if exists "update sales" on sales;
create policy "update sales"
on sales
for update
using (has_org_role(organization_id, array['owner','admin','member']::app_role[]))
with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

