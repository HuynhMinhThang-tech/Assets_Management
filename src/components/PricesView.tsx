import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, RefreshCw } from 'lucide-react';
import type { AssetCategory, MarketQuote, PriceKind, UserFinancialState } from '../types/finance';
import { formatPercent, formatVND, todayLocalStr } from '../utils/calculations';
import { api } from '../utils/api';
import {
  ANOMALY_PCT, STALE_DAYS, buildPriceTemplateCsv, collectQuoteRequests, isAnomalous, listPriceRows, parsePriceCsv, planImport, previewValue,
  quoteMapKey, quotesToMap, suggestFromQuote,
} from '../utils/priceSync';
import type { ApplyResult, PlanItem, PriceRow, PriceSuggestion, PriceUpdate } from '../utils/priceSync';
import { CurrencyInput } from './CurrencyInput';
import { Modal, ModalBody, ModalFooter } from './ui/Modal';
import { useDialog } from './ui/DialogProvider';

interface PricesViewProps {
  state: UserFinancialState;
  /** Áp các giá lên danh mục (App giữ state). Trả về kết quả để hiện thông báo. */
  onApplyPrices: (updates: PriceUpdate[]) => ApplyResult;
}

const GROUPS: { category: AssetCategory; title: string; hint: string }[] = [
  { category: 'stock', title: 'Cổ phiếu', hint: 'Giá đóng cửa tự động sau phiên 15h (nguồn vnstock). Có thể nhập tay.' },
  { category: 'fund', title: 'Chứng chỉ quỹ', hint: 'Nhập NAV mỗi CCQ (hoặc import từ file).' },
  { category: 'gold', title: 'Vàng & kim loại quý', hint: 'Giá mỗi chỉ. Nhẫn 9999 và nữ trang nhập tay.' },
  { category: 'real_estate', title: 'Bất động sản', hint: 'Nhập định giá thị trường (theo giá/m² nếu đã khai diện tích).' },
  { category: 'other', title: 'Tài sản khác', hint: 'Xe, góp vốn, crypto…: nhập tổng giá trị hiện tại.' },
  { category: 'savings', title: 'Tiết kiệm & trái phiếu', hint: 'Giá trị app tự tính theo lãi suất – không cần cập nhật giá.' },
];

const fmtDate = (ymd: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd || '—';
};
const fmtQty = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 4 });
const tone = (n: number) => (n > 0 ? 'text-emerald-600' : n < 0 ? 'text-rose-600' : 'text-slate-500');
const signed = (n: number) => `${n > 0 ? '+' : ''}${formatVND(n)}`;

const STATUS_STYLE: Record<PlanItem['status'], string> = {
  ok: 'text-emerald-700 bg-emerald-50',
  anomaly: 'text-amber-800 bg-amber-50',
  unmatched: 'text-slate-600 bg-slate-100',
  invalid: 'text-rose-700 bg-rose-50',
  older: 'text-slate-600 bg-slate-100',
  future: 'text-rose-700 bg-rose-50',
  readonly: 'text-slate-600 bg-slate-100',
};
const STATUS_LABEL: Record<PlanItem['status'], string> = {
  ok: 'Sẵn sàng', anomaly: 'Lệch bất thường', unmatched: 'Không khớp', invalid: 'Dòng lỗi', older: 'Bỏ qua (cũ)', future: 'Bỏ qua (tương lai)', readonly: 'Bỏ qua',
};

