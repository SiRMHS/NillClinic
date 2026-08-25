-- Spend-based value tiers, alongside the existing RFM behaviour segments.

CREATE TYPE "PatientTier" AS ENUM ('PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'GRAY');

ALTER TABLE "patient_metrics"
  ADD COLUMN "tier" "PatientTier" NOT NULL DEFAULT 'GRAY';

CREATE INDEX "patient_metrics_tier_idx" ON "patient_metrics"("tier");

-- Thresholds are editable, so they are data rather than constants in the
-- scoring SQL. Single row, id = 1.
CREATE TABLE "tier_settings" (
  "id"           INTEGER NOT NULL DEFAULT 1,
  "platinum_min" DECIMAL(18,2) NOT NULL DEFAULT 500000000,
  "gold_min"     DECIMAL(18,2) NOT NULL DEFAULT 200000000,
  "silver_min"   DECIMAL(18,2) NOT NULL DEFAULT 50000000,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tier_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "tier_settings" ("id", "updated_at") VALUES (1, NOW())
  ON CONFLICT ("id") DO NOTHING;

-- Reporting indexes for the doctor / referral reports, which scan
-- reception_items by practitioner and service across a date range.
CREATE INDEX IF NOT EXISTS "reception_items_service_name_idx"
  ON "reception_items"("service_name");
CREATE INDEX IF NOT EXISTS "reception_items_reception_date_idx"
  ON "reception_items"("reception_date");
