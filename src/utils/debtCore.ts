import { AmortizationScheduleItem, Debt, PaymentMethod, RateChange, RateSegment } from '../types/finance';
import { diffDays, dueDateFor, isOpenItem, todayLocalStr } from './calculations';

/**
 * LÕI NỢ (R2): dòng thời gian lãi suất + lịch trả tính lại theo dư nợ thực tế.
 *
 * Quy ước tính lãi mỗi kỳ = dư nợ đầu kỳ × lãi suất đang hiệu lực:
 *  - Kỳ đủ tháng, một mức lãi: dư nợ × lãi/12.
 *  - Kỳ lẻ (đổi lãi giữa kỳ, sau khi trả trước một phần gốc): tính theo số ngày thực tế/365 trên từng đoạn lãi suất.
 * Kỳ đã trả không bao giờ bị tính lại; dư nợ gốc là debt.remainingPrincipal (do app giữ từ lịch sử thanh toán).
 */

const fallbackRate = (d: Debt) => (Number.isFinite(d.annualInterestRate) ? d.annualInterestRate : 0);

/** Dòng thời gian lãi suất của khoản vay (đã sắp theo ngày); dữ liệu cũ chưa có → một mốc đầu = lãi hiện tại. */
export function ensureTimeline(debt: Debt): RateChange[] {
  const t = (debt.rateTimeline || []).filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.effectiveDate) && Number.isFinite(r.annualRate));
  if (t.length === 0) {
    return [
      {
        id: 'rate-0',
        effectiveDate: debt.trackingStartDate || debt.startDate,
        annualRate: fallbackRate(debt),
        baseRate: debt.rateType === 'floating' ? debt.baseRate : undefined,
        margin: debt.rateType === 'floating' ? debt.floatingMargin : undefined,
        source: 'initial',
      },
    ];
  }
  return [...t].sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0));
}

/** Lãi suất đang hiệu lực tại một ngày. Trước mốc đầu tiên: dùng lãi của mốc đầu. */
export function rateAt(timeline: RateChange[], date: string): number {
  let rate = timeline[0].annualRate;
  for (const r of timeline) if (r.effectiveDate <= date) rate = r.annualRate;
  return rate;
}

/** Mốc lãi đang hiệu lực tại một ngày (để lấy lãi cơ sở / biên độ). */
export function changeAt(timeline: RateChange[], date: string): RateChange {
  let cur = timeline[0];
  for (const r of timeline) if (r.effectiveDate <= date) cur = r;
  return cur;
}

/** Chia khoảng [from, to) theo các mốc đổi lãi nằm TRONG khoảng (mốc đầu không tạo điểm cắt). */
export function splitSegments(timeline: RateChange[], from: string, to: string): { from: string; to: string; annualRate: number }[] {
  const cuts = Array.from(new Set(timeline.slice(1).map((r) => r.effectiveDate).filter((d) => d > from && d < to))).sort();
  const pts = [from, ...cuts, to];
  return pts.slice(0, -1).map((f, i) => ({ from: f, to: pts[i + 1], annualRate: rateAt(timeline, f) }));
}

export interface PeriodInterest {
  interest: number;
  segments?: RateSegment[];
  startRate: number;
  endRate: number;
}

/** Lãi một kỳ [from, to) trên dư nợ `balance`. `partial` = kỳ lẻ (luôn tính ngày/365). */
export function periodInterest(balance: number, from: string, to: string, timeline: RateChange[], partial: boolean): PeriodInterest {
  const segs = splitSegments(timeline, from, to);
  if (!partial && segs.length === 1) {
    return { interest: Math.round((balance * segs[0].annualRate) / 100 / 12), startRate: segs[0].annualRate, endRate: segs[0].annualRate };
  }
  let total = 0;
  const out: RateSegment[] = segs.map((s) => {
    const days = Math.max(0, diffDays(s.to, s.from));
    const i = (balance * s.annualRate * days) / 100 / 365;
    total += i;
    return { from: s.from, to: s.to, days, annualRate: s.annualRate, interest: Math.round(i) };
  });
  return { interest: Math.round(total), segments: out, startRate: segs[0].annualRate, endRate: segs[segs.length - 1].annualRate };
}

