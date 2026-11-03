import { Asset, CashTransaction, Debt, SavingsMetadata, UserFinancialState } from '../types/finance';
import { daysInMonth, getSavingsAccrual, isLiveTx, parseYMD, todayLocalStr } from './calculations';
import { BalanceSheet, calculateBalanceSheet } from './balanceSheet';
import { addDaysStr, txEffect } from './ledger';

/**
 * Ba báo cáo cho tài chính đầu tư cá nhân (tính theo tiền thực thu, thực chi, khớp sổ giao dịch):
 *   1. Bảng cân đối (đầu kỳ, cuối kỳ, thay đổi)      2. Báo cáo lưu chuyển tiền tệ
 *   3. Báo cáo hoạt động kinh doanh (kết quả đầu tư)   + các phép đối soát giữa ba báo cáo.
 * Số dư đầu kỳ được KHÔI PHỤC từ sổ giao dịch, lịch sử định giá và lịch trả nợ; vì vậy là ước tính ở những chỗ dữ liệu cũ
 * không có đủ lịch sử (ví dụ tài sản chưa từng định giá lại được coi là giá vốn tại thời điểm đó).
 */

export type PeriodKind = 'month' | 'quarter' | 'year' | 'custom';

export interface PeriodSpec {
  kind: PeriodKind;
  year: number;
  /** 1–12 (kind = month) */
  month: number;
  /** 1–4 (kind = quarter) */
  quarter: number;
  from?: string;
  to?: string;
}

export interface ReportPeriod {
  kind: PeriodKind;
  label: string;
  /** Ngày đầu kỳ (gồm). */
  from: string;
  /** Ngày cuối kỳ (gồm), không vượt quá hôm nay. */
  to: string;
  valid: boolean;
}

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const vn = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

export function buildPeriod(spec: PeriodSpec, today: string = todayLocalStr()): ReportPeriod {
  let from: string;
  let end: string;
  let label: string;
  if (spec.kind === 'month') {
    from = ymd(spec.year, spec.month, 1);
    end = ymd(spec.year, spec.month, daysInMonth(spec.year, spec.month));
    label = `Tháng ${spec.month}/${spec.year}`;
  } else if (spec.kind === 'quarter') {
    const m0 = (spec.quarter - 1) * 3 + 1;
    from = ymd(spec.year, m0, 1);
    end = ymd(spec.year, m0 + 2, daysInMonth(spec.year, m0 + 2));
    label = `Quý ${spec.quarter}/${spec.year}`;
  } else if (spec.kind === 'year') {
    from = ymd(spec.year, 1, 1);
    end = ymd(spec.year, 12, 31);
    label = `Năm ${spec.year}`;
  } else {
    from = spec.from || '';
    end = spec.to || '';
    label = from && end ? `${vn(from)} – ${vn(end)}` : 'Tùy chọn';
  }
  const to = end && end > today ? today : end;
  return { kind: spec.kind, label, from, to, valid: /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to };
}

const inPeriod = (date: string, p: ReportPeriod) => date.slice(0, 10) >= p.from && date.slice(0, 10) <= p.to;
const live = (s: UserFinancialState): CashTransaction[] => s.transactions.filter(isLiveTx);
const sumBy = (list: CashTransaction[], f: (t: CashTransaction) => number) => list.reduce((s, t) => s + f(t), 0);

// ============================================================================ KHÔI PHỤC SỐ DƯ THEO NGÀY
/** Tiền ví cuối ngày `date`: tiền hiện tại trừ ảnh hưởng của các giao dịch sau ngày đó. */
export function cashAt(state: UserFinancialState, date: string): number {
  return state.wallet.availableCash - sumBy(state.transactions.filter((t) => t.date.slice(0, 10) > date), txEffect);
}

const isSoldOutSell = (a: Asset, t: CashTransaction) => t.type === 'sell_asset' && (t.soldOut === true || (t.soldOut === undefined && a.status === 'sold'));

