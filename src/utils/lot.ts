import type { Signal } from '../engine/types';

/**
 * FX 탭은 배수(x) 대신 랏(Lot) 단위로 손익을 보여준다.
 * 달러 손익은 MT5·Vantage 표준 계약 크기(Contract Size)로 계산한다.
 *   · 금·백금·팔라듐·XAUT·PAXG: 1 Lot = 100 oz
 *   · 은: 1 Lot = 5,000 oz
 *   · 구리: 1 Lot = 25,000 lbs
 *   · 원유(USOIL·UKOIL): 1 Lot = 1,000 배럴 · 천연가스: 1 Lot = 10,000 MMBtu
 *   · FX: 1 Lot = 100,000 (USD 견적은 가격차 × 100,000 × lot,
 *     USD/XXX·XXX/JPY는 (가격차 ÷ 청산가) × 100,000 × lot 로 달러 환산)
 *   · 지수(DXY 포함): 1 Lot = 1 계약 = 1포인트당 $1
 */

export const LOT_PRESETS = [0.01, 0.05, 0.1, 0.2, 0.5, 1] as const;
export const DEFAULT_LOT = 0.1;

export interface LotSpec {
  /** 1 Lot 당 계약 수량 (oz · 배럴 · 통화 단위 · 계약) */
  size: number;
  /** quote: 견적통화가 USD / usd: 청산가로 나눠 USD 환산 */
  mode: 'quote' | 'usd';
  /** 1포인트(핍) 가격 크기 */
  pip: number;
  pipUnit: '핍' | '포인트';
  /** 카드·공유카드에 쓰는 계약 크기 설명 */
  label: string;
}

const gold: LotSpec = { size: 100, mode: 'quote', pip: 0.01, pipUnit: '포인트', label: '1 Lot = 100 oz' };

const FIXED: Record<string, LotSpec> = {
  XAU: gold,
  XAUT: { ...gold, label: '1 Lot = 100 oz' },
  PAXG: { ...gold, label: '1 Lot = 100 oz' },
  XPT: { ...gold, label: '1 Lot = 100 oz' },
  XPD: { ...gold, label: '1 Lot = 100 oz' },
  XAG: { size: 5000, mode: 'quote', pip: 0.01, pipUnit: '포인트', label: '1 Lot = 5,000 oz' },
  COPPER: { size: 25000, mode: 'quote', pip: 0.01, pipUnit: '포인트', label: '1 Lot = 25,000 lbs' },
  CL: { size: 1000, mode: 'quote', pip: 0.01, pipUnit: '포인트', label: '1 Lot = 1,000 배럴' },
  BZ: { size: 1000, mode: 'quote', pip: 0.01, pipUnit: '포인트', label: '1 Lot = 1,000 배럴' },
  USOIL: { size: 1000, mode: 'quote', pip: 0.01, pipUnit: '포인트', label: '1 Lot = 1,000 배럴' },
  UKOIL: { size: 1000, mode: 'quote', pip: 0.01, pipUnit: '포인트', label: '1 Lot = 1,000 배럴' },
  NATGAS: { size: 10000, mode: 'quote', pip: 0.001, pipUnit: '포인트', label: '1 Lot = 10,000 MMBtu' },
};

/** 금·백금·팔라듐·XAUT·PAXG는 Vantage 표기(XAUUSD+)으로도 같은 계약 크기를 쓴다. */
const METAL_100 = ['XAUT', 'XAU', 'XPT', 'XPD', 'PAXG'];

/** 지수 CFD — 1 Lot = 1 계약, 1포인트당 $1 */
const INDEX: LotSpec = { size: 1, mode: 'quote', pip: 1, pipUnit: '포인트', label: '1 Lot = 1계약 · 1p = $1' };

const INDEX_BASES = new Set([
  'DXY',
  'NDX100',
  'NAS100',
  'SP500',
  'US500',
  'JP225',
  'HSI',
  'HK50',
  'KR200',
  'US30',
  'GER40',
  'UK100',
]);

const FX_SPEC_CACHE = new Map<string, LotSpec>();

