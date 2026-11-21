import type { Signal } from '../engine/types';

const FAVORITES_KEY = 'bgss.favorites.v1';
const MAX_FAVORITES = 120;

export interface FavoriteEntry {
  /** symbol + timeframe + side + 감지 봉 시각 — 스캔이 새로 돌아도 유지되는 안정 키 */
  key: string;
  addedAt: number;
  /** 즐겨찾기 시점의 시그널 스냅샷(스캔에서 사라져도 카드로 확인·해제 가능) */
  signal: Signal;
}

type FavoriteId = Pick<Signal, 'symbol' | 'tf' | 'side' | 'detectedAt'>;

/** 같은 시그널은 스캔이 반복돼도 같은 키를 갖도록 캔들 시각 기준으로 만든다. */
export function favoriteKey(signal: FavoriteId): string {
  return `${signal.symbol}|${signal.tf}|${signal.side}|${signal.detectedAt}`;
}

function isEntry(value: unknown): value is FavoriteEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<FavoriteEntry>;
  if (typeof e.key !== 'string') return false;
  const s = e.signal as Partial<Signal> | undefined;
  return (
    !!s &&
    typeof s === 'object' &&
    typeof s.symbol === 'string' &&
    typeof s.base === 'string' &&
    (s.tf === '1H' || s.tf === '4H') &&
    (s.side === 'long' || s.side === 'short') &&
    typeof s.detectedAt === 'number' &&
    typeof s.entry === 'number' &&
    typeof s.stop === 'number' &&
    typeof s.target === 'number' &&
    Array.isArray(s.candles)
  );
}

export function loadFavorites(): FavoriteEntry[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

export function saveFavorites(list: FavoriteEntry[]): void {
  try {
    const trimmed = list.slice(0, MAX_FAVORITES);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(trimmed));
  } catch {
    /* 저장 공간이 부족하거나 localStorage를 쓸 수 없는 환경 */
  }
}
