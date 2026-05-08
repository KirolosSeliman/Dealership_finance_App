drop policy if exists "write sales" on sales;

create policy "write sales"
on sales
for insert
with check (has_org_role(organization_id, array['owner','admin','member']::app_role[]));
