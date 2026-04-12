# CRM v2 Cutover Runbook

This runbook migrates CRM from legacy tables (`deals`, `deal_activities`, `crm_pipelines`, `crm_stages`) to CRM v2 tables introduced by migration `013_crm_v2_rebuild.sql`.

## Scope

- Single shared agency organization.
- Clean-break application switch to `/api/crm/v2`.
- One-time data migration with rollback snapshot.

## Preconditions

- Deploy code containing:
  - `supabase/migrations/013_crm_v2_rebuild.sql`
  - `scripts/crm_v2_backfill.sql`
  - CRM frontend switched to `crm/v2` endpoints.
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is set in production runtime.
- Schedule a short write-freeze window for CRM actions.

## 1) Staging dry run

Run these in staging first:

1. Apply DB migration 013.
2. Execute `scripts/crm_v2_backfill.sql`.
3. Smoke test:
   - `/api/crm/v2/board`
   - `/api/crm/v2/reporting`
   - `/api/crm/v2/opportunities/from-lead`
4. Check row parity:
   - `select count(*) from deals;`
   - `select count(*) from crm_opportunities where legacy_deal_id is not null;`
   - `select count(*) from deal_activities;`
   - `select count(*) from crm_activities where metadata ? 'legacy_activity_id';`

## 2) Production cutover

1. Announce CRM write freeze (no drag/drop, no add-to-pipeline actions).
2. Create rollback snapshot:
   - DB backup / PITR bookmark before migration.
3. Apply migration `013_crm_v2_rebuild.sql`.
4. Run `scripts/crm_v2_backfill.sql`.
5. Verify:
   - No SQL errors.
   - `crm_pipelines_v2` and `crm_stages_v2` populated.
   - `crm_opportunities` row count close to `deals` row count.
6. Deploy app version using `/api/crm/v2` and new CRM shell.
7. Unfreeze CRM writes.

## 3) Post-cutover checks

- Board
  - Open `/crm`, verify stages render and cards move between columns.
- Prospect 360
  - Open a prospect, add note, create task, create meeting.
- Lead generator integration
  - Add lead to CRM and verify success/duplicate messaging.
- Reporting
  - Verify funnel, owner performance, and velocity payload exists.
- RLS
  - Test with two different agency users; both should see/edit shared CRM records.

## 4) Rollback plan

If severe issues occur:

1. Re-enable legacy CRM UI/API routes (rollback app deploy).
2. Restore DB from snapshot (or PITR bookmark) taken before step 2.3.
3. Re-run smoke checks on legacy `/api/crm/board` and drag/drop.
4. Investigate, patch, and rerun full staging dry run.

## 5) Acceptance criteria

- No empty-board false negatives for valid agency users.
- Legacy deals available as v2 opportunities with stage history seed.
- Add-to-CRM from lead generator uses v2 endpoint and handles duplicates.
- Prospect timeline and tasks persist correctly.
- Reporting endpoint returns non-empty aggregates when CRM data exists.
