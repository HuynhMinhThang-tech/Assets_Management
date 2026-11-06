#!/usr/bin/env python3
"""
Lấy giá đóng cửa cổ phiếu bằng vnstock và ghi vào bảng market_prices (Neon).

Hai chế độ:
  --probe FPT,HPG,VCB   Thăm dò: chỉ in ra dữ liệu thô vnstock trả về (cột, 3 dòng cuối, đơn vị giá, thời gian).
                        KHÔNG cần DATABASE_URL. Dùng để kiểm tra nguồn có chạy được trên máy chủ GitHub không.
  (mặc định)            Đọc các mã cổ phiếu đang nắm giữ của mọi tài khoản, lấy giá, ghi market_prices.

Biến môi trường:
  DATABASE_URL      chuỗi kết nối Neon (bắt buộc khi không probe)
  VNSTOCK_API_KEY   (tùy chọn) khóa vnstock miễn phí → hạn mức 60 lượt/phút thay vì 20
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import sys
import time

VN_TZ = dt.timezone(dt.timedelta(hours=7))
SYMBOL_RE = re.compile(r"^[A-Z0-9._-]{1,20}$")


def today_vn() -> dt.date:
    return dt.datetime.now(VN_TZ).date()


def log(msg: str) -> None:
    print(msg, flush=True)


def warn(msg: str) -> None:
    # Hiện thành cảnh báo vàng trong giao diện GitHub Actions
    print(f"::warning::{msg}", flush=True)


def setup_vnstock() -> float:
    """Đăng ký API key nếu có; trả về số giây nghỉ giữa hai lần gọi để không vượt hạn mức."""
    key = os.environ.get("VNSTOCK_API_KEY", "").strip()
    if key:
        try:
            from vnstock import register_user

            register_user(api_key=key)
            log("Đã dùng VNSTOCK_API_KEY (hạn mức 60 lượt/phút).")
            return 1.1
        except Exception as e:  # noqa: BLE001
            warn(f"Không đăng ký được API key ({e}); quay về hạn mức khách 20 lượt/phút.")
    return 3.2


def fetch_history(symbol: str, source: str, days: int):
    from vnstock import Quote

    end = today_vn()
    start = end - dt.timedelta(days=days)
    q = Quote(symbol=symbol, source=source)
    return q.history(start=start.isoformat(), end=end.isoformat(), interval="1D")


def tidy(df) -> list[tuple[dt.date, float]]:
    """Chuẩn hóa DataFrame vnstock → [(ngày, giá đóng cửa gốc)] tăng dần theo ngày, bỏ dòng không hợp lệ."""
    if df is None or len(df) == 0:
        return []
    cols = {str(c).lower(): c for c in df.columns}
    tcol = cols.get("time") or cols.get("date") or cols.get("tradingdate")
    ccol = cols.get("close")
    if tcol is None or ccol is None:
        raise ValueError(f"Thiếu cột thời gian/close; có các cột: {list(df.columns)}")
    out: dict[dt.date, float] = {}
    for t, c in zip(df[tcol], df[ccol]):
        try:
            d = dt.date.fromisoformat(str(t)[:10])
            v = float(c)
        except (TypeError, ValueError):
            continue
        if v > 0 and d <= today_vn():
            out[d] = v
    return sorted(out.items())


def to_vnd(value: float, scale: str) -> float:
    """vnstock thường trả giá theo nghìn đồng (25,5 = 25.500 đ). 'auto': dưới 500 coi là nghìn đồng."""
    if scale == "1000":
        return round(value * 1000, 2)
    if scale == "1":
        return round(value, 2)
    return round(value * 1000, 2) if value < 500 else round(value, 2)


def get_with_retry(symbol: str, source: str, days: int, tries: int = 3):
    last: Exception | None = None
    for i in range(tries):
        try:
            return fetch_history(symbol, source, days)
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise last  # type: ignore[misc]


def probe(symbols: list[str], source: str, scale: str) -> int:
    import vnstock

    log(f"vnstock {getattr(vnstock, '__version__', '?')} · nguồn {source} · hôm nay (giờ VN) {today_vn()}")
    delay = setup_vnstock()
    ok = 0
    for i, sym in enumerate(symbols):
        if i:
            time.sleep(delay)
        t0 = time.time()
        try:
            df = get_with_retry(sym, source, 10)
            rows = tidy(df)
            took = time.time() - t0
            log(f"\n== {sym}: {len(df)} dòng, {took:.1f}s, cột = {list(df.columns)}")
            log(df.tail(3).to_string())
            for d, v in rows[-3:]:
                log(f"   {d}  gốc={v}  → VND (scale={scale}) = {to_vnd(v, scale):,.0f}")
            if rows:
                ok += 1
            else:
                warn(f"{sym}: không có dòng hợp lệ")
        except Exception as e:  # noqa: BLE001
            warn(f"{sym}: LỖI {type(e).__name__}: {e}")
    log(f"\nKết quả thăm dò: {ok}/{len(symbols)} mã lấy được.")
    return 0 if ok else 1


def held_symbols(conn) -> list[str]:
    sql = """
        select distinct upper(a->'metadata'->>'symbol') as sym
        from portfolios p,
             jsonb_array_elements(case when jsonb_typeof(p.data->'assets') = 'array' then p.data->'assets' else '[]'::jsonb end) a
        where a->>'category' = 'stock'
          and coalesce(a->>'status', 'active') = 'active'
          and coalesce(a->'metadata'->>'symbol', '') <> ''
        order by 1
    """
    with conn.cursor() as cur:
        cur.execute(sql)
        syms = [r[0].strip() for r in cur.fetchall()]
    good = [s for s in syms if SYMBOL_RE.match(s)]
    for s in set(syms) - set(good):
        warn(f"Bỏ qua mã không hợp lệ: {s!r}")
    return good


UPSERT = """
    insert into market_prices (kind, symbol, price_date, close, source, fetched_at)
    values ('stock', %s, %s, %s, %s, now())
    on conflict (kind, symbol, price_date)
    do update set close = excluded.close, source = excluded.source, fetched_at = now()
