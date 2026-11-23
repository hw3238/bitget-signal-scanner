/**
 * COTA 전략 토너먼트 — 실제 Bitget USDT-M 캔들 전수 백테스트
 *
 *  · 기존 전략 6종 + 상위 트레이더 기법 후보 5종을 **같은 캔들·같은 손절 규칙**으로 채점한다.
 *  · 테이커 왕복 수수료(0.06% × 2 = 0.12%)를 R 단위로 차감한 기대값을 본다.
 *  · 앞 절반(IS) / 뒤 절반(OOS)을 나눠 특정 장세에만 맞은 기법을 걸러 낸다.
 *  · `--engine` 을 주면 앱과 동일하게 200봉·최근 60봉 채점으로 진행 중 시그널 수·채택 분포를 센다.
 *
 *  실행:
 *    npm run bench:strategies -- --top=100 --refresh
 *    npm run bench:strategies -- --engine
 */
import { fetchCandles, fetchContracts, fetchTickers } from '../src/api/bitget';
import { buildSeries } from '../src/engine/indicators';
import { aggregate, analyzeSymbol, BENCH_GATE, HORIZON, type GateOptions, MIN_TRADES, MIN_RR, MIN_WINRATE, resolveTrade, RECENT_BARS } from '../src/engine/backtest';
import { DETECTORS } from '../src/engine/strategies';
import { LAB_STRATEGIES } from '../src/engine/strategyLab';
import { STRATEGIES } from '../src/engine/types';
import type { Candle, TF } from '../src/engine/types';
import { validateSetup } from '../src/engine/risk';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

/** 비트겟 테이커 수수료 0.06% × 진입·청산 = 0.12% (R 차감) */
const FEE_ROUND_TRIP_PCT = 0.12;
const TF_LIST: TF[] = ['1H', '4H'];
const BARS = 500;

interface Row {
  n: number;
  wins: number;
  losses: number;
  opens: number;
  winRate: number;
  avgWinR: number;
  /** 수수료 차감 후 1건당 기대값(R) */
  exp: number;
  /** 수수료 차감 전 기대값(R) */
  grossExp: number;
  pf: number;
  /** 1건당 평균 수수료 비용(R) */
  feeR: number;
  totalR: number;
  avgRiskPct: number;
}

const emptyRow = (): Row => ({
  n: 0,
  wins: 0,
  losses: 0,
  opens: 0,
  winRate: 0,
  avgWinR: 0,
  exp: 0,
  grossExp: 0,
  pf: 0,
  feeR: 0,
  totalR: 0,
  avgRiskPct: 0,
});

function summarize(trades: ReturnType<typeof resolveTrade>[]): Row {
  let wins = 0;
  let losses = 0;
  let opens = 0;
  let netSum = 0;
  let grossSum = 0;
  let winNetSum = 0;
  let lossNetSum = 0;
  let winRSum = 0;
  let feeSum = 0;
  let riskSum = 0;
  for (const t of trades) {
    const riskPct = (Math.abs(t.entry - t.stop) / t.entry) * 100;
    riskSum += riskPct;
    const feeR = riskPct > 0 ? FEE_ROUND_TRIP_PCT / riskPct : 0;
    feeSum += feeR;
    if (t.result === 'open') {
      opens += 1;
      continue;
    }
    const net = t.rResult > 0 ? t.rResult - feeR : -1 - feeR;
    grossSum += t.rResult;
    netSum += net;
    if (t.rResult > 0) {
      wins += 1;
      winRSum += t.rResult;
      winNetSum += net;
    } else {
      losses += 1;
      lossNetSum += net;
    }
  }
  const n = wins + losses;
  const closed = trades.length;
  return {
    n,
    wins,
    losses,
    opens,
    winRate: n ? (wins / n) * 100 : 0,
    avgWinR: wins ? winRSum / wins : 0,
    exp: n ? netSum / n : 0,
    grossExp: n ? grossSum / n : 0,
    pf: lossNetSum < 0 ? winNetSum / Math.abs(lossNetSum) : winNetSum > 0 ? Infinity : 0,
    feeR: closed ? feeSum / closed : 0,
    totalR: netSum,
    avgRiskPct: trades.length ? riskSum / trades.length : 0,
  };
}

