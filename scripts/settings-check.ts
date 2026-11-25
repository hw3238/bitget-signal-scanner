/**
 * ⚙️ 설정 탭 저장 → 자동매매 연동 단위 검증 (v1.5.6 웹)
 *   실행: npm run check:settings
 *
 * 1) 초안(draft) 판정 — 저장 버튼은 저장값과 다를 때만 활성화된다.
 * 2) 1회 리스크 저장 — 설정 탭 값과 자동매매 riskPct 가 같은 값이 된다(성향 추천 포함).
 * 3) 매매 스타일 저장 — applyStylePreset 이 적용되고, 켜짐·모드·주기·허용 종목·유효시간은 유지된다.
 */
import {
  DEFAULTS,
  applyStylePreset,
  normalizeConfig,
  presetForStyle,
  type AutoTradeConfig,
} from '../src/lib/autotrade';
import { STYLE_PRESETS } from '../src/lib/autotrade';
import { isDirty, planRiskSave, planStyleSave, stylePresetSummary } from '../src/lib/settingsSync';

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
check('같은 값이면 저장 버튼 비활성', !isDirty(1.5, 1.5) && !isDirty('majors', 'majors') && !isDirty(null, null));
check('다른 값이면 활성', isDirty(1.5, 2.5) && isDirty('majors', 'all') && isDirty(null, 2.5));
check('false → true 도 변경', isDirty(false, true));

/* 2) 1회 리스크 저장 */
const explicit = planRiskSave('conservative', 2.5);
check(
  '리스크 2.5% 저장 → 설정·자동매매 모두 2.5%',
  explicit.settingsRiskPct === 2.5 && explicit.autoRiskPct === 2.5,
  `settings=${explicit.settingsRiskPct} auto=${explicit.autoRiskPct}`,
);
const autoCons = planRiskSave('conservative', null);
check(
  '성향 추천(보수적) → 설정 null · 자동매매 1.5%',
  autoCons.settingsRiskPct === null && autoCons.autoRiskPct === 1.5,
  `auto=${autoCons.autoRiskPct}`,
);
const autoAgg = planRiskSave('aggressive', null);
check(
  '성향 추천(공격적) → 설정 null · 자동매매 3%',
  autoAgg.settingsRiskPct === null && autoAgg.autoRiskPct === 3,
  `auto=${autoAgg.autoRiskPct}`,
);
check(
  '리스크 상한 50% · 하한 0.5% 로 정리',
  planRiskSave('conservative', 99).autoRiskPct === 50 && planRiskSave('conservative', 0.1).autoRiskPct === 0.5,
  `${planRiskSave('conservative', 99).autoRiskPct} / ${planRiskSave('conservative', 0.1).autoRiskPct}`,
);
check(
  '공격적 + 명시 12.5% → 자동매매도 12.5%',
  planRiskSave('aggressive', 12.5).autoRiskPct === 12.5,
);

/* 3) 매매 스타일 저장 */
/** 사용자가 직접 고른 값들 — 프리셋이 건드리면 안 된다. */
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
const agg = planStyleSave({ config: base, style: 'aggressive' });
check(
  '공격적 저장 → 리스크 4% · 상한 없음 · 4포지션 · 손실 10% · 승률 45% · 1.2R',
  agg.config.riskPct === 4 &&
    agg.config.maxLeverage === 0 &&
    agg.config.maxPositions === 4 &&
    agg.config.dailyLossPct === 10 &&
    agg.config.minWinRate === 45 &&
    agg.config.minRR === 1.2,
  `${agg.config.riskPct}% · ${agg.config.maxLeverage} · ${agg.config.maxPositions} · ${agg.config.dailyLossPct}%`,
);
check(
  '설정 탭 리스크도 프리셋 값(4%)으로',
  agg.settingsRiskPct === 4 && agg.settingsRiskPct === agg.config.riskPct,
  String(agg.settingsRiskPct),
);
check(
  '켜짐·실거래·자동진입·허용 종목·주기·유효시간은 유지',
  agg.config.enabled === true &&
    agg.config.mode === 'live' &&
    agg.config.autoEntry === false &&
    agg.config.symbols === 'all' &&
    agg.config.intervalSec === 120 &&
    agg.config.entryTtlMin === 240,
  `${agg.config.mode} · ${agg.config.symbols} · ${agg.config.intervalSec}s · ${agg.config.entryTtlMin}m`,
);
check(
  '반익절·조기 손절은 프리셋대로 ON',
  agg.config.partialTp === true && agg.config.earlyStop === true,
);

