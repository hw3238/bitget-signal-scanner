import type { Candle, TF } from './types';
import type { Detector } from './strategies';
import { assembleSetup } from './strategies';
import type { Series } from './indicators';

/**
 * **벤치 대기 후보** — 상위 트레이더 기법이지만 2026-11-23 전수 백테스트에서
 * 기대값이 음수이거나 표본이 마르는 바람에 채택하지 않은 기법들.
 *
 * 여기 남겨 두는 이유: `scripts/strategy-tournament.ts` 가 채택 전략(DETECTORS)과
 * 함께 계속 채점하므로, 장세가 바뀌면 다시 살아나는지 정기 점검에서 바로 확인할 수 있다.
 * 앱 번들에는 포함되지 않는다(정식 DETECTORS 만 import).
 */

const atrAt = (s: Series, i: number) => {
  const a = s.atr14[i];
  return Number.isFinite(a) && a > 0 ? a : 0;
};

/** 고정 R 목표가 — 라이브 전략과 같은 규칙 */
const fixedR = (side: 'long' | 'short', entry: number, risk: number, mult: number) =>
  side === 'long' ? entry + mult * risk : entry - mult * risk;

/** 상위 타임프레임 추세 편향 — 1H의 EMA200 ≈ 4H EMA50 (라이브와 동일) */
function htfBias(s: Series, i: number, close: number): 1 | -1 | 0 {
  const e = s.ema200[i];
  const ePrev = s.ema200[i - 8];
  if (!Number.isFinite(e) || !Number.isFinite(ePrev)) return 0;
  if (close > e && e > ePrev) return 1;
  if (close < e && e < ePrev) return -1;
  return 0;
}

/** 트리거 봉 거래량 확인 */
function volConfirmed(candles: Candle[], s: Series, i: number, mult: number): boolean {
  const volMa = s.volMa20[i];
  if (!Number.isFinite(volMa) || volMa <= 0) return false;
  return candles[i].v >= volMa * mult;
}

function rangeOf(candles: Candle[], from: number, to: number) {
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = Math.max(0, from); j <= to; j++) {
    if (candles[j].h > hi) hi = candles[j].h;
    if (candles[j].l < lo) lo = candles[j].l;
  }
  return { hi, lo };
}

const DAY = 86_400_000;
const TF_MS: Record<TF, number> = { '1H': 3_600_000, '4H': 14_400_000 };

interface DayLevels {
  pdh: number[];
  pdl: number[];
}

const dayCache = new WeakMap<Candle[], DayLevels>();

/** 전일 고점·저점(UTC 거래일 기준) — 캔들 배열마다 한 번만 계산 */
function dayLevels(candles: Candle[], tf: TF): DayLevels {
  const hit = dayCache.get(candles);
  if (hit) return hit;
  const pdh = new Array<number>(candles.length).fill(Number.NaN);
  const pdl = new Array<number>(candles.length).fill(Number.NaN);
  const perDay = new Map<number, { hi: number; lo: number }>();
  for (const c of candles) {
    const d = Math.floor(c.t / DAY);
    const cur = perDay.get(d);
    if (!cur) perDay.set(d, { hi: c.h, lo: c.l });
    else {
      if (c.h > cur.hi) cur.hi = c.h;
      if (c.l < cur.lo) cur.lo = c.l;
    }
  }
  const barsPerDay = Math.max(1, Math.round(DAY / TF_MS[tf]));
  for (let i = 0; i < candles.length; i++) {
    const d = Math.floor(candles[i].t / DAY);
    const prev = perDay.get(d - 1);
    if (prev) {
      pdh[i] = prev.hi;
      pdl[i] = prev.lo;
      continue;
    }
    // 주식선물처럼 전일 봉이 비는 시장은 직전 하루치 봉 고저로 대체한다.
    if (i >= barsPerDay) {
      const { hi, lo } = rangeOf(candles, i - barsPerDay, i - 1);
      pdh[i] = hi;
      pdl[i] = lo;
    }
  }
  const out = { pdh, pdl };
  dayCache.set(candles, out);
  return out;
}

