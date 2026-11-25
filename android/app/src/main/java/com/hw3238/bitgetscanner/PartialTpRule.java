package com.hw3238.bitgetscanner;

import java.util.Locale;

/**
 * 💰 50% 반익절 판단 — v1.5.6.
 *
 *  웹의 `src/lib/autotrade.ts`(`PARTIAL_TP_PROGRESS`·`PARTIAL_TP_R`·`PARTIAL_TP_SPLIT`)와 **같은 규칙**을 쓴다.
 *  실제 주문은 이 판단을 통과한 경우에만 `AutoTradeService` 가 시장가로 넣는다.
 *
 *  조건
 *    · 목표가 진행률 = (현재가 − 진입가) / (목표가 − 진입가) 가 **50% 이상** (롱·숏 방향 반영)
 *    · 또는 현재 손익 R = (현재가 − 진입가) / |진입가 − 손절가| 가 **+1.0R 이상**
 *
 *  방어
 *    · 절반을 내림한 수량이 거래소 최소 수량(minTradeNum)보다 작거나, 주문 금액이 최소 금액(minTradeUSDT, 보통 $5)보다
 *      작으면 **주문하지 않는다**(거래소 거절 방지) — 이때는 전량을 그대로 들고 간다.
 *    · 남은 절반도 최소 수량을 못 채우면 분할하지 않는다(반쪽만 남아 관리가 어려워지는 것 방지).
 *
 *  Android 의존성이 없어 `javac` 로 단위 검증한다.
 */
final class PartialTpRule {

    /** 목표가 진행률 트리거 */
    static final double PROGRESS_TRIGGER = 0.5;
    /** 손익 R 트리거 */
    static final double R_TRIGGER = 1.0;
    /** 익절 비중 — 보유의 절반 */
    static final double SPLIT = 0.5;

    private PartialTpRule() {}

    /** 손익 R — 진입가·손절가로 정규화(롱: +가 이익) */
    static double rMultiple(boolean longSide, double entry, double stop, double price) {
        if (!(entry > 0) || !(stop > 0) || !(price > 0)) return 0;
        double risk = Math.abs(entry - stop);
        if (!(risk > 0)) return 0;
        return (longSide ? price - entry : entry - price) / risk;
    }

    /** 목표가 진행률(0~1) — 목표가·방향이 어긋나면 -1(모름) */
    static double progress(boolean longSide, double entry, double target, double price) {
        if (!(entry > 0) || !(price > 0) || !(target > 0)) return -1;
        if (longSide ? !(target > entry) : !(target < entry)) return -1;
        double span = Math.abs(target - entry);
        if (!(span > 0)) return -1;
        double moved = longSide ? price - entry : entry - price;
        return Math.max(0, Math.min(1, moved / span));
    }

    /** 지금 반익절 조건(50% 진행 또는 +1.0R)에 닿았는가 */
    static boolean triggered(boolean longSide, double entry, double stop, double target, double price) {
        if (!(entry > 0) || !(price > 0)) return false;
        if (Math.abs(entry - stop) > 0 && rMultiple(longSide, entry, stop, price) >= R_TRIGGER) return true;
        return progress(longSide, entry, target, price) >= PROGRESS_TRIGGER;
    }

    static final class Plan {
        /** 지금 분할 익절을 넣어도 되는가 */
        final boolean eligible;
        /** eligible=false 사유 코드 — ok · not-triggered · no-size · min-qty · min-notional · remain-min-qty */
        final String code;
        /** 사용자에게 남길 한글 사유 */
        final String reason;
        /** 내림한 분할 수량 문자열 */
        final String qty;
        final double qtyNum;
        /** 분할 후 남는 수량 */
        final double remain;
        final double progress;
        final double r;

        Plan(boolean eligible, String code, String reason, String qty, double qtyNum, double remain,
             double progress, double r) {
            this.eligible = eligible;
            this.code = code;
            this.reason = reason;
            this.qty = qty;
            this.qtyNum = qtyNum;
            this.remain = remain;
            this.progress = progress;
            this.r = r;
        }
    }