/** Tài sản có đang nắm giữ vào cuối ngày `date` không. */
export function assetHeldAt(state: UserFinancialState, a: Asset, date: string): boolean {
  if (a.status === 'voided' || a.purchaseDate > date) return false;
  return !live(state).some((t) => t.linkedAssetId === a.id && isSoldOutSell(a, t) && t.date.slice(0, 10) <= date);
}

/**
 * Giá vốn còn lại của tài sản vào cuối ngày `date`: cộng lại giá vốn các lần bán một phần sau ngày đó
 * và trừ các khoản đầu tư thêm sau ngày đó (ví dụ nhập lãi vào gốc sổ tiết kiệm khi tái tục).
 */
export function assetCostAt(state: UserFinancialState, a: Asset, date: string): number {
  const lv = live(state);
  const later = lv.filter((t) => t.type === 'sell_asset' && t.linkedAssetId === a.id && !t.soldOut && t.date.slice(0, 10) > date);
  const added = lv.filter((t) => t.type === 'buy_asset' && t.linkedAssetId === a.id && t.date.slice(0, 10) > date && t.date.slice(0, 10) > a.purchaseDate);
  return a.initialCost + sumBy(later, (t) => t.costBasisSold || 0) - sumBy(added, (t) => t.amount);
}

/**
 * Thị giá của tài sản vào cuối ngày `date`: hôm nay = giá hiện tại; tiết kiệm = gốc + lãi chưa nhận; còn lại lấy lần định giá
 * gần nhất không sau ngày đó (trừ phần đã bán một phần sau lần định giá). Chưa từng định giá = coi bằng giá vốn.
 */
export function assetValueAt(state: UserFinancialState, a: Asset, date: string, today: string = todayLocalStr()): number {
  if (date >= today) return a.currentValue;
  if (a.category === 'savings') {
    const m = a.metadata as SavingsMetadata;
    const acc = getSavingsAccrual(a, date);
    const recv = sumBy(live(state).filter((t) => t.type === 'interest_income' && t.linkedAssetId === a.id && t.date.slice(0, 10) <= date), (t) => t.amount);
    void m;
    return acc.principal + Math.max(0, acc.accruedInterest - recv);
  }
  const hist = (a.valuationHistory || []).filter((h) => h.date <= date).sort((x, y) => (x.date < y.date ? -1 : 1));
  const last = hist[hist.length - 1];
  if (!last) return assetCostAt(state, a, date);
  const sold = sumBy(
    live(state).filter((t) => t.type === 'sell_asset' && t.linkedAssetId === a.id && !t.soldOut && t.date.slice(0, 10) > last.date && t.date.slice(0, 10) <= date),
    (t) => t.valueSold || 0
  );
  return Math.max(0, last.value - sold);
}

/** Dư nợ gốc của một khoản vay vào cuối ngày `date` (tua ngược từ dư nợ hiện tại). */
export function debtBalanceAt(state: UserFinancialState, d: Debt, asOf: string): number {
  if (d.status === 'voided') return 0;
  // Khoản vay đang trả dở có sẵn từ trước khi theo dõi: trước ngày theo dõi coi là dư nợ lúc bắt đầu theo dõi.
  // Khoản vay mới giải ngân thì chưa tồn tại trước ngày giải ngân.
  if (!d.trackingStartDate && asOf < d.startDate) return 0;
  const date = d.trackingStartDate && asOf < d.trackingStartDate ? d.trackingStartDate : asOf;
  let bal = d.status === 'active' ? Math.max(0, d.remainingPrincipal) : 0;
  const pays = live(state).filter((t) => t.type === 'debt_payment' && t.linkedDebtId === d.id);
  bal += sumBy(pays.filter((t) => t.date.slice(0, 10) > date), (t) => t.principalPortion || 0);
  for (const adj of d.adjustments || []) if (adj.date > date) bal -= adj.after - adj.before;
  (d.schedule || []).forEach((it, i) => {
    if (!it.isPaid || !it.paidDate || it.paidDate <= date) return;
    if (pays.some((t) => t.periodIndex === i)) return;
    bal += it.principalPayable;
  });
  return Math.max(0, Math.round(bal));
}

