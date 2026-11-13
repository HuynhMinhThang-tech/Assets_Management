import { Asset } from '../types/finance';
import { todayLocalStr } from './calculations';

/** Số ngày từ a đến b (YYYY-MM-DD); null nếu một trong hai không hợp lệ. */
export function daysBetween(a: string, b: string): number | null {
  const pa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a || '');
  const pb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b || '');
  if (!pa || !pb) return null;
  const da = Date.UTC(+pa[1], +pa[2] - 1, +pa[3]);
  const db = Date.UTC(+pb[1], +pb[2] - 1, +pb[3]);
  return Math.round((db - da) / 86_400_000);
}

/**
 * Tài sản không có giá thị trường hằng ngày (nhà, xe, tài sản khác) cần nhập tay định kỳ:
 *  - ngưỡng nhắc THEO LOẠI (có thể chỉnh riêng cho từng tài sản);
 *  - gợi ý khấu hao (chỉ GỢI Ý, bạn xác nhận mới ghi);
 *  - cảnh báo "định giá cũ" cho bảng cân đối.
 */
export const DEFAULT_REVIEW_DAYS = {
  market: 30, // cổ phiếu, quỹ, vàng
  real_estate: 183, // ~6 tháng
  vehicle: 90, // ~3 tháng
  other: 183,
} as const;

const looksLikeVehicle = (a: Asset): boolean => {
  const t = String((a.metadata as any)?.itemType || a.name || '').toLowerCase();
  return /(^|\s)(xe|ô tô|oto|otô|xe máy|xe hơi|ôtô|car)(\s|$)/.test(t);
};

/** Ngưỡng nhắc định giá lại (ngày); null với tiết kiệm (app tự tính theo lãi). */
export function staleThresholdDays(a: Asset): number | null {
  if (a.category === 'savings') return null;
  if (a.reviewIntervalDays && a.reviewIntervalDays > 0) return Math.round(a.reviewIntervalDays);
  if (a.category === 'stock' || a.category === 'fund' || a.category === 'gold') return DEFAULT_REVIEW_DAYS.market;
  if (a.category === 'real_estate') return DEFAULT_REVIEW_DAYS.real_estate;
  return looksLikeVehicle(a) ? DEFAULT_REVIEW_DAYS.vehicle : DEFAULT_REVIEW_DAYS.other;
}

export interface StaleInfo {
  assetId: string;
  name: string;
  category: Asset['category'];
  value: number;
  days: number;
  threshold: number;
}

/** Tài sản đang giữ đã quá ngưỡng nhắc định giá lại. */
export function staleValuation(a: Asset, today: string = todayLocalStr()): StaleInfo | null {
  if (a.status !== 'active') return null;
  const th = staleThresholdDays(a);
  if (th === null) return null;
  const days = daysBetween(a.lastValuationDate, today);
  if (days === null || days <= th) return null;
  return { assetId: a.id, name: a.name, category: a.category, value: a.currentValue, days, threshold: th };
}

export const listStaleValuations = (assets: Asset[], today: string = todayLocalStr()): StaleInfo[] =>
  assets.map((a) => staleValuation(a, today)).filter((x): x is StaleInfo => x !== null).sort((x, y) => y.value - x.value);

// ---------------------------------------------------------------- Khấu hao gợi ý
export interface DepreciationSuggestion {
  assetId: string;
  /** Tỷ lệ mất giá mỗi năm bạn khai báo (%). */
  ratePerYear: number;
  /** Số năm tính từ lần định giá gần nhất. */
  years: number;
  currentValue: number;
  suggestedValue: number;
  change: number;
}

/**
 * Gợi ý giá trị mới theo tỷ lệ mất giá hằng năm (giảm dần theo số dư): giá trị × (1 − tỷ lệ)^số năm kể từ lần định giá gần nhất.
 * Chỉ là GỢI Ý: không tự đổi số liệu. Trả về null nếu chưa khai tỷ lệ, chưa đủ 30 ngày, hoặc số gợi ý không đổi.
 */
export function suggestDepreciation(a: Asset, today: string = todayLocalStr()): DepreciationSuggestion | null {
  if (a.status !== 'active' || a.category === 'savings') return null;
  const rate = a.depreciationPerYear;
  if (rate === undefined || !(rate > 0) || rate >= 100) return null;
  const days = daysBetween(a.lastValuationDate, today);
  if (days === null || days < 30) return null;
  const years = days / 365;
  const suggested = Math.max(1, Math.round(a.currentValue * Math.pow(1 - rate / 100, years)));
  if (suggested === Math.round(a.currentValue)) return null;
  return { assetId: a.id, ratePerYear: rate, years, currentValue: a.currentValue, suggestedValue: suggested, change: suggested - a.currentValue };
}
