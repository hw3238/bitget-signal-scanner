import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../lib/storage';
import { BENCH_GATE, MIN_RR, MIN_TRADES, MIN_WINRATE } from '../engine/backtest';
import { STOP_WIDTH } from '../engine/risk';
import type { ScanState } from '../hooks/useScanner';
import type { AutoTradeApi } from '../hooks/useAutoTrade';
import { BENCH_INFO, STRATEGIES, type Signal } from '../engine/types';
import {
  NOTIFY_TARGETS,
  notificationPermission,
  ntfyEndpoint,
  requestNotificationPermission,
  type NotifyPermission,
} from '../lib/notify';
import { isNativeApp, nativeAppInfo, openExternalUrl } from '../lib/native';
import { useApkUpdate } from '../lib/useApkUpdate';
import { STYLE_META, type Profile, type TradeStyle } from '../lib/profile';
import { isDirty, stylePresetSummary } from '../lib/settingsSync';
import { ACCOUNT_UNLINKED_HINT, fmtUsdtBalance, type AccountBase } from '../lib/account';
import {
  RISK_PRESETS,
  clampRiskInput,
  defaultRiskPct,
  isHighRisk,
  resolveRiskPct,
} from '../lib/orderCockpit';
import {
  APP_VERSION,
  APK_DOWNLOAD_URL,
  checkForUpdate,
  compareVersions,
  hardReload,
  PAGES_URL,
  RELEASES_PAGE,
  type UpdateCheckResult,
} from '../lib/update';

/**
 * 저장 전 초안 — 항목을 눌러도 바로 저장하지 않고, `저장` 버튼으로 확정한다(v1.5.6).
 *  · 다른 화면(계좌·자동매매)에서 저장값이 바뀌면 초안도 따라간다(편집 중인 초안은 보존).
 *  · 저장값이 그대로면 사용자가 누르기 전까지 아무것도 바뀌지 않는다.
 */
function useDraft<T>(saved: T) {
  const [draft, setDraft] = useState<T>(saved);
  const savedRef = useRef(saved);
  const prevDirtyRef = useRef(false);
  useEffect(() => {
    if (!Object.is(savedRef.current, saved)) {
      savedRef.current = saved;
      // 저장값이 바뀜 — 이전 화면에서 초안이 깨끗했다면 새 저장값을 따른다.
      // (사용자가 편집 중인 초안이 있으면 그대로 둔다. 스타일 저장 → 리스크 프리셋 동기화도 이 경로)
      if (!prevDirtyRef.current) setDraft(saved);
    }
    prevDirtyRef.current = isDirty(saved, draft);
  });
  return [draft, setDraft] as const;
}

/** 항목별 저장 버튼 — 변경이 있을 때만 눌리고, 저장하면 `✓ 저장됨` 으로 바뀐다. */
function SaveButton({
  name,
  dirty,
  onSave,
}: {
  /** 테스트·자동화용 식별자 (`data-save`) */
  name: string;
  dirty: boolean;
  onSave: () => void;
}) {
  const [savedAt, setSavedAt] = useState(0);
  useEffect(() => {
    if (!savedAt) return;
    const id = window.setTimeout(() => setSavedAt(0), 2400);
    return () => window.clearTimeout(id);
  }, [savedAt]);
  const saved = savedAt > 0 && !dirty;
  return (
    <div className="setting-save">
      {dirty && !saved && <span className="save-dirty">저장 안 됨</span>}
      <button
        type="button"
        className={`save-btn ${dirty ? 'dirty' : ''} ${saved ? 'saved' : ''}`}
        data-save={name}
        data-save-state={saved ? 'saved' : dirty ? 'dirty' : 'clean'}
        disabled={!dirty}
        onClick={() => {
          onSave();
          setSavedAt(Date.now());
        }}
      >
        {saved ? '✓ 저장됨' : '저장'}
      </button>
    </div>
  );
}

