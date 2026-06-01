-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'ANALYST', 'RECEPTION', 'VIEWER');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('INSTAGRAM', 'WHATSAPP', 'SITE', 'MANUAL');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "SyncEntity" AS ENUM ('PATIENTS', 'SERVICES', 'RESERVES', 'TREATMENTS');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('STARTED', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('CRON', 'MANUAL');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGOUT', 'SYNC_MANUAL', 'LEAD_CREATE', 'LEAD_UPDATE', 'LEAD_CONVERT', 'PATIENT_VIEW', 'EXPORT', 'ROLE_CHANGE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "external_code" INTEGER NOT NULL,
    "full_name_enc" TEXT NOT NULL,
    "mobile_enc" TEXT,
    "tel_enc" TEXT,
    "gender" INTEGER,
    "address_enc" TEXT,
    "degree" TEXT,
    "father_name_enc" TEXT,
    "birth_date" TEXT,
    "resident_country" TEXT,
    "introduction" INTEGER,
    "job" TEXT,
    "is_resident" BOOLEAN,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "external_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "section_name" TEXT NOT NULL,
    "section_id" INTEGER NOT NULL,
    "tariff" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserves" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT,
    "reserve_date" TEXT NOT NULL,
    "reserve_time" TEXT NOT NULL,
    "services_raw" TEXT,
    "create_date" TEXT,
    "create_time" TEXT,
    "is_accepted" BOOLEAN NOT NULL DEFAULT false,
    "doctor_name" TEXT NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reserves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatments" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "patient_id" TEXT,
    "external_patient_code" INTEGER NOT NULL,
    "plan_date" TEXT NOT NULL,
    "plan_name" TEXT NOT NULL,
    "plan_user" TEXT NOT NULL,
    "reason_name" TEXT,
    "details_json" JSONB NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "full_name_enc" TEXT,
    "mobile_enc" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "external_ref" TEXT,
    "converted_patient_id" TEXT,
    "contacted_at" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "entity" "SyncEntity" NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "records_read" INTEGER NOT NULL DEFAULT 0,
    "records_upserted" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" "AuditAction" NOT NULL,
    "resource" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "patients_external_code_key" ON "patients"("external_code");

-- CreateIndex
CREATE INDEX "patients_synced_at_idx" ON "patients"("synced_at");

-- CreateIndex
CREATE UNIQUE INDEX "services_external_id_key" ON "services"("external_id");

-- CreateIndex
CREATE INDEX "reserves_reserve_date_idx" ON "reserves"("reserve_date");

-- CreateIndex
CREATE INDEX "reserves_doctor_name_idx" ON "reserves"("doctor_name");

-- CreateIndex
CREATE UNIQUE INDEX "treatments_external_id_key" ON "treatments"("external_id");

-- CreateIndex
CREATE INDEX "treatments_external_patient_code_idx" ON "treatments"("external_patient_code");

-- CreateIndex
CREATE INDEX "treatments_plan_user_idx" ON "treatments"("plan_user");

-- CreateIndex
CREATE INDEX "treatments_plan_date_idx" ON "treatments"("plan_date");

-- CreateIndex
CREATE INDEX "leads_source_status_idx" ON "leads"("source", "status");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at");

-- CreateIndex
CREATE INDEX "sync_logs_entity_started_at_idx" ON "sync_logs"("entity", "started_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- AddForeignKey
ALTER TABLE "reserves" ADD CONSTRAINT "reserves_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_converted_patient_id_fkey" FOREIGN KEY ("converted_patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
