import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav, NAV_TABS, type TabKey } from './components/BottomNav';
import { HistoryTab } from './components/HistoryTab';
import { MarketTab } from './components/MarketTab';
import { MenuTab } from './components/MenuTab';
import { ScannerTab } from './components/ScannerTab';
import { SettingsTab } from './components/SettingsTab';
import { OnboardingModal } from './components/OnboardingModal';
import { ShareModal } from './components/ShareModal';
import logoUrl from './assets/cota-logo.png';
import { RefreshIcon } from './components/Icons';
import type { Signal } from './engine/types';
import { useFavorites } from './hooks/useFavorites';
import { useScanner } from './hooks/useScanner';
import { fmtTime } from './lib/format';
import { openExternalUrl } from './lib/native';
import { useSignalNotifications } from './lib/notify';
import { checkForUpdate, RELEASES_PAGE } from './lib/update';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './lib/storage';
import { loadProfile, recommendLeverage, saveProfile, type Profile } from './lib/profile';

type Tab = TabKey;

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...loadSettings() }));
  const [tab, setTab] = useState<Tab>('scanner');
  const [shareSignal, setShareSignal] = useState<Signal | null>(null);
  const [update, setUpdate] = useState<{ version: string; apkUrl: string | null; htmlUrl: string } | null>(
    null,
  );
  const [updateDismissed, setUpdateDismissed] = useState(false);
  // 첫 실행 온보딩 — cota.profile.v1 이 없으면 시드·매매 성향을 먼저 받는다.
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile());
  const [onboarding, setOnboarding] = useState<boolean>(() => loadProfile() === null);
  const { state, history, swapLog, scan, clearHistory, clearSwapLog } = useScanner({
    refreshSec: settings.refreshSec,
  });
  const favorites = useFavorites();

  // 🔔 새 시그널 → 핸드폰 알림 (첫 스캔 결과는 기준선으로만 기록)
  const { sendTest } = useSignalNotifications({
    signals: state.signals,
    ready: state.passes > 0,
    settings,
  });

  // 새 APK 릴리즈가 있으면 상단 배너로 알린다.
  useEffect(() => {
    let cancelled = false;
    void checkForUpdate().then((res) => {
      if (cancelled || !res.updateAvailable || !res.latest) return;
      setUpdate({
        version: res.latest,
        apkUrl: res.apkUrl ?? null,
        htmlUrl: res.htmlUrl ?? RELEASES_PAGE,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  // 새 시그널 알림음
  const knownIds = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  useEffect(() => {
    const openIds = state.signals.filter((s) => s.state === 'open').map((s) => s.id);
    if (firstLoad.current) {
      knownIds.current = new Set(openIds);
      firstLoad.current = false;
      return;
    }
    const fresh = openIds.filter((id) => !knownIds.current.has(id));
    openIds.forEach((id) => knownIds.current.add(id));
    if (fresh.length && settings.sound) {
      try {
        const AudioCtor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtor) {
          const ctx = new AudioCtor();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = 880;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.06, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
          osc.connect(gain).connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.24);
        }
      } catch {
        /* 오디오를 사용할 수 없는 환경 */
      }
    }
  }, [state.signals, settings.sound]);

  const statusText = useMemo(() => {
    if (state.status === 'scanning') {
      const pct = state.progress.total
        ? Math.round((state.progress.done / state.progress.total) * 100)
        : 0;
      return `스캔 중 ${pct}%`;
    }
    if (state.status === 'error') return '연결 오류';
    if (state.status === 'ready') return `실시간 · ${fmtTime(state.finishedAt)} 갱신`;
    return '대기';
  }, [state]);

  const openCount = state.signals.filter((s) => s.state === 'open' && s.asset !== 'fx').length;
  /** 전략엔진·기록처럼 시그널별 계산이 아닌 화면에 쓰는 대표 배율 */
  const repLeverage =
    settings.leverageMode === 'auto' && profile
      ? profile.style === 'aggressive'
        ? 15
        : 3
      : settings.leverage;
  const shareLeverage =
    shareSignal && settings.leverageMode === 'auto' && profile
      ? recommendLeverage(shareSignal, profile.style).leverage
      : settings.leverage;

  const saveOnboarding = (next: Profile) => {
    saveProfile(next);
    setProfile(next);
    setOnboarding(false);
  };

  return (
    <div className="app">
      <header className="app-bar">
        <div className="app-bar-inner">
          <div className="brand">
            <img className="brand-logo" src={logoUrl} alt="COTA" width={34} height={34} />
            <div className="brand-text">
              <b>COTA</b>
              <span>실시간 코인 · 주식선물 시그널</span>
            </div>
          </div>

          <nav className="top-nav">
            {NAV_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                data-tab={t.key}
                className={tab === t.key ? 'on' : ''}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="app-status">
            <span className={`live-dot ${state.status}`} />
            <span className="status-text">{statusText}</span>
            <button
              className="icon-btn"
              onClick={() => void scan()}
              disabled={state.status === 'scanning'}
              aria-label="새로고침"
            >
              <RefreshIcon size={17} />
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        {update && !updateDismissed && (
          <div className="update-banner app-wide">
            <div className="update-banner-text">
              <b>새 버전 v{update.version}</b>
              <span>최신 APK로 업데이트할 수 있어요.</span>
            </div>
            <button
              className="update-banner-btn"
              onClick={() => void openExternalUrl(update.apkUrl || update.htmlUrl)}
            >
              업데이트
            </button>
            <button className="update-banner-x" onClick={() => setUpdateDismissed(true)} aria-label="알림 닫기">
              ✕
            </button>
          </div>
        )}
        {tab === 'scanner' && (
          <ScannerTab
            state={state}
            settings={settings}
            favorites={favorites.entries}
            isFavorite={favorites.isFavorite}
            onToggleFavorite={favorites.toggle}
            onSettings={patchSettings}
            onOpen={setShareSignal}
            onRescan={() => void scan()}
            profile={profile}
          />
        )}
        {tab === 'market' && <MarketTab state={state} onRescan={() => void scan()} />}
        {tab === 'menu' && (
          <MenuTab
            state={state}
            profile={profile}
            leverage={repLeverage}
            swapLog={swapLog}
            onRescan={() => void scan()}
            onClearLog={clearSwapLog}
          />
        )}
        {tab === 'history' && <HistoryTab history={history} leverage={repLeverage} onClear={clearHistory} />}
        {tab === 'settings' && (
          <SettingsTab
            settings={settings}
            state={state}
            onChange={patchSettings}
            onClearHistory={clearHistory}
            onClearSwapLog={clearSwapLog}
            historyCount={history.length}
            swapCount={swapLog.length}
            onTestNotification={sendTest}
            profile={profile}
            onEditProfile={() => setOnboarding(true)}
          />
        )}
      </main>

      <BottomNav tab={tab} onChange={setTab} badges={{ scanner: openCount }} />

      {shareSignal && (
        <ShareModal
          signal={shareSignal}
          leverage={shareLeverage}
          profile={profile}
          auto={settings.leverageMode === 'auto'}
          isFavorite={favorites.isFavorite(shareSignal)}
          onToggleFavorite={favorites.toggle}
          onClose={() => setShareSignal(null)}
        />
      )}

      {onboarding && (
        <OnboardingModal
          initial={profile}
          canClose={!!profile}
          onSave={saveOnboarding}
          onClose={() => setOnboarding(false)}
        />
      )}
    </div>
  );
}
