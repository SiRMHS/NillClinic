"""Turn the desk's CRM workbook into the two CSVs the app imports.

The dashboard already accepts CRM data through «ورود از فایل» on the CRM page:
one file of contacts, one of the doctors' weekly rota, both in the same Persian
columns the export writes. This produces exactly those two files from the Excel
workbook the desk still keeps by hand, so a month's calls go in through the
normal import — with its preview, its per-row warnings and its permission check
— instead of through a database script.

    python3 scripts/crm-workbook-to-csv.py "CRM اصلی.xlsx" ./out

Writes out/تماس-CRM.csv and out/برنامه-هفتگی-پزشکان.csv.

The headers here are the importer's, from apps/api/src/lib/crm-import.ts. Values
are written as the Persian labels a person reading the file in Excel expects;
the importer accepts those and the enum names alike.
"""
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from crm_workbook import read_workbook  # noqa: E402

KIND = {
    "FOLLOW_UP": "تماس فالوآپ",
    "SURVEY": "نظرسنجی",
    "CONSULT": "مشاوره کاشت",
    "RENUVION": "مراجعین رنوویون",
    "WALK_IN": "مراجعین حضوری",
}
RATING = {
    "EXCELLENT": "عالی", "GOOD": "خوب", "AVERAGE": "متوسط",
    "POOR": "بد", "VERY_POOR": "خیلی بد",
}
LIKELIHOOD = {
    "VERY_HIGH": "خیلی زیاد", "HIGH": "زیاد", "MEDIUM": "متوسط",
    "LOW": "کم", "VERY_LOW": "خیلی کم",
}
CALL_RESULT = {
    "ANSWERED": "پاسخ داد", "NO_ANSWER": "جواب نداد",
    "UNREACHABLE": "خاموش / در دسترس نبود", "UNAVAILABLE": "نبود",
    "WRONG_NUMBER": "شماره اشتباه",
}
CHANNEL = {
    "FRIENDS": "معرفی دوستان", "SITE": "سایت", "INSTAGRAM": "اینستاگرام",
    "TV": "تلویزیون", "PREVIOUS_PATIENT": "بیمار قبلی", "OTHER_ADS": "سایر تبلیغات",
}
WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه"]

CONTACT_HEADERS = [
    "نوع", "شماره پرونده بیمار", "نام بیمار", "موبایل", "نام پزشک",
    "تاریخ مراجعه", "تاریخ تماس", "خدمات انجام شده", "مبلغ دریافت شده",
    "وقت‌دهی", "پزشک", "دستیار", "پذیرش", "بهداشت",
    "احتمال معرفی به دیگران", "احتمال مراجعه مجدد",
    "نحوه آشنایی", "پاسخگویی", "پیشنهاد", "توضیحات", "وقت مجدد",
    "بروز نتایج", "عوارض", "نظر کلی", "درد/ورم", "تاخیر", "نکته مثبت",
    "ارجاع به پزشک", "توضیح ارجاع", "درمان توسط", "خدمات گرفته‌شده",
    "تاریخ درمان", "خلاصه حرف بیمار", "ارجاع به کال‌سنتر",
    "تاریخ رضایت‌سنجی مجدد", "نتیجه رضایت‌سنجی مجدد",
]

FIELD_COLUMNS = [
    ("patientExternalCode", "شماره پرونده بیمار"),
    ("patientName", "نام بیمار"),
    ("patientMobile", "موبایل"),
    ("doctorName", "نام پزشک"),
    ("visitDate", "تاریخ مراجعه"),
    ("contactDate", "تاریخ تماس"),
    ("serviceName", "خدمات انجام شده"),
    ("suggestion", "پیشنهاد"),
    ("notes", "توضیحات"),
    ("rebookNote", "وقت مجدد"),
    ("resultsOnset", "بروز نتایج"),
    ("sideEffect", "عوارض"),
    ("overallOpinion", "نظر کلی"),
    ("painSwelling", "درد/ورم"),
    ("delayComplaint", "تاخیر"),
    ("positiveNote", "نکته مثبت"),
    ("referredDoctorName", "ارجاع به پزشک"),
    ("doctorReferral", "توضیح ارجاع"),
    ("treatmentDoctorName", "درمان توسط"),
    ("treatmentDate", "تاریخ درمان"),
    ("patientSummary", "خلاصه حرف بیمار"),
    ("callCenterReferral", "ارجاع به کال‌سنتر"),
    ("resurveyDate", "تاریخ رضایت‌سنجی مجدد"),
    ("resurveyResult", "نتیجه رضایت‌سنجی مجدد"),
]
RATING_COLUMNS = [
    ("schedulingRating", "وقت‌دهی"), ("doctorRating", "پزشک"),
    ("assistantRating", "دستیار"), ("receptionRating", "پذیرش"),
    ("hygieneRating", "بهداشت"),
]
LIKELIHOOD_COLUMNS = [
    ("referralLikelihood", "احتمال معرفی به دیگران"),
    ("revisitLikelihood", "احتمال مراجعه مجدد"),
]


def amount_cell(record):
    """What goes in «مبلغ دریافت شده».

    The importer reads a plain number and keeps anything else as text, so a
    parsed figure is written as Rial digits and unparsed prose («۳۲ میلیون و
    نیم») is passed through untouched — it stays on the record, out of the
    totals, exactly as it does today, rather than being guessed at here.
    """
    if record.get("amount") is not None:
        return str(int(record["amount"]))
    return record.get("amountText") or ""


def contact_row(record):
    row = {h: "" for h in CONTACT_HEADERS}
    row["نوع"] = KIND.get(record.get("kind"), "")
    for field, header in FIELD_COLUMNS:
        value = record.get(field)
        if value is not None and value != "":
            row[header] = str(value)
    for field, header in RATING_COLUMNS:
        row[header] = RATING.get(record.get(field), "")
    for field, header in LIKELIHOOD_COLUMNS:
        row[header] = LIKELIHOOD.get(record.get(field), "")
    row["پاسخگویی"] = CALL_RESULT.get(record.get("callResult"), "")
    row["نحوه آشنایی"] = "، ".join(
        CHANNEL[c] for c in record.get("channels") or [] if c in CHANNEL
    )
    row["مبلغ دریافت شده"] = amount_cell(record)
    return row


def write_csv(path, headers, rows):
    # utf-8-sig: Excel on Windows reads a BOM-less UTF-8 CSV as cp1256 and turns
    # every Persian column into mojibake. The importer strips the BOM.
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main(workbook, out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    records, schedule = read_workbook(workbook)

    contacts_path = out / "تماس-CRM.csv"
    write_csv(contacts_path, CONTACT_HEADERS, [contact_row(r) for r in records])

    # The rota imports as the grid it is in Excel — one row per doctor, one
    # column per weekday — so it is pivoted back from the flat records here.
    by_doctor = {}
    for entry in schedule:
        by_doctor.setdefault(entry["doctorName"], {})[entry["weekday"]] = entry["note"]
    schedule_headers = ["نام پزشک", *WEEKDAYS]
    schedule_rows = [
        {"نام پزشک": doctor, **{WEEKDAYS[d]: note for d, note in days.items()}}
        for doctor, days in by_doctor.items()
    ]
    schedule_path = out / "برنامه-هفتگی-پزشکان.csv"
    write_csv(schedule_path, schedule_headers, schedule_rows)

    print(f"{contacts_path}  ({len(records)} سطر)")
    print(f"{schedule_path}  ({len(schedule_rows)} پزشک)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: python3 scripts/crm-workbook-to-csv.py <workbook.xlsx> <out-dir>")
    main(sys.argv[1], sys.argv[2])
