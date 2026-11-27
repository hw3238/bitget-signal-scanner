/**
 * 🎯 맞춤 알림 · 📊 경제지표 센터 단위 검증 (v1.5.8)
 *   실행: npm run check:alerts
 *
 * 1) 알림 설정 정규화 — 기본값·범위(60~120초 · 30~240분)·마스터 연동
 * 2) 조건 입력 검증 — 가격/RSI/펀딩/코인 종목
 * 3) 조건 판정 — 5종 hit/miss/자료 없음
 * 4) 목록 동작 — 중복 방지·재활성화·발동 완료
 * 5) 문구 — 제목·본문에 종목·값
 * 6) 경제지표 데이터 무결성 — 실제 일정·KST 변환·컨센서스·롱숏 가이드
 * 7) 30분 전 알림 창 — 경계값
 * 8) 실 API 스모크 — 비트겟 티커·1H 캔들 RSI·펀딩비
 */
import {
  DEFAULT_ALERT_SETTINGS,
  activeChannels,
  addAlert,
  alertConditionText,
  alertId,
  anyAlertOn,
  buildAlertMessage,
  evaluateAlert,
  markTriggered,
  normalizeAlertSettings,
  parseAlertInput,
  reactivateAlert,
  activeAlerts,
  triggeredAlerts,
  type CoinAlert,
} from '../src/engine/alerts';
import {
  MACRO_EVENTS,
  MACRO_CONTEXT,
  buildMacroMessage,
  countdownText,
  countsFor,
  dueMacroAlerts,
  groupByDay,
  kstLabel,
  nextEvent,
  parseEventTime,
  upcomingEvents,
  verdictLabel,
} from '../src/engine/macroCalendar';
import { rsi } from '../src/engine/indicators';

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
 * 1) 설정 정규화
 * ------------------------------------------------------------------ */
const d = normalizeAlertSettings(null);
check(
  '기본 설정 — 마스터·시그널·지정가·지표 ON · 뉴스 OFF',
  d.master && d.signal && d.custom && d.macro && !d.news,
  JSON.stringify({ m: d.master, s: d.signal, c: d.custom, g: d.macro, n: d.news }),
);
check('기본 주기 90초 · 지표 30분 전', d.refreshSec === 90 && d.macroLeadMin === 30, `${d.refreshSec}s/${d.macroLeadMin}min`);
check('기본 대상 주요 코인', d.target === 'majors', d.target);
check(
  '주기 범위 60~120초로 당김',
  normalizeAlertSettings({ refreshSec: 10 }).refreshSec === 60 &&
    normalizeAlertSettings({ refreshSec: 999 }).refreshSec === 120 &&
    normalizeAlertSettings({ refreshSec: 75 }).refreshSec === 75,
  'clamp',
);
check(
  '지표 알림 30~240분으로 정리',
  normalizeAlertSettings({ macroLeadMin: 1 }).macroLeadMin === 30 &&
    normalizeAlertSettings({ macroLeadMin: 60 }).macroLeadMin === 60 &&
    normalizeAlertSettings({ macroLeadMin: 999 }).macroLeadMin === 240,
  'lead',
);
check(
  '알 수 없는 대상은 기본값',
  normalizeAlertSettings({ target: 'nope' as never }).target === DEFAULT_ALERT_SETTINGS.target,
  '',
);
check(
  '마스터 OFF → 서비스 시작 안 함',
  !anyAlertOn(normalizeAlertSettings({ ...DEFAULT_ALERT_SETTINGS, master: false })),
  '',
);
check(
  '마스터 ON + 전부 OFF → 시작 안 함',
  !anyAlertOn(
    normalizeAlertSettings({ master: true, signal: false, custom: false, macro: false, news: false }),
  ),
  '',
);
const ch = activeChannels(normalizeAlertSettings({ master: false, signal: true, news: true }));
check('마스터 OFF 면 채널 4종 모두 꺼짐', !ch.signal && !ch.custom && !ch.macro && !ch.news, JSON.stringify(ch));

