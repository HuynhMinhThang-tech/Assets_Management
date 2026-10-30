/**
 * Bảng cân đối tài sản và nợ + các chỉ số phân tích.
 *
 *   Tổng tài sản = tiền mặt ví + thị giá các tài sản đang nắm giữ
 *   Nợ phải trả  = dư nợ gốc các khoản vay đang hoạt động
 *   Vốn chủ sở hữu (tài sản ròng) = Tổng tài sản − Nợ phải trả      (khớp "Tài sản ròng" ở Tổng quan)
 *
 * Phân loại ngắn hạn / dài hạn theo chuẩn kế toán: trong vòng 12 tháng tới hay không.
 *   - Tài sản ngắn hạn: tiền mặt, cổ phiếu, chứng chỉ quỹ, vàng, tiền gửi/trái phiếu đáo hạn trong 12 tháng.
 *   - Tài sản dài hạn: bất động sản, tài sản khác, tiền gửi/trái phiếu đáo hạn sau 12 tháng.
 *   - Nợ ngắn hạn: phần gốc phải trả trong 12 tháng tới (kể cả kỳ đã quá hạn chưa trả). Phần còn lại là nợ dài hạn.
 */
import { Asset, Debt, UserFinancialState } from '../types/finance';
import {
  addMonthsStr,
  calculateCollateralMetrics,
  getNextDuePayment,
  getSavingsAccrual,
  todayLocalStr,
} from './calculations';

export type RatioStatus = 'good' | 'watch' | 'risk';

export interface BalanceLine {
  key: string;
  label: string;
  value: number;
  count: number;
}

export interface DebtLine {
  key: string;
  label: string;
  value: number;
}

export interface BalanceSheet {
  asOf: string;
  currentAssets: { lines: BalanceLine[]; total: number };
  nonCurrentAssets: { lines: BalanceLine[]; total: number };
  totalAssets: number;
  currentLiabilities: { lines: DebtLine[]; total: number };
  nonCurrentLiabilities: { lines: DebtLine[]; total: number };
  totalLiabilities: number;
  equity: {
    total: number;
    /** Vốn nạp ròng = tổng đã nạp − tổng đã rút khỏi ví. */
    contributed: number;
    /** Phần còn lại của vốn chủ (lãi/lỗ lũy kế, chênh lệch đánh giá lại...). */
    retained: number;
  };
  totalLiabilitiesAndEquity: number;
  ratios: BalanceRatios;
}

export interface BalanceRatios {
  /** Nợ / Tổng tài sản (tỷ lệ 0..1). null nếu chưa có tài sản. */
  debtToAssets: number | null;
  /** Nợ / Vốn chủ sở hữu. null nếu vốn chủ ≤ 0. */
  debtToEquity: number | null;
  /** Vốn chủ / Tổng tài sản. */
  equityRatio: number | null;
  /** Tổng tài sản / Vốn chủ (đòn bẩy tài chính). null nếu vốn chủ ≤ 0. */
  leverage: number | null;
  /** Tài sản ngắn hạn / Nợ ngắn hạn. null nếu không có nợ ngắn hạn. */
  currentRatio: number | null;
  /** Tiền mặt / Nợ ngắn hạn. null nếu không có nợ ngắn hạn. */
  cashRatio: number | null;
  /** Tài sản ngắn hạn / Tổng tài sản. */
  liquidShare: number | null;
  /** Nghĩa vụ trả nợ hàng tháng (gốc + lãi) của các khoản đang hoạt động, VND. */
  monthlyObligation: number;
  /** Số tháng có thể trả nợ bằng tiền mặt trong ví. null nếu không có nghĩa vụ trả nợ. */
  cashMonths: number | null;
  /** Thu nhập cho thuê hàng tháng / Nghĩa vụ trả nợ hàng tháng. null nếu không có nghĩa vụ trả nợ. */
  rentCoverage: number | null;
  /** Thu nhập cho thuê hàng tháng, VND. */
  monthlyRentalIncome: number;
  /** Lãi suất vay bình quân gia quyền theo dư nợ (%/năm). null nếu không có nợ. */
  weightedRate: number | null;
  /** LTV bình quân của các khoản vay thế chấp (tỷ lệ 0..1). null nếu không có khoản thế chấp. */
  ltv: number | null;
}

