import { useEffect, useMemo, useRef, useState } from 'react';
import type { AutoTradeApi } from '../hooks/useAutoTrade';
import type { Signal } from '../engine/types';
import { fmtUsd, formatQty } from '../lib/orderCockpit';
import { fmtPct } from '../lib/format';
import {
  DEFAULTS,
  GUARD_FIELD_LABEL,
  LIMITS,
  LIVE_REFRESH_MS,
  MAJOR_SYMBOLS,
  RISK_HIGH_WARN,
  RISK_PRESET_CHOICES,
  fmtClock,
  fmtSince,
  fmtUsdt,
  guardFieldsChanged,
  guardPatchOf,
  leverageCapLabel,
  partialTpState,
  statusBadge,
  todayFillCount,
  type AutoTradeConfig,
} from '../lib/autotrade';
import { NumField } from './ui';
import { EXCHANGES, type Exchange } from '../lib/exchange';
import { APP_VERSION, APK_DOWNLOAD_URL } from '../lib/update';
import { accountKindLabel } from '../lib/bitgetUta';
import { openExternalUrl } from '../lib/native';

interface Props {
  api: AutoTradeApi;
  signals: Signal[];
  /** 현재 거래소 — 자동매매는 비트겟 계좌 전용이라 바이낸스 모드에서는 안내를 먼저 보여준다 */
  exchange: Exchange;
  /** 바이낸스 모드에서 `Bitget으로 전환` */
  onSwitchExchange: (exchange: Exchange) => void;
}

const SYMBOL_LABEL: Record<string, string> = {
  BTCUSDT: '비트',
  ETHUSDT: '이더',
  SOLUSDT: '솔',
  XRPUSDT: '리플',
};

const LEVEL_LABEL: Record<string, string> = {
  fill: '체결',
  reject: '거부',
  block: '차단',
  exit: '조기 손절',
  partial: '반익절',
  info: '안내',
  error: '오류',
};

/** 레버리지 상한 빠른 선택 — 0 = 상한 없음(유동) */
const LEVERAGE_CAP_CHOICES = [0, 5, 10, 25, 50, 100] as const;

/** 허용 종목 선택별 하단 설명 */
const SYMBOL_SCOPE_HINT = {
  crypto: '주식선물 제외 모든 비트겟 코인 선물',
  majors: `${MAJOR_SYMBOLS.map((s) => SYMBOL_LABEL[s] ?? s).join(' · ')} 4종만`,
  all: '주식선물 포함 모든 비트겟 USDT-M 종목',
} as const;

/**
 * 🤖 비트겟 자동매매 — 키 연결 · 안전장치 · 자동/수동 주문 · 로그.
 * 실제 주문은 앱(안드로이드) 네이티브가 넣고, 이 화면은 명령과 결과만 다룬다.
 */
