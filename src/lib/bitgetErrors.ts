/**
 * 비트겟 주문 오류 → 한글 안내 (v1.5.5).
 *
 * 거래소는 `{"code":"40774","msg":"The order type for unilateral position ..."}` 처럼
 * 영문 메시지와 숫자 코드만 돌려준다. 사용자는 "왜 안 들어갔는지"를 알아야 다음 판단을 할 수
 * 있으므로, 화면·로그·알림에는 **항상 쉬운 한글 설명을 앞세우고** 원문 코드를 뒤에 붙인다.
 *
 * 같은 규칙이 안드로이드 네이티브(`BitgetErrors.java`)에도 있다 — 네이티브가 재시도·보정까지
 * 끝낸 뒤의 최종 사유도 같은 문장으로 내려온다. 두 구현의 코드 목록은
 * `scripts/autotrade-check.ts`가 고정한다.
 */

export type BitgetErrorKind =
  | 'auth'
  | 'clock'
  | 'account-mode'
  | 'position-mode'
  | 'insufficient'
  | 'min-order'
  | 'qty'
  | 'price-tick'
  | 'tpsl'
  | 'symbol'
  | 'mark-price'
  | 'duplicate'
  | 'position-limit'
  | 'reduce-only'
  | 'liquidation'
  | 'restricted'
  | 'rate-limit'
  | 'retry'
  | 'unknown';

interface ErrorInfo {
  kind: BitgetErrorKind;
  /** 사용자에게 보여줄 한 문장 — 왜 실패했는지 + 무엇을 하면 되는지 */
  text: string;
}

/**
 * 코드 → 한글 안내. `*` 규칙은 접두어 일치(예: `25` 계열 청산가 관련)에 쓴다.
 * 코드는 비트겟 v2(클래식)·v3(통합)에서 같은 의미로 쓰이는 것만 묶었다.
 */
