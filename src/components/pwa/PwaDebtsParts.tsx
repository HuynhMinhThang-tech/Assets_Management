import React from 'react';
import { CheckCircle2, CreditCard, Link as LinkIcon, ShieldCheck, Table, Undo2 } from 'lucide-react';
import { Debt, DebtCategory, UserFinancialState } from '../../types/finance';
import {
  calculateCollateralMetrics,
  checkPayable,
  formatVND,
  getNextDuePayment,
  payLockLabel,
  todayLocalStr,
} from '../../utils/calculations';
import { changeAt, ensureTimeline } from '../../utils/debtCore';
import { PwaAction, PwaBadge, PwaCard, PwaChips, PwaResultLine } from './pwaUi';

const vnDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);

const CATEGORY_SHORT: Record<DebtCategory, string> = {
  mortgage: 'Vay mua nhà',
  car_loan: 'Vay mua xe',
  student_loan: 'Vay sinh viên',
  business_loan: 'Vay kinh doanh',
  consumer_loan: 'Vay tiêu dùng',
  other: 'Khoản vay khác',
};

// ------------------------------------------------------------------ Tổng hợp
export const PwaDebtsSummary: React.FC<{
  totalRemaining: number;
  totalOriginal: number;
  totalPaid: number;
  securedCount: number;
  unsecuredCount: number;
  totalSecured: number;
  totalUnsecured: number;
}> = ({ totalRemaining, totalOriginal, totalPaid, securedCount, unsecuredCount, totalSecured, totalUnsecured }) => {
  const securedPct = totalRemaining > 0 ? (totalSecured / totalRemaining) * 100 : 0;
  const unsecuredPct = totalRemaining > 0 ? (totalUnsecured / totalRemaining) * 100 : 0;
  const paidPct = totalOriginal > 0 ? (totalPaid / totalOriginal) * 100 : 100;
  return (
    <PwaCard className="p-3.5" data-pwa-debts-summary="">
      <div className="text-[11px] font-medium text-slate-500">Tổng dư nợ hiện tại</div>
      <div className="mt-0.5 truncate font-mono text-[22px] font-bold leading-tight tracking-tight tabular-nums text-rose-600">
        {formatVND(totalRemaining)}
      </div>
      <div className="mt-0.5 text-[11px] text-slate-500">Gốc ban đầu: {formatVND(totalOriginal, { compact: true })}</div>

      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div style={{ width: `${securedPct}%` }} className="h-full bg-sky-500" title="Tỷ trọng nợ thế chấp" />
        <div style={{ width: `${unsecuredPct}%` }} className="h-full bg-amber-500" title="Tỷ trọng nợ tín chấp" />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 text-[11px]">
        <div className="min-w-0">
          <div className="flex items-center gap-1 font-medium text-sky-800">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-sky-600" />
            <span className="truncate">Thế chấp ({securedCount})</span>
          </div>
          <div className="font-mono font-semibold text-slate-900">
            {formatVND(totalSecured, { compact: true })} <span className="font-normal text-slate-500">· {securedPct.toFixed(0)}%</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1 font-medium text-amber-800">
            <CreditCard className="h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span className="truncate">Tín chấp ({unsecuredCount})</span>
          </div>
          <div className="font-mono font-semibold text-slate-900">
            {formatVND(totalUnsecured, { compact: true })} <span className="font-normal text-slate-500">· {unsecuredPct.toFixed(0)}%</span>
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-medium text-slate-500">Đã thanh toán gốc</span>
          <span className="text-[11px] text-slate-500">
            Tiến độ giải phóng nợ <strong className="font-mono text-slate-800">{paidPct.toFixed(1)}%</strong>
          </span>
        </div>
        <div className="mt-0.5 truncate font-mono text-[15px] font-bold tabular-nums text-emerald-600">{formatVND(totalPaid)}</div>
      </div>
    </PwaCard>
  );
};

// ------------------------------------------------------------------ Bộ lọc
export interface PwaDebtsFiltersProps {
  securityFilter: 'all' | 'secured' | 'unsecured';
  onSecurity: (v: 'all' | 'secured' | 'unsecured') => void;
  securityCounts: { all: number; secured: number; unsecured: number };
  categoryFilter: string;
  onCategory: (v: string) => void;
  categoryOptions: { id: string; label: string; count: number }[];
  totalCount: number;
  voidedCount: number;
  showVoided: boolean;
  onShowVoided: (v: boolean) => void;
  shown: number;
  onClear: () => void;
  filtersActive: boolean;
}

