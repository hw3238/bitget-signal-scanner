/**
 * 🚀 급등 탐색기 엔진 — "이미 오른 코인"이 아니라 **출발 직전·초입** 코인을 찾는다.
 *
 * 원칙
 *  1) 모든 수치는 비트겟 공개 API(티커 · 펀딩비 · 미결제약정 · 1H/4H 캔들)에서만 나온다.
 *     가짜·추정 데이터는 쓰지 않고, 데이터가 모자라면 그 코인은 결과에서 뺀다.
 *  2) 6가지 요건을 각각 **점수(0~1 신용도) + Pass/부분/Fail + 수치 근거**로 남긴다.
 *     총점 = Σ(요건 가중치 × 신용도) = 100점 만점. 화면은 항상 "왜 이 점수인지"를 같이 보여준다.
 *  3) 이미 급등한 자리는 **감점**한다(⑥ 비과열). 사용자가 원한 것은 추격이 아니라 선제 진입이다.
 *  4) 매매 플랜(진입·목표·손절·손익비·레버리지)은 화면이 아니라 여기서 한 번만 계산한다
 *     → 카드·복사·원클릭 주문이 같은 숫자를 쓴다(`scripts/surge-check.ts`가 경계값을 검증).
 */
import type { Candle, Contract, Signal, TF, Ticker } from './types';
import { atr, bollinger, clamp, ema, rsi } from './indicators';
import { recommendLeverage } from '../lib/profile';

/* ------------------------------------------------------------------ *
 * 6요건 정의
 * ------------------------------------------------------------------ */

export type SurgeReqKey = 'squeeze' | 'volume' | 'shortSqueeze' | 'relStrength' | 'breakout' | 'coolDown';
/** pass = 요건 충족 · partial = 절반쯤(부분 점수) · fail = 미충족 */
export type SurgeReqState = 'pass' | 'partial' | 'fail';

export interface SurgeReq {
  key: SurgeReqKey;
  /** 카드에 붙는 ①~⑥ 순번 */
  no: number;
  label: string;
  /** 100점 만점에서 이 요건이 차지하는 점수 */
  weight: number;
  /** 0~1 신용도 — 총점은 가중치 × 신용도의 합 */
  credit: number;
  state: SurgeReqState;
  /** 배지에 붙는 짧은 수치 (예: `하위 8%`) */
  value: string;
  /** 수치 근거 한 줄 */
  detail: string;
  /** 핵심 추천 사유에 들어가는 문장 조각 */
  headline: string;
}

/** 요건 순서·이름·가중치(합 100점) — 화면·테스트가 같은 표를 본다. */
export const SURGE_REQ_META: Array<{ key: SurgeReqKey; no: number; label: string; weight: number }> = [
  { key: 'squeeze', no: 1, label: '변동성 응축', weight: 20 },
  { key: 'volume', no: 2, label: '거래량 유입', weight: 20 },
  { key: 'shortSqueeze', no: 3, label: '숏스퀴즈 압력', weight: 15 },
  { key: 'relStrength', no: 4, label: 'BTC 대비 강세', weight: 15 },
  { key: 'breakout', no: 5, label: '저항 돌파 임박', weight: 15 },
  { key: 'coolDown', no: 6, label: '비과열', weight: 15 },
];

export const SURGE_MAX_SCORE = SURGE_REQ_META.reduce((a, r) => a + r.weight, 0);

/**
 * 요건 상태 — pass 는 **각 요건의 규칙**(예: 밴드 폭 하위 30%)을 충족했다는 뜻이고,
 * 신용도(credit)는 그 충족이 얼마나 강한지를 0~1로 담아 점수에 반영한다.
 */
const PARTIAL_CREDIT = 0.35;

function stateOf(credit: number, pass: boolean): SurgeReqState {
  if (pass) return 'pass';
  return credit >= PARTIAL_CREDIT ? 'partial' : 'fail';
}

/* ------------------------------------------------------------------ *
 * 입력·출력
 * ------------------------------------------------------------------ */

