import React, { useState } from 'react';

interface PayDateFieldProps {
  label: string;
  initial: string;
  min?: string;
  max?: string;
  /** Gọi mỗi khi người dùng đổi ngày (dùng khi trường nằm trong hộp thoại xác nhận). */
  onChange: (value: string) => void;
}

/** Ô chọn ngày giao dịch có trạng thái riêng, để đặt trong hộp thoại xác nhận. */
export const PayDateField: React.FC<PayDateFieldProps> = ({ label, initial, min, max, onChange }) => {
  const [value, setValue] = useState(initial);
  return (
    <label className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
      <span>{label}</span>
      <input
        type="date"
        data-testid="tx-date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          setValue(e.target.value);
          onChange(e.target.value);
        }}
        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-normal text-slate-900"
      />
    </label>
  );
};
