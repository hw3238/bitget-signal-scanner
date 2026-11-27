import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import type { WhaleTrade } from '../engine/whaleTape';
import {
  DEFAULT_WHALE_THRESHOLD,
  HUGE_WHALE_USD,
  WHALE_THRESHOLDS,
  absorbTrade,
  filterWhaleRows,
  fmtTapeTime,
  fmtUsdShort,
  summarizeWhales,
  sweepKey,
  thresholdLabel,
  type WhaleSideFilter,
  type WhaleThreshold,
} from '../engine/whaleTape';
import { pickWhaleSymbols, startWhaleFeed, type WhaleFeedStatus } from '../api/whaleTape';
import { fmtPrice, fmtTime } from '../lib/format';
import { EXCHANGES, type Exchange } from '../lib/exchange';
import { CoinLogo } from './CoinLogo';
import { RefreshIcon } from './Icons';

interface Props {
  exchange: Exchange;
  state: ScanState;
}

/** 테이프가 담아 두는 최대 줄 수 — 넘치면 오래된 것부터 버린다 */
const MAX_ROWS = 300;
/** 이 금액 아래 체결은 어떤 필터로도 보이지 않으므로 버퍼에 넣지 않는다(가장 낮은 기준) */
const BUFFER_MIN_USD = WHALE_THRESHOLDS[0];

function upsertRow(list: WhaleTrade[], row: WhaleTrade): WhaleTrade[] {
  const next = [row, ...list.filter((r) => r.id !== row.id)];
  next.sort((a, b) => b.at - a.at);
  return next.length > MAX_ROWS ? next.slice(0, MAX_ROWS) : next;
}

