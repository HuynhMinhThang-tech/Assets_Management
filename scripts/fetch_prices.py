#!/usr/bin/env python3
"""
Lấy giá đóng cửa cổ phiếu bằng vnstock và ghi vào bảng market_prices (Neon).

Hai chế độ:
  --probe FPT,HPG,VCB   Thăm dò: chỉ in ra dữ liệu thô vnstock trả về (cột, 3 dòng cuối, đơn vị giá, thời gian).
                        KHÔNG cần DATABASE_URL. Dùng để kiểm tra nguồn có chạy được trên máy chủ GitHub không.
  (mặc định)            Đọc các mã cổ phiếu đang nắm giữ của mọi tài khoản, lấy giá, ghi market_prices.

Dùng vnstock THẾ HỆ 6 (bản 4.x và 5 đã ngừng xác thực từ 10/11/2026). Thế hệ 6 KHÔNG có nguồn mặc định và không còn nguồn
miễn phí ẩn danh: bạn phải có khóa Open API của ĐÚNG MỘT nguồn (ssi, dnse, fhsc hoặc tcbs) và đặt VNSTOCK_SOURCE theo nguồn đó.

Biến môi trường:
  DATABASE_URL       chuỗi kết nối Neon (bắt buộc khi không probe)
  VNSTOCK_SOURCE     ssi | dnse | fhsc | tcbs  (bắt buộc)
  Khóa của nguồn:    SSI_API_KEY + SSI_API_SECRET · DNSE_API_KEY + DNSE_API_SECRET · FHSC_API_KEY · TCBS_API_KEY
                     (thư viện tự đọc các biến này; tcbs cần phiên Smart OTP nên không hợp để chạy tự động)
  VNSTOCK_PRICE_SCALE  mặc định 1000: vnstock 6 trả giá cổ phiếu theo NGHÌN đồng
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


SOURCES = ("ssi", "dnse", "fhsc", "tcbs")
# Biến môi trường chứa khóa của từng nguồn (vnstock-oapi tự đọc; ở đây chỉ để kiểm tra sớm và báo lỗi rõ)
SOURCE_KEYS = {
    "ssi": ("SSI_API_KEY", "SSI_API_SECRET"),
    "dnse": ("DNSE_API_KEY", "DNSE_API_SECRET"),
    "fhsc": ("FHSC_API_KEY",),
    "tcbs": ("TCBS_API_KEY",),
}


def check_source(source: str) -> str | None:
    """Trả về thông báo lỗi nếu nguồn không hợp lệ hoặc thiếu khóa; None nếu ổn."""
    if source not in SOURCES:
        return f"VNSTOCK_SOURCE phải là một trong {', '.join(SOURCES)} (đang là {source!r}). vnstock 6 không còn nguồn mặc định hay nguồn kbs/vci."
    missing = [k for k in SOURCE_KEYS[source] if not os.environ.get(k, "").strip()]
    if missing:
        return f"Thiếu khóa nguồn {source}: chưa khai báo {', '.join(missing)} (GitHub → Settings → Secrets and variables → Actions)."
    return None


def setup_vnstock() -> float:
    """Số giây nghỉ giữa hai lần gọi (nhịp thận trọng; giới hạn tần suất do từng nguồn quy định)."""
    return 1.5


def fetch_history(symbol: str, source: str, days: int):
    """Lịch sử nến ngày của một mã theo vnstock 6: Market(nguồn).equity(mã).ohlcv(...). Giá cổ phiếu tính bằng nghìn đồng."""
    from vnstock import Market

    end = today_vn()
    start = end - dt.timedelta(days=days)
    df = Market(source).equity(symbol).ohlcv(start=start.isoformat(), end=end.isoformat(), interval="1D")
    # Nến cuối của phiên chưa đóng cửa (chạy trong giờ giao dịch) không phải giá đóng cửa: bỏ đi
    if df is not None and len(df) and getattr(df, "attrs", {}).get("last_bar_partial"):
        df = df.iloc[:-1]
    return df


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


def detect_scale(closes: list[float]) -> str:
    """Chế độ 'auto': quyết định MỘT hệ số cho cả lượt chạy theo trung vị giá đóng cửa của tất cả các mã.

    Dưới 500 → nguồn trả nghìn đồng ('1000'); từ 500 → đã là đồng ('1'). Quyết định theo cả nhóm mã nên một cổ phiếu giá thấp
    (ví dụ 450 đ) không bị nhận nhầm như khi quyết định riêng từng mã. Vẫn nên đặt cố định VNSTOCK_PRICE_SCALE sau khi xem log thăm dò.
    """
    vals = sorted(v for v in closes if v > 0)
    if not vals:
        return "1000"
    mid = vals[len(vals) // 2] if len(vals) % 2 else (vals[len(vals) // 2 - 1] + vals[len(vals) // 2]) / 2
    return "1000" if mid < 500 else "1"


def to_vnd(value: float, scale: str) -> float:
    """vnstock thường trả giá theo nghìn đồng (25,5 = 25.500 đ). scale: '1000' | '1' (đã chọn); 'auto' chỉ còn dùng cho từng giá trị lẻ."""
    if scale == "1000":
        return round(value * 1000, 2)
    if scale == "1":
        return round(value, 2)
    return round(value * 1000, 2) if value < 500 else round(value, 2)


# Giá đóng cửa mới lệch quá nhiều so với phiên đã lưu trước đó thường là sai đơn vị (×1000 hoặc ÷1000), không phải biến động thật
# (biên độ ngày tối đa các sàn VN là ±7%/±10%/±15%). Cho phép nhiều phiên bị bỏ lỡ cộng dồn nên ngưỡng rộng hơn.
SANITY_MIN_RATIO = 0.4
SANITY_MAX_RATIO = 2.5


def price_sane(new_price: float, previous_close: float | None) -> bool:
    if previous_close is None or previous_close <= 0:
        return True
    r = new_price / previous_close
    return SANITY_MIN_RATIO <= r <= SANITY_MAX_RATIO


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


def previous_close(conn, sym: str, before: dt.date) -> float | None:
    with conn.cursor() as cur:
        cur.execute(
            "select close from market_prices where kind = 'stock' and symbol = %s and price_date < %s order by price_date desc limit 1",
            (sym, before),
        )
        row = cur.fetchone()
    return float(row[0]) if row else None


def write_summary(lines: list[str]) -> None:
    """Ghi tóm tắt vào trang kết quả của GitHub Actions (nếu chạy trên Actions)."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    except OSError:
        pass


