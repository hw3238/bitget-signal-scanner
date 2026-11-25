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
    /** 조기 손절 판단용 — 웹이 넘긴 진행 중 시그널의 최소 정보(종목·방향·시각) */
    private static final String K_EXIT_SIGNALS = "exit_signals";
    private static final String K_LOG = "log";
    private static final String K_TRADED = "traded_keys";
    private static final String K_DAY = "day_key";
    private static final String K_DAY_EQUITY = "day_start_equity";
    private static final String K_DAILY_LOCKED = "daily_locked";
    private static final String K_RUNNING = "service_running";
    private static final String K_LAST_TICK = "last_tick";
    private static final String K_EQUITY = "last_equity";
    /** 가용 잔고 · 미실현 손익 — 웹이 서비스 없이도 최신 값을 읽도록 스냅숏에 함께 저장(v1.5.4) */
    private static final String K_AVAILABLE = "last_available";
    private static final String K_UNREALIZED = "last_unrealized";
    private static final String K_POSITIONS = "last_positions";
    /** 마지막으로 판별된 비트겟 계정 종류 — "uta" / "classic" / "" (아직 모름) */
    private static final String K_ACCOUNT_MODE = "account_mode";
    /** 오늘 거래소가 거부한 종목(상장폐지·Demo 미지원·거래 제한) — 같은 실패를 반복하지 않는다(v1.5.5) */
    private static final String K_SKIP = "skip_symbols";
    /** 진입 성공 시 저장하는 포지션 목표/손절 — 감시 목록이 아닌 포지션도 반익절 판단에 쓴다(v1.5.6) */
    private static final String K_TARGETS = "position_targets";
    /** 50% 반익절을 마친 포지션 키(`SYMBOL|side`) — 중복 실행 방지(v1.5.6) */
    private static final String K_PARTIAL = "partial_tp_done";

    private static final int LOG_LIMIT = 40;
    private static final int TRADED_LIMIT = 200;
    private static final int TARGET_LIMIT = 40;
    private static final int PARTIAL_LIMIT = 60;

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
            .remove(K_TARGETS)
            .remove(K_PARTIAL)
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
            fallback.put("earlyStop", true);
            fallback.put("partialTp", true);
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

    /** 진행 중 시그널(조기 손절 판단용) — 최대 40건만 보관한다. */
    public static JSONArray exitSignals(Context context) {
        return array(prefs(context).getString(K_EXIT_SIGNALS, ""));
    }

    public static void saveExitSignals(Context context, JSONArray signals) {
        JSONArray next = new JSONArray();
        if (signals != null) {
            for (int i = 0; i < signals.length() && next.length() < 40; i++) next.put(signals.opt(i));
        }
        prefs(context).edit().putString(K_EXIT_SIGNALS, next.toString()).apply();
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
        // v1.5.3 이전에는 float 로 저장해 USDT 잔고가 0.001 단위로 망가졌다 — 문자열(double) 로 읽고 backward 호환.
        // ⚠ 저장 타입이 섞여 있을 수 있어 getString/getFloat 직접 호출 대신 getAll() 로 타입을 확인한다(ClassCastException 방지).
        return readDouble(context, K_DAY_EQUITY);
    }

    /**
     * 저장 타입이 String/Number 어느 쪽이어도 double 로 읽는다.
     * (SharedPreferences 에 float/int 로 쓰인 옛 스냅숏과 문자열로 쓴 새 값이 섞여도 죽지 않게)
     */
    private static double readDouble(Context context, String key) {
        try {
            Object value = prefs(context).getAll().get(key);
            if (value instanceof String) {
                String raw = ((String) value).trim();
                if (!raw.isEmpty()) return Double.parseDouble(raw);
            } else if (value instanceof Number) {
                return ((Number) value).doubleValue();
            }
        } catch (Exception ignored) {
            /* 읽지 못하면 0 — 다음 주기에 다시 잡힌다 */
        }
        return 0;
    }

    /** 오늘 손실 한도 초기화 — 지금 잔고를 오늘의 기준선으로 다시 잡고 잠금을 푼다(v1.5.4). */
    public static void resetDaily(Context context, double equity) {
        prefs(context)
            .edit()
            .putString(K_DAY, todayKst())
            .putString(K_DAY_EQUITY, String.format(Locale.US, "%.4f", equity))
            .putBoolean(K_DAILY_LOCKED, false)
            .apply();
    }

    /**
     * 기준선 비우기 — 계좌(키)가 바뀌었거나 키를 지웠을 때.
     * 옛 계좌의 기준선이 남아 있으면 새 계좌의 작은 잔고가 −90% 손실로 보여 첫 진입과 동시에 잠긴다(v1.5.4).
     * 다음 계좌 조회 때 그 계좌의 잔고로 다시 잡힌다.
     */
    public static void clearDayBaseline(Context context) {
        prefs(context)
            .edit()
            .putString(K_DAY, "")
            .putString(K_DAY_EQUITY, "0.0000")
            .putBoolean(K_DAILY_LOCKED, false)
            .apply();
    }

    public static void setDay(Context context, String dayKey, double equity) {
        prefs(context)
            .edit()
            .putString(K_DAY, dayKey)
            .putString(K_DAY_EQUITY, String.format(Locale.US, "%.4f", equity))
            .apply();
    }

    public static boolean dailyLocked(Context context) {
        return prefs(context).getBoolean(K_DAILY_LOCKED, false);
    }

    public static void setDailyLocked(Context context, boolean locked) {
        prefs(context).edit().putBoolean(K_DAILY_LOCKED, locked).apply();
    }

    /* ---------------- 포지션 목표 · 50% 반익절 (v1.5.6) ---------------- */

    /**
     * 진입 성공 시 그 포지션의 목표가·손절가를 저장한다.
     *  · 감시 목록(plans)은 체결되면 사라지므로, 체결 뒤의 반익절 판단은 이 기록을 참고한다.
     *  · 거래소 포지션에 TP/SL 이 남아 있으면 그 값을 우선 쓰고, 비어 있을 때 이 기록을 쓴다.
     */
    public static void savePositionTarget(Context context, String posKey, double entry, double target, double stop) {
        if (posKey == null || posKey.isEmpty()) return;
        try {
            JSONObject box = new JSONObject(prefs(context).getString(K_TARGETS, "{}"));
            JSONObject row = new JSONObject();
            row.put("entry", entry);
            row.put("target", target);
            row.put("stop", stop);
            row.put("at", System.currentTimeMillis());
            box.put(posKey, row);
            // 오래된 기록부터 버려 40개만 유지한다(청산된 포지션 기록이 쌓이지 않게).
            while (box.length() > TARGET_LIMIT) {
                String oldest = null;
                long oldestAt = Long.MAX_VALUE;
                java.util.Iterator<String> it = box.keys();
                while (it.hasNext()) {
                    String key = it.next();
                    long at = box.optJSONObject(key) == null ? 0 : box.optJSONObject(key).optLong("at", 0);
                    if (at < oldestAt) {
                        oldestAt = at;
                        oldest = key;
                    }
                }
                if (oldest == null) break;
                box.remove(oldest);
            }
            prefs(context).edit().putString(K_TARGETS, box.toString()).apply();
        } catch (Exception ignored) {
            /* 저장 실패 — 거래소 포지션의 TP/SL 값으로만 판단한다 */
        }
    }

    /** 저장된 포지션 목표(없으면 null) */
    public static JSONObject positionTarget(Context context, String posKey) {
        if (posKey == null || posKey.isEmpty()) return null;
        try {
            JSONObject box = new JSONObject(prefs(context).getString(K_TARGETS, "{}"));
            return box.optJSONObject(posKey);
        } catch (Exception ignored) {
            return null;
        }
    }

    /** 50% 반익절을 마친 포지션 키 — 중복 실행 방지 */
    public static JSONArray partialTpDone(Context context) {
        return array(prefs(context).getString(K_PARTIAL, ""));
    }

    public static boolean isPartialTpDone(Context context, String posKey) {
        if (posKey == null || posKey.isEmpty()) return false;
        JSONArray arr = partialTpDone(context);
        for (int i = 0; i < arr.length(); i++) {
            if (posKey.equals(arr.optString(i))) return true;
        }
        return false;
    }

    public static void markPartialTpDone(Context context, String posKey) {
        if (posKey == null || posKey.isEmpty() || isPartialTpDone(context, posKey)) return;
        JSONArray arr = partialTpDone(context);
        JSONArray next = new JSONArray();
        next.put(posKey);
        for (int i = 0; i < arr.length() && next.length() < PARTIAL_LIMIT; i++) next.put(arr.opt(i));
        prefs(context).edit().putString(K_PARTIAL, next.toString()).apply();
    }

    /**
     * 지금 살아 있는 포지션 키만 남긴다 — 청산된 포지션의 목표 기록·반익절 완료 표시를 정리한다.
     *  · 같은 종목에 다시 진입하면 새 포지션이므로 반익절을 처음부터 다시 할 수 있어야 한다.
     */
    public static void retainPositions(Context context, java.util.Set<String> alive) {
        try {
            JSONObject box = new JSONObject(prefs(context).getString(K_TARGETS, "{}"));
            JSONObject nextBox = new JSONObject();
            java.util.Iterator<String> it = box.keys();
            boolean changed = false;
            while (it.hasNext()) {
                String key = it.next();
                if (alive != null && alive.contains(key)) {
                    nextBox.put(key, box.opt(key));
                } else {
                    changed = true;
                }
            }
            JSONArray arr = partialTpDone(context);
            JSONArray nextArr = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                String key = arr.optString(i);
                if (alive != null && alive.contains(key)) nextArr.put(key);
                else changed = true;
            }
            if (!changed) return;
            prefs(context)
                .edit()
                .putString(K_TARGETS, nextBox.toString())
                .putString(K_PARTIAL, nextArr.toString())
                .apply();
        } catch (Exception ignored) {
            /* 정리는 다음 주기에 다시 시도한다 */
        }
    }

    /* ---------------- 서비스 상태 ---------------- */

    public static boolean running(Context context) {
        return prefs(context).getBoolean(K_RUNNING, false);
    }

    public static void setRunning(Context context, boolean running) {
        prefs(context).edit().putBoolean(K_RUNNING, running).apply();
    }

    public static void setSnapshot(Context context, long lastTick, double equity, int positions) {
        setSnapshot(context, lastTick, equity, lastAvailable(context), lastUnrealized(context), positions);
    }

    /** 잔고 스냅숏 — equity/가용/미실현을 문자열로 저장해 소수 정밀도를 유지한다(v1.5.4). */
    public static void setSnapshot(
            Context context, long lastTick, double equity, double available, double unrealizedPL, int positions) {
        prefs(context)
            .edit()
            .putLong(K_LAST_TICK, lastTick)
            .putString(K_EQUITY, String.format(Locale.US, "%.4f", equity))
            .putString(K_AVAILABLE, String.format(Locale.US, "%.4f", available))
            .putString(K_UNREALIZED, String.format(Locale.US, "%.4f", unrealizedPL))
            .putInt(K_POSITIONS, positions)
            .apply();
    }

    public static long lastTick(Context context) {
        return prefs(context).getLong(K_LAST_TICK, 0);
    }

    public static double lastEquity(Context context) {
        return readDouble(context, K_EQUITY);
    }

    public static double lastAvailable(Context context) {
        return readDouble(context, K_AVAILABLE);
    }

    public static double lastUnrealized(Context context) {
        return readDouble(context, K_UNREALIZED);
    }

    /**
     * 오늘 제외할 종목 — 거래소가 `25100/25105/45119` 처럼 종목 자체를 거부했을 때 넣는다.
     * 날짜(KST)가 바뀌면 자동으로 비워, 다음 날 새로 판단한다.
     */
    public static boolean isSkippedSymbol(Context context, String symbol) {
        if (symbol == null || symbol.isEmpty()) return false;
        try {
            JSONObject box = new JSONObject(prefs(context).getString(K_SKIP, "{}"));
            if (!todayKst().equals(box.optString("day", ""))) return false;
            JSONArray arr = box.optJSONArray("symbols");
            if (arr == null) return false;
            String upper = symbol.toUpperCase(Locale.ROOT);
            for (int i = 0; i < arr.length(); i++) {
                if (upper.equals(arr.optString(i, "").toUpperCase(Locale.ROOT))) return true;
            }
        } catch (Exception ignored) {
            /* 읽을 수 없으면 제외하지 않는다 */
        }
        return false;
    }

    public static void skipSymbol(Context context, String symbol) {
        if (symbol == null || symbol.isEmpty()) return;
        try {
            String day = todayKst();
            JSONObject box = new JSONObject(prefs(context).getString(K_SKIP, "{}"));
            JSONArray arr = day.equals(box.optString("day", "")) ? box.optJSONArray("symbols") : null;
            if (arr == null) arr = new JSONArray();
            String upper = symbol.toUpperCase(Locale.ROOT);
            for (int i = 0; i < arr.length(); i++) {
                if (upper.equals(arr.optString(i, "").toUpperCase(Locale.ROOT))) {
                    prefs(context).edit().putString(K_SKIP, box.toString()).apply();
                    return;
                }
            }
            arr.put(upper);
            JSONObject next = new JSONObject();
            next.put("day", day);
            next.put("symbols", arr);
            prefs(context).edit().putString(K_SKIP, next.toString()).apply();
        } catch (Exception ignored) {
            /* 저장 실패 — 다음 주기에 다시 시도한다 */
        }
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
            // 네이티브 설정의 enabled — 1일 손실 한도로 서비스가 스스로 끈 경우 웹도 같이 꺼진다.
            out.put("enabled", config.optBoolean("enabled", false));
            out.put("mode", isDemo(context) ? "demo" : "live");
            out.put("armed", plans(context).length());
            out.put("openPositions", lastPositions(context));
            out.put("equity", lastEquity(context) > 0 ? lastEquity(context) : JSONObject.NULL);
            out.put("available", lastAvailable(context) > 0 ? lastAvailable(context) : JSONObject.NULL);
            out.put("unrealizedPL", lastUnrealized(context));
            out.put("dailyLocked", dailyLocked(context));
            double start = dayStartEquity(context);
            double eq = lastEquity(context);
            out.put("dailyPnl", start > 0 && eq > 0 ? (eq - start) : 0);
            out.put("dayStartEquity", start > 0 ? start : JSONObject.NULL);
            out.put("dayKey", dayKey(context));
            out.put("lastTickAt", lastTick(context));
            out.put("accountMode", accountMode(context));
            out.put("riskPct", config.optDouble("riskPct", 1.5));
            out.put("maxPositions", config.optInt("maxPositions", 2));
            out.put("partialTp", config.optBoolean("partialTp", true));
            out.put("partialTpDone", partialTpDone(context));
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
