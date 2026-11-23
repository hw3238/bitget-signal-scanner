/**
 * 실전 주문 콕핏 — 시그널 카드에서 바로 비트겟에 넣을 주문 수량·증거금을 계산한다.
 *
 * 트레이더가 실제로 지켜야 하는 것은 "이 시그널이 틀렸을 때 내 시드에서 얼마만 잃는가"다.
 * 그래서 손절가까지의 거리와 1회 허용 손실(시드 × 리스크 %)로 수량을 역산한다.
 *   수량 = (시드 × 리스크%) ÷ |진입가 − 손절가|
 *   포지션 규모 = 수량 × 진입가
 *   필요 증거금 = 포지션 규모 ÷ 레버리지
 * 거래소 계약 정보(minTradeNum·volumePlace·minTradeUSDT)가 있으면 주문 가능한 수량으로
 * 내림해 실제로 비트겟에 넣을 수 있는 값으로 맞춘다(내림이라 손실은 계획보다 커지지 않는다).
 * 화면에 보이는 모든 수치는 이 파일의 순수 함수로만 만든다 (scripts/cockpit-check.ts 검증).
 */
import type { Side, Signal } from '../engine/types';
import type { TradeStyle } from './profile';
import { stopDistancePct, targetDistancePct } from './profile';

/** 매매 성향별 기본 리스크 비율(%) — 1회 주문에서 잃어도 되는 시드 비율 */
export const STYLE_RISK_PCT: Record<TradeStyle, number> = {
  conservative: 1.5,
  aggressive: 3,
};

/** 설정 화면에서 고를 수 있는 리스크 비율(%) — 50%까지(직접 입력도 0.5~50%) */
export const RISK_PRESETS = [1, 2, 3, 5, 10, 20, 30, 50] as const;

/** 리스크 비율 상·하한 — 0.5%~50%. 10% 이상은 화면에서 고위험으로 경고한다. */
export const RISK_MIN = 0.5;
export const RISK_MAX = 50;
/** 이 값 이상이면 '고위험 설정' 안내를 띄운다 */
export const RISK_HIGH_WARN = 10;

/** 직접 입력 허용 범위 */
export const RISK_INPUT_MIN = 0.5;
export const RISK_INPUT_MAX = 50;

export function defaultRiskPct(style: TradeStyle): number {
  return STYLE_RISK_PCT[style] ?? STYLE_RISK_PCT.conservative;
}

/** 설정값이 없으면(null) 성향 기본값을 쓴다. */
export function resolveRiskPct(style: TradeStyle, override?: number | null): number {
  if (override != null && Number.isFinite(override) && override > 0) {
    return Math.min(RISK_MAX, Math.max(RISK_MIN, override));
  }
  return defaultRiskPct(style);
}

/** 화면 입력값을 0.5~50% 안으로 정리한다(0.1 단위). */
export function clampRiskInput(value: number): number {
  if (!Number.isFinite(value)) return RISK_INPUT_MIN;
  const snapped = Math.round(value * 10) / 10;
  return Math.min(RISK_INPUT_MAX, Math.max(RISK_INPUT_MIN, snapped));
}

export function isHighRisk(riskPct: number | null | undefined): boolean {
  return riskPct != null && Number.isFinite(riskPct) && riskPct >= RISK_HIGH_WARN;
}

/** 비트겟 USDT-M 계약의 주문 단위 정보 */
export interface ContractSpec {
  /** 최소 주문 수량(코인 단위) */
  minTradeNum?: number;
  /** 수량 소수 자리 */
  volumePlace?: number;
  /** 수량 배수 — 최소 주문 단위 = max(10^(-volumePlace), sizeMultiplier) */
  sizeMultiplier?: number;
  /** 최소 주문 금액(USDT) */
  minTradeUsdt?: number;
}

export interface OrderPlanInput {
  seed: number;
  /** 1회 허용 손실률(%) */
  riskPct: number;
  leverage: number;
  side: Side;
  entry: number;
  stop: number;
  target: number;
  /** 거래소 주문 단위 — 없으면 코인 수량 그대로 계산한다. */
  spec?: ContractSpec;
}

