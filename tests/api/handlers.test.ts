/**
 * Kiểm thử API với cơ sở dữ liệu giả trong bộ nhớ (không cần Neon).
 * Chạy:  npx tsx --test tests/api/handlers.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../api/_lib/app.js';
import { createMemoryStore } from '../../api/_lib/memory-store.js';
import type { ApiRequest, ApiResponse } from '../../api/_lib/http.js';

const ADMIN = 'chu.admin88@gmail.com';
const HOST = 'app.example.com';

function makeEnv(opts: { adminEmails?: string[]; clock?: { t: number } } = {}) {
  const clock = opts.clock ?? { t: Date.parse('2026-10-27T08:00:00Z') };
  const store = createMemoryStore(() => new Date(clock.t));
  const handler = createApp(store, { adminEmails: opts.adminEmails ?? [ADMIN], secureCookies: true, now: () => new Date(clock.t) });

  /** Mỗi "trình duyệt" có một túi cookie riêng. */
  function client() {
    let cookie = '';
    async function call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
      const headers: Record<string, string> = { host: HOST, origin: `https://${HOST}`, 'content-type': 'application/json', ...extraHeaders };
      if (cookie) headers.cookie = cookie;
      const req: ApiRequest = { method, url: path, headers, body };
      const out: { status: number; headers: Record<string, string | string[]>; body: any } = { status: 0, headers: {}, body: null };
      let raw = '';
      const res: ApiResponse = {
        statusCode: 200,
        setHeader(n, v) {
          out.headers[n.toLowerCase()] = v;
        },
        end(chunk) {
          raw = chunk ?? '';
        },
      };
      await handler(req, res);
      out.status = res.statusCode;
      out.body = raw ? JSON.parse(raw) : null;
      const sc = out.headers['set-cookie'];
      if (typeof sc === 'string') {
        const pair = sc.split(';')[0];
        cookie = /Max-Age=0/i.test(sc) ? '' : pair;
        out.headers['_cookie-set'] = sc;
      }
      return out;
    }
    return { call, get cookie() { return cookie; }, clearCookie: () => (cookie = '') };
  }
  return { store, client, clock };
}

const reg = (c: ReturnType<ReturnType<typeof makeEnv>['client']>, name: string, email: string, password = 'matkhau123') =>
  c.call('POST', '/api/auth/register', { displayName: name, email, password });
const login = (c: ReturnType<ReturnType<typeof makeEnv>['client']>, email: string, password = 'matkhau123', remember = true) =>
  c.call('POST', '/api/auth/login', { email, password, remember });

test('đăng ký bằng ADMIN_EMAIL → quản trị viên, tự đăng nhập, cookie HttpOnly/Secure/SameSite', async () => {
  const { client } = makeEnv();
  const c = client();
  const r = await reg(c, 'Chủ', ADMIN);
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'active');
  assert.equal(r.body.user.role, 'admin');
  const sc = String(r.headers['set-cookie']);
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /Secure/);
  assert.match(sc, /SameSite=Lax/);
  assert.match(sc, /Max-Age=2592000/);
  const me = await c.call('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, ADMIN);
});

test('không đặt ADMIN_EMAIL và chưa có admin → 503 có hướng dẫn', async () => {
  const { client } = makeEnv({ adminEmails: [] });
  const r = await reg(client(), 'A', 'nguoi.dung1@gmail.com');
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'not_configured');
});

test('người dùng thường: chờ duyệt, chưa có phiên, đăng nhập đúng mật khẩu → 403 pending', async () => {
  const { client } = makeEnv();
  const admin = client();
  await reg(admin, 'Chủ', ADMIN);
  const u = client();
  const r = await reg(u, 'Lan', 'lan.nguyen88@gmail.com');
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'pending');
  assert.equal(r.headers['set-cookie'], undefined);
  assert.equal((await u.call('GET', '/api/auth/me')).status, 401);
  const l = await login(u, 'lan.nguyen88@gmail.com');
  assert.equal(l.status, 403);
  assert.equal(l.body.code, 'pending');
  const wrong = await login(u, 'lan.nguyen88@gmail.com', 'saimatkhau1');
  assert.equal(wrong.status, 401); // không lộ trạng thái khi sai mật khẩu
  assert.equal(wrong.body.code, 'invalid_credentials');
});

