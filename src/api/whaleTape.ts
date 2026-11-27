/**
 * 🐋 고래 체결 테이프 — 실시간 체결 스트림
 *
 * 화면에 바로 뜨는 실시간 데이터만 쓴다(가짜·추정 체결 금지).
 *  · 비트겟: `wss://ws.bitget.com/v2/ws/public` 의 `trade` 채널(USDT-FUTURES) + 초기 화면용
 *    `GET /api/v2/mix/market/fills` 최근 체결 1회 병합. (REST 는 CORS `*` 확인)
 *  · 바이낸스: `wss://fstream.binance.com/stream?streams=` 선물 aggTrade → 막히면(차단·무응답)
 *    `wss://stream.binance.com:9443` → `wss://data-stream.binance.vision`(현물 공식 데이터 전용) 순서로
 *    자동 폴백. REST 는 `fapi.binance.com` → `data-api.binance.vision` 순서.
 *    ※ 2026-11-27 실측: 해외 IP 에서 fstream 은 **연결은 되지만 데이터가 오지 않고**(15초 무응답),
 *      stream.binance.com 은 연결이 거절되며, data-stream.binance.vision 이 정상 동작했다.
 *  · 두 경로(WebSocket·REST)가 모두 끊기면 5초 간격 REST 폴링으로 버틴다(테이프는 멈추지 않는다).
 */
import type { Contract, Ticker } from '../engine/types';
import type { WhaleSide, WhaleTrade } from '../engine/whaleTape';
import type { Exchange } from '../lib/exchange';
import { mapLimit } from './publicMarket';

const BG = 'https://api.bitget.com';

/** 스캔 결과가 없을 때 쓰는 기본 15종목(유동성 상위·대표 코인) */
export const FALLBACK_WHALE_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'SUIUSDT',
  'BNBUSDT',
  'ZECUSDT',
  'ADAUSDT',
  'LINKUSDT',
  'AVAXUSDT',
  'TONUSDT',
  'TRXUSDT',
  'LTCUSDT',
  'BCHUSDT',
];

export const WHALE_SYMBOL_LIMIT = 15;

export function baseOf(symbol: string): string {
  return symbol.replace(/(USDT|USDC|BUSD|USD)$/i, '');
}

/**
 * 유동성 상위 코인 15개 — 스캐너가 받은 계약·티커에서 **코인만** 골라 24h 거래대금 순으로 자른다.
 * (비트겟의 주식선물·금 선물은 고래 테이프 대상이 아니다)
 */
export function pickWhaleSymbols(contracts: Contract[], tickers: Ticker[], limit = WHALE_SYMBOL_LIMIT): string[] {
  const crypto = contracts.filter((c) => c.asset === 'crypto' && /USDT$/i.test(c.symbol));
  if (crypto.length === 0) return FALLBACK_WHALE_SYMBOLS.slice(0, limit);
  const volume = new Map(tickers.map((t) => [t.symbol, t.quoteVolume]));
  const ranked = crypto
    .map((c) => ({ symbol: c.symbol, v: volume.get(c.symbol) ?? 0 }))
    .sort((a, b) => b.v - a.v)
    .map((r) => r.symbol);
  return (ranked.length ? ranked : FALLBACK_WHALE_SYMBOLS).slice(0, limit);
}

/* ---------------- 응답 파싱 (단위 테스트 대상) ---------------- */

export interface RawBitgetFill {
  tradeId?: string;
  price?: string;
  size?: string;
  side?: string;
  ts?: string;
  symbol?: string;
}

export function parseBitgetFill(raw: RawBitgetFill, symbol: string): WhaleTrade | null {
  const price = Number(raw.price);
  const size = Number(raw.size);
  const at = Number(raw.ts);
  if (!(price > 0) || !(size > 0) || !Number.isFinite(at)) return null;
  const sym = (raw.symbol || symbol).toUpperCase();
  const side: WhaleSide = raw.side === 'sell' ? 'sell' : 'buy';
  return {
    id: `bg:${raw.tradeId ?? `${sym}:${at}:${price}:${size}`}`,
    symbol: sym,
    base: baseOf(sym),
    side,
    price,
    usd: price * size,
    at,
    fills: 1,
  };
}

export interface RawBinanceAgg {
  /** 집계 체결 번호(고유) */
  a?: number;
  p?: string;
  q?: string;
  /** 체결 시각(ms) */
  T?: number;
  /** true = 매수자가 메이커 → 공격자는 매도 */
  m?: boolean;
  /** 심볼(스트림 페이로드에 함께 온다) */
  s?: string;
}

