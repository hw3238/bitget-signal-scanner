import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav, NAV_TABS, type TabKey } from './components/BottomNav';
import { HistoryTab } from './components/HistoryTab';
import { MarketTab } from './components/MarketTab';
import { MenuTab } from './components/MenuTab';
import { ScannerTab } from './components/ScannerTab';
import { SettingsTab } from './components/SettingsTab';
import type { MenuView } from './components/MenuTab';
import { OnboardingModal } from './components/OnboardingModal';
import { ShareModal } from './components/ShareModal';
import logoUrl from './assets/cota-logo.png';
import { RefreshIcon } from './components/Icons';
import type { Contract, Signal } from './engine/types';
import { useFavorites } from './hooks/useFavorites';
import { useAutoTrade } from './hooks/useAutoTrade';
import { useMyTrades } from './hooks/useMyTrades';
import { useScanner } from './hooks/useScanner';
import { fmtTime } from './lib/format';
import { isNativeApp, openExternalUrl } from './lib/native';
import { useApkUpdate } from './lib/useApkUpdate';
import { useSignalNotifications } from './lib/notify';
import { APK_DOWNLOAD_URL, checkForUpdate, RELEASES_PAGE } from './lib/update';
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
  // 상단 배너에서도 앱을 나가지 않고 APK 다운로드 → 설치 화면으로 이어진다.
  const apkUpdate = useApkUpdate();
  // 첫 실행 온보딩 — cota.profile.v1 이 없으면 매매 성향을 먼저 받는다(시드는 계좌 잔고가 기준, v1.5.5).
  const [profile, setProfile] = useState<Profile | null>(() => loadProfile());
  const [onboarding, setOnboarding] = useState<boolean>(() => loadProfile() === null);
  /** 메뉴 탭의 하위 화면 — 시그널 카드의 '계좌 연결' 버튼이 자동매매 화면을 바로 연다. */
  const [menuView, setMenuView] = useState<MenuView | null>(null);
  const favorites = useFavorites();
  // 내가 실제로 진입한 시그널 — 기록 탭의 내 매매 복기·수익곡선 기준
  const myTrades = useMyTrades();
  // 즐겨찾기 종목은 1차 우선 스캔 큐에 들어가 가장 먼저 시그널로 뜬다.
  const favoriteSymbols = useMemo(
    () => [...new Set(favorites.entries.map((f) => f.signal.symbol))],
    [favorites.entries],
  );
  const { state, history, swapLog, scan, clearHistory, clearSwapLog } = useScanner({
    refreshSec: settings.refreshSec,
    favoriteSymbols,
  });

  /** 전략엔진·기록처럼 시그널별 계산이 아닌 화면에 쓰는 대표 배율 */
  const repLeverage =
    settings.leverageMode === 'auto' && profile
      ? profile.style === 'aggressive'
        ? 15
        : 3
      : settings.leverage;

  /** 🤖 비트겟 자동매매 — 시그널·프로필·계약 단위로 수량을 계산해 앱 네이티브에 주문을 맡긴다 */
  /** 종목 계약 정보 — 추천 레버리지를 거래소 종목 최대 배율(maxLever) 안으로 제한한다(v1.5.6) */
  const contractBySymbol = useMemo(() => {
    const map = new Map<string, Contract>();
    for (const c of state.contracts) map.set(c.symbol, c);
    return map;
  }, [state.contracts]);

  const autoTrade = useAutoTrade({
    signals: state.signals,
    contracts: state.contracts,
    // 잔고(equity)와 종목 최대 배율을 함께 넘겨 잔고 구간별 유동 레버리지를 쓴다(v1.5.6)
    leverageFor: (signal, equity) =>
      settings.leverageMode === 'auto' && profile
        ? recommendLeverage(signal, profile.style, equity, contractBySymbol.get(signal.symbol)?.maxLever).leverage
        : settings.leverage,
  });

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
  const shareLeverage =
    shareSignal && settings.leverageMode === 'auto' && profile
      ? recommendLeverage(
          shareSignal,
          profile.style,
          autoTrade.accountBase.equity,
          contractBySymbol.get(shareSignal.symbol)?.maxLever,
        ).leverage
      : settings.leverage;

  /**
   * 온보딩 저장 — 성향을 처음 고르거나 바꿀 때 자동매매 설정도 같은 프리셋으로 맞춘다(v1.5.6).
   * 같은 성향으로 다시 저장했을 때는 사용자가 직접 조정한 값을 덮어쓰지 않는다.
   */
  const saveOnboarding = (next: Profile) => {
    const styleChanged = !profile || profile.style !== next.style;
    saveProfile(next);
    setProfile(next);
    setOnboarding(false);
    if (styleChanged) autoTrade.applyTradeStyle(next.style);
  };

  /** 시그널 카드·설정의 '계좌 연결' 안내 → 메뉴의 비트겟 자동매매 화면 */
  const openAutoTrade = useCallback(() => {
    setMenuView('auto');
    setTab('menu');
  }, []);

  /** 하단·상단 탭 이동 — 메뉴 탭을 누르면 항상 허브부터(하위 화면에 갇히지 않게) */
  const goTab = useCallback((next: TabKey) => {
    if (next === 'menu') setMenuView(null);
    setTab(next);
  }, []);

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
                onClick={() => goTab(t.key)}
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
              onClick={() => void scan(true)}
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
              <span>
                {apkUpdate.state.phase === 'downloading'
                  ? `APK 내려받는 중 ${apkUpdate.state.pct}%`
                  : apkUpdate.state.phase === 'installed'
                    ? '설치 화면을 열었습니다. "설치"를 눌러 마무리하세요.'
                    : apkUpdate.state.phase === 'permission'
                      ? '설정에서 COTA의 "앱 설치 허용"을 켠 뒤 다시 눌러주세요.'
                      : isNativeApp()
                        ? '앱을 나가지 않고 바로 설치할 수 있어요.'
                        : '최신 APK로 업데이트할 수 있어요.'}
              </span>
              {apkUpdate.state.phase === 'downloading' && (
                <div className="apk-progress slim">
                  <div className="apk-progress-fill" style={{ width: `${apkUpdate.state.pct}%` }} />
                </div>
              )}
            </div>
            <button
              className="update-banner-btn"
              onClick={() => {
                if (isNativeApp()) void apkUpdate.start(update.apkUrl || APK_DOWNLOAD_URL);
                else void openExternalUrl(update.apkUrl || update.htmlUrl);
              }}
              disabled={apkUpdate.state.phase === 'downloading'}
            >
              {apkUpdate.state.phase === 'downloading'
                ? `${apkUpdate.state.pct}%`
                : isNativeApp()
                  ? `바로 업데이트 (v${update.version})`
                  : '업데이트'}
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
            onRescan={() => void scan(true)}
            profile={profile}
            account={autoTrade.accountBase}
            onConnectAccount={openAutoTrade}
            myTrades={myTrades.entries}
            onToggleMyTrade={myTrades.toggle}
            onQuickOrder={(s) => {
              void autoTrade.quickOrder(s).then((res) => {
                if (!res.ok) window.alert(res.message);
              });
            }}
            quickOrderMode={autoTrade.tradeMode.mode}
            quickOrderSymbol={autoTrade.busy?.startsWith('order:') ? autoTrade.busy.slice(6) : null}
          />
        )}
        {tab === 'market' && <MarketTab state={state} onRescan={() => void scan(true)} />}
        {tab === 'menu' && (
          <MenuTab
            state={state}
            account={autoTrade.accountBase}
            view={menuView}
            onViewChange={setMenuView}
            leverage={repLeverage}
            swapLog={swapLog}
            onRescan={() => void scan(true)}
            onClearLog={clearSwapLog}
            autoTrade={autoTrade}
            signals={state.signals}
            profile={profile}
          />
        )}
        {tab === 'history' && (
          <HistoryTab
            history={history}
            leverage={repLeverage}
            profile={profile}
            account={autoTrade.accountBase}
            riskPct={settings.riskPct}
            myTrades={myTrades.entries}
            onToggleMyTrade={myTrades.toggle}
            onMemo={myTrades.setMemo}
            onClearMyTrades={myTrades.clear}
            onClear={clearHistory}
          />
        )}
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
            account={autoTrade.accountBase}
            onEditProfile={() => setOnboarding(true)}
            onConnectAccount={openAutoTrade}
          />
        )}
      </main>

      <BottomNav tab={tab} onChange={goTab} badges={{ scanner: openCount }} />

      {shareSignal && (
        <ShareModal
          signal={shareSignal}
          leverage={shareLeverage}
          profile={profile}
          seed={autoTrade.accountBase.seed}
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
