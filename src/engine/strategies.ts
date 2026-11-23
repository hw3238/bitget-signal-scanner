import type { Candle, Setup, TF } from './types';
import type { Series } from './indicators';
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

/** 고정 R 목표가 — 2026-11-23 전수 백테스트에서 전략별 최적 지점으로 확정한 배수 */
function fixedR(side: Setup['side'], entry: number, risk: number, mult: number): number {
  return side === 'long' ? entry + mult * risk : entry - mult * risk;
}

/**
 * 상위 타임프레임 추세 편향 — 1H의 EMA200 ≈ 4H EMA50.
 *  · 1: 상승 추세(종가 > EMA200, EMA200 상승) · -1: 하락 추세 · 0: 횡보/판단 불가
 */
function htfBias(s: Series, i: number, close: number): 1 | -1 | 0 {
  const e = s.ema200[i];
  const ePrev = s.ema200[i - 8];
  if (!Number.isFinite(e) || !Number.isFinite(ePrev)) return 0;
  if (close > e && e > ePrev) return 1;
  if (close < e && e < ePrev) return -1;
  return 0;
}

/** 트리거 봉 거래량 확인 — 20봉 평균 대비 배수 */
function volConfirmed(candles: Candle[], s: Series, i: number, mult: number): boolean {
  const volMa = s.volMa20[i];
  if (!Number.isFinite(volMa) || volMa <= 0) return false;
  return candles[i].v >= volMa * mult;
}

/**
 * 정밀 타점 시그널 조립
 *  · 손절: 구조적 무효화 지점(스윙·OB·FVG·신호 캔들 극값)에 최소 버퍼만 붙여 붙인다
 *  · 손절폭 상한/하한(타임프레임별)·목표가 양수·손익비 1.5R 를 모두 통과해야 통과
 */
export function assembleSetup(
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

/** 1. CRT + FVG + CISD : 레인지 스윕 → FVG/구조전환 확인 진입 (HTF 추세 동조 + 거래량) */
function crtFvgCisd(candles: Candle[], s: Series, i: number, tf: TF): Setup | null {
  if (i < 46) return null;
  const a = atrAt(s, i);
  if (!a) return null;
  const c = candles[i];
  const { hi: rHi, lo: rLo } = rangeOf(candles, i - 20, i - 1);
  const sweptLow = c.l < rLo && c.c > rLo;
  const sweptHigh = c.h > rHi && c.c < rHi;
  if (!sweptLow && !sweptHigh) return null;
  const bias = htfBias(s, i, c.c);
  if (!bias) return null;
  if (!volConfirmed(candles, s, i, 1.2)) return null;

  let fvgBull = false;
  let fvgBear = false;
  for (let j = Math.max(2, i - 2); j <= i; j++) {
    if (candles[j].l > candles[j - 2].h) fvgBull = true;
    if (candles[j].h < candles[j - 2].l) fvgBear = true;
  }
  const cisdUp = c.c > candles[i - 1].h;
  const cisdDown = c.c < candles[i - 1].l;

  if (sweptLow) {
    if (bias !== 1) return null;
    if (!fvgBull && !cisdUp) return null;
    if (c.c > rLo + (rHi - rLo) * 0.45) return null;
    const tags = ['레인지 스윕'];
    if (fvgBull) tags.push('FVG');
    if (cisdUp) tags.push('CISD');
    tags.push('HTF 상승 동조');
    // 무효화 지점 = 스윕한 저점(스윕 캔들 저가) — 그 바로 아래에서만 손절
    return assembleSetup(tf, 'long', c.c, c.l - 0.2 * a, a, (risk) => fixedR('long', c.c, risk, 1.7), tags);
  }
  if (bias !== -1) return null;
  if (!fvgBear && !cisdDown) return null;
  if (c.c < rHi - (rHi - rLo) * 0.45) return null;
  const tags = ['레인지 스윕'];
  if (fvgBear) tags.push('FVG');
  if (cisdDown) tags.push('CISD');
  tags.push('HTF 하락 동조');
  return assembleSetup(tf, 'short', c.c, c.h + 0.2 * a, a, (risk) => fixedR('short', c.c, risk, 1.7), tags);
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
      return assembleSetup(tf, 'long', entry, obLow - 0.2 * a, a, (risk) => fixedR('long', entry, risk, 2.2), [
        '유동성 스윕',
        'OB 리테스트',
      ]);
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
      return assembleSetup(tf, 'short', entry, obHigh + 0.2 * a, a, (risk) => fixedR('short', entry, risk, 2.2), [
        '유동성 스윕',
        'OB 리테스트',
      ]);
    }
  }
  return null;
}

