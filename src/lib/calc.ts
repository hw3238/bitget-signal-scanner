/**
 * COTA 계산 엔진 — 화면에 보이는 모든 수치는 이 파일의 순수 함수로만 계산한다.
 * (외부 라이브러리 없음 · 단위 테스트 scripts/calc-check.ts 가 직접 검증)
 */
import type { Side } from '../engine/types';

/* =====================================================================
   1) 김치프리미엄 & 국내→해외 송금
   ===================================================================== */

/**
 * 코인별 예상 네트워크(출금) 수수료 — 코인 수량 기준.
 * 거래소 정책·네트워크 혼잡에 따라 달라지므로 화면에는 "예상"으로 표기한다.
 */
export const WITHDRAW_FEE_COIN: Record<string, number> = {
  USDT: 1,
  BTC: 0.0002,
  ETH: 0.0016,
  XRP: 0.25,
  SOL: 0.01,
  TRX: 1,
  DOGE: 5,
  ADA: 1,
  AVAX: 0.001,
  LINK: 0.1,
  DOT: 0.1,
  BCH: 0.0001,
  SUI: 0.1,
  APT: 0.01,
  NEAR: 0.02,
  LTC: 0.001,
  ETC: 0.01,
  ATOM: 0.01,
  ARB: 0.5,
  OP: 0.05,
  FIL: 0.01,
  UNI: 0.2,
  TON: 0.05,
  SHIB: 200000,
  PEPE: 200000,
};

export interface KimchiRow {
  base: string;
  /** 업비트 원화 현재가 */
  upbitKrw: number;
  /** 비트겟 USDT 선물 현재가 */
  bitgetUsd: number;
  /** 김치프리미엄(%) = 업비트 원화가 / (비트겟 달러가 × 환율) − 1 */
  premiumPct: number;
  /** 예상 출금 수수료를 코인 가격으로 환산한 비율(%) */
  feePct: number;
  /** 국내에서 사서 해외로 보내 팔 때의 예상 순손익(%) — 김프 − 수수료 */
  netPct: number;
  /** 24시간 거래대금(원) */
  volumeKrw: number;
}

export function kimchiPremium(upbitKrw: number, bitgetUsd: number, usdKrw: number): number {
  const globalKrw = bitgetUsd * usdKrw;
  if (!Number.isFinite(upbitKrw) || !Number.isFinite(globalKrw) || globalKrw <= 0 || upbitKrw <= 0) return NaN;
  return (upbitKrw / globalKrw - 1) * 100;
}

export function buildKimchiRows(
  domestic: Map<string, { krw: number; volumeKrw: number }>,
  bitgetPrice: Map<string, number>,
  usdKrw: number,
): KimchiRow[] {
  const rows: KimchiRow[] = [];
  for (const [base, quote] of domestic) {
    if (base === 'USDT') continue;
    const usd = bitgetPrice.get(base);
    if (!usd || !Number.isFinite(usd) || usd <= 0) continue;
    if (!Number.isFinite(quote.krw) || quote.krw <= 0) continue;
    const premiumPct = kimchiPremium(quote.krw, usd, usdKrw);
    if (!Number.isFinite(premiumPct)) continue;
    // 1코인을 국내에서 사서(업비트 원화가) 수수료를 떼고 해외에서 팔 때의 순손익
    const feeCoin = WITHDRAW_FEE_COIN[base] ?? 0;
    const received = Math.max(0, 1 - feeCoin);
    const netPct = received * ((usd * usdKrw) / quote.krw) * 100 - 100;
    const feePct = (feeCoin * usd * usdKrw) / quote.krw * 100;
    rows.push({
      base,
      upbitKrw: quote.krw,
      bitgetUsd: usd,
      premiumPct,
      feePct,
      netPct,
      volumeKrw: quote.volumeKrw,
    });
  }
  return rows.sort((a, b) => b.volumeKrw - a.volumeKrw);
}

