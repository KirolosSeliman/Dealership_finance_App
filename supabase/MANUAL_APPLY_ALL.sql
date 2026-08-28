
-- ============================================================================
-- MANUAL SECTION: supabase/schema.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
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
  vin text not null default '' check (vin = '' or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
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
  archived_at timestamptz,
  archived_by uuid references profiles(id),
  archive_reason text,
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
  voided_at timestamptz,
  voided_by uuid references profiles(id),
  void_reason text,
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
  status text not null default 'active' check (status in ('active', 'voided', 'corrected')),
  voided_at timestamptz,
  voided_by uuid references profiles(id),
  void_reason text,
  corrected_by_sale_id uuid references sales(id),
  correction_of_sale_id uuid references sales(id),
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
  source_sale_id uuid references sales(id),
  transfer_pair_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references profiles(id),
  deletion_note text,
  reversed_transaction_id uuid references company_cash_transactions(id),
  correction_of_transaction_id uuid references company_cash_transactions(id),
  voided_at timestamptz,
  voided_by uuid references profiles(id),
  void_reason text,
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
  source_sale_id uuid references sales(id),
  transfer_pair_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references profiles(id),
  deletion_note text,
  reversed_transaction_id uuid references external_cash_transactions(id),
  correction_of_transaction_id uuid references external_cash_transactions(id),
  voided_at timestamptz,
  voided_by uuid references profiles(id),
  void_reason text,
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
begin
  raise exception 'delete_vehicle_expense is deprecated. Use void_vehicle_expense_with_cash_reversal.';
end;
$$;

drop function if exists delete_vehicle_and_related_data(uuid, uuid);

create or replace function delete_vehicle_and_related_data(
  p_organization_id uuid,
  p_vehicle_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  sale_ids uuid[] := '{}'::uuid[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
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

  select coalesce(array_agg(id), '{}'::uuid[])
  into sale_ids
  from sales
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  delete from tax_reports
  where organization_id = p_organization_id
    and report_json::text ilike ('%' || p_vehicle_id::text || '%');

  delete from attachments
  where organization_id = p_organization_id
    and (
      vehicle_id = p_vehicle_id
      or expense_id in (
        select id
        from vehicle_expenses
        where organization_id = p_organization_id
          and vehicle_id = p_vehicle_id
      )
      or sale_id = any(sale_ids)
      or company_cash_transaction_id in (
        select id
        from company_cash_transactions
        where organization_id = p_organization_id
          and source_vehicle_id = p_vehicle_id
      )
      or external_cash_transaction_id in (
        select id
        from external_cash_transactions
        where organization_id = p_organization_id
          and source_vehicle_id = p_vehicle_id
      )
    );

  delete from company_cash_transactions
  where organization_id = p_organization_id
    and (
      source_vehicle_id = p_vehicle_id
      or source_expense_id in (
        select id
        from vehicle_expenses
        where organization_id = p_organization_id
          and vehicle_id = p_vehicle_id
      )
    );

  delete from external_cash_transactions
  where organization_id = p_organization_id
    and (
      source_vehicle_id = p_vehicle_id
      or source_expense_id in (
        select id
        from vehicle_expenses
        where organization_id = p_organization_id
          and vehicle_id = p_vehicle_id
      )
    );

  delete from sales
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  delete from vehicle_expenses
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  delete from activity_logs
  where organization_id = p_organization_id
    and (
      (entity_type = 'vehicle' and entity_id = p_vehicle_id)
      or (entity_type = 'sale' and entity_id = any(sale_ids))
    );

  delete from vehicles
  where id = p_vehicle_id
    and organization_id = p_organization_id;
end;
$$;

revoke all on function delete_vehicle_and_related_data(uuid, uuid) from public;
grant execute on function delete_vehicle_and_related_data(uuid, uuid) to authenticated;

create or replace function archive_vehicle(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  clean_reason text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
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

  if vehicle_record.archived_at is not null then
    raise exception 'vehicle already archived';
  end if;

  clean_reason := nullif(left(trim(coalesce(p_reason, '')), 500), '');

  update vehicles
  set archived_at = now(),
      archived_by = auth.uid(),
      archive_reason = clean_reason,
      updated_at = now()
  where id = p_vehicle_id
    and organization_id = p_organization_id;

  insert into activity_logs (
    organization_id,
    action,
    entity_type,
    entity_id,
    message,
    created_by
  )
  values (
    p_organization_id,
    'vehicle_archived',
    'vehicle',
    p_vehicle_id,
    'Vehicle archived. Financial, tax, sale, cash, attachment, and activity records were preserved.' ||
      case when clean_reason is null then '' else ' Reason: ' || clean_reason end,
    auth.uid()
  );
end;
$$;

revoke all on function archive_vehicle(uuid, uuid, text) from public;
grant execute on function archive_vehicle(uuid, uuid, text) to authenticated;

create or replace function delete_vehicle_and_related_data(
  p_organization_id uuid,
  p_vehicle_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'delete_vehicle_and_related_data is deprecated. Use archive_vehicle to preserve financial history.';
end;
$$;

revoke all on function delete_vehicle_and_related_data(uuid, uuid) from public;
grant execute on function delete_vehicle_and_related_data(uuid, uuid) to authenticated;

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

create policy "read contacts" on contacts for select using (is_org_member(organization_id));
create policy "write contacts" on contacts for insert with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "update contacts" on contacts for update using (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

create policy "read sales" on sales for select using (is_org_member(organization_id));
create policy "write sales" on sales for insert with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

create policy "read company cash" on company_cash_transactions for select using (is_org_member(organization_id));
create policy "insert manual company cash" on company_cash_transactions for insert with check (
  type in ('company_cash_added', 'company_cash_withdrawn')
  and source_vehicle_id is null
  and source_expense_id is null
  and source_sale_id is null
  and transfer_pair_id is null
  and correction_of_transaction_id is null
  and reversed_transaction_id is null
  and voided_at is null
  and has_org_role(organization_id, array['owner','admin']::app_role[])
);
create policy "read external cash" on external_cash_transactions for select using (is_org_member(organization_id));
create policy "insert manual external cash" on external_cash_transactions for insert with check (
  type in ('external_cash_added', 'external_cash_personally_removed')
  and source_vehicle_id is null
  and source_expense_id is null
  and source_sale_id is null
  and transfer_pair_id is null
  and correction_of_transaction_id is null
  and reversed_transaction_id is null
  and voided_at is null
  and has_org_role(organization_id, array['owner','admin']::app_role[])
);

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
create index vehicles_org_active_status_idx on vehicles (organization_id, status) where archived_at is null;
create unique index vehicles_org_active_vin_unique_idx
  on vehicles (organization_id, upper(regexp_replace(vin, '\s+', '', 'g')))
  where archived_at is null and upper(regexp_replace(vin, '\s+', '', 'g')) <> '';
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


-- ============================================================================
-- MANUAL SECTION: supabase/20260507_cash_transaction_edit_delete.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
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


-- ============================================================================
-- MANUAL SECTION: supabase/20260507_commission_plaque.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
alter type expense_category add value if not exists 'commission_plaque' after 'vehicle_purchase_price';

alter table organizations
  add column if not exists default_plate_commission_amount numeric(12,2) not null default 250;

update organizations
set default_plate_commission_amount = 250
where default_plate_commission_amount is null;


-- ============================================================================
-- MANUAL SECTION: supabase/20260507_sales_member_policy.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
drop policy if exists "write sales" on sales;

create policy "write sales"
on sales
for insert
with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260507_sales_member_policy.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
drop policy if exists "write sales" on sales;

create policy "write sales"
on sales
for insert
with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));



-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260508_attachment_security.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
create or replace function assert_attachment_org_match()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  related_org uuid;
begin
  if new.vehicle_id is not null then
    select organization_id into related_org from vehicles where id = new.vehicle_id;
    if related_org is null or related_org <> new.organization_id then
      raise exception 'attachment vehicle organization mismatch';
    end if;
  end if;

  if new.expense_id is not null then
    select organization_id into related_org from vehicle_expenses where id = new.expense_id;
    if related_org is null or related_org <> new.organization_id then
      raise exception 'attachment expense organization mismatch';
    end if;
  end if;

  if new.sale_id is not null then
    select organization_id into related_org from sales where id = new.sale_id;
    if related_org is null or related_org <> new.organization_id then
      raise exception 'attachment sale organization mismatch';
    end if;
  end if;

  if new.contact_id is not null then
    select organization_id into related_org from contacts where id = new.contact_id;
    if related_org is null or related_org <> new.organization_id then
      raise exception 'attachment contact organization mismatch';
    end if;
  end if;

  if new.company_cash_transaction_id is not null then
    select organization_id into related_org from company_cash_transactions where id = new.company_cash_transaction_id;
    if related_org is null or related_org <> new.organization_id then
      raise exception 'attachment company cash organization mismatch';
    end if;
  end if;

  if new.external_cash_transaction_id is not null then
    select organization_id into related_org from external_cash_transactions where id = new.external_cash_transaction_id;
    if related_org is null or related_org <> new.organization_id then
      raise exception 'attachment external cash organization mismatch';
    end if;
  end if;

  if new.type in ('file', 'photo') and new.url_or_path not like ('organizations/' || new.organization_id::text || '/%') then
    raise exception 'private file path must be scoped to the organization';
  end if;

  if new.type = 'link' and new.url_or_path !~* '^https?://' then
    raise exception 'links must use http or https';
  end if;

  return new;
end;
$$;

drop trigger if exists attachments_org_match on attachments;
create trigger attachments_org_match
before insert or update on attachments
for each row execute function assert_attachment_org_match();



-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260508_p0_atomic_security.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
create or replace function assert_final_owner_preserved()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  remaining_owner_count integer;
begin
  if tg_op = 'UPDATE' and old.role <> 'owner' then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;

  select count(*) into remaining_owner_count
  from organization_memberships
  where organization_id = old.organization_id
    and role = 'owner'
    and id <> old.id;

  if remaining_owner_count = 0 then
    raise exception 'an organization must keep at least one owner';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists organization_memberships_final_owner on organization_memberships;
create trigger organization_memberships_final_owner
before update or delete on organization_memberships
for each row execute function assert_final_owner_preserved();

drop policy if exists "read attachments" on attachments;
create policy "read attachments"
on attachments
for select
using (
  (
    is_sensitive = false
    and is_org_member(organization_id)
  )
  or has_org_role(organization_id, array['owner','admin','member']::app_role[])
);

drop policy if exists "members read private organization files" on storage.objects;
create policy "operational roles read private organization files"
on storage.objects for select
using (
  bucket_id = 'dealer-flow-private'
  and (storage.foldername(name))[1] = 'organizations'
  and has_org_role(((storage.foldername(name))[2])::uuid, array['owner','admin','member']::app_role[])
);

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
  purchase_tax numeric(12,2);
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

  if coalesce(p_purchase_price, 0) > 0 then
    purchase_tax := round((p_purchase_price * 0.05)::numeric, 2);
    insert into vehicle_expenses (
      organization_id,
      vehicle_id,
      category,
      amount_before_tax,
      tax_rate,
      tax_amount,
      total_amount,
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
      round((p_purchase_price + purchase_tax)::numeric, 2),
      coalesce(p_purchase_date, current_date),
      'Automatic 5% purchase tax',
      auth.uid()
    );
  end if;


  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'vehicle_created', 'vehicle', new_vehicle_id, 'Vehicle created', auth.uid());

  if coalesce(p_purchase_price, 0) > 0 then
    insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
    values (p_organization_id, 'expense_added', 'vehicle', new_vehicle_id, 'Automatic 5% purchase tax', auth.uid());
  end if;


  return new_vehicle_id;
end;
$$;

create or replace function record_vehicle_sale_atomic(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_sale_date date,
  p_taxable_profit_amount numeric,
  p_real_client_payment numeric,
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
  vehicle_total_cost numeric(12,2);
  paper_sale_price numeric(12,2);
  profit_tax_due numeric(12,2);
  external_commission numeric(12,2);
  buyer_contact_id uuid;
  sale_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
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

  if exists (select 1 from sales where vehicle_id = p_vehicle_id) then
    raise exception 'this vehicle already has a sale record';
  end if;

  select round((
    vehicle_record.purchase_price
    + coalesce(sum(
      case
        when category = 'vehicle_purchase_price' and vehicle_record.purchase_price > 0 then tax_amount
        else total_amount
      end
    ), 0)
  )::numeric, 2)
  into vehicle_total_cost
  from vehicle_expenses
  where vehicle_id = p_vehicle_id
    and organization_id = p_organization_id;

  paper_sale_price := round((vehicle_total_cost + coalesce(p_taxable_profit_amount, 0))::numeric, 2);
  profit_tax_due := round((coalesce(p_taxable_profit_amount, 0) * 0.22)::numeric, 2);
  external_commission := round((coalesce(p_real_client_payment, 0) - paper_sale_price)::numeric, 2);

  if external_commission < 0 then
    raise exception 'real client payment cannot be lower than the paper sale price';
  end if;

  if nullif(trim(coalesce(p_buyer_name, '')), '') is not null then
    insert into contacts (
      organization_id,
      type,
      full_name,
      phone,
      email,
      address,
      notes,
      created_by
    )
    values (
      p_organization_id,
      'buyer',
      trim(p_buyer_name),
      nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_email, '')), ''),
      nullif(trim(coalesce(p_address, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''),
      auth.uid()
    )
    returning id into buyer_contact_id;

    insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
    values (p_organization_id, 'contact_created', 'contact', buyer_contact_id, trim(p_buyer_name), auth.uid());
  end if;

  insert into sales (
    organization_id,
    vehicle_id,
    contact_id,
    sale_date,
    vehicle_total_cost,
    taxable_profit_amount,
    profit_tax_due,
    paper_sale_price,
    real_client_payment,
    external_commission,
    notes,
    created_by
  )
  values (
    p_organization_id,
    p_vehicle_id,
    buyer_contact_id,
    coalesce(p_sale_date, current_date),
    vehicle_total_cost,
    coalesce(p_taxable_profit_amount, 0),
    profit_tax_due,
    paper_sale_price,
    coalesce(p_real_client_payment, 0),
    external_commission,
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning id into sale_id;

  update vehicles
  set status = 'sold',
      updated_at = now()
  where id = p_vehicle_id
    and organization_id = p_organization_id;

  if paper_sale_price > 0 then
    insert into company_cash_transactions (
      organization_id,
      type,
      amount,
      date,
      note,
      source_vehicle_id,
      created_by
    )
    values (
      p_organization_id,
      'paper_sale_received',
      paper_sale_price,
      coalesce(p_sale_date, current_date),
      'Paper sale received',
      p_vehicle_id,
      auth.uid()
    );
  end if;

  if external_commission > 0 then
    insert into external_cash_transactions (
      organization_id,
      type,
      amount,
      date,
      note,
      source_vehicle_id,
      created_by
    )
    values (
      p_organization_id,
      'external_commission_earned',
      external_commission,
      coalesce(p_sale_date, current_date),
      'External commission earned',
      p_vehicle_id,
      auth.uid()
    );
  end if;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'vehicle_sold', 'vehicle', p_vehicle_id, 'Sale recorded', auth.uid());

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'cash_transaction_created', 'vehicle', p_vehicle_id, 'Sale cash transactions generated', auth.uid());

  return sale_id;
end;
$$;




-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260508_production_constraints.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
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



-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260509_membership_role_resolution.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
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

do $$
begin
  if exists (
    select 1
    from organization_memberships
    group by organization_id, user_id
    having count(*) > 1
  ) then
    raise notice 'Duplicate organization memberships exist. The app now resolves the highest role safely, but run the diagnostic SQL and manually clean duplicates before adding the unique constraint.';
  elsif not exists (
    select 1
    from pg_constraint
    where conname = 'organization_memberships_organization_id_user_id_key'
  ) then
    alter table organization_memberships
      add constraint organization_memberships_organization_id_user_id_key unique (organization_id, user_id);
  end if;
end $$;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260509_recurring_expenses_funding_source.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
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


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260510_delete_vehicle_cascade.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
create or replace function delete_vehicle_and_related_data(
  p_organization_id uuid,
  p_vehicle_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  sale_ids uuid[] := '{}'::uuid[];
  contact_ids uuid[] := '{}'::uuid[];
  v_contact_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
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

  select coalesce(array_agg(id), '{}'::uuid[])
  into sale_ids
  from sales
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  select coalesce(array_agg(distinct contact_id), '{}'::uuid[])
  into contact_ids
  from sales
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id
    and contact_id is not null;

  delete from tax_reports
  where organization_id = p_organization_id
    and report_json::text ilike ('%' || p_vehicle_id::text || '%');

  delete from activity_logs
  where organization_id = p_organization_id
    and (
      (entity_type = 'vehicle' and entity_id = p_vehicle_id)
      or (entity_type = 'sale' and entity_id = any(sale_ids))
      or (entity_type = 'contact' and entity_id = any(contact_ids))
    );

  delete from attachments
  where organization_id = p_organization_id
    and (
      vehicle_id = p_vehicle_id
      or expense_id in (
        select id
        from vehicle_expenses
        where organization_id = p_organization_id
          and vehicle_id = p_vehicle_id
      )
      or sale_id = any(sale_ids)
      or company_cash_transaction_id in (
        select id
        from company_cash_transactions
        where organization_id = p_organization_id
          and source_vehicle_id = p_vehicle_id
      )
      or external_cash_transaction_id in (
        select id
        from external_cash_transactions
        where organization_id = p_organization_id
          and source_vehicle_id = p_vehicle_id
      )
    );

  delete from company_cash_transactions
  where organization_id = p_organization_id
    and (
      source_vehicle_id = p_vehicle_id
      or source_expense_id in (
        select id
        from vehicle_expenses
        where organization_id = p_organization_id
          and vehicle_id = p_vehicle_id
      )
    );

  delete from external_cash_transactions
  where organization_id = p_organization_id
    and (
      source_vehicle_id = p_vehicle_id
      or source_expense_id in (
        select id
        from vehicle_expenses
        where organization_id = p_organization_id
          and vehicle_id = p_vehicle_id
      )
    );

  delete from sales
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  delete from vehicle_expenses
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  foreach v_contact_id in array contact_ids loop
    if exists (
      select 1
      from sales
      where organization_id = p_organization_id
        and contact_id = v_contact_id
        and vehicle_id <> p_vehicle_id
    ) then
      continue;
    end if;

    if exists (
      select 1
      from attachments
      where organization_id = p_organization_id
        and contact_id = v_contact_id
        and (
          vehicle_id is null
          or vehicle_id <> p_vehicle_id
        )
        and (
          sale_id is null
          or sale_id <> all(sale_ids)
        )
    ) then
      continue;
    end if;

    delete from attachments
    where organization_id = p_organization_id
      and contact_id = v_contact_id;

    delete from contacts
    where id = v_contact_id
      and organization_id = p_organization_id;
  end loop;

  delete from vehicles
  where id = p_vehicle_id
    and organization_id = p_organization_id;
end;
$$;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260510_delete_vehicle_cascade_hardening.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
drop function if exists delete_vehicle_and_related_data(uuid, uuid);

create or replace function delete_vehicle_and_related_data(
  p_organization_id uuid,
  p_vehicle_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  sale_ids uuid[] := '{}'::uuid[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
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

  select coalesce(array_agg(id), '{}'::uuid[])
  into sale_ids
  from sales
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  delete from tax_reports
  where organization_id = p_organization_id
    and report_json::text ilike ('%' || p_vehicle_id::text || '%');

  delete from attachments
  where organization_id = p_organization_id
    and (
      vehicle_id = p_vehicle_id
      or expense_id in (
        select id
        from vehicle_expenses
        where organization_id = p_organization_id
          and vehicle_id = p_vehicle_id
      )
      or sale_id = any(sale_ids)
      or company_cash_transaction_id in (
        select id
        from company_cash_transactions
        where organization_id = p_organization_id
          and source_vehicle_id = p_vehicle_id
      )
      or external_cash_transaction_id in (
        select id
        from external_cash_transactions
        where organization_id = p_organization_id
          and source_vehicle_id = p_vehicle_id
      )
    );

  delete from company_cash_transactions
  where organization_id = p_organization_id
    and (
      source_vehicle_id = p_vehicle_id
      or source_expense_id in (
        select id
        from vehicle_expenses
        where organization_id = p_organization_id
          and vehicle_id = p_vehicle_id
      )
    );

  delete from external_cash_transactions
  where organization_id = p_organization_id
    and (
      source_vehicle_id = p_vehicle_id
      or source_expense_id in (
        select id
        from vehicle_expenses
        where organization_id = p_organization_id
          and vehicle_id = p_vehicle_id
      )
    );

  delete from sales
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  delete from vehicle_expenses
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  delete from activity_logs
  where organization_id = p_organization_id
    and (
      (entity_type = 'vehicle' and entity_id = p_vehicle_id)
      or (entity_type = 'sale' and entity_id = any(sale_ids))
    );

  delete from vehicles
  where id = p_vehicle_id
    and organization_id = p_organization_id;
end;
$$;

revoke all on function delete_vehicle_and_related_data(uuid, uuid) from public;
grant execute on function delete_vehicle_and_related_data(uuid, uuid) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260510_market_snap_foundation.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
create type market_snap_market_type as enum (
  'clean_retail_market',
  'clean_wholesale_market',
  'auction_market',
  'salvage_auction_market',
  'rebuilt_market',
  'parts_or_non_running_market'
);

create type market_snap_recommendation_badge as enum ('Strong Buy', 'Negotiate', 'Avoid', 'High Risk');
create type market_snap_estimator_type as enum ('comparable_estimator', 'catboost', 'fallback_estimator');
create type market_snap_source_type as enum ('retail', 'wholesale', 'auction', 'salvage', 'import', 'extension');
create type market_snap_job_status as enum ('pending', 'running', 'succeeded', 'failed', 'skipped');

create table market_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  source_type market_snap_source_type not null,
  status text not null default 'active' check (status in ('active', 'paused', 'error')),
  default_market_type market_snap_market_type not null default 'clean_retail_market',
  source_reliability_score integer not null default 65 check (source_reliability_score between 0 and 100),
  fee_rules jsonb not null default '{}'::jsonb,
  retention_days integer not null default 365,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  unique (organization_id, name)
);

create table market_listings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  source_id uuid references market_sources(id) on delete set null,
  source_name text not null,
  source_type market_snap_source_type not null default 'retail',
  listing_url text,
  source_listing_id text,
  title text,
  year integer,
  make text,
  model text,
  trim text,
  mileage_km integer,
  listed_price numeric(12,2),
  original_price numeric(12,2),
  auction_hammer_price numeric(12,2),
  location text,
  province text,
  seller_type text,
  title_status text not null default 'unknown',
  market_type market_snap_market_type not null default 'clean_retail_market',
  normalized_payload jsonb not null default '{}'::jsonb,
  sanitized_raw_payload jsonb,
  data_quality_score integer not null default 50 check (data_quality_score between 0 and 100),
  source_reliability_score integer not null default 65 check (source_reliability_score between 0 and 100),
  time_decay_weight numeric(8,5) not null default 1,
  sample_weight numeric(8,5) not null default 1,
  is_saved_to_deal_radar boolean not null default false,
  captured_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table market_listing_features (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  market_listing_id uuid not null references market_listings(id) on delete cascade,
  image_count integer not null default 0,
  photo_quality_score integer not null default 0,
  has_front_photo boolean not null default false,
  has_rear_photo boolean not null default false,
  has_left_side_photo boolean not null default false,
  has_right_side_photo boolean not null default false,
  has_interior_photo boolean not null default false,
  has_dashboard_photo boolean not null default false,
  has_odometer_photo boolean not null default false,
  has_engine_bay_photo boolean not null default false,
  has_underbody_photo boolean not null default false,
  visual_condition_score integer not null default 0,
  rust_visible_score integer not null default 0,
  damage_visible_score integer not null default 0,
  odometer_detected boolean not null default false,
  odometer_reading_extracted integer,
  rust_detected boolean,
  rust_severity text not null default 'unknown',
  cosmetic_damage_detected boolean,
  cosmetic_damage_severity text not null default 'unknown',
  mechanical_issue_detected boolean,
  mechanical_issue_severity text not null default 'unknown',
  diagnostic_codes_available boolean not null default false,
  obd_codes jsonb not null default '[]'::jsonb,
  code_severity_score integer not null default 0,
  estimated_repair_cost_from_codes numeric(12,2) not null default 0,
  photo_analysis_status text not null default 'not_processed',
  image_processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table deal_radar_saved_listings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  market_listing_id uuid references market_listings(id) on delete set null,
  source_name text not null,
  listing_url text,
  title text,
  year integer,
  make text,
  model text,
  trim text,
  mileage_km integer,
  listed_price numeric(12,2),
  market_type market_snap_market_type not null,
  normalized_payload jsonb not null default '{}'::jsonb,
  valuation_snapshot jsonb not null default '{}'::jsonb,
  recommendation_badge market_snap_recommendation_badge not null default 'Negotiate',
  deal_score integer not null default 0 check (deal_score between 0 and 100),
  profit_score integer not null default 0 check (profit_score between 0 and 100),
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  confidence_score integer not null default 0 check (confidence_score between 0 and 100),
  potential_profit numeric(12,2) not null default 0,
  converted_vehicle_id uuid references vehicles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table vehicle_valuations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete cascade,
  deal_radar_listing_id uuid references deal_radar_saved_listings(id) on delete set null,
  market_type market_snap_market_type not null,
  estimated_retail_market_value numeric(12,2) not null default 0,
  estimated_wholesale_buy_value numeric(12,2) not null default 0,
  estimated_wholesale_sell_value numeric(12,2) not null default 0,
  suggested_listing_price numeric(12,2) not null default 0,
  quick_sale_price numeric(12,2) not null default 0,
  max_recommended_purchase_price numeric(12,2) not null default 0,
  max_recommended_bid numeric(12,2) not null default 0,
  estimated_total_acquisition_cost numeric(12,2) not null default 0,
  current_cost_basis numeric(12,2) not null default 0,
  potential_gross_profit numeric(12,2) not null default 0,
  potential_net_profit numeric(12,2) not null default 0,
  estimated_reconditioning_cost numeric(12,2) not null default 0,
  estimated_tax_amount numeric(12,2) not null default 0,
  estimated_hidden_fees numeric(12,2) not null default 0,
  estimated_transport_cost numeric(12,2) not null default 0,
  estimated_auction_fees numeric(12,2) not null default 0,
  estimated_inspection_cost numeric(12,2) not null default 0,
  comparable_count integer not null default 0,
  data_freshness_days integer not null default 999,
  confidence_score integer not null default 0 check (confidence_score between 0 and 100),
  deal_score integer not null default 0 check (deal_score between 0 and 100),
  profit_score integer not null default 0 check (profit_score between 0 and 100),
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  market_trend text not null default 'unknown',
  recommendation_badge market_snap_recommendation_badge not null default 'Negotiate',
  explanation text not null default '',
  warnings jsonb not null default '[]'::jsonb,
  missing_data jsonb not null default '[]'::jsonb,
  model_version text not null,
  estimator_type market_snap_estimator_type not null default 'comparable_estimator',
  valuation_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table vehicle_valuation_comparables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_valuation_id uuid not null references vehicle_valuations(id) on delete cascade,
  market_listing_id uuid references market_listings(id) on delete set null,
  similarity_score numeric(8,5) not null default 0,
  adjusted_price numeric(12,2) not null default 0,
  sample_weight numeric(8,5) not null default 1,
  created_at timestamptz not null default now()
);

create table market_data_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  job_type text not null,
  status market_snap_job_status not null default 'pending',
  source_name text,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table market_import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_name text not null,
  import_type text not null check (import_type in ('csv', 'json')),
  status market_snap_job_status not null default 'pending',
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references profiles(id)
);

create table ml_training_datasets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  market_type market_snap_market_type,
  row_count integer not null default 0,
  feature_schema jsonb not null default '{}'::jsonb,
  anonymized boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table ml_training_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  dataset_id uuid references ml_training_datasets(id) on delete set null,
  status market_snap_job_status not null default 'pending',
  metrics jsonb not null default '{}'::jsonb,
  model_version text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table ml_model_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  status text not null default 'candidate' check (status in ('candidate', 'production', 'archived')),
  estimator_type market_snap_estimator_type not null default 'catboost',
  metrics jsonb not null default '{}'::jsonb,
  promoted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table ml_prediction_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete set null,
  market_listing_id uuid references market_listings(id) on delete set null,
  model_version_id uuid references ml_model_versions(id) on delete set null,
  estimator_type market_snap_estimator_type not null,
  input_features jsonb not null default '{}'::jsonb,
  prediction jsonb not null default '{}'::jsonb,
  confidence_score integer not null default 0,
  created_at timestamptz not null default now()
);

create table valuation_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_valuation_id uuid references vehicle_valuations(id) on delete cascade,
  vehicle_id uuid references vehicles(id) on delete set null,
  feedback_type text not null,
  actual_sale_price numeric(12,2),
  final_profit numeric(12,2),
  notes text,
  anonymized_for_training boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table data_ai_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade unique,
  anonymized_model_improvement_enabled boolean not null default true,
  excluded_personal_data jsonb not null default '["names","phones","emails","addresses","driver_license_images","private_notes","uploaded_personal_files"]'::jsonb,
  retention_summary jsonb not null default '{}'::jsonb,
  accepted_terms_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create table data_retention_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  data_category text not null,
  retention_days integer not null,
  archive_after_days integer,
  delete_original_images boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, data_category)
);