    /**
     * 반익절 계획 — 트리거 확인 + 절반 수량을 거래소 단위로 내림 + 최소 수량/금액 검증.
     *
     * @param total          보유 수량(코인 단위)
     * @param minTradeNum    거래소 최소 주문 수량(모르면 0)
     * @param minTradeUSDT   거래소 최소 주문 금액(모르면 0)
     * @param volumePlace    수량 소수 자리
     * @param sizeMultiplier 수량 배수(없으면 0)
     */
    static Plan plan(
            boolean longSide,
            double entry,
            double stop,
            double target,
            double price,
            double total,
            double minTradeNum,
            double minTradeUSDT,
            int volumePlace,
            double sizeMultiplier) {
        double r = rMultiple(longSide, entry, stop, price);
        double p = progress(longSide, entry, target, price);
        if (!triggered(longSide, entry, stop, target, price)) {
            return new Plan(false, "not-triggered", "반익절 조건(목표가 50% · +1.0R)에 아직 닿지 않았습니다.",
                    "", 0, total, p, r);
        }
        if (!(total > 0)) {
            return new Plan(false, "no-size", "보유 수량을 확인하지 못했습니다.", "", 0, 0, p, r);
        }
        String qty = QtyStep.floor(total * SPLIT, volumePlace, sizeMultiplier);
        double qtyNum = num(qty);
        if (!(qtyNum > 0)) {
            return new Plan(false, "no-size", "분할 익절 수량이 거래소 단위보다 작습니다.", "", 0, total, p, r);
        }
        double remain = total - qtyNum;
        if (minTradeNum > 0 && qtyNum < minTradeNum - 1e-12) {
            return new Plan(false, "min-qty", String.format(Locale.US,
                    "반익절 수량 %s 이 거래소 최소 수량 %s 보다 작아 건너뜁니다.",
                    trim(qtyNum), trim(minTradeNum)), qty, qtyNum, remain, p, r);
        }
        if (minTradeUSDT > 0 && price > 0 && qtyNum * price < minTradeUSDT - 1e-9) {
            return new Plan(false, "min-notional", String.format(Locale.US,
                    "반익절 금액 $%,.2f 이 거래소 최소 금액 $%,.2f 보다 작아 건너뜁니다.",
                    qtyNum * price, minTradeUSDT), qty, qtyNum, remain, p, r);
        }
        if (remain > 1e-12 && minTradeNum > 0 && remain < minTradeNum - 1e-12) {
            return new Plan(false, "remain-min-qty", String.format(Locale.US,
                    "남는 수량 %s 이 거래소 최소 수량 %s 보다 작아 건너뜁니다.",
                    trim(remain), trim(minTradeNum)), qty, qtyNum, remain, p, r);
        }
        return new Plan(true, "ok", String.format(Locale.US,
                "%.0f%% 진행(%.2fR) — 보유 %s의 50%%인 %s 익절, %s 유지",
                p >= 0 ? p * 100 : 0, r, trim(total), trim(qtyNum), trim(remain)),
                qty, qtyNum, remain, p, r);
    }

    /** 수량 문자열 → 숫자(실패 시 0) */
    static double num(String value) {
        if (value == null || value.isEmpty()) return 0;
        try {
            return Double.parseDouble(value);
        } catch (Exception e) {
            return 0;
        }
    }

    /** 소수 꼬리 없이 — 0.0005 → "0.0005" · 2.0 → "2" */
    static String trim(double value) {
        if (!Double.isFinite(value)) return "0";
        String text = String.format(Locale.US, "%.8f", value);
        text = text.replaceAll("0+$", "");
        if (text.endsWith(".")) text = text.substring(0, text.length() - 1);
        return text.isEmpty() ? "0" : text;
    }
}
