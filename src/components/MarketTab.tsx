import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import type { AssetClass, Ticker } from '../engine/types';
import { fetchFearGreed, fetchFundingRates, type FearGreed, type FundingInfo } from '../api/publicMarket';
import { fmtPct, fmtPrice, fmtVolume } from '../lib/format';
import { EXCHANGES, marketSourceLabel, type Exchange } from '../lib/exchange';
import { recordOiSnapshot, oiChangePct, type OiBaseline } from '../lib/oiSnapshot';
import { ImageCardModal } from './ImageCardModal';
import { drawMarketBriefCard, type MarketBriefData } from './marketBriefCard';
import { DownloadIcon } from './Icons';

interface Props {
  state: ScanState;
  /** 현재 거래소 — 바이낸스 모드에는 주식선물 탭과 비트겟 펀딩 조회를 쓰지 않는다 */
  exchange: Exchange;
  onRescan: () => void;
}

type Tab = 'crypto' | 'stock';

interface Row extends Ticker {
  asset: AssetClass;
  decimals?: number;
  label: string;
  /** 미결제약정 USDT */
  oiUsd: number;
  /** 펀딩 연환산(%) */
  annual: number;
  oiChange: number | null;
}

const SQUEEZE_RATE = 0.05; // 8시간 0.05% (연 54.75%) 이상을 과열로 본다

