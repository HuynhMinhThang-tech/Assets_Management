import * as XLSX from 'xlsx';
import {
  UserFinancialState,
  Asset,
  Debt,
  CashTransaction,
  Wallet,
} from '../types/finance';
import { normalizeDebt, todayLocalStr } from './calculations';

const STORAGE_KEY = 'fintrack_vn_portfolio_v1';
const BACKUP_KEY = 'fintrack_vn_portfolio_v1_backup';
export const SCHEMA_VERSION = 2;

// Mỗi tài khoản có kho dữ liệu riêng: <khóa gốc>_u_<id người dùng>
let activeUserId: string | null = null;
export function setStorageUser(userId: string | null) {
  activeUserId = userId;
}
const dataKey = () => (activeUserId ? `${STORAGE_KEY}_u_${activeUserId}` : STORAGE_KEY);
const backupKey = () => (activeUserId ? `${BACKUP_KEY}_u_${activeUserId}` : BACKUP_KEY);

/** Dữ liệu cũ (trước khi có tài khoản) được chuyển cho quản trị viên đầu tiên. Bản gốc được giữ nguyên làm bản dự phòng. */
export function adoptLegacyData(userId: string) {
  try {
    const target = `${STORAGE_KEY}_u_${userId}`;
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy && !localStorage.getItem(target)) localStorage.setItem(target, legacy);
    const legacyBackup = localStorage.getItem(BACKUP_KEY);
    if (legacyBackup && !localStorage.getItem(`${BACKUP_KEY}_u_${userId}`)) {
      localStorage.setItem(`${BACKUP_KEY}_u_${userId}`, legacyBackup);
    }
  } catch (err) {
    console.error('adoptLegacyData failed', err);
  }
}

/** Xóa dữ liệu tài chính của một tài khoản (khi quản trị viên xóa tài khoản). */
export function deleteUserData(userId: string) {
  try {
    localStorage.removeItem(`${STORAGE_KEY}_u_${userId}`);
    localStorage.removeItem(`${BACKUP_KEY}_u_${userId}`);
  } catch {}
}

