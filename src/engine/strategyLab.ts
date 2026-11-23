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