const TABLE: Record<string, ErrorInfo> = {
  /* --- 키·권한 --- */
  '40006': { kind: 'auth', text: 'API 키(ACCESS-KEY)가 올바르지 않습니다 — 비트겟 API 관리에서 키를 다시 확인해 주세요.' },
  '40009': { kind: 'auth', text: 'API 시크릿 서명이 거절됐습니다 — Secret을 다시 붙여넣어 주세요.' },
  '40037': { kind: 'auth', text: 'API 키를 찾을 수 없습니다 — 키가 삭제됐는지 확인해 주세요.' },
  '40012': { kind: 'auth', text: 'API Passphrase가 맞지 않습니다 — 발급 때 정한 문구를 다시 확인해 주세요.' },
  '40014': { kind: 'auth', text: 'API 키 권한이 부족합니다 — 비트겟 API 관리에서 선물(통합계정) 거래·읽기 권한을 켜 주세요.' },
  '40018': { kind: 'auth', text: '모의투자(Demo) 키와 거래 모드가 맞지 않습니다 — Demo 계좌에서 발급한 키인지 확인해 주세요.' },
  '40109': { kind: 'auth', text: '출금 권한이 있는 키는 쓸 수 없습니다 — 거래 권한만 있는 키로 바꿔 주세요.' },
  '40040': { kind: 'auth', text: 'API 키 권한 설정을 확인해 주세요 — 통합계정(UTA) 거래·계정 관리 권한이 필요합니다.' },
  /* --- 시간 --- */
  '40004': { kind: 'clock', text: '휴대폰 시각이 거래소와 어긋났습니다 — 설정에서 자동 시간(네트워크 시간)을 켜 주세요.' },
  '40005': { kind: 'clock', text: '휴대폰 시각이 거래소와 어긋났습니다 — 설정에서 자동 시간(네트워크 시간)을 켜 주세요.' },
  '40008': { kind: 'clock', text: '요청 시간(timestamp)이 만료됐습니다 — 휴대폰 자동 시간을 켜 주세요.' },
  /* --- 계정 종류·포지션 모드 --- */
  '40084': { kind: 'account-mode', text: '클래식 계정(v2) 전용 요청이었습니다 — COTA가 통합계정(v3)으로 바꿔 다시 시도합니다.' },
  '40085': { kind: 'account-mode', text: '통합계정(v3) 전용 요청이었습니다 — COTA가 클래식 계정(v2)으로 바꿔 다시 시도합니다.' },
  '40774': { kind: 'position-mode', text: '계좌 포지션 모드(단방향/양방향)와 주문 형식이 맞지 않습니다 — COTA가 모드에 맞춰 다시 주문합니다.' },
  '400172': { kind: 'insufficient', text: '가용 USDT 증거금이 부족합니다 — 리스크 %나 레버리지를 줄여 주세요.' },
  /* --- 잔고·수량·금액 --- */
  '43012': { kind: 'insufficient', text: '가용 USDT 증거금이 부족합니다 — 리스크 %나 레버리지를 줄여 주세요.' },
  '43011': { kind: 'insufficient', text: '가용 USDT 증거금이 부족합니다 — 리스크 %나 레버리지를 줄여 주세요.' },
  '40754': { kind: 'insufficient', text: '가용 USDT 증거금이 부족합니다 — COTA가 가용 잔고의 95% 안으로 수량을 줄여 다시 시도합니다.' },
  '43027': { kind: 'min-order', text: '주문 금액이 비트겟 최소 주문 금액(보통 5 USDT)에 못 미칩니다 — 리스크 %를 키워 주세요.' },
  '45110': { kind: 'min-order', text: '주문 금액이 비트겟 최소 주문 금액(보통 5 USDT)보다 작습니다 — 리스크 %를 키워 주세요.' },
  '45114': { kind: 'min-order', text: '주문 금액이 비트겟 최소 주문 금액보다 작습니다 — 리스크 %를 키워 주세요.' },
  '45111': { kind: 'qty', text: '주문 수량이 거래소 최소 거래 수량보다 작습니다 — 리스크 %를 키워 주세요.' },
  '43006': { kind: 'qty', text: '주문 수량이 거래소 최소 거래 수량보다 작습니다 — 리스크 %를 키워 주세요.' },
  '40762': { kind: 'qty', text: '주문 수량이 거래소 최소 거래 수량보다 작습니다(계약 단위로 내림된 결과) — 리스크 %를 키워 주세요.' },
  '45112': { kind: 'qty', text: '주문 수량이 거래소 최대 주문 수량을 넘었습니다 — 리스크 %를 줄여 주세요.' },
  '25567': { kind: 'qty', text: '주문 수량이 한 번에 낼 수 있는 최대 수량을 넘었습니다 — 리스크 %를 줄여 주세요.' },
  '25230': { kind: 'qty', text: '주문 수량이 거래소 최대 주문 수량을 넘었습니다 — 리스크 %를 줄여 주세요.' },
  '25233': { kind: 'qty', text: '주문 수량이 거래소 최대 주문 수량을 넘었습니다 — 리스크 %를 줄여 주세요.' },
  '40808': { kind: 'qty', text: '주문 수량이 거래소 계약 단위(스텝)와 맞지 않습니다 — COTA가 계약 단위로 다시 맞춰 주문합니다.' },
  /* --- 가격·호가 --- */
  '45115': { kind: 'price-tick', text: '주문 가격·목표가·손절가가 거래소 호가 단위와 맞지 않습니다 — COTA가 호가 단위로 보정해 다시 시도합니다.' },
  '25244': { kind: 'price-tick', text: '주문 가격·목표가·손절가가 거래소 호가 단위와 맞지 않습니다 — COTA가 호가 단위로 보정해 다시 시도합니다.' },
  '43028': { kind: 'price-tick', text: '가격이 거래소 호가 단위의 정수 배수가 아닙니다 — COTA가 호가 단위로 보정합니다.' },
  '40815': { kind: 'price-tick', text: '지정가가 현재 최우선 매수호가보다 높습니다 — 가격을 낮춰 주세요.' },
  '40816': { kind: 'price-tick', text: '지정가가 현재 최우선 매도호가보다 낮습니다 — 가격을 높여 주세요.' },
  '40812': { kind: 'tpsl', text: '목표가·손절가(TP/SL)가 현재가 기준으로 유효하지 않습니다 — COTA가 안전 여유를 두고 다시 맞춥니다.' },
  '25585': { kind: 'tpsl', text: '현재가가 이미 목표가를 지나 목표가를 걸 수 없습니다 — 이 진입은 건너뜁니다.' },
  '25586': { kind: 'tpsl', text: '현재가가 이미 손절가에 닿아 진입을 건너뜁니다.' },
  '25587': { kind: 'tpsl', text: '현재가가 이미 목표가를 지나 목표가를 걸 수 없습니다 — 이 진입은 건너뜁니다.' },
  '25588': { kind: 'tpsl', text: '현재가가 이미 손절가에 닿아 진입을 건너뜁니다.' },
  '25579': { kind: 'tpsl', text: '목표가·손절가가 현재가(또는 평균단가) 기준 방향과 맞지 않습니다.' },
  '25580': { kind: 'tpsl', text: '목표가·손절가가 현재가(또는 평균단가) 기준 방향과 맞지 않습니다.' },
  '25581': { kind: 'tpsl', text: '목표가·손절가가 현재가(또는 평균단가) 기준 방향과 맞지 않습니다.' },
  '25582': { kind: 'tpsl', text: '목표가·손절가가 현재가(또는 평균단가) 기준 방향과 맞지 않습니다.' },
  '25589': { kind: 'tpsl', text: '목표가·손절가가 현재가 기준 방향과 맞지 않습니다 — COTA가 다시 맞춥니다.' },
  '25590': { kind: 'tpsl', text: '목표가·손절가가 현재가 기준 방향과 맞지 않습니다 — COTA가 다시 맞춥니다.' },
  '25591': { kind: 'tpsl', text: '목표가·손절가가 현재가 기준 방향과 맞지 않습니다 — COTA가 다시 맞춥니다.' },
  '25592': { kind: 'tpsl', text: '목표가·손절가가 현재가 기준 방향과 맞지 않습니다 — COTA가 다시 맞춥니다.' },
  '25593': { kind: 'tpsl', text: '이 종목은 목표가·손절가 설정을 지원하지 않습니다 — TP/SL 없이 주문합니다.' },
  '25594': { kind: 'tpsl', text: '이 종목에는 이미 목표가·손절가 주문이 걸려 있습니다.' },
  /* --- 종목 --- */
  '25100': { kind: 'symbol', text: '거래소에 없는(또는 상장폐지된) 종목입니다 — 감시 목록에서 제외했습니다.' },
  '25101': { kind: 'symbol', text: '이 종목은 점검 중이거나 아직 거래가 열리지 않았습니다 — 잠시 후 다시 시도합니다.' },
  '25102': { kind: 'symbol', text: '이 종목은 점검 중이거나 곧 상장폐지될 예정입니다 — 감시 목록에서 제외했습니다.' },
  '25104': { kind: 'symbol', text: '거래소에 없는(또는 상장폐지된) 종목입니다 — 감시 목록에서 제외했습니다.' },
  '25105': { kind: 'symbol', text: '이 종목은 지금 신규 진입이 막혀 있습니다 — 감시 목록에서 제외했습니다.' },
  '40309': { kind: 'symbol', text: '이미 상장폐지된 종목입니다 — 감시 목록에서 제외했습니다.' },
  '45119': { kind: 'symbol', text: '이 종목은 신규 진입을 받지 않습니다(거래 제한·상장폐지) — 감시 목록에서 제외했습니다.' },
  '45121': { kind: 'mark-price', text: '마크 가격이 시장과 크게 벌어져 거래소가 고위험으로 판단했습니다 — 잠시 후 다시 시도합니다.' },
  /* --- 중복·포지션 --- */
  '25212': { kind: 'duplicate', text: '같은 주문이 이미 접수되어 있습니다 — 중복 주문을 막았습니다.' },
  '25229': { kind: 'position-limit', text: '보유 포지션 수가 거래소 한도를 넘었습니다 — 일부 포지션을 청산해 주세요.' },
  '45116': { kind: 'position-limit', text: '보유 포지션 수가 거래소 한도를 넘었습니다 — 일부 포지션을 청산해 주세요.' },
  '25227': { kind: 'position-limit', text: '청산할 포지션이 없습니다(이미 청산됐을 수 있습니다).' },
  '25237': { kind: 'reduce-only', text: '이 청산 주문은 양방향(헤지) 모드에서만 가능합니다.' },
  '25232': { kind: 'reduce-only', text: '같은 방향의 미체결 축소 주문이 있어 거절됐습니다 — 비트겟 주문 목록을 확인해 주세요.' },
  '25574': { kind: 'reduce-only', text: '축소 주문 보호 규칙에 걸렸습니다 — 비트겟 주문 목록을 확인해 주세요.' },
  /* --- 계좌 상태 --- */
  '40760': { kind: 'liquidation', text: '계좌가 청산 처리 중이라 새 주문을 받지 않습니다 — 청산이 끝난 뒤 다시 시도합니다.' },
  '40022': { kind: 'restricted', text: '이 계좌의 거래가 제한된 상태입니다 — 비트겟 고객센터에 문의해 주세요.' },
  '40710': { kind: 'restricted', text: '계좌 상태가 정상이 아닙니다 — 비트겟 고객센터에 문의해 주세요.' },
  '40763': { kind: 'position-limit', text: '포지션 규모가 거래소 등급(tier) 한도를 넘었습니다 — 레버리지나 리스크 %를 줄여 주세요.' },
  '45118': { kind: 'position-limit', text: '미체결 주문 수가 거래소 한도에 닿았습니다 — 기존 주문을 정리해 주세요.' },
  /* --- 일시 오류·레이트리밋 --- */
  '429': { kind: 'rate-limit', text: '요청이 너무 잦아 거래소가 잠시 막았습니다 — 잠깐 뒤 자동으로 다시 시도합니다.' },
  '40034': { kind: 'rate-limit', text: '요청 한도를 넘었습니다 — 잠깐 뒤 자동으로 다시 시도합니다.' },
  '25004': { kind: 'rate-limit', text: '요청 한도를 넘었습니다 — 잠깐 뒤 자동으로 다시 시도합니다.' },
  '30007': { kind: 'rate-limit', text: '요청 한도를 넘었습니다 — 잠깐 뒤 자동으로 다시 시도합니다.' },
  '25003': { kind: 'retry', text: '거래소가 동시 처리 중입니다 — 잠깐 뒤 자동으로 다시 시도합니다.' },
  '40908': { kind: 'retry', text: '거래소가 주문을 처리 중입니다 — 잠깐 뒤 자동으로 다시 시도합니다.' },
  '40725': { kind: 'retry', text: '거래소 서버가 잠시 불안정합니다 — 자동으로 다시 시도합니다.' },
  '45001': { kind: 'retry', text: '거래소가 알 수 없는 오류를 돌려줬습니다 — 자동으로 다시 시도합니다.' },
};

