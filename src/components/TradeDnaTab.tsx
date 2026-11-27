import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cooldownRemainMin,
  dnaProfile,
  findings,
  fmtHold,
  holdReport,
  LEV_BUCKETS,
  leverageBoard,
  lossStreakCooldown,
  revengeReport,
  sideBoard,
  timeHeatmap,
  type DnaTrade,
} from '../engine/tradeDna';
import {
  demoDnaTrades,
  loadRealAccountHistory,
  pickJournalTrades,
  tradesFromJournal,
  type RealHistoryResult,
} from '../lib/tradeDnaSource';
import type { HistoryRecord, MyTrade } from '../lib/storage';
import type { AutoTradeApi } from '../hooks/useAutoTrade';
import { fmtR } from '../lib/journal';
import { fmtTime } from '../lib/format';
import { RefreshIcon } from './Icons';

type ViewMode = 'auto' | 'demo';

interface Props {
  history: HistoryRecord[];
  myTrades: MyTrade[];
  autoTrade: AutoTradeApi;
}

const pctBars = (value: number) => `${Math.max(0, Math.min(100, value))}%`;

export function TradeDnaTab({ history, myTrades, autoTrade }: Props) {
  const [mode, setMode] = useState<ViewMode>('auto');
  const [now, setNow] = useState(() => Date.now());
  const [real, setReal] = useState<RealHistoryResult | null>(null);
  const [loadingReal, setLoadingReal] = useState(false);

  // 쿨다운 남은 시간이 줄어드는 걸 보여주기 위해 30초마다 시계만 갱신한다.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const journal = useMemo(() => tradesFromJournal(history, myTrades), [history, myTrades]);
  const picked = useMemo(() => pickJournalTrades(journal), [journal]);

  const loadReal = useCallback(async () => {
    setLoadingReal(true);
    const res = await loadRealAccountHistory(90);
    setReal(res);
    setLoadingReal(false);
    setNow(Date.now());
  }, []);

  // 앱(APK)에서 계좌가 연결돼 있으면 한 번 자동으로 시도한다 — 브리지가 없으면 그 사실만 남는다.
  useEffect(() => {
    if (!autoTrade.keys.hasKeys) return;
    void loadReal();
  }, [autoTrade.keys.hasKeys, loadReal]);

  const demo = useMemo(() => (mode === 'demo' ? demoDnaTrades(now) : []), [mode, now]);
  const realTrades = real?.status === 'ok' ? real.trades : [];
  const trades: DnaTrade[] = mode === 'demo' ? demo : realTrades.length ? realTrades : picked.trades;

  const basis: 'demo' | 'real' | 'own' | 'signal' | 'none' =
    mode === 'demo'
      ? 'demo'
      : realTrades.length
        ? 'real'
        : picked.basis === 'own' && picked.trades.length
          ? 'own'
          : picked.trades.length
            ? 'signal'
            : 'none';

  const basisText: Record<typeof basis, string> = {
    demo: 'DEMO — 실제 매매가 아닌 시뮬레이션 데이터입니다',
    real: `비트겟 실계좌 과거 체결 ${realTrades.length}건`,
    own: `내 진입 기록 ${picked.trades.length}건 (시그널에 '내 진입'으로 표시한 매매)`,
    signal: `시그널 복기 ${picked.trades.length}건 — 내 실제 체결이 아니라 COTA 가 감지한 시그널 결과입니다`,
    none: '분석할 기록이 없습니다',
  };

  const profile = useMemo(() => dnaProfile(trades), [trades]);
  const facts = useMemo(() => findings(trades), [trades]);
  const heat = useMemo(() => timeHeatmap(trades), [trades]);
  const lev = useMemo(() => leverageBoard(trades), [trades]);
  const sides = useMemo(() => sideBoard(trades), [trades]);
  const hold = useMemo(() => holdReport(trades), [trades]);
  const revenge = useMemo(() => revengeReport(trades), [trades]);

  const cfg = autoTrade.config;
  const cooldownOn = cfg.cooldownLosses > 0;
  const cooldown = lossStreakCooldown(trades, { losses: cfg.cooldownLosses, minutes: cfg.cooldownMin }, now);
  const remain = cooldownRemainMin(cooldown, now);

  const toggleCooldown = () => {
    autoTrade.patchConfig(cooldownOn ? { cooldownLosses: 0 } : { cooldownLosses: 2, cooldownMin: cfg.cooldownMin || 60 });
    setNow(Date.now());
  };

  const maxLevR = Math.max(0.5, ...lev.map((b) => Math.abs(b.cumR)));
  const maxSideR = Math.max(0.5, ...sides.map((s) => Math.abs(s.cumR)));

  return (
    <div className="tab dna-tab" data-dna>
      <section className="summary-card">
        <div className="summary-top">
          <div>
            <div className="summary-title">
              🧠 내 매매 DNA
              <span className={`tool-badge ${profile.stat.cumR >= 0 ? 'up' : 'down'}`}>
                {profile.closed}건 · {fmtR(profile.stat.cumR)}
              </span>
              {basis === 'demo' && <span className="tool-badge down">DEMO</span>}
            </div>
            <div className="summary-sub" data-dna-basis>
              {loadingReal ? '실계좌 체결을 확인하는 중…' : basisText[basis]}
            </div>
          </div>
          <button className={`rescan ${loadingReal ? 'busy' : ''}`} onClick={() => void loadReal()} disabled={loadingReal}>
            <RefreshIcon size={15} />
            {loadingReal ? '확인 중' : '다시 분석'}
          </button>
        </div>

        <div className="dna-headline" data-dna-headline>
          {profile.closed ? profile.headline : '기록이 쌓이면 습관이 보입니다'}
        </div>

        <div className="dna-kpis">
          <div className="dna-kpi">
            <span>승률</span>
            <b className={profile.stat.winRate >= 50 ? 'up' : ''}>{profile.closed ? `${profile.stat.winRate.toFixed(0)}%` : '—'}</b>
            <em>
              {profile.stat.wins}승 {profile.stat.losses}패{profile.stat.open ? ` · 진행 ${profile.stat.open}` : ''}
            </em>
          </div>
          <div className="dna-kpi">
            <span>누적 손익</span>
            <b className={profile.stat.cumR >= 0 ? 'up' : 'down'} data-dna-cumr>
              {profile.closed ? fmtR(profile.stat.cumR) : '—'}
            </b>
            <em>1건 평균 {profile.closed ? fmtR(profile.stat.avgR) : '—'}</em>
          </div>
          <div className="dna-kpi">
            <span>뇌동매매</span>
            <b className={revenge.count ? 'down' : ''} data-dna-revenge-count>
              {revenge.count}회
            </b>
            <em>{revenge.windowMin}분 내 재진입</em>
          </div>
        </div>

        <div className="segmented dna-source">
          <button className={mode === 'auto' ? 'on' : ''} onClick={() => setMode('auto')} data-dna-mode="auto">
            내 기록 분석
          </button>
          <button className={mode === 'demo' ? 'on' : ''} onClick={() => setMode('demo')} data-dna-mode="demo">
            데모 시뮬레이션
          </button>
        </div>
      </section>

      {mode === 'demo' && (
        <div className="notice" data-dna-demo-note>
          데모는 화면을 먼저 보기 위한 <b>가짜 기록</b>입니다 — 내 매매 성적과 섞이지 않으며, '내 기록 분석'을 누르면 즉시 실제
          기록으로 돌아갑니다.
        </div>
      )}

      {mode === 'auto' && real && real.status !== 'ok' && autoTrade.keys.hasKeys && (
        <div className="notice" data-dna-real>
          <b>비트겟 실계좌 체결:</b> {real.reason}
        </div>
      )}

      {basis === 'none' && (
        <div className="notice" data-dna-empty>
          <b>매매 기록이 없습니다.</b> 시그널 카드에서 <b>내 진입</b>을 체크하거나, 비트겟 API 를 연결하면 자동으로 분석됩니다.
          기록이 0건일 때는 위의 <b>데모 시뮬레이션</b>으로 화면을 미리 볼 수 있습니다.
        </div>
      )}

      {basis === 'real' || basis === 'own' || basis === 'demo' ? null : (
        <div className="notice" data-dna-signal-note>
          지금은 <b>시그널 복기</b>로 분석합니다 — 내 실제 체결 습관은 '내 진입' 표시가 쌓이면 그 기록으로 바뀝니다.
        </div>
      )}

      {facts.length > 0 && (
        <section className="panel" data-dna-facts>
          <header className="panel-head">
            <h3>🩺 뇌동매매 닥터</h3>
            <span className="panel-note">기록에서 확인된 사실만</span>
          </header>
          <ul className="dna-facts">
            {facts.map((f, i) => (
              <li key={`${f.title}-${i}`} className={`dna-fact ${f.tone}`}>
                <span className="dna-fact-metric">{f.metric}</span>
                <div>
                  <b>{f.title}</b>
                  <span>{f.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel" data-dna-heatmap>
        <header className="panel-head">
          <h3>🕒 시간대별 승률 히트맵</h3>
          <span className="panel-note">KST · 진입 시각 기준</span>
        </header>
        <div className="dna-heat">
          {heat.map((b) => (
            <div className="dna-heat-row" key={b.key} data-bucket={b.key} data-n={b.n}>
              <span className="dna-heat-label">
                {b.emoji} {b.label}
              </span>
              <div className="dna-bar">
                <span
                  className={b.cumR >= 0 ? 'up' : 'down'}
                  style={{ width: pctBars(b.n ? b.winRate : 0) }}
                />
              </div>
              <span className={`dna-heat-value ${b.cumR >= 0 ? 'up' : 'down'}`}>
                {b.n ? `${b.winRate.toFixed(0)}%` : '—'}
              </span>
              <span className="dna-heat-sub">
                {b.n ? `${b.n}건 · ${fmtR(b.cumR)}` : '표본 없음'}
              </span>
            </div>
          ))}
        </div>
        <p className="panel-note dna-caption">
          막대 길이 = 승률, 색 = 누적 R. 승률이 같아도 누적 R 이 마이너스면 그 시간대는 ‘지는 시간’입니다.
        </p>
      </section>

      <section className="panel" data-dna-leverage>
        <header className="panel-head">
          <h3>⚖️ 레버리지 구간별 손익</h3>
          <span className="panel-note">저배 ≤5x · 중배 6~15x · 고배 16x+</span>
        </header>
        <div className="dna-lev">
          {lev.map((b) => (
            <div className="dna-lev-row" key={b.key} data-lev={b.key} data-n={b.n}>
              <span className="dna-lev-label">
                {LEV_BUCKETS.find((m) => m.key === b.key)?.range} <i>{b.label}</i>
              </span>
              <div className="dna-lev-bar">
                <span
                  className={b.cumR >= 0 ? 'up' : 'down'}
                  style={{ width: pctBars(b.n ? (Math.abs(b.cumR) / maxLevR) * 100 : 0) }}
                />
              </div>
              <b className={b.cumR >= 0 ? 'up' : 'down'}>{b.n ? fmtR(b.cumR) : '—'}</b>
              <span className="dna-lev-sub">{b.n ? `${b.n}건 · 승률 ${b.winRate.toFixed(0)}%` : '기록 없음'}</span>
            </div>
          ))}
        </div>
        <p className="panel-note dna-caption">
          배율은 기록이 생긴 뒤부터 쌓입니다(구버전 기록은 ‘배율 미기록’). 고배 구간 손실은 1회 손실이 커서 R 이 같아도 계좌가 더
          빨리 줄어듭니다.
        </p>
      </section>

      <section className="panel" data-dna-revenge>
        <header className="panel-head">
          <h3>🔁 뇌동매매 탐지기</h3>
          <span className="panel-note">직전 손실 청산 후 {revenge.windowMin}분 내 재진입</span>
        </header>
        <div className="dna-revenge-grid">
          <div>
            <span>복수 매매</span>
            <b className={revenge.count ? 'down' : ''}>{revenge.count}회</b>
            <em>종료 매매의 {revenge.sharePct.toFixed(0)}%</em>
          </div>
          <div>
            <span>그 결과</span>
            <b className={revenge.cumR >= 0 ? 'up' : 'down'}>{revenge.count ? fmtR(revenge.cumR) : '—'}</b>
            <em>승률 {revenge.count ? `${revenge.winRate.toFixed(0)}%` : '—'}</em>
          </div>
          <div>
            <span>전체 손실 비중</span>
            <b className={revenge.lossSharePct >= 30 ? 'down' : ''}>
              {revenge.count ? `${revenge.lossSharePct.toFixed(0)}%` : '—'}
            </b>
            <em>손실 R 중 이 비중</em>
          </div>
        </div>
        {revenge.samples.length > 0 && (
          <ul className="dna-revenge-list">
            {revenge.samples.map((t) => (
              <li key={t.id}>
                <b>{t.base}</b>
                <span>{t.side === 'long' ? '롱' : '숏'}</span>
                <span className={t.r >= 0 ? 'up' : 'down'}>{fmtR(t.r)}</span>
                <span>{t.closedAt ? `${fmtTime(t.closedAt)} 청산` : '청산 시각 미기록'}</span>
              </li>
            ))}
          </ul>
        )}

        <div className={`dna-cooldown ${cooldownOn ? 'on' : ''}`} data-dna-cooldown={cooldownOn ? 'on' : 'off'}>
          <div className="dna-cooldown-copy">
            <b>{cfg.cooldownLosses || 2}연패 후 {cfg.cooldownMin || 60}분 쿨다운</b>
            <span>
              켜면 자동매매가 연패 직후 새 진입 계획을 만들지 않습니다. 기준은 <b>위에서 분석한 기록</b>이며, 청산 시각을 모르는
              기록은 차단 근거로 쓰지 않습니다.
            </span>
            {cooldownOn && (
              <em className={remain > 0 ? 'down' : ''} data-dna-cooldown-state>
                {remain > 0
                  ? `지금 쿨다운 — ${remain}분 남음 (연패 ${cooldown?.streak ?? 0})`
                  : '지금은 쿨다운 아님 · 연패가 쌓이면 자동으로 멈춥니다'}
              </em>
            )}
          </div>
          <button
            className={`switch ${cooldownOn ? 'on' : ''}`}
            onClick={toggleCooldown}
            aria-label="2연패 후 쿨다운 켜기/끄기"
            aria-pressed={cooldownOn}
            data-dna-cooldown-toggle
          >
            <span />
          </button>
        </div>
      </section>

      <section className="panel" data-dna-side>
        <header className="panel-head">
          <h3>↔️ 롱 vs 숏 · 보유 시간</h3>
          <span className="panel-note">보유 시간은 봉 수 × 타임프레임 근사</span>
        </header>
        <div className="dna-side-grid">
          {sides.map((s) => (
            <div className={`dna-side-card ${s.side}`} key={s.side} data-side={s.side}>
              <span className="dna-side-label">{s.label}</span>
              <b>{s.n ? `${s.winRate.toFixed(0)}%` : '—'}</b>
              <div className="dna-side-bar">
                <span
                  className={s.cumR >= 0 ? 'up' : 'down'}
                  style={{ width: pctBars(s.n ? (Math.abs(s.cumR) / maxSideR) * 100 : 0) }}
                />
              </div>
              <em>
                {s.n ? `${s.n}건 · ${fmtR(s.cumR)}` : '기록 없음'}
              </em>
            </div>
          ))}
        </div>
        <div className="dna-hold">
          <div>
            <span>승리 평균 보유</span>
            <b className="up">{fmtHold(hold.winMs)}</b>
            <em>{hold.winN}건</em>
          </div>
          <div>
            <span>패배 평균 보유</span>
            <b className="down">{fmtHold(hold.lossMs)}</b>
            <em>{hold.lossN}건</em>
          </div>
        </div>
      </section>

      <div className="feed-note">
        {basis === 'demo'
          ? '데모 데이터는 실제 시장·계좌와 무관합니다.'
          : basis === 'real'
            ? '비트겟 과거 포지션(수수료·펀딩 반영 netProfit ÷ 증거금)으로 계산했습니다.'
            : '매매일지(시그널 이력 + 내 진입 표시)로 계산했습니다. 청산 시각·보유 시간은 봉 수로 근사하며, 배율은 기록에 있는 값만 씁니다.'}
        {basis !== 'demo' && (
          <>
            {' '}
            <button className="link-btn" onClick={() => setMode('demo')}>
              데모로 비교
            </button>
          </>
        )}
      </div>
    </div>
  );
}
