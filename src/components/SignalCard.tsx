import type { Signal } from '../engine/types';
import { assetClass, assetLabel, symbolLogo } from '../lib/asset';
import { fmtPct, fmtPrice, fmtTime, tfLabel } from '../lib/format';
import { fmtOffset } from '../lib/offset';
import { fmtLot, fmtPips, fmtUsd, lotCalc, lotSpec } from '../utils/lot';
import { MiniCandles } from './MiniCandles';
import { BoltIcon, StarIcon } from './Icons';

interface Props {
  signal: Signal;
  leverage: number;
  /** FX 탭: 배수(x) 대신 이 랏(Lot) 기준 달러 손익으로 표시한다. */
  lot?: number;
  onOpen: (signal: Signal) => void;
  isFavorite: boolean;
  onToggleFavorite: (signal: Signal) => void;
  /** 현재 스캔 결과에 없는 즐겨찾기(저장된 스냅샷) */
  stale?: boolean;
  /** 벤티지 호가 보정 오프셋 — 현재가·진입·목표·EQ·무효에 더해 표시한다 */
  offset?: number;
}

export function SignalCard({
  signal,
  leverage,
  lot,
  onOpen,
  isFavorite,
  onToggleFavorite,
  stale = false,
  offset = 0,
}: Props) {
  const price = signal.price + offset;
  const entry = signal.entry + offset;
  const target = signal.target + offset;
  const stop = signal.stop + offset;
  const eq = signal.eq + offset;
  const changePct = ((price - entry) / (entry || 1)) * 100 * (signal.side === 'long' ? 1 : -1);
  const roi = changePct * leverage;
  // FX 카드: 랏(Lot) × 표준 계약 크기로 달러 손익을 계산한다.
  const lc =
    lot != null
      ? lotCalc(lotSpec(signal.base), lot, { entry, price, target, stop, eq, side: signal.side })
      : null;
  const sideClass = signal.side === 'long' ? 'long' : 'short';
  const stateClass = signal.state === 'open' ? 'open' : signal.state === 'win' ? 'win' : 'loss';
  const stateLabel = signal.state === 'open' ? '진행중' : signal.state === 'win' ? '적중' : '무효';
  const progress = Math.max(0, Math.min(1, signal.progress));
  const dec = signal.decimals;

  return (
    <article
      className={`signal-card ${sideClass} ${stateClass}${isFavorite ? ' fav' : ''}${stale ? ' stale' : ''}${
        signal.asset === 'fx' ? ' fx' : ''
      }${offset ? ' offset' : ''}`}
      onClick={() => onOpen(signal)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(signal);
      }}
    >
      <header className="card-head">
        <div className={`sym-logo ${sideClass}`}>{symbolLogo(signal.base)}</div>
        <div className="sym-title">
          <div className="sym-line">
            <span className="sym">{signal.base}</span>
            <span className="tf">{tfLabel(signal.tf)}</span>
            <span className={`asset ${assetClass(signal.asset)}`}>{assetLabel(signal.asset)}</span>
          </div>
          <div className="sym-sub">
            {signal.symbol} · <BoltIcon size={11} /> {signal.strategyShort}
            {offset ? ` · 벤티지 ${fmtOffset(offset, Math.max(2, dec ?? 2))}` : ''}
          </div>
        </div>
        <div className="badge-col">
          <span className={`badge ${sideClass}`}>{signal.side === 'long' ? '▲ 롱' : '▼ 숏'}</span>
          <span className={`badge state ${stateClass}`}>{stateLabel}</span>
        </div>
        <button
          type="button"
          className={`fav-btn ${isFavorite ? 'on' : ''}`}
          aria-pressed={isFavorite}
          aria-label={isFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
          title={isFavorite ? '즐겨찾기 해제' : '즐겨찾기에 추가'}
          onClick={(e) => {
            e.stopPropagation();
            // 즐겨찾기에는 보정 전 원본 시그널을 저장해 오프셋이 두 번 더해지지 않게 한다.
            onToggleFavorite(signal);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
          }}
        >
          <StarIcon size={17} filled={isFavorite} />
        </button>
      </header>

      <div className="price-row">
        <div className="price">{fmtPrice(price, dec)}</div>
        {lc ? (
          <div className="roi lot">
            <span className="roi-cap">{fmtLot(lc.lot)} Lot 수익</span>
            <span className={`roi-value ${lc.pnl >= 0 ? 'up' : 'down'}`}>{fmtUsd(lc.pnl)}</span>
          </div>
        ) : (
          <div className="roi">
            <span className="roi-cap">레버리지 {leverage}x 수익률</span>
            <span className={`roi-value ${roi >= 0 ? 'up' : 'down'}`}>{fmtPct(roi)}</span>
          </div>
        )}
      </div>

      <div className="rr-row">
        <span className="rr-pill">
          손익비 <b>{signal.rr.toFixed(2)}R</b>
        </span>
        <span className="rr-pill muted">
          잔여 <b>{signal.state === 'open' ? signal.remainingRR.toFixed(2) : '0.00'}R</b>
        </span>
        <span className="rr-pill muted">
          승률 <b>{signal.winRate.toFixed(0)}%</b>
        </span>
        <span className="rr-pill muted">
          {signal.barsSince === 0 ? '방금 감지' : `${signal.barsSince}봉 전`}
        </span>
      </div>

      <div className="chart-wrap">
        <MiniCandles candles={signal.candles} signal={signal} />
      </div>

      <div className="levels">
        <div className="lvl">
          <span className="lvl-label">목표</span>
          <span className="lvl-value target">{fmtPrice(target, dec)}</span>
          {lc && <span className="lvl-usd target">{fmtUsd(lc.targetUsd)}</span>}
        </div>
        <div className="lvl">
          <span className="lvl-label">진입</span>
          <span className="lvl-value entry">{fmtPrice(entry, dec)}</span>
          {lc && <span className="lvl-usd muted">기준가</span>}
        </div>
        <div className="lvl">
          <span className="lvl-label">EQ</span>
          <span className="lvl-value eq">{fmtPrice(eq, dec)}</span>
          {lc && <span className="lvl-usd eq">{fmtUsd(lc.eqUsd)}</span>}
        </div>
        <div className="lvl">
          <span className="lvl-label">무효</span>
          <span className="lvl-value stop">{fmtPrice(stop, dec)}</span>
          {lc && <span className="lvl-usd stop">{fmtUsd(lc.stopUsd)}</span>}
        </div>
      </div>

      {lc && (
        <div className="lot-strip">
          <b>{fmtLot(lc.lot)} Lot</b>
          <span>1{lc.spec.pipUnit} ${lc.pipUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span>
            목표 {fmtPips(lc.targetPips)} {lc.spec.pipUnit} · 손절 {fmtPips(lc.stopPips)} {lc.spec.pipUnit}
          </span>
          <span className="lot-spec">{lc.spec.label}</span>
        </div>
      )}

      <div className="progress-row">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
          <span className="eq-tick" />
          <span className="price-tick" style={{ left: `${progress * 100}%` }} />
        </div>
        <span className="progress-pct">{Math.round(progress * 100)}%</span>
      </div>

      <footer className="card-foot">
        <div className="tags">
          {signal.tags.slice(0, 2).map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
          <span className="tag ghost">{fmtTime(signal.detectedAt)} KST</span>
        </div>
        {stale ? (
          <span className="share-hint stale-hint">보관된 스냅샷 · 탭하여 공유 카드</span>
        ) : (
          <span className="share-hint">탭하여 공유 카드</span>
        )}
      </footer>
    </article>
  );
}
