/**
 * Types & Domain Models for FinTrack VN
 */

export type AssetCategory =
  | 'stock'        // Cổ phiếu / Chứng khoán
  | 'fund'         // Chứng chỉ quỹ (CCQ)
  | 'real_estate'  // Bất động sản
  | 'savings'      // Tiền gửi tiết kiệm / Trái phiếu
  | 'gold'         // Vàng & Kim loại quý
  | 'other';       // Khác (Crypto, Xe, Doanh nghiệp)

export interface StockMetadata {
  symbol: string;                  // Mã CP: FPT, HPG, VCB...
  exchange: 'HOSE' | 'HNX' | 'UPCOM';
  quantity: number;                // Khối lượng cổ phiếu
  avgCostPrice: number;            // Giá vốn bình quân (VND)
  currentPrice: number;            // Thị giá hiện tại (VND)
  dividendYield?: number;          // % Tỷ suất cổ tức kỳ vọng
  totalDividendsReceived: number;  // Cổ tức thực tế đã nhận về ví (VND)
}

export interface FundMetadata {
  fundCode: string;                // Ví dụ: DCDS, VESAF, VEOF, TCBF...
  fundType: 'equity' | 'bond' | 'balanced'; // Quỹ cổ phiếu, trái phiếu, cân bằng
  units: number;                   // Số lượng chứng chỉ quỹ
  avgNav: number;                  // NAV vốn mua trung bình
  currentNav: number;              // NAV hiện tại
}

export interface RealEstateMetadata {
  address: string;                 // Địa chỉ / Dự án / Khu vực
  propertyType: 'apartment' | 'land' | 'townhouse' | 'villa'; // Căn hộ, Đất nền, Nhà phố, Biệt thự
  areaM2: number;                  // Diện tích m2
  purchasePrice: number;           // Giá mua ban đầu
  estimatedMarketPrice: number;    // Định giá thị trường hiện tại
  monthlyRentalIncome: number;     // Thu nhập cho thuê hàng tháng (nếu có)
  rentalDayOfMonth?: number;       // Ngày nhận tiền thuê hàng tháng (1-31) – hiển thị trên Lịch
  legalStatus: 'red_book' | 'pink_book' | 'sales_contract' | 'waiting'; // Sổ đỏ, Sổ hồng, HĐMB, Chờ sổ
}

export interface SavingsMetadata {
  bankName: string;                // Ngân hàng: Vietcombank, BIDV, Techcombank...
  depositAmount: number;           // Số tiền gửi gốc
  termMonths: number;              // Kỳ hạn gửi (tháng)
  annualInterestRate: number;      // Lãi suất %/năm
  startDate: string;               // Ngày bắt đầu gửi (YYYY-MM-DD)
  maturityDate: string;            // Ngày đáo hạn (YYYY-MM-DD)
  rolloverOption: 'principal_and_interest' | 'principal_only' | 'close'; // Tự động tái tục gốc+lãi, gốc, tất toán
  interestPayout?: 'maturity' | 'monthly' | 'upfront'; // Trả lãi cuối kỳ (mặc định), hàng tháng hoặc đầu kỳ
  interestReceived?: number;       // Tổng lãi đã nhận về ví trong kỳ gửi hiện tại
}

export interface GoldMetadata {
  goldType: 'SJC' | 'nhan_9999' | 'trang_suc'; // Vàng miếng SJC, Nhẫn 9999, Nữ trang
  quantityChi: number;             // Số lượng tính bằng chỉ (1 lượng = 10 chỉ)
  costPerChi: number;              // Giá vốn mỗi chỉ (VND)
  currentPerChi: number;           // Giá thị trường mỗi chỉ (VND)
}

export interface OtherMetadata {
  itemType: string;                // Ví dụ: Xe hơi cá nhân, Xe máy, Góp vốn cty, Crypto
  details: string;
  monthlyRentalIncome?: number;    // Thu nhập định kỳ hàng tháng (vd: cho thuê xe)
  rentalDayOfMonth?: number;       // Ngày nhận hàng tháng (1-31)
}

export type AssetMetadata =
  | StockMetadata
  | FundMetadata
  | RealEstateMetadata
  | SavingsMetadata
  | GoldMetadata
  | OtherMetadata;

