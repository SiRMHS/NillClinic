"""Convert the clinic's CRM workbook into the JSON the seed script loads.

The reading itself lives in `crm_workbook.py`, shared with the CSV converter
beside this file. Kept out of the app on purpose: this is a backfill of a
spreadsheet the desk maintains by hand, so it does not justify an xlsx parser in
the API's dependency tree.

    python3 scripts/crm-workbook-to-json.py "CRM اصلی.xlsx" /tmp/crm.json
    pnpm tsx scripts/import-crm-workbook.ts /tmp/crm.json
"""
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from crm_workbook import read_workbook  # noqa: E402


def main(path, out):
    records, schedule = read_workbook(path)
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"contacts": records, "schedule": schedule}, f, ensure_ascii=False, indent=1)

    print(f"contacts: {len(records)}  schedule: {len(schedule)}")
    print("by kind:", Counter(r["kind"] for r in records))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
