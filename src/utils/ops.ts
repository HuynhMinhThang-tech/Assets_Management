import { Asset, CashTransaction, Debt, FundUse, UserFinancialState } from '../types/finance';
import { checkPayable, isLiveTx, isOpenItem, savingsCurrentValue, todayLocalStr } from './calculations';
import { ensureTimeline, inferDebtOpening } from './debtCore';
import { insertTx, txEffect } from './ledger';
import { applyRevaluation } from './pricing';

/**
 * Các thao tác ghi sổ dạng hàm thuần: nhận trạng thái cũ → trả về trạng thái mới (hoặc lỗi).
 * Giao diện chỉ gọi các hàm này, nên mọi quy tắc (ngày, tiền ví, hủy bản ghi) được kiểm thử độc lập.
 */
export type OpResult = { ok: true; state: UserFinancialState } | { ok: false; error: string };
export type IdGen = (prefix: string) => string;

const defaultId: IdGen = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fail = (error: string): OpResult => ({ ok: false, error });
const money = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} ₫`;

/** Kiểm tra ngày giao dịch: có thật, không ở tương lai, không sớm hơn mốc tối thiểu (ngày mua / giải ngân). */
export function checkTxDate(date: string, min: string | undefined, today: string, minLabel = 'ngày bắt đầu'): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return 'Chọn ngày giao dịch.';
  if (date > today) return 'Ngày giao dịch không được ở tương lai.';
  if (min && date < min) return `Ngày giao dịch không được sớm hơn ${minLabel} (${min}).`;
  return '';
}

// ---------------------------------------------------------------- Nạp / rút / thu nhập
export function applyDeposit(state: UserFinancialState, amount: number, date: string, note?: string, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  if (!(amount > 0) || !Number.isFinite(amount)) return fail('Số tiền nạp phải lớn hơn 0.');
  const err = checkTxDate(date, undefined, today);
  if (err) return fail(err);
  const tx: CashTransaction = { id: uid('tx'), date, type: 'deposit', amount, title: 'Nạp vốn vào ví đầu tư', note: note || 'Nạp tiền mặt khả dụng' };
  return {
    ok: true,
    state: {
      ...state,
      wallet: { ...state.wallet, availableCash: state.wallet.availableCash + amount, totalDeposited: state.wallet.totalDeposited + amount },
      transactions: insertTx(state.transactions, tx),
    },
  };
}

export function applyWithdraw(state: UserFinancialState, amount: number, date: string, note?: string, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  if (!(amount > 0) || !Number.isFinite(amount)) return fail('Số tiền rút phải lớn hơn 0.');
  const err = checkTxDate(date, undefined, today);
  if (err) return fail(err);
  if (amount > state.wallet.availableCash) return fail(`Ví chỉ còn ${money(state.wallet.availableCash)}, không đủ để rút ${money(amount)}.`);
  const tx: CashTransaction = { id: uid('tx'), date, type: 'withdraw', amount, title: 'Rút vốn từ ví đầu tư', note: note || 'Rút tiền mặt khỏi danh mục' };
  return {
    ok: true,
    state: {
      ...state,
      wallet: { ...state.wallet, availableCash: state.wallet.availableCash - amount, totalWithdrawn: state.wallet.totalWithdrawn + amount },
      transactions: insertTx(state.transactions, tx),
    },
  };
}

export interface IncomeInput {
  type: 'dividend' | 'rental_income' | 'interest_income';
  assetId?: string;
  amount: number;
  date: string;
  note?: string;
}

export function applyIncome(state: UserFinancialState, p: IncomeInput, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  if (!(p.amount > 0) || !Number.isFinite(p.amount)) return fail('Số tiền thu nhập phải lớn hơn 0.');
  const asset = state.assets.find((a) => a.id === p.assetId);
  const err = checkTxDate(p.date, asset?.purchaseDate, today, 'ngày mua tài sản');
  if (err) return fail(err);
  const label = p.type === 'dividend' ? 'Cổ tức' : p.type === 'rental_income' ? 'Tiền thuê' : 'Lãi tiền gửi';
  const tx: CashTransaction = {
    id: uid('tx'),
    date: p.date,
    type: p.type,
    amount: p.amount,
    title: asset ? `${label}: ${asset.name}` : label,
    linkedAssetId: asset?.id,
    note: p.note,
  };
  return {
    ok: true,
    state: {
      ...state,
      wallet: { ...state.wallet, availableCash: state.wallet.availableCash + p.amount },
      transactions: insertTx(state.transactions, tx),
      assets: state.assets.map((a) => {
        if (a.id !== p.assetId) return a;
        if (p.type === 'dividend' && a.category === 'stock')
          return { ...a, metadata: { ...(a.metadata as any), totalDividendsReceived: ((a.metadata as any).totalDividendsReceived || 0) + p.amount } };
        if (p.type === 'interest_income' && a.category === 'savings') {
          // Lãi sổ tiết kiệm đã nhận: không còn nằm trong giá trị sổ
          const withRecv = { ...a, metadata: { ...(a.metadata as any), interestReceived: ((a.metadata as any).interestReceived || 0) + p.amount } };
          return { ...withRecv, currentValue: savingsCurrentValue(withRecv, today), lastValuationDate: today };
        }
        return a;
      }),
    },
  };
}

// ---------------------------------------------------------------- Bán tài sản (R1)
const SELL_UNIT: Record<string, { key: string; label: string } | undefined> = {
  stock: { key: 'quantity', label: 'cổ phiếu' },
  fund: { key: 'units', label: 'CCQ' },
  gold: { key: 'quantityChi', label: 'chỉ' },
};

export const sellUnitOf = (asset: Asset) => SELL_UNIT[asset.category];

export interface SellInput {
  assetId: string;
  /** Số lượng bán (cổ phiếu, CCQ, chỉ). Bỏ trống = bán hết. */
  quantity?: number;
  /** Giá bán mỗi đơn vị (tài sản có đơn vị). */
  unitPrice?: number;
  /** Giá trị ghi nhận của lần bán (tài sản không có đơn vị: bất động sản, khác). */
  recognizedValue?: number;
  /** Số tiền THỰC NHẬN vào ví sau phí/thuế. */
  received: number;
  date: string;
  note?: string;
  /** Cập nhật giá thị trường của phần còn lại theo giá bán này. */
  repriceRemainder?: boolean;
  /**
   * Ghi đè giá vốn của phần bán (VND). Dùng khi bán theo vị thế: giá vốn bình quân cả vị thế được phân bổ cho từng lô.
   * Mặc định (bán riêng một lô): giá vốn theo tỷ lệ của chính lô đó.
   */
  costBasisSold?: number;
}

export interface SellPreview {
  quantity: number;
  totalUnits: number;
  ratio: number;
  isPartial: boolean;
  recognized: number;
  fees: number;
  costSold: number;
  valueSold: number;
  /** Lãi/lỗ sổ sách trước phí = giá trị ghi nhận − giá vốn phần bán. */
  bookPnL: number;
  /** Lãi/lỗ chốt thực tế = thực nhận − giá vốn phần bán. */
  realizedPnL: number;
}

/** Tính trước kết quả bán để hiện trên form và để dùng lại khi ghi sổ. Trả về chuỗi lỗi nếu đầu vào sai. */
export function previewSell(asset: Asset, p: Omit<SellInput, 'assetId' | 'date'>): SellPreview | string {
  if (asset.status !== 'active') return 'Tài sản này đã thanh lý hoặc đã hủy.';
  const spec = SELL_UNIT[asset.category];
  const totalUnits = spec ? Number((asset.metadata as any)[spec.key]) || 0 : 0;
  let quantity = totalUnits;
  let ratio = 1;
  let recognized: number;
  if (spec && totalUnits > 0) {
    quantity = p.quantity && p.quantity > 0 ? p.quantity : totalUnits;
    if (quantity > totalUnits + 1e-9) return `Chỉ có ${totalUnits.toLocaleString('vi-VN')} ${spec.label} để bán.`;
    quantity = Math.min(quantity, totalUnits);
    ratio = quantity / totalUnits;
    if (!(p.unitPrice && p.unitPrice > 0)) return `Nhập giá bán mỗi ${spec.label}.`;
    recognized = Math.round(quantity * p.unitPrice);
  } else {
    recognized = Math.round(p.recognizedValue || 0);
    if (!(recognized > 0)) return 'Nhập giá bán lớn hơn 0.';
  }
  const received = Math.round(p.received);
  if (!(received > 0)) return 'Nhập số tiền thực nhận lớn hơn 0.';
  const isPartial = ratio < 1 - 1e-12;
  let costSold = isPartial ? Math.round(asset.initialCost * ratio) : asset.initialCost;
  if (p.costBasisSold !== undefined) {
    if (!(p.costBasisSold >= 0) || p.costBasisSold > asset.initialCost + 1) return 'Giá vốn phần bán không hợp lệ.';
    costSold = isPartial ? Math.round(p.costBasisSold) : asset.initialCost;
  }
  const valueSold = isPartial ? Math.round(asset.currentValue * ratio) : asset.currentValue;
  return {
    quantity,
    totalUnits,
    ratio,
    isPartial,
    recognized,
    fees: recognized - received,
    costSold,
    valueSold,
    bookPnL: recognized - costSold,
    realizedPnL: received - costSold,
  };
}

export function applySell(state: UserFinancialState, p: SellInput, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const asset = state.assets.find((a) => a.id === p.assetId);
  if (!asset) return fail('Không tìm thấy tài sản.');
  const dateErr = checkTxDate(p.date, asset.purchaseDate, today, 'ngày mua tài sản');
  if (dateErr) return fail(dateErr);
  const pv = previewSell(asset, p);
  if (typeof pv === 'string') return fail(pv);

  const spec = SELL_UNIT[asset.category];
  const received = Math.round(p.received);
  const unitPriced = !!spec && pv.totalUnits > 0;
  const tx: CashTransaction = {
    id: uid('tx'),
    date: p.date,
    type: 'sell_asset',
    amount: received,
    fees: pv.fees !== 0 ? pv.fees : undefined,
    title: pv.isPartial ? `Bán một phần ${pv.quantity}/${pv.totalUnits}: ${asset.name}` : `Thanh lý tài sản: ${asset.name}`,
    linkedAssetId: asset.id,
    quantity: unitPriced ? pv.quantity : undefined,
    unitPrice: unitPriced ? p.unitPrice : undefined,
    recognizedValue: pv.recognized,
    costBasisSold: pv.costSold,
    valueSold: pv.valueSold,
    realizedPnL: pv.realizedPnL,
    soldOut: !pv.isPartial,
    note: `${p.note || 'Chốt lời về ví'} · Giá vốn phần bán: ${money(pv.costSold)}${pv.fees ? ` · Phí/thuế: ${money(pv.fees)}` : ''} · Lãi/lỗ thực tế: ${money(pv.realizedPnL)}`,
  };

  let updated: Asset;
  if (pv.isPartial) {
    updated = {
      ...asset,
      initialCost: asset.initialCost - pv.costSold,
      currentValue: asset.currentValue - pv.valueSold,
      realizedPnL: (asset.realizedPnL || 0) + pv.realizedPnL,
      // Ngày định giá là ngày của GIÁ đang dùng; bán một phần không đổi giá phần còn lại nên giữ nguyên
      // (đặt = hôm nay sẽ khiến giá đóng cửa của những ngày trước bị coi là cũ hơn và bị chặn).
      lastValuationDate: asset.lastValuationDate,
      metadata: { ...(asset.metadata as any), [spec!.key]: pv.totalUnits - pv.quantity },
    };
    if (p.repriceRemainder && unitPriced && p.unitPrice) updated = applyRevaluation(updated, { unitPrice: p.unitPrice }, p.date);
  } else {
    updated = { ...asset, status: 'sold', currentValue: 0, realizedPnL: (asset.realizedPnL || 0) + pv.realizedPnL };
  }

  return {
    ok: true,
    state: {
      ...state,
      wallet: { ...state.wallet, availableCash: state.wallet.availableCash + received },
      assets: state.assets.map((a) => (a.id === asset.id ? updated : a)),
      transactions: insertTx(state.transactions, tx),
    },
  };
}

// ---------------------------------------------------------------- Trả kỳ nợ
export interface PayInput {
  debtId: string;
  periodIndex: number;
  deductFromWallet: boolean;
  date: string;
}

export function applyPayPeriod(state: UserFinancialState, p: PayInput, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const debt = state.debts.find((d) => d.id === p.debtId);
  if (!debt || !debt.schedule || !debt.schedule[p.periodIndex]) return fail('Không tìm thấy kỳ trả nợ.');
  const si = debt.schedule[p.periodIndex];
  if (si.isPaid) return fail('Kỳ này đã được ghi nhận trả.');
  const dateErr = checkTxDate(p.date, debt.startDate, today, 'ngày giải ngân');
  if (dateErr) return fail(dateErr);
  const prev = p.periodIndex > 0 ? debt.schedule[p.periodIndex - 1] : undefined;
  if (prev?.isPaid && prev.paidDate && p.date < prev.paidDate)
    return fail(`Ngày thanh toán không được sớm hơn ngày trả kỳ trước (${prev.paidDate}).`);
  // Mỗi tháng chỉ trả một kỳ: tính theo THÁNG CỦA NGÀY THANH TOÁN (nhập bù kỳ cũ vẫn đúng quy tắc)
  const chk = checkPayable(debt, p.periodIndex, p.date);
  if (!chk.ok) {
    if (chk.reason === 'out_of_order') return fail(`Hãy thanh toán kỳ #${debt.schedule[debt.schedule.findIndex(isOpenItem)].period} trước. Các kỳ phải được ghi nhận theo thứ tự.`);
    if (chk.reason === 'month_locked') return fail(`Kỳ #${si.period} đến hạn ngày ${chk.dueDate}, sẽ mở thanh toán từ ngày ${chk.unlockDate}. Mỗi tháng chỉ trả một kỳ.`);
    return fail('Không thể thanh toán kỳ này.');
  }
  if (p.deductFromWallet && si.totalMonthlyPayment > state.wallet.availableCash)
    return fail(`Ví chỉ còn ${money(state.wallet.availableCash)}, không đủ để trả ${money(si.totalMonthlyPayment)}.`);

  const schedule = [...debt.schedule];
  schedule[p.periodIndex] = { ...si, isPaid: true, paidDate: p.date };
  const remaining = Math.max(0, si.remainingBalance);
  const allPaid = remaining <= 0 || schedule.every((x) => x.isPaid || x.status === 'cancelled');

  let wallet = state.wallet;
  let transactions = state.transactions;
  if (p.deductFromWallet) wallet = { ...wallet, availableCash: wallet.availableCash - si.totalMonthlyPayment };
  // Luôn ghi giao dịch trả nợ (kể cả khi trả bằng tiền ngoài ví: noCash, ví không đổi) để có dấu vết, hủy được và báo cáo đúng.
  transactions = insertTx(transactions, {
    id: uid('tx'),
    date: p.date,
    type: 'debt_payment',
    amount: si.totalMonthlyPayment,
    title: `Trả nợ kỳ #${si.period}: ${debt.name}`,
    linkedDebtId: debt.id,
    periodIndex: p.periodIndex,
    principalPortion: si.principalPayable,
    interestPortion: si.interestPayable,
    noCash: p.deductFromWallet ? undefined : true,
    note: `Gốc: ${money(si.principalPayable)} · Lãi: ${money(si.interestPayable)}${p.deductFromWallet ? '' : ' · Trả bằng tiền ngoài ví'}`,
  });
  return {
    ok: true,
    state: {
      ...state,
      wallet,
      transactions,
      debts: state.debts.map((d) => (d.id === debt.id ? { ...d, remainingPrincipal: remaining, status: allPaid ? 'paid_off' : 'active', schedule } : d)),
    },
  };
}