const pmt = (balance: number, monthlyRate: number, n: number): number =>
  monthlyRate > 0 ? Math.round((balance * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n))) : Math.round(balance / n);

export interface RebuildOptions {
  /** Trả trước rút ngắn kỳ hạn: giữ gốc mỗi kỳ (gốc đều). */
  keepPrincipalPerPeriod?: number;
  /** Trả trước rút ngắn kỳ hạn: giữ số tiền trả mỗi kỳ (trả góp đều). */
  keepPayment?: number;
  /** Cho phép kết thúc sớm: các kỳ thừa chuyển sang "hủy". */
  shorten?: boolean;
}

/** Ngày bắt đầu tính lãi của kỳ ở vị trí idx = ngày đến hạn kỳ liền trước (hoặc mốc neo của lịch). */
export function prevDueOf(debt: Debt, idx: number): string {
  const sch = debt.schedule || [];
  return idx > 0 ? sch[idx - 1].dueDate : debt.scheduleAnchorDate || debt.startDate;
}

/**
 * Tính lại toàn bộ các kỳ CHƯA TRẢ từ dư nợ hiện tại và dòng thời gian lãi suất.
 * Trả trước rút ngắn (opts.shorten): kỳ cuối thừa chuyển sang trạng thái "hủy".
 */
export function rebuildSchedule(debt: Debt, opts: RebuildOptions = {}, today: string = todayLocalStr()): Debt {
  const timeline = ensureTimeline(debt);
  const schedule: AmortizationScheduleItem[] = (debt.schedule || []).map((i) => ({ ...i }));
  const openIdx: number[] = [];
  schedule.forEach((it, i) => {
    if (isOpenItem(it)) openIdx.push(i);
  });
  const current = changeAt(timeline, today);
  const header: Partial<Debt> = {
    rateTimeline: timeline,
    annualInterestRate: current.annualRate,
    baseRate: debt.rateType === 'floating' ? current.baseRate ?? debt.baseRate : debt.baseRate,
    floatingMargin: debt.rateType === 'floating' ? current.margin ?? debt.floatingMargin : debt.floatingMargin,
  };
  if (openIdx.length === 0 || debt.remainingPrincipal <= 0) return { ...debt, ...header, schedule };

  const grace = Math.max(0, debt.graceMonths || 0);
  const lastOpen = openIdx[openIdx.length - 1];
  const isGrace = (i: number) => schedule[i].period <= grace && i !== lastOpen;
  const method: PaymentMethod = debt.method;

  let bal = debt.remainingPrincipal;
  let pmtRate: number | undefined;
  let pmtVal = opts.keepPayment ?? 0;
  let principalFixed = opts.keepPrincipalPerPeriod ?? 0;

  for (let k = 0; k < openIdx.length; k++) {
    const i = openIdx[k];
    const it = schedule[i];
    const from = it.accrualFrom || prevDueOf({ ...debt, schedule }, i);
    const pi = periodInterest(bal, from, it.dueDate, timeline, !!it.accrualFrom);
    const isLast = i === lastOpen;
    let principal = 0;

    if (!isGrace(i)) {
      const left = openIdx.slice(k).filter((x) => !isGrace(x)).length;
      if (method === 'declining_balance') {
        if (!principalFixed) principalFixed = Math.round(bal / left);
        principal = principalFixed;
      } else {
        if (opts.keepPayment === undefined && (pmtRate === undefined || Math.abs(pmtRate - pi.startRate) > 1e-9)) {
          pmtVal = pmt(bal, pi.startRate / 100 / 12, left);
          pmtRate = pi.startRate;
        }
        principal = pmtVal - pi.interest;
      }
      if (!(principal > 0)) principal = 0;
      if (isLast && !opts.shorten) principal = bal;
      principal = Math.min(principal, bal);
      if (bal - principal < 0.5) principal = bal;
    }

    const newBal = Math.max(0, bal - principal);
    schedule[i] = {
      ...it,
      principalPayable: principal,
      interestPayable: pi.interest,
      totalMonthlyPayment: principal + pi.interest,
      remainingBalance: newBal,
      segments: pi.segments,
    };
    bal = newBal;
    if (opts.shorten && bal <= 0) {
      for (const j of openIdx.slice(k + 1)) schedule[j] = { ...schedule[j], status: 'cancelled' };
      break;
    }
  }
  return { ...debt, ...header, schedule };
}