export interface SurgeInput {
  symbol: string;
  base: string;
  /** 1시간봉 — 최소 140봉(밴드 폭 분포 100봉 + 20봉 창 + EMA20) */
  candles1h: Candle[];
  /** 4시간봉 — 있으면 추세 확인(④)에 쓴다. 없으면 중립 처리 */
  candles4h?: Candle[] | null;
  /** 실시간 티커 — 현재가·24h 등락·거래대금·펀딩비·미결제약정 */
  ticker: Ticker;
  /** BTC 1시간봉 — 상대 강세 기준선 */
  btc1h?: Candle[] | null;
  decimals?: number;
  maxLever?: number;
  equity?: number | null;
}

export interface SurgePlan {
  entry: number;
  stop: number;
  target: number;
  /** 목표가 손익비(2~3R) */
  rr: number;
  /** 손절 폭(%) */
  riskPct: number;
  /** 목표까지 거리(%) */
  rewardPct: number;
  /** 손절가를 무엇으로 잡았는지 — 스윙 저점/ATR */
  stopBasis: 'swing' | 'atr' | 'floor' | 'cap';
  /** 1H ATR14 비율(%) */
  atrPct: number;
  /** 직전 10봉 스윙 저점 거리(%) */
  swingPct: number;
  leverage: number;
  /** 청산 안전마진 상한 */
  safeMax: number;
  /** 레버리지 근거 문구 */
  levNote: string;
}

export interface SurgePick {
  symbol: string;
  base: string;
  /** 현재가(티커) */
  price: number;
  change24h: number;
  quoteVolume: number;
  fundingRate: number;
  /** 0~100 */
  score: number;
  /** Pass 요건 개수(0~6) */
  passed: number;
  reqs: SurgeReq[];
  /** 핵심 추천 사유 한 줄 */
  headline: string;
  /** 추격 금지 같은 경고 */
  warnings: string[];
  plan: SurgePlan;
  /** 급등 유망(요건 4개 이상 + 비과열) */
  prime: boolean;
  /** 점수를 승률 등가값으로 환산한 품질 지표(실측 승률 아님) */
  qualityWinRate: number;
  /** 필터 태그 */
  tags: string[];
  /** 분석에 쓴 1H 봉 수 */
  bars: number;
  /** 4H 추세까지 확인했는가 */
  htfChecked: boolean;
  decimals?: number;
  analyzedAt: number;
}

/** 급등 탐색기 화면 필터 */
export type SurgeFilter = 'all' | 'squeeze' | 'short' | 'volume';

export const SURGE_FILTERS: Array<{ key: SurgeFilter; label: string; req?: SurgeReqKey }> = [
  { key: 'all', label: '전체' },
  { key: 'squeeze', label: '스퀴즈 직전', req: 'squeeze' },
  { key: 'short', label: '숏스퀴즈', req: 'shortSqueeze' },
  { key: 'volume', label: '거래량 급증', req: 'volume' },
];

/** 필터 통과 — '전체'는 전부, 나머지는 해당 요건이 Pass 인 코인만 */
export function matchSurgeFilter(pick: SurgePick, filter: SurgeFilter): boolean {
  const meta = SURGE_FILTERS.find((f) => f.key === filter);
  if (!meta?.req) return true;
  return pick.reqs.find((r) => r.key === meta.req)?.state === 'pass';
}

/* ------------------------------------------------------------------ *
 * 유니버스
 * ------------------------------------------------------------------ */

export interface SurgeUniverseRow {
  symbol: string;
  base: string;
  decimals?: number;
  maxLever?: number;
  ticker: Ticker;
}

export interface SurgeUniverse {
  rows: SurgeUniverseRow[];
  /** 비트겟 USDT-M 코인 선물 전체(주식선물·FX·금 제외) */
  coinCount: number;
  /** 거래대금 기준을 넘어 실제 탐색하는 종목 수 */
  eligible: number;
  minVolume: number;
}

/** 급등 탐색 최소 24h 거래대금 — 너무 얇은 종목은 호가 공백으로 미끄러져 추천에서 뺀다. */
export const SURGE_MIN_VOLUME = 500_000;

