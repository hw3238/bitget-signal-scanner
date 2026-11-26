import type { AssetClass, Signal, TF } from './types';
import type { ProprAssetType } from './proprUniverse';
import { PROPR_LISTINGS, PROPR_UNIVERSE_AT, proprBadgeLabel, proprBase } from './proprUniverse';

/**
 * 🏆 Propr 5K 터보 전용 계산 엔진 (순수 함수 — `npm run check:propr` 가 직접 검증)
 *
 * 5K Turbo 1-Step 규정 (propr.xyz/rules · 2026-11-26 확인)
 *  · 시작 잔고 $5,000 · 목표 +9% (+$450 → $5,450)
 *  · 1일 최대 손실 3% (당일 시작 잔고 기준, UTC 00:00 리셋, 미실현 포함 equity 터치 즉시 탈락)
 *  · 최대 낙폭 3% 정적(static) — 하한 $4,850 고정, 터치 즉시 탈락
 *  · 시간 제한·최소 거래일·일관성 룰 없음
 *  · 자산군별 최대 레버리지: BTC/ETH/SOL 10x · 기타 코인 2x · 주식 4x · SP500/XYZ100 10x ·
 *    기타 지수 5x · 금·은·CL·브렌트 8x · 기타 원자재 5x · FX 25x
 */

export const TURBO_5K = {
  startBalance: 5000,
  targetPct: 9,
  targetProfit: 450,
  targetBalance: 5450,
  dailyLossPct: 3,
  maxDrawdownPct: 3,
  floorBalance: 4850,
  /** 최소 진입 금액(Hyperliquid $10) — 주문 가이드 하한 표시용 */
  minNotional: 10,
} as const;

/** 1회 리스크 선택지 — 0.5%($25) 를 추천값으로 둔다. */
export const PROPR_RISK_CHOICES = [
  { pct: 0.5, label: '0.5%', recommended: true },
  { pct: 0.75, label: '0.75%', recommended: false },
  { pct: 1, label: '1.0%', recommended: false },
] as const;

export type ProprRiskPct = (typeof PROPR_RISK_CHOICES)[number]['pct'];

/** 화면 필터 자산군 */
export type ProprGroup = 'all' | 'majors' | 'alt' | 'rwa';

export const PROPR_FILTERS: { key: ProprGroup; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'majors', label: 'BTC·ETH·SOL' },
  { key: 'alt', label: '기타코인' },
  { key: 'rwa', label: '주식·원자재·지수·FX' },
];

/** Hyperliquid 실시간 시세 + Propr 상장 정보를 합친 종목 */
export interface ProprMarket {
  /** Hyperliquid 코인 id — `BTC` 또는 `xyz:TSLA` (캔들 조회 키) */
  coin: string;
  /** 표시용 기본 심볼 — `BTC` · `TSLA` */
  base: string;
  /** 메인 덱이면 null, HIP-3 덱이면 덱 이름(`xyz`) */
  dex: string | null;
  type: ProprAssetType;
  /** Propr 종목별 최대 레버리지(자산군 상한과의 최솟값) */
  maxLever: number;
  /** 왕복(진입+청산) 테이커 수수료(%) */
  takerPct: number;
  price: number;
  prevDayPx: number;
  change24h: number;
  /** 미결제약정 달러 환산 */
  oiUsd: number;
  /** 24시간 거래대금(USD) */
  volume24h: number;
  /** 시간당 펀딩비(%) */
  fundingPct: number;
  decimals: number;
  asset: AssetClass;
  szDecimals?: number;
}

/** 탐지 결과 한 건 — 시그널 + 그 종목의 Propr 상장 정보 */
export interface ProprHit {
  signal: Signal;
  market: ProprMarket;
  /** 카드 배지 문구 — `지수 10x` 등 */
  badge: string;
}

export function proprGroupOf(market: Pick<ProprMarket, 'type' | 'base'>): Exclude<ProprGroup, 'all'> {
  if (market.type === 'CRYPTO') return market.base === 'BTC' || market.base === 'ETH' || market.base === 'SOL' ? 'majors' : 'alt';
  return 'rwa';
}

/* ================================================================== *
 * 1) 5K 터보 계좌 트래커
 * ================================================================== */

