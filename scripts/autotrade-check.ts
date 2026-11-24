/**
 * 🤖 비트겟 자동매매 단위 검증 — 서명 · 주문 계산 · 안전장치
 *   실행: npm run check:autotrade
 *
 * 1) 서명: 비트겟 v2 규격(prehash → Base64(HMAC-SHA256))을 OpenSSL로 계산한 고정 벡터와 비교한다.
 *    같은 벡터를 네이티브(`BitgetApi.java`)도 통과해야 실제 주문이 나간다.
 * 2) 주문: 리스크 기반 수량 · 거래소 수량 단위 내림 · 포지션 모드(one-way/hedge) 분기 · TP/SL 문자열.
 * 3) 안전장치: 1일 손실 한도 · 중복 진입 · 동시 포지션 · 허용 종목 · 승률/손익비 · 유효시간 · 레버리지 상한.
 * 4) 비트겟 계정 모드(v1.5.1): 통합계정(UTA v3) 자동 판별 · 주문·레버리지 페이로드 · 잔고/포지션 파싱 · 클래식 폴백.
 */
import type { Signal } from '../src/engine/types';
import {
  DEFAULTS,
  LIMITS,
  LIVE_REFRESH_MS,
  MAJOR_SYMBOLS,
  MIN_STOP_DISTANCE,
  MIN_TARGET_GAP,
  RISK_HIGH_WARN,
  RISK_PRESET_CHOICES,
  SNAPSHOT_FRESH_MS,
  applyDailyReset,
  buildOrderParams,
  checkDailyLoss,
  clientOidFor,
  dayKeyKst,
  emptyRuntime,
  evaluateEntry,
  fmtSince,
  fmtUsdt,
  markTraded,
  mergeArmedPlans,
  normalizeConfig,
  normalizePosMode,
  orderSideFor,
  orderPriceText,
  planDailyReset,
  qtyToStep,
  resolveTradeMode,
  planAutoOrder,
  planSeed,
  planTrigger,
  priceText,
  pushLog,
  rollDay,
  roundToTick,
  signalKeyOf,
  statusBadge,
  symbolAllowed,
  todayFillCount,
  tickSizeOf,
  toArmedPlan,
  type AutoTradeConfig,
} from '../src/lib/autotrade';
import {
  EARLY_STOP_COOLDOWN_MS,
  EARLY_STOP_MIN_AGE_MS,
  EARLY_STOP_SIGNAL_MAX_AGE_MS,
  earlyExitLogText,
  emaLast,
  evaluateEarlyExit,
  rMultiple,
  type EarlyExitCandle,
} from '../src/lib/earlyStop';
import { bitgetPrehash, bitgetSign, demoHeader, hmacSha256Base64, maskKey } from '../src/lib/bitgetSign';
import {
  CLASSIC_MODE_ERROR,
  UTA_MODE_ERROR,
  accountKindLabel,
  clientOidV3,
  closeOrderFields,
  modeSwitchTarget,
  parseAssetsV3,
  parsePositionsV3,
  parseSettingsV3,
  resolveAccountKind,
  v2CloseBody,
  v2OrderBody,
  v3CloseBody,
  v3LeverageBody,
  v3MarginMode,
  v3OrderBody,
} from '../src/lib/bitgetUta';

let pass = 0;
const fails: string[] = [];
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
 * 1) 서명 — 고정 벡터
 * ------------------------------------------------------------------ */
const T0 = 1700000000000;

check(
  'HMAC-SHA256 RFC4231 벡터 (Jefe)',
  hmacSha256Base64('Jefe', 'what do ya want for nothing?') === 'W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=',
  hmacSha256Base64('Jefe', 'what do ya want for nothing?'),
);

const prehashGet = bitgetPrehash({
  timestamp: T0,
  method: 'GET',
  requestPath: '/api/v2/mix/account/accounts?productType=USDT-FUTURES',
});
check('prehash = timestamp + METHOD + path(+query)', prehashGet === `${T0}GET/api/v2/mix/account/accounts?productType=USDT-FUTURES`);
check(
  'ACCESS-SIGN (GET · OpenSSL 벡터 일치)',
  bitgetSign('testsecret', {
    timestamp: T0,
    method: 'GET',
    requestPath: '/api/v2/mix/account/accounts?productType=USDT-FUTURES',
  }) === 'g5Rs+wt3ED226Pot2TVP1yx5hO58edA+XN9JvnW1h4E=',
);

const body = '{"symbol":"BTCUSDT","size":"0.01"}';
check(
  'ACCESS-SIGN (POST · body 포함 · OpenSSL 벡터 일치)',
  bitgetSign('testsecret', { timestamp: T0, method: 'POST', requestPath: '/api/v2/mix/order/place-order', body }) ===
    'v/7R8UzW1VTUzgZkfAIEqNm3UmsOXBxh85Aik1Z0YmI=',
);
check('GET 은 body 가 빈 문자열', bitgetPrehash({ timestamp: T0, method: 'GET', requestPath: '/x' }).endsWith('/x'));
check('모의투자 헤더는 paptrading: 1', demoHeader(true).paptrading === '1' && Object.keys(demoHeader(false)).length === 0);
check('키 마스킹은 앞6·뒤4만 노출', maskKey('bg_9f3k2m8d7c6b5a4n3m2c7d').startsWith('bg_9f3') && maskKey('bg_9f3k2m8d7c6b5a4n3m2c7d').endsWith('2c7d'));
check('짧은 키도 마스킹', maskKey('abcd1234').includes('••'));

/* ------------------------------------------------------------------ *
 * 2) 설정 정규화
 * ------------------------------------------------------------------ */
const cfg = normalizeConfig(null);
check('기본값: 자동매매 OFF', cfg.enabled === false);
check('기본값: 모의투자', cfg.mode === 'demo');
check('기본값: 1회 리스크 1.5% · 최대 2포지션 · 1일 손실 4.5%', cfg.riskPct === 1.5 && cfg.maxPositions === 2 && cfg.dailyLossPct === 4.5);
check('기본값: 메이저 4종', cfg.symbols === 'majors' && MAJOR_SYMBOLS.length === 4);
check('이상한 값은 기본값으로', normalizeConfig({ riskPct: Number.NaN, maxPositions: 0 }).riskPct === DEFAULTS.riskPct);
check(
  '리스크 상·하한 클램프',
  normalizeConfig({ riskPct: 99 }).riskPct === LIMITS.riskPct[1] && normalizeConfig({ riskPct: -1 }).riskPct === LIMITS.riskPct[0],
);
check('포지션 수는 정수로', normalizeConfig({ maxPositions: 2.7 }).maxPositions === 3);
check('잘못된 mode 는 demo 로', normalizeConfig({ mode: 'x' as never }).mode === 'demo');
check('허용 종목: 메이저만 / 전체', symbolAllowed(cfg, 'BTCUSDT') && !symbolAllowed(cfg, 'DOGEUSDT') && symbolAllowed({ ...cfg, symbols: 'all' }, 'DOGEUSDT'));

/* ------------------------------------------------------------------ *
 * 3) 1일 손실 한도
 * ------------------------------------------------------------------ */
const g0 = checkDailyLoss({ dayStartEquity: null, equity: 1000, dailyLossPct: 4.5 });
check('기준선 없으면 잠그지 않음', !g0.locked && g0.limitUsd === 0);
const g1 = checkDailyLoss({ dayStartEquity: 1000, equity: 970, dailyLossPct: 4.5 });
check('−3% 는 아직 통과', !g1.locked && Math.abs(g1.pnlUsd + 30) < 1e-9 && Math.abs(g1.remainingUsd - 15) < 1e-9);
const g2 = checkDailyLoss({ dayStartEquity: 1000, equity: 955, dailyLossPct: 4.5 });
check('정확히 −4.5% 에서 잠금', g2.locked && Math.abs(g2.pnlUsd + 45) < 1e-9);
const g3 = checkDailyLoss({ dayStartEquity: 1000, equity: 948, dailyLossPct: 4.5 });
check('한도 초과도 잠금 · 남은 여유 0', g3.locked && g3.remainingUsd === 0);
check('수익 중이면 잠금 없음', !checkDailyLoss({ dayStartEquity: 1000, equity: 1010, dailyLossPct: 4.5 }).locked);

