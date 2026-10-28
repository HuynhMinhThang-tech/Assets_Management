import React, { useEffect, useId, useRef } from 'react';
import { AlertCircle, X } from 'lucide-react';

/**
 * Khung modal dùng chung.
 *
 * Vì sao cũ bị "cứng ở trên, không cuộn được": lớp phủ dùng `flex items-center` + `overflow-y-auto`.
 * Khi nội dung cao hơn màn hình, phần dư bị đẩy ra CẢ HAI phía và phần trên không bao giờ cuộn tới được.
 * Ở đây khung có chiều cao tối đa = màn hình, header/footer đứng yên, chỉ phần thân (ModalBody) cuộn.
 */

let lockCount = 0;
function lockScroll() {
  if (lockCount++ === 0) document.body.style.overflow = 'hidden';
}
function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) document.body.style.overflow = '';
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
} as const;

interface ModalProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  size?: keyof typeof SIZES;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ title, subtitle, onClose, size = 'md', children }) => {
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    lockScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unlockScroll();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`animate-dialog-in flex max-h-[calc(100dvh-1.5rem)] w-full ${SIZES[size]} flex-col overflow-hidden rounded-xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-bold text-slate-900">
              {title}
            </h3>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

/** Phần thân: là phần duy nhất cuộn. */
export const ModalBody: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => <div className={`min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 ${className}`}>{children}</div>;

/** Chân modal đứng yên: nút hành động luôn thấy được. `hint` hiện bên trái (vd. lý do chưa lưu được). */
export const ModalFooter: React.FC<{ hint?: React.ReactNode; children: React.ReactNode }> = ({
  hint,
  children,
}) => (
  <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">
    {hint && <p className="mr-auto min-w-0 flex-1 text-[11px] leading-snug text-slate-500">{hint}</p>}
    <div className="flex items-center gap-2">{children}</div>
  </div>
);

/** Thông báo lỗi ngay dưới ô nhập. Không có nội dung thì không hiện gì. */
export const FieldError: React.FC<{ children?: React.ReactNode }> = ({ children }) =>
  children ? (
    <p role="alert" className="mt-1 flex items-start gap-1 text-[11px] font-medium leading-snug text-rose-600">
      <AlertCircle className="mt-px h-3 w-3 shrink-0" />
      <span>{children}</span>
    </p>
  ) : null;
