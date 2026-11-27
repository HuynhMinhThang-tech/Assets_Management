import React, { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { UserFinancialState } from '../../types/finance';
import { NavTab } from '../Sidebar';
import { buildAllocation, CATEGORY_META } from '../../utils/allocation';
import { calculateFinancialSummary, formatPercent, formatVND, todayLocalStr } from '../../utils/calculations';
import { RANGE_PRESETS, RangePreset, addDaysStr, isRangeInvalid, rangeForPreset } from '../../utils/ledger';
import { buildPeriod, cashFlowReport, profitReport, stateAt } from '../../utils/reports';
import { PwaSelect } from './pwaUi';

interface PwaOverviewProps {
  state: UserFinancialState;
  onNavigateTab: (tab: NavTab) => void;
}

const vnDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);

/** Bộ lọc thời gian của Tổng quan: "Hiện tại" = số liệu hôm nay (như trước); các mốc còn lại = số liệu tại cuối kỳ + biến động trong kỳ. */
const OVERVIEW_RANGES: { id: RangePreset; label: string }[] = [
  { id: 'all', label: 'Hiện tại' },
  ...RANGE_PRESETS.filter((r) => r.id !== 'all').map((r) => ({ id: r.id as RangePreset, label: r.label })),
  { id: 'custom', label: 'Chọn ngày…' },
];

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
  const today = todayLocalStr();
  const [preset, setPreset] = useState<RangePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const pickPreset = (id: RangePreset) => {
    setPreset(id);
    if (id === 'custom' && !customFrom && !customTo) {
      const r = rangeForPreset('this_month', today);
      setCustomFrom(r.from);
      setCustomTo(r.to);
    }
  };

  const range = preset === 'all' ? null : preset === 'custom' ? { from: customFrom, to: customTo } : rangeForPreset(preset, today);
  const rangeInvalid = preset === 'custom' && !!range && isRangeInvalid(range);
  const period = useMemo(() => {
    if (!range || rangeInvalid || !range.from || !range.to) return null;
    const p = buildPeriod({ kind: 'custom', year: 0, month: 0, quarter: 0, from: range.from, to: range.to }, today);
    return p.valid ? p : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range?.from, range?.to, rangeInvalid, today]);

  // Số liệu "hiện tại" luôn dùng cho kỳ nợ sắp tới; số liệu theo kỳ (nếu có chọn) tính tại cuối kỳ.
  const current = useMemo(() => calculateFinancialSummary(state), [state]);
  const summary = useMemo(() => (period ? calculateFinancialSummary(stateAt(state, period.to, today)) : current), [state, period, current, today]);
  const profit = useMemo(() => (period ? profitReport(state, period, today) : null), [state, period, today]);
  const cash = useMemo(() => (period ? cashFlowReport(state, period, today) : null), [state, period, today]);
  const nextPayment = current.upcomingPayments[0];
  const allocation = buildAllocation(summary.categoryBreakdown);

  const periodPaid = cash ? -(cash.operating.interestPaid + cash.financing.principalPaid + cash.financing.fees) : 0;
  const periodPrincipal = cash ? -cash.financing.principalPaid : 0;
  const netDelta = profit ? summary.netWorth - profit.startEquity : 0;
  const netDeltaPct = profit && profit.startEquity > 0 ? (netDelta / profit.startEquity) * 100 : null;

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
      label: 'Khả dụng',
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
    (() => {
      const v = profit ? profit.realizedProfit : summary.totalRealizedPnL;
      return {
        id: 'realized-pnl',
        label: profit ? 'Lãi chốt trong kỳ' : 'Lãi chốt thực tế',
        value: `${v >= 0 ? '+' : ''}${formatVND(v, { compact: true })}`,
        fullTitle: formatVND(v),
        dotClass: v >= 0 ? 'bg-win' : 'bg-loss',
        valueClass: v >= 0 ? 'text-win' : 'text-loss',
      };
    })(),
    period
      ? {
          id: 'monthly-debt',
          label: 'Trả nợ trong kỳ',
          value: formatVND(periodPaid, { compact: true }),
          fullTitle: formatVND(periodPaid),
          sub: periodPaid > 0 ? `Gốc ${formatVND(periodPrincipal, { compact: true })}` : undefined,
          dotClass: periodPaid > 0 ? 'bg-amber-500' : 'bg-slate-400',
          onClick: () => onNavigateTab('debts'),
        }
      : {
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

  const byId = (id: string) => cards.find((c) => c.id === id)!;

  const renderCard = (c: StatCard, size: 'sm' | 'md') => {
    const inner = (
      <>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-medium text-slate-500">{c.label}</span>
          <span className={`h-2 w-2 shrink-0 rounded-full ${c.dotClass}`} aria-hidden="true" />
        </div>
        <div
          title={c.fullTitle}
          className={`mt-1.5 truncate font-mono font-bold tracking-tight tabular-nums leading-tight ${
            size === 'sm' ? 'text-[14px]' : 'text-[16px]'
          } ${c.valueClass || 'text-slate-900'}`}
        >
          {c.value}
        </div>
        {c.sub && <div className="mt-0.5 truncate text-[11px] font-medium text-slate-500 tabular-nums">{c.sub}</div>}
      </>
    );
    const cls =
      'min-w-0 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-[0_1px_2px_rgba(28,27,24,0.04)]';
    return c.onClick ? (
      <button key={c.id} type="button" onClick={c.onClick} className={`${cls} transition-colors active:bg-slate-50`}>
        {inner}
      </button>
    ) : (
      <div key={c.id} className={cls}>
        {inner}
      </div>
    );
  };

  const net = byId('net-worth');

  return (
    <div className="space-y-3 animate-tab-in" data-pwa-overview>
      {/* Bộ lọc thời gian (từ ngày nào đến ngày nào) */}
      <div className="space-y-2" data-pwa-overview-range>
        <PwaSelect<RangePreset> label="Khoảng thời gian" attr="data-overview-range" value={preset} onChange={pickPreset} items={OVERVIEW_RANGES} />
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[11px] font-semibold text-slate-600" htmlFor="overview-from">
              Từ ngày
              <input
                id="overview-from"
                type="date"
                value={customFrom}
                max={today}
                aria-invalid={rangeInvalid ? true : undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm font-normal"
              />
            </label>
            <label className="block text-[11px] font-semibold text-slate-600" htmlFor="overview-to">
              Đến ngày
              <input
                id="overview-to"
                type="date"
                value={customTo}
                max={today}
                aria-invalid={rangeInvalid ? true : undefined}
                onChange={(e) => setCustomTo(e.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm font-normal"
              />
            </label>
            {rangeInvalid && (
              <span role="alert" className="col-span-2 text-[11px] font-medium text-rose-600">
                Ngày bắt đầu phải trước ngày kết thúc.
              </span>
            )}
          </div>
        )}
      </div>

      {/* Thẻ chính: tài sản ròng */}
      <section className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(28,27,24,0.04)]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-slate-500">{net.label}</span>
          <span className={`h-2 w-2 shrink-0 rounded-full ${net.dotClass}`} aria-hidden="true" />
        </div>
        <div
          title={net.fullTitle}
          className={`mt-0.5 truncate font-mono text-[21px] min-[360px]:text-[26px] font-bold leading-tight tracking-tight tabular-nums ${net.valueClass || 'text-slate-900'}`}
        >
          {formatVND(summary.netWorth)}
        </div>
        {period && profit && (
          <div data-pwa-net-delta className="mt-1 font-mono text-[11px] tabular-nums text-slate-500">
            Tại {vnDate(period.to)} · so với {vnDate(addDaysStr(period.from, -1))}:{' '}
            <span className={`font-semibold ${netDelta >= 0 ? 'text-win' : 'text-loss'}`}>
              {netDelta >= 0 ? '+' : ''}
              {formatVND(netDelta, { compact: true })}
              {netDeltaPct !== null ? ` (${formatPercent(netDeltaPct)})` : ''}
            </span>
          </div>
        )}
      </section>

      {/* Ba số nền tảng */}
      <div className="grid grid-cols-3 gap-2">
        {renderCard(byId('cash'), 'sm')}
        {renderCard(byId('assets'), 'sm')}
        {renderCard(byId('debt'), 'sm')}
      </div>

      {/* Lãi / lỗ */}
      <div className="grid grid-cols-2 gap-2">
        {renderCard(byId('book-pnl'), 'md')}
        {renderCard(byId('realized-pnl'), 'md')}
      </div>

      {/* Nợ phải trả sắp tới */}
      <div className="grid grid-cols-2 gap-2">
        {renderCard(byId('monthly-debt'), 'md')}
        {renderCard(byId('next-due'), 'md')}
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
