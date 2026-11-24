/**
 * 🛡 SL 도달 전 선제 청산(조기 손절) 규칙 — v1.5.4
 *
 *  사용자 요청: "자동매매 때 SL에 닿기 전 손절을 해야 된다고 판단이 되는 경우 손절해도 돼"
 *
 *  손절가까지 기다리지 않고 청산하는 **객관적인 세 가지 경우**만 다룬다.
 *   · 반대 시그널 — 포지션을 연 뒤 같은 종목에 반대 방향의 유효 시그널이 새로 포착됨
 *   · 구조 붕괴 — 마지막으로 **마감된** 캔들이 진입 반대쪽으로 강한 장대봉으로 마감하며
 *     단기 EMA(9)와 진입가를 함께 이탈(추세 훼손)
 *   · 본절 보호 — +0.8R 이상 갔던 포지션이 본절 부근까지 되돌아옴
 *
 *  휩쏘 방지 원칙:
 *   · 진입 후 최소 2분은 건드리지 않는다(첫 흔들림 보호)
 *   · 마감된 캔들만 본다(진행 중 캔들의 꼬리로 판단하지 않음)
 *   · 작은 몸통·EMA 근처 노이즈는 무시(장대봉 + 0.15% 이상 이탈 요구)
 *   · 손절가 −0.95R 이내로 이미 붙었으면 거래소 SL에 맡긴다
 *   · 같은 종목은 5분에 한 번만 시도한다(서비스 쪽 쿨다운)
 *
 *  네이티브(`AutoTradeService` + `EarlyStopRule.java`)가 같은 규칙으로 실제 청산을 하고,
 *  이 파일은 웹에서 같은 판단을 보여 주고 검증하기 위한 순수 함수다.
 */
import type { Side } from '../engine/types';

export interface EarlyExitCandle {
  /** 마감 시각(ms) — 진행 중인 봉은 넣지 않는다 */
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface EarlyExitInput {
  /** 설정의 `조기 손절 보호` 토글 */
  enabled: boolean;
  side: Side;
  entry: number;
  /** 거래소에 걸어 둔 손절가 */
  stop: number;
  /** 현재가(마크/체결가) */
  price: number;
  /** 포지션 진입 시각(ms) */
  openedAt: number;
  now: number;
  /** 진입 후 도달한 최대 유리 R (모르면 0) */
  peakR?: number;
  /** 포지션을 연 뒤 같은 종목에 새로 포착된 **반대 방향** 시그널 시각(없으면 0) */
  oppositeSignalAt?: number;
  /** 마감된 캔들 — 오래된 → 최신 순 */
  candles: EarlyExitCandle[];
}

export type EarlyExitCode =
  | 'off'
  | 'none'
  | 'too-early'
  | 'near-stop'
  | 'opposite-signal'
  | 'structure-break'
  | 'breakeven';

export interface EarlyExitDecision {
  exit: boolean;
  code: EarlyExitCode;
  /** 로그·알림에 그대로 쓰는 사람 말 사유 */
  reason: string;
  /** 현재 손익 R */
  currentR: number;
}

/** 진입 직후 휩쏘 보호 — 이 시간 동안은 조기 손절하지 않는다 */
export const EARLY_STOP_MIN_AGE_MS = 120_000;
/** 반대 시그널로 청산할 때 인정하는 최대 시그널 경과 시간 */
export const EARLY_STOP_SIGNAL_MAX_AGE_MS = 6 * 3_600_000;
/** 같은 종목 조기 손절 재시도 간격 */
export const EARLY_STOP_COOLDOWN_MS = 5 * 60_000;
/** 장대봉 기준 — 직전 10봉 평균 몸통의 배수 */
export const EARLY_STOP_BODY_MULT = 1.3;
/** 장대봉 최소 몸통 비율(가격 대비) — 저가 코인의 잔물결 제외 */
const MIN_BODY_PCT = 0.0015;

/** 손익 R — 진입가·손절가로 정규화한 현재 손익(롱: +가 이익) */
export function rMultiple(side: Side, entry: number, stop: number, price: number): number {
  if (!(entry > 0) || !(stop > 0) || !(price > 0)) return 0;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return 0;
  return ((side === 'long' ? price - entry : entry - price) / risk);
}

/** 지수이동평균의 마지막 값 */
export function emaLast(values: number[], period = 9): number {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i += 1) ema = values[i] * k + ema * (1 - k);
  return ema;
}

