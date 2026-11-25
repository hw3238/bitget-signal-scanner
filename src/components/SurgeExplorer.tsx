import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import type { AutoTradeApi } from '../hooks/useAutoTrade';
import type { AccountBase } from '../lib/account';
import type { Profile } from '../lib/profile';
import type { Candle, Ticker } from '../engine/types';
import { fetchBigCandles, mapLimit } from '../api/publicMarket';
import { readCandles, writeCandles } from '../lib/scanCache';
import {
  matchSurgeFilter,
  rankSurgePicks,
  scoreSurge,
  surgePlanLines,
  surgeSignal,
  surgeUniverse,
  SURGE_FILTERS,
  SURGE_MAX_SCORE,
  type SurgeFilter,
  type SurgePick,
} from '../engine/surge';
import { fmtPct, fmtPrice, fmtTime, fmtVolume } from '../lib/format';
import { copyToClipboard } from '../lib/clipboard';
import { bitgetFuturesUrl } from '../lib/coinLogo';
import { openBitgetFutures } from '../lib/native';
import { CoinLogo } from './CoinLogo';
import { ArrowUpRightIcon, CheckIcon, CopyIcon, RefreshIcon } from './Icons';

/** 캔들 캐시 유효시간 — 1H는 10분, 4H는 20분이면 같은 봉을 다시 받지 않는다(스캐너 캐시와 공유). */
const SURGE_TTL = { '1H': 10 * 60_000, '4H': 20 * 60_000 } as Record<'1H' | '4H', number>;
/** 4H 추세까지 확인할 상위 후보 수 — 1H 점수 상위만 추가 요청한다. */
const CONFIRM_TOP = 12;
/** 공개 API 동시 요청 수(요청 게이트가 간격을 조절한다) */
const FETCH_WORKERS = 4;
const BARS_1H = 200;
const BARS_4H = 60;

interface CandleEntry {
  c1: Candle[];
  c4: Candle[] | null;
  base: string;
  decimals?: number;
  maxLever?: number;
}

const REQ_MARK = ['①', '②', '③', '④', '⑤', '⑥'];
const STATE_MARK: Record<string, string> = { pass: '✓', partial: '△', fail: '✕' };

interface Props {
  state: ScanState;
  account: AccountBase;
  profile: Profile | null;
  autoTrade: AutoTradeApi;
}