/**
 * 탐색 대상 — 비트겟 USDT-M **코인** 선물(주식선물·FX·금 제외) 중
 * 24시간 거래대금이 `minVolume` 이상인 종목을 거래대금 순으로.
 */
export function surgeUniverse(
  contracts: Contract[],
  tickers: Ticker[],
  options: { minVolume?: number; limit?: number } = {},
): SurgeUniverse {
  const minVolume = options.minVolume ?? SURGE_MIN_VOLUME;
  const limit = options.limit ?? 200;
  const tickerBySymbol = new Map(tickers.map((t) => [t.symbol, t]));
  const coins = contracts.filter((c) => c.asset === 'crypto');
  const rows: SurgeUniverseRow[] = [];
  for (const c of coins) {
    const t = tickerBySymbol.get(c.symbol);
    if (!t || !(t.quoteVolume >= minVolume) || !(t.last > 0)) continue;
    rows.push({ symbol: c.symbol, base: c.base, decimals: c.decimals, maxLever: c.maxLever, ticker: t });
  }
  rows.sort((a, b) => b.ticker.quoteVolume - a.ticker.quoteVolume);
  return {
    rows: rows.slice(0, limit),
    coinCount: coins.length,
    eligible: rows.length,
    minVolume,
  };
}

/* ------------------------------------------------------------------ *
 * 점수 계산
 * ------------------------------------------------------------------ */

const mean = (values: number[]): number => {
  const clean = values.filter((v) => Number.isFinite(v));
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
};

/**
 * 현재 값이 과거 분포에서 어느 위치인가 — 중간순위(mid-rank) 백분위.
 * 같은 값(동점)을 전부 "아래"로 세면 변동성이 똑같이 반복되는 구간에서 백분위가 부풀므로
 * 동점은 절반만 센다.  0 = 가장 낮음(가장 응축) · 1 = 가장 높음
 */
function widthPercentile(ref: number[], target: number): number {
  const clean = ref.filter((v) => Number.isFinite(v));
  if (!clean.length || !Number.isFinite(target)) return 0.5;
  let below = 0;
  let equal = 0;
  for (const v of clean) {
    if (v < target) below += 1;
    else if (v === target) equal += 1;
  }
  return (below + 0.5 * equal) / clean.length;
}

const pct = (a: number, b: number): number => (b > 0 && Number.isFinite(a) && Number.isFinite(b) ? (a / b - 1) * 100 : 0);

const signed = (v: number, digits = 1): string => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;

