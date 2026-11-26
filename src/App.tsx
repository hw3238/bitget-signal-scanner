import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav, NAV_TABS, type TabKey } from './components/BottomNav';
import { ExchangeGate, ExchangeSheet } from './components/ExchangePicker';
import { HistoryTab } from './components/HistoryTab';
import { MarketTab } from './components/MarketTab';
import { MenuTab } from './components/MenuTab';
import { ScannerTab } from './components/ScannerTab';
import { SettingsTab } from './components/SettingsTab';
import type { MenuView } from './components/MenuTab';
import { ShareModal } from './components/ShareModal';
import { AuthGate } from './components/AuthGate';
import logoUrl from './assets/cota-logo.png';
import { RefreshIcon, SwapIcon } from './components/Icons';
import type { Contract, Signal } from './engine/types';
import { useFavorites } from './hooks/useFavorites';
import { useAutoTrade } from './hooks/useAutoTrade';
import { useAccountAuth } from './hooks/useAccountAuth';
import { useConnectionSync } from './hooks/useConnectionSync';
import { useMyTrades } from './hooks/useMyTrades';
import { useScanner } from './hooks/useScanner';
import { usePropr } from './hooks/usePropr';
import { fmtTime } from './lib/format';
import { isNativeApp, openExternalUrl } from './lib/native';
import { useApkUpdate } from './lib/useApkUpdate';
import { useSignalNotifications } from './lib/notify';
import { APK_DOWNLOAD_URL, checkForUpdate, RELEASES_PAGE } from './lib/update';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './lib/storage';
import { EXCHANGES, loadExchange, saveExchange, type Exchange } from './lib/exchange';
import { recommendLeverage } from './lib/profile';
import { planRiskSave } from './lib/settingsSync';
import { gateStage } from './lib/gate';