export const PwaDebtsFilters: React.FC<PwaDebtsFiltersProps> = (p) => (
  <PwaCard className="space-y-2.5 p-3.5" data-pwa-debts-filters="">
    <PwaChips
      label="Hình thức vay"
      attr="data-debt-security"
      value={p.securityFilter}
      onChange={p.onSecurity}
      items={[
        { id: 'all', label: 'Tất cả', count: p.securityCounts.all },
        { id: 'secured', label: 'Thế chấp', count: p.securityCounts.secured },
        { id: 'unsecured', label: 'Tín chấp', count: p.securityCounts.unsecured },
      ]}
    />
    <PwaChips
      label="Mục đích vay"
      attr="data-debt-category"
      value={p.categoryFilter}
      onChange={p.onCategory}
      items={[{ id: 'all', label: 'Mọi mục đích', count: p.totalCount }, ...p.categoryOptions.map((o) => ({ id: o.id, label: o.label, count: o.count }))]}
    />
    <PwaResultLine shown={p.shown} total={p.totalCount} noun="khoản nợ" onClear={p.filtersActive ? p.onClear : undefined}>
      {p.voidedCount > 0 && (
        <label className="flex min-h-[28px] items-center gap-1.5 font-semibold text-slate-600">
          <input type="checkbox" checked={p.showVoided} onChange={(e) => p.onShowVoided(e.target.checked)} />
          Đã hủy ({p.voidedCount})
        </label>
      )}
    </PwaResultLine>
  </PwaCard>
);

// ------------------------------------------------------------------ Thẻ một khoản nợ
export interface PwaDebtCardProps {
  debt: Debt;
  state: UserFinancialState;
  canVoid: boolean;
  onVoid: () => void;
  onFundUse: () => void;
  onDetail: () => void;
  onPay: (periodIndex: number) => void;
}

