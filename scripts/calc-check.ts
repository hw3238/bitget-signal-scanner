/**
 * COTA 계산 엔진 단위 검증 — 화면 수치의 수학적 정확성 (실행: npm run check:calc)
 */
import {
  analyzeLag,
  applyDca,
  bestTransferRoutes,
  buildKimchiRows,
  feeCalculator,
  findDoppelgangers,
  kimchiPremium,
  lagCandidates,
  maintenanceMarginRate,
  pearson,
  positionMetrics,
  positionSizing,
  survivalScore,
  usdtPremium,
} from '../src/lib/calc';

let pass = 0;
const fails: string[] = [];
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fails.push(name);
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* 1) 김치프리미엄 */
check('김프 = 국내가 / (해외가×환율) − 1', near(kimchiPremium(82_000_000, 60_000, 1350), (82_000_000 / 81_000_000 - 1) * 100, 1e-9));
check('역프(국내가 낮음)는 음수', kimchiPremium(78_000_000, 60_000, 1350) < 0);
check('USDT 김프', near(usdtPremium(1370, 1343), (1370 / 1343 - 1) * 100, 1e-9));

const domestic = new Map([
  ['BTC', { krw: 82_000_000, volumeKrw: 500e9 }],
  ['XRP', { krw: 3300, volumeKrw: 300e9 }],
  ['USDT', { krw: 1370, volumeKrw: 100e9 }],
]);
const bitget = new Map([
  ['BTC', 60_000],
  ['XRP', 2.4],
  ['USDT', 1],
]);
const rows = buildKimchiRows(domestic, bitget, 1350);
check('김프 표: USDT 제외 · 2종목', rows.length === 2, rows.map((r) => r.base).join(','));
const btcRow = rows.find((r) => r.base === 'BTC')!;
check('BTC 순손익 = (1−수수료)×해외가/국내가 − 1', near(btcRow.netPct, (1 - 0.0002) * ((60_000 * 1350) / 82_000_000) * 100 - 100, 1e-6), btcRow.netPct.toFixed(3));
const best = bestTransferRoutes(rows, 3, 100e9);
check('송금 최적: 순손익 내림차순', best.length === 2 && best[0].netPct >= best[1].netPct, best.map((b) => `${b.base} ${b.netPct.toFixed(2)}%`).join(' / '));

/* 2) 청산가 */
const long = positionMetrics({ side: 'long', entry: 100, leverage: 10, margin: 100, mark: 100, mmr: 0.005, fundingRatePct: 0.01 });
// liq = (100 − 10) / 0.995 = 90.45…
check('롱 청산가 = (진입가 − 증거금/수량)/(1−유지증거금)', near(long.liq, (100 - 100 / (1000 / 100)) / (1 - 0.005), 1e-9), long.liq.toFixed(4));
check('롱 청산 여유 = |현재가−청산가|/현재가', near(long.liqBufferPct, ((100 - long.liq) / 100) * 100, 1e-9));
check('레버리지 배수 손익률', near(long.pnlPct, 0, 1e-12) && near(long.notional, 1000, 1e-12));
const short = positionMetrics({ side: 'short', entry: 100, leverage: 20, margin: 50, mark: 100, mmr: 0.01 });
check('숏 청산가 = (진입가 + 증거금/수량)/(1+유지증거금)', near(short.liq, (100 + 50 / (1000 / 100)) / 1.01, 1e-9), short.liq.toFixed(4));
const longAt110 = positionMetrics({ side: 'long', entry: 100, leverage: 10, margin: 100, mark: 110, mmr: 0.005 });
check('롱 +10% → 수익률 +100%', near(longAt110.pnlPct, 100, 1e-9) && near(longAt110.pnlUsd, 100, 1e-9));
const shortAt110 = positionMetrics({ side: 'short', entry: 100, leverage: 10, margin: 100, mark: 110, mmr: 0.005 });
check('숏 +10% → 수익률 −100%', near(shortAt110.pnlPct, -100, 1e-9));
check('펀딩: 롱은 +금리에서 지불', long.fundingPerInterval < 0 && short.fundingPerInterval === 0);

