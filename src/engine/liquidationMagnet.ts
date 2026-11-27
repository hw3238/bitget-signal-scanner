/**
 * 🧲 청산 자석(스퀴즈) 레이더 엔진 — "청산 물량이 어디에 몰려 있는가"를 공개 데이터로 추정한다.
 *
 * 원칙
 *  1) 거래소가 청산 좌표를 공개하지 않으므로, **관측 가능한 것만** 쓴다:
 *     스윙 고점·저점(1H/4H 캔들) · 봉 거래량 · 펀딩비 · 미결제약정(OI).
 *     → 청산 물량은 **추정치**다. 화면은 '추정'이라고 말하고, 없는 데이터(OI 등)는 비운다.
 *  2) 자석 위치의 원리는 단순하다.
 *     · 스윙 **고점** 근처에서 숏을 잡은 사람들 → 가격이 오르면 그 위에서 **숏 청산**(상방 자석)
 *     · 스윙 **저점** 근처에서 롱을 잡은 사람들 → 가격이 내리면 그 아래에서 **롱 청산**(하방 자석)
 *     청산가는 진입가 ± (1/레버리지 − 유지증거금률) 로 계산한다(10x/20x/25x/50x).
 *  3) 펀딩비가 한쪽으로 과열되면 그쪽 포지션이 붐빈다는 뜻 → 반대 방향 청산 자석에 가점.
 *  4) 점수(0~100)는 절대적 예측이 아니라 **상대 비교**용이다(같은 화면 안 종목끼리).
 */
import type { Candle } from './types';

/** 비트겟 USDT-M 1단계 유지증거금률 — 청산가 보정에 쓴다(계약별로 조금 다르지만 0.4%가 대표값). */
export const MAINT_MARGIN_RATE = 0.004;
/** 자석 후보로 쓰는 주요 레버리지 */
export const MAGNET_LEVERAGES = [10, 20, 25, 50] as const;
/** 클러스터로 묶는 가격 폭(상대) — 0.6% */
export const CLUSTER_TOLERANCE = 0.006;
/** 이보다 캔들이 적으면 계산하지 않는다 */
export const MAGNET_MIN_BARS = 60;
/** 거리가 멀수록 자석 힘을 깎는 스케일(%) */
const DISTANCE_SCALE_PCT = 5;

export interface MagnetInput {
  symbol: string;
  base: string;
  price: number;
  high24h: number;
  low24h: number;
  /** 미결제약정(USDT) — 모르면 0 */
  openInterestUsd: number;
  /** 펀딩비(%) — 8시간 기준 */
  fundingRate: number;
  /** OI 변동률(%) — 관측 기록이 없으면 null */
  oiChangePct: number | null;
  candles1h: Candle[];
  candles4h?: Candle[] | null;
  decimals?: number;
  /** 펀딩·OI 를 실제로 받을 수 있는 출처인가 (바이낸스 현물은 둘 다 없음) */
  derivatives?: boolean;
}

export interface MagnetLevel {
  leverage: number;
  /** 그 레버리지 포지션의 청산가 */
  price: number;
  /** 현재가 대비 거리(%) — 항상 0 이상 */
  distancePct: number;
}

export interface MagnetCluster {
  /** 클러스터 중심(스윙 가격) */
  center: number;
  low: number;
  high: number;
  /** 중심에 모인 스윙 접촉 수 */
  touches: number;
  /** 0~1 — 같은 화면의 가장 두꺼운 클러스터가 1 */
  weight: number;
  /** 현재가 대비 중심 거리(%) */
  distancePct: number;
  /** 청산 물량 추정(USDT) — OI × 가중치 × 점유 가정 */
  liqUsd: number;
  levels: MagnetLevel[];
}

export interface SideMagnet {
  side: 'up' | 'down';
  /** 0~100 */
  score: number;
  /** 가까운 순 상위 클러스터 */
  clusters: MagnetCluster[];
  top: MagnetCluster | null;
  /** 가장 가까운 클러스터의 대표 청산대(레버리지·가격) */
  main: MagnetLevel | null;
}

