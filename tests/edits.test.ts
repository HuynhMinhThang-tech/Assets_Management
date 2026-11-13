/**
 * Test giai đoạn 3: sửa thông tin tài sản và khoản vay (hợp lệ / không hợp lệ, tài sản thế chấp,
 * không làm sai ví và bảng cân đối, dấu vết chỉnh sửa).
 * Run: npx tsx tests/edits.test.ts
 */
import { calculateCollateralMetrics, calculateFinancialSummary, isOpenItem } from '../src/utils/calculations';
import { calculateBalanceSheet } from '../src/utils/balanceSheet';
import { buildTrackedDebt } from '../src/utils/debtCore';
import { applyEditAsset, applyEditDebt, assetEditLock, EDIT_LOG_LIMIT } from '../src/utils/editOps';
import { applyAddDebt, applyPayPeriod, applySell, OpResult } from '../src/utils/ops';
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
const TODAY = '2026-11-10';
const st = (o: Partial<UserFinancialState> = {}): UserFinancialState => ({
  wallet: { availableCash: 1000 * M, totalDeposited: 1000 * M, totalWithdrawn: 0 }, assets: [], debts: [], transactions: [], ...o,
});
const ok = (r: OpResult): UserFinancialState => { if (!r.ok) throw new Error('op lỗi: ' + r.error); return r.state; };
const err = (r: OpResult): string => (r.ok ? '' : r.error);
const stock = (o: Partial<Asset> = {}): Asset => ({
  id: 'fpt', name: 'FPT', category: 'stock', initialCost: 1_000_000, currentValue: 1_200_000, purchaseDate: '2026-09-01', status: 'active',
  metadata: { symbol: 'FPT', exchange: 'HOSE', quantity: 10, avgCostPrice: 100_000, currentPrice: 120_000, totalDividendsReceived: 0 } as any,
  realizedPnL: 0, lastValuationDate: '2026-09-01', ...o,
});
const house = (o: Partial<Asset> = {}): Asset => ({
  id: 'h1', name: 'Nhà', category: 'real_estate', initialCost: 2000 * M, currentValue: 2200 * M, purchaseDate: '2026-01-01', status: 'active',
  metadata: { address: 'HN', propertyType: 'apartment', areaM2: 60, purchasePrice: 2000 * M, estimatedMarketPrice: 2200 * M, monthlyRentalIncome: 0, legalStatus: 'red_book' } as any,
  realizedPnL: 0, lastValuationDate: '2026-01-01', ...o,
});
const buyTx = (assetId: string, amount: number, date: string) => ({ id: 'b-' + assetId, date, type: 'buy_asset' as const, amount, title: 'Mua', linkedAssetId: assetId });
const base: any = { id: 'd1', name: 'Vay A', lender: 'NH', category: 'mortgage', securityType: 'unsecured', fundUse: { kind: 'spent' } };
const tracked = (o: any = {}): Debt => buildTrackedDebt(base, { balance: 600 * M, periods: 12, firstDueDate: '2026-12-10', trackingStart: TODAY, paymentDay: 10, annualRate: 9, method: 'declining_balance', ...o }, TODAY);
const open = (d: Debt) => d.schedule!.filter(isOpenItem);