export interface OrderPlan {
  valid: boolean;
  error: string | null;
  /** 실제 적용된 리스크 비율(%) */
  riskPct: number;
  /** 손절 도달 시 잃는 금액(양수 · 거래소 단위로 내림한 실제 값) */
  riskUsd: number;
  /** 주문 수량(코인 단위) */
  qty: number;
  /** 주문 수량 소수 자리 — 거래소 volumePlace, 없으면 null */
  qtyDecimals: number | null;
  /** 포지션 규모(USDT) = 수량 × 진입가 */
  notional: number;
  /** 필요 증거금(USDT) = 포지션 규모 ÷ 레버리지 */
  margin: number;
  leverage: number;
  /** 손절 도달 손익(음수) */
  stopLossUsd: number;
  /** 1차 목표 도달 수익(양수) */
  profitUsd: number;
  /** 목표 도달 시 시드 대비 수익률(%) */
  profitRoiPct: number;
  /** 손절 도달 시 시드 대비 손실률(%) */
  lossRoiPct: number;
  rr: number;
  stopDistPct: number;
  targetDistPct: number;
  /** 필요 증거금이 시드보다 커서 그대로는 주문할 수 없는 경우 */
  overSeed: boolean;
  /** 거래소 최소 주문 수량보다 작은 경우 */
  belowMinQty: boolean;
  /** 거래소 최소 주문 금액보다 작은 경우 */
  belowMinNotional: boolean;
  /** 최소 주문 수량(코인 단위) — 없으면 null */
  minQty: number | null;
}

const EMPTY: OrderPlan = {
  valid: false,
  error: null,
  riskPct: 0,
  riskUsd: 0,
  qty: 0,
  qtyDecimals: null,
  notional: 0,
  margin: 0,
  leverage: 1,
  stopLossUsd: 0,
  profitUsd: 0,
  profitRoiPct: 0,
  lossRoiPct: 0,
  rr: 0,
  stopDistPct: 0,
  targetDistPct: 0,
  overSeed: false,
  belowMinQty: false,
  belowMinNotional: false,
  minQty: null,
};

/** 시그널 한 건의 실전 주문 계획 — 방향·가격이 어긋나면 계산하지 않는다. */
export function planOrder(input: OrderPlanInput): OrderPlan {
  const { seed, riskPct, entry, stop, target, side, spec } = input;
  const leverage = Math.max(1, Math.round(Number(input.leverage) || 1));
  if (![seed, riskPct, entry, stop, target, leverage].every((v) => Number.isFinite(v) && v > 0)) {
    return { ...EMPTY, error: '시드·리스크·가격이 모두 0보다 커야 합니다.' };
  }
  if (side === 'long') {
    if (!(stop < entry && target > entry)) return { ...EMPTY, error: '롱은 손절가 < 진입가 < 목표가여야 합니다.' };
  } else if (!(stop > entry && target < entry)) {
    return { ...EMPTY, error: '숏은 목표가 < 진입가 < 손절가여야 합니다.' };
  }

  const stopDist = Math.abs(entry - stop);
  if (!(stopDist > 0)) return { ...EMPTY, error: '손절가가 진입가와 같습니다.' };

  const volumePlace =
    spec?.volumePlace != null && Number.isFinite(spec.volumePlace)
      ? Math.max(0, Math.min(8, Math.round(spec.volumePlace)))
      : null;
  // 실제 최소 주문 단위 = max(10^-volumePlace, sizeMultiplier). (Bitget sizeMultiplier 는
  //   BTC 0.0001 · MSTR 0.01 처럼 10^-volumePlace 와 같은 값이거나, 1·10 처럼 더 큰 단위다)
  const sizeMult =
    spec?.sizeMultiplier != null && Number.isFinite(spec.sizeMultiplier) && spec.sizeMultiplier > 0
      ? spec.sizeMultiplier
      : 0;
  const step = volumePlace != null ? Math.max(Math.pow(10, -volumePlace), sizeMult) : 0;

  const plannedRisk = (seed * riskPct) / 100;
  let qty = plannedRisk / stopDist;
  // 거래소 수량 단위로 내림 — 계획한 리스크를 넘지 않게
  if (step > 0) qty = Math.floor(qty / step + 1e-9) * step;
  qty = Number(qty.toPrecision(12));
  if (!(qty > 0)) return { ...EMPTY, error: '주문 수량이 거래소 최소 단위보다 작습니다.' };

  const notional = qty * entry;
  const margin = notional / leverage;
  const targetDist = Math.abs(target - entry);
  const profitUsd = qty * targetDist;
  const riskUsd = qty * stopDist;
  const stopDistPct = stopDistancePct({ entry, stop });
  const targetDistPct = targetDistancePct({ entry, target });
  const minQty = spec?.minTradeNum != null && spec.minTradeNum > 0 ? spec.minTradeNum : null;
  const minNotional = spec?.minTradeUsdt != null && spec.minTradeUsdt > 0 ? spec.minTradeUsdt : null;

  return {
    valid: true,
    error: null,
    riskPct,
    riskUsd,
    qty,
    qtyDecimals: volumePlace,
    notional,
    margin,
    leverage,
    stopLossUsd: -riskUsd,
    profitUsd,
    profitRoiPct: (profitUsd / seed) * 100,
    lossRoiPct: -(riskUsd / seed) * 100,
    rr: targetDist / stopDist,
    stopDistPct,
    targetDistPct,
    overSeed: margin > seed * (1 + 1e-9),
    belowMinQty: minQty != null && qty < minQty - 1e-12,
    belowMinNotional: minNotional != null && notional < minNotional - 1e-9,
    minQty,
  };
}

