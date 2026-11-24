package com.hw3238.bitgetscanner;

import java.util.Locale;

/**
 * 🛡 SL 도달 전 선제 청산 판단 — v1.5.4.
 *
 *  웹의 `src/lib/earlyStop.ts` 와 **같은 규칙**을 쓴다. 실제 청산은 이 판단을 통과한 경우에만
 *  `AutoTradeService` 가 시장가로 넣는다.
 *
 *  세 가지 경우만 청산한다:
 *   1) 반대 시그널 — 포지션을 연 뒤 같은 종목에 반대 방향 시그널이 새로 포착됨
 *   2) 구조 붕괴 — 마지막 **마감된** 캔들이 반대쪽 장대봉으로 EMA9·진입가를 함께 이탈
 *   3) 본절 보호 — +0.8R 이상 갔던 포지션이 본절 부근으로 되돌아옴
 *
 *  휩쏘 방지: 진입 2분 보호 · 마감 캔들만 사용 · 장대봉(평균 몸통 1.3배·가격 대비 0.15%) 요구 ·
 *  손절가 −0.95R 이내는 거래소 SL 에 맡김 · 같은 종목 5분 쿨다운(서비스 쪽).
 */
final class EarlyStopRule {

    static final long MIN_AGE_MS = 120_000L;
    static final long SIGNAL_MAX_AGE_MS = 6 * 3_600_000L;
    static final long COOLDOWN_MS = 5 * 60_000L;
    static final double BODY_MULT = 1.3;
    static final double MIN_BODY_PCT = 0.0015;

    static final class Decision {
        final boolean exit;
        final String code;
        final String reason;
        final double currentR;

        Decision(boolean exit, String code, String reason, double currentR) {
            this.exit = exit;
            this.code = code;
            this.reason = reason;
            this.currentR = currentR;
        }

        static Decision no(String code, String reason, double currentR) {
            return new Decision(false, code, reason, currentR);
        }
    }

    private EarlyStopRule() {}

    /** 손익 R — 진입가·손절가로 정규화(롱: +가 이익) */
    static double rMultiple(boolean longSide, double entry, double stop, double price) {
        if (!(entry > 0) || !(stop > 0) || !(price > 0)) return 0;
        double risk = Math.abs(entry - stop);
        if (!(risk > 0)) return 0;
        return (longSide ? price - entry : entry - price) / risk;
    }

    static double ema(double[] values, int period) {
        if (values == null || values.length == 0) return 0;
        double k = 2.0 / (period + 1.0);
        double ema = values[0];
        for (int i = 1; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
        return ema;
    }

    /**
     * @param candles 오래된 → 최신 순 **마감** 캔들(최소 12개) — 각 {open, high, low, close}
     */
    static Decision decide(
            boolean enabled,
            boolean longSide,
            double entry,
            double stop,
            double price,
            long openedAt,
            long now,
            double peakR,
            long oppositeSignalAt,
            double[][] candles) {
        double r = rMultiple(longSide, entry, stop, price);
        if (!enabled) return Decision.no("off", "조기 손절 보호가 꺼져 있습니다.", r);
        if (!(entry > 0) || !(stop > 0) || !(price > 0)) return Decision.no("none", "진입가·손절가·현재가를 확인하지 못했습니다.", r);
        if (longSide ? price <= stop : price >= stop) return Decision.no("near-stop", "손절가에 이미 닿아 SL 처리에 맡깁니다.", r);
        if (r <= -0.95) return Decision.no("near-stop", "손절가 −0.95R 이내 — SL 처리에 맡깁니다.", r);
        if (now - openedAt < MIN_AGE_MS) return Decision.no("too-early", "진입 직후 2분 보호 구간입니다.", r);

        if (oppositeSignalAt > openedAt && now - oppositeSignalAt <= SIGNAL_MAX_AGE_MS && r < 0.3) {
            return new Decision(true, "opposite-signal", "반대 방향 시그널 감지", r);
        }

        int n = candles == null ? 0 : candles.length;
        if (n >= 12) {
            double[] last = candles[n - 1];
            double sum = 0;
            int cnt = 0;
            for (int i = n - 11; i < n - 1; i++) {
                sum += Math.abs(candles[i][3] - candles[i][0]);
                cnt++;
            }
            double avgBody = cnt > 0 ? sum / cnt : 0;
            double body = Math.abs(last[3] - last[0]);
            int from = Math.max(0, n - 30);
            double[] closes = new double[n - from];
            for (int i = from; i < n; i++) closes[i - from] = candles[i][3];
            double ema9 = ema(closes, 9);
            boolean against = longSide ? last[3] < last[0] : last[3] > last[0];
            boolean strong = avgBody > 0 && body >= avgBody * BODY_MULT && body / last[3] >= MIN_BODY_PCT;
            boolean beyondEma = longSide ? last[3] < ema9 * (1 - 0.0005) : last[3] > ema9 * (1 + 0.0005);
            boolean inLoss = longSide ? last[3] < entry : last[3] > entry;
            if (against && strong && beyondEma && inLoss && r <= -0.1) {
                return new Decision(true, "structure-break",
                        "추세 구조 이탈 — " + (longSide ? "음봉" : "양봉") + " 마감이 진입가·EMA9을 함께 이탈", r);
            }
        }

        if (peakR >= 0.8 && r <= 0.05 && r > -0.4) {
            return new Decision(true, "breakeven",
                    String.format(Locale.US, "본절 보호 — 최대 +%.2fR → %.2fR", peakR, r), r);
        }
        return Decision.no("none", "조기 손절 조건에 해당하지 않습니다.", r);
    }
}