// Seed demo data for realistic Vietnamese investor
export const INITIAL_DEMO_STATE: UserFinancialState = {
  schemaVersion: SCHEMA_VERSION,
  isDemo: true,
  wallet: {
    availableCash: 185000000, // 185 triệu tiền mặt khả dụng
    totalDeposited: 1200000000, // Đã nạp vốn ròng 1.2 tỷ
    totalWithdrawn: 50000000,
  },
  assets: [
    {
      id: 'asset-bds-vin',
      name: 'Căn hộ 2PN Vinhomes Smart City',
      category: 'real_estate',
      initialCost: 2800000000, // 2.8 tỷ
      currentValue: 3450000000, // 3.45 tỷ
      purchaseDate: '2023-04-15',
      status: 'active',
      notes: 'Căn góc tầng trung khu Sapphire, đang cho chuyên gia thuê lâu dài.',
      realizedPnL: 0,
      lastValuationDate: '2026-09-01',
      metadata: {
        address: 'Tòa S2.03 Vinhomes Smart City, Tây Mỗ, Nam Từ Liêm, Hà Nội',
        propertyType: 'apartment',
        areaM2: 64.5,
        purchasePrice: 2800000000,
        estimatedMarketPrice: 3450000000,
        monthlyRentalIncome: 11500000, // 11.5 triệu/tháng
        legalStatus: 'pink_book',
      },
    },
    {
      id: 'asset-stock-fpt',
      name: 'Cổ phiếu FPT Telecom & AI',
      category: 'stock',
      initialCost: 287500000, // 2.500 CP * 115.000đ
      currentValue: 345000000, // 2.500 CP * 138.000đ
      purchaseDate: '2024-02-10',
      status: 'active',
      notes: 'Đầu tư chiến lược dài hạn hưởng cổ tức tiền mặt đều đặn.',
      realizedPnL: 0, // (cổ tức được ghi trong sổ cái giao dịch, không cộng trùng ở đây)
      lastValuationDate: '2026-10-12',
      metadata: {
        symbol: 'FPT',
        exchange: 'HOSE',
        quantity: 2500,
        avgCostPrice: 115000,
        currentPrice: 138000,
        dividendYield: 3.5,
        totalDividendsReceived: 15000000,
      },
    },
    {
      id: 'asset-stock-hpg',
      name: 'Cổ phiếu Hòa Phát (HPG)',
      category: 'stock',
      initialCost: 132500000, // 5.000 CP * 26.500đ
      currentValue: 149000000, // 5.000 CP * 29.800đ
      purchaseDate: '2024-05-20',
      status: 'active',
      notes: 'Đón sóng hạ tầng Dung Quất 2.',
      realizedPnL: 0,
      lastValuationDate: '2026-10-10',
      metadata: {
        symbol: 'HPG',
        exchange: 'HOSE',
        quantity: 5000,
        avgCostPrice: 26500,
        currentPrice: 29800,
        dividendYield: 4.0,
        totalDividendsReceived: 5000000,
      },
    },
    {
      id: 'asset-fund-dcds',
      name: 'Chứng chỉ quỹ DCDS Dragon Capital',
      category: 'fund',
      initialCost: 248000000, // 4.000 CCQ * 62.000đ
      currentValue: 298000000, // 4.000 CCQ * 74.500đ
      purchaseDate: '2023-11-15',
      status: 'active',
      notes: 'Quỹ cân bằng cổ phiếu top VN30',
      realizedPnL: 0,
      lastValuationDate: '2026-10-01',
      metadata: {
        fundCode: 'DCDS',
        fundType: 'balanced',
        units: 4000,
        avgNav: 62000,
        currentNav: 74500,
      },
    },
    {
      id: 'asset-sav-bidv',
      name: 'Sổ tiết kiệm BIDV 12 tháng',
      category: 'savings',
      initialCost: 200000000,
      currentValue: 211200000, // 200tr + lãi tạm tính
      purchaseDate: '2025-11-01',
      status: 'active',
      notes: 'Quỹ dự phòng khẩn cấp và thanh khoản trả nợ.',
      realizedPnL: 0,
      lastValuationDate: '2026-10-15',
      metadata: {
        bankName: 'BIDV Chi nhánh Sở Giao dịch 1',
        depositAmount: 200000000,
        termMonths: 12,
        annualInterestRate: 5.6,
        startDate: '2025-11-01',
        maturityDate: '2026-11-01',
        rolloverOption: 'principal_and_interest',
      },
    },
    {
      id: 'asset-gold-sjc',
      name: 'Vàng miếng SJC 999.9',
      category: 'gold',
      initialCost: 156000000, // 2 lượng = 20 chỉ * 7.8tr
      currentValue: 177000000, // 20 chỉ * 8.85tr
      purchaseDate: '2024-01-05',
      status: 'active',
      notes: 'Bảo hiểm trượt giá và bất ổn kinh tế toàn cầu.',
      realizedPnL: 0,
      lastValuationDate: '2026-10-14',
      metadata: {
        goldType: 'SJC',
        quantityChi: 20,
        costPerChi: 7800000,
        currentPerChi: 8850000,
      },
    },
  ],
  debts: [
    {
      id: 'debt-vcb-home',
      name: 'Vay mua Căn hộ Vinhomes (Vietcombank)',
      lender: 'Vietcombank Ba Đình',
      category: 'mortgage',
      securityType: 'secured',
      principalAmount: 1800000000, // Vay 1.8 tỷ
      remainingPrincipal: 1420000000, // Đã trả một phần, còn 1.42 tỷ
      annualInterestRate: 9.6, // Thả nổi 9.6%
      rateType: 'floating',
      baseRate: 6.2,
      floatingMargin: 3.4,
      preferentialMonths: 12,
      tenorMonths: 240, // 20 năm
      startDate: '2023-04-20',
      paymentDayOfMonth: 18,
      method: 'declining_balance', // Dư nợ giảm dần
      collateralAssetId: 'asset-bds-vin', // Liên kết trực tiếp căn hộ Vinhomes
      collateralDescription: 'Căn hộ 2PN Vinhomes Smart City Tây Mỗ',
      notes: 'Thế chấp bằng chính hợp đồng mua bán căn hộ.',
      status: 'active',
      schedule: [],
    },
    {
      id: 'debt-tpb-car',
      name: 'Vay mua xe Mazda CX-5 (TPBank)',
      lender: 'TPBank Hà Nội',
      category: 'car_loan',
      securityType: 'secured',
      principalAmount: 500000000, // Vay 500tr
      remainingPrincipal: 265000000, // Còn 265tr
      annualInterestRate: 8.8,
      rateType: 'fixed',
      tenorMonths: 60, // 5 năm
      startDate: '2023-08-10',
      paymentDayOfMonth: 5,
      method: 'equal_payment', // Trả góp đều hàng tháng (Niên kim)
      collateralDescription: 'Giấy tờ đăng ký gốc xe ô tô (Cavet)',
      notes: 'Cà-vẹt ngân hàng giữ, đóng gốc lãi đều đặn qua app.',
      status: 'active',
      schedule: [],
    },
    {
      id: 'debt-vcb-personal',
      name: 'Vay tín chấp tiêu dùng theo lương (Vietcombank)',
      lender: 'Vietcombank Ba Đình',
      category: 'consumer_loan',
      securityType: 'unsecured',
      principalAmount: 150000000, // Vay 150tr
      remainingPrincipal: 75000000, // Còn 75tr
      annualInterestRate: 11.5,
      rateType: 'fixed',
      tenorMonths: 36, // 3 năm
      startDate: '2024-06-15',
      paymentDayOfMonth: 10,
      method: 'declining_balance',
      notes: 'Khoản vay tín chấp tiêu dùng theo lương, không cần tài sản bảo đảm.',
      status: 'active',
      schedule: [],
    },
  ],
  transactions: [
    {
      id: 'tx-1',
      date: '2026-10-01',
      type: 'rental_income',
      amount: 11500000,
      title: 'Tiền thuê căn hộ Vinhomes tháng 10/2026',
      linkedAssetId: 'asset-bds-vin',
      note: 'Khách chuyển khoản đúng hạn qua Vietcombank',
    },
    {
      id: 'tx-2',
      date: '2026-10-05',
      type: 'debt_payment',
      amount: 10325000,
      title: 'Thanh toán kỳ vay mua xe TPBank (Gốc + Lãi)',
      linkedDebtId: 'debt-tpb-car',
      note: 'Trích tự động từ ví tài khoản đầu tư',
      principalPortion: 8381667,
      interestPortion: 1943333,
    },
    {
      id: 'tx-3',
      date: '2026-09-18',
      type: 'debt_payment',
      amount: 18860000,
      title: 'Thanh toán kỳ vay thế chấp VCB Vinhomes',
      linkedDebtId: 'debt-vcb-home',
      note: 'Gốc 7.5tr + Lãi 11.36tr theo dư nợ giảm dần',
      principalPortion: 7500000,
      interestPortion: 11360000,
    },
    {
      id: 'tx-4',
      date: '2026-09-10',
      type: 'dividend',
      amount: 5000000,
      title: 'Cổ tức tiền mặt FPT đợt 1',
      linkedAssetId: 'asset-stock-fpt',
      note: '2.000đ/cổ phiếu',
    },
    {
      id: 'tx-5',
      date: '2026-08-15',
      type: 'deposit',
      amount: 50000000,
      title: 'Nạp thêm vốn từ thưởng công việc',
      note: 'Gia tăng tiền mặt khả dụng chờ cơ hội thị trường',
    },
    {
      id: 'tx-6',
      date: '2026-03-20',
      type: 'dividend',
      amount: 10000000,
      title: 'Cổ tức tiền mặt FPT đợt trước',
      linkedAssetId: 'asset-stock-fpt',
    },
    {
      id: 'tx-7',
      date: '2026-04-12',
      type: 'dividend',
      amount: 5000000,
      title: 'Cổ tức tiền mặt HPG',
      linkedAssetId: 'asset-stock-hpg',
    },
  ],
};

