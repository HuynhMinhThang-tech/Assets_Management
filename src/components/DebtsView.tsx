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
  Trash2,
  Edit2,
  ChevronRight,
  TrendingDown,
  Info,
  RefreshCw,
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
} from '../types/finance';
import {
  formatVND,
  formatPercent,
  getNextDuePayment,
  generateAmortizationSchedule,
  calculateCollateralMetrics,
  recalculateFloatingDebt,
  applyHistoricalPayments,
  todayLocalStr,
} from '../utils/calculations';
import { CurrencyInput } from './CurrencyInput';
import { Modal, ModalBody, ModalFooter, FieldError } from './ui/Modal';
import { useDialog } from './ui/DialogProvider';
import { MAX_RATE, MAX_TENOR_MONTHS } from '../utils/validation';

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
  onAddDebt: (debt: Debt, disburseToWallet?: boolean) => void;
  onUpdateDebt: (debt: Debt) => void;
  onDeleteDebt: (debtId: string) => void;
  onPayDebtPeriod: (debtId: string, periodIndex: number, deductFromWallet: boolean) => boolean | void | Promise<boolean | void>;
  autoOpenAdd?: boolean;
  onAutoOpenConsumed?: () => void;
  onAdjustFloatingRate: (
    debtId: string,
    newRate: number,
    newPrincipal?: number,
    baseRate?: number,
    margin?: number
  ) => void;
}

