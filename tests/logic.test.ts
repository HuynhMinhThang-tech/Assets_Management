/**
 * Logic tests: assert REAL-WORLD expected behaviour of the finance engine.
 * Run: npx tsx tests/logic.test.ts   (TZ env var changes the timezone)
 */
import {
  generateAmortizationSchedule, recalculateFloatingDebt, getNextDuePayment,
  calculateFinancialSummary, calculateCollateralMetrics, formatVND,
  applyHistoricalPayments, todayLocalStr, getSavingsAccrual, getUpcomingMaturities, dueDateFor,
} from '../src/utils/calculations';
import { INITIAL_DEMO_STATE, loadFinancialState, normalizeState, clearFinancialState, consumeLoadWarning } from '../src/utils/storage';
import type { Debt } from '../src/types/finance';

let pass = 0, fail = 0; const failures: string[] = [];
function t(id: string, name: string, fn: () => true | string) {
  let r: true | string;
  try { r = fn(); } catch (e: any) { r = 'THROW ' + e.message; }
  if (r === true) { pass++; console.log(`PASS ${id} ${name}`); }
  else { fail++; failures.push(`${id} ${name} -> ${r}`); console.log(`FAIL ${id} ${name}\n       ${r}`); }
}
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

// ---- localStorage mock for storage.ts
const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
};

console.log('TZ =', process.env.TZ || 'default', ' now =', new Date().toString());

// ================= AMORTIZATION =================
t('A1', 'declining: sum(principal)=gốc, dư nợ cuối = 0, lãi kỳ 1 = gốc*r', () => {
  const s = generateAmortizationSchedule(120_000_000, 12, 12, '2026-01-10', 10, 'declining_balance');
  if (s.length !== 12) return `len ${s.length}`;
  if (sum(s.map(x => x.principalPayable)) !== 120_000_000) return 'sum principal ' + sum(s.map(x => x.principalPayable));
  if (s[11].remainingBalance !== 0) return 'final balance ' + s[11].remainingBalance;
  if (s[0].interestPayable !== 1_200_000) return 'interest1 ' + s[0].interestPayable;
  return true;
});
t('A2', 'annuity: tổng gốc = gốc vay, kỳ cuối về 0, trả đều ±(làm tròn)', () => {
  const s = generateAmortizationSchedule(500_000_000, 8.8, 60, '2023-08-10', 5, 'equal_payment');
  if (sum(s.map(x => x.principalPayable)) !== 500_000_000) return 'sum ' + sum(s.map(x => x.principalPayable));
  const pm = s.slice(0, 59).map(x => x.totalMonthlyPayment);
  if (Math.max(...pm) - Math.min(...pm) > 2) return 'payments not level ' + [Math.min(...pm), Math.max(...pm)];
  // closed form check
  const r = 0.088 / 12, n = 60, M = 500_000_000 * r * (1 + r) ** n / ((1 + r) ** n - 1);
  if (Math.abs(M - s[0].totalMonthlyPayment) > 2) return `M ${M} vs ${s[0].totalMonthlyPayment}`;
  return true;
});
t('A3', 'annuity lãi suất 0%', () => {
  const s = generateAmortizationSchedule(12_000_000, 0, 12, '2026-01-10', 10, 'equal_payment');
  return s.length === 12 && s[0].totalMonthlyPayment === 1_000_000 && s[11].remainingBalance === 0 ? true : JSON.stringify(s[0]);
});
t('A4', 'ngày bắt đầu 31/01 → kỳ 1 phải rơi vào THÁNG 2 (không nhảy sang tháng 3)', () => {
  const s = generateAmortizationSchedule(100_000_000, 10, 6, '2026-01-31', 15, 'declining_balance');
  return s[0].dueDate.startsWith('2026-02') ? true : `kỳ 1 = ${s[0].dueDate}, kỳ 2 = ${s[1].dueDate}`;
});
t('A5', 'ngày trả 31 hàng tháng phải = ngày cuối tháng (không bị ép về 28)', () => {
  const s = generateAmortizationSchedule(100_000_000, 10, 4, '2026-01-05', 31, 'declining_balance');
  // kỳ 1 = 28/02/2026 hợp lệ (cuối tháng 2); kỳ 2 phải = 31/03/2026
  return s[1].dueDate === '2026-03-31' ? true : `kỳ 2 = ${s[1].dueDate}`;
});
t('A6', 'ngày trả 29/30 được tôn trọng (không ép 28)', () => {
  const s = generateAmortizationSchedule(100_000_000, 10, 4, '2026-03-05', 30, 'declining_balance');
  return s[0].dueDate === '2026-04-30' ? true : `kỳ 1 = ${s[0].dueDate}`;
});
t('A7', 'ngày đến hạn không lệch 1 ngày theo múi giờ', () => {
  const s = generateAmortizationSchedule(100_000_000, 10, 3, '2026-05-10', 10, 'declining_balance');
  return s.map(x => x.dueDate).join() === '2026-06-10,2026-07-10,2026-08-10' ? true : s.map(x => x.dueDate).join();
});
t('A8', 'ân hạn gốc 6 tháng: 6 kỳ đầu chỉ trả lãi, tổng gốc vẫn = gốc vay', () => {
  const s = generateAmortizationSchedule(600_000_000, 12, 24, '2026-01-10', 10, 'declining_balance', 6);
  const g = s.slice(0, 6).every(x => x.principalPayable === 0 && x.interestPayable === 6_000_000);
  const ok = sum(s.map(x => x.principalPayable)) === 600_000_000 && s[23].remainingBalance === 0;
  return g && ok ? true : JSON.stringify({ g, sumP: sum(s.map(x => x.principalPayable)) });
});
t('A9', '[KNOWN GAP – roadmap] lãi suất ưu đãi (preferentialMonths) ảnh hưởng lịch trả', () => {
  const d = INITIAL_DEMO_STATE.debts[0];
  const s = generateAmortizationSchedule(d.principalAmount, d.annualInterestRate, d.tenorMonths, d.startDate, d.paymentDayOfMonth, d.method);
  // nếu có ưu đãi 12 tháng thì lãi tháng 1 và tháng 13 theo cùng dư nợ phải khác tỷ lệ
  const r1 = s[0].interestPayable / 1_800_000_000, r13 = s[12].interestPayable / s[11].remainingBalance;
  return Math.abs(r1 - r13) > 1e-6 ? true : `preferentialMonths=${d.preferentialMonths} nhưng lãi suất kỳ 1 và kỳ 13 giống nhau (${(r1*1200).toFixed(2)}%/năm)`;
});

