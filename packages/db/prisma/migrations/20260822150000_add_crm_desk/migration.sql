-- CRM follow-up desk: contacts (follow-up calls, surveys, walk-ins) and the
-- doctor weekday schedule the desk books rebooks against.

CREATE TYPE "CrmContactKind" AS ENUM ('FOLLOW_UP', 'SURVEY', 'CONSULT', 'RENUVION', 'WALK_IN');
CREATE TYPE "CrmRating" AS ENUM ('EXCELLENT', 'GOOD', 'AVERAGE', 'POOR', 'VERY_POOR');
CREATE TYPE "CrmLikelihood" AS ENUM ('VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'VERY_LOW');
CREATE TYPE "CrmCallResult" AS ENUM ('ANSWERED', 'NO_ANSWER', 'UNREACHABLE', 'UNAVAILABLE', 'WRONG_NUMBER');
CREATE TYPE "CrmChannel" AS ENUM ('FRIENDS', 'SITE', 'INSTAGRAM', 'TV', 'PREVIOUS_PATIENT', 'OTHER_ADS');

CREATE TABLE "crm_contacts" (
    "id" TEXT NOT NULL,
    "kind" "CrmContactKind" NOT NULL DEFAULT 'FOLLOW_UP',
    "patient_id" TEXT,
    "patient_external_code" INTEGER,
    "patient_name_enc" TEXT,
    "patient_name" TEXT,
    "patient_mobile_enc" TEXT,
    "patient_mobile" TEXT,
    "doctor_name" TEXT,
    "visit_date" TEXT,
    "contact_date" TEXT NOT NULL,
    "contact_at" TIMESTAMP(3),
    "service_name" TEXT,
    "amount_text" TEXT,
    "amount" DECIMAL(18,2),
    "scheduling_rating" "CrmRating",
    "doctor_rating" "CrmRating",
    "assistant_rating" "CrmRating",
    "reception_rating" "CrmRating",
    "hygiene_rating" "CrmRating",
    "referral_likelihood" "CrmLikelihood",
    "revisit_likelihood" "CrmLikelihood",
    "channels" "CrmChannel"[] DEFAULT ARRAY[]::"CrmChannel"[],
    "call_result" "CrmCallResult",
    "suggestion" TEXT,
    "notes" TEXT,
    "rebook_note" TEXT,
    "results_onset" TEXT,
    "side_effect" TEXT,
    "overall_opinion" TEXT,
    "pain_swelling" TEXT,
    "delay_complaint" TEXT,
    "positive_note" TEXT,
    "doctor_referral" TEXT,
    "patient_summary" TEXT,
    "call_center_referral" TEXT,
    "resurvey_date" TEXT,
    "resurvey_result" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crm_contacts_kind_contact_at_idx" ON "crm_contacts"("kind", "contact_at");
CREATE INDEX "crm_contacts_contact_at_idx" ON "crm_contacts"("contact_at");
CREATE INDEX "crm_contacts_contact_date_idx" ON "crm_contacts"("contact_date");
CREATE INDEX "crm_contacts_doctor_name_idx" ON "crm_contacts"("doctor_name");
CREATE INDEX "crm_contacts_patient_external_code_idx" ON "crm_contacts"("patient_external_code");
CREATE INDEX "crm_contacts_patient_id_idx" ON "crm_contacts"("patient_id");
CREATE INDEX "crm_contacts_created_by_id_idx" ON "crm_contacts"("created_by_id");

ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "crm_doctor_schedules" (
    "id" TEXT NOT NULL,
    "doctor_name" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "note" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_doctor_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_doctor_schedules_doctor_name_weekday_key"
    ON "crm_doctor_schedules"("doctor_name", "weekday");
