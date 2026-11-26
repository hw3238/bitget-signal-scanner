import { useCallback, useMemo, useState } from 'react';
import type { ProprHit, ProprGroup } from '../engine/propr';
import {
  fmtUsd,
  matchProprFilter,
  PROPR_FILTERS,
  PROPR_RISK_CHOICES,
  proprOrderGuide,
  proprPlanLines,
  TURBO_5K,
  turboAccount,
  type ProprGuide,
} from '../engine/propr';
import type { ProprState } from '../hooks/usePropr';
import type { TF } from '../engine/types';
import { fmtPct, fmtPrice, fmtTime, fmtVolume } from '../lib/format';
import { copyToClipboard } from '../lib/clipboard';
import { openExternalUrl } from '../lib/native';
import { PROPR_UNIVERSE_AT } from '../engine/proprUniverse';
import { CoinLogo } from './CoinLogo';
import { MiniCandles } from './MiniCandles';
import { ArrowUpRightIcon, CheckIcon, CopyIcon, RefreshIcon } from './Icons';

/**
 * 🏆 Propr 5K 터보 전용 시그널 화면
 *
 *  · 상단: 5K Turbo 1-Step 계좌 트래커(잔고·목표 $5,450·하한 $4,850·일일 −$150)
 *  · 카드: Hyperliquid 실시간 캔들로 탐지한 프랍 전용 시그널 + 1회 리스크($25/$37.5/$50) 기준
 *          주문 가이드(레버리지·포지션 금액·증거금·손절/익절 금액)와 복사 버튼
 *  · 주문은 절대 여기서 나가지 않는다 — propr.xyz 에서 직접 진입(복사용 문구만 제공).
 */

const PROPR_URL = 'https://www.propr.xyz/';
const BALANCE_KEY = 'cota.propr.balance.v1';
const DAYSTART_KEY = 'cota.propr.daystart.v1';
const RISK_KEY = 'cota.propr.risk.v1';
const MAX_CARDS = 20;

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
}

/** 감지 경과 표기 — 0봉이면 '방금 감지' */
function barsAgo(bars: number): string {
  return bars <= 0 ? '방금 감지' : `${bars}봉 전 감지`;
}

function hoursLabel(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '곧 리셋';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h <= 0) return `${m}분 뒤 리셋`;
  return `${h}시간 ${m}분 뒤 리셋`;
}

interface Props {
  state: ProprState;
  scan: (opts?: { force?: boolean; all?: boolean; tf?: TF }) => void;
  setTf: (tf: TF) => void;
}

