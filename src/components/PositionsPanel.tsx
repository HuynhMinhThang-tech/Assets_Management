import React, { useMemo, useState } from 'react';
import { Asset, UserFinancialState } from '../types/finance';
import { formatVND, todayLocalStr } from '../utils/calculations';
import { BuyMoreInput, ImprovementInput, Position, PositionSellInput, buildPositions, previewSellPosition } from '../utils/positions';
import { CurrencyInput } from './CurrencyInput';
import { FieldError, Modal, ModalBody, ModalFooter } from './ui/Modal';

type Result = boolean | void;

export interface PositionHandlers {
  onBuyMore: (p: BuyMoreInput) => Result;
  onSellPosition: (p: PositionSellInput) => Result;
  onPositionDividend: (p: { key: string; amount: number; date: string; note?: string }) => Result;
}

const inputCls = 'w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-accent';
const btnPrimary = 'px-5 py-2 text-xs font-medium text-on-accent bg-accent hover:bg-accent-hover rounded-lg disabled:cursor-not-allowed disabled:opacity-50';
const btnGhost = 'px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium';
const vnDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);
const fmtQty = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 4 });
const pct = (n: number | null) => (n === null ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`);

const Row: React.FC<{ label: string; value: React.ReactNode; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-baseline justify-between gap-3 text-xs">
    <span className="text-slate-500">{label}</span>
    <span className={`font-mono ${strong ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>{value}</span>
  </div>
);

// ------------------------------------------------------------------ Mua thêm
const BuyMoreModal: React.FC<{ pos: Position; cash: number; onClose: () => void; onSave: (p: BuyMoreInput) => Result }> = ({ pos, cash, onClose, onSave }) => {
  const today = todayLocalStr();
  const [date, setDate] = useState(today);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [fee, setFee] = useState<number>(0);
  const [deduct, setDeduct] = useState(true);
  const q = parseFloat(qty.replace(',', '.'));
  const total = Number.isFinite(q) && price > 0 ? Math.round(q * price) + fee : 0;
  const integer = pos.category === 'stock';
  const error =
    !Number.isFinite(q) || q <= 0 ? `Nhập số ${pos.unitLabel} mua thêm.` :
    integer && !Number.isInteger(q) ? 'Số cổ phiếu phải là số nguyên.' :
    !(price > 0) ? `Nhập giá mua mỗi ${pos.unitLabel}.` :
    !date || date > today ? 'Chọn ngày mua (không ở tương lai).' :
    deduct && total > cash ? `Ví chỉ còn ${formatVND(cash)}, không đủ ${formatVND(total)}.` : '';
  const newQty = pos.totalQuantity + (Number.isFinite(q) ? q : 0);
  const newAvg = newQty > 0 && total > 0 ? (pos.totalCost + total) / newQty : null;
  return (
    <Modal title="Mua thêm" subtitle={`${pos.symbol} · đang giữ ${fmtQty(pos.totalQuantity)} ${pos.unitLabel}`} onClose={onClose}>
      <ModalBody>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Ngày mua</label>
            <input type="date" data-testid="buymore-date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Số lượng ({pos.unitLabel})</label>
            <input type="text" inputMode="decimal" data-testid="buymore-qty" value={qty} onChange={(e) => setQty(e.target.value)} className={`${inputCls} font-mono`} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Giá mua mỗi {pos.unitLabel} (VND)</label>
            <CurrencyInput value={price} onChange={setPrice} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Phí mua (VND, tùy chọn)</label>
            <CurrencyInput value={fee} onChange={setFee} className={inputCls} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
          <input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} />
          Trừ tiền từ ví đầu tư (bỏ chọn nếu lần mua này đã có từ trước khi dùng app)
        </label>
        {total > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1" data-testid="buymore-preview">
            <Row label="Tổng chi (gồm phí)" value={formatVND(total)} />
            <Row label="Giá vốn bình quân sau khi mua" value={newAvg ? `${formatVND(newAvg)} / ${pos.unitLabel}` : '—'} strong />
            <Row label="Tổng số lượng sau khi mua" value={`${fmtQty(newQty)} ${pos.unitLabel}`} />
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-slate-500">Lần mua này được ghi thành một lô riêng (giữ ngày và giá mua), nên nhập nhầm vẫn hủy được riêng lô đó.</p>
        <FieldError>{error}</FieldError>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose} className={btnGhost}>Hủy</button>
        <button
          type="button"
          data-testid="buymore-save"
          disabled={!!error}
          onClick={() => {
            if (onSave({ assetId: pos.lots[0].id, date, quantity: q, unitPrice: price, fee, deductFromWallet: deduct }) !== false) onClose();
          }}
          className={btnPrimary}
        >
          Ghi mua thêm
        </button>
      </ModalFooter>
    </Modal>
  );
};

