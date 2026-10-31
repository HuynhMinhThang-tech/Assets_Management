/**
 * Test giai đoạn 1: R3 (tiền khả dụng vào KPI), R5 (giá theo đơn vị), R6 (mỗi tháng một kỳ nợ),
 * R8 (lọc lịch sử giao dịch theo thời gian), R9 (biểu đồ tròn phân bổ).
 * Run: npx tsx tests/phase1.test.ts   (đặt TZ=... để đổi múi giờ)
 */
import {
  generateAmortizationSchedule, calculateFinancialSummary, checkPayable, endOfMonthStr, payLockLabel,
} from '../src/utils/calculations';
import { buildAllocation } from '../src/utils/allocation';
import { getUnitPricing, applyRevaluation, totalFromUnitPrice } from '../src/utils/pricing';
import { rangeForPreset, inRange, isRangeInvalid, summarizeLedger, addDaysStr, RANGE_PRESETS } from '../src/utils/ledger';
import { buildMonthEvents } from '../src/utils/calendar';
import { INITIAL_DEMO_STATE, normalizeState } from '../src/utils/storage';
import type { Asset, CashTransaction, Debt } from '../src/types/finance';

let pass = 0, fail = 0;
function t(id: string, name: string, fn: () => true | string) {
  let r: true | string;
  try { r = fn(); } catch (e: any) { r = 'THROW ' + e.message; }
  if (r === true) { pass++; console.log(`PASS ${id} ${name}`); }
  else { fail++; console.log(`FAIL ${id} ${name}\n       ${r}`); }
}
const M = 1_000_000;

// (localStorage giả cho storage.ts)
const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};
console.log('TZ =', process.env.TZ || 'default');

function asset(id: string, category: Asset['category'], cost: number, value: number, metadata: any, extra: Partial<Asset> = {}): Asset {
  return {
    id, name: id, category, initialCost: cost, currentValue: value, purchaseDate: '2026-01-01', status: 'active',
    metadata, realizedPnL: 0, lastValuationDate: '2026-01-01', ...extra,
  };
}

// ================= R3: KPI =================
t('R3a', 'Tài sản ròng = Tiền khả dụng + Tài sản đầu tư − Dư nợ (dữ liệu mẫu)', () => {
  const st = normalizeState(JSON.parse(JSON.stringify(INITIAL_DEMO_STATE)))!;
  const s = calculateFinancialSummary(st);
  const expect = s.availableCash + s.totalAssetValue - s.totalDebtBalance;
  return s.netWorth === expect && s.availableCash === st.wallet.availableCash ? true : `${s.netWorth} vs ${expect}`;
});
t('R3b', 'Tài sản bán rồi và nợ đã tất toán không vào KPI', () => {
  const st = normalizeState({
    wallet: { availableCash: 50 * M, totalDeposited: 0, totalWithdrawn: 0 },
    assets: [asset('a', 'stock', 10 * M, 12 * M, { quantity: 10 }), asset('b', 'gold', 5 * M, 0, { quantityChi: 1 }, { status: 'sold' })],
    debts: [], transactions: [],
  })!;
  const s = calculateFinancialSummary(st);
  return s.netWorth === 62 * M && s.totalAssetValue === 12 * M ? true : JSON.stringify([s.netWorth, s.totalAssetValue]);
});

