"""Reading the clinic's CRM workbook.

The desk has kept its follow-up calls, satisfaction surveys and doctor rota in
one Excel file for years, one sheet per month, with the columns drifting between
them — بهمن has no وقت دهی column, خرداد's header sits under a blank row, the
amount column is prose («۱۰ میلیون و ۹۰۰ هزار تومان»), and the call date is
written once per batch and left blank on the rows beneath it. All of that is
handled here, once, so the two things that consume the workbook — the one-time
JSON backfill and the CSV the desk uploads through the import dialog — cannot
disagree about what a row means.

Nothing here writes anywhere. It returns records.
"""
import re
import sys
from pathlib import Path

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
from doctor_names import DoctorNames  # noqa: E402

RATING = {
    "عالی": "EXCELLENT", "عالیع": "EXCELLENT", "عایل": "EXCELLENT", "غالی": "EXCELLENT",
    "عالیی": "EXCELLENT", "عال": "EXCELLENT", "عالس": "EXCELLENT", "عای": "EXCELLENT",
    "علی": "EXCELLENT",
    "خوب": "GOOD",
    "متوسط": "AVERAGE", "متوسطی": "AVERAGE",
    "بد": "POOR", "ضعیف": "POOR", "ضعبف": "POOR", "ناراضی": "POOR",
    "خیلی بد": "VERY_POOR", "خیلی ید": "VERY_POOR", "خیل بد": "VERY_POOR", "خیلی  بد": "VERY_POOR",
}

LIKELIHOOD = {
    "خیلی زیاد": "VERY_HIGH", "خیل زیاد": "VERY_HIGH", "عالی": "VERY_HIGH",
    "زیاد": "HIGH", "زییاد": "HIGH", "خوب": "HIGH",
    "متوسط": "MEDIUM",
    "کم": "LOW", "بد": "LOW",
    "خیلی کم": "VERY_LOW", "خیل کم": "VERY_LOW", "خیلی ککم": "VERY_LOW", "خیلی بد": "VERY_LOW",
}

CHANNEL_PATTERNS = [
    ("INSTAGRAM", ("اینستا",)),
    ("SITE", ("سایت",)),
    ("TV", ("تلویزیون", "تلویویون")),
    ("PREVIOUS_PATIENT", ("بیمار قبلی", "بیمارقبلی", "بیما رقبلی")),
    ("FRIENDS", ("معرفی دوستان", "دوستان")),
    ("OTHER_ADS", ("سایر تبلیغات", "سایرتبلیغات", "سایر تبلغیات", "تبلیغات")),
]
ALL_CHANNELS = [c for c, _ in CHANNEL_PATTERNS]

def norm(v):
    if v is None:
        return None
    s = str(v).replace("‌", " ").strip()
    s = re.sub(r"\s+", " ", s)
    # Rows where the header was repeated mid-sheet, and the "———" filler cells.
    if s in ("", "-", "0") or set(s) <= set("ـ_ -"):
        return None
    return s

def rating(v):
    s = norm(v)
    return RATING.get(s) if s else None

def likelihood(v):
    s = norm(v)
    return LIKELIHOOD.get(s) if s else None

def channels(v):
    s = norm(v)
    if not s:
        return []
    if "همه" in s:
        return ALL_CHANNELS
    found = []
    for code, needles in CHANNEL_PATTERNS:
        if any(n in s for n in needles) and code not in found:
            found.append(code)
    return found

# پاسخگویی was a free-text column; these are the phrasings that actually occur.
def call_result(v, has_ratings):
    s = norm(v)
    if not s:
        # A row with ratings is a call that was answered, whether or not anyone
        # wrote in the پاسخگویی column — that column was only filled when
        # something went wrong.
        return "ANSWERED" if has_ratings else None
    if "شماره اشتباه" in s or "شماره یکی دیگه" in s:
        return "WRONG_NUMBER"
    if "خاموش" in s or "در دسترس" in s:
        return "UNREACHABLE"
    if "جواب نداد" in s or "پاسخگو نبود" in s or "جواب ندادن" in s:
        return "NO_ANSWER"
    if s == "نبود" or "نبود" in s:
        return "UNAVAILABLE"
    return "ANSWERED" if has_ratings else "NO_ANSWER"

FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

def jalali(v):
    s = norm(v)
    if not s:
        return None
    s = s.translate(FA_DIGITS)
    m = re.search(r"(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})", s)
    if not m:
        return None
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1300 <= y <= 1500 and 1 <= mo <= 12 and 1 <= d <= 31):
        return None
    return f"{y}/{mo:02d}/{d:02d}"

