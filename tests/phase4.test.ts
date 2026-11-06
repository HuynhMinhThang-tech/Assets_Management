/**
 * Test giai đoạn 4: R10 (ba báo cáo), C6 (ảnh chụp chi tiết), C8 (đối soát), R4 (cảnh báo nơi dùng vốn).
 * Run: npx tsx tests/phase4.test.ts
 */
import { generateAmortizationSchedule, todayLocalStr } from '../src/utils/calculations';
import { buildTrackedDebt } from '../src/utils/debtCore';
import { applyPrepay, applyReconcile, applySettle } from '../src/utils/debtOps';
import {
  applyAddDebt, applyDeposit, applyIncome, applyPayPeriod, applySell, applyVoidTx, applyWithdraw, OpResult,
} from '../src/utils/ops';
import { applyRollover } from '../src/utils/savingsOps';
import {
  assetValueAt, buildPeriod, cashAt, cashFlowReport, debtBalanceAt, equityAt, periodBalance, profitReport, reconcileReports, snapshotGroupsBefore, stateAt,
} from '../src/utils/reports';
import { createDemoState, normalizeState } from '../src/utils/storage';
import { calculateBalanceSheet } from '../src/utils/balanceSheet';
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
const TODAY = '2026-11-02';
const st = (o: Partial<UserFinancialState> = {}): UserFinancialState => ({
  wallet: { availableCash: 0, totalDeposited: 0, totalWithdrawn: 0 }, assets: [], debts: [], transactions: [], ...o,
});
const ok = (r: OpResult): UserFinancialState => { if (!r.ok) throw new Error('op lỗi: ' + r.error); return r.state; };
const stock = (o: Partial<Asset> = {}): Asset => ({
  id: 'fpt', name: 'FPT', category: 'stock', initialCost: 100 * M, currentValue: 120 * M, purchaseDate: '2026-02-01', status: 'active',
  metadata: { symbol: 'FPT', exchange: 'HOSE', quantity: 1000, avgCostPrice: 100000, currentPrice: 120000, totalDividendsReceived: 0 } as any,
  realizedPnL: 0, lastValuationDate: '2026-02-01', ...o,
});
const per = (kind: any, year: number, month = 1, quarter = 1, from?: string, to?: string) => buildPeriod({ kind, year, month, quarter, from, to }, TODAY);
const P_OCT = per('month', 2026, 10);
const base: any = { id: 'd1', name: 'Vay A', lender: 'NH', category: 'consumer_loan', securityType: 'unsecured', fundUse: { kind: 'spent' } };
const trackedDebt = (o: any = {}): Debt => buildTrackedDebt(base, { balance: 600 * M, periods: 12, firstDueDate: '2026-10-20', trackingStart: '2026-09-25', paymentDay: 20, annualRate: 9, rateType: 'fixed', method: 'declining_balance', ...o }, '2026-09-25');

// ============ Kỳ báo cáo ============
t('K1', 'Kỳ tháng / quý / năm / tùy chọn: từ–đến đúng; kỳ đang chạy kết thúc ở hôm nay; từ > đến không hợp lệ', () => {
  const m = per('month', 2026, 2), q = per('quarter', 2026, 1, 3), y = per('year', 2025), cur = per('month', 2026, 11), c = per('custom', 2026, 1, 1, '2026-03-05', '2026-04-10'), bad = per('custom', 2026, 1, 1, '2026-05-01', '2026-04-10');
  return m.from === '2026-02-01' && m.to === '2026-02-28' && q.from === '2026-07-01' && q.to === '2026-09-30' && y.from === '2025-01-01' && y.to === '2025-12-31' &&
    cur.to === TODAY && c.valid && !bad.valid && m.label === 'Tháng 2/2026' && q.label === 'Quý 3/2026' ? true : JSON.stringify([m, q, cur]);
});

