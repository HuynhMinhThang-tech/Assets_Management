import React from 'react';
import {
  Pencil,
  Hammer,
  CalendarClock,
  Coins,
  Repeat,
  DollarSign,
  Undo2,
  CreditCard,
  ShieldCheck,
} from 'lucide-react';
import {
  Asset,
  AssetCategory,
  Debt,
  FundMetadata,
  GoldMetadata,
  RealEstateMetadata,
  SavingsMetadata,
  StockMetadata,
} from '../../types/finance';
import { formatPercent, formatVND } from '../../utils/calculations';
import { getRecurringIncome } from '../../utils/calendar';
import { PwaAction, PwaBadge, PwaCard, PwaChips, PwaResultLine, PwaSearch, PwaSegmented, PwaStat } from './pwaUi';

export const ASSET_CATEGORY_LABEL: Record<AssetCategory, string> = {
  real_estate: 'Bất động sản',
  stock: 'Cổ phiếu',
  fund: 'Chứng chỉ quỹ',
  savings: 'Tiết kiệm',
  gold: 'Vàng',
  other: 'Khác',
};

type StatusFilter = 'all' | 'active' | 'sold' | 'voided';

// ------------------------------------------------------------------ Tổng hợp danh mục
export interface PwaAssetsSummaryProps {
  portfolioValue: number;
  portfolioCost: number;
  portfolioPnL: number;
  portfolioPnLPct: number;
  realizedFromSales: number;
  activeCount: number;
  categoryTotals: { id: AssetCategory; label: string; count: number; value: number }[];
  categoryColors: Record<AssetCategory, string>;
}

export const PwaAssetsSummary: React.FC<PwaAssetsSummaryProps> = ({
  portfolioValue,
  portfolioCost,
  portfolioPnL,
  portfolioPnLPct,
  realizedFromSales,
  activeCount,
  categoryTotals,
  categoryColors,
}) => (
  <PwaCard className="p-3.5" data-pwa-assets-summary="">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-slate-500">Tổng thị giá tài sản</div>
        <div className="mt-0.5 truncate font-mono text-[18px] min-[360px]:text-[22px] font-bold leading-tight tracking-tight tabular-nums text-slate-900">
          {formatVND(portfolioValue)}
        </div>
      </div>
      <PwaBadge>{activeCount} đang nắm giữ</PwaBadge>
    </div>

    {categoryTotals.length > 0 ? (
      <div className="mt-3">
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
          {categoryTotals.map((c) => (
            <div
              key={c.id}
              className="h-full"
              style={{
                width: `${portfolioValue > 0 ? (c.value / portfolioValue) * 100 : 0}%`,
                backgroundColor: categoryColors[c.id],
              }}
              title={`${c.label}: ${portfolioValue > 0 ? ((c.value / portfolioValue) * 100).toFixed(1) : 0}%`}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {categoryTotals.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: categoryColors[c.id] }} />
              <span className="font-medium">{c.label}</span>
              <span className="font-mono text-slate-500">
                {portfolioValue > 0 ? ((c.value / portfolioValue) * 100).toFixed(0) : 0}%
              </span>
            </span>
          ))}
        </div>
      </div>
    ) : (
      <p className="mt-2 text-xs text-slate-400">Chưa có tài sản đang nắm giữ.</p>
    )}

    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
      <PwaStat label="Giá vốn" value={formatVND(portfolioCost, { compact: true })} title={formatVND(portfolioCost)} />
      <PwaStat
        label="Lãi/lỗ sổ sách"
        value={`${portfolioPnL >= 0 ? '+' : ''}${formatVND(portfolioPnL, { compact: true })}`}
        sub={formatPercent(portfolioPnLPct)}
        valueClass={portfolioPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'}
        title={formatVND(portfolioPnL)}
      />
      <PwaStat
        label="Lãi chốt từ bán"
        value={`${realizedFromSales >= 0 ? '+' : ''}${formatVND(realizedFromSales, { compact: true })}`}
        valueClass={realizedFromSales > 0 ? 'text-emerald-600' : realizedFromSales < 0 ? 'text-rose-600' : 'text-slate-900'}
        title={formatVND(realizedFromSales)}
      />
    </div>
  </PwaCard>
);

// ------------------------------------------------------------------ Bộ lọc
export interface PwaAssetsFiltersProps {
  categories: { id: AssetCategory | 'all'; label: string }[];
  selectedCategory: AssetCategory | 'all';
  onCategory: (c: AssetCategory | 'all') => void;
  countByCategory: (c: AssetCategory | 'all') => number;
  statusFilter: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  countByStatus: (s: StatusFilter) => number;
  searchQuery: string;
  onSearch: (q: string) => void;
  shown: number;
  total: number;
  filtersActive: boolean;
  onClear: () => void;
}

