import React, { useRef, useState } from 'react';
import { PositionsPanel } from '../src/components/PositionsPanel';
import { EditAssetModal } from '../src/components/EditInfoModals';
import { applyBuyMore, applyPositionDividend, applySellPosition } from '../src/utils/positions';
import { applyEditAsset } from '../src/utils/editOps';
import type { Asset, UserFinancialState } from '../src/types/finance';

type R = { ok: true; state: UserFinancialState } | { ok: false; error: string };
const M = 1_000_000;
const stock = (id: string, date: string, q: number, cost: number): Asset => ({
  id, name: 'FPT', category: 'stock', initialCost: cost, currentValue: q * 120_000, purchaseDate: date, status: 'active',
  metadata: { symbol: 'FPT', exchange: 'HOSE', quantity: q, avgCostPrice: cost / q, currentPrice: 120_000, totalDividendsReceived: 0 } as any,
  realizedPnL: 0, lastValuationDate: '2026-11-01',
});
const initial: UserFinancialState = {
  wallet: { availableCash: 50 * M, totalDeposited: 50 * M, totalWithdrawn: 0 },
  assets: [stock('l1', '2026-03-01', 100, 10 * M), stock('l2', '2026-06-01', 50, 6.5 * M)],
  debts: [], transactions: [],
};
let n = 0;
const uid = (p: string) => `${p}-${++n}`;
export const AssetsViewPositionsHost: React.FC = () => {
  const [state, setState] = useState(initial);
  const [edit, setEdit] = useState(false);
  const ref = useRef(state);
  ref.current = state;
  (window as any).__state = state;
  const run = (r: R): boolean => { if (!r.ok) { (window as any).__lastError = r.error; return false; } setState(r.state); return true; };
  return (
    <div>
      <PositionsPanel
        state={state}
        handlers={{
          onBuyMore: (p) => run(applyBuyMore(ref.current, p, uid) as R),
          onSellPosition: (p) => run(applySellPosition(ref.current, p, uid) as R),
          onPositionDividend: (p) => run(applyPositionDividend(ref.current, p, uid) as R),
        }}
      />
      <button data-open-edit onClick={() => setEdit(true)}>sửa</button>
      {edit && (
        <EditAssetModal asset={state.assets[0]} state={state} onClose={() => setEdit(false)} onSave={(patch) => run(applyEditAsset(ref.current, state.assets[0].id, patch, uid) as R)} />
      )}
    </div>
  );
};
