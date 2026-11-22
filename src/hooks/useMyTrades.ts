import { useCallback, useMemo, useState } from 'react';
import type { Signal } from '../engine/types';
import { loadMyTrades, MEMO_MAX, saveMyTrades, signalKey, type MyTrade } from '../lib/storage';

export interface MyTradesApi {
  entries: MyTrade[];
  keys: Set<string>;
  count: number;
  isMine: (signal: Pick<Signal, 'symbol' | 'tf' | 'side' | 'detectedAt'>) => boolean;
  toggle: (key: string) => void;
  setMemo: (key: string, memo: string) => void;
  remove: (key: string) => void;
  clear: () => void;
  /** 시그널 → 저장 키 */
  keyOf: (signal: Pick<Signal, 'symbol' | 'tf' | 'side' | 'detectedAt'>) => string;
}

/**
 * 내 진입 기록 — 카드·기록 탭에서 원탭으로 켜고 끄며 localStorage 에 보관한다.
 * 시그널 키(symbol|tf|side|detectedAt)라 스캔이 반복돼도 표시가 유지된다.
 */
export function useMyTrades(): MyTradesApi {
  const [entries, setEntries] = useState<MyTrade[]>(() => loadMyTrades());

  const keys = useMemo(() => new Set(entries.map((e) => e.key)), [entries]);

  const toggle = useCallback((key: string) => {
    if (!key) return;
    setEntries((prev) => {
      const next = prev.some((e) => e.key === key)
        ? prev.filter((e) => e.key !== key)
        : [{ key, enteredAt: Date.now(), memo: '' }, ...prev];
      saveMyTrades(next);
      return next;
    });
  }, []);

  const setMemo = useCallback((key: string, memo: string) => {
    const trimmed = memo.slice(0, MEMO_MAX);
    setEntries((prev) => {
      let hit = false;
      const next = prev.map((e) => {
        if (e.key !== key) return e;
        hit = true;
        return { ...e, memo: trimmed };
      });
      if (!hit) return prev;
      saveMyTrades(next);
      return next;
    });
  }, []);

  const remove = useCallback(
    (key: string) => {
      setEntries((prev) => {
        if (!prev.some((e) => e.key === key)) return prev;
        const next = prev.filter((e) => e.key !== key);
        saveMyTrades(next);
        return next;
      });
    },
    [],
  );

  const clear = useCallback(() => {
    saveMyTrades([]);
    setEntries([]);
  }, []);

  const isMine = useCallback(
    (signal: Pick<Signal, 'symbol' | 'tf' | 'side' | 'detectedAt'>) => keys.has(signalKey(signal)),
    [keys],
  );

  return { entries, keys, count: entries.length, isMine, toggle, setMemo, remove, clear, keyOf: signalKey };
}
