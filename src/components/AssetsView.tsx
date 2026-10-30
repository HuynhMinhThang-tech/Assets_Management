import React, { useState, useEffect } from 'react';
import {
  Plus,
  TrendingUp,
  RefreshCw,
  DollarSign,
  Trash2,
  Edit2,
  Building,
  LineChart,
  Layers,
  Landmark,
  Coins,
  FileText,
  Search,
  Filter,
  CreditCard,
  Wallet,
  ShieldCheck,
  Percent,
  CalendarClock,
} from 'lucide-react';
import {
  Asset,
  AssetCategory,
  StockMetadata,
  FundMetadata,
  RealEstateMetadata,
  SavingsMetadata,
  GoldMetadata,
  UserFinancialState,
  Debt,
  DebtCategory,
  DebtSecurityType,
  PaymentMethod,
  InterestRateType,
} from '../types/finance';
import {
  formatVND,
  formatPercent,
  generateAmortizationSchedule,
  applyHistoricalPayments,
  todayLocalStr,
} from '../utils/calculations';
import type { SellParams } from '../App';
import { CurrencyInput } from './CurrencyInput';
import { Modal, ModalBody, ModalFooter, FieldError } from './ui/Modal';
import { useDialog } from './ui/DialogProvider';
import { MAX_RATE, MAX_TENOR_MONTHS } from '../utils/validation';
import { getRecurringIncome } from '../utils/calendar';

const CATEGORY_COLORS: Record<AssetCategory, string> = {
  real_estate: '#0284c7',
  stock: '#16a34a',
  fund: '#8b5cf6',
  savings: '#f59e0b',
  gold: '#eab308',
  other: '#64748b',
};

interface AssetsViewProps {
  state: UserFinancialState;
  onAddAsset: (
    asset: Asset,
    deductFromWallet: boolean,
    linkedDebt?: Debt,
    downPaymentAmount?: number
  ) => boolean | void;
  autoOpenAdd?: boolean;
  onAutoOpenConsumed?: () => void;
  onUpdateAsset: (asset: Asset) => void;
  onDeleteAsset: (assetId: string) => void;
  onRevalueAsset: (assetId: string, newValue: number, newPricePerUnit?: number) => void;
  onSellAsset: (params: SellParams) => void;
}

