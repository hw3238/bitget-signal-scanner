import { useMemo } from 'react';
import type { ScanState } from '../hooks/useScanner';
import { BENCH_INFO, STRATEGIES, STRATEGY_BY_ID } from '../engine/types';
import type { SwapLogEntry } from '../lib/storage';
import { fmtAgo, fmtDateTime, fmtPct, fmtRR, tfLabel } from '../lib/format';
import { STOP_WIDTH } from '../engine/risk';
import { BENCH_GATE, MIN_RR, MIN_TRADES, MIN_WINRATE } from '../engine/backtest';
import { RefreshIcon } from './Icons';

interface Props {
  state: ScanState;
  swapLog: SwapLogEntry[];
  leverage: number;
  onRescan: () => void;
  onClearLog: () => void;
}

export function EngineTab({ state, swapLog, leverage, onRescan, onClearLog }: Props) {
  const rows = useMemo(() => {
    return STRATEGIES.map((meta) => {
      // 최근 60봉 실측(마켓별 후보 성적) — 마켓 채택 여부와 무관하게 그 기법이 낸 표본 전부
      const cands = state.analyses
        .flatMap((a) => a.candidates.filter((c) => c.id === meta.id).map((c) => c.stats))
        .filter((s) => s.n > 0);
      const n = cands.reduce((a, s) => a + s.n, 0);
      const wins = cands.reduce((a, s) => a + s.wins, 0);
      const move = cands.reduce((a, s) => a + s.movePct, 0);
      const winRS = cands.reduce((a, s) => a + s.avgWinR * s.wins, 0);

      const mine = state.analyses.filter((a) => a.signals.some((s) => s.strategyId === meta.id));
      const signals = mine.reduce((acc, a) => acc + a.signals.filter((s) => s.strategyId === meta.id).length, 0);
      const open = mine.reduce(
        (acc, a) => acc + a.signals.filter((s) => s.strategyId === meta.id && s.state === 'open').length,
        0,
      );

      return {
        meta,
        markets: mine.length,
        signals,
        open,
        recentN: n,
        recentWinRate: n ? (wins / n) * 100 : 0,
        recentRR: wins ? winRS / wins : 0,
        recentLevRoi: move * leverage,
        expectancyRoi: n ? (move / n) * leverage : 0,
        priority: meta.bench.exp * meta.bench.winRate,
      };
    }).sort((a, b) => {
      if (b.markets !== a.markets) return b.markets - a.markets;
      if (b.open !== a.open) return b.open - a.open;
      return b.priority - a.priority;
    });
  }, [state.analyses, leverage]);

  const totalAdopted = state.analyses.filter((a) => a.signals.length > 0).length;
  const openTotal = state.analyses.reduce((acc, a) => acc + a.signals.filter((s) => s.state === 'open').length, 0);
  const leader = rows[0];
  const recentSwaps = swapLog.slice(0, 14);

  return (
    <div className="tab engine-tab">
      <section className="hero-engine">
        <div className="hero-copy">
          <span className="eyebrow">적응형 전략 엔진</span>
          <h2>
            전수 검증 <em>기대값 × 승률</em>이 높은 기법에 먼저 자리를 내줍니다
          </h2>
          <p>
            {STRATEGIES.length}개 매매법을 스캔한 모든 마켓의 실제 200봉 캔들에 실시간 백테스트합니다. 마켓에서 최근 60봉
            표본 {MIN_TRADES}건 이상으로 승률 {MIN_WINRATE}%를 넘긴 기법은 즉시 채택하고, 표본이 모자라도 전수 검증에서
            승률 {BENCH_GATE.minWinRate}% · 기대값 {BENCH_GATE.minExp}R를 넘긴 기법은 마켓에 반증(연속 손실)이 없으면
            채택합니다. 고빈도라는 이유만으로 저승률 기법이 고승률 기법을 밀어내지 못합니다.
          </p>
          <p className="hero-tight">
            지금 실린 매매법은 상위 트레이더 기법을 실제 비트겟 {BENCH_INFO.universe}에 전수 백테스트해
            승률·기대값이 검증된 것만 남긴 것입니다({BENCH_INFO.at} · {BENCH_INFO.fee}).
          </p>
          <p className="hero-tight">
            손절은 스윙·오더블록·FVG 경계에 붙인 정밀 타점 기준 — 손절폭이 {STOP_WIDTH['1H'].max}%(1H)·{' '}
            {STOP_WIDTH['4H'].max}%(4H)를 넘는 시그널은 생성하지 않습니다.
          </p>
          <div className="hero-stats">
            <div>
              <b>{state.analyses.length}</b>
              <span>분석 마켓</span>
            </div>
            <div>
              <b>{totalAdopted}</b>
              <span>시그널 마켓</span>
            </div>
            <div>
              <b>{openTotal}</b>
              <span>진행 중</span>
            </div>
            <div>
              <b>{leader ? `${leader.meta.bench.winRate.toFixed(0)}%` : '-'}</b>
              <span>1위 전수 승률</span>
            </div>
          </div>
        </div>
        {leader && (
          <div className="hero-top card-dark">
            <span className="hero-top-badge">현재 1위 전략</span>
            <div className="hero-top-name">{leader.meta.name}</div>
            <div className="hero-top-stars">{'★'.repeat(leader.meta.star)}</div>
            <div className="hero-top-grid">
              <div>
                <span>시그널 마켓</span>
                <b>{leader.markets}</b>
              </div>
              <div>
                <span>전수 승률</span>
                <b className="up">{leader.meta.bench.winRate.toFixed(1)}%</b>
              </div>
              <div>
                <span>전수 기대값</span>
                <b>{fmtRR(leader.meta.bench.exp, 2)}</b>
              </div>
              <div>
                <span>기대 수익 ({leverage}배)</span>
                <b className={leader.expectancyRoi >= 0 ? 'up' : 'down'}>
                  {leader.recentN ? fmtPct(leader.expectancyRoi) : '-'}
                </b>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>매매법 실시간 순위</h3>
          <button className="ghost-btn" onClick={onRescan} disabled={state.status === 'scanning'}>
            <RefreshIcon size={15} /> 백테스트 재실행
          </button>
        </header>
        <ul className="strat-list">
          {rows.map((r, i) => (
            <li key={r.meta.id} className={`strat-row ${r.markets === 0 ? 'dim' : ''}`}>
              <div className="strat-rank">{i + 1}</div>
              <div className="strat-main">
                <div className="strat-title">
                  <b>{r.meta.name}</b>
                  <span className="strat-stars">{'★'.repeat(r.meta.star)}</span>
                  <span className={`pill ${r.markets ? 'good' : ''}`}>
                    시그널 {r.signals}
                    {r.open ? ` · 진행 ${r.open}` : ''}
                  </span>
                </div>
                <div className="strat-desc">{r.meta.desc}</div>
                <div className="strat-bench">
                  <span className="bench-tag">전수 검증</span>
                  <b className={r.meta.bench.exp > 0 ? 'up' : 'down'}>승률 {r.meta.bench.winRate.toFixed(1)}%</b>
                  <span>
                    1H {r.meta.bench.byTf['1H'].toFixed(1)}% · 4H {r.meta.bench.byTf['4H'].toFixed(1)}% · 1건 기대값{' '}
                    {r.meta.bench.exp > 0 ? '+' : ''}
                    {r.meta.bench.exp.toFixed(2)}R · PF {r.meta.bench.pf.toFixed(2)} · 표본 {r.meta.bench.n}건
                  </span>
                  <span className="bench-origin">{r.meta.origin}</span>
                </div>
                <div className="strat-metrics">
                  <span>
                    <i>최근 60봉 승률</i>
                    <b className={r.recentWinRate >= MIN_WINRATE ? 'up' : ''}>
                      {r.recentN ? `${r.recentWinRate.toFixed(1)}%` : '-'}
                    </b>
                  </span>
                  <span>
                    <i>최근 표본</i>
                    <b>{r.recentN || '-'}</b>
                  </span>
                  <span>
                    <i>최근 손익비</i>
                    <b>{r.recentRR ? fmtRR(r.recentRR, 2) : '-'}</b>
                  </span>
                  <span>
                    <i>기대 수익 {leverage}배</i>
                    <b className={r.expectancyRoi >= 0 ? 'up' : 'down'}>
                      {r.recentN ? fmtPct(r.expectancyRoi) : '-'}
                    </b>
                  </span>
                  <span>
                    <i>전수 승률</i>
                    <b className="muted">{r.meta.bench.winRate.toFixed(1)}%</b>
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="table-note">
          <b>전수 검증</b>은 {BENCH_INFO.at} 실제 비트겟 {BENCH_INFO.universe} 전수 백테스트 성적입니다
          ({BENCH_INFO.fee}). 채택 규칙은 두 층입니다 — ① 마켓 최근 60봉에서 표본 {MIN_TRADES}건 이상 ·
          승률 {MIN_WINRATE}% · 손익비 {MIN_RR}R을 넘으면 <b>마켓 실측</b>으로 채택, ② 표본이 모자라도 전수
          승률 {BENCH_GATE.minWinRate}% · 기대값 {BENCH_GATE.minExp}R를 넘은 기법은 마켓에 반증(연속 손실·승률
          33% 이하)이 없으면 <b>전수 검증</b>으로 채택합니다. 같은 마켓에서 진행 중 신호는 기대값 × 승률 순위가
          높은 전략 1건만 노출하고, 손절폭 상한 {STOP_WIDTH['1H'].max}%(1H) · {STOP_WIDTH['4H'].max}%(4H)를 넘는
          넓은 손절폭 셋업은 시그널·백테스트 집계에서 모두 제외됩니다. 기대 수익 {leverage}배는 1건당 손절가까지
          거리 대비 R배수를 레버리지로 환산한 값입니다.
        </p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>
            자동 교체 로그 <span className="count-badge">{swapLog.length}</span>
          </h3>
          {swapLog.length > 0 && (
            <button className="ghost-btn" onClick={onClearLog}>
              기록 지우기
            </button>
          )}
        </header>
        <ul className="swap-list">
          {recentSwaps.map((s, i) => (
            <li key={`${s.symbol}-${s.tf}-${s.fromId}-${s.toId}-${i}`}>
              <div className="swap-time">
                <b>{fmtDateTime(s.at)}</b>
                <span>{fmtAgo(s.at)}</span>
              </div>
              <div className="swap-body">
                <div className="swap-line">
                  <span className="swap-sym">
                    {s.base} <i>{tfLabel(s.tf)}</i>
                  </span>
                  <span className="swap-path">
                    <span className="from">{STRATEGY_BY_ID[s.fromId]?.short ?? s.fromId}</span>
                    <span className="arrow">→</span>
                    <span className="to">{STRATEGY_BY_ID[s.toId]?.short ?? s.toId}</span>
                  </span>
                </div>
                <div className="swap-reason">{s.reason}</div>
              </div>
              <div className="swap-metrics">
                <span className="from">{s.fromWinRate.toFixed(0)}%</span>
                <span className="arrow">→</span>
                <span className="to">{s.toWinRate.toFixed(0)}%</span>
              </div>
            </li>
          ))}
          {recentSwaps.length === 0 && <li className="swap-empty">아직 교체 기록이 없습니다.</li>}
        </ul>
      </section>
    </div>
  );
}
