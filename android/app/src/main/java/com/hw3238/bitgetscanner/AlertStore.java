package com.hw3238.bitgetscanner;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 🔔 백그라운드 알림 저장소 (v1.5.8).
 *
 *  · 웹(AppShell.alertsSync)이 넘긴 **맞춤 알림 조건 · 알림 설정 · 경제지표 일정**을 그대로 보관한다.
 *  · 앱이 꺼져 있어도 AlertMonitorService 가 이 저장소만 읽어 감시를 이어간다.
 *  · 발송 이력(중복 방지 키)도 여기에 남겨 재부팅·서비스 재시작 뒤 같은 알림을 다시 보내지 않는다.
 *
 *  저장 구조
 *   settings : {"master":true,"signal":true,"custom":true,"macro":true,"news":false,
 *               "target":"majors","macroLeadMin":30,"refreshSec":90,"vibrate":true}
 *   alerts   : [{"id":"BTCUSDT|price_above|95000","symbol":"BTCUSDT","kind":"price_above","value":95000,"oneShot":true}]
 *   macro    : [{"id":"nfp-2026-11","at":1796400000000,"stars":3,"title":"📊 …","body":"…"}]
 */
public final class AlertStore {

    private static final String PREF = "cota_alerts";
    private static final String K_SETTINGS = "settings";
    private static final String K_ALERTS = "alerts";
    private static final String K_MACRO = "macro";
    private static final String K_FIRED = "fired";
    private static final String K_NEWS_SEEN = "newsSeen";
    private static final String K_RUNNING = "running";
    private static final String K_LAST_CHECK = "lastCheckAt";
    private static final String K_CHECKED = "checked";
    private static final String K_SENT = "sent";
    private static final String K_ERROR = "error";
    private static final String K_LAST_MACRO_AT = "lastMacroAt";
    private static final String K_LAST_NEWS_AT = "lastNewsAt";

    /** 발송 이력 보관 개수 — 오래된 키부터 버린다 */
    private static final int FIRED_MAX = 400;

    private AlertStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    public static JSONObject settings(Context context) {
        String raw = prefs(context).getString(K_SETTINGS, "");
        if (raw != null && !raw.isEmpty()) {
            try {
                return new JSONObject(raw);
            } catch (Exception ignored) {
                /* 깨진 값은 기본값으로 */
            }
        }
        return defaultSettings();
    }

    public static JSONObject defaultSettings() {
        JSONObject o = new JSONObject();
        try {
            o.put("master", true);
            o.put("signal", true);
            o.put("custom", true);
            o.put("macro", true);
            o.put("news", false);
            o.put("target", "majors");
            o.put("macroLeadMin", 30);
            o.put("refreshSec", 90);
            o.put("vibrate", true);
        } catch (Exception ignored) {
        }
        return o;
    }

    public static void saveSettings(Context context, JSONObject settings) {
        prefs(context).edit().putString(K_SETTINGS, settings == null ? "{}" : settings.toString()).apply();
    }

    public static JSONArray alerts(Context context) {
        return array(context, K_ALERTS);
    }

    public static void saveAlerts(Context context, JSONArray alerts) {
        prefs(context).edit().putString(K_ALERTS, alerts == null ? "[]" : alerts.toString()).apply();
    }

    public static JSONArray macroEvents(Context context) {
        return array(context, K_MACRO);
    }

    public static void saveMacroEvents(Context context, JSONArray events) {
        prefs(context).edit().putString(K_MACRO, events == null ? "[]" : events.toString()).apply();
    }

    private static JSONArray array(Context context, String key) {
        String raw = prefs(context).getString(key, "");
        if (raw == null || raw.isEmpty()) return new JSONArray();
        try {
            return new JSONArray(raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    /* ---------------- 중복 방지 키 ---------------- */

    public static boolean isFired(Context context, String key) {
        JSONArray rows = array(context, K_FIRED);
        for (int i = 0; i < rows.length(); i++) {
            if (key.equals(rows.optString(i))) return true;
        }
        return false;
    }

    public static void markFired(Context context, String key) {
        JSONArray rows = array(context, K_FIRED);
        for (int i = 0; i < rows.length(); i++) {
            if (key.equals(rows.optString(i))) return;
        }
        rows.put(key);
        JSONArray trimmed = new JSONArray();
        int from = Math.max(0, rows.length() - FIRED_MAX);
        for (int i = from; i < rows.length(); i++) trimmed.put(rows.optString(i));
        prefs(context).edit().putString(K_FIRED, trimmed.toString()).apply();
    }

    public static boolean isNewsSeen(Context context, String id) {
        JSONArray rows = array(context, K_NEWS_SEEN);
        for (int i = 0; i < rows.length(); i++) {
            if (id.equals(rows.optString(i))) return true;
        }
        return false;
    }

    public static void markNewsSeen(Context context, String id) {
        JSONArray rows = array(context, K_NEWS_SEEN);
        rows.put(id);
        JSONArray trimmed = new JSONArray();
        int from = Math.max(0, rows.length() - 200);
        for (int i = from; i < rows.length(); i++) trimmed.put(rows.optString(i));
        prefs(context).edit().putString(K_NEWS_SEEN, trimmed.toString()).apply();
    }

    /* ---------------- 상태 ---------------- */

    public static boolean running(Context context) {
        return prefs(context).getBoolean(K_RUNNING, false);
    }

    public static void setRunning(Context context, boolean running) {
        prefs(context).edit().putBoolean(K_RUNNING, running).apply();
    }

    /** 감시가 하나라도 켜져 있는가 — 서비스 시작/중지 판단 */
    public static boolean enabled(Context context) {
        JSONObject s = settings(context);
        if (!s.optBoolean("master", true)) return false;
        return s.optBoolean("signal", true)
                || s.optBoolean("custom", true)
                || s.optBoolean("macro", true)
                || s.optBoolean("news", false);
    }

    public static long lastMacroAt(Context context) {
        return prefs(context).getLong(K_LAST_MACRO_AT, 0);
    }

    public static void setLastMacroAt(Context context, long at) {
        prefs(context).edit().putLong(K_LAST_MACRO_AT, at).apply();
    }

    public static long lastNewsAt(Context context) {
        return prefs(context).getLong(K_LAST_NEWS_AT, 0);
    }

    public static void setLastNewsAt(Context context, long at) {
        prefs(context).edit().putLong(K_LAST_NEWS_AT, at).apply();
    }

    public static void updateStatus(Context context, int checked, boolean sentOne, String error) {
        SharedPreferences.Editor editor = prefs(context).edit();
        editor.putLong(K_LAST_CHECK, System.currentTimeMillis());
        editor.putInt(K_CHECKED, checked);
        if (sentOne) editor.putInt(K_SENT, prefs(context).getInt(K_SENT, 0) + 1);
        if (error != null) editor.putString(K_ERROR, error.length() > 200 ? error.substring(0, 200) : error);
        editor.apply();
    }

    public static JSONObject status(Context context) {
        JSONObject o = new JSONObject();
        try {
            o.put("running", running(context));
            o.put("lastCheckAt", prefs(context).getLong(K_LAST_CHECK, 0));
            o.put("checked", prefs(context).getInt(K_CHECKED, 0));
            o.put("sent", prefs(context).getInt(K_SENT, 0));
            String error = prefs(context).getString(K_ERROR, "");
            if (error != null && !error.isEmpty()) o.put("error", error);
            o.put("enabled", enabled(context));
        } catch (Exception ignored) {
        }
        return o;
    }
}
