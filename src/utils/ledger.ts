import { CashTransaction, TransactionType } from '../types/finance';
import { daysInMonth, isLiveTx, parseYMD } from './calculations';

/** Loại giao dịch làm TĂNG tiền ví. */
export const INFLOW_TYPES: TransactionType[] = [
  'deposit',
  'sell_asset',
  'dividend',
  'rental_income',
  'interest_income',
  'loan_disbursement',
];
/** Loại giao dịch làm GIẢM tiền ví. */
export const OUTFLOW_TYPES: TransactionType[] = ['withdraw', 'buy_asset', 'debt_payment'];

export const isInflow = (type: TransactionType): boolean => INFLOW_TYPES.includes(type);

/**
 * Ảnh hưởng của một dòng sổ lên tiền ví: dương = tăng, âm = giảm.
 * Bút toán đảo (reversalOf) ngược chiều với dòng gốc nên hai dòng triệt tiêu nhau.
 */
export const txEffect = (tx: CashTransaction): number =>
  tx.noCash ? 0 : (isInflow(tx.type) ? tx.amount : -tx.amount) * (tx.reversalOf ? -1 : 1);
const signed = txEffect;

/**
 * Các giao dịch "thật sự xảy ra": bỏ dòng đã hủy và bút toán đảo của nó (hai dòng này triệt tiêu nhau).
 * Dùng cho mọi thống kê (thu nhập, lãi vay đã trả, lịch…); sổ ví vẫn hiện đủ cả hai để đối chiếu.
 */
export const liveTransactions = (list: CashTransaction[]): CashTransaction[] => list.filter(isLiveTx);

/** Sắp sổ theo ngày giảm dần; cùng ngày giữ nguyên thứ tự nhập (dòng nhập sau đứng trước). */
export function sortLedger(list: CashTransaction[]): CashTransaction[] {
  return list
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const da = (a.t.date || '').slice(0, 10);
      const db = (b.t.date || '').slice(0, 10);
      return da < db ? 1 : da > db ? -1 : a.i - b.i;
    })
    .map((x) => x.t);
}

/** Chèn giao dịch mới vào đúng vị trí theo ngày (mới → cũ); cùng ngày thì đứng trước các dòng đã có. */
export function insertTx(list: CashTransaction[], tx: CashTransaction): CashTransaction[] {
  const d = (tx.date || '').slice(0, 10);
  const idx = list.findIndex((t) => (t.date || '').slice(0, 10) <= d);
  const out = [...list];
  out.splice(idx === -1 ? out.length : idx, 0, tx);
  return out;
}

export type RangePreset = 'all' | 'this_month' | 'last_month' | 'last_30' | 'this_quarter' | 'this_year' | 'custom';

export const RANGE_PRESETS: { id: Exclude<RangePreset, 'custom'>; label: string }[] = [
  { id: 'all', label: 'Mọi thời gian' },
  { id: 'this_month', label: 'Tháng này' },
  { id: 'last_month', label: 'Tháng trước' },
  { id: 'last_30', label: '30 ngày' },
  { id: 'this_quarter', label: 'Quý này' },
  { id: 'this_year', label: 'Năm nay' },
];

/** Khoảng ngày (YYYY-MM-DD, gồm cả hai đầu). Chuỗi rỗng = không giới hạn phía đó. */
export interface DateRange {
  from: string;
  to: string;
}

const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Cộng/trừ ngày theo lịch (không phụ thuộc múi giờ). */
export function addDaysStr(s: string, n: number): string {
  const { y, m, d } = parseYMD(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Khoảng ngày của bộ lọc nhanh. Các kỳ đang diễn ra (tháng này, quý này, năm nay) kết thúc ở hôm nay. */
export function rangeForPreset(preset: Exclude<RangePreset, 'custom'>, today: string): DateRange {
  const { y, m } = parseYMD(today);
  switch (preset) {
    case 'all':
      return { from: '', to: '' };
    case 'this_month':
      return { from: ymd(y, m, 1), to: today };
    case 'last_month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: ymd(py, pm, 1), to: ymd(py, pm, daysInMonth(py, pm)) };
    }
    case 'last_30':
      return { from: addDaysStr(today, -29), to: today };
    case 'this_quarter':
      return { from: ymd(y, Math.floor((m - 1) / 3) * 3 + 1, 1), to: today };
    case 'this_year':
      return { from: ymd(y, 1, 1), to: today };
  }
}

export function inRange(date: string, range: DateRange): boolean {
  const d = (date || '').slice(0, 10);
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

/** Ngày bắt đầu sau ngày kết thúc. */
export const isRangeInvalid = (range: DateRange): boolean => !!range.from && !!range.to && range.from > range.to;

export interface LedgerSummary {
  /** Tổng tiền vào / ra của các dòng ĐANG HIỂN THỊ (đã qua cả bộ lọc loại). */
  inflow: number;
  outflow: number;
  net: number;
  /** Số dư ví đầu ngày `from` và cuối ngày `to`, tính trên TOÀN BỘ sổ (không phụ thuộc bộ lọc loại). */
  openingBalance: number;
  closingBalance: number;
  count: number;
}

/**
 * Dòng tổng cho khoảng đã lọc. Số dư đầu/cuối kỳ suy ngược từ tiền ví hiện tại theo NGÀY giao dịch
 * nên đúng cả khi thứ tự nhập trong sổ không trùng thứ tự ngày.
 */
export function summarizeLedger(
  allTransactions: CashTransaction[],
  visible: CashTransaction[],
  availableCash: number,
  range: DateRange
): LedgerSummary {
  const inflow = visible.reduce((s, t) => s + Math.max(0, txEffect(t)), 0);
  const outflow = visible.reduce((s, t) => s + Math.max(0, -txEffect(t)), 0);
  const after = (d: string) => allTransactions.filter((t) => (t.date || '').slice(0, 10) > d).reduce((s, t) => s + signed(t), 0);
  const fromOnward = allTransactions
    .filter((t) => !range.from || (t.date || '').slice(0, 10) >= range.from)
    .reduce((s, t) => s + signed(t), 0);
  return {
    inflow,
    outflow,
    net: inflow - outflow,
    openingBalance: availableCash - fromOnward,
    closingBalance: range.to ? availableCash - after(range.to) : availableCash,
    count: visible.length,
  };
}
