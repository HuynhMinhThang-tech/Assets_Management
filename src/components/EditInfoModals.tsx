import React, { useState } from 'react';
import { Asset, Debt, EditLogEntry, UserFinancialState } from '../types/finance';
import { todayLocalStr } from '../utils/calculations';
import { assetEditLock, AssetEditInput, DebtEditInput } from '../utils/editOps';
import { CurrencyInput } from './CurrencyInput';
import { FieldError, Modal, ModalBody, ModalFooter } from './ui/Modal';

type Result = boolean | void;

const inputCls = 'w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900';
const btnPrimary = 'px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg disabled:cursor-not-allowed disabled:opacity-50';
const btnGhost = 'px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg font-medium';
const vnDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d);

const FIELD_LABEL: Record<string, string> = {
  name: 'Tên',
  notes: 'Ghi chú',
  purchaseDate: 'Ngày mua',
  symbol: 'Mã',
  quantity: 'Số lượng',
  unitCost: 'Giá vốn / đơn vị',
  totalCost: 'Tổng giá vốn',
  lender: 'Ngân hàng',
  paymentDay: 'Ngày trả hằng tháng',
};

const EditHistory: React.FC<{ log: EditLogEntry[] }> = ({ log }) => {
  if (log.length === 0) return null;
  return (
    <div data-edit-history className="rounded-lg border border-slate-200 bg-slate-50">
      <div className="px-3 py-2 text-[11px] font-semibold text-slate-600">Lịch sử chỉnh sửa</div>
      <ul className="max-h-36 divide-y divide-slate-100 overflow-auto text-[11px] text-slate-700">
        {log.slice(0, 20).map((e) => (
          <li key={e.id} className="px-3 py-1.5">
            <span className="text-slate-400">{vnDate(e.date)}</span> · <strong>{FIELD_LABEL[e.field] || e.field}</strong>: {e.from || '(trống)'} → {e.to || '(trống)'}
          </li>
        ))}
      </ul>
    </div>
  );
};

const UNIT: Record<string, { qty: string; cost: string; qtyLabel: string; costLabel: string } | undefined> = {
  stock: { qty: 'quantity', cost: 'avgCostPrice', qtyLabel: 'Số cổ phiếu', costLabel: 'Giá vốn mỗi cổ phiếu (VND)' },
  fund: { qty: 'units', cost: 'avgNav', qtyLabel: 'Số chứng chỉ quỹ', costLabel: 'NAV vốn mỗi CCQ (VND)' },
  gold: { qty: 'quantityChi', cost: 'costPerChi', qtyLabel: 'Số chỉ', costLabel: 'Giá vốn mỗi chỉ (VND)' },
};

export const EditAssetModal: React.FC<{
  asset: Asset;
  state: UserFinancialState;
  onClose: () => void;
  onSave: (patch: AssetEditInput) => Result;
}> = ({ asset, state, onClose, onSave }) => {
  const md = asset.metadata as any;
  const uf = UNIT[asset.category];
  const lock = assetEditLock(state, asset.id);
  const isSavings = asset.category === 'savings';
  const [name, setName] = useState(asset.name);
  const [notes, setNotes] = useState(asset.notes || '');
  const [date, setDate] = useState(asset.purchaseDate);
  const [symbol, setSymbol] = useState<string>(md.symbol || md.fundCode || '');
  const [qty, setQty] = useState<string>(uf ? String(md[uf.qty] ?? '') : '');
  const [unitCost, setUnitCost] = useState<number>(uf ? Number(md[uf.cost]) || 0 : 0);
  const [totalCost, setTotalCost] = useState<number>(asset.initialCost);
  const [reviewDays, setReviewDays] = useState<string>(asset.reviewIntervalDays ? String(asset.reviewIntervalDays) : '');
  const [deprec, setDeprec] = useState<string>(asset.depreciationPerYear ? String(asset.depreciationPerYear) : '');
  const hasSymbol = asset.category === 'stock' || asset.category === 'fund';
  const today = todayLocalStr();

  const error = !name.trim() ? 'Nhập tên tài sản.' : !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 'Chọn ngày mua.' : date > today ? 'Ngày mua không được ở tương lai.' : '';

  const buildPatch = (): AssetEditInput => {
    const p: AssetEditInput = {};
    if (name.trim() !== asset.name) p.name = name;
    if (notes.trim() !== (asset.notes || '')) p.notes = notes;
    if (!isSavings && date !== asset.purchaseDate) p.purchaseDate = date;
    if (hasSymbol && symbol.trim().toUpperCase() !== String(md.symbol || md.fundCode || '')) p.symbol = symbol;
    if (!isSavings) {
      const rd = reviewDays.trim() === '' ? null : parseInt(reviewDays);
      if ((rd ?? undefined) !== asset.reviewIntervalDays) p.reviewIntervalDays = rd;
      const dp = deprec.trim() === '' ? null : parseFloat(deprec.replace(',', '.'));
      if ((dp ?? undefined) !== asset.depreciationPerYear) p.depreciationPerYear = dp;
    }
    if (!lock.quantityCostLocked && !isSavings) {
      if (uf) {
        const q = parseFloat(qty.replace(',', '.'));
        if (Number.isFinite(q) && q !== md[uf.qty]) p.quantity = q;
        if (unitCost !== (Number(md[uf.cost]) || 0)) p.unitCost = unitCost;
      } else if (totalCost !== asset.initialCost) {
        p.totalCost = totalCost;
      }
    }
    return p;
  };

  const history = (state.editLog || []).filter((e) => e.targetType === 'asset' && e.targetId === asset.id);
  return (
    <Modal title="Sửa thông tin tài sản" subtitle={asset.name} onClose={onClose}>
      <ModalBody>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Tên *</label>
          <input type="text" data-testid="edit-asset-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Ngày mua</label>
            <input type="date" value={date} max={today} disabled={isSavings} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            {isSavings && <span className="mt-0.5 block text-[11px] text-slate-500">Sổ tiết kiệm: ngày gửi gắn với kỳ hạn, không sửa ở đây.</span>}
          </div>
          {hasSymbol && (
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">{asset.category === 'stock' ? 'Mã cổ phiếu' : 'Mã quỹ'}</label>
              <input type="text" data-testid="edit-asset-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className={`${inputCls} font-mono`} />
            </div>
          )}
        </div>

        {!isSavings && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700">Số lượng và giá vốn</div>
            {lock.quantityCostLocked ? (
              <div data-edit-locked className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-medium leading-relaxed text-amber-800">
                {lock.reason}
              </div>
            ) : uf ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">{uf.qtyLabel}</label>
                  <input type="text" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={`${inputCls} font-mono`} />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">{uf.costLabel}</label>
                  <CurrencyInput value={unitCost} onChange={setUnitCost} className={inputCls} />
                </div>
              </div>
            ) : (
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">Tổng giá vốn (VND)</label>
                <CurrencyInput value={totalCost} onChange={setTotalCost} className={inputCls} />
              </div>
            )}
          </div>
        )}
        {isSavings && <div className="text-[11px] text-slate-500">Số tiền gửi của sổ tiết kiệm không sửa ở đây. Nhập sai thì hủy sổ rồi nhập lại.</div>}

        {!isSavings && (
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700">Nhắc định giá và khấu hao (tùy chọn)</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">Nhắc định giá lại sau (ngày)</label>
                <input type="number" min="7" max="3650" data-testid="edit-review-days" placeholder="Mặc định theo loại" value={reviewDays} onChange={(e) => setReviewDays(e.target.value)} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">Mất giá mỗi năm (%)</label>
                <input type="text" inputMode="decimal" data-testid="edit-depreciation" placeholder="Bỏ trống nếu không áp dụng" value={deprec} onChange={(e) => setDeprec(e.target.value)} className={`${inputCls} font-mono`} />
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              Mặc định nhắc: nhà 6 tháng, xe 3 tháng, tài sản khác 6 tháng, cổ phiếu/quỹ/vàng 30 ngày. Nếu khai tỷ lệ mất giá, app chỉ <strong>gợi ý</strong> giá mới ở tab Cập nhật giá — bạn xác nhận mới ghi.
            </p>
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Ghi chú</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
        </div>
        <EditHistory log={history} />
        <FieldError>{error}</FieldError>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose} className={btnGhost}>Hủy</button>
        <button
          type="button"
          data-testid="edit-asset-save"
          disabled={!!error}
          onClick={() => {
            if (onSave(buildPatch()) !== false) onClose();
          }}
          className={btnPrimary}
        >
          Lưu thay đổi
        </button>
      </ModalFooter>
    </Modal>
  );
};