test('admin duyệt → người dùng đăng nhập được (Gmail khác dấu chấm / hoa thường vẫn nhận)', async () => {
  const { client } = makeEnv();
  const admin = client();
  await reg(admin, 'Chủ', ADMIN);
  const u = client();
  await reg(u, 'Lan', 'lan.nguyen88@gmail.com');
  const list = await admin.call('GET', '/api/admin/accounts');
  const lan = list.body.accounts.find((a: any) => a.email === 'lan.nguyen88@gmail.com');
  assert.equal(lan.status, 'pending');
  assert.equal((await admin.call('POST', `/api/admin/accounts/${lan.id}/approve`, {})).status, 200);
  for (const typed of ['lan.nguyen88@gmail.com', 'LANNGUYEN88@Gmail.com', ' lan.nguyen88@gmail.com ']) {
    const l = await login(client(), typed);
    assert.equal(l.status, 200, typed);
  }
});

test('đăng ký trùng Gmail (khác dấu chấm) bị chặn; đuôi khác @gmail.com bị chặn; mật khẩu yếu bị chặn', async () => {
  const { client } = makeEnv();
  const c = client();
  await reg(c, 'Chủ', ADMIN);
  assert.equal((await reg(client(), 'X', 'chuadmin88@gmail.com')).status, 409);
  assert.equal((await reg(client(), 'X', 'nguoi.dung1@yahoo.com')).status, 400);
  assert.equal((await reg(client(), 'X', 'nguoi.dung1@gmail.com', 'ngan')).status, 400);
  assert.equal((await reg(client(), '', 'nguoi.dung1@gmail.com')).status, 400);
});

test('đăng nhập sai 5 lần → khóa tạm 15 phút, hết hạn thì thử lại được', async () => {
  const { client, clock } = makeEnv();
  const c = client();
  await reg(c, 'Chủ', ADMIN);
  const attacker = client();
  for (let i = 0; i < 5; i++) assert.equal((await login(attacker, ADMIN, 'saimatkhau' + i)).status, 401);
  const locked = await login(attacker, ADMIN, 'matkhau123'); // đúng mật khẩu nhưng đang bị khóa
  assert.equal(locked.status, 429);
  assert.equal(locked.body.code, 'throttled');
  clock.t += 16 * 60_000;
  assert.equal((await login(attacker, ADMIN, 'matkhau123')).status, 200);
});

test('đăng xuất → phiên vô hiệu; cookie bị xóa', async () => {
  const { client } = makeEnv();
  const c = client();
  await reg(c, 'Chủ', ADMIN);
  const token = c.cookie;
  assert.equal((await c.call('POST', '/api/auth/logout', {})).status, 200);
  const replay = client();
  const r = await replay.call('GET', '/api/auth/me', undefined, { cookie: token });
  assert.equal(r.status, 401); // dùng lại cookie cũ không được
});

test('phiên hết hạn theo thời gian (không ghi nhớ = 24 giờ)', async () => {
  const { client, clock } = makeEnv();
  const admin = client();
  await reg(admin, 'Chủ', ADMIN);
  const u = client();
  await reg(u, 'Lan', 'lan.nguyen88@gmail.com');
  const lan = (await admin.call('GET', '/api/admin/accounts')).body.accounts.find((a: any) => a.email.startsWith('lan'));
  await admin.call('POST', `/api/admin/accounts/${lan.id}/approve`, {});
  const l = await login(u, 'lan.nguyen88@gmail.com', 'matkhau123', false);
  assert.doesNotMatch(String(l.headers['set-cookie']), /Max-Age/); // cookie phiên
  assert.equal((await u.call('GET', '/api/auth/me')).status, 200);
  clock.t += 25 * 3_600_000;
  assert.equal((await u.call('GET', '/api/auth/me')).status, 401);
});