/**
 * PDH/PDL(전일 고점·저점) 유동성 스윕 + 구조 회귀
 *  전일 고·저점을 꼬리로 스윕하고 종가가 전일 레인지로 회귀할 때, 거래량 스파이크를
 *  확인해 레인지 중간값을 목표로 진입한다.
 */
export const pdhPdlSweep: Detector = (candles, s, i, tf) => {
  if (i < 30) return null;
  const a = atrAt(s, i);
  if (!a) return null;
  const c = candles[i];
  const lv = dayLevels(candles, tf);
  const pdh = lv.pdh[i];
  const pdl = lv.pdl[i];
  if (!Number.isFinite(pdh) || !Number.isFinite(pdl) || !(pdh > pdl)) return null;
  const volMa = s.volMa20[i];
  if (!Number.isFinite(volMa) || volMa <= 0) return null;
  const volSpike = c.v >= volMa * 1.25;
  const mid = (pdh + pdl) / 2;

  if (c.h > pdh && c.c < pdh - 0.08 * a && c.c < c.o) {
    if (!volSpike) return null;
    return assembleSetup(
      tf,
      'short',
      c.c,
      Math.max(c.h, pdh) + 0.2 * a,
      a,
      (risk) => Math.min(Math.max(mid, c.c - 1.7 * risk), c.c - 2.4 * risk),
      ['전일 고점 스윕', '구조 회귀', '거래량 스파이크'],
    );
  }
  if (c.l < pdl && c.c > pdl + 0.08 * a && c.c > c.o) {
    if (!volSpike) return null;
    return assembleSetup(
      tf,
      'long',
      c.c,
      Math.min(c.l, pdl) - 0.2 * a,
      a,
      (risk) => Math.max(Math.min(mid, c.c + 1.7 * risk), c.c + 2.4 * risk),
      ['전일 저점 스윕', '구조 회귀', '거래량 스파이크'],
    );
  }
  return null;
};

/**
 * Post-Flush 급락 리셋 반등 (청산 휩쓸림 후 지지 홀드)
 *  ATR 2.5배 투매 봉 뒤 저점이 유지되고 종가가 회복하면 플러시 저점 손절로 반등을 받는다.
 */
export const postFlush: Detector = (candles, s, i, tf) => {
  if (i < 30) return null;
  const a = atrAt(s, i);
  if (!a) return null;
  const c = candles[i];

  for (let k = i - 5; k <= i - 2; k++) {
    if (k < 2) continue;
    const bar = candles[k];
    const prev = candles[k - 1];
    const aK = s.atr14[k - 1];
    if (!(aK > 0)) continue;
    const tr = Math.max(bar.h - bar.l, Math.abs(bar.h - prev.c), Math.abs(bar.l - prev.c));
    const range = bar.h - bar.l;
    if (!(range > 0) || tr < 2.5 * aK) continue;

    if (bar.c < bar.o && bar.c - bar.l <= 0.35 * range) {
      let holds = true;
      for (let j = k + 1; j <= i; j++) if (candles[j].l < bar.l - 0.05 * a) holds = false;
      if (!holds) continue;
      if (!(c.c > bar.c && c.c > c.o)) continue;
      if (candles[i].v > bar.v * 1.2) continue;
      return assembleSetup(tf, 'long', c.c, bar.l - 0.2 * a, a, (risk) => c.c + 1.9 * risk, [
        '급락 플러시',
        '지지 홀드',
        '종가 회복',
      ]);
    }
    if (bar.c > bar.o && bar.h - bar.c <= 0.35 * range) {
      let holds = true;
      for (let j = k + 1; j <= i; j++) if (candles[j].h > bar.h + 0.05 * a) holds = false;
      if (!holds) continue;
      if (!(c.c < bar.c && c.c < c.o)) continue;
      if (candles[i].v > bar.v * 1.2) continue;
      return assembleSetup(tf, 'short', c.c, bar.h + 0.2 * a, a, (risk) => c.c - 1.9 * risk, [
        '급등 플러시',
        '저항 홀드',
        '종가 회복',
      ]);
    }
  }
  return null;
};