/* ------------------------------------------------------------------ *
 * 4) 거래일(KST) — UTC 15:00 = KST 다음 날 00:00
 * ------------------------------------------------------------------ */
check('KST 날짜 키', dayKeyKst(Date.UTC(2026, 10, 22, 14, 59)) === '2026-11-22');
check('UTC 15:00 은 KST 다음 날', dayKeyKst(Date.UTC(2026, 10, 22, 15, 0)) === '2026-11-23');

/* ------------------------------------------------------------------ *
 * 5) 주문 계산
 * ------------------------------------------------------------------ */
const sig = (o: Partial<Signal> = {}): Signal => ({
  id: 'BTCUSDT|1H|long|1700000000000',
  symbol: 'BTCUSDT',
  base: 'BTC',
  asset: 'crypto',
  tf: '1H',
  side: 'long',
  strategyId: 'sweep-ob',
  strategyName: '유동성 스윕 + 오더블록 리테스트',
  strategyShort: '스윕·OB',
  star: 5,
  entry: 100,
  stop: 95,
  target: 115,
  eq: 100,
  rr: 3,
  remainingRR: 3,
  currentR: 0,
  price: 100,
  changePct: 0,
  progress: 0.2,
  state: 'open',
  detectedAt: T0,
  barsSince: 1,
  winRate: 60,
  strategyRR: 3,
  leverage: 10,
  levRoi: 0,
  candles: [],
  detectedIdx: 0,
  tags: [],
  fundingRate: 0,
  quoteVolume: 0,
  ...o,
});

const now = T0 + 10 * 60_000;
const plan = planAutoOrder({ signal: sig(), seed: 1000, config: cfg, leverage: 10 });
check('수량 = 시드×리스크% ÷ 손절거리 (1000×1.5%÷5 = 3)', Math.abs(plan.qty - 3) < 1e-9, `qty=${plan.qty}`);
check('손절 손실 = 15 USDT', Math.abs(plan.riskUsd - 15) < 1e-9);
check('목표 수익 = 45 USDT · 손익비 3R', Math.abs(plan.profitUsd - 45) < 1e-9 && Math.abs(plan.rr - 3) < 1e-9);

const floored = planAutoOrder({ signal: sig(), seed: 1000, config: cfg, leverage: 10, spec: { volumePlace: 2, minTradeNum: 0.01, minTradeUsdt: 5 } });
check('거래소 수량 단위로 내림 (3 → 3.00)', floored.qty === 3 && floored.qtyDecimals === 2);

const small = planAutoOrder({ signal: sig(), seed: 100, config: cfg, leverage: 10, spec: { volumePlace: 2, minTradeNum: 1 } });
check('작은 시드는 최소 수량 미만으로 표시', small.belowMinQty && small.qty < 1, `qty=${small.qty}`);

const capped = planAutoOrder({ signal: sig(), seed: 1000, config: { ...cfg, maxLeverage: 5 }, leverage: 25 });
check('레버리지 상한으로 자름 (25 → 5)', capped.leverage === 5);

check('포지션 모드 정규화', normalizePosMode('hedge_mode') === 'hedge_mode' && normalizePosMode('one_way_mode') === 'one_way_mode' && normalizePosMode(undefined) === 'one_way_mode');

const owLong = orderSideFor('long', 'open', 'one_way_mode');
check('one-way 롱 진입 = buy · tradeSide 없음', owLong.side === 'buy' && owLong.tradeSide === undefined);
const hgShort = orderSideFor('short', 'open', 'hedge_mode');
check('hedge 숏 진입 = sell/open', hgShort.side === 'sell' && hgShort.tradeSide === 'open');
const hgClose = orderSideFor('long', 'close', 'hedge_mode');
check('hedge 롱 청산 = sell/close', hgClose.side === 'sell' && hgClose.tradeSide === 'close');

const market = buildOrderParams({ signal: sig(), plan, posMode: 'one_way_mode' });
check('시장가 주문: side=buy · tradeSide 없음', market.side === 'buy' && market.tradeSide === undefined);
check('주문에 TP/SL 동시 설정', market.presetStopSurplusPrice === '115' && market.presetStopLossPrice === '95');
check('주문 수량 문자열', market.size === '3', market.size);
check('clientOid 는 36자 이내 영숫자', /^[A-Za-z0-9]{1,36}$/.test(clientOidFor('BTCUSDT', T0)), clientOidFor('BTCUSDT', T0));
const hedgeOrder = buildOrderParams({ signal: sig({ side: 'short', entry: 100, stop: 105, target: 90 }), plan, posMode: 'hedge_mode' });
check('hedge 주문에는 tradeSide=open', hedgeOrder.side === 'sell' && hedgeOrder.tradeSide === 'open');
const limitOrder = buildOrderParams({ signal: sig({ decimals: 1 }), plan, posMode: 'one_way_mode', orderType: 'limit', limitPrice: 100 });
check('지정가 주문에는 price 포함', limitOrder.orderType === 'limit' && limitOrder.price === '100');
check('가격 문자열: 정수는 그대로', priceText(115, 0) === '115');
check('가격 문자열: 소수 유지·꼬리 0 제거', priceText(0.12345678, 8) === '0.12345678' && priceText(1.5, 2) === '1.5');
check('가격 문자열: 큰 수 지수 표기 없음', !priceText(61320.2, 1).includes('e'));

/* ------------------------------------------------------------------ *
 * 6) 진입 게이트
 * ------------------------------------------------------------------ */
const genie = (o: {
  config?: Partial<AutoTradeConfig>;
  signal?: Partial<Signal>;
  traded?: string[];
  positions?: number;
  locked?: boolean;
  hasKeys?: boolean;
  manual?: boolean;
  plan?: typeof plan | null;
} = {}) => {
  const config = normalizeConfig({ ...cfg, ...o.config });
  const signal = sig(o.signal);
  return evaluateEntry({
    config,
    signal,
    tradedKeys: o.traded ?? [],
    openPositions: o.positions ?? 0,
    dailyLocked: o.locked ?? false,
    plan: o.plan === undefined ? planAutoOrder({ signal, seed: 1000, config, leverage: 10 }) : o.plan,
    now,
    hasKeys: o.hasKeys !== false,
    manual: o.manual,
  });
};

