/**
 * Kiểm thử giao diện các màn hình/hộp thoại mới trong Chromium (không cần máy chủ/đăng nhập).
 * Chạy: node tests/ui-smoke.cjs   (cần playwright + esbuild + stub lucide-react: bash tests/gen-stubs.sh)
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const G = process.env.NODE_PATH || execFileSync('npm', ['root', '-g']).toString().trim();
const esbuild = process.env.ESBUILD || path.join(G, 'tsx/node_modules/esbuild/bin/esbuild');
const out = path.join(root, 'tests/dist');
fs.mkdirSync(out, { recursive: true });
execFileSync(esbuild, ['tests/ui-smoke.entry.tsx', '--bundle', `--outfile=${out}/ui-smoke.js`, '--format=iife', '--jsx=automatic', '--platform=browser',
  '--loader:.css=empty', '--define:process.env.NODE_ENV="development"', '--log-level=warning'], { cwd: root, stdio: 'inherit' });
execFileSync('node', [path.join(__dirname, 'build-css.cjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_PATH: G } });
fs.writeFileSync(path.join(out, 'ui-smoke.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script src="ui-smoke.js"></script>');

let pass = 0, fail = 0;
const log = (ok, id, name, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${name}${ok ? '' : '\n       ' + extra}`); };

(async () => {
  const browser = await chromium.launch();
  const url = (host) => 'file://' + path.join(out, 'ui-smoke.html') + '?host=' + host;
  const errors = [];
  const newPage = async (host) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(url(host));
    return page;
  };
  const st = (page) => page.evaluate(() => window.__state);

  // ---------- Hộp thoại nhiều lựa chọn (xung đột đồng bộ) ----------
  {
    const page = await newPage('choose');
    await page.click('[data-open-choose]');
    await page.waitForSelector('text=Giữ bản của tôi');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    log((await page.evaluate(() => window.__choice)) === 'defer', 'U1', 'Esc đóng hộp thoại xung đột = "defer" (không mất dữ liệu, không ghi đè)');
    await page.click('[data-open-choose]');
    await page.getByRole('button', { name: 'Giữ bản của tôi' }).click();
    await page.waitForTimeout(80);
    log((await page.evaluate(() => window.__choice)) === 'overwrite', 'U2', 'Bấm nút rõ tên "Giữ bản của tôi" mới trả overwrite');
    await page.click('[data-open-choose]');
    await page.getByRole('button', { name: /Để sau/ }).click();
    await page.waitForTimeout(80);
    log((await page.evaluate(() => window.__choice)) === 'defer', 'U3', 'Nút "Để sau" = defer');
    await page.close();
  }

  // ---------- Vị thế: mua thêm, bán, cổ tức, sửa thông tin ----------
  {
    const page = await newPage('positions');
    await page.waitForSelector('[data-position="stock:FPT"]');
    const row = await page.locator('[data-position="stock:FPT"]').innerText();
    log(/150/.test(row) && /2 lô/.test(row) && /110\.000/.test(row), 'U4', 'Bảng vị thế: 1 dòng/mã, 150 CP, 2 lô, giá vốn BQ 110.000', row.replace(/\s+/g, ' '));

    await page.click('[data-position="stock:FPT"] [data-pos-action="buy"]');
    await page.fill('[data-testid="buymore-qty"]', '50');
    await page.locator('xpath=//label[contains(.,"Giá mua mỗi")]/following::input[1]').fill('130000');
    const pv = await page.locator('[data-testid="buymore-preview"]').innerText();
    log(/6\.500\.000/.test(pv) && /115\.000/.test(pv) && /200/.test(pv), 'U5', 'Mua thêm: xem trước tổng chi, giá vốn BQ mới, tổng số lượng', pv.replace(/\s+/g, ' '));
    await page.click('[data-testid="buymore-save"]');
    await page.waitForTimeout(150);
    let s = await st(page);
    log(s.assets.length === 3 && s.wallet.availableCash === 50e6 - 6.5e6 && s.transactions.some((t) => t.type === 'buy_asset' && t.amount === 6.5e6), 'U6', 'Lưu mua thêm: thêm 1 lô, trừ ví, ghi giao dịch mua', JSON.stringify(s.wallet));

    await page.click('[data-position="stock:FPT"] [data-pos-action="sell"]');
    await page.fill('[data-testid="sellpos-qty"]', '100');
    await page.locator('xpath=//label[contains(.,"Giá bán mỗi")]/following::input[1]').fill('150000');
    await page.waitForSelector('[data-testid="sellpos-preview"]');
    const spv = await page.locator('[data-testid="sellpos-preview"]').innerText();
    log(/Lãi\/lỗ thực tế/.test(spv) && /Phân bổ theo lô/.test(spv), 'U7', 'Bán theo vị thế: xem trước giá vốn BQ, lãi/lỗ, phân bổ theo lô', spv.replace(/\s+/g, ' '));
    await page.click('[data-testid="sellpos-save"]');
    await page.waitForTimeout(150);
    s = await st(page);
    const sells = s.transactions.filter((t) => t.type === 'sell_asset');
    log(sells.length === 3 && new Set(sells.map((t) => t.groupId)).size === 1 && sells.reduce((a, t) => a + t.amount, 0) === 15e6, 'U8', 'Bán 100/200 CP @150.000: 3 dòng cùng nhóm, tổng thực nhận 15.000.000', JSON.stringify(sells.map((t) => t.amount)));

    await page.click('[data-open-edit]');
    await page.fill('[data-testid="edit-asset-name"]', 'FPT lô 1');
    await page.locator('[data-edit-locked], :text("Số cổ phiếu")').first().waitFor({ timeout: 2000 });
    await page.click('[data-testid="edit-asset-save"]');
    await page.waitForTimeout(150);
    s = await st(page);
    log(s.assets[0].name === 'FPT lô 1' && s.editLog && s.editLog[0].field === 'name', 'U9', 'Sửa thông tin tài sản: đổi tên, ghi lịch sử chỉnh sửa', JSON.stringify(s.editLog));
    await page.close();
  }

  // ---------- Khoản vay: thêm (một mức lãi, tài sản chưa nhập), đổi lãi suất có xem trước, sửa thông tin ----------
  {
    const page = await newPage('debts');
    await page.waitForSelector('text=Vay mua nhà');
    // mở form thêm
    await page.click('[data-open-add]');
    await page.waitForSelector('[data-debt-mode="tracked"]');
    const html = await page.locator('form').innerHTML();
    log(!/Thả nổi|Cố định|Ưu đãi/.test(html) && /Lãi suất hiện tại/.test(html), 'U10', 'Form thêm khoản vay: một ô lãi suất hiện tại, không còn thả nổi/cố định/ưu đãi');
    const rateVal = await page.inputValue('#debt-rate');
    const tenorVal = await page.locator('input[placeholder="Số kỳ còn phải trả"]').inputValue();
    log(rateVal === '' && tenorVal === '', 'U11', 'Lãi suất và số kỳ để trống, không điền sẵn số mẫu');

    const texts = page.locator('form input[type="text"]');
    await texts.nth(0).fill('Vay mua căn hộ');
    await texts.nth(1).fill('Techcombank');
    await page.locator('xpath=//label[contains(.,"Dư nợ gốc còn lại hiện tại")]/following::input[1]').fill('800000000');
    await page.fill('#debt-rate', '8.5');
    await page.locator('input[placeholder="Số kỳ còn phải trả"]').fill('120');
    const due = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 20); return d.toISOString().slice(0, 10); });
    await page.locator('xpath=//label[contains(.,"Ngày đến hạn kỳ tiếp theo")]/following::input[1]').fill(due);
    await page.selectOption('[data-testid="fund-kind"]', 'asset_new');
    await page.waitForSelector('[data-testid="new-asset-box"]');
    await page.fill('[data-testid="new-asset-name"]', 'Căn hộ An Bình');
    await page.locator('xpath=//*[@data-testid="new-asset-box"]//label[contains(.,"Giá trị hiện tại")]/following::input[1]').fill('2000000000');
    await page.getByRole('button', { name: 'Lưu khoản nợ' }).click();
    await page.waitForTimeout(200);
    let s = await st(page);
    const nd = s.debts.find((d) => d.name === 'Vay mua căn hộ');
    const na = s.assets.find((a) => a.name === 'Căn hộ An Bình');
    log(!!nd && !!na && s.wallet.availableCash === 100e6 && na.preexisting === true && na.openingValue === 2e9 && nd.openingBalance === 800e6 && nd.annualInterestRate === 8.5 && nd.fundUse.assetId === na.id && s.transactions.length === 0,
      'U12', 'Lưu khoản vay đang trả dở + tài sản chưa nhập: không trừ ví, số dư ban đầu 2 tỷ − 800 triệu, lãi 8,5%', JSON.stringify({ nd: nd && [nd.openingBalance, nd.annualInterestRate, nd.fundUse], na: na && [na.preexisting, na.openingValue], cash: s.wallet.availableCash, err: await page.evaluate(() => window.__lastError) }));

    // chi tiết khoản vay đầu tiên → Đổi lãi suất
    const card = page.locator('div', { has: page.getByText('Vay mua nhà', { exact: true }) }).filter({ has: page.getByRole('button', { name: /Chi tiết/ }) }).last();
    await card.getByRole('button', { name: /Chi tiết/ }).first().click();
    await page.getByRole('button', { name: 'Đổi lãi suất' }).click();
    await page.fill('[data-testid="rate-value"]', '11');
    const eff = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 45); return d.toISOString().slice(0, 10); });
    await page.fill('[data-testid="rate-date"]', eff);
    await page.waitForSelector('[data-preview="rate-preview"]');
    const rp = await page.locator('[data-preview="rate-preview"]').innerText();
    log(/9% → 11%/.test(rp) && /Tiền kỳ tới/.test(rp) && /Tổng lãi còn phải trả/.test(rp) && /Kỳ đầu tiên bị ảnh hưởng/.test(rp), 'U13', 'Đổi lãi suất: xem trước 9% → 11%, tiền kỳ tới, kỳ ảnh hưởng, tổng lãi', rp.replace(/\s+/g, ' '));
    await page.getByRole('button', { name: 'Lưu mốc lãi suất' }).click();
    await page.waitForTimeout(150);
    s = await st(page);
    const dA = s.debts.find((d) => d.id === 'dA');
    log(dA.rateTimeline.length === 2 && dA.rateTimeline[1].annualRate === 11 && dA.annualInterestRate !== undefined, 'U14', 'Lưu mốc lãi: dòng thời gian có 2 mốc (9% → 11%)', JSON.stringify(dA.rateTimeline));

    await page.getByRole('button', { name: 'Sửa thông tin' }).click();
    await page.fill('[data-testid="edit-debt-name"]', 'Vay nhà VCB');
    await page.fill('[data-testid="edit-debt-day"]', '20');
    await page.click('[data-testid="edit-debt-save"]');
    await page.waitForTimeout(200);
    s = await st(page);
    const dB = s.debts.find((d) => d.id === 'dA');
    const opens = dB.schedule.filter((i) => !i.isPaid && i.status !== 'cancelled');
    log(dB.name === 'Vay nhà VCB' && dB.paymentDayOfMonth === 20 && opens.every((i) => i.dueDate.endsWith('-20')) && s.editLog.length >= 2, 'U15', 'Sửa khoản vay: đổi tên + ngày trả 20, lịch dời đúng, có lịch sử chỉnh sửa', JSON.stringify(opens.slice(0, 2).map((i) => i.dueDate)));
    await page.close();
  }

  // ---------- Điện thoại: ngăn điều hướng, không tràn ngang ----------
  {
    const page = await browser.newPage({ viewport: { width: 375, height: 760 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url('layout'));
    await page.waitForSelector('[data-main]');
    const box = async (sel) => page.locator(sel).first().boundingBox();
    const sb = await box('[data-sidebar]');
    log(sb && sb.x + sb.width <= 1, 'U17', 'Điện thoại 375px: thanh bên ẩn ngoài màn hình (không chiếm chỗ nội dung)', JSON.stringify(sb));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    log(overflow <= 0, 'U18', 'Điện thoại 375px: trang không tràn ngang', String(overflow));
    await page.click('[data-open-nav]');
    await page.waitForTimeout(400);
    const sb2 = await box('[data-sidebar]');
    log(sb2 && sb2.x >= -1 && sb2.width > 200 && sb2.width <= 375 * 0.86, 'U19', 'Bấm ☰: ngăn điều hướng trượt ra, rộng ≤ 85% màn hình', JSON.stringify(sb2));
    await page.getByRole('button', { name: /Danh mục Tài sản/ }).click();
    await page.waitForTimeout(400);
    const tab = await page.evaluate(() => window.__tab);
    const sb3 = await box('[data-sidebar]');
    log(tab === 'assets' && sb3.x + sb3.width <= 1, 'U20', 'Chọn mục: chuyển tab và tự đóng ngăn điều hướng', JSON.stringify([tab, sb3]));
    await page.click('[data-open-nav]');
    await page.waitForTimeout(300);
    await page.mouse.click(360, 400);
    await page.waitForTimeout(400);
    const sb4 = await box('[data-sidebar]');
    log(sb4.x + sb4.width <= 1, 'U21', 'Bấm ra ngoài (nền mờ) đóng ngăn điều hướng');
    const hdr = await page.locator('header').boundingBox();
    const btns = await page.locator('header button').count();
    log(hdr.width <= 375 && btns >= 4, 'U22', 'Thanh đầu trang vừa khổ 375px, nút thu gọn thành biểu tượng', JSON.stringify(hdr));
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);
    const sb5 = await box('[data-sidebar]');
    log(sb5.x >= 0 && sb5.width >= 250, 'U23', 'Màn hình rộng ≥ 1024px: thanh bên cố định như cũ', JSON.stringify(sb5));
    await page.close();
  }

  log(errors.length === 0, 'U16', 'Không có lỗi JavaScript/console trong cả ba màn hình', errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n==== ui-smoke: ${pass} pass / ${fail} fail ====`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
