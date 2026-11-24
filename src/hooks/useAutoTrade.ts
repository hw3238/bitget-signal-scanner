/**
 * 🤖 비트겟 자동매매 상태 훅.
 *
 *  - 설정·로그·중복 진입 키는 이 브라우저(localStorage)에 남는다.
 *  - 실제 주문·감시는 앱(안드로이드) 네이티브가 맡는다. 브라우저에서는 같은 규칙으로
 *    **모의 시뮬레이션**만 돌려, 어떤 시그널이 왜 통과/거부됐는지 로그로 확인할 수 있다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Contract, Signal } from '../engine/types';
import { accountBaseOf } from '../lib/account';
import { formatBitgetErrorKo } from '../lib/bitgetErrors';
import {
  DEFAULTS,
  IDLE_REFRESH_MS,
  LIVE_REFRESH_MS,
  LOG_LIMIT,
  SNAPSHOT_FRESH_MS,
  applyDailyReset,
  buildOrderParams,
  checkDailyLoss,
  clientOidFor,
  dayKeyKst,
  emptyRuntime,
  evaluateEntry,
  fmtUsdt,
  markTraded,
  mergeArmedPlans,
  normalizeConfig,
  normalizePosMode,
  planAutoOrder,
  planDailyReset,
  priceText,
  pushLog,
  resolveTradeMode,
  rollDay,
  signalKeyOf,
  symbolAllowed,
  toArmedPlan,
  type ArmedPlan,
  type AutoLogEntry,
  type AutoRuntime,
  type AutoTradeConfig,
  type EntryDecision,
  type PlaceOrderParams,
} from '../lib/autotrade';
import { accountKindLabel } from '../lib/bitgetUta';
import {
  autoTradeResetDailyLimit,
  autoTradeStart,
  autoTradeStatus,
  autoTradeStop,
  autoTradeSupported,
  autoTradeSync,
  bitgetClearKeys,
  bitgetBridgeAvailable,
  bitgetClosePosition,
  bitgetKeyState,
  bitgetPlaceOrder,
  bitgetPositions,
  bitgetSaveKeys,
  bitgetTestConnection,
  onAutoTradeEvent,
  type AutoTradeNativeStatus,
  type BitgetAccount,
  type BitgetKeyState,
  type BitgetPosition,
} from '../lib/native';

const CONFIG_KEY = 'cota.autotrade.config.v1';
const RUNTIME_KEY = 'cota.autotrade.runtime.v1';

/** 네이티브가 남긴 자동 보정 기록 → ` (자동 보정: 호가 단위 보정 · …)` */
function recoveryText(recovery?: string[] | null): string {
  if (!recovery || !recovery.length) return '';
  return ` (자동 보정: ${recovery.join(' · ')})`;
}

function readConfig(): AutoTradeConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return normalizeConfig(raw ? (JSON.parse(raw) as Partial<AutoTradeConfig>) : DEFAULTS);
  } catch {
    return normalizeConfig(DEFAULTS);
  }
}

function readRuntime(): AutoRuntime {
  try {
    const raw = localStorage.getItem(RUNTIME_KEY);
    if (!raw) return emptyRuntime(Date.now());
    const parsed = JSON.parse(raw) as Partial<AutoRuntime>;
    const base = emptyRuntime(Date.now());
    return {
      ...base,
      ...parsed,
      logs: Array.isArray(parsed.logs) ? parsed.logs.slice(0, LOG_LIMIT) : [],
      tradedKeys: Array.isArray(parsed.tradedKeys) ? parsed.tradedKeys.slice(-200) : [],
    };
  } catch {
    return emptyRuntime(Date.now());
  }
}

interface UseAutoTradeInput {
  signals: Signal[];
  contracts: Contract[];
  /** 시그널별 적용 배율 (COTA 추천 / 고정) */
  leverageFor: (signal: Signal) => number;
}

export interface QuickOrderResult {
  ok: boolean;
  message: string;
  simulated: boolean;
}