// ================= R9: phân bổ =================
const br = (o: Record<string, number>) => {
  const r: Record<string, { value: number; count: number; cost: number }> = {};
  for (const [k, v] of Object.entries(o)) r[k] = { value: v * M, count: 1, cost: v * M * 0.8 };
  return r;
};
t('R9a', 'Tổng tỷ trọng = 100%, xếp giảm dần theo giá trị', () => {
  const a = buildAllocation(br({ real_estate: 60, stock: 25, fund: 15 }));
  const sum = a.slices.reduce((s, x) => s + x.pct, 0);
  const desc = a.slices.every((x, i) => i === 0 || a.slices[i - 1].value >= x.value);
  return Math.abs(sum - 100) < 1e-9 && desc && a.total === 100 * M ? true : JSON.stringify(a.slices.map(x => [x.key, x.pct]));
});
t('R9b', 'Hai nhóm dưới 3% gộp thành "Khác" (đứng cuối, có danh sách nhóm gộp)', () => {
  const a = buildAllocation(br({ real_estate: 90, stock: 7, gold: 1.5, savings: 1.5 }));
  const last = a.slices[a.slices.length - 1];
  return a.slices.length === 3 && last.label === 'Khác' && last.members.length === 2 &&
    last.members.includes('gold') && last.members.includes('savings') && Math.abs(last.pct - 3) < 1e-9 && last.count === 2
    ? true : JSON.stringify(a.slices.map(x => [x.key, x.label, x.pct, x.members]));
});
t('R9c', 'Đúng 3% thì KHÔNG gộp (chỉ gộp khi dưới 3%)', () => {
  const a = buildAllocation(br({ real_estate: 94, stock: 3, gold: 3 }));
  return a.slices.length === 3 && a.slices.every((x) => x.members.length === 1) ? true : JSON.stringify(a.slices.map(x => [x.key, x.pct]));
});
t('R9d', 'Một nhóm nhỏ đứng riêng giữ nguyên tên (không bị đổi thành "Khác")', () => {
  const a = buildAllocation(br({ real_estate: 60, stock: 38, gold: 2 }));
  return a.slices.length === 3 && a.slices.some(x => x.key === 'gold' && x.label === 'Vàng & Kim loại quý') ? true : JSON.stringify(a.slices.map(x => x.label));
});
t('R9e', 'Nhóm "Khác" gốc đứng cuối; nhóm nhỏ + "Khác" gốc gộp chung', () => {
  const a = buildAllocation(br({ real_estate: 50, stock: 40, other: 10 }));
  const b = buildAllocation(br({ real_estate: 90, stock: 7, gold: 2, other: 1 }));
  const lb = b.slices[b.slices.length - 1];
  return a.slices[a.slices.length - 1].key === 'other' && lb.label === 'Khác' && lb.members.length === 2 && Math.abs(lb.pct - 3) < 1e-9
    ? true : JSON.stringify([a.slices.map(x => x.key), b.slices.map(x => [x.label, x.members])]);
});
t('R9f', 'Lãi/lỗ % của lát = (thị giá − giá vốn)/giá vốn; rỗng → không có lát', () => {
  const a = buildAllocation(br({ stock: 100 }));
  const e = buildAllocation({});
  return Math.abs(a.slices[0].pnlPct - 25) < 1e-9 && e.slices.length === 0 && e.total === 0 ? true : JSON.stringify([a.slices[0].pnlPct, e]);
});
t('R9g', 'Dữ liệu mẫu: biểu đồ chỉ gồm tài sản (không gồm tiền ví), tổng = tổng tài sản đầu tư', () => {
  const st = normalizeState(JSON.parse(JSON.stringify(INITIAL_DEMO_STATE)))!;
  const s = calculateFinancialSummary(st);
  const a = buildAllocation(s.categoryBreakdown);
  return a.total === s.totalAssetValue ? true : `${a.total} vs ${s.totalAssetValue}`;
});

