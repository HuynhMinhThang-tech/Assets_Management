/**
 * Kiểm thử GET /api/prices (giá thị trường dùng chung) với cơ sở dữ liệu giả trong bộ nhớ.
 * Chạy:  npx tsx --test tests/api/prices.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../api/_lib/app.js';
import { createMemoryStore } from '../../api/_lib/memory-store.js';
import type { ApiRequest, ApiResponse } from '../../api/_lib/http.js';

const ADMIN = 'chu.admin88@gmail.com';
const HOST = 'app.example.com';

function makeEnv() {
  const clock = { t: Date.parse('2026-11-05T08:00:00Z') };
  const store = createMemoryStore(() => new Date(clock.t));
  const handler = createApp(store, { adminEmails: [ADMIN], secureCookies: true, now: () => new Date(clock.t) });
  function client() {
    let cookie = '';
    async function call(method: string, path: string, body?: unknown) {
      const headers: Record<string, string> = { host: HOST, origin: `https://${HOST}`, 'content-type': 'application/json' };
      if (cookie) headers.cookie = cookie;
      const req: ApiRequest = { method, url: path, headers, body };
      const out: { status: number; body: any } = { status: 0, body: null };
      let raw = '';
      let sc = '';
      const res: ApiResponse = {
        statusCode: 200,
        setHeader(n, v) { if (n.toLowerCase() === 'set-cookie') sc = String(v); },
        end(chunk) { raw = chunk ?? ''; },
      };
      await handler(req, res);
      out.status = res.statusCode;
      out.body = raw ? JSON.parse(raw) : null;
      if (sc) cookie = /Max-Age=0/i.test(sc) ? '' : sc.split(';')[0];
      return out;
    }
    return { call };
  }
  return { store, client };
}

async function loggedIn() {
  const env = makeEnv();
  const c = env.client();
  const r = await c.call('POST', '/api/auth/register', { displayName: 'Chủ', email: ADMIN, password: 'matkhau123' });
  assert.equal(r.status, 201);
  return { ...env, c };
}

const seed = (store: ReturnType<typeof makeEnv>['store']) =>
  store._seedPrices([
    { kind: 'stock', symbol: 'FPT', date: '2026-11-02', close: 123000, source: 'vnstock:KBS', fetchedAt: '2026-11-02T08:10:00.000Z' },
    { kind: 'stock', symbol: 'FPT', date: '2026-11-03', close: 125000, source: 'vnstock:KBS', fetchedAt: '2026-11-03T08:10:00.000Z' },
    { kind: 'stock', symbol: 'FPT', date: '2026-10-30', close: 120000, source: 'vnstock:KBS', fetchedAt: '2026-10-30T08:10:00.000Z' },
    { kind: 'stock', symbol: 'HPG', date: '2026-11-03', close: 27500, source: 'vnstock:KBS', fetchedAt: '2026-11-03T08:11:00.000Z' },
    { kind: 'fund', symbol: 'DCDS', date: '2026-11-03', close: 31234.57, source: 'fmarket', fetchedAt: '2026-11-03T08:12:00.000Z' },
  ]);

test('giá thị trường: chưa đăng nhập → 401', async () => {
  const env = makeEnv();
  const r = await env.client().call('GET', '/api/prices?kind=stock&symbols=FPT');
  assert.equal(r.status, 401);
});

test('giá thị trường: trả giá mới nhất + giá phiên liền trước, chỉ các mã được hỏi', async () => {
  const { c, store } = await loggedIn();
  seed(store);
  const r = await c.call('GET', '/api/prices?kind=stock&symbols=FPT,hpg,ZZZ');
  assert.equal(r.status, 200);
  assert.equal(r.body.prices.length, 2);
  const fpt = r.body.prices.find((p: any) => p.symbol === 'FPT');
  assert.deepEqual(
    { date: fpt.date, close: fpt.close, prevDate: fpt.prevDate, prevClose: fpt.prevClose, kind: fpt.kind, source: fpt.source },
    { date: '2026-11-03', close: 125000, prevDate: '2026-11-02', prevClose: 123000, kind: 'stock', source: 'vnstock:KBS' }
  );
  const hpg = r.body.prices.find((p: any) => p.symbol === 'HPG');
  assert.equal(hpg.close, 27500);
  assert.equal(hpg.prevClose, null);
  assert.equal(hpg.prevDate, null);
});

test('giá thị trường: tách theo loại (cổ phiếu ≠ quỹ); mặc định kind = stock', async () => {
  const { c, store } = await loggedIn();
  seed(store);
  const fund = await c.call('GET', '/api/prices?kind=fund&symbols=DCDS');
  assert.equal(fund.body.prices[0].close, 31234.57);
  const wrongKind = await c.call('GET', '/api/prices?kind=stock&symbols=DCDS');
  assert.deepEqual(wrongKind.body.prices, []);
  const def = await c.call('GET', '/api/prices?symbols=FPT');
  assert.equal(def.body.prices[0].symbol, 'FPT');
});

test('giá thị trường: tham số sai → 400 (loại lạ, mã có ký tự lạ, quá 200 mã); không có mã → danh sách rỗng', async () => {
  const { c } = await loggedIn();
  assert.equal((await c.call('GET', '/api/prices?kind=crypto&symbols=BTC')).status, 400);
  assert.equal((await c.call('GET', '/api/prices?kind=stock&symbols=FPT;drop')).status, 400);
  assert.equal((await c.call('GET', '/api/prices?kind=stock&symbols=' + Array.from({ length: 201 }, (_, i) => 'A' + i).join(','))).status, 400);
  const empty = await c.call('GET', '/api/prices?kind=stock');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.prices, []);
});

test('giá thị trường: chạy lại script cùng ngày chỉ ghi đè, không nhân đôi', async () => {
  const { c, store } = await loggedIn();
  seed(store);
  store._seedPrices([{ kind: 'stock', symbol: 'FPT', date: '2026-11-03', close: 125500, source: 'vnstock:KBS', fetchedAt: '2026-11-03T09:10:00.000Z' }]);
  const r = await c.call('GET', '/api/prices?kind=stock&symbols=FPT');
  assert.equal(r.body.prices[0].close, 125500);
  assert.equal(r.body.prices[0].prevClose, 123000);
});