/** 국내→해외 송금에 가장 유리한 코인(순손익 큰 순) — 동전주 잡음을 줄이려 거래대금 하한을 둔다. */
export function bestTransferRoutes(rows: KimchiRow[], top = 3, minVolumeKrw = 1_000_000_000): KimchiRow[] {
  const liquid = rows.filter((r) => r.volumeKrw >= minVolumeKrw);
  const pool = liquid.length >= top ? liquid : rows;
  return [...pool].sort((a, b) => b.netPct - a.netPct).slice(0, top);
}

/** USDT 김프 — 업비트 USDT 원화가와 환율 비교 */
export function usdtPremium(upbitUsdtKrw: number, usdKrw: number): number {
  if (!Number.isFinite(upbitUsdtKrw) || usdKrw <= 0) return NaN;
  return (upbitUsdtKrw / usdKrw - 1) * 100;
}

/* =====================================================================
   2) 포지션 생존 성적표 (청산가 · 물타기 · 펀딩비)
   ===================================================================== */

/** 비트겟 USDT-M 1단계 유지증거금 가정 — BTC 0.4% · ETH 0.5% · 알트 1.0% */
export function maintenanceMarginRate(symbol: string): number {
  const base = symbol.replace(/USDT$/, '').toUpperCase();
  if (base === 'BTC') return 0.004;
  if (base === 'ETH') return 0.005;
  return 0.01;
}

/** 지정가 0.02% · 시장가 0.06% (비트겟 USDT-M 기본 수수료) */
export const FEE_MAKER_PCT = 0.02;
export const FEE_TAKER_PCT = 0.06;

export interface PositionState {
  side: Side;
  entry: number;
  leverage: number;
  /** 투입 증거금(USDT) */
  margin: number;
  /** 현재가 */
  mark: number;
  /** 유지증거금률(0.004 = 0.4%) */
  mmr: number;
  /** 현재 펀딩비(%, 8시간 기준) — 롱이면 +일 때 지불 */
  fundingRatePct?: number;
}

export interface PositionMetrics {
  qty: number;
  notional: number;
  /** 강제청산 예상가 */
  liq: number;
  /** 현재가에서 청산가까지 거리(%) — 항상 0 이상 */
  liqBufferPct: number;
  /** 진입가 대비 현재 손익률(%) — 레버리지 반영 */
  pnlPct: number;
  pnlUsd: number;
  /** 1회 정산 기준 펀딩비(USDT) — 내가 받으면 +, 내면 − */
  fundingPerInterval: number;
  /** 왕복 수수료(시장가 기준, USDT) */
  roundTripFee: number;
}

export function positionMetrics(input: PositionState): PositionMetrics {
  const { side, entry, leverage, margin, mark, mmr } = input;
  const qty = (margin * leverage) / entry;
  const notional = qty * entry;
  let liq: number;
  if (side === 'long') {
    liq = (entry - margin / qty) / (1 - mmr);
  } else {
    liq = (entry + margin / qty) / (1 + mmr);
  }
  liq = Math.max(0, liq);
  const liqBufferPct = Math.abs(mark - liq) / mark * 100;
  const priceMovePct = ((mark - entry) / entry) * 100 * (side === 'long' ? 1 : -1);
  const pnlPct = priceMovePct * leverage;
  // 롱은 펀딩비가 +면 지불, 숏은 −면 지불
  const fundingRatePct = Number.isFinite(input.fundingRatePct as number) ? (input.fundingRatePct as number) : 0;
  const directionSign = side === 'long' ? -1 : 1;
  return {
    qty,
    notional,
    liq,
    liqBufferPct,
    pnlPct,
    pnlUsd: (margin * pnlPct) / 100,
    fundingPerInterval: (notional * fundingRatePct * directionSign) / 100,
    roundTripFee: (notional * FEE_TAKER_PCT * 2) / 100,
  };
}

