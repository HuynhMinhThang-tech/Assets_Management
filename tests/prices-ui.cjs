/**
 * Kiểm thử giao diện tab "Cập nhật giá" trong Chromium (không cần máy chủ/đăng nhập: giá thị trường giả qua fetch).
 * Chạy: bash tests/run-all.sh đã tạo sẵn stub; hoặc tự chạy:  node tests/prices-ui.cjs
 * Cần: playwright + esbuild (đặt ESBUILD=/đường/dẫn/esbuild nếu không nằm trong NODE_PATH), stub lucide-react (tests/gen-stubs.sh).
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const G = process.env.NODE_PATH || execFileSync('npm', ['root', '-g']).toString().trim();
const esbuild = process.env.ESBUILD || path.join(G, 'tsx/node_modules/esbuild/bin/esbuild');
const out = path.join(root, 'tests/dist');
fs.mkdirSync(out, { recursive: true });
execFileSync(esbuild, ['tests/prices-ui.entry.tsx', '--bundle', `--outfile=${out}/prices-ui.js`, '--format=iife', '--jsx=automatic', '--platform=browser',
  '--loader:.css=empty', '--define:process.env.NODE_ENV="development"', '--log-level=warning'], { cwd: root, stdio: 'inherit' });
fs.writeFileSync(path.join(out, 'prices-ui.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script src="prices-ui.js"></script>');

let pass = 0, fail = 0;
const log = (ok, id, name, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${ok ? '' : '\n       ' + extra}`); };
const num = (s) => Number(String(s).replace(/[^\d-]/g, ''));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('file://' + path.join(out, 'prices-ui.html'));
  await page.waitForSelector('[data-price-row="fpt"]');
  const st = () => page.evaluate(() => window.__state);
  const asset = async (id) => (await st()).assets.find((a) => a.id === id);

  await page.waitForSelector('[data-price-row="fpt"] [data-auto-price]');
  log(true, 'V1', 'tab hiển thị, tải giá tự động từ /api/prices');
  const groups = await page.locator('[data-price-group]').evaluateAll((els) => els.map((e) => e.getAttribute('data-price-group')));
  log(groups.join(',') === 'stock,other,savings', 'V2', 'nhóm theo loại tài sản, bỏ nhóm không có', groups.join(','));
  const noQuote = await page.locator('[data-price-row="vcb"] [data-auto-price]').count();
  const manualTxt = await page.locator('[data-price-row="car"]').innerText();
  log(noQuote === 0 && /Nhập tay/.test(manualTxt), 'V3', 'cổ phiếu chưa có giá → "Chưa có giá tự động"; xe → "Nhập tay"', manualTxt);
  const savInputs = await page.locator('[data-price-group="savings"] input').count();
  const savRow = await page.locator('[data-price-group="savings"] tbody').innerText();
  log(savInputs === 0 && /tự tính theo lãi suất/.test(savRow), 'V4', 'tiết kiệm chỉ xem, không có ô nhập', savInputs + ' | ' + savRow);
  const btnTxt = await page.locator('[data-apply-all]').innerText();
  log(/\(1\)/.test(btnTxt), 'V5', 'nút "Áp dụng giá tự động" đếm đúng: 1 giá ok (HPG lệch bị loại)', btnTxt);

  // Xem trước khi nhập tay
  const carInput = page.locator('[data-price-row="car"] input');
  await carInput.fill('430000000');
  const prev = await page.locator('[data-price-row="car"] [data-price-preview]').innerText();
  log(/430\.000\.000/.test(prev) && /-70\.000\.000/.test(prev), 'V6', 'nhập giá → xem trước tổng giá trị + lãi/lỗ', prev);

  // Lưu tay
  await page.locator('[data-price-row="car"]').getByRole('button', { name: 'Lưu' }).click();
  await page.waitForTimeout(150);
  const car = await asset('car');
  log(car.currentValue === 430e6 && car.valuationHistory?.length >= 1 && car.lastValuationDate.length === 10, 'V7', 'Lưu tay: giá trị đổi + ghi lịch sử định giá', JSON.stringify(car));

  // Nhập tay lệch bất thường → hỏi xác nhận
  await page.locator('[data-price-row="car"] input').fill('900000000');
  await page.locator('[data-price-row="car"]').getByRole('button', { name: 'Lưu' }).click();
  await page.getByRole('button', { name: 'Vẫn lưu' }).waitFor({ timeout: 2000 });
  await page.getByRole('button', { name: 'Hủy' }).click();
  await page.waitForTimeout(100);
  log((await asset('car')).currentValue === 430e6, 'V8', 'giá lệch > 20% → hỏi xác nhận; Hủy thì không đổi');

  // Áp dụng tất cả giá tự động
  await page.locator('[data-apply-all]').click();
  await page.getByRole('button', { name: 'Áp dụng tất cả' }).click();
  await page.waitForTimeout(200);
  const fpt = await asset('fpt'), hpg = await asset('hpg');
  log(fpt.currentValue === 125e6 && fpt.metadata.currentPrice === 125000 && fpt.lastValuationDate === '2026-11-03' && hpg.currentValue === 27e6,
    'V9', 'Áp dụng tất cả: FPT theo giá đóng cửa & ngày giá; HPG (lệch bất thường) KHÔNG bị áp', JSON.stringify([fpt.currentValue, fpt.lastValuationDate, hpg.currentValue]));
  const after = await page.locator('[data-apply-all]').innerText();
  log(/\(0\)/.test(after), 'V10', 'sau khi áp, bộ đếm về 0');

  // HPG áp riêng có cảnh báo
  await page.locator('[data-price-row="hpg"] [data-auto-price] button').click();
  await page.getByRole('button', { name: 'Vẫn áp dụng' }).click();
  await page.waitForTimeout(150);
  log((await asset('hpg')).currentValue === 35e6, 'V11', 'giá lệch bất thường áp riêng sau khi xác nhận');

  // Import CSV
  // Xe hơi đã được lưu giá ở bước V7 (ngày hôm nay) → dòng file phải mang ngày hôm nay mới không bị coi là "cũ hơn".
  const todayStr = new Date().toLocaleDateString('sv-SE');
  const csv = `ma;ngay;gia\nVCB;2026-11-04;102.000\nABC;2026-11-04;5000\nXe hơi;${todayStr};440.000.000\nFPT;2026-10-01;1000\n`;
  fs.writeFileSync(path.join(out, 'import.csv'), '\uFEFF' + csv);
  await page.locator('[data-price-file]').setInputFiles(path.join(out, 'import.csv'));
  await page.waitForSelector('[data-import-plan]');
  const planTxt = await page.locator('[data-import-plan]').innerText();
  log(/Sẵn sàng/.test(planTxt) && /Không khớp/.test(planTxt) && /Bỏ qua \(cũ\)/.test(planTxt), 'V12', 'import CSV: xem trước đủ trạng thái (sẵn sàng / không khớp / cũ)', planTxt);
  const confirmTxt = await page.locator('[data-import-confirm]').innerText();
  log(/2 dòng/.test(confirmTxt), 'V13', 'nút xác nhận đếm đúng 2 dòng hợp lệ', confirmTxt);
  await page.locator('[data-import-confirm]').click();
  await page.waitForTimeout(200);
  const vcb = await asset('vcb'), car2 = await asset('car');
  log(vcb.currentValue === 102e6 && car2.currentValue === 440e6 && car2.lastValuationDate === todayStr, 'V14', 'import: áp đúng giá + đúng ngày trong file', JSON.stringify([vcb.currentValue, car2.currentValue]));

  // Excel bị từ chối nhẹ nhàng
  fs.writeFileSync(path.join(out, 'x.xlsx'), 'fake');
  await page.locator('[data-price-file]').setInputFiles(path.join(out, 'x.xlsx'));
  await page.getByText('Hiện chỉ nhập được file CSV').waitFor({ timeout: 2000 });
  log(true, 'V15', 'file .xlsx → hướng dẫn lưu thành CSV, không crash');
  await page.getByRole('button', { name: 'Đã hiểu' }).click();

  // Làm mới gọi lại máy chủ
  const before = await page.evaluate(() => window.__fetchCount);
  await page.getByRole('button', { name: 'Làm mới' }).click();
  await page.waitForTimeout(200);
  log((await page.evaluate(() => window.__fetchCount)) > before, 'V16', 'nút "Làm mới" tải lại giá');

  log(errors.length === 0, 'V17', 'không có lỗi console/trang', errors.join(' | '));
  await page.screenshot({ path: path.join(out, 'prices-ui.png'), fullPage: true });
  await browser.close();
  console.log(`==== prices-ui: ${pass} pass / ${fail} fail ====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('HARNESS ERROR', e); process.exit(2); });