/* 3) 물타기 */
const dca = applyDca({ side: 'long', entry: 100, leverage: 10, margin: 100, mark: 90, mmr: 0.005 }, 100, 90);
// 기존 수량 10, 추가 100×10/90 = 11.111 → 평단 (1000+1000)/(21.111) = 94.7368
check('물타기 평단 = 가중평균', near(dca.avgEntry, (100 * 10 + 90 * (1000 / 90)) / (10 + 1000 / 90), 1e-9), dca.avgEntry.toFixed(4));
check('물타기 후 청산가 하락', dca.liq < long.liq, `${long.liq.toFixed(2)} → ${dca.liq.toFixed(2)}`);
check('물타기 후 총 증거금', near(dca.margin, 200, 1e-9));
check('물타기 후 배율 = 명목/증거금', near(dca.leverage, dca.notional / dca.margin, 1e-9));

/* 4) 생존 성적표 */
const s1 = survivalScore({ liqBufferPct: 70, leverage: 2, fundingPerDay: 0, margin: 100, pnlPct: 20 });
const s2 = survivalScore({ liqBufferPct: 3, leverage: 50, fundingPerDay: 3, margin: 100, pnlPct: -40 });
check('안전 포지션 = S', s1.grade === 'S' && s1.score >= 85, `${s1.score}점 ${s1.grade}`);
check('위험 포지션 = 하위 등급', (s2.grade === 'D' || s2.grade === 'F') && s2.score < 40, `${s2.score}점 ${s2.grade}`);
check('점수는 0~100', s1.score <= 100 && s2.score >= 0);
check('청산 5% 이내 경고', /증거금/.test(survivalScore({ liqBufferPct: 3, leverage: 5, fundingPerDay: 0, margin: 100, pnlPct: 0 }).comment));

/* 5) 사이징 */
const size = positionSizing({ seed: 1000, riskPct: 2, entry: 100, stop: 95, target: 115, side: 'long' });
check('허용 손실 = 시드 × 손실률', near(size.riskUsd, 20));
check('수량 = 손실금 ÷ 손절폭', near(size.qty, 20 / 5));
check('손익비 = 목표거리 ÷ 손절거리', near(size.rr, 3));
check('손익분기 승률 = 1/(1+R)', near(size.breakevenWinRate, 25));
check('권장 레버리지 = ceil(명목/시드)', size.leverage === Math.ceil(size.notional / 1000), `${size.notional} → ${size.leverage}x`);
check('목표 수익금 = 수량 × 목표거리', near(size.profitUsd, size.qty * 15));
check('방향 불일치 손절은 거부', positionSizing({ seed: 1000, riskPct: 2, entry: 100, stop: 105, target: 115, side: 'long' }).valid === false);
check('0 입력은 거부', positionSizing({ seed: 0, riskPct: 2, entry: 100, stop: 95, target: 115, side: 'long' }).valid === false);
const shortSize = positionSizing({ seed: 1000, riskPct: 1, entry: 100, stop: 104, target: 90, side: 'short' });
check('숏 사이징도 동일 공식', near(shortSize.rr, 2.5) && near(shortSize.qty, 10 / 4));

/* 6) 수수료 */
const fee = feeCalculator({ seed: 1000, leverage: 10, tradesPerDay: 4, makerShare: 0.5, discountPct: 20, paybackPct: 10 });
check('포지션 규모 = 시드 × 레버리지', near(fee.notional, 10_000));
check('왕복 수수료 = 명목×(혼합요율)×2', near(fee.roundTripFee, (10_000 * 0.04 * 2) / 100), fee.roundTripFee.toFixed(3));
check('월 수수료 = 왕복×일일×30', near(fee.monthlyFee, fee.roundTripFee * 4 * 30));
check('할인·페이백 반영', near(fee.monthlyNet, fee.monthlyFee * 0.8 * 0.9, 1e-9));
check('절감액 = 할인 전 − 후', near(fee.monthlySaving, fee.monthlyFee - fee.monthlyNet, 1e-9));

/* 7) 피어슨 */
check('피어슨 동일 시계열 = 1', near(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1, 1e-12));
check('피어슨 반대 시계열 = −1', near(pearson([1, 2, 3, 4], [-1, -2, -3, -4]), -1, 1e-12));

