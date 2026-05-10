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
  contact_ids uuid[] := '{}'::uuid[];
  v_contact_id uuid;
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

  select coalesce(array_agg(distinct contact_id), '{}'::uuid[])
  into contact_ids
  from sales
  where organization_id = p_organization_id
    and vehicle_id = p_vehicle_id
    and contact_id is not null;

  delete from tax_reports
  where organization_id = p_organization_id
    and report_json::text ilike ('%' || p_vehicle_id::text || '%');

  delete from activity_logs
  where organization_id = p_organization_id
    and (
      (entity_type = 'vehicle' and entity_id = p_vehicle_id)
      or (entity_type = 'sale' and entity_id = any(sale_ids))
      or (entity_type = 'contact' and entity_id = any(contact_ids))
    );

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

  foreach v_contact_id in array contact_ids loop
    if exists (
      select 1
      from sales
      where organization_id = p_organization_id
        and contact_id = v_contact_id
        and vehicle_id <> p_vehicle_id
    ) then
      continue;
    end if;

    if exists (
      select 1
      from attachments
      where organization_id = p_organization_id
        and contact_id = v_contact_id
        and (
          vehicle_id is null
          or vehicle_id <> p_vehicle_id
        )
        and (
          sale_id is null
          or sale_id <> all(sale_ids)
        )
    ) then
      continue;
    end if;

    delete from attachments
    where organization_id = p_organization_id
      and contact_id = v_contact_id;

    delete from contacts
    where id = v_contact_id
      and organization_id = p_organization_id;
  end loop;

  delete from vehicles
  where id = p_vehicle_id
    and organization_id = p_organization_id;
end;
$$;