// ============ Tài sản: sửa hợp lệ ============
t('E1', 'Sửa tên + ghi chú hợp lệ: ghi vào lịch sử (trường, cũ → mới); ví, tài sản ròng không đổi', () => {
  const s0 = st({ assets: [stock()], transactions: [buyTx('fpt', 1_000_000, '2026-09-01')] });
  const s = ok(applyEditAsset(s0, 'fpt', { name: '  FPT Corp ', notes: 'mua đợt 1' }, uid, TODAY));
  const log = s.editLog || [];
  return s.assets[0].name === 'FPT Corp' && s.assets[0].notes === 'mua đợt 1' && log.length === 2 && log.some((e) => e.field === 'name' && e.from === 'FPT' && e.to === 'FPT Corp' && e.date === TODAY) &&
    s.wallet.availableCash === s0.wallet.availableCash && calculateFinancialSummary(s).netWorth === calculateFinancialSummary(s0).netWorth ? true : JSON.stringify(log);
});
t('E2', 'Sửa không đổi gì → không ghi lịch sử, state giữ nguyên', () => {
  const s0 = st({ assets: [stock()] });
  const r = applyEditAsset(s0, 'fpt', { name: 'FPT', notes: '' }, uid, TODAY);
  return r.ok && r.state === s0 ? true : 'đã đổi state';
});
t('E3', 'Sửa mã: chuẩn hóa chữ hoa; sai định dạng và loại không có mã bị chặn', () => {
  const s = ok(applyEditAsset(st({ assets: [stock()] }), 'fpt', { symbol: ' hpg ' }, uid, TODAY));
  const bad = [err(applyEditAsset(st({ assets: [stock()] }), 'fpt', { symbol: 'H' }, uid, TODAY)), err(applyEditAsset(st({ assets: [stock()] }), 'fpt', { symbol: 'AB C' }, uid, TODAY)), err(applyEditAsset(st({ assets: [house()] }), 'h1', { symbol: 'ABC' }, uid, TODAY))];
  return (s.assets[0].metadata as any).symbol === 'HPG' && bad.every((x) => x !== '') ? true : JSON.stringify(bad);
});

// ============ Tài sản: không hợp lệ ============
t('E4', 'Đầu vào sai bị chặn và state không đổi: tên trống, ngày tương lai / sai định dạng, số lượng 0 hoặc âm, giá vốn âm', () => {
  const s0 = st({ assets: [stock()] });
  const cases = [{ name: '   ' }, { name: 'x'.repeat(121) }, { purchaseDate: '2026-11-11' }, { purchaseDate: '10/09/2026' }, { notes: 'x'.repeat(1001) }, { quantity: 0 }, { quantity: -5 }, { unitCost: -1 }, { quantity: NaN }];
  const res = cases.map((c) => applyEditAsset(s0, 'fpt', c as any, uid, TODAY));
  return res.every((r) => !r.ok) && !s0.editLog ? true : JSON.stringify(res.map((r) => r.ok));
});
t('E5', 'Chỉ sửa tài sản đang giữ: tài sản đã bán / đã hủy / không tồn tại bị chặn', () => {
  const e = [err(applyEditAsset(st({ assets: [stock({ status: 'sold' })] }), 'fpt', { name: 'A' }, uid, TODAY)), err(applyEditAsset(st({ assets: [stock({ status: 'voided' })] }), 'fpt', { name: 'A' }, uid, TODAY)), err(applyEditAsset(st(), 'zzz', { name: 'A' }, uid, TODAY))];
  return e.every((x) => x !== '') ? true : JSON.stringify(e);
});