def run(source: str, scale: str, keep: int, dry: bool) -> int:
    import psycopg

    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        log("Thiếu biến môi trường DATABASE_URL.")
        return 2
    delay = setup_vnstock()
    fetched: dict[str, list[tuple[dt.date, float]]] = {}
    errors: dict[str, str] = {}
    with psycopg.connect(url) as conn:
        symbols = held_symbols(conn)
        if not symbols:
            log("Không có cổ phiếu nào đang nắm giữ → không có gì để lấy.")
            return 0
        log(f"{len(symbols)} mã: {', '.join(symbols)} · nguồn {source} · {today_vn()}")

        # Lượt 1: lấy hết rồi mới quyết định đơn vị (không ghi gì)
        for i, sym in enumerate(symbols):
            if i:
                time.sleep(delay)
            try:
                rows = tidy(get_with_retry(sym, source, 14))[-keep:]
                if not rows:
                    raise ValueError("không có dòng giá hợp lệ")
                fetched[sym] = rows
            except Exception as e:  # noqa: BLE001
                errors[sym] = f"{type(e).__name__}: {e}"
                print(f"::error::{sym}: {errors[sym]}", flush=True)

        use_scale = scale if scale != "auto" else detect_scale([r[-1][1] for r in fetched.values()])
        if scale == "auto":
            log(f"Đơn vị giá tự nhận diện theo trung vị các mã: hệ số {use_scale} (nên đặt cố định VNSTOCK_PRICE_SCALE={use_scale}).")

        # Lượt 2: kiểm tra độ hợp lý so với phiên đã lưu trước đó, rồi ghi
        done = 0
        skipped: dict[str, str] = {}
        for sym, rows in fetched.items():
            try:
                newest_d, newest_v = rows[-1]
                prev = previous_close(conn, sym, newest_d)
                if not price_sane(to_vnd(newest_v, use_scale), prev):
                    skipped[sym] = (
                        f"giá mới {to_vnd(newest_v, use_scale):,.0f} đ lệch bất thường so với phiên trước đã lưu {prev:,.0f} đ "
                        f"(có thể sai đơn vị: kiểm tra VNSTOCK_PRICE_SCALE)"
                    )
                    print(f"::error::{sym}: {skipped[sym]}", flush=True)
                    continue
                with conn.cursor() as cur:
                    for d, v in rows:
                        if not dry:
                            cur.execute(UPSERT, (sym, d, to_vnd(v, use_scale), f"vnstock:{source}"))
                conn.commit()
                log(f"  {sym}: {newest_d} đóng cửa {to_vnd(newest_v, use_scale):,.0f} đ  ({len(rows)} dòng{', DRY-RUN' if dry else ''})")
                done += 1
            except Exception as e:  # noqa: BLE001
                conn.rollback()
                errors[sym] = f"{type(e).__name__}: {e}"
                print(f"::error::{sym}: {errors[sym]}", flush=True)

    failed = len(errors) + len(skipped)
    log(f"Xong: {done} mã thành công, {failed} lỗi.")
    summary = [f"### Lấy giá đóng cửa {today_vn()}", f"- Thành công: **{done}/{len(symbols)}** mã · nguồn `{source}` · hệ số đơn vị `{use_scale}`"]
    for sym, why in {**errors, **skipped}.items():
        summary.append(f"- ❌ **{sym}**: {why}")
    write_summary(summary)
    return 1 if done == 0 else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--probe", metavar="MÃ,MÃ", help="chỉ thăm dò các mã này, không ghi cơ sở dữ liệu")
    ap.add_argument("--source", default=os.environ.get("VNSTOCK_SOURCE", "").strip().lower(), help="nguồn vnstock 6: ssi | dnse | fhsc | tcbs (bắt buộc)")
    ap.add_argument("--scale", choices=["auto", "1", "1000"], default=os.environ.get("VNSTOCK_PRICE_SCALE", "1000"),
                    help="hệ số đổi giá vnstock sang đồng: 1000 (mặc định, vnstock 6 trả nghìn đồng) | 1 | auto")
    ap.add_argument("--keep", type=int, default=2, help="số phiên gần nhất ghi vào bảng (mặc định 2: hôm nay + phiên trước)")
    ap.add_argument("--dry-run", action="store_true", help="lấy giá và in ra nhưng không ghi cơ sở dữ liệu")
    a = ap.parse_args()
    problem = check_source(a.source)
    if problem:
        print(f"::error::{problem}", flush=True)
        return 2
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