export const PwaDebtCard: React.FC<PwaDebtCardProps> = ({ debt, state, canVoid, onVoid, onFundUse, onDetail, onPay }) => {
  const nextPay = getNextDuePayment(debt);
  // Mỗi tháng chỉ trả một kỳ: kỳ tới đến hạn ở tháng sau thì khóa nút
  const payCheck = nextPay ? checkPayable(debt, nextPay.periodIndex) : null;
  const payLocked = !!payCheck && payCheck.reason === 'month_locked';
  const cash = state.wallet.availableCash;
  const collateralAsset = state.assets.find((a) => a.id === debt.collateralAssetId);
  const collateralMetrics = collateralAsset ? calculateCollateralMetrics(collateralAsset, debt) : null;
  const paidProgress =
    debt.principalAmount > 0 ? ((debt.principalAmount - debt.remainingPrincipal) / debt.principalAmount) * 100 : 100;
  const short = nextPay && !payLocked && cash < nextPay.total ? nextPay.total - cash : 0;
  const dayTone =
    !nextPay || nextPay.daysRemaining > 5 ? 'text-slate-700' : nextPay.daysRemaining < 0 ? 'text-rose-600' : 'text-amber-600';

  return (
    <PwaCard as="section" className="p-3.5" data-pwa-debt={debt.id}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-snug text-slate-900">{debt.name}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-slate-500">
            <span>{debt.lender}</span>
            <span>·</span>
            <span>{CATEGORY_SHORT[debt.category]}</span>
            {debt.status === 'paid_off' && <PwaBadge tone="emerald">Đã tất toán</PwaBadge>}
            {debt.status === 'voided' && <PwaBadge tone="rose">Đã hủy</PwaBadge>}
          </div>
          <div className="mt-1.5" data-fund-use={debt.fundUse?.kind || 'unspecified'}>
            {!debt.fundUse || debt.fundUse.kind === 'unspecified' ? (
              debt.status === 'voided' ? null : (
                <button
                  type="button"
                  onClick={onFundUse}
                  className="min-h-[28px] rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-left text-[11px] font-semibold text-amber-700 active:bg-amber-100"
                >
                  Chưa xác định nơi dùng vốn · Bổ sung
                </button>
              )
            ) : (
              <span className="inline-block rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {debt.fundUse.kind === 'wallet' &&
                  (debt.fundUse.cashRecorded ? 'Nơi dùng vốn: vào ví đầu tư' : 'Nơi dùng vốn: vào ví (chỉ ghi nợ)')}
                {debt.fundUse.kind === 'asset' &&
                  `Nơi dùng vốn: mua ${state.assets.find((a) => a.id === debt.fundUse?.assetId)?.name || 'tài sản'}`}
                {debt.fundUse.kind === 'spent' && 'Nơi dùng vốn: đã chi tiêu'}
              </span>
            )}
          </div>
        </div>
        {canVoid && (
          <button
            type="button"
            data-void-debt={debt.id}
            onClick={onVoid}
            title="Hủy bản ghi nhập nhầm"
            aria-label="Hủy bản ghi nhập nhầm"
            className="-mr-1 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-400 active:bg-rose-50 active:text-rose-600"
          >
            <Undo2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Tiến độ trả gốc */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2 text-[11px]">
          <span className="text-slate-500">Tiến độ trả nợ gốc</span>
          <span className="font-mono font-semibold text-slate-800">
            {paidProgress.toFixed(1)}% · còn {formatVND(debt.remainingPrincipal, { compact: true })}
          </span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div style={{ width: `${paidProgress}%` }} className="h-full rounded-full bg-emerald-500 transition-all" />
        </div>
      </div>

      {/* Lãi suất / phương thức / ngày đóng tiền */}
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5 text-[12px]">
        <div className="min-w-0">
          <div className="text-[10px] text-slate-400">Lãi suất</div>
          <div className="font-mono font-semibold text-slate-900">{debt.annualInterestRate}%/năm</div>
          {debt.status === 'active' && (
            <div className="text-[10px] leading-tight text-slate-500">
              từ {vnDate(changeAt(ensureTimeline(debt), todayLocalStr()).effectiveDate)}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-[10px] text-slate-400">Phương thức</div>
          <div className="font-semibold leading-tight text-slate-900">
            {debt.method === 'declining_balance' ? 'Dư nợ giảm dần' : 'Trả đều hàng tháng'}
          </div>
          <div className="text-[10px] leading-tight text-slate-500">Kỳ hạn {debt.tenorMonths} tháng</div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] text-slate-400">Ngày đóng tiền</div>
          <div className="font-mono font-semibold leading-tight text-slate-900">Ngày {debt.paymentDayOfMonth}</div>
          <div className="text-[10px] leading-tight text-slate-500">từ {vnDate(debt.startDate)}</div>
        </div>
      </div>

      {/* Tài sản thế chấp */}
      {collateralAsset && collateralMetrics && (
        <div className="mt-2.5 space-y-1 rounded-xl border border-sky-200 bg-sky-50/50 p-2.5 text-[11px] text-sky-800">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-1.5 font-semibold text-sky-900">
              <LinkIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
              <span className="min-w-0">Thế chấp: {collateralAsset.name}</span>
            </div>
            <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 font-mono font-semibold">
              LTV {collateralMetrics.ltvPercent.toFixed(1)}%
            </span>
          </div>
          <div className="flex flex-wrap justify-between gap-x-3">
            <span>
              Thị giá TS: <strong>{formatVND(collateralMetrics.assetValue, { compact: true })}</strong>
            </span>
            <span>
              Vốn tự có: <strong>{formatVND(collateralMetrics.netEquity, { compact: true })}</strong> ({collateralMetrics.equityPercent.toFixed(1)}%)
            </span>
          </div>
        </div>
      )}

      {/* Kỳ tới + thao tác */}
      <div className="mt-3 border-t border-slate-100 pt-3">
        {nextPay ? (
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0 text-[11px] text-slate-500">
              <div>Kỳ tới · {vnDate(nextPay.dueDate)}</div>
              <div className={`font-semibold ${dayTone}`}>
                {nextPay.daysRemaining < 0
                  ? `Quá hạn ${Math.abs(nextPay.daysRemaining)} ngày`
                  : nextPay.daysRemaining === 0
                  ? 'Hôm nay'
                  : `Còn ${nextPay.daysRemaining} ngày`}
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[17px] font-bold tabular-nums text-slate-900">{formatVND(nextPay.total)}</div>
              <div className="font-mono text-[10px] text-slate-500">
                Gốc {formatVND(nextPay.principal, { compact: true })} · Lãi {formatVND(nextPay.interest, { compact: true })}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400">Không còn kỳ nợ nào đến hạn</div>
        )}
        {short > 0 && <div className="mt-1 text-[11px] font-medium text-rose-600">Ví thiếu {formatVND(short)}</div>}

        <div className={`mt-2.5 grid gap-2 ${nextPay ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <PwaAction label="Chi tiết & lịch trả" icon={<Table className="h-3.5 w-3.5" />} onClick={onDetail} data-debt-action="detail" />
          {nextPay && (
            <PwaAction
              label={payLocked && payCheck ? payLockLabel(payCheck) : 'Trả kỳ này'}
              tone="warn"
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              onClick={() => onPay(nextPay.periodIndex)}
              disabled={payLocked || cash < nextPay.total}
              data-debt-action="pay"
              title={
                payLocked && payCheck
                  ? `Kỳ tiếp theo ngày ${payCheck.dueDate} – mở thanh toán từ ${payCheck.unlockDate}`
                  : cash < nextPay.total
                  ? `Ví thiếu ${formatVND(nextPay.total - cash)} – hãy nạp thêm tiền vào ví`
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </PwaCard>
  );
};