// ============ Ràng buộc với sổ cái ============
t('E6', 'Đã bán một phần: KHÔNG sửa số lượng / giá vốn trực tiếp, thông báo hướng hủy giao dịch rồi nhập lại; vẫn sửa được tên', () => {
  let s = st({ assets: [stock()], transactions: [buyTx('fpt', 1_000_000, '2026-09-01')] });
  s = ok(applySell(s, { assetId: 'fpt', quantity: 4, unitPrice: 130_000, received: 520_000, date: '2026-10-05' } as any, uid, TODAY));
  const q = err(applyEditAsset(s, 'fpt', { quantity: 20 }, uid, TODAY));
  const c = err(applyEditAsset(s, 'fpt', { unitCost: 90_000 }, uid, TODAY));
  const nm = applyEditAsset(s, 'fpt', { name: 'FPT (đã bán bớt)' }, uid, TODAY);
  return /hủy/.test(q) && /hủy/.test(c) && nm.ok && assetEditLock(s, 'fpt').quantityCostLocked ? true : JSON.stringify([q, c, nm.ok]);
});
t('E7', 'Tài sản mua bằng ví (có giao dịch mua) cũng khóa số lượng/giá vốn: tránh lệch ví', () => {
  const s = st({ assets: [stock()], transactions: [buyTx('fpt', 1_000_000, '2026-09-01')] });
  return err(applyEditAsset(s, 'fpt', { quantity: 12 }, uid, TODAY)) !== '' ? true : 'đã cho sửa';
});
t('E8', 'Tài sản có từ trước (không giao dịch): sửa số lượng/giá vốn được; số dư ban đầu bám theo, lãi/lỗ lũy kế không đổi, ví không đổi', () => {
  const a = stock({ preexisting: true, openingValue: 1_000_000 });
  const s0 = st({ assets: [a] });
  const s = ok(applyEditAsset(s0, 'fpt', { quantity: 20, unitCost: 90_000 }, uid, TODAY));
  const x = s.assets[0], md = x.metadata as any;
  const bs0 = calculateBalanceSheet(s0, TODAY), bs = calculateBalanceSheet(s, TODAY);
  return md.quantity === 20 && md.avgCostPrice === 90_000 && x.initialCost === 1_800_000 && x.openingValue === 1_800_000 && x.currentValue === 20 * 120_000 && s.wallet.availableCash === s0.wallet.availableCash &&
    bs0.equity.retained === 200_000 && bs.equity.retained === 600_000 && bs.equity.contributed + bs.equity.opening + bs.equity.retained === bs.equity.total ? true : JSON.stringify([x.initialCost, x.openingValue, bs.equity]);
});
t('E9', 'Bất động sản không có giao dịch: sửa tổng giá vốn (cập nhật giá mua), thị giá giữ nguyên; loại có đơn vị bị chặn dùng sai trường', () => {
  const s0 = st({ assets: [house()] });
  const s = ok(applyEditAsset(s0, 'h1', { totalCost: 1900 * M }, uid, TODAY));
  const bad = [err(applyEditAsset(s0, 'h1', { quantity: 2 }, uid, TODAY)), err(applyEditAsset(st({ assets: [stock()] }), 'fpt', { totalCost: 5 }, uid, TODAY)), err(applyEditAsset(s0, 'h1', { totalCost: 0 }, uid, TODAY))];
  return s.assets[0].initialCost === 1900 * M && (s.assets[0].metadata as any).purchasePrice === 1900 * M && s.assets[0].currentValue === 2200 * M && bad.every((x) => x !== '') ? true : JSON.stringify(bad);
});
t('E10', 'Sửa ngày mua: dời cả dòng mua đầu tiên trong sổ (ví không đổi, sổ vẫn sắp theo ngày); không được sau giao dịch đầu tiên khác', () => {
  let s = st({ assets: [stock()], transactions: [buyTx('fpt', 1_000_000, '2026-09-01')] });
  s = ok(applyIncomeLike(s));
  const moved = ok(applyEditAsset(s, 'fpt', { purchaseDate: '2026-08-20' }, uid, TODAY));
  const tooLate = err(applyEditAsset(s, 'fpt', { purchaseDate: '2026-10-20' }, uid, TODAY));
  const buy = moved.transactions.find((x) => x.type === 'buy_asset')!;
  const dates = moved.transactions.map((x) => x.date);
  return moved.assets[0].purchaseDate === '2026-08-20' && buy.date === '2026-08-20' && moved.wallet.availableCash === s.wallet.availableCash && dates.join() === [...dates].sort().reverse().join() && tooLate !== '' ? true : JSON.stringify([dates, tooLate]);
});
function applyIncomeLike(s: UserFinancialState): OpResult {
  return { ok: true, state: { ...s, transactions: [{ id: 'dv1', date: '2026-10-01', type: 'dividend', amount: 50_000, title: 'Cổ tức', linkedAssetId: 'fpt' }, ...s.transactions], wallet: { ...s.wallet, availableCash: s.wallet.availableCash + 50_000 } } };
}
t('E11', 'Sửa tài sản đang thế chấp: đổi tên/ngày mua/ghi chú giữ nguyên liên kết khoản vay và LTV; không đổi ví', () => {
  const asset = house({ preexisting: true, openingValue: 2000 * M });
  const debt: Debt = { ...tracked(), collateralAssetId: 'h1', securityType: 'secured', fundUse: { kind: 'asset', assetId: 'h1' } };
  const s0 = st({ assets: [{ ...asset, linkedDebtId: 'd1' }], debts: [debt] });
  const s = ok(applyEditAsset(s0, 'h1', { name: 'Căn hộ An Bình', purchaseDate: '2025-12-15', notes: 'thế chấp VCB' }, uid, TODAY));
  const m0 = calculateCollateralMetrics(s0.assets[0], s0.debts[0]), m1 = calculateCollateralMetrics(s.assets[0], s.debts[0]);
  return s.debts[0].collateralAssetId === 'h1' && s.assets[0].linkedDebtId === 'd1' && m0.ltv === m1.ltv && s.wallet.availableCash === s0.wallet.availableCash &&
    calculateBalanceSheet(s, TODAY).equity.total === calculateBalanceSheet(s0, TODAY).equity.total ? true : JSON.stringify([m0, m1]);
});
t('E12', 'Savings: không sửa ngày mua / số tiền gửi (gắn với kỳ hạn); vẫn sửa tên, ghi chú', () => {
  const sv: Asset = { id: 'sv', name: 'Sổ VCB', category: 'savings', initialCost: 100 * M, currentValue: 100 * M, purchaseDate: '2026-06-01', status: 'active', realizedPnL: 0, lastValuationDate: '2026-06-01',
    metadata: { bankName: 'VCB', depositAmount: 100 * M, termMonths: 12, annualInterestRate: 5, startDate: '2026-06-01', maturityDate: '2027-06-01', rolloverOption: 'close' } as any };
  const s0 = st({ assets: [sv] });
  const a = err(applyEditAsset(s0, 'sv', { purchaseDate: '2026-05-01' }, uid, TODAY)), b = err(applyEditAsset(s0, 'sv', { totalCost: 5 * M }, uid, TODAY));
  return a !== '' && b !== '' && applyEditAsset(s0, 'sv', { name: 'Sổ VCB 12T' }, uid, TODAY).ok ? true : JSON.stringify([a, b]);
});