/** 물타기(추가 진입) 후 새 평단가 — 기존 수량과 추가 수량의 가중평균 */
export function averageEntry(
  entry: number,
  qty: number,
  addPrice: number,
  addQty: number,
): number {
  const total = qty + addQty;
  if (total <= 0) return entry;
  return (entry * qty + addPrice * addQty) / total;
}

export interface DcaResult {
  avgEntry: number;
  qty: number;
  notional: number;
  margin: number;
  leverage: number;
  liq: number;
}

/** 물타기 후 평단·배율·청산가. addMargin 이 0 이면 기존 포지션 그대로. */
export function applyDca(
  p: PositionState,
  addMargin: number,
  addPrice: number,
): DcaResult {
  const qty = (p.margin * p.leverage) / p.entry;
  const addQty = addMargin > 0 && addPrice > 0 ? (addMargin * p.leverage) / addPrice : 0;
  const totalQty = qty + addQty;
  const margin = p.margin + (addQty > 0 ? addMargin : 0);
  const avg = averageEntry(p.entry, qty, addPrice, addQty);
  const notional = totalQty * avg;
  let liq: number;
  if (p.side === 'long') {
    liq = (avg - margin / totalQty) / (1 - p.mmr);
  } else {
    liq = (avg + margin / totalQty) / (1 + p.mmr);
  }
  return {
    avgEntry: avg,
    qty: totalQty,
    notional,
    margin,
    leverage: margin > 0 ? notional / margin : p.leverage,
    liq: Math.max(0, liq),
  };
}

export interface SurvivalScore {
  score: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  comment: string;
  /** 항목별 점수 */
  parts: { buffer: number; leverage: number; funding: number; pnl: number };
}

/**
 * 생존 성적표 — 100점 만점
 *  · 청산 여유 40점 (멀수록 안전)
 *  · 레버리지 25점 (낮을수록 안전)
 *  · 펀딩 비용 20점 (하루 비용이 증거금 대비 작을수록)
 *  · 현재 손익 위치 15점
 */
export function survivalScore(params: {
  liqBufferPct: number;
  leverage: number;
  /** 하루 펀딩 비용(USDT, 내는 쪽 +) */
  fundingPerDay: number;
  margin: number;
  pnlPct: number;
}): SurvivalScore {
  const buffer = clampScaled(params.liqBufferPct, 5, 60, 40);
  const leverage = params.leverage <= 3 ? 25 : params.leverage <= 5 ? 22 : params.leverage <= 10 ? 17 : params.leverage <= 20 ? 9 : 4;
  const dailyCostPct = params.margin > 0 ? (Math.max(0, params.fundingPerDay) / params.margin) * 100 : 0;
  const funding = dailyCostPct <= 0.2 ? 20 : dailyCostPct <= 0.6 ? 15 : dailyCostPct <= 1.5 ? 9 : dailyCostPct <= 4 ? 4 : 0;
  const pnl =
    params.pnlPct >= 10 ? 15 : params.pnlPct >= 0 ? 12 : params.pnlPct >= -5 ? 9 : params.pnlPct >= -15 ? 5 : 2;
  const score = Math.round(buffer + leverage + funding + pnl);
  const grade = score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 40 ? 'C' : score >= 25 ? 'D' : 'F';
  const comment = survivalComment(grade, params);
  return { score, grade, comment, parts: { buffer, leverage, funding, pnl } };
}