check('게이트: 자동매매 꺼짐 → off', genie().code === 'off');
const on = { enabled: true };
check('게이트: 통과 시 ok', genie({ config: on }).allowed, genie({ config: on }).reason);
check('게이트: autoEntry=false · 자동 → manual-only', genie({ config: { ...on, autoEntry: false } }).code === 'manual-only');
check('게이트: autoEntry=false · 원클릭 → 통과', genie({ config: { ...on, autoEntry: false }, manual: true }).allowed);
check('게이트: 키 없음 → no-keys', genie({ config: on, hasKeys: false }).code === 'no-keys');
check('게이트: 종료된 시그널 → not-open', genie({ config: on, signal: { state: 'loss' } }).code === 'not-open');
check('게이트: 메이저 아닌 종목 → symbol', genie({ config: on, signal: { symbol: 'DOGEUSDT', base: 'DOGE' } }).code === 'symbol');
check('게이트: 승률 미달 → winrate', genie({ config: { ...on, minWinRate: 70 }, signal: { winRate: 62 } }).code === 'winrate');
// 전수 검증(표본 부족) 채택 신호는 승률이 낮게 표기된다 — 기대값이 확실한 기법은 승률 기준을 우회한다.
check(
  '게이트: 전수 검증 · 기대값 0.30R 이상 → 승률 기준 우회',
  genie({ config: { ...on, minWinRate: 55 }, signal: { winRate: 47, winRateBasis: 'bench', strategyExp: 0.34 } }).allowed,
);
check(
  '게이트: 전수 검증 · 기대값 0.20R → 승률 기준 적용',
  genie({ config: { ...on, minWinRate: 55 }, signal: { winRate: 47, winRateBasis: 'bench', strategyExp: 0.2 } }).code === 'winrate',
);
check(
  '게이트: 마켓 실측 신호는 기대값과 무관하게 승률 기준',
  genie({ config: { ...on, minWinRate: 55 }, signal: { winRate: 47, winRateBasis: 'market', strategyExp: 0.5 } }).code === 'winrate',
);
check('게이트: 손익비 미달 → rr', genie({ config: { ...on, minRR: 2 }, signal: { rr: 1.6 }, plan: planAutoOrder({ signal: sig({ rr: 1.6 }), seed: 1000, config: normalizeConfig({ ...on, minRR: 2 }), leverage: 10 }) }).code === 'rr');
check('게이트: 같은 시그널 중복 진입 → duplicate', genie({ config: on, traded: [signalKeyOf(sig())] }).code === 'duplicate');
check('게이트: 동시 포지션 초과 → max-positions', genie({ config: on, positions: 2 }).code === 'max-positions');
check('게이트: 1일 손실 잠금 → daily-locked', genie({ config: on, locked: true }).code === 'daily-locked');
check('게이트: 유효시간 초과 → stale', genie({ config: { ...on, entryTtlMin: 5 }, signal: { detectedAt: T0 - 60 * 60_000 } }).code === 'stale');
check('게이트: 원클릭은 유효시간 무시', genie({ config: { ...on, entryTtlMin: 5 }, signal: { detectedAt: T0 - 60 * 60_000 }, manual: true }).allowed);
check(
  '게이트: 레버리지 상한 초과 → leverage',
  genie({ config: { ...on, maxLeverage: 5 }, plan: { ...plan, leverage: 10 } }).code === 'leverage',
);
check(
  '게이트: 최소 수량 미만 → plan',
  genie({ config: on, signal: { symbol: 'BTCUSDT' }, plan: { ...plan, qty: 0.001, belowMinQty: true, minQty: 1 } }).code === 'plan',
);
check('게이트: 계획 없음 → plan', genie({ config: on, plan: null }).code === 'plan');
check(
  '게이트: 증거금 과다 → plan',
  genie({ config: on, plan: { ...plan, overSeed: true } }).code === 'plan',
);

/* ------------------------------------------------------------------ *
 * 7) 감시 목록(진입 트리거) — 화면 꺼짐 감시의 핵심
 * ------------------------------------------------------------------ */
const armed = toArmedPlan({ signal: sig(), plan, now, ttlMin: 120 });
check('감시 목록: 수량·TP/SL·만료를 담는다', armed.qty === 3 && armed.target === 115 && armed.expiresAt === now + 120 * 60_000);
check('롱: 진입가 터치 → enter', planTrigger(armed, 100.02, now) === 'enter');
check('롱: 아직 위에 있으면 wait', planTrigger(armed, 101, now) === 'wait');
check('롱: 손절가 먼저 깨면 invalidated', planTrigger(armed, 94.5, now) === 'invalidated');
const shortPlan = toArmedPlan({ signal: sig({ side: 'short', entry: 100, stop: 105, target: 90 }), plan, now, ttlMin: 30 });
check('숏: 진입가까지 오르면 enter', planTrigger(shortPlan, 99.98, now) === 'enter');
check('숏: 손절가 넘으면 invalidated', planTrigger(shortPlan, 106, now) === 'invalidated');
check('만료된 감시는 expired', planTrigger(armed, 100, now + 3 * 3600_000) === 'expired');
check('가격 0 은 wait', planTrigger(armed, 0, now) === 'wait');

const merged = mergeArmedPlans([armed], [armed, { ...armed, key: 'ETHUSDT|4H|long|1' }]);
check('감시 목록은 같은 키를 중복 저장하지 않는다', merged.length === 2);

/* ------------------------------------------------------------------ *
 * 8) 상태 · 로그
 * ------------------------------------------------------------------ */
let rt = emptyRuntime(now, 1000);
check('새 상태: KST 날짜 · 기준선', rt.dayKey === dayKeyKst(now) && rt.dayStartEquity === 1000);
rt = markTraded(rt, 'k1');
rt = markTraded(rt, 'k1');
check('중복 표시는 한 번만', rt.tradedKeys.length === 1);
rt = pushLog(rt, { at: now, level: 'fill', text: '체결' });
check('로그가 쌓인다', rt.logs.length === 1 && rt.logs[0].text === '체결');
for (let i = 0; i < 80; i += 1) rt = pushLog(rt, { at: now + i, level: 'info', text: `log ${i}` });
check('로그는 60건까지만', rt.logs.length === 60);
const rolled = rollDay(rt, now + 24 * 3600_000, 900);
check('날짜가 바뀌면 기준선을 새로 잡는다', rolled.dayKey !== rt.dayKey && rolled.dayStartEquity === 900);
check('날짜 변경은 진입 키를 지우지 않는다', rolled.tradedKeys.length === 1);

check('상태 배지: 꺼짐', statusBadge(normalizeConfig(cfg), false).label === '꺼짐');
check('상태 배지: 모의투자 가동', statusBadge(normalizeConfig({ ...cfg, enabled: true }), true).label === '모의투자 가동 중');
check('상태 배지: 실거래 가동', statusBadge(normalizeConfig({ ...cfg, enabled: true, mode: 'live' }), true).label === '실거래 가동 중');
/* ------------------------------------------------------------------ *
 * 9) 1회 리스크 50% 확장 — 설정·수량·1일 손실 한도
 * ------------------------------------------------------------------ */
check('리스크 상한 = 50%', normalizeConfig({ riskPct: 99 }).riskPct === 50 && LIMITS.riskPct[1] === 50);
check('리스크 하한 = 0.5%', normalizeConfig({ riskPct: 0.1 }).riskPct === 0.5 && LIMITS.riskPct[0] === 0.5);
check('리스크 0.5% 단위 유지', normalizeConfig({ riskPct: 12.34 }).riskPct === 12.3);
check('프리셋 1/2/3/5/10/20/30/50', RISK_PRESET_CHOICES.join(',') === '1,2,3,5,10,20,30,50');
check('고위험 기준 10%', RISK_HIGH_WARN === 10);

const halfCfg = normalizeConfig({ ...cfg, enabled: true, riskPct: 50 });
const halfPlan = planAutoOrder({ signal: sig(), seed: 1000, config: halfCfg, leverage: 10 });
check('리스크 50% 수량 = 100 (1000×50%÷5)', halfPlan.qty === 100, `qty=${halfPlan.qty}`);
check('리스크 50% 손실금 = $500', Math.abs(halfPlan.riskUsd - 500) < 1e-9);
check('리스크 50% 도 손절가·목표가 그대로', halfPlan.stopLossUsd === -500 && Math.abs(halfPlan.profitUsd - 1500) < 1e-9);
check(
  '리스크 50% 자동 진입 게이트 통과',
  evaluateEntry({
    config: halfCfg,
    signal: sig(),
    tradedKeys: [],
    openPositions: 0,
    dailyLocked: false,
    plan: halfPlan,
    now,
    hasKeys: true,
  }).allowed,
);

