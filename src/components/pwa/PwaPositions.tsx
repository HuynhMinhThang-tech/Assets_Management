import React from 'react';
import { ChevronDown } from 'lucide-react';
import { formatVND } from '../../utils/calculations';
import { Position } from '../../utils/positions';
import { PwaAction, PwaCard } from './pwaUi';

const vnDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);
const fmtQty = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 4 });
const pct = (n: number | null) => (n === null ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`);

/**
 * Vị thế theo mã trên điện thoại: một thẻ chung, mỗi mã một dòng gọn (mã, số lượng, giá vốn BQ, giá trị, lãi/lỗ).
 * Chạm vào dòng để mở các lô và các nút Mua thêm / Bán / Cổ tức.
 */
export const PwaPositionCards: React.FC<{
  positions: Position[];
  open: string | null;
  onToggle: (key: string) => void;
  onAction: (kind: 'buy' | 'sell' | 'div', key: string) => void;
}> = ({ positions, open, onToggle, onAction }) => (
  <PwaCard as="section" data-testid="positions-panel" className="overflow-hidden">
    <div className="border-b border-slate-100 px-3.5 py-2.5">
      <h3 className="text-sm font-semibold text-slate-900">Vị thế theo mã</h3>
    </div>
    <div className="divide-y divide-slate-100">
      {positions.map((p) => {
        const isOpen = open === p.key;
        const tone = p.unrealized >= 0 ? 'text-emerald-600' : 'text-rose-600';
        return (
          <div key={p.key} data-position={p.key}>
            <button
              type="button"
              onClick={() => onToggle(p.key)}
              aria-expanded={isOpen}
              title="Xem từng lô"
              className="w-full px-3.5 py-2.5 text-left active:bg-slate-50"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="text-[15px] font-semibold text-slate-900">{p.symbol}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="font-mono text-[14px] font-bold tabular-nums text-slate-900">{formatVND(p.totalValue)}</span>
                  <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-3 text-[11px]">
                <span className="min-w-0 truncate text-slate-500">
                  <span className="font-mono">{fmtQty(p.totalQuantity)}</span> {p.unitLabel} · vốn BQ <span className="font-mono">{formatVND(p.avgCost)}</span>
                </span>
                <span className={`shrink-0 font-mono font-semibold tabular-nums ${tone}`}>
                  {p.unrealized >= 0 ? '+' : '−'}
                  {formatVND(Math.abs(p.unrealized), { compact: true })} ({pct(p.unrealizedPct)})
                </span>
              </div>
            </button>

            {isOpen && (
              <div className="space-y-2.5 bg-slate-50/70 px-3.5 pb-3 pt-1">
                <ul data-position-lots={p.key} className="space-y-1.5 text-[11px] text-slate-700">
                  {p.lots.map((l) => (
                    <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-mono text-slate-500">{vnDate(l.purchaseDate)}</span>
                      <span>
                        {fmtQty(
                          Number((l.metadata as any)[p.category === 'stock' ? 'quantity' : p.category === 'fund' ? 'units' : 'quantityChi']) || 0
                        )}{' '}
                        {p.unitLabel}
                      </span>
                      <span className="font-mono">vốn {formatVND(l.initialCost)}</span>
                      <span className="font-mono">giá trị {formatVND(l.currentValue)}</span>
                    </li>
                  ))}
                </ul>
                <div className={`grid gap-2 ${p.category === 'stock' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  <PwaAction label="Mua thêm" onClick={() => onAction('buy', p.key)} data-pos-action="buy" />
                  <PwaAction label="Bán" tone="success" onClick={() => onAction('sell', p.key)} data-pos-action="sell" />
                  {p.category === 'stock' && <PwaAction label="Cổ tức" tone="info" onClick={() => onAction('div', p.key)} data-pos-action="div" />}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  </PwaCard>
);
