/**
 * 🔐 로그인 / 회원가입 시트 (v1.5.8)
 *
 * · 이메일·비밀번호(+회원가입 닉네임)만 받는다. 거래소 API 키는 여기서 절대 받지 않는다.
 * · `게스트로 둘러보기` 로 닫으면 앱은 지금처럼 그대로 쓸 수 있다(스캔·자동매매는 로그인 없이도 동작).
 * · 성공하면 시트를 닫고, 메뉴·설정 카드가 닉네임/권한으로 바뀐다.
 */
import { useEffect, useState } from 'react';
import type { AccountAuthApi } from '../hooks/useAccountAuth';
import { validateEmail, validateNickname, validatePassword } from '../lib/supabaseAuth';

export type AuthMode = 'login' | 'signup';

interface Props {
  mode: AuthMode;
  auth: AccountAuthApi;
  onClose: () => void;
}

export function AuthSheet({ mode, auth, onClose }: Props) {
  const [tab, setTab] = useState<AuthMode>(mode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    const res =
      tab === 'signup'
        ? await auth.signUp(email, password, nickname)
        : await auth.signIn(email, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.message ?? '처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
      return;
    }
    onClose();
  };

  return (
    <div className="auth-backdrop" data-auth-sheet onClick={onClose} role="presentation">
      <div
        className="auth-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={tab === 'signup' ? 'COTA 회원가입' : 'COTA 로그인'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="auth-sheet-head">
          <div>
            <div className="auth-eyebrow">COTA 계정</div>
            <b>{tab === 'signup' ? '3초 만에 시작하기' : '다시 오셨네요'}</b>
          </div>
          <button type="button" className="auth-close" onClick={onClose} aria-label="닫기" data-auth-close>
            ✕
          </button>
        </div>

        <div className="auth-tabs" role="tablist">
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
            {busy ? '처리 중…' : tab === 'signup' ? '회원가입' : '로그인'}
          </button>
        </form>

        <button type="button" className="auth-guest" onClick={onClose} data-auth-guest>
          로그인 없이 둘러보기
        </button>

        <p className="auth-note">
          계정에는 <b>닉네임·이메일·거래소 연결 상태</b>만 저장됩니다. 비트겟 API Key·Secret·Passphrase는
          기기 밖으로 나가지 않아요.
        </p>
      </div>
    </div>
  );
}
