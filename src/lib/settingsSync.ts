/**
 * 설정 탭 ↔ 자동매매 설정 동기화 (v1.5.6 웹).
 *
 * 원칙
 *  1) 설정 탭에서 `저장`을 누른 항목만 저장한다(초안 → 확정). 저장 전에는 아무것도 바뀌지 않는다.
 *  2) **1회 리스크**를 저장하면 설정(`bgss.settings.v1`)과 자동매매(`cota.autotrade.config.v1`)의
 *     리스크가 **같은 값**이 된다 — 카드 콕핏·원클릭·자동매매 주문 수량이 모두 같은 기준을 쓴다.
 *  3) **매매 스타일**을 저장하면 자동매매 설정에 그 스타일 프리셋(`applyStylePreset`)이 적용되고,
 *     설정 탭 리스크도 프리셋 값으로 맞춰 두 화면이 따로 놀지 않는다.
 *     켜짐·모의/실거래·감시 주기·허용 종목·시그널 유효시간은 사용자가 고른 값 그대로 둔다.
 *
 * 화면(`SettingsTab`)과 앱(`App.tsx`)이 같은 규칙을 쓰도록 계산은 여기 순수 함수로 모은다.
 * (`scripts/settings-check.ts` 가 이 파일을 검사한다)
 */
import { applyStylePreset, presetForStyle, type AutoTradeConfig } from './autotrade';
import { resolveRiskPct } from './orderCockpit';
import type { TradeStyle } from './profile';

/** 초안이 저장값과 다른가 — 저장 버튼 활성화 조건 */
export function isDirty<T>(saved: T, draft: T): boolean {
  return !Object.is(saved, draft);
}

/** 1회 리스크 저장 계획 */
export interface RiskSavePlan {
  /** 설정 탭에 저장할 값 — null = 성향 추천(자동) */
  settingsRiskPct: number | null;
  /** 자동매매 설정에 넣을 리스크(%) — 화면에 보이는 값과 항상 같다 */
  autoRiskPct: number;
}

/**
 * 설정 탭 리스크 저장 → 자동매매 리스크.
 *  · 명시값(예: 2.5)은 그대로, `null`(성향 추천)이면 성향 기본값(보수적 1.5% · 공격적 3%).
 *  · 저장 한 번으로 두 설정이 같은 값을 갖는다.
 */
export function planRiskSave(style: TradeStyle, riskPct: number | null): RiskSavePlan {
  return {
    settingsRiskPct: riskPct == null ? null : riskPct,
    autoRiskPct: resolveRiskPct(style, riskPct),
  };
}

/** 매매 스타일 저장 계획 */
export interface StyleSavePlan {
  style: TradeStyle;
  /** 프리셋이 정한 리스크 — 설정 탭 리스크도 같은 값으로 맞춘다 */
  settingsRiskPct: number;
  /** 프리셋이 적용된 자동매매 설정(켜짐·모드·주기·허용 종목 유지) */
  config: AutoTradeConfig;
}

export function planStyleSave(input: { config: AutoTradeConfig; style: TradeStyle }): StyleSavePlan {
  const preset = presetForStyle(input.style);
  const config = applyStylePreset(input.config, input.style);
  return {
    style: input.style,
    settingsRiskPct: config.riskPct ?? preset.riskPct,
    config,
  };
}

/** 프리셋 요약 — 설정 탭 스타일 행의 안내 문구 */
export function stylePresetSummary(style: TradeStyle): string {
  const p = presetForStyle(style);
  return `리스크 ${p.riskPct}% · 레버리지 ${p.maxLeverage > 0 ? `${p.maxLeverage}x` : '상한 없음'} · 최대 ${p.maxPositions}포지션 · 1일 손실 ${p.dailyLossPct}% · 최소 승률 ${p.minWinRate}% · ${p.minRR}R · 반익절 ${p.partialTp ? 'ON' : 'OFF'}`;
}
