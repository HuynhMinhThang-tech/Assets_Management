import type { Asset, MarketQuote, PriceKind, UserFinancialState } from '../types/finance';
import { applyRevaluation, getUnitPricing, totalFromUnitPrice } from './pricing';

/**
 * Tab "Cập nhật giá": toàn bộ phần tính toán là hàm thuần (không đụng React) để kiểm thử được.
 *  - listPriceRows        : mỗi tài sản đang nắm giữ → một dòng (nhập đơn giá / nhập tổng / chỉ xem)
 *  - suggestFromQuote     : giá thị trường từ máy chủ → gợi ý áp dụng cho một dòng
 *  - applyPriceUpdates    : áp một loạt giá lên danh mục (qua applyRevaluation → ghi lịch sử định giá)
 *  - parsePriceCsv / planImport : nhập giá từ file CSV, xem trước trước khi áp
 */

/** Quá số ngày này không định giá lại → hiện cảnh báo "quá hạn". */
export const STALE_DAYS = 30;
/** Giá mới lệch quá ngưỡng này (%) so với giá hiện tại → coi là bất thường, phải xác nhận riêng. */
export const ANOMALY_PCT = 20;

export type PriceMode = 'unit' | 'total' | 'readonly';

export interface PriceRow {
  asset: Asset;
  /** unit: nhập đơn giá (cổ phiếu, CCQ, chỉ vàng, m²) · total: nhập tổng giá trị · readonly: app tự tính (tiết kiệm). */
  mode: PriceMode;
  unit: string | null;
  quantity: number;
  allowDecimal: boolean;
  /** Khóa để tra giá tự động trên máy chủ; null = không có nguồn tự động. */
  quoteKey: { kind: PriceKind; symbol: string } | null;
  costPerUnit: number | null;
  currentUnitPrice: number | null;
  staleDays: number | null;
}

const CATEGORY_ORDER: Record<string, number> = { stock: 0, fund: 1, gold: 2, real_estate: 3, other: 4, savings: 5 };
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Số ngày từ a đến b (YYYY-MM-DD); null nếu một trong hai không hợp lệ. */
export function daysBetween(a: string, b: string): number | null {
  const pa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a || '');
  const pb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b || '');
  if (!pa || !pb) return null;
  const da = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const db = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.round((db - da) / 86_400_000);
}

/** Khóa tra giá tự động: cổ phiếu theo mã, quỹ theo mã quỹ, vàng SJC. Còn lại không có. */
export function priceKey(asset: Asset): { kind: PriceKind; symbol: string } | null {
  const md: any = asset.metadata || {};
  if (asset.category === 'stock') {
    const s = String(md.symbol || '').trim().toUpperCase();
    return s ? { kind: 'stock', symbol: s } : null;
  }
  if (asset.category === 'fund') {
    const s = String(md.fundCode || '').trim().toUpperCase();
    return s ? { kind: 'fund', symbol: s } : null;
  }
  if (asset.category === 'gold' && md.goldType === 'SJC') return { kind: 'gold', symbol: 'SJC' };
  return null;
}

export function listPriceRows(state: UserFinancialState, today: string): PriceRow[] {
  const rows: PriceRow[] = state.assets
    .filter((a) => a.status === 'active')
    .map((asset): PriceRow => {
      if (asset.category === 'savings') {
        return { asset, mode: 'readonly', unit: null, quantity: 0, allowDecimal: false, quoteKey: null, costPerUnit: null, currentUnitPrice: null, staleDays: null };
      }
      const p = getUnitPricing(asset);
      return {
        asset,
        mode: p ? 'unit' : 'total',
        unit: p ? p.unit : null,
        quantity: p ? p.quantity : 0,
        allowDecimal: p ? p.allowDecimal : false,
        quoteKey: priceKey(asset),
        costPerUnit: p && p.quantity > 0 ? asset.initialCost / p.quantity : null,
        currentUnitPrice: p ? p.unitPrice : null,
        staleDays: daysBetween(asset.lastValuationDate, today),
      };
    });
  return rows.sort(
    (a, b) =>
      (CATEGORY_ORDER[a.asset.category] ?? 9) - (CATEGORY_ORDER[b.asset.category] ?? 9) || a.asset.name.localeCompare(b.asset.name, 'vi')
  );
}

