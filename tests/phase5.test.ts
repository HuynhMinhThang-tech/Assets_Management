/**
 * Test giai đoạn 5: tab "Cập nhật giá" – dòng giá, gợi ý từ giá thị trường, áp hàng loạt, import CSV.
 * Run: npx tsx tests/phase5.test.ts
 */
import {
  ANOMALY_PCT, applyPriceUpdates, buildPriceTemplateCsv, collectQuoteRequests, daysBetween, listPriceRows, parseDateFlexible,
  parseNumberVN, parsePriceCsv, planImport, previewValue, priceKey, quotesToMap, splitCsv, suggestFromQuote,
} from '../src/utils/priceSync';
import type { Asset, MarketQuote, UserFinancialState } from '../src/types/finance';

let pass = 0, fail = 0;
function t(id: string, name: string, fn: () => true | string) {
  let r: true | string;
  try { r = fn(); } catch (e: any) { r = 'THROW ' + e.stack; }
  if (r === true) { pass++; console.log(`PASS ${id} ${name}`); } else { fail++; console.log(`FAIL ${id} ${name}\n       ${r}`); }
}
const M = 1_000_000;
const TODAY = '2026-11-05';
const st = (assets: Asset[]): UserFinancialState => ({
  wallet: { availableCash: 0, totalDeposited: 0, totalWithdrawn: 0 }, assets, debts: [], transactions: [],
});
const base = (o: Partial<Asset>): Asset => ({
  id: 'x', name: 'X', category: 'other', initialCost: 10 * M, currentValue: 10 * M, purchaseDate: '2026-01-01', status: 'active',
  metadata: { itemType: 'Xe', details: '' } as any, realizedPnL: 0, lastValuationDate: '2026-10-01', ...o,
});
const fpt = (o: Partial<Asset> = {}): Asset => base({
  id: 'fpt', name: 'FPT', category: 'stock', initialCost: 100 * M, currentValue: 120 * M,
  metadata: { symbol: 'FPT', exchange: 'HOSE', quantity: 1000, avgCostPrice: 100000, currentPrice: 120000, totalDividendsReceived: 0 } as any, ...o,
});
const fund = (o: Partial<Asset> = {}): Asset => base({
  id: 'dcds', name: 'Quỹ DCDS', category: 'fund', initialCost: 3_015_000, currentValue: 3_115_500,
  metadata: { fundCode: 'DCDS', fundType: 'equity', units: 100.5, avgNav: 30000, currentNav: 31000 } as any, ...o,
});
const gold = (o: Partial<Asset> = {}, type = 'SJC'): Asset => base({
  id: 'gold-' + type, name: 'Vàng ' + type, category: 'gold', initialCost: 70 * M, currentValue: 75 * M,
  metadata: { goldType: type, quantityChi: 10, costPerChi: 7 * M, currentPerChi: 7_500_000 } as any, ...o,
});
const car = (o: Partial<Asset> = {}) => base({ id: 'car', name: 'Xe hơi', category: 'other', initialCost: 500 * M, currentValue: 450 * M, ...o });
const sav = (o: Partial<Asset> = {}) => base({
  id: 'sav', name: 'Tiết kiệm VCB', category: 'savings', initialCost: 50 * M, currentValue: 51 * M,
  metadata: { bankName: 'VCB', depositAmount: 50 * M, termMonths: 6, annualInterestRate: 5, startDate: '2026-06-01', maturityDate: '2026-12-01', rolloverOption: 'close' } as any, ...o,
});
const quote = (o: Partial<MarketQuote> = {}): MarketQuote => ({
  kind: 'stock', symbol: 'FPT', date: '2026-11-03', close: 125000, prevDate: '2026-11-02', prevClose: 123000, source: 'vnstock:KBS', fetchedAt: '2026-11-03T08:10:00.000Z', ...o,
});
const rowOf = (a: Asset) => listPriceRows(st([a]), TODAY)[0];

