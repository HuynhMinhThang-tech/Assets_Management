# Giá thị trường tự động (tab "Cập nhật giá")

## Luồng hoạt động

```
GitHub Actions (15:05 và 16:05 giờ VN, thứ 2–6)
   └─ scripts/fetch_prices.py  ── vnstock 6 (nguồn broker của bạn: ssi/dnse/fhsc/tcbs) ──▶ giá đóng cửa
        └─ ghi vào bảng market_prices (Neon)
             └─ API  GET /api/prices  ──▶ tab "Cập nhật giá" hiển thị giá + nút "Áp dụng"
                                              └─ người dùng bấm → giá mới vào danh mục (có lịch sử định giá)
```

- Máy chủ chỉ lưu **giá thị trường dùng chung**. Nó **không tự sửa danh mục** của ai: người dùng bấm "Áp dụng" thì app mới ghi giá, nên không gây xung đột phiên bản dữ liệu.
- Script chỉ lấy các mã **cổ phiếu đang nắm giữ** của mọi tài khoản. Quỹ và vàng đã có chỗ trong bảng và API nhưng chưa có script lấy; hiện nhập tay hoặc import CSV.

## Cài đặt (một lần)

1. **Tạo bảng:** mở Neon → SQL Editor → chạy lại `db/schema.sql` (an toàn khi chạy lại; chỉ thêm bảng `market_prices`).
2. **Khai báo trên GitHub** (repo → Settings → Secrets and variables → Actions):
   - Secret `DATABASE_URL`: chuỗi kết nối Neon (cùng chuỗi đang dùng trên Vercel).
   - **Variable** (tab *Variables*) `VNSTOCK_SOURCE`: nguồn dữ liệu của bạn, một trong `ssi`, `dnse`, `fhsc`, `tcbs`.
   - Secret **khóa Open API của đúng nguồn đó** (vnstock 6 không còn nguồn miễn phí ẩn danh, bạn dùng khóa tài khoản của chính mình):

     | Nguồn | Secret cần tạo | Lấy khóa ở đâu |
     |---|---|---|
     | `ssi` | `SSI_API_KEY`, `SSI_API_SECRET` | Cổng nhà phát triển SSI (developers.ssi.com.vn) |
     | `dnse` | `DNSE_API_KEY`, `DNSE_API_SECRET` | Trang quản lý API Key DNSE (Secret chỉ hiện một lần khi tạo, lưu ngay) |
     | `fhsc` | `FHSC_API_KEY` | Mục quản lý API trong tài khoản FHSC (phục vụ 06:00–00:00 giờ VN) |
     | `tcbs` | `TCBS_API_KEY` | TCInvest. Mỗi phiên cần Smart OTP (8–24 giờ) nên **không hợp chạy tự động hằng ngày** |

   Chỉ cần khóa của một nguồn. Nếu thiếu khóa hoặc đặt sai nguồn, script dừng ngay và nêu rõ thiếu biến nào.
3. **Chạy thăm dò (Bước 0):** repo → Actions → "Lấy giá đóng cửa (vnstock)" → Run workflow → `mode = probe`, `symbols = FPT,HPG,VCB` (hoặc mã bạn đang giữ). Chế độ này **không ghi cơ sở dữ liệu**. Đọc log để kiểm tra:
   - Có lấy được dữ liệu không, hay bị chặn/lỗi kết nối (nguồn có thể chặn IP máy chủ cloud).
   - Tên các cột và đơn vị giá: dòng `gốc=… → VND = …`. Nhiều nguồn trả giá theo **nghìn đồng** (25,5 = 25.500 đ).
   - Thời gian mỗi mã (để biết có kịp hạn mức không).
4. **Chạy thật:** Run workflow → `mode = fetch`. Log in từng mã và giá đóng cửa. Sau đó mở app → tab "Cập nhật giá" → "Làm mới".
5. Từ đó lịch tự chạy mỗi ngày giao dịch (cron `5 8 * * 1-5` và `5 9 * * 1-5` theo UTC = 15:05 và 16:05 giờ VN). Chạy hai lần là để dự phòng; ghi đè cùng ngày nên vô hại.

## Tùy chỉnh (biến môi trường của script)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `VNSTOCK_SOURCE` | *(bắt buộc)* | `ssi`, `dnse`, `fhsc` hoặc `tcbs`. vnstock 6 không có nguồn mặc định; `kbs`/`vci` cũ không còn dùng được. |
| `VNSTOCK_PRICE_SCALE` | `1000` | vnstock 6 trả giá cổ phiếu theo **nghìn đồng** (25,5 = 25.500 đ) nên mặc định nhân 1.000. `1`: giữ nguyên. `auto`: tự nhận theo trung vị các mã. |

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

