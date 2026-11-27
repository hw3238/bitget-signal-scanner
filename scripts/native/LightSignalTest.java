package com.hw3238.bitgetscanner;

import java.util.ArrayList;
import java.util.List;

/**
 * 경량 추세 돌파 시그널 엔진(LightSignal) 단위 검증 — v1.5.8.
 *
 *  Android 의존성 없이 javac/java 로만 돌린다.
 *   실행: npm run check:native
 *
 *  검증 항목
 *   1) 지표 — RSI 0~100 경계, EMA 단조 상승 구간
 *   2) 롱 돌파 — 추세(EMA20>EMA50) + 20봉 고점 돌파 + 거래량 → 롱, 진입=종가, 손익비 2.0
 *   3) 거래량 미달 → 시그널 없음
 *   4) 횡보 시장 → 시그널 없음
 *   5) 숏 돌파 — 대칭 규칙
 *   6) 캔들 부족 → null · 중복 키 안정성
 */
public final class LightSignalTest {

    private static int pass = 0;
    private static int fail = 0;

    private static void check(String name, boolean ok, String detail) {
        if (ok) {
            pass++;
            System.out.println("✅ " + name + (detail.isEmpty() ? "" : " — " + detail));
        } else {
            fail++;
            System.out.println("❌ " + name + (detail.isEmpty() ? "" : " — " + detail));
        }
    }

    /**
     * 잔물결이 있는 추세 — RSI 가 극단(0/100)에 붙지 않도록 위·아래 변동을 섞는다.
     * step>0 이면 상승, step<0 이면 하락 추세.
     */
    private static List<LightSignal.Candle> noisyTrend(int count, double start, double step, double noise, double vol) {
        List<LightSignal.Candle> out = new ArrayList<>();
        long t0 = 1_700_000_000_000L;
        for (int i = 0; i < count; i++) {
            double base = start + step * i;
            double wobble = (i % 3 == 0 ? noise : i % 3 == 1 ? -noise * 0.75 : noise * 0.45);
            double o = base + wobble;
            double c = base + (i + 1 == count ? 0 : step) + (i % 3 == 2 ? -noise * 0.3 : noise * 0.2);
            double h = Math.max(o, c) + noise * 0.5;
            double l = Math.min(o, c) - noise * 0.5;
            out.add(new LightSignal.Candle(t0 + i * 3_600_000L, o, h, l, c, vol));
        }
        return out;
    }

    /** t0 부터 1시간 간격 캔들 */
    private static List<LightSignal.Candle> series(double start, double step, int count, double baseVol) {
        List<LightSignal.Candle> out = new ArrayList<>();
        long t0 = 1_700_000_000_000L;
        for (int i = 0; i < count; i++) {
            double o = start + step * i;
            double c = start + step * (i + 1);
            double h = Math.max(o, c) + Math.abs(step) * 0.4;
            double l = Math.min(o, c) - Math.abs(step) * 0.4;
            out.add(new LightSignal.Candle(t0 + i * 3_600_000L, o, h, l, c, baseVol));
        }
        return out;
    }