// ------------------------------------------------------------------ Bán theo vị thế
const SellPositionModal: React.FC<{ pos: Position; state: UserFinancialState; onClose: () => void; onSave: (p: PositionSellInput) => Result }> = ({ pos, state, onClose, onSave }) => {
  const today = todayLocalStr();
  const [date, setDate] = useState(today);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [received, setReceived] = useState<number>(0);
  const [receivedTouched, setReceivedTouched] = useState(false);
  const q = qty.trim() === '' ? undefined : parseFloat(qty.replace(',', '.'));
  const effQty = q === undefined ? pos.totalQuantity : q;
  const suggested = price > 0 && Number.isFinite(effQty) ? Math.round(effQty * price) : 0;
  const recv = receivedTouched ? received : suggested;
  const pv = price > 0 && recv > 0 && date && !(q !== undefined && !(q > 0)) ? previewSellPosition(state, { key: pos.key, quantity: q, unitPrice: price, received: recv, date }) : null;
  const error = q !== undefined && !(q > 0) ? 'Số lượng bán phải lớn hơn 0.' : !(price > 0) ? `Nhập giá bán mỗi ${pos.unitLabel}.` : !(recv > 0) ? 'Nhập số tiền thực nhận.' : !date || date > today ? 'Chọn ngày bán (không ở tương lai).' : typeof pv === 'string' ? pv : '';
  return (
    <Modal title="Bán theo vị thế" subtitle={`${pos.symbol} · ${fmtQty(pos.totalQuantity)} ${pos.unitLabel} · giá vốn bình quân ${formatVND(pos.avgCost)}`} onClose={onClose}>
      <ModalBody>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Ngày bán</label>
            <input type="date" data-testid="sellpos-date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Số lượng bán (trống = bán hết)</label>
            <input type="text" inputMode="decimal" data-testid="sellpos-qty" value={qty} onChange={(e) => setQty(e.target.value)} placeholder={fmtQty(pos.totalQuantity)} className={`${inputCls} font-mono`} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Giá bán mỗi {pos.unitLabel} (VND)</label>
            <CurrencyInput value={price} onChange={setPrice} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Thực nhận vào ví (sau phí/thuế)</label>
            <CurrencyInput value={recv} onChange={(v) => { setReceived(v); setReceivedTouched(true); }} className={inputCls} />
          </div>
        </div>
        {pv && typeof pv !== 'string' && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-1" data-testid="sellpos-preview">
            <Row label="Giá vốn bình quân" value={`${formatVND(pv.avgCost)} / ${pos.unitLabel}`} />
            <Row label="Giá vốn phần bán" value={formatVND(pv.costSold)} />
            <Row label="Phí/thuế" value={formatVND(pv.fees)} />
            <Row label="Lãi/lỗ thực tế" value={`${pv.realizedPnL >= 0 ? '+' : '−'}${formatVND(Math.abs(pv.realizedPnL))}`} strong />
            <div className="pt-1 text-[11px] text-slate-500">
              Phân bổ theo lô: {pv.lots.map((l) => `${fmtQty(l.quantity)} (${l.assetName})`).join(' · ')}
            </div>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-slate-500">Giá vốn tính theo bình quân cả vị thế, chia theo tỷ lệ số lượng cho từng lô. Cả lần bán có thể hủy một lần từ sổ giao dịch.</p>
        <FieldError>{error}</FieldError>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose} className={btnGhost}>Hủy</button>
        <button
          type="button"
          data-testid="sellpos-save"
          disabled={!!error}
          onClick={() => {
            if (onSave({ key: pos.key, quantity: q, unitPrice: price, received: recv, date }) !== false) onClose();
          }}
          className={btnPrimary}
        >
          Xác nhận bán
        </button>
      </ModalFooter>
    </Modal>
  );
};