// ============ Khôi phục số dư ============
t('B1', 'Tiền ví theo ngày: khớp từng bước của sổ (kể cả giao dịch đã hủy + bút toán đảo)', () => {
  let s = st();
  s = ok(applyDeposit(s, 100 * M, '2026-09-01', undefined, uid, TODAY));
  s = ok(applyDeposit(s, 50 * M, '2026-10-05', undefined, uid, TODAY));
  s = ok(applyWithdraw(s, 20 * M, '2026-10-20', undefined, uid, TODAY));
  s = ok(applyVoidTx(s, s.transactions.find((x) => x.amount === 50 * M && x.type === 'deposit')!.id, uid, TODAY));
  return cashAt(s, '2026-08-31') === 0 && cashAt(s, '2026-09-30') === 100 * M && cashAt(s, '2026-10-10') === 100 * M && cashAt(s, '2026-10-31') === 80 * M && s.wallet.availableCash === 80 * M ? true : JSON.stringify([cashAt(s, '2026-10-10'), cashAt(s, '2026-10-31')]);
});
t('B2', 'Dư nợ theo ngày: tua ngược qua các kỳ đã trả, trả trước, tất toán, đối chiếu; trước ngày theo dõi = 0', () => {
  let s = st({ wallet: { availableCash: 5000 * M, totalDeposited: 5000 * M, totalWithdrawn: 0 }, debts: [trackedDebt()] });
  const b0 = s.debts[0].remainingPrincipal;
  s = ok(applyPayPeriod(s, { debtId: 'd1', periodIndex: 0, deductFromWallet: true, date: '2026-10-20' }, uid, '2026-10-20'));
  const afterPay = s.debts[0].remainingPrincipal;
  s = ok(applyPrepay(s, { debtId: 'd1', date: '2026-10-25', principal: 100 * M, fee: 0, mode: 'reduce_payment', deductFromWallet: true }, uid, '2026-10-25'));
  const afterPrepay = s.debts[0].remainingPrincipal;
  s = ok(applyReconcile(s, { debtId: 'd1', actual: afterPrepay + 1 * M, date: '2026-10-28' }, uid, '2026-10-28'));
  const d = s.debts[0];
  return debtBalanceAt(s, d, '2026-09-24') === b0 && debtBalanceAt(s, d, '2026-10-19') === b0 && debtBalanceAt(s, d, '2026-10-21') === afterPay && debtBalanceAt(s, d, '2026-10-26') === afterPrepay &&
    debtBalanceAt(s, d, '2026-11-01') === afterPrepay + 1 * M ? true : JSON.stringify([b0, afterPay, afterPrepay, debtBalanceAt(s, d, '2026-10-19'), debtBalanceAt(s, d, '2026-10-21')]);
});
t('B3', 'Thị giá theo ngày: dùng lịch sử định giá, trừ phần bán một phần; chưa từng định giá = giá vốn', () => {
  const a = stock({ valuationHistory: [{ date: '2026-03-01', value: 110 * M }, { date: '2026-06-01', value: 130 * M }], currentValue: 120 * M });
  const s = st({ assets: [a] });
  return assetValueAt(s, a, '2026-02-15', TODAY) === 100 * M && assetValueAt(s, a, '2026-04-01', TODAY) === 110 * M && assetValueAt(s, a, '2026-07-01', TODAY) === 130 * M && assetValueAt(s, a, TODAY, TODAY) === 120 * M ? true
    : JSON.stringify([assetValueAt(s, a, '2026-02-15', TODAY), assetValueAt(s, a, '2026-04-01', TODAY), assetValueAt(s, a, '2026-07-01', TODAY)]);
});
t('B4', 'Bảng cân đối đầu kỳ dựng lại: tài sản chưa mua / đã bán hết không có mặt; tổng nguồn vốn = tổng tài sản', () => {
  let s = st({ wallet: { availableCash: 10 * M, totalDeposited: 10 * M, totalWithdrawn: 0 }, assets: [stock({ purchaseDate: '2026-09-10' })] });
  s = ok(applySell(s, { assetId: 'fpt', unitPrice: 130000, received: 129 * M, date: '2026-10-15' }, uid, TODAY));
  const mid = calculateBalanceSheet(stateAt(s, '2026-10-01', TODAY), '2026-10-01');
  const before = stateAt(s, '2026-09-01', TODAY);
  const after = stateAt(s, '2026-10-31', TODAY);
  return mid.currentAssets.lines.find((l) => l.key === 'stock')!.value > 0 && before.assets.length === 0 && after.assets.length === 0 && mid.totalAssets === mid.totalLiabilitiesAndEquity ? true : JSON.stringify([before.assets.length, after.assets.length]);
});

