# FinTrack VN — Rà soát, sửa lỗi & kế hoạch (v1.3 → v1.4)

Phương pháp: đọc toàn bộ mã nguồn (~6.000 dòng) → viết test mô tả **hành vi đúng ngoài thực tế** → chạy trên bản cũ (lộ lỗi) → sửa → chạy lại.
Test: `tests/run-all.sh` (logic ×3 múi giờ + 70 kịch bản giao diện trên Chromium thật).

## 1. Lỗi thật đã phát hiện & đã sửa

| # | Mức | Vấn đề (bản cũ) | Đã sửa |
|---|-----|------------------|--------|
| 1 | Nghiêm trọng | Mua tài sản 3 tỷ khi ví chỉ có 185tr: ví về 0, sổ cái ghi 3 tỷ, **tài sản ròng tự tăng +2,8 tỷ** | Chặn + báo thiếu bao nhiêu; ví không bao giờ âm ngầm |
| 2 | Nghiêm trọng | Trả nợ khi ví thiếu tiền: ví chỉ mất 1tr nhưng sổ cái ghi 10,3tr | Chặn + báo thiếu tiền |
| 3 | Nghiêm trọng | Dữ liệu localStorage hỏng bị **ghi đè bằng dữ liệu mẫu** ngay khi mở app | Cất bản gốc sang khóa `*_corrupt_*` + banner cảnh báo |
| 4 | Nghiêm trọng | Nhập JSON thiếu `transactions` (hoặc dữ liệu cũ) → **trắng màn hình, và lưu luôn nên reload vẫn trắng** | `normalizeState()` điền mặc định, lọc rác; có hoàn tác |
| 5 | Nghiêm trọng | Nhập khoản vay cũ: không có ô ngày giải ngân; lịch bắt đầu từ hôm nay; lịch ≠ dư nợ nhập. Mua tài sản có vay với ngày quá khứ → Dashboard báo "quá hạn 549 ngày" | Thêm ngày giải ngân + ân hạn; kỳ quá khứ = đã trả; căn lịch theo dư nợ thực (Σ gốc chưa trả = dư nợ) |
| 6 | Cao | Ngày vay 29–31 bị ép về 28; vay ngày 31/01 → kỳ 1 và kỳ 2 **trùng ngày** 15/03 (lỗi `setMonth`) | `dueDateFor()` — đúng ngày, tháng ngắn lấy ngày cuối tháng |
| 7 | Cao | `toISOString()` → trước 7h sáng giờ VN, mọi giao dịch ghi lùi 1 ngày | `todayLocalStr()` theo giờ địa phương |
| 8 | Cao | Demo: kỳ chưa đến hạn (18/10) bị đánh dấu "đã trả"; dư nợ lưu ≠ lịch (xe: 265tr vs 209tr) | `normalizeDebt()` |
| 9 | Cao | Bảng lịch trả nợ không cập nhật sau khi bấm Thanh toán (giữ dữ liệu cũ) | Modal đọc theo id từ state |
| 10 | Cao | Cho trả nhảy kỳ (#100 trước #1) | Chỉ kỳ kế tiếp có nút; handler cũng chặn |
| 11 | Cao | Cổ tức đếm trùng (asset.realizedPnL + sổ cái) | Một nguồn sự thật: lãi bán (tài sản) + thu nhập (sổ cái) |
| 12 | Cao | Trả nợ chỉ 1 click là trừ ví, không xác nhận | Hộp xác nhận (gốc/lãi/tổng) |
| 13 | Trung bình | Header "Thêm tài sản / Thêm khoản nợ / Nạp-Rút ví" chỉ đổi tab, phải bấm lần 2 | Mở thẳng form |
| 14 | Trung bình | Định giá lại chỉ đổi tổng; giá/CP, NAV, giá/chỉ vẫn cũ | Đồng bộ metadata + lưu lịch sử định giá |
| 15 | Trung bình | Số chỉ vàng / số CCQ chỉ nhập được số nguyên (không có 2,5 chỉ); vàng & quỹ không tự tính tổng vốn | Ô thập phân (dấu phẩy VN) + tự tính SL × đơn giá |
| 16 | Trung bình | Import Excel/CSV báo "thành công" nhưng **không nhập gì** | Thông báo trung thực; JSON là đường khôi phục |
| 17 | Trung bình | Excel export mất dữ liệu (không lịch trả nợ, không metadata, không ví); % lãi NaN khi vốn = 0; CSV không escape tên | Excel 6 sheet; CSV an toàn + chặn CSV-injection |
| 18 | Trung bình | Bán tài sản đang thế chấp: nợ vẫn "active", Dashboard hiện LTV 0% | Cảnh báo trước khi bán; Dashboard bỏ tài sản đã bán |
| 19 | Trung bình | "Nghĩa vụ nợ tháng này" cộng cả kỳ tháng sau | Chỉ quá hạn + trong tháng; thêm "30 ngày tới" & ví đủ/thiếu |
| 20 | Thấp | ID `tx-${Date.now()}` có thể trùng khi thao tác nhanh | `uid()` |
| 21 | Thấp | SQL schema thiếu loại giao dịch/cột mới | Cập nhật SQL + bảng `net_worth_snapshots` |

## 2. Chức năng thực tế đã bổ sung
- **Bán một phần** (CP/CCQ/vàng) theo số lượng, giá vốn tính theo tỷ lệ; **phí môi giới + thuế** (nút điền thuế TNCN 0,1%).
- **Ghi nhận thu nhập**: cổ tức, tiền thuê, lãi tiền gửi (trước đây có trong demo nhưng *không có chỗ nhập*).
- **Sổ tiết kiệm đáo hạn**: cảnh báo 45 ngày, lãi tạm tính, tiền gốc+lãi nhận về.
- **Vay giải ngân vào ví** (vay tiền mặt) – loại giao dịch `loan_disbursement`.
- **Ân hạn gốc**, **lịch sử đổi lãi suất thả nổi**, tách **gốc/lãi** trong từng giao dịch trả nợ (tính được tổng lãi đã trả).
- **Diễn biến tài sản ròng** (snapshot theo ngày, biểu đồ SVG).
- **Dữ liệu mẫu có banner**, nút "Xóa & bắt đầu trống", **hoàn tác** sau nhập/đặt lại/xóa sạch, màn hình trống có hướng dẫn.

## 3. Còn thiếu so với thực tế — kế hoạch (chưa làm)

**Giai đoạn 1 – độ chính xác tài chính (ưu tiên cao)**
1. Lãi suất ưu đãi → thả nổi (`preferentialMonths` đã có trong model nhưng chưa tác động lịch; test A9 đang đỏ có chủ đích).
2. Trả nợ trước hạn: chọn *giảm tiền mỗi kỳ* hoặc *rút ngắn kỳ hạn* + phí tất toán sớm (1–3%).
3. Khoản trả thực tế khác lịch (trả dư/thiếu, ngày trả thực) và sửa/xóa/hoàn tác từng giao dịch (hiện sổ cái chỉ thêm, chưa sửa được).
4. Tự tất toán nợ khi bán tài sản thế chấp (hiện chỉ cảnh báo).
5. Lãi tiết kiệm: tái tục tự động theo `rolloverOption`, lãi kép; trái phiếu có coupon.
6. Tách thuế/phí khi mua; giá vốn bình quân khi mua thêm cùng mã (hiện mỗi lần mua là 1 tài sản mới).

**Giai đoạn 2 – dữ liệu & an toàn**
7. Nhập Excel/CSV thật (theo đúng 6 sheet đã xuất) — cần `xlsx` thật để test.
8. Đồng bộ Supabase thật (đăng nhập + ánh xạ id chuỗi → UUID); hiện chỉ có file SQL.
9. Sao lưu định kỳ (nhắc xuất JSON hàng tuần), IndexedDB thay localStorage (giới hạn ~5MB), đồng bộ nhiều tab.
10. Thay `xlsx@0.18.5` (có lỗ hổng đã công bố, không còn cập nhật trên npm) bằng bản SheetJS chính thức / thư viện khác trước khi nhập file lạ.
11. Dọn phụ thuộc không dùng: `@google/genai`, `express`, `dotenv`, `motion`, `esbuild`, `autoprefixer`; đổi README (còn là mẫu AI Studio).

**Giai đoạn 3 – hoàn thiện sản phẩm**
12. Giá thị trường: cập nhật CP/quỹ/vàng từ nguồn dữ liệu (hiện nhập tay); nhắc "chưa định giá > 30 ngày".
13. Chỉ số: tỷ suất cho thuê, DSCR (thu nhập/nghĩa vụ nợ), thu nhập ròng sau lãi vay, XIRR theo dòng tiền.
14. Giao diện di động: Sidebar luôn rộng 256px/80px, không có menu dạng ngăn kéo/bottom-nav (đã đọc mã, **chưa kiểm tra bằng mắt** – xem mục 4).
15. Mục tiêu tài chính, quỹ khẩn cấp (số tháng chi phí), bảo hiểm, thuế TNCN — nếu muốn mở rộng ngoài đầu tư.

## 4. Giới hạn của lần kiểm thử này (nói thẳng)
- Môi trường không có mạng → **không `npm install` được**. Tôi dựng bản test bằng esbuild + Chromium, thay `lucide-react` bằng icon giả và `xlsx` bằng bản ghi lệnh. Logic, luồng thao tác, lưu trữ đã test thật; **giao diện Tailwind (màu, bố cục, responsive) chưa xem được**, và **Excel thật (đọc/ghi file .xlsx) chưa chạy**.
- `tsc` chỉ kiểm được lớp logic (calculations, storage, types, App) bằng khai báo giả; JSX của các view chưa được kiểm kiểu. Hãy chạy `npm run lint` + `npm run build` trên máy có mạng.
- Test E2E chạy múi giờ Asia/Ho_Chi_Minh; logic chạy thêm UTC và Los Angeles.
- Số liệu tài chính là **mô hình tính toán** (lãi đơn tiết kiệm 365 ngày, lịch vay theo ngày trả cố định); ngân hàng có thể làm tròn/tính ngày khác — luôn đối chiếu sao kê.