check('1일 손실 한도 100% 허용', normalizeConfig({ dailyLossPct: 120 }).dailyLossPct === 100);
check('1일 손실 한도 끄기(0) 허용', normalizeConfig({ dailyLossPct: 0 }).dailyLossPct === 0);
check('한도 끄면 잠그지 않음', !checkDailyLoss({ dayStartEquity: 1000, equity: 10, dailyLossPct: 0 }).locked);
check('한도 100%: −99% 손실도 잠기지 않음(사실상 끄기)', !checkDailyLoss({ dayStartEquity: 1000, equity: 10, dailyLossPct: 100 }).locked);
check('한도 50%: −50% 에서 잠금', checkDailyLoss({ dayStartEquity: 1000, equity: 500, dailyLossPct: 50 }).locked);
check('계좌 equity 미확인(null)이면 잠그지 않음', !checkDailyLoss({ dayStartEquity: 1000, equity: null, dailyLossPct: 4.5 }).locked);
check(
  '한도 끄기 상태에서는 daily-locked 게이트를 건너뛴다',
  evaluateEntry({
    config: normalizeConfig({ ...cfg, enabled: true, dailyLossPct: 0 }),
    signal: sig(),
    tradedKeys: [],
    openPositions: 0,
    dailyLocked: true,
    plan: planAutoOrder({ signal: sig(), seed: 1000, config: normalizeConfig({ ...cfg, enabled: true, dailyLossPct: 0 }), leverage: 10 }),
    now,
    hasKeys: true,
  }).allowed,
);

check('시드: 프로필 우선', planSeed({ seed: 5000, style: 'conservative', updatedAt: 0 }, 800) === 5000);
check('시드: 프로필 없으면 계좌', planSeed(null, 800) === 800);
check('시드: 둘 다 없으면 0', planSeed(null, null) === 0);
check('금액 표기', fmtUsdt(-45.5) === '−$45.50' && fmtUsdt(1234.5) === '$1,235');


/* ------------------------------------------------------------------ *
 * 10) 비트겟 계정 모드 — 통합계정(UTA v3) 자동 판별 · 페이로드 · 파싱 (v1.5.1)
 * ------------------------------------------------------------------ */

/* 10-1) 계정 판별 */
check('v3 settings 성공(00000) → 통합계정(UTA)', resolveAccountKind({ settingsOk: true }) === 'uta');
check(`v3 settings ${CLASSIC_MODE_ERROR} → 클래식 계정`, resolveAccountKind({ settingsCode: CLASSIC_MODE_ERROR }) === 'classic');
check(`v2 계좌 ${UTA_MODE_ERROR} → 통합계정(UTA) 폴백`, resolveAccountKind({ v2Code: UTA_MODE_ERROR }) === 'uta');
check('v2 계좌 성공 → 클래식 계정', resolveAccountKind({ v2Ok: true }) === 'classic');
check('판별 실패는 null(모름)', resolveAccountKind({}) === null && resolveAccountKind({ settingsCode: '40014' }) === null);
check('v3 settings 권한오류라도 v2 성공이면 클래식', resolveAccountKind({ settingsCode: '40012', v2Ok: true }) === 'classic');
check('v3 settings 권한오류 + v2 40085 → 통합계정', resolveAccountKind({ settingsCode: '40014', v2Code: UTA_MODE_ERROR }) === 'uta');
check('모드 전환 신호: 40085→uta · 40084→classic', modeSwitchTarget(UTA_MODE_ERROR) === 'uta' && modeSwitchTarget(CLASSIC_MODE_ERROR) === 'classic');
check('모드 전환 신호 아님: 40014', modeSwitchTarget('40014') === null);
check('계정 라벨', accountKindLabel('uta') === '통합계정(UTA)' && accountKindLabel('classic') === '클래식 계정' && accountKindLabel(undefined) === '확인 중');

/* 10-2) v3 주문 페이로드 — 단방향 */
const canonical = {
  symbol: 'BTCUSDT',
  size: '3',
  side: 'buy' as const,
  orderType: 'market' as const,
  clientOid: 'cotaBTCUSDT1a2b3c',
  presetStopSurplusPrice: '115',
  presetStopLossPrice: '95',
  marginMode: 'isolated',
};
const utaOw = v3OrderBody(canonical, { holdMode: 'one_way_mode', marginMode: 'crossed' });
check(
  'v3 단방향 주문 body: category·qty(size 아님)·TP/SL·marginMode',
  JSON.stringify(utaOw) ===
    JSON.stringify({
      category: 'USDT-FUTURES',
      symbol: 'BTCUSDT',
      qty: '3',
      side: 'buy',
      orderType: 'market',
      marginMode: 'crossed',
      clientOid: 'cotaBTCUSDT1a2b3c',
      takeProfit: '115',
      tpOrderType: 'market',
      stopLoss: '95',
      slOrderType: 'market',
    }),
  JSON.stringify(utaOw),
);
check('v3 body 에는 size·productType·presetStopSurplusPrice 가 없다', !('size' in utaOw) && !('productType' in utaOw) && !('presetStopSurplusPrice' in utaOw));
check('v3 단방향에는 posSide 없음', !('posSide' in utaOw));

/* 10-3) v3 주문 페이로드 — 헤지 */
const utaHedge = v3OrderBody({ ...canonical, side: 'sell' }, { holdMode: 'hedge_mode', marginMode: 'isolated' });
check('v3 헤지 숏 진입 = side sell + posSide short', utaHedge.posSide === 'short' && utaHedge.side === 'sell');
check('v3 헤지는 tradeSide 를 쓰지 않는다', !('tradeSide' in utaHedge));
check('v3 헤지 주문도 TP/SL 시장가 트리거', utaHedge.takeProfit === '115' && utaHedge.slOrderType === 'market');
const utaHedgeExplicit = v3OrderBody({ ...canonical, side: 'buy', posSide: 'short' }, { holdMode: 'hedge_mode' });
check('posSide 를 넘기면 그 값을 그대로 쓴다', utaHedgeExplicit.posSide === 'short');

/* 10-4) v2 페이로드는 그대로 */
const v2Body = v2OrderBody(canonical);
check(
  'v2 주문 body: size·productType·presetStopSurplusPrice 유지',
  v2Body.size === '3' &&
    v2Body.productType === 'USDT-FUTURES' &&
    v2Body.presetStopSurplusPrice === '115' &&
    v2Body.presetStopLossPrice === '95' &&
    v2Body.marginCoin === 'USDT',
);
check('v2 body 에는 category·qty·takeProfit 이 없다', !('category' in v2Body) && !('qty' in v2Body) && !('takeProfit' in v2Body));

/* 10-5) 마진 모드 표기 · clientOid 규칙 */
check('v3 마진 모드: isolated/crossed', v3MarginMode('isolated') === 'isolated' && v3MarginMode('cross') === 'crossed' && v3MarginMode(undefined) === 'crossed');
const longOid = 'cotaBTCUSDTabcdefghijklmnopqrstuvwxyz0123456789';
check('v3 clientOid 32자 제한', clientOidV3(longOid).length === 32);
check('v3 clientOid 정규식 통과', /^[.A-Z:/a-z0-9_-]{1,32}$/.test(clientOidV3('c+a#ta/1:2_b-c')));
check('v3 clientOid 빈 값은 cota', clientOidV3('') === 'cota' && clientOidV3(null) === 'cota');

/* 10-6) v3 레버리지 */
const levOw = v3LeverageBody({ symbol: 'BTCUSDT', leverage: '10', holdMode: 'one_way_mode', marginMode: 'crossed' });
check('v3 레버리지(단방향): category·symbol·leverage·marginMode', levOw.category === 'USDT-FUTURES' && levOw.leverage === '10' && levOw.marginMode === 'crossed' && !('posSide' in levOw));
const levHedge = v3LeverageBody({ symbol: 'ETHUSDT', leverage: '5', holdMode: 'hedge_mode', marginMode: 'isolated', posSide: 'short' });
check('v3 레버리지(헤지): posSide + long/shortLeverage', levHedge.posSide === 'short' && levHedge.longLeverage === '5' && levHedge.shortLeverage === '5');