export function WhaleTapeTab({ exchange, state }: Props) {
  const symbols = useMemo(
    () => pickWhaleSymbols(state.contracts, state.tickers),
    [state.contracts, state.tickers],
  );
  // 상위 15종목의 '순서'만 바뀌면 재연결하지 않는다(구성 변화에만 다시 붙는다).
  const symbolKey = useMemo(() => [...symbols].sort().join(','), [symbols]);

  const [rows, setRows] = useState<WhaleTrade[]>([]);
  const [status, setStatus] = useState<WhaleFeedStatus>({
    phase: 'connecting',
    stream: '연결 중',
    symbols,
    rate: 0,
    connectedAt: 0,
    error: null,
  });
  const [minUsd, setMinUsd] = useState<WhaleThreshold>(DEFAULT_WHALE_THRESHOLD);
  const [side, setSide] = useState<WhaleSideFilter>('all');
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  /** 일시정지 동안 도착한 줄 — 재개할 때 한꺼번에 보여 준다 */
  const deferredRef = useRef<WhaleTrade[]>([]);
  const rowsRef = useRef<WhaleTrade[]>([]);
  const dirtyRef = useRef(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  /* 실시간 스트림 — 이 화면이 열려 있는 동안만 붙는다 */
  useEffect(() => {
    rowsRef.current = [];
    deferredRef.current = [];
    setRows([]);
    setStatus({ phase: 'connecting', stream: '연결 중', symbols, rate: 0, connectedAt: 0, error: null });
    const active = new Map<string, WhaleTrade>();

    const feed = startWhaleFeed({
      exchange,
      symbols,
      onStatus: setStatus,
      onTrades: (trades) => {
        for (const trade of trades) {
          const key = sweepKey(trade);
          const { sweep } = absorbTrade(active.get(key), trade);
          active.set(key, sweep);
          // 가장 낮은 기준($50K)에도 못 미치는 체결은 화면에 나올 수 없으니 버린다.
          if (!(sweep.usd >= BUFFER_MIN_USD)) continue;
          if (pausedRef.current) {
            deferredRef.current = upsertRow(deferredRef.current, sweep);
            continue;
          }
          rowsRef.current = upsertRow(rowsRef.current, sweep);
          dirtyRef.current = true;
        }
      },
    });

    // 체결마다 리렌더하지 않고 0.4초마다 모아서 한 번에 그린다.
    const flush = setInterval(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      setRows(rowsRef.current);
    }, 400);

    return () => {
      clearInterval(flush);
      feed.stop();
    };
    // symbols 는 symbolKey 로 고정한다(스캔할 때마다 재연결하지 않게).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchange, symbolKey]);

  const resume = () => {
    const pending = deferredRef.current;
    deferredRef.current = [];
    for (const row of pending) rowsRef.current = upsertRow(rowsRef.current, row);
    setRows(rowsRef.current);
    dirtyRef.current = false;
    setPaused(false);
  };

  const filtered = useMemo(() => filterWhaleRows(rows, { minUsd, side, query }), [rows, minUsd, side, query]);
  /** 순매수 집계는 방향 필터와 무관하게 **매수·매도 양쪽**을 모두 모아 계산한다(비율의 의미 유지) */
  const summary = useMemo(
    () => summarizeWhales(filterWhaleRows(rows, { minUsd, side: 'all', query: '' })),
    [rows, minUsd],
  );
  const decimalsOf = useMemo(() => {
    const map = new Map<string, number | undefined>();
    for (const c of state.contracts) map.set(c.symbol, c.decimals);
    return map;
  }, [state.contracts]);

  const buyPct = Math.round(summary.buyRatio * 100);
  const live = status.phase === 'live' || status.phase === 'rest';
  const phaseLabel =
    status.phase === 'live'
      ? '실시간 연결'
      : status.phase === 'rest'
        ? 'REST 폴백'
        : status.phase === 'connecting'
          ? '연결 중'
          : status.phase === 'stopped'
            ? '중지'
            : '오류';

  return (
    <div className="tab whale-tab" data-whale-tape>
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">
              🐋 고래 체결 테이프
              <span className={`tool-badge ${live ? 'live' : 'down'}`} data-whale-phase={status.phase}>
                {phaseLabel}
              </span>
            </div>
            <div className="summary-sub" data-whale-status>
              {status.stream} · 유동성 상위 {symbols.length}종목
              {status.rate > 0 ? ` · 초당 ${status.rate.toFixed(1)}건 관측` : ' · 체결 대기'}
              {status.connectedAt ? ` · ${fmtTime(status.connectedAt)} 연결` : ''}
            </div>
          </div>
          <button
            type="button"
            className={`rescan ${paused ? 'busy' : ''}`}
            onClick={() => (paused ? resume() : setPaused(true))}
            data-whale-pause
          >
            {paused ? '▶ 재개' : '❚❚ 일시정지'}
          </button>
        </div>

        <div className="whale-ratio" data-whale-ratio>
          <div className="whale-ratio-head">
            <span className="whale-ratio-buy">
              고래 매수 <b>{fmtUsdShort(summary.buyUsd)}</b>
            </span>
            <span className="whale-ratio-pct">{buyPct}%</span>
            <span className="whale-ratio-sell">
              고래 매도 <b>{fmtUsdShort(summary.sellUsd)}</b>
            </span>
          </div>
          <div className="whale-ratio-bar" aria-hidden>
            <span className="whale-ratio-fill" style={{ width: `${Math.max(2, Math.min(100, buyPct))}%` }} />
          </div>
          <div className="whale-ratio-foot">
            <span>관측 체결 {summary.count}건 · 초대형 {summary.huge}건</span>
            <span>
              {thresholdLabel(minUsd)} 이상 기준
              {summary.since ? ` · ${fmtTime(summary.since)}부터` : ''}
            </span>
          </div>
        </div>

        <div className="whale-top" data-whale-top>
          {summary.top.length === 0 && (
            <div className="mv-empty">
              {minUsd > WHALE_THRESHOLDS[0]
                ? `${thresholdLabel(minUsd)} 체결을 기다리는 중입니다. 기준을 낮추면 바로 보입니다.`
                : '아직 고래 체결이 없습니다. 체결이 들어오면 여기에 바로 표시됩니다.'}
            </div>
          )}
          {summary.top.map((coin, i) => (
            <div className="whale-top-row" key={coin.base} data-whale-top-coin={coin.base}>
              <span className="whale-top-rank">{i + 1}</span>
              <CoinLogo base={coin.base} asset="crypto" size={22} />
              <b>{coin.base}</b>
              <span className={`whale-top-net ${coin.netUsd >= 0 ? 'up' : 'down'}`}>
                {coin.netUsd >= 0 ? '순매수 ' : '순매도 '}
                {fmtUsdShort(Math.abs(coin.netUsd))}
              </span>
              <span className="whale-top-total">총 {fmtUsdShort(coin.usd)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>실시간 테이프</h3>
          <span className="panel-note">
            {paused ? '일시정지 — 재개하면 그동안의 체결이 한 번에 나옵니다' : `${fmtUsdShort(minUsd)} 이상 체결`}
          </span>
        </header>

        <div className="segmented whale-filters" data-whale-thresholds>
          {WHALE_THRESHOLDS.map((v) => (
            <button
              key={v}
              className={minUsd === v ? 'on' : ''}
              onClick={() => setMinUsd(v)}
              data-whale-threshold={v}
            >
              {thresholdLabel(v)}
            </button>
          ))}
        </div>

        <div className="whale-filter-row">
          <div className="segmented whale-sides" data-whale-sides>
            {(
              [
                { key: 'all', label: '전체' },
                { key: 'buy', label: '고래 매수' },
                { key: 'sell', label: '고래 매도' },
              ] as Array<{ key: WhaleSideFilter; label: string }>
            ).map((s) => (
              <button key={s.key} className={side === s.key ? 'on' : ''} onClick={() => setSide(s.key)} data-whale-side={s.key}>
                {s.label}
              </button>
            ))}
          </div>
          <input
            className="whale-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="코인 검색"
            aria-label="코인 검색"
            data-whale-search
          />
        </div>

        <div className="whale-list" data-whale-list>
          <div className="whale-list-head">
            <span>시각</span>
            <span>코인</span>
            <span>방향</span>
            <span>체결 금액</span>
            <span>체결가</span>
          </div>
          {filtered.length === 0 && (
            <div className="whale-empty" data-whale-empty>
              <b>{thresholdLabel(minUsd)} 이상 체결이 아직 없습니다</b>
              <span>
                지금 시장이 조용한 구간입니다. {status.rate > 0 ? `초당 ${status.rate.toFixed(1)}건을 관측 중이고, ` : ''}
                기준을 낮추면 더 많이 볼 수 있습니다.
              </span>
              {minUsd !== WHALE_THRESHOLDS[0] && (
                <button type="button" className="ghost-btn small" onClick={() => setMinUsd(WHALE_THRESHOLDS[0])}>
                  <RefreshIcon size={13} /> {thresholdLabel(WHALE_THRESHOLDS[0])}로 낮추기
                </button>
              )}
            </div>
          )}
          {filtered.map((row) => {
            const huge = row.usd >= HUGE_WHALE_USD;
            return (
              <div
                className={`whale-row ${row.side}${huge ? ' huge' : ''}`}
                key={row.id}
                data-whale-row
                data-side={row.side}
                data-usd={Math.round(row.usd)}
                data-base={row.base}
              >
                <span className="whale-time">{fmtTapeTime(row.at)}</span>
                <span className="whale-coin">
                  <CoinLogo base={row.base} asset="crypto" size={24} />
                  <b>{row.base}</b>
                  {row.fills > 1 && <i className="whale-fills">{row.fills}건</i>}
                </span>
                <span className={`whale-side ${row.side}`}>{row.side === 'buy' ? '매수' : '매도'}</span>
                <span className="whale-usd">
                  {fmtUsdShort(row.usd)}
                  {huge && <i className="whale-huge">초대형</i>}
                </span>
                <span className="whale-price">{fmtPrice(row.price, decimalsOf.get(row.symbol))}</span>
              </div>
            );
          })}
        </div>

        {status.error && (
          <p className="whale-warn" data-whale-warn>
            {status.error}
          </p>
        )}
      </section>

      <div className="feed-note">
        체결은 {EXCHANGES[exchange].koName}의 실시간 공개 스트림(WebSocket)과 최근 체결 REST를 합쳐 보여 줍니다. 같은 코인·같은
        방향의 분할 체결은 2초 창으로 한 줄로 묶고(금액 합), 필터 금액은 묶인 금액 기준입니다. 화면을 닫으면 연결도 끊깁니다.
        투자 권유가 아닙니다.
      </div>
    </div>
  );
}
