package com.hw3238.bitgetscanner;

/**
 * 네이티브 반익절·수량 단위 단위 검증 — v1.5.6.
 *
 *  Android 의존성이 없는 순수 계산 클래스만 `javac` 로 컴파일해 실행한다.
 *   실행: npm run check:native
 *
 *  검증 항목
 *   1) QtyStep.floor — 거래소 수량 단위 내림(웹 qtyToStep 과 같은 결과)
 *   2) PartialTpRule.triggered — 목표가 50% / +1.0R 트리거(롱·숏)
 *   3) PartialTpRule.plan — 절반 수량 내림 · 최소 수량/최소 금액($5) 보류
 *   4) EarlyStopRule — 반익절 완료 포지션의 본절 보호 기준 강화(+0.05R)
 */
public final class PartialTpRuleTest {

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

    public static void main(String[] args) {
        /* 1) 수량 단위 내림 — BitgetApi.floorToStep 과 동일(위임) */
        check("수량 내림: BTC 0.00055 → 0.0005", "0.0005".equals(QtyStep.floor(0.00055, 4, 0.0001)), QtyStep.floor(0.00055, 4, 0.0001));
        check("수량 내림: MSTR 1.2345 → 1.23", "1.23".equals(QtyStep.floor(1.2345, 2, 0.01)), QtyStep.floor(1.2345, 2, 0.01));
        check("수량 내림: 배수 10 은 20 으로", "20".equals(QtyStep.floor(25, 0, 10)), QtyStep.floor(25, 0, 10));
        check("수량 내림: 배수 없음 0.024 → 0.024", "0.024".equals(QtyStep.floor(0.024, 4, 0)), QtyStep.floor(0.024, 4, 0));
        check("수량 내림: 0 이하는 빈 문자열", QtyStep.floor(0, 4, 0).isEmpty() && QtyStep.floor(-1, 4, 0).isEmpty(), "");

        /* 2) 트리거 — 롱 */
        check("롱: 목표 50% 도달 → 반익절", PartialTpRule.triggered(true, 100, 95, 110, 105), "progress=0.5");
        check("롱: 40%·0.8R 은 아직", !PartialTpRule.triggered(true, 100, 95, 110, 104), "progress=0.4");
        check("롱: +1.0R 이면 목표가 멀어도 반익절", PartialTpRule.triggered(true, 100, 95, 130, 105), "r=1.0");
        check("롱: 목표가 없어도 +1.0R 로 판단", PartialTpRule.triggered(true, 100, 95, 0, 105.1), "r=1.02");
        /* 숏 */
        check("숏: 목표 50% 도달 → 반익절", PartialTpRule.triggered(false, 100, 105, 90, 95), "progress=0.5");
        check("숏: 40%·0.8R 은 아직", !PartialTpRule.triggered(false, 100, 105, 90, 96), "progress=0.4");
        check("숏: +1.0R 이면 반익절", PartialTpRule.triggered(false, 100, 105, 70, 95), "r=1.0");

        /* 3) 계획 — 절반 수량 내림·최소 수량/금액 */
        PartialTpRule.Plan normal = PartialTpRule.plan(true, 100, 95, 110, 106, 1, 0.001, 5, 4, 0.0001);
        check("계획: 보유 1의 절반 0.5 익절", normal.eligible && "0.5".equals(normal.qty) && Math.abs(normal.remain - 0.5) < 1e-9,
                normal.code + " qty=" + normal.qty + " remain=" + normal.remain);
        check("계획: 진행률·R 사유에 포함", normal.reason.contains("60%") && normal.reason.contains("익절"), normal.reason);

        PartialTpRule.Plan tooSmall = PartialTpRule.plan(true, 100, 95, 110, 106, 0.001, 0.001, 5, 4, 0.0001);
        check("계획: 절반이 최소 수량 미만이면 보류", !tooSmall.eligible && "min-qty".equals(tooSmall.code), tooSmall.reason);

        PartialTpRule.Plan tooCheap = PartialTpRule.plan(true, 100, 95, 110, 106, 0.05, 0.001, 5, 2, 0.01);
        check("계획: 금액 $5 미만이면 보류", !tooCheap.eligible && "min-notional".equals(tooCheap.code), tooCheap.reason);

        PartialTpRule.Plan notYet = PartialTpRule.plan(true, 100, 95, 110, 102, 1, 0.001, 5, 4, 0.0001);
        check("계획: 트리거 전이면 보류", !notYet.eligible && "not-triggered".equals(notYet.code), notYet.reason);

        /* 4) 조기 손절 — 반익절 완료 포지션의 본절 보호 강화 */
        long now = 10_000_000L;
        long opened = now - 10 * 60_000L; // 2분 보호 구간 통과
        double[][] candles = new double[0][];
        EarlyStopRule.Decision before = EarlyStopRule.decide(
                true, true, 100, 95, 100.1, opened, now, 1.2, 0, candles, false);
        EarlyStopRule.Decision after = EarlyStopRule.decide(
                true, true, 100, 95, 100.1, opened, now, 1.2, 0, candles, true);
        check("반익절 전: 본절 보호(기존 기준)", before.exit && "breakeven".equals(before.code), before.code);
        check("반익절 후: 본절 보호 강화(+0.05R)", after.exit && "partial-breakeven".equals(after.code), after.code);
        check("반익절 후 사유 문구", after.reason.contains("반익절 후 본절 보호"), after.reason);

        EarlyStopRule.Decision stillUp = EarlyStopRule.decide(
                true, true, 100, 95, 100.4, opened, now, 1.2, 0, candles, true);
        check("반익절 후라도 +0.08R 이면 들고 간다", !stillUp.exit, stillUp.code);

        EarlyStopRule.Decision oldCall = EarlyStopRule.decide(
                true, true, 100, 95, 100.1, opened, now, 1.2, 0, candles);
        check("기존 시그니처(반익절 인자 없음)도 동작", oldCall.exit && "breakeven".equals(oldCall.code), oldCall.code);

        System.out.println();
        System.out.println("네이티브 반익절 단위 검증: " + pass + "/" + (pass + fail) + " 통과");
        if (fail > 0) System.exit(1);
    }
}
