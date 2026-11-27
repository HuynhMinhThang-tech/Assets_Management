import React from 'react';
import { TrendingUp, CalendarDays, Scale, ShieldCheck, ChevronRight, LogOut } from 'lucide-react';

export type PwaSecondaryTab = 'prices' | 'calendar' | 'balance' | 'admin';

interface PwaMoreViewProps {
  user: { displayName: string; email: string; role: 'admin' | 'user' };
  priceAlertCount: number;
  adminPendingCount: number;
  onLogout: () => void;
  onSelectSubTab: (tab: PwaSecondaryTab) => void;
  onOpenAccount: () => void;
}

const ROW_BTN =
  'w-full min-h-[52px] flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100';

export const PwaMoreView: React.FC<PwaMoreViewProps> = ({
  user,
  priceAlertCount,
  adminPendingCount,
  onLogout,
  onSelectSubTab,
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

      {/* Nhóm 3: Tài khoản cá nhân & sao lưu */}
      <section>
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Tài khoản
        </h2>
        <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(28,27,24,0.04)]">
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

          <button type="button" onClick={onLogout} className={ROW_BTN} data-pwa-logout>
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600">
                <LogOut className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold text-rose-600">Đăng xuất</span>
            </div>
          </button>
        </div>
      </section>
    </div>
  );
};
