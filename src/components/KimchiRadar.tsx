import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import {
  fetchBithumbPrices,
  fetchUpbitPrices,
  fetchUsdKrw,
  type FxRate,
  type KrwQuote,
} from '../api/publicMarket';
import { bestTransferRoutes, buildKimchiRows, usdtPremium, type KimchiRow } from '../lib/calc';
import { fmtPct, fmtTime } from '../lib/format';
import { ArrowUpRightIcon, RefreshIcon } from './Icons';

/** 국내 거래소에서 원화로 거래되는 주요 코인 (업비트 KRW 마켓 기준) */
const KIMCHI_COINS = [
  'USDT',
  'BTC',
  'ETH',
  'XRP',
  'SOL',
  'TRX',
  'DOGE',
  'ADA',
  'AVAX',
  'LINK',
  'DOT',
  'BCH',
  'SUI',
  'APT',
  'NEAR',
  'LTC',
  'ETC',
  'ATOM',
  'ARB',
  'OP',
  'FIL',
  'UNI',
  'TON',
];

const krw = (v: number) => (Number.isFinite(v) ? `₩${Math.round(v).toLocaleString('en-US')}` : '-');

export function KimchiRadar({ state }: { state: ScanState }) {
  const [fx, setFx] = useState<FxRate | null>(null);
  const [domestic, setDomestic] = useState<Map<string, KrwQuote>>(new Map());
  const [source, setSource] = useState<'업비트' | '빗썸' | '-'>('-');
  const [usdtQuote, setUsdtQuote] = useState<KrwQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 빗썸이 먼저 — GitHub Pages(github.io) 오리진에서도 CORS가 통과하는 것을 라이브에서 확인했다.
      // 업비트는 오리진에 따라 CORS가 막히므로 빗썸이 실패했을 때만 시도한다.
      const [rate, bithumb] = await Promise.all([fetchUsdKrw(), fetchBithumbPrices(KIMCHI_COINS).catch(() => null)]);
      let quotes = bithumb;
      let src: '업비트' | '빗썸' = '빗썸';
      if (!quotes || quotes.size === 0) {
        quotes = await fetchUpbitPrices(KIMCHI_COINS);
        src = '업비트';
      }
      if (!quotes || quotes.size === 0) throw new Error('국내 원화 시세를 불러오지 못했습니다');
      setFx(rate);
      setDomestic(quotes);
      setSource(src);
      setUsdtQuote(quotes.get('USDT') ?? null);
      setAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : '시세를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  /** 비트겟 가격 — 스캐너 티커에서 바로 쓴다 */
  const bitgetPrice = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of state.tickers) {
      if (t.quoteVolume <= 0) continue;
      map.set(t.symbol.replace(/USDT$/, ''), t.last);
    }
    return map;
  }, [state.tickers]);

  const rows = useMemo<KimchiRow[]>(() => {
    if (!fx) return [];
    const quotes = new Map<string, { krw: number; volumeKrw: number }>();
    for (const [base, q] of domestic) quotes.set(base, { krw: q.krw, volumeKrw: q.volumeKrw });
    return buildKimchiRows(quotes, bitgetPrice, fx.usdKrw);
  }, [domestic, bitgetPrice, fx]);

  const best = useMemo(() => (rows.length ? bestTransferRoutes(rows, 3) : []), [rows]);
  const usdtPrem = usdtQuote && fx ? usdtPremium(usdtQuote.krw, fx.usdKrw) : NaN;
  const btcPrem = rows.find((r) => r.base === 'BTC')?.premiumPct ?? NaN;

  return (
    <div className="tab kimchi-tab">
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">
              김치프리미엄 <b>{Number.isFinite(btcPrem) ? fmtPct(btcPrem, 2) : '-'}</b>
              <span className="tool-badge">BTC</span>
            </div>
            <div className="summary-sub">
              1 USD = {fx ? `${fx.usdKrw.toFixed(2)}원` : '—'} · {source} 원화 시세 ·{' '}
              {at ? `${fmtTime(at)} KST 갱신` : '불러오는 중'}
            </div>
          </div>
          <button className={`rescan ${loading ? 'busy' : ''}`} onClick={() => void load()} disabled={loading}>
            <RefreshIcon size={15} />
            새로고침
          </button>
        </div>
        <div className="kimchi-meta">
          <span>
            {source} USDT {usdtQuote ? krw(usdtQuote.krw) : '—'}
          </span>
          <span className="sep">·</span>
          <span className={usdtPrem >= 0 ? 'up' : 'down'}>
            USDT 김프 {Number.isFinite(usdtPrem) ? fmtPct(usdtPrem, 2) : '—'}
          </span>
          <span className="sep">·</span>
          <span>환율 {fx ? `${Math.round(fx.usdKrw).toLocaleString('en-US')}원` : '—'}</span>
          <span className="sep">·</span>
          <span>{rows.length}개 종목 비교</span>
        </div>
      </section>

      {error && <div className="notice error">{error}</div>}

      <section className="panel">
        <header className="panel-head">
          <h3>🚀 국내 → 해외 송금 최적 TOP 3</h3>
          <span className="panel-note">예상 출금 수수료 반영</span>
        </header>
        <div className="route-list">
          {best.map((r, i) => (
            <div key={r.base} className="route-card">
              <span className={`route-rank r${i + 1}`}>{i + 1}</span>
              <div className="route-main">
                <b>{r.base}</b>
                <span>
                  김프 {fmtPct(r.premiumPct, 2)} · 수수료 -{r.feePct.toFixed(2)}%
                </span>
              </div>
              <div className={`route-net ${r.netPct >= 0 ? 'up' : 'down'}`}>
                <b>{fmtPct(r.netPct, 2)}</b>
                <span>순손익</span>
              </div>
            </div>
          ))}
          {!best.length && <div className="mv-empty">{loading ? '계산 중…' : '데이터 없음'}</div>}
        </div>
        <p className="panel-note route-note">
          김프가 낮을수록(역프일수록) 국내에서 사서 해외로 보내는 쪽이 유리합니다. 순손익 = 김프 − 예상 출금 수수료.
        </p>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>김프 전체 표</h3>
          <span className="panel-note">{source} ↔ 비트겟</span>
        </header>
        <div className="kimchi-table">
          <div className="kimchi-head">
            <span>코인</span>
            <span>국내가</span>
            <span>해외가(원화)</span>
            <span>김프</span>
          </div>
          {rows.map((r) => (
            <div key={r.base} className="kimchi-row">
              <span className="kimchi-base">{r.base}</span>
              <span>{krw(r.upbitKrw)}</span>
              <span>{krw(r.bitgetUsd * (fx?.usdKrw ?? 0))}</span>
              <span className={r.premiumPct >= 0 ? 'up' : 'down'}>{fmtPct(r.premiumPct, 2)}</span>
            </div>
          ))}
          {!rows.length && <div className="mv-empty">{loading ? '불러오는 중…' : '표시할 종목이 없습니다'}</div>}
        </div>
      </section>

      <div className="feed-note">
        빗썸(또는 업비트) 원화 시세 + 비트겟 USDT-M 실시간 가격 + open.er-api 환율로 계산합니다. 출금 수수료는 코인별
        대표 네트워크 기준 예상치입니다.
        <button className="link-btn" onClick={() => void load()}>
          다시 계산
        </button>
        <a className="link-btn" href="https://www.bitget.com/futures/usdt/BTCUSDT" target="_blank" rel="noreferrer">
          비트겟 열기 <ArrowUpRightIcon size={11} />
        </a>
      </div>
    </div>
  );
}