alter table market_sources enable row level security;
alter table market_listings enable row level security;
alter table market_listing_features enable row level security;
alter table deal_radar_saved_listings enable row level security;
alter table vehicle_valuations enable row level security;
alter table vehicle_valuation_comparables enable row level security;
alter table market_data_jobs enable row level security;
alter table market_import_jobs enable row level security;
alter table ml_training_datasets enable row level security;
alter table ml_training_runs enable row level security;
alter table ml_model_versions enable row level security;
alter table ml_prediction_logs enable row level security;
alter table valuation_feedback enable row level security;
alter table data_ai_settings enable row level security;
alter table data_retention_policies enable row level security;

create policy "members read market sources" on market_sources for select using (organization_id is null or is_org_member(organization_id));
create policy "admins manage market sources" on market_sources for all using (organization_id is null or has_org_role(organization_id, array['owner','admin']::app_role[])) with check (organization_id is null or has_org_role(organization_id, array['owner','admin']::app_role[]));

create policy "members read market listings" on market_listings for select using (organization_id is null or is_org_member(organization_id));
create policy "members insert market listings" on market_listings for insert with check (organization_id is null or has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "admins update market listings" on market_listings for update using (organization_id is null or has_org_role(organization_id, array['owner','admin']::app_role[]));

create policy "members read listing features" on market_listing_features for select using (organization_id is null or is_org_member(organization_id));
create policy "members write listing features" on market_listing_features for insert with check (organization_id is null or has_org_role(organization_id, array['owner','admin','member']::app_role[]));

create policy "members read deal radar" on deal_radar_saved_listings for select using (is_org_member(organization_id));
create policy "members write deal radar" on deal_radar_saved_listings for insert with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "members update deal radar" on deal_radar_saved_listings for update using (has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "members delete deal radar" on deal_radar_saved_listings for delete using (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

create policy "members read valuations" on vehicle_valuations for select using (is_org_member(organization_id));
create policy "members write valuations" on vehicle_valuations for insert with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "members read valuation comparables" on vehicle_valuation_comparables for select using (is_org_member(organization_id));
create policy "members write valuation comparables" on vehicle_valuation_comparables for insert with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

create policy "admins manage market jobs" on market_data_jobs for all using (organization_id is null or has_org_role(organization_id, array['owner','admin']::app_role[])) with check (organization_id is null or has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "admins manage import jobs" on market_import_jobs for all using (has_org_role(organization_id, array['owner','admin']::app_role[])) with check (has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "admins manage training datasets" on ml_training_datasets for all using (organization_id is null or has_org_role(organization_id, array['owner','admin']::app_role[])) with check (organization_id is null or has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "admins manage training runs" on ml_training_runs for all using (organization_id is null or has_org_role(organization_id, array['owner','admin']::app_role[])) with check (organization_id is null or has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "members read model versions" on ml_model_versions for select using (true);
create policy "admins manage model versions" on ml_model_versions for all using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "admins read prediction logs" on ml_prediction_logs for select using (organization_id is null or has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "system insert prediction logs" on ml_prediction_logs for insert with check (organization_id is null or has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "members manage valuation feedback" on valuation_feedback for all using (has_org_role(organization_id, array['owner','admin','member']::app_role[])) with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));
create policy "members read data ai settings" on data_ai_settings for select using (is_org_member(organization_id));
create policy "admins manage data ai settings" on data_ai_settings for all using (has_org_role(organization_id, array['owner','admin']::app_role[])) with check (has_org_role(organization_id, array['owner','admin']::app_role[]));
create policy "members read retention policies" on data_retention_policies for select using (organization_id is null or is_org_member(organization_id));
create policy "admins manage retention policies" on data_retention_policies for all using (organization_id is null or has_org_role(organization_id, array['owner','admin']::app_role[])) with check (organization_id is null or has_org_role(organization_id, array['owner','admin']::app_role[]));

create trigger set_market_sources_updated_at before update on market_sources for each row execute function set_updated_at();
create trigger set_market_listings_updated_at before update on market_listings for each row execute function set_updated_at();
create trigger set_market_listing_features_updated_at before update on market_listing_features for each row execute function set_updated_at();
create trigger set_deal_radar_saved_listings_updated_at before update on deal_radar_saved_listings for each row execute function set_updated_at();
create trigger set_data_ai_settings_updated_at before update on data_ai_settings for each row execute function set_updated_at();
create trigger set_data_retention_policies_updated_at before update on data_retention_policies for each row execute function set_updated_at();

create index market_listings_org_vehicle_idx on market_listings (organization_id, make, model, year, mileage_km);
create index market_listings_market_type_idx on market_listings (market_type, captured_at);
create index market_listings_expires_idx on market_listings (expires_at) where expires_at is not null;
create index deal_radar_org_created_idx on deal_radar_saved_listings (organization_id, created_at desc);
create index vehicle_valuations_vehicle_date_idx on vehicle_valuations (organization_id, vehicle_id, valuation_date desc);
create index vehicle_valuations_active_refresh_idx on vehicle_valuations (organization_id, market_type, valuation_date desc);
create index market_data_jobs_org_status_idx on market_data_jobs (organization_id, status, created_at desc);
create index market_import_jobs_org_status_idx on market_import_jobs (organization_id, status, created_at desc);
create index ml_prediction_logs_org_created_idx on ml_prediction_logs (organization_id, created_at desc);

insert into data_retention_policies (organization_id, data_category, retention_days, archive_after_days, delete_original_images)
values
  (null, 'temporary_raw_payloads', 30, 14, true),
  (null, 'unsaved_extension_listings', 180, 90, true),
  (null, 'deal_radar_saved_listings', 1095, 365, true),
  (null, 'valuation_history', 1825, 730, true),
  (null, 'image_features', 1095, 365, true)
on conflict (organization_id, data_category) do nothing;

insert into market_sources (organization_id, name, source_type, default_market_type, source_reliability_score, fee_rules)
values
  (null, 'OpenLane', 'auction', 'auction_market', 88, '{"purchase_tax_rate":0.05,"fee_tax_rate":0.15}'::jsonb),
  (null, 'AutoTrader/AutoHebdo', 'retail', 'clean_retail_market', 84, '{}'::jsonb),
  (null, 'Facebook Marketplace', 'retail', 'clean_retail_market', 64, '{}'::jsonb),
  (null, 'Copart', 'salvage', 'salvage_auction_market', 72, '{"separate_from_clean_retail":true}'::jsonb),
  (null, 'IAA', 'salvage', 'salvage_auction_market', 72, '{"separate_from_clean_retail":true}'::jsonb)
on conflict (organization_id, name) do nothing;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260511_market_snap_hardening.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
-- Market Snap hardening: additive fields for condition intelligence, import quality, retention, and sold-result learning.

alter table market_listings
  add column if not exists description text,
  add column if not exists condition_report_text text,
  add column if not exists condition_features jsonb not null default '{}'::jsonb,
  add column if not exists image_features jsonb not null default '{}'::jsonb,
  add column if not exists diagnostic_features jsonb not null default '{}'::jsonb,
  add column if not exists retention_policy text not null default 'unsaved_market_listing',
  add column if not exists normalization_errors jsonb not null default '[]'::jsonb,
  add column if not exists is_active boolean not null default true;

alter table deal_radar_saved_listings
  add column if not exists condition_features jsonb not null default '{}'::jsonb,
  add column if not exists image_features jsonb not null default '{}'::jsonb,
  add column if not exists diagnostic_features jsonb not null default '{}'::jsonb;

alter table vehicle_valuations
  add column if not exists condition_features jsonb not null default '{}'::jsonb,
  add column if not exists image_features jsonb not null default '{}'::jsonb,
  add column if not exists diagnostic_features jsonb not null default '{}'::jsonb,
  add column if not exists valuation_explanation jsonb not null default '{}'::jsonb,
  add column if not exists model_version_id uuid references ml_model_versions(id) on delete set null,
  add column if not exists expires_at timestamptz;

alter table market_sources
  add column if not exists access_strategy text not null default 'browser_extension_capture',
  add column if not exists compliance_notes text,
  add column if not exists retention_policy text not null default 'standard_market_data';

alter table sales
  add column if not exists market_snap_valuation_id uuid references vehicle_valuations(id) on delete set null,
  add column if not exists market_snap_estimated_retail_value numeric(12,2),
  add column if not exists market_snap_prediction_error numeric(12,2),
  add column if not exists market_snap_prediction_error_percent numeric(8,4),
  add column if not exists market_snap_model_version text,
  add column if not exists market_snap_days_in_inventory integer,
  add column if not exists market_snap_final_profit numeric(12,2);

create index if not exists market_listings_org_source_captured_idx
  on market_listings (organization_id, source_name, source_type, captured_at desc);

create index if not exists market_listings_market_vehicle_price_idx
  on market_listings (market_type, make, model, year, mileage_km, listed_price);

create index if not exists market_listings_active_retention_idx
  on market_listings (is_active, expires_at)
  where is_saved_to_deal_radar = false;

create index if not exists market_listings_condition_features_gin_idx
  on market_listings using gin (condition_features);

create index if not exists market_listings_image_features_gin_idx
  on market_listings using gin (image_features);

create index if not exists deal_radar_recommendation_idx
  on deal_radar_saved_listings (organization_id, recommendation_badge, created_at desc);

create index if not exists vehicle_valuations_model_version_idx
  on vehicle_valuations (organization_id, model_version_id, valuation_date desc);

create index if not exists vehicle_valuations_expires_idx
  on vehicle_valuations (expires_at)
  where expires_at is not null;

create index if not exists sales_market_snap_learning_idx
  on sales (organization_id, sale_date desc, market_snap_model_version)
  where market_snap_estimated_retail_value is not null;

create or replace function cleanup_market_snap_retention()
returns table(expired_market_listings integer, sanitized_market_listings integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
  sanitized_count integer := 0;
begin
  delete from market_listings
  where is_saved_to_deal_radar = false
    and expires_at is not null
    and expires_at < now()
    and retention_policy in ('temporary_capture', 'unsaved_market_listing');
  get diagnostics deleted_count = row_count;

  update market_listings
  set sanitized_raw_payload = null,
      retention_policy = 'sanitized_market_data'
  where sanitized_raw_payload is not null
    and expires_at is not null
    and expires_at < now();
  get diagnostics sanitized_count = row_count;

  expired_market_listings := deleted_count;
  sanitized_market_listings := sanitized_count;
  return next;
end;
$$;

grant execute on function cleanup_market_snap_retention() to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260512_market_snap_production_hardening.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
-- Market Snap production hardening: restrict maintenance functions and model-version writes.

revoke execute on function cleanup_market_snap_retention() from authenticated;
grant execute on function cleanup_market_snap_retention() to service_role;

drop policy if exists "admins manage model versions" on ml_model_versions;
create policy "service role manages model versions" on ml_model_versions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists market_data_jobs_type_status_idx
  on market_data_jobs (job_type, status, created_at desc);

create index if not exists market_data_jobs_org_type_created_idx
  on market_data_jobs (organization_id, job_type, created_at desc);


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260513_vehicle_archive.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
alter table vehicles
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references profiles(id),
  add column if not exists archive_reason text;

create index if not exists vehicles_org_active_status_idx
  on vehicles (organization_id, status)
  where archived_at is null;

create or replace function archive_vehicle(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  clean_reason text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
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

  if vehicle_record.archived_at is not null then
    raise exception 'vehicle already archived';
  end if;

  clean_reason := nullif(left(trim(coalesce(p_reason, '')), 500), '');

  update vehicles
  set archived_at = now(),
      archived_by = auth.uid(),
      archive_reason = clean_reason,
      updated_at = now()
  where id = p_vehicle_id
    and organization_id = p_organization_id;

  insert into activity_logs (
    organization_id,
    action,
    entity_type,
    entity_id,
    message,
    created_by
  )
  values (
    p_organization_id,
    'vehicle_archived',
    'vehicle',
    p_vehicle_id,
    'Vehicle archived. Financial, tax, sale, cash, attachment, and activity records were preserved.' ||
      case when clean_reason is null then '' else ' Reason: ' || clean_reason end,
    auth.uid()
  );
end;
$$;

revoke all on function archive_vehicle(uuid, uuid, text) from public;
grant execute on function archive_vehicle(uuid, uuid, text) to authenticated;

create or replace function delete_vehicle_and_related_data(
  p_organization_id uuid,
  p_vehicle_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'delete_vehicle_and_related_data is deprecated. Use archive_vehicle to preserve financial history.';
end;
$$;

revoke all on function delete_vehicle_and_related_data(uuid, uuid) from public;
grant execute on function delete_vehicle_and_related_data(uuid, uuid) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260514_purchase_tax_consistency.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
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


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260515_atomic_expense_cash_impact.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
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
revoke all on function create_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, text, date, text) from anon;
grant execute on function create_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, text, date, text) to authenticated;

revoke all on function update_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, date, text) from public;
revoke all on function update_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, date, text) from anon;
grant execute on function update_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, date, text) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260516_cash_ledger_reversal_integrity.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
alter table company_cash_transactions
  add column if not exists reversed_transaction_id uuid,
  add column if not exists correction_of_transaction_id uuid,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references profiles(id),
  add column if not exists void_reason text;

alter table external_cash_transactions
  add column if not exists reversed_transaction_id uuid,
  add column if not exists correction_of_transaction_id uuid,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references profiles(id),
  add column if not exists void_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'company_cash_reversed_transaction_fk'
  ) then
    alter table company_cash_transactions
      add constraint company_cash_reversed_transaction_fk
      foreign key (reversed_transaction_id) references company_cash_transactions(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'company_cash_correction_of_transaction_fk'
  ) then
    alter table company_cash_transactions
      add constraint company_cash_correction_of_transaction_fk
      foreign key (correction_of_transaction_id) references company_cash_transactions(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'external_cash_reversed_transaction_fk'
  ) then
    alter table external_cash_transactions
      add constraint external_cash_reversed_transaction_fk
      foreign key (reversed_transaction_id) references external_cash_transactions(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'external_cash_correction_of_transaction_fk'
  ) then
    alter table external_cash_transactions
      add constraint external_cash_correction_of_transaction_fk
      foreign key (correction_of_transaction_id) references external_cash_transactions(id);
  end if;
end $$;

create index if not exists company_cash_reversed_transaction_idx on company_cash_transactions (reversed_transaction_id);
create index if not exists company_cash_correction_of_transaction_idx on company_cash_transactions (correction_of_transaction_id);
create index if not exists external_cash_reversed_transaction_idx on external_cash_transactions (reversed_transaction_id);
create index if not exists external_cash_correction_of_transaction_idx on external_cash_transactions (correction_of_transaction_id);

create or replace function company_cash_transaction_effect(p_type text, p_amount numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_type in ('company_cash_withdrawn', 'vehicle_cost_paid') then -coalesce(p_amount, 0)
    else coalesce(p_amount, 0)
  end;
$$;

create or replace function external_cash_transaction_effect(p_type text, p_amount numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_type in ('external_cash_transferred_to_company', 'external_cash_personally_removed', 'external_vehicle_expense_paid') then -coalesce(p_amount, 0)
    else coalesce(p_amount, 0)
  end;
$$;

create or replace function reverse_company_cash_transaction(
  p_organization_id uuid,
  p_transaction_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  original company_cash_transactions%rowtype;
  reversal_id uuid;
  reversal_type text;
  reversal_effect numeric;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  perform 1 from organizations where id = p_organization_id for update;

  select *
  into original
  from company_cash_transactions
  where id = p_transaction_id
    and organization_id = p_organization_id
  for update;

  if original.id is null or original.deleted_at is not null then
    raise exception 'cash transaction not found';
  end if;

  if original.voided_at is not null or original.reversed_transaction_id is not null then
    raise exception 'cash transaction is already reversed';
  end if;

  if original.correction_of_transaction_id is not null then
    raise exception 'reversal transactions cannot be reversed directly';
  end if;

  if original.source_vehicle_id is not null or original.source_expense_id is not null then
    raise exception 'system-generated cash transactions must be corrected through the vehicle or sale workflow';
  end if;

  reversal_type := case
    when company_cash_transaction_effect(original.type, original.amount) >= 0 then 'company_cash_withdrawn'
    else 'company_cash_added'
  end;
  reversal_effect := company_cash_transaction_effect(reversal_type, original.amount);

  if organization_company_cash_balance(p_organization_id) + reversal_effect < 0 then
    raise exception 'Reversing this transaction would make company cash negative.';
  end if;

  insert into company_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    correction_of_transaction_id,
    created_by
  )
  values (
    p_organization_id,
    reversal_type,
    original.amount,
    current_date,
    'Reversal of ' || original.type || coalesce(': ' || clean_reason, ''),
    original.id,
    auth.uid()
  )
  returning id into reversal_id;

  update company_cash_transactions
  set reversed_transaction_id = reversal_id,
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = coalesce(clean_reason, 'Reversed from cash management.'),
      updated_at = now()
  where id = original.id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'cash_transaction_reversed',
    'cash_transaction',
    original.id,
    'Reversed company cash transaction ' || original.id || ' with reversal ' || reversal_id || '. Reason: ' || coalesce(clean_reason, 'No reason provided'),
    auth.uid()
  );

  return reversal_id;
end;
$$;

create or replace function reverse_external_cash_transaction(
  p_organization_id uuid,
  p_transaction_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  original external_cash_transactions%rowtype;
  reversal_id uuid;
  reversal_type text;
  reversal_effect numeric;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  perform 1 from organizations where id = p_organization_id for update;

  select *
  into original
  from external_cash_transactions
  where id = p_transaction_id
    and organization_id = p_organization_id
  for update;

  if original.id is null or original.deleted_at is not null then
    raise exception 'cash transaction not found';
  end if;

  if original.voided_at is not null or original.reversed_transaction_id is not null then
    raise exception 'cash transaction is already reversed';
  end if;

  if original.correction_of_transaction_id is not null then
    raise exception 'reversal transactions cannot be reversed directly';
  end if;

  if original.source_vehicle_id is not null or original.source_expense_id is not null then
    raise exception 'system-generated cash transactions must be corrected through the vehicle or sale workflow';
  end if;

  reversal_type := case
    when external_cash_transaction_effect(original.type, original.amount) >= 0 then 'external_cash_personally_removed'
    else 'external_commission_earned'
  end;
  reversal_effect := external_cash_transaction_effect(reversal_type, original.amount);

  if organization_external_cash_balance(p_organization_id) + reversal_effect < 0 then
    raise exception 'Reversing this transaction would make external cash negative.';
  end if;

  insert into external_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    correction_of_transaction_id,
    created_by
  )
  values (
    p_organization_id,
    reversal_type,
    original.amount,
    current_date,
    'Reversal of ' || original.type || coalesce(': ' || clean_reason, ''),
    original.id,
    auth.uid()
  )
  returning id into reversal_id;

  update external_cash_transactions
  set reversed_transaction_id = reversal_id,
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = coalesce(clean_reason, 'Reversed from cash management.'),
      updated_at = now()
  where id = original.id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'cash_transaction_reversed',
    'cash_transaction',
    original.id,
    'Reversed external cash transaction ' || original.id || ' with reversal ' || reversal_id || '. Reason: ' || coalesce(clean_reason, 'No reason provided'),
    auth.uid()
  );

  return reversal_id;
end;
$$;

revoke execute on function reverse_company_cash_transaction(uuid, uuid, text) from public;
revoke execute on function reverse_company_cash_transaction(uuid, uuid, text) from anon;
revoke execute on function reverse_external_cash_transaction(uuid, uuid, text) from public;
revoke execute on function reverse_external_cash_transaction(uuid, uuid, text) from anon;
grant execute on function reverse_company_cash_transaction(uuid, uuid, text) to authenticated;
grant execute on function reverse_external_cash_transaction(uuid, uuid, text) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260517_vehicle_financial_corrections.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
create table if not exists vehicle_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  correction_type text not null check (correction_type in ('purchase', 'status')),
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

alter table vehicle_corrections enable row level security;

drop policy if exists "read vehicle corrections" on vehicle_corrections;
create policy "read vehicle corrections"
on vehicle_corrections
for select
using (is_org_member(organization_id));

drop policy if exists "insert vehicle corrections" on vehicle_corrections;
create policy "insert vehicle corrections"
on vehicle_corrections
for insert
with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

create index if not exists vehicle_corrections_vehicle_created_idx
  on vehicle_corrections (vehicle_id, created_at desc);

create or replace function transition_vehicle_status(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_next_status vehicle_status,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
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

  if vehicle_record.status = p_next_status then
    return;
  end if;

  if not (
    (vehicle_record.status = 'purchased'::vehicle_status and p_next_status = 'in_repair'::vehicle_status)
    or (vehicle_record.status = 'in_repair'::vehicle_status and p_next_status = 'listed_for_sale'::vehicle_status)
  ) then
    raise exception 'Invalid vehicle status transition. Record sales through the sale workflow and void sold vehicles through the sale correction workflow.';
  end if;

  update vehicles
  set status = p_next_status,
      updated_at = now()
  where id = vehicle_record.id;

  insert into vehicle_corrections (organization_id, vehicle_id, correction_type, old_values, new_values, reason, created_by)
  values (
    p_organization_id,
    p_vehicle_id,
    'status',
    jsonb_build_object('status', vehicle_record.status),
    jsonb_build_object('status', p_next_status),
    clean_reason,
    auth.uid()
  );

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'vehicle_status_changed',
    'vehicle',
    p_vehicle_id,
    'Vehicle status changed from ' || vehicle_record.status || ' to ' || p_next_status || coalesce('. Reason: ' || clean_reason, ''),
    auth.uid()
  );
end;
$$;

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

  if coalesce(p_purchase_price, 0) < 0 then
    raise exception 'Purchase price is invalid.';
  end if;

  perform 1 from organizations where id = p_organization_id for update;

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

  select *
  into purchase_expense
  from vehicle_expenses
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id
    and category = 'vehicle_purchase_price'
  order by created_at asc
  limit 1
  for update;

  if purchase_expense.id is not null then
    perform 1
    from company_cash_transactions
    where organization_id = p_organization_id
      and source_expense_id = purchase_expense.id
      and deleted_at is null
    for update;

    select coalesce(sum(amount), 0)
    into old_cash_impact
    from company_cash_transactions
    where organization_id = p_organization_id
      and source_expense_id = purchase_expense.id
      and deleted_at is null
      and type = 'vehicle_cost_paid';
  end if;

  new_tax_rate := calculate_purchase_tax_rate(p_purchase_source);
  new_tax := round(coalesce(p_purchase_price, 0) * new_tax_rate, 2);
  new_total := round(coalesce(p_purchase_price, 0) + new_tax, 2);

  if purchase_expense.id is not null and old_cash_impact > 0 and new_total <= 0 then
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
        note = 'Corrected vehicle purchase. Reason: ' || clean_reason
    where id = purchase_expense.id;

    update company_cash_transactions
    set amount = new_total,
        date = coalesce(p_purchase_date, current_date),
        note = 'Corrected vehicle purchase. Reason: ' || clean_reason,
        updated_at = now()
    where organization_id = p_organization_id
      and source_expense_id = purchase_expense.id
      and deleted_at is null
      and type = 'vehicle_cost_paid';
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

revoke execute on function transition_vehicle_status(uuid, uuid, vehicle_status, text) from public;
revoke execute on function correct_vehicle_purchase(uuid, uuid, numeric, date, purchase_source, text) from public;
revoke execute on function correct_vehicle_purchase(uuid, uuid, numeric, date, purchase_source, text) from anon;
grant execute on function transition_vehicle_status(uuid, uuid, vehicle_status, text) to authenticated;
grant execute on function correct_vehicle_purchase(uuid, uuid, numeric, date, purchase_source, text) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260518_sale_void_correction_workflow.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
alter table sales
  add column if not exists status text not null default 'active',
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references profiles(id),
  add column if not exists void_reason text,
  add column if not exists corrected_by_sale_id uuid references sales(id),
  add column if not exists correction_of_sale_id uuid references sales(id);

alter table company_cash_transactions
  add column if not exists source_sale_id uuid references sales(id);

alter table external_cash_transactions
  add column if not exists source_sale_id uuid references sales(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_status_valid') then
    alter table sales add constraint sales_status_valid check (status in ('active', 'voided', 'corrected'));
  end if;
end $$;

alter table sales drop constraint if exists sales_one_per_vehicle;
drop index if exists sales_one_active_per_vehicle_idx;
create unique index sales_one_active_per_vehicle_idx
  on sales (vehicle_id)
  where voided_at is null and status = 'active';

create index if not exists sales_correction_of_sale_idx on sales (correction_of_sale_id);
create index if not exists sales_corrected_by_sale_idx on sales (corrected_by_sale_id);
create index if not exists company_cash_source_sale_idx on company_cash_transactions (source_sale_id);
create index if not exists external_cash_source_sale_idx on external_cash_transactions (source_sale_id);

create or replace function record_vehicle_sale_atomic(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_sale_date date,
  p_taxable_profit_amount numeric,
  p_real_client_payment numeric,
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
  vehicle_total_cost numeric(12,2);
  paper_sale_price numeric(12,2);
  profit_tax_due numeric(12,2);
  external_commission numeric(12,2);
  buyer_contact_id uuid;
  sale_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
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
    where vehicle_id = p_vehicle_id
      and organization_id = p_organization_id
      and voided_at is null
      and status = 'active'
  ) then
    raise exception 'this vehicle already has an active sale record';
  end if;

  select round((
    vehicle_record.purchase_price
    + coalesce(sum(
      case
        when category = 'vehicle_purchase_price' and vehicle_record.purchase_price > 0 then tax_amount
        else total_amount
      end
    ), 0)
  )::numeric, 2)
  into vehicle_total_cost
  from vehicle_expenses
  where vehicle_id = p_vehicle_id
    and organization_id = p_organization_id;

  paper_sale_price := round((vehicle_total_cost + coalesce(p_taxable_profit_amount, 0))::numeric, 2);
  profit_tax_due := round((coalesce(p_taxable_profit_amount, 0) * 0.22)::numeric, 2);
  external_commission := round((coalesce(p_real_client_payment, 0) - paper_sale_price)::numeric, 2);

  if external_commission < 0 then
    raise exception 'real client payment cannot be lower than the paper sale price';
  end if;

  if nullif(trim(coalesce(p_buyer_name, '')), '') is not null then
    insert into contacts (
      organization_id, type, full_name, phone, email, address, notes, created_by
    )
    values (
      p_organization_id,
      'buyer',
      trim(p_buyer_name),
      nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_email, '')), ''),
      nullif(trim(coalesce(p_address, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''),
      auth.uid()
    )
    returning id into buyer_contact_id;

    insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
    values (p_organization_id, 'contact_created', 'contact', buyer_contact_id, trim(p_buyer_name), auth.uid());
  end if;

  insert into sales (
    organization_id,
    vehicle_id,
    contact_id,
    sale_date,
    vehicle_total_cost,
    taxable_profit_amount,
    profit_tax_due,
    paper_sale_price,
    real_client_payment,
    external_commission,
    notes,
    status,
    created_by
  )
  values (
    p_organization_id,
    p_vehicle_id,
    buyer_contact_id,
    coalesce(p_sale_date, current_date),
    vehicle_total_cost,
    coalesce(p_taxable_profit_amount, 0),
    profit_tax_due,
    paper_sale_price,
    coalesce(p_real_client_payment, 0),
    external_commission,
    nullif(trim(coalesce(p_notes, '')), ''),
    'active',
    auth.uid()
  )
  returning id into sale_id;

  update vehicles
  set status = 'sold',
      updated_at = now()
  where id = p_vehicle_id
    and organization_id = p_organization_id;

  if paper_sale_price > 0 then
    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, created_by
    )
    values (
      p_organization_id,
      'paper_sale_received',
      paper_sale_price,
      coalesce(p_sale_date, current_date),
      'Paper sale received',
      p_vehicle_id,
      sale_id,
      auth.uid()
    );
  end if;

  if external_commission > 0 then
    insert into external_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, created_by
    )
    values (
      p_organization_id,
      'external_commission_earned',
      external_commission,
      coalesce(p_sale_date, current_date),
      'External commission earned',
      p_vehicle_id,
      sale_id,
      auth.uid()
    );
  end if;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'vehicle_sold', 'vehicle', p_vehicle_id, 'Sale recorded', auth.uid());

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (p_organization_id, 'cash_transaction_created', 'vehicle', p_vehicle_id, 'Sale cash transactions generated', auth.uid());

  return sale_id;
end;
$$;

create or replace function void_vehicle_sale_atomic(
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
  company_original_id uuid;
  external_original_id uuid;
  company_reversal_id uuid;
  external_reversal_id uuid;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if clean_reason is null then
    raise exception 'Sale void reason is required.';
  end if;

  perform 1 from organizations where id = p_organization_id for update;

  select *
  into sale_record
  from sales
  where id = p_sale_id
    and organization_id = p_organization_id
  for update;

  if sale_record.id is null then
    raise exception 'sale not found';
  end if;

  if sale_record.voided_at is not null or sale_record.status <> 'active' then
    raise exception 'sale is already voided or corrected';
  end if;

  select *
  into vehicle_record
  from vehicles
  where id = sale_record.vehicle_id
    and organization_id = p_organization_id
  for update;

  if vehicle_record.id is null then
    raise exception 'vehicle not found';
  end if;

  if sale_record.paper_sale_price > 0 then
    if organization_company_cash_balance(p_organization_id) - sale_record.paper_sale_price < 0 then
      raise exception 'Voiding this sale would make company cash negative.';
    end if;

    select id
    into company_original_id
    from company_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and correction_of_transaction_id is null
      and type = 'paper_sale_received'
      and amount = sale_record.paper_sale_price
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      )
    order by created_at asc
    limit 1
    for update;

    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, correction_of_transaction_id, created_by
    )
    values (
      p_organization_id,
      'company_cash_withdrawn',
      sale_record.paper_sale_price,
      current_date,
      'Sale void reversal: ' || clean_reason,
      sale_record.vehicle_id,
      sale_record.id,
      company_original_id,
      auth.uid()
    )
    returning id into company_reversal_id;

    if company_original_id is not null then
      update company_cash_transactions
      set reversed_transaction_id = company_reversal_id,
          voided_at = now(),
          voided_by = auth.uid(),
          void_reason = clean_reason,
          updated_at = now()
      where id = company_original_id;
    end if;
  end if;

  if sale_record.external_commission > 0 then
    select id
    into external_original_id
    from external_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and correction_of_transaction_id is null
      and type = 'external_commission_earned'
      and amount = sale_record.external_commission
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      )
    order by created_at asc
    limit 1
    for update;

    if organization_external_cash_balance(p_organization_id) - sale_record.external_commission < 0 then
      raise exception 'Voiding this sale would make external cash negative.';
    end if;

    insert into external_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, correction_of_transaction_id, created_by
    )
    values (
      p_organization_id,
      'external_cash_personally_removed',
      sale_record.external_commission,
      current_date,
      'Sale void reversal: ' || clean_reason,
      sale_record.vehicle_id,
      sale_record.id,
      external_original_id,
      auth.uid()
    )
    returning id into external_reversal_id;

    if external_original_id is not null then
      update external_cash_transactions
      set reversed_transaction_id = external_reversal_id,
          voided_at = now(),
          voided_by = auth.uid(),
          void_reason = clean_reason,
          updated_at = now()
      where id = external_original_id;
    end if;
  end if;

  update sales
  set status = 'voided',
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = clean_reason,
      updated_at = now()
  where id = sale_record.id;

  update vehicles
  set status = 'listed_for_sale',
      updated_at = now()
  where id = sale_record.vehicle_id
    and organization_id = p_organization_id
    and status = 'sold';

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'sale_voided',
    'sale',
    sale_record.id,
    'Sale voided. Reason: ' || clean_reason,
    auth.uid()
  );

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'cash_transaction_reversed',
    'sale',
    sale_record.id,
    'Sale cash impacts reversed.',
    auth.uid()
  );

  return sale_record.id;