/** Trạng thái tài chính được dựng lại vào cuối ngày `date` (đủ để tính bảng cân đối). */
export function stateAt(state: UserFinancialState, date: string, today: string = todayLocalStr()): UserFinancialState {
  if (date >= today) return state;
  const lv = live(state);
  const later = (t: CashTransaction) => t.date.slice(0, 10) > date;
  const assets = state.assets
    .filter((a) => assetHeldAt(state, a, date))
    .map((a) => ({ ...a, status: 'active' as const, currentValue: assetValueAt(state, a, date, today), initialCost: assetCostAt(state, a, date) }));
  const debts = state.debts
    .map((d) => {
      const bal = debtBalanceAt(state, d, date);
      const hadLaterClose = lv.some((t) => t.type === 'debt_payment' && t.linkedDebtId === d.id && later(t) && (t.settlement || t.prepay));
      const schedule = (d.schedule || []).map((it) => {
        const paidThen = it.isPaid && (!it.paidDate || it.paidDate <= date);
        const { status: _s, ...rest } = it;
        return { ...(hadLaterClose || it.status !== 'cancelled' ? rest : it), isPaid: paidThen } as typeof it;
      });
      return { ...d, status: 'active' as const, remainingPrincipal: bal, schedule };
    })
    .filter((d) => d.remainingPrincipal > 0);
  return {
    ...state,
    wallet: {
      availableCash: cashAt(state, date),
      totalDeposited: state.wallet.totalDeposited - sumBy(lv.filter((t) => t.type === 'deposit' && later(t)), (t) => t.amount),
      totalWithdrawn: state.wallet.totalWithdrawn - sumBy(lv.filter((t) => t.type === 'withdraw' && later(t)), (t) => t.amount),
    },
    assets,
    debts,
    transactions: state.transactions.filter((t) => !later(t)),
  };
}

export function equityAt(state: UserFinancialState, date: string, today: string = todayLocalStr()): number {
  const s = stateAt(state, date, today);
  return s.wallet.availableCash + s.assets.reduce((x, a) => x + a.currentValue, 0) - s.debts.reduce((x, d) => x + d.remainingPrincipal, 0);
}

/** Lãi/lỗ chưa chốt của các tài sản đang nắm giữ vào cuối ngày `date` (thị giá − giá vốn còn lại). */
export function unrealizedAt(state: UserFinancialState, date: string, today: string = todayLocalStr()): number {
  return state.assets.filter((a) => assetHeldAt(state, a, date)).reduce((s, a) => s + assetValueAt(state, a, date, today) - assetCostAt(state, a, date), 0);
}

// ============================================================================ LƯU CHUYỂN TIỀN TỆ
export interface CashFlowReport {
  period: ReportPeriod;
  opening: number;
  closing: number;
  operating: { dividend: number; interest: number; rental: number; interestPaid: number; total: number };
  investing: { buy: number; sell: number; total: number };
  financing: { deposits: number; withdrawals: number; disbursements: number; principalPaid: number; fees: number; total: number };
  net: number;
  /** Các sự kiện không đi qua ví trong kỳ (ghi riêng, không nằm trong lưu chuyển tiền). */
  nonCash: {
    assets: { count: number; amount: number };
    loans: { count: number; amount: number };
    externalPayments: { count: number; amount: number };
    /** Kỳ nợ được ghi nhận đã trả nhưng không có giao dịch (trả ngoài app, lịch sử tự dựng): chỉ gốc giảm. */
    unrecordedPayments: { count: number; principal: number };
  };
}

