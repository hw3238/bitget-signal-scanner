package com.hw3238.bitgetscanner;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * 🤖 자동매매 저장소 — 앱 전용 SharedPreferences(MODE_PRIVATE).
 *
 *  · API Key / Secret / Passphrase : 웹뷰(JS)로 원문이 나가지 않는다. 화면에는 마스킹만.
 *  · 설정 · 감시 목록 · 로그 · 중복 진입 키 · 하루 손실 기준선 : 서비스가 앱이 꺼져 있어도 이어 쓴다.
 *  · 외부 서버 전송 없음 — 기기 안에만 남는다.
 */
public final class AutoTradeStore {

    private static final String PREFS = "cota_autotrade";

    private static final String K_APIKEY = "api_key";
    private static final String K_SECRET = "secret";
    private static final String K_PASSPHRASE = "passphrase";
    private static final String K_DEMO = "demo";
    private static final String K_SAVED_AT = "saved_at";

    private static final String K_CONFIG = "config";
    private static final String K_PLANS = "plans";
    private static final String K_LOG = "log";
    private static final String K_TRADED = "traded_keys";
    private static final String K_DAY = "day_key";
    private static final String K_DAY_EQUITY = "day_start_equity";
    private static final String K_DAILY_LOCKED = "daily_locked";
    private static final String K_RUNNING = "service_running";
    private static final String K_LAST_TICK = "last_tick";
    private static final String K_EQUITY = "last_equity";
    private static final String K_POSITIONS = "last_positions";
    /** 마지막으로 판별된 비트겟 계정 종류 — "uta" / "classic" / "" (아직 모름) */
    private static final String K_ACCOUNT_MODE = "account_mode";

    private static final int LOG_LIMIT = 40;
    private static final int TRADED_LIMIT = 200;

    private AutoTradeStore() {}

    /** 한국 시간 기준 오늘 날짜(YYYY-MM-DD) — 거래소·사용자 모두 KST로 하루를 끊는다. */
    public static String todayKst() {
        SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        fmt.setTimeZone(TimeZone.getTimeZone("Asia/Seoul"));
        return fmt.format(new Date());
    }

    public static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /* ---------------- 키 ---------------- */

    public static void saveKeys(Context context, String apiKey, String secret, String passphrase, boolean demo) {
        prefs(context)
            .edit()
            .putString(K_APIKEY, apiKey == null ? "" : apiKey.trim())
            .putString(K_SECRET, secret == null ? "" : secret.trim())
            .putString(K_PASSPHRASE, passphrase == null ? "" : passphrase.trim())
            .putBoolean(K_DEMO, demo)
            .putLong(K_SAVED_AT, System.currentTimeMillis())
            .apply();
    }

    public static BitgetApi.Keys keys(Context context) {
        SharedPreferences p = prefs(context);
        String key = p.getString(K_APIKEY, "");
        String secret = p.getString(K_SECRET, "");
        String pass = p.getString(K_PASSPHRASE, "");
        if (key == null || key.isEmpty() || secret == null || secret.isEmpty() || pass == null || pass.isEmpty()) {
            return null;
        }
        return new BitgetApi.Keys(key, secret, pass, p.getBoolean(K_DEMO, true));
    }

    public static boolean hasKeys(Context context) {
        BitgetApi.Keys k = keys(context);
        return k != null && k.complete();
    }

    public static void clearKeys(Context context) {
        prefs(context)
            .edit()
            .remove(K_APIKEY)
            .remove(K_SECRET)
            .remove(K_PASSPHRASE)
            .remove(K_DEMO)
            .remove(K_SAVED_AT)
            .remove(K_ACCOUNT_MODE)
            .putBoolean(K_RUNNING, false)
            .apply();
    }

