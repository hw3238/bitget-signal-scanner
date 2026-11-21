import type { Signal } from '../engine/types';

/**
 * FX 탭에 함께 보여줄 코인 CFD.
 * 스캐너 탭이 이미 받아 둔 비트겟 BTCUSDT 캔들·시그널을 벤티지 MT5 표기(BTCUSD+)로 바꿔
 * 그대로 재사용한다 — 추가 API 호출 없이 FX 탭에 바로 나타난다.
 */
export interface FxCryptoMeta {
  /** 비트겟 계약 심볼(이미 스캔된 데이터) */
  symbol: string;
  /** FX 탭 표시 이름 — 벤티지 MT5 호가 이름 */
  base: string;
  /** 화면 보조 설명 */
  note: string;
  /** 가격 소수점 자리수(비트겟 BTCUSDT pricePlace 준용) */
  decimals: number;
}

export const FX_CRYPTO_UNIVERSE: FxCryptoMeta[] = [
  { symbol: 'BTCUSDT', base: 'BTCUSD+', note: '비트코인 · 1 Lot = 1 BTC', decimals: 1 },
];

const BY_SYMBOL = new Map(FX_CRYPTO_UNIVERSE.map((m) => [m.symbol, m]));

export function fxCryptoMeta(symbol: string): FxCryptoMeta | undefined {
  return BY_SYMBOL.get(symbol);
}

/** FX 탭에서 코인 CFD로 보여줄 비트겟 계약인지 */
export function isFxCryptoSymbol(symbol: string): boolean {
  return BY_SYMBOL.has(symbol);
}

/**
 * 시그널을 FX 탭 카드로 바꾼다.
 * 이미 FX·금 시그널이거나 대응하는 코인 CFD가 없으면 그대로 돌려준다(호출부에서 asset으로 거른다).
 */
export function toFxView(signal: Signal): Signal {
  if (signal.asset === 'fx') return signal;
  const meta = BY_SYMBOL.get(signal.symbol);
  if (!meta) return signal;
  return { ...signal, base: meta.base, asset: 'fx', decimals: meta.decimals };
}

/** FX 탭에 표시할 시그널 = 기존 FX·금·원자재·지수 + BTCUSD+ */
export function fxTabSignals(signals: Signal[]): Signal[] {
  return signals.map(toFxView).filter((s) => s.asset === 'fx');
}

/** FX 탭 즐겨찾기 대상 — FX·금 시그널과 BTCUSD+ 코인 CFD */
export function isFxFavorite(signal: Signal): boolean {
  return signal.asset === 'fx' || isFxCryptoSymbol(signal.symbol);
}