/** Các mã cần hỏi máy chủ, gom theo loại. */
export function collectQuoteRequests(rows: PriceRow[]): Record<PriceKind, string[]> {
  const out: Record<PriceKind, Set<string>> = { stock: new Set(), fund: new Set(), gold: new Set() };
  for (const r of rows) if (r.mode === 'unit' && r.quoteKey) out[r.quoteKey.kind].add(r.quoteKey.symbol);
  return { stock: [...out.stock], fund: [...out.fund], gold: [...out.gold] };
}

export const quoteMapKey = (kind: PriceKind, symbol: string) => `${kind}:${symbol.toUpperCase()}`;

export function quotesToMap(quotes: MarketQuote[]): Map<string, MarketQuote> {
  return new Map(quotes.map((q) => [quoteMapKey(q.kind, q.symbol), q]));
}

export interface PreviewValue {
  total: number;
  pnl: number;
  pnlPct: number | null;
  /** So với giá trị hiện tại (%); null nếu hiện tại bằng 0. */
  changePct: number | null;
}

/** Xem trước khi nhập: input = đơn giá (mode unit) hoặc tổng giá trị (mode total). */
export function previewValue(row: PriceRow, input: number): PreviewValue {
  const total = row.mode === 'unit' ? totalFromUnitPrice(row.quantity, input) : Math.round(input);
  const pnl = total - row.asset.initialCost;
  return {
    total,
    pnl,
    pnlPct: row.asset.initialCost > 0 ? (pnl / row.asset.initialCost) * 100 : null,
    changePct: row.asset.currentValue > 0 ? ((total - row.asset.currentValue) / row.asset.currentValue) * 100 : null,
  };
}

export const isAnomalous = (changePct: number | null) => changePct !== null && Math.abs(changePct) > ANOMALY_PCT;

export type SuggestionStatus = 'ok' | 'same' | 'newer_manual';

export interface PriceSuggestion {
  assetId: string;
  symbol: string;
  date: string;
  source: string;
  newUnitPrice: number;
  currentUnitPrice: number | null;
  /** Biến động giá mới so với giá đang ghi trong app (%). */
  changePct: number | null;
  /** Biến động trong phiên: giá đóng cửa so với phiên liền trước (%). */
  dayChangePct: number | null;
  newTotal: number;
  pnl: number;
  pnlPct: number | null;
  anomaly: boolean;
  status: SuggestionStatus;
}

/**
 * Gợi ý từ giá thị trường. Trả về null nếu dòng không có nguồn tự động hoặc chưa có giá cho mã đó.
 *  - newer_manual: tài sản đã được định giá vào ngày MỚI hơn ngày của giá thị trường → không ghi đè.
 *  - same: cùng giá và đã ghi nhận đến ngày đó → không có gì để áp.
 */
