import type { Candle, Setup } from './types';
import type { Series } from './indicators';
import { percentileRank } from './indicators';

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

/** 1. CRT + FVG + CISD : 레인지 스윕 → FVG/구조전환 확인 진입 */
function crtFvgCisd(candles: Candle[], s: Series, i: number): Setup | null {
  if (i < 34) return null;
  const a = atrAt(s, i);
  if (!a) return null;
  const c = candles[i];
  const { hi: rHi, lo: rLo } = rangeOf(candles, i - 20, i - 1);
  const sweptLow = c.l < rLo && c.c > rLo;
  const sweptHigh = c.h > rHi && c.c < rHi;
  if (!sweptLow && !sweptHigh) return null;

  let fvgBull = false;
  let fvgBear = false;
  for (let j = Math.max(2, i - 2); j <= i; j++) {
    if (candles[j].l > candles[j - 2].h) fvgBull = true;
    if (candles[j].h < candles[j - 2].l) fvgBear = true;
  }
  const cisdUp = c.c > candles[i - 1].h;
  const cisdDown = c.c < candles[i - 1].l;

  if (sweptLow) {
    if (!fvgBull && !cisdUp) return null;
    if (c.c > rLo + (rHi - rLo) * 0.45) return null;
    const entry = c.c;
    const stop = Math.min(c.l, candles[i - 1].l) - 0.9 * a;
    const risk = entry - stop;
    if (risk <= 0) return null;
    const target = Math.min(Math.max(rHi, entry + 1.4 * risk), entry + 2.2 * risk);
    if (target <= entry) return null;
    const tags = ['레인지 스윕'];
    if (fvgBull) tags.push('FVG');
    if (cisdUp) tags.push('CISD');
    return { side: 'long', entry, stop, target, tags };
  }
  if (!fvgBear && !cisdDown) return null;
  if (c.c < rHi - (rHi - rLo) * 0.45) return null;
  const entry = c.c;
  const stop = Math.max(c.h, candles[i - 1].h) + 0.9 * a;
  const risk = stop - entry;
  if (risk <= 0) return null;
  const target = Math.max(Math.min(rLo, entry - 1.4 * risk), entry - 2.2 * risk);
  if (target >= entry) return null;
  const tags = ['레인지 스윕'];
  if (fvgBear) tags.push('FVG');
  if (cisdDown) tags.push('CISD');
  return { side: 'short', entry, stop, target, tags };
}

/** 2. Liquidity Sweep + Order Block : 스윕 뒤 오더블록 리테스트 */
function sweepOrderBlock(candles: Candle[], s: Series, i: number): Setup | null {
  if (i < 40) return null;
  const a = atrAt(s, i);
  if (!a) return null;
  const c = candles[i];

  for (const k of [i, i - 1]) {
    if (k < 32) continue;
    const { hi: priorHi, lo: priorLo } = rangeOf(candles, k - 30, k - 1);
    const sweptLow = candles[k].l < priorLo && candles[k].c > priorLo;
    const sweptHigh = candles[k].h > priorHi && candles[k].c < priorHi;

    if (sweptLow) {
      if (!(c.c > s.ema50[i])) continue;
      let obLow = Number.NaN;
      for (let j = k - 1; j >= Math.max(0, k - 7); j--) {
        if (candles[j].c < candles[j].o) {
          obLow = candles[j].l;
          break;
        }
      }
      if (!Number.isFinite(obLow)) continue;
      const entry = c.c;
      if (entry - obLow > 2.4 * a || entry <= obLow) continue;
      const stop = obLow - 0.7 * a;
      const risk = entry - stop;
      if (risk <= 0) continue;
      return { side: 'long', entry, stop, target: entry + 2.0 * risk, tags: ['유동성 스윕', 'OB 리테스트'] };
    }
    if (sweptHigh) {
      if (!(c.c < s.ema50[i])) continue;
      let obHigh = Number.NaN;
      for (let j = k - 1; j >= Math.max(0, k - 7); j--) {
        if (candles[j].c > candles[j].o) {
          obHigh = candles[j].h;
          break;
        }
      }
      if (!Number.isFinite(obHigh)) continue;
      const entry = c.c;
      if (obHigh - entry > 2.4 * a || entry >= obHigh) continue;
      const stop = obHigh + 0.7 * a;
      const risk = stop - entry;
      if (risk <= 0) continue;
      return { side: 'short', entry, stop, target: entry - 2.0 * risk, tags: ['유동성 스윕', 'OB 리테스트'] };
    }
  }
  return null;
}

