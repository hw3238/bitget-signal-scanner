/**
 * 손절폭 타이트화 검증 — 실제 Bitget 200봉 데이터
 *   · 생성된 모든 시그널의 riskPct(진입가 대비 손절폭 %) 전수 검사
 *   · 타임프레임별 상한(1H/4H) 초과 0건, 목표가·손절가 ≤ 0 0건
 *   · 진행 중(open) 시그널이 정상 포착되는지 확인
 *
 * 실행: npm run check:stops
 */
import { fetchContracts, fetchTickers, fetchCandles } from '../src/api/bitget';
import { pickUniverse } from '../src/engine/universe';
import { analyzeSymbol, STOP_WIDTH, riskPctOf } from '../src/engine/backtest';
import type { Signal, TF } from '../src/engine/types';

const TFS: TF[] = ['1H', '4H'];
const LIMIT = Number(process.env.STOP_CHECK_LIMIT ?? 0);

async function main() {
  const [contracts, tickers] = await Promise.all([fetchContracts(), fetchTickers()]);
  const universe = pickUniverse(contracts, tickers);
  const picks = LIMIT > 0 ? universe.slice(0, LIMIT) : universe;
  console.log(`contracts=${contracts.length} tickers=${tickers.length} universe=${picks.length}`);

  const jobs: { symbol: string; tf: TF }[] = [];
  for (const c of picks) for (const tf of TFS) jobs.push({ symbol: c.symbol, tf });

  const signals: Signal[] = [];
  let scanned = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try {
        const candles = await fetchCandles(job.symbol, job.tf);
        const meta = picks.find((c) => c.symbol === job.symbol)!;
        const analysis = analyzeSymbol(job.symbol, meta.base, meta.asset, job.tf, candles, meta.decimals);
        if (analysis) {
          scanned += 1;
          signals.push(...analysis.signals);
        }
      } catch (e) {
        console.log('FAIL', job.symbol, job.tf, (e as Error).message);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`scanned=${scanned} jobs=${jobs.length} signals=${signals.length}`);

  let failures = 0;
  const fail = (label: string, detail = '') => {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  };
  const pass = (label: string, detail = '') => console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`);

  for (const tf of TFS) {
    const list = signals.filter((s) => s.tf === tf);
    const cap = STOP_WIDTH[tf].max;
    const floor = STOP_WIDTH[tf].min;
    const risks = list.map((s) => riskPctOf(s.entry, s.stop));
    const max = risks.length ? Math.max(...risks) : 0;
    const avg = risks.length ? risks.reduce((a, b) => a + b, 0) / risks.length : 0;
    const sorted = [...risks].sort((a, b) => a - b);
    const p90 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] : 0;
    const over = list.filter((s) => riskPctOf(s.entry, s.stop) > cap + 1e-9);
    const under = list.filter((s) => riskPctOf(s.entry, s.stop) < floor - 1e-9);
    const badLevels = list.filter((s) => !(s.entry > 0 && s.stop > 0 && s.target > 0));
    const nonRR = list.filter((s) => !(s.rr >= 1.5));
    const open = list.filter((s) => s.state === 'open');

    console.log(
      `\n[${tf}] n=${list.length} open=${open.length} riskPct avg=${avg.toFixed(2)}% max=${max.toFixed(2)}% p90=${p90.toFixed(2)}% cap=${cap}% floor=${floor}%`,
    );
    over.length === 0
      ? pass(`${tf} 손절폭 상한 ${cap}% 이하`, `max ${max.toFixed(2)}%`)
      : fail(`${tf} 손절폭 상한 초과 ${over.length}건`, `${max.toFixed(2)}% > ${cap}%`);
    under.length === 0
      ? pass(`${tf} 손절폭 하한 ${floor}% 이상`, `min ${(sorted[0] ?? 0).toFixed(2)}%`)
      : fail(`${tf} 손절폭 하한 미만 ${under.length}건`, `min ${(sorted[0] ?? 0).toFixed(2)}%`);
    badLevels.length === 0
      ? pass(`${tf} 목표가·손절가·진입가 양수`)
      : fail(`${tf} 비정상 가격 ${badLevels.length}건`, badLevels.slice(0, 3).map((s) => `${s.symbol} t=${s.target}`).join(', '));
    nonRR.length === 0 ? pass(`${tf} 손익비 1.5R 이상`) : fail(`${tf} 손익비 미달 ${nonRR.length}건`);
    if (list.length > 0 && open.length === 0) fail(`${tf} 진행 중 시그널 0건`);
    if (list.length > 0) pass(`${tf} 진행 중 시그널 포착`, `${open.length}/${list.length}`);
  }

  // 시그널 목록(손절폭 큰 순)
  console.log('\n손절폭 상위 시그널');
  [...signals]
    .sort((a, b) => riskPctOf(b.entry, b.stop) - riskPctOf(a.entry, a.stop))
    .slice(0, 15)
    .forEach((s) => {
      console.log(
        `${s.symbol.padEnd(12)} ${s.tf} ${s.side.padEnd(5)} ${s.strategyShort.padEnd(10)} risk=${riskPctOf(s.entry, s.stop).toFixed(2)}% rr=${s.rr.toFixed(2)}R ${s.state} bars=${s.barsSince}`,
      );
    });

  console.log('\n전략별 시그널 수');
  const byStrat = new Map<string, number>();
  for (const s of signals) byStrat.set(s.strategyShort, (byStrat.get(s.strategyShort) ?? 0) + 1);
  for (const [k, v] of [...byStrat.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(12)} ${v}`);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
