import { Asset, UserFinancialState } from '../types/finance';
import { diffDays, dueDateFor, formatVND, getSavingsAccrual, todayLocalStr } from './calculations';

/**
 * Dựng các sự kiện thu / chi của MỘT THÁNG từ dữ liệu sẵn có – không lưu thêm gì:
 *  - Kỳ trả nợ: lấy thẳng từ lịch trả nợ của từng khoản vay (nên tự cập nhật khi đổi lãi suất, dư nợ, thêm khoản vay mới…).
 *  - Tiền thuê định kỳ: từ thu nhập hàng tháng + ngày nhận khai báo trên tài sản (BĐS / tài sản khác).
 *  - Tiền đã nhận thật: các giao dịch cổ tức / tiền thuê / lãi đã ghi nhận trong Ví.
 *  - Đáo hạn sổ tiết kiệm.
 */

export type CalendarEventKind =
  | 'debt_due' // kỳ trả nợ sắp tới
  | 'debt_overdue' // kỳ trả nợ đã quá hạn, chưa ghi nhận
  | 'debt_paid' // kỳ trả nợ đã trả
  | 'income_expected' // tiền thuê dự kiến nhận
  | 'income_unrecorded' // đã qua ngày nhận nhưng chưa ghi nhận vào Ví
  | 'income_received' // tiền đã nhận (có giao dịch trong Ví)
  | 'savings_maturity'; // đáo hạn sổ tiết kiệm

export interface CalendarEvent {
  id: string;
  date: string; // YYYY-MM-DD
  kind: CalendarEventKind;
  direction: 'out' | 'in';
  title: string;
  subtitle: string;
  amount: number;
  principal?: number;
  interest?: number;
  balanceAfter?: number; // dư nợ gốc còn lại sau kỳ (khoản nợ)
  debtId?: string;
  periodIndex?: number;
  /** Là kỳ chưa trả đầu tiên của khoản vay → có thể bấm "Trả kỳ này" ngay trên lịch. */
  payable?: boolean;
  assetId?: string;
}

export const EVENT_KIND_LABEL: Record<CalendarEventKind, string> = {
  debt_due: 'Đến hạn',
  debt_overdue: 'Quá hạn',
  debt_paid: 'Đã trả',
  income_expected: 'Dự kiến nhận',
  income_unrecorded: 'Chưa ghi nhận',
  income_received: 'Đã nhận',
  savings_maturity: 'Đáo hạn',
};

/** Thu nhập định kỳ hàng tháng khai báo trên tài sản (cho thuê nhà, cho thuê xe…). */
export function getRecurringIncome(asset: Asset): { amount: number; day: number } | null {
  if (asset.category !== 'real_estate' && asset.category !== 'other') return null;
  const md = asset.metadata as { monthlyRentalIncome?: number; rentalDayOfMonth?: number };
  const amount = Number(md.monthlyRentalIncome) || 0;
  if (amount <= 0) return null;
  const day = Math.min(31, Math.max(1, Math.round(Number(md.rentalDayOfMonth) || 1)));
  return { amount, day };
}

const INCOME_TX_LABEL: Record<string, string> = {
  dividend: 'Cổ tức',
  rental_income: 'Tiền thuê',
  interest_income: 'Lãi tiền gửi',
};

/** Số ngày gần nhất mà một khoản thu dự kiến chưa có giao dịch vẫn được nhắc là "chưa ghi nhận". */
const UNRECORDED_WINDOW_DAYS = 62;

