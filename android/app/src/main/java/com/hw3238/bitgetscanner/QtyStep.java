package com.hw3238.bitgetscanner;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * 수량 → 거래소 주문 단위로 **내림** — v1.5.6 에서 순수 계산만 따로 꺼냈다.
 *
 *  · 단위 = max(10^-volumePlace, sizeMultiplier)
 *    BTC(volumePlace=4 · 0.0001) → 0.0001 · MSTR(2 · 0.01) → 0.01 · (0 · 10) → 10
 *  · 내림이므로 계획한 리스크를 넘기지 않는다(올림하면 손실이 커진다).
 *  · 지수 표기(1e-5) 없이 고정 소수로 쓴다 — 비트겟이 `1e-5` 문자열을 거절한다.
 *  · 웹 `autotrade.ts#qtyToStep` 과 같은 규칙이다.
 *
 * Android 의존성이 없어 `javac` 로 단위 검증할 수 있다(`BitgetApi.floorToStep` 이 이 함수를 부른다).
 */
final class QtyStep {

    private QtyStep() {}

    /**
     * @return 내림한 수량 문자열(0 이하면 빈 문자열)
     */
    static String floor(double qty, int volumePlace, double sizeMultiplier) {
        if (!(qty > 0) || !Double.isFinite(qty)) return "";
        int vp = Math.max(0, Math.min(8, volumePlace));
        BigDecimal scale = BigDecimal.TEN.pow(vp);
        BigDecimal mult = BigDecimal.valueOf(
                sizeMultiplier > 0 && Double.isFinite(sizeMultiplier) ? sizeMultiplier : 0);
        // 10^-vp 단위의 개수로 환산한 최소 주문 단위(1 이상 정수)
        BigDecimal stepUnits = mult.multiply(scale).setScale(0, RoundingMode.HALF_UP);
        if (stepUnits.signum() <= 0) stepUnits = BigDecimal.ONE;
        BigDecimal units = BigDecimal.valueOf(qty).multiply(scale).divide(stepUnits, 0, RoundingMode.FLOOR);
        if (units.signum() <= 0) return "";
        BigDecimal value = units.multiply(stepUnits);
        return new BigDecimal(value.toBigIntegerExact(), vp).stripTrailingZeros().toPlainString();
    }
}
