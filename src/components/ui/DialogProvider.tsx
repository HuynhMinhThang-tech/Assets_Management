import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

/**
 * Thay thế alert() / confirm() của trình duyệt bằng hộp thoại cùng phong cách với ứng dụng.
 *
 *   const { confirm, alert, toast } = useDialog();
 *   if (await confirm({ title: 'Xóa?', message: '...', tone: 'danger', confirmText: 'Xóa' })) { ... }
 *   await alert({ title: 'Không đủ tiền', message: '...', tone: 'error' });
 *   toast('Đã lưu', 'success');
 */

export interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: 'danger' | 'warning' | 'default';
}

export interface AlertOptions {
  title: string;
  message?: React.ReactNode;
  okText?: string;
  tone?: 'error' | 'warning' | 'info';
}

type ToastTone = 'success' | 'error' | 'info';

interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  alert: (opts: AlertOptions) => Promise<void>;
  toast: (message: string, tone?: ToastTone) => void;
}

type QueueItem =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'alert'; opts: AlertOptions; resolve: () => void };

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog phải được dùng bên trong <DialogProvider>');
  return ctx;
}

const TONE_STYLE = {
  danger: { icon: <AlertTriangle className="h-5 w-5" />, badge: 'bg-rose-100 text-rose-600', btn: 'bg-rose-600 hover:bg-rose-700' },
  warning: { icon: <AlertTriangle className="h-5 w-5" />, badge: 'bg-amber-100 text-amber-600', btn: 'bg-amber-600 hover:bg-amber-700' },
  default: { icon: <Info className="h-5 w-5" />, badge: 'bg-sky-100 text-sky-600', btn: 'bg-slate-900 hover:bg-slate-800' },
  error: { icon: <XCircle className="h-5 w-5" />, badge: 'bg-rose-100 text-rose-600', btn: 'bg-slate-900 hover:bg-slate-800' },
  info: { icon: <Info className="h-5 w-5" />, badge: 'bg-sky-100 text-sky-600', btn: 'bg-slate-900 hover:bg-slate-800' },
} as const;

export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastId = useRef(0);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setQueue((q) => [...q, { kind: 'confirm', opts, resolve }])),
    []
  );
  const alert = useCallback(
    (opts: AlertOptions) =>
      new Promise<void>((resolve) => setQueue((q) => [...q, { kind: 'alert', opts, resolve }])),
    []
  );
  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const api = useMemo<DialogApi>(() => ({ confirm, alert, toast }), [confirm, alert, toast]);

  const current = queue[0];
  const settle = (value: boolean) => {
    if (!current) return;
    if (current.kind === 'confirm') current.resolve(value);
    else current.resolve();
    setQueue((q) => q.slice(1));
  };

  // Esc = Hủy / Đóng. Chạy ở pha capture để không làm đóng luôn modal form nằm bên dưới.
  const settleRef = useRef(settle);
  settleRef.current = settle;
  const hasDialog = !!current;
  useEffect(() => {
    if (!hasDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      settleRef.current(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [hasDialog]);

  // Thao tác nguy hiểm → mặc định focus nút Hủy để lỡ bấm Enter cũng không mất dữ liệu.
  const primaryRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!current) return;
    const dangerous = current.kind === 'confirm' && current.opts.tone === 'danger';
    (dangerous ? cancelRef.current : primaryRef.current)?.focus();
  }, [current]);

  const tone: keyof typeof TONE_STYLE = current
    ? current.kind === 'confirm'
      ? current.opts.tone ?? 'default'
      : current.opts.tone ?? 'error'
    : 'default';
  const style = TONE_STYLE[tone];

  return (
    <DialogContext.Provider value={api}>
      {children}

      {current && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 p-4">
          <div
            role={current.kind === 'alert' ? 'alertdialog' : 'dialog'}
            aria-modal="true"
            aria-label={current.opts.title}
            className="animate-dialog-in w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3.5">
              <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${style.badge}`}>{style.icon}</div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-slate-900">{current.opts.title}</h3>
                {current.opts.message && (
                  <div className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-slate-600">
                    {current.opts.message}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              {current.kind === 'confirm' && (
                <button
                  ref={cancelRef}
                  type="button"
                  onClick={() => settle(false)}
                  className="rounded-lg px-3.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
                >
                  {current.opts.cancelText ?? 'Hủy'}
                </button>
              )}
              <button
                ref={primaryRef}
                type="button"
                onClick={() => settle(true)}
                className={`rounded-lg px-4 py-1.5 text-xs font-bold text-white shadow-sm transition-colors ${style.btn}`}
              >
                {current.kind === 'confirm' ? current.opts.confirmText ?? 'Xác nhận' : current.opts.okText ?? 'Đã hiểu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast: phản hồi nhẹ, tự tắt, không chặn thao tác */}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[70] flex flex-col items-end gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="animate-dialog-in pointer-events-auto flex max-w-sm items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-800 shadow-lg"
          >
            {t.tone === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
            {t.tone === 'error' && <XCircle className="h-4 w-4 shrink-0 text-rose-600" />}
            {t.tone === 'info' && <Info className="h-4 w-4 shrink-0 text-sky-600" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </DialogContext.Provider>
  );
};
