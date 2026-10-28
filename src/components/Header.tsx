import React from 'react';
import { PlusCircle, Wallet, ArrowDownRight, ArrowUpRight } from 'lucide-react';
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
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  availableCash,
  onOpenAddAsset,
  onOpenAddDebt,
  onOpenDeposit,
  syncStatus,
}) => {
  const getTabTitle = (tab: NavTab) => {
    switch (tab) {
      case 'dashboard':
        return 'Tổng quan';
      case 'assets':
        return 'Quản lý Tài sản Đa Danh mục';
      case 'debts':
        return 'Khoản vay, Đòn bẩy & Lịch trả nợ';
      case 'wallet':
        return 'Ví Đầu tư & Dòng tiền Thực tế';
      case 'calendar':
        return 'Lịch thu chi: Ngày trả nợ & Ngày nhận tiền';
      case 'admin':
        return 'Quản trị tài khoản';
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-8 sticky top-0 z-20">
      {/* Zone 1: Contextual Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-500 whitespace-nowrap shrink-0">
        <span className="font-semibold text-slate-900">Danh mục cá nhân</span>
        <span className="text-slate-300">/</span>
        <span className="text-slate-600 font-medium">{getTabTitle(currentTab)}</span>
      </div>

      {/* Zone 2 & 3: Cash display & Quick Action CTAs */}
      <div className="flex items-center gap-4 shrink-0">
        {syncStatus && syncStatus !== 'idle' && (
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
          className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
        >
          <ArrowDownRight className="w-3.5 h-3.5 text-emerald-600" />
          <span>Nạp/Rút ví</span>
        </button>

        <button
          onClick={onOpenAddAsset}
          className="px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-sm"
        >
          <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
          <span>Thêm tài sản</span>
        </button>

        <button
          onClick={onOpenAddDebt}
          className="px-3.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <PlusCircle className="w-3.5 h-3.5 text-rose-600" />
          <span>Thêm khoản nợ</span>
        </button>
      </div>
    </header>
  );
};
