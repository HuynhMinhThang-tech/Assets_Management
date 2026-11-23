import { useEffect, useState } from 'react';

/**
 * Xác định ứng dụng đang mở ở chế độ PWA độc lập (đã cài ra màn hình chính, không còn thanh URL trình duyệt)
 * hoặc đang bật chế độ xem trước PWA qua tham số `?pwa=1`.
 */
export function isPwaStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    if (new URLSearchParams(window.location.search).get('pwa') === '1') return true;
  } catch {
    return false;
  }
  return false;
}

/** Hook theo dõi trạng thái PWA standalone theo thời gian thực. */
export function useIsPwaApp(): boolean {
  const [isPwa, setIsPwa] = useState<boolean>(() => isPwaStandalone());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(display-mode: standalone)');
    const sync = () => setIsPwa(isPwaStandalone());
    sync();
    if (mq.addEventListener) {
      mq.addEventListener('change', sync);
      return () => mq.removeEventListener('change', sync);
    }
    mq.addListener?.(sync);
    return () => mq.removeListener?.(sync);
  }, []);

  return isPwa;
}

/** Hook theo dõi trạng thái kết nối mạng để thông báo tinh tế khi ngoại tuyến. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return online;
}
