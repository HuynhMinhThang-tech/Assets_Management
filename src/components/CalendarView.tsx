import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, CalendarDays, AlertTriangle } from 'lucide-react';
import { UserFinancialState } from '../types/finance';
import { NavTab } from './Sidebar';
import { daysInMonth, diffDays, formatVND, parseYMD, todayLocalStr } from '../utils/calculations';
import {
  buildMonthEvents,
  summarizeMonth,
  CalendarEvent,
  CalendarEventKind,
  EVENT_KIND_LABEL,
} from '../utils/calendar';

interface CalendarViewProps {
  state: UserFinancialState;
  onNavigateTab: (tab: NavTab) => void;
  onPayDebtPeriod: (
    debtId: string,
    periodIndex: number,
    deductFromWallet: boolean
  ) => boolean | void | Promise<boolean | void>;
}

const WEEKDAYS_SHORT = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const WEEKDAYS_FULL = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

const KIND_STYLE: Record<CalendarEventKind, { chip: string; badge: string; bar: string }> = {
  debt_due: {
    chip: 'bg-amber-50 text-amber-800 border-amber-200',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    bar: 'bg-amber-500',
  },
  debt_overdue: {
    chip: 'bg-rose-50 text-rose-700 border-rose-300',
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    bar: 'bg-rose-500',
  },
  debt_paid: {
    chip: 'bg-slate-100 text-slate-500 border-slate-200',
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
    bar: 'bg-slate-300',
  },
  income_expected: {
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-300 border-dashed',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    bar: 'bg-emerald-400',
  },
  income_unrecorded: {
    chip: 'bg-amber-50 text-amber-700 border-amber-300 border-dashed',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    bar: 'bg-amber-300',
  },
  income_received: {
    chip: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    bar: 'bg-emerald-600',
  },
  savings_maturity: {
    chip: 'bg-sky-50 text-sky-800 border-sky-200',
    badge: 'bg-sky-50 text-sky-800 border-sky-200',
    bar: 'bg-sky-500',
  },
};

