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
