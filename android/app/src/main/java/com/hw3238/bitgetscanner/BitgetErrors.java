package com.hw3238.bitgetscanner;

import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 비트겟 주문 오류 → 한글 안내 (v1.5.5).
 *
 * 거래소는 `{"code":"40774","msg":"The order type for unilateral position ..."}` 처럼
 * 영문 메시지와 숫자 코드만 돌려준다. 사용자는 "왜 안 들어갔는지"를 알아야 다음 판단을 할 수
 * 있으므로, 화면·로그·알림에는 **항상 쉬운 한글 설명을 앞세우고** 원문 코드를 뒤에 붙인다.
 *
 * 웹(`src/lib/bitgetErrors.ts`)과 같은 표를 쓴다 — 두 구현의 코드 목록은
 * `scripts/autotrade-check.ts` 가 고정한다.
 */
public final class BitgetErrors {

    /** 오류 분류 — 자동 복구 방법을 고르는 기준 */
    public enum Kind {
        AUTH, CLOCK, ACCOUNT_MODE, POSITION_MODE, INSUFFICIENT, MIN_ORDER, QTY,
        PRICE_TICK, TPSL, SYMBOL, MARK_PRICE, DUPLICATE, POSITION_LIMIT, REDUCE_ONLY,
        LIQUIDATION, RESTRICTED, RATE_LIMIT, RETRY, UNKNOWN
    }

    private static final class Info {
        final Kind kind;
        final String text;

        Info(Kind kind, String text) {
            this.kind = kind;
            this.text = text;
        }
    }

    private static final Map<String, Info> TABLE = new HashMap<>();

    private static void put(String code, Kind kind, String text) {
        TABLE.put(code, new Info(kind, text));
    }

