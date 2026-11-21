import type { Signal } from '../engine/types';
import { assetClass, assetLabel } from '../lib/asset';
import { bitgetFuturesUrl } from '../lib/coinLogo';
import { openBitgetFutures } from '../lib/native';
import { fmtPct, fmtPrice, fmtRR, fmtSendTime, sideFullLabel, stateLabel, tfLabel } from '../lib/format';
import {
  STYLE_META,
  fmtSeed,
  fmtUsdAmount,
  recommendLeverage,
  seedPnl,
  type Profile,
} from '../lib/profile';
import { MiniCandles } from './MiniCandles';
import { CoinLogo } from './CoinLogo';
import { ArrowUpRightIcon, StarIcon } from './Icons';

interface Props {
  signal: Signal;
  /** 수동 고정 배율 */
  leverage: number;
  /** 'auto' 면 시그널마다 COTA 추천 배율을 쓴다 */
  leverageMode?: 'auto' | 'manual';
  profile?: Profile | null;
  onOpen: (signal: Signal) => void;
  isFavorite: boolean;
  onToggleFavorite: (signal: Signal) => void;
  /** 현재 스캔 결과에 없는 즐겨찾기(저장된 스냅샷) */
  stale?: boolean;
}

export function SignalCard({
  signal,
  leverage,
  leverageMode = 'manual',
  profile = null,
  onOpen,
  isFavorite,
  onToggleFavorite,
  stale = false,
}: Props) {
  const { entry, target, stop, eq, price } = signal;
  const dir = signal.side === 'long' ? 1 : -1;
  const changePct = ((price - entry) / (entry || 1)) * 100 * dir;
  const auto = leverageMode === 'auto' && !!profile;
  const rec = profile ? recommendLeverage(signal, profile.style) : null;
  const lev = auto && rec ? rec.leverage : leverage;
  const roi = changePct * lev;
  const pnl = auto && profile ? seedPnl(signal, lev, profile.seed) : null;
  /** 내 시드 기준 실시간 평가손익 — 현재가가 진입가에서 얼마나 움직였는지 × 레버리지 */
  const livePnl = profile ? (profile.seed * roi) / 100 : null;
  /** 목표가·손절가까지 남은 변동률(현재가 기준, 방향 반영) */
  const toTargetPct = ((target - price) / (price || 1)) * 100 * dir;
  const toStopPct = ((stop - price) / (price || 1)) * 100 * dir;
  const sideClass = signal.side === 'long' ? 'long' : 'short';
  const stateClass = signal.state === 'open' ? 'open' : signal.state === 'win' ? 'win' : 'loss';
  const progress = Math.max(0, Math.min(1, signal.progress));
  const dec = signal.decimals;

  /** 비트겟 선물 화면을 연다 — 앱에서는 비트겟 안드로이드 앱, 웹에서는 새 탭. 카드의 공유 모달은 열리지 않는다. */
  const openBitget = () => {
    void openBitgetFutures(signal.symbol, bitgetFuturesUrl(signal.symbol));
  };

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
        <CoinLogo base={signal.base} asset={signal.asset} side={signal.side} size={40} />
        <div className="sym-title">
          <div className="sym-line">
            <span className="sym">{signal.base}</span>
            <span className="tf">{tfLabel(signal.tf)}</span>
            <span className={`asset ${assetClass(signal.asset)}`}>{assetLabel(signal.asset)}</span>
          </div>
          <div className="sym-sub">
            {signal.symbol} · {signal.strategyShort}
          </div>
        </div>
        <div className="badge-col">
          <span className={`badge ${sideClass}`}>{sideFullLabel(signal.side)}</span>
          <span className={`badge state ${stateClass}`}>{stateLabel(signal.state)}</span>
          {auto && <span className="badge rec">COTA 추천 {lev}x</span>}
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
        <div className="price-block">
          <span className="price-cap">현재가</span>
          <div className="price">{fmtPrice(price, dec)}</div>
          <span className={`price-change ${changePct >= 0 ? 'up' : 'down'}`}>
            진입가 대비 {fmtPct(changePct, 2)}
          </span>
        </div>
        <div className="roi">
          <span className="roi-cap">
            {signal.state === 'open' ? '현재 수익률' : '최종 수익률'} (진입가 기준)
          </span>
          <span className={`roi-value ${roi >= 0 ? 'up' : 'down'}`}>{fmtPct(roi)}</span>
          <span className="roi-sub">
            {livePnl != null
              ? `${lev}x 적용 · 평가손익 ${fmtUsdAmount(livePnl)}`
              : `${lev}x 레버리지 적용`}
          </span>
        </div>
      </div>

      {auto && pnl && profile && (
        <div className="seed-strip">
          <span className="seed-cap">
            내 시드 <b>${fmtSeed(profile.seed)}</b> · {STYLE_META[profile.style].emoji}{' '}
            {STYLE_META[profile.style].label}
          </span>
          <div className="seed-cells">
            <div className="seed-cell">
              <span>목표 시 예상 수익</span>
              <b className="up">{fmtUsdAmount(pnl.profitUsd)}</b>
              <i className="up">{fmtPct(pnl.profitPct)}</i>
            </div>
            <div className="seed-cell">
              <span>손절 시 손실</span>
              <b className="down">{fmtUsdAmount(pnl.lossUsd)}</b>
              <i className="down">{fmtPct(pnl.lossPct)}</i>
            </div>
          </div>
          <span className="seed-note">시드 전액을 한 포지션에 넣는 기준</span>
        </div>
      )}

      <div className="rr-row">
        <span className="rr-pill">
          손익비 <b>{fmtRR(signal.rr, 1)}</b>
        </span>
        <span className="rr-pill muted">
          잔여 <b>{signal.state === 'open' ? signal.remainingRR.toFixed(1) : '0.0'}R</b>
        </span>
        <span className="rr-pill muted">
          최근 승률 <b>{signal.winRate.toFixed(0)}%</b>
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
          <span className="lvl-label">목표가</span>
          <span className="lvl-value target">{fmtPrice(target, dec)}</span>
          <span className="lvl-usd up">{fmtPct(toTargetPct, 2)}</span>
        </div>
        <div className="lvl">
          <span className="lvl-label">진입가</span>
          <span className="lvl-value entry">{fmtPrice(entry, dec)}</span>
          <span className="lvl-usd muted">기준가</span>
        </div>
        <div className="lvl">
          <span className="lvl-label">본전 (EQ)</span>
          <span className="lvl-value eq">{fmtPrice(eq, dec)}</span>
          <span className="lvl-usd muted">절반 익절</span>
        </div>
        <div className="lvl">
          <span className="lvl-label">손절가</span>
          <span className="lvl-value stop">{fmtPrice(stop, dec)}</span>
          <span className="lvl-usd down">{fmtPct(toStopPct, 2)}</span>
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

      <div className="card-actions">
        <button
          type="button"
          className="bitget-link"
          onClick={(e) => {
            e.stopPropagation();
            openBitget();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
          }}
          aria-label={`${signal.base} 비트겟 선물 바로가기`}
          title={`비트겟에서 ${signal.base} 선물 거래 열기`}
        >
          비트겟 바로가기
          <ArrowUpRightIcon size={12} />
        </button>
        <span className={`share-hint${stale ? ' stale-hint' : ''}`}>
          {stale ? '보관된 스냅샷 · 탭하여 공유 카드' : '탭하여 공유 카드'}
        </span>
      </div>

      <footer className="card-foot">
        <div className="tags">
          {signal.tags.slice(0, 2).map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
          <span className="tag sent">발송 {fmtSendTime(signal.detectedAt)}</span>
        </div>
      </footer>
    </article>
  );
}
