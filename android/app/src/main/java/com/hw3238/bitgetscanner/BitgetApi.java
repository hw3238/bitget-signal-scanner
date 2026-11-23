package com.hw3238.bitgetscanner;

import android.content.Context;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * 비트겟 USDT-M Futures REST 클라이언트 (네이티브 전용).
 *
 * 웹뷰는 CORS·Secret 노출 문제로 Private API를 직접 부를 수 없다. 그래서 서명과 주문은
 * 여기(안드로이드)에서만 일어나고, 웹에는 마스킹된 상태·잔고·포지션·주문 결과만 돌려준다.
 *
 * ## 두 가지 계정 모드 (v1.5.1)
 * 비트겟 계정은 **클래식(Classic, v2)** 과 **통합(UTA, v3)** 두 갈래다. 서명 규격
 * (HMAC-SHA256 + Base64, `timestamp + METHOD + requestPath(+query) + body`)과 모의투자
 * 헤더(`paptrading: 1`)는 같고, 경로·필드 이름·에러 코드만 다르다.
 *
 *  · `GET /api/v3/account/settings` → `00000` 이면 **UTA(v3)**
 *  · 같은 호출이 `40084` → **Classic(v2)**
 *  · v2 엔드포인트가 `40085` → **UTA(v3)** 로 자동 전환(안전 폴백)
 *
 * 계정 종류는 API Key 별로 한 번 판별해 캐시하고, 40084/40085 를 만나면 즉시 뒤집어
 * **같은 요청을 한 번 더** 보낸다. 사용자는 모드 차이를 신경 쓰지 않아도 된다.
 *
 * v2 → v3 필드 차이(주문):
 *   size → qty, productType → category("USDT-FUTURES"),
 *   presetStopSurplusPrice → takeProfit, presetStopLossPrice → stopLoss,
 *   tradeSide(open/close) → posSide(long/short), marginMode crossed/isolated, clientOid ≤32자
 *
 * `src/lib/bitgetSign.ts`(서명)와 `src/lib/bitgetUta.ts`(계정 판별·v3 변환)는 이 파일의
 * 참조 구현이고, `scripts/autotrade-check.ts`가 같은 입력 → 같은 페이로드를 고정한다.
 */
public final class BitgetApi {

    public static final String BASE = "https://api.bitget.com";
    public static final String PRODUCT = "USDT-FUTURES";
    public static final String MARGIN_COIN = "USDT";

    /** 계정 종류 */
    public static final String MODE_UTA = "uta";
    public static final String MODE_CLASSIC = "classic";
    /** v2 호출이 통합 계정에서 돌아오는 코드 — UTA 힌트 */
    public static final String ERR_UTA_MODE = "40085";
    /** v3 호출이 클래식 계정에서 돌아오는 코드 — Classic 힌트 */
    public static final String ERR_CLASSIC_MODE = "40084";
    /** 가격이 호가 단위(tick)의 배수가 아님 — TP/SL 소수 꼬리가 원인 */
    public static final String ERR_PRICE_STEP = "45115";
    /** v3 에서 같은 의미로 돌아오는 코드 */
    public static final String ERR_PRICE_STEP_V3 = "25244";
    /** 같은 clientOid 로 이미 접수된 주문 — 재시도하면 중복이 되므로 성공으로 본다 */
    public static final String ERR_DUPLICATE_OID = "25212";
    /** 앱이 주문 전에 스스로 막은 경우(거래소 오류가 아님) — 코드 앞자리로 구분한다 */
    public static final String GUARD_PREFIX = "guard:";
    public static final String GUARD_SIZE = "guard:size";
    public static final String GUARD_TP = "guard:tp";

    private static final long SETTINGS_TTL_MS = 5 * 60_000L;
    /** 계약 호가·수량 단위 캐시 — 45115/수량 배수 보정용 */
    private static final long LIMITS_TTL_MS = 30 * 60_000L;
    /** 계약 조회 실패는 60초 동안 기억해 매 주기 공개 API 를 두드리지 않는다 */
    private static final long LIMITS_FAIL_TTL_MS = 60_000L;
    /** 주문 직전 마지막 체결가 캐시 — TP/SL 방향 검사에 쓴다 */
    private static final long QUOTE_TTL_MS = 5_000L;

    private BitgetApi() {}

    /** 서명에 쓰는 키 묶음 — 메모리에만 잠깐 존재한다. */
    public static final class Keys {
        public final String apiKey;
        public final String secret;
        public final String passphrase;
        public final boolean demo;

        public Keys(String apiKey, String secret, String passphrase, boolean demo) {
            this.apiKey = apiKey == null ? "" : apiKey.trim();
            this.secret = secret == null ? "" : secret.trim();
            this.passphrase = passphrase == null ? "" : passphrase.trim();
            this.demo = demo;
        }

        public boolean complete() {
            return !apiKey.isEmpty() && !secret.isEmpty() && !passphrase.isEmpty();
        }

        /** 캐시 키 — 키 원문을 남기지 않도록 해시로 만든다. */
        String cacheKey() {
            return (apiKey + "|" + (demo ? "demo" : "live")).hashCode() + "";
        }
    }

    /** 계정 판별 캐시 — 모드 · 계정 설정(holdMode·종목별 마진 모드) */
    private static final class AccountCache {
        String mode = "";
        long settingsAt = 0L;
        String holdMode = "";
        final Map<String, String> marginModes = new HashMap<>();
    }

    private static final ConcurrentHashMap<String, AccountCache> CACHE = new ConcurrentHashMap<>();

    /** 종목 호가·수량 단위 캐시 — 45115·수량 배수·최소금액 보정용. 프로세스 수명 동안 유지. */
    private static final ConcurrentHashMap<String, ContractLimits> LIMITS = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, Long> LIMITS_FAILED_AT = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, double[]> QUOTE = new ConcurrentHashMap<>();

    private static AccountCache cache(Keys keys) {
        String id = keys == null ? "-" : keys.cacheKey();
        AccountCache c = CACHE.get(id);
        if (c == null) {
            c = new AccountCache();
            CACHE.put(id, c);
        }
        return c;
    }

    /** API 키를 새로 저장·삭제하면 판별 결과를 버린다. */
    public static void forgetAccountMode() {
        CACHE.clear();
    }

    /** 지금까지 판별된 계정 종류 — 네트워크 호출 없음. 아직 모르면 "unknown". */
    public static String knownMode(Keys keys) {
        if (keys == null) return "unknown";
        String mode = cache(keys).mode;
        return mode == null || mode.isEmpty() ? "unknown" : mode;
    }

    /** 비트겟이 돌려준 오류(code/message). */
    public static class ApiException extends Exception {
        public final String code;

        public ApiException(String code, String message) {
            super(message == null || message.isEmpty() ? "비트겟 오류 " + code : message);
            this.code = code;
        }

