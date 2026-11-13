/**
 * Test giai đoạn 4: mua thêm, vị thế (gộp các lô cùng mã), giá vốn bình quân, bán theo vị thế,
 * hủy lô / hủy cả lần bán, cổ tức theo vị thế, cập nhật giá cho mọi lô, chi phí cải tạo.
 * Run: npx tsx tests/positions.test.ts
 */
import { calculateFinancialSummary, isLiveTx } from '../src/utils/calculations';
import { calculateBalanceSheet } from '../src/utils/balanceSheet';
import { collectQuoteRequests, listPriceRows, applyPriceUpdates, suggestFromQuote, quotesToMap, quoteMapKey } from '../src/utils/priceSync';
import {
  applyBuyMore, applyImprovement, applyPositionDividend, applySellPosition, applyVoidGroup, buildPositions, positionKey, previewSellPosition,
} from '../src/utils/positions';
import { applyVoidAsset, applySell, OpResult } from '../src/utils/ops';
import { buildPeriod, cashFlowReport, reconcileReports } from '../src/utils/reports';
import type { Asset, MarketQuote, UserFinancialState } from '../src/types/finance';

let pass = 0, fail = 0;
function t(id: string, name: string, fn: () => true | string) {
  let r: true | string;
  try { r = fn(); } catch (e: any) { r = 'THROW ' + e.stack; }
  if (r === true) { pass++; console.log(`PASS ${id} ${name}`); } else { fail++; console.log(`FAIL ${id} ${name}\n       ${r}`); }
}
(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
let n = 0;
const uid = (p: string) => `${p}-${++n}`;
const M = 1_000_000;
const TODAY = '2026-11-10';
const st = (o: Partial<UserFinancialState> = {}): UserFinancialState => ({
  wallet: { availableCash: 500 * M, totalDeposited: 500 * M, totalWithdrawn: 0 }, assets: [], debts: [], transactions: [], ...o,
});
const ok = (r: OpResult): UserFinancialState => { if (!r.ok) throw new Error('op lỗi: ' + r.error); return r.state; };
const err = (r: OpResult): string => (r.ok ? '' : r.error);
const stock = (o: Partial<Asset> = {}): Asset => ({
  id: 'fpt1', name: 'FPT', category: 'stock', initialCost: 100 * 100_000, currentValue: 100 * 120_000, purchaseDate: '2026-03-01', status: 'active',
  metadata: { symbol: 'FPT', exchange: 'HOSE', quantity: 100, avgCostPrice: 100_000, currentPrice: 120_000, totalDividendsReceived: 0 } as any,
  realizedPnL: 0, lastValuationDate: '2026-11-01', ...o,
});
const house = (): Asset => ({
  id: 'h1', name: 'Nhà', category: 'real_estate', initialCost: 2000 * M, currentValue: 2200 * M, purchaseDate: '2026-01-01', status: 'active',
  metadata: { address: 'HN', propertyType: 'apartment', areaM2: 60, purchasePrice: 2000 * M, estimatedMarketPrice: 2200 * M, monthlyRentalIncome: 0, legalStatus: 'red_book' } as any,
  realizedPnL: 0, lastValuationDate: '2026-01-01',
});
const buyTx = (id: string, assetId: string, amount: number, date: string) => ({ id, date, type: 'buy_asset' as const, amount, title: 'Mua', linkedAssetId: assetId });
/** Vị thế mẫu: lô 1 = 100 CP @100.000 (mua bằng ví), mua thêm lô 2 = 50 CP @130.000 (+ phí 50.000), lô 3 = 30 CP @110.000. */
const threeLots = (): UserFinancialState => {
  let s = st({ assets: [stock()], transactions: [buyTx('b1', 'fpt1', 10 * M, '2026-03-01')], wallet: { availableCash: 490 * M, totalDeposited: 500 * M, totalWithdrawn: 0 } });
  s = ok(applyBuyMore(s, { assetId: 'fpt1', date: '2026-06-10', quantity: 50, unitPrice: 130_000, fee: 50_000 }, uid, TODAY));
  s = ok(applyBuyMore(s, { assetId: 'fpt1', date: '2026-09-15', quantity: 30, unitPrice: 110_000 }, uid, TODAY));
  return s;
};
const lotsOf = (s: UserFinancialState) => s.assets.filter((a) => a.category === 'stock').sort((a, b) => (a.purchaseDate < b.purchaseDate ? -1 : 1));
const qty = (a: Asset) => (a.metadata as any).quantity as number;

// ============ Vị thế & giá vốn bình quân ============
t('P1', 'Mua thêm hai lần: ba lô riêng (giữ ngày mua, giá từng lần); vị thế FPT = 180 CP, giá vốn bình quân gia quyền', () => {
  const s = threeLots();
  const pos = buildPositions(s.assets);
  const p = pos[0];
  const totalCost = 10 * M + (50 * 130_000 + 50_000) + 30 * 110_000; // 10.000.000 + 6.550.000 + 3.300.000
  return pos.length === 1 && p.key === 'stock:FPT' && p.lots.length === 3 && p.totalQuantity === 180 && p.totalCost === totalCost && Math.abs(p.avgCost - totalCost / 180) < 1e-9 &&
    p.lots.map((l) => l.purchaseDate).join() === '2026-03-01,2026-06-10,2026-09-15' && p.unrealized === p.totalValue - p.totalCost ? true : JSON.stringify([p.totalQuantity, p.totalCost, p.avgCost]);
});
t('P2', 'Mua thêm: trừ ví đúng (kể cả phí, phí tính vào giá vốn), ghi giao dịch mua gắn đúng lô mới, giá thị trường lấy theo mã', () => {
  const s0 = st({ assets: [stock()], transactions: [buyTx('b1', 'fpt1', 10 * M, '2026-03-01')] });
  const s = ok(applyBuyMore(s0, { assetId: 'fpt1', date: '2026-06-10', quantity: 50, unitPrice: 130_000, fee: 50_000 }, uid, TODAY));
  const lot = lotsOf(s)[1];
  const tx = s.transactions.find((x) => x.linkedAssetId === lot.id)!;
  return s.wallet.availableCash === s0.wallet.availableCash - 6_550_000 && lot.initialCost === 6_550_000 && (lot.metadata as any).avgCostPrice === 131_000 && lot.currentValue === 50 * 120_000 &&
    tx.type === 'buy_asset' && tx.amount === 6_550_000 && tx.date === '2026-06-10' && !lot.preexisting ? true : JSON.stringify([s.wallet.availableCash, lot.initialCost, tx]);
});
t('P3', 'Mua thêm sai bị chặn: số lượng ≤ 0 hoặc lẻ (cổ phiếu), giá 0, ngày tương lai, ví không đủ, loại không hỗ trợ, lô đã bán', () => {
  const s0 = st({ assets: [stock(), house(), stock({ id: 'old', status: 'sold' })] });
  const e = [
    err(applyBuyMore(s0, { assetId: 'fpt1', date: '2026-06-10', quantity: 0, unitPrice: 1 }, uid, TODAY)),
    err(applyBuyMore(s0, { assetId: 'fpt1', date: '2026-06-10', quantity: 1.5, unitPrice: 1 }, uid, TODAY)),
    err(applyBuyMore(s0, { assetId: 'fpt1', date: '2026-06-10', quantity: 5, unitPrice: 0 }, uid, TODAY)),
    err(applyBuyMore(s0, { assetId: 'fpt1', date: '2026-12-01', quantity: 5, unitPrice: 10 }, uid, TODAY)),
    err(applyBuyMore(s0, { assetId: 'fpt1', date: '2026-06-10', quantity: 5000, unitPrice: 1_000_000 }, uid, TODAY)),
    err(applyBuyMore(s0, { assetId: 'h1', date: '2026-06-10', quantity: 1, unitPrice: 1 }, uid, TODAY)),
    err(applyBuyMore(s0, { assetId: 'old', date: '2026-06-10', quantity: 1, unitPrice: 1 }, uid, TODAY)),
  ];
  return e.every((x) => x !== '') ? true : JSON.stringify(e);
});
t('P4', 'Quỹ và vàng cũng gộp theo mã / loại vàng; tiết kiệm, nhà không có vị thế; cổ phiếu mã khác là vị thế khác', () => {
  const fund: Asset = { id: 'f1', name: 'DCDS', category: 'fund', initialCost: 10 * M, currentValue: 11 * M, purchaseDate: '2026-02-01', status: 'active', realizedPnL: 0, lastValuationDate: '2026-02-01', metadata: { fundCode: 'dcds', fundType: 'equity', units: 100.5, avgNav: 99_502, currentNav: 109_000 } as any };
  const gold: Asset = { id: 'g1', name: 'SJC', category: 'gold', initialCost: 8 * M, currentValue: 9 * M, purchaseDate: '2026-02-01', status: 'active', realizedPnL: 0, lastValuationDate: '2026-02-01', metadata: { goldType: 'SJC', quantityChi: 2, costPerChi: 4 * M, currentPerChi: 4.5 * M } as any };
  const s = ok(applyBuyMore(st({ assets: [fund, gold, house(), stock(), stock({ id: 'hpg', metadata: { symbol: 'HPG', exchange: 'HOSE', quantity: 10, avgCostPrice: 1, currentPrice: 1, totalDividendsReceived: 0 } as any })] }), { assetId: 'g1', date: '2026-05-01', quantity: 1.5, unitPrice: 4.2 * M }, uid, TODAY));
  const keys = buildPositions(s.assets).map((p) => p.key).sort();
  return keys.join() === 'fund:DCDS,gold:SJC,stock:FPT,stock:HPG' && buildPositions(s.assets).find((p) => p.key === 'gold:SJC')!.totalQuantity === 3.5 && positionKey(house()) === null ? true : keys.join();
});

// ============ Bán theo vị thế ============
t('P5', 'Bán 90/180 CP @150.000 (thực nhận 13.400.000): giá vốn = bình quân × 90, phân bổ theo tỷ lệ cho các lô, lãi chốt = thực nhận − giá vốn', () => {
  const s0 = threeLots();
  const totalCost = 19_850_000, avg = totalCost / 180;
  const r = ok(applySellPosition(s0, { key: 'stock:FPT', quantity: 90, unitPrice: 150_000, received: 13_400_000, date: '2026-10-20' }, uid, TODAY));
  const sells = r.transactions.filter((x) => x.type === 'sell_asset');
  const costSold = sells.reduce((x, y) => x + (y.costBasisSold || 0), 0);
  const recv = sells.reduce((x, y) => x + y.amount, 0);
  const pnl = sells.reduce((x, y) => x + (y.realizedPnL || 0), 0);
  const lots = lotsOf(r);
  const pos = buildPositions(r.assets)[0];
  return costSold === Math.round(avg * 90) && recv === 13_400_000 && pnl === 13_400_000 - costSold && sells.length === 3 && new Set(sells.map((x) => x.groupId)).size === 1 && !!sells[0].groupId &&
    lots.map(qty).join() === '50,25,15' && r.wallet.availableCash === s0.wallet.availableCash + 13_400_000 && pos.totalQuantity === 90 &&
    Math.abs(pos.avgCost - avg) < 1 ? true : JSON.stringify({ costSold, expect: Math.round(avg * 90), recv, lots: lots.map(qty), avgAfter: pos.avgCost, avg });
});
t('P6', 'Số lượng lẻ phân bổ đúng (phần dư lớn nhất): bán 7 CP trên các lô 100/50/30 → tổng đúng 7, số nguyên', () => {
  const pv = previewSellPosition(threeLots(), { key: 'stock:FPT', quantity: 7, unitPrice: 150_000, received: 1_040_000, date: '2026-10-20' });
  if (typeof pv === 'string') return pv;
  const q = pv.lots.map((l) => l.quantity);
  return q.reduce((a, b) => a + b, 0) === 7 && q.every((x) => Number.isInteger(x)) && pv.lots.reduce((a, l) => a + l.received, 0) === 1_040_000 && pv.lots.reduce((a, l) => a + l.recognized, 0) === pv.recognized &&
    pv.costSold === Math.round((19_850_000 / 180) * 7) ? true : JSON.stringify([q, pv.costSold]);
});
t('P7', 'Bán hết vị thế: mọi lô đã bán, lãi chốt = thực nhận − tổng giá vốn; ví cộng đúng', () => {
  const s0 = threeLots();
  const r = ok(applySellPosition(s0, { key: 'stock:FPT', unitPrice: 150_000, received: 26_500_000, date: '2026-10-20' }, uid, TODAY));
  const pnl = r.transactions.filter((x) => x.type === 'sell_asset').reduce((a, x) => a + (x.realizedPnL || 0), 0);
  return r.assets.filter((a) => a.category === 'stock').every((a) => a.status === 'sold') && pnl === 26_500_000 - 19_850_000 && buildPositions(r.assets).length === 0 && r.wallet.availableCash === s0.wallet.availableCash + 26_500_000 ? true : String(pnl);
});
t('P8', 'Ngày bán sớm hơn ngày mua của một lô: lô đó bị loại; bán vượt số lượng của các lô đủ điều kiện bị chặn', () => {
  const s0 = threeLots();
  const pv = previewSellPosition(s0, { key: 'stock:FPT', quantity: 100, unitPrice: 150_000, received: 14_000_000, date: '2026-07-01' });
  const tooMany = previewSellPosition(s0, { key: 'stock:FPT', quantity: 160, unitPrice: 150_000, received: 14_000_000, date: '2026-07-01' });
  return typeof pv !== 'string' && pv.totalUnits === 150 && pv.lots.length === 2 && typeof tooMany === 'string' ? true : JSON.stringify([typeof pv, tooMany]);
});
t('P9', 'Đầu vào bán sai bị chặn và state không đổi: giá 0, thực nhận 0, số lẻ cổ phiếu, ngày tương lai, vị thế không tồn tại', () => {
  const s0 = threeLots();
  const e = [
    err(applySellPosition(s0, { key: 'stock:FPT', quantity: 5, unitPrice: 0, received: 1, date: '2026-10-20' }, uid, TODAY)),
    err(applySellPosition(s0, { key: 'stock:FPT', quantity: 5, unitPrice: 1, received: 0, date: '2026-10-20' }, uid, TODAY)),
    err(applySellPosition(s0, { key: 'stock:FPT', quantity: 2.5, unitPrice: 1, received: 1, date: '2026-10-20' }, uid, TODAY)),
    err(applySellPosition(s0, { key: 'stock:FPT', quantity: 5, unitPrice: 1, received: 1, date: '2026-12-20' }, uid, TODAY)),
    err(applySellPosition(s0, { key: 'stock:ZZZ', quantity: 5, unitPrice: 1, received: 1, date: '2026-10-20' }, uid, TODAY)),
  ];
  return e.every((x) => x !== '') ? true : JSON.stringify(e);
});

// ============ Hủy ============
t('P10', 'Hủy lần mua nhầm giữa chừng: chỉ lô đó bị hủy, hai lô còn lại nguyên vẹn, tiền mua hoàn về ví, giá vốn bình quân tính lại', () => {
  const s0 = threeLots();
  const mid = lotsOf(s0)[1];
  const s = ok(applyVoidAsset(s0, mid.id, uid, TODAY));
  const pos = buildPositions(s.assets)[0];
  return s.assets.find((a) => a.id === mid.id)!.status === 'voided' && pos.lots.length === 2 && pos.totalQuantity === 130 && pos.totalCost === 13_300_000 && s.wallet.availableCash === s0.wallet.availableCash + 6_550_000 &&
    lotsOf(s).filter((a) => a.status === 'active').every((a) => JSON.stringify(a) === JSON.stringify(s0.assets.find((x) => x.id === a.id))) ? true : JSON.stringify([pos.totalQuantity, pos.totalCost]);
});
t('P11', 'Hủy cả lần bán theo vị thế: mọi lô, ví, lãi chốt trở về đúng như trước khi bán', () => {
  const s0 = threeLots();
  const sold = ok(applySellPosition(s0, { key: 'stock:FPT', quantity: 90, unitPrice: 150_000, received: 13_400_000, date: '2026-10-20' }, uid, TODAY));
  const gid = sold.transactions.find((x) => x.type === 'sell_asset')!.groupId!;
  const back = ok(applyVoidGroup(sold, gid, uid, TODAY));
  const sameLots = lotsOf(back).every((a, i) => a.initialCost === lotsOf(s0)[i].initialCost && qty(a) === qty(lotsOf(s0)[i]) && a.currentValue === lotsOf(s0)[i].currentValue && a.realizedPnL === 0 && a.status === 'active');
  return sameLots && back.wallet.availableCash === s0.wallet.availableCash && back.transactions.filter((x) => x.type === 'sell_asset' && isLiveTx(x)).length === 0 ? true : 'chưa hoàn nguyên';
});
t('P12', 'Hủy cả nhóm là nguyên tử: nếu một lô đã có lần bán mới hơn thì không hủy dòng nào', () => {
  const s0 = threeLots();
  let s = ok(applySellPosition(s0, { key: 'stock:FPT', quantity: 90, unitPrice: 150_000, received: 13_400_000, date: '2026-10-20' }, uid, TODAY));
  const gid = s.transactions.find((x) => x.type === 'sell_asset')!.groupId!;
  const lot1 = lotsOf(s)[0];
  s = ok(applySell(s, { assetId: lot1.id, quantity: 10, unitPrice: 160_000, received: 1_600_000, date: '2026-11-01' }, uid, TODAY));
  const snap = JSON.stringify(s);
  const r = applyVoidGroup(s, gid, uid, TODAY);
  return !r.ok && JSON.stringify(s) === snap ? true : 'đã hủy một phần';
});

// ============ Cổ tức ============
t('P13', 'Cổ tức 1.805.000 theo vị thế: chia theo số lượng (100/50/30), tổng đúng từng đồng, cập nhật cổ tức đã nhận từng lô; hủy cả nhóm hoàn lại', () => {
  const s0 = threeLots();
  const s = ok(applyPositionDividend(s0, { key: 'stock:FPT', amount: 1_805_000, date: '2026-10-25' }, uid, TODAY));
  const divs = s.transactions.filter((x) => x.type === 'dividend');
  const perLot = lotsOf(s).map((a) => (a.metadata as any).totalDividendsReceived as number);
  const back = ok(applyVoidGroup(s, divs[0].groupId!, uid, TODAY));
  return divs.reduce((a, x) => a + x.amount, 0) === 1_805_000 && perLot.reduce((a, x) => a + x, 0) === 1_805_000 && perLot[0] > perLot[1] && perLot[1] > perLot[2] &&
    s.wallet.availableCash === s0.wallet.availableCash + 1_805_000 && back.wallet.availableCash === s0.wallet.availableCash && lotsOf(back).every((a) => (a.metadata as any).totalDividendsReceived === 0) ? true : JSON.stringify(perLot);
});
t('P14', 'Cổ tức: chỉ cổ phiếu, số tiền > 0, lô mua sau ngày nhận không được chia', () => {
  const s0 = threeLots();
  const e = [err(applyPositionDividend(s0, { key: 'gold:SJC', amount: 5, date: '2026-10-25' }, uid, TODAY)), err(applyPositionDividend(s0, { key: 'stock:FPT', amount: 0, date: '2026-10-25' }, uid, TODAY)), err(applyPositionDividend(s0, { key: 'stock:FPT', amount: 5, date: '2026-01-01' }, uid, TODAY))];
  const early = ok(applyPositionDividend(s0, { key: 'stock:FPT', amount: 1_500_000, date: '2026-07-01' }, uid, TODAY));
  const divs = early.transactions.filter((x) => x.type === 'dividend');
  return e.every((x) => x !== '') && divs.length === 2 && divs.reduce((a, x) => a + x.amount, 0) === 1_500_000 ? true : JSON.stringify([e, divs.length]);
});

// ============ Giá ============
t('P15', 'Giá thị trường áp cho mọi lô cùng mã: một báo giá → mỗi lô một gợi ý, áp xong tổng giá trị = tổng số lượng × giá mới', () => {
  const s0 = threeLots();
  const quote: MarketQuote = { kind: 'stock', symbol: 'FPT', date: '2026-11-09', close: 125_000, prevDate: null, prevClose: null, source: 'test', fetchedAt: '2026-11-09T10:00:00Z' };
  const rows = listPriceRows(s0, TODAY).filter((r) => r.asset.category === 'stock');
  const map = quotesToMap([quote]);
  const sugg = rows.map((r) => suggestFromQuote(r, map.get(quoteMapKey('stock', 'FPT')))).filter(Boolean) as NonNullable<ReturnType<typeof suggestFromQuote>>[];
  const res = applyPriceUpdates(s0, sugg.map((x) => ({ assetId: x.assetId, unitPrice: x.newUnitPrice, date: x.date })), TODAY);
  const req = collectQuoteRequests(rows).stock;
  return sugg.length === 3 && res.applied.length === 3 && buildPositions(res.state.assets)[0].totalValue === 180 * 125_000 && req.length === 1 ? true : JSON.stringify([sugg.length, res.applied.length, req]);
});

// ============ Bảng cân đối và báo cáo ============
t('P16', 'Sau mua thêm + bán theo vị thế + cổ tức: tài sản ròng = ví + tài sản, lãi chốt trong báo cáo = Σ lãi các lần bán, đối soát báo cáo vẫn khớp', () => {
  let s = threeLots();
  s = ok(applySellPosition(s, { key: 'stock:FPT', quantity: 90, unitPrice: 150_000, received: 13_400_000, date: '2026-10-20' }, uid, TODAY));
  s = ok(applyPositionDividend(s, { key: 'stock:FPT', amount: 900_000, date: '2026-10-25' }, uid, TODAY));
  const sum = calculateFinancialSummary(s);
  const bs = calculateBalanceSheet(s, TODAY);
  const period = buildPeriod({ kind: 'month', year: 2026, month: 10, quarter: 4 }, TODAY);
  const cf = cashFlowReport(s, period, TODAY);
  const checks = reconcileReports(s, period, TODAY);
  const sellPnL = s.transactions.filter((x) => x.type === 'sell_asset').reduce((a, x) => a + (x.realizedPnL || 0), 0);
  const assetPnL = s.assets.reduce((a, x) => a + (x.realizedPnL || 0), 0);
  return Math.abs(sum.netWorth - bs.equity.total) < 1 && sellPnL === assetPnL && cf.investing.sell === 13_400_000 && cf.operating.dividend === 900_000 && checks.every((c) => c.ok) ? true : JSON.stringify([sum.netWorth, bs.equity.total, sellPnL, assetPnL, checks.map((c) => [c.id, c.ok, c.diff])]);
});

// ============ Chi phí cải tạo ============
t('P17', 'Chi phí cải tạo 150 triệu: cộng vào giá vốn (và giá trị mặc định), trừ ví, ghi giao dịch; chỉ nhà/tài sản khác; không đủ ví bị chặn', () => {
  const s0 = st({ assets: [house()], transactions: [buyTx('b', 'h1', 2000 * M, '2026-01-01')], wallet: { availableCash: 300 * M, totalDeposited: 2300 * M, totalWithdrawn: 0 } });
  const s = ok(applyImprovement(s0, { assetId: 'h1', amount: 150 * M, date: '2026-08-01', note: 'Sơn sửa' }, uid, TODAY));
  const a = s.assets[0];
  const e = [err(applyImprovement(s0, { assetId: 'h1', amount: 900 * M, date: '2026-08-01' }, uid, TODAY)), err(applyImprovement(st({ assets: [stock()] }), { assetId: 'fpt1', amount: 1, date: '2026-08-01' }, uid, TODAY)), err(applyImprovement(s0, { assetId: 'h1', amount: 1, date: '2025-01-01' }, uid, TODAY))];
  const costOnly = ok(applyImprovement(s0, { assetId: 'h1', amount: 150 * M, date: '2026-08-01', addToValue: false }, uid, TODAY));
  return a.initialCost === 2150 * M && a.currentValue === 2350 * M && (a.metadata as any).purchasePrice === 2150 * M && s.wallet.availableCash === 150 * M && s.transactions.some((x) => x.type === 'buy_asset' && x.amount === 150 * M && x.linkedAssetId === 'h1') &&
    costOnly.assets[0].currentValue === 2200 * M && e.every((x) => x !== '') ? true : JSON.stringify([a.initialCost, a.currentValue, e]);
});
t('P18', 'Cải tạo tài sản có từ trước (không trừ ví): giá vốn tăng, số dư ban đầu bám theo; phần không qua ví được tính là tài sản phi tiền mặt và đối soát báo cáo vẫn khớp', () => {
  const pre: Asset = { ...house(), preexisting: true, openingValue: 2000 * M, purchaseDate: '2026-01-01' };
  const s0 = st({ assets: [pre] });
  const s = ok(applyImprovement(s0, { assetId: 'h1', amount: 100 * M, date: '2026-08-01', deductFromWallet: false }, uid, TODAY));
  const period = buildPeriod({ kind: 'year', year: 2026, month: 1, quarter: 1 }, TODAY);
  const cf = cashFlowReport(s, period, TODAY);
  const bs = calculateBalanceSheet(s, TODAY);
  return s.wallet.availableCash === s0.wallet.availableCash && s.assets[0].openingValue === 2100 * M && s.transactions.length === 0 && cf.nonCash.assets.amount === 2100 * M && bs.equity.opening === 2100 * M && reconcileReports(s, period, TODAY).every((c) => c.ok) ? true : JSON.stringify([s.assets[0].openingValue, cf.nonCash.assets, bs.equity]);
});

console.log(`\n==== positions: ${pass} pass / ${fail} fail ====`);
process.exit(fail ? 1 : 0);
