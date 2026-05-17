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