export function useAutoTrade({ signals, contracts, leverageFor }: UseAutoTradeInput) {
  const [config, setConfig] = useState<AutoTradeConfig>(readConfig);
  const [runtime, setRuntime] = useState<AutoRuntime>(readRuntime);
  const [keys, setKeysState] = useState<BitgetKeyState & { supported: boolean }>({
    supported: autoTradeSupported(),
    hasKeys: false,
    demo: true,
  });
  const [account, setAccount] = useState<BitgetAccount | null>(null);
  const [positions, setPositions] = useState<BitgetPosition[]>([]);
  const [native, setNative] = useState<AutoTradeNativeStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** 설치된 APK가 v1.5.0 미만이라 자동매매 브리지가 없는 상태 */
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  /** 마지막으로 잔고를 실제로 받아온 시각 — 화면의 `방금 전 / HH:MM:SS` 표시 */
  const [lastRefreshAt, setLastRefreshAt] = useState(0);
  /** 자동매매 화면이 열려 있는 동안만 실시간 잔고 갱신을 켠다 */
  const [liveRefresh, setLiveRefresh] = useState(false);
  /** 중복 요청 방지 — 12초 주기와 포그라운드 복귀가 겹쳐도 한 번만 조회한다 */
  const refreshGuard = useRef({ busy: false, round: 0 });

  const supported = autoTradeSupported();
  /**
   * 실제 거래 모드 — 저장된 키가 기준이다. `config.mode` 는 사용자가 고른 희망값일 뿐이고,
   * 모의투자 키로 실거래를 고르거나 실거래 키로 모의투자를 고르면 라벨과 다른 주문이 나간다.
   */
  const tradeMode = useMemo(() => resolveTradeMode(config, keys), [config, keys]);

  /**
   * 🔗 v1.5.5 — 모든 시그널·주문 계산의 기준이 되는 **실계좌 잔고**.
   *  · 자동매매 화면이 닫혀 있어도(스캐너 탭) 이 훅이 앱 수준에서 돌기 때문에 잔고가 유지된다.
   *  · 키가 없거나 잔고를 못 읽으면 seed 0 = 계산 불가.
   */
  const accountBase = useMemo(
    () =>
      accountBaseOf({
        hasKeys: keys.hasKeys,
        equity: account?.equity ?? native?.equity ?? null,
        available: account?.available ?? native?.available ?? null,
        unrealizedPL: account?.unrealizedPL ?? native?.unrealizedPL ?? null,
        updatedAt: lastRefreshAt || native?.lastTickAt || 0,
        demo: keys.demo,
      }),
    [
      account?.available,
      account?.equity,
      account?.unrealizedPL,
      keys.demo,
      keys.hasKeys,
      lastRefreshAt,
      native?.available,
      native?.equity,
      native?.lastTickAt,
      native?.unrealizedPL,
    ],
  );
  const contractBySymbol = useMemo(() => {
    const map = new Map<string, Contract>();
    for (const c of contracts) map.set(c.symbol, c);
    return map;
  }, [contracts]);

  const specFor = useCallback(
    (symbol: string) => {
      const c = contractBySymbol.get(symbol);
      if (!c) return null;
      return {
        minTradeNum: c.minTradeNum,
        volumePlace: c.volumePlace,
        minTradeUsdt: c.minTradeUsdt,
        sizeMultiplier: c.sizeMultiplier,
      };
    },
    [contractBySymbol],
  );

  /** 로그 · 상태 저장 */
  const log = useCallback((entry: AutoLogEntry) => {
    setRuntime((prev) => pushLog(prev, entry));
  }, []);

  useEffect(() => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    localStorage.setItem(RUNTIME_KEY, JSON.stringify(runtime));
  }, [runtime]);

  /** 감시 주기마다 화면의 '마지막 확인' 시간을 갱신 */
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 5000);
    return () => window.clearInterval(id);
  }, []);

  /* ---------------- 키 · 계좌 ---------------- */

  const refreshKeys = useCallback(async () => {
    const available = await bitgetBridgeAvailable();
    setBridgeMissing(!available);
    const state = await bitgetKeyState();
    setKeysState(state);
    return state;
  }, []);

  const testConnection = useCallback(async () => {
    if (!supported) {
      setError('브라우저에서는 실제 계좌 연결을 시험할 수 없습니다. COTA 안드로이드 앱(v1.5.0+)에서 사용하세요.');
      return null;
    }
    setBusy('test');
    setError(null);
    const res = await bitgetTestConnection();
    setBusy(null);
    if (!res) {
      setError('네이티브 연결에 실패했습니다.');
      return null;
    }
    setAccount(res);
    if (res.ok) {
      const equity = res.equity ?? 0;
      // 기준선은 네이티브가 저장한 오늘 값을 따른다 — 웹이 옛 값으로 다시 잠그는 일을 막는다(v1.5.4).
      const baseline = Number(res.dayStartEquity ?? 0);
      setRuntime((prev) => {
        const rolled = rollDay(prev, Date.now(), equity);
        return baseline > 0 ? { ...rolled, dayStartEquity: baseline } : rolled;
      });
      log({
        at: Date.now(),
        level: 'info',
        text: `계좌 연결 확인 — ${res.demo ? '모의투자' : '실거래'} · ${accountKindLabel(res.accountMode)} · USDT ${fmtUsdt(
          equity,
        )} · 포지션 모드 ${normalizePosMode(res.posMode) === 'hedge_mode' ? '헤지' : '단방향'}`,
      });
    } else {
      setError(res.error ?? '키를 확인해 주세요.');
    }
    return res;
  }, [log, supported]);

  const saveKeys = useCallback(
    async (input: { apiKey: string; secret: string; passphrase: string; demo: boolean }) => {
      if (!supported) {
        setError('브라우저에서는 키를 저장할 수 없습니다. COTA 안드로이드 앱(v1.5.0+)에서 연결하세요.');
        return false;
      }
      if (!input.apiKey.trim() || !input.secret.trim() || !input.passphrase.trim()) {
        setError('API Key · Secret · Passphrase를 모두 입력해 주세요.');
        return false;
      }
      setBusy('save');
      setError(null);
      const res = await bitgetSaveKeys(input);
      setBusy(null);
      if (res.error) {
        setError(res.error);
        return false;
      }
      // ★ passphraseSet·secretSet·accountMode 를 빠뜨리면 저장 직후 화면이 `Passphrase: —` 로 바뀐다(v1.5.1 수정).
      setKeysState({ ...res, supported: true });
      setConfig((prev) => ({ ...prev, mode: input.demo ? 'demo' : 'live' }));
      log({
        at: Date.now(),
        level: 'info',
        text: `API 키 저장 완료 (${input.demo ? '모의투자' : '실거래'}) — 키는 기기 안에만 저장됩니다.`,
      });
      // 새 키 = 새 계좌 → 옛 계좌의 기준선은 버리고, 연결 확인에서 새 잔고로 다시 잡는다.
      setRuntime((prev) => ({ ...prev, dayStartEquity: null }));
      await testConnection();
      return true;
    },
    [log, supported, testConnection],
  );

  const forgetKeys = useCallback(async () => {
    setBusy('clear');
    const res = await bitgetClearKeys();
    setBusy(null);
    setKeysState(res);
    setAccount(null);
    setPositions([]);
    if (config.enabled) await autoTradeStop();
    setConfig((prev) => ({ ...prev, enabled: false }));
    setNative(null);
    setRuntime((prev) => ({ ...prev, dayStartEquity: null }));
    log({ at: Date.now(), level: 'info', text: 'API 키를 삭제하고 자동매매를 껐습니다.' });
  }, [config.enabled, log]);

  const refreshPositions = useCallback(async () => {
    if (!supported || !keys.hasKeys) return [];
    const res = await bitgetPositions();
    if (res.ok) {
      setPositions(res.positions);
      setRuntime((prev) => ({ ...prev, openPositions: res.positions.length }));
    }
    return res.positions;
  }, [keys.hasKeys, supported]);

  /* ---------------- 안전장치 상태 ---------------- */

  const daily = useMemo(() => {
    const locked = native?.dailyLocked === true;
    if (locked) {
      return { pnlUsd: native?.dailyPnl ?? 0, pnlPct: 0, limitUsd: 0, locked: true, remainingUsd: 0 };
    }
    // 잔고는 **방금 조회한 계좌**를 먼저 쓴다 — 네이티브 스냅숏은 서비스가 30초 주기로 쓴 값이다.
    return checkDailyLoss({
      dayStartEquity: runtime.dayStartEquity ?? native?.dayStartEquity ?? null,
      equity: account?.equity ?? native?.equity ?? null,
      dailyLossPct: config.dailyLossPct,
    });
  }, [
    account?.equity,
    config.dailyLossPct,
    native?.dailyLocked,
    native?.dailyPnl,
    native?.dayStartEquity,
    native?.equity,
    runtime.dayStartEquity,
  ]);

  const openPositions = native?.openPositions ?? positions.length;
  const running = supported ? native?.running === true : config.enabled;
  /** 보유 중인 종목 — 같은 종목에 또 들어가면 수량이 겹쳐 리스크가 2배가 된다 */
  const openSymbols = useMemo(() => positions.map((p) => p.symbol), [positions]);
  /**
   * 조기 손절 판단용 — 진행 중 시그널의 최소 정보만 네이티브에 넘긴다(v1.5.4).
   * 네이티브는 '포지션을 연 뒤 같은 종목에 반대 방향 시그널'이 생겼을 때 SL 전에 청산한다.
   */
  const exitSignals = useMemo(
    () =>
      signals
        .filter((s) => s.state === 'open' && s.asset !== 'fx')
        .slice(0, 40)
        .map((s) => ({ symbol: s.symbol, side: s.side, tf: s.tf, detectedAt: s.detectedAt })),
    [signals],
  );

  /* ---------------- 웹 → 서비스 감시 목록 ---------------- */

  const buildPlans = useCallback(
    (
      list: Signal[],
      now: number,
      override?: AutoTradeConfig,
    ): { plans: ArmedPlan[]; decisions: Array<{ signal: Signal; decision: EntryDecision }> } => {
      const cfg = override ?? config;
      const seed = accountBase.seed;
      const decisions: Array<{ signal: Signal; decision: EntryDecision }> = [];
      const plans: ArmedPlan[] = [];
      if (!(seed > 0)) return { plans, decisions };
      for (const signal of list) {
        if (signal.asset === 'fx') continue;
        if (signal.state !== 'open') continue;
        if (!symbolAllowed(cfg, signal.symbol)) continue;
        const plan = planAutoOrder({
          signal,
          seed,
          config: cfg,
          leverage: leverageFor(signal),
          spec: specFor(signal.symbol),
          available: accountBase.available,
        });
        const decision = evaluateEntry({
          config: cfg,
          signal,
          tradedKeys: runtime.tradedKeys,
          openPositions,
          openSymbols,
          dailyLocked: daily.locked,
          plan,
          now,
          hasKeys: keys.hasKeys || !supported,
        });
        decisions.push({ signal, decision });
        if (decision.allowed) {
          // 감시 항목에 호가 배수로 맞춘 TP/SL 문자열을 실어 보낸다 — 네이티브가 그대로 주문에 쓴다(45115 방지).
          const contract = contractBySymbol.get(signal.symbol);
          plans.push(
            toArmedPlan({
              signal,
              plan,
              now,
              ttlMin: cfg.entryTtlMin,
              pricePlace: contract?.decimals ?? null,
              priceEndStep: contract?.priceEndStep ?? 1,
            }),
          );
        }
      }
      return { plans, decisions };
    },
    [
      accountBase.available,
      accountBase.seed,
      config,
      contractBySymbol,
      daily.locked,
      keys.hasKeys,
      leverageFor,
      openPositions,
      openSymbols,
      runtime.tradedKeys,
      specFor,
      supported,
    ],
  );

  /** 브라우저 모의 시뮬레이션 — 같은 게이트를 태우고 통과분을 '체결'로 기록 */
  const simulate = useCallback((override?: AutoTradeConfig): EntryDecision[] => {
    const now = Date.now();
    const seed = accountBase.seed;
    if (!(seed > 0)) {
      log({
        at: now,
        level: 'info',
        text: '실계좌 잔고가 없어 계산할 수 없습니다 — 메뉴 → 비트겟 자동매매에서 API 키를 연결하면 실시간 잔고 기준으로 시뮬레이션합니다.',
      });
      return [];
    }
    const { plans, decisions } = buildPlans(signals, now, override);
    if (!decisions.length) {
      log({ at: now, level: 'info', text: '시뮬레이션: 평가할 진행 중 시그널이 없습니다.' });
      return [];
    }
    setRuntime((prev) => {
      let next = prev;
      for (const { signal, decision } of decisions.slice(0, 6)) {
        if (!decision.allowed) {
          next = pushLog(next, {
            at: now,
            level: decision.code === 'daily-locked' || decision.code === 'max-positions' ? 'block' : 'reject',
            text: `[모의] ${signal.base} ${signal.side === 'long' ? '롱' : '숏'} 거부 — ${decision.reason}`,
            symbol: signal.symbol,
            side: signal.side,
          });
          continue;
        }
        const plan = plans.find((p) => p.key === signalKeyOf(signal));
        next = pushLog(next, {
          at: now,
          level: 'fill',
          text: `[모의 체결] ${signal.base} ${signal.side === 'long' ? '롱' : '숏'} ${plan?.qty ?? ''} @ ${signal.entry} · TP ${signal.target} / SL ${signal.stop}`,
          symbol: signal.symbol,
          side: signal.side,
        });
        next = markTraded(next, signalKeyOf(signal));
      }
      return next;
    });
    return decisions.map((d) => d.decision);
  }, [accountBase.seed, buildPlans, log, signals]);

  /* ---------------- 시작 · 정지 ---------------- */

  const applyNative = useCallback((status: AutoTradeNativeStatus | null) => {
    setNative(status);
    if (!status) return;
    // 1일 손실 한도로 서비스가 스스로 꺼졌으면 웹 설정도 같이 꺼야 배지·토글이 맞는다.
    if (status.enabled === false) {
      setConfig((prev) => (prev.enabled ? { ...prev, enabled: false } : prev));
    }
    // ★ 서비스가 잡은 오늘 기준선을 웹도 그대로 쓴다.
    //   초기화 후 웹이 옛 기준선을 들고 있으면 켜자마자 다시 '한도 도달'로 꺼지는 버그가 난다(v1.5.4).
    const baseline = Number(status.dayStartEquity ?? 0);
    if (baseline > 0 && (!status.dayKey || status.dayKey === dayKeyKst(Date.now()))) {
      setRuntime((prev) => (prev.dayStartEquity === baseline ? prev : { ...prev, dayStartEquity: baseline }));
    }
    if (typeof status.openPositions === 'number') {
      setRuntime((prev) => ({ ...prev, openPositions: status.openPositions ?? prev.openPositions }));
    }
    const incoming = status.log ?? [];
    if (incoming.length) {
      setRuntime((prev) => {
        let next = prev;
        for (const item of [...incoming].reverse()) {
          const at = Number(item.at) || Date.now();
          const text = String(item.text ?? '');
          if (!text) continue;
          if (next.logs.some((l) => l.at === at && l.text === text)) continue;
          const level = item.level as AutoLogEntry['level'];
          next = pushLog(next, {
            at,
            level: ['fill', 'reject', 'block', 'exit', 'info', 'error'].includes(level) ? level : 'info',
            text,
          });
        }
        return next;
      });
    }
  }, []);

  /* ---------------- 실시간 잔고 갱신 (v1.5.4) ---------------- */

  /**
   * 계좌 잔고·가용·미실현 손익을 지금 새로 읽는다.
   *  · 네이티브 status(저장된 스냅숏)는 공짜지만 서비스가 30초 주기로만 쓴다.
   *  · 서비스가 돌고 있고 스냅숏이 신선하면 그것을 쓰고, 아니면 계좌를 직접 조회한다.
   */
  const refreshAccount = useCallback(async (): Promise<BitgetAccount | null> => {
    if (!supported || !keys.hasKeys) return null;
    const status = await autoTradeStatus();
    const snapshotFresh =
      status?.running === true &&
      typeof status.lastTickAt === 'number' &&
      Date.now() - status.lastTickAt < SNAPSHOT_FRESH_MS &&
      Number(status.equity ?? 0) > 0;
    if (status) applyNative(status);
    const res = await bitgetTestConnection();
    if (!res) {
      setError('네이티브 연결에 실패했습니다.');
      return null;
    }
    if (res.ok) {
      setAccount(res);
      setLastRefreshAt(Date.now());
    } else if (!snapshotFresh) {
      // 스냅숏도 없이 조회까지 실패했을 때만 빨간 안내를 띄운다(주기 갱신이 화면을 오류로 덮지 않게).
      setError(res.error ?? '잔고를 불러오지 못했습니다.');
    }
    return res;
  }, [applyNative, keys.hasKeys, supported]);

  /**
   * 1일 손실 한도 초기화 — 지금 계좌 잔고를 오늘의 기준선으로 다시 잡고 잠금을 푼다.
   * 네이티브는 계좌를 새로 조회해 저장하므로, 초기화 직후 켜도 옛 기준선으로 다시 잠기지 않는다.
   */
  const resetDailyLimit = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    const now = Date.now();
    setBusy('reset');
    setError(null);
    try {
      if (supported && keys.hasKeys) {
        const res = await autoTradeResetDailyLimit();
        if (res?.ok) {
          const equity = Number(res.dayStartEquity ?? res.equity ?? 0);
          setRuntime((prev) => applyDailyReset(prev, now, equity, 'native'));
          if (Number(res.equity ?? 0) > 0) {
            setAccount((prev) =>
              prev
                ? {
                    ...prev,
                    ok: true,
                    equity: Number(res.equity ?? prev.equity),
                    available: Number(res.available ?? prev.available ?? 0),
                    unrealizedPL: Number(res.unrealizedPL ?? prev.unrealizedPL ?? 0),
                  }
                : prev,
            );
          }
          setLastRefreshAt(now);
          applyNative(res);
          return {
            ok: true,
            message: res.stale
              ? `계좌 조회가 지연돼 마지막 확인 잔고 ${fmtUsdt(equity)} 기준으로 초기화했습니다. 자동매매를 다시 켤 수 있습니다.`
              : `오늘 손실 한도를 지금 잔고 ${fmtUsdt(equity)} 기준으로 초기화했습니다. 자동매매를 다시 켤 수 있습니다.`,
          };
        }
        const message = res?.error ?? '손실 한도를 초기화하지 못했습니다. 연결 상태를 확인해 주세요.';
        setError(message);
        return { ok: false, message };
      }
      // 브라우저 — 실제 계좌가 없으므로 화면에 있는 모의 잔고를 기준으로 맞춘다.
      const equity = account?.equity ?? null;
      const plan = planDailyReset(equity, now);
      if (!plan.ok) {
        const message = plan.reason ?? '잔고를 확인하지 못해 초기화하지 못했습니다.';
        setError(message);
        return { ok: false, message };
      }
      setRuntime((prev) => applyDailyReset(prev, now, equity, 'web'));
      setLastRefreshAt(now);
      return { ok: true, message: `오늘 손실 한도를 화면 잔고 ${fmtUsdt(equity)} 기준으로 초기화했습니다.` };
    } catch (e) {
      const message = e instanceof Error ? e.message : '손실 한도를 초기화하지 못했습니다.';
      setError(message);
      return { ok: false, message };
    } finally {
      setBusy(null);
    }
  }, [account?.equity, applyNative, keys.hasKeys, supported]);

  const start = useCallback(async () => {
    if (!keys.hasKeys && supported) {
      setError('먼저 비트겟 API 키를 연결해 주세요.');
      return false;
    }
    // 실제 주문이 나가는 모드는 **키**가 정한다 — 실거래 키를 모의투자로 착각한 채 켜지지 않게 한다.
    const mode = tradeMode.mode;
    if (mode === 'live' && supported) {
      // 실거래는 이 한 번의 확인 없이는 시작되지 않는다.
      const ok = window.confirm(
        '실거래 자동매매를 켭니다.\n\n· 실제 USDT로 주문이 나갑니다.\n· 손절가·목표가가 주문에 함께 걸립니다.\n· 1일 손실 한도에 닿으면 오늘 자동 진입이 멈춥니다.\n\n계속할까요?',
      );
      if (!ok) return false;
    }
    const next = { ...config, enabled: true, mode };
    setConfig(next);
    const equity = account?.equity ?? null;
    setRuntime((prev) => rollDay({ ...prev, dayStartEquity: prev.dayStartEquity ?? equity }, Date.now(), equity));
    if (supported) {
      const { plans } = buildPlans(signals, Date.now(), next);
      const status = await autoTradeStart(next, plans, exitSignals);
      applyNative(status);
      if (!status || status.error) {
        setError(status?.error ?? '감시 서비스를 시작하지 못했습니다.');
        return false;
      }
      log({
        at: Date.now(),
        level: 'info',
        text: `자동매매 시작 — ${mode === 'live' ? '실거래' : '모의투자'} · 감시 ${plans.length}건 · ${next.intervalSec}초 주기`,
      });
    } else {
      log({
        at: Date.now(),
        level: 'info',
        text: `모의 시뮬레이션 모드로 켰습니다(브라우저). 앱(APK v1.5.0+)에서는 24시간 감시가 실제로 돌아갑니다.`,
      });
      simulate(next);
    }
    return true;
  }, [account?.equity, applyNative, buildPlans, config, exitSignals, keys.hasKeys, log, signals, simulate, supported, tradeMode]);

  const stop = useCallback(
    async (reason = '사용자가 자동매매를 껐습니다.') => {
      const next = { ...config, enabled: false };
      setConfig(next);
      if (supported) {
        const status = await autoTradeStop();
        applyNative(status ?? { running: false });
      }
      setNative((prev) => (supported ? { ...(prev ?? {}), running: false } : null));
      log({ at: Date.now(), level: 'info', text: reason });
    },
    [applyNative, config, log, supported],
  );

  /* ---------------- 원클릭 주문 ---------------- */

  const quickOrder = useCallback(
    async (signal: Signal): Promise<QuickOrderResult> => {
      const seed = accountBase.seed;
      if (!(seed > 0)) {
        return {
          ok: false,
          simulated: false,
          message: '연결된 비트겟 계좌 잔고가 없습니다. 메뉴 → 비트겟 자동매매에서 API 키를 연결하면 실시간 잔고 기준으로 주문합니다.',
        };
      }
      const plan = planAutoOrder({
        signal,
        seed,
        config,
        leverage: leverageFor(signal),
        spec: specFor(signal.symbol),
        available: accountBase.available,
      });
      const decision = evaluateEntry({
        config: { ...config, enabled: true },
        signal,
        tradedKeys: runtime.tradedKeys,
        openPositions,
        openSymbols,
        dailyLocked: daily.locked,
        plan,
        now: Date.now(),
        hasKeys: keys.hasKeys || !supported,
        manual: true,
      });
      if (!decision.allowed) {
        log({
          at: Date.now(),
          level: 'reject',
          text: `${signal.base} ${signal.side === 'long' ? '롱' : '숏'} 주문 거부 — ${decision.reason}`,
          symbol: signal.symbol,
          side: signal.side,
        });
        return { ok: false, simulated: !supported, message: decision.reason };
      }

      if (!supported) {
        const text = `[모의 체결] ${signal.base} ${signal.side === 'long' ? '롱' : '숏'} ${plan.qty} @ ${signal.entry} · 리스크 ${fmtUsdt(plan.riskUsd)}`;
        setRuntime((prev) => markTraded(pushLog(prev, { at: Date.now(), level: 'fill', text, symbol: signal.symbol, side: signal.side }), signalKeyOf(signal)));
        return { ok: true, simulated: true, message: '모의 체결로 기록했습니다. 실제 주문은 앱(v1.5.0+)에서만 나갑니다.' };
      }

      const params: PlaceOrderParams = buildOrderParams({
        signal,
        plan,
        posMode: normalizePosMode(account?.posMode),
        orderType: 'market',
        clientOid: clientOidFor(signal.symbol),
        pricePlace: contractBySymbol.get(signal.symbol)?.decimals ?? null,
        priceEndStep: contractBySymbol.get(signal.symbol)?.priceEndStep ?? 1,
        // 없으면 0 — '1' 은 "정수 단위" 라는 뜻이라 소수 수량을 0 으로 깎는다.
        sizeMultiplier: contractBySymbol.get(signal.symbol)?.sizeMultiplier ?? 0,
      });
      setBusy(`order:${signal.symbol}`);
      const res = await bitgetPlaceOrder({ ...params, leverage: plan.leverage, holdMode: account?.posMode });
      setBusy(null);
      if (!res.ok) {
        log({
          at: Date.now(),
          level: 'error',
          text: `${signal.base} 주문 실패 — ${formatBitgetErrorKo(res.code, res.raw ?? res.error)}${recoveryText(res.recovery)}`,
          symbol: signal.symbol,
          side: signal.side,
        });
        // 사용자에게는 **한글 사유**로 알린다 — 거래소가 영문만 줘도 이유가 먼저 보이게(v1.5.5).
        return {
          ok: false,
          simulated: false,
          message: formatBitgetErrorKo(res.code, res.raw ?? res.error) + recoveryText(res.recovery),
        };
      }
      log({
        at: Date.now(),
        level: 'fill',
        text: `${tradeMode.mode === 'live' ? '[실거래]' : '[모의]'} ${signal.base} ${signal.side === 'long' ? '롱' : '숏'} ${params.size} 주문 접수 · TP ${params.presetStopSurplusPrice} / SL ${params.presetStopLossPrice} · 주문 ${res.orderId ?? res.clientOid ?? ''}${recoveryText(res.recovery)}`,
        symbol: signal.symbol,
        side: signal.side,
      });
      setRuntime((prev) => markTraded(prev, signalKeyOf(signal)));
      void refreshPositions();
      return { ok: true, simulated: false, message: `${tradeMode.mode === 'live' ? '실거래' : '모의투자'} 주문을 넣었습니다.` };
    },
    [account?.posMode, accountBase.available, accountBase.seed, config, contractBySymbol, daily.locked, keys.hasKeys, leverageFor, log, openPositions, openSymbols, refreshPositions, runtime.tradedKeys, specFor, supported, tradeMode.mode],
  );

  /** 보유 포지션 청산 — 방향·축소 규칙은 네이티브가 계좌 모드(헤지/단방향)에 맞춰 만든다. */
  const closePosition = useCallback(
    async (pos: BitgetPosition): Promise<QuickOrderResult> => {
      if (!supported) return { ok: false, simulated: false, message: '앱(APK)에서만 포지션을 청산할 수 있습니다.' };
      if (!keys.hasKeys) return { ok: false, simulated: false, message: 'API 키가 연결되지 않았습니다.' };
      if (!(pos.total > 0)) return { ok: false, simulated: false, message: '청산할 수량이 없습니다.' };
      const place = contractBySymbol.get(pos.symbol)?.volumePlace;
      const size = priceText(pos.total, place ?? 8);
      if (!size || Number(size) <= 0) return { ok: false, simulated: false, message: '청산 수량을 계산하지 못했습니다.' };
      setBusy(`close:${pos.symbol}`);
      const res = await bitgetClosePosition({
        symbol: pos.symbol,
        holdSide: String(pos.holdSide ?? 'long'),
        size,
        holdMode: account?.posMode,
        // 청산마다 다른 clientOid — 같으면 거래소가 25212(중복)로 거부한다.
        clientOid: clientOidFor(`close${pos.symbol}`),
      });
      setBusy(null);
      if (!res.ok) {
        log({
          at: Date.now(),
          level: 'error',
          text: `${pos.symbol.replace('USDT', '')} 청산 실패 — ${formatBitgetErrorKo(res.code, res.raw ?? res.error)}${recoveryText(res.recovery)}`,
          symbol: pos.symbol,
          side: pos.holdSide === 'long' ? 'long' : 'short',
        });
        return { ok: false, simulated: false, message: res.error ?? '청산에 실패했습니다.' };
      }
      log({
        at: Date.now(),
        level: 'fill',
        text: `${tradeMode.mode === 'live' ? '[실거래]' : '[모의]'} ${pos.symbol.replace('USDT', '')} ${pos.holdSide === 'long' ? '롱' : '숏'} 청산 ${size} · 주문 ${res.orderId ?? res.clientOid ?? ''}`,
        symbol: pos.symbol,
        side: pos.holdSide === 'long' ? 'long' : 'short',
      });
      void refreshPositions();
      return { ok: true, simulated: false, message: '청산 주문을 넣었습니다.' };
    },
    [account?.posMode, contractBySymbol, keys.hasKeys, log, refreshPositions, supported, tradeMode.mode],
  );

  /* ---------------- 부팅 · 주기 동기화 ---------------- */

  useEffect(() => {
    void refreshKeys();
  }, [refreshKeys]);

  // 네이티브 이벤트 구독은 한 번만 건다(키·포지션 상태가 바뀌어도 해제/재등록하지 않는다).
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    let handle: { remove: () => Promise<void> } | null = null;
    void onAutoTradeEvent((data) => {
      if (alive) applyNative(data);
    }).then((h) => {
      if (alive) handle = h;
      else void h?.remove();
    });
    void autoTradeStatus().then((s) => {
      if (alive) applyNative(s);
    });
    return () => {
      alive = false;
      if (handle) void handle.remove();
    };
    // applyNative 는 useCallback([]) 으로 고정되어 있고, supported 는 앱/웹 여부 상수다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyNative, supported]);

  // 서비스 상태·포지션 주기 확인 — 화면이 열려 있을 때 20초마다.
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    const id = window.setInterval(() => {
      void autoTradeStatus().then((s) => {
        if (alive && s) applyNative(s);
      });
      void refreshPositions();
    }, 20_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [applyNative, refreshPositions, supported]);

  /**
   * 🔗 실시간 잔고 자동 갱신(v1.5.5) — **앱이 열려 있는 동안 항상**.
   *  · 자동매매 화면이 열려 있으면 12초, 스캐너 탭 등 다른 화면이면 60초마다 계좌를 읽는다.
   *    (스캐너 시그널 카드의 주문 수량도 항상 최신 잔고 기준으로 떠야 하기 때문)
   *  · 앱 시작·포그라운드 복귀 시 즉시 한 번 맞추고, 그때 키 저장 상태도 다시 읽는다.
   *  · 잔고(총 자산·가용·미실현)는 계좌에서 직접, 포지션은 자동매매 화면에서 2번에 1번만 읽는다.
   *  · 이미 요청이 떠 있으면 건너뛰어 주기 갱신과 복귀가 겹쳐도 거래소에 두 번 쏘지 않는다.
   */
  useEffect(() => {
    if (!supported || !keys.hasKeys) return;
    const run = async () => {
      if (document.visibilityState === 'hidden') return;
      if (refreshGuard.current.busy) return;
      refreshGuard.current.busy = true;
      try {
        await refreshAccount();
        refreshGuard.current.round += 1;
        if (liveRefresh && refreshGuard.current.round % 2 === 0) await refreshPositions();
      } finally {
        refreshGuard.current.busy = false;
      }
    };
    void run();
    const period = liveRefresh ? LIVE_REFRESH_MS : IDLE_REFRESH_MS;
    const id = window.setInterval(() => void run(), period);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // 포그라운드 복귀 — 키 저장 상태를 다시 읽고(다른 화면에서 지웠을 수 있다) 잔고를 즉시 맞춘다.
      void refreshKeys();
      void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      refreshGuard.current.busy = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [keys.hasKeys, liveRefresh, refreshAccount, refreshKeys, refreshPositions, supported]);

  /** 켜져 있는 동안 새 시그널을 감시 목록으로 계속 넘긴다(중복은 키로 병합). */
  const armedRef = useRef<ArmedPlan[]>([]);
  const lastSyncRef = useRef(0);
  useEffect(() => {
    if (!config.enabled || !supported) {
      armedRef.current = [];
      return;
    }
    const now = Date.now();
    if (now - lastSyncRef.current < 15_000) return;
    lastSyncRef.current = now;
    const { plans } = buildPlans(signals, now);
    // 설정(허용 종목·유효시간)이 바뀌면 이미 감시 중인 목록에서도 빠져야 한다 — 만료·제외 종목은 버린다.
    const alive = armedRef.current.filter((p) => p.expiresAt > now && symbolAllowed(config, p.symbol));
    armedRef.current = mergeArmedPlans(alive, plans);
    void autoTradeSync({ ...config, mode: tradeMode.mode }, armedRef.current, exitSignals).then(applyNative);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals, config, config.enabled, config.autoEntry, supported]);

  /** 하루 손실 한도에 닿으면 자동으로 잠근다. */
  useEffect(() => {
    if (!config.enabled || !daily.locked || config.dailyLossPct <= 0) return;
    log({
      at: Date.now(),
      level: 'block',
      text: `1일 손실 한도 도달(${fmtUsdt(daily.pnlUsd)} / 한도 −${config.dailyLossPct}%) — 오늘 자동 진입을 멈춥니다.`,
    });
    setConfig((prev) => ({ ...prev, enabled: false }));
    if (supported) void autoTradeStop().then(applyNative);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily.locked]);

  return {
    supported,
    bridgeMissing,
    config,
    /** 실제 주문이 나가는 모드(키 기준) */
    tradeMode,
    runtime,
    keys,
    account,
    /** 🔗 실계좌 잔고(총 자산·가용) — 모든 시그널·주문 계산의 기준(v1.5.5) */
    accountBase,
    positions,
    native,
    running,
    busy,
    error,
    daily,
    openPositions,
    openSymbols,
    tick,
    /** 마지막 잔고 갱신 시각 · 실시간 갱신 켜짐 여부 (v1.5.4) */
    lastRefreshAt,
    liveRefresh,
    setLiveRefresh,
    patchConfig: (patch: Partial<AutoTradeConfig>) => setConfig((prev) => normalizeConfig({ ...prev, ...patch })),
    saveKeys,
    forgetKeys,
    testConnection,
    refreshPositions,
    resetDailyLimit,
    refreshAccount,
    start,
    stop,
    quickOrder,
    closePosition,
    simulate,
    setError,
    reloadKeys: refreshKeys,
  };
}

export type AutoTradeApi = ReturnType<typeof useAutoTrade>;
