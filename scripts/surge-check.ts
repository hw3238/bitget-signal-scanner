/**
 * 🚀 급등 탐색기 엔진 단위 검증 (실행: npm run check:surge)
 *
 *  1) 합성 캔들로 6요건 경계값을 하나씩 확인한다(스퀴즈·거래량·숏스퀴즈·상대강세·돌파·비과열)
 *  2) 총점 = Σ(가중치 × 신용도) 가 성립하는지, 가중치 합이 100인지
 *  3) 매매 플랜(진입·목표·손절·손익비·레버리지)이 수식과 맞는지 — 목표는 반드시 2R~3R
 *  4) 유니버스(주식선물·FX 제외) · 필터 · 정렬 · 원클릭 주문용 시그널 변환
 *  5) 마지막으로 **실제 비트겟 API** 캔들로 3종목을 점수화해 값이 유한·정상 범위인지
 */
import type { Candle, Contract, Ticker } from '../src/engine/types';
import {
  matchSurgeFilter,
  plainPrice,
  rankSurgePicks,
  scoreSurge,
  surgePlanLines,
  surgeSignal,
  surgeUniverse,
  SURGE_MAX_SCORE,
  SURGE_MIN_VOLUME,
  SURGE_REQ_META,
  type SurgePick,
} from '../src/engine/surge';
import { recommendLeverage } from '../src/lib/profile';
import { fetchCandles, fetchContracts, fetchTickers } from '../src/api/bitget';

let pass = 0;
const fails: string[] = [];
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fails.push(name);
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ------------------------------------------------------------------ *
 * 합성 캔들
 * ------------------------------------------------------------------ */

interface Bar {
  /** 전봉 종가 대비 등락률(%) */
  r: number;
  /** 거래량 */
  v: number;
}

function candlesOf(bars: Bar[], start = 100, t0 = 1_700_000_000_000): Candle[] {
  let prev = start;
  return bars.map((b, i) => {
    const o = prev;
    const c = o * (1 + b.r / 100);
    const h = Math.max(o, c) * 1.001;
    const l = Math.min(o, c) * 0.999;
    prev = c;
    return { t: t0 + i * 3_600_000, o, h, l, c, v: b.v };
  });
}

/** 넓게 흔들다가(과거) 조용해지고(스퀴즈) 마지막 6봉 완만한 상승 — '급등 직전' 기본형 */
function baseBars(): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < 120; i++) bars.push({ r: i % 2 === 0 ? 2 : -2, v: 1000 });
  for (let i = 0; i < 60; i++) bars.push({ r: i % 2 === 0 ? 0.8 : -0.8, v: 1000 });
  for (let i = 0; i < 14; i++) bars.push({ r: i % 2 === 0 ? 0.2 : -0.2, v: 1000 });
  for (let i = 0; i < 6; i++) bars.push({ r: 0.12, v: i === 5 ? 3000 : 1000 });
  return bars;
}

function tickerOf(last: number, patch: Partial<Ticker> = {}): Ticker {
  return {
    symbol: 'TESTUSDT',
    last,
    change24h: 6,
    quoteVolume: 20_000_000,
    fundingRate: -0.01,
    high24h: last * 1.1,
    low24h: last * 0.9,
    // OI/거래대금 = 0.7 → 숏 쏠림 축적
    openInterestBase: (0.7 * 20_000_000) / last,
    ...patch,
  };
}

const flatBtc = candlesOf(
  Array.from({ length: 200 }, () => ({ r: 0, v: 100 })),
  50_000,
);
const up4h = candlesOf(
  Array.from({ length: 60 }, (_, i) => ({ r: i % 3 === 0 ? -0.4 : 0.5, v: 100 })),
  100,
);

function pickOf(bars: Bar[], patch: Partial<Ticker> = {}, extra: Partial<Parameters<typeof scoreSurge>[0]> = {}) {
  const candles1h = candlesOf(bars);
  const last = candles1h[candles1h.length - 1].c;
  return scoreSurge({
    symbol: 'TESTUSDT',
    base: 'TEST',
    candles1h,
    candles4h: up4h,
    ticker: tickerOf(last, patch),
    btc1h: flatBtc,
    decimals: 4,
    style: 'conservative',
    equity: 500,
    ...extra,
  });
}

/* ------------------------------------------------------------------ *
 * 1) 기본형 — 6요건을 모두 채우는 '출발 직전' 코인
 * ------------------------------------------------------------------ */

