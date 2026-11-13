import { Asset, CashTransaction, UserFinancialState } from '../types/finance';
import { checkTxDate, IdGen, OpResult, SellInput, applyIncome, applySell, applyVoidTx, canVoidTx } from './ops';
import { isLiveTx, todayLocalStr } from './calculations';
import { insertTx } from './ledger';

/**
 * Vị thế = nhóm các LÔ (tài sản) đang giữ cùng loại và cùng mã. Cấu trúc lô hiện có không đổi: mỗi lần mua vẫn là một tài sản
 * riêng (giữ ngày mua và giá từng lần, hủy được lần mua nhầm). Vị thế chỉ là lớp tính toán phía trên:
 *   - giá vốn bình quân gia quyền = tổng giá vốn / tổng số lượng;
 *   - bán một phần tính giá vốn theo bình quân cả vị thế, phân bổ theo tỷ lệ số lượng cho từng lô;
 *   - cổ tức ghi theo vị thế, chia theo số lượng.
 */
const defaultId: IdGen = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fail = (error: string): OpResult => ({ ok: false, error });

const UNIT: Record<string, { qty: string; cost: string; price: string; label: string; integer: boolean } | undefined> = {
  stock: { qty: 'quantity', cost: 'avgCostPrice', price: 'currentPrice', label: 'cổ phiếu', integer: true },
  fund: { qty: 'units', cost: 'avgNav', price: 'currentNav', label: 'CCQ', integer: false },
  gold: { qty: 'quantityChi', cost: 'costPerChi', price: 'currentPerChi', label: 'chỉ', integer: false },
};

export const supportsPositions = (a: Asset) => !!UNIT[a.category];

/** Khóa vị thế của một lô: cổ phiếu theo mã, quỹ theo mã quỹ, vàng theo loại vàng. Loại khác không có vị thế. */
export function positionKey(a: Asset): string | null {
  const md = a.metadata as any;
  if (a.category === 'stock' && md.symbol) return `stock:${String(md.symbol).trim().toUpperCase()}`;
  if (a.category === 'fund' && md.fundCode) return `fund:${String(md.fundCode).trim().toUpperCase()}`;
  if (a.category === 'gold' && md.goldType) return `gold:${md.goldType}`;
  return null;
}

export interface Position {
  key: string;
  category: Asset['category'];
  /** Mã (cổ phiếu, quỹ) hoặc loại vàng. */
  symbol: string;
  lots: Asset[];
  totalQuantity: number;
  totalCost: number;
  totalValue: number;
  /** Giá vốn bình quân gia quyền mỗi đơn vị. */
  avgCost: number;
  unrealized: number;
  unrealizedPct: number | null;
  unitLabel: string;
}

const qtyOf = (a: Asset) => Number((a.metadata as any)[UNIT[a.category]!.qty]) || 0;

export function buildPositions(assets: Asset[]): Position[] {
  const map = new Map<string, Asset[]>();
  for (const a of assets) {
    if (a.status !== 'active' || !supportsPositions(a)) continue;
    const k = positionKey(a);
    if (!k) continue;
    map.set(k, [...(map.get(k) || []), a]);
  }
  const out: Position[] = [];
  for (const [key, lots] of map) {
    const sorted = [...lots].sort((x, y) => (x.purchaseDate < y.purchaseDate ? -1 : x.purchaseDate > y.purchaseDate ? 1 : 0));
    const totalQuantity = sorted.reduce((s, a) => s + qtyOf(a), 0);
    const totalCost = sorted.reduce((s, a) => s + a.initialCost, 0);
    const totalValue = sorted.reduce((s, a) => s + a.currentValue, 0);
    const first = sorted[0];
    const md = first.metadata as any;
    out.push({
      key,
      category: first.category,
      symbol: first.category === 'gold' ? String(md.goldType) : String(md.symbol || md.fundCode),
      lots: sorted,
      totalQuantity,
      totalCost,
      totalValue,
      avgCost: totalQuantity > 0 ? totalCost / totalQuantity : 0,
      unrealized: totalValue - totalCost,
      unrealizedPct: totalCost > 0 ? (totalValue - totalCost) / totalCost : null,
      unitLabel: UNIT[first.category]!.label,
    });
  }
  return out.sort((a, b) => b.totalValue - a.totalValue);
}

