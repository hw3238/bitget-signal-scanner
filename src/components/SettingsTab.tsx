import { useEffect, useState } from 'react';
import type { Settings } from '../lib/storage';
import { BENCH_GATE, MIN_RR, MIN_TRADES, MIN_WINRATE } from '../engine/backtest';
import { STOP_WIDTH } from '../engine/risk';
import type { ScanState } from '../hooks/useScanner';
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
import { STYLE_META, fmtSeed, type Profile } from '../lib/profile';
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

interface Props {
  settings: Settings;
  state: ScanState;
  onChange: (patch: Partial<Settings>) => void;
  onClearHistory: () => void;
  onClearSwapLog: () => void;
  historyCount: number;
  swapCount: number;
  /** 첫 실행 온보딩에서 저장한 투자 프로필 */
  profile: Profile | null;
  /** 온보딩 모달 다시 열기 */
  onEditProfile: () => void;
  /** 설정 화면의 알림 테스트 버튼 */
  onTestNotification: (signal?: Signal | null) => Promise<{
    permission: NotifyPermission;
    shown: boolean;
    ntfy: boolean;
  }>;
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
  onEditProfile,
  onTestNotification,
}: Props) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [apkVersion, setApkVersion] = useState<string | null>(null);
  const [ntfyDraft, setNtfyDraft] = useState(settings.notifyNtfy);
  const [permission, setPermission] = useState<NotifyPermission | null>(null);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState('');
  /** 리스크 '직접 입력' 모드 — 프리셋 값에서도 숫자 입력을 열어 준다. */
  const [riskCustom, setRiskCustom] = useState(false);
  const native = isNativeApp();
  const apkUpdate = useApkUpdate();

  useEffect(() => {
    void notificationPermission().then(setPermission);
  }, []);

  const grantPermission = async () => {
    const next = await requestNotificationPermission();
    setPermission(next);
    return next;
  };

  const toggleNotify = () => {
    const next = !settings.notifyEnabled;
    onChange({ notifyEnabled: next });
    if (next) void grantPermission();
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

  return (
    <div className="tab settings-tab">
      <section className="panel profile-card" id="settings-profile">
        <header className="panel-head">
          <h3>💼 내 투자 프로필</h3>
          <span className="panel-note">COTA 추천 레버리지 기준</span>
        </header>
        <div className="profile-grid">
          <div className="profile-cell">
            <span>내 시드</span>
            <b>${fmtSeed(profile?.seed ?? 0)}</b>
            <i>USDT</i>
          </div>
          <div className="profile-cell">
            <span>매매 성향</span>
            <b>
              {style?.emoji} {style?.label ?? '미설정'}
            </b>
            <i>{style?.range}</i>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-name">레버리지 모드</div>
            <div className="setting-desc">
              시그널마다 손절 폭·승률·손익비로 계산한 COTA 추천 배율을 쓰거나, 직접 고정할 수 있습니다.
            </div>
          </div>
          <div className="segmented">
            <button className={settings.leverageMode === 'auto' ? 'on' : ''} onClick={() => onChange({ leverageMode: 'auto' })}>
              COTA 추천
            </button>
            <button className={settings.leverageMode === 'manual' ? 'on' : ''} onClick={() => onChange({ leverageMode: 'manual' })}>
              직접 고정
            </button>
          </div>
        </div>
        <div className="setting-row risk-setting">
          <div>
            <div className="setting-name">실전 주문 리스크</div>
            <div className="setting-desc">
              카드의 주문 수량은 손절가에 닿았을 때 시드의 이 비율만큼만 잃도록 자동 계산됩니다. 0.5~50%까지
              직접 입력할 수 있습니다.
              {profile ? ` 지금 설정은 시드의 ${defaultRiskPct(profile.style)}% 기준입니다.` : ''}
            </div>
          </div>
          <div className="risk-control">
            <label className="select-pill risk-pill">
              <span>리스크</span>
              <select
                value={
                  settings.riskPct == null
                    ? 'auto'
                    : riskCustom || !(RISK_PRESETS as readonly number[]).includes(settings.riskPct)
                      ? 'custom'
                      : String(settings.riskPct)
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'auto') {
                    setRiskCustom(false);
                    onChange({ riskPct: null });
                  } else if (v === 'custom') {
                    setRiskCustom(true);
                    if (settings.riskPct == null) onChange({ riskPct: clampRiskInput(2.5) });
                  } else {
                    setRiskCustom(false);
                    onChange({ riskPct: Number(v) });
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
                    시드의 {v}%
                  </option>
                ))}
                <option value="custom">직접 입력</option>
              </select>
            </label>
            {settings.riskPct != null && (riskCustom || !(RISK_PRESETS as readonly number[]).includes(settings.riskPct)) && (
              <label className="risk-custom">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0.5}
                  max={50}
                  step={0.1}
                  value={settings.riskPct}
                  onChange={(e) => onChange({ riskPct: clampRiskInput(Number(e.target.value)) })}
                  aria-label="1회 허용 손실률 직접 입력"
                  data-risk-input
                />
                <i>%</i>
              </label>
            )}
          </div>
        </div>
        {isHighRisk(resolveRiskPct(profile?.style ?? 'conservative', settings.riskPct)) && (
          <div className="risk-high-warn" data-risk-warning>
            ⚠️ 고위험 설정: 연속 손실 시 시드 감소가 커집니다
          </div>
        )}
        <div className="setting-row compact">
          <div>
            <div className="setting-name">내 투자 성향 다시 설정</div>
            <div className="setting-desc">시드와 보수적/공격적 성향을 바꾸면 추천 배율과 예상 손익이 다시 계산됩니다.</div>
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
          <button
            className={`switch ${settings.notifyEnabled ? 'on' : ''}`}
            onClick={toggleNotify}
            aria-label="시그널 알림 켜기/끄기"
            aria-pressed={settings.notifyEnabled}
          >
            <span />
          </button>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-name">알림 대상</div>
            <div className="setting-desc">
              {NOTIFY_TARGETS.find((t) => t.key === settings.notifyTarget)?.desc ?? ''}
            </div>
          </div>
          <div className="segmented notify-target">
            {NOTIFY_TARGETS.map((t) => (
              <button
                key={t.key}
                className={settings.notifyTarget === t.key ? 'on' : ''}
                onClick={() => onChange({ notifyTarget: t.key })}
              >
                {t.label}
              </button>
            ))}
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
            <button className="ghost-btn" onClick={() => onChange({ notifyNtfy: ntfyDraft.trim() })}>
              저장
            </button>
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
          <div className="segmented">
            {[5, 10, 20, 50].map((l) => (
              <button key={l} className={settings.leverage === l ? 'on' : ''} onClick={() => onChange({ leverage: l })}>
                {l}x
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-name">최소 손익비 필터</div>
            <div className="setting-desc">진입 시점 손익비가 이 값보다 낮은 셋업은 목록에서 제외합니다.</div>
          </div>
          <div className="segmented">
            {[1.2, 1.5, 1.8, 2, 2.5].map((r) => (
              <button key={r} className={settings.minRR === r ? 'on' : ''} onClick={() => onChange({ minRR: r })}>
                {r.toFixed(1)}R
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-name">자동 갱신 주기</div>
            <div className="setting-desc">캔들·티커를 다시 받아 백테스트와 시그널을 갱신합니다.</div>
          </div>
          <div className="segmented">
            {[30, 60, 120, 0].map((s) => (
              <button key={s} className={settings.refreshSec === s ? 'on' : ''} onClick={() => onChange({ refreshSec: s })}>
                {s === 0 ? '꺼짐' : `${s}초`}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div>
            <div className="setting-name">새 시그널 알림음</div>
            <div className="setting-desc">새로운 진행중 시그널이 감지되면 짧은 알림을 냅니다.</div>
          </div>
          <button className={`switch ${settings.sound ? 'on' : ''}`} onClick={() => onChange({ sound: !settings.sound })}>
            <span />
          </button>
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
