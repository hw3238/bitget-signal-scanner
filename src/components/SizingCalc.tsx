import { useEffect, useMemo, useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import { fmtUsdtBalance, type AccountBase } from '../lib/account';
import type { Side } from '../engine/types';
import { positionSizing } from '../lib/calc';
import { fmtPct, fmtPrice, fmtRR } from '../lib/format';
import { fmtUsdAmount } from '../lib/profile';
import { CoinSelect, NumField } from './ui';

/**
 * 포지션 사이징 — v1.5.5 부터 기본 시드가 **연결된 계좌 잔고**다.
 * 계좌가 없으면 1,000 USDT 로 임시 계산할 수 있고, 어떤 기준으로 계산했는지 화면에 적는다.
 */
export function SizingCalc({ state, account }: { state: ScanState; account: AccountBase }) {
  const coins = useMemo(
    () =>
      state.contracts
        .filter((c) => c.asset === 'crypto')
        .map((c) => {
          const t = state.tickers.find((x) => x.symbol === c.symbol);
          return { symbol: c.symbol, base: c.base, volume: t?.quoteVolume ?? 0, last: t?.last ?? 0 };
        })
        .filter((c) => c.last > 0)
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 80),
    [state.contracts, state.tickers],
  );

  const [symbol, setSymbol] = useState('BTCUSDT');
  const [side, setSide] = useState<Side>('long');
  const [seed, setSeed] = useState(account.seed > 0 ? Math.round(account.seed * 100) / 100 : 1000);
  /** 사용자가 임시로 다른 시드를 넣었는가 — 계좌 잔고와 다르면 '임시 계산'으로 표기 */
  const [edited, setEdited] = useState(false);
  const [riskPct, setRiskPct] = useState(2);
  const [entry, setEntry] = useState(0);
  const [stop, setStop] = useState(0);
  const [target, setTarget] = useState(0);

  const mark = state.tickers.find((t) => t.symbol === symbol)?.last ?? 0;
  // 잔고가 나중에 도착하면(앱 시작 직후) 사용자가 손대지 않은 동안은 계좌 잔고로 맞춘다.
  useEffect(() => {
    if (edited || !(account.seed > 0)) return;
    const next = Math.round(account.seed * 100) / 100;
    setSeed((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));
  }, [account.seed, edited]);
  const entryValue = entry > 0 ? entry : mark;

  // 시세가 준비되면 BTC 기본값(±2% / ±5%)으로 바로 계산되게 채워 준다.
  useEffect(() => {
    if (entry > 0 || mark <= 0) return;
    setEntry(mark);
    setStop(Number((mark * (side === 'long' ? 0.98 : 1.02)).toPrecision(6)));
    setTarget(Number((mark * (side === 'long' ? 1.05 : 0.95)).toPrecision(6)));
  }, [entry, mark, side]);

  const pickCoin = (next: string) => {
    setSymbol(next);
    const price = state.tickers.find((t) => t.symbol === next)?.last ?? 0;
    setEntry(price);
    setStop(price ? Number((price * (side === 'long' ? 0.98 : 1.02)).toPrecision(6)) : 0);
    setTarget(price ? Number((price * (side === 'long' ? 1.05 : 0.95)).toPrecision(6)) : 0);
  };

  const flipSide = (next: Side) => {
    setSide(next);
    if (entryValue) {
      setStop(Number((entryValue * (next === 'long' ? 0.98 : 1.02)).toPrecision(6)));
      setTarget(Number((entryValue * (next === 'long' ? 1.05 : 0.95)).toPrecision(6)));
    }
  };

  const result = useMemo(
    () => positionSizing({ seed, riskPct, entry: entryValue, stop, target, side }),
    [seed, riskPct, entryValue, stop, target, side],
  );

  return (
    <div className="tab sizing-tab">
      <section className="panel">
        <header className="panel-head">
          <h3>포지션 사이징</h3>
          <span className="panel-note">손실은 정해 두고, 수량은 계산으로</span>
        </header>
        <div className={`account-basis ${account.connected ? 'on' : ''}`} data-sizing-basis>
          {account.connected
            ? `연결된 계좌 잔고 ${fmtUsdtBalance(account.equity)} · 가용 ${fmtUsdtBalance(account.available)} 기준`
            : '실계좌가 연결되지 않아 임시 시드로 계산합니다 — 연결하면 잔고가 자동으로 채워집니다.'}
        </div>
        <div className="form-grid">
          <CoinSelect value={symbol} onChange={pickCoin} coins={coins} />
          <div className="num-field">
            <span className="num-label">방향</span>
            <div className="segmented side-seg">
              <button className={side === 'long' ? 'on' : ''} onClick={() => flipSide('long')}>
                롱 · 매수
              </button>
              <button className={side === 'short' ? 'on' : ''} onClick={() => flipSide('short')}>
                숏 · 매도
              </button>
            </div>
          </div>
          <NumField
            label="시드"
            value={seed}
            onChange={(v) => {
              setEdited(true);
              setSeed(v);
            }}
            suffix="USDT"
            hint={account.connected ? '기본값 = 계좌 잔고(임시 변경 가능)' : '임시 계산용'}
          />
          <NumField label="1회 허용 손실률" value={riskPct} onChange={setRiskPct} suffix="%" />
          <NumField
            label="진입가"
            value={entryValue}
            onChange={setEntry}
            suffix="USDT"
            hint={mark ? `현재가 ${fmtPrice(mark)}` : undefined}
          />
          <NumField label="손절가" value={stop} onChange={setStop} suffix="USDT" />
          <NumField label="목표가" value={target} onChange={setTarget} suffix="USDT" />
          <div className="num-field">
            <span className="num-label">손실률 프리셋</span>
            <div className="chip-row">
              {[1, 2, 3, 5, 10].map((v) => (
                <button key={v} className={`ghost-btn small ${riskPct === v ? 'on' : ''}`} onClick={() => setRiskPct(v)}>
                  {v}%
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {result.valid ? (
        <>
          <section className="summary-card">
            <div className="summary-title">손익비</div>
            <div className="sizing-hero">
              <b>{fmtRR(result.rr, 2)}</b>
              <span className={result.rr >= 2 ? 'up' : 'down'}>
                손익분기 승률 {result.breakevenWinRate.toFixed(1)}%
              </span>
            </div>
            <div className="summary-sub">
              손절 폭 {result.stopDistPct.toFixed(2)}% · 목표 {result.targetDistPct.toFixed(2)}% · 이 승률보다 높으면
              기대값이 +입니다.
            </div>
          </section>

          <section className="panel">
            <header className="panel-head">
              <h3>진입 수량</h3>
              <span className="panel-note">손절 도달 시 −{fmtUsdAmount(result.lossUsd)}</span>
            </header>
            <ul className="kv-list">
              <li>
                <span>적정 수량</span>
                <b>{result.qty.toLocaleString('en-US', { maximumFractionDigits: 6 })}</b>
              </li>
              <li>
                <span>포지션 규모</span>
                <b>{result.notional.toLocaleString('en-US', { maximumFractionDigits: 0 })} USDT</b>
              </li>
              <li>
                <span>권장 레버리지 (시드 전액 증거금)</span>
                <b>{result.leverage}x</b>
              </li>
              <li>
                <span>허용 손실 금액</span>
                <b className="down">{fmtUsdAmount(result.lossUsd)}</b>
              </li>
              <li>
                <span>목표 도달 수익</span>
                <b className="up">{fmtUsdAmount(result.profitUsd)}</b>
              </li>
              <li>
                <span>목표 도달 수익률</span>
                <b className="up">
                  {fmtPct((result.profitUsd / Math.max(1, seed)) * 100, 2)} · 시드 대비
                </b>
              </li>
            </ul>
          </section>
        </>
      ) : (
        <div className="notice">{result.error ?? '값을 입력하면 계산됩니다.'}</div>
      )}

      <div className="feed-note">
        수량 = (시드 × 허용 손실률) ÷ |진입가 − 손절가|. 레버리지는 시드 전액을 증거금으로 넣는다고 가정한 최소
        배율입니다.
      </div>
    </div>
  );
}
