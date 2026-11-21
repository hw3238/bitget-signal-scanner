import type { Signal } from '../engine/types';

/** 종목 표시 이름(예: `XAUUSD+`) → 가격 오프셋 */
export type OffsetMap = Record<string, number>;

/**
 * 호가 보정 저장 키 별칭 — `BTCUSD+` 카드는 호가 보정 표의 기존 ★ BTC 입력(비트겟 BTCUSDT 기준)을
 * 그대로 쓴다. 이미 저장된 오프셋이 있어도 그대로 반영된다.
 */
const OFFSET_ALIAS: Record<string, string> = { 'BTCUSD+': 'BTC' };

/** 표시 이름 → 오프셋 저장 키 */
export function offsetKeyFor(base: string): string {
  return OFFSET_ALIAS[base] ?? base;
}

export function offsetFor(base: string, offsets?: OffsetMap | null): number {
  if (!offsets) return 0;
  const key = offsetKeyFor(base);
  for (const k of key === base ? [base] : [key, base]) {
    const v = offsets[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return 0;
}

/**
 * 벤티지 호가 보정: 현재가·진입·목표·EQ·무효와 캔들 가격을 같은 값만큼 평행 이동한다.
 * 손익비·R배수는 가격 차이의 비율이라 오프셋에 영향받지 않고, 수익률(%)만 이동한 진입가 기준으로 다시 계산한다.
 */
export function shiftSignal(signal: Signal, offset: number): Signal {
  if (!offset) return signal;
  const entry = signal.entry + offset;
  const price = signal.price + offset;
  const changePct = ((price - entry) / (entry || 1)) * 100 * (signal.side === 'long' ? 1 : -1);
  return {
    ...signal,
    entry,
    stop: signal.stop + offset,
    target: signal.target + offset,
    eq: signal.eq + offset,
    price,
    changePct,
    levRoi: changePct * (signal.leverage || 10),
    candles: signal.candles.map((c) => ({
      t: c.t,
      o: c.o + offset,
      h: c.h + offset,
      l: c.l + offset,
      c: c.c + offset,
      v: c.v,
    })),
  };
}

/** `+0.35`, `-0.0002`, `0.00` 형태 */
export function fmtOffset(value: number, decimals = 2): string {
  if (!Number.isFinite(value) || value === 0) return (0).toFixed(decimals);
  const sign = value > 0 ? '+' : '−';
  return `${sign}${Math.abs(value).toFixed(decimals)}`;
}

/** 1틱 크기 — EURUSD(4) → 0.0001, XAUUSD(2) → 0.01 */
export function fxStep(decimals: number): number {
  return 10 ** -Math.max(0, Math.min(8, Math.round(decimals)));
}
