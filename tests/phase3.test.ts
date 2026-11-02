/**
 * Test giai đoạn 3: R2 (mốc lãi suất, lịch tính lại, tất toán sớm), C3 (đối chiếu sao kê),
 * C4 (tiết kiệm: nhận lãi, tái tục), C7 (trả trước một phần gốc), khoản vay đang trả dở, R6 theo ngày thanh toán.
 * Run: npx tsx tests/phase3.test.ts
 */
import { calculateFinancialSummary, checkPayable, generateAmortizationSchedule, isOpenItem, normalizeDebt, savingsCurrentValue } from '../src/utils/calculations';
import { accruedInterest, buildTrackedDebt, ensureTimeline, periodInterest, previewPrepay, previewSettlement, rateAt, rebuildSchedule } from '../src/utils/debtCore';
import {
  applyAddRateChange, applyPrepay, applyReconcile, applyRemoveRateChange, applySettle, applyUndoReconcile, canRemoveRateChange, canUndoReconcile,
} from '../src/utils/debtOps';
import { txEffect } from '../src/utils/ledger';
import { applyIncome, applyPayPeriod, applyVoidTx, canVoidTx, OpResult } from '../src/utils/ops';
import { applyReceiveSavingsInterest, applyRollover } from '../src/utils/savingsOps';
import { normalizeState } from '../src/utils/storage';
import type { Asset, Debt, UserFinancialState } from '../src/types/finance';

