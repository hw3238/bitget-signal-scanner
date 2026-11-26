/**
 * 🏦 거래소 선택 · 바이낸스 어댑터 단위 검증
 *   실행: npm run check:exchange
 *
 * 1) 거래소 메타 — 로고 경로·선택 화면 순서·주문 가능 여부
 * 2) 저장/불러오기 — `cota.exchange.v1` (첫 방문 null · 값 검증 · 구버전 JSON 문자열)
 * 3) 바이낸스 출처 선택 — 선물 451 시 현물 폴백 순서
 * 4) 심볼 정보 → 계약 스펙 (호가·수량 단위, USDT/거래정지/딜리버리 제외)
 * 5) 24h 티커·펀딩비·캔들 파싱 (USDT 마켓만, 깨진 행 제외, 시간 오름차순)
 * 6) 유니버스 — 바이낸스에는 주식선물이 섞이지 않는다
 */
import {
  EXCHANGES,
  EXCHANGE_ORDER,
  EXCHANGE_STORAGE_KEY,
  loadExchange,
  marketSourceLabel,
  saveExchange,
  type Exchange,
} from '../src/lib/exchange';
import {
  candlesFromRows,
  contractOf,
  contractsFromInfo,
  fundingFromPremium,
  intervalOf,
  planSources,
  stepSpec,
  tickSpec,
  tickersFrom24h,
  topSymbols,
} from '../src/api/binance';
import { pickUniverse } from '../src/engine/universe';
import type { Ticker } from '../src/engine/types';

let pass = 0;
const fails: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fails.push(name);
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ---------------------------------------------------------------- *
 * 1) 거래소 메타
 * ---------------------------------------------------------------- */
check('거래소는 비트겟·바이낸스 둘', Object.keys(EXCHANGES).sort().join(',') === 'binance,bitget');
check('선택 화면 순서 = 바이낸스 → 비트겟', EXCHANGE_ORDER.join('>') === 'binance>bitget');
check(
  '로고 경로 내장(public/exchanges)',
  EXCHANGES.binance.logo === './exchanges/binance.svg' && EXCHANGES.bitget.logo === './exchanges/bitget.svg',
  `${EXCHANGES.binance.logo} / ${EXCHANGES.bitget.logo}`,
);
check('바이낸스는 주문 불가(탐지 전용)', EXCHANGES.binance.tradable === false);
check('비트겟은 주문 가능(자동매매)', EXCHANGES.bitget.tradable === true);
check(
  '선택 카드 설명 문구',
  EXCHANGES.binance.desc.includes('USDT 마켓') && EXCHANGES.bitget.desc.includes('자동매매'),
  `${EXCHANGES.binance.desc} / ${EXCHANGES.bitget.desc}`,
);
check(
  '출처 배지 라벨',
  marketSourceLabel('binance-futures') === '바이낸스 선물' &&
    marketSourceLabel('binance-spot') === '바이낸스 현물 데이터' &&
    marketSourceLabel('bitget-futures') === '비트겟 선물' &&
    marketSourceLabel(null) === '연결 확인 중',
);

/* ---------------------------------------------------------------- *
 * 2) 저장/불러오기
 * ---------------------------------------------------------------- */
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

check('첫 방문(저장값 없음) → null', loadExchange() === null);
saveExchange('binance');
check('바이낸스 저장 → 그대로 읽기', loadExchange() === 'binance', store.get(EXCHANGE_STORAGE_KEY));
saveExchange('bitget');
check('비트겟으로 전환 저장', loadExchange() === 'bitget');
store.set(EXCHANGE_STORAGE_KEY, '"binance"');
check('구버전 JSON 문자열 저장값 호환', loadExchange() === 'binance');
store.set(EXCHANGE_STORAGE_KEY, 'upbit');
check('알 수 없는 거래소 → null(선택 화면)', loadExchange() === null);
store.set(EXCHANGE_STORAGE_KEY, '');
check('빈 문자열 → null', loadExchange() === null);

/* ---------------------------------------------------------------- *
 * 3) 출처 선택
 * ---------------------------------------------------------------- */
check('저장된 출처가 있으면 그곳만', planSources({ preferred: 'spot', futuresBlocked: true }).join() === 'spot');
check(
  '처음엔 선물 → 현물 순서',
  planSources({ preferred: null, futuresBlocked: false }).join() === 'futures,spot',
);
check(
  '선물이 막혔으면 현물만',
  planSources({ preferred: null, futuresBlocked: true }).join() === 'spot',
);

/* ---------------------------------------------------------------- *
 * 4) 계약 스펙
 * ---------------------------------------------------------------- */
