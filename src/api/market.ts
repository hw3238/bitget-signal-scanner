/**
 * 거래소 마켓 어댑터 — 스캐너·급등 탐색기·레이더가 같은 함수로 비트겟/바이낸스를 부른다.
 *
 *  · 비트겟: api.bitget (USDT-M 선물)
 *  · 바이낸스: api.binance (선물 → 451/차단 시 현물 data-api 폴백)
 *
 * 거래소별 시그널·캐시는 서로 섞이지 않는다(scanCache 키에 거래소가 들어간다).
 */
import type { Candle, Contract, TF, Ticker } from '../engine/types';
import type { Exchange, MarketSource } from '../lib/exchange';
import { fetchBinanceCandles, fetchBinanceContracts, fetchBinanceTickers, resetBinanceCache } from './binance';
import { fetchCandles, fetchContracts, fetchTickers } from './bitget';

/**
 * 거래소 전환 — 펀딩비 캐시만 비운다.
 *  · 출처 기억(선물/현물)은 **지우지 않는다**: 기기·망의 성질이라 전환할 때마다 다시 실패(451·CORS)하면
 *    전환마다 오류 로그·지연이 생긴다. 망이 바뀌면 30분 뒤 스스로 다시 확인한다.
 */
export function resetMarket(): void {
  resetBinanceCache();
}

/** 24h 티커. `symbols` 를 주면 그 종목만(바이낸스) — 비트겟은 항상 전체. */
export async function fetchMarketTickers(
  exchange: Exchange,
  symbols?: string[],
): Promise<{ tickers: Ticker[]; source: MarketSource }> {
  if (exchange === 'bitget') {
    return { tickers: await fetchTickers(), source: 'bitget-futures' };
  }
  const { tickers, source } = await fetchBinanceTickers(symbols);
  return { tickers, source: source === 'futures' ? 'binance-futures' : 'binance-spot' };
}

/** 계약 목록 — 바이낸스는 티커(거래대금 순위)를 함께 넘겨 스펙 요청 범위를 좁힌다. */
export async function fetchMarketContracts(
  exchange: Exchange,
  tickers: Ticker[],
  source: MarketSource,
): Promise<Contract[]> {
  if (exchange === 'bitget') return fetchContracts();
  const binance = source === 'binance-futures' ? 'futures' : 'spot';
  return fetchBinanceContracts(tickers, binance);
}

export async function fetchMarketCandles(
  exchange: Exchange,
  symbol: string,
  tf: TF,
  limit = 200,
): Promise<Candle[]> {
  return exchange === 'bitget' ? fetchCandles(symbol, tf, limit) : fetchBinanceCandles(symbol, tf, limit);
}
