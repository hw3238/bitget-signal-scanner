import { fetchContracts, fetchTickers, fetchCandles } from '../src/api/bitget';
import { pickUniverse } from '../src/engine/universe';
import { analyzeSymbol, aggregate } from '../src/engine/backtest';
import type { TF, Trade } from '../src/engine/types';
import { STRATEGY_BY_ID } from '../src/engine/types';

const TFS: TF[] = ['1H', '4H'];

async function main() {
  const [contracts, tickers] = await Promise.all([fetchContracts(), fetchTickers()]);
  console.log('contracts', contracts.length, 'tickers', tickers.length);
  const universe = pickUniverse(contracts, tickers);
  console.log('universe', universe.length, universe.map((c) => c.symbol).join(', '));

  const t0 = Date.now();
  const jobs: { symbol: string; tf: TF }[] = [];
  for (const c of universe) for (const tf of TFS) jobs.push({ symbol: c.symbol, tf });

  const results: any[] = [];
  const perStrategyTrades = new Map<string, Trade[]>();
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      try {
        const candles = await fetchCandles(job.symbol, job.tf);
        const meta = universe.find((c) => c.symbol === job.symbol)!;
        const analysis = analyzeSymbol(job.symbol, meta.base, meta.asset, job.tf, candles);
        if (analysis) results.push(analysis);
      } catch (e) {
        console.log('FAIL', job.symbol, job.tf, (e as Error).message);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log(`scanned ${results.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 전략별 집계 (모든 종목 최근 구간)
  for (const id of Object.keys(STRATEGY_BY_ID)) {
    const cand = results.flatMap((r) => r.candidates.filter((c: any) => c.id === id).map((c: any) => c.stats));
    // aggregate of stats is approximate; recompute via trade sums
    const n = cand.reduce((a: number, s: any) => a + s.n, 0);
    const wins = cand.reduce((a: number, s: any) => a + s.wins, 0);
    const totalR = cand.reduce((a: number, s: any) => a + s.totalR, 0);
    const activeCount = results.filter((r) => r.activeStrategyId === id).length;
    console.log(
      `${id.padEnd(20)} n=${String(n).padStart(3)} win=${n ? ((wins / n) * 100).toFixed(1) : '-'}% totalR=${totalR.toFixed(1)} active=${activeCount}`,
    );
  }

  const signals = results.flatMap((r) => r.signals);
  console.log('\nSIGNALS', signals.length);
  const byState = signals.reduce((acc: any, s: any) => ((acc[s.state] = (acc[s.state] ?? 0) + 1), acc), {});
  console.log('states', byState);
  for (const s of signals.slice(0, 24)) {
    console.log(
      `${s.symbol.padEnd(12)} ${s.tf} ${s.asset.padEnd(7)} ${s.side.padEnd(5)} ${s.strategyShort.padEnd(10)} rr=${s.rr.toFixed(2)} state=${s.state} prog=${(s.progress * 100).toFixed(0)}% bars=${s.barsSince} wr=${s.winRate.toFixed(0)}%`,
    );
  }
  const repl = results.filter((r) => r.replacement);
  console.log('\nREPLACEMENTS', repl.length);
  for (const r of repl.slice(0, 12)) {
    console.log(`${r.symbol} ${r.tf}: ${r.replacement!.fromId}(${r.replacement!.fromWinRate.toFixed(1)}%) -> ${r.replacement!.toId}(${r.replacement!.toWinRate.toFixed(1)}%) | ${r.replacement!.reason}`);
  }
  const qualified = results.filter((r) => r.activeWinRate >= 55 && r.activeRR >= 1.5).length;
  console.log(`qualified symbols: ${qualified}/${results.length}`);
  const allTrades = results.flatMap((r) => r.candidates.map((c: any) => c.stats));
  console.log('sample aggregate', aggregate(allTrades.map((s: any) => ({ } as Trade)).slice(0, 0)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