        /** 사용자가 바로 알아들을 수 있는 문장 */
        public String friendly() {
            if (code != null && code.startsWith(GUARD_PREFIX)) return getMessage();
            switch (code) {
                case "40037":
                case "40006":
                case "40009":
                case "40012":
                    return "API 키가 올바르지 않습니다. Key·Secret·Passphrase를 다시 확인해 주세요.";
                case "40014":
                    return "API 키 권한이 부족합니다. 비트겟 API 관리에서 '통합계정 거래(UTA trade)'와 '통합계정 관리(UTA mgt, 읽기)' 권한을 켜 주세요.";
                case "40018":
                    return "모의투자(Demo) 키와 모드가 맞지 않습니다. 모의투자 계좌에서 발급한 키인지 확인해 주세요.";
                case "40109":
                    return "출금 권한은 필요 없습니다. 거래 권한만 있는 키를 사용해 주세요.";
                case "400172":
                case "43025":
                case "43012":
                    return "주문 가능 수량/증거금이 부족합니다.";
                case ERR_UTA_MODE:
                    return "비트겟 계정이 통합 계정(UTA) 모드입니다. COTA가 자동으로 통합계정 API(v3)로 바꿔 다시 시도합니다. 계속되면 앱을 v1.5.1 이상으로 업데이트해 주세요.";
                case ERR_CLASSIC_MODE:
                    return "비트겟 계정이 클래식 모드입니다. COTA가 자동으로 클래식 API(v2)로 바꿔 다시 시도합니다.";
                case "40004":
                case "40005":
                case "40008":
                    return "휴대폰 시각이 거래소와 맞지 않습니다. 설정에서 자동 시간(네트워크 시간)을 켠 뒤 다시 시도해 주세요.";
                case ERR_PRICE_STEP:
                    return "목표가·손절가가 거래소 호가 단위와 맞지 않습니다(45115). 호가 단위로 다시 맞춰 한 번 더 시도했지만 거절됐습니다 — 앱을 v1.5.3 이상으로 업데이트해 주세요.";
                case ERR_PRICE_STEP_V3:
                    return "목표가·손절가가 거래소 호가 단위와 맞지 않습니다(25244). 앱을 v1.5.3 이상으로 업데이트해 주세요.";
                case ERR_DUPLICATE_OID:
                    return "같은 주문이 이미 접수되어 있습니다(25212) — 중복 주문을 막았습니다.";
                case "45110":
                case "45114":
                    return "주문 금액이 비트겟 최소 주문 금액(보통 5 USDT)보다 작습니다. 리스크 %나 시드를 키워 주세요.";
                case "45111":
                case "43006":
                    return "주문 수량이 거래소 최소 주문 수량보다 작습니다.";
                case "45112":
                case "40762":
                case "25230":
                case "25233":
                    return "주문 수량이 거래소 최대 주문 수량을 넘었습니다. 리스크 %를 줄여 주세요.";
                case "25229":
                    return "보유 포지션 수가 거래소 한도를 넘었습니다. 일부 포지션을 청산해 주세요.";
                case "25227":
                    return "청산할 포지션이 없습니다(이미 청산됐을 수 있습니다).";
                case "25237":
                    return "청산 주문은 헤지(양방향) 모드에서만 가능합니다. 비트겟에서 포지션 모드를 확인해 주세요.";
                case "25232":
                    return "같은 방향의 미체결 축소 주문이 있어 거절됐습니다. 비트겟 주문 목록을 확인해 주세요.";
                case "25579":
                case "25580":
                case "25581":
                case "25582":
                case "25585":
                case "25586":
                case "25587":
                case "25588":
                case "25589":
                case "25590":
                case "25591":
                case "25592":
                    return "현재가(또는 평균단가) 기준으로 목표가·손절가 방향이 맞지 않습니다. 이미 목표가를 지나쳤거나 손절가에 붙은 자리입니다.";
                case "25593":
                    return "이 종목은 TP/SL 설정을 지원하지 않습니다. 허용 종목에서 빼 주세요.";
                case "25594":
                    return "이 종목에는 이미 TP/SL 주문이 걸려 있습니다(종목당 1개).";
                case "25100":
                case "25104":
                    return "거래소에 없는(또는 상장폐지된) 종목입니다. 감시 목록에서 제외했습니다.";
                case "25105":
                    return "이 종목은 지금 신규 진입이 막혀 있습니다.";
                case "40040":
                    return "API 키 권한 설정을 확인해 주세요. 비트겟 API 관리에서 통합계정(UTA) 거래·계정 관리 권한을 켜야 합니다.";
                default:
                    return getMessage() + (code == null || code.isEmpty() ? "" : " (" + code + ")");
            }
        }
    }

    /* ------------------------------------------------------------------ *
     * 서명
     * ------------------------------------------------------------------ */