check('가중치 합 = 100점', SURGE_MAX_SCORE === 100 && SURGE_REQ_META.reduce((a, r) => a + r.weight, 0) === 100);

const prime = pickOf(baseBars())!;
check('기본형: 결과 생성', !!prime);
check('기본형: 6요건 전부 구성', prime.reqs.length === 6 && prime.reqs.map((r) => r.key).join(',') === 'squeeze,volume,shortSqueeze,relStrength,breakout,coolDown');
check('기본형: 6/6 충족', prime.passed === 6, prime.reqs.map((r) => `${r.label}${r.state === 'pass' ? '✓' : r.state === 'partial' ? '△' : '✕'}(${r.credit.toFixed(2)})`).join(' '));
check('기본형: 점수 85점 이상 · 100점 이하', prime.score >= 85 && prime.score <= 100, `${prime.score}점`);
check('기본형: 급등 유망(prime)', prime.prime);
check('기본형: 총점 = Σ(가중치×신용도)', prime.score === Math.round(prime.reqs.reduce((a, r) => a + r.weight * r.credit, 0)));
check('기본형: 근거 문구에 NaN 없음', ![prime.headline, ...prime.reqs.map((r) => `${r.value}${r.detail}${r.headline}`)].some((s) => /NaN|undefined/.test(s)), prime.headline);

/* ------------------------------------------------------------------ *
 * 2) ① 변동성 응축 경계
 * ------------------------------------------------------------------ */

const noisy = baseBars().map((b, i) => (i >= 180 && i < 194 ? { ...b, r: i % 2 === 0 ? 3 : -3 } : b));
const noisyPick = pickOf(noisy)!;
const squeezeOf = (p: SurgePick) => p.reqs.find((r) => r.key === 'squeeze')!;
check(
  '스퀴즈: 조용한 구간이 넓은 구간보다 신용도 높음',
  squeezeOf(prime).credit > squeezeOf(noisyPick).credit,
  `${squeezeOf(prime).value} vs ${squeezeOf(noisyPick).value}`,
);
check('스퀴즈: 최근 20봉 응축 → 하위 30% 이내', squeezeOf(prime).state === 'pass' && /하위 [0-9]%|하위 [12][0-9]%/.test(squeezeOf(prime).value), squeezeOf(prime).detail);
check('스퀴즈: 급등 축소 시 Pass 아님', squeezeOf(noisyPick).state !== 'pass', `${squeezeOf(noisyPick).state} · ${squeezeOf(noisyPick).detail}`);

/* ------------------------------------------------------------------ *
 * 3) ② 거래량 유입 경계 (1.5배 + 양봉 우위)
 * ------------------------------------------------------------------ */

const lowVol = baseBars().map((b, i) => (i === 199 ? { ...b, v: 1200 } : b));
const volPick = (bars: Bar[]) => pickOf(bars)!.reqs.find((r) => r.key === 'volume')!;
check('거래량: 3배 → Pass', volPick(baseBars()).state === 'pass', volPick(baseBars()).detail);
check('거래량: 1.2배 → Pass 아님', volPick(lowVol).state !== 'pass', volPick(lowVol).detail);
const downVol = baseBars().map((b, i) => (i >= 194 ? { ...b, r: -0.12, v: i === 199 ? 3000 : 1000 } : b));
check('거래량: 급증해도 음봉 우위면 Pass 아님', volPick(downVol).state !== 'pass', volPick(downVol).detail);
check(
  '거래량: 신용도 0~1 범위',
  [baseBars(), lowVol, downVol].every((b) => {
    const v = volPick(b).credit;
    return v >= 0 && v <= 1;
  }),
);

/* ------------------------------------------------------------------ *
 * 4) ③ 숏스퀴즈 압력 — 펀딩 0 이하 '또는' OI/거래대금 0.6 이상
 * ------------------------------------------------------------------ */

