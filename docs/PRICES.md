# Giá thị trường tự động (tab "Cập nhật giá")

## Luồng hoạt động

```
GitHub Actions (15:05 và 16:05 giờ VN, thứ 2–6)
   └─ scripts/fetch_prices.py  ── vnstock (nguồn KBS) ──▶ giá đóng cửa
        └─ ghi vào bảng market_prices (Neon)
             └─ API  GET /api/prices  ──▶ tab "Cập nhật giá" hiển thị giá + nút "Áp dụng"
                                              └─ người dùng bấm → giá mới vào danh mục (có lịch sử định giá)
```

- Máy chủ chỉ lưu **giá thị trường dùng chung**. Nó **không tự sửa danh mục** của ai: người dùng bấm "Áp dụng" thì app mới ghi giá, nên không gây xung đột phiên bản dữ liệu.
- Script chỉ lấy các mã **cổ phiếu đang nắm giữ** của mọi tài khoản. Quỹ và vàng đã có chỗ trong bảng và API nhưng chưa có script lấy; hiện nhập tay hoặc import CSV.

## Cài đặt (một lần)

1. **Tạo bảng:** mở Neon → SQL Editor → chạy lại `db/schema.sql` (an toàn khi chạy lại; chỉ thêm bảng `market_prices`).
2. **Khai báo bí mật trên GitHub:** repo → Settings → Secrets and variables → Actions → New repository secret:
   - `DATABASE_URL`: chuỗi kết nối Neon (cùng chuỗi đang dùng trên Vercel).
   - `VNSTOCK_API_KEY` *(tùy chọn)*: khóa miễn phí của vnstock, nâng hạn mức từ 20 lên 60 lượt gọi/phút. Không bắt buộc nếu bạn chỉ có vài chục mã.
3. **Chạy thăm dò (Bước 0):** repo → Actions → "Lấy giá đóng cửa (vnstock)" → Run workflow → `mode = probe`, `symbols = FPT,HPG,VCB` (hoặc mã bạn đang giữ). Chế độ này **không ghi cơ sở dữ liệu**. Đọc log để kiểm tra:
   - Có lấy được dữ liệu không, hay bị chặn/lỗi kết nối (nguồn có thể chặn IP máy chủ cloud).
   - Tên các cột và đơn vị giá: dòng `gốc=… → VND = …`. Nhiều nguồn trả giá theo **nghìn đồng** (25,5 = 25.500 đ).
   - Thời gian mỗi mã (để biết có kịp hạn mức không).
4. **Chạy thật:** Run workflow → `mode = fetch`. Log in từng mã và giá đóng cửa. Sau đó mở app → tab "Cập nhật giá" → "Làm mới".
5. Từ đó lịch tự chạy mỗi ngày giao dịch (cron `5 8 * * 1-5` và `5 9 * * 1-5` theo UTC = 15:05 và 16:05 giờ VN). Chạy hai lần là để dự phòng; ghi đè cùng ngày nên vô hại.

## Tùy chỉnh (biến môi trường của script)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `VNSTOCK_SOURCE` | `KBS` | Nguồn dữ liệu của vnstock. Khi tìm hiểu, nguồn VCI được cho là không chạy trên Google Cloud; chưa rõ trên GitHub Actions, hãy thử bằng probe. |
| `VNSTOCK_PRICE_SCALE` | `auto` | `auto`: giá gốc nhỏ hơn 500 thì nhân 1.000 (coi là nghìn đồng). `1`: giữ nguyên. `1000`: luôn nhân 1.000. Nếu bạn giữ cổ phiếu giá dưới 500 đ, hãy đặt `1` hoặc `1000` rõ ràng sau khi xem kết quả probe. |

Thêm vào bước chạy trong `.github/workflows/close-prices.yml`, ví dụ:

```yaml
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          VNSTOCK_PRICE_SCALE: '1000'
```

## Dùng trong app

- **Áp dụng giá tự động:** mỗi dòng cổ phiếu có giá đóng cửa, ngày giá và biến động trong phiên. "Áp dụng giá tự động (n)" áp tất cả giá bình thường cùng lúc (có hộp xác nhận hiện tổng thay đổi).
- **Giá lệch bất thường (hơn 20% so với giá đang ghi):** không nằm trong "Áp dụng tất cả"; phải bấm riêng từng dòng và xác nhận. Thường do chia tách, thưởng cổ phiếu hoặc nhầm mã: hãy chỉnh số lượng/giá vốn trước.
- **Không ghi đè định giá mới hơn:** nếu bạn đã tự định giá vào ngày mới hơn ngày của giá thị trường, dòng đó hiện "Bạn đã định giá mới hơn".
- **Nhập tay:** gõ giá (cổ phiếu, quỹ, vàng: giá mỗi đơn vị; xe, bất động sản không có đơn giá: tổng giá trị) rồi bấm Lưu. Dòng xem trước hiển thị tổng giá trị và lãi/lỗ trước khi lưu.
- **Nhập từ file CSV:** "Tải file mẫu" để lấy sẵn đúng định dạng (`loai;ma_hoac_ten;ngay;gia`, có điền giá hiện tại). Sửa cột giá rồi "Nhập từ file CSV". App khớp theo mã hoặc tên tài sản, hiện bảng xem trước (sẵn sàng / không khớp / lệch / cũ hơn) rồi mới áp. Excel: Tệp → Lưu thành → CSV UTF-8. Số có thể viết `125.000`, `125,000` hoặc `12.345,67`; ngày `2026-11-03` hoặc `03/11/2026`.
- Tiết kiệm không cần cập nhật giá: app tự tính theo lãi suất.

## Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| Tab hiện "Chưa có giá tự động" | Chưa chạy workflow lần nào, hoặc mã trong app không trùng mã trên sàn (kiểm tra ô "Mã" của tài sản). |
| Workflow đỏ ở bước thăm dò | Nguồn chặn IP máy chủ GitHub, thư viện đổi tên hàm/cột, hoặc hết hạn mức. Đọc log (`::warning::`); thử `VNSTOCK_SOURCE` khác. |
| Giá lệch 1.000 lần | Đơn vị giá: đặt `VNSTOCK_PRICE_SCALE` đúng (xem bảng trên). |
| Giá đứng yên nhiều ngày | Ngày nghỉ/lễ không có phiên; hoặc GitHub tạm ngừng lịch khi repo lâu không có hoạt động (vào tab Actions bật lại workflow); hoặc script lỗi: xem lần chạy gần nhất. |
| Mã mới mua chưa có giá | Script chạy sau phiên 15h: mã mới có giá từ lần chạy kế tiếp; hoặc chạy tay `mode = fetch`. |

## Lưu ý về nguồn dữ liệu và giấy phép

vnstock là thư viện bên thứ ba, lấy dữ liệu từ các nguồn không chính thức nên có thể thay đổi hoặc chặn mà không báo trước. Theo trang của vnstock, thư viện miễn phí cho cá nhân và chỉ cấp quyền dùng phần mềm, không cấp quyền dùng dữ liệu của nguồn. Nếu FinTrack được dùng cho nhiều người ngoài gia đình hoặc thu phí, hãy đọc lại giấy phép vnstock và điều khoản của nguồn dữ liệu. Nhập tay và import CSV luôn dùng được kể cả khi tự động ngừng.
