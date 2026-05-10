create or replace function join_organization_by_access_code(invitation_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into invitation
  from organization_invitations
  where upper(access_code) = upper(trim(invitation_code))
    and (expires_at is null or expires_at > now())
  limit 1;

  if invitation.id is null then
    raise exception 'invalid or expired invitation code';
  end if;

  insert into profiles (id)
  values (auth.uid())
  on conflict (id) do nothing;

  insert into organization_memberships (organization_id, user_id, role)
  values (invitation.organization_id, auth.uid(), 'viewer')
  on conflict (organization_id, user_id) do update
    set role = organization_memberships.role,
        updated_at = now();

  insert into user_preferences (user_id, active_organization_id)
  values (auth.uid(), invitation.organization_id)
  on conflict (user_id) do update set active_organization_id = excluded.active_organization_id;

  return invitation.organization_id;
end;
$$;

do $$
begin
  if exists (
    select 1
    from organization_memberships
    group by organization_id, user_id
    having count(*) > 1
  ) then
    raise notice 'Duplicate organization memberships exist. The app now resolves the highest role safely, but run the diagnostic SQL and manually clean duplicates before adding the unique constraint.';
  elsif not exists (
    select 1
    from pg_constraint
    where conname = 'organization_memberships_organization_id_user_id_key'
  ) then
    alter table organization_memberships
      add constraint organization_memberships_organization_id_user_id_key unique (organization_id, user_id);
  end if;
end $$;
