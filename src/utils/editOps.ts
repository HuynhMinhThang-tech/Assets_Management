import { Asset, Debt, EditLogEntry, UserFinancialState } from '../types/finance';
import { dueDateFor, isLiveTx, isOpenItem, todayLocalStr } from './calculations';
import { prevDueOf, rebuildSchedule } from './debtCore';
import { sortLedger } from './ledger';
import { IdGen, OpResult } from './ops';

/**
 * Sửa thông tin tài sản và khoản vay (giai đoạn 3). Hàm thuần: nhận trạng thái cũ → trả trạng thái mới hoặc lỗi.
 * Nguyên tắc an toàn:
 *  - Mọi thay đổi có kiểm tra (ngày, số hợp lệ), không ghi thẳng vào state.
 *  - Trường đã gắn với sổ cái (số lượng, giá vốn khi đã có giao dịch) KHÔNG sửa trực tiếp: hướng hủy giao dịch rồi nhập lại,
 *    để ví, bảng cân đối và báo cáo luôn khớp.
 *  - Lịch sử chỉnh sửa (ngày, trường, giá trị cũ → mới) được lưu trong state.editLog.
 */
const defaultId: IdGen = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fail = (error: string): OpResult => ({ ok: false, error });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_VALUE = 1e15;
export const EDIT_LOG_LIMIT = 500;

const LOCK_MSG =
  'Tài sản này đã có giao dịch trong sổ (mua, bán, cổ tức…), nên số lượng và giá vốn không sửa trực tiếp được. Hãy hủy các giao dịch liên quan (hoặc hủy tài sản nếu nhập nhầm) rồi nhập lại, để ví và báo cáo luôn khớp.';

export interface AssetEditInput {
  name?: string;
  notes?: string;
  purchaseDate?: string;
  /** Cổ phiếu: mã; quỹ: mã quỹ. */
  symbol?: string;
  /** Cổ phiếu: số cổ phiếu · quỹ: số CCQ · vàng: số chỉ. */
  quantity?: number;
  /** Giá vốn mỗi đơn vị (cổ phiếu, NAV vốn, giá vốn/chỉ). */
  unitCost?: number;
  /** Tài sản không có đơn vị (bất động sản, tài sản khác): tổng giá vốn. */
  totalCost?: number;
  /** Số ngày nhắc định giá lại (7–3650); null = dùng mặc định theo loại tài sản. */
  reviewIntervalDays?: number | null;
  /** Tỷ lệ mất giá mỗi năm (%), 0 < r < 100; null = bỏ khai báo. App chỉ gợi ý giá mới theo tỷ lệ này. */
  depreciationPerYear?: number | null;
}

export interface DebtEditInput {
  name?: string;
  lender?: string;
  notes?: string;
  /** Ngày trả hằng tháng (1–31): dời ngày đến hạn của các kỳ chưa trả. */
  paymentDay?: number;
}

const liveLinked = (state: UserFinancialState, assetId: string) => state.transactions.filter((t) => isLiveTx(t) && t.linkedAssetId === assetId);

/** Khóa sửa: tài sản đã có giao dịch trong sổ thì không sửa số lượng / giá vốn trực tiếp. */
export function assetEditLock(state: UserFinancialState, assetId: string): { quantityCostLocked: boolean; reason: string } {
  const locked = liveLinked(state, assetId).length > 0;
  return { quantityCostLocked: locked, reason: locked ? LOCK_MSG : '' };
}

