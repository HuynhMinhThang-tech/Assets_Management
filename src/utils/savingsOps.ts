import { CashTransaction, SavingsMetadata, UserFinancialState } from '../types/finance';
import { addMonthsStr, savingsCurrentValue, todayLocalStr } from './calculations';
import { insertTx } from './ledger';
import { applyIncome, checkTxDate, IdGen, OpResult } from './ops';
import { MAX_RATE, MAX_TENOR_MONTHS } from './validation';

/** Thao tác trên sổ tiết kiệm (C4): nhận lãi, tái tục. Rút tiền dùng luồng bán/thanh lý của tài sản. */
const defaultId: IdGen = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fail = (error: string): OpResult => ({ ok: false, error });

/** Nhận lãi tiết kiệm: cộng ví + ghi thu nhập lãi gắn với sổ; lãi đã nhận không còn nằm trong giá trị sổ. */
export function applyReceiveSavingsInterest(
  state: UserFinancialState,
  p: { assetId: string; amount: number; date: string; note?: string },
  uid: IdGen = defaultId,
  today = todayLocalStr()
): OpResult {
  const a = state.assets.find((x) => x.id === p.assetId);
  if (!a || a.category !== 'savings') return fail('Không tìm thấy sổ tiết kiệm.');
  if (a.status !== 'active') return fail('Sổ tiết kiệm này không còn đang gửi.');
  return applyIncome(state, { type: 'interest_income', assetId: p.assetId, amount: p.amount, date: p.date, note: p.note || 'Nhận lãi tiết kiệm' }, uid, today);
}

export interface RolloverInput {
  assetId: string;
  /** Ngày tái tục: từ ngày đáo hạn trở đi, không ở tương lai. */
  date: string;
  /** Lãi thực nhận của kỳ gửi vừa qua (số do ngân hàng đưa); 0 nếu đã nhận hết trước đó. */
  interest: number;
  /** true = nhập lãi vào gốc (tái tục gốc + lãi); false = lãi về ví, chỉ tái tục gốc. */
  capitalize: boolean;
  termMonths: number;
  annualRate: number;
}

/**
 * Tái tục sổ tiết kiệm: ghi lãi kỳ vừa qua là thu nhập (cộng ví); nếu nhập lãi vào gốc thì ghi thêm một dòng
 * đầu tư lại cùng ngày (ví không đổi ròng). Sau đó mở kỳ gửi mới với kỳ hạn và lãi suất mới.
 */
export function applyRollover(state: UserFinancialState, p: RolloverInput, uid: IdGen = defaultId, today = todayLocalStr()): OpResult {
  const a = state.assets.find((x) => x.id === p.assetId);
  if (!a || a.category !== 'savings') return fail('Không tìm thấy sổ tiết kiệm.');
  if (a.status !== 'active') return fail('Sổ tiết kiệm này không còn đang gửi.');
  const m = a.metadata as SavingsMetadata;
  const dateErr = checkTxDate(p.date, a.purchaseDate, today, 'ngày gửi');
  if (dateErr) return fail(dateErr);
  if (m.maturityDate && p.date < m.maturityDate) return fail(`Chỉ tái tục từ ngày đáo hạn (${m.maturityDate}). Muốn lấy tiền trước hạn hãy chọn Rút.`);
  if (!(p.termMonths >= 1) || p.termMonths > MAX_TENOR_MONTHS) return fail('Nhập kỳ hạn mới (số tháng).');
  if (!(p.annualRate >= 0) || p.annualRate > MAX_RATE) return fail(`Lãi suất phải trong khoảng 0% – ${MAX_RATE}%/năm.`);
  const interest = Math.max(0, Math.round(p.interest || 0));

  let next = state;
  const lock = 'Giao dịch sinh ra từ tái tục sổ tiết kiệm nên không hủy riêng được.';
  if (interest > 0) {
    const existing = new Set(next.transactions.map((t) => t.id));
    const r = applyIncome(next, { type: 'interest_income', assetId: a.id, amount: interest, date: p.date, note: 'Lãi kỳ gửi vừa tái tục' }, uid, today);
    if (!r.ok) return r;
    next = { ...r.state, transactions: r.state.transactions.map((t) => (existing.has(t.id) ? t : { ...t, noVoid: lock })) };
    if (p.capitalize) {
      const reinvest: CashTransaction = {
        id: uid('tx'),
        date: p.date,
        type: 'buy_asset',
        amount: interest,
        title: `Nhập lãi vào gốc: ${a.name}`,
        linkedAssetId: a.id,
        note: 'Tái tục gốc + lãi',
        noVoid: lock,
      };
      next = { ...next, wallet: { ...next.wallet, availableCash: next.wallet.availableCash - interest }, transactions: insertTx(next.transactions, reinvest) };
    }
  }

  const cur = next.assets.find((x) => x.id === a.id)!;
  const cm = cur.metadata as SavingsMetadata;
  const principal = (cm.depositAmount || cur.initialCost) + (p.capitalize ? interest : 0);
  const renewed = {
    ...cur,
    initialCost: cur.initialCost + (p.capitalize ? interest : 0),
    metadata: {
      ...cm,
      depositAmount: principal,
      startDate: p.date,
      termMonths: p.termMonths,
      annualInterestRate: p.annualRate,
      maturityDate: addMonthsStr(p.date, p.termMonths),
      interestReceived: 0,
    } as SavingsMetadata,
  };
  const refreshed = { ...renewed, currentValue: savingsCurrentValue(renewed, today), lastValuationDate: today };
  return { ok: true, state: { ...next, assets: next.assets.map((x) => (x.id === a.id ? refreshed : x)) } };
}
