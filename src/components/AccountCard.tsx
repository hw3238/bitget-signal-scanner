/**
 * 👤 계정 카드 — 메뉴 탭·설정 탭 공통 (v1.5.8)
 *
 * · 로그인 전: 회원가입·로그인 버튼(게스트로 계속 쓸 수 있다는 안내 포함)
 * · 로그인 후: 닉네임 · 이메일 · 권한 배지 · 로그아웃
 * · 관리자에게만 `관리자` 배지가 붙는다(대시보드 메뉴 자체는 MenuTab 이 따로 그린다).
 */
import type { AccountAuthApi } from '../hooks/useAccountAuth';
import type { AuthMode } from './AuthSheet';

interface Props {
  auth: AccountAuthApi;
  onOpenAuth: (mode: AuthMode) => void;
  /** 탭마다 여백이 달라 클래스만 나눈다 */
  variant?: 'menu' | 'settings';
}

export function AccountCard({ auth, onOpenAuth, variant = 'menu' }: Props) {
  if (!auth.ready) return null;

  if (!auth.session) {
    return (
      <section className={`account-card ${variant} guest`} data-account-card data-account-state="guest">
        <div className="account-head">
          <span className="account-avatar" aria-hidden>
            👤
          </span>
          <div className="account-copy">
            <b>COTA 계정</b>
            <span>가입하면 기기를 바꿔도 거래소 연결 내역이 남아요.</span>
          </div>
        </div>
        <div className="account-actions">
          <button
            type="button"
            className="account-btn primary"
            onClick={() => onOpenAuth('signup')}
            data-account-signup
          >
            회원가입
          </button>
          <button type="button" className="account-btn" onClick={() => onOpenAuth('login')} data-account-login>
            로그인
          </button>
        </div>
        <p className="account-note">
          로그인 없이도 스캐너·자동매매는 그대로 쓸 수 있어요. <b>게스트로 둘러보기</b> 가능.
        </p>
      </section>
    );
  }

  const profile = auth.profile;
  const email = profile?.email || auth.session.user.email;
  const nickname = profile?.nickname || email.split('@')[0] || '트레이더';
  const admin = profile?.role === 'admin';

  return (
    <section className={`account-card ${variant} member`} data-account-card data-account-state="member" data-account-role={admin ? 'admin' : 'user'}>
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