export interface Asset {
  id: string;
  name: string;                    // Tên tài sản dễ nhớ
  category: AssetCategory;
  initialCost: number;             // Tổng giá vốn đầu tư ban đầu (VND)
  currentValue: number;            // Tổng giá trị thị trường hiện tại (VND)
  purchaseDate: string;            // Ngày mua (YYYY-MM-DD)
  status: 'active' | 'sold' | 'voided'; // Đang nắm giữ / Đã thanh lý hoàn toàn / Đã hủy (nhập nhầm, giữ lại để đối chiếu)
  voidedAt?: string;               // Ngày hủy bản ghi (YYYY-MM-DD)
  notes?: string;
  metadata: AssetMetadata;
  realizedPnL: number;             // Lãi lỗ thực tế đã chốt (VND) từ bán/cổ tức
  lastValuationDate: string;       // Ngày cập nhật định giá gần nhất
  linkedDebtId?: string;           // ID khoản nợ đòn bẩy liên kết (nếu mua bằng vốn vay)
  valuationHistory?: { date: string; value: number; unitPrice?: number }[]; // Lịch sử định giá: tổng giá trị + đơn giá (CP, CCQ, chỉ, m²) nếu có
}

export type DebtCategory =
  | 'mortgage'       // Vay mua nhà / BĐS / Xây sửa nhà
  | 'car_loan'       // Vay mua ô tô
  | 'student_loan'   // Vay sinh viên / Học tập
  | 'business_loan'  // Vay sản xuất kinh doanh
  | 'consumer_loan'  // Vay tiêu dùng / Tín chấp ngân hàng
  | 'other';         // Nợ người thân, thấu chi...

export type InterestRateType = 'fixed' | 'floating';

export type PaymentMethod =
  | 'declining_balance'  // Dư nợ giảm dần (Gốc cố định = Gốc / Số tháng, Lãi tính trên dư nợ còn lại)
  | 'equal_payment';     // Trả góp đều hàng tháng (Niên kim cố định / Annuity: Gốc + Lãi cố định mỗi tháng)

export interface AmortizationScheduleItem {
  period: number;                  // Kỳ thứ (tháng thứ n)
  dueDate: string;                 // Ngày đến hạn đóng tiền (YYYY-MM-DD)
  principalPayable: number;        // Tiền gốc phải trả kỳ này
  interestPayable: number;         // Tiền lãi phải trả kỳ này
  totalMonthlyPayment: number;     // Tổng số tiền trả kỳ này (Gốc + Lãi)
  remainingBalance: number;        // Dư nợ gốc còn lại sau kỳ này
  isPaid: boolean;                 // Trạng thái đã thanh toán kỳ này chưa
  paidDate?: string;               // Ngày thực tế đã thanh toán
  status?: 'cancelled';            // 'cancelled' = kỳ bị hủy do tất toán sớm / trả trước rút ngắn kỳ hạn (không còn phải trả)
  accrualFrom?: string;            // Ngày bắt đầu tính lãi của kỳ này nếu khác ngày đến hạn kỳ trước (sau khi trả trước một phần gốc)
  segments?: RateSegment[];        // Kỳ lẻ (đổi lãi giữa kỳ): lãi theo từng đoạn ngày, tính ngày thực tế/365
  preTracking?: boolean;           // Kỳ đã qua trước khi bắt đầu theo dõi trong app (không có giao dịch kèm theo)
}

/** Một đoạn ngày trong kỳ tính lãi với cùng một mức lãi suất. */
export interface RateSegment {
  from: string;                    // YYYY-MM-DD (tính từ ngày này)
  to: string;                      // YYYY-MM-DD (đến hết ngày trước ngày này)
  days: number;
  annualRate: number;              // %/năm
  interest: number;
}

/** Một mốc lãi suất: từ ngày hiệu lực trở đi áp dụng mức lãi này cho đến khi có mốc tiếp theo. */
export interface RateChange {
  id: string;
  effectiveDate: string;           // Ngày hiệu lực (YYYY-MM-DD), có thể ở quá khứ hoặc tương lai
  annualRate: number;              // Lãi suất áp dụng (%/năm) – thả nổi = lãi cơ sở + biên độ
  baseRate?: number;               // Lãi cơ sở (thả nổi)
  margin?: number;                 // Biên độ (thả nổi)
  note?: string;
  source?: 'initial' | 'manual';   // 'initial' = mốc đầu (không xóa được)
}