export function SurgeExplorer({ state, account, profile, autoTrade }: Props) {
  const [picks, setPicks] = useState<SurgePick[]>([]);
  const [filter, setFilter] = useState<SurgeFilter>('all');
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'1H' | '4H' | 'done'>('1H');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [meta, setMeta] = useState<{ scanned: number; failed: number; eligible: number; coinCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [ordering, setOrdering] = useState<string | null>(null);
  const running = useRef(false);
  const storeRef = useRef(new Map<string, CandleEntry>());
  const btcRef = useRef<Candle[]>([]);

  const universe = useMemo(() => surgeUniverse(state.contracts, state.tickers), [state.contracts, state.tickers]);
  const tickerBySymbol = useMemo(() => new Map(state.tickers.map((t) => [t.symbol, t])), [state.tickers]);

  /** 같은 캔들·같은 설정으로 한 종목을 다시 점수화한다(4H 확인·잔고/스타일 변경 반영). */
  const build = useCallback(
    (symbol: string, ticker: Ticker, entry: CandleEntry): SurgePick | null =>
      scoreSurge({
        symbol,
        base: entry.base,
        candles1h: entry.c1,
        candles4h: entry.c4,
        ticker,
        btc1h: btcRef.current,
        decimals: entry.decimals,
        maxLever: entry.maxLever,
        style: profile?.style,
        equity: account.equity,
      }),
    [account.equity, profile?.style],
  );

  const loadCandles = useCallback(async (symbol: string, tf: '1H' | '4H', limit: number, force: boolean) => {
    const cached = force ? null : readCandles(symbol, tf, SURGE_TTL[tf]);
    if (cached && cached.length >= Math.min(limit, 140)) return cached;
    const rows = await fetchBigCandles(symbol, tf, limit);
    // 스캐너와 같은 캐시를 쓴다 — 다음 스캔·재진입에서 재요청이 사라진다.
    writeCandles(symbol, tf, rows);
    return rows;
  }, []);

  const scan = useCallback(
    async (force = false) => {
      if (running.current) return;
      const rows = universe.rows;
      if (!rows.length) {
        setError('비트겟 코인 선물 목록을 아직 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
        return;
      }
      running.current = true;
      setLoading(true);
      setError(null);
      setPhase('1H');
      setProgress({ done: 0, total: rows.length });
      try {
        /* ---------- 기준선: BTC 1시간봉 ---------- */
        btcRef.current = await loadCandles('BTCUSDT', '1H', BARS_1H, force);
        storeRef.current = new Map();
        const list: SurgePick[] = [];
        let done = 0;
        let failed = 0;

        /* ---------- 1차: 전 종목 1H 캔들 → 6요건 점수 ---------- */
        await mapLimit(rows, FETCH_WORKERS, async (row) => {
          try {
            const c1 = await loadCandles(row.symbol, '1H', BARS_1H, force);
            const entry: CandleEntry = { c1, c4: null, base: row.base, decimals: row.decimals, maxLever: row.maxLever };
            const pick = build(row.symbol, row.ticker, entry);
            if (pick) {
              storeRef.current.set(row.symbol, entry);
              list.push(pick);
            } else {
              failed += 1;
            }
          } catch {
            failed += 1;
          }
          done += 1;
          setProgress({ done, total: rows.length });
        });

        /* ---------- 2차: 상위 후보만 4H 추세 확인 ---------- */
        setPhase('4H');
        const top = rankSurgePicks(list).slice(0, CONFIRM_TOP);
        await mapLimit(top, 2, async (pick) => {
          const entry = storeRef.current.get(pick.symbol);
          const ticker = tickerBySymbol.get(pick.symbol);
          if (!entry || !ticker) return;
          try {
            entry.c4 = await loadCandles(pick.symbol, '4H', BARS_4H, force);
            const next = build(pick.symbol, ticker, entry);
            if (!next) return;
            const i = list.findIndex((p) => p.symbol === pick.symbol);
            if (i >= 0) list[i] = next;
          } catch {
            /* 4H 실패는 추세 '미확인'으로 두고 1H 점수를 그대로 쓴다 */
          }
        });

        setPicks(rankSurgePicks(list));
        setMeta({ scanned: list.length, failed, eligible: universe.eligible, coinCount: universe.coinCount });
        setAt(Date.now());
        setPhase('done');
      } catch (e) {
        setError(e instanceof Error ? e.message : '급등 후보를 탐색하지 못했습니다');
      } finally {
        setLoading(false);
        setProgress((p) => ({ ...p, done: p.total }));
        running.current = false;
      }
    },
    [build, loadCandles, tickerBySymbol, universe.coinCount, universe.eligible, universe.rows],
  );

  useEffect(() => {
    if (universe.rows.length > 0 && picks.length === 0 && !loading) void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe.rows.length]);

  /* 잔고·매매 스타일이 바뀌면(계좌 연결 직후) 캔들을 다시 받지 않고 레버리지·점수만 갱신한다. */
  useEffect(() => {
    if (!picks.length) return;
    const next = picks.map((p) => {
      const entry = storeRef.current.get(p.symbol);
      const ticker = tickerBySymbol.get(p.symbol);
      if (!entry || !ticker) return p;
      return build(p.symbol, ticker, entry) ?? p;
    });
    setPicks(rankSurgePicks(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.equity, profile?.style]);

  const filtered = useMemo(() => picks.filter((p) => matchSurgeFilter(p, filter)), [picks, filter]);
  const primePicks = picks.filter((p) => p.prime);
  const nearPicks = picks.filter((p) => !p.prime).slice(0, 6);
  const top = picks[0];
  const shown = filtered.slice(0, 12);
  const overflow = universe.eligible > universe.rows.length;

  const copyPlan = async (pick: SurgePick) => {
    const ok = await copyToClipboard(surgePlanLines(pick).text);
    if (!ok) return;
    setCopied(pick.symbol);
    window.setTimeout(() => setCopied((cur) => (cur === pick.symbol ? null : cur)), 1600);
  };

  const order = async (pick: SurgePick) => {
    setOrdering(pick.symbol);
    const contract = state.contracts.find((c) => c.symbol === pick.symbol);
    const res = await autoTrade.quickOrder(surgeSignal(pick, { priceEndStep: contract?.priceEndStep }));
    setOrdering(null);
    if (!res.ok) window.alert(res.message);
  };

  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="tab surge-tab" data-surge-root>
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">
              🚀 급등 탐색기
              <span className="tool-badge">6요건 {SURGE_MAX_SCORE}점</span>
              {top && <span className="tool-badge up">TOP {top.base}</span>}
            </div>
            <div className="summary-sub" data-surge-sub>
              {meta
                ? `코인 선물 ${meta.coinCount}개 중 24h 거래대금 ${fmtVolume(universe.minVolume)} 이상 ${meta.eligible}개 탐색 · ${fmtTime(at)} 기준`
                : `코인 선물 유니버스 ${universe.coinCount}개 · 24h 거래대금 ${fmtVolume(universe.minVolume)} 이상 ${universe.eligible}개`}
            </div>
          </div>
          <button className={`rescan ${loading ? 'busy' : ''}`} onClick={() => void scan(true)} disabled={loading} data-surge-rescan>
            <RefreshIcon size={15} />
            {loading ? `${percent}%` : '다시 탐색'}
          </button>
        </div>

        {loading && (
          <div className="surge-progress" data-surge-progress>
            <div className="surge-progress-bar">
              <span style={{ width: `${percent}%` }} />
            </div>
            <span className="surge-progress-text">
              {phase === '4H' ? '4H 추세 확인 중' : '1H 캔들·6요건 계산 중'} · {progress.done}/{progress.total}
            </span>
          </div>
        )}

        <div className="surge-kpis">
          <div className="surge-kpi">
            <span>오늘의 급등 유망 TOP</span>
            <b data-surge-top>{top ? top.base : '—'}</b>
            <em data-surge-top-score>{top ? `${top.score}점 · ${top.passed}/6 · ${top.plan.rr.toFixed(1)}R` : '탐색 중'}</em>
          </div>
          <div className="surge-kpi">
            <span>요건 4개 이상 충족</span>
            <b data-surge-prime-count>{primePicks.length}개</b>
            <em>{picks.length ? `탐색 ${picks.length}종목` : '탐색 중'}</em>
          </div>
          <div className="surge-kpi">
            <span>데이터 부족·실패</span>
            <b data-surge-failed>{meta?.failed ?? 0}개</b>
            <em>캔들 140봉 미만 제외</em>
          </div>
        </div>

        <div className="segmented surge-filters">
          {SURGE_FILTERS.map((f) => {
            const count = f.req ? picks.filter((p) => matchSurgeFilter(p, f.key)).length : picks.length;
            return (
              <button
                key={f.key}
                className={filter === f.key ? 'on' : ''}
                data-filter={f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label} <i>{count}</i>
              </button>
            );
          })}
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}

      {!loading && !error && picks.length > 0 && primePicks.length === 0 && (
        <div className="notice" data-surge-honest>
          지금은 요건 4개 이상을 채운 코인이 없습니다 — 점수가 낮은 후보는 아래 차순위에 그대로 두었습니다.
        </div>
      )}
      {!loading && !error && picks.length === 0 && (
        <div className="notice">{universe.rows.length ? '탐색을 시작합니다…' : '비트겟 코인 선물 목록을 기다리는 중입니다.'}</div>
      )}
      {overflow && (
        <div className="feed-note" data-surge-overflow>
          거래대금 기준을 넘는 코인이 {universe.eligible}개라 상위 {universe.rows.length}개만 탐색했습니다.
        </div>
      )}

      {shown.map((pick, idx) => {
        const plan = surgePlanLines(pick);
        return (
          <article className={`surge-card ${pick.prime ? 'prime' : ''}`} key={pick.symbol} data-symbol={pick.symbol} data-score={pick.score}>
            <header className="surge-head">
              <span className="surge-rank">{idx + 1}</span>
              <CoinLogo base={pick.base} asset="crypto" side="long" size={38} />
              <div className="surge-name">
                <b>
                  {pick.base}
                  <i className="surge-sym">{pick.symbol}</i>
                </b>
                <span>
                  {fmtPrice(pick.price, pick.decimals)} · 24h{' '}
                  <i className={pick.change24h >= 0 ? 'up' : 'down'}>{fmtPct(pick.change24h, 1)}</i> · 거래대금{' '}
                  {fmtVolume(pick.quoteVolume)}
                </span>
              </div>
              <div className="surge-score">
                <b>{pick.score}</b>
                <span>
                  점 · {pick.passed}/6 충족
                </span>
              </div>
            </header>

            <p className="surge-why">{pick.headline}</p>

            <ul className="surge-reqs">
              {pick.reqs.map((req, i) => (
                <li key={req.key} className={`r-${req.state}`} title={req.detail} data-req={req.key} data-state={req.state}>
                  <i>{REQ_MARK[i]}</i>
                  <b>{req.label}</b>
                  <span>{req.value}</span>
                  <em>{STATE_MARK[req.state]}</em>
                </li>
              ))}
            </ul>

            <div className="surge-plan">
              <div className="surge-cell">
                <span>진입가</span>
                <b>{fmtPrice(pick.plan.entry, pick.decimals)}</b>
              </div>
              <div className="surge-cell up">
                <span>목표가 {pick.plan.rr.toFixed(1)}R</span>
                <b>{fmtPrice(pick.plan.target, pick.decimals)}</b>
                <em>{fmtPct(pick.plan.rewardPct, 1)}</em>
              </div>
              <div className="surge-cell down">
                <span>손절가</span>
                <b>{fmtPrice(pick.plan.stop, pick.decimals)}</b>
                <em>-{pick.plan.riskPct.toFixed(1)}%</em>
              </div>
              <div className="surge-cell">
                <span>추천 레버리지</span>
                <b>{pick.plan.leverage}x</b>
                <em title={pick.plan.levNote}>안전마진 {pick.plan.safeMax}x</em>
              </div>
            </div>

            <div className="surge-detail-line">
              손익비 <b>{plan.rr}</b> · 손절 기준{' '}
              {pick.plan.stopBasis === 'swing' ? '직전 스윙 저점' : pick.plan.stopBasis === 'atr' ? 'ATR 1.5배' : pick.plan.stopBasis === 'floor' ? '최소 0.6%' : '최대 12%'} · 펀딩{' '}
              <b>{pick.fundingRate > 0 ? '+' : ''}{pick.fundingRate.toFixed(3)}%</b> · {pick.bars}봉 · {pick.htfChecked ? '4H 확인' : '4H 미확인'}
            </div>

            {pick.warnings.map((w) => (
              <div className="surge-warn" key={w}>
                ⚠️ {w}
              </div>
            ))}

            <div className="surge-actions">
              <button className="ghost-btn small" onClick={() => void copyPlan(pick)} data-copy>
                {copied === pick.symbol ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                {copied === pick.symbol ? '복사됨' : '진입·목표·손절 복사'}
              </button>
              {account.connected ? (
                <button className="surge-order" onClick={() => void order(pick)} disabled={ordering === pick.symbol} data-order>
                  {ordering === pick.symbol ? '주문 중…' : `⚡ ${pick.plan.leverage}x 롱 원클릭`}
                </button>
              ) : (
                <span className="surge-order-hint" data-order-hint>
                  계좌를 연결하면 원클릭 주문
                </span>
              )}
              <button
                className="link-btn"
                onClick={() => void openBitgetFutures(pick.symbol, bitgetFuturesUrl(pick.symbol))}
                aria-label={`${pick.base} 비트겟 열기`}
              >
                비트겟 <ArrowUpRightIcon size={11} />
              </button>
            </div>
          </article>
        );
      })}

      {!loading && filtered.length === 0 && picks.length > 0 && (
        <div className="notice" data-surge-empty-filter>
          「{SURGE_FILTERS.find((f) => f.key === filter)?.label}」 조건을 충족한 코인이 없습니다 — 다른 필터로 보세요.
        </div>
      )}

      {nearPicks.length > 0 && (
        <section className="panel">
          <header className="panel-head">
            <h3>차순위 후보</h3>
            <span className="panel-note">요건 4개 미만 · 참고용</span>
          </header>
          <ul className="surge-near">
            {nearPicks.map((p) => (
              <li key={p.symbol} data-near={p.symbol}>
                <div className="surge-near-main">
                  <b>{p.base}</b>
                  <span>{p.headline}</span>
                </div>
                <div className="surge-near-score">
                  <b>{p.score}</b>
                  <span>
                    {p.passed}/6
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="feed-note">
        비트겟 USDT-M 코인 선물 1시간봉 {BARS_1H}개(상위 후보는 4시간봉 {BARS_4H}개)와 실시간 티커·펀딩비·미결제약정만으로
        계산합니다. 점수는 ①변동성 응축 20 ②거래량 유입 20 ③숏스퀴즈 15 ④BTC 대비 강세 15 ⑤저항 돌파 임박 15 ⑥비과열 15
        = {SURGE_MAX_SCORE}점이며, 이미 급등한 자리는 ⑥에서 감점합니다. 과거 패턴은 미래를 보장하지 않으며 투자 권유가 아닙니다.
      </div>
    </div>
  );
}