export interface TurboAccount {
  startBalance: number;
  /** 현재 잔고(사용자가 입력·조정) */
  balance: number;
  /** 오늘 시작 잔고 — 일일 손실 한도의 기준 */
  dayStart: number;
  targetBalance: number;
  targetProfit: number;
  /** 목표까지 남은 금액(이미 넘었으면 0) */
  remainingUsd: number;
  /** 시작 잔고 대비 손익($) */
  profitUsd: number;
  /** 진행률(%) — 0~100 으로 자른 표시용 */
  progressPct: number;
  /** 진행률(%) — 자르지 않은 실제 값(음수 가능) */
  rawProgressPct: number;
  /** 절대 탈락 하한(정적 낙폭) */
  floorBalance: number;
  /** 하한까지 남은 금액 */
  floorRoomUsd: number;
  /** 오늘 쓸 수 있는 손실 한도($) = 당일 시작 잔고 × 3% */
  dailyRoomUsd: number;
  /** 오늘의 탈락선(equity floor) */
  dailyFloor: number;
  /** 오늘 탈락선까지 남은 금액 */
  dailyRoomLeftUsd: number;
  passed: boolean;
  breached: boolean;
  /** 다음 일일 한도 리셋(UTC 00:00) 시각(ms) */
  nextResetAt: number;
  /** 리셋까지 남은 시간(시간 단위) */
  hoursToReset: number;
}

export function nextUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
}

export function turboAccount(balance: number, dayStart?: number, now = Date.now()): TurboAccount {
  const b = Number.isFinite(balance) && balance > 0 ? balance : TURBO_5K.startBalance;
  const d0 = Number.isFinite(dayStart as number) && (dayStart as number) > 0 ? (dayStart as number) : b;
  const profitUsd = b - TURBO_5K.startBalance;
  const rawProgressPct = (profitUsd / TURBO_5K.targetProfit) * 100;
  const dailyRoomUsd = (d0 * TURBO_5K.dailyLossPct) / 100;
  const dailyFloor = d0 - dailyRoomUsd;
  const nextResetAt = nextUtcMidnight(now);
  return {
    startBalance: TURBO_5K.startBalance,
    balance: b,
    dayStart: d0,
    targetBalance: TURBO_5K.targetBalance,
    targetProfit: TURBO_5K.targetProfit,
    remainingUsd: Math.max(0, TURBO_5K.targetBalance - b),
    profitUsd,
    progressPct: Math.max(0, Math.min(100, rawProgressPct)),
    rawProgressPct,
    floorBalance: TURBO_5K.floorBalance,
    floorRoomUsd: b - TURBO_5K.floorBalance,
    dailyRoomUsd,
    dailyFloor,
    dailyRoomLeftUsd: b - dailyFloor,
    passed: b >= TURBO_5K.targetBalance,
    breached: b <= TURBO_5K.floorBalance || b <= dailyFloor,
    nextResetAt,
    hoursToReset: Math.max(0, (nextResetAt - now) / 3_600_000),
  };
}

/* ================================================================== *
 * 2) 프랍 전용 주문 가이드 (리스크 → 포지션 → 배율)
 * ================================================================== */

export interface ProprGuideInput {
  side: Signal['side'];
  entry: number;
  stop: number;
  target: number;
  balance: number;
  /** 1회 리스크(%) — 0.5 / 0.75 / 1.0 */
  riskPct: number;
  /** Propr 종목 최대 레버리지 */
  cap: number;
  /** 오늘 남은 일일 손실 한도($) — 기본은 잔고의 3% */
  dailyRoomUsd?: number;
  /** 목표까지 남은 금액($) — 기본 450 (5K 터보) */
  remainingToTargetUsd?: number;
}