export const DebtsView: React.FC<DebtsViewProps> = ({
  state,
  onAddDebt,
  onUpdateDebt,
  onDeleteDebt,
  onPayDebtPeriod,
  onAdjustFloatingRate,
  autoOpenAdd,
  onAutoOpenConsumed,
}) => {
  const { confirm: confirmDialog } = useDialog();
  const [scheduleDebtId, setScheduleDebtId] = useState<string | null>(null);
  const selectedDebtForSchedule = scheduleDebtId ? state.debts.find((d) => d.id === scheduleDebtId) || null : null;
  const [debtToAdjustFloating, setDebtToAdjustFloating] = useState<Debt | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

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

  const filteredDebts = state.debts.filter((debt) => {
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
                  </div>

                  <button
                    onClick={async () => {
                      const ok = await confirmDialog({
                        tone: 'danger',
                        title: `Xóa khoản nợ "${debt.name}"?`,
                        message:
                          'Lịch trả nợ của khoản này sẽ bị xóa. Các giao dịch trả nợ đã ghi trong ví KHÔNG bị đảo ngược.',
                        confirmText: 'Xóa khoản nợ',
                      });
                      if (ok) onDeleteDebt(debt.id);
                    }}
                    title="Xóa khoản nợ"
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
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
                        {state.wallet.availableCash < nextPay.total && (
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
                      onClick={() => setDebtToAdjustFloating(debt)}
                      title="Cập nhật lãi suất thả nổi hoặc số dư nợ mới, tự động tính lại toàn bộ lịch trả nợ"
                      className="px-2.5 py-1.5 text-xs font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-sky-600" />
                      <span>Cập nhật Lãi & Dư nợ</span>
                    </button>

                    <button
                      onClick={() => setScheduleDebtId(debt.id)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Table className="w-3.5 h-3.5" />
                      <span>Lịch trả nợ</span>
                    </button>

                    {nextPay && (
                      <button
                        onClick={() =>
                          onPayDebtPeriod(debt.id, nextPay.periodIndex, true)
                        }
                        disabled={state.wallet.availableCash < nextPay.total}
                        title={
                          state.wallet.availableCash < nextPay.total
                            ? `Ví thiếu ${formatVND(nextPay.total - state.wallet.availableCash)} – hãy nạp thêm tiền vào ví`
                            : undefined
                        }
                        className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-colors flex items-center gap-1 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-amber-600"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Trả kỳ này</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: FULL AMORTIZATION SCHEDULE DRAWER */}
      {selectedDebtForSchedule && (
        <AmortizationModal
          debt={selectedDebtForSchedule}
          availableCash={state.wallet.availableCash}
          onClose={() => setScheduleDebtId(null)}
          onPayPeriod={(periodIndex, deduct) => {
            onPayDebtPeriod(selectedDebtForSchedule.id, periodIndex, deduct);
          }}
        />
      )}

      {/* MODAL 2: ADD NEW DEBT */}
      {isAddModalOpen && (
        <AddDebtModal
          assets={state.assets.filter((a) => a.status === 'active')}
          onClose={() => setIsAddModalOpen(false)}
          onAdd={(debt, disburse) => {
            onAddDebt(debt, disburse);
            setIsAddModalOpen(false);
          }}
        />
      )}

      {/* MODAL 3: ADJUST FLOATING INTEREST RATE & PRINCIPAL */}
      {debtToAdjustFloating && (
        <AdjustFloatingModal
          debt={debtToAdjustFloating}
          onClose={() => setDebtToAdjustFloating(null)}
          onConfirm={(newRate, newPrincipal, baseRate, margin) => {
            onAdjustFloatingRate(debtToAdjustFloating.id, newRate, newPrincipal, baseRate, margin);
            setDebtToAdjustFloating(null);
          }}
        />
      )}
    </div>
  );
};

interface AmortizationModalProps {
  debt: Debt;
  availableCash: number;
  onClose: () => void;
  onPayPeriod: (periodIndex: number, deductFromWallet: boolean) => void;
}

const AmortizationModal: React.FC<AmortizationModalProps> = ({
  debt,
  availableCash,
  onClose,
  onPayPeriod,
}) => {
  const schedule = debt.schedule || [];
  const firstUnpaidIdx = schedule.findIndex((i) => !i.isPaid);
  const totalInterest = schedule.reduce((sum, item) => sum + item.interestPayable, 0);

  return (
    <Modal
      title="Lịch Khấu Hao & Trả Nợ Chi Tiết"
      subtitle={`${debt.name} · ${debt.lender} · ${
        debt.method === 'declining_balance' ? 'Dư nợ giảm dần' : 'Trả đều hàng tháng'
      } · Lãi suất: ${debt.annualInterestRate}%/năm`}
      size="2xl"
      onClose={onClose}
    >
      {/* Stats Row (đứng yên) */}
      <div className="grid shrink-0 grid-cols-3 border-b border-slate-200 bg-slate-50 p-4 text-xs">
        <div>
          <span className="text-slate-400 block">Gốc vay ban đầu</span>
          <span className="font-bold text-slate-900 font-mono text-sm">{formatVND(debt.principalAmount)}</span>
        </div>
        <div>
          <span className="text-slate-400 block">Tổng tiền lãi cả chu kỳ</span>
          <span className="font-bold text-rose-600 font-mono text-sm">{formatVND(totalInterest)}</span>
        </div>
        <div>
          <span className="text-slate-400 block">Dư nợ gốc còn lại</span>
          <span className="font-bold text-slate-900 font-mono text-sm">{formatVND(debt.remainingPrincipal)}</span>
        </div>
      </div>

      {/* Bảng (cuộn) */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="sticky top-0 bg-white shadow-xs">
            <tr className="border-b border-slate-200 text-slate-500 font-semibold">
              <th className="py-2.5 px-3">Kỳ</th>
              <th className="py-2.5 px-3">Ngày đến hạn</th>
              <th className="py-2.5 px-3 text-right">Tiền gốc</th>
              <th className="py-2.5 px-3 text-right">Tiền lãi</th>
              <th className="py-2.5 px-3 text-right">Tổng thanh toán</th>
              <th className="py-2.5 px-3 text-right">Dư nợ còn lại</th>
              <th className="py-2.5 px-3 text-center">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {schedule.map((item, idx) => {
              const short = item.totalMonthlyPayment - availableCash;
              return (
                <tr
                  key={item.period}
                  className={`hover:bg-slate-50 transition-colors ${
                    item.isPaid ? 'bg-slate-50/40 text-slate-400' : 'text-slate-800'
                  }`}
                >
                  <td className="py-2.5 px-3 font-semibold">#{item.period}</td>
                  <td className="py-2.5 px-3 font-sans">{item.dueDate}</td>
                  <td className="py-2.5 px-3 text-right">{formatVND(item.principalPayable)}</td>
                  <td className="py-2.5 px-3 text-right text-rose-600">{formatVND(item.interestPayable)}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                    {formatVND(item.totalMonthlyPayment)}
                  </td>
                  <td className="py-2.5 px-3 text-right">{formatVND(item.remainingBalance)}</td>
                  <td className="py-2.5 px-3 text-center font-sans">
                    {item.isPaid ? (
                      <span className="text-[11px] text-emerald-700 font-semibold flex items-center justify-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Đã trả
                      </span>
                    ) : idx === firstUnpaidIdx ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <button
                          onClick={() => onPayPeriod(idx, true)}
                          disabled={short > 0}
                          className="px-2.5 py-1 text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded shadow-xs disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-amber-600"
                        >
                          Thanh toán
                        </button>
                        {short > 0 && (
                          <span className="text-[10px] font-medium text-rose-600">Ví thiếu {formatVND(short)}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400">Chưa đến lượt</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
        >
          Đóng
        </button>
      </ModalFooter>
    </Modal>
  );
};

interface AddDebtModalProps {
  assets: Asset[];
  onClose: () => void;
  onAdd: (debt: Debt, disburseToWallet: boolean) => void;
}

const AddDebtModal: React.FC<AddDebtModalProps> = ({ assets, onClose, onAdd }) => {
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
  const [paymentDayOfMonth, setPaymentDayOfMonth] = useState('15');
  const [method, setMethod] = useState<PaymentMethod>('declining_balance');
  const [collateralAssetId, setCollateralAssetId] = useState('');
  const [notes, setNotes] = useState('');

  // ---- Ràng buộc nhập liệu: sai thì khóa nút Lưu + báo tại chỗ ----
  const principal = principalAmount || 0;
  const tenor = parseInt(tenorMonths) || 0;
  const rate = parseFloat(annualInterestRate);
  const day = parseInt(paymentDayOfMonth) || 0;
  const grace = Math.max(0, parseInt(graceMonths) || 0);
  // Bỏ trống = tự tính theo lịch trả đến hôm nay (không tự điền bằng gốc: sẽ sai với khoản vay đã trả một phần)
  const remainingInput = remainingPrincipal > 0 ? remainingPrincipal : undefined;

  const missing: string[] = [];
  if (!name.trim()) missing.push('Nhập tên khoản vay.');
  if (!lender.trim()) missing.push('Nhập ngân hàng / tổ chức cho vay.');
  if (principal <= 0) missing.push('Nhập số gốc vay ban đầu.');
  if (!startDate) missing.push('Chọn ngày giải ngân.');

  const remainingError =
    principal > 0 && remainingInput !== undefined && remainingInput > principal
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
      notes,
      status: 'active',
      schedule,
    };
    // Khoản vay đã giải ngân trong quá khứ: kỳ đã qua = đã trả; các kỳ còn lại căn theo dư nợ thực tế người dùng nhập
    const newDebt = applyHistoricalPayments(rawDebt, remainingInput);
    onAdd(newDebt, disburse && startDate >= todayLocalStr());
  };

  return (
    <Modal
      title="Thêm Khoản Vay / Nợ Mới"
      size="lg"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <ModalBody>
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
          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Dư nợ gốc còn lại hiện tại (VND)
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
                Thời hạn vay (tháng)
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
                Ngày giải ngân (bắt đầu vay) *
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
                Ân hạn gốc (tháng, chỉ trả lãi)
              </label>
              <input
                type="number"
                min="0"
                value={graceMonths}
                onChange={(e) => setGraceMonths(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
              />
            </div>

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
          </div>

          {startDate >= todayLocalStr() && (
            <label className="flex items-start gap-2 text-xs text-slate-700 bg-sky-50 border border-sky-200 rounded-lg p-3 cursor-pointer">
              <input type="checkbox" checked={disburse} onChange={(e) => setDisburse(e.target.checked)} className="mt-0.5" />
              <span>
                <strong>Tiền vay được giải ngân vào ví đầu tư</strong> (vay tiêu dùng / kinh doanh nhận tiền mặt).
                Bỏ chọn nếu tiền chuyển thẳng cho bên bán (vay mua nhà, xe).
              </span>
            </label>
          )}

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

interface AdjustFloatingModalProps {
  debt: Debt;
  onClose: () => void;
  onConfirm: (
    newRate: number,
    newPrincipal?: number,
    baseRate?: number,
    margin?: number
  ) => void;
}

const AdjustFloatingModal: React.FC<AdjustFloatingModalProps> = ({
  debt,
  onClose,
  onConfirm,
}) => {
  const [rateType, setRateType] = useState<InterestRateType>(debt.rateType);
  const [baseRate, setBaseRate] = useState<string>(debt.baseRate?.toString() || '6.2');
  const [floatingMargin, setFloatingMargin] = useState<string>(debt.floatingMargin?.toString() || '3.4');
  const [annualRate, setAnnualRate] = useState<string>(debt.annualInterestRate.toString());
  const [remainingPrincipal, setRemainingPrincipal] = useState<number>(debt.remainingPrincipal);

  const unpaidCount = (debt.schedule || []).filter((s) => !s.isPaid).length;

  const handleBaseRateChange = (val: string) => {
    setBaseRate(val);
    const b = parseFloat(val) || 0;
    const m = parseFloat(floatingMargin) || 0;
    setAnnualRate((b + m).toFixed(2));
  };

  const handleMarginChange = (val: string) => {
    setFloatingMargin(val);
    const b = parseFloat(baseRate) || 0;
    const m = parseFloat(val) || 0;
    setAnnualRate((b + m).toFixed(2));
  };

  // Live simulation comparison
  const currentNext = getNextDuePayment(debt);
  const simRate = parseFloat(annualRate) || debt.annualInterestRate;
  const simPrincipal = remainingPrincipal > 0 ? remainingPrincipal : debt.remainingPrincipal;

  const simulatedDebt = React.useMemo(() => {
    return recalculateFloatingDebt(
      debt,
      simRate,
      simPrincipal,
      rateType === 'floating' ? parseFloat(baseRate) : undefined,
      rateType === 'floating' ? parseFloat(floatingMargin) : undefined
    );
  }, [debt, simRate, simPrincipal, rateType, baseRate, floatingMargin]);

  const simNext = getNextDuePayment(simulatedDebt);
  const paymentDiff = simNext && currentNext ? simNext.total - currentNext.total : 0;

  // ---- Ràng buộc nhập liệu ----
  const rateNumber = parseFloat(annualRate);
  const baseNumber = parseFloat(baseRate);
  const marginNumber = parseFloat(floatingMargin);
  const remainingError =
    remainingPrincipal <= 0
      ? 'Nhập dư nợ gốc còn lại lớn hơn 0. Nếu đã trả hết, hãy ghi nhận trả các kỳ còn lại.'
      : remainingPrincipal > debt.principalAmount
      ? `Dư nợ còn lại không thể lớn hơn gốc vay ban đầu (${formatVND(debt.principalAmount)}).`
      : '';
  const rateError = Number.isNaN(rateNumber)
    ? 'Nhập lãi suất áp dụng.'
    : rateNumber < 0 || rateNumber > MAX_RATE
    ? `Lãi suất phải trong khoảng 0% – ${MAX_RATE}%/năm.`
    : rateType === 'floating' && (Number.isNaN(baseNumber) || Number.isNaN(marginNumber))
    ? 'Nhập đủ lãi suất cơ sở và biên độ thả nổi.'
    : '';
  const noPeriodError = unpaidCount === 0 ? 'Khoản vay không còn kỳ chưa trả nên không có lịch để tính lại.' : '';
  const errors = [remainingError, rateError, noPeriodError].filter(Boolean);
  const hasProblems = errors.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasProblems) return;
    const rateNum = rateNumber;
    const princNum = remainingPrincipal > 0 ? remainingPrincipal : undefined;
    const baseNum = rateType === 'floating' ? parseFloat(baseRate) : undefined;
    const marginNum = rateType === 'floating' ? parseFloat(floatingMargin) : undefined;

    onConfirm(rateNum, princNum, baseNum, marginNum);
  };

  return (
    <Modal
      title="Cập Nhật Lãi Suất Thả Nổi & Dư Nợ"
      subtitle={`${debt.name} · ${debt.lender} · Còn ${unpaidCount} kỳ chưa thanh toán`}
      size="lg"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <ModalBody>
          {/* Rate Type Selector */}
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1.5">
              Cơ chế lãi suất áp dụng kỳ này
            </label>
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800">
                <input
                  type="radio"
                  name="modalRateType"
                  checked={rateType === 'floating'}
                  onChange={() => setRateType('floating')}
                  className="text-sky-600"
                />
                <span>Lãi suất Thả nổi (Lãi cơ sở + Biên độ)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800">
                <input
                  type="radio"
                  name="modalRateType"
                  checked={rateType === 'fixed'}
                  onChange={() => setRateType('fixed')}
                  className="text-sky-600"
                />
                <span>Lãi suất Cố định</span>
              </label>
            </div>
          </div>

          {/* Floating calculation box */}
          {rateType === 'floating' ? (
            <div className="p-3.5 bg-sky-50/60 rounded-xl border border-sky-200 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-sky-950 block mb-1">
                    Lãi suất cơ sở mới (%/năm)
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    value={baseRate}
                    onChange={(e) => handleBaseRateChange(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-sky-300 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-sky-950 block mb-1">
                    Biên độ thả nổi (%/năm)
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    value={floatingMargin}
                    onChange={(e) => handleMarginChange(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-white border border-sky-300 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-sky-200 flex items-center justify-between text-xs">
                <span className="text-sky-900 font-medium">Tổng lãi suất áp dụng mới:</span>
                <span className="font-extrabold text-sky-700 text-sm font-mono">
                  {annualRate}%/năm
                </span>
              </div>
            </div>
          ) : (
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Lãi suất cố định mới (%/năm)
              </label>
              <input
                type="number"
                step="0.05"
                value={annualRate}
                onChange={(e) => setAnnualRate(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>
          )}

          {/* Remaining Principal Adjustment */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-700">
                Dư nợ gốc còn lại thực tế (VND)
              </label>
              <span className="text-[11px] text-slate-400">
                Hiện tại: {formatVND(debt.remainingPrincipal, { compact: true })}
              </span>
            </div>
            <CurrencyInput
              value={remainingPrincipal}
              onChange={setRemainingPrincipal}
              invalid={!!remainingError}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            <span className="text-[11px] text-slate-500 font-mono block mt-0.5">
              {remainingPrincipal > 0 ? formatVND(remainingPrincipal) : ''}
            </span>
            <FieldError>{remainingError}</FieldError>
          </div>

          {/* LIVE SIMULATION BOX */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
              Dự báo dòng tiền kỳ thanh toán tiếp theo
            </span>

            <div className="flex items-center justify-between text-slate-600">
              <span>Đang áp dụng ({debt.annualInterestRate}%):</span>
              <span className="font-mono tabular-nums font-bold text-slate-700">
                {currentNext ? formatVND(currentNext.total) : '0 ₫'}/tháng
              </span>
            </div>

            <div className="flex items-center justify-between text-slate-900 font-semibold pt-1 border-t border-slate-200">
              <span>Sau khi điều chỉnh ({annualRate}%):</span>
              <span className="font-mono tabular-nums font-bold text-sky-700 text-sm">
                {simNext ? formatVND(simNext.total) : '0 ₫'}/tháng
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px] pt-1">
              <span className="text-slate-500">Chênh lệch dòng tiền hàng tháng:</span>
              <span
                className={`font-mono font-bold ${
                  paymentDiff > 0
                    ? 'text-rose-600'
                    : paymentDiff < 0
                    ? 'text-emerald-600'
                    : 'text-slate-500'
                }`}
              >
                {paymentDiff > 0 ? `+${formatVND(paymentDiff)}` : formatVND(paymentDiff)}
                {paymentDiff !== 0 && (paymentDiff > 0 ? ' (Tăng)' : ' (Giảm)')}
              </span>
            </div>
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
            className="px-5 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-lg shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-sky-600"
          >
            Cập nhật & Tính lại Lịch Khấu Hao
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
