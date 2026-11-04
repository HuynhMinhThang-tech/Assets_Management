# FinTrack VN — Quản lý tài sản & nợ

Ứng dụng web theo dõi tài sản, khoản vay (nợ đòn bẩy), lịch trả nợ và dòng tiền đầu tư cho người dùng Việt Nam.
Mỗi người có tài khoản riêng; dữ liệu lưu trên máy chủ nên dùng được ở nhiều thiết bị.

## Tính năng chính

- **Tài sản:** bất động sản, cổ phiếu, chứng chỉ quỹ, vàng, tiết kiệm/trái phiếu, tài sản khác (crypto, xe…); mua/bán, định giá, thu nhập cho thuê.
- **Khoản vay:** lịch trả nợ theo lãi suất từng giai đoạn, trả kỳ, trả trước hạn, tất toán, đối chiếu sao kê, gắn với tài sản thế chấp.
- **Ví tiền:** nạp/rút, sổ cái giao dịch; ví không bao giờ âm ngầm.
- **Báo cáo:** bảng cân đối tài sản, lưu chuyển tiền, kết quả đầu tư, phân bổ tài sản, lịch dòng tiền.
- **Tài khoản:** đăng ký bằng Gmail, quản trị viên phê duyệt; tải bản sao lưu JSON trong mục *Tài khoản của tôi*.

## Công nghệ

React 19 · Vite · Tailwind CSS 4 · TypeScript · API serverless trên Vercel (`api/index.ts`) · PostgreSQL trên Neon.

## Cấu trúc thư mục

| Thư mục | Nội dung |
|---|---|
| `src/components` | Các màn hình (Dashboard, Tài sản, Nợ, Ví, Lịch, Báo cáo, Quản trị, Đăng nhập) |
| `src/utils` | Lõi tính toán và thao tác ghi sổ (hàm thuần), lưu trữ, đồng bộ, gọi API |
| `src/types` | Kiểu dữ liệu tài chính |
| `api` | API `/api/*` (một hàm duy nhất, `vercel.json` rewrite vào đó) |
| `db` | `schema.sql` cho Neon |
| `scripts` | `dev-api.ts` (API chạy ở máy), `hash-password.mjs` |
| `tests` | Test logic, API và giao diện (xem `tests/README.md`) |
| `docs` | `DEPLOY.md` — hướng dẫn triển khai GitHub → Neon → Vercel |

## Chạy ở máy

Cần Node 20 trở lên.

1. `npm install`
2. Tạo `.env.local` với `DATABASE_URL` (chuỗi kết nối Neon) và `ADMIN_EMAIL` (Gmail quản trị). Không đưa file này lên GitHub.
3. Mở hai cửa sổ dòng lệnh:
   - `npm run dev:api` — API, cổng 3001
   - `npm run dev` — giao diện, cổng 3000

Chi tiết về Neon và Vercel: `docs/DEPLOY.md`.

## Kiểm thử

`npm run lint` (kiểm kiểu), `npm run build`, và `npm run test:logic`, `test:phase1` … `test:phase4`.
Ca A9 (lãi ưu đãi chuyển sang thả nổi) đỏ có chủ đích: đó là việc còn thiếu, xem `REVIEW.md`.
