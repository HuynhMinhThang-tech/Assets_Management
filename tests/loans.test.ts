/**
 * Test giai đoạn 2 của kế hoạch: một mức lãi tại một thời điểm, nút "Đổi lãi suất" (xem trước + mốc),
 * khoản vay đang trả dở và bảng cân đối có "số dư ban đầu", nâng cấp dữ liệu v4.
 * Run: npx tsx tests/loans.test.ts
 */
import { calculateFinancialSummary, isOpenItem } from '../src/utils/calculations';
import { buildTrackedDebt, ensureTimeline, inferDebtOpening, rateAt } from '../src/utils/debtCore';
import { applyAddRateChange, previewRateChange } from '../src/utils/debtOps';
import { calculateBalanceSheet, openingBalanceOf } from '../src/utils/balanceSheet';
import { applyAddDebt, applyPayPeriod, applyVoidDebt, OpResult } from '../src/utils/ops';
import { buildPeriod, periodBalance, reconcileReports } from '../src/utils/reports';
import { migrateOpening, normalizeState, SCHEMA_VERSION } from '../src/utils/storage';
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
  wallet: { availableCash: 100 * M, totalDeposited: 100 * M, totalWithdrawn: 0 }, assets: [], debts: [], transactions: [], ...o,
});
const ok = (r: OpResult): UserFinancialState => { if (!r.ok) throw new Error('op lỗi: ' + r.error); return r.state; };
const err = (r: OpResult): string => (r.ok ? '' : r.error);
const base: any = { id: 'd1', name: 'Vay A', lender: 'NH', category: 'mortgage', securityType: 'unsecured', fundUse: { kind: 'spent' } };
const tracked = (o: Partial<Parameters<typeof buildTrackedDebt>[1]> = {}, today = TODAY): Debt =>
  buildTrackedDebt(base, { balance: 1200 * M, periods: 24, firstDueDate: '2026-12-10', trackingStart: TODAY, paymentDay: 10, annualRate: 8, method: 'declining_balance', ...o }, today);
const open = (d: Debt) => d.schedule!.filter(isOpenItem);
const sumOpen = (d: Debt) => open(d).reduce((s, i) => s + i.principalPayable, 0);
const lastOpen = (d: Debt) => open(d).slice(-1)[0];

// ============ 6.1 Một mức lãi ============
t('L1', 'Khoản vay đang trả dở: một mốc lãi duy nhất, không còn thả nổi/ưu đãi, số dư ban đầu = dư nợ lúc bắt đầu theo dõi', () => {
  const d = tracked();
  const tl = ensureTimeline(d);
  return tl.length === 1 && tl[0].annualRate === 8 && d.rateType === 'fixed' && d.baseRate === undefined && d.floatingMargin === undefined &&
    d.preferentialMonths === undefined && d.openingBalance === 1200 * M && d.annualInterestRate === 8 ? true : JSON.stringify([tl, d.rateType, d.openingBalance]);
});
t('L2', 'Dữ liệu cũ có rateType = floating + lãi cơ sở/biên độ vẫn nạp và tính đúng theo lãi hiện tại của nó', () => {
  const legacy: any = { ...tracked(), rateType: 'floating', baseRate: 5, floatingMargin: 3, preferentialMonths: 12, annualInterestRate: 8, rateTimeline: undefined };
  const s = normalizeState({ wallet: st().wallet, assets: [], debts: [legacy], transactions: [] })!;
  const d = s.debts[0];
  return d.rateType === 'floating' && d.baseRate === 5 && d.floatingMargin === 3 && rateAt(ensureTimeline(d), TODAY) === 8 &&
    sumOpen(d) === d.remainingPrincipal && lastOpen(d).remainingBalance === 0 ? true : JSON.stringify([d.rateType, rateAt(ensureTimeline(d), TODAY)]);
});

