package com.hw3238.bitgetscanner;

/** 진입 구간 판정 단위 검증 — 웹 `planTrigger` 와 같은 규칙인지(경계값 포함) 확인한다. */
public final class EntryZoneRuleTest {

    private static int pass = 0;
    private static final java.util.List<String> fails = new java.util.ArrayList<>();

    private static void check(String name, boolean ok) {
        check(name, ok, "");
    }

    private static void check(String name, boolean ok, String detail) {
        if (ok) {
            pass += 1;
            System.out.println("✅ " + name + (detail == null || detail.isEmpty() ? "" : " — " + detail));
        } else {
            fails.add(name);
            System.out.println("❌ " + name + (detail == null || detail.isEmpty() ? "" : " — " + detail));
        }
    }

    private static final long NOW = 1_700_000_000_000L;
    private static final long TTL = NOW + 3_600_000L;

    private static EntryZoneRule.Trigger t(boolean longSide, double entry, double stop, double target, double price) {
        return EntryZoneRule.decide(longSide, entry, stop, target, price, NOW, TTL, EntryZoneRule.MIN_RR);
    }

    public static void main(String[] args) {
        // 0) 상수 — 웹 ENTRY_CHASE·ENTRY_FAVOR·MIN_ENTRY_RR 과 같다
        check("상수: 추격 0.5% · 유리 0.8% · 최소 손익비 1.0R",
                EntryZoneRule.CHASE == 0.005 && EntryZoneRule.FAVOR == 0.008 && EntryZoneRule.MIN_RR == 1.0,
                EntryZoneRule.CHASE + " / " + EntryZoneRule.FAVOR + " / " + EntryZoneRule.MIN_RR);
        check("구간: 롱 99.2~100.5 · 숏 99.5~100.8",
                Math.abs(EntryZoneRule.zoneLow(true, 100) - 99.2) < 1e-9
                        && Math.abs(EntryZoneRule.zoneHigh(true, 100) - 100.5) < 1e-9
                        && Math.abs(EntryZoneRule.zoneLow(false, 100) - 99.5) < 1e-9
                        && Math.abs(EntryZoneRule.zoneHigh(false, 100) - 100.8) < 1e-9,
                EntryZoneRule.zoneLow(true, 100) + "~" + EntryZoneRule.zoneHigh(true, 100));

        // 1) 롱 — 진입 구간
        check("롱: 진입가 정확히 → ENTER", t(true, 100, 95, 115, 100) == EntryZoneRule.Trigger.ENTER);
        check("롱: 진입가 +0.5%(경계) → ENTER", t(true, 100, 95, 115, 100.5) == EntryZoneRule.Trigger.ENTER);
        check("롱: 진입가 −0.8%(경계) → ENTER", t(true, 100, 95, 115, 99.2) == EntryZoneRule.Trigger.ENTER);
        check("롱: 진입가 +0.51% → 대기(추격 금지)", t(true, 100, 95, 115, 100.51) == EntryZoneRule.Trigger.WAIT_CHASE);
        check("롱: 진입가 −0.81% · 손익비 충분 → ENTER", t(true, 100, 95, 115, 99.19) == EntryZoneRule.Trigger.ENTER);
        check("롱: 손절가 먼저 깨면 INVALIDATED", t(true, 100, 95, 115, 94.5) == EntryZoneRule.Trigger.INVALIDATED);
        check("롱: 목표가 도달 → TARGET_PASSED", t(true, 100, 95, 100.02, 100.01) == EntryZoneRule.Trigger.TARGET_PASSED);
        check("롱: 손절가 0.1% 밀착 → NEAR_STOP", t(true, 100, 95, 115, 95.05) == EntryZoneRule.Trigger.NEAR_STOP);
        check("가격 0 → NO_PRICE", t(true, 100, 95, 115, 0) == EntryZoneRule.Trigger.NO_PRICE);
        check("만료 → EXPIRED",
                EntryZoneRule.decide(true, 100, 95, 115, 100, NOW + 4_000_000L, TTL, EntryZoneRule.MIN_RR)
                        == EntryZoneRule.Trigger.EXPIRED);

        // 2) 숏 — 진입 구간
        check("숏: 진입가 −0.5%(경계) → ENTER", t(false, 100, 105, 90, 99.5) == EntryZoneRule.Trigger.ENTER);
        check("숏: 진입가 +0.8%(경계) → ENTER", t(false, 100, 105, 90, 100.8) == EntryZoneRule.Trigger.ENTER);
        check("숏: 진입가 −0.51% → 대기(추격 금지)", t(false, 100, 105, 90, 99.49) == EntryZoneRule.Trigger.WAIT_CHASE);
        check("숏: 진입가 +0.81% · 손익비 충분 → ENTER", t(false, 100, 105, 90, 100.81) == EntryZoneRule.Trigger.ENTER);
        check("숏: 손절가 넘으면 INVALIDATED", t(false, 100, 105, 90, 105.5) == EntryZoneRule.Trigger.INVALIDATED);
        check("숏: 목표가 도달 → TARGET_PASSED", t(false, 100, 105, 99.99, 99.98) == EntryZoneRule.Trigger.TARGET_PASSED);

        // 3) 유리한 자리지만 손익비 미달 → WAIT_RR
        check("롱: 더 싼 자리라도 손익비 1.0R 미만이면 대기",
                EntryZoneRule.decide(true, 100, 95, 103, 99, NOW, TTL, 2) == EntryZoneRule.Trigger.WAIT_RR,
                String.valueOf(EntryZoneRule.rrAtPrice(true, 99, 95, 103)));
        check("손익비: 롱 99 · 95 · 103 = 1.0R", Math.abs(EntryZoneRule.rrAtPrice(true, 99, 95, 103) - 1.0) < 1e-9);

        // 4) 사유 문구 — 한글 · 현재가/구간/손익비가 들어간다
        String chase = EntryZoneRule.reason("BTC", true, 100, 95, 115, 101, NOW, TTL, 1.2);
        check("사유(추격): 진입가 대기 중 · 구간 표기", chase.contains("진입가 대기 중") && chase.contains("99.2") && chase.contains("100.5"), chase);
        String rr = EntryZoneRule.reason("ETH", false, 100, 105, 90, 99.4, NOW, TTL, 1.2);
        check("사유(추격·숏): 아래로 벗어남", rr.contains("숏") && rr.contains("아래"), rr);
        String enter = EntryZoneRule.reason("SOL", true, 100, 95, 115, 100.2, NOW, TTL, 1.2);
        check("사유(진입): 조건 충족", enter.contains("진입 조건 충족") && enter.contains("손익비"), enter);
        String invalid = EntryZoneRule.reason("XRP", true, 100, 95, 115, 94, NOW, TTL, 1.2);
        check("사유(무효): 손절가 이탈", invalid.contains("셋업 무효"), invalid);

        System.out.println("");
        System.out.println("진입 구간 판정 검증: " + pass + "/" + (pass + fails.size()) + " 통과");
        if (!fails.isEmpty()) {
            System.out.println("실패: " + String.join(" · ", fails));
            System.exit(1);
        }
    }
}
