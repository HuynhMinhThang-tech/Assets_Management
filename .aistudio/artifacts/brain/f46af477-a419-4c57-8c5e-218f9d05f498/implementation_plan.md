# FinTrack VN — Hệ Thống Quản Lý Tài Sản & Nợ Đầu Tư Đa Chiều

Ứng dụng web chuyên sâu quản lý tài chính đầu tư cá nhân và nhóm, theo dõi độc lập hai chiều Tài sản (Assets) và Nợ/Đòn bẩy (Debts/Liabilities), tính toán lãi/lỗ sổ sách (Book PnL) và lãi/lỗ thực tế (Realized PnL), quản lý dòng tiền ví đầu tư thực tế và lịch trả nợ chi tiết theo từng tháng.

## User Review & Critical Decisions

> [!IMPORTANT]
> Các quyết định cốt lõi đã được xác nhận và thống nhất cùng người dùng:

- **Lưu trữ dữ liệu & Chuyển giao Supabase**: Ứng dụng chạy độc lập trên trình duyệt với bộ nhớ bền vững (IndexedDB / LocalStorage), hỗ trợ xuất/nhập toàn bộ dữ liệu ra Excel, CSV và JSON. Đồng thời, hệ thống cung cấp sẵn file `supabase_schema.sql` hoàn chỉnh (kèm tính năng tải về một chạm từ giao diện) để người dùng dễ dàng triển khai lên Supabase/PostgreSQL sau này khi mở rộng nhóm.
- **Đơn vị tiền tệ chuẩn**: Tiền đồng Việt Nam (VND), hỗ trợ hiển thị thông minh quy đổi theo đơn vị Tỷ và Triệu đồng (`tabular-nums`), đảm bảo tính trực quan và chính xác tuyệt đối trong mọi báo cáo số liệu.
- **Trọng tâm Dòng tiền Thực tế & Lịch trả nợ**: Tập trung hiển thị chính xác ngày đến hạn thanh toán, số ngày còn lại (countdown), số tiền gốc và lãi phải trả theo từng kỳ (hỗ trợ cả 2 phương thức: Dư nợ giảm dần và Trả đều cố định - Annuity), kèm liên kết trực tiếp giữa khoản vay với tài sản bảo đảm (tính tỷ lệ Vốn tự có Equity và Đòn bẩy LTV).

---

## 1. Overview & Core Concept

### Khái niệm & Mục tiêu
Khác với các ứng dụng ghi chép chi tiêu sinh hoạt thông thường (cà phê, ăn uống), **FinTrack VN** tập trung 100% vào **Tài chính Đầu tư & Quản lý Nợ Tài sản**:
- **Dòng tiền Ví Đầu tư (Available Cash Flow)**: Quản lý lượng tiền nạp/rút vào quỹ đầu tư khả dụng. Mọi giao dịch mua tài sản hoặc trả nợ gốc/lãi đều được đối soát và khấu trừ minh bạch từ dòng tiền thực tế.
- **Tài sản Đa cấu trúc (Polymorphic Assets)**: Mỗi loại tài sản sở hữu bộ thuộc tính chuyên biệt:
  - *Cổ phiếu / Chứng khoán*: Mã CP, sàn (HOSE/HNX/UPCoM), khối lượng, giá vốn bình quân, thị giá cập nhật thủ công/sổ sách, cổ tức đã chốt.
  - *Chứng chỉ quỹ (CCQ)*: Tên quỹ, loại quỹ (cổ phiếu/trái phiếu), số lượng CCQ, NAV vốn, NAV hiện tại.
  - *Bất động sản*: Địa chỉ, phân loại (căn hộ, đất nền, nhà phố), diện tích $m^2$, giá mua, định giá thị trường, thu nhập cho thuê hàng tháng, tình trạng pháp lý.
  - *Tiết kiệm & Trái phiếu*: Tổ chức phát hành/ngân hàng, gốc gửi, kỳ hạn, lãi suất %/năm, ngày gửi, ngày đáo hạn.
  - *Vàng & Kim loại quý*: Loại vàng (SJC, nhẫn tròn trơn 9999), khối lượng (chỉ/lượng), giá vốn và giá thị trường.
- **Nợ & Đòn bẩy Tài sản (Asset-Backed Debts)**:
  - Phân loại: Vay mua nhà/BĐS, vay mua ô tô, vay sinh viên/học tập, vay kinh doanh, thấu chi/tiêu dùng.
  - Cơ chế lãi suất: Lãi suất cố định hoặc Lãi suất thả nổi (lãi suất cơ sở + biên độ, thời hạn cố định ưu đãi ban đầu).
  - Phương thức tính: **Dư nợ giảm dần** (gốc cố định + lãi giảm dần) và **Trả đều hàng tháng** (Niên kim cố định / Annuity).
  - Liên kết tài sản (Collateral Linkage): Cho phép gán khoản nợ vào 1 tài sản cụ thể để tự động đo lường: Giá trị tài sản, Dư nợ còn lại, Vốn thực sở hữu (Equity) và Tỷ lệ đòn bẩy LTV (Loan-to-Value).
