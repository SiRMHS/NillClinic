-- Scheduled incremental sync ------------------------------------------------

ALTER TABLE "sync_settings"
  ADD COLUMN IF NOT EXISTS "schedule_enabled"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "interval_minutes"      INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "lookback_days"         INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS "schedule_entities"     "SyncEntity"[] NOT NULL DEFAULT ARRAY[]::"SyncEntity"[],
  ADD COLUMN IF NOT EXISTS "last_run_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "next_run_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_run_status"       "SyncStatus",
  ADD COLUMN IF NOT EXISTS "last_run_message"      TEXT,
  ADD COLUMN IF NOT EXISTS "last_run_read"         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_run_upserted"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "last_run_duration_ms"  INTEGER;

-- Permission catalogue split -------------------------------------------------
--
-- Financial figures used to ride along with the "analytics" key. They are now
-- separately grantable, so every role that could already see money keeps it —
-- otherwise widening the catalogue would silently revoke access on deploy.
-- Only the parent keys are added; "financial" implies its own children in code.
UPDATE "roles"
SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['financial']))
WHERE 'analytics' = ANY("permissions") AND NOT ('financial' = ANY("permissions"));

-- "visitors" was likewise reachable through "analytics"; it is implied in code
-- rather than stored, so nothing to backfill there.
