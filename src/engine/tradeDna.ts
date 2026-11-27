/**
 * 🧠 내 매매 DNA · 뇌동매매 닥터 — **실제 기록만**으로 매매 습관을 계산한다.
 *
 * 원칙
 *  1) 입력은 매매일지(또는 비트겟 과거 포지션)뿐이다. 기록이 없으면 아무 값도 만들지 않고,
 *     화면은 "기록이 없습니다"를 그대로 보여준다(데모는 사용자가 직접 켤 때만, DEMO 표기와 함께).
 *  2) 모든 지표는 순수 함수 — 카드·진단 문장·쿨다운 게이트가 **같은 계산**을 본다.
 *     (`scripts/innovations-check.ts`가 경계값을 고정한다)
 *  3) 승률만 보지 않는다. 승률이 같아도 누적 R·구간 표본이 다르면 다른 진단이 나와야 한다.
 *
 * 시간대는 **KST 기준**이다(앱의 모든 표기와 동일). 기기 시간대와 무관하게 UTC+9로 계산한다.
 */

/* ------------------------------------------------------------------ *
 * 입력 모델
 * ------------------------------------------------------------------ */

export type DnaResult = 'win' | 'loss' | 'open';

/** 분석 단위 — 기록 1건 = 진입 1건 */
export interface DnaTrade {
  id: string;
  symbol: string;
  base: string;
  side: 'long' | 'short';
  /** 진입 시각(ms) — 시그널 감지·체결 시각 */
  openedAt: number;
  /** 청산 시각(ms) — 모르면 null(진행 중이거나 기록에 없음) */
  closedAt: number | null;
  result: DnaResult;
  /** 이 매매의 R (승리 +, 패배 −) */
  r: number;
  /** 배율 — 기록에 없으면 null(구버전 기록) */
  leverage: number | null;
  /** 보유 시간(ms) — 봉 수 × 타임프레임 근사, 모르면 null */
  holdMs: number | null;
  /**
   * 내가 실제로 진입한 기록인가.
   *  · true  = '내 진입'으로 표시한 시그널 · 자동매매·과거 포지션
   *  · false = COTA 가 감지한 시그널 복기(내 체결이 아님)
   */
  own: boolean;
}

export interface DnaStat {
  n: number;
  wins: number;
  losses: number;
  open: number;
  /** 종료 매매 승률(%) — 종료가 0건이면 0 */
  winRate: number;
  cumR: number;
  avgR: number;
}

export const EMPTY_STAT: DnaStat = { n: 0, wins: 0, losses: 0, open: 0, winRate: 0, cumR: 0, avgR: 0 };

/** 표본이 이보다 적으면 "참고용"으로만 말한다 */
export const MIN_SAMPLE = 3;
/** 이 이상이면 진단 문장을 단정적으로 쓴다 */
export const CONFIDENT_SAMPLE = 10;

export function summarize(list: DnaTrade[]): DnaStat {
  let wins = 0;
  let losses = 0;
  let open = 0;
  let cumR = 0;
  for (const t of list) {
    if (t.result === 'open') {
      open += 1;
      continue;
    }
    if (t.result === 'win') wins += 1;
    else losses += 1;
    cumR += Number.isFinite(t.r) ? t.r : 0;
  }
  const closed = wins + losses;
  return {
    n: list.length,
    wins,
    losses,
    open,
    winRate: closed ? (wins / closed) * 100 : 0,
    cumR,
    avgR: closed ? cumR / closed : 0,
  };
}

/** 종료된 매매만, 청산 시각 오름차순(없으면 진입 시각) */
export function closedAsc(list: DnaTrade[]): DnaTrade[] {
  return list
    .filter((t) => t.result !== 'open')
    .sort((a, b) => (a.closedAt ?? a.openedAt) - (b.closedAt ?? b.openedAt) || a.openedAt - b.openedAt);
}

/* ------------------------------------------------------------------ *
 * ① 시간대별 승률 히트맵 (KST)
 * ------------------------------------------------------------------ */

export interface TimeBucketMeta {
  key: string;
  label: string;
  emoji: string;
  /** 시작 시 (포함) */
  from: number;
  /** 끝 시 (미포함) — night 는 자정을 넘는다 */
  to: number;
}