export interface MagnetResult {
  symbol: string;
  base: string;
  price: number;
  high24h: number;
  low24h: number;
  up: SideMagnet;
  down: SideMagnet;
  /** 위/아래 자석 우세 */
  bias: 'up' | 'down' | 'neutral';
  /** 상방 − 하방 (−100~100) */
  tilt: number;
  /** 더 강한 쪽 점수 */
  squeeze: number;
  fundingRate: number;
  /** 펀딩 해석 한 줄 */
  fundingLabel: string;
  oiUsd: number;
  oiChangePct: number | null;
  /** 진입 참고 한 줄 */
  note: string;
  warnings: string[];
  bars: number;
  htfBars: number;
  decimals?: number;
  analyzedAt: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Pivot {
  price: number;
  /** 0~1 — 최근·거래량 많은 봉일수록 크다 */
  weight: number;
  kind: 'high' | 'low';
  tf: '1H' | '4H';
  at: number;
}

/**
 * 프랙탈 스윙(좌우 2봉) — 고점/저점 후보.
 * 가중치 = 최신성(최근일수록 큼) × 거래량(상위일수록 큼) × 타임프레임(4H 가중)
 */
export function swings(candles: Candle[], tf: '1H' | '4H' = '1H'): Pivot[] {
  const n = candles.length;
  if (n < 5) return [];
  const vols = candles.map((c) => c.v).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const volRank = (v: number) => {
    if (!vols.length || !(v > 0)) return 0.5;
    let below = 0;
    for (const x of vols) if (x < v) below += 1;
    return below / vols.length;
  };
  const out: Pivot[] = [];
  for (let i = 2; i < n - 2; i += 1) {
    const c = candles[i];
    const recency = 0.35 + 0.65 * (i / Math.max(1, n - 1));
    const vol = volRank(c.v);
    const base = (0.45 + 0.55 * vol) * recency * (tf === '4H' ? 1.4 : 1);
    const isHigh = [1, 2].every((k) => c.h > candles[i - k].h && c.h > candles[i + k].h);
    const isLow = [1, 2].every((k) => c.l < candles[i - k].l && c.l < candles[i + k].l);
    if (isHigh) out.push({ price: c.h, weight: base, kind: 'high', tf, at: c.t });
    if (isLow) out.push({ price: c.l, weight: base, kind: 'low', tf, at: c.t });
  }
  return out;
}

/** 가격 근접(상대 0.6%) 피벗을 하나의 청산 뭉치로 묶는다. */
export function clusterPivots(pivots: Pivot[]): Array<{ center: number; low: number; high: number; touches: number; weight: number; kind: 'high' | 'low' }> {
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const groups: Pivot[][] = [];
  for (const p of sorted) {
    const last = groups[groups.length - 1];
    if (!last) {
      groups.push([p]);
      continue;
    }
    const center = last.reduce((acc, x) => acc + x.price * x.weight, 0) / last.reduce((acc, x) => acc + x.weight, 0);
    if (Math.abs(p.price - center) / center <= CLUSTER_TOLERANCE) last.push(p);
    else groups.push([p]);
  }
  return groups
    .map((g) => {
      const totalW = g.reduce((acc, x) => acc + x.weight, 0);
      const center = g.reduce((acc, x) => acc + x.price * x.weight, 0) / totalW;
      return {
        center,
        low: Math.min(...g.map((x) => x.price)),
        high: Math.max(...g.map((x) => x.price)),
        touches: g.length,
        weight: totalW,
        kind: g[0].kind,
      };
    })
    .sort((a, b) => b.weight - a.weight);
}

/** 진입가 → 청산가. 숏은 위로, 롱은 아래로 (1/레버리지 − 유지증거금률). */
export function liquidationPrice(entry: number, leverage: number, side: 'long' | 'short'): number {
  if (!(entry > 0) || !(leverage > 0)) return NaN;
  const gap = Math.max(0, 1 / leverage - MAINT_MARGIN_RATE);
  return side === 'short' ? entry * (1 + gap) : entry * (1 - gap);
}

/** 가중치 합 → 0~100 점수(포화 곡선). 같은 화면 안 비교용. */
function scoreOf(raw: number): number {
  if (!(raw > 0)) return 0;
  return clamp(Math.round(100 * (1 - Math.exp(-raw / 1.15))), 0, 100);
}

function sideOf(
  clusters: Array<{ center: number; low: number; high: number; touches: number; weight: number }>,
  maxWeight: number,
  price: number,
  side: 'up' | 'down',
  oiUsd: number,
): SideMagnet {
  const liqSide: 'long' | 'short' = side === 'up' ? 'short' : 'long';
  const built: MagnetCluster[] = clusters
    .map((c) => {
      const distancePct = ((c.center - price) / price) * 100;
      const weight = maxWeight > 0 ? c.weight / maxWeight : 0;
      return {
        center: c.center,
        low: c.low,
        high: c.high,
        touches: c.touches,
        weight,
        distancePct: Math.abs(distancePct),
        // OI 의 최대 15% 가 가장 두꺼운 뭉치에 있다고 보는 보수적 가정
        liqUsd: oiUsd > 0 ? oiUsd * 0.15 * weight : 0,
        levels: MAGNET_LEVERAGES.map((lev) => {
          const p = liquidationPrice(c.center, lev, liqSide);
          return { leverage: lev, price: p, distancePct: Math.abs((p - price) / price) * 100 };
        }),
      };
    })
    .sort((a, b) => a.distancePct - b.distancePct);
  const raw = built.reduce((acc, c) => acc + c.weight * Math.exp(-c.distancePct / DISTANCE_SCALE_PCT), 0);
  const top = built[0] ?? null;
  // 대표 청산대 — 10~25x 중 현재가에 가장 가까운(=현실적으로 먼저 닿는) 레버리지
  const main =
    top?.levels.filter((l) => l.leverage <= 25).sort((a, b) => a.distancePct - b.distancePct)[0] ??
    top?.levels[0] ??
    null;
  return { side, score: scoreOf(raw), clusters: built.slice(0, 3), top, main };
}

/**
 * 청산 자석 분석 — 캔들이 부족하면 null.
 * `derivatives:false`(바이낸스 현물)면 펀딩·OI 를 쓰지 않고 경고를 남긴다.
 */
export function analyzeMagnet(input: MagnetInput): MagnetResult | null {
  const c1 = input.candles1h;
  if (c1.length < MAGNET_MIN_BARS) return null;
  const price = input.price > 0 ? input.price : c1[c1.length - 1].c;
  if (!(price > 0)) return null;
  const derivatives = input.derivatives !== false;
  const c4 = input.candles4h ?? [];

  const pivots = [
    ...swings(c1, '1H'),
    ...(c4.length >= 20 ? swings(c4, '4H') : []),
  ];

  // 현재가를 사이에 둔 고점(위)·저점(아래)만 자석 후보 — 이미 지나간 자리는 의미가 없다.
  const highs = pivots.filter((p) => p.kind === 'high' && p.price > price * 1.0005);
  const lows = pivots.filter((p) => p.kind === 'low' && p.price < price * 0.9995);
  // 스윙이 없으면 24h 고·저를 최소 후보로 쓴다(데이터가 얇은 종목).
  const highSeed = highs.length
    ? highs
    : input.high24h > price
      ? [{ price: input.high24h, weight: 1, kind: 'high' as const, tf: '1H' as const, at: 0 }]
      : [];
  const lowSeed = lows.length
    ? lows
    : input.low24h > 0 && input.low24h < price
      ? [{ price: input.low24h, weight: 1, kind: 'low' as const, tf: '1H' as const, at: 0 }]
      : [];

  const upClusters = clusterPivots(highSeed);
  const downClusters = clusterPivots(lowSeed);
  const maxWeight = Math.max(1e-9, ...upClusters.map((c) => c.weight), ...downClusters.map((c) => c.weight));
  const oiUsd = derivatives ? Math.max(0, input.openInterestUsd) : 0;

  const up = sideOf(upClusters, maxWeight, price, 'up', oiUsd);
  const down = sideOf(downClusters, maxWeight, price, 'down', oiUsd);

  /* ---------- 펀딩·OI 보정 ---------- */
  const funding = derivatives && Number.isFinite(input.fundingRate) ? input.fundingRate : 0;
  // ±0.05%(8시간) 를 과열의 기준으로 본다.
  const tilt = derivatives ? clamp(funding / 0.05, -1, 1) : 0;
  let upScore = up.score;
  let downScore = down.score;
  if (tilt > 0) downScore += 12 * tilt; // 롱 과열 → 하방 롱 청산 자석
  if (tilt < 0) upScore += 12 * -tilt; // 숏 과열 → 상방 숏 스퀴즈
  const oiChange = derivatives ? input.oiChangePct : null;
  if (oiChange != null && oiChange >= 3) {
    // OI 급증 = 청산 연료가 새로 쌓임 → 가까운 쪽에 가점
    const nearer = (up.main?.distancePct ?? 999) <= (down.main?.distancePct ?? 999) ? 'up' : 'down';
    if (nearer === 'up') upScore += 8;
    else downScore += 8;
  }
  up.score = clamp(Math.round(upScore), 0, 100);
  down.score = clamp(Math.round(downScore), 0, 100);

  const diff = up.score - down.score;
  const bias: MagnetResult['bias'] = diff >= 8 ? 'up' : diff <= -8 ? 'down' : 'neutral';
  const warnings: string[] = [];
  if (!derivatives) warnings.push('현물 데이터 모드 — 펀딩비·OI 가 없어 스윙 구조로만 추정합니다.');
  else if (!(oiUsd > 0)) warnings.push('OI 값을 받지 못해 청산 물량(USDT)은 비워 두었습니다.');
  if (derivatives && Math.abs(funding) >= 0.05) {
    warnings.push(
      funding > 0
        ? `펀딩 +${funding.toFixed(3)}% 롱 과열 — 아래쪽 롱 청산 자석이 두꺼워졌어요.`
        : `펀딩 ${funding.toFixed(3)}% 숏 과열 — 위쪽 숏 스퀴즈 자석이 두꺼워졌어요.`,
    );
  }
  if (oiChange != null && oiChange >= 10) warnings.push(`OI +${oiChange.toFixed(1)}% 급증 — 청산 연료가 쌓였습니다.`);
  if (up.top == null) warnings.push('위쪽 스윙 고점이 없어 상방 자석을 계산하지 못했습니다.');
  if (down.top == null) warnings.push('아래쪽 스윙 저점이 없어 하방 자석을 계산하지 못했습니다.');

  // 라벨은 '과열'과 구분한다 — ±0.02%(8시간) 미만은 정상 범위다.
  const fundingLabel = !derivatives
    ? '펀딩 정보 없음'
    : Math.abs(funding) < 0.02
      ? '펀딩 중립'
      : funding > 0
        ? `롱 우세 +${funding.toFixed(3)}%`
        : `숏 우세 ${funding.toFixed(3)}%`;

  const top = bias === 'up' ? up.main : bias === 'down' ? down.main : up.main ?? down.main;
  const note = !top
    ? '자석 후보가 없습니다 — 캔들이 더 쌓이면 다시 계산합니다.'
    : bias === 'up'
      ? `위 ${top.distancePct.toFixed(1)}%(${fmtPriceText(top.price)}) 숏 청산 자석이 우세 — 돌파하면 숏스퀴즈가 나옵니다. 자석 아래에서 롱, 자석에 닿으면 추격 금지.`
      : bias === 'down'
        ? `아래 ${top.distancePct.toFixed(1)}%(${fmtPriceText(top.price)}) 롱 청산 자석이 우세 — 이탈하면 롱 청산이 몰립니다. 자석 위에서 숏, 자석에 닿으면 반등 주의.`
        : '상·하방 자석이 비슷합니다 — 방향 베팅보다 자석 사이 레인지 매매가 유리합니다.';

  return {
    symbol: input.symbol,
    base: input.base,
    price,
    high24h: input.high24h,
    low24h: input.low24h,
    up,
    down,
    bias,
    tilt: diff,
    squeeze: Math.max(up.score, down.score),
    fundingRate: funding,
    fundingLabel,
    oiUsd,
    oiChangePct: oiChange,
    note,
    warnings,
    bars: c1.length,
    htfBars: c4.length,
    decimals: input.decimals,
    analyzedAt: Date.now(),
  };
}

const fmtPriceText = (v: number): string =>
  Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 2 : 4 }) : '-';

/** 목록 정렬 — 자석이 강한 순, 같으면 거래대금 순(화면이 넘겨준 순서 유지) */
export function rankMagnets(list: MagnetResult[]): MagnetResult[] {
  return [...list].sort((a, b) => b.squeeze - a.squeeze);
}