check(
  'tickSize 0.01000000 → 소수 2자리·스텝 1 (최소 호가 0.01)',
  tickSpec('0.01000000').decimals === 2 && tickSpec('0.01000000').priceEndStep === 1,
);
check(
  'tickSize 5.00000000 → 소수 0자리·스텝 5 (최소 호가 5)',
  tickSpec('5.00000000').decimals === 0 && tickSpec('5.00000000').priceEndStep === 5,
);
check(
  'tickSize 0.00000100 → 소수 6자리·스텝 1',
  tickSpec('0.00000100').decimals === 6 && tickSpec('0.00000100').priceEndStep === 1,
);
check('tickSize 없음 → 기본 2자리', tickSpec('').decimals === 2 && tickSpec(undefined).priceEndStep === 1);
check(
  'stepSize 0.00100000 → volumePlace 3 · 최소 단위 0.001',
  stepSpec('0.00100000').volumePlace === 3 && stepSpec('0.00100000').step === 0.001,
);
check('stepSize 1.00000000 → volumePlace 0', stepSpec('1.00000000').volumePlace === 0);

const futuresInfo = {
  symbol: 'BTCUSDT',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  status: 'TRADING',
  contractType: 'PERPETUAL',
  filters: [
    { filterType: 'PRICE_FILTER', tickSize: '0.10' },
    { filterType: 'LOT_SIZE', minQty: '0.001', stepSize: '0.001' },
    { filterType: 'MIN_NOTIONAL', notional: '5' },
  ],
};
const btc = contractOf(futuresInfo, 'futures');
check(
  '선물 BTCUSDT 계약 — 소수 1자리·호가 1·최소수량 0.001·최소금액 5',
  !!btc &&
    btc.symbol === 'BTCUSDT' &&
    btc.base === 'BTC' &&
    btc.asset === 'crypto' &&
    btc.decimals === 1 &&
    btc.priceEndStep === 1 &&
    btc.minTradeNum === 0.001 &&
    btc.volumePlace === 3 &&
    btc.minTradeUsdt === 5,
  JSON.stringify(btc),
);
check(
  'BTCUSDT 호가 실제값 = 0.1',
  !!btc && btc.priceEndStep! * 10 ** -(btc.decimals ?? 0) === 0.1,
);
check(
  'USDT 마켓이 아니면 제외(BTCBUSD)',
  contractOf({ ...futuresInfo, symbol: 'BTCBUSD', quoteAsset: 'BUSD' }, 'futures') === null,
);
check('거래 정지(TRADING 아님) 제외', contractOf({ ...futuresInfo, status: 'BREAK' }, 'futures') === null);
check(
  '선물 딜리버리 계약 제외',
  contractOf({ ...futuresInfo, contractType: 'CURRENT_QUARTER' }, 'futures') === null,
);
check(
  '현물은 contractType 무관',
  contractOf({ ...futuresInfo, contractType: undefined }, 'spot')?.symbol === 'BTCUSDT',
);
const spotInfo = {
  symbol: 'SOLUSDT',
  baseAsset: 'SOL',
  quoteAsset: 'USDT',
  status: 'TRADING',
  filters: [
    { filterType: 'PRICE_FILTER', tickSize: '0.01000000' },
    { filterType: 'LOT_SIZE', minQty: '0.00100000', stepSize: '0.00100000' },
    { filterType: 'NOTIONAL', minNotional: '5.00000000' },
  ],
};
check(
  '현물 SOLUSDT 계약 — NOTIONAL 최소금액 5',
  contractOf(spotInfo, 'spot')?.minTradeUsdt === 5 && contractOf(spotInfo, 'spot')?.decimals === 2,
);
const many = contractsFromInfo(
  [futuresInfo, spotInfo, { symbol: 'ETHBTC', quoteAsset: 'BTC', status: 'TRADING' }],
  'futures',
);
check('계약 목록은 USDT 마켓만 남긴다', many.length === 2 && many.every((c) => c.symbol.endsWith('USDT')), `${many.length}건`);

/* ---------------------------------------------------------------- *
 * 5) 티커·펀딩·캔들
 * ---------------------------------------------------------------- */
