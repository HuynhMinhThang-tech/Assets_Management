import React, { useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Percent,
  Scale,
} from 'lucide-react';
import { CashTransaction, Debt } from '../../types/finance';
import { checkPayable, formatVND, isOpenItem, payLockLabel, todayLocalStr } from '../../utils/calculations';
import { currentRate, ensureTimeline } from '../../utils/debtCore';
import { canRemoveRateChange } from '../../utils/debtOps';
import { Modal, ModalBody } from '../ui/Modal';
import type { DebtActionHandlers } from '../DebtActions';
import { CARD_CLS, PwaAction, PwaBadge, PwaChips, PwaEmpty, PwaSegmented, PwaStat } from './pwaUi';

/**
 * Chi tiết khoản vay ở chế độ ứng dụng.
 *
 * Bản web dùng 4 bảng rộng (lịch trả 7 cột, lịch sử trả, mốc lãi suất, điều chỉnh sao kê) nên trên điện thoại
 * phải kéo ngang và chữ bị cắt. Ở đây mỗi bảng là một DANH SÁCH; các bảng nhiều cột (lịch trả, lịch sử trả)
 * chỉ hiện vài thông tin chính trên mỗi dòng, bấm vào dòng mới mở panel hiện đủ các cột.
 */

export type DebtDialogKind = 'rate' | 'prepay' | 'settle' | 'reconcile' | 'edit';

const vnDate = (d: string | undefined) =>
  d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d || '—';

const rateText = (r: { annualRate: number; baseRate?: number; margin?: number }) =>
  r.baseRate !== undefined && r.margin !== undefined
    ? `${r.annualRate}% (cơ sở ${r.baseRate}% + biên độ ${r.margin}%)`
    : `${r.annualRate}%`;

const PAGE = 12;

type ScheduleFilter = 'open' | 'paid' | 'all';
type Tab = 'schedule' | 'history' | 'rates' | 'adjust';

interface Props {
  debt: Debt;
  cash: number;
  payments: CashTransaction[];
  handlers: DebtActionHandlers;
  onClose: () => void;
  onOpenDialog: (kind: DebtDialogKind) => void;
}

/** Thanh nút dưới cùng của panel chi tiết (một nút chính chiếm hết bề ngang). */
const SheetFooter: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="shrink-0 border-t border-slate-100 bg-slate-50/70 px-4 py-3">{children}</div>
);

