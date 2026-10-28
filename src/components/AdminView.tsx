import React, { useState } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { AdminAccount, PublicUser } from '../utils/auth';
import { api, ApiError } from '../utils/api';
import { useDialog } from './ui/DialogProvider';

type AdminTab = 'pending' | 'reset' | 'active' | 'blocked';

interface AdminViewProps {
  currentUser: PublicUser;
  /** null = đang tải danh sách. */
  accounts: AdminAccount[] | null;
  /** Gọi sau mỗi thao tác để nạp lại danh sách tài khoản từ máy chủ. */
  onChanged: () => void;
  onBack: () => void;
}

const fmtTime = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
};

const btn = {
  primary:
    'rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700',
  neutral:
    'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50',
  danger:
    'rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100',
};

export const AdminView: React.FC<AdminViewProps> = ({ currentUser, accounts, onChanged, onBack }) => {
  const { confirm, alert, toast } = useDialog();
  const [tab, setTab] = useState<AdminTab>('pending');

  const all = accounts ?? [];
  const pending = all.filter((a) => a.status === 'pending');
  const resets = all.filter((a) => a.status === 'active' && a.hasResetRequest);
  const active = all.filter((a) => a.status === 'active');
  const blocked = all.filter((a) => a.status === 'rejected' || a.status === 'locked');

  const tabs: { id: AdminTab; label: string; list: AdminAccount[] }[] = [
    { id: 'pending', label: 'Chờ duyệt', list: pending },
    { id: 'reset', label: 'Đặt lại mật khẩu', list: resets },
    { id: 'active', label: 'Đang hoạt động', list: active },
    { id: 'blocked', label: 'Đã khóa / từ chối', list: blocked },
  ];
  const current = tabs.find((t) => t.id === tab)!;

  /** Chạy một thao tác trên máy chủ; thành công thì báo nhẹ, lỗi thì hiện hộp báo lỗi. Luôn nạp lại danh sách. */
  const run = async (op: () => Promise<unknown>, okMessage: string) => {
    try {
      await op();
      toast(okMessage);
    } catch (e) {
      void alert({
        tone: 'error',
        title: 'Không thực hiện được',
        message: e instanceof ApiError ? e.message : 'Đã xảy ra lỗi. Vui lòng thử lại.',
      });
    }
    onChanged();
  };

  const actionsFor = (a: AdminAccount): React.ReactNode => {
    const self = a.id === currentUser.id;
    switch (tab) {
      case 'pending':
        return (
          <>
            <button type="button" className={btn.primary} onClick={() => run(() => api.adminAction(a.id, 'approve'), `Đã duyệt ${a.email}.`)}>
              Duyệt
            </button>
            <button
              type="button"
              className={btn.danger}
              onClick={async () => {
                const ok = await confirm({
                  tone: 'danger',
                  title: `Từ chối đăng ký của "${a.displayName}"?`,
                  message: `${a.email} sẽ không đăng nhập được. Bạn có thể duyệt lại sau trong tab "Đã khóa / từ chối".`,
                  confirmText: 'Từ chối',
                });
                if (ok) run(() => api.adminAction(a.id, 'reject'), `Đã từ chối ${a.email}.`);
              }}
            >
              Từ chối
            </button>
          </>
        );
      case 'reset':
        return (
          <>
            <button
              type="button"
              className={btn.primary}
              disabled={self}
              title={self ? 'Yêu cầu của chính bạn cần một quản trị viên khác duyệt' : undefined}
              onClick={async () => {
                const ok = await confirm({
                  tone: 'warning',
                  title: `Đặt lại mật khẩu cho "${a.displayName}"?`,
                  message: `Mật khẩu mới do ${a.email} đã nhập khi gửi yêu cầu sẽ có hiệu lực ngay. Mật khẩu cũ không còn dùng được.\n\nChỉ duyệt khi bạn chắc chính chủ đã gửi yêu cầu.`,
                  confirmText: 'Duyệt đặt lại',
                });
                if (ok) run(() => api.adminAction(a.id, 'reset-approve'), `Đã đặt lại mật khẩu cho ${a.email}.`);
              }}
            >
              Duyệt
            </button>
            <button type="button" className={btn.danger} onClick={() => run(() => api.adminAction(a.id, 'reset-deny'), `Đã từ chối yêu cầu của ${a.email}.`)}>
              Từ chối
            </button>
          </>
        );
      case 'active':
        if (self) return <span className="text-[11px] font-medium text-slate-400">Tài khoản của bạn</span>;
        return (
          <>
            <button
              type="button"
              className={btn.neutral}
              onClick={async () => {
                const toAdmin = a.role !== 'admin';
                const ok = await confirm({
                  tone: toAdmin ? 'warning' : 'default',
                  title: toAdmin ? `Cấp quyền quản trị cho "${a.displayName}"?` : `Bỏ quyền quản trị của "${a.displayName}"?`,
                  message: toAdmin
                    ? 'Quản trị viên có thể duyệt người dùng mới, duyệt đặt lại mật khẩu và khóa tài khoản.'
                    : 'Tài khoản này sẽ trở thành người dùng thường.',
                  confirmText: toAdmin ? 'Cấp quyền' : 'Bỏ quyền',
                });
                if (ok) run(() => api.adminAction(a.id, toAdmin ? 'promote' : 'demote'), toAdmin ? 'Đã cấp quyền quản trị.' : 'Đã bỏ quyền quản trị.');
              }}
            >
              {a.role === 'admin' ? 'Bỏ quyền quản trị' : 'Cấp quyền quản trị'}
            </button>
            <button
              type="button"
              className={btn.danger}
              onClick={async () => {
                const ok = await confirm({
                  tone: 'danger',
                  title: `Khóa tài khoản "${a.displayName}"?`,
                  message: `${a.email} sẽ bị đăng xuất và không đăng nhập được cho tới khi bạn mở khóa. Dữ liệu của họ được giữ nguyên.`,
                  confirmText: 'Khóa tài khoản',
                });
                if (ok) run(() => api.adminAction(a.id, 'lock'), `Đã khóa ${a.email}.`);
              }}
            >
              Khóa
            </button>
          </>
        );
      case 'blocked':
        return (
          <>
            <button type="button" className={btn.primary} onClick={() => run(() => api.adminAction(a.id, 'approve'), `Đã mở lại ${a.email}.`)}>
              {a.status === 'locked' ? 'Mở khóa' : 'Duyệt lại'}
            </button>
            <button
              type="button"
              className={btn.danger}
              onClick={async () => {
                const ok = await confirm({
                  tone: 'danger',
                  title: `Xóa hẳn tài khoản "${a.displayName}"?`,
                  message: `Tài khoản ${a.email} và TOÀN BỘ dữ liệu tài sản, khoản nợ, giao dịch của họ trên máy chủ sẽ bị xóa. Không thể hoàn tác.`,
                  confirmText: 'Xóa vĩnh viễn',
                });
                if (!ok) return;
                run(() => api.adminAction(a.id, 'delete'), `Đã xóa ${a.email}.`);
              }}
            >
              Xóa
            </button>
          </>
        );
    }
  };

  const subline = (a: AdminAccount) => {
    if (tab === 'reset') return `Gửi yêu cầu lúc ${fmtTime(a.resetRequestedAt ?? undefined)}`;
    if (tab === 'pending') return `Đăng ký lúc ${fmtTime(a.createdAt)}`;
    if (tab === 'blocked') return `${a.status === 'locked' ? 'Đã khóa' : 'Đã từ chối'} · đăng ký ${fmtTime(a.createdAt)}`;
    return `Tham gia ${fmtTime(a.approvedAt || a.createdAt)}`;
  };

  const emptyText: Record<AdminTab, string> = {
    pending: 'Không có yêu cầu đăng ký nào đang chờ.',
    reset: 'Không có yêu cầu đặt lại mật khẩu nào.',
    active: 'Chưa có tài khoản nào đang hoạt động.',
    blocked: 'Không có tài khoản nào bị khóa hoặc từ chối.',
  };

  return (
    <div className="space-y-5 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            Quản trị tài khoản
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
            Chỉ hiển thị tên và tên đăng nhập. Mật khẩu được mã hóa một chiều nên không ai xem được, kể cả quản trị viên.
          </p>
        </div>
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> Về ứng dụng
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const isActive = t.id === tab;
          const needsAttention = (t.id === 'pending' || t.id === 'reset') && t.list.length > 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={isActive}
              className={`rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${
                isActive
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              {t.label}{' '}
              <span
                className={`ml-1 rounded-full px-1.5 py-0.5 font-mono text-[11px] ${
                  isActive ? 'bg-white/20' : needsAttention ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {t.list.length}
              </span>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {current.list.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-400">{accounts === null ? 'Đang tải danh sách…' : emptyText[tab]}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {current.list.map((a) => (
              <li key={a.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
                    {(Array.from(a.displayName.trim())[0] || '?').toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-bold text-slate-900">{a.displayName}</span>
                      {a.role === 'admin' && (
                        <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700">
                          Quản trị viên
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {a.email} · {subline(a)}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actionsFor(a)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