export function AutoTradeTab({ api, signals, exchange, onSwitchExchange }: Props) {
  const {
    config,
    keys,
    account,
    positions,
    native,
    running,
    busy,
    error,
    daily,
    openPositions,
    runtime,
    tradeMode,
    lastRefreshAt,
    liveRefresh,
  } = api;
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [demoChoice, setDemoChoice] = useState(config.mode !== 'live');
  const [liveAck, setLiveAck] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** 앞선 토스트의 3.2초 타이머가 새 토스트를 지워 버리지 않게 하나만 유지한다 */
  const toastTimer = useRef<number | null>(null);
  /**
   * ② 리스크 · 안전장치 초안 — 이 카드에서 바꾼 값은 `저장`을 눌러야 설정·네이티브 감시에 반영된다.
   * (현우님: "손실한도를 바꿨는데 프리셋에 적용되지가 않아 → 저장 버튼 추가")
   */
  const [draft, setDraft] = useState<AutoTradeConfig>(config);
  const configRef = useRef(config);
  /** 저장 직후 `✓ 저장됨` 피드백 표시 시각 (0 = 표시 안 함) */
  const [savedAt, setSavedAt] = useState(0);

  /** 이 화면이 열려 있는 동안만 12초 실시간 잔고 갱신을 돌린다(나가면 interval 정리). */
  useEffect(() => {
    api.setLiveRefresh(true);
    return () => api.setLiveRefresh(false);
  }, [api.setLiveRefresh]);

  useEffect(() => {
    setDemoChoice(config.mode !== 'live');
  }, [config.mode]);

  /**
   * 설정이 **밖에서** 바뀌면(설정 탭 저장·모드 변경) 초안도 새 값으로 맞춘다.
   * 저장되지 않은 초안이 있으면 사용자가 입력 중인 값을 지키기 위해 건드리지 않는다.
   */
  useEffect(() => {
    const prev = configRef.current;
    if (prev === config) return;
    configRef.current = config;
    setDraft((cur) => (JSON.stringify(cur) === JSON.stringify(prev) ? config : cur));
  }, [config]);

  useEffect(() => {
    if (!savedAt) return;
    const id = window.setTimeout(() => setSavedAt(0), 2600);
    return () => window.clearTimeout(id);
  }, [savedAt]);

  const openSignals = useMemo(() => signals.filter((s) => s.state === 'open' && s.asset !== 'fx'), [signals]);
  /** 🔗 v1.5.5 — 시드는 언제나 연결된 계좌 잔고. 계좌가 없으면 0(계산 불가). */
  const seed = api.accountBase.seed;
  /**
   * 배지·버튼 라벨은 `config.mode` 가 아니라 **키가 실제로 가리키는 계좌**(tradeMode)를 따른다.
   * 껴져 있는데 서비스가 안 돌고 있으면 '대기 중' 으로 구분한다.
   */
  const badge = statusBadge({ ...config, mode: tradeMode.mode }, running);
  const fillsToday = todayFillCount(runtime.logs, Date.now());
  const modeLabel = tradeMode.mode === 'live' ? '실거래' : '모의투자';
  /** ② 초안에서 저장하지 않은 항목 · 저장 버튼 활성화 조건 */
  const changedGuards = useMemo(() => guardFieldsChanged(config, draft), [config, draft]);
  const guardDirty = changedGuards.length > 0;
  const justSaved = savedAt > 0 && !guardDirty;
  const guardStateLabel = guardDirty ? '저장 안 됨' : justSaved ? '✓ 저장됨' : '저장됨';

  /** 50% 반익절을 이미 마친 포지션 키 — 네이티브가 기록한 값 */
  const partialDone = useMemo(() => new Set(native?.partialTpDone ?? []), [native?.partialTpDone]);

  const notify = (text: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, 3200);
  };

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  /** ② 리스크 · 안전장치 저장 — 저장할 항목만 설정에 넣고 초안을 정규화된 값으로 다시 맞춘다. */
  const onSaveGuards = () => {
    const next = api.saveGuards(guardPatchOf(draft));
    setDraft(next);
    setSavedAt(Date.now());
    notify('✓ 저장됨 — 리스크·안전장치와 24시간 감시에 반영했습니다.');
  };

  /** 손실 한도 초기화 — 실수로 누르면 하루 손실 기록이 0%부터 다시 세지므로 한 번 확인을 받는다. */
  const onResetDaily = async () => {
    const ok = window.confirm(
      '현재 잔고 기준으로 오늘 손실 한도를 초기화할까요?\n\n· 지금 계좌 잔고를 오늘의 기준선으로 다시 잡습니다.\n· 오늘 손익은 0%부터 다시 셉니다.\n· 초기화하면 자동매매를 다시 켤 수 있습니다.',
    );
    if (!ok) return;
    const res = await api.resetDailyLimit();
    notify(res.message);
  };

  const onToggle = async () => {
    if (config.enabled) {
      await api.stop();
      notify('자동매매를 껐습니다. 기존 포지션의 TP/SL은 거래소에 그대로 남아 있습니다.');
      return;
    }
    const ok = await api.start();
    if (ok) notify(`${modeLabel} 자동매매를 켰습니다.`);
  };

  return (
    <div className="tab autotrade-tab" data-auto-root>
      {toast && <div className="auto-toast">{toast}</div>}

      {exchange !== 'bitget' && (
        <section className="exchange-only-note" data-auto-bitget-only>
          <div className="exchange-only-copy">
            <b>자동매매·원클릭 주문은 Bitget 계좌 전용입니다</b>
            <p>
              지금은 <b>{EXCHANGES[exchange].koName}</b> 모드 — 시그널 탐지만 동작하고 주문은 나가지 않습니다.
              24시간 자동매매를 쓰려면 비트겟으로 전환하세요.
            </p>
          </div>
          <button
            type="button"
            className="exchange-only-btn"
            data-switch-bitget
            onClick={() => onSwitchExchange('bitget')}
          >
            Bitget으로 전환
          </button>
        </section>
      )}

      {/* ---------- 상태 ---------- */}
      <section className={`auto-hero ${badge.tone}`} data-auto-hero>
        <div className="auto-hero-top">
          <div>
            <div className="auto-eyebrow">🤖 비트겟 자동매매</div>
            <h2 data-auto-badge>{badge.label}</h2>
            <p>
              {config.enabled
                ? `${modeLabel} · ${config.intervalSec}초마다 감시 · 리스크 ${config.riskPct}% · 레버리지 ${leverageCapLabel(config.maxLeverage)} · 최대 ${config.maxPositions}포지션 · 반익절 ${config.partialTp ? 'ON' : 'OFF'}`
                : '기본은 꺼짐 + 모의투자입니다. 켜기 전에 아래 안전장치를 확인하세요.'}
            </p>
          </div>
          <span className={`auto-pill ${badge.tone}`} data-auto-pill>
            {!config.enabled ? '○ OFF' : running ? (tradeMode.mode === 'live' ? '● 실거래' : '● 모의') : '◐ 대기'}
          </span>
        </div>

        <div className="auto-metrics">
          <div className="auto-metric">
            <span>계좌 USDT</span>
            <b>{account?.equity != null ? fmtUsdt(account.equity) : keys.hasKeys ? '확인 중' : '키 미연결'}</b>
          </div>
          <div className="auto-metric">
            <span>오늘 손익</span>
            <b className={daily.pnlUsd >= 0 ? 'up' : 'down'}>
              {daily.pnlUsd === 0 && !daily.limitUsd
                ? '—'
                : daily.limitUsd > 0
                  ? `${fmtUsdt(daily.pnlUsd)} (${fmtPct(daily.pnlPct, 2)})`
                  : fmtUsdt(daily.pnlUsd)}
            </b>
          </div>
          <div className="auto-metric">
            <span>포지션</span>
            <b>
              {openPositions} / {config.maxPositions}
            </b>
          </div>
          <div className="auto-metric">
            <span>1일 손실 한도</span>
            <b className={daily.locked ? 'down' : ''}>
              {config.dailyLossPct === 0 ? '끔' : daily.locked ? '⛔ 잠김' : `−${config.dailyLossPct}%`}
            </b>
          </div>
        </div>

        {/* 실시간 잔고 (v1.5.4) — 총 자산 · 가용 · 미실현 + 마지막 갱신 시각 */}
        <div className="auto-balance" data-auto-balance data-auto-refresh-sec={LIVE_REFRESH_MS / 1000}>
          <span>
            가용 <b>{keys.hasKeys ? fmtUsdt(account?.available ?? native?.available ?? null) : '—'}</b>
          </span>
          <span>
            미실현{' '}
            <b className={(account?.unrealizedPL ?? native?.unrealizedPL ?? 0) >= 0 ? 'up' : 'down'}>
              {keys.hasKeys ? fmtUsdt(account?.unrealizedPL ?? native?.unrealizedPL ?? null) : '—'}
            </b>
          </span>
          <em data-auto-refresh>
            <i className={`auto-live-dot ${liveRefresh && keys.hasKeys ? 'on' : ''}`} />
            {!keys.hasKeys ? '키를 연결하면 자동 갱신' : liveRefresh ? `실시간 · ${fmtSince(lastRefreshAt, Date.now())}` : '자동 갱신 대기'}
          </em>
        </div>

        <div className="auto-actions">
          <button
            type="button"
            className={`auto-switch ${config.enabled ? 'on' : ''} ${tradeMode.mode === 'live' ? 'live' : ''}`}
            onClick={() => void onToggle()}
            disabled={busy === 'test'}
            data-auto-toggle
          >
            {config.enabled ? '⏸ 자동매매 끄기' : `▶ ${modeLabel} 자동매매 켜기`}
          </button>
          <button
            type="button"
            className="auto-stop"
            onClick={() => {
              void api.stop('⏹ 긴급 전체 정지 — 새 진입을 멈췄습니다.');
              setToast('긴급 정지했습니다. 새 주문은 나가지 않습니다.');
            }}
            data-auto-stop
          >
            ⏹ 즉시 중지
          </button>
        </div>
        {error && (
          <div className="auto-error" data-auto-error>
            {error}
          </div>
        )}
        {daily.locked && (
          <div className="auto-reset-row" data-auto-reset-row>
            <p>오늘 손실 한도에 닿아 자동 진입이 멈췄습니다. 지금 잔고를 기준으로 다시 시작할 수 있습니다.</p>
            <button
              type="button"
              className="auto-reset"
              onClick={() => void onResetDaily()}
              disabled={busy === 'reset' || (api.supported && !keys.hasKeys)}
              data-auto-reset
            >
              {busy === 'reset' ? '초기화 중…' : '🔓 손실한도 초기화'}
            </button>
          </div>
        )}
        <div className="auto-hero-foot">
          <span>마지막 확인 {fmtClock(native?.lastTickAt ?? runtime.logs[0]?.at ?? 0)}</span>
          <span data-auto-seed>
            {seed > 0
              ? `감시 ${native?.armed ?? 0}건 · 계좌 기준 ${fmtUsdt(seed)}`
              : keys.hasKeys
                ? '계좌 잔고 확인 중 · 잠시만 기다려 주세요'
                : '실계좌 미연결 — 키를 연결하면 잔고 기준으로 계산'}
          </span>
        </div>
      </section>

      {api.bridgeMissing && (
        <div className="auto-note danger" data-auto-bridge-missing>
          <b>앱 업데이트가 필요합니다 (v1.5.0+)</b>
          <p>
            지금 설치된 COTA 앱에는 자동매매 네이티브 기능이 없습니다. 아래 버튼으로 v1.5.0 이상 APK를 설치하면
            키 연결과 24시간 감시가 동작합니다. (설치 후 기존 설정·기록은 그대로 유지됩니다)
          </p>
          <button type="button" className="auto-primary" onClick={() => void openExternalUrl(APK_DOWNLOAD_URL)}>
            ⬇︎ COTA v{APP_VERSION} APK 받기
          </button>
        </div>
      )}

      {!api.supported && (
        <div className="auto-note" data-auto-browser-note>
          <b>지금은 브라우저입니다 — 모의 시뮬레이션 모드</b>
          <p>
            실제 주문·24시간 감시는 COTA 안드로이드 앱(v1.5.0+)에서만 동작합니다. 브라우저에서는 같은
            안전장치 규칙으로 어떤 시그널이 통과/거부되는지 미리 확인할 수 있어요. API 키는 앱 기기
            안에만 저장되고, 웹뷰로 Secret이 내려오지 않습니다.
          </p>
        </div>
      )}

      {/* ---------- 1. API 키 ---------- */}
      <section className="auto-card" data-auto-keys>
        <header className="auto-card-head">
          <h3>① 비트겟 API 연결</h3>
          <span className={`auto-tag ${keys.hasKeys ? 'ok' : ''}`}>
            {keys.hasKeys ? `연결됨 · ${keys.demo ? '모의투자' : '실거래'}` : '미연결'}
          </span>
        </header>

        <div className="segmented auto-mode" role="group" aria-label="거래 모드">
          <button
            type="button"
            className={demoChoice ? 'on' : ''}
            onClick={() => {
              setDemoChoice(true);
              api.patchConfig({ mode: 'demo' });
            }}
            data-auto-mode="demo"
          >
            모의투자 (Demo)
          </button>
          <button
            type="button"
            className={!demoChoice ? 'on' : ''}
            onClick={() => {
              setDemoChoice(false);
              api.patchConfig({ mode: 'live' });
            }}
            data-auto-mode="live"
          >
            실거래
          </button>
        </div>

        {!demoChoice && (
          <label className="auto-warn-check">
            <input type="checkbox" checked={liveAck} onChange={(e) => setLiveAck(e.target.checked)} />
            <span>
              실거래 계좌로 주문이 나가는 것을 이해했습니다. 출금 권한은 끈 키만 사용합니다.
            </span>
          </label>
        )}

        {keys.hasKeys && tradeMode.mismatch && (
          <div className={`auto-note ${tradeMode.mode === 'live' ? 'danger' : ''}`} data-auto-mode-note>
            <b>{tradeMode.mode === 'live' ? '⚠️ 실거래 키로 연결되어 있습니다' : '모의투자 키로 연결되어 있습니다'}</b>
            <p>{tradeMode.note}</p>
          </div>
        )}

        {keys.hasKeys ? (
          <div className="auto-key-saved">
            <div className="auto-key-row">
              <span>API Key</span>
              <code>{keys.apiKeyMasked || '••••••••'}</code>
            </div>
            <div className="auto-key-row">
              <span>Passphrase</span>
              <code>{keys.passphraseSet ? '•••••••• 저장됨' : '—'}</code>
            </div>
            <div className="auto-key-row">
              <span>Secret</span>
              <code>기기 안에만 저장 · 화면에 표시하지 않음</code>
            </div>
            <div className="auto-key-actions">
              <button type="button" onClick={() => void api.testConnection()} disabled={busy === 'test'}>
                {busy === 'test' ? '확인 중…' : '연결 테스트'}
              </button>
              <button type="button" className="danger" onClick={() => void api.forgetKeys()} disabled={busy === 'clear'}>
                키 삭제
              </button>
            </div>
            {account && (
              <div className={`auto-account ${account.ok ? 'ok' : 'bad'}`} data-auto-account>
                {account.ok
                  ? `✓ ${account.demo ? '모의투자' : '실거래'} 연결 · USDT ${fmtUsdt(account.equity)} · 사용 가능 ${fmtUsdt(
                      account.available,
                    )} · 평가손익 ${fmtUsdt(account.unrealizedPL)} · ${accountKindLabel(account.accountMode)}`
                  : `✕ ${account.error ?? '키를 확인해 주세요.'}`}
              </div>
            )}
          </div>
        ) : (
          <div className="auto-key-form">
            <label className="auto-field">
              <span>API Key</span>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="예: bg_9f3k…"
                autoComplete="off"
                spellCheck={false}
                data-auto-input="key"
              />
            </label>
            <label className="auto-field">
              <span>Secret Key</span>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="32자리 Secret"
                autoComplete="off"
                data-auto-input="secret"
              />
            </label>
            <label className="auto-field">
              <span>Passphrase</span>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="API 발급 때 정한 문구"
                autoComplete="off"
                data-auto-input="passphrase"
              />
            </label>
            <button
              type="button"
              className="auto-primary"
              disabled={busy === 'save' || (!demoChoice && !liveAck)}
              onClick={async () => {
                const ok = await api.saveKeys({ apiKey, secret, passphrase, demo: demoChoice });
                if (ok) {
                  setApiKey('');
                  setSecret('');
                  setPassphrase('');
                }
              }}
              data-auto-save
            >
              {busy === 'save' ? '저장 중…' : demoChoice ? '저장하고 모의투자로 연결' : '저장하고 실거래로 연결'}
            </button>
          </div>
        )}

        <div className="auto-guide">
          <b>3줄 발급 가이드</b>
          <ol>
            <li>비트겟 앱 → 프로필 → API 관리 → 새 API 키 만들기</li>
            <li>
              권한은 <b>선물 거래(읽기/거래)</b>만, <b>출금 권한은 반드시 OFF</b>, IP는 가능하면 내 IP만
            </li>
            <li>발급 직후 뜨는 Secret(1회만 표시)과 Passphrase를 위에 붙여넣고 저장</li>
          </ol>
          <p className="auto-guide-warn">
            ⚠️ 출금 권한이 켜진 키는 절대 넣지 마세요. 키는 이 기기 저장소에만 남고 COTA 서버로는 전송되지
            않습니다.
          </p>
        </div>
      </section>

      {/* ---------- 2. 안전장치 ---------- */}
      <section className="auto-card" data-auto-guards>
        <header className="auto-card-head">
          <h3>② 리스크 · 안전장치</h3>
          <span
            className={`auto-tag ${guardDirty ? 'warn' : justSaved ? 'ok' : ''}`}
            data-auto-guard-state
            data-guard-dirty={guardDirty ? '1' : '0'}
          >
            {guardStateLabel}
          </span>
        </header>
        <p className="auto-guard-intro">
          값을 바꾸면 오른쪽 위에 <b>저장 안 됨</b>이 뜨고 저장 버튼이 켜집니다. <b>저장</b>을 눌러야 상단 지표와
          24시간 감시에 반영됩니다. 여기 적은 숫자가 그대로 자동매매 기준입니다.
          {guardDirty && (
            <em data-auto-dirty-fields>바뀐 항목: {changedGuards.map((f) => GUARD_FIELD_LABEL[f]).join(' · ')}</em>
          )}
        </p>
        <div className="auto-risk-block">
          <NumField
            label="1회 리스크"
            value={draft.riskPct}
            suffix="%"
            onChange={(v) => setDraft((prev) => ({ ...prev, riskPct: v }))}
            hint={
              seed > 0
                ? `0.5~50% 직접 입력 · 계좌 ${fmtUsd(seed)}의 ${draft.riskPct}% = ${fmtUsd(
                    (seed * draft.riskPct) / 100,
                  )}`
                : '0.5~50% 직접 입력 · 계좌를 연결하면 금액으로 표시됩니다'
            }
          />
          <div className="risk-presets" role="group" aria-label="1회 리스크 빠른 선택">
            {RISK_PRESET_CHOICES.map((v) => (
              <button
                key={v}
                type="button"
                className={`risk-chip ${Math.abs(draft.riskPct - v) < 1e-9 ? 'on' : ''} ${v >= RISK_HIGH_WARN ? 'high' : ''}`}
                onClick={() => setDraft((prev) => ({ ...prev, riskPct: v }))}
                data-risk-preset={v}
              >
                {v}%
              </button>
            ))}
          </div>
          {draft.riskPct >= RISK_HIGH_WARN && (
            <div className="risk-high-warn" data-risk-warning>
              ⚠️ 고위험 설정: 연속 손실 시 계좌 잔고 감소가 커집니다
            </div>
          )}
        </div>
        <div className="auto-num-grid">
          <NumField
            label="최대 동시 포지션"
            value={draft.maxPositions}
            suffix="개"
            onChange={(v) => setDraft((prev) => ({ ...prev, maxPositions: v }))}
            hint={`${LIMITS.maxPositions[0]}~${LIMITS.maxPositions[1]}개 · 기본 ${DEFAULTS.maxPositions}개`}
          />
          <div className="auto-daily-limit">
            <NumField
              label="1일 손실 한도"
              value={draft.dailyLossPct}
              suffix="%"
              onChange={(v) => setDraft((prev) => ({ ...prev, dailyLossPct: v }))}
              hint={draft.dailyLossPct === 0 ? '한도 끄기 — 스스로 멈추지 않습니다' : '닿으면 당일 자동 진입 중지 · 0 = 끄기'}
            />
            <div className="risk-presets compact" role="group" aria-label="1일 손실 한도 빠른 선택">
              {[3, 4.5, 7, 10, 15, 100].map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`risk-chip ${Math.abs(draft.dailyLossPct - v) < 1e-9 ? 'on' : ''}`}
                  onClick={() => setDraft((prev) => ({ ...prev, dailyLossPct: v }))}
                  data-daily-preset={v}
                >
                  {v}%
                </button>
              ))}
              <button
                type="button"
                className={`risk-chip off ${draft.dailyLossPct === 0 ? 'on' : ''}`}
                onClick={() => setDraft((prev) => ({ ...prev, dailyLossPct: 0 }))}
                data-daily-preset="off"
              >
                끄기
              </button>
            </div>
            <button
              type="button"
              className="auto-mini auto-reset-mini"
              onClick={() => void onResetDaily()}
              disabled={busy === 'reset' || (api.supported && !keys.hasKeys)}
              title="지금 잔고를 오늘의 기준선으로 다시 잡습니다"
              data-auto-reset-guard
            >
              {busy === 'reset' ? '초기화 중…' : '↺ 손실한도 초기화'}
            </button>
          </div>
          <div className="auto-lev-cap">
            <NumField
              label="레버리지 상한"
              value={draft.maxLeverage}
              suffix={draft.maxLeverage > 0 ? 'x' : undefined}
              onChange={(v) => setDraft((prev) => ({ ...prev, maxLeverage: v }))}
              hint={
                draft.maxLeverage > 0
                  ? '시그널 추천 배율도 이 값을 넘지 않음'
                  : '상한 없음 · 유동 — 청산 안전마진·거래소 최대 배율까지만'
              }
            />
            <div className="risk-presets compact" role="group" aria-label="레버리지 상한 빠른 선택">
              {LEVERAGE_CAP_CHOICES.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={`risk-chip ${draft.maxLeverage === v ? 'on' : ''} ${v === 0 ? 'off' : ''}`}
                  onClick={() => setDraft((prev) => ({ ...prev, maxLeverage: v }))}
                  data-lev-cap={v}
                >
                  {v === 0 ? '유동' : `${v}x`}
                </button>
              ))}
            </div>
            <em className="num-hint" data-lev-cap-label>
              현재 {leverageCapLabel(draft.maxLeverage)} · 유동이면 잔고·손절 폭·거래소 최대 배율로만 계산합니다
            </em>
          </div>
          <NumField
            label="최소 승률"
            value={draft.minWinRate}
            suffix="%"
            onChange={(v) => setDraft((prev) => ({ ...prev, minWinRate: v }))}
            hint="시그널 전략 승률 기준 · 전수 기대값 0.2R 이상(플러스) 기법은 통과"
          />
          <NumField
            label="최소 손익비"
            value={draft.minRR}
            suffix="R"
            onChange={(v) => setDraft((prev) => ({ ...prev, minRR: v }))}
            hint="이보다 낮은 셋업은 건너뜀"
          />
          <NumField
            label="감시 주기"
            value={draft.intervalSec}
            suffix="초"
            onChange={(v) => setDraft((prev) => ({ ...prev, intervalSec: v }))}
            hint="화면이 꺼져 있어도 이 주기로 확인"
          />
          <NumField
            label="시그널 유효시간"
            value={draft.entryTtlMin}
            suffix="분"
            onChange={(v) => setDraft((prev) => ({ ...prev, entryTtlMin: v }))}
            hint="지나면 진입 대기를 취소"
          />
        </div>

        <div className="auto-options">
          <div className="auto-option">
            <span>허용 종목</span>
            <div className="segmented slim">
              <button
                type="button"
                className={draft.symbols === 'crypto' ? 'on' : ''}
                onClick={() => setDraft((prev) => ({ ...prev, symbols: 'crypto' }))}
                data-auto-symbols="crypto"
              >
                전체 코인
              </button>
              <button
                type="button"
                className={draft.symbols === 'majors' ? 'on' : ''}
                onClick={() => setDraft((prev) => ({ ...prev, symbols: 'majors' }))}
                data-auto-symbols="majors"
              >
                메이저 4종
              </button>
              <button
                type="button"
                className={draft.symbols === 'all' ? 'on' : ''}
                onClick={() => setDraft((prev) => ({ ...prev, symbols: 'all' }))}
                data-auto-symbols="all"
              >
                주식선물 포함
              </button>
            </div>
            <em>{SYMBOL_SCOPE_HINT[draft.symbols] ?? SYMBOL_SCOPE_HINT.crypto}</em>
          </div>
          <div className="auto-option">
            <span>조기 손절 보호</span>
            <div className="segmented slim">
              <button
                type="button"
                className={draft.earlyStop ? 'on' : ''}
                onClick={() => setDraft((prev) => ({ ...prev, earlyStop: true }))}
                data-auto-earlystop="on"
              >
                켜기
              </button>
              <button
                type="button"
                className={!draft.earlyStop ? 'on' : ''}
                onClick={() => setDraft((prev) => ({ ...prev, earlyStop: false }))}
                data-auto-earlystop="off"
              >
                끄기
              </button>
            </div>
            <em>
              {draft.earlyStop
                ? 'SL 전 반대 시그널·추세 붕괴가 확인되면 선제 청산 · 진입 2분은 보호'
                : '손절가는 거래소에 맡기고 SL에서만 청산합니다'}
            </em>
          </div>
          <div className="auto-option">
            <span>50% 반익절</span>
            <div className="segmented slim">
              <button
                type="button"
                className={draft.partialTp ? 'on' : ''}
                onClick={() => setDraft((prev) => ({ ...prev, partialTp: true }))}
                data-auto-partialtp="on"
              >
                켜기
              </button>
              <button
                type="button"
                className={!draft.partialTp ? 'on' : ''}
                onClick={() => setDraft((prev) => ({ ...prev, partialTp: false }))}
                data-auto-partialtp="off"
              >
                끄기
              </button>
            </div>
            <em>
              {draft.partialTp
                ? '목표가 50% 또는 +1.0R 도달 시 보유의 50%를 시장가 분할 익절 · 남은 절반은 본절 보호 강화'
                : '분할 익절 없이 목표가까지 전량을 들고 갑니다'}
            </em>
          </div>
          <div className="auto-option">
            <span>새 시그널 자동 진입</span>
            <div className="segmented slim">
              <button
                type="button"
                className={draft.autoEntry ? 'on' : ''}
                onClick={() => setDraft((prev) => ({ ...prev, autoEntry: true }))}
              >
                자동
              </button>
              <button
                type="button"
                className={!draft.autoEntry ? 'on' : ''}
                onClick={() => setDraft((prev) => ({ ...prev, autoEntry: false }))}
              >
                원클릭만
              </button>
            </div>
            <em>{draft.autoEntry ? '규칙을 통과한 새 시그널을 자동 주문' : '카드의 ⚡ 버튼을 눌렀을 때만 주문'}</em>
          </div>
        </div>

        {/* 저장 — 이 카드의 변경은 여기서 확정한다 */}
        <div className={`auto-guard-save ${guardDirty ? 'dirty' : ''}`}>
          <div className="auto-guard-save-info">
            <b>
              {guardDirty
                ? `저장 안 됨 · ${changedGuards.length}개 항목`
                : justSaved
                  ? '✓ 저장됨 — 상단 지표·감시에 반영했습니다'
                  : '저장된 값 그대로입니다'}
            </b>
            <span>
              {guardDirty
                ? '저장을 눌러야 자동매매가 새 값으로 돌아갑니다.'
                : '이 값이 자동매매의 최종 기준입니다 — 다른 화면이 덮어쓰지 않습니다.'}
            </span>
          </div>
          <button
            type="button"
            className={`save-btn ${guardDirty ? 'dirty' : ''} ${justSaved ? 'saved' : ''}`}
            data-auto-config-save
            data-save-state={guardDirty ? 'dirty' : justSaved ? 'saved' : 'clean'}
            disabled={!guardDirty}
            onClick={onSaveGuards}
          >
            {justSaved ? '✓ 저장됨' : '저장'}
          </button>
        </div>
      </section>

      {/* ---------- 3. 포지션 ---------- */}
      <section className="auto-card" data-auto-positions>
        <header className="auto-card-head">
          <h3>③ 지금 포지션</h3>
          <button type="button" className="auto-mini" onClick={() => void api.refreshPositions()} disabled={!keys.hasKeys}>
            새로고침
          </button>
        </header>
        {!keys.hasKeys ? (
          <div className="auto-empty">API 키를 연결하면 실시간 포지션·평가손익이 여기에 표시됩니다.</div>
        ) : positions.length === 0 ? (
          <div className="auto-empty">보유 중인 USDT-M 포지션이 없습니다.</div>
        ) : (
          <div className="auto-pos-list">
            {positions.map((p) => (
              <div className="auto-pos" key={`${p.symbol}-${p.holdSide}`}>
                <div className="auto-pos-sym">
                  <b>{p.symbol.replace('USDT', '')}</b>
                  <span className={p.holdSide === 'long' ? 'long' : 'short'}>{p.holdSide === 'long' ? '롱' : '숏'}</span>
                  <i>{p.leverage}x</i>
                </div>
                <div className="auto-pos-num">
                  <span>
                    {formatQty(p.total)} @ {p.openPriceAvg}
                  </span>
                  <b className={p.unrealizedPL >= 0 ? 'up' : 'down'}>{fmtUsdt(p.unrealizedPL)}</b>
                </div>
                <div className="auto-pos-sub">
                  <span>청산 {p.liquidationPrice || '—'}</span>
                  <span>
                    TP {p.presetStopSurplusPrice || '—'} / SL {p.presetStopLossPrice || '—'}
                  </span>
                  {(() => {
                    const pt = partialTpState(p, {
                      enabled: config.partialTp,
                      done: partialDone.has(`${p.symbol}|${p.holdSide}`),
                    });
                    return (
                      <span
                        className={`auto-pos-partial ${pt.done ? 'done' : pt.reached ? 'ready' : ''}`}
                        data-pos-partial={p.symbol}
                      >
                        💰 {pt.label}
                      </span>
                    );
                  })()}
                </div>
                <div className="auto-pos-actions">
                  <button
                    type="button"
                    className="auto-mini danger"
                    data-auto-close={p.symbol}
                    disabled={busy === `close:${p.symbol}` || !api.supported}
                    onClick={() => {
                      const label = `${p.symbol.replace('USDT', '')} ${p.holdSide === 'long' ? '롱' : '숏'} ${formatQty(
                        p.total,
                      )}을 시장가로 청산합니다. 계속할까요?`;
                      if (!window.confirm(label)) return;
                      void api.closePosition(p).then((res) => {
                        notify(res.ok ? '청산 주문을 넣었습니다.' : res.message);
                      });
                    }}
                  >
                    {busy === `close:${p.symbol}` ? '청산 중…' : '시장가 청산'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- 4. 로그 ---------- */}
      <section className="auto-card" data-auto-logs>
        <header className="auto-card-head">
          <h3>④ 체결 · 거부 · 차단 로그</h3>
          <div className="auto-log-actions">
            {!api.supported && (
              <button type="button" className="auto-mini" onClick={() => api.simulate()} data-auto-simulate>
                ▶ 시뮬레이션 실행
              </button>
            )}
            <span className="auto-tag" data-auto-fillcount>
              오늘 체결 {fillsToday}건 · 감시 {native?.armed ?? 0}건
            </span>
          </div>
        </header>
        {runtime.logs.length === 0 ? (
          <div className="auto-empty">
            아직 기록이 없습니다. {api.supported ? '자동매매를 켜면 감시·체결·거부가 이곳에 쌓입니다.' : '시뮬레이션을 실행해 보세요.'}
          </div>
        ) : (
          <ul className="auto-log-list">
            {runtime.logs.slice(0, 14).map((l, i) => (
              <li key={`${l.at}-${i}`} className={`auto-log ${l.level}`}>
                <span className="auto-log-time">{fmtClock(l.at)}</span>
                <span className="auto-log-level">{LEVEL_LABEL[l.level] ?? l.level}</span>
                <span className="auto-log-text">{l.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="feed-note">
        자동매매는 주문에 손절가(TP/SL)를 함께 걸고, 목표가 50%·+1.0R 도달 시 50%를 먼저 익절한 뒤 남은 절반을
        본절 근처에서 지킵니다. 1일 손실 한도·중복 진입·동시 포지션도 스스로 막습니다.
        그래도 급격한 변동에서는 손실이 계획보다 커질 수 있고, 최종 책임은 본인에게 있습니다. 투자 권유가
        아닙니다. {openSignals.length > 0 && `지금 자동 진입 후보 ${openSignals.length}건.`}
      </div>
    </div>
  );
}
