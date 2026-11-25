package com.hw3238.bitgetscanner;

import java.util.Locale;

/**
 * 진입 구간 판정 (v1.5.7) — 웹 `src/lib/autotrade.ts` 의 `planTrigger`·`planTriggerReason` 과 **같은 규칙**.
 *
 * 예전 조건은 `현재가가 진입가 ±0.05% 안으로 터치`였다. 60초 감시에서 가격이 그 좁은 띠를 스쳐 지나가면
 * 영원히 진입하지 못했고, 시그널이 뜬 뒤 가격이 조금만 움직여도 감시 목록 전체가 '대기'로 남았다.
 *
 *   롱  : entry×0.992 ~ entry×1.005   (유리한 쪽 0.8% · 추격 0.5%)
 *   숏  : entry×0.995 ~ entry×1.008
 *  · 구간보다 유리한 쪽으로 더 벗어나도 **손익비가 기준 이상이면** 들어간다.
 *  · 손절가·목표가 방어선(0.1%)은 그대로 — 즉시 손절·TP 방향 오류를 막는다.
 *  · Android 의존성이 없어 JDK 만으로 단위 검증한다(`scripts/native/EntryZoneRuleTest.java`).
 */
public final class EntryZoneRule {

    /** 진입가보다 불리한(추격) 쪽 허용 — 롱은 위 0.5%, 숏은 아래 0.5% */
    public static final double CHASE = 0.005;
    /** 진입가보다 유리한 쪽 허용 — 롱은 아래 0.8%, 숏은 위 0.8% (넘으면 손익비로 판정) */
    public static final double FAVOR = 0.008;
    /** 현재가 기준 손익비 하한 — 이보다 나쁘면 진입하지 않는다 */
    public static final double MIN_RR = 1.0;
    /** 현재가 대비 손절가 최소 거리 0.1% — 체결 직후 손절 방지 */
    public static final double MIN_STOP_DISTANCE = 0.001;
    /** 현재가 대비 목표가 최소 여유 0.1% — 거래소 25585/25587 방지 */
    public static final double MIN_TARGET_GAP = 0.001;

    public enum Trigger {
        ENTER,
        WAIT_CHASE,
        WAIT_RR,
        INVALIDATED,
        EXPIRED,
        TARGET_PASSED,
        NEAR_STOP,
        NO_PRICE
    }

    private EntryZoneRule() {}

    public static double zoneLow(boolean longSide, double entry) {
        return longSide ? entry * (1 - FAVOR) : entry * (1 - CHASE);
    }

    public static double zoneHigh(boolean longSide, double entry) {
        return longSide ? entry * (1 + CHASE) : entry * (1 + FAVOR);
    }

    /** 현재가 기준 손익비 — 위험(현재가→손절) 대비 보상(현재가→목표). 계산 불가면 0 */
    public static double rrAtPrice(boolean longSide, double price, double stop, double target) {
        if (!(price > 0) || !(target > 0)) return 0;
        double risk = longSide ? price - stop : stop - price;
        double reward = longSide ? target - price : price - target;
        if (!(risk > 0) || !(reward > 0)) return 0;
        return reward / risk;
    }

    /** 손익비 기준 — 설정 minRR 을 넘기면 그 값을, 아니면 안전 하한 1.0R */
    public static double rrFloor(double minRR) {
        return Math.max(MIN_RR, minRR > 0 ? minRR : MIN_RR);
    }