/** 새벽 02–06 · 오전 06–12 · 오후 12–18 · 밤 18–22 · 심야 22–02 */
export const TIME_BUCKETS: TimeBucketMeta[] = [
  { key: 'morning', label: '오전', emoji: '☀️', from: 6, to: 12 },
  { key: 'afternoon', label: '오후', emoji: '🌤', from: 12, to: 18 },
  { key: 'evening', label: '밤', emoji: '🌆', from: 18, to: 22 },
  { key: 'night', label: '심야', emoji: '🌙', from: 22, to: 2 },
  { key: 'dawn', label: '새벽', emoji: '🌅', from: 2, to: 6 },
];

/** KST 시(0~23) — 기기 시간대와 무관하게 UTC+9 */
export function kstHourOf(ts: number): number {
  const utc = (ts + 9 * 3_600_000) / 3_600_000;
  const hour = Math.floor(((utc % 24) + 24) % 24);
  return hour;
}

/** 시 → 시간대 키. night(22–02)가 자정을 넘는다. */
export function bucketOfHour(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  for (const b of TIME_BUCKETS) {
    if (b.from <= b.to ? h >= b.from && h < b.to : h >= b.from || h < b.to) return b.key;
  }
  return 'morning';
}

export interface DnaBucketStat extends DnaStat {
  key: string;
  label: string;
  emoji: string;
  /** 이 구간이 **전체 손실 R** 에서 차지하는 비중(%) */
  lossSharePct: number;
  /** 전체 표본에서 이 구간이 차지하는 비중(%) */
  sharePct: number;
  /** 이 구간에서 가장 많이 나온 기법(표시용, 없으면 '') */
  topStrategy: string;
}


function statOf(list: DnaTrade[]): DnaStat {
  return summarize(list);
}

function withShares(
  list: DnaTrade[],
  all: DnaTrade[],
  meta: { key: string; label: string; emoji: string },
): DnaBucketStat {
  const stat = statOf(list);
  const totalLoss = closedAsc(all).reduce((acc, t) => acc + (t.result === 'loss' ? -Math.min(0, t.r) : 0), 0);
  const thisLoss = list.reduce((acc, t) => acc + (t.result === 'loss' ? -Math.min(0, t.r) : 0), 0);
  const closedAll = all.filter((t) => t.result !== 'open').length;
  const closedHere = list.filter((t) => t.result !== 'open').length;
  return {
    ...stat,
    ...meta,
    lossSharePct: totalLoss > 0 ? (thisLoss / totalLoss) * 100 : 0,
    sharePct: closedAll > 0 ? (closedHere / closedAll) * 100 : 0,
    topStrategy: '',
  };
}

/** 시간대별 성적 — 시간대 5개를 **항상** 모두 돌려준다(빈 구간도 '표본 없음'으로 보여준다) */
export function timeHeatmap(trades: DnaTrade[]): DnaBucketStat[] {
  return TIME_BUCKETS.map((meta) =>
    withShares(
      trades.filter((t) => t.result !== 'open' && bucketOfHour(kstHourOf(t.openedAt)) === meta.key),
      trades,
      meta,
    ),
  );
}

/* ------------------------------------------------------------------ *
 * ② 레버리지 구간별 손익
 * ------------------------------------------------------------------ */

export interface LevBucketMeta {
  key: 'low' | 'mid' | 'high' | 'unknown';
  label: string;
  /** 화면 표기 (저배 ≤5x 등) */
  range: string;
}

export const LEV_BUCKETS: LevBucketMeta[] = [
  { key: 'low', label: '저배', range: '≤5x' },
  { key: 'mid', label: '중배', range: '6~15x' },
  { key: 'high', label: '고배', range: '16x+' },
  { key: 'unknown', label: '배율 미기록', range: '—' },
];

export function levBucketOf(leverage: number | null): LevBucketMeta['key'] {
  if (leverage == null || !Number.isFinite(leverage) || leverage <= 0) return 'unknown';
  if (leverage <= 5) return 'low';
  if (leverage <= 15) return 'mid';
  return 'high';
}

export function leverageBoard(trades: DnaTrade[]): DnaBucketStat[] {
  return LEV_BUCKETS.map((meta) =>
    withShares(
      trades.filter((t) => t.result !== 'open' && levBucketOf(t.leverage) === meta.key),
      trades,
      { key: meta.key, label: meta.label, emoji: meta.key === 'high' ? '🔥' : meta.key === 'unknown' ? '❔' : '⚖️' },
    ),
  );
}