// ---------------------------------------------------------------- Thêm khoản nợ có nơi dùng vốn (R4)
export function fundUseError(fu: FundUse | undefined, state: UserFinancialState, allowUnspecified = false): string {
  if (!fu) return 'Chọn nơi dùng vốn: tiền vay đã đi đâu.';
  if (fu.kind === 'unspecified') return allowUnspecified ? '' : 'Chọn nơi dùng vốn: tiền vay đã đi đâu.';
  if (fu.kind === 'asset') {
    const a = state.assets.find((x) => x.id === fu.assetId);
    if (!a || a.status !== 'active') return 'Chọn tài sản được mua bằng vốn vay.';
    if (a.linkedDebtId && state.debts.some((d) => d.id === a.linkedDebtId && d.status === 'active'))
      return 'Tài sản này đã gắn với một khoản vay khác.';
  }
  return '';
}

/** Tài sản đã sở hữu từ trước nhưng chưa nhập vào app (tạo cùng lúc với khoản vay, KHÔNG trừ ví). */
export interface PreexistingAssetInput {
  name: string;
  /** Giá trị hiện tại của tài sản (VND). */
  value: number;
  kind: 'real_estate' | 'vehicle' | 'other';
  /** Ngày mua thực tế (mặc định hôm nay). */
  purchaseDate?: string;
  /** Dùng làm tài sản thế chấp của khoản vay này. */
  collateral?: boolean;
}