end;
$$;

create or replace function correct_vehicle_sale_atomic(
  p_organization_id uuid,
  p_sale_id uuid,
  p_sale_date date,
  p_taxable_profit_amount numeric,
  p_real_client_payment numeric,
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
  if clean_reason is null then
    raise exception 'Sale correction reason is required.';
  end if;

  select *
  into old_sale
  from sales
  where id = p_sale_id
    and organization_id = p_organization_id
  for update;

  if old_sale.id is null then
    raise exception 'sale not found';
  end if;

  perform void_vehicle_sale_atomic(p_organization_id, p_sale_id, 'Corrected sale: ' || clean_reason);

  new_sale_id := record_vehicle_sale_atomic(
    p_organization_id,
    old_sale.vehicle_id,
    p_sale_date,
    p_taxable_profit_amount,
    p_real_client_payment,
    p_buyer_name,
    p_phone,
    p_email,
    p_address,
    p_notes
  );

  update sales
  set status = 'corrected',
      corrected_by_sale_id = new_sale_id
  where id = old_sale.id;

  update sales
  set correction_of_sale_id = old_sale.id
  where id = new_sale_id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'sale_corrected',
    'sale',
    new_sale_id,
    'Sale correction created from ' || old_sale.id || '. Reason: ' || clean_reason,
    auth.uid()
  );

  return new_sale_id;