/** 3. EMA 20/50 Pullback + RSI Divergence (HTF 추세 동조 + 거래량) */
/**
 * 3. EMA 20/50 눌림 + RSI — 눌림 뒤 **반등 확인 3종**(거래량·종가 위치·RSI 반등)까지 겹칠 때만 진입.
 *  2026-11-23 전수 재측정: 확인 없이 잡던 기존 규칙은 42.1%/+0.093R(왕복 0.12% 차감)로
 *  기대값이 수수료를 겨우 넘겼다. 세 조건을 더하니 47.0%/+0.253R(PF 1.45) — 표본 1,198건,
 *  IS 46.3% / OOS 47.6% 로 최근 구간에서도 유지돼 저승률 기법에서 탈출했다.
 */
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
  const bias = htfBias(s, i, c.c);
  if (trendUp && bias !== 1) return null;
  if (trendDown && bias !== -1) return null;

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

  // ── 반등 확인 3종: 거래량이 실린 봉 + 추세 방향으로 마감 + RSI가 꺾여 돌아섬 ──
  if (!volConfirmed(candles, s, i, 1.2)) return null;
  const span = c.h - c.l || 1;
  if (trendUp && (c.c - c.l) / span < 0.6) return null;
  if (trendDown && (c.h - c.c) / span < 0.6) return null;
  const rPrev = s.rsi14[i - 1];
  if (!Number.isFinite(rPrev)) return null;
  if (trendUp && !(r > rPrev)) return null;
  if (trendDown && !(r < rPrev)) return null;

  const tags = ['EMA20 눌림', div ? 'RSI 다이버전스' : 'RSI 회복', '반등 확인', 'HTF 동조'];
  if (trendUp) {
    if (c.c <= e20) return null;
    if (!div && r < 50) return null;
    // 눌림 저점(최근 3봉 저가) 이탈이 무효화 지점
    const swingLow = rangeOf(candles, i - 3, i).lo;
    return assembleSetup(tf, 'long', c.c, swingLow - 0.2 * a, a, (risk) => fixedR('long', c.c, risk, 1.8), tags);
  }
  if (c.c >= e20) return null;
  if (!div && r > 50) return null;
  const swingHigh = rangeOf(candles, i - 3, i).hi;
  return assembleSetup(tf, 'short', c.c, swingHigh + 0.2 * a, a, (risk) => fixedR('short', c.c, risk, 1.8), tags);
}

/**
 * EQ Mean Reversion + Engulfing (HTF 추세 동조 + 거래량)
 * 2026-11-23 전수 재측정에서 어떤 강화 조합(거래량·몸통 1ATR·구간 2ATR·EMA200 정렬·목표 2.3R)으로도
 * 승률 45%를 넘지 못해(최고 42.6%/+0.199R) 라이브 풀에서 제외하고 `strategyLab.ts` 로 옮겼다.
 * 장세가 바뀌면 토너먼트가 다시 채점한다.
 */
export function eqEngulfing(candles: Candle[], s: Series, i: number, tf: TF): Setup | null {
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
      // 구조 목표(구간 고점)까지 1.5R 이상 여유가 있어야 셋업으로 인정한다
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
}

