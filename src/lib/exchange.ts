/**
 * 거래소 선택 — COTA 는 비트겟(Bitget)과 바이낸스(Binance) 두 마켓을 따로 스캔한다.
 *
 *  · 첫 방문: `cota.exchange.v1` 이 없으면 거래소 선택 화면을 먼저 보여준다(App.tsx).
 *  · 선택값은 localStorage 에 저장되어 다음 방문부터 바로 스캐너로 들어간다.
 *  · 헤더 칩·설정 탭에서 언제든 전환할 수 있고, 전환하면 이전 거래소의 시그널·급등 목록을
 *    비우고 새 거래소 마켓만 다시 스캔한다(useScanner).
 *
 * 로고는 `public/exchanges/*.svg` 에 내장한 **공식 로고 벡터**를 쓴다(외부 요청·CORS 없음).
 *   · Bitget  : bitget.com 공식 로고 파일(baseasset/img/v3-home/logo-simple2.svg)
 *   · Binance : Wikimedia Commons "Binance logo.svg" 의 공식 마크(심볼) 부분
 */
export type Exchange = 'bitget' | 'binance';

export interface ExchangeMeta {
  key: Exchange;
  /** 영문 브랜드명 */
  name: string;
  /** 한글 이름 */
  koName: string;
  /** 선택 카드 제목 — 예: `Binance (바이낸스)` */
  title: string;
  /** 선택 카드 설명 */
  desc: string;
  /** 내장 로고 경로(vite base './' 기준 상대 경로) */
  logo: string;
  /** 로고 뒤 배경(브랜드 컬러) */
  tint: string;
  /** 스캐너 요약 줄에 쓰는 마켓 이름 */
  marketLine: string;
  /** 급등 탐색기 등에서 쓰는 유니버스 이름 */
  universeLabel: string;
  /** 이 거래소에서 주문(자동매매·원클릭)이 가능한지 — 바이낸스는 시그널 전용 */
  tradable: boolean;
}

export const EXCHANGES: Record<Exchange, ExchangeMeta> = {
  binance: {
    key: 'binance',
    name: 'Binance',
    koName: '바이낸스',
    title: 'Binance (바이낸스)',
    desc: '바이낸스 USDT 마켓 실시간 시그널 · 급등 코인 탐지',
    logo: './exchanges/binance.svg',
    tint: '#F3BA2F',
    marketLine: '바이낸스 USDT 마켓',
    universeLabel: '바이낸스 USDT 마켓',
    tradable: false,
  },
  bitget: {
    key: 'bitget',
    name: 'Bitget',
    koName: '비트겟',
    title: 'Bitget (비트겟)',
    desc: '비트겟 USDT-M 선물 · 주식선물 · 24시간 자동매매',
    logo: './exchanges/bitget.svg',
    tint: '#00F0FF',
    marketLine: '비트겟 USDT-M 선물',
    universeLabel: '비트겟 코인 선물',
    tradable: true,
  },
};

/** 선택 화면·전환 시트의 표시 순서 */
export const EXCHANGE_ORDER: Exchange[] = ['binance', 'bitget'];

export const EXCHANGE_STORAGE_KEY = 'cota.exchange.v1';

export function isExchange(value: unknown): value is Exchange {
  return value === 'bitget' || value === 'binance';
}

/** 저장된 거래소 — 아직 고르지 않았으면 null(첫 방문) */
export function loadExchange(): Exchange | null {
  try {
    const raw = localStorage.getItem(EXCHANGE_STORAGE_KEY);
    // 구버전 저장값이 JSON 문자열(`"bitget"`)이어도 읽는다.
    const value = raw && raw.startsWith('"') ? JSON.parse(raw) : raw;
    return isExchange(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveExchange(exchange: Exchange): void {
  try {
    localStorage.setItem(EXCHANGE_STORAGE_KEY, exchange);
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
}

/** 실제로 연결된 마켓 데이터 출처 — 화면 배지에 솔직하게 표시한다. */
export type MarketSource =
  | 'bitget-futures'
  | 'binance-futures'
  | 'binance-spot';

export const MARKET_SOURCE_LABEL: Record<MarketSource, string> = {
  'bitget-futures': '비트겟 선물',
  'binance-futures': '바이낸스 선물',
  'binance-spot': '바이낸스 현물 데이터',
};

export function exchangeOfSource(source: MarketSource): Exchange {
  return source === 'bitget-futures' ? 'bitget' : 'binance';
}

export const marketSourceLabel = (source: MarketSource | null): string =>
  source ? MARKET_SOURCE_LABEL[source] : '연결 확인 중';