export const PwaAssetsFilters: React.FC<PwaAssetsFiltersProps> = (p) => (
  <PwaCard className="space-y-2.5 p-3.5" data-pwa-assets-filters="">
    <PwaSearch
      id="asset-search"
      value={p.searchQuery}
      onChange={p.onSearch}
      placeholder="Tìm tên tài sản, mã cổ phiếu, dự án…"
    />
    <PwaChips
      label="Loại tài sản"
      attr="data-asset-category"
      value={p.selectedCategory}
      onChange={p.onCategory}
      items={p.categories.map((c) => ({
        id: c.id,
        label: c.id === 'all' ? 'Mọi loại' : c.label,
        count: p.countByCategory(c.id),
      }))}
    />
    <PwaSegmented
      label="Trạng thái"
      value={p.statusFilter}
      onChange={p.onStatus}
      items={[
        { id: 'active', label: 'Đang giữ', count: p.countByStatus('active') },
        { id: 'sold', label: 'Đã bán', count: p.countByStatus('sold') },
        { id: 'voided', label: 'Đã hủy', count: p.countByStatus('voided') },
        { id: 'all', label: 'Tất cả', count: p.countByStatus('all') },
      ]}
    />
    <PwaResultLine
      shown={p.shown}
      total={p.total}
      noun="tài sản"
      onClear={p.filtersActive ? p.onClear : undefined}
    />
  </PwaCard>
);