// ============ Lưu chuyển tiền tệ ============
function scenario(): UserFinancialState {
  let s = st({ assets: [stock({ purchaseDate: '2026-09-01' })] });
  s = ok(applyDeposit(s, 800 * M, '2026-09-01', undefined, uid, TODAY));
  s = { ...s, transactions: [{ id: 'buy0', date: '2026-09-01', type: 'buy_asset', amount: 100 * M, title: 'Mua FPT', linkedAssetId: 'fpt' }, ...s.transactions], wallet: { ...s.wallet, availableCash: s.wallet.availableCash - 100 * M } };
  s = ok(applyDeposit(s, 200 * M, '2026-10-02', undefined, uid, TODAY));
  s = ok(applyWithdraw(s, 30 * M, '2026-10-03', undefined, uid, TODAY));
  s = ok(applyIncome(s, { type: 'dividend', assetId: 'fpt', amount: 5 * M, date: '2026-10-08' }, uid, TODAY));
  s = ok(applySell(s, { assetId: 'fpt', quantity: 400, unitPrice: 130000, received: 51_500_000, date: '2026-10-12' }, uid, TODAY));   // ghi nhận 52tr, phí 0,5tr, giá vốn 40tr
  s = { ...s, debts: [trackedDebt()] };
  s = ok(applyPayPeriod(s, { debtId: 'd1', periodIndex: 0, deductFromWallet: true, date: '2026-10-20' }, uid, '2026-10-20'));
  return s;
}
t('F1', 'Lưu chuyển tiền: thu nhập, đầu tư, tài chính đúng; tiền đầu kỳ + thay đổi = tiền cuối kỳ', () => {
  const s = scenario();
  const cf = cashFlowReport(s, P_OCT, TODAY);
  const pay = s.transactions.find((x) => x.type === 'debt_payment')!;
  return cf.operating.dividend === 5 * M && cf.operating.interestPaid === -(pay.interestPortion || 0) && cf.investing.sell === 51_500_000 && cf.investing.buy === 0 &&
    cf.financing.deposits === 200 * M && cf.financing.withdrawals === -30 * M && cf.financing.principalPaid === -(pay.principalPortion || 0) &&
    cf.opening === 700 * M && cf.opening + cf.net === cf.closing && cf.closing === s.wallet.availableCash ? true : JSON.stringify([cf.opening, cf.net, cf.closing, s.wallet.availableCash]);
});
t('F2', 'Giao dịch phi tiền mặt ghi riêng: tài sản thêm không trừ ví, khoản vay chỉ ghi nợ, trả nợ bằng tiền ngoài ví, kỳ trả không giao dịch', () => {
  let s = st({ wallet: { availableCash: 1000 * M, totalDeposited: 1000 * M, totalWithdrawn: 0 }, assets: [stock({ purchaseDate: '2026-10-05', initialCost: 100 * M })] });
  const loan: Debt = { ...trackedDebt(), id: 'dl', trackingStartDate: undefined, startDate: '2026-10-05', scheduleAnchorDate: undefined, principalAmount: 80 * M, remainingPrincipal: 80 * M, fundUse: { kind: 'asset', assetId: 'fpt' } };
  s = ok(applyAddDebt(s, { ...loan, schedule: generateAmortizationSchedule(80 * M, 9, 12, '2026-10-05', 5, 'declining_balance') }, {}, uid, TODAY));
  s = { ...s, debts: [...s.debts, trackedDebt()] };
  s = ok(applyPayPeriod(s, { debtId: 'd1', periodIndex: 0, deductFromWallet: false, date: '2026-10-20' }, uid, '2026-10-20'));
  const cf = cashFlowReport(s, P_OCT, TODAY);
  return cf.nonCash.assets.amount === 100 * M && cf.nonCash.loans.amount === 80 * M && cf.nonCash.unrecordedPayments.count === 1 && cf.nonCash.unrecordedPayments.principal > 0 && cf.net === 0 ? true : JSON.stringify(cf.nonCash);
});

