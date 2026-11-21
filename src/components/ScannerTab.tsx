import { useEffect, useMemo, useState } from 'react';
import type { Signal } from '../engine/types';
import type { ScanState } from '../hooks/useScanner';
import { favoriteKey, type FavoriteEntry } from '../lib/favorites';
import { fmtPct, tfLabel } from '../lib/format';
import type { Settings } from '../lib/storage';
import { SignalCard } from './SignalCard';
import { CloseIcon, RefreshIcon, SearchIcon, StarIcon } from './Icons';

interface Props {
  state: ScanState;
  settings: Settings;
  favorites: FavoriteEntry[];
  isFavorite: (signal: Signal) => boolean;
  onToggleFavorite: (signal: Signal) => void;
  onSettings: (patch: Partial<Settings>) => void;
  onOpen: (s: Signal) => void;
  onRescan: () => void;
}

type AssetFilter = 'all' | 'crypto' | 'stock';

const PAGE_SIZE = 12;

/** 종목명·심볼·전략명 키워드 매칭(대소문자 무시, 공백 구분 AND) */
function matchesQuery(signal: Signal, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = `${signal.base} ${signal.symbol} ${signal.strategyName} ${signal.strategyShort} ${signal.tags.join(' ')}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}
type TfFilter = 'all' | '1H' | '4H';

export function ScannerTab({
  state,
  settings,
  favorites,
  isFavorite,
  onToggleFavorite,
  onSettings,
  onOpen,
  onRescan,
}: Props) {
  const [asset, setAsset] = useState<AssetFilter>('all');
  const [tf, setTf] = useState<TfFilter>('all');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [favOnly, setFavOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  // 필터·검색이 바뀌면 목록을 다시 첫 페이지부터 보여준다.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [query, asset, tf, onlyOpen, favOnly, settings.minRR]);

  const openSignals = state.signals.filter((s) => s.state === 'open');
  const counts = useMemo(
    () => ({
      long: openSignals.filter((s) => s.side === 'long').length,
      short: openSignals.filter((s) => s.side === 'short').length,
      h1: openSignals.filter((s) => s.tf === '1H').length,
      h4: openSignals.filter((s) => s.tf === '4H').length,
      stock: openSignals.filter((s) => s.asset === 'stock').length,
      crypto: openSignals.filter((s) => s.asset === 'crypto').length,
    }),
    [openSignals],
  );

  /** 현재 스캔 결과를 즐겨찾기 키로 색인 — 살아있는 시그널은 최신 현재가·수익률·진행도로 표시된다. */
  const liveByKey = useMemo(() => {
    const map = new Map<string, Signal>();
    for (const s of state.signals) map.set(favoriteKey(s), s);
    return map;
  }, [state.signals]);

  const favoriteSignals = useMemo(() => {
    return favorites
      .filter((f) => matchesQuery(liveByKey.get(f.key) ?? f.signal, terms))
      .map((f) => ({ entry: f, signal: liveByKey.get(f.key) ?? null }))
      .map(({ entry, signal }) => ({ signal: signal ?? entry.signal, stale: !signal }))
      .sort((a, b) => {
        const rank = (x: { signal: Signal }) => (x.signal.state === 'open' ? 0 : 1);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return b.signal.detectedAt - a.signal.detectedAt;
      });
  }, [favorites, liveByKey, terms]);

  const favoriteLiveCount = favoriteSignals.filter((f) => !f.stale).length;

  const filtered = useMemo(() => {
    // 즐겨찾기 모드: 자산·타임프레임·진행중·최소 손익비와 무관하게 찜한 시그널을 모두 보여준다.
    if (favOnly) return favoriteSignals;
    return state.signals
      .filter((s) => (onlyOpen ? s.state === 'open' : true))
      .filter((s) => (asset === 'all' ? s.asset !== 'commodity' : s.asset === asset))
      .filter((s) => (tf === 'all' ? true : s.tf === tf))
      .filter((s) => s.rr >= settings.minRR)
      .filter((s) => matchesQuery(s, terms))
      .sort((a, b) => {
        const rank = (s: Signal) => (s.state === 'open' ? 0 : 1);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return b.detectedAt - a.detectedAt;
      })
      .map((signal) => ({ signal, stale: false }));
  }, [state.signals, onlyOpen, asset, tf, settings.minRR, favOnly, favoriteSignals, terms]);

  const shown = filtered.slice(0, visible);
  const remaining = filtered.length - shown.length;

  const qualified = state.analyses.filter(
    (a) => a.activeWinRate >= 55 && a.activeRR >= 1.5 && a.activeN >= 2,
  ).length;
  const scanning = state.status === 'scanning';
  const pct = state.progress.total ? Math.round((state.progress.done / state.progress.total) * 100) : 0;

  const avgRoi = filtered.length
    ? filtered.reduce((acc, f) => acc + f.signal.changePct * settings.leverage, 0) / filtered.length
    : 0;

  return (
    <div className="tab scanner-tab">
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">
              TS 발생 종목 <span className="dot-live" /> <b>{openSignals.length}</b>
            </div>
            <div className="summary-sub">
              비트겟 USDT-M · {state.analyses.length}개 마켓 · {qualified}개 마켓 고승률 전략 채택
            </div>
          </div>
          <button className={`rescan ${scanning ? 'busy' : ''}`} onClick={onRescan} disabled={scanning}>
            <RefreshIcon size={16} />
            {scanning ? `${pct}%` : '실시간 갱신'}
          </button>
        </div>

        <div className="counter-row">
          <span className="counter long">롱 {counts.long}</span>
          <span className="counter short">숏 {counts.short}</span>
          <span className="counter">{tfLabel('1H')} {counts.h1}</span>
          <span className="counter">{tfLabel('4H')} {counts.h4}</span>
          <span className="counter alt">평균 {fmtPct(avgRoi)}</span>
        </div>

        <div className="search-row">
          <div className="search-box">
            <SearchIcon size={15} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="종목명·심볼·전략 검색 (예: BTC, MSFT, EMA)"
              aria-label="종목·심볼·전략 검색"
              enterKeyHint="search"
            />
            {query && (
              <button
                type="button"
                className="search-clear"
                onClick={() => setQuery('')}
                aria-label="검색어 지우기"
              >
                <CloseIcon size={13} />
              </button>
            )}
          </div>
          {query && (
            <span className="search-count">
              <b>{filtered.length}</b>건
            </span>
          )}
        </div>

        <div className="filter-grid">
          <div className="segmented" role="group" aria-label="자산 구분">
            {(
              [
                ['all', '전체'],
                ['crypto', '코인'],
                ['stock', '주식선물'],
              ] as [AssetFilter, string][]
            ).map(([key, label]) => (
              <button key={key} className={asset === key ? 'on' : ''} onClick={() => setAsset(key)}>
                {label}
              </button>
            ))}
          </div>
          <div className="segmented slim" role="group" aria-label="타임프레임">
            {(
              [
                ['all', '전체'],
                ['1H', '1H'],
                ['4H', '4H'],
              ] as [TfFilter, string][]
            ).map(([key, label]) => (
              <button key={key} className={tf === key ? 'on' : ''} onClick={() => setTf(key)}>
                {label}
              </button>
            ))}
          </div>
          <label className="select-pill">
            <span>레버리지</span>
            <select
              value={settings.leverage}
              onChange={(e) => onSettings({ leverage: Number(e.target.value) })}
            >
              {[5, 10, 20, 50].map((l) => (
                <option key={l} value={l}>
                  {l}x
                </option>
              ))}
            </select>
          </label>
          <label className="select-pill">
            <span>최소 손익비</span>
            <select value={settings.minRR} onChange={(e) => onSettings({ minRR: Number(e.target.value) })}>
              {[1.2, 1.5, 1.8, 2, 2.5].map((r) => (
                <option key={r} value={r}>
                  {r.toFixed(1)}R
                </option>
              ))}
            </select>
          </label>
          <button className={`ghost-toggle ${onlyOpen ? 'on' : ''}`} onClick={() => setOnlyOpen((v) => !v)}>
            {onlyOpen ? '진행중만' : '종료 포함'}
          </button>
          <button
            className={`fav-toggle ${favOnly ? 'on' : ''}`}
            aria-pressed={favOnly}
            aria-label="즐겨찾기한 시그널만 보기"
            onClick={() => setFavOnly((v) => !v)}
          >
            <StarIcon size={14} filled={favOnly} />
            즐겨찾기
            <b>{favorites.length}</b>
          </button>
        </div>

        {scanning && (
          <div className="scan-bar">
            <div className="scan-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </section>

      {state.status === 'error' && (
        <div className="notice error">
          비트겟 API 호출 실패: {state.error}
          <button onClick={onRescan}>다시 시도</button>
        </div>
      )}

      <div className="list-head">
        {favOnly ? (
          <span>
            ⭐ 즐겨찾기 <b>{filtered.length}</b>건 · 진행중 {favoriteLiveCount} · 보관{' '}
            {favoriteSignals.length - favoriteLiveCount}
          </span>
        ) : (
          <span>
            필터 적용 <b>{Math.min(visible, filtered.length)}</b> / {filtered.length}건
          </span>
        )}
        <span className="muted">
          {favOnly
            ? '찜한 시그널은 진행중/종료·필터와 무관하게 모두 표시됩니다'
            : `승률 55%·손익비 ${settings.minRR.toFixed(1)}R 이상 전략만 시그널 생성`}
        </span>
      </div>

      <div className="card-grid">
        {shown.map(({ signal, stale }) => (
          <SignalCard
            key={favoriteKey(signal)}
            signal={signal}
            leverage={settings.leverage}
            onOpen={onOpen}
            isFavorite={isFavorite(signal)}
            onToggleFavorite={onToggleFavorite}
            stale={stale}
          />
        ))}

        {scanning &&
          filtered.length === 0 &&
          !favOnly &&
          Array.from({ length: 3 }).map((_, i) => (
            <div className="signal-card skeleton" key={`sk-${i}`}>
              <div className="sk-line w40" />
              <div className="sk-line w70" />
              <div className="sk-chart" />
              <div className="sk-line w100" />
            </div>
          ))}

        {filtered.length === 0 && query && (favOnly || !scanning) && (
          <div className="empty search-empty">
            <div className="empty-title">
              {favOnly ? `즐겨찾기 안에 '${query.trim()}' 검색 결과가 없습니다` : `'${query.trim()}' 검색 결과가 없습니다`}
            </div>
            <p>심볼 전체(BTCUSDT)나 전략명(EMA, CRT, SuperTrend) 일부로 다시 검색해 보세요. 진행중만 토글을 끄면 종료된 이전 시그널도 검색됩니다.</p>
            <div className="empty-actions">
              <button onClick={() => setQuery('')} className="primary">
                검색어 지우기
              </button>
            </div>
          </div>
        )}

        {filtered.length === 0 && !query && favOnly && (
          <div className="empty favorite-empty">
            <div className="empty-title">⭐ 즐겨찾기한 시그널이 없어요</div>
            <p>카드 우측 상단의 ⭐ 버튼을 눌러 관심 시그널을 추가해 보세요. 즐겨찾기는 이 브라우저에 저장되어 새로고침해도 그대로 남습니다.</p>
            <div className="empty-actions">
              <button onClick={() => setFavOnly(false)} className="primary">
                전체 시그널 보기
              </button>
            </div>
          </div>
        )}

        {!scanning && filtered.length === 0 && !query && !favOnly && (
          <div className="empty">
            <div className="empty-title">조건을 통과한 TS가 없습니다</div>
            <p>
              현재 {state.analyses.length}개 마켓을 200봉 기준으로 다시 계산했지만, 고승률 기준(승률 55% ·
              손익비 {settings.minRR.toFixed(1)}R)을 만족하는 진행중 시그널이 없습니다.
            </p>
            <div className="empty-actions">
              <button
                onClick={() => {
                  setAsset('all');
                  setTf('all');
                  onSettings({ minRR: 1.2 });
                  setOnlyOpen(false);
                }}
              >
                기준 완화해서 보기
              </button>
              <button onClick={onRescan} className="primary">
                지금 다시 스캔
              </button>
            </div>
          </div>
        )}
        {remaining > 0 && (
          <button className="more-btn" type="button" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            <span className="more-label">
              {favOnly ? '즐겨찾기 더보기' : '이전 시그널 더보기'}
            </span>
            <b>+{remaining}건</b>
            <span className="more-sub">표시 {Math.min(visible, filtered.length)} / {filtered.length}</span>
          </button>
        )}
      </div>

      <div className="feed-note">
        실시간 Bitget 캔들(1H/4H, 200봉) 기반 · 마지막 스캔{' '}
        {state.finishedAt ? new Date(state.finishedAt).toLocaleTimeString('ko-KR', { hour12: false }) : '-'} ·
        자동 갱신 {settings.refreshSec ? `${settings.refreshSec}초` : '꺼짐'} · 즐겨찾기 {favorites.length}개 저장됨
      </div>
    </div>
  );
}
