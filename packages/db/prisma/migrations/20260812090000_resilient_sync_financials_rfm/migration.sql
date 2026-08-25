-- Rebuild of the CRM sync data model.
--
-- Context: the previous sync was structurally unable to hold correct data.
--   * reserves' unique key (reserve_date, reserve_time, doctor_name) is not
--     unique in the source: 3 patients routinely share one doctor/time slot.
--     840,787 records synced but only 767,693 rows survived — ~71k overwrote
--     each other. Replaced by a synthetic external_key over the full identity.
--   * Every monetary field the CRM returns (received/remain/discount/deposit)
--     was stripped by the zod schema and never stored. Now first-class columns
--     plus a reception_items line table.
--   * Columns the CRM actually returns null for (gender, doctor_name, ...)
--     were NOT NULL, so ~6.7k patients and ~2k reserves were rejected outright.
--
-- The CRM tables are emptied first: the surviving rows are known-lossy and a
-- clean re-sync is cheap, whereas an in-place upsert could not recover records
-- that were overwritten. Non-CRM data (users, roles, leads, campaigns, webhook
-- logs, audit) is untouched. Verified beforehand: zero leads referenced a
-- synced patient.
--
-- TRUNCATE, not DELETE: patients is referenced by four ON DELETE SET NULL
-- foreign keys whose columns were never indexed, so a row-wise DELETE fires
-- "UPDATE reserves SET patient_id = NULL WHERE patient_id = $1" per patient —
-- a sequential scan of 767k rows, 113,807 times over. TRUNCATE skips per-row
-- referential triggers entirely. The missing FK indexes are created further
-- down so ordinary deletes and patient-scoped lookups stop degrading too.

UPDATE "leads" SET "converted_patient_id" = NULL WHERE "converted_patient_id" IS NOT NULL;

-- TRUNCATE requires every referencing table in the same statement. leads is
-- deliberately kept, so its FK is dropped here and restored after the DDL.
ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_converted_patient_id_fkey";

TRUNCATE TABLE "treatments", "receptions", "reserves", "services", "patients";

-- CreateEnum
CREATE TYPE "PatientSegment" AS ENUM ('CHAMPION', 'LOYAL', 'POTENTIAL', 'NEW', 'AT_RISK', 'DORMANT', 'LOST');

-- DropIndex
DROP INDEX "reserves_reserve_date_reserve_time_doctor_name_key";

-- AlterTable
ALTER TABLE "receptions" ADD COLUMN     "item_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reception_at" TIMESTAMP(3),
ADD COLUMN     "total_deposit" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "total_discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "total_received" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "total_remain" DECIMAL(18,2) NOT NULL DEFAULT 0,
ALTER COLUMN "reception_no" DROP NOT NULL,
ALTER COLUMN "reception_date" DROP NOT NULL,
ALTER COLUMN "user_name" DROP NOT NULL;

-- AlterTable
ALTER TABLE "reserves" ADD COLUMN     "external_key" TEXT NOT NULL,
ADD COLUMN     "patient_external_code" INTEGER,
ADD COLUMN     "patient_mobile" TEXT,
ADD COLUMN     "patient_mobile_enc" TEXT,
ADD COLUMN     "patient_name" TEXT,
ADD COLUMN     "patient_name_enc" TEXT,
ADD COLUMN     "services_list" JSONB NOT NULL DEFAULT '[]',
ALTER COLUMN "reserve_date" DROP NOT NULL,
ALTER COLUMN "reserve_time" DROP NOT NULL,
ALTER COLUMN "doctor_name" DROP NOT NULL;

-- AlterTable
ALTER TABLE "services" ALTER COLUMN "section_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sync_job_states" ADD COLUMN     "cursor_date" TEXT;

-- AlterTable
ALTER TABLE "sync_settings" ALTER COLUMN "id" SET DEFAULT 1,
ALTER COLUMN "throttle_delay_ms" SET DEFAULT 0,
ALTER COLUMN "page_size" SET DEFAULT 1000;

-- AlterTable
ALTER TABLE "treatments" ALTER COLUMN "external_patient_code" DROP NOT NULL,
ALTER COLUMN "plan_date" DROP NOT NULL,
ALTER COLUMN "plan_name" DROP NOT NULL,
ALTER COLUMN "plan_user" DROP NOT NULL;

