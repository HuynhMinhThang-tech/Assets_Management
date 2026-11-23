import React from 'react';
import { ChevronRight } from 'lucide-react';
import { UserFinancialState } from '../../types/finance';
import { NavTab } from '../Sidebar';
import { buildAllocation, CATEGORY_META } from '../../utils/allocation';
import { calculateFinancialSummary, formatPercent, formatVND } from '../../utils/calculations';

interface PwaOverviewProps {
  state: UserFinancialState;
  onNavigateTab: (tab: NavTab) => void;
}

const DONUT_SIZE = 120;
const DONUT_R = 44;
const DONUT_STROKE = 20;
const DONUT_C = 2 * Math.PI * DONUT_R;
const DONUT_GAP = 1.4;

interface StatCard {
  id: string;
  label: string;
  value: string;
  fullTitle?: string;
  sub?: string;
  dotClass: string;
  valueClass?: string;
  onClick?: () => void;
}

export const PwaOverview: React.FC<PwaOverviewProps> = ({ state, onNavigateTab }) => {
  const summary = calculateFinancialSummary(state);
  const nextPayment = summary.upcomingPayments[0];
  const allocation = buildAllocation(summary.categoryBreakdown);

  const cards: StatCard[] = [
    {
      id: 'net-worth',
      label: 'Tài sản ròng',
      value: formatVND(summary.netWorth, { compact: true }),
      fullTitle: formatVND(summary.netWorth),
      dotClass: summary.netWorth < 0 ? 'bg-loss' : 'bg-slate-900',
      valueClass: summary.netWorth < 0 ? 'text-loss' : 'text-slate-900',
    },
    {
      id: 'cash',
      label: 'Tiền khả dụng',
      value: formatVND(summary.availableCash, { compact: true }),
      fullTitle: formatVND(summary.availableCash),
      dotClass: 'bg-emerald-500',
      onClick: () => onNavigateTab('wallet'),
    },
    {
      id: 'assets',
      label: 'Tổng tài sản',
      value: formatVND(summary.totalAssetValue, { compact: true }),
      fullTitle: formatVND(summary.totalAssetValue),
      dotClass: 'bg-accent',
      onClick: () => onNavigateTab('assets'),
    },
    {
      id: 'debt',
      label: 'Tổng dư nợ',
      value: formatVND(summary.totalDebtBalance, { compact: true }),
      fullTitle: formatVND(summary.totalDebtBalance),
      dotClass: 'bg-rose-600',
      valueClass: summary.totalDebtBalance > 0 ? 'text-rose-600' : 'text-slate-900',
      onClick: () => onNavigateTab('debts'),
    },
    {
      id: 'book-pnl',
      label: 'Lãi sổ sách',
      value: `${summary.bookPnL >= 0 ? '+' : ''}${formatVND(summary.bookPnL, { compact: true })}`,
      fullTitle: formatVND(summary.bookPnL),
      sub: `${formatPercent(summary.bookPnLPercent)} so với vốn`,
      dotClass: summary.bookPnL >= 0 ? 'bg-win' : 'bg-loss',
      valueClass: summary.bookPnL >= 0 ? 'text-win' : 'text-loss',
    },
    {
      id: 'realized-pnl',
      label: 'Lãi chốt thực tế',
      value: `${summary.totalRealizedPnL >= 0 ? '+' : ''}${formatVND(summary.totalRealizedPnL, { compact: true })}`,
      fullTitle: formatVND(summary.totalRealizedPnL),
      sub: 'Từ bán & thu nhập',
      dotClass: summary.totalRealizedPnL >= 0 ? 'bg-win' : 'bg-loss',
      valueClass: summary.totalRealizedPnL >= 0 ? 'text-win' : 'text-loss',
    },
    {
      id: 'monthly-debt',
      label: 'Trả nợ tháng này',
      value: formatVND(summary.monthlyDebtPaymentTotal, { compact: true }),
      fullTitle: formatVND(summary.monthlyDebtPaymentTotal),
      sub:
        summary.monthlyDebtPaymentTotal > 0
          ? `Gốc ${formatVND(summary.monthlyPrincipalTotal, { compact: true })}`
          : 'Đã hoàn thành tháng này',
      dotClass: summary.monthlyDebtPaymentTotal > 0 ? 'bg-amber-500' : 'bg-slate-400',
      onClick: () => onNavigateTab('debts'),
    },
    {
      id: 'next-due',
      label: 'Kỳ đến hạn tới',
      value: nextPayment ? formatVND(nextPayment.total, { compact: true }) : '0 ₫',
      fullTitle: nextPayment ? formatVND(nextPayment.total) : undefined,
      sub: nextPayment
        ? nextPayment.daysRemaining === 0
          ? `Hôm nay · ${nextPayment.debt.name}`
          : nextPayment.daysRemaining > 0
          ? `Còn ${nextPayment.daysRemaining} ngày · ${nextPayment.debt.name}`
          : `Quá hạn ${Math.abs(nextPayment.daysRemaining)} ngày`
        : 'Không có kỳ nợ',
      dotClass: !nextPayment ? 'bg-emerald-500' : nextPayment.isOverdue ? 'bg-loss' : 'bg-amber-500',
      valueClass: nextPayment?.isOverdue ? 'text-loss' : 'text-slate-900',
      onClick: () => onNavigateTab('debts'),
    },
  ];

  let offset = 0;
  const arcs = allocation.slices.map((s) => {
    const len = (s.pct / 100) * DONUT_C;
    const visible = allocation.slices.length > 1 ? Math.max(0, len - DONUT_GAP) : len;
    const arc = {
      slice: s,
      dash: `${visible.toFixed(3)} ${(DONUT_C - visible).toFixed(3)}`,
      offset: -offset,
    };
    offset += len;
    return arc;
  });

  return (
    <div className="space-y-4 animate-tab-in" data-pwa-overview>
      {/* Lưới thẻ 2 cột tinh gọn theo bố cục ứng dụng */}
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => {
          const inner = (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-slate-500">{c.label}</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${c.dotClass}`} aria-hidden="true" />
              </div>
              <div
                title={c.fullTitle}
                className={`mt-2.5 font-mono text-[17px] sm:text-lg font-bold tracking-tight tabular-nums whitespace-nowrap leading-tight ${
                  c.valueClass || 'text-slate-900'
                }`}
              >
                {c.value}
              </div>
              {c.sub && (
                <div className="mt-1 truncate text-[11px] font-medium text-slate-500 tabular-nums">
                  {c.sub}
                </div>
              )}
            </>
          );

          if (c.onClick) {
            return (
              <button
                key={c.id}
                type="button"
                onClick={c.onClick}
                className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 text-left shadow-[0_1px_2px_rgba(28,27,24,0.04)] transition-colors hover:border-slate-300 active:bg-slate-50"
              >
                {inner}
              </button>
            );
          }

          return (
            <div
              key={c.id}
              className="rounded-2xl border border-slate-200 bg-white p-3.5 sm:p-4 shadow-[0_1px_2px_rgba(28,27,24,0.04)]"
            >
              {inner}
            </div>
          );
        })}
      </div>

      {/* Thẻ biểu đồ phân bổ tài sản: Donut trái + chú giải phải */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(28,27,24,0.04)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Phân bổ tài sản</h2>
          <button
            type="button"
            onClick={() => onNavigateTab('assets')}
            className="inline-flex min-h-[32px] items-center gap-0.5 text-xs font-semibold text-accent-ink hover:text-accent-hover"
          >
            <span>Chi tiết</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {allocation.slices.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">Chưa có tài sản đang nắm giữ.</p>
        ) : (
          <div className="flex items-center gap-4">
            <div className="relative h-28 w-28 sm:h-32 sm:w-32 shrink-0">
              <svg
                viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
                className="h-full w-full"
                role="img"
                aria-label="Biểu đồ tròn phân bổ tài sản"
              >
                <circle
                  cx={DONUT_SIZE / 2}
                  cy={DONUT_SIZE / 2}
                  r={DONUT_R}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={DONUT_STROKE}
                  className="text-slate-100"
                />
                <g transform={`rotate(-90 ${DONUT_SIZE / 2} ${DONUT_SIZE / 2})`}>
                  {arcs.map(({ slice, dash, offset: off }) => (
                    <circle
                      key={slice.key}
                      cx={DONUT_SIZE / 2}
                      cy={DONUT_SIZE / 2}
                      r={DONUT_R}
                      fill="none"
                      stroke={slice.color}
                      strokeWidth={DONUT_STROKE}
                      strokeDasharray={dash}
                      strokeDashoffset={off}
                    />
                  ))}
                </g>
              </svg>
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              {allocation.slices.map((slice) => (
                <div
                  key={slice.key}
                  title={
                    slice.members.length > 1
                      ? `Gồm: ${slice.members.map((k) => CATEGORY_META[k].label).join(', ')}`
                      : undefined
                  }
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: slice.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium text-slate-600">{slice.label}</span>
                  </div>
                  <div className="shrink-0 font-mono font-semibold tabular-nums text-slate-900">
                    {slice.pct.toFixed(0)}%
                    <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                      {formatVND(slice.value, { compact: true, hideSymbol: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
