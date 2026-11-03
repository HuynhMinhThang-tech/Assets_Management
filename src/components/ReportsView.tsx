import React, { useMemo, useState } from 'react';
import { UserFinancialState } from '../types/finance';
import { formatVND, todayLocalStr } from '../utils/calculations';
import {
  PeriodKind, PeriodSpec, ReconcileCheck, buildPeriod, cashFlowReport, periodBalance, profitReport, reconcileReports, snapshotGroupsBefore,
} from '../utils/reports';
import { addDaysStr } from '../utils/ledger';
import { BalanceSheetView } from './BalanceSheetView';

type Tab = 'balance' | 'cashflow' | 'profit';

const KINDS: Array<[PeriodKind, string]> = [['month', 'Tháng'], ['quarter', 'Quý'], ['year', 'Năm'], ['custom', 'Tùy chọn']];
const TABS: Array<[Tab, string]> = [['balance', 'Bảng cân đối'], ['cashflow', 'Báo cáo lưu chuyển tiền tệ'], ['profit', 'Báo cáo hoạt động kinh doanh']];

const vnDate = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '-' : ''}${formatVND(Math.abs(n))}`;
const tone = (n: number) => (n > 0 ? 'text-emerald-600' : n < 0 ? 'text-rose-600' : 'text-slate-900');

/** Dòng báo cáo: chỉ hiện khi có số (dòng chỉ có ở công ty mà cá nhân không có thì ẩn). */
const Line: React.FC<{ label: string; value: number; testId?: string; badge?: string; sign?: boolean; indent?: boolean }> = ({ label, value, testId, badge, sign = true, indent = true }) => {
  if (value === 0) return null;
  return (
    <div data-line={testId} className={`flex items-center justify-between gap-4 py-1.5 text-sm ${indent ? 'pl-4' : ''}`}>
      <span className="text-slate-700 min-w-0 break-words">
        {label}
        {badge && <span className="ml-2 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">{badge}</span>}
      </span>
      <span className={`font-mono tabular-nums shrink-0 ${sign ? tone(value) : 'text-slate-900'}`}>{sign ? signed(value) : formatVND(value)}</span>
    </div>
  );
};
const Total: React.FC<{ label: string; value: number; testId?: string; strong?: boolean }> = ({ label, value, testId, strong }) => (
  <div data-total={testId} className={`flex items-center justify-between gap-4 border-t border-slate-200 mt-1 py-2 text-sm font-semibold ${strong ? 'bg-slate-50 rounded px-2' : ''}`}>
    <span className="text-slate-900">{label}</span>
    <span className={`font-mono tabular-nums ${tone(value)}`}>{signed(value)}</span>
  </div>
);
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="pt-3 pb-1">
    <div className="text-xs font-bold uppercase tracking-wider text-slate-900 pb-1">{title}</div>
    {children}
  </div>
);

export const ReportsView: React.FC<{ state: UserFinancialState }> = ({ state }) => {
  const today = todayLocalStr();
  const [tab, setTab] = useState<Tab>('balance');
  const [spec, setSpec] = useState<PeriodSpec>({
    kind: 'month',
    year: parseInt(today.slice(0, 4), 10),
    month: parseInt(today.slice(5, 7), 10),
    quarter: Math.floor((parseInt(today.slice(5, 7), 10) - 1) / 3) + 1,
    from: `${today.slice(0, 4)}-01-01`,
    to: today,
  });
  const [detail, setDetail] = useState(false);
  const period = useMemo(() => buildPeriod(spec, today), [spec, today]);

  const data = useMemo(() => {
    if (!period.valid) return null;
    return {
      pb: periodBalance(state, period, today),
      cf: cashFlowReport(state, period, today),
      pr: profitReport(state, period, today),
      checks: reconcileReports(state, period, today),
    };
  }, [state, period, today]);

  const snap = period.valid ? snapshotGroupsBefore(state, addDaysStr(period.from, -1)) : null;

  const set = (p: Partial<PeriodSpec>) => setSpec((s) => ({ ...s, ...p }));
  const monthValue = `${spec.year}-${String(spec.month).padStart(2, '0')}`;

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">Báo cáo</h2>
        <span data-period-label className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
          {period.valid ? `${period.label} · ${vnDate(period.from)} – ${vnDate(period.to)}` : period.label}
        </span>
      </div>

      {/* Bộ chọn kỳ */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs">
          {KINDS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              data-period-kind={k}
              onClick={() => set({ kind: k })}
              className={`rounded-md px-3 py-1.5 font-semibold transition-colors ${spec.kind === k ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {spec.kind === 'month' && (
          <input
            type="month"
            data-testid="period-month"
            value={monthValue}
            max={today.slice(0, 7)}
            onChange={(e) => {
              const [y, m] = e.target.value.split('-').map(Number);
              if (y && m) set({ year: y, month: m });
            }}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
          />
        )}
        {spec.kind === 'quarter' && (
          <div className="flex items-center gap-2">
            <select data-testid="period-quarter" value={spec.quarter} onChange={(e) => set({ quarter: Number(e.target.value) })} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs">
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>Quý {q}</option>
              ))}
            </select>
            <input type="number" data-testid="period-year" value={spec.year} onChange={(e) => set({ year: Number(e.target.value) || spec.year })} className="w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-mono" />
          </div>
        )}
        {spec.kind === 'year' && (
          <input type="number" data-testid="period-year" value={spec.year} onChange={(e) => set({ year: Number(e.target.value) || spec.year })} className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-mono" />
        )}
        {spec.kind === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="font-semibold text-slate-700" htmlFor="rp-from">Từ ngày</label>
            <input id="rp-from" type="date" data-testid="period-from" value={spec.from || ''} max={today} onChange={(e) => set({ from: e.target.value })} className="rounded-lg border border-slate-300 px-2.5 py-1.5" />
            <label className="font-semibold text-slate-700" htmlFor="rp-to">Đến ngày</label>
            <input id="rp-to" type="date" data-testid="period-to" value={spec.to || ''} max={today} onChange={(e) => set({ to: e.target.value })} className="rounded-lg border border-slate-300 px-2.5 py-1.5" />
            {!period.valid && <span role="alert" className="text-[11px] font-medium text-rose-600">Ngày bắt đầu phải trước ngày kết thúc.</span>}
          </div>
        )}
      </div>

      {/* Tab con */}
      <div className="flex gap-1 border-b border-slate-200 text-sm">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            data-report-tab={k}
            onClick={() => setTab(k)}
            className={`rounded-t-lg px-4 py-2 font-semibold ${tab === k ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Chọn kỳ báo cáo hợp lệ.</div>
      ) : (
        <>
          {tab === 'balance' && (
            <BalanceSheetView
              state={state}
              balance={data.pb.end}
              compare={{ start: snap?.groups ?? data.pb.startGroups, end: data.pb.endGroups, startSource: snap ? `ảnh chụp ngày ${vnDate(snap.date)}` : 'tính lại từ lịch sử' }}
            />
          )}

          {tab === 'cashflow' && (
            <div data-report="cashflow" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="pb-2 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-900">Báo cáo lưu chuyển tiền tệ</h3>
              <Section title="I. Thu nhập đầu tư">
                <Line label="Cổ tức" value={data.cf.operating.dividend} testId="dividend" />
                <Line label="Lãi tiền gửi / trái phiếu" value={data.cf.operating.interest} testId="interest" />
                <Line label="Tiền thuê" value={data.cf.operating.rental} testId="rental" />
                <Line label="Lãi vay đã trả" value={data.cf.operating.interestPaid} testId="interest-paid" />
                <Total label="Lưu chuyển tiền thuần từ thu nhập đầu tư" value={data.cf.operating.total} testId="operating" />
              </Section>
              <Section title="II. Hoạt động đầu tư">
                <Line label="Mua tài sản" value={data.cf.investing.buy} testId="buy" />
                <Line label="Bán tài sản (thực nhận)" value={data.cf.investing.sell} testId="sell" />
                <Total label="Lưu chuyển tiền thuần từ hoạt động đầu tư" value={data.cf.investing.total} testId="investing" />
              </Section>
              <Section title="III. Hoạt động tài chính">
                <Line label="Nạp vốn" value={data.cf.financing.deposits} testId="deposits" />
                <Line label="Rút vốn" value={data.cf.financing.withdrawals} testId="withdrawals" />
                <Line label="Giải ngân vay" value={data.cf.financing.disbursements} testId="disbursements" />
                <Line label="Trả gốc nợ" value={data.cf.financing.principalPaid} testId="principal-paid" />
                <Line label="Phí tất toán / trả trước hạn" value={data.cf.financing.fees} testId="fees" />
                <Total label="Lưu chuyển tiền thuần từ hoạt động tài chính" value={data.cf.financing.total} testId="financing" />
              </Section>
              <div className="mt-3 space-y-0.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <div className="flex justify-between py-1"><span className="text-slate-700">Tiền đầu kỳ</span><span data-cf="opening" className="font-mono tabular-nums">{formatVND(data.cf.opening)}</span></div>
                <div className="flex justify-between py-1"><span className="text-slate-700">Tăng/giảm tiền thuần trong kỳ</span><span data-cf="net" className={`font-mono tabular-nums ${tone(data.cf.net)}`}>{signed(data.cf.net)}</span></div>
                <div className="flex justify-between border-t border-slate-200 py-1.5 font-bold"><span className="text-slate-900">Tiền cuối kỳ</span><span data-cf="closing" className="font-mono tabular-nums">{formatVND(data.cf.closing)}</span></div>
              </div>
              {(data.cf.nonCash.assets.count > 0 || data.cf.nonCash.loans.count > 0 || data.cf.nonCash.externalPayments.count > 0 || data.cf.nonCash.unrecordedPayments.count > 0) && (
                <Section title="Giao dịch không qua ví (phi tiền mặt)">
                  <Line label={`Tài sản thêm không trừ ví (${data.cf.nonCash.assets.count})`} value={data.cf.nonCash.assets.amount} testId="nc-assets" sign={false} />
                  <Line label={`Khoản vay chỉ ghi nợ, không giải ngân vào ví (${data.cf.nonCash.loans.count})`} value={data.cf.nonCash.loans.amount} testId="nc-loans" sign={false} />
                  <Line label={`Trả nợ bằng tiền ngoài ví (${data.cf.nonCash.externalPayments.count})`} value={data.cf.nonCash.externalPayments.amount} testId="nc-external" sign={false} />
                  <Line label={`Kỳ nợ đã trả không có giao dịch (${data.cf.nonCash.unrecordedPayments.count}), phần gốc`} value={data.cf.nonCash.unrecordedPayments.principal} testId="nc-unrecorded" sign={false} />
                </Section>
              )}
            </div>
          )}

          {tab === 'profit' && (
            <div data-report="profit" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="pb-2 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-900">Báo cáo hoạt động kinh doanh</h3>
              <Section title="I. Kết quả đã thực hiện">
                <Line label="Cổ tức" value={data.pr.income.dividend} testId="dividend" />
                <Line label="Lãi tiền gửi / trái phiếu" value={data.pr.income.interest} testId="interest" />
                <Line label="Tiền thuê" value={data.pr.income.rental} testId="rental" />
                <Line label="Lãi/lỗ đã chốt trước phí" value={data.pr.realizedBeforeFees} testId="realized" />
                <Line label="Phí và thuế khi bán" value={data.pr.saleFees} testId="sale-fees" />
                <Line label="Lãi chốt từ các lần bán cũ (đã trừ phí)" value={data.pr.legacyRealized.amount} testId="legacy" badge="ước tính" />
                <Line label="Chi phí lãi vay" value={data.pr.interestExpense} testId="interest-expense" />
                <Line label="Phí tất toán sớm / trả trước hạn" value={data.pr.otherFees} testId="other-fees" />
                <Total label="Lợi nhuận đã thực hiện" value={data.pr.realizedProfit} testId="realized-profit" strong />
              </Section>
              <Section title="II. Kết quả chưa thực hiện">
                <Line label="Lãi/lỗ chưa chốt (thay đổi thị giá tài sản đang giữ)" value={data.pr.unrealizedChange} testId="unrealized" badge="ước tính" />
              </Section>
              <Total label="Tổng lợi nhuận kinh tế" value={data.pr.economicProfit} testId="economic" strong />
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  ['Tỷ suất lợi nhuận trên vốn chủ bình quân (cả kỳ)', data.pr.ratios.equityReturn === null ? null : `${(data.pr.ratios.equityReturn * 100).toFixed(2)}%`, 'ratio-roe'],
                  ['Tỷ suất thu nhập trên tài sản bình quân (cả kỳ)', data.pr.ratios.incomeYield === null ? null : `${(data.pr.ratios.incomeYield * 100).toFixed(2)}%`, 'ratio-yield'],
                  ['Hệ số bao phủ lãi vay (thu nhập đầu tư / lãi vay)', data.pr.ratios.interestCover === null ? null : `${data.pr.ratios.interestCover.toFixed(2)}x`, 'ratio-cover'],
                ].map(([label, value, id]) => (
                  <div key={id as string} data-ratio={id as string} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="text-xs font-semibold text-slate-700">{label}</div>
                    <div className="mt-2 text-xl font-extrabold font-mono tabular-nums text-slate-900">{value ?? '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Đối soát giữa ba báo cáo */}
          <section data-reconcile className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">Đối soát giữa ba báo cáo</h3>
              <button type="button" data-toggle-detail onClick={() => setDetail((v) => !v)} className="text-xs font-semibold text-slate-600 hover:text-slate-900">
                {detail ? 'Ẩn chi tiết' : 'Xem chi tiết'}
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {data.checks.map((c) => (
                <CheckRow key={c.id} c={c} detail={detail} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

const CheckRow: React.FC<{ c: ReconcileCheck; detail: boolean }> = ({ c, detail }) => (
  <div data-check={c.id} data-ok={c.ok ? 'true' : 'false'} className="py-3">
    <div className="flex items-start justify-between gap-3">
      <span className="text-sm font-medium text-slate-800">{c.title}</span>
      <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-bold ${c.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
        {c.ok ? 'Khớp' : 'Chưa khớp'}
      </span>
    </div>
    {(detail || !c.ok) && (
      <div className="mt-2 space-y-1 text-xs">
        <div className="flex justify-between font-mono"><span className="font-sans text-slate-600">{c.left.label}</span><span>{formatVND(c.left.value)}</span></div>
        <div className="flex justify-between font-mono"><span className="font-sans text-slate-600">{c.right.label}</span><span>{formatVND(c.right.value)}</span></div>
        {!c.ok && <div className="flex justify-between font-mono font-bold text-rose-600"><span className="font-sans">Chênh lệch</span><span>{signed(c.diff)}</span></div>}
        {detail && c.parts && (
          <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono">
            {c.parts.filter((p) => p.value !== 0).map((p) => (
              <div key={p.label} className="flex justify-between py-0.5"><span className="font-sans text-slate-600">{p.label}</span><span>{signed(p.value)}</span></div>
            ))}
          </div>
        )}
        {!c.ok && c.causes.length > 0 && (
          <ul className="list-disc pl-5 font-medium text-amber-700">
            {c.causes.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
      </div>
    )}
  </div>
);
