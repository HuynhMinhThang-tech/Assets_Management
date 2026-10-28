import { createApp } from './_lib/app.js';
import { createNeonStore } from './_lib/neon-store.js';

/**
 * Điểm vào duy nhất của API (một hàm serverless cho mọi đường dẫn /api/...).
 * Biến môi trường (đặt trên Vercel):
 *   DATABASE_URL  – chuỗi kết nối Neon (bắt buộc)
 *   ADMIN_EMAIL   – Gmail của quản trị viên, nhiều Gmail cách nhau bằng dấu phẩy (bắt buộc cho lần triển khai đầu)
 */
const app = createApp(createNeonStore(), {
  adminEmails: (process.env.ADMIN_EMAIL ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  secureCookies: process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
});

export default app;