// ============ 6.2 / 6.3 Đổi lãi suất ============
t('L3', 'Ví dụ trong kế hoạch: vay 8%, ngày 10/11/2027 đổi 10% → kỳ đã qua giữ nguyên, từ kỳ đến hạn ≥ 10/11/2027 tính 10%; gốc mỗi kỳ giữ nguyên, lãi tăng', () => {
  const d0 = tracked({ firstDueDate: '2026-12-10' });
  const d = ok(applyAddRateChange(st({ debts: [d0] }), { debtId: 'd1', effectiveDate: '2027-11-10', annualRate: 10 }, uid, TODAY)).debts[0];
  const idx = d.schedule!.findIndex((i) => i.dueDate === '2027-11-10'); // kỳ #12 (đầu kỳ 10/10/2027, cuối kỳ 10/11/2027)
  const before = d0.schedule![idx];
  const sameBefore = d.schedule!.slice(0, idx).every((i, k) => i.interestPayable === d0.schedule![k].interestPayable && i.principalPayable === d0.schedule![k].principalPayable);
  const nextIdx = idx + 1; // kỳ đầu tiên bắt đầu từ ngày hiệu lực → 10%
  const a = d.schedule![nextIdx], b = d0.schedule![nextIdx];
  const expectInterest = Math.round((a.remainingBalance + a.principalPayable) * 10 / 100 / 12);
  return sameBefore && d.schedule![idx].interestPayable === before.interestPayable && a.interestPayable === expectInterest && a.interestPayable > b.interestPayable &&
    a.principalPayable === b.principalPayable ? true : JSON.stringify({ sameBefore, expectInterest, a: a.interestPayable, b: b.interestPayable });
});
t('L4', 'Đổi lãi GIỮA kỳ: lãi kỳ đó tính theo số ngày thực tế của từng mức lãi (chia 365)', () => {
  const d0 = tracked();
  const d = ok(applyAddRateChange(st({ debts: [d0] }), { debtId: 'd1', effectiveDate: '2027-01-01', annualRate: 12 }, uid, TODAY)).debts[0];
  const it = d.schedule![1]; // kỳ 2: 10/12/2026 → 10/01/2027, đổi lãi ngày 01/01 (22 ngày 8% + 9 ngày 12%)
  const bal = d0.schedule![0].remainingBalance;
  const exp = Math.round(bal * 8 * 22 / 100 / 365 + bal * 12 * 9 / 100 / 365);
  return it.segments && it.segments.length === 2 && it.segments[0].days === 22 && it.segments[1].days === 9 && it.interestPayable === exp ? true : JSON.stringify([it.segments, it.interestPayable, exp]);
});
t('L5', 'Đổi lãi đúng ngày đến hạn: kỳ kết thúc ngày đó giữ lãi cũ, kỳ kế tiếp dùng lãi mới và không phải kỳ lẻ', () => {
  const d0 = tracked();
  const d = ok(applyAddRateChange(st({ debts: [d0] }), { debtId: 'd1', effectiveDate: '2026-12-10', annualRate: 9 }, uid, TODAY)).debts[0];
  const k1 = d.schedule![0], k2 = d.schedule![1];
  return k1.interestPayable === d0.schedule![0].interestPayable && !k2.segments && k2.interestPayable === Math.round(k1.remainingBalance * 9 / 100 / 12) ? true : JSON.stringify([k1.interestPayable, k2.interestPayable, k2.segments]);
});
t('L6', 'Đổi lãi ở quá khứ khi đã có kỳ trả: kỳ đã trả và giao dịch giữ nguyên, chỉ các kỳ chưa trả được tính lại', () => {
  let s = st({ debts: [tracked({ firstDueDate: '2026-11-12' })] });
  s = ok(applyPayPeriod(s, { debtId: 'd1', periodIndex: 0, deductFromWallet: true, date: '2026-11-12' }, uid, '2026-11-12'));
  const paid = s.debts[0].schedule![0];
  const txBefore = JSON.stringify(s.transactions);
  const r = ok(applyAddRateChange(s, { debtId: 'd1', effectiveDate: '2026-11-10', annualRate: 11 }, uid, '2026-11-13'));
  const d = r.debts[0];
  return JSON.stringify(d.schedule![0]) === JSON.stringify(paid) && JSON.stringify(r.transactions) === txBefore &&
    d.schedule![1].interestPayable > s.debts[0].schedule![1].interestPayable && sumOpen(d) === d.remainingPrincipal ? true : 'kỳ đã trả bị đổi hoặc kỳ chưa trả không tính lại';
});
t('L7', 'Cả hai phương thức: tổng gốc các kỳ chưa trả luôn = dư nợ còn lại và kỳ cuối về 0 (nhiều lần đổi lãi, gồm ân hạn)', () => {
  const cases: Debt[] = [tracked(), tracked({ method: 'equal_payment' }), tracked({ graceLeft: 3 }), tracked({ method: 'equal_payment', graceLeft: 4, periods: 36 })];
  for (const d0 of cases) {
    let s = st({ debts: [d0] });
    s = ok(applyAddRateChange(s, { debtId: 'd1', effectiveDate: '2027-03-15', annualRate: 10.5 }, uid, TODAY));
    s = ok(applyAddRateChange(s, { debtId: 'd1', effectiveDate: '2027-09-10', annualRate: 6.25 }, uid, TODAY));
    const d = s.debts[0];
    if (sumOpen(d) !== d.remainingPrincipal || lastOpen(d).remainingBalance !== 0) return `${d0.method}: Σ gốc ${sumOpen(d)} ≠ ${d.remainingPrincipal}`;
  }
  return true;
});
t('L8', 'Trả đều: đổi lãi → tiền trả mỗi kỳ được tính lại cho số kỳ còn lại (lãi tăng thì tiền kỳ tăng)', () => {
  const d0 = tracked({ method: 'equal_payment' });
  const d = ok(applyAddRateChange(st({ debts: [d0] }), { debtId: 'd1', effectiveDate: '2027-02-10', annualRate: 11 }, uid, TODAY)).debts[0];
  return d.schedule![0].totalMonthlyPayment === d0.schedule![0].totalMonthlyPayment && d.schedule![10].totalMonthlyPayment > d0.schedule![10].totalMonthlyPayment ? true : 'tiền kỳ không đổi';
});
t('L9', 'Đổi lãi bị chặn: lãi âm/quá lớn, sớm hơn mốc đầu, thiếu ngày; khoản đã tất toán', () => {
  const s = st({ debts: [tracked()] });
  const bad = [
    err(applyAddRateChange(s, { debtId: 'd1', effectiveDate: '2027-01-10', annualRate: -1 }, uid, TODAY)),
    err(applyAddRateChange(s, { debtId: 'd1', effectiveDate: '2027-01-10', annualRate: 500 }, uid, TODAY)),
    err(applyAddRateChange(s, { debtId: 'd1', effectiveDate: '2026-01-01', annualRate: 9 }, uid, TODAY)),
    err(applyAddRateChange(s, { debtId: 'd1', effectiveDate: '', annualRate: 9 }, uid, TODAY)),
    err(applyAddRateChange(s, { debtId: 'd1', effectiveDate: '2027-01-10' }, uid, TODAY)),
    err(applyAddRateChange(st({ debts: [{ ...tracked(), status: 'paid_off' }] }), { debtId: 'd1', effectiveDate: '2027-01-10', annualRate: 9 }, uid, TODAY)),
  ];
  return bad.every((x) => x !== '') ? true : JSON.stringify(bad);
});

