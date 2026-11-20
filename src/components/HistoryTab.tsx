import { useMemo, useState } from 'react';
import type { HistoryRecord } from '../lib/storage';
import { fmtDateTime, fmtPct, fmtPrice, tfLabel } from '../lib/format';

interface Props {
  history: HistoryRecord[];
  leverage: number;
  onClear: () => void;
}

type Filter = 'all' | 'win' | 'loss' | 'open';

export function HistoryTab({ history, leverage, onClear }: Props) {
  const [filter, setFilter] = useState<Filter>('all');

  const stats = useMemo(() => {
    const closed = history.filter((h) => h.state !== 'open');
    const wins = closed.filter((h) => h.state === 'win');
    const realizedR = closed.reduce((acc, h) => acc + h.r, 0);
    const openR = history.filter((h) => h.state === 'open').reduce((acc, h) => acc + h.r, 0);
    const realizedRoi = closed.reduce((acc, h) => acc + h.r * (h.riskPct || 0), 0) * leverage;
    const floatingRoi =
      history.filter((h) => h.state === 'open').reduce((acc, h) => acc + h.r * (h.riskPct || 0), 0) * leverage;
    return {
      total: history.length,
      wins: wins.length,
      losses: closed.length - wins.length,
      open: history.length - closed.length,
      winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
      realizedR,
      openR,
      avgR: closed.length ? realizedR / closed.length : 0,
      realizedRoi,
      floatingRoi,
    };
  }, [history, leverage]);

  const list = useMemo(
    () => history.filter((h) => (filter === 'all' ? true : h.state === filter)).slice(0, 80),
    [history, filter],
  );

  return (
    <div className="tab history-tab">
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">시그널 추적 기록</div>
            <div className="summary-sub">
              탐지 이후 실제 캔들로 적중/무효를 검증 · 무효가까지 거리 기준 레버리지 {leverage}x 수익률
            </div>
          </div>
          {history.length > 0 && (
            <button className="ghost-btn" onClick={onClear}>
              기록 초기화
            </button>
          )}
        </div>

        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">추적 시그널</span>
            <b>{stats.total}</b>
            <span className="stat-sub">
              적중 {stats.wins} · 무효 {stats.losses} · 진행 {stats.open}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">적중률</span>
            <b className={stats.winRate >= 55 ? 'up' : ''}>{stats.winRate ? `${stats.winRate.toFixed(1)}%` : '-'}</b>
            <span className="stat-sub">종료 시그널 기준</span>
          </div>
          <div className="stat">
            <span className="stat-label">실현 {leverage}x 수익률</span>
            <b className={stats.realizedRoi >= 0 ? 'up' : 'down'}>{fmtPct(stats.realizedRoi, 2)}</b>
            <span className="stat-sub">평균 {stats.avgR.toFixed(2)}R</span>
          </div>
          <div className="stat">
            <span className="stat-label">진행중 평가</span>
            <b className={stats.floatingRoi >= 0 ? 'up' : 'down'}>{fmtPct(stats.floatingRoi, 2)}</b>
            <span className="stat-sub">{stats.open}건 미실현</span>
          </div>
        </div>

        <div className="segmented">
          {(
            [
              ['all', '전체'],
              ['win', '적중'],
              ['loss', '무효'],
              ['open', '진행중'],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button key={key} className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <ul className="history-list">
          {list.map((h) => (
            <li key={h.id}>
              <div className="h-main">
                <div className="h-head">
                  <span className="h-sym">
                    {h.base} <i>{tfLabel(h.tf)}</i>
                  </span>
                  <span className={`badge ${h.side}`}>{h.side === 'long' ? '▲ 롱' : '▼ 숏'}</span>
                  <span
                    className={`badge state ${
                      h.state === 'open' ? 'open' : h.state === 'win' ? 'win' : 'loss'
                    }`}
                  >
                    {h.state === 'open' ? '진행중' : h.state === 'win' ? '적중' : '무효'}
                  </span>
                  <span className="h-strategy">{h.strategyShort}</span>
                </div>
                <div className="h-levels">
                  진입 {fmtPrice(h.entry)} · 목표 {fmtPrice(h.target)} · 무효 {fmtPrice(h.stop)} · {h.bars}봉 경과
                </div>
                <div className="h-time">
                {fmtDateTime(h.detectedAt)} 감지 · 무효가 거리 {h.riskPct ? `${h.riskPct.toFixed(2)}%` : '-'}
              </div>
              </div>
              <div className="h-result">
                <b className={h.r >= 0 ? 'up' : 'down'}>
                  {h.r > 0 ? '+' : ''}
                  {h.r.toFixed(2)}R
                </b>
                <span className={h.r >= 0 ? 'up' : 'down'}>{fmtPct(h.r * (h.riskPct || 0) * leverage, 2)}</span>
              </div>
            </li>
          ))}
          {list.length === 0 && <li className="h-empty">해당 조건의 기록이 없습니다.</li>}
        </ul>
      </section>

      <div className="feed-note">
        적중/무효는 진입 이후 캔들이 목표가·무효가에 먼저 닿았는지로 판정합니다(같은 봉에서 동시 도달 시 무효
        우선). 수익률 %는 (가격 변동 ÷ 진입가) × 레버리지입니다.
      </div>
    </div>
  );
}
