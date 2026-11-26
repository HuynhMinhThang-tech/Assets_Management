import { useEffect, useState } from 'react';

/** Màn hình dưới breakpoint `lg` của Tailwind (1024px): điện thoại và máy tính bảng dọc. */
const NARROW_QUERY = '(max-width: 1023.98px)';

/**
 * Ứng dụng đang mở ở chế độ PWA độc lập (đã cài ra màn hình chính, không còn thanh URL trình duyệt)
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

/** Người dùng chủ động ép dùng giao diện web (thêm `?web=1` vào địa chỉ) — dùng khi cần so sánh / kiểm thử. */
function forcesWebLayout(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('web') === '1';
  } catch {
    return false;
  }
}

function isNarrowViewport(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia(NARROW_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Có dùng giao diện ứng dụng (thanh tab đáy, thẻ thay cho bảng, hộp thoại dạng tấm trượt) hay không.
 *
 * Dùng khi: mở từ biểu tượng đã cài (standalone), hoặc `?pwa=1`, hoặc màn hình hẹp (điện thoại / máy tính
 * bảng dọc). Lý do màn hình hẹp cũng dùng: giao diện web có nhiều bảng rộng (Vị thế, Cập nhật giá, ...)
 * buộc phải kéo ngang trên điện thoại, kể cả khi người dùng mở bằng trình duyệt chứ chưa cài ứng dụng.
 * Máy tính (>= 1024px) vẫn dùng giao diện web đầy đủ. Thêm `?web=1` để ép giao diện web.
 */
export function shouldUseAppLayout(): boolean {
  if (forcesWebLayout()) return false;
  return isPwaStandalone() || isNarrowViewport();
}

/** Hook theo dõi realtime: cài ứng dụng / xoay màn hình / đổi cỡ cửa sổ đều cập nhật theo. */
export function useIsPwaApp(): boolean {
  const [isPwa, setIsPwa] = useState<boolean>(() => shouldUseAppLayout());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const queries = [window.matchMedia('(display-mode: standalone)'), window.matchMedia(NARROW_QUERY)];
    const sync = () => setIsPwa(shouldUseAppLayout());
    sync();
    for (const mq of queries) {
      if (mq.addEventListener) mq.addEventListener('change', sync);
      else mq.addListener?.(sync);
    }
    return () => {
      for (const mq of queries) {
        if (mq.removeEventListener) mq.removeEventListener('change', sync);
        else mq.removeListener?.(sync);
      }
    };
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