const shortOf = (patch: Partial<Ticker>) => pickOf(baseBars(), patch)!.reqs.find((r) => r.key === 'shortSqueeze')!;
check('숏스퀴즈: 펀딩 -0.01% → Pass', shortOf({ fundingRate: -0.01 }).state === 'pass', shortOf({ fundingRate: -0.01 }).detail);
check('숏스퀴즈: 펀딩 +0.02% · OI 낮음 → Pass 아님', shortOf({ fundingRate: 0.02, openInterestBase: 0 }).state !== 'pass', shortOf({ fundingRate: 0.02, openInterestBase: 0 }).detail);
check(
  '숏스퀴즈: 펀딩이 플러스여도 OI/거래대금 0.7이면 Pass(요건의 OR)',
  shortOf({ fundingRate: 0.02 }).state === 'pass',
  shortOf({ fundingRate: 0.02 }).detail,
);
check(
  '숏스퀴즈: 펀딩 -0.02%(비용 부담) 쪽이 펀딩 +0.02%·OI 0.4보다 높음',
  shortOf({ fundingRate: -0.02, openInterestBase: 0 }).credit > shortOf({ fundingRate: 0.02, openInterestBase: (0.4 * 20_000_000) / 100 }).credit,
  `${shortOf({ fundingRate: -0.02, openInterestBase: 0 }).credit} vs ${shortOf({ fundingRate: 0.02, openInterestBase: (0.4 * 20_000_000) / 100 }).credit}`,
);

/* ------------------------------------------------------------------ *
 * 5) ④ BTC 대비 상대 강세
 * ------------------------------------------------------------------ */

const strongBtc = candlesOf(
  Array.from({ length: 200 }, (_, i) => ({ r: i >= 194 ? 1.2 : 0, v: 100 })),
  50_000,
);
const relStrongPick = pickOf(baseBars(), {}, { btc1h: strongBtc })!;
const relStrong = relStrongPick.reqs.find((r) => r.key === 'relStrength')!;
check('상대강세: BTC가 더 강하면 Pass 아님', relStrong.state !== 'pass', relStrong.detail);
check('상대강세: BTC 강세 시 신용도 하락', relStrong.credit < prime.reqs.find((r) => r.key === 'relStrength')!.credit);
const downtrend = baseBars().map((b, i) => (i >= 170 ? { ...b, r: -0.6 } : b));
const relDown = pickOf(downtrend)!.reqs.find((r) => r.key === 'relStrength')!;
check('상대강세: EMA20 아래면 Pass 아님', relDown.state !== 'pass', relDown.detail);
const no4h = pickOf(baseBars(), {}, { candles4h: null })!;
check('상대강세: 4H 미확인은 중립 처리', !no4h.htfChecked && no4h.reqs.find((r) => r.key === 'relStrength')!.state === 'pass');
const down4h = candlesOf(
  Array.from({ length: 60 }, () => ({ r: -0.5, v: 100 })),
  100,
);
const rel4hDown = pickOf(baseBars(), {}, { candles4h: down4h })!;
check('상대강세: 4H 추세 아래면 Pass 아님', rel4hDown.reqs.find((r) => r.key === 'relStrength')!.state !== 'pass', rel4hDown.reqs.find((r) => r.key === 'relStrength')!.detail);

/* ------------------------------------------------------------------ *
 * 6) ⑤ 저항 돌파 임박 (−4% ~ +1%)
 * ------------------------------------------------------------------ */

const breakoutOf = (p: SurgePick) => p.reqs.find((r) => r.key === 'breakout')!;
check('돌파: 30봉 고점 바로 아래 → Pass', breakoutOf(prime).state === 'pass', breakoutOf(prime).detail);
// 저항이 있는 자국 — 185봉에서 +12% 튀었다가 바로 되돌아온 고점(현재가의 약 11% 위)
const withCeiling = baseBars().map((b, i) => (i === 185 ? { ...b, r: 12 } : i === 186 ? { ...b, r: -10.7 } : b));
const ceilingPick = pickOf(withCeiling)!;
check('돌파: 고점이 10% 위에 있으면 Pass 아님', breakoutOf(ceilingPick).state !== 'pass', breakoutOf(ceilingPick).detail);
// 티커가 마지막 봉 고점을 2% 넘어선 자국(진행 봉에서 이미 돌파) → 추격 자리
const overshoot = scoreSurge({
  symbol: 'TESTUSDT',
  base: 'TEST',
  candles1h: candlesOf(baseBars()),
  candles4h: up4h,
  ticker: tickerOf(candlesOf(baseBars()).at(-1)!.c * 1.02, { openInterestBase: 0 }),
  btc1h: flatBtc,
  style: 'conservative',
})!;
check('돌파: 고점을 1% 넘게 돌파하면 Pass 아님', breakoutOf(overshoot).state !== 'pass', breakoutOf(overshoot).detail);
check('돌파: 돌파 추격 경고', overshoot.warnings.some((w) => /돌파/.test(w)), overshoot.warnings.join(' / '));