const UNIT_FIELDS: Record<string, { qty: string; cost: string; price: string } | undefined> = {
  stock: { qty: 'quantity', cost: 'avgCostPrice', price: 'currentPrice' },
  fund: { qty: 'units', cost: 'avgNav', price: 'currentNav' },
  gold: { qty: 'quantityChi', cost: 'costPerChi', price: 'currentPerChi' },
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const posNum = (v: unknown) => num(v) > 0 && num(v) < MAX_VALUE;

function appendLog(state: UserFinancialState, entries: Omit<EditLogEntry, 'id'>[], uid: IdGen): UserFinancialState {
  if (entries.length === 0) return state;
  const added: EditLogEntry[] = entries.map((e) => ({ ...e, id: uid('edit') }));
  return { ...state, editLog: [...added, ...(state.editLog || [])].slice(0, EDIT_LOG_LIMIT) };
}

export function applyEditAsset(state: UserFinancialState, assetId: string, patch: AssetEditInput, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const a = state.assets.find((x) => x.id === assetId);
  if (!a) return fail('Không tìm thấy tài sản.');
  if (a.status !== 'active') return fail('Chỉ sửa được tài sản đang nắm giữ.');
  const log: Omit<EditLogEntry, 'id'>[] = [];
  const push = (field: string, from: unknown, to: unknown) => log.push({ date: today, targetType: 'asset', targetId: a.id, targetName: a.name, field, from: String(from ?? ''), to: String(to ?? '') });
  let next: Asset = { ...a, metadata: { ...(a.metadata as object) } as Asset['metadata'] };
  let txs = state.transactions;
  const md = next.metadata as any;

  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (!v) return fail('Tên tài sản không được để trống.');
    if (v.length > 120) return fail('Tên tài sản tối đa 120 ký tự.');
    if (v !== a.name) {
      push('name', a.name, v);
      next.name = v;
    }
  }
  if (patch.notes !== undefined) {
    const v = patch.notes.trim();
    if (v.length > 1000) return fail('Ghi chú tối đa 1000 ký tự.');
    if (v !== (a.notes || '')) {
      push('notes', a.notes || '', v);
      next.notes = v || undefined;
    }
  }
  if (patch.symbol !== undefined) {
    if (a.category !== 'stock' && a.category !== 'fund') return fail('Chỉ cổ phiếu và chứng chỉ quỹ có mã.');
    const v = patch.symbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(v)) return fail('Mã chỉ gồm chữ và số, dài 2–12 ký tự.');
    const key = a.category === 'stock' ? 'symbol' : 'fundCode';
    if (v !== md[key]) {
      push('symbol', md[key], v);
      md[key] = v;
    }
  }
  if (patch.purchaseDate !== undefined) {
    const v = patch.purchaseDate;
    if (!DATE_RE.test(v)) return fail('Chọn ngày mua hợp lệ.');
    if (v > today) return fail('Ngày mua không được ở tương lai.');
    if (a.category === 'savings') return fail('Sổ tiết kiệm: ngày gửi gắn với kỳ hạn và đáo hạn nên không sửa ở đây. Hãy hủy rồi nhập lại nếu nhập sai.');
    if (v !== a.purchaseDate) {
      const linked = liveLinked(state, a.id);
      const initialBuy = linked.find((t) => t.type === 'buy_asset' && t.date.slice(0, 10) === a.purchaseDate);
      const others = linked.filter((t) => t !== initialBuy);
      const earliest = others.reduce((m, t) => (t.date.slice(0, 10) < m ? t.date.slice(0, 10) : m), '9999-12-31');
      if (v > earliest) return fail(`Ngày mua không được sau giao dịch đầu tiên của tài sản này (${earliest}).`);
      push('purchaseDate', a.purchaseDate, v);
      next.purchaseDate = v;
      if (initialBuy) txs = sortLedger(txs.map((t) => (t === initialBuy ? { ...t, date: v } : t)));
      const linkedDebt = state.debts.find((d) => d.status === 'active' && d.id === a.linkedDebtId);
      void linkedDebt;
    }
  }

  if (patch.reviewIntervalDays !== undefined) {
    if (a.category === 'savings') return fail('Sổ tiết kiệm tự tính theo lãi nên không cần nhắc định giá.');
    const v = patch.reviewIntervalDays;
    if (v !== null && !(Number.isInteger(v) && v >= 7 && v <= 3650)) return fail('Số ngày nhắc định giá lại phải là số nguyên từ 7 đến 3650.');
    if ((v ?? undefined) !== a.reviewIntervalDays) {
      push('reviewIntervalDays', a.reviewIntervalDays ?? '', v ?? '');
      next.reviewIntervalDays = v ?? undefined;
    }
  }
  if (patch.depreciationPerYear !== undefined) {
    if (a.category === 'savings') return fail('Sổ tiết kiệm không khấu hao.');
    const v = patch.depreciationPerYear;
    if (v !== null && !(Number.isFinite(v) && v > 0 && v < 100)) return fail('Tỷ lệ mất giá mỗi năm phải lớn hơn 0% và nhỏ hơn 100%.');
    if ((v ?? undefined) !== a.depreciationPerYear) {
      push('depreciationPerYear', a.depreciationPerYear ?? '', v ?? '');
      next.depreciationPerYear = v ?? undefined;
    }
  }

  const wantsQtyCost = patch.quantity !== undefined || patch.unitCost !== undefined || patch.totalCost !== undefined;
  if (wantsQtyCost) {
    if (assetEditLock(state, a.id).quantityCostLocked) return fail(LOCK_MSG);
    if (a.category === 'savings') return fail('Sổ tiết kiệm: số tiền gửi không sửa ở đây. Hãy hủy rồi nhập lại nếu nhập sai.');
    const uf = UNIT_FIELDS[a.category];
    if (uf) {
      if (patch.totalCost !== undefined) return fail('Tài sản này nhập theo số lượng và giá vốn mỗi đơn vị.');
      const q = patch.quantity !== undefined ? patch.quantity : md[uf.qty];
      const c = patch.unitCost !== undefined ? patch.unitCost : md[uf.cost];
      if (patch.quantity !== undefined && !posNum(q)) return fail('Số lượng phải lớn hơn 0.');
      if (patch.unitCost !== undefined && !(num(c) >= 0 && num(c) < MAX_VALUE)) return fail('Giá vốn không hợp lệ.');
      if (patch.quantity !== undefined && q !== md[uf.qty]) push('quantity', md[uf.qty], q);
      if (patch.unitCost !== undefined && c !== md[uf.cost]) push('unitCost', md[uf.cost], c);
      md[uf.qty] = q;
      md[uf.cost] = c;
      next.initialCost = Math.round(q * c);
      const price = Number(md[uf.price]) > 0 ? Number(md[uf.price]) : c;
      next.currentValue = Math.round(q * price);
    } else {
      if (patch.quantity !== undefined || patch.unitCost !== undefined) return fail('Tài sản này nhập theo tổng giá vốn.');
      if (!posNum(patch.totalCost)) return fail('Tổng giá vốn phải lớn hơn 0.');
      if (patch.totalCost !== a.initialCost) push('totalCost', a.initialCost, patch.totalCost);
      next.initialCost = Math.round(patch.totalCost!);
      if (a.category === 'real_estate') md.purchasePrice = next.initialCost;
    }
    // Tài sản có từ trước không qua ví: số dư ban đầu bám theo giá vốn mới để việc sửa không thành "lãi/lỗ"
    if (next.preexisting) next.openingValue = next.initialCost;
  }

  if (log.length === 0) return { ok: true, state };
  return {
    ok: true,
    state: appendLog({ ...state, transactions: txs, assets: state.assets.map((x) => (x.id === a.id ? next : x)) }, log, uid),
  };
}