test('quyền: người dùng thường không vào được API quản trị; chưa đăng nhập → 401', async () => {
  const { client } = makeEnv();
  const admin = client();
  await reg(admin, 'Chủ', ADMIN);
  const u = client();
  await reg(u, 'Lan', 'lan.nguyen88@gmail.com');
  const lan = (await admin.call('GET', '/api/admin/accounts')).body.accounts.find((a: any) => a.email.startsWith('lan'));
  await admin.call('POST', `/api/admin/accounts/${lan.id}/approve`, {});
  await login(u, 'lan.nguyen88@gmail.com');
  assert.equal((await u.call('GET', '/api/admin/accounts')).status, 403);
  assert.equal((await u.call('POST', `/api/admin/accounts/${lan.id}/lock`, {})).status, 403);
  assert.equal((await client().call('GET', '/api/admin/accounts')).status, 401);
  assert.equal((await client().call('GET', '/api/portfolio')).status, 401);
});

test('danh sách quản trị không lộ mật khẩu / băm', async () => {
  const { client } = makeEnv();
  const admin = client();
  await reg(admin, 'Chủ', ADMIN);
  const raw = JSON.stringify((await admin.call('GET', '/api/admin/accounts')).body);
  assert.doesNotMatch(raw, /scrypt\$/);
  assert.doesNotMatch(raw, /passwordHash|password_hash|resetRequestHash/);
});

test('quên mật khẩu → admin duyệt mới có hiệu lực; admin không tự duyệt yêu cầu của mình', async () => {
  const { client } = makeEnv();
  const admin = client();
  await reg(admin, 'Chủ', ADMIN);
  const u = client();
  await reg(u, 'Lan', 'lan.nguyen88@gmail.com');
  const lanId = (await admin.call('GET', '/api/admin/accounts')).body.accounts.find((a: any) => a.email.startsWith('lan')).id;
  await admin.call('POST', `/api/admin/accounts/${lanId}/approve`, {});
  assert.equal((await login(client(), 'lan.nguyen88@gmail.com')).status, 200);

  const f = await client().call('POST', '/api/auth/forgot', { email: 'lan.nguyen88@gmail.com', password: 'matkhaumoi99' });
  assert.equal(f.status, 200);
  // chưa duyệt: mật khẩu cũ còn dùng, mật khẩu mới chưa
  assert.equal((await login(client(), 'lan.nguyen88@gmail.com', 'matkhau123')).status, 200);
  assert.equal((await login(client(), 'lan.nguyen88@gmail.com', 'matkhaumoi99')).status, 401);
  const acc = (await admin.call('GET', '/api/admin/accounts')).body.accounts.find((a: any) => a.id === lanId);
  assert.equal(acc.hasResetRequest, true);

  assert.equal((await admin.call('POST', `/api/admin/accounts/${lanId}/reset-approve`, {})).status, 200);
  assert.equal((await login(client(), 'lan.nguyen88@gmail.com', 'matkhaumoi99')).status, 200);
  assert.equal((await login(client(), 'lan.nguyen88@gmail.com', 'matkhau123')).status, 401);

  // admin gửi yêu cầu cho chính mình → không tự duyệt được
  await client().call('POST', '/api/auth/forgot', { email: ADMIN, password: 'adminmoi123' });
  const me = (await admin.call('GET', '/api/auth/me')).body.user;
  assert.equal((await admin.call('POST', `/api/admin/accounts/${me.id}/reset-approve`, {})).status, 400);
});

