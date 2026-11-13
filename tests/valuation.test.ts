/**
 * Test giai đoạn 5: tài sản không có giá online — ngưỡng nhắc theo loại, nguồn định giá,
 * gợi ý khấu hao (chỉ gợi ý), nhãn "định giá cũ" trên bảng cân đối.
 * Run: npx tsx tests/valuation.test.ts
 */
import { calculateBalanceSheet } from '../src/utils/balanceSheet';
import { applyPriceUpdates, listPriceRows } from '../src/utils/priceSync';
import { applyRevaluation } from '../src/utils/pricing';
import { applyEditAsset } from '../src/utils/editOps';
import { listStaleValuations, staleThresholdDays, staleValuation, suggestDepreciation } from '../src/utils/valuation';
import { normalizeState } from '../src/utils/storage';
import type { Asset, UserFinancialState } from '../src/types/finance';

let pass = 0, fail = 0;
function t(id: string, name: string, fn: () => true | string) {
  let r: true | string;
  try { r = fn(); } catch (e: any) { r = 'THROW ' + e.stack; }
  if (r === true) { pass++; console.log(`PASS ${id} ${name}`); } else { fail++; console.log(`FAIL ${id} ${name}\n       ${r}`); }
}
(globalThis as any).localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const M = 1_000_000;
const TODAY = '2026-11-10';
const daysAgo = (n: number) => { const d = new Date(Date.UTC(2026, 10, 10) - n * 86_400_000); return d.toISOString().slice(0, 10); };
const mk = (o: Partial<Asset>): Asset => ({ id: 'x', name: 'X', category: 'other', initialCost: 100 * M, currentValue: 100 * M, purchaseDate: '2025-01-01', status: 'active', metadata: { itemType: 'Đồ', details: '' } as any, realizedPnL: 0, lastValuationDate: TODAY, ...o });
const house = (o: Partial<Asset> = {}) => mk({ id: 'h', name: 'Nhà', category: 'real_estate', currentValue: 2000 * M, initialCost: 1800 * M, metadata: { address: 'HN', propertyType: 'apartment', areaM2: 0, purchasePrice: 1800 * M, estimatedMarketPrice: 2000 * M, monthlyRentalIncome: 0, legalStatus: 'red_book' } as any, ...o });
const car = (o: Partial<Asset> = {}) => mk({ id: 'c', name: 'Xe hơi', category: 'other', currentValue: 500 * M, initialCost: 600 * M, metadata: { itemType: 'Xe', details: '' } as any, ...o });
const st = (assets: Asset[]): UserFinancialState => ({ wallet: { availableCash: 100 * M, totalDeposited: 100 * M, totalWithdrawn: 0 }, assets, debts: [], transactions: [] });