/** Phần gốc phải trả trong 12 tháng tới của một khoản nợ (đã bao gồm các kỳ quá hạn chưa trả). */
export function shortTermPrincipal(debt: Debt, today: string = todayLocalStr()): number {
  const remaining = Math.max(0, debt.remainingPrincipal);
  if (remaining === 0) return 0;
  const horizon = addMonthsStr(today, 12);

  let due = 0;
  if (debt.schedule && debt.schedule.length > 0) {
    for (const item of debt.schedule) {
      if (!item.isPaid && item.dueDate <= horizon) due += item.principalPayable;
    }
  } else {
    const monthly = debt.tenorMonths > 0 ? debt.principalAmount / debt.tenorMonths : 0;
    due = monthly * 12;
  }
  return Math.min(remaining, Math.max(0, Math.round(due)));
}

/** Đánh giá mức an toàn theo ngưỡng thông dụng: "càng thấp càng tốt" (nợ, LTV). */
export function statusLowerIsBetter(value: number, good: number, watch: number): RatioStatus {
  if (value <= good) return 'good';
  if (value <= watch) return 'watch';
  return 'risk';
}

/** Đánh giá mức an toàn theo ngưỡng thông dụng: "càng cao càng tốt" (thanh khoản, vốn chủ). */
export function statusHigherIsBetter(value: number, good: number, watch: number): RatioStatus {
  if (value >= good) return 'good';
  if (value >= watch) return 'watch';
  return 'risk';
}