def code(v):
    s = norm(v)
    if not s:
        return None
    s = s.translate(FA_DIGITS)
    m = re.fullmatch(r"\d{1,9}", s)
    return int(s) if m else None

# "۱۰میلیون و ۹۰۰هزار تومان" → Rial. Only whole units are recognised; anything
# else keeps its prose and leaves the numeric column null rather than guessing.
WORDS = {
    "یک": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج": 5, "شش": 6, "شیش": 6, "هفت": 7,
    "هشت": 8, "نه": 9, "ده": 10, "یازده": 11, "دوازده": 12, "سیزده": 13,
    "چهارده": 14, "پانزده": 15, "شانزده": 16, "هفده": 17, "هجده": 18, "نوزده": 19,
    "بیست": 20, "سی": 30, "چهل": 40, "پنجاه": 50, "شصت": 60, "هفتاد": 70,
    "هشتاد": 80, "نود": 90, "صد": 100, "دویست": 200, "سیصد": 300, "چهارصد": 400,
    "پانصد": 500, "ششصد": 600, "هفتصد": 700, "هشتصد": 800, "نهصد": 900,
}

def amount_rial(text):
    if not text:
        return None
    s = text.translate(FA_DIGITS)
    # A bare digit run with dots/commas as thousand separators, e.g. "350.000.000".
    bare = re.fullmatch(r"[\d.,]+", s.strip())
    if bare:
        digits = re.sub(r"[.,]", "", s.strip())
        return float(digits) if digits.isdigit() else None

    total = 0.0
    matched = False
    for unit, mult in (("میلیارد", 1_000_000_000), ("میلیون", 1_000_000), ("هزار", 1_000)):
        for m in re.finditer(r"([\d]+|[؀-ۿ ]{1,30}?)\s*" + unit, s):
            raw = m.group(1).strip()
            if raw.isdigit():
                value = float(raw)
            else:
                value = 0.0
                for word in raw.split():
                    if word in WORDS:
                        value += WORDS[word]
                if value == 0:
                    continue
            total += value * mult
            matched = True
    if not matched:
        return None
    # The sheet quoted Toman; the database stores Rial like every other amount.
    return total * 10

def cells(row, n):
    return [row[i] if i < len(row) else None for i in range(n)]

def find_header(ws, marker, limit=10):
    """Locate the header row and return (index, normalised labels).

    Not every sheet starts at row 1: the survey sheet leaves row 1 blank and
    puts its labels on row 2, so a fixed `min_row=2` for data silently read the
    header as the only record and produced nothing.
    """
    for i, row in enumerate(ws.iter_rows(min_row=1, max_row=limit, values_only=True), start=1):
        labels = [norm(c) or "" for c in cells(row, ws.max_column)]
        if any(marker in l for l in labels if l):
            return i, labels
    raise ValueError(f"header not found in {ws.title!r} (looking for {marker!r})")


def sheet(wb, title):
    """A worksheet by title, tolerant of the stray trailing space the desk leaves.

    Returns None when the workbook simply does not have that sheet: the file is
    edited by hand every month, and a missing rota should cost the rota, not the
    2,500 calls in the sheets that are there.
    """
    wanted = title.strip()
    for ws in wb.worksheets:
        if ws.title.strip() == wanted:
            return ws
    return None


def data_rows(ws, width, blank_stop=50, start=2):
    """Rows of a sheet, stopping after blank_stop consecutive empty ones.

    خرداد reports max_row = 1048576 because a format was applied to the whole
    column; iterating that literally reads a million empty tuples per sheet.
    """
    blanks = 0
    for row in ws.iter_rows(min_row=start, max_row=min(ws.max_row, 20000), values_only=True):
        r = cells(row, width)
        if all(c is None or str(c).strip() == "" for c in r):
            blanks += 1
            if blanks >= blank_stop:
                return
            continue
        blanks = 0
        yield r


WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه شنبه", "چهارشنبه", "پنج شنبه", "جمعه"]
FALLBACK_DATE = "1405/05/30"