// Chuẩn hóa toàn bộ danh sách nợ (sinh lịch thiếu, đồng bộ dư nợ, đánh dấu kỳ quá khứ đã trả)
function ensureDebtsSchedules(debts: Debt[]): Debt[] {
  return debts.map((d) => normalizeDebt(d));
}

const num = (v: any, fallback = 0): number => (typeof v === 'number' && isFinite(v) ? v : Number(v) || fallback);

/**
 * Chuẩn hóa & kiểm tra dữ liệu từ localStorage / file JSON nhập vào.
 * Trả về null nếu cấu trúc không dùng được. Thiếu trường → điền mặc định, KHÔNG crash.
 */
export function normalizeState(raw: any): UserFinancialState | null {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.wallet && !Array.isArray(raw.assets) && !Array.isArray(raw.debts)) return null;

  const w = raw.wallet || {};
  const wallet: Wallet = {
    availableCash: num(w.availableCash),
    totalDeposited: num(w.totalDeposited),
    totalWithdrawn: num(w.totalWithdrawn),
  };

  const assets: Asset[] = (Array.isArray(raw.assets) ? raw.assets : [])
    .filter((a: any) => a && typeof a === 'object' && a.id && a.name)
    .map((a: any) => ({
      ...a,
      category: a.category || 'other',
      initialCost: num(a.initialCost),
      currentValue: num(a.currentValue),
      realizedPnL: num(a.realizedPnL),
      status: a.status === 'sold' ? 'sold' : 'active',
      purchaseDate: a.purchaseDate || todayLocalStr(),
      lastValuationDate: a.lastValuationDate || a.purchaseDate || todayLocalStr(),
      metadata: a.metadata && typeof a.metadata === 'object' ? a.metadata : { itemType: 'Tài sản khác', details: '' },
    }));

  const rawDebts: Debt[] = (Array.isArray(raw.debts) ? raw.debts : [])
    .filter((d: any) => d && typeof d === 'object' && d.id && d.name)
    .map((d: any) => ({
      ...d,
      principalAmount: num(d.principalAmount),
      remainingPrincipal: num(d.remainingPrincipal, num(d.principalAmount)),
      annualInterestRate: num(d.annualInterestRate),
      tenorMonths: num(d.tenorMonths, 12),
      paymentDayOfMonth: num(d.paymentDayOfMonth, 15),
      startDate: d.startDate || todayLocalStr(),
      method: d.method === 'equal_payment' ? 'equal_payment' : 'declining_balance',
      rateType: d.rateType === 'floating' ? 'floating' : 'fixed',
      status: d.status === 'paid_off' ? 'paid_off' : 'active',
    }));

  const transactions: CashTransaction[] = (Array.isArray(raw.transactions) ? raw.transactions : [])
    .filter((t: any) => t && typeof t === 'object' && t.id && t.type)
    .map((t: any) => ({ ...t, amount: num(t.amount), date: t.date || todayLocalStr(), title: t.title || '' }));

  const snapshots = (Array.isArray(raw.snapshots) ? raw.snapshots : [])
    .filter((x: any) => x && x.date)
    .map((x: any) => ({ date: x.date, netWorth: num(x.netWorth), assets: num(x.assets), debts: num(x.debts), cash: num(x.cash) }));

  return {
    schemaVersion: SCHEMA_VERSION,
    isDemo: raw.isDemo === true,
    snapshots,
    wallet,
    assets,
    debts: ensureDebtsSchedules(rawDebts),
    transactions,
  };
}

