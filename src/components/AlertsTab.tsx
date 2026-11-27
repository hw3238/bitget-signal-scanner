/**
 * 🎯 맞춤 알림 & 📊 경제지표 분석 센터 (v1.5.8)
 *
 *  한 화면에서
 *   ① 백그라운드 폰 알림 4종(시그널·지정가/지표·경제지표·뉴스)을 켜고 끈다
 *   ② 코인·조건·목표값을 넣어 지정가/RSI/펀딩 알림을 만든다(네이티브 AlertStore 로 즉시 동기화)
 *   ③ 미국 주요 지표의 예상치·이전치·근거·롱/숏 시나리오와 남은 시간을 본다
 *  · 앱이 꺼져 있어도 알림이 오는 것은 APK v1.5.8+ 의 AlertMonitorService 가 맡는다.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ScanState } from '../hooks/useScanner';
import type { Exchange } from '../lib/exchange';
import {
  ALERT_KINDS,
  ALERT_KIND_MAP,
  alertConditionText,
  activeAlerts,
  distancePct,
  fmtNum,
  fmtUsd,
  parseAlertInput,
  reactivateAlert,
  triggeredAlerts,
  type AlertKind,
  type CoinAlert,
} from '../engine/alerts';
import {
  CONSENSUS_AS_OF,
  MACRO_CATEGORY_LABEL,
  MACRO_CONTEXT,
  countsFor,
  countdownText,
  groupByDay,
  kstLabel,
  parseEventTime,
  starsText,
  upcomingEvents,
  verdictLabel,
  type MacroEvent,
} from '../engine/macroCalendar';
import type { useAlertCenter } from '../lib/alertBridge';
import { nativeAlertStatus, sendTestPhoneAlert } from '../lib/alertBridge';
import { isNativeApp, openExternalUrl } from '../lib/native';
import { APK_DOWNLOAD_URL } from '../lib/update';
import { MAJOR_COINS, PRIORITY_COINS } from '../engine/universe';

type Center = ReturnType<typeof useAlertCenter>;

interface Props {
  exchange: Exchange;
  state: ScanState;
  center: Center;
}

const MACRO_FILTERS = [
  { key: 'all', label: '전체' },
  { key: 'star3', label: '★★★' },
  { key: 'inflation', label: '물가' },
  { key: 'jobs', label: '고용' },
  { key: 'rates', label: '금리' },
] as const;
type MacroFilter = (typeof MACRO_FILTERS)[number]['key'];

const CHANNEL_META: Array<{
  key: 'signal' | 'custom' | 'macro' | 'news';
  emoji: string;
  title: string;
  desc: string;
  testKind: 'signal' | 'custom' | 'macro' | 'news';
}> = [
  { key: 'signal', emoji: '📈', title: '전략 시그널', desc: '앱을 꺼도 새 시그널을 감지해 알립니다', testKind: 'signal' },
  { key: 'custom', emoji: '🎯', title: '지정가 · 지표', desc: '내가 건 가격·RSI·펀딩 조건을 감시', testKind: 'custom' },
  { key: 'macro', emoji: '📊', title: '경제지표', desc: '발표 30분 전 예상치·롱숏 가이드', testKind: 'macro' },
  { key: 'news', emoji: '📰', title: '코인 뉴스', desc: '호재·악재 기사가 뜨면 속보', testKind: 'news' },
];

export function AlertsTab({ exchange, state, center }: Props) {
  const { alerts, settings, patchSettings, commit } = center;
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [kind, setKind] = useState<AlertKind>('price_above');
  const [value, setValue] = useState('');
  const [formNote, setFormNote] = useState('');
  const [formError, setFormError] = useState(false);
  const [filter, setFilter] = useState<MacroFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const muted = center.macroMuted;
  const [testNote, setTestNote] = useState('');
  const [service, setService] = useState<Awaited<ReturnType<typeof nativeAlertStatus>>>(null);
  const [now, setNow] = useState(Date.now());
  const native = isNativeApp();

  // 카운트다운은 30초마다 갱신
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // 네이티브 서비스 상태 — 화면이 열려 있는 동안 15초마다
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    const load = () => {
      void nativeAlertStatus().then((s) => {
        if (!cancelled) setService(s);
      });
    };
    load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [native]);

  /* ------------- 코인 목록 — 스캐너 티커(거래대금 순) + 주요 코인 ------------- */
  const coins = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ symbol: string; label: string; price?: number; vol?: number }> = [];
    const add = (sym: string, price?: number, vol?: number) => {
      if (seen.has(sym)) return;
      if (!/USDT$/.test(sym)) return;
      const base = sym.replace(/USDT$/, '');
      if (base.endsWith('STOCK') || /^(XAU|XAG|XPT|XPD|PAXG|XAUT|COPPER|CL|BZ|NATGAS|DXY|EURUSD|USDJPY|GBPUSD|NDX100|SP500|JP225|HSI|KR200|TMF)$/.test(base)) return;
      seen.add(sym);
      out.push({ symbol: sym, label: base, price, vol });
    };
    for (const sym of PRIORITY_COINS) add(sym, state.tickers.find((t) => t.symbol === sym)?.last);
    const crypto = state.tickers
      .filter((t) => /USDT$/.test(t.symbol))
      .sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
    for (const t of crypto) add(t.symbol, t.last, t.quoteVolume);
    for (const sym of MAJOR_COINS) add(sym, state.tickers.find((t) => t.symbol === sym)?.last);
    return out.slice(0, 60);
  }, [state.tickers]);

  const currentPrice = coins.find((c) => c.symbol === symbol)?.price;
  const kindMeta = ALERT_KIND_MAP[kind];

  const submit = () => {
    const parsed = parseAlertInput(symbol, kind, value, { price: currentPrice });
    if (!parsed.ok || !parsed.alert) {
      setFormError(true);
      setFormNote(parsed.error ?? '입력값을 확인하세요.');
      return;
    }
    const exists = alerts.some((a) => a.id === parsed.alert!.id && !a.triggeredAt);
    const { list, added } = addAlertSafe(alerts, parsed.alert);
    commit(list);
    setFormError(false);
    setFormNote(
      exists
        ? '이미 같은 조건이 감시 중입니다 — 목록에서 확인하세요.'
        : added
          ? `추가됨 · ${alertConditionText(parsed.alert)}`
          : `다시 감시를 시작했습니다 · ${alertConditionText(parsed.alert)}`,
    );
    setValue('');
  };

  const active = activeAlerts(alerts);
  const done = triggeredAlerts(alerts);

  const events = useMemo(() => upcomingEvents(now, 120), [now]);
  const filtered = useMemo(() => {
    if (filter === 'all') return events;
    if (filter === 'star3') return events.filter((e) => e.stars === 3);
    return events.filter((e) => e.category === filter);
  }, [events, filter]);
  const grouped = useMemo(() => groupByDay(filtered), [filtered]);

  const channelOn = center.channels;

  return (
    <div className="alerts-tab" data-alerts-tab>
      {/* ---------------- ① 백그라운드 알림 설정 ---------------- */}
      <section className="panel alerts-master" data-alert-master>
        <header className="panel-head">
          <h3>🔔 백그라운드 폰 알림</h3>
          <span className={`alerts-service ${service?.running ? 'on' : ''}`}>
            {!native
              ? '웹 · 앱 알림은 APK에서'
              : service?.supported === false
                ? 'APK 업데이트 필요'
                : service?.running
                  ? `감시 중 · ${service.checked ?? 0}건 확인`
                  : settings.master
                    ? '서비스 대기'
                    : '꺼짐'}
          </span>
        </header>
        <div className="alerts-master-row">
          <div>
            <b>앱을 꺼도 알림 받기</b>
            <span>
              켜면 COTA를 실행하지 않아도 60~120초마다 조건을 확인해 폰 상단바로 알립니다. 자동매매와 별개로
              동작합니다.
            </span>
          </div>
          <button
            type="button"
            className={`switch ${settings.master ? 'on' : ''}`}
            aria-label="백그라운드 폰 알림 마스터"
            aria-pressed={settings.master}
            data-alert-master-switch
            onClick={() => patchSettings({ master: !settings.master })}
          >
            <span />
          </button>
        </div>
        <div className="alerts-channels">
          {CHANNEL_META.map((ch) => {
            const on = channelOn[ch.key];
            return (
              <div key={ch.key} className={`alerts-channel ${on ? 'on' : ''}`} data-alert-channel={ch.key}>
                <div className="alerts-channel-head">
                  <span className="alerts-channel-emoji">{ch.emoji}</span>
                  <b>{ch.title}</b>
                  <button
                    type="button"
                    className={`switch small ${on ? 'on' : ''}`}
                    aria-label={`${ch.title} 알림 켜기/끄기`}
                    aria-pressed={on}
                    disabled={!settings.master}
                    onClick={() => patchSettings({ [ch.key]: !settings[ch.key] } as never)}
                  >
                    <span />
                  </button>
                </div>
                <p>{ch.desc}</p>
                <button
                  type="button"
                  className="alerts-test-btn"
                  onClick={async () => {
                    const ok = native
                      ? (await sendTestPhoneAlert(ch.testKind)) || false
                      : (await sendTestPhoneAlert(ch.testKind)) || false;
                    setTestNote(
                      ok
                        ? `${ch.title} 테스트 알림을 보냈습니다. 폰 상단(알림바)을 확인하세요.`
                        : '웹에서는 브라우저 알림으로 표시됩니다. 앱(APK)에서 폰 상단 알림이 동작합니다.',
                    );
                  }}
                >
                  테스트 알림
                </button>
              </div>
            );
          })}
        </div>
        {!settings.master && (
          <div className="alerts-hint">마스터가 꺼져 있으면 개별 알림도 나가지 않습니다.</div>
        )}
        {native && service?.supported === false && (
          <div className="alerts-hint warn">
            설치된 앱이 백그라운드 알림을 지원하지 않습니다 — v1.5.8 APK로 업데이트하면 켜집니다.
            <button type="button" className="ghost-btn" onClick={() => void openExternalUrl(APK_DOWNLOAD_URL)}>
              APK 받기
            </button>
          </div>
        )}
        {testNote && <div className="alerts-note">{testNote}</div>}
      </section>

      {/* ---------------- ② 지정가 · 지표 맞춤 알림 ---------------- */}
      <section className="panel" data-alert-custom>
        <header className="panel-head">
          <h3>🎯 지정가 · 지표 맞춤 알림</h3>
          <span className="panel-note">
            {active.length}건 감시 · {done.length}건 완료
          </span>
        </header>
        <div className="alert-form">
          <label className="alert-field">
            <span>코인</span>
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)} data-alert-symbol>
              {coins.map((c) => (
                <option key={c.symbol} value={c.symbol}>
                  {c.label}
                  {c.price ? ` · ${fmtUsd(c.price)}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="alert-field">
            <span>조건</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as AlertKind)} data-alert-kind>
              {ALERT_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.short} · {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="alert-field grow">
            <span>{kindMeta.unit === 'usd' ? '목표 가격($)' : kindMeta.unit === 'rsi' ? 'RSI 기준' : '펀딩 기준(%)'}</span>
            <input
              type="text"
              inputMode="decimal"
              value={value}
              placeholder={
                kindMeta.unit === 'usd'
                  ? currentPrice
                    ? String(Math.round(currentPrice * (kind === 'price_above' ? 1.05 : 0.95) * 100) / 100)
                    : '예: 95000'
                  : kindMeta.unit === 'rsi'
                    ? kind === 'rsi_over'
                      ? '70'
                      : '30'
                    : '0.1'
              }
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              data-alert-value
            />
          </label>
          <button type="button" className="primary-btn alert-add" onClick={submit} data-alert-add>
            알림 추가
          </button>
        </div>
        <div className="alert-form-help">
          {currentPrice ? `${symbol.replace(/USDT$/, '')} 현재 ${fmtUsd(currentPrice)}` : `${exchange} 시세 대기 중`}
          {' · '}
          {kindMeta.desc}
        </div>
        {formNote && <div className={`alerts-note ${formError ? 'warn' : ''}`} data-alert-form-note>{formNote}</div>}

        {active.length > 0 && (
          <div className="alert-list" data-alert-active-list>
            {active.map((a) => (
              <AlertRow key={a.id} alert={a} price={currentPriceFor(a.symbol, state)} onDelete={() => commit(alerts.filter((x) => x.id !== a.id))} />
            ))}
          </div>
        )}
        {active.length === 0 && (
          <div className="alerts-empty">
            아직 감시 중인 조건이 없습니다 — 위에서 코인·조건·값을 넣고 <b>알림 추가</b>를 누르세요.
          </div>
        )}

        {done.length > 0 && (
          <details className="alert-done" open={false}>
            <summary>발동 완료 {done.length}건</summary>
            <div className="alert-list">
              {done.map((a) => (
                <div key={a.id} className="alert-row done" data-alert-done-row>
                  <div className="alert-row-copy">
                    <b>{alertConditionText(a)}</b>
                    <span>
                      {a.triggeredAt ? `${new Date(a.triggeredAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 발동` : '발동'}
                      {a.triggerActual ? ` · 실제 ${fmtActual(a)}` : ''}
                    </span>
                  </div>
                  <div className="alert-row-actions">
                    <button type="button" className="ghost-btn" onClick={() => commit(reactivateAlert(alerts, a.id))}>
                      다시 감시
                    </button>
                    <button type="button" className="ghost-btn danger" onClick={() => commit(alerts.filter((x) => x.id !== a.id))}>
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* ---------------- ③ 경제지표 분석 센터 ---------------- */}
      <section className="panel macro-center" data-macro-center>
        <header className="panel-head">
          <h3>📊 경제지표 · 예상치 분석</h3>
          <span className="panel-note">컨센서스 {CONSENSUS_AS_OF} 기준 · KST</span>
        </header>

        <div className="macro-context">
          <div className="macro-context-row">
            <span>기준금리</span>
            <b>{MACRO_CONTEXT.policyRate}</b>
            <em>{MACRO_CONTEXT.nextMove}</em>
          </div>
          <div className="macro-context-row">
            <span>물가</span>
            <b>{MACRO_CONTEXT.inflation}</b>
          </div>
          <div className="macro-context-row">
            <span>고용</span>
            <b>{MACRO_CONTEXT.jobs}</b>
          </div>
          <div className="macro-context-row">
            <span>코인</span>
            <b>{MACRO_CONTEXT.crypto}</b>
          </div>
          <div className="macro-context-rule">💡 {MACRO_CONTEXT.rule}</div>
        </div>

        <div className="macro-toolbar">
          <div className="segmented macro-filter">
            {MACRO_FILTERS.map((f) => (
              <button
                key={f.key}
                className={filter === f.key ? 'on' : ''}
                onClick={() => setFilter(f.key)}
                data-macro-filter={f.key}
              >
                {f.label}
                <i>{countsFor(events, f.key)}</i>
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`switch labeled ${settings.macro && settings.master ? 'on' : ''}`}
            aria-pressed={settings.macro && settings.master}
            onClick={() => patchSettings({ macro: !settings.macro })}
            data-macro-alert-toggle
          >
            <span />
            <b>30분 전 알림</b>
          </button>
        </div>

        <div className="macro-list" data-macro-list>
          {grouped.map((g) => (
            <div key={g.day} className="macro-day">
              <div className="macro-day-label">
                {g.day.replace(/-/g, '.')} · {['일', '월', '화', '수', '목', '금', '토'][new Date(`${g.day}T00:00:00+09:00`).getDay()]}
              </div>
              {g.events.map((e) => (
                <MacroCard
                  key={e.id}
                  event={e}
                  now={now}
                  open={openId === e.id}
                  onToggle={() => setOpenId(openId === e.id ? null : e.id)}
                  muted={muted.includes(e.id)}
                  onMute={() => center.toggleMacroMute(e.id)}
                />
              ))}
            </div>
          ))}
        </div>
        {grouped.length === 0 && <div className="alerts-empty">조건에 맞는 지표가 없습니다.</div>}

        <div className="macro-foot">
          예상치는 발표 전까지 바뀝니다. 방향(상회=숏 / 하회=롱)을 먼저 보고, 숫자는 참고하세요. 투자 권유가
          아닙니다.
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AlertRow({ alert, price, onDelete }: { alert: CoinAlert; price?: number; onDelete: () => void }) {
  const dist = alert.kind === 'price_above' || alert.kind === 'price_below' ? distancePct(alert.value, price) : null;
  return (
    <div className="alert-row" data-alert-row>
      <div className="alert-row-copy">
        <b>{alertConditionText(alert)}</b>
        <span>
          {ALERT_KIND_MAP[alert.kind].desc}
          {dist !== null ? ` · 현재 대비 ${dist > 0 ? '+' : ''}${fmtNum(dist, 1)}%` : ''}
        </span>
      </div>
      <div className="alert-row-actions">
        <span className="alert-live-dot" aria-label="감시 중" />
        <button type="button" className="ghost-btn danger" onClick={onDelete} aria-label="알림 삭제">
          삭제
        </button>
      </div>
    </div>
  );
}

function MacroCard({
  event,
  now,
  open,
  onToggle,
  muted,
  onMute,
}: {
  event: MacroEvent;
  now: number;
  open: boolean;
  onToggle: () => void;
  muted: boolean;
  onMute: () => void;
}) {
  const inline = verdictLabel(event.inline.verdict);
  const above = verdictLabel(event.above.verdict);
  const below = verdictLabel(event.below.verdict);
  const soon = parseEventTime(event.at) - now <= 60 * 60_000;
  return (
    <article className={`macro-card ${open ? 'open' : ''} ${soon ? 'soon' : ''}`} data-macro-event={event.id}>
      <button type="button" className="macro-card-head" onClick={onToggle} aria-expanded={open}>
        <span className="macro-time">{kstLabel(event)}</span>
        <span className="macro-main">
          <b>
            {event.name} <i className={`macro-tag ${event.category}`}>{MACRO_CATEGORY_LABEL[event.category]}</i>
          </b>
          <span className="macro-sub">
            {starsText(event.stars)} · 예상 {event.consensus} · 이전 {event.previous}
          </span>
        </span>
        <span className="macro-countdown" data-macro-countdown>
          {countdownText(event, now)}
        </span>
        <span className={`macro-verdict ${inline.tone}`}>{inline.text}</span>
      </button>
      <div className="macro-scenario-strip">
        <span className={`macro-chip ${above.tone}`}>상회 → {plainVerdict(above.text)}</span>
        <span className={`macro-chip ${below.tone}`}>하회 → {plainVerdict(below.text)}</span>
        <button
          type="button"
          className={`macro-bell ${muted ? 'off' : 'on'}`}
          onClick={(e) => {
            e.stopPropagation();
            onMute();
          }}
          aria-label="이 지표 30분 전 알림 켜기/끄기"
          data-macro-bell
        >
          {muted ? '🔕' : '🔔'}
        </button>
      </div>
      {open && (
        <div className="macro-detail">
          <div className="macro-block">
            <h4>왜 이 예상치인가</h4>
            <ul>
              {event.consensusBasis.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="macro-trend">최근 추세 — {event.trend}</p>
          </div>
          <div className="macro-block">
            <h4>결과별 롱 / 숏</h4>
            {[event.above, event.inline, event.below].map((s) => {
              const v = verdictLabel(s.verdict);
              return (
                <div key={s.label} className={`macro-scenario ${v.tone}`}>
                  <b>
                    {s.label} <i>{v.text}</i> <em>확신 {s.strength}</em>
                  </b>
                  <p>{s.text}</p>
                </div>
              );
            })}
          </div>
          <div className="macro-block playbook">
            <h4>대응 요령</h4>
            <p>{event.playbook}</p>
            <p className="macro-source">출처 · {event.source}</p>
          </div>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */

/** '🔴 숏 유리' → '숏 유리' (이모지는 첫 토큰) */
function plainVerdict(text: string): string {
  const parts = text.split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : text;
}

function currentPriceFor(symbol: string, state: ScanState): number | undefined {
  return state.tickers.find((t) => t.symbol === symbol)?.last;
}

function fmtActual(a: CoinAlert): string {
  if (a.kind === 'price_above' || a.kind === 'price_below') return fmtUsd(a.triggerActual ?? a.value);
  if (a.kind === 'funding_hot') return `${fmtNum(a.triggerActual ?? a.value, 3)}%`;
  return fmtNum(a.triggerActual ?? a.value, 1);
}

function addAlertSafe(list: CoinAlert[], alert: CoinAlert): { list: CoinAlert[]; added: boolean } {
  const idx = list.findIndex((a) => a.id === alert.id);
  if (idx < 0) return { list: [alert, ...list].slice(0, 60), added: true };
  const next = list.slice();
  next[idx] = { ...list[idx], triggeredAt: undefined, triggerActual: undefined, createdAt: alert.createdAt };
  return { list: next, added: false };
}