/** Điều chỉnh dư nợ theo sao kê ngân hàng (có dấu vết, không đụng tới ví). */
export interface DebtAdjustment {
  id: string;
  date: string;                    // Ngày ghi nhận điều chỉnh
  before: number;                  // Dư nợ gốc app đang tính
  after: number;                   // Dư nợ gốc theo sao kê
  note?: string;
  lastPaidIndex: number;           // Chỉ số kỳ đã trả gần nhất lúc điều chỉnh (-1 = chưa trả kỳ nào)
  itemBalanceBefore?: number;      // Dư nợ ghi ở kỳ đã trả gần nhất trước điều chỉnh
}

export type DebtSecurityType = 'secured' | 'unsecured'; // Vay thế chấp vs Vay tín chấp

/** Nơi dùng vốn của khoản vay: tiền vay đã đi đâu. */
export type FundUseKind =
  | 'wallet'       // Vào ví đầu tư
  | 'asset'        // Mua tài sản (gắn với một tài sản trong danh mục)
  | 'spent'        // Đã chi tiêu / không có tài sản đối ứng
  | 'unspecified'; // Chưa xác định (dữ liệu cũ, cần bổ sung)

export interface FundUse {
  kind: FundUseKind;
  assetId?: string;       // kind = 'asset': tài sản được mua bằng vốn vay
  cashRecorded?: boolean; // kind = 'wallet': true = đã ghi dòng giải ngân vào ví; không có = chỉ ghi nợ, ví không đổi
}

export interface Debt {
  id: string;
  name: string;                    // Tên khoản vay: Vay mua chung cư An Bình, Vay mua xe Mazda 3...
  lender: string;                  // Ngân hàng / Tổ chức cho vay: Vietcombank, TPBank, Shinhan...
  category: DebtCategory;
  securityType: DebtSecurityType;  // 'secured' (Vay thế chấp) | 'unsecured' (Vay tín chấp)
  principalAmount: number;         // Số tiền vay ban đầu (VND)
  remainingPrincipal: number;      // Dư nợ gốc còn lại hiện tại (VND)
  annualInterestRate: number;      // Lãi suất hiện tại (%/năm, ví dụ 9.5)
  rateType: InterestRateType;      // Cố định hay Thả nổi
  baseRate?: number;               // Lãi suất cơ sở (nếu thả nổi)
  floatingMargin?: number;         // Biên độ thả nổi (ví dụ +3.5%)
  preferentialMonths?: number;     // Số tháng ưu đãi lãi suất cố định ban đầu
  tenorMonths: number;             // Tổng thời hạn vay (số tháng, ví dụ 240 tháng = 20 năm)
  startDate: string;               // Ngày giải ngân / bắt đầu vay (YYYY-MM-DD)
  paymentDayOfMonth: number;       // Ngày đóng tiền hàng tháng (1 - 31)
  method: PaymentMethod;           // Dư nợ giảm dần hay Trả góp đều
  collateralAssetId?: string;      // ID tài sản thế chấp / bảo đảm liên kết (nếu là vay thế chấp)
  collateralDescription?: string;  // Mô tả tài sản thế chấp nếu là tài sản ngoài (sổ đỏ khác, lương bảo lãnh...)
  notes?: string;
  status: 'active' | 'paid_off' | 'voided'; // Đang vay / Đã tất toán / Đã hủy (nhập nhầm)
  voidedAt?: string;               // Ngày hủy bản ghi (YYYY-MM-DD)
  fundUse?: FundUse;               // Nơi dùng vốn (bắt buộc với khoản mới; dữ liệu cũ = chưa xác định)
  rateTimeline?: RateChange[];     // Dòng thời gian lãi suất (sắp theo ngày hiệu lực); mốc đầu là mốc khởi tạo
  trackingStartDate?: string;      // Khoản vay đang trả dở: ngày bắt đầu theo dõi (không có lịch sử trước ngày này)
  scheduleAnchorDate?: string;     // Ngày đến hạn của kỳ liền trước kỳ đầu tiên của lịch (mốc tính lãi kỳ 1)
  adjustments?: DebtAdjustment[];  // Lịch sử điều chỉnh theo sao kê
  closedDate?: string;             // Ngày tất toán sớm
  closeReason?: 'early';           // Lý do đóng khoản vay trước hạn
  graceMonths?: number;            // Số tháng ân hạn gốc (chỉ trả lãi)
  schedule?: AmortizationScheduleItem[]; // Lịch trả nợ chi tiết
  rateHistory?: { date: string; rate: number; baseRate?: number; margin?: number }[]; // Lịch sử đổi lãi suất
}