    /**
     * JS로 돌려주는 키 상태 — 원문 없이 마스킹만.
     *  · hasKeys 는 Key·Secret·Passphrase **세 값이 모두** 있을 때만 true (keys() 와 같은 기준).
     *  · passphraseSet 은 화면의 `Passphrase: —` 오판을 막기 위해 저장 여부를 그대로 알린다.
     */
    public static JSONObject keyState(Context context) {
        SharedPreferences p = prefs(context);
        String key = p.getString(K_APIKEY, "");
        String secret = p.getString(K_SECRET, "");
        String passphrase = p.getString(K_PASSPHRASE, "");
        boolean keySet = key != null && !key.isEmpty();
        boolean secretSet = secret != null && !secret.isEmpty();
        boolean passphraseSet = passphrase != null && !passphrase.isEmpty();
        JSONObject out = new JSONObject();
        try {
            out.put("hasKeys", keySet && secretSet && passphraseSet);
            out.put("demo", p.getBoolean(K_DEMO, true));
            out.put("apiKeyMasked", BitgetApi.maskKey(key == null ? "" : key));
            out.put("secretSet", secretSet);
            out.put("passphraseSet", passphraseSet);
            out.put("accountMode", p.getString(K_ACCOUNT_MODE, "unknown"));
            out.put("savedAt", p.getLong(K_SAVED_AT, 0));
        } catch (Exception ignored) {}
        return out;
    }

    /* ---------------- 계정 종류 ---------------- */

    public static String accountMode(Context context) {
        String mode = prefs(context).getString(K_ACCOUNT_MODE, "unknown");
        return mode == null || mode.isEmpty() ? "unknown" : mode;
    }

    public static void setAccountMode(Context context, String mode) {
        String value = mode == null ? "unknown" : mode;
        if (value.equals(accountMode(context))) return;
        prefs(context).edit().putString(K_ACCOUNT_MODE, value).apply();
    }

    public static boolean isDemo(Context context) {
        return prefs(context).getBoolean(K_DEMO, true);
    }

    /* ---------------- 설정 ---------------- */

    public static JSONObject config(Context context) {
        String raw = prefs(context).getString(K_CONFIG, "");
        try {
            if (raw != null && !raw.isEmpty()) return new JSONObject(raw);
        } catch (Exception ignored) {}
        JSONObject fallback = new JSONObject();
        try {
            fallback.put("enabled", false);
            fallback.put("mode", "demo");
            fallback.put("autoEntry", true);
            fallback.put("riskPct", 1.5);
            fallback.put("maxPositions", 2);
            fallback.put("dailyLossPct", 4.5);
            fallback.put("symbols", "majors");
            fallback.put("minWinRate", 55);
            fallback.put("minRR", 1.5);
            fallback.put("maxLeverage", 10);
            fallback.put("intervalSec", 60);
            fallback.put("entryTtlMin", 120);
        } catch (Exception ignored) {}
        return fallback;
    }

    public static void saveConfig(Context context, JSONObject config) {
        if (config == null) return;
        prefs(context).edit().putString(K_CONFIG, config.toString()).apply();
    }

    /* ---------------- 감시 목록 ---------------- */

    public static JSONArray plans(Context context) {
        return array(prefs(context).getString(K_PLANS, ""));
    }

    public static void savePlans(Context context, JSONArray plans) {
        prefs(context).edit().putString(K_PLANS, plans == null ? "[]" : plans.toString()).apply();
    }

    /* ---------------- 중복 진입 키 ---------------- */

    public static JSONArray tradedKeys(Context context) {
        return array(prefs(context).getString(K_TRADED, ""));
    }

    public static boolean alreadyTraded(Context context, String key) {
        JSONArray arr = tradedKeys(context);
        for (int i = 0; i < arr.length(); i++) {
            if (key.equals(arr.optString(i))) return true;
        }
        return false;
    }

    public static void markTraded(Context context, String key) {
        JSONArray arr = tradedKeys(context);
        if (alreadyTraded(context, key)) return;
        JSONArray next = new JSONArray();
        next.put(key);
        for (int i = 0; i < arr.length() && next.length() < TRADED_LIMIT; i++) next.put(arr.opt(i));
        prefs(context).edit().putString(K_TRADED, next.toString()).apply();
    }