const cons = planStyleSave({ config: base, style: 'conservative' });
check(
  '보수적 저장 → 리스크 1.5% · 5x · 2포지션 · 손실 4.5% · 승률 52%',
  cons.config.riskPct === 1.5 &&
    cons.config.maxLeverage === 5 &&
    cons.config.maxPositions === 2 &&
    cons.config.dailyLossPct === 4.5 &&
    cons.config.minWinRate === 52 &&
    cons.config.minRR === 1.5,
  `${cons.config.riskPct}% · ${cons.config.maxLeverage}x`,
);
check('보수적 저장도 설정 탭 리스크 1.5% 로 일치', cons.settingsRiskPct === 1.5);

const same = planStyleSave({ config: agg.config, style: 'aggressive' });
check(
  '같은 스타일을 다시 저장해도 값 그대로(멱등)',
  JSON.stringify(same.config) === JSON.stringify(agg.config),
);
check(
  '프리셋과 다른 사용자 값을 덮어쓴다(스타일 저장의 의미)',
  base.riskPct === 9 && agg.config.riskPct !== base.riskPct,
);
check(
  'applyStylePreset 결과와 planStyleSave.config 가 같다',
  JSON.stringify(applyStylePreset(base, 'aggressive')) === JSON.stringify(agg.config),
);
check(
  '프리셋 리스크는 STYLE_PRESETS 와 일치',
  Object.keys(STYLE_PRESETS).every((key) => {
    const style = key as 'conservative' | 'aggressive';
    return planStyleSave({ config: base, style }).settingsRiskPct === presetForStyle(style).riskPct;
  }),
);
check(
  '스타일 요약 문구 — 상한 없음/5x 표기',
  /레버리지 상한 없음/.test(stylePresetSummary('aggressive')) &&
    /레버리지 5x/.test(stylePresetSummary('conservative')),
  stylePresetSummary('aggressive'),
);

/* 4) 실제 저장 경로 시뮬레이션 — 리스크 저장 후 스타일 저장, 다시 리스크 저장 */
let config = normalizeConfig({ ...DEFAULTS, symbols: 'all' });
let settingsRisk: number | null = null;
const r1 = planRiskSave('conservative', 2.5);
settingsRisk = r1.settingsRiskPct;
config = normalizeConfig({ ...config, riskPct: r1.autoRiskPct });
check('저장 1: 리스크 2.5% → 설정·자동매매 2.5%', settingsRisk === 2.5 && config.riskPct === 2.5);
const s1 = planStyleSave({ config, style: 'aggressive' });
settingsRisk = s1.settingsRiskPct;
config = s1.config;
check('저장 2: 공격적 → 리스크 4% 동기화', settingsRisk === 4 && config.riskPct === 4);
const r2 = planRiskSave('aggressive', null);
settingsRisk = r2.settingsRiskPct;
config = normalizeConfig({ ...config, riskPct: r2.autoRiskPct });
check('저장 3: 성향 추천 → 설정 null · 자동매매 3%', settingsRisk === null && config.riskPct === 3);
check('저장 3 이후에도 허용 종목 유지', config.symbols === 'all');

console.log('');
console.log(`설정 저장·자동매매 연동 검증: ${pass}/${pass + fails.length} 통과`);
if (fails.length) {
  console.log(`실패: ${fails.join(' · ')}`);
  process.exit(1);
}
