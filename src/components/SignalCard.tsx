import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Contract, Signal } from '../engine/types';
import { assetClass, assetLabel } from '../lib/asset';
import { copyToClipboard } from '../lib/clipboard';
import { bitgetFuturesUrl } from '../lib/coinLogo';
import { openBitgetFutures } from '../lib/native';
import { fmtPct, fmtPrice, fmtRR, fmtSendTime, sideFullLabel, stateLabel, tfLabel } from '../lib/format';
import { STYLE_META, fmtUsdAmount, recommendLeverage, type Profile } from '../lib/profile';
import { ACCOUNT_UNLINKED_HINT, fmtUsdtBalance, type AccountBase } from '../lib/account';
import {
  copyPriceText,
  copyQtyText,
  fmtUsd,
  formatQty,
  planOrderForSignal,
  resolveRiskPct,
} from '../lib/orderCockpit';
import { MiniCandles } from './MiniCandles';
import { CoinLogo } from './CoinLogo';
import { ArrowUpRightIcon, CheckIcon, CopyIcon, StarIcon } from './Icons';

interface Props {
  signal: Signal;
  /** 수동 고정 배율 */
  leverage: number;
  /** 'auto' 면 시그널마다 COTA 추천 배율을 쓴다 */
  leverageMode?: 'auto' | 'manual';
  profile?: Profile | null;
  /** 연결된 비트겟 계좌의 실시간 잔고 — 주문 수량·손익의 기준(v1.5.5) */
  account?: AccountBase;
  /** 계좌가 없을 때 자동매매 연결 화면 열기 */
  onConnectAccount?: () => void;
  /** 설정에서 지정한 1회 허용 손실률(%). null/미지정이면 성향 기본값 */
  riskPct?: number | null;
  /** 거래소 계약 정보 — 주문 수량을 비트겟 주문 단위에 맞춘다 */
  contract?: Contract | null;
  onOpen: (signal: Signal) => void;
  isFavorite: boolean;
  onToggleFavorite: (signal: Signal) => void;
  /** 내가 실제로 진입했다고 표시한 시그널 — 기록 탭에서 내 매매만 따로 집계 */
  isMyTrade?: boolean;
  onToggleMyTrade?: () => void;
  /** 현재 스캔 결과에 없는 즐겨찾기(저장된 스냅샷) */
  stale?: boolean;
  /** ⚡ 원클릭 주문 — 자동매매 규칙으로 바로 주문(모의/실거래) */
  onQuickOrder?: (signal: Signal) => void;
  quickOrderMode?: 'demo' | 'live';
  /** 주문 요청이 진행 중인 시그널 */
  quickOrderBusy?: boolean;
}