interface Props {
  settings: Settings;
  state: ScanState;
  onChange: (patch: Partial<Settings>) => void;
  onClearHistory: () => void;
  onClearSwapLog: () => void;
  historyCount: number;
  swapCount: number;
  /** 첫 실행 온보딩에서 저장한 매매 성향 */
  profile: Profile | null;
  /** 연결된 비트겟 계좌의 실시간 잔고 — 모든 계산의 기준(v1.5.5) */
  account: AccountBase;
  /** 온보딩 모달 다시 열기 */
  onEditProfile: () => void;
  /** 자동매매 계좌 연결 화면 열기 */
  onConnectAccount: () => void;
  /** 설정 화면의 알림 테스트 버튼 */
  onTestNotification: (signal?: Signal | null) => Promise<{
    permission: NotifyPermission;
    shown: boolean;
    ntfy: boolean;
  }>;
  /** 🤖 자동매매 설정 — 리스크 저장이 즉시 반영됐는지 화면에 같이 보여준다(v1.5.6) */
  autoTrade: AutoTradeApi;
  /** 1회 리스크 저장 → 설정 + 자동매매 리스크 동기화 */
  onSaveRisk: (riskPct: number | null) => void;
  /** 매매 스타일 저장 → 자동매매 프리셋 적용 */
  onSaveStyle: (style: TradeStyle) => void;
}

