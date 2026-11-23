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

import java.util.Locale;

/**
 * 🤖 COTA 자동매매 24시간 감시 서비스 (포그라운드).
 *
 *  · 앱이 화면에서 내려가도 살아 있으면서, 웹 엔진이 넘겨준 **감시 목록(armed plans)** 의
 *    진입 조건(진입가 터치 · 손절가 이탈 · 유효시간 만료)을 주기적으로 확인한다.
 *  · 조건을 통과하면 비트겟에 레버리지 설정 → 시장가 주문(+TP/SL)을 넣고, 결과를 상단 알림과 로그로 남긴다.
 *  · 안전장치: 1일 손실 한도(계좌 equity 기준) · 동시 포지션 수 · 중복 진입 · 허용 종목.
 *    1일 손실 한도에 닿으면 설정의 enabled 를 false 로 바꾸고 스스로 멈춘다.
 *  · 주문 clientOid 는 시그널 키에서 만든 고정값 → 재시도해도 거래소가 중복 주문으로 거절한다.
 */
public class AutoTradeService extends Service {

    public static final String ACTION_START = "com.hw3238.bitgetscanner.AUTOTRADE_START";
    public static final String ACTION_STOP = "com.hw3238.bitgetscanner.AUTOTRADE_STOP";
    public static final String ACTION_SYNC = "com.hw3238.bitgetscanner.AUTOTRADE_SYNC";
    public static final String EXTRA_CONFIG = "config";
    public static final String EXTRA_PLANS = "plans";

    private static final String CHANNEL_ID = "cota_autotrade";
    private static final String CHANNEL_NAME = "COTA 자동매매";
    private static final int NOTIFICATION_ID = 4407;
    private static final long MIN_INTERVAL_MS = 30_000L;
    private static final double TOUCH_TOLERANCE = 0.0005;

