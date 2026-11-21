import type { Candle, Setup, TF } from './types';
import type { Series } from './indicators';
import { percentileRank } from './indicators';
import { tightenStop, validateSetup } from './risk';

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

/**
 * 정밀 타점 시그널 조립
 *  · 손절: 구조적 무효화 지점(스윙·OB·FVG·신호 캔들 극값)에 최소 버퍼만 붙여 붙인다
 *  · 손절폭 상한/하한(타임프레임별)·목표가 양수·손익비 1.5R 를 모두 통과해야 통과
 */
function build(
  tf: TF,
  side: Setup['side'],
  entry: number,
  rawStop: number,
  atr: number,
  mkTarget: (risk: number) => number,
  tags: string[],
): Setup | null {
  const t = tightenStop({ side, entry, rawStop, atr, tf });
  if (!t) return null;
  const target = mkTarget(t.risk);
  if (!(target > 0)) return null;
  return validateSetup({ side, entry, stop: t.stop, target, tags }, tf);
}

/** 1. CRT + FVG + CISD : 레인지 스윕 → FVG/구조전환 확인 진입 */
function crtFvgCisd(candles: Candle[], s: Series, i: number, tf: TF): Setup | null {
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
    const tags = ['레인지 스윕'];
    if (fvgBull) tags.push('FVG');
    if (cisdUp) tags.push('CISD');
    // 무효화 지점 = 스윕한 저점(스윕 캔들 저가) — 그 바로 아래에서만 손절
    return build(tf, 'long', c.c, c.l - 0.2 * a, a, (risk) => Math.min(Math.max(rHi, c.c + 1.6 * risk), c.c + 2.4 * risk), tags);
  }
  if (!fvgBear && !cisdDown) return null;
  if (c.c < rHi - (rHi - rLo) * 0.45) return null;
  const tags = ['레인지 스윕'];
  if (fvgBear) tags.push('FVG');
  if (cisdDown) tags.push('CISD');
  return build(tf, 'short', c.c, c.h + 0.2 * a, a, (risk) => Math.max(Math.min(rLo, c.c - 1.6 * risk), c.c - 2.4 * risk), tags);
}

/** 2. Liquidity Sweep + Order Block : 스윕 뒤 오더블록 리테스트 */
function sweepOrderBlock(candles: Candle[], s: Series, i: number, tf: TF): Setup | null {
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
      if (entry <= obLow) continue;
      // 오더블록 저점이 무효화 지점 — 그 바로 아래로 손절
      return build(tf, 'long', entry, obLow - 0.2 * a, a, (risk) => entry + 2.0 * risk, ['유동성 스윕', 'OB 리테스트']);
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
      if (entry >= obHigh) continue;
      return build(tf, 'short', entry, obHigh + 0.2 * a, a, (risk) => entry - 2.0 * risk, ['유동성 스윕', 'OB 리테스트']);
    }
  }
  return null;
}

/** 3. EMA 20/50 Pullback + RSI Divergence */
function emaPullbackRsi(candles: Candle[], s: Series, i: number, tf: TF): Setup | null {
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

  const tags = ['EMA20 눌림', div ? 'RSI 다이버전스' : 'RSI 회복'];
  if (trendUp) {
    if (c.c <= e20) return null;
    if (!div && r < 50) return null;
    // 눌림 저점(최근 3봉 저가) 이탈이 무효화 지점
    const swingLow = rangeOf(candles, i - 3, i).lo;
    return build(tf, 'long', c.c, swingLow - 0.2 * a, a, (risk) => c.c + 1.8 * risk, tags);
  }
  if (c.c >= e20) return null;
  if (!div && r > 50) return null;
  const swingHigh = rangeOf(candles, i - 3, i).hi;
  return build(tf, 'short', c.c, swingHigh + 0.2 * a, a, (risk) => c.c - 1.8 * risk, tags);
}

/** 4. Bollinger Squeeze + Volume Breakout */
function bbSqueezeBreak(candles: Candle[], s: Series, i: number, tf: TF): Setup | null {
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
  // 돌파 캔들 극값이 무효화 지점 — 밴드 중간값까지 벌리지 않고 캔들 저/고가에 붙인다
  if (c.c > up) {
    return build(tf, 'long', c.c, c.l - 0.2 * a, a, (risk) => c.c + 2.0 * risk, ['BB 스퀴즈', '거래량 돌파']);
  }
  if (c.c < lo) {
    return build(tf, 'short', c.c, c.h + 0.2 * a, a, (risk) => c.c - 2.0 * risk, ['BB 스퀴즈', '거래량 돌파']);
  }
  return null;
}

/** 5. EQ Mean Reversion + Engulfing */
function eqEngulfing(candles: Candle[], s: Series, i: number, tf: TF): Setup | null {
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
    return build(tf, 'long', c.c, Math.min(prev.l, c.l) - 0.2 * a, a, (risk) => Math.min(hi, c.c + 2.4 * risk), ['EQ 지지', '상승 장악형']);
  }
  if (bearEngulf && trendDown && c.c <= eq * 1.002) {
    return build(tf, 'short', c.c, Math.max(prev.h, c.h) + 0.2 * a, a, (risk) => Math.max(lo, c.c - 2.4 * risk), ['EQ 저항', '하락 장악형']);
  }
  return null;
}

/** 6. SuperTrend / Donchian Momentum */
function supertrendDonchian(candles: Candle[], s: Series, i: number, tf: TF): Setup | null {
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
    // ATR 배수(최대 2ATR) 손절 대신 돌파 캔들 저점에 붙여 손절폭을 조인다
    const tags = [flipUp ? 'ST 전환' : '돈치안 돌파'];
    return build(tf, 'long', c.c, Math.min(prev.l, c.l) - 0.2 * a, a, (risk) => c.c + 2.0 * risk, tags);
  }
  if (flipDown || breakDown) {
    const tags = [flipDown ? 'ST 전환' : '돈치안 돌파'];
    return build(tf, 'short', c.c, Math.max(prev.h, c.h) + 0.2 * a, a, (risk) => c.c - 2.0 * risk, tags);
  }
  return null;
}

export type Detector = (c: Candle[], s: Series, i: number, tf: TF) => Setup | null;

export const DETECTORS: Record<string, Detector> = {
  'crt-fvg-cisd': crtFvgCisd,
  'sweep-ob': sweepOrderBlock,
  'ema-pullback-rsi': emaPullbackRsi,
  'bb-squeeze-break': bbSqueezeBreak,
  'eq-engulfing': eqEngulfing,
  'supertrend-donchian': supertrendDonchian,
};