// ================= R5: giá theo đơn vị =================
const stock = () => asset('fpt', 'stock', 287.5 * M, 345 * M, { symbol: 'FPT', quantity: 2500, avgCostPrice: 115000, currentPrice: 138000 });
t('R5a', 'Cổ phiếu: đơn giá hiện tại = tổng ÷ số lượng; nhập giá/CP → tổng = SL × giá', () => {
  const p = getUnitPricing(stock())!;
  const a = applyRevaluation(stock(), { unitPrice: 150000 }, '2026-10-30');
  const md = a.metadata as any;
  return p.unit === 'cổ phiếu' && p.unitPrice === 138000 && p.quantity === 2500 &&
    a.currentValue === 375 * M && md.currentPrice === 150000 && a.lastValuationDate === '2026-10-30' && a.initialCost === 287.5 * M
    ? true : JSON.stringify([p, a.currentValue, md.currentPrice]);
});
t('R5b', 'Lịch sử định giá lưu cả đơn giá lẫn tổng; cùng ngày thì thay bản ghi cũ', () => {
  let a = applyRevaluation(stock(), { unitPrice: 150000 }, '2026-10-30');
  a = applyRevaluation(a, { unitPrice: 152000 }, '2026-10-30');
  a = applyRevaluation(a, { unitPrice: 140000 }, '2026-10-31');
  const h = a.valuationHistory!;
  return h.length === 2 && h[0].unitPrice === 152000 && h[0].value === 380 * M && h[1].unitPrice === 140000 && h[1].value === 350 * M
    ? true : JSON.stringify(h);
});
t('R5c', 'Quỹ: NAV có số lẻ (2 chữ số thập phân), nhập NAV → cập nhật currentNav', () => {
  const f = asset('dcds', 'fund', 248 * M, 298 * M, { fundCode: 'DCDS', units: 4000, avgNav: 62000, currentNav: 74500 });
  const p = getUnitPricing(f)!;
  const a = applyRevaluation(f, { unitPrice: 74512.35 }, '2026-10-30');
  return p.allowDecimal && p.unit === 'CCQ' && a.currentValue === 298_049_400 && (a.metadata as any).currentNav === 74512.35
    ? true : JSON.stringify([p, a.currentValue, (a.metadata as any).currentNav]);
});
t('R5d', 'Vàng: số chỉ lẻ × giá/chỉ → làm tròn đến đồng', () => {
  const g = asset('sjc', 'gold', 19 * M, 22 * M, { goldType: 'SJC', quantityChi: 2.5, costPerChi: 7_600_000, currentPerChi: 8_800_000 });
  const a = applyRevaluation(g, { unitPrice: 8_850_000 }, '2026-10-30');
  return getUnitPricing(g)!.unit === 'chỉ' && a.currentValue === 22_125_000 && (a.metadata as any).currentPerChi === 8_850_000
    ? true : String(a.currentValue);
});
t('R5e', 'Bất động sản có diện tích: nhập giá/m²; không có diện tích: nhập tổng', () => {
  const re = asset('bds', 'real_estate', 2800 * M, 3450 * M, { areaM2: 64.5, estimatedMarketPrice: 3450 * M });
  const a = applyRevaluation(re, { unitPrice: 54_000_000 }, '2026-10-30');
  const noArea = asset('dat', 'real_estate', 1000 * M, 1200 * M, { areaM2: 0 });
  const b = applyRevaluation(noArea, { totalValue: 1300 * M }, '2026-10-30');
  return getUnitPricing(re)!.unit === 'm²' && a.currentValue === 3_483_000_000 && (a.metadata as any).estimatedMarketPrice === 3_483_000_000 &&
    getUnitPricing(noArea) === null && b.currentValue === 1300 * M
    ? true : JSON.stringify([a.currentValue, b.currentValue]);
});
t('R5f', 'Tiết kiệm / tài sản khác: không có đơn giá → nhập tổng giá trị, lịch sử không có đơn giá', () => {
  const sv = asset('sv', 'savings', 200 * M, 211.2 * M, { depositAmount: 200 * M });
  const a = applyRevaluation(sv, { totalValue: 212 * M }, '2026-10-30');
  return getUnitPricing(sv) === null && a.currentValue === 212 * M && a.valuationHistory![0].unitPrice === undefined && !('unitPrice' in a.valuationHistory![0])
    ? true : JSON.stringify(a.valuationHistory);
});
t('R5g', 'Giá không hợp lệ (0, âm, NaN, thiếu) → giữ nguyên tài sản', () => {
  const s0 = stock();
  const bad = [{ unitPrice: 0 }, { unitPrice: -5 }, { unitPrice: NaN }, {}, { totalValue: 0 }];
  const same = bad.every((b) => applyRevaluation(s0, b as any, '2026-10-30') === s0);
  const sv = asset('sv', 'savings', 1, 1, {});
  return same && applyRevaluation(sv, { unitPrice: 5 }, '2026-10-30') === sv ? true : 'có đầu vào xấu vẫn bị ghi';
});
t('R5h', 'Sau khi bán một phần: đơn giá tính theo số lượng còn lại', () => {
  const left = asset('fpt', 'stock', 115 * M, 138 * M, { quantity: 1000, currentPrice: 138000 });
  return getUnitPricing(left)!.unitPrice === 138000 && totalFromUnitPrice(1000, 140000) === 140 * M ? true : 'sai đơn giá';
});
t('R5i', 'Số lượng 0 / thiếu → không có đơn giá (không chia cho 0)', () => {
  return getUnitPricing(asset('x', 'stock', 0, 0, { quantity: 0 })) === null && getUnitPricing(asset('y', 'gold', 0, 0, {})) === null ? true : 'lỗi';
});

