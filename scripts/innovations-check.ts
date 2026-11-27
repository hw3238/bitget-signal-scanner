/**
 * 🧠🧲🌊 매매 DNA · 청산 자석 · 섹터 순환 엔진 단위 검증 (실행: npm run check:innovations)
 *
 *  1) 매매 DNA — KST 시간대 경계 · 승률/누적 R · 레버리지 구간 · 복수매매(15분) · 보유 시간 ·
 *     진단 문장 · 연패 쿨다운 · 데모 데이터 불변식
 *  2) 매매일지 → DNA 입력 변환(청산 시각 근사·내 진입 구분) · 비트겟 과거 포지션 파서
 *  3) 청산 자석 — 청산가 공식 · 스윙/클러스터 · 상·하방 자석 위치 · 펀딩 보정 · 데이터 부족
 *  4) 섹터 — 매핑 중복 0 · 점수/순위 · 대장주·후발주 · 거래대금 필터 · 자금 유입 판정
 *  5) 자동매매 연패 쿨다운 게이트(evaluateEntry) — 연패면 거부, 수동 주문은 통과
 *  6) 마지막으로 **실제 비트겟 API**로 1종목 청산 자석 + 실시간 섹터 보드를 계산(네트워크 실패는 경고)
 */
import type { Candle, Contract, Signal, Ticker } from '../src/engine/types';
import {
  analyzeMagnet,
  clusterPivots,
  liquidationPrice,
  MAGNET_LEVERAGES,
  rankMagnets,
  swings,
} from '../src/engine/liquidationMagnet';
import {
  buildSectorBoard,
  rotationHints,
  SECTORS,
  SECTOR_BY_COIN,
} from '../src/engine/sectorRadar';
import {
  bucketOfHour,
  cooldownRemainMin,
  dnaProfile,
  findings,
  fmtHold,
  holdBucketOf,
  kstHourOf,
  LEV_BUCKETS,
  levBucketOf,
  leverageBoard,
  lossStreakCooldown,
  revengeReport,
  sideBoard,
  summarize,
  timeHeatmap,
  TIME_BUCKETS,
  type DnaTrade,
} from '../src/engine/tradeDna';
import { demoDnaTrades, parsePositionHistoryRows, pickJournalTrades, tradesFromJournal } from '../src/lib/tradeDnaSource';
import { evaluateEntry, normalizeConfig } from '../src/lib/autotrade';
import type { HistoryRecord, MyTrade } from '../src/lib/storage';
import { fetchCandles, fetchContracts, fetchTickers } from '../src/api/bitget';

let pass = 0;
const fails: string[] = [];
const warns: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fails.push(name);
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const near = (a: number, b: number, tol = 1e-6) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const HOUR = 3_600_000;

/* ------------------------------------------------------------------ *
 * 공통 픽스처
 * ------------------------------------------------------------------ */

const KST_TS = (day: number, hour: number, minute = 0) =>
  Date.UTC(2026, 10, 1, hour - 9, minute) + day * 86_400_000;

function trade(patch: Partial<DnaTrade> & { result: DnaTrade['result']; r: number }): DnaTrade {
  const openedAt = patch.openedAt ?? KST_TS(0, 9);
  return {
    id: patch.id ?? `t-${openedAt}-${patch.result}-${patch.r}`,
    symbol: patch.symbol ?? 'BTCUSDT',
    base: patch.base ?? 'BTC',
    side: patch.side ?? 'long',
    openedAt,
    closedAt: patch.result === 'open' ? null : (patch.closedAt ?? openedAt + 4 * HOUR),
    result: patch.result,
    r: patch.r,
    leverage: patch.leverage ?? 10,
    holdMs: patch.holdMs ?? (patch.result === 'open' ? null : 4 * HOUR),
    own: patch.own ?? true,
  };
}

/* ------------------------------------------------------------------ *
 * 1) 매매 DNA
 * ------------------------------------------------------------------ */

check('DNA: KST 시각 계산(UTC 00:00 → KST 09시)', kstHourOf(Date.UTC(2026, 0, 2, 0, 0)) === 9, String(kstHourOf(Date.UTC(2026, 0, 2, 0, 0))));
check('DNA: KST 자정 직전(UTC 14:59 → KST 23시)', kstHourOf(Date.UTC(2026, 0, 1, 14, 59)) === 23);