export const EditDebtModal: React.FC<{
  debt: Debt;
  editLog: EditLogEntry[];
  onClose: () => void;
  onSave: (patch: DebtEditInput) => Result;
}> = ({ debt, editLog, onClose, onSave }) => {
  const [name, setName] = useState(debt.name);
  const [lender, setLender] = useState(debt.lender);
  const [notes, setNotes] = useState(debt.notes || '');
  const [day, setDay] = useState(String(debt.paymentDayOfMonth));
  const dayNum = parseInt(day);
  const error = !name.trim() ? 'Nhập tên khoản vay.' : !lender.trim() ? 'Nhập ngân hàng / tổ chức cho vay.' : !(dayNum >= 1 && dayNum <= 31) ? 'Ngày trả hằng tháng phải từ 1 đến 31.' : '';
  const history = editLog.filter((e) => e.targetType === 'debt' && e.targetId === debt.id);
  return (
    <Modal title="Sửa thông tin khoản vay" subtitle={debt.name} onClose={onClose}>
      <ModalBody>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Tên khoản vay *</label>
            <input type="text" data-testid="edit-debt-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Ngân hàng / Tổ chức *</label>
            <input type="text" value={lender} onChange={(e) => setLender(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Ngày trả hằng tháng</label>
          <input type="number" min="1" max="31" data-testid="edit-debt-day" value={day} onChange={(e) => setDay(e.target.value)} className={`${inputCls} w-28 font-mono`} />
          <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
            Dời ngày đến hạn của các kỳ chưa trả; kỳ đã trả giữ nguyên. Lãi các kỳ tính lại theo số ngày.
          </span>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">Ghi chú</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
          Dư nợ, kỳ hạn, phương thức và lãi suất không sửa trực tiếp. Dùng <strong>Đối chiếu sao kê</strong>, <strong>Đổi lãi suất</strong> hoặc <strong>Trả trước gốc</strong> để mọi thay đổi có dấu vết và lịch tự tính lại.
        </div>
        <EditHistory log={history} />
        <FieldError>{error}</FieldError>
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onClose} className={btnGhost}>Hủy</button>
        <button
          type="button"
          data-testid="edit-debt-save"
          disabled={!!error}
          onClick={() => {
            const p: DebtEditInput = {};
            if (name.trim() !== debt.name) p.name = name;
            if (lender.trim() !== debt.lender) p.lender = lender;
            if (notes.trim() !== (debt.notes || '')) p.notes = notes;
            if (dayNum !== debt.paymentDayOfMonth) p.paymentDay = dayNum;
            if (onSave(p) !== false) onClose();
          }}
          className={btnPrimary}
        >
          Lưu thay đổi
        </button>
      </ModalFooter>
    </Modal>
  );
};
