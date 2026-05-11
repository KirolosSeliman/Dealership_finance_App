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