interface MarketData {
  symbol: string;
  base: string;
  vol: number;
  candles: Record<TF, Candle[]>;
}

function cachePath() {
  return '.tmp/tournament-candles.json';
}

async function loadUniverse(top: number, refresh: boolean): Promise<MarketData[]> {
  const path = cachePath();
  if (!refresh && existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as { at: number; markets: MarketData[] };
    console.log(`캐시 사용: ${cached.markets.length}개 마켓 (${new Date(cached.at).toISOString()})`);
    return cached.markets;
  }

  const contracts = (await fetchContracts()).filter((c) => c.asset === 'crypto');
  const tickers = await fetchTickers();
  const vol = new Map(tickers.map((t) => [t.symbol, t.quoteVolume]));
  const ranked = [...contracts].sort((a, b) => (vol.get(b.symbol) ?? 0) - (vol.get(a.symbol) ?? 0));
  const picked = ranked.slice(0, top);
  // 주력 3종은 항상 포함
  for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) {
    const c = contracts.find((x) => x.symbol === sym);
    if (c && !picked.some((p) => p.symbol === sym)) picked.unshift(c);
  }
  console.log(`유니버스: ${picked.length}개 코인 마켓 × ${TF_LIST.length} 타임프레임 × ${BARS}봉`);

  const markets: MarketData[] = [];
  const queue: { symbol: string; base: string; v: number }[] = picked.map((c) => ({
    symbol: c.symbol,
    base: c.base,
    v: vol.get(c.symbol) ?? 0,
  }));
  let cursor = 0;
  let done = 0;
  const workers = Array.from({ length: 5 }, async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= queue.length) return;
      const q = queue[idx];
      try {
        const candles: Record<TF, Candle[]> = { '1H': [], '4H': [] };
        for (const tf of TF_LIST) candles[tf] = await fetchCandles(q.symbol, tf, BARS);
        if (candles['1H'].length >= 300 && candles['4H'].length >= 300) {
          markets.push({ symbol: q.symbol, base: q.base, vol: q.v, candles });
        }
      } catch (err) {
        console.warn(`  ! ${q.symbol} 캔들 실패: ${(err as Error).message}`);
      }
      done += 1;
      if (done % 20 === 0) console.log(`  캔들 ${done}/${queue.length}`);
    }
  });
  await Promise.all(workers);

  mkdirSync('.tmp', { recursive: true });
  writeFileSync(path, JSON.stringify({ at: Date.now(), markets }));
  console.log(`캐시 저장: ${markets.length}개 마켓 → ${path}`);
  return markets;
}

type Detector = (c: Candle[], s: ReturnType<typeof buildSeries>, i: number, tf: TF) => ReturnType<typeof DETECTORS[string]>;

interface Bench {
  id: string;
  name: string;
  warmup: number;
  detect: Detector;
}

function benches(): Bench[] {
  const existing: Bench[] = STRATEGIES.map((m) => ({
    id: m.id,
    name: m.name,
    warmup: m.warmup,
    detect: DETECTORS[m.id],
  }));
  const lab: Bench[] = LAB_STRATEGIES.map((l) => ({
    id: l.id,
    name: l.name,
    warmup: l.warmup,
    detect: l.detect as unknown as Detector,
  }));
  return [...existing, ...lab];
}

interface StrategyReport {
  id: string;
  name: string;
  all: Row;
  byTf: Record<string, Row>;
  is: Row;
  oos: Row;
  byMarket: { symbol: string; row: Row }[];
}

