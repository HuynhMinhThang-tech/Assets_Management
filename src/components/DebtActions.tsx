import React, { useState } from 'react';
import { CheckCircle2, Undo2 } from 'lucide-react';
import { CashTransaction, Debt, EditLogEntry } from '../types/finance';
import type { DebtEditInput } from '../utils/editOps';
import { EditDebtModal } from './EditInfoModals';
import { checkPayable, formatVND, isLiveTx, isOpenItem, payLockLabel, todayLocalStr } from '../utils/calculations';
import { currentRate, ensureTimeline, PrepayMode, previewPrepay, previewSettlement } from '../utils/debtCore';
import {
  PrepayInput, RateChangeInput, ReconcileInput, SettleInput, canRemoveRateChange, canUndoReconcile, previewRateChange,
} from '../utils/debtOps';
import { CurrencyInput } from './CurrencyInput';
import { FieldError, Modal, ModalBody, ModalFooter } from './ui/Modal';
import { PwaDebtDetail } from './pwa/PwaDebtDetail';

type Result = boolean | void;

export interface DebtActionHandlers {
  onPayPeriod: (periodIndex: number, deductFromWallet: boolean) => void;
  onAddRateChange: (input: RateChangeInput) => Result;
  onRemoveRateChange: (debtId: string, changeId: string) => Result;
  onSettle: (input: SettleInput) => Result;
  onPrepay: (input: PrepayInput) => Result;
  onReconcile: (input: ReconcileInput) => Result;
  onUndoReconcile: (debtId: string) => Result;
  /** Sửa tên, ngân hàng, ghi chú, ngày trả (có kiểm tra + lịch sử chỉnh sửa). */
  onEditDebt?: (debtId: string, patch: DebtEditInput) => Result;
}

const inputCls = 'w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent';
const dateCls = 'w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg';
const btnPrimary = 'px-5 py-2 text-xs font-medium text-on-accent bg-accent hover:bg-accent-hover rounded-lg disabled:cursor-not-allowed disabled:opacity-50';
const btnGhost = 'px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium';
const Row: React.FC<{ label: string; value: React.ReactNode; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-center justify-between px-3 py-2">
    <span className="text-slate-500">{label}</span>
    <span className={`font-mono ${strong ? 'font-semibold text-slate-900' : 'font-semibold text-slate-800'}`}>{value}</span>
  </div>
);
const Box: React.FC<{ children: React.ReactNode; testId?: string }> = ({ children, testId }) => (
  <div data-preview={testId} className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50 text-xs">{children}</div>
);
const rateText = (r: { annualRate: number; baseRate?: number; margin?: number }) =>
  r.baseRate !== undefined && r.margin !== undefined ? `${r.annualRate}% (cơ sở ${r.baseRate}% + biên độ ${r.margin}%)` : `${r.annualRate}%`;

