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
  MAJOR_SYMBOLS,
  RISK_HIGH_WARN,
  RISK_PRESET_CHOICES,
  buildOrderParams,
  checkDailyLoss,
  clientOidFor,
  dayKeyKst,
  emptyRuntime,
  evaluateEntry,
  fmtUsdt,
  markTraded,
  mergeArmedPlans,
  normalizeConfig,
  normalizePosMode,
  orderSideFor,
  planAutoOrder,
  planSeed,
  planTrigger,
  priceText,
  pushLog,
  rollDay,
  signalKeyOf,
  statusBadge,
  symbolAllowed,
  toArmedPlan,
  type AutoTradeConfig,
} from '../src/lib/autotrade';
import { bitgetPrehash, bitgetSign, demoHeader, hmacSha256Base64, maskKey } from '../src/lib/bitgetSign';
import {
  CLASSIC_MODE_ERROR,
  UTA_MODE_ERROR,
  accountKindLabel,
  clientOidV3,
  modeSwitchTarget,
  parseAssetsV3,
  parsePositionsV3,
  parseSettingsV3,
  resolveAccountKind,
  v2OrderBody,
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

console.log('');
console.log(`자동매매 단위 검증: ${pass}/${pass + fails.length} 통과`);
if (fails.length) {
  console.log(`실패: ${fails.join(' · ')}`);
  process.exit(1);
}