// ---------------------------------------------------------------- Bán theo vị thế
export interface PositionSellInput {
  /** Khóa vị thế (positionKey). */
  key: string;
  /** Số lượng bán; bỏ trống = bán hết vị thế. */
  quantity?: number;
  unitPrice: number;
  /** Số tiền THỰC NHẬN vào ví sau phí/thuế. */
  received: number;
  date: string;
  note?: string;
  repriceRemainder?: boolean;
}

export interface LotAllocation {
  assetId: string;
  assetName: string;
  quantity: number;
  /** Giá vốn bình quân phân bổ cho phần bán của lô này. */
  costSold: number;
  recognized: number;
  received: number;
}

export interface PositionSellPreview {
  key: string;
  symbol: string;
  totalUnits: number;
  quantity: number;
  isPartial: boolean;
  avgCost: number;
  costSold: number;
  recognized: number;
  fees: number;
  realizedPnL: number;
  lots: LotAllocation[];
}

/** Chia `total` đơn vị cho các lô theo tỷ lệ số lượng (phương pháp phần dư lớn nhất để tổng đúng). */
function allocate(total: number, caps: number[], integer: boolean): number[] {
  const sumCaps = caps.reduce((s, x) => s + x, 0);
  if (sumCaps <= 0) return caps.map(() => 0);
  if (total >= sumCaps - 1e-9) return [...caps];
  const exact = caps.map((c) => (total * c) / sumCaps);
  if (!integer) return exact.map((x) => Math.round(x * 1e6) / 1e6);
  const floors = exact.map((x) => Math.floor(x + 1e-9));
  let left = Math.round(total) - floors.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x + 1e-9) })).sort((a, b) => b.r - a.r);
  const res = [...floors];
  for (const o of order) {
    if (left <= 0) break;
    if (res[o.i] < caps[o.i]) {
      res[o.i] += 1;
      left--;
    }
  }
  return res;
}

export function previewSellPosition(state: UserFinancialState, p: PositionSellInput): PositionSellPreview | string {
  const pos = buildPositions(state.assets).find((x) => x.key === p.key);
  if (!pos) return 'Không tìm thấy vị thế.';
  // Chỉ bán từ những lô đã mua tính đến ngày bán
  const eligible = pos.lots.filter((l) => l.purchaseDate <= p.date);
  const totalUnits = eligible.reduce((s, l) => s + qtyOf(l), 0);
  if (totalUnits <= 0) return 'Chưa có lô nào được mua tính đến ngày bán.';
  const quantity = p.quantity && p.quantity > 0 ? p.quantity : totalUnits;
  if (quantity > totalUnits + 1e-9) return `Chỉ có ${totalUnits.toLocaleString('vi-VN')} ${pos.unitLabel} để bán tính đến ngày ${p.date}.`;
  if (!(p.unitPrice > 0)) return `Nhập giá bán mỗi ${pos.unitLabel}.`;
  const received = Math.round(p.received);
  if (!(received > 0)) return 'Nhập số tiền thực nhận lớn hơn 0.';
  const integer = UNIT[pos.category]!.integer;
  if (integer && Math.abs(quantity - Math.round(quantity)) > 1e-9) return 'Số lượng cổ phiếu phải là số nguyên.';
  const isPartial = quantity < totalUnits - 1e-9;
  const qs = allocate(Math.min(quantity, totalUnits), eligible.map(qtyOf), integer);
  const eligCost = eligible.reduce((s, l) => s + l.initialCost, 0);
  const avgCost = eligCost / totalUnits;
  const totalCostSold = isPartial ? Math.round(avgCost * quantity) : eligCost;
  const recognizedTotal = Math.round(quantity * p.unitPrice);

  const lots: LotAllocation[] = [];
  let costLeft = totalCostSold;
  let recLeft = recognizedTotal;
  let recvLeft = received;
  const active = eligible.map((l, i) => ({ l, q: qs[i] })).filter((x) => x.q > 1e-9);
  active.forEach((x, k) => {
    const last = k === active.length - 1;
    const full = x.q >= qtyOf(x.l) - 1e-9;
    let cost = full ? x.l.initialCost : Math.round(avgCost * x.q);
    cost = Math.min(cost, x.l.initialCost);
    let rec = Math.round(x.q * p.unitPrice);
    let recv = Math.round((received * x.q) / quantity);
    if (last) {
      // phần dư làm tròn dồn vào lô cuối để tổng khớp đúng
      rec = recLeft;
      recv = recvLeft;
      if (isPartial) cost = Math.min(x.l.initialCost, Math.max(0, costLeft));
    }
    costLeft -= cost;
    recLeft -= rec;
    recvLeft -= recv;
    lots.push({ assetId: x.l.id, assetName: x.l.name, quantity: x.q, costSold: cost, recognized: rec, received: recv });
  });
  const costSold = lots.reduce((s, l) => s + l.costSold, 0);
  return {
    key: pos.key,
    symbol: pos.symbol,
    totalUnits,
    quantity,
    isPartial,
    avgCost,
    costSold,
    recognized: recognizedTotal,
    fees: recognizedTotal - received,
    realizedPnL: received - costSold,
    lots,
  };
}