// ============ Xem trước đổi lãi ============
t('L10', 'Xem trước: tiền kỳ tới đổi từ bao nhiêu sang bao nhiêu, kỳ ảnh hưởng đầu tiên, tổng lãi còn phải trả thay đổi bao nhiêu; không ghi gì', () => {
  const d0 = tracked();
  const snap = JSON.stringify(d0);
  const p = previewRateChange(d0, { effectiveDate: '2026-12-10', annualRate: 10 }, TODAY);
  if (!p.ok) return p.error;
  const saved = ok(applyAddRateChange(st({ debts: [d0] }), { debtId: 'd1', effectiveDate: '2026-12-10', annualRate: 10 }, uid, TODAY)).debts[0];
  const sumI = (d: Debt) => open(d).reduce((s, i) => s + i.interestPayable, 0);
  return JSON.stringify(d0) === snap && p.currentRate === 8 && p.newRate === 10 && p.next!.before === d0.schedule![0].totalMonthlyPayment &&
    p.next!.after === saved.schedule![0].totalMonthlyPayment && p.firstAffected!.period === 2 && p.remainingInterest.delta === sumI(saved) - sumI(d0) &&
    p.remainingInterest.delta > 0 && p.affectedPeriods === 23 ? true : JSON.stringify([p.next, p.firstAffected, p.remainingInterest, p.affectedPeriods]);
});
t('L11', 'Xem trước với đầu vào sai trả lỗi giống lúc lưu; đổi sang đúng lãi hiện tại → không kỳ nào bị ảnh hưởng', () => {
  const d0 = tracked();
  const bad = previewRateChange(d0, { effectiveDate: '2027-01-10', annualRate: 999 }, TODAY);
  const same = previewRateChange(d0, { effectiveDate: '2027-01-10', annualRate: 8 }, TODAY);
  return !bad.ok && same.ok && same.firstAffected === null && same.affectedPeriods === 0 && same.remainingInterest.delta === 0 ? true : JSON.stringify([bad, same.ok && same.affectedPeriods]);
});