    static {
        /* --- 키·권한 --- */
        put("40006", Kind.AUTH, "API 키(ACCESS-KEY)가 올바르지 않습니다 — 비트겟 API 관리에서 키를 다시 확인해 주세요.");
        put("40009", Kind.AUTH, "API 시크릿 서명이 거절됐습니다 — Secret을 다시 붙여넣어 주세요.");
        put("40037", Kind.AUTH, "API 키를 찾을 수 없습니다 — 키가 삭제됐는지 확인해 주세요.");
        put("40012", Kind.AUTH, "API Passphrase가 맞지 않습니다 — 발급 때 정한 문구를 다시 확인해 주세요.");
        put("40014", Kind.AUTH, "API 키 권한이 부족합니다 — 비트겟 API 관리에서 선물(통합계정) 거래·읽기 권한을 켜 주세요.");
        put("40018", Kind.AUTH, "모의투자(Demo) 키와 거래 모드가 맞지 않습니다 — Demo 계좌에서 발급한 키인지 확인해 주세요.");
        put("40109", Kind.AUTH, "출금 권한이 있는 키는 쓸 수 없습니다 — 거래 권한만 있는 키로 바꿔 주세요.");
        put("40040", Kind.AUTH, "API 키 권한 설정을 확인해 주세요 — 통합계정(UTA) 거래·계정 관리 권한이 필요합니다.");
        /* --- 시간 --- */
        put("40004", Kind.CLOCK, "휴대폰 시각이 거래소와 어긋났습니다 — 설정에서 자동 시간(네트워크 시간)을 켜 주세요.");
        put("40005", Kind.CLOCK, "휴대폰 시각이 거래소와 어긋났습니다 — 설정에서 자동 시간(네트워크 시간)을 켜 주세요.");
        put("40008", Kind.CLOCK, "요청 시간(timestamp)이 만료됐습니다 — 휴대폰 자동 시간을 켜 주세요.");
        /* --- 계정 종류·포지션 모드 --- */
        put("40084", Kind.ACCOUNT_MODE, "클래식 계정(v2) 전용 요청이었습니다 — COTA가 통합계정(v3)으로 바꿔 다시 시도합니다.");
        put("40085", Kind.ACCOUNT_MODE, "통합계정(v3) 전용 요청이었습니다 — COTA가 클래식 계정(v2)으로 바꿔 다시 시도합니다.");
        put("40774", Kind.POSITION_MODE, "계좌 포지션 모드(단방향/양방향)와 주문 형식이 맞지 않습니다 — COTA가 모드에 맞춰 다시 주문합니다.");
        put("40775", Kind.POSITION_MODE, "마켓메이킹 계정은 단방향 포지션만 쓸 수 있습니다 — 비트겟에서 계정 유형을 확인해 주세요.");
        /* --- 잔고·수량·금액 --- */
        put("400172", Kind.INSUFFICIENT, "가용 USDT 증거금이 부족합니다 — 리스크 %나 레버리지를 줄여 주세요.");
        put("43011", Kind.INSUFFICIENT, "가용 USDT 증거금이 부족합니다 — 리스크 %나 레버리지를 줄여 주세요.");
        put("43012", Kind.INSUFFICIENT, "가용 USDT 증거금이 부족합니다 — 리스크 %나 레버리지를 줄여 주세요.");
        put("40754", Kind.INSUFFICIENT, "가용 USDT 증거금이 부족합니다 — COTA가 가용 잔고의 95% 안으로 수량을 줄여 다시 시도합니다.");
        put("43027", Kind.MIN_ORDER, "주문 금액이 비트겟 최소 주문 금액(보통 5 USDT)에 못 미칩니다 — 리스크 %를 키워 주세요.");
        put("45110", Kind.MIN_ORDER, "주문 금액이 비트겟 최소 주문 금액(보통 5 USDT)보다 작습니다 — 리스크 %를 키워 주세요.");
        put("45114", Kind.MIN_ORDER, "주문 금액이 비트겟 최소 주문 금액보다 작습니다 — 리스크 %를 키워 주세요.");
        put("45111", Kind.QTY, "주문 수량이 거래소 최소 거래 수량보다 작습니다 — 리스크 %를 키워 주세요.");
        put("43006", Kind.QTY, "주문 수량이 거래소 최소 거래 수량보다 작습니다 — 리스크 %를 키워 주세요.");
        put("40762", Kind.QTY, "주문 수량이 거래소 최소 거래 수량보다 작습니다(계약 단위로 내림된 결과) — 리스크 %를 키워 주세요.");
        put("45112", Kind.QTY, "주문 수량이 거래소 최대 주문 수량을 넘었습니다 — 리스크 %를 줄여 주세요.");
        put("25567", Kind.QTY, "주문 수량이 한 번에 낼 수 있는 최대 수량을 넘었습니다 — 리스크 %를 줄여 주세요.");
        put("25230", Kind.QTY, "주문 수량이 거래소 최대 주문 수량을 넘었습니다 — 리스크 %를 줄여 주세요.");
        put("25233", Kind.QTY, "주문 수량이 거래소 최대 주문 수량을 넘었습니다 — 리스크 %를 줄여 주세요.");
        put("40808", Kind.QTY, "주문 수량이 거래소 계약 단위(스텝)와 맞지 않습니다 — COTA가 계약 단위로 다시 맞춰 주문합니다.");
        /* --- 가격·호가 --- */
        put("45115", Kind.PRICE_TICK, "주문 가격·목표가·손절가가 거래소 호가 단위와 맞지 않습니다 — COTA가 호가 단위로 보정해 다시 시도합니다.");
        put("25244", Kind.PRICE_TICK, "주문 가격·목표가·손절가가 거래소 호가 단위와 맞지 않습니다 — COTA가 호가 단위로 보정해 다시 시도합니다.");
        put("43028", Kind.PRICE_TICK, "가격이 거래소 호가 단위의 정수 배수가 아닙니다 — COTA가 호가 단위로 보정합니다.");
        put("40815", Kind.PRICE_TICK, "지정가가 현재 최우선 매수호가보다 높습니다 — 가격을 낮춰 주세요.");
        put("40816", Kind.PRICE_TICK, "지정가가 현재 최우선 매도호가보다 낮습니다 — 가격을 높여 주세요.");
        put("40812", Kind.TPSL, "목표가·손절가(TP/SL)가 현재가 기준으로 유효하지 않습니다 — COTA가 안전 여유를 두고 다시 맞춥니다.");
        put("25585", Kind.TPSL, "현재가가 이미 목표가를 지나 목표가를 걸 수 없습니다 — 이 진입은 건너뜁니다.");
        put("25586", Kind.TPSL, "현재가가 이미 손절가에 닿아 진입을 건너뜁니다.");
        put("25587", Kind.TPSL, "현재가가 이미 목표가를 지나 목표가를 걸 수 없습니다 — 이 진입은 건너뜁니다.");
        put("25588", Kind.TPSL, "현재가가 이미 손절가에 닿아 진입을 건너뜁니다.");
        put("25579", Kind.TPSL, "목표가·손절가가 현재가(또는 평균단가) 기준 방향과 맞지 않습니다.");
        put("25580", Kind.TPSL, "목표가·손절가가 현재가(또는 평균단가) 기준 방향과 맞지 않습니다.");
        put("25581", Kind.TPSL, "목표가·손절가가 현재가(또는 평균단가) 기준 방향과 맞지 않습니다.");
        put("25582", Kind.TPSL, "목표가·손절가가 현재가(또는 평균단가) 기준 방향과 맞지 않습니다.");
        put("25589", Kind.TPSL, "목표가·손절가가 현재가 기준 방향과 맞지 않습니다 — COTA가 다시 맞춥니다.");
        put("25590", Kind.TPSL, "목표가·손절가가 현재가 기준 방향과 맞지 않습니다 — COTA가 다시 맞춥니다.");
        put("25591", Kind.TPSL, "목표가·손절가가 현재가 기준 방향과 맞지 않습니다 — COTA가 다시 맞춥니다.");
        put("25592", Kind.TPSL, "목표가·손절가가 현재가 기준 방향과 맞지 않습니다 — COTA가 다시 맞춥니다.");
        put("25593", Kind.TPSL, "이 종목은 목표가·손절가 설정을 지원하지 않습니다 — TP/SL 없이 주문합니다.");
        put("25594", Kind.TPSL, "이 종목에는 이미 목표가·손절가 주문이 걸려 있습니다.");
        /* --- 종목 --- */
        put("25100", Kind.SYMBOL, "거래소에 없는(또는 상장폐지된) 종목입니다 — 감시 목록에서 제외했습니다.");
        put("25101", Kind.SYMBOL, "이 종목은 점검 중이거나 아직 거래가 열리지 않았습니다 — 잠시 후 다시 시도합니다.");
        put("25102", Kind.SYMBOL, "이 종목은 점검 중이거나 곧 상장폐지될 예정입니다 — 감시 목록에서 제외했습니다.");
        put("25104", Kind.SYMBOL, "거래소에 없는(또는 상장폐지된) 종목입니다 — 감시 목록에서 제외했습니다.");
        put("25105", Kind.SYMBOL, "이 종목은 지금 신규 진입이 막혀 있습니다 — 감시 목록에서 제외했습니다.");
        put("40309", Kind.SYMBOL, "이미 상장폐지된 종목입니다 — 감시 목록에서 제외했습니다.");
        put("45119", Kind.SYMBOL, "이 종목은 신규 진입을 받지 않습니다(거래 제한·상장폐지) — 감시 목록에서 제외했습니다.");
        put("45121", Kind.MARK_PRICE, "마크 가격이 시장과 크게 벌어져 거래소가 고위험으로 판단했습니다 — 잠시 후 다시 시도합니다.");
        /* --- 중복·포지션 --- */
        put("25212", Kind.DUPLICATE, "같은 주문이 이미 접수되어 있습니다 — 중복 주문을 막았습니다.");
        put("25229", Kind.POSITION_LIMIT, "보유 포지션 수가 거래소 한도를 넘었습니다 — 일부 포지션을 청산해 주세요.");
        put("45116", Kind.POSITION_LIMIT, "보유 포지션 수가 거래소 한도를 넘었습니다 — 일부 포지션을 청산해 주세요.");
        put("25227", Kind.POSITION_LIMIT, "청산할 포지션이 없습니다(이미 청산됐을 수 있습니다).");
        put("25237", Kind.REDUCE_ONLY, "이 청산 주문은 양방향(헤지) 모드에서만 가능합니다.");
        put("25232", Kind.REDUCE_ONLY, "같은 방향의 미체결 축소 주문이 있어 거절됐습니다 — 비트겟 주문 목록을 확인해 주세요.");
        put("25574", Kind.REDUCE_ONLY, "축소 주문 보호 규칙에 걸렸습니다 — 비트겟 주문 목록을 확인해 주세요.");
        /* --- 계좌 상태 --- */
        put("40760", Kind.LIQUIDATION, "계좌가 청산 처리 중이라 새 주문을 받지 않습니다 — 청산이 끝난 뒤 다시 시도합니다.");
        put("40022", Kind.RESTRICTED, "이 계좌의 거래가 제한된 상태입니다 — 비트겟 고객센터에 문의해 주세요.");
        put("40710", Kind.RESTRICTED, "계좌 상태가 정상이 아닙니다 — 비트겟 고객센터에 문의해 주세요.");
        put("40763", Kind.POSITION_LIMIT, "포지션 규모가 거래소 등급(tier) 한도를 넘었습니다 — 레버리지나 리스크 %를 줄여 주세요.");
        put("45118", Kind.POSITION_LIMIT, "미체결 주문 수가 거래소 한도에 닿았습니다 — 기존 주문을 정리해 주세요.");
        /* --- 일시 오류·레이트리밋 --- */
        put("429", Kind.RATE_LIMIT, "요청이 너무 잦아 거래소가 잠시 막았습니다 — 잠깐 뒤 자동으로 다시 시도합니다.");
        put("40034", Kind.RATE_LIMIT, "요청 한도를 넘었습니다 — 잠깐 뒤 자동으로 다시 시도합니다.");
        put("25004", Kind.RATE_LIMIT, "요청 한도를 넘었습니다 — 잠깐 뒤 자동으로 다시 시도합니다.");
        put("30007", Kind.RATE_LIMIT, "요청 한도를 넘었습니다 — 잠깐 뒤 자동으로 다시 시도합니다.");
        put("25003", Kind.RETRY, "거래소가 동시 처리 중입니다 — 잠깐 뒤 자동으로 다시 시도합니다.");
        put("40908", Kind.RETRY, "거래소가 주문을 처리 중입니다 — 잠깐 뒤 자동으로 다시 시도합니다.");
        put("40725", Kind.RETRY, "거래소 서버가 잠시 불안정합니다 — 자동으로 다시 시도합니다.");
        put("45001", Kind.RETRY, "거래소가 알 수 없는 오류를 돌려줬습니다 — 자동으로 다시 시도합니다.");
    }

