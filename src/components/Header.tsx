import React from 'react';
import { PlusCircle, Wallet, ArrowDownRight, Menu } from 'lucide-react';
import { NavTab } from './Sidebar';
import { formatVND } from '../utils/calculations';
import type { SyncStatus } from '../utils/syncer';

interface HeaderProps {
  currentTab: NavTab;
  availableCash: number;
  onOpenAddAsset: () => void;
  onOpenAddDebt: () => void;
  onOpenDeposit: () => void;
  /** Trạng thái lưu dữ liệu lên máy chủ. */
  syncStatus?: SyncStatus;
  /** Mở lại hộp thoại xử lý xung đột đồng bộ đã hoãn. */
  onResolveConflict?: () => void;
  /** Điện thoại: mở ngăn điều hướng. */
  onOpenNav?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  availableCash,
  onOpenAddAsset,
  onOpenAddDebt,
  onOpenDeposit,
  syncStatus,
  onResolveConflict,
  onOpenNav,
}) => {
  return (
    <header className="h-16 bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between gap-3 sm:gap-8 sticky top-0 z-20">
      {/* Zone 1: nút mở điều hướng (điện thoại) + tiêu đề */}
      <div className="flex items-center gap-2 text-sm text-slate-500 whitespace-nowrap shrink-0">
        {onOpenNav && (
          <button
            type="button"
            data-open-nav
            onClick={onOpenNav}
            aria-label="Mở menu điều hướng"
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <span className="hidden font-semibold text-slate-900 sm:inline">Danh mục cá nhân</span>
      </div>

      {/* Zone 2 & 3: Cash display & Quick Action CTAs */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        {syncStatus === 'conflict' && (
          <button
            type="button"
            onClick={onResolveConflict}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Chưa đồng bộ – bấm để xử lý
          </button>
        )}
        {syncStatus && syncStatus !== 'idle' && syncStatus !== 'conflict' && (
          <span
            role="status"
            className={`hidden lg:inline-flex items-center gap-1.5 text-[11px] font-medium ${
              syncStatus === 'error' ? 'text-rose-600' : syncStatus === 'saving' ? 'text-slate-500' : 'text-emerald-600'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                syncStatus === 'error' ? 'bg-rose-500' : syncStatus === 'saving' ? 'bg-slate-400 animate-pulse' : 'bg-emerald-500'
              }`}
            />
            {syncStatus === 'error' ? 'Chưa lưu được – đang thử lại' : syncStatus === 'saving' ? 'Đang lưu…' : 'Đã lưu'}
          </span>
        )}

        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
          <Wallet className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-slate-500">Tiền khả dụng:</span>
          <span className="font-bold text-slate-900 font-mono tabular-nums">
            {formatVND(availableCash)}
          </span>
        </div>

        <button
          onClick={onOpenDeposit}
          aria-label="Nạp hoặc rút ví"
          title="Nạp/Rút ví"
          className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
        >
          <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600" />
          <span className="hidden sm:inline">Nạp/Rút ví</span>
        </button>

        <button
          onClick={onOpenAddAsset}
          aria-label="Thêm tài sản"
          title="Thêm tài sản"
          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
        >
          <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden sm:inline">Thêm tài sản</span>
        </button>

        <button
          onClick={onOpenAddDebt}
          aria-label="Thêm khoản nợ"
          title="Thêm khoản nợ"
          className="px-3.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <PlusCircle className="w-3.5 h-3.5 text-rose-600" />
          <span className="hidden sm:inline">Thêm khoản nợ</span>
        </button>
      </div>
    </header>
  );
};
