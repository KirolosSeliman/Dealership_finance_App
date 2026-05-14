-- Market Snap production guardrails: store sold-outcome error and expose calibration reporting.

create index if not exists vehicle_valuations_sale_outcome_lookup_idx
  on vehicle_valuations (organization_id, vehicle_id, valuation_date desc)
  where vehicle_id is not null;

create or replace function apply_market_snap_sale_outcome()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  valuation_record vehicle_valuations%rowtype;
  actual_price numeric(12,2);
begin
  if new.status <> 'active' or new.voided_at is not null then
    return new;
  end if;

  actual_price := round(coalesce(new.paper_sale_price, new.real_client_payment, 0)::numeric, 2);
  if actual_price <= 0 then
    return new;
  end if;

  select *
  into valuation_record
  from vehicle_valuations
  where organization_id = new.organization_id
    and vehicle_id = new.vehicle_id
    and valuation_date <= coalesce(new.created_at, now())
  order by valuation_date desc
  limit 1;

  if valuation_record.id is null then
    return new;
  end if;

  new.market_snap_valuation_id := valuation_record.id;
  new.market_snap_estimated_retail_value := valuation_record.estimated_retail_market_value;
  new.market_snap_prediction_error := round((actual_price - valuation_record.estimated_retail_market_value)::numeric, 2);
  new.market_snap_prediction_error_percent := case
    when actual_price = 0 then null
    else round(((actual_price - valuation_record.estimated_retail_market_value) / actual_price)::numeric, 4)
  end;
  new.market_snap_model_version := valuation_record.model_version;
  new.market_snap_final_profit := new.taxable_profit_amount;

  return new;
end;
$$;

drop trigger if exists apply_market_snap_sale_outcome_before_insert on sales;
create trigger apply_market_snap_sale_outcome_before_insert
before insert on sales
for each row
execute function apply_market_snap_sale_outcome();

drop trigger if exists apply_market_snap_sale_outcome_before_update on sales;
create trigger apply_market_snap_sale_outcome_before_update
before update of paper_sale_price, real_client_payment, status, voided_at on sales
for each row
execute function apply_market_snap_sale_outcome();

create or replace function market_snap_calibration_report(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  with outcomes as (
    select
      s.market_snap_estimated_retail_value::numeric as estimate,
      s.paper_sale_price::numeric as actual,
      abs(s.paper_sale_price - s.market_snap_estimated_retail_value)::numeric as absolute_error,
      case
        when s.paper_sale_price = 0 then null
        else abs(s.paper_sale_price - s.market_snap_estimated_retail_value) / s.paper_sale_price
      end as percentage_error,
      coalesce(v.make, 'Unknown') as make,
      coalesce(v.model, 'Unknown') as model,
      coalesce(v.purchase_source::text, 'Unknown') as source_name,
      coalesce(vv.confidence_score, 0) as confidence_score
    from sales s
    join vehicles v on v.id = s.vehicle_id and v.organization_id = s.organization_id
    left join vehicle_valuations vv on vv.id = s.market_snap_valuation_id
    where s.organization_id = p_organization_id
      and s.status = 'active'
      and s.voided_at is null
      and s.market_snap_estimated_retail_value is not null
      and s.paper_sale_price > 0
  ),
  summary as (
    select
      count(*) as outcome_count,
      coalesce(round(avg(absolute_error), 2), 0) as average_error,
      coalesce(round(percentile_cont(0.5) within group (order by absolute_error)::numeric, 2), 0) as median_error,
      coalesce(round(avg(percentage_error), 4), 0) as average_percentage_error
    from outcomes
  )
  select jsonb_build_object(
    'outcomeCount', summary.outcome_count,
    'averageError', summary.average_error,
    'medianError', summary.median_error,
    'averagePercentageError', summary.average_percentage_error,
    'errorByMakeModel', coalesce((
      select jsonb_agg(row_to_json(grouped))
      from (
        select make || ' ' || model as make_model, count(*) as outcome_count, round(avg(absolute_error), 2) as average_error
        from outcomes
        group by make, model
        order by count(*) desc, make, model
      ) grouped
    ), '[]'::jsonb),
    'errorBySource', coalesce((
      select jsonb_agg(row_to_json(grouped))
      from (
        select source_name, count(*) as outcome_count, round(avg(absolute_error), 2) as average_error
        from outcomes
        group by source_name
        order by count(*) desc, source_name
      ) grouped
    ), '[]'::jsonb),
    'confidenceVsError', coalesce((
      select jsonb_agg(row_to_json(grouped))
      from (
        select
          case
            when confidence_score >= 80 then '80-100'
            when confidence_score >= 60 then '60-79'
            when confidence_score >= 40 then '40-59'
            else '0-39'
          end as confidence_band,
          count(*) as outcome_count,
          round(avg(absolute_error), 2) as average_error
        from outcomes
        group by 1
        order by 1
      ) grouped
    ), '[]'::jsonb)
  )
  into result
  from summary;

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke execute on function apply_market_snap_sale_outcome() from authenticated;
grant execute on function market_snap_calibration_report(uuid) to authenticated;
