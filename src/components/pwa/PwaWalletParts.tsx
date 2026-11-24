import React from 'react';
import { ArrowDownRight, ArrowUpRight, Clock, Coins, Undo2 } from 'lucide-react';
import { CashTransaction } from '../../types/finance';
import { formatVND, todayLocalStr } from '../../utils/calculations';
import { LedgerSummary, RANGE_PRESETS, RangePreset, txEffect } from '../../utils/ledger';
import { PwaAction, PwaCard, PwaChips, PwaEmpty, PwaStat } from './pwaUi';

const vnDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);

// ------------------------------------------------------------------ Số dư ví + thao tác
export const PwaWalletHero: React.FC<{
  available: number;
  totalDeposited: number;
  totalWithdrawn: number;
  onDeposit: () => void;
  onWithdraw: () => void;
  onIncome: () => void;
}> = ({ available, totalDeposited, totalWithdrawn, onDeposit, onWithdraw, onIncome }) => (
  <PwaCard className="p-3.5" data-pwa-wallet-hero="">
    <div className="text-[11px] font-medium text-slate-500">Tiền khả dụng ví đầu tư</div>
    <div className="mt-0.5 truncate font-mono text-[26px] font-bold leading-tight tracking-tight tabular-nums text-slate-900">
      {formatVND(available)}
    </div>

    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
      <PwaStat label="Tổng vốn đã nạp" value={formatVND(totalDeposited)} />
      <PwaStat label="Tổng vốn đã rút" value={formatVND(totalWithdrawn)} valueClass="text-slate-700" />
    </div>

    <div className="mt-3 grid grid-cols-2 gap-2">
      <PwaAction
        label="Nạp tiền"
        tone="primary"
        icon={<ArrowDownRight className="h-3.5 w-3.5" />}
        onClick={onDeposit}
        data-wallet-action="deposit"
      />
      <PwaAction
        label="Rút vốn"
        icon={<ArrowUpRight className="h-3.5 w-3.5" />}
        onClick={onWithdraw}
        disabled={available <= 0}
        title={available <= 0 ? 'Ví không còn tiền khả dụng' : undefined}
        data-wallet-action="withdraw"
      />
      <PwaAction
        label="Ghi nhận thu nhập (cổ tức / tiền thuê / lãi)"
        tone="info"
        icon={<Coins className="h-3.5 w-3.5" />}
        onClick={onIncome}
        className="col-span-2"
        data-wallet-action="income"
      />
    </div>
  </PwaCard>
);

// ------------------------------------------------------------------ Bộ lọc nhật ký
export interface PwaLedgerFiltersProps {
  filterType: string;
  onFilterType: (id: string) => void;
  rangePreset: RangePreset;
  onPreset: (id: Exclude<RangePreset, 'custom'>) => void;
  onCustom: () => void;
  dateFrom: string;
  dateTo: string;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
  rangeInvalid: boolean;
}

const TYPE_FILTERS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'inflow', label: 'Tiền vào (+)' },
  { id: 'outflow', label: 'Tiền ra (−)' },
  { id: 'debt_payment', label: 'Trả nợ' },
  { id: 'dividend', label: 'Cổ tức' },
  { id: 'rental_income', label: 'Tiền thuê' },
];

