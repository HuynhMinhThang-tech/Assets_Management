/**
 * Test bảng cân đối & chỉ số phân tích.
 * Run: npx tsx tests/balanceSheet.test.ts
 */
import { generateAmortizationSchedule, calculateFinancialSummary } from '../src/utils/calculations';
import {
  calculateBalanceSheet, shortTermPrincipal, statusHigherIsBetter, statusLowerIsBetter,
} from '../src/utils/balanceSheet';
import { INITIAL_DEMO_STATE, emptyState, normalizeState } from '../src/utils/storage';
import type { Asset, Debt, UserFinancialState } from '../src/types/finance';

let pass = 0, fail = 0;
function t(id: string, name: string, fn: () => true | string) {
  let r: true | string;
  try { r = fn(); } catch (e: any) { r = 'THROW ' + e.message; }
  if (r === true) { pass++; console.log(`PASS ${id} ${name}`); }
  else { fail++; console.log(`FAIL ${id} ${name}\n       ${r}`); }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const TODAY = '2026-10-29';
const M = 1_000_000;

// (localStorage giả cho storage.ts)
const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};

function asset(id: string, category: Asset['category'], value: number, metadata: any = {}, extra: Partial<Asset> = {}): Asset {
  return {
    id, name: id, category, initialCost: value, currentValue: value, purchaseDate: '2026-01-01', status: 'active',
    metadata, realizedPnL: 0, lastValuationDate: '2026-01-01', ...extra,
  };
}
function debt(id: string, principal: number, tenor: number, rate: number, payday: number, extra: Partial<Debt> = {}): Debt {
  return {
    id, name: id, lender: 'NH', category: 'consumer_loan', securityType: 'unsecured',
    principalAmount: principal, remainingPrincipal: principal, annualInterestRate: rate, rateType: 'fixed',
    tenorMonths: tenor, startDate: '2026-10-01', paymentDayOfMonth: payday, method: 'declining_balance',
    status: 'active', schedule: generateAmortizationSchedule(principal, rate, tenor, '2026-10-01', payday, 'declining_balance'),
    ...extra,
  };
}

/** Kịch bản tính tay (đơn vị: triệu đồng). */
function scenario(): UserFinancialState {
  const state = emptyState();
  state.wallet = { availableCash: 100 * M, totalDeposited: 500 * M, totalWithdrawn: 50 * M };
  state.assets = [
    asset('stock1', 'stock', 50 * M),
    asset('gold1', 'gold', 20 * M),
    asset('sav_short', 'savings', 30 * M, { startDate: '2026-03-01', maturityDate: '2027-03-01', depositAmount: 30 * M, annualInterestRate: 5 }),
    asset('sav_long', 'savings', 40 * M, { startDate: '2026-01-01', maturityDate: '2029-01-01', depositAmount: 40 * M, annualInterestRate: 6 }),
    asset('house', 'real_estate', 400 * M, { monthlyRentalIncome: 3 * M }),
    asset('car', 'other', 10 * M, { monthlyRentalIncome: 1 * M }),
    asset('sold1', 'stock', 999 * M, {}, { status: 'sold' }),
  ];
  state.debts = [
    debt('mortgage', 240 * M, 240, 10, 15, { collateralAssetId: 'house', securityType: 'secured', category: 'mortgage' }),
    debt('consumer', 36 * M, 36, 15, 20),
    debt('old', 100 * M, 10, 9, 5, { status: 'paid_off', remainingPrincipal: 0 }),
  ];
  return state;
}

// ===== B1: đẳng thức kế toán trên dữ liệu mẫu của app =====
t('B1', 'dữ liệu mẫu: Tài sản = Nợ + Vốn chủ và Vốn chủ = Tài sản ròng ở Tổng quan', () => {
  const st = normalizeState(JSON.parse(JSON.stringify(INITIAL_DEMO_STATE)));
  if (!st) return 'normalizeState trả về null';
  const bs = calculateBalanceSheet(st, TODAY);
  const sm = calculateFinancialSummary(st);
  if (!near(bs.totalAssets, bs.totalLiabilities + bs.equity.total)) return 'A ≠ L + E';
  if (!near(bs.totalLiabilitiesAndEquity, bs.totalAssets)) return 'tổng nguồn vốn ≠ tổng tài sản';
  if (!near(bs.equity.total, sm.netWorth)) return `vốn chủ ${bs.equity.total} ≠ netWorth ${sm.netWorth}`;
  if (!near(bs.totalLiabilities, sm.totalDebtBalance)) return `nợ ${bs.totalLiabilities} ≠ ${sm.totalDebtBalance}`;
  if (!near(bs.totalAssets, sm.totalAssetValue + sm.availableCash)) return 'tổng tài sản ≠ thị giá + tiền mặt';
  if (!near(bs.currentAssets.total + bs.nonCurrentAssets.total, bs.totalAssets)) return 'ngắn hạn + dài hạn ≠ tổng';
  if (!near(bs.currentLiabilities.total + bs.nonCurrentLiabilities.total, bs.totalLiabilities)) return 'nợ NH + DH ≠ tổng nợ';
  return true;
});

