import type { Side, Setup, TF } from './types';

/**
 * 손절폭(진입가 대비 손절가 거리, %) 허용 범위 — 정밀 타점 기준.
 *  · 하한: 1봉 노이즈에 휩쏘되지 않을 최소 폭
 *  · 상한: 손절이 멀어 R 대비 손실이 커지는 시그널을 원천 차단
 * 실제 Bitget 200봉 스캔으로 시그널 수가 마르지 않는 지점을 검증해 확정한다.
 */
export const STOP_WIDTH: Record<TF, { min: number; max: number }> = {
  '1H': { min: 0.3, max: 2.5 },
  '4H': { min: 0.3, max: 3.5 },
};

/** 구조 손절(스윙·오더블록·FVG 경계)과 진입가 사이 허용 거리 — ATR 배수 상한.
 *  이보다 멀면 타점이 구조에서 이탈한 것으로 보고 시그널을 만들지 않는다. */
export const STOP_ATR_CAP: Record<TF, number> = {
  '1H': 1.4,
  '4H': 1.7,
};

/** 진입가 대비 손절폭(%) */
export function riskPctOf(entry: number, stop: number): number {
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stop)) return Number.POSITIVE_INFINITY;
  return (Math.abs(entry - stop) / entry) * 100;
}

export interface TightStopInput {
  side: Side;
  entry: number;
  /** 구조적 무효화 지점(직전 스윙 고·저점, 오더블록/FVG 경계, 신호 캔들 극값) */
  rawStop: number;
  atr: number;
  tf: TF;
}

/** 구조 손절을 타점에 붙이고(버퍼 최소화) 노이즈 하한까지 조인 뒤, 상한·ATR 상한을 넘으면 폐기 */
export function tightenStop({ side, entry, rawStop, atr, tf }: TightStopInput): { stop: number; risk: number } | null {
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(rawStop)) return null;
  const { min, max } = STOP_WIDTH[tf];
  const structural = side === 'long' ? entry - rawStop : rawStop - entry;
  if (!(structural > 0)) return null;

  // 구조가 ATR 대비 너무 멀면 타점이 이미 이탈한 것 — 정밀 타점 아님
  const atrCap = STOP_ATR_CAP[tf];
  if (atr > 0 && structural > atrCap * atr) return null;

  // 노이즈 하한: 구조가 지나치게 가까우면 최소 폭까지 벌려 휩쏘를 막는다
  const floor = (entry * min) / 100;
  const risk = Math.max(structural, floor);

  // 상한 초과는 폐기 (손절이 넓은 시그널은 만들지 않는다)
  const pct = (risk / entry) * 100;
  if (pct > max + 1e-9) return null;

  const stop = side === 'long' ? entry - risk : entry + risk;
  if (!(stop > 0)) return null;
  return { stop, risk };
}

export const MIN_RR = 1.5;

/** 최종 시그널 검증 — 가격 양수·손익비·손절폭 범위를 모두 통과해야 한다 */
export function validateSetup(setup: Setup, tf: TF): Setup | null {
  const { entry, stop, target } = setup;
  if (!(entry > 0) || !(stop > 0) || !(target > 0)) return null;
  if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(target)) return null;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  const pct = riskPctOf(entry, stop);
  const { min, max } = STOP_WIDTH[tf];
  if (pct < min - 1e-9 || pct > max + 1e-9) return null;
  if (setup.side === 'long') {
    if (!(stop < entry && target > entry)) return null;
  } else if (!(stop > entry && target < entry)) return null;
  const rr = Math.abs(target - entry) / risk;
  if (rr < MIN_RR - 1e-9) return null;
  return setup;
}

/** 손절폭 상한/하한 안내 문구 — UI 동기화용 */
export const STOP_WIDTH_NOTE = `손절폭 상한 1H ${STOP_WIDTH['1H'].max}% · 4H ${STOP_WIDTH['4H'].max}%`;