function survivalComment(grade: SurvivalScore['grade'], p: { liqBufferPct: number; leverage: number; fundingPerDay: number; margin: number }): string {
  if (p.liqBufferPct < 5) return '청산 5% 이내 — 증거금을 넣거나 수량을 줄여야 살아남습니다.';
  if (p.fundingPerDay > 0.0001 && p.leverage >= 10) return '펀딩을 받는 자리 · 배율만 조금 낮추면 오래 버팁니다.';
  switch (grade) {
    case 'S':
      return '청산이 아주 먼 자리 — 흔들려도 버티는 포지션입니다.';
    case 'A':
      return '여유 있는 편 — 손절만 지키면 생존 확률이 높습니다.';
    case 'B':
      return '평범한 생존력 — 펀딩과 변동성만 한 번 더 확인하세요.';
    case 'C':
      return '배율이 부담스럽습니다. 물타기보다 수량 축소가 먼저입니다.';
    case 'D':
      return '청산이 가까운 편 — 작은 악재에도 강제청산될 수 있습니다.';
    default:
      return '위험 구간 — 사실상 운에 맡긴 포지션입니다. 즉시 정리 검토.';
  }
}

function clampScaled(value: number, min: number, max: number, weight: number): number {
  if (!Number.isFinite(value)) return 0;
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return Math.round(t * weight * 10) / 10;
}

/* =====================================================================
   3) 포지션 사이징 & 손익비
   ===================================================================== */

export interface SizingInput {
  seed: number;
  riskPct: number;
  entry: number;
  stop: number;
  target: number;
  side: Side;
}

export interface SizingResult {
  riskUsd: number;
  stopDistPct: number;
  targetDistPct: number;
  qty: number;
  notional: number;
  /** 시드 전액을 증거금으로 쓸 때 필요한 최소 배율 */
  leverage: number;
  rr: number;
  /** 손익분기 승률(%) = 1 / (1 + R) × 100 */
  breakevenWinRate: number;
  profitUsd: number;
  lossUsd: number;
  valid: boolean;
  error: string | null;
}

export function positionSizing(input: SizingInput): SizingResult {
  const { seed, riskPct, entry, stop, target , side } = input;
  const empty: SizingResult = {
    riskUsd: 0, stopDistPct: 0, targetDistPct: 0, qty: 0, notional: 0, leverage: 0,
    rr: 0, breakevenWinRate: 0, profitUsd: 0, lossUsd: 0, valid: false, error: null,
  };
  const stopDist = Math.abs(entry - stop);
  const targetDist = Math.abs(target - entry);
  if (![seed, riskPct, entry, stop, target].every((v) => Number.isFinite(v) && v > 0)) {
    return { ...empty, error: '모든 값을 0보다 크게 입력해 주세요.' };
  }
  if (stopDist <= 0) return { ...empty, error: '손절가가 진입가와 같습니다.' };
  if (stop === target) return { ...empty, error: '손절가와 목표가가 같습니다.' };
  // 방향이 뒤집힌 손절/목표는 계산하지 않는다 (롱: 손절<진입<목표, 숏: 목표<진입<손절)
  if (side === 'long' ? stop > entry || target < entry : stop < entry || target > entry) {
    return { ...empty, error: '방향과 손절·목표가가 맞지 않습니다.' };
  }
  const riskUsd = (seed * riskPct) / 100;
  const stopDistPct = (stopDist / entry) * 100;
  const targetDistPct = (targetDist / entry) * 100;
  const qty = riskUsd / stopDist;
  const notional = qty * entry;
  const rr = targetDist / stopDist;
  return {
    riskUsd,
    stopDistPct,
    targetDistPct,
    qty,
    notional,
    leverage: Math.max(1, Math.ceil(notional / seed)),
    rr,
    breakevenWinRate: (1 / (1 + rr)) * 100,
    profitUsd: qty * targetDist,
    lossUsd: -riskUsd,
    valid: true,
    error: null,
  };
}

/* =====================================================================
   4) 선물 수수료 & 페이백
   ===================================================================== */

export interface FeeInput {
  seed: number;
  leverage: number;
  tradesPerDay: number;
  /** 지정가 비중(0~1) */
  makerShare: number;
  /** 수수료 할인율(%) */
  discountPct: number;
  /** 페이백율(%) — 낸 수수료의 일부를 돌려받는 비율 */
  paybackPct: number;
}

