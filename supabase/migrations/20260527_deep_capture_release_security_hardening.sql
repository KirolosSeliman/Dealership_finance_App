-- Deep Capture release security hardening.
-- The retention cleanup function is a maintenance routine with broad delete/sanitize
-- behavior, so it must be callable only by the service role used by trusted backend jobs.

revoke execute on function cleanup_market_snap_deep_capture_retention() from public;
revoke execute on function cleanup_market_snap_deep_capture_retention() from anon;
revoke execute on function cleanup_market_snap_deep_capture_retention() from authenticated;
grant execute on function cleanup_market_snap_deep_capture_retention() to service_role;