    public static String sign(String secret, String prehash) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return Base64.encodeToString(mac.doFinal(prehash.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
    }

    public static String prehash(String timestamp, String method, String requestPath, String body) {
        return timestamp + method.toUpperCase() + requestPath + (body == null ? "" : body);
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (Exception e) {
            return value;
        }
    }

    /* ------------------------------------------------------------------ *
     * HTTP
     * ------------------------------------------------------------------ */

    /** Private 요청 — body 가 null 이면 GET/POST without body. 429 는 한 번 백오프 후 재시도. */
    public static Object request(Keys keys, String method, String path, JSONObject body) throws Exception {
        try {
            return requestOnce(keys, method, path, body);
        } catch (ApiException e) {
            if (!isRateLimited(e.code) || !"GET".equalsIgnoreCase(method)) throw e;
            Thread.sleep(600L);
            return requestOnce(keys, method, path, body);
        }
    }

    /** 비트겟 요청 한도 오류(HTTP 429 · 40034 · 25004) */
    static boolean isRateLimited(String code) {
        return "429".equals(code) || "40034".equals(code) || "25004".equals(code) || "30007".equals(code);
    }

    private static Object requestOnce(Keys keys, String method, String path, JSONObject body) throws Exception {
        if (keys == null || !keys.complete()) throw new ApiException("no-keys", "API 키가 연결되지 않았습니다.");
        String timestamp = String.valueOf(System.currentTimeMillis());
        String bodyText = body == null ? "" : body.toString();
        String signature = sign(keys.secret, prehash(timestamp, method, path, bodyText));

        HttpURLConnection conn = (HttpURLConnection) new URL(BASE + path).openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("ACCESS-KEY", keys.apiKey);
        conn.setRequestProperty("ACCESS-SIGN", signature);
        conn.setRequestProperty("ACCESS-TIMESTAMP", timestamp);
        conn.setRequestProperty("ACCESS-PASSPHRASE", keys.passphrase);
        conn.setRequestProperty("locale", "ko-KR");
        conn.setRequestProperty("User-Agent", "COTA-Android");
        // 모의투자(Demo)는 v2·v3 모두 같은 헤더를 쓴다.
        if (keys.demo) conn.setRequestProperty("paptrading", "1");
        if (body != null) {
            conn.setDoOutput(true);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(bodyText.getBytes(StandardCharsets.UTF_8));
            }
        }

        int status = conn.getResponseCode();
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(
                        status >= 200 && status < 300 ? conn.getInputStream() : conn.getErrorStream(),
                        StandardCharsets.UTF_8))) {
            if (reader != null) {
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
            }
        } finally {
            conn.disconnect();
        }

        String text = sb.toString();
        JSONObject res;
        try {
            res = new JSONObject(text);
        } catch (Exception e) {
            throw new ApiException("http-" + status, "비트겟 응답을 읽을 수 없습니다 (HTTP " + status + ")");
        }
        String code = res.optString("code", "");
        if (!"00000".equals(code)) {
            throw new ApiException(code, res.optString("msg", ""));
        }
        return res.opt("data");
    }

    /** Public 요청 — 서명 없이(가격·캔들). 429 는 2회까지 백오프 재시도. */
    public static Object publicGet(String path) throws Exception {
        for (int attempt = 0; ; attempt++) {
            try {
                return publicGetOnce(path);
            } catch (ApiException e) {
                if (!isRateLimited(e.code) || attempt >= 2) throw e;
                Thread.sleep(400L * (attempt + 1));
            } catch (Exception e) {
                if (attempt >= 1) throw e;
                Thread.sleep(300L);
            }
        }
    }

    private static Object publicGetOnce(String path) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(BASE + path).openConnection();
        conn.setRequestMethod("GET");
        conn.setConnectTimeout(10000);
        conn.setReadTimeout(15000);
        conn.setRequestProperty("User-Agent", "COTA-Android");
        int status = conn.getResponseCode();
        StringBuilder sb = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(
                        status >= 200 && status < 300 ? conn.getInputStream() : conn.getErrorStream(),
                        StandardCharsets.UTF_8))) {
            if (reader != null) {
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
            }
        } finally {
            conn.disconnect();
        }
        JSONObject res = new JSONObject(sb.toString());
        String code = res.optString("code", "");
        if (!"00000".equals(code)) throw new ApiException(code, res.optString("msg", ""));
        return res.opt("data");
    }

    /* ------------------------------------------------------------------ *
     * 계정 모드 판별
     * ------------------------------------------------------------------ */

    /**
     * 계정 종류 판별(캐시 사용).
     *  1) v3 settings 성공 → UTA
     *  2) v3 settings 40084 → Classic
     *  3) 그 밖의 오류(권한·키 오류 포함) — v2 계좌를 한 번 찔러 본다:
     *     v2 성공 → Classic · v2 가 40085 → UTA · 둘 다 실패하면 v3 오류를 그대로 올린다.
     *     (계정 종류에 따라 한쪽 API 만 키를 거절하는 사례가 있어, 한 신호만으로 단정하지 않는다)
     */
    public static String accountMode(Keys keys) throws Exception {
        String cached = knownMode(keys);
        if (!"unknown".equals(cached)) return cached;

        try {
            request(keys, "GET", "/api/v3/account/settings", null);
            cache(keys).mode = MODE_UTA;
            return MODE_UTA;
        } catch (ApiException e) {
            if (ERR_CLASSIC_MODE.equals(e.code)) {
                cache(keys).mode = MODE_CLASSIC;
                return MODE_CLASSIC;
            }
            try {
                request(keys, "GET", "/api/v2/mix/account/accounts?productType=" + PRODUCT, null);
                cache(keys).mode = MODE_CLASSIC;
                return MODE_CLASSIC;
            } catch (ApiException probe) {
                if (ERR_UTA_MODE.equals(probe.code)) {
                    cache(keys).mode = MODE_UTA;
                    return MODE_UTA;
                }
                throw e;
            }
        }
    }

    private static void switchMode(Keys keys, String mode) {
        AccountCache c = cache(keys);
        c.mode = mode;
        c.settingsAt = 0L;
        c.holdMode = "";
        c.marginModes.clear();
    }

    /** v3 계정 설정(holdMode·종목별 마진 모드) — 5분 캐시 */
    private static JSONObject settings(Keys keys) throws Exception {
        AccountCache c = cache(keys);
        long now = System.currentTimeMillis();
        if (c.settingsAt > 0 && now - c.settingsAt < SETTINGS_TTL_MS && !c.holdMode.isEmpty()) {
            JSONObject cached = new JSONObject();
            cached.put("holdMode", c.holdMode);
            return cached;
        }
        Object data = request(keys, "GET", "/api/v3/account/settings", null);
        JSONObject settings = data instanceof JSONObject ? (JSONObject) data : new JSONObject();
        c.holdMode = settings.optString("holdMode", "");
        c.marginModes.clear();
        JSONArray list = settings.optJSONArray("symbolConfigList");
        if (list != null) {
            for (int i = 0; i < list.length(); i++) {
                JSONObject row = list.optJSONObject(i);
                if (row == null) continue;
                String category = row.optString("category", "");
                if (!category.isEmpty() && !PRODUCT.equalsIgnoreCase(category)) continue;
                String symbol = row.optString("symbol", "").toUpperCase(Locale.ROOT);
                if (symbol.isEmpty()) continue;
                c.marginModes.put(symbol, normalizeMarginMode(row.optString("marginMode", "")));
            }
        }
        c.settingsAt = now;
        return settings;
    }

    /** 종목의 마진 모드 — UTA 기본값은 교차(crossed) */
    private static String symbolMarginMode(Keys keys, String symbol) {
        String mode = cache(keys).marginModes.get(symbol == null ? "" : symbol.toUpperCase(Locale.ROOT));
        return mode == null || mode.isEmpty() ? "crossed" : mode;
    }

    public static String normalizeMarginMode(String raw) {
        return "isolated".equalsIgnoreCase(raw == null ? "" : raw.trim()) ? "isolated" : "crossed";
    }

    /* ------------------------------------------------------------------ *
     * 계정 · 포지션
     * ------------------------------------------------------------------ */

    /** USDT-M 계좌 — equity(총자산) · available(주문 가능) · unrealizedPL */
    public static JSONObject accounts(Keys keys) throws Exception {
        String mode = accountMode(keys);
        if (MODE_UTA.equals(mode)) {
            try {
                return accountsUta(keys);
            } catch (ApiException e) {
                if (!ERR_CLASSIC_MODE.equals(e.code)) throw e;
                switchMode(keys, MODE_CLASSIC);
                return accountsClassic(keys);
            }
        }
        try {
            return accountsClassic(keys);
        } catch (ApiException e) {
            if (!ERR_UTA_MODE.equals(e.code)) throw e;
            switchMode(keys, MODE_UTA);
            return accountsUta(keys);
        }
    }

    /** v2(클래식) 잔고 */
    private static JSONObject accountsClassic(Keys keys) throws Exception {
        Object data = request(keys, "GET", "/api/v2/mix/account/accounts?productType=" + PRODUCT, null);
        JSONObject out = new JSONObject();
        if (data instanceof JSONArray) {
            JSONArray arr = (JSONArray) data;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject acc = arr.optJSONObject(i);
                if (acc == null) continue;
                if (!MARGIN_COIN.equalsIgnoreCase(acc.optString("marginCoin", ""))) continue;
                out.put("equity", number(acc, "equity", "usdtEquity"));
                out.put("available", number(acc, "available", "crossedMaxAvailable"));
                out.put("unrealizedPL", number(acc, "unrealizedPL", "unrealizedPL"));
                out.put("marginCoin", MARGIN_COIN);
                out.put("accountMode", MODE_CLASSIC);
                return out;
            }
        }
        out.put("equity", 0);
        out.put("available", 0);
        out.put("unrealizedPL", 0);
        out.put("accountMode", MODE_CLASSIC);
        return out;
    }

    /**
     * v3(통합) 잔고 — `usdtEquity` · `usdtUnrealisedPnl`, 자산 목록의 USDT 행에서
     * `equity`/`available`(없으면 `effEquity`)을 읽는다.
     */
    private static JSONObject accountsUta(Keys keys) throws Exception {
        Object data = request(keys, "GET", "/api/v3/account/assets", null);
        JSONObject out = new JSONObject();
        double equity = 0;
        double available = -1;
        double unrealized = 0;
        if (data instanceof JSONObject) {
            JSONObject d = (JSONObject) data;
            unrealized = num(d.optString("usdtUnrealisedPnl", ""));
            if (unrealized == 0) unrealized = num(d.optString("unrealisedPnl", ""));
            double usdtEquity = num(d.optString("usdtEquity", ""));
            JSONArray assets = d.optJSONArray("assets");
            if (assets != null) {
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject row = assets.optJSONObject(i);
                    if (row == null) continue;
                    if (!MARGIN_COIN.equalsIgnoreCase(row.optString("coin", ""))) continue;
                    double rowEquity = num(row.optString("equity", ""));
                    if (rowEquity > 0) equity = rowEquity;
                    if (row.has("available")) available = num(row.optString("available", ""));
                    break;
                }
            }
            if (equity <= 0) equity = usdtEquity;
            if (equity <= 0) equity = num(d.optString("accountEquity", ""));
            if (available < 0) available = num(d.optString("effEquity", ""));
        }
        out.put("equity", equity);
        out.put("available", available < 0 ? 0 : available);
        out.put("unrealizedPL", unrealized);
        out.put("marginCoin", MARGIN_COIN);
        out.put("accountMode", MODE_UTA);
        return out;
    }

    /** 포지션 모드(one_way_mode / hedge_mode) */
    public static String holdMode(Keys keys, String symbol) throws Exception {
        String mode = accountMode(keys);
        if (MODE_UTA.equals(mode)) {
            try {
                JSONObject settings = settings(keys);
                String hold = settings.optString("holdMode", "");
                return hold.isEmpty() ? "one_way_mode" : hold;
            } catch (ApiException e) {
                if (!ERR_CLASSIC_MODE.equals(e.code)) throw e;
                switchMode(keys, MODE_CLASSIC);
                return holdModeClassic(keys, symbol);
            }
        }
        try {
            return holdModeClassic(keys, symbol);
        } catch (ApiException e) {
            if (!ERR_UTA_MODE.equals(e.code)) throw e;
            switchMode(keys, MODE_UTA);
            JSONObject settings = settings(keys);
            String hold = settings.optString("holdMode", "");
            return hold.isEmpty() ? "one_way_mode" : hold;
        }
    }

    private static String holdModeClassic(Keys keys, String symbol) throws Exception {
        String path = "/api/v2/mix/account/account?symbol=" + encode(symbol)
                + "&productType=" + PRODUCT + "&marginCoin=" + MARGIN_COIN;
        Object data = request(keys, "GET", path, null);
        if (data instanceof JSONObject) {
            JSONObject acc = (JSONObject) data;
            String mode = acc.optString("posMode", acc.optString("holdMode", ""));
            if (!mode.isEmpty()) return mode;
        }
        return "one_way_mode";
    }

    /** 보유 포지션(수량 0 제외) — v2·v3 응답을 같은 모양으로 돌려준다 */
    public static JSONArray positions(Keys keys) throws Exception {
        String mode = accountMode(keys);
        if (MODE_UTA.equals(mode)) {
            try {
                return positionsUta(keys);
            } catch (ApiException e) {
                if (!ERR_CLASSIC_MODE.equals(e.code)) throw e;
                switchMode(keys, MODE_CLASSIC);
                return positionsClassic(keys);
            }
        }
        try {
            return positionsClassic(keys);
        } catch (ApiException e) {
            if (!ERR_UTA_MODE.equals(e.code)) throw e;
            switchMode(keys, MODE_UTA);
            return positionsUta(keys);
        }
    }

    private static JSONArray positionsClassic(Keys keys) throws Exception {
        Object data = request(
                keys,
                "GET",
                "/api/v2/mix/position/all-position?productType=" + PRODUCT + "&marginCoin=" + MARGIN_COIN,
                null);
        JSONArray out = new JSONArray();
        if (data instanceof JSONArray) {
            JSONArray arr = (JSONArray) data;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject p = arr.optJSONObject(i);
                if (p == null) continue;
                double total = num(p.optString("total", "0"));
                if (Math.abs(total) <= 0) continue;
                JSONObject row = new JSONObject();
                row.put("symbol", p.optString("symbol"));
                row.put("holdSide", p.optString("holdSide"));
                row.put("total", total);
                row.put("openPriceAvg", num(p.optString("openPriceAvg", p.optString("averageOpenPrice", "0"))));
                row.put("markPrice", num(p.optString("markPrice", "0")));
                row.put("unrealizedPL", num(p.optString("unrealizedPL", "0")));
                row.put("leverage", num(p.optString("leverage", "0")));
                row.put("marginSize", num(p.optString("marginSize", "0")));
                row.put("liquidationPrice", num(p.optString("liquidationPrice", "0")));
                row.put("presetStopSurplusPrice", num(p.optString("presetStopSurplusPrice", "0")));
                row.put("presetStopLossPrice", num(p.optString("presetStopLossPrice", "0")));
                row.put("ctime", (long) num(p.optString("cTime", "0")));
                out.put(row);
            }
        }
        return out;
    }

    /**
     * v3(통합) 포지션 — `data.list[]` (없으면 null).
     * `posSide`·`total`·`avgPrice`·`unrealisedPnl`·`positionBalance`·`createdTime` 을 v2 이름으로 옮긴다.
     */
    private static JSONArray positionsUta(Keys keys) throws Exception {
        Object data = request(
                keys,
                "GET",
                "/api/v3/position/current-position?category=" + PRODUCT,
                null);
        JSONArray out = new JSONArray();
        if (!(data instanceof JSONObject)) return out;
        JSONArray arr = ((JSONObject) data).optJSONArray("list");
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject p = arr.optJSONObject(i);
            if (p == null) continue;
            double total = num(p.optString("total", "0"));
            if (Math.abs(total) <= 0) continue;
            JSONObject row = new JSONObject();
            row.put("symbol", p.optString("symbol"));
            row.put("holdSide", p.optString("posSide", p.optString("holdSide", "")));
            row.put("total", total);
            row.put("openPriceAvg", num(p.optString("avgPrice", p.optString("openPriceAvg", "0"))));
            row.put("markPrice", num(p.optString("markPrice", "0")));
            row.put("unrealizedPL", num(p.optString("unrealisedPnl", p.optString("unrealizedPnl", "0"))));
            row.put("leverage", num(p.optString("leverage", "0")));
            row.put("marginSize", num(p.optString("positionBalance", p.optString("marginSize", "0"))));
            row.put("liquidationPrice", num(p.optString("liquidationPrice", "0")));
            row.put("presetStopSurplusPrice", num(p.optString("presetStopSurplusPrice", "0")));
            row.put("presetStopLossPrice", num(p.optString("presetStopLossPrice", "0")));
            row.put("ctime", (long) num(p.optString("createdTime", p.optString("ctime", "0"))));
            out.put(row);
        }
        return out;
    }

    /* ------------------------------------------------------------------ *
     * 주문
     * ------------------------------------------------------------------ */

    /** 레버리지 설정 — 이미 같은 값이면 거래소가 오류를 주므로 실패는 무시하고 주문으로 넘어간다. */
    public static void setLeverage(Keys keys, String symbol, String leverage, String holdSide) {
        try {
            String mode = accountMode(keys);
            if (MODE_UTA.equals(mode)) {
                try {
                    request(keys, "POST", "/api/v3/account/set-leverage", leverageBodyV3(keys, symbol, leverage, holdSide));
                } catch (ApiException e) {
                    if (!ERR_CLASSIC_MODE.equals(e.code)) throw e;
                    switchMode(keys, MODE_CLASSIC);
                    request(keys, "POST", "/api/v2/mix/account/set-leverage", leverageBodyV2(symbol, leverage, holdSide));
                }
                return;
            }
            try {
                request(keys, "POST", "/api/v2/mix/account/set-leverage", leverageBodyV2(symbol, leverage, holdSide));
            } catch (ApiException e) {
                if (!ERR_UTA_MODE.equals(e.code)) throw e;
                switchMode(keys, MODE_UTA);
                request(keys, "POST", "/api/v3/account/set-leverage", leverageBodyV3(keys, symbol, leverage, holdSide));
            }
        } catch (Exception ignored) {
            /* 이미 설정된 레버리지·모드 차이 — 주문 결과로 판정한다 */
        }
    }

    private static JSONObject leverageBodyV2(String symbol, String leverage, String holdSide) {
        JSONObject body = new JSONObject();
        try {
            body.put("symbol", symbol);
            body.put("productType", PRODUCT);
            body.put("marginCoin", MARGIN_COIN);
            body.put("leverage", leverage);
            if (holdSide != null && !holdSide.isEmpty()) body.put("holdSide", holdSide);
        } catch (Exception ignored) {}
        return body;
    }

    private static JSONObject leverageBodyV3(Keys keys, String symbol, String leverage, String holdSide) {
        JSONObject body = new JSONObject();
        try {
            body.put("category", PRODUCT);
            body.put("symbol", symbol);
            body.put("leverage", leverage);
            body.put("marginMode", symbolMarginMode(keys, symbol));
            if (holdSide != null && !holdSide.isEmpty()) {
                body.put("posSide", holdSide);
                // 두 방향 동일 레버리지 — 방향별 설정에서도 같은 값이 되게 한다.
                body.put("longLeverage", leverage);
                body.put("shortLeverage", leverage);
            }
        } catch (Exception ignored) {}
        return body;
    }

    /**
     * 주문 — 정규형(v2 모양) 파라미터를 계정 모드에 맞춰 조립해 보낸다.
     *
     *  1) `prepareOrder` 가 **보내기 전에** 호가 배수(TP/SL·지정가)와 수량 단위(volumePlace 내림),
     *     최소 주문 금액·TP/SL 방향을 계약 스펙으로 맞춘다 — 45115/43006/25585 류를 미리 막는다.
     *  2) 그래도 45115(또는 v3 25244)가 오면 계약 호가로 다시 맞춰 **한 번** 재시도한다.
     *  3) 같은 clientOid(25212)는 이미 접수된 주문이다 — 중복으로 보내지 않고 성공으로 돌려준다.
     * 성공 시 orderId/clientOid.
     */
    public static JSONObject placeOrder(Keys keys, JSONObject params) throws Exception {
        if (params == null) throw new ApiException("params", "주문 파라미터가 없습니다.");
        JSONObject prepared = prepareOrder(keys, params);
        try {
            return sendOrder(keys, prepared);
        } catch (ApiException e) {
            if (ERR_DUPLICATE_OID.equals(e.code)) return duplicateResult(keys, prepared);
            if (!ERR_PRICE_STEP.equals(e.code) && !ERR_PRICE_STEP_V3.equals(e.code)) throw e;
            JSONObject fixed = withTickPrices(prepared);
            if (fixed == null) throw e;
            try {
                return sendOrder(keys, fixed);
            } catch (ApiException again) {
                if (ERR_DUPLICATE_OID.equals(again.code)) return duplicateResult(keys, fixed);
                throw again;
            }
        }
    }

    /** 25212(중복 clientOid) — 이미 접수된 주문이므로 성공으로 본다(서비스가 재시도 루프에 빠지지 않게). */
    private static JSONObject duplicateResult(Keys keys, JSONObject params) throws Exception {
        JSONObject out = new JSONObject();
        out.put("orderId", "");
        out.put("clientOid", params == null ? "" : params.optString("clientOid", ""));
        out.put("duplicate", true);
        out.put("accountMode", knownMode(keys));
        return out;
    }

    /**
     * 포지션 시장가 청산 — 문서의 방향 규칙을 그대로 쓴다.
     *   헤지   : 롱 청산 = sell + posSide=long (v2 는 tradeSide=close) · 숏 청산 = buy + posSide=short
     *   단방향 : 롱 청산 = sell + reduceOnly · 숏 청산 = buy + reduceOnly
     * `posSide` 는 **청산할 포지션의 방향**이다. 주문 side 로 추론하면 롱 청산이 숏 진입으로 뒤집힌다.
     */
    public static JSONObject closePosition(
            Keys keys,
            String symbol,
            String holdSide,
            String size,
            String posMode,
            String marginMode,
            String clientOid) throws Exception {
        if (symbol == null || symbol.isEmpty()) throw new ApiException("symbol", "종목이 없습니다.");
        if (!(num(size) > 0)) throw new ApiException(GUARD_SIZE, "청산할 수량이 없습니다.");
        boolean hedge = "hedge_mode".equals(posMode);
        boolean longSide = !"short".equalsIgnoreCase(holdSide == null ? "" : holdSide);
        JSONObject p = new JSONObject();
        p.put("symbol", symbol);
        p.put("productType", PRODUCT);
        p.put("marginCoin", MARGIN_COIN);
        p.put("marginMode", marginMode == null || marginMode.isEmpty() ? symbolMarginMode(keys, symbol) : marginMode);
        p.put("size", size);
        p.put("side", longSide ? "sell" : "buy");
        p.put("orderType", "market");
        if (hedge) {
            p.put("tradeSide", "close");
            p.put("posSide", longSide ? "long" : "short");
        } else {
            p.put("reduceOnly", "true");
        }
        if (clientOid != null && !clientOid.isEmpty()) p.put("clientOid", clientOid);
        // 수량을 거래소 단위로 내림·검증(청산은 최소금액·TP 검사 제외)
        JSONObject prepared = prepareOrder(keys, p);
        try {
            return sendOrder(keys, prepared);
        } catch (ApiException e) {
            if (ERR_DUPLICATE_OID.equals(e.code)) return duplicateResult(keys, prepared);
            throw e;
        }
    }

    /** 실제 전송 — 계정 모드별 엔드포인트 선택과 40084/40085 폴백 */
    private static JSONObject sendOrder(Keys keys, JSONObject params) throws Exception {
        String mode = accountMode(keys);
        Object data;
        if (MODE_UTA.equals(mode)) {
            try {
                data = request(keys, "POST", "/api/v3/trade/place-order", orderBodyV3(keys, params));
            } catch (ApiException e) {
                if (!ERR_CLASSIC_MODE.equals(e.code)) throw e;
                switchMode(keys, MODE_CLASSIC);
                data = request(keys, "POST", "/api/v2/mix/order/place-order", orderBodyV2(params));
            }
        } else {
            try {
                data = request(keys, "POST", "/api/v2/mix/order/place-order", orderBodyV2(params));
            } catch (ApiException e) {
                if (!ERR_UTA_MODE.equals(e.code)) throw e;
                switchMode(keys, MODE_UTA);
                data = request(keys, "POST", "/api/v3/trade/place-order", orderBodyV3(keys, params));
            }
        }
        JSONObject out = new JSONObject();
        if (data instanceof JSONObject) {
            JSONObject d = (JSONObject) data;
            out.put("orderId", d.optString("orderId", ""));
            out.put("clientOid", d.optString("clientOid", params == null ? "" : params.optString("clientOid", "")));
        }
        out.put("accountMode", knownMode(keys));
        return out;
    }

    /* ------------------------------------------------------------------ *
     * 호가 단위(tick) — 45115 "The price you enter should be a multiple of 0.01"
     * ------------------------------------------------------------------ */

    /**
     * 가격 → 호가 배수로 반올림한 문자열.
     *   최소 호가 = priceEndStep × 10^(-pricePlace)  (BTC 0.1 · ETH/BNB/MSTR 0.01 · 스텝5 코인 0.0005)
     * 신호의 목표가·손절가는 진입가 ± ATR 로 계산되어 소수 꼬리가 남는다 — 주문 직전에 여기서 맞춘다.
     *   roundToTick(91234.567, 1, 1) → "91234.6"
     *   roundToTick(3456.789, 2, 1)  → "3456.79"
     *   roundToTick(0.00062, 4, 5)  → "0.0005"
     */
    public static String roundToTick(double price, int pricePlace, int priceEndStep) {
        if (!(price > 0)) return "";
        int pp = Math.max(0, Math.min(8, pricePlace));
        int step = priceEndStep > 0 ? priceEndStep : 1;
        BigDecimal scale = BigDecimal.TEN.pow(pp);
        BigDecimal stepDec = BigDecimal.valueOf(step);
        BigDecimal ticks = BigDecimal.valueOf(price).multiply(scale).divide(stepDec, 0, RoundingMode.HALF_UP);
        if (ticks.signum() <= 0) ticks = BigDecimal.ONE; // 0 호가 방지 — 최소 한 틱
        BigDecimal scaled = ticks.multiply(stepDec);
        return new BigDecimal(scaled.toBigIntegerExact(), pp).stripTrailingZeros().toPlainString();
    }

    /**
     * 계약의 주문 단위 — 공개 계약 API(`/api/v2/mix/market/contracts`) 값.
     *  · pricePlace·priceEndStep : 최소 호가 = priceEndStep × 10^(-pricePlace)
     *  · volumePlace·minTradeNum : 수량 소수 자리·최소 수량
     *  · minTradeUSDT            : 최소 주문 금액(보통 5 USDT)
     */
    public static final class ContractLimits {
        public final int pricePlace;
        public final int priceEndStep;
        public final int volumePlace;
        public final double minTradeNum;
        public final double minTradeUSDT;
        /**
         * 수량 배수(sizeMultiplier) — BTC 0.0001 · MSTR 0.01 처럼 10^-volumePlace 와 같은 값이거나,
         * 1·10 처럼 **더 큰** 단위다. 실제 최소 주문 단위 = max(10^-volumePlace, sizeMultiplier).
         */
        public final double sizeMultiplier;

        ContractLimits(
                int pricePlace,
                int priceEndStep,
                int volumePlace,
                double minTradeNum,
                double minTradeUSDT,
                double sizeMultiplier) {
            this.pricePlace = pricePlace;
            this.priceEndStep = priceEndStep;
            this.volumePlace = volumePlace;
            this.minTradeNum = minTradeNum;
            this.minTradeUSDT = minTradeUSDT;
            this.sizeMultiplier = sizeMultiplier > 0 ? sizeMultiplier : 0;
        }
    }

    /** 종목 계약 단위 — 공개 계약 API에서 읽고 30분 캐시. 실패하면 null(실패도 60초 기억). */
    public static ContractLimits contractLimits(String symbol) {
        if (symbol == null || symbol.isEmpty()) return null;
        ContractLimits cached = LIMITS.get(symbol);
        if (cached != null) return cached;
        Long failedAt = LIMITS_FAILED_AT.get(symbol);
        long now = System.currentTimeMillis();
        if (failedAt != null && now - failedAt < LIMITS_FAIL_TTL_MS) return null;
        try {
            Object data = publicGet("/api/v2/mix/market/contracts?symbol=" + encode(symbol) + "&productType=" + PRODUCT);
            JSONObject row = null;
            if (data instanceof JSONArray) {
                JSONArray arr = (JSONArray) data;
                if (arr.length() > 0) row = arr.optJSONObject(0);
            } else if (data instanceof JSONObject) {
                row = (JSONObject) data;
            }
            if (row == null) {
                LIMITS_FAILED_AT.put(symbol, now);
                return null;
            }
            double place = num(row.optString("pricePlace", ""));
            double step = num(row.optString("priceEndStep", ""));
            if (place < 0 || place > 8) {
                LIMITS_FAILED_AT.put(symbol, now);
                return null;
            }
            int pp = (int) Math.round(place);
            int endStep = (int) Math.round(step);
            if (endStep <= 0) endStep = 1;
            double volume = num(row.optString("volumePlace", ""));
            int vp = volume < 0 || volume > 8 ? 0 : (int) Math.round(volume);
            ContractLimits out = new ContractLimits(
                    pp,
                    endStep,
                    vp,
                    num(row.optString("minTradeNum", "")),
                    num(row.optString("minTradeUSDT", "")),
                    num(row.optString("sizeMultiplier", "")));
            LIMITS.put(symbol, out);
            LIMITS_FAILED_AT.remove(symbol);
            return out;
        } catch (Exception e) {
            LIMITS_FAILED_AT.put(symbol, now);
            return null;
        }
    }

    /** 호환용 — {pricePlace, priceEndStep} */
    public static int[] contractTick(String symbol) {
        ContractLimits lim = contractLimits(symbol);
        if (lim == null) return null;
        return new int[]{lim.pricePlace, lim.priceEndStep};
    }

    /**
     * 수량 → 거래소 수량 단위로 **내림**(계획한 리스크를 넘기지 않게)한 문자열.
     *   floorToStep(40762.5, 0) → "40762" · floorToStep(1.234, 2) → "1.23"
     * maxDecimalPlaces(8) 를 넘는 소수는 과학적 표기법 대신 고정 소수로 쓴다.
     */
    /**
     * 수량 → max(10^-volumePlace, sizeMultiplier) 단위로 내림.
     *   BTC(volumePlace=4 · 0.0001) → 0.0001 · MSTR(2 · 0.01) → 0.01 · (2 · 1) → 1 · (0 · 10) → 10
     */
    public static String floorToStep(double qty, int volumePlace, double sizeMultiplier) {
        if (!(qty > 0) || !Double.isFinite(qty)) return "";
        int vp = Math.max(0, Math.min(8, volumePlace));
        BigDecimal scale = BigDecimal.TEN.pow(vp);
        BigDecimal mult = BigDecimal.valueOf(sizeMultiplier > 0 && Double.isFinite(sizeMultiplier) ? sizeMultiplier : 0);
        // 10^-vp 단위의 개수로 환산한 최소 주문 단위(1 이상 정수)
        BigDecimal stepUnits = mult.multiply(scale).setScale(0, RoundingMode.HALF_UP);
        if (stepUnits.signum() <= 0) stepUnits = BigDecimal.ONE;
        BigDecimal units = BigDecimal.valueOf(qty).multiply(scale).divide(stepUnits, 0, RoundingMode.FLOOR);
        if (units.signum() <= 0) return "";
        BigDecimal value = units.multiply(stepUnits);
        return new BigDecimal(value.toBigIntegerExact(), vp).stripTrailingZeros().toPlainString();
    }

    /** 마지막 체결가(5초 캐시) — 주문 직전 TP/SL 방향 검사에 쓴다. 실패하면 0 */
    public static double lastPriceCached(String symbol) {
        if (symbol == null || symbol.isEmpty()) return 0;
        double[] cached = QUOTE.get(symbol);
        long now = System.currentTimeMillis();
        if (cached != null && now - (long) cached[1] < QUOTE_TTL_MS) return cached[0];
        try {
            double price = lastPrice(symbol);
            if (price > 0) QUOTE.put(symbol, new double[]{price, now});
            return price;
        } catch (Exception e) {
            return cached == null ? 0 : cached[0];
        }
    }

    /** 45115 대응 — 계약 호가로 TP/SL·지정가를 다시 맞춘 파라미터(바뀐 게 없으면 null) */
    static JSONObject withTickPrices(JSONObject params) {
        ContractLimits lim = contractLimits(params.optString("symbol", ""));
        if (lim == null) return null;
        try {
            JSONObject out = new JSONObject(params.toString());
            boolean changed = false;
            String[] keys = {"presetStopSurplusPrice", "presetStopLossPrice", "price"};
            for (String key : keys) {
                String raw = out.optString(key, "");
                if (raw.isEmpty()) continue;
                double value = num(raw);
                if (!(value > 0)) continue;
                String exact = roundToTick(value, lim.pricePlace, lim.priceEndStep);
                if (!exact.isEmpty() && !exact.equals(raw)) {
                    out.put(key, exact);
                    changed = true;
                }
            }
            // 수량도 거래소 단위로 다시 내린다 — 웹이 계약 정보 없이 보냈을 때 43006/40762 를 막는다.
            String size = out.optString("size", "");
            double qty = num(size);
            if (qty > 0) {
                String floored = floorToStep(qty, lim.volumePlace, lim.sizeMultiplier);
                if (!floored.isEmpty() && !floored.equals(size)) {
                    out.put("size", floored);
                    changed = true;
                }
            }
            return changed ? out : null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 주문 전 정규화·검사 — 거래소가 거절할 주문을 **보내기 전에** 고치거나 막는다.
     *   · TP/SL·지정가 → 호가 배수 (45115/25244)
     *   · 수량 → volumePlace 내림 + 최소 수량/최소 금액 (45110/45111/43006/40762)
     *   · TP/SL 방향 → 현재가 기준 (25585~25592) — 이미 목표가를 지나쳤으면 25585 로 거절된다
     * 실패 시 `guard:size` / `guard:tp` 코드의 ApiException — 서비스는 '주문 실패'가 아니라 '진입 취소'로 기록한다.
     */
    static JSONObject prepareOrder(Keys keys, JSONObject params) throws ApiException {
        JSONObject out;
        try {
            out = new JSONObject(params.toString());
        } catch (Exception e) {
            throw new ApiException("params", "주문 파라미터를 읽을 수 없습니다.");
        }
        String symbol = out.optString("symbol", "");
        boolean closing = "close".equalsIgnoreCase(out.optString("tradeSide", ""))
                || "true".equalsIgnoreCase(out.optString("reduceOnly", ""))
                || "yes".equalsIgnoreCase(out.optString("reduceOnly", ""));
        try {
            ContractLimits lim = contractLimits(symbol);
            if (lim != null) {
                for (String key : new String[]{"presetStopSurplusPrice", "presetStopLossPrice", "price"}) {
                    String raw = out.optString(key, "");
                    if (raw.isEmpty()) continue;
                    double value = num(raw);
                    if (!(value > 0)) continue;
                    String exact = roundToTick(value, lim.pricePlace, lim.priceEndStep);
                    if (!exact.isEmpty()) out.put(key, exact);
                }
                String size = out.optString("size", "");
                double qty = num(size);
                if (qty > 0) {
                    String floored = floorToStep(qty, lim.volumePlace, lim.sizeMultiplier);
                    double flooredQty = num(floored);
                    if (flooredQty <= 0) {
                        throw new ApiException(GUARD_SIZE, String.format(Locale.US,
                                "주문 수량이 거래소 최소 단위(%.10f)보다 작아 주문하지 않았습니다. 리스크 %%나 시드를 키워 주세요.",
                                Math.pow(10, -lim.volumePlace)));
                    }
                    if (flooredQty < qty - 1e-12) out.put("size", floored);
                    if (!closing && lim.minTradeNum > 0 && flooredQty < lim.minTradeNum - 1e-12) {
                        throw new ApiException(GUARD_SIZE, String.format(Locale.US,
                                "주문 수량 %.8f 이 최소 수량 %.8f 보다 작아 주문하지 않았습니다.", flooredQty, lim.minTradeNum));
                    }
                }
                if (!closing && lim.minTradeUSDT > 0) {
                    double px = num(out.optString("price", ""));
                    if (!(px > 0)) px = lastPriceCached(symbol);
                    double notional = qty > 0 && px > 0 ? qty * px : 0;
                    if (notional > 0 && notional < lim.minTradeUSDT - 1e-9) {
                        throw new ApiException(GUARD_SIZE, String.format(Locale.US,
                                "주문 금액 $%,.2f 이 최소 주문 금액 $%,.2f 보다 작아 주문하지 않았습니다.",
                                notional, lim.minTradeUSDT));
                    }
                }
            }
            if (!closing) checkTpSlDirection(out, symbol, lim);
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            /* 계약 정보를 못 읽어도 주문 자체는 보낸다(거래소가 최종 판단). */
        }
        return out;
    }

    /**
     * TP/SL 방향 검사 — 거래소 오류 25585~25592(최근가·지정가 기준)를 미리 막는다.
     *   롱: 손절가 < 현재가 < 목표가 · 숏: 목표가 < 현재가 < 손절가 (0.1% 여유)
     */
    private static void checkTpSlDirection(JSONObject out, String symbol, ContractLimits lim) throws ApiException {
        String tpRaw = out.optString("presetStopSurplusPrice", "");
        String slRaw = out.optString("presetStopLossPrice", "");
        if (tpRaw.isEmpty() && slRaw.isEmpty()) return;
        double price = lastPriceCached(symbol);
        if (!(price > 0)) return;
        boolean longSide = "buy".equalsIgnoreCase(out.optString("side", "buy"))
                && !"short".equalsIgnoreCase(out.optString("posSide", "long"));
        double tp = num(tpRaw);
        double sl = num(slRaw);
        double tick = lim == null ? 0 : lim.priceEndStep * Math.pow(10, -lim.pricePlace);
        double gap = Math.max(price * 0.0001, tick);
        if (longSide) {
            if (tp > 0 && tp <= price + gap) {
                throw new ApiException(GUARD_TP, String.format(Locale.US,
                        "현재가 %.8f 가 이미 목표가 %.8f 에 닿아 목표가를 걸 수 없습니다 — 진입을 건너뜁니다.", price, tp));
            }
            if (sl > 0 && sl >= price - gap) {
                throw new ApiException(GUARD_TP, String.format(Locale.US,
                        "현재가 %.8f 가 이미 손절가 %.8f 에 닿아 진입을 건너뜁니다.", price, sl));
            }
        } else {
            if (tp > 0 && tp >= price - gap) {
                throw new ApiException(GUARD_TP, String.format(Locale.US,
                        "현재가 %.8f 가 이미 목표가 %.8f 에 닿아 목표가를 걸 수 없습니다 — 진입을 건너뜁니다.", price, tp));
            }
            if (sl > 0 && sl <= price + gap) {
                throw new ApiException(GUARD_TP, String.format(Locale.US,
                        "현재가 %.8f 가 이미 손절가 %.8f 에 닿아 진입을 건너뜁니다.", price, sl));
            }
        }
    }

    /** v2 주문 body — 예전 그대로(size·productType·presetStopSurplusPrice) */
    static JSONObject orderBodyV2(JSONObject params) {
        JSONObject body = new JSONObject();
        try {
            body.put("symbol", params.optString("symbol"));
            body.put("productType", params.optString("productType", PRODUCT));
            body.put("marginMode", normalizeMarginMode(params.optString("marginMode", "isolated")));
            body.put("marginCoin", params.optString("marginCoin", MARGIN_COIN));
            body.put("size", params.optString("size"));
            body.put("side", params.optString("side"));
            body.put("orderType", params.optString("orderType", "market"));
            if ("limit".equals(params.optString("orderType")) && !params.optString("price", "").isEmpty()) {
                body.put("price", params.optString("price"));
                body.put("force", "gtc");
            }
            if (!params.optString("clientOid", "").isEmpty()) body.put("clientOid", params.optString("clientOid"));
            String tradeSide = params.optString("tradeSide", "");
            if (!tradeSide.isEmpty()) body.put("tradeSide", tradeSide);
            String reduceOnly = params.optString("reduceOnly", "");
            if ("true".equalsIgnoreCase(reduceOnly) || "yes".equalsIgnoreCase(reduceOnly)) body.put("reduceOnly", "true");
            String tp = params.optString("presetStopSurplusPrice", "");
            String sl = params.optString("presetStopLossPrice", "");
            if (!tp.isEmpty()) body.put("presetStopSurplusPrice", tp);
            if (!sl.isEmpty()) body.put("presetStopLossPrice", sl);
        } catch (Exception ignored) {}
        return body;
    }

    /** v3 주문 body — category·qty·posSide·takeProfit/stopLoss */
    private static JSONObject orderBodyV3(Keys keys, JSONObject params) throws Exception {
        boolean hedge = "hedge_mode".equals(holdMode(keys, params.optString("symbol", "")));
        return orderBodyV3(keys, params, hedge);
    }

    static JSONObject orderBodyV3(Keys keys, JSONObject params, boolean hedge) {
        JSONObject body = new JSONObject();
        try {
            String side = params.optString("side", "buy");
            body.put("category", PRODUCT);
            body.put("symbol", params.optString("symbol"));
            body.put("qty", params.optString("size"));
            body.put("side", side);
            body.put("orderType", params.optString("orderType", "market"));
            if ("limit".equals(params.optString("orderType")) && !params.optString("price", "").isEmpty()) {
                body.put("price", params.optString("price"));
                body.put("timeInForce", "gtc");
            }
            // 계좌에 설정된 마진 모드를 그대로 따른다(교차→격리 전환은 포지션이 있으면 거절된다).
            body.put("marginMode", symbolMarginMode(keys, params.optString("symbol", "")));
            String posSide = params.optString("posSide", "");
            if (hedge) {
                if (posSide.isEmpty()) {
                    boolean close = "close".equalsIgnoreCase(params.optString("tradeSide", ""));
                    if (close) posSide = "buy".equalsIgnoreCase(side) ? "short" : "long";
                    else posSide = "buy".equalsIgnoreCase(side) ? "long" : "short";
                }
                body.put("posSide", posSide);
            }
            body.put("clientOid", clientOidV3(params.optString("clientOid", "")));
            if (!hedge) {
                String reduceOnly = params.optString("reduceOnly", "");
                if ("true".equalsIgnoreCase(reduceOnly) || "yes".equalsIgnoreCase(reduceOnly)) body.put("reduceOnly", "yes");
            }
            String tp = params.optString("presetStopSurplusPrice", "");
            String sl = params.optString("presetStopLossPrice", "");
            if (!tp.isEmpty()) {
                body.put("takeProfit", tp);
                body.put("tpOrderType", "market");
            }
            if (!sl.isEmpty()) {
                body.put("stopLoss", sl);
                body.put("slOrderType", "market");
            }
        } catch (Exception ignored) {}
        return body;
    }

    /** v3 clientOid 규칙 `^[.A-Z:/a-z0-9_-]{1,32}$` — v2 의 36자보다 짧다 */
    public static String clientOidV3(String raw) {
        String cleaned = raw == null ? "" : raw.replaceAll("[^.A-Za-z0-9:_/-]", "");
        if (cleaned.isEmpty()) return "cota";
        return cleaned.length() > 32 ? cleaned.substring(0, 32) : cleaned;
    }

    /** 현재가 (Public) */
    public static double lastPrice(String symbol) throws Exception {
        Object data = publicGet("/api/v2/mix/market/ticker?symbol=" + encode(symbol) + "&productType=" + PRODUCT);
        if (data instanceof JSONArray && ((JSONArray) data).length() > 0) {
            JSONObject t = ((JSONArray) data).optJSONObject(0);
            if (t != null) return num(t.optString("lastPr", "0"));
        }
        return 0;
    }

    /* ------------------------------------------------------------------ *
     * JSON 숫자 도우미 — 비트겟은 숫자를 문자열로 준다.
     * ------------------------------------------------------------------ */

    public static double num(String value) {
        if (value == null || value.isEmpty() || "null".equals(value)) return 0;
        try {
            return Double.parseDouble(value.trim());
        } catch (Exception e) {
            return 0;
        }
    }

    private static double number(JSONObject obj, String key, String fallbackKey) {
        String v = obj.optString(key, "");
        if (v == null || v.isEmpty()) v = obj.optString(fallbackKey, "0");
        return num(v);
    }

    /** 키 마스킹 — 화면에는 이 형태만 */
    public static String maskKey(String key) {
        if (key == null || key.isEmpty()) return "";
        if (key.length() <= 8) return key.substring(0, Math.min(2, key.length())) + "••••";
        return key.substring(0, 6) + "••••••" + key.substring(key.length() - 4);
    }

    /** 저장된 키로 Keys 묶음 */
    public static Keys keys(Context context) {
        return AutoTradeStore.keys(context);
    }
}