end;
$$;

revoke execute on function void_vehicle_sale_atomic(uuid, uuid, text) from public;
revoke execute on function correct_vehicle_sale_atomic(uuid, uuid, date, numeric, numeric, text, text, text, text, text, text) from public;
grant execute on function void_vehicle_sale_atomic(uuid, uuid, text) to authenticated;
grant execute on function correct_vehicle_sale_atomic(uuid, uuid, date, numeric, numeric, text, text, text, text, text, text) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260519_validation_domain_integrity.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
create or replace function normalize_vehicle_vin(p_vin text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p_vin, ''), '\s+', '', 'g'));
$$;

update vehicles
set vin = normalize_vehicle_vin(vin),
    updated_at = now()
where vin is distinct from normalize_vehicle_vin(vin);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_vin_quality') then
    alter table vehicles
      add constraint vehicles_vin_quality
      check (vin = '' or vin ~ '^[A-HJ-NPR-Z0-9]{17}$') not valid;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contacts_type_valid') then
    alter table contacts
      add constraint contacts_type_valid
      check (type in ('buyer', 'interested_in_buy_resell', 'export_contact', 'seller', 'partner', 'other')) not valid;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from vehicles
    where archived_at is null
      and normalize_vehicle_vin(vin) <> ''
    group by organization_id, normalize_vehicle_vin(vin)
    having count(*) > 1
  ) then
    raise notice 'Duplicate active VINs exist. Skipping vehicles_org_active_vin_unique_idx until duplicates are resolved.';
  else
    create unique index if not exists vehicles_org_active_vin_unique_idx
      on vehicles (organization_id, normalize_vehicle_vin(vin))
      where archived_at is null and normalize_vehicle_vin(vin) <> '';
  end if;
end $$;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260520_persistent_rate_limiting.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
create table if not exists rate_limit_buckets (
  bucket text not null,
  identifier_hash text not null,
  count integer not null default 0 check (count >= 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (bucket, identifier_hash)
);

revoke all on table rate_limit_buckets from public;
revoke all on table rate_limit_buckets from anon;
revoke all on table rate_limit_buckets from authenticated;

create or replace function check_rate_limit(
  p_bucket text,
  p_identifier_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_time timestamptz := clock_timestamp();
  window_interval interval := make_interval(secs => greatest(p_window_seconds, 1));
  bucket_record rate_limit_buckets%rowtype;
begin
  if length(trim(coalesce(p_bucket, ''))) = 0 then
    raise exception 'rate limit bucket is required';
  end if;
  if length(trim(coalesce(p_identifier_hash, ''))) = 0 then
    raise exception 'rate limit identity is required';
  end if;
  if p_limit < 1 then
    raise exception 'rate limit must be positive';
  end if;

  insert into rate_limit_buckets (bucket, identifier_hash, count, reset_at, updated_at)
  values (p_bucket, p_identifier_hash, 1, now_time + window_interval, now_time)
  on conflict (bucket, identifier_hash)
  do update set
    count = case
      when rate_limit_buckets.reset_at <= now_time then 1
      else rate_limit_buckets.count + 1
    end,
    reset_at = case
      when rate_limit_buckets.reset_at <= now_time then now_time + window_interval
      else rate_limit_buckets.reset_at
    end,
    updated_at = now_time
  returning * into bucket_record;

  return jsonb_build_object(
    'allowed', bucket_record.count <= p_limit,
    'remaining', greatest(p_limit - bucket_record.count, 0),
    'resetAt', bucket_record.reset_at
  );
end;
$$;

revoke execute on function check_rate_limit(text, text, integer, integer) from public;
grant execute on function check_rate_limit(text, text, integer, integer) to anon, authenticated;

create index if not exists rate_limit_buckets_reset_idx on rate_limit_buckets (reset_at);


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260521_market_snap_calibration_guardrails.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
-- Market Snap production guardrails: store sold-outcome error and expose calibration reporting.

create index if not exists vehicle_valuations_sale_outcome_lookup_idx
  on vehicle_valuations (organization_id, vehicle_id, valuation_date desc)
  where vehicle_id is not null;

create or replace function apply_market_snap_sale_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  valuation_record vehicle_valuations%rowtype;
  actual_price numeric(12,2);
begin
  if new.status <> 'active' or new.voided_at is not null then
    return new;
  end if;

  actual_price := round(coalesce(new.paper_sale_price, new.real_client_payment, 0)::numeric, 2);
  if actual_price <= 0 then
    return new;
  end if;

  select *
  into valuation_record
  from vehicle_valuations
  where organization_id = new.organization_id
    and vehicle_id = new.vehicle_id
    and valuation_date <= coalesce(new.created_at, now())
  order by valuation_date desc
  limit 1;

  if valuation_record.id is null then
    return new;
  end if;

  new.market_snap_valuation_id := valuation_record.id;
  new.market_snap_estimated_retail_value := valuation_record.estimated_retail_market_value;
  new.market_snap_prediction_error := round((actual_price - valuation_record.estimated_retail_market_value)::numeric, 2);
  new.market_snap_prediction_error_percent := case
    when actual_price = 0 then null
    else round(((actual_price - valuation_record.estimated_retail_market_value) / actual_price)::numeric, 4)
  end;
  new.market_snap_model_version := valuation_record.model_version;
  new.market_snap_final_profit := new.taxable_profit_amount;

  return new;
end;
$$;

drop trigger if exists apply_market_snap_sale_outcome_before_insert on sales;
create trigger apply_market_snap_sale_outcome_before_insert
before insert on sales
for each row
execute function apply_market_snap_sale_outcome();

drop trigger if exists apply_market_snap_sale_outcome_before_update on sales;
create trigger apply_market_snap_sale_outcome_before_update
before update of paper_sale_price, real_client_payment, status, voided_at on sales
for each row
execute function apply_market_snap_sale_outcome();

create or replace function market_snap_calibration_report(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  with outcomes as (
    select
      s.market_snap_estimated_retail_value::numeric as estimate,
      s.paper_sale_price::numeric as actual,
      abs(s.paper_sale_price - s.market_snap_estimated_retail_value)::numeric as absolute_error,
      case
        when s.paper_sale_price = 0 then null
        else abs(s.paper_sale_price - s.market_snap_estimated_retail_value) / s.paper_sale_price
      end as percentage_error,
      coalesce(v.make, 'Unknown') as make,
      coalesce(v.model, 'Unknown') as model,
      coalesce(v.purchase_source::text, 'Unknown') as source_name,
      coalesce(vv.confidence_score, 0) as confidence_score
    from sales s
    join vehicles v on v.id = s.vehicle_id and v.organization_id = s.organization_id
    left join vehicle_valuations vv on vv.id = s.market_snap_valuation_id
    where s.organization_id = p_organization_id
      and s.status = 'active'
      and s.voided_at is null
      and s.market_snap_estimated_retail_value is not null
      and s.paper_sale_price > 0
  ),
  summary as (
    select
      count(*) as outcome_count,
      coalesce(round(avg(absolute_error), 2), 0) as average_error,
      coalesce(round(percentile_cont(0.5) within group (order by absolute_error)::numeric, 2), 0) as median_error,
      coalesce(round(avg(percentage_error), 4), 0) as average_percentage_error
    from outcomes
  )
  select jsonb_build_object(
    'outcomeCount', summary.outcome_count,
    'averageError', summary.average_error,
    'medianError', summary.median_error,
    'averagePercentageError', summary.average_percentage_error,
    'errorByMakeModel', coalesce((
      select jsonb_agg(row_to_json(grouped))
      from (
        select make || ' ' || model as make_model, count(*) as outcome_count, round(avg(absolute_error), 2) as average_error
        from outcomes
        group by make, model
        order by count(*) desc, make, model
      ) grouped
    ), '[]'::jsonb),
    'errorBySource', coalesce((
      select jsonb_agg(row_to_json(grouped))
      from (
        select source_name, count(*) as outcome_count, round(avg(absolute_error), 2) as average_error
        from outcomes
        group by source_name
        order by count(*) desc, source_name
      ) grouped
    ), '[]'::jsonb),
    'confidenceVsError', coalesce((
      select jsonb_agg(row_to_json(grouped))
      from (
        select
          case
            when confidence_score >= 80 then '80-100'
            when confidence_score >= 60 then '60-79'
            when confidence_score >= 40 then '40-59'
            else '0-39'
          end as confidence_band,
          count(*) as outcome_count,
          round(avg(absolute_error), 2) as average_error
        from outcomes
        group by 1
        order by 1
      ) grouped
    ), '[]'::jsonb)
  )
  into result
  from summary;

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke execute on function apply_market_snap_sale_outcome() from authenticated;
grant execute on function market_snap_calibration_report(uuid) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260522_openlane_extension_payload.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
-- Market Snap OpenLane extension payload support.

alter table market_listings
  add column if not exists vin text,
  add column if not exists carfax_url text,
  add column if not exists carfax_available boolean not null default false,
  add column if not exists photos_json jsonb not null default '[]'::jsonb,
  add column if not exists videos_json jsonb not null default '[]'::jsonb,
  add column if not exists openlane_metadata jsonb not null default '{}'::jsonb,
  add column if not exists extraction_confidence_score integer,
  add column if not exists extraction_warnings jsonb not null default '[]'::jsonb,
  add column if not exists raw_visible_text text;

alter table deal_radar_saved_listings
  add column if not exists vin text,
  add column if not exists carfax_url text,
  add column if not exists carfax_available boolean not null default false,
  add column if not exists photos_json jsonb not null default '[]'::jsonb,
  add column if not exists videos_json jsonb not null default '[]'::jsonb,
  add column if not exists openlane_metadata jsonb not null default '{}'::jsonb,
  add column if not exists extraction_confidence_score integer,
  add column if not exists extraction_warnings jsonb not null default '[]'::jsonb,
  add column if not exists raw_visible_text text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'market_listings_vin_format') then
    alter table market_listings
      add constraint market_listings_vin_format
      check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$') not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'deal_radar_saved_listings_vin_format') then
    alter table deal_radar_saved_listings
      add constraint deal_radar_saved_listings_vin_format
      check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$') not valid;
  end if;
end $$;

create index if not exists market_listings_openlane_vin_idx
  on market_listings (organization_id, vin)
  where vin is not null;

create index if not exists deal_radar_openlane_vin_idx
  on deal_radar_saved_listings (organization_id, vin)
  where vin is not null;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260523_openlane_capture_storage.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
-- OpenLane capture storage separates observations from candidate/verified outcomes.
-- Append-only by design: no existing market, Deal Radar, vehicle, sale, or cash rows are deleted.

create table if not exists openlane_vehicle_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vin text,
  fallback_key text not null,
  listing_url text,
  title text,
  year integer,
  make text,
  model text,
  trim text,
  mileage_km integer,
  identity_confidence text not null default 'low' check (identity_confidence in ('low', 'medium', 'high')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  unique (organization_id, fallback_key),
  check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$')
);

create table if not exists openlane_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_identity_id uuid not null references openlane_vehicle_identities(id) on delete cascade,
  source_name text not null default 'OpenLane',
  listing_url text,
  page_type text not null default 'active_listing',
  capture_kind text not null default 'observation' check (capture_kind = 'observation'),
  current_bid numeric(12,2),
  buy_now_price numeric(12,2),
  time_remaining text,
  status_text text,
  disclosure_count integer,
  photo_count integer,
  captured_at timestamptz not null default now(),
  captured_by uuid references profiles(id),
  confidence_level text not null default 'low' check (confidence_level in ('low', 'medium', 'high', 'verified')),
  evidence jsonb not null default '[]'::jsonb,
  capped_payload jsonb not null default '{}'::jsonb,
  observation_fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, observation_fingerprint)
);

create table if not exists openlane_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  vehicle_identity_id uuid not null references openlane_vehicle_identities(id) on delete cascade,
  source_name text not null default 'OpenLane',
  listing_url text,
  outcome_type text not null check (outcome_type in ('post_sale_candidate', 'accepted_negotiation', 'purchase_fee_details', 'manual_confirmation', 'candidate_outcome', 'verified_outcome')),
  source_page_type text,
  capture_kind text not null check (capture_kind in ('candidate_outcome', 'verified_outcome', 'manual_confirmation')),
  confidence_level text not null default 'medium' check (confidence_level in ('low', 'medium', 'high', 'verified')),
  sold_price_candidate numeric(12,2),
  final_bid_amount numeric(12,2),
  negotiated_amount numeric(12,2),
  counter_offer_amount numeric(12,2),
  accepted_amount numeric(12,2),
  buy_price_auction numeric(12,2),
  transaction_fee numeric(12,2),
  vehicle_history_fee numeric(12,2),
  other_fees numeric(12,2),
  subtotal numeric(12,2),
  taxes numeric(12,2),
  total_invoice_amount numeric(12,2),
  final_acquisition_cost numeric(12,2),
  negotiation_status text,
  evidence jsonb not null default '[]'::jsonb,
  price_semantics jsonb not null default '{}'::jsonb,
  capped_payload jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  captured_by uuid references profiles(id),
  is_training_eligible boolean not null default false,
  outcome_fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, outcome_fingerprint),
  check (
    capture_kind <> 'verified_outcome'
    or final_bid_amount is not null
    or negotiated_amount is not null
    or accepted_amount is not null
    or buy_price_auction is not null
    or total_invoice_amount is not null
    or final_acquisition_cost is not null
  )
);

