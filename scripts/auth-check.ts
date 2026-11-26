/**
 * 🔐 계정(Auth)·게이트·관리자 대시보드 단위 검증 (v1.5.8 웹)
 *   실행: npm run check:auth
 *
 * 1) 입력 검증 — 이메일·비밀번호·닉네임 규칙
 * 2) Supabase 오류 → 한국어 안내 문구
 * 3) 연결 내역 payload — **화이트리스트 7개 필드만** 나가고 API 키/시크릿/패스프레이즈는 절대 없다
 * 4) 동기화 판단 — 의미 있는 값이 바뀔 때만 전송(updated_at 만 바뀐 경우 전송 안 함)
 * 5) 관리자 대시보드 — 프로필+연결 조인, 요약 집계, 검색·필터, 날짜 표기
 * 6) 세션 만료 판단
 * 7) **회원 전용 게이트** — 화면 순서(부팅 → 가입/로그인 → 거래소 선택 → 앱)
 * 8) **게이트 정적 검사** — 둘러보기·게스트 배너·닫기 흔적이 소스에 남아 있지 않은지
 */
import {
  CONNECTION_FIELDS,
  adminSummary,
  buildAdminRows,
  connectionChanged,
  connectionLabel,
  connectionPayload,
  connectionSignature,
  exchangeLabel,
  filterAdminRows,
  fmtAgo,
  fmtDay,
} from '../src/lib/accountSync';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gateStage } from '../src/lib/gate';
import {
  SESSION_STORAGE_KEY,
  authErrorMessage,
  sessionNeedsRefresh,
  validateEmail,
  validateNickname,
  validatePassword,
  type ConnectionRow,
  type Profile,
  type AuthSession,
} from '../src/lib/supabaseAuth';

let pass = 0;
const fails: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fails.push(name);
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* 1) 입력 검증 */
check('이메일: 정상 통과', validateEmail('trader@cota.app') === null);
check('이메일: 빈 값 거부', validateEmail('  ') === '이메일을 입력해 주세요.');
check('이메일: 형식 오류 거부', validateEmail('trader@') === '이메일 형식이 맞지 않습니다.');
check('이메일: 공백 포함 거부', validateEmail('a b@cota.app') !== null);
check('비밀번호: 6자 통과', validatePassword('123456') === null);
check('비밀번호: 5자 거부', validatePassword('12345') === '비밀번호는 6자 이상이어야 합니다.');
check('비밀번호: 72자 초과 거부', validatePassword('a'.repeat(73)) !== null);
check('닉네임: 2자 통과', validateNickname('코타') === null);
check('닉네임: 1자 거부', validateNickname('코') === '닉네임은 2자 이상이어야 합니다.');
check('닉네임: 12자 초과 거부', validateNickname('가'.repeat(13)) !== null);
check('닉네임: 공백만 거부', validateNickname('   ') !== null);