export function ProprTab({ state, scan, setTf }: Props) {
  const [balance, setBalance] = useState(() => readNumber(BALANCE_KEY, TURBO_5K.startBalance));
  const [dayStart, setDayStart] = useState(() => readNumber(DAYSTART_KEY, TURBO_5K.startBalance));
  /** '오늘 시작 잔고'를 직접 적었는지 — 아니면 현재 잔고를 따라간다 */
  const [dayStartCustom, setDayStartCustom] = useState(() => {
    try {
      return !!localStorage.getItem(DAYSTART_KEY);
    } catch {
      return false;
    }
  });
  const [riskPct, setRiskPct] = useState(() => readNumber(RISK_KEY, 0.5));
  const [group, setGroup] = useState<ProprGroup>('all');
  const [openOnly, setOpenOnly] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  const tf = state.tf;
  const account = useMemo(() => turboAccount(balance, dayStart), [balance, dayStart]);

  /** 잔고를 고치면 '오늘 시작 잔고'도 같이 따라간다(사용자가 따로 적은 뒤에는 그 값 유지). */
  const changeBalance = useCallback(
    (next: number) => {
      const value = Math.max(100, Math.min(100_000, Math.round(next)));
      setBalance(value);
      writeNumber(BALANCE_KEY, value);
      if (!dayStartCustom) {
        setDayStart(value);
        writeNumber(DAYSTART_KEY, value);
      }
    },
    [dayStartCustom],
  );

  const changeRisk = (pct: number) => {
    setRiskPct(pct);
    writeNumber(RISK_KEY, pct);
  };

  const changeDayStart = (next: number) => {
    const value = Math.max(100, Math.min(100_000, Math.round(next)));
    setDayStart(value);
    setDayStartCustom(true);
    writeNumber(DAYSTART_KEY, value);
  };

  const filter = { group, tf, openOnly };
  const hits = useMemo(() => state.hits.filter((h) => matchProprFilter(h, filter)), [state.hits, group, tf, openOnly]);
  const openHits = useMemo(() => state.hits.filter((h) => h.signal.state === 'open' && h.signal.tf === tf), [state.hits, tf]);

  const guideFor = useCallback(
    (hit: ProprHit): ProprGuide =>
      proprOrderGuide({
        side: hit.signal.side,
        entry: hit.signal.entry,
        stop: hit.signal.stop,
        target: hit.signal.target,
        balance: account.balance,
        riskPct,
        cap: hit.market.maxLever,
        dailyRoomUsd: account.dailyRoomUsd,
        remainingToTargetUsd: account.remainingUsd || TURBO_5K.targetProfit,
      }),
    [account.balance, account.dailyRoomUsd, account.remainingUsd, riskPct],
  );

  const shown = hits.slice(0, MAX_CARDS);
  const best = openHits[0];
  const pct = state.progress.total ? Math.round((state.progress.done / state.progress.total) * 100) : 0;
  const scanning = state.status === 'scanning';

  const copy = async (hit: ProprHit) => {
    const ok = await copyToClipboard(proprPlanLines(hit, guideFor(hit)));
    if (!ok) return;
    setCopied(hit.signal.id);
    window.setTimeout(() => setCopied((cur) => (cur === hit.signal.id ? null : cur)), 1600);
  };

  return (
    <div className="tab propr-tab" data-propr-root>
      {/* ---------- 요약 ---------- */}
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">
              🏆 Propr 5K 터보 시그널
              <span className="tool-badge">5K Turbo 1-Step</span>
              {best && <span className="tool-badge up">TOP {best.market.base}</span>}
            </div>
            <div className="summary-sub" data-propr-sub>
              {state.listingCount
                ? `Propr 상장 ${state.listingCount}종목 중 ${state.scanned}종목 · Hyperliquid 실시간 ${state.allMode ? '전체 탐지' : '거래대금 상위'} · ${state.at ? `${fmtTime(state.at)} 기준` : '탐지 중'}`
                : `Propr 상장 종목 · Hyperliquid 실시간 시세 ${state.at ? `${fmtTime(state.at)} 기준` : '탐지 중'}`}
            </div>
          </div>
          <button
            className={`rescan ${scanning ? 'busy' : ''}`}
            onClick={() => scan({ force: true, all: state.allMode })}
            disabled={scanning}
            data-propr-rescan
          >
            <RefreshIcon size={15} />
            {scanning ? `${pct}%` : '다시 탐지'}
          </button>
        </div>

        {scanning && (
          <div className="surge-progress" data-propr-progress>
            <div className="surge-progress-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="surge-progress-text">
              {state.progress.total ? '캔들 받는 중' : '종목·시세 확인 중'} · {state.progress.done}/{state.progress.total || '—'}
              {state.progress.failed ? ` · 실패 ${state.progress.failed}` : ''}
            </span>
          </div>
        )}

        <div className="propr-rules" data-propr-rules>
          <span>목표 <b>+9% ($450)</b></span>
          <span>일일 손실 <b>−3% ($150)</b></span>
          <span>최대 낙폭 <b>3% static</b></span>
          <span>시간 제한 <b>없음</b></span>
        </div>

        <div className="propr-universe">
          <button className="link-btn" onClick={() => scan({ force: true, all: !state.allMode })} data-propr-all>
            {state.allMode ? '거래대금 상위만 탐지' : '전체 종목 탐지'}
          </button>
          <span className="propr-universe-note">
            {state.allMode
              ? '전체 탐지는 요청이 많아 1~3분 걸릴 수 있습니다.'
              : 'Hyperliquid 캔들 한도 때문에 기본은 거래대금 상위 28종목(자산군별 최소 3)만 훑습니다.'}
          </span>
        </div>
      </section>

      {/* ---------- 5K 터보 계좌 트래커 ---------- */}
      <section className={`propr-account ${account.breached ? 'breached' : account.passed ? 'passed' : ''}`} data-propr-account>
        <header className="propr-account-head">
          <div>
            <b>5K 터보 계좌</b>
            <span data-propr-status>
              {account.passed
                ? '✅ 목표 달성 — Propr에서 통과 처리됩니다'
                : account.breached
                  ? '⛔ 탈락선 터치 — 잔고를 확인하세요'
                  : `목표까지 ${fmtUsd(account.remainingUsd)}`}
            </span>
          </div>
          <div className="propr-balance">
            <span>$</span>
            <input
              type="number"
              inputMode="decimal"
              step={10}
              min={100}
              max={100000}
              value={balance}
              onChange={(e) => changeBalance(Number(e.target.value))}
              aria-label="현재 계좌 잔고(달러)"
              data-propr-balance
            />
            <button
              type="button"
              className="propr-reset"
              onClick={() => {
                setBalance(TURBO_5K.startBalance);
                setDayStart(TURBO_5K.startBalance);
                setDayStartCustom(false);
                writeNumber(BALANCE_KEY, TURBO_5K.startBalance);
                writeNumber(DAYSTART_KEY, TURBO_5K.startBalance);
              }}
            >
              초기화
            </button>
          </div>
        </header>

        <div className="propr-goal">
          <div className="propr-goal-bar">
            <span style={{ width: `${account.progressPct}%` }} data-propr-progressbar />
            <i className="propr-goal-start" />
            <i className="propr-goal-target" />
          </div>
          <div className="propr-goal-label">
            <span>시작 {fmtUsd(account.startBalance)}</span>
            <b data-propr-target>
              목표 {fmtUsd(account.targetBalance)} <em>(+{fmtUsd(account.targetProfit)})</em>
            </b>
          </div>
          <div className="propr-goal-pct">
            {account.profitUsd >= 0 ? '+' : ''}
            {fmtUsd(account.profitUsd)} · {account.rawProgressPct.toFixed(1)}%
          </div>
        </div>

        <div className="propr-cells">
          <div className="propr-cell">
            <span>절대 하한 (static)</span>
            <b data-propr-floor>{fmtUsd(account.floorBalance)}</b>
            <em className={account.floorRoomUsd <= 0 ? 'down' : ''}>여유 {fmtUsd(account.floorRoomUsd)}</em>
          </div>
          <div className="propr-cell">
            <span>오늘 손실 여유 (3%)</span>
            <b data-propr-daily>−{fmtUsd(account.dailyRoomUsd)}</b>
            <em>{hoursLabel(account.hoursToReset)}</em>
          </div>
          <div className="propr-cell">
            <span>1회 리스크</span>
            <b data-propr-risk-usd>{fmtUsd((account.balance * riskPct) / 100, 2)}</b>
            <em>
              일일 한도의 {(account.dailyRoomUsd > 0 ? ((account.balance * riskPct) / 100 / account.dailyRoomUsd) * 100 : 0).toFixed(0)}%
            </em>
          </div>
        </div>

        <div className="propr-daystart">
          <span>오늘 시작 잔고</span>
          <input
            type="number"
            inputMode="decimal"
            step={10}
            min={100}
            max={100000}
            value={dayStart}
            onChange={(e) => changeDayStart(Number(e.target.value))}
            aria-label="오늘 시작 잔고(달러) — 일일 손실 한도 기준"
            data-propr-daystart
          />
          <em>Propr은 매일 00:00 UTC 에 그날 시작 잔고의 3%로 일일 한도를 다시 잡습니다.</em>
        </div>

        <div className="propr-risk">
          <span className="propr-risk-label">1회 리스크</span>
          <div className="segmented propr-risk-chips" role="group" aria-label="1회 리스크 선택">
            {PROPR_RISK_CHOICES.map((c) => (
              <button
                key={c.pct}
                className={riskPct === c.pct ? 'on' : ''}
                onClick={() => changeRisk(c.pct)}
                data-propr-risk={c.pct}
              >
                {c.label} <i>{fmtUsd((account.balance * c.pct) / 100, 2)}</i>
                {c.recommended && <em>추천</em>}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- 필터 ---------- */}
      <div className="segmented propr-filters" role="group" aria-label="자산군">
        {PROPR_FILTERS.map((f) => {
          const count = state.hits.filter((h) => matchProprFilter(h, { group: f.key, tf, openOnly })).length;
          return (
            <button key={f.key} className={group === f.key ? 'on' : ''} data-group={f.key} onClick={() => setGroup(f.key)}>
              {f.label} <i>{count}</i>
            </button>
          );
        })}
      </div>
      <div className="propr-subfilters">
        <div className="segmented slim" role="group" aria-label="타임프레임">
          {(['1H', '4H'] as TF[]).map((t) => (
            <button key={t} className={tf === t ? 'on' : ''} data-tf={t} onClick={() => setTf(t)} disabled={scanning && tf !== t}>
              {t}
            </button>
          ))}
        </div>
        <button className={`ghost-toggle ${openOnly ? 'on' : ''}`} onClick={() => setOpenOnly((v) => !v)} data-open-only>
          {openOnly ? '진행중만' : '종료 포함'}
        </button>
        <span className="propr-count">
          진행중 <b data-propr-open-count>{openHits.length}</b>건 · 상장 {state.listingCount || 146}종목
        </span>
      </div>

      {state.error && <div className="notice error" data-propr-error>{state.error}</div>}

      {!scanning && !state.error && hits.length === 0 && (
        <div className="notice" data-propr-empty>
          {openOnly
            ? '지금은 진행 중인 프랍 시그널이 없습니다 — 「종료 포함」으로 최근 셋업을 보거나 「다시 탐지」를 눌러주세요.'
            : '조건에 맞는 프랍 시그널이 없습니다. 다른 자산군·타임프레임을 선택해 보세요.'}
        </div>
      )}

      {/* ---------- 시그널 카드 ---------- */}
      {shown.map((hit, idx) => {
        const g = guideFor(hit);
        const m = hit.market;
        const s = hit.signal;
        const closed = s.state !== 'open';
        return (
          <article
            className={`propr-card ${closed ? 'closed' : ''} ${idx === 0 && !closed ? 'top' : ''}`}
            key={s.id}
            data-symbol={m.base}
            data-coin={m.coin}
            data-tf={s.tf}
            data-side={s.side}
            data-state={s.state}
            data-cap={m.maxLever}
            data-price={m.price}
            data-lev={g.leverage}
            data-notional={Math.round(g.notional)}
            data-risk={g.riskUsd.toFixed(2)}
          >
            <header className="propr-head">
              <span className="propr-rank">{idx + 1}</span>
              <CoinLogo base={m.base} asset={m.asset} side={s.side} size={38} />
              <div className="propr-name">
                <b>
                  {m.base}
                  {m.dex && <i className="propr-sym">{`${m.dex}:${m.base}`}</i>}
                  <i className={`propr-side ${s.side}`}>{s.side === 'long' ? '롱' : '숏'}</i>
                </b>
                <span>
                  {fmtPrice(m.price, m.decimals)} · 24h <i className={m.change24h >= 0 ? 'up' : 'down'}>{fmtPct(m.change24h, 1)}</i> · OI{' '}
                  {fmtVolume(m.oiUsd)}
                </span>
              </div>
              <div className="propr-badge">
                <b data-propr-badge>{hit.badge}</b>
                <span>{s.tf} · {closed ? (s.state === 'win' ? '목표 달성' : '손절 종료') : barsAgo(s.barsSince)}</span>
              </div>
            </header>

            <MiniCandles candles={s.candles} signal={s} height={104} showLabels />

            <div className="propr-plan">
              <div className="propr-plan-cell">
                <span>진입가</span>
                <b>{fmtPrice(s.entry, m.decimals)}</b>
                <em>현재 {fmtPct(s.changePct, 2)}</em>
              </div>
              <div className="propr-plan-cell down">
                <span>손절가</span>
                <b>{fmtPrice(s.stop, m.decimals)}</b>
                <em>-{g.stopPct.toFixed(2)}%</em>
              </div>
              <div className="propr-plan-cell up">
                <span>목표가 {g.rr.toFixed(1)}R</span>
                <b>{fmtPrice(s.target, m.decimals)}</b>
                <em>+{g.targetPct.toFixed(2)}%</em>
              </div>
              <div className="propr-plan-cell">
                <span>전수 승률</span>
                <b>{s.winRate.toFixed(1)}%</b>
                <em>{s.winRateBasis === 'market' ? '마켓 실측' : '전수 검증'} · {s.star}★</em>
              </div>
            </div>

            {/* 프랍 전용 주문 가이드 */}
            <div className="propr-guide" data-propr-guide>
              <div className="propr-guide-head">
                <b>주문 가이드</b>
                <span>
                  1회 리스크 {fmtUsd(g.riskUsd, 2)} · 상한 {g.cap}x 이내
                </span>
              </div>
              <div className="propr-guide-grid">
                <div className="propr-guide-cell">
                  <span>레버리지</span>
                  <b data-guide-lev>{g.leverage}x</b>
                  <em>상한 {g.cap}x</em>
                </div>
                <div className="propr-guide-cell">
                  <span>포지션 금액</span>
                  <b data-guide-notional>{fmtUsd(g.notional)}</b>
                  <em>증거금 {fmtUsd(g.margin)} ({g.marginPct.toFixed(0)}%)</em>
                </div>
                <div className="propr-guide-cell down">
                  <span>손절 시</span>
                  <b data-guide-loss>-{fmtUsd(g.lossUsd, 2)}</b>
                  <em>일일 한도의 {g.dailyRoomUsePct.toFixed(0)}%</em>
                </div>
                <div className="propr-guide-cell up">
                  <span>목표 도달 시</span>
                  <b data-guide-profit>+{fmtUsd(g.profitUsd, 2)}</b>
                  <em>$450 목표의 {g.targetSharePct.toFixed(0)}%</em>
                </div>
              </div>
              {g.warnings.map((w) => (
                <div className="propr-warn" key={w}>⚠️ {w}</div>
              ))}
              {closed && <div className="propr-warn muted">이미 종료된 시그널입니다 — 진입 대신 전략 성적 참고용으로 보세요.</div>}
            </div>

            <div className="propr-detail">
              전략 <b>{s.strategyName}</b> · 기대값 <b>{s.strategyExp.toFixed(2)}R</b> · 수수료 왕복 {m.takerPct.toFixed(3)}% · 펀딩{' '}
              <b>{m.fundingPct >= 0 ? '+' : ''}{m.fundingPct.toFixed(3)}%</b>/h · {barsAgo(s.barsSince)}
            </div>

            <div className="propr-actions">
              <button className="ghost-btn small" onClick={() => void copy(hit)} data-copy>
                {copied === s.id ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                {copied === s.id ? '복사됨' : '주문 가이드 복사'}
              </button>
              <button className="link-btn" onClick={() => void openExternalUrl(PROPR_URL)} aria-label="propr.xyz 열기">
                propr.xyz <ArrowUpRightIcon size={11} />
              </button>
            </div>
          </article>
        );
      })}

      {hits.length > shown.length && (
        <div className="feed-note" data-propr-overflow>
          시그널이 {hits.length}건이라 상위 {shown.length}건만 표시합니다 — 자산군·타임프레임 필터로 좁혀 보세요.
        </div>
      )}

      <div className="feed-note">
        Propr 5K Turbo 1-Step 규정: 시작 $5,000 · 목표 +9%($450 → $5,450) · 일일 손실 3%($150, UTC 00:00 리셋) ·
        최대 낙폭 3% static(하한 $4,850) · 시간 제한·최소 거래일 없음. 시세·캔들은 Hyperliquid 공개 API(Propr 상장{' '}
        {PROPR_UNIVERSE_AT} 기준 146종목), 탐지 로직은 COTA 전략 엔진 그대로입니다. 주문은 여기서 나가지 않습니다 —
        propr.xyz 에서 직접 진입하며, 투자 판단과 책임은 본인에게 있습니다.
      </div>
    </div>
  );
}
