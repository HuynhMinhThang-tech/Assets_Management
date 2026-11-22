/*
 * Service worker của "Quản lý tài sản và nợ" (PWA).
 *
 * Mục tiêu: cài được lên màn hình chính, mở nhanh, và vẫn mở được khung ứng dụng khi mất mạng.
 * Cố ý KHÔNG lưu dữ liệu tài chính:
 *   - mọi yêu cầu /api/* (đăng nhập, danh mục, giá) đi thẳng ra máy chủ, không qua cache;
 *     nhờ đó không bao giờ hiện số liệu cũ, và đồng bộ phiên bản dữ liệu vẫn đúng như khi chạy trên trình duyệt;
 *   - chỉ lưu khung trang (index.html không chứa dữ liệu người dùng), file JS/CSS có mã băm, biểu tượng và phông chữ.
 * Khi sửa file này, đổi VERSION để máy người dùng bỏ cache cũ.
 */
const VERSION = 'v1';
const SHELL_CACHE = `fintrack-shell-${VERSION}`;
const ASSET_CACHE = `fintrack-assets-${VERSION}`;
const FONT_CACHE = `fintrack-fonts-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE, FONT_CACHE];
const MAX_ASSET_ENTRIES = 80;
const NETWORK_TIMEOUT_MS = 5000;

const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
      // Lưu luôn các file JS/CSS mà khung trang đang dùng: trang vừa nạp xong chưa đi qua service worker,
      // nếu không lưu ở đây thì lần mở đầu tiên khi mất mạng sẽ có khung HTML nhưng thiếu mã chạy.
      try {
        const page = await cache.match('/');
        const html = page ? await page.text() : '';
        const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
        const assetCache = await caches.open(ASSET_CACHE);
        await Promise.allSettled([...new Set(assets)].map((url) => assetCache.add(url)));
      } catch {
        /* không sao: sẽ được lưu dần khi dùng */
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('fintrack-') && !CURRENT_CACHES.includes(n)).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Dữ liệu tài chính: luôn lấy từ máy chủ, không bao giờ lưu.
    if (url.pathname.startsWith('/api/')) return;
    if (req.mode === 'navigate') {
      event.respondWith(networkFirstPage(req));
      return;
    }
    // File có mã băm trong tên: nội dung không đổi, lưu rồi dùng mãi.
    if (url.pathname.startsWith('/assets/')) {
      event.respondWith(cacheFirst(req, ASSET_CACHE, MAX_ASSET_ENTRIES));
      return;
    }
    // Biểu tượng, manifest...: dùng bản đã lưu và cập nhật ngầm.
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
  } else if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONT_CACHE, 30));
  }
});

async function networkFirstPage(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match('/');
  try {
    // Có bản lưu: chờ mạng tối đa vài giây rồi dùng bản lưu (mạng yếu vẫn mở nhanh). Chưa có bản lưu: chờ mạng đến cùng.
    const res = cached ? await withTimeout(fetch(req), NETWORK_TIMEOUT_MS) : await fetch(req);
    if (res && res.ok && res.type === 'basic') cache.put('/', res.clone());
    return res;
  } catch {
    if (cached) return cached;
    return new Response('Không có kết nối mạng và chưa có bản lưu của ứng dụng. Hãy kết nối mạng rồi mở lại.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

async function cacheFirst(req, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    cache.put(req, res.clone());
    trimCache(cache, maxEntries);
  }
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (hit) return hit;
  const res = await refresh;
  return res || new Response('', { status: 504 });
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i++) await cache.delete(keys[i]);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}
