import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BottomNav, NAV_TABS, type TabKey } from './components/BottomNav';
import { EngineTab } from './components/EngineTab';
import { FxTab } from './components/FxTab';
import { HistoryTab } from './components/HistoryTab';
import { MarketTab } from './components/MarketTab';
import { ScannerTab } from './components/ScannerTab';
import { SettingsTab } from './components/SettingsTab';
import { ShareModal } from './components/ShareModal';
import { RefreshIcon } from './components/Icons';
import type { Signal } from './engine/types';
import { useFavorites } from './hooks/useFavorites';
import { useScanner } from './hooks/useScanner';
import { fmtTime } from './lib/format';
import { fxTabSignals } from './lib/fxview';
import { offsetFor } from './lib/offset';
import { openExternalUrl } from './lib/native';
import { checkForUpdate, RELEASES_PAGE } from './lib/update';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './lib/storage';
import { normalizeLot } from './utils/lot';

type Tab = TabKey;

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...loadSettings() }));
  const [tab, setTab] = useState<Tab>('scanner');
  const [shareSignal, setShareSignal] = useState<Signal | null>(null);
  const [update, setUpdate] = useState<{ version: string; apkUrl: string | null; htmlUrl: string } | null>(
    null,
  );
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const { state, history, swapLog, scan, clearHistory, clearSwapLog } = useScanner({
    refreshSec: settings.refreshSec,
    twelveDataKey: settings.twelveDataKey,
  });
  const favorites = useFavorites();

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
  // FX 탭 배지 — FX·금 시그널 + BTCUSD+(비트겟 BTCUSDT 재사용) 진행중 시그널
  const openFxCount = fxTabSignals(state.signals).filter((s) => s.state === 'open').length;
  const lot = normalizeLot(settings.fxLot);

  return (
    <div className="app">
      <header className="app-bar">
        <div className="app-bar-inner">
          <div className="brand">
            <span className="brand-mark">B</span>
            <div className="brand-text">
              <b>비트겟 CRT 스캐너</b>
              <span>코인 · 주식선물 · FX·금 실시간 시그널</span>
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
          />
        )}
        {tab === 'fx' && (
          <FxTab
            state={state}
            settings={settings}
            favorites={favorites.entries}
            isFavorite={favorites.isFavorite}
            onToggleFavorite={favorites.toggle}
            onSettings={patchSettings}
            onOpen={setShareSignal}
            onRescan={() => void scan()}
          />
        )}
        {tab === 'market' && (
          <MarketTab state={state} offsets={settings.fxOffsets} onRescan={() => void scan()} />
        )}
        {tab === 'engine' && (
          <EngineTab
            state={state}
            swapLog={swapLog}
            leverage={settings.leverage}
            onRescan={() => void scan()}
            onClearLog={clearSwapLog}
          />
        )}
        {tab === 'history' && (
          <HistoryTab
            history={history}
            leverage={settings.leverage}
            offsets={settings.fxOffsets}
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
          />
        )}
      </main>

      <BottomNav tab={tab} onChange={setTab} badges={{ scanner: openCount, fx: openFxCount }} />

      {shareSignal && (
        <ShareModal
          signal={shareSignal}
          leverage={settings.leverage}
          lot={shareSignal.asset === 'fx' ? lot : undefined}
          offset={offsetFor(shareSignal.base, settings.fxOffsets)}
          isFavorite={favorites.isFavorite(shareSignal)}
          onToggleFavorite={favorites.toggle}
          onClose={() => setShareSignal(null)}
        />
      )}
    </div>
  );
}
