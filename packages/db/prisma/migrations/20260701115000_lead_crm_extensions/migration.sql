-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('ANSWERED', 'NO_ANSWER', 'BUSY', 'VOICEMAIL', 'WRONG_NUMBER');

-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('SERVICE_ACCEPTED', 'SERVICE_DECLINED', 'CALLBACK_REQUESTED', 'NO_INTEREST');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN "assigned_user_id" TEXT,
ADD COLUMN "next_follow_up_at" TIMESTAMP(3),
ADD COLUMN "last_call_status" "CallStatus",
ADD COLUMN "last_call_outcome" "CallOutcome",
ADD COLUMN "service_received" BOOLEAN;

-- AlterTable
ALTER TABLE "treatments" ADD COLUMN "reason_names" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "lead_calls" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "user_id" TEXT,
    "call_status" "CallStatus" NOT NULL,
    "call_outcome" "CallOutcome",
    "service_received" BOOLEAN,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_follow_ups" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "user_id" TEXT,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "notes" TEXT,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "lead_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_appointments" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "user_id" TEXT,
    "reserve_date" TEXT NOT NULL,
    "reserve_time" TEXT NOT NULL,
    "doctor_name" TEXT NOT NULL,
    "service_name" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_assigned_user_id_idx" ON "leads"("assigned_user_id");

-- CreateIndex
CREATE INDEX "leads_next_follow_up_at_idx" ON "leads"("next_follow_up_at");

-- CreateIndex
CREATE INDEX "lead_calls_lead_id_created_at_idx" ON "lead_calls"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_follow_ups_lead_id_scheduled_at_idx" ON "lead_follow_ups"("lead_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "lead_follow_ups_status_scheduled_at_idx" ON "lead_follow_ups"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "lead_appointments_lead_id_created_at_idx" ON "lead_appointments"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_appointments_reserve_date_idx" ON "lead_appointments"("reserve_date");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_calls" ADD CONSTRAINT "lead_calls_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_calls" ADD CONSTRAINT "lead_calls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_follow_ups" ADD CONSTRAINT "lead_follow_ups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_appointments" ADD CONSTRAINT "lead_appointments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_appointments" ADD CONSTRAINT "lead_appointments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
