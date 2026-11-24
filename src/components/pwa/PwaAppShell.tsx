import React, { useEffect, useState } from 'react';
import {
  LayoutGrid,
  PieChart,
  CreditCard,
  Wallet as WalletIcon,
  MoreHorizontal,
  Sun,
  ChevronLeft,
  Info,
  WifiOff,
  Plus,
  CloudOff,
} from 'lucide-react';
import { Asset, Debt, FundUse, UserFinancialState } from '../../types/finance';
import { PublicUser, AdminAccount } from '../../utils/auth';
import { formatVND } from '../../utils/calculations';
import { ApplyResult, PriceUpdate } from '../../utils/priceSync';
import { AddDebtOptions, IncomeInput, SellInput } from '../../utils/ops';
import { AssetEditInput, DebtEditInput } from '../../utils/editOps';
import { BuyMoreInput, ImprovementInput, PositionSellInput } from '../../utils/positions';
import { PrepayInput, RateChangeInput, ReconcileInput, SettleInput } from '../../utils/debtOps';
import { RolloverInput } from '../../utils/savingsOps';
import { SyncStatus } from '../../utils/syncer';
import { useOnlineStatus } from '../../utils/usePwaMode';
import { NavTab } from '../Sidebar';
import { AssetsView } from '../AssetsView';
import { PricesView } from '../PricesView';
import { DebtsView } from '../DebtsView';
import { WalletView } from '../WalletView';
import { CalendarView } from '../CalendarView';
import { ReportsView } from '../ReportsView';
import { AdminView } from '../AdminView';
import { PwaOverview } from './PwaOverview';
import { PwaMoreView, PwaSecondaryTab } from './PwaMoreView';

type PendingAction = 'add_asset' | 'add_debt' | 'deposit' | null;

interface PwaAppShellProps {
  user: PublicUser;
  state: UserFinancialState;
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  pendingAction: PendingAction;
  onAutoOpenConsumed: () => void;
  onOpenAction: (tab: NavTab, action: PendingAction) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
  onOpenAccount: () => void;
  syncStatus: SyncStatus;
  onResolveConflict: () => void;
  upcomingPaymentCount: number;
  priceAlertCount: number;
  adminPendingCount: number;
  adminAccounts: AdminAccount[] | null;
  onRefreshAccounts: () => void;
  onClearDemo: () => void;
  onKeepDemo: () => void;
  onPayDebtPeriod: (debtId: string, periodIndex: number, deductFromWallet: boolean) => Promise<boolean>;
  onAddAsset: (
    newAsset: Asset,
    deductFromWallet: boolean,
    linkedDebt?: Debt,
    downPaymentAmount?: number
  ) => boolean;
  onUpdateAsset: (asset: Asset) => void;
  onEditAsset: (assetId: string, patch: AssetEditInput) => boolean;
  onBuyMore: (p: BuyMoreInput) => boolean;
  onSellPosition: (p: PositionSellInput) => boolean;
  onPositionDividend: (p: { key: string; amount: number; date: string; note?: string }) => boolean;
  onImprovement: (p: ImprovementInput) => boolean;
  onVoidAsset: (assetId: string) => Promise<void>;
  onSellAsset: (params: SellInput, settleLinkedDebt?: boolean) => boolean;
  onReceiveInterest: (p: { assetId: string; amount: number; date: string; note?: string }) => boolean;
  onRolloverSavings: (p: RolloverInput) => boolean;
  onApplyPrices: (updates: PriceUpdate[]) => ApplyResult;
  onAddDebt: (newDebt: Debt, disburseToWallet?: boolean, extra?: Omit<AddDebtOptions, 'disburseToWallet'>) => boolean;
  onUpdateDebt: (debt: Debt) => void;
  onEditDebt: (debtId: string, patch: DebtEditInput) => boolean;
  onVoidDebt: (debtId: string) => Promise<void>;
  onSetFundUse: (debtId: string, fundUse: FundUse) => boolean;
  onAddRateChange: (input: RateChangeInput) => boolean;
  onRemoveRateChange: (debtId: string, changeId: string) => boolean;
  onSettleDebt: (input: SettleInput) => boolean;
  onPrepayDebt: (input: PrepayInput) => boolean;
  onReconcileDebt: (input: ReconcileInput) => boolean;
  onUndoReconcile: (debtId: string) => boolean;
  onDeposit: (amount: number, note?: string, date?: string) => boolean;
  onWithdraw: (amount: number, note?: string, date?: string) => boolean;
  onRecordIncome: (params: IncomeInput) => boolean;
  onVoidTx: (txId: string) => Promise<void>;
}