// ------------------------------------------------------------------ Cổ tức theo vị thế
const DividendModal: React.FC<{ pos: Position; onClose: () => void; onSave: (p: { key: string; amount: number; date: string; note?: string }) => Result }> = ({ pos, onClose, onSave }) => {
  const today = todayLocalStr();
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState<number>(0);
  const error = !(amount > 0) ? 'Nhập số tiền cổ tức nhận được.' : !date || date > today ? 'Chọn ngày nhận (không ở tương lai).' : '';
  return (
    <Modal title="Ghi cổ tức" subtitle={`${pos.symbol} · ${fmtQty(pos.totalQuantity)} ${pos.unitLabel} ở ${pos.lots.length} lô`} onClose={onClose}>
      <ModalBody>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Ngày nhận</label>
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Tổng cổ tức nhận (VND)</label>
            <CurrencyInput value={amount} onChange={setAmount} className={inputCls} />
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">Cộng vào ví một lần, chia cho các lô theo số lượng (lô mua sau ngày nhận không được chia).</p>
        <FieldError>{error}</FieldError>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose} className={btnGhost}>Hủy</button>
        <button type="button" disabled={!!error} onClick={() => { if (onSave({ key: pos.key, amount, date }) !== false) onClose(); }} className={btnPrimary}>
          Ghi cổ tức
        </button>
      </ModalFooter>
    </Modal>
  );
};

// ------------------------------------------------------------------ Chi phí cải tạo
export const ImprovementModal: React.FC<{ asset: Asset; cash: number; onClose: () => void; onSave: (p: ImprovementInput) => Result }> = ({ asset, cash, onClose, onSave }) => {
  const today = todayLocalStr();
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState<number>(0);
  const [note, setNote] = useState('');
  const [deduct, setDeduct] = useState(true);
  const [addToValue, setAddToValue] = useState(true);
  const error = !(amount > 0) ? 'Nhập số tiền chi.' : !date || date > today ? 'Chọn ngày chi (không ở tương lai).' : date < asset.purchaseDate ? `Ngày chi không được trước ngày mua tài sản (${vnDate(asset.purchaseDate)}).` : deduct && amount > cash ? `Ví chỉ còn ${formatVND(cash)}.` : '';
  return (
    <Modal title="Chi phí cải tạo / đầu tư thêm" subtitle={asset.name} onClose={onClose}>
      <ModalBody>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Ngày chi</label>
            <input type="date" data-testid="improve-date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Số tiền (VND)</label>
            <CurrencyInput value={amount} onChange={setAmount} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Ghi chú</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ví dụ: sơn sửa, thay nội thất" className={inputCls} />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
          <input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} /> Trừ tiền từ ví đầu tư
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
          <input type="checkbox" checked={addToValue} onChange={(e) => setAddToValue(e.target.checked)} /> Cộng luôn vào giá trị hiện tại (bỏ chọn nếu chỉ tăng giá vốn, sẽ định giá lại sau)
        </label>
        <p className="text-[11px] leading-relaxed text-slate-500">Khoản này được cộng vào giá vốn của tài sản (không tạo tài sản mới).</p>
        <FieldError>{error}</FieldError>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose} className={btnGhost}>Hủy</button>
        <button type="button" data-testid="improve-save" disabled={!!error} onClick={() => { if (onSave({ assetId: asset.id, amount, date, note, deductFromWallet: deduct, addToValue }) !== false) onClose(); }} className={btnPrimary}>
          Ghi chi phí
        </button>
      </ModalFooter>
    </Modal>
  );
};

