"""Kiểm thử các hàm thuần của scripts/fetch_prices.py (không cần vnstock/psycopg/mạng).
Chạy: python3 -m unittest discover -s tests/python -v
"""
import datetime as dt
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
import fetch_prices as fp  # noqa: E402


class FakeDF:
    def __init__(self, cols, rows):
        self.columns = cols
        self._rows = rows

    def __len__(self):
        return len(self._rows)

    def __getitem__(self, col):
        i = self.columns.index(col)
        return [r[i] for r in self._rows]


class DetectScale(unittest.TestCase):
    def test_thousand_vnd_group(self):
        self.assertEqual(fp.detect_scale([25.5, 120.3, 41.2]), "1000")

    def test_vnd_group(self):
        self.assertEqual(fp.detect_scale([25500, 120300, 41200]), "1")

    def test_low_priced_stock_in_vnd_not_misread_when_group_is_vnd(self):
        # một cổ phiếu 450 đ trong nhóm giá bằng đồng không làm cả nhóm bị nhân 1000
        self.assertEqual(fp.detect_scale([450, 25500, 41200]), "1")

    def test_empty_defaults_to_thousand(self):
        self.assertEqual(fp.detect_scale([]), "1000")

    def test_ignores_non_positive(self):
        self.assertEqual(fp.detect_scale([0, -1, 30.0]), "1000")


class ToVnd(unittest.TestCase):
    def test_fixed_scales(self):
        self.assertEqual(fp.to_vnd(25.5, "1000"), 25500.0)
        self.assertEqual(fp.to_vnd(25500, "1"), 25500.0)


class Sanity(unittest.TestCase):
    def test_no_previous_is_ok(self):
        self.assertTrue(fp.price_sane(25000, None))

    def test_normal_move(self):
        self.assertTrue(fp.price_sane(25500, 25000))
        self.assertTrue(fp.price_sane(23000, 25000))

    def test_wrong_unit_x1000_or_div1000_is_rejected(self):
        self.assertFalse(fp.price_sane(25_000_000, 25000))
        self.assertFalse(fp.price_sane(25, 25000))

    def test_boundaries(self):
        self.assertTrue(fp.price_sane(25000 * fp.SANITY_MAX_RATIO, 25000))
        self.assertFalse(fp.price_sane(25000 * fp.SANITY_MAX_RATIO * 1.01, 25000))
        self.assertTrue(fp.price_sane(25000 * fp.SANITY_MIN_RATIO, 25000))


class SourceCheck(unittest.TestCase):
    def setUp(self):
        self._saved = {k: os.environ.pop(k, None) for ks in fp.SOURCE_KEYS.values() for k in ks}

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_old_sources_rejected(self):
        for old in ("kbs", "vci", "", "KBS"):
            self.assertIsNotNone(fp.check_source(old))

    def test_missing_keys_named(self):
        msg = fp.check_source("ssi")
        self.assertIn("SSI_API_KEY", msg)
        self.assertIn("SSI_API_SECRET", msg)

    def test_ok_when_keys_present(self):
        os.environ["FHSC_API_KEY"] = "x"
        self.assertIsNone(fp.check_source("fhsc"))
        os.environ["SSI_API_KEY"] = "x"
        self.assertIsNotNone(fp.check_source("ssi"))  # còn thiếu SECRET
        os.environ["SSI_API_SECRET"] = "y"
        self.assertIsNone(fp.check_source("ssi"))


class Tidy(unittest.TestCase):
    def test_sorted_dedup_and_invalid_rows_dropped(self):
        today = fp.today_vn()
        d1, d2 = today - dt.timedelta(days=2), today - dt.timedelta(days=1)
        df = FakeDF(["time", "close"], [(str(d2), 26.0), (str(d1), 25.0), ("không phải ngày", 9), (str(d1), 25.5), (str(today), 0), (str(today + dt.timedelta(days=3)), 30)])
        rows = fp.tidy(df)
        self.assertEqual(rows, [(d1, 25.5), (d2, 26.0)])

    def test_empty(self):
        self.assertEqual(fp.tidy(None), [])
        self.assertEqual(fp.tidy(FakeDF(["time", "close"], [])), [])

    def test_missing_columns_raises_with_column_list(self):
        with self.assertRaises(ValueError) as cm:
            fp.tidy(FakeDF(["a", "b"], [(1, 2)]))
        self.assertIn("a", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
