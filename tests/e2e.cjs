const { chromium } = require('playwright');
const fs = require('fs');
const URL = 'file://' + __dirname + '/dist/index.html';
const KEY = 'fintrack_vn_portfolio_v1';
let pass = 0, fail = 0; const fails = [];
const log = (ok, id, name, detail) => {
  if (ok) { pass++; console.log(`PASS ${id} ${name}`); }
  else { fail++; fails.push(`${id} ${name} -> ${detail}`); console.log(`FAIL ${id} ${name}\n       ${detail}`); }
};
const sum = a => a.reduce((x, y) => x + y, 0);
const nw = s => sum(s.assets.filter(a => a.status === 'active').map(a => a.currentValue)) + s.wallet.availableCash - sum(s.debts.filter(d => d.status === 'active').map(d => d.remainingPrincipal));
const fmt = n => Math.round(n).toLocaleString('vi-VN');

let browser;
async function fresh(opts = {}) {
  const ctx = await browser.newContext({ timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN', acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.errs = []; p.dialogs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  p.on('dialog', async d => { p.dialogs.push(d.message()); await d.accept(); });
  if (opts.preset) await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); } }, [KEY, opts.preset]);
  await p.goto(URL); await p.waitForTimeout(250);
  return p;
}
const st = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY);
const nav = (p, n) => p.getByRole('button', { name: n }).first().click();
const fld = (scope, label) => scope.locator(`label:has-text("${label}") + input, label:has-text("${label}") + textarea, label:has-text("${label}") + select`).first();
const modal = p => p.locator('.fixed').last();