let loadWarning: string | null = null;
/** Lấy (và xóa) cảnh báo phát sinh trong lần nạp dữ liệu gần nhất. */
export function consumeLoadWarning(): string | null {
  const w = loadWarning;
  loadWarning = null;
  return w;
}

function demoState(): UserFinancialState {
  return normalizeState(JSON.parse(JSON.stringify(INITIAL_DEMO_STATE)))!;
}

/** Bộ dữ liệu mẫu mới (dùng cho tài khoản mới chưa có dữ liệu trên máy chủ). */
export const createDemoState = () => demoState();

/**
 * Tìm dữ liệu THẬT đã nhập trước đây ngay trên trình duyệt này (thời còn lưu cục bộ) để đề nghị nhập lên máy chủ.
 * Bỏ qua dữ liệu mẫu, bản sao lưu và bản hỏng; chọn bản có nhiều bản ghi nhất.
 */
export function findLocalLegacyData(): UserFinancialState | null {
  try {
    let best: UserFinancialState | null = null;
    let bestScore = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (!key.startsWith(STORAGE_KEY) || key.includes('_backup') || key.includes('_corrupt')) continue;
      let parsed: any = null;
      try {
        parsed = JSON.parse(localStorage.getItem(key) || 'null');
      } catch {
        continue;
      }
      const st = normalizeState(parsed);
      if (!st || st.isDemo) continue;
      const score = st.assets.length + st.debts.length + st.transactions.length;
      if (score > bestScore) {
        best = st;
        bestScore = score;
      }
    }
    return best;
  } catch {
    return null;
  }
}

