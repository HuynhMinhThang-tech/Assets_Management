import React, { useState, useEffect } from 'react';
import {
  Plus,
  CreditCard,
  Building2,
  Calendar,
  Percent,
  AlertCircle,
  CheckCircle2,
  Table,
  Link as LinkIcon,
  Undo2,
  Edit2,
  ChevronRight,
  TrendingDown,
  Info,
  ShieldCheck,
} from 'lucide-react';
import {
  Debt,
  DebtCategory,
  DebtSecurityType,
  PaymentMethod,
  InterestRateType,
  UserFinancialState,
  Asset,
  FundUse,
  FundUseKind,
} from '../types/finance';
import {
  formatVND,
  formatPercent,
  getNextDuePayment,
  checkPayable,
  payLockLabel,
  generateAmortizationSchedule,
  calculateCollateralMetrics,
  recalculateFloatingDebt,
  applyHistoricalPayments,
  todayLocalStr,
} from '../utils/calculations';
import { CurrencyInput } from './CurrencyInput';
import { Modal, ModalBody, ModalFooter, FieldError } from './ui/Modal';
import { MAX_RATE, MAX_TENOR_MONTHS } from '../utils/validation';
import { canVoidDebt } from '../utils/ops';
import { buildTrackedDebt } from '../utils/debtCore';
import { DebtActionHandlers, DebtDetailModal } from './DebtActions';

const DEBT_CATEGORY_OPTIONS: { id: DebtCategory; label: string }[] = [
  { id: 'mortgage', label: 'Vay nhà / BĐS' },
  { id: 'car_loan', label: 'Vay mua xe' },
  { id: 'student_loan', label: 'Vay học tập' },
  { id: 'business_loan', label: 'Vay kinh doanh' },
  { id: 'consumer_loan', label: 'Vay tiêu dùng' },
  { id: 'other', label: 'Khoản vay khác' },
];

const isSecuredDebt = (d: Debt) => d.securityType === 'secured' || !!d.collateralAssetId;

interface DebtsViewProps {
  state: UserFinancialState;
  onAddDebt: (debt: Debt, disburseToWallet?: boolean) => boolean | void;
  onUpdateDebt: (debt: Debt) => void;
  /** Hủy bản ghi nhập nhầm (thay cho xóa): dữ liệu được giữ lại, tiền ví hoàn bằng bút toán đảo. */
  onVoidDebt: (debtId: string) => void;
  /** Bổ sung nơi dùng vốn cho khoản nợ cũ: chỉ gắn nhãn, không đổi ví. */
  onSetFundUse: (debtId: string, fundUse: FundUse) => boolean | void;
  onPayDebtPeriod: (debtId: string, periodIndex: number, deductFromWallet: boolean) => boolean | void | Promise<boolean | void>;
  autoOpenAdd?: boolean;
  onAutoOpenConsumed?: () => void;
  onAddRateChange: DebtActionHandlers['onAddRateChange'];
  onRemoveRateChange: DebtActionHandlers['onRemoveRateChange'];
  onSettleDebt: DebtActionHandlers['onSettle'];
  onPrepayDebt: DebtActionHandlers['onPrepay'];
  onReconcileDebt: DebtActionHandlers['onReconcile'];
  onUndoReconcile: DebtActionHandlers['onUndoReconcile'];
}