/* 10-7) v3 잔고 파싱 */
const assetsFixture = {
  accountEquity: '11.13919278',
  usdtEquity: '11.13921165',
  usdtUnrealisedPnl: '0.42',
  effEquity: '6.19299777',
  assets: [
    { coin: 'BGB', equity: '1.15582129', available: '1.1' },
    { coin: 'USDT', equity: '6.19300826', available: '5.5' },
  ],
};
const parsed = parseAssetsV3(assetsFixture);
check('v3 잔고: USDT 행 equity·available 우선', parsed.equity === 6.19300826 && parsed.available === 5.5, JSON.stringify(parsed));
check('v3 잔고: 평가손익 = usdtUnrealisedPnl', parsed.unrealizedPL === 0.42);
const parsedNoRow = parseAssetsV3({ usdtEquity: '50.5', effEquity: '40', assets: [{ coin: 'BGB', equity: '1' }] });
check('v3 잔고: USDT 행이 없으면 usdtEquity·effEquity 로 폴백', parsedNoRow.equity === 50.5 && parsedNoRow.available === 40);
check('v3 잔고: 빈 응답은 0', parseAssetsV3(null).equity === 0);

/* 10-8) v3 포지션 파싱 */
const posFixture = {
  list: [
    {
      category: 'USDT-FUTURES',
      symbol: 'BTCUSDT',
      holdMode: 'hedge_mode',
      posSide: 'long',
      positionBalance: '470.5',
      total: '0.5',
      leverage: '10',
      avgPrice: '61000',
      markPrice: '61500.5',
      unrealisedPnl: '12.3',
      liquidationPrice: '55000',
      createdTime: '1736378720620',
    },
    { symbol: 'ETHUSDT', posSide: 'short', total: '0', avgPrice: '3000' },
  ],
};
const pos = parsePositionsV3(posFixture);
check('v3 포지션: total≠0 만 남긴다', pos.length === 1 && pos[0].symbol === 'BTCUSDT');
check(
  'v3 포지션: 필드 이름을 v2 모양으로 통일',
  pos[0].holdSide === 'long' &&
    pos[0].openPriceAvg === 61000 &&
    pos[0].markPrice === 61500.5 &&
    pos[0].unrealizedPL === 12.3 &&
    pos[0].marginSize === 470.5 &&
    pos[0].leverage === 10 &&
    pos[0].liquidationPrice === 55000 &&
    pos[0].ctime === 1736378720620,
  JSON.stringify(pos[0]),
);
check('v3 포지션: list 가 null 이면 빈 배열', Array.isArray(parsePositionsV3({ list: null })) && parsePositionsV3({ list: null }).length === 0);
check('v3 포지션: 응답이 비어도 빈 배열', parsePositionsV3(null).length === 0);

/* 10-9) v3 계정 설정(holdMode·종목별 마진 모드) */
const settingsFixture = {
  accountMode: 'unified',
  holdMode: 'hedge_mode',
  symbolConfigList: [
    { category: 'USDT-FUTURES', symbol: 'BTCUSDT', marginMode: 'isolated' },
    { category: 'USDT-FUTURES', symbol: 'ETHUSDT', marginMode: 'crossed' },
    { category: 'COIN-FUTURES', symbol: 'BTCUSD', marginMode: 'isolated' },
  ],
};
const settings = parseSettingsV3(settingsFixture);
check('v3 settings: holdMode 파싱', settings.holdMode === 'hedge_mode');
check('v3 settings: USDT-FUTURES 종목 마진 모드만', settings.marginModes.BTCUSDT === 'isolated' && settings.marginModes.ETHUSDT === 'crossed' && !('BTCUSD' in settings.marginModes));
check('v3 settings: holdMode 없으면 단방향', parseSettingsV3({}).holdMode === 'one_way_mode');

/* ------------------------------------------------------------------ *
 * 11) 호가 단위(tick) — 비트겟 45115 "The price you enter should be a multiple of 0.01"
 *     실기기 보고: MSTR·BNB·ETH(0.01) · BTC(0.1) 주문이 모두 45115 로 거절됐다.
 * ------------------------------------------------------------------ */

/** 문자열 가격이 호가 배수인지 (문자열 그대로 판정 — 부동소수 잔여 오차 허용) */
const isMultiple = (price: string, tick: number): boolean => {
  const v = Number(price);
  if (!price || !Number.isFinite(v)) return false;
  const n = v / tick;
  return Math.abs(n - Math.round(n)) < 1e-6;
};

check('tick: BTC(pricePlace 1 · step 1) = 0.1', Math.abs(tickSizeOf(1, 1) - 0.1) < 1e-12);
check('tick: ETH/BNB/MSTR(pricePlace 2 · step 1) = 0.01', Math.abs(tickSizeOf(2, 1) - 0.01) < 1e-12);
check('tick: 스텝 5 코인(pricePlace 4 · step 5) = 0.0005', Math.abs(tickSizeOf(4, 5) - 0.0005) < 1e-12);
check('tick: priceEndStep 없으면 1스텝', Math.abs(tickSizeOf(2) - 0.01) < 1e-12 && Math.abs(tickSizeOf(0, 1) - 1) < 1e-12);

// BTC 0.1 — 소수 꼬리를 호가 배수로 맞춘다
const btcTp = roundToTick(91234.567, 1, 1);
check('BTC 목표 91234.567 → 91234.6 (0.1 배수)', btcTp === '91234.6' && isMultiple(btcTp, 0.1), btcTp);
const btcSl = roundToTick(74567.4321, 1, 1);
check('BTC 손절 74567.4321 → 74567.4 (0.1 배수)', btcSl === '74567.4' && isMultiple(btcSl, 0.1), btcSl);
check('BTC 정수 가격은 그대로(불필요한 0 없음)', roundToTick(61000, 1, 1) === '61000');

// ETH · BNB · MSTR 0.01
for (const [name, price, want] of [
  ['ETH', 3456.789, '3456.79'],
  ['BNB', 612.344, '612.34'],
  ['MSTR', 245.678, '245.68'],
] as const) {
  const out = roundToTick(price, 2, 1);
  check(`${name} 목표 ${price} → ${want} (0.01 배수)`, out === want && isMultiple(out, 0.01), out);
}

// priceEndStep=5 — 0.0005 단위
const step5a = roundToTick(0.00074, 4, 5);
const step5b = roundToTick(0.00055, 4, 5);
const step5c = roundToTick(0.00124, 4, 5);
check('스텝5: 0.00074 → 0.0005 (0.0005 배수)', step5a === '0.0005' && isMultiple(step5a, 0.0005), step5a);
check('스텝5: 0.00055 → 0.0005', step5b === '0.0005' && isMultiple(step5b, 0.0005), step5b);
check('스텝5: 0.00124 → 0.001', step5c === '0.001' && isMultiple(step5c, 0.0005), step5c);
check(
  '스텝5 회귀: 예전 표기(priceText 4자리)는 0.0007 로 45115 대상이었다',
  priceText(0.00074, 4) === '0.0007' && !isMultiple('0.0007', 0.0005),
);
check('호가 정보가 없으면 종전 표기 그대로', roundToTick(115.12345678, null, null) === '115.12345678');

