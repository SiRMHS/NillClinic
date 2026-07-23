-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('IDLE', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- AlterEnum
ALTER TYPE "SyncTrigger" ADD VALUE 'AUTO';

-- CreateTable
CREATE TABLE "sync_job_states" (
    "entity" "SyncEntity" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'IDLE',
    "last_page" INTEGER NOT NULL DEFAULT 1,
    "records_read" INTEGER NOT NULL DEFAULT 0,
    "records_upserted" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "reached_end" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "error_message" TEXT,

    CONSTRAINT "sync_job_states_pkey" PRIMARY KEY ("entity")
);

-- CreateTable
CREATE TABLE "sync_settings" (
    "id" INTEGER NOT NULL,
    "auto_sync_enabled" BOOLEAN NOT NULL DEFAULT false,
    "throttle_delay_ms" INTEGER NOT NULL DEFAULT 500,
    "page_size" INTEGER NOT NULL DEFAULT 50,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_settings_pkey" PRIMARY KEY ("id")
);

-- Seed singleton settings row
INSERT INTO "sync_settings" ("id", "auto_sync_enabled", "throttle_delay_ms", "page_size", "updated_at")
VALUES (1, false, 500, 50, CURRENT_TIMESTAMP);