// ============ Khoản vay ============
t('E13', 'Sửa tên, ngân hàng, ghi chú khoản vay: lịch, dư nợ, ví không đổi; có lịch sử', () => {
  const s0 = st({ debts: [tracked()] });
  const s = ok(applyEditDebt(s0, 'd1', { name: 'Vay mua nhà', lender: 'Techcombank', notes: 'ưu đãi 12 tháng' }, uid, TODAY));
  return s.debts[0].name === 'Vay mua nhà' && s.debts[0].lender === 'Techcombank' && JSON.stringify(s.debts[0].schedule) === JSON.stringify(s0.debts[0].schedule) &&
    s.debts[0].remainingPrincipal === 600 * M && s.editLog!.length === 3 && s.editLog!.every((e) => e.targetType === 'debt') ? true : JSON.stringify(s.editLog);
});
t('E14', 'Khoản vay: tên/ngân hàng trống, ngày trả ngoài 1–31 hoặc không nguyên, khoản đã tất toán bị chặn', () => {
  const s0 = st({ debts: [tracked()] });
  const e = [err(applyEditDebt(s0, 'd1', { name: ' ' }, uid, TODAY)), err(applyEditDebt(s0, 'd1', { lender: '' }, uid, TODAY)), err(applyEditDebt(s0, 'd1', { paymentDay: 0 }, uid, TODAY)),
    err(applyEditDebt(s0, 'd1', { paymentDay: 32 }, uid, TODAY)), err(applyEditDebt(s0, 'd1', { paymentDay: 10.5 }, uid, TODAY)), err(applyEditDebt(st({ debts: [{ ...tracked(), status: 'paid_off' }] }), 'd1', { name: 'x' }, uid, TODAY))];
  return e.every((x) => x !== '') ? true : JSON.stringify(e);
});
t('E15', 'Đổi ngày trả 10 → 20: các kỳ chưa trả dời sang ngày 20 hằng tháng, tổng gốc chưa trả = dư nợ, kỳ cuối về 0, ví không đổi', () => {
  const s0 = st({ debts: [tracked()] });
  const s = ok(applyEditDebt(s0, 'd1', { paymentDay: 20 }, uid, TODAY));
  const d = s.debts[0];
  const sumP = open(d).reduce((x, i) => x + i.principalPayable, 0);
  return d.paymentDayOfMonth === 20 && open(d).every((i) => i.dueDate.endsWith('-20')) && open(d)[0].dueDate === '2026-12-20' && sumP === d.remainingPrincipal && open(d).slice(-1)[0].remainingBalance === 0 && s.wallet.availableCash === s0.wallet.availableCash ? true : JSON.stringify(open(d).map((i) => i.dueDate));
});
t('E16', 'Đổi ngày trả khi đã trả vài kỳ: kỳ đã trả và giao dịch giữ nguyên; ngày mới không được làm kỳ kế tiếp đến hạn trước kỳ đã trả', () => {
  let s = st({ debts: [tracked({ firstDueDate: '2026-11-12' })] });
  s = ok(applyPayPeriod(s, { debtId: 'd1', periodIndex: 0, deductFromWallet: true, date: '2026-11-12' }, uid, '2026-11-12'));
  const paid = JSON.stringify(s.debts[0].schedule![0]);
  const tx = JSON.stringify(s.transactions);
  const moved = ok(applyEditDebt(s, 'd1', { paymentDay: 25 }, uid, '2026-11-13'));
  const earlier = err(applyEditDebt(s, 'd1', { paymentDay: 5 }, uid, '2026-11-13')); // kỳ 2 dời về 05/12: vẫn sau kỳ đã trả (12/11) nên hợp lệ
  return JSON.stringify(moved.debts[0].schedule![0]) === paid && JSON.stringify(moved.transactions) === tx && open(moved.debts[0])[0].dueDate === '2026-12-25' && earlier === '' ? true : JSON.stringify([open(moved.debts[0])[0].dueDate, earlier]);
});
t('E17', 'Đổi ngày trả làm kỳ đến hạn không sau mốc tính lãi trước đó → bị chặn, state không đổi; ngày hợp lệ thì qua', () => {
  const d = tracked({ firstDueDate: '2026-11-28', paymentDay: 28 });
  const okCase = applyEditDebt(st({ debts: [d] }), 'd1', { paymentDay: 5 }, uid, TODAY);
  const s2 = st({ debts: [{ ...d, scheduleAnchorDate: '2026-11-08' }] }); // mốc trước = 08/11; ngày mới làm kỳ 1 hạn 05/11 ≤ 08/11
  const blocked = applyEditDebt(s2, 'd1', { paymentDay: 5 }, uid, TODAY);
  return okCase.ok && !blocked.ok && !s2.editLog ? true : JSON.stringify([okCase.ok, blocked.ok]);
});
t('E18', 'Lịch sử chỉnh sửa: mới → cũ, tối đa 500 dòng, giữ qua chuẩn hóa dữ liệu (nạp lại)', () => {
  let s = st({ assets: [stock()] });
  for (let i = 0; i < EDIT_LOG_LIMIT + 5; i++) s = ok(applyEditAsset(s, 'fpt', { name: 'N' + i }, uid, TODAY));
  const re = normalizeState(JSON.parse(JSON.stringify(s)))!;
  return s.editLog!.length === EDIT_LOG_LIMIT && s.editLog![0].to === 'N' + (EDIT_LOG_LIMIT + 4) && re.editLog!.length === EDIT_LOG_LIMIT && re.editLog![0].field === 'name' ? true : String(s.editLog!.length);
});
t('E19', 'Sửa khoản vay thêm bằng applyAddDebt (tài sản có từ trước): ví và số dư ban đầu giữ nguyên sau khi đổi tên/ngân hàng', () => {
  const s0 = ok(applyAddDebt(st(), { ...tracked(), fundUse: { kind: 'unspecified' } }, { preexistingAsset: { name: 'Xe', value: 700 * M, kind: 'vehicle' } }, uid, TODAY));
  const s = ok(applyEditDebt(s0, 'd1', { lender: 'ACB' }, uid, TODAY));
  const a = calculateBalanceSheet(s0, TODAY), b = calculateBalanceSheet(s, TODAY);
  return JSON.stringify(a.equity) === JSON.stringify(b.equity) && s.wallet.availableCash === s0.wallet.availableCash ? true : 'đổi số liệu';
});

console.log(`\n==== edits: ${pass} pass / ${fail} fail ====`);
process.exit(fail ? 1 : 0);