alter table openlane_vehicle_identities enable row level security;
alter table openlane_observations enable row level security;
alter table openlane_outcomes enable row level security;

drop policy if exists "members read openlane vehicle identities" on openlane_vehicle_identities;
create policy "members read openlane vehicle identities" on openlane_vehicle_identities
  for select using (is_org_member(organization_id));

drop policy if exists "members write openlane vehicle identities" on openlane_vehicle_identities;
create policy "members write openlane vehicle identities" on openlane_vehicle_identities
  for insert with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

drop policy if exists "members update openlane vehicle identities" on openlane_vehicle_identities;
create policy "members update openlane vehicle identities" on openlane_vehicle_identities
  for update using (has_org_role(organization_id, array['owner','admin','member']::app_role[]))
  with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

drop policy if exists "members read openlane observations" on openlane_observations;
create policy "members read openlane observations" on openlane_observations
  for select using (is_org_member(organization_id));

drop policy if exists "members write openlane observations" on openlane_observations;
create policy "members write openlane observations" on openlane_observations
  for insert with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

drop policy if exists "members read openlane outcomes" on openlane_outcomes;
create policy "members read openlane outcomes" on openlane_outcomes
  for select using (is_org_member(organization_id));

drop policy if exists "members write openlane outcomes" on openlane_outcomes;
create policy "members write openlane outcomes" on openlane_outcomes
  for insert with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));

create index if not exists openlane_vehicle_identities_org_vin_idx
  on openlane_vehicle_identities (organization_id, vin)
  where vin is not null;

create index if not exists openlane_observations_identity_captured_idx
  on openlane_observations (organization_id, vehicle_identity_id, captured_at desc);

create index if not exists openlane_outcomes_identity_captured_idx
  on openlane_outcomes (organization_id, vehicle_identity_id, captured_at desc);

create index if not exists openlane_outcomes_training_idx
  on openlane_outcomes (organization_id, is_training_eligible, outcome_type)
  where is_training_eligible = true;

drop trigger if exists set_openlane_vehicle_identities_updated_at on openlane_vehicle_identities;
create trigger set_openlane_vehicle_identities_updated_at
  before update on openlane_vehicle_identities
  for each row execute function set_updated_at();


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260524_market_snap_training_export_safety.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
-- Market Snap training exports keep active OpenLane observations as features only.
-- Labels come only from verified outcomes, manual confirmations, or Dealer Flow retail sales.

create or replace view openlane_verified_wholesale_training
with (security_invoker = true) as
select
  o.organization_id,
  o.vehicle_identity_id,
  o.id as outcome_id,
  coalesce(o.buy_price_auction, o.accepted_amount, o.negotiated_amount, o.final_bid_amount)::numeric(12,2) as label_value,
  case
    when o.buy_price_auction is not null then 'buy_price_auction'
    when o.accepted_amount is not null then 'accepted_amount'
    when o.negotiated_amount is not null then 'negotiated_amount'
    else 'final_bid_amount'
  end as label_source,
  o.outcome_type,
  o.capture_kind,
  o.confidence_level,
  o.captured_at as label_captured_at,
  obs.current_bid as feature_current_bid,
  obs.buy_now_price as feature_buy_now_price,
  obs.time_remaining as feature_time_remaining,
  obs.status_text as feature_page_state,
  obs.disclosure_count as feature_disclosure_count,
  obs.photo_count as feature_photo_count,
  obs.captured_at as feature_captured_at
from openlane_outcomes o
left join lateral (
  select current_bid, buy_now_price, time_remaining, status_text, disclosure_count, photo_count, captured_at
  from openlane_observations oo
  where oo.organization_id = o.organization_id
    and oo.vehicle_identity_id = o.vehicle_identity_id
    and oo.capture_kind = 'observation'
    and oo.captured_at <= o.captured_at
  order by oo.captured_at desc
  limit 1
) obs on true
where o.is_training_eligible = true
  and o.capture_kind in ('verified_outcome','manual_confirmation')
  and coalesce(o.negotiation_status, '') <> 'Pending'
  and coalesce(o.buy_price_auction, o.accepted_amount, o.negotiated_amount, o.final_bid_amount) is not null;

create or replace view openlane_acquisition_cost_training
with (security_invoker = true) as
select
  o.organization_id,
  o.vehicle_identity_id,
  o.id as outcome_id,
  coalesce(o.final_acquisition_cost, o.total_invoice_amount)::numeric(12,2) as label_value,
  case
    when o.final_acquisition_cost is not null then 'final_acquisition_cost'
    else 'total_invoice_amount'
  end as label_source,
  o.outcome_type,
  o.capture_kind,
  o.confidence_level,
  o.buy_price_auction,
  o.transaction_fee,
  o.vehicle_history_fee,
  o.other_fees,
  o.subtotal,
  o.taxes,
  o.captured_at as label_captured_at,
  obs.current_bid as feature_current_bid,
  obs.buy_now_price as feature_buy_now_price,
  obs.time_remaining as feature_time_remaining,
  obs.status_text as feature_page_state,
  obs.disclosure_count as feature_disclosure_count,
  obs.photo_count as feature_photo_count,
  obs.captured_at as feature_captured_at
from openlane_outcomes o
left join lateral (
  select current_bid, buy_now_price, time_remaining, status_text, disclosure_count, photo_count, captured_at
  from openlane_observations oo
  where oo.organization_id = o.organization_id
    and oo.vehicle_identity_id = o.vehicle_identity_id
    and oo.capture_kind = 'observation'
    and oo.captured_at <= o.captured_at
  order by oo.captured_at desc
  limit 1
) obs on true
where o.is_training_eligible = true
  and o.capture_kind in ('verified_outcome','manual_confirmation')
  and o.outcome_type = 'purchase_fee_details'
  and coalesce(o.final_acquisition_cost, o.total_invoice_amount) is not null;

create or replace view dealer_flow_retail_training
with (security_invoker = true) as
select
  s.organization_id,
  s.vehicle_id,
  s.id as sale_id,
  s.paper_sale_price::numeric(12,2) as label_value,
  'dealer_flow_sale'::text as label_source,
  s.sale_date as label_date,
  s.vehicle_total_cost,
  s.market_snap_estimated_retail_value,
  vv.confidence_score as market_snap_confidence_score
from sales s
left join vehicle_valuations vv on vv.id = s.market_snap_valuation_id
  and vv.organization_id = s.organization_id
where s.status = 'active'
  and s.voided_at is null
  and s.paper_sale_price is not null
  and s.paper_sale_price > 0;

create or replace function market_snap_training_export_quality_report(p_organization_id uuid)
returns table(dataset_name text, usable_records bigint, rejected_reason text, rejected_records bigint)
language sql
stable
as $$
  select 'openlane_wholesale'::text, count(*)::bigint, null::text, 0::bigint
  from openlane_verified_wholesale_training
  where organization_id = p_organization_id
    and is_org_member(p_organization_id)
  union all
  select 'openlane_acquisition_cost'::text, count(*)::bigint, null::text, 0::bigint
  from openlane_acquisition_cost_training
  where organization_id = p_organization_id
    and is_org_member(p_organization_id)
  union all
  select 'dealer_flow_retail'::text, count(*)::bigint, null::text, 0::bigint
  from dealer_flow_retail_training
  where organization_id = p_organization_id
    and is_org_member(p_organization_id)
  union all
  select 'openlane_outcomes'::text, 0::bigint, 'candidate_outcome'::text, count(*)::bigint
  from openlane_outcomes
  where organization_id = p_organization_id
    and is_org_member(p_organization_id)
    and capture_kind = 'candidate_outcome'
  union all
  select 'openlane_outcomes'::text, 0::bigint, 'missing_verified_label'::text, count(*)::bigint
  from openlane_outcomes
  where organization_id = p_organization_id
    and is_org_member(p_organization_id)
    and is_training_eligible = true
    and capture_kind in ('verified_outcome','manual_confirmation')
    and coalesce(buy_price_auction, negotiated_amount, accepted_amount, final_bid_amount, final_acquisition_cost, total_invoice_amount) is null
  union all
  select 'dealer_flow_retail'::text, 0::bigint, 'missing_retail_sale_price'::text, count(*)::bigint
  from sales
  where organization_id = p_organization_id
    and is_org_member(p_organization_id)
    and status = 'active'
    and voided_at is null
    and coalesce(paper_sale_price, 0) <= 0;
$$;

grant select on openlane_verified_wholesale_training to authenticated;
grant select on openlane_acquisition_cost_training to authenticated;
grant select on dealer_flow_retail_training to authenticated;
grant execute on function market_snap_training_export_quality_report(uuid) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260525_market_snap_deep_capture_consent.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
-- Market Snap Deep Capture consent foundation.
-- Current product copy versions:
-- consent: deep-capture-consent-2026-05-16
-- terms: deep-capture-terms-2026-05-16
-- privacy: deep-capture-privacy-2026-05-16
-- This migration is append-only: it creates consent/audit records without deleting financial, market, or OpenLane data.

create or replace function is_valid_market_snap_capture_scopes(value jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(jsonb_typeof(value) = 'array', false)
    and not exists (
      select 1
      from jsonb_array_elements_text(value) as scope(value)
      where scope.value not in (
        'dom_visible',
        'safe_read_only_expansion',
        'network_response_observation',
        'fee_outcome_capture',
        'post_sale_outcome_capture',
        'media_url_capture',
        'model_improvement'
      )
    );
$$;

create table if not exists market_snap_capture_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id),
  status text not null default 'active'
    check (status in ('active', 'withdrawn', 'expired', 'superseded')),
  consent_version text not null,
  terms_version text not null,
  privacy_version text not null,
  capture_scopes jsonb not null default '["dom_visible"]'::jsonb
    check (is_valid_market_snap_capture_scopes(capture_scopes)),
  allowed_domains jsonb not null default '[]'::jsonb,
  allowed_hosts jsonb not null default '[]'::jsonb,
  allowed_data_categories jsonb not null default '[]'::jsonb,
  denied_data_categories jsonb not null default '["credentials","authorization_headers","cookies","session_tokens","passwords","csrf_tokens","jwt_tokens","unrelated_personal_data"]'::jsonb,
  accepted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  accepted_by_user_id uuid not null references profiles(id),
  withdrawn_by_user_id uuid references profiles(id),
  source text not null default 'web_app_settings'
    check (source in ('web_app_settings', 'extension_options', 'onboarding')),
  extension_installation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or withdrawn_at is null),
  check (status = 'active' or withdrawn_at is not null or status in ('expired', 'superseded'))
);

create table if not exists market_snap_capture_consent_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  consent_id uuid references market_snap_capture_consents(id) on delete set null,
  event_type text not null check (event_type in (
    'consent_created',
    'consent_updated',
    'consent_withdrawn',
    'consent_version_superseded',
    'model_improvement_enabled',
    'model_improvement_disabled',
    'capture_scope_enabled',
    'capture_scope_disabled'
  )),
  actor_user_id uuid not null references profiles(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table market_snap_capture_consents enable row level security;
alter table market_snap_capture_consent_events enable row level security;

drop policy if exists "members read market snap capture consents" on market_snap_capture_consents;
create policy "members read market snap capture consents" on market_snap_capture_consents
  for select using (is_org_member(organization_id));

drop policy if exists "owners admins create market snap capture consents" on market_snap_capture_consents;
create policy "owners admins create market snap capture consents" on market_snap_capture_consents
  for insert with check (
    has_org_role(organization_id, array['owner','admin']::app_role[])
    and accepted_by_user_id = auth.uid()
    and user_id = auth.uid()
  );

drop policy if exists "owners admins update market snap capture consents" on market_snap_capture_consents;
create policy "owners admins update market snap capture consents" on market_snap_capture_consents
  for update using (has_org_role(organization_id, array['owner','admin']::app_role[]))
  with check (has_org_role(organization_id, array['owner','admin']::app_role[]));

drop policy if exists "members read market snap capture consent events" on market_snap_capture_consent_events;
create policy "members read market snap capture consent events" on market_snap_capture_consent_events
  for select using (is_org_member(organization_id));

drop policy if exists "owners admins create market snap capture consent events" on market_snap_capture_consent_events;
create policy "owners admins create market snap capture consent events" on market_snap_capture_consent_events
  for insert with check (
    has_org_role(organization_id, array['owner','admin']::app_role[])
    and actor_user_id = auth.uid()
  );

grant select, insert, update on market_snap_capture_consents to authenticated;
grant select, insert on market_snap_capture_consent_events to authenticated;

create unique index if not exists market_snap_capture_consents_one_active_org_idx
  on market_snap_capture_consents (organization_id)
  where status = 'active';

create index if not exists market_snap_capture_consents_org_status_idx
  on market_snap_capture_consents (organization_id, status, accepted_at desc);

create index if not exists market_snap_capture_consent_events_org_created_idx
  on market_snap_capture_consent_events (organization_id, created_at desc);

drop trigger if exists set_market_snap_capture_consents_updated_at on market_snap_capture_consents;
create trigger set_market_snap_capture_consents_updated_at
  before update on market_snap_capture_consents
  for each row execute function set_updated_at();


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260526_deep_capture_retention_training_guards.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
-- Deep Capture persistence guardrails.
-- Adds consent/retention/provenance metadata to OpenLane capture rows and requires
-- separate model-improvement opt-in before verified outcomes can feed training exports.

-- Defensive prerequisite bootstrap for production/manual SQL application.
-- 20260525 creates this consent foundation, but 20260526 must not fail with
-- 42P01 if a production database missed that migration before this file runs.
create or replace function public.is_valid_market_snap_capture_scopes(value jsonb)
returns boolean
language sql
immutable
as $$
  select coalesce(jsonb_typeof(value) = 'array', false)
    and not exists (
      select 1
      from jsonb_array_elements_text(value) as scope(value)
      where scope.value not in (
        'dom_visible',
        'safe_read_only_expansion',
        'network_response_observation',
        'fee_outcome_capture',
        'post_sale_outcome_capture',
        'media_url_capture',
        'model_improvement'
      )
    );
$$;

create table if not exists market_snap_capture_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id),
  status text not null default 'active'
    check (status in ('active', 'withdrawn', 'expired', 'superseded')),
  consent_version text not null,
  terms_version text not null,
  privacy_version text not null,
  capture_scopes jsonb not null default '["dom_visible"]'::jsonb
    check (public.is_valid_market_snap_capture_scopes(capture_scopes)),
  allowed_domains jsonb not null default '[]'::jsonb,
  allowed_hosts jsonb not null default '[]'::jsonb,
  allowed_data_categories jsonb not null default '[]'::jsonb,
  denied_data_categories jsonb not null default '["credentials","authorization_headers","cookies","session_tokens","passwords","csrf_tokens","jwt_tokens","unrelated_personal_data"]'::jsonb,
  accepted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  accepted_by_user_id uuid not null references profiles(id),
  withdrawn_by_user_id uuid references profiles(id),
  source text not null default 'web_app_settings'
    check (source in ('web_app_settings', 'extension_options', 'onboarding')),
  extension_installation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or withdrawn_at is null),
  check (status = 'active' or withdrawn_at is not null or status in ('expired', 'superseded'))
);