function usdCompact(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '$0';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/**
 * 급등 요건 6가지를 점수화하고 매매 플랜을 만든다.
 * 데이터가 부족하면(140봉 미만 등) null — 화면은 그 종목을 "데이터 부족"으로 따로 센다.
 */
export function scoreSurge(input: SurgeInput): SurgePick | null {
  const c = input.candles1h;
  const n = c.length;
  if (n < 140) return null;
  const t = input.ticker;
  const price = t.last > 0 ? t.last : c[n - 1].c;
  if (!(price > 0)) return null;

  const closes = c.map((x) => x.c);
  const lows = c.map((x) => x.l);
  const highs = c.map((x) => x.h);
  const vols = c.map((x) => x.v);
  const decimals = input.decimals;

  /* ---------- ① 변동성 응축 — 볼린저 폭이 과거 100봉 분포의 하위 30% ---------- */
  const bb = bollinger(closes, 20, 2);
  const curWidth = bb.width[n - 1];
  const refWidths = bb.width.slice(n - 101, n - 1);
  const widthPct = widthPercentile(refWidths, curWidth);
  const squeezePass = widthPct <= 0.3;
  const squeezeCredit = clamp((0.6 - widthPct) / 0.3, 0, 1);
  const squeeze: SurgeReq = {
    key: 'squeeze',
    no: 1,
    label: '변동성 응축',
    weight: 20,
    credit: squeezeCredit,
    state: stateOf(squeezeCredit, squeezePass),
    value: `하위 ${Math.round(widthPct * 100)}%`,
    detail: `볼린저 폭 ${(curWidth * 100).toFixed(2)}% · 과거 100봉 중 하위 ${Math.round(widthPct * 100)}%`,
    headline: `볼린저 폭 하위 ${Math.round(widthPct * 100)}% 응축`,
  };

  /* ---------- ② 거래량 유입 — 마감/진행 봉이 20봉 평균의 1.5배 + 양봉 우위 ---------- */
  const base20 = mean(vols.slice(n - 21, n - 1));
  const live20 = mean(vols.slice(n - 20, n));
  const closedRatio = base20 > 0 ? vols[n - 2] / base20 : 0;
  const liveRatio = live20 > 0 ? vols[n - 1] / live20 : 0;
  const ratio = Math.max(closedRatio, liveRatio);
  const ratioBar = closedRatio >= liveRatio ? '마감봉' : '진행봉';
  const upBars = c.slice(n - 6).filter((x) => x.c > x.o).length;
  const volumePass = ratio >= 1.5 && upBars >= 3;
  const volumeCredit = 0.6 * clamp((ratio - 1) / 0.6, 0, 1) + 0.4 * (upBars / 6);
  const volume: SurgeReq = {
    key: 'volume',
    no: 2,
    label: '거래량 유입',
    weight: 20,
    credit: volumeCredit,
    state: stateOf(volumeCredit, volumePass),
    value: `×${ratio.toFixed(1)}`,
    detail: `${ratioBar} 거래량 20봉 평균 ×${ratio.toFixed(2)} · 최근 6봉 중 ${upBars}봉 양봉`,
    headline: `거래량 ${ratio.toFixed(1)}배 유입`,
  };

  /* ---------- ③ 숏스퀴즈 압력 — 펀딩비 0 이하이거나 OI/거래대금이 큰 상태 ---------- */
  const funding = Number.isFinite(t.fundingRate) ? t.fundingRate : 0;
  const oiBase = Number(t.openInterestBase ?? 0);
  const oiUsd = oiBase > 0 ? oiBase * price : 0;
  const oiRatio = t.quoteVolume > 0 && oiUsd > 0 ? oiUsd / t.quoteVolume : 0;
  const fundingCredit = funding <= 0 ? 1 : funding <= 0.01 ? 0.4 : 0.1;
  const oiCredit = oiRatio >= 0.6 ? 1 : oiRatio >= 0.35 ? 0.7 : oiRatio >= 0.15 ? 0.4 : 0.1;
  const shortPass = funding <= 0 || oiRatio >= 0.6;
  // 요건 문구 그대로 "펀딩 0 이하 **또는** 숏 쏠림" — 둘 중 강한 쪽을 신용도로 쓴다.
  const shortCredit = clamp(Math.max(fundingCredit, oiCredit), 0, 1);
  const shortSqueeze: SurgeReq = {
    key: 'shortSqueeze',
    no: 3,
    label: '숏스퀴즈 압력',
    weight: 15,
    credit: shortCredit,
    state: stateOf(shortCredit, shortPass),
    value: `펀딩 ${signed(funding, 3)}%`,
    detail: `펀딩 ${signed(funding, 3)}%/8h · 미결제약정 ${usdCompact(oiUsd)} (24h 거래대금의 ${(oiRatio * 100).toFixed(0)}%)`,
    headline: funding <= 0 ? `펀딩 ${signed(funding, 3)}%로 숏이 비용 부담` : `OI/거래대금 ${(oiRatio * 100).toFixed(0)}% 축적`,
  };

  /* ---------- ④ BTC 대비 상대 강세 — 6h/24h 초과 수익 + EMA20 위 + 4H 추세 ---------- */
  const ema20 = ema(closes, 20)[n - 1];
  const r6 = pct(closes[n - 1], closes[n - 7]);
  const r24 = pct(closes[n - 1], closes[n - 25]);
  const btc = input.btc1h ?? [];
  const btcR6 = btc.length >= 7 ? pct(btc[btc.length - 1].c, btc[btc.length - 7].c) : Number.NaN;
  const btcR24 = btc.length >= 25 ? pct(btc[btc.length - 1].c, btc[btc.length - 25].c) : Number.NaN;
  const excess6 = Number.isFinite(btcR6) ? r6 - btcR6 : r6;
  const excess24 = Number.isFinite(btcR24) ? r24 - btcR24 : r24;
  const aboveEma = closes[n - 1] > ema20;
  const c4 = input.candles4h ?? [];
  const htfTrend = c4.length >= 25 ? c4[c4.length - 1].c > ema(c4.map((x) => x.c), 20)[c4.length - 1] : null;
  const relPass = aboveEma && (excess6 > 0 || excess24 > 0) && htfTrend !== false;
  const strength = 0.5 * clamp(excess6 / 3, -1, 1) + 0.5 * clamp(excess24 / 6, -1, 1);
  const relCredit = clamp(
    0.55 * clamp(0.5 + strength / 2, 0, 1) + 0.3 * (aboveEma ? 1 : 0) + 0.15 * (htfTrend === null ? 0.5 : htfTrend ? 1 : 0),
    0,
    1,
  );
  const relStrength: SurgeReq = {
    key: 'relStrength',
    no: 4,
    label: 'BTC 대비 강세',
    weight: 15,
    credit: relCredit,
    state: stateOf(relCredit, relPass),
    value: `${signed(excess6, 1)}%p`,
    detail: `6h ${signed(r6, 1)}% vs BTC ${Number.isFinite(btcR6) ? signed(btcR6, 1) : '—'}% · 24h 초과 ${signed(excess24, 1)}%p · EMA20 ${aboveEma ? '위' : '아래'} · 4H 추세 ${
      htfTrend === null ? '미확인' : htfTrend ? '위' : '아래'
    }`,
    headline: `BTC 대비 6h ${signed(excess6, 1)}%p 강세`,
  };

  /* ---------- ⑤ 저항 돌파 임박 — 30봉 고점 −4% ~ +1% 구간 ---------- */
  const hi30 = Math.max(...highs.slice(n - 30));
  const dist = ((hi30 - price) / price) * 100;
  const breakoutPass = dist >= -1 && dist <= 4;
  const breakoutCredit = clamp(1 - Math.abs(dist - 1) / 4, 0, 1);
  const breakout: SurgeReq = {
    key: 'breakout',
    no: 5,
    label: '저항 돌파 임박',
    weight: 15,
    credit: breakoutCredit,
    state: stateOf(breakoutCredit, breakoutPass),
    value: dist >= 0 ? `고점 -${dist.toFixed(1)}%` : `고점 +${(-dist).toFixed(1)}%`,
    detail: `30봉 고점 대비 ${dist >= 0 ? `-${dist.toFixed(2)}%` : `+${(-dist).toFixed(2)}%`}`,
    headline: dist >= 0 ? `30봉 고점 ${dist.toFixed(1)}% 아래` : `30봉 고점 ${(-dist).toFixed(1)}% 돌파`,
  };

  /* ---------- ⑥ 비과열 — 24h +18% 이상 또는 RSI 78 초과는 추격 자리 ---------- */
  const change24h = Number.isFinite(t.change24h) ? t.change24h : 0;
  const rsi14 = rsi(closes, 14)[n - 1];
  const heatCredit = change24h >= 18 ? 0 : change24h >= 12 ? clamp((18 - change24h) / 6, 0, 1) * 0.85 + 0.15 : 1;
  const rsiCredit = rsi14 >= 78 ? 0 : rsi14 >= 70 ? clamp((78 - rsi14) / 8, 0, 1) * 0.85 + 0.15 : 1;
  const coolPass = !(change24h >= 18 || rsi14 > 78) && change24h > -12;
  const coolCredit = clamp(Math.min(heatCredit, rsiCredit) * (change24h <= -12 ? 0.6 : 1), 0, 1);
  const coolDown: SurgeReq = {
    key: 'coolDown',
    no: 6,
    label: '비과열',
    weight: 15,
    credit: coolCredit,
    state: stateOf(coolCredit, coolPass),
    value: `24h ${signed(change24h, 1)}%`,
    detail: `24시간 ${signed(change24h, 1)}% · RSI14 ${Number.isFinite(rsi14) ? rsi14.toFixed(0) : '—'} · ${
      coolPass ? (change24h >= 8 || rsi14 > 65 ? '초입' : '출발 전') : '과열 — 추격 금지'
    }`,
    headline: coolPass ? `24h ${signed(change24h, 1)}%로 추격 아님` : '이미 급등한 자리',
  };

  const reqs = [squeeze, volume, shortSqueeze, relStrength, breakout, coolDown];
  const score = Math.round(reqs.reduce((sum, r) => sum + r.weight * r.credit, 0));
  const passed = reqs.filter((r) => r.state === 'pass').length;

  /* ---------- 매매 플랜 ---------- */
  const atr14 = atr(c, 14)[n - 1];
  const atrValue = Number.isFinite(atr14) && atr14 > 0 ? atr14 : price * 0.01;
  const swingLow = Math.min(...lows.slice(n - 10));
  const swingStop = swingLow * 0.998;
  const atrStop = price - 1.5 * atrValue;
  // 스윙 저점과 ATR 중 **가까운 쪽**(= 손절 폭이 좁은 쪽)을 쓰되, 최소 0.6% / 최대 12%로 자른다.
  let stop = Math.max(swingStop, atrStop);
  let stopBasis: SurgePlan['stopBasis'] = swingStop >= atrStop ? 'swing' : 'atr';
  stop = Math.min(stop, price * 0.994);
  if (stop >= price * 0.994) stopBasis = 'floor';
  if ((price - stop) / price > 0.12) {
    stop = price * 0.88;
    stopBasis = 'cap';
  }
  const riskPct = ((price - stop) / price) * 100;
  const atrPct = (atrValue / price) * 100;
  const rr = score >= 80 || (squeezePass && breakoutPass) ? 3 : score >= 60 ? 2.5 : 2;
  const target = price + rr * (price - stop);
  const rewardPct = ((target - price) / price) * 100;

  // 점수를 승률 등가값으로 환산(점수 60 = 55%, ±1점 0.35%p) — 레버리지 품질 계수에만 쓴다.
  const qualityWinRate = clamp(55 + (score - 60) * 0.35, 46, 64);
  const rec = recommendLeverage(
    { entry: price, stop, target, winRate: qualityWinRate, rr },
    input.equity ?? null,
    input.maxLever ?? null,
  );

  const plan: SurgePlan = {
    entry: price,
    stop,
    target,
    rr,
    riskPct,
    rewardPct,
    stopBasis,
    atrPct,
    swingPct: ((price - swingLow) / price) * 100,
    leverage: rec.leverage,
    safeMax: rec.safeMax,
    levNote: rec.note,
  };

  const warnings: string[] = [];
  if (!coolPass) warnings.push('이미 급등한 자리 — 추격 대신 눌림을 기다리세요');
  if (dist < -1.5) warnings.push('30봉 고점을 이미 넘긴 자리 — 돌파 추격 위험');
  if (atrPct >= 4) warnings.push(`변동성 큼(1H ATR ${atrPct.toFixed(1)}%) — 수량을 줄이세요`);
  if (riskPct >= 8) warnings.push(`손절 폭 ${riskPct.toFixed(1)}% — 레버리지가 청산 안전마진에 묶입니다`);

  const tags: string[] = [];
  for (const f of SURGE_FILTERS) {
    if (f.req && reqs.find((r) => r.key === f.req)?.state === 'pass') tags.push(f.key);
  }

  const headline = [...reqs]
    .filter((r) => r.credit >= 0.4)
    .sort((a, b) => b.credit * b.weight - a.credit * a.weight)
    .slice(0, 3)
    .map((r) => r.headline)
    .join(' · ') || '요건 충족이 적습니다 — 차순위 후보로만 참고하세요';

  return {
    symbol: input.symbol,
    base: input.base,
    price,
    change24h,
    quoteVolume: t.quoteVolume,
    fundingRate: funding,
    score,
    passed,
    reqs,
    headline,
    warnings,
    plan,
    prime: passed >= 4 && coolPass,
    qualityWinRate,
    tags,
    bars: n,
    htfChecked: htfTrend !== null,
    decimals,
    analyzedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ *
 * 정렬·주문 연동
 * ------------------------------------------------------------------ */

/** 점수 → 요건 수 → 거래대금 순. 화면·차순위 목록이 같은 순서를 쓴다. */
export function rankSurgePicks(picks: SurgePick[]): SurgePick[] {
  return [...picks].sort(
    (a, b) =>
      b.score - a.score ||
      b.passed - a.passed ||
      Number(b.prime) - Number(a.prime) ||
      b.quoteVolume - a.quoteVolume,
  );
}

/**
 * 복사·주문에 쓰는 가격 문자열 — **천단위 콤마 없이**(거래소 입력칸은 콤마를 거절한다),
 * 거래소 자리수(decimals)가 있으면 그대로, 없으면 금액대별 유효 자리로 쓴다.
 */
export function plainPrice(v: number, decimals?: number): string {
  if (!Number.isFinite(v)) return '';
  if (decimals != null) return v.toFixed(Math.max(0, Math.min(8, Math.round(decimals))));
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(1);
  if (abs >= 1) return v.toFixed(2);
  if (abs >= 0.01) return v.toFixed(4);
  if (abs >= 0.0001) return v.toFixed(6);
  return v.toFixed(8);
}

/** 복사·주문용 플랜 문자열 — 카드의 '복사'와 원클릭 주문이 같은 값을 쓴다. */
export function surgePlanLines(pick: SurgePick): { entry: string; target: string; stop: string; rr: string; text: string } {
  const entry = plainPrice(pick.plan.entry, pick.decimals);
  const target = plainPrice(pick.plan.target, pick.decimals);
  const stop = plainPrice(pick.plan.stop, pick.decimals);
  const rr = `1 : ${pick.plan.rr.toFixed(1)}`;
  return {
    entry,
    target,
    stop,
    rr,
    text: `${pick.base} 급등 탐색기 ${pick.score}점(${pick.passed}/6)\n진입 ${entry} · 목표 ${target} · 손절 ${stop} · 손익비 ${rr} · ${pick.plan.leverage}x`,
  };
}

/**
 * 원클릭 주문용 시그널 — 급등 탐색기의 플랜(진입·목표·손절·손익비)을 그대로 옮긴다.
 * 자동매매 게이트(최소 승률·손익비·중복·포지션 수)는 그대로 적용된다.
 * `winRate` 는 실측 승률이 아니라 **급등 점수의 승률 등가값**(qualityWinRate)이며,
 * 자동매매 게이트(최소 승률·손익비)가 그대로 적용된다.
 */
export function surgeSignal(pick: SurgePick, extra: { priceEndStep?: number } = {}): Signal {
  const tf: TF = '1H';
  return {
    id: `surge-${pick.symbol}-${Math.round(pick.analyzedAt / 60000)}`,
    symbol: pick.symbol,
    base: pick.base,
    asset: 'crypto',
    tf,
    side: 'long',
    strategyId: 'surge-explorer',
    strategyName: '급등 탐색기 · 6요건',
    strategyShort: '급등',
    star: 4,
    entry: pick.plan.entry,
    stop: pick.plan.stop,
    target: pick.plan.target,
    eq: pick.plan.entry,
    rr: pick.plan.rr,
    remainingRR: pick.plan.rr,
    currentR: 0,
    price: pick.price,
    changePct: 0,
    progress: 0,
    state: 'open',
    detectedAt: pick.analyzedAt,
    barsSince: 0,
    winRate: pick.qualityWinRate,
    // 급등 점수를 승률 등가값으로 환산한 값이다(전수 백테스트 승률 아님).
    // 자동매매 게이트가 이 값을 최소 승률과 비교해 "품질이 기준보다 낮다"고 막을 수 있다.
    winRateBasis: 'market',
    strategyExp: 0,
    strategyRR: pick.plan.rr,
    leverage: pick.plan.leverage,
    levRoi: 0,
    candles: [],
    detectedIdx: 0,
    tags: ['급등 탐색기', ...pick.tags],
    fundingRate: pick.fundingRate,
    quoteVolume: pick.quoteVolume,
    decimals: pick.decimals,
    priceEndStep: extra.priceEndStep,
  };
}