/* ------------------------------------------------------------------ *
 * 2) 입력 검증
 * ------------------------------------------------------------------ */
const okPrice = parseAlertInput('btecusdt', 'price_above', '95,000', { price: 61500, now: 1000 });
check('가격 알림 — 쉼표 제거·대문자·id 생성', okPrice.ok && okPrice.alert?.symbol === 'BTECUSDT', JSON.stringify(okPrice.alert));
const above = parseAlertInput('BTCUSDT', 'price_above', '95000', { price: 61500, now: 1000 });
check('가격 이상 — 현재가보다 높으면 통과', above.ok && above.alert?.value === 95000, above.error ?? '');
const belowWrong = parseAlertInput('BTCUSDT', 'price_above', '50000', { price: 61500 });
check('가격 이상 — 이미 아래면 거절', !belowWrong.ok, belowWrong.error ?? '');
const below = parseAlertInput('BTCUSDT', 'price_below', '55000', { price: 61500 });
check('가격 이하 — 아래 값 통과', below.ok && below.alert?.kind === 'price_below', below.error ?? '');
check(
  '가격 10배 초과 거절',
  !parseAlertInput('BTCUSDT', 'price_above', '999999', { price: 61500 }).ok,
  '',
);
check('가격 0 거절', !parseAlertInput('BTCUSDT', 'price_below', '0', { price: 61500 }).ok, '');
check('숫자 아님 거절', !parseAlertInput('BTCUSDT', 'price_below', 'abc').ok, '');
check('RSI 99 초과 거절', !parseAlertInput('BTCUSDT', 'rsi_over', '120').ok, '');
check('RSI 70 통과', parseAlertInput('ETHUSDT', 'rsi_over', '70').ok, '');
check('펀딩 0 거절', !parseAlertInput('BTCUSDT', 'funding_hot', '0').ok, '');
check('펀딩 0.1% 통과', parseAlertInput('BTCUSDT', 'funding_hot', '0.1').alert?.value === 0.1, '');
check('FX 종목 거절', !parseAlertInput('XAUTUSDT', 'price_above', '4000').ok, '');
check('같은 조건 id 동일', alertId('BTCUSDT', 'price_above', 95000) === alertId('BTCUSDT', 'price_above', 95000), '');

/* ------------------------------------------------------------------ *
 * 3) 조건 판정
 * ------------------------------------------------------------------ */
const evalTable: Array<[string, boolean, boolean]> = [
  ['price_above', evaluateAlert({ kind: 'price_above', value: 95000 }, { price: 95100 }).hit, true],
  ['price_above 미달', evaluateAlert({ kind: 'price_above', value: 95000 }, { price: 94999 }).hit, false],
  ['price_below 도달', evaluateAlert({ kind: 'price_below', value: 55000 }, { price: 55000 }).hit, true],
  ['rsi_over 70', evaluateAlert({ kind: 'rsi_over', value: 70 }, { rsi: 71.2 }).hit, true],
  ['rsi_over 미달', evaluateAlert({ kind: 'rsi_over', value: 70 }, { rsi: 69.9 }).hit, false],
  ['rsi_under 30', evaluateAlert({ kind: 'rsi_under', value: 30 }, { rsi: 28 }).hit, true],
  ['funding 0.1%', evaluateAlert({ kind: 'funding_hot', value: 0.1 }, { fundingPct: 0.12 }).hit, true],
  ['funding 미달', evaluateAlert({ kind: 'funding_hot', value: 0.1 }, { fundingPct: 0.05 }).hit, false],
];
for (const [name, got, want] of evalTable) check(`판정 · ${name}`, got === want, `${got}`);
check('자료 없음(missing) — 가격 미도착', evaluateAlert({ kind: 'price_above', value: 1 }, {}).missing, '');
check('자료 없음(missing) — RSI 미도착', evaluateAlert({ kind: 'rsi_over', value: 70 }, { price: 100 }).missing, '');