const hourBuckets = Array.from({ length: 24 }, (_, h) => bucketOfHour(h));
check(
  'DNA: 시간대 경계(심야 22–02 · 새벽 02–06 · 오전 06–12 · 오후 12–18 · 밤 18–22)',
  hourBuckets[22] === 'night' &&
    hourBuckets[1] === 'night' &&
    hourBuckets[2] === 'dawn' &&
    hourBuckets[5] === 'dawn' &&
    hourBuckets[6] === 'morning' &&
    hourBuckets[11] === 'morning' &&
    hourBuckets[12] === 'afternoon' &&
    hourBuckets[18] === 'evening' &&
    hourBuckets[21] === 'evening',
  hourBuckets.join(','),
);
check('DNA: 시간대 5개 · 라벨 = 새벽/오전/오후/밤/심야', TIME_BUCKETS.length === 5 && TIME_BUCKETS.map((b) => b.label).join('/') === '오전/오후/밤/심야/새벽');

const stat = summarize([
  trade({ result: 'win', r: 1 }),
  trade({ result: 'win', r: 2 }),
  trade({ result: 'win', r: 1 }),
  trade({ result: 'loss', r: -1 }),
  trade({ result: 'loss', r: -1 }),
  trade({ result: 'open', r: 0.4 }),
]);
check(
  'DNA: 승률 60% · 누적 +2R · 평균 +0.4R (진행중 제외)',
  near(stat.winRate, 60) && near(stat.cumR, 2) && near(stat.avgR, 0.4) && stat.open === 1 && stat.n === 6,
  `${stat.winRate}% · ${stat.cumR}R · ${stat.avgR}R`,
);
check('DNA: 종료 0건이면 승률 0(0으로 나누지 않는다)', summarize([trade({ result: 'open', r: 0 })]).winRate === 0);

const heat = timeHeatmap([
  trade({ result: 'win', r: 2, openedAt: KST_TS(0, 9) }),
  trade({ result: 'loss', r: -1, openedAt: KST_TS(0, 23) }),
  trade({ result: 'loss', r: -1, openedAt: KST_TS(1, 0, 30) }),
]);
const morning = heat.find((b) => b.key === 'morning')!;
const night = heat.find((b) => b.key === 'night')!;
check('DNA: 히트맵은 5구간을 항상 돌려준다', heat.length === 5);
check('DNA: 09시 → 오전 1건 100% / 23시·00시30분 → 심야 2건 0%', morning.n === 1 && near(morning.winRate, 100) && night.n === 2 && near(night.winRate, 0), `${morning.n}/${night.n}`);
check('DNA: 손실 비중 = 심야 100% · 오전 0%', near(night.lossSharePct, 100) && near(morning.lossSharePct, 0), `${night.lossSharePct}%`);

check(
  'DNA: 레버리지 구간(≤5 저배 · 6~15 중배 · 16+ 고배 · 없음 미기록)',
  levBucketOf(5) === 'low' &&
    levBucketOf(6) === 'mid' &&
    levBucketOf(15) === 'mid' &&
    levBucketOf(16) === 'high' &&
    levBucketOf(50) === 'high' &&
    levBucketOf(null) === 'unknown' &&
    LEV_BUCKETS.length === 4,
);
const levBoard = leverageBoard([
  trade({ result: 'loss', r: -1, leverage: 25 }),
  trade({ result: 'loss', r: -1, leverage: 20 }),
  trade({ result: 'win', r: 2, leverage: 3 }),
  trade({ result: 'win', r: 1.5, leverage: 8 }),
]);
check(
  'DNA: 고배 −2R · 저배 +2R · 중배 +1.5R',
  levBoard.find((b) => b.key === 'high')!.cumR === -2 &&
    levBoard.find((b) => b.key === 'low')!.cumR === 2 &&
    levBoard.find((b) => b.key === 'mid')!.cumR === 1.5,
  levBoard.map((b) => `${b.label}${b.cumR}`).join(' '),
);

/* 복수 매매 — 손실 청산 뒤 15분 창 */
const lossClosed = KST_TS(0, 23);
const revengeTrades: DnaTrade[] = [
  trade({ result: 'loss', r: -1, openedAt: lossClosed - 2 * HOUR, closedAt: lossClosed, holdMs: 2 * HOUR }),
  trade({ id: 'quick', result: 'loss', r: -1, openedAt: lossClosed + 10 * 60_000, closedAt: lossClosed + 40 * 60_000 }),
  trade({ id: 'late', result: 'win', r: 1, openedAt: lossClosed + 30 * 60_000, closedAt: lossClosed + 3 * HOUR }),
];
const revenge = revengeReport(revengeTrades, 15);
check(
  'DNA: 손실 청산 10분 뒤 재진입만 복수 매매로 센다(30분 뒤 제외)',
  revenge.count === 1 && revenge.samples.length === 1 && revenge.samples[0].id === 'quick',
  `${revenge.count}회`,
);
const winPrev = revengeReport(
  [
    trade({ result: 'win', r: 1, closedAt: lossClosed }),
    trade({ id: 'after-win', result: 'loss', r: -1, openedAt: lossClosed + 5 * 60_000 }),
  ],
  15,
);
check('DNA: 직전이 이익이면 복수 매매 아님', winPrev.count === 0);

