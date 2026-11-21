import type { Signal } from '../engine/types';
import { fmtPct, fmtPrice, fmtTime, tfLabel } from '../lib/format';
import { MiniCandles } from './MiniCandles';
import { BoltIcon, StarIcon } from './Icons';

interface Props {
  signal: Signal;
  leverage: number;
  onOpen: (signal: Signal) => void;
  isFavorite: boolean;
  onToggleFavorite: (signal: Signal) => void;
  /** 현재 스캔 결과에 없는 즐겨찾기(저장된 스냅샷) */
  stale?: boolean;
}

export function SignalCard({ signal, leverage, onOpen, isFavorite, onToggleFavorite, stale = false }: Props) {
  const roi = signal.changePct * leverage;
  const sideClass = signal.side === 'long' ? 'long' : 'short';
  const stateClass = signal.state === 'open' ? 'open' : signal.state === 'win' ? 'win' : 'loss';
  const stateLabel = signal.state === 'open' ? '진행중' : signal.state === 'win' ? '적중' : '무효';
  const progress = Math.max(0, Math.min(1, signal.progress));

  return (
    <article
      className={`signal-card ${sideClass} ${stateClass}${isFavorite ? ' fav' : ''}${stale ? ' stale' : ''}`}
      onClick={() => onOpen(signal)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(signal);
      }}
    >
      <header className="card-head">
        <div className={`sym-logo ${sideClass}`}>{signal.base.slice(0, 4)}</div>
        <div className="sym-title">
          <div className="sym-line">
            <span className="sym">{signal.base}</span>
            <span className="tf">{tfLabel(signal.tf)}</span>
            {signal.asset === 'stock' ? <span className="asset stock">주식선물</span> : <span className="asset crypto">코인</span>}
          </div>
          <div className="sym-sub">
            {signal.symbol} · <BoltIcon size={11} /> {signal.strategyShort}
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
        <div className="price">{fmtPrice(signal.price)}</div>
        <div className="roi">
          <span className="roi-cap">
            레버리지 {leverage}x 수익률
          </span>
          <span className={`roi-value ${roi >= 0 ? 'up' : 'down'}`}>{fmtPct(roi)}</span>
        </div>
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
          <span className="lvl-value target">{fmtPrice(signal.target)}</span>
        </div>
        <div className="lvl">
          <span className="lvl-label">진입</span>
          <span className="lvl-value entry">{fmtPrice(signal.entry)}</span>
        </div>
        <div className="lvl">
          <span className="lvl-label">EQ</span>
          <span className="lvl-value eq">{fmtPrice(signal.eq)}</span>
        </div>
        <div className="lvl">
          <span className="lvl-label">무효</span>
          <span className="lvl-value stop">{fmtPrice(signal.stop)}</span>
        </div>
      </div>

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
