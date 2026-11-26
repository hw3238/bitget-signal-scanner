import type { AssetClass } from '../engine/types';

/**
 * 코인 로고 아이콘 — 저장소에 내장된 `public/coin-icons/*.png`
 *
 * 아이콘은 `scripts/fetch-coin-icons.mjs` 가 생성 시점에 실제 HTTP 200으로 검증해 받아 둔다
 * (OKX 자산 아이콘 → Binance → CoinCap 순서). 미리 받아 두면
 *  · 없는 코인에 요청을 보내 콘솔에 404를 남기지 않고,
 *  · 같은 출처 파일이라 CORS·캔버스 오염이 없으며,
 *  · 앱(WebView)에서도 즉시 뜬다.
 * 매니페스트에 없는 코인(신규 밈코인)과 주식선물은 글자 아바타로 폴백한다.
 */
const ICON_DIR = `${import.meta.env.BASE_URL}coin-icons/`;

let manifestPromise: Promise<Record<string, string>> | null = null;

function loadManifest(): Promise<Record<string, string>> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${ICON_DIR}manifest.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { icons?: Record<string, string> } | null) =>
        body && body.icons && typeof body.icons === 'object' ? body.icons : {},
      )
      .catch(() => ({}));
  }
  return manifestPromise;
}

/** 매니페스트 키 — `1000PEPE`·`tsla` 같은 표기를 대문자 기본 심볼로 맞춘다. */
export function coinIconKey(base: string): string {
  return base.replace(/\+$/, '').replace(/STOCK$/, '').trim().toUpperCase();
}

/** 종목 로고 URL. 로고가 없는 종목(주식선물·신규 코인)은 null → 글자 아바타. */
export async function coinIconUrl(base: string, asset: AssetClass): Promise<string | null> {
  if (asset !== 'crypto') return null;
  const key = coinIconKey(base);
  if (!key) return null;
  const icons = await loadManifest();
  const file = icons[key];
  return file ? `${ICON_DIR}${file}` : null;
}

/** 비트겟 USDT-M 선물 거래 페이지 (실제 HTTP 200 확인: /futures/usdt/BTCUSDT) */
export function bitgetFuturesUrl(symbol: string): string {
  return `https://www.bitget.com/futures/usdt/${symbol.replace(/\s+/g, '').toUpperCase()}`;
}

/** 바이낸스 USDT 마켓 거래 페이지 — BTCUSDT → /trade/BTC_USDT */
export function binanceTradeUrl(symbol: string): string {
  const base = symbol.replace(/USDT$/i, '').replace(/\s+/g, '').toUpperCase();
  return `https://www.binance.com/en/trade/${base}_USDT`;
}
