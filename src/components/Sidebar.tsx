import React from 'react';
import {
  LayoutDashboard,
  PieChart,
  CreditCard,
  Wallet as WalletIcon,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  ShieldCheck,
  LogOut,
} from 'lucide-react';

export type NavTab = 'dashboard' | 'assets' | 'debts' | 'wallet' | 'calendar' | 'admin';

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
  onOpenAccount: () => void;
  onLogout: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  upcomingPaymentCount,
  isCollapsed,
  onToggleCollapse,
  user,
  isDark,
  onToggleTheme,
  adminPendingCount,
  onOpenAccount,
  onLogout,
}) => {
  const navItems: { id: NavTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: 'dashboard',
      label: 'Tổng quan',
      icon: <LayoutDashboard className="w-5 h-5 shrink-0" />,
    },
    {
      id: 'assets',
      label: 'Danh mục Tài sản',
      icon: <PieChart className="w-5 h-5 shrink-0" />,
    },
    {
      id: 'debts',
      label: 'Khoản nợ & Lịch trả',
      icon: <CreditCard className="w-5 h-5 shrink-0" />,
      badge: upcomingPaymentCount > 0 ? upcomingPaymentCount : undefined,
    },
    {
      id: 'wallet',
      label: 'Ví & Dòng tiền',
      icon: <WalletIcon className="w-5 h-5 shrink-0" />,
    },
    {
      id: 'calendar',
      label: 'Lịch thu chi',
      icon: <CalendarDays className="w-5 h-5 shrink-0" />,
    },
  ];

  const initial = (Array.from(user.displayName.trim())[0] || '?').toUpperCase();
  const rowClass = (active: boolean) =>
    `w-full flex items-center ${isCollapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'} rounded-lg text-sm font-medium transition-colors relative group ${
      active ? 'bg-emerald-600 text-white font-semibold shadow-sm' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
    }`;
  const Tip = ({ text }: { text: string }) => (
    <div className="absolute left-full ml-3 px-2.5 py-1 bg-slate-950 text-white text-xs rounded shadow-lg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
      {text}
    </div>
  );

  return (
    <aside
      className={`${
        isCollapsed ? 'w-20' : 'w-64'
      } theme-fixed-dark bg-slate-900 text-slate-300 flex flex-col shrink-0 border-r border-slate-800 select-none h-screen sticky top-0 self-start transition-all duration-300 ease-in-out relative`}
    >
      {/* Brand Header */}
      <div
        className={`h-16 flex items-center border-b border-slate-800 ${
          isCollapsed ? 'justify-center' : 'px-4'
        }`}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-950/50 ring-1 ring-white/10">
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="currentColor" aria-hidden="true">
              <rect x="4" y="13" width="4" height="7" rx="1" />
              <rect x="10" y="9" width="4" height="11" rx="1" />
              <rect x="16" y="4" width="4" height="16" rx="1" />
            </svg>
          </div>
          {!isCollapsed && (
            <div className="transition-opacity duration-200">
              <span className="font-bold text-white tracking-tight text-[15px] block leading-tight whitespace-nowrap">
                Quản lý tài sản và nợ
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Nút thu/mở: nằm ở mép sidebar */}
      <button
        onClick={onToggleCollapse}
        title={isCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
        className="absolute -right-3 top-5 z-30 grid h-6 w-6 place-items-center rounded-full border border-slate-600 bg-slate-800 text-slate-300 shadow hover:bg-slate-700 hover:text-white transition-colors"
      >
        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>

      {/* Main Navigation */}
      <nav className="p-3 space-y-1.5 flex-1">
        {!isCollapsed && (
          <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Điều hướng
          </div>
        )}

        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={`w-full flex items-center ${
                isCollapsed ? 'justify-center px-0 py-3' : 'justify-between px-3 py-2.5'
              } rounded-lg text-sm font-medium transition-colors relative group ${
                isActive
                  ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <div className="flex items-center gap-3 truncate">
                {item.icon}
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </div>

              {!isCollapsed && item.badge !== undefined && (
                <span className="text-xs px-2 py-0.5 rounded font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  {item.badge}
                </span>
              )}

              {/* Floating dot or badge when collapsed */}
              {isCollapsed && item.badge !== undefined && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-400" />
              )}

              {/* Tooltip for collapsed mode */}
              {isCollapsed && (
                <div className="absolute left-full ml-3 px-2.5 py-1 bg-slate-950 text-white text-xs rounded shadow-lg whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50">
                  {item.label}
                  {item.badge !== undefined && ` (${item.badge})`}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* Khu vực người dùng: giao diện Sáng/Tối, tài khoản, quản trị, đăng xuất */}
      <div className="p-3 border-t border-slate-800 space-y-1">
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          onClick={onToggleTheme}
          title={isCollapsed ? (isDark ? 'Giao diện tối – bấm để chuyển sang sáng' : 'Giao diện sáng – bấm để chuyển sang tối') : undefined}
          className={rowClass(false)}
        >
          {isDark ? <Moon className="w-5 h-5 shrink-0" /> : <Sun className="w-5 h-5 shrink-0" />}
          {!isCollapsed && (
            <>
              <span className="flex-1 text-left">Sáng / Tối</span>
              <span
                aria-hidden="true"
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${isDark ? 'bg-emerald-500' : 'bg-slate-600'}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${isDark ? 'left-[18px]' : 'left-0.5'}`}
                />
              </span>
            </>
          )}
          {isCollapsed && <Tip text={isDark ? 'Giao diện tối' : 'Giao diện sáng'} />}
        </button>

        <div className="my-2 border-t border-slate-800" />

        <button type="button" onClick={onOpenAccount} className={rowClass(false)} title={isCollapsed ? user.displayName : 'Tài khoản của tôi'}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-emerald-500/30 bg-emerald-500/20 text-sm font-bold text-emerald-300">
            {initial}
          </span>
          {!isCollapsed && (
            <span className="min-w-0 flex-1 text-left leading-tight">
              <span className="block truncate text-sm font-semibold text-white">{user.displayName}</span>
              <span className="block truncate text-[11px] font-normal text-slate-400">{user.subtitle}</span>
            </span>
          )}
          {isCollapsed && <Tip text={`${user.displayName} (${user.subtitle})`} />}
        </button>

        {user.role === 'admin' && (
          <button type="button" onClick={() => onSelectTab('admin')} className={rowClass(currentTab === 'admin')}>
            <ShieldCheck className="w-5 h-5 shrink-0" />
            {!isCollapsed && <span className="flex-1 text-left">Quản trị</span>}
            {!isCollapsed && adminPendingCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded font-mono font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                {adminPendingCount}
              </span>
            )}
            {isCollapsed && adminPendingCount > 0 && <span className="absolute top-2 right-3 w-2 h-2 rounded-full bg-amber-400" />}
            {isCollapsed && <Tip text={adminPendingCount > 0 ? `Quản trị (${adminPendingCount} việc chờ)` : 'Quản trị'} />}
          </button>
        )}

        <button type="button" onClick={onLogout} className={rowClass(false)}>
          <LogOut className="w-5 h-5 shrink-0" />
          {!isCollapsed && <span className="flex-1 text-left">Đăng xuất</span>}
          {isCollapsed && <Tip text="Đăng xuất" />}
        </button>
      </div>
    </aside>
  );
};