/** 시그널 값으로 바로 쓰는 편의 함수 */
export function planOrderForSignal(
  signal: Pick<Signal, 'side' | 'entry' | 'stop' | 'target'>,
  opts: { seed: number; riskPct: number; leverage: number; spec?: ContractSpec },
): OrderPlan {
  return planOrder({
    seed: opts.seed,
    riskPct: opts.riskPct,
    leverage: opts.leverage,
    side: signal.side,
    entry: signal.entry,
    stop: signal.stop,
    target: signal.target,
    spec: opts.spec,
  });
}

/**
 * 화면 표기용 수량 — 거래소 수량 자리(volumePlace)가 있으면 그대로,
 * 없으면 자릿수에 맞춰 줄인다(시바·페페는 정수, 비트는 소수).
 */
export function formatQty(qty: number, volumePlace?: number | null): string {
  if (!Number.isFinite(qty) || qty <= 0) return '-';
  if (volumePlace != null && Number.isFinite(volumePlace)) {
    const d = Math.max(0, Math.min(8, Math.round(volumePlace)));
    return qty.toLocaleString('en-US', { maximumFractionDigits: d });
  }
  if (qty >= 1000) return qty.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (qty >= 1) return qty.toLocaleString('en-US', { maximumFractionDigits: 3 });
  if (qty >= 0.01) return qty.toLocaleString('en-US', { maximumFractionDigits: 5 });
  if (qty >= 0.0001) return qty.toLocaleString('en-US', { maximumFractionDigits: 7 });
  return trimZeros(qty.toPrecision(3));
}

/** USDT 금액 — 부호 없는 표기(증거금·포지션 규모) */
export function fmtUsd(value: number): string {
  if (!Number.isFinite(value)) return '$—';
  const abs = Math.abs(value);
  const body =
    abs >= 1000
      ? Math.round(abs).toLocaleString('en-US')
      : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? '-' : ''}$${body}`;
}

function trimZeros(text: string): string {
  const trimmed = text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

/** 비트겟 주문 화면에 그대로 붙여넣는 수량 — 지수 표기·콤마 없이 거래소 자리수 그대로 */
export function copyQtyText(qty: number, volumePlace?: number | null): string {
  if (!Number.isFinite(qty) || qty <= 0) return '';
  if (volumePlace != null && Number.isFinite(volumePlace)) {
    const d = Math.max(0, Math.min(8, Math.round(volumePlace)));
    const fixed = qty.toFixed(d);
    return d > 0 ? trimZeros(fixed) : fixed;
  }
  if (qty >= 1e9) return Math.round(qty).toString();
  const fixed = qty.toFixed(8);
  return trimZeros(fixed) || '0';
}

/** 진입가 복사용 — 콤마 없이, 부동소수 잡음 없이 */
export function copyPriceText(price: number, decimals?: number): string {
  if (!Number.isFinite(price) || price <= 0) return '';
  if (decimals != null && Number.isFinite(decimals)) {
    const d = Math.max(0, Math.min(8, Math.round(decimals)));
    return trimZeros(price.toFixed(d));
  }
  return String(Number(price.toPrecision(10)));
}
