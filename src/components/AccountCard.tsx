/**
 * 👤 계정 카드 — 메뉴 탭·설정 탭 공통 (v1.5.8)
 *
 * · 회원 전용 게이트(v1.5.8)가 생긴 뒤로 이 카드는 **로그인한 사용자만** 본다.
 *   (세션이 없으면 앱 자체가 `AuthGate` 로 잠기므로 '비회원 카드'는 없다)
 * · 닉네임 · 이메일 · 권한 배지 · 로그아웃. 로그아웃하면 즉시 게이트로 돌아간다.
 * · 관리자에게만 `관리자` 배지가 붙는다(대시보드 메뉴 자체는 MenuTab 이 따로 그린다).
 */
import type { AccountAuthApi } from '../hooks/useAccountAuth';

interface Props {
  auth: AccountAuthApi;
  /** 탭마다 여백이 달라 클래스만 나눈다 */
  variant?: 'menu' | 'settings';
}

export function AccountCard({ auth, variant = 'menu' }: Props) {
  if (!auth.ready || !auth.session) return null;

  const profile = auth.profile;
  const email = profile?.email || auth.session.user.email;
  const nickname = profile?.nickname || email.split('@')[0] || '트레이더';
  const admin = profile?.role === 'admin';

  return (
    <section
      className={`account-card ${variant} member`}
      data-account-card
      data-account-state="member"
      data-account-role={admin ? 'admin' : 'user'}
    >
      <div className="account-head">
        <span className={`account-avatar ${admin ? 'admin' : ''}`} aria-hidden>
          {nickname.slice(0, 1).toUpperCase()}
        </span>
        <div className="account-copy">
          <b>
            {nickname}
            <i className={`account-role ${admin ? 'admin' : ''}`} data-account-badge>
              {admin ? '관리자' : '일반'}
            </i>
          </b>
          <span data-account-email>{email}</span>
        </div>
        <button type="button" className="account-logout" onClick={() => void auth.signOut()} data-account-logout>
          로그아웃
        </button>
      </div>
      <p className="account-note">연결 내역은 거래소·모드·자동매매 상태·잔고까지만 저장되고, API 키 원문은 저장되지 않아요.</p>
    </section>
  );
}