// 주문 파라미터 — TP/SL 이 반드시 호가 배수
const btcSignal = sig({ entry: 90000, stop: 74567.4321, target: 91234.567, decimals: 1, priceEndStep: 1 });
const btcPlan = planAutoOrder({ signal: btcSignal, seed: 1000, config: cfg, leverage: 10 });
const btcOrder = buildOrderParams({
  signal: btcSignal,
  plan: btcPlan,
  posMode: 'one_way_mode',
});
check(
  '주문(웹): BTC TP 91234.6 · SL 74567.4 — 둘 다 0.1 배수',
  btcOrder.presetStopSurplusPrice === '91234.6' &&
    btcOrder.presetStopLossPrice === '74567.4' &&
    isMultiple(btcOrder.presetStopSurplusPrice ?? '', 0.1) &&
    isMultiple(btcOrder.presetStopLossPrice ?? '', 0.1),
  `${btcOrder.presetStopSurplusPrice} / ${btcOrder.presetStopLossPrice}`,
);
const ethSignal = sig({ symbol: 'ETHUSDT', base: 'ETH', entry: 3400, stop: 3300.1234, target: 3456.789, decimals: 2, priceEndStep: 1 });
const ethOrder = buildOrderParams({
  signal: ethSignal,
  plan: planAutoOrder({ signal: ethSignal, seed: 1000, config: cfg, leverage: 10 }),
  posMode: 'one_way_mode',
});
check(
  '주문(웹): ETH TP 3456.79 · SL 3300.12 — 둘 다 0.01 배수',
  ethOrder.presetStopSurplusPrice === '3456.79' &&
    ethOrder.presetStopLossPrice === '3300.12' &&
    isMultiple(ethOrder.presetStopSurplusPrice ?? '', 0.01),
  `${ethOrder.presetStopSurplusPrice} / ${ethOrder.presetStopLossPrice}`,
);
const stepSignal = sig({ symbol: 'PEPEUSDT', base: 'PEPE', entry: 0.00062, stop: 0.00055, target: 0.0008, decimals: 4, priceEndStep: 5 });
const stepOrder = buildOrderParams({
  signal: stepSignal,
  plan: planAutoOrder({ signal: stepSignal, seed: 1000, config: cfg, leverage: 10, spec: { volumePlace: 0 } }),
  posMode: 'one_way_mode',
});
check(
  '주문(웹): 스텝5 TP 0.001 · SL 0.0005 — 둘 다 0.0005 배수',
  stepOrder.presetStopSurplusPrice === '0.001' &&
    stepOrder.presetStopLossPrice === '0.0005' &&
    isMultiple(stepOrder.presetStopSurplusPrice ?? '', 0.0005) &&
    isMultiple(stepOrder.presetStopLossPrice ?? '', 0.0005),
  `${stepOrder.presetStopSurplusPrice} / ${stepOrder.presetStopLossPrice}`,
);
check(
  '주문(웹): 계약 호가를 인자로 넘기면 signal 값보다 우선',
  buildOrderParams({ signal: btcSignal, plan, posMode: 'one_way_mode', pricePlace: 2, priceEndStep: 1 })
    .presetStopLossPrice === '74567.43',
);

// 감시 목록 — 네이티브가 그대로 쓰는 tpStr/slStr
const armedTick = toArmedPlan({ signal: btcSignal, plan: btcPlan, now, ttlMin: 60 });
check(
  '감시 항목: pricePlace·priceEndStep·tpStr·slStr 를 담는다',
  armedTick.pricePlace === 1 &&
    armedTick.priceEndStep === 1 &&
    armedTick.tpStr === '91234.6' &&
    armedTick.slStr === '74567.4' &&
    isMultiple(armedTick.tpStr, 0.1),
  `${armedTick.pricePlace}/${armedTick.priceEndStep} · ${armedTick.tpStr}/${armedTick.slStr}`,
);
check(
  '감시 항목: 호가 정보가 없으면 문자열이 비지 않고 종전 표기',
  toArmedPlan({ signal: sig(), plan, now, ttlMin: 60 }).tpStr === '115',
);
check(
  '감시 항목 JSON — 네이티브 AutoTradeService 가 읽는 키 순서(pricePlace·priceEndStep·tpStr·slStr)',
  ['pricePlace', 'priceEndStep', 'tpStr', 'slStr'].every((k) => k in JSON.parse(JSON.stringify(armedTick))),
);

/* ------------------------------------------------------------------ *
 * 10) v1.5.3 — 거래 모드 판정 · 진입 방어선 · 수량 단위 · 청산 방향
 *    (실기기 사고: 모의 키로 실거래 라벨 · TP/SL 을 지나친 자리 진입 · 45115/수량 배수)
 * ------------------------------------------------------------------ */

// 10-1) 실제 모드는 저장된 키의 계좌가 정한다 — 라벨과 다른 계좌로 주문이 나가면 안 된다.
const modeDemoKey = resolveTradeMode({ mode: 'live' }, { hasKeys: true, demo: true });
check('모드: 모의 키 + 실거래 설정 → 모의투자로 강등', modeDemoKey.mode === 'demo' && modeDemoKey.mismatch);
check('모드: 강등 사유를 화면에 남긴다', /모의투자 키/.test(modeDemoKey.note ?? ''), modeDemoKey.note ?? '');
const modeLiveKey = resolveTradeMode({ mode: 'demo' }, { hasKeys: true, demo: false });
check('모드: 실거래 키 + 모의 설정 → 실거래로 승격(확인 절차 필요)', modeLiveKey.mode === 'live' && modeLiveKey.mismatch);
check('모드: 승격 경고 문구', /실제 USDT/.test(modeLiveKey.note ?? ''), modeLiveKey.note ?? '');
check(
  '모드: 키 없음 → 설정값 그대로',
  resolveTradeMode({ mode: 'live' }, { hasKeys: false, demo: true }).mode === 'live' &&
    !resolveTradeMode({ mode: 'live' }, { hasKeys: false, demo: true }).mismatch,
);
check(
  '모드: 키와 설정이 같으면 경고 없음',
  !resolveTradeMode({ mode: 'demo' }, { hasKeys: true, demo: true }).mismatch,
);

// 10-2) 진입 직전 방어선 — 이미 목표가를 지났거나 손절가에 붙은 자리는 들어가지 않는다.
check(
  '롱: 목표가를 이미 지나친 자리 → target-passed',
  planTrigger({ side: 'long', entry: 100, stop: 95, target: 100.02, expiresAt: now + 60_000 }, 100.01, now) ===
    'target-passed',
);
check(
  '롱: 손절가 0.1% 이내 → near-stop',
  planTrigger({ side: 'long', entry: 100, stop: 95, target: 115, expiresAt: now + 60_000 }, 95.05, now) === 'near-stop',
);
check(
  '숏: 목표가를 이미 지나친 자리 → target-passed',
  planTrigger({ side: 'short', entry: 100, stop: 105, target: 99.99, expiresAt: now + 60_000 }, 99.98, now) ===
    'target-passed',
);
check(
  '숏: 손절가 0.1% 이내 → near-stop',
  planTrigger({ side: 'short', entry: 100, stop: 105, target: 90, expiresAt: now + 60_000 }, 104.95, now) === 'near-stop',
);
check(
  '방어선: 정상 자리(진입가 터치)는 그대로 enter',
  planTrigger({ side: 'long', entry: 100, stop: 95, target: 115, expiresAt: now + 60_000 }, 100.02, now) === 'enter' &&
    planTrigger({ side: 'short', entry: 100, stop: 105, target: 90, expiresAt: now + 60_000 }, 99.98, now) === 'enter',
);
check('방어선 상수는 서비스(Java)와 같은 0.1%', MIN_STOP_DISTANCE === 0.001 && MIN_TARGET_GAP === 0.001);