// ------------------------------------------------------------------ Đổi lãi suất
const vnDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatVND(Math.abs(n))}`;

const RateChangeModal: React.FC<{ debt: Debt; onClose: () => void; onSave: (i: RateChangeInput) => Result }> = ({ debt, onClose, onSave }) => {
  const today = todayLocalStr();
  const [date, setDate] = useState(today);
  const [rate, setRate] = useState('');
  const [note, setNote] = useState('');
  const rateNum = parseFloat(rate.replace(',', '.'));
  const hasRate = Number.isFinite(rateNum);
  const preview = hasRate && date ? previewRateChange(debt, { effectiveDate: date, annualRate: rateNum }, today) : null;
  const error = !date ? 'Chọn ngày hiệu lực.' : !hasRate ? 'Nhập lãi suất mới.' : preview && !preview.ok ? preview.error : '';
  return (
    <Modal title="Đổi lãi suất" subtitle={`${debt.name} · đang áp dụng ${currentRate(debt)}%/năm`} onClose={onClose}>
      <ModalBody>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Lãi suất mới (%/năm)</label>
            <input type="text" inputMode="decimal" data-testid="rate-value" placeholder="Ví dụ 10" value={rate} onChange={(e) => setRate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Ngày hiệu lực</label>
            <input type="date" data-testid="rate-date" value={date} onChange={(e) => setDate(e.target.value)} className={dateCls} />
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Ngày hiệu lực mặc định là hôm nay, có thể ở quá khứ. Các kỳ đã trả giữ nguyên; các kỳ chưa trả tự tính lại. Nếu ngày này rơi giữa kỳ, lãi của kỳ đó tính theo số ngày
          thực tế của từng mức lãi (chia 365). Nếu ngân hàng áp lãi mới từ đầu kỳ kế tiếp, nhập đúng ngày đến hạn của kỳ trước để khớp sao kê.
        </p>
        {preview && preview.ok && (
          <Box testId="rate-preview">
            <Row label="Lãi suất" value={`${preview.currentRate}% → ${preview.newRate}%`} />
            {preview.next && (
              <Row label={`Tiền kỳ tới (#${preview.next.period}, ${vnDate(preview.next.dueDate)})`} value={`${formatVND(preview.next.before)} → ${formatVND(preview.next.after)}`} />
            )}
            <Row
              label="Kỳ đầu tiên bị ảnh hưởng"
              value={preview.firstAffected ? `#${preview.firstAffected.period} (${vnDate(preview.firstAffected.dueDate)}) · ${preview.affectedPeriods} kỳ` : 'Không có'}
            />
            <Row label="Tổng lãi còn phải trả" value={`${formatVND(preview.remainingInterest.before)} → ${formatVND(preview.remainingInterest.after)}`} />
            <Row label="Thay đổi tổng lãi" value={signed(preview.remainingInterest.delta)} strong />
          </Box>
        )}
        {preview && preview.ok && preview.inPast && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
            Ngày hiệu lực ở quá khứ: kỳ đã trả giữ nguyên số liệu đã ghi, chỉ các kỳ chưa trả được tính lại.
          </div>
        )}
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Ghi chú</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
        </div>
        <FieldError>{error}</FieldError>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose} className={btnGhost}>Hủy</button>
        <button
          type="button"
          disabled={!!error}
          onClick={() => {
            const ok = onSave({ debtId: debt.id, effectiveDate: date, annualRate: rateNum, note });
            if (ok !== false) onClose();
          }}
          className={btnPrimary}
        >
          Lưu mốc lãi suất
        </button>
      </ModalFooter>
    </Modal>
  );
};

// ------------------------------------------------------------------ Tất toán sớm
const SettleModal: React.FC<{ debt: Debt; cash: number; onClose: () => void; onSave: (i: SettleInput) => Result }> = ({ debt, cash, onClose, onSave }) => {
  const today = todayLocalStr();
  const [date, setDate] = useState(today);
  const [fee, setFee] = useState(0);
  const [paid, setPaid] = useState(0);
  const [touched, setTouched] = useState(false);
  const [deduct, setDeduct] = useState(true);
  const pv = previewSettlement(debt, date, today);
  const suggested = pv.ok ? pv.total + fee : 0;
  const actual = touched ? paid : suggested;
  const interest = pv.ok ? actual - pv.balance - fee : 0;
  const error = !pv.ok
    ? pv.error
    : !(actual > 0)
    ? 'Nhập số tiền thực trả.'
    : interest < 0
    ? 'Số tiền thực trả nhỏ hơn dư nợ gốc cộng phí.'
    : deduct && actual > cash
    ? `Ví chỉ còn ${formatVND(cash)}, không đủ để trả ${formatVND(actual)}.`
    : '';
  return (
    <Modal title="Tất toán sớm" subtitle={debt.name} onClose={onClose}>
      <ModalBody>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Ngày tất toán</label>
          <input type="date" data-testid="settle-date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={dateCls} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Phí trả trước hạn (VND, theo thông báo của ngân hàng)</label>
          <CurrencyInput value={fee} onChange={setFee} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Số tiền thực trả (VND)</label>
          <CurrencyInput value={actual} onChange={(v) => { setPaid(v); setTouched(true); }} invalid={!!pv.ok && interest < 0} className={inputCls} />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" data-testid="settle-deduct" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} />
          Trừ tiền khỏi ví đầu tư
        </label>
        {pv.ok && (
          <Box testId="settle">
            <Row label="Dư nợ gốc" value={formatVND(pv.balance)} />
            <Row label={`Lãi dồn ${pv.days} ngày (tạm tính ngày/365)`} value={formatVND(pv.interest)} />
            <Row label="Phí trả trước hạn" value={formatVND(fee)} />
            <Row label="Lãi thực tế (thực trả − gốc − phí)" value={formatVND(Math.max(0, interest))} />
            <Row label="Thực trả" value={formatVND(actual)} strong />
          </Box>
        )}
        <FieldError>{error}</FieldError>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose} className={btnGhost}>Hủy</button>
        <button
          type="button"
          disabled={!!error}
          onClick={() => {
            const ok = onSave({ debtId: debt.id, date, fee, actualPaid: actual, deductFromWallet: deduct });
            if (ok !== false) onClose();
          }}
          className={btnPrimary}
        >
          Xác nhận tất toán
        </button>
      </ModalFooter>
    </Modal>
  );
};