// ============ Hoạt động kinh doanh ============
t('H1', 'Kết quả: thu nhập, lãi chốt trước phí, phí bán, chi phí lãi vay; lợi nhuận đã thực hiện = tổng các dòng', () => {
  const s = scenario();
  const pr = profitReport(s, P_OCT, TODAY);
  const pay = s.transactions.find((x) => x.type === 'debt_payment')!;
  const expectRealized = 5 * M + 12 * M - 500_000 - (pay.interestPortion || 0);
  return pr.income.dividend === 5 * M && pr.realizedBeforeFees === 12 * M && pr.saleFees === -500_000 && pr.interestExpense === -(pay.interestPortion || 0) && pr.otherFees === 0 &&
    pr.realizedProfit === expectRealized && pr.economicProfit === pr.realizedProfit + pr.unrealizedChange ? true : JSON.stringify(pr);
});
t('H2', 'Tất toán sớm có phí: phí và lãi thực tế vào kết quả; trả trước gốc không phải chi phí gốc', () => {
  let s = st({ wallet: { availableCash: 3000 * M, totalDeposited: 3000 * M, totalWithdrawn: 0 }, debts: [trackedDebt({ firstDueDate: '2026-11-20' })] });
  s = ok(applyPrepay(s, { debtId: 'd1', date: '2026-10-25', principal: 100 * M, fee: 1 * M, mode: 'reduce_payment', deductFromWallet: true }, uid, '2026-10-25'));
  const pre = s.transactions[0];
  const s2 = ok(applySettle(s, { debtId: 'd1', date: '2026-10-30', fee: 3 * M, actualPaid: s.debts[0].remainingPrincipal + 2 * M + 3 * M, deductFromWallet: true }, uid, '2026-10-30'));
  const pr = profitReport(s2, P_OCT, TODAY);
  return pr.otherFees === -(1 * M + 3 * M) && pr.interestExpense === -((pre.interestPortion || 0) + 2 * M) ? true : JSON.stringify([pr.otherFees, pr.interestExpense, pre.interestPortion]);
});
t('H3', 'Các lần bán cũ (thiếu giá vốn từng lần): không vào lãi chốt chi tiết, có dòng ước tính', () => {
  const a = stock({ status: 'sold', currentValue: 0, realizedPnL: 7 * M });
  const s = st({ assets: [a], wallet: { availableCash: 107 * M, totalDeposited: 100 * M, totalWithdrawn: 0 }, transactions: [{ id: 'old', date: '2026-10-10', type: 'sell_asset', amount: 107 * M, title: 'Bán cũ', linkedAssetId: 'fpt', fees: 0 }] });
  const pr = profitReport(s, P_OCT, TODAY);
  return pr.realizedBeforeFees === 0 && pr.legacyRealized.amount === 7 * M && pr.legacyRealized.count === 1 ? true : JSON.stringify(pr.legacyRealized);
});
t('H4', 'Chỉ số: tỷ suất lợi nhuận trên vốn chủ bình quân, tỷ suất thu nhập, hệ số bao phủ lãi vay', () => {
  const s = scenario();
  const pr = profitReport(s, P_OCT, TODAY);
  const avg = (pr.startEquity + pr.endEquity) / 2;
  return Math.abs((pr.ratios.equityReturn as number) - pr.economicProfit / avg) < 1e-9 && pr.ratios.incomeYield! > 0 && pr.ratios.interestCover !== null && pr.ratios.interestCover > 0 ? true : JSON.stringify(pr.ratios);
});

