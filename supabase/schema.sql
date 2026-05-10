create extension if not exists "pgcrypto";

create type app_role as enum ('owner', 'admin', 'member', 'accountant', 'viewer');
create type vehicle_status as enum ('purchased', 'in_repair', 'listed_for_sale', 'sold');
create type purchase_source as enum ('OpenLane', 'dealerAuction', 'IAA', 'Copart', 'FacebookMarketplace', 'trade', 'other');
create type expense_category as enum ('vehicle_purchase_price', 'commission_plaque', 'auction_fee', 'transport', 'repair', 'inspection', 'detailing', 'parts', 'registration', 'storage', 'other');
create type contact_type as enum ('buyer', 'interested_in_buy_resell', 'export_contact', 'seller', 'partner', 'other');
create type attachment_type as enum ('file', 'photo', 'link');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_plate_commission_amount numeric(12,2) not null default 250,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role app_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  access_code text not null unique,
  default_role app_role not null default 'viewer',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vin text,
  year integer,
  make text,
  model text,
  trim text,
  color text,
  mileage integer,
  purchase_price numeric(12,2) not null default 0,
  purchase_date date,
  purchase_source purchase_source not null default 'other',
  status vehicle_status not null default 'purchased',
  listed_price numeric(12,2),
  notes text,
  main_photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table vehicle_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  recurring_template_id uuid,
  category expense_category not null,
  amount_before_tax numeric(12,2) not null default 0,
  tax_rate numeric(6,4) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  funding_source text not null default 'company_cash' check (funding_source in ('company_cash', 'external_cash')),
  date date not null default current_date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table recurring_vehicle_expense_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  category expense_category not null default 'other',
  amount_before_tax numeric(12,2) not null default 0,
  tax_behavior text not null default 'no_tax' check (tax_behavior in ('no_tax', 'add_15_percent', 'custom')),
  tax_rate numeric(6,4) not null default 0 check (tax_rate >= 0 and tax_rate <= 1),
  tax_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  default_funding_source text not null default 'company_cash' check (default_funding_source in ('company_cash', 'external_cash')),
  auto_apply_to_new_vehicles boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references profiles(id),
  check (amount_before_tax >= 0 and tax_amount >= 0 and total_amount >= 0)
);

alter table vehicle_expenses
  add constraint vehicle_expenses_recurring_template_fk
  foreign key (recurring_template_id) references recurring_vehicle_expense_templates(id);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  type contact_type not null default 'other',
  custom_type_description text,
  full_name text not null,
  phone text,
  email text,
  address text,
  notes text,
  desired_vehicle_types text,
  budget_min numeric(12,2),
  budget_max numeric(12,2),
  commission_agreement text,
  location text,
  follow_up_notes text,
  last_contacted_date date,
  export_region text,
  export_shipping_notes text,
  preferred_communication_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete restrict,
  contact_id uuid references contacts(id),
  sale_date date not null,
  vehicle_total_cost numeric(12,2) not null,
  taxable_profit_amount numeric(12,2) not null,
  profit_tax_due numeric(12,2) not null,
  paper_sale_price numeric(12,2) not null,
  real_client_payment numeric(12,2) not null,
  external_commission numeric(12,2) not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table company_cash_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  type text not null,
  amount numeric(12,2) not null,
  date date not null default current_date,
  note text,
  source_vehicle_id uuid references vehicles(id),
  source_expense_id uuid references vehicle_expenses(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references profiles(id),
  deletion_note text,
  created_by uuid references profiles(id)
);

create table external_cash_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  type text not null,
  amount numeric(12,2) not null,
  date date not null default current_date,
  note text,
  source_vehicle_id uuid references vehicles(id),
  source_expense_id uuid references vehicle_expenses(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references profiles(id),
  deletion_note text,
  created_by uuid references profiles(id)
);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  type attachment_type not null,
  title text not null,
  url_or_path text not null,
  vehicle_id uuid references vehicles(id) on delete cascade,
  expense_id uuid references vehicle_expenses(id) on delete cascade,
  sale_id uuid references sales(id) on delete cascade,
  contact_id uuid references contacts(id) on delete cascade,
  company_cash_transaction_id uuid references company_cash_transactions(id) on delete cascade,
  external_cash_transaction_id uuid references external_cash_transactions(id) on delete cascade,
  notes text,
  is_sensitive boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table tax_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tax_year integer not null,
  quarter text,
  month text,
  start_date date not null,
  end_date date not null,
  report_json jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table backup_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  destination text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references profiles(id)
);

create table backup_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  backup_job_id uuid references backup_jobs(id) on delete cascade,
  storage_path text not null,
  file_size_bytes bigint,
  checksum text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table activity_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  selected_language text not null default 'en',
  active_organization_id uuid references organizations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at before update on profiles for each row execute function set_updated_at();