// ============ 6.4 Đang trả dở + số dư ban đầu ============
const TRACKED_FUND = (o: Partial<Debt> = {}): Debt => ({ ...tracked(), ...o } as Debt);
t('L12', 'Nợ đã chi tiêu hết (không còn tài sản): bảng cân đối ghi rõ số dư ban đầu âm = dư nợ, lãi/lỗ lũy kế = 0 (không phải "lỗ")', () => {
  const s = ok(applyAddDebt(st(), TRACKED_FUND(), {}, uid, TODAY));
  const bs = calculateBalanceSheet(s, TODAY);
  return bs.equity.opening === -1200 * M && bs.equity.retained === 0 && bs.equity.contributed === 100 * M && bs.equity.total === 100 * M - 1200 * M &&
    bs.equity.contributed + bs.equity.opening + bs.equity.retained === bs.equity.total ? true : JSON.stringify(bs.equity);
});
t('L13', 'Tài sản chưa nhập: tạo cùng lúc, KHÔNG trừ ví, không tạo giao dịch; số dư ban đầu = giá trị tài sản − dư nợ; lãi/lỗ = 0', () => {
  const s = ok(applyAddDebt(st(), TRACKED_FUND({ fundUse: { kind: 'unspecified' } }), { preexistingAsset: { name: 'Căn hộ An Bình', value: 2000 * M, kind: 'real_estate', collateral: true } }, uid, TODAY));
  const a = s.assets[0], d = s.debts[0];
  const bs = calculateBalanceSheet(s, TODAY);
  return s.wallet.availableCash === 100 * M && s.transactions.length === 0 && a.preexisting === true && a.openingValue === 2000 * M && a.category === 'real_estate' &&
    a.linkedDebtId === d.id && d.fundUse?.kind === 'asset' && d.fundUse.assetId === a.id && d.collateralAssetId === a.id && d.securityType === 'secured' &&
    bs.equity.opening === 800 * M && bs.equity.retained === 0 && bs.equity.total === 100 * M + 800 * M ? true : JSON.stringify([bs.equity, s.transactions.length]);
});
t('L14', 'Sau khi tài sản tăng giá 100 triệu: chỉ lãi/lỗ lũy kế tăng, số dư ban đầu giữ nguyên', () => {
  let s = ok(applyAddDebt(st(), TRACKED_FUND({ fundUse: { kind: 'unspecified' } }), { preexistingAsset: { name: 'Xe', value: 500 * M, kind: 'vehicle' } }, uid, TODAY));
  s = { ...s, assets: s.assets.map((a) => ({ ...a, currentValue: a.currentValue + 100 * M })) };
  const bs = calculateBalanceSheet(s, TODAY);
  return bs.equity.opening === 500 * M - 1200 * M && bs.equity.retained === 100 * M && s.assets[0].category === 'other' ? true : JSON.stringify(bs.equity);
});
t('L15', 'Gắn vào tài sản đã có trong app: khoản vay đang trả dở → số dư ban đầu = −dư nợ; tài sản đã mua bằng ví nên lãi/lỗ = 0 ngay khi nhập', () => {
  const asset: Asset = { id: 'a1', name: 'Nhà', category: 'real_estate', initialCost: 1500 * M, currentValue: 1500 * M, purchaseDate: '2026-10-01', status: 'active', metadata: {} as any, realizedPnL: 0, lastValuationDate: '2026-10-01' };
  const start = st({ wallet: { availableCash: 0, totalDeposited: 1500 * M, totalWithdrawn: 0 }, assets: [asset],
    transactions: [{ id: 'b1', date: '2026-10-01', type: 'buy_asset', amount: 1500 * M, title: 'Mua nhà', linkedAssetId: 'a1' }] });
  const s = ok(applyAddDebt(start, TRACKED_FUND({ fundUse: { kind: 'asset', assetId: 'a1' } }), {}, uid, TODAY));
  const bs = calculateBalanceSheet(s, TODAY);
  return s.assets[0].linkedDebtId === 'd1' && !s.assets[0].preexisting && bs.equity.opening === -1200 * M && bs.equity.retained === 0 ? true : JSON.stringify(bs.equity);
});
t('L16', '"Chưa rõ" nơi dùng vốn: lưu được khi cho phép (sẽ nhắc bổ sung); mặc định vẫn bị chặn', () => {
  const d = TRACKED_FUND({ fundUse: { kind: 'unspecified' } });
  const blocked = err(applyAddDebt(st(), d, {}, uid, TODAY));
  const allowed = applyAddDebt(st(), d, { allowUnspecified: true }, uid, TODAY);
  return blocked !== '' && allowed.ok && allowed.state.debts[0].fundUse?.kind === 'unspecified' ? true : JSON.stringify([blocked, allowed.ok]);
});
t('L17', 'Tài sản "có từ trước": tên trống, giá trị 0, ngày mua ở tương lai bị chặn; không đổi state khi lỗi', () => {
  const d = TRACKED_FUND({ fundUse: { kind: 'unspecified' } });
  const e = [
    err(applyAddDebt(st(), d, { preexistingAsset: { name: ' ', value: 5 * M, kind: 'other' } }, uid, TODAY)),
    err(applyAddDebt(st(), d, { preexistingAsset: { name: 'Xe', value: 0, kind: 'other' } }, uid, TODAY)),
    err(applyAddDebt(st(), d, { preexistingAsset: { name: 'Xe', value: 5 * M, kind: 'other', purchaseDate: '2027-01-01' } }, uid, TODAY)),
  ];
  return e.every((x) => x !== '') ? true : JSON.stringify(e);
});
t('L18', 'Hủy khoản vay nhập nhầm (đang trả dở): số dư ban đầu của nó biến mất', () => {
  let s = ok(applyAddDebt(st(), TRACKED_FUND(), {}, uid, TODAY));
  s = ok(applyVoidDebt(s, 'd1', uid, TODAY));
  return openingBalanceOf(s) === 0 && calculateBalanceSheet(s, TODAY).equity.opening === 0 ? true : String(openingBalanceOf(s));
});
t('L19', 'Khoản vay mới giải ngân vào ví (có dòng giải ngân): không có số dư ban đầu, vốn chủ không đổi', () => {
  const nd: Debt = { ...base, fundUse: { kind: 'wallet' }, principalAmount: 300 * M, remainingPrincipal: 300 * M, annualInterestRate: 9, rateType: 'fixed', tenorMonths: 12, startDate: TODAY, paymentDayOfMonth: 10, method: 'declining_balance', status: 'active', schedule: [] };
  const s = ok(applyAddDebt(st(), nd, { disburseToWallet: true }, uid, TODAY));
  const bs = calculateBalanceSheet(s, TODAY);
  return s.debts[0].openingBalance === undefined && bs.equity.opening === 0 && bs.equity.total === 100 * M && s.wallet.availableCash === 400 * M ? true : JSON.stringify(bs.equity);
});

