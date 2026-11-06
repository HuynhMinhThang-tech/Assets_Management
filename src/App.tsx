import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { AssetsView } from './components/AssetsView';
import { PricesView } from './components/PricesView';
import { DebtsView } from './components/DebtsView';
import { WalletView } from './components/WalletView';
import { CalendarView } from './components/CalendarView';
import { ReportsView } from './components/ReportsView';
import { AuthScreen } from './components/AuthScreen';
import { AdminView } from './components/AdminView';
import { AccountModal } from './components/AccountModal';
import { AlertTriangle, Info, X } from 'lucide-react';
import { useDialog } from './components/ui/DialogProvider';
import {
  UserFinancialState,
  Asset,
  Debt,
  CashTransaction,
} from './types/finance';
import { normalizeState, emptyState, createDemoState, findLocalLegacyData, exportStateToJson } from './utils/storage';
import { PublicUser, AdminAccount, countPendingWork } from './utils/auth';
import { api, ApiError } from './utils/api';
import { PortfolioSyncer, SyncStatus } from './utils/syncer';
import { Theme, getStoredTheme, applyTheme } from './utils/theme';
import {
  calculateFinancialSummary,
  getNextDuePayment,
  formatVND,
  todayLocalStr,
  checkPayable,
  payLockLabel,
} from './utils/calculations';
import { ApplyResult, PriceUpdate, STALE_DAYS, applyPriceUpdates, listPriceRows } from './utils/priceSync';
import { insertTx } from './utils/ledger';
import {
  OpResult, SellInput, applyAddDebt, applyDeposit, applyIncome, applyPayPeriod, applySell, applySetFundUse, applyVoidAsset,
  applyVoidDebt, applyVoidTx, applyWithdraw, canVoidAsset, canVoidDebt, canVoidTx, IncomeInput,
} from './utils/ops';
import { PayDateField } from './components/PayDateField';
import { calculateBalanceSheet } from './utils/balanceSheet';
import { groupsOf } from './utils/reports';
import {
  PrepayInput, RateChangeInput, ReconcileInput, SettleInput, applyAddRateChange, applyPrepay, applyReconcile, applyRemoveRateChange,
  applySettle, applyUndoReconcile,
} from './utils/debtOps';
import { RolloverInput, applyReceiveSavingsInterest, applyRollover } from './utils/savingsOps';
import { FundUse } from './types/finance';

export type PendingAction = 'add_asset' | 'add_debt' | 'deposit' | null;

let uidCounter = 0;
/** ID duy nhất (không trùng khi thao tác nhanh trong cùng 1 mili-giây). */
const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export type SellParams = SellInput;
export type IncomeParams = IncomeInput;

interface FinanceAppProps {
  user: PublicUser;
  /** Dữ liệu vừa tải từ máy chủ (hoặc bản mẫu / bản nhập từ trình duyệt cho tài khoản mới). */
  initialState: UserFinancialState;
  /** Phiên bản dữ liệu trên máy chủ (0 = chưa có). */
  initialVersion: number;
  /** Bản đã có trên máy chủ ở dạng chuỗi (null = chưa lưu lần nào → lưu ngay). */
  initialSavedJson: string | null;
  isDark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
  onUnauthorized: () => void;
  onUserChanged: (user: PublicUser) => void;
}

