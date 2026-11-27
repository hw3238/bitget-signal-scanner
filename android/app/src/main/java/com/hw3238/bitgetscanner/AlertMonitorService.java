package com.hw3238.bitgetscanner;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 🔔 COTA 백그라운드 알림 감시 서비스 (v1.5.8 · 포그라운드).
 *
 *  · WebView(앱 화면)가 꺼져도 살아 있으면서 60~120초마다 4종 알림을 확인한다.
 *  · **자동매매(AutoTradeService)와 완전히 별개** — 주문을 내지 않고 알림만 보낸다.
 *
 *  ① 전략 시그널(signalEnabled)   : 경량 추세 돌파 엔진(LightSignal) · 범위 top3/majors/all
 *  ② 지정가·지표(customAlertsEnabled): 가격 이상/이하 · 1H RSI 과매수/과매도 · 펀딩비 과열
 *  ③ 경제지표(macroEnabled)        : 웹이 넘긴 일정의 발표 30분 전 예상치·롱숏 가이드
 *  ④ 코인 뉴스(newsEnabled)        : 블록미디어·Cointelegraph RSS(rss2json) 3분 주기 · 호재/악재만
 *
 *  · 알림은 채널 4종(cota_signal/cota_price_alert/cota_macro/cota_news)으로 나뉘고,
 *    같은 조건·같은 봉·같은 기사는 AlertStore 의 발송 이력으로 두 번 울리지 않는다.
 *  · 재부팅·앱 종료 뒤에도 START_STICKY + AlertBootReceiver 로 다시 살아난다.
 */
public class AlertMonitorService extends Service {

    public static final String ACTION_START = "com.hw3238.bitgetscanner.ALERT_START";
    public static final String ACTION_SYNC = "com.hw3238.bitgetscanner.ALERT_SYNC";
    public static final String ACTION_STOP = "com.hw3238.bitgetscanner.ALERT_STOP";

    private static final String CH_SERVICE = "cota_alert_service";
    private static final int SERVICE_NOTIF_ID = 4418;
    private static final int MIN_INTERVAL_SEC = 60;
    private static final int MAX_INTERVAL_SEC = 120;
    private static final long NEWS_INTERVAL_MS = 180_000L;
    private static final long SIGNAL_INTERVAL_MS = 90_000L;
    private static final int MAX_SIGNAL_ALERTS_PER_TICK = 3;

    private static final String[] TOP3 = { "BTCUSDT", "ETHUSDT", "SOLUSDT" };
    private static final String[] MAJORS = {
            "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT",
            "TONUSDT", "TRXUSDT", "DOTUSDT", "SUIUSDT", "APTUSDT", "NEARUSDT", "LTCUSDT", "BCHUSDT", "UNIUSDT",
            "ARBUSDT", "OPUSDT"
    };

    /** 뉴스 태깅 사전 — 웹(cryptoNews.ts)의 부분집합. 알림은 '호재/악재'가 분명한 기사만 보낸다. */
    private static final String[] GOOD_WORDS = {
            "ETF", "승인", "상장", "유입", "순매수", "랠리", "급등", "신고가", "반등", "호재", "파트너십", "투자 유치",
            "바이백", "소각", "스테이킹", "출시", "approv", "inflow", "rally", "surge", "record high", "all-time high",
            "listing", "partnership", "adoption", "bullish", "buyback", "launch"
    };
    private static final String[] BAD_WORDS = {
            "해킹", "탈취", "청산", "급락", "폭락", "순매도", "소송", "제소", "기소", "벌금", "과징금", "규제", "제재",
            "금지", "파산", "유출", "디페깅", "사기", "스캔들", "경고", "압류", "몰수", "단속", "조사", "위반",
            "hack", "exploit", "breach", "liquidat", "selloff", "sell-off", "plunge", "crash", "lawsuit", "probe",
            "investigat", "fine", "penalt", "bankrupt", "outflow", "delist", "bearish", "downgrade", "fraud", "scandal"
    };