/** Lãi suất đang áp dụng hôm nay của khoản vay. */
export function currentRate(debt: Debt, today: string = todayLocalStr()): number {
  return rateAt(ensureTimeline(debt), today);
}

export interface AccruedInfo {
  interest: number;
  days: number;
  from: string;
  segments: RateSegment[];
}

/** Lãi dồn từ đầu kỳ hiện tại (ngày đến hạn kỳ trước hoặc ngày trả trước gần nhất) đến `date`, tính ngày/365. */
export function accruedInterest(debt: Debt, date: string, balance: number = debt.remainingPrincipal): AccruedInfo | null {
  const sch = debt.schedule || [];
  const idx = sch.findIndex(isOpenItem);
  if (idx < 0) return null;
  const from = sch[idx].accrualFrom || prevDueOf(debt, idx);
  const p = periodInterest(balance, from, date, ensureTimeline(debt), true);
  return { interest: p.interest, days: Math.max(0, diffDays(date, from)), from, segments: p.segments || [] };
}

export type SettlementPreview =
  | { ok: true; balance: number; interest: number; days: number; from: string; total: number; periodIndex: number; segments: RateSegment[] }
  | { ok: false; error: string };

/** Tất toán sớm: dư nợ gốc + lãi dồn đến `date` (ngày nằm trong kỳ hiện tại, không sau ngày đến hạn kỳ tới). */
export function previewSettlement(debt: Debt, date: string, today: string = todayLocalStr()): SettlementPreview {
  if (debt.status !== 'active') return { ok: false, error: 'Khoản vay này không còn đang vay.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { ok: false, error: 'Chọn ngày tất toán.' };
  if (date > today) return { ok: false, error: 'Ngày tất toán không được ở tương lai.' };
  const sch = debt.schedule || [];
  const idx = sch.findIndex(isOpenItem);
  if (idx < 0) return { ok: false, error: 'Khoản vay không còn kỳ nào chưa trả.' };
  const info = accruedInterest(debt, date)!;
  if (date < info.from) return { ok: false, error: `Ngày tất toán không được sớm hơn ${info.from} (đầu kỳ tính lãi hiện tại).` };
  if (date > sch[idx].dueDate) {
    return { ok: false, error: `Kỳ #${sch[idx].period} đến hạn ngày ${sch[idx].dueDate} chưa được ghi nhận. Hãy ghi nhận các kỳ đến hạn trước khi tất toán.` };
  }
  return { ok: true, balance: debt.remainingPrincipal, interest: info.interest, days: info.days, from: info.from, total: debt.remainingPrincipal + info.interest, periodIndex: idx, segments: info.segments };
}

export type PrepayMode = 'reduce_payment' | 'shorten_term';

export type PrepayPreview =
  | { ok: true; interest: number; days: number; from: string; periodIndex: number; newBalance: number; debt: Debt; before: Array<[number, number, number, number, string | null]> }
  | { ok: false; error: string };

/**
 * Trả trước một phần gốc: trả lãi dồn đến `date` + `principal`; dư nợ giảm, kỳ đang chạy tính lãi tiếp từ `date`.
 * reduce_payment (mặc định): giữ kỳ hạn, tính lại tiền trả. shorten_term: giữ tiền trả, rút ngắn kỳ hạn.
 */
export function previewPrepay(debt: Debt, date: string, principal: number, mode: PrepayMode, today: string = todayLocalStr()): PrepayPreview {
  if (debt.status !== 'active') return { ok: false, error: 'Khoản vay này không còn đang vay.' };
  if (!(principal > 0)) return { ok: false, error: 'Nhập số gốc trả trước lớn hơn 0.' };
  if (principal >= debt.remainingPrincipal) return { ok: false, error: 'Số gốc trả trước phải nhỏ hơn dư nợ. Muốn trả hết hãy dùng Tất toán sớm.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { ok: false, error: 'Chọn ngày trả trước.' };
  if (date > today) return { ok: false, error: 'Ngày trả trước không được ở tương lai.' };
  const sch = debt.schedule || [];
  const idx = sch.findIndex(isOpenItem);
  if (idx < 0) return { ok: false, error: 'Khoản vay không còn kỳ nào chưa trả.' };
  const info = accruedInterest(debt, date)!;
  if (date < info.from) return { ok: false, error: `Ngày trả trước không được sớm hơn ${info.from}.` };
  if (date >= sch[idx].dueDate) {
    return { ok: false, error: `Kỳ #${sch[idx].period} đến hạn ngày ${sch[idx].dueDate}. Hãy ghi nhận trả kỳ này trước, sau đó mới trả trước gốc.` };
  }
  const before: Array<[number, number, number, number, string | null]> = [];
  sch.forEach((it, i) => {
    if (isOpenItem(it)) before.push([i, it.principalPayable, it.interestPayable, it.remainingBalance, it.accrualFrom || null]);
  });
  const first = sch[idx];
  const newBalance = debt.remainingPrincipal - principal;
  const schedule = sch.map((it, i) => (i === idx ? { ...it, accrualFrom: date } : it));
  const base: Debt = { ...debt, remainingPrincipal: newBalance, schedule };
  const rebuilt =
    mode === 'shorten_term'
      ? rebuildSchedule(base, debt.method === 'declining_balance' ? { keepPrincipalPerPeriod: first.principalPayable, shorten: true } : { keepPayment: first.totalMonthlyPayment, shorten: true }, today)
      : rebuildSchedule(base, {}, today);
  return { ok: true, interest: info.interest, days: info.days, from: info.from, periodIndex: idx, newBalance, debt: rebuilt, before };
}

/** Khoản vay đang trả dở: lịch chỉ gồm các kỳ còn lại kể từ ngày bắt đầu theo dõi. */
export interface TrackedDebtInput {
  balance: number;          // dư nợ gốc hiện tại
  periods: number;          // số kỳ còn lại
  firstDueDate: string;     // ngày đến hạn kỳ tiếp theo
  trackingStart: string;    // ngày bắt đầu theo dõi
  paymentDay: number;
  annualRate: number;
  rateType: 'fixed' | 'floating';
  baseRate?: number;
  margin?: number;
  method: PaymentMethod;
  graceLeft?: number;
}

export function buildTrackedDebt(base: Omit<Debt, 'principalAmount' | 'remainingPrincipal' | 'tenorMonths' | 'startDate' | 'paymentDayOfMonth' | 'method' | 'annualInterestRate' | 'rateType' | 'schedule' | 'status'>, p: TrackedDebtInput, today: string = todayLocalStr()): Debt {
  const items: AmortizationScheduleItem[] = Array.from({ length: p.periods }, (_, k) => ({
    period: k + 1,
    dueDate: dueDateFor(p.firstDueDate, k, p.paymentDay),
    principalPayable: 0,
    interestPayable: 0,
    totalMonthlyPayment: 0,
    remainingBalance: 0,
    isPaid: false,
  }));
  const debt: Debt = {
    ...base,
    principalAmount: p.balance,
    remainingPrincipal: p.balance,
    annualInterestRate: p.annualRate,
    rateType: p.rateType,
    baseRate: p.rateType === 'floating' ? p.baseRate : undefined,
    floatingMargin: p.rateType === 'floating' ? p.margin : undefined,
    tenorMonths: p.periods,
    startDate: p.trackingStart,
    trackingStartDate: p.trackingStart,
    scheduleAnchorDate: dueDateFor(p.firstDueDate, -1, p.paymentDay),
    paymentDayOfMonth: p.paymentDay,
    method: p.method,
    graceMonths: p.graceLeft || undefined,
    status: 'active',
    schedule: items,
    rateTimeline: [
      {
        id: 'rate-0',
        effectiveDate: p.trackingStart,
        annualRate: p.annualRate,
        baseRate: p.rateType === 'floating' ? p.baseRate : undefined,
        margin: p.rateType === 'floating' ? p.margin : undefined,
        source: 'initial',
      },
    ],
  };
  return rebuildSchedule(debt, {}, today);
}