// ===== B2: kịch bản tính tay =====
t('B2', 'phân loại ngắn hạn/dài hạn và tổng (tài sản bán rồi / nợ đã tất toán bị loại)', () => {
  const bs = calculateBalanceSheet(scenario(), TODAY);
  if (bs.currentAssets.total !== 200 * M) return 'TS ngắn hạn ' + bs.currentAssets.total; // 100 + 50 + 20 + 30
  if (bs.nonCurrentAssets.total !== 450 * M) return 'TS dài hạn ' + bs.nonCurrentAssets.total; // 400 + 40 + 10
  if (bs.totalAssets !== 650 * M) return 'tổng TS ' + bs.totalAssets;
  const k = (key: string) => [...bs.currentAssets.lines, ...bs.nonCurrentAssets.lines].find((l) => l.key === key)!.value;
  if (k('savings_short') !== 30 * M || k('savings_long') !== 40 * M) return 'tách tiền gửi theo kỳ hạn sai';
  return true;
});

t('B3', 'nợ ngắn hạn = gốc 12 tháng tới; nợ dài hạn = phần còn lại', () => {
  const st = scenario();
  const bs = calculateBalanceSheet(st, TODAY);
  const mort = st.debts[0];
  const due12 = mort.schedule!.filter((i) => !i.isPaid && i.dueDate <= '2027-10-29');
  if (due12.length !== 12) return `số kỳ trong 12 tháng = ${due12.length} (mong đợi 12)`;
  if (bs.currentLiabilities.total !== 24 * M) return 'nợ ngắn hạn ' + bs.currentLiabilities.total; // 12 × 1tr + 12 × 1tr
  if (bs.nonCurrentLiabilities.total !== 252 * M) return 'nợ dài hạn ' + bs.nonCurrentLiabilities.total; // 228 + 24
  if (bs.totalLiabilities !== 276 * M) return 'tổng nợ ' + bs.totalLiabilities;
  if (bs.currentLiabilities.lines.length !== 2) return 'số dòng nợ NH ' + bs.currentLiabilities.lines.length;
  return true;
});

t('B4', 'vốn chủ = tài sản − nợ; vốn nạp ròng + lãi/lỗ lũy kế = vốn chủ', () => {
  const bs = calculateBalanceSheet(scenario(), TODAY);
  if (bs.equity.total !== 374 * M) return 'vốn chủ ' + bs.equity.total;
  if (bs.equity.contributed !== 450 * M) return 'vốn nạp ròng ' + bs.equity.contributed;
  if (bs.equity.retained !== -76 * M) return 'lãi/lỗ lũy kế ' + bs.equity.retained;
  if (bs.equity.contributed + bs.equity.retained !== bs.equity.total) return 'không cộng lại bằng vốn chủ';
  return true;
});

t('B5', 'các chỉ số khớp phép tính tay', () => {
  const r = calculateBalanceSheet(scenario(), TODAY).ratios;
  if (!near(r.debtToAssets!, 276 / 650)) return 'nợ/tài sản ' + r.debtToAssets;
  if (!near(r.debtToEquity!, 276 / 374)) return 'nợ/vốn chủ ' + r.debtToEquity;
  if (!near(r.equityRatio!, 374 / 650)) return 'vốn chủ/tài sản ' + r.equityRatio;
  if (!near(r.leverage!, 650 / 374)) return 'đòn bẩy ' + r.leverage;
  if (!near(r.currentRatio!, 200 / 24)) return 'thanh toán hiện hành ' + r.currentRatio;
  if (!near(r.cashRatio!, 100 / 24)) return 'tỷ số tiền mặt ' + r.cashRatio;
  if (!near(r.liquidShare!, 200 / 650)) return 'tỷ trọng ngắn hạn ' + r.liquidShare;
  // kỳ đầu: gốc 1tr + lãi (dư nợ × lãi suất / 12): 240tr×10%/12 = 2tr ; 36tr×15%/12 = 0,45tr
  if (r.monthlyObligation !== 4_450_000) return 'nghĩa vụ hàng tháng ' + r.monthlyObligation;
  if (!near(r.cashMonths!, 100 * M / 4_450_000)) return 'số tháng trả bằng tiền mặt ' + r.cashMonths;
  if (r.monthlyRentalIncome !== 4 * M) return 'thu nhập thuê ' + r.monthlyRentalIncome;
  if (!near(r.rentCoverage!, 4 * M / 4_450_000)) return 'thuê/nghĩa vụ ' + r.rentCoverage;
  if (!near(r.weightedRate!, (10 * 240 + 15 * 36) / 276)) return 'lãi suất bình quân ' + r.weightedRate;
  if (!near(r.ltv!, 240 / 400)) return 'LTV ' + r.ltv; // chỉ nợ thế chấp / thị giá nhà
  return true;
});