export function cashFlowReport(state: UserFinancialState, period: ReportPeriod, today: string = todayLocalStr()): CashFlowReport {
  const txs = live(state).filter((t) => inPeriod(t.date, period) && !t.noCash);
  const of = (type: CashTransaction['type']) => txs.filter((t) => t.type === type);
  const pays = of('debt_payment');
  const interestPart = (t: CashTransaction) => t.interestPortion || 0;
  const feePart = (t: CashTransaction) => t.feePortion || 0;
  const principalPart = (t: CashTransaction) => t.amount - interestPart(t) - feePart(t);

  const operating = {
    dividend: sumBy(of('dividend'), (t) => t.amount),
    interest: sumBy(of('interest_income'), (t) => t.amount),
    rental: sumBy(of('rental_income'), (t) => t.amount),
    interestPaid: -sumBy(pays, interestPart),
    total: 0,
  };
  operating.total = operating.dividend + operating.interest + operating.rental + operating.interestPaid;
  const investing = { buy: -sumBy(of('buy_asset'), (t) => t.amount), sell: sumBy(of('sell_asset'), (t) => t.amount), total: 0 };
  investing.total = investing.buy + investing.sell;
  const financing = {
    deposits: sumBy(of('deposit'), (t) => t.amount),
    withdrawals: -sumBy(of('withdraw'), (t) => t.amount),
    disbursements: sumBy(of('loan_disbursement'), (t) => t.amount),
    principalPaid: -sumBy(pays, principalPart),
    fees: -sumBy(pays, feePart),
    total: 0,
  };
  financing.total = financing.deposits + financing.withdrawals + financing.disbursements + financing.principalPaid + financing.fees;

  // phi tiền mặt
  const lv = live(state);
  const assets = state.assets.filter((a) => a.status !== 'voided' && inPeriod(a.purchaseDate, period));
  const assetPart = assets.map((a) => Math.max(0, assetCostAt(state, a, a.purchaseDate) - sumBy(lv.filter((t) => t.type === 'buy_asset' && t.linkedAssetId === a.id), (t) => t.amount))).filter((x) => x > 0);
  const loans = state.debts.filter((d) => d.status !== 'voided' && !d.trackingStartDate && inPeriod(d.startDate, period) && !lv.some((t) => t.type === 'loan_disbursement' && t.linkedDebtId === d.id));
  const ext = lv.filter((t) => t.type === 'debt_payment' && t.noCash && inPeriod(t.date, period));
  const unrec: number[] = [];
  for (const d of state.debts) {
    if (d.status === 'voided') continue;
    (d.schedule || []).forEach((it, i) => {
      if (!it.isPaid || !it.paidDate || !inPeriod(it.paidDate, period)) return;
      if (lv.some((t) => t.type === 'debt_payment' && t.linkedDebtId === d.id && t.periodIndex === i)) return;
      unrec.push(it.principalPayable);
    });
  }

  const opening = cashAt(state, addDaysStr(period.from, -1));
  const net = operating.total + investing.total + financing.total;
  void today;
  return {
    period,
    opening,
    closing: opening + net,
    operating,
    investing,
    financing,
    net,
    nonCash: {
      assets: { count: assetPart.length, amount: assetPart.reduce((s, x) => s + x, 0) },
      loans: { count: loans.length, amount: loans.reduce((s, d) => s + d.principalAmount, 0) },
      externalPayments: { count: ext.length, amount: sumBy(ext, (t) => t.amount) },
      unrecordedPayments: { count: unrec.length, principal: unrec.reduce((s, x) => s + x, 0) },
    },
  };
}

// ============================================================================ HOẠT ĐỘNG KINH DOANH
export interface ProfitReport {
  period: ReportPeriod;
  income: { dividend: number; interest: number; rental: number; total: number };
  realizedBeforeFees: number;
  saleFees: number;
  /** Lãi chốt (đã trừ phí) của các lần bán ghi trước khi có giá vốn từng lần: chỉ là ước tính. */
  legacyRealized: { amount: number; count: number };
  interestExpense: number;
  otherFees: number;
  realizedProfit: number;
  unrealizedChange: number;
  economicProfit: number;
  ratios: { equityReturn: number | null; incomeYield: number | null; interestCover: number | null };
  startEquity: number;
  endEquity: number;
}