    /** 원문 메시지에만 단서가 있는 경우(코드가 낯설 때) */
    private static final Object[][] MESSAGE_RULES = {
            {Pattern.compile("posSide|position mode|hedge", Pattern.CASE_INSENSITIVE), Kind.POSITION_MODE,
                    "계좌 포지션 모드(단방향/양방향)와 주문 형식이 맞지 않습니다."},
            {Pattern.compile("insufficient|balance", Pattern.CASE_INSENSITIVE), Kind.INSUFFICIENT,
                    "가용 USDT 증거금이 부족합니다."},
            {Pattern.compile("minimum|less than", Pattern.CASE_INSENSITIVE), Kind.MIN_ORDER,
                    "주문 수량·금액이 거래소 최소 기준보다 작습니다."},
            {Pattern.compile("multiple of|precision|tick", Pattern.CASE_INSENSITIVE), Kind.PRICE_TICK,
                    "가격이 거래소 호가 단위와 맞지 않습니다."},
            {Pattern.compile("time ?stamp", Pattern.CASE_INSENSITIVE), Kind.CLOCK,
                    "휴대폰 시각이 거래소와 어긋났습니다."},
            {Pattern.compile("signature|passphrase|api ?key", Pattern.CASE_INSENSITIVE), Kind.AUTH,
                    "API 키·시크릿·문구를 확인해 주세요."},
            {Pattern.compile("delist|not support|suspend|maintenance", Pattern.CASE_INSENSITIVE), Kind.SYMBOL,
                    "이 종목은 지금 거래할 수 없습니다."},
            {Pattern.compile("rate ?limit|too many", Pattern.CASE_INSENSITIVE), Kind.RATE_LIMIT,
                    "요청이 너무 잦습니다 — 잠깐 뒤 다시 시도합니다."},
    };