/* ------------------------------------------------------------------ *
 * 7) ⑥ 비과열 — 24h +18% 이상 · RSI 78 초과 감점
 * ------------------------------------------------------------------ */

const coolOf = (patch: Partial<Ticker>) => pickOf(baseBars(), patch)!.reqs.find((r) => r.key === 'coolDown')!;
check('비과열: 24h +20% → Pass 아님', coolOf({ change24h: 20 }).state !== 'pass', coolOf({ change24h: 20 }).detail);
check('비과열: 24h +20% → 신용도 0', coolOf({ change24h: 20 }).credit === 0);
check('비과열: 24h +15% → 부분 감점', coolOf({ change24h: 15 }).credit < 1 && coolOf({ change24h: 15 }).credit > 0);
const overheated = pickOf(baseBars(), { change24h: 20 })!;
check('비과열 실패 시 경고 문구', overheated.warnings.some((w) => /추격/.test(w)), overheated.warnings.join(' / '));
check('비과열 실패 시 급등 유망 아님', !overheated.prime);
check('비과열: 24h -15% 급락도 감점', coolOf({ change24h: -15 }).state !== 'pass');

const rsiHot = candlesOf(
  baseBars().map((b, i) => (i >= 180 ? { ...b, r: 1.4 } : b)),
);
const rsiHotPick = scoreSurge({
  symbol: 'TESTUSDT',
  base: 'TEST',
  candles1h: rsiHot,
  candles4h: up4h,
  ticker: tickerOf(rsiHot[rsiHot.length - 1].c, { change24h: 5 }),
  btc1h: flatBtc,
  style: 'conservative',
})!;
check('비과열: RSI 78 초과 → Pass 아님', rsiHotPick.reqs.find((r) => r.key === 'coolDown')!.state !== 'pass', rsiHotPick.reqs.find((r) => r.key === 'coolDown')!.detail);

/* ------------------------------------------------------------------ *
 * 8) 매매 플랜 — 진입/목표/손절/손익비/레버리지
 * ------------------------------------------------------------------ */

const plan = prime.plan;
check('플랜: 손절 < 진입 < 목표', plan.stop < plan.entry && plan.entry < plan.target, `${plan.stop.toFixed(4)} < ${plan.entry.toFixed(4)} < ${plan.target.toFixed(4)}`);
check('플랜: 목표 = 진입 + RR × (진입−손절)', near(plan.target, plan.entry + plan.rr * (plan.entry - plan.stop), 1e-9));
check('플랜: 손익비 2R~3R', plan.rr >= 2 && plan.rr <= 3, `${plan.rr}R`);
check('플랜: 손절 폭 0.6%~12%', plan.riskPct >= 0.6 - 1e-9 && plan.riskPct <= 12 + 1e-9, `${plan.riskPct.toFixed(2)}%`);
check(
  '플랜: 손절 폭 = (진입−손절)/진입',
  near(plan.riskPct, ((plan.entry - plan.stop) / plan.entry) * 100, 1e-9),
  `${plan.riskPct.toFixed(3)}%`,
);
check('플랜: 목표 거리 = 손익비 × 손절 폭', near(plan.rewardPct, plan.rr * plan.riskPct, 1e-9), `+${plan.rewardPct.toFixed(2)}%`);
check('플랜: 손절 근거 표기', ['swing', 'atr', 'floor', 'cap'].includes(plan.stopBasis) && plan.atrPct > 0, `${plan.stopBasis} · ATR ${plan.atrPct.toFixed(2)}%`);

const expectedLev = (equity: number | null, style: 'conservative' | 'aggressive') =>
  recommendLeverage(
    { entry: plan.entry, stop: plan.stop, target: plan.target, winRate: prime.qualityWinRate, rr: plan.rr },
    style,
    equity,
    75,
  ).leverage;
check('레버리지: recommendLeverage 와 일치(보수적·$500)', plan.leverage === expectedLev(500, 'conservative'), `${plan.leverage}x`);
const aggressive = pickOf(baseBars(), {}, { style: 'aggressive' })!;
check('레버리지: 공격적이 더 높음', aggressive.plan.leverage >= prime.plan.leverage, `${prime.plan.leverage}x → ${aggressive.plan.leverage}x`);
const small = pickOf(baseBars(), {}, { equity: 80 })!;
const large = pickOf(baseBars(), {}, { equity: 50_000 })!;
check('레버리지: 잔고 구간 반영(소액 ≥ 대형)', small.plan.leverage >= large.plan.leverage, `$80 ${small.plan.leverage}x / $50k ${large.plan.leverage}x`);
check('레버리지: 청산 안전마진 이내', plan.leverage <= plan.safeMax, `${plan.leverage}x ≤ ${plan.safeMax}x`);
check('레버리지: 근거 문구 있음', plan.levNote.length > 10, plan.levNote);

