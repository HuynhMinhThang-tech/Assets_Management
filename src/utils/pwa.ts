/**
 * Đăng ký service worker (public/sw.js) để ứng dụng cài được như PWA và mở được khung trang khi mất mạng.
 * Chỉ chạy ở bản build (npm run build): khi phát triển (npm run dev) không đăng ký để không bị cache cũ làm rối.
 * Service worker không bao giờ lưu dữ liệu từ /api (xem chú thích trong public/sw.js).
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
      console.warn('Không đăng ký được service worker (PWA):', err);
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