test('quên mật khẩu với Gmail không tồn tại vẫn trả 200 giống nhau (không lộ tài khoản)', async () => {
  const { client } = makeEnv();
  await reg(client(), 'Chủ', ADMIN);
  const r = await client().call('POST', '/api/auth/forgot', { email: 'khong.co.that@gmail.com', password: 'matkhaumoi99' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
});

test('khóa tài khoản → mất phiên ngay; mở khóa → đăng nhập lại; admin không tự khóa; xóa dọn dữ liệu', async () => {
  const { client, store } = makeEnv();
  const admin = client();
  await reg(admin, 'Chủ', ADMIN);
  const u = client();
  await reg(u, 'Lan', 'lan.nguyen88@gmail.com');
  const lanId = (await admin.call('GET', '/api/admin/accounts')).body.accounts.find((a: any) => a.email.startsWith('lan')).id;
  await admin.call('POST', `/api/admin/accounts/${lanId}/approve`, {});
  await login(u, 'lan.nguyen88@gmail.com');
  await u.call('PUT', '/api/portfolio', { baseVersion: 0, data: { wallet: {}, assets: [], debts: [], transactions: [] } });

  assert.equal((await admin.call('POST', `/api/admin/accounts/${lanId}/lock`, {})).status, 200);
  assert.equal((await u.call('GET', '/api/auth/me')).status, 401); // phiên cũ mất hiệu lực ngay
  const l = await login(client(), 'lan.nguyen88@gmail.com');
  assert.equal(l.status, 403);
  assert.equal(l.body.code, 'locked');

  const meId = (await admin.call('GET', '/api/auth/me')).body.user.id;
  assert.equal((await admin.call('POST', `/api/admin/accounts/${meId}/lock`, {})).status, 400);
  assert.equal((await admin.call('POST', `/api/admin/accounts/${meId}/delete`, {})).status, 400);
  assert.equal((await admin.call('POST', `/api/admin/accounts/${lanId}/promote`, {})).status, 400); // chỉ đổi quyền cho tài khoản đang hoạt động

  assert.equal((await admin.call('POST', `/api/admin/accounts/${lanId}/approve`, {})).status, 200); // mở khóa
  assert.equal((await login(client(), 'lan.nguyen88@gmail.com')).status, 200);

  await admin.call('POST', `/api/admin/accounts/${lanId}/lock`, {});
  assert.equal((await admin.call('POST', `/api/admin/accounts/${lanId}/delete`, {})).status, 200);
  const dump: any = (store as any)._dump();
  assert.equal(dump.users.length, 1);
  assert.equal(dump.portfolios.length, 0); // dữ liệu tài chính bị xóa kèm
});

test('xóa: chỉ xóa được tài khoản đã khóa / từ chối', async () => {
  const { client } = makeEnv();
  const admin = client();
  await reg(admin, 'Chủ', ADMIN);
  await reg(client(), 'Lan', 'lan.nguyen88@gmail.com');
  const lanId = (await admin.call('GET', '/api/admin/accounts')).body.accounts.find((a: any) => a.email.startsWith('lan')).id;
  assert.equal((await admin.call('POST', `/api/admin/accounts/${lanId}/delete`, {})).status, 400); // đang chờ duyệt
  assert.equal((await admin.call('POST', `/api/admin/accounts/${lanId}/reject`, {})).status, 200);
  assert.equal((await admin.call('POST', `/api/admin/accounts/${lanId}/delete`, {})).status, 200);
  assert.equal((await admin.call('POST', `/api/admin/accounts/khong-phai-uuid/approve`, {})).status, 404);
});

test('cấp / bỏ quyền quản trị cho tài khoản đang hoạt động', async () => {
  const { client } = makeEnv();
  const admin = client();
  await reg(admin, 'Chủ', ADMIN);
  const u = client();
  await reg(u, 'Lan', 'lan.nguyen88@gmail.com');
  const lanId = (await admin.call('GET', '/api/admin/accounts')).body.accounts.find((a: any) => a.email.startsWith('lan')).id;
  await admin.call('POST', `/api/admin/accounts/${lanId}/approve`, {});
  await login(u, 'lan.nguyen88@gmail.com');
  assert.equal((await admin.call('POST', `/api/admin/accounts/${lanId}/promote`, {})).status, 200);
  assert.equal((await u.call('GET', '/api/admin/accounts')).status, 200);
  assert.equal((await admin.call('POST', `/api/admin/accounts/${lanId}/demote`, {})).status, 200);
  assert.equal((await u.call('GET', '/api/admin/accounts')).status, 403);
});

test('đổi mật khẩu: sai mật khẩu hiện tại bị chặn; thành công thì các thiết bị khác bị đăng xuất, thiết bị này giữ phiên', async () => {
  const { client } = makeEnv();
  const a1 = client();
  await reg(a1, 'Chủ', ADMIN);
  const a2 = client();
  assert.equal((await login(a2, ADMIN)).status, 200);
  assert.equal((await a1.call('POST', '/api/auth/password', { current: 'sai-roi-nhe', next: 'matkhaumoi99' })).status, 400);
  assert.equal((await a1.call('POST', '/api/auth/password', { current: 'matkhau123', next: 'matkhaumoi99' })).status, 200);
  assert.equal((await a1.call('GET', '/api/auth/me')).status, 200);
  assert.equal((await a2.call('GET', '/api/auth/me')).status, 401);
  assert.equal((await login(client(), ADMIN, 'matkhau123')).status, 401);
  assert.equal((await login(client(), ADMIN, 'matkhaumoi99')).status, 200);
});

test('đổi tên hiển thị + kiểm tra đầu vào', async () => {
  const { client } = makeEnv();
  const c = client();
  await reg(c, 'Chủ', ADMIN);
  const r = await c.call('PATCH', '/api/auth/profile', { displayName: '  Minh Thắng ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.displayName, 'Minh Thắng');
  assert.equal((await c.call('PATCH', '/api/auth/profile', { displayName: '' })).status, 400);
  assert.equal((await c.call('GET', '/api/auth/me')).body.user.displayName, 'Minh Thắng');
});

test('dữ liệu danh mục: tạo mới, cập nhật, phát hiện ghi đè chéo thiết bị (409), tách biệt theo người dùng', async () => {
  const { client } = makeEnv();
  const admin = client();
  await reg(admin, 'Chủ', ADMIN);
  const shape = (n: number) => ({ wallet: { availableCash: n }, assets: [], debts: [], transactions: [] });

  assert.deepEqual((await admin.call('GET', '/api/portfolio')).body, { data: null, version: 0 });
  const first = await admin.call('PUT', '/api/portfolio', { baseVersion: 0, data: shape(1) });
  assert.equal(first.status, 200);
  assert.equal(first.body.version, 1);
  const second = await admin.call('PUT', '/api/portfolio', { baseVersion: 1, data: shape(2) });
  assert.equal(second.body.version, 2);

  // thiết bị thứ hai (đã đăng nhập từ trước) ghi với phiên bản cũ → 409
  const stale = await admin.call('PUT', '/api/portfolio', { baseVersion: 1, data: shape(99) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'conflict');
  assert.equal(stale.body.version, 2);
  const again = await admin.call('PUT', '/api/portfolio', { baseVersion: 0, data: shape(99) });
  assert.equal(again.status, 409); // đã có dữ liệu nên không được "tạo mới" đè lên

  const got = (await admin.call('GET', '/api/portfolio')).body;
  assert.equal(got.version, 2);
  assert.equal(got.data.wallet.availableCash, 2);

  // người dùng khác không thấy dữ liệu của admin
  const u = client();
  await reg(u, 'Lan', 'lan.nguyen88@gmail.com');
  const lanId = (await admin.call('GET', '/api/admin/accounts')).body.accounts.find((a: any) => a.email.startsWith('lan')).id;
  await admin.call('POST', `/api/admin/accounts/${lanId}/approve`, {});
  await login(u, 'lan.nguyen88@gmail.com');
  assert.deepEqual((await u.call('GET', '/api/portfolio')).body, { data: null, version: 0 });
});

test('dữ liệu danh mục: từ chối cấu trúc sai, baseVersion sai, quá lớn', async () => {
  const { client } = makeEnv();
  const c = client();
  await reg(c, 'Chủ', ADMIN);
  const ok = { wallet: {}, assets: [], debts: [], transactions: [] };
  assert.equal((await c.call('PUT', '/api/portfolio', { baseVersion: 0, data: { assets: [] } })).status, 400);
  assert.equal((await c.call('PUT', '/api/portfolio', { baseVersion: -1, data: ok })).status, 400);
  assert.equal((await c.call('PUT', '/api/portfolio', { baseVersion: '0', data: ok })).status, 400);
  assert.equal((await c.call('PUT', '/api/portfolio', { baseVersion: 1.5, data: ok })).status, 400);
  const big = { ...ok, transactions: [{ pad: 'x'.repeat(3_100_000) }] };
  assert.equal((await c.call('PUT', '/api/portfolio', { baseVersion: 0, data: big })).status, 413);
});

test('chống CSRF: khác Origin bị từ chối; thiếu content-type JSON bị từ chối; GET không bị ảnh hưởng', async () => {
  const { client } = makeEnv();
  const c = client();
  await reg(c, 'Chủ', ADMIN);
  const evil = await c.call('POST', '/api/auth/logout', {}, { origin: 'https://evil.example.net' });
  assert.equal(evil.status, 403);
  assert.equal(evil.body.code, 'bad_origin');
  const form = await c.call('POST', '/api/auth/logout', {}, { 'content-type': 'text/plain' });
  assert.equal(form.status, 415);
  assert.equal((await c.call('GET', '/api/auth/me')).status, 200);
  const viaProxy = await c.call('POST', '/api/auth/logout', {}, { 'x-forwarded-host': HOST, host: 'internal.vercel.local' });
  assert.equal(viaProxy.status, 200);
});

test('đường dẫn lạ → 404; health OK; lỗi cấu hình → 503 (không lộ chi tiết lỗi khác)', async () => {
  const { client } = makeEnv();
  const c = client();
  assert.equal((await c.call('GET', '/api/health')).status, 200);
  assert.equal((await c.call('GET', '/api/khong-co')).status, 404);
  assert.equal((await c.call('GET', '/api/health/')).status, 200); // dấu / cuối

  const boom = createApp(
    { ...createMemoryStore(), async findSession() { throw new Error('chi tiết nội bộ: mật khẩu DB là hunter2'); } },
    { adminEmails: [ADMIN], secureCookies: true }
  );
  let status = 0, raw = '';
  await boom(
    { method: 'GET', url: '/api/auth/me', headers: { cookie: 'fintrack_session=abc' } },
    { statusCode: 200, setHeader() {}, end(ch) { raw = ch ?? ''; } } as any
  ).then(() => undefined);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.code, 'server_error');
  assert.doesNotMatch(raw, /hunter2/);
  void status;

  const cfg = createApp(
    { ...createMemoryStore(), async findSession() { const e = new Error('Thiếu DATABASE_URL'); e.name = 'ConfigError'; throw e; } },
    { adminEmails: [ADMIN], secureCookies: true }
  );
  let code = 0;
  await cfg({ method: 'GET', url: '/api/auth/me', headers: { cookie: 'fintrack_session=abc' } }, { get statusCode() { return code; }, set statusCode(v: number) { code = v; }, setHeader() {}, end() {} } as any);
  assert.equal(code, 503);
});

test('mã phiên không lưu dạng gốc trong cơ sở dữ liệu; mật khẩu lưu dạng scrypt', async () => {
  const { client, store } = makeEnv();
  const c = client();
  await reg(c, 'Chủ', ADMIN);
  const token = decodeURIComponent(c.cookie.split('=')[1]);
  const dump: any = (store as any)._dump();
  assert.ok(!dump.sessions.includes(token));
  assert.equal(dump.sessions[0].length, 64); // sha256 hex
  assert.match(dump.users[0].passwordHash, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!JSON.stringify(dump).includes('matkhau123'));
});