// ============ Dòng giá ============
t('P1', 'priceKey: CP theo mã, quỹ theo mã quỹ, chỉ vàng SJC có nguồn tự động; nhẫn 9999/nữ trang/xe thì không', () => {
  const k = [priceKey(fpt()), priceKey(fund()), priceKey(gold()), priceKey(gold({}, 'nhan_9999')), priceKey(car())];
  return JSON.stringify(k) === JSON.stringify([{ kind: 'stock', symbol: 'FPT' }, { kind: 'fund', symbol: 'DCDS' }, { kind: 'gold', symbol: 'SJC' }, null, null]) ? true : JSON.stringify(k);
});
t('P2', 'listPriceRows: chỉ tài sản đang nắm giữ; đúng chế độ nhập; sắp theo nhóm (CP → quỹ → vàng → khác → tiết kiệm)', () => {
  const rows = listPriceRows(st([sav(), car(), gold(), fund(), fpt(), fpt({ id: 'old', status: 'sold' }), fpt({ id: 'bad', status: 'voided' })]), TODAY);
  const order = rows.map((r) => r.asset.id).join(',');
  const modes = rows.map((r) => r.mode).join(',');
  return order === 'fpt,dcds,gold-SJC,car,sav' && modes === 'unit,unit,unit,total,readonly' ? true : order + ' | ' + modes;
});
t('P3', 'dòng cổ phiếu: đơn vị, số lượng, giá vốn/CP, giá hiện tại/CP, số ngày chưa định giá', () => {
  const r = rowOf(fpt());
  return r.unit === 'cổ phiếu' && r.quantity === 1000 && r.costPerUnit === 100000 && r.currentUnitPrice === 120000 && r.staleDays === 35 && !r.allowDecimal ? true : JSON.stringify(r);
});
t('P4', 'dòng quỹ cho phép số thập phân (NAV); tài sản khác nhập tổng giá trị; tiết kiệm chỉ xem', () => {
  const f = rowOf(fund()), c = rowOf(car()), s = rowOf(sav());
  return f.allowDecimal && f.currentUnitPrice === 31000 && c.mode === 'total' && c.unit === null && s.mode === 'readonly' && s.staleDays === null ? true : JSON.stringify([f, c, s]);
});
t('P5', 'collectQuoteRequests: gom mã theo loại, không trùng, bỏ tài sản không có nguồn', () => {
  const rows = listPriceRows(st([fpt(), fpt({ id: 'fpt2' }), fund(), gold(), gold({}, 'nhan_9999'), car()]), TODAY);
  const q = collectQuoteRequests(rows);
  return JSON.stringify(q) === JSON.stringify({ stock: ['FPT'], fund: ['DCDS'], gold: ['SJC'] }) ? true : JSON.stringify(q);
});
t('P6', 'daysBetween: đúng khi qua tháng/năm; sai định dạng → null', () =>
  daysBetween('2026-10-01', '2026-11-05') === 35 && daysBetween('2025-12-31', '2026-01-01') === 1 && daysBetween('', TODAY) === null && daysBetween('2026-13-40', TODAY) !== undefined ? true : 'sai');

