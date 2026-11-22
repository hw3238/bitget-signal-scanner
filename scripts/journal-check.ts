/**
 * 매매 복기 집계 단위 검증 — 승률·누적 R·시드 기준 손익 · 수익곡선(MDD) · 연승/연패 · 전략별 성적 · 중복 기록 정리
 *   실행: npm run check:journal
 */
import type { HistoryRecord, MyTrade } from '../src/lib/storage';
import { signalKey } from '../src/lib/storage';
import { favoriteKey } from '../src/lib/favorites';
import {
  dedupeHistory,
  equityCurve,
  fmtR,
  journalStats,
  recordKey,
  strategyBoard,
  streaks,
  tradesIn,
} from '../src/lib/journal';

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

const T = (min: number) => Date.UTC(2026, 10, 20, 0, 0) + min * 60_000;

function rec(over: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: over.id ?? `r-${over.detectedAt ?? 0}`,
    symbol: 'BTCUSDT',
    base: 'BTC',
    asset: 'crypto',
    tf: '1H',
    side: 'long',
    strategyId: 'crt-fvg-cisd',
    strategyShort: 'CRT·FVG·CISD',
    entry: 100,
    stop: 95,
    target: 115,
    rr: 3,
    riskPct: 5,
    detectedAt: 0,
    firstSeen: 0,
    state: 'open',
    r: 0,
    bars: 1,
    ...over,
  };
}

/* 기준 데이터 — 종료 5건(+2, -1, +3, -1, -1) + 진행 1건 */
const w1 = rec({ id: 'w1', detectedAt: T(10), state: 'win', r: 2, strategyId: 'crt-fvg-cisd', strategyShort: 'CRT·FVG·CISD' });
const l1 = rec({ id: 'l1', detectedAt: T(20), state: 'loss', r: -1, strategyId: 'ema-pullback-rsi', strategyShort: 'EMA 눌림·RSI' });
const w2 = rec({ id: 'w2', detectedAt: T(30), state: 'win', r: 3, strategyId: 'sweep-ob', strategyShort: '스윕·OB', tf: '4H' });
const l2 = rec({ id: 'l2', detectedAt: T(40), state: 'loss', r: -1, strategyId: 'bb-squeeze-break', strategyShort: 'BB 스퀴즈' });
const l3 = rec({ id: 'l3', detectedAt: T(50), state: 'loss', r: -1, strategyId: 'bb-squeeze-break', strategyShort: 'BB 스퀴즈' });
const o1 = rec({ id: 'o1', detectedAt: T(60), state: 'open', r: 0.4, strategyId: 'supertrend-donchian', strategyShort: 'ST·돈치안', tf: '4H', side: 'short' });
/** 스캔이 반복되며 진입 인덱스가 바뀐 같은 시그널(중복) — 가장 최근 스캔 상태가 남아야 한다 */
const l1dup = rec({ id: 'l1-entryIdx-shifted', detectedAt: T(20), state: 'loss', r: -1, strategyId: 'ema-pullback-rsi', strategyShort: 'EMA 눌림·RSI' });

const base = [w1, l1, w2, l2, l3, o1];

/* 1) 중복 기록 정리 */
const unique = dedupeHistory(base);
check('중복 없으면 그대로 6건', unique.length === 6, `${unique.length}건`);
const withDup = dedupeHistory([...base, l1dup]);
check('같은 캔들 중복 기록은 1건으로 합침', withDup.length === 6, `${base.length + 1} → ${withDup.length}`);
check('중복은 최신 스캔 상태를 남긴다', withDup.find((h) => recordKey(h) === recordKey(l1))?.id === 'l1-entryIdx-shifted');
check('정리 후 detectedAt 최신순', withDup.every((h, i) => i === 0 || withDup[i - 1].detectedAt >= h.detectedAt), withDup.map((h) => h.id).join(' > '));