function benchStrategy(markets: MarketData[], b: Bench): StrategyReport {
  const all: ReturnType<typeof resolveTrade>[] = [];
  const byTfTrades: Record<string, ReturnType<typeof resolveTrade>[]> = { '1H': [], '4H': [] };
  const isTrades: ReturnType<typeof resolveTrade>[] = [];
  const oosTrades: ReturnType<typeof resolveTrade>[] = [];
  const byMarket: { symbol: string; row: Row }[] = [];

  for (const m of markets) {
    for (const tf of TF_LIST) {
      const candles = m.candles[tf];
      if (!candles || candles.length < 120) continue;
      const series = buildSeries(candles);
      const last = candles.length - 1;
      const mid = Math.floor((b.warmup + last) / 2);
      const trades: ReturnType<typeof resolveTrade>[] = [];
      let blockedUntil = -1;
      try {
        for (let i = Math.max(b.warmup, 21); i <= last; i++) {
          if (i <= blockedUntil) continue;
          const raw = b.detect(candles, series, i, tf);
          if (!raw) continue;
          const setup = validateSetup(raw, tf);
          if (!setup) continue;
          const trade = resolveTrade(candles, i, setup.side, setup.entry, setup.stop, setup.target, setup.tags);
          trades.push(trade);
          blockedUntil = trade.exitIdx ?? i + HORIZON;
          all.push(trade);
          byTfTrades[tf].push(trade);
          (i <= mid ? isTrades : oosTrades).push(trade);
        }
      } catch (err) {
        console.warn(`  ! ${b.id} ${m.symbol} ${tf} 오류: ${(err as Error).message}`);
      }
      if (trades.length) byMarket.push({ symbol: `${m.base}·${tf}`, row: summarize(trades) });
    }
  }

  return {
    id: b.id,
    name: b.name,
    all: summarize(all),
    byTf: { '1H': summarize(byTfTrades['1H']), '4H': summarize(byTfTrades['4H']) },
    is: summarize(isTrades),
    oos: summarize(oosTrades),
    byMarket,
  };
}

/** 목표가를 고정 R 배수로 다시 잡는 변형 — 승률·기대값 트레이드오프를 측정한다. */
function withTarget(b: Bench, mult: number): Bench {
  return {
    ...b,
    id: `${b.id}@${mult}R`,
    detect: (candles, s, i, tf) => {
      const raw = b.detect(candles, s, i, tf);
      if (!raw) return null;
      const risk = Math.abs(raw.entry - raw.stop);
      if (!(risk > 0)) return null;
      const target = raw.side === 'long' ? raw.entry + mult * risk : raw.entry - mult * risk;
      return { ...raw, target };
    },
  };
}

/** HTF(EMA200) 추세 동조 필터 변형 — 추세 반대 신호를 버린다. */
function withRegime(b: Bench): Bench {
  return {
    ...b,
    id: `${b.id}+HTF`,
    detect: (candles, s, i, tf) => {
      const raw = b.detect(candles, s, i, tf);
      if (!raw) return null;
      const e200 = s.ema200[i];
      const e200prev = s.ema200[i - 8];
      if (!Number.isFinite(e200) || !Number.isFinite(e200prev)) return null;
      const close = candles[i].c;
      const up = close > e200 && e200 > e200prev;
      const down = close < e200 && e200 < e200prev;
      if (raw.side === 'long' && !up) return null;
      if (raw.side === 'short' && !down) return null;
      return raw;
    },
  };
}

/** 거래량 스파이크 확인 필터 변형 */
function withVolume(b: Bench): Bench {
  return {
    ...b,
    id: `${b.id}+Vol`,
    detect: (candles, s, i, tf) => {
      const raw = b.detect(candles, s, i, tf);
      if (!raw) return null;
      const volMa = s.volMa20[i];
      if (!Number.isFinite(volMa) || volMa <= 0) return null;
      if (candles[i].v < volMa * 1.2) return null;
      return raw;
    },
  };
}