// ============ Xem trước & gợi ý ============
t('S1', 'previewValue: cổ phiếu = SL × giá; lãi/lỗ so với giá vốn; % thay đổi so với hiện tại', () => {
  const p = previewValue(rowOf(fpt()), 132000);
  return p.total === 132 * M && p.pnl === 32 * M && Math.abs(p.pnlPct! - 32) < 1e-9 && Math.abs(p.changePct! - 10) < 1e-9 ? true : JSON.stringify(p);
});
t('S2', 'previewValue: tài sản nhập tổng → total = số nhập; lỗ hiển thị âm', () => {
  const p = previewValue(rowOf(car()), 400 * M);
  return p.total === 400 * M && p.pnl === -100 * M && Math.abs(p.pnlPct! + 20) < 1e-9 ? true : JSON.stringify(p);
});
t('S3', 'suggestFromQuote: giá mới, biến động so với app, biến động trong phiên, lãi/lỗ sổ sách', () => {
  const s = suggestFromQuote(rowOf(fpt()), quote())!;
  return s.status === 'ok' && s.newUnitPrice === 125000 && s.newTotal === 125 * M && s.pnl === 25 * M && Math.abs(s.pnlPct! - 25) < 1e-9 &&
    Math.abs(s.changePct! - (5000 / 120000) * 100) < 1e-9 && Math.abs(s.dayChangePct! - (2000 / 123000) * 100) < 1e-9 && !s.anomaly && s.date === '2026-11-03' ? true : JSON.stringify(s);
});
t('S4', 'suggestFromQuote: lệch > ngưỡng → anomaly; đúng ngưỡng thì không', () => {
  const big = suggestFromQuote(rowOf(fpt()), quote({ close: 160000 }))!;
  const edge = suggestFromQuote(rowOf(fpt()), quote({ close: 120000 * (1 + ANOMALY_PCT / 100) }))!;
  return big.anomaly && !edge.anomaly ? true : JSON.stringify([big.anomaly, edge.anomaly]);
});
t('S5', 'suggestFromQuote: tài sản được định giá tay MỚI hơn ngày của giá → newer_manual (không ghi đè)', () => {
  const s = suggestFromQuote(rowOf(fpt({ lastValuationDate: '2026-11-04' })), quote())!;
  return s.status === 'newer_manual' ? true : s.status;
});
t('S6', 'suggestFromQuote: cùng giá và đã ghi nhận đến ngày đó → same; cùng giá nhưng ngày cũ hơn → vẫn ok (để ghi ngày)', () => {
  const same = suggestFromQuote(rowOf(fpt({ lastValuationDate: '2026-11-03' })), quote({ close: 120000 }))!;
  const older = suggestFromQuote(rowOf(fpt({ lastValuationDate: '2026-10-20' })), quote({ close: 120000 }))!;
  return same.status === 'same' && older.status === 'ok' ? true : same.status + ' ' + older.status;
});
t('S7', 'suggestFromQuote: null khi không có giá, sai mã/loại, giá ≤ 0, hoặc tài sản nhập tổng', () => {
  const r = rowOf(fpt());
  return suggestFromQuote(r, undefined) === null && suggestFromQuote(r, quote({ symbol: 'HPG' })) === null && suggestFromQuote(r, quote({ kind: 'fund' })) === null &&
    suggestFromQuote(r, quote({ close: 0 })) === null && suggestFromQuote(rowOf(car()), quote({ symbol: 'Xe hơi' })) === null ? true : 'sai';
});
t('S8', 'suggestFromQuote: quỹ giữ 2 chữ số thập phân; vàng SJC theo giá mỗi chỉ', () => {
  const f = suggestFromQuote(rowOf(fund()), quote({ kind: 'fund', symbol: 'DCDS', close: 31234.567 }))!;
  const g = suggestFromQuote(rowOf(gold()), quote({ kind: 'gold', symbol: 'SJC', close: 7_600_000 }))!;
  return f.newUnitPrice === 31234.57 && g.newTotal === 76 * M ? true : JSON.stringify([f.newUnitPrice, g.newTotal]);
});
t('S9', 'quotesToMap: tra theo loại + mã (không phân biệt hoa thường)', () => {
  const m = quotesToMap([quote(), quote({ kind: 'fund', symbol: 'DCDS' })]);
  return m.get('stock:FPT')?.close === 125000 && m.get('fund:DCDS') !== undefined && m.get('stock:DCDS') === undefined ? true : 'sai';
});

