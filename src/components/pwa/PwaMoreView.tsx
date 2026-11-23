import React from 'react';
import {
  TrendingUp,
  CalendarDays,
  Scale,
  ShieldCheck,
  PlusCircle,
  ArrowDownRight,
  ChevronRight,
} from 'lucide-react';

export type PwaSecondaryTab = 'prices' | 'calendar' | 'balance' | 'admin';

interface PwaMoreViewProps {
  user: { displayName: string; email: string; role: 'admin' | 'user' };
  priceAlertCount: number;
  adminPendingCount: number;
  onSelectSubTab: (tab: PwaSecondaryTab) => void;
  onOpenAddAsset: () => void;
  onOpenAddDebt: () => void;
  onOpenDeposit: () => void;
  onOpenAccount: () => void;
}

const ROW_BTN =
  'w-full min-h-[52px] flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100';

export const PwaMoreView: React.FC<PwaMoreViewProps> = ({
  user,
  priceAlertCount,
  adminPendingCount,
  onSelectSubTab,
  onOpenAddAsset,
  onOpenAddDebt,
  onOpenDeposit,
  onOpenAccount,
}) => {
  const initial = (Array.from(user.displayName.trim())[0] || '?').toUpperCase();

  return (
    <div className="space-y-5 animate-tab-in" data-pwa-more>
      {/* Nhóm 1: Các tính năng mở rộng được đưa từ thanh điều hướng chính vào mục Khác */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Chức năng mở rộng
        </h2>
        <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(28,27,24,0.04)]">
          <button type="button" onClick={() => onSelectSubTab('prices')} className={ROW_BTN}>
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink">
                <TrendingUp className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">Cập nhật giá</div>
                <div className="truncate text-xs text-slate-500">Định giá cổ phiếu, quỹ, vàng & bất động sản</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {priceAlertCount > 0 && (
                <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-xs font-semibold text-amber-700">
                  {priceAlertCount}
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </div>
          </button>

          <button type="button" onClick={() => onSelectSubTab('calendar')} className={ROW_BTN}>
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
                <CalendarDays className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">Lịch thu chi</div>
                <div className="truncate text-xs text-slate-500">Theo dõi kỳ trả nợ & đáo hạn sắp tới</div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>

          <button type="button" onClick={() => onSelectSubTab('balance')} className={ROW_BTN}>
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
                <Scale className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">Báo cáo</div>
                <div className="truncate text-xs text-slate-500">Bảng cân đối tài sản, nợ & dòng tiền</div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>

          {user.role === 'admin' && (
            <button type="button" onClick={() => onSelectSubTab('admin')} className={ROW_BTN}>
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900">Quản trị</div>
                  <div className="truncate text-xs text-slate-500">Duyệt tài khoản & hỗ trợ người dùng</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {adminPendingCount > 0 && (
                  <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-xs font-semibold text-amber-700">
                    {adminPendingCount}
                  </span>
                )}
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </div>
            </button>
          )}
        </div>
      </section>

      {/* Nhóm 2: Thao tác nhanh */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Thao tác nhanh
        </h2>
        <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(28,27,24,0.04)]">
          <button type="button" onClick={onOpenAddAsset} className={ROW_BTN}>
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-ink">
                <PlusCircle className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold text-slate-900">Thêm tài sản</span>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>

          <button type="button" onClick={onOpenAddDebt} className={ROW_BTN}>
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600">
                <PlusCircle className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold text-slate-900">Thêm khoản nợ</span>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>

          <button type="button" onClick={onOpenDeposit} className={ROW_BTN}>
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                <ArrowDownRight className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold text-slate-900">Nạp / Rút ví</span>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        </div>
      </section>

      {/* Nhóm 3: Tài khoản cá nhân & sao lưu */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Tài khoản
        </h2>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(28,27,24,0.04)]">
          <button type="button" onClick={onOpenAccount} className={ROW_BTN}>
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-accent/30 bg-accent-soft text-sm font-semibold text-accent-ink">
                {initial}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{user.displayName}</div>
                <div className="truncate text-xs text-slate-500">{user.email}</div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        </div>
      </section>
    </div>
  );
};