check('DNA: 보유 시간 구간(1h·4h·12h 경계)', holdBucketOf(3_599_999) === 'under1h' && holdBucketOf(4 * HOUR) === '4to12h' && holdBucketOf(20 * HOUR) === 'over12h' && holdBucketOf(null) === null);
check('DNA: 보유 표기 — 45분 / 6.0시간 / 2일 3시간', fmtHold(45 * 60_000) === '45분' && fmtHold(6 * HOUR) === '6.0시간' && fmtHold(51 * HOUR) === '2일 3시간', `${fmtHold(45 * 60_000)}·${fmtHold(6 * HOUR)}·${fmtHold(51 * HOUR)}`);

/* 진단 문장 — 고배·심야 손실이 앞에 온다 */
const badHabit: DnaTrade[] = [];
for (let i = 0; i < 6; i += 1) badHabit.push(trade({ id: `h${i}`, result: 'loss', r: -1, leverage: 25, openedAt: KST_TS(i, 23) }));
for (let i = 0; i < 6; i += 1) badHabit.push(trade({ id: `m${i}`, result: 'win', r: 1.8, leverage: 8, openedAt: KST_TS(i + 7, 9) }));
const diag = findings(badHabit);
check('DNA: 진단 — 고배/심야 손실이 최우선', diag.length > 0 && diag[0].tone === 'bad' && /고배/.test(diag[0].title), diag[0]?.title ?? '없음');
check('DNA: 진단에 좋은 습관도 함께(오전 또는 저·중배)', diag.some((f) => f.tone === 'good'), diag.map((f) => f.tone).join(','));
check('DNA: 표본 12건이면 "참고용" 경고 없음', !diag.some((f) => /표본/.test(f.title)));
check('DNA: 표본 2건이면 진단을 만들지 않는다', findings([trade({ result: 'win', r: 1 }), trade({ result: 'loss', r: -1 })]).length === 0);

const profile = dnaProfile(badHabit);
check('DNA: 프로필 — 심야가 손실 구간 · 오전이 최고 구간', profile.worstTime?.key === 'night' && profile.bestTime?.key === 'morning', profile.headline);

/* 연패 쿨다운 */
const now = KST_TS(3, 12);
const closedAt = now - 30 * 60_000;
const streak: DnaTrade[] = [
  trade({ id: 'w', result: 'win', r: 1, openedAt: closedAt - 6 * HOUR, closedAt: closedAt - 4 * HOUR }),
  trade({ id: 'l1', result: 'loss', r: -1, openedAt: closedAt - 3 * HOUR, closedAt: closedAt - 2 * HOUR }),
  trade({ id: 'l2', result: 'loss', r: -1, openedAt: closedAt - 90 * 60_000, closedAt }),
];
const cd = lossStreakCooldown(streak, { losses: 2, minutes: 60 }, now);
check(
  'DNA: 2연패 · 마지막 청산 30분 전 → 30분 남은 쿨다운',
  !!cd && cd.streak === 2 && cooldownRemainMin(cd, now) === 30 && cd.until === closedAt + 60 * 60_000,
  cd ? `${cooldownRemainMin(cd, now)}분` : 'null',
);
check('DNA: 2연패지만 60분이 지났으면 쿨다운 아님', lossStreakCooldown(streak, { losses: 2, minutes: 60 }, closedAt + 61 * 60_000) === null);
check('DNA: 연패 설정이 0이면 항상 null', lossStreakCooldown(streak, { losses: 0, minutes: 60 }, now) === null);
check(
  'DNA: 승리로 끊기면 쿨다운 아님',
  lossStreakCooldown(
    [...streak, trade({ id: 'w2', result: 'win', r: 1, openedAt: closedAt + HOUR, closedAt: closedAt + 2 * HOUR })],
    { losses: 2, minutes: 60 },
    closedAt + 90 * 60_000,
  ) === null,
);
check(
  'DNA: 진행 중 매매는 연패를 끊지 않는다',
  lossStreakCooldown(
    [...streak, trade({ id: 'open', result: 'open', r: 0.2, openedAt: closedAt + 10 * 60_000 })],
    { losses: 2, minutes: 60 },
    now,
  )?.streak === 2,
);
check(
  'DNA: 청산 시각이 없는 기록은 쿨다운 근거에서 빠진다',
  lossStreakCooldown([{ ...trade({ id: 'x', result: 'loss', r: -1 }), closedAt: null }], { losses: 1, minutes: 60 }, now) === null,
);

