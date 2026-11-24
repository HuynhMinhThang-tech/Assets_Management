import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { formatVND } from '../../utils/calculations';
import { summarizeMonth } from '../../utils/calendar';
import { PwaCard, PwaStat } from './pwaUi';

type MonthSummary = ReturnType<typeof summarizeMonth>;

/** Tổng kết tháng trên điện thoại: 3 số chính một hàng, các dòng chi tiết bên dưới (thay cho 3 thẻ lớn xếp dọc). */
export const PwaCalendarSummary: React.FC<{ summary: MonthSummary; cash: number; walletShort: number }> = ({
  summary,
  cash,
  walletShort,
}) => (
  <PwaCard className="space-y-3 p-3.5" data-pwa-calendar-summary="">
    <div className="grid grid-cols-3 gap-2">
      <PwaStat
        label="Phải trả"
        value={formatVND(summary.outTotal, { compact: true })}
        valueClass="text-rose-600"
        title={formatVND(summary.outTotal)}
      />
      <PwaStat
        label="Tiền nhận"
        value={formatVND(summary.inTotal, { compact: true })}
        valueClass="text-emerald-600"
        title={formatVND(summary.inTotal)}
      />
      <PwaStat
        label="Chênh lệch"
        value={`${summary.net >= 0 ? '+' : ''}${formatVND(summary.net, { compact: true })}`}
        valueClass={summary.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}
        title={formatVND(summary.net)}
      />
    </div>

    <div className="space-y-2.5 border-t border-slate-100 pt-2.5 text-[11px] text-slate-600">
      <div className="space-y-1">
        <div className="flex justify-between gap-2">
          <span>Đã trả</span>
          <span className="font-mono">{formatVND(summary.outPaid)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Còn phải trả</span>
          <span className="font-mono font-semibold text-slate-900">{formatVND(summary.outOpen)}</span>
        </div>
        {summary.outOverdue > 0 && (
          <div className="flex justify-between gap-2 font-semibold text-rose-600">
            <span>Trong đó quá hạn</span>
            <span className="font-mono">{formatVND(summary.outOverdue)}</span>
          </div>
        )}
      </div>
      <div className="space-y-1 border-t border-dashed border-slate-100 pt-2.5">
        <div className="flex justify-between gap-2">
          <span>Đã nhận</span>
          <span className="font-mono">{formatVND(summary.inReceived)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span>Dự kiến nhận</span>
          <span className="font-mono">{formatVND(summary.inExpected)}</span>
        </div>
        {summary.inUnrecorded > 0 && (
          <div className="flex justify-between gap-2 font-semibold text-amber-700">
            <span>Đến ngày nhưng chưa ghi nhận</span>
            <span className="font-mono">{formatVND(summary.inUnrecorded)}</span>
          </div>
        )}
      </div>
    </div>

    <div className="border-t border-slate-100 pt-2.5 text-[11px] text-slate-600">
      Tiền khả dụng trong ví: <strong className="font-mono text-slate-900">{formatVND(cash)}</strong>
      {walletShort > 0 && (
        <div className="mt-1.5 flex items-start gap-1 font-semibold text-rose-600">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span>Ví chưa đủ cho các khoản còn phải trả (thiếu {formatVND(walletShort)}).</span>
        </div>
      )}
    </div>
  </PwaCard>
);