/** Phần ứng dụng sau khi đăng nhập và đã tải dữ liệu. Mọi thay đổi tự động lưu lên máy chủ (Neon). */
function FinanceApp({
  user,
  initialState,
  initialVersion,
  initialSavedJson,
  isDark,
  onToggleTheme,
  onLogout,
  onUnauthorized,
  onUserChanged,
}: FinanceAppProps) {
  const [state, setState] = useState<UserFinancialState>(initialState);
  const [accountOpen, setAccountOpen] = useState(false);
  useEffect(() => {
    if (user.role !== 'admin') setCurrentTab((t) => (t === 'admin' ? 'dashboard' : t));
  }, [user.role]);
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const dialog = useDialog();

  // ---- Đồng bộ lên máy chủ ----
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncer] = useState(
    () =>
      new PortfolioSyncer(
        {
          save: api.savePortfolio,
          loadServer: async () => {
            const res = await api.getPortfolio();
            return { data: res.data ? normalizeState(res.data) : null, version: res.version };
          },
          onConflict: async () => {
            const keepMine = await dialog.confirm({
              tone: 'danger',
              title: 'Dữ liệu đã thay đổi ở nơi khác',
              message:
                'Dữ liệu trên máy chủ vừa được cập nhật từ thiết bị khác, khác với bản đang mở ở đây.\n\n• "Tải bản máy chủ": bỏ các thay đổi chưa lưu ở đây.\n• "Giữ bản của tôi": ghi đè lên bản trên máy chủ.',
              confirmText: 'Giữ bản của tôi',
              cancelText: 'Tải bản máy chủ',
            });
            return keepMine ? 'overwrite' : 'use_server';
          },
          onReplace: (next) => setState(next),
          onStatus: setSyncStatus,
          onUnauthorized,
        },
        initialVersion,
        initialSavedJson
      )
  );
  useEffect(() => {
    syncer.update(state);
  }, [state, syncer]);
  useEffect(() => {
    syncer.start();
    const leave = () => syncer.flushOnLeave();
    const onHidden = () => {
      if (document.visibilityState === 'hidden') leave();
    };
    const warnUnsaved = (e: BeforeUnloadEvent) => {
      if (syncer.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('pagehide', leave);
    window.addEventListener('beforeunload', warnUnsaved);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('beforeunload', warnUnsaved);
      document.removeEventListener('visibilitychange', onHidden);
      syncer.stop();
    };
  }, [syncer]);

  // ---- Quản trị viên: danh sách tài khoản (dùng cho trang Quản trị và số việc chờ trên Sidebar) ----
  const isAdmin = user.role === 'admin';
  const [adminAccounts, setAdminAccounts] = useState<AdminAccount[] | null>(null);
  const refreshAccounts = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await api.listAccounts();
      setAdminAccounts(res.accounts);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
    }
  }, [isAdmin, onUnauthorized]);
  useEffect(() => {
    if (!isAdmin) return;
    void refreshAccounts();
    const id = window.setInterval(() => void refreshAccounts(), 60_000);
    // Quay lại tab trình duyệt → nạp lại ngay để thấy đăng ký mới
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshAccounts();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAdmin, refreshAccounts]);
  // Mở trang Quản trị → nạp danh sách mới nhất ngay (không đợi chu kỳ 60 giây)
  useEffect(() => {
    if (isAdmin && currentTab === 'admin') void refreshAccounts();
  }, [isAdmin, currentTab, refreshAccounts]);

  const summary = calculateFinancialSummary(state);

  // Ảnh chụp tài sản ròng theo ngày → vẽ biểu đồ xu hướng (không ghi khi đang dùng dữ liệu mẫu)
  const snapKey = `${summary.netWorth}|${summary.totalAssetValue}|${summary.totalDebtBalance}|${state.wallet.availableCash}`;
  const lastSnapKey = useRef('');
  useEffect(() => {
    if (state.isDemo || lastSnapKey.current === snapKey) return;
    lastSnapKey.current = snapKey;
    const today = todayLocalStr();
    const g = groupsOf(calculateBalanceSheet(state, today));
    const snap = {
      date: today,
      netWorth: summary.netWorth,
      assets: summary.totalAssetValue,
      debts: summary.totalDebtBalance,
      cash: state.wallet.availableCash,
      groups: { stock: g.stock, fund: g.fund, gold: g.gold, savings: g.savings, real_estate: g.real_estate, other: g.other },
      debtShort: g.debtShort,
      debtLong: g.debtLong,
    };
    setState((prev) => {
      const list = [...(prev.snapshots || [])];
      if (list.length && list[list.length - 1].date === today) list[list.length - 1] = snap;
      else list.push(snap);
      return { ...prev, snapshots: list.slice(-730) };
    });
  }, [snapKey, state.isDemo]);

  const openAction = (tab: NavTab, action: PendingAction) => {
    setCurrentTab(tab);
    setPendingAction(action);
  };

  /** Chặn khi ví không đủ tiền. Giao diện đã khóa nút từ trước; đây là lớp bảo vệ cuối cùng. */
  const insufficient = (need: number, what: string): boolean => {
    const have = state.wallet.availableCash;
    if (need > have) {
      void dialog.alert({
        tone: 'error',
        title: 'Ví không đủ tiền',
        message: `Cần ${formatVND(need)} để ${what}, nhưng ví chỉ còn ${formatVND(have)} (thiếu ${formatVND(
          need - have
        )}).\n\nHãy nạp thêm tiền vào ví trước${
          what.startsWith('mua') ? ' hoặc bỏ chọn "trích tiền từ ví" nếu đã thanh toán từ nguồn khác' : ''
        }.`,
      });
      return true;
    }
    return false;
  };

  // 1. ASSET HANDLERS
  const handleAddAsset = (
    newAsset: Asset,
    deductFromWallet: boolean,
    linkedDebt?: Debt,
    downPaymentAmount?: number
  ): boolean => {
    const costToDeduct = downPaymentAmount !== undefined ? downPaymentAmount : newAsset.initialCost;
    if (deductFromWallet && costToDeduct > 0 && insufficient(costToDeduct, `mua "${newAsset.name}"`)) {
      return false;
    }
    setState((prev) => {
      const updatedWallet = { ...prev.wallet };
      let updatedTransactions = [...prev.transactions];

      if (deductFromWallet && costToDeduct > 0) {
        updatedWallet.availableCash = updatedWallet.availableCash - costToDeduct;
        updatedTransactions = insertTx(updatedTransactions, {
          id: uid('tx'),
          date: newAsset.purchaseDate,
          type: 'buy_asset',
          amount: costToDeduct,
          title: linkedDebt
            ? `Vốn tự có mua: ${newAsset.name} (Vay ${linkedDebt.lender})`
            : `Mua tài sản: ${newAsset.name}`,
          linkedAssetId: newAsset.id,
          linkedDebtId: linkedDebt?.id,
          note: linkedDebt
            ? `Vốn tự có: ${formatVND(costToDeduct)} · Vay ngân hàng: ${formatVND(linkedDebt.principalAmount)}`
            : `Trích tiền ví giải ngân mua ${newAsset.name}`,
        });
      }

      const assetToAdd = { ...newAsset };
      let debtsToAdd = prev.debts;

      if (linkedDebt) {
        assetToAdd.linkedDebtId = linkedDebt.id;
        const linkedDebtWithCollateral: Debt = {
          ...linkedDebt,
          collateralAssetId:
            linkedDebt.securityType === 'unsecured'
              ? undefined
              : linkedDebt.collateralAssetId || assetToAdd.id,
          fundUse: { kind: 'asset', assetId: assetToAdd.id },
        };
        debtsToAdd = [linkedDebtWithCollateral, ...prev.debts];
      }

      return {
        ...prev,
        wallet: updatedWallet,
        assets: [assetToAdd, ...prev.assets],
        debts: debtsToAdd,
        transactions: updatedTransactions,
      };
    });
    dialog.toast(`Đã thêm tài sản "${newAsset.name}"${linkedDebt ? ' và khoản vay liên kết' : ''}.`);
    return true;
  };

  const handleUpdateAsset = (updatedAsset: Asset) => {
    setState((prev) => ({
      ...prev,
      assets: prev.assets.map((a) => (a.id === updatedAsset.id ? updatedAsset : a)),
    }));
  };

  /**
   * Định giá lại theo ĐƠN GIÁ (giá/CP, NAV/CCQ, giá/chỉ, giá/m²): tổng giá trị = số lượng × đơn giá.
   * Tiết kiệm và tài sản khác không có đơn giá nên nhập tổng giá trị. Lưu cả đơn giá lẫn tổng vào lịch sử.
   */
  /** Áp một loạt giá mới (tab "Cập nhật giá": giá tự động, nhập tay, import file). Không áp được dòng nào thì giữ nguyên state. */
  const handleApplyPrices = (updates: PriceUpdate[]): ApplyResult => {
    const res = applyPriceUpdates(state, updates, todayLocalStr());
    if (res.applied.length > 0) setState(res.state);
    return res;
  };

  /** Chạy một thao tác ghi sổ (hàm thuần trong utils/ops). Lỗi → hộp thoại, thành công → cập nhật trạng thái. */
  const runOp = (op: (st: UserFinancialState) => OpResult, errorTitle: string): boolean => {
    const r = op(state);
    if (!r.ok) {
      void dialog.alert({ tone: 'error', title: errorTitle, message: r.error });
      return false;
    }
    setState(r.state);
    return true;
  };

  /**
   * Bán tài sản: nhập số lượng, giá bán, số tiền THỰC NHẬN và ngày bán.
   * Phí/thuế = giá trị ghi nhận − thực nhận; lãi/lỗ chốt = thực nhận − giá vốn phần bán.
   */
  const handleSellAsset = (params: SellParams): boolean => {
    const ok = runOp((st) => applySell(st, params, uid), 'Không ghi nhận được lần bán');
    if (ok) dialog.toast('Đã ghi nhận bán tài sản và cộng tiền vào ví.');
    return ok;
  };

  /** Hủy bản ghi nhập nhầm (thay cho xóa): dữ liệu được giữ lại, ví hoàn đúng số bằng bút toán đảo. */
  const confirmVoid = async (title: string, message: string): Promise<boolean> =>
    dialog.confirm({ tone: 'warning', title, message, confirmText: 'Hủy bản ghi' });

  const handleVoidAsset = async (assetId: string) => {
    const chk = canVoidAsset(state, assetId);
    if (!chk.ok) return void dialog.alert({ tone: 'warning', title: 'Chưa thể hủy tài sản', message: chk.reason || '' });
    const a = state.assets.find((x) => x.id === assetId)!;
    const refund = state.transactions.filter((t) => t.type === 'buy_asset' && t.linkedAssetId === assetId && t.status !== 'voided' && !t.reversalOf).reduce((sum, t) => sum + t.amount, 0);
    const ok = await confirmVoid(
      `Hủy tài sản "${a.name}"?`,
      `Tài sản được đánh dấu "đã hủy" và loại khỏi mọi số liệu.${refund > 0 ? ` Số tiền mua ${formatVND(refund)} được hoàn lại ví bằng một bút toán đảo.` : ''}\n\nDữ liệu vẫn được giữ lại để đối chiếu.`
    );
    if (ok && runOp((st) => applyVoidAsset(st, assetId, uid), 'Không hủy được tài sản')) dialog.toast(`Đã hủy tài sản "${a.name}".`);
  };

  const handleVoidDebt = async (debtId: string) => {
    const chk = canVoidDebt(state, debtId);
    if (!chk.ok) return void dialog.alert({ tone: 'warning', title: 'Chưa thể hủy khoản vay', message: chk.reason || '' });
    const d = state.debts.find((x) => x.id === debtId)!;
    const ok = await confirmVoid(
      `Hủy khoản vay "${d.name}"?`,
      'Khoản vay được đánh dấu "đã hủy" và loại khỏi dư nợ. Nếu đã ghi dòng giải ngân vào ví, số tiền đó được hoàn lại bằng bút toán đảo.\n\nDữ liệu vẫn được giữ lại để đối chiếu.'
    );
    if (ok && runOp((st) => applyVoidDebt(st, debtId, uid), 'Không hủy được khoản vay')) dialog.toast(`Đã hủy khoản vay "${d.name}".`);
  };

  const handleVoidTx = async (txId: string) => {
    const chk = canVoidTx(state, txId);
    if (!chk.ok) return void dialog.alert({ tone: 'warning', title: 'Chưa thể hủy giao dịch', message: chk.reason || '' });
    const t = state.transactions.find((x) => x.id === txId)!;
    const ok = await confirmVoid(
      'Hủy giao dịch này?',
      `${t.title}\n${formatVND(t.amount)} · ngày ${t.date}\n\nDòng này được đánh dấu "đã hủy" và một bút toán đảo cùng ngày được ghi để ví trở về đúng số cũ. Các thay đổi lên tài sản / khoản vay (nếu có) được hoàn nguyên.`
    );
    if (ok && runOp((st) => applyVoidTx(st, txId, uid), 'Không hủy được giao dịch')) dialog.toast('Đã hủy giao dịch.');
  };

  // 2. DEBT HANDLERS
  const handleAddDebt = (newDebt: Debt, disburseToWallet = false): boolean =>
    runOp((st) => applyAddDebt(st, newDebt, { disburseToWallet }, uid), 'Không thêm được khoản vay');

  /** Bổ sung nơi dùng vốn cho khoản nợ cũ: chỉ gắn nhãn, không đổi ví. */
  const handleSetFundUse = (debtId: string, fundUse: FundUse): boolean =>
    runOp((st) => applySetFundUse(st, debtId, fundUse), 'Không lưu được nơi dùng vốn');

  const handleUpdateDebt = (updatedDebt: Debt) => {
    setState((prev) => ({
      ...prev,
      debts: prev.debts.map((d) => (d.id === updatedDebt.id ? updatedDebt : d)),
    }));
  };

  /**
   * Ghi nhận trả 1 kỳ: đúng thứ tự, mỗi tháng một kỳ, đủ tiền ví, có xác nhận và NGÀY THANH TOÁN do người dùng chọn.
   * Mọi kiểm tra nằm trong utils/ops (applyPayPeriod); đây chỉ là lớp hộp thoại.
   */
  const handlePayDebtPeriod = async (debtId: string, periodIndex: number, deductFromWallet: boolean): Promise<boolean> => {
    const targetDebt = state.debts.find((d) => d.id === debtId);
    if (!targetDebt || !targetDebt.schedule || !targetDebt.schedule[periodIndex]) return false;
    const item = targetDebt.schedule[periodIndex];
    if (item.isPaid) return false;

    const firstUnpaid = targetDebt.schedule.findIndex((i) => !i.isPaid);
    if (firstUnpaid !== periodIndex) {
      void dialog.alert({
        tone: 'warning',
        title: 'Chưa đến lượt kỳ này',
        message: `Hãy thanh toán kỳ #${targetDebt.schedule[firstUnpaid].period} trước. Các kỳ phải được ghi nhận theo thứ tự.`,
      });
      return false;
    }
    // Mỗi tháng chỉ trả một kỳ: kỳ đến hạn ở tháng sau chưa được trả
    const lock = checkPayable(targetDebt, periodIndex);
    if (lock.reason === 'month_locked') {
      void dialog.alert({
        tone: 'warning',
        title: payLockLabel(lock),
        message: `Kỳ #${item.period} của "${targetDebt.name}" đến hạn ngày ${lock.dueDate}, sẽ mở thanh toán từ ngày ${lock.unlockDate}.\n\nMỗi tháng chỉ trả một kỳ; kỳ quá hạn vẫn được trả bù.`,
      });
      return false;
    }
    if (deductFromWallet && insufficient(item.totalMonthlyPayment, `trả kỳ #${item.period} "${targetDebt.name}"`)) {
      return false;
    }
    const today = todayLocalStr();
    const chosen = { date: today };
    const ok = await dialog.confirm({
      title: `Xác nhận đã trả kỳ #${item.period}?`,
      message: (
        <div className="space-y-2.5">
          <div className="font-semibold text-slate-800">{targetDebt.name}</div>
          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-slate-50 font-mono">
            <div className="flex justify-between px-3 py-1.5">
              <span className="font-sans text-slate-500">Gốc</span>
              <span>{formatVND(item.principalPayable)}</span>
            </div>
            <div className="flex justify-between px-3 py-1.5">
              <span className="font-sans text-slate-500">Lãi</span>
              <span>{formatVND(item.interestPayable)}</span>
            </div>
            <div className="flex justify-between px-3 py-1.5 font-bold text-slate-900">
              <span className="font-sans">Tổng</span>
              <span>{formatVND(item.totalMonthlyPayment)}</span>
            </div>
          </div>
          <PayDateField
            label="Ngày thanh toán"
            initial={today}
            min={targetDebt.startDate}
            max={today}
            onChange={(v) => {
              chosen.date = v;
            }}
          />
          <div>{deductFromWallet ? 'Số tiền sẽ được trừ khỏi ví đầu tư.' : 'Không trừ ví.'}</div>
        </div>
      ),
      confirmText: 'Xác nhận đã trả',
    });
    if (!ok) return false;

    const done = runOp(
      (st) => applyPayPeriod(st, { debtId, periodIndex, deductFromWallet, date: chosen.date }, uid),
      'Không ghi nhận được kỳ trả'
    );
    if (done) dialog.toast(`Đã ghi nhận trả kỳ #${item.period} – ${targetDebt.name}.`);
    return done;
  };

  // ---- Khoản vay: mốc lãi suất, tất toán sớm, trả trước gốc, đối chiếu sao kê (utils/debtOps) ----
  const handleAddRateChange = (input: RateChangeInput): boolean => {
    const ok = runOp((st) => applyAddRateChange(st, input, uid), 'Không lưu được mốc lãi suất');
    if (ok) dialog.toast('Đã lưu mốc lãi suất và tính lại các kỳ chưa trả.');
    return ok;
  };
  const handleRemoveRateChange = (debtId: string, changeId: string): boolean => {
    const ok = runOp((st) => applyRemoveRateChange(st, debtId, changeId), 'Không bỏ được mốc lãi suất');
    if (ok) dialog.toast('Đã bỏ mốc lãi suất và tính lại các kỳ chưa trả.');
    return ok;
  };
  const handleSettleDebt = (input: SettleInput): boolean => {
    const ok = runOp((st) => applySettle(st, input, uid), 'Không tất toán được khoản vay');
    if (ok) dialog.toast('Đã tất toán khoản vay.');
    return ok;
  };
  const handlePrepayDebt = (input: PrepayInput): boolean => {
    const ok = runOp((st) => applyPrepay(st, input, uid), 'Không ghi nhận được khoản trả trước');
    if (ok) dialog.toast('Đã ghi nhận trả trước gốc và tính lại lịch trả.');
    return ok;
  };
  const handleReconcileDebt = (input: ReconcileInput): boolean => {
    const ok = runOp((st) => applyReconcile(st, input, uid), 'Không ghi nhận được điều chỉnh');
    if (ok) dialog.toast('Đã đối chiếu dư nợ theo sao kê và tính lại lịch trả.');
    return ok;
  };
  const handleUndoReconcile = (debtId: string): boolean => {
    const ok = runOp((st) => applyUndoReconcile(st, debtId), 'Không hoàn tác được điều chỉnh');
    if (ok) dialog.toast('Đã hoàn tác điều chỉnh gần nhất.');
    return ok;
  };

  // ---- Tiết kiệm: nhận lãi, tái tục (utils/savingsOps) ----
  const handleReceiveInterest = (p: { assetId: string; amount: number; date: string; note?: string }): boolean => {
    const ok = runOp((st) => applyReceiveSavingsInterest(st, p, uid), 'Không ghi nhận được lãi tiết kiệm');
    if (ok) dialog.toast(`Đã nhận lãi ${formatVND(p.amount)} vào ví.`);
    return ok;
  };
  const handleRollover = (p: RolloverInput): boolean => {
    const ok = runOp((st) => applyRollover(st, p, uid), 'Không tái tục được sổ tiết kiệm');
    if (ok) dialog.toast('Đã tái tục sổ tiết kiệm.');
    return ok;
  };

  // 3. WALLET HANDLERS (có ngày giao dịch chọn được)
  const handleDeposit = (amount: number, note?: string, date: string = todayLocalStr()): boolean => {
    const ok = runOp((st) => applyDeposit(st, amount, date, note, uid), 'Không nạp được tiền');
    if (ok) dialog.toast(`Đã nạp ${formatVND(amount)} vào ví.`);
    return ok;
  };

  const handleWithdraw = (amount: number, note?: string, date: string = todayLocalStr()): boolean => {
    if (insufficient(amount, 'rút')) return false;
    const ok = runOp((st) => applyWithdraw(st, amount, date, note, uid), 'Không rút được tiền');
    if (ok) dialog.toast(`Đã rút ${formatVND(amount)} khỏi ví.`);
    return ok;
  };

  /** Ghi nhận thu nhập: cổ tức, tiền thuê nhà, lãi tiền gửi → cộng ví + sổ cái (đếm đúng 1 lần vào lãi thực tế). */
  const handleRecordIncome = (params: IncomeParams): boolean => {
    const ok = runOp((st) => applyIncome(st, params, uid), 'Không ghi nhận được thu nhập');
    if (ok) dialog.toast(`Đã ghi nhận thu nhập ${formatVND(params.amount)} vào ví.`);
    return ok;
  };

  const handleClearDemo = () => {
    setState(emptyState());
  };

  const priceAlertCount = listPriceRows(state, todayLocalStr()).filter(
    (r) => r.mode !== 'readonly' && r.staleDays !== null && r.staleDays > STALE_DAYS
  ).length;

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans antialiased text-slate-900">
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        upcomingPaymentCount={summary.upcomingPayments.length}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        user={{ displayName: user.displayName, subtitle: user.email, role: user.role }}
        isDark={isDark}
        onToggleTheme={onToggleTheme}
        adminPendingCount={isAdmin && adminAccounts ? countPendingWork(adminAccounts) : 0}
        priceAlertCount={priceAlertCount}
        onOpenAccount={() => setAccountOpen(true)}
        onLogout={onLogout}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          currentTab={currentTab}
          availableCash={state.wallet.availableCash}
          onOpenAddAsset={() => openAction('assets', 'add_asset')}
          onOpenAddDebt={() => openAction('debts', 'add_debt')}
          onOpenDeposit={() => openAction('wallet', 'deposit')}
          syncStatus={syncStatus}
        />

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
          {state.isDemo && (
            <div role="status" className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
              <Info className="w-5 h-5 shrink-0" />
              <div className="flex-1">
                <strong>Bạn đang xem DỮ LIỆU MẪU.</strong> Số liệu bên dưới là giả định để minh họa, không phải của bạn.
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleClearDemo}
                  className="px-3 py-1.5 text-xs font-bold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
                >
                  Xóa dữ liệu mẫu & bắt đầu trống
                </button>
                <button
                  onClick={() => setState((p) => ({ ...p, isDemo: false }))}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Giữ lại
                </button>
              </div>
            </div>
          )}

          {currentTab === 'dashboard' && (
            <DashboardView
              state={state}
              onNavigateTab={setCurrentTab}
              onOpenPayDebtModal={(debt) => {
                const next = getNextDuePayment(debt);
                if (next) handlePayDebtPeriod(debt.id, next.periodIndex, true);
              }}
              onOpenAddAsset={() => openAction('assets', 'add_asset')}
              onOpenAddDebt={() => openAction('debts', 'add_debt')}
              userName={user.displayName}
            />
          )}

          {currentTab === 'assets' && (
            <AssetsView
              state={state}
              autoOpenAdd={pendingAction === 'add_asset'}
              onAutoOpenConsumed={() => setPendingAction(null)}
              onAddAsset={handleAddAsset}
              onUpdateAsset={handleUpdateAsset}
              onVoidAsset={handleVoidAsset}
              onSellAsset={handleSellAsset}
              onReceiveInterest={handleReceiveInterest}
              onRolloverSavings={handleRollover}
            />
          )}

          {currentTab === 'prices' && <PricesView state={state} onApplyPrices={handleApplyPrices} />}

          {currentTab === 'debts' && (
            <DebtsView
              state={state}
              autoOpenAdd={pendingAction === 'add_debt'}
              onAutoOpenConsumed={() => setPendingAction(null)}
              onAddDebt={handleAddDebt}
              onUpdateDebt={handleUpdateDebt}
              onVoidDebt={handleVoidDebt}
              onSetFundUse={handleSetFundUse}
              onPayDebtPeriod={handlePayDebtPeriod}
              onAddRateChange={handleAddRateChange}
              onRemoveRateChange={handleRemoveRateChange}
              onSettleDebt={handleSettleDebt}
              onPrepayDebt={handlePrepayDebt}
              onReconcileDebt={handleReconcileDebt}
              onUndoReconcile={handleUndoReconcile}
            />
          )}

          {currentTab === 'wallet' && (
            <WalletView
              state={state}
              autoOpenDeposit={pendingAction === 'deposit'}
              onAutoOpenConsumed={() => setPendingAction(null)}
              onDeposit={handleDeposit}
              onWithdraw={handleWithdraw}
              onRecordIncome={handleRecordIncome}
              onVoidTx={handleVoidTx}
            />
          )}

          {currentTab === 'calendar' && (
            <CalendarView
              state={state}
              onNavigateTab={setCurrentTab}
              onPayDebtPeriod={handlePayDebtPeriod}
            />
          )}

          {currentTab === 'balance' && <ReportsView state={state} />}

          {currentTab === 'admin' && user.role === 'admin' && (
            <AdminView
              currentUser={user}
              accounts={adminAccounts}
              onChanged={refreshAccounts}
              onBack={() => setCurrentTab('dashboard')}
            />
          )}
        </main>
      </div>

      {accountOpen && (
        <AccountModal user={user} onClose={() => setAccountOpen(false)} onUserChanged={onUserChanged} onDownloadBackup={() => exportStateToJson(state)} />
      )}
    </div>
  );
}