"""


def run(source: str, scale: str, keep: int, dry: bool) -> int:
    import psycopg

    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        log("Thiếu biến môi trường DATABASE_URL.")
        return 2
    delay = setup_vnstock()
    done = failed = 0
    with psycopg.connect(url) as conn:
        symbols = held_symbols(conn)
        if not symbols:
            log("Không có cổ phiếu nào đang nắm giữ → không có gì để lấy.")
            return 0
        log(f"{len(symbols)} mã: {', '.join(symbols)} · nguồn {source} · {today_vn()}")
        for i, sym in enumerate(symbols):
            if i:
                time.sleep(delay)
            try:
                rows = tidy(get_with_retry(sym, source, 14))[-keep:]
                if not rows:
                    raise ValueError("không có dòng giá hợp lệ")
                with conn.cursor() as cur:
                    for d, v in rows:
                        price = to_vnd(v, scale)
                        if not dry:
                            cur.execute(UPSERT, (sym, d, price, f"vnstock:{source}"))
                    conn.commit()
                d, v = rows[-1]
                log(f"  {sym}: {d} đóng cửa {to_vnd(v, scale):,.0f} đ  ({len(rows)} dòng{', DRY-RUN' if dry else ''})")
                done += 1
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                failed += 1
                warn(f"{sym}: {type(e).__name__}: {e}")
    log(f"Xong: {done} mã thành công, {failed} lỗi.")
    return 1 if done == 0 else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--probe", metavar="MÃ,MÃ", help="chỉ thăm dò các mã này, không ghi cơ sở dữ liệu")
    ap.add_argument("--source", default=os.environ.get("VNSTOCK_SOURCE", "KBS"), help="nguồn vnstock (mặc định KBS)")
    ap.add_argument("--scale", choices=["auto", "1", "1000"], default=os.environ.get("VNSTOCK_PRICE_SCALE", "auto"),
                    help="hệ số đổi giá vnstock sang đồng: auto | 1 | 1000")
    ap.add_argument("--keep", type=int, default=2, help="số phiên gần nhất ghi vào bảng (mặc định 2: hôm nay + phiên trước)")
    ap.add_argument("--dry-run", action="store_true", help="lấy giá và in ra nhưng không ghi cơ sở dữ liệu")
    a = ap.parse_args()
    if a.probe:
        syms = [s.strip().upper() for s in a.probe.split(",") if s.strip()]
        bad = [s for s in syms if not SYMBOL_RE.match(s)]
        if bad or not syms:
            log(f"Mã không hợp lệ: {bad or 'danh sách rỗng'}")
            return 2
        return probe(syms, a.source, a.scale)
    return run(a.source, a.scale, max(1, a.keep), a.dry_run)


if __name__ == "__main__":
    sys.exit(main())