const stamp = (before: CashTransaction[], after: CashTransaction[], groupId: string): CashTransaction[] => {
  const known = new Set(before.map((t) => t.id));
  return after.map((t) => (known.has(t.id) ? t : { ...t, groupId }));
};

export function applySellPosition(state: UserFinancialState, p: PositionSellInput, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const dateErr = checkTxDate(p.date, undefined, today);
  if (dateErr) return fail(dateErr);
  const pv = previewSellPosition(state, p);
  if (typeof pv === 'string') return fail(pv);
  const groupId = uid('grp');
  let cur = state;
  for (const lot of pv.lots) {
    const asset = cur.assets.find((a) => a.id === lot.assetId)!;
    const input: SellInput = {
      assetId: lot.assetId,
      quantity: lot.quantity >= qtyOf(asset) - 1e-9 ? undefined : lot.quantity,
      unitPrice: p.unitPrice,
      received: lot.received,
      date: p.date,
      note: p.note ? `${p.note} · Bán theo vị thế ${pv.symbol}` : `Bán theo vị thế ${pv.symbol}`,
      repriceRemainder: p.repriceRemainder,
      costBasisSold: lot.costSold,
    };
    const before = cur.transactions;
    const r = applySell(cur, input, uid, today);
    if (!r.ok) return fail(`Lô ${lot.assetName}: ${r.error}`);
    cur = { ...r.state, transactions: stamp(before, r.state.transactions, groupId) };
  }
  return { ok: true, state: cur };
}

// ---------------------------------------------------------------- Cổ tức theo vị thế
export function applyPositionDividend(state: UserFinancialState, p: { key: string; amount: number; date: string; note?: string }, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const pos = buildPositions(state.assets).find((x) => x.key === p.key);
  if (!pos || pos.category !== 'stock') return fail('Chỉ ghi cổ tức cho vị thế cổ phiếu.');
  if (!(p.amount > 0) || !Number.isFinite(p.amount)) return fail('Số tiền cổ tức phải lớn hơn 0.');
  const eligible = pos.lots.filter((l) => l.purchaseDate <= p.date);
  if (eligible.length === 0) return fail('Chưa có lô nào được mua tính đến ngày nhận cổ tức.');
  const total = Math.round(p.amount);
  const caps = eligible.map(qtyOf);
  const sum = caps.reduce((s, x) => s + x, 0);
  const shares = caps.map((c) => Math.floor((total * c) / sum));
  let left = total - shares.reduce((s, x) => s + x, 0);
  const order = caps.map((c, i) => ({ i, r: (total * c) / sum - Math.floor((total * c) / sum) })).sort((a, b) => b.r - a.r);
  for (const o of order) {
    if (left <= 0) break;
    shares[o.i] += 1;
    left--;
  }
  const groupId = uid('grp');
  let cur = state;
  eligible.forEach((lot, i) => {
    if (shares[i] <= 0) return;
    const before = cur.transactions;
    const r = applyIncome(cur, { type: 'dividend', assetId: lot.id, amount: shares[i], date: p.date, note: p.note ? `${p.note} · chia theo số lượng` : 'Chia theo số lượng cổ phiếu' }, uid, today);
    if (r.ok) cur = { ...r.state, transactions: stamp(before, r.state.transactions, groupId) };
  });
  if (cur === state) return fail('Không ghi được cổ tức.');
  return { ok: true, state: cur };
}

