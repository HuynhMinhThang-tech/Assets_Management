/**
 * Kiểm thử BỐ CỤC ỨNG DỤNG (PWA) trên điện thoại 390px trong Chromium:
 *  - mọi màn hình không tràn ngang, đủ khối thông tin chính
 *  - bộ lọc dạng chip, vị thế theo mã bấm để mở, nút thao tác mở đúng hộp thoại (dùng lại hộp thoại của bản web)
 *  - hộp thoại hiện như tấm trượt từ đáy màn hình
 *  - bản WEB (không phải app) vẫn giữ nguyên bảng/bố cục cũ
 * Chạy: node tests/pwa-views.cjs   (cần playwright + esbuild + stub lucide-react: bash tests/gen-stubs.sh)
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const G = process.env.NODE_PATH || execFileSync('npm', ['root', '-g']).toString().trim();
const esbuild = process.env.ESBUILD || path.join(G, 'tsx/node_modules/esbuild/bin/esbuild');
const site = path.join(root, 'tests/dist/pwa-views-site');
fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(path.join(site, 'assets'), { recursive: true });

execFileSync(esbuild, ['src/main.tsx', '--bundle', `--outfile=${site}/assets/app.js`, '--format=iife', '--jsx=automatic', '--platform=browser',
  '--loader:.css=empty', '--define:process.env.NODE_ENV="production"', '--define:import.meta.env.PROD=false', '--log-level=error'], { cwd: root, stdio: 'inherit' });
execFileSync('node', [path.join(__dirname, 'build-css.cjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_PATH: G } });
fs.copyFileSync(path.join(root, 'tests/dist/app.css'), path.join(site, 'assets/app.css'));
for (const f of fs.readdirSync(path.join(root, 'public'))) if (!f.includes('.old.')) fs.copyFileSync(path.join(root, 'public', f), path.join(site, f));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script type="module"[^>]*><\/script>/, '<script defer src="/assets/app.js"></script>').replace('</head>', '<link rel="stylesheet" href="/assets/app.css"></head>');
fs.writeFileSync(path.join(site, 'index.html'), html);

const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  const f = path.join(site, p === '/' ? 'index.html' : p);
  fs.readFile(f, (e, b) => { if (e || !f.startsWith(site)) { res.writeHead(404); res.end('nf'); } else { res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); res.end(b); } });
});

let pass = 0, fail = 0;
const log = (ok, id, name, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${ok ? '' : '\n       ' + extra}`); };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (viewport, role = 'admin') => {
    const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(m.location().url || '') && errors.push(`${m.text()} @ ${m.location().url}`));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.route('**/api/**', (route) => {
      const u = new URL(route.request().url());
      const j = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.pathname === '/api/auth/me') return j({ user: { id: 'u1', email: 'lan@gmail.com', displayName: 'Lan', role, status: 'active' } });
      if (u.pathname === '/api/portfolio') return route.request().method() === 'GET' ? j({ data: null, version: 0 }) : j({ version: 1 });
      if (u.pathname.startsWith('/api/admin')) return j({ accounts: [] });
      return j({ prices: [] });
    });
    return page;
  };
  const tabs = (page) => page.locator('[data-pwa-tabbar] button');
  const go = async (page, i) => { await tabs(page).nth(i).evaluate((b) => b.click()); await page.waitForTimeout(300); };
  const goMore = async (page, label) => {
    await go(page, 4);
    await page.getByText(label, { exact: true }).first().evaluate((b) => b.click());
    await page.waitForTimeout(400);
  };
  const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const dialogInfo = (page) => page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-labelledby]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { left: r.left, right: r.right, bottom: r.bottom, vh: window.innerHeight, vw: window.innerWidth, radiusTop: getComputedStyle(d).borderTopLeftRadius };
  });
  const closeDialog = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(200); if (await page.locator('[role="dialog"]').count()) await page.locator('[role="dialog"] button[aria-label]').first().click().catch(() => {}); await page.waitForTimeout(150); };

  const page = await mk({ width: 390, height: 844 });
  await page.goto(base + '/?pwa=1');
  await page.waitForSelector('[data-pwa-shell]');
  await page.waitForTimeout(400);

  // ---------- Khung chung ----------
  log(await page.evaluate(() => document.documentElement.hasAttribute('data-pwa-app')), 'W1', 'vỏ app bật thuộc tính data-pwa-app trên <html>');
  const hdr = await page.evaluate(() => { const h = document.querySelector('[data-pwa-header]'); return h && { pos: getComputedStyle(h).position, h: h.getBoundingClientRect().height }; });
  log(hdr && hdr.pos === 'sticky' && hdr.h < 80, 'W2', 'thanh đầu app dính đầu màn hình, cao gọn (< 80px)', JSON.stringify(hdr));
  log((await page.locator('[data-pwa-quick-actions]').count()) === 0 && (await page.locator('[data-overview-range]').count()) === 1 && (await page.locator('[data-pwa-theme-toggle]').count()) === 1, 'W3', 'Tổng quan: không còn 3 nút thao tác nhanh; có bộ lọc thời gian và nút đổi sáng/tối ở đầu trang');
  const netBefore = await page.locator('[data-pwa-overview] section').first().innerText();
  await page.selectOption('[data-overview-range]', 'last_month'); await page.waitForTimeout(250);
  log((await page.locator('[data-pwa-net-delta]').count()) === 1 && (await page.locator('[data-pwa-overview] section').first().innerText()) !== netBefore, 'W3b', 'Lọc thời gian \"Tháng trước\": thẻ Tài sản ròng đổi số theo cuối kỳ và hiện biến động so với đầu kỳ');
  await page.selectOption('[data-overview-range]', 'all'); await page.waitForTimeout(250);
  log((await page.locator('[data-pwa-net-delta]').count()) === 0 && (await page.locator('[data-pwa-overview] section').first().innerText()) === netBefore, 'W3c', 'Lọc thời gian \"Hiện tại\": trở về số liệu hôm nay như ban đầu');
  log(await noOverflow(page), 'W4', 'Tổng quan: không tràn ngang');

  // ---------- Tài sản ----------
  await go(page, 1);
  log(await noOverflow(page), 'A1', 'Tài sản: không tràn ngang');
  log((await page.locator('[data-pwa-assets-summary]').count()) === 1 && (await page.locator('table').count()) === 0, 'A2', 'Tài sản: có khối tổng hợp, KHÔNG còn bảng nhiều cột');
  const nPos = await page.locator('[data-position]').count();
  log(nPos === 4 && (await page.locator('[data-pos-action]').count()) === 0, 'A3', 'Vị thế theo mã: 4 dòng gọn, nút thao tác ẩn cho tới khi mở dòng', String(nPos));
  await page.locator('[data-position] >> nth=0').locator('button').first().evaluate((b) => b.click());
  await page.waitForTimeout(150);
  log((await page.locator('[data-pos-action]').count()) >= 2 && (await page.locator('[data-position-lots]').count()) === 1, 'A4', 'Bấm dòng vị thế: hiện các lô + nút Mua thêm / Bán (/ Cổ tức)');
  await page.locator('[data-pos-action="buy"]').first().evaluate((b) => b.click());
  await page.waitForTimeout(250);
  let di = await dialogInfo(page);
  log(!!di && (await page.locator('[role="dialog"]').first().innerText()).includes('Mua thêm'), 'A5', 'Mua thêm mở đúng hộp thoại của bản web');
  log(!!di && di.left === 0 && Math.abs(di.right - di.vw) < 1 && Math.abs(di.bottom - di.vh) < 2 && parseFloat(di.radiusTop) > 8, 'A6', 'Hộp thoại là tấm trượt đáy màn hình: rộng hết ngang, sát đáy, bo góc trên', JSON.stringify(di));
  await closeDialog(page);

  const nCards = await page.locator('[data-pwa-asset]').count();
  log(nCards === 6, 'A7', 'Danh sách: mỗi tài sản đang giữ một thẻ (6)', String(nCards));
  await page.selectOption('[data-asset-category]', 'stock'); await page.waitForTimeout(150);
  log((await page.locator('[data-pwa-asset]').count()) === 2, 'A8', 'Danh sách thả xuống \"Cổ phiếu\" lọc còn 2 thẻ');
  await page.selectOption('[data-asset-category]', 'all');
  await page.locator('#asset-search').fill('vinhomes'); await page.waitForTimeout(150);
  log((await page.locator('[data-pwa-asset]').count()) === 1, 'A9', 'Tìm "vinhomes" còn 1 thẻ');
  await page.locator('#asset-search').fill('');
  await page.selectOption('[data-asset-status]', 'sold'); await page.waitForTimeout(150);
  log((await page.locator('[data-pwa-asset]').count()) === 0 && (await page.getByText('Không tìm thấy tài sản nào').count()) === 1, 'A10', 'Lọc "Đã bán": 0 thẻ + thông báo trống');
  await page.selectOption('[data-asset-status]', 'active'); await page.waitForTimeout(150);
  await page.locator('[data-pwa-asset] [data-asset-action="sell"]').first().evaluate((b) => b.click()); await page.waitForTimeout(250);
  log(!!(await dialogInfo(page)), 'A11', '"Bán / Chốt lời" trên thẻ mở hộp thoại bán');
  await closeDialog(page);
  await page.locator('[data-pwa-asset] [data-asset-action="edit"]').first().evaluate((b) => b.click()); await page.waitForTimeout(250);
  log(!!(await dialogInfo(page)), 'A12', '"Sửa thông tin" trên thẻ mở hộp thoại sửa');
  await closeDialog(page);
  await page.locator('[data-pwa-header-action]').evaluate((b) => b.click()); await page.waitForTimeout(300);
  log(!!(await dialogInfo(page)) && (await page.locator('[role="dialog"]').first().innerText()).includes('Thêm Tài Sản Mới'), 'A13', 'Nút "Thêm tài sản" ở đầu màn hình mở form thêm tài sản');
  await closeDialog(page);

  // ---------- Khoản nợ ----------
  await go(page, 2);
  log(await noOverflow(page), 'D1', 'Khoản nợ: không tràn ngang');
  log((await page.locator('[data-pwa-debts-summary]').count()) === 1 && (await page.locator('[data-pwa-debt]').count()) === 3, 'D2', 'Khoản nợ: khối tổng hợp + 3 thẻ khoản nợ');
  await page.selectOption('[data-debt-security]', 'unsecured'); await page.waitForTimeout(150);
  log((await page.locator('[data-pwa-debt]').count()) === 1, 'D3', 'Danh sách thả xuống \"Tín chấp\" lọc còn 1 khoản');
  await page.selectOption('[data-debt-security]', 'all'); await page.waitForTimeout(150);
  await page.locator('[data-pwa-debt] [data-debt-action="detail"]').first().evaluate((b) => b.click()); await page.waitForTimeout(300);
  di = await dialogInfo(page);
  log(!!di && di.left === 0 && Math.abs(di.right - di.vw) < 1, 'D4', '"Chi tiết & lịch trả" mở chi tiết khoản vay dạng tấm trượt');
  await closeDialog(page);
  log((await page.locator('[data-pwa-debt] [data-debt-action="pay"]').count()) === 3, 'D5', 'Mỗi thẻ có nút "Trả kỳ này" (khóa nếu đã trả trong tháng)');
  await page.locator('[data-pwa-header-action]').evaluate((b) => b.click()); await page.waitForTimeout(300);
  log((await page.locator('[role="dialog"]').first().innerText().catch(() => '')).includes('Thêm Khoản Vay'), 'D6', 'Nút "Thêm khoản nợ" ở đầu màn hình mở form thêm khoản vay');
  await closeDialog(page);

  // ---------- Ví ----------
  await go(page, 3);
  log(await noOverflow(page), 'L1', 'Ví: không tràn ngang');
  log((await page.locator('[data-pwa-wallet-hero]').count()) === 1 && (await page.locator('table').count()) === 0, 'L2', 'Ví: khối số dư + thao tác, KHÔNG còn bảng sổ cái');
  const nTx = await page.locator('[data-tx]').count();
  log(nTx === 7, 'L3', 'Nhật ký: 7 giao dịch dạng thẻ, gom theo ngày', String(nTx));
  await page.selectOption('[data-ledger-type]', 'debt_payment'); await page.waitForTimeout(150);
  log((await page.locator('[data-tx]').count()) === 2, 'L4', 'Danh sách thả xuống \"Trả nợ\" lọc còn 2 giao dịch');
  await page.selectOption('[data-ledger-type]', 'all');
  await page.selectOption('[data-range]', 'custom'); await page.waitForTimeout(150);
  log((await page.locator('#ledger-from').count()) === 1 && (await page.locator('#ledger-to').count()) === 1, 'L5', 'Chọn \"Chọn ngày…\" hiện hai ô Từ ngày / Đến ngày');
  await page.locator('#ledger-from').fill('2026-10-01'); await page.waitForTimeout(150);
  log((await page.locator('[data-tx]').count()) === 2, 'L6', 'Từ 01/10/2026: còn 2 giao dịch (05/10 và 01/10)', String(await page.locator('[data-tx]').count()));
  await page.selectOption('[data-range]', 'all');
  await page.locator('[data-wallet-action="deposit"]').evaluate((b) => b.click()); await page.waitForTimeout(250);
  log((await page.locator('[role="dialog"]').first().innerText().catch(() => '')).includes('Nạp Vốn'), 'L7', '"Nạp tiền" mở form nạp vốn (tấm trượt)');
  await closeDialog(page);
  const voidBtn = page.locator('[data-void-tx]').first();
  if (await voidBtn.count()) {
    await voidBtn.evaluate((b) => b.click()); await page.waitForTimeout(250);
    log((await page.locator('[role="dialog"]').count()) >= 1, 'L8', 'Nút "Hủy" trên giao dịch hỏi xác nhận (không hủy ngay)');
    await closeDialog(page);
  } else log(true, 'L8', '(không có giao dịch nào được phép hủy trong dữ liệu mẫu — bỏ qua)');

  // ---------- Mục Khác + màn hình phụ ----------
  await go(page, 4);
  const moreText = await page.locator('[data-pwa-more]').innerText();
  log((await page.locator('[data-pwa-logout]').count()) === 1 && (await page.locator('[data-pwa-theme-toggle]').count()) === 0 && (await page.locator('[data-pwa-install-group]').count()) === 0 && !/Thao tác nhanh|Ứng dụng|Giao diện/.test(moreText), 'M1', 'Mục Khác: chỉ còn chức năng mở rộng + Tài khoản/Đăng xuất (đã bỏ Thao tác nhanh, Ứng dụng, Giao diện)');
  log(await page.evaluate(() => {
    const logout = document.querySelector('[data-pwa-logout]'); const acct = logout && logout.previousElementSibling;
    return !!acct && logout.parentElement === acct.parentElement;
  }), 'M1b', 'Tài khoản và Đăng xuất nằm chung một thẻ');
  await go(page, 0);
  const before = await page.evaluate(() => document.documentElement.className + '|' + document.documentElement.getAttribute('data-theme'));
  await page.locator('[data-pwa-theme-toggle]').evaluate((b) => b.click()); await page.waitForTimeout(150);
  const after = await page.evaluate(() => document.documentElement.className + '|' + document.documentElement.getAttribute('data-theme'));
  log(before !== after, 'M2', 'Nút sáng/tối ở đầu Tổng quan hoạt động', `${before} -> ${after}`);
  await page.locator('[data-pwa-theme-toggle]').evaluate((b) => b.click());
  await go(page, 4);

  await goMore(page, 'Cập nhật giá');
  log(await noOverflow(page), 'P1', 'Cập nhật giá: không tràn ngang');
  log((await page.locator('[data-price-row]').count()) >= 5 && (await page.locator('[data-pwa-price-list]').count()) >= 1 && (await page.locator('table').count()) === 0, 'P2', 'Cập nhật giá: mỗi tài sản một khối (không bảng), có ô nhập giá + nút Lưu');

  await goMore(page, 'Lịch thu chi');
  log(await noOverflow(page), 'C1', 'Lịch thu chi: không tràn ngang');
  log((await page.locator('[data-pwa-calendar-summary]').count()) === 1, 'C2', 'Lịch thu chi: tổng kết tháng gọn trong một thẻ');
  const nested = await page.evaluate(() => [...document.querySelectorAll('[data-pwa-event-list]')].every((e) => getComputedStyle(e).overflowY !== 'auto'));
  log(nested, 'C3', 'Lịch thu chi: danh sách sự kiện không tạo vùng cuộn lồng nhau');

  await goMore(page, 'Báo cáo');
  log(await noOverflow(page), 'R1', 'Báo cáo: không tràn ngang');
  log((await page.locator('[data-pwa-bs-summary]').count()) === 1 && (await page.locator('[data-pwa-compare]').count()) === 1, 'R2', 'Báo cáo: tóm tắt 3 số + biến động trong kỳ dạng danh sách');
  await page.locator('[data-report-tab="cashflow"]').evaluate((b) => b.click()); await page.waitForTimeout(200);
  log((await page.locator('[data-report="cashflow"]').count()) === 1 && (await noOverflow(page)), 'R3', 'Báo cáo: tab "Lưu chuyển tiền" hiện đủ, không tràn');
  await page.locator('[data-report-tab="profit"]').evaluate((b) => b.click()); await page.waitForTimeout(200);
  log(await noOverflow(page), 'R4', 'Báo cáo: tab "Hoạt động" không tràn ngang');

  // ---------- Các độ rộng điện thoại khác: 360px (máy nhỏ) và 430px (máy lớn) ----------
  for (const w of [360, 430]) {
    await page.setViewportSize({ width: w, height: 800 });
    const bad = [];
    for (const [label, via] of [['Tổng quan', 0], ['Tài sản', 1], ['Khoản nợ', 2], ['Ví', 3], ['Cập nhật giá', 'more'], ['Lịch thu chi', 'more'], ['Báo cáo', 'more']]) {
      if (via === 'more') await goMore(page, label); else await go(page, via);
      if (!(await noOverflow(page))) bad.push(label);
    }
    log(bad.length === 0, 'W5', `Độ rộng ${w}px: mọi màn hình không tràn ngang`, bad.join(', '));
  }

  await page.context().close();

  // ---------- Bản WEB phải giữ nguyên ----------
  {
    const wp = await mk({ width: 1280, height: 900 });
    await wp.goto(base + '/'); await wp.waitForSelector('[data-sidebar]'); await wp.waitForTimeout(300);
    log(!(await wp.evaluate(() => document.documentElement.hasAttribute('data-pwa-app'))), 'X1', 'Bản web: <html> KHÔNG có data-pwa-app');
    await wp.getByText('Danh mục Tài sản', { exact: true }).first().evaluate((b) => b.closest('button,a').click()); await wp.waitForTimeout(300);
    log((await wp.locator('table').count()) >= 1 && (await wp.locator('[data-pwa-asset]').count()) === 0 && (await wp.locator('[data-pwa-assets-summary]').count()) === 0, 'X2', 'Bản web: tab Tài sản vẫn là bảng cũ, không có khối của app');
    await wp.getByText('Khoản nợ & Lịch trả', { exact: true }).first().evaluate((b) => b.closest('button,a').click()); await wp.waitForTimeout(300);
    log((await wp.locator('[data-pwa-debt]').count()) === 0 && (await wp.locator('[data-pwa-debts-summary]').count()) === 0, 'X3', 'Bản web: tab Khoản nợ không có khối của app');
    await wp.getByText('Ví & Dòng tiền', { exact: true }).first().evaluate((b) => b.closest('button,a').click()); await wp.waitForTimeout(300);
    log((await wp.locator('table').count()) >= 1 && (await wp.locator('[data-pwa-tx-list]').count()) === 0, 'X4', 'Bản web: tab Ví vẫn là bảng sổ cái cũ');
    await wp.context().close();
  }

  log(errors.length === 0, 'E1', 'Không có lỗi JS/console trong toàn bộ kịch bản', errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  console.log(`\n==== Bố cục ứng dụng (PWA): ${pass} pass / ${fail} fail ====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