    private HandlerThread workerThread;
    private Handler worker;
    private PowerManager.WakeLock wakeLock;
    private volatile boolean running;
    private long lastSignalAt;
    private long lastNewsAt;
    /** 티커 캐시 — 한 주기에 한 번만 받는다 */
    private final Map<String, Double> priceCache = new HashMap<>();
    private final Map<String, Double> volumeCache = new HashMap<>();
    private final Map<String, Double> fundingCache = new HashMap<>();
    private int sentThisTick;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            int interval = MAX_INTERVAL_SEC;
            try {
                JSONObject settings = AlertStore.settings(AlertMonitorService.this);
                interval = clamp(settings.optInt("refreshSec", 90), MIN_INTERVAL_SEC, MAX_INTERVAL_SEC);
                if (!AlertStore.enabled(AlertMonitorService.this)) {
                    stopSelf();
                    return;
                }
                sentThisTick = 0;
                int checked = checkOnce(settings);
                AlertStore.updateStatus(AlertMonitorService.this, checked, sentThisTick > 0, null);
                updateServiceNotification(checked);
            } catch (Exception e) {
                AlertStore.updateStatus(AlertMonitorService.this, 0, sentThisTick > 0, "감시 오류 — " + message(e));
            } finally {
                if (running) worker.postDelayed(this, interval * 1000L);
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        AlertStore.setRunning(this, true);
        createServiceChannel();
        workerThread = new HandlerThread("cota-alert-monitor");
        workerThread.start();
        worker = new Handler(workerThread.getLooper());
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "COTA:alerts");
            wakeLock.setReferenceCounted(false);
        }
        AlertNotifications.ensureChannels(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundCompat(buildServiceNotification("백그라운드 알림 감시를 준비하고 있습니다."));
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!AlertStore.enabled(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_SYNC.equals(action)) {
            // 설정·조건만 갱신 — 주기를 다시 시작하지 않아 거래소 호출을 늘리지 않는다.
            updateServiceNotification(0);
            return START_STICKY;
        }
        worker.removeCallbacks(tick);
        worker.post(tick);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        AlertStore.setRunning(this, false);
        if (worker != null) worker.removeCallbacks(tick);
        if (workerThread != null) workerThread.quitSafely();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /* ------------------------------------------------------------------ *
     * 한 주기 점검
     * ------------------------------------------------------------------ */

    private int checkOnce(JSONObject settings) {
        int checked = 0;
        if (!settings.optBoolean("master", true)) return 0;
        priceCache.clear();
        fundingCache.clear();

        if (settings.optBoolean("macro", true)) checked += checkMacro(settings);
        if (settings.optBoolean("custom", true)) checked += checkCustomAlerts(settings);
        if (settings.optBoolean("signal", true)) checked += checkSignals(settings);
        if (settings.optBoolean("news", false) && System.currentTimeMillis() - Math.max(lastNewsAt, AlertStore.lastNewsAt(this)) >= NEWS_INTERVAL_MS) {
            checked += checkNews();
            lastNewsAt = System.currentTimeMillis();
            AlertStore.setLastNewsAt(this, lastNewsAt);
        }
        return checked;
    }

    /** ③ 경제지표 — 발표 leadMin 분 전 ~ +5분 사이에 한 번 */
    private int checkMacro(JSONObject settings) {
        int leadMin = clamp(settings.optInt("macroLeadMin", 30), 1, 240);
        JSONArray events = AlertStore.macroEvents(this);
        long now = System.currentTimeMillis();
        int checked = 0;
        for (int i = 0; i < events.length(); i++) {
            JSONObject e = events.optJSONObject(i);
            if (e == null) continue;
            long at = e.optLong("at", 0);
            if (at <= 0) continue;
            if (now < at - leadMin * 60_000L || now > at + 5 * 60_000L) continue;
            checked++;
            String id = e.optString("id", "");
            String key = "macro:" + id;
            if (AlertStore.isFired(this, key)) continue;
            String title = e.optString("title", "📊 경제지표 발표");
            String body = e.optString("body", "");
            AlertNotifications.post(this, AlertNotifications.CH_MACRO, title, body, AlertNotifications.idFor(key));
            AlertStore.markFired(this, key);
            sentThisTick++;
        }
        return checked;
    }

    /** ② 지정가 · RSI · 펀딩 */
    private int checkCustomAlerts(JSONObject settings) {
        JSONArray alerts = AlertStore.alerts(this);
        if (alerts.length() == 0) return 0;
        ensureTickers();
        int checked = 0;
        boolean changed = false;
        JSONArray remain = new JSONArray();
        for (int i = 0; i < alerts.length(); i++) {
            JSONObject alert = alerts.optJSONObject(i);
            if (alert == null) continue;
            String symbol = alert.optString("symbol", "");
            String kind = alert.optString("kind", "");
            double value = alert.optDouble("value", 0);
            if (symbol.isEmpty() || value == 0) continue;
            checked++;
            Double actual = actualValue(symbol, kind);
            if (actual == null) {
                remain.put(alert);
                continue;
            }
            if (!hit(kind, value, actual)) {
                remain.put(alert);
                continue;
            }
            String id = alert.optString("id", symbol + "|" + kind + "|" + value);
            // nonce(등록 시각) — 사용자가 '다시 감시'를 누르면 값이 바뀌어 같은 조건도 다시 울린다
            String key = "alert:" + id + ":" + alert.optLong("nonce", 0);
            if (!AlertStore.isFired(this, key)) {
                String[] msg = messageFor(symbol, kind, value, actual);
                AlertNotifications.post(this, AlertNotifications.CH_PRICE, msg[0], msg[1], AlertNotifications.idFor(key));
                AlertStore.markFired(this, key);
                sentThisTick++;
            }
            // 1회성은 발동 후 목록에서 뺀다 — 반복형(oneShot=false)은 남겨 다음 도달을 다시 알린다.
            if (alert.optBoolean("oneShot", true)) {
                // remain 에 넣지 않는다 — 발동 완료
                changed = true;
            } else {
                remain.put(alert);
            }
        }
        if (changed) AlertStore.saveAlerts(this, remain);
        return checked;
    }

    private Double actualValue(String symbol, String kind) {
        if ("rsi_over".equals(kind) || "rsi_under".equals(kind)) {
            List<LightSignal.Candle> candles = candles(symbol, "1H", 80);
            if (candles.size() < 20) return null;
            double[] closes = new double[candles.size()];
            for (int i = 0; i < closes.length; i++) closes[i] = candles.get(i).c;
            double[] series = LightSignal.rsi(closes, 14);
            double v = series[series.length - 2];
            return Double.isNaN(v) ? null : v;
        }
        if ("funding_hot".equals(kind)) {
            Double rate = funding(symbol);
            return rate;
        }
        Double price = priceCache.get(symbol);
        return price != null && price > 0 ? price : null;
    }

    private static boolean hit(String kind, double value, double actual) {
        switch (kind) {
            case "price_above":
                return actual >= value;
            case "price_below":
                return actual <= value;
            case "rsi_over":
                return actual >= value;
            case "rsi_under":
                return actual <= value;
            case "funding_hot":
                return actual >= value;
            default:
                return false;
        }
    }

    private static String[] messageFor(String symbol, String kind, double value, double actual) {
        String base = symbol.replace("USDT", "");
        switch (kind) {
            case "price_above":
                return new String[] { "🎯 " + base + " " + usd(value) + " 도달", "현재가 " + usd(actual) + " — 지정가 알림이 발동했습니다 · COTA" };
            case "price_below":
                return new String[] { "🎯 " + base + " " + usd(value) + " 이탈", "현재가 " + usd(actual) + " — 지정가 알림이 발동했습니다 · COTA" };
            case "rsi_over":
                return new String[] { "📈 " + base + " 1H RSI " + num(actual, 1) + " 과매수", "기준 " + num(value, 0) + " 이상 — 단기 과열 구간입니다 · COTA" };
            case "rsi_under":
                return new String[] { "📉 " + base + " 1H RSI " + num(actual, 1) + " 과매도", "기준 " + num(value, 0) + " 이하 — 단기 침체 구간입니다 · COTA" };
            case "funding_hot":
                return new String[] { "🔥 " + base + " 펀딩비 " + num(actual, 3) + "% 과열", "기준 " + num(value, 3) + "% 이상 — 롱 쏠림, 숏 청산 위험 구간 · COTA" };
            default:
                return new String[] { "🎯 " + base + " 알림", "조건이 발동했습니다" };
        }
    }

    /** ① 전략 시그널 — 90초 이상 간격으로 전 종목을 훑는다 */
    private int checkSignals(JSONObject settings) {
        long now = System.currentTimeMillis();
        if (now - lastSignalAt < SIGNAL_INTERVAL_MS) return 0;
        lastSignalAt = now;
        ensureTickers();
        List<String> universe = universe(settings.optString("target", "majors"));
        int checked = 0;
        int alerted = 0;
        for (String symbol : universe) {
            if (!running || alerted >= MAX_SIGNAL_ALERTS_PER_TICK) break;
            List<LightSignal.Candle> candles = candles(symbol, "1H", 120);
            if (candles.size() < LightSignal.MIN_CANDLES) continue;
            checked++;
            LightSignal.Signal signal = LightSignal.evaluate(candles);
            if (signal == null) continue;
            String key = LightSignal.signalKey(symbol, "1H", signal);
            if (AlertStore.isFired(this, key)) continue;
            String base = symbol.replace("USDT", "");
            String side = "long".equals(signal.side) ? "롱" : "숏";
            String title = base + " 1H " + side + " 시그널 · 추세 돌파";
            String body = String.format(Locale.US,
                    "진입 %s · 손절 %s · 목표 %s · %s · COTA 백그라운드 감지",
                    usd(signal.entry), usd(signal.stop), usd(signal.target), signal.reason);
            AlertNotifications.post(this, AlertNotifications.CH_SIGNAL, title, body, AlertNotifications.idFor(key));
            AlertStore.markFired(this, key);
            alerted++;
            sentThisTick++;
        }
        return checked;
    }

    /** ④ 코인 뉴스 — 호재·악재가 분명한 새 기사만. 첫 확인은 기준선(폭탄 알림 방지). */
    private int checkNews() {
        String[] feeds = {
                "https://www.blockmedia.co.kr/feed",
                "https://cointelegraph.com/rss"
        };
        int checked = 0;
        boolean firstRun = !AlertStore.isFired(this, "news:baseline");
        int sent = 0;
        for (String feed : feeds) {
            try {
                String url = "https://api.rss2json.com/v1/api.json?rss_url=" + URLEncoder.encode(feed, "UTF-8") + "&count=15";
                JSONObject body = getObject(url);
                if (body == null || !"ok".equals(body.optString("status", "ok"))) continue;
                JSONArray items = body.optJSONArray("items");
                if (items == null) continue;
                String source = feed.contains("blockmedia") ? "블록미디어" : "Cointelegraph";
                for (int i = 0; i < items.length(); i++) {
                    JSONObject item = items.optJSONObject(i);
                    if (item == null) continue;
                    String title = strip(item.optString("title", ""));
                    String link = item.optString("link", "");
                    if (title.isEmpty() || link.isEmpty()) continue;
                    checked++;
                    String id = item.optString("guid", link);
                    if (AlertStore.isNewsSeen(this, id)) continue;
                    AlertStore.markNewsSeen(this, id);
                    if (firstRun) continue; // 기준선만 기록
                    String text = title + " " + strip(item.optString("description", ""));
                    int good = countWords(text, GOOD_WORDS);
                    int bad = countWords(text, BAD_WORDS);
                    if (good == bad) continue;
                    if (sent >= 2) continue;
                    String tone = good > bad ? "🟢 호재" : "🔴 악재";
                    String bodyText = title.length() > 150 ? title.substring(0, 149) + "…" : title;
                    AlertNotifications.post(this, AlertNotifications.CH_NEWS, "📰 " + tone + " · " + source, bodyText, AlertNotifications.idFor("news:" + id));
                    sent++;
                    sentThisTick++;
                }
            } catch (Exception ignored) {
                /* 한 피드가 실패해도 나머지는 계속 */
            }
        }
        AlertStore.markFired(this, "news:baseline");
        return checked;
    }

    /* ------------------------------------------------------------------ *
     * 거래소 공개 API
     * ------------------------------------------------------------------ */

    private void ensureTickers() {
        if (!priceCache.isEmpty()) return;
        try {
            JSONArray rows = getArray("https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES");
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null) continue;
                String symbol = row.optString("symbol", "");
                double last = numOr(row.optString("lastPr", "0"));
                if (!symbol.isEmpty() && last > 0) priceCache.put(symbol, last);
                double vol = numOr(row.optString("quoteVolume", row.optString("usdtVolume", "0")));
                if (vol > 0) volumeCache.put(symbol, vol);
                double funding = numOr(row.optString("fundingRate", "NaN"));
                if (!Double.isNaN(funding)) fundingCache.put(symbol, funding * 100.0);
            }
        } catch (Exception ignored) {
            /* 다음 주기 재시도 */
        }
    }

    private Double funding(String symbol) {
        if (fundingCache.containsKey(symbol)) return fundingCache.get(symbol);
        try {
            JSONArray rows = getArray("https://api.bitget.com/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES");
            for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row == null) continue;
                double rate = numOr(row.optString("fundingRate", "NaN"));
                if (!Double.isNaN(rate)) fundingCache.put(row.optString("symbol", ""), rate * 100.0);
            }
        } catch (Exception ignored) {
        }
        return fundingCache.get(symbol);
    }

    private List<LightSignal.Candle> candles(String symbol, String granularity, int limit) {
        List<LightSignal.Candle> out = new ArrayList<>();
        try {
            String url = "https://api.bitget.com/api/v2/mix/market/candles?symbol=" + URLEncoder.encode(symbol, "UTF-8")
                    + "&productType=USDT-FUTURES&granularity=" + granularity + "&limit=" + limit;
            JSONArray rows = getArray(url);
            for (int i = 0; i < rows.length(); i++) {
                JSONArray row = rows.optJSONArray(i);
                if (row == null || row.length() < 6) continue;
                out.add(new LightSignal.Candle(
                        row.optLong(0),
                        numOr(row.optString(1)),
                        numOr(row.optString(2)),
                        numOr(row.optString(3)),
                        numOr(row.optString(4)),
                        numOr(row.optString(5))));
            }
        } catch (Exception ignored) {
        }
        // 비트겟은 최신순으로 줄 수 있다 — 오래된 순으로 정렬(중복 시각은 하나만)
        out.sort((a, b) -> Long.compare(a.t, b.t));
        if (out.size() > 1) {
            List<LightSignal.Candle> unique = new ArrayList<>();
            long last = Long.MIN_VALUE;
            for (LightSignal.Candle c : out) {
                if (c.t == last) continue;
                unique.add(c);
                last = c.t;
            }
            return unique;
        }
        return out;
    }

    private List<String> universe(String target) {
        List<String> out = new ArrayList<>();
        if ("top3".equals(target)) {
            for (String s : TOP3) out.add(s);
            return out;
        }
        if ("all".equals(target)) {
            // 거래대금 상위 36종목(코인만) — 주식선물·스테이블은 뺀다
            List<String> symbols = new ArrayList<>(volumeCache.keySet());
            symbols.sort((a, b) -> Double.compare(volumeCache.getOrDefault(b, 0.0), volumeCache.getOrDefault(a, 0.0)));
            Set<String> skip = new HashSet<>();
            for (String s : new String[] { "USDCUSDT", "FDUSDUSDT", "TUSDUSDT", "BUSDUSDT", "DAIUSDT", "EURUSDT", "USDPUSDT" }) {
                skip.add(s);
            }
            for (String s : symbols) {
                if (out.size() >= 36) break;
                if (skip.contains(s) || s.endsWith("STOCK")) continue;
                if (!s.endsWith("USDT")) continue;
                out.add(s);
            }
            if (out.isEmpty()) {
                for (String s : MAJORS) out.add(s);
            }
            return out;
        }
        for (String s : MAJORS) out.add(s);
        return out;
    }

    /* ------------------------------------------------------------------ *
     * HTTP
     * ------------------------------------------------------------------ */

    private JSONArray getArray(String url) throws Exception {
        Object data = getJson(url);
        return data instanceof JSONArray ? (JSONArray) data : new JSONArray();
    }

    private JSONObject getObject(String url) throws Exception {
        Object data = getJson(url);
        return data instanceof JSONObject ? (JSONObject) data : new JSONObject();
    }

    private Object getJson(String url) throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(12000);
            conn.setRequestProperty("User-Agent", "COTA-Android");
            int status = conn.getResponseCode();
            StringBuilder sb = new StringBuilder();
            java.io.InputStream stream = status >= 200 && status < 300 ? conn.getInputStream() : conn.getErrorStream();
            if (stream == null) throw new IllegalStateException("HTTP " + status);
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) sb.append(line);
            }
            String text = sb.toString();
            if (text.startsWith("[")) return new JSONArray(text);
            JSONObject obj = new JSONObject(text);
            if (obj.has("code") && !"00000".equals(obj.optString("code"))) {
                throw new IllegalStateException("API " + obj.optString("code"));
            }
            if (obj.has("data")) return obj.opt("data");
            return obj;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    /* ------------------------------------------------------------------ *
     * 포그라운드 알림
     * ------------------------------------------------------------------ */

    private void createServiceChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CH_SERVICE) != null) return;
        NotificationChannel channel = new NotificationChannel(CH_SERVICE, "COTA 알림 감시", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("백그라운드 알림 감시 상태(상단 고정)");
        channel.setShowBadge(false);
        channel.enableVibration(false);
        channel.setLightColor(Color.parseColor("#3182F6"));
        manager.createNotificationChannel(channel);
    }

    private Notification buildServiceNotification(String text) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, 79, intent, flags);
        return new NotificationCompat.Builder(this, CH_SERVICE)
                .setSmallIcon(R.drawable.ic_stat_signal)
                .setColor(Color.parseColor("#3182F6"))
                .setContentTitle("COTA 알림 감시 중")
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setOngoing(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(pending)
                .build();
    }

    private void updateServiceNotification(int checked) {
        if (!running) return;
        JSONObject settings = AlertStore.settings(this);
        int alerts = AlertStore.alerts(this).length();
        int macro = AlertStore.macroEvents(this).length();
        String text = String.format(Locale.US,
                "60~120초마다 확인 · 조건 %d · 지표 %d · 시그널 %s · 뉴스 %s",
                alerts, macro,
                settings.optBoolean("signal", true) ? "ON" : "OFF",
                settings.optBoolean("news", false) ? "ON" : "OFF");
        if (checked > 0) text = text + " · 이번 주기 " + checked + "건";
        try {
            NotificationManagerCompat.from(this).notify(SERVICE_NOTIF_ID, buildServiceNotification(text));
        } catch (Exception ignored) {
        }
    }

    private void startForegroundCompat(Notification notification) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(SERVICE_NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(SERVICE_NOTIF_ID, notification);
            }
        } catch (Exception e) {
            try {
                startForeground(SERVICE_NOTIF_ID, notification);
            } catch (Exception ignored) {
            }
        }
    }

    /* ------------------------------------------------------------------ *
     * 도우미
     * ------------------------------------------------------------------ */

    private static int clamp(int value, int lo, int hi) {
        return Math.max(lo, Math.min(hi, value));
    }

    private static double numOr(String raw) {
        return numOr(raw, Double.NaN);
    }

    private static double numOr(String raw, double fallback) {
        try {
            if (raw == null || raw.isEmpty() || "null".equals(raw)) return fallback;
            return Double.parseDouble(raw);
        } catch (Exception e) {
            return fallback;
        }
    }

    private static String usd(double value) {
        if (!(value > 0)) return "—";
        if (value >= 1000) return String.format(Locale.US, "$%,.0f", value);
        if (value >= 1) return String.format(Locale.US, "$%.2f", value);
        if (value >= 0.01) return String.format(Locale.US, "$%.4f", value);
        return String.format(Locale.US, "$%.6f", value);
    }

    private static String num(double value, int digits) {
        if (Double.isNaN(value)) return "—";
        return String.format(Locale.US, "%." + digits + "f", value);
    }

    private static int countWords(String text, String[] words) {
        String hay = text.toLowerCase(Locale.ROOT);
        int count = 0;
        for (String w : words) {
            if (w.isEmpty()) continue;
            String needle = w.toLowerCase(Locale.ROOT);
            if (needle.matches("^[a-z].*")) {
                int from = 0;
                while (true) {
                    int idx = hay.indexOf(needle, from);
                    if (idx < 0) break;
                    char before = idx == 0 ? ' ' : hay.charAt(idx - 1);
                    if (!Character.isLetterOrDigit(before)) {
                        count++;
                        break;
                    }
                    from = idx + 1;
                }
            } else if (hay.contains(needle)) {
                count++;
            }
        }
        return count;
    }

    private static String strip(String html) {
        if (html == null) return "";
        return html
                .replaceAll("<script[\\s\\S]*?</script>", " ")
                .replaceAll("<style[\\s\\S]*?</style>", " ")
                .replaceAll("<[^>]+>", " ")
                .replace("&nbsp;", " ")
                .replace("&amp;", "&")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static String message(Exception e) {
        return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
    }
}