// ------------------------------------------------------------------ Bảng vị thế
export const PositionsPanel: React.FC<{ state: UserFinancialState; handlers: PositionHandlers }> = ({ state, handlers }) => {
  const positions = useMemo(() => buildPositions(state.assets), [state.assets]);
  const [open, setOpen] = useState<string | null>(null);
  const [dlg, setDlg] = useState<{ kind: 'buy' | 'sell' | 'div'; key: string } | null>(null);
  if (positions.length === 0) return null;
  const cur = dlg ? positions.find((p) => p.key === dlg.key) : undefined;
  return (
    <section className="rounded-xl border border-slate-200 bg-white" data-testid="positions-panel">
      <div className="border-b border-slate-100 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-900">Vị thế theo mã</h3>
        <p className="text-[11px] text-slate-500">Gộp các lô cùng mã: tổng số lượng, giá vốn bình quân, lãi/lỗ. Từng lô vẫn nằm ở danh sách bên dưới.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] text-slate-500">
              <th className="px-4 py-2 font-medium">Mã</th>
              <th className="px-2 py-2 text-right font-medium">Số lượng</th>
              <th className="px-2 py-2 text-right font-medium">Giá vốn BQ</th>
              <th className="px-2 py-2 text-right font-medium">Giá trị</th>
              <th className="px-2 py-2 text-right font-medium">Lãi/lỗ chưa chốt</th>
              <th className="px-4 py-2 text-right font-medium">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <React.Fragment key={p.key}>
                <tr className="border-t border-slate-100" data-position={p.key}>
                  <td className="px-4 py-2">
                    <button type="button" onClick={() => setOpen(open === p.key ? null : p.key)} className="font-semibold text-slate-900 hover:underline" title="Xem từng lô">
                      {p.symbol}
                    </button>
                    <span className="ml-1.5 text-[11px] text-slate-400">{p.lots.length} lô</span>
                  </td>
                  <td className="px-2 py-2 text-right font-mono">{fmtQty(p.totalQuantity)}</td>
                  <td className="px-2 py-2 text-right font-mono">{formatVND(p.avgCost)}</td>
                  <td className="px-2 py-2 text-right font-mono">{formatVND(p.totalValue)}</td>
                  <td className={`px-2 py-2 text-right font-mono ${p.unrealized >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {p.unrealized >= 0 ? '+' : '−'}{formatVND(Math.abs(p.unrealized))} <span className="text-[11px]">({pct(p.unrealizedPct)})</span>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button type="button" data-pos-action="buy" onClick={() => setDlg({ kind: 'buy', key: p.key })} className="mr-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Mua thêm</button>
                    <button type="button" data-pos-action="sell" onClick={() => setDlg({ kind: 'sell', key: p.key })} className="mr-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Bán</button>
                    {p.category === 'stock' && (
                      <button type="button" data-pos-action="div" onClick={() => setDlg({ kind: 'div', key: p.key })} className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">Cổ tức</button>
                    )}
                  </td>
                </tr>
                {open === p.key && (
                  <tr className="bg-slate-50" data-position-lots={p.key}>
                    <td colSpan={6} className="px-4 py-2">
                      <ul className="space-y-0.5 text-[11px] text-slate-700">
                        {p.lots.map((l) => (
                          <li key={l.id} className="flex flex-wrap gap-x-4">
                            <span className="font-mono text-slate-500">{vnDate(l.purchaseDate)}</span>
                            <span>{fmtQty(Number((l.metadata as any)[p.category === 'stock' ? 'quantity' : p.category === 'fund' ? 'units' : 'quantityChi']) || 0)} {p.unitLabel}</span>
                            <span>giá vốn {formatVND(l.initialCost)}</span>
                            <span>giá trị {formatVND(l.currentValue)}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {dlg && cur && dlg.kind === 'buy' && <BuyMoreModal pos={cur} cash={state.wallet.availableCash} onClose={() => setDlg(null)} onSave={handlers.onBuyMore} />}
      {dlg && cur && dlg.kind === 'sell' && <SellPositionModal pos={cur} state={state} onClose={() => setDlg(null)} onSave={handlers.onSellPosition} />}
      {dlg && cur && dlg.kind === 'div' && <DividendModal pos={cur} onClose={() => setDlg(null)} onSave={handlers.onPositionDividend} />}
    </section>
  );
};