// ================= NEXT DUE / CURRENT-LOAN ENTRY =================
t('B1', 'khoản vay cũ (bắt đầu 2023) nhập qua form: kỳ quá khứ = đã trả, kỳ kế tiếp không quá hạn, Σ gốc chưa trả = dư nợ nhập', () => {
  const sched = generateAmortizationSchedule(500_000_000, 8.8, 60, '2023-08-10', 5, 'equal_payment');
  const base: Debt = { ...INITIAL_DEMO_STATE.debts[1], remainingPrincipal: 265_000_000, schedule: sched };
  const d = applyHistoricalPayments(base, 265_000_000);
  const n = getNextDuePayment(d)!;
  const unpaid = sum(d.schedule!.filter(x => !x.isPaid).map(x => x.principalPayable));
  if (n.daysRemaining < -1) return `quá hạn ${-n.daysRemaining} ngày`;
  if (unpaid !== 265_000_000) return 'Σ gốc chưa trả ' + unpaid;
  return true;
});
t('B2', 'demo: dư nợ lưu (remainingPrincipal) khớp dư nợ theo lịch (schedule)', () => {
  const st = loadFinancialState();
  const bad: string[] = [];
  for (const d of st.debts) {
    const paid = d.schedule!.filter(x => x.isPaid);
    const byS = paid.length ? paid[paid.length - 1].remainingBalance : d.principalAmount;
    const unpaidSum = sum(d.schedule!.filter(x => !x.isPaid).map(x => x.principalPayable));
    if (Math.abs(byS - d.remainingPrincipal) > 1000 || Math.abs(unpaidSum - d.remainingPrincipal) > 5) bad.push(`${d.id}: lưu=${d.remainingPrincipal} lịch=${byS} Σchưa trả=${unpaidSum}`);
  }
  return bad.length ? bad.join(' | ') : true;
});
t('B3', 'demo: kỳ chưa đến hạn không bị đánh dấu "đã trả"', () => {
  const st = loadFinancialState(); const today = new Date().toISOString().slice(0, 10);
  const bad: string[] = [];
  for (const d of st.debts) for (const it of d.schedule!) if (it.isPaid && it.dueDate > today) bad.push(`${d.id} kỳ ${it.period} hạn ${it.dueDate}`);
  return bad.length ? bad.join(' | ') : true;
});
t('B4', 'getNextDuePayment: số ngày còn lại đúng theo lịch', () => {
  const st = loadFinancialState(); const d = st.debts[0]; const n = getNextDuePayment(d)!;
  const exp = Math.round((Date.parse(n.dueDate) - Date.parse(todayLocalStr())) / 864e5);
  return Math.abs(exp - n.daysRemaining) <= 0 ? true : `daysRemaining=${n.daysRemaining} kỳ vọng=${exp}`;
});