// ===== B6: trường hợp biên =====
t('B6', 'state rỗng: toàn 0, chỉ số null, không lỗi chia 0', () => {
  const bs = calculateBalanceSheet(emptyState(), TODAY);
  if (bs.totalAssets !== 0 || bs.totalLiabilities !== 0 || bs.equity.total !== 0) return 'tổng khác 0';
  const r = bs.ratios;
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'number' && !Number.isFinite(v)) return `${k} không hữu hạn`;
  }
  if (r.debtToAssets !== null || r.currentRatio !== null || r.cashMonths !== null || r.weightedRate !== null || r.ltv !== null) return 'nên là null';
  return true;
});

t('B7', 'không có nợ ngắn hạn → tỷ số thanh toán là null (không phải Infinity)', () => {
  const st = emptyState();
  st.wallet.availableCash = 50 * M;
  const bs = calculateBalanceSheet(st, TODAY);
  if (bs.ratios.currentRatio !== null || bs.ratios.cashRatio !== null) return 'phải là null';
  if (bs.ratios.debtToAssets !== 0) return 'nợ/tài sản phải = 0, got ' + bs.ratios.debtToAssets;
  return true;
});

t('B8', 'nợ lớn hơn tài sản: vốn chủ âm, nợ/vốn chủ = null, nợ/tài sản > 1', () => {
  const st = emptyState();
  st.wallet.availableCash = 10 * M;
  st.debts = [debt('big', 100 * M, 120, 12, 10)];
  const bs = calculateBalanceSheet(st, TODAY);
  if (bs.equity.total !== -90 * M) return 'vốn chủ ' + bs.equity.total;
  if (bs.ratios.debtToEquity !== null || bs.ratios.leverage !== null) return 'nợ/vốn chủ phải null khi vốn chủ ≤ 0';
  if (!(bs.ratios.debtToAssets! > 1)) return 'nợ/tài sản ' + bs.ratios.debtToAssets;
  return true;
});

t('B9', 'khoản nợ không có lịch trả: ước tính gốc/tháng × 12, không vượt dư nợ', () => {
  const d = { ...debt('x', 120 * M, 24, 10, 10), schedule: undefined } as Debt;
  if (shortTermPrincipal(d, TODAY) !== 60 * M) return 'got ' + shortTermPrincipal(d, TODAY); // 5tr × 12
  const small = { ...d, remainingPrincipal: 20 * M } as Debt;
  if (shortTermPrincipal(small, TODAY) !== 20 * M) return 'phải chặn bởi dư nợ, got ' + shortTermPrincipal(small, TODAY);
  return true;
});

t('B10', 'kỳ quá hạn chưa trả được tính vào nợ ngắn hạn', () => {
  const d = debt('late', 12 * M, 12, 10, 10, { startDate: '2026-01-01' });
  d.schedule = generateAmortizationSchedule(12 * M, 10, 12, '2026-01-01', 10, 'declining_balance');
  // tất cả 12 kỳ (T2/2026 … T1/2027) chưa trả; mốc 12 tháng tới 2027-10-29 → cả 12 kỳ đều ≤ mốc
  if (shortTermPrincipal(d, TODAY) !== 12 * M) return 'got ' + shortTermPrincipal(d, TODAY);
  return true;
});

t('B11', 'ngưỡng đánh giá: biên thuộc nhóm tốt hơn', () => {
  if (statusLowerIsBetter(0.4, 0.4, 0.6) !== 'good') return 'lower 0.4';
  if (statusLowerIsBetter(0.5, 0.4, 0.6) !== 'watch') return 'lower 0.5';
  if (statusLowerIsBetter(0.6, 0.4, 0.6) !== 'watch') return 'lower 0.6';
  if (statusLowerIsBetter(0.61, 0.4, 0.6) !== 'risk') return 'lower 0.61';
  if (statusHigherIsBetter(1.5, 1.5, 1) !== 'good') return 'higher 1.5';
  if (statusHigherIsBetter(1.2, 1.5, 1) !== 'watch') return 'higher 1.2';
  if (statusHigherIsBetter(0.99, 1.5, 1) !== 'risk') return 'higher 0.99';
  return true;
});

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
