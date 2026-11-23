import { useEffect, useMemo, useState } from 'react';
import { HISTORY_LIMIT, type HistoryRecord, type MyTrade } from '../lib/storage';
import {
  dedupeHistory,
  equityCurve,
  fmtR,
  journalStats,
  recordKey,
  strategyBoard,
  streaks,
  tradesIn,
} from '../lib/journal';
import { fmtDateTime, fmtPct, fmtPrice, stateLabel, tfLabel } from '../lib/format';
import { resolveRiskPct } from '../lib/orderCockpit';
import { fmtSeed, fmtUsdAmount, type Profile } from '../lib/profile';
import { EquityCurve } from './EquityCurve';
import { StrategyBoard } from './StrategyBoard';
import { CloseIcon, SearchIcon } from './Icons';

const PAGE_SIZE = 15;

/** 0은 색을 입히지 않는다 — 이익/손실 표기가 붙는 순간만 색을 준다 */
const tone = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : '');

function matchesQuery(h: HistoryRecord, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = `${h.base} ${h.symbol} ${h.strategyShort} ${h.strategyId}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

interface Props {
  history: HistoryRecord[];
  leverage: number;
  /** 시드·매매 성향 — 누적 손익($) 기준 */
  profile?: Profile | null;
  /** 설정의 1회 허용 손실률(%). null이면 성향 기본값 */
  riskPct?: number | null;
  /** 내 진입으로 표시한 시그널 */
  myTrades: MyTrade[];
  onToggleMyTrade: (key: string) => void;
  onMemo: (key: string, memo: string) => void;
  onClearMyTrades: () => void;
  onClear: () => void;
}

type Filter = 'all' | 'win' | 'loss' | 'open';
type Mode = 'all' | 'mine';

export function HistoryTab({
  history,
  leverage,
  profile = null,
  riskPct = null,
  myTrades,
  onToggleMyTrade,
  onMemo,
  onClearMyTrades,
  onClear,
}: Props) {
  const [mode, setMode] = useState<Mode>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  /** 같은 캔들이 두 번 쌓인 중복 기록을 한 건으로 — 승률·곡선이 부풀지 않게 */
  const all = useMemo(() => dedupeHistory(history), [history]);
  const mineAll = useMemo(() => tradesIn(all, myTrades), [all, myTrades]);
  const mine = mineAll.records;
  const tradeMap = useMemo(() => new Map(myTrades.map((t) => [t.key, t])), [myTrades]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [query, filter, mode]);

  const basis = useMemo(
    () => ({
      seed: profile?.seed ?? 0,
      riskPct: profile ? resolveRiskPct(profile.style, riskPct) : 0,
    }),
    [profile, riskPct],
  );

  const view = mode === 'mine' ? mine : all;
  const stats = useMemo(() => journalStats(view, basis), [view, basis]);
  const statsAll = useMemo(() => journalStats(all, basis), [all, basis]);

  /** 레버리지 수익률 합계(기존 지표) — 손절가 거리 가중 */
  const pct = useMemo(() => {
    const closed = view.filter((h) => h.state !== 'open');
    return {
      realizedRoi: closed.reduce((acc, h) => acc + h.r * (h.riskPct || 0), 0) * leverage,
      floatingRoi:
        view.filter((h) => h.state === 'open').reduce((acc, h) => acc + h.r * (h.riskPct || 0), 0) * leverage,
    };
  }, [view, leverage]);

  const curve = useMemo(() => equityCurve(view), [view]);
  const streak = useMemo(() => streaks(view), [view]);
  const board = useMemo(() => strategyBoard(view), [view]);

  const matched = useMemo(
    () =>
      view
        .filter((h) => (filter === 'all' ? true : h.state === filter))
        .filter((h) => matchesQuery(h, terms)),
    [view, filter, terms],
  );
  const list = matched.slice(0, visible);
  const remaining = matched.length - list.length;

  const filterLabels: [Filter, string][] = [
    ['all', '전체'],
    ['win', '목표 달성'],
    ['loss', '손절 종료'],
    ['open', '진행 중'],
  ];

  return (
    <div className="tab history-tab">
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">
              {mode === 'mine' ? '내 매매 복기' : '시그널 추적 기록'}
            </div>
            <div className="summary-sub">
              {mode === 'mine'
                ? '내가 직접 진입한 시그널만 모아 승률·평균 R·누적 손익을 계산합니다. 한 줄 복기로 그날의 판단을 남기세요.'
                : '탐지 이후 실제 캔들로 목표 달성·손절 종료를 검증 · 손절가까지 거리 기준 레버리지 ' +
                  `${leverage}x 수익률`}
            </div>
          </div>
          {mode === 'mine' && myTrades.length > 0 ? (
            <button className="ghost-btn" onClick={onClearMyTrades}>
              내 진입 비우기
            </button>
          ) : mode === 'all' && all.length > 0 ? (
            <button className="ghost-btn" onClick={onClear}>
              기록 초기화
            </button>
          ) : null}
        </div>

        <div className="segmented trade-mode" role="group" aria-label="기록 범위">
          <button
            className={mode === 'all' ? 'on' : ''}
            aria-pressed={mode === 'all'}
            onClick={() => setMode('all')}
          >
            전체 시그널 <b>{all.length}</b>
          </button>
          <button
            className={mode === 'mine' ? 'on' : ''}
            aria-pressed={mode === 'mine'}
            onClick={() => setMode('mine')}
          >
            📌 내 진입 매매 <b>{mine.length}</b>
          </button>
        </div>

        <div className="stat-grid">
          {mode === 'all' ? (
            <>
              <div className="stat">
                <span className="stat-label">추적 시그널</span>
                <b>{statsAll.total}</b>
                <span className="stat-sub">
                  목표 달성 {statsAll.wins} · 손절 종료 {statsAll.losses} · 진행 중 {statsAll.open}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">목표 달성률</span>
                <b className={statsAll.winRate >= 55 ? 'up' : ''}>
                  {statsAll.closed ? `${statsAll.winRate.toFixed(1)}%` : '-'}
                </b>
                <span className="stat-sub">목표 달성 · 손절 종료 기준</span>
              </div>
              <div className="stat">
                <span className="stat-label">실현 {leverage}x 수익률</span>
                <b className={tone(pct.realizedRoi)}>{fmtPct(pct.realizedRoi, 2)}</b>
                <span className="stat-sub">손절가 거리 가중 · 평균 {statsAll.avgR.toFixed(2)}R</span>
              </div>
              <div className="stat">
                <span className="stat-label">진행중 평가</span>
                <b className={tone(pct.floatingRoi)}>{fmtPct(pct.floatingRoi, 2)}</b>
                <span className="stat-sub">{statsAll.open}건 미실현</span>
              </div>
            </>
          ) : (
            <>
              <div className="stat">
                <span className="stat-label">내 진입 매매</span>
                <b>{stats.total}</b>
                <span className="stat-sub">
                  목표 달성 {stats.wins} · 손절 종료 {stats.losses} · 진행 중 {stats.open}
                </span>
              </div>
              <div className="stat">
                <span className="stat-label">내 승률</span>
                <b className={stats.winRate >= 55 ? 'up' : ''}>
                  {stats.closed ? `${stats.winRate.toFixed(1)}%` : '-'}
                </b>
                <span className="stat-sub">종료된 내 매매 기준</span>
              </div>
              <div className="stat">
                <span className="stat-label">누적 R</span>
                <b className={tone(stats.cumR)}>{fmtR(stats.cumR)}</b>
                <span className="stat-sub">평균 {fmtR(stats.avgR)} · {stats.closed}건</span>
              </div>
              <div className="stat">
                <span className="stat-label">누적 손익</span>
                <b className={tone(stats.pnlUsd)}>
                  {profile ? fmtUsdAmount(stats.pnlUsd) : '-'}
                </b>
                <span className="stat-sub">
                  {profile
                    ? `시드 $${fmtSeed(profile.seed)} · 1회 ${basis.riskPct}%`
                    : '투자 프로필을 설정하면 표시'}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="search-row">
          <div className="search-box">
            <SearchIcon size={15} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="종목·심볼·전략으로 기록 검색 (예: BTC, ETH, SuperTrend)"
              aria-label="기록 검색"
              enterKeyHint="search"
            />
            {query && (
              <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="검색어 지우기">
                <CloseIcon size={13} />
              </button>
            )}
          </div>
          {query && (
            <span className="search-count">
              <b>{matched.length}</b>건
            </span>
          )}
        </div>

        <div className="segmented">
          {filterLabels.map(([key, label]) => (
            <button key={key} className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel equity-panel">
        <div className="panel-head">
          <h3>📈 누적 R 수익곡선</h3>
          <span className="panel-note">
            {mode === 'mine' ? '내 진입 종료 매매' : '종료된 시그널'} {curve.trades}건 · 시간순
          </span>
        </div>
        <EquityCurve curve={curve} streaks={streak} mine={mode === 'mine'} />
        {curve.trades > 0 && (
          <div className="equity-basis">
            {profile
              ? `시드 $${fmtSeed(profile.seed)} · 1회 리스크 ${basis.riskPct}% 기준 누적 손익 ${fmtUsdAmount(
                  stats.pnlUsd,
                )}`
              : '투자 프로필(시드·매매 성향)을 설정하면 누적 손익($)을 함께 보여줍니다.'}
          </div>
        )}
      </section>

      <section className="panel strat-panel">
        <div className="panel-head">
          <h3>🧩 전략별 성적</h3>
          <span className="panel-note">종료 매매 기준 · 누적 R 순</span>
        </div>
        <StrategyBoard rows={board} />
      </section>

      <section className="panel">
        <div className="list-head history-head">
          <span>
            {mode === 'mine' ? '내 진입' : filter === 'all' ? '전체' : filter === 'win' ? '목표 달성' : filter === 'loss' ? '손절 종료' : '진행 중'}{' '}
            기록 <b>{Math.min(visible, matched.length)}</b> / {matched.length}건
          </span>
          <span className="muted">
            {mode === 'mine' && mineAll.orphans > 0
              ? `기록이 지워진 진입 ${mineAll.orphans}건 제외`
              : `최근 ${Math.min(all.length, HISTORY_LIMIT)}건 보관`}
          </span>
        </div>
        <ul className="history-list">
          {list.map((h) => {
            const key = recordKey(h);
            const mineEntry = tradeMap.get(key);
            return (
              <li key={key} className={mineEntry ? 'mine' : ''}>
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
                      {stateLabel(h.state)}
                    </span>
                    <span className="h-strategy">{h.strategyShort}</span>
                  </div>
                  <div className="h-levels">
                    진입가 {fmtPrice(h.entry, h.decimals)} · 목표가 {fmtPrice(h.target, h.decimals)} · 손절가{' '}
                    {fmtPrice(h.stop, h.decimals)} · {h.bars}봉 경과
                  </div>
                  <div className="h-time">
                    {fmtDateTime(h.detectedAt)} 감지 · 손절가 거리 {h.riskPct ? `${h.riskPct.toFixed(2)}%` : '-'}
                    {mineEntry && mineEntry.enteredAt > 0 ? ` · 내 진입 ${fmtDateTime(mineEntry.enteredAt)}` : ''}
                  </div>
                </div>
                <div className="h-result">
                  <b className={tone(h.r)}>
                    {h.r > 0 ? '+' : ''}
                    {h.r.toFixed(2)}R
                  </b>
                  <span className={tone(h.r)}>
                    {fmtPct(h.r * (h.riskPct || 0) * leverage, 2)}
                  </span>
                </div>
                <button
                  type="button"
                  className={`pin-btn sm ${mineEntry ? 'on' : ''}`}
                  aria-pressed={!!mineEntry}
                  aria-label={mineEntry ? `${h.base} 내 진입 기록 해제` : `${h.base} 내 진입으로 기록`}
                  title={mineEntry ? '내 진입 기록 해제' : '내 진입으로 기록 — 내 매매 집계에 포함'}
                  onClick={() => onToggleMyTrade(key)}
                >
                  {mineEntry ? '✓ 진입함' : '📌 진입'}
                </button>
                {mode === 'mine' && mineEntry && (
                  <label className="h-memo">
                    <span className="memo-cap">복기</span>
                    <input
                      type="text"
                      value={mineEntry.memo}
                      maxLength={40}
                      placeholder="한 줄 복기 (예: 원칙 준수 · 추격 매수 주의)"
                      aria-label={`${h.base} 매매 복기 메모`}
                      onChange={(e) => onMemo(key, e.target.value)}
                    />
                  </label>
                )}
              </li>
            );
          })}
          {list.length === 0 && (
            <li className="h-empty">
              {mode === 'mine' && !query
                ? '내 진입으로 표시한 매매가 없습니다. 스캐너 카드나 아래 전체 기록에서 📌 진입 버튼을 눌러 실제로 진입한 시그널을 기록하세요.'
                : query
                  ? `'${query.trim()}' 검색 결과가 없습니다.`
                  : '해당 조건의 기록이 없습니다.'}
            </li>
          )}
        </ul>
        {mode === 'mine' && mine.length === 0 && (
          <button className="more-btn" type="button" onClick={() => setMode('all')}>
            <span className="more-label">전체 시그널에서 내 진입 고르기</span>
            <b>{all.length}건</b>
            <span className="more-sub">카드·기록의 📌 버튼</span>
          </button>
        )}
        {remaining > 0 && (
          <button className="more-btn" type="button" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            <span className="more-label">이전 기록 더보기</span>
            <b>+{remaining}건</b>
            <span className="more-sub">
              표시 {Math.min(visible, matched.length)} / {matched.length}
            </span>
          </button>
        )}
      </section>

      <div className="feed-note">
        목표 달성/손절 종료는 진입 이후 캔들이 목표가·손절가에 먼저 닿았는지로 판정합니다(같은 봉에서 동시 도달 시
        손절 우선). 수익률 %는 (가격 변동 ÷ 진입가) × 레버리지, 누적 손익($)은 누적 R × (시드 × 1회 리스크%)입니다.
      </div>
    </div>
  );
}