/**
 * EQ 평균회귀 + 장악형 캔들 — 2026-11-23 라이브 풀에서 제외된 기법.
 *  전수 재측정에서 어떤 강화(거래량 1.2배·몸통 1ATR·구간 2ATR·EMA200 정렬·목표 2.3R)로도
 *  승률 45%를 넘지 못했다(최고 42.6%/+0.199R). 장세가 바뀌면 다시 채점해 살아날 수 있다.
 */
export const eqEngulfing: Detector = (candles, s, i, tf) => {
  if (i < 36) return null;
  const a = atrAt(s, i);
  if (!a) return null;
  const c = candles[i];
  const prev = candles[i - 1];
  const { hi, lo } = rangeOf(candles, i - 30, i - 1);
  const height = hi - lo;
  if (height <= 0) return null;
  const eq = (hi + lo) / 2;
  if (lo + height * 0.15 > eq) return null;
  if (Math.abs(prev.c - eq) > height * 0.32) return null;

  const trendUp = s.ema20[i] > s.ema50[i];
  const trendDown = s.ema20[i] < s.ema50[i];
  const bullEngulf = c.c > c.o && prev.c < prev.o && c.c >= prev.o && c.o <= prev.c;
  const bearEngulf = c.c < c.o && prev.c > prev.o && c.c <= prev.o && c.o >= prev.c;

  if (bullEngulf && trendUp && c.c >= eq * 0.998) {
    if (htfBias(s, i, c.c) !== 1) return null;
    if (!volConfirmed(candles, s, i, 1.2)) return null;
    return assembleSetup(tf, 'long', c.c, Math.min(prev.l, c.l) - 0.2 * a, a, (risk) => {
      if ((Math.min(hi, c.c + 2.4 * risk) - c.c) / risk < 1.5) return 0;
      return fixedR('long', c.c, risk, 2.0);
    }, ['EQ 지지', '상승 장악형', 'HTF 동조']);
  }
  if (bearEngulf && trendDown && c.c <= eq * 1.002) {
    if (htfBias(s, i, c.c) !== -1) return null;
    if (!volConfirmed(candles, s, i, 1.2)) return null;
    return assembleSetup(tf, 'short', c.c, Math.max(prev.h, c.h) + 0.2 * a, a, (risk) => {
      if ((c.c - Math.max(lo, c.c - 2.4 * risk)) / risk < 1.5) return 0;
      return fixedR('short', c.c, risk, 2.0);
    }, ['EQ 저항', '하락 장악형', 'HTF 동조']);
  }
  return null;
};

export interface LabStrategy {
  id: string;
  name: string;
  short: string;
  desc: string;
  star: number;
  /** 원본 기법(상위 트레이더 레퍼런스) */
  origin: string;
  warmup: number;
  detect: Detector;
}

export const LAB_STRATEGIES: LabStrategy[] = [
  {
    id: 'pdh-pdl-sweep',
    name: '전일 고저점(PDH/PDL) 스윕 회귀',
    short: 'PDH·PDL',
    desc: '전일 고점·저점을 꼬리로 스윕하고 종가가 레인지로 회귀할 때 거래량 스파이크 확인 진입.',
    star: 3,
    origin: 'PDH/PDL Liquidity Sweep + Structure Reversion',
    warmup: 30,
    detect: pdhPdlSweep,
  },
  {
    id: 'eq-engulfing',
    name: 'EQ 평균회귀 + 장악형 캔들',
    short: 'EQ·장악형',
    desc: '스윙 EQ(0.5) 지지·저항에서 장악형 캔들 반전을 HTF 추세 방향으로 받는다.',
    star: 3,
    origin: 'EQ(0.5) Mean Reversion + Engulfing — 구간 회귀 매매',
    warmup: 36,
    detect: eqEngulfing,
  },
  {
    id: 'post-flush',
    name: '급락 플러시 리셋 반등',
    short: '플러시 리셋',
    desc: 'ATR 2.5배 투매 봉 뒤 저점 홀드 + 종가 회복 시 플러시 저점 손절로 반등 진입.',
    star: 3,
    origin: 'Post-Flush Reversal (청산 휩쓸림 후 지지 홀드)',
    warmup: 30,
    detect: postFlush,
  },
];
