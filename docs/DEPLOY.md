# Triển khai: GitHub → Neon (cơ sở dữ liệu) → Vercel (chạy web)

Kiến trúc: giao diện React (Vite) + API `/api/*` chạy trên Vercel (một hàm duy nhất `api/[...path].ts`) + PostgreSQL trên Neon.
Tài khoản, phê duyệt, phiên đăng nhập và dữ liệu tài chính đều nằm trên máy chủ, nên nhiều người ở nhiều thiết bị dùng chung được.

---

## 0. Việc cần làm TRƯỚC khi áp bản cập nhật này

1. Trong app hiện tại (tab **Dữ liệu**) bấm **Tải bản sao lưu JSON** để có một bản dự phòng. Bản này xóa tab Dữ liệu.
2. Dữ liệu thật của bạn đang nằm trong trình duyệt ở địa chỉ `localhost:3000`. Trình duyệt tách dữ liệu theo địa chỉ,
   nên trang trên Vercel (`xxx.vercel.app`) **không thấy** dữ liệu này. Cách chuyển dữ liệu lên Neon ở **bước 5**.

## 1. Áp bản cập nhật vào dự án

- Giải nén gói vào thư mục gốc dự án, chọn **gộp / ghi đè** (đừng thay cả thư mục).
- **Xóa tay 2 file không còn dùng:** `src/components/DataCenterView.tsx` và `src/utils/supabaseSchema.ts`.
- Cài thư viện kết nối Neon: `npm install @neondatabase/serverless`
- Cần Node 20 trở lên (Vercel dùng sẵn).
- Nếu `npm run lint` hoặc `tsc` báo thiếu kiểu của Node (lỗi ở thư mục `api/`): `npm install -D @types/node`.
- Mở `.gitignore` (tạo nếu chưa có), bảo đảm có các dòng:
  ```
  node_modules
  dist
  .vercel
  .env
  .env.*
  !.env.example
  *.log
  ```
- Chạy `npm run build` một lần cho chắc build vẫn qua.

## 2. Neon: tạo cơ sở dữ liệu

1. Đăng ký tại neon.com → **Create project** (chọn vùng gần nhất, ví dụ Singapore).
2. Vào **SQL Editor**, dán toàn bộ nội dung `db/schema.sql`, bấm **Run**. Sẽ có 3 bảng: `users`, `sessions`, `portfolios`.
3. **Connect → Connection string**, chọn **Pooled connection**, sao chép chuỗi `postgresql://...?sslmode=require`.
   Chuỗi này là bí mật: không dán vào code, không đưa lên GitHub.

## 3. GitHub: đưa mã nguồn lên

1. Tạo repository mới trên github.com (nên chọn **Private**), không tick "Add README".
2. Trong thư mục dự án:
   ```bash
   git init
   git add .
   git status          # kiểm tra KHÔNG thấy .env, node_modules, dist
   git commit -m "Quản lý tài sản và nợ: đăng nhập, Neon, Vercel"
   git branch -M main
   git remote add origin https://github.com/<tài-khoản>/<tên-repo>.git
   git push -u origin main
   ```
3. Nếu thư mục đã là repo git sẵn thì bỏ `git init` và `git remote add`, chỉ `add / commit / push`.

## 4. Vercel: chạy web

1. vercel.com → **Add New → Project** → chọn repo GitHub vừa đẩy (cấp quyền cho Vercel nếu được hỏi).
2. Framework tự nhận **Vite**. Giữ nguyên Build Command (`npm run build`) và Output (`dist`); file `vercel.json` đã khai báo sẵn.
3. Mở **Environment Variables**, thêm:
   | Tên | Giá trị |
   |---|---|
   | `DATABASE_URL` | chuỗi kết nối Neon ở bước 2 |
   | `ADMIN_EMAIL` | Gmail của bạn, ví dụ `ban@gmail.com` (nhiều Gmail cách nhau bằng dấu phẩy) |
   (Hoặc dùng tích hợp Neon trong Vercel Marketplace: nó tự đặt `DATABASE_URL`; bạn vẫn phải tự thêm `ADMIN_EMAIL`.)
4. Bấm **Deploy**. Sau mỗi lần `git push` lên `main`, Vercel tự triển khai lại.
5. Kiểm tra: mở `https://<tên-dự-án>.vercel.app/api/health` phải thấy `{"ok":true}`.

## 5. Lần đầu sử dụng

1. **Đăng ký ngay** bằng đúng Gmail đã đặt ở `ADMIN_EMAIL`. Gmail đó tự thành quản trị viên và vào thẳng app.
   Làm việc này ngay sau khi triển khai: ai biết Gmail đó mà đăng ký trước bạn thì sẽ thành quản trị viên.