/* 2) 기본 집계 */
const basis = { seed: 5000, riskPct: 1.5 };
const s = journalStats(base, basis);
check('전체 6건 · 종료 5건 · 진행 1건', s.total === 6 && s.closed === 5 && s.open === 1, `${s.total}/${s.closed}/${s.open}`);
check('승률 = 목표 달성 2 / 종료 5 = 40%', near(s.winRate, 40) && s.wins === 2 && s.losses === 3, `${s.winRate.toFixed(1)}%`);
check('누적 R = +2 -1 +3 -1 -1 = +2R', near(s.cumR, 2), fmtR(s.cumR));
check('평균 R = 누적 ÷ 종료 = +0.40R', near(s.avgR, 0.4), fmtR(s.avgR));
check('1회 허용 손실 = 시드 5000 × 1.5% = $75', near(s.riskUsd, 75), `$${s.riskUsd}`);
check('누적 손익 = 누적 R × $75 = +$150', near(s.pnlUsd, 150), `$${s.pnlUsd}`);
const noProfile = journalStats(base, { seed: 0, riskPct: 0 });
check('시드 0이면 손익 $0 (R은 그대로)', near(noProfile.pnlUsd, 0) && near(noProfile.cumR, 2));
check('진행만 있으면 승률 0 · 평균 R 0', (() => {
  const only = journalStats([o1], basis);
  return only.winRate === 0 && only.avgR === 0 && only.open === 1 && near(only.cumR, 0);
})());
check('빈 기록은 전부 0', (() => {
  const e = journalStats([], basis);
  return e.total === 0 && e.closed === 0 && e.winRate === 0 && e.cumR === 0 && e.pnlUsd === 0;
})());

/* 3) 수익곡선 · MDD */
const curve = equityCurve(base);
check('곡선 점 = 시작 0R + 종료 5건', curve.points.length === 6 && curve.trades === 5, `${curve.points.length}점`);
check('시작점은 0R', curve.points[0].cumR === 0 && curve.points[0].r === 0);
check('시간순 누적 = 2,1,4,3,2', curve.points.slice(1).map((p) => p.cumR).join(',') === '2,1,4,3,2', curve.points.map((p) => p.cumR).join(' → '));
check('최종 누적 = +2R · 최고 = +4R', near(curve.finalR, 2) && near(curve.peakR, 4), `${fmtR(curve.finalR)} / ${fmtR(curve.peakR)}`);
check('최대 낙폭 = 4R → 2R = -2R', near(curve.mddR, -2), fmtR(curve.mddR));
check('낙폭 고점 = +4R(세 번째 매매)', near(curve.mddPeakR, 4) && curve.mddPeakAt === T(30), `${fmtR(curve.mddPeakR)} @ ${curve.mddPeakAt}`);
check('낙폭 저점 = 마지막 매매',curve.mddTroughAt === T(50), `${curve.mddTroughAt}`);
const shuffled = equityCurve([l3, w2, o1, l1, w1, l2]);
check('입력 순서와 무관하게 같은 곡선', shuffled.points.map((p) => p.cumR).join(',') === curve.points.map((p) => p.cumR).join(','));
const down = equityCurve([rec({ id: 'd1', detectedAt: T(1), state: 'loss', r: -2 }), rec({ id: 'd2', detectedAt: T(2), state: 'loss', r: -1 })]);
check('첫 매매부터 손실이면 0R 고점 기준 낙폭', near(down.mddR, -3) && near(down.mddPeakR, 0), fmtR(down.mddR));
const upOnly = equityCurve([rec({ id: 'u1', detectedAt: T(1), state: 'win', r: 1 }), rec({ id: 'u2', detectedAt: T(2), state: 'win', r: 2 })]);
check('연속 이익이면 낙폭 0', upOnly.mddR === 0 && near(upOnly.finalR, 3));
check('종료가 없으면 곡선 없음', equityCurve([o1]).points.length === 0);
check('진행 중 매매는 곡선에서 제외', equityCurve(base).points.length === 6);

/* 4) 연승 · 연패 */
const st = streaks(base);
check('최장 연승 1 · 최장 연패 2', st.maxWin === 1 && st.maxLoss === 2, `${st.maxWin}연승 / ${st.maxLoss}연패`);
check('마지막은 2연패', st.current === 'loss' && st.currentLen === 2);
const st2 = streaks([rec({ detectedAt: T(1), state: 'win', r: 1 }), rec({ detectedAt: T(2), state: 'win', r: 1 }), rec({ detectedAt: T(3), state: 'win', r: 1 })]);
check('3연승 계산', st2.maxWin === 3 && st2.maxLoss === 0 && st2.current === 'win' && st2.currentLen === 3);