- **Lãi Lỗ Thực Tế vs. Sổ Sách**:
  - *Lãi/lỗ sổ sách (Unrealized / Book PnL)*: Chênh lệch giữa thị giá định giá hiện tại và giá vốn đầu tư.
  - *Lãi/lỗ thực tế (Realized PnL)*: Lợi nhuận/thua lỗ đã hiện thực hóa từ các lệnh chốt lời, bán một phần tài sản, tiền cổ tức tiền mặt đã nhận về ví.

---

## 2. User Experience & Visual Design

### Phong cách Thiết kế & Không gian Làm việc
- Tuân thủ triệt để nguyên tắc **Universal Frontend Design Constitution** và phong cách **Fintech & SaaS Data Console**:
  - Bố cục Dashboard chuyên nghiệp: Cấu trúc Sidebar chuẩn mực ($260\text{px}$) + Header hiển thị Breadcrumb & số dư tiền khả dụng + Vùng nội dung chính rộng rãi (tối ưu màn hình desktop $1440\text{px}$ và phản hồi mượt mà trên tablet/mobile).
  - Không dùng các thẻ pill tròn trĩnh rườm rà (Zero-pill discipline), sử dụng văn bản phân tách typographic tinh tế (`·`, `/`) và chữ số định dạng bảng (`tabular-nums`) cho mọi bảng biểu tài chính.
  - Bảng màu: Nền trắng ngà/xám nhạt tối giản (`#F8FAFC`), bề mặt thẻ phẳng tinh gọn với đường viền mỏng (`border-slate-200`), điểm nhấn tài chính cao cấp (Màu xanh rừng lục bảo Emerald `#059669` cho thặng dư/lợi nhuận, Đỏ thẩm Crimson `#DC2626` cho nợ/chi phí lãi, Vàng hổ phách Amber `#D97706` cho khoản nợ sắp đến hạn).

### Các Luồng Người dùng Chính (Key User Flows)
1. **Tổng quan Tài chính (Investment & Net Worth Dashboard)**:
   - Thẻ thống kê tài sản ròng (Net Worth = Tổng Tài sản - Tổng Dư nợ), Tiền mặt khả dụng trong ví, Tổng lãi/lỗ sổ sách, Lãi/lỗ đã chốt thực tế.
   - Biểu đồ phân bổ tài sản (Asset Allocation) theo danh mục: BĐS, Cổ phiếu, CCQ, Tiết kiệm, Vàng, Tiền mặt.
   - Biểu đồ tương quan Tài sản vs Nợ vay, cảnh báo các khoản nợ cần trả trong 30 ngày tới.
2. **Quản lý Tài sản (Asset Management View)**:
   - Danh sách tài sản phân chia theo tab/loại hình tài sản.
   - Khi chọn loại tài sản, biểu mẫu nhập liệu thay đổi động (dynamic fields) chính xác theo chuyên môn từng loại tài sản.
   - Thao tác: Thêm mới, Cập nhật định giá thị trường mới nhất (Market revaluation), Bán/Chốt lời (chuyển sang Realized PnL và hoàn vốn vào Ví đầu tư).
3. **Quản lý Nợ & Lịch Trả Nợ (Debt & Loan Amortization View)**:
   - Danh mục các khoản vay hiện hữu, hiển thị rõ ngân hàng, tài sản thế chấp liên kết, lãi suất (thả nổi/cố định).
   - Bộ đếm thời gian: Số ngày còn lại đến hạn đóng lãi kỳ tiếp theo, số tiền chính xác cần chuẩn bị (gốc + lãi).
   - Bảng khấu hao chi tiết theo tháng (Full Amortization Schedule table): Xem từng kỳ từ tháng 1 đến ngày đáo hạn cuối cùng.
   - Nút hành động "Xác nhận đã trả kỳ này": Tự động trừ tiền khỏi ví đầu tư và chuyển trạng thái kỳ trả nợ sang đã hoàn thành.
4. **Dòng tiền Ví Đầu tư & Lịch sử Giao dịch (Cashflow & Transactions)**:
   - Theo dõi số dư tiền mặt chờ giải ngân.
   - Ghi nhận Nạp tiền / Rút tiền vốn, Tiền giải ngân mua tài sản, Tiền thu từ bán tài sản/cổ tức, Tiền trích trả nợ gốc & lãi.
5. **Nhập / Xuất Dữ liệu & Supabase SQL Schema (Data Center & SQL Exporter)**:
   - Nút xuất file Excel/CSV/JSON toàn bộ danh mục tài sản, khoản nợ và lịch sử giao dịch.
   - Nhập liệu nhanh từ file CSV / Excel mẫu.
   - **Tab SQL Schema**: Cung cấp mã nguồn SQL PostgreSQL/Supabase hoàn chỉnh với đầy đủ bảng (`assets`, `debts`, `debt_payments`, `cash_wallet`, `transactions`), khóa ngoại liên kết (collateral), chỉ mục và RLS policy để người dùng sao chép hoặc tải về sử dụng ngay.

---

## 3. Key Product Decisions & Trade-Offs