/* ------------------------------------------------------------------ *
 * 4) 목록 동작
 * ------------------------------------------------------------------ */
let list: CoinAlert[] = [];
const a1 = parseAlertInput('BTCUSDT', 'price_above', '95000', { price: 61500, now: 1000 }).alert!;
let added = addAlert(list, a1);
list = added.list;
check('알림 추가', added.added && list.length === 1, '');
added = addAlert(list, a1);
list = added.list;
check('같은 조건은 중복 추가 안 함', !added.added && list.length === 1, '');
const a2 = parseAlertInput('ETHUSDT', 'rsi_under', '30', { now: 2000 }).alert!;
list = addAlert(list, a2).list;
check('다른 종목은 따로 추가', list.length === 2, '');
list = markTriggered(list, a1.id, 95123, 5000);
check('발동 완료로 이동', activeAlerts(list).length === 1 && triggeredAlerts(list).length === 1, '');
check('발동 값 보존', triggeredAlerts(list)[0].triggerActual === 95123, '');
list = reactivateAlert(list, a1.id, 6000);
check('재활성화 → 감시 중', activeAlerts(list).length === 2 && triggeredAlerts(list).length === 0, '');
check('재활성화 시 등록 시각 갱신', list.find((a) => a.id === a1.id)?.createdAt === 6000, '');
check(
  '조건 문구 — 가격/RSI/펀딩',
  alertConditionText({ symbol: 'BTCUSDT', kind: 'price_above', value: 95000 }) === 'BTC 가격 ≥ $95,000' &&
    alertConditionText({ symbol: 'ETHUSDT', kind: 'rsi_under', value: 30 }).includes('1H RSI ≤ 30') &&
    alertConditionText({ symbol: 'SOLUSDT', kind: 'funding_hot', value: 0.1 }).includes('펀딩비 ≥ 0.1%'),
  alertConditionText({ symbol: 'BTCUSDT', kind: 'price_above', value: 95000 }),
);
const msg = buildAlertMessage({ ...a1, symbol: 'BTCUSDT', kind: 'price_above', value: 95000 }, 95123);
check('알림 문구 — 종목·가격 포함', msg.title.includes('BTC') && msg.title.includes('$95,000') && msg.body.includes('$95,123'), msg.title);

/* ------------------------------------------------------------------ *
 * 5) 경제지표 무결성
 * ------------------------------------------------------------------ */
check('지표 18건 이상', MACRO_EVENTS.length >= 18, `${MACRO_EVENTS.length}건`);
const badTime = MACRO_EVENTS.filter((e) => !parseEventTime(e.at));
check('모든 일정 시각 파싱', badTime.length === 0, badTime.map((e) => e.id).join(','));
const ids = new Set(MACRO_EVENTS.map((e) => e.id));
check('일정 id 중복 없음', ids.size === MACRO_EVENTS.length, `${ids.size}/${MACRO_EVENTS.length}`);
const sorted = [...MACRO_EVENTS].sort((a, b) => parseEventTime(a.at) - parseEventTime(b.at));
check('일정 시간순 정렬', sorted.every((e, i) => e.id === MACRO_EVENTS[i].id), '');
check(
  '모든 일정에 예상치·이전치·근거 2개 이상',
  MACRO_EVENTS.every((e) => e.consensus && e.previous && e.consensusBasis.length >= 2),
  '',
);
check(
  '모든 일정에 상회/부합/하회 시나리오',
  MACRO_EVENTS.every((e) => e.above.text && e.inline.text && e.below.text),
  '',
);
check(
  '물가·고용 지표 — 상회=숏 / 하회=롱 방향',
  MACRO_EVENTS.filter((e) => e.category === 'inflation' || e.category === 'jobs').every(
    (e) => e.above.verdict === 'short' && e.below.verdict === 'long',
  ),
  '',
);
check('중요도 1~3', MACRO_EVENTS.every((e) => e.stars >= 1 && e.stars <= 3), '');
check(
  '★★★ 지표 6건 이상',
  MACRO_EVENTS.filter((e) => e.stars === 3).length >= 6,
  `${MACRO_EVENTS.filter((e) => e.stars === 3).length}건`,
);

