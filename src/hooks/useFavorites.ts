import { useCallback, useMemo, useState } from 'react';
import type { Signal } from '../engine/types';
import { favoriteKey, loadFavorites, saveFavorites, type FavoriteEntry } from '../lib/favorites';

export interface FavoritesApi {
  entries: FavoriteEntry[];
  keys: Set<string>;
  count: number;
  isFavorite: (signal: Pick<Signal, 'symbol' | 'tf' | 'side' | 'detectedAt'>) => boolean;
  toggle: (signal: Signal) => void;
  remove: (key: string) => void;
  clear: () => void;
}

export function useFavorites(): FavoritesApi {
  const [entries, setEntries] = useState<FavoriteEntry[]>(() => loadFavorites());

  const keys = useMemo(() => new Set(entries.map((e) => e.key)), [entries]);

  const persist = useCallback((next: FavoriteEntry[]) => {
    saveFavorites(next);
    setEntries(next);
  }, []);

  const toggle = useCallback(
    (signal: Signal) => {
      setEntries((prev) => {
        const key = favoriteKey(signal);
        const exists = prev.some((e) => e.key === key);
        const next = exists
          ? prev.filter((e) => e.key !== key)
          : [{ key, addedAt: Date.now(), signal }, ...prev];
        saveFavorites(next);
        return next;
      });
    },
    [],
  );

  const remove = useCallback(
    (key: string) => {
      setEntries((prev) => {
        const next = prev.filter((e) => e.key !== key);
        saveFavorites(next);
        return next;
      });
    },
    [],
  );

  const clear = useCallback(() => persist([]), [persist]);

  const isFavorite = useCallback(
    (signal: Pick<Signal, 'symbol' | 'tf' | 'side' | 'detectedAt'>) => keys.has(favoriteKey(signal)),
    [keys],
  );

  return { entries, keys, count: entries.length, isFavorite, toggle, remove, clear };
}