def read_workbook(path, doctors=None):
    """Parse the workbook into (contacts, schedule).

    Practitioner names are resolved to the clinic's canonical spellings on the
    way out — see doctor_names.py for why and for what is deliberately left
    alone. Pass `doctors=DoctorNames([])` to keep the sheets verbatim.
    """
    doctors = DoctorNames.load() if doctors is None else doctors
    def doctor(value):
        return doctors.resolve(norm(value)) or None

    wb = openpyxl.load_workbook(path, data_only=True)
    records = []

    def push(rec):
        # A row needs a date and something identifying: the sheets carry blank
        # scaffold rows that only inherited a date from the batch above them.
        if not rec.get("contactDate"):
            return
        if not (rec.get("patientName") or rec.get("patientExternalCode") or rec.get("notes")):
            return
        records.append(rec)

    # ── Monthly follow-up sheets (identical spine, column count varies) ──
    # Discovered rather than listed: the desk adds a sheet each month (and spells
    # فالوآپ as فالواپ about a third of the time), and a hard-coded list means a
    # new month is silently dropped by a script that reports success.
    followup_sheets = [
        ws.title for ws in wb.worksheets
        if "فالوآپ" in ws.title or "فالواپ" in ws.title
    ]
    for name in followup_sheets:
        ws = wb[name]
        header_row, header = find_header(ws, "شماره پرونده بیمار")
        # بهمن drops the وقت دهی column, so positions are resolved by header text.
        idx = {h: i for i, h in enumerate(header)}
        def col(*names):
            for n in names:
                if n in idx:
                    return idx[n]
            return None
        c_code = col("شماره پرونده بیمار")
        c_name = col("نام بیمار")
        c_doc = col("نام پزشک")
        c_visit = col("تاریخ مراجعه")
        c_call = col("تاریخ تماس")
        c_srv = col("خدمات انجام شده")
        c_amt = col("مبلغ دریافت شده")
        c_sch = col("وقت دهی")
        c_pdoc = col("پزشک")
        c_asst = col("دستیار")
        c_rec = col("پذیرش")
        c_hyg = col("بهداشت")
        c_sug = col("پیشنهاد")
        c_note = col("توضیحات")
        c_ans = col("پاسخگویی", "پاسخگو یی")
        c_re = col("وقت مجدد")

        # The desk wrote the call date once per batch and left it blank on the
        # rows beneath — 45 of بهمن's 93 records look dateless without this.
        # Only rows that actually identify a patient inherit it, so trailing
        # row-number-only rows still drop.
        last_contact_date = None
        for r in data_rows(ws, ws.max_column, start=header_row + 1):
            contact_date = jalali(r[c_call]) if c_call is not None else None
            if contact_date:
                last_contact_date = contact_date
            else:
                identified = (c_name is not None and norm(r[c_name])) or \
                             (c_code is not None and code(r[c_code]))
                contact_date = last_contact_date if identified else None
            if not contact_date:
                continue
            ratings = {
                "schedulingRating": rating(r[c_sch]) if c_sch is not None else None,
                "doctorRating": rating(r[c_pdoc]) if c_pdoc is not None else None,
                "assistantRating": rating(r[c_asst]) if c_asst is not None else None,
                "receptionRating": rating(r[c_rec]) if c_rec is not None else None,
                "hygieneRating": rating(r[c_hyg]) if c_hyg is not None else None,
            }
            amount_text = norm(r[c_amt]) if c_amt is not None else None
            push({
                "kind": "FOLLOW_UP",
                "sheet": name.strip(),
                "patientExternalCode": code(r[c_code]) if c_code is not None else None,
                "patientName": norm(r[c_name]) if c_name is not None else None,
                "doctorName": doctor(r[c_doc]) if c_doc is not None else None,
                "visitDate": jalali(r[c_visit]) if c_visit is not None else None,
                "contactDate": contact_date,
                "serviceName": norm(r[c_srv]) if c_srv is not None else None,
                "amountText": amount_text,
                "amount": amount_rial(amount_text),
                **ratings,
                "callResult": call_result(r[c_ans] if c_ans is not None else None,
                                          any(ratings.values())),
                "suggestion": norm(r[c_sug]) if c_sug is not None else None,
                "notes": norm(r[c_note]) if c_note is not None else None,
                "rebookNote": norm(r[c_re]) if c_re is not None else None,
                "channels": [],
            })

    # ── نظرسنجی (the SMS satisfaction form) ──
    for sheet_name in [t for t in wb.sheetnames if t.strip().startswith("نظرسنجی")]:
        ws = wb[sheet_name]
        header_row, header = find_header(ws, "تاریخ ارسال نظر")
        idx = {h: i for i, h in enumerate(header)}
        has_visit = "تاریخ مراجعه فرد" in idx
        for r in data_rows(ws, ws.max_column, start=header_row + 1):
            g = lambda key: r[idx[key]] if key in idx else None
            contact_date = jalali(g("تاریخ ارسال نظر"))
            if not contact_date:
                continue
            push({
                "kind": "SURVEY",
                "sheet": sheet_name.strip(),
                "patientExternalCode": code(g("شماره پرونده")),
                "patientName": norm(g("نام مریض")),
                "doctorName": doctor(g("نام پزشک")),
                "visitDate": jalali(g("تاریخ مراجعه فرد")) if has_visit else None,
                "contactDate": contact_date,
                "serviceName": norm(g("خدماتی که انجام داده اند")),
                "amountText": None,
                "amount": None,
                "schedulingRating": rating(g("رضایت از وقت دهی")),
                "doctorRating": rating(g("رضایت از پزشک")),
                "assistantRating": rating(g("رضایت از دستیاران")),
                "receptionRating": rating(g("رضایت از پذیرش")),
                "hygieneRating": rating(g("رضایت از بهداشت کلینیک")),
                "referralLikelihood": likelihood(g("احتمال معرفی به دیگران")),
                "revisitLikelihood": likelihood(g("احتمال مراجعه مجدد")),
                "channels": channels(g("نحوه اشنایی")),
                # The survey arrives by SMS, so there is no call to score;
                # `تماس گرفته شد` records the follow-up call the desk placed after.
                "callResult": None,
                "suggestion": norm(g("پیشنهاد")),
                "notes": norm(g("توضیحات")),
                "rebookNote": norm(g("وقت مجدد")),
                "callCenterReferral": norm(g("تماس گرفته شد")),
            })

    # ── مشاوره کاشت ──
    ws = sheet(wb, "مشاوره کاشت")
    for r in data_rows(ws, 6) if ws else ():
        contact_date = jalali(r[4])
        if not contact_date:
            continue
        push({
            "kind": "CONSULT",
            "sheet": "مشاوره کاشت",
            "patientName": norm(r[1]),
            "visitDate": jalali(r[3]),
            "contactDate": contact_date,
            "rebookNote": norm(r[2]),
            "notes": norm(r[5]),
            "channels": [],
        })

    # ── مراجعین رنوویون ──
    ws = sheet(wb, "مراجعین رنوویون")
    last_contact_date = None
    for r in data_rows(ws, 19) if ws else ():
        contact_date = jalali(r[5])
        if contact_date:
            last_contact_date = contact_date
        elif norm(r[2]) or code(r[1]):
            contact_date = last_contact_date
        if not contact_date:
            continue
        ratings = {
            "doctorRating": rating(r[8]),
            "assistantRating": rating(r[9]),
            "receptionRating": rating(r[10]),
            "hygieneRating": rating(r[11]),
        }
        amount_text = norm(r[7])
        push({
            "kind": "RENUVION",
            "sheet": "مراجعین رنوویون",
            "patientExternalCode": code(r[1]),
            "patientName": norm(r[2]),
            "doctorName": doctor(r[3]),
            "visitDate": jalali(r[4]),
            "contactDate": contact_date,
            "serviceName": norm(r[6]),
            "amountText": amount_text,
            "amount": amount_rial(amount_text),
            **ratings,
            "suggestion": norm(r[12]),
            "notes": norm(r[13]),
            "callResult": call_result(r[14], any(ratings.values())),
            "resultsOnset": norm(r[15]),
            "sideEffect": norm(r[16]),
            "rebookNote": norm(r[17]),
            "overallOpinion": norm(r[18]),
            "channels": [],
        })

    # ── مراجعین حضوری ──
    ws = sheet(wb, "مراجعین حضوری")
    for r in data_rows(ws, 5) if ws else ():
        name = norm(r[2])
        if not name:
            continue
        push({
            "kind": "WALK_IN",
            "sheet": "مراجعین حضوری",
            "patientExternalCode": code(r[1]),
            "patientName": name,
            "doctorName": doctor(r[3]),
            # The sheet carries no date; these were logged as they happened and
            # the workbook's own last-modified date is the only anchor available.
            "contactDate": FALLBACK_DATE,
            "notes": norm(r[4]),
            "channels": [],
        })

    # ── روزهای پزشکان ──
    ws = sheet(wb, "روزهای پزشکان")
    schedule = []
    if ws is None:
        return records, schedule
    width = max(ws.max_column, 2)
    header = cells(next(ws.iter_rows(max_row=1, values_only=True)), width)
    rota_doctors = [doctor(c) for c in header[1:]]
    for r in data_rows(ws, width):
        weekday_name = norm(r[0])
        if not weekday_name:
            continue
        weekday = WEEKDAYS.index(weekday_name) if weekday_name in WEEKDAYS else None
        if weekday is None:
            continue
        for i, name in enumerate(rota_doctors):
            note = norm(r[i + 1])
            if name and note:
                schedule.append({"doctorName": name, "weekday": weekday, "note": note})

    return records, schedule

