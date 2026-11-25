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
    range: '상한 없음 · 유동 (청산 안전마진까지)',
    desc: '레버리지 상한을 두지 않고 손절 폭·승률·실시간 잔고에 맞춰 25x 이상도 유동적으로 씁니다. 즉시 청산을 막는 안전 마진과 거래소 최대 배율만 지킵니다.',
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

/* ------------------------------------------------------------------ *
 * 잔고 구간 — 같은 시그널이라도 계좌가 작으면 최소 주문금액을 못 채우고,
 * 계좌가 크면 같은 배율이 슬리피지·청산 위험을 키운다. 그래서 잔고 구간별로
 * 추천 배율을 유동적으로 바꾼다(v1.5.6).
 * ------------------------------------------------------------------ */

export type BalanceTier = 'small' | 'standard' | 'mid' | 'large';

export interface BalanceTierMeta {
  key: BalanceTier;
  label: string;
  range: string;
  /** 기본 배율에 곱하는 계수 (1 = 표준) */
  factor: number;
  note: string;
}

/** 잔고 구간 경계 — 소액 $100 미만 / 표준 $100~$1,000 / 중형 $1,000~$5,000 / 대형 $5,000+ */
export const BALANCE_TIERS: BalanceTierMeta[] = [
  {
    key: 'small',
    label: '소액 시드',
    range: '$100 미만',
    factor: 1.25,
    note: '최소 주문금액을 채우도록 스타일 상단 배율(청산 안전마진 안에서)',
  },
  {
    key: 'standard',
    label: '표준 시드',
    range: '$100 ~ $1,000',
    factor: 1,
    note: '기본 균형 배율',
  },
  {
    key: 'mid',
    label: '중형 시드',
    range: '$1,000 ~ $5,000',
    factor: 0.85,
    note: '자금 보존·슬리피지 억제로 한 단계 낮춤',
  },
  {
    key: 'large',
    label: '대형 시드',
    range: '$5,000 이상',
    factor: 0.7,
    note: '주문 충격·슬리피지를 줄이도록 더 낮춤',
  },
];

const TIER_BY_KEY: Record<BalanceTier, BalanceTierMeta> = BALANCE_TIERS.reduce(
  (acc, tier) => ({ ...acc, [tier.key]: tier }),
  {} as Record<BalanceTier, BalanceTierMeta>,
);

/**
 * 잔고 → 구간. 잔고를 모르면(미연결·0) null — 이때는 기존과 같은 성향 기준 배율을 쓴다.
 *   $99 → small · $100 → standard · $999 → standard · $1,000 → mid · $5,000 → large
 */
export function balanceTierOf(equity?: number | null): BalanceTier | null {
  const value = Number(equity ?? 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 100) return 'small';
  if (value < 1000) return 'standard';
  if (value < 5000) return 'mid';
  return 'large';
}

export function balanceTierMeta(tier: BalanceTier | null): BalanceTierMeta | null {
  return tier ? TIER_BY_KEY[tier] : null;
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
  /** 청산 안전마진 — floor(80 / 손절폭). 이 배율은 절대 넘지 않는다 */
  safeMax: number;
  /** 추천에 반영한 계좌 총 자산(없으면 null) */
  equity: number | null;
  /** 잔고 구간(없으면 null) */
  tier: BalanceTier | null;
  /** 화면 표기용 구간 라벨 — `소액 시드 · $85` */
  tierLabel: string | null;
  /** 잔고 구간 계수(1 = 표준) */
  balanceFactor: number;
  /** 잔고 구간 때문에 배율이 실제로 달라졌는가 */
  balanceApplied: boolean;
  /** 왜 이 배율인지 한 줄 */
  note: string;
}

/**
 * 공격적 스타일의 레버리지 상한 — **고정 25x 캡을 두지 않는다**(v1.5.6 현우님 지시).
 *  · 배율은 손절 폭·품질·실시간 잔고로 유동적으로 계산되고, 넘지 않는 유일한 선은
 *    청산 안전마진(safeMax)과 거래소 종목 최대 배율(계약 maxLever)이다.
 *  · 거래소 최대 배율을 모를 때의 안전 상한은 100x 다.
 */
export const SAFETY_MAX_LEVERAGE = 100;

/** 거래소 종목 최대 배율(계약 스펙) — 모르면 안전 상한 100x */
export function exchangeLeverageCap(maxLever?: number | null): number {
  const value = Number(maxLever ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 1000) : SAFETY_MAX_LEVERAGE;
}

/** 성향 기본 배율 — 잔고를 반영하기 전의 계산(기존 2인자 동작과 동일, 공격적은 상한 없음) */
function baseLeverage(stopPct: number, style: TradeStyle, quality: number): number {
  if (style === 'conservative') {
    // 손절 시 시드 손실 12% 이내 + 손절 폭이 좁을수록 가점
    const riskCap = 12 / stopPct;
    const raw = Math.min(20 / stopPct, riskCap) * quality;
    return Math.round(Math.min(5, Math.max(2, raw)));
  }
  // 공격적 — 고정 상한 없이 floor(80 / 손절폭) 안전마진까지만. 품질이 낮으면 그만큼 낮춘다.
  const safeMax = Math.max(2, Math.floor(80 / stopPct));
  const raw = Math.min(safeMax, SAFETY_MAX_LEVERAGE) * Math.min(1, quality);
  return Math.max(2, Math.round(raw));
}

