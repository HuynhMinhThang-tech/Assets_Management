import React, { useMemo } from 'react';
import { UserFinancialState } from '../types/finance';
import { formatVND } from '../utils/calculations';
import {
  BalanceLine,
  DebtLine,
  RatioStatus,
  calculateBalanceSheet,
  statusHigherIsBetter,
  statusLowerIsBetter,
} from '../utils/balanceSheet';

interface BalanceSheetViewProps {
  state: UserFinancialState;
}

const STATUS_STYLE: Record<RatioStatus, { label: string; className: string }> = {
  good: { label: 'An toàn', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  watch: { label: 'Cần theo dõi', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  risk: { label: 'Rủi ro cao', className: 'bg-rose-50 text-rose-700 border-rose-200' },
};

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const times = (v: number) => `${v.toFixed(2)}x`;
const months = (v: number) => `${v.toFixed(1)} tháng`;

function formatDateVN(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

/** Một dòng trong bảng cân đối. */
const Row: React.FC<{ label: string; value: number; indent?: boolean; negativeRed?: boolean }> = ({
  label,
  value,
  indent,
  negativeRed,
}) => (
  <div className={`flex items-center justify-between gap-4 py-1.5 text-sm ${indent ? 'pl-4' : ''}`}>
    <span className="text-slate-700 min-w-0 break-words">{label}</span>
    <span
      className={`font-mono tabular-nums shrink-0 ${
        negativeRed && value < 0 ? 'text-rose-600' : 'text-slate-900'
      }`}
    >
      {formatVND(value)}
    </span>
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="pt-3 pb-1 text-xs font-bold uppercase tracking-wider text-slate-900">{children}</div>
);

const SubTotal: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-4 border-t border-slate-200 mt-1 py-2 text-sm font-semibold">
    <span className="text-slate-900">{label}</span>
    <span className="font-mono tabular-nums text-slate-900">{formatVND(value)}</span>
  </div>
);

const GrandTotal: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 border border-slate-200 mt-3 px-3 py-2.5 text-sm font-bold">
    <span className="uppercase tracking-wider text-slate-900">{label}</span>
    <span className="font-mono tabular-nums text-slate-900">{formatVND(value)}</span>
  </div>
);

const assetRows = (lines: BalanceLine[]) =>
  lines.map((l) => <Row key={l.key} label={l.label} value={l.value} indent />);

const debtRows = (lines: DebtLine[]) =>
  lines.map((l) => <Row key={l.key} label={l.label} value={l.value} indent />);

/** Thẻ chỉ số: tên (kèm công thức) + giá trị + nhãn đánh giá. */
const RatioCard: React.FC<{
  label: string;
  value: string | null;
  /** Hiện thay cho giá trị khi chưa tính được (vd. không có nợ ngắn hạn). */
  emptyLabel?: string;
  status?: RatioStatus | null;
}> = ({ label, value, emptyLabel, status }) => (
  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between gap-3">
    <div className="text-xs font-semibold text-slate-700">{label}</div>
    <div className="flex items-end justify-between gap-2">
      {value !== null ? (
        <span className="text-xl font-extrabold text-slate-900 font-mono tabular-nums">{value}</span>
      ) : (
        <span className="text-sm font-semibold text-slate-500">{emptyLabel ?? '—'}</span>
      )}
      {status && (
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status].className}`}
        >
          {STATUS_STYLE[status].label}
        </span>
      )}
    </div>
  </div>
);

const RatioGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-3">
    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">{title}</h3>
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">{children}</div>
  </section>
);

export const BalanceSheetView: React.FC<BalanceSheetViewProps> = ({ state }) => {
  const bs = useMemo(() => calculateBalanceSheet(state), [state]);
  const r = bs.ratios;

  const debtPct = bs.totalAssets > 0 ? Math.min(100, Math.max(0, (bs.totalLiabilities / bs.totalAssets) * 100)) : 0;
  const equityPct = 100 - debtPct;

  // Trạng thái đánh giá (ngưỡng thông dụng cho tài chính cá nhân)
  const sDebtToAssets = r.debtToAssets === null ? null : statusLowerIsBetter(r.debtToAssets, 0.4, 0.6);
  const negativeEquity = bs.equity.total <= 0 && bs.totalLiabilities > 0;
  const sDebtToEquity = negativeEquity ? 'risk' : r.debtToEquity === null ? null : statusLowerIsBetter(r.debtToEquity, 0.67, 1.5);
  const sEquityRatio = r.equityRatio === null ? null : statusHigherIsBetter(r.equityRatio, 0.6, 0.4);
  const sCurrent: RatioStatus | null = r.currentRatio === null ? 'good' : statusHigherIsBetter(r.currentRatio, 1.5, 1);
  const sCash: RatioStatus | null = r.cashRatio === null ? 'good' : statusHigherIsBetter(r.cashRatio, 1, 0.5);
  const sCashMonths: RatioStatus | null = r.cashMonths === null ? 'good' : statusHigherIsBetter(r.cashMonths, 6, 3);
  const sLtv = r.ltv === null ? null : statusLowerIsBetter(r.ltv, 0.6, 0.8);

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-slate-900">Bảng cân đối tài sản và nợ</h2>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
          Tại ngày {formatDateVN(bs.asOf)}
        </span>
      </div>

      {/* 1. TỔNG HỢP */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Tổng tài sản</div>
          <div className="text-2xl font-extrabold text-slate-900 font-mono tabular-nums">{formatVND(bs.totalAssets)}</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Nợ phải trả</div>
          <div className="text-2xl font-extrabold text-rose-600 font-mono tabular-nums">{formatVND(bs.totalLiabilities)}</div>
        </div>
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Vốn chủ sở hữu</div>
          <div
            className={`text-2xl font-extrabold font-mono tabular-nums ${
              bs.equity.total < 0 ? 'text-rose-600' : 'text-emerald-600'
            }`}
          >
            {formatVND(bs.equity.total)}
          </div>
        </div>
      </div>

      {/* 2. CƠ CẤU NGUỒN VỐN */}
      {bs.totalAssets > 0 && (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="uppercase tracking-wider text-slate-900">Cơ cấu nguồn vốn</span>
            <span className="font-mono text-slate-700">
              Nợ {debtPct.toFixed(1)}% · Vốn chủ {equityPct.toFixed(1)}%
            </span>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Cơ cấu nguồn vốn">
            <div className="h-full bg-rose-500" style={{ width: `${debtPct}%` }} />
            <div className="h-full bg-emerald-500" style={{ width: `${equityPct}%` }} />
          </div>
        </div>
      )}

      {/* 3. BẢNG CÂN ĐỐI */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <section className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider pb-2 border-b border-slate-200">Tài sản</h3>

          <SectionTitle>A. Tài sản ngắn hạn</SectionTitle>
          {assetRows(bs.currentAssets.lines)}
          <SubTotal label="Cộng tài sản ngắn hạn" value={bs.currentAssets.total} />

          <SectionTitle>B. Tài sản dài hạn</SectionTitle>
          {assetRows(bs.nonCurrentAssets.lines)}
          <SubTotal label="Cộng tài sản dài hạn" value={bs.nonCurrentAssets.total} />

          <GrandTotal label="Tổng tài sản" value={bs.totalAssets} />
        </section>

        <section className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider pb-2 border-b border-slate-200">
            Nợ phải trả và vốn chủ sở hữu
          </h3>

          <SectionTitle>A. Nợ phải trả</SectionTitle>
          <div className="pl-0 pt-1 text-xs font-semibold text-slate-700">I. Nợ ngắn hạn (gốc đến hạn trong 12 tháng)</div>
          {debtRows(bs.currentLiabilities.lines)}
          <SubTotal label="Cộng nợ ngắn hạn" value={bs.currentLiabilities.total} />
          <div className="pt-2 text-xs font-semibold text-slate-700">II. Nợ dài hạn</div>
          {debtRows(bs.nonCurrentLiabilities.lines)}
          <SubTotal label="Cộng nợ dài hạn" value={bs.nonCurrentLiabilities.total} />
          <SubTotal label="Cộng nợ phải trả" value={bs.totalLiabilities} />

          <SectionTitle>B. Vốn chủ sở hữu</SectionTitle>
          <Row label="Vốn nạp ròng (đã nạp − đã rút)" value={bs.equity.contributed} indent negativeRed />
          <Row label="Lãi/lỗ lũy kế" value={bs.equity.retained} indent negativeRed />
          <SubTotal label="Cộng vốn chủ sở hữu" value={bs.equity.total} />

          <GrandTotal label="Tổng nguồn vốn" value={bs.totalLiabilitiesAndEquity} />
        </section>
      </div>

      {/* 4. CHỈ SỐ PHÂN TÍCH */}
      <RatioGroup title="Thanh khoản">
        <RatioCard
          label="Tỷ số thanh toán hiện hành (Tài sản ngắn hạn / Nợ ngắn hạn)"
          value={r.currentRatio === null ? null : times(r.currentRatio)}
          emptyLabel="Không có nợ ngắn hạn"
          status={sCurrent}
        />
        <RatioCard
          label="Tỷ số tiền mặt (Tiền mặt / Nợ ngắn hạn)"
          value={r.cashRatio === null ? null : times(r.cashRatio)}
          emptyLabel="Không có nợ ngắn hạn"
          status={sCash}
        />
        <RatioCard
          label="Tỷ trọng tài sản ngắn hạn (Tài sản ngắn hạn / Tổng tài sản)"
          value={r.liquidShare === null ? null : pct(r.liquidShare)}
        />
      </RatioGroup>

      <RatioGroup title="Đòn bẩy và an toàn tài chính">
        <RatioCard
          label="Hệ số nợ (Nợ phải trả / Tổng tài sản)"
          value={r.debtToAssets === null ? null : pct(r.debtToAssets)}
          status={sDebtToAssets}
        />
        <RatioCard
          label="Nợ / Vốn chủ sở hữu"
          value={r.debtToEquity === null ? null : times(r.debtToEquity)}
          emptyLabel={negativeEquity ? 'Vốn chủ ≤ 0' : '—'}
          status={sDebtToEquity}
        />
        <RatioCard
          label="Tỷ lệ vốn chủ (Vốn chủ sở hữu / Tổng tài sản)"
          value={r.equityRatio === null ? null : pct(r.equityRatio)}
          status={sEquityRatio}
        />
        <RatioCard
          label="Đòn bẩy tài chính (Tổng tài sản / Vốn chủ sở hữu)"
          value={r.leverage === null ? null : times(r.leverage)}
          emptyLabel={negativeEquity ? 'Vốn chủ ≤ 0' : '—'}
        />
        <RatioCard
          label="LTV bình quân (Nợ thế chấp / Thị giá tài sản thế chấp)"
          value={r.ltv === null ? null : pct(r.ltv)}
          emptyLabel="Không có nợ thế chấp"
          status={sLtv}
        />
      </RatioGroup>

      <RatioGroup title="Khả năng trả nợ và chi phí vay">
        <RatioCard label="Nghĩa vụ trả nợ hàng tháng (gốc + lãi)" value={formatVND(r.monthlyObligation)} />
        <RatioCard
          label="Số tháng trả nợ bằng tiền mặt (Tiền mặt / Nghĩa vụ hàng tháng)"
          value={r.cashMonths === null ? null : months(r.cashMonths)}
          emptyLabel="Không có nghĩa vụ trả nợ"
          status={sCashMonths}
        />
        <RatioCard
          label="Thu nhập cho thuê / Nghĩa vụ trả nợ hàng tháng"
          value={r.rentCoverage === null ? null : pct(r.rentCoverage)}
          emptyLabel="Không có nghĩa vụ trả nợ"
        />
        <RatioCard
          label="Lãi suất vay bình quân gia quyền (%/năm)"
          value={r.weightedRate === null ? null : `${r.weightedRate.toFixed(2)}%`}
          emptyLabel="Không có khoản nợ"
        />
      </RatioGroup>
    </div>
  );
};
