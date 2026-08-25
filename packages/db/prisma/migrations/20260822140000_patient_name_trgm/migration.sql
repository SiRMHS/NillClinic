-- Patient lookup by name is an unanchored ILIKE, which no B-tree can serve:
-- `full_name ILIKE '%فاطمه%'` scans all ~121k patients. That is tolerable on
-- the ranking table, but the tier activity feed joins the result against ~600k
-- receptions and reserves, where the same scan costs seconds.
--
-- A trigram GIN index makes the substring match indexable. It covers `mobile`
-- too, which is searched the same way.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "patients_full_name_trgm_idx"
  ON "patients" USING GIN ("full_name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "patients_mobile_trgm_idx"
  ON "patients" USING GIN ("mobile" gin_trgm_ops);