export interface AddDebtOptions {
  /** (nơi dùng vốn = vào ví) Cộng tiền vay vào ví và ghi dòng giải ngân. Mặc định: chỉ ghi nợ, ví không đổi. */
  disburseToWallet?: boolean;
  /** Tạo luôn tài sản đối ứng "đã sở hữu từ trước": không trừ ví, tính vào số dư ban đầu. Ghi đè nơi dùng vốn thành "mua tài sản". */
  preexistingAsset?: PreexistingAssetInput;
  /** Cho lưu khi chưa rõ nơi dùng vốn (sẽ nhắc bổ sung sau). */
  allowUnspecified?: boolean;
}

export function buildPreexistingAsset(p: PreexistingAssetInput, id: string, today: string): Asset {
  const date = p.purchaseDate || today;
  const metadata: any =
    p.kind === 'real_estate'
      ? { address: '', propertyType: 'apartment', areaM2: 0, purchasePrice: p.value, estimatedMarketPrice: p.value, monthlyRentalIncome: 0, legalStatus: 'red_book' }
      : { itemType: p.kind === 'vehicle' ? 'Xe' : 'Tài sản khác', details: '' };
  return {
    id,
    name: p.name.trim(),
    category: p.kind === 'real_estate' ? 'real_estate' : 'other',
    initialCost: p.value,
    currentValue: p.value,
    purchaseDate: date,
    status: 'active',
    metadata,
    realizedPnL: 0,
    lastValuationDate: today,
    preexisting: true,
    openingValue: p.value,
    notes: 'Đã sở hữu từ trước khi dùng app (không trừ ví).',
  };
}