/** 3. EMA 20/50 Pullback + RSI Divergence */
function emaPullbackRsi(candles: Candle[], s: Series, i: number): Setup | null {
  if (i < 60) return null;
  const a = atrAt(s, i);
  const e20 = s.ema20[i];
  const e50 = s.ema50[i];
  const r = s.rsi14[i];
  if (!a || !Number.isFinite(e20) || !Number.isFinite(e50) || !Number.isFinite(r)) return null;
  const c = candles[i];
  const trendUp = e20 > e50 * 1.0004;
  const trendDown = e20 < e50 * 0.9996;
  if (!trendUp && !trendDown) return null;

  let touched = false;
  for (let j = i - 2; j <= i; j++) {
    if (j < 1) continue;
    const dist = trendUp ? Math.abs(candles[j].l - s.ema20[j]) : Math.abs(candles[j].h - s.ema20[j]);
    if (dist <= 0.45 * a) touched = true;
  }
  if (!touched) return null;

  // RSI 다이버전스: 최근 저점/고점 대비 RSI 개선
  let div = false;
  if (trendUp) {
    let p = -1;
    let lowP = Infinity;
    for (let j = i - 12; j <= i - 2; j++) {
      if (candles[j].l < lowP) {
        lowP = candles[j].l;
        p = j;
      }
    }
    if (p > 0 && c.l <= lowP * 1.002 && r > s.rsi14[p] + 1.2) div = true;
  } else {
    let p = -1;
    let highP = -Infinity;
    for (let j = i - 12; j <= i - 2; j++) {
      if (candles[j].h > highP) {
        highP = candles[j].h;
        p = j;
      }
    }
    if (p > 0 && c.h >= highP * 0.998 && r < s.rsi14[p] - 1.2) div = true;
  }

  if (trendUp) {
    if (c.c <= e20) return null;
    if (!div && r < 50) return null;
    const stop = rangeOf(candles, i - 2, i).lo - 1.0 * a;
    const risk = c.c - stop;
    if (risk <= 0) return null;
    return {
      side: 'long',
      entry: c.c,
      stop,
      target: c.c + 1.8 * risk,
      tags: ['EMA20 눌림', div ? 'RSI 다이버전스' : 'RSI 회복'],
    };
  }
  if (c.c >= e20) return null;
  if (!div && r > 50) return null;
  const stop = rangeOf(candles, i - 2, i).hi + 1.0 * a;
  const risk = stop - c.c;
  if (risk <= 0) return null;
  return {
    side: 'short',
    entry: c.c,
    stop,
    target: c.c - 1.8 * risk,
    tags: ['EMA20 눌림', div ? 'RSI 다이버전스' : 'RSI 회복'],
  };
}

/** 4. Bollinger Squeeze + Volume Breakout */
function bbSqueezeBreak(candles: Candle[], s: Series, i: number): Setup | null {
  if (i < 110) return null;
  const a = atrAt(s, i);
  const w = s.bb.width[i];
  const up = s.bb.up[i];
  const lo = s.bb.lo[i];
  const mid = s.bb.mid[i];
  const volMa = s.volMa20[i];
  if (!a || !Number.isFinite(w) || !Number.isFinite(up) || !Number.isFinite(mid) || !Number.isFinite(volMa) || volMa <= 0)
    return null;

  let squeezeLow = Infinity;
  for (let j = i - 10; j <= i - 1; j++) if (Number.isFinite(s.bb.width[j])) squeezeLow = Math.min(squeezeLow, s.bb.width[j]);
  const history: number[] = [];
  for (let j = i - 100; j <= i - 1; j++) if (Number.isFinite(s.bb.width[j])) history.push(s.bb.width[j]);
  const rank = percentileRank(history, squeezeLow);
  if (rank > 0.3) return null;
  if (candles[i].v < volMa * 1.35) return null;

  const c = candles[i];
  if (c.c > up) {
    const stop = Math.min(mid - 0.6 * a, c.c - 1.6 * a);
    const risk = c.c - stop;
    if (risk <= 0) return null;
    return { side: 'long', entry: c.c, stop, target: c.c + 2.0 * risk, tags: ['BB 스퀴즈', '거래량 돌파'] };
  }
  if (c.c < lo) {
    const stop = Math.max(mid + 0.6 * a, c.c + 1.6 * a);
    const risk = stop - c.c;
    if (risk <= 0) return null;
    return { side: 'short', entry: c.c, stop, target: c.c - 2.0 * risk, tags: ['BB 스퀴즈', '거래량 돌파'] };
  }
  return null;
}

