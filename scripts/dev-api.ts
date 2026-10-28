/**
 * Chạy API ở máy bạn (cổng 3001) nối thẳng vào Neon, để dùng cùng `npm run dev` (Vite, cổng 3000).
 *
 *   npx tsx --env-file=.env.local scripts/dev-api.ts
 *
 * Cần .env.local có DATABASE_URL và ADMIN_EMAIL (xem .env.example).
 * Vite phải chuyển tiếp /api sang đây: thêm vào vite.config.ts →  server: { proxy: { '/api': 'http://localhost:3001' } }
 * (KHÔNG đặt changeOrigin: true, vì máy chủ so sánh Origin với Host để chống CSRF).
 */
import http from 'node:http';
import { createApp } from '../api/_lib/app.js';
import { createNeonStore } from '../api/_lib/neon-store.js';

const app = createApp(createNeonStore(), {
  adminEmails: (process.env.ADMIN_EMAIL ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  secureCookies: false, // chạy http://localhost nên không đặt cờ Secure
});

const PORT = Number(process.env.API_PORT ?? 3001);

http
  .createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        (req as any).body = raw ? JSON.parse(raw) : undefined;
      } catch {
        (req as any).body = undefined;
      }
      void app(req as any, res as any);
    });
  })
  .listen(PORT, () => console.log(`API chạy tại http://localhost:${PORT}  (ADMIN_EMAIL=${process.env.ADMIN_EMAIL ?? '(chưa đặt)'})`));