export function applyAddDebt(state: UserFinancialState, debt: Debt, opts: AddDebtOptions = {}, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  if (!(debt.principalAmount > 0)) return fail('Số tiền vay phải lớn hơn 0.');
  let working = state;
  let debtIn: Debt = debt;
  if (opts.preexistingAsset) {
    const pa = opts.preexistingAsset;
    if (!pa.name || !pa.name.trim()) return fail('Nhập tên tài sản đã có từ trước.');
    if (!(pa.value > 0)) return fail('Nhập giá trị hiện tại của tài sản lớn hơn 0.');
    if (pa.purchaseDate) {
      const e = checkTxDate(pa.purchaseDate, undefined, today, 'ngày mua');
      if (e) return fail(e);
    }
    const asset = buildPreexistingAsset(pa, uid('asset'), today);
    working = { ...state, assets: [asset, ...state.assets] };
    debtIn = {
      ...debt,
      fundUse: { kind: 'asset', assetId: asset.id },
      collateralAssetId: pa.collateral ? asset.id : debt.collateralAssetId,
      securityType: pa.collateral ? 'secured' : debt.securityType,
    };
  }
  const fuErr = fundUseError(debtIn.fundUse, working, opts.allowUnspecified);
  if (fuErr) return fail(fuErr);
  const fu: FundUse = { ...debtIn.fundUse! };
  let wallet = working.wallet;
  let transactions = working.transactions;
  let assets = working.assets;

  if (fu.kind === 'wallet') {
    if (opts.disburseToWallet) {
      const dateErr = checkTxDate(debtIn.startDate, undefined, today);
      if (dateErr) return fail('Chỉ ghi dòng giải ngân khi ngày giải ngân là hôm nay hoặc đã qua. ' + dateErr);
      wallet = { ...wallet, availableCash: wallet.availableCash + debtIn.principalAmount };
      transactions = insertTx(transactions, {
        id: uid('tx'),
        date: debtIn.startDate,
        type: 'loan_disbursement',
        amount: debtIn.principalAmount,
        title: `Giải ngân khoản vay: ${debtIn.name}`,
        linkedDebtId: debtIn.id,
        note: `${debtIn.lender} giải ngân vào ví đầu tư`,
      });
      fu.cashRecorded = true;
    } else {
      fu.cashRecorded = undefined;
    }
  }
  if (fu.kind === 'asset') {
    assets = assets.map((a) => (a.id === fu.assetId ? { ...a, linkedDebtId: debtIn.id } : a));
  }
  const withFu: Debt = { ...debtIn, fundUse: fu };
  const opening = withFu.openingBalance ?? inferDebtOpening(withFu);
  const finalDebt: Debt = { ...withFu, rateTimeline: ensureTimeline(withFu), openingBalance: opening };
  return { ok: true, state: { ...working, wallet, transactions, assets, debts: [finalDebt, ...working.debts] } };
}

