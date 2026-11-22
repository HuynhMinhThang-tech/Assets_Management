import React from 'react';
import {
  LayoutDashboard,
  PieChart,
  CreditCard,
  Wallet as WalletIcon,
  CalendarDays,
  Scale,
  TrendingUp,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  ShieldCheck,
  LogOut,
} from 'lucide-react';
import { InstallAppButton } from './InstallAppButton';

export type NavTab = 'dashboard' | 'assets' | 'prices' | 'debts' | 'wallet' | 'calendar' | 'balance' | 'admin';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  upcomingPaymentCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  /** subtitle = Gmail (hoặc tên đăng nhập cũ) hiện dưới tên. */
  user: { displayName: string; subtitle: string; role: 'admin' | 'user' };
  isDark: boolean;
  onToggleTheme: () => void;
  /** Số việc đang chờ quản trị viên xử lý (đăng ký mới + yêu cầu đặt lại mật khẩu). */
  adminPendingCount: number;
  /** Số tài sản đã lâu chưa định giá lại (hiện trên mục "Cập nhật giá"). */
  priceAlertCount?: number;
  onOpenAccount: () => void;
  onLogout: () => void;
  /** Điện thoại / màn hình hẹp: thanh bên là ngăn kéo, mở bằng nút ☰ ở đầu trang. */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  /** Màn hình rộng (≥ 1024px): thanh bên cố định và có thể thu gọn. Trên màn hình hẹp luôn hiện đầy đủ chữ. */
  isDesktop?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  upcomingPaymentCount,
  isCollapsed: isCollapsedProp,
  onToggleCollapse,
  user,
  isDark,
  onToggleTheme,
  adminPendingCount,
  priceAlertCount = 0,
  onOpenAccount,
  onLogout,
  mobileOpen = false,
  onCloseMobile,
  isDesktop = true,
}) => {
  const isCollapsed = isCollapsedProp && isDesktop;
  const navItems: { id: NavTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: 'dashboard',
      label: 'Tổng quan',
      icon: <LayoutDashboard className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'assets',
      label: 'Danh mục Tài sản',
      icon: <PieChart className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'prices',
      label: 'Cập nhật giá',
      icon: <TrendingUp className="w-4 h-4 shrink-0" />,
      badge: priceAlertCount > 0 ? priceAlertCount : undefined,
    },
    {
      id: 'debts',
      label: 'Khoản nợ & Lịch trả',
      icon: <CreditCard className="w-4 h-4 shrink-0" />,
      badge: upcomingPaymentCount > 0 ? upcomingPaymentCount : undefined,
    },
    {
      id: 'wallet',
      label: 'Ví & Dòng tiền',
      icon: <WalletIcon className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'calendar',
      label: 'Lịch thu chi',
      icon: <CalendarDays className="w-4 h-4 shrink-0" />,
    },
    {
      id: 'balance',
      label: 'Báo cáo',
      icon: <Scale className="w-4 h-4 shrink-0" />,
    },
  ];

  const initial = (Array.from(user.displayName.trim())[0] || '?').toUpperCase();
  // Cùng kiểu với trading-journal: mục đang chọn là ô trắng có viền mảnh, biểu tượng màu nhấn; mục khác chữ xám, rê chuột sáng nền.
  const rowClass = (active: boolean) =>
    `w-full flex items-center ${isCollapsed ? 'justify-center px-0' : 'gap-2.5 px-3 text-left'} min-h-[40px] rounded-lg border text-sm transition-colors relative group ${
      active
        ? 'bg-white border-slate-200 text-slate-900 font-semibold'
        : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900'
    }`;
  const badgeClass = 'text-xs px-2 py-0.5 rounded font-mono font-semibold bg-amber-50 text-amber-700 border border-amber-200';
  const Tip = ({ text }: { text: string }) => (
    <div className="absolute left-full ml-3 px-2.5 py-1 bg-slate-900 text-white text-xs rounded-lg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
      {text}
    </div>
  );

  return (
    <>
    {mobileOpen && <div data-nav-backdrop className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onCloseMobile} aria-hidden="true" />}
    <aside
      data-sidebar
      aria-label="Điều hướng"
      className={`${
        isCollapsed ? 'w-[72px]' : 'w-64 max-w-[85vw]'
      } bg-slate-50 text-slate-500 flex flex-col shrink-0 border-r border-slate-200 select-none h-screen overflow-y-auto fixed inset-y-0 left-0 z-40 transition-transform lg:transition-all duration-200 ease-in-out lg:sticky lg:top-0 lg:z-auto lg:self-start lg:translate-x-0 ${
        mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
      }`}
    >
      {/* Tên ứng dụng + nút thu/mở thanh bên (giống trading-journal) */}
      <div
        className={`h-14 shrink-0 flex items-center border-b border-slate-200 ${
          isCollapsed ? 'justify-center px-2' : 'justify-between px-4'
        }`}
      >
        {!isCollapsed && (
          <span className="text-base font-semibold tracking-tight text-slate-900 whitespace-nowrap truncate">
            Quản lý tài sản và nợ
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
          aria-label={isCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
          className="hidden lg:flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors shrink-0"
        >
          {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Điều hướng chính">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={`${rowClass(isActive)} ${isCollapsed ? '' : 'justify-between'}`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <span className={`shrink-0 ${isActive ? 'text-accent-ink' : ''}`}>{item.icon}</span>
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </div>

              {!isCollapsed && item.badge !== undefined && <span className={badgeClass}>{item.badge}</span>}

              {/* Chấm báo khi thu gọn */}
              {isCollapsed && item.badge !== undefined && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-500" />
              )}

              {/* Tooltip khi thu gọn */}
              {isCollapsed && (
                <div className="absolute left-full ml-3 px-2.5 py-1 bg-slate-900 text-white text-xs rounded-lg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50">
                  {item.label}
                  {item.badge !== undefined && ` (${item.badge})`}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Khu vực người dùng: giao diện Sáng/Tối, tài khoản, quản trị, đăng xuất */}
      <div className="p-3 border-t border-slate-200 space-y-1">
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          onClick={onToggleTheme}
          title={isCollapsed ? (isDark ? 'Giao diện tối – bấm để chuyển sang sáng' : 'Giao diện sáng – bấm để chuyển sang tối') : undefined}
          className={`w-full flex items-center rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-900 hover:bg-slate-100 transition-colors min-h-[40px] ${
            isCollapsed ? 'justify-center px-0' : 'justify-between px-3'
          }`}
        >
          {!isCollapsed && <span className="whitespace-nowrap">{isDark ? 'Giao diện Tối' : 'Giao diện Sáng'}</span>}
          {isDark ? <Moon className="w-4 h-4 text-accent-ink shrink-0" /> : <Sun className="w-4 h-4 text-accent-ink shrink-0" />}
        </button>

        {/* Cài như ứng dụng (PWA); tự ẩn khi đã mở ở chế độ ứng dụng */}
        <InstallAppButton iconOnly={isCollapsed} />

        <div className="my-2 border-t border-slate-200" />

        <button type="button" onClick={onOpenAccount} className={`${rowClass(false)} group`} title={isCollapsed ? user.displayName : 'Tài khoản của tôi'}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-accent/30 bg-accent-soft text-sm font-semibold text-accent-ink">
            {initial}
          </span>
          {!isCollapsed && (
            <span className="min-w-0 flex-1 text-left leading-tight">
              <span className="block truncate text-sm font-semibold text-slate-900">{user.displayName}</span>
              <span className="block truncate text-[11px] font-normal text-slate-500">{user.subtitle}</span>
            </span>
          )}
          {isCollapsed && <Tip text={`${user.displayName} (${user.subtitle})`} />}
        </button>

        {user.role === 'admin' && (
          <button type="button" onClick={() => onSelectTab('admin')} className={rowClass(currentTab === 'admin')}>
            <span className={`shrink-0 ${currentTab === 'admin' ? 'text-accent-ink' : ''}`}>
              <ShieldCheck className="w-4 h-4 shrink-0" />
            </span>
            {!isCollapsed && <span className="flex-1 text-left">Quản trị</span>}
            {!isCollapsed && adminPendingCount > 0 && <span className={badgeClass}>{adminPendingCount}</span>}
            {isCollapsed && adminPendingCount > 0 && <span className="absolute top-2 right-3 w-2 h-2 rounded-full bg-amber-500" />}
            {isCollapsed && <Tip text={adminPendingCount > 0 ? `Quản trị (${adminPendingCount} việc chờ)` : 'Quản trị'} />}
          </button>
        )}

        <button type="button" onClick={onLogout} className={rowClass(false)}>
          <LogOut className="w-4 h-4 shrink-0" />
          {!isCollapsed && <span className="flex-1 text-left">Đăng xuất</span>}
          {isCollapsed && <Tip text="Đăng xuất" />}
        </button>
      </div>
    </aside>
    </>
  );
};
