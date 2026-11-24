import type { Signal } from '../engine/types';

/**
 * 투자 성향 — v1.5.5 부터 수동 시드 입력은 없어졌고 성향(레버리지·기본 리스크)만 남는다.
 * 시드(자본)는 언제나 연결된 비트겟 계좌의 실시간 잔고(`lib/account.ts`)를 쓴다.
 */
export type TradeStyle = 'conservative' | 'aggressive';

export interface Profile {
  style: TradeStyle;
  updatedAt: number;
}

export const PROFILE_KEY = 'cota.profile.v1';

export const STYLE_META: Record<TradeStyle, { label: string; emoji: string; range: string; desc: string }> = {
  conservative: {
    label: '보수적 매매',
    emoji: '🛡️',
    range: '추천 2x ~ 5x',
    desc: '원금 보호와 낮은 청산 위험을 우선합니다. 손절 폭이 넓은 종목은 배율을 낮춥니다.',
  },
  aggressive: {
    label: '공격적 매매',
    emoji: '⚡',
    range: '추천 10x ~ 25x',
    desc: '높은 기대 수익을 우선하되, 손절가에 닿기 전에 청산되지 않도록 안전 마진을 지킵니다.',
  },
};

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Profile> & { seed?: unknown };
    // v1.5.4 이하 저장본에는 seed 가 들어 있다 — 시드는 이제 계좌 잔고가 기준이라 버린다.
    const style: TradeStyle = parsed.style === 'aggressive' ? 'aggressive' : 'conservative';
    return { style, updatedAt: Number(parsed.updatedAt) || Date.now() };
  } catch {
    return null;
  }
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* 저장할 수 없는 환경 */
  }
}

/** 천단위 콤마 — `1,000` */
export function fmtSeed(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Math.round(value).toLocaleString('en-US');
}

/** 손절 폭(%) — 진입가 대비 손절가 거리 */
export function stopDistancePct(signal: Pick<Signal, 'entry' | 'stop'>): number {
  const entry = Math.abs(signal.entry) || 1;
  return (Math.abs(signal.entry - signal.stop) / entry) * 100;
}

/** 목표가까지 거리(%) */
export function targetDistancePct(signal: Pick<Signal, 'entry' | 'target'>): number {
  const entry = Math.abs(signal.entry) || 1;
  return (Math.abs(signal.target - signal.entry) / entry) * 100;
}

export interface Recommendation {
  leverage: number;
  style: TradeStyle;
  /** 손절 폭(%) */
  stopPct: number;
  /** 청산까지 남는 여유(%) — 100 / leverage */
  liquidationPct: number;
  /** 이 배율에서 손절가 도달 시 시드 손실 비율(%) */
  stopLossPct: number;
  /** 안전 마진을 넘지 않는 최대 배율 */
  safeMax: number;
}

/**
 * COTA 추천 레버리지.
 *  · 손절 폭이 좁을수록, 승률·손익비가 좋을수록 높아진다.
 *  · 보수적: 2x~5x · 손절 시 시드 손실을 12% 안쪽으로 억제한다.
 *  · 공격적: 10x~25x · floor(80 / 손절폭) 안전 마진을 절대 넘지 않는다
 *    (손절 폭이 너무 넓으면 10x 아래로도 내려간다 — 청산 방지 우선).
 */
export function recommendLeverage(
  signal: Pick<Signal, 'entry' | 'stop' | 'target' | 'winRate' | 'rr'>,
  style: TradeStyle,
): Recommendation {
  const stopPct = Math.max(0.2, stopDistancePct(signal));
  const winRate = Number.isFinite(signal.winRate) ? signal.winRate : 55;
  const rr = Number.isFinite(signal.rr) ? Math.max(0.5, signal.rr) : 1.5;

  // 승률 55%·손익비 1.5R 를 기준선(1.0)으로 두는 품질 계수 (0.85 ~ 1.15)
  const quality = Math.min(
    1.15,
    Math.max(0.85, 1 + (winRate - 55) / 60 + (rr - 1.5) / 9),
  );

  if (style === 'conservative') {
    // 손절 시 시드 손실 12% 이내 + 손절 폭이 좁을수록 가점
    const riskCap = 12 / stopPct;
    const raw = Math.min(20 / stopPct, riskCap) * quality;
    const leverage = Math.round(Math.min(5, Math.max(2, raw)));
    return {
      leverage,
      style,
      stopPct,
      liquidationPct: 100 / leverage,
      stopLossPct: stopPct * leverage,
      safeMax: Math.floor(riskCap),
    };
  }

  // 공격적 — floor(80 / 손절폭) 을 안전 상한으로 절대 넘지 않는다.
  const safeMax = Math.floor(80 / stopPct);
  const raw = Math.min(safeMax, 25) * Math.min(1, quality);
  const leverage = Math.max(2, Math.min(25, Math.round(raw)));
  return {
    leverage,
    style,
    stopPct,
    liquidationPct: 100 / leverage,
    stopLossPct: stopPct * leverage,
    safeMax,
  };
}

export interface SeedPnl {
  /** 목표가 도달 시 수익금(USDT) */
  profitUsd: number;
  /** 손절가 도달 시 손실금(USDT, 음수) */
  lossUsd: number;
  /** 목표 도달 수익률(%) */
  profitPct: number;
  /** 손절 도달 손실률(%) */
  lossPct: number;
}

/** 시드 × 레버리지 × 가격 변동률로 예상 손익을 계산한다. */
export function seedPnl(
  signal: Pick<Signal, 'entry' | 'stop' | 'target'>,
  leverage: number,
  seed: number,
): SeedPnl {
  const toTarget = targetDistancePct(signal);
  const toStop = stopDistancePct(signal);
  const profitPct = leverage * toTarget;
  const lossPct = -leverage * toStop;
  return {
    profitUsd: (seed * profitPct) / 100,
    lossUsd: (seed * lossPct) / 100,
    profitPct,
    lossPct,
  };
}

/** `+$240.00` · `-$96.00` */
export function fmtUsdAmount(value: number): string {
  if (!Number.isFinite(value)) return '$—';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const body =
    abs >= 1000
      ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}$${body}`;
}