/** Danh mục trống – dùng khi người dùng muốn bắt đầu nhập dữ liệu thật. */
export function emptyState(): UserFinancialState {
  return {
    schemaVersion: SCHEMA_VERSION,
    isDemo: false,
    snapshots: [],
    wallet: { availableCash: 0, totalDeposited: 0, totalWithdrawn: 0 },
    assets: [],
    debts: [],
    transactions: [],
  };
}

/**
 * Load financial state from localStorage with migration & schedule validation.
 * Dữ liệu hỏng KHÔNG bị ghi đè: bản gốc được cất vào khóa *_corrupt_<thời gian> và hiện cảnh báo.
 */
export function loadFinancialState(): UserFinancialState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(dataKey());
  } catch (err) {
    console.error('localStorage unavailable', err);
  }
  if (!raw) {
    const seeded = demoState();
    saveFinancialState(seeded);
    return seeded;
  }
  try {
    const normalized = normalizeState(JSON.parse(raw));
    if (!normalized) throw new Error('Cấu trúc dữ liệu không hợp lệ');
    return normalized;
  } catch (err) {
    console.error('Failed to load financial state', err);
    const rescueKey = `${dataKey()}_corrupt_${Date.now()}`;
    try {
      localStorage.setItem(rescueKey, raw);
    } catch {}
    loadWarning = `Dữ liệu đã lưu bị hỏng nên không đọc được. Bản gốc được giữ lại ở khóa "${rescueKey}" trong bộ nhớ trình duyệt; ứng dụng đang hiển thị dữ liệu mẫu.`;
    return demoState();
  }
}

/**
 * Persist state to localStorage.
 */
export function saveFinancialState(state: UserFinancialState): boolean {
  try {
    localStorage.setItem(dataKey(), JSON.stringify(state));
    return true;
  } catch (err) {
    console.error('Failed to save financial state', err);
    return false;
  }
}

/** Lưu 1 bản sao lưu trước các thao tác phá hủy (nhập file, đặt lại, xóa sạch). */
export function createBackup(state: UserFinancialState): void {
  try {
    localStorage.setItem(backupKey(), JSON.stringify({ at: new Date().toISOString(), state }));
  } catch (err) {
    console.error('Backup failed', err);
  }
}

export function getBackupInfo(): { at: string } | null {
  try {
    const raw = localStorage.getItem(backupKey());
    return raw ? { at: JSON.parse(raw).at } : null;
  } catch {
    return null;
  }
}

export function restoreBackup(): UserFinancialState | null {
  try {
    const raw = localStorage.getItem(backupKey());
    if (!raw) return null;
    const st = normalizeState(JSON.parse(raw).state);
    if (st) saveFinancialState(st);
    return st;
  } catch {
    return null;
  }
}

/**
 * Reset back to clean demo data.
 */
export function resetFinancialState(): UserFinancialState {
  const s = demoState();
  saveFinancialState(s);
  return s;
}

/** Xóa sạch để bắt đầu với dữ liệu thật. */
export function clearFinancialState(): UserFinancialState {
  const s = emptyState();
  saveFinancialState(s);
  return s;
}

/**
 * Export full state to JSON file.
 */
export function exportStateToJson(state: UserFinancialState): void {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `fintrack_vn_backup_${todayLocalStr()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
}

/** Ô CSV an toàn: bọc ngoặc kép, escape dấu ", chặn "CSV injection" (ô bắt đầu bằng = + - @). */
export function csvCell(v: unknown): string {
  let t = v === undefined || v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t;
  return `"${t.replace(/"/g, '""')}"`;
}

const pct = (pnl: number, cost: number) => (cost > 0 ? Number(((pnl / cost) * 100).toFixed(2)) : 0);

/**
 * Export full state to multi-sheet Excel (.xlsx) file.
 * Đủ 6 sheet (Tài sản + metadata, Nợ, Lịch trả nợ, Giao dịch, Ví, Ảnh chụp) để đối chiếu / khôi phục thủ công.
 * Khôi phục tự động: dùng "Bản sao lưu JSON".
 */
