import { useEffect, useMemo, useState } from 'react';
import type { Contract, Signal } from '../engine/types';
import type { ScanState } from '../hooks/useScanner';
import { favoriteKey, type FavoriteEntry } from '../lib/favorites';
import { fmtPct, tfLabel } from '../lib/format';
import type { Settings } from '../lib/storage';
import { signalKey, type MyTrade } from '../lib/storage';
import { recommendLeverage, type Profile } from '../lib/profile';
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
  /** 시드·매매 성향 — COTA 추천 레버리지 계산에 쓴다 */
  profile: Profile | null;
  /** 내 진입으로 표시한 시그널 */
  myTrades: MyTrade[];
  onToggleMyTrade: (key: string) => void;
}

type AssetFilter = 'crypto' | 'stock' | 'all';

/** 주력 종목 원클릭 퀵 필터 */
const QUICK_FILTERS: { key: string; label: string; query: string; asset: AssetFilter; hint: string }[] = [
  { key: 'btc', label: '₿ 비트', query: 'BTC', asset: 'crypto', hint: 'BTCUSDT · 비트겟' },
  { key: 'eth', label: 'Ξ 이더', query: 'ETH', asset: 'crypto', hint: 'ETHUSDT · 비트겟' },
  { key: 'sol', label: '◎ 솔', query: 'SOL', asset: 'crypto', hint: 'SOLUSDT · 비트겟' },
];

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
  profile,
  myTrades,
  onToggleMyTrade,
}: Props) {
  const [asset, setAsset] = useState<AssetFilter>('crypto');
  const [tf, setTf] = useState<TfFilter>('all');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [favOnly, setFavOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  /** 내 진입으로 표시한 시그널 키 — 카드 버튼 표시에 쓴다 */
  const mineKeys = useMemo(() => new Set(myTrades.map((t) => t.key)), [myTrades]);

  // 필터·검색이 바뀌면 목록을 다시 첫 페이지부터 보여준다.
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [query, asset, tf, onlyOpen, favOnly, settings.minRR]);

  /** 코인·주식선물만 — FX는 스캔 대상에서 빠졌다. */
  const baseSignals = useMemo(() => state.signals.filter((s) => s.asset !== 'fx'), [state.signals]);
  const openSignals = useMemo(
    () => baseSignals.filter((s) => s.state === 'open'),
    [baseSignals],
  );
  const scanFavorites = useMemo(() => favorites.filter((f) => f.signal.asset !== 'fx'), [favorites]);

  const counts = useMemo(
    () => ({
      long: openSignals.filter((s) => s.side === 'long').length,
      short: openSignals.filter((s) => s.side === 'short').length,
      h1: openSignals.filter((s) => s.tf === '1H').length,
      h4: openSignals.filter((s) => s.tf === '4H').length,
      crypto: openSignals.filter((s) => s.asset === 'crypto').length,
      stock: openSignals.filter((s) => s.asset === 'stock').length,
    }),
    [openSignals],
  );

  /** 현재 스캔 결과를 즐겨찾기 키로 색인 — 살아있는 시그널은 최신 현재가·수익률·진행도로 표시된다. */
  const liveByKey = useMemo(() => {
    const map = new Map<string, Signal>();
    for (const s of state.signals) map.set(favoriteKey(s), s);
    return map;
  }, [state.signals]);

  /** 종목별 거래소 계약 정보 — 주문 수량을 비트겟 주문 단위(volumePlace)에 맞춘다. */
  const contractBySymbol = useMemo(() => {
    const map = new Map<string, Contract>();
    for (const c of state.contracts) map.set(c.symbol, c);
    return map;
  }, [state.contracts]);

  const favoriteSignals = useMemo(() => {
    return scanFavorites
      .filter((f) => matchesQuery(liveByKey.get(f.key) ?? f.signal, terms))
      .map((f) => ({ entry: f, signal: liveByKey.get(f.key) ?? null }))
      .map(({ entry, signal }) => ({ signal: signal ?? entry.signal, stale: !signal }))
      .sort((a, b) => {
        const rank = (x: { signal: Signal }) => (x.signal.state === 'open' ? 0 : 1);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return b.signal.detectedAt - a.signal.detectedAt;
      });
  }, [scanFavorites, liveByKey, terms]);

  const favoriteLiveCount = favoriteSignals.filter((f) => !f.stale).length;

  const filtered = useMemo(() => {
    // 즐겨찾기 모드: 자산·타임프레임·진행중·최소 손익비와 무관하게 찜한 시그널을 모두 보여준다.
    if (favOnly) return favoriteSignals;
    return baseSignals
      .filter((s) => (onlyOpen ? s.state === 'open' : true))
      .filter((s) => (asset === 'all' ? true : s.asset === asset))
      .filter((s) => (tf === 'all' ? true : s.tf === tf))
      .filter((s) => s.rr >= settings.minRR)
      .filter((s) => matchesQuery(s, terms))
      .sort((a, b) => {
        const rank = (s: Signal) => (s.state === 'open' ? 0 : 1);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return b.detectedAt - a.detectedAt;
      })
      .map((signal) => ({ signal, stale: false }));
  }, [baseSignals, onlyOpen, asset, tf, settings.minRR, favOnly, favoriteSignals, terms]);

  const shown = filtered.slice(0, visible);
  const remaining = filtered.length - shown.length;
  const activeQuick = QUICK_FILTERS.find((q) => q.query.toLowerCase() === query.trim().toLowerCase());

  const qualified = state.analyses.filter(
    (a) => a.asset !== 'fx' && a.activeWinRate >= 55 && a.activeRR >= 1.5 && a.activeN >= 2,
  ).length;
  const marketCount = state.analyses.filter((a) => a.asset !== 'fx').length;
  const scanning = state.status === 'scanning';
  const pct = state.progress.total ? Math.round((state.progress.done / state.progress.total) * 100) : 0;
  /** 마지막 스캔 소요 — 캐시만 반영했는지 새로 받았는지 함께 보여준다. */
  const speedLabel = (() => {
    if (state.status === 'error' || !state.elapsedMs) return null;
    // 새로 받는 중에는 진행률을 보여주고, 캐시로 끝난 경우엔 바로 캐시 표시
    if (state.status === 'scanning' && state.candleFetches > 0) return null;
    const sec = state.elapsedMs >= 1000 ? (state.elapsedMs / 1000).toFixed(1) : (state.elapsedMs / 1000).toFixed(2);
    if (!state.candleFetches) return `⚡ 캐시 ${sec}초`;
    return `⚡ ${sec}초 완료`;
  })();

  const leverageFor = (signal: Signal): number =>
    settings.leverageMode === 'auto' && profile
      ? recommendLeverage(signal, profile.style).leverage
      : settings.leverage;
  const avgRoi = filtered.length
    ? filtered.reduce((acc, f) => acc + f.signal.changePct * leverageFor(f.signal), 0) / filtered.length
    : 0;

  return (
    <div className="tab scanner-tab">
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">
              진행 중 시그널 <span className="dot-live" /> <b>{openSignals.length}</b>
            </div>
            <div className="summary-sub">
              비트겟 USDT-M 코인·주식선물 · {marketCount}개 마켓 · {qualified}개 고승률 전략 채택
            </div>
          </div>
          <div className="scan-actions">
            <button className={`rescan ${scanning ? 'busy' : ''}`} onClick={onRescan} disabled={scanning}>
              <RefreshIcon size={16} />
              {scanning ? `${pct}%` : '실시간 갱신'}
            </button>
            {speedLabel && (
              <span className="speed-chip" data-scan-speed title={`캔들 ${state.candleFetches}건 새로 받음 · 캐시 ${state.cacheHits}건 재사용 · 실패 ${state.progress.failed}건`}>
                {speedLabel}
              </span>
            )}
          </div>
        </div>

        <div className="counter-row">
          <span className="counter long">롱 {counts.long}</span>
          <span className="counter short">숏 {counts.short}</span>
          <span className="counter">
            {tfLabel('1H')} {counts.h1}
          </span>
          <span className="counter">
            {tfLabel('4H')} {counts.h4}
          </span>
          <span className="counter alt">평균 {fmtPct(avgRoi)}</span>
          {mineKeys.size > 0 && <span className="counter mine">📌 내 진입 {mineKeys.size}</span>}
        </div>

        <div className="search-row">
          <div className="search-box">
            <SearchIcon size={15} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="코인·심볼·전략 검색 (예: BTC, ETH, EMA)"
              aria-label="코인·심볼·전략 검색"
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
          <div className="quick-row" role="group" aria-label="주력 코인 퀵 필터">
            {QUICK_FILTERS.map((q) => {
              const active = query.trim().toLowerCase() === q.query.toLowerCase();
              return (
                <button
                  key={q.key}
                  type="button"
                  className={`quick-chip ${q.key} ${active ? 'on' : ''}`}
                  aria-pressed={active}
                  title={active ? `${q.hint} 필터 해제` : `${q.hint} 만 보기`}
                  onClick={() => {
                    if (active) {
                      setQuery('');
                      return;
                    }
                    setFavOnly(false);
                    setAsset(q.asset);
                    // 진행중 시그널이 없어도 해당 종목의 최근 셋업을 바로 볼 수 있게 종료 시그널까지 포함한다.
                    setOnlyOpen(false);
                    setQuery(q.query);
                  }}
                >
                  {q.label}
                </button>
              );
            })}
          </div>
          <div className="segmented" role="group" aria-label="자산 구분">
            {(
              [
                ['crypto', '코인'],
                ['stock', '주식선물'],
                ['all', '전체'],
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
              value={settings.leverageMode === 'auto' ? 'auto' : String(settings.leverage)}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'auto') onSettings({ leverageMode: 'auto' });
                else onSettings({ leverageMode: 'manual', leverage: Number(v) });
              }}
            >
              <option value="auto">COTA 추천</option>
              {[5, 10, 20, 50].map((l) => (
                <option key={l} value={l}>
                  {l}x 고정
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
            <b>{scanFavorites.length}</b>
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
            ⭐ 즐겨찾기 <b>{filtered.length}</b>건 · 진행 중 {favoriteLiveCount} · 보관{' '}
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
            : `승률 55%·손익비 ${settings.minRR.toFixed(1)}R 이상 전략만 시그널 생성 · ${
                settings.leverageMode === 'auto' && profile
                  ? `COTA 추천 배율(${profile.style === 'aggressive' ? '공격적' : '보수적'})`
                  : `레버리지 ${settings.leverage}x 고정`
              } · 코인 ${counts.crypto}건 · 주식선물 ${counts.stock}건`}
        </span>
      </div>

      <div className="card-grid">
        {shown.map(({ signal, stale }) => (
          <SignalCard
            key={favoriteKey(signal)}
            signal={signal}
            leverage={settings.leverage}
            leverageMode={settings.leverageMode}
            profile={profile}
            riskPct={settings.riskPct}
            contract={contractBySymbol.get(signal.symbol) ?? null}
            onOpen={onOpen}
            isFavorite={isFavorite(signal)}
            onToggleFavorite={onToggleFavorite}
            isMyTrade={mineKeys.has(signalKey(signal))}
            onToggleMyTrade={() => onToggleMyTrade(signalKey(signal))}
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
              {activeQuick
                ? `${activeQuick.hint} — 지금은 고승률 셋업이 없습니다`
                : favOnly
                  ? `즐겨찾기 안에 '${query.trim()}' 검색 결과가 없습니다`
                  : `'${query.trim()}' 검색 결과가 없습니다`}
            </div>
            <p>
              {activeQuick
                ? `${activeQuick.hint}는 현재 승률 55%·손익비 1.5R 기준을 통과한 전략이 없어 시그널을 만들지 않았습니다. 기준을 잠시 낮춰 최근 셋업을 보거나, 다른 종목으로 돌아가세요.`
                : '심볼 전체(BTCUSDT)나 전략명(EMA, CRT, SuperTrend) 일부로 다시 검색해 보세요. 진행중만 토글을 끄면 종료된 이전 시그널도 검색됩니다.'}
            </p>
            <div className="empty-actions">
              {activeQuick ? (
                <button
                  onClick={() => {
                    setQuery('');
                    setOnlyOpen(true);
                  }}
                  className="primary"
                >
                  퀵 필터 해제
                </button>
              ) : (
                <button onClick={() => setQuery('')} className="primary">
                  검색어 지우기
                </button>
              )}
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
            <div className="empty-title">조건을 통과한 시그널이 없습니다</div>
            <p>
              현재 {marketCount}개 마켓을 200봉 기준으로 다시 계산했지만, 고승률 기준(승률 55% ·
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
        실시간 비트겟 캔들(1H/4H, 200봉) 기반 · 마지막 스캔{' '}
        {state.finishedAt ? new Date(state.finishedAt).toLocaleTimeString('ko-KR', { hour12: false }) : '-'} ·
        자동 갱신 {settings.refreshSec ? `${settings.refreshSec}초` : '꺼짐'} · 즐겨찾기 {scanFavorites.length}개 저장됨
      </div>
    </div>
  );
}