/* 데모 — 가짜 기록 불변식 */
const demo = demoDnaTrades(now);
const demoClosed = demo.filter((t) => t.result !== 'open');
const demoProfile = dnaProfile(demo);
check('DNA 데모: 38건 종료 + 2건 진행', demoClosed.length === 38 && demo.filter((t) => t.result === 'open').length === 2, `${demo.length}건`);
check('DNA 데모: 오전이 최고 · 심야가 최저 구간', demoProfile.bestTime?.key === 'morning' && demoProfile.worstTime?.key === 'night', demoProfile.headline);
check('DNA 데모: 복수 매매가 4회 이상 잡힌다', demoProfile.revenge.count >= 4, `${demoProfile.revenge.count}회`);
check(
  'DNA 데모: 고배(16x+) 누적 손익이 마이너스 · 저배 플러스',
  leverageBoard(demo).find((b) => b.key === 'high')!.cumR < 0 && leverageBoard(demo).find((b) => b.key === 'low')!.cumR > 0,
);
check('DNA 데모: 심야 승률 0%', timeHeatmap(demo).find((b) => b.key === 'night')!.winRate === 0);

/* 매매일지 → DNA */
const records: HistoryRecord[] = [
  {
    id: 'r1', symbol: 'BTCUSDT', base: 'BTC', asset: 'crypto', tf: '1H', side: 'long', strategyId: 's', strategyShort: 'S',
    entry: 100, stop: 98, target: 104, rr: 2, riskPct: 2, detectedAt: now - 5 * HOUR, firstSeen: now - 5 * HOUR,
    state: 'win', r: 2, bars: 3, leverage: 20,
  },
  {
    id: 'r2', symbol: 'ETHUSDT', base: 'ETH', asset: 'crypto', tf: '4H', side: 'short', strategyId: 's', strategyShort: 'S',
    entry: 100, stop: 102, target: 96, rr: 2, riskPct: 2, detectedAt: now - 30 * HOUR, firstSeen: now - 30 * HOUR,
    state: 'loss', r: -1, bars: 2,
  },
  {
    id: 'r3', symbol: 'SOLUSDT', base: 'SOL', asset: 'crypto', tf: '1H', side: 'long', strategyId: 's', strategyShort: 'S',
    entry: 100, stop: 98, target: 104, rr: 2, riskPct: 2, detectedAt: now - 200 * 86_400_000, firstSeen: now,
    state: 'win', r: 1, bars: 1,
  },
];
const mine: MyTrade[] = [{ key: 'BTCUSDT|1H|long|' + (now - 5 * HOUR), enteredAt: now - 5 * HOUR, memo: '' }];
const journal = tradesFromJournal(records, mine, { now });
check('매매일지: 90일 밖 기록은 뺀다', journal.length === 2, `${journal.length}건`);
const own = journal.find((t) => t.id === 'r1')!;
const notOwn = journal.find((t) => t.id === 'r2')!;
check('매매일지: 내 진입 표시만 own=true', own.own === true && notOwn.own === false);
check('매매일지: 청산 시각 = 감지 + 봉 수 × TF', own.closedAt === own.openedAt + 3 * HOUR && notOwn.closedAt === notOwn.openedAt + 2 * 4 * HOUR);
check('매매일지: 기록에 있는 배율을 그대로 쓴다(없으면 null)', own.leverage === 20 && notOwn.leverage === null);
const picked = pickJournalTrades(journal);
check('매매일지: 내 진입이 있으면 그것만 분석', picked.basis === 'own' && picked.trades.length === 1, picked.basis);
check('매매일지: 내 진입이 없으면 시그널 복기 전체', pickJournalTrades(journal.filter((t) => !t.own)).basis === 'signal');