export const DebtsView: React.FC<DebtsViewProps> = ({
  state,
  onAddDebt,
  onUpdateDebt,
  onVoidDebt,
  onSetFundUse,
  onPayDebtPeriod,
  onAddRateChange,
  onRemoveRateChange,
  onSettleDebt,
  onPrepayDebt,
  onReconcileDebt,
  onUndoReconcile,
  autoOpenAdd,
  onAutoOpenConsumed,
}) => {
  const [scheduleDebtId, setScheduleDebtId] = useState<string | null>(null);
  const selectedDebtForSchedule = scheduleDebtId ? state.debts.find((d) => d.id === scheduleDebtId) || null : null;
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [fundUseDebtId, setFundUseDebtId] = useState<string | null>(null);
  const [showVoided, setShowVoided] = useState(false);

  useEffect(() => {
    if (autoOpenAdd) {
      setIsAddModalOpen(true);
      onAutoOpenConsumed?.();
    }
  }, [autoOpenAdd]);
  const [securityFilter, setSecurityFilter] = useState<'all' | 'secured' | 'unsecured'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const activeDebts = state.debts.filter((d) => d.status === 'active');
  const totalRemainingDebt = activeDebts.reduce((sum, d) => sum + d.remainingPrincipal, 0);
  const totalOriginalDebt = activeDebts.reduce((sum, d) => sum + d.principalAmount, 0);
  const totalPaidDebt = Math.max(0, totalOriginalDebt - totalRemainingDebt);

  // Secured vs Unsecured breakdown
  const securedDebts = activeDebts.filter((d) => d.securityType === 'secured' || !!d.collateralAssetId);
  const unsecuredDebts = activeDebts.filter((d) => d.securityType === 'unsecured' && !d.collateralAssetId);
  const totalSecuredDebt = securedDebts.reduce((sum, d) => sum + d.remainingPrincipal, 0);
  const totalUnsecuredDebt = unsecuredDebts.reduce((sum, d) => sum + d.remainingPrincipal, 0);

  // Tài sản chưa gắn với khoản vay đang hoạt động nào: được chọn làm "nơi dùng vốn = mua tài sản"
  const unlinkedAssets = state.assets.filter(
    (a) => a.status === 'active' && !(a.linkedDebtId && state.debts.some((d) => d.id === a.linkedDebtId && d.status === 'active'))
  );
  const voidedCount = state.debts.filter((d) => d.status === 'voided').length;
  const filteredDebts = state.debts.filter((debt) => {
    if (debt.status === 'voided' && !showVoided) return false;
    if (categoryFilter !== 'all' && debt.category !== categoryFilter) return false;
    const isSecured = debt.securityType === 'secured' || !!debt.collateralAssetId;
    if (securityFilter === 'secured' && !isSecured) return false;
    if (securityFilter === 'unsecured' && isSecured) return false;
    return true;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* 1. TOP SUMMARY BANNER */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Debt */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">
            Tổng Dư nợ Hiện tại
          </span>
          <div className="text-2xl font-extrabold text-rose-600 font-mono tabular-nums">
            {formatVND(totalRemainingDebt)}
          </div>
          <span className="text-[11px] text-slate-400 block mt-1">
            Gốc ban đầu: {formatVND(totalOriginalDebt, { compact: true })}
          </span>
        </div>

        {/* Secured vs Unsecured Breakdown */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-2">
              Phân loại Thế chấp / Tín chấp
            </span>
            <div className="space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sky-800 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                  <span>Nợ thế chấp ({securedDebts.length}):</span>
                </span>
                <span className="font-mono font-bold text-slate-900">
                  {formatVND(totalSecuredDebt, { compact: true })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-amber-800 font-medium">
                  <CreditCard className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Nợ tín chấp ({unsecuredDebts.length}):</span>
                </span>
                <span className="font-mono font-bold text-slate-900">
                  {formatVND(totalUnsecuredDebt, { compact: true })}
                </span>
              </div>
            </div>
          </div>

          {/* Visual ratio bar */}
          <div className="mt-3 pt-2 border-t border-slate-100">
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
              <div
                style={{
                  width: `${totalRemainingDebt > 0 ? (totalSecuredDebt / totalRemainingDebt) * 100 : 0}%`,
                }}
                className="h-full bg-sky-500"
                title="Tỷ trọng Nợ thế chấp"
              />
              <div
                style={{
                  width: `${totalRemainingDebt > 0 ? (totalUnsecuredDebt / totalRemainingDebt) * 100 : 0}%`,
                }}
                className="h-full bg-amber-500"
                title="Tỷ trọng Nợ tín chấp"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1 font-mono">
              <span>Thế chấp: {totalRemainingDebt > 0 ? ((totalSecuredDebt / totalRemainingDebt) * 100).toFixed(0) : 0}%</span>
              <span>Tín chấp: {totalRemainingDebt > 0 ? ((totalUnsecuredDebt / totalRemainingDebt) * 100).toFixed(0) : 0}%</span>
            </div>
          </div>
        </div>

        {/* Repayment Progress */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">
            Đã thanh toán gốc
          </span>
          <div className="text-2xl font-extrabold text-emerald-600 font-mono tabular-nums">
            {formatVND(totalPaidDebt)}
          </div>
          <span className="text-[11px] text-slate-400 block mt-1">
            Tiến độ giải phóng nợ:{' '}
            <strong className="text-slate-700">
              {totalOriginalDebt > 0
                ? ((totalPaidDebt / totalOriginalDebt) * 100).toFixed(1) + '%'
                : '100%'}
            </strong>
          </span>
        </div>
      </div>

      {/* 2. FILTER & TOOLBAR */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:flex-row sm:items-end">
        <div className="sm:w-60">
          <label htmlFor="debt-security-filter" className="mb-1 block text-[11px] font-semibold text-slate-500">
            Hình thức vay
          </label>
          <select
            id="debt-security-filter"
            value={securityFilter}
            onChange={(e) => setSecurityFilter(e.target.value as 'all' | 'secured' | 'unsecured')}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            <option value="all">Tất cả hình thức ({state.debts.length})</option>
            <option value="secured">Vay thế chấp ({state.debts.filter(isSecuredDebt).length})</option>
            <option value="unsecured">Vay tín chấp ({state.debts.filter((d) => !isSecuredDebt(d)).length})</option>
          </select>
        </div>

        <div className="sm:w-60">
          <label htmlFor="debt-category-filter" className="mb-1 block text-[11px] font-semibold text-slate-500">
            Mục đích vay
          </label>
          <select
            id="debt-category-filter"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            <option value="all">Tất cả mục đích ({state.debts.length})</option>
            {DEBT_CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label} ({state.debts.filter((d) => d.category === opt.id).length})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3 sm:ml-auto sm:pb-2">
          {voidedCount > 0 && (
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
              <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
              Hiện khoản đã hủy ({voidedCount})
            </label>
          )}
          <span className="text-[11px] text-slate-500">
            Hiển thị <strong className="text-slate-800">{filteredDebts.length}</strong>/{state.debts.length} khoản nợ
          </span>
          {(securityFilter !== 'all' || categoryFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSecurityFilter('all');
                setCategoryFilter('all');
              }}
              className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              Xóa lọc
            </button>
          )}
        </div>
      </div>

      {/* 3. DEBT CARDS LIST */}
      {filteredDebts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-xs text-slate-400">
          <CreditCard className="w-10 h-10 text-slate-300 mx-auto mb-2" />
          <p>Hiện không có khoản nợ nào trong danh mục lọc.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {filteredDebts.map((debt) => {
            const nextPay = getNextDuePayment(debt);
            // Mỗi tháng chỉ trả một kỳ: kỳ tới đến hạn ở tháng sau thì khóa nút
            const payCheck = nextPay ? checkPayable(debt, nextPay.periodIndex) : null;
            const payLocked = !!payCheck && payCheck.reason === 'month_locked';
            const collateralAsset = state.assets.find((a) => a.id === debt.collateralAssetId);
            const collateralMetrics = collateralAsset
              ? calculateCollateralMetrics(collateralAsset, debt)
              : null;
            const paidProgress =
              debt.principalAmount > 0
                ? ((debt.principalAmount - debt.remainingPrincipal) / debt.principalAmount) * 100
                : 100;

            return (
              <div
                key={debt.id}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4 hover:border-slate-300 transition-colors"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-slate-900 text-base">{debt.name}</h3>
                      {debt.status === 'paid_off' && (
                        <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-semibold">
                          Đã tất toán
                        </span>
                      )}
                      {debt.status === 'voided' && (
                        <span className="text-[10px] text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded font-semibold">
                          Đã hủy
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                      <span>{debt.lender}</span>
                      <span>·</span>
                      <span>
                        {debt.category === 'mortgage' && 'Vay mua nhà'}
                        {debt.category === 'car_loan' && 'Vay mua xe'}
                        {debt.category === 'student_loan' && 'Vay sinh viên'}
                        {debt.category === 'business_loan' && 'Vay kinh doanh'}
                        {debt.category === 'consumer_loan' && 'Vay tiêu dùng'}
                        {debt.category === 'other' && 'Khoản vay khác'}
                      </span>
                    </div>
                    <div className="mt-1.5" data-fund-use={debt.fundUse?.kind || 'unspecified'}>
                      {!debt.fundUse || debt.fundUse.kind === 'unspecified' ? (
                        debt.status === 'voided' ? null : (
                          <button
                            type="button"
                            onClick={() => setFundUseDebtId(debt.id)}
                            className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 hover:bg-amber-100"
                          >
                            Chưa xác định nơi dùng vốn · Bổ sung
                          </button>
                        )
                      ) : (
                        <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded px-2 py-0.5">
                          {debt.fundUse.kind === 'wallet' &&
                            (debt.fundUse.cashRecorded ? 'Nơi dùng vốn: vào ví đầu tư' : 'Nơi dùng vốn: vào ví (chỉ ghi nợ)')}
                          {debt.fundUse.kind === 'asset' &&
                            `Nơi dùng vốn: mua ${state.assets.find((a) => a.id === debt.fundUse?.assetId)?.name || 'tài sản'}`}
                          {debt.fundUse.kind === 'spent' && 'Nơi dùng vốn: đã chi tiêu'}
                        </span>
                      )}
                    </div>
                  </div>

                  {canVoidDebt(state, debt.id).ok && (
                    <button
                      data-void-debt={debt.id}
                      onClick={() => onVoidDebt(debt.id)}
                      title="Hủy bản ghi nhập nhầm"
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Progress Bar of Loan Repayment */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Tiến độ trả nợ gốc:</span>
                    <span className="font-mono font-bold text-slate-800">
                      {paidProgress.toFixed(1)}% (Còn {formatVND(debt.remainingPrincipal, { compact: true })})
                    </span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${paidProgress}%` }}
                      className="h-full bg-emerald-500 rounded-full transition-all"
                    />
                  </div>
                </div>

                {/* Grid of Terms & Rates */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-3 rounded-lg bg-slate-50 text-xs">
                  <div>
                    <span className="text-slate-400 text-[11px] block">Lãi suất hiện tại</span>
                    <span className="font-bold text-slate-900 font-mono">
                      {debt.annualInterestRate}%/năm
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      {debt.rateType === 'floating'
                        ? `Thả nổi (${debt.baseRate || 0}% + ${debt.floatingMargin || 0}%)`
                        : 'Cố định'}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 text-[11px] block">Phương thức tính</span>
                    <span className="font-bold text-slate-900">
                      {debt.method === 'declining_balance' ? 'Dư nợ giảm dần' : 'Trả đều hàng tháng'}
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      Kỳ hạn: {debt.tenorMonths} tháng
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 text-[11px] block">Ngày đóng tiền</span>
                    <span className="font-bold text-slate-900 font-mono">
                      Ngày {debt.paymentDayOfMonth} hàng tháng
                    </span>
                    <span className="text-[10px] text-slate-500 block">
                      Từ ngày {debt.startDate}
                    </span>
                  </div>
                </div>

                {/* Collateral Linkage Section */}
                {collateralAsset && collateralMetrics && (
                  <div className="p-3 rounded-lg border border-sky-200 bg-sky-50/50 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-sky-900 font-semibold">
                        <LinkIcon className="w-3.5 h-3.5 text-sky-600" />
                        <span>Thế chấp: {collateralAsset.name}</span>
                      </div>
                      <span className="font-mono font-bold text-sky-800 bg-sky-100 px-1.5 py-0.5 rounded text-[11px]">
                        LTV: {collateralMetrics.ltvPercent.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-sky-800">
                      <span>
                        Thị giá TS: <strong>{formatVND(collateralMetrics.assetValue, { compact: true })}</strong>
                      </span>
                      <span>
                        Vốn tự có (Equity):{' '}
                        <strong>{formatVND(collateralMetrics.netEquity, { compact: true })}</strong> (
                        {collateralMetrics.equityPercent.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                )}

                {/* Next Payment Card & Full Schedule Button */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
                  <div>
                    {nextPay ? (
                      <div>
                        <span className="text-[11px] text-slate-500 block">
                          Kỳ tới ({nextPay.dueDate}) ·{' '}
                          <strong
                            className={
                              nextPay.daysRemaining < 0
                                ? 'text-rose-600'
                                : nextPay.daysRemaining <= 5
                                ? 'text-amber-600'
                                : 'text-slate-700'
                            }
                          >
                            {nextPay.daysRemaining < 0
                              ? `Quá hạn ${Math.abs(nextPay.daysRemaining)} ngày`
                              : nextPay.daysRemaining === 0
                              ? 'Hôm nay'
                              : `Còn ${nextPay.daysRemaining} ngày`}
                          </strong>
                        </span>
                        <span className="font-bold text-slate-900 font-mono tabular-nums text-sm">
                          {formatVND(nextPay.total)}
                        </span>
                        {!payLocked && state.wallet.availableCash < nextPay.total && (
                          <span className="block text-[11px] font-medium text-rose-600">
                            Ví thiếu {formatVND(nextPay.total - state.wallet.availableCash)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">Không còn kỳ nợ nào đến hạn</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setScheduleDebtId(debt.id)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Table className="w-3.5 h-3.5" />
                      <span>Chi tiết & lịch trả</span>
                    </button>

                    {nextPay && (
                      <button
                        onClick={() =>
                          onPayDebtPeriod(debt.id, nextPay.periodIndex, true)
                        }
                        disabled={payLocked || state.wallet.availableCash < nextPay.total}
                        title={
                          payLocked && payCheck
                            ? `Kỳ tiếp theo ngày ${payCheck.dueDate} – mở thanh toán từ ${payCheck.unlockDate}`
                            : state.wallet.availableCash < nextPay.total
                            ? `Ví thiếu ${formatVND(nextPay.total - state.wallet.availableCash)} – hãy nạp thêm tiền vào ví`
                            : undefined
                        }
                        className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-colors flex items-center gap-1 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-amber-600"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{payLocked && payCheck ? payLockLabel(payCheck) : 'Trả kỳ này'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: CHI TIẾT KHOẢN VAY (lịch trả, lịch sử thanh toán, lãi suất, thao tác) */}
      {selectedDebtForSchedule && (
        <DebtDetailModal
          debt={selectedDebtForSchedule}
          cash={state.wallet.availableCash}
          transactions={state.transactions}
          onClose={() => setScheduleDebtId(null)}
          handlers={{
            onPayPeriod: (periodIndex, deduct) => {
              onPayDebtPeriod(selectedDebtForSchedule.id, periodIndex, deduct);
            },
            onAddRateChange,
            onRemoveRateChange,
            onSettle: onSettleDebt,
            onPrepay: onPrepayDebt,
            onReconcile: onReconcileDebt,
            onUndoReconcile,
          }}
        />
      )}

      {/* MODAL 2: ADD NEW DEBT */}
      {isAddModalOpen && (
        <AddDebtModal
          assets={state.assets.filter((a) => a.status === 'active')}
          fundAssets={unlinkedAssets}
          onClose={() => setIsAddModalOpen(false)}
          onAdd={(debt, disburse) => {
            if (onAddDebt(debt, disburse) !== false) setIsAddModalOpen(false);
          }}
        />
      )}

      {/* MODAL: BỔ SUNG NƠI DÙNG VỐN CHO KHOẢN NỢ CŨ */}
      {fundUseDebtId && (
        <FundUseModal
          debt={state.debts.find((d) => d.id === fundUseDebtId)!}
          assets={unlinkedAssets}
          onClose={() => setFundUseDebtId(null)}
          onSave={(fu) => {
            if (onSetFundUse(fundUseDebtId, fu) !== false) setFundUseDebtId(null);
          }}
        />
      )}

    </div>
  );
};

interface FundUseModalProps {
  debt: Debt;
  assets: Asset[];
  onClose: () => void;
  onSave: (fundUse: FundUse) => void;
}

/** Bổ sung nơi dùng vốn cho khoản nợ cũ: chỉ gắn nhãn, không cộng tiền vào ví. */
const FundUseModal: React.FC<FundUseModalProps> = ({ debt, assets, onClose, onSave }) => {
  const [kind, setKind] = useState<FundUseKind | ''>('');
  const [assetId, setAssetId] = useState('');
  const missing = !kind ? 'Chọn nơi dùng vốn.' : kind === 'asset' && !assetId ? 'Chọn tài sản được mua bằng vốn vay.' : '';
  return (
    <Modal title="Nơi dùng vốn của khoản vay" subtitle={debt.name} onClose={onClose}>
      <ModalBody>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Tiền vay đã đi đâu? *</label>
          <select
            data-testid="fund-kind-edit"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as FundUseKind | '');
              setAssetId('');
            }}
            className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
          >
            <option value="">-- Chọn nơi dùng vốn --</option>
            <option value="wallet">Vào ví đầu tư</option>
            <option value="asset">Mua tài sản</option>
            <option value="spent">Đã chi tiêu (không có tài sản đối ứng)</option>
          </select>
          {kind === 'asset' && (
            <select
              data-testid="fund-asset-edit"
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="mt-2 w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="">-- Chọn tài sản --</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </ModalBody>
      <ModalFooter hint={missing ? <span className="font-semibold text-rose-600">{missing}</span> : undefined}>
        <button type="button" onClick={onClose} className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium">
          Hủy
        </button>
        <button
          type="button"
          disabled={!!missing}
          onClick={() => onSave({ kind: kind as FundUseKind, assetId: kind === 'asset' ? assetId : undefined })}
          className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:cursor-not-allowed disabled:opacity-50"
        >
          Lưu
        </button>
      </ModalFooter>
    </Modal>
  );
};

interface AddDebtModalProps {
  assets: Asset[];
  /** Tài sản có thể chọn làm nơi dùng vốn (chưa gắn khoản vay khác). */
  fundAssets: Asset[];
  onClose: () => void;
  onAdd: (debt: Debt, disburseToWallet: boolean) => void;
}

const AddDebtModal: React.FC<AddDebtModalProps> = ({ assets, fundAssets, onClose, onAdd }) => {
  const [name, setName] = useState('');
  const [lender, setLender] = useState('');
  const [category, setCategory] = useState<DebtCategory>('mortgage');
  const [principalAmount, setPrincipalAmount] = useState<number>(0);
  const [remainingPrincipal, setRemainingPrincipal] = useState<number>(0);
  const [annualInterestRate, setAnnualInterestRate] = useState('9.5');
  const [rateType, setRateType] = useState<InterestRateType>('floating');
  const [baseRate, setBaseRate] = useState('6.0');
  const [floatingMargin, setFloatingMargin] = useState('3.5');
  const [tenorMonths, setTenorMonths] = useState('240');
  const [startDate, setStartDate] = useState(todayLocalStr());
  const [graceMonths, setGraceMonths] = useState('0');
  const [disburse, setDisburse] = useState(false);
  // Khoản vay đang trả dở: theo dõi từ hôm nay, lịch chỉ gồm các kỳ còn lại (không dựng lịch sử từ lúc giải ngân)
  const [mode, setMode] = useState<'new' | 'tracked'>('tracked');
  // Nơi dùng vốn: bắt buộc chọn (tiền vay đã đi đâu)
  const [fundKind, setFundKind] = useState<FundUseKind | ''>('');
  const [fundAssetId, setFundAssetId] = useState('');
  const [paymentDayOfMonth, setPaymentDayOfMonth] = useState('15');
  const [method, setMethod] = useState<PaymentMethod>('declining_balance');
  const [collateralAssetId, setCollateralAssetId] = useState('');
  const [notes, setNotes] = useState('');

  // ---- Ràng buộc nhập liệu: sai thì khóa nút Lưu + báo tại chỗ ----
  const principal = principalAmount || 0;
  const tenor = parseInt(tenorMonths) || 0;
  const rate = parseFloat(annualInterestRate);
  const day = mode === 'tracked' ? parseInt(startDate.slice(8, 10)) || 0 : parseInt(paymentDayOfMonth) || 0;
  const grace = Math.max(0, parseInt(graceMonths) || 0);
  // Bỏ trống = tự tính theo lịch trả đến hôm nay (không tự điền bằng gốc: sẽ sai với khoản vay đã trả một phần)
  const remainingInput = remainingPrincipal > 0 ? remainingPrincipal : undefined;

  const missing: string[] = [];
  if (!name.trim()) missing.push('Nhập tên khoản vay.');
  if (!lender.trim()) missing.push('Nhập ngân hàng / tổ chức cho vay.');
  if (mode === 'new' && principal <= 0) missing.push('Nhập số gốc vay ban đầu.');
  if (mode === 'tracked' && !(remainingPrincipal > 0)) missing.push('Nhập dư nợ gốc còn lại.');
  if (!startDate) missing.push(mode === 'tracked' ? 'Chọn ngày đến hạn kỳ tiếp theo.' : 'Chọn ngày giải ngân.');
  if (!fundKind) missing.push('Chọn nơi dùng vốn của khoản vay.');
  if (fundKind === 'asset' && !fundAssetId) missing.push('Chọn tài sản được mua bằng vốn vay.');

  const remainingError =
    mode === 'new' && principal > 0 && remainingInput !== undefined && remainingInput > principal
      ? 'Dư nợ còn lại không thể lớn hơn số gốc vay ban đầu.'
      : '';
  const rateError = Number.isNaN(rate)
    ? 'Nhập lãi suất áp dụng.'
    : rate < 0 || rate > MAX_RATE
    ? `Lãi suất phải trong khoảng 0% – ${MAX_RATE}%/năm.`
    : '';
  const termErrors: string[] = [];
  if (tenor < 1 || tenor > MAX_TENOR_MONTHS) termErrors.push(`Thời hạn vay phải từ 1 đến ${MAX_TENOR_MONTHS} tháng.`);
  else if (grace >= tenor) termErrors.push('Ân hạn gốc phải ngắn hơn thời hạn vay.');
  if (day < 1 || day > 31) termErrors.push('Ngày trả hàng tháng phải từ 1 đến 31.');

  const errors = [remainingError, rateError, ...termErrors].filter(Boolean);
  const hasProblems = errors.length > 0 || missing.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasProblems) return;

    if (mode === 'tracked') {
      const trackedDebt = buildTrackedDebt(
        {
          id: `debt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name: name || `Khoản vay ${lender}`,
          lender,
          category,
          securityType: collateralAssetId ? 'secured' : 'unsecured',
          collateralAssetId: collateralAssetId || undefined,
          fundUse: { kind: fundKind as FundUseKind, assetId: fundKind === 'asset' ? fundAssetId : undefined },
          notes,
        },
        {
          balance: remainingPrincipal,
          periods: tenor,
          firstDueDate: startDate,
          trackingStart: todayLocalStr(),
          paymentDay: day,
          annualRate: rate,
          rateType,
          baseRate: parseFloat(baseRate) || 0,
          margin: parseFloat(floatingMargin) || 0,
          method,
          graceLeft: grace,
        }
      );
      onAdd(trackedDebt, false);
      return;
    }

    const schedule = generateAmortizationSchedule(principal, rate, tenor, startDate, day, method, grace);

    const rawDebt: Debt = {
      id: `debt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name || `Khoản vay ${lender}`,
      lender,
      category,
      securityType: collateralAssetId ? 'secured' : 'unsecured',
      principalAmount: principal,
      remainingPrincipal: remainingInput ?? principal,
      annualInterestRate: rate,
      rateType,
      baseRate: rateType === 'floating' ? parseFloat(baseRate) || 0 : undefined,
      floatingMargin: rateType === 'floating' ? parseFloat(floatingMargin) || 0 : undefined,
      tenorMonths: tenor,
      startDate,
      paymentDayOfMonth: day,
      method,
      graceMonths: grace || undefined,
      collateralAssetId: collateralAssetId || undefined,
      fundUse: { kind: fundKind as FundUseKind, assetId: fundKind === 'asset' ? fundAssetId : undefined },
      notes,
      status: 'active',
      schedule,
    };
    // Khoản vay đã giải ngân trong quá khứ: kỳ đã qua = đã trả; các kỳ còn lại căn theo dư nợ thực tế người dùng nhập
    const newDebt = applyHistoricalPayments(rawDebt, remainingInput);
    onAdd(newDebt, fundKind === 'wallet' && disburse && startDate <= todayLocalStr());
  };

  return (
    <Modal
      title="Thêm Khoản Vay / Nợ Mới"
      size="lg"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <ModalBody>
          {/* Loại khoản vay: mới giải ngân hoặc đang trả dở */}
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs">
            {([['tracked', 'Khoản vay đang trả dở'], ['new', 'Khoản vay mới giải ngân']] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                data-debt-mode={k}
                onClick={() => {
                  setMode(k);
                  setDisburse(false);
                }}
                className={`flex-1 rounded-md px-3 py-1.5 font-semibold transition-colors ${mode === k ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Category */}
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1.5">Mục đích vay</label>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {[
                { id: 'mortgage', label: 'Vay mua nhà / BĐS' },
                { id: 'car_loan', label: 'Vay mua xe' },
                { id: 'student_loan', label: 'Vay học tập' },
                { id: 'business_loan', label: 'Vay kinh doanh' },
                { id: 'consumer_loan', label: 'Vay tiêu dùng' },
                { id: 'other', label: 'Khoản vay khác' },
              ].map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setCategory(item.id as DebtCategory)}
                  className={`py-1.5 px-2.5 rounded-lg border text-center transition-colors font-medium ${
                    category === item.id
                      ? 'bg-slate-900 text-white border-slate-900 font-semibold'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Name & Lender */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Tên khoản vay *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Ngân hàng / Tổ chức *
              </label>
              <input
                type="text"
                required
                value={lender}
                onChange={(e) => setLender(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>
          </div>

          {/* Principal & Remaining */}
          <div className={mode === 'new' ? 'grid grid-cols-2 gap-3' : ''}>
            {mode === 'new' && (
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Số gốc vay ban đầu (VND) *
              </label>
              <CurrencyInput
                required
                value={principalAmount}
                onChange={setPrincipalAmount}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
              <span className="text-[11px] text-slate-500 font-mono block mt-0.5">
                {principalAmount > 0 ? formatVND(principalAmount) : ''}
              </span>
            </div>
            )}
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                {mode === 'tracked' ? 'Dư nợ gốc còn lại hiện tại (VND) *' : 'Dư nợ gốc còn lại hiện tại (VND)'}
              </label>
              <CurrencyInput
                value={remainingPrincipal}
                onChange={setRemainingPrincipal}
                invalid={!!remainingError}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
              <span className="text-[11px] text-slate-500 font-mono block mt-0.5">
                {remainingPrincipal > 0 ? formatVND(remainingPrincipal) : ''}
              </span>
              <FieldError>{remainingError}</FieldError>
            </div>
          </div>

          {/* Rates & Mechanism */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Cơ chế lãi suất
                </label>
                <div className="flex items-center gap-2 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="rateType"
                      checked={rateType === 'floating'}
                      onChange={() => setRateType('floating')}
                    />
                    <span>Thả nổi</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="rateType"
                      checked={rateType === 'fixed'}
                      onChange={() => setRateType('fixed')}
                    />
                    <span>Cố định</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Lãi suất áp dụng (%/năm) *
                </label>
                <input
                  type="number"
                  step="0.1"
                  required
                  value={annualInterestRate}
                  onChange={(e) => setAnnualInterestRate(e.target.value)}
                  aria-invalid={rateError ? true : undefined}
                  className="w-full px-2.5 py-1 text-xs bg-white border border-slate-300 rounded font-mono"
                />
              </div>
            </div>

            {rateType === 'floating' && (
              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-200">
                <div>
                  <label className="text-[11px] text-slate-600 block mb-0.5">Lãi suất cơ sở (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={baseRate}
                    onChange={(e) => {
                      setBaseRate(e.target.value);
                      setAnnualInterestRate(((parseFloat(e.target.value) || 0) + (parseFloat(floatingMargin) || 0)).toFixed(2));
                    }}
                    className="w-full px-2.5 py-1 text-xs bg-white border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-600 block mb-0.5">Biên độ thả nổi (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={floatingMargin}
                    onChange={(e) => {
                      setFloatingMargin(e.target.value);
                      setAnnualInterestRate(((parseFloat(baseRate) || 0) + (parseFloat(e.target.value) || 0)).toFixed(2));
                    }}
                    className="w-full px-2.5 py-1 text-xs bg-white border border-slate-300 rounded font-mono"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Payment Method & Tenor */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Phương thức trả nợ
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="declining_balance">Dư nợ giảm dần</option>
                <option value="equal_payment">Trả đều (Niên kim)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                {mode === 'tracked' ? 'Số kỳ còn lại (tháng)' : 'Thời hạn vay (tháng)'}
              </label>
              <input
                type="number"
                required
                value={tenorMonths}
                onChange={(e) => setTenorMonths(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                {mode === 'tracked' ? 'Ngày đến hạn kỳ tiếp theo *' : 'Ngày giải ngân (bắt đầu vay) *'}
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                {mode === 'tracked' ? 'Ân hạn gốc còn lại (tháng, chỉ trả lãi)' : 'Ân hạn gốc (tháng, chỉ trả lãi)'}
              </label>
              <input
                type="number"
                min="0"
                value={graceMonths}
                onChange={(e) => setGraceMonths(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
              />
            </div>

            {mode === 'new' && (
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Ngày trả hàng tháng
              </label>
              <input
                type="number"
                min="1"
                max="31"
                required
                value={paymentDayOfMonth}
                onChange={(e) => setPaymentDayOfMonth(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
              />
            </div>
            )}
          </div>

          {/* Nơi dùng vốn: bắt buộc */}
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Nơi dùng vốn *</label>
            <select
              data-testid="fund-kind"
              value={fundKind}
              onChange={(e) => {
                const k = e.target.value as FundUseKind | '';
                setFundKind(k);
                setFundAssetId('');
                setDisburse(k === 'wallet' && startDate === todayLocalStr());
              }}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="">-- Chọn tiền vay đã đi đâu --</option>
              <option value="wallet">Vào ví đầu tư</option>
              <option value="asset">Mua tài sản (gắn với tài sản trong danh mục)</option>
              <option value="spent">Đã chi tiêu (không có tài sản đối ứng)</option>
            </select>
            {fundKind === 'asset' && (
              <div className="mt-2">
                <select
                  data-testid="fund-asset"
                  value={fundAssetId}
                  onChange={(e) => setFundAssetId(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">-- Chọn tài sản --</option>
                  {fundAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatVND(a.currentValue, { compact: true })})
                    </option>
                  ))}
                </select>
                {fundAssets.length === 0 && (
                  <div className="mt-1 text-[11px] font-medium text-amber-700">
                    Chưa có tài sản nào chưa gắn khoản vay. Hãy thêm tài sản và chọn mua bằng vốn vay để tạo cùng lúc.
                  </div>
                )}
              </div>
            )}
            {mode === 'new' && fundKind === 'wallet' && startDate <= todayLocalStr() && (
              <label className="mt-2 flex items-start gap-2 text-xs text-slate-700 bg-sky-50 border border-sky-200 rounded-lg p-3 cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="fund-disburse"
                  checked={disburse}
                  onChange={(e) => setDisburse(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <strong>Cộng tiền vay vào ví và ghi dòng giải ngân</strong> (khoản vay mới nhận tiền).
                  Bỏ chọn nếu khoản vay đã giải ngân từ trước và chỉ cần ghi nợ.
                </span>
              </label>
            )}
          </div>

          {/* Collateral Asset Linkage */}
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              Liên kết Tài sản Thế chấp (Tùy chọn)
            </label>
            <select
              value={collateralAssetId}
              onChange={(e) => setCollateralAssetId(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="">-- Không có tài sản thế chấp (Vay tín chấp) --</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({formatVND(a.currentValue, { compact: true })})
                </option>
              ))}
            </select>
          </div>

        </ModalBody>
        <ModalFooter
          hint={errors[0] ? <span className="font-semibold text-rose-600">{errors[0]}</span> : undefined}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors font-medium"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={hasProblems}
            className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-slate-900"
          >
            Lưu khoản nợ
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