const capped = pickOf(
  baseBars().map((b, i) => (i === 199 ? { ...b, r: -9 } : i === 198 ? { ...b, r: -8 } : b)),
)!;
check('플랜: 손절 폭 12% 상한', capped.plan.riskPct <= 12 + 1e-9, `${capped.plan.riskPct.toFixed(2)}%`);

/* ------------------------------------------------------------------ *
 * 9) 데이터 부족 · 유니버스 · 필터 · 정렬 · 주문 변환
 * ------------------------------------------------------------------ */

check('데이터 부족(139봉) → null', pickOf(baseBars().slice(0, 139)) === null);
const noTickerPrice = scoreSurge({
  symbol: 'X',
  base: 'X',
  candles1h: candlesOf(baseBars()),
  ticker: tickerOf(0),
  btc1h: flatBtc,
})!;
check(
  '티커 현재가가 0 이면 마지막 캔들 종가로 대체',
  !!noTickerPrice && near(noTickerPrice.price, candlesOf(baseBars()).at(-1)!.c, 1e-9),
  noTickerPrice ? `${noTickerPrice.price}` : 'null',
);

const contracts: Contract[] = [
  { symbol: 'BTCUSDT', base: 'BTC', asset: 'crypto', isRwa: false },
  { symbol: 'ETHUSDT', base: 'ETH', asset: 'crypto', isRwa: false },
  { symbol: 'DUSTUSDT', base: 'DUST', asset: 'crypto', isRwa: false },
  { symbol: 'TSLAUSDT', base: 'TSLA', asset: 'stock', isRwa: true },
  { symbol: 'XAUTUSDT', base: 'XAUT', asset: 'fx', isRwa: true },
];
const tickers: Ticker[] = [
  tickerOf(100, { symbol: 'BTCUSDT', quoteVolume: 900_000_000 }),
  tickerOf(50, { symbol: 'ETHUSDT', quoteVolume: 300_000_000 }),
  tickerOf(1, { symbol: 'DUSTUSDT', quoteVolume: SURGE_MIN_VOLUME - 1 }),
  tickerOf(200, { symbol: 'TSLAUSDT', quoteVolume: 500_000_000 }),
  tickerOf(2000, { symbol: 'XAUTUSDT', quoteVolume: 500_000_000 }),
];
const universe = surgeUniverse(contracts, tickers);
check('유니버스: 주식선물·FX 제외', universe.rows.map((r) => r.symbol).join(',') === 'BTCUSDT,ETHUSDT', universe.rows.map((r) => r.symbol).join(','));
check('유니버스: 거래대금 미달 제외', !universe.rows.some((r) => r.symbol === 'DUSTUSDT'));
check('유니버스: 코인 전체 개수는 따로 보고', universe.coinCount === 3 && universe.eligible === 2, `coin ${universe.coinCount} / eligible ${universe.eligible}`);
check('유니버스: 거래대금 내림차순', universe.rows[0].ticker.quoteVolume >= universe.rows[1].ticker.quoteVolume);
check('유니버스: limit 적용', surgeUniverse(contracts, tickers, { limit: 1 }).rows.length === 1);
check('유니버스: 기준 거래대금 상수', SURGE_MIN_VOLUME === 500_000);

const squeezeOnly = pickOf(baseBars(), { fundingRate: 0.02, openInterestBase: 0 }, {})!;
check('필터: 전체는 전부 통과', [prime, squeezeOnly].every((p) => matchSurgeFilter(p, 'all')));
check(
  '필터: 숏스퀴즈 = 요건 Pass 만',
  matchSurgeFilter(prime, 'short') === (prime.reqs.find((r) => r.key === 'shortSqueeze')!.state === 'pass'),
);
check(
  '필터: 스퀴즈·거래량 필터도 같은 규칙',
  matchSurgeFilter(prime, 'squeeze') === (prime.reqs.find((r) => r.key === 'squeeze')!.state === 'pass') &&
    matchSurgeFilter(prime, 'volume') === (prime.reqs.find((r) => r.key === 'volume')!.state === 'pass'),
);
check('필터: 태그는 Pass 요건과 일치', prime.tags.every((t) => ['squeeze', 'short', 'volume'].includes(t)), prime.tags.join(','));

