import { AssetCategory } from '../types/finance';

/** Nhãn + màu CỐ ĐỊNH theo nhóm tài sản (dùng chung cho biểu đồ và chú giải). */
export const CATEGORY_META: Record<AssetCategory, { label: string; color: string }> = {
  real_estate: { label: 'Bất động sản', color: '#0284c7' },
  stock: { label: 'Cổ phiếu niêm yết', color: '#16a34a' },
  fund: { label: 'Chứng chỉ quỹ', color: '#8b5cf6' },
  savings: { label: 'Tiền gửi / Trái phiếu', color: '#f59e0b' },
  gold: { label: 'Vàng & Kim loại quý', color: '#eab308' },
  other: { label: 'Khác', color: '#64748b' },
};

/** Nhóm chiếm dưới ngưỡng này (%) được gộp vào lát "Khác". */
export const MIN_SLICE_PCT = 3;

export interface AllocationSlice {
  key: AssetCategory;
  label: string;
  color: string;
  /** Thị giá của lát (VND). */
  value: number;
  /** Giá vốn của lát (VND). */
  cost: number;
  count: number;
  /** Tỷ trọng trên tổng tài sản đầu tư (%). */
  pct: number;
  /** Lãi/lỗ sổ sách của lát (%). */
  pnlPct: number;
  /** Các nhóm gốc nằm trong lát (nhiều hơn 1 khi là lát "Khác" đã gộp). */
  members: AssetCategory[];
}

export interface Allocation {
  total: number;
  slices: AllocationSlice[];
}

/**
 * Dựng các lát của biểu đồ tròn từ categoryBreakdown (chỉ tài sản đang nắm giữ → KHÔNG gồm tiền khả dụng).
 * Nhóm dưới `minPct`% gộp vào "Khác"; chỉ gộp khi có ít nhất 2 nhóm để gộp (một nhóm nhỏ đứng riêng
 * giữ nguyên tên, không bị đổi thành "Khác"). Lát "Khác" luôn đứng cuối, các lát còn lại xếp theo giá trị giảm dần.
 */
export function buildAllocation(
  breakdown: Record<string, { value: number; count: number; cost: number }>,
  minPct: number = MIN_SLICE_PCT
): Allocation {
  const entries = (Object.keys(CATEGORY_META) as AssetCategory[])
    .map((key) => ({ key, ...(breakdown[key] || { value: 0, count: 0, cost: 0 }) }))
    .filter((e) => e.value > 0);
  const total = entries.reduce((s, e) => s + e.value, 0);
  if (total <= 0) return { total: 0, slices: [] };

  const make = (e: { key: AssetCategory; value: number; count: number; cost: number }, members: AssetCategory[], label?: string): AllocationSlice => ({
    key: e.key,
    label: label || CATEGORY_META[e.key].label,
    color: CATEGORY_META[e.key].color,
    value: e.value,
    cost: e.cost,
    count: e.count,
    pct: (e.value / total) * 100,
    pnlPct: e.cost > 0 ? ((e.value - e.cost) / e.cost) * 100 : 0,
    members,
  });

  const small = entries.filter((e) => e.key !== 'other' && (e.value / total) * 100 < minPct);
  const otherEntry = entries.find((e) => e.key === 'other');
  const toMerge = [...small, ...(otherEntry ? [otherEntry] : [])];

  const keep = entries
    .filter((e) => !toMerge.some((m) => m.key === e.key))
    .sort((a, b) => b.value - a.value)
    .map((e) => make(e, [e.key]));

  if (toMerge.length === 0) return { total, slices: keep };
  if (toMerge.length === 1) {
    // Một nhóm lẻ: giữ nguyên tên. Nếu là chính nhóm "Khác" thì vẫn đứng cuối.
    const only = toMerge[0];
    const slice = make(only, [only.key]);
    return { total, slices: only.key === 'other' ? [...keep, slice] : [...keep, slice].sort((a, b) => b.value - a.value) };
  }
  const merged = make(
    {
      key: 'other',
      value: toMerge.reduce((s, e) => s + e.value, 0),
      cost: toMerge.reduce((s, e) => s + e.cost, 0),
      count: toMerge.reduce((s, e) => s + e.count, 0),
    },
    toMerge.map((e) => e.key),
    'Khác'
  );
  return { total, slices: [...keep, merged] };
}