export interface FeeResult {
  notional: number;
  /** 왕복(진입+청산) 1회 수수료 — 할인 전 */
  roundTripFee: number;
  dailyFee: number;
  monthlyFee: number;
  yearlyFee: number;
  /** 할인·페이백 적용 후 실제 부담 */
  monthlyNet: number;
  yearlyNet: number;
  monthlySaving: number;
  yearlySaving: number;
  effectiveFeePct: number;
}

export function feeCalculator(input: FeeInput): FeeResult {
  const makerShare = Math.min(1, Math.max(0, input.makerShare));
  const notional = input.seed * input.leverage;
  const perSide = makerShare * FEE_MAKER_PCT + (1 - makerShare) * FEE_TAKER_PCT;
  const roundTripFee = (notional * perSide * 2) / 100;
  const dailyFee = roundTripFee * Math.max(0, input.tradesPerDay);
  const discount = Math.min(100, Math.max(0, input.discountPct)) / 100;
  const payback = Math.min(100, Math.max(0, input.paybackPct)) / 100;
  const keep = (1 - discount) * (1 - payback);
  const monthlyFee = dailyFee * 30;
  const yearlyFee = dailyFee * 365;
  return {
    notional,
    roundTripFee,
    dailyFee,
    monthlyFee,
    yearlyFee,
    monthlyNet: monthlyFee * keep,
    yearlyNet: yearlyFee * keep,
    monthlySaving: monthlyFee * (1 - keep),
    yearlySaving: yearlyFee * (1 - keep),
    effectiveFeePct: perSide * keep * 2,
  };
}

/* =====================================================================
   5) 통계 — 피어슨 상관계수 · 정규화
   ===================================================================== */

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return NaN;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? NaN : num / den;
}

/** % 변화율 시퀀스 (길이 n-1) */
export function returnsOf(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) out.push(values[i] / values[i - 1] - 1);
  return out;
}

/** z-score 정규화 */
export function zScore(values: number[]): number[] {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
  return values.map((v) => (v - mean) / sd);
}

/* =====================================================================
   6) 차트 도플갱어 — 과거 유사 패턴
   ===================================================================== */

export interface DoppelMatch {
  /** 캔들 인덱스(구간 끝) */
  endIndex: number;
  startIndex: number;
  /** 피어슨 상관계수 (−1~1) */
  corr: number;
  /** 표시용 유사도(%) = corr × 100 */
  similarity: number;
  /** 구간 시작 시각(ms) */
  startAt: number;
  endAt: number;
  /** 패턴 구간 종가 시퀀스(정규화 전 원본) */
  window: number[];
  /** 이후 futureLen 봉 종가 시퀀스 */
  future: number[];
  /** 이후 futureLen 봉 등락률(%) */
  futureChangePct: number;
  /** 이후 최고 상승률(%) */
  futureMaxPct: number;
  /** 이후 최대 하락률(%) */
  futureMinPct: number;
}

export interface DoppelResult {
  patternLen: number;
  futureLen: number;
  current: number[];
  matches: DoppelMatch[];
  upCount: number;
  downCount: number;
  avgFuturePct: number;
  avgCorr: number;
}

/**
 * 최근 patternLen 봉과 과거 슬라이딩 윈도우를 피어슨 상관으로 비교한다.
 *  · 겹치지 않는 구간만: 후보 구간의 미래(futureLen)가 현재 패턴 시작 전에 끝나야 한다.
 *  · 상관이 높은 순으로 topN.
 */