function gatePhase(markets: MarketData[]) {
  const configs: { label: string; gate: GateOptions }[] = [
    { label: '현재: 승률55·RR1.5·n≥2', gate: { minTrades: 2, minWinRate: 55, minRR: 1.5, minExpectancy: 0 } },
    { label: '승률55·n≥3', gate: { minTrades: 3, minWinRate: 55, minRR: 1.5, minExpectancy: 0 } },
    { label: '승률55·n≥4', gate: { minTrades: 4, minWinRate: 55, minRR: 1.5, minExpectancy: 0 } },
    { label: '승률60·n≥3', gate: { minTrades: 3, minWinRate: 60, minRR: 1.5, minExpectancy: 0 } },
    { label: '승률50·n≥2', gate: { minTrades: 2, minWinRate: 50, minRR: 1.5, minExpectancy: 0 } },
    { label: '승률50·n≥3', gate: { minTrades: 3, minWinRate: 50, minRR: 1.5, minExpectancy: 0 } },
    { label: '승률45·n≥2', gate: { minTrades: 2, minWinRate: 45, minRR: 1.5, minExpectancy: 0 } },
    { label: '승률45·n≥3', gate: { minTrades: 3, minWinRate: 45, minRR: 1.5, minExpectancy: 0 } },
    { label: '기대값0.1·n≥2', gate: { minTrades: 2, minWinRate: 0, minRR: 1.5, minExpectancy: 0.1 } },
    { label: '기대값0.05·n≥3', gate: { minTrades: 3, minWinRate: 0, minRR: 1.5, minExpectancy: 0.05 } },
    { label: '승률45+기대값0.05·n≥2', gate: { minTrades: 2, minWinRate: 45, minRR: 1.5, minExpectancy: 0.05 } },
    { label: '승륈40+기대값0·n≥2', gate: { minTrades: 2, minWinRate: 40, minRR: 1.5, minExpectancy: 0 } },
  ];
  console.log('\n=== 채택 게이트별 실제 시그널 성과 (200봉 · 최근 60봉 채점) ===');
  console.log('| 게이트 | 진행중 | 종료 | 실현 승률 | 실현 기대값(수수료후) | 채택 마켓 |');
  console.log('|---|---|---|---|---|---|');
  for (const cfg of configs) {
    let open = 0;
    let closed = 0;
    let wins = 0;
    let expSum = 0;
    let adopted = 0;
    for (const m of markets) {
      for (const tf of TF_LIST) {
        const candles = m.candles[tf].slice(-200);
        if (candles.length < 120) continue;
        const a = analyzeSymbol(m.symbol, m.base, 'crypto', tf, candles, undefined, cfg.gate);
        if (!a) continue;
        adopted += 1;
        for (const s of a.signals) {
          if (s.state === 'open') {
            open += 1;
            continue;
          }
          const riskPct = (Math.abs(s.entry - s.stop) / s.entry) * 100;
          const feeR = riskPct > 0 ? FEE_ROUND_TRIP_PCT / riskPct : 0;
          const net = s.currentR > 0 ? s.currentR - feeR : -1 - feeR;
          closed += 1;
          expSum += net;
          if (s.state === 'win') wins += 1;
        }
      }
    }
    console.log(
      `| ${cfg.label} | ${open} | ${closed} | ${closed ? ((wins / closed) * 100).toFixed(1) : '0'}% | ${closed ? (expSum / closed).toFixed(3) : '0'}R | ${adopted} |`,
    );
  }
}

function gridPhase(markets: MarketData[]) {
  const bases = benches();
  const targetMults = [1.5, 1.55, 1.7, 1.8, 2.0, 2.2, 2.4];
  const results: { label: string; row: Row; is: Row; oos: Row; tf1h: Row; tf4h: Row }[] = [];
  for (const base of bases) {
    for (const mult of targetMults) {
      for (const regime of [false, true]) {
        for (const vol of [false, true]) {
          let v = withTarget(base, mult);
          if (regime) v = withRegime(v);
          if (vol) v = withVolume(v);
          const r = benchStrategy(markets, v);
          if (r.all.n < 40) continue;
          results.push({
            label: `${base.id} ${mult}R${regime ? '+HTF' : ''}${vol ? '+Vol' : ''}`,
            row: r.all,
            is: r.is,
            oos: r.oos,
            tf1h: r.byTf['1H'],
            tf4h: r.byTf['4H'],
          });
        }
      }
    }
  }
  const sorted = results.sort((a, b) => b.row.exp - a.row.exp);
  console.log('\n=== 변형 그리드 상위 25 (표본 40건+) ===');
  console.log('| 변형 | 표본 | 승률 | 기대값 | PF | IS | OOS | OOS기대 | 1H | 4H |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of sorted.slice(0, 25)) {
    console.log(
      `| ${r.label} | ${r.row.n} | ${pct(r.row.winRate)} | ${fmt(r.row.exp, 3)}R | ${fmt(r.row.pf)} | ${pct(r.is.winRate)} | ${pct(r.oos.winRate)} (${r.oos.n}) | ${fmt(r.oos.exp, 3)}R | ${pct(r.tf1h.winRate)} (${r.tf1h.n}) | ${pct(r.tf4h.winRate)} (${r.tf4h.n}) |`,
    );
  }
  // 승률 우선 정렬 (기대값 > 0 조건)
  const byWin = results.filter((r) => r.row.exp > 0.05 && r.oos.exp > 0).sort((a, b) => b.row.winRate - a.row.winRate);
  console.log('\n=== 승률 우선 상위 15 (기대값 > +0.05R & OOS 기대값 > 0) ===');
  for (const r of byWin.slice(0, 15)) {
    console.log(
      `  ${r.label.padEnd(34)} 표본 ${String(r.row.n).padStart(4)} · 승률 ${pct(r.row.winRate).padStart(6)} · 기대 ${fmt(r.row.exp, 3)}R · OOS ${pct(r.oos.winRate).padStart(6)}/${fmt(r.oos.exp, 3)}R`,
    );
  }
  writeFileSync('.tmp/strategy-grid.json', JSON.stringify({ at: Date.now(), results: sorted }, null, 1));
  console.log('\n저장: .tmp/strategy-grid.json');
}

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '∞');
const pct = (v: number) => `${v.toFixed(1)}%`;