/** 5. EQ Mean Reversion + Engulfing */
function eqEngulfing(candles: Candle[], s: Series, i: number): Setup | null {
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
    const stop = Math.min(prev.l, c.l) - 0.5 * a;
    const risk = c.c - stop;
    if (risk <= 0) return null;
    const target = Math.max(Math.min(hi, c.c + 2.2 * (c.c - stop)), c.c + 1.0 * (c.c - stop));
    return { side: 'long', entry: c.c, stop, target, tags: ['EQ 지지', '상승 장악형'] };
  }
  if (bearEngulf && trendDown && c.c <= eq * 1.002) {
    const stop = Math.max(prev.h, c.h) + 0.5 * a;
    const risk = stop - c.c;
    if (risk <= 0) return null;
    const target = Math.min(Math.max(lo, c.c - 2.2 * (stop - c.c)), c.c - 1.0 * (stop - c.c));
    return { side: 'short', entry: c.c, stop, target, tags: ['EQ 저항', '하락 장악형'] };
  }
  return null;
}

/** 6. SuperTrend / Donchian Momentum */
function supertrendDonchian(candles: Candle[], s: Series, i: number): Setup | null {
  if (i < 46) return null;
  const a = atrAt(s, i);
  if (!a) return null;
  const c = candles[i];
  const prev = candles[i - 1];
  const flipUp = s.st.dir[i] === 1 && s.st.dir[i - 1] === -1;
  const flipDown = s.st.dir[i] === -1 && s.st.dir[i - 1] === 1;
  const hiPrev = s.donch.hi[i - 1];
  const loPrev = s.donch.lo[i - 1];
  const breakUp = Number.isFinite(hiPrev) && c.c > hiPrev && prev.c <= hiPrev;
  const breakDown = Number.isFinite(loPrev) && c.c < loPrev && prev.c >= loPrev;

  if (flipUp || breakUp) {
    const rawRisk = c.c - s.st.line[i];
    const riskCap = Math.min(Math.max(Number.isFinite(rawRisk) && rawRisk > 0 ? rawRisk : 1.5 * a, 1.0 * a), 2.0 * a);
    const stop = c.c - riskCap;
    const risk = c.c - stop;
    if (risk <= 0) return null;
    return {
      side: 'long',
      entry: c.c,
      stop,
      target: c.c + 2.0 * risk,
      tags: [flipUp ? 'ST 전환' : '돈치안 돌파'],
    };
  }
  if (flipDown || breakDown) {
    const rawRisk = s.st.line[i] - c.c;
    const riskCap = Math.min(Math.max(Number.isFinite(rawRisk) && rawRisk > 0 ? rawRisk : 1.5 * a, 1.0 * a), 2.0 * a);
    const stop = c.c + riskCap;
    const risk = stop - c.c;
    if (risk <= 0) return null;
    return {
      side: 'short',
      entry: c.c,
      stop,
      target: c.c - 2.0 * risk,
      tags: [flipDown ? 'ST 전환' : '돈치안 돌파'],
    };
  }
  return null;
}

export const DETECTORS: Record<string, (c: Candle[], s: Series, i: number) => Setup | null> = {
  'crt-fvg-cisd': crtFvgCisd,
  'sweep-ob': sweepOrderBlock,
  'ema-pullback-rsi': emaPullbackRsi,
  'bb-squeeze-break': bbSqueezeBreak,
  'eq-engulfing': eqEngulfing,
  'supertrend-donchian': supertrendDonchian,
};
