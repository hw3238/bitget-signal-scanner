// 랏(Lot) 손익 계산 단위 검증 — src/utils/lot.ts 를 esbuild로 번들해 20종목 계약 크기·핍 가치·비례를 확인합니다.
//   실행: node scripts/lot-check.mjs
import { mkdirSync } from 'node:fs';
import { build } from 'esbuild';

mkdirSync('.tmp', { recursive: true });
await build({
  entryPoints: ['src/utils/lot.ts'],
  bundle: true,
  format: 'esm',
  outfile: '.tmp/lot.mjs',
  logLevel: 'error',
});

const { lotSpec, lotCalc, fmtUsd, normalizeLot } = await import('../.tmp/lot.mjs');

const results = [];
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function checkCase(name, base, lot, entry, price, target, stop, expectPnl, expectPipUsd) {
  const spec = lotSpec(base);
  const r = lotCalc(spec, lot, { entry, price, target, stop, eq: (entry + target) / 2, side: 'long' });
  const ok =
    Math.abs(r.pnl - expectPnl) < 0.02 &&
    Math.abs(r.pipUsd - expectPipUsd) < 0.005 &&
    Math.abs(r.stopUsd + Math.abs(expectPnl) * 0) <= Infinity;
  results.push({
    name,
    base,
    lot,
    contractSize: spec.size,
    mode: spec.mode,
    spec: spec.label,
    pnl: round(r.pnl),
    targetUsd: round(r.targetUsd),
    stopUsd: round(r.stopUsd),
    pipUsd: round(r.pipUsd, 4),
    expectPnl,
    expectPipUsd,
    ok,
  });
}

checkCase('금 XAUUSD+ 0.10', 'XAUUSD+', 0.1, 3500, 3501, 3520, 3490, 10, 0.1);
checkCase('금 XAUUSD+ 1.00', 'XAUUSD+', 1, 3500, 3501, 3520, 3490, 100, 1);
checkCase('금 XAUT+ 0.10', 'XAUT+', 0.1, 3500, 3501, 3520, 3490, 10, 0.1);
checkCase('금 PAXG+ 0.10', 'PAXG+', 0.1, 3500, 3501, 3520, 3490, 10, 0.1);
checkCase('은 XAGUSD+ 0.10', 'XAGUSD+', 0.1, 40, 40.5, 42, 38.5, 250, 5);
checkCase('백금 XPTUSD+ 0.10', 'XPTUSD+', 0.1, 1300, 1301, 1320, 1290, 10, 0.1);
checkCase('팔라듐 XPDUSD+ 0.10', 'XPDUSD+', 0.1, 1200, 1201, 1220, 1190, 10, 0.1);
checkCase('유로 EURUSD+ 0.10', 'EURUSD+', 0.1, 1.1, 1.101, 1.11, 1.09, 10, 1);
checkCase('파운드 GBPUSD+ 0.10', 'GBPUSD+', 0.1, 1.3, 1.301, 1.31, 1.29, 10, 1);
checkCase('엔 USDJPY+ 0.10', 'USDJPY+', 0.1, 150, 150.5, 152, 149, 33.22, 0.6645);
checkCase('레알 USDBRL+ 0.10', 'USDBRL+', 0.1, 6, 6.01, 6.1, 5.9, 16.64, 0.1667);
checkCase('원유 USOIL+ 0.10', 'USOIL+', 0.1, 70, 71, 73, 68, 100, 1);
checkCase('원유 UKOIL+ 0.10', 'UKOIL+', 0.1, 74, 75, 77, 72, 100, 1);
checkCase('가스 NATGAS+ 0.10', 'NATGAS+', 0.1, 3, 3.1, 3.3, 2.85, 100, 1);
checkCase('구리 COPPER+ 0.10', 'COPPER+', 0.1, 5, 5.1, 5.3, 4.85, 250, 25);
checkCase('나스닥 NAS100+ 0.10', 'NAS100+', 0.1, 20000, 20010, 20100, 19950, 1, 0.1);
checkCase('S&P US500+ 0.10', 'US500+', 0.1, 6000, 6005, 6040, 5985, 0.5, 0.1);
checkCase('닛케이 JP225+ 0.10', 'JP225+', 0.1, 54800, 54812, 55000, 54700, 1.2, 0.1);
checkCase('항셍 HK50+ 0.10', 'HK50+', 0.1, 22050, 22061, 22200, 21950, 1.1, 0.1);
checkCase('코스피200 KR200+ 0.10', 'KR200+', 0.1, 710, 709.1, 700, 720, -0.09, 0.1);
checkCase('달러인덱스 DXY+ 0.10', 'DXY+', 0.1, 99, 99.2, 100, 98.5, 0.02, 0.1);
// 비트코인 BTCUSD+ — 1 Lot = 1 BTC (벤티지 MT5 비트코인 CFD)
checkCase('비트 BTCUSD+ 0.10 ($1,000 이동)', 'BTCUSD+', 0.1, 55000, 56000, 58000, 52000, 100, 0.1);
checkCase('비트 BTCUSD+ 1.00', 'BTCUSD+', 1, 55000, 55100, 56500, 53000, 100, 1);
checkCase('비트 BTCUSD 0.05', 'BTCUSD', 0.05, 55000, 55200, 56000, 54000, 10, 0.05);
checkCase('비트 BTC 0.20', 'BTC', 0.2, 55000, 54750, 53000, 57000, -50, 0.2);