/* ------------------------------------------------------------------ *
 * ③ 뇌동매매(복수 매매) 탐지
 * ------------------------------------------------------------------ */

export interface RevengeReport {
  /** 기준 창(분) */
  windowMin: number;
  /** 손실 청산 직후 창 안에 다시 들어간 횟수 */
  count: number;
  /** 종료 매매 중 복수 매매 비중(%) */
  sharePct: number;
  /** 복수 매매의 승률(%) */
  winRate: number;
  cumR: number;
  /** 복수 매매가 전체 손실 R 에서 차지하는 비중(%) */
  lossSharePct: number;
  /** 최근 사례(최대 5건) */
  samples: DnaTrade[];
}

/** 직전 매매가 **손실로 청산**된 뒤 `windowMin` 분 안에 다시 진입한 매매를 찾는다. */
export function revengeReport(trades: DnaTrade[], windowMin = 15): RevengeReport {
  const closed = closedAsc(trades);
  const windowMs = Math.max(1, windowMin) * 60_000;
  const hits: DnaTrade[] = [];
  for (let i = 1; i < closed.length; i += 1) {
    const prev = closed[i - 1];
    const cur = closed[i];
    if (prev.result !== 'loss' || prev.closedAt == null) continue;
    const gap = cur.openedAt - prev.closedAt;
    if (gap >= 0 && gap <= windowMs) hits.push(cur);
  }
  const stat = summarize(hits);
  const totalLoss = closed.reduce((acc, t) => acc + (t.result === 'loss' ? -Math.min(0, t.r) : 0), 0);
  const hitLoss = hits.reduce((acc, t) => acc + (t.result === 'loss' ? -Math.min(0, t.r) : 0), 0);
  return {
    windowMin,
    count: hits.length,
    sharePct: closed.length ? (hits.length / closed.length) * 100 : 0,
    winRate: stat.winRate,
    cumR: stat.cumR,
    lossSharePct: totalLoss > 0 ? (hitLoss / totalLoss) * 100 : 0,
    samples: hits.slice(-5).reverse(),
  };
}

/* ------------------------------------------------------------------ *
 * ④ 롱 vs 숏 · 보유 시간
 * ------------------------------------------------------------------ */

export interface SideRow extends DnaStat {
  side: 'long' | 'short';
  label: string;
}

export function sideBoard(trades: DnaTrade[]): SideRow[] {
  return (['long', 'short'] as const).map((side) => ({
    ...summarize(trades.filter((t) => t.result !== 'open' && t.side === side)),
    side,
    label: side === 'long' ? '롱' : '숏',
  }));
}

export interface HoldBucketMeta {
  key: string;
  label: string;
  /** 상한(ms) — 마지막 구간은 Infinity */
  maxMs: number;
}

export const HOLD_BUCKETS: HoldBucketMeta[] = [
  { key: 'under1h', label: '1시간 이내', maxMs: 3_600_000 },
  { key: '1to4h', label: '1~4시간', maxMs: 4 * 3_600_000 },
  { key: '4to12h', label: '4~12시간', maxMs: 12 * 3_600_000 },
  { key: 'over12h', label: '12시간 이상', maxMs: Infinity },
];

export function holdBucketOf(holdMs: number | null): string | null {
  if (holdMs == null || !Number.isFinite(holdMs) || holdMs < 0) return null;
  for (const b of HOLD_BUCKETS) if (holdMs < b.maxMs) return b.key;
  return HOLD_BUCKETS[HOLD_BUCKETS.length - 1].key;
}

export function holdBoard(trades: DnaTrade[]): DnaBucketStat[] {
  return HOLD_BUCKETS.map((meta) =>
    withShares(
      trades.filter((t) => t.result !== 'open' && holdBucketOf(t.holdMs) === meta.key),
      trades,
      { key: meta.key, label: meta.label, emoji: '⏱' },
    ),
  );
}

export interface HoldReport {
  /** 승리 매매 평균 보유(ms) */
  winMs: number | null;
  /** 패배 매매 평균 보유(ms) */
  lossMs: number | null;
  winN: number;
  lossN: number;
  buckets: DnaBucketStat[];
}