// ================= FLOATING RATE =================
t('C1', 'đổi lãi suất thả nổi: tổng gốc các kỳ còn lại = dư nợ mới, về 0 cuối kỳ', () => {
  const st = loadFinancialState(); const d = st.debts[0];
  const r = recalculateFloatingDebt(d, 11.2, undefined, 7.5, 3.7);
  const unpaid = r.schedule!.filter(x => !x.isPaid);
  return sum(unpaid.map(x => x.principalPayable)) === r.remainingPrincipal && unpaid[unpaid.length - 1].remainingBalance === 0
    ? true : `sum=${sum(unpaid.map(x => x.principalPayable))} remaining=${r.remainingPrincipal}`;
});
t('C2', 'đổi lãi suất không làm thay đổi các kỳ đã trả', () => {
  const st = loadFinancialState(); const d = st.debts[0];
  const r = recalculateFloatingDebt(d, 12, undefined);
  const a = JSON.stringify(d.schedule!.filter(x => x.isPaid)), b = JSON.stringify(r.schedule!.filter(x => x.isPaid));
  return a === b ? true : 'kỳ đã trả bị đổi';
});
t('C3', 'trả nợ trước hạn một phần: rút ngắn kỳ hạn / giảm kỳ trả (có tham số)', () => {
  const st = loadFinancialState(); const d = st.debts[0];
  const r = recalculateFloatingDebt(d, d.annualInterestRate, d.remainingPrincipal - 200_000_000);
  const oldN = d.schedule!.filter(x => !x.isPaid).length, newN = r.schedule!.filter(x => !x.isPaid).length;
  return newN === oldN ? true : `số kỳ còn lại đổi ${oldN}→${newN}`;
});

// ================= SUMMARY =================
t('D1', 'lãi/lỗ thực tế: mỗi khoản cổ tức/tiền thuê đếm đúng 1 lần (tổng = lãi bán + thu nhập sổ cái; cổ tức theo mã khớp metadata)', () => {
  const st = loadFinancialState(); const s = calculateFinancialSummary(st);
  const sales = sum(st.assets.map(a => a.realizedPnL));
  const inc = sum(st.transactions.filter(x => ['dividend', 'rental_income', 'interest_income'].includes(x.type)).map(x => x.amount));
  if (s.totalRealizedPnL !== sales + inc) return `tổng=${s.totalRealizedPnL} ≠ ${sales}+${inc}`;
  for (const a of st.assets.filter(x => x.category === 'stock')) {
    const d = sum(st.transactions.filter(x => x.type === 'dividend' && x.linkedAssetId === a.id).map(x => x.amount));
    if (d !== (a.metadata as any).totalDividendsReceived) return `${a.name}: sổ cái ${d} ≠ metadata ${(a.metadata as any).totalDividendsReceived}`;
  }
  return true;
});
t('D2', 'Net worth = TS + tiền mặt − nợ', () => {
  const st = loadFinancialState(); const s = calculateFinancialSummary(st);
  const exp = sum(st.assets.filter(a => a.status === 'active').map(a => a.currentValue)) + st.wallet.availableCash - sum(st.debts.filter(d => d.status === 'active').map(d => d.remainingPrincipal));
  return s.netWorth === exp ? true : `${s.netWorth} vs ${exp}`;
});
t('D3', '"Nghĩa vụ nợ tháng này" chỉ gồm kỳ đến hạn trong tháng hiện tại', () => {
  const st = loadFinancialState(); const s = calculateFinancialSummary(st);
  const m = new Date().toISOString().slice(0, 7);
  const inMonth = s.upcomingPayments.filter(p => p.dueDate.startsWith(m));
  return s.monthlyDebtPaymentTotal === sum(inMonth.map(p => p.total)) ? true
    : `tổng ${s.monthlyDebtPaymentTotal} gồm cả kỳ ngoài tháng này: ${s.upcomingPayments.map(p => p.dueDate).join(',')}`;
});
t('D4', 'LTV khi tài sản thế chấp đã bán (currentValue=0) không hiển thị 0% đánh lừa', () => {
  const st = loadFinancialState();
  const asset = { ...st.assets[0], status: 'sold' as const, currentValue: 0 };
  const m = calculateCollateralMetrics(asset, st.debts[0]);
  return m.ltvPercent > 0 ? true : `LTV=${m.ltvPercent}% dù còn nợ ${formatVND(m.remainingDebt)} trên tài sản đã bán`;
});