/** Bổ sung nơi dùng vốn cho khoản nợ cũ: chỉ gắn nhãn, KHÔNG đụng tới ví hay dòng tiền. */
export function applySetFundUse(state: UserFinancialState, debtId: string, fu: FundUse): OpResult {
  const debt = state.debts.find((d) => d.id === debtId);
  if (!debt) return fail('Không tìm thấy khoản vay.');
  const err = fundUseError(fu, state);
  if (err) return fail(err);
  const clean: FundUse = { kind: fu.kind, assetId: fu.kind === 'asset' ? fu.assetId : undefined, cashRecorded: debt.fundUse?.cashRecorded && fu.kind === 'wallet' ? true : undefined };
  return {
    ok: true,
    state: {
      ...state,
      debts: state.debts.map((d) => (d.id === debtId ? { ...d, fundUse: clean } : d)),
      assets: state.assets.map((a) => (clean.kind === 'asset' && a.id === clean.assetId && !a.linkedDebtId ? { ...a, linkedDebtId: debtId } : a)),
    },
  };
}

// ---------------------------------------------------------------- Hủy bản ghi nhập nhầm (C2, thay cho nút xóa)
export interface VoidCheck {
  ok: boolean;
  reason?: string;
}
const no = (reason: string): VoidCheck => ({ ok: false, reason });

