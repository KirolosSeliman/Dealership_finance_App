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
