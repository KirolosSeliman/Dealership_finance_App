alter table vehicles
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references profiles(id),
  add column if not exists archive_reason text;

create index if not exists vehicles_org_active_status_idx
  on vehicles (organization_id, status)
  where archived_at is null;

create or replace function archive_vehicle(
  p_organization_id uuid,
  p_vehicle_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_record vehicles%rowtype;
  clean_reason text;
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

  if vehicle_record.archived_at is not null then
    raise exception 'vehicle already archived';
  end if;

  clean_reason := nullif(left(trim(coalesce(p_reason, '')), 500), '');

  update vehicles
  set archived_at = now(),
      archived_by = auth.uid(),
      archive_reason = clean_reason,
      updated_at = now()
  where id = p_vehicle_id
    and organization_id = p_organization_id;

  insert into activity_logs (
    organization_id,
    action,
    entity_type,
    entity_id,
    message,
    created_by
  )
  values (
    p_organization_id,
    'vehicle_archived',
    'vehicle',
    p_vehicle_id,
    'Vehicle archived. Financial, tax, sale, cash, attachment, and activity records were preserved.' ||
      case when clean_reason is null then '' else ' Reason: ' || clean_reason end,
    auth.uid()
  );
end;
$$;

revoke all on function archive_vehicle(uuid, uuid, text) from public;
grant execute on function archive_vehicle(uuid, uuid, text) to authenticated;

create or replace function delete_vehicle_and_related_data(
  p_organization_id uuid,
  p_vehicle_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'delete_vehicle_and_related_data is deprecated. Use archive_vehicle to preserve financial history.';
end;
$$;

revoke all on function delete_vehicle_and_related_data(uuid, uuid) from public;
grant execute on function delete_vehicle_and_related_data(uuid, uuid) to authenticated;
