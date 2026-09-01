-- Site-wide display switches ---------------------------------------------------
--
-- Permissions decide which sections a role may open. That is the wrong unit for
-- "the desk staff may work the CRM but must not see what patients paid": the
-- section has to stay open, only its figures go away. These flags carry that,
-- and the API strips the values it hides so the numbers are absent from the
-- response rather than merely unpainted.

CREATE TABLE IF NOT EXISTS "display_settings" (
  "id"                INTEGER NOT NULL DEFAULT 1,
  "hide_amounts"      BOOLEAN NOT NULL DEFAULT false,
  "hide_crm_amounts"  BOOLEAN NOT NULL DEFAULT false,
  "hide_crm_rates"    BOOLEAN NOT NULL DEFAULT false,
  "updated_at"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "display_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "display_settings" ("id", "updated_at") VALUES (1, now())
  ON CONFLICT ("id") DO NOTHING;