export const PricesView: React.FC<PricesViewProps> = ({ state, onApplyPrices }) => {
  const dialog = useDialog();
  const today = todayLocalStr();
  const rows = useMemo(() => listPriceRows(state, today), [state, today]);

  // ---- Giá thị trường tự động (đọc từ máy chủ) ----
  const [quotes, setQuotes] = useState<Map<string, MarketQuote>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const requestKey = useMemo(() => JSON.stringify(collectQuoteRequests(rows)), [rows]);

  const loadQuotes = useCallback(async () => {
    const req = JSON.parse(requestKey) as Record<PriceKind, string[]>;
    const kinds = (Object.keys(req) as PriceKind[]).filter((k) => req[k].length > 0);
    if (kinds.length === 0) {
      setQuotes(new Map());
      setLoadError('');
      return;
    }
    setLoading(true);
    const results = await Promise.allSettled(kinds.map((k) => api.getPrices(k, req[k])));
    const all: MarketQuote[] = [];
    let err = '';
    results.forEach((r) => {
      if (r.status === 'fulfilled') all.push(...r.value.prices);
      else err = r.reason?.message || 'Không tải được giá tự động.';
    });
    setQuotes(quotesToMap(all));
    setLoadError(err);
    setLoading(false);
  }, [requestKey]);

  useEffect(() => {
    void loadQuotes();
  }, [loadQuotes]);

  const suggestions = useMemo(() => {
    const m = new Map<string, PriceSuggestion>();
    for (const r of rows) {
      if (!r.quoteKey) continue;
      const s = suggestFromQuote(r, quotes.get(quoteMapKey(r.quoteKey.kind, r.quoteKey.symbol)));
      if (s) m.set(r.asset.id, s);
    }
    return m;
  }, [rows, quotes]);

  const newestQuoteDate = useMemo(() => [...quotes.values()].reduce((d, q) => (q.date > d ? q.date : d), ''), [quotes]);
  const autoApplicable = [...suggestions.values()].filter((s) => s.status === 'ok' && !s.anomaly);
  const autoAnomalies = [...suggestions.values()].filter((s) => s.status === 'ok' && s.anomaly);
  const staleCount = rows.filter((r) => r.mode !== 'readonly' && r.staleDays !== null && r.staleDays > STALE_DAYS).length;

  // ---- Nhập tay ----
  const [edits, setEdits] = useState<Record<string, number>>({});

  const report = (res: ApplyResult, what: string) => {
    if (res.applied.length > 0) dialog.toast(`Đã cập nhật giá ${res.applied.length} tài sản${what}.`, 'success');
    if (res.skipped.length > 0 && res.applied.length === 0) dialog.toast('Không có giá nào được áp dụng (đã có định giá mới hơn hoặc giá không hợp lệ).', 'info');
  };

  const saveManual = async (row: PriceRow) => {
    const value = edits[row.asset.id] || 0;
    if (!(value > 0)) return;
    const pv = previewValue(row, value);
    if (isAnomalous(pv.changePct)) {
      const ok = await dialog.confirm({
        tone: 'warning',
        title: 'Giá lệch nhiều so với hiện tại',
        message: `${row.asset.name}: giá trị mới ${formatVND(pv.total)} lệch ${formatPercent(pv.changePct!)} so với hiện tại (${formatVND(row.asset.currentValue)}). Bạn chắc chắn nhập đúng?`,
        confirmText: 'Vẫn lưu',
      });
      if (!ok) return;
    }
    const update: PriceUpdate = row.mode === 'unit' ? { assetId: row.asset.id, unitPrice: value, date: today } : { assetId: row.asset.id, totalValue: value, date: today };
    const res = onApplyPrices([update]);
    report(res, '');
    if (res.applied.length > 0) setEdits((e) => ({ ...e, [row.asset.id]: 0 }));
  };

  // ---- Giá tự động ----
  const toUpdate = (s: PriceSuggestion): PriceUpdate => ({ assetId: s.assetId, unitPrice: s.newUnitPrice, date: s.date });

  const applyOneAuto = async (row: PriceRow, s: PriceSuggestion) => {
    if (s.anomaly) {
      const ok = await dialog.confirm({
        tone: 'warning',
        title: 'Giá tự động lệch bất thường',
        message: `${row.asset.name}: giá ${formatVND(s.newUnitPrice)} lệch ${formatPercent(s.changePct ?? 0)} so với giá đang ghi (${formatVND(s.currentUnitPrice ?? 0)}). Hãy kiểm tra chia tách/thưởng cổ phiếu hoặc nhầm mã trước khi áp dụng.`,
        confirmText: 'Vẫn áp dụng',
      });
      if (!ok) return;
    }
    report(onApplyPrices([toUpdate(s)]), '');
  };

  const applyAllAuto = async () => {
    if (autoApplicable.length === 0) return;
    const delta = autoApplicable.reduce((sum, s) => {
      const cur = state.assets.find((a) => a.id === s.assetId)?.currentValue ?? 0;
      return sum + (s.newTotal - cur);
    }, 0);
    const ok = await dialog.confirm({
      title: `Áp dụng ${autoApplicable.length} giá tự động?`,
      message: `Tổng giá trị tài sản thay đổi ${signed(delta)}.${autoAnomalies.length > 0 ? ` ${autoAnomalies.length} giá lệch bất thường sẽ KHÔNG được áp – bạn xử lý riêng từng dòng.` : ''}`,
      confirmText: 'Áp dụng tất cả',
    });
    if (!ok) return;
    report(onApplyPrices(autoApplicable.map(toUpdate)), ' theo giá thị trường');
  };

  // ---- Nhập từ file ----
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [planFile, setPlanFile] = useState('');
  const [includeAnomaly, setIncludeAnomaly] = useState(false);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (/\.(xlsx|xls|xlsm)$/i.test(file.name)) {
      await dialog.alert({
        tone: 'info',
        title: 'Hiện chỉ nhập được file CSV',
        message: 'Trong Excel: Tệp → Lưu thành → chọn "CSV UTF-8 (phân tách bằng dấu phẩy)", rồi nhập file CSV đó. Có thể bấm "Tải file mẫu" để lấy sẵn đúng định dạng.',
      });
      return;
    }
    if (file.size > 1_000_000) {
      await dialog.alert({ tone: 'error', title: 'File quá lớn', message: 'File nhập giá tối đa 1 MB.' });
      return;
    }
    const parsed = parsePriceCsv(await file.text(), today);
    if (parsed.fatal) {
      await dialog.alert({ tone: 'error', title: 'Không đọc được file', message: parsed.fatal });
      return;
    }
    setPlan(planImport(parsed.rows, state, today));
    setPlanFile(file.name);
    setIncludeAnomaly(false);
  };

  const planCounts = useMemo(() => {
    const c = { ok: 0, anomaly: 0, other: 0 };
    (plan ?? []).forEach((i) => (i.status === 'ok' ? c.ok++ : i.status === 'anomaly' ? c.anomaly++ : c.other++));
    return c;
  }, [plan]);
  const planApplicable = (plan ?? []).filter((i) => i.update && (i.status === 'ok' || (includeAnomaly && i.status === 'anomaly')));

  const confirmImport = () => {
    const res = onApplyPrices(planApplicable.map((i) => i.update!));
    report(res, ' từ file');
    setPlan(null);
  };

  const downloadTemplate = () => {
    const blob = new Blob([buildPriceTemplateCsv(state, today)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bang_gia_${today}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ---- Giao diện ----
  const hasPriceable = rows.some((r) => r.mode !== 'readonly');

  const renderRow = (r: PriceRow) => {
    const a = r.asset;
    const s = suggestions.get(a.id);
    const edit = edits[a.id] || 0;
    const pv = edit > 0 ? previewValue(r, edit) : null;
    const stale = r.staleDays !== null && r.staleDays > STALE_DAYS;
    const priceLabel = r.mode === 'unit' ? `mỗi ${r.unit}` : 'tổng giá trị';
    const cur = r.mode === 'unit' ? r.currentUnitPrice : a.currentValue;

    if (r.mode === 'readonly') {
      return (
        <tr key={a.id} className="border-t border-slate-100">
          <td className="px-3 py-3 align-top">
            <div className="font-semibold text-slate-900">{a.name}</div>
          </td>
          <td colSpan={5} className="px-3 py-3 text-xs text-slate-500">
            Giá trị hiện tại <span className="font-mono font-semibold text-slate-800">{formatVND(a.currentValue)}</span> – tự tính theo lãi suất, không cần nhập giá.
          </td>
        </tr>
      );
    }

    return (
      <tr key={a.id} data-price-row={a.id} className="border-t border-slate-100 align-top">
        <td className="px-3 py-3">
          <div className="font-semibold text-slate-900">{a.name}</div>
          <div className="text-xs text-slate-500">
            {r.mode === 'unit' ? `${fmtQty(r.quantity)} ${r.unit}` : 'Nhập tổng giá trị'}
            {r.quoteKey && r.mode === 'unit' ? ` · ${r.quoteKey.symbol}` : ''}
          </div>
        </td>
        <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-slate-700">
          {r.mode === 'unit' && r.costPerUnit !== null ? formatVND(Math.round(r.costPerUnit)) : formatVND(a.initialCost)}
          <div className="font-sans text-[11px] text-slate-400">giá vốn</div>
        </td>
        <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-slate-900">
          {cur !== null ? formatVND(cur) : '—'}
          <div className={`font-sans text-[11px] ${stale ? 'font-semibold text-amber-700' : 'text-slate-400'}`}>
            {stale ? `Quá hạn ${r.staleDays} ngày · ` : ''}định giá {fmtDate(a.lastValuationDate)}
          </div>
        </td>
        <td className="px-3 py-3 text-right text-xs">
          {s ? (
            <div data-auto-price>
              <div className="font-mono font-semibold tabular-nums text-slate-900">{formatVND(s.newUnitPrice)}</div>
              <div className="text-[11px] text-slate-500">
                đóng cửa {fmtDate(s.date)}
                {s.dayChangePct !== null && <span className={`ml-1 font-semibold ${tone(s.dayChangePct)}`}>{formatPercent(s.dayChangePct, 2)}</span>}
              </div>
              {s.status === 'ok' && (
                <button
                  type="button"
                  onClick={() => void applyOneAuto(r, s)}
                  className={`mt-1 rounded-md px-2 py-1 text-[11px] font-bold text-white ${s.anomaly ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                >
                  {s.anomaly ? `Lệch ${formatPercent(s.changePct ?? 0)} – kiểm tra` : 'Áp dụng'}
                </button>
              )}
              {s.status === 'same' && <div className="mt-1 text-[11px] text-slate-400">Đã khớp giá này</div>}
              {s.status === 'newer_manual' && <div className="mt-1 text-[11px] text-slate-400">Bạn đã định giá mới hơn</div>}
            </div>
          ) : r.quoteKey && r.mode === 'unit' ? (
            <span className="text-[11px] text-slate-400">{loading ? 'Đang tải…' : 'Chưa có giá tự động'}</span>
          ) : (
            <span className="text-[11px] text-slate-400">Nhập tay</span>
          )}
        </td>
        <td className="px-3 py-3">
          <div className="flex items-start justify-end gap-2">
            <div className="w-40">
              <CurrencyInput
                value={edit}
                allowDecimal={r.allowDecimal}
                onChange={(v) => setEdits((e) => ({ ...e, [a.id]: v }))}
                invalid={false}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-right text-sm focus:border-slate-500 focus:outline-none"
              />
              <div className="mt-0.5 text-right text-[11px] text-slate-400">{priceLabel} (VND)</div>
            </div>
            <button
              type="button"
              disabled={!(edit > 0)}
              onClick={() => void saveManual(r)}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Lưu
            </button>
          </div>
        </td>
        <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
          {pv ? (
            <div data-price-preview>
              <div className="text-slate-900">{formatVND(pv.total)}</div>
              <div className={`font-semibold ${tone(pv.pnl)}`}>
                {signed(pv.pnl)}
                {pv.pnlPct !== null && ` (${formatPercent(pv.pnlPct)})`}
              </div>
              {isAnomalous(pv.changePct) && (
                <div className="font-sans text-[11px] font-semibold text-amber-700">Lệch &gt; {ANOMALY_PCT}% so với hiện tại</div>
              )}
            </div>
          ) : (
            <div>
              <div className={`font-semibold ${tone(a.currentValue - a.initialCost)}`}>{signed(a.currentValue - a.initialCost)}</div>
              <div className="font-sans text-[11px] text-slate-400">lãi/lỗ hiện tại</div>
            </div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Cập nhật giá</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {loading ? (
              <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Đang tải giá thị trường…</span>
            ) : loadError ? (
              <span className="text-rose-600">{loadError}</span>
            ) : newestQuoteDate ? (
              <>Giá thị trường mới nhất: <span className="font-semibold text-slate-700">{fmtDate(newestQuoteDate)}</span> · cập nhật tự động sau phiên 15h các ngày giao dịch</>
            ) : hasPriceable ? (
              'Chưa có giá tự động – nhập tay hoặc nhập từ file. Giá tự động xuất hiện sau khi script lấy giá chạy lần đầu.'
            ) : (
              'Chưa có tài sản nào cần cập nhật giá.'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void loadQuotes()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Làm mới
          </button>
          <button type="button" onClick={downloadTemplate} disabled={!hasPriceable} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Download className="h-3.5 w-3.5" /> Tải file mẫu
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={!hasPriceable} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <FileUp className="h-3.5 w-3.5" /> Nhập từ file CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain,.xlsx,.xls" className="hidden" onChange={(e) => void onPickFile(e)} data-price-file />
          <button
            type="button"
            data-apply-all
            onClick={() => void applyAllAuto()}
            disabled={autoApplicable.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Áp dụng giá tự động ({autoApplicable.length})
          </button>
        </div>
      </div>

      {(autoAnomalies.length > 0 || staleCount > 0) && (
        <div className="flex flex-wrap gap-3 text-xs">
          {autoAnomalies.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 font-semibold text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" /> {autoAnomalies.length} giá tự động lệch hơn {ANOMALY_PCT}% – cần kiểm tra và áp riêng từng dòng
            </span>
          )}
          {staleCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 font-semibold text-slate-700">
              <AlertTriangle className="h-3.5 w-3.5" /> {staleCount} tài sản chưa định giá lại quá {STALE_DAYS} ngày
            </span>
          )}
        </div>
      )}

      {rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Bạn chưa có tài sản đang nắm giữ. Hãy thêm tài sản ở mục "Danh mục Tài sản".
        </div>
      )}

      {GROUPS.map((g) => {
        const list = rows.filter((r) => r.asset.category === g.category);
        if (list.length === 0) return null;
        return (
          <section key={g.category} data-price-group={g.category} className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">{g.title}</h3>
              <p className="text-[11px] text-slate-500">{g.hint}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2 text-left font-semibold">Tài sản</th>
                    <th className="px-3 py-2 text-right font-semibold">Giá vốn</th>
                    <th className="px-3 py-2 text-right font-semibold">Hiện tại</th>
                    <th className="px-3 py-2 text-right font-semibold">Giá tự động</th>
                    <th className="px-3 py-2 text-right font-semibold">Giá mới</th>
                    <th className="px-3 py-2 text-right font-semibold">Lãi/lỗ</th>
                  </tr>
                </thead>
                <tbody>{list.map(renderRow)}</tbody>
              </table>
            </div>
          </section>
        );
      })}

      {plan && (
        <Modal title="Xem trước nhập giá" subtitle={planFile} onClose={() => setPlan(null)} size="2xl">
          <ModalBody>
            <div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">{planCounts.ok} sẵn sàng</span>
              {planCounts.anomaly > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">{planCounts.anomaly} lệch bất thường</span>}
              {planCounts.other > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{planCounts.other} bỏ qua</span>}
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table data-import-plan className="w-full min-w-[640px] text-xs">
                <thead>
                  <tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-2 py-1.5 text-left font-semibold">Dòng</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Mã / tên trong file</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Tài sản khớp</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Ngày</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Giá</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.map((i, idx) => (
                    <tr key={idx} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1.5 text-slate-500">{i.line}</td>
                      <td className="px-2 py-1.5 font-semibold text-slate-800">{i.key || '—'}</td>
                      <td className="px-2 py-1.5 text-slate-700">{i.assetName ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right text-slate-700">{i.date ? fmtDate(i.date) : '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-900">
                        {i.price !== null ? formatVND(i.price) : '—'}
                        {i.changePct != null && <div className={`font-sans text-[11px] ${tone(i.changePct)}`}>{formatPercent(i.changePct)}</div>}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[i.status]}`}>{STATUS_LABEL[i.status]}</span>
                        <div className="mt-0.5 text-[11px] text-slate-500">{i.message}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {planCounts.anomaly > 0 && (
              <label className="mt-3 flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={includeAnomaly} onChange={(e) => setIncludeAnomaly(e.target.checked)} />
                Áp dụng cả {planCounts.anomaly} dòng lệch hơn {ANOMALY_PCT}% (tôi đã kiểm tra)
              </label>
            )}
          </ModalBody>
          <ModalFooter>
            <button type="button" onClick={() => setPlan(null)} className="rounded-lg px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
              Hủy
            </button>
            <button
              type="button"
              data-import-confirm
              onClick={confirmImport}
              disabled={planApplicable.length === 0}
              className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Áp dụng {planApplicable.length} dòng
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
};
