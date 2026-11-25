import type { Signal } from '../engine/types';

/**
 * COTA 추천 레버리지 (v1.5.7)
 *
 * 매매 스타일(보수적/공격적) 선택과 프리셋은 **없어졌다**. 이제 배율은 오직
 *   ① 실시간 계좌 잔고(`equity`) 구간 ② 손절 폭(청산 안전마진) ③ 시그널 품질(승률·손익비)
 *   ④ 거래소 종목 최대 배율(`maxLever`)
 * 만으로 유동적으로 계산된다. 사용자가 고르는 것은 '매매 스타일'이 아니라
 * 실제 숫자(1회 리스크 · 레버리지 상한 · 포지션 수 …)뿐이다.
 *
 *  · 고정 상한은 없다 — 유일한 선은 **청산 안전마진**(floor(80 / 손절폭))과
 *    **거래소 종목 최대 배율**이다. 그 안에서 잔고 구간이 클수록 슬리피지·주문 충격을 줄이려
 *    단계적으로 낮춘다(소액은 최소 주문금액을 채우도록 높게).
 *  · 자동매매도 같은 값을 그대로 쓴다(`maxLeverage: 0 = 상한 없음 · 유동`).
 */

/* ------------------------------------------------------------------ *
 * 표기 도우미 (화면·공유 카드가 함께 쓴다)
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * 잔고 구간 — 같은 시그널이라도 계좌가 작으면 최소 주문금액을 못 채우고,
 * 계좌가 크면 같은 배율이 슬리피지·청산 위험을 키운다.
 * ------------------------------------------------------------------ */

export type BalanceTier = 'small' | 'standard' | 'mid' | 'large';

export interface BalanceTierMeta {
  key: BalanceTier;
  label: string;
  range: string;
  /** 청산 안전마진에 곱하는 계수 (1 = 안전마진까지 그대로) */
  factor: number;
  note: string;
}

/** 잔고 구간 경계 — 소액 $100 미만 / 표준 $100~$1,000 / 중형 $1,000~$5,000 / 대형 $5,000+ */
export const BALANCE_TIERS: BalanceTierMeta[] = [
  {
    key: 'small',
    label: '소액 시드',
    range: '$100 미만',
    factor: 1,
    note: '최소 주문금액을 채우도록 청산 안전마진까지 사용',
  },
  {
    key: 'standard',
    label: '표준 시드',
    range: '$100 ~ $1,000',
    factor: 0.85,
    note: '안전마진의 85%로 균형 배율',
  },
  {
    key: 'mid',
    label: '중형 시드',
    range: '$1,000 ~ $5,000',
    factor: 0.7,
    note: '자금 보존·슬리피지 억제로 한 단계 낮춤',
  },
  {
    key: 'large',
    label: '대형 시드',
    range: '$5,000 이상',
    factor: 0.55,
    note: '주문 충격·슬리피지를 줄이도록 더 낮춤',
  },
];

const TIER_BY_KEY: Record<BalanceTier, BalanceTierMeta> = BALANCE_TIERS.reduce(
  (acc, tier) => ({ ...acc, [tier.key]: tier }),
  {} as Record<BalanceTier, BalanceTierMeta>,
);

/**
 * 잔고 → 구간. 잔고를 모르면(미연결·0) null — 이때는 표준 구간 계수로 계산한다.
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

/** 레버리지를 모를 때의 안전 상한 — 거래소 최대 배율(maxLever)을 모르면 이 값을 넘지 않는다 */
export const SAFETY_MAX_LEVERAGE = 100;

/** 청산 안전마진 배수 — floor(80 / 손절폭) 이 배율을 넘으면 청산선이 손절가에 너무 가깝다 */
export const SAFE_STOP_MULTIPLE = 80;

/** 거래소 종목 최대 배율(계약 스펙) — 모르면 안전 상한 100x */
export function exchangeLeverageCap(maxLever?: number | null): number {
  const value = Number(maxLever ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 1000) : SAFETY_MAX_LEVERAGE;
}

export interface Recommendation {
  leverage: number;
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
  /** 잔고 구간 계수(1 = 안전마진 그대로) */
  balanceFactor: number;
  /** 잔고 구간 때문에 배율이 실제로 달라졌는가 */
  balanceApplied: boolean;
  /** 왜 이 배율인지 한 줄 */
  note: string;
}

/**
 * COTA 추천 레버리지 — 잔고·손절 폭·시그널 품질·거래소 최대 배율만 쓴다.
 *  · 손절 폭이 좁을수록, 승률·손익비가 좋을수록 높아진다.
 *  · 청산 안전마진 `floor(80 / 손절폭)` 을 절대 넘지 않는다 — 청산선이 손절가보다 항상 뒤에 있다.
 *  · 잔고 구간은 그 안전마진에 계수(소액 1 · 표준 0.85 · 중형 0.7 · 대형 0.55)를 곱한다.
 *    소액은 최소 주문금액($5)을 채우도록 높게, 대형은 주문 충격·슬리피지를 줄이도록 낮게.
 */
export function recommendLeverage(
  signal: Pick<Signal, 'entry' | 'stop' | 'target' | 'winRate' | 'rr'>,
  equity?: number | null,
  /** 거래소 종목 최대 배율(계약 maxLever) — 모르면 안전 상한 100x */
  maxLever?: number | null,
): Recommendation {
  const stopPct = Math.max(0.2, stopDistancePct(signal));
  const winRate = Number.isFinite(signal.winRate) ? signal.winRate : 55;
  const rr = Number.isFinite(signal.rr) ? Math.max(0.5, signal.rr) : 1.5;

  // 승률 55%·손익비 1.5R 를 기준선(1.0)으로 두는 품질 계수 (0.85 ~ 1.15)
  const quality = Math.min(1.15, Math.max(0.85, 1 + (winRate - 55) / 60 + (rr - 1.5) / 9));

  const exchangeCap = exchangeLeverageCap(maxLever);
  // 청산 안전마진 — floor(80 / 손절폭). 최소 2x, 거래소 최대 배율·안전 상한은 넘지 않는다.
  const safeMax = Math.max(2, Math.floor(SAFE_STOP_MULTIPLE / stopPct));
  const tier = balanceTierOf(equity);
  const meta = balanceTierMeta(tier);
  const balanceFactor = meta?.factor ?? TIER_BY_KEY.standard.factor;
  const cap = Math.min(safeMax, exchangeCap, SAFETY_MAX_LEVERAGE);
  const raw = safeMax * balanceFactor * quality;
  const leverage = Math.max(2, Math.min(cap, Math.round(raw)));
  const equityValue = Number(equity ?? 0);
  const hasEquity = tier != null && Number.isFinite(equityValue) && equityValue > 0;
  const tierLabel = hasEquity && meta ? `${meta.label} · $${Math.round(equityValue).toLocaleString('en-US')}` : null;
  const note = hasEquity && meta
    ? `${meta.label} $${Math.round(equityValue).toLocaleString('en-US')} · ${meta.note} → ${leverage}x (청산 안전마진 ${safeMax}x · 거래소 최대 ${exchangeCap}x)`
    : `잔고 미확인 · 청산 안전마진 ${safeMax}x · 거래소 최대 ${exchangeCap}x 이내 → ${leverage}x`;

  return {
    leverage,
    stopPct,
    liquidationPct: 100 / leverage,
    stopLossPct: stopPct * leverage,
    safeMax,
    equity: hasEquity ? equityValue : null,
    tier,
    tierLabel,
    balanceFactor,
    balanceApplied: hasEquity && leverage !== Math.max(2, Math.min(cap, Math.round(safeMax * quality))),
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