export function holdReport(trades: DnaTrade[]): HoldReport {
  const withHold = trades.filter((t) => t.result !== 'open' && t.holdMs != null && Number.isFinite(t.holdMs));
  const avg = (list: DnaTrade[]) =>
    list.length ? list.reduce((acc, t) => acc + (t.holdMs ?? 0), 0) / list.length : null;
  const wins = withHold.filter((t) => t.result === 'win');
  const losses = withHold.filter((t) => t.result === 'loss');
  return { winMs: avg(wins), lossMs: avg(losses), winN: wins.length, lossN: losses.length, buckets: holdBoard(trades) };
}

/* ------------------------------------------------------------------ *
 * 진단 — 한 줄 팩트 폭격
 * ------------------------------------------------------------------ */

export type FindingTone = 'bad' | 'warn' | 'good';

export interface DnaFinding {
  tone: FindingTone;
  /** 제목(짧은 팩트) */
  title: string;
  /** 근거 수치 한 줄 */
  detail: string;
  /** 배지용 수치 */
  metric: string;
  /** 같은 종류 중 우선순위가 높을수록 앞에 */
  weight: number;
}

const toneRank: Record<FindingTone, number> = { bad: 0, warn: 1, good: 2 };

/**
 * 진단 문장 — 표본이 MIN_SAMPLE 미만인 구간은 **근거로 쓰지 않는다**.
 * 표본이 CONFIDENT_SAMPLE 미만이면 "참고용" 안내를 붙인다.
 */
