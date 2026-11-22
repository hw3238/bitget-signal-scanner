export interface Settings {
  /** 'auto' = 시그널마다 COTA 추천 배율, 'manual' = 아래 leverage 고정 */
  leverageMode: 'auto' | 'manual';
  leverage: number;
  minRR: number;
  refreshSec: number;
  sound: boolean;
  /** 핸드폰 알림 ON/OFF (기본 ON) */
  notifyEnabled: boolean;
  /** 알림 대상: 비트·이더·솔 / 주요 코인 / 전체 종목 */
  notifyTarget: 'top3' | 'majors' | 'all';
  /** 선택: ntfy.sh 토픽 이름 또는 URL (비어 있으면 외부 푸시 안 함) */
  notifyNtfy: string;
  /** 1회 허용 손실률(%). null = 매매 성향 기본값(보수적 1.5% · 공격적 3%) */
  riskPct: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  leverageMode: 'auto',
  leverage: 10,
  minRR: 1.5,
  refreshSec: 60,
  sound: false,
  notifyEnabled: true,
  notifyTarget: 'majors',
  /** 기본 전용 토픽 — 사용자가 바꾸거나 비울 수 있다 */
  notifyNtfy: 'bgss-hw3238-9f4k2m',
  riskPct: null,
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

/** 저장된 설정을 읽고, FX 시절 값(주력 3종목·FX 대상)은 코인 기준으로 옮긴다. */
export const loadSettings = (): Settings => {
  const merged = read<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
  const rawTarget = merged.notifyTarget as string;
  if (rawTarget === 'priority') merged.notifyTarget = 'top3';
  else if (rawTarget === 'fx') merged.notifyTarget = 'majors';
  if (!['top3', 'majors', 'all'].includes(merged.notifyTarget)) {
    merged.notifyTarget = DEFAULT_SETTINGS.notifyTarget;
  }
  return merged;
};
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