// ================= DATE / TZ =================
t('E1', 'todayLocalStr(): đúng ngày địa phương lúc 2h sáng VN (không lùi 1 ngày)', () => {
  const RealDate = Date;
  const fake = new RealDate('2026-10-16T02:00:00+07:00'); // 2h sáng 16/10 giờ VN
  (globalThis as any).Date = class extends RealDate { constructor(...a: any[]) { if (a.length === 0) { super(fake.getTime()); } else { super(...(a as [any])); } } static now() { return fake.getTime(); } } as any;
  const today = todayLocalStr();   // helper mới (giờ địa phương)
  (globalThis as any).Date = RealDate;
  const expected = new Intl.DateTimeFormat('sv-SE').format(fake);   // ngày địa phương tính độc lập
  return today === expected ? true : `todayLocalStr=${today} ≠ ${expected} (TZ=${process.env.TZ})`;
});

// ================= STORAGE =================
t('F1', 'JSON hỏng trong localStorage: bản gốc được cất lại + có cảnh báo (không mất dữ liệu)', () => {
  const bad = '{"wallet":{"availableCash":1,"totalDeposited":1,"totalWithdrawn":0},"assets":[],"debts":[ BROKEN';
  store['fintrack_vn_portfolio_v1'] = bad;
  const st = loadFinancialState();
  (globalThis as any).localStorage.setItem('fintrack_vn_portfolio_v1', JSON.stringify(st)); // App useEffect ghi đè khóa chính
  const kept = Object.entries(store).some(([k, v]) => k.includes('_corrupt_') && v === bad);
  const w = consumeLoadWarning();
  return kept && !!w ? true : `kept=${kept} warning=${w}`;
});
t('F2', 'dữ liệu cũ thiếu trường (transactions) không làm crash khi load', () => {
  store['fintrack_vn_portfolio_v1'] = JSON.stringify({ wallet: { availableCash: 0, totalDeposited: 0, totalWithdrawn: 0 }, assets: [], debts: [] });
  const st = loadFinancialState();
  return Array.isArray(st.transactions) ? true : 'transactions = ' + String(st.transactions);
});
t('F3', 'lần đầu mở app: dữ liệu mẫu được gắn cờ isDemo; clearFinancialState() cho danh mục trống thật', () => {
  delete store['fintrack_vn_portfolio_v1'];
  const st = loadFinancialState();
  if (st.isDemo !== true) return 'demo không có cờ isDemo';
  const e = clearFinancialState();
  return e.assets.length === 0 && e.debts.length === 0 && e.transactions.length === 0 && e.wallet.availableCash === 0 && e.isDemo === false ? true : JSON.stringify(e);
});

// ================= SAVINGS =================
t('G1', 'tiết kiệm: lãi tạm tính & tiền đáo hạn (lãi đơn, 365 ngày)', () => {
  const a = INITIAL_DEMO_STATE.assets.find(x => x.id === 'asset-sav-bidv')!;
  const r = getSavingsAccrual(a, '2026-05-02');            // 182 ngày kể từ 2025-11-01
  const exp = Math.round(200_000_000 * 0.056 * 182 / 365);
  return r.accruedInterest === exp && r.amountAtMaturity === 200_000_000 + Math.round(200_000_000 * 0.056 * 365 / 365) ? true : JSON.stringify(r);
});
t('G2', 'sổ BIDV đáo hạn 01/11/2026 hiện trong danh sách sắp đáo hạn 45 ngày', () => {
  delete store['fintrack_vn_portfolio_v1'];
  const st = loadFinancialState(); const m = getUpcomingMaturities(st, 45);
  return m.length === 1 && m[0].maturityDate === '2026-11-01' && m[0].daysToMaturity === Math.round((Date.parse('2026-11-01') - Date.parse(todayLocalStr())) / 864e5) ? true : JSON.stringify(m.map(x => [x.maturityDate, x.daysToMaturity]));
});
t('G3', 'normalizeState: JSON thiếu trường / rác không làm crash', () => {
  const n = normalizeState({ wallet: {}, assets: [{ id: 'x', name: 'y' }, null, 5], debts: [{ id: 'd', name: 'n', principalAmount: 1e8, tenorMonths: 12, startDate: '2026-01-10', annualInterestRate: 10 }] });
  return n && n.assets.length === 1 && n.debts[0].schedule!.length > 0 && Array.isArray(n.transactions) && normalizeState('abc') === null && normalizeState(null) === null ? true : JSON.stringify(n);
});

console.log(`\n==== ${pass} pass / ${fail} fail ====`);
if (fail) { console.log(failures.map(f => ' - ' + f).join('\n')); }
