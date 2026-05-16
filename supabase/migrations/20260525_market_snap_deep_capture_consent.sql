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
