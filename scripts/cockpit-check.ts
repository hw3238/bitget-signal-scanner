/**
 * 실전 주문 콕핏 단위 검증 — 수량·증거금·손익·거래소 주문 단위·가격 라벨 배치
 *   실행: npm run check:cockpit
 */
import {
  RISK_MAX,
  RISK_MIN,
  RISK_PRESETS,
  clampRiskInput,
  isHighRisk,
  copyPriceText,
  copyQtyText,
  defaultRiskPct,
  fmtUsd,
  formatQty,
  planOrder,
  resolveRiskPct,
} from '../src/lib/orderCockpit';
import { layoutPriceLabels } from '../src/lib/chartLabels';

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

/* 1) 리스크 기본값 */
check('보수적 기본 리스크 1.5%', defaultRiskPct('conservative') === 1.5);
check('공격적 기본 리스크 3%', defaultRiskPct('aggressive') === 3);
check('설정값이 있으면 그 값을 쓴다', resolveRiskPct('conservative', 2) === 2);
check('설정값 null → 성향 기본값', resolveRiskPct('aggressive', null) === 3);
check('리스크 상한 50%로 확장', resolveRiskPct('aggressive', 50) === RISK_MAX && RISK_MAX === 50);
check('리스크 하한 0.5%', resolveRiskPct('conservative', 0.1) === RISK_MIN && RISK_MIN === 0.5);
check('프리셋에 10/20/30/50% 포함', RISK_PRESETS.includes(10) && RISK_PRESETS.includes(20) && RISK_PRESETS.includes(30) && RISK_PRESETS.includes(50));
check('직접 입력 0.5~50% 클램프', clampRiskInput(70) === 50 && clampRiskInput(0.2) === 0.5 && clampRiskInput(12.34) === 12.3);
check('10% 이상 고위험 표시', isHighRisk(10) && isHighRisk(50) && !isHighRisk(9.9));
check('0·음수 설정은 기본값으로', resolveRiskPct('conservative', 0) === 1.5 && resolveRiskPct('conservative', -3) === 1.5);

/* 2) 롱 주문 계획 */
const long = planOrder({ seed: 1000, riskPct: 2, leverage: 10, side: 'long', entry: 100, stop: 95, target: 115 });
check('롱: 손실금 = 시드 × 리스크%', near(long.riskUsd, 20));
check('롱: 수량 = 손실금 ÷ 손절거리', near(long.qty, 4));
check('롱: 포지션 규모 = 수량 × 진입가', near(long.notional, 400));
check('롱: 필요 증거금 = 규모 ÷ 레버리지', near(long.margin, 40));
check('롱: 손절 손익 = −손실금', near(long.stopLossUsd, -20) && near(long.lossRoiPct, -2));
check('롱: 목표 수익 = 수량 × 목표거리', near(long.profitUsd, 60) && near(long.profitRoiPct, 6));
check('롱: 손익비·거리%', near(long.rr, 3) && near(long.stopDistPct, 5) && near(long.targetDistPct, 15));
check('롱: 시드보다 증거금이 작음', !long.overSeed);

/* 2-1) 1회 리스크 50% — 수량·손실·증거금이 그대로 비례하는지 */
const half = planOrder({ seed: 1000, riskPct: 50, leverage: 10, side: 'long', entry: 100, stop: 95, target: 115 });
check('리스크 50%: 손실금 = 시드의 절반', near(half.riskUsd, 500));
check('리스크 50%: 수량 100 · 규모 10,000', near(half.qty, 100) && near(half.notional, 10000));
check('리스크 50%: 필요 증거금 1,000 (시드와 동일 → 경고 없음)', near(half.margin, 1000) && !half.overSeed);
check('리스크 50%: 손실률 −50%', near(half.lossRoiPct, -50));

/* 3) 숏 주문 계획 */
const short = planOrder({ seed: 1000, riskPct: 1, leverage: 10, side: 'short', entry: 100, stop: 104, target: 90 });
check('숏: 수량 = 손실금 ÷ 손절거리', near(short.qty, 2.5) && near(short.notional, 250));
check('숏: 손익비 2.5 · 손절가 > 진입가 > 목표가', near(short.rr, 2.5) && short.valid);

/* 4) 방향·입력 검증 */
check('롱인데 손절가가 위면 거부', !planOrder({ seed: 1000, riskPct: 2, leverage: 10, side: 'long', entry: 100, stop: 105, target: 115 }).valid);
check('숏인데 목표가가 위면 거부', !planOrder({ seed: 1000, riskPct: 2, leverage: 10, side: 'short', entry: 100, stop: 90, target: 115 }).valid);
check('시드 0이면 거부', !planOrder({ seed: 0, riskPct: 2, leverage: 10, side: 'long', entry: 100, stop: 95, target: 115 }).valid);
check('손절가 = 진입가면 거부', !planOrder({ seed: 1000, riskPct: 2, leverage: 10, side: 'long', entry: 100, stop: 100, target: 115 }).valid);

