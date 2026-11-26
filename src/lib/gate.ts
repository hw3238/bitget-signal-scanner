/**
 * 🔒 앱 진입 게이트 판단 (v1.5.8)
 *
 * COTA 는 **회원 전용**이다(v1.5.8 게이트).
 *  · 세션이 없으면 시그널·메뉴·설정·거래소 선택 등 **어떤 화면도 그리지 않는다**.
 *  · 저장된 세션을 복원하는 동안(ready=false)은 게이트 대신 부팅 화면을 보여
 *    로그인한 사용자에게 가입 화면이 깜빡이지 않게 한다.
 *  · 로그인 직후 거래소를 아직 고르지 않았다면 거래소 선택 화면으로 이어진다.
 *
 * 화면 순서: booting → auth → exchange → app
 */
export type GateStage = 'booting' | 'auth' | 'exchange' | 'app';

export interface GateInput {
  /** 저장된 세션 복원이 끝났는가 */
  authReady: boolean;
  hasSession: boolean;
  exchange: string | null;
}

export function gateStage({ authReady, hasSession, exchange }: GateInput): GateStage {
  if (!authReady) return 'booting';
  if (!hasSession) return 'auth';
  if (!exchange) return 'exchange';
  return 'app';
}