    private BitgetErrors() {}

    public static Kind kindOf(String code, String rawMessage) {
        String c = code == null ? "" : code.trim();
        Info hit = TABLE.get(c);
        if (hit != null) return hit.kind;
        String raw = rawMessage == null ? "" : rawMessage.trim();
        if (!raw.isEmpty()) {
            for (Object[] rule : MESSAGE_RULES) {
                if (((Pattern) rule[0]).matcher(raw).find()) return (Kind) rule[1];
            }
        }
        if (c.startsWith(BitgetApi.GUARD_PREFIX)) return Kind.MIN_ORDER;
        return Kind.UNKNOWN;
    }

    /** 한글 설명 한 문장 — 코드 표 → 원문 규칙 → 기본 문장 */
    public static String explain(String code, String rawMessage) {
        String c = code == null ? "" : code.trim();
        Info hit = TABLE.get(c);
        String raw = rawMessage == null ? "" : rawMessage.trim();
        if (hit != null) return hit.text;
        if (!raw.isEmpty()) {
            for (Object[] rule : MESSAGE_RULES) {
                if (((Pattern) rule[0]).matcher(raw).find()) return (String) rule[2];
            }
        }
        if (c.startsWith(BitgetApi.GUARD_PREFIX)) {
            return raw.isEmpty() ? "COTA가 주문 전에 안전 규칙으로 막았습니다." : raw;
        }
        if (raw.isEmpty()) return "거래소가 주문을 거절했습니다(사유 미확인) — 잠시 후 자동으로 다시 시도합니다.";
        return "거래소가 주문을 거절했습니다 — " + raw;
    }