/* 비트겟 과거 포지션 파서 */
const parsed = parsePositionHistoryRows([
  { positionId: 'p1', symbol: 'BTCUSDT', holdSide: 'long', netProfit: '12.5', marginSize: '50', cTime: '1000', uTime: '3000', leverage: '10' },
  { positionId: 'p2', symbol: 'ETHUSDT', holdSide: 'short', netProfit: '-7', marginSize: '70', cTime: '2000', uTime: '5000' },
  { positionId: 'p3', symbol: 'XRPUSDT', holdSide: 'long', netProfit: '1', cTime: '3000', uTime: '4000' },
]);
check('실계좌 파서: 증거금 있는 행만(2건) · R = netProfit ÷ margin', parsed.length === 2 && near(parsed[0].r, 0.25) && near(parsed[1].r, -0.1), parsed.map((p) => p.r.toFixed(2)).join(','));
check('실계좌 파서: 방향·승패·보유시간', parsed[1].side === 'short' && parsed[1].result === 'loss' && parsed[1].holdMs === 3000 && parsed[1].own === true);
const sideRows = sideBoard([
  trade({ result: 'win', r: 2, side: 'long' }),
  trade({ result: 'win', r: 1, side: 'long' }),
  trade({ result: 'loss', r: -1, side: 'short' }),
]);
check('DNA: 롱 100% +3R · 숏 0% −1R', sideRows[0].winRate === 100 && sideRows[0].cumR === 3 && sideRows[1].winRate === 0 && sideRows[1].cumR === -1);

/* ------------------------------------------------------------------ *
 * 2) 청산 자석
 * ------------------------------------------------------------------ */

const entry = 100;
check(
  '청산가: 10x 롱 90.4 · 숏 109.6 (1/L − 0.4%)',
  near(liquidationPrice(entry, 10, 'long'), 90.4) && near(liquidationPrice(entry, 10, 'short'), 109.6),
  `${liquidationPrice(entry, 10, 'long')} / ${liquidationPrice(entry, 10, 'short')}`,
);
check('청산가: 50x 롱 98.4 · 100x 는 99.4', near(liquidationPrice(entry, 50, 'long'), 98.4) && near(liquidationPrice(entry, 100, 'long'), 99.4));
check('청산가: 배율이 높을수록 진입가에 가깝다', liquidationPrice(entry, 10, 'long') < liquidationPrice(entry, 50, 'long'));

function flatCandles(n: number, withHighAt?: number, withLowAt?: number, highPx = 105, lowPx = 95): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c: Candle = { t: 1_700_000_000_000 + i * HOUR, o: 100, h: 101, l: 99, c: 100, v: 1000 };
    if (i === withHighAt) c.h = highPx;
    if (i === withLowAt) c.l = lowPx;
    return c;
  });
}

const swingCandles = flatCandles(100, 30, 60);
const piv = swings(swingCandles, '1H');
check(
  '스윙: 고점 105 · 저점 95만 프랙탈로 잡힌다',
  piv.some((p) => p.kind === 'high' && near(p.price, 105)) && piv.some((p) => p.kind === 'low' && near(p.price, 95)),
  `${piv.length}개`,
);
check('스윙: 좌우 2봉보다 낮은 봉은 고점이 아니다', !piv.some((p) => p.kind === 'high' && near(p.price, 101)));

const merged = clusterPivots([
  { price: 100, weight: 1, kind: 'high', tf: '1H', at: 0 },
  { price: 100.4, weight: 1, kind: 'high', tf: '1H', at: 0 },
  { price: 110, weight: 1, kind: 'high', tf: '1H', at: 0 },
]);
check('클러스터: 0.4% 차이는 합치고 · 10% 차이는 분리', merged.length === 2 && merged[0].touches === 2, merged.map((m) => `${m.center.toFixed(1)}(${m.touches})`).join(' '));

