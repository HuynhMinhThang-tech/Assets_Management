/**
 * Test giai đoạn 2: C1 (ngày giao dịch), R1 (bán theo giá + thực nhận), R4 (nơi dùng vốn),
 * R7 + C2 (hủy bản ghi nhập nhầm bằng bút toán đảo), C5 (nâng cấp dữ liệu cũ).
 * Run: npx tsx tests/phase2.test.ts
 */
import { calculateFinancialSummary, generateAmortizationSchedule } from '../src/utils/calculations';
import { buildMonthEvents } from '../src/utils/calendar';
import { liveTransactions, sortLedger, txEffect } from '../src/utils/ledger';
import { normalizeState, SCHEMA_VERSION } from '../src/utils/storage';
import {
  applyAddDebt, applyDeposit, applyIncome, applyPayPeriod, applySell, applySetFundUse, applyVoidAsset, applyVoidDebt, applyVoidTx,
  canVoidAsset, canVoidDebt, canVoidTx, checkTxDate, previewSell, OpResult,
} from '../src/utils/ops';
import type { Asset, CashTransaction, Debt, UserFinancialState } from '../src/types/finance';

let pass = 0, fail = 0;
function t(id: string, name: string, fn: () => true | string) {
  let r: true | string;
  try { r = fn(); } catch (e: any) { r = 'THROW ' + e.stack; }
  if (r === true) { pass++; console.log(`PASS ${id} ${name}`); } else { fail++; console.log(`FAIL ${id} ${name}\n       ${r}`); }
}
(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const TODAY = '2026-10-30';
let n = 0;
const uid = (p: string) => `${p}-${++n}`;
const M = 1_000_000;
const st = (o: Partial<UserFinancialState> = {}): UserFinancialState => ({
  wallet: { availableCash: 100 * M, totalDeposited: 100 * M, totalWithdrawn: 0 }, assets: [], debts: [], transactions: [], ...o,
});
const stock = (o: Partial<Asset> = {}): Asset => ({
  id: 'fpt', name: 'FPT', category: 'stock', initialCost: 100_000, currentValue: 120_000, purchaseDate: '2026-01-10', status: 'active',
  metadata: { symbol: 'FPT', exchange: 'HOSE', quantity: 10, avgCostPrice: 10_000, currentPrice: 12_000, totalDividendsReceived: 0 } as any,
  realizedPnL: 0, lastValuationDate: '2026-01-10', ...o,
});
const ok = (r: OpResult): UserFinancialState => { if (!r.ok) throw new Error('op lỗi: ' + r.error); return r.state; };
const err = (r: OpResult): string => (r.ok ? '' : r.error);
const sum = (txs: CashTransaction[]) => txs.reduce((s, x) => s + txEffect(x), 0);
const debtOf = (paid: number, start = '2026-01-10', status: Debt['status'] = 'active'): Debt => {
  const schedule = generateAmortizationSchedule(120 * M, 12, 12, start, 10, 'declining_balance').map((it, i) => (i < paid ? { ...it, isPaid: true, paidDate: it.dueDate } : it));
  return { id: 'd1', name: 'Vay A', lender: 'NH', category: 'consumer_loan', securityType: 'unsecured', principalAmount: 120 * M,
    remainingPrincipal: paid ? schedule[paid - 1].remainingBalance : 120 * M, annualInterestRate: 12, rateType: 'fixed', tenorMonths: 12,
    startDate: start, paymentDayOfMonth: 10, method: 'declining_balance', status, schedule, fundUse: { kind: 'spent' } };
};

// ============ C1: ngày giao dịch ============
t('C1a', 'checkTxDate: tương lai / trước mốc / sai định dạng bị chặn, hợp lệ thì qua', () => {
  return checkTxDate('2026-10-31', undefined, TODAY) !== '' && checkTxDate('2026-01-01', '2026-02-01', TODAY) !== '' &&
    checkTxDate('', undefined, TODAY) !== '' && checkTxDate('2026-10-30', '2026-01-01', TODAY) === '' ? true : 'sai';
});
t('C1b', 'Nạp tiền có ngày chọn: chèn đúng vị trí theo ngày, cùng ngày thì dòng mới đứng trước', () => {
  let s = st({ transactions: [
    { id: 'a', date: '2026-10-20', type: 'deposit', amount: 1, title: 'a' }, { id: 'b', date: '2026-10-05', type: 'deposit', amount: 1, title: 'b' } ] });
  s = ok(applyDeposit(s, 5 * M, '2026-10-10', undefined, uid, TODAY));
  s = ok(applyDeposit(s, 6 * M, '2026-10-10', undefined, uid, TODAY));
  const ids = s.transactions.map((x) => x.id + ':' + x.date + ':' + x.amount);
  return s.transactions.map((x) => x.date).join() === '2026-10-20,2026-10-10,2026-10-10,2026-10-05' && s.transactions[1].amount === 6 * M
    ? true : ids.join(' | ');
});
t('C1c', 'Thu nhập: không sớm hơn ngày mua tài sản, không tương lai', () => {
  const s = st({ assets: [stock()] });
  return err(applyIncome(s, { type: 'dividend', assetId: 'fpt', amount: 1000, date: '2026-01-09' }, uid, TODAY)) !== '' &&
    err(applyIncome(s, { type: 'dividend', assetId: 'fpt', amount: 1000, date: '2026-11-01' }, uid, TODAY)) !== '' &&
    ok(applyIncome(s, { type: 'dividend', assetId: 'fpt', amount: 1000, date: '2026-03-01' }, uid, TODAY)).wallet.availableCash === 100 * M + 1000 ? true : 'sai';
});
t('C1d', 'sortLedger ổn định: ngày giảm dần, cùng ngày giữ thứ tự', () => {
  const l = sortLedger([{ id: '1', date: '2026-03-01' }, { id: '2', date: '2026-05-01' }, { id: '3', date: '2026-03-01' }] as any);
  return l.map((x) => x.id).join() === '2,1,3' ? true : l.map((x) => x.id).join();
});

// ============ R1: bán ============
t('R1a', 'Ví dụ: 10 cổ phiếu, vốn 100.000, bán 13.000/CP, thực nhận 125.000 → ghi nhận 130.000, phí 5.000, lãi chốt 25.000', () => {
  const a = stock();
  const pv = previewSell(a, { unitPrice: 13_000, received: 125_000 });
  if (typeof pv === 'string') return pv;
  const s = ok(applySell(st({ assets: [a] }), { assetId: 'fpt', unitPrice: 13_000, received: 125_000, date: '2026-10-20' }, uid, TODAY));
  const tx = s.transactions[0]; const as = s.assets[0];
  return pv.recognized === 130_000 && pv.fees === 5_000 && pv.bookPnL === 30_000 && pv.realizedPnL === 25_000 &&
    tx.amount === 125_000 && tx.recognizedValue === 130_000 && tx.fees === 5_000 && tx.costBasisSold === 100_000 && tx.realizedPnL === 25_000 && tx.quantity === 10 && tx.date === '2026-10-20' &&
    s.wallet.availableCash === 100 * M + 125_000 && as.status === 'sold' && as.currentValue === 0 && as.realizedPnL === 25_000 ? true : JSON.stringify([pv, tx]);
});
t('R1b', 'Bán một phần 4/10: giá vốn và thị giá giảm theo tỷ lệ, còn 6 CP', () => {
  const s = ok(applySell(st({ assets: [stock()] }), { assetId: 'fpt', quantity: 4, unitPrice: 13_000, received: 51_000, date: '2026-10-20' }, uid, TODAY));
  const a = s.assets[0] as any; const tx = s.transactions[0];
  return a.status === 'active' && a.metadata.quantity === 6 && a.initialCost === 60_000 && a.currentValue === 72_000 && a.realizedPnL === 11_000 &&
    tx.costBasisSold === 40_000 && tx.valueSold === 48_000 && tx.fees === 1_000 && tx.soldOut === false ? true : JSON.stringify([a, tx]);
});
t('R1c', 'Tùy chọn "cập nhật giá phần còn lại theo giá bán": 6 CP × 13.000 = 78.000 + ghi lịch sử định giá', () => {
  const s = ok(applySell(st({ assets: [stock()] }), { assetId: 'fpt', quantity: 4, unitPrice: 13_000, received: 51_000, date: '2026-10-20', repriceRemainder: true }, uid, TODAY));
  const a = s.assets[0] as any;
  return a.currentValue === 78_000 && a.metadata.currentPrice === 13_000 && a.valuationHistory?.slice(-1)[0].unitPrice === 13_000 ? true : JSON.stringify(a);
});
t('R1d', 'Đầu vào sai bị từ chối: quá số lượng, giá 0, thực nhận 0, ngày tương lai / trước ngày mua', () => {
  const base = st({ assets: [stock()] });
  const bad = [
    { quantity: 11, unitPrice: 1, received: 1, date: '2026-10-20' }, { unitPrice: 0, received: 1, date: '2026-10-20' },
    { unitPrice: 13_000, received: 0, date: '2026-10-20' }, { unitPrice: 13_000, received: 1, date: '2026-11-02' }, { unitPrice: 13_000, received: 1, date: '2026-01-01' },
  ];
  const res = bad.map((b) => err(applySell(base, { assetId: 'fpt', ...b }, uid, TODAY)));
  return res.every((x) => x !== '') ? true : JSON.stringify(res);
});
t('R1e', 'Thực nhận > giá trị ghi nhận: vẫn tính được (phí âm), UI sẽ hỏi xác nhận', () => {
  const pv = previewSell(stock(), { unitPrice: 13_000, received: 131_000 });
  return typeof pv !== 'string' && pv.fees === -1_000 ? true : JSON.stringify(pv);
});
t('R1f', 'Bất động sản / tài sản không có đơn vị: nhập giá ghi nhận, bán toàn bộ', () => {
  const re: Asset = { id: 're', name: 'Căn hộ', category: 'real_estate', initialCost: 2000 * M, currentValue: 2500 * M, purchaseDate: '2025-01-01', status: 'active',
    metadata: { areaM2: 60, estimatedMarketPrice: 2500 * M } as any, realizedPnL: 0, lastValuationDate: '2026-01-01' };
  const s = ok(applySell(st({ assets: [re] }), { assetId: 're', recognizedValue: 2600 * M, received: 2550 * M, date: '2026-10-01' }, uid, TODAY));
  const tx = s.transactions[0];
  return s.assets[0].status === 'sold' && tx.fees === 50 * M && tx.realizedPnL === 550 * M && tx.quantity === undefined && s.wallet.availableCash === 100 * M + 2550 * M ? true : JSON.stringify(tx);
});

// ============ C2: hủy bằng bút toán đảo ============
t('C2a', 'Hủy lần nạp: ví và tổng vốn nạp hoàn lại, dòng gốc "đã hủy" + bút toán đảo; hai dòng triệt tiêu', () => {
  let s = ok(applyDeposit(st(), 30 * M, '2026-10-10', undefined, uid, TODAY));
  const id = s.transactions[0].id;
  const before = { cash: s.wallet.availableCash, dep: s.wallet.totalDeposited };
  s = ok(applyVoidTx(s, id, uid, TODAY));
  const orig = s.transactions.find((x) => x.id === id)!; const rev = s.transactions.find((x) => x.reversalOf === id)!;
  return s.wallet.availableCash === before.cash - 30 * M && s.wallet.totalDeposited === before.dep - 30 * M && orig.status === 'voided' && orig.voidedBy === rev.id &&
    rev.date === orig.date && txEffect(orig) + txEffect(rev) === 0 && liveTransactions(s.transactions).every((x) => x.id !== id && x.id !== rev.id) ? true : JSON.stringify([orig, rev]);
});
t('C2b', 'Không hủy được nạp tiền khi ví không đủ để hoàn lại; không hủy hai lần; không hủy bút toán đảo', () => {
  let s = ok(applyDeposit(st({ wallet: { availableCash: 0, totalDeposited: 0, totalWithdrawn: 0 } }), 30 * M, '2026-10-10', undefined, uid, TODAY));
  const id = s.transactions[0].id;
  s = { ...s, wallet: { ...s.wallet, availableCash: 10 * M } };
  const blocked = canVoidTx(s, id);
  s = { ...s, wallet: { ...s.wallet, availableCash: 40 * M } };
  s = ok(applyVoidTx(s, id, uid, TODAY));
  const again = canVoidTx(s, id); const revId = s.transactions.find((x) => x.reversalOf)!.id; const revCheck = canVoidTx(s, revId);
  return !blocked.ok && !again.ok && !revCheck.ok ? true : JSON.stringify([blocked, again, revCheck]);
});
t('C2c', 'Hủy lần bán một phần: số lượng, giá vốn, thị giá, lãi chốt và ví trở về đúng như trước khi bán', () => {
  const s0 = st({ assets: [stock()] });
  const sold = ok(applySell(s0, { assetId: 'fpt', quantity: 4, unitPrice: 13_000, received: 51_000, date: '2026-10-20' }, uid, TODAY));
  const back = ok(applyVoidTx(sold, sold.transactions[0].id, uid, TODAY));
  const a = back.assets[0] as any; const o = s0.assets[0] as any;
  return a.metadata.quantity === o.metadata.quantity && a.initialCost === o.initialCost && a.currentValue === o.currentValue && a.realizedPnL === 0 &&
    back.wallet.availableCash === s0.wallet.availableCash && a.status === 'active' ? true : JSON.stringify(a);
});
t('C2d', 'Hủy lần bán hết: tài sản trở lại "đang giữ"', () => {
  const s0 = st({ assets: [stock()] });
  const sold = ok(applySell(s0, { assetId: 'fpt', unitPrice: 13_000, received: 125_000, date: '2026-10-20' }, uid, TODAY));
  const back = ok(applyVoidTx(sold, sold.transactions[0].id, uid, TODAY));
  const a = back.assets[0];
  return a.status === 'active' && a.currentValue === 120_000 && a.initialCost === 100_000 && a.realizedPnL === 0 && back.wallet.availableCash === 100 * M ? true : JSON.stringify(a);
});
t('C2e', 'Hủy từ mới nhất trở về trước: lần bán cũ bị chặn đến khi hủy lần bán mới hơn', () => {
  let s = st({ assets: [stock()] });
  s = ok(applySell(s, { assetId: 'fpt', quantity: 3, unitPrice: 13_000, received: 38_000, date: '2026-10-10' }, uid, TODAY));
  const first = s.transactions[0].id;
  s = ok(applySell(s, { assetId: 'fpt', quantity: 2, unitPrice: 14_000, received: 27_000, date: '2026-10-20' }, uid, TODAY));
  const second = s.transactions[0].id;
  const c1 = canVoidTx(s, first);
  s = ok(applyVoidTx(s, second, uid, TODAY));
  const c2 = canVoidTx(s, first);
  s = ok(applyVoidTx(s, first, uid, TODAY));
  const a = s.assets[0] as any;
  return !c1.ok && c2.ok && a.metadata.quantity === 10 && a.initialCost === 100_000 && a.realizedPnL === 0 ? true : JSON.stringify([c1, c2, a]);
});
t('C2f', 'Hủy kỳ nợ đã trả: kỳ trở lại chưa trả, dư nợ + ví hoàn lại, khoản đã tất toán sống lại; chỉ hủy kỳ mới nhất', () => {
  let s = st({ debts: [debtOf(8)] });
  const d0 = s.debts[0];
  s = ok(applyPayPeriod(s, { debtId: 'd1', periodIndex: 8, deductFromWallet: true, date: '2026-10-05' }, uid, TODAY));
  const tx9 = s.transactions[0];
  s = ok(applyPayPeriod(s, { debtId: 'd1', periodIndex: 9, deductFromWallet: true, date: '2026-11-02' }, uid, '2026-11-02'));
  const tx10 = s.transactions[0];
  const blocked = canVoidTx(s, tx9.id);
  s = ok(applyVoidTx(s, tx10.id, uid, TODAY));
  s = ok(applyVoidTx(s, tx9.id, uid, TODAY));
  const d = s.debts[0];
  return !blocked.ok && tx9.periodIndex === 8 && d.schedule![8].isPaid === false && d.schedule![8].paidDate === undefined && d.remainingPrincipal === d0.remainingPrincipal &&
    s.wallet.availableCash === 100 * M && d.status === 'active' ? true : JSON.stringify([blocked, d.remainingPrincipal, d0.remainingPrincipal, s.wallet]);
});
t('C2g', 'Hủy kỳ cuối của khoản đã tất toán → khoản vay trở lại "đang vay"', () => {
  let s = st({ debts: [debtOf(11)] });
  s = ok(applyPayPeriod(s, { debtId: 'd1', periodIndex: 11, deductFromWallet: true, date: '2027-01-05' }, uid, '2027-01-05'));
  const was = s.debts[0].status;
  s = ok(applyVoidTx(s, s.transactions[0].id, uid, '2027-01-06'));
  return was === 'paid_off' && s.debts[0].status === 'active' && s.debts[0].remainingPrincipal > 0 ? true : JSON.stringify([was, s.debts[0].status]);
});
t('C2h', 'Hủy cổ tức cổ phiếu: giảm tổng cổ tức đã nhận và ví', () => {
  let s = ok(applyIncome(st({ assets: [stock()] }), { type: 'dividend', assetId: 'fpt', amount: 5000, date: '2026-05-01' }, uid, TODAY));
  s = ok(applyVoidTx(s, s.transactions[0].id, uid, TODAY));
  return (s.assets[0].metadata as any).totalDividendsReceived === 0 && s.wallet.availableCash === 100 * M ? true : 'sai';
});
t('C2i', 'Hủy tài sản nhập nhầm: hoàn tiền mua về ví; bị chặn nếu đã bán/có cổ tức hoặc đang liên kết khoản vay', () => {
  const buy: CashTransaction = { id: 'b1', date: '2026-01-10', type: 'buy_asset', amount: 100_000, title: 'Mua FPT', linkedAssetId: 'fpt' };
  const base = st({ wallet: { availableCash: 50 * M, totalDeposited: 50 * M, totalWithdrawn: 0 }, assets: [stock()], transactions: [buy] });
  const s = ok(applyVoidAsset(base, 'fpt', uid, TODAY));
  const withSale = ok(applySell(base, { assetId: 'fpt', unitPrice: 13_000, received: 125_000, date: '2026-10-20' }, uid, TODAY));
  const linked = { ...base, assets: [{ ...stock(), linkedDebtId: 'd1' }], debts: [debtOf(0)] };
  return s.assets[0].status === 'voided' && s.wallet.availableCash === 50 * M + 100_000 && s.transactions.some((x) => x.reversalOf === 'b1') &&
    !canVoidAsset(withSale, 'fpt').ok && !canVoidAsset(linked, 'fpt').ok && !canVoidAsset(s, 'fpt').ok ? true : JSON.stringify([s.wallet, canVoidAsset(withSale, 'fpt'), canVoidAsset(linked, 'fpt')]);
});
t('C2j', 'Hủy khoản vay nhập nhầm: hoàn giải ngân; bị chặn khi đã có kỳ trả; gỡ liên kết ở tài sản', () => {
  const dis: CashTransaction = { id: 'l1', date: '2026-10-01', type: 'loan_disbursement', amount: 120 * M, title: 'Giải ngân', linkedDebtId: 'd1' };
  const base = st({ wallet: { availableCash: 200 * M, totalDeposited: 80 * M, totalWithdrawn: 0 }, debts: [debtOf(0, '2026-10-01')], transactions: [dis], assets: [{ ...stock(), linkedDebtId: 'd1' }] });
  const s = ok(applyVoidDebt(base, 'd1', uid, TODAY));
  const paid = ok(applyPayPeriod({ ...base, debts: [debtOf(0, '2026-09-01')] }, { debtId: 'd1', periodIndex: 0, deductFromWallet: true, date: '2026-10-05' }, uid, TODAY));
  const poor = { ...base, wallet: { ...base.wallet, availableCash: 10 * M } };
  return s.debts[0].status === 'voided' && s.wallet.availableCash === 80 * M && s.assets[0].linkedDebtId === undefined &&
    !canVoidDebt(paid, 'd1').ok && !canVoidDebt(poor, 'd1').ok && !canVoidDebt(s, 'd1').ok ? true : JSON.stringify([s.wallet, canVoidDebt(paid, 'd1')]);
});
t('C2k', 'Bản ghi đã hủy không tính vào tài sản ròng, thống kê thu nhập/lãi vay và lịch', () => {
  let s = ok(applyIncome(st({ assets: [stock()] }), { type: 'dividend', assetId: 'fpt', amount: 5000, date: '2026-10-05' }, uid, TODAY));
  const sum0 = calculateFinancialSummary(s);
  s = ok(applyVoidTx(s, s.transactions[0].id, uid, TODAY));
  const sum1 = calculateFinancialSummary(s);
  const ev = buildMonthEvents(s, 2026, 10, TODAY).filter((e) => e.kind === 'income_received');
  const gone = ok(applyVoidAsset(st({ assets: [stock()] }), 'fpt', uid, TODAY));
  const sg = calculateFinancialSummary(gone);
  return sum0.totalRealizedPnL === 5000 && sum1.totalRealizedPnL === 0 && ev.length === 0 && sg.totalAssetValue === 0 && sg.netWorth === 100 * M ? true : JSON.stringify([sum0.totalRealizedPnL, sum1.totalRealizedPnL, ev.length, sg.totalAssetValue]);
});
t('C2l', 'Số dư ví luôn khớp tổng ảnh hưởng của sổ (kể cả dòng đã hủy + bút toán đảo)', () => {
  let s = st({ wallet: { availableCash: 0, totalDeposited: 0, totalWithdrawn: 0 }, assets: [stock()] });
  s = ok(applyDeposit(s, 50 * M, '2026-09-01', undefined, uid, TODAY));
  s = ok(applyDeposit(s, 7 * M, '2026-09-15', undefined, uid, TODAY));
  s = ok(applySell(s, { assetId: 'fpt', quantity: 4, unitPrice: 13_000, received: 51_000, date: '2026-10-20' }, uid, TODAY));
  s = ok(applyVoidTx(s, s.transactions.find((x) => x.type === 'deposit' && x.amount === 7 * M)!.id, uid, TODAY));
  return sum(s.transactions) === s.wallet.availableCash && s.wallet.availableCash === 50 * M + 51_000 ? true : `${sum(s.transactions)} vs ${s.wallet.availableCash}`;
});

// ============ R4: nơi dùng vốn ============
t('R4a', 'Thêm khoản vay phải có nơi dùng vốn', () => {
  const d = { ...debtOf(0, '2026-10-01'), fundUse: undefined };
  const r1 = err(applyAddDebt(st(), d, {}, uid, TODAY)); const r2 = err(applyAddDebt(st(), { ...d, fundUse: { kind: 'unspecified' } }, {}, uid, TODAY));
  return r1 !== '' && r2 !== '' ? true : 'chưa chặn';
});
t('R4b', 'Vào ví + giải ngân: cộng ví và ghi dòng giải ngân; không chọn giải ngân: ví không đổi (chỉ ghi nợ)', () => {
  const d = { ...debtOf(0, '2026-10-01'), fundUse: { kind: 'wallet' as const } };
  const a = ok(applyAddDebt(st(), d, { disburseToWallet: true }, uid, TODAY));
  const b = ok(applyAddDebt(st(), d, { disburseToWallet: false }, uid, TODAY));
  return a.wallet.availableCash === 220 * M && a.transactions[0].type === 'loan_disbursement' && a.debts[0].fundUse?.cashRecorded === true &&
    b.wallet.availableCash === 100 * M && b.transactions.length === 0 && b.debts[0].fundUse?.cashRecorded === undefined ? true : JSON.stringify([a.wallet, b.wallet]);
});
t('R4c', 'Mua tài sản: gắn vào tài sản có sẵn (đặt linkedDebtId); tài sản đã gắn khoản vay khác bị từ chối; chi tiêu: không đụng ví', () => {
  const d = { ...debtOf(0, '2026-10-01'), fundUse: { kind: 'asset' as const, assetId: 'fpt' } };
  const a = ok(applyAddDebt(st({ assets: [stock()] }), d, {}, uid, TODAY));
  const taken = st({ assets: [{ ...stock(), linkedDebtId: 'other' }], debts: [{ ...debtOf(0), id: 'other' }] });
  const e = err(applyAddDebt(taken, d, {}, uid, TODAY));
  const spent = ok(applyAddDebt(st(), { ...debtOf(0, '2026-10-01'), fundUse: { kind: 'spent' } }, {}, uid, TODAY));
  return a.assets[0].linkedDebtId === 'd1' && e !== '' && spent.wallet.availableCash === 100 * M && spent.transactions.length === 0 ? true : JSON.stringify([a.assets[0].linkedDebtId, e]);
});
t('R4d', 'Khoản nợ cũ: bổ sung nơi dùng vốn chỉ gắn nhãn, không cộng ví, không tạo giao dịch', () => {
  const s0 = st({ debts: [{ ...debtOf(5), fundUse: { kind: 'unspecified' } }] });
  const s = ok(applySetFundUse(s0, 'd1', { kind: 'wallet' }));
  return s.debts[0].fundUse?.kind === 'wallet' && s.wallet.availableCash === 100 * M && s.transactions.length === 0 && !s.debts[0].fundUse?.cashRecorded ? true : JSON.stringify(s.debts[0].fundUse);
});

// ============ Trả nợ có ngày ============
t('P1', 'Trả kỳ nợ có ngày chọn: giao dịch mang ngày đó và chỉ số kỳ; ngày tương lai / trước ngày giải ngân bị chặn', () => {
  const s = st({ debts: [debtOf(8)] });
  const r = ok(applyPayPeriod(s, { debtId: 'd1', periodIndex: 8, deductFromWallet: true, date: '2026-10-02' }, uid, TODAY));
  const f = err(applyPayPeriod(s, { debtId: 'd1', periodIndex: 8, deductFromWallet: true, date: '2026-11-02' }, uid, TODAY));
  const e = err(applyPayPeriod(s, { debtId: 'd1', periodIndex: 8, deductFromWallet: true, date: '2025-12-31' }, uid, TODAY));
  const lock = err(applyPayPeriod(r, { debtId: 'd1', periodIndex: 9, deductFromWallet: true, date: '2026-10-03' }, uid, TODAY));
  return r.transactions[0].date === '2026-10-02' && r.transactions[0].periodIndex === 8 && r.debts[0].schedule![8].paidDate === '2026-10-02' && f !== '' && e !== '' && lock.includes('mỗi tháng') || lock.includes('Mỗi tháng') ? true : JSON.stringify([f, e, lock]);
});

// ============ C5: nâng cấp dữ liệu cũ ============
t('C5a', 'Dữ liệu v2: nâng lên v3, nơi dùng vốn = chưa xác định, sổ sắp theo ngày, số liệu tài chính không đổi', () => {
  const old: any = {
    schemaVersion: 2, wallet: { availableCash: 5 * M, totalDeposited: 5 * M, totalWithdrawn: 0 },
    assets: [stock()], debts: [{ ...debtOf(3), fundUse: undefined }],
    transactions: [{ id: 'x1', date: '2026-03-01', type: 'deposit', amount: 1, title: 'x' }, { id: 'x2', date: '2026-09-01', type: 'deposit', amount: 2, title: 'y' }],
  };
  const a = normalizeState(old)!; const sumOld = calculateFinancialSummary(st({ ...old } as any));
  const sumNew = calculateFinancialSummary(a);
  return a.schemaVersion === SCHEMA_VERSION && SCHEMA_VERSION === 3 && a.debts[0].fundUse?.kind === 'unspecified' && a.transactions[0].id === 'x2' &&
    sumNew.netWorth === sumOld.netWorth && a.wallet.availableCash === 5 * M ? true : JSON.stringify([a.schemaVersion, a.debts[0].fundUse, a.transactions.map((x) => x.id)]);
});
t('C5b', 'Nâng cấp lặp lại không đổi dữ liệu (idempotent) và giữ trạng thái đã hủy / bút toán đảo', () => {
  let s = ok(applyDeposit(st(), 3 * M, '2026-10-01', undefined, uid, TODAY));
  s = ok(applyVoidTx(s, s.transactions[0].id, uid, TODAY));
  s = ok(applyVoidAsset({ ...s, assets: [stock()] }, 'fpt', uid, TODAY));
  const once = normalizeState(JSON.parse(JSON.stringify(s)))!; const twice = normalizeState(JSON.parse(JSON.stringify(once)))!;
  return JSON.stringify(once) === JSON.stringify(twice) && once.assets[0].status === 'voided' && once.transactions.some((x) => x.status === 'voided') && once.transactions.some((x) => x.reversalOf)
    ? true : 'không idempotent / mất trạng thái';
});
t('C5c', 'Lần bán cũ (trước khi có trường chi tiết) vẫn hiển thị nhưng không cho hủy vì thiếu dữ liệu hoàn nguyên', () => {
  const oldSell: CashTransaction = { id: 's0', date: '2026-04-01', type: 'sell_asset', amount: 1000, title: 'Bán cũ', linkedAssetId: 'fpt' };
  const s = st({ assets: [stock()], transactions: [oldSell] });
  const c = canVoidTx(s, 's0');
  return !c.ok && /trước khi có/.test(c.reason || '') ? true : JSON.stringify(c);
});

console.log(`\n==== phase2: ${pass} pass / ${fail} fail ====`);
process.exit(fail ? 1 : 0);