let pass = 0, fail = 0;
function t(id: string, name: string, fn: () => true | string) {
  let r: true | string;
  try { r = fn(); } catch (e: any) { r = 'THROW ' + e.stack; }
  if (r === true) { pass++; console.log(`PASS ${id} ${name}`); } else { fail++; console.log(`FAIL ${id} ${name}\n       ${r}`); }
}
(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
let n = 0;
const uid = (p: string) => `${p}-${++n}`;
const M = 1_000_000;
const st = (o: Partial<UserFinancialState> = {}): UserFinancialState => ({
  wallet: { availableCash: 5000 * M, totalDeposited: 5000 * M, totalWithdrawn: 0 }, assets: [], debts: [], transactions: [], ...o,
});
const ok = (r: OpResult): UserFinancialState => { if (!r.ok) throw new Error('op lỗi: ' + r.error); return r.state; };
const err = (r: OpResult): string => (r.ok ? '' : r.error);
const base: any = { id: 'd1', name: 'Vay A', lender: 'NH', category: 'mortgage', securityType: 'unsecured', fundUse: { kind: 'spent' } };
const tracked = (o: Partial<Parameters<typeof buildTrackedDebt>[1]> = {}, today = '2026-11-05'): Debt =>
  buildTrackedDebt(base, { balance: 1000 * M, periods: 12, firstDueDate: '2026-12-10', trackingStart: '2026-11-05', paymentDay: 10, annualRate: 9.5, rateType: 'fixed', method: 'declining_balance', ...o }, today);
const sumOpen = (d: Debt) => d.schedule!.filter(isOpenItem).reduce((s, i) => s + i.principalPayable, 0);
const lastOpen = (d: Debt) => d.schedule!.filter(isOpenItem).slice(-1)[0];
const pay = (s: UserFinancialState, idx: number, date: string, today = date) =>
  ok(applyPayPeriod(s, { debtId: 'd1', periodIndex: idx, deductFromWallet: true, date }, uid, today));

// ================= R2: lãi theo mốc =================
t('R2a', 'Nghiệm thu: dư nợ 1 tỷ, lãi một kỳ ở 9,5% = 7.916.667; sau mốc 10% = 8.333.333', () => {
  let d = tracked({ periods: 24, graceLeft: 12 });             // ân hạn 12 kỳ → dư nợ giữ nguyên 1 tỷ để so lãi
  const a = d.schedule![0].interestPayable;
  d = ok(applyAddRateChange(st({ debts: [d] }), { debtId: 'd1', effectiveDate: '2027-03-10', annualRate: 10 }, uid, '2026-11-05')).debts[0];
  const before = d.schedule![3], after = d.schedule![5];      // kỳ 4 (10/03/2027) vẫn 9,5%; kỳ 5 (10/04) là 10%
  return a === 7_916_667 && before.interestPayable === 7_916_667 && after.interestPayable === 8_333_333 && d.schedule![5].segments === undefined ? true : JSON.stringify([a, before.interestPayable, after.interestPayable]);
});
t('R2b', 'Kỳ đã trả giữ nguyên khi đổi lãi; các kỳ chưa trả tính lại từ dư nợ thực tế', () => {
  let s = st({ debts: [tracked()] });
  s = pay(s, 0, '2026-12-10'); s = pay(s, 1, '2027-01-10');
  const paid = JSON.stringify(s.debts[0].schedule!.slice(0, 2));
  const rem = s.debts[0].remainingPrincipal;
  s = ok(applyAddRateChange(s, { debtId: 'd1', effectiveDate: '2027-02-10', annualRate: 10 }, uid, '2027-01-10'));
  const d = s.debts[0];
  const i3 = d.schedule![2], i4 = d.schedule![3];             // kỳ 3 (đến hạn 10/02) giữ 9,5%; kỳ 4 bắt đầu đúng ngày hiệu lực 10/02 → trọn kỳ 10%
  return JSON.stringify(d.schedule!.slice(0, 2)) === paid && d.remainingPrincipal === rem && i3.interestPayable === Math.round(rem * 0.095 / 12) &&
    i4.interestPayable === Math.round(i3.remainingBalance * 0.10 / 12) && sumOpen(d) === rem && lastOpen(d).remainingBalance === 0
    ? true : JSON.stringify([i3.interestPayable, i4.interestPayable, rem, sumOpen(d)]);
});
t('R2c', 'Ví dụ của bạn: còn 65tr, lãi 8% → 10% giữa kỳ: lãi kỳ lẻ tính theo ngày thực tế/365', () => {
  const d0 = tracked({ balance: 65 * M, periods: 20, annualRate: 8 });
  const d = ok(applyAddRateChange(st({ debts: [d0] }), { debtId: 'd1', effectiveDate: '2026-12-25', annualRate: 10 }, uid, '2026-11-05')).debts[0];
  const p1 = d.schedule![0], p2 = d.schedule![1];             // kỳ 1: 10/11→10/12 (không đổi), kỳ 2: 10/12→10/01 có mốc 25/12
  const bal2 = p1.remainingBalance;
  const expect2 = Math.round(bal2 * (0.08 * 15 + 0.10 * 16) / 365);
  return p1.interestPayable === Math.round(65 * M * 0.08 / 12) && p2.interestPayable === expect2 && p2.segments?.length === 2 &&
    p2.segments![0].days === 15 && p2.segments![1].days === 16 && d.schedule![2].interestPayable === Math.round(p2.remainingBalance * 0.10 / 12)
    ? true : JSON.stringify([p1.interestPayable, p2.interestPayable, expect2, p2.segments]);
});
t('R2d', 'Hiệu lực ở quá khứ hoặc tương lai đều được; mốc đầu có thể đổi; ngày trước mốc đầu bị chặn', () => {
  const s0 = st({ debts: [tracked()] });
  const fut = ok(applyAddRateChange(s0, { debtId: 'd1', effectiveDate: '2028-01-10', annualRate: 11 }, uid, '2026-11-05')).debts[0];
  const past = ok(applyAddRateChange(s0, { debtId: 'd1', effectiveDate: '2026-11-05', annualRate: 9 }, uid, '2026-11-05')).debts[0];
  const early = err(applyAddRateChange(s0, { debtId: 'd1', effectiveDate: '2026-01-01', annualRate: 9 }, uid, '2026-11-05'));
  const bad = [err(applyAddRateChange(s0, { debtId: 'd1', effectiveDate: '2027-01-01', annualRate: -1 }, uid, '2026-11-05')), err(applyAddRateChange(s0, { debtId: 'd1', effectiveDate: '2027-01-01', annualRate: 500 }, uid, '2026-11-05')), err(applyAddRateChange(s0, { debtId: 'd1', effectiveDate: '', annualRate: 9 }, uid, '2026-11-05'))];
  return ensureTimeline(fut).length === 2 && fut.annualInterestRate === 9.5 && past.annualInterestRate === 9 && ensureTimeline(past).length === 1 && early !== '' && bad.every((b) => b !== '') ? true : JSON.stringify([fut.annualInterestRate, past.annualInterestRate, early, bad]);
});
t('R2e', 'Thả nổi: lãi = lãi cơ sở + biên độ; lãi hiện hành của khoản vay cập nhật theo ngày hôm nay', () => {
  const s = ok(applyAddRateChange(st({ debts: [tracked({ rateType: 'floating', baseRate: 6, margin: 3.5 })] }), { debtId: 'd1', effectiveDate: '2026-11-20', baseRate: 7, margin: 3.5, note: 'điều chỉnh quý' }, uid, '2026-11-25'));
  const d = s.debts[0]; const tl = ensureTimeline(d);
  return tl[1].annualRate === 10.5 && tl[1].baseRate === 7 && tl[1].margin === 3.5 && d.annualInterestRate === 10.5 && d.baseRate === 7 ? true : JSON.stringify(tl);
});
t('R2f', 'Trả góp đều: đổi lãi → tính lại tiền trả theo dư nợ thực tế, kỳ cuối về 0, tổng gốc = dư nợ', () => {
  const d0 = tracked({ method: 'equal_payment', periods: 24 });
  const pmt0 = d0.schedule![2].totalMonthlyPayment;
  const d = ok(applyAddRateChange(st({ debts: [d0] }), { debtId: 'd1', effectiveDate: '2027-02-10', annualRate: 11 }, uid, '2026-11-05')).debts[0];
  const pmt1 = d.schedule![10].totalMonthlyPayment;
  return d.schedule![2].totalMonthlyPayment === pmt0 && pmt1 > pmt0 && sumOpen(d) === d.remainingPrincipal && lastOpen(d).remainingBalance === 0 ? true : JSON.stringify([pmt0, pmt1, sumOpen(d)]);
});
t('R2g', 'Bất biến: tổng gốc các kỳ chưa trả = dư nợ; kỳ cuối về 0 (gốc đều, trả góp đều, ân hạn)', () => {
  const ds = [tracked(), tracked({ method: 'equal_payment' }), tracked({ graceLeft: 3 }), tracked({ method: 'equal_payment', graceLeft: 5, periods: 36 })];
  return ds.every((d) => sumOpen(d) === d.remainingPrincipal && lastOpen(d).remainingBalance === 0) ? true : JSON.stringify(ds.map((d) => [sumOpen(d), lastOpen(d).remainingBalance]));
});
t('R2h', 'Bỏ mốc lãi nhập nhầm khôi phục đúng lịch cũ; mốc đã dùng cho kỳ đã trả và mốc đầu không bỏ được', () => {
  const s0 = st({ debts: [tracked()] });
  const orig = JSON.stringify(s0.debts[0].schedule);
  let s = ok(applyAddRateChange(s0, { debtId: 'd1', effectiveDate: '2027-05-10', annualRate: 12 }, uid, '2026-11-05'));
  const id = ensureTimeline(s.debts[0])[1].id;
  const rm = ok(applyRemoveRateChange(s, 'd1', id, '2026-11-05'));
  const initial = canRemoveRateChange(s.debts[0], ensureTimeline(s.debts[0])[0].id);
  let s2 = ok(applyAddRateChange(s0, { debtId: 'd1', effectiveDate: '2026-12-10', annualRate: 12 }, uid, '2026-11-05'));
  const id2 = ensureTimeline(s2.debts[0])[1].id;
  s2 = pay(s2, 0, '2026-12-10'); s2 = pay(s2, 1, '2027-01-10');
  s2 = ok(applyAddRateChange(s2, { debtId: 'd1', effectiveDate: '2027-03-10', annualRate: 12.5 }, uid, '2027-01-10'));
  const used = canRemoveRateChange(s2.debts[0], id2);
  return JSON.stringify(rm.debts[0].schedule) === orig && !initial.ok && !used.ok && ensureTimeline(rm.debts[0]).length === 1 ? true : JSON.stringify([initial, used]);
});
t('R2i', 'Dữ liệu cũ được nạp: mọi khoản vay có mốc lãi đầu = lãi hiện tại (idempotent)', () => {
  const legacy: any = { ...base, principalAmount: 600 * M, remainingPrincipal: 600 * M, annualInterestRate: 9.6, rateType: 'fixed', tenorMonths: 60, startDate: '2026-10-01', paymentDayOfMonth: 15, method: 'declining_balance', status: 'active', schedule: [] };
  const a = normalizeState({ schemaVersion: 2, wallet: { availableCash: 0, totalDeposited: 0, totalWithdrawn: 0 }, assets: [], debts: [legacy], transactions: [] })!;
  const b = normalizeState(JSON.parse(JSON.stringify(a)))!;
  const tl = a.debts[0].rateTimeline!;
  return tl.length === 1 && tl[0].annualRate === 9.6 && tl[0].effectiveDate === '2026-10-01' && tl[0].source === 'initial' && JSON.stringify(a) === JSON.stringify(b) ? true : JSON.stringify(tl);
});

// ================= Khoản vay đang trả dở =================
t('TR1', 'Còn 170/300 kỳ: lịch chỉ có đúng 170 kỳ, đánh số 1–170, chưa kỳ nào "đã trả", không có lịch sử trước ngày theo dõi', () => {
  const d = tracked({ balance: 850 * M, periods: 170, firstDueDate: '2026-11-20', trackingStart: '2026-11-05', paymentDay: 20 });
  const sc = d.schedule!;
  return sc.length === 170 && sc[0].period === 1 && sc[169].period === 170 && sc.every((i) => !i.isPaid && !i.preTracking) && d.trackingStartDate === '2026-11-05' &&
    sc[0].dueDate === '2026-11-20' && sc[169].dueDate === '2040-12-20' && d.remainingPrincipal === 850 * M && sumOpen(d) === 850 * M && sc[0].interestPayable === Math.round(850 * M * 0.095 / 12)
    ? true : JSON.stringify([sc.length, sc[169].dueDate, sumOpen(d)]);
});
t('TR2', 'Khoản vay mới giải ngân kiểu cũ vẫn chạy: kỳ quá khứ đánh dấu "trước khi theo dõi"', () => {
  const d0: Debt = { ...base, principalAmount: 600 * M, remainingPrincipal: 600 * M, annualInterestRate: 9, rateType: 'fixed', tenorMonths: 24, startDate: '2026-01-10', paymentDayOfMonth: 10, method: 'declining_balance', status: 'active',
    schedule: generateAmortizationSchedule(600 * M, 9, 24, '2026-01-10', 10, 'declining_balance') };
  const d = normalizeDebt({ ...d0, schedule: [] }, '2026-11-05');
  const hist = d.schedule!.filter((i) => i.isPaid);
  return hist.length === 9 && hist.every((i) => i.preTracking === true) ? true : JSON.stringify(hist.length);
});

t('TR3', 'Dữ liệu cũ: kỳ do app tự dựng lịch sử (không giao dịch, trả đúng ngày hạn) được đánh dấu "trước khi theo dõi"; kỳ có giao dịch thì không', () => {
  const sched = generateAmortizationSchedule(600 * M, 9, 24, '2026-01-10', 10, 'declining_balance').map((it, i) => (i < 8 ? { ...it, isPaid: true, paidDate: it.dueDate } : it));
  const d: Debt = { ...base, principalAmount: 600 * M, remainingPrincipal: sched[7].remainingBalance, annualInterestRate: 9, rateType: 'fixed', tenorMonths: 24, startDate: '2026-01-10', paymentDayOfMonth: 10, method: 'declining_balance', status: 'active', schedule: sched };
  const recorded = { id: 'tx-r', date: '2026-09-12', type: 'debt_payment' as const, amount: sched[8].totalMonthlyPayment, title: 'Trả nợ kỳ #9', linkedDebtId: 'd1', periodIndex: 8 };
  d.schedule![8] = { ...sched[8], isPaid: true, paidDate: '2026-09-12' };
  const a = normalizeState({ schemaVersion: 2, wallet: { availableCash: 0, totalDeposited: 0, totalWithdrawn: 0 }, assets: [], debts: [d], transactions: [recorded] })!;
  const b = normalizeState(JSON.parse(JSON.stringify(a)))!;
  const sc = a.debts[0].schedule!;
  return sc.slice(0, 8).every((i) => i.preTracking === true) && !sc[8].preTracking && !sc[9].preTracking && JSON.stringify(a) === JSON.stringify(b) ? true : JSON.stringify(sc.slice(0, 10).map((i) => i.preTracking));
});

// ================= Tất toán sớm =================
t('S1', 'Tất toán sớm: lãi dồn theo ngày/365; một giao dịch tách gốc, lãi, phí; ví giảm đúng; các kỳ còn lại "hủy do tất toán"', () => {
  const s0 = st({ debts: [tracked()] });
  const pv = previewSettlement(s0.debts[0], '2026-12-05', '2026-12-05');
  if (!pv.ok) return pv.error;
  const actual = pv.balance + pv.interest + 5 * M;
  const s = ok(applySettle(s0, { debtId: 'd1', date: '2026-12-05', fee: 5 * M, actualPaid: actual, deductFromWallet: true }, uid, '2026-12-05'));
  const d = s.debts[0]; const tx = s.transactions[0];
  return pv.interest === 6_506_849 && pv.days === 25 && d.status === 'paid_off' && d.remainingPrincipal === 0 && d.closedDate === '2026-12-05' && d.closeReason === 'early' &&
    d.schedule!.every((i) => i.status === 'cancelled') && tx.amount === actual && tx.principalPortion === 1000 * M && tx.interestPortion === 6_506_849 && tx.feePortion === 5 * M &&
    s.transactions.length === 1 && s.wallet.availableCash === 5000 * M - actual && calculateFinancialSummary(s).totalDebtBalance === 0
    ? true : JSON.stringify([pv, tx, d.status]);
});
t('S2', 'Lãi thực tế lấy theo số tiền thực trả: thực trả − dư nợ − phí', () => {
  const s = ok(applySettle(st({ debts: [tracked()] }), { debtId: 'd1', date: '2026-12-05', fee: 1 * M, actualPaid: 1000 * M + 6 * M + 1 * M, deductFromWallet: true }, uid, '2026-12-05'));
  return s.transactions[0].interestPortion === 6 * M ? true : String(s.transactions[0].interestPortion);
});
t('S3', 'Tất toán bị chặn: ví không đủ, thực trả nhỏ hơn gốc + phí, ngày tương lai / trước đầu kỳ / sau hạn kỳ tới', () => {
  const d = tracked();
  const poor = st({ debts: [d], wallet: { availableCash: 10 * M, totalDeposited: 10 * M, totalWithdrawn: 0 } });
  const rich = st({ debts: [d] });
  const r = [
    err(applySettle(poor, { debtId: 'd1', date: '2026-12-05', fee: 0, actualPaid: 1006 * M, deductFromWallet: true }, uid, '2026-12-05')),
    err(applySettle(rich, { debtId: 'd1', date: '2026-12-05', fee: 5 * M, actualPaid: 1002 * M, deductFromWallet: true }, uid, '2026-12-05')),
    err(applySettle(rich, { debtId: 'd1', date: '2026-12-20', fee: 0, actualPaid: 1006 * M, deductFromWallet: true }, uid, '2026-12-05')),
    err(applySettle(rich, { debtId: 'd1', date: '2026-11-07', fee: 0, actualPaid: 1006 * M, deductFromWallet: true }, uid, '2026-12-05')),
    err(applySettle(rich, { debtId: 'd1', date: '2026-12-15', fee: 0, actualPaid: 1006 * M, deductFromWallet: true }, uid, '2026-12-20')),
  ];
  return r.every((x) => x !== '') ? true : JSON.stringify(r);
});
t('S4', 'Hủy tất toán nhập nhầm: khoản vay sống lại đúng dư nợ, kỳ hết "hủy", ví hoàn lại', () => {
  const s0 = st({ debts: [tracked()] });
  const s1 = ok(applySettle(s0, { debtId: 'd1', date: '2026-12-05', fee: 0, actualPaid: 1006_506_849, deductFromWallet: true }, uid, '2026-12-05'));
  const s2 = ok(applyVoidTx(s1, s1.transactions[0].id, uid, '2026-12-06'));
  const d = s2.debts[0];
  return d.status === 'active' && d.remainingPrincipal === 1000 * M && d.closedDate === undefined && d.schedule!.every(isOpenItem) && s2.wallet.availableCash === 5000 * M && JSON.stringify(d.schedule) === JSON.stringify(s0.debts[0].schedule)
    ? true : JSON.stringify([d.status, d.remainingPrincipal]);
});
t('S5', 'Tất toán bằng tiền ngoài ví: ghi nhận khoản trả nhưng ví không đổi; vẫn hủy được', () => {
  const s0 = st({ debts: [tracked()] });
  const s1 = ok(applySettle(s0, { debtId: 'd1', date: '2026-12-05', fee: 0, actualPaid: 1006_506_849, deductFromWallet: false }, uid, '2026-12-05'));
  const tx = s1.transactions[0];
  const s2 = ok(applyVoidTx(s1, tx.id, uid, '2026-12-06'));
  return tx.noCash === true && txEffect(tx) === 0 && s1.wallet.availableCash === 5000 * M && s2.debts[0].status === 'active' && s2.wallet.availableCash === 5000 * M ? true : JSON.stringify(tx);
});
t('S6', 'Tài sản thế chấp được giải phóng sau tất toán (khoản vay không còn "đang vay")', () => {
  const s = ok(applySettle(st({ debts: [{ ...tracked(), collateralAssetId: 'a1' }] }), { debtId: 'd1', date: '2026-12-05', fee: 0, actualPaid: 1006_506_849, deductFromWallet: true }, uid, '2026-12-05'));
  return !s.debts.some((d) => d.status === 'active' && d.collateralAssetId === 'a1') ? true : 'còn thế chấp';
});

// ================= Trả trước một phần gốc =================
t('P1', 'Trả trước gốc, giữ kỳ hạn: dư nợ giảm, kỳ đang chạy tính lãi từ ngày trả, gốc các kỳ sau giảm theo', () => {
  const s0 = st({ debts: [tracked()] });
  const s = ok(applyPrepay(s0, { debtId: 'd1', date: '2026-12-05', principal: 200 * M, fee: 0, mode: 'reduce_payment', deductFromWallet: true }, uid, '2026-12-05'));
  const d = s.debts[0]; const tx = s.transactions[0];
  return d.remainingPrincipal === 800 * M && d.schedule![0].accrualFrom === '2026-12-05' && d.schedule![0].interestPayable === 1_041_096 && d.schedule![0].principalPayable === 66_666_667 &&
    d.schedule!.filter(isOpenItem).length === 12 && sumOpen(d) === 800 * M && tx.principalPortion === 200 * M && tx.interestPortion === 6_506_849 && tx.amount === 200 * M + 6_506_849 &&
    s.wallet.availableCash === 5000 * M - tx.amount ? true : JSON.stringify([d.remainingPrincipal, d.schedule![0], tx.amount]);
});
t('P2', 'Trả trước gốc, rút ngắn kỳ hạn: giữ gốc mỗi kỳ, các kỳ thừa chuyển "hủy"', () => {
  const s = ok(applyPrepay(st({ debts: [tracked()] }), { debtId: 'd1', date: '2026-12-05', principal: 200 * M, fee: 0, mode: 'shorten_term', deductFromWallet: true }, uid, '2026-12-05'));
  const d = s.debts[0];
  return d.schedule!.filter((i) => i.status === 'cancelled').length === 2 && d.schedule![0].principalPayable === 83_333_333 && sumOpen(d) === 800 * M && lastOpen(d).remainingBalance === 0 && d.status === 'active' ? true : JSON.stringify(d.schedule!.filter(isOpenItem).length);
});
t('P3', 'Trả góp đều: giảm tiền trả (giữ kỳ hạn) hoặc giữ tiền trả (rút ngắn)', () => {
  const d0 = tracked({ method: 'equal_payment', periods: 24 });
  const pm0 = d0.schedule![1].totalMonthlyPayment;
  const red = ok(applyPrepay(st({ debts: [d0] }), { debtId: 'd1', date: '2026-12-05', principal: 300 * M, fee: 0, mode: 'reduce_payment', deductFromWallet: true }, uid, '2026-12-05')).debts[0];
  const sho = ok(applyPrepay(st({ debts: [d0] }), { debtId: 'd1', date: '2026-12-05', principal: 300 * M, fee: 0, mode: 'shorten_term', deductFromWallet: true }, uid, '2026-12-05')).debts[0];
  return red.schedule![5].totalMonthlyPayment < pm0 && red.schedule!.filter(isOpenItem).length === 24 && sho.schedule![5].totalMonthlyPayment === pm0 && sho.schedule!.filter(isOpenItem).length < 24 && sumOpen(sho) === 700 * M
    ? true : JSON.stringify([pm0, red.schedule![5].totalMonthlyPayment, sho.schedule![5].totalMonthlyPayment, sho.schedule!.filter(isOpenItem).length]);
});
t('P4', 'Hủy trả trước nhập nhầm: lịch, dư nợ và ví trở về đúng như trước (cả hai kiểu)', () => {
  for (const mode of ['reduce_payment', 'shorten_term'] as const) {
    const s0 = st({ debts: [tracked()] });
    const s1 = ok(applyPrepay(s0, { debtId: 'd1', date: '2026-12-05', principal: 200 * M, fee: 3 * M, mode, deductFromWallet: true }, uid, '2026-12-05'));
    const s2 = ok(applyVoidTx(s1, s1.transactions[0].id, uid, '2026-12-06'));
    const a = s0.debts[0], b = s2.debts[0];
    const same = a.schedule!.every((x, i) => x.principalPayable === b.schedule![i].principalPayable && x.interestPayable === b.schedule![i].interestPayable && x.remainingBalance === b.schedule![i].remainingBalance && x.status === b.schedule![i].status && x.accrualFrom === b.schedule![i].accrualFrom);
    if (!(same && a.remainingPrincipal === b.remainingPrincipal && s2.wallet.availableCash === s0.wallet.availableCash)) return 'chưa hoàn nguyên: ' + mode;
  }
  return true;
});
t('P5', 'Trả trước bị chặn: ngày từ hạn kỳ tới trở đi, gốc ≥ dư nợ, ví không đủ, tương lai; hủy kỳ cũ khi có trả trước mới hơn', () => {
  const rich = st({ debts: [tracked()] });
  const poor = st({ debts: [tracked()], wallet: { availableCash: 50 * M, totalDeposited: 50 * M, totalWithdrawn: 0 } });
  const mk = (p: Partial<Parameters<typeof applyPrepay>[1]>, s = rich) => err(applyPrepay(s, { debtId: 'd1', date: '2026-12-05', principal: 100 * M, fee: 0, mode: 'reduce_payment', deductFromWallet: true, ...p }, uid, '2026-12-20'));
  const r = [mk({ date: '2026-12-10' }), mk({ principal: 1000 * M }), mk({ principal: 0 }), mk({ date: '2026-12-25' }), mk({}, poor)];
  let s = ok(applyPrepay(rich, { debtId: 'd1', date: '2026-12-05', principal: 100 * M, fee: 0, mode: 'reduce_payment', deductFromWallet: true }, uid, '2026-12-05'));
  const prepayId = s.transactions[0].id;
  s = pay(s, 0, '2026-12-10');
  const blocked = canVoidTx(s, prepayId);
  return r.every((x) => x !== '') && !blocked.ok ? true : JSON.stringify([r, blocked]);
});
t('P6', 'Sau trả trước, trả kỳ hiện tại: lãi kỳ chỉ tính từ ngày trả trước; dư nợ khớp lịch', () => {
  let s = ok(applyPrepay(st({ debts: [tracked()] }), { debtId: 'd1', date: '2026-12-05', principal: 200 * M, fee: 0, mode: 'reduce_payment', deductFromWallet: true }, uid, '2026-12-05'));
  const item = s.debts[0].schedule![0];
  s = pay(s, 0, '2026-12-10');
  return s.debts[0].remainingPrincipal === item.remainingBalance && s.debts[0].remainingPrincipal === 800 * M - 66_666_667 && s.transactions[0].interestPortion === 1_041_096 ? true : JSON.stringify([s.debts[0].remainingPrincipal, s.transactions[0]]);
});

// ================= Đối chiếu sao kê =================
t('C3a', 'Đối chiếu: dư nợ = số theo sao kê, lưu dấu vết (trước/sau), ví và sổ giao dịch không đổi, lịch tính lại', () => {
  let s0 = st({ debts: [tracked()] });
  s0 = pay(s0, 0, '2026-12-10');
  const before = s0.debts[0];
  const s = ok(applyReconcile(s0, { debtId: 'd1', actual: before.remainingPrincipal + 2 * M, date: '2026-12-15', note: 'theo sao kê 15/12' }, uid, '2026-12-15'));
  const d = s.debts[0]; const adj = d.adjustments![0];
  return d.remainingPrincipal === before.remainingPrincipal + 2 * M && adj.before === before.remainingPrincipal && adj.after === d.remainingPrincipal && adj.note === 'theo sao kê 15/12' &&
    s.wallet.availableCash === s0.wallet.availableCash && s.transactions.length === s0.transactions.length && sumOpen(d) === d.remainingPrincipal && JSON.stringify(d.schedule![0]) === JSON.stringify({ ...before.schedule![0], remainingBalance: d.remainingPrincipal })
    ? true : JSON.stringify([d.remainingPrincipal, adj]);
});
t('C3b', 'Đối chiếu bị chặn khi số khớp, bằng 0, ngày tương lai; hoàn tác được khi chưa có giao dịch sau đó', () => {
  const s0 = st({ debts: [tracked()] });
  const r = [err(applyReconcile(s0, { debtId: 'd1', actual: 1000 * M, date: '2026-11-06' }, uid, '2026-11-06')), err(applyReconcile(s0, { debtId: 'd1', actual: 0, date: '2026-11-06' }, uid, '2026-11-06')), err(applyReconcile(s0, { debtId: 'd1', actual: 900 * M, date: '2026-12-31' }, uid, '2026-11-06'))];
  const s1 = ok(applyReconcile(s0, { debtId: 'd1', actual: 990 * M, date: '2026-11-06' }, uid, '2026-11-06'));
  const s2 = ok(applyUndoReconcile(s1, 'd1', '2026-11-06'));
  const s3 = pay(s1, 0, '2026-12-10');
  const blocked = canUndoReconcile(s3.debts[0]);
  return r.every((x) => x !== '') && JSON.stringify(s2.debts[0].schedule) === JSON.stringify(s0.debts[0].schedule) && s2.debts[0].adjustments!.length === 0 && s2.debts[0].remainingPrincipal === 1000 * M && !blocked.ok ? true : JSON.stringify([r, blocked]);
});

// ================= R6 theo ngày thanh toán =================
t('U1', 'Mỗi tháng một kỳ tính theo THÁNG CỦA NGÀY THANH TOÁN: nhập bù hai kỳ cũ đúng tháng được; trả sớm trước tháng đến hạn bị chặn', () => {
  const s0 = st({ debts: [tracked({ periods: 12, firstDueDate: '2026-09-10', trackingStart: '2026-08-20' }, '2026-08-20')] });
  const today = '2026-10-31';
  const a = ok(applyPayPeriod(s0, { debtId: 'd1', periodIndex: 0, deductFromWallet: true, date: '2026-09-12' }, uid, today));      // kỳ 1 đến hạn 10/09, trả 12/09
  const b = ok(applyPayPeriod(a, { debtId: 'd1', periodIndex: 1, deductFromWallet: true, date: '2026-10-12' }, uid, today));       // kỳ 2 đến hạn 10/10, trả 12/10
  const early = err(applyPayPeriod(a, { debtId: 'd1', periodIndex: 1, deductFromWallet: true, date: '2026-09-20' }, uid, today)); // kỳ 2 trả trong tháng 9: chặn
  const back = err(applyPayPeriod(a, { debtId: 'd1', periodIndex: 1, deductFromWallet: true, date: '2026-09-05' }, uid, today));  // trước ngày trả kỳ trước: chặn
  const catchUp = ok(applyPayPeriod(applyPayPeriod(s0, { debtId: 'd1', periodIndex: 0, deductFromWallet: true, date: '2026-10-20' }, uid, today).ok ? (applyPayPeriod(s0, { debtId: 'd1', periodIndex: 0, deductFromWallet: true, date: '2026-10-20' }, uid, today) as any).state : s0, { debtId: 'd1', periodIndex: 1, deductFromWallet: true, date: '2026-10-21' }, uid, today));
  return b.debts[0].schedule![1].isPaid && early !== '' && back !== '' && catchUp.debts[0].schedule![1].paidDate === '2026-10-21' && checkPayable(a.debts[0], 2, '2026-10-12').ok === false ? true : JSON.stringify([early, back]);
});

// ================= C4: tiết kiệm =================
const sav = (o: Partial<Asset> = {}, m: any = {}): Asset => ({
  id: 'sv', name: 'Sổ BIDV', category: 'savings', initialCost: 100 * M, currentValue: 100 * M, purchaseDate: '2026-01-01', status: 'active',
  metadata: { bankName: 'BIDV', depositAmount: 100 * M, termMonths: 12, annualInterestRate: 6, startDate: '2026-01-01', maturityDate: '2027-01-01', rolloverOption: 'principal_only', ...m } as any,
  realizedPnL: 0, lastValuationDate: '2026-01-01', ...o,
});
t('V1', 'Giá trị sổ tiết kiệm = gốc + lãi đã phát sinh chưa nhận (không nhập giá tay)', () => {
  const a = sav();
  const v = savingsCurrentValue(a, '2026-07-01');
  const acc = Math.round(100 * M * 0.06 * 181 / 365);
  return v === 100 * M + acc ? true : `${v} vs ${100 * M + acc}`;
});
t('V2', 'Nhận lãi: cộng ví, ghi thu nhập gắn sổ; giá trị sổ giảm đúng số đã nhận; tài sản ròng không đổi', () => {
  const s0 = st({ assets: [sav()] });
  const accrued = savingsCurrentValue(s0.assets[0], '2026-07-01') - 100 * M;
  const nw0 = calculateFinancialSummary({ ...s0, assets: [{ ...s0.assets[0], currentValue: 100 * M + accrued }] }).netWorth;
  const s = ok(applyReceiveSavingsInterest(s0, { assetId: 'sv', amount: 1 * M, date: '2026-07-01' }, uid, '2026-07-01'));
  const a = s.assets[0]; const tx = s.transactions[0];
  const nw1 = calculateFinancialSummary(s).netWorth;
  return (a.metadata as any).interestReceived === 1 * M && a.currentValue === 100 * M + accrued - 1 * M && tx.type === 'interest_income' && tx.linkedAssetId === 'sv' && s.wallet.availableCash === 5000 * M + 1 * M &&
    calculateFinancialSummary(s).totalRealizedPnL === 1 * M && nw1 === nw0 ? true : JSON.stringify([a.currentValue, nw0, nw1]);
});
t('V3', 'Hủy lần nhận lãi: lãi đã nhận và giá trị sổ trở lại; nhập lãi qua màn thu nhập chung cũng được theo dõi', () => {
  let s = ok(applyIncome(st({ assets: [sav()] }), { type: 'interest_income', assetId: 'sv', amount: 2 * M, date: '2026-07-01' }, uid, '2026-07-01'));
  const got = (s.assets[0].metadata as any).interestReceived;
  s = ok(applyVoidTx(s, s.transactions[0].id, uid, '2026-07-02'));
  return got === 2 * M && (s.assets[0].metadata as any).interestReceived === 0 && s.wallet.availableCash === 5000 * M ? true : JSON.stringify([got, s.assets[0].metadata]);
});
t('V4', 'Tái tục gốc + lãi: lãi 6tr ghi thu nhập, nhập vào gốc (ví không đổi ròng), kỳ hạn/lãi mới, ngày đáo hạn mới', () => {
  const s0 = st({ assets: [sav()] });
  const s = ok(applyRollover(s0, { assetId: 'sv', date: '2027-01-01', interest: 6 * M, capitalize: true, termMonths: 6, annualRate: 5.5 }, uid, '2027-01-01'));
  const a = s.assets[0]; const m = a.metadata as any;
  return s.wallet.availableCash === 5000 * M && m.depositAmount === 106 * M && a.initialCost === 106 * M && m.termMonths === 6 && m.annualInterestRate === 5.5 && m.startDate === '2027-01-01' && m.maturityDate === '2027-07-01' &&
    m.interestReceived === 0 && a.currentValue === 106 * M && s.transactions.some((x) => x.type === 'interest_income' && x.amount === 6 * M) && s.transactions.some((x) => x.type === 'buy_asset' && x.amount === 6 * M) &&
    s.transactions.every((x) => !canVoidTx(s, x.id).ok) && calculateFinancialSummary(s).totalRealizedPnL === 6 * M ? true : JSON.stringify([m, a.currentValue, s.wallet]);
});
t('V5', 'Tái tục chỉ gốc: lãi về ví, gốc giữ nguyên', () => {
  const s = ok(applyRollover(st({ assets: [sav()] }), { assetId: 'sv', date: '2027-01-03', interest: 6 * M, capitalize: false, termMonths: 12, annualRate: 6.2 }, uid, '2027-01-03'));
  const m = s.assets[0].metadata as any;
  return s.wallet.availableCash === 5000 * M + 6 * M && m.depositAmount === 100 * M && s.assets[0].initialCost === 100 * M && m.maturityDate === '2028-01-03' ? true : JSON.stringify([s.wallet, m]);
});
t('V6', 'Tái tục bị chặn trước ngày đáo hạn, kỳ hạn/lãi không hợp lệ, ngày tương lai', () => {
  const s0 = st({ assets: [sav()] });
  const r = [err(applyRollover(s0, { assetId: 'sv', date: '2026-12-31', interest: 0, capitalize: false, termMonths: 6, annualRate: 5 }, uid, '2027-02-01')),
    err(applyRollover(s0, { assetId: 'sv', date: '2027-01-02', interest: 0, capitalize: false, termMonths: 0, annualRate: 5 }, uid, '2027-02-01')),
    err(applyRollover(s0, { assetId: 'sv', date: '2027-01-02', interest: 0, capitalize: false, termMonths: 6, annualRate: 500 }, uid, '2027-02-01')),
    err(applyRollover(s0, { assetId: 'sv', date: '2027-03-01', interest: 0, capitalize: false, termMonths: 6, annualRate: 5 }, uid, '2027-02-01'))];
  return r.every((x) => x !== '') ? true : JSON.stringify(r);
});
t('V7', 'Lãi trả đầu kỳ: đã nhận lãi cả kỳ thì giá trị sổ không thấp hơn gốc', () => {
  const s = ok(applyReceiveSavingsInterest(st({ assets: [sav({}, { interestPayout: 'upfront' })] }), { assetId: 'sv', amount: 6 * M, date: '2026-01-01' }, uid, '2026-01-01'));
  return s.assets[0].currentValue === 100 * M ? true : String(s.assets[0].currentValue);
});
t('V8', 'Nạp dữ liệu: giá trị sổ tiết kiệm suy ra từ gốc + lãi; nạp lại không đổi', () => {
  const a = normalizeState({ schemaVersion: 2, wallet: { availableCash: 0, totalDeposited: 0, totalWithdrawn: 0 }, assets: [sav({ currentValue: 1 })], debts: [], transactions: [] })!;
  const b = normalizeState(JSON.parse(JSON.stringify(a)))!;
  const expect = savingsCurrentValue(sav());
  return a.assets[0].currentValue === expect && b.assets[0].currentValue === expect ? true : JSON.stringify([a.assets[0].currentValue, expect]);
});

console.log(`\n==== phase3: ${pass} pass / ${fail} fail ====`);
process.exit(fail ? 1 : 0);
