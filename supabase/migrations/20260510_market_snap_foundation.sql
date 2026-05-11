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
