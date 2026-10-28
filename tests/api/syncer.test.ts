/** Chạy: npx tsx --test tests/api/syncer.test.ts */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PortfolioSyncer, type SyncStatus } from '../../src/utils/syncer.js';

const st = (cash: number): any => ({ wallet: { availableCash: cash }, assets: [], debts: [], transactions: [] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function harness(over: Partial<ConstructorParameters<typeof PortfolioSyncer>[0]> = {}, version = 0, saved: string | null = null) {
  const calls: { cash: number; base: number; keepalive?: boolean }[] = [];
  const statuses: SyncStatus[] = [];
  const replaced: any[] = [];
  let serverVersion = version;
  const syncer = new PortfolioSyncer(
    {
      delayMs: 15,
      retryMs: 25,
      save: async (d, base, opts) => {
        calls.push({ cash: d.wallet.availableCash, base, keepalive: opts?.keepalive });
        serverVersion = base + 1;
        return { version: serverVersion };
      },
      loadServer: async () => ({ data: st(777), version: 9 }),
      onConflict: async () => 'use_server',
      onReplace: (s, v) => replaced.push([s, v]),
      onStatus: (s) => statuses.push(s),
      ...over,
    },
    version,
    saved
  );
  return { syncer, calls, statuses, replaced };
}

test('gom nhiều thay đổi nhanh thành một lần lưu, đúng phiên bản', async () => {
  const h = harness();
  h.syncer.start();
  h.syncer.update(st(1));
  h.syncer.update(st(2));
  h.syncer.update(st(3));
  await sleep(60);
  assert.deepEqual(h.calls, [{ cash: 3, base: 0, keepalive: undefined }]);
  assert.deepEqual(h.statuses, ['saving', 'saved']);
  h.syncer.stop();
});

test('không lưu lại khi dữ liệu y hệt bản đã lưu (vừa tải từ máy chủ)', async () => {
  const h = harness({}, 4, JSON.stringify(st(5)));
  h.syncer.start();
  h.syncer.update(st(5));
  await sleep(50);
  assert.equal(h.calls.length, 0);
  h.syncer.update(st(6));
  await sleep(50);
  assert.deepEqual(h.calls.map((c) => [c.cash, c.base]), [[6, 4]]);
  h.syncer.stop();
});

test('chỉnh sửa trong lúc đang lưu → lưu tiếp ngay sau đó, không mất thay đổi', async () => {
  let release!: () => void;
  let first = true;
  const calls: number[] = [];
  const h = harness({
    save: async (d, base) => {
      calls.push(d.wallet.availableCash);
      if (first) {
        first = false;
        await new Promise<void>((r) => (release = r));
      }
      return { version: base + 1 };
    },
  });
  h.syncer.start();
  h.syncer.update(st(1));
  await sleep(40); // đang treo ở lần lưu đầu
  h.syncer.update(st(2));
  await sleep(40);
  assert.deepEqual(calls, [1]); // không gửi chồng yêu cầu
  release();
  await sleep(80);
  assert.deepEqual(calls, [1, 2]);
  h.syncer.stop();
});

test('mất mạng → báo lỗi rồi tự thử lại tới khi lưu được', async () => {
  let n = 0;
  const h = harness({
    save: async (_d, base) => {
      n++;
      if (n < 3) throw Object.assign(new Error('mạng'), { status: 0 });
      return { version: base + 1 };
    },
  });
  h.syncer.start();
  h.syncer.update(st(1));
  await sleep(200);
  assert.equal(n, 3);
  assert.deepEqual(h.statuses, ['saving', 'error', 'saving', 'error', 'saving', 'saved']);
  h.syncer.stop();
});

test('xung đột + chọn dùng bản máy chủ → thay state, không ghi đè', async () => {
  const h = harness({
    save: async () => {
      throw Object.assign(new Error('conflict'), { status: 409, data: { version: 9 } });
    },
  });
  h.syncer.start();
  h.syncer.update(st(1));
  await sleep(80);
  assert.equal(h.replaced.length, 1);
  assert.equal(h.replaced[0][0].wallet.availableCash, 777);
  assert.equal(h.replaced[0][1], 9);
  // sau khi thay bằng bản máy chủ, cập nhật cùng nội dung không kích hoạt lưu
  h.syncer.update(st(777));
  await sleep(50);
  h.syncer.stop();
});

test('xung đột + chọn ghi đè → lưu lại với phiên bản mới của máy chủ', async () => {
  const calls: number[] = [];
  let first = true;
  const h = harness({
    onConflict: async () => 'overwrite',
    save: async (_d, base) => {
      calls.push(base);
      if (first) {
        first = false;
        throw Object.assign(new Error('conflict'), { status: 409, data: { version: 7 } });
      }
      return { version: base + 1 };
    },
  });
  h.syncer.start();
  h.syncer.update(st(1));
  await sleep(120);
  assert.deepEqual(calls, [0, 7]);
  h.syncer.stop();
});

test('hết phiên (401) → gọi onUnauthorized và không thử lại liên tục', async () => {
  let unauthorized = 0;
  let n = 0;
  const h = harness({
    save: async () => {
      n++;
      throw Object.assign(new Error('401'), { status: 401 });
    },
    onUnauthorized: () => unauthorized++,
  });
  h.syncer.start();
  h.syncer.update(st(1));
  await sleep(150);
  assert.equal(unauthorized, 1);
  assert.equal(n, 1);
  h.syncer.stop();
});

test('rời trang: lưu ngay bằng keepalive nếu nhỏ; dừng thì không gửi gì', async () => {
  const h = harness();
  h.syncer.start();
  h.syncer.update(st(1));
  h.syncer.flushOnLeave();
  await sleep(30);
  assert.deepEqual(h.calls.map((c) => c.keepalive), [true]);
  h.syncer.stop();
  h.syncer.update(st(2));
  h.syncer.flushOnLeave();
  await sleep(50);
  assert.equal(h.calls.length, 1);
});