// ================= R6: mỗi tháng chỉ trả một kỳ =================
function debtWith(startDate: string, payday: number, paidCount: number, paidDate: string, tenor = 12): Debt {
  const schedule = generateAmortizationSchedule(120 * M, 12, tenor, startDate, payday, 'declining_balance')
    .map((it, i) => (i < paidCount ? { ...it, isPaid: true, paidDate: it.dueDate } : it));
  return {
    id: 'd', name: 'd', lender: 'NH', category: 'consumer_loan', securityType: 'unsecured', principalAmount: 120 * M,
    remainingPrincipal: 120 * M, annualInterestRate: 12, rateType: 'fixed', tenorMonths: tenor, startDate, paymentDayOfMonth: payday,
    method: 'declining_balance', status: 'active', schedule,
  };
}
const payIdx = (d: Debt, idx: number, date: string): Debt => ({
  ...d, schedule: d.schedule!.map((it, i) => (i === idx ? { ...it, isPaid: true, paidDate: date } : it)),
});
t('R6a', 'endOfMonthStr: tháng 2 thường/nhuận, tháng 12', () => {
  return endOfMonthStr('2026-02-10') === '2026-02-28' && endOfMonthStr('2028-02-01') === '2028-02-29' && endOfMonthStr('2026-12-05') === '2026-12-31'
    ? true : 'sai ngày cuối tháng';
});
t('R6b', 'Trả một kỳ xong thì bấm lại bị chặn (kỳ sau đến hạn tháng sau)', () => {
  // kỳ 1..8 đã trả (đến hạn 10/02..10/09); kỳ 9 đến hạn 10/10 – tháng hiện tại 10/2026
  let d = debtWith('2026-01-10', 10, 8, '2026-09-10');
  const today = '2026-10-05';
  if (!checkPayable(d, 8, today).ok) return 'kỳ 9 (đến hạn 10/10) phải trả được trong tháng 10';
  d = payIdx(d, 8, today);
  const c = checkPayable(d, 9, today);
  return !c.ok && c.reason === 'month_locked' && c.dueDate === '2026-11-10' && c.unlockDate === '2026-11-01' && c.paidThisMonth === true && payLockLabel(c) === 'Đã trả tháng này'
    ? true : JSON.stringify(c);
});
t('R6c', 'Sang tháng mới thì mở lại (đúng mùng 1, không sớm hơn)', () => {
  let d = payIdx(debtWith('2026-01-10', 10, 8, '2026-09-10'), 8, '2026-10-05');
  return !checkPayable(d, 9, '2026-10-31').ok && checkPayable(d, 9, '2026-11-01').ok && checkPayable(d, 9, '2026-11-20').ok
    ? true : 'sai thời điểm mở khóa';
});
t('R6d', 'Hai kỳ quá hạn trả bù được liên tiếp trong cùng tháng, kỳ của tháng sau vẫn khóa', () => {
  // kỳ 1..6 đã trả; 7 (10/08) và 8 (10/09) quá hạn, 9 đến hạn 10/10, 10 đến hạn 10/11. Hôm nay 05/10.
  let d = debtWith('2026-01-10', 10, 6, '2026-07-10');
  const today = '2026-10-05';
  const log: string[] = [];
  for (let idx = 6; idx <= 8; idx++) {
    const c = checkPayable(d, idx, today);
    log.push(`${idx + 1}:${c.ok}`);
    if (!c.ok) return 'kỳ ' + (idx + 1) + ' bị chặn: ' + JSON.stringify(c);
    d = payIdx(d, idx, today);
  }
  const c = checkPayable(d, 9, today);
  return !c.ok && c.reason === 'month_locked' ? true : 'kỳ 10 phải bị khóa ' + JSON.stringify(c);
});
t('R6e', 'Vẫn phải trả đúng thứ tự: kỳ sau bị chặn "out_of_order" khi kỳ trước chưa trả', () => {
  const d = debtWith('2026-01-10', 10, 6, '2026-07-10');
  const c = checkPayable(d, 8, '2026-10-05');
  return !c.ok && c.reason === 'out_of_order' ? true : JSON.stringify(c);
});
t('R6f', 'Khoản vay mới: kỳ 1 đến hạn tháng sau → khóa, nhãn "Chưa đến kỳ"', () => {
  const d = debtWith('2026-10-15', 15, 0, '');
  const c = checkPayable(d, 0, '2026-10-30');
  return !c.ok && c.reason === 'month_locked' && c.paidThisMonth === false && payLockLabel(c) === 'Chưa đến kỳ' && c.unlockDate === '2026-11-01'
    ? true : JSON.stringify(c);
});
t('R6g', 'Kỳ đến hạn đúng ngày cuối tháng (31) vẫn trả được trong tháng đó; qua năm: 31/12 → 01/01', () => {
  const d = debtWith('2026-09-05', 31, 0, '');           // kỳ 1: 31/10
  const e = debtWith('2026-11-05', 10, 0, '');           // kỳ 1: 10/12 ; kỳ 2: 10/01/2027
  const e2 = payIdx(e, 0, '2026-12-02');
  const c = checkPayable(e2, 1, '2026-12-31');
  return checkPayable(d, 0, '2026-10-01').ok && !c.ok && c.unlockDate === '2027-01-01' && checkPayable(e2, 1, '2027-01-01').ok
    ? true : JSON.stringify([d.schedule![0].dueDate, c]);
});
t('R6h', 'Đã trả / đã tất toán / không có kỳ → chặn đúng lý do', () => {
  const d = debtWith('2026-01-10', 10, 8, '2026-09-10');
  const paid = checkPayable(d, 0, '2026-10-05');
  const miss = checkPayable(d, 99, '2026-10-05');
  const closed = checkPayable({ ...d, status: 'paid_off' }, 8, '2026-10-05');
  return paid.reason === 'paid' && miss.reason === 'missing' && closed.reason === 'closed' ? true : JSON.stringify([paid, miss, closed]);
});
t('R6i', 'Lịch (Calendar): kỳ bị khóa có payLocked, kỳ được trả có payable', () => {
  const stBase = normalizeState({ wallet: { availableCash: 500 * M }, assets: [], debts: [], transactions: [] })!;
  let d = payIdx(debtWith('2026-01-10', 10, 8, '2026-09-10'), 8, '2026-10-05');
  const today = '2026-10-05';
  const st = { ...stBase, debts: [d] };
  const oct = buildMonthEvents(st, 2026, 10, today).filter((e) => e.kind.startsWith('debt'));
  const nov = buildMonthEvents(st, 2026, 11, today).filter((e) => e.kind.startsWith('debt'));
  const d1 = payIdx(debtWith('2026-01-10', 10, 8, '2026-09-10'), 7, '2026-09-10'); // chưa trả kỳ 9
  const open = buildMonthEvents({ ...stBase, debts: [d1] }, 2026, 10, today).filter((e) => e.kind.startsWith('debt'));
  return oct.length === 1 && !oct[0].payable && !oct[0].payLocked &&         // tháng 10: kỳ đã trả
    nov.length === 1 && !nov[0].payable && nov[0].payLocked?.paidThisMonth === true && nov[0].payLocked.unlockDate === '2026-11-01' &&
    open.length === 1 && open[0].payable === true && !open[0].payLocked
    ? true : JSON.stringify([oct, nov, open].map(x => x.map(e => [e.kind, e.payable, e.payLocked])));
});