const pad = (n: number) => String(n).padStart(2, '0');
const weekdayOf = (date: string) => {
  const { y, m, d } = parseYMD(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const fmtDM = (date: string) => {
  const { m, d } = parseYMD(date);
  return `${pad(d)}/${pad(m)}`;
};
const relativeLabel = (date: string, today: string) => {
  const diff = diffDays(date, today);
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Ngày mai';
  if (diff === -1) return 'Hôm qua';
  return diff > 0 ? `Còn ${diff} ngày` : `${-diff} ngày trước`;
};

export const CalendarView: React.FC<CalendarViewProps> = ({ state, onNavigateTab, onPayDebtPeriod }) => {
  const today = todayLocalStr();
  const [cursor, setCursor] = useState(() => {
    const { y, m } = parseYMD(todayLocalStr());
    return { y, m };
  });
  const [selected, setSelected] = useState<string | null>(null);
  const { y, m } = cursor;
  const cash = state.wallet.availableCash;

  const events = useMemo(() => buildMonthEvents(state, y, m, today), [state, y, m, today]);
  const summary = useMemo(() => summarizeMonth(events), [events]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    events.forEach((e) => {
      (map[e.date] ||= []).push(e);
    });
    return map;
  }, [events]);

  const shiftMonth = (delta: number) => {
    const t = y * 12 + (m - 1) + delta;
    setCursor({ y: Math.floor(t / 12), m: (t % 12) + 1 });
    setSelected(null);
  };
  const goToday = () => {
    const p = parseYMD(today);
    setCursor({ y: p.y, m: p.m });
    setSelected(today);
  };

  // Lưới tháng (tuần bắt đầu từ Thứ hai)
  const dim = daysInMonth(y, m);
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cellCount = Math.ceil((offset + dim) / 7) * 7;
  const cells = Array.from({ length: cellCount }, (_, i) => {
    const day = i - offset + 1;
    return day >= 1 && day <= dim ? `${y}-${pad(m)}-${pad(day)}` : null;
  });

  // Danh sách chi tiết: cả tháng hoặc đúng ngày đang chọn
  const visible = selected ? events.filter((e) => e.date === selected) : events;
  const groups: { date: string; items: CalendarEvent[] }[] = [];
  visible.forEach((e) => {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  });

  const isCurrentOrFuture = `${y}-${pad(m)}` >= today.slice(0, 7);
  const walletShort = isCurrentOrFuture && summary.outOpen > cash ? summary.outOpen - cash : 0;

  return (
    <div className="space-y-6 pb-12">
      {/* Thanh điều hướng tháng */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-emerald-600" />
          <h2 className="text-base font-bold text-slate-900">
            Tháng {pad(m)}/{y}
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Tháng trước"
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Hôm nay
          </button>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Tháng sau"
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tổng kết tháng */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="block text-xs font-semibold text-slate-500">Phải trả trong tháng</span>
          <div className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-rose-600">
            {formatVND(summary.outTotal)}
          </div>
          <div className="mt-2 space-y-0.5 text-[11px] text-slate-600">
            <div className="flex justify-between">
              <span>Đã trả</span>
              <span className="font-mono">{formatVND(summary.outPaid)}</span>
            </div>
            <div className="flex justify-between">
              <span>Còn phải trả</span>
              <span className="font-mono font-semibold text-slate-900">{formatVND(summary.outOpen)}</span>
            </div>
            {summary.outOverdue > 0 && (
              <div className="flex justify-between font-semibold text-rose-600">
                <span>Trong đó quá hạn</span>
                <span className="font-mono">{formatVND(summary.outOverdue)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="block text-xs font-semibold text-slate-500">Tiền nhận trong tháng</span>
          <div className="mt-1 font-mono text-2xl font-extrabold tabular-nums text-emerald-600">
            {formatVND(summary.inTotal)}
          </div>
          <div className="mt-2 space-y-0.5 text-[11px] text-slate-600">
            <div className="flex justify-between">
              <span>Đã nhận</span>
              <span className="font-mono">{formatVND(summary.inReceived)}</span>
            </div>
            <div className="flex justify-between">
              <span>Dự kiến nhận</span>
              <span className="font-mono">{formatVND(summary.inExpected)}</span>
            </div>
            {summary.inUnrecorded > 0 && (
              <div className="flex justify-between font-semibold text-amber-700">
                <span>Đến ngày nhưng chưa ghi nhận</span>
                <span className="font-mono">{formatVND(summary.inUnrecorded)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="block text-xs font-semibold text-slate-500">Chênh lệch dòng tiền (nhận − trả)</span>
          <div
            className={`mt-1 font-mono text-2xl font-extrabold tabular-nums ${
              summary.net >= 0 ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {summary.net >= 0 ? '+' : ''}
            {formatVND(summary.net)}
          </div>
          <div className="mt-2 text-[11px] text-slate-600">
            Tiền khả dụng trong ví: <strong className="font-mono">{formatVND(cash)}</strong>
          </div>
          {walletShort > 0 && (
            <div className="mt-1.5 flex items-start gap-1 text-[11px] font-semibold text-rose-600">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              <span>Ví chưa đủ cho các khoản còn phải trả (thiếu {formatVND(walletShort)}).</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Lưới lịch */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
          <div className="grid grid-cols-7 pb-2 text-center text-[11px] font-semibold text-slate-500">
            {WEEKDAYS_SHORT.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
            {cells.map((date, i) => {
              if (!date) return <div key={`empty-${i}`} className="min-h-[64px] bg-slate-50/70 sm:min-h-[96px]" />;
              const dayEvents = eventsByDate[date] || [];
              const isToday = date === today;
              const isSelected = date === selected;
              const day = parseYMD(date).d;
              return (
                <button
                  type="button"
                  key={date}
                  onClick={() => setSelected(isSelected ? null : date)}
                  aria-label={`Ngày ${day}, ${dayEvents.length} khoản`}
                  aria-pressed={isSelected}
                  className={`flex min-h-[64px] flex-col items-stretch gap-1 bg-white p-1.5 text-left transition-colors hover:bg-slate-50 sm:min-h-[96px] ${
                    isSelected ? 'relative z-10 ring-2 ring-slate-900' : ''
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 place-items-center self-start rounded-full text-[11px] font-semibold ${
                      isToday ? 'bg-emerald-600 text-white' : 'text-slate-700'
                    }`}
                  >
                    {day}
                  </span>

                  {/* Màn hình rộng: hiện nhãn tiền */}
                  <div className="hidden flex-col gap-0.5 sm:flex">
                    {dayEvents.slice(0, 2).map((e) => (
                      <div
                        key={e.id}
                        className={`truncate rounded border px-1 py-0.5 text-[10px] font-semibold leading-tight ${KIND_STYLE[e.kind].chip}`}
                        title={`${e.title}: ${formatVND(e.amount)}`}
                      >
                        {e.direction === 'out' ? '−' : '+'}
                        {formatVND(e.amount, { compact: true, hideSymbol: true })} {e.title}
                      </div>
                    ))}
                    {dayEvents.length > 2 && (
                      <span className="px-1 text-[10px] font-medium text-slate-500">+{dayEvents.length - 2} khoản khác</span>
                    )}
                  </div>

                  {/* Màn hình nhỏ: chỉ hiện chấm màu, xem chi tiết ở danh sách bên dưới */}
                  <div className="flex flex-wrap gap-0.5 sm:hidden">
                    {dayEvents.slice(0, 4).map((e) => (
                      <span key={e.id} className={`h-1.5 w-1.5 rounded-full ${KIND_STYLE[e.kind].bar}`} />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Chú thích */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-600">
            {(
              [
                ['debt_due', 'Đến hạn trả nợ'],
                ['debt_overdue', 'Quá hạn'],
                ['debt_paid', 'Đã trả'],
                ['income_received', 'Đã nhận'],
                ['income_expected', 'Dự kiến nhận'],
                ['savings_maturity', 'Đáo hạn tiết kiệm'],
              ] as [CalendarEventKind, string][]
            ).map(([kind, label]) => (
              <span key={kind} className="flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-sm ${KIND_STYLE[kind].bar}`} />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Danh sách chi tiết */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-1">
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <h3 className="text-sm font-bold text-slate-900">
              {selected ? `Ngày ${fmtDM(selected)} · ${WEEKDAYS_FULL[weekdayOf(selected)]}` : 'Chi tiết trong tháng'}
            </h3>
            {selected && (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-[11px] font-semibold text-emerald-600 hover:underline"
              >
                Xem cả tháng
              </button>
            )}
          </div>

          {groups.length === 0 ? (
            <p className="py-8 text-center text-xs leading-relaxed text-slate-400">
              {selected
                ? 'Ngày này không có khoản thu chi nào.'
                : 'Tháng này chưa có khoản thu chi nào. Lịch trả nợ lấy từ các khoản vay; tiền thuê hàng tháng lấy từ tài sản cho thuê (đặt ở Danh mục Tài sản).'}
            </p>
          ) : (
            <div className="max-h-[640px] space-y-4 overflow-y-auto pr-1">
              {groups.map((g) => (
                <div key={g.date}>
                  <div className="mb-1.5 flex items-center justify-between text-[11px]">
                    <span className="font-bold text-slate-700">
                      {WEEKDAYS_FULL[weekdayOf(g.date)]}, {fmtDM(g.date)}
                    </span>
                    <span className={`font-medium ${g.date === today ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {relativeLabel(g.date, today)}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {g.items.map((e) => (
                      <EventCard
                        key={e.id}
                        e={e}
                        cash={cash}
                        onPay={() => onPayDebtPeriod(e.debtId!, e.periodIndex!, true)}
                        onGo={onNavigateTab}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const EventCard: React.FC<{
  e: CalendarEvent;
  cash: number;
  onPay: () => void;
  onGo: (tab: NavTab) => void;
}> = ({ e, cash, onPay, onGo }) => {
  const style = KIND_STYLE[e.kind];
  const isDebt = e.direction === 'out';
  const short = e.amount - cash;
  const amountColor = isDebt ? (e.kind === 'debt_paid' ? 'text-slate-500' : 'text-rose-600') : 'text-emerald-600';

  return (
    <div className="flex gap-2.5 rounded-lg border border-slate-200 bg-white p-2.5 text-xs">
      <span className={`w-1 shrink-0 rounded-full ${style.bar}`} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold text-slate-900">{e.title}</div>
            <div className="text-[11px] text-slate-500">{e.subtitle}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className={`font-mono text-sm font-bold tabular-nums ${amountColor}`}>
              {isDebt ? '−' : '+'}
              {formatVND(e.amount)}
            </div>
            <span className={`mt-0.5 inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-semibold ${style.badge}`}>
              {e.kind === 'debt_paid' && <CheckCircle2 className="h-3 w-3" />}
              {EVENT_KIND_LABEL[e.kind]}
            </span>
          </div>
        </div>

        {e.direction === 'out' && (
          <div className="grid grid-cols-3 gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-[11px]">
            <div>
              <span className="block text-slate-400">Gốc</span>
              <span className="font-mono font-semibold text-slate-700">{formatVND(e.principal || 0, { compact: true })}</span>
            </div>
            <div>
              <span className="block text-slate-400">Lãi</span>
              <span className="font-mono font-semibold text-rose-600">{formatVND(e.interest || 0, { compact: true })}</span>
            </div>
            <div>
              <span className="block text-slate-400">Dư nợ sau kỳ</span>
              <span className="font-mono font-semibold text-slate-700">{formatVND(e.balanceAfter || 0, { compact: true })}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {e.payable && (
            <button
              type="button"
              onClick={onPay}
              disabled={short > 0}
              className="rounded-lg bg-amber-600 px-3 py-1 text-[11px] font-bold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-amber-600"
            >
              Trả kỳ này
            </button>
          )}
          {e.payable && short > 0 && (
            <span className="text-[11px] font-medium text-rose-600">Ví thiếu {formatVND(short)}</span>
          )}
          {isDebt && (
            <button
              type="button"
              onClick={() => onGo('debts')}
              className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:underline"
            >
              Mở khoản nợ
            </button>
          )}
          {(e.kind === 'income_expected' || e.kind === 'income_unrecorded') && (
            <button
              type="button"
              onClick={() => onGo('wallet')}
              className="text-[11px] font-semibold text-emerald-600 hover:underline"
            >
              Ghi nhận ở Ví & Dòng tiền
            </button>
          )}
          {e.kind === 'savings_maturity' && (
            <button
              type="button"
              onClick={() => onGo('assets')}
              className="text-[11px] font-semibold text-sky-700 hover:underline"
            >
              Xem tài sản
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