/* 5) 전략별 성적 */
const board = strategyBoard(base);
check('전략 5개 (진행 중만 있는 전략 포함)', board.length === 5, board.map((r) => `${r.strategyShort} ${r.cumR}`).join(' / '));
check(
  '종료 있는 전략은 누적 R 순, 종료 없는 전략은 마지막',
  board.map((r) => r.strategyShort).join('|') === '스윕·OB|CRT·FVG·CISD|EMA 눌림·RSI|BB 스퀴즈|ST·돈치안',
  board.map((r) => r.strategyShort).join(' > '),
);
check('진행만 있는 전략 = 종료 0 · 누적 0R', (() => {
  const st = board.find((r) => r.strategyId === 'supertrend-donchian')!;
  return st.closed === 0 && st.open === 1 && st.cumR === 0 && st.winRate === 0;
})());
const bb = board.find((r) => r.strategyId === 'bb-squeeze-break')!;
check('BB 스퀴즈 = 2건 0승 승률 0% 누적 -2R', bb.closed === 2 && bb.wins === 0 && bb.winRate === 0 && near(bb.cumR, -2) && near(bb.avgR, -1), `${bb.closed}건 ${fmtR(bb.cumR)}`);
const ob = board.find((r) => r.strategyId === 'sweep-ob')!;
check('스윕·OB = 1건 1승 100% +3R', ob.closed === 1 && ob.winRate === 100 && near(ob.cumR, 3), `${ob.winRate}% ${fmtR(ob.cumR)}`);
const boardOpen = strategyBoard([o1, w1]);
check('종료가 없는 전략은 뒤로', boardOpen.map((r) => r.strategyId).join('|') === 'crt-fvg-cisd|supertrend-donchian', boardOpen.map((r) => r.strategyId).join(' > '));

/* 6) 내 진입 매매만 집계 */
const mine: MyTrade[] = [
  { key: signalKey(w1), enteredAt: T(11), memo: '원칙 준수' },
  { key: signalKey(l1), enteredAt: T(21), memo: '추격 매수 주의' },
  { key: signalKey(o1), enteredAt: T(61), memo: '' },
];
const inMine = tradesIn(base, mine);
check('내 진입 = 3건', inMine.records.length === 3 && inMine.orphans === 0, `${inMine.records.length}건`);
const ms = journalStats(inMine.records, basis);
check('내 매매 승률 = 1/2 = 50%', near(ms.winRate, 50), `${ms.winRate}%`);
check('내 매매 누적 = +2 -1 = +1R · 손익 +$75', near(ms.cumR, 1) && near(ms.pnlUsd, 75), `${fmtR(ms.cumR)} / $${ms.pnlUsd}`);
check('내 매매 곡선 = 0R → 2R → 1R', equityCurve(inMine.records).points.map((p) => p.cumR).join(',') === '0,2,1');
const orphan = tradesIn(base, [...mine, { key: 'BTCUSDT|1H|long|9999999', enteredAt: T(1), memo: '' }]);
check('기록이 지워진 진입은 orphans', orphan.records.length === 3 && orphan.orphans === 1, `${orphan.orphans}건`);
check('진입하지 않은 시그널은 집계 제외', !inMine.records.some((h) => h.id === 'w2'));

/* 7) 키 · 표기 */
check('시그널 키 형식 = symbol|tf|side|detectedAt', signalKey(w1) === `BTCUSDT|1H|long|${T(10)}`, signalKey(w1));
check('기록 키 = 즐겨찾기 키와 동일', recordKey(w1) === favoriteKey({ symbol: 'BTCUSDT', tf: '1H', side: 'long', detectedAt: T(10) }));
check('같은 캔들의 중복은 같은 키', recordKey(l1) === recordKey(l1dup));
check('R 표기 = 부호 포함', fmtR(2.4) === '+2.40R' && fmtR(-1) === '-1.00R' && fmtR(0) === '0.00R', `${fmtR(2.4)} ${fmtR(-1)} ${fmtR(0)}`);

console.log(`\n${fails.length === 0 ? '✅ 매매 복기 집계 검증 통과' : `❌ 실패 ${fails.length}건`} (${pass}개 확인)`);
if (fails.length) {
  console.log(fails.join('\n'));
  process.exitCode = 1;
}
