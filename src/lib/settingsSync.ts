/**
 * 설정 탭 ↔ 자동매매 설정 동기화 (v1.5.7).
 *
 * 원칙
 *  1) 설정 탭에서 `저장`을 누른 항목만 저장한다(초안 → 확정). 저장 전에는 아무것도 바뀌지 않는다.
 *  2) **1회 리스크**를 저장하면 설정(`bgss.settings.v1`)과 자동매매(`cota.autotrade.config.v1`)의
 *     리스크가 **같은 값**이 된다 — 카드 콕핏·원클릭·자동매매 주문 수량이 모두 같은 기준을 쓴다.
 *  3) 매매 스타일(보수적/공격적)과 프리셋은 없어졌다(v1.5.7). 리스크·레버리지 상한·포지션 수 같은
 *     값은 자동매매 화면의 `② 리스크 · 안전장치`에서 숫자로 직접 정한 뒤 `저장`한다.
 *
 * 화면(`SettingsTab`)과 앱(`App.tsx`)이 같은 규칙을 쓰도록 계산은 여기 순수 함수로 모은다.
 * (`scripts/settings-check.ts` 가 이 파일을 검사한다)
 */
import type { AutoTradeConfig } from './autotrade';
import { resolveRiskPct } from './orderCockpit';

/** 초안이 저장값과 다른가 — 저장 버튼 활성화 조건 */
export function isDirty<T>(saved: T, draft: T): boolean {
  return !Object.is(saved, draft);
}

/** 1회 리스크 저장 계획 */
export interface RiskSavePlan {
  /** 설정 탭에 저장할 값 — 0.5~50%로 정리된 숫자 */
  settingsRiskPct: number;
  /** 자동매매 설정에 넣을 리스크(%) — 화면에 보이는 값과 항상 같다 */
  autoRiskPct: number;
}

/**
 * 설정 탭 리스크 저장 → 자동매매 리스크.
 *  · 화면에서 고른 숫자(예: 2.5)를 그대로 쓰고, 비어 있으면 기본 1.5%.
 *  · 저장 한 번으로 두 설정이 **같은 값**을 갖는다.
 */
export function planRiskSave(riskPct: number | null | undefined): RiskSavePlan {
  const value = resolveRiskPct(riskPct);
  return { settingsRiskPct: value, autoRiskPct: value };
}

/** 자동매매 설정의 리스크 — 화면 안내 문구 */
export function riskSyncNote(config: Pick<AutoTradeConfig, 'riskPct'>): string {
  return `지금 자동매매 리스크 ${config.riskPct}% · 설정 탭과 같은 값입니다.`;
}
