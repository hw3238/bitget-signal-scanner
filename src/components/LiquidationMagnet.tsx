import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import type { Candle } from '../engine/types';
import { analyzeMagnet, rankMagnets, type MagnetResult } from '../engine/liquidationMagnet';
import { fetchBigCandles, mapLimit } from '../api/publicMarket';
import { oiChangePct, recordOiSnapshot } from '../lib/oiSnapshot';
import { fmtPct, fmtPrice, fmtTime, fmtVolume } from '../lib/format';
import { bitgetFuturesUrl, binanceTradeUrl } from '../lib/coinLogo';
import { openBitgetFutures, openExternalUrl } from '../lib/native';
import { EXCHANGES, type Exchange } from '../lib/exchange';
import { ArrowUpRightIcon, RefreshIcon } from './Icons';
import { CoinLogo } from './CoinLogo';

/** 한 번에 계산할 종목 수 — 캔들 2회/종목이라 12개면 요청 24회 */
const TOP_N = 12;
const BARS_1H = 200;
const BARS_4H = 120;

interface Props {
  exchange: Exchange;
  state: ScanState;
}

export function LiquidationMagnet({ exchange, state }: Props) {
  const [rows, setRows] = useState<MagnetResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const running = useRef(false);

  const derivatives = exchange === 'bitget' || state.source === 'binance-futures';

  /** 거래대금 상위 코인 — 지금 스캐너가 들고 있는 실시간 티커 그대로 */
  const universe = useMemo(() => {
    const bases = new Map(state.contracts.filter((c) => c.asset === 'crypto').map((c) => [c.symbol, c]));
    return state.tickers
      .filter((t) => bases.has(t.symbol) && t.quoteVolume > 0 && t.last > 0)
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, TOP_N)
      .map((t) => ({ ticker: t, contract: bases.get(t.symbol)! }));
  }, [state.contracts, state.tickers]);

  const load = useCallback(async () => {
    if (running.current || universe.length === 0) return;
    running.current = true;
    setLoading(true);
    setError(null);
    setProgress(0);
    try {
      // OI 변동률 — 이 화면을 연 시점의 OI 를 남기고 지난 관측값과 비교한다(없으면 null).
      const oiNow: Record<string, number> = {};
      for (const u of universe) {
        const base = Number(u.ticker.openInterestBase ?? 0);
        if (base > 0) oiNow[u.ticker.symbol] = base * u.ticker.last;
      }
      const baseline = recordOiSnapshot(oiNow);

      const out: MagnetResult[] = [];
      let done = 0;
      await mapLimit(universe, 2, async (u) => {
        try {
          const [c1, c4] = await Promise.all([
            fetchBigCandles(exchange, u.ticker.symbol, '1H', BARS_1H),
            fetchBigCandles(exchange, u.ticker.symbol, '4H', BARS_4H).catch(() => [] as Candle[]),
          ]);
          const oiUsd = Number(u.ticker.openInterestBase ?? 0) * u.ticker.last;
          const res = analyzeMagnet({
            symbol: u.ticker.symbol,
            base: u.contract.base,
            price: u.ticker.last,
            high24h: u.ticker.high24h,
            low24h: u.ticker.low24h,
            openInterestUsd: oiUsd,
            fundingRate: u.ticker.fundingRate,
            oiChangePct: baseline ? oiChangePct(oiNow[u.ticker.symbol] ?? 0, baseline.oi[u.ticker.symbol]) : null,
            candles1h: c1,
            candles4h: c4,
            decimals: u.contract.decimals,
            derivatives,
          });
          if (res) out.push(res);
        } catch {
          /* 개별 종목 실패는 건너뛴다 */
        }
        done += 1;
        setProgress(Math.round((done / Math.max(1, universe.length)) * 100));
      });
      setRows(rankMagnets(out));
      setAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : '청산 자석을 계산하지 못했습니다');
    } finally {
      setLoading(false);
      running.current = false;
    }
  }, [derivatives, exchange, universe]);

  useEffect(() => {
    if (universe.length > 0 && !running.current) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe.length, exchange]);

  const openExchange = (symbol: string) => {
    void (exchange === 'bitget'
      ? openBitgetFutures(symbol, bitgetFuturesUrl(symbol))
      : openExternalUrl(binanceTradeUrl(symbol)));
  };

  const top = rows[0];
  const upCount = rows.filter((r) => r.bias === 'up').length;
  const downCount = rows.filter((r) => r.bias === 'down').length;

  return (
    <div className="tab magnet-tab" data-magnet>
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">
              🧲 청산 자석 레이더
              <span className="tool-badge">0~100점</span>
              {top && (
                <span className={`tool-badge ${top.bias === 'down' ? 'down' : 'up'}`}>
                  TOP {top.base} {top.squeeze}점
                </span>
              )}
            </div>
            <div className="summary-sub" data-magnet-sub>
              {EXCHANGES[exchange].universeLabel} 24h 거래대금 상위 {universe.length}종목 · 1H {BARS_1H}봉 · 4H {BARS_4H}봉 ·{' '}
              {at ? `${fmtTime(at)} 기준` : '계산 중'}
            </div>
          </div>
          <button className={`rescan ${loading ? 'busy' : ''}`} onClick={() => void load()} disabled={loading} data-magnet-rescan>
            <RefreshIcon size={15} />
            {loading ? `${progress}%` : '다시 계산'}
          </button>
        </div>

        <div className="magnet-kpis">
          <div className="magnet-kpi">
            <span>위쪽 자석 우세</span>
            <b className="up" data-magnet-up-count>
              {upCount}종목
            </b>
            <em>숏 청산 · 숏스퀴즈</em>
          </div>
          <div className="magnet-kpi">
            <span>아래쪽 자석 우세</span>
            <b className="down" data-magnet-down-count>
              {downCount}종목
            </b>
            <em>롱 청산 · 투매</em>
          </div>
          <div className="magnet-kpi">
            <span>가장 강한 자석</span>
            <b>{top ? `${top.squeeze}점` : '—'}</b>
            <em>{top ? `${top.base} ${top.bias === 'up' ? '상방' : top.bias === 'down' ? '하방' : '균형'}` : '계산 중'}</em>
          </div>
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}
      {!derivatives && (
        <div className="notice" data-magnet-spot>
          {EXCHANGES[exchange].koName} 현물 데이터 모드 — 펀딩비·미결제약정이 없어 <b>스윙 구조만으로</b> 자석을 추정합니다.
        </div>
      )}

      {rows.map((r, idx) => {
        const expanded = open === r.symbol;
        return (
          <article
            className={`magnet-card ${r.bias}`}
            key={r.symbol}
            data-card={r.symbol}
            data-squeeze={r.squeeze}
            data-bias={r.bias}
            onClick={() => setOpen(expanded ? null : r.symbol)}
          >
            <header className="magnet-head">
              <span className="magnet-rank">{idx + 1}</span>
              <CoinLogo base={r.base} asset="crypto" side={r.bias === 'down' ? 'short' : 'long'} size={34} />
              <div className="magnet-name">
                <b>{r.base}</b>
                <span>
                  {fmtPrice(r.price, r.decimals)} · 24h {fmtPct(state.tickers.find((t) => t.symbol === r.symbol)?.change24h ?? NaN, 2)}
                </span>
              </div>
              <span className={`magnet-bias ${r.bias}`}>
                {r.bias === 'up' ? '🔺 상방 우세' : r.bias === 'down' ? '🔻 하방 우세' : '⚖️ 균형'}
              </span>
            </header>

            <div className="magnet-gauges">
              <div className="magnet-gauge up">
                <span className="magnet-gauge-label">상방 숏 청산</span>
                <div className="magnet-gauge-track">
                  <span data-up-score={r.up.score} style={{ width: `${r.up.score}%` }} />
                </div>
                <b>{r.up.score}</b>
                <em>{r.up.main ? `${fmtPrice(r.up.main.price, r.decimals)} (+${r.up.main.distancePct.toFixed(1)}%)` : '—'}</em>
              </div>
              <div className="magnet-gauge down">
                <span className="magnet-gauge-label">하방 롱 청산</span>
                <div className="magnet-gauge-track">
                  <span data-down-score={r.down.score} style={{ width: `${r.down.score}%` }} />
                </div>
                <b>{r.down.score}</b>
                <em>{r.down.main ? `${fmtPrice(r.down.main.price, r.decimals)} (−${r.down.main.distancePct.toFixed(1)}%)` : '—'}</em>
              </div>
            </div>

            <div className="magnet-chips">
              <span className={r.fundingRate > 0 ? 'down' : r.fundingRate < 0 ? 'up' : ''}>{r.fundingLabel}</span>
              <span>{r.oiUsd > 0 ? `OI ${fmtVolume(r.oiUsd)}` : 'OI 정보 없음'}</span>
              {r.oiChangePct != null && <span className={r.oiChangePct >= 3 ? 'up' : ''}>OI {fmtPct(r.oiChangePct, 1)}</span>}
              <span>{r.bars}봉 분석</span>
            </div>

            <p className="magnet-note">{r.note}</p>

            {expanded && (
              <div className="magnet-detail" data-magnet-detail>
                <div className="magnet-levels">
                  <div className="magnet-levels-head">
                    <span>레버리지</span>
                    <span>상방 청산가</span>
                    <span>하방 청산가</span>
                  </div>
                  {[10, 20, 25, 50].map((lev) => {
                    const up = r.up.top?.levels.find((l) => l.leverage === lev);
                    const down = r.down.top?.levels.find((l) => l.leverage === lev);
                    return (
                      <div className="magnet-levels-row" key={lev}>
                        <span>{lev}x</span>
                        <span className="up">{up ? `${fmtPrice(up.price, r.decimals)} (${up.distancePct.toFixed(1)}%)` : '—'}</span>
                        <span className="down">{down ? `${fmtPrice(down.price, r.decimals)} (${down.distancePct.toFixed(1)}%)` : '—'}</span>
                      </div>
                    );
                  })}
                </div>

                {r.up.clusters.length > 0 && (
                  <div className="magnet-clusters">
                    <b>위쪽 청산 뭉치</b>
                    {r.up.clusters.map((c) => (
                      <div key={`u-${c.center}`}>
                        <span className="up">{fmtPrice(c.center, r.decimals)}</span>
                        <span>{c.touches}회 접촉</span>
                        <span>{Math.round(c.weight * 100)}% 강도</span>
                        <span>{c.liqUsd ? `≈${fmtVolume(c.liqUsd)}` : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
                {r.down.clusters.length > 0 && (
                  <div className="magnet-clusters">
                    <b>아래쪽 청산 뭉치</b>
                    {r.down.clusters.map((c) => (
                      <div key={`d-${c.center}`}>
                        <span className="down">{fmtPrice(c.center, r.decimals)}</span>
                        <span>{c.touches}회 접촉</span>
                        <span>{Math.round(c.weight * 100)}% 강도</span>
                        <span>{c.liqUsd ? `≈${fmtVolume(c.liqUsd)}` : ''}</span>
                      </div>
                    ))}
                  </div>
                )}

                {r.warnings.length > 0 && (
                  <ul className="magnet-warnings">
                    {r.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}

                <button
                  className="ghost-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    openExchange(r.symbol);
                  }}
                >
                  {EXCHANGES[exchange].koName}에서 보기 <ArrowUpRightIcon size={11} />
                </button>
              </div>
            )}
          </article>
        );
      })}

      {!rows.length && !loading && !error && (
        <div className="notice">{universe.length ? '계산을 시작합니다…' : '거래소 티커를 기다리는 중입니다.'}</div>
      )}

      <div className="feed-note">
        청산가는 진입가 ± (1/레버리지 − 유지증거금률 {(0.004 * 100).toFixed(1)}%) 로 계산하고, 뭉치 강도는 스윙 접촉 횟수·봉
        거래량·최신성·타임프레임으로 매깁니다. 거래소가 청산 좌표를 공개하지 않으므로 <b>이 값은 추정</b>이며, 청산 물량(USDT)은
        OI 의 일부가 뭉치에 몰려 있다고 보는 보수적 가정입니다. 투자 권유가 아닙니다.
      </div>
    </div>
  );
}
