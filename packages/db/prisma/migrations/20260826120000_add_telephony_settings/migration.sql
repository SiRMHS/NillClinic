-- Click-to-call configuration -------------------------------------------------
--
-- The dial button used to emit a bare `tel:` link, which only reaches whatever
-- the operating system happens to have registered. The clinic runs Issabel on
-- the desks and has to stay reachable from 3CX as well, so the link is now
-- built from a stored configuration instead of being hard-coded.

DO $$ BEGIN
  CREATE TYPE "DialMode" AS ENUM ('TEL', 'CALLTO', 'SIP', 'THREECX', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DialNumberFormat" AS ENUM ('AS_IS', 'NATIONAL', 'E164');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "telephony_settings" (
  "id"            INTEGER NOT NULL DEFAULT 1,
  "dial_mode"     "DialMode" NOT NULL DEFAULT 'TEL',
  "pbx_host"      TEXT,
  "link_template" TEXT,
  "dial_prefix"   TEXT NOT NULL DEFAULT '',
  "number_format" "DialNumberFormat" NOT NULL DEFAULT 'AS_IS',
  "country_code"  TEXT NOT NULL DEFAULT '98',
  "updated_at"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "telephony_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "telephony_settings" ("id", "updated_at") VALUES (1, now())
  ON CONFLICT ("id") DO NOTHING;