export interface Wallet {
  availableCash: number;           // Tiền mặt khả dụng trong ví đầu tư (VND)
  totalDeposited: number;          // Tổng tiền vốn đã nạp vào ví
  totalWithdrawn: number;          // Tổng tiền đã rút ra khỏi ví
}

export type TransactionType =
  | 'deposit'        // Nạp tiền vốn vào ví đầu tư
  | 'withdraw'       // Rút tiền khỏi ví đầu tư
  | 'buy_asset'      // Trích tiền ví mua tài sản
  | 'sell_asset'     // Thu tiền từ bán tài sản (hoàn vốn + lãi/lỗ)
  | 'dividend'       // Cổ tức / Lợi tức nhận về ví
  | 'debt_payment'   // Trích ví trả nợ (gốc + lãi)
  | 'rental_income'  // Thu nhập tiền thuê nhà từ BĐS
  | 'interest_income' // Lãi tiền gửi / lãi trái phiếu nhận về ví
  | 'loan_disbursement'; // Tiền vay giải ngân vào ví

export interface CashTransaction {
  id: string;
  date: string;                    // YYYY-MM-DD
  type: TransactionType;
  amount: number;                  // Số tiền giao dịch (VND)
  title: string;
  linkedAssetId?: string;
  linkedDebtId?: string;
  note?: string;
  principalPortion?: number;       // (debt_payment) phần gốc trong khoản trả
  interestPortion?: number;        // (debt_payment) phần lãi trong khoản trả = chi phí lãi vay thực
  periodIndex?: number;            // (debt_payment) chỉ số kỳ trong lịch trả (để hoàn nguyên khi hủy)
  feePortion?: number;             // (debt_payment) phí trả trước hạn (tất toán sớm / trả trước một phần gốc)
  noCash?: boolean;                // true = ghi nhận khoản trả nhưng KHÔNG đổi tiền ví (trả bằng tiền ngoài ví)
  noVoid?: string;                 // Lý do không cho hủy giao dịch này (ví dụ: sinh ra từ tái tục sổ tiết kiệm)
  /** Tất toán sớm: dữ liệu để hoàn nguyên khi hủy. */
  settlement?: { balanceBefore: number; cancelled: number[] };
  /** Trả trước một phần gốc: dữ liệu để hoàn nguyên khi hủy. */
  prepay?: {
    balanceBefore: number;
    cancelled: number[];
    /** Các kỳ chưa trả trước khi trả trước: [chỉ số, gốc, lãi, dư nợ sau kỳ, ngày bắt đầu tính lãi]. */
    itemsBefore: Array<[number, number, number, number, string | null]>;
  };
  fees?: number;                   // (sell_asset) phí môi giới + thuế = giá trị ghi nhận − thực nhận
  // --- Bán tài sản (amount = số tiền THỰC NHẬN vào ví) ---
  quantity?: number;               // số lượng bán (cổ phiếu, CCQ, chỉ); không có với BĐS/tài sản khác
  unitPrice?: number;              // giá bán mỗi đơn vị
  recognizedValue?: number;        // giá trị ghi nhận = số lượng × giá bán (trước phí/thuế)
  costBasisSold?: number;          // giá vốn của phần đã bán
  valueSold?: number;              // thị giá sổ sách của phần đã bán lúc bán (để hoàn nguyên khi hủy)
  realizedPnL?: number;            // lãi/lỗ đã chốt = thực nhận − giá vốn phần bán
  soldOut?: boolean;               // bán hết → tài sản chuyển sang "đã thanh lý"
  // --- Hủy bản ghi nhập nhầm: giữ nguyên dòng cũ, ghi thêm bút toán đảo cùng ngày ---
  status?: 'active' | 'voided';    // 'voided' = dòng này đã bị hủy
  voidedAt?: string;               // (dòng gốc) ngày thực hiện hủy
  voidedBy?: string;               // (dòng gốc) id bút toán đảo
  reversalOf?: string;             // (bút toán đảo) id dòng gốc bị đảo
}

export interface NetWorthSnapshot {
  date: string;                    // YYYY-MM-DD
  netWorth: number;
  assets: number;
  debts: number;
  cash: number;
}

export interface UserFinancialState {
  schemaVersion?: number;
  isDemo?: boolean;                // true = đang dùng dữ liệu mẫu
  snapshots?: NetWorthSnapshot[];  // Ảnh chụp tài sản ròng theo ngày
  wallet: Wallet;
  assets: Asset[];
  debts: Debt[];
  transactions: CashTransaction[];
}