export function findings(trades: DnaTrade[], opts: { windowMin?: number } = {}): DnaFinding[] {
  const closed = trades.filter((t) => t.result !== 'open');
  const out: DnaFinding[] = [];
  if (closed.length < MIN_SAMPLE) return out;

  /* ----- 레버리지: 손실이 몰린 구간 ----- */
  const lev = leverageBoard(trades).filter((b) => b.key !== 'unknown' && b.n >= MIN_SAMPLE);
  const worstLev = [...lev].sort((a, b) => a.cumR - b.cumR)[0];
  if (worstLev && worstLev.cumR < 0) {
    const label = `${worstLev.label}(${LEV_BUCKETS.find((b) => b.key === worstLev.key)?.range})`;
    out.push({
      tone: worstLev.winRate < 40 ? 'bad' : 'warn',
      title: `${label} 구간에서 손실이 집중돼요`,
      detail: `${worstLev.n}건 · 승률 ${worstLev.winRate.toFixed(0)}% · 누적 ${worstLev.cumR.toFixed(2)}R · 전체 손실의 ${worstLev.lossSharePct.toFixed(0)}%`,
      metric: `${worstLev.cumR.toFixed(2)}R`,
      weight: 90 + Math.min(9, worstLev.n),
    });
  }
  const bestLev = [...lev].sort((a, b) => b.cumR - a.cumR)[0];
  if (bestLev && bestLev.cumR > 0 && bestLev.key !== worstLev?.key && bestLev.winRate >= 55) {
    out.push({
      tone: 'good',
      title: `${bestLev.label} 구간이 가장 잘 맞아요`,
      detail: `${bestLev.n}건 · 승률 ${bestLev.winRate.toFixed(0)}% · 누적 ${bestLev.cumR.toFixed(2)}R`,
      metric: `${bestLev.winRate.toFixed(0)}%`,
      weight: 40 + bestLev.cumR,
    });
  }

  /* ----- 시간대: 손실·수익이 몰린 구간 ----- */
  const time = timeHeatmap(trades).filter((b) => b.n >= MIN_SAMPLE);
  const worstTime = [...time].sort((a, b) => a.cumR - b.cumR)[0];
  if (worstTime && worstTime.cumR < 0) {
    out.push({
      tone: worstTime.lossSharePct >= 40 ? 'bad' : 'warn',
      title: `${worstTime.emoji} ${worstTime.label} 시간대 승률 ${worstTime.winRate.toFixed(0)}%`,
      detail: `${worstTime.n}건 · 누적 ${worstTime.cumR.toFixed(2)}R · 전체 손실의 ${worstTime.lossSharePct.toFixed(0)}%`,
      metric: `${worstTime.cumR.toFixed(2)}R`,
      weight: 75 + worstTime.lossSharePct / 10,
    });
  }
  const bestTime = [...time].sort((a, b) => b.cumR - a.cumR)[0];
  if (bestTime && bestTime.cumR > 0 && bestTime.key !== worstTime?.key) {
    out.push({
      tone: 'good',
      title: `${bestTime.emoji} ${bestTime.label} 시간대가 가장 좋아요`,
      detail: `${bestTime.n}건 · 승률 ${bestTime.winRate.toFixed(0)}% · 누적 ${bestTime.cumR.toFixed(2)}R`,
      metric: `${bestTime.winRate.toFixed(0)}%`,
      weight: 45 + bestTime.cumR,
    });
  }

  /* ----- 뇌동매매 ----- */
  const revenge = revengeReport(trades, opts.windowMin ?? 15);
  if (revenge.count >= 2) {
    out.push({
      tone: revenge.cumR < 0 ? 'bad' : 'warn',
      title: `손실 직후 ${revenge.windowMin}분 안 재진입 ${revenge.count}회`,
      detail: `승률 ${revenge.winRate.toFixed(0)}% · 누적 ${revenge.cumR.toFixed(2)}R · 전체 손실의 ${revenge.lossSharePct.toFixed(0)}%`,
      metric: `${revenge.count}회`,
      weight: 95 + revenge.count,
    });
  }

  /* ----- 롱 vs 숏 ----- */
  const sides = sideBoard(trades).filter((s) => s.n >= MIN_SAMPLE);
  if (sides.length === 2) {
    const [a, b] = [...sides].sort((x, y) => y.cumR - x.cumR);
    if (a.cumR > 0 && b.cumR < 0) {
      out.push({
        tone: 'warn',
        title: `${a.label}만 플러스 · ${b.label}은 마이너스`,
        detail: `${a.label} ${a.n}건 ${a.cumR.toFixed(2)}R / ${b.label} ${b.n}건 ${b.cumR.toFixed(2)}R (승률 ${a.winRate.toFixed(0)}% vs ${b.winRate.toFixed(0)}%)`,
        metric: `${b.cumR.toFixed(2)}R`,
        weight: 60 + Math.abs(b.cumR),
      });
    }
  }

  /* ----- 보유 시간 ----- */
  const hold = holdReport(trades);
  if (hold.winMs && hold.lossMs) {
    if (hold.lossMs > hold.winMs * 1.5) {
      out.push({
        tone: 'bad',
        title: '지는 포지션을 오래 들고 있어요',
        detail: `패배 평균 ${fmtHold(hold.lossMs)} vs 승리 평균 ${fmtHold(hold.winMs)} — 손절을 늦추는 습관`,
        metric: fmtHold(hold.lossMs),
        weight: 70,
      });
    } else if (hold.winMs > hold.lossMs * 2 && hold.winMs > 2 * 3_600_000) {
      out.push({
        tone: 'good',
        title: '이익은 길게, 손실은 짧게 가져가요',
        detail: `승리 평균 ${fmtHold(hold.winMs)} · 패배 평균 ${fmtHold(hold.lossMs)}`,
        metric: fmtHold(hold.winMs),
        weight: 35,
      });
    }
  }

  if (closed.length < CONFIDENT_SAMPLE) {
    out.push({
      tone: 'warn',
      title: `표본 ${closed.length}건 — 아직 참고용이에요`,
      detail: `${CONFIDENT_SAMPLE}건 이상 쌓이면 구간별 진단이 더 단단해집니다`,
      metric: `${closed.length}건`,
      weight: 5,
    });
  }

  return out
    .sort((a, b) => toneRank[a.tone] - toneRank[b.tone] || b.weight - a.weight)
    .slice(0, 5);
}