function markdown(reports: StrategyReport[]): string {
  const lines: string[] = [];
  lines.push('| 전략 | 표본 | 승률 | 평균 익절R | 기대값(순) | PF | IS 승률 | OOS 승률 | OOS 기대값 | 1H 승률 | 4H 승률 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of reports) {
    lines.push(
      `| ${r.name} | ${r.all.n} | ${pct(r.all.winRate)} | ${fmt(r.all.avgWinR)}R | ${fmt(r.all.exp, 3)}R | ${fmt(r.all.pf)} | ${pct(r.is.winRate)} (${r.is.n}) | ${pct(r.oos.winRate)} (${r.oos.n}) | ${fmt(r.oos.exp, 3)}R | ${pct(r.byTf['1H'].winRate)} (${r.byTf['1H'].n}) | ${pct(r.byTf['4H'].winRate)} (${r.byTf['4H'].n}) |`,
    );
  }
  return lines.join('\n');
}

function enginePhase(markets: MarketData[]) {
  // 앱과 동일: 200봉 · 최근 60봉 채점 · 손절폭 상한 규칙
  const openByStrategy = new Map<string, number>();
  const closedByStrategy = new Map<string, number>();
  const adoptedByStrategy = new Map<string, number>();
  const adoptedByBasis = new Map<string, number>();
  const marketsWithSignal = new Set<string>();
  const candidateAgg = new Map<string, { n: number; wins: number }>();
  let open = 0;
  let closed = 0;
  for (const m of markets) {
    for (const tf of TF_LIST) {
      const full = m.candles[tf];
      const candles = full.slice(-200);
      if (candles.length < 120) continue;
      const a = analyzeSymbol(m.symbol, m.base, 'crypto', tf, candles);
      if (!a) continue;
      if (a.activeStrategyId) adoptedByStrategy.set(a.activeStrategyId, (adoptedByStrategy.get(a.activeStrategyId) ?? 0) + 1);
      if (a.activeBasis !== 'none') adoptedByBasis.set(a.activeBasis, (adoptedByBasis.get(a.activeBasis) ?? 0) + 1);
      if (a.signals.length) marketsWithSignal.add(`${a.symbol}-${tf}`);
      for (const cand of a.candidates) {
        const cur = candidateAgg.get(cand.id) ?? { n: 0, wins: 0 };
        cur.n += cand.stats.n;
        cur.wins += cand.stats.wins;
        candidateAgg.set(cand.id, cur);
      }
      for (const s of a.signals) {
        if (s.state === 'open') {
          open += 1;
          openByStrategy.set(s.strategyId, (openByStrategy.get(s.strategyId) ?? 0) + 1);
        } else {
          closed += 1;
          closedByStrategy.set(s.strategyId, (closedByStrategy.get(s.strategyId) ?? 0) + 1);
        }
      }
    }
  }
  console.log('\n=== 앱 엔진 시뮬레이션 (200봉 · 최근 60봉) ===');
  console.log(`진행 중 시그널 ${open}건 · 종료 시그널 ${closed}건 · 신호 마켓 ${marketsWithSignal.size}개 · 분석 마켓 ${markets.length * 2}개`);
  console.log(
    `  채택 근거 — 마켓 실측 ${adoptedByBasis.get('market') ?? 0} · 전수 검증 ${adoptedByBasis.get('bench') ?? 0} (기준: 전수 승률 ${BENCH_GATE.minWinRate}% · 기대값 ${BENCH_GATE.minExp}R · 표본 ${BENCH_GATE.minN}건)`,
  );
  for (const meta of STRATEGIES) {
    console.log(
      `  ${meta.short.padEnd(14)} 채택 ${String(adoptedByStrategy.get(meta.id) ?? 0).padStart(3)} 마켓 · 진행 ${String(openByStrategy.get(meta.id) ?? 0).padStart(3)} · 종료 ${String(closedByStrategy.get(meta.id) ?? 0).padStart(3)}`,
    );
  }
  const candRows = [...candidateAgg.entries()]
    .map(([id, v]) => ({ id, ...v, wr: v.n ? (v.wins / v.n) * 100 : 0 }))
    .sort((x, y) => y.wr - x.wr);
  console.log('  — 후보별 최근 60봉 합산 승률(모든 마켓):');
  for (const c of candRows) console.log(`    ${c.id.padEnd(16)} ${pct(c.wr)} (${c.n}건)`);
  return {
    open,
    closed,
    adopted: Object.fromEntries(adoptedByStrategy),
    adoptedByBasis: Object.fromEntries(adoptedByBasis),
    marketsWithSignal: marketsWithSignal.size,
    openByStrategy: Object.fromEntries(openByStrategy),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const topArg = args.find((a) => a.startsWith('--top='));
  const top = topArg ? Number(topArg.split('=')[1]) : 100;
  const refresh = args.includes('--refresh');
  const engine = args.includes('--engine');
  const benchOnly = args.includes('--bench-only');

  const markets = await loadUniverse(top, refresh);
  if (!markets.length) {
    console.error('마켓 데이터 없음');
    process.exit(1);
  }

  let engineSummary: unknown = null;
  if (engine) engineSummary = enginePhase(markets);
  if (benchOnly) {
    writeFileSync('.tmp/tournament-engine.json', JSON.stringify({ at: Date.now(), engineSummary }, null, 1));
    return;
  }
  if (args.includes('--grid')) {
    gridPhase(markets);
    return;
  }
  if (args.includes('--gates')) {
    gatePhase(markets);
    return;
  }

  const list = benches();
  const reports: StrategyReport[] = [];
  for (const b of list) {
    const t0 = Date.now();
    const r = benchStrategy(markets, b);
    reports.push(r);
    console.log(
      `${b.id.padEnd(18)} n=${String(r.all.n).padStart(4)} 승률 ${pct(r.all.winRate).padStart(6)} · 기대 ${fmt(r.all.exp, 3).padStart(6)}R · PF ${fmt(r.all.pf).padStart(5)} · OOS ${pct(r.oos.winRate).padStart(6)}/${fmt(r.oos.exp, 3)}R (${Date.now() - t0}ms)`,
    );
  }

  const sorted = [...reports].sort((a, b) => b.all.exp - a.all.exp);
  console.log('\n=== 전략별 성적표 (수수료 0.12% 왕복 차감) ===');
  console.log(markdown(sorted));

  const out = {
    at: Date.now(),
    universe: markets.map((m) => m.symbol),
    feeRoundTripPct: FEE_ROUND_TRIP_PCT,
    bars: BARS,
    reports: sorted,
    engineSummary,
  };
  mkdirSync('.tmp', { recursive: true });
  writeFileSync('.tmp/strategy-tournament.json', JSON.stringify(out, null, 1));
  writeFileSync('.tmp/strategy-tournament.md', markdown(sorted));
  console.log('\n저장: .tmp/strategy-tournament.json · .tmp/strategy-tournament.md');
  const minN = MIN_TRADES;
  const gates = sorted.filter((r) => r.all.n >= 20 && r.oos.n >= 8);
  console.log(
    `\n채택 후보(표본 20건+ & OOS 8건+): ${gates.map((g) => g.id).join(', ') || '없음'} — 앱 기준 승률 ${MIN_WINRATE}% · 손익비 ${MIN_RR}R · 최근 ${RECENT_BARS}봉 채점(min ${minN}건) · 전수 채택 ${BENCH_GATE.minWinRate}%/${BENCH_GATE.minExp}R`,
  );
  void aggregate;
}

void main();
