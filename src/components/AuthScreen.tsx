import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Moon, Sun } from 'lucide-react';
import { PublicUser, validateDisplayName, validatePassword, validateEmail, normalizeEmail } from '../utils/auth';
import { api, ApiError } from '../utils/api';

type Mode = 'login' | 'register' | 'forgot';
type Done = null | 'registered' | 'reset_requested';

interface AuthScreenProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onAuthenticated: (user: PublicUser) => void;
}

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900';

const Field: React.FC<{
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ id, label, error, hint, children }) => (
  <div>
    <label htmlFor={id} className="mb-1 block text-xs font-semibold text-slate-700">
      {label}
    </label>
    {children}
    {error ? (
      <p role="alert" className="mt-1 flex items-start gap-1 text-[11px] font-medium text-rose-600">
        <AlertCircle className="mt-px h-3 w-3 shrink-0" />
        <span>{error}</span>
      </p>
    ) : hint ? (
      <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
    ) : null}
  </div>
);

export const AuthScreen: React.FC<AuthScreenProps> = ({ isDark, onToggleTheme, onAuthenticated }) => {
  const [mode, setMode] = useState<Mode>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState<Done>(null);

  const effectiveMode: Mode = mode;

  const switchMode = (m: Mode) => {
    setMode(m);
    setSubmitted(false);
    setFormError('');
    setDone(null);
    setPassword('');
    setConfirm('');
  };

  // Lỗi từng ô (chỉ hiện sau khi bấm gửi)
  const errors = {
    displayName: effectiveMode === 'register' ? validateDisplayName(displayName) : '',
    email: effectiveMode === 'login' ? (email.trim() ? '' : 'Nhập Gmail đăng nhập.') : validateEmail(email),
    password:
      effectiveMode === 'login' ? (password ? '' : 'Nhập mật khẩu.') : validatePassword(password, email),
    confirm: effectiveMode !== 'login' && !validatePassword(password, email) && confirm !== password ? 'Mật khẩu nhập lại chưa khớp.' : '',
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const show = (key: keyof typeof errors) => (submitted ? errors[key] : '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError('');
    if (hasErrors) return;
    setBusy(true);
    try {
      if (effectiveMode === 'login') {
        const res = await api.login({ email, password, remember });
        onAuthenticated(res.user);
        return;
      }
      if (effectiveMode === 'register') {
        const res = await api.register({ displayName, email, password });
        if (res.status === 'active' && res.user) onAuthenticated(res.user); // quản trị viên (Gmail trong ADMIN_EMAIL) vào luôn
        else setDone('registered');
        return;
      }
      await api.forgot({ email, password });
      setDone('reset_requested');
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Đã xảy ra lỗi. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  };

  const title =
    effectiveMode === 'login' ? 'Đăng nhập' : effectiveMode === 'register' ? 'Đăng ký tài khoản' : 'Quên mật khẩu';
  const subtitle =
    effectiveMode === 'login'
      ? 'Chào mừng trở lại. Đăng nhập để xem tài sản và khoản nợ của bạn.'
      : effectiveMode === 'register'
      ? 'Sau khi đăng ký, quản trị viên cần phê duyệt thì bạn mới đăng nhập được.'
      : 'Nhập Gmail của tài khoản và mật khẩu mới. Yêu cầu sẽ có hiệu lực sau khi quản trị viên duyệt.';

  const pwType = showPw ? 'text' : 'password';
  const pwToggle = (
    <button
      type="button"
      onClick={() => setShowPw((v) => !v)}
      aria-label={showPw ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:text-slate-700"
    >
      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 font-sans text-slate-900 antialiased">
      <button
        type="button"
        onClick={onToggleTheme}
        aria-label={isDark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
        title={isDark ? 'Giao diện tối' : 'Giao diện sáng'}
        className="fixed right-4 top-4 grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
      >
        {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </button>

      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-lg">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-950/30 ring-1 ring-white/10">
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="currentColor" aria-hidden="true">
              <rect x="4" y="13" width="4" height="7" rx="1" />
              <rect x="10" y="9" width="4" height="11" rx="1" />
              <rect x="16" y="4" width="4" height="16" rx="1" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold leading-tight text-slate-900">Quản lý tài sản và nợ</div>
            <div className="text-[11px] text-slate-500">Theo dõi tài sản, khoản vay và dòng tiền</div>
          </div>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div>
                {done === 'registered' ? (
                  <>
                    <strong>Đã gửi đăng ký.</strong> Tài khoản <strong>{normalizeEmail(email)}</strong> đang chờ quản trị viên phê duyệt.
                    Bạn sẽ đăng nhập được sau khi được duyệt.
                  </>
                ) : (
                  <>
                    <strong>Đã gửi yêu cầu đặt lại mật khẩu.</strong> Nếu Gmail này có tài khoản đang hoạt động, quản trị viên sẽ xem xét.
                    Sau khi được duyệt, hãy đăng nhập bằng mật khẩu mới.
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
            >
              Về trang đăng nhập
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <h1 className="text-lg font-bold text-slate-900">{title}</h1>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{subtitle}</p>
            </div>

            {formError && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">
                <AlertCircle className="mt-px h-4 w-4 shrink-0 text-rose-600" />
                <span>{formError}</span>
              </div>
            )}

            {effectiveMode === 'register' && (
              <Field id="auth-display" label="Tên hiển thị" error={show('displayName')} hint="Dùng để chào và hiển thị trong ứng dụng.">
                <input
                  id="auth-display"
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  aria-invalid={show('displayName') ? true : undefined}
                  className={inputClass}
                />
              </Field>
            )}

            <Field
              id="auth-email"
              label="Gmail"
              error={show('email')}
              hint={effectiveMode !== 'login' ? 'Chỉ nhận địa chỉ kết thúc bằng @gmail.com, ví dụ ten.ban@gmail.com.' : undefined}
            >
              <input
                id="auth-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="ten.ban@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={show('email') ? true : undefined}
                className={inputClass}
              />
            </Field>

            <Field
              id="auth-password"
              label={effectiveMode === 'forgot' ? 'Mật khẩu mới' : 'Mật khẩu'}
              error={show('password')}
              hint={effectiveMode !== 'login' ? 'Ít nhất 8 ký tự.' : undefined}
            >
              <div className="relative">
                <input
                  id="auth-password"
                  type={pwType}
                  autoComplete={effectiveMode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={show('password') ? true : undefined}
                  className={`${inputClass} pr-10`}
                />
                {pwToggle}
              </div>
            </Field>

            {effectiveMode !== 'login' && (
              <Field id="auth-confirm" label="Nhập lại mật khẩu" error={show('confirm')}>
                <input
                  id="auth-confirm"
                  type={pwType}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  aria-invalid={show('confirm') ? true : undefined}
                  className={inputClass}
                />
              </Field>
            )}

            {effectiveMode === 'login' && (
              <div className="flex items-center justify-between text-xs">
                <label className="flex cursor-pointer items-center gap-2 text-slate-600">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  Ghi nhớ đăng nhập
                </label>
                <button type="button" onClick={() => switchMode('forgot')} className="font-semibold text-emerald-600 hover:underline">
                  Quên mật khẩu?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
            >
              {busy
                ? 'Đang xử lý…'
                : effectiveMode === 'login'
                ? 'Đăng nhập'
                : effectiveMode === 'register'
                ? 'Gửi đăng ký'
                : 'Gửi yêu cầu đặt lại mật khẩu'}
            </button>

            {(
              <p className="text-center text-xs text-slate-500">
                {effectiveMode === 'login' ? (
                  <>
                    Chưa có tài khoản?{' '}
                    <button type="button" onClick={() => switchMode('register')} className="font-semibold text-emerald-600 hover:underline">
                      Đăng ký
                    </button>
                  </>
                ) : (
                  <>
                    Đã có tài khoản?{' '}
                    <button type="button" onClick={() => switchMode('login')} className="font-semibold text-emerald-600 hover:underline">
                      Đăng nhập
                    </button>
                  </>
                )}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
};