create table if not exists market_snap_capture_consent_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  consent_id uuid references market_snap_capture_consents(id) on delete set null,
  event_type text not null check (event_type in (
    'consent_created',
    'consent_updated',
    'consent_withdrawn',
    'consent_version_superseded',
    'model_improvement_enabled',
    'model_improvement_disabled',
    'capture_scope_enabled',
    'capture_scope_disabled'
  )),
  actor_user_id uuid not null references profiles(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table market_snap_capture_consents enable row level security;
alter table market_snap_capture_consent_events enable row level security;

drop policy if exists "members read market snap capture consents" on market_snap_capture_consents;
create policy "members read market snap capture consents" on market_snap_capture_consents
  for select using (is_org_member(organization_id));

drop policy if exists "owners admins create market snap capture consents" on market_snap_capture_consents;
create policy "owners admins create market snap capture consents" on market_snap_capture_consents
  for insert with check (
    has_org_role(organization_id, array['owner','admin']::app_role[])
    and accepted_by_user_id = auth.uid()
    and user_id = auth.uid()
  );

drop policy if exists "owners admins update market snap capture consents" on market_snap_capture_consents;
create policy "owners admins update market snap capture consents" on market_snap_capture_consents
  for update using (has_org_role(organization_id, array['owner','admin']::app_role[]))
  with check (has_org_role(organization_id, array['owner','admin']::app_role[]));

drop policy if exists "members read market snap capture consent events" on market_snap_capture_consent_events;
create policy "members read market snap capture consent events" on market_snap_capture_consent_events
  for select using (is_org_member(organization_id));

drop policy if exists "owners admins create market snap capture consent events" on market_snap_capture_consent_events;
create policy "owners admins create market snap capture consent events" on market_snap_capture_consent_events
  for insert with check (
    has_org_role(organization_id, array['owner','admin']::app_role[])
    and actor_user_id = auth.uid()
  );

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert, update on public.market_snap_capture_consents to authenticated';
    execute 'grant select, insert on public.market_snap_capture_consent_events to authenticated';
  end if;
end $$;

create unique index if not exists market_snap_capture_consents_one_active_org_idx
  on market_snap_capture_consents (organization_id)
  where status = 'active';

create index if not exists market_snap_capture_consents_org_status_idx
  on market_snap_capture_consents (organization_id, status, accepted_at desc);

create index if not exists market_snap_capture_consent_events_org_created_idx
  on market_snap_capture_consent_events (organization_id, created_at desc);

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'set_updated_at'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    drop trigger if exists set_market_snap_capture_consents_updated_at on market_snap_capture_consents;
    create trigger set_market_snap_capture_consents_updated_at
      before update on market_snap_capture_consents
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table openlane_vehicle_identities
  add column if not exists retention_policy text not null default 'temporary_deep_capture',
  add column if not exists expires_at timestamptz,
  add column if not exists capture_level text not null default 'basic_dom',
  add column if not exists consent_id uuid references market_snap_capture_consents(id) on delete set null,
  add column if not exists source_type text not null default 'auction';

alter table openlane_observations
  add column if not exists retention_policy text not null default 'temporary_deep_capture',
  add column if not exists expires_at timestamptz,
  add column if not exists capture_level text not null default 'basic_dom',
  add column if not exists consent_id uuid references market_snap_capture_consents(id) on delete set null,
  add column if not exists source_type text not null default 'auction',
  add column if not exists field_evidence jsonb not null default '{}'::jsonb,
  add column if not exists data_quality_score numeric(5,2),
  add column if not exists evidence_confidence_score numeric(5,2);

alter table openlane_outcomes
  add column if not exists retention_policy text not null default 'temporary_deep_capture',
  add column if not exists expires_at timestamptz,
  add column if not exists capture_level text not null default 'basic_dom',
  add column if not exists consent_id uuid references market_snap_capture_consents(id) on delete set null,
  add column if not exists source_type text not null default 'auction',
  add column if not exists field_evidence jsonb not null default '{}'::jsonb,
  add column if not exists data_quality_score numeric(5,2),
  add column if not exists evidence_confidence_score numeric(5,2),
  add column if not exists model_improvement_opted_in boolean not null default false;

update openlane_outcomes
set is_training_eligible = false
where is_training_eligible = true
  and model_improvement_opted_in = false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'openlane_vehicle_identities_capture_level_check') then
    alter table openlane_vehicle_identities
      add constraint openlane_vehicle_identities_capture_level_check
      check (capture_level in ('basic_dom', 'deep_capture'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'openlane_observations_capture_level_check') then
    alter table openlane_observations
      add constraint openlane_observations_capture_level_check
      check (capture_level in ('basic_dom', 'deep_capture'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'openlane_outcomes_capture_level_check') then
    alter table openlane_outcomes
      add constraint openlane_outcomes_capture_level_check
      check (capture_level in ('basic_dom', 'deep_capture'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'openlane_observations_field_evidence_object_check') then
    alter table openlane_observations
      add constraint openlane_observations_field_evidence_object_check
      check (jsonb_typeof(field_evidence) = 'object');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'openlane_outcomes_field_evidence_object_check') then
    alter table openlane_outcomes
      add constraint openlane_outcomes_field_evidence_object_check
      check (jsonb_typeof(field_evidence) = 'object');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'openlane_outcomes_training_opt_in_check') then
    alter table openlane_outcomes
      add constraint openlane_outcomes_training_opt_in_check
      check (
        is_training_eligible = false or (
          model_improvement_opted_in = true
          and capture_kind in ('verified_outcome', 'manual_confirmation')
          and coalesce(negotiation_status, '') <> 'Pending'
          and coalesce(buy_price_auction, accepted_amount, negotiated_amount, final_bid_amount, final_acquisition_cost, total_invoice_amount) is not null
        )
      );
  end if;
end $$;

create index if not exists openlane_observations_retention_idx
  on openlane_observations (organization_id, expires_at)
  where expires_at is not null;

create index if not exists openlane_outcomes_training_opt_in_idx
  on openlane_outcomes (organization_id, model_improvement_opted_in, is_training_eligible, outcome_type)
  where is_training_eligible = true;

create index if not exists openlane_outcomes_retention_idx
  on openlane_outcomes (organization_id, expires_at)
  where expires_at is not null;

create or replace view public.openlane_verified_wholesale_training
with (security_invoker = true) as
select
  o.organization_id,
  o.vehicle_identity_id,
  o.id as outcome_id,
  coalesce(o.buy_price_auction, o.accepted_amount, o.negotiated_amount, o.final_bid_amount)::numeric(12,2) as label_value,
  case
    when o.buy_price_auction is not null then 'buy_price_auction'
    when o.accepted_amount is not null then 'accepted_amount'
    when o.negotiated_amount is not null then 'negotiated_amount'
    else 'final_bid_amount'
  end as label_source,
  o.outcome_type,
  o.capture_kind,
  o.confidence_level,
  o.captured_at as label_captured_at,
  obs.current_bid as feature_current_bid,
  obs.buy_now_price as feature_buy_now_price,
  obs.time_remaining as feature_time_remaining,
  obs.status_text as feature_page_state,
  obs.disclosure_count as feature_disclosure_count,
  obs.photo_count as feature_photo_count,
  obs.captured_at as feature_captured_at,
  o.data_quality_score,
  o.evidence_confidence_score,
  obs.data_quality_score as feature_data_quality_score,
  obs.evidence_confidence_score as feature_evidence_confidence_score
from openlane_outcomes o
left join lateral (
  select current_bid, buy_now_price, time_remaining, status_text, disclosure_count, photo_count, data_quality_score, evidence_confidence_score, captured_at
  from openlane_observations oo
  where oo.organization_id = o.organization_id
    and oo.vehicle_identity_id = o.vehicle_identity_id
    and oo.capture_kind = 'observation'
    and oo.captured_at <= o.captured_at
  order by oo.captured_at desc
  limit 1
) obs on true
where o.is_training_eligible = true
  and o.model_improvement_opted_in = true
  and o.capture_kind in ('verified_outcome','manual_confirmation')
  and coalesce(o.negotiation_status, '') <> 'Pending'
  and coalesce(o.buy_price_auction, o.accepted_amount, o.negotiated_amount, o.final_bid_amount) is not null;

create or replace view public.openlane_acquisition_cost_training
with (security_invoker = true) as
select
  o.organization_id,
  o.vehicle_identity_id,
  o.id as outcome_id,
  coalesce(o.final_acquisition_cost, o.total_invoice_amount)::numeric(12,2) as label_value,
  case
    when o.final_acquisition_cost is not null then 'final_acquisition_cost'
    else 'total_invoice_amount'
  end as label_source,
  o.outcome_type,
  o.capture_kind,
  o.confidence_level,
  o.buy_price_auction,
  o.transaction_fee,
  o.vehicle_history_fee,
  o.other_fees,
  o.subtotal,
  o.taxes,
  o.captured_at as label_captured_at,
  obs.current_bid as feature_current_bid,
  obs.buy_now_price as feature_buy_now_price,
  obs.time_remaining as feature_time_remaining,
  obs.status_text as feature_page_state,
  obs.disclosure_count as feature_disclosure_count,
  obs.photo_count as feature_photo_count,
  obs.captured_at as feature_captured_at,
  o.data_quality_score,
  o.evidence_confidence_score,
  obs.data_quality_score as feature_data_quality_score,
  obs.evidence_confidence_score as feature_evidence_confidence_score
from openlane_outcomes o
left join lateral (
  select current_bid, buy_now_price, time_remaining, status_text, disclosure_count, photo_count, data_quality_score, evidence_confidence_score, captured_at
  from openlane_observations oo
  where oo.organization_id = o.organization_id
    and oo.vehicle_identity_id = o.vehicle_identity_id
    and oo.capture_kind = 'observation'
    and oo.captured_at <= o.captured_at
  order by oo.captured_at desc
  limit 1
) obs on true
where o.is_training_eligible = true
  and o.model_improvement_opted_in = true
  and o.capture_kind in ('verified_outcome','manual_confirmation')
  and o.outcome_type = 'purchase_fee_details'
  and coalesce(o.final_acquisition_cost, o.total_invoice_amount) is not null;

create or replace function public.cleanup_market_snap_deep_capture_retention()
returns table(expired_openlane_observations integer, sanitized_openlane_outcomes integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_observations integer := 0;
  sanitized_outcomes integer := 0;
begin
  delete from openlane_observations
  where expires_at is not null
    and expires_at < now()
    and retention_policy in ('temporary_deep_capture', 'basic_capture');
  get diagnostics deleted_observations = row_count;

  update openlane_outcomes
  set evidence = '[]'::jsonb,
      field_evidence = '{}'::jsonb,
      capped_payload = '{}'::jsonb,
      retention_policy = 'sanitized_outcome_metadata'
  where expires_at is not null
    and expires_at < now()
    and retention_policy in ('temporary_deep_capture', 'basic_capture', 'verified_outcome_business_record')
    and (evidence <> '[]'::jsonb or field_evidence <> '{}'::jsonb or capped_payload <> '{}'::jsonb);
  get diagnostics sanitized_outcomes = row_count;

  expired_openlane_observations := deleted_observations;
  sanitized_openlane_outcomes := sanitized_outcomes;
  return next;
end;
$$;

create or replace function public.market_snap_training_export_quality_report(p_organization_id uuid)
returns table(dataset_name text, usable_records bigint, rejected_reason text, rejected_records bigint)
language sql
stable
as $$
  select 'openlane_wholesale'::text, count(*)::bigint, null::text, 0::bigint
  from openlane_verified_wholesale_training
  where organization_id = p_organization_id
    and is_org_member(p_organization_id)
  union all
  select 'openlane_acquisition_cost'::text, count(*)::bigint, null::text, 0::bigint
  from openlane_acquisition_cost_training
  where organization_id = p_organization_id
    and is_org_member(p_organization_id)
  union all
  select 'dealer_flow_retail'::text, count(*)::bigint, null::text, 0::bigint
  from dealer_flow_retail_training
  where organization_id = p_organization_id
    and is_org_member(p_organization_id)
  union all
  select 'openlane_outcomes'::text, 0::bigint, 'candidate_outcome'::text, count(*)::bigint
  from openlane_outcomes
  where organization_id = p_organization_id
    and is_org_member(p_organization_id)
    and capture_kind = 'candidate_outcome'
  union all
  select 'openlane_outcomes'::text, 0::bigint, 'missing_verified_label'::text, count(*)::bigint
  from openlane_outcomes
  where organization_id = p_organization_id
    and is_org_member(p_organization_id)
    and is_training_eligible = true
    and capture_kind in ('verified_outcome','manual_confirmation')
    and coalesce(buy_price_auction, negotiated_amount, accepted_amount, final_bid_amount, final_acquisition_cost, total_invoice_amount) is null
  union all
  select 'dealer_flow_retail'::text, 0::bigint, 'missing_retail_sale_price'::text, count(*)::bigint
  from sales
  where organization_id = p_organization_id
    and is_org_member(p_organization_id)
    and status = 'active'
    and voided_at is null
    and coalesce(paper_sale_price, 0) <= 0;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select on public.openlane_verified_wholesale_training to authenticated';
    execute 'grant select on public.openlane_acquisition_cost_training to authenticated';
    execute 'grant execute on function public.market_snap_training_export_quality_report(uuid) to authenticated';
  end if;

  execute 'revoke execute on function public.cleanup_market_snap_deep_capture_retention() from public';

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function public.cleanup_market_snap_deep_capture_retention() from anon';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke execute on function public.cleanup_market_snap_deep_capture_retention() from authenticated';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.cleanup_market_snap_deep_capture_retention() to service_role';
  end if;
end $$;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260527_deep_capture_release_security_hardening.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
-- Deep Capture release security hardening.
-- Defensive follow-up for environments where 20260526 was inspected or applied before
-- service-role-only cleanup grants were included.

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'cleanup_market_snap_deep_capture_retention'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    execute 'revoke execute on function public.cleanup_market_snap_deep_capture_retention() from public';

    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke execute on function public.cleanup_market_snap_deep_capture_retention() from anon';
    end if;

    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'revoke execute on function public.cleanup_market_snap_deep_capture_retention() from authenticated';
    end if;

    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute 'grant execute on function public.cleanup_market_snap_deep_capture_retention() to service_role';
    end if;
  end if;
end $$;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260821_external_cash_manual_add.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
alter table external_cash_transactions
  drop constraint if exists external_cash_type_valid,
  add constraint external_cash_type_valid
    check (
      type in (
        'external_cash_added',
        'external_commission_earned',
        'external_cash_transferred_to_company',
        'external_cash_personally_removed',
        'external_vehicle_expense_paid',
        'external_vehicle_expense_refunded'
      )
    );


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260823_atomic_external_cash_transfer.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
alter table company_cash_transactions
  add column if not exists transfer_pair_id uuid;

alter table external_cash_transactions
  add column if not exists transfer_pair_id uuid;

create unique index if not exists company_cash_transfer_pair_unique_idx
  on company_cash_transactions (transfer_pair_id)
  where transfer_pair_id is not null;

create unique index if not exists external_cash_transfer_pair_unique_idx
  on external_cash_transactions (transfer_pair_id)
  where transfer_pair_id is not null;

alter table external_cash_transactions
  drop constraint if exists external_cash_type_valid,
  add constraint external_cash_type_valid
    check (
      type in (
        'external_cash_added',
        'external_commission_earned',
        'external_cash_transferred_to_company',
        'external_transfer_returned',
        'external_cash_personally_removed',
        'external_vehicle_expense_paid',
        'external_vehicle_expense_refunded'
      )
    );

create or replace function require_cash_transfer_pair_on_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    tg_table_name = 'external_cash_transactions'
    and new.type in ('external_cash_transferred_to_company', 'external_transfer_returned')
    and new.transfer_pair_id is null
  ) or (
    tg_table_name = 'external_cash_transactions'
    and new.type in ('external_cash_transferred_to_company', 'external_transfer_returned')
    and coalesce(current_setting('dealer_flow.atomic_transfer_rpc', true), '') <> 'on'
  ) or (
    tg_table_name = 'company_cash_transactions'
    and new.type = 'external_transfer_received'
    and new.transfer_pair_id is null
  ) or (
    tg_table_name = 'company_cash_transactions'
    and new.type = 'external_transfer_received'
    and coalesce(current_setting('dealer_flow.atomic_transfer_rpc', true), '') <> 'on'
  ) then
    raise exception 'System-generated cash transfer rows must have a transfer pair.';
  end if;

  return new;
end;
$$;

drop trigger if exists require_external_cash_transfer_pair on external_cash_transactions;
create trigger require_external_cash_transfer_pair
before insert on external_cash_transactions
for each row execute function require_cash_transfer_pair_on_insert();

drop trigger if exists require_company_cash_transfer_pair on company_cash_transactions;
create trigger require_company_cash_transfer_pair
before insert on company_cash_transactions
for each row execute function require_cash_transfer_pair_on_insert();

create or replace function prevent_paired_cash_transaction_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.transfer_pair_id is not null then
    if new.id is distinct from old.id
      or new.organization_id is distinct from old.organization_id
      or new.type is distinct from old.type
      or new.amount is distinct from old.amount
      or new.date is distinct from old.date
      or new.note is distinct from old.note
      or new.source_vehicle_id is distinct from old.source_vehicle_id
      or new.source_expense_id is distinct from old.source_expense_id
      or new.created_at is distinct from old.created_at
      or new.created_by is distinct from old.created_by
      or new.transfer_pair_id is distinct from old.transfer_pair_id
      or new.correction_of_transaction_id is distinct from old.correction_of_transaction_id
      or new.deleted_at is distinct from old.deleted_at
      or new.deleted_by is distinct from old.deleted_by
      or new.deletion_note is distinct from old.deletion_note
    then
      raise exception 'Paired external transfers cannot be edited directly. Reverse the transfer and create a new one.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_paired_company_cash_transaction_update on company_cash_transactions;
create trigger prevent_paired_company_cash_transaction_update
before update on company_cash_transactions
for each row execute function prevent_paired_cash_transaction_update();

drop trigger if exists prevent_paired_external_cash_transaction_update on external_cash_transactions;
create trigger prevent_paired_external_cash_transaction_update
before update on external_cash_transactions
for each row execute function prevent_paired_cash_transaction_update();

create or replace function transfer_external_cash_to_company(
  p_organization_id uuid,
  p_amount numeric,
  p_date date,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  transfer_pair uuid;
  effective_date date := coalesce(p_date, current_date);
  clean_note text := nullif(trim(coalesce(p_note, '')), '');
  external_note text := 'External → Company transfer';
  company_note text := 'Received from External Cash';
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 999999999 then
    raise exception 'transfer amount must be positive and no greater than 999999999';
  end if;

  perform 1
  from organizations
  where id = p_organization_id
  for update;

  if not found then
    raise exception 'organization not found';
  end if;

  if organization_external_cash_balance(p_organization_id) < p_amount then
    raise exception 'External cash action exceeds available balance.';
  end if;

  if clean_note is not null then
    external_note := external_note || ': ' || clean_note;
    company_note := company_note || ': ' || clean_note;
  end if;

  perform set_config('dealer_flow.atomic_transfer_rpc', 'on', true);
  transfer_pair := gen_random_uuid();

  insert into external_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    transfer_pair_id,
    created_by
  )
  values (
    p_organization_id,
    'external_cash_transferred_to_company',
    p_amount,
    effective_date,
    external_note,
    transfer_pair,
    auth.uid()
  );

  insert into company_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    transfer_pair_id,
    created_by
  )
  values (
    p_organization_id,
    'external_transfer_received',
    p_amount,
    effective_date,
    company_note,
    transfer_pair,
    auth.uid()
  );

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'external_cash_transferred_to_company',
    'cash_transfer',
    transfer_pair,
    'Transferred $' || to_char(p_amount, 'FM999999999990.00') || ' from External Cash to Company Cash.'
      || case when clean_note is null then '' else ' Note: ' || clean_note end,
    auth.uid()
  );

  return transfer_pair;
end;
$$;

create or replace function reverse_external_cash_transfer_pair(
  p_organization_id uuid,
  p_transfer_pair_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  external_original external_cash_transactions%rowtype;
  company_original company_cash_transactions%rowtype;
  reversal_pair uuid;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if p_transfer_pair_id is null then
    raise exception 'Cash transfer pair is incomplete or invalid.';
  end if;

  perform 1
  from organizations
  where id = p_organization_id
  for update;

  if not found then
    raise exception 'organization not found';
  end if;

  select *
  into external_original
  from external_cash_transactions
  where organization_id = p_organization_id
    and transfer_pair_id = p_transfer_pair_id
    and type = 'external_cash_transferred_to_company'
    and correction_of_transaction_id is null
  for update;

  select *
  into company_original
  from company_cash_transactions
  where organization_id = p_organization_id
    and transfer_pair_id = p_transfer_pair_id
    and type = 'external_transfer_received'
    and correction_of_transaction_id is null
  for update;

  if external_original.id is null
    or company_original.id is null
    or external_original.organization_id is distinct from company_original.organization_id
    or external_original.amount is distinct from company_original.amount
    or external_original.transfer_pair_id is distinct from company_original.transfer_pair_id
    or external_original.deleted_at is not null
    or company_original.deleted_at is not null
    or external_original.reversed_transaction_id is not null
    or company_original.reversed_transaction_id is not null
    or external_original.voided_at is not null
    or company_original.voided_at is not null
  then
    raise exception 'Cash transfer pair is incomplete or invalid.';
  end if;

  if organization_company_cash_balance(p_organization_id) < external_original.amount then
    raise exception 'Reversing this transfer would make company cash negative.';
  end if;

  perform set_config('dealer_flow.atomic_transfer_rpc', 'on', true);
  reversal_pair := gen_random_uuid();

  insert into external_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    transfer_pair_id,
    correction_of_transaction_id,
    created_by
  )
  values (
    p_organization_id,
    'external_transfer_returned',
    external_original.amount,
    current_date,
    'Reversal: external-to-company transfer returned'
      || coalesce(': ' || clean_reason, ''),
    reversal_pair,
    external_original.id,
    auth.uid()
  );

  insert into company_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    transfer_pair_id,
    correction_of_transaction_id,
    created_by
  )
  values (
    p_organization_id,
    'company_cash_withdrawn',
    company_original.amount,
    current_date,
    'Reversal: external transfer receipt returned'
      || coalesce(': ' || clean_reason, ''),
    reversal_pair,
    company_original.id,
    auth.uid()
  );

  update external_cash_transactions
  set reversed_transaction_id = (
        select id
        from external_cash_transactions
        where transfer_pair_id = reversal_pair
          and correction_of_transaction_id = external_original.id
      ),
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = coalesce(clean_reason, 'Reversed from cash management.'),
      updated_at = now()
  where id = external_original.id;

  update company_cash_transactions
  set reversed_transaction_id = (
        select id
        from company_cash_transactions
        where transfer_pair_id = reversal_pair
          and correction_of_transaction_id = company_original.id
      ),
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = coalesce(clean_reason, 'Reversed from cash management.'),
      updated_at = now()
  where id = company_original.id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'external_cash_transfer_reversed',
    'cash_transfer',
    p_transfer_pair_id,
    'Reversed $' || to_char(external_original.amount, 'FM999999999990.00')
      || ' external-to-company transfer. Reason: '
      || coalesce(clean_reason, 'No reason provided')
      || '. Reversal pair: ' || reversal_pair,
    auth.uid()
  );

  return reversal_pair;
