"""python3 -m unittest discover -s scripts -p 'test_*.py'"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from doctor_names import DoctorNames  # noqa: E402

ROSTER = [
    "محمد علی نیلفروش زاده",
    "طناز فخیم",
    "امیررضا حنیف نیا",
    "نیلوفر نجار نوبری",
    "شهره رفیعی",
    "فرشته سالاروند",
    "معصومه محمدی",
    "علیرضا جعفر زاده",
    "عباس دهقان",
    "الهه لطفی",
    "شیوا لطفی",
    "فرزانه رشیدی",
    "مهسا رشیدی",
]


class ResolveTest(unittest.TestCase):
    def setUp(self):
        self.names = DoctorNames(ROSTER)

    def r(self, value):
        return self.names.resolve(value)

    def test_surname_alone(self):
        self.assertEqual(self.r("فخیم"), "طناز فخیم")
        self.assertEqual(self.r("دهقان"), "عباس دهقان")

    def test_leading_names_dropped(self):
        # The clinic's most-written cell: most of a name, not a single token.
        self.assertEqual(self.r("نیلفروش زاده"), "محمد علی نیلفروش زاده")

    def test_middle_name_dropped(self):
        self.assertEqual(self.r("نیلوفر نوبری"), "نیلوفر نجار نوبری")

    def test_spacing(self):
        for written in ("طنازفخیم", "طنا زفخیم", " طناز  فخیم "):
            self.assertEqual(self.r(written), "طناز فخیم", written)
        self.assertEqual(self.r("علیرضا جعفرزاده"), "علیرضا جعفر زاده")

    def test_typos(self):
        for written in ("فحیم", "فخبم", "طناز فخمی", "طناز ذفخیم"):
            self.assertEqual(self.r(written), "طناز فخیم", written)
        self.assertEqual(self.r("عیلرضا جعفر زاده"), "علیرضا جعفر زاده")

    def test_titles_and_invisible_characters(self):
        self.assertEqual(self.r("دکتر طناز فخیم"), "طناز فخیم")
        self.assertEqual(self.r("پروفسور نیلفروش زاده"), "محمد علی نیلفروش زاده")
        self.assertEqual(self.r("‍طناز فخیم"), "طناز فخیم")

    def test_service_leaked_into_the_column(self):
        for junk in ("کاشت مو", "نانو سر", "مشاوره زیبایی", "ویزیت", "نام پزشک", "خوب"):
            self.assertEqual(self.r(junk), "", junk)
        self.assertEqual(self.r("نیلوفر نوبری(کاشت مو)"), "نیلوفر نجار نوبری")

    def test_two_practitioners_in_one_cell(self):
        for written in (
            "نیلفروش زاده/ فخیم",
            "فخیم - نیلفروش زاده",
            "طناز فخیم و نیلفروش زاده",
        ):
            self.assertEqual(self.r(written), "طناز فخیم، محمد علی نیلفروش زاده", written)

    def test_ambiguous_is_left_alone(self):
        # Two people share each of these; guessing is worse than not normalising.
        self.assertEqual(self.r("لطفی"), "لطفی")
        self.assertEqual(self.r("رشیدی"), "رشیدی")

    def test_short_fragment_is_not_guessed(self):
        # «نیل» is one edit from «نیا» in امیررضا حنیف نیا, and means neither
        # confidently enough to rewrite.
        self.assertEqual(self.r("نیل"), "نیل")

    def test_unknown_name_survives(self):
        self.assertEqual(self.r("سمیرا رضایی"), "سمیرا رضایی")

    def test_empty(self):
        self.assertEqual(self.r(""), "")
        self.assertEqual(self.r(None), "")

    def test_real_roster_loads(self):
        live = DoctorNames.load()
        self.assertGreater(len(live.roster), 20)
        self.assertEqual(live.resolve("نیلفروش زاده"), "محمد علی نیلفروش زاده")


if __name__ == "__main__":
    unittest.main()
