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

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * 비트겟 v2 USDT-M Futures REST 클라이언트 (네이티브 전용).
 *
 * 웹뷰는 CORS·Secret 노출 문제로 Private API를 직접 부를 수 없다. 그래서 서명과 주문은
 * 여기(안드로이드)에서만 일어나고, 웹에는 마스킹된 상태·잔고·포지션·주문 결과만 돌려준다.
 *
 * 서명 규격 (Bitget v2):
 *   prehash = timestamp(ms) + METHOD + requestPath(+query) + bodyJson
 *   ACCESS-SIGN = Base64(HMAC-SHA256(secret, prehash))
 *   헤더 ACCESS-KEY · ACCESS-SIGN · ACCESS-TIMESTAMP · ACCESS-PASSPHRASE
 *   모의투자(Demo)는 추가로 `paptrading: 1`
 *
 * `src/lib/bitgetSign.ts`(참조 구현)와 **같은 입력 → 같은 서명**이어야 한다(단위 테스트로 고정).
 */
public final class BitgetApi {

    public static final String BASE = "https://api.bitget.com";
    public static final String PRODUCT = "USDT-FUTURES";
    public static final String MARGIN_COIN = "USDT";

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
                case "40014":
                    return "API 키가 올바르지 않습니다. Key·Secret·Passphrase를 다시 확인해 주세요.";
                case "40018":
                    return "모의투자(Demo) 키와 모드가 맞지 않습니다. 모의투자 계좌에서 발급한 키인지 확인해 주세요.";
                case "40109":
                    return "출금 권한은 필요 없습니다. 거래 권한만 있는 키를 사용해 주세요.";
                case "400172":
                case "43025":
                    return "주문 가능 수량/증거금이 부족합니다.";
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

    /** Public 요청 — 서명 없이(가격·캔들) */
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
     * 계정 · 포지션
     * ------------------------------------------------------------------ */

    /** USDT-M 계좌 — equity(총자산) · available(주문 가능) · unrealizedPL */
    public static JSONObject accounts(Keys keys) throws Exception {
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
                return out;
            }
        }
        out.put("equity", 0);
        out.put("available", 0);
        out.put("unrealizedPL", 0);
        return out;
    }

    /** 포지션 모드(one_way_mode / hedge_mode) */
    public static String holdMode(Keys keys, String symbol) throws Exception {
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

    /** 보유 포지션(수량 0 제외) */
    public static JSONArray positions(Keys keys) throws Exception {
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

    /* ------------------------------------------------------------------ *
     * 주문
     * ------------------------------------------------------------------ */

    /** 레버리지 설정 — 이미 같은 값이면 거래소가 오류를 주므로 실패는 무시하고 주문으로 넘어간다. */
    public static void setLeverage(Keys keys, String symbol, String leverage, String holdSide) {
        try {
            JSONObject body = new JSONObject();
            body.put("symbol", symbol);
            body.put("productType", PRODUCT);
            body.put("marginCoin", MARGIN_COIN);
            body.put("leverage", leverage);
            if (holdSide != null && !holdSide.isEmpty()) body.put("holdSide", holdSide);
            request(keys, "POST", "/api/v2/mix/account/set-leverage", body);
        } catch (Exception ignored) {
            /* 이미 설정된 레버리지·모드 차이 — 주문 결과로 판정한다 */
        }
    }

    /** 주문 — 시장가 + TP/SL(preset). 성공 시 orderId/clientOid */
    public static JSONObject placeOrder(Keys keys, JSONObject params) throws Exception {
        Object data = request(keys, "POST", "/api/v2/mix/order/place-order", params);
        JSONObject out = new JSONObject();
        if (data instanceof JSONObject) {
            JSONObject d = (JSONObject) data;
            out.put("orderId", d.optString("orderId", ""));
            out.put("clientOid", d.optString("clientOid", ""));
        }
        return out;
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