end;
$$;

create or replace function reverse_company_cash_transaction(
  p_organization_id uuid,
  p_transaction_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  original company_cash_transactions%rowtype;
  reversal_id uuid;
  reversal_type text;
  reversal_effect numeric;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  perform 1 from organizations where id = p_organization_id for update;

  select *
  into original
  from company_cash_transactions
  where id = p_transaction_id
    and organization_id = p_organization_id
  for update;

  if original.id is null or original.deleted_at is not null then
    raise exception 'cash transaction not found';
  end if;

  if original.transfer_pair_id is not null
    and original.type = 'external_transfer_received'
    and original.correction_of_transaction_id is null
  then
    raise exception 'Paired cash transfers must be reversed as a complete transfer.';
  end if;

  if original.voided_at is not null or original.reversed_transaction_id is not null then
    raise exception 'cash transaction is already reversed';
  end if;

  if original.correction_of_transaction_id is not null then
    raise exception 'reversal transactions cannot be reversed directly';
  end if;

  if original.source_vehicle_id is not null or original.source_expense_id is not null then
    raise exception 'system-generated cash transactions must be corrected through the vehicle or sale workflow';
  end if;

  reversal_type := case
    when company_cash_transaction_effect(original.type, original.amount) >= 0 then 'company_cash_withdrawn'
    else 'company_cash_added'
  end;
  reversal_effect := company_cash_transaction_effect(reversal_type, original.amount);

  if organization_company_cash_balance(p_organization_id) + reversal_effect < 0 then
    raise exception 'Reversing this transaction would make company cash negative.';
  end if;

  insert into company_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    correction_of_transaction_id,
    created_by
  )
  values (
    p_organization_id,
    reversal_type,
    original.amount,
    current_date,
    'Reversal of ' || original.type || coalesce(': ' || clean_reason, ''),
    original.id,
    auth.uid()
  )
  returning id into reversal_id;

  update company_cash_transactions
  set reversed_transaction_id = reversal_id,
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = coalesce(clean_reason, 'Reversed from cash management.'),
      updated_at = now()
  where id = original.id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'cash_transaction_reversed',
    'cash_transaction',
    original.id,
    'Reversed company cash transaction ' || original.id || ' with reversal ' || reversal_id || '. Reason: ' || coalesce(clean_reason, 'No reason provided'),
    auth.uid()
  );

  return reversal_id;
end;
$$;

create or replace function reverse_external_cash_transaction(
  p_organization_id uuid,
  p_transaction_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  original external_cash_transactions%rowtype;
  reversal_id uuid;
  reversal_type text;
  reversal_effect numeric;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  perform 1 from organizations where id = p_organization_id for update;

  select *
  into original
  from external_cash_transactions
  where id = p_transaction_id
    and organization_id = p_organization_id
  for update;

  if original.id is null or original.deleted_at is not null then
    raise exception 'cash transaction not found';
  end if;

  if original.transfer_pair_id is not null
    and original.type = 'external_cash_transferred_to_company'
    and original.correction_of_transaction_id is null
  then
    raise exception 'Paired cash transfers must be reversed as a complete transfer.';
  end if;

  if original.voided_at is not null or original.reversed_transaction_id is not null then
    raise exception 'cash transaction is already reversed';
  end if;

  if original.correction_of_transaction_id is not null then
    raise exception 'reversal transactions cannot be reversed directly';
  end if;

  if original.source_vehicle_id is not null or original.source_expense_id is not null then
    raise exception 'system-generated cash transactions must be corrected through the vehicle or sale workflow';
  end if;

  reversal_type := case
    when external_cash_transaction_effect(original.type, original.amount) >= 0 then 'external_cash_personally_removed'
    else 'external_commission_earned'
  end;
  reversal_effect := external_cash_transaction_effect(reversal_type, original.amount);

  if organization_external_cash_balance(p_organization_id) + reversal_effect < 0 then
    raise exception 'Reversing this transaction would make external cash negative.';
  end if;

  insert into external_cash_transactions (
    organization_id,
    type,
    amount,
    date,
    note,
    correction_of_transaction_id,
    created_by
  )
  values (
    p_organization_id,
    reversal_type,
    original.amount,
    current_date,
    'Reversal of ' || original.type || coalesce(': ' || clean_reason, ''),
    original.id,
    auth.uid()
  )
  returning id into reversal_id;

  update external_cash_transactions
  set reversed_transaction_id = reversal_id,
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = coalesce(clean_reason, 'Reversed from cash management.'),
      updated_at = now()
  where id = original.id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'cash_transaction_reversed',
    'cash_transaction',
    original.id,
    'Reversed external cash transaction ' || original.id || ' with reversal ' || reversal_id || '. Reason: ' || coalesce(clean_reason, 'No reason provided'),
    auth.uid()
  );

  return reversal_id;
end;
$$;

revoke execute on function transfer_external_cash_to_company(uuid, numeric, date, text) from public;
revoke execute on function transfer_external_cash_to_company(uuid, numeric, date, text) from anon;
grant execute on function transfer_external_cash_to_company(uuid, numeric, date, text) to authenticated;

revoke execute on function reverse_external_cash_transfer_pair(uuid, uuid, text) from public;
revoke execute on function reverse_external_cash_transfer_pair(uuid, uuid, text) from anon;
grant execute on function reverse_external_cash_transfer_pair(uuid, uuid, text) to authenticated;

revoke execute on function reverse_company_cash_transaction(uuid, uuid, text) from anon;
revoke execute on function reverse_external_cash_transaction(uuid, uuid, text) from anon;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260825_archive_vehicle_cash_refund.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
alter table company_cash_transactions
  drop constraint if exists company_cash_type_valid,
  add constraint company_cash_type_valid
    check (
      type in (
        'company_cash_added',
        'company_cash_withdrawn',
        'vehicle_cost_paid',
        'vehicle_cost_refunded',
        'paper_sale_received',
        'external_transfer_received'
      )
    );

alter table external_cash_transactions
  drop constraint if exists external_cash_type_valid,
  add constraint external_cash_type_valid
    check (
      type in (
        'external_cash_added',
        'external_commission_earned',
        'external_cash_transferred_to_company',
        'external_transfer_returned',
        'external_cash_personally_removed',
        'external_vehicle_expense_paid',
        'external_vehicle_expense_refunded'
      )
    );

create unique index if not exists company_vehicle_cost_refund_original_unique_idx
  on company_cash_transactions (correction_of_transaction_id)
  where type = 'vehicle_cost_refunded'
    and correction_of_transaction_id is not null;

create unique index if not exists external_vehicle_expense_refund_original_unique_idx
  on external_cash_transactions (correction_of_transaction_id)
  where type = 'external_vehicle_expense_refunded'
    and correction_of_transaction_id is not null;

create or replace function company_cash_transaction_effect(p_type text, p_amount numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_type in ('company_cash_withdrawn', 'vehicle_cost_paid') then -coalesce(p_amount, 0)
    when p_type = 'vehicle_cost_refunded' then coalesce(p_amount, 0)
    else coalesce(p_amount, 0)
  end;
$$;

create or replace function external_cash_transaction_effect(p_type text, p_amount numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_type in ('external_cash_transferred_to_company', 'external_cash_personally_removed', 'external_vehicle_expense_paid') then -coalesce(p_amount, 0)
    when p_type = 'external_vehicle_expense_refunded' then coalesce(p_amount, 0)
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
      or new.source_vehicle_id is null
      or new.correction_of_transaction_id is null
    then
      raise exception 'Vehicle archive refund rows are system-generated.';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and (
      old.type in ('vehicle_cost_refunded', 'external_vehicle_expense_refunded')
      or new.type in ('vehicle_cost_refunded', 'external_vehicle_expense_refunded')
    )
  then
    raise exception 'Vehicle archive refund rows cannot be edited or deleted.';
  end if;

  if tg_op = 'DELETE'
    and old.type in ('vehicle_cost_refunded', 'external_vehicle_expense_refunded')
  then
    raise exception 'Vehicle archive refund rows cannot be edited or deleted.';
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

drop trigger if exists prevent_company_vehicle_archive_refund_mutation on company_cash_transactions;
create trigger prevent_company_vehicle_archive_refund_mutation
before insert or update or delete on company_cash_transactions
for each row execute function prevent_vehicle_archive_refund_mutation();

drop trigger if exists prevent_external_vehicle_archive_refund_mutation on external_cash_transactions;
create trigger prevent_external_vehicle_archive_refund_mutation
before insert or update or delete on external_cash_transactions
for each row execute function prevent_vehicle_archive_refund_mutation();

create or replace function archive_vehicle(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  company_original company_cash_transactions%rowtype;
  external_original external_cash_transactions%rowtype;
  refund_id uuid;
  clean_reason text;
  company_refund_count integer := 0;
  external_refund_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
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

  if vehicle_record.archived_at is not null then
    raise exception 'vehicle already archived';
  end if;

  if exists (
    select 1
    from sales
    where organization_id = p_organization_id
      and vehicle_id = p_vehicle_id
      and voided_at is null
      and status = 'active'
  ) then
    raise exception 'Sold vehicles with an active sale cannot be archived. Void the sale first.';
  end if;

  clean_reason := nullif(left(trim(coalesce(p_reason, '')), 500), '');
  perform set_config('dealer_flow.archive_vehicle_rpc', 'on', true);

  for company_original in
    select *
    from company_cash_transactions
    where organization_id = p_organization_id
      and source_vehicle_id = p_vehicle_id
      and type = 'vehicle_cost_paid'
      and deleted_at is null
      and correction_of_transaction_id is null
      and reversed_transaction_id is null
      and voided_at is null
    order by id
    for update
  loop
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
      'Vehicle archive refund'
        || coalesce(': ' || nullif(trim(company_original.note), ''), '')
        || coalesce('. Reason: ' || clean_reason, ''),
      p_vehicle_id,
      company_original.source_expense_id,
      company_original.id,
      auth.uid()
    )
    returning id into refund_id;

    update company_cash_transactions
    set reversed_transaction_id = refund_id,
        voided_at = now(),
        voided_by = auth.uid(),
        void_reason = 'Vehicle archived'
          || coalesce(': ' || clean_reason, ''),
        updated_at = now()
    where id = company_original.id;

    company_refund_count := company_refund_count + 1;
  end loop;

  for external_original in
    select *
    from external_cash_transactions
    where organization_id = p_organization_id
      and source_vehicle_id = p_vehicle_id
      and type = 'external_vehicle_expense_paid'
      and deleted_at is null
      and correction_of_transaction_id is null
      and reversed_transaction_id is null
      and voided_at is null
    order by id
    for update
  loop
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
      'Vehicle archive refund'
        || coalesce(': ' || nullif(trim(external_original.note), ''), '')
        || coalesce('. Reason: ' || clean_reason, ''),
      p_vehicle_id,
      external_original.source_expense_id,
      external_original.id,
      auth.uid()
    )
    returning id into refund_id;

    update external_cash_transactions
    set reversed_transaction_id = refund_id,
        voided_at = now(),
        voided_by = auth.uid(),
        void_reason = 'Vehicle archived'
          || coalesce(': ' || clean_reason, ''),
        updated_at = now()
    where id = external_original.id;

    external_refund_count := external_refund_count + 1;
  end loop;

  update vehicles
  set archived_at = now(),
      archived_by = auth.uid(),
      archive_reason = clean_reason,
      updated_at = now()
  where id = p_vehicle_id
    and organization_id = p_organization_id;

  insert into activity_logs (
    organization_id,
    action,
    entity_type,
    entity_id,
    message,
    created_by
  )
  values (
    p_organization_id,
    'vehicle_archived',
    'vehicle',
    p_vehicle_id,
    'Vehicle archived. Active vehicle cost payments refunded: company '
      || company_refund_count
      || ', external '
      || external_refund_count
      || '. Financial, tax, sale, cash, attachment, and activity records were preserved.'
      || case when clean_reason is null then '' else ' Reason: ' || clean_reason end,
    auth.uid()
  );
end;
$$;

revoke all on function archive_vehicle(uuid, uuid, text) from public;
grant execute on function archive_vehicle(uuid, uuid, text) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260826_permanent_vehicle_purge.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
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
      or new.source_vehicle_id is null
      or new.correction_of_transaction_id is null
    then
      raise exception 'Vehicle archive refund rows are system-generated.';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and (
      old.type in ('vehicle_cost_refunded', 'external_vehicle_expense_refunded')
      or new.type in ('vehicle_cost_refunded', 'external_vehicle_expense_refunded')
    )
  then
    raise exception 'Vehicle archive refund rows cannot be edited or deleted.';
  end if;

  if tg_op = 'DELETE'
    and old.type in ('vehicle_cost_refunded', 'external_vehicle_expense_refunded')
    and coalesce(current_setting('dealer_flow.purge_vehicle_rpc', true), '') <> 'on'
  then
    raise exception 'Vehicle archive refund rows cannot be edited or deleted.';
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

drop trigger if exists prevent_company_vehicle_archive_refund_mutation on company_cash_transactions;
create trigger prevent_company_vehicle_archive_refund_mutation
before insert or update or delete on company_cash_transactions
for each row execute function prevent_vehicle_archive_refund_mutation();

drop trigger if exists prevent_external_vehicle_archive_refund_mutation on external_cash_transactions;
create trigger prevent_external_vehicle_archive_refund_mutation
before insert or update or delete on external_cash_transactions
for each row execute function prevent_vehicle_archive_refund_mutation();

create or replace function purge_vehicle_completely(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_confirmation_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  v_sale_ids uuid[] := '{}'::uuid[];
  v_expense_ids uuid[] := '{}'::uuid[];
  v_contact_ids uuid[] := '{}'::uuid[];
  v_company_cash_ids uuid[] := '{}'::uuid[];
  v_external_cash_ids uuid[] := '{}'::uuid[];
  v_attachment_ids uuid[] := '{}'::uuid[];
  v_valuation_ids uuid[] := '{}'::uuid[];
  v_storage_paths text[] := '{}'::text[];
  v_expected_confirmation text;
  v_normalized_confirmation text;
  v_current_company_balance numeric := 0;
  v_current_external_balance numeric := 0;
  v_projected_company_balance numeric := 0;
  v_projected_external_balance numeric := 0;
  v_deleted_activity_logs integer := 0;
  v_deleted_tax_reports integer := 0;
  v_deleted_valuation_comparables integer := 0;
  v_deleted_valuations integer := 0;
  v_deleted_prediction_logs integer := 0;
  v_deleted_feedback integer := 0;
  v_deleted_corrections integer := 0;
  v_deleted_contacts integer := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
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

  v_expected_confirmation := 'DELETE ' || coalesce(nullif(upper(trim(vehicle_record.vin)), ''), upper(p_vehicle_id::text));
  v_normalized_confirmation := upper(trim(coalesce(p_confirmation_text, '')));
  if v_normalized_confirmation <> v_expected_confirmation then
    raise exception 'confirmation text is incorrect';
  end if;

  with recursive sale_closure(id) as (
    select s.id
    from sales s
    where s.organization_id = p_organization_id
      and s.vehicle_id = p_vehicle_id

    union

    select candidate.id
    from sales candidate
    join sales current_sale on current_sale.id = sale_closure.id
    where candidate.organization_id = p_organization_id
      and (
        candidate.corrected_by_sale_id = current_sale.id
        or candidate.correction_of_sale_id = current_sale.id
        or current_sale.corrected_by_sale_id = candidate.id
        or current_sale.correction_of_sale_id = candidate.id
      )
  )
  select coalesce(array_agg(id), '{}'::uuid[])
  into v_sale_ids
  from sale_closure;

  if exists (
    select 1
    from sales
    where id = any(v_sale_ids)
      and vehicle_id <> p_vehicle_id
  ) then
    raise exception 'Sale correction chain references another vehicle. The vehicle cannot be purged safely.';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_expense_ids
  from vehicle_expenses
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  select coalesce(array_agg(distinct contact_id) filter (where contact_id is not null), '{}'::uuid[])
  into v_contact_ids
  from sales
  where organization_id = p_organization_id
    and id = any(v_sale_ids);

  if exists (
    select 1
    from sales
    where organization_id = p_organization_id
      and contact_id = any(v_contact_ids)
      and vehicle_id <> p_vehicle_id
  ) then
    raise exception 'Buyer contact is shared with another vehicle sale. The vehicle cannot be purged without affecting unrelated records.';
  end if;

  with recursive company_cash_closure(id) as (
    select c.id
    from company_cash_transactions c
    where c.organization_id = p_organization_id
      and (
        c.source_vehicle_id = p_vehicle_id
        or c.source_expense_id = any(v_expense_ids)
        or c.source_sale_id = any(v_sale_ids)
      )

    union

    select candidate.id
    from company_cash_transactions candidate
    join company_cash_transactions current_row on current_row.id = company_cash_closure.id
    where candidate.organization_id = p_organization_id
      and (
        candidate.reversed_transaction_id = current_row.id
        or candidate.correction_of_transaction_id = current_row.id
        or current_row.reversed_transaction_id = candidate.id
        or current_row.correction_of_transaction_id = candidate.id
      )
  )
  select coalesce(array_agg(id), '{}'::uuid[])
  into v_company_cash_ids
  from company_cash_closure;

  with recursive external_cash_closure(id) as (
    select c.id
    from external_cash_transactions c
    where c.organization_id = p_organization_id
      and (
        c.source_vehicle_id = p_vehicle_id
        or c.source_expense_id = any(v_expense_ids)
        or c.source_sale_id = any(v_sale_ids)
      )

    union

    select candidate.id
    from external_cash_transactions candidate
    join external_cash_transactions current_row on current_row.id = external_cash_closure.id
    where candidate.organization_id = p_organization_id
      and (
        candidate.reversed_transaction_id = current_row.id
        or candidate.correction_of_transaction_id = current_row.id
        or current_row.reversed_transaction_id = candidate.id
        or current_row.correction_of_transaction_id = candidate.id
      )
  )
  select coalesce(array_agg(id), '{}'::uuid[])
  into v_external_cash_ids
  from external_cash_closure;

  perform 1
  from company_cash_transactions
  where organization_id = p_organization_id
    and id = any(v_company_cash_ids)
  for update;

  perform 1
  from external_cash_transactions
  where organization_id = p_organization_id
    and id = any(v_external_cash_ids)
  for update;

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_attachment_ids
  from attachments
  where organization_id = p_organization_id
    and (
      vehicle_id = p_vehicle_id
      or expense_id = any(v_expense_ids)
      or sale_id = any(v_sale_ids)
      or contact_id = any(v_contact_ids)
      or company_cash_transaction_id = any(v_company_cash_ids)
      or external_cash_transaction_id = any(v_external_cash_ids)
    );

  select coalesce(array_agg(distinct url_or_path order by url_or_path) filter (
    where url_or_path like ('organizations/' || p_organization_id::text || '/%')
  ), '{}'::text[])
  into v_storage_paths
  from attachments
  where id = any(v_attachment_ids);

  if vehicle_record.main_photo_path like ('organizations/' || p_organization_id::text || '/%') then
    v_storage_paths := array_append(v_storage_paths, vehicle_record.main_photo_path);
  end if;

  select coalesce(array_agg(distinct path order by path), '{}'::text[])
  into v_storage_paths
  from unnest(v_storage_paths) as paths(path)
  where path like ('organizations/' || p_organization_id::text || '/%');

  v_current_company_balance := coalesce(organization_company_cash_balance(p_organization_id), 0);
  v_current_external_balance := coalesce(organization_external_cash_balance(p_organization_id), 0);

  v_projected_company_balance := v_current_company_balance - coalesce((
    select sum(
      case
        when c.deleted_at is null then company_cash_transaction_effect(c.type, c.amount)
        else 0
      end
    )
    from company_cash_transactions c
    where c.id = any(v_company_cash_ids)
  ), 0);

  v_projected_external_balance := v_current_external_balance - coalesce((
    select sum(
      case
        when c.deleted_at is null then external_cash_transaction_effect(c.type, c.amount)
        else 0
      end
    )
    from external_cash_transactions c
    where c.id = any(v_external_cash_ids)
  ), 0);

  if v_projected_company_balance < 0 then
    raise exception 'Vehicle cannot be permanently deleted because removing its financial history would make Company Cash negative. Resolve downstream cash usage first.';
  end if;

  if v_projected_external_balance < 0 then
    raise exception 'Vehicle cannot be permanently deleted because removing its financial history would make External Cash negative. Resolve downstream cash usage first.';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_valuation_ids
  from vehicle_valuations
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  perform set_config('dealer_flow.purge_vehicle_rpc', 'on', true);

  delete from attachments
  where id = any(v_attachment_ids);

  delete from company_cash_transactions
  where organization_id = p_organization_id
    and id = any(v_company_cash_ids);

  delete from external_cash_transactions
  where organization_id = p_organization_id
    and id = any(v_external_cash_ids);

  delete from sales
  where organization_id = p_organization_id
    and id = any(v_sale_ids);

  delete from vehicle_expenses
  where organization_id = p_organization_id
    and id = any(v_expense_ids);

  delete from contacts
  where organization_id = p_organization_id
    and id = any(v_contact_ids);
  get diagnostics v_deleted_contacts = row_count;

  delete from activity_logs
  where organization_id = p_organization_id
    and (
      (entity_type = 'vehicle' and entity_id = p_vehicle_id)
      or (entity_type = 'sale' and entity_id = any(v_sale_ids))
      or (entity_type = 'contact' and entity_id = any(v_contact_ids))
      or (entity_type in ('expense', 'vehicle_expense') and entity_id = any(v_expense_ids))
      or (entity_type = 'cash_transaction' and (
        entity_id = any(v_company_cash_ids) or entity_id = any(v_external_cash_ids)
      ))
    );
  get diagnostics v_deleted_activity_logs = row_count;

  delete from tax_reports
  where organization_id = p_organization_id;
  get diagnostics v_deleted_tax_reports = row_count;

  delete from vehicle_valuation_comparables
  where organization_id = p_organization_id
    and vehicle_valuation_id = any(v_valuation_ids);
  get diagnostics v_deleted_valuation_comparables = row_count;

  delete from valuation_feedback
  where organization_id = p_organization_id
    and (
      vehicle_id = p_vehicle_id
      or vehicle_valuation_id = any(v_valuation_ids)
    );
  get diagnostics v_deleted_feedback = row_count;

  delete from ml_prediction_logs
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;
  get diagnostics v_deleted_prediction_logs = row_count;

  delete from vehicle_valuations
  where organization_id = p_organization_id
    and id = any(v_valuation_ids);
  get diagnostics v_deleted_valuations = row_count;

  delete from vehicle_corrections
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;
  get diagnostics v_deleted_corrections = row_count;

  delete from vehicles
  where id = p_vehicle_id
    and organization_id = p_organization_id;

  return jsonb_build_object(
    'vehicleId', p_vehicle_id,
    'vehicleVin', nullif(vehicle_record.vin, ''),
    'deletedExpenses', coalesce(cardinality(v_expense_ids), 0),
    'deletedSales', coalesce(cardinality(v_sale_ids), 0),
    'deletedContacts', v_deleted_contacts,
    'deletedCompanyCashRows', coalesce(cardinality(v_company_cash_ids), 0),
    'deletedExternalCashRows', coalesce(cardinality(v_external_cash_ids), 0),
    'deletedAttachments', coalesce(cardinality(v_attachment_ids), 0),
    'deletedActivityLogs', v_deleted_activity_logs,
    'deletedValuationComparables', v_deleted_valuation_comparables,
    'deletedValuations', v_deleted_valuations,
    'deletedPredictionLogs', v_deleted_prediction_logs,
    'deletedValuationFeedback', v_deleted_feedback,
    'deletedVehicleCorrections', v_deleted_corrections,
    'invalidatedTaxReports', v_deleted_tax_reports,
    'storagePaths', to_jsonb(v_storage_paths)
  );
end;
$$;

revoke all on function purge_vehicle_completely(uuid, uuid, text) from public;
grant execute on function purge_vehicle_completely(uuid, uuid, text) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260827_vehicle_archive_default.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
-- Normal vehicle removal is archive-only. Keep the historical purge function
-- available in migration history, but do not expose it to application users.
revoke all on function purge_vehicle_completely(uuid, uuid, text) from public;
revoke all on function purge_vehicle_completely(uuid, uuid, text) from authenticated;

grant execute on function archive_vehicle(uuid, uuid, text) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260828_atomic_expense_void.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
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
revoke all on function delete_vehicle_expense(uuid) from anon;
revoke all on function delete_vehicle_expense(uuid) from authenticated;
drop policy if exists "delete expenses" on vehicle_expenses;

revoke all on function create_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, text, date, text) from public;
revoke all on function create_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, text, date, text) from anon;
grant execute on function create_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, text, date, text) to authenticated;
revoke all on function update_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, date, text) from public;
revoke all on function update_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, date, text) from anon;
grant execute on function update_vehicle_expense_with_cash_impact(uuid, uuid, uuid, expense_category, numeric, numeric, numeric, numeric, date, text) to authenticated;
revoke all on function void_vehicle_expense_with_cash_reversal(uuid, uuid, uuid, text) from public;
revoke all on function void_vehicle_expense_with_cash_reversal(uuid, uuid, uuid, text) from anon;
grant execute on function void_vehicle_expense_with_cash_reversal(uuid, uuid, uuid, text) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260829_cash_ledger_reversal_hardening.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
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


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260830_vehicle_correction_integrity.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
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
grant execute on function correct_vehicle_purchase(uuid, uuid, numeric, date, purchase_source, text) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260831_sale_cash_impact_integrity.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
-- Dealer Flow V2: make sale void/correction fail closed when cash links are ambiguous.
-- The functions keep their existing signatures so deployed clients remain compatible.