export function findDoppelgangers(
  closes: number[],
  times: number[],
  patternLen = 24,
  futureLen = 12,
  topN = 3,
): DoppelResult {
  const n = closes.length;
  const empty: DoppelResult = {
    patternLen, futureLen, current: closes.slice(-patternLen), matches: [],
    upCount: 0, downCount: 0, avgFuturePct: 0, avgCorr: 0,
  };
  if (n < patternLen + futureLen + 3) return empty;
  const current = closes.slice(n - patternLen);
  const lastEnd = n - patternLen - futureLen - 1;
  const candidates: DoppelMatch[] = [];
  for (let end = patternLen - 1; end <= lastEnd; end++) {
    const window = closes.slice(end - patternLen + 1, end + 1);
    const corr = pearson(current, window);
    if (!Number.isFinite(corr)) continue;
    const future = closes.slice(end + 1, end + futureLen + 1);
    if (future.length < futureLen) continue;
    const base = window[window.length - 1];
    const futureChangePct = (future[future.length - 1] / base - 1) * 100;
    const futureMaxPct = (Math.max(...future) / base - 1) * 100;
    const futureMinPct = (Math.min(...future) / base - 1) * 100;
    candidates.push({
      endIndex: end,
      startIndex: end - patternLen + 1,
      corr,
      similarity: Math.round(Math.max(0, corr) * 1000) / 10,
      startAt: times[end - patternLen + 1] ?? 0,
      endAt: times[end] ?? 0,
      window,
      future,
      futureChangePct,
      futureMaxPct,
      futureMinPct,
    });
  }
  // 서로 겹치거나 바로 옆에 붙은 구간은 같은 사건으로 보고 하나만 남긴다.
  const picked: DoppelMatch[] = [];
  for (const c of candidates.sort((a, b) => b.corr - a.corr)) {
    if (picked.some((p) => Math.abs(p.endIndex - c.endIndex) < patternLen)) continue;
    picked.push(c);
    if (picked.length >= topN) break;
  }
  const matches = picked;
  const upCount = matches.filter((m) => m.futureChangePct > 0).length;
  return {
    patternLen,
    futureLen,
    current,
    matches,
    upCount,
    downCount: matches.length - upCount,
    avgFuturePct: matches.length ? matches.reduce((a, m) => a + m.futureChangePct, 0) / matches.length : 0,
    avgCorr: matches.length ? matches.reduce((a, m) => a + m.corr, 0) / matches.length : 0,
  };
}

/* =====================================================================
   7) 키맞추기(디커플링) 레이더
   ===================================================================== */

export interface LagRow {
  symbol: string;
  base: string;
  /** BTC 1H 수익률과의 상관계수 */
  corr: number;
  /** 최근 N봉 BTC 등락률(%) */
  btcChangePct: number;
  /** 최근 N봉 알트 등락률(%) */
  altChangePct: number;
  /** BTC − 알트 (%p). +면 알트가 덜 올랐거나 덜 빠진 것 */
  gapPct: number;
  /** 이후 따라갈 방향 */
  watch: 'long' | 'short';
  last: number;
}

export function analyzeLag(
  btcCloses: number[],
  altCloses: number[],
  bars: number,
  meta: { symbol: string; base: string; last: number },
): LagRow | null {
  const len = Math.min(btcCloses.length, altCloses.length);
  if (len < Math.max(bars + 2, 12)) return null;
  const btc = btcCloses.slice(-len);
  const alt = altCloses.slice(-len);
  const corr = pearson(returnsOf(btc), returnsOf(alt));
  if (!Number.isFinite(corr)) return null;
  const btcChangePct = (btc[len - 1] / btc[len - 1 - bars] - 1) * 100;
  const altChangePct = (alt[len - 1] / alt[len - 1 - bars] - 1) * 100;
  return {
    symbol: meta.symbol,
    base: meta.base,
    corr,
    btcChangePct,
    altChangePct,
    gapPct: btcChangePct - altChangePct,
    watch: btcChangePct >= 0 ? 'long' : 'short',
    last: meta.last,
  };
}

/** 후발주자 후보 — 상관 높고 괴리가 큰 종목만. */
export function lagCandidates(rows: LagRow[], minCorr = 0.65, minGap = 0.5): LagRow[] {
  return rows
    .filter((r) => r.corr >= minCorr && Math.abs(r.gapPct) >= minGap)
    .sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));
}