/** EURUSD+ · XAUUSD+ 같은 표시 이름에서 계약 사양을 찾는다. */
export function lotSpec(base: string): LotSpec {
  const key = base.replace(/\+$/, '').toUpperCase();
  const fixed = FIXED[key];
  if (fixed) return fixed;
  // XAUUSD+ · XAGUSD+ · XPTUSD+ · XPDUSD+ · XAUT+ · PAXG+ — 견적통화가 붙어 있어도 금속 계약
  if (METAL_100.some((m) => key.startsWith(m))) return FIXED.XAU;
  if (key.startsWith('XAG')) return FIXED.XAG;
  if (INDEX_BASES.has(key)) return INDEX;

  const cached = FX_SPEC_CACHE.get(key);
  if (cached) return cached;

  let spec: LotSpec = { size: 1, mode: 'quote', pip: 1, pipUnit: '포인트', label: '1 Lot = 1계약 · 1p = $1' };
  if (/^[A-Z]{6}$/.test(key)) {
    const baseCcy = key.slice(0, 3);
    const quoteCcy = key.slice(3);
    // USD/XXX(USDJPY·USDCAD…)와 XXX/JPY는 견적통화가 USD가 아니므로 청산가로 나눠 환산한다.
    const usdMode = baseCcy === 'USD' || quoteCcy === 'JPY' || quoteCcy === 'CAD' || quoteCcy === 'CHF' || quoteCcy === 'BRL';
    spec = {
      size: 100000,
      mode: usdMode ? 'usd' : 'quote',
      pip: quoteCcy === 'JPY' ? 0.01 : 0.0001,
      pipUnit: '핍',
      label: `1 Lot = 100,000 ${baseCcy}`,
    };
  }
  FX_SPEC_CACHE.set(key, spec);
  return spec;
}

export interface LotPrices {
  entry: number;
  price: number;
  target: number;
  stop: number;
  eq: number;
  side: 'long' | 'short';
}

export interface LotCalc {
  spec: LotSpec;
  lot: number;
  /** 현재 평가 손익 (USD) */
  pnl: number;
  /** 목표 도달 시 손익 (USD) */
  targetUsd: number;
  /** 무효(손절) 도달 시 손익 (USD, 음수) */
  stopUsd: number;
  /** 반익(EQ) 도달 시 손익 (USD) */
  eqUsd: number;
  /** 1핍(포인트)당 달러 */
  pipUsd: number;
  currentPips: number;
  targetPips: number;
  stopPips: number;
}

function usd(diff: number, spec: LotSpec, lot: number, refPrice: number): number {
  const raw = diff * spec.size * lot;
  return spec.mode === 'usd' && refPrice > 0 ? raw / refPrice : raw;
}

/** 가격(오프셋 적용 후)으로 랏 손익을 계산한다. */
export function lotCalc(spec: LotSpec, lot: number, p: LotPrices): LotCalc {
  const dir = p.side === 'long' ? 1 : -1;
  const move = (exit: number) => (exit - p.entry) * dir;
  const ref = p.price > 0 ? p.price : p.entry;
  return {
    spec,
    lot,
    pnl: usd(move(p.price), spec, lot, p.price),
    targetUsd: usd(move(p.target), spec, lot, p.target),
    stopUsd: usd(move(p.stop), spec, lot, p.stop),
    eqUsd: usd(move(p.eq), spec, lot, p.eq),
    pipUsd: usd(spec.pip, spec, lot, ref),
    currentPips: move(p.price) / spec.pip,
    targetPips: Math.abs(move(p.target)) / spec.pip,
    stopPips: Math.abs(move(p.stop)) / spec.pip,
  };
}

/** 시그널(오프셋 적용 후)로 랏 손익을 계산한다. */
export function lotCalcForSignal(signal: Signal, lot: number): LotCalc {
  return lotCalc(lotSpec(signal.base), lot, {
    entry: signal.entry,
    price: signal.price,
    target: signal.target,
    stop: signal.stop,
    eq: signal.eq,
    side: signal.side,
  });
}

export function fmtLot(lot: number): string {
  return Number.isFinite(lot) ? lot.toFixed(2) : '0.10';
}

/** `+$125.00` · `-$42.50` · `$0.00` */
export function fmtUsd(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '$—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const body =
    abs >= 10000
      ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${sign}$${body}`;
}

/** 핍/포인트 값 — `250` · `12,500` */
export function fmtPips(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const abs = Math.abs(value);
  if (abs >= 100) return Math.round(abs).toLocaleString('en-US');
  if (abs >= 1) return abs.toFixed(1);
  return abs.toFixed(2);
}

/** 설정에 저장된 랏 프리셋만 허용하고, 아니면 기본 0.10 */
export function normalizeLot(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LOT;
  const match = LOT_PRESETS.find((p) => Math.abs(p - n) < 1e-9);
  return match ?? DEFAULT_LOT;
}
