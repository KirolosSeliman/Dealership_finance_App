drop function if exists delete_vehicle_and_related_data(uuid, uuid);

create or replace function delete_vehicle_and_related_data(
  p_organization_id uuid,
  p_vehicle_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  sale_ids uuid[] := '{}'::uuid[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not has_org_role(p_organization_id, array['owner','admin']::app_role[]) then
    raise exception 'not allowed';
  end if;

  select *
  into vehicle_record
  from vehicles
  where id = p_vehicle_id
    and organization_id = p_organization_id
  for update;

  if vehicle_record.id is null then
    raise exception 'vehicle not found';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into sale_ids
  from sales
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  delete from tax_reports
  where organization_id = p_organization_id
    and report_json::text ilike ('%' || p_vehicle_id::text || '%');

  delete from attachments
  where organization_id = p_organization_id
    and (
      vehicle_id = p_vehicle_id
      or expense_id in (
        select id
        from vehicle_expenses
        where organization_id = p_organization_id
          and vehicle_id = p_vehicle_id
      )
      or sale_id = any(sale_ids)
      or company_cash_transaction_id in (
        select id
        from company_cash_transactions
        where organization_id = p_organization_id
          and source_vehicle_id = p_vehicle_id
      )
      or external_cash_transaction_id in (
        select id
        from external_cash_transactions
        where organization_id = p_organization_id
          and source_vehicle_id = p_vehicle_id
      )
    );

  delete from company_cash_transactions
  where organization_id = p_organization_id
    and (
      source_vehicle_id = p_vehicle_id
      or source_expense_id in (
        select id
        from vehicle_expenses
        where organization_id = p_organization_id
          and vehicle_id = p_vehicle_id
      )
    );

  delete from external_cash_transactions
  where organization_id = p_organization_id
    and (
      source_vehicle_id = p_vehicle_id
      or source_expense_id in (
        select id
        from vehicle_expenses
        where organization_id = p_organization_id
          and vehicle_id = p_vehicle_id
      )
    );

  delete from sales
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  delete from vehicle_expenses
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id;

  delete from activity_logs
  where organization_id = p_organization_id
    and (
      (entity_type = 'vehicle' and entity_id = p_vehicle_id)
      or (entity_type = 'sale' and entity_id = any(sale_ids))
    );

  delete from vehicles
  where id = p_vehicle_id
    and organization_id = p_organization_id;
end;
$$;

revoke all on function delete_vehicle_and_related_data(uuid, uuid) from public;
grant execute on function delete_vehicle_and_related_data(uuid, uuid) to authenticated;