    /** 화면·로그에 그대로 남기는 한 줄 — `한글 설명 (코드 40774 · 원문 …)` */
    public static String format(String code, String rawMessage) {
        String text = explain(code, rawMessage);
        String c = code == null ? "" : code.trim();
        String raw = rawMessage == null ? "" : rawMessage.trim();
        StringBuilder tail = new StringBuilder();
        if (!c.isEmpty()) tail.append("코드 ").append(c);
        if (!raw.isEmpty() && !text.contains(raw)) {
            if (tail.length() > 0) tail.append(" · ");
            tail.append("원문 ").append(raw);
        }
        return tail.length() == 0 ? text : text + " (" + tail + ")";
    }

    /* ---------------- 자동 복구 분류 ---------------- */

    public static boolean isPositionMode(String code, String raw) {
        return kindOf(code, raw) == Kind.POSITION_MODE;
    }

    public static boolean isPriceTick(String code, String raw) {
        return kindOf(code, raw) == Kind.PRICE_TICK;
    }

    public static boolean isSize(String code, String raw) {
        return kindOf(code, raw) == Kind.QTY;
    }

    public static boolean isInsufficient(String code, String raw) {
        return kindOf(code, raw) == Kind.INSUFFICIENT;
    }

    public static boolean isTpSl(String code, String raw) {
        return kindOf(code, raw) == Kind.TPSL;
    }

    public static boolean isSymbolGone(String code, String raw) {
        return kindOf(code, raw) == Kind.SYMBOL;
    }

    public static boolean isRetryable(String code, String raw) {
        Kind kind = kindOf(code, raw);
        return kind == Kind.RETRY || kind == Kind.RATE_LIMIT || kind == Kind.ACCOUNT_MODE;
    }

    public static boolean isAuth(String code, String raw) {
        return kindOf(code, raw) == Kind.AUTH;
    }
}