export function SignalCard({
  signal,
  leverage,
  leverageMode = 'manual',
  profile = null,
  account,
  onConnectAccount,
  riskPct = null,
  contract = null,
  onOpen,
  isFavorite,
  onToggleFavorite,
  isMyTrade = false,
  onToggleMyTrade,
  stale = false,
  onQuickOrder,
  quickOrderMode = 'demo',
  quickOrderBusy = false,
}: Props) {
  const { entry, target, stop, eq, price } = signal;
  const dir = signal.side === 'long' ? 1 : -1;
  const changePct = ((price - entry) / (entry || 1)) * 100 * dir;
  const auto = leverageMode === 'auto' && !!profile;
  const rec = profile ? recommendLeverage(signal, profile.style) : null;
  const lev = auto && rec ? rec.leverage : leverage;
  const roi = changePct * lev;
  /** 계좌 잔고 기준 실시간 평가손익 — 현재가가 진입가에서 얼마나 움직였는지 × 레버리지 */
  const seed = account?.seed ?? 0;
  const connected = !!account?.connected;
  const livePnl = seed > 0 ? (seed * roi) / 100 : null;
  /** 목표가·손절가까지 남은 변동률(현재가 기준, 방향 반영) */
  const toTargetPct = ((target - price) / (price || 1)) * 100 * dir;
  const toStopPct = ((stop - price) / (price || 1)) * 100 * dir;
  const sideClass = signal.side === 'long' ? 'long' : 'short';
  const stateClass = signal.state === 'open' ? 'open' : signal.state === 'win' ? 'win' : 'loss';
  const progress = Math.max(0, Math.min(1, signal.progress));
  const dec = signal.decimals;

  /** 실전 주문 콕핏 — 연결된 계좌 잔고 · 리스크% 기준 수량·증거금·손익 */
  const appliedRisk = profile ? resolveRiskPct(profile.style, riskPct) : null;
  const plan =
    seed > 0 && appliedRisk != null
      ? planOrderForSignal(signal, {
          seed,
          riskPct: appliedRisk,
          leverage: lev,
          spec: contract ?? undefined,
          available: account?.available ?? null,
        })
      : null;

  const [copied, setCopied] = useState<'entry' | 'qty' | null>(null);
  const copyTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const copyField = async (kind: 'entry' | 'qty', text: string) => {
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(kind);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1500);
  };

  /** 비트겟 선물 화면을 연다 — 앱에서는 비트겟 안드로이드 앱, 웹에서는 새 탭. 카드의 공유 모달은 열리지 않는다. */
  const openBitget = () => {
    void openBitgetFutures(signal.symbol, bitgetFuturesUrl(signal.symbol));
  };
  const copyProps = (kind: 'entry' | 'qty', text: string, label: string) => ({
    type: 'button' as const,
    className: `copy-btn ${copied === kind ? 'done' : ''}`,
    'aria-label': `${label} 복사`,
    title: `${label} 복사 — 비트겟 주문 화면에 붙여넣기`,
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      void copyField(kind, text);
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
    },
  });
  const entryCopy = copyPriceText(entry, dec);
  const qtyCopy = plan?.valid ? copyQtyText(plan.qty, plan.qtyDecimals) : '';
  const minNotionalUsd = Math.round(contract?.minTradeUsdt ?? 5);

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

      <div className="rr-row">
        <span className="rr-pill">
          손익비 <b>{fmtRR(signal.rr, 1)}</b>
        </span>
        <span className="rr-pill muted">
          잔여 <b>{signal.state === 'open' ? signal.remainingRR.toFixed(1) : '0.0'}R</b>
        </span>
        <span className="rr-pill muted">
          {signal.winRateBasis === 'bench' ? '전수 승률' : '최근 승률'} <b>{signal.winRate.toFixed(0)}%</b>
        </span>
        <span className="rr-pill muted">
          {signal.barsSince === 0 ? '방금 감지' : `${signal.barsSince}봉 전`}
        </span>
      </div>

      <div className="chart-wrap">
        <MiniCandles candles={signal.candles} signal={signal} showLabels />
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

      {signal.state === 'open' && !connected && (
        <section className="cockpit unlinked" data-cockpit-unlinked aria-label="계좌 연결 안내">
          <header className="cockpit-head">
            <span className="cockpit-title">🎯 실전 주문</span>
            <span className="cockpit-risk">실계좌 미연결</span>
          </header>
          <p className="cockpit-unlinked-note">{ACCOUNT_UNLINKED_HINT}</p>
          {onConnectAccount && (
            <button
              type="button"
              className="cockpit-connect"
              onClick={(e) => {
                e.stopPropagation();
                onConnectAccount();
              }}
            >
              비트겟 계좌 연결하기
            </button>
          )}
        </section>
      )}

      {connected && plan?.valid && signal.state === 'open' && (
        <section className="cockpit" aria-label="계좌 잔고를 지키는 실전 주문">
          <header className="cockpit-head">
            <span className="cockpit-title">🎯 실전 주문</span>
            <span className="cockpit-risk" data-cockpit-risk>
              계좌 {fmtUsdtBalance(account?.equity)}의 {plan.riskPct}% · {lev}x
            </span>
          </header>
          <div className="cockpit-grid">
            <div className="cockpit-cell">
              <span>주문 수량</span>
              <b>
                {formatQty(plan.qty, plan.qtyDecimals)} <i className="unit">{signal.base}</i>
              </b>
            </div>
            <div className="cockpit-cell">
              <span>필요 증거금</span>
              <b>{fmtUsd(plan.margin)}</b>
            </div>
            <div className="cockpit-cell">
              <span>손절 도달 시</span>
              <b className="down">{fmtUsdAmount(plan.stopLossUsd)}</b>
              <i className="down">{fmtPct(plan.lossRoiPct, 2)}</i>
            </div>
            <div className="cockpit-cell">
              <span>목표 도달 시</span>
              <b className="up">{fmtUsdAmount(plan.profitUsd)}</b>
              <i className="up">{fmtPct(plan.profitRoiPct, 2)}</i>
            </div>
          </div>
          <div className="cockpit-foot">
            <span>포지션 {fmtUsd(plan.notional)}</span>
            <span>손익비 {fmtRR(plan.rr, 1)}</span>
            {profile && (
              <span>
                {STYLE_META[profile.style].emoji} {STYLE_META[profile.style].label}
              </span>
            )}
            {plan.cappedByAvailable && (
              <span className="cockpit-warn">가용 잔고에 맞춰 수량을 줄였습니다</span>
            )}
            {plan.overSeed && <span className="cockpit-warn">⚠️ 증거금이 계좌 잔고보다 큽니다</span>}
            {plan.belowMinQty && (
              <span className="cockpit-warn">
                ⚠️ 최소 주문 수량 {formatQty(plan.minQty ?? 0, plan.qtyDecimals)} {signal.base}보다 작습니다
              </span>
            )}
            {plan.belowMinNotional && (
              <span className="cockpit-warn">⚠️ 비트겟 최소 주문 금액 ${minNotionalUsd} 미만</span>
            )}
          </div>
        </section>
      )}

      <div className="card-actions">
        {onQuickOrder && signal.state === 'open' && plan?.valid && (
          <button
            type="button"
            className={`quick-order-btn ${quickOrderMode === 'live' ? 'live' : ''} ${quickOrderBusy ? 'busy' : ''}`}
            aria-label={`${signal.base} ${signal.side === 'long' ? '롱' : '숏'} 원클릭 주문`}
            disabled={quickOrderBusy}
            data-quick-order
            onClick={(e) => {
              e.stopPropagation();
              onQuickOrder(signal);
            }}
          >
            <span className="quick-order-emoji">⚡</span>
            <span className="quick-order-copy">
              <b>{quickOrderBusy ? '주문 중…' : `원클릭 ${quickOrderMode === 'live' ? '실거래' : '모의'} 주문`}</b>
              <i>
                {formatQty(plan.qty, plan.qtyDecimals)} {signal.base} · 스크 {fmtUsd(plan.riskUsd)}
              </i>
            </span>
          </button>
        )}
        {onToggleMyTrade && (
          <button
            type="button"
            className={`pin-btn ${isMyTrade ? 'on' : ''}`}
            aria-pressed={isMyTrade}
            aria-label={isMyTrade ? `${signal.base} 내 진입 기록 해제` : `${signal.base} 내 진입으로 기록`}
            title={
              isMyTrade
                ? '내 진입 기록 해제'
                : '내 진입으로 기록 — 기록 탭에서 내 실제 매매만 따로 복기'
            }
            onClick={(e) => {
              e.stopPropagation();
              onToggleMyTrade();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
            }}
          >
            {isMyTrade ? '✓ 진입함' : '📌 내 진입'}
          </button>
        )}
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
        <div className="copy-group">
          <button {...copyProps('entry', entryCopy, '진입가')}>
            {copied === 'entry' ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            {copied === 'entry' ? '복사됨' : '진입가'}
          </button>
          {qtyCopy && (
            <button {...copyProps('qty', qtyCopy, '주문 수량')}>
              {copied === 'qty' ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
              {copied === 'qty' ? '복사됨' : '수량'}
            </button>
          )}
        </div>
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
        <span className={`share-hint${stale ? ' stale-hint' : ''}`}>
          {stale ? '보관된 스냅샷 · 탭하여 공유' : '탭하여 공유 카드'}
        </span>
      </footer>
    </article>
  );
}