// 10-3) 수량 문자열 — 지수 표기·배수 오류(40762/45116) 없이 거래소 단위로 내림
check('수량: 정수 단위 내림 (40762.5 → 40762)', qtyToStep(40762.5, 0) === '40762', qtyToStep(40762.5, 0));
check('수량: 소수 둘째 자리 내림 (1.2345 → 1.23)', qtyToStep(1.2345, 2) === '1.23', qtyToStep(1.2345, 2));
check('수량: 배수 단위 (25 · mult 10 → 20)', qtyToStep(25, 0, 10) === '20', qtyToStep(25, 0, 10));
check('수량: 아주 작은 값도 지수 표기 없음', qtyToStep(0.000000123, 8) === '0.00000012', qtyToStep(0.000000123, 8));
check('수량: 0 이하는 빈 문자열', qtyToStep(0, 4) === '' && qtyToStep(-1, 4) === '');
// Bitget sizeMultiplier 는 10^-volumePlace 와 같거나(BTC 0.0001 · MSTR 0.01) 더 큰 단위(1·10)다 — 큰 쪽을 지킨다.
check('수량: BTC 실계약 단위(volumePlace 4 · mult 0.0001)', qtyToStep(0.0244137, 4, 0.0001) === '0.0244', qtyToStep(0.0244137, 4, 0.0001));
check('수량: MSTR 실계약 단위(volumePlace 2 · mult 0.01)', qtyToStep(12.3456, 2, 0.01) === '12.34', qtyToStep(12.3456, 2, 0.01));
check('수량: mult 가 더 큰 단위(volumePlace 2 · mult 1)는 정수로 내림', qtyToStep(1.23, 2, 1) === '1', qtyToStep(1.23, 2, 1));
const multPlan = planAutoOrder({
  signal: sig({ entry: 100, stop: 99, target: 105 }),
  seed: 1000,
  config: cfg,
  leverage: 10,
  spec: { volumePlace: 0, sizeMultiplier: 10, minTradeNum: 10 },
});
check('수량 계획: sizeMultiplier 배수로 내림 (15 → 10)', multPlan.qty === 10, `qty=${multPlan.qty}`);
const multOrder = buildOrderParams({
  signal: sig({ entry: 100, stop: 99, target: 105 }),
  plan: multPlan,
  posMode: 'one_way_mode',
  sizeMultiplier: 10,
});
check('주문 수량 문자열: 배수 반영', multOrder.size === '10', multOrder.size);

// 10-4) 청산 — posSide 는 **청산할 포지션의 방향**이다(주문 side 로 추론하면 반대 포지션이 열린다)
const hedgeLongClose = closeOrderFields({ holdSide: 'long', posMode: 'hedge_mode' });
check('청산(헤지 롱): sell + posSide=long', hedgeLongClose.side === 'sell' && hedgeLongClose.posSide === 'long');
const hedgeShortClose = closeOrderFields({ holdSide: 'short', posMode: 'hedge_mode' });
check('청산(헤지 숏): buy + posSide=short', hedgeShortClose.side === 'buy' && hedgeShortClose.posSide === 'short');
const owLongClose = closeOrderFields({ holdSide: 'long', posMode: 'one_way_mode' });
check('청산(단방향 롱): sell + reduceOnly', owLongClose.side === 'sell' && owLongClose.reduceOnly === 'yes' && !owLongClose.posSide);
const v3HedgeClose = v3CloseBody({ symbol: 'BTCUSDT', holdSide: 'long', size: '0.01', posMode: 'hedge_mode' });
check(
  'v3 청산(헤지): posSide=long · reduceOnly 없음',
  v3HedgeClose.posSide === 'long' && v3HedgeClose.reduceOnly === undefined && v3HedgeClose.side === 'sell',
  JSON.stringify(v3HedgeClose),
);
const v3OneWayClose = v3CloseBody({ symbol: 'BTCUSDT', holdSide: 'short', size: '0.01', posMode: 'one_way_mode' });
check(
  'v3 청산(단방향): side=buy · reduceOnly=yes · posSide 없음',
  v3OneWayClose.side === 'buy' && v3OneWayClose.reduceOnly === 'yes' && v3OneWayClose.posSide === undefined,
  JSON.stringify(v3OneWayClose),
);
const v2HedgeClose = v2CloseBody({ symbol: 'BTCUSDT', holdSide: 'long', size: '0.01', posMode: 'hedge_mode' });
check(
  'v2 청산(헤지): tradeSide=close · reduceOnly 없음(동시 지정은 25238)',
  v2HedgeClose.tradeSide === 'close' && v2HedgeClose.reduceOnly === undefined,
  JSON.stringify(v2HedgeClose),
);
const v2OneWayClose = v2CloseBody({ symbol: 'ETHUSDT', holdSide: 'short', size: '1', posMode: 'one_way_mode' });
check(
  'v2 청산(단방향): reduceOnly=true · tradeSide 없음',
  v2OneWayClose.reduceOnly === 'true' && v2OneWayClose.tradeSide === undefined,
  JSON.stringify(v2OneWayClose),
);
check(
  '청산 clientOid 없으면 보내지 않는다(고정값이면 25212)',
  v3CloseBody({ symbol: 'BTCUSDT', holdSide: 'long', size: '0.01', posMode: 'one_way_mode' }).clientOid === undefined,
);
check(
  '청산 clientOid 는 v3 규칙(32자)으로 자른다',
  (v3CloseBody({
    symbol: 'BTCUSDT',
    holdSide: 'long',
    size: '0.01',
    posMode: 'one_way_mode',
    clientOid: 'cotaBTCUSDT1234567890abcdefghijklmnop',
  }).clientOid ?? '').length <= 32,
);

// 10-5) 같은 종목 중복 진입 금지 — 포지션 수가 아니라 종목으로 막는다
const sameSymbol = evaluateEntry({
  config: normalizeConfig({ ...cfg, enabled: true }),
  signal: sig(),
  tradedKeys: [],
  openPositions: 1,
  openSymbols: ['BTCUSDT'],
  dailyLocked: false,
  plan,
  now,
  hasKeys: true,
});
check('게이트: 같은 종목 포지션 보유 → same-symbol', sameSymbol.code === 'same-symbol', sameSymbol.reason);
check(
  '게이트: 다른 종목이면 통과',
  evaluateEntry({
    config: normalizeConfig({ ...cfg, enabled: true }),
    signal: sig(),
    tradedKeys: [],
    openPositions: 1,
    openSymbols: ['ETHUSDT'],
    dailyLocked: false,
    plan,
    now,
    hasKeys: true,
  }).allowed,
);

// 10-6) 오늘 체결 수 — `0건 진입` 오해 방지(로그의 fill 만 센다)
const fillLogs = [
  { at: now, level: 'fill' as const, text: '체결' },
  { at: now - 1000, level: 'fill' as const, text: '체결2' },
  { at: now, level: 'error' as const, text: '오류' },
  { at: now - 30 * 3600_000, level: 'fill' as const, text: '어제' },
];
check('체결 수: 오늘 fill 2건만', todayFillCount(fillLogs, now) === 2, `${todayFillCount(fillLogs, now)}건`);
check('체결 수: 로그가 없으면 0', todayFillCount([], now) === 0);
check(
  '상태 배지: 켰지만 서비스 미가동 → 대기',
  statusBadge(normalizeConfig({ ...cfg, enabled: true }), false).label === '대기 중 (앱 열림)',
);

/* ------------------------------------------------------------------ *
 * 11) 1일 손실 한도 초기화 + 실시간 잔고 갱신 (v1.5.4)
 * ------------------------------------------------------------------ */
