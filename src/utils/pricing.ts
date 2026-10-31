import { Asset } from '../types/finance';

/**
 * Cập nhật giá theo ĐƠN GIÁ của từng loại tài sản. Tổng giá trị là kết quả tính (số lượng × đơn giá),
 * không phải số người dùng nhập.
 *   Cổ phiếu: giá mỗi cổ phiếu · Quỹ: NAV mỗi CCQ · Vàng: giá mỗi chỉ · Bất động sản: giá/m² (nếu có diện tích).
 * Tiết kiệm, tài sản khác (và BĐS chưa khai diện tích) không có đơn giá → vẫn nhập tổng giá trị.
 */
export interface UnitPricing {
  /** Tên đơn vị đứng sau "mỗi": cổ phiếu, CCQ, chỉ, m². */
  unit: string;
  /** Số lượng nhân với đơn giá. */
  quantity: number;
  /** Đơn giá hiện tại (suy từ tổng giá trị hiện tại ÷ số lượng). */
  unitPrice: number;
  /** Cho phép nhập số thập phân (NAV của quỹ). */
  allowDecimal: boolean;
}

const UNIT_SPEC: Record<string, { key: string; unit: string; allowDecimal: boolean } | undefined> = {
  stock: { key: 'quantity', unit: 'cổ phiếu', allowDecimal: false },
  fund: { key: 'units', unit: 'CCQ', allowDecimal: true },
  gold: { key: 'quantityChi', unit: 'chỉ', allowDecimal: false },
  real_estate: { key: 'areaM2', unit: 'm²', allowDecimal: false },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Trả về null nếu tài sản không có đơn giá để cập nhật (nhập tổng giá trị). */
export function getUnitPricing(asset: Asset): UnitPricing | null {
  const spec = UNIT_SPEC[asset.category];
  if (!spec) return null;
  const quantity = Number((asset.metadata as any)?.[spec.key]) || 0;
  if (!(quantity > 0)) return null;
  const raw = asset.currentValue / quantity;
  return {
    unit: spec.unit,
    quantity,
    unitPrice: spec.allowDecimal ? round2(raw) : Math.round(raw),
    allowDecimal: spec.allowDecimal,
  };
}

/** Tổng giá trị = số lượng × đơn giá (làm tròn đến đồng). */
export function totalFromUnitPrice(quantity: number, unitPrice: number): number {
  return Math.round(quantity * unitPrice);
}

export interface RevaluationInput {
  /** Đơn giá mới (dùng khi tài sản có đơn giá). */
  unitPrice?: number;
  /** Tổng giá trị mới (chỉ dùng cho tài sản không có đơn giá: tiết kiệm, tài sản khác). */
  totalValue?: number;
}

/**
 * Áp một lần định giá lên tài sản: cập nhật tổng giá trị, đơn giá trong thuộc tính chuyên biệt
 * và ghi lịch sử định giá (đơn giá + tổng). Trả về chính tài sản cũ nếu dữ liệu không hợp lệ.
 */
export function applyRevaluation(asset: Asset, input: RevaluationInput, today: string): Asset {
  const pricing = getUnitPricing(asset);
  const md: any = { ...asset.metadata };
  let value: number;
  let unitPrice: number | undefined;

  if (pricing && input.unitPrice !== undefined) {
    if (!(input.unitPrice > 0) || !Number.isFinite(input.unitPrice)) return asset;
    unitPrice = input.unitPrice;
    value = totalFromUnitPrice(pricing.quantity, unitPrice);
  } else if (input.totalValue !== undefined) {
    if (!(input.totalValue > 0) || !Number.isFinite(input.totalValue)) return asset;
    value = Math.round(input.totalValue);
    unitPrice = pricing ? (pricing.allowDecimal ? round2(value / pricing.quantity) : Math.round(value / pricing.quantity)) : undefined;
  } else {
    return asset;
  }
  if (!(value > 0)) return asset;

  if (asset.category === 'stock') md.currentPrice = unitPrice;
  if (asset.category === 'fund') md.currentNav = unitPrice;
  if (asset.category === 'gold') md.currentPerChi = unitPrice;
  if (asset.category === 'real_estate') md.estimatedMarketPrice = value;

  const entry = unitPrice !== undefined ? { date: today, value, unitPrice } : { date: today, value };
  const history = [...(asset.valuationHistory || [])];
  if (history.length && history[history.length - 1].date === today) history[history.length - 1] = entry;
  else history.push(entry);

  return {
    ...asset,
    currentValue: value,
    lastValuationDate: today,
    metadata: md,
    valuationHistory: history.slice(-240),
  };
}
