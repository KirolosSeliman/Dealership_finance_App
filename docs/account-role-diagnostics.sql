-- Replace this email with your login email, then run sections one by one in Supabase SQL editor.
-- These queries do not modify data.

-- 1. Find your auth user id.
select id, email, created_at
from auth.users
where lower(email) = lower('kirolos.selimann@yahoo.com');

-- 2. List every organization membership for your account.
select
  m.id as membership_id,
  m.organization_id,
  o.name as organization_name,
  m.user_id,
  u.email,
  m.role,
  m.created_at,
  m.updated_at
from organization_memberships m
join organizations o on o.id = m.organization_id
join auth.users u on u.id = m.user_id
where lower(u.email) = lower('kirolos.selimann@yahoo.com')
order by o.name, m.created_at desc;

-- 3. Detect duplicate memberships for your account.
select
  m.organization_id,
  o.name as organization_name,
  m.user_id,
  u.email,
  count(*) as membership_count,
  array_agg(m.role order by m.created_at desc) as roles,
  array_agg(m.id order by m.created_at desc) as membership_ids
from organization_memberships m
join organizations o on o.id = m.organization_id
join auth.users u on u.id = m.user_id
where lower(u.email) = lower('kirolos.selimann@yahoo.com')
group by m.organization_id, o.name, m.user_id, u.email
having count(*) > 1;

-- 4. Show your active organization preference.
select
  p.user_id,
  u.email,
  p.active_organization_id,
  o.name as active_organization_name,
  p.selected_language,
  p.updated_at
from user_preferences p
join auth.users u on u.id = p.user_id
left join organizations o on o.id = p.active_organization_id
where lower(u.email) = lower('kirolos.selimann@yahoo.com');

-- 5. Show invitation codes for organizations where you are owner/admin.
select
  i.organization_id,
  o.name as organization_name,
  i.access_code,
  i.default_role,
  i.created_at,
  i.expires_at
from organization_invitations i
join organizations o on o.id = i.organization_id
join organization_memberships m on m.organization_id = o.id
join auth.users u on u.id = m.user_id
where lower(u.email) = lower('kirolos.selimann@yahoo.com')
  and m.role in ('owner', 'admin')
order by i.created_at desc;