// ============ Nâng cấp dữ liệu v4 ============
const oldAsset = (o: Partial<Asset> = {}): Asset => ({ id: 'a1', name: 'Nhà', category: 'real_estate', initialCost: 1000 * M, currentValue: 1100 * M, purchaseDate: '2026-01-01', status: 'active', metadata: {} as any, realizedPnL: 0, lastValuationDate: '2026-01-01', ...o });
t('L20', 'Nâng cấp v3 → v4: khoản vay đang trả dở có số dư ban đầu, tài sản không từng trừ ví là "có từ trước", tài sản mua bằng ví thì không; số liệu tài chính không đổi', () => {
  const old: any = {
    schemaVersion: 3, wallet: { availableCash: 50 * M, totalDeposited: 400 * M, totalWithdrawn: 0 },
    assets: [oldAsset(), oldAsset({ id: 'a2', name: 'CP', category: 'stock', initialCost: 100 * M, currentValue: 100 * M })],
    debts: [{ ...tracked(), openingBalance: undefined }],
    transactions: [{ id: 'b2', date: '2026-02-01', type: 'buy_asset', amount: 100 * M, title: 'Mua CP', linkedAssetId: 'a2' }],
  };
  const before = calculateFinancialSummary(old);
  const s = normalizeState(old)!;
  const after = calculateFinancialSummary(s);
  return s.schemaVersion === 4 && SCHEMA_VERSION === 4 && s.debts[0].openingBalance === 1200 * M && s.assets[0].preexisting === true && s.assets[0].openingValue === 1000 * M &&
    s.assets[1].preexisting === undefined && after.netWorth === before.netWorth && openingBalanceOf(s) === 1000 * M - 1200 * M ? true : JSON.stringify([s.schemaVersion, s.debts[0].openingBalance, s.assets.map((a) => a.preexisting)]);
});
t('L21', 'Nâng cấp lặp lại không đổi dữ liệu (idempotent) và không ghi đè số dư ban đầu đã có', () => {
  const old: any = { schemaVersion: 3, wallet: st().wallet, assets: [oldAsset()], debts: [{ ...tracked(), openingBalance: undefined }], transactions: [] };
  const once = normalizeState(JSON.parse(JSON.stringify(old)))!;
  const twice = normalizeState(JSON.parse(JSON.stringify(once)))!;
  const kept = normalizeState({ ...JSON.parse(JSON.stringify(once)), debts: [{ ...once.debts[0], openingBalance: 7 * M }] })!;
  return JSON.stringify(once) === JSON.stringify(twice) && kept.debts[0].openingBalance === 7 * M ? true : 'không idempotent';
});
t('L22', 'Khoản vay mua tài sản "có từ trước" không qua ví: số dư ban đầu của khoản vay = số tiền vay (cân với tài sản)', () => {
  const a = oldAsset({ linkedDebtId: 'd1' });
  const nd: Debt = { ...base, fundUse: { kind: 'asset', assetId: 'a1' }, principalAmount: 700 * M, remainingPrincipal: 650 * M, annualInterestRate: 9, rateType: 'fixed', tenorMonths: 60, startDate: '2026-03-10', paymentDayOfMonth: 10, method: 'declining_balance', status: 'active', schedule: [] };
  const m = migrateOpening([a], [nd], []);
  return m.assets[0].openingValue === 1000 * M && m.debts[0].openingBalance === 700 * M ? true : JSON.stringify([m.assets[0].openingValue, m.debts[0].openingBalance]);
});
t('L23', 'inferDebtOpening: tracked → principalAmount; có dòng giải ngân vào ví → không có; đã hủy → không có', () => {
  const d = tracked();
  return inferDebtOpening(d) === 1200 * M && inferDebtOpening({ ...d, fundUse: { kind: 'wallet', cashRecorded: true } }) === undefined && inferDebtOpening({ ...d, status: 'voided' }) === undefined ? true : 'sai';
});