export function parseBinanceAggTrade(raw: RawBinanceAgg, symbol: string): WhaleTrade | null {
  const price = Number(raw.p);
  const qty = Number(raw.q);
  const at = Number(raw.T);
  if (!(price > 0) || !(qty > 0) || !Number.isFinite(at)) return null;
  const sym = symbol.toUpperCase();
  const side: WhaleSide = raw.m ? 'sell' : 'buy';
  return {
    id: `bn:${sym}:${raw.a ?? `${at}:${price}:${qty}`}`,
    symbol: sym,
    base: baseOf(sym),
    side,
    price,
    usd: price * qty,
    at,
    fills: 1,
  };
}

/* ---------------- REST ---------------- */

async function getJson<T>(url: string, timeoutMs = 12000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 비트겟 최근 체결 — 최대 100건(거래소 상한) */
export async function fetchBitgetRecentFills(symbol: string, limit = 100): Promise<WhaleTrade[]> {
  const body = await getJson<{ code: string; data: RawBitgetFill[] | null }>(
    `${BG}/api/v2/mix/market/fills?productType=USDT-FUTURES&symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
  );
  if (body.code !== '00000') throw new Error(`bitget ${body.code}`);
  return (body.data ?? [])
    .map((row) => parseBitgetFill(row, symbol))
    .filter((t): t is WhaleTrade => !!t);
}

/** 바이낸스 선물 REST 가 막힌 IP(451·403)에서는 현물 공식 데이터 API 로 내려간다 */
let binanceRestFuturesBlocked = false;

export async function fetchBinanceRecentAggTrades(symbol: string, limit = 100): Promise<WhaleTrade[]> {
  const parse = (rows: RawBinanceAgg[]) =>
    rows.map((row) => parseBinanceAggTrade(row, symbol)).filter((t): t is WhaleTrade => !!t);
  if (!binanceRestFuturesBlocked) {
    try {
      const rows = await getJson<RawBinanceAgg[]>(
        `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
      );
      return parse(rows);
    } catch {
      binanceRestFuturesBlocked = true;
    }
  }
  const rows = await getJson<RawBinanceAgg[]>(
    `https://data-api.binance.vision/api/v3/aggTrades?symbol=${encodeURIComponent(symbol)}&limit=${limit}`,
  );
  return parse(rows);
}

/** 초기 화면 즉시 표시용 — 종목별 최근 체결을 한 번만 모아 온다(실패한 종목은 건너뛴다) */
export async function seedWhaleTrades(exchange: Exchange, symbols: string[]): Promise<WhaleTrade[]> {
  const fetchOne = exchange === 'bitget' ? fetchBitgetRecentFills : fetchBinanceRecentAggTrades;
  const results = await mapLimit(symbols, 4, (symbol) => fetchOne(symbol).catch(() => [] as WhaleTrade[]));
  return results.flat().sort((a, b) => a.at - b.at);
}

/* ---------------- 실시간 스트림 ---------------- */

export type WhaleFeedPhase = 'connecting' | 'live' | 'rest' | 'error' | 'stopped';

export interface WhaleFeedStatus {
  phase: WhaleFeedPhase;
  /** 실제로 붙은 스트림 라벨 — 화면에 그대로 표시한다 */
  stream: string;
  symbols: string[];
  /** 초당 원본 체결 수(최근 관측) */
  rate: number;
  connectedAt: number;
  error: string | null;
}

export interface WhaleFeedHandle {
  stop: () => void;
}

export const BINANCE_WHALE_STREAMS: Array<{ url: string; label: string }> = [
  { url: 'wss://fstream.binance.com/stream?streams=', label: '바이낸스 선물 실시간' },
  { url: 'wss://stream.binance.com:9443/stream?streams=', label: '바이낸스 현물 실시간' },
  { url: 'wss://data-stream.binance.vision/stream?streams=', label: '바이낸스 현물 실시간' },
];

const BITGET_WS = 'wss://ws.bitget.com/v2/ws/public';
/** 연결은 되는데 데이터가 오지 않는 경우(해외 IP 의 바이낸스 선물)를 판별하는 시간 */
const FIRST_DATA_TIMEOUT_MS = 8000;
/** 이 시간 동안 어떤 메시지도 없으면 죽은 연결로 본다 */
const STALE_MS = 35000;
const REST_POLL_MS = 5000;