type Tab = TabKey;

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...loadSettings() }));
  /** 거래소 선택 — null 이면 아직 고르지 않은 첫 방문(선택 화면을 먼저 보여준다) */
  const [exchange, setExchange] = useState<Exchange | null>(() => loadExchange());
  const [exchangeSheet, setExchangeSheet] = useState(false);
  const [tab, setTab] = useState<Tab>('scanner');
  const [shareSignal, setShareSignal] = useState<Signal | null>(null);
  const [update, setUpdate] = useState<{ version: string; apkUrl: string | null; htmlUrl: string } | null>(
    null,
  );
  const [updateDismissed, setUpdateDismissed] = useState(false);
  /** 🔐 COTA 계정 — 저장된 세션 복원 · 로그인/가입 · 관리자 판별 */
  const auth = useAccountAuth(exchange);
  // 상단 배너에서도 앱을 나가지 않고 APK 다운로드 → 설치 화면으로 이어진다.
  const apkUpdate = useApkUpdate();
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
  /**
   * 🔒 회원 전용 게이트 — 세션이 없으면 **스캔 자체를 돌리지 않는다**.
   *    (미로그인 상태의 백그라운드 마켓 API 호출·데이터 노출을 원천 차단)
   */
  const authed = !!auth.session;
  /** 로그인·로그아웃하면 항상 스캐너(첫 화면)부터 — 게이트 너머로 이전 탭이 남지 않게 한다. */
  useEffect(() => {
    setTab('scanner');
    setMenuView(null);
  }, [authed]);
  const { state, history, swapLog, scan, clearHistory, clearSwapLog } = useScanner({
    refreshSec: settings.refreshSec,
    favoriteSymbols,
    exchange,
    enabled: authed,
  });

  /**
   * 🏆 Propr 5K 터보 전용 탐지 — 메인 거래소 스캐너·자동매매와 **상태·캐시가 완전히 분리**된다.
   *  · 로그인 직후 바로 돌리지 않고, 사용자가 메뉴에서 Propr 화면을 처음 열 때 시작한다
   *    (Hyperliquid 캔들 API 는 분당 weight 한도가 빡빡해 필요할 때만 쓴다).
   *  · 한 번 열면 탭을 오가도 상태가 남아 메뉴 배지에 진행중 건수가 바로 뜬다.
   */
  const [proprSeen, setProprSeen] = useState(false);
  const propr = usePropr({ enabled: authed && proprSeen });


  /**
   * 전략엔진·기록처럼 시그널별 계산이 아닌 화면에 쓰는 **대표 배율**.
   * 추천 배율은 시그널마다 다르므로(v1.5.7) 집계·수익률 표시에는 중립 기준 10x를 쓴다.
   */
  const repLeverage = settings.leverageMode === 'auto' ? 10 : settings.leverage;

  /** 🤖 비트겟 자동매매 — 시그널·프로필·계약 단위로 수량을 계산해 앱 네이티브에 주문을 맡긴다 */
  /** 종목 계약 정보 — 추천 레버리지를 거래소 종목 최대 배율(maxLever) 안으로 제한한다(v1.5.6) */
  const contractBySymbol = useMemo(() => {
    const map = new Map<string, Contract>();
    for (const c of state.contracts) map.set(c.symbol, c);
    return map;
  }, [state.contracts]);

  const autoTrade = useAutoTrade({
    // 자동매매·원클릭 주문은 **비트겟 계좌 전용** — 바이낸스 모드에서는 시그널을 감시 대상에서 뺀다.
    // (바이낸스 시그널로 비트겟 주문이 나가는 사고를 원천 차단)
    signals: exchange === 'bitget' ? state.signals : [],
    paused: exchange !== 'bitget',
    contracts: state.contracts,
    // 잔고(equity)와 종목 최대 배율을 함께 넘겨 잔고 구간별 유동 레버리지를 쓴다(v1.5.6)
    leverageFor: (signal, equity) =>
      settings.leverageMode === 'auto'
        ? recommendLeverage(signal, equity, contractBySymbol.get(signal.symbol)?.maxLever).leverage
        : settings.leverage,
  });

  /**
   * 🔗 로그인한 유저의 거래소·API 연결 내역을 Supabase(`cota_connections`)에 실시간 동기화.
   *    잔고는 자주 흔들리므로 2자리 반올림·1.2초 디바운스로 요청을 줄인다(useConnectionSync).
   *    API Key/Secret/Passphrase 는 payload 화이트리스트 밖이라 전송되지 않는다.
   */
  useConnectionSync({
    auth,
    exchange,
    mode: autoTrade.tradeMode.mode,
    apiConnected: autoTrade.keys.hasKeys,
    autotradeEnabled: autoTrade.config.enabled,
    equity: autoTrade.accountBase.equity,
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

  /** 거래소 선택·전환 — 저장하고, 스캐너는 새 거래소 마켓만 다시 스캔한다(useScanner). */
  const chooseExchange = useCallback((next: Exchange) => {
    saveExchange(next);
    setExchangeSheet(false);
    setExchange(next);
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
    shareSignal && settings.leverageMode === 'auto'
      ? recommendLeverage(
          shareSignal,
          autoTrade.accountBase.equity,
          contractBySymbol.get(shareSignal.symbol)?.maxLever,
        ).leverage
      : settings.leverage;

  /**
   * ⚙️ 설정 탭 저장 → 자동매매 연동(v1.5.6).
   *  · 1회 리스크: 설정과 자동매매가 같은 값이 되도록 함께 저장한다.
   *  · 매매 스타일(보수적/공격적)과 프리셋은 없어졌다(v1.5.7) — 리스크·레버리지 상한·포지션 수는
   *    자동매매 화면의 `② 리스크 · 안전장치`에서 숫자로 직접 정하고 `저장`한다.
   */
  const saveSettingsRisk = useCallback(
    (riskPct: number | null) => {
      const plan = planRiskSave(riskPct);
      patchSettings({ riskPct: plan.settingsRiskPct });
      autoTrade.setRiskPct(plan.autoRiskPct);
    },
    [autoTrade.setRiskPct, patchSettings],
  );

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

  /** 메뉴 하위 화면 전환 — Propr 화면을 처음 열면 그때 프랍 탐지를 시작한다. */
  const openMenuView = useCallback((next: MenuView | null) => {
    if (next === 'propr') setProprSeen(true);
    setMenuView(next);
  }, []);

  /**
   * 🔒 진입 게이트(v1.5.8) — 화면 순서: 계정 확인 → 회원가입/로그인 → 거래소 선택 → 앱.
   *  · 미로그인: 어떤 탭·시그널·메뉴·설정 DOM 도 만들지 않고 게이트만 그린다.
   *  · 세션 복원 중: 가입 화면이 깜빡이지 않도록 부팅 화면만.
   *  · 로그인 직후 거래소를 아직 고르지 않았다면 거래소 선택 화면으로 이어진다.
   */
  const stage = gateStage({ authReady: auth.ready, hasSession: authed, exchange });
  if (stage === 'booting') {
    return (
      <div className="app app-boot" data-auth-boot>
        <img className="app-boot-logo" src={logoUrl} alt="COTA" width={56} height={56} />
        <span>계정 확인 중…</span>
      </div>
    );
  }
  if (stage === 'auth') {
    return (
      <div className="app app-gate">
        <AuthGate auth={auth} />
      </div>
    );
  }
  /** 로그인했지만 거래소를 고르기 전 — 선택 화면만 보여준다. */
  if (stage === 'exchange' || !exchange) {
    return (
      <div className="app app-gate">
        <ExchangeGate onPick={chooseExchange} />
      </div>
    );
  }

  const exchangeMeta = EXCHANGES[exchange];
  const bitgetMode = exchange === 'bitget';

  return (
    <div className="app">
      <header className="app-bar">
        <div className="app-bar-inner">
          <div className="brand">
            <img className="brand-logo" src={logoUrl} alt="COTA" width={34} height={34} />
            <div className="brand-text">
              <b>COTA</b>
              <span>{exchangeMeta.marketLine} 시그널</span>
            </div>
            <button
              type="button"
              className={`exchange-chip ${exchange}`}
              data-exchange-chip
              data-exchange-value={exchange}
              onClick={() => setExchangeSheet(true)}
              aria-label={`거래소 전환 — 현재 ${exchangeMeta.koName}`}
            >
              <img src={exchangeMeta.logo} alt="" width={18} height={18} data-exchange-chip-logo />
              <b>{exchangeMeta.koName}</b>
              <SwapIcon size={12} />
            </button>
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
            <button
              type="button"
              className={`auth-chip ${auth.session ? 'on' : ''} ${auth.isAdmin ? 'admin' : ''}`}
              data-auth-chip
              data-auth-state="member"
              onClick={() => goTab('menu')}
              aria-label={`${auth.profile?.nickname ?? '내'} 계정 — 메뉴로`}
            >
              <span className="auth-chip-avatar" aria-hidden>
                {auth.session ? (auth.profile?.nickname ?? auth.session.user.email).slice(0, 1).toUpperCase() : '👤'}
              </span>
              <b>{auth.session ? auth.profile?.nickname ?? '내 계정' : '로그인'}</b>
            </button>
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
            exchange={exchange}
            state={state}
            settings={settings}
            favorites={favorites.entries}
            isFavorite={favorites.isFavorite}
            onToggleFavorite={favorites.toggle}
            onSettings={patchSettings}
            onOpen={setShareSignal}
            onRescan={() => void scan(true)}
            account={autoTrade.accountBase}
            onConnectAccount={openAutoTrade}
            myTrades={myTrades.entries}
            onToggleMyTrade={myTrades.toggle}
            onQuickOrder={
              // 바이낸스 모드는 탐지 전용 — 비트겟 계좌로 주문이 나가지 않도록 버튼 자체를 숨긴다.
              bitgetMode
                ? (s) => {
                    void autoTrade.quickOrder(s).then((res) => {
                      if (!res.ok) window.alert(res.message);
                    });
                  }
                : undefined
            }
            quickOrderMode={autoTrade.tradeMode.mode}
            quickOrderSymbol={autoTrade.busy?.startsWith('order:') ? autoTrade.busy.slice(6) : null}
          />
        )}
        {tab === 'market' && <MarketTab state={state} exchange={exchange} onRescan={() => void scan(true)} />}
        {tab === 'menu' && (
          <MenuTab
            exchange={exchange}
            onExchangeChange={chooseExchange}
            state={state}
            account={autoTrade.accountBase}
            view={menuView}
            onViewChange={openMenuView}
            leverage={repLeverage}
            swapLog={swapLog}
            onRescan={() => void scan(true)}
            onClearLog={clearSwapLog}
            autoTrade={autoTrade}
            signals={state.signals}
            auth={auth}
            propr={propr}
          />
        )}
        {tab === 'history' && (
          <HistoryTab
            history={history}
            leverage={repLeverage}
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
            exchange={exchange}
            onExchangeChange={chooseExchange}
            settings={settings}
            state={state}
            onChange={patchSettings}
            onClearHistory={clearHistory}
            onClearSwapLog={clearSwapLog}
            historyCount={history.length}
            swapCount={swapLog.length}
            onTestNotification={sendTest}
            account={autoTrade.accountBase}
            onConnectAccount={openAutoTrade}
            autoTrade={autoTrade}
            onSaveRisk={saveSettingsRisk}
            auth={auth}
          />
        )}
      </main>

      <BottomNav tab={tab} onChange={goTab} badges={{ scanner: openCount }} />

      {shareSignal && (
        <ShareModal
          signal={shareSignal}
          leverage={shareLeverage}
          seed={autoTrade.accountBase.seed}
          auto={settings.leverageMode === 'auto'}
          isFavorite={favorites.isFavorite(shareSignal)}
          onToggleFavorite={favorites.toggle}
          onClose={() => setShareSignal(null)}
        />
      )}

      {exchangeSheet && (
        <ExchangeSheet current={exchange} onPick={chooseExchange} onClose={() => setExchangeSheet(false)} />
      )}

    </div>
  );
}
