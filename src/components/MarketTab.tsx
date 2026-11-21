import { useMemo, useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import type { AssetClass } from '../engine/types';
import { fmtPct, fmtPrice, fmtVolume } from '../lib/format';

interface Props {
  state: ScanState;
  onRescan: () => void;
}

type Tab = 'crypto' | 'stock';

export function MarketTab({ state, onRescan }: Props) {
  const [tab, setTab] = useState<Tab>('crypto');

  const data = useMemo(() => {
    const assetOf = new Map<string, AssetClass>(state.contracts.map((c) => [c.symbol, c.asset]));
    const decimalsOf = new Map<string, number | undefined>(state.contracts.map((c) => [c.symbol, c.decimals]));
    const rows = state.tickers
      .map((t) => {
        const asset = assetOf.get(t.symbol) ?? 'crypto';
        return {
          ...t,
          asset,
          decimals: decimalsOf.get(t.symbol),
          label: t.symbol.replace(/USDT$/, '').replace(/STOCK$/, ''),
        };
      })
      .filter((t) => t.quoteVolume > 150_000 && Number.isFinite(t.change24h));

    const cryptos = rows.filter((r) => r.asset === 'crypto');
    const stocks = rows.filter((r) => r.asset === 'stock');

    const summary = (list: typeof rows) => {
      const up = list.filter((r) => r.change24h > 0).length;
      const down = list.filter((r) => r.change24h < 0).length;
      const volume = list.reduce((a, r) => a + r.quoteVolume, 0);
      const funding = list.filter((r) => Number.isFinite(r.fundingRate) && r.fundingRate !== 0);
      const avgFunding = funding.length ? funding.reduce((a, r) => a + r.fundingRate, 0) / funding.length : 0;
      return { up, down, volume, avgFunding, count: list.length };
    };

    const byChange = (list: typeof rows) => [...list].sort((a, b) => b.change24h - a.change24h);
    const byVolume = (list: typeof rows) => [...list].sort((a, b) => b.quoteVolume - a.quoteVolume);
    const byFunding = (list: typeof rows) =>
      [...list].filter((r) => r.fundingRate !== 0).sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));

    return {
      crypto: {
        summary: summary(cryptos),
        gainers: byChange(cryptos).slice(0, 6),
        losers: byChange(cryptos).slice(-6).reverse(),
        volume: byVolume(cryptos).slice(0, 6),
        funding: byFunding(cryptos).slice(0, 5),
        count: cryptos.length,
      },
      stock: {
        summary: summary(stocks),
        gainers: byChange(stocks).slice(0, 6),
        losers: byChange(stocks).slice(-6).reverse(),
        volume: byVolume(stocks).slice(0, 6),
        funding: byFunding(stocks).slice(0, 5),
        count: stocks.length,
      },
    };
  }, [state.tickers, state.contracts]);

  const view = data[tab];
  const refreshed =
    state.tickersAt > 0
      ? new Date(state.tickersAt).toLocaleTimeString('ko-KR', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Seoul',
        })
      : '-';

  const list = (title: string, rows: typeof view.gainers, tone: 'up' | 'down' | 'flat') => (
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
            <div className="mv-price">
              {fmtPrice(r.last, r.decimals)}
            </div>
            <span className={`mv-change ${r.change24h >= 0 ? 'up' : 'down'}`}>{fmtPct(r.change24h, 2)}</span>
            {tone === 'flat' && <span className="mv-funding">{r.fundingRate.toFixed(3)}%</span>}
          </li>
        ))}
        {rows.length === 0 && <li className="mv-empty">데이터 없음</li>}
      </ul>
    </section>
  );

  return (
    <div className="tab market-tab">
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">시황 · 비트겟 USDT-M</div>
            <div className="summary-sub">
              {tab === 'crypto' ? `코인 ${view.count}종목` : `주식·ETF 선물 ${view.count}종목`} · 티커 갱신{' '}
              {refreshed} KST
            </div>
          </div>
          <div className="segmented">
            <button className={tab === 'crypto' ? 'on' : ''} onClick={() => setTab('crypto')}>
              코인
            </button>
            <button className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>
              주식선물
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
      </section>

      <div className="panel-grid">
        {list('상승 TOP', view.gainers, 'up')}
        {list('하락 TOP', view.losers, 'down')}
        {list('거래대금 TOP', view.volume, 'flat')}
        {list('펀딩비 극단', view.funding, 'flat')}
      </div>

      <div className="feed-note">
        비트겟 공개 API 티커 실데이터 · 24h 변동률 · 화면 진입 시 자동 갱신
        <button className="link-btn" onClick={onRescan}>
          새로고침
        </button>
      </div>
    </div>
  );
}
