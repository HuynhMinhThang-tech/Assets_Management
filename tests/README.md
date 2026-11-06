# Tests
- `logic.test.ts` – engine tài chính + lưu trữ (chạy `npm run test:logic`, hoặc `TZ=... npx tsx tests/logic.test.ts`).
- `e2e.cjs` – 70 kịch bản giao diện trên Chromium (Playwright). Cần bundle: `bash tests/run-all.sh` (offline: dùng stub icon).
- Trên máy có mạng, nên chuyển e2e sang `@playwright/test` chạy trên `vite preview` để kiểm cả Tailwind/responsive.
- `phase1…phase5.test.ts` – các giai đoạn nghiệp vụ; `phase5` = tab Cập nhật giá (dòng giá, gợi ý, áp hàng loạt, import CSV).
- `api/*.test.ts` – API với cơ sở dữ liệu giả trong bộ nhớ (`npm run test:api`), gồm `prices.test.ts` cho GET /api/prices.
- `prices-ui.cjs` – giao diện tab Cập nhật giá trên Chromium với giá thị trường giả (`npm run test:prices-ui`; cần playwright + esbuild + stub lucide từ `tests/gen-stubs.sh`).
- Ca A9 (lãi ưu đãi) đỏ có chủ đích = việc còn thiếu trong REVIEW.md.