const resetNow = Date.UTC(2026, 10, 24, 3, 0); // KST 2026-11-24 12:00
const lockedRt = {
  ...emptyRuntime(resetNow, 1000),
  tradedKeys: ['BTCUSDT|4H|long|1700000000000'],
  logs: [{ at: resetNow, level: 'block' as const, text: '1일 손실 한도 도달(−4.5%) — 오늘 자동 진입을 멈춥니다.' }],
};
check(
  '초기화 전: 기준 1,000 · 지금 950 → 잠김',
  checkDailyLoss({ dayStartEquity: lockedRt.dayStartEquity, equity: 950, dailyLossPct: 4.5 }).locked,
);
const resetRt = applyDailyReset(lockedRt, resetNow, 942.5, 'native');
check('초기화: 기준선 = 지금 잔고', resetRt.dayStartEquity === 942.5, `${resetRt.dayStartEquity}`);
check(
  '초기화 직후: 오늘 손익 0% · 잠금 없음',
  !checkDailyLoss({ dayStartEquity: resetRt.dayStartEquity, equity: 942.5, dailyLossPct: 4.5 }).locked,
);
check(
  '초기화 직후: 새 기준 −4.4% 는 아직 통과',
  !checkDailyLoss({ dayStartEquity: 942.5, equity: 900.5, dailyLossPct: 4.5 }).locked,
);
check(
  '초기화 직후: 새 기준에서 한도에 닿으면 다시 잠금',
  checkDailyLoss({ dayStartEquity: 942.5, equity: 900, dailyLossPct: 4.5 }).locked,
);
check('초기화: 중복 진입 키는 유지(같은 시그널 재진입 방지)', resetRt.tradedKeys.length === 1);
check('초기화: 로그에 남는다', /손실 한도 초기화/.test(resetRt.logs[0]?.text ?? ''), resetRt.logs[0]?.text);
check('초기화: 기준선은 소수 4자리로', planDailyReset(1234.56789, resetNow).dayStartEquity === 1234.5679);
check(
  '초기화: 잔고를 모르면 거부(기준선을 0으로 덮지 않는다)',
  !planDailyReset(0, resetNow).ok && !planDailyReset(null, resetNow).ok,
);
check('초기화: 거부되면 상태를 바꾸지 않는다', applyDailyReset(lockedRt, resetNow, null) === lockedRt);
check('실시간 갱신 주기 10~15초', LIVE_REFRESH_MS >= 10_000 && LIVE_REFRESH_MS <= 15_000, `${LIVE_REFRESH_MS}ms`);
check('스냅숏 신선 기준 > 갱신 주기', SNAPSHOT_FRESH_MS > LIVE_REFRESH_MS, `${SNAPSHOT_FRESH_MS}ms`);
check('갱신 표시: 방금 전', fmtSince(resetNow - 2_500, resetNow) === '방금 전', fmtSince(resetNow - 2_500, resetNow));
check('갱신 표시: N초 전', fmtSince(resetNow - 12_000, resetNow) === '12초 전', fmtSince(resetNow - 12_000, resetNow));
check('갱신 표시: N분 전', fmtSince(resetNow - 90_000, resetNow) === '1분 전', fmtSince(resetNow - 90_000, resetNow));
check('갱신 표시: 기록 없음 → —', fmtSince(0, resetNow) === '—');

/* ------------------------------------------------------------------ *
 * 12) 조기 손절(선제 청산) — v1.5.4
 * ------------------------------------------------------------------ */
const esNow = Date.UTC(2026, 10, 24, 3, 0);
const esOpen = esNow - 10 * 60_000;
// 평평한 15분봉 11개(몸통 0.05) + 마지막 봉
const flat = (i: number): EarlyExitCandle => ({ ts: esNow - (12 - i) * 900_000, open: 100, high: 100.1, low: 99.9, close: 100.05 });
const candlesLong = [
  ...Array.from({ length: 11 }, (_, i) => flat(i)),
  { ts: esNow - 900_000, open: 100, high: 100.2, low: 98.4, close: 98.5 },
];
const candlesShort = [
  ...Array.from({ length: 11 }, (_, i) => flat(i)),
  { ts: esNow - 900_000, open: 100, high: 101.6, low: 99.9, close: 101.5 },
];
const esBase = {
  enabled: true,
  side: 'long' as const,
  entry: 99.5,
  stop: 97,
  price: 98.9,
  openedAt: esOpen,
  now: esNow,
  peakR: 0,
  oppositeSignalAt: 0,
  candles: candlesLong,
};
check('조기 손절: 기본 설정 ON', DEFAULTS.earlyStop === true && normalizeConfig({}).earlyStop === true);
check('조기 손절: 명시적 OFF 는 유지', normalizeConfig({ earlyStop: false }).earlyStop === false);
check('조기 손절: 손익 R 부호(롱)', Math.abs(rMultiple('long', 100, 98, 99) + 0.5) < 1e-9);
check('조기 손절: 손익 R 부호(숏)', Math.abs(rMultiple('short', 100, 102, 101) + 0.5) < 1e-9);
check('조기 손절: 토글 OFF 면 청산하지 않는다', !evaluateEarlyExit({ ...esBase, enabled: false }).exit);
check(
  '조기 손절: 진입 2분 보호 — 반대 시그널이 와도 대기',
  !evaluateEarlyExit({ ...esBase, openedAt: esNow - 60_000, oppositeSignalAt: esNow - 30_000 }).exit,
  evaluateEarlyExit({ ...esBase, openedAt: esNow - 60_000, oppositeSignalAt: esNow - 30_000 }).reason,
);
const opp = evaluateEarlyExit({ ...esBase, oppositeSignalAt: esNow - 3 * 60_000 });
check('조기 손절: 진입 뒤 반대 시그널 → 청산', opp.exit && opp.code === 'opposite-signal', opp.reason);
check(
  '조기 손절: 진입 전(옛) 반대 시그널은 사유로 쓰지 않는다',
  evaluateEarlyExit({ ...esBase, oppositeSignalAt: esOpen - 60_000 }).code !== 'opposite-signal',
);
check(
  '조기 손절: 이미 +0.3R 이상 이익이면 반대 시그널로 자르지 않는다',
  !evaluateEarlyExit({ ...esBase, price: 100.6, oppositeSignalAt: esNow - 3 * 60_000 }).exit,
);
const struct = evaluateEarlyExit(esBase);
check('조기 손절: 장대 음봉이 진입가·EMA9 이탈 → 구조 붕괴 청산', struct.exit && struct.code === 'structure-break', struct.reason);
check('조기 손절: 사유에 추세 구조 이탈 문구', /추세 구조 이탈/.test(struct.reason), struct.reason);
const noise = evaluateEarlyExit({
  ...esBase,
  candles: [...candlesLong.slice(0, 11), { ts: esNow - 900_000, open: 100, high: 100.1, low: 99.85, close: 99.9 }],
});
check('조기 손절: 작은 음봉(평균 몸통 수준)은 휩쏘로 보고 청산하지 않는다', !noise.exit, noise.reason);
check(
  '조기 손절: 손절가에 닿았으면 SL 처리에 맡긴다',
  !evaluateEarlyExit({ ...esBase, price: 96.9 }).exit,
);
check(
  '조기 손절: −0.95R 이내도 SL 처리에 맡긴다',
  !evaluateEarlyExit({ ...esBase, price: 97.1 }).exit,
);
const shortBreak = evaluateEarlyExit({
  ...esBase,
  side: 'short',
  entry: 100.5,
  stop: 103,
  price: 101.2,
  candles: candlesShort,
});
check('조기 손절: 숏은 강한 양봉이 위로 이탈하면 청산', shortBreak.exit && shortBreak.code === 'structure-break', shortBreak.reason);
const be = evaluateEarlyExit({ ...esBase, entry: 100, stop: 98, price: 100.04, peakR: 1.2 });
check('조기 손절: +0.8R 뒤 본절 복귀 → 본절 보호 청산', be.exit && be.code === 'breakeven', be.reason);
check(
  '조기 손절: 최대 R 이 작으면 본절 보호 없음',
  !evaluateEarlyExit({ ...esBase, entry: 100, stop: 98, price: 100.04, peakR: 0.4 }).exit,
);
check('조기 손절: EMA 계산', Math.abs(emaLast([1, 2, 3], 3) - 2.25) < 1e-9, String(emaLast([1, 2, 3], 3)));
check('조기 손절: 보호 구간 2분 · 쿨다운 5분', EARLY_STOP_MIN_AGE_MS === 120_000 && EARLY_STOP_COOLDOWN_MS === 300_000);
check('조기 손절: 반대 시그널 인정 6시간', EARLY_STOP_SIGNAL_MAX_AGE_MS === 6 * 3_600_000);
const esLog = earlyExitLogText({ demo: true, base: 'BTC', side: 'long', qty: '0.025', reason: '반대 방향 시그널 감지', currentR: -0.42, entry: 61000 });
check('조기 손절: 로그에 🛡 조기 손절·사유·R', /🛡 조기 손절/.test(esLog) && /반대 방향 시그널 감지/.test(esLog) && /-0\.42R/.test(esLog), esLog);

console.log('');
console.log(`자동매매 단위 검증: ${pass}/${pass + fails.length} 통과`);
if (fails.length) {
  console.log(`실패: ${fails.join(' · ')}`);
  process.exit(1);
}