export function evaluateEarlyExit(input: EarlyExitInput): EarlyExitDecision {
  const { side, entry, stop, price, openedAt, now } = input;
  const currentR = rMultiple(side, entry, stop, price);
  const no = (code: EarlyExitCode, reason: string): EarlyExitDecision => ({ exit: false, code, reason, currentR });

  if (!input.enabled) return no('off', '조기 손절 보호가 꺼져 있습니다.');
  if (!(entry > 0) || !(stop > 0) || !(price > 0)) return no('none', '진입가·손절가·현재가를 확인하지 못했습니다.');
  // 손절가를 이미 지났거나 −0.95R 이내로 붙었으면 거래소 SL 이 처리한다.
  if (side === 'long' ? price <= stop : price >= stop) return no('near-stop', '손절가에 이미 닿아 SL 처리에 맡깁니다.');
  if (currentR <= -0.95) return no('near-stop', '손절가 −0.95R 이내 — SL 처리에 맡깁니다.');
  if (now - openedAt < EARLY_STOP_MIN_AGE_MS) return no('too-early', '진입 직후 2분 보호 구간입니다.');

  /* 1) 반대 방향 시그널 — 진입 뒤에 포착된 것만 */
  const signalAt = Number(input.oppositeSignalAt ?? 0);
  if (
    signalAt > openedAt &&
    now - signalAt <= EARLY_STOP_SIGNAL_MAX_AGE_MS &&
    currentR < 0.3
  ) {
    return { exit: true, code: 'opposite-signal', reason: '반대 방향 시그널 감지', currentR };
  }

  /* 2) 구조 붕괴 — 마감된 캔들 기준 */
  const candles = input.candles ?? [];
  if (candles.length >= 12) {
    const last = candles[candles.length - 1];
    const prev = candles.slice(-11, -1);
    const avgBody = prev.reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / prev.length;
    const body = Math.abs(last.close - last.open);
    const ema = emaLast(candles.slice(-30).map((c) => c.close), 9);
    const against = side === 'long' ? last.close < last.open : last.close > last.open;
    const strong = avgBody > 0 && body >= avgBody * EARLY_STOP_BODY_MULT && body / last.close >= MIN_BODY_PCT;
    const beyondEma = side === 'long' ? last.close < ema * (1 - 0.0005) : last.close > ema * (1 + 0.0005);
    const inLoss = side === 'long' ? last.close < entry : last.close > entry;
    if (against && strong && beyondEma && inLoss && currentR <= -0.1) {
      return {
        exit: true,
        code: 'structure-break',
        reason: `추세 구조 이탈 — ${side === 'long' ? '음봉' : '양봉'} 마감이 진입가·EMA9을 함께 이탈`,
        currentR,
      };
    }
  }

  /* 3) 본절 보호 — +0.8R 이상 갔던 포지션이 본절 부근으로 되돌아옴 */
  const peak = Number(input.peakR ?? 0);
  if (peak >= 0.8 && currentR <= 0.05 && currentR > -0.4) {
    return { exit: true, code: 'breakeven', reason: `본절 보호 — 최대 +${peak.toFixed(2)}R → ${currentR.toFixed(2)}R`, currentR };
  }

  return no('none', '조기 손절 조건에 해당하지 않습니다.');
}

/** 조기 손절 로그 문구 — 네이티브와 같은 형식 */
export function earlyExitLogText(args: {
  demo: boolean;
  base: string;
  side: Side;
  qty: string;
  reason: string;
  currentR: number;
  entry: number;
}): string {
  const label = args.demo ? '[모의]' : '[실거래]';
  const r = Number.isFinite(args.currentR) ? args.currentR.toFixed(2) : '0.00';
  return `🛡 조기 손절 ${label} ${args.base} ${args.side === 'long' ? '롱' : '숏'} ${args.qty} @ ${args.entry} — ${args.reason} · ${r}R`;
}