/* KST 변환 — BLS 08:30 ET 는 겨울 22:30 KST, FOMC 14:00 ET 는 다음날 04:00 KST */
const nfp = MACRO_EVENTS.find((e) => e.id === 'nfp-2026-11')!;
check('11월 NFP = 2026-12-04(금) 22:30 KST', kstLabel(nfp) === '12/04(금) 22:30', kstLabel(nfp));
check('NFP 예상 +90K · 이전 +165K', nfp.consensus.includes('90K') && nfp.previous.includes('165K'), `${nfp.consensus}/${nfp.previous}`);
const fomc = MACRO_EVENTS.find((e) => e.id === 'fomc-2026-12')!;
check('12월 FOMC 결정 = 2026-12-10(목) 04:00 KST', kstLabel(fomc) === '12/10(목) 04:00', kstLabel(fomc));
check('FOMC 예상 = 25bp 인상 4.00~4.25%', fomc.consensus.includes('4.00~4.25'), fomc.consensus);
const cpi = MACRO_EVENTS.find((e) => e.id === 'cpi-2026-11')!;
check('11월 CPI = 2026-12-10(목) 22:30 KST', kstLabel(cpi) === '12/10(목) 22:30', kstLabel(cpi));
check('CPI 근거에 근원·휘발유 반영', cpi.consensusBasis.join(' ').includes('근원') && cpi.consensusBasis.join(' ').includes('휘발유'), '');
const fomcMar = MACRO_EVENTS.find((e) => e.id === 'fomc-2027-03')!;
check('3월 FOMC = 2027-03-18(목) 03:00 KST (EDT +13)', kstLabel(fomcMar) === '3/18(목) 03:00', kstLabel(fomcMar));
check('컨센서스 기준일 표기', MACRO_CONTEXT.asOf === '2026-11-27', MACRO_CONTEXT.asOf);

const now = Date.parse('2026-11-27T20:00:00+09:00');
const up = upcomingEvents(now, 40);
check('11-27 이후 40일 일정 5건 이상', up.length >= 5, `${up.length}건 · 첫 ${up[0] ? kstLabel(up[0]) : '—'}`);
check('가장 가까운 일정 = 12/02 ISM 제조업', nextEvent(now)?.id === 'ism-mfg-2026-11', nextEvent(now)?.id ?? '');
check('건수 — 전체/★★★', countsFor(up, 'all') === up.length && countsFor(up, 'star3') <= up.length, '');
check('필터 — 물가', countsFor(up, 'inflation') >= 1, '');

/* 카운트다운 */
const countdownCases: Array<[string, string, string]> = [
  ['2026-12-04T20:00:00+09:00', '2026-12-04T18:30:00+09:00', '1시간 30분'],
  ['2026-12-04T22:30:00+09:00', '2026-12-03T22:30:00+09:00', '1일 0시간'],
  ['2026-12-04T22:30:00+09:00', '2026-12-04T22:00:00+09:00', '30분'],
  ['2026-12-04T22:30:00+09:00', '2026-12-04T22:40:00+09:00', '발표 중'],
  ['2026-12-04T22:30:00+09:00', '2026-12-04T23:30:00+09:00', '발표 완료'],
];
for (const [at, atNow, want] of countdownCases) {
  const text = countdownText({ ...nfp, at }, Date.parse(atNow));
  check(`카운트다운 · ${want}`, text === want, text);
}