/** 5. SuperTrend / Donchian Momentum (HTF 추세 동조 + 거래량) */
function supertrendDonchian(candles: Candle[], s: Series, i: number, tf: TF): Setup | null {
  if (i < 52) return null;
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
    if (htfBias(s, i, c.c) !== 1) return null;
    if (!volConfirmed(candles, s, i, 1.2)) return null;
    const tags = [flipUp ? 'ST 전환' : '돈치안 돌파', 'HTF 상승 동조'];
    // ATR 배수 손절 대신 돌파 캔들 저점에 붙여 손절폭을 조인다
    return assembleSetup(tf, 'long', c.c, Math.min(prev.l, c.l) - 0.2 * a, a, (risk) => fixedR('long', c.c, risk, 1.7), tags);
  }
  if (flipDown || breakDown) {
    if (htfBias(s, i, c.c) !== -1) return null;
    if (!volConfirmed(candles, s, i, 1.2)) return null;
    const tags = [flipDown ? 'ST 전환' : '돈치안 돌파', 'HTF 하락 동조'];
    return assembleSetup(tf, 'short', c.c, Math.max(prev.h, c.h) + 0.2 * a, a, (risk) => fixedR('short', c.c, risk, 1.7), tags);
  }
  return null;
}

/**
 * 6. HTF 추세 동조 트랩바 페이드 (Strat Trap-Bar Fade + HTF EMA50 Regime)
 *  상위 타임프레임 추세(EMA200 ≈ 4H EMA50) 방향 안에서만, 직전 12봉 유동성(고·저점)을
 *  스윕한 뒤 몸통 안으로 되돌아 마감한 '트랩바'에 추세 방향으로 진입한다.
 *  → 무필터 역추세 페이드를 배제한 눌림 진입.
 */
function trapBarFade(candles: Candle[], s: Series, i: number, tf: TF): Setup | null {
  if (i < 70) return null;
  const a = atrAt(s, i);
  if (!a) return null;
  const c = candles[i];
  const bias = htfBias(s, i, c.c);
  if (!bias) return null;
  if (!volConfirmed(candles, s, i, 1.2)) return null;
  const { hi, lo } = rangeOf(candles, i - 12, i - 1);

  if (bias === 1) {
    // 하단 유동성 스윕 후 몸통 복귀 + 양봉 마감 (스프링)
    if (!(c.l < lo && c.c > lo && c.c > c.o)) return null;
    if (c.c > c.l + 0.85 * (c.h - c.l)) return null;
    return assembleSetup(tf, 'long', c.c, c.l - 0.2 * a, a, (risk) => fixedR('long', c.c, risk, 1.8), [
      'HTF 상승 추세',
      '하단 트랩바',
      '유동성 스윕',
    ]);
  }
  if (!(c.h > hi && c.c < hi && c.c < c.o)) return null;
  if (c.c < c.h - 0.85 * (c.h - c.l)) return null;
  return assembleSetup(tf, 'short', c.c, c.h + 0.2 * a, a, (risk) => fixedR('short', c.c, risk, 1.8), [
    'HTF 하락 추세',
    '상단 트랩바',
    '유동성 스윕',
  ]);
}

/**
 * 7. Break & Retest (20봉 박스 돌파 → 지지·저항 전환 리테스트)
 *  20봉 박스 상·하단을 종가로 돌파한 뒤, 깨진 경계가 지지(저항)로 전환되는
 *  리테스트 봉에서 추세에 편승한다. HTF 추세 동조 + 거래량 확인.
 */
function breakRetest20(candles: Candle[], s: Series, i: number, tf: TF): Setup | null {
  if (i < 46) return null;
  const a = atrAt(s, i);
  if (!a) return null;
  const c = candles[i];
  const bias = htfBias(s, i, c.c);
  if (!bias) return null;
  if (!volConfirmed(candles, s, i, 1.2)) return null;

  for (let k = i - 8; k <= i - 2; k++) {
    if (k < 21) continue;
    const box = rangeOf(candles, k - 20, k - 1);
    const boxH = box.hi - box.lo;
    if (!(boxH > 0)) continue;

    // 상방 돌파 → 리테스트 롱
    if (bias === 1 && candles[k].c > box.hi && candles[k - 1].c <= box.hi) {
      let intact = true;
      for (let j = k + 1; j <= i; j++) if (candles[j].c < box.hi - 0.5 * a) intact = false;
      if (!intact) continue;
      if (!(c.l <= box.hi + 0.4 * a) || !(c.c > box.hi) || !(c.c > c.o)) continue;
      let retestLow = c.l;
      for (let j = k + 1; j <= i; j++) retestLow = Math.min(retestLow, candles[j].l);
      return assembleSetup(tf, 'long', c.c, retestLow - 0.2 * a, a, (risk) => fixedR('long', c.c, risk, 2.0), [
        '20봉 박스 돌파',
        '지지 전환 리테스트',
      ]);
    }

    // 하방 돌파 → 리테스트 숏
    if (bias === -1 && candles[k].c < box.lo && candles[k - 1].c >= box.lo) {
      let intact = true;
      for (let j = k + 1; j <= i; j++) if (candles[j].c > box.lo + 0.5 * a) intact = false;
      if (!intact) continue;
      if (!(c.h >= box.lo - 0.4 * a) || !(c.c < box.lo) || !(c.c < c.o)) continue;
      let retestHigh = c.h;
      for (let j = k + 1; j <= i; j++) retestHigh = Math.max(retestHigh, candles[j].h);
      return assembleSetup(tf, 'short', c.c, retestHigh + 0.2 * a, a, (risk) => fixedR('short', c.c, risk, 2.0), [
        '20봉 박스 붕괴',
        '저항 전환 리테스트',
      ]);
    }
  }
  return null;
}

