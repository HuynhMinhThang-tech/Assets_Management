/** Khung chạy riêng tab "Cập nhật giá" trong trình duyệt (giá thị trường giả qua fetch). Dùng bởi tests/prices-ui.cjs. */
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogProvider } from '../src/components/ui/DialogProvider';
import { PricesView } from '../src/components/PricesView';
import { applyPriceUpdates } from '../src/utils/priceSync';
import { todayLocalStr } from '../src/utils/calculations';
import type { Asset, UserFinancialState } from '../src/types/finance';

const M = 1_000_000;
const mk = (o: Partial<Asset>): Asset => ({
  id: 'x', name: 'X', category: 'other', initialCost: 10 * M, currentValue: 10 * M, purchaseDate: '2026-01-01', status: 'active',
  metadata: { itemType: 'Xe', details: '' } as any, realizedPnL: 0, lastValuationDate: '2026-10-01', ...o,
});
const initial: UserFinancialState = {
  wallet: { availableCash: 0, totalDeposited: 0, totalWithdrawn: 0 }, debts: [], transactions: [],
  assets: [
    mk({ id: 'fpt', name: 'FPT', category: 'stock', initialCost: 100 * M, currentValue: 120 * M, metadata: { symbol: 'FPT', exchange: 'HOSE', quantity: 1000, avgCostPrice: 100000, currentPrice: 120000, totalDividendsReceived: 0 } as any }),
    mk({ id: 'hpg', name: 'HPG', category: 'stock', initialCost: 25 * M, currentValue: 27 * M, metadata: { symbol: 'HPG', exchange: 'HOSE', quantity: 1000, avgCostPrice: 25000, currentPrice: 27000, totalDividendsReceived: 0 } as any }),
    mk({ id: 'vcb', name: 'VCB', category: 'stock', initialCost: 90 * M, currentValue: 100 * M, metadata: { symbol: 'VCB', exchange: 'HOSE', quantity: 1000, avgCostPrice: 90000, currentPrice: 100000, totalDividendsReceived: 0 } as any }),
    mk({ id: 'car', name: 'Xe hơi', category: 'other', initialCost: 500 * M, currentValue: 450 * M }),
    mk({ id: 'sav', name: 'Tiết kiệm VCB', category: 'savings', initialCost: 50 * M, currentValue: 51 * M, metadata: { bankName: 'VCB', depositAmount: 50 * M, termMonths: 6, annualInterestRate: 5, startDate: '2026-06-01', maturityDate: '2026-12-01', rolloverOption: 'close' } as any }),
  ],
};

// Giá thị trường giả: FPT +4% (ok), HPG +30% (lệch bất thường), VCB không có giá.
const QUOTES: Record<string, any[]> = {
  stock: [
    { kind: 'stock', symbol: 'FPT', date: '2026-11-03', close: 125000, prevDate: '2026-11-02', prevClose: 123000, source: 'vnstock:KBS', fetchedAt: '2026-11-03T08:10:00Z' },
    { kind: 'stock', symbol: 'HPG', date: '2026-11-03', close: 35000, prevDate: '2026-11-02', prevClose: 34500, source: 'vnstock:KBS', fetchedAt: '2026-11-03T08:10:00Z' },
  ],
};
(window as any).__fetchCount = 0;
window.fetch = (async (url: string) => {
  (window as any).__fetchCount++;
  const u = new URL(url, 'http://x');
  const kind = u.searchParams.get('kind') || 'stock';
  const wanted = (u.searchParams.get('symbols') || '').split(',');
  const prices = (QUOTES[kind] || []).filter((q) => wanted.includes(q.symbol));
  return new Response(JSON.stringify({ prices }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as any;

const App: React.FC = () => {
  const [state, setState] = useState(initial);
  const ref = useRef(state);
  ref.current = state;
  (window as any).__state = state;
  return (
    <DialogProvider>
      <PricesView
        state={state}
        onApplyPrices={(u) => {
          const r = applyPriceUpdates(ref.current, u, todayLocalStr());
          if (r.applied.length) setState(r.state);
          return r;
        }}
      />
    </DialogProvider>
  );
};
createRoot(document.getElementById('root')!).render(<App />);