t('V1', 'Ngưỡng nhắc theo loại: cổ phiếu/quỹ/vàng 30, nhà 183, xe 90, tài sản khác 183, tiết kiệm không có', () => {
  const sav = mk({ id: 's', category: 'savings', metadata: { bankName: 'V', depositAmount: 1, termMonths: 1, annualInterestRate: 1, startDate: '2026-01-01', maturityDate: '2027-01-01', rolloverOption: 'close' } as any });
  const stock = mk({ category: 'stock', metadata: { symbol: 'FPT', exchange: 'HOSE', quantity: 1, avgCostPrice: 1, currentPrice: 1, totalDividendsReceived: 0 } as any });
  const v = [staleThresholdDays(stock), staleThresholdDays(mk({ category: 'gold', metadata: { goldType: 'SJC', quantityChi: 1, costPerChi: 1, currentPerChi: 1 } as any })), staleThresholdDays(house()), staleThresholdDays(car()), staleThresholdDays(mk({})), staleThresholdDays(sav)];
  return JSON.stringify(v) === JSON.stringify([30, 30, 183, 90, 183, null]) ? true : JSON.stringify(v);
});
t('V2', 'Nhận diện xe theo loại tài sản "Xe"/"Ô tô"/"xe máy"; đồ khác (ví dụ "Xéo") không bị nhận nhầm', () => {
  const c = (itemType: string) => staleThresholdDays(mk({ metadata: { itemType, details: '' } as any }));
  return JSON.stringify([c('Xe'), c('Ô tô'), c('xe máy'), c('Đồng hồ'), c('Xéo')]) === JSON.stringify([90, 90, 90, 183, 183]) ? true : JSON.stringify([c('Xe'), c('Ô tô'), c('xe máy'), c('Đồng hồ'), c('Xéo')]);
});
t('V3', 'Cho chỉnh: ngưỡng riêng từng tài sản (reviewIntervalDays) thắng mặc định', () => staleThresholdDays(house({ reviewIntervalDays: 60 })) === 60 && staleThresholdDays(car({ reviewIntervalDays: 365 })) === 365 ? true : 'sai');
t('V4', 'Quá hạn đúng ranh giới: bằng ngưỡng chưa quá hạn, hơn 1 ngày thì quá hạn; tài sản đã bán không nhắc', () => {
  const a = staleValuation(house({ lastValuationDate: daysAgo(183) }), TODAY), b = staleValuation(house({ lastValuationDate: daysAgo(184) }), TODAY);
  return a === null && b !== null && b.days === 184 && b.threshold === 183 && staleValuation(house({ lastValuationDate: daysAgo(400), status: 'sold' }), TODAY) === null ? true : JSON.stringify([a, b]);
});
t('V5', 'Nhà định giá 100 ngày trước chưa quá hạn; xe 100 ngày trước đã quá hạn (khác với ngưỡng chung 30 ngày cũ)', () => {
  const rows = listPriceRows(st([house({ lastValuationDate: daysAgo(100) }), car({ lastValuationDate: daysAgo(100) })]), TODAY);
  const h = rows.find((r) => r.asset.id === 'h')!, c = rows.find((r) => r.asset.id === 'c')!;
  return h.stale === false && h.staleThreshold === 183 && c.stale === true && c.staleThreshold === 90 ? true : JSON.stringify([h.stale, c.stale]);
});
t('V6', 'Tiết kiệm không bao giờ quá hạn định giá (app tự tính theo lãi)', () => {
  const sav = mk({ id: 's', category: 'savings', lastValuationDate: daysAgo(900), metadata: { bankName: 'V', depositAmount: 1, termMonths: 1, annualInterestRate: 1, startDate: '2024-01-01', maturityDate: '2027-01-01', rolloverOption: 'close' } as any });
  const r = listPriceRows(st([sav]), TODAY)[0];
  return !r.stale && r.staleThreshold === null && staleValuation(sav, TODAY) === null ? true : 'sai';
});

// ---- nguồn định giá
t('V7', 'Nhập tay có nguồn định giá: lưu vào lịch sử định giá (cắt gọn, bỏ trống thì không có trường nguồn)', () => {
  const a = applyRevaluation(house(), { totalValue: 2100 * M, source: '  Giá rao bán cùng khu  ' }, TODAY);
  const b = applyRevaluation(house(), { totalValue: 2100 * M, source: '   ' }, TODAY);
  const c = applyRevaluation(house(), { totalValue: 2100 * M, source: 'x'.repeat(200) }, TODAY);
  const last = (x: Asset) => x.valuationHistory![x.valuationHistory!.length - 1];
  return last(a).source === 'Giá rao bán cùng khu' && !('source' in last(b)) && last(c).source!.length === 80 ? true : JSON.stringify([last(a), last(b)]);
});
t('V8', 'Nguồn đi qua applyPriceUpdates; cập nhật lại cùng ngày thay dòng lịch sử; dữ liệu cũ không có nguồn vẫn nạp được', () => {
  const s0 = st([car({ lastValuationDate: daysAgo(10) })]);
  const r = applyPriceUpdates(s0, [{ assetId: 'c', totalValue: 450 * M, date: TODAY, source: 'Ngân hàng thẩm định' }], TODAY);
  const h = r.state.assets[0].valuationHistory!;
  const old: any = { ...s0, assets: [{ ...s0.assets[0], valuationHistory: [{ date: '2026-01-01', value: 550 * M }] }] };
  const re = normalizeState(JSON.parse(JSON.stringify(old)))!;
  return r.applied.length === 1 && h[h.length - 1].source === 'Ngân hàng thẩm định' && re.assets[0].valuationHistory![0].source === undefined ? true : JSON.stringify(h);
});

