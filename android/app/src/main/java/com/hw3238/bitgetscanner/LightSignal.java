package com.hw3238.bitgetscanner;

import java.util.List;

/**
 * 🚀 경량 추세 돌파 시그널 엔진 (v1.5.8 · 자바 이식).
 *
 * 왜 따로 있나
 *  · 웹의 6전략 엔진(`src/engine/strategies.ts`)은 캔들·구조·FVG 등 계산이 무거워 60초 주기 백그라운드
 *    감시에 그대로 쓰기 어렵다. 그래서 **추세·돌파·거래량**만 남긴 경량 규칙을 자바로 옮겼다.
 *  · 웹의 '전략 시그널'과 완전히 같은 신호는 아니다(웹은 6전략 하이브리드). 알림 문구에도
 *    `추세 돌파(경량)` 이라고 적어 어느 엔진인지 밝힌다.
 *
 * 규칙 (마지막 '닫힌' 봉 기준 — 진행 중인 봉은 쓰지 않는다)
 *  롱  : 종가 > EMA50 · EMA20 > EMA50 · 종가 > 직전 20봉 최고가 · RSI14 52~72 · 거래량 ≥ 직전 20봉 평균
 *  숏  : 종가 < EMA50 · EMA20 < EMA50 · 종가 < 직전 20봉 최저가 · RSI14 28~48 · 거래량 ≥ 직전 20봉 평균
 *  진입 = 종가, 손절 = 진입 ∓ 1.2×ATR14, 목표 = 진입 ± 2.0×위험 (손익비 2.0)
 *
 * Android 의존성이 없다 — `npm run check:native` 가 javac 로 컴파일해 단위 검증한다.
 */
public final class LightSignal {

    /** 캔들 1개 — 거래소 응답의 [ts, open, high, low, close, volume] */
    public static final class Candle {
        public final long t;
        public final double o;
        public final double h;
        public final double l;
        public final double c;
        public final double v;

        public Candle(long t, double o, double h, double l, double c, double v) {
            this.t = t;
            this.o = o;
            this.h = h;
            this.l = l;
            this.c = c;
            this.v = v;
        }
    }

    /** 감지된 시그널 — 알림 문구와 중복 키를 만드는 데 필요한 값만 */
    public static final class Signal {
        public final String side; // "long" | "short"
        public final double entry;
        public final double stop;
        public final double target;
        public final double risk;
        public final double rsi;
        public final long barTime;
        public final String reason;

        public Signal(String side, double entry, double stop, double target, double risk, double rsi, long barTime, String reason) {
            this.side = side;
            this.entry = entry;
            this.stop = stop;
            this.target = target;
            this.risk = risk;
            this.rsi = rsi;
            this.barTime = barTime;
            this.reason = reason;
        }
    }

    /** 최소 캔들 수 — EMA50 + 직전 20봉 + 여유 */
    public static final int MIN_CANDLES = 60;
    public static final double ATR_STOP_MULT = 1.2;
    public static final double TARGET_R = 2.0;

    private LightSignal() {
    }

    /** 지수이동평균 — 첫 값은 단순평균으로 시작(웹 indicators.ema 와 같은 방식) */
    public static double[] ema(double[] values, int period) {
        double[] out = new double[values.length];
        if (values.length == 0) return out;
        double k = 2.0 / (period + 1.0);
        double prev = values[0];
        out[0] = prev;
        for (int i = 1; i < values.length; i++) {
            prev = values[i] * k + prev * (1 - k);
            out[i] = prev;
        }
        return out;
    }

    /** RSI(14) — Wilder 평활 */
    public static double[] rsi(double[] closes, int period) {
        double[] out = new double[closes.length];
        for (int i = 0; i < out.length; i++) out[i] = Double.NaN;
        if (closes.length <= period) return out;
        double gain = 0;
        double loss = 0;
        for (int i = 1; i <= period; i++) {
            double d = closes[i] - closes[i - 1];
            if (d >= 0) gain += d;
            else loss -= d;
        }
        gain /= period;
        loss /= period;
        out[period] = loss == 0 ? 100 : 100 - 100 / (1 + gain / loss);
        for (int i = period + 1; i < closes.length; i++) {
            double d = closes[i] - closes[i - 1];
            double g = d > 0 ? d : 0;
            double l = d < 0 ? -d : 0;
            gain = (gain * (period - 1) + g) / period;
            loss = (loss * (period - 1) + l) / period;
            out[i] = loss == 0 ? 100 : 100 - 100 / (1 + gain / loss);
        }
        return out;
    }