export function profitReport(state: UserFinancialState, period: ReportPeriod, today: string = todayLocalStr()): ProfitReport {
  const lv = live(state);
  const txs = lv.filter((t) => inPeriod(t.date, period));
  const of = (type: CashTransaction['type']) => txs.filter((t) => t.type === type);
  const income = { dividend: sumBy(of('dividend'), (t) => t.amount), interest: sumBy(of('interest_income'), (t) => t.amount), rental: sumBy(of('rental_income'), (t) => t.amount), total: 0 };
  income.total = income.dividend + income.interest + income.rental;

  const sells = of('sell_asset');
  const detailed = sells.filter((t) => typeof t.costBasisSold === 'number');
  const legacy = sells.filter((t) => typeof t.costBasisSold !== 'number');
  const realizedBeforeFees = sumBy(detailed, (t) => (t.recognizedValue ?? t.amount + (t.fees || 0)) - (t.costBasisSold || 0));
  const saleFees = -sumBy(detailed, (t) => (t.recognizedValue ?? t.amount + (t.fees || 0)) - t.amount);

  // ước tính các lần bán cũ: phần lãi chốt còn lại của tài sản, tính vào kỳ có lần bán cũ gần nhất
  const legacyAssets = Array.from(new Set(legacy.map((t) => t.linkedAssetId).filter(Boolean) as string[]));
  let legacyAmount = 0;
  for (const id of legacyAssets) {
    const a = state.assets.find((x) => x.id === id);
    if (!a || a.status === 'voided') continue;
    const allLegacy = lv.filter((t) => t.type === 'sell_asset' && t.linkedAssetId === id && typeof t.costBasisSold !== 'number');
    const latest = allLegacy.reduce((m, t) => (t.date.slice(0, 10) > m ? t.date.slice(0, 10) : m), '');
    if (!inPeriod(latest, period)) continue;
    const detailedSum = sumBy(lv.filter((t) => t.type === 'sell_asset' && t.linkedAssetId === id && typeof t.costBasisSold === 'number'), (t) => t.realizedPnL || 0);
    legacyAmount += (a.realizedPnL || 0) - detailedSum;
  }
  const pays = of('debt_payment');
  const interestExpense = -sumBy(pays, (t) => t.interestPortion || 0);
  const otherFees = -sumBy(pays, (t) => t.feePortion || 0);

  const realizedProfit = income.total + realizedBeforeFees + saleFees + legacyAmount + interestExpense + otherFees;
  const dayBefore = addDaysStr(period.from, -1);
  const unrealizedChange = unrealizedAt(state, period.to, today) - unrealizedAt(state, dayBefore, today);
  const startEquity = equityAt(state, dayBefore, today);
  const endEquity = equityAt(state, period.to, today);
  const avgEquity = (startEquity + endEquity) / 2;
  const sEnd = stateAt(state, period.to, today);
  const sStart = stateAt(state, dayBefore, today);
  const avgAssets = (sEnd.assets.reduce((s, a) => s + a.currentValue, 0) + sStart.assets.reduce((s, a) => s + a.currentValue, 0)) / 2;
  return {
    period,
    income,
    realizedBeforeFees,
    saleFees,
    legacyRealized: { amount: legacyAmount, count: legacy.length },
    interestExpense,
    otherFees,
    realizedProfit,
    unrealizedChange,
    economicProfit: realizedProfit + unrealizedChange,
    ratios: {
      equityReturn: avgEquity > 0 ? (realizedProfit + unrealizedChange) / avgEquity : null,
      incomeYield: avgAssets > 0 ? income.total / avgAssets : null,
      interestCover: interestExpense < 0 ? income.total / -interestExpense : null,
    },
    startEquity,
    endEquity,
  };
}

// ============================================================================ BẢNG CÂN ĐỐI THEO KỲ
export interface BalanceGroups {
  cash: number;
  stock: number;
  fund: number;
  gold: number;
  savings: number;
  real_estate: number;
  other: number;
  assets: number;
  debtShort: number;
  debtLong: number;
  debts: number;
  equity: number;
}