export function startWhaleFeed(opts: {
  exchange: Exchange;
  symbols: string[];
  onTrades: (trades: WhaleTrade[]) => void;
  onStatus: (status: WhaleFeedStatus) => void;
}): WhaleFeedHandle {
  const { exchange, onTrades, onStatus } = opts;
  const symbols = opts.symbols.slice(0, WHALE_SYMBOL_LIMIT);
  let stopped = false;
  let ws: WebSocket | null = null;
  let retries = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let staleCheck: ReturnType<typeof setInterval> | null = null;
  let rateTimer: ReturnType<typeof setInterval> | null = null;
  let restTimer: ReturnType<typeof setInterval> | null = null;
  let firstDataTimer: ReturnType<typeof setTimeout> | null = null;
  let streamIndex = 0;
  let lastMessageAt = 0;
  let rateCounts = 0;
  const seen = new Set<string>();
  let status: WhaleFeedStatus = {
    phase: 'connecting',
    stream: exchange === 'bitget' ? '비트겟 선물 실시간' : BINANCE_WHALE_STREAMS[0].label,
    symbols,
    rate: 0,
    connectedAt: 0,
    error: null,
  };

  const emitStatus = (patch: Partial<WhaleFeedStatus>) => {
    if (stopped) return;
    status = { ...status, ...patch, symbols };
    onStatus(status);
  };

  const remember = (trades: WhaleTrade[]): WhaleTrade[] => {
    const fresh: WhaleTrade[] = [];
    for (const t of trades) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      fresh.push(t);
    }
    // 오래 켜 두어도 메모리가 늘지 않게 최근 id 만 남긴다.
    if (seen.size > 6000) seen.clear();
    if (fresh.length) onTrades(fresh);
    return fresh;
  };

  const clearTimers = () => {
    for (const t of [reconnectTimer, heartbeat, staleCheck, rateTimer, restTimer, firstDataTimer]) {
      if (t) clearInterval(t as ReturnType<typeof setInterval>);
      if (t) clearTimeout(t as ReturnType<typeof setTimeout>);
    }
    reconnectTimer = heartbeat = staleCheck = rateTimer = restTimer = firstDataTimer = null;
  };

  const closeSocket = () => {
    if (!ws) return;
    const socket = ws;
    ws = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      /* 이미 닫힌 소켓 */
    }
  };

  const startRestFallback = (reason: string) => {
    closeSocket();
    if (restTimer || stopped) return;
    emitStatus({ phase: 'rest', stream: `${exchange === 'bitget' ? '비트겟' : '바이낸스'} REST 폴링(5초)`, error: reason });
    const fetchOne = exchange === 'bitget' ? fetchBitgetRecentFills : fetchBinanceRecentAggTrades;
    const loop = async () => {
      if (stopped) return;
      const targets = symbols.slice(0, 8);
      const batches = await mapLimit(targets, 3, (symbol) => fetchOne(symbol).catch(() => [] as WhaleTrade[]));
      if (stopped) return;
      const fresh = remember(batches.flat().sort((a, b) => a.at - b.at));
      if (fresh.length === 0) return;
      emitStatus({ phase: 'rest', rate: fresh.length / (REST_POLL_MS / 1000) });
    };
    void loop();
    restTimer = setInterval(() => void loop(), REST_POLL_MS);
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(15000, 1000 * 2 ** Math.min(4, retries));
    retries += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const handleTradeBatch = (trades: WhaleTrade[]) => {
    if (stopped || trades.length === 0) return;
    lastMessageAt = Date.now();
    rateCounts += trades.length;
    remember(trades);
    if (status.phase !== 'live') emitStatus({ phase: 'live', error: null, connectedAt: Date.now() });
  };

  /** ---------------- 비트겟 ---------------- */
  const connectBitget = () => {
    if (stopped) return;
    emitStatus({ phase: 'connecting', stream: '비트겟 선물 실시간' });
    let socket: WebSocket;
    try {
      socket = new WebSocket(BITGET_WS);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = socket;
    socket.onopen = () => {
      retries = 0;
      lastMessageAt = Date.now();
      socket.send(
        JSON.stringify({
          op: 'subscribe',
          args: symbols.map((symbol) => ({ instType: 'USDT-FUTURES', channel: 'trade', instId: symbol })),
        }),
      );
      heartbeat = setInterval(() => {
        try {
          socket.send('ping');
        } catch {
          /* 닫히는 중 */
        }
      }, 20000);
      staleCheck = setInterval(() => {
        if (Date.now() - lastMessageAt > STALE_MS) {
          clearTimers();
          closeSocket();
          scheduleReconnect();
        }
      }, 10000);
    };
    socket.onmessage = (event) => {
      let msg: {
        event?: string;
        action?: string;
        arg?: { channel?: string; instId?: string };
        data?: RawBitgetFill[];
        msg?: string;
      };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return; // 'pong' 등 텍스트
      }
      if (msg.event === 'error') {
        emitStatus({ error: msg.msg ?? '구독 오류' });
        return;
      }
      if (msg.event === 'subscribe' || msg.event === 'pong') {
        lastMessageAt = Date.now();
        return;
      }
      if (msg.action !== 'update' || msg.arg?.channel !== 'trade' || !msg.data) return;
      const symbol = msg.arg.instId ?? '';
      const trades = msg.data.map((row) => parseBitgetFill(row, symbol)).filter((t): t is WhaleTrade => !!t);
      handleTradeBatch(trades);
    };
    socket.onerror = () => {
      emitStatus({ error: '비트겟 스트림 연결 오류' });
    };
    socket.onclose = () => {
      if (stopped) return;
      clearTimers();
      ws = null;
      if (retries >= 3) startRestFallback('비트겟 스트림이 계속 끊겨 REST 폴링으로 전환했습니다');
      else scheduleReconnect();
    };
  };

  /** ---------------- 바이낸스 ---------------- */
  const connectBinance = () => {
    if (stopped) return;
    const source = BINANCE_WHALE_STREAMS[streamIndex];
    if (!source) {
      startRestFallback('바이낸스 스트림이 모두 막혀 REST 폴링으로 전환했습니다');
      return;
    }
    emitStatus({ phase: 'connecting', stream: source.label });
    const streams = symbols.map((s) => `${s.toLowerCase()}@aggTrade`).join('/');
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${source.url}${streams}`);
    } catch {
      streamIndex += 1;
      connectBinance();
      return;
    }
    ws = socket;
    let gotData = false;
    const toNextSource = (reason: string) => {
      if (stopped) return;
      clearTimeout(firstDataTimer as ReturnType<typeof setTimeout>);
      firstDataTimer = null;
      clearTimers();
      closeSocket();
      streamIndex += 1;
      emitStatus({ error: reason });
      connectBinance();
    };
    socket.onopen = () => {
      lastMessageAt = Date.now();
      // 연결만 되고 데이터가 안 오는 경우(지역 차단)를 8초 안에 판별한다.
      firstDataTimer = setTimeout(() => {
        if (!gotData) toNextSource(`${source.label} 무응답 — 다음 스트림 시도`);
      }, FIRST_DATA_TIMEOUT_MS);
      staleCheck = setInterval(() => {
        if (Date.now() - lastMessageAt > STALE_MS) {
          gotData = false;
          toNextSource('스트림 응답 없음 — 재연결');
        }
      }, 10000);
    };
    socket.onmessage = (event) => {
      let msg: { stream?: string; data?: RawBinanceAgg };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const data = msg.data;
      const stream = msg.stream ?? '';
      if (!data || !stream.endsWith('@aggTrade')) return;
      const symbol = String(data.s ?? stream.split('@')[0]).toUpperCase();
      const trade = parseBinanceAggTrade(data, symbol);
      if (!trade) return;
      if (!gotData) {
        gotData = true;
        retries = 0;
        emitStatus({ stream: source.label, connectedAt: Date.now(), error: null });
      }
      handleTradeBatch([trade]);
    };
    socket.onerror = () => {
      gotData = false;
      toNextSource(`${source.label} 연결 오류`);
    };
    socket.onclose = () => {
      if (stopped || !gotData) return;
      clearTimers();
      ws = null;
      streamIndex = 0;
      scheduleReconnect();
    };
  };

  const connect = () => {
    if (stopped) return;
    if (exchange === 'bitget') connectBitget();
    else connectBinance();
  };

  // 초당 체결 수 — 화면이 '살아 있음'을 숫자로 보여 준다.
  rateTimer = setInterval(() => {
    if (stopped) return;
    const rate = Math.round((rateCounts / 2) * 10) / 10;
    rateCounts = 0;
    if (rate !== status.rate) emitStatus({ rate });
  }, 2000);

  void seedWhaleTrades(exchange, symbols)
    .then((trades) => remember(trades))
    .catch(() => undefined);

  connect();

  return {
    stop: () => {
      stopped = true;
      clearTimers();
      closeSocket();
      // 남은 타이머 정리 후 종료 상태를 알린다.
      status = { ...status, phase: 'stopped', rate: 0 };
      onStatus(status);
    },
  };
}
