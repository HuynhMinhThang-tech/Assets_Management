/**
 * Kiểu dữ liệu & quy tắc kiểm tra tài khoản dùng ở giao diện.
 * Việc lưu trữ, băm mật khẩu và phiên đăng nhập do MÁY CHỦ đảm nhiệm (thư mục /api); quy tắc kiểm tra ở đây chỉ để báo lỗi sớm.
 * PHẢI khớp với api/_lib/validate.ts (máy chủ luôn kiểm tra lại).
 */

export type AccountRole = 'admin' | 'user';
export type AccountStatus = 'pending' | 'active' | 'rejected' | 'locked';

/** Người dùng đang đăng nhập. */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: AccountRole;
  status: AccountStatus;
}

/** Một dòng trong trang Quản trị (chỉ quản trị viên nhận được; không có mật khẩu / băm). */
export interface AdminAccount extends PublicUser {
  createdAt: string;
  approvedAt: string | null;
  hasResetRequest: boolean;
  resetRequestedAt: string | null;
}

export const GMAIL_SUFFIX = '@gmail.com';
export const normalizeEmail = (e: string) => (e || '').trim().toLowerCase();
const GMAIL_LOCAL_RE = /^[a-z0-9](?:[a-z0-9.]{4,28})[a-z0-9]$/;

export function validateEmail(raw: string): string {
  const e = normalizeEmail(raw);
  if (!e) return 'Nhập địa chỉ Gmail.';
  if (!e.endsWith(GMAIL_SUFFIX)) return 'Chỉ chấp nhận địa chỉ Gmail, kết thúc bằng @gmail.com.';
  const local = e.slice(0, -GMAIL_SUFFIX.length);
  if (!GMAIL_LOCAL_RE.test(local) || local.includes('..'))
    return 'Phần trước @gmail.com gồm 6–30 ký tự: chữ không dấu, số và dấu chấm (không bắt đầu/kết thúc bằng dấu chấm, không có hai dấu chấm liền nhau).';
  return '';
}

export function validateDisplayName(raw: string): string {
  const n = (raw || '').trim();
  if (!n) return 'Nhập tên hiển thị.';
  if (n.length > 40) return 'Tên hiển thị tối đa 40 ký tự.';
  return '';
}

export function validatePassword(pw: string, email = ''): string {
  if (!pw) return 'Nhập mật khẩu.';
  if (pw.length < 8) return 'Mật khẩu cần ít nhất 8 ký tự.';
  if (pw.length > 128) return 'Mật khẩu tối đa 128 ký tự.';
  const id = normalizeEmail(email);
  if (id && (pw.toLowerCase() === id || pw.toLowerCase() === id.split('@')[0])) return 'Mật khẩu không được trùng địa chỉ Gmail.';
  return '';
}

/** Số việc đang chờ quản trị viên xử lý (đăng ký mới + yêu cầu đặt lại mật khẩu). */
export function countPendingWork(accounts: AdminAccount[]): number {
  return accounts.filter((a) => a.status === 'pending').length + accounts.filter((a) => a.status === 'active' && a.hasResetRequest).length;
}
