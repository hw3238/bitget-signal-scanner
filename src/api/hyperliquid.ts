import type { Candle, TF } from '../engine/types';
import type { ProprMarket } from '../engine/propr';
import type { ProprAssetType } from '../engine/proprUniverse';
import { PROPR_LISTINGS, proprAssetClass, proprBase, proprLeverageCap, proprListingOf } from '../engine/proprUniverse';

/**
 * 🏆 Propr(Hyperliquid) 공개 API — CORS 가 열린 `api.hyperliquid.xyz/info` 만 쓴다.
 *
 * Propr 는 Hyperliquid 무기한 선물 위에 올라간 프랍(prop firm)이고, 상장 종목은
 *  · 메인 덱의 코인 무기한(BTC·ETH·SOL·알트)
 *  · HIP-3 빌더 덱 `xyz` 의 주식·지수·원자재(`xyz:TSLA`·`xyz:SP500`·`xyz:GOLD` …)
 * 로 이뤄진다. 시세·미결제약정·캔들은 전부 이 API 에서 실시간으로 받는다.
 *
 * 속도: `candleSnapshot` 은 1회 weight 20(+60봉당 1)이고 IP 예산이 분당 1200 이라
 *   한 번에 146종목을 다 받으면 rate limit 에 걸린다. 그래서
 *   ① 기본은 거래대금 상위 28종목(자산군별 최소 3종목 보장)만 훑고
 *   ② '전체 146종목' 은 사용자가 누를 때만(진행률 표시) 돌린다.
 *   ③ 요청 간격은 게이트로 조절하고 429 는 스스로 물러났다가 회복한다.
 */
const HL_INFO = 'https://api.hyperliquid.xyz/info';

/* ------------------------------------------------------------------ *
 * 요청 게이트 — 429 를 만나면 간격을 늘리고, 성공이 이어지면 조금씩 되돌린다.
 * ------------------------------------------------------------------ */
const MIN_GAP_MS = 260;
const MAX_GAP_MS = 2000;

class HlGate {
  private nextSlot = 0;
  private gapMs = MIN_GAP_MS;
  private active = 0;
  private readonly concurrency = 3;

  async acquire(): Promise<void> {
    if (this.active >= this.concurrency) {
      await new Promise((r) => setTimeout(r, 40));
      return this.acquire();
    }
    this.active += 1;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.gapMs;
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
  }

  release(ok: boolean): void {
    this.active = Math.max(0, this.active - 1);
    if (ok) this.gapMs = Math.max(MIN_GAP_MS, this.gapMs - 20);
    else this.gapMs = Math.min(MAX_GAP_MS, Math.round(this.gapMs * 1.8));
  }

  get state() {
    return { gapMs: this.gapMs, active: this.active };
  }
}

const gate = new HlGate();