/* 2) 오류 문구 */
const msg = (input: unknown) => authErrorMessage(input);
check(
  '오류: 잘못된 비밀번호',
  msg({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) === '이메일 또는 비밀번호가 맞지 않습니다.',
);
check('오류: 이미 가입된 이메일', msg({ msg: 'User already registered' }).includes('이미 가입된 이메일'));
check('오류: 약한 비밀번호', msg({ msg: 'Password should be at least 6 characters' }).includes('6자 이상'));
check('오류: 요청 과다', msg({ msg: 'email rate limit exceeded' }).includes('잠시 뒤'));
check('오류: 네트워크', msg(new TypeError('Failed to fetch')).includes('인터넷 연결'));
check('오류: 권한(RLS)', msg({ code: '42501', message: 'permission denied for table cota_profiles' }).includes('권한'));
check('오류: 알 수 없는 값 → 일반 안내', msg({ foo: 'bar' }).includes('다시 시도'));

/* 3) 연결 payload — 화이트리스트 */
const nowIso = '2026-11-26T10:30:00.000Z';
const payload = connectionPayload(
  'user-1',
  {
    exchange: 'bitget',
    mode: 'live',
    apiConnected: true,
    autotradeEnabled: true,
    equity: 1234.5678,
    // 실수로 섞여 들어온 민감값 — 결과 payload 에는 절대 없어야 한다
    apiKey: 'bg_secret_key_value',
    secret: 'super-secret-value',
    passphrase: 'my-passphrase',
  } as never,
  nowIso,
);
const keys = Object.keys(payload).sort();
check('payload 키 = 화이트리스트 7개', keys.join(',') === [...CONNECTION_FIELDS].sort().join(','), keys.join(','));
check(
  'payload 에 API Key·Secret·Passphrase 원문이 없다',
  !/secret|passphrase|apiKey|bg_secret/i.test(JSON.stringify(payload)),
  JSON.stringify(payload),
);
check('payload: 거래소·모드·불리언 그대로', payload.exchange === 'bitget' && payload.mode === 'live' && payload.api_connected === true && payload.autotrade_enabled === true);
check('payload: 잔고 소수 2자리', payload.account_equity === 1234.57, String(payload.account_equity));
check('payload: 잔고 0 이하 → null(모름)', connectionPayload('u', { exchange: 'bitget', mode: 'demo', apiConnected: false, autotradeEnabled: false, equity: 0 }, nowIso).account_equity === null);
check('payload: 잔고 NaN → null', connectionPayload('u', { exchange: 'bitget', mode: 'demo', apiConnected: false, autotradeEnabled: false, equity: Number.NaN }, nowIso).account_equity === null);
check('payload: 모르는 거래소는 bitget 으로', connectionPayload('u', { exchange: 'upbit', mode: 'demo', apiConnected: false, autotradeEnabled: false, equity: null }, nowIso).exchange === 'bitget');
check('payload: 모르는 모드는 demo 로', connectionPayload('u', { exchange: 'binance', mode: 'paper' as never, apiConnected: false, autotradeEnabled: false, equity: null }, nowIso).mode === 'demo');
check('payload: updated_at 은 인자 그대로', payload.updated_at === nowIso);

/* 4) 동기화 판단 */
const base = connectionPayload('u', { exchange: 'bitget', mode: 'demo', apiConnected: false, autotradeEnabled: false, equity: null }, nowIso);
check('첫 저장은 전송', connectionChanged(null, base));
check('같은 상태는 전송 안 함', !connectionChanged(base, { ...base, updated_at: '2026-11-26T11:00:00.000Z' }));
check('잔고가 바뀌면 전송', connectionChanged(base, { ...base, account_equity: 100 }));
check('자동매매 ON 이면 전송', connectionChanged(base, { ...base, autotrade_enabled: true }));
check('모의 → 실거래면 전송', connectionChanged(base, { ...base, mode: 'live' }));
check('거래소 전환이면 전송', connectionChanged(base, { ...base, exchange: 'binance' }));
check('시그니처는 의미 값만', connectionSignature({ ...base, updated_at: '다른시간' }) === connectionSignature(base));

/* 5) 관리자 대시보드 */
const profiles: Profile[] = [
  { id: 'u1', email: 'boss@cota.app', nickname: '보스', role: 'admin', preferredExchange: 'bitget', createdAt: '2026-11-20T01:00:00Z', lastSeenAt: '2026-11-26T09:00:00Z' },
  { id: 'u2', email: 'trader@cota.app', nickname: '트레이더', role: 'user', preferredExchange: 'binance', createdAt: '2026-11-22T01:00:00Z', lastSeenAt: '2026-11-26T08:00:00Z' },
  { id: 'u3', email: 'new@cota.app', nickname: '', role: 'user', preferredExchange: 'bitget', createdAt: '2026-11-25T01:00:00Z', lastSeenAt: null },
];
const connections: ConnectionRow[] = [
  { userId: 'u1', exchange: 'bitget', mode: 'live', apiConnected: true, autotradeEnabled: true, accountEquity: 5000, updatedAt: nowIso },
  { userId: 'u2', exchange: 'binance', mode: 'demo', apiConnected: false, autotradeEnabled: false, accountEquity: null, updatedAt: nowIso },
];
const rows = buildAdminRows(profiles, connections);
check('조인: 프로필 3명 모두 한 줄씩', rows.length === 3);
check('조인: 연결 행이 없어도 프로필은 보인다', rows[2].exchange === null && !rows[2].apiConnected);
check('조인: 닉네임이 비면 이메일 앞부분', rows[2].nickname === 'new', rows[2].nickname);
check('조인: 연결 값 매핑', rows[0].apiConnected && rows[0].autotradeEnabled && rows[0].equity === 5000);
const summary = adminSummary(rows);
check(
  '요약: 총원·관리자·API·자동매매·실거래·거래소 분포(연결 행 기준)',
  summary.total === 3 && summary.admins === 1 && summary.apiConnected === 1 && summary.autotradeOn === 1 && summary.live === 1 && summary.bitget === 1 && summary.binance === 1,
  JSON.stringify(summary),
);
check('검색: 닉네임', filterAdminRows(rows, '트레이', 'all').length === 1);
check('검색: 이메일 대소문자 무시', filterAdminRows(rows, 'BOSS@', 'all').length === 1);
check('검색: 공백은 전체', filterAdminRows(rows, '   ', 'all').length === 3);
check('필터: API 연결', filterAdminRows(rows, '', 'api').map((r) => r.id).join(',') === 'u1');
check('필터: 자동매매 ON', filterAdminRows(rows, '', 'autotrade').map((r) => r.id).join(',') === 'u1');
check('필터: 관리자', filterAdminRows(rows, '', 'admin').map((r) => r.id).join(',') === 'u1');
check('필터+검색 조합', filterAdminRows(rows, 'u2', 'api').length === 0 && filterAdminRows(rows, 'trader', 'api').length === 0);
check('표기: 거래소', exchangeLabel('bitget') === '비트겟' && exchangeLabel('binance') === '바이낸스' && exchangeLabel(null) === '미선택');
check('표기: 연결 상태', connectionLabel({ apiConnected: false, mode: 'demo' }) === '미연결' && connectionLabel({ apiConnected: true, mode: 'live' }) === '연결됨 · 실거래' && connectionLabel({ apiConnected: true, mode: 'demo' }) === '연결됨 · 모의');
check('표기: 날짜(KST)', fmtDay('2026-11-26T15:30:00Z') === '2026.11.27', fmtDay('2026-11-26T15:30:00Z'));
check('표기: 없는 날짜', fmtDay(null) === '—' && fmtAgo(null) === '—');
const t0 = Date.parse('2026-11-26T10:00:00Z');
check('표기: 방금 전', fmtAgo('2026-11-26T09:59:40Z', t0) === '방금 전');
check('표기: 5분 전', fmtAgo('2026-11-26T09:55:00Z', t0) === '5분 전');
check('표기: 3시간 전', fmtAgo('2026-11-26T07:00:00Z', t0) === '3시간 전');
check('표기: 2일 전', fmtAgo('2026-11-24T10:00:00Z', t0) === '2일 전');
check('표기: 7일 이상은 날짜', fmtAgo('2026-11-10T10:00:00Z', t0) === '2026.11.10');

/* 6) 세션 만료 판단 */
const session: AuthSession = { accessToken: 'a', refreshToken: 'r', expiresAt: 0, user: { id: 'u', email: 'a@b.c' } };
check('세션: 만료 정보 없으면 갱신 필요', sessionNeedsRefresh(session, t0));
check('세션: 5분 남으면 그대로 사용', !sessionNeedsRefresh({ ...session, expiresAt: t0 + 5 * 60_000 }, t0));
check('세션: 30초 남으면 갱신 필요', sessionNeedsRefresh({ ...session, expiresAt: t0 + 30_000 }, t0));
check('세션 저장 키 고정', SESSION_STORAGE_KEY === 'cota.auth.session.v1');

/* 7) 회원 전용 게이트 — 화면 순서 */
check('게이트: 세션 복원 전에는 부팅 화면', gateStage({ authReady: false, hasSession: false, exchange: null }) === 'booting');
check('게이트: 복원 전인데 세션이 있어도 부팅', gateStage({ authReady: false, hasSession: true, exchange: 'bitget' }) === 'booting');
check('게이트: 미로그인 → 가입/로그인 게이트', gateStage({ authReady: true, hasSession: false, exchange: null }) === 'auth');
check('게이트: 미로그인인데 거래소가 저장돼 있어도 게이트', gateStage({ authReady: true, hasSession: false, exchange: 'bitget' }) === 'auth');
check('게이트: 로그인 + 거래소 미선택 → 거래소 선택', gateStage({ authReady: true, hasSession: true, exchange: null }) === 'exchange');
check('게이트: 로그인 + 거래소 선택 → 앱', gateStage({ authReady: true, hasSession: true, exchange: 'binance' }) === 'app');

/* 8) 게이트 정적 검사 — 예전 '게스트 둘러보기' 흔적이 남아 있지 않은가 */
const ROOT = process.cwd();
function sources(dir: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sources(full));
      continue;
    }
    if (!/\.(tsx?|css)$/.test(name)) continue;
    out.push({ path: full.replace(`${ROOT}/`, ''), text: readFileSync(full, 'utf8') });
  }
  return out;
}
const srcFiles = sources(join(ROOT, 'src'));
const allSrc = srcFiles.map((f) => `${f.path}\n${f.text}`).join('\n');
const appSrc = srcFiles.find((f) => f.path.endsWith('src/App.tsx'))?.text ?? '';
const gateSrc = srcFiles.find((f) => f.path.endsWith('src/components/AuthGate.tsx'))?.text ?? '';
check('정적: 회원 전용 게이트 컴포넌트가 있다(data-auth-gate)', gateSrc.includes('data-auth-gate'));
check('정적: 게이트는 닫기 버튼을 두지 않는다', !gateSrc.includes('data-auth-close'));
check('정적: "로그인 없이 둘러보기"·게스트 버튼이 없다', !/data-auth-guest|로그인 없이 둘러보기|게스트로 둘러보기/.test(allSrc));
check('정적: 게스트 배너(data-auth-banner·cota.auth.banner)가 없다', !/data-auth-banner|auth-banner-guest|cota\.auth\.banner/.test(allSrc));
check('정적: 예전 AuthSheet(모달)는 삭제됐다', !srcFiles.some((f) => f.path.endsWith('src/components/AuthSheet.tsx')));
check('정적: App 이 gateStage 로 화면을 가른다', appSrc.includes('gateStage(') && appSrc.includes("stage === 'auth'"));
check('정적: 미로그인에는 스캔을 켜지 않는다(enabled: authed)', /useScanner\(\{[\s\S]*enabled:\s*authed/.test(appSrc));

console.log('');
console.log(`계정·게이트·관리자 대시보드 검증: ${pass}/${pass + fails.length} 통과`);
if (fails.length) {
  console.log(`실패: ${fails.join(' · ')}`);
  process.exit(1);
}