export const AssetsView: React.FC<AssetsViewProps> = ({
  state,
  autoOpenAdd,
  onAutoOpenConsumed,
  onAddAsset,
  onUpdateAsset,
  onDeleteAsset,
  onRevalueAsset,
  onSellAsset,
}) => {
  const { confirm: confirmDialog } = useDialog();
  const [selectedCategory, setSelectedCategory] = useState<AssetCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'sold'>('active');

  // Modals state
  const [revalueAsset, setRevalueAsset] = useState<Asset | null>(null);
  const [revaluePrice, setRevaluePrice] = useState<string>('');

  const [sellAssetTarget, setSellAssetTarget] = useState<Asset | null>(null);
  const [sellValueInput, setSellValueInput] = useState<string>('');
  const [sellNote, setSellNote] = useState<string>('');

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [sellQty, setSellQty] = useState<number>(0);
  const [sellFees, setSellFees] = useState<number>(0);

  // Thu nhập định kỳ hàng tháng (cho thuê nhà / xe…) – hiển thị trên trang Lịch
  const [incomeEditAsset, setIncomeEditAsset] = useState<Asset | null>(null);
  const [incomeEditAmount, setIncomeEditAmount] = useState<number>(0);
  const [incomeEditDay, setIncomeEditDay] = useState<number>(1);
  const incomeEditDayError =
    incomeEditAmount > 0 && (incomeEditDay < 1 || incomeEditDay > 31) ? 'Ngày nhận phải từ 1 đến 31.' : '';
  const openIncomeEdit = (asset: Asset) => {
    const md = asset.metadata as { monthlyRentalIncome?: number; rentalDayOfMonth?: number };
    setIncomeEditAsset(asset);
    setIncomeEditAmount(Number(md.monthlyRentalIncome) || 0);
    setIncomeEditDay(Number(md.rentalDayOfMonth) || 1);
  };
  const saveIncomeEdit = () => {
    if (!incomeEditAsset || incomeEditDayError) return;
    onUpdateAsset({
      ...incomeEditAsset,
      metadata: {
        ...(incomeEditAsset.metadata as any),
        monthlyRentalIncome: incomeEditAmount,
        rentalDayOfMonth: incomeEditAmount > 0 ? incomeEditDay : undefined,
      },
    });
    setIncomeEditAsset(null);
  };

  useEffect(() => {
    if (autoOpenAdd) {
      setIsAddModalOpen(true);
      onAutoOpenConsumed?.();
    }
  }, [autoOpenAdd]);

  const UNIT_KEY: Record<string, { key: string; label: string } | undefined> = {
    stock: { key: 'quantity', label: 'cổ phiếu' },
    fund: { key: 'units', label: 'CCQ' },
    gold: { key: 'quantityChi', label: 'chỉ' },
  };
  const sellUnit = sellAssetTarget ? UNIT_KEY[sellAssetTarget.category] : undefined;
  const sellTotalUnits = sellAssetTarget && sellUnit ? ((sellAssetTarget.metadata as any)[sellUnit.key] as number) || 0 : 0;
  const sellRatio = sellUnit && sellTotalUnits > 0 && sellQty > 0 ? Math.min(1, sellQty / sellTotalUnits) : 1;

  // ---- Ràng buộc tiền khi bán / định giá: sai thì khóa nút xác nhận ----
  const sellProceeds = parseFloat(sellValueInput) || 0;
  const sellQtyError =
    sellUnit && sellQty > sellTotalUnits
      ? `Chỉ có ${sellTotalUnits.toLocaleString('vi-VN')} ${sellUnit.label} để bán.`
      : '';
  const sellFeesError =
    sellFees > 0 && sellFees >= sellProceeds ? 'Phí/thuế phải nhỏ hơn số tiền bán.' : '';
  const canSell = sellProceeds > 0 && !sellQtyError && !sellFeesError;
  const revalueNum = parseFloat(revaluePrice) || 0;


  // Categories config
  const categories: { id: AssetCategory | 'all'; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'Tất cả tài sản', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'real_estate', label: 'Bất động sản', icon: <Building className="w-3.5 h-3.5" /> },
    { id: 'stock', label: 'Cổ phiếu', icon: <LineChart className="w-3.5 h-3.5" /> },
    { id: 'fund', label: 'Chứng chỉ quỹ', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'savings', label: 'Tiết kiệm', icon: <Landmark className="w-3.5 h-3.5" /> },
    { id: 'gold', label: 'Vàng', icon: <Coins className="w-3.5 h-3.5" /> },
    { id: 'other', label: 'Khác', icon: <FileText className="w-3.5 h-3.5" /> },
  ];

  // Số tài sản của từng loại (theo bộ lọc trạng thái đang chọn) – hiện trong dropdown
  const countByCategory = (cat: AssetCategory | 'all') =>
    state.assets.filter(
      (a) => (statusFilter === 'all' || a.status === statusFilter) && (cat === 'all' || a.category === cat)
    ).length;

  // Filtering
  const filteredAssets = state.assets.filter((asset) => {
    if (selectedCategory !== 'all' && asset.category !== selectedCategory) return false;
    if (statusFilter !== 'all' && asset.status !== statusFilter) return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      const matchName = asset.name.toLowerCase().includes(q);
      const matchNotes = (asset.notes || '').toLowerCase().includes(q);
      return matchName || matchNotes;
    }
    return true;
  });

  // Số liệu toàn danh mục (các thẻ ở trên cùng không phụ thuộc bộ lọc, giống tab Khoản nợ)
  const activeAssets = state.assets.filter((a) => a.status === 'active');
  const portfolioValue = activeAssets.reduce((sum, a) => sum + a.currentValue, 0);
  const portfolioCost = activeAssets.reduce((sum, a) => sum + a.initialCost, 0);
  const portfolioPnL = portfolioValue - portfolioCost;
  const portfolioPnLPct = portfolioCost > 0 ? (portfolioPnL / portfolioCost) * 100 : 0;
  const realizedFromSales = state.assets.reduce((sum, a) => sum + (a.realizedPnL || 0), 0);
  const categoryTotals = categories
    .filter((c) => c.id !== 'all')
    .map((c) => {
      const items = activeAssets.filter((a) => a.category === c.id);
      return { id: c.id as AssetCategory, label: c.label, count: items.length, value: items.reduce((sum, a) => sum + a.currentValue, 0) };
    })
    .filter((c) => c.value > 0)
    .sort((x, y) => y.value - x.value);
  const countByStatus = (st: 'all' | 'active' | 'sold') =>
    state.assets.filter((a) => st === 'all' || a.status === st).length;
  const filtersActive = selectedCategory !== 'all' || statusFilter !== 'active' || searchQuery.trim() !== '';

  // Open Revaluation Modal
  const handleOpenRevalue = (asset: Asset) => {
    setRevalueAsset(asset);
    setRevaluePrice(asset.currentValue.toString());
  };

  // Confirm Revaluation
  const handleConfirmRevalue = () => {
    if (!revalueAsset) return;
    const num = parseFloat(revaluePrice);
    if (isNaN(num) || num <= 0) return;
    onRevalueAsset(revalueAsset.id, num);
    setRevalueAsset(null);
  };

  // Open Sell Modal
  const handleOpenSell = (asset: Asset) => {
    setSellAssetTarget(asset);
    setSellValueInput(asset.currentValue.toString());
    setSellNote(`Thanh lý chốt lời tài sản ${asset.name}`);
    setSellQty(0);
    setSellFees(0);
  };

  // Confirm Sell
  const handleConfirmSell = async () => {
    if (!sellAssetTarget || !canSell) return;
    const isFull = sellRatio >= 1;
    const pledgedDebts = state.debts.filter(
      (d) => d.status === 'active' && d.collateralAssetId === sellAssetTarget.id
    );
    if (isFull && pledgedDebts.length > 0) {
      const names = pledgedDebts.map((d) => `• ${d.name} – dư nợ ${formatVND(d.remainingPrincipal)}`).join('\n');
      const ok = await confirmDialog({
        tone: 'warning',
        title: 'Tài sản đang thế chấp',
        message:
          `Tài sản này đang thế chấp cho:\n${names}\n\nBán xong bạn cần tất toán khoản vay (ngân hàng thường thu hồi nợ khi giải chấp). ` +
          `Ứng dụng KHÔNG tự tất toán nợ – hãy ghi nhận trả nợ sau đó.`,
        confirmText: 'Vẫn bán',
      });
      if (!ok) return;
    }
    onSellAsset({
      assetId: sellAssetTarget.id,
      sellQuantity: sellUnit && sellQty > 0 ? sellQty : undefined,
      proceeds: sellProceeds,
      fees: sellFees || 0,
      note: sellNote,
    });
    setSellAssetTarget(null);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* 1. TOP SUMMARY CARDS (cùng bố cục với tab Khoản nợ) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Tổng thị giá */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">
            Tổng Thị giá Tài sản
          </span>
          <div className="text-2xl font-extrabold text-slate-900 font-mono tabular-nums">
            {formatVND(portfolioValue)}
          </div>
          <span className="text-[11px] text-slate-400 block mt-1">
            Giá vốn: {formatVND(portfolioCost, { compact: true })} · {activeAssets.length} tài sản đang nắm giữ
          </span>
        </div>

        {/* Phân bổ theo loại */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-2">
              Phân bổ theo loại tài sản
            </span>
            {categoryTotals.length === 0 ? (
              <p className="text-xs text-slate-400">Chưa có tài sản đang nắm giữ.</p>
            ) : (
              <div className="space-y-1 text-xs">
                {categoryTotals.slice(0, 3).map((c) => (
                  <div key={c.id} className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-medium text-slate-700">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: CATEGORY_COLORS[c.id] }} />
                      <span>
                        {c.label} ({c.count}):
                      </span>
                    </span>
                    <span className="font-mono font-bold text-slate-900">{formatVND(c.value, { compact: true })}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 pt-2 border-t border-slate-100">
            <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
              {categoryTotals.map((c) => (
                <div
                  key={c.id}
                  style={{ width: `${portfolioValue > 0 ? (c.value / portfolioValue) * 100 : 0}%`, backgroundColor: CATEGORY_COLORS[c.id] }}
                  className="h-full"
                  title={`${c.label}: ${portfolioValue > 0 ? ((c.value / portfolioValue) * 100).toFixed(1) : 0}%`}
                />
              ))}
            </div>
            <div className="text-[10px] text-slate-400 mt-1 font-mono">
              {categoryTotals.length > 3 ? `+${categoryTotals.length - 3} loại khác` : `${categoryTotals.length} loại tài sản`}
            </div>
          </div>
        </div>

        {/* Lãi / lỗ */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block mb-1">
            Lãi / Lỗ sổ sách
          </span>
          <div
            className={`text-2xl font-extrabold font-mono tabular-nums ${
              portfolioPnL >= 0 ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {portfolioPnL >= 0 ? '+' : ''}
            {formatVND(portfolioPnL)}
          </div>
          <span className="text-[11px] text-slate-400 block mt-1">
            Tỷ suất: <strong className="text-slate-700">{formatPercent(portfolioPnLPct)}</strong> · Lãi chốt từ bán:{' '}
            <strong className="text-slate-700">
              {realizedFromSales >= 0 ? '+' : ''}
              {formatVND(realizedFromSales, { compact: true })}
            </strong>
          </span>
        </div>
      </div>

      {/* 2. FILTER & TOOLBAR (nằm dưới các thẻ, giống tab Khoản nợ) */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 lg:flex-row lg:items-end">
        <div className="lg:w-56">
          <label htmlFor="asset-category-filter" className="mb-1 block text-[11px] font-semibold text-slate-500">
            Loại tài sản
          </label>
          <select
            id="asset-category-filter"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as AssetCategory | 'all')}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.id === 'all' ? 'Tất cả loại tài sản' : cat.label} ({countByCategory(cat.id)})
              </option>
            ))}
          </select>
        </div>

        <div className="lg:w-48">
          <label htmlFor="asset-status-filter" className="mb-1 block text-[11px] font-semibold text-slate-500">
            Trạng thái
          </label>
          <select
            id="asset-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'sold')}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            <option value="active">Đang nắm giữ ({countByStatus('active')})</option>
            <option value="sold">Đã thanh lý ({countByStatus('sold')})</option>
            <option value="all">Tất cả trạng thái ({countByStatus('all')})</option>
          </select>
        </div>

        <div className="lg:w-64">
          <label htmlFor="asset-search" className="mb-1 block text-[11px] font-semibold text-slate-500">
            Tìm kiếm
          </label>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="asset-search"
              type="text"
              placeholder="Tên tài sản, mã cổ phiếu, dự án…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 lg:ml-auto lg:pb-2">
          <span className="text-[11px] text-slate-500">
            Hiển thị <strong className="text-slate-800">{filteredAssets.length}</strong>/{state.assets.length} tài sản
          </span>
          {filtersActive && (
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('all');
                setStatusFilter('active');
                setSearchQuery('');
              }}
              className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              Xóa lọc
            </button>
          )}
        </div>
      </div>

      {/* Assets Table / List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {filteredAssets.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-xs">
            <Layers className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p>Không tìm thấy tài sản nào phù hợp với bộ lọc hiện tại.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold">
                  <th className="py-3 px-4">Tài sản / Thông số riêng</th>
                  <th className="py-3 px-3">Loại hình</th>
                  <th className="py-3 px-4 text-right">Giá vốn</th>
                  <th className="py-3 px-4 text-right">Thị giá hiện tại</th>
                  <th className="py-3 px-4 text-right">Lãi/Lỗ sổ sách</th>
                  <th className="py-3 px-3 text-right">Lãi chốt thực tế</th>
                  <th className="py-3 px-4 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAssets.map((asset) => {
                  const pnl = asset.currentValue - asset.initialCost;
                  const pnlPct = asset.initialCost > 0 ? (pnl / asset.initialCost) * 100 : 0;
                  const isSold = asset.status === 'sold';

                  return (
                    <tr key={asset.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Name & Polymorphic Specifics */}
                      <td className="py-3 px-4 max-w-xs">
                        <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                          <span>{asset.name}</span>
                          {isSold && (
                            <span className="text-[10px] text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.2 rounded">
                              Đã bán
                            </span>
                          )}
                        </div>
                        {/* Polymorphic metadata rendering */}
                        <div className="mt-1 text-[11px] text-slate-500 space-y-0.5">
                          {asset.category === 'stock' && (
                            <div>
                              <span className="font-semibold text-slate-700">
                                {(asset.metadata as StockMetadata).symbol}
                              </span>{' '}
                              · Sàn {(asset.metadata as StockMetadata).exchange} · SL:{' '}
                              <span className="font-mono">
                                {(asset.metadata as StockMetadata).quantity.toLocaleString()} CP
                              </span>{' '}
                              · Vốn:{' '}
                              <span className="font-mono">
                                {formatVND((asset.metadata as StockMetadata).avgCostPrice)}
                              </span>
                            </div>
                          )}

                          {asset.category === 'real_estate' && (
                            <div>
                              <span>{(asset.metadata as RealEstateMetadata).address}</span> ·{' '}
                              <span>{(asset.metadata as RealEstateMetadata).areaM2} m²</span> · Thuê:{' '}
                              <span className="font-mono text-emerald-600 font-semibold">
                                {formatVND((asset.metadata as RealEstateMetadata).monthlyRentalIncome)}
                                /tháng
                              </span>
                              {(asset.metadata as RealEstateMetadata).rentalDayOfMonth ? (
                                <span> · nhận ngày {(asset.metadata as RealEstateMetadata).rentalDayOfMonth}</span>
                              ) : null}
                            </div>
                          )}

                          {asset.category === 'fund' && (
                            <div>
                              <span>Quỹ {(asset.metadata as FundMetadata).fundCode}</span> · SL:{' '}
                              <span className="font-mono">
                                {(asset.metadata as FundMetadata).units.toLocaleString()} CCQ
                              </span>{' '}
                              · NAV vốn: {formatVND((asset.metadata as FundMetadata).avgNav)}
                            </div>
                          )}

                          {asset.category === 'savings' && (
                            <div>
                              <span>{(asset.metadata as SavingsMetadata).bankName}</span> · Lãi suất:{' '}
                              <span className="font-mono font-semibold">
                                {(asset.metadata as SavingsMetadata).annualInterestRate}%/năm
                              </span>{' '}
                              · Đáo hạn: {(asset.metadata as SavingsMetadata).maturityDate}
                            </div>
                          )}

                          {asset.category === 'gold' && (
                            <div>
                              <span>{(asset.metadata as GoldMetadata).goldType}</span> · SL:{' '}
                              <span className="font-mono">
                                {(asset.metadata as GoldMetadata).quantityChi} chỉ
                              </span>{' '}
                              · Vốn: {formatVND((asset.metadata as GoldMetadata).costPerChi)}/chỉ
                            </div>
                          )}

                          {asset.category === 'other' &&
                            (() => {
                              const rec = getRecurringIncome(asset);
                              return rec ? (
                                <div>
                                  Thu nhập:{' '}
                                  <span className="font-mono text-emerald-600 font-semibold">
                                    {formatVND(rec.amount)}/tháng
                                  </span>{' '}
                                  · nhận ngày {rec.day}
                                </div>
                              ) : null;
                            })()}

                          {asset.notes && (
                            <div className="text-slate-400 italic truncate max-w-sm">
                              {asset.notes}
                            </div>
                          )}

                          {/* Linked Debt Badge */}
                          {(() => {
                            const linked = state.debts.find(
                              (d) => d.id === asset.linkedDebtId || d.collateralAssetId === asset.id
                            );
                            if (!linked) return null;
                            return (
                              <div className="mt-1.5 flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-[11px] font-medium w-fit">
                                {linked.securityType === 'unsecured' ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                    <CreditCard className="w-3 h-3 text-amber-600 shrink-0" />
                                    Vay tín chấp
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-50 text-sky-800 border border-sky-200">
                                    <ShieldCheck className="w-3 h-3 text-sky-600 shrink-0" />
                                    Thế chấp
                                  </span>
                                )}
                                <span className="text-slate-700">
                                  {linked.lender} ({linked.name}) · Dư nợ:{' '}
                                  <strong className="font-mono text-rose-600">
                                    {formatVND(linked.remainingPrincipal, { compact: true })}
                                  </strong>{' '}
                                  · Lãi {linked.annualInterestRate}%
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                      </td>

                      {/* Category Label */}
                      <td className="py-3 px-3 text-slate-600">
                        {asset.category === 'real_estate' && 'Bất động sản'}
                        {asset.category === 'stock' && 'Cổ phiếu'}
                        {asset.category === 'fund' && 'Chứng chỉ quỹ'}
                        {asset.category === 'savings' && 'Tiết kiệm'}
                        {asset.category === 'gold' && 'Vàng'}
                        {asset.category === 'other' && 'Khác'}
                      </td>

                      {/* Cost */}
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-700 tabular-nums">
                        {formatVND(asset.initialCost)}
                      </td>

                      {/* Market Value */}
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                        {isSold ? '0 ₫' : formatVND(asset.currentValue)}
                        <div className="text-[10px] text-slate-400 font-normal">
                          {asset.lastValuationDate}
                        </div>
                      </td>

                      {/* Book PnL */}
                      <td className="py-3 px-4 text-right tabular-nums">
                        {isSold ? (
                          <span className="text-slate-400 font-mono">-</span>
                        ) : (
                          <>
                            <div
                              className={`font-mono font-bold ${
                                pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'
                              }`}
                            >
                              {pnl >= 0 ? '+' : ''}
                              {formatVND(pnl)}
                            </div>
                            <div
                              className={`text-[11px] font-mono ${
                                pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'
                              }`}
                            >
                              {formatPercent(pnlPct)}
                            </div>
                          </>
                        )}
                      </td>

                      {/* Realized PnL */}
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-800 tabular-nums">
                        {asset.realizedPnL > 0 ? (
                          <span className="text-emerald-700">
                            +{formatVND(asset.realizedPnL)}
                          </span>
                        ) : asset.realizedPnL < 0 ? (
                          <span className="text-rose-700">{formatVND(asset.realizedPnL)}</span>
                        ) : (
                          <span className="text-slate-400">0 ₫</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {!isSold && (
                            <>
                              {(asset.category === 'real_estate' || asset.category === 'other') && (
                                <button
                                  onClick={() => openIncomeEdit(asset)}
                                  title="Thu nhập hàng tháng (cho thuê…) – hiển thị trên Lịch"
                                  className="p-1.5 text-sky-600 hover:text-sky-700 hover:bg-sky-50 rounded transition-colors"
                                >
                                  <CalendarClock className="w-3.5 h-3.5" />
                                </button>
                              )}

                              <button
                                onClick={() => handleOpenRevalue(asset)}
                                title="Cập nhật định giá thị trường mới"
                                className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => handleOpenSell(asset)}
                                title="Bán / Chốt lời về ví"
                                className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
                              >
                                <DollarSign className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}

                          <button
                            onClick={async () => {
                              const ok = await confirmDialog({
                                tone: 'danger',
                                title: `Xóa "${asset.name}" khỏi danh mục?`,
                                message:
                                  'Đây là xóa dữ liệu nhập nhầm: tiền ví, giao dịch và khoản nợ liên quan KHÔNG bị đảo ngược.\n\nNếu đã bán tài sản, hãy dùng nút "Bán / Chốt lời" để ghi nhận đúng lãi lỗ.',
                                confirmText: 'Xóa tài sản',
                              });
                              if (ok) onDeleteAsset(asset.id);
                            }}
                            title="Xóa tài sản"
                            className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL 1: REVALUATION */}
      {revalueAsset && (
        <Modal
          title="Cập nhật Định giá Thị trường"
          subtitle={`${revalueAsset.name} (Giá vốn: ${formatVND(revalueAsset.initialCost)})`}
          onClose={() => setRevalueAsset(null)}
        >
          <ModalBody>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Tổng giá trị thị trường mới (VND)
              </label>
              <CurrencyInput
                value={revalueNum}
                onChange={(val) => setRevaluePrice(val.toString())}
                invalid={revalueNum <= 0}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
              {revalueNum > 0 && revalueAsset.currentValue > 0 ? (
                <p className="mt-1.5 text-[11px] font-mono text-slate-500">
                  So với hiện tại ({formatVND(revalueAsset.currentValue)}):{' '}
                  <span className={revalueNum >= revalueAsset.currentValue ? 'text-emerald-600' : 'text-rose-600'}>
                    {formatPercent(((revalueNum - revalueAsset.currentValue) / revalueAsset.currentValue) * 100)}
                  </span>
                </p>
              ) : (
                <FieldError>Giá trị thị trường phải lớn hơn 0.</FieldError>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <button
              type="button"
              onClick={() => setRevalueAsset(null)}
              className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors font-medium"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleConfirmRevalue}
              disabled={revalueNum <= 0}
              className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-slate-900"
            >
              Lưu định giá mới
            </button>
          </ModalFooter>
        </Modal>
      )}

      {/* MODAL 2: SELL / REALIZE PnL */}
      {sellAssetTarget && (
        <Modal
          title="Thanh lý / Bán Chốt Lời"
          subtitle={sellAssetTarget.name}
          onClose={() => setSellAssetTarget(null)}
        >
          <ModalBody>
            {sellUnit && (
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Số lượng bán ({sellUnit.label}) – tối đa {sellTotalUnits.toLocaleString('vi-VN')}; để trống = bán hết
                </label>
                <CurrencyInput
                  allowDecimal={sellAssetTarget.category !== 'stock'}
                  value={sellQty}
                  invalid={!!sellQtyError}
                  onChange={(q) => {
                    setSellQty(q);
                    const r = q > 0 && sellTotalUnits > 0 ? Math.min(1, q / sellTotalUnits) : 1;
                    setSellValueInput(Math.round(sellAssetTarget.currentValue * r).toString());
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
                <FieldError>{sellQtyError}</FieldError>
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Tổng tiền bán (VND, trước phí/thuế)
              </label>
              <CurrencyInput
                value={sellProceeds}
                invalid={sellProceeds <= 0}
                onChange={(val) => setSellValueInput(val.toString())}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
              {sellProceeds <= 0 && <FieldError>Nhập số tiền bán lớn hơn 0.</FieldError>}
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Phí môi giới + thuế (VND)
              </label>
              <div className="flex items-center gap-2">
                <CurrencyInput
                  value={sellFees}
                  onChange={setSellFees}
                  invalid={!!sellFeesError}
                  className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
                {(sellAssetTarget.category === 'stock' || sellAssetTarget.category === 'fund') && (
                  <button
                    type="button"
                    onClick={() => setSellFees(Math.round(sellProceeds * 0.001))}
                    className="px-2.5 py-2 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
                    title="Thuế TNCN chuyển nhượng chứng khoán 0,1% giá trị bán – cộng thêm phí môi giới của công ty chứng khoán"
                  >
                    Điền thuế 0,1%
                  </button>
                )}
              </div>
              <FieldError>{sellFeesError}</FieldError>
              <div className="flex items-center justify-between text-[11px] mt-2 font-mono">
                <span className="text-slate-500">
                  Giá vốn phần bán: {formatVND(Math.round(sellAssetTarget.initialCost * sellRatio))}
                </span>
                <span
                  className={`font-bold ${
                    sellProceeds - sellFees - sellAssetTarget.initialCost * sellRatio >= 0
                      ? 'text-emerald-600'
                      : 'text-rose-600'
                  }`}
                >
                  Lãi chốt thực tế:{' '}
                  {formatVND(Math.round(sellProceeds - sellFees - sellAssetTarget.initialCost * sellRatio))}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Tiền thực vào ví: <strong>{formatVND(Math.max(0, sellProceeds - sellFees))}</strong>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Ghi chú bán
              </label>
              <input
                type="text"
                value={sellNote}
                onChange={(e) => setSellNote(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <button
              type="button"
              onClick={() => setSellAssetTarget(null)}
              className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors font-medium"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleConfirmSell}
              disabled={!canSell}
              className="px-4 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-emerald-600"
            >
              Xác nhận Bán & Nhập Ví
            </button>
          </ModalFooter>
        </Modal>
      )}

      {/* MODAL: THU NHẬP ĐỊNH KỲ HÀNG THÁNG */}
      {incomeEditAsset && (
        <Modal
          title="Thu nhập hàng tháng"
          subtitle={incomeEditAsset.name}
          onClose={() => setIncomeEditAsset(null)}
        >
          <ModalBody>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Số tiền nhận mỗi tháng (VND) – để 0 nếu không có
              </label>
              <CurrencyInput
                value={incomeEditAmount}
                onChange={setIncomeEditAmount}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Ngày nhận hàng tháng (1–31)</label>
              <input
                type="number"
                min="1"
                max="31"
                disabled={incomeEditAmount <= 0}
                value={incomeEditDay || ''}
                aria-invalid={incomeEditDayError ? true : undefined}
                onChange={(e) => setIncomeEditDay(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg font-mono disabled:bg-slate-50 disabled:text-slate-400"
              />
              <FieldError>{incomeEditDayError}</FieldError>
            </div>
          </ModalBody>
          <ModalFooter>
            <button
              type="button"
              onClick={() => setIncomeEditAsset(null)}
              className="px-3.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors font-medium"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={saveIncomeEdit}
              disabled={!!incomeEditDayError}
              className="px-4 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-slate-900"
            >
              Lưu
            </button>
          </ModalFooter>
        </Modal>
      )}

      {/* MODAL 3: ADD NEW ASSET */}
      {isAddModalOpen && (
        <AddAssetModal
          availableCash={state.wallet.availableCash}
          onClose={() => setIsAddModalOpen(false)}
          onAdd={(asset, deduct, linkedDebt, downPayment) => {
            const ok = onAddAsset(asset, deduct, linkedDebt, downPayment);
            if (ok !== false) setIsAddModalOpen(false);
          }}
        />
      )}
    </div>
  );
};

interface AddAssetModalProps {
  availableCash: number;
  onClose: () => void;
  onAdd: (
    asset: Asset,
    deductFromWallet: boolean,
    linkedDebt?: Debt,
    downPaymentAmount?: number
  ) => boolean | void;
}

const AddAssetModal: React.FC<AddAssetModalProps> = ({ availableCash, onClose, onAdd }) => {
  // Funding Mode: 'cash' = Mua 100% tiền khả dụng, 'loan' = Mua có khoản vay
  const [fundingMode, setFundingMode] = useState<'cash' | 'loan'>('cash');

  // Common Asset Fields
  const [name, setName] = useState('');
  const [category, setCategory] = useState<AssetCategory>('real_estate');
  const [purchaseDate, setPurchaseDate] = useState(todayLocalStr());
  const [notes, setNotes] = useState('');

  // Cash Mode Amounts
  const [cashCost, setCashCost] = useState<number>(0);
  const [deductFromWallet, setDeductFromWallet] = useState<boolean>(true);

  // Loan Mode Amounts & Attributes
  const [totalAssetPrice, setTotalAssetPrice] = useState<number>(0);
  const [downPayment, setDownPayment] = useState<number>(0);
  const [loanPrincipal, setLoanPrincipal] = useState<number>(0);
  const [loanName, setLoanName] = useState<string>('');
  const [loanLender, setLoanLender] = useState<string>('');
  const [loanCategory, setLoanCategory] = useState<DebtCategory>('mortgage');
  const [loanSecurityType, setLoanSecurityType] = useState<DebtSecurityType>('secured');
  const [loanRate, setLoanRate] = useState<number>(9.5);
  const [loanRateType, setLoanRateType] = useState<InterestRateType>('floating');
  const [loanBaseRate, setLoanBaseRate] = useState<number>(6.2);
  const [loanMargin, setLoanMargin] = useState<number>(3.3);
  const [loanTenorMonths, setLoanTenorMonths] = useState<number>(240);
  const [loanPaymentDay, setLoanPaymentDay] = useState<number>(15);
  const [loanMethod, setLoanMethod] = useState<PaymentMethod>('declining_balance');

  // Polymorphic fields
  // Stock
  const [stockSymbol, setStockSymbol] = useState('');
  const [stockExchange, setStockExchange] = useState<'HOSE' | 'HNX' | 'UPCOM'>('HOSE');
  const [stockQty, setStockQty] = useState<number>(0);
  const [stockAvgPrice, setStockAvgPrice] = useState<number>(0);

  // Real estate
  const [reAddress, setReAddress] = useState('');
  const [reArea, setReArea] = useState<number>(0);
  const [reRental, setReRental] = useState<number>(0);
  const [reType, setReType] = useState<'apartment' | 'land' | 'townhouse' | 'villa'>('apartment');
  const [rentDay, setRentDay] = useState<number>(1);

  // Fund
  const [fundCode, setFundCode] = useState('');
  const [fundUnits, setFundUnits] = useState<number>(0);
  const [fundNav, setFundNav] = useState<number>(0);

  // Savings
  const [bankName, setBankName] = useState('');
  const [termMonths, setTermMonths] = useState<number>(12);
  const [rate, setRate] = useState<number>(5.5);
  const [maturityDate, setMaturityDate] = useState('');

  // Gold
  const [goldType, setGoldType] = useState<'SJC' | 'nhan_9999' | 'trang_suc'>('SJC');
  const [goldChi, setGoldChi] = useState<number>(0);
  const [goldCostPerChi, setGoldCostPerChi] = useState<number>(0);

  // Auto-sync loan principal when total price or down payment changes
  const handleTotalPriceChange = (total: number) => {
    setTotalAssetPrice(total);
    setLoanPrincipal(Math.max(0, total - downPayment));
  };

  const handleDownPaymentChange = (dp: number) => {
    setDownPayment(dp);
    setLoanPrincipal(Math.max(0, totalAssetPrice - dp));
  };

  // Tự tính tổng vốn = số lượng × đơn giá (CP, CCQ, vàng)
  const applyAutoTotal = (total: number) => {
    if (total <= 0) return;
    if (fundingMode === 'cash') {
      setCashCost(total);
    } else {
      setTotalAssetPrice(total);
      setLoanPrincipal(Math.max(0, total - downPayment));
    }
  };
  const handleFundUnitsChange = (u: number) => { setFundUnits(u); applyAutoTotal(Math.round(u * fundNav)); };
  const handleFundNavChange = (n: number) => { setFundNav(n); applyAutoTotal(Math.round(fundUnits * n)); };
  const handleGoldChiChange = (c: number) => { setGoldChi(c); applyAutoTotal(Math.round(c * goldCostPerChi)); };
  const handleGoldCostChange = (c: number) => { setGoldCostPerChi(c); applyAutoTotal(Math.round(goldChi * c)); };

  // Auto-sync stock cost
  const handleStockQtyChange = (qty: number) => {
    setStockQty(qty);
    if (qty > 0 && stockAvgPrice > 0) {
      const total = qty * stockAvgPrice;
      if (fundingMode === 'cash') {
        setCashCost(total);
      } else {
        setTotalAssetPrice(total);
        setLoanPrincipal(Math.max(0, total - downPayment));
      }
    }
  };

  const handleStockPriceChange = (price: number) => {
    setStockAvgPrice(price);
    if (price > 0 && stockQty > 0) {
      const total = stockQty * price;
      if (fundingMode === 'cash') {
        setCashCost(total);
      } else {
        setTotalAssetPrice(total);
        setLoanPrincipal(Math.max(0, total - downPayment));
      }
    }
  };

  // Calculate live loan stats
  const effectiveLoanRate = loanRateType === 'floating' ? loanBaseRate + loanMargin : loanRate;
  const ltvPercent = totalAssetPrice > 0 ? (loanPrincipal / totalAssetPrice) * 100 : 0;
  const equityPercent = totalAssetPrice > 0 ? (downPayment / totalAssetPrice) * 100 : 0;

  // Monthly estimate for period 1
  const firstMonthMonthlyRate = effectiveLoanRate / 100 / 12;
  const firstMonthInterest = Math.round(loanPrincipal * firstMonthMonthlyRate);
  const firstMonthPrincipal =
    loanMethod === 'declining_balance'
      ? loanTenorMonths > 0
        ? Math.round(loanPrincipal / loanTenorMonths)
        : 0
      : loanMethod === 'equal_payment' && firstMonthMonthlyRate > 0
      ? Math.round(
          (loanPrincipal * (firstMonthMonthlyRate * Math.pow(1 + firstMonthMonthlyRate, loanTenorMonths))) /
            (Math.pow(1 + firstMonthMonthlyRate, loanTenorMonths) - 1)
        ) - firstMonthInterest
      : Math.round(loanPrincipal / (loanTenorMonths || 1));
  const firstMonthTotal = firstMonthPrincipal + firstMonthInterest;

  // ---- Ràng buộc nhập liệu: sai thì khóa nút Lưu + báo ngay tại chỗ ----
  const missing: string[] = [];
  if (!name.trim()) missing.push('Nhập tên tài sản.');
  if (category === 'stock' && (stockQty <= 0 || stockAvgPrice <= 0)) missing.push('Nhập số lượng và giá vốn cổ phiếu.');
  if (category === 'fund' && (fundUnits <= 0 || fundNav <= 0)) missing.push('Nhập số lượng CCQ và NAV mua.');
  if (category === 'gold' && (goldChi <= 0 || goldCostPerChi <= 0)) missing.push('Nhập số chỉ và giá vốn mỗi chỉ.');
  if (category === 'savings' && !maturityDate) missing.push('Chọn ngày đáo hạn sổ tiết kiệm.');
  if (fundingMode === 'cash' && cashCost <= 0) missing.push('Nhập tổng giá vốn đầu tư.');
  if (fundingMode === 'loan') {
    if (totalAssetPrice <= 0) missing.push('Nhập tổng giá trị tài sản.');
    if (!loanLender.trim()) missing.push('Nhập ngân hàng / tổ chức cho vay.');
  }

  const savingsError =
    category !== 'savings'
      ? ''
      : maturityDate && maturityDate <= purchaseDate
      ? 'Ngày đáo hạn phải sau ngày gửi.'
      : rate < 0 || rate > MAX_RATE
      ? `Lãi suất tiết kiệm phải trong khoảng 0% – ${MAX_RATE}%/năm.`
      : '';

  const cashWalletError =
    fundingMode === 'cash' && deductFromWallet && cashCost > availableCash
      ? `Giá vốn ${formatVND(cashCost)} vượt tiền khả dụng trong ví (${formatVND(availableCash)}). Nạp thêm tiền vào ví hoặc bỏ chọn trích tiền từ ví.`
      : '';

  const loanErrors: string[] = [];
  if (fundingMode === 'loan') {
    if (totalAssetPrice > 0 && loanPrincipal <= 0)
      loanErrors.push('Số tiền vay phải lớn hơn 0 – giảm vốn tự có hoặc nhập số tiền vay.');
    if (downPayment > totalAssetPrice) loanErrors.push('Vốn tự có không được lớn hơn tổng giá trị tài sản.');
    if (loanPrincipal > totalAssetPrice) loanErrors.push('Số tiền vay không được lớn hơn tổng giá trị tài sản.');
    else if (downPayment <= totalAssetPrice && downPayment + loanPrincipal > totalAssetPrice)
      loanErrors.push(
        `Vốn tự có + tiền vay (${formatVND(downPayment + loanPrincipal)}) vượt tổng giá trị tài sản (${formatVND(totalAssetPrice)}).`
      );
    if (effectiveLoanRate < 0 || effectiveLoanRate > MAX_RATE)
      loanErrors.push(`Lãi suất phải trong khoảng 0% – ${MAX_RATE}%/năm.`);
    if (loanTenorMonths < 1 || loanTenorMonths > MAX_TENOR_MONTHS)
      loanErrors.push(`Thời hạn vay phải từ 1 đến ${MAX_TENOR_MONTHS} tháng.`);
    if (loanPaymentDay < 1 || loanPaymentDay > 31) loanErrors.push('Ngày trả hàng tháng phải từ 1 đến 31.');
  }
  const loanWalletError =
    fundingMode === 'loan' && deductFromWallet && downPayment > availableCash
      ? `Vốn tự có ${formatVND(downPayment)} vượt tiền khả dụng trong ví (${formatVND(availableCash)}). Nạp thêm tiền vào ví hoặc bỏ chọn trích tiền từ ví.`
      : '';
  const downInvalid = downPayment > totalAssetPrice || downPayment + loanPrincipal > totalAssetPrice || !!loanWalletError;
  const loanInvalid = loanPrincipal > totalAssetPrice || downPayment + loanPrincipal > totalAssetPrice;

  const rentError =
    (category === 'real_estate' || category === 'other') && reRental > 0 && (rentDay < 1 || rentDay > 31)
      ? 'Ngày nhận tiền hàng tháng phải từ 1 đến 31.'
      : '';

  const errors = [savingsError, rentError, cashWalletError, ...loanErrors, loanWalletError].filter(Boolean);
  const hasProblems = errors.length > 0 || missing.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasProblems) return;

    const assetId = `asset-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const initialCost = fundingMode === 'cash' ? cashCost : totalAssetPrice;
    // Lúc mua, thị giá = giá vốn; thị giá mới được cập nhật sau này ở nút "Cập nhật định giá" hoặc khi bán.
    const currentValue = initialCost;

    let metadata: any = {};
    if (category === 'stock') {
      metadata = {
        symbol: stockSymbol.toUpperCase(),
        exchange: stockExchange,
        quantity: stockQty,
        avgCostPrice: stockAvgPrice,
        currentPrice: stockAvgPrice,
        totalDividendsReceived: 0,
      } as StockMetadata;
    } else if (category === 'real_estate') {
      metadata = {
        address: reAddress,
        propertyType: reType,
        areaM2: reArea,
        purchasePrice: initialCost,
        estimatedMarketPrice: currentValue,
        monthlyRentalIncome: reRental,
        rentalDayOfMonth: reRental > 0 ? rentDay : undefined,
        legalStatus: 'pink_book',
      } as RealEstateMetadata;
    } else if (category === 'fund') {
      metadata = {
        fundCode: fundCode.toUpperCase(),
        fundType: 'balanced',
        units: fundUnits,
        avgNav: fundNav,
        currentNav: fundNav,
      } as FundMetadata;
    } else if (category === 'savings') {
      metadata = {
        bankName,
        depositAmount: initialCost,
        termMonths,
        annualInterestRate: rate,
        startDate: purchaseDate,
        maturityDate: maturityDate || purchaseDate,
        rolloverOption: 'principal_and_interest',
      } as SavingsMetadata;
    } else if (category === 'gold') {
      metadata = {
        goldType,
        quantityChi: goldChi,
        costPerChi: goldCostPerChi,
        currentPerChi: goldCostPerChi,
      } as GoldMetadata;
    } else {
      metadata = {
        itemType: 'Tài sản khác',
        details: notes,
        monthlyRentalIncome: reRental > 0 ? reRental : undefined,
        rentalDayOfMonth: reRental > 0 ? rentDay : undefined,
      };
    }

    const debtId = `debt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const newAsset: Asset = {
      id: assetId,
      name: name || `${category.toUpperCase()}`,
      category,
      initialCost,
      currentValue,
      purchaseDate,
      status: 'active',
      notes,
      realizedPnL: 0,
      lastValuationDate: purchaseDate,
      linkedDebtId: fundingMode === 'loan' ? debtId : undefined,
      metadata,
    };

    if (fundingMode === 'cash') {
      onAdd(newAsset, deductFromWallet);
    } else {
      // Build linked debt
      const schedule = generateAmortizationSchedule(
        loanPrincipal,
        effectiveLoanRate,
        loanTenorMonths,
        purchaseDate,
        loanPaymentDay,
        loanMethod
      );

      const rawDebt: Debt = {
        id: debtId,
        name: loanName || `Khoản vay mua ${newAsset.name}`,
        lender: loanLender,
        category: loanCategory,
        securityType: loanSecurityType,
        principalAmount: loanPrincipal,
        remainingPrincipal: loanPrincipal,
        annualInterestRate: effectiveLoanRate,
        rateType: loanRateType,
        baseRate: loanRateType === 'floating' ? loanBaseRate : undefined,
        floatingMargin: loanRateType === 'floating' ? loanMargin : undefined,
        tenorMonths: loanTenorMonths,
        startDate: purchaseDate,
        paymentDayOfMonth: loanPaymentDay,
        method: loanMethod,
        collateralAssetId: loanSecurityType === 'secured' ? newAsset.id : undefined,
        notes:
          loanSecurityType === 'secured'
            ? `Khoản vay thế chấp trực tiếp bằng tài sản ${newAsset.name}.`
            : `Khoản vay tín chấp (không thế chấp tài sản) để đầu tư ${newAsset.name}.`,
        status: 'active',
        schedule,
      };
      // Mua từ quá khứ: các kỳ đã đến hạn trước hôm nay được coi là đã trả (lịch sử), dư nợ cập nhật tương ứng
      const newDebt = applyHistoricalPayments(rawDebt);

      onAdd(newAsset, deductFromWallet, newDebt, downPayment);
    }
  };

  return (
    <Modal
      title="Thêm Tài Sản Mới"
      size="xl"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <ModalBody>
          {/* 1. FUNDING MODE TABS */}
          <div className="grid grid-cols-2 gap-3 p-1.5 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setFundingMode('cash')}
              className={`py-2.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                fundingMode === 'cash'
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Wallet className={`w-4 h-4 ${fundingMode === 'cash' ? 'text-emerald-600' : 'text-slate-400'}`} />
              <span>Mua bằng tiền khả dụng (100% Vốn tự có)</span>
            </button>

            <button
              type="button"
              onClick={() => setFundingMode('loan')}
              className={`py-2.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                fundingMode === 'loan'
                  ? 'bg-white text-sky-950 shadow-sm border border-sky-300'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CreditCard className={`w-4 h-4 ${fundingMode === 'loan' ? 'text-sky-600' : 'text-slate-400'}`} />
              <span>Mua theo khoản vay (Liên kết nợ đòn bẩy)</span>
            </button>
          </div>

          {/* Category Picker */}
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1.5">
              Phân loại danh mục tài sản
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[
                { id: 'real_estate', label: 'Bất động sản' },
                { id: 'stock', label: 'Cổ phiếu' },
                { id: 'fund', label: 'Chứng chỉ quỹ' },
                { id: 'savings', label: 'Tiết kiệm / TP' },
                { id: 'gold', label: 'Vàng' },
                { id: 'other', label: 'Khác' },
              ].map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => {
                    setCategory(item.id as AssetCategory);
                    if (item.id === 'real_estate') setLoanCategory('mortgage');
                    else if (item.id === 'other') setLoanCategory('car_loan');
                  }}
                  className={`py-2 px-2 text-xs font-semibold rounded-lg border text-center transition-colors ${
                    category === item.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Name & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Tên tài sản
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Ngày mua</label>
              <input
                type="date"
                required
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>
          </div>

          {/* DYNAMIC POLYMORPHIC ATTRIBUTES */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
              Thông số chi tiết {category === 'real_estate' ? 'Bất động sản' : category === 'stock' ? 'Cổ phiếu' : category === 'fund' ? 'Chứng chỉ quỹ' : category === 'savings' ? 'Tiết kiệm' : category === 'gold' ? 'Vàng' : 'Tài sản'}
            </span>

            {/* Stock fields */}
            {category === 'stock' && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Mã Cổ phiếu</label>
                  <input
                    type="text"
                    value={stockSymbol}
                    onChange={(e) => setStockSymbol(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded uppercase font-bold"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Sàn giao dịch</label>
                  <select
                    value={stockExchange}
                    onChange={(e) => setStockExchange(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                  >
                    <option value="HOSE">HOSE</option>
                    <option value="HNX">HNX</option>
                    <option value="UPCOM">UPCOM</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Số lượng cổ phiếu</label>
                  <CurrencyInput
                    value={stockQty}
                    onChange={handleStockQtyChange}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Giá vốn (đ/CP)</label>
                  <CurrencyInput
                    value={stockAvgPrice}
                    onChange={handleStockPriceChange}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                  />
                </div>
              </div>
            )}

            {/* Real Estate fields */}
            {category === 'real_estate' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Phân loại BĐS</label>
                    <select
                      value={reType}
                      onChange={(e) => setReType(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    >
                      <option value="apartment">Căn hộ chung cư</option>
                      <option value="land">Đất nền</option>
                      <option value="townhouse">Nhà phố</option>
                      <option value="villa">Biệt thự</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Diện tích (m²)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={reArea || ''}
                      min="0"
                      onChange={(e) => setReArea(parseFloat(e.target.value) || 0)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Địa chỉ / Dự án / Khu vực</label>
                  <input
                    type="text"
                    value={reAddress}
                    onChange={(e) => setReAddress(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-slate-600 block mb-1">
                      Thu nhập cho thuê hàng tháng (nếu có, VND)
                    </label>
                    <CurrencyInput
                      value={reRental}
                      onChange={setReRental}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Ngày nhận (1–31)</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      disabled={reRental <= 0}
                      value={rentDay || ''}
                      onChange={(e) => setRentDay(parseInt(e.target.value) || 0)}
                      aria-invalid={rentError ? true : undefined}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded font-mono disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>
                </div>
                <FieldError>{rentError}</FieldError>
              </div>
            )}

            {/* Fund fields */}
            {category === 'fund' && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Tên/Mã Quỹ</label>
                  <input
                    type="text"
                    value={fundCode}
                    onChange={(e) => setFundCode(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded uppercase font-bold"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Số lượng CCQ</label>
                  <CurrencyInput
                    allowDecimal
                    value={fundUnits}
                    onChange={handleFundUnitsChange}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1">NAV mua TB (VND)</label>
                  <CurrencyInput
                    value={fundNav}
                    onChange={handleFundNavChange}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                  />
                </div>
              </div>
            )}

            {/* Savings fields */}
            {category === 'savings' && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Ngân hàng gửi</label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Lãi suất (%/năm)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={rate}
                    min="0"
                    max={MAX_RATE}
                    onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Ngày đáo hạn</label>
                  <input
                    type="date"
                    value={maturityDate}
                    min={purchaseDate}
                    onChange={(e) => setMaturityDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                  />
                </div>
              </div>
            )}
            {category === 'savings' && <FieldError>{savingsError}</FieldError>}

            {/* Other fields: thu nhập định kỳ (vd. cho thuê xe) */}
            {category === 'other' && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-slate-600 block mb-1">
                      Thu nhập hàng tháng nếu có (vd. cho thuê xe, VND)
                    </label>
                    <CurrencyInput
                      value={reRental}
                      onChange={setReRental}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Ngày nhận (1–31)</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      disabled={reRental <= 0}
                      value={rentDay || ''}
                      onChange={(e) => setRentDay(parseInt(e.target.value) || 0)}
                      aria-invalid={rentError ? true : undefined}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded font-mono disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  </div>
                </div>
                <FieldError>{rentError}</FieldError>
              </div>
            )}

            {/* Gold fields */}
            {category === 'gold' && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Loại vàng</label>
                  <select
                    value={goldType}
                    onChange={(e) => setGoldType(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                  >
                    <option value="SJC">Vàng miếng SJC</option>
                    <option value="nhan_9999">Nhẫn tròn 9999</option>
                    <option value="trang_suc">Vàng trang sức</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Số chỉ</label>
                  <CurrencyInput
                    allowDecimal
                    value={goldChi}
                    onChange={handleGoldChiChange}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600 block mb-1">Giá vốn mỗi chỉ (VND)</label>
                  <CurrencyInput
                    value={goldCostPerChi}
                    onChange={handleGoldCostChange}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
                  />
                </div>
              </div>
            )}
          </div>

          {/* TAB 1: CASH PURCHASE AMOUNTS */}
          {fundingMode === 'cash' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Tổng giá vốn đầu tư (VND) *
                </label>
                <CurrencyInput
                  required
                  value={cashCost}
                  onChange={setCashCost}
                  invalid={!!cashWalletError}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              {/* Deduct from wallet checkbox */}
              <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-emerald-950 block">Trích tiền thanh toán từ Ví Đầu Tư?</span>
                  <span className="text-emerald-700 text-[11px]">
                    Số dư ví khả dụng hiện tại: <strong>{formatVND(availableCash)}</strong>
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={deductFromWallet}
                  onChange={(e) => setDeductFromWallet(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded border-emerald-300 focus:ring-emerald-500"
                />
              </div>
              <FieldError>{cashWalletError}</FieldError>
            </div>
          )}

          {/* TAB 2: LOAN PURCHASE AMOUNTS & LOAN ATTRIBUTES */}
          {fundingMode === 'loan' && (
            <div className="space-y-4">
              {/* Asset Valuation & Down Payment Breakdown */}
              <div className="p-4 bg-sky-50/60 rounded-xl border border-sky-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-sky-950 uppercase tracking-wider">
                    Cơ cấu nguồn vốn (Vốn tự có & Nợ vay)
                  </span>
                  <span className="text-xs font-mono font-bold text-sky-800 bg-sky-100 px-2 py-0.5 rounded">
                    LTV: {ltvPercent.toFixed(1)}% · Vốn tự có: {equityPercent.toFixed(1)}%
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-sky-950 block mb-1">
                      Tổng giá trị tài sản (VND) *
                    </label>
                    <CurrencyInput
                      required
                      value={totalAssetPrice}
                      onChange={handleTotalPriceChange}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-sky-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-600"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-sky-950 block mb-1">
                      Vốn tự có thanh toán ngay (VND) *
                    </label>
                    <CurrencyInput
                      required
                      value={downPayment}
                      onChange={handleDownPaymentChange}
                      invalid={downInvalid}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-sky-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-600"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-sky-950 block mb-1">
                      Số tiền vay ngân hàng (VND) *
                    </label>
                    <CurrencyInput
                      required
                      value={loanPrincipal}
                      onChange={setLoanPrincipal}
                      invalid={loanInvalid}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-sky-300 rounded-lg font-bold text-rose-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
                    />
                  </div>
                </div>

                {/* Progress bar of Equity vs Debt */}
                <div className="space-y-1">
                  <div className="h-2.5 w-full bg-slate-200 rounded-full overflow-hidden flex">
                    <div
                      style={{ width: `${Math.min(100, Math.max(0, equityPercent))}%` }}
                      className="h-full bg-emerald-500 transition-all"
                    />
                    <div
                      style={{ width: `${Math.min(100, Math.max(0, ltvPercent))}%` }}
                      className="h-full bg-rose-500 transition-all"
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-sky-800">
                    <span>Vốn tự có: {formatVND(downPayment, { compact: true })}</span>
                    <span>Nợ vay: {formatVND(loanPrincipal, { compact: true })}</span>
                  </div>
                </div>
                {loanErrors.map((msg) => (
                  <FieldError key={msg}>{msg}</FieldError>
                ))}
              </div>

              {/* Loan Attributes Inputs */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                  Thuộc tính Khoản Vay Ngân Hàng (Tự động liên kết)
                </span>

                {/* Vay thế chấp vs Vay tín chấp */}
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                    Hình thức vay vốn *
                  </label>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setLoanSecurityType('secured')}
                      className={`p-2.5 rounded-lg border text-left flex items-start gap-2.5 transition-all ${
                        loanSecurityType === 'secured'
                          ? 'bg-sky-50 border-sky-300 text-sky-950 ring-1 ring-sky-300 shadow-xs'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <ShieldCheck className={`w-4 h-4 mt-0.5 shrink-0 ${loanSecurityType === 'secured' ? 'text-sky-600' : 'text-slate-400'}`} />
                      <div>
                        <div className="font-bold text-xs">Vay thế chấp</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setLoanSecurityType('unsecured')}
                      className={`p-2.5 rounded-lg border text-left flex items-start gap-2.5 transition-all ${
                        loanSecurityType === 'unsecured'
                          ? 'bg-amber-50 border-amber-300 text-amber-950 ring-1 ring-amber-300 shadow-xs'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <CreditCard className={`w-4 h-4 mt-0.5 shrink-0 ${loanSecurityType === 'unsecured' ? 'text-amber-600' : 'text-slate-400'}`} />
                      <div>
                        <div className="font-bold text-xs">Vay tín chấp</div>
                      </div>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Ngân hàng / Tổ chức cho vay *</label>
                    <input
                      type="text"
                      required
                      value={loanLender}
                      onChange={(e) => setLoanLender(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Tên gói vay</label>
                    <input
                      type="text"
                      value={loanName}
                      onChange={(e) => setLoanName(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                {/* Interest Rate Mechanism */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Cơ chế lãi suất</label>
                    <div className="flex items-center gap-3 text-xs pt-1">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="loanRateType"
                          checked={loanRateType === 'floating'}
                          onChange={() => setLoanRateType('floating')}
                        />
                        <span>Thả nổi</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          name="loanRateType"
                          checked={loanRateType === 'fixed'}
                          onChange={() => setLoanRateType('fixed')}
                        />
                        <span>Cố định</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-600 block mb-1">
                      {loanRateType === 'floating' ? 'Lãi suất tổng (%/năm)' : 'Lãi suất cố định (%/năm)'}
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      value={effectiveLoanRate}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        if (loanRateType === 'fixed') setLoanRate(val);
                        else setLoanMargin(val - loanBaseRate);
                      }}
                      className="w-full px-2.5 py-1 text-xs bg-white border border-slate-300 rounded font-mono font-bold"
                    />
                  </div>
                </div>

                {loanRateType === 'floating' && (
                  <div className="grid grid-cols-2 gap-3 p-2 bg-white rounded border border-slate-200 text-xs">
                    <div>
                      <span className="text-[11px] text-slate-500 block mb-0.5">Lãi suất cơ sở (%)</span>
                      <input
                        type="number"
                        step="0.05"
                        value={loanBaseRate}
                        onChange={(e) => setLoanBaseRate(parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-500 block mb-0.5">Biên độ thả nổi (%)</span>
                      <input
                        type="number"
                        step="0.05"
                        value={loanMargin}
                        onChange={(e) => setLoanMargin(parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 text-xs border border-slate-300 rounded font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Method & Tenor */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Phương thức trả nợ</label>
                    <select
                      value={loanMethod}
                      onChange={(e) => setLoanMethod(e.target.value as PaymentMethod)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="declining_balance">Dư nợ giảm dần</option>
                      <option value="equal_payment">Trả đều (Annuity)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Thời hạn vay (tháng)</label>
                    <input
                      type="number"
                      value={loanTenorMonths}
                      onChange={(e) => setLoanTenorMonths(parseInt(e.target.value) || 12)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Ngày trả hàng tháng</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      value={loanPaymentDay}
                      onChange={(e) => setLoanPaymentDay(parseInt(e.target.value) || 15)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                </div>

                {/* Estimate First Month Payment */}
                <div className="p-3 bg-slate-100 rounded-lg flex items-center justify-between text-xs">
                  <div>
                    <span className="text-slate-500 block">Dự tính trả nợ kỳ đầu tiên ({loanMethod === 'declining_balance' ? 'Dư nợ giảm dần' : 'Trả đều'})</span>
                    <span className="text-slate-700 text-[11px]">
                      Gốc: <strong>{formatVND(firstMonthPrincipal)}</strong> · Lãi: <strong>{formatVND(firstMonthInterest)}</strong>
                    </span>
                  </div>
                  <span className="text-base font-extrabold text-slate-900 font-mono tabular-nums">
                    {formatVND(firstMonthTotal)}
                  </span>
                </div>

                {/* Deduct Down payment from wallet checkbox */}
                <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-emerald-950 block">Trích số tiền vốn tự có ({formatVND(downPayment, { compact: true })}) từ Ví Đầu Tư?</span>
                    <span className="text-emerald-700 text-[11px]">
                      Khả dụng trong ví: <strong>{formatVND(availableCash)}</strong>
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={deductFromWallet}
                    onChange={(e) => setDeductFromWallet(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded border-emerald-300 focus:ring-emerald-500"
                  />
                </div>
                <FieldError>{loanWalletError}</FieldError>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Ghi chú</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>

        </ModalBody>
        <ModalFooter
          hint={
            errors[0] ? <span className="font-semibold text-rose-600">{errors[0]}</span> : undefined
          }
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg transition-colors font-medium"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={hasProblems}
            className="px-5 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-slate-900"
          >
            {fundingMode === 'cash' ? 'Lưu tài sản' : 'Lưu tài sản & Khoản vay liên kết'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
