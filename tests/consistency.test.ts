/**
 * Test giai đoạn 6: làm nhất quán dữ liệu và sửa lỗi nhỏ. Mỗi mục có test tái hiện lỗi (đỏ trên bản cũ).
 * Run: npx tsx tests/consistency.test.ts
 */
import { calculateFinancialSummary, isLiveTx, isOpenItem, recalculateFloatingDebt } from '../src/utils/calculations';
import { calculateBalanceSheet } from '../src/utils/balanceSheet';
import { buildTrackedDebt, firstOpenIndex } from '../src/utils/debtCore';
import { applySellAndSettle } from '../src/utils/debtOps';
import { previewSettlement } from '../src/utils/debtCore';
import { applySell, applyPayPeriod, applyVoidTx, canVoidTx, OpResult } from '../src/utils/ops';
import { buildPeriod, cashFlowReport, reconcileReports } from '../src/utils/reports';
import { applyPriceUpdates } from '../src/utils/priceSync';
import { findLocalLegacyData } from '../src/utils/storage';
import type { Asset, Debt, UserFinancialState } from '../src/types/finance';

let pass = 0, fail = 0;
function t(id: string, name: string, fn: () => true | string) {
  let r: true | string;
  try { r = fn(); } catch (e: any) { r = 'THROW ' + e.stack; }
  if (r === true) { pass++; console.log(`PASS ${id} ${name}`); } else { fail++; console.log(`FAIL ${id} ${name}\n       ${r}`); }
}
(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
let n = 0;
const uid = (p: string) => `${p}-${++n}`;
const M = 1_000_000;
const TODAY = '2026-11-10';
const st = (o: Partial<UserFinancialState> = {}): UserFinancialState => ({
  wallet: { availableCash: 1000 * M, totalDeposited: 1000 * M, totalWithdrawn: 0 }, assets: [], debts: [], transactions: [], ...o,
});
const ok = (r: OpResult): UserFinancialState => { if (!r.ok) throw new Error('op lỗi: ' + r.error); return r.state; };
const err = (r: OpResult): string => (r.ok ? '' : r.error);
const stock = (id: string, q = 100, o: Partial<Asset> = {}): Asset => ({
  id, name: id, category: 'stock', initialCost: q * 100_000, currentValue: q * 120_000, purchaseDate: '2026-01-01', status: 'active',
  metadata: { symbol: id.toUpperCase(), exchange: 'HOSE', quantity: q, avgCostPrice: 100_000, currentPrice: 120_000, totalDividendsReceived: 0 } as any,
  realizedPnL: 0, lastValuationDate: '2026-10-01', ...o,
});
const house = (o: Partial<Asset> = {}): Asset => ({
  id: 'h1', name: 'Nhà', category: 'real_estate', initialCost: 2000 * M, currentValue: 2200 * M, purchaseDate: '2026-01-01', status: 'active',
  metadata: { address: 'HN', propertyType: 'apartment', areaM2: 60, purchasePrice: 2000 * M, estimatedMarketPrice: 2200 * M, monthlyRentalIncome: 10 * M, legalStatus: 'red_book' } as any,
  realizedPnL: 0, lastValuationDate: '2026-10-01', ...o,
});
const carRent = (): Asset => ({
  id: 'c1', name: 'Xe cho thuê', category: 'other', initialCost: 600 * M, currentValue: 500 * M, purchaseDate: '2026-01-01', status: 'active',
  metadata: { itemType: 'Xe', details: '', monthlyRentalIncome: 3 * M } as any, realizedPnL: 0, lastValuationDate: '2026-10-01',
});
const base: any = { id: 'd1', name: 'Vay', lender: 'NH', category: 'mortgage', securityType: 'unsecured', fundUse: { kind: 'spent' } };
const tracked = (o: any = {}): Debt => buildTrackedDebt(base, { balance: 600 * M, periods: 12, firstDueDate: '2026-11-12', trackingStart: TODAY, paymentDay: 12, annualRate: 9, method: 'declining_balance', ...o }, TODAY);

// ---- Tiền thuê hằng tháng: một định nghĩa dùng chung
t('C1', 'Tiền thuê hằng tháng: Tổng quan và Bảng cân đối dùng chung một định nghĩa (nhà + tài sản khác có thu nhập định kỳ)', () => {
  const s = st({ assets: [house(), carRent()] });
  const a = calculateFinancialSummary(s).monthlyRentalIncome, b = calculateBalanceSheet(s, TODAY).ratios.monthlyRentalIncome;
  return a === 13 * M && b === 13 * M ? true : JSON.stringify([a, b]);
});

// ---- Ngày định giá tách khỏi ngày thao tác
t('C2', 'Bán một phần cổ phiếu không đổi ngày định giá: giá đóng cửa của ngày trước đó vẫn áp được (không bị "bạn đã định giá mới hơn")', () => {
  const s0 = st({ assets: [stock('fpt')], transactions: [{ id: 'b', date: '2026-01-01', type: 'buy_asset', amount: 10 * M, title: 'Mua', linkedAssetId: 'fpt' }] });
  const s1 = ok(applySell(s0, { assetId: 'fpt', quantity: 40, unitPrice: 125_000, received: 4_950_000, date: '2026-11-09' }, uid, TODAY));
  const res = applyPriceUpdates(s1, [{ assetId: 'fpt', unitPrice: 124_000, date: '2026-11-06' }], TODAY);
  return s1.assets[0].lastValuationDate === '2026-10-01' && res.applied.length === 1 ? true : JSON.stringify([s1.assets[0].lastValuationDate, res.skipped]);
});

// ---- Trả kỳ nợ không trừ ví
t('C3', 'Trả kỳ nợ bằng tiền ngoài ví (deductFromWallet = false): vẫn ghi giao dịch noCash, ví không đổi, báo cáo ghi nhận khoản trả ngoài ví, hủy được', () => {
  const s0 = st({ debts: [tracked()] });
  const s = ok(applyPayPeriod(s0, { debtId: 'd1', periodIndex: 0, deductFromWallet: false, date: '2026-11-12' }, uid, '2026-11-12'));
  const tx = s.transactions.find((x) => x.type === 'debt_payment');
  const cf = cashFlowReport(s, buildPeriod({ kind: 'month', year: 2026, month: 11, quarter: 4 }, '2026-11-30'), '2026-11-30');
  const back = ok(applyVoidTx(s, tx!.id, uid, '2026-11-13'));
  return !!tx && tx.noCash === true && tx.principalPortion! > 0 && s.wallet.availableCash === s0.wallet.availableCash && cf.nonCash.externalPayments.amount === tx.amount && back.debts[0].schedule![0].isPaid === false ? true : JSON.stringify([tx, cf.nonCash.externalPayments]);
});

// ---- Kiểm tra kỳ chưa trả
t('C4', 'Kỳ chưa trả đầu tiên tính theo kỳ còn mở (bỏ qua kỳ đã hủy), giống mọi nơi khác', () => {
  const d = tracked();
  const sch = d.schedule!.map((it, i) => (i === 0 ? { ...it, isPaid: true, paidDate: '2026-11-12' } : i >= 2 ? { ...it, status: 'cancelled' as const } : it));
  const dd: Debt = { ...d, schedule: sch };
  const i1 = firstOpenIndex(dd);
  const sch2 = sch.map((it, i) => (i === 1 ? { ...it, isPaid: true, paidDate: '2026-12-12' } : it));
  const i2 = firstOpenIndex({ ...dd, schedule: sch2 });
  return i1 === 1 && i2 === -1 && dd.schedule!.findIndex((i) => !i.isPaid) === 1 && sch2.findIndex((i) => !i.isPaid) === 2 ? true : JSON.stringify([i1, i2]);
});

// ---- recalculateFloatingDebt: không đếm kỳ đã hủy
t('C5', 'recalculateFloatingDebt không đếm kỳ đã hủy là kỳ còn lại: tổng gốc kỳ mở = dư nợ, kỳ đã hủy giữ nguyên', () => {
  const d = tracked();
  const cancelled = d.schedule!.map((it, i) => (i >= 6 ? { ...it, status: 'cancelled' as const, principalPayable: 0, interestPayable: 0, totalMonthlyPayment: 0, remainingBalance: 0 } : it));
  const dd: Debt = { ...d, schedule: cancelled, tenorMonths: 6 };
  const r = recalculateFloatingDebt(dd, 12, undefined, undefined, undefined);
  const openSum = r.schedule!.filter(isOpenItem).reduce((s, i) => s + i.principalPayable, 0);
  const cancelledSame = r.schedule!.slice(6).every((it, k) => it.status === 'cancelled' && it.totalMonthlyPayment === 0 && it.dueDate === cancelled[6 + k].dueDate);
  return r.schedule!.filter(isOpenItem).length === 6 && Math.abs(openSum - dd.remainingPrincipal) <= 1 && cancelledSame ? true : JSON.stringify([r.schedule!.filter(isOpenItem).length, openSum, dd.remainingPrincipal]);
});

// ---- Thứ tự hủy theo thời điểm ghi nhận
t('C6', 'Hủy giao dịch theo thứ tự GHI NHẬN, không theo ngày giao dịch: lần bán nhập bù ngày cũ (ghi sau) hủy được trước, lần ghi trước phải chờ', () => {
  const s0 = st({ assets: [stock('fpt')], transactions: [{ id: 'b', date: '2026-01-01', type: 'buy_asset', amount: 10 * M, title: 'Mua', linkedAssetId: 'fpt' }] });
  const a = ok(applySell(s0, { assetId: 'fpt', quantity: 20, unitPrice: 130_000, received: 2_600_000, date: '2026-10-20' }, uid, TODAY)); // ghi trước, ngày mới
  const b = ok(applySell(a, { assetId: 'fpt', quantity: 10, unitPrice: 125_000, received: 1_250_000, date: '2026-10-10' }, uid, TODAY)); // ghi sau, ngày cũ hơn
  const sells = b.transactions.filter((x) => x.type === 'sell_asset' && isLiveTx(x));
  const byDate = (d: string) => sells.find((x) => x.date === d)!;
  const newestRecorded = canVoidTx(b, byDate('2026-10-10').id);
  const oldestRecorded = canVoidTx(b, byDate('2026-10-20').id);
  return newestRecorded.ok && !oldestRecorded.ok ? true : JSON.stringify([newestRecorded, oldestRecorded]);
});

// ---- Dữ liệu cũ trên trình duyệt
t('C7', 'Dữ liệu cũ trên trình duyệt: chỉ đọc đúng khóa gốc cũ, không đọc khóa của tài khoản khác trên cùng máy', () => {
  const good = JSON.stringify({ wallet: { availableCash: 5, totalDeposited: 5, totalWithdrawn: 0 }, assets: [stock('own')], debts: [], transactions: [] });
  const other = JSON.stringify({ wallet: { availableCash: 9, totalDeposited: 9, totalWithdrawn: 0 }, assets: [stock('x1'), stock('x2'), stock('x3')], debts: [], transactions: [] });
  const store: Record<string, string> = { fintrack_vn_portfolio_v1: good, fintrack_vn_portfolio_v1_user_other: other, fintrack_vn_portfolio_v1_backup: other };
  (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem() {}, removeItem() {}, key: (i: number) => Object.keys(store)[i] ?? null, get length() { return Object.keys(store).length; } };
  const found = findLocalLegacyData();
  const none = (() => { delete store.fintrack_vn_portfolio_v1; return findLocalLegacyData(); })();
  (globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
  return found && found.assets.length === 1 && found.assets[0].id === 'own' && none === null ? true : JSON.stringify([found?.assets.map((a) => a.id), none]);
});

// ---- Ghi chú phép đối soát
t('C8', 'Phép đối soát số 2 ghi rõ: báo khớp chỉ cho thấy số cộng được với nhau; số đầu kỳ là ước tính suy ngược từ hiện tại', () => {
  const s = st({ assets: [stock('fpt')] });
  const checks = reconcileReports(s, buildPeriod({ kind: 'month', year: 2026, month: 10, quarter: 4 }, TODAY), TODAY);
  const eq = checks.find((c) => c.id === 'equity')!;
  const notes = (eq.notes || []).join(' | ');
  return /chưa chứng minh/.test(notes) && /ước tính/.test(notes) ? true : notes;
});

// ---- Bán tài sản đang thế chấp: dùng tiền bán tất toán khoản vay
const mortgaged = (): UserFinancialState => {
  const asset = house({ linkedDebtId: 'd1' });
  const debt: Debt = { ...tracked({ balance: 600 * M }), collateralAssetId: 'h1', securityType: 'secured', fundUse: { kind: 'asset', assetId: 'h1' } };
  return st({ assets: [asset], debts: [debt], wallet: { availableCash: 10 * M, totalDeposited: 2010 * M, totalWithdrawn: 0 }, transactions: [{ id: 'b', date: '2026-01-01', type: 'buy_asset', amount: 2000 * M, title: 'Mua', linkedAssetId: 'h1' }] });
};
t('C9', 'Bán tài sản thế chấp và dùng tiền bán tất toán khoản vay liên kết: một thao tác, ví = tiền bán − tiền tất toán, khoản vay đóng, tài sản đã bán', () => {
  const s0 = mortgaged();
  const pv = previewSettlement(s0.debts[0], '2026-11-10', TODAY);
  const r = ok(applySellAndSettle(s0, { assetId: 'h1', recognizedValue: 2200 * M, received: 2150 * M, date: '2026-11-10' } as any, { settle: true, fee: 0 }, uid, TODAY));
  const payoff = r.transactions.find((x) => x.type === 'debt_payment' && x.settlement)!;
  return r.assets[0].status === 'sold' && r.debts[0].status !== 'active' && payoff && r.wallet.availableCash === 10 * M + 2150 * M - payoff.amount && payoff.amount >= 600 * M && !!pv ? true : JSON.stringify([r.assets[0].status, r.debts[0].status, r.wallet]);
});
t('C10', 'Bán + tất toán nguyên tử: tiền bán không đủ trả nợ → lỗi rõ ràng, không bán gì, không tất toán gì', () => {
  const s0 = mortgaged();
  const snap = JSON.stringify(s0);
  const r = applySellAndSettle(s0, { assetId: 'h1', recognizedValue: 2200 * M, received: 100 * M, date: '2026-11-10' } as any, { settle: true, fee: 0 }, uid, TODAY);
  return !r.ok && JSON.stringify(s0) === snap && /không đủ/i.test(r.ok ? '' : r.error) ? true : JSON.stringify(r);
});
t('C11', 'Bán tài sản thế chấp không chọn tất toán: như cũ (khoản vay giữ nguyên, chỉ cảnh báo ở giao diện)', () => {
  const s0 = mortgaged();
  const r = ok(applySellAndSettle(s0, { assetId: 'h1', recognizedValue: 2200 * M, received: 2150 * M, date: '2026-11-10' } as any, { settle: false, fee: 0 }, uid, TODAY));
  return r.assets[0].status === 'sold' && r.debts[0].status === 'active' && r.wallet.availableCash === 10 * M + 2150 * M ? true : JSON.stringify(r.debts[0].status);
});

console.log(`\n==== consistency: ${pass} pass / ${fail} fail ====`);
process.exit(fail ? 1 : 0);