function FullScreenMessage({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 font-sans text-slate-900 antialiased">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-lg">
        <h1 className="text-base font-bold text-slate-900">{title}</h1>
        {detail && <p className="mt-2 text-xs leading-relaxed text-slate-500">{detail}</p>}
        {children && <div className="mt-5 flex items-center justify-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

type GateState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; state: UserFinancialState; version: number; savedJson: string | null };

type GateProps = Pick<FinanceAppProps, 'user' | 'isDark' | 'onToggleTheme' | 'onLogout' | 'onUnauthorized' | 'onUserChanged'>;

/** Tải dữ liệu của người dùng từ máy chủ trước khi vào ứng dụng. */
function PortfolioGate(props: GateProps) {
  const dialog = useDialog();
  const { onUnauthorized, onLogout } = props;
  const [gate, setGate] = useState<GateState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setGate({ kind: 'loading' });
    try {
      const res = await api.getPortfolio();
      if (res.data) {
        const st = normalizeState(res.data);
        // Không tự thay bằng dữ liệu mẫu: lần lưu tiếp theo sẽ ghi đè mất dữ liệu thật trên máy chủ
        if (!st) {
          setGate({ kind: 'error', message: 'Dữ liệu trên máy chủ có cấu trúc không đọc được. Hãy liên hệ quản trị viên, chưa có gì bị ghi đè.' });
          return;
        }
        setGate({ kind: 'ready', state: st, version: res.version, savedJson: JSON.stringify(st) });
        return;
      }
      // Chưa có dữ liệu trên máy chủ: đề nghị nhập dữ liệu thật đã lưu trước đây trong trình duyệt này
      const legacy = findLocalLegacyData();
      if (legacy) {
        const ok = await dialog.confirm({
          title: 'Tìm thấy dữ liệu đã nhập trước đây',
          message: `Trình duyệt này đang lưu dữ liệu của bạn: ${legacy.assets.length} tài sản, ${legacy.debts.length} khoản nợ, ${legacy.transactions.length} giao dịch.\n\nNhập vào tài khoản này (lưu trên máy chủ)? Bản trong trình duyệt vẫn được giữ nguyên.`,
          confirmText: 'Nhập dữ liệu',
          cancelText: 'Bỏ qua',
        });
        if (ok) {
          setGate({ kind: 'ready', state: legacy, version: 0, savedJson: null });
          return;
        }
      }
      setGate({ kind: 'ready', state: createDemoState(), version: 0, savedJson: null });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized();
        return;
      }
      setGate({ kind: 'error', message: e instanceof ApiError ? e.message : 'Không tải được dữ liệu.' });
    }
  }, [dialog, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  if (gate.kind === 'loading') return <FullScreenMessage title="Đang tải dữ liệu của bạn…" />;
  if (gate.kind === 'error')
    return (
      <FullScreenMessage title="Không tải được dữ liệu" detail={gate.message}>
        <button onClick={() => void load()} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
          Thử lại
        </button>
        <button onClick={onLogout} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Đăng xuất
        </button>
      </FullScreenMessage>
    );
  return <FinanceApp {...props} initialState={gate.state} initialVersion={gate.version} initialSavedJson={gate.savedJson} />;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'error'; message: string }
  | { status: 'user'; user: PublicUser };

/** Cổng đăng nhập: hỏi máy chủ "tôi là ai" → chưa đăng nhập thì hiện màn hình xác thực; đã đăng nhập thì tải dữ liệu rồi vào ứng dụng. */
export default function App() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  const loadMe = useCallback(async () => {
    setAuth({ status: 'loading' });
    try {
      const res = await api.me();
      setAuth({ status: 'user', user: res.user });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuth({ status: 'anon' });
      else setAuth({ status: 'error', message: e instanceof ApiError ? e.message : 'Không kết nối được máy chủ.' });
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next, true);
  };

  const handleUnauthorized = useCallback(() => setAuth({ status: 'anon' }), []);
  const handleUserChanged = useCallback(
    (user: PublicUser) => setAuth((a) => (a.status === 'user' ? { status: 'user', user } : a)),
    []
  );
  const handleLogout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* dù lỗi mạng vẫn đưa về màn hình đăng nhập */
    }
    setAuth({ status: 'anon' });
  }, []);

  if (auth.status === 'loading') return <FullScreenMessage title="Đang tải…" />;
  if (auth.status === 'error')
    return (
      <FullScreenMessage title="Không kết nối được máy chủ" detail={auth.message}>
        <button onClick={() => void loadMe()} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
          Thử lại
        </button>
      </FullScreenMessage>
    );
  if (auth.status === 'anon')
    return (
      <AuthScreen
        isDark={theme === 'dark'}
        onToggleTheme={toggleTheme}
        onAuthenticated={(user) => setAuth({ status: 'user', user })}
      />
    );

  return (
    <PortfolioGate
      key={auth.user.id}
      user={auth.user}
      isDark={theme === 'dark'}
      onToggleTheme={toggleTheme}
      onLogout={handleLogout}
      onUnauthorized={handleUnauthorized}
      onUserChanged={handleUserChanged}
    />
  );
}