    /** ATR(14) — True Range 의 Wilder 평활 */
    public static double[] atr(List<Candle> candles, int period) {
        int n = candles.size();
        double[] out = new double[n];
        for (int i = 0; i < n; i++) out[i] = Double.NaN;
        if (n < period) return out;
        double[] tr = new double[n];
        for (int i = 0; i < n; i++) {
            Candle c = candles.get(i);
            tr[i] = i == 0
                    ? c.h - c.l
                    : Math.max(c.h - c.l, Math.max(Math.abs(c.h - candles.get(i - 1).c), Math.abs(c.l - candles.get(i - 1).c)));
        }
        double sum = 0;
        for (int i = 0; i < period; i++) sum += tr[i];
        out[period - 1] = sum / period;
        for (int i = period; i < n; i++) {
            out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
        }
        return out;
    }

    /**
     * 시그널 판정 — 캔들은 **오래된 순**으로 정렬돼 있어야 한다.
     * 조건을 만족하지 못하면 null.
     */
    public static Signal evaluate(List<Candle> candles) {
        if (candles == null || candles.size() < MIN_CANDLES) return null;
        int n = candles.size();
        int i = n - 2; // 마지막 닫힌 봉
        double[] closes = new double[n];
        for (int k = 0; k < n; k++) closes[k] = candles.get(k).c;
        double[] ema20 = ema(closes, 20);
        double[] ema50 = ema(closes, 50);
        double[] rsi14 = rsi(closes, 14);
        double[] atr14 = atr(candles, 14);

        double close = closes[i];
        double rsiValue = rsi14[i];
        double atrValue = atr14[i];
        if (!(close > 0) || !finite(ema20[i]) || !finite(ema50[i]) || !finite(rsiValue) || !(atrValue > 0)) return null;

        double hi = -Double.MAX_VALUE;
        double lo = Double.MAX_VALUE;
        double volSum = 0;
        for (int k = i - 20; k < i; k++) {
            Candle c = candles.get(k);
            if (c.h > hi) hi = c.h;
            if (c.l < lo) lo = c.l;
            volSum += c.v;
        }
        double volAvg = volSum / 20.0;
        double vol = candles.get(i).v;
        boolean volumeOk = volAvg > 0 ? vol >= volAvg : true;

        boolean longTrend = close > ema50[i] && ema20[i] > ema50[i];
        boolean shortTrend = close < ema50[i] && ema20[i] < ema50[i];

        if (longTrend && close > hi && rsiValue >= 52 && rsiValue <= 72 && volumeOk) {
            double risk = ATR_STOP_MULT * atrValue;
            return new Signal(
                    "long",
                    close,
                    close - risk,
                    close + TARGET_R * risk,
                    risk,
                    rsiValue,
                    candles.get(i).t,
                    "EMA20>EMA50 · 20봉 고점 돌파 · RSI " + String.format(java.util.Locale.US, "%.1f", rsiValue)
                            + " · 거래량 " + String.format(java.util.Locale.US, "%.2f", volAvg > 0 ? vol / volAvg : 1) + "배");
        }
        if (shortTrend && close < lo && rsiValue >= 28 && rsiValue <= 48 && volumeOk) {
            double risk = ATR_STOP_MULT * atrValue;
            return new Signal(
                    "short",
                    close,
                    close + risk,
                    close - TARGET_R * risk,
                    risk,
                    rsiValue,
                    candles.get(i).t,
                    "EMA20<EMA50 · 20봉 저점 이탈 · RSI " + String.format(java.util.Locale.US, "%.1f", rsiValue)
                            + " · 거래량 " + String.format(java.util.Locale.US, "%.2f", volAvg > 0 ? vol / volAvg : 1) + "배");
        }
        return null;
    }

    /** 중복 방지 키 — 같은 봉에서 같은 방향 시그널은 한 번만 */
    public static String signalKey(String symbol, String tf, Signal signal) {
        return "sig:" + symbol + "|" + tf + "|" + signal.side + "|" + signal.barTime;
    }

    private static boolean finite(double v) {
        return !Double.isNaN(v) && !Double.isInfinite(v);
    }
}
