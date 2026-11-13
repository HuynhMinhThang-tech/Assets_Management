/** Khung chạy các màn hình/hộp thoại mới (giai đoạn 0, 2, 3, 4) trong trình duyệt, dùng hàm thuần thật. Dùng bởi tests/ui-smoke.cjs. */
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogProvider, useDialog } from '../src/components/ui/DialogProvider';
import { DebtsView } from '../src/components/DebtsView';
import { AssetsViewPositionsHost } from './ui-smoke.host';
import { Sidebar, NavTab } from '../src/components/Sidebar';
import { Header } from '../src/components/Header';
import { applyAddDebt, OpResult } from '../src/utils/ops';
import { applyAddRateChange } from '../src/utils/debtOps';
import { applyEditDebt } from '../src/utils/editOps';
import { buildTrackedDebt } from '../src/utils/debtCore';
import type { UserFinancialState } from '../src/types/finance';

const M = 1_000_000;
const today = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
(window as any).__today = iso(today);

const base: any = { id: 'dA', name: 'Vay mua nhà', lender: 'VCB', category: 'mortgage', securityType: 'unsecured', fundUse: { kind: 'spent' } };
const first = new Date(today.getFullYear(), today.getMonth() + 1, 10);
const debtA = buildTrackedDebt(base, { balance: 600 * M, periods: 12, firstDueDate: iso(first), trackingStart: iso(today), paymentDay: 10, annualRate: 9, method: 'declining_balance' }, iso(today));

const initial: UserFinancialState = {
  wallet: { availableCash: 100 * M, totalDeposited: 100 * M, totalWithdrawn: 0 }, assets: [], debts: [debtA], transactions: [],
};
let n = 0;
const uid = (p: string) => `${p}-${++n}`;

const DebtsHost: React.FC = () => {
  const [state, setState] = useState(initial);
  const [openAdd, setOpenAdd] = useState(false);
  const ref = useRef(state);
  ref.current = state;
  (window as any).__state = state;
  const run = (r: OpResult): boolean => {
    if (!r.ok) { (window as any).__lastError = r.error; return false; }
    setState(r.state);
    return true;
  };
  return (
    <>
    <button data-open-add onClick={() => setOpenAdd(true)}>thêm</button>
    <DebtsView
      state={state}
      autoOpenAdd={openAdd}
      onAutoOpenConsumed={() => setOpenAdd(false)}
      onAddDebt={(d, disburse, extra) => run(applyAddDebt(ref.current, d, { disburseToWallet: disburse, ...extra }, uid))}
      onUpdateDebt={() => {}}
      onEditDebt={(id, patch) => run(applyEditDebt(ref.current, id, patch, uid))}
      onVoidDebt={() => {}}
      onSetFundUse={() => {}}
      onPayDebtPeriod={() => {}}
      onAddRateChange={(i) => run(applyAddRateChange(ref.current, i, uid))}
      onRemoveRateChange={() => false}
      onSettleDebt={() => false}
      onPrepayDebt={() => false}
      onReconcileDebt={() => false}
      onUndoReconcile={() => false}
    />
    </>
  );
};

const ChooseHost: React.FC = () => {
  const dialog = useDialog();
  return (
    <button data-open-choose onClick={async () => { (window as any).__choice = await dialog.choose({ title: 'Xung đột', message: 'x', tone: 'warning', choices: [{ value: 'use_server', label: 'Tải bản máy chủ' }, { value: 'overwrite', label: 'Giữ bản của tôi', tone: 'danger' }], dismissValue: 'defer' }); }}>
      mở
    </button>
  );
};

const LayoutHost: React.FC = () => {
  const [tab, setTab] = useState<NavTab>('dashboard');
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(window.matchMedia('(min-width: 1024px)').matches);
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => { setDesktop(mq.matches); if (mq.matches) setOpen(false); };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  (window as any).__tab = tab;
  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar currentTab={tab} onSelectTab={(t) => { setTab(t); setOpen(false); }} upcomingPaymentCount={0} isCollapsed={false} onToggleCollapse={() => {}}
        user={{ displayName: 'Lan', subtitle: 'lan@gmail.com', role: 'admin' }} isDark={false} onToggleTheme={() => {}} adminPendingCount={0}
        onOpenAccount={() => {}} onLogout={() => {}} mobileOpen={open} onCloseMobile={() => setOpen(false)} isDesktop={desktop} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header currentTab={tab} availableCash={123_456_789} onOpenAddAsset={() => {}} onOpenAddDebt={() => {}} onOpenDeposit={() => {}} onOpenNav={() => setOpen(true)} />
        <main className="flex-1 p-3 sm:p-6"><div data-main>Nội dung {tab}</div></main>
      </div>
    </div>
  );
};

const which = new URLSearchParams(location.search).get('host') || 'debts';
createRoot(document.getElementById('root')!).render(
  <DialogProvider>
    {which === 'debts' ? <DebtsHost /> : which === 'choose' ? <ChooseHost /> : which === 'layout' ? <LayoutHost /> : <AssetsViewPositionsHost />}
  </DialogProvider>
);