/**
 * 8. 멀티타임프레임 모멘텀 정렬 + 볼륨 클라이맥스
 *  EMA20 > EMA50 > EMA200 정렬(추세 정렬) 상태에서 거래량 클라이맥스가 터진 뒤
 *  RSI가 과매도(과매수) 구간을 탈출하는 첫 봉에 추세 방향으로 진입한다.
 *  표본이 적게 잡히는 대신 승률이 가장 높은 기법(전수 백테스트 57.6%).
 */
function momentumClimax(candles: Candle[], s: Series, i: number, tf: TF): Setup | null {
  if (i < 70) return null;
  const a = atrAt(s, i);
  if (!a) return null;
  const c = candles[i];
  const volMa = s.volMa20[i];
  if (!Number.isFinite(volMa) || volMa <= 0) return null;
  if (c.v < volMa * 1.2) return null;

  const e20 = s.ema20[i];
  const e50 = s.ema50[i];
  const e200 = s.ema200[i];
  const r = s.rsi14[i];
  const rPrev = s.rsi14[i - 1];
  if (!Number.isFinite(e20) || !Number.isFinite(e50) || !Number.isFinite(e200)) return null;
  if (!Number.isFinite(r) || !Number.isFinite(rPrev)) return null;

  const alignUp = e20 > e50 && e50 > e200 && c.c > e20;
  const alignDown = e20 < e50 && e50 < e200 && c.c < e20;

  if (alignUp && rPrev < 45 && r >= 45 && c.c > c.o) {
    const swingLow = rangeOf(candles, i - 5, i).lo;
    return assembleSetup(tf, 'long', c.c, swingLow - 0.2 * a, a, (risk) => fixedR('long', c.c, risk, 2.0), [
      'EMA 정렬',
      '볼륨 클라이맥스',
      'RSI 과매도 탈출',
    ]);
  }
  if (alignDown && rPrev > 55 && r <= 55 && c.c < c.o) {
    const swingHigh = rangeOf(candles, i - 5, i).hi;
    return assembleSetup(tf, 'short', c.c, swingHigh + 0.2 * a, a, (risk) => fixedR('short', c.c, risk, 2.0), [
      'EMA 정렬',
      '볼륨 클라이맥스',
      'RSI 과매수 탈출',
    ]);
  }
  return null;
}

export type Detector = (c: Candle[], s: Series, i: number, tf: TF) => Setup | null;

/**
 * 최종 채택 매매법 — 2026-11-23 실제 비트겟 60개 마켓 × 500봉 전수 백테스트로 옥석을 가린 결과.
 * (수수료 0.12% 왕복 차감 · IS/OOS 반쪽 검증 통과 기법만 남김)
 *  · 제거: 볼린저 스퀴즈(-0.16R), 전일 고저점 스윕(-0.01R·최근 반쪽 음수), 급락 플러시(-0.09R)
 */
export const DETECTORS: Record<string, Detector> = {
  'crt-fvg-cisd': crtFvgCisd,
  'sweep-ob': sweepOrderBlock,
  'ema-pullback-rsi': emaPullbackRsi,
  'supertrend-donchian': supertrendDonchian,
  'trap-bar-fade': trapBarFade,
  'break-retest-20': breakRetest20,
  'momentum-climax': momentumClimax,
};
