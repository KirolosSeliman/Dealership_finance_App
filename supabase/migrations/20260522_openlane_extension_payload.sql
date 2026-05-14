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