/** 원문 메시지에만 단서가 있는 경우(코드가 낯설 때) */
const MESSAGE_RULES: Array<{ re: RegExp; kind: BitgetErrorKind; text: string }> = [
  { re: /posSide|position mode|hedge/i, kind: 'position-mode', text: '계좌 포지션 모드(단방향/양방향)와 주문 형식이 맞지 않습니다.' },
  { re: /insufficient|balance/i, kind: 'insufficient', text: '가용 USDT 증거금이 부족합니다.' },
  { re: /minimum|less than/i, kind: 'min-order', text: '주문 수량·금액이 거래소 최소 기준보다 작습니다.' },
  { re: /multiple of|precision|tick/i, kind: 'price-tick', text: '가격이 거래소 호가 단위와 맞지 않습니다.' },
  { re: /time ?stamp/i, kind: 'clock', text: '휴대폰 시각이 거래소와 어긋났습니다.' },
  { re: /signature|passphrase|apikey|api key/i, kind: 'auth', text: 'API 키·시크릿·문구를 확인해 주세요.' },
  { re: /delist|not support|suspend|maintenance/i, kind: 'symbol', text: '이 종목은 지금 거래할 수 없습니다.' },
  { re: /rate ?limit|too many/i, kind: 'rate-limit', text: '요청이 너무 잦습니다 — 잠깐 뒤 다시 시도합니다.' },
];