// ------------------------------------------------------------------ Trả trước một phần gốc
const PrepayModal: React.FC<{ debt: Debt; cash: number; onClose: () => void; onSave: (i: PrepayInput) => Result }> = ({ debt, cash, onClose, onSave }) => {
  const today = todayLocalStr();
  const [date, setDate] = useState(today);
  const [principal, setPrincipal] = useState(0);
  const [fee, setFee] = useState(0);
  const [paid, setPaid] = useState(0);
  const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<PrepayMode>('reduce_payment');
  const [deduct, setDeduct] = useState(true);
  const pv = previewPrepay(debt, date, principal, mode, today);
  const suggested = pv.ok ? principal + pv.interest + fee : principal + fee;
  const actual = touched ? paid : suggested;
  const interest = actual - principal - fee;
  const error = !pv.ok
    ? pv.error
    : interest < 0
    ? 'Số tiền thực trả nhỏ hơn gốc trả trước cộng phí.'
    : deduct && actual > cash
    ? `Ví chỉ còn ${formatVND(cash)}, không đủ để trả ${formatVND(actual)}.`
    : '';
  const next = pv.ok ? pv.debt.schedule!.find(isOpenItem) : undefined;
  const left = pv.ok ? pv.debt.schedule!.filter(isOpenItem).length : 0;
  return (
    <Modal title="Trả trước một phần gốc" subtitle={`${debt.name} · dư nợ ${formatVND(debt.remainingPrincipal)}`} onClose={onClose}>
      <ModalBody>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Ngày trả trước</label>
          <input type="date" data-testid="prepay-date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={dateCls} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Số gốc trả trước (VND)</label>
          <CurrencyInput value={principal} onChange={setPrincipal} invalid={principal <= 0} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Phí trả trước hạn (VND)</label>
          <CurrencyInput value={fee} onChange={setFee} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Tổng thực trả (gốc + lãi dồn + phí, VND)</label>
          <CurrencyInput value={actual} onChange={(v) => { setPaid(v); setTouched(true); }} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Sau khi trả trước</label>
          <select data-testid="prepay-mode" value={mode} onChange={(e) => setMode(e.target.value as PrepayMode)} className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white">
            <option value="reduce_payment">Giữ kỳ hạn, giảm tiền trả hàng tháng</option>
            <option value="shorten_term">Giữ tiền trả hàng tháng, rút ngắn kỳ hạn</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" data-testid="prepay-deduct" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} />
          Trừ tiền khỏi ví đầu tư
        </label>
        {pv.ok && (
          <Box testId="prepay">
            <Row label={`Lãi dồn ${pv.days} ngày (tạm tính ngày/365)`} value={formatVND(pv.interest)} />
            <Row label="Dư nợ gốc mới" value={formatVND(pv.newBalance)} />
            <Row label="Số kỳ còn lại" value={`${left} kỳ`} />
            {next && <Row label={`Kỳ #${next.period} (${next.dueDate})`} value={formatVND(next.totalMonthlyPayment)} />}
            <Row label="Thực trả" value={formatVND(actual)} strong />
          </Box>
        )}
        <FieldError>{error}</FieldError>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose} className={btnGhost}>Hủy</button>
        <button
          type="button"
          disabled={!!error}
          onClick={() => {
            const ok = onSave({ debtId: debt.id, date, principal, fee, actualPaid: actual, mode, deductFromWallet: deduct });
            if (ok !== false) onClose();
          }}
          className={btnPrimary}
        >
          Xác nhận trả trước
        </button>
      </ModalFooter>
    </Modal>
  );
};

