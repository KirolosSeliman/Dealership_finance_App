-- Deep Capture release security hardening.
-- Defensive follow-up for environments where 20260526 was inspected or applied before
-- service-role-only cleanup grants were included.

do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'cleanup_market_snap_deep_capture_retention'
      and pg_get_function_identity_arguments(p.oid) = ''
  ) then
    execute 'revoke execute on function public.cleanup_market_snap_deep_capture_retention() from public';

    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke execute on function public.cleanup_market_snap_deep_capture_retention() from anon';
    end if;

    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'revoke execute on function public.cleanup_market_snap_deep_capture_retention() from authenticated';
    end if;

    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute 'grant execute on function public.cleanup_market_snap_deep_capture_retention() to service_role';
    end if;
  end if;
end $$;
