import {
  Asset,
  Debt,
  AmortizationScheduleItem,
  PaymentMethod,
  UserFinancialState,
  SavingsMetadata,
} from '../types/finance';

/**
 * Format currency in VND with readable compact units (Tỷ, Triệu) or exact comma format.
 */
export function formatVND(
  amount: number,
  options?: { compact?: boolean; hideSymbol?: boolean }
): string {
  const isNegative = amount < 0;
  const absAmount = Math.abs(amount);
  const symbol = options?.hideSymbol ? '' : ' ₫';

  if (options?.compact) {
    if (absAmount >= 1_000_000_000) {
      const ty = absAmount / 1_000_000_000;
      return `${isNegative ? '-' : ''}${ty.toFixed(2).replace(/\.00$/, '')} tỷ${symbol}`;
    }
    if (absAmount >= 1_000_000) {
      const trieu = absAmount / 1_000_000;
      return `${isNegative ? '-' : ''}${trieu.toFixed(1).replace(/\.0$/, '')} tr${symbol}`;
    }
  }

  // Exact format: 1.250.000.000 ₫
  const formatted = Math.round(absAmount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${isNegative ? '-' : ''}${formatted}${symbol}`;
}

/**
 * Format percentage: e.g. 12.5%
 */
export function formatPercent(rate: number, digits = 1): string {
  const sign = rate > 0 ? '+' : '';
  return `${sign}${rate.toFixed(digits)}%`;
}


// ============================================================================
// DATE HELPERS  (theo GIỜ ĐỊA PHƯƠNG, không dùng toISOString → tránh lệch ngày ở UTC+7)
// ============================================================================

/** Ngày hôm nay dạng YYYY-MM-DD theo giờ máy người dùng (VN = UTC+7). */
export function todayLocalStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseYMD(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = (s || '').slice(0, 10).split('-').map(Number);
  return { y: y || 1970, m: m || 1, d: d || 1 };
}

/** Số ngày trong tháng m (1-12). */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Chuyển YYYY-MM-DD sang số ngày kể từ epoch (UTC, không phụ thuộc múi giờ). */
export function dayNumber(s: string): number {
  const { y, m, d } = parseYMD(s);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Số ngày a − b (a, b dạng YYYY-MM-DD). */
export function diffDays(a: string, b: string): number {
  return dayNumber(a) - dayNumber(b);
}

/**
 * Cộng `months` tháng vào tháng của startStr rồi đặt ngày = dayOfMonth,
 * nếu tháng đó ngắn hơn thì lấy NGÀY CUỐI THÁNG (31 → 28/29/30 tùy tháng).
 * Không bao giờ nhảy sang tháng sau (lỗi setMonth cũ) và không bị ép về 28.
 */
export function dueDateFor(startStr: string, months: number, dayOfMonth: number): string {
  const { y, m } = parseYMD(startStr);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const day = Math.min(Math.max(1, dayOfMonth || 1), daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Cộng thêm số tháng vào một ngày (dùng cho ngày đáo hạn tiết kiệm). */
export function addMonthsStr(startStr: string, months: number): string {
  return dueDateFor(startStr, months, parseYMD(startStr).d);
}

/**
 * Generate full monthly amortization schedule for a loan.
 * - Ngày đến hạn đúng ngày trả hàng tháng (ngày 29-31 → cuối tháng nếu tháng ngắn).
 * - graceMonths: số tháng ân hạn gốc đầu kỳ (chỉ trả lãi), gốc được chia/niên kim trên các kỳ còn lại.
 */
export function generateAmortizationSchedule(
  principalAmount: number,
  annualInterestRate: number,
  tenorMonths: number,
  startDateStr: string,
  paymentDayOfMonth: number,
  method: PaymentMethod,
  graceMonths: number = 0
): AmortizationScheduleItem[] {
  const schedule: AmortizationScheduleItem[] = [];
  if (tenorMonths <= 0 || principalAmount <= 0) return schedule;

  const grace = Math.max(0, Math.min(graceMonths || 0, tenorMonths - 1));
  const amortPeriods = tenorMonths - grace;
  const monthlyRate = annualInterestRate / 100 / 12;
  let currentBalance = principalAmount;

  let fixedMonthlyPayment = 0;
  if (method === 'equal_payment') {
    if (monthlyRate > 0) {
      const factor = Math.pow(1 + monthlyRate, amortPeriods);
      fixedMonthlyPayment = Math.round((principalAmount * (monthlyRate * factor)) / (factor - 1));
    } else {
      fixedMonthlyPayment = Math.round(principalAmount / amortPeriods);
    }
  }
  const monthlyPrincipalFixed = principalAmount / amortPeriods;

  for (let period = 1; period <= tenorMonths; period++) {
    const dueDate = dueDateFor(startDateStr, period, paymentDayOfMonth);
    const interestPayable = Math.round(currentBalance * monthlyRate);
    const inGrace = period <= grace;
    const isLastPeriod = period === tenorMonths;

    let principalPayable = 0;
    if (!inGrace) {
      if (method === 'declining_balance') {
        principalPayable = isLastPeriod ? currentBalance : Math.round(monthlyPrincipalFixed);
      } else {
        principalPayable = fixedMonthlyPayment - interestPayable;
        if (isLastPeriod || currentBalance <= principalPayable) principalPayable = currentBalance;
      }
    }
    principalPayable = Math.min(principalPayable, currentBalance);
    currentBalance = Math.max(0, currentBalance - principalPayable);

    schedule.push({
      period,
      dueDate,
      principalPayable,
      interestPayable,
      totalMonthlyPayment: principalPayable + interestPayable,
      remainingBalance: currentBalance,
      isPaid: false,
    });

    if (currentBalance <= 0) break;
  }

  return schedule;
}

/** Dư nợ theo lịch sau kỳ đã trả cuối cùng (nếu chưa trả kỳ nào = gốc vay). */
export function scheduleBalance(debt: Debt): number {
  const paid = (debt.schedule || []).filter((i) => i.isPaid);
  return paid.length ? paid[paid.length - 1].remainingBalance : debt.principalAmount;
}

/**
 * Với khoản vay ĐÃ GIẢI NGÂN trong quá khứ: các kỳ đến hạn trước hôm nay được coi là đã trả
 * (lịch sử, không trừ ví), sau đó căn lại các kỳ còn lại theo dư nợ thực tế người dùng nhập.
 * Kết quả luôn thỏa: Σ gốc các kỳ chưa trả = remainingPrincipal.
 */
export function applyHistoricalPayments(
  debt: Debt,
  actualRemaining?: number,
  today: string = todayLocalStr()
): Debt {
  const schedule = (debt.schedule || []).map((it) =>
    !it.isPaid && it.dueDate < today ? { ...it, isPaid: true, paidDate: it.dueDate } : it
  );
  let result: Debt = { ...debt, schedule };

  if (schedule.length > 0 && schedule.every((i) => i.isPaid)) {
    return { ...result, remainingPrincipal: 0, status: 'paid_off' };
  }

  const target =
    actualRemaining !== undefined && actualRemaining > 0 ? actualRemaining : scheduleBalance(result);
  result = { ...result, remainingPrincipal: target, status: 'active' };

  if (Math.abs(scheduleBalance(result) - target) > 1) {
    result = recalculateFloatingDebt(result, result.annualInterestRate, target);
    // Đối chiếu thực tế: dư nợ sau kỳ đã trả gần nhất = dư nợ người dùng xác nhận
    const sched = [...(result.schedule || [])];
    for (let i = sched.length - 1; i >= 0; i--) {
      if (sched[i].isPaid) {
        sched[i] = { ...sched[i], remainingBalance: target };
        break;
      }
    }
    result = { ...result, schedule: sched };
  }
  return result;
}

/** Chuẩn hóa 1 khoản nợ khi nạp dữ liệu: sinh lịch nếu thiếu, đồng bộ dư nợ, loại tín chấp/thế chấp. */
export function normalizeDebt(d: Debt, today: string = todayLocalStr()): Debt {
  const securityType = d.securityType || (d.collateralAssetId ? 'secured' : 'unsecured');
  if (!d.schedule || d.schedule.length === 0) {
    const schedule = generateAmortizationSchedule(
      d.principalAmount,
      d.annualInterestRate,
      d.tenorMonths,
      d.startDate,
      d.paymentDayOfMonth,
      d.method
    );
    return applyHistoricalPayments({ ...d, securityType, schedule }, d.remainingPrincipal, today);
  }
  return { ...d, securityType };
}

/**
 * Recalculate remaining amortization schedule when floating interest rate changes
 * or when principal is partially paid off ahead of schedule.
 */
export function recalculateFloatingDebt(
  debt: Debt,
  newAnnualInterestRate: number,
  newRemainingPrincipal?: number,
  newBaseRate?: number,
  newFloatingMargin?: number
): Debt {
  const schedule = [...(debt.schedule || [])];
  const paidItems = schedule.filter((item) => item.isPaid);
  const unpaidItems = schedule.filter((item) => !item.isPaid);

  const currentBalance =
    newRemainingPrincipal !== undefined
      ? Math.max(0, newRemainingPrincipal)
      : debt.remainingPrincipal;

  const remainingPeriods = unpaidItems.length;

  if (remainingPeriods === 0 || currentBalance <= 0) {
    return {
      ...debt,
      annualInterestRate: newAnnualInterestRate,
      remainingPrincipal: currentBalance,
      baseRate: newBaseRate !== undefined ? newBaseRate : debt.baseRate,
      floatingMargin: newFloatingMargin !== undefined ? newFloatingMargin : debt.floatingMargin,
      status: currentBalance <= 0 ? 'paid_off' : debt.status,
    };
  }

  const monthlyRate = newAnnualInterestRate / 100 / 12;
  let runningBalance = currentBalance;
  const recalculatedUnpaid: AmortizationScheduleItem[] = [];

  if (debt.method === 'declining_balance') {
    // Dư nợ giảm dần: Gốc chia đều cho số kỳ còn lại
    const monthlyPrincipalFixed = currentBalance / remainingPeriods;

    unpaidItems.forEach((oldItem, idx) => {
      const isLast = idx === remainingPeriods - 1;
      const interestPayable = Math.round(runningBalance * monthlyRate);
      const principalPayable = isLast ? runningBalance : Math.round(monthlyPrincipalFixed);
      const totalMonthlyPayment = principalPayable + interestPayable;
      runningBalance = Math.max(0, runningBalance - principalPayable);

      recalculatedUnpaid.push({
        ...oldItem,
        principalPayable,
        interestPayable,
        totalMonthlyPayment,
        remainingBalance: runningBalance,
      });
    });
  } else {
    // Trả đều (Annuity) cho số kỳ còn lại
    let fixedMonthlyPayment = 0;
    if (monthlyRate > 0) {
      const factor = Math.pow(1 + monthlyRate, remainingPeriods);
      fixedMonthlyPayment = Math.round((currentBalance * (monthlyRate * factor)) / (factor - 1));
    } else {
      fixedMonthlyPayment = Math.round(currentBalance / remainingPeriods);
    }

    unpaidItems.forEach((oldItem, idx) => {
      const isLast = idx === remainingPeriods - 1 || runningBalance <= 0;
      const interestPayable = Math.round(runningBalance * monthlyRate);
      let principalPayable = fixedMonthlyPayment - interestPayable;

      if (isLast || runningBalance <= principalPayable) {
        principalPayable = runningBalance;
      }

      const totalMonthlyPayment = principalPayable + interestPayable;
      runningBalance = Math.max(0, runningBalance - principalPayable);

      recalculatedUnpaid.push({
        ...oldItem,
        principalPayable,
        interestPayable,
        totalMonthlyPayment,
        remainingBalance: runningBalance,
      });
    });
  }

  const newSchedule = [...paidItems, ...recalculatedUnpaid];

  return {
    ...debt,
    annualInterestRate: newAnnualInterestRate,
    remainingPrincipal: currentBalance,
    baseRate: newBaseRate !== undefined ? newBaseRate : debt.baseRate,
    floatingMargin: newFloatingMargin !== undefined ? newFloatingMargin : debt.floatingMargin,
    schedule: newSchedule,
  };
}


/** Ngày cuối cùng của tháng chứa ngày `s` (YYYY-MM-DD). */
export function endOfMonthStr(s: string): string {
  const { y, m } = parseYMD(s);
  return `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

export type PayBlockReason =
  | 'closed' // khoản vay đã tất toán
  | 'missing' // không có kỳ này
  | 'paid' // kỳ này đã trả
  | 'out_of_order' // còn kỳ chưa trả ở trước
  | 'month_locked'; // kỳ này đến hạn ở tháng sau: chưa được trả

export interface PayCheck {
  ok: boolean;
  reason?: PayBlockReason;
  /** (month_locked) ngày đến hạn của kỳ này. */
  dueDate?: string;
  /** (month_locked) ngày đầu tiên được phép trả kỳ này (mùng 1 của tháng đến hạn). */
  unlockDate?: string;
  /** (month_locked) khoản vay đã có kỳ được ghi nhận trả trong tháng hiện tại. */
  paidThisMonth?: boolean;
}

/**
 * Quy tắc "mỗi tháng chỉ trả một kỳ": chỉ trả được kỳ có ngày đến hạn KHÔNG MUỘN HƠN cuối tháng hiện tại.
 * Trả xong kỳ của tháng này thì kỳ sau (đến hạn tháng sau) bị khóa đến mùng 1 tháng sau.
 * Kỳ quá hạn vẫn trả bù được, nhiều kỳ quá hạn trả liên tiếp được. Vẫn phải trả đúng thứ tự.
 * Đây là hàm kiểm tra ở lớp xử lý chính (giao diện chỉ dùng lại để khóa nút).
 */
export function checkPayable(debt: Debt, periodIndex: number, today: string = todayLocalStr()): PayCheck {
  if (debt.status !== 'active') return { ok: false, reason: 'closed' };
  const schedule = debt.schedule || [];
  const item = schedule[periodIndex];
  if (!item) return { ok: false, reason: 'missing' };
  if (item.isPaid) return { ok: false, reason: 'paid' };
  if (schedule.findIndex((i) => !i.isPaid) !== periodIndex) return { ok: false, reason: 'out_of_order' };
  if (item.dueDate > endOfMonthStr(today)) {
    const ym = today.slice(0, 7);
    return {
      ok: false,
      reason: 'month_locked',
      dueDate: item.dueDate,
      unlockDate: `${item.dueDate.slice(0, 7)}-01`,
      paidThisMonth: schedule.some((i) => i.isPaid && (i.paidDate || '').slice(0, 7) === ym),
    };
  }
  return { ok: true };
}

/** Nhãn nút khi kỳ tiếp theo đang bị khóa theo quy tắc mỗi tháng một kỳ. */
export function payLockLabel(check: PayCheck): string {
  return check.paidThisMonth ? 'Đã trả tháng này' : 'Chưa đến kỳ';
}

/**
 * Calculate next payment due date, countdown in days, and amount.
 */
export function getNextDuePayment(debt: Debt): {
  dueDate: string;
  daysRemaining: number;
  principal: number;
  interest: number;
  total: number;
  isOverdue: boolean;
  periodIndex: number;
} | null {
  if (debt.status === 'paid_off' || debt.remainingPrincipal <= 0) return null;

  const today = todayLocalStr();

  if (debt.schedule && debt.schedule.length > 0) {
    const nextItemIndex = debt.schedule.findIndex((item) => !item.isPaid);
    if (nextItemIndex !== -1) {
      const nextItem = debt.schedule[nextItemIndex];
      const diffDaysVal = diffDays(nextItem.dueDate, today);
      return {
        dueDate: nextItem.dueDate,
        daysRemaining: diffDaysVal,
        principal: nextItem.principalPayable,
        interest: nextItem.interestPayable,
        total: nextItem.totalMonthlyPayment,
        isOverdue: diffDaysVal < 0,
        periodIndex: nextItemIndex,
      };
    }
  }

  // Fallback when no schedule
  const monthlyRate = debt.annualInterestRate / 100 / 12;
  const interest = Math.round(debt.remainingPrincipal * monthlyRate);
  const principal = debt.tenorMonths > 0 ? Math.round(debt.principalAmount / debt.tenorMonths) : 0;
  const { y, m } = parseYMD(today);
  let due = dueDateFor(`${y}-${String(m).padStart(2, '0')}-01`, 0, debt.paymentDayOfMonth);
  if (due < today) due = dueDateFor(`${y}-${String(m).padStart(2, '0')}-01`, 1, debt.paymentDayOfMonth);
  const dd = diffDays(due, today);
  return { dueDate: due, daysRemaining: dd, principal, interest, total: principal + interest, isOverdue: false, periodIndex: 0 };
}

/** Lãi tiết kiệm tạm tính đến hôm nay (lãi đơn, năm 365 ngày – quy ước ngân hàng VN). */
export function getSavingsAccrual(asset: Asset, today: string = todayLocalStr()) {
  const m = asset.metadata as SavingsMetadata;
  const principal = m.depositAmount || asset.initialCost;
  const rate = (m.annualInterestRate || 0) / 100;
  const start = m.startDate || asset.purchaseDate;
  const maturity = m.maturityDate || start;
  const elapsed = Math.max(0, Math.min(diffDays(today, start), diffDays(maturity, start)));
  const termDays = Math.max(0, diffDays(maturity, start));
  const accruedInterest = Math.round(principal * rate * elapsed / 365);
  const interestAtMaturity = Math.round(principal * rate * termDays / 365);
  return {
    principal,
    accruedInterest,
    interestAtMaturity,
    amountAtMaturity: principal + interestAtMaturity,
    daysToMaturity: diffDays(maturity, today),
    maturityDate: maturity,
    rolloverOption: m.rolloverOption,
  };
}

/** Các sổ tiết kiệm đáo hạn trong `withinDays` ngày tới (hoặc đã quá hạn chưa xử lý). */
export function getUpcomingMaturities(state: UserFinancialState, withinDays = 45) {
  return state.assets
    .filter((a) => a.status === 'active' && a.category === 'savings')
    .map((asset) => ({ asset, ...getSavingsAccrual(asset) }))
    .filter((x) => x.daysToMaturity <= withinDays)
    .sort((a, b) => a.daysToMaturity - b.daysToMaturity);
}


/**
 * Calculate comprehensive portfolio metrics.
 *
 * NGUỒN SỰ THẬT DUY NHẤT cho lãi/lỗ thực tế:
 *   Realized = Σ asset.realizedPnL (CHỈ lãi/lỗ từ bán, đã trừ phí/thuế)
 *            + Σ giao dịch dividend / rental_income / interest_income (mỗi khoản đếm đúng 1 lần)
 */
export function calculateFinancialSummary(state: UserFinancialState) {
  const activeAssets = state.assets.filter((a) => a.status === 'active');
  const totalAssetValue = activeAssets.reduce((sum, a) => sum + a.currentValue, 0);
  const totalAssetCost = activeAssets.reduce((sum, a) => sum + a.initialCost, 0);

  const bookPnL = totalAssetValue - totalAssetCost;
  const bookPnLPercent = totalAssetCost > 0 ? (bookPnL / totalAssetCost) * 100 : 0;

  const realizedFromSales = state.assets.reduce((sum, a) => sum + (a.realizedPnL || 0), 0);
  const incomeTypes = ['dividend', 'rental_income', 'interest_income'];
  const incomeReceived = state.transactions
    .filter((t) => incomeTypes.includes(t.type))
    .reduce((sum, t) => sum + t.amount, 0);
  const totalRealizedPnL = realizedFromSales + incomeReceived;

  const interestPaid = state.transactions
    .filter((t) => t.type === 'debt_payment')
    .reduce((sum, t) => sum + (t.interestPortion || 0), 0);

  const activeDebts = state.debts.filter((d) => d.status === 'active');
  const totalDebtBalance = activeDebts.reduce((sum, d) => sum + d.remainingPrincipal, 0);

  const netWorth = totalAssetValue + state.wallet.availableCash - totalDebtBalance;

  const currentMonth = todayLocalStr().slice(0, 7);
  let monthlyDebtPaymentTotal = 0;
  let monthlyPrincipalTotal = 0;
  let monthlyInterestTotal = 0;
  let obligations30d = 0;

  const upcomingPayments = activeDebts
    .map((debt) => {
      const next = getNextDuePayment(debt);
      if (!next) return null;
      // "Tháng này" = quá hạn + đến hạn trong tháng hiện tại
      if (next.dueDate.slice(0, 7) <= currentMonth) {
        monthlyDebtPaymentTotal += next.total;
        monthlyPrincipalTotal += next.principal;
        monthlyInterestTotal += next.interest;
      }
      if (next.daysRemaining <= 30) obligations30d += next.total;
      return { debt, ...next };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  const categoryBreakdown: Record<string, { value: number; count: number; cost: number }> = {
    real_estate: { value: 0, count: 0, cost: 0 },
    stock: { value: 0, count: 0, cost: 0 },
    fund: { value: 0, count: 0, cost: 0 },
    savings: { value: 0, count: 0, cost: 0 },
    gold: { value: 0, count: 0, cost: 0 },
    other: { value: 0, count: 0, cost: 0 },
  };
  activeAssets.forEach((asset) => {
    if (categoryBreakdown[asset.category]) {
      categoryBreakdown[asset.category].value += asset.currentValue;
      categoryBreakdown[asset.category].cost += asset.initialCost;
      categoryBreakdown[asset.category].count += 1;
    }
  });

  // Thu nhập cho thuê danh nghĩa hàng tháng & khả năng chi trả nợ
  const monthlyRentalIncome = activeAssets.reduce(
    (s, a) => s + (a.category === 'real_estate' ? (a.metadata as any).monthlyRentalIncome || 0 : 0),
    0
  );

  return {
    totalAssetValue,
    totalAssetCost,
    bookPnL,
    bookPnLPercent,
    totalRealizedPnL,
    realizedFromSales,
    incomeReceived,
    interestPaid,
    totalDebtBalance,
    availableCash: state.wallet.availableCash,
    netWorth,
    monthlyDebtPaymentTotal,
    monthlyPrincipalTotal,
    monthlyInterestTotal,
    obligations30d,
    cashCoversObligations: state.wallet.availableCash >= obligations30d,
    monthlyRentalIncome,
    upcomingPayments,
    categoryBreakdown,
  };
}

/**
 * Calculate LTV and Net Equity for a collateral asset linked to a debt.
 */
export function calculateCollateralMetrics(asset: Asset, debt: Debt) {
  const assetValue = asset.currentValue;
  const remainingDebt = debt.remainingPrincipal;
  const netEquity = Math.max(0, assetValue - remainingDebt);
  const ltvPercent = assetValue > 0 ? (remainingDebt / assetValue) * 100 : remainingDebt > 0 ? Infinity : 0;
  const equityPercent = assetValue > 0 ? (netEquity / assetValue) * 100 : 0;

  return {
    assetValue,
    remainingDebt,
    netEquity,
    ltvPercent,
    equityPercent,
  };
}