export function buildMonthEvents(
  state: UserFinancialState,
  year: number,
  month: number,
  today: string = todayLocalStr()
): CalendarEvent[] {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const monthStart = `${ym}-01`;
  const events: CalendarEvent[] = [];

  // 1. Kỳ trả nợ
  for (const debt of state.debts) {
    const schedule = debt.schedule || [];
    const firstUnpaid = schedule.findIndex((i) => !i.isPaid);
    schedule.forEach((item, idx) => {
      if (item.dueDate.slice(0, 7) !== ym) return;
      const kind: CalendarEventKind = item.isPaid
        ? 'debt_paid'
        : item.dueDate < today
        ? 'debt_overdue'
        : 'debt_due';
      events.push({
        id: `debt-${debt.id}-${item.period}`,
        date: item.dueDate,
        kind,
        direction: 'out',
        title: debt.name,
        subtitle: `${debt.lender} · Kỳ #${item.period}/${debt.tenorMonths}`,
        amount: item.totalMonthlyPayment,
        principal: item.principalPayable,
        interest: item.interestPayable,
        balanceAfter: item.remainingBalance,
        debtId: debt.id,
        periodIndex: idx,
        payable: !item.isPaid && idx === firstUnpaid && debt.status === 'active',
      });
    });
  }

  // 2. Tiền đã nhận thật (giao dịch trong Ví)
  const incomeTx = state.transactions.filter(
    (t) => INCOME_TX_LABEL[t.type] && t.date.slice(0, 7) === ym
  );
  for (const t of incomeTx) {
    events.push({
      id: `tx-${t.id}`,
      date: t.date,
      kind: 'income_received',
      direction: 'in',
      title: t.title || INCOME_TX_LABEL[t.type],
      subtitle: `${INCOME_TX_LABEL[t.type]} · đã ghi nhận vào ví`,
      amount: t.amount,
      assetId: t.linkedAssetId,
    });
  }

  // 3. Tiền thuê định kỳ dự kiến (bỏ qua tháng đã có giao dịch tiền thuê của chính tài sản đó)
  for (const asset of state.assets) {
    const rec = getRecurringIncome(asset);
    if (!rec) continue;
    const date = dueDateFor(monthStart, 0, rec.day);
    if (date < asset.purchaseDate) continue;
    if (asset.status === 'sold' && date > asset.lastValuationDate) continue;
    if (incomeTx.some((t) => t.type === 'rental_income' && t.linkedAssetId === asset.id)) continue;

    let kind: CalendarEventKind;
    if (date >= today) kind = 'income_expected';
    else if (diffDays(today, date) <= UNRECORDED_WINDOW_DAYS) kind = 'income_unrecorded';
    else continue; // quá xa trong quá khứ: không biết người dùng có nhận không nên không suy đoán
    events.push({
      id: `rent-${asset.id}-${ym}`,
      date,
      kind,
      direction: 'in',
      title: asset.name,
      subtitle: `Thu nhập hàng tháng · ngày ${rec.day}`,
      amount: rec.amount,
      assetId: asset.id,
    });
  }

  // 4. Đáo hạn sổ tiết kiệm
  for (const asset of state.assets) {
    if (asset.status !== 'active' || asset.category !== 'savings') continue;
    const acc = getSavingsAccrual(asset, today);
    if (acc.maturityDate.slice(0, 7) !== ym) continue;
    events.push({
      id: `sav-${asset.id}`,
      date: acc.maturityDate,
      kind: 'savings_maturity',
      direction: 'in',
      title: asset.name,
      subtitle: `Đáo hạn · gốc ${formatVND(acc.principal, { compact: true })} + lãi ${formatVND(acc.interestAtMaturity, { compact: true })}`,
      amount: acc.amountAtMaturity,
      principal: acc.principal,
      interest: acc.interestAtMaturity,
      assetId: asset.id,
    });
  }

  return events.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.direction === b.direction ? 0 : a.direction === 'out' ? -1 : 1) ||
      a.title.localeCompare(b.title)
  );
}

export function summarizeMonth(events: CalendarEvent[]) {
  const sum = (f: (e: CalendarEvent) => boolean) => events.filter(f).reduce((s, e) => s + e.amount, 0);
  const outTotal = sum((e) => e.direction === 'out');
  const outPaid = sum((e) => e.kind === 'debt_paid');
  const outOpen = outTotal - outPaid;
  const outOverdue = sum((e) => e.kind === 'debt_overdue');
  const inReceived = sum((e) => e.kind === 'income_received');
  const inExpected = sum((e) => e.kind === 'income_expected' || e.kind === 'savings_maturity');
  const inUnrecorded = sum((e) => e.kind === 'income_unrecorded');
  const inTotal = inReceived + inExpected + inUnrecorded;
  return { outTotal, outPaid, outOpen, outOverdue, inReceived, inExpected, inUnrecorded, inTotal, net: inTotal - outTotal };
}