2. **Chuyển dữ liệu cũ lên Neon:** chạy app ở máy bạn, trong CÙNG trình duyệt đang giữ dữ liệu cũ (xem mục 6),
   đăng ký/đăng nhập bằng Gmail admin tại `http://localhost:3000`. App sẽ hỏi
   **"Tìm thấy dữ liệu đã nhập trước đây"** → bấm **Nhập dữ liệu**. Từ đó dữ liệu nằm trên Neon,
   và đăng nhập bằng cùng Gmail trên trang Vercel sẽ thấy dữ liệu đó.
3. Người khác tự đăng ký trên trang web → vào **Quản trị** (sidebar) → tab **Chờ duyệt** → **Duyệt**.

## 6. Chạy thử ở máy (kèm Neon)

1. Sao chép `.env.example` thành `.env.local`, điền `DATABASE_URL` và `ADMIN_EMAIL`.
2. Trong `vite.config.ts` thêm chuyển tiếp API (không đặt `changeOrigin`):
   ```ts
   server: { port: 3000, proxy: { '/api': 'http://localhost:3001' } }
   ```
3. Mở hai cửa sổ dòng lệnh:
   ```bash
   npx tsx --env-file=.env.local scripts/dev-api.ts   # API, cổng 3001
   npm run dev                                         # giao diện, cổng 3000
   ```
   (Cách khác: `npx vercel dev` chạy cả hai cùng lúc, cần `vercel link` và `vercel env pull .env.local`.)

## 7. Vận hành

- **Quên mật khẩu admin duy nhất:** tạo chuỗi băm rồi cập nhật trong Neon SQL Editor.
  ```bash
  node scripts/hash-password.mjs "MatKhauMoi123"
  ```
  ```sql
  update users set password_hash = '<chuỗi vừa in ra>', failed_logins = 0, locked_until = null
  where email_canonical = 'tenban@gmail.com';   -- Gmail viết thường, bỏ dấu chấm
  ```
- **Thêm quản trị viên:** thêm Gmail vào `ADMIN_EMAIL` (rồi Redeploy), hoặc trong trang Quản trị bấm "Cấp quyền quản trị" cho người đã được duyệt.
- **Sao lưu / khôi phục:** Neon có khôi phục về thời điểm trước đó (Restore) và nhánh (Branch). Hãy thử bấm một lần để biết cách dùng trước khi cần.
- **Xem dữ liệu:** Neon → Tables, hoặc SQL Editor: `select email, role, status from users;`
- **Đổi lãi/đáo hạn… sửa dữ liệu của ai đó bằng SQL:** dữ liệu tài chính nằm ở cột JSONB `portfolios.data`. Nếu sửa tay, nhớ tăng cột `version` để các thiết bị đang mở biết là có thay đổi.

## 8. Bảo mật: những điều cần biết

- Mật khẩu băm bằng scrypt; mã phiên lưu dạng băm; cookie HttpOnly + Secure + SameSite=Lax; có chặn yêu cầu khác nguồn (CSRF).
- Đăng nhập sai 5 lần thì khóa tài khoản đó 15 phút.
- **Chưa xác minh Gmail:** hệ thống kiểm tra đúng định dạng `@gmail.com` nhưng không gửi thư xác nhận, nên người ta vẫn đăng ký được bằng Gmail của người khác.
  Việc duyệt thủ công của quản trị viên là lớp chặn; chỉ duyệt người bạn nhận ra. Tương tự, khi duyệt "đặt lại mật khẩu", hãy chắc chính chủ yêu cầu.
- Dữ liệu tài chính được Neon mã hóa khi lưu, nhưng người có quyền vào cơ sở dữ liệu (bạn, với tư cách chủ dự án) đọc được. Không chia sẻ `DATABASE_URL`.

## 9. Gặp lỗi

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| Màn hình "Không kết nối được máy chủ" khi chạy ở máy | Chưa chạy `scripts/dev-api.ts` hoặc chưa thêm `proxy` vào `vite.config.ts` |
| Báo thiếu `DATABASE_URL` (mã 503) | Chưa đặt biến môi trường trên Vercel / trong `.env.local`; sau khi thêm biến phải **Redeploy** |
| "Hệ thống chưa có quản trị viên" | Chưa đặt `ADMIN_EMAIL` |
| `/api/health` trả 404 trên Vercel | File `api/[...path].ts` chưa được commit (tên có dấu ngoặc vuông) |
| Build báo lỗi "Cannot find module '../utils/supabaseSchema'" | Còn file/đoạn import cũ trỏ tới `DataCenterView` hoặc `supabaseSchema` |
| Hộp thoại "Dữ liệu đã thay đổi ở nơi khác" | Cùng tài khoản đang mở ở hai nơi. Chọn "Tải bản máy chủ" để lấy bản mới nhất |

## Kiểm thử

Máy chủ và bộ đồng bộ có kiểm thử chạy không cần Neon (dùng cơ sở dữ liệu giả trong bộ nhớ):
```bash
npx tsx --test tests/api/handlers.test.ts tests/api/syncer.test.ts
```