// ------------------------------------------------------------------ Đối chiếu dư nợ với sao kê
const ReconcileModal: React.FC<{ debt: Debt; onClose: () => void; onSave: (i: ReconcileInput) => Result; onUndo: () => Result }> = ({ debt, onClose, onSave, onUndo }) => {
  const today = todayLocalStr();
  const [actual, setActual] = useState(debt.remainingPrincipal);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const diff = actual - debt.remainingPrincipal;
  const error = !(actual > 0) ? 'Nhập dư nợ gốc theo sao kê.' : Math.abs(diff) < 1 ? 'Dư nợ theo sao kê đã khớp với dư nợ trong app.' : !date || date > today ? 'Chọn ngày sao kê (không ở tương lai).' : '';
  const undo = canUndoReconcile(debt);
  const lastAdj = (debt.adjustments || [])[(debt.adjustments || []).length - 1];
  return (
    <Modal title="Đối chiếu dư nợ với sao kê" subtitle={debt.name} onClose={onClose}>
      <ModalBody>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Dư nợ gốc thực tế theo sao kê ngân hàng (VND)</label>
          <CurrencyInput value={actual} onChange={setActual} invalid={!(actual > 0)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Ngày sao kê</label>
          <input type="date" data-testid="reconcile-date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={dateCls} />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Ghi chú</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
        </div>
        <Box testId="reconcile">
          <Row label="Dư nợ trong app" value={formatVND(debt.remainingPrincipal)} />
          <Row label="Dư nợ theo sao kê" value={formatVND(actual)} />
          <Row label="Chênh lệch" value={`${diff >= 0 ? '+' : '-'}${formatVND(Math.abs(diff))}`} strong />
        </Box>
        <FieldError>{error}</FieldError>
        {lastAdj && (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-xs">
            <span className="text-slate-600">
              Điều chỉnh gần nhất ({lastAdj.date}): {formatVND(lastAdj.before)} → {formatVND(lastAdj.after)}
            </span>
            <button
              type="button"
              data-testid="reconcile-undo"
              disabled={!undo.ok}
              title={undo.ok ? undefined : undo.reason}
              onClick={() => { if (onUndo() !== false) onClose(); }}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Undo2 className="h-3 w-3" /> Hoàn tác
            </button>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose} className={btnGhost}>Hủy</button>
        <button
          type="button"
          disabled={!!error}
          onClick={() => {
            const ok = onSave({ debtId: debt.id, actual, date, note });
            if (ok !== false) onClose();
          }}
          className={btnPrimary}
        >
          Ghi nhận điều chỉnh
        </button>
      </ModalFooter>
    </Modal>
  );
};

// ------------------------------------------------------------------ Chi tiết khoản vay (lịch trả, lịch sử, lãi suất)
type Tab = 'schedule' | 'history' | 'rates' | 'adjust';
type Dialog = null | 'rate' | 'settle' | 'prepay' | 'reconcile' | 'edit';

export const DebtDetailModal: React.FC<{
  debt: Debt;
  cash: number;
  transactions: CashTransaction[];
  handlers: DebtActionHandlers;
  editLog?: EditLogEntry[];
  onClose: () => void;
  /** 'pwa': danh sách + panel chi tiết thay cho các bảng rộng (xem pwa/PwaDebtDetail.tsx). */
  layout?: 'web' | 'pwa';
}> = ({ debt, cash, transactions, handlers, editLog = [], onClose, layout = 'web' }) => {
  const [tab, setTab] = useState<Tab>('schedule');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showPre, setShowPre] = useState(false);
  const schedule = debt.schedule || [];
  const firstUnpaidIdx = schedule.findIndex(isOpenItem);
  const openItems = schedule.filter(isOpenItem);
  const remainingInterest = openItems.reduce((s, i) => s + i.interestPayable, 0);
  const preCount = schedule.filter((i) => i.preTracking).length;
  const tl = ensureTimeline(debt);
  const active = debt.status === 'active';
  const payments = transactions.filter((t) => isLiveTx(t) && t.type === 'debt_payment' && t.linkedDebtId === debt.id);
  const rateNow = currentRate(debt);
  const tabs: Array<[Tab, string]> = [['schedule', 'Lịch trả nợ'], ['history', 'Lịch sử thanh toán'], ['rates', 'Lịch sử lãi suất']];
  if ((debt.adjustments || []).length > 0) tabs.push(['adjust', 'Điều chỉnh sao kê']);

  const dialogs = (
    <>
      {dialog === 'edit' && handlers.onEditDebt && (
        <EditDebtModal debt={debt} editLog={editLog} onClose={() => setDialog(null)} onSave={(patch) => handlers.onEditDebt!(debt.id, patch)} />
      )}
      {dialog === 'rate' && <RateChangeModal debt={debt} onClose={() => setDialog(null)} onSave={handlers.onAddRateChange} />}
      {dialog === 'settle' && <SettleModal debt={debt} cash={cash} onClose={() => setDialog(null)} onSave={handlers.onSettle} />}
      {dialog === 'prepay' && <PrepayModal debt={debt} cash={cash} onClose={() => setDialog(null)} onSave={handlers.onPrepay} />}
      {dialog === 'reconcile' && <ReconcileModal debt={debt} onClose={() => setDialog(null)} onSave={handlers.onReconcile} onUndo={() => handlers.onUndoReconcile(debt.id)} />}
    </>
  );

  if (layout === 'pwa') {
    return (
      <>
        <PwaDebtDetail
          debt={debt}
          cash={cash}
          payments={payments}
          handlers={handlers}
          onClose={onClose}
          onOpenDialog={setDialog}
        />
        {dialogs}
      </>
    );
  }

  return (
    <>
      <Modal
        title="Chi tiết khoản vay"
        subtitle={`${debt.name} · ${debt.lender} · ${debt.method === 'declining_balance' ? 'Dư nợ giảm dần' : 'Trả đều hàng tháng'} · Lãi suất: ${rateNow}%/năm${debt.trackingStartDate ? ` · Theo dõi từ ${debt.trackingStartDate}` : ''}`}
        size="2xl"
        onClose={onClose}
      >
        <div className="grid shrink-0 grid-cols-4 border-b border-slate-200 bg-slate-50 p-4 text-xs">
          <div>
            <span className="text-slate-400 block">{debt.trackingStartDate ? 'Dư nợ lúc bắt đầu theo dõi' : 'Gốc vay ban đầu'}</span>
            <span className="font-semibold text-slate-900 font-mono text-sm">{formatVND(debt.principalAmount)}</span>
          </div>
          <div>
            <span className="text-slate-400 block">Tiền lãi các kỳ còn lại</span>
            <span className="font-semibold text-rose-600 font-mono text-sm">{formatVND(remainingInterest)}</span>
          </div>
          <div>
            <span className="text-slate-400 block">Dư nợ gốc còn lại</span>
            <span className="font-semibold text-slate-900 font-mono text-sm">{formatVND(debt.remainingPrincipal)}</span>
          </div>
          <div>
            <span className="text-slate-400 block">Số kỳ còn lại</span>
            <span className="font-semibold text-slate-900 font-mono text-sm">{openItems.length}</span>
          </div>
        </div>

        {debt.closeReason === 'early' && (
          <div data-closed className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-800">
            Đã tất toán sớm ngày {debt.closedDate}
          </div>
        )}

        {active && (
          <div className="flex shrink-0 flex-wrap gap-2 border-b border-slate-200 px-4 py-3">
            {([['rate', 'Đổi lãi suất'], ['prepay', 'Trả trước gốc'], ['settle', 'Tất toán sớm'], ['reconcile', 'Đối chiếu sao kê'], ['edit', 'Sửa thông tin']] as Array<[Dialog, string]>).map(([k, label]) => (
              <button
                key={k as string}
                type="button"
                data-debt-action={k as string}
                onClick={() => setDialog(k)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex shrink-0 gap-1 border-b border-slate-200 px-4 pt-2 text-xs">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              data-debt-tab={k}
              onClick={() => setTab(k)}
              className={`rounded-t-lg px-3 py-2 font-semibold ${tab === k ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === 'schedule' && (
            <>
              {preCount > 0 && (
                <label className="mb-3 flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <input type="checkbox" checked={showPre} onChange={(e) => setShowPre(e.target.checked)} />
                  Hiện {preCount} kỳ đã qua trước khi bắt đầu theo dõi
                </label>
              )}
              <div className="overflow-x-auto"><table className="w-full text-left text-xs border-collapse" data-table="schedule">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                    <th className="py-2.5 px-3">Kỳ</th>
                    <th className="py-2.5 px-3">Ngày đến hạn</th>
                    <th className="py-2.5 px-3 text-right">Tiền gốc</th>
                    <th className="py-2.5 px-3 text-right">Tiền lãi</th>
                    <th className="py-2.5 px-3 text-right">Tổng thanh toán</th>
                    <th className="py-2.5 px-3 text-right">Dư nợ còn lại</th>
                    <th className="py-2.5 px-3 text-center">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {schedule.map((item, idx) => {
                    if (item.preTracking && !showPre) return null;
                    const cancelled = item.status === 'cancelled';
                    const short = item.totalMonthlyPayment - cash;
                    const lock = idx === firstUnpaidIdx && active ? checkPayable(debt, idx) : null;
                    const locked = !!lock && lock.reason === 'month_locked';
                    return (
                      <tr key={item.period} data-period={item.period} className={`hover:bg-slate-50 transition-colors ${item.isPaid || cancelled ? 'bg-slate-50/40 text-slate-400' : 'text-slate-800'} ${cancelled ? 'line-through' : ''}`}>
                        <td className="py-2.5 px-3 font-semibold">#{item.period}</td>
                        <td className="py-2.5 px-3 font-sans">{item.dueDate}</td>
                        <td className="py-2.5 px-3 text-right">{formatVND(item.principalPayable)}</td>
                        <td
                          className={`py-2.5 px-3 text-right ${cancelled ? '' : 'text-rose-600'}`}
                          title={item.segments ? item.segments.map((s) => `${s.days} ngày × ${s.annualRate}%`).join(' + ') : undefined}
                        >
                          {formatVND(item.interestPayable)}
                          {item.segments && <span className="ml-1 font-sans text-[10px] text-slate-400" data-odd-period>kỳ lẻ</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right font-semibold text-slate-900">{formatVND(item.totalMonthlyPayment)}</td>
                        <td className="py-2.5 px-3 text-right">{formatVND(item.remainingBalance)}</td>
                        <td className="py-2.5 px-3 text-center font-sans no-underline">
                          {item.isPaid ? (
                            <span className="text-[11px] text-emerald-700 font-semibold flex items-center justify-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              Đã trả
                            </span>
                          ) : cancelled ? (
                            <span className="text-[11px] text-slate-500">{debt.closeReason === 'early' ? 'Hủy do tất toán' : 'Hủy do trả trước'}</span>
                          ) : idx === firstUnpaidIdx ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <button
                                onClick={() => handlers.onPayPeriod(idx, true)}
                                disabled={locked || short > 0}
                                title={locked && lock ? `Mở thanh toán từ ${lock.unlockDate}` : undefined}
                                className="px-2.5 py-1 text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-amber-600"
                              >
                                {locked && lock ? payLockLabel(lock) : 'Thanh toán'}
                              </button>
                              {!locked && short > 0 && <span className="text-[10px] font-medium text-rose-600">Ví thiếu {formatVND(short)}</span>}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400">Chưa đến lượt</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </>
          )}

          {tab === 'history' && (
            payments.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400">Chưa có khoản trả nào được ghi nhận kể từ lúc theo dõi.</div>
            ) : (
              <div className="overflow-x-auto"><table className="w-full text-left text-xs border-collapse" data-table="history">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                    <th className="py-2.5 px-3">Kỳ</th>
                    <th className="py-2.5 px-3">Hạn</th>
                    <th className="py-2.5 px-3">Ngày trả</th>
                    <th className="py-2.5 px-3 text-right">Gốc</th>
                    <th className="py-2.5 px-3 text-right">Lãi</th>
                    <th className="py-2.5 px-3 text-right">Phí</th>
                    <th className="py-2.5 px-3 text-right">Tổng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {payments.map((t) => {
                    const item = typeof t.periodIndex === 'number' ? schedule[t.periodIndex] : undefined;
                    return (
                      <tr key={t.id} data-payment={t.id}>
                        <td className="py-2.5 px-3 font-sans font-semibold">{t.settlement ? 'Tất toán sớm' : t.prepay ? 'Trả trước gốc' : item ? `#${item.period}` : '—'}</td>
                        <td className="py-2.5 px-3 font-sans">{item?.dueDate || '—'}</td>
                        <td className="py-2.5 px-3 font-sans">{t.date}</td>
                        <td className="py-2.5 px-3 text-right">{formatVND(t.principalPortion || 0)}</td>
                        <td className="py-2.5 px-3 text-right text-rose-600">{formatVND(t.interestPortion || 0)}</td>
                        <td className="py-2.5 px-3 text-right">{formatVND(t.feePortion || 0)}</td>
                        <td className="py-2.5 px-3 text-right font-semibold text-slate-900">{formatVND(t.amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )
          )}

          {tab === 'rates' && (
            <div className="overflow-x-auto"><table className="w-full text-left text-xs border-collapse" data-table="rates">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-2.5 px-3">Hiệu lực từ</th>
                  <th className="py-2.5 px-3">Lãi suất</th>
                  <th className="py-2.5 px-3">Ghi chú</th>
                  <th className="py-2.5 px-3 text-right" aria-label="Thao tác"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tl.map((r, i) => {
                  const removable = active && canRemoveRateChange(debt, r.id).ok;
                  const isNow = r.annualRate === rateNow && tl.filter((x) => x.effectiveDate <= todayLocalStr()).slice(-1)[0]?.id === r.id;
                  return (
                    <tr key={r.id} data-rate={r.id}>
                      <td className="py-2.5 px-3 font-mono">{r.effectiveDate}</td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                        {rateText(r)}
                        {isNow && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-emerald-700">Đang áp dụng</span>}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{i === 0 ? 'Mốc đầu' : r.note || ''}</td>
                      <td className="py-2.5 px-3 text-right">
                        {removable && (
                          <button type="button" data-remove-rate={r.id} onClick={() => handlers.onRemoveRateChange(debt.id, r.id)} className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
                            Bỏ mốc
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}

          {tab === 'adjust' && (
            <div className="overflow-x-auto"><table className="w-full text-left text-xs border-collapse" data-table="adjust">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-2.5 px-3">Ngày</th>
                  <th className="py-2.5 px-3 text-right">Dư nợ trước</th>
                  <th className="py-2.5 px-3 text-right">Dư nợ sau</th>
                  <th className="py-2.5 px-3 text-right">Chênh lệch</th>
                  <th className="py-2.5 px-3">Ghi chú</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {(debt.adjustments || []).map((a) => (
                  <tr key={a.id}>
                    <td className="py-2.5 px-3 font-sans">{a.date}</td>
                    <td className="py-2.5 px-3 text-right">{formatVND(a.before)}</td>
                    <td className="py-2.5 px-3 text-right">{formatVND(a.after)}</td>
                    <td className="py-2.5 px-3 text-right">{a.after - a.before >= 0 ? '+' : '-'}{formatVND(Math.abs(a.after - a.before))}</td>
                    <td className="py-2.5 px-3 font-sans text-slate-600">{a.note || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>

        <ModalFooter>
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100">
            Đóng
          </button>
        </ModalFooter>
      </Modal>

      {dialogs}
    </>
  );
};
