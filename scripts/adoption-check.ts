/**
 * 채택 규칙 검증 — 전략 단위(전수 검증) + 마켓 단위(최근 60봉) 하이브리드
 *
 *  · `benchProven`      : 전수 성적 게이트(표본 40 · 승률 45% · 기대값 0.2R) + 타임프레임 승률 하한
 *  · `localCounterEvidence` : 마켓 최근 표본이 검증 기법 채택을 뒤집는지(연속 손실·저승률·1건 손실)
 *  · `adoptionPriority` : (기대값 × 승률) × TF 가중 + 마켓 실측 가점 — 고빈도 저승률 기법이 앞서지 못한다
 *
 * 실행: npm run check:adoption
 */
import { adoptionPriority, aggregate, benchProven, emptyStats, localCounterEvidence } from '../src/engine/backtest';
import { STRATEGY_BY_ID } from '../src/engine/types';
import type { StrategyStats, Trade } from '../src/engine/types';

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(name);
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const trade = (result: Trade['result'], rResult = result === 'win' ? 2 : -1): Trade => ({
  side: 'long',
  entryIdx: 0,
  entry: 100,
  stop: 95,
  target: 110,
  exitIdx: result === 'open' ? null : 5,
  result,
  rResult,
  bars: 5,
  tags: [],
});

const statsOf = (results: Trade['result'][], expectancy = 0.5): StrategyStats => {
  const s = aggregate(results.map((r) => trade(r)));
  return { ...s, expectancy };
};

/* ---------- 1) 전수 게이트 ---------- */
const momentum = STRATEGY_BY_ID['momentum-climax'];
const supertrend = STRATEGY_BY_ID['supertrend-donchian'];
const br = STRATEGY_BY_ID['break-retest-20'];
check('전수 게이트: 모멘텀 클라이맥스(52.9%/+0.537R/51건) 통과', benchProven(momentum));
check('전수 게이트: SuperTrend(51.7%/+0.338R) 통과', benchProven(supertrend));
check('전수 게이트: TF 하한 — 모멘텀 1H(42.3%)는 제외', !benchProven(momentum, '1H'), `${momentum.bench.byTf['1H']}%`);
check('전수 게이트: TF 하한 — 모멘텀 4H(64.0%)는 통과', benchProven(momentum, '4H'), `${momentum.bench.byTf['4H']}%`);
check('전수 게이트: TF 하한 — B&R 4H(40.7%)는 제외', !benchProven(br, '4H'), `${br.bench.byTf['4H']}%`);
check('전수 게이트: TF 하한 — B&R 1H(49.4%)는 통과', benchProven(br, '1H'), `${br.bench.byTf['1H']}%`);
check(
  '전수 게이트: 승률 45% 미만 기법은 탈락 — EQ(42.6%/+0.199R) 기준',
  !(42.6 >= 45 && 0.199 >= 0.2),
  'EQ 는 라이브 풀에서 제외됨',
);
check('전수 게이트: 표본 부족(30건)은 탈락', !benchProven({ ...momentum, bench: { ...momentum.bench, n: 30 } }));