// ============ Áp hàng loạt ============
t('A1', 'applyPriceUpdates: cập nhật giá trị + thị giá + ngày + lịch sử theo NGÀY CỦA GIÁ; giá vốn và lãi lỗ đã chốt giữ nguyên', () => {
  const r = applyPriceUpdates(st([fpt()]), [{ assetId: 'fpt', unitPrice: 125000, date: '2026-11-03' }], TODAY);
  const a = r.state.assets[0] as any;
  const h = a.valuationHistory[a.valuationHistory.length - 1];
  return r.applied.length === 1 && a.currentValue === 125 * M && a.metadata.currentPrice === 125000 && a.lastValuationDate === '2026-11-03' &&
    h.date === '2026-11-03' && h.value === 125 * M && h.unitPrice === 125000 && a.initialCost === 100 * M && a.realizedPnL === 0 ? true : JSON.stringify(a);
});
t('A2', 'applyPriceUpdates: nhiều tài sản trong một lần (cổ phiếu, quỹ, vàng, xe nhập tổng)', () => {
  const r = applyPriceUpdates(st([fpt(), fund(), gold(), car()]), [
    { assetId: 'fpt', unitPrice: 130000, date: TODAY }, { assetId: 'dcds', unitPrice: 32000, date: TODAY },
    { assetId: 'gold-SJC', unitPrice: 7_800_000, date: TODAY }, { assetId: 'car', totalValue: 430 * M, date: TODAY },
  ], TODAY);
  const v = (id: string) => r.state.assets.find((a) => a.id === id)!.currentValue;
  return r.applied.length === 4 && v('fpt') === 130 * M && v('dcds') === 3_216_000 && v('gold-SJC') === 78 * M && v('car') === 430 * M ? true : JSON.stringify(r.state.assets.map((a) => a.currentValue));
});
t('A3', 'applyPriceUpdates: bỏ qua có lý do – cũ hơn lần định giá, tương lai, tiết kiệm, không tìm thấy/đã bán, giá sai', () => {
  const r = applyPriceUpdates(st([fpt({ lastValuationDate: '2026-11-04' }), fpt({ id: 'f2' }), sav(), fpt({ id: 'sold', status: 'sold' })]), [
    { assetId: 'fpt', unitPrice: 1, date: '2026-11-03' }, { assetId: 'f2', unitPrice: 130000, date: '2026-12-01' }, { assetId: 'sav', totalValue: 60 * M, date: TODAY },
    { assetId: 'nope', unitPrice: 1, date: TODAY }, { assetId: 'sold', unitPrice: 130000, date: TODAY }, { assetId: 'f2', unitPrice: -5, date: TODAY },
  ], TODAY);
  const reasons = r.skipped.map((s) => s.reason).join(',');
  return r.applied.length === 0 && reasons === 'older,future,readonly,not_found,not_found,invalid' && r.state === r.state && r.state.assets[0].currentValue === 120 * M ? true : reasons;
});
t('A4', 'applyPriceUpdates: không áp được gì → trả về đúng state cũ (không tạo bản sao); cùng ngày áp hai lần → ghi đè một dòng lịch sử', () => {
  const s0 = st([fpt()]);
  const none = applyPriceUpdates(s0, [], TODAY);
  const a = applyPriceUpdates(s0, [{ assetId: 'fpt', unitPrice: 121000, date: TODAY }], TODAY);
  const b = applyPriceUpdates(a.state, [{ assetId: 'fpt', unitPrice: 122000, date: TODAY }], TODAY);
  const hist = (b.state.assets[0] as any).valuationHistory.filter((h: any) => h.date === TODAY);
  return none.state === s0 && hist.length === 1 && hist[0].unitPrice === 122000 ? true : JSON.stringify(hist);
});
t('A5', 'applyPriceUpdates: không sửa state gốc (bất biến)', () => {
  const s0 = st([fpt()]);
  const before = JSON.stringify(s0);
  applyPriceUpdates(s0, [{ assetId: 'fpt', unitPrice: 130000, date: TODAY }], TODAY);
  return JSON.stringify(s0) === before ? true : 'state gốc bị sửa';
});

