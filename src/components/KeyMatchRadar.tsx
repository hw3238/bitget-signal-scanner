import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import type { Candle } from '../engine/types';
import { fetchBigCandles, mapLimit } from '../api/publicMarket';
import { analyzeLag, lagCandidates, type LagRow } from '../lib/calc';
import { fmtPct, fmtPrice, fmtTime } from '../lib/format';
import { ArrowUpRightIcon, RefreshIcon } from './Icons';
import { bitgetFuturesUrl } from '../lib/coinLogo';
import { openBitgetFutures } from '../lib/native';

const TOP_N = 30;
const CANDLE_COUNT = 60;

export function KeyMatchRadar({ state }: { state: ScanState }) {
  const [bars, setBars] = useState(4);
  const [btcCloses, setBtcCloses] = useState<number[]>([]);
  const [series, setSeries] = useState<Map<string, { closes: number[]; last: number; base: string }>>(new Map());
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const running = useRef(false);

  /** 비트겟 24h 거래대금 상위 코인 + BTC */
  const universe = useMemo(() => {
    const crypto = state.contracts.filter((c) => c.asset === 'crypto');
    const bases = new Map(crypto.map((c) => [c.symbol, c.base]));
    return state.tickers
      .filter((t) => bases.has(t.symbol) && t.quoteVolume > 0)
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, TOP_N + 1)
      .map((t) => ({ symbol: t.symbol, base: bases.get(t.symbol) ?? t.symbol.replace(/USDT$/, ''), last: t.last }));
  }, [state.contracts, state.tickers]);

  const load = useCallback(async () => {
    if (running.current || universe.length === 0) return;
    running.current = true;
    setLoading(true);
    setError(null);
    setProgress(0);
    try {
      const btcSym = universe.find((u) => u.symbol === 'BTCUSDT') ? 'BTCUSDT' : 'BTCUSDT';
      const btc = await fetchBigCandles(btcSym, '1H', CANDLE_COUNT);
      setBtcCloses(btc.map((c: Candle) => c.c));
      const list = universe.filter((u) => u.symbol !== 'BTCUSDT');
      const next = new Map<string, { closes: number[]; last: number; base: string }>();
      let done = 0;
      await mapLimit(list, 2, async (coin) => {
        try {
          const rows = await fetchBigCandles(coin.symbol, '1H', CANDLE_COUNT);
          next.set(coin.symbol, { closes: rows.map((c) => c.c), last: coin.last, base: coin.base });
        } catch {
          /* 개별 종목 실패는 건너뛴다 */
        }
        await new Promise((r) => setTimeout(r, 120));
        done += 1;
        setProgress(Math.round((done / Math.max(1, list.length)) * 100));
      });
      setSeries(next);
      setAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : '캔들을 불러오지 못했습니다');
    } finally {
      setLoading(false);
      running.current = false;
    }
  }, [universe]);

  useEffect(() => {
    if (universe.length > 0 && series.size === 0 && !loading) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe.length]);

  const rows = useMemo<LagRow[]>(() => {
    if (btcCloses.length === 0) return [];
    const out: LagRow[] = [];
    for (const [symbol, s] of series) {
      const row = analyzeLag(btcCloses, s.closes, bars, { symbol, base: s.base, last: s.last });
      if (row) out.push(row);
    }
    return out.sort((a, b) => b.corr - a.corr);
  }, [btcCloses, series, bars]);

  const btcChange = rows.length ? rows[0].btcChangePct : 0;
  const btc24 = useMemo(() => {
    if (btcCloses.length < 25) return 0;
    return (btcCloses[btcCloses.length - 1] / btcCloses[btcCloses.length - 25] - 1) * 100;
  }, [btcCloses]);

  const candidates = useMemo(() => lagCandidates(rows, 0.65, 0.5), [rows]);
  const longs = candidates.filter((r) => r.watch === 'long' && r.gapPct > 0);
  const shorts = candidates.filter((r) => r.watch === 'short' && r.gapPct < 0);

  const list = (title: string, tone: 'long' | 'short', items: LagRow[], hint: string) => (
    <section className="panel">
      <header className="panel-head">
        <h3>
          {tone === 'long' ? '🟥' : '🟦'} {title}
        </h3>
        <span className="panel-note">{items.length}종목</span>
      </header>
      <p className="panel-note lag-hint">{hint}</p>
      <ul className="lag-list">
        {items.slice(0, 8).map((r) => (
          <li key={r.symbol}>
            <div className="lag-main">
              <b>{r.base}</b>
              <span>
                상관 {r.corr.toFixed(2)} · BTC {fmtPct(r.btcChangePct, 2)} / 알트 {fmtPct(r.altChangePct, 2)}
              </span>
            </div>
            <div className={`lag-gap ${tone}`}>
              <b>{tone === 'long' ? '+' : ''}{r.gapPct.toFixed(2)}%p</b>
              <span>{tone === 'long' ? '덜 오름' : '덜 빠짐'}</span>
            </div>
            <div className="lag-price">{fmtPrice(r.last)}</div>
            <button
              className="lag-link"
              aria-label={`${r.base} 비트겟 열기`}
              onClick={() => void openBitgetFutures(r.symbol, bitgetFuturesUrl(r.symbol))}
            >
              <ArrowUpRightIcon size={14} />
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="mv-empty">조건에 맞는 후발주자가 없습니다</li>}
      </ul>
    </section>
  );

  return (
    <div className="tab lag-tab">
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">
              🎯 키맞추기 레이더
              <span className={`tool-badge ${btcChange >= 0 ? 'up' : 'down'}`}>
                BTC {fmtPct(btcChange, 2)}
              </span>
            </div>
            <div className="summary-sub">
              BTC 최근 {bars}시간 · 24시간 {fmtPct(btc24, 2)} · 1시간봉 {CANDLE_COUNT}개 상관분석 ·{' '}
              {at ? `${fmtTime(at)} 기준` : '분석 중'}
            </div>
          </div>
          <button className={`rescan ${loading ? 'busy' : ''}`} onClick={() => void load()} disabled={loading}>
            <RefreshIcon size={15} />
            {loading ? `${progress}%` : '다시 분석'}
          </button>
        </div>
        <div className="segmented lag-window">
          {[4, 6].map((v) => (
            <button key={v} className={bars === v ? 'on' : ''} onClick={() => setBars(v)}>
              최근 {v}시간 괴리
            </button>
          ))}
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}

      {list('롱 후발주자 · 덜 오른 코인', 'long', longs, 'BTC는 올랐는데 아직 덜 오른 종목 (상관 0.65↑ · 괴리 0.5%p↑)')}
      {list('숏 후발주자 · 덜 빠진 코인', 'short', shorts, 'BTC는 빠졌는데 아직 덜 빠진 종목 (상관 0.65↑ · 괴리 0.5%p↑)')}

      <section className="panel">
        <header className="panel-head">
          <h3>상관계수 전체 순위</h3>
          <span className="panel-note">1시간 수익률 기준</span>
        </header>
        <div className="kimchi-table lag-table">
          <div className="kimchi-head">
            <span>코인</span>
            <span>상관</span>
            <span>BTC {bars}h</span>
            <span>괴리</span>
          </div>
          {rows.slice(0, 12).map((r) => (
            <div key={r.symbol} className="kimchi-row">
              <span className="kimchi-base">{r.base}</span>
              <span className={r.corr >= 0.65 ? 'up' : ''}>{r.corr.toFixed(2)}</span>
              <span>{fmtPct(r.btcChangePct, 2)}</span>
              <span className={Math.abs(r.gapPct) >= 0.5 ? (r.gapPct > 0 ? 'up' : 'down') : ''}>
                {r.gapPct >= 0 ? '+' : ''}
                {r.gapPct.toFixed(2)}%p
              </span>
            </div>
          ))}
          {!rows.length && <div className="mv-empty">{loading ? '분석 중…' : '데이터 없음'}</div>}
        </div>
      </section>

      <div className="feed-note">
        비트겟 USDT-M 24h 거래대금 상위 {TOP_N}종목 + BTC의 1시간봉 {CANDLE_COUNT}개를 직접 불러와 계산합니다.
        괴리는 “BTC가 움직인 만큼 알트가 아직 따라오지 않은 정도”이며, 늦게 따라오는 성질이 항상 보장되지는
        않습니다.
      </div>
    </div>
  );
}