/** `6.2시간` · `45분` · `2일 3시간` */
export function fmtHold(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  const min = ms / 60_000;
  if (min < 1) return '1분 미만';
  if (min < 60) return `${Math.round(min)}분`;
  const hours = ms / 3_600_000;
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)}시간`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours - days * 24);
  return rest > 0 ? `${days}일 ${rest}시간` : `${days}일`;
}

/* ------------------------------------------------------------------ *
 * 요약 헤드라인
 * ------------------------------------------------------------------ */

export interface DnaProfile {
  /** 분석에 쓴 종료 건수 */
  closed: number;
  /** 내 실제 진입으로 표시된 건수 */
  own: number;
  stat: DnaStat;
  bestTime: DnaBucketStat | null;
  worstTime: DnaBucketStat | null;
  bestSide: SideRow | null;
  revenge: RevengeReport;
  /** 카드 상단 한 줄 */
  headline: string;
  /** 표본이 충분한가 */
  confident: boolean;
}

export function dnaProfile(trades: DnaTrade[], opts: { windowMin?: number } = {}): DnaProfile {
  const stat = summarize(trades);
  const time = timeHeatmap(trades).filter((b) => b.n >= MIN_SAMPLE);
  const bestTime = [...time].sort((a, b) => b.cumR - a.cumR)[0] ?? null;
  const worstTime = [...time].sort((a, b) => a.cumR - b.cumR)[0] ?? null;
  const sides = sideBoard(trades).filter((s) => s.n >= MIN_SAMPLE);
  const bestSide = [...sides].sort((a, b) => b.cumR - a.cumR)[0] ?? null;
  const profile: DnaProfile = {
    closed: stat.wins + stat.losses,
    own: trades.filter((t) => t.own).length,
    stat,
    bestTime: bestTime && bestTime.cumR > 0 ? bestTime : null,
    worstTime: worstTime && worstTime.cumR < 0 ? worstTime : null,
    bestSide,
    revenge: revengeReport(trades, opts.windowMin ?? 15),
    headline: '',
    confident: stat.wins + stat.losses >= CONFIDENT_SAMPLE,
  };
  const parts: string[] = [];
  if (profile.bestTime) parts.push(`잘 맞는 시간 ${profile.bestTime.emoji} ${profile.bestTime.label}`);
  if (profile.worstTime) parts.push(`손실 집중 ${profile.worstTime.emoji} ${profile.worstTime.label}`);
  if (profile.bestSide && stat.wins + stat.losses >= MIN_SAMPLE) parts.push(`${profile.bestSide.label} 우위`);
  if (profile.revenge.count >= 2) parts.push(`재진입 ${profile.revenge.count}회`);
  profile.headline = parts.length ? parts.join(' · ') : '기록이 쌓이면 습관이 보입니다';
  return profile;
}

/* ------------------------------------------------------------------ *
 * 연패 쿨다운 — 자동매매 방어장치와 같은 계산을 쓴다
 * ------------------------------------------------------------------ */

export interface CooldownConfig {
  /** 연패 몇 번부터 멈출까 — 0 이면 끔 */
  losses: number;
  /** 몇 분 동안 멈출까 */
  minutes: number;
}

export interface CooldownState {
  /** 이 시각까지 새 진입을 막는다 */
  until: number;
  /** 감지된 연패 수 */
  streak: number;
  /** 마지막 손실 청산 시각 */
  lastLossAt: number;
}

/**
 * 마지막 매매가 **연속 손실**로 끝났고 그 청산이 `minutes` 안이면 쿨다운 상태를 돌려준다.
 *  · 청산 시각을 모르는 기록은 쿨다운 근거로 쓰지 않는다(추정으로 주문을 막지 않는다).
 *  · 진행 중(open) 매매는 연패를 끊지도 늘리지도 않는다.
 */
export function lossStreakCooldown(
  trades: DnaTrade[],
  config: CooldownConfig,
  now: number,
): CooldownState | null {
  if (!config || !(config.losses > 0) || !(config.minutes > 0)) return null;
  const closed = closedAsc(trades).filter((t) => t.closedAt != null);
  if (closed.length === 0) return null;
  let streak = 0;
  for (let i = closed.length - 1; i >= 0; i -= 1) {
    if (closed[i].result === 'loss') streak += 1;
    else break;
  }
  if (streak < config.losses) return null;
  const last = closed[closed.length - 1];
  const lastLossAt = Number(last.closedAt);
  const until = lastLossAt + config.minutes * 60_000;
  if (!(now < until)) return null;
  return { until, streak, lastLossAt };
}

/** 남은 쿨다운(분, 올림) — 지났으면 0 */
export function cooldownRemainMin(state: CooldownState | null, now: number): number {
  if (!state) return 0;
  return Math.max(0, Math.ceil((state.until - now) / 60_000));
}