const tickers = tickersFrom24h(
  [
    { symbol: 'BTCUSDT', lastPrice: '60838.23', priceChangePercent: '2.606', quoteVolume: '123456789', highPrice: '61000', lowPrice: '59000' },
    { symbol: 'ETHUSDT', lastPrice: '3000.5', priceChangePercent: '-1.2', quoteVolume: '5000000', highPrice: '3100', lowPrice: '2900' },
    { symbol: 'ETHBTC', lastPrice: '0.0279', priceChangePercent: '0.5', quoteVolume: '333' },
    { symbol: 'BADUSDT', lastPrice: '0', priceChangePercent: '0', quoteVolume: '1' },
    { symbol: 'EURUSDT', lastPrice: '1.0983', priceChangePercent: '0.1', quoteVolume: '9000000' },
  ],
  new Map([['ETHUSDT', 0.0125]]),
);
check('24h 티커 — USDT 마켓 2건만(비USDT·가격0·법정화폐 제외)', tickers.length === 2, tickers.map((t) => t.symbol).join(','));
check(
  '법정화폐 쌍(EURUSDT)은 계약에서도 제외',
  contractOf({ ...futuresInfo, symbol: 'EURUSDT', baseAsset: 'EUR' }, 'spot') === null,
);
check(
  '티커 값 매핑(현재가·등락·거래대금·고저)',
  tickers[0].last === 60838.23 &&
    tickers[0].change24h === 2.606 &&
    tickers[0].quoteVolume === 123456789 &&
    tickers[0].high24h === 61000 &&
    tickers[0].low24h === 59000,
);
check('펀딩비는 심볼별로 붙는다(없으면 0)', tickers[1].fundingRate === 0.0125 && tickers[0].fundingRate === 0);
const funding = fundingFromPremium([
  { symbol: 'BTCUSDT', lastFundingRate: '0.0001' },
  { symbol: 'ETHUSDT', lastFundingRate: '-0.00025' },
  { symbol: 'X', lastFundingRate: 'oops' },
]);
check(
  'premiumIndex → 펀딩비 % 변환',
  Math.abs((funding.get('BTCUSDT') ?? 0) - 0.01) < 1e-9 && Math.abs((funding.get('ETHUSDT') ?? 0) + 0.025) < 1e-9,
  `${funding.get('BTCUSDT')} / ${funding.get('ETHUSDT')}`,
);
const candles = candlesFromRows([
  [3, '3', '4', '2', '3.5', '10'],
  [1, '1', '2', '0.5', '1.5', '5'],
  [2, 'oops', '2', '1', '1.2', '7'],
  [4, '3.5', '3.8', '3.1', '3.2', '8'],
]);
check(
  '캔들 — 깨진 행 제외 + 시간 오름차순',
  candles.length === 3 && candles.map((c) => c.t).join(',') === '1,3,4',
  candles.map((c) => c.t).join(','),
);
check('캔들 OHLCV 매핑', candles[1].o === 3 && candles[1].h === 4 && candles[1].l === 2 && candles[1].c === 3.5 && candles[1].v === 10);
check('TF → interval', intervalOf('1H') === '1h' && intervalOf('4H') === '4h');
const ranked = topSymbols(
  [
    { symbol: 'AUSDT', last: 1, change24h: 0, quoteVolume: 10, fundingRate: 0, high24h: 0, low24h: 0 },
    { symbol: 'BUSDT', last: 1, change24h: 0, quoteVolume: 300, fundingRate: 0, high24h: 0, low24h: 0 },
    { symbol: 'CUSDT', last: 1, change24h: 0, quoteVolume: 200, fundingRate: 0, high24h: 0, low24h: 0 },
    { symbol: 'DUSDT', last: 1, change24h: 0, quoteVolume: 0, fundingRate: 0, high24h: 0, low24h: 0 },
  ],
  2,
);
check('스펙 요청 심볼 = 거래대금 상위 N', ranked.join(',') === 'BUSDT,CUSDT', ranked.join(','));

/* ---------------------------------------------------------------- *
 * 6) 유니버스 — 바이낸스에는 주식선물이 없다
 * ---------------------------------------------------------------- */
const binanceContracts = contractsFromInfo(
  [
    futuresInfo,
    spotInfo,
    { symbol: 'TSLAUSDT', baseAsset: 'TSLA', quoteAsset: 'USDT', status: 'TRADING', contractType: 'PERPETUAL', filters: [] },
  ],
  'futures',
);
const binanceTickers: Ticker[] = binanceContracts.map((c, i) => ({
  symbol: c.symbol,
  last: 100 - i,
  change24h: 0,
  quoteVolume: 1_000_000 - i,
  fundingRate: 0,
  high24h: 0,
  low24h: 0,
}));
const universe = pickUniverse(binanceContracts, binanceTickers);
check(
  '바이낸스 유니버스에 주식선물(asset=stock) 없음',
  universe.every((c) => c.asset === 'crypto'),
  universe.map((c) => `${c.symbol}:${c.asset}`).join(','),
);
check('바이낸스 유니버스는 계약 목록 안에서만', universe.length <= binanceContracts.length && universe.length > 0, `${universe.length}개`);

/* ---------------------------------------------------------------- *
 * 마무리
 * ---------------------------------------------------------------- */
console.log('');
console.log(`거래소 선택·바이낸스 어댑터 검증: ${pass}/${pass + fails.length} 통과`);
if (fails.length) {
  console.log(`실패: ${fails.join(' · ')}`);
  process.exit(1);
}
