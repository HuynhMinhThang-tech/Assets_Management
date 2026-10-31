import React from 'react';
import { AllocationSlice } from '../utils/allocation';
import { formatVND } from '../utils/calculations';

interface AllocationDonutProps {
  slices: AllocationSlice[];
  total: number;
}

const SIZE = 120;
const R = 46;
const STROKE = 18;
const C = 2 * Math.PI * R;
/** Khe hở giữa các lát (đơn vị chiều dài cung) để lát cạnh nhau, màu gần giống vẫn phân biệt được. */
const GAP = 1.2;

/** Biểu đồ vành khuyên phân bổ danh mục bằng SVG thuần (không dùng thư viện). Giữa vòng là tổng tài sản đầu tư. */
export const AllocationDonut: React.FC<AllocationDonutProps> = ({ slices, total }) => {
  let offset = 0;
  const arcs = slices.map((s) => {
    const len = (s.pct / 100) * C;
    const visible = slices.length > 1 ? Math.max(0, len - GAP) : len;
    const arc = { slice: s, dash: `${visible.toFixed(3)} ${(C - visible).toFixed(3)}`, offset: -offset };
    offset += len;
    return arc;
  });

  return (
    <div className="relative mx-auto h-44 w-44 shrink-0">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-full w-full"
        role="img"
        aria-label="Biểu đồ tròn phân bổ danh mục tài sản"
      >
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="currentColor" strokeWidth={STROKE} className="text-slate-100" />
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {arcs.map(({ slice, dash, offset: off }) => (
            <circle
              key={slice.key}
              data-slice={slice.key}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={slice.color}
              strokeWidth={STROKE}
              strokeDasharray={dash}
              strokeDashoffset={off}
            >
              <title>{`${slice.label}: ${formatVND(slice.value, { compact: true })} (${slice.pct.toFixed(1)}%)`}</title>
            </circle>
          ))}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Tổng tài sản</span>
        <span className="mt-0.5 font-mono text-sm font-extrabold tabular-nums text-slate-900">
          {formatVND(total, { compact: true })}
        </span>
      </div>
    </div>
  );
};