// ================= R8: lọc lịch sử giao dịch =================
const tx = (id: string, date: string, type: CashTransaction['type'], amount: number): CashTransaction => ({ id, date, type, amount, title: id });
// Sổ mới → cũ như app (unshift). Tiền ví hiện tại = 1.000
const LEDGER = [
  tx('t1', '2026-10-20', 'deposit', 500),
  tx('t2', '2026-10-10', 'debt_payment', 200),
  tx('t3', '2026-09-15', 'deposit', 700),
];
t('R8a', 'Bộ lọc nhanh: tháng này / tháng trước / 30 ngày / quý này / năm nay / tất cả', () => {
  const today = '2026-10-30';
  const r = (p: any) => rangeForPreset(p, today);
  const ok =
    JSON.stringify(r('this_month')) === JSON.stringify({ from: '2026-10-01', to: '2026-10-30' }) &&
    JSON.stringify(r('last_month')) === JSON.stringify({ from: '2026-09-01', to: '2026-09-30' }) &&
    JSON.stringify(r('last_30')) === JSON.stringify({ from: '2026-10-01', to: '2026-10-30' }) &&
    JSON.stringify(r('this_quarter')) === JSON.stringify({ from: '2026-10-01', to: '2026-10-30' }) &&
    JSON.stringify(r('this_year')) === JSON.stringify({ from: '2026-01-01', to: '2026-10-30' }) &&
    JSON.stringify(r('all')) === JSON.stringify({ from: '', to: '' });
  return ok && RANGE_PRESETS.length === 6 ? true : JSON.stringify(RANGE_PRESETS.map((p) => r(p.id)));
});
t('R8b', 'Biên: tháng trước của tháng 1 (qua năm) và của tháng 3 (tháng 2), quý 3', () => {
  const a = rangeForPreset('last_month', '2026-01-15');
  const b = rangeForPreset('last_month', '2026-03-10');
  const c = rangeForPreset('this_quarter', '2026-08-05');
  const d = rangeForPreset('last_month', '2028-03-01');
  return a.from === '2025-12-01' && a.to === '2025-12-31' && b.to === '2026-02-28' && c.from === '2026-07-01' && d.to === '2028-02-29'
    ? true : JSON.stringify([a, b, c, d]);
});
t('R8c', 'addDaysStr không lệch theo múi giờ, qua tháng/năm', () => {
  return addDaysStr('2026-10-30', -29) === '2026-10-01' && addDaysStr('2026-03-01', -1) === '2026-02-28' && addDaysStr('2026-12-31', 1) === '2027-01-01'
    ? true : 'sai';
});
t('R8d', 'inRange: gồm cả hai đầu; trống = không giới hạn; từ > đến là không hợp lệ', () => {
  const r = { from: '2026-10-01', to: '2026-10-31' };
  return inRange('2026-10-01', r) && inRange('2026-10-31', r) && !inRange('2026-09-30', r) && !inRange('2026-11-01', r) &&
    inRange('1999-01-01', { from: '', to: '' }) && inRange('2026-10-20', { from: '2026-10-01', to: '' }) &&
    isRangeInvalid({ from: '2026-10-31', to: '2026-10-01' }) && !isRangeInvalid({ from: '', to: '2026-10-01' })
    ? true : 'sai';
});
t('R8e', 'Tổng khoảng "Tháng này": vào 500, ra 200, chênh 300, đầu kỳ 700, cuối kỳ 1.000', () => {
  const range = rangeForPreset('this_month', '2026-10-30');
  const vis = LEDGER.filter((x) => inRange(x.date, range));
  const s = summarizeLedger(LEDGER, vis, 1000, range);
  return vis.length === 2 && s.inflow === 500 && s.outflow === 200 && s.net === 300 && s.openingBalance === 700 && s.closingBalance === 1000 && s.count === 2
    ? true : JSON.stringify(s);
});
t('R8f', 'Tổng khoảng "Tháng trước": đầu kỳ 0, cuối kỳ 700; đầu kỳ + chênh lệch = cuối kỳ', () => {
  const range = rangeForPreset('last_month', '2026-10-30');
  const vis = LEDGER.filter((x) => inRange(x.date, range));
  const s = summarizeLedger(LEDGER, vis, 1000, range);
  return s.openingBalance === 0 && s.closingBalance === 700 && s.openingBalance + s.net === s.closingBalance ? true : JSON.stringify(s);
});
t('R8g', 'Mọi thời gian: đầu kỳ = số dư trước giao dịch đầu tiên, cuối kỳ = tiền ví hiện tại', () => {
  const range = rangeForPreset('all', '2026-10-30');
  const s = summarizeLedger(LEDGER, LEDGER, 1000, range);
  return s.openingBalance === 0 && s.closingBalance === 1000 && s.inflow === 1200 && s.outflow === 200 ? true : JSON.stringify(s);
});
t('R8h', 'Kết hợp bộ lọc loại: tổng vào/ra theo dòng đang hiện, số dư đầu/cuối vẫn theo toàn sổ', () => {
  const range = rangeForPreset('this_month', '2026-10-30');
  const vis = LEDGER.filter((x) => inRange(x.date, range) && x.type === 'debt_payment');
  const s = summarizeLedger(LEDGER, vis, 1000, range);
  return s.inflow === 0 && s.outflow === 200 && s.net === -200 && s.openingBalance === 700 && s.closingBalance === 1000 ? true : JSON.stringify(s);
});
t('R8i', 'Sổ nhập không theo thứ tự ngày: số dư đầu/cuối vẫn đúng (tính theo ngày giao dịch)', () => {
  const shuffled = [LEDGER[2], LEDGER[0], LEDGER[1]];
  const range = rangeForPreset('last_month', '2026-10-30');
  const vis = shuffled.filter((x) => inRange(x.date, range));
  const s = summarizeLedger(shuffled, vis, 1000, range);
  return s.openingBalance === 0 && s.closingBalance === 700 ? true : JSON.stringify(s);
});
t('R8j', 'Khoảng không có giao dịch: tổng 0, đầu kỳ = cuối kỳ', () => {
  const range = { from: '2026-05-01', to: '2026-05-31' };
  const s = summarizeLedger(LEDGER, [], 1000, range);
  return s.inflow === 0 && s.outflow === 0 && s.openingBalance === 0 && s.closingBalance === 0 ? true : JSON.stringify(s);
});

console.log(`\n==== phase1: ${pass} pass / ${fail} fail ====`);
process.exit(fail ? 1 : 0);