const TAB_TITLES: Record<NavTab, string> = {
  dashboard: 'Tổng quan',
  assets: 'Tài sản',
  debts: 'Khoản nợ',
  wallet: 'Ví',
  prices: 'Cập nhật giá',
  calendar: 'Lịch thu chi',
  balance: 'Báo cáo',
  admin: 'Quản trị',
};

const SECONDARY_TABS: ReadonlySet<NavTab> = new Set(['prices', 'calendar', 'balance', 'admin']);

function greetingForNow(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'Chào buổi sáng';
  if (h >= 11 && h < 13) return 'Chào buổi trưa';
  if (h >= 13 && h < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

export const PwaAppShell: React.FC<PwaAppShellProps> = ({
  user,
  state,
  currentTab,
  onSelectTab,
  pendingAction,
  onAutoOpenConsumed,
  onOpenAction,
  isDark,
  onToggleTheme,
  onLogout,
  onOpenAccount,
  syncStatus,
  onResolveConflict,
  upcomingPaymentCount,
  priceAlertCount,
  adminPendingCount,
  adminAccounts,
  onRefreshAccounts,
  onClearDemo,
  onKeepDemo,
  onPayDebtPeriod,
  onAddAsset,
  onUpdateAsset,
  onEditAsset,
  onBuyMore,
  onSellPosition,
  onPositionDividend,
  onImprovement,
  onVoidAsset,
  onSellAsset,
  onReceiveInterest,
  onRolloverSavings,
  onApplyPrices,
  onAddDebt,
  onUpdateDebt,
  onEditDebt,
  onVoidDebt,
  onSetFundUse,
  onAddRateChange,
  onRemoveRateChange,
  onSettleDebt,
  onPrepayDebt,
  onReconcileDebt,
  onUndoReconcile,
  onDeposit,
  onWithdraw,
  onRecordIncome,
  onVoidTx,
}) => {
  const isOnline = useOnlineStatus();
  const [moreOpen, setMoreOpen] = useState(false);

  // Bật các quy tắc CSS riêng của ứng dụng (tấm trượt, cỡ chữ ô nhập, toast...) — xem khối "CHẾ ĐỘ ỨNG DỤNG" trong index.css
  useEffect(() => {
    document.documentElement.setAttribute('data-pwa-app', '');
    return () => document.documentElement.removeAttribute('data-pwa-app');
  }, []);

  // Mỗi lần chuyển màn hình thì cuộn về đầu trang (thanh tab đáy dùng chung một vùng cuộn)
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [currentTab, moreOpen]);

  const isSecondaryView = !moreOpen && SECONDARY_TABS.has(currentTab);
  const activeBottom: 'dashboard' | 'assets' | 'debts' | 'wallet' | 'more' =
    moreOpen || isSecondaryView ? 'more' : (currentTab as 'dashboard' | 'assets' | 'debts' | 'wallet');

  const goPrimaryTab = (tab: 'dashboard' | 'assets' | 'debts' | 'wallet') => {
    setMoreOpen(false);
    onSelectTab(tab);
  };

  const goSecondaryTab = (tab: PwaSecondaryTab) => {
    setMoreOpen(false);
    onSelectTab(tab);
  };

  const goAnyTab = (tab: NavTab) => {
    if (SECONDARY_TABS.has(tab)) goSecondaryTab(tab as PwaSecondaryTab);
    else goPrimaryTab(tab as 'dashboard' | 'assets' | 'debts' | 'wallet');
  };

  const triggerAction = (tab: NavTab, action: PendingAction) => {
    setMoreOpen(false);
    onOpenAction(tab, action);
  };

  const headerTitle = moreOpen ? 'Khác' : TAB_TITLES[currentTab];
  const isDashboardRoot = !moreOpen && currentTab === 'dashboard';
  const moreAlerts = priceAlertCount + adminPendingCount;
  const containerWidth = isDashboardRoot || moreOpen ? 'max-w-lg' : 'max-w-3xl';

  // Nút thêm nhanh ở góc phải tiêu đề của từng màn hình (bản web để ở thanh đầu trang)
  const headerAction: { label: string; onClick: () => void } | null = moreOpen
    ? null
    : currentTab === 'assets'
    ? { label: 'Thêm tài sản', onClick: () => triggerAction('assets', 'add_asset') }
    : currentTab === 'debts'
    ? { label: 'Thêm khoản nợ', onClick: () => triggerAction('debts', 'add_debt') }
    : null;

  return (
    <div
      data-pwa-shell
      className="min-h-screen bg-slate-50 font-sans antialiased text-slate-900 pb-[calc(5rem+env(safe-area-inset-bottom))]"
    >
      {/* Thanh đầu app: dính đầu màn hình, tránh tai thỏ / thanh trạng thái */}
      <header
        data-pwa-header
        className="sticky top-0 z-20 border-b border-slate-200/70 bg-slate-50/90 pt-[env(safe-area-inset-top)] backdrop-blur-md"
      >
        <div className={`mx-auto flex w-full ${containerWidth} items-center justify-between gap-3 px-4 py-2.5`}>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {isSecondaryView && (
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                aria-label="Quay lại mục Khác"
                className="-ml-2 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-600 active:bg-slate-100"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold leading-tight tracking-tight text-slate-900">{headerTitle}</h1>
              {isDashboardRoot ? (
                <p className="flex items-center gap-1.5 truncate text-xs text-slate-500">
                  <Sun className="h-3.5 w-3.5 shrink-0 text-accent-ink" />
                  <span className="truncate">
                    {greetingForNow()}, <span className="font-semibold text-slate-900">{user.displayName}</span>
                  </span>
                </p>
              ) : !moreOpen ? (
                <p className="truncate font-mono text-[11px] tabular-nums text-slate-500">
                  Tiền khả dụng: <span className="font-semibold text-slate-900">{formatVND(state.wallet.availableCash)}</span>
                </p>
              ) : null}
            </div>
          </div>

          {headerAction && (
            <button
              type="button"
              onClick={headerAction.onClick}
              data-pwa-header-action
              className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-xl bg-accent px-3.5 text-xs font-semibold text-on-accent active:bg-accent-hover"
            >
              <Plus className="h-4 w-4" />
              <span>{headerAction.label}</span>
            </button>
          )}
        </div>
      </header>

      <div className={`mx-auto w-full ${containerWidth} px-4 pt-3`}>
        {/* Thông báo: ngoại tuyến, chưa lưu được, xung đột đồng bộ */}
        {!isOnline && (
          <div
            role="status"
            className="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
          >
            <WifiOff className="h-4 w-4 shrink-0 text-amber-600" />
            <span>Đang ngoại tuyến — thay đổi sẽ đồng bộ khi có kết nối lại.</span>
          </div>
        )}

        {syncStatus === 'error' && isOnline && (
          <div
            role="status"
            className="mb-3 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700"
          >
            <CloudOff className="h-4 w-4 shrink-0" />
            <span>Chưa lưu được lên máy chủ — đang thử lại.</span>
          </div>
        )}

        {syncStatus === 'conflict' && (
          <button
            type="button"
            onClick={onResolveConflict}
            className="mb-3 flex w-full items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-left text-xs font-semibold text-amber-800 active:bg-amber-100"
          >
            <span>Dữ liệu chưa đồng bộ do thay đổi từ thiết bị khác</span>
            <span className="shrink-0 underline">Xử lý</span>
          </button>
        )}

        {state.isDemo && !moreOpen && (
          <div
            role="status"
            className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-900"
          >
            <div className="flex min-w-0 flex-1 basis-40 items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>Đang xem DỮ LIỆU MẪU</strong> — số liệu giả định để minh họa.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClearDemo}
                className="min-h-[34px] rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent active:bg-accent-hover"
              >
                Xóa dữ liệu mẫu
              </button>
              <button
                type="button"
                onClick={onKeepDemo}
                className="min-h-[34px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 active:bg-slate-50"
              >
                Giữ lại
              </button>
            </div>
          </div>
        )}

        {/* Nội dung chính */}
        <main data-pwa-main>
          {moreOpen ? (
            <PwaMoreView
              user={{ displayName: user.displayName, email: user.email, role: user.role }}
              priceAlertCount={priceAlertCount}
              adminPendingCount={adminPendingCount}
              isDark={isDark}
              onToggleTheme={onToggleTheme}
              onLogout={onLogout}
              onSelectSubTab={goSecondaryTab}
              onOpenAddAsset={() => triggerAction('assets', 'add_asset')}
              onOpenAddDebt={() => triggerAction('debts', 'add_debt')}
              onOpenDeposit={() => triggerAction('wallet', 'deposit')}
              onOpenAccount={onOpenAccount}
            />
          ) : (
            <>
              {currentTab === 'dashboard' && (
                <PwaOverview
                  state={state}
                  onNavigateTab={goAnyTab}
                  onOpenAddAsset={() => triggerAction('assets', 'add_asset')}
                  onOpenAddDebt={() => triggerAction('debts', 'add_debt')}
                  onOpenDeposit={() => triggerAction('wallet', 'deposit')}
                />
              )}

              {currentTab === 'assets' && (
                <AssetsView
                  layout="pwa"
                  state={state}
                  autoOpenAdd={pendingAction === 'add_asset'}
                  onAutoOpenConsumed={onAutoOpenConsumed}
                  onAddAsset={onAddAsset}
                  onUpdateAsset={onUpdateAsset}
                  onEditAsset={onEditAsset}
                  onBuyMore={onBuyMore}
                  onSellPosition={onSellPosition}
                  onPositionDividend={onPositionDividend}
                  onImprovement={onImprovement}
                  onVoidAsset={onVoidAsset}
                  onSellAsset={onSellAsset}
                  onReceiveInterest={onReceiveInterest}
                  onRolloverSavings={onRolloverSavings}
                />
              )}

              {currentTab === 'prices' && <PricesView layout="pwa" state={state} onApplyPrices={onApplyPrices} />}

              {currentTab === 'debts' && (
                <DebtsView
                  layout="pwa"
                  state={state}
                  autoOpenAdd={pendingAction === 'add_debt'}
                  onAutoOpenConsumed={onAutoOpenConsumed}
                  onAddDebt={onAddDebt}
                  onUpdateDebt={onUpdateDebt}
                  onEditDebt={onEditDebt}
                  onVoidDebt={onVoidDebt}
                  onSetFundUse={onSetFundUse}
                  onPayDebtPeriod={onPayDebtPeriod}
                  onAddRateChange={onAddRateChange}
                  onRemoveRateChange={onRemoveRateChange}
                  onSettleDebt={onSettleDebt}
                  onPrepayDebt={onPrepayDebt}
                  onReconcileDebt={onReconcileDebt}
                  onUndoReconcile={onUndoReconcile}
                />
              )}

              {currentTab === 'wallet' && (
                <WalletView
                  layout="pwa"
                  state={state}
                  autoOpenDeposit={pendingAction === 'deposit'}
                  onAutoOpenConsumed={onAutoOpenConsumed}
                  onDeposit={onDeposit}
                  onWithdraw={onWithdraw}
                  onRecordIncome={onRecordIncome}
                  onVoidTx={onVoidTx}
                />
              )}

              {currentTab === 'calendar' && (
                <CalendarView
                  layout="pwa"
                  state={state}
                  onNavigateTab={goAnyTab}
                  onPayDebtPeriod={onPayDebtPeriod}
                />
              )}

              {currentTab === 'balance' && <ReportsView layout="pwa" state={state} />}

              {currentTab === 'admin' && user.role === 'admin' && (
                <AdminView
                  currentUser={user}
                  accounts={adminAccounts}
                  onChanged={onRefreshAccounts}
                  onBack={() => setMoreOpen(true)}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Thanh điều hướng đáy cố định (5 mục: Tổng quan · Tài sản · Khoản nợ · Ví · Khác) */}
      <nav
        data-pwa-tabbar
        aria-label="Điều hướng ứng dụng"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          <BottomTabButton
            active={activeBottom === 'dashboard'}
            label="Tổng quan"
            icon={<LayoutGrid className="h-5 w-5" />}
            onClick={() => goPrimaryTab('dashboard')}
          />
          <BottomTabButton
            active={activeBottom === 'assets'}
            label="Tài sản"
            icon={<PieChart className="h-5 w-5" />}
            onClick={() => goPrimaryTab('assets')}
          />
          <BottomTabButton
            active={activeBottom === 'debts'}
            label="Khoản nợ"
            icon={<CreditCard className="h-5 w-5" />}
            badge={upcomingPaymentCount > 0 ? upcomingPaymentCount : undefined}
            onClick={() => goPrimaryTab('debts')}
          />
          <BottomTabButton
            active={activeBottom === 'wallet'}
            label="Ví"
            icon={<WalletIcon className="h-5 w-5" />}
            onClick={() => goPrimaryTab('wallet')}
          />
          <BottomTabButton
            active={activeBottom === 'more'}
            label="Khác"
            icon={<MoreHorizontal className="h-5 w-5" />}
            dot={moreAlerts > 0}
            onClick={() => setMoreOpen(true)}
          />
        </div>
      </nav>
    </div>
  );
};

function BottomTabButton({
  active,
  label,
  icon,
  badge,
  dot,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  dot?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative flex min-h-[56px] flex-col items-center justify-center gap-1 px-1 py-1.5 transition-colors ${
        active ? 'text-accent-ink' : 'text-slate-500 hover:text-slate-900'
      }`}
    >
      <span className="relative inline-flex items-center justify-center">
        {icon}
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-1.5 -right-2.5 min-w-[16px] rounded-full bg-accent px-1 text-center font-mono text-[10px] font-semibold leading-4 text-on-accent">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
        {dot && badge === undefined && (
          <span
            className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-amber-500"
            aria-hidden="true"
          />
        )}
      </span>
      <span className="max-w-full truncate text-[11px] font-medium leading-none">{label}</span>
    </button>
  );
}
