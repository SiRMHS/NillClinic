#!/usr/bin/env bash
#
# Restore the lead desk (leads + calls + follow-ups + appointments + interactions)
# out of a pg_dump file into the database DATABASE_URL points at.
#
#   ./scripts/import-lead-backup.sh lead-backup.sql
#
# The dump is loaded into a `lead_import` staging schema first, then merged into
# public with ON CONFLICT (id) DO NOTHING — rows that already exist are left
# alone, so re-running only fills in what is missing. Nothing is deleted.
#
# Two things the dump cannot carry on its own:
#   * users/roles have no data in it, so any operator referenced by a lead is
#     recreated as an inactive placeholder (no password — it cannot log in)
#     to keep the assignment intact. Merge it with the real account later.
#   * full_name/mobile are encrypted with the ENCRYPTION_KEY of the database the
#     dump came from. Without that key in .env the names decrypt to empty.
set -euo pipefail

DUMP=${1:-lead-backup.sql}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$DUMP" ] || { echo "dump not found: $DUMP" >&2; exit 1; }

if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/.env" ]; then
  DATABASE_URL=$(grep -m1 '^DATABASE_URL=' "$ROOT/.env" | cut -d= -f2- | sed 's/^"//;s/"$//')
fi
[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL is not set" >&2; exit 1; }
# Prisma appends ?schema=public, which libpq rejects as an unknown parameter.
PSQL_URL=${DATABASE_URL%%\?*}

TABLES="leads lead_calls lead_follow_ups lead_appointments lead_interactions"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

# The dump reached us with CRLF line endings, which would leave a stray \r on the
# last column of every row, so strip them before COPY sees the data. One pass
# splits each table's COPY block into its own file plus the column list.
tr -d '\r' < "$DUMP" | awk -v stage="$STAGE" -v tables="$TABLES" '
  BEGIN { split(tables, t, " "); for (i in t) want["public." t[i]] = t[i] }
  /^COPY / {
    tbl = $2
    if (tbl in want) {
      name = want[tbl]
      cols = $0
      sub(/^[^(]*\(/, "", cols); sub(/\).*$/, "", cols)
      print cols > (stage "/" name ".cols")
      out = stage "/" name ".tsv"
      printf "" > out
      capture = 1
    }
    next
  }
  capture && $0 == "\\." { capture = 0; out = ""; next }
  capture { print > out }
'

for t in $TABLES; do
  [ -f "$STAGE/$t.tsv" ] || { echo "table $t has no COPY block in the dump" >&2; exit 1; }
  echo "$t: $(wc -l < "$STAGE/$t.tsv" | tr -d ' ') rows staged"
done

{
  echo "BEGIN;"
  echo "DROP SCHEMA IF EXISTS lead_import CASCADE;"
  echo "CREATE SCHEMA lead_import;"
  for t in $TABLES; do
    # LIKE public.<t> without constraints: staging holds the dump as-is, the
    # merge below is what decides which foreign keys survive.
    echo "CREATE TABLE lead_import.$t (LIKE public.$t);"
    echo "\\copy lead_import.$t ($(cat "$STAGE/$t.cols")) FROM '$STAGE/$t.tsv'"
  done

  cat <<'SQL'

-- Operators referenced by the dump that no longer exist here.
INSERT INTO public.users (id, email, full_name, is_active, password, created_at, updated_at)
SELECT u.user_id,
       'restored+' || u.user_id || '@import.local',
       'کاربر بازیابی‌شده از بکاپ',
       false,
       NULL,
       now(),
       now()
FROM (
  SELECT assigned_user_id AS user_id FROM lead_import.leads WHERE assigned_user_id IS NOT NULL
  UNION SELECT user_id FROM lead_import.lead_calls WHERE user_id IS NOT NULL
  UNION SELECT user_id FROM lead_import.lead_follow_ups WHERE user_id IS NOT NULL
  UNION SELECT user_id FROM lead_import.lead_appointments WHERE user_id IS NOT NULL
  UNION SELECT user_id FROM lead_import.lead_interactions WHERE user_id IS NOT NULL
) u
WHERE NOT EXISTS (SELECT 1 FROM public.users x WHERE x.id = u.user_id)
ON CONFLICT (id) DO NOTHING;

-- Leads. campaign_id/converted_patient_id are dropped when the target row is not
-- in this database: the dump carries no campaigns, and patient ids are local to
-- whichever database the clinic sync populated.
INSERT INTO public.leads (
  id, source, status, full_name_enc, mobile_enc, metadata, external_ref,
  converted_patient_id, contacted_at, converted_at, created_at, updated_at,
  assigned_user_id, next_follow_up_at, last_call_status, last_call_outcome,
  service_received, campaign_id
)
SELECT l.id, l.source, l.status, l.full_name_enc, l.mobile_enc, l.metadata, l.external_ref,
       (SELECT p.id FROM public.patients p WHERE p.id = l.converted_patient_id),
       l.contacted_at, l.converted_at, l.created_at, l.updated_at,
       l.assigned_user_id, l.next_follow_up_at, l.last_call_status, l.last_call_outcome,
       l.service_received,
       (SELECT c.id FROM public.campaigns c WHERE c.id = l.campaign_id)
FROM lead_import.leads l
ON CONFLICT (id) DO NOTHING;

-- Children, skipping any row whose lead did not make it in.
INSERT INTO public.lead_calls SELECT c.* FROM lead_import.lead_calls c
  WHERE EXISTS (SELECT 1 FROM public.leads l WHERE l.id = c.lead_id)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lead_follow_ups SELECT f.* FROM lead_import.lead_follow_ups f
  WHERE EXISTS (SELECT 1 FROM public.leads l WHERE l.id = f.lead_id)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lead_appointments SELECT a.* FROM lead_import.lead_appointments a
  WHERE EXISTS (SELECT 1 FROM public.leads l WHERE l.id = a.lead_id)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lead_interactions SELECT i.* FROM lead_import.lead_interactions i
  WHERE EXISTS (SELECT 1 FROM public.leads l WHERE l.id = i.lead_id)
  ON CONFLICT (id) DO NOTHING;

DROP SCHEMA lead_import CASCADE;
COMMIT;

SELECT 'leads' AS tbl, count(*) FROM public.leads
UNION ALL SELECT 'lead_calls', count(*) FROM public.lead_calls
UNION ALL SELECT 'lead_follow_ups', count(*) FROM public.lead_follow_ups
UNION ALL SELECT 'lead_appointments', count(*) FROM public.lead_appointments
UNION ALL SELECT 'lead_interactions', count(*) FROM public.lead_interactions;
SQL
} | psql "$PSQL_URL" -v ON_ERROR_STOP=1