export interface ProprGuide {
  valid: boolean;
  error: string | null;
  /** 이 거래에 걸리는 리스크($) */
  riskUsd: number;
  /** 손절폭(%) */
  stopPct: number;
  /** 목표까지 거리(%) */
  targetPct: number;
  /** 포지션 금액(명목, $) */
  notional: number;
  /** 수량(기초자산 단위) */
  qty: number;
  /** 추천 레버리지 — Propr 상한 이하의 최소 배율 */
  leverage: number;
  cap: number;
  /** 필요 증거금($) */
  margin: number;
  /** 증거금이 잔고에서 차지하는 비율(%) */
  marginPct: number;
  /** 손절 시 잃는 금액(음수 표기용 양수) */
  lossUsd: number;
  /** 목표 도달 시 버는 금액($) */
  profitUsd: number;
  /** 손익비 */
  rr: number;
  /** 목표 달성률(%) — 이 한 건이 $450 목표에서 차지하는 몫 */
  targetSharePct: number;
  /** 일일 한도 소진율(%) */
  dailyRoomUsePct: number;
  /** 상한 배율 때문에 리스크가 줄었는지 */
  capped: boolean;
  /** 주문 가능한 최소 금액($10)보다 작은지 */
  belowMin: boolean;
  warnings: string[];
}

export function proprOrderGuide(input: ProprGuideInput): ProprGuide {
  const { side, entry, stop, target, balance, riskPct, cap } = input;
  const empty: ProprGuide = {
    valid: false,
    error: null,
    riskUsd: 0,
    stopPct: 0,
    targetPct: 0,
    notional: 0,
    qty: 0,
    leverage: 1,
    cap,
    margin: 0,
    marginPct: 0,
    lossUsd: 0,
    profitUsd: 0,
    rr: 0,
    targetSharePct: 0,
    dailyRoomUsePct: 0,
    capped: false,
    belowMin: false,
    warnings: [],
  };
  if (![entry, stop, target, balance, riskPct, cap].every((v) => Number.isFinite(v) && v > 0)) {
    return { ...empty, error: '가격·잔고·리스크 값을 확인해 주세요.' };
  }
  // 방향과 손절·목표가가 맞지 않으면 계산하지 않는다
  if (side === 'long' ? !(stop < entry && target > entry) : !(stop > entry && target < entry)) {
    return { ...empty, error: '방향과 손절·목표가가 맞지 않습니다.' };
  }
  const stopDist = Math.abs(entry - stop);
  const targetDist = Math.abs(target - entry);
  const stopPct = (stopDist / entry) * 100;
  const targetPct = (targetDist / entry) * 100;
  const rr = targetDist / stopDist;
  const riskUsdTarget = (balance * riskPct) / 100;

  // 손절폭으로 역산한 포지션 금액 → 상한 배율로 담을 수 있는 금액까지만
  const wantNotional = riskUsdTarget / (stopPct / 100);
  const capNotional = balance * cap;
  const capped = wantNotional > capNotional + 1e-9;
  const notional = Math.max(0, Math.min(wantNotional, capNotional));
  const riskUsd = (notional * stopPct) / 100;
  // 상한 이하에서 명목을 담을 수 있는 **최소** 배율 — 배율을 올려도 손익은 그대로다.
  const leverage = Math.max(1, Math.min(cap, Math.ceil(notional / balance - 1e-9)));
  const margin = notional / leverage;
  const marginPct = (margin / balance) * 100;
  const profitUsd = riskUsd * rr;
  const dailyRoomUsd = input.dailyRoomUsd && input.dailyRoomUsd > 0 ? input.dailyRoomUsd : (balance * TURBO_5K.dailyLossPct) / 100;
  const remaining = input.remainingToTargetUsd && input.remainingToTargetUsd > 0 ? input.remainingToTargetUsd : TURBO_5K.targetProfit;

  const warnings: string[] = [];
  if (capped) {
    warnings.push(`상한 ${cap}x 로는 이 손절폭에서 원하는 리스크를 다 담을 수 없어 $${riskUsd.toFixed(0)} 로 줄였습니다.`);
  }
  if (riskUsd >= dailyRoomUsd * 0.9) {
    warnings.push(`한 번 손절로 일일 한도 $${dailyRoomUsd.toFixed(0)} 중 $${riskUsd.toFixed(0)} 를 씁니다 — 손절 한 번에 계좌가 끝날 수 있습니다.`);
  } else if (riskUsd >= dailyRoomUsd / 2) {
    warnings.push(`한 번 손절이 일일 한도의 ${((riskUsd / dailyRoomUsd) * 100).toFixed(0)}% 입니다.`);
  }
  if (marginPct > 50) {
    warnings.push(`증거금이 잔고의 ${marginPct.toFixed(0)}% — 배율을 한 단계 올리면 여유가 생깁니다.`);
  }
  if (notional < TURBO_5K.minNotional) {
    warnings.push(`포지션이 $${TURBO_5K.minNotional} 미만이라 주문이 거절될 수 있습니다.`);
  }

  return {
    valid: notional > 0,
    error: null,
    riskUsd,
    stopPct,
    targetPct,
    notional,
    qty: notional / entry,
    leverage,
    cap,
    margin,
    marginPct,
    lossUsd: riskUsd,
    profitUsd,
    rr,
    targetSharePct: (profitUsd / remaining) * 100,
    dailyRoomUsePct: (riskUsd / dailyRoomUsd) * 100,
    capped,
    belowMin: notional < TURBO_5K.minNotional,
    warnings,
  };
}

