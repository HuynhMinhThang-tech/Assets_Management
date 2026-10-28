import React, { useState, useEffect } from 'react';
import { MAX_MONEY } from '../utils/validation';

interface CurrencyInputProps {
  value: number;
  onChange: (val: number) => void;
  className?: string;
  required?: boolean;
  min?: number;
  /** Trần cứng: gõ quá sẽ bị giữ ở mức này (mặc định MAX_MONEY). */
  max?: number;
  disabled?: boolean;
  id?: string;
  name?: string;
  /** Tô viền đỏ khi giá trị đang sai (kèm thông báo lỗi ở ngoài). */
  invalid?: boolean;
  /** Cho phép số thập phân (dấu phẩy kiểu VN): số chỉ vàng, số CCQ… */
  allowDecimal?: boolean;
}

/**
 * Format a number with thousand dot separators in Vietnamese format (e.g. 100.000.000)
 */
export function formatThousand(num: number | string): string {
  if (num === '' || num === undefined || num === null) return '';
  const parsed = typeof num === 'string' ? parseFloat(num.replace(/\D/g, '')) : num;
  if (isNaN(parsed)) return '';
  if (parsed === 0) return '0';
  return Math.round(parsed).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Parse a thousand formatted string back to a pure numeric value
 */
export function parseThousand(str: string): number {
  if (!str) return 0;
  const cleaned = str.replace(/\D/g, '');
  if (!cleaned) return 0;
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? 0 : parsed;
}

export const CurrencyInput: React.FC<CurrencyInputProps> = ({
  value,
  onChange,
  className = '',
  required = false,
  disabled = false,
  id,
  name,
  allowDecimal = false,
  invalid = false,
  max = MAX_MONEY,
}) => {
  const fmtDec = (v: number) => {
    if (!v) return '';
    const [i, d] = String(v).split('.');
    return formatThousand(i) + (d ? ',' + d : '');
  };
  const parseDec = (raw: string): { num: number; text: string } => {
    const cleaned = raw.replace(/[^0-9,]/g, '');
    const [intPart, ...rest] = cleaned.split(',');
    const dec = rest.join('').slice(0, 4);
    const hasComma = cleaned.includes(',');
    const intNum = parseInt(intPart.replace(/\D/g, '') || '0', 10);
    const text = (intPart ? formatThousand(intNum) : hasComma ? '0' : '') + (hasComma ? ',' + dec : '');
    if (intNum > max) return { num: max, text: formatThousand(max) };
    return { num: parseFloat(`${intNum}.${dec || '0'}`), text };
  };
  const [displayValue, setDisplayValue] = useState<string>(
    allowDecimal ? fmtDec(value) : value ? formatThousand(value) : ''
  );

  useEffect(() => {
    // Only update if numeric value differs to avoid overriding active cursor typing
    const currentNumeric = allowDecimal ? parseDec(displayValue).num : parseThousand(displayValue);
    if (value !== currentNumeric) {
      setDisplayValue(allowDecimal ? fmtDec(value) : value > 0 ? formatThousand(value) : '');
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw.trim() === '') {
      setDisplayValue('');
      onChange(0);
      return;
    }
    if (allowDecimal) {
      const { num, text } = parseDec(raw);
      setDisplayValue(text);
      onChange(num);
      return;
    }
    const numeric = Math.min(parseThousand(raw), max);
    setDisplayValue(numeric > 0 ? formatThousand(numeric) : '0');
    onChange(numeric);
  };

  return (
    <input
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      value={displayValue}
      onChange={handleChange}
      className={`font-mono tabular-nums ${className}`}
    />
  );
};