// ------------------------------------------------------------------ Dòng thông số riêng của từng loại
function MetaLines({ asset, linkedDebt }: { asset: Asset; linkedDebt?: Debt }) {
  const lines: React.ReactNode[] = [];
  const mono = 'font-mono';
  if (asset.category === 'stock') {
    const m = asset.metadata as StockMetadata;
    lines.push(
      <span key="m">
        <span className="font-semibold text-slate-700">{m.symbol}</span> · Sàn {m.exchange} · SL{' '}
        <span className={mono}>{m.quantity.toLocaleString()} CP</span> · Vốn{' '}
        <span className={mono}>{formatVND(m.avgCostPrice)}</span>
      </span>
    );
  } else if (asset.category === 'real_estate') {
    const m = asset.metadata as RealEstateMetadata;
    lines.push(
      <span key="m">
        {m.address} · {m.areaM2} m²
      </span>
    );
    lines.push(
      <span key="r">
        Thuê:{' '}
        <span className={`${mono} font-semibold text-emerald-600`}>{formatVND(m.monthlyRentalIncome)}/tháng</span>
        {m.rentalDayOfMonth ? <span> · nhận ngày {m.rentalDayOfMonth}</span> : null}
      </span>
    );
  } else if (asset.category === 'fund') {
    const m = asset.metadata as FundMetadata;
    lines.push(
      <span key="m">
        Quỹ {m.fundCode} · SL <span className={mono}>{m.units.toLocaleString()} CCQ</span> · NAV vốn{' '}
        {formatVND(m.avgNav)}
      </span>
    );
  } else if (asset.category === 'savings') {
    const m = asset.metadata as SavingsMetadata;
    lines.push(
      <span key="m">
        {m.bankName} · Lãi suất <span className={`${mono} font-semibold`}>{m.annualInterestRate}%/năm</span> · Đáo
        hạn {m.maturityDate}
      </span>
    );
  } else if (asset.category === 'gold') {
    const m = asset.metadata as GoldMetadata;
    lines.push(
      <span key="m">
        {m.goldType} · SL <span className={mono}>{m.quantityChi} chỉ</span> · Vốn {formatVND(m.costPerChi)}/chỉ
      </span>
    );
  } else if (asset.category === 'other') {
    const rec = getRecurringIncome(asset);
    if (rec) {
      lines.push(
        <span key="m">
          Thu nhập:{' '}
          <span className={`${mono} font-semibold text-emerald-600`}>{formatVND(rec.amount)}/tháng</span> · nhận ngày{' '}
          {rec.day}
        </span>
      );
    }
  }
  if (asset.notes) {
    lines.push(
      <span key="n" className="italic text-slate-400">
        {asset.notes}
      </span>
    );
  }
  return (
    <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-slate-500">
      {lines.map((l, i) => (
        <div key={i} className={i === lines.length - 1 && asset.notes ? 'line-clamp-2' : undefined}>
          {l}
        </div>
      ))}
      {linkedDebt && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
          {linkedDebt.securityType === 'unsecured' ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-semibold text-amber-800">
              <CreditCard className="h-3 w-3 text-amber-600" />
              Tín chấp
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-sky-200 bg-sky-50 px-1.5 py-px text-[10px] font-semibold text-sky-800">
              <ShieldCheck className="h-3 w-3 text-sky-600" />
              Thế chấp
            </span>
          )}
          <span className="min-w-0 text-slate-700">
            {linkedDebt.lender} ({linkedDebt.name}) · Dư nợ{' '}
            <strong className="font-mono text-rose-600">
              {formatVND(linkedDebt.remainingPrincipal, { compact: true })}
            </strong>{' '}
            · Lãi {linkedDebt.annualInterestRate}%
          </span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Thẻ một tài sản
export interface PwaAssetCardProps {
  asset: Asset;
  linkedDebt?: Debt;
  canVoid: boolean;
  onEdit: () => void;
  onImprove: () => void;
  onIncome: () => void;
  onInterest: () => void;
  onRollover: () => void;
  onSell: () => void;
  onVoid: () => void;
}

export const PwaAssetCard: React.FC<PwaAssetCardProps> = ({
  asset,
  linkedDebt,
  canVoid,
  onEdit,
  onImprove,
  onIncome,
  onInterest,
  onRollover,
  onSell,
  onVoid,
}) => {
  const pnl = asset.currentValue - asset.initialCost;
  const pnlPct = asset.initialCost > 0 ? (pnl / asset.initialCost) * 100 : 0;
  const isSold = asset.status === 'sold';
  const isVoided = asset.status === 'voided';
  const open = !isSold && !isVoided;
  const isProperty = asset.category === 'real_estate' || asset.category === 'other';
  const toneCls = pnl >= 0 ? 'text-emerald-600' : 'text-rose-600';

  return (
    <PwaCard as="section" className={`p-3.5 ${isSold || isVoided ? 'opacity-80' : ''}`} data-pwa-asset={asset.id}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-snug text-slate-900">{asset.name}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span>{ASSET_CATEGORY_LABEL[asset.category]}</span>
            {isSold && <PwaBadge>Đã bán</PwaBadge>}
            {isVoided && <PwaBadge tone="rose">Đã hủy</PwaBadge>}
          </div>
        </div>
        {canVoid && (
          <button
            type="button"
            data-void-asset={asset.id}
            onClick={onVoid}
            title="Hủy bản ghi nhập nhầm"
            aria-label="Hủy bản ghi nhập nhầm"
            className="-mr-1 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-400 active:bg-rose-50 active:text-rose-600"
          >
            <Undo2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <MetaLines asset={asset} linkedDebt={linkedDebt} />

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-xl bg-slate-50 p-2.5">
        <PwaStat label="Giá vốn" value={formatVND(asset.initialCost)} />
        <PwaStat
          label="Thị giá hiện tại"
          value={isSold ? '0 ₫' : formatVND(asset.currentValue)}
          sub={asset.lastValuationDate}
        />
        <PwaStat
          label="Lãi/lỗ sổ sách"
          value={isSold ? '—' : `${pnl >= 0 ? '+' : ''}${formatVND(pnl)}`}
          sub={isSold ? undefined : formatPercent(pnlPct)}
          valueClass={isSold ? 'text-slate-400' : toneCls}
        />
        <PwaStat
          label="Lãi chốt thực tế"
          value={
            asset.realizedPnL > 0 ? `+${formatVND(asset.realizedPnL)}` : asset.realizedPnL < 0 ? formatVND(asset.realizedPnL) : '0 ₫'
          }
          valueClass={asset.realizedPnL > 0 ? 'text-emerald-700' : asset.realizedPnL < 0 ? 'text-rose-700' : 'text-slate-400'}
        />
      </div>

      {open && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <PwaAction
            label="Sửa thông tin"
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={onEdit}
            data-asset-action="edit"
            title="Sửa thông tin (tên, ghi chú, ngày mua…)"
          />
          {isProperty && (
            <PwaAction
              label="Cải tạo"
              icon={<Hammer className="h-3.5 w-3.5" />}
              onClick={onImprove}
              data-asset-action="improve"
              title="Ghi chi phí cải tạo / đầu tư thêm (cộng vào giá vốn)"
            />
          )}
          {isProperty && (
            <PwaAction
              label="Thu nhập tháng"
              tone="info"
              icon={<CalendarClock className="h-3.5 w-3.5" />}
              onClick={onIncome}
              data-asset-action="income"
              title="Thu nhập hàng tháng (cho thuê…) – hiển thị trên Lịch"
            />
          )}
          {asset.category === 'savings' && (
            <>
              <PwaAction
                label="Nhận lãi"
                tone="warn"
                icon={<Coins className="h-3.5 w-3.5" />}
                onClick={onInterest}
                data-savings-action="interest"
                title="Nhận lãi về ví"
              />
              <PwaAction
                label="Tái tục"
                tone="info"
                icon={<Repeat className="h-3.5 w-3.5" />}
                onClick={onRollover}
                data-savings-action="rollover"
                title="Tái tục sổ tiết kiệm"
              />
            </>
          )}
          <PwaAction
            label={asset.category === 'savings' ? 'Rút tiền' : 'Bán / Chốt lời'}
            tone="success"
            icon={<DollarSign className="h-3.5 w-3.5" />}
            onClick={onSell}
            data-asset-action="sell"
            title={asset.category === 'savings' ? 'Rút tiền tiết kiệm' : 'Bán / Chốt lời về ví'}
          />
        </div>
      )}
    </PwaCard>
  );
};
