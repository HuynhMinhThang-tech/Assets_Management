/**
 * Kiểm thử PWA trong Chromium (máy chủ tĩnh giả lập Vercel trên localhost, API giả qua page.route).
 * Chạy: node tests/pwa.cjs   (cần playwright + esbuild + stub lucide-react: bash tests/gen-stubs.sh)
 *
 * Dựng đúng như bản triển khai: index.html thật + public/ (manifest, sw.js, biểu tượng) + bundle của src/main.tsx
 * (định nghĩa import.meta.env.PROD = true để main.tsx đăng ký service worker như khi chạy npm run build).
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const G = process.env.NODE_PATH || execFileSync('npm', ['root', '-g']).toString().trim();
const esbuild = process.env.ESBUILD || path.join(G, 'tsx/node_modules/esbuild/bin/esbuild');
const site = path.join(root, 'tests/dist/pwa-site');
fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(path.join(site, 'assets'), { recursive: true });

// ---- dựng "bản triển khai" ----
execFileSync(esbuild, ['src/main.tsx', '--bundle', `--outfile=${site}/assets/index-test1234.js`, '--format=iife', '--jsx=automatic', '--platform=browser',
  '--loader:.css=empty', '--define:process.env.NODE_ENV="production"', '--define:import.meta.env.PROD=true', '--log-level=warning'], { cwd: root, stdio: 'inherit' });
execFileSync('node', [path.join(__dirname, 'build-css.cjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_PATH: G } });
fs.copyFileSync(path.join(root, 'tests/dist/app.css'), path.join(site, 'assets/index-test5678.css'));
for (const f of fs.readdirSync(path.join(root, 'public'))) if (!f.includes('.old.')) fs.copyFileSync(path.join(root, 'public', f), path.join(site, f));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script type="module"[^>]*><\/script>/, '<script defer src="/assets/index-test1234.js"></script>')
  .replace('</head>', '<link rel="stylesheet" href="/assets/index-test5678.css"></head>');
fs.writeFileSync(path.join(site, 'index.html'), html);

const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  const f = path.join(site, p === '/' ? 'index.html' : p);
  fs.readFile(f, (e, b) => { if (e || !f.startsWith(site)) { res.writeHead(404); res.end('nf'); } else { res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); res.end(b); } });
});

let pass = 0, fail = 0;
const log = (ok, id, name, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${ok ? '' : '\n       ' + extra}`); };
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const errors = [];
  const apiHits = [];
  const mkPage = async (ctx) => {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    // Phông Google không tải được trong môi trường kiểm thử (không có Internet) → bỏ qua lỗi tải tài nguyên của chính hai host phông
    page.on('console', (m) => m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(m.location().url || '') && errors.push(`${m.text()} @ ${m.location().url}`));
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url()); apiHits.push(u.pathname);
      const j = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/auth/me') return j({ user: { id: 'u1', email: 'lan@gmail.com', displayName: 'Lan', role: 'user', status: 'active' } });
      if (u.pathname === '/api/portfolio') return route.request().method() === 'GET' ? j({ data: null, version: 0 }) : j({ version: 1 });
      return j({ prices: [] });
    });
    return page;
  };

  // ---------- Manifest + biểu tượng + thẻ <head> ----------
  {
    const ctx = await browser.newContext(); const page = await mkPage(ctx);
    await page.goto(base + '/'); await page.waitForSelector('[data-sidebar]');
    const head = await page.evaluate(() => ({
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
      apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
      capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content'),
      title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content'),
      theme: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    }));
    log(head.manifest === '/manifest.webmanifest' && head.apple === '/apple-touch-icon.png' && head.capable === 'yes' && !!head.title, 'P1', 'index.html có manifest, apple-touch-icon, chế độ app trên iOS, tên ngắn', JSON.stringify(head));
    const mf = await (await fetch(base + head.manifest)).json();
    const need = ['name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'icons'];
    log(need.every((k) => mf[k]) && mf.display === 'standalone' && mf.start_url === '/' && mf.lang === 'vi', 'P2', 'manifest đủ trường bắt buộc, display=standalone, start_url=/, lang=vi', JSON.stringify(mf).slice(0, 200));
    const sizes = [];
    for (const ic of mf.icons) { const b = Buffer.from(await (await fetch(base + ic.src)).arrayBuffer()); sizes.push(`${ic.purpose}:${pngSize(b).w}x${pngSize(b).h}`); }
    const okIcons = mf.icons.every((ic, i) => sizes[i] === `${ic.purpose}:${ic.sizes}`) && mf.icons.some((i) => i.purpose === 'maskable') && mf.icons.some((i) => i.sizes === '192x192') && mf.icons.some((i) => i.sizes === '512x512');
    log(okIcons, 'P3', 'icon 192, 512 và maskable có thật và đúng kích thước khai báo', sizes.join(' '));
    const a = Buffer.from(await (await fetch(base + '/apple-touch-icon.png')).arrayBuffer());
    log(pngSize(a).w === 180 && pngSize(a).h === 180 && a[25] !== 6 && a[25] !== 4, 'P4', 'apple-touch-icon 180x180, không trong suốt (iOS sẽ tô nền đen nếu có trong suốt)', `${pngSize(a).w}x${pngSize(a).h} colorType=${a[25]}`);
    await ctx.close();
  }

  // ---------- Service worker, ngoại tuyến, không lưu /api ----------
  {
    const ctx = await browser.newContext(); const page = await mkPage(ctx);
    await page.goto(base + '/'); await page.waitForSelector('[data-sidebar]');
    const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; for (let i = 0; i < 50 && r.active && r.active.state !== 'activated'; i++) await new Promise((x) => setTimeout(x, 100)); return { scope: r.scope, state: r.active && r.active.state, url: r.active && r.active.scriptURL }; });
    log(reg.scope === base + '/' && /sw\.js$/.test(reg.url) && reg.state === 'activated', 'P5', 'service worker /sw.js được đăng ký, phạm vi "/", đã kích hoạt', JSON.stringify(reg));
    await page.reload(); await page.waitForSelector('[data-sidebar]');
    log(await page.evaluate(() => !!navigator.serviceWorker.controller), 'P6', 'sau khi tải lại, trang do service worker điều khiển');
    const cached = await page.evaluate(async () => { const out = {}; for (const n of await caches.keys()) out[n] = (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname); return out; });
    const all = Object.values(cached).flat();
    log(all.includes('/') && all.some((p) => /^\/assets\/.*\.js$/.test(p)) && all.some((p) => /^\/assets\/.*\.css$/.test(p)) && all.includes('/manifest.webmanifest'), 'P7', 'đã lưu khung trang, JS, CSS, manifest để mở khi mất mạng', JSON.stringify(cached));
    log(!all.some((p) => p.startsWith('/api/')), 'P8', 'KHÔNG lưu bất kỳ yêu cầu /api nào (dữ liệu tài chính luôn lấy từ máy chủ)', all.join(','));
    // Mất mạng: mở lại phải ra được ứng dụng (không phải trang lỗi của trình duyệt)
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#root') && document.querySelector('#root').children.length > 0, null, { timeout: 8000 }).catch(() => {});
    const offline = await page.evaluate(() => ({ rootKids: document.querySelector('#root')?.children.length || 0, text: document.body.innerText.slice(0, 160) }));
    log(offline.rootKids > 0 && !/ERR_|This site can/i.test(offline.text), 'P9', 'mất mạng vẫn mở được khung ứng dụng (không văng trang lỗi trình duyệt)', JSON.stringify(offline));
    await ctx.setOffline(false);
    // Yêu cầu /api vẫn đi ra mạng ở lần tải sau
    const before = apiHits.length;
    await page.reload(); await page.waitForSelector('[data-sidebar]');
    log(apiHits.length > before, 'P10', 'có mạng lại: /api/* vẫn được gọi tới máy chủ (không bị service worker chặn/lấy cache)', `hits ${before}→${apiHits.length}`);
    await ctx.close();
  }

  // ---------- Nút cài đặt / hướng dẫn iPhone ----------
  {
    const ctx = await browser.newContext(); const page = await mkPage(ctx);
    await page.goto(base + '/'); await page.waitForSelector('[data-sidebar]');
    const guide = page.locator('[data-install-guide]');
    log((await guide.count()) === 1 && /Hướng dẫn cài iPhone PWA/.test(await guide.innerText()), 'P11', 'chưa cài: thanh bên có nút "Hướng dẫn cài iPhone PWA"');
    await guide.click();
    await page.waitForSelector('[role="dialog"]');
    const dlg = await page.locator('[role="dialog"]').innerText();
    const box = await page.locator('[role="dialog"]').boundingBox();
    const vp = page.viewportSize();
    log(/Safari/.test(dlg) && /Chia sẻ/.test(dlg) && /Thêm vào MH chính/.test(dlg) && box.x >= 0 && box.x + box.width <= vp.width && box.y >= 0 && box.y + box.height <= vp.height, 'P12', 'hộp hướng dẫn 3 bước hiện đủ trong màn hình (Safari → Chia sẻ → Thêm vào MH chính)', JSON.stringify(box));
    await page.getByRole('button', { name: 'Đã hiểu' }).click(); await page.waitForTimeout(100);
    log((await page.locator('[role="dialog"]').count()) === 0, 'P13', '"Đã hiểu" đóng hộp hướng dẫn');
    await guide.click(); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
    log((await page.locator('[role="dialog"]').count()) === 0, 'P14', 'Esc đóng hộp hướng dẫn');
    // trình duyệt cho cài tự động (Chrome/Edge/Android)
    await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => { window.__prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
    await page.waitForSelector('[data-install-app]');
    log((await page.locator('[data-install-guide]').count()) === 0, 'P15', 'có beforeinstallprompt → nút đổi thành "Cài đặt ứng dụng (PWA)"');
    await page.click('[data-install-app]'); await page.waitForTimeout(150);
    log((await page.evaluate(() => window.__prompted)) === true && (await page.locator('[data-install-app],[data-install-guide]').count()) === 0, 'P16', 'bấm nút gọi hộp thoại cài đặt của trình duyệt; cài xong nút biến mất');
    await ctx.close();
  }
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => { const o = window.matchMedia.bind(window); window.matchMedia = (q) => (q === '(display-mode: standalone)' ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : o(q)); });
    const page = await mkPage(ctx); await page.goto(base + '/'); await page.waitForSelector('[data-sidebar]');
    log((await page.locator('[data-install-app],[data-install-guide]').count()) === 0, 'P17', 'đã mở ở chế độ ứng dụng (standalone) → không hiện nút cài');
    await ctx.close();
  }
  // Điện thoại: nút nằm trong ngăn kéo và hộp thoại không bị nhốt trong ngăn kéo
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await mkPage(ctx);
    await page.goto(base + '/?web=1'); await page.waitForSelector('[data-open-nav]'); // ?web=1: ép giao diện web (mặc định điện thoại dùng vỏ ứng dụng)
    await page.click('[data-open-nav]'); await page.waitForTimeout(300);
    await page.locator('[data-install-guide]').click();
    await page.waitForSelector('[role="dialog"]');
    const box = await page.locator('[role="dialog"]').boundingBox();
    log(box.x >= 0 && box.x + box.width <= 390 && box.width > 300, 'P18', 'điện thoại 390px: hộp hướng dẫn rộng đúng màn hình, không bị ngăn kéo nhốt', JSON.stringify(box));
    await ctx.close();
  }

  log(errors.length === 0, 'P19', 'không có lỗi JS/console trong toàn bộ kịch bản', errors.slice(0, 4).join(' | '));
  console.log(`\n==== PWA: ${pass} pass / ${fail} fail ====`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
