/**
 * 미결제약정(OI) 관측 기록 — 비트겟 REST에는 OI 과거 시계열이 없어서,
 * COTA가 화면을 열 때마다 본 OI를 브라우저에 남기고 그 차이를 변동률로 보여준다.
 * (값 자체는 전부 거래소 실데이터 · 변동률만 COTA 관측 기준)
 */
const KEY = 'cota.oi.snapshots.v1';
const MIN_GAP_MS = 5 * 60_000;
const KEEP = 120;

interface Snapshot {
  at: number;
  oi: Record<string, number>;
}

function read(): Snapshot[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = JSON.parse(raw ?? '[]') as Snapshot[];
    return Array.isArray(parsed) ? parsed.filter((s) => s && typeof s.at === 'number' && s.oi) : [];
  } catch {
    return [];
  }
}

function write(list: Snapshot[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-KEEP)));
  } catch {
    /* 저장할 수 없는 환경 */
  }
}

export interface OiBaseline {
  at: number;
  /** 심볼 → OI(USDT) */
  oi: Record<string, number>;
}

/** 현재 OI 스냅샷을 저장하고, 비교 기준이 될 과거 스냅샷을 돌려준다. */
export function recordOiSnapshot(current: Record<string, number>, now = Date.now()): OiBaseline | null {
  const list = read();
  const recent = list.filter((s) => now - s.at >= MIN_GAP_MS);
  const baseline = recent.length ? recent[recent.length - 1] : list[0] ?? null;
  const next = [...list, { at: now, oi: current }];
  write(next);
  return baseline ? { at: baseline.at, oi: baseline.oi } : null;
}

/** 변동률(%) — 기준값이 없으면 null */
export function oiChangePct(current: number, baseline: number | undefined): number | null {
  if (!baseline || !Number.isFinite(baseline) || baseline <= 0) return null;
  return (current / baseline - 1) * 100;
}