export const GROUP_LABELS: Array<[keyof BalanceGroups, string]> = [
  ['cash', 'Tiền mặt (ví đầu tư)'],
  ['savings', 'Tiền gửi / Trái phiếu'],
  ['stock', 'Cổ phiếu niêm yết'],
  ['fund', 'Chứng chỉ quỹ'],
  ['gold', 'Vàng & kim loại quý'],
  ['real_estate', 'Bất động sản'],
  ['other', 'Tài sản khác'],
  ['debtShort', 'Nợ ngắn hạn'],
  ['debtLong', 'Nợ dài hạn'],
];

export function groupsOf(bs: BalanceSheet): BalanceGroups {
  const lines = [...bs.currentAssets.lines, ...bs.nonCurrentAssets.lines];
  const v = (...keys: string[]) => lines.filter((l) => keys.includes(l.key)).reduce((s, l) => s + l.value, 0);
  return {
    cash: v('cash'),
    stock: v('stock'),
    fund: v('fund'),
    gold: v('gold'),
    savings: v('savings_short', 'savings_long'),
    real_estate: v('real_estate'),
    other: v('other'),
    assets: bs.totalAssets,
    debtShort: bs.currentLiabilities.total,
    debtLong: bs.nonCurrentLiabilities.total,
    debts: bs.totalLiabilities,
    equity: bs.equity.total,
  };
}

export interface PeriodBalance {
  period: ReportPeriod;
  start: BalanceSheet;
  end: BalanceSheet;
  startGroups: BalanceGroups;
  endGroups: BalanceGroups;
}

export function periodBalance(state: UserFinancialState, period: ReportPeriod, today: string = todayLocalStr()): PeriodBalance {
  const dayBefore = addDaysStr(period.from, -1);
  const start = calculateBalanceSheet(stateAt(state, dayBefore, today), dayBefore);
  const end = calculateBalanceSheet(stateAt(state, period.to, today), period.to);
  return { period, start, end, startGroups: groupsOf(start), endGroups: groupsOf(end) };
}

// ============================================================================ ĐỐI SOÁT (C8)
export interface ReconcileCheck {
  id: 'cash' | 'equity' | 'sources';
  title: string;
  ok: boolean;
  left: { label: string; value: number };
  right: { label: string; value: number };
  diff: number;
  /** Nguyên nhân khả dĩ khi chưa khớp. */
  causes: string[];
  /** Với phép 2: các thành phần của vế phải. */
  parts?: Array<{ label: string; value: number }>;
}