    public static Trigger decide(
            boolean longSide,
            double entry,
            double stop,
            double target,
            double price,
            long now,
            long expiresAt,
            double minRR) {
        if (!(price > 0)) return Trigger.NO_PRICE;
        if (expiresAt > 0 && now >= expiresAt) return Trigger.EXPIRED;
        if (!(entry > 0) || !(stop > 0)) return Trigger.NO_PRICE;
        double low = zoneLow(longSide, entry);
        double high = zoneHigh(longSide, entry);
        // 경계값 부동소수 오차(100 × 1.005 = 100.4999…)로 경계에서 한 틱씩 새지 않게 아주 작은 여유를 둔다.
        double eps = Math.max(1e-12, entry * 1e-9);
        boolean inZone = price >= low - eps && price <= high + eps;
        if (longSide) {
            if (price <= stop) return Trigger.INVALIDATED;
            if (target > 0 && price >= target * (1 - MIN_TARGET_GAP)) return Trigger.TARGET_PASSED;
            if (price <= stop * (1 + MIN_STOP_DISTANCE)) return Trigger.NEAR_STOP;
            if (inZone) return Trigger.ENTER;
            if (price < low - eps && target > 0 && rrAtPrice(true, price, stop, target) >= rrFloor(minRR)) {
                return Trigger.ENTER;
            }
            return price > high ? Trigger.WAIT_CHASE : Trigger.WAIT_RR;
        }
        if (price >= stop) return Trigger.INVALIDATED;
        if (target > 0 && price <= target * (1 + MIN_TARGET_GAP)) return Trigger.TARGET_PASSED;
        if (price >= stop * (1 - MIN_STOP_DISTANCE)) return Trigger.NEAR_STOP;
        if (inZone) return Trigger.ENTER;
        if (price > high + eps && target > 0 && rrAtPrice(false, price, stop, target) >= rrFloor(minRR)) {
            return Trigger.ENTER;
        }
        return price < low ? Trigger.WAIT_CHASE : Trigger.WAIT_RR;
    }

    /** 감시 주기 로그용 한글 사유 — 사용자가 "왜 안 들어갔는지" 바로 읽게 */
    public static String reason(
            String base,
            boolean longSide,
            double entry,
            double stop,
            double target,
            double price,
            long now,
            long expiresAt,
            double minRR) {
        Trigger trigger = decide(longSide, entry, stop, target, price, now, expiresAt, minRR);
        String sideKo = longSide ? "롱" : "숏";
        double low = zoneLow(longSide, entry);
        double high = zoneHigh(longSide, entry);
        double floor = rrFloor(minRR);
        switch (trigger) {
            case ENTER:
                return String.format(Locale.US, "%s %s 진입 조건 충족 — 현재가 %s 진입 구간 %s~%s (손익비 %.2fR)",
                        base, sideKo, trim(price), trim(low), trim(high), rrAtPrice(longSide, price, stop, target));
            case EXPIRED:
                return String.format(Locale.US, "%s 진입 대기 만료 — 유효시간이 지나 감시에서 제외합니다 (현재가 %s)",
                        base, trim(price));
            case INVALIDATED:
                return String.format(Locale.US, "%s 셋업 무효 — 현재가 %s 가 손절가 %s 를 먼저 깼습니다",
                        base, trim(price), trim(stop));
            case TARGET_PASSED:
                return String.format(Locale.US, "%s 진입 건너뜀 — 현재가 %s 가 이미 목표가 %s 에 닿았습니다",
                        base, trim(price), trim(target));
            case NEAR_STOP:
                return String.format(Locale.US, "%s 진입 건너뜀 — 현재가 %s 가 손절가 %s 에 0.1%% 이내로 붙었습니다",
                        base, trim(price), trim(stop));
            case NO_PRICE:
                return base + " 시세를 받지 못해 다음 주기에 다시 확인합니다.";
            case WAIT_CHASE:
            default: {
                if (longSide) {
                    double gap = (price - high) / (entry == 0 ? 1 : entry);
                    return String.format(Locale.US,
                            "%s 롱 진입가 대기 중 — 현재가 %s 가 진입 상단 %s 보다 %.2f%% 위(추격 금지). 구간 %s~%s",
                            base, trim(price), trim(high), gap * 100, trim(low), trim(high));
                }
                double gap = (low - price) / (entry == 0 ? 1 : entry);
                return String.format(Locale.US,
                        "%s 숏 진입가 대기 중 — 현재가 %s 가 진입 하단 %s 보다 %.2f%% 아래(추격 금지). 구간 %s~%s",
                        base, trim(price), trim(low), gap * 100, trim(low), trim(high));
            }
            case WAIT_RR:
                return String.format(Locale.US,
                        "%s %s 진입가 대기 중 — 현재가 %s 는 유리한 자리지만 손익비 %.2fR < 기준 %.1fR",
                        base, sideKo, trim(price), rrAtPrice(longSide, price, stop, target), floor);
        }
    }

    /** 로그용 가격 — 지수 표기 없이 최대 8자리, 꼬리 0 제거 */
    static String trim(double v) {
        if (!(v > 0)) return "0";
        String s = String.format(Locale.US, "%.8f", v);
        s = s.replaceAll("0+$", "");
        return s.endsWith(".") ? s.substring(0, s.length() - 1) : s;
    }
}