export const PwaDebtDetail: React.FC<Props> = ({ debt, cash, payments, handlers, onClose, onOpenDialog }) => {
  const schedule = debt.schedule || [];
  const active = debt.status === 'active';
  const firstUnpaidIdx = schedule.findIndex(isOpenItem);
  const openItems = schedule.filter(isOpenItem);
  const remainingInterest = openItems.reduce((s, i) => s + i.interestPayable, 0);
  const preCount = schedule.filter((i) => i.preTracking).length;
  const paidCount = schedule.filter((i) => i.isPaid && !i.preTracking).length;
  const tl = ensureTimeline(debt);
  const rateNow = currentRate(debt);
  const adjustments = debt.adjustments || [];

  const [tab, setTab] = useState<Tab>('schedule');
  const [filter, setFilter] = useState<ScheduleFilter>(openItems.length > 0 ? 'open' : 'all');
  const [showPre, setShowPre] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [periodIdx, setPeriodIdx] = useState<number | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  const entries = useMemo(() => {
    const list = schedule
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => !(item.preTracking && !showPre))
      .filter(({ item }) =>
        filter === 'open' ? isOpenItem(item) : filter === 'paid' ? item.isPaid : true
      );
    return filter === 'paid' ? list.reverse() : list; // kỳ đã trả: mới nhất lên đầu
  }, [schedule, filter, showPre]);

  const sortedPayments = useMemo(
    () => [...payments].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [payments]
  );

  /** Trạng thái nút "Thanh toán" của kỳ đang đến lượt (cùng quy tắc với bản web). */
  const payState = (idx: number) => {
    const item = schedule[idx];
    const lock = idx === firstUnpaidIdx && active ? checkPayable(debt, idx) : null;
    const locked = !!lock && lock.reason === 'month_locked';
    const short = item.totalMonthlyPayment - cash;
    return {
      locked,
      short,
      disabled: locked || short > 0,
      label: locked && lock ? payLockLabel(lock) : 'Thanh toán',
      note: locked && lock ? `Mở thanh toán từ ${vnDate(lock.unlockDate)}` : short > 0 ? `Ví thiếu ${formatVND(short)}` : '',
    };
  };

  const payPeriod = (idx: number) => {
    handlers.onPayPeriod(idx, true);
    setPeriodIdx(null);
  };

  const actions: Array<{ kind: DebtDialogKind; label: string; hint: string; icon: React.ReactNode }> = [
    { kind: 'rate', label: 'Đổi lãi suất', hint: 'Thêm mốc lãi mới, các kỳ chưa trả tự tính lại', icon: <Percent className="h-4 w-4" /> },
    { kind: 'prepay', label: 'Trả trước gốc', hint: 'Trả thêm một phần gốc để giảm lãi', icon: <ArrowDownToLine className="h-4 w-4" /> },
    { kind: 'settle', label: 'Tất toán sớm', hint: 'Trả hết dư nợ và đóng khoản vay', icon: <BadgeCheck className="h-4 w-4" /> },
    { kind: 'reconcile', label: 'Đối chiếu sao kê', hint: 'Khớp dư nợ với sao kê ngân hàng', icon: <Scale className="h-4 w-4" /> },
  ];
  if (handlers.onEditDebt) {
    actions.push({ kind: 'edit', label: 'Sửa thông tin', hint: 'Tên, ngân hàng, ghi chú, ngày trả', icon: <Pencil className="h-4 w-4" /> });
  }

  const tabItems: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'schedule', label: 'Lịch trả', count: openItems.length },
    { id: 'history', label: 'Đã trả', count: sortedPayments.length },
    { id: 'rates', label: 'Lãi suất', count: tl.length },
  ];
  if (adjustments.length > 0) tabItems.push({ id: 'adjust', label: 'Điều chỉnh', count: adjustments.length });

  // ----------------------------------------------------------------------------------- Dòng của lịch trả
  const renderPeriodRow = ({ item, idx }: { item: (typeof schedule)[number]; idx: number }) => {
    const cancelled = item.status === 'cancelled';
    const isNext = active && idx === firstUnpaidIdx;
    const pay = isNext ? payState(idx) : null;
    return (
      <li key={item.period} data-period={item.period} className={isNext ? 'bg-accent-soft' : ''}>
        <button
          type="button"
          onClick={() => setPeriodIdx(idx)}
          aria-haspopup="dialog"
          className="flex w-full items-center gap-2.5 px-3 py-3 text-left active:bg-slate-100 min-[360px]:gap-3 min-[360px]:px-3.5"
        >
          <span
            className={`grid h-9 min-w-9 shrink-0 place-items-center rounded-xl px-1 font-mono text-[11px] font-bold ${
              item.isPaid ? 'bg-emerald-50 text-emerald-700' : isNext ? 'bg-accent text-on-accent' : 'bg-slate-100 text-slate-600'
            }`}
          >
            #{item.period}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block font-mono text-[13px] font-semibold ${cancelled ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
              {vnDate(item.dueDate)}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
              {item.isPaid ? (
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Đã trả{item.paidDate ? ` ${vnDate(item.paidDate)}` : ''}
                </span>
              ) : cancelled ? (
                <span>{debt.closeReason === 'early' ? 'Hủy do tất toán' : 'Hủy do trả trước'}</span>
              ) : isNext ? (
                <PwaBadge tone="amber">Kỳ tới</PwaBadge>
              ) : (
                <span className="truncate font-mono">Dư nợ sau kỳ {formatVND(item.remainingBalance, { compact: true })}</span>
              )}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className={`block font-mono text-[13px] font-bold ${item.isPaid || cancelled ? 'text-slate-400' : 'text-slate-900'}`}>
              {formatVND(item.totalMonthlyPayment)}
            </span>
            <span className="block font-mono text-[11px] text-slate-500">
              Lãi <span className={cancelled ? '' : 'text-rose-600'}>{formatVND(item.interestPayable, { compact: true })}</span>
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 max-[359px]:hidden" />
        </button>

        {isNext && pay && (
          <div className="px-3.5 pb-3">
            <button
              type="button"
              data-pay-period={idx}
              onClick={() => payPeriod(idx)}
              disabled={pay.disabled}
              className="min-h-[44px] w-full rounded-xl bg-amber-600 px-3 text-sm font-semibold text-white active:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pay.label}
            </button>
            {pay.note && <p className="mt-1 text-center text-[11px] font-medium text-rose-600">{pay.note}</p>}
          </div>
        )}
      </li>
    );
  };

  // ----------------------------------------------------------------------------------- Panel chi tiết một kỳ
  const periodItem = periodIdx !== null ? schedule[periodIdx] : null;
  const periodSheet = periodItem && periodIdx !== null && (
    <Modal
      dismissible
      title={`Kỳ #${periodItem.period}`}
      subtitle={`Đến hạn ${vnDate(periodItem.dueDate)}`}
      onClose={() => setPeriodIdx(null)}
    >
      <ModalBody className="!space-y-4 !px-4">
        <div className={`${CARD_CLS} px-4 py-3.5 text-center`}>
          <div className="text-[11px] font-medium text-slate-500">Tổng thanh toán</div>
          <div className="mt-1 font-mono text-[21px] min-[360px]:text-[26px] font-bold leading-tight tabular-nums text-slate-900">
            {formatVND(periodItem.totalMonthlyPayment)}
          </div>
          <div className="mt-2 flex justify-center">
            {periodItem.isPaid ? (
              <PwaBadge tone="emerald">Đã trả{periodItem.paidDate ? ` ngày ${vnDate(periodItem.paidDate)}` : ''}</PwaBadge>
            ) : periodItem.status === 'cancelled' ? (
              <PwaBadge>{debt.closeReason === 'early' ? 'Hủy do tất toán sớm' : 'Hủy do trả trước'}</PwaBadge>
            ) : periodIdx === firstUnpaidIdx && active ? (
              <PwaBadge tone="amber">Kỳ tới</PwaBadge>
            ) : (
              <PwaBadge>Chưa đến lượt</PwaBadge>
            )}
          </div>
        </div>

        <div className={`${CARD_CLS} grid grid-cols-2 gap-x-3 gap-y-3 p-3.5`}>
          <PwaStat label="Tiền gốc" value={formatVND(periodItem.principalPayable)} />
          <PwaStat label="Tiền lãi" value={formatVND(periodItem.interestPayable)} valueClass="text-rose-600" />
          <PwaStat label="Dư nợ còn lại sau kỳ" value={formatVND(periodItem.remainingBalance)} />
          {periodItem.accrualFrom && <PwaStat label="Tính lãi từ" value={vnDate(periodItem.accrualFrom)} />}
        </div>

        {periodItem.segments && periodItem.segments.length > 0 && (
          <div className={`${CARD_CLS} p-3.5`} data-odd-period>
            <div className="text-[11px] font-semibold text-slate-700">Kỳ lẻ (đổi lãi giữa kỳ)</div>
            <ul className="mt-1.5 space-y-1">
              {periodItem.segments.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-2 font-mono text-[11px] text-slate-600">
                  <span>
                    {s.days} ngày × {s.annualRate}%
                  </span>
                  <span className="font-semibold text-slate-800">{formatVND(s.interest)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ModalBody>
      {periodIdx === firstUnpaidIdx && active && (
        <SheetFooter>
          {(() => {
            const pay = payState(periodIdx);
            return (
              <>
                <button
                  type="button"
                  onClick={() => payPeriod(periodIdx)}
                  disabled={pay.disabled}
                  className="min-h-[46px] w-full rounded-xl bg-amber-600 px-3 text-sm font-semibold text-white active:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pay.label}
                </button>
                {pay.note && <p className="mt-1.5 text-center text-[11px] font-medium text-rose-600">{pay.note}</p>}
              </>
            );
          })()}
        </SheetFooter>
      )}
    </Modal>
  );

  // ----------------------------------------------------------------------------------- Panel chi tiết một lần trả
  const paymentTx = paymentId ? payments.find((t) => t.id === paymentId) ?? null : null;
  const paymentLabel = (t: CashTransaction) => {
    const item = typeof t.periodIndex === 'number' ? schedule[t.periodIndex] : undefined;
    return t.settlement ? 'Tất toán sớm' : t.prepay ? 'Trả trước gốc' : item ? `Kỳ #${item.period}` : 'Thanh toán';
  };
  const paymentSheet = paymentTx && (
    <Modal
      dismissible
      title={paymentLabel(paymentTx)}
      subtitle={`Trả ngày ${vnDate(paymentTx.date)}`}
      onClose={() => setPaymentId(null)}
    >
      <ModalBody className="!space-y-4 !px-4">
        <div className={`${CARD_CLS} px-4 py-3.5 text-center`}>
          <div className="text-[11px] font-medium text-slate-500">Tổng đã trả</div>
          <div className="mt-1 font-mono text-[21px] min-[360px]:text-[26px] font-bold leading-tight tabular-nums text-slate-900">
            {formatVND(paymentTx.amount)}
          </div>
        </div>
        <div className={`${CARD_CLS} grid grid-cols-2 gap-x-3 gap-y-3 p-3.5`}>
          <PwaStat label="Tiền gốc" value={formatVND(paymentTx.principalPortion || 0)} />
          <PwaStat label="Tiền lãi" value={formatVND(paymentTx.interestPortion || 0)} valueClass="text-rose-600" />
          <PwaStat label="Phí" value={formatVND(paymentTx.feePortion || 0)} />
          <PwaStat
            label="Hạn của kỳ"
            value={
              typeof paymentTx.periodIndex === 'number' && schedule[paymentTx.periodIndex]
                ? vnDate(schedule[paymentTx.periodIndex].dueDate)
                : '—'
            }
          />
        </div>
      </ModalBody>
    </Modal>
  );

  // ----------------------------------------------------------------------------------- Panel thao tác
  const actionsSheet = actionsOpen && (
    <Modal dismissible title="Thao tác khoản vay" subtitle={debt.name} onClose={() => setActionsOpen(false)}>
      <ModalBody className="!space-y-0 !p-0">
        <ul className="divide-y divide-slate-100">
          {actions.map((a) => (
            <li key={a.kind}>
              <button
                type="button"
                data-debt-action={a.kind}
                onClick={() => {
                  setActionsOpen(false);
                  onOpenDialog(a.kind);
                }}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">{a.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900">{a.label}</span>
                  <span className="block text-[11px] text-slate-500">{a.hint}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 max-[359px]:hidden" />
              </button>
            </li>
          ))}
        </ul>
      </ModalBody>
    </Modal>
  );

  // ----------------------------------------------------------------------------------- Thân panel chính
  const shown = entries.slice(0, limit);

  return (
    <>
      <Modal
        dismissible
        title="Chi tiết khoản vay"
        subtitle={`${debt.name} · ${debt.lender}`}
        onClose={onClose}
      >
        <ModalBody className="!space-y-3 !px-4 !pb-5 !pt-3">
          <div className={`${CARD_CLS} p-3.5`}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-3">
              <PwaStat label="Dư nợ gốc còn lại" value={formatVND(debt.remainingPrincipal)} />
              <PwaStat label="Số kỳ còn lại" value={openItems.length} sub={paidCount > 0 ? `Đã trả ${paidCount} kỳ` : undefined} />
              <PwaStat label="Lãi các kỳ còn lại" value={formatVND(remainingInterest)} valueClass="text-rose-600" />
              <PwaStat
                label={debt.trackingStartDate ? 'Dư nợ lúc bắt đầu' : 'Gốc vay ban đầu'}
                value={formatVND(debt.principalAmount)}
                title={debt.trackingStartDate ? 'Dư nợ lúc bắt đầu theo dõi trong ứng dụng' : undefined}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <PwaBadge tone="sky">{debt.method === 'declining_balance' ? 'Dư nợ giảm dần' : 'Trả đều hàng tháng'}</PwaBadge>
              <PwaBadge tone="slate">Lãi {rateNow}%/năm</PwaBadge>
              {debt.trackingStartDate && <PwaBadge tone="slate">Theo dõi từ {vnDate(debt.trackingStartDate)}</PwaBadge>}
            </div>
          </div>

          {debt.closeReason === 'early' && (
            <div data-closed className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
              Đã tất toán sớm ngày {vnDate(debt.closedDate)}
            </div>
          )}

          {active && (
            <PwaAction
              label="Thao tác khoản vay"
              icon={<MoreHorizontal className="h-4 w-4" />}
              onClick={() => setActionsOpen(true)}
              className="w-full"
              data-debt-actions-open=""
            />
          )}

          {/* Thanh chuyển mục dính ở đầu vùng cuộn để luôn thấy khi kéo xuống danh sách dài */}
          <div className="sticky -top-3 z-10 -mx-4 space-y-2 bg-white px-4 pb-2 pt-3 shadow-[0_1px_0_var(--border-hairline)]">
            <PwaSegmented items={tabItems} value={tab} onChange={setTab} label="Mục chi tiết khoản vay" />
            {tab === 'schedule' && (
              <PwaChips<ScheduleFilter>
                label="Lọc lịch trả"
                value={filter}
                onChange={(f) => {
                  setFilter(f);
                  setLimit(PAGE);
                }}
                items={[
                  { id: 'open', label: 'Chưa trả', count: openItems.length },
                  { id: 'paid', label: 'Đã trả', count: schedule.filter((i) => i.isPaid && (showPre || !i.preTracking)).length },
                  { id: 'all', label: 'Tất cả' },
                ]}
              />
            )}
          </div>

          {/* ------------------------------------------------------------ Lịch trả nợ */}
          {tab === 'schedule' && (
            <>
              {preCount > 0 && (
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <input type="checkbox" checked={showPre} onChange={(e) => setShowPre(e.target.checked)} />
                  Hiện {preCount} kỳ đã qua trước khi bắt đầu theo dõi
                </label>
              )}
              {entries.length === 0 ? (
                <PwaEmpty>Không có kỳ nào trong mục này.</PwaEmpty>
              ) : (
                <div className={`${CARD_CLS} overflow-hidden`}>
                  <ul className="divide-y divide-slate-100" data-table="schedule">
                    {shown.map(renderPeriodRow)}
                  </ul>
                  {entries.length > shown.length && (
                    <button
                      type="button"
                      onClick={() => setLimit((n) => n + PAGE)}
                      className="min-h-[46px] w-full border-t border-slate-100 text-xs font-semibold text-accent-ink active:bg-slate-50"
                    >
                      Xem thêm {Math.min(PAGE, entries.length - shown.length)} kỳ · còn {entries.length - shown.length}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* ------------------------------------------------------------ Lịch sử thanh toán */}
          {tab === 'history' &&
            (sortedPayments.length === 0 ? (
              <PwaEmpty>Chưa có khoản trả nào được ghi nhận kể từ lúc theo dõi.</PwaEmpty>
            ) : (
              <div className={`${CARD_CLS} overflow-hidden`}>
                <ul className="divide-y divide-slate-100" data-table="history">
                  {sortedPayments.map((t) => (
                    <li key={t.id} data-payment={t.id}>
                      <button
                        type="button"
                        onClick={() => setPaymentId(t.id)}
                        aria-haspopup="dialog"
                        className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-slate-100"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-slate-900">{paymentLabel(t)}</span>
                          <span className="block font-mono text-[11px] text-slate-500">Trả ngày {vnDate(t.date)}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block font-mono text-[13px] font-bold text-slate-900">{formatVND(t.amount)}</span>
                          <span className="block font-mono text-[11px] text-slate-500">
                            Lãi <span className="text-rose-600">{formatVND(t.interestPortion || 0, { compact: true })}</span>
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 max-[359px]:hidden" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

          {/* ------------------------------------------------------------ Lịch sử lãi suất (ít cột: hiện đủ ngay trên thẻ) */}
          {tab === 'rates' && (
            <div className={`${CARD_CLS} overflow-hidden`}>
              <ul className="divide-y divide-slate-100" data-table="rates">
                {tl.map((r, i) => {
                  const removable = active && canRemoveRateChange(debt, r.id).ok;
                  const isNow =
                    r.annualRate === rateNow &&
                    tl.filter((x) => x.effectiveDate <= todayLocalStr()).slice(-1)[0]?.id === r.id;
                  return (
                    <li key={r.id} data-rate={r.id} className="px-3.5 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-mono text-[13px] font-semibold text-slate-900">{rateText(r)}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-500">Hiệu lực từ {vnDate(r.effectiveDate)}</div>
                        </div>
                        {isNow && <PwaBadge tone="emerald">Đang áp dụng</PwaBadge>}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-600">{i === 0 ? 'Mốc đầu' : r.note || ''}</div>
                      {removable && (
                        <button
                          type="button"
                          data-remove-rate={r.id}
                          onClick={() => handlers.onRemoveRateChange(debt.id, r.id)}
                          className="mt-2 min-h-[36px] rounded-lg border border-rose-200 bg-white px-3 text-[11px] font-semibold text-rose-600 active:bg-rose-50"
                        >
                          Bỏ mốc
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* ------------------------------------------------------------ Điều chỉnh sao kê */}
          {tab === 'adjust' && (
            <div className={`${CARD_CLS} overflow-hidden`}>
              <ul className="divide-y divide-slate-100" data-table="adjust">
                {adjustments.map((a) => {
                  const diff = a.after - a.before;
                  return (
                    <li key={a.id} className="px-3.5 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-[13px] font-semibold text-slate-900">{vnDate(a.date)}</span>
                        <span className={`font-mono text-[13px] font-bold ${diff >= 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                          {diff >= 0 ? '+' : '-'}
                          {formatVND(Math.abs(diff))}
                        </span>
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-slate-500">
                        {formatVND(a.before)} → {formatVND(a.after)}
                      </div>
                      {a.note && <div className="mt-1 text-[11px] text-slate-600">{a.note}</div>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </ModalBody>
      </Modal>

      {periodSheet}
      {paymentSheet}
      {actionsSheet}
    </>
  );
};