const VOIDABLE_TX = ['deposit', 'withdraw', 'dividend', 'rental_income', 'interest_income', 'sell_asset', 'debt_payment'];

function paymentIndexOf(debt: Debt, tx: CashTransaction): number {
  if (typeof tx.periodIndex === 'number') return tx.periodIndex;
  const m = /#(\d+)/.exec(tx.title || '');
  return m && debt.schedule ? debt.schedule.findIndex((i) => i.period === Number(m[1])) : -1;
}

/**
 * Giao dịch còn hiệu lực GHI NHẬN SAU CÙNG thỏa điều kiện. Dựa vào `recordedAt` (thời điểm ghi nhận); giao dịch cũ chưa có dấu này
 * coi là ghi trước mọi giao dịch có dấu, và giữa chúng thì theo thứ tự trong sổ (đầu danh sách = mới hơn), như trước đây.
 */
function newestRecorded(list: CashTransaction[], pred: (t: CashTransaction) => boolean): CashTransaction | undefined {
  let best: CashTransaction | undefined;
  for (const t of list) {
    if (!isLiveTx(t) || !pred(t)) continue;
    if (!best) {
      best = t;
      continue;
    }
    const a = t.recordedAt ?? -1;
    const b = best.recordedAt ?? -1;
    if (a > b) best = t;
  }
  return best;
}

export function canVoidTx(state: UserFinancialState, txId: string): VoidCheck {
  const idx = state.transactions.findIndex((t) => t.id === txId);
  if (idx < 0) return no('Không tìm thấy giao dịch.');
  const tx = state.transactions[idx];
  if (tx.status === 'voided' || tx.reversalOf) return no('Dòng này đã được hủy hoặc là bút toán đảo.');
  if (tx.type === 'buy_asset') return no('Giao dịch mua được hủy cùng với tài sản.');
  if (tx.type === 'loan_disbursement') return no('Dòng giải ngân được hủy cùng với khoản vay.');
  if (!VOIDABLE_TX.includes(tx.type)) return no('Loại giao dịch này không thể hủy.');
  if (tx.noVoid) return no(tx.noVoid);

  const effect = txEffect(tx);
  if (effect > 0 && state.wallet.availableCash - effect < 0)
    return no(`Ví chỉ còn ${money(state.wallet.availableCash)}, không đủ để hoàn lại ${money(effect)}.`);

  if (tx.type === 'sell_asset') {
    const asset = state.assets.find((a) => a.id === tx.linkedAssetId);
    if (!asset || asset.status === 'voided') return no('Không tìm thấy tài sản của lần bán này.');
    const newest = newestRecorded(state.transactions, (t) => t.type === 'sell_asset' && t.linkedAssetId === tx.linkedAssetId);
    if (newest && newest.id !== tx.id) return no('Hãy hủy lần bán mới hơn của tài sản này trước.');
    if (typeof tx.costBasisSold !== 'number' || typeof tx.valueSold !== 'number')
      return no('Lần bán này được ghi trước khi có chức năng hủy nên không đủ dữ liệu để hoàn nguyên.');
  }
  if (tx.type === 'debt_payment') {
    const debt = state.debts.find((d) => d.id === tx.linkedDebtId);
    if (!debt || debt.status === 'voided' || !debt.schedule) return no('Không tìm thấy khoản vay của giao dịch này.');
    const newest = newestRecorded(state.transactions, (t) => t.type === 'debt_payment' && t.linkedDebtId === tx.linkedDebtId);
    if (newest && newest.id !== tx.id) return no('Hãy hủy giao dịch trả nợ mới hơn của khoản vay này trước.');
    if (tx.settlement) {
      if (debt.closeReason !== 'early') return no('Khoản vay không còn ở trạng thái tất toán sớm.');
    } else if (tx.prepay) {
      if (debt.status !== 'active') return no('Khoản vay không còn đang vay.');
    } else {
      const pi = paymentIndexOf(debt, tx);
      if (pi < 0 || !debt.schedule[pi]?.isPaid) return no('Kỳ trả này không còn ở trạng thái đã trả.');
      const lastPaid = debt.schedule.reduce((m, it, i) => (it.isPaid ? i : m), -1);
      if (pi !== lastPaid) return no('Hãy hủy kỳ trả mới hơn của khoản vay này trước.');
    }
  }
  return { ok: true };
}