// ============ Báo cáo theo kỳ ============
t('L24', 'Báo cáo: số dư ban đầu giữ nguyên giữa đầu kỳ và cuối kỳ, đối soát "nguồn vốn = tài sản" vẫn khớp', () => {
  let s = ok(applyAddDebt(st(), TRACKED_FUND({ fundUse: { kind: 'unspecified' } }), { preexistingAsset: { name: 'Căn hộ', value: 2000 * M, kind: 'real_estate', purchaseDate: '2026-01-15' } }, uid, TODAY));
  s = ok(applyPayPeriod(s, { debtId: 'd1', periodIndex: 0, deductFromWallet: true, date: '2026-12-10' }, uid, '2026-12-10').ok ? applyPayPeriod(s, { debtId: 'd1', periodIndex: 0, deductFromWallet: true, date: '2026-12-10' }, uid, '2026-12-10') : { ok: true, state: s });
  const period = buildPeriod({ kind: 'month', year: 2026, month: 11, quarter: 1 }, '2026-12-20');
  const pb = periodBalance(s, period, '2026-12-20');
  const checks = reconcileReports(s, period, '2026-12-20');
  const c3 = checks.find((c) => c.id === 'sources')!;
  return pb.start.equity.opening === 800 * M && pb.end.equity.opening === 800 * M && c3.ok ? true : JSON.stringify([pb.start.equity, pb.end.equity, c3]);
});

console.log(`\n==== loans: ${pass} pass / ${fail} fail ====`);
process.exit(fail ? 1 : 0);