export function suggestFromQuote(row: PriceRow, quote: MarketQuote | undefined): PriceSuggestion | null {
  if (!quote || row.mode !== 'unit' || !row.quoteKey) return null;
  if (row.quoteKey.kind !== quote.kind || row.quoteKey.symbol !== quote.symbol.toUpperCase()) return null;
  if (!(quote.close > 0)) return null;
  const newUnitPrice = row.allowDecimal ? round2(quote.close) : Math.round(quote.close);
  const pv = previewValue(row, newUnitPrice);
  let status: SuggestionStatus = 'ok';
  const last = row.asset.lastValuationDate || '';
  if (last > quote.date) status = 'newer_manual';
  else if (row.currentUnitPrice === newUnitPrice && last >= quote.date) status = 'same';
  return {
    assetId: row.asset.id,
    symbol: quote.symbol.toUpperCase(),
    date: quote.date,
    source: quote.source,
    newUnitPrice,
    currentUnitPrice: row.currentUnitPrice,
    changePct: row.currentUnitPrice && row.currentUnitPrice > 0 ? ((newUnitPrice - row.currentUnitPrice) / row.currentUnitPrice) * 100 : pv.changePct,
    dayChangePct: quote.prevClose && quote.prevClose > 0 ? ((quote.close - quote.prevClose) / quote.prevClose) * 100 : null,
    newTotal: pv.total,
    pnl: pv.pnl,
    pnlPct: pv.pnlPct,
    anomaly: isAnomalous(row.currentUnitPrice && row.currentUnitPrice > 0 ? ((newUnitPrice - row.currentUnitPrice) / row.currentUnitPrice) * 100 : pv.changePct),
    status,
  };
}

// ---------------------------------------------------------------------------
// Áp giá hàng loạt
// ---------------------------------------------------------------------------

export interface PriceUpdate {
  assetId: string;
  /** Đơn giá mới (tài sản có đơn giá). */
  unitPrice?: number;
  /** Tổng giá trị mới (tài sản không có đơn giá). */
  totalValue?: number;
  /** Ngày của giá (YYYY-MM-DD) – ghi vào lịch sử định giá. */
  date: string;
}

export type SkipReason = 'not_found' | 'readonly' | 'older' | 'future' | 'invalid';

export interface ApplyResult {
  state: UserFinancialState;
  applied: string[];
  skipped: { assetId: string; reason: SkipReason }[];
}

/**
 * Áp các giá mới lên danh mục bằng applyRevaluation (cập nhật tổng giá trị, đơn giá trong thuộc tính và lịch sử định giá).
 * Bỏ qua (không ghi đè) khi: không tìm thấy / không còn đang nắm giữ, tiết kiệm (app tự tính), ngày của giá cũ hơn
 * lần định giá gần nhất, ngày ở tương lai, hoặc giá không hợp lệ.
 */
export function applyPriceUpdates(state: UserFinancialState, updates: PriceUpdate[], today: string): ApplyResult {
  const applied: string[] = [];
  const skipped: ApplyResult['skipped'] = [];
  let assets = state.assets;
  for (const u of updates) {
    const idx = assets.findIndex((a) => a.id === u.assetId && a.status === 'active');
    if (idx < 0) {
      skipped.push({ assetId: u.assetId, reason: 'not_found' });
      continue;
    }
    const a = assets[idx];
    if (a.category === 'savings') {
      skipped.push({ assetId: u.assetId, reason: 'readonly' });
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(u.date)) {
      skipped.push({ assetId: u.assetId, reason: 'invalid' });
      continue;
    }
    if (u.date > today) {
      skipped.push({ assetId: u.assetId, reason: 'future' });
      continue;
    }
    if ((a.lastValuationDate || '') > u.date) {
      skipped.push({ assetId: u.assetId, reason: 'older' });
      continue;
    }
    const next = applyRevaluation(a, u.unitPrice !== undefined ? { unitPrice: u.unitPrice } : { totalValue: u.totalValue }, u.date);
    if (next === a) {
      skipped.push({ assetId: u.assetId, reason: 'invalid' });
      continue;
    }
    assets = assets.map((x, i) => (i === idx ? next : x));
    applied.push(u.assetId);
  }
  return { state: applied.length ? { ...state, assets } : state, applied, skipped };
}

// ---------------------------------------------------------------------------
// Import CSV
// ---------------------------------------------------------------------------