/** 잔고 반영 — 구간 계수·상단 허용·청산 안전마진을 함께 적용한다. */
function balanceLeverage(
  base: number,
  style: TradeStyle,
  tier: BalanceTier,
  safeMax: number,
  exchangeCap: number,
): number {
  // 보수적은 5x(손절 시 시드 손실 12% 이내) — 공격적은 고정 상한 없이 안전마진·거래소 상한까지.
  const styleCap = style === 'conservative' ? 5 : Math.min(SAFETY_MAX_LEVERAGE, exchangeCap);
  const safety = Math.max(1, Math.floor(safeMax));
  if (tier === 'small') {
    // 소액 — 최소 주문금액($5)을 채우도록 스타일 상단까지 허용하되 청산 안전마진은 넘지 않는다.
    return Math.max(1, Math.min(styleCap, safety));
  }
  if (tier === 'standard') return Math.max(1, Math.min(styleCap, safety, base));
  // 중형·대형 — 같은 손절 폭에서 배율을 낮춰 자금 보존·슬리피지 억제
  const factor = TIER_BY_KEY[tier].factor;
  return Math.max(1, Math.min(styleCap, safety, Math.round(base * factor)));
}

/**
 * COTA 추천 레버리지.
 *  · 손절 폭이 좁을수록, 승률·손익비가 좋을수록 높아진다.
 *  · 보수적: 2x~5x · 손절 시 시드 손실을 12% 안쪽으로 억제한다.
 *  · 공격적: 10x~25x · floor(80 / 손절폭) 안전 마진을 절대 넘지 않는다
 *    (손절 폭이 너무 넓으면 10x 아래로도 내려간다 — 청산 방지 우선).
 *  · equity 를 주면 **실시간 잔고 구간**을 반영한다(v1.5.6):
 *    소액($100 미만)은 최소 주문금액 확보를 위해 스타일 상단 배율, 표준은 기본,
 *    중형·대형은 슬리피지·자금 보존을 위해 단계적으로 낮춘다. safeMax 는 어느 구간에서도 넘지 않는다.
 */
export function recommendLeverage(
  signal: Pick<Signal, 'entry' | 'stop' | 'target' | 'winRate' | 'rr'>,
  style: TradeStyle,
  equity?: number | null,
  /** 거래소 종목 최대 배율(계약 maxLever) — 모르면 안전 상한 100x */
  maxLever?: number | null,
): Recommendation {
  const stopPct = Math.max(0.2, stopDistancePct(signal));
  const winRate = Number.isFinite(signal.winRate) ? signal.winRate : 55;
  const rr = Number.isFinite(signal.rr) ? Math.max(0.5, signal.rr) : 1.5;

  // 승률 55%·손익비 1.5R 를 기준선(1.0)으로 두는 품질 계수 (0.85 ~ 1.15)
  const quality = Math.min(
    1.15,
    Math.max(0.85, 1 + (winRate - 55) / 60 + (rr - 1.5) / 9),
  );

  // 청산 안전마진 — floor(80 / 손절폭). 최소 2x 는 허용하되 거래소 최대 배율은 넘지 않는다.
  const exchangeCap = exchangeLeverageCap(maxLever);
  const safeMax = Math.max(2, Math.floor(80 / stopPct));
  const base = Math.min(exchangeCap, baseLeverage(stopPct, style, quality));
  const tier = balanceTierOf(equity);
  const meta = balanceTierMeta(tier);
  const balanceFactor = meta?.factor ?? 1;
  const leverage = tier ? balanceLeverage(base, style, tier, safeMax, exchangeCap) : base;
  const equityValue = Number(equity ?? 0);
  const hasEquity = tier != null && Number.isFinite(equityValue) && equityValue > 0;
  const tierLabel = hasEquity && meta ? `${meta.label} · $${Math.round(equityValue).toLocaleString('en-US')}` : null;
  const note = hasEquity && meta
    ? leverage === base
      ? `${meta.label} $${Math.round(equityValue).toLocaleString('en-US')} · ${meta.note} → ${leverage}x`
      : `${meta.label} $${Math.round(equityValue).toLocaleString('en-US')} · ${meta.note} → ${base}x에서 ${leverage}x로 조정`
    : `${style === 'conservative' ? '보수적' : '공격적(상한 없음·유동)'} 기준 ${leverage}x · 청산 안전마진 ${safeMax}x · 거래소 최대 ${exchangeCap}x 이내`;

  return {
    leverage,
    style,
    stopPct,
    liquidationPct: 100 / leverage,
    stopLossPct: stopPct * leverage,
    safeMax,
    equity: hasEquity ? equityValue : null,
    tier,
    tierLabel,
    balanceFactor,
    balanceApplied: hasEquity && leverage !== base,
    note,
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