export function reconcileReports(state: UserFinancialState, period: ReportPeriod, today: string = todayLocalStr()): ReconcileCheck[] {
  const cf = cashFlowReport(state, period, today);
  const pr = profitReport(state, period, today);
  const pb = periodBalance(state, period, today);
  const lv = live(state);
  const causesCommon: string[] = [];
  const unspecified = state.debts.filter((d) => d.status === 'active' && (!d.fundUse || d.fundUse.kind === 'unspecified')).length;
  if (unspecified > 0) causesCommon.push(`${unspecified} khoản vay chưa xác định nơi dùng vốn`);

  // 1. Tiền cuối kỳ: lưu chuyển tiền = bảng cân đối
  const bsCash = pb.endGroups.cash;
  const c1: ReconcileCheck = {
    id: 'cash',
    title: 'Tiền cuối kỳ trên lưu chuyển tiền = tiền ví trên bảng cân đối',
    ok: Math.abs(cf.closing - bsCash) < 1,
    left: { label: 'Tiền cuối kỳ (lưu chuyển tiền)', value: cf.closing },
    right: { label: 'Tiền ví (bảng cân đối)', value: bsCash },
    diff: cf.closing - bsCash,
    causes: ['Có giao dịch ví chưa vào báo cáo (loại giao dịch lạ hoặc số dư ví bị sửa tay)'],
  };

  // 2. Thay đổi vốn chủ = lợi nhuận kinh tế + vốn nạp ròng (+ các khoản phi tiền mặt)
  const dayBefore = addDaysStr(period.from, -1);
  void dayBefore;
  const netContrib = cf.financing.deposits + cf.financing.withdrawals;
  const adjustments = state.debts.filter((d) => d.status !== 'voided').reduce((s, d) => s + (d.adjustments || []).filter((a) => inPeriod(a.date, period)).reduce((x, a) => x + (a.before - a.after), 0), 0);
  const parts = [
    { label: 'Tổng lợi nhuận kinh tế', value: pr.economicProfit },
    { label: 'Vốn nạp ròng (đã nạp − đã rút)', value: netContrib },
    { label: 'Tài sản thêm không trừ ví (phi tiền mặt)', value: cf.nonCash.assets.amount },
    { label: 'Nợ trả bằng tiền ngoài ví', value: cf.nonCash.externalPayments.amount },
    { label: 'Kỳ nợ đã trả không qua ví (không có giao dịch)', value: cf.nonCash.unrecordedPayments.principal },
    { label: 'Khoản vay chỉ ghi nợ, không giải ngân vào ví', value: -cf.nonCash.loans.amount },
    { label: 'Điều chỉnh dư nợ theo sao kê', value: adjustments },
  ];
  const expected = parts.reduce((s, p) => s + p.value, 0);
  const delta = pb.endGroups.equity - pb.startGroups.equity;
  const causes2 = [...causesCommon];
  if (pr.legacyRealized.count > 0) causes2.push(`${pr.legacyRealized.count} lần bán ghi trước khi có giá vốn từng lần (lãi chốt chỉ là ước tính)`);
  causes2.push('Tài sản chưa từng định giá lại được coi bằng giá vốn ở đầu kỳ');
  const c2: ReconcileCheck = {
    id: 'equity',
    title: 'Thay đổi vốn chủ trong kỳ = tổng lợi nhuận kinh tế + vốn nạp ròng',
    ok: Math.abs(delta - expected) < 1,
    left: { label: 'Thay đổi vốn chủ (cuối kỳ − đầu kỳ)', value: delta },
    right: { label: 'Lợi nhuận kinh tế + vốn nạp ròng + phi tiền mặt', value: expected },
    diff: delta - expected,
    causes: causes2,
    parts,
  };

  // 3. Tổng nguồn vốn = tổng tài sản
  const e = pb.end;
  const c3: ReconcileCheck = {
    id: 'sources',
    title: 'Tổng nguồn vốn = tổng tài sản',
    ok: Math.abs(e.totalLiabilitiesAndEquity - e.totalAssets) < 1 && Math.abs(e.equity.contributed + e.equity.retained - e.equity.total) < 1,
    left: { label: 'Tổng nguồn vốn (nợ + vốn chủ)', value: e.totalLiabilitiesAndEquity },
    right: { label: 'Tổng tài sản', value: e.totalAssets },
    diff: e.totalLiabilitiesAndEquity - e.totalAssets,
    causes: [...causesCommon],
  };
  void lv;
  return [c1, c2, c3];
}

// ============================================================================ ẢNH CHỤP CHI TIẾT (C6)
/** Ảnh chụp chi tiết gần nhất không sau ngày `date` (trong vòng 7 ngày); null nếu chưa có. */
export function snapshotGroupsBefore(state: UserFinancialState, date: string): { date: string; groups: BalanceGroups } | null {
  const lo = addDaysStr(date, -7);
  const snap = [...(state.snapshots || [])].filter((s) => s.groups && s.date <= date && s.date >= lo).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!snap || !snap.groups) return null;
  const g = snap.groups;
  return {
    date: snap.date,
    groups: {
      cash: snap.cash,
      stock: g.stock,
      fund: g.fund,
      gold: g.gold,
      savings: g.savings,
      real_estate: g.real_estate,
      other: g.other,
      assets: snap.assets,
      debtShort: snap.debtShort || 0,
      debtLong: snap.debtLong || 0,
      debts: snap.debts,
      equity: snap.netWorth,
    },
  };
}