    /** KST 날짜가 바뀌면 중복 키만 초기화하지 않고 그대로 둔다(하루 동안만 의미). */
    public static void clearTraded(Context context) {
        prefs(context).edit().putString(K_TRADED, "[]").apply();
    }

    /* ---------------- 로그 ---------------- */

    public static JSONArray logs(Context context) {
        return array(prefs(context).getString(K_LOG, ""));
    }

    public static void addLog(Context context, String level, String text) {
        JSONArray prev = logs(context);
        JSONArray next = new JSONArray();
        try {
            JSONObject item = new JSONObject();
            item.put("at", System.currentTimeMillis());
            item.put("level", level == null ? "info" : level);
            item.put("text", text == null ? "" : text);
            next.put(item);
            for (int i = 0; i < prev.length() && next.length() < LOG_LIMIT; i++) next.put(prev.opt(i));
        } catch (Exception ignored) {}
        prefs(context).edit().putString(K_LOG, next.toString()).apply();
    }

    public static void clearLog(Context context) {
        prefs(context).edit().putString(K_LOG, "[]").apply();
    }

    /* ---------------- 하루 손실 상태 ---------------- */

    public static String dayKey(Context context) {
        return prefs(context).getString(K_DAY, "");
    }

    public static double dayStartEquity(Context context) {
        return prefs(context).getFloat(K_DAY_EQUITY, 0f);
    }

    public static void setDay(Context context, String dayKey, double equity) {
        prefs(context).edit().putString(K_DAY, dayKey).putFloat(K_DAY_EQUITY, (float) equity).apply();
    }

    public static boolean dailyLocked(Context context) {
        return prefs(context).getBoolean(K_DAILY_LOCKED, false);
    }

    public static void setDailyLocked(Context context, boolean locked) {
        prefs(context).edit().putBoolean(K_DAILY_LOCKED, locked).apply();
    }

    /* ---------------- 서비스 상태 ---------------- */

    public static boolean running(Context context) {
        return prefs(context).getBoolean(K_RUNNING, false);
    }

    public static void setRunning(Context context, boolean running) {
        prefs(context).edit().putBoolean(K_RUNNING, running).apply();
    }

    public static void setSnapshot(Context context, long lastTick, double equity, int positions) {
        prefs(context)
            .edit()
            .putLong(K_LAST_TICK, lastTick)
            .putFloat(K_EQUITY, (float) equity)
            .putInt(K_POSITIONS, positions)
            .apply();
    }

    public static long lastTick(Context context) {
        return prefs(context).getLong(K_LAST_TICK, 0);
    }

    public static double lastEquity(Context context) {
        return prefs(context).getFloat(K_EQUITY, 0f);
    }

    public static int lastPositions(Context context) {
        return prefs(context).getInt(K_POSITIONS, 0);
    }

    /** JS에 돌려주는 서비스 상태 */
    public static JSONObject status(Context context) {
        JSONObject out = new JSONObject();
        try {
            JSONObject config = config(context);
            out.put("running", running(context));
            out.put("service", running(context));
            out.put("mode", isDemo(context) ? "demo" : "live");
            out.put("armed", plans(context).length());
            out.put("openPositions", lastPositions(context));
            out.put("equity", lastEquity(context) > 0 ? lastEquity(context) : JSONObject.NULL);
            out.put("dailyLocked", dailyLocked(context));
            double start = dayStartEquity(context);
            double eq = lastEquity(context);
            out.put("dailyPnl", start > 0 && eq > 0 ? (eq - start) : 0);
            out.put("lastTickAt", lastTick(context));
            out.put("accountMode", accountMode(context));
            out.put("riskPct", config.optDouble("riskPct", 1.5));
            out.put("maxPositions", config.optInt("maxPositions", 2));
            out.put("log", logs(context));
        } catch (Exception ignored) {}
        return out;
    }

    private static JSONArray array(String raw) {
        if (raw == null || raw.isEmpty()) return new JSONArray();
        try {
            JSONArray arr = new JSONArray(raw);
            return arr;
        } catch (Exception e) {
            return new JSONArray();
        }
    }
}
