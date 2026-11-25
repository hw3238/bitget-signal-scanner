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
    /** 진입가보다 불리한(추격) 쪽 허용 — 롱은 위 0.5%, 숏은 아래 0.5% (웹 ENTRY_CHASE 와 같다) */
    private static final double ENTRY_CHASE = 0.005;
    /** 진입가보다 유리한 쪽 허용 — 롱은 아래 0.8%, 숏은 위 0.8% (넘으면 손익비로 판정) */
    private static final double ENTRY_FAVOR = 0.008;
    /** 현재가 기준 손익비 하한 — 이보다 나쁘면 진입하지 않는다(설정 minRR 과 별개의 안전선) */
    private static final double MIN_ENTRY_RR = 1.0;
    /** 같은 '진입가 대기' 로그를 다시 남기는 간격 — 매 주기 같은 문구로 로그를 채우지 않는다 */
    private static final long WAIT_LOG_MS = 10 * 60_000L;
    /** 현재가가 손절가에 0.1% 이내로 붙으면 진입하지 않는다(즉시 손절 방지) */
    private static final double MIN_STOP_DISTANCE = 0.001;
    /** 목표가까지 0.1% 미만이면 진입하지 않는다(거래소 25585/25587 TP 방향 오류 방지) */
    private static final double MIN_TARGET_GAP = 0.001;

    private HandlerThread workerThread;
    private Handler worker;
    private PowerManager.WakeLock wakeLock;
    private volatile boolean running;
    /** 보유 중 도달한 최대 유리 R — 본절 보호 판단(서비스 생존 동안 유지) */
    private final java.util.Map<String, Double> peakR = new java.util.HashMap<>();
    /** 조기 손절 시도 시각 — 같은 종목을 5분에 한 번만 건드린다 */
    private final java.util.Map<String, Long> lastExitAt = new java.util.HashMap<>();
    /** 반익절 보류 사유 로그 — 같은 사유를 매 주기 반복해 쌓지 않는다(v1.5.6) */
    private final java.util.Set<String> partialSkipLogged = new java.util.HashSet<>();
    /** 진입 대기 사유 로그 — 감시 항목별 마지막 문구·시각. 문구가 바뀌거나 10분마다 한 번만 남긴다. */
    private final java.util.Map<String, String> waitNote = new java.util.HashMap<>();
    private final java.util.Map<String, Long> waitAt = new java.util.HashMap<>();

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
        try {
            tickBody(keys, config);
        } finally {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        }
    }

    /** 한 주기 본체 — 어떤 경로로 끝나도 wake lock 은 tickOnce 의 finally 가 푼다. */
    private void tickBody(BitgetApi.Keys keys, JSONObject config) {
        double equity = 0;
        // 가용 잔고 · 미실현 손익 — 웹이 서비스와 무관하게 최신 잔고를 읽도록 스냅숏에 함께 저장한다(v1.5.4).
        double available = 0;
        double unrealizedPL = 0;
        String posMode = "one_way_mode";
        int openPositions = 0;
        JSONArray heldPositions = new JSONArray();
        try {
            JSONObject account = BitgetApi.accounts(keys);
            equity = account.optDouble("equity", 0);
            available = account.optDouble("available", 0);
            unrealizedPL = account.optDouble("unrealizedPL", 0);
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
        boolean positionsOk = false;
        try {
            heldPositions = BitgetApi.positions(keys);
            openPositions = heldPositions.length();
            positionsOk = true;
        } catch (Exception e) {
            AutoTradeStore.addLog(this, "error", "포지션 조회 실패 — " + friendly(e));
        }

        /* --- 1일 손실 한도: KST 날짜가 바뀌면 기준선을 다시 잡는다 --- */
        String today = dayKeyKst();
        double startEquity = AutoTradeStore.dayStartEquity(this);
        boolean newDay = !today.equals(AutoTradeStore.dayKey(this));
        // 날이 바뀐 주기에만 잠금·중복 진입 기록을 초기화한다 — 잔고 조회가 실패한 주기에
        // 기준선이 0이 됐다고 매번 clearTraded 하면 같은 시그널로 중복 주문이 나갈 수 있다.
        if (newDay || startEquity <= 0) {
            AutoTradeStore.setDay(this, today, equity);
            if (newDay) {
                AutoTradeStore.setDailyLocked(this, false);
                AutoTradeStore.clearTraded(this);
            }
            startEquity = equity;
            if (newDay && equity > 0) {
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

        /* --- 🛡 조기 손절: SL 전에 진입 근거가 무너지면 선제 청산 (v1.5.4) --- */
        java.util.Set<String> earlyClosed = new java.util.HashSet<>();
        if (heldPositions.length() > 0) {
            earlyClosed = checkEarlyExit(keys, config, heldPositions, posMode);
            openPositions = Math.max(0, openPositions - earlyClosed.size());
        }

        /* --- 💰 50% 반익절: 목표가 50% 또는 +1.0R 도달 시 절반 익절 (v1.5.6) --- */
        // 포지션 조회가 성공한 주기에만 돈다 — 조회 실패로 '포지션 없음'이 되면 완료 표시가 지워져
        // 다음 주기에 반익절을 두 번 넣을 수 있다. (포지션이 0건이면 청산된 기록 정리만 한다)
        if (positionsOk) {
            checkPartialTp(keys, config, heldPositions, posMode, earlyClosed, System.currentTimeMillis());
        }

        /* --- 감시 목록 확인 --- */
        JSONArray plans = AutoTradeStore.plans(this);
        JSONArray keep = new JSONArray();
        int maxPositions = config.optInt("maxPositions", 2);
        boolean autoEntry = config.optBoolean("autoEntry", true);
        boolean hedge = "hedge_mode".equals(posMode);
        long now = System.currentTimeMillis();

        // 이미 보유한 종목 — 같은 종목에 또 진입하면 수량이 겹쳐 리스크가 두 배가 된다.
        java.util.Set<String> heldSymbols = new java.util.HashSet<>();
        java.util.Set<String> heldSides = new java.util.HashSet<>();
        for (int i = 0; i < heldPositions.length(); i++) {
            JSONObject p = heldPositions.optJSONObject(i);
            if (p == null) continue;
            String sym = p.optString("symbol", "").toUpperCase(Locale.ROOT);
            if (sym.isEmpty()) continue;
            // 방금 조기 청산한 포지션은 이번 주기 진입 판단에서 뺀다(청산 직후 재진입 방지).
            if (earlyClosed.contains(sym + "|" + p.optString("holdSide", "").toLowerCase(Locale.ROOT))) continue;
            heldSymbols.add(sym);
            heldSides.add(sym + "|" + p.optString("holdSide", "").toLowerCase(Locale.ROOT));
        }
        boolean quoteFailed = false;

        for (int i = 0; i < plans.length(); i++) {
            JSONObject plan = plans.optJSONObject(i);
            if (plan == null) continue;
            String key = plan.optString("key", "");
            String symbol = plan.optString("symbol", "");
            String base = plan.optString("base", symbol.replace("USDT", ""));
            String side = plan.optString("side", "long");
            boolean longSide = "long".equals(side);
            try {
                if (now >= plan.optLong("expiresAt", 0)) {
                    AutoTradeStore.addLog(this, "info", base + " 진입 대기 만료 — 감시에서 제외했습니다.");
                    continue;
                }
                if (AutoTradeStore.alreadyTraded(this, key)) continue;
                // 오늘 거래소가 거부한 종목(상장폐지·Demo 미지원·거래 제한) — 같은 실패를 반복하지 않는다.
                if (AutoTradeStore.isSkippedSymbol(this, symbol)) continue;
                if (!autoEntry) {
                    logWait(plan, key + "|manual", base, 0, 0, 0, 0, 0, longSide, 0,
                            base + " 감시 중 — '새 시그널 자동 진입'이 꺼져 있어 원클릭 주문을 기다립니다.");
                    keep.put(plan);
                    continue;
                }
                String upperSymbol = symbol.toUpperCase(Locale.ROOT);
                if (hedge ? heldSides.contains(upperSymbol + "|" + side) : heldSymbols.contains(upperSymbol)) {
                    logWait(plan, key + "|held", base, 0, 0, 0, 0, 0, longSide, 0,
                            base + " " + (longSide ? "롱" : "숏")
                                    + " — 같은 종목 포지션을 이미 보유 중이라 중복 진입을 막았습니다(포지션이 닫히면 다시 판단).");
                    keep.put(plan);
                    continue;
                }

                double price;
                try {
                    price = BitgetApi.lastPriceCached(symbol);
                } catch (Exception qe) {
                    if (!quoteFailed) {
                        quoteFailed = true;
                        AutoTradeStore.addLog(this, "info", "시세 조회 실패 — 다음 주기에 다시 확인합니다. (" + friendly(qe) + ")");
                    }
                    keep.put(plan);
                    continue;
                }
                if (!(price > 0)) {
                    if (!quoteFailed) {
                        quoteFailed = true;
                        AutoTradeStore.addLog(this, "info", "시세를 받지 못했습니다 — 다음 주기에 다시 확인합니다.");
                    }
                    keep.put(plan);
                    continue;
                }

                double entry = plan.optDouble("entry", 0);
                double stop = plan.optDouble("stop", 0);
                double target = plan.optDouble("target", 0);
                /*
                 * 진입 판정(v1.5.7) — 웹 `planTrigger` 와 **같은 규칙**을 EntryZoneRule 이 갖는다.
                 *   롱 entry×0.992~1.005 · 숏 entry×0.995~1.008, 더 유리한 자리는 손익비 기준 통과 시 진입.
                 *   손절가 이탈/목표가 도달/손절가 밀착/유효시간 만료는 감시에서 제외하고 이유를 남긴다.
                 */
                double rrFloor = EntryZoneRule.rrFloor(config.optDouble("minRR", 1.2));
                EntryZoneRule.Trigger trigger = EntryZoneRule.decide(
                        longSide, entry, stop, target, price, now, plan.optLong("expiresAt", 0), rrFloor);
                if (trigger == EntryZoneRule.Trigger.INVALIDATED
                        || trigger == EntryZoneRule.Trigger.TARGET_PASSED
                        || trigger == EntryZoneRule.Trigger.NEAR_STOP
                        || trigger == EntryZoneRule.Trigger.EXPIRED) {
                    AutoTradeStore.addLog(this, "info", EntryZoneRule.reason(
                            base, longSide, entry, stop, target, price, now, plan.optLong("expiresAt", 0), rrFloor));
                    continue;
                }
                if (trigger != EntryZoneRule.Trigger.ENTER) {
                    logWait(plan, key, base, price, EntryZoneRule.zoneLow(longSide, entry),
                            EntryZoneRule.zoneHigh(longSide, entry), EntryZoneRule.rrAtPrice(longSide, price, stop, target),
                            rrFloor, longSide, target,
                            EntryZoneRule.reason(base, longSide, entry, stop, target, price, now, plan.optLong("expiresAt", 0), rrFloor));
                    keep.put(plan);
                    continue;
                }
                if (openPositions >= maxPositions) {
                    logWait(plan, key + "|max", base, price, EntryZoneRule.zoneLow(longSide, entry),
                            EntryZoneRule.zoneHigh(longSide, entry), EntryZoneRule.rrAtPrice(longSide, price, stop, target),
                            rrFloor, longSide, target,
                            String.format(Locale.US, "%s 진입 보류 — 동시 포지션 %d/%d (포지션이 닫히면 다시 진입합니다)",
                                    base, openPositions, maxPositions));
                    keep.put(plan);
                    continue;
                }
                AutoTradeStore.addLog(this, "info", EntryZoneRule.reason(
                        base, longSide, entry, stop, target, price, now, plan.optLong("expiresAt", 0), rrFloor));
                waitNote.remove(key);
                waitAt.remove(key);
                int leverageValue = leverageFor(plan, symbol);
                JSONObject order = buildOrder(plan, posMode, config, equity, available, leverageValue);
                String leverage = String.valueOf(leverageValue);
                BitgetApi.setLeverage(keys, symbol, leverage, hedge ? side : null);
                JSONObject res;
                try {
                    res = BitgetApi.placeOrder(keys, order);
                } catch (BitgetApi.ApiException oe) {
                    if (oe.code != null && oe.code.startsWith(BitgetApi.GUARD_PREFIX)) {
                        // 앱이 미리 막은 주문(최소 금액·TP/SL 방향) — 감시에서 빼고 이유를 남긴다.
                        AutoTradeStore.addLog(this, "info", base + " 진입 취소 — " + oe.friendly());
                        continue;
                    }
                    if (oe.symbolGone()) {
                        // 종목 자체를 쓸 수 없다 — 오늘 제외 목록에 넣어 매 주기 반복 실패를 막는다.
                        AutoTradeStore.skipSymbol(this, symbol);
                        AutoTradeStore.addLog(this, "block", base + " 오늘 감시 제외 — " + oe.friendly());
                        continue;
                    }
                    // 자동 보정까지 했는데도 실패 — 한글 사유와 보정 내역을 함께 남긴다.
                    //  · 주문이 실제로 접수됐을 수 있으니 감시 목록에는 남겨 두고(중복은 clientOid 로 차단)
                    //    다음 주기에 다시 판단한다.
                    AutoTradeStore.addLog(this, "error", base + " 주문 실패 — " + oe.friendly()
                            + recoveryNote(oe.recovery));
                    keep.put(plan);
                    continue;
                }
                // 자동 보정으로 성공했으면 어떤 보정을 했는지 남긴다(사용자는 결과만 보면 된다).
                if (res.optJSONArray("recovery") != null && res.optJSONArray("recovery").length() > 0) {
                    AutoTradeStore.addLog(this, "info", base + " 주문 성공 — 자동 보정: "
                            + joinRecovery(res.optJSONArray("recovery")));
                }
                AutoTradeStore.markTraded(this, key);
                // 💰 감시 목록이 사라져도 반익절 판단에 쓸 수 있게 이 포지션의 목표/손절을 남긴다(v1.5.6)
                AutoTradeStore.savePositionTarget(this, upperSymbol + "|" + side, entry, target, stop);
                openPositions += 1;
                heldSymbols.add(upperSymbol);
                heldSides.add(upperSymbol + "|" + side);
                String text = String.format(Locale.US, "%s %s %s @ %s · TP %s / SL %s · 주문 %s",
                        AutoTradeStore.isDemo(this) ? "[모의]" : "[실거래]",
                        base, longSide ? "롱" : "숏", order.optString("size", trim(plan.optDouble("qty", 0))),
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
        // 잔고를 못 읽은 주기(equity=0)에는 마지막으로 알던 값을 유지한다 — 화면이 $0 로 깜빡이지 않게.
        double shownEquity = equity > 0 ? equity : AutoTradeStore.lastEquity(this);
        AutoTradeStore.setSnapshot(this, now, shownEquity, available, unrealizedPL, openPositions);
        notification("감시 중", statusText(config));
    }

    /* ------------------------------------------------------------------ *
     * 🛡 조기 손절 (v1.5.4)
     * ------------------------------------------------------------------ */

    /**
     * 보유 포지션을 훑어 SL 전에 청산할 근거가 있는지 본다.
     *  · 반대 시그널(웹이 넘긴 진행 중 시그널 중 포지션 진입 뒤 것) · 마감 캔들 구조 붕괴 · 본절 보호
     *  · 청산한 포지션의 "SYMBOL|side" 집합을 돌려준다 — 같은 주기 중복 진입·포지션 수 계산에 쓴다.
     */
    private java.util.Set<String> checkEarlyExit(
            BitgetApi.Keys keys, JSONObject config, JSONArray held, String posMode) {
        java.util.Set<String> closed = new java.util.HashSet<>();
        boolean enabled = config.optBoolean("earlyStop", true);
        long now = System.currentTimeMillis();
        JSONArray signals = AutoTradeStore.exitSignals(this);
        java.util.Set<String> alive = new java.util.HashSet<>();

        for (int i = 0; i < held.length(); i++) {
            JSONObject p = held.optJSONObject(i);
            if (p == null) continue;
            String symbol = p.optString("symbol", "");
            if (symbol.isEmpty()) continue;
            String holdSide = p.optString("holdSide", "long").toLowerCase(Locale.ROOT);
            String key = symbol + "|" + holdSide;
            alive.add(key);
            if (!enabled) continue;

            double entry = p.optDouble("openPriceAvg", 0);
            double stop = p.optDouble("presetStopLossPrice", 0);
            double mark = p.optDouble("markPrice", 0);
            double price = mark > 0 ? mark : BitgetApi.lastPriceCached(symbol);
            if (!(entry > 0) || !(stop > 0) || !(price > 0)) continue;
            boolean longSide = !"short".equals(holdSide);

            // 최대 유리 R 갱신(본절 보호용)
            double r = EarlyStopRule.rMultiple(longSide, entry, stop, price);
            Double prevPeak = peakR.get(key);
            double peak = Math.max(prevPeak == null ? 0 : prevPeak, r);
            peakR.put(key, peak);

            long openedAt = p.optLong("ctime", 0);
            if (openedAt > 0 && openedAt < 10_000_000_000L) openedAt *= 1000L; // 초 단위 응답 방어
            if (openedAt <= 0 || openedAt > now) {
                // 진입 시각을 모르면 '진입 직후 보호' 판단을 할 수 없다 — 이번 주기는 건너뛴다.
                continue;
            }
            Long last = lastExitAt.get(key);
            if (last != null && now - last < EarlyStopRule.COOLDOWN_MS) continue;

            long oppositeAt = 0;
            for (int j = 0; j < signals.length(); j++) {
                JSONObject s = signals.optJSONObject(j);
                if (s == null) continue;
                if (!symbol.equalsIgnoreCase(s.optString("symbol", ""))) continue;
                boolean sigLong = "long".equalsIgnoreCase(s.optString("side", "long"));
                if (sigLong == longSide) continue;
                oppositeAt = Math.max(oppositeAt, s.optLong("detectedAt", 0));
            }

            double[][] candles = new double[0][];
            try {
                candles = BitgetApi.candlesClosed(symbol, "15m", 40, 900_000L);
            } catch (Exception ignored) {
                /* 캔들을 못 읽으면 반대 시그널·본절 보호만으로 판단한다 */
            }

            EarlyStopRule.Decision decision = EarlyStopRule.decide(
                    enabled, longSide, entry, stop, price, openedAt, now, peak, oppositeAt, candles,
                    AutoTradeStore.isPartialTpDone(this, key));
            if (!decision.exit) continue;

            String size = trim(p.optDouble("total", 0));
            if (size.isEmpty()) continue;
            String base = symbol.replace("USDT", "");
            String oid = "ce" + Integer.toHexString(key.hashCode())
                    + Long.toHexString(now % 10_000_000L);
            if (oid.length() > 36) oid = oid.substring(0, 36);
            try {
                BitgetApi.closePosition(keys, symbol, holdSide, size, posMode, null, oid);
                lastExitAt.put(key, now);
                closed.add(key);
                String text = String.format(Locale.US,
                        "🛡 조기 손절 %s %s %s %s @ %s — %s · %.2fR",
                        AutoTradeStore.isDemo(this) ? "[모의]" : "[실거래]",
                        base,
                        longSide ? "롱" : "숏",
                        size,
                        trim(entry),
                        decision.reason,
                        decision.currentR);
                AutoTradeStore.addLog(this, "exit", text);
                notifySignal("🛡 조기 손절", text);
            } catch (Exception e) {
                // 실패해도 5분은 조용히 — 같은 오류로 매 주기 폭주하지 않게.
                lastExitAt.put(key, now);
                AutoTradeStore.addLog(this, "error", base + " 조기 손절 실패 — " + friendly(e));
            }
        }

        peakR.keySet().retainAll(alive);
        return closed;
    }

    /* ------------------------------------------------------------------ *
     * 💰 50% 반익절 (v1.5.6)
     * ------------------------------------------------------------------ */

    /**
     * 보유 포지션을 훑어 목표가 진행률 50% 또는 +1.0R 에 닿은 포지션의 절반을 시장가로 익절한다.
     *  · 분할 수량·남은 수량이 거래소 최소 수량/최소 금액($5)을 못 채우면 건너뛴다(거절 방지).
     *  · 성공하면 `AutoTradeStore.markPartialTpDone` 으로 중복 실행을 막고, 로그·푸시를 남긴다.
     *  · 청산된 포지션의 목표 기록·완료 표시는 마지막에 정리한다(같은 종목 재진입 시 다시 반익절 가능).
     */
    private void checkPartialTp(
            BitgetApi.Keys keys,
            JSONObject config,
            JSONArray held,
            String posMode,
            java.util.Set<String> skip,
            long now) {
        boolean enabled = config.optBoolean("partialTp", true);
        java.util.Set<String> alive = new java.util.HashSet<>();

        for (int i = 0; i < held.length(); i++) {
            JSONObject p = held.optJSONObject(i);
            if (p == null) continue;
            String symbol = p.optString("symbol", "");
            if (symbol.isEmpty()) continue;
            String holdSide = p.optString("holdSide", "long").toLowerCase(Locale.ROOT);
            String key = symbol + "|" + holdSide;
            alive.add(key);

            if (!enabled) continue;
            // 방금 조기 청산한 포지션은 건드리지 않는다.
            if (skip != null && skip.contains(key)) continue;
            if (AutoTradeStore.isPartialTpDone(this, key)) continue;

            boolean longSide = !"short".equals(holdSide);
            // 거래소 포지션의 TP/SL 이 1순위, 비어 있으면 진입 때 저장한 기록을 쓴다.
            JSONObject saved = AutoTradeStore.positionTarget(this, key);
            double entry = p.optDouble("openPriceAvg", 0);
            double stop = p.optDouble("presetStopLossPrice", 0);
            double target = p.optDouble("presetStopSurplusPrice", 0);
            if (saved != null) {
                if (!(entry > 0)) entry = saved.optDouble("entry", 0);
                if (!(stop > 0)) stop = saved.optDouble("stop", 0);
                if (!(target > 0)) target = saved.optDouble("target", 0);
            }
            double mark = p.optDouble("markPrice", 0);
            double price = mark > 0 ? mark : BitgetApi.lastPriceCached(symbol);
            double total = p.optDouble("total", 0);
            if (!(entry > 0) || !(price > 0) || !(total > 0)) continue;
            if (!PartialTpRule.triggered(longSide, entry, stop, target, price)) continue;

            String base = symbol.replace("USDT", "");
            BitgetApi.ContractLimits lim = BitgetApi.contractLimits(symbol);
            if (lim == null) {
                logPartialOnce(key, base + " 계약 단위를 확인하지 못해 이번 주기 반익절을 건너뜁니다.");
                continue;
            }
            PartialTpRule.Plan plan = PartialTpRule.plan(
                    longSide, entry, stop, target, price, total,
                    lim.minTradeNum, lim.minTradeUSDT, lim.volumePlace, lim.sizeMultiplier);
            if (!plan.eligible) {
                // 같은 사유를 매 주기 로그로 쌓지 않는다(포지션당 한 번).
                logPartialOnce(key, base + " 반익절 보류 — " + plan.reason);
                continue;
            }

            String oid = "pt" + Integer.toHexString(key.hashCode()) + Long.toHexString(now % 10_000_000L);
            if (oid.length() > 36) oid = oid.substring(0, 36);
            try {
                BitgetApi.closePosition(keys, symbol, holdSide, plan.qty, posMode, null, oid);
                AutoTradeStore.markPartialTpDone(this, key);
                Double peak = peakR.get(key);
                String text = String.format(Locale.US,
                        "💰 반익절 50%% %s %s %s %s @ %s — %s · 최대 +%.2fR",
                        AutoTradeStore.isDemo(this) ? "[모의]" : "[실거래]",
                        base,
                        longSide ? "롱" : "숏",
                        plan.qty,
                        trim(entry),
                        plan.reason,
                        Math.max(peak == null ? 0 : peak, plan.r));
                AutoTradeStore.addLog(this, "partial", text);
                notifySignal("💰 반익절 체결", text);
            } catch (Exception e) {
                AutoTradeStore.addLog(this, "error", base + " 반익절 실패 — " + friendly(e));
            }
        }

        // 살아 있는 포지션 것만 남긴다 — 청산된 포지션의 기록을 같은 종목 재진입이 물려받지 않게.
        AutoTradeStore.retainPositions(this, alive);
    }

    /** 반익절 보류 사유 — 포지션·문구당 한 번만 로그에 남긴다 */
    private void logPartialOnce(String key, String text) {
        if (!partialSkipLogged.add(key + "|" + text)) return;
        AutoTradeStore.addLog(this, "info", text);
    }

    /* ------------------------------------------------------------------ *
     * 진입 대기 사유 로그 (v1.5.7)
     *   감시 주기마다 "왜 들어가지 않았는지"를 남긴다. 다만 같은 문구를 매 주기 쌓지 않도록
     *   항목별로 문구가 바뀌었을 때·10분마다 한 번만 기록한다.
     * ------------------------------------------------------------------ */

    private void logWait(JSONObject plan, String key, String base, double price,
                         double zoneLow, double zoneHigh, double rrNow, double rrFloor,
                         boolean longSide, double target) {
        logWait(plan, key, base, price, zoneLow, zoneHigh, rrNow, rrFloor, longSide, target, null);
    }

    /** 진입 대기 로그 — 문구가 바뀌었거나 10분이 지났을 때만 남긴다(로그 40건 상한 보호). */
    private void logWait(JSONObject plan, String key, String base, double price,
                         double zoneLow, double zoneHigh, double rrNow, double rrFloor,
                         boolean longSide, double target, String custom) {
        String text = custom;
        if (text == null) {
            double entry = plan.optDouble("entry", 0);
            if (!(price > 0)) {
                text = base + " 시세를 받지 못해 다음 주기에 다시 확인합니다.";
            } else if (longSide ? price > zoneHigh : price < zoneLow) {
                // 추격 금지 — 진입가에서 너무 멀어졌다.
                double gap = longSide ? (price - zoneHigh) / (entry == 0 ? 1 : entry)
                        : (zoneLow - price) / (entry == 0 ? 1 : entry);
                text = String.format(Locale.US,
                        "%s %s 진입가 대기 중 — 현재가 %s 가 진입 %s %s 보다 %.2f%% %s(추격 금지). 구간 %s~%s",
                        base, longSide ? "롱" : "숏", trim(price),
                        longSide ? "상단" : "하단", trim(longSide ? zoneHigh : zoneLow),
                        gap * 100, longSide ? "위" : "아래", trim(zoneLow), trim(zoneHigh));
            } else {
                // 유리한 자리지만 손익비가 기준 미달
                text = String.format(Locale.US,
                        "%s %s 진입가 대기 중 — 현재가 %s 는 유리한 자리지만 손익비 %.2fR < 기준 %.1fR. 구간 %s~%s",
                        base, longSide ? "롱" : "숏", trim(price), rrNow, rrFloor, trim(zoneLow), trim(zoneHigh));
            }
        }
        Long last = waitAt.get(key);
        String prev = waitNote.get(key);
        long now = System.currentTimeMillis();
        if (text.equals(prev) && last != null && now - last < WAIT_LOG_MS) return;
        waitNote.put(key, text);
        waitAt.put(key, now);
        AutoTradeStore.addLog(this, "info", text);
    }

    /* ------------------------------------------------------------------ *
     * 레버리지 상한
     * ------------------------------------------------------------------ */

    /**
     * 종목 최대 배율 — 계약 `maxLever`, 모르면 안전 상한 100x.
     * 공격적 스타일은 레버리지 상한을 두지 않고 이 선안에서 유동적으로 쓴다(v1.5.6).
     */
    private static int exchangeLeverageCap(String symbol) {
        BitgetApi.ContractLimits lim = BitgetApi.contractLimits(symbol);
        if (lim != null && lim.maxLever > 0) return Math.min(lim.maxLever, 1000);
        return 100;
    }

    /** 감시 항목의 레버리지 → 실제 주문 배율(계약 최대 배율·안전 상한 이내) */
    private static int leverageFor(JSONObject plan, String symbol) {
        int wanted = (int) Math.round(plan.optDouble("leverage", 1));
        return Math.max(1, Math.min(exchangeLeverageCap(symbol), wanted));
    }


    /**
     * 감시 항목 → 비트겟 place-order body.
     * v1.5.5 — 수량을 **이번 주기에 읽은 실계좌 잔고(equity·available)** 로 다시 계산한다.
     *  · 웹이 계산한 수량은 앱을 닫아 둔 사이 낡는다(잔고가 늘거나 줄면 리스크가 달라진다).
     *  · 가용 잔고의 95%를 넘지 않게 캡한다 — 이미 잡힌 증거금 때문에 주문이 거절되는 일을 막는다.
     */
    private JSONObject buildOrder(
            JSONObject plan, String posMode, JSONObject config, double equity, double available, int leverageValue)
            throws Exception {
        String symbol = plan.optString("symbol");
        String side = plan.optString("side", "long");
        boolean longSide = "long".equals(side);
        boolean hedge = "hedge_mode".equals(posMode);
        JSONObject body = new JSONObject();
        body.put("symbol", symbol);
        body.put("productType", BitgetApi.PRODUCT);
        body.put("marginMode", "isolated");
        body.put("marginCoin", BitgetApi.MARGIN_COIN);
        body.put("size", sizeText(sizeForBalance(plan, equity, available, config, leverageValue)));
        body.put("posMode", hedge ? "hedge_mode" : "one_way_mode");
        body.put("leverageHint", Math.max(1, leverageValue));
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
        if (pricePlace < 0) {
            // 예전 웹 번들(캐시)이 보낸 감시 항목은 호가 정보가 없다 — 계약 API에서 직접 읽어 첫 주문부터 맟춘다.
            int[] tick = BitgetApi.contractTick(symbol);
            if (tick != null) {
                pricePlace = tick[0];
                priceEndStep = tick[1];
            }
        }
        String target = tickPrice(plan, "tpStr", "target", pricePlace, priceEndStep);
        String stop = tickPrice(plan, "slStr", "stop", pricePlace, priceEndStep);
        if (!target.isEmpty()) body.put("presetStopSurplusPrice", target);
        if (!stop.isEmpty()) body.put("presetStopLossPrice", stop);
        return body;
    }

    /** 자동 보정 목록 → `호가 단위 보정 · 포지션 모드 …` */
    private static String recoveryNote(java.util.List<String> recovery) {
        if (recovery == null || recovery.isEmpty()) return "";
        StringBuilder sb = new StringBuilder(" (자동 보정: ");
        for (int i = 0; i < recovery.size(); i++) {
            if (i > 0) sb.append(" · ");
            sb.append(recovery.get(i));
        }
        return sb.append(")").toString();
    }

    private static String joinRecovery(JSONArray arr) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < arr.length(); i++) {
            if (i > 0) sb.append(" · ");
            sb.append(arr.optString(i, ""));
        }
        return sb.toString();
    }

    /** 감시 항목의 수량 문자열 — volumePlace·sizeMultiplier 배수로 내림(지수 표기 없이) */
    private static String sizeText(JSONObject plan) {
        String exact = plan.optString("sizeStr", "");
        if (exact != null && !exact.isEmpty()) return exact;
        double qty = plan.optDouble("qty", 0);
        if (!(qty > 0)) return "";
        int vp = plan.has("qtyDecimals") ? plan.optInt("qtyDecimals", 8) : 8;
        // 감시 항목은 이미 거래소 단위로 내림된 값 — 자리수만 지켜 문자열로 만든다(배수 0 = 10^-vp).
        String floored = BitgetApi.floorToStep(qty, vp, plan.optDouble("sizeMultiplier", 0));
        return floored.isEmpty() ? trim(qty) : floored;
    }

    /**
     * 계좌 잔고 기준 수량 — `qty = equity × risk% ÷ |진입가 − 손절가|`,
     * 가용 잔고의 95% 를 넘으면 그만큼 줄인다. 계산할 수 없으면(잔고·가격 없음) 웹이 계산한 값을 쓴다.
     * 결과는 plan 사본에 `sizeStr`(거래소 단위로 내림한 문자열)로 넣는다.
     */
    private JSONObject sizeForBalance(
            JSONObject plan, double equity, double available, JSONObject config, int leverageValue) {
        try {
            double entry = plan.optDouble("entry", 0);
            double stop = plan.optDouble("stop", 0);
            double leverage = Math.max(1, leverageValue);
            double riskPct = plan.optDouble("riskPct", config == null ? 0 : config.optDouble("riskPct", 0));
            double dist = Math.abs(entry - stop);
            if (!(equity > 0) || !(entry > 0) || !(dist > 0) || !(riskPct > 0)) return plan;
            double qty = equity * riskPct / 100.0 / dist;
            double avail = available > 0 ? Math.min(available, equity) : equity;
            double maxQty = avail * BitgetApi.AVAILABLE_MARGIN_RATIO * leverage / entry;
            if (qty > maxQty) qty = maxQty;
            BitgetApi.ContractLimits lim = BitgetApi.contractLimits(plan.optString("symbol", ""));
            int vp = lim != null ? lim.volumePlace : plan.optInt("qtyDecimals", 8);
            double mult = lim != null ? lim.sizeMultiplier : plan.optDouble("sizeMultiplier", 0);
            String size = BitgetApi.floorToStep(qty, vp, mult);
            if (size.isEmpty() || !(BitgetApi.num(size) > 0)) return plan;
            JSONObject out = new JSONObject(plan.toString());
            out.put("sizeStr", size);
            out.put("qty", BitgetApi.num(size));
            out.put("qtyDecimals", vp);
            return out;
        } catch (Exception e) {
            return plan;
        }
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
