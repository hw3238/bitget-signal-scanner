import { useEffect, useMemo, useState } from 'react';
import type { Settings } from '../lib/storage';
import { MIN_RR, MIN_WINRATE } from '../engine/backtest';
import type { ScanState } from '../hooks/useScanner';
import type { Signal } from '../engine/types';
import { fmtPrice } from '../lib/format';
import {
  NOTIFY_TARGETS,
  notificationPermission,
  ntfyEndpoint,
  requestNotificationPermission,
  type NotifyPermission,
} from '../lib/notify';
import { fmtOffset, offsetFor, type OffsetMap } from '../lib/offset';
import { LOT_PRESETS, normalizeLot } from '../utils/lot';
import { buildFxRows, roundTo } from './FxOffsetBar';
import { isNativeApp, nativeAppInfo, openExternalUrl } from '../lib/native';
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
  /** 설정 화면의 알림 테스트 버튼 */
  onTestNotification: (gold?: Signal | null) => Promise<{
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
  onTestNotification,
}: Props) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [apkVersion, setApkVersion] = useState<string | null>(null);
  const [tdDraft, setTdDraft] = useState(settings.twelveDataKey);
  const [ntfyDraft, setNtfyDraft] = useState(settings.notifyNtfy);
  const [permission, setPermission] = useState<NotifyPermission | null>(null);
  const [testing, setTesting] = useState(false);
  const [testNote, setTestNote] = useState('');
  const native = isNativeApp();

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
      const gold = state.signals.find((s) => s.symbol === 'XAUUSDT' && s.state === 'open') ?? null;
      const res = await onTestNotification(gold);
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

  const fxRows = useMemo(() => buildFxRows(state, settings.twelveDataKey), [state, settings.twelveDataKey]);
  const offsets: OffsetMap = settings.fxOffsets;
  const setOffset = (label: string, value: number) => {
    const next = { ...offsets };
    if (Number.isFinite(value) && value !== 0) next[label] = value;
    else delete next[label];
    onChange({ fxOffsets: next });
  };
  const appliedCount = fxRows.filter((r) => offsetFor(r.label, offsets) !== 0).length;

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

  return (
    <div className="tab settings-tab">
      <section className="panel">
        <header className="panel-head">
          <h3>앱 · 업데이트</h3>
          <span className="panel-note">{native ? '안드로이드 앱' : '웹 버전'}</span>
        </header>

        {result?.updateAvailable && (
          <div className="update-banner">
            <div className="update-banner-text">
              <b>새 버전 v{result.latest} 배포됨</b>
              <span>APK를 내려받아 설치하면 최신 기능이 적용됩니다.</span>
            </div>
            <button className="update-banner-btn" onClick={openDownload}>
              업데이트
            </button>
          </div>
        )}

        <div className="setting-row compact">
          <div>
            <div className="setting-name">현재 버전</div>
            <div className="setting-desc">
              앱 v{APP_VERSION}
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
            새로고침(캐시 갱신)
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
              코인·주식선물 시그널 카드와 백테스트 수익률에 반영됩니다. FX 탭은 배수 대신 랏(Lot) 기준 달러
              손익으로 표시합니다.
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
            <div className="setting-name">FX 탭 랏(Lot)</div>
            <div className="setting-desc">
              FX·금·원자재·지수 카드와 공유 카드의 달러 손익을 선택한 랏 × 표준 계약 크기로 계산합니다.
            </div>
          </div>
          <div className="segmented lot-select">
            {LOT_PRESETS.map((p) => (
              <button
                key={p}
                className={Math.abs(normalizeLot(settings.fxLot) - p) < 1e-9 ? 'on' : ''}
                onClick={() => onChange({ fxLot: p })}
              >
                {p.toFixed(2)}
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
          <h3>FX·금 · 벤티지 호가 보정</h3>
          <span className="panel-note">{appliedCount ? `${appliedCount}종목 적용` : '기본 0'}</span>
        </header>
        <p className="setting-desc block">
          비트겟 시세로 만든 시그널을 벤티지 MT5와 같은 가격으로 보기 위해 오프셋(호가 차이)을 넣는 곳입니다.
          한 번만 맞춰 두면 카드·공유카드의 현재가·진입·목표·EQ·무효가가 함께 이동하고, 손익비·R은 그대로 유지됩니다.
          값은 이 브라우저에 저장됩니다.
        </p>
        <div className="fx-table">
          <div className="fx-table-head">
            <span>종목</span>
            <span>비트겟</span>
            <span>오프셋</span>
            <span>MT5 현재가</span>
            <span>적용가</span>
            <span />
          </div>
          {fxRows.map((r) => {
            const off = offsetFor(r.label, offsets);
            return (
              <div className={`fx-tr${off ? ' on' : ''}`} key={r.label}>
                <span className="fx-td-label">
                  {r.priority ? '★ ' : ''}
                  {r.display ?? r.label}
                  {r.note ? <i>{r.note}</i> : null}
                </span>
                <span className="fx-td-price">{r.price != null ? fmtPrice(r.price, r.decimals) : '—'}</span>
                <span className="fx-td-offset">
                  <OffsetField label={r.label} value={off} onCommit={(v) => setOffset(r.label, v)} />
                  <b className={off ? (off > 0 ? 'up' : 'down') : ''}>{fmtOffset(off, r.decimals)}</b>
                </span>
                <span className="fx-td-vantage">
                  {r.price != null ? (
                    <VantageField
                      label={r.label}
                      price={r.price}
                      decimals={r.decimals}
                      onOffset={(v) => setOffset(r.label, v)}
                    />
                  ) : (
                    '—'
                  )}
                </span>
                <span className="fx-td-applied">{r.price != null ? fmtPrice(r.price + off, r.decimals) : '—'}</span>
                <span className="fx-td-reset">
                  {off ? (
                    <button type="button" className="ghost-btn small" onClick={() => setOffset(r.label, 0)}>
                      초기화
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
        {appliedCount > 0 && (
          <div className="setting-row compact">
            <div>
              <div className="setting-name">모든 종목 오프셋 지우기</div>
              <div className="setting-desc">벤티지 보정을 쓰지 않고 비트겟 원래 가격으로 돌아갑니다.</div>
            </div>
            <button className="ghost-btn" onClick={() => onChange({ fxOffsets: {} })}>
              전체 초기화
            </button>
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>Twelve Data (선택)</h3>
          <span className="panel-note">추가 FX 페어</span>
        </header>
        <p className="setting-desc block">
          비워 두면 비트겟 FX·금 피드만으로 그대로 동작합니다. 무료 키를 넣으면 AUD/USD·USD/CAD·USD/CHF·NZD/USD·
          EUR/JPY·GBP/JPY를 1H/4H로 함께 스캔합니다(분당 8회 제한 안에서 순차 요청, 4H는 1H에서 변환, 5분 캐시).
        </p>
        <div className="setting-row compact td-key-row">
          <div>
            <div className="setting-name">API 키</div>
            <div className="setting-desc">
              {settings.twelveDataKey ? '저장됨 — 이 기기의 localStorage에만 보관됩니다' : 'twelvedata.com에서 무료 발급'}
            </div>
          </div>
          <div className="td-key-edit">
            <input
              type="text"
              className="td-key-input"
              value={tdDraft}
              placeholder="Twelve Data API key"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setTdDraft(e.target.value)}
            />
            <button className="ghost-btn" onClick={() => onChange({ twelveDataKey: tdDraft.trim() })}>
              저장
            </button>
            {settings.twelveDataKey && (
              <button
                className="ghost-btn"
                onClick={() => {
                  setTdDraft('');
                  onChange({ twelveDataKey: '' });
                }}
              >
                삭제
              </button>
            )}
          </div>
        </div>
        <div className="update-status">
          {state.extra.status === 'off' && '키 없음 · 비트겟 실시간 FX·금 피드만 사용 중'}
          {state.extra.status === 'scanning' && `보조 페어 받는 중 ${state.extra.done}/${state.extra.total}`}
          {state.extra.status === 'ready' && `보조 페어 ${state.extra.total}건 반영 완료`}
          {state.extra.status === 'error' && `Twelve Data 오류: ${state.extra.error ?? '알 수 없음'}`}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h3>엔진 기준</h3>
        </header>
        <ul className="rule-list">
          <li>
            <b>전략 풀</b> CRT+FVG+CISD, Liquidity Sweep+OB, EMA20/50+RSI, BB 스퀴즈, EQ 장악형,
            SuperTrend/돈치안 — 6개 매매법
          </li>
          <li>
            <b>채택 기준</b> 최근 60봉 검증 승률 {MIN_WINRATE}% 이상 · 손익비 {MIN_RR}R 이상 · 표본 2건 이상
          </li>
          <li>
            <b>자동 교체</b> 기존 채택 전략이 기준 미달이면 현재 최고 성과 전략으로 즉시 전환하고 로그를 남깁니다
          </li>
          <li>
            <b>판정</b> 진입 이후 최대 42봉 안에 목표/무효 도달 여부로 적중·무효를 판정합니다
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
        본 스캐너는 비트겟 공개 시세 데이터를 계산해 과거 통계를 보여주는 정보 도구입니다. 투자 권유가 아니며,
        표시된 승률·수익률은 과거 데이터 기준으로 미래 성과를 보장하지 않습니다. 레버리지 거래는 원금 전액을
        잃을 수 있습니다.
      </p>
    </div>
  );
}

/** 오프셋 입력 — 타이핑 중 문자열 유지, 바깥 값이 바뀌면 따라감 */
function OffsetField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => {
    const parsed = Number(text.replace(',', '.'));
    const current = text.trim() === '' || !Number.isFinite(parsed) ? 0 : parsed;
    if (Math.abs(current - value) > 1e-12) setText(value ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      className="fx-offset-input"
      aria-label={`${label} 오프셋`}
      placeholder="0"
      value={text}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const n = Number(next.replace(',', '.'));
        onCommit(next.trim() === '' || !Number.isFinite(n) ? 0 : n);
      }}
    />
  );
}

/** 벤티지 MT5 현재가를 그대로 입력하면 오프셋 = MT5가 − 비트겟가 로 계산 (Enter/포커스 아웃) */
function VantageField({
  label,
  price,
  decimals,
  onOffset,
}: {
  label: string;
  price: number;
  decimals: number;
  onOffset: (v: number) => void;
}) {
  const [text, setText] = useState('');
  const commit = () => {
    const v = Number(text.replace(',', '.'));
    if (text.trim() && Number.isFinite(v) && v > 0) {
      onOffset(roundTo(v - price, Math.max(decimals, 2)));
      setText('');
    }
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      className="fx-vantage-input"
      aria-label={`${label} 벤티지 현재가로 오프셋 계산`}
      placeholder="MT5가 입력"
      value={text}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}