const stripAccents = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
const norm = (s: string) => stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Đọc số theo kiểu Việt Nam / quốc tế: "1.234.567", "1,234,567", "12.345,67", "12345.67", "25 500 đ". null nếu không hợp lệ hoặc ≤ 0. */
export function parseNumberVN(input: string): number | null {
  let s = String(input ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/(vnd|vnđ|đồng|đ|₫)$/i, '')
    .replace(/\s+/g, '');
  if (!s || /[^0-9.,]/.test(s)) return null;
  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  let decimal: '.' | ',' | null = null;
  if (dots && commas) decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  else if (dots + commas === 1) {
    const sep = dots ? '.' : ',';
    const after = s.length - s.indexOf(sep) - 1;
    const before = s.indexOf(sep);
    decimal = after === 3 && before >= 1 && before <= 3 ? null : sep; // "1.234" = một nghìn hai trăm ba mươi tư
  }
  if (decimal) {
    const thousands = decimal === '.' ? ',' : '.';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, D/M/YYYY. null nếu không hợp lệ. */
export function parseDateFlexible(input: string): string | null {
  const s = String(input ?? '').trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (mt) [y, m, d] = [+mt[1], +mt[2], +mt[3]];
  else if ((mt = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s))) [d, m, y] = [+mt[1], +mt[2], +mt[3]];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Tách CSV có ngoặc kép; tự nhận dấu phân cách (; , tab) theo dòng đầu. */
export function splitCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const count = (ch: string) => {
    let n = 0, q = false;
    for (const c of firstLine) {
      if (c === '"') q = !q;
      else if (!q && c === ch) n++;
    }
    return n;
  };
  const cands: [string, number][] = [[';', count(';')], ['\t', count('\t')], [',', count(',')]];
  const delim = cands.reduce((best, c) => (c[1] > best[1] ? c : best))[0];

  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export interface ImportRow {
  line: number;
  key: string;
  date: string;
  price: number | null;
  error?: string;
}

const HEAD = {
  kind: ['loai', 'kind', 'type'],
  key: ['mahoacten', 'ma', 'mack', 'macp', 'ten', 'tentaisan', 'taisan', 'symbol', 'ticker', 'code'],
  date: ['ngay', 'ngaygia', 'date'],
  price: ['gia', 'dongia', 'giatri', 'tonggiatri', 'price', 'close', 'nav', 'giadongcua'],
};

export function parsePriceCsv(text: string, today: string): { rows: ImportRow[]; fatal?: string } {
  const grid = splitCsv(text);
  if (grid.length === 0) return { rows: [], fatal: 'File trống.' };
  const first = grid[0].map(norm);
  const find = (names: string[]) => first.findIndex((h) => names.includes(h));
  let iKey = find(HEAD.key), iDate = find(HEAD.date), iPrice = find(HEAD.price);
  let body = grid.slice(1);
  let firstLine = 2;
  const hasHeader = iKey >= 0 && iPrice >= 0;
  if (!hasHeader) {
    // Không có dòng tiêu đề → theo thứ tự cột của file mẫu: [loại,] mã_hoặc_tên, [ngày,] giá
    const n = grid[0].length;
    if (n >= 4) { iKey = 1; iDate = 2; iPrice = 3; }
    else if (n === 3) { iKey = 0; iDate = 1; iPrice = 2; }
    else if (n === 2) { iKey = 0; iDate = -1; iPrice = 1; }
    else return { rows: [], fatal: 'Không nhận ra các cột. Hãy dùng file mẫu (cột: loai, ma_hoac_ten, ngay, gia).' };
    body = grid;
    firstLine = 1;
  }
  const rows: ImportRow[] = body.map((r, i) => {
    const key = (r[iKey] ?? '').trim();
    const rawDate = iDate >= 0 ? (r[iDate] ?? '').trim() : '';
    const price = parseNumberVN(r[iPrice] ?? '');
    const date = rawDate ? parseDateFlexible(rawDate) : today;
    const out: ImportRow = { line: i + firstLine, key, date: date ?? rawDate, price };
    if (!key) out.error = 'Thiếu mã hoặc tên tài sản';
    else if (price === null) out.error = 'Giá không hợp lệ';
    else if (date === null) out.error = `Ngày không hợp lệ (${rawDate})`;
    return out;
  });
  return { rows };
}

export type PlanStatus = 'ok' | 'anomaly' | 'unmatched' | 'invalid' | 'older' | 'future' | 'readonly';

export interface PlanItem {
  line: number;
  key: string;
  date: string;
  price: number | null;
  assetId?: string;
  assetName?: string;
  status: PlanStatus;
  message: string;
  changePct?: number | null;
  update?: PriceUpdate;
}

/** Khớp từng dòng file với tài sản: theo mã (cổ phiếu / mã quỹ), tên chính xác (không phân biệt hoa thường, dấu) hoặc id. */
export function planImport(rows: ImportRow[], state: UserFinancialState, today: string): PlanItem[] {
  const priceRows = listPriceRows(state, today);
  const items: PlanItem[] = [];
  for (const r of rows) {
    if (r.error || r.price === null) {
      items.push({ line: r.line, key: r.key, date: r.date, price: r.price, status: 'invalid', message: r.error || 'Dòng không hợp lệ' });
      continue;
    }
    const k = norm(r.key);
    const matches = priceRows.filter(
      (p) => (p.quoteKey && norm(p.quoteKey.symbol) === k) || norm(p.asset.name) === k || norm(p.asset.id) === k
    );
    if (matches.length === 0) {
      items.push({ line: r.line, key: r.key, date: r.date, price: r.price, status: 'unmatched', message: 'Không có tài sản nào đang nắm giữ khớp mã/tên này' });
      continue;
    }
    for (const m of matches) {
      const base = { line: r.line, key: r.key, date: r.date, price: r.price, assetId: m.asset.id, assetName: m.asset.name };
      if (m.mode === 'readonly') {
        items.push({ ...base, status: 'readonly', message: 'Tiết kiệm: app tự tính theo lãi, không nhập giá' });
        continue;
      }
      const price = m.mode === 'unit' ? (m.allowDecimal ? round2(r.price) : Math.round(r.price)) : Math.round(r.price);
      const pv = previewValue(m, price);
      const cur = m.mode === 'unit' ? m.currentUnitPrice : m.asset.currentValue;
      const changePct = cur && cur > 0 ? ((price - cur) / cur) * 100 : pv.changePct;
      const update: PriceUpdate = m.mode === 'unit' ? { assetId: m.asset.id, unitPrice: price, date: r.date } : { assetId: m.asset.id, totalValue: price, date: r.date };
      if (r.date > today) items.push({ ...base, status: 'future', message: 'Ngày của giá ở tương lai', changePct });
      else if ((m.asset.lastValuationDate || '') > r.date)
        items.push({ ...base, status: 'older', message: `Đã có định giá mới hơn (${m.asset.lastValuationDate})`, changePct });
      else if (isAnomalous(changePct)) items.push({ ...base, status: 'anomaly', message: `Lệch ${changePct!.toFixed(1)}% so với giá hiện tại`, changePct, update });
      else items.push({ ...base, status: 'ok', message: 'Sẵn sàng áp dụng', changePct, update });
    }
  }
  return items;
}

const KIND_LABEL: Record<string, string> = { stock: 'co_phieu', fund: 'quy', gold: 'vang', real_estate: 'bat_dong_san', other: 'khac' };

/** File mẫu: mỗi tài sản đang nắm giữ (trừ tiết kiệm) một dòng, điền sẵn giá hiện tại. Dấu ; + BOM để Excel Việt mở đúng. */
export function buildPriceTemplateCsv(state: UserFinancialState, today: string): string {
  const q = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['loai;ma_hoac_ten;ngay;gia'];
  for (const r of listPriceRows(state, today)) {
    if (r.mode === 'readonly') continue;
    const price = r.mode === 'unit' ? r.currentUnitPrice ?? 0 : r.asset.currentValue;
    lines.push([KIND_LABEL[r.asset.category] ?? 'khac', q(r.quoteKey?.symbol ?? r.asset.name), today, String(price)].join(';'));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
