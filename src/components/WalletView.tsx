import React, { useState, useEffect } from 'react';
import {
  Wallet,
  ArrowDownRight,
  ArrowUpRight,
  Plus,
  Minus,
  Clock,
  Filter,
  CheckCircle2,
  DollarSign,
  TrendingUp,
} from 'lucide-react';
import { UserFinancialState, TransactionType } from '../types/finance';
import type { IncomeParams } from '../App';
import { formatVND, todayLocalStr } from '../utils/calculations';
import { CurrencyInput } from './CurrencyInput';
import { Modal, ModalBody, ModalFooter, FieldError } from './ui/Modal';

interface WalletViewProps {
  state: UserFinancialState;
  onDeposit: (amount: number, note?: string) => void;
  onWithdraw: (amount: number, note?: string) => void;
  onRecordIncome: (income: IncomeParams) => void;
  autoOpenDeposit?: boolean;
  onAutoOpenConsumed?: () => void;
}

export const WalletView: React.FC<WalletViewProps> = ({
  state,
  onDeposit,
  onWithdraw,
  onRecordIncome,
  autoOpenDeposit,
  onAutoOpenConsumed,
}) => {
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [isIncomeOpen, setIsIncomeOpen] = useState(false);
  const [incomeType, setIncomeType] = useState<IncomeParams['type']>('dividend');
  const [incomeAssetId, setIncomeAssetId] = useState('');
  const [incomeAmount, setIncomeAmount] = useState(0);
  const [incomeDate, setIncomeDate] = useState(todayLocalStr());
  const [incomeNote, setIncomeNote] = useState('');

  useEffect(() => {
    if (autoOpenDeposit) {
      setIsDepositModalOpen(true);
      onAutoOpenConsumed?.();
    }
  }, [autoOpenDeposit]);

  const incomeAssets = state.assets.filter((a) =>
    a.status === 'active' &&
    (incomeType === 'dividend' ? a.category === 'stock' || a.category === 'fund'
      : incomeType === 'rental_income' ? a.category === 'real_estate' || a.category === 'other'
      : a.category === 'savings')
  );

  const handleConfirmIncome = (e: React.FormEvent) => {
    e.preventDefault();
    if (incomeAmount <= 0 || !incomeDate || incomeDate > todayLocalStr()) return;
    onRecordIncome({ type: incomeType, assetId: incomeAssetId || undefined, amount: incomeAmount, date: incomeDate, note: incomeNote || undefined });
    closeIncome();
  };

  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [depositNote, setDepositNote] = useState('');

  const [withdrawAmount, setWithdrawAmount] = useState<number>(0);
  const [withdrawNote, setWithdrawNote] = useState('');

  // ---- Ràng buộc tiền: không cho bấm xác nhận khi số tiền sai ----
  const today = todayLocalStr();
  const available = state.wallet.availableCash;
  const withdrawError =
    withdrawAmount > available
      ? available <= 0
        ? 'Ví không còn tiền khả dụng để rút.'
        : `Vượt số dư khả dụng. Bạn chỉ có thể rút tối đa ${formatVND(available)}.`
      : '';
  const canWithdraw = withdrawAmount > 0 && !withdrawError;
  const incomeDateError = !incomeDate ? 'Chọn ngày nhận.' : incomeDate > today ? 'Ngày nhận không được ở tương lai.' : '';
  const canSubmitIncome = incomeAmount > 0 && !incomeDateError;

  const closeDeposit = () => {
    setIsDepositModalOpen(false);
    setDepositAmount(0);
    setDepositNote('');
  };
  const closeWithdraw = () => {
    setIsWithdrawModalOpen(false);
    setWithdrawAmount(0);
    setWithdrawNote('');
  };
  const closeIncome = () => {
    setIsIncomeOpen(false);
    setIncomeAmount(0);
    setIncomeNote('');
    setIncomeAssetId('');
  };

  const POSITIVE_TYPES: string[] = ['deposit', 'sell_asset', 'dividend', 'rental_income', 'interest_income', 'loan_disbursement'];

  const handleConfirmDeposit = (e: React.FormEvent) => {
    e.preventDefault();
    if (depositAmount <= 0) return;
    onDeposit(depositAmount, depositNote || 'Nạp vốn bổ sung vào ví đầu tư');
    closeDeposit();
  };

  const handleConfirmWithdraw = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWithdraw) return;
    onWithdraw(withdrawAmount, withdrawNote || 'Rút vốn từ ví đầu tư');
    closeWithdraw();
  };

  // Calculate running balance for each transaction backwards from current wallet available cash
  const transactionsWithRunningBalance = React.useMemo(() => {
    let running = state.wallet.availableCash;
    return state.transactions.map((tx) => {
      const isPositive = POSITIVE_TYPES.includes(tx.type);
      const balanceAfter = running;
      if (isPositive) {
        running = running - tx.amount;
      } else {
        running = running + tx.amount;
      }
      return {
        ...tx,
        balanceAfter,
      };
    });
  }, [state.transactions, state.wallet.availableCash]);

  const filteredTransactions = transactionsWithRunningBalance.filter((tx) => {
    if (filterType === 'all') return true;
    if (filterType === 'inflow') {
      return POSITIVE_TYPES.includes(tx.type);
    }
    if (filterType === 'outflow') {
      return ['withdraw', 'buy_asset', 'debt_payment'].includes(tx.type);
    }
    return tx.type === filterType;
  });

  const getTxTypeBadge = (type: TransactionType) => {
    switch (type) {
      case 'deposit':
        return { label: 'Nạp vốn', isPositive: true, color: 'text-emerald-700 bg-emerald-50' };
      case 'withdraw':
        return { label: 'Rút vốn', isPositive: false, color: 'text-slate-700 bg-slate-100' };
      case 'buy_asset':
        return { label: 'Mua tài sản', isPositive: false, color: 'text-sky-700 bg-sky-50' };
      case 'sell_asset':
        return { label: 'Bán tài sản', isPositive: true, color: 'text-emerald-700 bg-emerald-50' };
      case 'dividend':
        return { label: 'Cổ tức', isPositive: true, color: 'text-purple-700 bg-purple-50' };
      case 'rental_income':
        return { label: 'Tiền thuê', isPositive: true, color: 'text-teal-700 bg-teal-50' };
      case 'debt_payment':
        return { label: 'Trả nợ vay', isPositive: false, color: 'text-amber-800 bg-amber-50' };
      case 'interest_income':
        return { label: 'Lãi tiền gửi', isPositive: true, color: 'text-teal-700 bg-teal-50' };
      case 'loan_disbursement':
        return { label: 'Giải ngân vay', isPositive: true, color: 'text-sky-700 bg-sky-50' };
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* 1. WALLET BALANCE CARD */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Available Cash (Hero) */}
        <div className="theme-fixed-dark bg-slate-900 text-white p-6 rounded-xl border border-slate-800 shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-slate-400 text-xs mb-2">
              <span className="font-semibold uppercase tracking-wider">Tiền Khả Dụng Ví Đầu Tư</span>
              <Wallet className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-3xl font-extrabold font-mono tabular-nums text-emerald-400">
              {formatVND(state.wallet.availableCash)}
            </div>
            <p className="text-xs text-slate-400 mt-2">
              Sẵn sàng để giải ngân mua tài sản mới hoặc thanh toán các kỳ nợ định kỳ.
            </p>
          </div>

          <div className="flex items-center gap-2 mt-6 pt-4 border-t border-slate-800">
            <button
              onClick={() => setIsDepositModalOpen(true)}
              className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center justify-center gap-1.5"
            >
              <ArrowDownRight className="w-3.5 h-3.5" />
              <span>Nạp tiền</span>
            </button>
            <button
              onClick={() => setIsWithdrawModalOpen(true)}
              disabled={available <= 0}
              title={available <= 0 ? 'Ví không còn tiền khả dụng' : undefined}
              className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors flex items-center justify-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-slate-800"
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Rút vốn</span>
            </button>
          </div>
        </div>

        {/* Total Deposited */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">
              Tổng Vốn Đã Nạp
            </span>
            <div className="text-2xl font-extrabold text-slate-900 font-mono tabular-nums">
              {formatVND(state.wallet.totalDeposited)}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Toàn bộ dòng tiền vốn cá nhân nạp vào hệ sinh thái đầu tư.
            </p>
          </div>
          <div className="text-xs text-slate-400 pt-3 border-t border-slate-100 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
            <span>Nguồn vốn đầu tư ban đầu</span>
          </div>
        </div>

        {/* Total Withdrawn */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">
              Tổng Vốn Đã Rút
            </span>
            <div className="text-2xl font-extrabold text-slate-700 font-mono tabular-nums">
              {formatVND(state.wallet.totalWithdrawn)}
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Lợi nhuận hoặc vốn đã rút khỏi danh mục đầu tư về tài khoản sinh hoạt.
            </p>
          </div>
          <div className="text-xs text-slate-400 pt-3 border-t border-slate-100 flex items-center gap-1">
            <span>Rút về tiêu dùng / tài khoản ngoài</span>
          </div>
        </div>
      </div>

      {/* 2. TRANSACTIONS LEDGER */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Nhật Ký Dòng Tiền Đầu Tư Thực Tế
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Theo dõi đối soát chính xác mọi khoản tiền vào/ra và số dư khả dụng sau từng biến động.
            </p>
          </div>

          <button
            onClick={() => setIsIncomeOpen(true)}
            className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm whitespace-nowrap"
          >
            Ghi nhận thu nhập (cổ tức / tiền thuê / lãi)
          </button>

          {/* Filter Pills */}
          <div className="flex items-center gap-1 text-xs bg-slate-100 p-1 rounded-lg">
            {[
              { id: 'all', label: 'Tất cả' },
              { id: 'inflow', label: 'Dòng tiền vào (+)' },
              { id: 'outflow', label: 'Dòng tiền ra (-)' },
              { id: 'debt_payment', label: 'Trả nợ' },
              { id: 'dividend', label: 'Cổ tức' },
              { id: 'rental_income', label: 'Tiền thuê' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFilterType(f.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  filterType === f.id
                    ? 'bg-white text-slate-900 font-semibold shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Ledger Table */}
        {filteredTransactions.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400">
            <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            Chưa có giao dịch dòng tiền nào thuộc bộ lọc này.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-3 px-4">Ngày giao dịch</th>
                  <th className="py-3 px-3">Phân loại</th>
                  <th className="py-3 px-4">Nội dung / Đối tác</th>
                  <th className="py-3 px-4 text-right">Biến động dòng tiền</th>
                  <th className="py-3 px-4 text-right">Số dư sau biến động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTransactions.map((tx) => {
                  const badge = getTxTypeBadge(tx.type);
                  return (
                    <tr key={tx.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                        {tx.date}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${badge.color}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">
                        {tx.title}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold whitespace-nowrap tabular-nums">
                        <span
                          className={badge.isPositive ? 'text-emerald-600' : 'text-slate-900'}
                        >
                          {badge.isPositive ? '+' : '-'}
                          {formatVND(tx.amount)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 whitespace-nowrap tabular-nums">
                        {formatVND(tx.balanceAfter)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* INCOME MODAL */}
      {isIncomeOpen && (
        <Modal
          title="Ghi nhận thu nhập từ tài sản"
          subtitle="Tiền được cộng vào ví và tính vào lãi thực tế đúng 1 lần."
          onClose={closeIncome}
        >
          <form onSubmit={handleConfirmIncome} noValidate className="flex min-h-0 flex-1 flex-col">
            <ModalBody>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Loại thu nhập</label>
                <select value={incomeType} onChange={(e) => { setIncomeType(e.target.value as IncomeParams['type']); setIncomeAssetId(''); }} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg">
                  <option value="dividend">Cổ tức (CP / CCQ)</option>
                  <option value="rental_income">Tiền thuê bất động sản</option>
                  <option value="interest_income">Lãi tiền gửi / trái phiếu</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Tài sản phát sinh</label>
                <select value={incomeAssetId} onChange={(e) => setIncomeAssetId(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg">
                  <option value="">— Không gắn với tài sản cụ thể —</option>
                  {incomeAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Số tiền thực nhận (VND) *</label>
                <CurrencyInput value={incomeAmount} onChange={setIncomeAmount} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Ngày nhận</label>
                <input
                  type="date"
                  value={incomeDate}
                  max={today}
                  aria-invalid={incomeDateError ? true : undefined}
                  onChange={(e) => setIncomeDate(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
                <FieldError>{incomeDateError}</FieldError>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Ghi chú</label>
                <input type="text" value={incomeNote} onChange={(e) => setIncomeNote(e.target.value)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg" />
              </div>
            </ModalBody>
            <ModalFooter hint={incomeAmount <= 0 ? 'Nhập số tiền thực nhận để ghi nhận.' : undefined}>
              <button type="button" onClick={closeIncome} className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium">Hủy</button>
              <button type="submit" disabled={!canSubmitIncome} className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-emerald-600">Xác nhận ghi nhận</button>
            </ModalFooter>
          </form>
        </Modal>
      )}

      {/* DEPOSIT MODAL */}
      {isDepositModalOpen && (
        <Modal
          title="Nạp Vốn Vào Ví Đầu Tư"
          subtitle="Bổ sung tiền mặt khả dụng để thực hiện các thương vụ đầu tư mới."
          onClose={closeDeposit}
        >
          <form onSubmit={handleConfirmDeposit} noValidate className="flex min-h-0 flex-1 flex-col">
            <ModalBody>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Số tiền nạp (VND) *
                </label>
                <CurrencyInput
                  value={depositAmount}
                  onChange={setDepositAmount}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
                <span className="text-[11px] text-slate-500 font-mono block mt-1">
                  {depositAmount > 0 ? formatVND(depositAmount) : ''}
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Nguồn tiền / Ghi chú
                </label>
                <input
                  type="text"
                  value={depositNote}
                  onChange={(e) => setDepositNote(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>
            </ModalBody>
            <ModalFooter hint={depositAmount <= 0 ? 'Nhập số tiền cần nạp.' : undefined}>
              <button
                type="button"
                onClick={closeDeposit}
                className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors font-medium"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={depositAmount <= 0}
                className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-emerald-600"
              >
                Xác nhận Nạp Tiền
              </button>
            </ModalFooter>
          </form>
        </Modal>
      )}

      {/* WITHDRAW MODAL */}
      {isWithdrawModalOpen && (
        <Modal
          title="Rút Vốn Khỏi Ví Đầu Tư"
          subtitle="Rút tiền mặt khả dụng về tài khoản cá nhân/chi tiêu."
          onClose={closeWithdraw}
        >
          <form onSubmit={handleConfirmWithdraw} noValidate className="flex min-h-0 flex-1 flex-col">
            <ModalBody>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Số tiền rút (VND) *
                </label>
                <CurrencyInput
                  value={withdrawAmount}
                  onChange={setWithdrawAmount}
                  invalid={!!withdrawError}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
                <div className="flex items-center justify-between gap-2 text-[11px] mt-1.5 font-mono">
                  <span className="text-slate-600">
                    Khả dụng: <strong>{formatVND(available)}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setWithdrawAmount(available)}
                    disabled={available <= 0}
                    className="px-2 py-0.5 font-sans font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Rút tối đa
                  </button>
                </div>
                <FieldError>{withdrawError}</FieldError>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Mục đích rút / Ghi chú
                </label>
                <input
                  type="text"
                  value={withdrawNote}
                  onChange={(e) => setWithdrawNote(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>
            </ModalBody>
            <ModalFooter hint={withdrawAmount <= 0 && !withdrawError ? 'Nhập số tiền cần rút.' : undefined}>
              <button
                type="button"
                onClick={closeWithdraw}
                className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors font-medium"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={!canWithdraw}
                className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-slate-900"
              >
                Xác nhận Rút Vốn
              </button>
            </ModalFooter>
          </form>
        </Modal>
      )}
    </div>
  );
};