// ---- khấu hao
t('V9', 'Gợi ý khấu hao 20%/năm sau đúng 1 năm: 500 triệu → 400 triệu; chưa ghi gì vào số liệu', () => {
  const a = car({ depreciationPerYear: 20, lastValuationDate: daysAgo(365) });
  const snap = JSON.stringify(a);
  const s = suggestDepreciation(a, TODAY)!;
  return s.suggestedValue === 400 * M && s.change === -100 * M && Math.abs(s.years - 1) < 1e-9 && JSON.stringify(a) === snap ? true : JSON.stringify(s);
});
t('V10', 'Gợi ý theo số dư giảm dần: 6 tháng ≈ giá trị × 0,8^(182/365); không gợi ý khi chưa khai tỷ lệ, chưa đủ 30 ngày, tỷ lệ ≥ 100, đã bán, tiết kiệm', () => {
  const half = suggestDepreciation(car({ depreciationPerYear: 20, lastValuationDate: daysAgo(182) }), TODAY)!;
  const exp = Math.round(500 * M * Math.pow(0.8, 182 / 365));
  const none = [suggestDepreciation(car({ lastValuationDate: daysAgo(400) }), TODAY), suggestDepreciation(car({ depreciationPerYear: 20, lastValuationDate: daysAgo(29) }), TODAY), suggestDepreciation(car({ depreciationPerYear: 100, lastValuationDate: daysAgo(400) }), TODAY), suggestDepreciation(car({ depreciationPerYear: 20, status: 'sold', lastValuationDate: daysAgo(400) }), TODAY)];
  return half.suggestedValue === exp && none.every((x) => x === null) ? true : JSON.stringify([half.suggestedValue, exp, none]);
});
t('V11', 'Xác nhận gợi ý khấu hao: áp qua applyPriceUpdates (có nguồn "khấu hao gợi ý"), ngày định giá = hôm nay; sau đó hết gợi ý', () => {
  const a = car({ depreciationPerYear: 20, lastValuationDate: daysAgo(365) });
  const s = suggestDepreciation(a, TODAY)!;
  const r = applyPriceUpdates(st([a]), [{ assetId: 'c', totalValue: s.suggestedValue, date: TODAY, source: 'Khấu hao gợi ý 20%/năm' }], TODAY);
  const b = r.state.assets[0];
  return b.currentValue === 400 * M && b.lastValuationDate === TODAY && b.valuationHistory!.slice(-1)[0].source === 'Khấu hao gợi ý 20%/năm' && suggestDepreciation(b, TODAY) === null ? true : JSON.stringify(b);
});

// ---- bảng cân đối
t('V12', 'Bảng cân đối: nêu tài sản định giá cũ và tỷ trọng; nhà quá hạn chiếm phần lớn thì tỷ trọng cao', () => {
  const s = st([house({ lastValuationDate: daysAgo(200) }), car({ lastValuationDate: daysAgo(10) })]);
  const bs = calculateBalanceSheet(s, TODAY);
  return bs.staleValuations.length === 1 && bs.staleValuations[0].assetId === 'h' && bs.staleValue === 2000 * M && bs.stalePct !== null && bs.stalePct > 0.7 ? true : JSON.stringify([bs.staleValuations, bs.stalePct]);
});
t('V13', 'Bảng cân đối: không có tài sản quá hạn → danh sách rỗng, tỷ trọng 0', () => {
  const bs = calculateBalanceSheet(st([house({ lastValuationDate: daysAgo(10) })]), TODAY);
  return bs.staleValuations.length === 0 && bs.staleValue === 0 && listStaleValuations([], TODAY).length === 0 ? true : 'sai';
});

// ---- khai báo qua sửa thông tin
t('V14', 'Khai báo ngưỡng nhắc và tỷ lệ mất giá qua Sửa thông tin: hợp lệ thì lưu + ghi lịch sử; không hợp lệ bị chặn; null để bỏ khai báo', () => {
  const s0 = st([car()]);
  const uid = (p: string) => p + Math.random();
  const r = applyEditAsset(s0, 'c', { reviewIntervalDays: 120, depreciationPerYear: 15 }, uid, TODAY);
  if (!r.ok) return r.error;
  const bad = [applyEditAsset(s0, 'c', { reviewIntervalDays: 3 }, uid, TODAY), applyEditAsset(s0, 'c', { reviewIntervalDays: 10.5 }, uid, TODAY), applyEditAsset(s0, 'c', { depreciationPerYear: 0 }, uid, TODAY), applyEditAsset(s0, 'c', { depreciationPerYear: 100 }, uid, TODAY)];
  const cleared = applyEditAsset(r.state, 'c', { reviewIntervalDays: null, depreciationPerYear: null }, uid, TODAY);
  return r.state.assets[0].reviewIntervalDays === 120 && r.state.assets[0].depreciationPerYear === 15 && r.state.editLog!.length === 2 && bad.every((x) => !x.ok) && cleared.ok && cleared.state.assets[0].reviewIntervalDays === undefined && cleared.state.assets[0].depreciationPerYear === undefined ? true : JSON.stringify(bad.map((x) => x.ok));
});

console.log(`\n==== valuation: ${pass} pass / ${fail} fail ====`);
process.exit(fail ? 1 : 0);
