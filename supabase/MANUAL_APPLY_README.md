# Dealer Flow Supabase manual setup

Use [MANUAL_APPLY_ALL.sql](./MANUAL_APPLY_ALL.sql) for manual copy/paste into the Supabase SQL Editor.

The bundle contains 40 ordered sections:

1. `supabase/schema.sql`
2. The three legacy root SQL files under `supabase/`
3. Every SQL file under `supabase/migrations/`, sorted by filename

Recommended process:

1. Create or select the correct Supabase project.
2. Copy and run one `MANUAL SECTION` at a time, starting with `schema.sql`.
3. Wait for success before running the next section.
4. Do not rerun a section that already succeeded on an existing project unless you have reviewed its SQL; not every historical migration is idempotent.
5. Verify the final migrations, RLS policies, private storage bucket, and security-definer grants in staging before production.

The bundle includes `20260826_permanent_vehicle_purge.sql` because it is part of the repository SQL set. That migration defines an exceptional, separately protected purge RPC; the normal application workflow uses archive and does not call the purge RPC.

The `20260507_sales_member_policy.sql` policy appears once in the legacy root files and once in the migrations directory because both files exist in the repository. The later copy safely replaces the earlier policy on a clean setup.