export interface BitgetErrorKo {
  code: string;
  kind: BitgetErrorKind;
  /** 한글 설명 한 문장 */
  text: string;
}

/** 코드·원문 → 한글 안내(코드 표 → 원문 규칙 → 기본 문장 순) */
export function explainBitgetError(code: string | null | undefined, rawMessage?: string | null): BitgetErrorKo {
  const c = String(code ?? '').trim();
  const hit = c ? TABLE[c] : undefined;
  if (hit) return { code: c, kind: hit.kind, text: hit.text };
  const raw = String(rawMessage ?? '').trim();
  if (raw) {
    for (const rule of MESSAGE_RULES) {
      if (rule.re.test(raw)) return { code: c, kind: rule.kind, text: rule.text };
    }
  }
  if (c.startsWith('guard:')) {
    return { code: c, kind: 'min-order', text: raw || 'COTA가 주문 전에 안전 규칙으로 막았습니다.' };
  }
  return {
    code: c,
    kind: 'unknown',
    text: raw
      ? `거래소가 주문을 거절했습니다 — ${raw}`
      : '거래소가 주문을 거절했습니다(사유 미확인) — 잠시 후 자동으로 다시 시도합니다.',
  };
}

/** 화면·로그에 그대로 남기는 한 줄 — `한글 설명 (코드 40774 · 원문 …)` */
export function formatBitgetErrorKo(code: string | null | undefined, rawMessage?: string | null): string {
  const info = explainBitgetError(code, rawMessage);
  // guard:* 는 거래소 코드가 아니라 앱이 주문 전에 막은 표시다 — 사유 문장만 남긴다.
  if (info.code.startsWith('guard:')) return info.text;
  const raw = String(rawMessage ?? '').trim();
  const tail: string[] = [];
  if (info.code) tail.push(`코드 ${info.code}`);
  // 한글 설명을 만들 때 이미 원문을 그대로 인용한 경우에는 중복해서 붙이지 않는다.
  if (raw && !info.text.includes(raw)) tail.push(`원문 ${raw}`);
  return tail.length ? `${info.text} (${tail.join(' · ')})` : info.text;
}