(async () => {
  browser = await chromium.launch();

  // ---------- U1 navigation + CTA continuity
  { const p = await fresh();
    for (const n of ['Danh mục Tài sản', 'Khoản nợ & Lịch trả', 'Ví & Dòng tiền', 'Dữ liệu & Supabase SQL', 'Tổng quan Đầu tư']) { await nav(p, n); await p.waitForTimeout(80); }
    log(p.errs.length === 0, 'U1a', 'điều hướng 5 tab không lỗi runtime', p.errs.join(' | '));
    await p.getByRole('button', { name: 'Thêm tài sản', exact: true }).click(); await p.waitForTimeout(120);
    const opened1 = await p.locator('.fixed').count();
    log(opened1 > 0, 'U1b', 'nút "Thêm tài sản" ở Header mở thẳng form thêm (liền mạch)', 'chỉ chuyển tab, phải bấm thêm lần nữa (modal đang mở: ' + opened1 + ')');
    await nav(p, 'Tổng quan Đầu tư');
    await p.getByRole('button', { name: 'Thêm khoản nợ', exact: true }).click(); await p.waitForTimeout(120);
    log(await p.locator('.fixed').count() > 0, 'U1c', 'nút "Thêm khoản nợ" ở Header mở thẳng form thêm nợ', 'chỉ chuyển tab');
    await nav(p, 'Tổng quan Đầu tư');
    await p.getByRole('button', { name: 'Nạp/Rút ví' }).click(); await p.waitForTimeout(120);
    log(await p.locator('.fixed').count() > 0, 'U1d', 'nút "Nạp/Rút ví" ở Header mở thẳng form nạp/rút', 'chỉ chuyển tab');
    await p.context().close(); }

  // ---------- U2 wallet
  { const p = await fresh(); const s0 = await st(p);
    await nav(p, 'Ví & Dòng tiền'); await p.getByRole('button', { name: 'Nạp tiền' }).click();
    await modal(p).locator('input[inputmode=numeric]').fill('50000000'); await p.getByRole('button', { name: 'Xác nhận Nạp Tiền' }).click();
    const s1 = await st(p);
    log(s1.wallet.availableCash === s0.wallet.availableCash + 5e7 && s1.wallet.totalDeposited === s0.wallet.totalDeposited + 5e7 && s1.transactions.length === s0.transactions.length + 1 && nw(s1) === nw(s0) + 5e7,
      'U2a', 'nạp 50tr: ví +50tr, tổng nạp +50tr, +1 giao dịch, NW +50tr', JSON.stringify({ cash: s1.wallet.availableCash, dep: s1.wallet.totalDeposited }));
    await p.getByRole('button', { name: 'Rút vốn' }).click();
    await modal(p).locator('input[inputmode=numeric]').fill('9999999999'); await p.getByRole('button', { name: 'Xác nhận Rút Vốn' }).click();
    const s2 = await st(p);
    log(s2.wallet.availableCash === s1.wallet.availableCash && p.dialogs.length === 1, 'U2b', 'rút quá số dư bị chặn + cảnh báo', `cash=${s2.wallet.availableCash} dialogs=${p.dialogs.length}`);
    // chuỗi số dư chạy trong sổ cái
    const rows = await p.locator('tbody tr').allInnerTexts();
    log(rows.length >= 6, 'U2c', 'sổ cái hiển thị đủ giao dịch', 'rows=' + rows.length);
    await p.context().close(); }

  // ---------- U3 add asset cash
  { const p = await fresh(); const s0 = await st(p);
    await nav(p, 'Danh mục Tài sản'); await p.getByRole('button', { name: 'Thêm tài sản mới' }).click();
    const m = modal(p);
    await m.locator('button', { hasText: 'Cổ phiếu' }).first().click();
    await fld(m, 'Tên tài sản').fill('VNM test'); await fld(m, 'Mã Cổ phiếu').fill('vnm');
    await fld(m, 'Số lượng cổ phiếu').fill('1000'); await fld(m, 'Giá vốn (đ/CP)').fill('70000');
    const cost = await fld(m, 'Tổng giá vốn đầu tư').inputValue(); const cur = await fld(m, 'Thị giá hiện tại').inputValue();
    log(cost === '70.000.000', 'U3a', 'SL×giá tự tính tổng vốn 70.000.000', 'cost=' + cost);
    await m.getByRole('button', { name: 'Lưu tài sản', exact: true }).click(); await p.waitForTimeout(100);
    const s1 = await st(p); const a = s1.assets[0];
    log(a.name === 'VNM test' && a.metadata.symbol === 'VNM' && s1.wallet.availableCash === s0.wallet.availableCash - 7e7 && nw(s1) === nw(s0),
      'U3b', 'mua CP bằng tiền ví: ví −70tr, NW không đổi, mã CP viết hoa', JSON.stringify({ cash: s1.wallet.availableCash, nwDelta: nw(s1) - nw(s0) }));
    log(s1.transactions[0].type === 'buy_asset' && s1.transactions[0].amount === 7e7, 'U3c', 'sinh giao dịch buy_asset 70tr', JSON.stringify(s1.transactions[0]));
    log(a.metadata.currentPrice === 70000 && a.currentValue === 7e7, 'U3d', 'thị giá/CP khởi tạo = giá mua', JSON.stringify(a.metadata));
    // thiếu: phí mua, ngày mua quá khứ
    log(!(await m.count() && await p.locator('.fixed').count()), 'U3e', 'modal đóng sau khi lưu', 'modal còn mở');
    await p.context().close(); }

  // ---------- U4 buy beyond cash
  { const p = await fresh(); const s0 = await st(p);
    await nav(p, 'Danh mục Tài sản'); await p.getByRole('button', { name: 'Thêm tài sản mới' }).click();
    const m = modal(p);
    await fld(m, 'Tên tài sản').fill('Đất nền test'); await fld(m, 'Tổng giá vốn đầu tư').fill('3000000000');
    await m.getByRole('button', { name: 'Lưu tài sản', exact: true }).click(); await p.waitForTimeout(100);
    const s1 = await st(p);
    log(s1.wallet.availableCash >= 0 && nw(s1) === nw(s0) && p.dialogs.length > 0, 'U4', 'mua 3 tỷ khi ví chỉ có 185tr: phải bị chặn/cảnh báo, NW không tự tăng',
      `ví còn ${fmt(s1.wallet.availableCash)}; NW ${fmt(nw(s0))} → ${fmt(nw(s1))} (tiền "bốc hơi" ${fmt(nw(s1) - nw(s0))}); giao dịch ghi ${fmt(s1.transactions[0].amount)} nhưng ví chỉ giảm ${fmt(s0.wallet.availableCash - s1.wallet.availableCash)}`);
    await p.context().close(); }

  // ---------- U5 buy with loan
  { const p = await fresh(); const s0 = await st(p);
    await nav(p, 'Danh mục Tài sản'); await p.getByRole('button', { name: 'Thêm tài sản mới' }).click();
    const m = modal(p);
    await m.locator('button', { hasText: 'Mua theo khoản vay' }).click();
    await fld(m, 'Tên tài sản').fill('Căn hộ vay test');
    await fld(m, 'Tổng giá trị tài sản').fill('2000000000'); await fld(m, 'Vốn tự có thanh toán ngay').fill('150000000');
    const loanAuto = await fld(m, 'Số tiền vay ngân hàng').inputValue();
    log(loanAuto === '1.850.000.000', 'U5a', 'tiền vay tự = giá − vốn tự có', 'loan=' + loanAuto);
    await fld(m, 'Ngân hàng / Tổ chức cho vay').fill('ACB');
    await m.getByRole('button', { name: /Lưu tài sản & Khoản vay/ }).click(); await p.waitForTimeout(120);
    const s1 = await st(p); const d = s1.debts[0], a = s1.assets[0];
    log(s1.debts.length === 4 && d.principalAmount === 1.85e9 && d.collateralAssetId === a.id && a.linkedDebtId === d.id && d.schedule.length === 240, 'U5b', 'tạo tài sản + nợ liên kết 2 chiều, lịch 240 kỳ', JSON.stringify({ n: s1.debts.length, p: d.principalAmount, col: d.collateralAssetId, sch: d.schedule?.length }));
    log(s1.wallet.availableCash === s0.wallet.availableCash - 1.5e8 && nw(s1) === nw(s0), 'U5c', 'ví −vốn tự có, NW không đổi (tài sản +2tỷ, nợ +1.85tỷ, ví −0.15tỷ)', `ΔNW=${fmt(nw(s1) - nw(s0))} ví=${fmt(s1.wallet.availableCash)}`);
    log(!!d.schedule[0].dueDate && d.schedule[0].dueDate > new Date().toISOString().slice(0, 10), 'U5d', 'kỳ 1 nằm trong tương lai', d.schedule[0].dueDate);
    await p.context().close(); }

  // ---------- U5e loan with past purchase date -> overdue?
  { const p = await fresh(); 
    await nav(p, 'Danh mục Tài sản'); await p.getByRole('button', { name: 'Thêm tài sản mới' }).click();
    const m = modal(p);
    await m.locator('button', { hasText: 'Mua theo khoản vay' }).click();
    await fld(m, 'Tên tài sản').fill('Mua năm ngoái'); await fld(m, 'Ngày mua').fill('2025-03-10');
    await fld(m, 'Tổng giá trị tài sản').fill('1000000000'); await fld(m, 'Vốn tự có thanh toán ngay').fill('300000000');
    await fld(m, 'Ngân hàng / Tổ chức cho vay').fill('VPBank');
    await m.getByRole('button', { name: /Lưu tài sản & Khoản vay/ }).click(); await p.waitForTimeout(120);
    await nav(p, 'Tổng quan Đầu tư'); const body = await p.locator('body').innerText();
    const mm = body.match(/Đã quá hạn (\d+) ngày/);
    log(!mm, 'U5e', 'mua tài sản từ năm ngoái (có vay): app không báo "quá hạn" cả trăm ngày cho kỳ chưa từng ghi nhận', mm ? `Dashboard: "${mm[0]}" – toàn bộ ~19 kỳ quá khứ bị coi là chưa trả` : 'ok');
    await p.context().close(); }

  // ---------- U6 pay from dashboard
  { const p = await fresh(); const s0 = await st(p);
    const btn = p.getByRole('button', { name: /Xác nhận trả kỳ này/ });
    const txt = await p.locator('body').innerText();
    const next = txt.match(/Tổng tiền phải trả kỳ này\s*([\d.]+) ₫/); 
    await btn.click(); await p.waitForTimeout(100);
    const s1 = await st(p); const t = s1.transactions[0];
    const paid = Number(next[1].replace(/\./g, ''));
    log(t.type === 'debt_payment' && t.amount === paid && s1.wallet.availableCash === s0.wallet.availableCash - paid, 'U6a', 'trả kỳ từ Dashboard: ví −đúng số hiển thị, sinh giao dịch', JSON.stringify({ shown: paid, tx: t.amount, cashΔ: s1.wallet.availableCash - s0.wallet.availableCash }));
    const dBefore = s0.debts.find(d => d.id === t.linkedDebtId), dAfter = s1.debts.find(d => d.id === t.linkedDebtId);
    const princ = dBefore.schedule.find(x => !x.isPaid).principalPayable;
    log(dBefore.remainingPrincipal - dAfter.remainingPrincipal === princ, 'U6b', 'dư nợ giảm đúng phần gốc kỳ đó', `${fmt(dBefore.remainingPrincipal - dAfter.remainingPrincipal)} vs ${fmt(princ)}`);
    log(Math.abs((nw(s0) - nw(s1)) - (paid - princ)) < 1, 'U6c', 'NW giảm đúng bằng phần lãi (chi phí thật)', `ΔNW=${fmt(nw(s0) - nw(s1))}`);
    log(p.dialogs.length > 0, 'U6d', 'có bước xác nhận trước khi trừ tiền (tránh bấm nhầm)', 'bấm 1 lần là trừ ví ngay, không hỏi lại, không sửa được số tiền/ngày thực trả, không có nút hoàn tác');
    await p.context().close(); }

  // ---------- U7 amortization modal
  { const p = await fresh(); const s0 = await st(p);
    await nav(p, 'Khoản nợ & Lịch trả');
    await p.getByRole('button', { name: 'Lịch trả nợ' }).first().click(); await p.waitForTimeout(100);
    const m = modal(p);
    const paidBefore = await m.getByText('Đã trả', { exact: true }).count();
    const btns0 = await m.getByRole('button', { name: 'Thanh toán' }).count();
    log(btns0 === 1, 'U7c', 'chỉ kỳ kế tiếp có nút Thanh toán (không trả nhảy kỳ)', 'số nút Thanh toán = ' + btns0);
    await m.getByRole('button', { name: 'Thanh toán' }).first().click(); await p.waitForTimeout(150);
    const s1 = await st(p);
    log(s1.transactions.length === s0.transactions.length + 1 && p.dialogs.length === 1, 'U7a', 'bấm Thanh toán: có xác nhận + ghi nhận 1 giao dịch', `tx ${s1.transactions.length} dialogs ${p.dialogs.length}`);
    const paidAfter = await m.getByText('Đã trả', { exact: true }).count();
    log(paidAfter === paidBefore + 1, 'U7b', 'bảng lịch cập nhật ngay (hàng vừa trả đổi sang "Đã trả")', `Đã trả: ${paidBefore} → ${paidAfter}`);
    const d = s1.debts[0]; const idx = d.schedule.map((x, i) => x.isPaid ? i : -1).filter(i => i >= 0);
    log(idx.every((v, i) => i === 0 || v - idx[i - 1] === 1), 'U7d', 'các kỳ đã trả liên tục, không có lỗ hổng', JSON.stringify(idx.slice(-3)));
    await p.context().close(); }

  // ---------- U8 insufficient cash pay
  { const p = await fresh();
    await nav(p, 'Ví & Dòng tiền'); await p.getByRole('button', { name: 'Rút vốn' }).click();
    await modal(p).locator('input[inputmode=numeric]').fill('184000000'); await p.getByRole('button', { name: 'Xác nhận Rút Vốn' }).click();
    const s0 = await st(p); await nav(p, 'Tổng quan Đầu tư');
    await p.getByRole('button', { name: /Xác nhận trả kỳ này/ }).click(); await p.waitForTimeout(100);
    const s1 = await st(p); const t = s1.transactions[0];
    log(s1.wallet.availableCash >= 0 && p.dialogs.length > 0 && s1.transactions.length === s0.transactions.length, 'U8', 'ví chỉ còn 1tr nhưng trả kỳ ~10tr: phải chặn / cảnh báo thiếu tiền',
      `ví ${fmt(s0.wallet.availableCash)} → ${fmt(s1.wallet.availableCash)}; giao dịch ghi ${fmt(t.amount)} nhưng ví chỉ mất ${fmt(s0.wallet.availableCash - s1.wallet.availableCash)} → sổ cái lệch ${fmt(t.amount - (s0.wallet.availableCash - s1.wallet.availableCash))}`);
    await p.context().close(); }

  // ---------- U9 revalue
  { const p = await fresh(); const s0 = await st(p);
    await nav(p, 'Danh mục Tài sản');
    await p.locator('[title="Cập nhật định giá thị trường mới"]').nth(1).click();
    await modal(p).locator('input[inputmode=numeric]').fill('400000000'); await p.getByRole('button', { name: 'Lưu định giá mới' }).click(); await p.waitForTimeout(100);
    const s1 = await st(p); const a = s1.assets[1];
    log(a.currentValue === 4e8 && a.lastValuationDate === new Date().toISOString().slice(0, 10), 'U9a', 'định giá lại FPT: currentValue + ngày định giá cập nhật', JSON.stringify({ v: a.currentValue, d: a.lastValuationDate }));
    log(Math.abs(a.metadata.currentPrice * a.metadata.quantity - a.currentValue) < 1, 'U9b', 'định giá lại cập nhật luôn thị giá/CP (metadata) để khớp SL × giá', `giá/CP vẫn ${fmt(a.metadata.currentPrice)} nhưng tổng giá trị ${fmt(a.currentValue)} → ngầm hiểu ${fmt(a.currentValue / a.metadata.quantity)}/CP`);
    log(!!a.valuationHistory || !!a.priceHistory, 'U9c', 'có lưu lịch sử định giá (để vẽ biểu đồ tăng trưởng)', 'chỉ lưu giá trị mới nhất, không có lịch sử → không có biểu đồ xu hướng/hiệu suất theo thời gian');
    await p.context().close(); }

  // ---------- U10 sell HPG partial/whole
  { const p = await fresh(); const s0 = await st(p);
    await nav(p, 'Danh mục Tài sản');
    await p.locator('[title="Bán / Chốt lời về ví"]').nth(2).click(); await p.waitForTimeout(80);
    const mtxt = await modal(p).innerText();
    log(/phí|thuế/i.test(mtxt), 'U10a', 'form bán có phí môi giới / thuế TNCN 0,1% (chứng khoán VN)', 'không có ô phí/thuế → lãi thực tế bị tính cao hơn thực tế');
    log(/số lượng|một phần/i.test(mtxt), 'U10b', 'cho bán MỘT PHẦN số lượng (VD bán 2.000/5.000 HPG)', 'chỉ bán toàn bộ; tham số sellAmount bị bỏ qua trong handler');
    await fld(modal(p), 'Tổng tiền bán').fill('160000000'); await p.getByRole('button', { name: 'Xác nhận Bán & Nhập Ví' }).click(); await p.waitForTimeout(100);
    const s1 = await st(p); const a = s1.assets[2];
    log(s1.wallet.availableCash === s0.wallet.availableCash + 1.6e8 && a.status === 'sold' && a.currentValue === 0 && a.realizedPnL === (1.6e8 - 1.325e8), 'U10c', 'bán HPG 160tr: ví +160tr, trạng thái sold, lãi chốt = 160 − 132,5 = 27,5tr', JSON.stringify({ cash: s1.wallet.availableCash - s0.wallet.availableCash, st: a.status, pnl: a.realizedPnL }));
    log(nw(s1) === nw(s0) + (1.6e8 - 1.49e8), 'U10d', 'NW chỉ đổi đúng phần chênh giá bán so với giá trị sổ sách', `ΔNW=${fmt(nw(s1) - nw(s0))}`);
    await p.context().close(); }

  // ---------- U10e partial sell with fees
  { const p = await fresh(); const s0 = await st(p);
    await nav(p, 'Danh mục Tài sản');
    await p.locator('[title="Bán / Chốt lời về ví"]').nth(2).click(); await p.waitForTimeout(80);
    const m = modal(p);
    await fld(m, 'Số lượng bán').fill('2000');
    const proceeds = await fld(m, 'Tổng tiền bán').inputValue();
    log(proceeds === '59.600.000', 'U10e1', 'đổi số lượng bán tự tính tiền theo tỷ lệ (2000/5000 × 149tr)', 'proceeds=' + proceeds);
    await m.locator('label:has-text("Phí môi giới") + div input').first().fill('60000'); await p.getByRole('button', { name: 'Xác nhận Bán & Nhập Ví' }).click(); await p.waitForTimeout(100);
    const s1 = await st(p); const a = s1.assets[2];
    log(a.status === 'active' && a.metadata.quantity === 3000 && a.initialCost === 79500000 && a.currentValue === 89400000, 'U10e2', 'bán 2.000/5.000 HPG: còn 3.000 CP, giá vốn & giá trị giảm theo tỷ lệ', JSON.stringify({ q: a.metadata.quantity, c: a.initialCost, v: a.currentValue }));
    const net = 59600000 - 60000;
    log(s1.wallet.availableCash === s0.wallet.availableCash + net && a.realizedPnL === net - 53000000 && s1.transactions[0].fees === 60000, 'U10e3', 'ví +(tiền bán − phí), lãi thực tế = ròng − giá vốn phần bán', JSON.stringify({ cashΔ: s1.wallet.availableCash - s0.wallet.availableCash, pnl: a.realizedPnL }));
    await p.context().close(); }

  // ---------- U11 sell collateral asset with loan outstanding
  { const p = await fresh(); const s0 = await st(p);
    await nav(p, 'Danh mục Tài sản');
    await p.locator('[title="Bán / Chốt lời về ví"]').nth(0).click(); await p.waitForTimeout(80);
    await fld(modal(p), 'Tổng tiền bán').fill('3450000000'); await p.getByRole('button', { name: 'Xác nhận Bán & Nhập Ví' }).click(); await p.waitForTimeout(100);
    const s1 = await st(p); const d = s1.debts.find(x => x.id === 'debt-vcb-home');
    log(p.dialogs.length > 0 || d.status === 'paid_off' || s1.wallet.availableCash < s0.wallet.availableCash + 3.45e9, 'U11a', 'bán căn hộ đang thế chấp: nhắc/tự tất toán khoản vay liên quan',
      `bán 3,45 tỷ → ví +3,45 tỷ nhưng khoản vay ${d.name} vẫn "${d.status}", dư nợ ${fmt(d.remainingPrincipal)}, vẫn trỏ tới tài sản đã bán`);
    await nav(p, 'Tổng quan Đầu tư'); const body = await p.locator('body').innerText();
    const ltvLine = body.match(/LTV:\s*[\d.]+%/);
    log(!ltvLine, 'U11b', 'Dashboard không hiển thị LTV vô nghĩa cho tài sản đã bán', ltvLine ? 'vẫn hiện ' + ltvLine[0] + ' cho tài sản đã bán' : 'ok');
    await p.context().close(); }

  // ---------- U12 delete asset
  { const p = await fresh(); const s0 = await st(p);
    await nav(p, 'Danh mục Tài sản'); await p.locator('[title="Xóa tài sản"]').nth(0).click(); await p.waitForTimeout(100);
    const s1 = await st(p);
    log(s1.assets.length === s0.assets.length - 1 && s1.debts.find(d => d.id === 'debt-vcb-home').collateralAssetId === undefined, 'U12a', 'xóa tài sản: gỡ liên kết thế chấp khỏi khoản nợ', 'ok?');
    log(p.dialogs.some(d => d.includes('KHÔNG bị đảo ngược')), 'U12b', 'xóa tài sản có cảnh báo rõ: khác với bán, không đảo giao dịch', p.dialogs.join(' | '));
    await p.context().close(); }

  // ---------- U13 add existing debt
  { const p = await fresh(); const s0 = await st(p);
    await nav(p, 'Khoản nợ & Lịch trả'); await p.getByRole('button', { name: 'Thêm khoản vay mới' }).click();
    const m = modal(p);
    const hasDate = await m.locator('input[type=date]').count();
    log(hasDate > 0, 'U13a', 'form thêm nợ có ô NGÀY GIẢI NGÂN (cần để nhập khoản vay đang trả dở)', 'không có ô ngày; startDate luôn = hôm nay');
    await fld(m, 'Tên khoản vay').fill('Vay đang trả test'); await fld(m, 'Ngân hàng / Tổ chức').fill('ACB');
    await fld(m, 'Số gốc vay ban đầu').fill('300000000'); await fld(m, 'Dư nợ gốc còn lại').fill('200000000');
    await m.locator('span', { hasText: 'Cố định' }).first().click().catch(()=>{});
    await fld(m, 'Lãi suất áp dụng').fill('10'); await fld(m, 'Thời hạn vay').fill('36');
    await m.getByRole('button', { name: 'Lưu khoản nợ' }).click(); await p.waitForTimeout(100);
    const s1 = await st(p); const d = s1.debts[0];
    const unpaid = sum(d.schedule.filter(x => !x.isPaid).map(x => x.principalPayable));
    log(unpaid === d.remainingPrincipal, 'U13b', 'tổng gốc các kỳ chưa trả = dư nợ còn lại đã nhập', `dư nợ nhập ${fmt(d.remainingPrincipal)} nhưng lịch còn phải trả ${fmt(unpaid)} → lịch và số dư mâu thuẫn`);
    log(d.status === 'active' && s1.wallet.availableCash === s0.wallet.availableCash, 'U13c', 'thêm nợ độc lập không đụng ví', 'cash ' + s1.wallet.availableCash);
    await p.context().close(); }
  { // U13e: khoản vay cũ nhập với ngày giải ngân quá khứ
    const p = await fresh(); await nav(p, 'Khoản nợ & Lịch trả'); await p.getByRole('button', { name: 'Thêm khoản vay mới' }).click();
    const m = modal(p);
    await fld(m, 'Tên khoản vay').fill('Vay cũ'); await fld(m, 'Ngân hàng / Tổ chức').fill('MB');
    await fld(m, 'Số gốc vay ban đầu').fill('360000000'); await fld(m, 'Dư nợ gốc còn lại').fill('250000000');
    await fld(m, 'Ngày giải ngân').fill('2025-01-10'); await fld(m, 'Lãi suất áp dụng').fill('10'); await fld(m, 'Thời hạn vay').fill('36');
    await m.getByRole('button', { name: 'Lưu khoản nợ' }).click(); await p.waitForTimeout(100);
    const s1 = await st(p); const d = s1.debts[0]; const unpaid = sum(d.schedule.filter(x => !x.isPaid).map(x => x.principalPayable));
    const nx = d.schedule.find(x => !x.isPaid);
    log(d.remainingPrincipal === 250000000 && unpaid === 250000000 && nx.dueDate >= new Date().toISOString().slice(0,10).slice(0,8) + '01', 'U13e', 'vay cũ (giải ngân 01/2025, còn 250tr): kỳ quá khứ = đã trả, Σ gốc chưa trả = 250tr, kỳ kế tiếp ở tương lai', JSON.stringify({ rem: d.remainingPrincipal, unpaid, next: nx.dueDate }));
    await nav(p, 'Tổng quan Đầu tư'); const body = await p.locator('body').innerText();
    log(!/Đã quá hạn/.test(body), 'U13f', 'Dashboard không báo quá hạn sai', (body.match(/Đã quá hạn \d+ ngày/) || ['ok'])[0]);
    await p.context().close(); }
  { // U13g: giải ngân vào ví
    const p = await fresh(); const s0 = await st(p); await nav(p, 'Khoản nợ & Lịch trả'); await p.getByRole('button', { name: 'Thêm khoản vay mới' }).click();
    const m = modal(p);
    await fld(m, 'Tên khoản vay').fill('Vay tiêu dùng mới'); await fld(m, 'Ngân hàng / Tổ chức').fill('Sacombank');
    await fld(m, 'Số gốc vay ban đầu').fill('100000000'); await fld(m, 'Lãi suất áp dụng').fill('12'); await fld(m, 'Thời hạn vay').fill('12');
    await m.locator('label', { hasText: 'Tiền vay được giải ngân vào ví' }).locator('input').check();
    await m.getByRole('button', { name: 'Lưu khoản nợ' }).click(); await p.waitForTimeout(100);
    const s1 = await st(p);
    log(s1.wallet.availableCash === s0.wallet.availableCash + 1e8 && s1.transactions[0].type === 'loan_disbursement' && nw(s1) === nw(s0), 'U13g', 'vay tiền mặt: giải ngân vào ví +100tr, NW không đổi', JSON.stringify({ cashΔ: s1.wallet.availableCash - s0.wallet.availableCash, ΔNW: nw(s1) - nw(s0) }));
    await p.context().close(); }

  // ---------- U14 floating rate adjust
  { const p = await fresh(); const s0 = await st(p);
    await nav(p, 'Khoản nợ & Lịch trả'); await p.getByRole('button', { name: 'Cập nhật Lãi & Dư nợ' }).first().click(); await p.waitForTimeout(80);
    const m = modal(p); await fld(m, 'Lãi suất cơ sở').fill('7.5'); await fld(m, 'Biên độ').fill('3.7');
    await p.getByRole('button', { name: /Cập nhật & Tính lại/ }).click(); await p.waitForTimeout(120);
    const s1 = await st(p); const d = s1.debts.find(x => x.id === 'debt-vcb-home');
    log(Math.abs(d.annualInterestRate - 11.2) < 1e-9 && d.baseRate === 7.5 && d.floatingMargin === 3.7, 'U14a', 'đổi lãi thả nổi: lãi tổng = cơ sở + biên độ = 11,2%', JSON.stringify({ r: d.annualInterestRate, b: d.baseRate, m: d.floatingMargin }));
    const nx = d.schedule.find(x => !x.isPaid); 
    log(Math.abs(nx.interestPayable - Math.round(d.remainingPrincipal * 0.112 / 12)) <= 1, 'U14b', 'lãi kỳ kế tiếp tính lại theo 11,2%', `${fmt(nx.interestPayable)}`);
    log(Array.isArray(d.rateHistory), 'U14c', 'lưu lịch sử thay đổi lãi suất (đối chiếu sao kê ngân hàng)', 'không lưu; lãi cũ bị ghi đè');
    await p.context().close(); }

  // ---------- U15 persistence + corrupted storage
  { const p = await fresh(); await nav(p, 'Ví & Dòng tiền'); await p.getByRole('button', { name: 'Nạp tiền' }).click();
    await modal(p).locator('input[inputmode=numeric]').fill('12345678'); await p.getByRole('button', { name: 'Xác nhận Nạp Tiền' }).click();
    await p.reload(); await p.waitForTimeout(200); const s = await st(p);
    log(s.wallet.availableCash === 185000000 + 12345678, 'U15a', 'dữ liệu còn sau khi tải lại trang', 'cash ' + s.wallet.availableCash);
    await p.context().close(); }
  { const bad = '{"wallet":{"availableCash":999000000,"totalDeposited":1,"totalWithdrawn":0},"assets":[],"debts":[ BROKEN';
    const p = await fresh({ preset: bad });
    const kept = await p.evaluate((b) => Object.keys(localStorage).some(k => k.includes('_corrupt_') && localStorage.getItem(k) === b), bad);
    const alertTxt = await p.locator('[role=alert]').innerText().catch(() => '');
    log(kept && /bị hỏng/.test(alertTxt), 'U15b', 'dữ liệu hỏng: bản gốc được cất lại + banner cảnh báo hiện rõ', `kept=${kept} banner="${alertTxt.slice(0, 60)}"`);
    await p.context().close(); }
  { const old = JSON.stringify({ wallet: { availableCash: 5, totalDeposited: 5, totalWithdrawn: 0 }, assets: [], debts: [] });
    const p = await fresh({ preset: old }); const body = await p.locator('body').innerText();
    log(p.errs.length === 0 && body.length > 200, 'U15c', 'dữ liệu cũ thiếu trường "transactions" không làm trắng màn hình', p.errs[0] || 'ok');
    await p.context().close(); }

  // ---------- U16 data center
  { const p = await fresh(); const s0 = await st(p);
    await nav(p, 'Dữ liệu & Supabase SQL');
    const btns = (await p.locator('button').allInnerTexts()).map(s => s.trim()).filter(Boolean);
    console.log('   [DataCenter buttons]', JSON.stringify(btns));
    await p.locator('button', { hasText: /Nhập|Xuất/ }).first().click().catch(()=>{}); await p.waitForTimeout(80);
    console.log('   [DataCenter buttons after tab]', JSON.stringify((await p.locator('button').allInnerTexts()).map(s => s.trim()).filter(Boolean)));
    // JSON export
    const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('button', { hasText: /JSON/ }).first().click()]);
    const path = await dl.path(); const exported = JSON.parse(fs.readFileSync(path, 'utf8'));
    log(JSON.stringify(exported) === JSON.stringify(s0), 'U16a', 'xuất JSON đầy đủ = trạng thái hiện tại', 'khác');
    // Excel export (stub records)
    await p.locator('button', { hasText: /Excel \(\.xlsx\)|Xuất Excel|XLSX/i }).first().click().catch(()=>{});
    const calls = await p.evaluate(() => (globalThis.__xlsxCalls || []).map(c => ({ name: c.name, sheets: c.sheets, cols: c.sheets.map(n => Object.keys(c.wb.Sheets[n].__rows[0] || {})) })));
    if (calls.length) {
      const cols = calls[0].cols;
      log(calls[0].sheets.length >= 5, 'U16b', 'Excel đủ sheet để khôi phục (Tài sản, Nợ, Lịch trả nợ, Giao dịch, Ví)', `chỉ ${calls[0].sheets.length} sheet: ${calls[0].sheets.join(' | ')}; Sheet tài sản không có số lượng/mã CP/địa chỉ/diện tích/kỳ hạn (metadata); không có lịch trả nợ; không có số dư ví`);
    } else log(false, 'U16b', 'xuất Excel chạy được', 'không bắt được lệnh xuất (selector?)');
    // XLSX import
    await p.evaluate(() => { globalThis.__xlsxReadResult = { SheetNames: ['S'], Sheets: { S: { __rows: [{ a: 1 }, { a: 2 }, { a: 3 }] } } }; });
    await p.locator('input[type=file]').setInputFiles({ name: 'x.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK dummy') }); await p.waitForTimeout(150);
    const msg = (await p.locator('body').innerText()).match(/Đã (đọc|nhập)[^\n]*/);
    const s1 = await st(p);
    log(JSON.stringify(s1) === JSON.stringify(s0) && /CHƯA/.test(msg ? msg[0] : (await p.locator('body').innerText())), 'U16c', 'nhập Excel/CSV: thông báo trung thực (chưa hỗ trợ), không đổi dữ liệu', `msg="${msg ? msg[0] : '?'}"`);
    // JSON import - valid but missing fields
    const weird = { wallet: { availableCash: 1, totalDeposited: 1, totalWithdrawn: 0 }, assets: [], debts: [] };
    await p.locator('input[type=file]').setInputFiles({ name: 'weird.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(weird)) }); await p.waitForTimeout(200);
    const crashed = (await p.locator('body').innerText()).length < 50;
    log(!crashed && p.errs.length === 0, 'U16d', 'nhập JSON thiếu trường (transactions) không làm app sập', p.errs[0] || (crashed ? 'trắng trang' : 'ok'));
    await p.reload(); await p.waitForTimeout(200);
    log((await p.locator('body').innerText()).length > 200, 'U16e', 'tải lại sau khi nhập JSON thiếu trường vẫn dùng được', 'trắng trang sau reload');
    await p.context().close(); }

  // ---------- U17 demo banner / clear / undo
  { const p = await fresh();
    log(/DỮ LIỆU MẪU/.test(await p.locator('body').innerText()), 'U17a', 'lần đầu mở app: banner nói rõ đang xem dữ liệu mẫu', 'không có banner');
    await p.getByRole('button', { name: /Xóa dữ liệu mẫu & bắt đầu trống/ }).click(); await p.waitForTimeout(150);
    let s = await st(p);
    log(s.assets.length === 0 && s.debts.length === 0 && s.wallet.availableCash === 0 && s.isDemo === false, 'U17b', 'một cú bấm xóa dữ liệu mẫu → danh mục trống', JSON.stringify({ a: s.assets.length, d: s.debts.length }));
    log(/Bắt đầu với dữ liệu thật/.test(await p.locator('body').innerText()), 'U17c', 'màn hình trống có hướng dẫn bắt đầu', 'không có onboarding');
    await nav(p, 'Dữ liệu & Supabase SQL'); await p.locator('button', { hasText: /Nhập|Xuất/ }).first().click();
    await p.getByRole('button', { name: /Hoàn tác/ }).click(); await p.waitForTimeout(150); s = await st(p);
    log(s.assets.length === 6, 'U17d', 'hoàn tác khôi phục lại 6 tài sản mẫu', 'assets=' + s.assets.length);
    await p.locator('button', { hasText: /Xóa sạch & bắt đầu dữ liệu thật/ }).click(); await p.waitForTimeout(150); s = await st(p);
    log(s.assets.length === 0, 'U17e', 'nút "Xóa sạch" trong Trung tâm dữ liệu', 'assets=' + s.assets.length);
    await p.context().close(); }

  // ---------- U18 income + reconcile from empty
  { const p = await fresh(); await p.getByRole('button', { name: /Xóa dữ liệu mẫu & bắt đầu trống/ }).click(); await p.waitForTimeout(100);
    await nav(p, 'Ví & Dòng tiền'); await p.getByRole('button', { name: 'Nạp tiền' }).click();
    await modal(p).locator('input[inputmode=numeric]').fill('500000000'); await p.getByRole('button', { name: 'Xác nhận Nạp Tiền' }).click();
    await nav(p, 'Danh mục Tài sản'); await p.getByRole('button', { name: 'Thêm tài sản mới' }).click();
    let m = modal(p); await m.locator('button', { hasText: 'Cổ phiếu' }).first().click();
    await fld(m, 'Tên tài sản').fill('FPT thật'); await fld(m, 'Mã Cổ phiếu').fill('FPT'); await fld(m, 'Số lượng cổ phiếu').fill('1000'); await fld(m, 'Giá vốn (đ/CP)').fill('100000');
    await m.getByRole('button', { name: 'Lưu tài sản', exact: true }).click(); await p.waitForTimeout(100);
    await nav(p, 'Ví & Dòng tiền'); await p.getByRole('button', { name: /Ghi nhận thu nhập/ }).click();
    m = modal(p); await m.locator('select').first().selectOption('dividend'); await m.locator('select').nth(1).selectOption({ label: 'FPT thật' });
    await m.locator('input[inputmode=numeric]').fill('3000000'); await m.getByRole('button', { name: 'Xác nhận ghi nhận' }).click(); await p.waitForTimeout(100);
    const s = await st(p); const pos = ['deposit', 'sell_asset', 'dividend', 'rental_income', 'interest_income', 'loan_disbursement'];
    const flow = sum(s.transactions.map(t => pos.includes(t.type) ? t.amount : -t.amount));
    log(flow === s.wallet.availableCash && s.wallet.availableCash === 403000000, 'U18a', 'bắt đầu từ trống: Σ sổ cái = số dư ví (đối soát khớp)', `Σ=${fmt(flow)} ví=${fmt(s.wallet.availableCash)}`);
    log(s.assets[0].metadata.totalDividendsReceived === 3000000 && s.transactions[0].type === 'dividend', 'U18b', 'ghi cổ tức: cộng ví, cập nhật cổ tức tích lũy của mã', JSON.stringify(s.assets[0].metadata));
    await nav(p, 'Tổng quan Đầu tư'); const body = await p.locator('body').innerText();
    log(/Lãi chốt thực tế:\s*\+3 tr/.test(body), 'U18c', 'Dashboard: lãi chốt thực tế = +3tr (đếm đúng 1 lần)', (body.match(/Lãi chốt thực tế:[^\n]*/) || ['?'])[0]);
    await p.context().close(); }

  // ---------- U19 gold decimal chỉ
  { const p = await fresh(); await nav(p, 'Danh mục Tài sản'); await p.getByRole('button', { name: 'Thêm tài sản mới' }).click();
    const m = modal(p); await m.locator('button', { hasText: 'Vàng 9999' }).click();
    await fld(m, 'Tên tài sản').fill('Vàng nhẫn test'); await fld(m, 'Số chỉ').pressSequentially('2,5'); await fld(m, 'Giá vốn mỗi chỉ').fill('8000000');
    const tot = await fld(m, 'Tổng giá vốn đầu tư').inputValue();
    await m.getByRole('button', { name: 'Lưu tài sản', exact: true }).click(); await p.waitForTimeout(100);
    const a = (await st(p)).assets[0];
    log(a.metadata.quantityChi === 2.5, 'U19a', 'nhập được số chỉ vàng thập phân (2,5 chỉ)', 'quantityChi=' + a.metadata.quantityChi);
    log(a.initialCost === 20000000, 'U19b', 'tổng vốn = 2,5 × 8tr = 20tr', `cost=${a.initialCost} (ô tổng hiển thị "${tot}")`);
    await p.context().close(); }

  // ---------- U20 savings maturity panel
  { const p = await fresh(); const body = await p.locator('body').innerText();
    log(/Sổ tiết kiệm sắp đáo hạn/.test(body) && /còn 16 ngày/.test(body), 'U20', 'Dashboard cảnh báo sổ BIDV đáo hạn 01/11 (còn 16 ngày) kèm tiền gốc+lãi', (body.match(/Sổ tiết kiệm sắp đáo hạn[\s\S]{0,200}/) || ['không có'])[0].replace(/\n/g, ' | '));
    await p.context().close(); }

  // ---------- U21 date boundary (VN 02:00 sáng)
  { const ctx = await browser.newContext({ timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' }); const p = await ctx.newPage();
    await p.clock.setFixedTime(new Date('2026-10-16T02:00:00+07:00'));
    p.on('dialog', d => d.accept());
    await p.goto(URL); await p.waitForTimeout(250);
    await nav(p, 'Ví & Dòng tiền'); await p.getByRole('button', { name: 'Nạp tiền' }).click();
    await modal(p).locator('input[inputmode=numeric]').fill('1000000'); await p.getByRole('button', { name: 'Xác nhận Nạp Tiền' }).click();
    const s = await st(p);
    log(s.transactions[0].date === '2026-10-16', 'U21', 'giao dịch lúc 02:00 sáng 16/10 (giờ VN) ghi đúng ngày 2026-10-16', 'ghi ' + s.transactions[0].date);
    await ctx.close(); }

  await browser.close();
  console.log(`\n==== E2E: ${pass} pass / ${fail} fail ====`);
  
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
