export interface Settings {
  leverage: number;
  minRR: number;
  refreshSec: number;
  scanPairs: boolean;
  sound: boolean;
  /** 벤티지 호가 보정: 카드 표시 이름(XAUUSD+, EURUSD+ …) → 가격 오프셋 */
  fxOffsets: Record<string, number>;
  /** 선택: Twelve Data 무료 API 키(추가 FX 페어 스캔) */
  twelveDataKey: string;
}

export const DEFAULT_SETTINGS: Settings = {
  leverage: 10,
  minRR: 1.5,
  refreshSec: 60,
  scanPairs: true,
  sound: false,
  fxOffsets: {},
  twelveDataKey: '',
};

const SETTINGS_KEY = 'bgss.settings.v1';
const HISTORY_KEY = 'bgss.history.v1';
const LOG_KEY = 'bgss.swaplog.v1';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export const loadSettings = () => read<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));

export const loadHistory = () => readArray<HistoryRecord>(HISTORY_KEY);
export const saveHistory = (h: HistoryRecord[]) =>
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 400)));

export const loadSwapLog = () => readArray<SwapLogEntry>(LOG_KEY);
export const saveSwapLog = (l: SwapLogEntry[]) => localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(0, 200)));

export interface HistoryRecord {
  id: string;
  symbol: string;
  base: string;
  asset: 'crypto' | 'stock' | 'fx';
  tf: '1H' | '4H';
  side: 'long' | 'short';
  strategyId: string;
  strategyShort: string;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  riskPct: number;
  detectedAt: number;
  firstSeen: number;
  state: 'open' | 'win' | 'loss';
  r: number;
  bars: number;
  /** FX·금 고정 소수점 표기용 */
  decimals?: number;
}

export interface SwapLogEntry {
  at: number;
  symbol: string;
  base: string;
  tf: string;
  fromId: string;
  toId: string;
  fromWinRate: number;
  fromRR: number;
  toWinRate: number;
  toRR: number;
  reason: string;
}