// ============ Số, ngày, CSV ============
t('N1', 'parseNumberVN: các kiểu viết số thường gặp', () => {
  const cases: [string, number | null][] = [
    ['125000', 125000], ['125.000', 125000], ['1.234.567', 1234567], ['1,234,567', 1234567], ['12.345,67', 12345.67], ['12,345.67', 12345.67],
    ['25,5', 25.5], ['31234.57', 31234.57], ['25 500 đ', 25500], ['7.500.000 VND', 7500000], ['', null], ['abc', null], ['-5', null], ['0', null],
  ];
  const bad = cases.filter(([s, v]) => parseNumberVN(s) !== v).map(([s, v]) => `${s}→${parseNumberVN(s)} (cần ${v})`);
  return bad.length === 0 ? true : bad.join('; ');
});
t('N2', 'parseDateFlexible: ISO, DD/MM/YYYY, DD-MM-YYYY; ngày không tồn tại → null', () =>
  parseDateFlexible('2026-11-03') === '2026-11-03' && parseDateFlexible('3/11/2026') === '2026-11-03' && parseDateFlexible('03-11-2026') === '2026-11-03' &&
  parseDateFlexible('31/02/2026') === null && parseDateFlexible('hôm nay') === null ? true : 'sai');
t('N3', 'splitCsv: nhận dấu ; , tab, bỏ BOM, ngoặc kép chứa dấu phân cách, dòng trống, CRLF', () => {
  const a = splitCsv('\uFEFFloai;ten;gia\r\nco_phieu;"A;B";1,5\r\n\r\nquy;DCDS;2\r\n');
  const b = splitCsv('a,b\n1,2');
  const c = splitCsv('a\tb\n1\t2');
  return JSON.stringify(a) === JSON.stringify([['loai', 'ten', 'gia'], ['co_phieu', 'A;B', '1,5'], ['quy', 'DCDS', '2']]) && b[1][1] === '2' && c[1][1] === '2' ? true : JSON.stringify(a);
});
t('N4', 'parsePriceCsv: có tiêu đề tiếng Việt có dấu / cột đảo thứ tự; ngày trống → hôm nay', () => {
  const r = parsePriceCsv('Mã;Giá;Ngày\nFPT;125.000;03/11/2026\nHPG;27.500;\n', TODAY).rows;
  return r.length === 2 && r[0].key === 'FPT' && r[0].price === 125000 && r[0].date === '2026-11-03' && r[1].date === TODAY && r[0].line === 2 ? true : JSON.stringify(r);
});
t('N5', 'parsePriceCsv: không tiêu đề → theo thứ tự file mẫu (4, 3 hoặc 2 cột)', () => {
  const four = parsePriceCsv('co_phieu;FPT;2026-11-03;125000', TODAY).rows[0];
  const three = parsePriceCsv('FPT;2026-11-03;125000', TODAY).rows[0];
  const two = parsePriceCsv('FPT;125000', TODAY).rows[0];
  return [four, three, two].every((x) => x.key === 'FPT' && x.price === 125000) && two.date === TODAY && four.line === 1 ? true : JSON.stringify([four, three, two]);
});
t('N6', 'parsePriceCsv: dòng lỗi giữ lại kèm lý do (thiếu mã / giá sai / ngày sai); file trống → fatal', () => {
  const r = parsePriceCsv('ma;ngay;gia\n;2026-11-03;100\nFPT;2026-11-03;abc\nHPG;99/99/2026;100\n', TODAY).rows;
  const e = parsePriceCsv('', TODAY);
  return r.every((x) => !!x.error) && /Thiếu mã/.test(r[0].error!) && /Giá/.test(r[1].error!) && /Ngày/.test(r[2].error!) && !!e.fatal ? true : JSON.stringify(r);
});