// ---------------------------------------------------------------- Hủy theo nhóm
/** Hủy cả nhóm giao dịch cùng một thao tác theo vị thế; nếu một dòng không hủy được thì không hủy dòng nào. */
export function applyVoidGroup(state: UserFinancialState, groupId: string, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const members = state.transactions.filter((t) => t.groupId === groupId && isLiveTx(t));
  if (members.length === 0) return fail('Không tìm thấy nhóm giao dịch hoặc đã hủy.');
  let cur = state;
  for (const t of members) {
    const chk = canVoidTx(cur, t.id);
    if (!chk.ok) return fail(`${t.title}: ${chk.reason || 'không hủy được'}`);
    const r = applyVoidTx(cur, t.id, uid, today);
    if (!r.ok) return fail(`${t.title}: ${r.error}`);
    cur = r.state;
  }
  return { ok: true, state: cur };
}

// ---------------------------------------------------------------- Mua thêm (lô mới cùng mã)
export interface BuyMoreInput {
  /** Một lô hiện có của vị thế (lấy mã, sàn, giá thị trường hiện tại). */
  assetId: string;
  date: string;
  quantity: number;
  unitPrice: number;
  /** Phí mua (VND), tính vào giá vốn của lô. */
  fee?: number;
  /** Mặc định true: trừ ví. false = lô có từ trước khi dùng app (không trừ ví, tính vào số dư ban đầu). */
  deductFromWallet?: boolean;
  note?: string;
}

export function applyBuyMore(state: UserFinancialState, p: BuyMoreInput, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const src = state.assets.find((a) => a.id === p.assetId);
  if (!src || src.status !== 'active') return fail('Không tìm thấy lô đang giữ để mua thêm.');
  const spec = UNIT[src.category];
  if (!spec) return fail('Chỉ cổ phiếu, chứng chỉ quỹ và vàng có “Mua thêm”. Nhà, xe: thêm tài sản mới hoặc ghi chi phí cải tạo.');
  const dateErr = checkTxDate(p.date, undefined, today);
  if (dateErr) return fail(dateErr);
  if (!(p.quantity > 0) || !Number.isFinite(p.quantity)) return fail('Số lượng phải lớn hơn 0.');
  if (spec.integer && Math.abs(p.quantity - Math.round(p.quantity)) > 1e-9) return fail('Số lượng cổ phiếu phải là số nguyên.');
  if (!(p.unitPrice > 0) || !Number.isFinite(p.unitPrice)) return fail(`Nhập giá mua mỗi ${spec.label}.`);
  const fee = Math.max(0, Math.round(p.fee || 0));
  const principal = Math.round(p.quantity * p.unitPrice);
  const cost = principal + fee;
  const deduct = p.deductFromWallet !== false;
  if (deduct && cost > state.wallet.availableCash) return fail(`Ví chỉ còn ${Math.round(state.wallet.availableCash).toLocaleString('vi-VN')} ₫, không đủ để mua ${cost.toLocaleString('vi-VN')} ₫.`);

  const md = src.metadata as any;
  const price = Number(md[spec.price]) > 0 ? Number(md[spec.price]) : p.unitPrice;
  const lot: Asset = {
    ...src,
    id: uid('asset'),
    initialCost: cost,
    currentValue: Math.round(p.quantity * price),
    purchaseDate: p.date,
    realizedPnL: 0,
    // Lô mới dùng đúng giá của lô gốc nên mang theo ngày của giá đó (không phải hôm nay)
    lastValuationDate: src.lastValuationDate,
    linkedDebtId: undefined,
    preexisting: deduct ? undefined : true,
    openingValue: deduct ? undefined : cost,
    valuationHistory: undefined,
    notes: p.note ? p.note : `Mua thêm ngày ${p.date}`,
    metadata: { ...md, [spec.qty]: p.quantity, [spec.cost]: cost / p.quantity, ...(src.category === 'stock' ? { totalDividendsReceived: 0 } : {}) },
  };
  const tx: CashTransaction | null = deduct
    ? {
        id: uid('tx'),
        date: p.date,
        type: 'buy_asset',
        amount: cost,
        title: `Mua thêm: ${src.name}`,
        linkedAssetId: lot.id,
        note: `${p.quantity.toLocaleString('vi-VN')} ${spec.label} × ${Math.round(p.unitPrice).toLocaleString('vi-VN')} ₫${fee ? ` + phí ${fee.toLocaleString('vi-VN')} ₫` : ''}`,
      }
    : null;
  return {
    ok: true,
    state: {
      ...state,
      wallet: deduct ? { ...state.wallet, availableCash: state.wallet.availableCash - cost } : state.wallet,
      assets: [lot, ...state.assets],
      transactions: tx ? insertTx(state.transactions, tx) : state.transactions,
    },
  };
}

