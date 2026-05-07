alter table company_cash_transactions
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references profiles(id),
  add column if not exists deletion_note text;

alter table external_cash_transactions
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references profiles(id),
  add column if not exists deletion_note text;

drop trigger if exists set_company_cash_updated_at on company_cash_transactions;
create trigger set_company_cash_updated_at
before update on company_cash_transactions
for each row execute function set_updated_at();

drop trigger if exists set_external_cash_updated_at on external_cash_transactions;
create trigger set_external_cash_updated_at
before update on external_cash_transactions
for each row execute function set_updated_at();

drop policy if exists "update company cash" on company_cash_transactions;
create policy "update company cash"
on company_cash_transactions
for update
using (has_org_role(organization_id, array['owner','admin']::app_role[]));

drop policy if exists "update external cash" on external_cash_transactions;
create policy "update external cash"
on external_cash_transactions
for update
using (has_org_role(organization_id, array['owner','admin']::app_role[]));
