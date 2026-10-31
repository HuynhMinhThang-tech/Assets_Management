import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Calendar,
  Percent,
  Clock,
  Layers,
  ArrowUpRight,
} from 'lucide-react';
import { UserFinancialState, Debt, Asset } from '../types/finance';
import {
  calculateFinancialSummary,
  calculateCollateralMetrics,
  getUpcomingMaturities,
  formatVND,
  formatPercent,
  checkPayable,
  payLockLabel,
} from '../utils/calculations';
import { buildAllocation, CATEGORY_META } from '../utils/allocation';
import { AllocationDonut } from './AllocationDonut';
import { NavTab } from './Sidebar';

interface DashboardViewProps {
  state: UserFinancialState;
  onNavigateTab: (tab: NavTab) => void;
  onOpenPayDebtModal: (debt: Debt) => void;
  onOpenAddAsset: () => void;
  onOpenAddDebt: () => void;
  /** Tên hiển thị của người đang đăng nhập – dùng để chào. */
  userName?: string;
}

function greetingForNow(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'Chào buổi sáng';
  if (h >= 11 && h < 13) return 'Chào buổi trưa';
  if (h >= 13 && h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  state,
  onNavigateTab,
  onOpenPayDebtModal,
  onOpenAddAsset,
  onOpenAddDebt,
  userName,
}) => {
  const summary = calculateFinancialSummary(state);
  const nextPayment = summary.upcomingPayments[0];
  const maturities = getUpcomingMaturities(state, 45);
  const snaps = state.snapshots || [];

  // Biểu đồ xu hướng tài sản ròng (SVG thuần)
  const trend = (() => {
    if (snaps.length < 2) return null;
    const W = 600, H = 120, pad = 6;
    const vals = snaps.map((x) => x.netWorth);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    const pts = snaps.map((x, i) => {
      const px = pad + (i * (W - 2 * pad)) / (snaps.length - 1);
      const py = H - pad - ((x.netWorth - min) / span) * (H - 2 * pad);
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    });
    const change = vals[vals.length - 1] - vals[0];
    return { W, H, points: pts.join(' '), change, from: snaps[0].date, to: snaps[snaps.length - 1].date };
  })();

  // Phân bổ danh mục (chỉ tài sản đang nắm giữ, không gồm tiền khả dụng)
  const allocation = buildAllocation(summary.categoryBreakdown);

  // Quy tắc mỗi tháng chỉ trả một kỳ: khóa nút khi kỳ tới đến hạn ở tháng sau
  const payCheck = nextPayment ? checkPayable(nextPayment.debt, nextPayment.periodIndex) : null;
  const payLocked = !!payCheck && !payCheck.ok;
  const cashShort = !!nextPayment && summary.availableCash < nextPayment.total;

  // Calculate leveraged assets (assets linked to a debt)
  const leveragedItems = state.debts
    .filter((d) => d.status === 'active' && d.collateralAssetId)
    .map((debt) => {
      const asset = state.assets.find((a) => a.id === debt.collateralAssetId && a.status === 'active');
      if (!asset) return null;
      const metrics = calculateCollateralMetrics(asset, debt);
      return { debt, asset, metrics };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div className="space-y-6 pb-12">
      {userName && (
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            {greetingForNow()}, {userName}
          </h2>
        </div>
      )}

      {/* 1. TOP STATS ROW: Tiền khả dụng + Tài sản đầu tư − Dư nợ = Tài sản ròng; Lãi/Lỗ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        {/* Available cash */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span className="font-semibold uppercase tracking-wider">Tiền khả dụng</span>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 font-mono tabular-nums">
            {formatVND(summary.availableCash)}
          </div>
        </div>

        {/* Total Assets & Book PnL */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span className="font-semibold uppercase tracking-wider">Tổng Tài sản Đầu tư</span>
            <span
              className={`font-semibold font-mono text-xs ${
                summary.bookPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {formatPercent(summary.bookPnLPercent)}
            </span>
          </div>
          <div className="text-2xl font-extrabold text-slate-900 font-mono tabular-nums">
            {formatVND(summary.totalAssetValue)}
          </div>
          <div className="mt-2 text-xs text-slate-600 flex items-center justify-between">
            <span>Giá vốn ban đầu:</span>
            <span className="font-mono tabular-nums">{formatVND(summary.totalAssetCost, { compact: true })}</span>
          </div>
        </div>

        {/* Total Active Debts */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span className="font-semibold uppercase tracking-wider">Tổng Dư nợ Đang vay</span>
            <span className="text-rose-700 font-semibold bg-rose-50 px-2 py-0.5 rounded text-[11px]">
              {state.debts.filter((d) => d.status === 'active').length} khoản nợ
            </span>
          </div>
          <div className="text-2xl font-extrabold text-rose-600 font-mono tabular-nums">
            {formatVND(summary.totalDebtBalance)}
          </div>
          <div className="mt-2 text-xs text-slate-600 flex items-center justify-between">
            <span>Đòn bẩy/Tổng TS:</span>
            <span className="font-mono tabular-nums font-semibold text-slate-800">
              {summary.totalAssetValue > 0
                ? ((summary.totalDebtBalance / summary.totalAssetValue) * 100).toFixed(1) + '%'
                : '0%'}
            </span>
          </div>
        </div>

        {/* Net Worth */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm relative overflow-hidden lg:col-span-3">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span className="font-semibold uppercase tracking-wider">Tài sản ròng (Net Worth)</span>
          </div>
          <div
            className={`text-3xl font-extrabold font-mono tabular-nums ${
              summary.netWorth < 0 ? 'text-rose-600' : 'text-slate-900'
            }`}
          >
            {formatVND(summary.netWorth)}
          </div>
        </div>

        {/* Lãi Lỗ Sổ Sách vs Thực Tế */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm sm:col-span-2 lg:col-span-3">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <span className="font-semibold uppercase tracking-wider">Hiệu quả Lãi / Lỗ</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Lãi sổ sách:</span>
              <span
                className={`text-sm font-bold font-mono tabular-nums ${
                  summary.bookPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {summary.bookPnL >= 0 ? '+' : ''}
                {formatVND(summary.bookPnL, { compact: true })}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-slate-100">
              <span className="text-xs text-slate-500">Lãi chốt thực tế:</span>
              <span
                className={`text-sm font-bold font-mono tabular-nums ${
                  summary.totalRealizedPnL >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {summary.totalRealizedPnL >= 0 ? '+' : ''}
                {formatVND(summary.totalRealizedPnL, { compact: true })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. CRITICAL DEBT CASHFLOW ALERT BANNER */}
      {nextPayment && (
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-300 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                  Khoản nợ đến hạn thanh toán gần nhất
                </span>
                <span className="text-slate-400">·</span>
                <span className="text-xs font-semibold text-amber-900 font-mono">
                  {nextPayment.daysRemaining === 0
                    ? 'Hạn chót hôm nay!'
                    : nextPayment.daysRemaining > 0
                    ? `Còn ${nextPayment.daysRemaining} ngày nữa (${nextPayment.dueDate})`
                    : `Đã quá hạn ${Math.abs(nextPayment.daysRemaining)} ngày!`}
                </span>
              </div>
              <div className="text-base font-bold text-slate-900 mt-0.5">
                {nextPayment.debt.name} ({nextPayment.debt.lender})
              </div>
              <div className="text-xs text-slate-600 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  Gốc: <strong className="font-mono">{formatVND(nextPayment.principal)}</strong>
                </span>
                <span>
                  Lãi: <strong className="font-mono">{formatVND(nextPayment.interest)}</strong>
                </span>
                <span>
                  Phương thức:{' '}
                  {nextPayment.debt.method === 'declining_balance'
                    ? 'Dư nợ giảm dần'
                    : 'Trả đều hàng tháng'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
            <div className="text-right">
              <span className="text-[11px] text-slate-500 block">Tổng tiền phải trả kỳ này</span>
              <span className="text-lg font-extrabold text-amber-700 font-mono tabular-nums">
                {formatVND(nextPayment.total)}
              </span>
              {!payLocked && cashShort && (
                <span className="block text-[11px] font-medium text-rose-600">
                  Ví thiếu {formatVND(nextPayment.total - summary.availableCash)}
                </span>
              )}
            </div>
            <button
              onClick={() => onOpenPayDebtModal(nextPayment.debt)}
              disabled={payLocked || cashShort}
              title={
                payLocked
                  ? `Kỳ tiếp theo ngày ${payCheck?.dueDate} – mở thanh toán từ ${payCheck?.unlockDate}`
                  : cashShort
                  ? 'Ví không đủ tiền – hãy nạp thêm vào ví'
                  : undefined
              }
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-amber-600"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{payLocked && payCheck ? payLockLabel(payCheck) : 'Xác nhận trả kỳ này'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 2b. SAVINGS MATURITY ALERTS */}
      {maturities.length > 0 && (
        <div className="bg-white border border-sky-200 rounded-xl p-4">
          <h3 className="text-xs font-bold text-sky-900 uppercase tracking-wider mb-2">
            Sổ tiết kiệm sắp đáo hạn
          </h3>
          <div className="divide-y divide-slate-100">
            {maturities.map((m) => (
              <div key={m.asset.id} className="py-2 flex flex-col md:flex-row md:items-center justify-between gap-1 text-xs">
                <div>
                  <span className="font-semibold text-slate-900">{m.asset.name}</span>
                  <span className="text-slate-500"> · đáo hạn {m.maturityDate} · </span>
                  <span className={`font-mono font-semibold ${m.daysToMaturity < 0 ? 'text-rose-600' : 'text-sky-700'}`}>
                    {m.daysToMaturity < 0 ? `đã quá hạn ${-m.daysToMaturity} ngày` : m.daysToMaturity === 0 ? 'hôm nay' : `còn ${m.daysToMaturity} ngày`}
                  </span>
                </div>
                <div className="text-slate-600 font-mono">
                  Gốc {formatVND(m.principal, { compact: true })} + lãi {formatVND(m.interestAtMaturity, { compact: true })} = <strong>{formatVND(m.amountAtMaturity)}</strong>
                  <span className="text-slate-400"> · lãi tạm tính đến nay {formatVND(m.accruedInterest, { compact: true })}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2c. NET WORTH TREND (chỉ hiện khi đã có ít nhất 2 ngày dữ liệu) */}
      {trend && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Diễn biến tài sản ròng</h3>
            <span className={`text-xs font-mono font-semibold ${trend.change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {trend.change >= 0 ? '+' : ''}{formatVND(trend.change, { compact: true })} · {trend.from} → {trend.to}
            </span>
          </div>
          <svg viewBox={`0 0 ${trend.W} ${trend.H}`} className="w-full h-28" role="img" aria-label="Biểu đồ tài sản ròng theo ngày">
            <polyline points={trend.points} fill="none" stroke="#059669" strokeWidth="2" />
          </svg>
        </div>
      )}

      {/* 3. TWO-COLUMN SPLIT: PORTFOLIO ALLOCATION & COLLATERAL LEVERAGE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Asset Category Allocation */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Phân bổ Danh mục Tài sản</h2>
            </div>
            <button
              onClick={() => onNavigateTab('assets')}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
            >
              <span>Xem chi tiết</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {allocation.slices.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">Chưa có tài sản đang nắm giữ.</div>
          ) : (
            <>
              <AllocationDonut slices={allocation.slices} total={allocation.total} />

              {/* Chú giải: nhóm, giá trị, lãi/lỗ %, tỷ trọng */}
              <div className="mt-5 space-y-1">
                {allocation.slices.map((slice) => {
                  const pnl = slice.value - slice.cost;
                  return (
                    <div
                      key={slice.key}
                      data-legend={slice.key}
                      title={
                        slice.members.length > 1
                          ? `Gồm: ${slice.members.map((k) => CATEGORY_META[k].label).join(', ')}`
                          : undefined
                      }
                      className="flex items-center justify-between text-xs py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 px-2 rounded transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: slice.color }} />
                        <div className="truncate">
                          <span className="font-semibold text-slate-900">{slice.label}</span>
                          <span className="text-slate-400 ml-1.5 font-mono">({slice.count} mục)</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-right shrink-0">
                        <div>
                          <div className="font-bold text-slate-900 font-mono tabular-nums">
                            {formatVND(slice.value, { compact: true })}
                          </div>
                          <div
                            className={`text-[11px] font-mono ${pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}
                          >
                            {formatPercent(slice.pnlPct)} ({pnl >= 0 ? '+' : ''}
                            {formatVND(pnl, { compact: true })})
                          </div>
                        </div>
                        <div className="w-14 text-right font-mono font-bold text-slate-600">
                          {slice.pct.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Right: Collateral Linkage & Net Equity vs Loan */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Liên kết Nợ & Tài sản Thế chấp</h2>
            </div>
            <button
              onClick={() => onNavigateTab('debts')}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
            >
              <span>Xem khoản nợ</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {leveragedItems.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              Chưa có khoản vay nào được liên kết với tài sản bảo đảm.
            </div>
          ) : (
            <div className="space-y-4">
              {leveragedItems.map(({ debt, asset, metrics }) => (
                <div
                  key={debt.id}
                  className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 text-xs space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-900 text-sm">{asset.name}</span>
                      <span className="text-slate-400 ml-2">← {debt.name}</span>
                    </div>
                    <span className="font-mono font-bold text-slate-700 bg-white border border-slate-200 px-2 py-0.5 rounded text-[11px]">
                      LTV: {metrics.ltvPercent.toFixed(1)}%
                    </span>
                  </div>

                  {/* Equity vs Loan Bar */}
                  <div className="space-y-1">
                    <div className="h-3 w-full bg-slate-200 rounded-full overflow-hidden flex">
                      <div
                        style={{ width: `${metrics.equityPercent}%` }}
                        className="h-full bg-emerald-500 transition-all"
                        title={`Vốn tự có thực sở hữu: ${metrics.equityPercent.toFixed(1)}%`}
                      />
                      <div
                        style={{ width: `${metrics.ltvPercent}%` }}
                        className="h-full bg-rose-500 transition-all"
                        title={`Dư nợ ngân hàng: ${metrics.ltvPercent.toFixed(1)}%`}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] pt-0.5">
                      <span className="text-emerald-700 font-medium">
                        Vốn tự có: {formatVND(metrics.netEquity, { compact: true })} (
                        {metrics.equityPercent.toFixed(1)}%)
                      </span>
                      <span className="text-rose-700 font-medium">
                        Nợ gốc: {formatVND(metrics.remainingDebt, { compact: true })} (
                        {metrics.ltvPercent.toFixed(1)}%)
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
                    <span>
                      Thị giá TS:{' '}
                      <strong className="text-slate-800 font-mono">
                        {formatVND(metrics.assetValue)}
                      </strong>
                    </span>
                    <span>
                      Lãi suất: <strong className="font-mono">{debt.annualInterestRate}%/năm</strong>{' '}
                      ({debt.rateType === 'floating' ? 'Thả nổi' : 'Cố định'})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 4. BOTTOM ROW: MONTHLY DEBT OBLIGATION & TOP ASSETS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Month Cash Outflow for Debt */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Dòng tiền trả nợ tháng này
            </h3>
            <Calendar className="w-4 h-4 text-slate-400" />
          </div>

          <div className="text-xl font-bold text-slate-900 font-mono tabular-nums mb-3">
            {formatVND(summary.monthlyDebtPaymentTotal)}
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-600">
              <span>Tiền gốc trả nợ:</span>
              <span className="font-bold text-slate-800 font-mono tabular-nums">
                {formatVND(summary.monthlyPrincipalTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600">
              <span>Tiền lãi vay phát sinh:</span>
              <span className="font-bold text-rose-600 font-mono tabular-nums">
                {formatVND(summary.monthlyInterestTotal)}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500">
              Phải trả trong 30 ngày tới: <strong className="font-mono">{formatVND(summary.obligations30d)}</strong>.{' '}
              <span className={summary.cashCoversObligations ? 'text-emerald-700 font-semibold' : 'text-rose-600 font-semibold'}>
                {summary.cashCoversObligations ? 'Ví đủ chi trả.' : `Ví đang thiếu ${formatVND(summary.obligations30d - summary.availableCash)}.`}
              </span>
            </div>
          </div>
        </div>

        {/* Top Performing Assets */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Tài sản Hiệu quả Lãi/Lỗ Cao Nhất
            </h3>
          </div>

          <div className="space-y-2.5">
            {state.assets
              .filter((a) => a.status === 'active')
              .map((asset) => {
                const pnl = asset.currentValue - asset.initialCost;
                const pnlPct = asset.initialCost > 0 ? (pnl / asset.initialCost) * 100 : 0;
                return { asset, pnl, pnlPct };
              })
              .sort((a, b) => b.pnlPct - a.pnlPct)
              .slice(0, 4)
              .map(({ asset, pnl, pnlPct }) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between text-xs py-1.5 px-2 rounded hover:bg-slate-50 transition-colors"
                >
                  <div className="truncate pr-4">
                    <span className="font-bold text-slate-900 block truncate">{asset.name}</span>
                    <span className="text-[11px] text-slate-400">
                      Mua: {asset.purchaseDate} · Vốn:{' '}
                      <span className="font-mono">{formatVND(asset.initialCost, { compact: true })}</span>
                    </span>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="font-bold text-slate-900 font-mono tabular-nums">
                      {formatVND(asset.currentValue, { compact: true })}
                    </div>
                    <div
                      className={`text-[11px] font-mono font-bold ${
                        pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {formatPercent(pnlPct)} ({formatVND(pnl, { compact: true })})
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};