async function post<T>(body: unknown, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(HL_INFO, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(res.status === 429 ? '요청 한도(429)' : `HTTP ${res.status}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 게이트를 통과하며 재시도(429·네트워크 오류)까지 처리하는 info 호출 */
async function info<T>(body: unknown, attempts = 3): Promise<T> {
  let last: unknown = null;
  for (let i = 0; i < attempts; i++) {
    await gate.acquire();
    let ok = false;
    try {
      const out = await post<T>(body);
      ok = true;
      return out;
    } catch (e) {
      last = e;
      const status = (e as { status?: number }).status;
      if (status && status !== 429 && status < 500) throw e;
      await new Promise((r) => setTimeout(r, 500 + i * 900));
    } finally {
      gate.release(ok);
    }
  }
  throw last instanceof Error ? last : new Error('Hyperliquid 응답 없음');
}

/* ------------------------------------------------------------------ *
 * 시장 메타 + 실시간 컨텍스트(가격·미결제약정·펀딩·24h 거래대금)
 * ------------------------------------------------------------------ */
interface HlAsset {
  name: string;
  szDecimals?: number;
  maxLeverage?: number;
  isDelisted?: boolean;
}
interface HlCtx {
  funding?: string;
  openInterest?: string;
  prevDayPx?: string;
  dayNtlVlm?: string;
  oraclePx?: string;
  markPx?: string;
  midPx?: string;
}
type HlMeta = [{ universe: HlAsset[] }, HlCtx[]];

export interface HlDex {
  name: string;
  fullName?: string;
}

/** 가격 크기에 맞춘 표시 자리수 — Hyperliquid 는 5유효숫자 표기를 쓴다. */
export function hlDecimals(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 2;
  if (price >= 1000) return 1;
  if (price >= 100) return 2;
  if (price >= 1) return 3;
  if (price >= 0.01) return 4;
  if (price >= 0.0001) return 5;
  return 7;
}

function parseMeta(raw: unknown): HlMeta | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const [meta, ctxs] = raw as [HlMeta[0], HlCtx[]];
  if (!meta || !Array.isArray(meta.universe) || !Array.isArray(ctxs)) return null;
  return [meta, ctxs];
}

/** HIP-3 빌더 덱 목록(이름만) — 실패하면 메인 덱만 쓴다. */
export async function fetchHlDexes(): Promise<HlDex[]> {
  try {
    const rows = await info<Array<HlDex | null>>({ type: 'perpDexs' });
    return rows.filter((r): r is HlDex => !!r && typeof r.name === 'string' && r.name.length > 0);
  } catch {
    return [];
  }
}

/**
 * Propr 상장 종목의 실시간 시세 묶음.
 *  · 메인 덱 + HIP-3 덱(`xyz` 등)의 metaAndAssetCtxs 를 모두 읽어 붙이고
 *  · Propr 상장 스냅숏에 있는 종목만 남긴다(블랙리스트·미상장 제외).
 *  · OI 달러 환산 = openInterest × markPx. Propr 상장 규칙(OI $1M 초과)과 무관하게
 *    실제 상장 목록을 우선하고, OI 는 화면 표시·정렬 근거로만 쓴다.
 */
export async function fetchProprMarkets(): Promise<ProprMarket[]> {
  const dexes = await fetchHlDexes();
  const sources: Array<{ dex: string | null; data: HlMeta | null }> = [];
  const main = parseMeta(await info({ type: 'metaAndAssetCtxs' }).catch(() => null));
  sources.push({ dex: null, data: main });
  // HIP-3 덱은 개별 실패가 전체를 깨지 않게 병렬로 시도한다.
  const extras = await Promise.all(
    dexes.map(async (d) => ({ dex: d.name, data: parseMeta(await info({ type: 'metaAndAssetCtxs', dex: d.name }).catch(() => null)) })),
  );
  sources.push(...extras);

  const out: ProprMarket[] = [];
  const seen = new Set<string>();
  for (const src of sources) {
    if (!src.data) continue;
    const [meta, ctxs] = src.data;
    meta.universe.forEach((asset, i) => {
      const ctx = ctxs[i];
      if (!asset || !ctx || asset.isDelisted) return;
      const name = proprBase(asset.name);
      const listing = proprListingOf(asset.name);
      if (!listing || seen.has(name)) return;
      const markPx = Number(ctx.markPx ?? ctx.midPx ?? ctx.oraclePx ?? 0);
      if (!(markPx > 0)) return;
      const prevDayPx = Number(ctx.prevDayPx ?? 0);
      const oiUsd = Number(ctx.openInterest ?? 0) * markPx;
      const volume24h = Number(ctx.dayNtlVlm ?? 0);
      if (!Number.isFinite(oiUsd) || !Number.isFinite(volume24h)) return;
      seen.add(name);
      out.push({
        coin: asset.name,
        base: name,
        dex: src.dex,
        type: listing.type as ProprAssetType,
        // Propr 종목별 상한과 규정 자산군 상한 중 낮은 쪽
        maxLever: proprLeverageCap(name, listing.type),
        takerPct: listing.takerPct,
        price: markPx,
        prevDayPx: Number.isFinite(prevDayPx) && prevDayPx > 0 ? prevDayPx : 0,
        change24h: prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0,
        oiUsd,
        volume24h,
        fundingPct: Number(ctx.funding ?? 0) * 100,
        decimals: hlDecimals(markPx),
        asset: proprAssetClass(listing.type),
        szDecimals: asset.szDecimals,
      });
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 캔들
 * ------------------------------------------------------------------ */
const TF_MS: Record<TF, number> = { '1H': 3_600_000, '4H': 14_400_000 };
const TF_HL: Record<TF, string> = { '1H': '1h', '4H': '4h' };

/** 기본 제공 봉 수 — 엔진 최소 80봉·워밍업 70봉을 넉넉히 넘기면서 4h/1h 모두 60봉 초과 요금을 최소화 */
export const HL_BARS: Record<TF, number> = { '1H': 260, '4H': 260 };

interface RawHlCandle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}

/**
 * Hyperliquid 캔들 → COTA 캔들.
 * startTime/endTime 은 **필수**다(생략하면 서버가 최근 봉만 준다). 마지막 봉은 아직 진행 중일 수 있어
 * 엔진이 쓰는 종가 신호가 미완성 봉에 걸리지 않도록 그대로 둔다(기존 스캐너와 같은 규칙).
 */
export async function fetchHlCandles(coin: string, tf: TF, bars = HL_BARS[tf]): Promise<Candle[]> {
  const now = Date.now();
  const span = bars * TF_MS[tf];
  const rows = await info<RawHlCandle[]>({
    type: 'candleSnapshot',
    req: { coin, interval: TF_HL[tf], startTime: now - span, endTime: now },
  });
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r) => ({ t: Number(r.t), o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), v: Number(r.v) }))
    .filter((c) => [c.t, c.o, c.h, c.l, c.c, c.v].every((v) => Number.isFinite(v)) && c.o > 0)
    .sort((a, b) => a.t - b.t);
}

/** Propr 상장 종목 수(스냅숏) — 화면 표기용 */
export const PROPR_LISTED_COUNT = PROPR_LISTINGS.length;