/* ================================================================== *
 * 3) 필터 · 정렬
 * ================================================================== */

export interface ProprFilter {
  group: ProprGroup;
  tf: TF;
  openOnly: boolean;
}

export function matchProprFilter(hit: ProprHit, filter: ProprFilter): boolean {
  if (hit.signal.tf !== filter.tf) return false;
  if (filter.openOnly && hit.signal.state !== 'open') return false;
  if (filter.group === 'all') return true;
  return proprGroupOf(hit.market) === filter.group;
}

/** 진행중 우선 → 전수 승률·기대값 → 최근 감지 순 */
export function rankProprHits(hits: ProprHit[]): ProprHit[] {
  const score = (h: ProprHit) => h.signal.winRate * (h.signal.strategyExp + 0.4) * (h.signal.star / 5);
  return [...hits].sort((a, b) => {
    const rank = (h: ProprHit) => (h.signal.state === 'open' ? 0 : 1);
    return rank(a) - rank(b) || score(b) - score(a) || b.signal.detectedAt - a.signal.detectedAt;
  });
}

/* ================================================================== *
 * 4) 복사용 주문 문구 (propr.xyz 에 그대로 붙여넣는 용도)
 * ================================================================== */

export function fmtUsd(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '—';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function fmtPx(price: number, decimals: number): string {
  if (!Number.isFinite(price)) return '—';
  return price.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function proprPlanLines(hit: ProprHit, guide: ProprGuide): string {
  const m = hit.market;
  const s = hit.signal;
  if (!guide.valid) return `🏆 Propr 5K 터보 · ${m.base} — ${guide.error ?? '계산 불가'}`;
  return [
    `🏆 Propr 5K 터보 · ${m.base} ${s.tf} ${s.side === 'long' ? '롱' : '숏'}`,
    `진입 ${fmtPx(s.entry, m.decimals)} · 손절 ${fmtPx(s.stop, m.decimals)} (-${guide.stopPct.toFixed(2)}%) · 목표 ${fmtPx(s.target, m.decimals)} (${guide.rr.toFixed(1)}R)`,
    `레버리지 ${guide.leverage}x (Propr 상한 ${guide.cap}x) · 포지션 ${fmtUsd(guide.notional)} · 증거금 ${fmtUsd(guide.margin)}`,
    `손절 -${fmtUsd(guide.lossUsd, 2)} (일일 한도 ${guide.dailyRoomUsePct.toFixed(0)}%) · 목표 +${fmtUsd(guide.profitUsd, 2)} (목표 $450의 ${guide.targetSharePct.toFixed(0)}%)`,
    `전략 ${s.strategyShort} · 승률 ${s.winRate.toFixed(1)}% (${s.winRateBasis === 'market' ? '마켓 실측' : '전수 검증'}) · ${s.star}★`,
    `Propr 유니버스 ${PROPR_UNIVERSE_AT} 기준 · ${proprBadgeLabel(m.base, m.type)} · 수수료 ${m.takerPct.toFixed(3)}%`,
  ].join('\n');
}

/** 카드 상단 종목 배지 — `xyz:AAPL` → `AAPL` */
export function proprDisplayName(coin: string): string {
  return proprBase(coin);
}

/** 스냅숏 종목 수 — 화면 안내 문구 */
export function proprUniverseCount(): number {
  return PROPR_LISTINGS.length;
}
