/** Quy tắc kiểm tra dữ liệu nhập – PHẢI khớp với src/utils/auth.ts ở giao diện (máy chủ luôn kiểm tra lại). */

export const GMAIL_SUFFIX = '@gmail.com';
export const normalizeEmail = (e: string) => (e || '').trim().toLowerCase();
const GMAIL_LOCAL_RE = /^[a-z0-9](?:[a-z0-9.]{4,28})[a-z0-9]$/; // 6–30 ký tự, không bắt đầu/kết thúc bằng dấu chấm

/** Gmail bỏ qua dấu chấm trong phần tên: a.b@gmail.com và ab@gmail.com là MỘT hộp thư. */
export function canonicalEmail(raw: string): string {
  const e = normalizeEmail(raw);
  const at = e.lastIndexOf('@');
  return at < 0 ? e : `${e.slice(0, at).replace(/\./g, '')}${e.slice(at)}`;
}

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

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Kiểm tra hình dạng tối thiểu của dữ liệu danh mục trước khi lưu (không thay thế việc chuẩn hóa ở giao diện). */
export function isPortfolioShape(d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  return (
    !!o.wallet &&
    typeof o.wallet === 'object' &&
    Array.isArray(o.assets) &&
    Array.isArray(o.debts) &&
    Array.isArray(o.transactions)
  );
}
