package com.hw3238.bitgetscanner;

import android.content.Context;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
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

    private static final long SETTINGS_TTL_MS = 5 * 60_000L;

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

    /** Private 요청 — body 가 null 이면 GET/POST without body */
    public static Object request(Keys keys, String method, String path, JSONObject body) throws Exception {
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

    /** Public 요청 — 서명 없이(가격·캔들). 공개 시세는 계정 모드와 무관하게 v2 경로를 쓴다. */
    public static Object publicGet(String path) throws Exception {
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

    private static boolean isAuthError(String code) {
        return "40006".equals(code) || "40009".equals(code) || "40012".equals(code)
                || "40037".equals(code) || "40005".equals(code) || "40004".equals(code);
    }

    /**
     * 계정 종류 판별(캐시 사용).
     *  1) v3 settings 성공 → UTA
     *  2) v3 settings 40084 → Classic
     *  3) 그 밖의 오류 — v2 계좌를 찔러 40085 면 UTA, 성공하면 Classic
     *  4) 키·서명 오류는 그대로 올린다(모드 문제가 아니다).
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
            if (isAuthError(e.code)) throw e;
            // 권한이 모자라 v3 settings 를 못 읽는 경우가 있다 — v2 로 확인한다.
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
     * 성공 시 orderId/clientOid. 40085/40084 는 모드를 뒤집어 **한 번** 다시 보낸다.
     */
    public static JSONObject placeOrder(Keys keys, JSONObject params) throws Exception {
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