/* ---------------- 자동 복구 분류 — 네이티브 재시도 규칙과 같다 ---------------- */

const kindsOf = (k: BitgetErrorKind) => (code: string | null | undefined, msg?: string | null) =>
  explainBitgetError(code, msg).kind === k;

/** 포지션 모드(단방향/양방향) 불일치 → posSide 유무를 뒤집어 재시도 */
export const isPositionModeError = kindsOf('position-mode');
/** 가격·호가 단위 오류 → 계약 호가 재조회 후 보정 재시도 */
export const isPriceTickError = kindsOf('price-tick');
/** 수량·계약 단위 오류 → 계약 정보 재조회 후 수량 재계산 */
export const isSizeError = kindsOf('qty');
/** 증거금 부족 → 가용 잔고의 95%로 수량을 줄여 재시도 */
export const isInsufficientError = kindsOf('insufficient');
/** TP/SL 방향·가격 오류 → 안전 여유를 두고 다시 맞춤 */
export const isTpSlError = kindsOf('tpsl');
/** 종목 자체를 쓸 수 없음 → 오늘 제외 목록에 넣고 반복 실패 방지 */
export const isSymbolError = kindsOf('symbol');
/** 일시 오류 — 잠깐 뒤 같은 주문을 다시 보낸다 */
export const isRetryableError = (code: string | null | undefined, msg?: string | null) => {
  const kind = explainBitgetError(code, msg).kind;
  return kind === 'retry' || kind === 'rate-limit';
};
/** 키·권한 — 재시도해도 결과가 같다 */
export const isAuthError = kindsOf('auth');

/** 자동 복구가 실제로 했던 일 — 서비스가 `자동 보정:` 로그로 남긴다 */
export type RecoveryAction =
  | 'tick'
  | 'size'
  | 'mode-flip'
  | 'account-mode'
  | 'tp-sl'
  | 'margin-cap'
  | 'demo-skip'
  | 'retry';

export const RECOVERY_LABEL: Record<RecoveryAction, string> = {
  tick: '호가 단위 보정',
  size: '계약 수량 단위 재계산',
  'mode-flip': '포지션 모드에 맞춰 주문 형식 변경',
  'account-mode': '계정 종류(통합/클래식) 전환',
  'tp-sl': '목표가·손절가 안전 여유 보정',
  'margin-cap': '가용 증거금 95%로 수량 축소',
  'demo-skip': '모의투자 미지원 종목 제외',
  retry: '일시 오류 재시도',
};
