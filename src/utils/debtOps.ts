import { AmortizationScheduleItem, CashTransaction, Debt, DebtAdjustment, RateChange, UserFinancialState } from '../types/finance';
import { isOpenItem, todayLocalStr } from './calculations';
import { accruedInterest, currentRate, ensureTimeline, PrepayMode, previewPrepay, previewSettlement, rebuildSchedule } from './debtCore';
import { insertTx } from './ledger';
import { checkTxDate, IdGen, OpResult, SellInput, applySell } from './ops';
import { MAX_RATE } from './validation';

/** Thao tác trên khoản vay (R2, C3, C7): hàm thuần, trả về trạng thái mới hoặc lỗi. */
const defaultId: IdGen = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fail = (error: string): OpResult => ({ ok: false, error });
const money = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} ₫`;
const replaceDebt = (state: UserFinancialState, d: Debt): UserFinancialState => ({ ...state, debts: state.debts.map((x) => (x.id === d.id ? d : x)) });
const lastPaidIndex = (d: Debt) => (d.schedule || []).reduce((m, it, i) => (it.isPaid ? i : m), -1);

// ---------------------------------------------------------------- Dòng thời gian lãi suất
export interface RateChangeInput {
  debtId: string;
  effectiveDate: string;
  /** Lãi suất mới (%/năm): một mức duy nhất từ ngày hiệu lực. */
  annualRate?: number;
  /** (di sản) lãi cơ sở + biên độ; giao diện mới không dùng nữa. */
  baseRate?: number;
  margin?: number;
  note?: string;
}

/** Dựng khoản vay sau khi đổi lãi (chưa ghi vào state). Dùng chung cho xem trước và lưu. */
function rebuildWithRateChange(debt: Debt, p: RateChangeInput, uid: IdGen, today: string): { ok: true; debt: Debt } | { ok: false; error: string } {
  if (debt.status !== 'active') return { ok: false, error: 'Chỉ đổi lãi suất của khoản vay đang vay.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.effectiveDate || '')) return { ok: false, error: 'Chọn ngày hiệu lực.' };
  const floating = p.baseRate !== undefined && p.margin !== undefined;
  const rate = floating ? p.baseRate! + p.margin! : p.annualRate;
  if (rate === undefined || !Number.isFinite(rate)) return { ok: false, error: 'Nhập lãi suất mới.' };
  if (rate < 0 || rate > MAX_RATE) return { ok: false, error: `Lãi suất phải trong khoảng 0% – ${MAX_RATE}%/năm.` };
  const tl = ensureTimeline(debt);
  if (p.effectiveDate < tl[0].effectiveDate) return { ok: false, error: `Ngày hiệu lực không được sớm hơn mốc đầu tiên (${tl[0].effectiveDate}).` };

  const entry: RateChange = {
    id: uid('rate'),
    effectiveDate: p.effectiveDate,
    annualRate: rate,
    baseRate: floating ? p.baseRate : undefined,
    margin: floating ? p.margin : undefined,
    note: p.note || undefined,
    source: 'manual',
  };
  // Cùng ngày hiệu lực: thay mốc cũ (trừ mốc đầu: đổi lãi của mốc đầu cũng được vì chưa có kỳ nào dùng riêng)
  const next = [...tl.filter((r) => r.effectiveDate !== p.effectiveDate), entry];
  if (p.effectiveDate === tl[0].effectiveDate) entry.source = tl[0].source;
  return { ok: true, debt: rebuildSchedule({ ...debt, rateTimeline: next }, {}, today) };
}

export function applyAddRateChange(state: UserFinancialState, p: RateChangeInput, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const debt = state.debts.find((d) => d.id === p.debtId);
  if (!debt) return fail('Không tìm thấy khoản vay.');
  const r = rebuildWithRateChange(debt, p, uid, today);
  if (!r.ok) return fail(r.error);
  return { ok: true, state: replaceDebt(state, r.debt) };
}

export type RateChangePreview =
  | {
      ok: true;
      currentRate: number;
      newRate: number;
      effectiveDate: string;
      /** Kỳ chưa trả đầu tiên (tiền kỳ tới). */
      next: { period: number; dueDate: string; before: number; after: number } | null;
      /** Kỳ đầu tiên có số tiền thay đổi do đổi lãi (null = không kỳ nào đổi). */
      firstAffected: { period: number; dueDate: string; before: number; after: number } | null;
      affectedPeriods: number;
      /** Tổng lãi còn phải trả (các kỳ chưa trả) trước và sau khi đổi. */
      remainingInterest: { before: number; after: number; delta: number };
      /** Ngày hiệu lực ở quá khứ: các kỳ đã trả giữ nguyên, chỉ tính lại các kỳ chưa trả. */
      inPast: boolean;
      debt: Debt;
    }
  | { ok: false; error: string };

/** Xem trước đổi lãi suất: tiền kỳ tới, kỳ bị ảnh hưởng đầu tiên, thay đổi tổng lãi còn phải trả. Không ghi gì. */
export function previewRateChange(debt: Debt, p: Omit<RateChangeInput, 'debtId'>, today = todayLocalStr()): RateChangePreview {
  const r = rebuildWithRateChange(debt, { ...p, debtId: debt.id }, (x) => `${x}-preview`, today);
  if (!r.ok) return r;
  const open = (d: Debt) => (d.schedule || []).map((it, i) => ({ it, i })).filter((x) => isOpenItem(x.it));
  const before = open(debt);
  const after = open(r.debt);
  const sumInt = (l: typeof before) => l.reduce((s, x) => s + x.it.interestPayable, 0);
  let firstAffected: { period: number; dueDate: string; before: number; after: number } | null = null;
  let affected = 0;
  after.forEach((x, k) => {
    const b = before[k]?.it;
    if (!b) return;
    if (b.totalMonthlyPayment !== x.it.totalMonthlyPayment || b.interestPayable !== x.it.interestPayable) {
      affected++;
      if (!firstAffected) firstAffected = { period: x.it.period, dueDate: x.it.dueDate, before: b.totalMonthlyPayment, after: x.it.totalMonthlyPayment };
    }
  });
  const nb = before[0]?.it;
  const na = after[0]?.it;
  const bi = sumInt(before);
  const ai = sumInt(after);
  const lastPaid = (debt.schedule || []).reduce((m, it) => (it.isPaid && it.paidDate && it.paidDate > m ? it.paidDate : m), '');
  return {
    ok: true,
    currentRate: rateAtToday(debt, today),
    newRate: r.debt.rateTimeline!.find((x) => x.effectiveDate === p.effectiveDate)?.annualRate ?? NaN,
    effectiveDate: p.effectiveDate,
    next: nb && na ? { period: na.period, dueDate: na.dueDate, before: nb.totalMonthlyPayment, after: na.totalMonthlyPayment } : null,
    firstAffected,
    affectedPeriods: affected,
    remainingInterest: { before: bi, after: ai, delta: ai - bi },
    inPast: p.effectiveDate < today && (lastPaid !== '' ? p.effectiveDate <= lastPaid : p.effectiveDate < today),
    debt: r.debt,
  };
}

const rateAtToday = (debt: Debt, today: string) => currentRate(debt, today);

export function canRemoveRateChange(debt: Debt, changeId: string): { ok: boolean; reason?: string } {
  const tl = ensureTimeline(debt);
  const r = tl.find((x) => x.id === changeId);
  if (!r) return { ok: false, reason: 'Không tìm thấy mốc lãi suất.' };
  if (r.source === 'initial' || r === tl[0]) return { ok: false, reason: 'Mốc đầu tiên không xóa được.' };
  const li = lastPaidIndex(debt);
  if (li >= 0 && r.effectiveDate < debt.schedule![li].dueDate) return { ok: false, reason: 'Mốc này đã được dùng để tính các kỳ đã trả nên không thể bỏ.' };
  return { ok: true };
}

export function applyRemoveRateChange(state: UserFinancialState, debtId: string, changeId: string, today = todayLocalStr()): OpResult {
  const debt = state.debts.find((d) => d.id === debtId);
  if (!debt) return fail('Không tìm thấy khoản vay.');
  const chk = canRemoveRateChange(debt, changeId);
  if (!chk.ok) return fail(chk.reason || 'Không bỏ được mốc lãi suất.');
  const next = ensureTimeline(debt).filter((r) => r.id !== changeId);
  return { ok: true, state: replaceDebt(state, rebuildSchedule({ ...debt, rateTimeline: next }, {}, today)) };
}

// ---------------------------------------------------------------- Tất toán sớm
export interface SettleInput {
  debtId: string;
  date: string;
  /** Phí trả trước hạn (nhập tay theo thông báo của ngân hàng). */
  fee: number;
  /** Số tiền thực trả. Lãi thực tế = thực trả − dư nợ gốc − phí. */
  actualPaid: number;
  deductFromWallet: boolean;
}

export function applySettle(state: UserFinancialState, p: SettleInput, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const debt = state.debts.find((d) => d.id === p.debtId);
  if (!debt) return fail('Không tìm thấy khoản vay.');
  const dateErr = checkTxDate(p.date, debt.startDate, today, 'ngày bắt đầu khoản vay');
  if (dateErr) return fail(dateErr);
  const pv = previewSettlement(debt, p.date, today);
  if (!pv.ok) return fail(pv.error);
  const fee = Math.max(0, Math.round(p.fee || 0));
  const actual = Math.round(p.actualPaid);
  if (!(actual > 0)) return fail('Nhập số tiền thực trả.');
  const interest = actual - pv.balance - fee;
  if (interest < 0) return fail(`Số tiền thực trả (${money(actual)}) nhỏ hơn dư nợ gốc cộng phí (${money(pv.balance + fee)}).`);
  if (p.deductFromWallet && actual > state.wallet.availableCash)
    return fail(`Ví chỉ còn ${money(state.wallet.availableCash)}, không đủ để trả ${money(actual)}.`);

  const cancelled: number[] = [];
  const schedule: AmortizationScheduleItem[] = (debt.schedule || []).map((it, i) => {
    if (!isOpenItem(it)) return it;
    cancelled.push(i);
    return { ...it, status: 'cancelled' };
  });
  const tx: CashTransaction = {
    id: uid('tx'),
    date: p.date,
    type: 'debt_payment',
    amount: actual,
    title: `Tất toán sớm: ${debt.name}`,
    linkedDebtId: debt.id,
    principalPortion: pv.balance,
    interestPortion: interest,
    feePortion: fee || undefined,
    noCash: p.deductFromWallet ? undefined : true,
    settlement: { balanceBefore: pv.balance, cancelled },
    note: `Gốc: ${money(pv.balance)} · Lãi: ${money(interest)}${fee ? ` · Phí trả trước hạn: ${money(fee)}` : ''}`,
  };
  const closed: Debt = { ...debt, status: 'paid_off', remainingPrincipal: 0, closedDate: p.date, closeReason: 'early', schedule };
  return {
    ok: true,
    state: {
      ...replaceDebt(state, closed),
      wallet: p.deductFromWallet ? { ...state.wallet, availableCash: state.wallet.availableCash - actual } : state.wallet,
      transactions: insertTx(state.transactions, tx),
    },
  };
}

// ---------------------------------------------------------------- Trả trước một phần gốc (C7)
export interface PrepayInput {
  debtId: string;
  date: string;
  principal: number;
  fee: number;
  /** Tổng thực trả (gốc + lãi dồn + phí). Bỏ trống = tự tính. Lãi thực tế = thực trả − gốc − phí. */
  actualPaid?: number;
  mode: PrepayMode;
  deductFromWallet: boolean;
}

export function applyPrepay(state: UserFinancialState, p: PrepayInput, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const debt = state.debts.find((d) => d.id === p.debtId);
  if (!debt) return fail('Không tìm thấy khoản vay.');
  const dateErr = checkTxDate(p.date, debt.startDate, today, 'ngày bắt đầu khoản vay');
  if (dateErr) return fail(dateErr);
  const principal = Math.round(p.principal);
  const pv = previewPrepay(debt, p.date, principal, p.mode, today);
  if (!pv.ok) return fail(pv.error);
  const fee = Math.max(0, Math.round(p.fee || 0));
  const actual = Math.round(p.actualPaid ?? principal + pv.interest + fee);
  const interest = actual - principal - fee;
  if (interest < 0) return fail(`Số tiền thực trả (${money(actual)}) nhỏ hơn gốc trả trước cộng phí (${money(principal + fee)}).`);
  if (p.deductFromWallet && actual > state.wallet.availableCash)
    return fail(`Ví chỉ còn ${money(state.wallet.availableCash)}, không đủ để trả ${money(actual)}.`);

  const cancelled: number[] = [];
  pv.debt.schedule!.forEach((it, i) => {
    if (it.status === 'cancelled' && !(debt.schedule![i].status === 'cancelled')) cancelled.push(i);
  });
  const tx: CashTransaction = {
    id: uid('tx'),
    date: p.date,
    type: 'debt_payment',
    amount: actual,
    title: `Trả trước gốc: ${debt.name}`,
    linkedDebtId: debt.id,
    principalPortion: principal,
    interestPortion: interest,
    feePortion: fee || undefined,
    noCash: p.deductFromWallet ? undefined : true,
    prepay: { balanceBefore: debt.remainingPrincipal, cancelled, itemsBefore: pv.before },
    note: `Gốc trả trước: ${money(principal)} · Lãi dồn: ${money(interest)}${fee ? ` · Phí: ${money(fee)}` : ''}`,
  };
  return {
    ok: true,
    state: {
      ...replaceDebt(state, pv.debt),
      wallet: p.deductFromWallet ? { ...state.wallet, availableCash: state.wallet.availableCash - actual } : state.wallet,
      transactions: insertTx(state.transactions, tx),
    },
  };
}

// ---------------------------------------------------------------- Đối chiếu dư nợ với sao kê (C3)
export interface ReconcileInput {
  debtId: string;
  /** Dư nợ gốc thực tế theo sao kê ngân hàng. */
  actual: number;
  date: string;
  note?: string;
}

export function applyReconcile(state: UserFinancialState, p: ReconcileInput, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const debt = state.debts.find((d) => d.id === p.debtId);
  if (!debt) return fail('Không tìm thấy khoản vay.');
  if (debt.status !== 'active') return fail('Chỉ đối chiếu khoản vay đang vay.');
  if (!(p.actual > 0)) return fail('Nhập dư nợ gốc theo sao kê lớn hơn 0. Nếu đã trả hết hãy dùng Tất toán sớm.');
  const dateErr = checkTxDate(p.date, undefined, today);
  if (dateErr) return fail(dateErr);
  const actual = Math.round(p.actual);
  if (Math.abs(actual - debt.remainingPrincipal) < 1) return fail('Dư nợ theo sao kê đã khớp với dư nợ trong app.');
  const li = lastPaidIndex(debt);
  const adj: DebtAdjustment = {
    id: uid('adj'),
    date: p.date,
    before: debt.remainingPrincipal,
    after: actual,
    note: p.note || undefined,
    lastPaidIndex: li,
    itemBalanceBefore: li >= 0 ? debt.schedule![li].remainingBalance : undefined,
  };
  const schedule = (debt.schedule || []).map((it, i) => (i === li ? { ...it, remainingBalance: actual } : it));
  const rebuilt = rebuildSchedule({ ...debt, remainingPrincipal: actual, schedule, adjustments: [...(debt.adjustments || []), adj] }, {}, today);
  return { ok: true, state: replaceDebt(state, rebuilt) };
}

export function canUndoReconcile(debt: Debt): { ok: boolean; reason?: string } {
  const adj = (debt.adjustments || [])[(debt.adjustments || []).length - 1];
  if (!adj) return { ok: false, reason: 'Không có điều chỉnh nào để hoàn tác.' };
  if (lastPaidIndex(debt) !== adj.lastPaidIndex || Math.abs(debt.remainingPrincipal - adj.after) >= 1)
    return { ok: false, reason: 'Khoản vay đã có giao dịch sau điều chỉnh này. Hãy hủy các giao dịch đó trước.' };
  return { ok: true };
}

export function applyUndoReconcile(state: UserFinancialState, debtId: string, today = todayLocalStr()): OpResult {
  const debt = state.debts.find((d) => d.id === debtId);
  if (!debt) return fail('Không tìm thấy khoản vay.');
  const chk = canUndoReconcile(debt);
  if (!chk.ok) return fail(chk.reason || 'Không hoàn tác được.');
  const adjs = [...(debt.adjustments || [])];
  const adj = adjs.pop()!;
  const schedule = (debt.schedule || []).map((it, i) => (i === adj.lastPaidIndex && adj.itemBalanceBefore !== undefined ? { ...it, remainingBalance: adj.itemBalanceBefore } : it));
  return { ok: true, state: replaceDebt(state, rebuildSchedule({ ...debt, remainingPrincipal: adj.before, schedule, adjustments: adjs }, {}, today)) };
}

export { accruedInterest };

// ---------------------------------------------------------------- Bán tài sản đang thế chấp + tất toán khoản vay liên kết
export interface SellSettleOptions {
  /** true = dùng tiền bán để tất toán khoản vay đang thế chấp bằng tài sản này, trong cùng một thao tác. */
  settle: boolean;
  /** Phí trả trước hạn của ngân hàng (nhập tay theo thông báo). */
  fee?: number;
}

/**
 * Bán tài sản và (tùy chọn) tất toán khoản vay liên kết ngay bằng tiền vừa bán. Nguyên tử: nếu tiền bán không đủ trả nợ,
 * hoặc không tất toán được vào ngày bán, thì không bán gì và không tất toán gì.
 */
export function applySellAndSettle(state: UserFinancialState, p: SellInput, opts: SellSettleOptions, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const sold = applySell(state, p, uid, today);
  if (!sold.ok || !opts.settle) return sold;
  const before = state.assets.find((a) => a.id === p.assetId);
  const debt = state.debts.find((d) => d.status === 'active' && (d.id === before?.linkedDebtId || d.collateralAssetId === p.assetId));
  if (!debt) return sold;
  const after = sold.state.assets.find((a) => a.id === p.assetId);
  if (!after || after.status !== 'sold') return fail('Chỉ tất toán khoản vay khi bán hết tài sản thế chấp. Hãy bán hết, hoặc bán không kèm tất toán.');
  const pv = previewSettlement(debt, p.date, today);
  if (!pv.ok) return fail(`Không tất toán được khoản vay "${debt.name}" cùng lúc: ${pv.error}`);
  const fee = Math.max(0, Math.round(opts.fee || 0));
  const need = pv.total + fee;
  if (need > sold.state.wallet.availableCash)
    return fail(`Ví sau khi nhận tiền bán là ${money(sold.state.wallet.availableCash)}, không đủ để tất toán khoản vay "${debt.name}" (cần ${money(need)}). Hãy bán không kèm tất toán hoặc nạp thêm tiền.`);
  return applySettle(sold.state, { debtId: debt.id, date: p.date, fee, actualPaid: need, deductFromWallet: true }, uid, today);
}