create or replace function void_vehicle_sale_atomic(
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
  company_original_id uuid;
  external_original_id uuid;
  company_reversal_id uuid;
  external_reversal_id uuid;
  company_cash_impact_count integer := 0;
  external_cash_impact_count integer := 0;
  clean_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if clean_reason is null then
    raise exception 'Sale void reason is required.';
  end if;

  perform 1
  from organizations
  where id = p_organization_id
  for update;

  if not found then
    raise exception 'organization not found';
  end if;

  select *
  into sale_record
  from sales
  where id = p_sale_id
    and organization_id = p_organization_id
  for update;

  if sale_record.id is null then
    raise exception 'sale not found';
  end if;

  if sale_record.voided_at is not null or sale_record.status <> 'active' then
    raise exception 'sale is already voided or corrected';
  end if;

  select *
  into vehicle_record
  from vehicles
  where id = sale_record.vehicle_id
    and organization_id = p_organization_id
  for update;

  if vehicle_record.id is null then
    raise exception 'vehicle not found';
  end if;

  if sale_record.paper_sale_price > 0 then
    perform 1
    from company_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
      and correction_of_transaction_id is null
      and type = 'paper_sale_received'
      and amount = sale_record.paper_sale_price
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      )
    for update;

    select count(*)::integer
    into company_cash_impact_count
    from company_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
      and correction_of_transaction_id is null
      and type = 'paper_sale_received'
      and amount = sale_record.paper_sale_price
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      );

    if company_cash_impact_count = 0 then
      raise exception 'Sale cash impact is missing; sale void was blocked.';
    end if;
    if company_cash_impact_count > 1 then
      raise exception 'Multiple active sale cash impacts exist; sale void was blocked.';
    end if;

    select id
    into company_original_id
    from company_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
      and correction_of_transaction_id is null
      and type = 'paper_sale_received'
      and amount = sale_record.paper_sale_price
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      )
    order by created_at asc
    limit 1
    for update;

    if organization_company_cash_balance(p_organization_id) - sale_record.paper_sale_price < 0 then
      raise exception 'Voiding this sale would make company cash negative.';
    end if;

    insert into company_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, correction_of_transaction_id, created_by
    )
    values (
      p_organization_id,
      'company_cash_withdrawn',
      sale_record.paper_sale_price,
      current_date,
      'Sale void reversal: ' || clean_reason,
      sale_record.vehicle_id,
      sale_record.id,
      company_original_id,
      auth.uid()
    )
    returning id into company_reversal_id;

    update company_cash_transactions
    set reversed_transaction_id = company_reversal_id,
        voided_at = now(),
        voided_by = auth.uid(),
        void_reason = clean_reason,
        updated_at = now()
    where id = company_original_id;
  end if;

  if sale_record.external_commission > 0 then
    perform 1
    from external_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
      and correction_of_transaction_id is null
      and type = 'external_commission_earned'
      and amount = sale_record.external_commission
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      )
    for update;

    select count(*)::integer
    into external_cash_impact_count
    from external_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
      and correction_of_transaction_id is null
      and type = 'external_commission_earned'
      and amount = sale_record.external_commission
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      );

    if external_cash_impact_count = 0 then
      raise exception 'Sale cash impact is missing; sale void was blocked.';
    end if;
    if external_cash_impact_count > 1 then
      raise exception 'Multiple active sale cash impacts exist; sale void was blocked.';
    end if;

    select id
    into external_original_id
    from external_cash_transactions
    where organization_id = p_organization_id
      and deleted_at is null
      and voided_at is null
      and reversed_transaction_id is null
      and correction_of_transaction_id is null
      and type = 'external_commission_earned'
      and amount = sale_record.external_commission
      and (
        source_sale_id = sale_record.id
        or (source_sale_id is null and source_vehicle_id = sale_record.vehicle_id and date = sale_record.sale_date)
      )
    order by created_at asc
    limit 1
    for update;

    if organization_external_cash_balance(p_organization_id) - sale_record.external_commission < 0 then
      raise exception 'Voiding this sale would make external cash negative.';
    end if;

    insert into external_cash_transactions (
      organization_id, type, amount, date, note, source_vehicle_id, source_sale_id, correction_of_transaction_id, created_by
    )
    values (
      p_organization_id,
      'external_cash_personally_removed',
      sale_record.external_commission,
      current_date,
      'Sale void reversal: ' || clean_reason,
      sale_record.vehicle_id,
      sale_record.id,
      external_original_id,
      auth.uid()
    )
    returning id into external_reversal_id;

    update external_cash_transactions
    set reversed_transaction_id = external_reversal_id,
        voided_at = now(),
        voided_by = auth.uid(),
        void_reason = clean_reason,
        updated_at = now()
    where id = external_original_id;
  end if;

  update sales
  set status = 'voided',
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = clean_reason,
      updated_at = now()
  where id = sale_record.id;

  update vehicles
  set status = 'listed_for_sale',
      updated_at = now()
  where id = sale_record.vehicle_id
    and organization_id = p_organization_id
    and status = 'sold';

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'sale_voided',
    'sale',
    sale_record.id,
    'Sale voided. Reason: ' || clean_reason,
    auth.uid()
  );

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'cash_transaction_reversed',
    'sale',
    sale_record.id,
    'Sale cash impacts reversed.',
    auth.uid()
  );

  return sale_record.id;
end;
$$;

create or replace function correct_vehicle_sale_atomic(
  p_organization_id uuid,
  p_sale_id uuid,
  p_sale_date date,
  p_taxable_profit_amount numeric,
  p_real_client_payment numeric,
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
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin','member']::app_role[]) then
    raise exception 'not allowed';
  end if;

  if clean_reason is null then
    raise exception 'Sale correction reason is required.';
  end if;

  perform 1
  from organizations
  where id = p_organization_id
  for update;

  if not found then
    raise exception 'organization not found';
  end if;

  select *
  into old_sale
  from sales
  where id = p_sale_id
    and organization_id = p_organization_id
  for update;

  if old_sale.id is null then
    raise exception 'sale not found';
  end if;

  perform void_vehicle_sale_atomic(p_organization_id, p_sale_id, 'Corrected sale: ' || clean_reason);

  new_sale_id := record_vehicle_sale_atomic(
    p_organization_id,
    old_sale.vehicle_id,
    p_sale_date,
    p_taxable_profit_amount,
    p_real_client_payment,
    p_buyer_name,
    p_phone,
    p_email,
    p_address,
    p_notes
  );

  if nullif(trim(coalesce(p_buyer_name, '')), '') is null and old_sale.contact_id is not null then
    update sales
    set contact_id = old_sale.contact_id
    where id = new_sale_id;
  end if;

  update sales
  set status = 'corrected',
      corrected_by_sale_id = new_sale_id,
      updated_at = now()
  where id = old_sale.id;

  update sales
  set correction_of_sale_id = old_sale.id,
      updated_at = now()
  where id = new_sale_id;

  insert into activity_logs (organization_id, action, entity_type, entity_id, message, created_by)
  values (
    p_organization_id,
    'sale_corrected',
    'sale',
    new_sale_id,
    'Sale correction created from ' || old_sale.id || '. Reason: ' || clean_reason,
    auth.uid()
  );

  return new_sale_id;
end;
$$;

revoke execute on function void_vehicle_sale_atomic(uuid, uuid, text) from public;
revoke execute on function void_vehicle_sale_atomic(uuid, uuid, text) from anon;
revoke execute on function correct_vehicle_sale_atomic(uuid, uuid, date, numeric, numeric, text, text, text, text, text, text) from public;
revoke execute on function correct_vehicle_sale_atomic(uuid, uuid, date, numeric, numeric, text, text, text, text, text, text) from anon;
grant execute on function void_vehicle_sale_atomic(uuid, uuid, text) to authenticated;
grant execute on function correct_vehicle_sale_atomic(uuid, uuid, date, numeric, numeric, text, text, text, text, text, text) to authenticated;


-- ============================================================================
-- MANUAL SECTION: supabase/migrations/20260832_validation_domain_integrity_hardening.sql
-- Apply this section in the listed order. Do not skip earlier sections.
-- ============================================================================
-- Forward hardening for validation_domain_integrity.
-- Existing duplicate active VINs are preserved for investigation; new writes
-- are serialized and blocked instead of silently deleting or rewriting history.

update vehicles
set vin = ''
where vin is null;

alter table vehicles
  alter column vin set default '';

alter table vehicles
  alter column vin set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_vin_quality') then
    alter table vehicles
      add constraint vehicles_vin_quality
      check (vin = '' or vin ~ '^[A-HJ-NPR-Z0-9]{17}$') not valid;
  end if;
end $$;

create or replace function prevent_duplicate_active_vehicle_vin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_vin text;
begin
  new.vin := normalize_vehicle_vin(new.vin);
  normalized_vin := new.vin;

  if new.archived_at is null and normalized_vin <> '' then
    -- Serialize the same organization/VIN key so two concurrent requests
    -- cannot both pass the duplicate check before either row commits.
    perform pg_advisory_xact_lock(
      hashtextextended(new.organization_id::text || ':' || normalized_vin, 0)
    );

    if exists (
      select 1
      from vehicles existing
      where existing.organization_id = new.organization_id
        and existing.id <> new.id
        and existing.archived_at is null
        and normalize_vehicle_vin(existing.vin) = normalized_vin
    ) then
      raise exception 'Another active vehicle already uses this VIN.'
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_duplicate_active_vehicle_vin on vehicles;
create trigger prevent_duplicate_active_vehicle_vin
before insert or update of organization_id, vin, archived_at on vehicles
for each row execute function prevent_duplicate_active_vehicle_vin();

-- Retry the unique index when a previous migration skipped it because legacy
-- duplicates existed. The trigger above still protects new writes if they do.
do $$
begin
  if not exists (
    select 1
    from vehicles
    where archived_at is null
      and normalize_vehicle_vin(vin) <> ''
    group by organization_id, normalize_vehicle_vin(vin)
    having count(*) > 1
  ) then
    create unique index if not exists vehicles_org_active_vin_unique_idx
      on vehicles (organization_id, normalize_vehicle_vin(vin))
      where archived_at is null and normalize_vehicle_vin(vin) <> '';
  end if;
end $$;

-- Only the account-specific manual entry types are insertable by users.
-- Expense, sale, and transfer cash rows are created by security-definer RPCs.
drop policy if exists "write company cash" on company_cash_transactions;
drop policy if exists "insert company expense cash impact" on company_cash_transactions;
drop policy if exists "write external cash" on external_cash_transactions;
drop policy if exists "insert external expense cash impact" on external_cash_transactions;

drop policy if exists "insert manual company cash" on company_cash_transactions;
create policy "insert manual company cash" on company_cash_transactions
for insert
with check (
  type in ('company_cash_added', 'company_cash_withdrawn')
  and source_vehicle_id is null
  and source_expense_id is null
  and source_sale_id is null
  and transfer_pair_id is null
  and correction_of_transaction_id is null
  and reversed_transaction_id is null
  and voided_at is null
  and has_org_role(organization_id, array['owner','admin']::app_role[])
);

drop policy if exists "insert manual external cash" on external_cash_transactions;
create policy "insert manual external cash" on external_cash_transactions
for insert
with check (
  type in ('external_cash_added', 'external_cash_personally_removed')
  and source_vehicle_id is null
  and source_expense_id is null
  and source_sale_id is null
  and transfer_pair_id is null
  and correction_of_transaction_id is null
  and reversed_transaction_id is null
  and voided_at is null
  and has_org_role(organization_id, array['owner','admin']::app_role[])
);

revoke all on function prevent_duplicate_active_vehicle_vin() from public;
revoke all on function prevent_duplicate_active_vehicle_vin() from anon;
revoke all on function prevent_duplicate_active_vehicle_vin() from authenticated;