// ---------------------------------------------------------------- Chi phí cải tạo / đầu tư thêm (nhà, xe, tài sản khác)
export interface ImprovementInput {
  assetId: string;
  amount: number;
  date: string;
  note?: string;
  /** Mặc định true: trừ ví. */
  deductFromWallet?: boolean;
  /** Mặc định true: cộng luôn vào giá trị hiện tại (nếu chỉ muốn tăng giá vốn thì tắt, rồi định giá lại sau). */
  addToValue?: boolean;
}

export function applyImprovement(state: UserFinancialState, p: ImprovementInput, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const a = state.assets.find((x) => x.id === p.assetId);
  if (!a || a.status !== 'active') return fail('Không tìm thấy tài sản đang giữ.');
  if (a.category !== 'real_estate' && a.category !== 'other') return fail('Chi phí cải tạo dùng cho nhà, xe và tài sản khác.');
  const dateErr = checkTxDate(p.date, a.purchaseDate, today, 'ngày mua tài sản');
  if (dateErr) return fail(dateErr);
  if (!(p.amount > 0) || !Number.isFinite(p.amount)) return fail('Số tiền phải lớn hơn 0.');
  const amount = Math.round(p.amount);
  const deduct = p.deductFromWallet !== false;
  if (deduct && amount > state.wallet.availableCash) return fail(`Ví chỉ còn ${Math.round(state.wallet.availableCash).toLocaleString('vi-VN')} ₫, không đủ để chi ${amount.toLocaleString('vi-VN')} ₫.`);
  const md: any = { ...(a.metadata as any) };
  if (a.category === 'real_estate') md.purchasePrice = (Number(md.purchasePrice) || a.initialCost) + amount;
  const updated: Asset = {
    ...a,
    initialCost: a.initialCost + amount,
    currentValue: p.addToValue === false ? a.currentValue : a.currentValue + amount,
    lastValuationDate: p.addToValue === false ? a.lastValuationDate : today,
    openingValue: a.preexisting && !deduct ? (a.openingValue || 0) + amount : a.openingValue,
    metadata: md,
  };
  const tx: CashTransaction | null = deduct
    ? { id: uid('tx'), date: p.date, type: 'buy_asset', amount, title: `Chi phí cải tạo / đầu tư thêm: ${a.name}`, linkedAssetId: a.id, note: p.note || 'Cộng vào giá vốn tài sản' }
    : null;
  return {
    ok: true,
    state: {
      ...state,
      wallet: deduct ? { ...state.wallet, availableCash: state.wallet.availableCash - amount } : state.wallet,
      assets: state.assets.map((x) => (x.id === a.id ? updated : x)),
      transactions: tx ? insertTx(state.transactions, tx) : state.transactions,
    },
  };
}
