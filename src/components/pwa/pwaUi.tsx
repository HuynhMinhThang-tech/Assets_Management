import React from 'react';
import { Search, X } from 'lucide-react';

/**
 * Các thành phần giao diện nhỏ dùng chung cho các màn hình ở chế độ ứng dụng (PWA).
 * Chỉ là phần trình bày: không chứa nghiệp vụ, không đụng tới dữ liệu.
 */

export const CARD_CLS = 'rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(28,27,24,0.04)]';

export const PwaCard: React.FC<{
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'section';
  [key: `data-${string}`]: string | undefined;
}> = ({ children, className = '', as: Tag = 'div', ...rest }) => (
  <Tag className={`${CARD_CLS} ${className}`} {...rest}>
    {children}
  </Tag>
);

/** Một ô số liệu: nhãn nhỏ phía trên, số mono phía dưới. */
export const PwaStat: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  valueClass?: string;
  className?: string;
  title?: string;
}> = ({ label, value, sub, valueClass = 'text-slate-900', className = '', title }) => (
  <div className={`min-w-0 ${className}`} title={title}>
    <div className="truncate text-[11px] font-medium text-slate-500">{label}</div>
    <div className={`mt-0.5 truncate font-mono text-[13px] font-semibold tabular-nums ${valueClass}`}>{value}</div>
    {sub !== undefined && sub !== null && sub !== '' && (
      <div className="mt-px truncate font-mono text-[11px] tabular-nums text-slate-500">{sub}</div>
    )}
  </div>
);

export interface ChipItem<T extends string> {
  id: T;
  label: string;
  count?: number;
  /** thuộc tính data-* để test chọn theo id */
  dataAttr?: string;
}

/** Hàng chip cuộn ngang (chọn một). */
export function PwaChips<T extends string>({
  items,
  value,
  onChange,
  label,
  attr,
}: {
  items: ChipItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  attr?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="no-scrollbar -mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 pb-0.5"
    >
      {items.map((it) => {
        const active = it.id === value;
        const dataProps = attr ? ({ [attr]: it.id } as Record<string, string>) : {};
        return (
          <button
            key={it.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(it.id)}
            {...dataProps}
            className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-colors ${
              active
                ? 'border-accent bg-accent text-on-accent'
                : 'border-slate-200 bg-white text-slate-600 active:bg-slate-100'
            }`}
          >
            <span>{it.label}</span>
            {it.count !== undefined && (
              <span
                className={`font-mono text-[11px] ${active ? 'text-on-accent/80' : 'text-slate-400'}`}
              >
                {it.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Thanh chọn một trong vài mục, chia đều bề ngang. */
export function PwaSegmented<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: ChipItem<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-xl bg-slate-100 p-1">
      {items.map((it) => {
        const active = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(it.id)}
            className={`flex min-h-[34px] min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1.5 text-xs font-semibold transition-colors ${
              active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 active:text-slate-900'
            }`}
          >
            <span className="truncate">{it.label}</span>
            {it.count !== undefined && (
              <span className="font-mono text-[11px] text-slate-400">{it.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export const PwaSearch: React.FC<{
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}> = ({ id, value, onChange, placeholder }) => (
  <div className="relative">
    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    <input
      id={id}
      type="search"
      inputMode="search"
      enterKeyHint="search"
      autoComplete="off"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
    />
    {value && (
      <button
        type="button"
        aria-label="Xóa nội dung tìm kiếm"
        onClick={() => onChange('')}
        className="absolute right-1 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 active:bg-slate-100"
      >
        <X className="h-4 w-4" />
      </button>
    )}
  </div>
);

/** Dòng "Hiển thị n/m ... · Xóa lọc" dưới bộ lọc. */
export const PwaResultLine: React.FC<{
  shown: number;
  total: number;
  noun: string;
  onClear?: () => void;
  children?: React.ReactNode;
}> = ({ shown, total, noun, onClear, children }) => (
  <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
    <span>
      Hiển thị <strong className="text-slate-800">{shown}</strong>/{total} {noun}
    </span>
    <span className="flex items-center gap-3">
      {children}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="min-h-[28px] font-semibold text-accent-ink active:opacity-70"
        >
          Xóa lọc
        </button>
      )}
    </span>
  </div>
);

/** Nút thao tác trong thẻ danh sách: có biểu tượng + nhãn, cao ≥ 40px để dễ chạm. */
export type ActionTone = 'neutral' | 'primary' | 'success' | 'info' | 'warn' | 'danger';
const ACTION_TONE: Record<ActionTone, string> = {
  neutral: 'border-slate-200 bg-white text-slate-700 active:bg-slate-100',
  primary: 'border-accent bg-accent text-on-accent active:bg-accent-hover',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700 active:bg-emerald-100',
  info: 'border-sky-200 bg-sky-50 text-sky-700 active:bg-sky-100',
  warn: 'border-amber-200 bg-amber-50 text-amber-700 active:bg-amber-100',
  danger: 'border-rose-200 bg-white text-rose-600 active:bg-rose-50',
};

export const PwaAction: React.FC<{
  label: string;
  icon?: React.ReactNode;
  tone?: ActionTone;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
  [key: `data-${string}`]: string | undefined;
}> = ({ label, icon, tone = 'neutral', onClick, disabled, title, className = '', ...rest }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    {...rest}
    className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${ACTION_TONE[tone]} ${className}`}
  >
    {icon}
    <span className="whitespace-nowrap">{label}</span>
  </button>
);

/** Huy hiệu nhỏ (nhãn trạng thái / loại). */
export const PwaBadge: React.FC<{ children: React.ReactNode; tone?: 'slate' | 'rose' | 'emerald' | 'amber' | 'sky' }> = ({
  children,
  tone = 'slate',
}) => {
  const cls = {
    slate: 'border-slate-200 bg-slate-100 text-slate-600',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    sky: 'border-sky-200 bg-sky-50 text-sky-800',
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-md border px-1.5 py-px text-[10px] font-semibold ${cls}`}>
      {children}
    </span>
  );
};

export const PwaEmpty: React.FC<{ icon?: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className={`${CARD_CLS} px-4 py-10 text-center text-xs text-slate-400`}>
    {icon && <div className="mx-auto mb-2 flex justify-center text-slate-300">{icon}</div>}
    <p>{children}</p>
  </div>
);