export function SettingsTab({
  settings,
  state,
  onChange,
  onClearHistory,
  onClearSwapLog,
  historyCount,
  swapCount,
  profile,
  account,
  onEditProfile,
  onConnectAccount,
  onTestNotification,
  autoTrade,
  onSaveRisk,
  onSaveStyle,
}: Props) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [apkVersion, setApkVersion] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotifyPermission | null>(null);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState('');
  /** 리스크 '직접 입력' 모드 — 프리셋 값에서도 숫자 입력을 열어 준다. */
  const [riskCustom, setRiskCustom] = useState(false);
  const native = isNativeApp();
  const apkUpdate = useApkUpdate();

  /* ---------------- 항목별 초안(draft) — 저장 버튼으로만 확정 ---------------- */
  const [leverageModeDraft, setLeverageModeDraft] = useDraft(settings.leverageMode);
  const [riskDraft, setRiskDraft] = useDraft<number | null>(settings.riskPct);
  const [styleDraft, setStyleDraft] = useDraft<TradeStyle>(profile?.style ?? 'conservative');
  const [notifyDraft, setNotifyDraft] = useDraft(settings.notifyEnabled);
  const [targetDraft, setTargetDraft] = useDraft(settings.notifyTarget);
  const [ntfyDraft, setNtfyDraft] = useDraft(settings.notifyNtfy);
  const [leverageDraft, setLeverageDraft] = useDraft(settings.leverage);
  const [minRRDraft, setMinRRDraft] = useDraft(settings.minRR);
  const [refreshDraft, setRefreshDraft] = useDraft(settings.refreshSec);
  const [soundDraft, setSoundDraft] = useDraft(settings.sound);

  useEffect(() => {
    void notificationPermission().then(setPermission);
  }, []);

  const grantPermission = async () => {
    const next = await requestNotificationPermission();
    setPermission(next);
    return next;
  };

  const saveNotifyEnabled = () => {
    onChange({ notifyEnabled: notifyDraft });
    if (notifyDraft) void grantPermission();
  };

  const runNotifyTest = async () => {
    setTesting(true);
    setTestNote('');
    try {
      const sample =
        state.signals.find((s) => s.symbol === 'BTCUSDT' && s.state === 'open') ??
        state.signals.find((s) => s.state === 'open') ??
        null;
      const res = await onTestNotification(sample);
      setPermission(res.permission);
      const ntfyOn = settings.notifyNtfy.trim() !== '';
      setTestNote(
        res.shown
          ? ntfyOn
            ? res.ntfy
              ? '안드로이드 상단 알림 + ntfy 푸시를 함께 보냈습니다.'
              : '안드로이드 알림은 보냈습니다. ntfy 전송은 실패했습니다(토픽·연결 확인).'
            : '테스트 알림을 보냈습니다. 폰 상단(알림바)을 확인하세요.'
          : res.ntfy
            ? 'ntfy로는 보냈지만 폰 알림은 실패했습니다. 알림 권한을 확인하세요.'
            : res.permission === 'unsupported'
              ? '이 환경에서는 알림을 지원하지 않습니다.'
              : '알림을 보낼 수 없습니다. 알림 권한을 허용해 주세요.',
      );
    } finally {
      setTesting(false);
    }
  };

  const runCheck = async (auto = false) => {
    if (!auto) setChecking(true);
    const next = await checkForUpdate();
    setResult(next);
    if (!auto) setChecking(false);
  };

  useEffect(() => {
    void runCheck(true);
    if (native) {
      void nativeAppInfo().then((info) => setApkVersion(info?.versionName ?? null));
    }
  }, [native]);

  const openDownload = () => {
    void openExternalUrl(result?.apkUrl || result?.htmlUrl || RELEASES_PAGE);
  };

  // 앱 안에서 바로 업데이트 — 다운로드 진행률 → 설치 화면
  const startUpdate = () => {
    if (!native) {
      openDownload();
      return;
    }
    void apkUpdate.start(result?.apkUrl || APK_DOWNLOAD_URL);
  };

  const apk = apkUpdate.state;

  const style = profile ? STYLE_META[profile.style] : null;
  const activeStyle = profile?.style ?? 'conservative';
  const riskSelectValue =
    riskDraft == null
      ? 'auto'
      : riskCustom || !(RISK_PRESETS as readonly number[]).includes(riskDraft)
        ? 'custom'
        : String(riskDraft);
  const showRiskInput =
    riskDraft != null && (riskCustom || !(RISK_PRESETS as readonly number[]).includes(riskDraft));
  /** 지금 저장할 리스크(성향 추천 포함) — 자동매매와 비교해 안내한다 */
  const draftRiskValue = resolveRiskPct(activeStyle, riskDraft);
  const autoRisk = autoTrade.config.riskPct;
  const styleChanged = styleDraft !== activeStyle;

  return (
    <div className="tab settings-tab">
      <section className="panel profile-card" id="settings-profile">
        <header className="panel-head">
          <h3>💼 내 매매 기준</h3>
          <span className="panel-note">실계좌 잔고 · COTA 추천</span>
        </header>
        <div className="profile-grid">
          <div className="profile-cell" data-settings-balance>
            <span>계좌 잔고</span>
            <b>{account.connected ? fmtUsdtBalance(account.equity) : account.pending ? '불러오는 중' : '실계좌 미연결'}</b>
            <i>
              {account.connected
                ? `가용 ${fmtUsdtBalance(account.available)} · USDT`
                : account.pending
                  ? '잠시만 기다려 주세요'
                  : 'USDT'}
            </i>
          </div>
          <div className="profile-cell">
            <span>매매 성향</span>
            <b>
              {style?.emoji} {style?.label ?? '미설정'}
            </b>
            <i>{style?.range}</i>
          </div>
        </div>
        {!account.connected && (
          <div className="account-link-note" data-settings-connect>
            <div>
              <b>{account.pending ? '계좌 잔고를 불러오는 중입니다' : '아직 실계좌가 연결되지 않았습니다'}</b>
              <p>{ACCOUNT_UNLINKED_HINT}</p>
            </div>
            <button className="ghost-btn" onClick={onConnectAccount}>
              자동매매 연결
            </button>
          </div>
        )}
        <div className="setting-row">
          <div>
            <div className="setting-name">레버리지 모드</div>
            <div className="setting-desc">
              시그널마다 손절 폭·승률·손익비로 계산한 COTA 추천 배율을 쓰거나, 직접 고정할 수 있습니다.
            </div>
          </div>
          <div className="setting-actions">
            <div className="segmented">
              <button
                className={leverageModeDraft === 'auto' ? 'on' : ''}
                onClick={() => setLeverageModeDraft('auto')}
              >
                COTA 추천
              </button>
              <button
                className={leverageModeDraft === 'manual' ? 'on' : ''}
                onClick={() => setLeverageModeDraft('manual')}
              >
                직접 고정
              </button>
            </div>
            <SaveButton
              name="leverage-mode"
              dirty={isDirty(settings.leverageMode, leverageModeDraft)}
              onSave={() => onChange({ leverageMode: leverageModeDraft })}
            />
          </div>
        </div>
        <div className="setting-row risk-setting">
          <div>
            <div className="setting-name">실전 주문 리스크</div>
            <div className="setting-desc">
              카드의 주문 수량은 손절가에 닿았을 때 <b>계좌 잔고</b>의 이 비율만큼만 잃도록 자동 계산됩니다.
              0.5~50%까지 직접 입력할 수 있습니다.
              {profile ? ` 지금 설정은 잔고의 ${defaultRiskPct(profile.style)}% 기준입니다.` : ''}
            </div>
            {draftRiskValue !== autoRisk && (
              <div className="risk-sync-hint" data-risk-sync-hint>
                자동매매는 지금 {autoRisk}% — 저장하면 함께 {draftRiskValue}%로 바뀝니다.
              </div>
            )}
          </div>
          <div className="setting-actions">
            <div className="risk-control">
              <label className="select-pill risk-pill">
                <span>리스크</span>
                <select
                  value={riskSelectValue}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'auto') {
                      setRiskCustom(false);
                      setRiskDraft(null);
                    } else if (v === 'custom') {
                      setRiskCustom(true);
                      if (riskDraft == null) setRiskDraft(clampRiskInput(2.5));
                    } else {
                      setRiskCustom(false);
                      setRiskDraft(Number(v));
                    }
                  }}
                  aria-label="1회 허용 손실률"
                  data-risk-select
                >
                  <option value="auto">
                    성향 추천 ({profile ? defaultRiskPct(profile.style) : 1.5}%)
                  </option>
                  {RISK_PRESETS.map((v) => (
                    <option key={v} value={v}>
                      잔고의 {v}%
                    </option>
                  ))}
                  <option value="custom">직접 입력</option>
                </select>
              </label>
              {showRiskInput && (
                <label className="risk-custom">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0.5}
                    max={50}
                    step={0.1}
                    value={riskDraft ?? ''}
                    onChange={(e) => setRiskDraft(clampRiskInput(Number(e.target.value)))}
                    aria-label="1회 허용 손실률 직접 입력"
                    data-risk-input
                  />
                  <i>%</i>
                </label>
              )}
            </div>
            <SaveButton
              name="risk"
              dirty={isDirty(settings.riskPct, riskDraft)}
              onSave={() => onSaveRisk(riskDraft)}
            />
          </div>
        </div>
        {isHighRisk(draftRiskValue) && (
          <div className="risk-high-warn" data-risk-warning>
            ⚠️ 고위험 설정: 연속 손실 시 계좌 잔고 감소가 커집니다
          </div>
        )}
        <div className="setting-row">
          <div>
            <div className="setting-name">매매 스타일</div>
            <div className="setting-desc">
              고른 스타일을 저장하면 자동매매의 리스크·레버리지 상한·최대 포지션·진입 기준·50% 반익절이
              그 프리셋으로 <b>즉시</b> 바뀝니다. 켜짐·모의/실거래·감시 주기·허용 종목은 그대로 유지됩니다.
              {styleChanged
                ? ` 저장하면 ${STYLE_META[styleDraft].label}로 바뀝니다.`
                : ` 지금은 ${STYLE_META[activeStyle].label}입니다.`}
            </div>
            <div className="style-preset-note" data-style-preset-note>
              {STYLE_META[styleDraft].emoji} {stylePresetSummary(styleDraft)}
            </div>
          </div>
          <div className="setting-actions">
            <div className="segmented style-pick">
              {(['conservative', 'aggressive'] as TradeStyle[]).map((s) => (
                <button
                  key={s}
                  data-style-pick={s}
                  className={styleDraft === s ? 'on' : ''}
                  onClick={() => setStyleDraft(s)}
                >
                  {STYLE_META[s].emoji} {STYLE_META[s].label.replace(' 매매', '')}
                </button>
              ))}
            </div>
            <SaveButton
              name="style"
              dirty={isDirty(activeStyle, styleDraft)}
              onSave={() => onSaveStyle(styleDraft)}
            />
          </div>
        </div>
        <div className="setting-row compact">
          <div>
            <div className="setting-name">매매 성향 다시 설정</div>
            <div className="setting-desc">
              온보딩 화면에서 보수적/공격적을 다시 고를 수 있습니다. 위의 매매 스타일 저장과 같은 프리셋이
              자동매매에 적용됩니다(공격적은 레버리지 상한을 두지 않습니다).
            </div>
          </div>
          <button className="ghost-btn" onClick={onEditProfile}>
            다시 설정
          </button>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>앱 · 업데이트</h3>
          <span className="panel-note">{native ? '안드로이드 앱' : '웹 버전'}</span>
        </header>

        {result?.updateAvailable && (
          <div className="update-banner">
            <div className="update-banner-text">
              <b>새 버전 v{result.latest} 배포됨</b>
              <span>
                {native
                  ? '앱을 나가지 않고 바로 내려받아 설치할 수 있습니다.'
                  : 'APK를 내려받아 설치하면 최신 기능이 적용됩니다.'}
              </span>
            </div>
            <button className="update-banner-btn" onClick={startUpdate} disabled={apk.phase === 'downloading'}>
              {apk.phase === 'downloading' ? `${apk.pct}%` : native ? `바로 업데이트 (v${result.latest})` : '업데이트'}
            </button>
          </div>
        )}

        {apk.phase !== 'idle' && (
          <div className={`apk-update ${apk.phase}`}>
            <div className="apk-update-row">
              <b>
                {apk.phase === 'downloading'
                  ? `APK 내려받는 중 ${apk.pct}%`
                  : apk.phase === 'installed'
                    ? '설치 화면을 열었습니다'
                    : apk.phase === 'permission'
                      ? '앱 설치 허용이 필요합니다'
                      : '업데이트 실패'}
              </b>
              {apk.phase === 'downloading' && <span className="apk-pct">{apk.pct}%</span>}
            </div>
            {apk.phase === 'downloading' && (
              <div className="apk-progress">
                <div className="apk-progress-fill" style={{ width: `${apk.pct}%` }} />
              </div>
            )}
            <div className="apk-note">{apk.note}</div>
            <div className="apk-actions">
              {(apk.phase === 'permission' || apk.phase === 'error') && (
                <button className="ghost-btn small" onClick={startUpdate}>
                  다시 시도
                </button>
              )}
              <button className="ghost-btn small" onClick={apkUpdate.reset}>
                닫기
              </button>
            </div>
          </div>
        )}

        <div className="setting-row compact">
          <div>
            <div className="setting-name">현재 버전</div>
            <div className="setting-desc">
              COTA · 앱 v{APP_VERSION}
              {apkVersion ? ` · 설치된 APK v${apkVersion}` : ''}
            </div>
          </div>
          <button className="ghost-btn" onClick={() => void runCheck(false)} disabled={checking}>
            {checking ? '확인 중…' : '🔄 업데이트 확인'}
          </button>
        </div>

        <div className="setting-row compact">
          <div>
            <div className="setting-name">웹/로직 최신화</div>
            <div className="setting-desc">실행할 때마다 GitHub Pages 최신 배포본을 불러옵니다. 강제로 새로 받을 때 사용하세요.</div>
          </div>
          <button className="ghost-btn" onClick={() => void hardReload()}>
            웹 화면 즉시 새로고침
          </button>
        </div>

        <div className={`update-status ${result?.updateAvailable ? 'on' : ''}`}>
          {result ? result.message : '최신 릴리즈를 확인하는 중…'}
          {result?.updateAvailable && (
            <button className="ghost-btn small" onClick={openDownload}>
              ⬇︎ APK 다운로드
            </button>
          )}
        </div>

        <ul className="api-list">
          <li>
            <span>최신 배포본</span>
            <code>{PAGES_URL}</code>
          </li>
          <li>
            <span>릴리즈(APK)</span>
            <code>{RELEASES_PAGE}</code>
          </li>
        </ul>
      </section>

      <section className="panel" id="settings-notify">
        <header className="panel-head">
          <h3>🔔 핸드폰 알림</h3>
          <span className="panel-note">
            {permission === 'granted'
              ? native
                ? '알림 허용됨'
                : '브라우저 알림 허용'
              : permission === 'unsupported'
                ? '지원 안 됨'
                : '권한 필요'}
          </span>
        </header>
        <p className="setting-desc block">
          {native
            ? '새 시그널이 감지되면 안드로이드 상단 알림바에 소리·진동과 함께 표시됩니다. 알림을 누르면 앱이 열립니다.'
            : '앱(APK)에서 설치하면 안드로이드 상단 알림바로 옵니다. 웹에서는 브라우저 알림으로 표시됩니다.'}
        </p>
        {native && apkVersion && compareVersions(APP_VERSION, apkVersion) > 0 && (
          <div className="update-banner">
            <div className="update-banner-text">
              <b>핸드폰 알림은 APK v{APP_VERSION}부터</b>
              <span>설치된 앱 v{apkVersion} — 새 APK를 설치하면 알림이 동작합니다.</span>
            </div>
            <button className="update-banner-btn" onClick={() => void openExternalUrl(APK_DOWNLOAD_URL)}>
              APK 받기
            </button>
          </div>
        )}
        <div className="setting-row">
          <div>
            <div className="setting-name">시그널 알림</div>
            <div className="setting-desc">
              감지된 새 시그널을 폰으로 알려줍니다. 끄면 알림이 오지 않습니다(기본 켜짐).
            </div>
          </div>
          <div className="setting-actions">
            <button
              className={`switch ${notifyDraft ? 'on' : ''}`}
              onClick={() => setNotifyDraft(!notifyDraft)}
              aria-label="시그널 알림 켜기/끄기"
              aria-pressed={notifyDraft}
            >
              <span />
            </button>
            <SaveButton
              name="notify-enabled"
              dirty={isDirty(settings.notifyEnabled, notifyDraft)}
              onSave={saveNotifyEnabled}
            />
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-name">알림 대상</div>
            <div className="setting-desc">
              {NOTIFY_TARGETS.find((t) => t.key === targetDraft)?.desc ?? ''}
            </div>
          </div>
          <div className="setting-actions">
            <div className="segmented notify-target">
              {NOTIFY_TARGETS.map((t) => (
                <button
                  key={t.key}
                  className={targetDraft === t.key ? 'on' : ''}
                  onClick={() => setTargetDraft(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <SaveButton
              name="notify-target"
              dirty={isDirty(settings.notifyTarget, targetDraft)}
              onSave={() => onChange({ notifyTarget: targetDraft })}
            />
          </div>
        </div>

        {permission !== 'granted' && permission !== 'unsupported' && (
          <div className="setting-row compact">
            <div>
              <div className="setting-name">알림 권한</div>
              <div className="setting-desc">
                Android 13 이상은 알림 권한을 허용해야 상단 알림이 표시됩니다.
              </div>
            </div>
            <button className="ghost-btn" onClick={() => void grantPermission()}>
              권한 허용
            </button>
          </div>
        )}

        <div className="setting-row compact">
          <div>
            <div className="setting-name">알림 테스트</div>
            <div className="setting-desc">누르면 지금 바로 테스트 알림을 보내 동작을 확인할 수 있습니다.</div>
          </div>
          <button className="ghost-btn" onClick={() => void runNotifyTest()} disabled={testing}>
            {testing ? '보내는 중…' : '🔔 테스트 알림'}
          </button>
        </div>

        <div className="setting-row compact td-key-row">
          <div>
            <div className="setting-name">ntfy 외부 푸시 (선택)</div>
            <div className="setting-desc">
              {settings.notifyNtfy
                ? `연결됨 — ${ntfyEndpoint(settings.notifyNtfy) ?? ''}`
                : 'ntfy 사용 안 함 — 같은 알림을 ntfy로도 보내려면 무료 토픽 이름(또는 URL)을 넣으세요.'}
            </div>
          </div>
          <div className="td-key-edit">
            <input
              type="text"
              className="td-key-input"
              value={ntfyDraft}
              placeholder="예: bgss-hw3238-9f4k2m"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setNtfyDraft(e.target.value)}
            />
            <SaveButton
              name="ntfy"
              dirty={ntfyDraft.trim() !== settings.notifyNtfy}
              onSave={() => onChange({ notifyNtfy: ntfyDraft.trim() })}
            />
            {settings.notifyNtfy && (
              <button
                className="ghost-btn"
                onClick={() => {
                  setNtfyDraft('');
                  onChange({ notifyNtfy: '' });
                }}
              >
                삭제
              </button>
            )}
          </div>
        </div>

        <div className={`update-status ${testNote ? 'on' : ''}`}>
          {testNote ||
            '같은 시그널은 한 번만 알리고, 앱을 켜기 전에 떠 있던 시그널은 알리지 않습니다.'}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>스캐너 설정</h3>
        </header>
        <div className="setting-row">
          <div>
            <div className="setting-name">레버리지 배율</div>
            <div className="setting-desc">
              코인·주식선물 시그널 카드와 백테스트 수익률에 반영됩니다.
            </div>
          </div>
          <div className="setting-actions">
            <div className="segmented">
              {[5, 10, 20, 50].map((l) => (
                <button key={l} className={leverageDraft === l ? 'on' : ''} onClick={() => setLeverageDraft(l)}>
                  {l}x
                </button>
              ))}
            </div>
            <SaveButton
              name="leverage"
              dirty={isDirty(settings.leverage, leverageDraft)}
              onSave={() => onChange({ leverage: leverageDraft })}
            />
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-name">최소 손익비 필터</div>
            <div className="setting-desc">진입 시점 손익비가 이 값보다 낮은 셋업은 목록에서 제외합니다.</div>
          </div>
          <div className="setting-actions">
            <div className="segmented">
              {[1.2, 1.5, 1.8, 2, 2.5].map((r) => (
                <button key={r} className={minRRDraft === r ? 'on' : ''} onClick={() => setMinRRDraft(r)}>
                  {r.toFixed(1)}R
                </button>
              ))}
            </div>
            <SaveButton
              name="min-rr"
              dirty={isDirty(settings.minRR, minRRDraft)}
              onSave={() => onChange({ minRR: minRRDraft })}
            />
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-name">자동 갱신 주기</div>
            <div className="setting-desc">캔들·티커를 다시 받아 백테스트와 시그널을 갱신합니다.</div>
          </div>
          <div className="setting-actions">
            <div className="segmented">
              {[30, 60, 120, 0].map((s) => (
                <button key={s} className={refreshDraft === s ? 'on' : ''} onClick={() => setRefreshDraft(s)}>
                  {s === 0 ? '꺼짐' : `${s}초`}
                </button>
              ))}
            </div>
            <SaveButton
              name="refresh"
              dirty={isDirty(settings.refreshSec, refreshDraft)}
              onSave={() => onChange({ refreshSec: refreshDraft })}
            />
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-name">새 시그널 알림음</div>
            <div className="setting-desc">새로운 진행중 시그널이 감지되면 짧은 알림을 냅니다.</div>
          </div>
          <div className="setting-actions">
            <button
              className={`switch ${soundDraft ? 'on' : ''}`}
              onClick={() => setSoundDraft(!soundDraft)}
              aria-label="새 시그널 알림음 켜기/끄기"
              aria-pressed={soundDraft}
            >
              <span />
            </button>
            <SaveButton
              name="sound"
              dirty={isDirty(settings.sound, soundDraft)}
              onSave={() => onChange({ sound: soundDraft })}
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>엔진 기준</h3>
        </header>
        <ul className="rule-list">
          <li>
            <b>전략 풀</b> {STRATEGIES.map((m) => m.short).join(', ')} — {STRATEGIES.length}개 매매법
            (상위 트레이더 기법을 실제 비트겟 {BENCH_INFO.universe}에 전수 백테스트해 기대값이 플러스인 기법만 유지)
          </li>
          <li>
            <b>HTF 동조</b> 1H 신호는 4H EMA50에 해당하는 EMA200 추세 방향에서만 냅니다. 추세를 거스르는 역추세
            셋업은 시그널에서 제외됩니다
          </li>
          <li>
            <b>정밀 타점</b> 손절은 직전 스윙·오더블록·FVG 경계, 신호 캔들 극값에 최소 버퍼만 붙여 붙입니다. 진입가에서
            멀리 떨어진 넓은 손절 셋업은 시그널에서 제외합니다
          </li>
          <li>
            <b>손절폭 상한</b> {STOP_WIDTH['1H'].max}% (1H) · {STOP_WIDTH['4H'].max}% (4H), 하한{' '}
            {STOP_WIDTH['1H'].min}% — 상한을 넘는 넓은 손절폭 시그널은 만들지 않습니다
          </li>
          <li>
            <b>마켓 실측 채택</b> 최근 60봉 표본 {MIN_TRADES}건 이상 · 승률 {MIN_WINRATE}% 이상 · 손익비 {MIN_RR}R 이상
          </li>
          <li>
            <b>전수 검증 채택</b> 마켓 표본이 모자라도 전수 백테스트 승률 {BENCH_GATE.minWinRate}% · 1건 기대값{' '}
            {BENCH_GATE.minExp}R · 표본 {BENCH_GATE.minN}건 이상인 기법은 최근 반증(연속 손실)이 없으면 채택합니다
          </li>
          <li>
            <b>우선순위</b> 채택 순서는 <b>기대값 × 승률</b> — 횟수가 많은 저승률 기법이 고승률 기법을 밀어내지 못합니다
          </li>
          <li>
            <b>판정</b> 진입 이후 최대 42봉 안에 목표가/손절가 도달 여부로 목표 달성·손절 종료를 판정합니다
          </li>
          <li>
            <b>수익률</b> 1회 리스크를 자본의 1%로 두고 R배수 × 레버리지로 환산합니다
          </li>
        </ul>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>데이터</h3>
        </header>
        <div className="setting-row compact">
          <div>
            <div className="setting-name">시그널 추적 기록</div>
            <div className="setting-desc">{historyCount}건 저장됨</div>
          </div>
          <button className="ghost-btn" onClick={onClearHistory} disabled={!historyCount}>
            초기화
          </button>
        </div>
        <div className="setting-row compact">
          <div>
            <div className="setting-name">전략 교체 로그</div>
            <div className="setting-desc">{swapCount}건 저장됨</div>
          </div>
          <button className="ghost-btn" onClick={onClearSwapLog} disabled={!swapCount}>
            초기화
          </button>
        </div>
        <ul className="api-list">
          <li>
            <span>계약 목록</span>
            <code>GET /api/v2/mix/market/contracts?productType=USDT-FUTURES</code>
          </li>
          <li>
            <span>실시간 티커</span>
            <code>GET /api/v2/mix/market/tickers?productType=USDT-FUTURES</code>
          </li>
          <li>
            <span>캔들</span>
            <code>GET /api/v2/mix/market/candles?symbol=..&amp;granularity=1H|4H&amp;limit=200</code>
          </li>
        </ul>
      </section>

      <p className="disclaimer">
        COTA는 비트겟 공개 시세 데이터를 계산해 과거 통계를 보여주는 정보 도구입니다. 투자 권유가 아니며,
        표시된 승률·수익률은 과거 데이터 기준으로 미래 성과를 보장하지 않습니다. 레버리지 거래는 원금 전액을
        잃을 수 있습니다.
      </p>
    </div>
  );
}
