import { useEffect, useMemo, useState } from 'react';
import { TD_PAIRS, TD_PREFIX } from '../api/twelvedata';
import { FX_UNIVERSE } from '../engine/universe';
import type { ScanState } from '../hooks/useScanner';
import { fmtPrice } from '../lib/format';
import { fxStep, offsetFor, type OffsetMap } from '../lib/offset';

interface Props {
  state: ScanState;
  offsets: OffsetMap;
  twelveDataKey: string;
  onChange: (label: string, value: number) => void;
  onReset: () => void;
}

export interface FxRow {
  /** 오프셋 저장 키 = 시그널 base 표기 (XAUUSD+, EURUSD+, BTC …) */
  label: string;
  /** 화면에 보여줄 이름 (BTC → BTCUSDT) */
  display?: string;
  symbol: string;
  decimals: number;
  note?: string;
  price: number | null;
  live: boolean;
  priority?: boolean;
}

export function roundTo(value: number, decimals: number): number {
  const f = 10 ** Math.max(0, Math.min(8, Math.round(decimals)));
  return Math.round(value * f) / f;
}

/** 오프셋 입력 — 입력 중 문자열을 그대로 유지해 '-'·소수점 타이핑이 끊기지 않게 한다. */
function OffsetInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(value ? String(value) : '');

  // ± 버튼·전체 초기화처럼 바깥에서 값이 바뀌면 입력창도 따라간다(타이핑 중에는 건드리지 않는다).
  useEffect(() => {
    const parsed = Number(text.replace(',', '.'));
    const current = text.trim() === '' || !Number.isFinite(parsed) ? 0 : parsed;
    if (Math.abs(current - value) > 1e-12) setText(value ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      className="fx-offset-input"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={`${label} 벤티지 호가 오프셋`}
      placeholder="0"
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const n = Number(next.replace(',', '.'));
        onCommit(next.trim() === '' || !Number.isFinite(n) ? 0 : n);
      }}
    />
  );
}

export function buildFxRows(state: ScanState, twelveDataKey: string): FxRow[] {
  const tickerPrice = new Map<string, number>();
  for (const t of state.tickers) {
    if (Number.isFinite(t.last) && t.last > 0) tickerPrice.set(t.symbol, t.last);
  }
  // 분석 결과의 현재가(캔들 종가) — 티커가 없는 보조 페어도 여기서 가격을 얻는다.
  const basePrice = new Map<string, number>();
  for (const a of state.analyses) {
    const last = a.signals[0]?.price;
    if (Number.isFinite(last) && (last as number) > 0 && !basePrice.has(a.base)) {
      basePrice.set(a.base, last as number);
    }
  }
  const scanned = new Set(state.analyses.map((a) => a.base));
  const decimalsOf = (symbol: string, fallback: number) =>
    state.contracts.find((c) => c.symbol === symbol)?.decimals ?? fallback;

  const row = (symbol: string, label: string, decimals: number, note?: string, display?: string): FxRow => ({
    label,
    display,
    symbol,
    decimals,
    note,
    price: tickerPrice.get(symbol) ?? basePrice.get(label) ?? null,
    live: scanned.has(label),
  });

  // 1) 주력 3종목 고정: 금(XAUUSD+) · 유로(EURUSD+) · 비트(BTC)
  const pinned: FxRow[] = [
    { ...row('XAUUSDT', 'XAUUSD+', decimalsOf('XAUUSDT', 2), '금'), priority: true },
    { ...row('EURUSDUSDT', 'EURUSD+', decimalsOf('EURUSDUSDT', 4), '유로/달러'), priority: true },
    { ...row('BTCUSDT', 'BTC', decimalsOf('BTCUSDT', 1), '비트', 'BTCUSDT'), priority: true },
  ];
  const pinnedSymbols = new Set(pinned.map((p) => p.symbol));

  // 2) 나머지 FX·금·원자재·지수
  const rows: FxRow[] = [...pinned];
  for (const m of FX_UNIVERSE) {
    if (pinnedSymbols.has(m.symbol)) continue;
    rows.push(row(m.symbol, m.label, decimalsOf(m.symbol, 2), m.note));
  }

  // 3) Twelve Data 보조 페어(키가 있을 때만)
  if (twelveDataKey.trim()) {
    for (const p of TD_PAIRS) {
      rows.push(row(`${TD_PREFIX}${p.symbol}`, p.label, p.decimals, 'Twelve Data'));
    }
  }
  return rows;
}

/** FX·금 필터에서 노출되는 벤티지 호가 보정 미니 바 */
export function FxOffsetBar({ state, offsets, twelveDataKey, onChange, onReset }: Props) {
  const rows = useMemo(() => buildFxRows(state, twelveDataKey), [state, twelveDataKey]);
  const applied = rows.filter((r) => offsetFor(r.label, offsets) !== 0).length;

  return (
    <section className="fx-offset-bar" aria-label="벤티지 호가 보정">
      <div className="fx-offset-head">
        <b>
          Vantage 호가 보정 <span className="fx-count">{applied}종목 적용</span>
        </b>
        <span className="fx-offset-hint">
          벤티지 MT5 현재가 − 비트겟 현재가 차이를 넣으면 카드·공유카드의 현재가·진입·목표·EQ·무효가가 함께
          맞춰집니다 (손익비는 그대로).
        </span>
        <button type="button" className="fx-offset-reset" onClick={onReset}>
          전체 초기화
        </button>
      </div>
      <div className="fx-chips">
        {rows.map((r) => {
          const off = offsetFor(r.label, offsets);
          const step = fxStep(r.decimals);
          return (
            <div
              className={`fx-chip${r.live ? ' live' : ''}${off ? ' on' : ''}${r.priority ? ' priority' : ''}`}
              key={r.label}
            >
              <div className="fx-chip-top">
                <span className="fx-chip-label">
                  {r.priority ? '★ ' : ''}
                  {r.display ?? r.label}
                </span>
                {r.note ? <span className="fx-chip-note">{r.note}</span> : null}
              </div>
              <div className="fx-chip-price">{r.price != null ? fmtPrice(r.price, r.decimals) : '—'}</div>
              <div className="fx-chip-edit">
                <span className="fx-chip-sign">Δ</span>
                <OffsetInput label={r.label} value={off} onCommit={(v) => onChange(r.label, v)} />
                <button
                  type="button"
                  className="fx-chip-step"
                  title={`${step} 만큼 내리기`}
                  onClick={() => onChange(r.label, roundTo(off - step, r.decimals + 1))}
                >
                  −
                </button>
                <button
                  type="button"
                  className="fx-chip-step"
                  title={`${step} 만큼 올리기`}
                  onClick={() => onChange(r.label, roundTo(off + step, r.decimals + 1))}
                >
                  +
                </button>
              </div>
              <div className="fx-chip-applied">
                적용 {r.price != null ? fmtPrice(r.price + off, r.decimals) : '—'}
              </div>
            </div>
          );
        })}
      </div>
      <div className="fx-offset-foot">
        벤티지 현재가를 그대로 넣고 싶으면 설정 탭의 <b>벤티지 현재가로 계산</b>을 쓰세요. 오프셋은 이 브라우저에
        저장되어 새로고침해도 유지됩니다.
        {state.extra.status === 'scanning' && <span className="fx-extra"> · Twelve Data 보조 페어 수신 중…</span>}
        {state.extra.status === 'error' && state.extra.error && (
          <span className="fx-extra err"> · Twelve Data: {state.extra.error}</span>
        )}
      </div>
    </section>
  );
}