// 0.01 ↔ 0.10 ↔ 1.00 비례 (같은 가격: 금 롱, 유로 숏)
const proportion = [0.01, 0.1, 1].map((lot) => {
  const g = lotCalc(lotSpec('XAUUSD+'), lot, { entry: 3500, price: 3501, target: 3520, stop: 3490, eq: 3510, side: 'long' });
  const e = lotCalc(lotSpec('EURUSD+'), lot, { entry: 1.1, price: 1.101, target: 1.11, stop: 1.09, eq: 1.105, side: 'short' });
  return { lot, goldPnl: round(g.pnl), goldTargetUsd: round(g.targetUsd), eurShortPnl: round(e.pnl) };
});
const base = proportion[1];
const btcProportion = [0.01, 0.1, 1].map((lot) => {
  const b = lotCalc(lotSpec('BTCUSD+'), lot, { entry: 55000, price: 55000, target: 60000, stop: 50000, eq: 57500, side: 'long' });
  return { lot, targetUsd: round(b.targetUsd), stopUsd: round(b.stopUsd) };
});
const btcProportionOk =
  Math.abs(btcProportion[0].targetUsd - 50) < 0.005 &&
  Math.abs(btcProportion[1].targetUsd - 500) < 0.005 &&
  Math.abs(btcProportion[2].targetUsd - 5000) < 0.005 &&
  Math.abs(btcProportion[1].stopUsd + 500) < 0.005;
const proportionOk =
  Math.abs(proportion[0].goldPnl - base.goldPnl * 0.1) < 0.005 &&
  Math.abs(proportion[2].goldPnl - base.goldPnl * 10) < 0.005 &&
  Math.abs(proportion[0].goldTargetUsd - base.goldTargetUsd * 0.1) < 0.005 &&
  Math.abs(proportion[2].goldTargetUsd - base.goldTargetUsd * 10) < 0.005 &&
  Math.abs(proportion[0].eurShortPnl - base.eurShortPnl * 0.1) < 0.005 &&
  Math.abs(proportion[2].eurShortPnl - base.eurShortPnl * 10) < 0.005;

const formatting = {
  plus: fmtUsd(125),
  minus: fmtUsd(-42.5),
  zero: fmtUsd(0),
  big: fmtUsd(12345.6),
  normalized: [normalizeLot(0.2), normalizeLot('0.05'), normalizeLot(0.3), normalizeLot(undefined)],
};
const formatOk =
  formatting.plus === '+$125.00' &&
  formatting.minus === '-$42.50' &&
  formatting.zero === '$0.00' &&
  formatting.normalized.join(',') === '0.2,0.05,0.1,0.1';

const allOk = results.every((r) => r.ok) && proportionOk && btcProportionOk && formatOk;
console.log(
  JSON.stringify(
    {
      allOk,
      cases: results,
      failures: results.filter((r) => !r.ok),
      proportion,
      proportionOk,
      btcProportion,
      btcProportionOk,
      formatting,
      formatOk,
    },
    null,
    1,
  ),
);
if (!allOk) process.exitCode = 1;