// ============ Kế hoạch import ============
t('I1', 'planImport: khớp theo mã, theo tên (không phân biệt hoa thường/dấu), theo id', () => {
  const s = st([fpt(), fund(), car()]);
  const items = planImport(parsePriceCsv('ma;gia\nfpt;125000\nquy dcds;32000\nXE HOI;430000000\n', TODAY).rows, s, TODAY);
  return items.length === 3 && items.every((i) => i.status === 'ok') && items.map((i) => i.assetId).join(',') === 'fpt,dcds,car' ? true : JSON.stringify(items.map((i) => [i.key, i.status, i.assetId]));
});
t('I2', 'planImport: một mã khớp nhiều lô (hai tài sản cùng mã) → áp cho cả hai', () => {
  const items = planImport(parsePriceCsv('FPT;125000', TODAY).rows, st([fpt(), fpt({ id: 'fpt-b', name: 'FPT lô 2' })]), TODAY);
  return items.length === 2 && items.every((i) => i.status === 'ok') ? true : JSON.stringify(items);
});
t('I3', 'planImport: không khớp / lỗi dòng / tiết kiệm / ngày cũ / ngày tương lai / lệch quá ngưỡng', () => {
  const s = st([fpt({ lastValuationDate: '2026-11-04' }), sav(), car()]);
  const csv = 'ma;ngay;gia\nXYZ;2026-11-05;100\nFPT;2026-11-03;125000\nTiết kiệm VCB;2026-11-05;52000000\nXe hơi;2026-12-25;400000000\nXe hơi;2026-11-05;900000000\nHPG;;abc\n';
  const items = planImport(parsePriceCsv(csv, TODAY).rows, s, TODAY);
  const sts = items.map((i) => i.status).join(',');
  return sts === 'unmatched,older,readonly,future,anomaly,invalid' ? true : sts;
});
t('I4', 'planImport: tài sản anomaly vẫn có sẵn update để áp riêng sau khi xác nhận; item ok có update đúng loại (unitPrice / totalValue)', () => {
  const items = planImport(parsePriceCsv('FPT;125000\nXe hơi;900000000\nXe hơi;430000000', TODAY).rows, st([fpt(), car()]), TODAY);
  return items[0].update?.unitPrice === 125000 && items[1].status === 'anomaly' && items[1].update?.totalValue === 900000000 && items[2].update?.totalValue === 430000000 ? true : JSON.stringify(items);
});
t('I5', 'file mẫu → đọc lại → kế hoạch: mọi dòng sẵn sàng, bỏ tiết kiệm, giá khớp giá hiện tại', () => {
  const s = st([fpt(), fund(), gold(), car(), sav()]);
  const csv = buildPriceTemplateCsv(s, TODAY);
  const items = planImport(parsePriceCsv(csv, TODAY).rows, s, TODAY);
  const ids = items.map((i) => i.assetId).sort().join(',');
  const prices = Object.fromEntries(items.map((i) => [i.assetId, i.price]));
  return csv.startsWith('\uFEFFloai;ma_hoac_ten;ngay;gia') && items.length === 4 && items.every((i) => i.status === 'ok') && ids === 'car,dcds,fpt,gold-SJC' &&
    prices.fpt === 120000 && prices.dcds === 31000 && prices.car === 450 * M ? true : csv + JSON.stringify(items);
});
t('I6', 'đi hết luồng: import CSV → áp các item ok → danh mục đổi đúng', () => {
  const s = st([fpt(), car()]);
  const items = planImport(parsePriceCsv('FPT;2026-11-03;125000\nXe hơi;2026-11-04;440000000', TODAY).rows, s, TODAY);
  const r = applyPriceUpdates(s, items.filter((i) => i.status === 'ok').map((i) => i.update!), TODAY);
  return r.applied.length === 2 && r.state.assets[0].currentValue === 125 * M && r.state.assets[1].currentValue === 440 * M && r.state.assets[1].lastValuationDate === '2026-11-04' ? true : JSON.stringify(r.state.assets);
});

console.log(`==== phase5: ${pass} pass / ${fail} fail ====`);
if (fail) process.exit(1);
