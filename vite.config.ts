import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': rootDir,
      },
    },
    server: {
      // Chuyển tiếp /api sang API chạy ở máy (npm run dev:api, cổng 3001).
      // Máy chủ so Origin với Host (hoặc X-Forwarded-Host) để chống CSRF, nhưng proxy của Vite đổi Host
      // thành localhost:3001 → phải báo lại host gốc (localhost:3000) qua X-Forwarded-Host, nếu không POST đăng nhập/đăng ký bị 403.
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              if (req.headers.host) proxyReq.setHeader('x-forwarded-host', req.headers.host);
            });
          },
        },
      },
      // Đặt DISABLE_HMR=true để tắt HMR và theo dõi file (dùng khi cần ổn định giao diện).
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
