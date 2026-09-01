-- CRM service picker, referral tracking, manual VIP, and the clinic's own tiers
-------------------------------------------------------------------------------
--
-- Four changes that arrived together as one round of clinic feedback:
--
--   1. CRM contacts record services picked from the clinic's catalogue instead
--      of retyped prose, so "which services does this complaint concern" is a
--      question the table can answer.
--   2. A referral after a consultation names the doctor it was sent to, the
--      doctor who actually delivered the treatment, and what was delivered.
--      The billed-lines report (ReferralService) can only see referrals that
--      turned into money; these columns see the ones that did not.
--   3. VIP and celebrity standing is assigned by a person. Neither fact exists
--      in the synced CRM, and neither is derivable from spend.
--   4. The value tiers move to the clinic's own bands, quoted in Toman and
--      stored in Rial, with an explicit BRONZE floor. Until now BRONZE was
--      "anything above zero"; the clinic wants a real floor under it.

-- ─── 1 + 2: CRM contact columns ───

ALTER TABLE "crm_contacts"
  ADD COLUMN IF NOT EXISTS "service_names"           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "referred_doctor_name"    TEXT,
  ADD COLUMN IF NOT EXISTS "treatment_doctor_name"   TEXT,
  ADD COLUMN IF NOT EXISTS "treatment_service_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "treatment_date"          TEXT;

-- Existing rows carry their services as one string joined by an Arabic comma
-- (the same separator the export and the importer use). Splitting it here means
-- the new grouped views are not empty for everything logged before the picker
-- existed; `service_name` is left in place as the searchable rendering.
UPDATE "crm_contacts"
   SET "service_names" = ARRAY(
         SELECT btrim(part)
           FROM unnest(string_to_array("service_name", '،')) AS part
          WHERE btrim(part) <> ''
       )
 WHERE "service_name" IS NOT NULL
   AND btrim("service_name") <> ''
   AND cardinality("service_names") = 0;

CREATE INDEX IF NOT EXISTS "crm_contacts_referred_doctor_name_idx"
  ON "crm_contacts" ("referred_doctor_name");
CREATE INDEX IF NOT EXISTS "crm_contacts_treatment_doctor_name_idx"
  ON "crm_contacts" ("treatment_doctor_name");

-- ─── 3: manual VIP standing ───

DO $$ BEGIN
  CREATE TYPE "PatientVipFlag" AS ENUM ('VIP', 'CELEBRITY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "vip_flag"      "PatientVipFlag",
  ADD COLUMN IF NOT EXISTS "vip_note"      TEXT,
  ADD COLUMN IF NOT EXISTS "vip_set_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "vip_set_by_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "patients"
    ADD CONSTRAINT "patients_vip_set_by_id_fkey"
    FOREIGN KEY ("vip_set_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Partial: the column is null for all but a handful of patients, and the only
-- query that uses it asks for the ones that are set.
CREATE INDEX IF NOT EXISTS "patients_vip_flag_idx"
  ON "patients" ("vip_flag") WHERE "vip_flag" IS NOT NULL;

-- ─── 4: tier bands ───

ALTER TABLE "tier_settings"
  ADD COLUMN IF NOT EXISTS "bronze_min" DECIMAL(18,2) NOT NULL DEFAULT 1000000000;

ALTER TABLE "tier_settings"
  ALTER COLUMN "platinum_min" SET DEFAULT 10000000000,
  ALTER COLUMN "gold_min"     SET DEFAULT 6000000000,
  ALTER COLUMN "silver_min"   SET DEFAULT 3000000000;

-- The stored row holds the old defaults, and a default only applies to inserts.
-- Moved explicitly, but only where it still reads as the pre-existing default —
-- a clinic that had already tuned its own thresholds keeps them.
UPDATE "tier_settings"
   SET "platinum_min" = 10000000000,
       "gold_min"     = 6000000000,
       "silver_min"   = 3000000000,
       "bronze_min"   = 1000000000,
       "updated_at"   = now()
 WHERE "id" = 1
   AND "platinum_min" = 500000000
   AND "gold_min"     = 200000000
   AND "silver_min"   = 50000000;