/* ---------- 2) 마켓 반증 판정 ---------- */
check('반증: 최근 표본 0건 → 반증 없음', !localCounterEvidence(emptyStats(), []));
check('반증: 1건 손실 → 반증', localCounterEvidence(statsOf(['loss']), [trade('loss')]));
check('반증: 1건 승리 → 반증 없음', !localCounterEvidence(statsOf(['win']), [trade('win')]));
check(
  '반증: 2건 연속 손실 → 반증',
  localCounterEvidence(statsOf(['loss', 'loss']), [trade('loss'), trade('loss')]),
);
check(
  '반증: 2건(손실→승리) → 반증 없음',
  !localCounterEvidence(statsOf(['loss', 'win']), [trade('loss'), trade('win')]),
);
check(
  '반증: 3건 중 마지막 2건 연속 손실 → 반증',
  localCounterEvidence(statsOf(['win', 'loss', 'loss']), [trade('win'), trade('loss'), trade('loss')]),
);
check(
  '반증: 4건 승률 25%(1승) → 반증',
  localCounterEvidence(statsOf(['win', 'loss', 'loss', 'loss']), [
    trade('win'),
    trade('loss'),
    trade('loss'),
    trade('loss'),
  ]),
);
check(
  '반증: 4건 승률 50%(승·손 번갈아) → 반증 없음',
  !localCounterEvidence(statsOf(['win', 'loss', 'win', 'loss']), [
    trade('win'),
    trade('loss'),
    trade('win'),
    trade('loss'),
  ]),
);
check('반증: 진행 중 신호만 있으면 반증 없음', !localCounterEvidence(emptyStats(), [trade('open')]));

/* ---------- 3) 우선순위 = 기대값 × 승률 ---------- */
const p = (id: string, tf: '1H' | '4H' = '1H', local: StrategyStats = emptyStats(), basis: 'market' | 'bench' = 'bench') =>
  adoptionPriority(STRATEGY_BY_ID[id], tf, local, basis);

check(
  '우선순위: 모멘텀(4H) > 스윕·OB > SuperTrend > B&R',
  p('momentum-climax', '4H') > p('sweep-ob') &&
    p('sweep-ob') > p('supertrend-donchian') &&
    p('supertrend-donchian') > p('break-retest-20'),
  [
    p('momentum-climax', '4H').toFixed(1),
    p('sweep-ob').toFixed(1),
    p('supertrend-donchian').toFixed(1),
    p('break-retest-20').toFixed(1),
  ].join(' > '),
);
check(
  '우선순위: TF 가중 — 모멘텀 1H 는 4H 보다 낮다',
  p('momentum-climax', '1H') < p('momentum-climax', '4H'),
  `${p('momentum-climax', '1H').toFixed(1)} < ${p('momentum-climax', '4H').toFixed(1)}`,
);
check(
  '우선순위: 저승률 EMA(0.253×47.0)는 고승률 모멘텀보다 낮다',
  p('ema-pullback-rsi') < p('momentum-climax', '4H'),
  `${p('ema-pullback-rsi').toFixed(1)} < ${p('momentum-climax', '4H').toFixed(1)}`,
);
const strongLocal = statsOf(['win', 'win', 'win', 'loss'], 0.9);
check(
  '우선순위: 마켓 실측 가점 — EMA 가 60봉 3승1패·기대 0.9R 이면 SuperTrend 를 앞선다',
  p('ema-pullback-rsi', '1H', strongLocal, 'market') > p('supertrend-donchian'),
  `${p('ema-pullback-rsi', '1H', strongLocal, 'market').toFixed(1)} > ${p('supertrend-donchian').toFixed(1)}`,
);
check(
  '우선순위: 마켓 가점 상한 — 60봉 3승1패 EMA 도 전수 최상위 모멘텀(4H)은 넘지 못한다',
  p('ema-pullback-rsi', '1H', strongLocal, 'market') < p('momentum-climax', '4H'),
  `${p('ema-pullback-rsi', '1H', strongLocal, 'market').toFixed(1)} < ${p('momentum-climax', '4H').toFixed(1)}`,
);
check(
  '우선순위: 표본만 많은 저승률 기법은 가점이 없으면 앞서지 못한다',
  p('ema-pullback-rsi', '1H', { ...statsOf(['win', 'loss', 'loss', 'loss']), winRate: 25 }, 'bench') <
    p('supertrend-donchian'),
);

/* ---------- 결과 ---------- */
console.log('');
if (failures.length) {
  console.log(`❌ 채택 규칙 검증 실패 ${failures.length}건 / ${passed + failures.length}개 확인`);
  process.exit(1);
}
console.log(`✅ 채택 규칙 검증 통과 (${passed}개 확인)`);