// ============ Đối soát ============
t('D1', 'Ba phép đối soát khớp trên kịch bản có nạp/rút, cổ tức, bán một phần, trả nợ', () => {
  const s = scenario();
  const r = reconcileReports(s, P_OCT, TODAY);
  return r.every((c) => c.ok) ? true : JSON.stringify(r.map((c) => [c.id, c.ok, c.diff]));
});
t('D2', 'Khớp cả khi có hủy bản ghi, tiết kiệm (nhận lãi, tái tục), tất toán, trả trước, đối chiếu sao kê, phi tiền mặt', () => {
  let s = scenario();
  const sav: Asset = { id: 'sv', name: 'Sổ', category: 'savings', initialCost: 100 * M, currentValue: 100 * M, purchaseDate: '2026-01-01', status: 'active', metadata: { bankName: 'B', depositAmount: 100 * M, termMonths: 9, annualInterestRate: 6, startDate: '2026-01-01', maturityDate: '2026-10-01', rolloverOption: 'principal_only' } as any, realizedPnL: 0, lastValuationDate: '2026-01-01' };
  s = { ...s, assets: [...s.assets, sav] };
  s = ok(applyRollover(s, { assetId: 'sv', date: '2026-10-02', interest: 4_500_000, capitalize: true, termMonths: 6, annualRate: 5.5 }, uid, TODAY));
  s = ok(applyIncome(s, { type: 'dividend', assetId: 'fpt', amount: 1 * M, date: '2026-10-22' }, uid, TODAY));
  s = ok(applyVoidTx(s, s.transactions.find((x) => x.type === 'dividend' && x.amount === 1 * M)!.id, uid, TODAY));
  s = ok(applyPrepay(s, { debtId: 'd1', date: '2026-10-25', principal: 50 * M, fee: 500_000, mode: 'shorten_term', deductFromWallet: true }, uid, '2026-10-25'));
  s = ok(applyReconcile(s, { debtId: 'd1', actual: s.debts[0].remainingPrincipal - 2 * M, date: '2026-10-27' }, uid, '2026-10-27'));
  const r = reconcileReports(s, P_OCT, TODAY);
  return r.every((c) => c.ok) ? true : JSON.stringify(r.map((c) => [c.id, c.ok, c.diff, c.parts]));
});
t('D3', 'Khi chưa khớp: đối soát báo "Chưa khớp" kèm nguyên nhân khả dĩ (khoản vay chưa xác định nơi dùng vốn)', () => {
  let s = scenario();
  s = { ...s, debts: s.debts.map((d) => ({ ...d, fundUse: { kind: 'unspecified' as const } })), wallet: { ...s.wallet } };
  const eq = reconcileReports(s, P_OCT, TODAY).find((c) => c.id === 'equity')!;
  // làm lệch dữ liệu: gốc + lãi + phí của một giao dịch trả nợ không còn bằng số tiền đã trả
  const broken = { ...s, transactions: s.transactions.map((x) => (x.type === 'debt_payment' ? { ...x, principalPortion: (x.principalPortion || 0) - 7 * M } : x)) };
  const eq2 = reconcileReports(broken, P_OCT, TODAY).find((c) => c.id === 'equity')!;
  return !eq2.ok && Math.abs(Math.abs(eq2.diff) - 7 * M) < 1 && eq2.causes.some((x) => /chưa xác định nơi dùng vốn/.test(x)) && eq.causes.length > 0 ? true : JSON.stringify([eq2.ok, eq2.diff, eq2.causes]);
});
t('D4', 'Dữ liệu mẫu: ba phép đối soát khớp với kỳ tháng, quý, năm', () => {
  const st0 = normalizeState(JSON.parse(JSON.stringify(createDemoState())))!;
  const bad: string[] = [];
  // Dữ liệu mẫu sinh theo ĐỒNG HỒ THẬT → kỳ và ngày đối soát cũng phải theo ngày thật (TODAY cố định làm test đỏ khi sang ngày mới)
  const NOW = todayLocalStr();
  const perNow = (kind: any, year: number, month = 1, quarter = 1) => buildPeriod({ kind, year, month, quarter }, NOW);
  for (const p of [perNow('month', 2026, 10), perNow('quarter', 2026, 3), perNow('year', 2026), perNow('month', 2026, 11)]) {
    for (const c of reconcileReports(st0, p, NOW)) if (!c.ok) bad.push(`${p.label}:${c.id}:${Math.round(c.diff)}`);
  }
  return bad.length === 0 ? true : bad.join(' | ');
});
t('D5', 'Bảng cân đối theo kỳ: cuối kỳ hiện tại = bảng cân đối hiện hành; đầu kỳ + thay đổi = cuối kỳ', () => {
  const s = scenario();
  const pb = periodBalance(s, per('month', 2026, 11), TODAY);
  const now = calculateBalanceSheet(s, TODAY);
  const pb2 = periodBalance(s, P_OCT, TODAY);
  return pb.end.totalAssets === now.totalAssets && pb.end.equity.total === now.equity.total && pb2.endGroups.equity - pb2.startGroups.equity === pb2.end.equity.total - pb2.start.equity.total ? true : JSON.stringify([pb.end.totalAssets, now.totalAssets]);
});

// ============ C6: ảnh chụp chi tiết ============
t('S1', 'Ảnh chụp chi tiết: lấy ảnh gần nhất không sau ngày, trong 7 ngày; không có thì null; nạp dữ liệu giữ nguyên nhóm', () => {
  const snaps = [
    { date: '2026-09-28', netWorth: 100, assets: 150, debts: 50, cash: 10, groups: { stock: 40, fund: 0, gold: 0, savings: 20, real_estate: 80, other: 0 }, debtShort: 10, debtLong: 40 },
    { date: '2026-10-15', netWorth: 120, assets: 170, debts: 50, cash: 12, groups: { stock: 50, fund: 0, gold: 0, savings: 20, real_estate: 88, other: 0 }, debtShort: 10, debtLong: 40 },
  ];
  const s: any = normalizeState({ schemaVersion: 3, wallet: { availableCash: 0, totalDeposited: 0, totalWithdrawn: 0 }, assets: [], debts: [], transactions: [], snapshots: snaps })!;
  const a = snapshotGroupsBefore(s, '2026-09-30'); const b = snapshotGroupsBefore(s, '2026-10-10'); const c = snapshotGroupsBefore(s, '2026-10-20');
  return a?.date === '2026-09-28' && a.groups.equity === 100 && a.groups.debtLong === 40 && b === null && c?.date === '2026-10-15' ? true : JSON.stringify([a, b, c]);
});

console.log(`\n==== phase4: ${pass} pass / ${fail} fail ====`);
process.exit(fail ? 1 : 0);
