# Dealer Flow Supabase manual setup

Use [MANUAL_APPLY_ALL.sql](./MANUAL_APPLY_ALL.sql) for manual copy/paste into the Supabase SQL Editor.

The bundle contains 41 ordered sections:

1. `supabase/schema.sql`
2. The three legacy root SQL files under `supabase/`
3. Every SQL file under `supabase/migrations/`, sorted by filename

For a blank project, use the full bundle in order:

1. Create or select the correct Supabase project.
2. Copy and run one `MANUAL SECTION` at a time, starting with `schema.sql`.
3. Wait for success before running the next section.
4. Do not rerun a section that already succeeded on an existing project unless you have reviewed its SQL; not every historical migration is idempotent.
5. Verify the final migrations, RLS policies, private storage bucket, and security-definer grants in staging before production.

For an existing project, do not rerun `schema.sql` or the legacy root sections. First run the preflight checks from the current task, then apply only the missing migration sections in filename order. If the database already contains `external_vehicle_expense_refunded` rows, skip the standalone `20260821_external_cash_manual_add.sql` section and apply the compatible `20260823_atomic_external_cash_transfer.sql` section instead; the latter includes that existing type while adding the transfer-pair support.

The SQL Editor does not provide reliable migration history for manually pasted sections, so verify object existence and row counts after each section. A failed section should be corrected and rerun only after inspecting the error; do not continue blindly.

The bundle includes `20260826_permanent_vehicle_purge.sql` because it is part of the repository SQL set. That migration defines an exceptional, separately protected purge RPC; the normal application workflow uses archive and does not call the purge RPC.

The `20260507_sales_member_policy.sql` policy appears once in the legacy root files and once in the migrations directory because both files exist in the repository. The later copy safely replaces the earlier policy on a clean setup.

The final section is `supabase/migrations/20260833_accounting_model_v2.sql`. For an existing production project, apply that file only after the preceding migrations are present; it is the single forward-only Accounting Model V2 schema/RPC migration and preserves legacy financial rows. The same complete SQL is kept in that migration file as the copy/paste source for the final manual section.
