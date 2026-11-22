import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import type { Candle, TF } from '../engine/types';
import { fetchBigCandles } from '../api/publicMarket';
import { findDoppelgangers } from '../lib/calc';
import { fmtDateTime, fmtPct } from '../lib/format';
import { CoinSelect } from './ui';
import { DownloadIcon, RefreshIcon } from './Icons';
import { ImageCardModal } from './ImageCardModal';
import { drawDoppelCard } from './doppelCard';

const PATTERN_OPTIONS = [18, 24, 36];
const FUTURE_BARS = 12;

export function Doppelganger({ state }: { state: ScanState }) {
  const coins = useMemo(
    () =>
      state.contracts
        .filter((c) => c.asset === 'crypto')
        .map((c) => {
          const t = state.tickers.find((x) => x.symbol === c.symbol);
          return { symbol: c.symbol, base: c.base, volume: t?.quoteVolume ?? 0 };
        })
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 100),
    [state.contracts, state.tickers],
  );

  const [symbol, setSymbol] = useState('BTCUSDT');
  const [tf, setTf] = useState<TF>('1H');
  const [patternLen, setPatternLen] = useState(24);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [cardOpen, setCardOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchBigCandles(symbol, tf, 500);
      if (rows.length < patternLen + FUTURE_BARS + 5) throw new Error('캔들이 부족합니다');
      setCandles(rows);
      setAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : '캔들을 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, [symbol, tf, patternLen]);

  useEffect(() => {
    void load();
  }, [load]);

  const result = useMemo(() => {
    if (candles.length === 0) return null;
    return findDoppelgangers(
      candles.map((c) => c.c),
      candles.map((c) => c.t),
      patternLen,
      FUTURE_BARS,
      3,
    );
  }, [candles, patternLen]);

  const base = symbol.replace(/USDT$/, '');

  const chart = useMemo(() => {
    const top = result?.matches[0];
    if (!result || !top) return null;
    const norm = (vals: number[]) => {
      const b = vals[0] || 1;
      return vals.map((v) => (v / b - 1) * 100);
    };
    const cur = norm(result.current);
    const past = norm(top.window);
    const fut = norm([top.window[top.window.length - 1], ...top.future]).map((v) => v + past[past.length - 1]);
    const all = [...cur, ...past, ...fut];
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = hi - lo || 1;
    const W = 320;
    const H = 150;
    const padX = 8;
    const padY = 12;
    const total = past.length + fut.length - 2;
    const x = (i: number) => padX + ((W - padX * 2) * i) / Math.max(1, total);
    const y = (v: number) => padY + (H - padY * 2) * (1 - (v - lo) / span);
    const line = (vals: number[], offset = 0) =>
      vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i + offset).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return {
      W,
      H,
      curPath: line(cur),
      pastPath: line(past),
      futPath: line(fut, past.length - 1),
      zeroY: y(0),
      splitX: x(past.length - 1),
      lo,
      hi,
    };
  }, [result]);

  const draw = useCallback(
    async (canvas: HTMLCanvasElement) => {
      if (!result) return;
      await drawDoppelCard(canvas, { base, tf, at: at || Date.now(), result });
    },
    [result, base, tf, at],
  );

  const matches = result?.matches ?? [];
  const verdict =
    matches.length === 0
      ? null
      : result!.upCount === matches.length
        ? `${matches.length}건 모두 상승`
        : result!.upCount === 0
          ? `${matches.length}건 모두 하락`
          : `${result!.upCount}건 상승 · ${result!.downCount}건 하락`;

  return (
    <div className="tab doppel-tab">
      <section className="panel">
        <header className="panel-head">
          <h3>🔮 차트 도플갱어</h3>
          <span className="panel-note">피어슨 상관 · 최대 500봉</span>
        </header>
        <div className="form-grid">
          <CoinSelect value={symbol} onChange={setSymbol} coins={coins} />
          <div className="num-field">
            <span className="num-label">타임프레임</span>
            <div className="segmented side-seg">
              {(['1H', '4H'] as TF[]).map((v) => (
                <button key={v} className={tf === v ? 'on' : ''} onClick={() => setTf(v)}>
                  {v === '1H' ? '1시간' : '4시간'}
                </button>
              ))}
            </div>
          </div>
          <div className="num-field">
            <span className="num-label">패턴 길이</span>
            <div className="segmented side-seg">
              {PATTERN_OPTIONS.map((v) => (
                <button key={v} className={patternLen === v ? 'on' : ''} onClick={() => setPatternLen(v)}>
                  {v}봉
                </button>
              ))}
            </div>
          </div>
          <div className="num-field">
            <span className="num-label">다시 찾기</span>
            <button className={`rescan ${loading ? 'busy' : ''}`} onClick={() => void load()} disabled={loading}>
              <RefreshIcon size={15} />
              {loading ? '분석 중' : '분석'}
            </button>
          </div>
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}

      {result && matches.length > 0 ? (
        <>
          <section className="summary-card">
            <div className="summary-top">
              <div>
                <div className="summary-title">
                  현재 차트와 가장 닮은 과거 <b>{matches.length}구간</b>
                </div>
                <div className="summary-sub">
                  {verdict} · 이후 {FUTURE_BARS}봉 평균{' '}
                  <b className={result.avgFuturePct >= 0 ? 'up' : 'down'}>{fmtPct(result.avgFuturePct, 2)}</b> · 평균
                  유사도 {(result.avgCorr * 100).toFixed(1)}%
                </div>
              </div>
              <button className="ghost-btn small" onClick={() => setCardOpen(true)}>
                <DownloadIcon size={14} /> PNG 카드
              </button>
            </div>
          </section>

          {chart && (
            <section className="panel">
              <header className="panel-head">
                <h3>겹쳐 보기</h3>
                <span className="panel-note">
                  <i className="legend-dot current" /> 현재
                  <i className="legend-dot past" /> 도플갱어 1위
                  <i className="legend-dot future" /> 이후 실제
                </span>
              </header>
              <svg className="doppel-svg" viewBox={`0 0 ${chart.W} ${chart.H}`} role="img" aria-label="현재 차트와 과거 도플갱어 비교">
                <rect x={chart.splitX} y={0} width={chart.W - chart.splitX} height={chart.H} fill="#F7F8FA" />
                <line x1={0} y1={chart.zeroY} x2={chart.W} y2={chart.zeroY} stroke="#E5E8EB" strokeDasharray="3 3" />
                <path d={chart.pastPath} fill="none" stroke="#8B95A1" strokeWidth={2} strokeLinejoin="round" />
                <path d={chart.futPath} fill="none" stroke="#F5A623" strokeWidth={2.2} strokeDasharray="5 4" strokeLinejoin="round" />
                <path d={chart.curPath} fill="none" stroke="#3182F6" strokeWidth={2.6} strokeLinejoin="round" />
              </svg>
              <div className="chart-legend">
                <span>현재 패턴 {result.patternLen}봉</span>
                <span>과거 구간 이후 {FUTURE_BARS}봉은 점선</span>
              </div>
            </section>
          )}

          <section className="panel">
            <header className="panel-head">
              <h3>닮은 구간 TOP 3</h3>
              <span className="panel-note">{fmtDateTime(at)} 기준</span>
            </header>
            <ul className="doppel-list">
              {matches.map((m, i) => (
                <li key={`${m.endIndex}-${i}`}>
                  <div className="doppel-rank">{i + 1}</div>
                  <div className="doppel-info">
                    <b>{fmtDateTime(m.endAt)} 까지</b>
                    <span>
                      유사도 {m.similarity.toFixed(1)}% · 최고 {fmtPct(m.futureMaxPct, 1)} / 최저{' '}
                      {fmtPct(m.futureMinPct, 1)}
                    </span>
                  </div>
                  <div className={`doppel-after ${m.futureChangePct >= 0 ? 'up' : 'down'}`}>
                    <b>{fmtPct(m.futureChangePct, 2)}</b>
                    <span>이후 {FUTURE_BARS}봉</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <div className="feed-note">
            비트겟 {base} {tf}봉 {candles.length}개 실데이터 · 최근 {patternLen}봉과 겹치지 않는 과거 구간을 피어슨
            상관계수로 비교합니다. 과거 패턴은 미래를 보장하지 않습니다.
          </div>
        </>
      ) : (
        !loading && <div className="notice">{error ?? '분석할 캔들을 불러오는 중입니다.'}</div>
      )}

      {cardOpen && result && (
        <ImageCardModal
          title="차트 도플갱어"
          fileName={`COTA-doppel-${base}-${tf}`}
          draw={draw}
          onClose={() => setCardOpen(false)}
          hint="과거 유사 패턴 카드 — 스레드·텔레그램 공유용. 투자 권유가 아닙니다."
        />
      )}
    </div>
  );
}