export function exportStateToExcel(state: UserFinancialState): void {
  const wb = XLSX.utils.book_new();

  const assetsData = state.assets.map((a) => ({
    'Mã ID': a.id,
    'Tên tài sản': a.name,
    'Loại danh mục': a.category,
    'Giá vốn ban đầu (VND)': a.initialCost,
    'Thị giá hiện tại (VND)': a.currentValue,
    'Lãi/lỗ sổ sách (VND)': a.currentValue - a.initialCost,
    '% Tỷ suất sổ sách': pct(a.currentValue - a.initialCost, a.initialCost),
    'Lãi thực tế đã chốt từ bán (VND)': a.realizedPnL || 0,
    'Ngày mua': a.purchaseDate,
    'Ngày định giá gần nhất': a.lastValuationDate,
    'Trạng thái': a.status === 'active' ? 'Đang nắm giữ' : 'Đã bán',
    'Khoản nợ liên kết': a.linkedDebtId || '',
    'Ghi chú': a.notes || '',
    'Thuộc tính chuyên biệt (JSON)': JSON.stringify(a.metadata || {}),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(assetsData), 'Danh mục Tài sản');

  const debtsData = state.debts.map((d) => ({
    'Mã ID': d.id,
    'Tên khoản vay': d.name,
    'Chủ nợ/Ngân hàng': d.lender,
    'Phân loại': d.category,
    'Hình thức': d.securityType === 'secured' ? 'Thế chấp' : 'Tín chấp',
    'Gốc vay ban đầu (VND)': d.principalAmount,
    'Dư nợ gốc còn lại (VND)': d.remainingPrincipal,
    'Lãi suất (%/năm)': d.annualInterestRate,
    'Cơ chế lãi': d.rateType === 'fixed' ? 'Cố định' : 'Thả nổi',
    'Lãi cơ sở (%)': d.baseRate ?? '',
    'Biên độ (%)': d.floatingMargin ?? '',
    'Thời hạn (tháng)': d.tenorMonths,
    'Ngày giải ngân': d.startDate,
    'Ngày trả hàng tháng': d.paymentDayOfMonth,
    'Phương thức tính': d.method === 'declining_balance' ? 'Dư nợ giảm dần' : 'Trả đều hàng tháng',
    'Tài sản thế chấp liên kết': d.collateralAssetId || 'Không',
    'Trạng thái': d.status === 'active' ? 'Đang trả' : 'Đã tất toán',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(debtsData), 'Khoản nợ & Đòn bẩy');

  const scheduleData = state.debts.flatMap((d) =>
    (d.schedule || []).map((i) => ({
      'Mã khoản nợ': d.id,
      'Tên khoản vay': d.name,
      'Kỳ': i.period,
      'Ngày đến hạn': i.dueDate,
      'Tiền gốc': i.principalPayable,
      'Tiền lãi': i.interestPayable,
      'Tổng phải trả': i.totalMonthlyPayment,
      'Dư nợ sau kỳ': i.remainingBalance,
      'Đã trả': i.isPaid ? 'Có' : 'Chưa',
      'Ngày trả thực tế': i.paidDate || '',
    }))
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(scheduleData), 'Lịch trả nợ');

  const txData = state.transactions.map((t) => ({
    'Mã ID': t.id,
    'Ngày giao dịch': t.date,
    'Loại dòng tiền': t.type,
    'Số tiền (VND)': t.amount,
    'Tiêu đề / Nội dung': t.title,
    'Tài sản liên kết': t.linkedAssetId || '',
    'Khoản nợ liên kết': t.linkedDebtId || '',
    'Phần gốc': t.principalPortion ?? '',
    'Phần lãi': t.interestPortion ?? '',
    'Phí/Thuế': t.fees ?? '',
    'Ghi chú': t.note || '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txData), 'Nhật ký Dòng tiền');

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      {
        'Tiền mặt khả dụng (VND)': state.wallet.availableCash,
        'Tổng đã nạp (VND)': state.wallet.totalDeposited,
        'Tổng đã rút (VND)': state.wallet.totalWithdrawn,
      },
    ]),
    'Ví đầu tư'
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      (state.snapshots || []).map((x) => ({
        'Ngày': x.date,
        'Tài sản ròng': x.netWorth,
        'Tổng tài sản': x.assets,
        'Tổng nợ': x.debts,
        'Tiền mặt': x.cash,
      }))
    ),
    'Lịch sử Tài sản ròng'
  );

  XLSX.writeFile(wb, `fintrack_vn_portfolio_${todayLocalStr()}.xlsx`);
}

/**
 * Export CSV with UTF-8 BOM so Excel opens Vietnamese characters cleanly without garbling.
 */
export function exportCsvWithBom(csvContent: string, filename: string): void {
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
