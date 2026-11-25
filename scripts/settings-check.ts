/**
 * ⚙️ 설정 탭 저장 → 자동매매 연동 단위 검증 (v1.5.7 웹)
 *   실행: npm run check:settings
 *
 * 1) 초안(draft) 판정 — 저장 버튼은 저장값과 다를 때만 활성화된다.
 * 2) 1회 리스크 저장 — 설정 탭 값과 자동매매 riskPct 가 **같은 값**이 된다.
 * 3) 매매 스타일·프리셋은 없어졌다 — 저장은 초안 항목만 정규화해 그대로 확정한다.
 */
import { DEFAULTS, applyGuardSave, guardPatchOf, normalizeConfig, type AutoTradeConfig } from '../src/lib/autotrade';
import { isDirty, planRiskSave } from '../src/lib/settingsSync';

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

/* 1) 초안 판정 */
check('같은 값이면 저장 버튼 비활성', !isDirty(1.5, 1.5) && !isDirty('majors', 'majors'));
check('다른 값이면 활성', isDirty(1.5, 2.5) && isDirty('majors', 'all'));
check('false → true 도 변경', isDirty(false, true));

/* 2) 1회 리스크 저장 */
const explicit = planRiskSave(2.5);
check(
  '리스크 2.5% 저장 → 설정·자동매매 모두 2.5%',
  explicit.settingsRiskPct === 2.5 && explicit.autoRiskPct === 2.5,
  `settings=${explicit.settingsRiskPct} auto=${explicit.autoRiskPct}`,
);
const fallback = planRiskSave(null);
check(
  '리스크 미지정(null) → 기본 1.5%',
  fallback.settingsRiskPct === 1.5 && fallback.autoRiskPct === 1.5,
  `auto=${fallback.autoRiskPct}`,
);
check(
  '리스크 상한 50% · 하한 0.5% 로 정리',
  planRiskSave(99).autoRiskPct === 50 && planRiskSave(0.1).autoRiskPct === 0.5,
  `${planRiskSave(99).autoRiskPct} / ${planRiskSave(0.1).autoRiskPct}`,
);
check('명시 12.5% → 자동매매도 12.5%', planRiskSave(12.5).autoRiskPct === 12.5);
check(
  '설정 탭 저장값 = 자동매매 값(항상 같은 값)',
  [1, 2.5, 7, 50].every((v) => {
    const p = planRiskSave(v);
    return p.settingsRiskPct === p.autoRiskPct;
  }),
);

/* 3) 매매 스타일·프리셋 제거 — 설정에는 숫자만 남는다 */
const base: AutoTradeConfig = normalizeConfig({
  ...DEFAULTS,
  enabled: true,
  mode: 'live',
  autoEntry: false,
  symbols: 'all',
  intervalSec: 120,
  entryTtlMin: 240,
  riskPct: 9,
  minWinRate: 60,
});
check('설정에 매매 스타일·프리셋 필드가 없다', !('stylePresetActive' in base));
check(
  '구버전 저장본의 stylePresetActive 는 읽지 않고 버린다',
  !('stylePresetActive' in normalizeConfig({ riskPct: 2, stylePresetActive: false } as Partial<AutoTradeConfig>)),
);
check(
  '새 기본값 — 승률 45% · 1.2R · 유효 240분 · 레버리지 상한 없음(유동)',
  DEFAULTS.minWinRate === 45 && DEFAULTS.minRR === 1.2 && DEFAULTS.entryTtlMin === 240 && DEFAULTS.maxLeverage === 0,
  `${DEFAULTS.minWinRate}% · ${DEFAULTS.minRR}R · ${DEFAULTS.entryTtlMin}m · ${DEFAULTS.maxLeverage}`,
);

/* 4) ② 저장 — 초안 항목만 정규화해 확정하고, 다른 항목은 건드리지 않는다 */
const draft: AutoTradeConfig = { ...base, riskPct: 3, minWinRate: 50, dailyLossPct: 7, intervalSec: 90 };
const saved = applyGuardSave(base, guardPatchOf(draft));
check(
  '저장: 초안 값 그대로 반영',
  saved.riskPct === 3 && saved.minWinRate === 50 && saved.dailyLossPct === 7 && saved.intervalSec === 90,
  `${saved.riskPct}% · ${saved.minWinRate}% · ${saved.dailyLossPct}% · ${saved.intervalSec}s`,
);
check(
  '저장: 켜짐·모의/실거래·허용 종목은 유지',
  saved.enabled === true && saved.mode === 'live' && saved.symbols === 'all' && saved.autoEntry === false,
  `${saved.mode} · ${saved.symbols}`,
);
check('저장: 범위 밖 값은 클램프', applyGuardSave(base, { riskPct: 90 }).riskPct === 50);
check('저장: 같은 값을 다시 저장해도 그대로(멱등)', JSON.stringify(applyGuardSave(saved, guardPatchOf(saved))) === JSON.stringify(saved));

/* 5) 실제 저장 경로 시뮬레이션 — 리스크 저장 → 설정·자동매매 동기화 */
let config = normalizeConfig({ ...DEFAULTS, symbols: 'all' });
let settingsRisk: number | null = null;
const r1 = planRiskSave(2.5);
settingsRisk = r1.settingsRiskPct;
config = normalizeConfig({ ...config, riskPct: r1.autoRiskPct });
check('저장 1: 리스크 2.5% → 설정·자동매매 2.5%', settingsRisk === 2.5 && config.riskPct === 2.5);
const r2 = planRiskSave(null);
settingsRisk = r2.settingsRiskPct;
config = normalizeConfig({ ...config, riskPct: r2.autoRiskPct });
check('저장 2: 빈 값 → 설정·자동매매 1.5%', settingsRisk === 1.5 && config.riskPct === 1.5);
check('저장 2 이후에도 허용 종목 유지', config.symbols === 'all');

console.log('');
console.log(`설정 저장·자동매매 연동 검증: ${pass}/${pass + fails.length} 통과`);
if (fails.length) {
  console.log(`실패: ${fails.join(' · ')}`);
  process.exit(1);
}