-- CreateTable
CREATE TABLE "reception_items" (
    "id" TEXT NOT NULL,
    "reception_id" TEXT NOT NULL,
    "reception_external_id" INTEGER NOT NULL,
    "line_no" INTEGER NOT NULL,
    "section_id" INTEGER,
    "service_external_id" INTEGER,
    "section_name" TEXT,
    "service_name" TEXT,
    "personnel_name" TEXT,
    "received_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remain_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deposit_price" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reception_date" TEXT,
    "reception_at" TIMESTAMP(3),
    "patient_external_code" INTEGER,

    CONSTRAINT "reception_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_metrics" (
    "patient_id" TEXT NOT NULL,
    "patient_external_code" INTEGER NOT NULL,
    "first_visit_date" TEXT,
    "last_visit_date" TEXT,
    "last_visit_at" TIMESTAMP(3),
    "recency_days" INTEGER,
    "visit_count" INTEGER NOT NULL DEFAULT 0,
    "total_received" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_outstanding" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "avg_ticket" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "recency_score" INTEGER NOT NULL DEFAULT 0,
    "frequency_score" INTEGER NOT NULL DEFAULT 0,
    "monetary_score" INTEGER NOT NULL DEFAULT 0,
    "rfm_score" INTEGER NOT NULL DEFAULT 0,
    "segment" "PatientSegment" NOT NULL DEFAULT 'NEW',
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_metrics_pkey" PRIMARY KEY ("patient_id")
);

-- CreateIndex
CREATE INDEX "reception_items_service_external_id_idx" ON "reception_items"("service_external_id");

-- CreateIndex
CREATE INDEX "reception_items_section_id_idx" ON "reception_items"("section_id");

-- CreateIndex
CREATE INDEX "reception_items_personnel_name_idx" ON "reception_items"("personnel_name");

-- CreateIndex
CREATE INDEX "reception_items_reception_at_idx" ON "reception_items"("reception_at");

-- CreateIndex
CREATE INDEX "reception_items_patient_external_code_idx" ON "reception_items"("patient_external_code");

-- CreateIndex
CREATE UNIQUE INDEX "reception_items_reception_external_id_line_no_key" ON "reception_items"("reception_external_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "patient_metrics_patient_external_code_key" ON "patient_metrics"("patient_external_code");

-- CreateIndex
CREATE INDEX "patient_metrics_segment_idx" ON "patient_metrics"("segment");

-- CreateIndex
CREATE INDEX "patient_metrics_rfm_score_idx" ON "patient_metrics"("rfm_score");

-- CreateIndex
CREATE INDEX "patient_metrics_total_received_idx" ON "patient_metrics"("total_received");

-- CreateIndex
CREATE INDEX "patient_metrics_last_visit_at_idx" ON "patient_metrics"("last_visit_at");

-- CreateIndex
CREATE INDEX "leads_converted_patient_id_idx" ON "leads"("converted_patient_id");

-- CreateIndex
CREATE INDEX "receptions_reception_at_idx" ON "receptions"("reception_at");

-- CreateIndex
CREATE INDEX "receptions_patient_id_idx" ON "receptions"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "reserves_external_key_key" ON "reserves"("external_key");

-- CreateIndex
CREATE INDEX "reserves_patient_external_code_idx" ON "reserves"("patient_external_code");

-- CreateIndex
CREATE INDEX "reserves_patient_mobile_idx" ON "reserves"("patient_mobile");

-- CreateIndex
CREATE INDEX "reserves_patient_id_idx" ON "reserves"("patient_id");

-- CreateIndex
CREATE INDEX "treatments_patient_id_idx" ON "treatments"("patient_id");

-- AddForeignKey
ALTER TABLE "reception_items" ADD CONSTRAINT "reception_items_reception_id_fkey" FOREIGN KEY ("reception_id") REFERENCES "receptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_metrics" ADD CONSTRAINT "patient_metrics_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Restore the lead -> patient foreign key dropped above (original definition).
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_patient_id_fkey"
  FOREIGN KEY ("converted_patient_id") REFERENCES "patients"("id")
  ON UPDATE CASCADE ON DELETE SET NULL;

-- Restart every entity's checkpoint so the next run is a true full sync.
UPDATE "sync_job_states"
SET "status" = 'IDLE', "last_page" = 1, "cursor_date" = NULL, "records_read" = 0,
    "records_upserted" = 0, "records_failed" = 0, "reached_end" = false,
    "started_at" = NULL, "finished_at" = NULL, "error_message" = NULL;

-- Retire the 50-rows/500ms throttle that made a full sync take days.
UPDATE "sync_settings" SET "page_size" = 1000, "throttle_delay_ms" = 0;
