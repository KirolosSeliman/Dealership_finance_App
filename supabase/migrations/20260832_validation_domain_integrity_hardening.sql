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