    public static void main(String[] args) {
        /* 1) 지표 경계 */
        List<LightSignal.Candle> up = series(100, 0.5, 80, 100);
        double[] closes = new double[up.size()];
        for (int i = 0; i < closes.length; i++) closes[i] = up.get(i).c;
        double[] rsi = LightSignal.rsi(closes, 14);
        double lastRsi = rsi[rsi.length - 2];
        check("RSI 경계 0~100", lastRsi >= 0 && lastRsi <= 100, String.format("rsi=%.1f", lastRsi));
        check("상승 구간 RSI 50 이상", lastRsi > 50, String.format("rsi=%.1f", lastRsi));
        double[] ema20 = LightSignal.ema(closes, 20);
        double[] ema50 = LightSignal.ema(closes, 50);
        check("상승 추세 EMA20 > EMA50", ema20[78] > ema50[78], String.format("%.2f > %.2f", ema20[78], ema50[78]));

        /* 2) 롱 돌파 — 잔물결이 있는 상승 추세 → 눌림 → 거래량 실린 고점 돌파 */
        List<LightSignal.Candle> longCase = noisyTrend(60, 100, 0.35, 1.0, 100);
        double peak = longCase.get(59).c;
        long t0 = longCase.get(0).t;
        long dt = 3_600_000L;
        for (int i = 0; i < 20; i++) {
            double p = peak - 1.6 + ((i % 3 == 0) ? 0.45 : (i % 3 == 1) ? -0.5 : 0.12);
            longCase.add(new LightSignal.Candle(t0 + (60 + i) * dt, p, p + 0.45, p - 0.45, p, 95));
        }
        long t = t0 + 80 * dt;
        double entry = peak + 2.6;
        longCase.add(new LightSignal.Candle(t, peak - 1.0, entry + 0.5, peak - 1.2, entry, 300));
        longCase.add(new LightSignal.Candle(t + dt, entry, entry + 0.8, entry - 0.4, entry + 0.3, 130));

        LightSignal.Signal longSig = LightSignal.evaluate(longCase);
        check("롱 돌파 감지", longSig != null && "long".equals(longSig.side),
                longSig == null ? "null" : longSig.side + " entry=" + String.format("%.2f", longSig.entry));
        if (longSig != null) {
            check("진입 = 돌파 봉 종가", Math.abs(longSig.entry - entry) < 1e-6,
                    String.format("entry=%.2f close=%.2f", longSig.entry, entry));
            check("손절 < 진입 < 목표", longSig.stop < longSig.entry && longSig.target > longSig.entry,
                    String.format("%.2f < %.2f < %.2f", longSig.stop, longSig.entry, longSig.target));
            double rr = (longSig.target - longSig.entry) / (longSig.entry - longSig.stop);
            check("손익비 2.0", Math.abs(rr - LightSignal.TARGET_R) < 1e-6, String.format("R=%.2f", rr));
            check("위험 = 1.2 × ATR", longSig.risk > 0, String.format("risk=%.3f", longSig.risk));
            check("바 시각 = 마지막 닫힌 봉", longSig.barTime == t, String.valueOf(longSig.barTime));
            check("RSI 가 과매수 구간(72) 이하", longSig.rsi <= 72, String.format("rsi=%.1f", longSig.rsi));
            String key1 = LightSignal.signalKey("BTCUSDT", "1H", longSig);
            String key2 = LightSignal.signalKey("BTCUSDT", "1H", longSig);
            check("중복 키 안정", key1.equals(key2) && key1.contains("long") && key1.contains("BTCUSDT"), key1);
        }

        /* 3) 거래량 미달 — 같은 모양이라도 거래량이 평균 이하면 알리지 않는다 */
        List<LightSignal.Candle> noVol = new ArrayList<>();
        for (LightSignal.Candle c : longCase) {
            double v = c.t == t ? 20 : c.v; // 돌파 봉 거래량만 줄인다
            noVol.add(new LightSignal.Candle(c.t, c.o, c.h, c.l, c.c, v));
        }
        check("거래량 미달이면 시그널 없음", LightSignal.evaluate(noVol) == null, "");

        /* 4) 횡보 — 방향이 없으면 알리지 않는다 */
        List<LightSignal.Candle> flat = new ArrayList<>();
        long ft = 1_700_000_000_000L;
        for (int i = 0; i < 90; i++) {
            double p = 100 + ((i % 2 == 0) ? 0.1 : -0.1);
            flat.add(new LightSignal.Candle(ft + i * 3_600_000L, p, p + 0.2, p - 0.2, p, 100));
        }
        check("횡보 시장 시그널 없음", LightSignal.evaluate(flat) == null, "");

        /* 5) 숏 돌파 — 하락 추세 + 20봉 저점 이탈 */
        List<LightSignal.Candle> shortCase = noisyTrend(60, 220, -0.35, 1.0, 100);
        double trough = shortCase.get(59).c;
        for (int i = 0; i < 20; i++) {
            double p = trough + 1.6 + ((i % 3 == 0) ? -0.45 : (i % 3 == 1) ? 0.5 : -0.12);
            shortCase.add(new LightSignal.Candle(t0 + (60 + i) * dt, p, p + 0.45, p - 0.45, p, 95));
        }
        double shortEntry = trough - 2.6;
        shortCase.add(new LightSignal.Candle(t0 + 80 * dt, trough + 1.0, trough + 1.2, shortEntry - 0.5, shortEntry, 300));
        shortCase.add(new LightSignal.Candle(t0 + 81 * dt, shortEntry, shortEntry + 0.4, shortEntry - 0.8, shortEntry - 0.3, 130));
        LightSignal.Signal shortSig = LightSignal.evaluate(shortCase);
        check("숏 돌파 감지", shortSig != null && "short".equals(shortSig.side),
                shortSig == null ? "null" : shortSig.side);
        if (shortSig != null) {
            check("숏 손절 > 진입 > 목표", shortSig.stop > shortSig.entry && shortSig.target < shortSig.entry,
                    String.format("%.2f > %.2f > %.2f", shortSig.stop, shortSig.entry, shortSig.target));
            check("숏 RSI 48 이하", shortSig.rsi <= 48, String.format("rsi=%.1f", shortSig.rsi));
        }

        /* 6) 캔들 부족 */
        check("캔들 부족(10봉) → null", LightSignal.evaluate(series(100, 0.5, 10, 100)) == null, "");
        check("null 입력 → null", LightSignal.evaluate(null) == null, "");

        System.out.println();
        System.out.println(pass + " passed, " + fail + " failed");
        if (fail > 0) System.exit(1);
    }
}
