import { useEffect, useState } from 'react';

const strip = (s: string) => s.replace(/,/g, '').trim();
const parseNum = (s: string): number | null => {
  const v = Number(strip(s));
  return Number.isFinite(v) && strip(s) !== '' ? v : null;
};

function display(value: number): string {
  if (!Number.isFinite(value)) return '';
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

interface NumFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  hint?: string;
  /** 소수 자리 (기본 자유) */
  placeholder?: string;
}

/** 숫자 입력 — 천단위 콤마 표시, 빈 값은 0으로 넘긴다 */
export function NumField({ label, value, onChange, suffix, hint, placeholder }: NumFieldProps) {
  const [text, setText] = useState(() => display(value));
  useEffect(() => {
    if (parseNum(text) !== value) setText(display(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="num-field">
      <span className="num-label">{label}</span>
      <span className="num-input">
        <input
          inputMode="decimal"
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const n = parseNum(next);
            onChange(n ?? 0);
          }}
          onBlur={() => setText(display(parseNum(text) ?? 0))}
        />
        {suffix && <i>{suffix}</i>}
      </span>
      {hint && <em className="num-hint">{hint}</em>}
    </label>
  );
}

interface CoinOption {
  symbol: string;
  base: string;
}

/** 코인 선택 — 검색 없이 셀렉트로 (모바일에서 빠르게) */
export function CoinSelect({
  value,
  onChange,
  coins,
  label = '코인',
}: {
  value: string;
  onChange: (symbol: string) => void;
  coins: CoinOption[];
  label?: string;
}) {
  return (
    <label className="num-field">
      <span className="num-label">{label}</span>
      <span className="num-input">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {coins.map((c) => (
            <option key={c.symbol} value={c.symbol}>
              {c.base} · {c.symbol}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