/* 30분 전 알림 창 */
const before30 = Date.parse('2026-12-04T22:05:00+09:00');
const before31 = Date.parse('2026-12-04T21:55:00+09:00');
check('30분 전 창 — 25분 전은 알림', dueMacroAlerts(before30, 30, new Set()).some((e) => e.id === nfp.id), '');
check('30분 전 창 — 35분 전은 아직', !dueMacroAlerts(before31, 30, new Set()).some((e) => e.id === nfp.id), '');
check('이미 알린 지표는 다시 안 알림', dueMacroAlerts(before30, 30, new Set([nfp.id])).every((e) => e.id !== nfp.id), '');
check('발표 10분 뒤엔 알림 없음', dueMacroAlerts(Date.parse('2026-12-04T22:40:00+09:00'), 30, new Set()).every((e) => e.id !== nfp.id), '');
const macroMsg = buildMacroMessage(nfp);
check(
  '지표 알림 문구 — 예상·상회/하회·롱숏',
  macroMsg.title.includes('NFP') && macroMsg.body.includes('예상') && macroMsg.body.includes('롱 유리') && macroMsg.body.includes('숏 유리'),
  macroMsg.body,
);
check('배지 — 롱/숏/중립', verdictLabel('long').text.includes('롱') && verdictLabel('short').text.includes('숏') && verdictLabel('neutral').text.includes('중립'), '');

/* 날짜 묶음 */
const grouped = groupByDay(up);
check('날짜 묶음 합 = 전체', grouped.reduce((n, g) => n + g.events.length, 0) === up.length, `${grouped.length}일`);
check('12/04 묶음에 NFP', grouped.some((g) => g.day === '2026-12-04' && g.events.some((e) => e.id === nfp.id)), '');

/* ------------------------------------------------------------------ *
 * 6) 실 API 스모크 — 비트겟 공개
 * ------------------------------------------------------------------ */
async function liveSmoke() {
  const base = 'https://api.bitget.com';
  try {
    const t = await fetch(`${base}/api/v2/mix/market/tickers?productType=USDT-FUTURES`).then((r) => r.json());
    const btc = (t.data as Array<Record<string, string>>).find((r) => r.symbol === 'BTCUSDT');
    const price = Number(btc?.lastPr);
    check('실 API — 비트겟 BTC 티커', price > 1000, `$${price.toLocaleString('en-US')}`);
    const c = await fetch(
      `${base}/api/v2/mix/market/candles?symbol=BTCUSDT&productType=USDT-FUTURES&granularity=1H&limit=60`,
    ).then((r) => r.json());
    const closes = (c.data as string[][]).map((row) => Number(row[4])).filter((v) => Number.isFinite(v));
    const series = rsi(closes, 14);
    const value = series[series.length - 2];
    check('실 API — 1H 60봉 RSI 계산', Number.isFinite(value) && value > 0 && value < 100, `RSI ${value.toFixed(1)}`);
    const f = await fetch(`${base}/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES`).then((r) => r.json());
    const row = (f.data as Array<Record<string, string>>).find((r) => r.symbol === 'BTCUSDT');
    const rate = Number(row?.fundingRate) * 100;
    check('실 API — 펀딩비', Number.isFinite(rate) && Math.abs(rate) < 1, `${rate.toFixed(4)}%`);
    // 실제 값으로 조건 판정
    const hit = evaluateAlert({ kind: 'price_below', value: price + 1 }, { price });
    check('실 API — 조건 판정 연동', hit.hit && hit.actual === price, '');
  } catch (e) {
    check('실 API 스모크 (네트워크)', false, e instanceof Error ? e.message : String(e));
  }
}

console.log('');
void liveSmoke().then(() => {
  console.log('');
  if (fails.length) {
    console.log(`❌ ${fails.length}건 실패: ${fails.join(' · ')}`);
    process.exit(1);
  }
  console.log(`✅ 알림 · 경제지표 검증 전부 통과 (${pass}건)`);
});
