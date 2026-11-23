import type { Candle } from './types';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length).fill(Number.NaN);
  if (values.length === 0) return out;
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function sma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(Number.NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function stdev(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(Number.NaN);
  for (let i = period - 1; i < values.length; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += values[j];
    mean /= period;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) acc += (values[j] - mean) ** 2;
    out[i] = Math.sqrt(acc / period);
  }
  return out;
}

export function rsi(values: number[], period = 14): number[] {
  const out: number[] = new Array(values.length).fill(Number.NaN);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function atr(candles: Candle[], period = 14): number[] {
  const out: number[] = new Array(candles.length).fill(Number.NaN);
  const trs: number[] = candles.map((c, i) =>
    i === 0
      ? c.h - c.l
      : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c)),
  );
  if (candles.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i];
  out[period - 1] = sum / period;
  for (let i = period; i < candles.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
  }
  return out;
}

export interface Bollinger {
  mid: number[];
  up: number[];
  lo: number[];
  width: number[];
}

export function bollinger(values: number[], period = 20, mult = 2): Bollinger {
  const mid = sma(values, period);
  const sd = stdev(values, period);
  const up = mid.map((m, i) => (Number.isNaN(m) ? Number.NaN : m + mult * sd[i]));
  const lo = mid.map((m, i) => (Number.isNaN(m) ? Number.NaN : m - mult * sd[i]));
  const width = mid.map((m, i) => (Number.isNaN(m) || m === 0 ? Number.NaN : (up[i] - lo[i]) / m));
  return { mid, up, lo, width };
}

export interface SuperTrend {
  dir: number[];
  line: number[];
}

export function superTrend(candles: Candle[], period = 10, mult = 3): SuperTrend {
  const a = atr(candles, period);
  const dir: number[] = new Array(candles.length).fill(1);
  const line: number[] = new Array(candles.length).fill(Number.NaN);
  let upBand = Number.NaN;
  let loBand = Number.NaN;
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(a[i])) {
      line[i] = candles[i].c;
      continue;
    }
    const mid = (candles[i].h + candles[i].l) / 2;
    let basicUp = mid + mult * a[i];
    let basicLo = mid - mult * a[i];
    if (i === 0 || Number.isNaN(upBand)) {
      upBand = basicUp;
      loBand = basicLo;
      dir[i] = 1;
      line[i] = loBand;
      continue;
    }
    const prevClose = candles[i - 1].c;
    upBand = basicUp < upBand || prevClose > upBand ? basicUp : upBand;
    loBand = basicLo > loBand || prevClose < loBand ? basicLo : loBand;
    const prevDir = dir[i - 1];
    if (prevDir === 1 && candles[i].c < loBand) dir[i] = -1;
    else if (prevDir === -1 && candles[i].c > upBand) dir[i] = 1;
    else dir[i] = prevDir;
    line[i] = dir[i] === 1 ? loBand : upBand;
  }
  return { dir, line };
}

export function donchian(candles: Candle[], period = 20): { hi: number[]; lo: number[] } {
  const hi: number[] = new Array(candles.length).fill(Number.NaN);
  const lo: number[] = new Array(candles.length).fill(Number.NaN);
  for (let i = period - 1; i < candles.length; i++) {
    let h = -Infinity;
    let l = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].h > h) h = candles[j].h;
      if (candles[j].l < l) l = candles[j].l;
    }
    hi[i] = h;
    lo[i] = l;
  }
  return { hi, lo };
}

export function percentileRank(values: number[], target: number): number {
  const clean = values.filter((v) => !Number.isNaN(v));
  if (!clean.length) return 0.5;
  let below = 0;
  for (const v of clean) if (v <= target) below++;
  return below / clean.length;
}

export interface Series {
  ema20: number[];
  ema50: number[];
  /** 상위 타임프레임 추세 대용 — 1H의 200봉 ≈ 4H EMA50 */
  ema200: number[];
  rsi14: number[];
  atr14: number[];
  bb: Bollinger;
  st: SuperTrend;
  volMa20: number[];
  donch: { hi: number[]; lo: number[] };
}

export function buildSeries(candles: Candle[]): Series {
  const closes = candles.map((c) => c.c);
  const vols = candles.map((c) => c.v);
  return {
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi14: rsi(closes, 14),
    atr14: atr(candles, 14),
    bb: bollinger(closes, 20, 2),
    st: superTrend(candles, 10, 3),
    volMa20: sma(vols, 20),
    donch: donchian(candles, 20),
  };
}
