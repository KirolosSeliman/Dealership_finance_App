-- Normal vehicle removal is archive-only. Keep the historical purge function
-- available in migration history, but do not expose it to application users.
revoke all on function purge_vehicle_completely(uuid, uuid, text) from public;
revoke all on function purge_vehicle_completely(uuid, uuid, text) from authenticated;

grant execute on function archive_vehicle(uuid, uuid, text) to authenticated;
