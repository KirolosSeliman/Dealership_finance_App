create table if not exists rate_limit_buckets (
  bucket text not null,
  identifier_hash text not null,
  count integer not null default 0 check (count >= 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (bucket, identifier_hash)
);

revoke all on table rate_limit_buckets from public;
revoke all on table rate_limit_buckets from anon;
revoke all on table rate_limit_buckets from authenticated;

create or replace function check_rate_limit(
  p_bucket text,
  p_identifier_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_time timestamptz := clock_timestamp();
  window_interval interval := make_interval(secs => greatest(p_window_seconds, 1));
  bucket_record rate_limit_buckets%rowtype;
begin
  if length(trim(coalesce(p_bucket, ''))) = 0 then
    raise exception 'rate limit bucket is required';
  end if;
  if length(trim(coalesce(p_identifier_hash, ''))) = 0 then
    raise exception 'rate limit identity is required';
  end if;
  if p_limit < 1 then
    raise exception 'rate limit must be positive';
  end if;

  insert into rate_limit_buckets (bucket, identifier_hash, count, reset_at, updated_at)
  values (p_bucket, p_identifier_hash, 1, now_time + window_interval, now_time)
  on conflict (bucket, identifier_hash)
  do update set
    count = case
      when rate_limit_buckets.reset_at <= now_time then 1
      else rate_limit_buckets.count + 1
    end,
    reset_at = case
      when rate_limit_buckets.reset_at <= now_time then now_time + window_interval
      else rate_limit_buckets.reset_at
    end,
    updated_at = now_time
  returning * into bucket_record;

  return jsonb_build_object(
    'allowed', bucket_record.count <= p_limit,
    'remaining', greatest(p_limit - bucket_record.count, 0),
    'resetAt', bucket_record.reset_at
  );
end;
$$;

revoke execute on function check_rate_limit(text, text, integer, integer) from public;
grant execute on function check_rate_limit(text, text, integer, integer) to anon, authenticated;

create index if not exists rate_limit_buckets_reset_idx on rate_limit_buckets (reset_at);
