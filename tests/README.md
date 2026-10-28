# Tests
- `logic.test.ts` – engine tài chính + lưu trữ (chạy `npm run test:logic`, hoặc `TZ=... npx tsx tests/logic.test.ts`).
- `e2e.cjs` – 70 kịch bản giao diện trên Chromium (Playwright). Cần bundle: `bash tests/run-all.sh` (offline: dùng stub icon/xlsx).
- Trên máy có mạng, nên chuyển e2e sang `@playwright/test` chạy trên `vite preview` để kiểm cả Tailwind/responsive.
- Ca A9 (lãi ưu đãi) đỏ có chủ đích = việc còn thiếu trong REVIEW.md.