function reversalOf(orig: CashTransaction, today: string, id: string, revId: string): { original: CashTransaction; reversal: CashTransaction } {
  return {
    original: { ...orig, status: 'voided', voidedAt: today, voidedBy: revId },
    reversal: {
      id: revId,
      date: orig.date,
      type: orig.type,
      amount: orig.amount,
      title: `Hủy: ${orig.title}`,
      linkedAssetId: orig.linkedAssetId,
      linkedDebtId: orig.linkedDebtId,
      noCash: orig.noCash,
      note: `Bút toán đảo · hủy ngày ${today}`,
      reversalOf: id,
    },
  };
}

/** Ghi đè dòng gốc đã hủy và chèn bút toán đảo; trả về danh sách mới + thay đổi ví do đảo chiều. */
function postReversal(txs: CashTransaction[], origId: string, today: string, uid: IdGen): { txs: CashTransaction[]; walletDelta: number; orig: CashTransaction } {
  const orig = txs.find((t) => t.id === origId)!;
  const { original, reversal } = reversalOf(orig, today, orig.id, uid('tx'));
  const replaced = txs.map((t) => (t.id === orig.id ? original : t));
  return { txs: insertTx(replaced, reversal), walletDelta: -txEffect(orig), orig };
}

export function applyVoidTx(state: UserFinancialState, txId: string, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const chk = canVoidTx(state, txId);
  if (!chk.ok) return fail(chk.reason || 'Không thể hủy giao dịch này.');
  const { txs, walletDelta, orig } = postReversal(state.transactions, txId, today, uid);
  let wallet = { ...state.wallet, availableCash: state.wallet.availableCash + walletDelta };
  let assets = state.assets;
  let debts = state.debts;

  if (orig.type === 'deposit') wallet.totalDeposited -= orig.amount;
  if (orig.type === 'withdraw') wallet.totalWithdrawn -= orig.amount;

  if (orig.type === 'dividend') {
    assets = assets.map((a) =>
      a.id === orig.linkedAssetId && a.category === 'stock'
        ? { ...a, metadata: { ...(a.metadata as any), totalDividendsReceived: Math.max(0, ((a.metadata as any).totalDividendsReceived || 0) - orig.amount) } }
        : a
    );
  }

  if (orig.type === 'interest_income') {
    assets = assets.map((a) => {
      if (a.id !== orig.linkedAssetId || a.category !== 'savings') return a;
      const back = { ...a, metadata: { ...(a.metadata as any), interestReceived: Math.max(0, ((a.metadata as any).interestReceived || 0) - orig.amount) } };
      return { ...back, currentValue: savingsCurrentValue(back, today), lastValuationDate: today };
    });
  }

  if (orig.type === 'sell_asset') {
    assets = assets.map((a) => {
      if (a.id !== orig.linkedAssetId) return a;
      const spec = SELL_UNIT[a.category];
      const restored: Asset = {
        ...a,
        currentValue: a.currentValue + (orig.valueSold || 0),
        realizedPnL: (a.realizedPnL || 0) - (orig.realizedPnL || 0),
      };
      if (orig.soldOut) {
        restored.status = 'active';
      } else {
        restored.initialCost = a.initialCost + (orig.costBasisSold || 0);
        if (spec) restored.metadata = { ...(a.metadata as any), [spec.key]: (Number((a.metadata as any)[spec.key]) || 0) + (orig.quantity || 0) };
      }
      return restored;
    });
  }

  if (orig.type === 'debt_payment' && orig.settlement) {
    debts = debts.map((d) => {
      if (d.id !== orig.linkedDebtId || !d.schedule) return d;
      const schedule = d.schedule.map((it, i) => {
        if (!orig.settlement!.cancelled.includes(i)) return it;
        const { status: _s, ...rest } = it;
        return rest as typeof it;
      });
      const { closedDate: _c, closeReason: _r, ...keep } = d;
      return { ...keep, status: 'active', remainingPrincipal: orig.settlement!.balanceBefore, schedule } as Debt;
    });
  } else if (orig.type === 'debt_payment' && orig.prepay) {
    debts = debts.map((d) => {
      if (d.id !== orig.linkedDebtId || !d.schedule) return d;
      const schedule = d.schedule.map((it) => ({ ...it }));
      for (const i of orig.prepay!.cancelled) {
        const { status: _s, ...rest } = schedule[i];
        schedule[i] = rest as (typeof schedule)[number];
      }
      for (const [i, principal, interest, remaining, accrualFrom] of orig.prepay!.itemsBefore) {
        const { segments: _g, accrualFrom: _a, ...rest } = schedule[i];
        schedule[i] = { ...rest, principalPayable: principal, interestPayable: interest, totalMonthlyPayment: principal + interest, remainingBalance: remaining, ...(accrualFrom ? { accrualFrom } : {}) };
      }
      return { ...d, remainingPrincipal: orig.prepay!.balanceBefore, schedule };
    });
  } else if (orig.type === 'debt_payment') {
    debts = debts.map((d) => {
      if (d.id !== orig.linkedDebtId || !d.schedule) return d;
      const pi = paymentIndexOf(d, orig);
      const si = d.schedule[pi];
      const schedule = [...d.schedule];
      const { paidDate: _drop, ...rest } = si;
      schedule[pi] = { ...rest, isPaid: false };
      return { ...d, status: 'active', remainingPrincipal: si.remainingBalance + si.principalPayable, schedule };
    });
  }

  return { ok: true, state: { ...state, wallet, assets, debts, transactions: txs } };
}