create trigger set_organizations_updated_at before update on organizations for each row execute function set_updated_at();
create trigger set_memberships_updated_at before update on organization_memberships for each row execute function set_updated_at();
create trigger set_vehicles_updated_at before update on vehicles for each row execute function set_updated_at();
create trigger set_expenses_updated_at before update on vehicle_expenses for each row execute function set_updated_at();
create trigger set_recurring_vehicle_expense_templates_updated_at before update on recurring_vehicle_expense_templates for each row execute function set_updated_at();
create trigger set_contacts_updated_at before update on contacts for each row execute function set_updated_at();
create trigger set_sales_updated_at before update on sales for each row execute function set_updated_at();
create trigger set_company_cash_updated_at before update on company_cash_transactions for each row execute function set_updated_at();
create trigger set_external_cash_updated_at before update on external_cash_transactions for each row execute function set_updated_at();
create trigger set_preferences_updated_at before update on user_preferences for each row execute function set_updated_at();

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do update set full_name = excluded.full_name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

create or replace function create_organization_with_owner(organization_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
  new_code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if trim(coalesce(organization_name, '')) = '' then
    raise exception 'organization name is required';
  end if;

  insert into profiles (id)
  values (auth.uid())
  on conflict (id) do nothing;

  insert into organizations (name, created_by)
  values (organization_name, auth.uid())
  returning id into new_org_id;

  insert into organization_memberships (organization_id, user_id, role)
  values (new_org_id, auth.uid(), 'owner');

  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into organization_invitations (organization_id, access_code, default_role, created_by)
  values (new_org_id, new_code, 'viewer', auth.uid());

  insert into user_preferences (user_id, active_organization_id)
  values (auth.uid(), new_org_id)
  on conflict (user_id) do update set active_organization_id = excluded.active_organization_id;

  return new_org_id;
end;
$$;

create or replace function join_organization_by_access_code(invitation_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into invitation
  from organization_invitations
  where upper(access_code) = upper(trim(invitation_code))
    and (expires_at is null or expires_at > now())
  limit 1;

  if invitation.id is null then
    raise exception 'invalid or expired invitation code';
  end if;

  insert into profiles (id)
  values (auth.uid())
  on conflict (id) do nothing;

  insert into organization_memberships (organization_id, user_id, role)
  values (invitation.organization_id, auth.uid(), 'viewer')
  on conflict (organization_id, user_id) do update
    set role = organization_memberships.role,
        updated_at = now();

  insert into user_preferences (user_id, active_organization_id)
  values (auth.uid(), invitation.organization_id)
  on conflict (user_id) do update set active_organization_id = excluded.active_organization_id;

  return invitation.organization_id;
end;
$$;

create or replace function delete_vehicle_expense(expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  expense_record record;
begin
  select * into expense_record
  from vehicle_expenses
  where id = expense_id;

  if expense_record.id is null then
    raise exception 'expense not found';
  end if;

  if not has_org_role(expense_record.organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
  end if;

  delete from vehicle_expenses
  where id = expense_id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    expense_record.organization_id,
    'expense_deleted',
    'vehicle',
    expense_record.vehicle_id,
    'Expense deleted',
    auth.uid()
  );
end;
$$;

create or replace function is_org_member(target_org uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_memberships
    where organization_id = target_org and user_id = auth.uid()
  );
$$;

create or replace function has_org_role(target_org uuid, allowed_roles app_role[])
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_memberships
    where organization_id = target_org
      and user_id = auth.uid()
      and role = any(allowed_roles)
  );
$$;

alter table profiles enable row level security;
alter table organizations enable row level security;
alter table organization_memberships enable row level security;
alter table organization_invitations enable row level security;
alter table vehicles enable row level security;
alter table vehicle_expenses enable row level security;
alter table recurring_vehicle_expense_templates enable row level security;
alter table contacts enable row level security;
alter table sales enable row level security;
alter table company_cash_transactions enable row level security;
alter table external_cash_transactions enable row level security;
alter table attachments enable row level security;
alter table tax_reports enable row level security;
alter table backup_jobs enable row level security;
alter table backup_files enable row level security;
alter table activity_logs enable row level security;
alter table user_preferences enable row level security;

create policy "profiles own row" on profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "members read orgs" on organizations for select using (is_org_member(id));
create policy "owners update orgs" on organizations for update using (has_org_role(id, array['owner']::app_role[]));
create policy "owners delete orgs" on organizations for delete using (has_org_role(id, array['owner']::app_role[]));
create policy "authenticated create orgs" on organizations for insert with check (auth.uid() = created_by);

create policy "members read memberships" on organization_memberships for select using (is_org_member(organization_id));
create policy "owners manage memberships" on organization_memberships for all using (has_org_role(organization_id, array['owner']::app_role[])) with check (has_org_role(organization_id, array['owner']::app_role[]));

create policy "admins manage invitations" on organization_invitations for all using (has_org_role(organization_id, array['owner','admin']::app_role[])) with check (has_org_role(organization_id, array['owner','admin']::app_role[]));

create policy "member read vehicles" on vehicles for select using (is_org_member(organization_id));
create policy "member write vehicles" on vehicles for insert with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "member update vehicles" on vehicles for update using (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

create policy "read expenses" on vehicle_expenses for select using (is_org_member(organization_id));
create policy "write expenses" on vehicle_expenses for insert with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "update expenses" on vehicle_expenses for update using (has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "read recurring vehicle expense templates" on recurring_vehicle_expense_templates for select using (is_org_member(organization_id));
create policy "insert recurring vehicle expense templates" on recurring_vehicle_expense_templates for insert with check (has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "update recurring vehicle expense templates" on recurring_vehicle_expense_templates for update using (has_org_role(organization_id, array['owner','admin']::app_role[])) with check (has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "delete expenses" on vehicle_expenses for delete using (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

create policy "read contacts" on contacts for select using (is_org_member(organization_id));
create policy "write contacts" on contacts for insert with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "update contacts" on contacts for update using (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

create policy "read sales" on sales for select using (is_org_member(organization_id));
create policy "write sales" on sales for insert with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

create policy "read company cash" on company_cash_transactions for select using (is_org_member(organization_id));
create policy "write company cash" on company_cash_transactions for insert with check (has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "insert company expense cash impact" on company_cash_transactions for insert with check (type = 'vehicle_cost_paid' and source_expense_id is not null and source_vehicle_id is not null and has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "update company cash" on company_cash_transactions for update using (has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "update company expense cash impact" on company_cash_transactions for update using (type = 'vehicle_cost_paid' and source_expense_id is not null and source_vehicle_id is not null and has_org_role(organization_id, array['owner','admin','member']::app_role[])) with check (type = 'vehicle_cost_paid' and source_expense_id is not null and source_vehicle_id is not null and has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "read external cash" on external_cash_transactions for select using (is_org_member(organization_id));
create policy "write external cash" on external_cash_transactions for insert with check (has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "insert external expense cash impact" on external_cash_transactions for insert with check (type = 'external_vehicle_expense_paid' and source_expense_id is not null and source_vehicle_id is not null and has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "update external cash" on external_cash_transactions for update using (has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "update external expense cash impact" on external_cash_transactions for update using (type = 'external_vehicle_expense_paid' and source_expense_id is not null and source_vehicle_id is not null and has_org_role(organization_id, array['owner','admin','member']::app_role[])) with check (type = 'external_vehicle_expense_paid' and source_expense_id is not null and source_vehicle_id is not null and has_org_role(organization_id, array['owner','admin','member']::app_role[]));

create policy "read attachments" on attachments for select using (is_org_member(organization_id));
create policy "write attachments" on attachments for insert with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "delete sensitive attachments" on attachments for delete using (has_org_role(organization_id, array['owner','admin']::app_role[]));

create policy "read financial reports" on tax_reports for select using (has_org_role(organization_id, array['owner','admin','accountant']::app_role[]));
create policy "write financial reports" on tax_reports for insert with check (has_org_role(organization_id, array['owner','admin','accountant']::app_role[]));
create policy "read backups" on backup_jobs for select using (has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "write backups" on backup_jobs for insert with check (has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "read backup files" on backup_files for select using (has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "write backup files" on backup_files for insert with check (has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "read activity" on activity_logs for select using (is_org_member(organization_id));
create policy "write activity" on activity_logs for insert with check (is_org_member(organization_id));
create policy "own preferences" on user_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index vehicles_org_status_idx on vehicles (organization_id, status);
create index expenses_org_vehicle_idx on vehicle_expenses (organization_id, vehicle_id);
create index recurring_vehicle_expense_templates_org_idx on recurring_vehicle_expense_templates (organization_id, is_active, deleted_at);
create index vehicle_expenses_template_idx on vehicle_expenses (recurring_template_id);
create index sales_org_vehicle_idx on sales (organization_id, vehicle_id);
create index contacts_org_type_idx on contacts (organization_id, type);
create index attachments_org_vehicle_idx on attachments (organization_id, vehicle_id);
create index company_cash_org_date_idx on company_cash_transactions (organization_id, date);
create index external_cash_org_date_idx on external_cash_transactions (organization_id, date);
create index company_cash_source_expense_idx on company_cash_transactions (source_expense_id);
create index external_cash_source_expense_idx on external_cash_transactions (source_expense_id);
create index activity_org_date_idx on activity_logs (organization_id, created_at);

insert into storage.buckets (id, name, public)
values ('dealer-flow-private', 'dealer-flow-private', false)
on conflict (id) do update set public = false;

create policy "members read private organization files"
on storage.objects for select
using (
  bucket_id = 'dealer-flow-private'
  and (storage.foldername(name))[1] = 'organizations'
  and is_org_member(((storage.foldername(name))[2])::uuid)
);

create policy "members upload private organization files"
on storage.objects for insert
with check (
  bucket_id = 'dealer-flow-private'
  and (storage.foldername(name))[1] = 'organizations'
  and has_org_role(((storage.foldername(name))[2])::uuid, array['owner','admin','member']::app_role[])
);

create policy "admins delete private organization files"
on storage.objects for delete
using (
  bucket_id = 'dealer-flow-private'
  and (storage.foldername(name))[1] = 'organizations'
  and has_org_role(((storage.foldername(name))[2])::uuid, array['owner','admin']::app_role[])
);