export function calculateBalanceSheet(state: UserFinancialState, today: string = todayLocalStr()): BalanceSheet {
  const cash = state.wallet.availableCash;
  const activeAssets = state.assets.filter((a) => a.status === 'active');
  const activeDebts = state.debts.filter((d) => d.status === 'active' && d.remainingPrincipal > 0);

  const sum = (list: Asset[]) => list.reduce((s, a) => s + a.currentValue, 0);
  const byCat = (cat: Asset['category']) => activeAssets.filter((a) => a.category === cat);
  const line = (key: string, label: string, list: Asset[]): BalanceLine => ({
    key,
    label,
    value: sum(list),
    count: list.length,
  });

  const savings = byCat('savings');
  const savingsShort = savings.filter((a) => getSavingsAccrual(a, today).daysToMaturity <= 365);
  const savingsLong = savings.filter((a) => getSavingsAccrual(a, today).daysToMaturity > 365);

  const currentAssetLines: BalanceLine[] = [
    { key: 'cash', label: 'Tiền mặt (ví đầu tư)', value: cash, count: 0 },
    line('savings_short', 'Tiền gửi / Trái phiếu (đáo hạn ≤ 12 tháng)', savingsShort),
    line('stock', 'Cổ phiếu niêm yết', byCat('stock')),
    line('fund', 'Chứng chỉ quỹ', byCat('fund')),
    line('gold', 'Vàng & kim loại quý', byCat('gold')),
  ];
  const nonCurrentAssetLines: BalanceLine[] = [
    line('real_estate', 'Bất động sản', byCat('real_estate')),
    line('savings_long', 'Tiền gửi / Trái phiếu (đáo hạn > 12 tháng)', savingsLong),
    line('other', 'Tài sản khác', byCat('other')),
  ];

  const currentAssetsTotal = currentAssetLines.reduce((s, l) => s + l.value, 0);
  const nonCurrentAssetsTotal = nonCurrentAssetLines.reduce((s, l) => s + l.value, 0);
  const totalAssets = currentAssetsTotal + nonCurrentAssetsTotal;

  // ---- Nợ phải trả ----
  const currentLiabLines: DebtLine[] = [];
  const nonCurrentLiabLines: DebtLine[] = [];
  for (const d of activeDebts) {
    const short = shortTermPrincipal(d, today);
    const long = Math.max(0, d.remainingPrincipal - short);
    const label = d.lender ? `${d.name} – ${d.lender}` : d.name;
    if (short > 0) currentLiabLines.push({ key: d.id, label, value: short });
    if (long > 0) nonCurrentLiabLines.push({ key: d.id, label, value: long });
  }
  const currentLiabTotal = currentLiabLines.reduce((s, l) => s + l.value, 0);
  const nonCurrentLiabTotal = nonCurrentLiabLines.reduce((s, l) => s + l.value, 0);
  const totalLiabilities = currentLiabTotal + nonCurrentLiabTotal;

  // ---- Vốn chủ sở hữu ----
  const equityTotal = totalAssets - totalLiabilities;
  const contributed = state.wallet.totalDeposited - state.wallet.totalWithdrawn;

  // ---- Chỉ số ----
  const monthlyObligation = activeDebts.reduce((s, d) => s + (getNextDuePayment(d)?.total ?? 0), 0);
  const monthlyRentalIncome = activeAssets.reduce((s, a) => {
    if (a.category !== 'real_estate' && a.category !== 'other') return s;
    return s + ((a.metadata as { monthlyRentalIncome?: number }).monthlyRentalIncome || 0);
  }, 0);

  const debtTotal = activeDebts.reduce((s, d) => s + d.remainingPrincipal, 0);
  const weightedRate =
    debtTotal > 0 ? activeDebts.reduce((s, d) => s + d.annualInterestRate * d.remainingPrincipal, 0) / debtTotal : null;

  // LTV bình quân: tổng dư nợ thế chấp / tổng thị giá các tài sản thế chấp (mỗi tài sản tính 1 lần).
  const securedDebts = activeDebts.filter((d) => d.collateralAssetId);
  const collateralIds = new Set<string>();
  let securedDebtTotal = 0;
  let collateralValue = 0;
  for (const d of securedDebts) {
    const asset = activeAssets.find((a) => a.id === d.collateralAssetId);
    if (!asset) continue;
    securedDebtTotal += calculateCollateralMetrics(asset, d).remainingDebt;
    if (!collateralIds.has(asset.id)) {
      collateralIds.add(asset.id);
      collateralValue += asset.currentValue;
    }
  }
  const ltv = collateralValue > 0 ? securedDebtTotal / collateralValue : null;

  const ratios: BalanceRatios = {
    debtToAssets: totalAssets > 0 ? totalLiabilities / totalAssets : null,
    debtToEquity: equityTotal > 0 ? totalLiabilities / equityTotal : null,
    equityRatio: totalAssets > 0 ? equityTotal / totalAssets : null,
    leverage: equityTotal > 0 ? totalAssets / equityTotal : null,
    currentRatio: currentLiabTotal > 0 ? currentAssetsTotal / currentLiabTotal : null,
    cashRatio: currentLiabTotal > 0 ? cash / currentLiabTotal : null,
    liquidShare: totalAssets > 0 ? currentAssetsTotal / totalAssets : null,
    monthlyObligation,
    cashMonths: monthlyObligation > 0 ? cash / monthlyObligation : null,
    rentCoverage: monthlyObligation > 0 ? monthlyRentalIncome / monthlyObligation : null,
    monthlyRentalIncome,
    weightedRate,
    ltv,
  };

  return {
    asOf: today,
    currentAssets: { lines: currentAssetLines, total: currentAssetsTotal },
    nonCurrentAssets: { lines: nonCurrentAssetLines, total: nonCurrentAssetsTotal },
    totalAssets,
    currentLiabilities: { lines: currentLiabLines, total: currentLiabTotal },
    nonCurrentLiabilities: { lines: nonCurrentLiabLines, total: nonCurrentLiabTotal },
    totalLiabilities,
    equity: { total: equityTotal, contributed, retained: equityTotal - contributed },
    totalLiabilitiesAndEquity: totalLiabilities + equityTotal,
    ratios,
  };
}
