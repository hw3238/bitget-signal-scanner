/**
 * 🔐 회원 전용 진입 게이트 (v1.5.8)
 *
 * · 세션이 없으면 앱 전체를 이 화면 하나로 덮는다 — 스캐너·시황·메뉴·기록·설정·
 *   거래소 선택·하단 탭바·상단 헤더를 하나도 그리지 않는다.
 * · 닫기 버튼·둘러보기 진입·게스트 배너는 없다. 가입/로그인 없이는 진입할 수 없다.
 * · 회원가입 또는 로그인 성공 → `auth.session` 이 서는 즉시 게이트가 사라지고,
 *   거래소를 아직 고르지 않았다면 거래소 선택 화면으로 이어진다.
 * · 이메일·비밀번호(+가입 닉네임)만 받는다. 거래소 API 키는 여기서 절대 받지 않는다.
 */
import { useState } from 'react';
import type { AccountAuthApi } from '../hooks/useAccountAuth';
import { validateEmail, validateNickname, validatePassword } from '../lib/supabaseAuth';
import logoUrl from '../assets/cota-logo.png';

export type AuthMode = 'login' | 'signup';

export function AuthGate({ auth }: { auth: AccountAuthApi }) {
  const [tab, setTab] = useState<AuthMode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchTab = (next: AuthMode) => {
    setTab(next);
    setError(null);
    auth.clearError();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const invalid =
      tab === 'signup'
        ? validateNickname(nickname) ?? validateEmail(email) ?? validatePassword(password)
        : validateEmail(email) ?? validatePassword(password);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    const res = tab === 'signup' ? await auth.signUp(email, password, nickname) : await auth.signIn(email, password);
    setBusy(false);
    // 성공하면 세션이 서고 App 이 게이트를 걷어낸다 — 여기서 따로 닫을 필요가 없다.
    if (!res.ok) setError(res.message ?? '처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
  };

  return (
    <div className="auth-gate" data-auth-gate data-auth-state="locked">
      <div className="auth-gate-inner">
        <div className="auth-gate-hero">
          <img className="auth-gate-logo" src={logoUrl} alt="COTA" width={64} height={64} />
          <h1>
            코타는 <b>회원 전용</b>이에요
          </h1>
          <p>
            가입하면 <b>시그널·시황·자동매매·기록</b>을 바로 쓸 수 있어요.
          </p>
          <p className="auth-gate-sub">이메일만 있으면 3초면 끝나요.</p>
        </div>

        <div
          className="auth-gate-card"
          role="dialog"
          aria-modal="true"
          aria-label={tab === 'signup' ? 'COTA 회원가입' : 'COTA 로그인'}
          data-auth-sheet
        >
          <div className="auth-sheet-head">
            <div>
              <div className="auth-eyebrow">COTA 계정</div>
              <b>{tab === 'signup' ? '3초 만에 시작하기' : '다시 오셨네요'}</b>
            </div>
          </div>

          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'signup'}
              className={tab === 'signup' ? 'on' : ''}
              data-auth-tab="signup"
              onClick={() => switchTab('signup')}
            >
              회원가입
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'login'}
              className={tab === 'login' ? 'on' : ''}
              data-auth-tab="login"
              onClick={() => switchTab('login')}
            >
              로그인
            </button>
          </div>

          <form className="auth-form" onSubmit={submit} noValidate>
            {tab === 'signup' && (
              <label className="auth-field">
                <span>닉네임</span>
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="예: 코인수집가"
                  autoComplete="nickname"
                  maxLength={12}
                  data-auth-field="nickname"
                />
              </label>
            )}
            <label className="auth-field">
              <span>이메일</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                inputMode="email"
                data-auth-field="email"
              />
            </label>
            <label className="auth-field">
              <span>비밀번호</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6자 이상"
                autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                data-auth-field="password"
              />
            </label>

            {error && (
              <div className="auth-error" role="alert" data-auth-error>
                {error}
              </div>
            )}

            <button type="submit" className="auth-submit" disabled={busy} data-auth-submit>
              {busy ? '처리 중…' : tab === 'signup' ? '회원가입하고 시작하기' : '로그인'}
            </button>
          </form>

          <p className="auth-note">
            계정에는 <b>닉네임·이메일·거래소 연결 상태</b>만 저장됩니다. 비트겟 API Key·Secret·Passphrase는
            기기 밖으로 나가지 않아요.
          </p>
        </div>
      </div>
    </div>
  );
}
