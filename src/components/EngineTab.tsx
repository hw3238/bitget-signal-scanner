import { useMemo } from 'react';
import type { ScanState } from '../hooks/useScanner';
import { BENCH_INFO, STRATEGIES, STRATEGY_BY_ID } from '../engine/types';
import type { SwapLogEntry } from '../lib/storage';
import { fmtAgo, fmtDateTime, fmtPct, fmtRR, tfLabel } from '../lib/format';
import { STOP_WIDTH } from '../engine/risk';
import { MIN_WINRATE } from '../engine/backtest';
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
      const cands = state.analyses
        .flatMap((a) => a.candidates.filter((c) => c.id === meta.id).map((c) => c.stats))
        .filter((s) => s.n > 0);
      const allN = cands.reduce((a, s) => a + s.n, 0);
      const allWins = cands.reduce((a, s) => a + s.wins, 0);
      const allMove = cands.reduce((a, s) => a + s.movePct, 0);
      const allWinRS = cands.reduce((a, s) => a + s.avgWinR * s.wins, 0);

      const adopted = state.analyses.filter((a) => a.activeStrategyId === meta.id && a.activeWinRate >= 55);
      const adoptedStats = adopted.map((a) => a.activeStats).filter((s) => s.n > 0);
      const adoptedN = adoptedStats.reduce((a, s) => a + s.n, 0);
      const adoptedWins = adoptedStats.reduce((a, s) => a + s.wins, 0);
      const adoptedMove = adoptedStats.reduce((a, s) => a + s.movePct, 0);
      const adoptedWinRS = adoptedStats.reduce((a, s) => a + s.avgWinR * s.wins, 0);

      return {
        meta,
        markets: adopted.length,
        adoptedN,
        adoptedWinRate: adoptedN ? (adoptedWins / adoptedN) * 100 : 0,
        adoptedRR: adoptedWins ? adoptedWinRS / adoptedWins : 0,
        adoptedLevRoi: adoptedMove * leverage,
        expectancyRoi: adoptedN ? (adoptedMove / adoptedN) * leverage : 0,
        allN,
        allWinRate: allN ? (allWins / allN) * 100 : 0,
        allExpectancy: allN ? allMove / allN : 0,
        allRR: allWins ? allWinRS / allWins : 0,
        allLevRoi: allMove * leverage,
      };
    }).sort((a, b) => {
      if (b.markets !== a.markets) return b.markets - a.markets;
      if (b.adoptedWinRate !== a.adoptedWinRate) return b.adoptedWinRate - a.adoptedWinRate;
      return b.adoptedN - a.adoptedN;
    });
  }, [state.analyses, leverage]);

  const totalAdopted = rows.reduce((acc, r) => acc + r.markets, 0);
  const leader = rows[0];
  const recentSwaps = swapLog.slice(0, 14);

  return (
    <div className="tab engine-tab">
      <section className="hero-engine">
        <div className="hero-copy">
          <span className="eyebrow">적응형 전략 엔진</span>
          <h2>
            최근 60봉 승률이 <em>{MIN_WINRATE}%</em>를 못 넘긴 전략은 즉시 교체됩니다
          </h2>
          <p>
            {STRATEGIES.length}개 매매법을 스캔한 모든 마켓의 실제 200봉 캔들에 실시간 백테스트하고, 마켓별로 가장
            우수한 전략만 채택합니다. 성과가 떨어지면 교체 로그를 남기고 새 전략으로 시그널을 생성합니다.
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
              <span>전략 채택</span>
            </div>
            <div>
              <b>{swapLog.length}</b>
              <span>교체 기록</span>
            </div>
            <div>
              <b>{leader && leader.adoptedN ? `${leader.adoptedWinRate.toFixed(0)}%` : '-'}</b>
              <span>1위 채택 승률</span>
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
                <span>채택 마켓</span>
                <b>{leader.markets}</b>
              </div>
              <div>
                <span>채택 승률</span>
                <b className="up">{leader.adoptedWinRate ? `${leader.adoptedWinRate.toFixed(1)}%` : '-'}</b>
              </div>
              <div>
                <span>손익비</span>
                <b>{leader.adoptedRR ? fmtRR(leader.adoptedRR, 2) : '-'}</b>
              </div>
              <div>
                <span>기대 수익 ({leverage}배)</span>
                <b className={leader.expectancyRoi >= 0 ? 'up' : 'down'}>
                  {leader.adoptedN ? fmtPct(leader.expectancyRoi) : '-'}
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
                  <span className={`pill ${r.markets ? 'good' : ''}`}>채택 {r.markets}</span>
                </div>
                <div className="strat-desc">{r.meta.desc}</div>
                <div className="strat-bench">
                  <span className="bench-tag">전수 검증</span>
                  <b className={r.meta.bench.exp > 0 ? 'up' : 'down'}>승률 {r.meta.bench.winRate.toFixed(1)}%</b>
                  <span>
                    1건 기대값 {r.meta.bench.exp > 0 ? '+' : ''}
                    {r.meta.bench.exp.toFixed(2)}R · PF {r.meta.bench.pf.toFixed(2)} · 표본 {r.meta.bench.n}건
                  </span>
                  <span className="bench-origin">{r.meta.origin}</span>
                </div>
                <div className="strat-metrics">
                  <span>
                    <i>채택 승률</i>
                    <b className={r.adoptedWinRate >= 55 ? 'up' : ''}>
                      {r.adoptedWinRate ? `${r.adoptedWinRate.toFixed(1)}%` : '-'}
                    </b>
                  </span>
                  <span>
                    <i>표본</i>
                    <b>{r.adoptedN || '-'}</b>
                  </span>
                  <span>
                    <i>손익비</i>
                    <b>{r.adoptedRR ? fmtRR(r.adoptedRR, 2) : '-'}</b>
                  </span>
                  <span>
                    <i>기대 수익 {leverage}배</i>
                    <b className={r.expectancyRoi >= 0 ? 'up' : 'down'}>
                      {r.adoptedN ? fmtPct(r.expectancyRoi) : '-'}
                    </b>
                  </span>
                  <span>
                    <i>전체 승률</i>
                    <b className="muted">{r.allN ? `${r.allWinRate.toFixed(1)}%` : '-'}</b>
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="table-note">
          <b>전수 검증</b>은 {BENCH_INFO.at} 실제 비트겟 {BENCH_INFO.universe} 전수 백테스트 성적입니다
          ({BENCH_INFO.fee}). 1건 기대값이 플러스인 기법만 엔진에 남겼고, 표본이 30건 미만인 기법은 희귀
          시그널용으로 표시했습니다. <b>채택 승률·표본</b>은 이 전략이 실제로 선택된 마켓들의 최근 60봉 성과
          합계이고, 손절폭 상한 {STOP_WIDTH['1H'].max}%(1H) · {STOP_WIDTH['4H'].max}%(4H)를 넘는 넓은 손절폭
          셋업은 시그널·백테스트 집계에서 모두 제외됩니다. 기대 수익 {leverage}배는 1건당 손절가까지 거리 대비
          R배수를 레버리지로 환산한 값이고, 전체 승률은 스캔한 모든 마켓(채택 여부 무관)의 기록입니다.
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