export const PwaLedgerFilters: React.FC<PwaLedgerFiltersProps> = (p) => (
  <div className="space-y-2.5">
    <PwaChips label="Loại giao dịch" attr="data-ledger-type" value={p.filterType} onChange={p.onFilterType} items={TYPE_FILTERS} />
    <PwaChips
      label="Khoảng thời gian"
      attr="data-range"
      value={p.rangePreset}
      onChange={(id) => (id === 'custom' ? p.onCustom() : p.onPreset(id as Exclude<RangePreset, 'custom'>))}
      items={[...RANGE_PRESETS.map((r) => ({ id: r.id as RangePreset, label: r.label })), { id: 'custom' as RangePreset, label: 'Chọn ngày…' }]}
    />
    {p.rangePreset === 'custom' && (
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[11px] font-semibold text-slate-600" htmlFor="ledger-from">
          Từ ngày
          <input
            id="ledger-from"
            type="date"
            value={p.dateFrom}
            max={todayLocalStr()}
            aria-invalid={p.rangeInvalid ? true : undefined}
            onChange={(e) => p.onDateFrom(e.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm font-normal"
          />
        </label>
        <label className="block text-[11px] font-semibold text-slate-600" htmlFor="ledger-to">
          Đến ngày
          <input
            id="ledger-to"
            type="date"
            value={p.dateTo}
            max={todayLocalStr()}
            aria-invalid={p.rangeInvalid ? true : undefined}
            onChange={(e) => p.onDateTo(e.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-2.5 text-sm font-normal"
          />
        </label>
        {p.rangeInvalid && (
          <span role="alert" className="col-span-2 text-[11px] font-medium text-rose-600">
            Ngày bắt đầu phải trước ngày kết thúc.
          </span>
        )}
      </div>
    )}
  </div>
);

// ------------------------------------------------------------------ Dòng tổng của khoảng đã lọc
export const PwaLedgerSummary: React.FC<{ summary: LedgerSummary; showBalances: boolean }> = ({ summary, showBalances }) => (
  <div data-ledger-summary className="space-y-2.5 rounded-xl bg-slate-50 p-2.5">
    <div className="grid grid-cols-3 gap-2">
      <PwaStat label="Tổng vào" value={`+${formatVND(summary.inflow, { compact: true })}`} valueClass="text-emerald-600" title={formatVND(summary.inflow)} />
      <PwaStat label="Tổng ra" value={`-${formatVND(summary.outflow, { compact: true })}`} title={formatVND(summary.outflow)} />
      <PwaStat
        label="Chênh lệch"
        value={`${summary.net >= 0 ? '+' : '-'}${formatVND(Math.abs(summary.net), { compact: true })}`}
        valueClass={summary.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}
        title={formatVND(summary.net)}
      />
    </div>
    {showBalances && (
      <div className="grid grid-cols-2 gap-2 border-t border-slate-200/70 pt-2.5">
        <PwaStat label="Số dư đầu kỳ" value={formatVND(summary.openingBalance)} />
        <PwaStat label="Số dư cuối kỳ" value={formatVND(summary.closingBalance)} />
      </div>
    )}
  </div>
);

// ------------------------------------------------------------------ Danh sách giao dịch
export interface PwaTxRow {
  tx: CashTransaction & { balanceAfter: number };
  badge: { label: string; color: string };
  voidable: boolean;
}

export const PwaTxList: React.FC<{ rows: PwaTxRow[]; onVoid: (txId: string) => void }> = ({ rows, onVoid }) => {
  if (rows.length === 0) {
    return <PwaEmpty icon={<Clock className="h-8 w-8" />}>Chưa có giao dịch dòng tiền nào thuộc bộ lọc này.</PwaEmpty>;
  }
  const groups: { date: string; items: PwaTxRow[] }[] = [];
  rows.forEach((r) => {
    const last = groups[groups.length - 1];
    if (last && last.date === r.tx.date) last.items.push(r);
    else groups.push({ date: r.tx.date, items: [r] });
  });
  return (
    <div className="space-y-3" data-pwa-tx-list="">
      {groups.map((g) => (
        <div key={g.date}>
          <div className="mb-1.5 px-1 font-mono text-[11px] font-semibold text-slate-500">{vnDate(g.date)}</div>
          <PwaCard className="divide-y divide-slate-100 overflow-hidden">
            {g.items.map(({ tx, badge, voidable }) => {
              const isVoided = tx.status === 'voided';
              const isReversal = !!tx.reversalOf;
              const dim = isVoided || isReversal;
              const effect = txEffect(tx);
              return (
                <div
                  key={tx.id}
                  data-tx={tx.id}
                  data-voided={isVoided ? 'true' : undefined}
                  data-reversal={isReversal ? 'true' : undefined}
                  className="px-3.5 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={`rounded border px-1.5 py-px text-[10px] font-semibold ${badge.color}`}>{badge.label}</span>
                        {isVoided && (
                          <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-px text-[10px] font-semibold text-rose-700">Đã hủy</span>
                        )}
                        {isReversal && (
                          <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-600">Bút toán đảo</span>
                        )}
                        {voidable && (
                          <button
                            type="button"
                            data-void-tx={tx.id}
                            onClick={() => onVoid(tx.id)}
                            title="Hủy bản ghi nhập nhầm"
                            aria-label="Hủy bản ghi nhập nhầm"
                            className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-500 active:bg-rose-50 active:text-rose-700"
                          >
                            <Undo2 className="h-3 w-3" />
                            <span>Hủy</span>
                          </button>
                        )}
                      </div>
                      <div
                        className={`mt-1 text-[13px] font-medium leading-snug ${dim ? 'text-slate-400' : 'text-slate-900'} ${isVoided ? 'line-through' : ''}`}
                      >
                        {tx.title}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className={`font-mono text-[14px] font-bold tabular-nums ${
                          dim ? 'text-slate-400' : effect > 0 ? 'text-emerald-600' : 'text-slate-900'
                        }`}
                      >
                        {effect > 0 ? '+' : '-'}
                        {formatVND(tx.amount)}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] tabular-nums text-slate-500">Dư {formatVND(tx.balanceAfter)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </PwaCard>
        </div>
      ))}
    </div>
  );
};