- **Quyết định 1: Mô hình Dữ liệu Tài sản Đa hình (Polymorphic Asset Schemas)**
  - *Cách tiếp cận*: Một bảng gốc `assets` chứa thông tin chung (ID, tên, danh mục, giá trị vốn ban đầu, giá trị thị trường hiện tại, ngày mua, ghi chú) kết hợp trường dữ liệu cấu trúc `metadata` (JSONB) lưu thuộc tính chuyên biệt (ví dụ BĐS lưu diện tích, địa chỉ, tiền thuê; Cổ phiếu lưu mã, sàn, số lượng, giá vốn).
  - *Lý do*: Đáp ứng trọn vẹn yêu cầu người dùng rằng không thể gán thuộc tính chứng khoán cho BĐS, đồng thời tương thích 100% với cả lưu trữ LocalStorage/JSON và PostgreSQL/Supabase JSONB.
- **Quyết định 2: Liên kết Nợ với Tài sản (Collateral Linkage & LTV Math)**
  - *Cách tiếp cận*: Mỗi khoản nợ có trường tùy chọn `collateral_asset_id`. Khi liên kết, ứng dụng tính toán tức thời:
    $$\text{Tỷ lệ Đòn bẩy (LTV)} = \frac{\text{Dư nợ gốc còn lại}}{\text{Thị giá tài sản}} \times 100\%$$
    $$\text{Vốn tự có thực (Net Equity)} = \text{Thị giá tài sản} - \text{Dư nợ gốc còn lại}$$
  - *Lý do*: Giúp nhà đầu tư luôn nắm rõ mình thực sự sở hữu bao nhiêu % của căn nhà/chiếc xe và khi nào khoản nợ được giải phóng hoàn toàn.
- **Quyết định 3: Tính toán Lịch Khấu Hao Nợ Tự Động (Amortization Engine)**
  - *Cách tiếp cận*: Tự động xây dựng thuật toán sinh lịch trả nợ chuẩn xác theo 2 phương thức tài chính ngân hàng Việt Nam:
    1. *Dư nợ giảm dần*: Gốc hàng tháng $= \frac{\text{Gốc vay}}{\text{Số kỳ}}$, Lãi kỳ $i = \text{Dư nợ còn lại}_{i-1} \times \frac{\text{Lãi suất năm}}{12}$.
    2. *Trả đều (Niên kim)*: Số tiền trả cố định hàng tháng $= P \times \frac{r(1+r)^n}{(1+r)^n - 1}$.
  - *Lý do*: Đảm bảo nắm chắc chính xác thời gian và số tiền cần chi trả mỗi tháng để dự trù dòng tiền đầu tư.

---

## 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            FinTrack VN Web App                              │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                   ┌───────────────────┴───────────────────┐
                   ▼                                       ▼
       ┌───────────────────────┐               ┌───────────────────────┐
       │   Client State Engine │               │   Financial Engines   │
       │  (IndexedDB / Local)  │               │                       │
       │                       │               │ • Amortization Calc   │
       │ • Cash Balance Wallet │               │ • PnL Engine (Book    │
       │ • Assets Collection   │               │   vs Realized)        │
       │ • Debts & Collateral  │               │ • LTV & Net Equity    │
       │ • Cashflow Ledger     │               │ • Portfolio Breakdown │
       └───────────┬───────────┘               └───────────┬───────────┘
                   │                                       │
                   ▼                                       ▼
 ┌──────────────────────────────────┐    ┌───────────────────────────────────┐
 │        User View Layers          │    │         Data Export Hub           │
 │                                  │    │                                   │
 │ • Net Worth & Debt Dashboard     │    │ • Excel / CSV Export & Import     │
 │ • Polymorphic Asset Manager      │    │ • Full JSON Backup & Restore      │
 │ • Loan & Amortization Schedule   │    │ • PostgreSQL / Supabase .SQL      │
 │ • Investment Cashflow Ledger     │    │   Generator & Direct Download     │
 └──────────────────────────────────┘    └───────────────────────────────────┘
```

### Cấu trúc Thực thể Dữ liệu (TypeScript & Supabase Schema)
- `Wallet`: Số dư tiền mặt khả dụng, tổng vốn đã nạp ròng.
- `Asset`: ID, Name, Category (`stock`, `fund`, `real_estate`, `savings`, `gold`, `other`), InitialCost, CurrentValue, PurchaseDate, Status (`holding`, `sold`), Metadata.
- `Debt`: ID, Name, Category (`mortgage`, `car_loan`, `student_loan`, `business_loan`, `consumer_loan`), PrincipalAmount, RemainingPrincipal, InterestRate, RateType (`fixed`, `floating`), FloatingMargin, TenorMonths, StartDate, PaymentDayOfMonth, Method (`declining_balance`, `equal_payment`), CollateralAssetId.
- `AmortizationSchedule`: Kỳ số, Ngày đến hạn, Tiền gốc, Tiền lãi, Tổng phải trả, Dư nợ còn lại, Trạng thái (`paid`, `pending`, `overdue`).
- `Transaction`: ID, Date, Type (`deposit`, `withdraw`, `buy_asset`, `sell_asset`, `dividend`, `debt_payment`), Amount, LinkedAssetId, LinkedDebtId, Note.