export function canVoidAsset(state: UserFinancialState, assetId: string): VoidCheck {
  const a = state.assets.find((x) => x.id === assetId);
  if (!a) return no('Không tìm thấy tài sản.');
  if (a.status === 'voided') return no('Tài sản này đã được hủy.');
  if (a.status === 'sold') return no('Tài sản đã thanh lý: hãy hủy lần bán trong Ví & Dòng tiền nếu nhập nhầm.');
  const related = state.transactions.filter((t) => isLiveTx(t) && t.linkedAssetId === assetId);
  if (related.some((t) => t.type !== 'buy_asset')) return no('Tài sản đã phát sinh giao dịch (bán, cổ tức, thu nhập). Hãy hủy các giao dịch đó trước.');
  const debt = state.debts.find((d) => d.status === 'active' && (d.collateralAssetId === assetId || d.fundUse?.assetId === assetId || a.linkedDebtId === d.id));
  if (debt) return no(`Tài sản đang liên kết với khoản vay "${debt.name}". Hãy hủy khoản vay nhập nhầm trước.`);
  return { ok: true };
}

export function applyVoidAsset(state: UserFinancialState, assetId: string, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const chk = canVoidAsset(state, assetId);
  if (!chk.ok) return fail(chk.reason || 'Không thể hủy tài sản này.');
  let txs = state.transactions;
  let delta = 0;
  for (const t of state.transactions.filter((x) => isLiveTx(x) && x.type === 'buy_asset' && x.linkedAssetId === assetId)) {
    const r = postReversal(txs, t.id, today, uid);
    txs = r.txs;
    delta += r.walletDelta;
  }
  return {
    ok: true,
    state: {
      ...state,
      wallet: { ...state.wallet, availableCash: state.wallet.availableCash + delta },
      transactions: txs,
      assets: state.assets.map((a) => (a.id === assetId ? { ...a, status: 'voided', voidedAt: today } : a)),
    },
  };
}

export function canVoidDebt(state: UserFinancialState, debtId: string): VoidCheck {
  const d = state.debts.find((x) => x.id === debtId);
  if (!d) return no('Không tìm thấy khoản vay.');
  if (d.status === 'voided') return no('Khoản vay này đã được hủy.');
  if (d.status === 'paid_off') return no('Khoản vay đã tất toán: hãy hủy các kỳ trả trước nếu nhập nhầm.');
  const related = state.transactions.filter((t) => isLiveTx(t) && t.linkedDebtId === debtId);
  if (related.some((t) => t.type === 'debt_payment')) return no('Khoản vay đã ghi nhận trả nợ. Hãy hủy các kỳ đã trả trước.');
  const refund = related.filter((t) => t.type === 'loan_disbursement').reduce((s, t) => s + t.amount, 0);
  if (refund > state.wallet.availableCash) return no(`Ví chỉ còn ${money(state.wallet.availableCash)}, không đủ để hoàn lại ${money(refund)} tiền giải ngân.`);
  return { ok: true };
}

export function applyVoidDebt(state: UserFinancialState, debtId: string, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const chk = canVoidDebt(state, debtId);
  if (!chk.ok) return fail(chk.reason || 'Không thể hủy khoản vay này.');
  let txs = state.transactions;
  let delta = 0;
  for (const t of state.transactions.filter((x) => isLiveTx(x) && x.type === 'loan_disbursement' && x.linkedDebtId === debtId)) {
    const r = postReversal(txs, t.id, today, uid);
    txs = r.txs;
    delta += r.walletDelta;
  }
  return {
    ok: true,
    state: {
      ...state,
      wallet: { ...state.wallet, availableCash: state.wallet.availableCash + delta },
      transactions: txs,
      debts: state.debts.map((d) => (d.id === debtId ? { ...d, status: 'voided', voidedAt: today } : d)),
      assets: state.assets.map((a) => (a.linkedDebtId === debtId ? { ...a, linkedDebtId: undefined } : a)),
    },
  };
}
