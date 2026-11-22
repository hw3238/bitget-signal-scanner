/**
 * 비트겟 공개 API 요청 게이트.
 *
 * 실측(헤드리스·실 API 90건 연속):
 *   6동시성 · 시작 간격 40ms(≈25 req/s) → 429 14건
 *   6동시성 · 시작 간격 60ms(≈17 req/s) → 429 0건
 *   → 공개 캔들 엔드포인트는 IP당 대략 20 req/s 선. 안전 마진을 둔 55ms(≈18 req/s)로 시작하고,
 *     429가 뜨면 간격을 늘려 스스로 물러난다(적응형 백오프). 성공이 이어지면 서서히 되돌린다.
 */

const BASE_GAP_MS = 62;
const MAX_GAP_MS = 360;
const BASE_CONCURRENCY = 6;
const MAX_CONCURRENCY = 8;
/** 탭 간 공유 예약 시각 키 */
const SHARED_SLOT_KEY = 'cota.rate.slot.v1';

class RequestGate {
  private active = 0;
  private waiters: (() => void)[] = [];
  private nextSlot = 0;
  private pauseUntil = 0;
  private gapMs = BASE_GAP_MS;
  private concurrency = BASE_CONCURRENCY;
  private successStreak = 0;
  private throttledUntil = 0;

  get state() {
    return {
      gapMs: Math.round(this.gapMs),
      concurrency: this.concurrency,
      active: this.active,
      queued: this.waiters.length,
    };
  }

  /** 브라우저 탭이 여러 개여도 같은 IP 한도를 나눠 쓰도록 예약 시각을 공유한다. */
  private sharedSlot(): number {
    try {
      return Number(localStorage.getItem(SHARED_SLOT_KEY) ?? 0) || 0;
    } catch {
      return 0;
    }
  }

  private setSharedSlot(at: number): void {
    try {
      localStorage.setItem(SHARED_SLOT_KEY, String(at));
    } catch {
      /* 저장소를 쓸 수 없는 환경 */
    }
  }

  async acquire(): Promise<void> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot, this.sharedSlot(), this.pauseUntil);
    this.nextSlot = slot + this.gapMs;
    this.setSharedSlot(this.nextSlot);
    if (slot > now) await sleep(slot - now);
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  /** 429 — 간격을 크게 늘리고 잠시 모든 요청을 멈춘다. */
  onThrottle(retryAfterMs = 0): void {
    this.gapMs = Math.min(MAX_GAP_MS, Math.round(this.gapMs * 1.7) + 10);
    this.concurrency = 3;
    this.successStreak = 0;
    const pause = Math.max(retryAfterMs, 750);
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + pause);
    this.throttledUntil = Date.now() + 6000;
    this.nextSlot = Math.max(this.nextSlot, this.pauseUntil);
  }

  /** 성공 — 억제 구간이 지났으면 간격을 조금씩 원래대로 되돌린다. */
  onSuccess(): void {
    this.successStreak += 1;
    if (this.successStreak % 12 !== 0) return;
    const now = Date.now();
    if (now < this.throttledUntil) return;
    this.gapMs = Math.max(BASE_GAP_MS, this.gapMs * 0.96);
    this.concurrency = Math.min(MAX_CONCURRENCY, this.concurrency + 1);
  }
}

export const requestGate = new RequestGate();

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 게이트를 통과해 실행 — 모든 비트겟 요청이 이 경로를 지난다. */
export async function gated<T>(run: () => Promise<T>): Promise<T> {
  await requestGate.acquire();
  try {
    return await run();
  } finally {
    requestGate.release();
  }
}
