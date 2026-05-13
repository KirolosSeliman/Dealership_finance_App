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