const ordered = [noisyPick, prime, overheated];
const ranked = rankSurgePicks(ordered);
check('정렬: 점수 내림차순', ranked[0].score >= ranked[1].score && ranked[1].score >= ranked[2].score, ranked.map((p) => `${p.base}${p.score}`).join(' > '));
check('정렬: 새 배열을 돌려주고 원본 순서는 그대로', ranked !== ordered && ordered[0] === noisyPick && ordered[2] === overheated);

const signal = surgeSignal(prime, { priceEndStep: 1 });
check('주문 변환: 롱·진행 중', signal.side === 'long' && signal.state === 'open');
check('주문 변환: 진입/목표/손절 그대로', signal.entry === plan.entry && signal.target === plan.target && signal.stop === plan.stop);
check('주문 변환: 손익비·레버리지', signal.rr === plan.rr && signal.leverage === plan.leverage);
check('주문 변환: 승률 등가값(실측 아님)', signal.winRate === prime.qualityWinRate && prime.qualityWinRate >= 46 && prime.qualityWinRate <= 64, signal.winRate.toFixed(1));

const lines = surgePlanLines(prime);
check('복사 문구: 콤마 없는 가격 3종', ![lines.entry, lines.target, lines.stop].some((s) => !s || s.includes(',')), `${lines.entry} / ${lines.target} / ${lines.stop}`);
check('복사 문구: 종목·점수·손익비 포함', lines.text.includes('TEST') && lines.text.includes(`${prime.score}점`) && lines.text.includes('1 :'));
check('가격 표기: 0.00001234 도 지수 표기 없이', plainPrice(0.00001234, 8) === '0.00001234', plainPrice(0.00001234, 8));

/* ------------------------------------------------------------------ *
 * 10) 실제 비트겟 API 교차검증 (상위 3종목)
 * ------------------------------------------------------------------ */

async function live() {
  const [liveContracts, liveTickers] = await Promise.all([fetchContracts(), fetchTickers()]);
  const u = surgeUniverse(liveContracts, liveTickers);
  check('라이브: 코인 선물 유니버스 구성', u.rows.length > 50, `${u.coinCount}개 코인 중 ${u.eligible}개(거래대금 ${SURGE_MIN_VOLUME.toLocaleString('en-US')} 이상)`);
  const btc = await fetchCandles('BTCUSDT', '1H', 200);
  const samples = u.rows.slice(0, 3);
  for (const row of samples) {
    const c1 = await fetchCandles(row.symbol, '1H', 200);
    const c4 = await fetchCandles(row.symbol, '4H', 60);
    const p = scoreSurge({
      symbol: row.symbol,
      base: row.base,
      candles1h: c1,
      candles4h: c4,
      ticker: row.ticker,
      btc1h: btc,
      decimals: row.decimals,
      maxLever: row.maxLever,
      style: 'conservative',
      equity: 500,
    });
    check(
      `라이브 ${row.base}: 점수·플랜 정상`,
      !!p && p.score >= 0 && p.score <= 100 && p.plan.stop < p.plan.entry && p.plan.entry < p.plan.target && p.plan.rr >= 2 && p.plan.rr <= 3,
      p ? `${p.score}점 ${p.passed}/6 · 진입 ${p.plan.entry} 목표 ${p.plan.target.toFixed(6)} 손절 ${p.plan.stop.toFixed(6)} · ${p.plan.leverage}x` : 'null',
    );
    check(
      `라이브 ${row.base}: 현재가 = 비트겟 티커`,
      !!p && near(p.price, row.ticker.last, 1e-9),
      p ? `${p.price} / ${row.ticker.last}` : 'null',
    );
  }
}

live()
  .catch((e) => {
    fails.push('라이브 교차검증');
    console.log(`❌ 라이브 교차검증 — ${e instanceof Error ? e.message : e}`);
  })
  .finally(() => {
    console.log(`\n${fails.length === 0 ? '✅ 급등 탐색기 엔진 검증 통과' : `❌ 실패 ${fails.length}건`} (${pass}개 확인)`);
    if (fails.length) {
      console.log(fails.join('\n'));
      process.exitCode = 1;
    }
  });
