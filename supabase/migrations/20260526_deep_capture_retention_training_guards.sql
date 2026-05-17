-- Deep Capture persistence guardrails.
-- Adds consent/retention/provenance metadata to OpenLane capture rows and requires
-- separate model-improvement opt-in before verified outcomes can feed training exports.

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

drop function if exists market_snap_training_export_quality_report(uuid);
drop view if exists openlane_verified_wholesale_training;
drop view if exists openlane_acquisition_cost_training;

create view openlane_verified_wholesale_training
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

create view openlane_acquisition_cost_training
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

create or replace function cleanup_market_snap_deep_capture_retention()
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
grant execute on function market_snap_training_export_quality_report(uuid) to authenticated;
revoke execute on function cleanup_market_snap_deep_capture_retention() from public;
revoke execute on function cleanup_market_snap_deep_capture_retention() from anon;
revoke execute on function cleanup_market_snap_deep_capture_retention() from authenticated;
grant execute on function cleanup_market_snap_deep_capture_retention() to service_role;