    private HandlerThread workerThread;
    private Handler worker;
    private PowerManager.WakeLock wakeLock;
    private volatile boolean running;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            long next = 60_000L;
            try {
                JSONObject config = AutoTradeStore.config(AutoTradeService.this);
                next = Math.max(MIN_INTERVAL_MS, config.optLong("intervalSec", 60) * 1000L);
                if (!config.optBoolean("enabled", false)) {
                    AutoTradeStore.addLog(AutoTradeService.this, "info", "설정이 꺼져 있어 감시를 종료합니다.");
                    stopSelf();
                    return;
                }
                tickOnce(config);
            } catch (Exception e) {
                AutoTradeStore.addLog(AutoTradeService.this, "error", "감시 중 오류 — " + e.getMessage());
            } finally {
                if (running) worker.postDelayed(this, next);
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        AutoTradeStore.setRunning(this, true);
        createChannel();
        workerThread = new HandlerThread("cota-autotrade");
        workerThread.start();
        worker = new Handler(workerThread.getLooper());
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "COTA:autotrade");
            wakeLock.setReferenceCounted(false);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForegroundCompat(buildNotification("감시 준비 중", "설정을 확인하고 있습니다."));
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            AutoTradeStore.addLog(this, "info", "⏹ 자동매매 즉시 중지 — 새 진입을 멈췄습니다.");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null) {
            String configRaw = intent.getStringExtra(EXTRA_CONFIG);
            if (configRaw != null && !configRaw.isEmpty()) {
                try {
                    AutoTradeStore.saveConfig(this, new JSONObject(configRaw));
                } catch (Exception ignored) {}
            }
            String plansRaw = intent.getStringExtra(EXTRA_PLANS);
            if (plansRaw != null && !plansRaw.isEmpty()) {
                try {
                    AutoTradeStore.savePlans(this, new JSONArray(plansRaw));
                } catch (Exception ignored) {}
            }
        }
        JSONObject config = AutoTradeStore.config(this);
        if (!config.optBoolean("enabled", false)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_SYNC.equals(action)) {
            // 감시 목록·설정만 갱신 — 주기를 다시 시작하지 않아 거래소 호출을 늘리지 않는다.
            notification("감시 중", statusText(config));
            return START_STICKY;
        }
        notification("감시 중", statusText(config));
        worker.removeCallbacks(tick);
        worker.post(tick);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        AutoTradeStore.setRunning(this, false);
        if (worker != null) worker.removeCallbacksAndMessages(null);
        if (workerThread != null) workerThread.quitSafely();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopForegroundCompat();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /* ------------------------------------------------------------------ *
     * 한 주기
     * ------------------------------------------------------------------ */

    private void tickOnce(JSONObject config) {
        BitgetApi.Keys keys = AutoTradeStore.keys(this);
        if (keys == null) {
            AutoTradeStore.addLog(this, "error", "API 키가 없어 감시를 멈춥니다. 키를 다시 연결해 주세요.");
            stopSelf();
            return;
        }
        acquireWake();

        double equity = 0;
        String posMode = "one_way_mode";
        int openPositions = 0;
        try {
            JSONObject account = BitgetApi.accounts(keys);
            equity = account.optDouble("equity", 0);
            // 통합계정(UTA)·클래식 계정 중 어느 쪽인지 화면에 남긴다.
            AutoTradeStore.setAccountMode(this, account.optString("accountMode", BitgetApi.knownMode(keys)));
        } catch (Exception e) {
            AutoTradeStore.addLog(this, "error", "계좌 조회 실패 — " + friendly(e));
        }
        try {
            posMode = BitgetApi.holdMode(keys, "BTCUSDT");
        } catch (Exception ignored) {
            /* 포지션 모드를 못 읽으면 단방향으로 시도 */
        }
        try {
            JSONArray positions = BitgetApi.positions(keys);
            openPositions = positions.length();
        } catch (Exception e) {
            AutoTradeStore.addLog(this, "error", "포지션 조회 실패 — " + friendly(e));
        }

        /* --- 1일 손실 한도: KST 날짜가 바뀌면 기준선을 다시 잡는다 --- */
        String today = dayKeyKst();
        double startEquity = AutoTradeStore.dayStartEquity(this);
        if (!today.equals(AutoTradeStore.dayKey(this)) || startEquity <= 0) {
            AutoTradeStore.setDay(this, today, equity);
            AutoTradeStore.setDailyLocked(this, false);
            AutoTradeStore.clearTraded(this);
            startEquity = equity;
            if (equity > 0) {
                AutoTradeStore.addLog(this, "info", String.format(Locale.US,
                        "새 거래일(%s) — 기준 equity $%,.2f", today, equity));
            }
        }
        double limitPct = config.optDouble("dailyLossPct", 4.5);
        if (limitPct > 0 && startEquity > 0 && equity > 0) {
            double pnl = equity - startEquity;
            double limit = startEquity * limitPct / 100.0;
            if (pnl <= -limit + 1e-9) {
                AutoTradeStore.setDailyLocked(this, true);
                AutoTradeStore.addLog(this, "block", String.format(Locale.US,
                        "1일 손실 한도 도달(−%.1f%%) — 오늘 자동 진입을 멈춥니다. 손익 $%,.2f / 한도 $%,.2f",
                        limitPct, pnl, limit));
                try {
                    config.put("enabled", false);
                    AutoTradeStore.saveConfig(this, config);
                } catch (Exception ignored) {}
                notifySignal("⛔ 자동매매 중지", String.format(Locale.US,
                        "1일 손실 한도(−%.1f%%)에 닿아 오늘 진입을 멈췄습니다. 손익 $%,.2f", limitPct, pnl));
                stopSelf();
                return;
            }
        }

        /* --- 감시 목록 확인 --- */
        JSONArray plans = AutoTradeStore.plans(this);
        JSONArray keep = new JSONArray();
        int maxPositions = config.optInt("maxPositions", 2);
        boolean autoEntry = config.optBoolean("autoEntry", true);
        long now = System.currentTimeMillis();

        for (int i = 0; i < plans.length(); i++) {
            JSONObject plan = plans.optJSONObject(i);
            if (plan == null) continue;
            String key = plan.optString("key", "");
            String symbol = plan.optString("symbol", "");
            String base = plan.optString("base", symbol.replace("USDT", ""));
            String side = plan.optString("side", "long");
            try {
                if (now >= plan.optLong("expiresAt", 0)) {
                    AutoTradeStore.addLog(this, "info", base + " 진입 대기 만료 — 감시에서 제외했습니다.");
                    continue;
                }
                if (AutoTradeStore.alreadyTraded(this, key)) continue;
                if (!autoEntry) {
                    keep.put(plan);
                    continue;
                }
                double price = BitgetApi.lastPrice(symbol);
                if (price <= 0) {
                    keep.put(plan);
                    continue;
                }
                double entry = plan.optDouble("entry", 0);
                double stop = plan.optDouble("stop", 0);
                boolean longSide = "long".equals(side);
                if (longSide ? price <= stop : price >= stop) {
                    AutoTradeStore.addLog(this, "info", base + " 손절가 이탈 — 셋업 무효로 진입 취소");
                    continue;
                }
                boolean touched = longSide ? price <= entry * (1 + TOUCH_TOLERANCE) : price >= entry * (1 - TOUCH_TOLERANCE);
                if (!touched) {
                    keep.put(plan);
                    continue;
                }
                if (openPositions >= maxPositions) {
                    AutoTradeStore.addLog(this, "block", String.format(Locale.US,
                            "%s 진입 보류 — 동시 포지션 %d/%d", base, openPositions, maxPositions));
                    keep.put(plan);
                    continue;
                }
                JSONObject order = buildOrder(plan, posMode, config);
                String leverage = String.valueOf((int) Math.round(plan.optDouble("leverage", 1)));
                BitgetApi.setLeverage(keys, symbol, leverage, "hedge_mode".equals(posMode) ? side : null);
                JSONObject res = BitgetApi.placeOrder(keys, order);
                AutoTradeStore.markTraded(this, key);
                openPositions += 1;
                String text = String.format(Locale.US, "%s %s %s @ %s · TP %s / SL %s · 주문 %s",
                        AutoTradeStore.isDemo(this) ? "[모의]" : "[실거래]",
                        base, longSide ? "롱" : "숏", trim(plan.optDouble("qty", 0)),
                        // 실제로 보낸 호가 배수 가격을 남긴다(원본 target/stop 은 소수 꼬리가 있다).
                        order.optString("presetStopSurplusPrice", trim(plan.optDouble("target", 0))),
                        order.optString("presetStopLossPrice", trim(plan.optDouble("stop", 0))),
                        res.optString("orderId", res.optString("clientOid", "")));
                AutoTradeStore.addLog(this, "fill", text);
                notifySignal("🤖 자동매매 체결", text);
            } catch (Exception e) {
                AutoTradeStore.addLog(this, "error", base + " 주문 실패 — " + friendly(e)
                        + " [" + AutoTradeStore.accountMode(this) + "]");
                /* 주문이 실제로 접수됐을 수 있으니 다음 주기까지 대기(중복 주문은 clientOid로 차단) */
                keep.put(plan);
            }
        }
        AutoTradeStore.savePlans(this, keep);
        AutoTradeStore.setSnapshot(this, now, equity, openPositions);
        notification("감시 중", statusText(config));
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    /** 감시 항목 → 비트겟 place-order body */
    private JSONObject buildOrder(JSONObject plan, String posMode, JSONObject config) throws Exception {
        String symbol = plan.optString("symbol");
        String side = plan.optString("side", "long");
        boolean longSide = "long".equals(side);
        boolean hedge = "hedge_mode".equals(posMode);
        JSONObject body = new JSONObject();
        body.put("symbol", symbol);
        body.put("productType", BitgetApi.PRODUCT);
        body.put("marginMode", "isolated");
        body.put("marginCoin", BitgetApi.MARGIN_COIN);
        body.put("size", trim(plan.optDouble("qty", 0)));
        body.put("side", longSide ? "buy" : "sell");
        if (hedge) {
            // v2 는 tradeSide(open/close), v3(통합계정)는 posSide(long/short) — BitgetApi 가 골라 쓴다.
            body.put("tradeSide", "open");
            body.put("posSide", side);
        }
        body.put("orderType", "market");
        body.put("clientOid", clientOid(plan));
        // TP/SL — 웹이 호가 배수로 맟춰 보낸 문자열(tpStr/slStr)을 그대로 쓴다.
        // 없으면 계약 호가(pricePlace·priceEndStep)로 맞춘다. 예전에는 %.8f 로 소수 꼬리를 그대로 보내
        // 비트겟이 45115(The price you enter should be a multiple of 0.01)로 거절했다.
        int pricePlace = plan.has("pricePlace") ? plan.optInt("pricePlace", -1) : plan.optInt("decimals", -1);
        int priceEndStep = plan.optInt("priceEndStep", 1);
        String target = tickPrice(plan, "tpStr", "target", pricePlace, priceEndStep);
        String stop = tickPrice(plan, "slStr", "stop", pricePlace, priceEndStep);
        if (!target.isEmpty()) body.put("presetStopSurplusPrice", target);
        if (!stop.isEmpty()) body.put("presetStopLossPrice", stop);
        return body;
    }

    /** 이미 호가 배수로 맞춘 문자열 → 없으면 계약 호가로 반올림 → 호가 정보도 없으면 종전 표기 */
    private static String tickPrice(JSONObject plan, String strKey, String numKey, int pricePlace, int priceEndStep) {
        String exact = plan.optString(strKey, "");
        if (exact != null && !exact.isEmpty()) return exact;
        double value = plan.optDouble(numKey, 0);
        if (!(value > 0)) return "";
        if (pricePlace >= 0 && pricePlace <= 8) return BitgetApi.roundToTick(value, pricePlace, priceEndStep);
        return trim(value);
    }

    /** 시그널 키 → 고정 clientOid (재시도해도 거래소가 중복으로 거절) */
    private static String clientOid(JSONObject plan) {
        String key = plan.optString("key", plan.optString("symbol", "cota"));
        long detected = plan.optLong("detectedAt", 0);
        String hash = Integer.toHexString(key.hashCode());
        String tail = Long.toHexString(detected);
        String oid = "c" + hash + tail;
        return oid.length() > 36 ? oid.substring(0, 36) : oid;
    }

    private static String trim(double v) {
        if (!(v > 0)) return "";
        String s = String.format(Locale.US, "%.8f", v);
        s = s.replaceAll("0+$", "");
        return s.endsWith(".") ? s.substring(0, s.length() - 1) : s;
    }

    private static String friendly(Exception e) {
        if (e instanceof BitgetApi.ApiException) return ((BitgetApi.ApiException) e).friendly();
        return e.getMessage() == null ? "알 수 없는 오류" : e.getMessage();
    }

    private static String dayKeyKst() {
        return AutoTradeStore.todayKst();
    }

    private void acquireWake() {
        if (wakeLock != null && !wakeLock.isHeld()) {
            // 주기마다 60초만 CPU를 깨워 둔다 — 24시간 상시 wake lock 으로 배터리를 태우지 않는다.
            wakeLock.acquire(60_000L);
        }
    }

    /* ------------------------------------------------------------------ *
     * 알림
     * ------------------------------------------------------------------ */

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("자동매매 감시 상태(상단 고정)");
        channel.setShowBadge(false);
        channel.enableVibration(false);
        channel.setLightColor(Color.parseColor("#3182F6"));
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification(String title, String body) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, 77, intent, flags);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_signal)
                .setColor(Color.parseColor("#3182F6"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setOngoing(true)
                .setShowWhen(false)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(pending)
                .build();
    }

    private void notification(String title, String body) {
        try {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification(title, body));
        } catch (Exception ignored) {
            /* 알림 권한이 없어도 감시는 계속한다 */
        }
    }

    private void startForegroundCompat(Notification notification) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception ignored) {}
        }
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(true);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {}
    }

    /** 체결·차단은 기존 시그널 채널(중요도 높음)로 알린다 — 소리·진동 동반 */
    private void notifySignal(String title, String body) {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pending = PendingIntent.getActivity(this, 78, intent, flags);
            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, "bitget_signals")
                    .setSmallIcon(R.drawable.ic_stat_signal)
                    .setColor(Color.parseColor("#3182F6"))
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true)
                    .setContentIntent(pending);
            NotificationManagerCompat.from(this).notify((int) (System.currentTimeMillis() % 100000) + 2, builder.build());
        } catch (Exception ignored) {}
    }

    private String statusText(JSONObject config) {
        int armed = AutoTradeStore.plans(this).length();
        int pos = AutoTradeStore.lastPositions(this);
        double equity = AutoTradeStore.lastEquity(this);
        String mode = AutoTradeStore.isDemo(this) ? "모의투자" : "실거래";
        return String.format(Locale.US, "%s · 감시 %d · 포지션 %d/%d · USDT $%,.0f",
                mode, armed, pos, config.optInt("maxPositions", 2), equity);
    }
}
