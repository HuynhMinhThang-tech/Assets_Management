export type Theme = 'light' | 'dark';
const THEME_KEY = 'fintrack_vn_theme';

/** Giao diện đã chọn; chưa chọn thì theo cài đặt hệ điều hành. */
export function getStoredTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {}
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Áp giao diện lên trang (thêm/bỏ class "dark" ở <html>). `persist` = true khi người dùng chủ động chọn. */
export function applyTheme(theme: Theme, persist = false) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }
}