/* 8) 도플갱어 — 알려진 패턴을 심어 검증 */
const pattern = [100, 101, 100.5, 102, 103, 102.4, 104, 105, 104.2, 106, 107, 106.5];
const closes: number[] = [];
const times: number[] = [];
for (let i = 0; i < 60; i++) {
  closes.push(100 + ((i * 7) % 11) - 5);
  times.push(i * 3600_000);
}
// 과거 20~31번 봉 = 패턴과 같은 모양
pattern.forEach((v, i) => (closes[20 + i] = v));
// 그 이후 12봉은 +10% 상승
for (let i = 0; i < 12; i++) closes[32 + i] = closes[31] * (1 + (0.1 * (i + 1)) / 12);
// 다른 구간(44~55)은 패턴과 다른 모양으로 채워 1위를 흔들지 않게
for (let i = 0; i < 12; i++) closes[44 + i] = 200 - ((i * 5) % 13) + i * 0.3;
// 현재 패턴(마지막 12봉) = 과거 패턴과 같은 모양, 가격대만 다름
pattern.forEach((v, i) => (closes[48 + i] = v * 1.05));
const dop = findDoppelgangers(closes, times, 12, 12, 3);
check('도플갱어 TOP 구간 반환(최대 3)', dop.matches.length >= 1 && dop.matches.length <= 3, dop.matches.map((m) => `${m.endIndex}:${m.similarity.toFixed(0)}%`).join(' '));
check('서로 겹치는 구간은 하나만', dop.matches.every((m, i) => dop.matches.every((n, j) => i === j || Math.abs(m.endIndex - n.endIndex) >= 12)));
check('심어 둔 패턴이 1위', dop.matches[0].endIndex === 31, `1위 끝 인덱스 ${dop.matches[0].endIndex}`);
check('1위 상관 ≈ 1', dop.matches[0].corr > 0.999, dop.matches[0].corr.toFixed(4));
check('이후 등락률 = 실제 종가 변화', near(dop.matches[0].futureChangePct, (closes[43] / closes[31] - 1) * 100, 1e-9), `${dop.matches[0].futureChangePct.toFixed(2)}%`);
check('미래 구간은 패턴 이후에만', dop.matches.every((m) => m.endIndex + 12 < closes.length - 12));
check('상승 건수 집계', dop.upCount >= 1);

/* 9) 키맞추기 */
const btcSeries: number[] = [];
const altSeries: number[] = [];
for (let i = 0; i < 60; i++) {
  btcSeries.push(100 * (1 + 0.002 * Math.sin(i)));
  altSeries.push(50 * (1 + 0.0019 * Math.sin(i)));
}
// 마지막 4봉: BTC +2%, 알트 +0.2%
for (let i = 56; i < 60; i++) btcSeries[i] = btcSeries[55] * (1 + (0.02 * (i - 55)) / 4);
for (let i = 56; i < 60; i++) altSeries[i] = altSeries[55] * (1 + (0.002 * (i - 55)) / 4);
const lag = analyzeLag(btcSeries, altSeries, 4, { symbol: 'TESTUSDT', base: 'TEST', last: 50 })!;
check('키맞추기 BTC 변동률', near(lag.btcChangePct, (btcSeries[59] / btcSeries[55] - 1) * 100, 1e-9), lag.btcChangePct.toFixed(2));
check('키맞추기 괴리 = BTC − 알트', near(lag.gapPct, lag.btcChangePct - lag.altChangePct, 1e-12));
check('BTC 상승 → 롱 후발주자', lag.watch === 'long' && lag.gapPct > 0);
const cands = lagCandidates([lag], 0.5, 0.5);
check('상관·괴리 필터 통과', cands.length === (lag.corr >= 0.5 ? 1 : 0), `corr ${lag.corr.toFixed(2)}`);

/* 10) 유지증거금 가정 */
check('유지증거금: BTC 0.4% · ETH 0.5% · 알트 1%', maintenanceMarginRate('BTCUSDT') === 0.004 && maintenanceMarginRate('ETHUSDT') === 0.005 && maintenanceMarginRate('SOLUSDT') === 0.01);

console.log(`\n${fails.length === 0 ? '✅ 계산 엔진 검증 통과' : `❌ 실패 ${fails.length}건`} (${pass}개 확인)`);
if (fails.length) {
  console.log(fails.join('\n'));
  process.exitCode = 1;
}