/* 5) 거래소 주문 단위(비트겟 volumePlace) 반영 */
const btc = planOrder({
  seed: 5000,
  riskPct: 1.5,
  leverage: 10,
  side: 'long',
  entry: 60000,
  stop: 59400,
  target: 62000,
  spec: { minTradeNum: 0.0001, volumePlace: 4, minTradeUsdt: 5 },
});
const rawBtcQty = (5000 * 0.015) / 600;
check('거래소 단위 내림: 수량이 volumePlace 자리로 내려간다', near(btc.qty, 0.125), `${btc.qty}`);
check('거래소 단위 내림: 손실은 계획(75)보다 크지 않다', btc.riskUsd <= 75 + 1e-9 && btc.riskUsd > 74, btc.riskUsd.toFixed(4));
check('거래소 단위: 표기·복사 자리수 = volumePlace', btc.qtyDecimals === 4 && copyQtyText(btc.qty, btc.qtyDecimals) === '0.125', copyQtyText(btc.qty, btc.qtyDecimals));
check('거래소 단위: 원래 수량도 같다', near(rawBtcQty, 0.125));
check('최소 주문 수량 통과', !btc.belowMinQty && !btc.belowMinNotional, `최소 ${btc.minQty}`);

const tiny = planOrder({
  seed: 20,
  riskPct: 0.5,
  leverage: 5,
  side: 'long',
  entry: 60000,
  stop: 59400,
  target: 62000,
  spec: { minTradeNum: 0.001, volumePlace: 4, minTradeUsdt: 5 },
});
check('최소 수량 미만 플래그', tiny.belowMinQty === true && tiny.belowMinNotional === false, `수량 ${tiny.qty}`);

const tinyNotional = planOrder({
  seed: 20,
  riskPct: 0.5,
  leverage: 5,
  side: 'long',
  entry: 60000,
  stop: 59400,
  target: 62000,
  spec: { minTradeNum: 0.0001, volumePlace: 4, minTradeUsdt: 100 },
});
check('최소 주문 금액 미만 플래그', tinyNotional.belowMinNotional === true && tinyNotional.belowMinQty === false, `규모 ${tinyNotional.notional.toFixed(2)}`);

const noStep = planOrder({ seed: 1000, riskPct: 2, leverage: 10, side: 'long', entry: 100, stop: 96, target: 110 });
check('계약 정보가 없으면 내림 없이 계산', near(noStep.qty, 5) && noStep.qtyDecimals === null);

/* 6) 증거금 > 시드 경고 (1x에서 넓은 포지션) */
const wide = planOrder({ seed: 1000, riskPct: 3, leverage: 1, side: 'long', entry: 100, stop: 99, target: 104 });
check('증거금이 시드보다 크면 overSeed', wide.overSeed === true, `증거금 ${wide.margin.toFixed(0)}`);

/* 7) 표기 */
check('수량 표기: 정수 코인은 콤마', formatQty(152266, 0) === '152,266', formatQty(152266, 0));
check('수량 표기: 비트 소수', formatQty(0.0333, 4) === '0.0333', formatQty(0.0333, 4));
check('수량 표기: 자리수 없으면 유효숫자', formatQty(0.0333333) === '0.03333', formatQty(0.0333333));
check('USDT 표기', fmtUsd(546.26) === '$546.26' && fmtUsd(2185) === '$2,185' && fmtUsd(-75) === '-$75.00');
check('복사 수량: 지수·콤마 없음', copyQtyText(1200000000, 0) === '1200000000' && copyQtyText(0.00042) === '0.00042');
check('복사 진입가: 거래소 자리수', copyPriceText(0.01435, 5) === '0.01435' && copyPriceText(56699.6) === '56699.6');

/* 8) 차트 가격 라벨 배치 */
const layout = layoutPriceLabels(
  [
    { key: 'target', y: 20 },
    { key: 'entry', y: 22 },
    { key: 'stop', y: 24 },
  ],
  { height: 116, labelHeight: 12, pad: 4 },
);
const tops = layout.map((l) => l.top);
check('가까운 라벨은 최소 간격으로 벌린다', tops[1] - tops[0] >= 13 - 1e-9 && tops[2] - tops[1] >= 13 - 1e-9, tops.join(' / '));
check('라벨은 차트 위·아래로 벗어나지 않는다', tops.every((t) => t >= 10 - 1e-9 && t <= 106 + 1e-9), tops.join(' / '));
const edge = layoutPriceLabels(
  [
    { key: 'target', y: 110 },
    { key: 'entry', y: 112 },
    { key: 'stop', y: 114 },
  ],
  { height: 116, labelHeight: 12, pad: 4 },
);
check('아래 끝에 몰려도 안쪽으로 당긴다', edge.every((l) => l.top <= 106 + 1e-9) && edge[2].top - edge[1].top >= 13 - 1e-9, edge.map((l) => l.top).join(' / '));
const keep = layoutPriceLabels([{ key: 'entry', y: 58 }], { height: 116 });
check('겹침이 없으면 그대로 둔다', Math.abs(keep[0].top - 58) < 1e-9 && keep[0].key === 'entry');

console.log(`\n${fails.length === 0 ? '✅ 실전 주문 콕핏 검증 통과' : `❌ 실패 ${fails.length}건`} (${pass}개 확인)`);
if (fails.length) {
  console.log(fails.join('\n'));
  process.exitCode = 1;
}