## Nếu nguồn bị chặn trên GitHub Actions

Một số nguồn dữ liệu chặn dải IP của máy chủ GitHub. Dấu hiệu: bước thăm dò báo `::error::` cho mọi mã (timeout, 403, trả về rỗng). Thử theo thứ tự:

1. **Đổi nguồn:** sửa Variable `VNSTOCK_SOURCE` sang nguồn khác mà bạn có khóa (ví dụ `dnse` thay cho `ssi`), chạy lại `mode = probe`.
2. **Chạy trên máy Windows của bạn:** script đã đọc `DATABASE_URL` từ môi trường nên ghi vào cùng Neon. Cài Python 3.12, rồi `pip install -r scripts/requirements-prices.txt`. Tạo file `lay-gia.bat`:

   ```bat
   @echo off
   set DATABASE_URL=chuỗi-kết-nối-neon-của-bạn
   python scripts\fetch_prices.py
   ```

   Mở Task Scheduler → Create Basic Task → chạy hằng ngày lúc 15:30 (thứ 2 đến thứ 6). Không commit file `.bat` này lên GitHub vì có chuỗi kết nối.
3. **Tạm thời nhập tay hoặc CSV:** tab Cập nhật giá vẫn dùng bình thường, không phụ thuộc nguồn tự động.

## Script tự bảo vệ khỏi sai đơn vị

- Chế độ `auto` chọn **một** hệ số cho cả lượt chạy theo trung vị giá của tất cả các mã (không còn quyết định riêng từng mã). Vẫn nên đặt cố định `VNSTOCK_PRICE_SCALE` sau khi xem log thăm dò.
- Trước khi ghi, script so giá mới với phiên đã lưu trước đó của chính mã đó. Lệch ngoài khoảng 0,4× đến 2,5× thì **không ghi** mã đó và báo lỗi rõ (thường là sai đơn vị ×1000 hoặc ÷1000).
- Cuối mỗi lần chạy, trang kết quả của GitHub Actions có tóm tắt: bao nhiêu mã thành công, mã nào lỗi và vì sao.
- Kiểm thử các hàm này: `python3 -m unittest discover -s tests/python -v`.

## Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| Tab hiện "Chưa có giá tự động" | Chưa chạy workflow lần nào, hoặc mã trong app không trùng mã trên sàn (kiểm tra ô "Mã" của tài sản). |
| Workflow đỏ ở bước **Cài thư viện** (`Could not find a version that satisfies … vnstock<5,>=4.0`) | Bản 4.x và thế hệ 5 đã ngừng xác thực từ 10/11/2026; phải dùng vnstock 6 qua kho gói của vnstocks.com (đã sửa trong `scripts/requirements-prices.txt`). |
| Workflow đỏ ở bước thăm dò | Thiếu khóa/biến `VNSTOCK_SOURCE`, nguồn chặn IP máy chủ GitHub, thư viện đổi tên hàm/cột, hoặc hết hạn mức. Đọc log (`::error::` / `::warning::`); thử nguồn khác. |
| Giá lệch 1.000 lần | Đơn vị giá: đặt `VNSTOCK_PRICE_SCALE` đúng (xem bảng trên). |
| Giá đứng yên nhiều ngày | Ngày nghỉ/lễ không có phiên; hoặc GitHub tạm ngừng lịch khi repo lâu không có hoạt động (vào tab Actions bật lại workflow); hoặc script lỗi: xem lần chạy gần nhất. |
| Mã mới mua chưa có giá | Script chạy sau phiên 15h: mã mới có giá từ lần chạy kế tiếp; hoặc chạy tay `mode = fetch`. |

## Lưu ý về nguồn dữ liệu và giấy phép

vnstock là thư viện bên thứ ba và đã đổi cách phân phối giữa các thế hệ (bản cũ ngừng hoạt động có kỳ hạn), nên có thể thay đổi mà không báo trước. Thế hệ 6 lấy dữ liệu qua Open API của nguồn bằng khóa của chính bạn, theo điều khoản của nguồn đó; thư viện chỉ cấp quyền dùng phần mềm, không cấp quyền dùng dữ liệu. Mỗi bản vnstock cũng chỉ chạy trong 365 ngày kể từ ngày phát hành, nên cần cập nhật `requirements-prices.txt` định kỳ. Nếu FinTrack được dùng cho nhiều người ngoài gia đình hoặc thu phí, hãy đọc lại giấy phép vnstock và điều khoản của nguồn dữ liệu. Nhập tay và import CSV luôn dùng được kể cả khi tự động ngừng.
