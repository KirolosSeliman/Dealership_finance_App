-- Market Snap production hardening: restrict maintenance functions and model-version writes.

revoke execute on function cleanup_market_snap_retention() from authenticated;
grant execute on function cleanup_market_snap_retention() to service_role;

drop policy if exists "admins manage model versions" on ml_model_versions;
create policy "service role manages model versions" on ml_model_versions
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create index if not exists market_data_jobs_type_status_idx
  on market_data_jobs (job_type, status, created_at desc);

create index if not exists market_data_jobs_org_type_created_idx
  on market_data_jobs (organization_id, job_type, created_at desc);