export function MarketTab({ state, exchange, onRescan }: Props) {
  const [tab, setTab] = useState<Tab>('crypto');
  const bitget = exchange === 'bitget';

  // 바이낸스 모드에는 주식선물이 없다 — 숨은 탭에 머무르지 않게 돌려놓는다.
  useEffect(() => {
    if (!bitget && tab === 'stock') setTab('crypto');
  }, [bitget, tab]);
  const [fearGreed, setFearGreed] = useState<FearGreed | null>(null);
  const [funding, setFunding] = useState<Map<string, FundingInfo>>(new Map());
  const [baseline, setBaseline] = useState<OiBaseline | null>(null);
  const [briefing, setBriefing] = useState(false);
  const [loadingExtra, setLoadingExtra] = useState(false);

  /* 공포·탐욕 + 펀딩 정산 주기 — 실패해도 티커 데이터로 화면은 유지 */
  const loadExtra = useCallback(async () => {
    setLoadingExtra(true);
    // 펀딩 정산 주기·공포탐욕 — 바이낸스 모드에서는 비트겟 펀딩을 섞지 않는다.
    const [fg, fr] = await Promise.allSettled([
      fetchFearGreed(),
      bitget ? fetchFundingRates() : Promise.resolve(new Map<string, FundingInfo>()),
    ]);
    if (fg.status === 'fulfilled') setFearGreed(fg.value);
    if (fr.status === 'fulfilled') setFunding(fr.value);
    setLoadingExtra(false);
  }, [bitget]);

  useEffect(() => {
    void loadExtra();
    const timer = setInterval(() => void loadExtra(), 120_000);
    return () => clearInterval(timer);
  }, [loadExtra]);

  /** OI 스냅샷 — 티커가 갱신될 때마다 기록하고 비교 기준을 잡는다 */
  useEffect(() => {
    if (state.tickers.length === 0) return;
    const oi: Record<string, number> = {};
    for (const t of state.tickers) {
      if (!t.openInterestBase || t.last <= 0) continue;
      oi[t.symbol] = t.openInterestBase * t.last;
    }
    const base = recordOiSnapshot(oi);
    if (base) setBaseline(base);
  }, [state.tickersAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => {
    const assetOf = new Map<string, AssetClass>(state.contracts.map((c) => [c.symbol, c.asset]));
    const decimalsOf = new Map<string, number | undefined>(state.contracts.map((c) => [c.symbol, c.decimals]));
    const rows: Row[] = state.tickers
      .map((t) => {
        const asset = assetOf.get(t.symbol) ?? 'crypto';
        const interval = funding.get(t.symbol)?.interval ?? 8;
        const rate = Number.isFinite(t.fundingRate) ? t.fundingRate : 0;
        const oiUsd = (t.openInterestBase ?? 0) * t.last;
        return {
          ...t,
          asset,
          decimals: decimalsOf.get(t.symbol),
          label: t.symbol.replace(/USDT$/, '').replace(/STOCK$/, ''),
          oiUsd,
          annual: rate * (24 / interval) * 365,
          oiChange: oiChangePct(oiUsd, baseline?.oi[t.symbol]),
        };
      })
      .filter((t) => t.quoteVolume > 150_000 && Number.isFinite(t.change24h));

    const cryptos = rows.filter((r) => r.asset === 'crypto');
    const stocks = rows.filter((r) => r.asset === 'stock');

    const summary = (list: Row[]) => {
      const up = list.filter((r) => r.change24h > 0).length;
      const down = list.filter((r) => r.change24h < 0).length;
      const volume = list.reduce((a, r) => a + r.quoteVolume, 0);
      const fundingRows = list.filter((r) => r.fundingRate !== 0);
      const avgFunding = fundingRows.length ? fundingRows.reduce((a, r) => a + r.fundingRate, 0) / fundingRows.length : 0;
      return { up, down, volume, avgFunding, count: list.length };
    };

    const byChange = (list: Row[]) => [...list].sort((a, b) => b.change24h - a.change24h);
    const byVolume = (list: Row[]) => [...list].sort((a, b) => b.quoteVolume - a.quoteVolume);
    // 펀딩·OI 레이더는 거래대금과 OI가 의미 있는 종목만 — 잡코인 이상치로 표가 덮이지 않게.
    const liquid = (list: Row[]) => list.filter((r) => r.quoteVolume >= 20_000_000 && r.oiUsd >= 1_000_000);
    const byFunding = (list: Row[]) =>
      [...liquid(list)].filter((r) => r.fundingRate !== 0).sort((a, b) => Math.abs(b.annual) - Math.abs(a.annual));
    // 과열이 없어도 항상 펀딩·OI 상위를 보여 준다(과열이면 배지가 경고로 바뀐다).
    const squeeze = (list: Row[]) =>
      [...liquid(list)].sort((a, b) => Math.abs(b.annual) - Math.abs(a.annual));

    const view = (list: Row[]) => ({
      summary: summary(list),
      gainers: byChange(list).slice(0, 6),
      losers: byChange(list).slice(-6).reverse(),
      volume: byVolume(list).slice(0, 6),
      funding: byFunding(list).slice(0, 5),
      squeeze: squeeze(list).slice(0, 6),
      count: list.length,
    });

    return {
      crypto: view(cryptos),
      stock: view(stocks),
      longSqueeze: liquid(cryptos).filter((r) => r.fundingRate >= SQUEEZE_RATE).length,
      shortSqueeze: liquid(cryptos).filter((r) => r.fundingRate <= -SQUEEZE_RATE).length,
      majors: (['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'] as const)
        .map((s) => cryptos.find((r) => r.symbol === s))
        .filter((r): r is Row => !!r),
    };
  }, [state.tickers, state.contracts, funding, baseline]);

  const view = data[tab];
  const refreshed = state.tickersAt
    ? new Date(state.tickersAt).toLocaleTimeString('ko-KR', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Seoul',
      })
    : '-';

  const briefData: MarketBriefData = useMemo(
    () => ({
      at: state.tickersAt || Date.now(),
      fearGreed,
      coins: data.majors.map((m) => ({ base: m.label, price: m.last, change24h: m.change24h })),
      upCount: data.crypto.summary.up,
      downCount: data.crypto.summary.down,
      totalVolume: data.crypto.summary.volume,
      avgFunding: data.crypto.summary.avgFunding,
      hotFunding: data.crypto.funding
        .filter((f) => Math.abs(f.fundingRate) >= 0.01)
        .slice(0, 3)
        .map((f) => ({
        base: f.label,
        rate: f.fundingRate,
          annual: f.annual,
          oiUsd: f.oiUsd,
        })),
      longSqueeze: data.longSqueeze,
      shortSqueeze: data.shortSqueeze,
    }),
    [state.tickersAt, fearGreed, data],
  );

  const drawBrief = useCallback(
    async (canvas: HTMLCanvasElement) => {
      await drawMarketBriefCard(canvas, briefData);
    },
    [briefData],
  );

  const list = (title: string, rows: Row[], tone: 'up' | 'down' | 'flat') => (
    <section className="panel">
      <header className="panel-head">
        <h3>{title}</h3>
      </header>
      <ul className="mv-list">
        {rows.map((r) => (
          <li key={r.symbol}>
            <div className="mv-sym">
              <span className="mv-base">{r.label}</span>
              <span className="mv-vol">{fmtVolume(r.quoteVolume)}</span>
            </div>
            <div className="mv-price">{fmtPrice(r.last, r.decimals)}</div>
            <span className={`mv-change ${r.change24h >= 0 ? 'up' : 'down'}`}>{fmtPct(r.change24h, 2)}</span>
            {tone === 'flat' && <span className="mv-funding">{r.fundingRate.toFixed(3)}%</span>}
          </li>
        ))}
        {rows.length === 0 && <li className="mv-empty">데이터 없음</li>}
      </ul>
    </section>
  );

  const fgValue = fearGreed?.value ?? 50;
  const fgTone = fgValue <= 45 ? 'down' : fgValue >= 55 ? 'up' : '';

  return (
    <div className="tab market-tab">
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">시황 · {EXCHANGES[exchange].marketLine}</div>
            <div className="summary-sub">
              {tab === 'crypto' ? `코인 ${view.count}종목` : `주식·ETF 선물 ${view.count}종목`} · 티커 갱신 {refreshed}{' '}
              KST · {marketSourceLabel(state.source)}
            </div>
          </div>
          <div className="market-actions">
            <div className="segmented">
              <button className={tab === 'crypto' ? 'on' : ''} onClick={() => setTab('crypto')}>
                코인
              </button>
              {bitget && (
                <button className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')} data-market-stock>
                  주식선물
                </button>
              )}
            </div>
            <button className="ghost-btn small" onClick={() => setBriefing(true)}>
              <DownloadIcon size={14} /> 속보 카드
            </button>
          </div>
        </div>

        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">상승</span>
            <b className="up">{view.summary.up}</b>
            <span className="stat-sub">종목</span>
          </div>
          <div className="stat">
            <span className="stat-label">하락</span>
            <b className="down">{view.summary.down}</b>
            <span className="stat-sub">종목</span>
          </div>
          <div className="stat">
            <span className="stat-label">평균 펀딩비</span>
            <b className={view.summary.avgFunding >= 0 ? 'up' : 'down'}>{view.summary.avgFunding.toFixed(4)}%</b>
            <span className="stat-sub">8시간</span>
          </div>
          <div className="stat">
            <span className="stat-label">24h 거래대금</span>
            <b>{fmtVolume(view.summary.volume)}</b>
            <span className="stat-sub">USDT</span>
          </div>
        </div>

        {tab === 'crypto' && (
          <div className="fear-row">
            <div className="fear-gauge">
              <span>공포·탐욕</span>
              <b className={fgTone}>{fearGreed ? fearGreed.value : '—'}</b>
              <i>{fearGreed ? fearGreed.label : loadingExtra ? '불러오는 중' : '데이터 없음'}</i>
            </div>
            <div className="fear-bar" aria-hidden>
              <div className="fear-fill" style={{ width: `${Math.max(4, Math.min(100, fgValue))}%` }} />
            </div>
            <div className="fear-scale">
              <span>공포</span>
              <span>탐욕</span>
            </div>
          </div>
        )}
      </section>

      {tab === 'crypto' && (
        <section className="panel squeeze-panel">
          <header className="panel-head">
            <h3>펀딩비 · OI 스퀴즈 레이더</h3>
            <span className="panel-note">
              롱 과열 {data.longSqueeze} · 숏 과열 {data.shortSqueeze}
            </span>
          </header>
          <ul className="squeeze-list">
            {view.squeeze.map((r) => {
              const longHot = r.fundingRate >= SQUEEZE_RATE;
              const shortHot = r.fundingRate <= -SQUEEZE_RATE;
              return (
                <li key={r.symbol}>
                  <div className="squeeze-main">
                    <b>{r.label}</b>
                    <span>
                      OI {fmtVolume(r.oiUsd)}
                      {r.oiChange != null && (
                        <i className={r.oiChange >= 0 ? 'up' : 'down'}>
                          {' '}
                          {r.oiChange >= 0 ? '+' : ''}
                          {r.oiChange.toFixed(1)}%
                        </i>
                      )}
                    </span>
                  </div>
                  <div className="squeeze-funding">
                    <b className={longHot ? 'up' : shortHot ? 'down' : ''}>{r.fundingRate.toFixed(4)}%</b>
                    <span>연 {r.annual.toFixed(1)}%</span>
                  </div>
                  <span className={`squeeze-badge ${longHot ? 'long' : shortHot ? 'short' : 'calm'}`}>
                    {longHot ? '롱 스퀴즈 주의' : shortHot ? '숏 스퀴즈 주의' : '정상'}
                  </span>
                </li>
              );
            })}
            {view.squeeze.length === 0 && <li className="mv-empty">거래대금이 충분한 종목이 없습니다.</li>}
          </ul>
          <p className="panel-note squeeze-note">
            8시간 펀딩비가 ±0.05%를 넘으면 과열 배지가 붙습니다. OI 변동률은 비트겟에 과거 OI API가 없어 COTA가
            5분 이상 전에 관측한 기록과 비교한 값입니다.
            {baseline ? ` (기준 ${new Date(baseline.at).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })} KST)` : ''}
          </p>
        </section>
      )}

      <div className="panel-grid">
        {list('상승 TOP', view.gainers, 'up')}
        {list('하락 TOP', view.losers, 'down')}
        {list('거래대금 TOP', view.volume, 'flat')}
        {list('펀딩비 극단', view.funding, 'flat')}
      </div>

      <div className="feed-note">
        {EXCHANGES[exchange].marketLine} 공개 API 실데이터({marketSourceLabel(state.source)}) · 티커·펀딩비·미결제약정 · 24h
        변동률 · 화면 진입 시 자동 갱신
        {fearGreed ? ` · 공포·탐욕 ${fearGreed.value} (${fearGreed.label})` : ''}
        <button className="link-btn" onClick={onRescan}>
          새로고침
        </button>
      </div>

      {briefing && (
        <ImageCardModal
          title="시황 속보 카드"
          fileName={`COTA-market-brief`}
          draw={drawBrief}
          onClose={() => setBriefing(false)}
          hint="스레드·텔레그램 공유용 1080px PNG 카드입니다."
        />
      )}
    </div>
  );
}