export function applyEditDebt(state: UserFinancialState, debtId: string, patch: DebtEditInput, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const d = state.debts.find((x) => x.id === debtId);
  if (!d) return fail('Không tìm thấy khoản vay.');
  if (d.status !== 'active') return fail('Chỉ sửa được khoản vay đang vay.');
  const log: Omit<EditLogEntry, 'id'>[] = [];
  const push = (field: string, from: unknown, to: unknown) => log.push({ date: today, targetType: 'debt', targetId: d.id, targetName: d.name, field, from: String(from ?? ''), to: String(to ?? '') });
  let next: Debt = { ...d };

  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (!v) return fail('Tên khoản vay không được để trống.');
    if (v.length > 120) return fail('Tên khoản vay tối đa 120 ký tự.');
    if (v !== d.name) {
      push('name', d.name, v);
      next.name = v;
    }
  }
  if (patch.lender !== undefined) {
    const v = patch.lender.trim();
    if (!v) return fail('Nhập ngân hàng / tổ chức cho vay.');
    if (v.length > 120) return fail('Tên ngân hàng tối đa 120 ký tự.');
    if (v !== d.lender) {
      push('lender', d.lender, v);
      next.lender = v;
    }
  }
  if (patch.notes !== undefined) {
    const v = patch.notes.trim();
    if (v.length > 1000) return fail('Ghi chú tối đa 1000 ký tự.');
    if (v !== (d.notes || '')) {
      push('notes', d.notes || '', v);
      next.notes = v || undefined;
    }
  }
  if (patch.paymentDay !== undefined) {
    const day = patch.paymentDay;
    if (!Number.isInteger(day) || day < 1 || day > 31) return fail('Ngày trả hằng tháng phải từ 1 đến 31.');
    if (day !== d.paymentDayOfMonth) {
      const sch = d.schedule || [];
      const i0 = sch.findIndex(isOpenItem);
      if (i0 < 0) return fail('Khoản vay không còn kỳ nào chưa trả.');
      const firstNew = dueDateFor(sch[i0].dueDate, 0, day);
      const prev = sch[i0].accrualFrom && sch[i0].accrualFrom! > prevDueOf(d, i0) ? sch[i0].accrualFrom! : prevDueOf(d, i0);
      if (firstNew <= prev) return fail(`Ngày trả mới làm kỳ #${sch[i0].period} đến hạn ngày ${firstNew}, không sau mốc trước đó (${prev}). Chọn ngày muộn hơn.`);
      const schedule = sch.map((it, i) => (i >= i0 && isOpenItem(it) ? { ...it, dueDate: dueDateFor(sch[i0].dueDate, i - i0, day) } : it));
      push('paymentDay', d.paymentDayOfMonth, day);
      next = { ...next, paymentDayOfMonth: day, schedule };
      if (i0 === 0 && d.trackingStartDate) next.scheduleAnchorDate = dueDateFor(firstNew, -1, day);
      next = rebuildSchedule(next, {}, today);
    }
  }

  if (log.length === 0) return { ok: true, state };
  return { ok: true, state: appendLog({ ...state, debts: state.debts.map((x) => (x.id === d.id ? next : x)) }, log, uid) };
}
