# FinTrack VN — Quản lý tài sản & nợ

Ứng dụng web theo dõi tài sản, khoản vay (nợ đòn bẩy), lịch trả nợ và dòng tiền đầu tư cho người dùng Việt Nam.
Mỗi người có tài khoản riêng; dữ liệu lưu trên máy chủ nên dùng được ở nhiều thiết bị.

## Tính năng chính

- **Tài sản:** bất động sản, cổ phiếu, chứng chỉ quỹ, vàng, tiết kiệm/trái phiếu, tài sản khác (crypto, xe…); mua/bán, định giá, thu nhập cho thuê.
- **Khoản vay:** lịch trả nợ theo lãi suất từng giai đoạn, trả kỳ, trả trước hạn, tất toán, đối chiếu sao kê, gắn với tài sản thế chấp.
- **Ví tiền:** nạp/rút, sổ cái giao dịch; ví không bao giờ âm ngầm.
- **Cập nhật giá:** tab riêng cho mọi tài sản: giá đóng cửa cổ phiếu tự động sau phiên 15h (vnstock + GitHub Actions), nhập tay, hoặc import CSV; lãi/lỗ sổ sách tính ngay (xem `docs/PRICES.md`).
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
| `scripts` | `dev-api.ts` (API chạy ở máy), `hash-password.mjs`, `fetch_prices.py` (lấy giá bằng vnstock) |
| `tests` | Test logic, API và giao diện (xem `tests/README.md`) |
| `docs` | `DEPLOY.md` (triển khai GitHub → Neon → Vercel), `PRICES.md` (giá thị trường tự động) |
| `.github/workflows` | `close-prices.yml` — lịch lấy giá đóng cửa |

## Chạy ở máy

Cần Node 20 trở lên.

1. `npm install`
2. Sao chép `.env.example` thành `.env.local`, điền `DATABASE_URL` (chuỗi kết nối Neon) và `ADMIN_EMAIL` (Gmail quản trị). **Không** đưa `.env.local` lên GitHub (đã bị `.gitignore` chặn).
3. Mở hai cửa sổ dòng lệnh:
   - `npm run dev:api` — API, cổng 3001
   - `npm run dev` — giao diện, cổng 3000

Chi tiết về Neon và Vercel: `docs/DEPLOY.md`.

## Cài như ứng dụng (PWA)

Ứng dụng cài được lên màn hình chính điện thoại / máy tính, cùng cách làm với Nhật Ký Giao Dịch:

- **Android, Chrome/Edge máy tính:** bấm nút **Cài đặt ứng dụng (PWA)** ở cuối thanh bên (trên điện thoại: tab **Khác → Ứng dụng**), hoặc nút cài trên thanh địa chỉ.
- **iPhone/iPad:** mở bằng Safari → Chia sẻ → **Thêm vào MH chính**. Nút **Hướng dẫn cài iPhone PWA** (thanh bên, hoặc tab **Khác → Ứng dụng** trên điện thoại) mở sẵn các bước này.

Các file liên quan: `public/manifest.webmanifest`, `public/sw.js` (service worker), biểu tượng `public/pwa-*.png` và `public/apple-touch-icon.png`, đăng ký trong `src/utils/pwa.ts`, nút cài trong `src/components/InstallAppButton.tsx`.
Service worker **không bao giờ lưu `/api/*`** (số liệu tài chính luôn lấy từ máy chủ); chỉ lưu khung trang, JS/CSS và biểu tượng để mở nhanh và mở được khi mất mạng (dữ liệu thì cần mạng). Chỉ đăng ký ở bản build (`npm run build`), không đăng ký khi `npm run dev`. Sửa `public/sw.js` thì đổi `VERSION` ở đầu file để máy người dùng bỏ cache cũ. Kiểm thử: `node tests/pwa.cjs`.

### Giao diện khi mở như ứng dụng

Khi mở từ biểu tượng đã cài, hoặc khi màn hình hẹp (**dưới 1024px**: điện thoại, máy tính bảng dọc — kể cả mở bằng trình duyệt thường), hoặc thêm `?pwa=1` vào địa chỉ để xem thử ngay trên máy tính, ứng dụng dùng vỏ `src/components/pwa/PwaAppShell.tsx`: thanh đầu gọn, thanh tab đáy (Tổng quan · Tài sản · Khoản nợ · Ví · Khác), hộp thoại hiện như tấm trượt từ đáy màn hình. Các màn hình Tài sản, Khoản nợ, Ví, Lịch thu chi, Báo cáo, Cập nhật giá được **sắp xếp lại cho điện thoại** (thẻ thay cho bảng, bộ lọc dạng chip, số liệu gom gọn; các bảng nhiều cột như lịch trả nợ chỉ hiện vài thông tin trên mỗi dòng, **bấm vào dòng mở panel đầy đủ**) nhưng dùng **chung dữ liệu, hàm xử lý và hộp thoại** với bản web. Thêm `?web=1` vào địa chỉ để ép dùng giao diện web (có sidebar và bảng) ngay cả trên màn hình hẹp — hữu ích khi so sánh hoặc kiểm thử.

- Cách làm: mỗi màn hình nhận thêm tham số `layout?: 'web' | 'pwa'` (mặc định `'web'` = giao diện cũ, không đổi). Khối giao diện riêng cho app nằm trong `src/components/pwa/` (`pwaUi.tsx` là bộ thành phần dùng chung).
- CSS riêng cho app nằm ở cuối `src/index.css`, chỉ có tác dụng khi `<html>` có thuộc tính `data-pwa-app` (do vỏ app bật), nên không ảnh hưởng bản web.
- Thêm/sửa chức năng ở một màn hình: sửa phần logic trong file màn hình như bình thường; nếu có thêm nút hay thông tin mới thì thêm cả vào khối giao diện app tương ứng.
- Kiểm thử bố cục app (điện thoại 390px, Chromium): `node tests/pwa-views.cjs`; kiểm thử vỏ app và service worker: `node tests/pwa-app.cjs`.

## Xuống dòng (line endings)

Repo dùng LF cho mọi file (`.gitattributes`: `* text=auto eol=lf`), kể cả trên Windows. Nếu `git apply` báo lỗi vì CRLF, chạy một lần `git add --renormalize .` rồi commit (xem hướng dẫn kèm patch giai đoạn 0).

## Kiểm thử

`npm run lint` (kiểm kiểu), `npm run build`, và `npm run test:logic`, `test:phase1` … `test:phase5`, `test:loans`, `test:api`, `test:prices-ui`.
Khoản vay chỉ có một mức lãi tại một thời điểm; hết ưu đãi thì bấm **Đổi lãi suất** (test: `npm run test:loans`).
