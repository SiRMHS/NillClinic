"""Resolving the doctor name the desk typed to the one the reports use.

The follow-up sheets are filled in by hand under time pressure, so the same
practitioner appears as «طناز فخیم», «فخیم», «طنازفخیم», «طنا زفخیم», «فحیم» and
«طناز فخمی» — 62 spellings across the workbook for about a dozen people. Left
alone they import as a dozen different doctors, and every per-doctor figure in
CRM splits into fragments that each look small.

The canonical spellings are `reception_items.personnel_name`, because that is
what the doctor report, the referral report and the CRM doctor picker all group
on. They live in doctor-names.txt beside this file.

Nothing here guesses. A name resolves only when exactly one roster entry can
account for it; «رشیدی» matches both فرزانه and مهسا, so it is left as written
and a person decides.
"""
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

ROSTER_FILE = Path(__file__).resolve().parent / "doctor-names.txt"

# Titles the desk prefixes; never part of the stored name.
TITLES = ("پروفسور", "دکتر", "دکنر", "خانم", "آقای", "اقای", "جناب", "سرکار")

# Cells that hold something other than a person: a service leaked in from the
# column next door, or the sheet's own header repeated mid-table.
NOT_A_NAME = re.compile(
    r"^(نام\s*پزشک|ویزیت|مشاوره|کاشت|نانو|فرکسل|لیزر|خوب|بد|متوسط|عالی|ندارد|-+)\b"
)

# «الف / ب»، «الف - ب»، «الف و ب»، «الف، ب» — two practitioners in one cell.
SPLIT = re.compile(r"\s*(?:[/،,؛;+]|\s-\s|\bو\b)\s*")

ARABIC = str.maketrans({"ي": "ی", "ك": "ک", "ئ": "ی", "ة": "ه", "أ": "ا", "إ": "ا", "آ": "ا"})


def clean(raw):
    """Strip the noise that is never part of a name: titles, zero-width marks,
    a parenthesised service, doubled spaces, Arabic letter forms."""
    if not raw:
        return ""
    s = unicodedata.normalize("NFC", str(raw))
    s = s.replace("‌", " ").replace("‍", "").replace("‏", "").replace("‎", "")
    s = re.sub(r"[(（].*?[)）]", " ", s)
    s = s.translate(ARABIC)
    s = re.sub(r"\s+", " ", s).strip(" .،-")
    for title in TITLES:
        s = re.sub(rf"(^|\s){title}\b\s*", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _key(name):
    """Spelling-insensitive form: spaces are noise in these cells.

    «جعفر زاده» and «جعفرزاده» are one surname written two ways, and «طنا زفخیم»
    is «طنازفخیم» with the space landing a character early — all three collapse
    to the same key.
    """
    return clean(name).replace(" ", "")


def _similar(a, b):
    return SequenceMatcher(None, a, b).ratio()


def _edits(a, b, cap):
    """Levenshtein distance, abandoned once it passes `cap`.

    Ratio alone cannot see a typo in a short surname: «فحیم» and «فخیم» differ by
    one letter and score 0.75, the same as two names that share nothing but a
    common ending. One substitution in four characters is a slip; a threshold on
    the ratio would have to be loose enough to also accept genuinely different
    people.
    """
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (ca != cb),
            ))
        if min(current) > cap:
            return cap + 1
        previous = current
    return previous[-1]


class DoctorNames:
    """Roster-backed resolver. Built once, called per cell."""

    def __init__(self, roster):
        self.roster = list(roster)
        self._by_key = {}
        self._parts = {}
        for name in self.roster:
            self._by_key.setdefault(_key(name), name)
            # Each token of a full name, so a surname on its own can find it.
            for token in clean(name).split():
                if len(token) >= 3:
                    self._parts.setdefault(token, set()).add(name)

    @classmethod
    def load(cls, path=ROSTER_FILE):
        lines = Path(path).read_text(encoding="utf-8").splitlines()
        return cls(l.strip() for l in lines if l.strip() and not l.startswith("#"))

    def _resolve_one(self, part):
        """One canonical name, or None when nothing matches it uniquely."""
        cleaned = clean(part)
        if not cleaned or NOT_A_NAME.match(cleaned):
            return None

        key = _key(cleaned)
        if key in self._by_key:
            return self._by_key[key]

        # A fragment of a full name. «نیلفروش زاده» is most of «محمد علی نیلفروش
        # زاده» and «فخیم» is the tail of «طناز فخیم», so the test is whether the
        # roster entry *contains* what was written — not the reverse, which only
        # ever matched a single token and left the clinic's most-written name
        # (495 rows of «نیلفروش زاده») unresolved.
        if len(key) >= 4:
            hits = {name for k, name in self._by_key.items() if key in k}
            if len(hits) == 1:
                return hits.pop()
            if hits:
                return None  # ambiguous: «لطفی» is both الهه and شیوا

        # A full name with a middle name missing: «نیلوفر نوبری» for «نیلوفر
        # نجار نوبری». Not a substring of it — the dropped token sits in the
        # middle — so the test is that every word written appears in the roster
        # entry.
        tokens = [_key(t) for t in cleaned.split() if len(_key(t)) >= 3]
        if len(tokens) >= 2:
            hits = {
                name
                for name in self.roster
                if all(
                    any(t in _key(word) for word in clean(name).split())
                    for t in tokens
                )
            }
            if len(hits) == 1:
                return hits.pop()
            if hits:
                return None

        # A misspelling. Measured against whole names and against single tokens,
        # because «فخیم» is misspelled as often as «طناز فخیم» is.
        #
        # Never for a fragment shorter than four characters: at three, one
        # substitution is most of the word, and «نیل» — which the desk writes for
        # نیلفروش زاده — lands one edit from «نیا» in «امیررضا حنیف نیا».
        if len(key) < 4:
            return None
        candidates = {k: {n} for k, n in self._by_key.items()}
        for token, names in self._parts.items():
            candidates.setdefault(_key(token), set()).update(names)

        cap = 1 if len(key) <= 6 else 2
        near = {
            name
            for candidate, names in candidates.items()
            if _edits(key, candidate, cap) <= cap or _similar(key, candidate) >= 0.85
            for name in names
        }
        return near.pop() if len(near) == 1 else None

    def resolve(self, raw):
        """Canonical name(s) for one spreadsheet cell.

        Returns the cell rewritten, joined with the Arabic comma the CRM uses for
        a line naming two practitioners. Parts that do not resolve are kept as
        the desk wrote them (minus the cleaning above) rather than dropped, so a
        name new to the roster still reaches the report.
        """
        cleaned = clean(raw)
        if not cleaned or NOT_A_NAME.match(cleaned):
            return ""

        out, changed = [], False
        for part in SPLIT.split(cleaned):
            part = part.strip()
            if not part:
                continue
            resolved = self._resolve_one(part)
            if resolved:
                if resolved != part:
                    changed = True
                if resolved not in out:
                    out.append(resolved)
            elif NOT_A_NAME.match(part):
                changed = True
            else:
                out.append(part)
        if not out:
            return ""
        joined = "، ".join(out)
        return joined if (changed or joined != str(raw).strip()) else joined