const magnet = analyzeMagnet({
  symbol: 'BTCUSDT',
  base: 'BTC',
  price: 100,
  high24h: 105,
  low24h: 95,
  openInterestUsd: 50_000_000,
  fundingRate: 0.01,
  oiChangePct: null,
  candles1h: swingCandles,
});
check('자석: 결과가 계산된다', !!magnet);
if (magnet) {
  check('자석: 상방 점수 > 0 · 하방 점수 > 0', magnet.up.score > 0 && magnet.down.score > 0, `${magnet.up.score} / ${magnet.down.score}`);
  check(
    '자석: 상방 대표 청산가 > 스윙 고점(105) · 하방 < 스윙 저점(95)',
    (magnet.up.main?.price ?? 0) > 105 && (magnet.down.main?.price ?? 0) < 95,
    `${magnet.up.main?.price.toFixed(2)} / ${magnet.down.main?.price.toFixed(2)}`,
  );
  check('자석: 점수는 0~100', [magnet.up.score, magnet.down.score, magnet.squeeze].every((v) => v >= 0 && v <= 100));
  check('자석: 레버리지 4단(10·20·25·50x)', magnet.up.top?.levels.length === MAGNET_LEVERAGES.length);
  check('자석: OI 청산 물량 추정 > 0', (magnet.up.top?.liqUsd ?? 0) > 0 && (magnet.down.top?.liqUsd ?? 0) > 0);
  check('자석: 펀딩 라벨', /롱 우세|숏 우세|중립/.test(magnet.fundingLabel), magnet.fundingLabel);
  check(
    '자석: 진입 참고 문구는 자석 가격·거리를 담는다',
    /%/.test(magnet.note) && (magnet.bias === 'neutral' ? /비슷합니다/.test(magnet.note) : /%\(/.test(magnet.note)),
    magnet.note.slice(0, 34),
  );
}

const hotLong = analyzeMagnet({
  symbol: 'BTCUSDT',
  base: 'BTC',
  price: 100,
  high24h: 105,
  low24h: 95,
  openInterestUsd: 50_000_000,
  fundingRate: 0.12,
  oiChangePct: 12,
  candles1h: swingCandles,
});
check('자석: 롱 과열(+0.12%)이면 하방 자석 점수가 올라간다', !!hotLong && hotLong.down.score > hotLong.up.score, hotLong ? `${hotLong.down.score} vs ${hotLong.up.score}` : '');
check('자석: 펀딩·OI 경고 문구', !!hotLong && hotLong.warnings.some((w) => /롱 과열/.test(w)) && hotLong.warnings.some((w) => /OI/.test(w)));

const spotMode = analyzeMagnet({
  symbol: 'BTCUSDT',
  base: 'BTC',
  price: 100,
  high24h: 105,
  low24h: 95,
  openInterestUsd: 50_000_000,
  fundingRate: 0.12,
  oiChangePct: 12,
  candles1h: swingCandles,
  derivatives: false,
});
check('자석: 현물 모드는 OI·펀딩을 쓰지 않고 경고를 남긴다', !!spotMode && spotMode.oiUsd === 0 && spotMode.warnings.some((w) => /현물/.test(w)));
check('자석: 캔들 부족(59봉)이면 null', analyzeMagnet({
  symbol: 'X', base: 'X', price: 100, high24h: 101, low24h: 99, openInterestUsd: 0, fundingRate: 0, oiChangePct: null,
  candles1h: flatCandles(59),
}) === null);

const far = analyzeMagnet({
  symbol: 'FARUSDT', base: 'FAR', price: 100, high24h: 130, low24h: 70, openInterestUsd: 10_000_000,
  fundingRate: 0, oiChangePct: null, candles1h: flatCandles(100, 30, 60, 130, 70),
});
check('자석: 더 먼 자석은 점수가 낮다', !!magnet && !!far && far.squeeze < magnet.squeeze, far ? `${far.squeeze} vs ${magnet?.squeeze}` : '');
check('자석: 정렬은 자석이 강한 순', rankMagnets([far!, magnet!])[0].squeeze >= rankMagnets([far!, magnet!])[1].squeeze);

/* ------------------------------------------------------------------ *
 * 3) 섹터
 * ------------------------------------------------------------------ */

const duplicates = SECTORS.flatMap((s) => s.coins.filter((c) => SECTOR_BY_COIN[c] !== s.key));
check('섹터: 한 코인은 한 섹터에만(중복 0)', duplicates.length === 0, duplicates.join(','));
check(
  '섹터: 대표 매핑(AI/밈/L1/L2/DeFi/RWA/솔라나)',
  SECTOR_BY_COIN.FET === 'ai' &&
    SECTOR_BY_COIN.DOGE === 'meme' &&
    SECTOR_BY_COIN.ETH === 'l1' &&
    SECTOR_BY_COIN.ARB === 'l2' &&
    SECTOR_BY_COIN.UNI === 'defi' &&
    SECTOR_BY_COIN.ONDO === 'rwa' &&
    SECTOR_BY_COIN.SOL === 'sol',
);

function coin(symbol: string, base: string, change24h: number, quoteVolume: number): { contract: Contract; ticker: Ticker } {
  return {
    contract: { symbol, base, asset: 'crypto', isRwa: false },
    ticker: { symbol, last: 1, change24h, quoteVolume, fundingRate: 0.01, high24h: 1, low24h: 1 },
  };
}
const fixture = [
  coin('BTCUSDT', 'BTC', 1, 100_000_000),
  coin('FETUSDT', 'FET', 5, 10_000_000),
  coin('RENDERUSDT', 'RENDER', 4, 6_000_000),
  coin('TAOUSDT', 'TAO', 3, 4_000_000),
  coin('DOGEUSDT', 'DOGE', -2, 20_000_000),
  coin('PEPEUSDT', 'PEPE', -1, 8_000_000),
  coin('ARBUSDT', 'ARB', 6, 3_000_000),
  coin('UNIUSDT', 'UNI', 2, 4_000_000),
  coin('FOOUSDT', 'FOO', 10, 5_000_000),
];
const board = buildSectorBoard({
  contracts: fixture.map((f) => f.contract),
  tickers: fixture.map((f) => f.ticker),
  btcChange24h: 1,
});
const ai = board.sectors.find((s) => s.key === 'ai')!;
const meme = board.sectors.find((s) => s.key === 'meme')!;
check('섹터: 매핑된 종목 8개 · 미매핑 거래대금 비중 > 0', board.mapped === 8 && board.unmappedVolumeSharePct > 0, `${board.mapped} · ${board.unmappedVolumeSharePct.toFixed(1)}%`);
check('섹터: AI 평균 +4% · 상대강도 +3%p · 상승 100%', near(ai.avgChange, 4) && near(ai.avgRs, 3) && near(ai.breadth, 1), `${ai.avgChange}/${ai.avgRs}/${ai.breadth}`);
check('섹터: AI 가 밈보다 높은 점수 · 1위', ai.score > meme.score && ai.rank === 1, `${ai.score} vs ${meme.score}`);
check('섹터: 대장주 = 가장 많이 오른 유동성 코인(FET)', ai.leader?.base === 'FET');
check('섹터: 밈은 자금 이탈(평균 −1.5% · 상승 0%)', meme.momentum === 'out', meme.momentum);
check('섹터: L2 는 대장주 ARB · 후발주 없음(코인 1개)', board.sectors.find((s) => s.key === 'l2')!.leader?.base === 'ARB' && board.sectors.find((s) => s.key === 'l2')!.laggards.length === 0);

const lagFixture = [
  coin('BTCUSDT', 'BTC', 0, 100_000_000),
  coin('FETUSDT', 'FET', 8, 10_000_000),
  coin('RENDERUSDT', 'RENDER', 0.5, 6_000_000),
  coin('TAOUSDT', 'TAO', 0, 4_000_000),
  coin('ARKMUSDT', 'ARKM', 0, 1_500_000),
];
const lagBoard = buildSectorBoard({
  contracts: lagFixture.map((f) => f.contract),
  tickers: lagFixture.map((f) => f.ticker),
  btcChange24h: 0,
});
const lagAi = lagBoard.sectors.find((s) => s.key === 'ai')!;
check(
  '섹터: 후발주 = 거래대금은 붙는데 덜 오른 코인(RENDER·TAO)',
  lagAi.leader?.base === 'FET' && lagAi.laggards.map((c) => c.base).sort().join(',') === 'RENDER,TAO',
  lagAi.laggards.map((c) => c.base).join(','),
);
check('섹터: 거래대금 25% 미만(ARKM)은 후발주 후보에서 제외', !lagAi.laggards.some((c) => c.base === 'ARKM'));

const hintFixture = [
  coin('FETUSDT', 'FET', 9, 10_000_000),
  coin('RENDERUSDT', 'RENDER', 1, 8_000_000),
  coin('TAOUSDT', 'TAO', 0, 6_000_000),
];
const hintBoard = buildSectorBoard({
  contracts: hintFixture.map((f) => f.contract),
  tickers: hintFixture.map((f) => f.ticker),
  btcChange24h: 0,
});
const hintList = rotationHints(hintBoard, 3);
check(
  '섹터: 순환매 힌트 = 유입 섹터의 후발주',
  hintList.length > 0 && hintList[0].sector.key === 'ai' && ['RENDER', 'TAO'].includes(hintList[0].coin.base),
  hintList.map((h) => `${h.sector.label}:${h.coin.base}`).join(','),
);
const hints = rotationHints(board, 3);
check('섹터: 힌트는 최대 3개', hints.length <= 3, `${hints.length}개`);

const empty = buildSectorBoard({ contracts: [], tickers: [], btcChange24h: 0 });
check('섹터: 입력이 비면 점수 0 · 순위는 그대로 매긴다', empty.sectors.every((s) => s.score === 0 && s.n === 0) && empty.sectors.length === SECTORS.length);

/* ------------------------------------------------------------------ *
 * 4) 자동매매 연패 쿨다운 게이트
 * ------------------------------------------------------------------ */

const gateConfig = normalizeConfig({ enabled: true, mode: 'demo', autoEntry: true, minWinRate: 0, minRR: 0.5, maxPositions: 3 });
const gateSignal = {
  id: 'sig', symbol: 'BTCUSDT', base: 'BTC', asset: 'crypto', tf: '1H', side: 'long',
  strategyId: 's', strategyName: 'S', strategyShort: 'S', star: 4, entry: 100, stop: 98, target: 104,
  eq: 0, rr: 2, remainingRR: 2, currentR: 0, price: 100, changePct: 0, progress: 0, state: 'open',
  detectedAt: Date.now(), barsSince: 1, winRate: 60, winRateBasis: 'market', strategyExp: 0.3,
  strategyRR: 2, leverage: 10, levRoi: 0, candles: [], detectedIdx: 0, tags: [], fundingRate: 0, quoteVolume: 1e8,
} as unknown as Signal;
const gateBase = {
  config: gateConfig,
  signal: gateSignal,
  tradedKeys: [],
  openPositions: 0,
  openSymbols: [],
  dailyLocked: false,
  plan: null,
  now: Date.now(),
  hasKeys: true,
};
const blocked = evaluateEntry({ ...gateBase, cooldown: { until: gateBase.now + 30 * 60_000, streak: 2 } });
check('게이트: 2연패 쿨다운 중이면 새 진입 거부', blocked.allowed === false && blocked.code === 'cooldown' && /연패/.test(blocked.reason), blocked.reason);
check('게이트: 쿨다운이 지났으면 통과(다음 단계로)', evaluateEntry({ ...gateBase, cooldown: { until: gateBase.now - 1000, streak: 2 } }).code !== 'cooldown');
check('게이트: 원클릭 수동 주문은 쿨다운을 건너뛴다', evaluateEntry({ ...gateBase, manual: true, cooldown: { until: gateBase.now + 30 * 60_000, streak: 2 } }).code !== 'cooldown');
check('게이트: 쿨다운 설정 0이면 컨텍스트가 null', normalizeConfig({ cooldownLosses: 0 }).cooldownLosses === 0 && normalizeConfig({}).cooldownMin === 60);
check('게이트: 쿨다운 값 정규화(2연패·60분 기본 · 99분 → 720 아님)', normalizeConfig({ cooldownLosses: 2, cooldownMin: 60 }).cooldownLosses === 2 && normalizeConfig({ cooldownLosses: 9 }).cooldownLosses === 5);

/* ------------------------------------------------------------------ *
 * 5) 실데이터 스모크 — 네트워크 실패는 경고만
 * ------------------------------------------------------------------ */

const live = async () => {
  try {
    const [tickers, contracts] = await Promise.all([fetchTickers(), fetchContracts()]);
    const btc = tickers.find((t) => t.symbol === 'BTCUSDT');
    const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));
    const top = contracts
      .filter((c) => c.asset === 'crypto')
      .map((c) => ({ c, t: tickerMap.get(c.symbol) }))
      .filter((x): x is { c: Contract; t: Ticker } => !!x.t && x.t.quoteVolume > 0 && x.t.last > 0)
      .sort((a, b) => b.t.quoteVolume - a.t.quoteVolume)[0];
    if (!top || !btc) throw new Error('티커 없음');
    const candles = await fetchCandles(top.c.symbol, '1H', 200);
    const res = analyzeMagnet({
      symbol: top.c.symbol,
      base: top.c.base,
      price: top.t.last,
      high24h: top.t.high24h,
      low24h: top.t.low24h,
      openInterestUsd: Number(top.t.openInterestBase ?? 0) * top.t.last,
      fundingRate: top.t.fundingRate,
      oiChangePct: null,
      candles1h: candles,
      decimals: top.c.decimals,
    });
    check(
      `실데이터: ${top.c.base} 청산 자석 계산(점수·가격 유한)`,
      !!res && res.up.score >= 0 && res.down.score >= 0 && res.price > 0 && Number.isFinite(res.note.length),
      res ? `상방 ${res.up.score} · 하방 ${res.down.score}` : 'null',
    );
    const liveBoard = buildSectorBoard({ contracts, tickers, btcChange24h: btc.change24h });
    check(
      '실데이터: 섹터 보드 — 7섹터 · 매핑 30종목 이상 · 1위 점수 > 0',
      liveBoard.sectors.length === 7 && liveBoard.mapped >= 30 && liveBoard.sectors[0].score > 0,
      `${liveBoard.mapped}종목 · 1위 ${liveBoard.sectors[0].label} ${liveBoard.sectors[0].score}점`,
    );
  } catch (e) {
    warns.push(`실데이터 스모크 건너뜀 — ${e instanceof Error ? e.message : String(e)}`);
    console.log(`⚠️ 실데이터 스모크 건너뜀 — ${e instanceof Error ? e.message : String(e)}`);
  }
};

await live();

console.log(`\n${fails.length ? '❌' : '✅'} 매매 DNA·청산 자석·섹터 레이더 검증: ${pass}건 통과${fails.length ? ` · 실패 ${fails.length}건 (${fails.join(' / ')})` : ''}${warns.length ? ` · 경고 ${warns.length}건` : ''}`);
if (fails.length) process.exit(1);
