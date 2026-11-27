/**
 * 📊 미국 경제지표 캘린더 · 예상치 분석 · 롱/숏 매매 가이드 (v1.5.8)
 *
 * 무엇을 담았나
 *  · 2026-12 ~ 2027-03 의 **실제 발표 일정**(BLS·BEA·Fed 공식 캘린더)을 KST 로 옮겨 담았다.
 *  · 예상치는 **2026-11-27 기준 시장 컨센서스**(Investing.com·Kalshi·Continuum Economics·RBC·
 *    Wells Fargo·Cleveland Fed nowcast)를 그대로 옮겼고, 어디서 온 값인지 `consensusBasis` 에 적었다.
 *  · 지표마다 **예상 상회/부합/하회 시 롱·숏 어느 쪽이 유리한지**와 그 이유를 붙였다.
 *
 * 지금 시장 상황(2026-11-27)
 *  · 기준금리 3.75~4.00% — 9월 25bp 인상, 10월 동결(10-2, 두 명은 인상 주장).
 *  · 10월 CPI +0.4% m/m(예상 0.3), 근원 +0.3%(3개월 연속), 10월 PCE 근원 3.3% y/y(예상 3.2).
 *  · 12월 8~9일 FOMC 인상 확률 약 92~98%(25bp → 4.00~4.25%), SEP·점도표 동반.
 *  · BTC 약 $61,500 — 사상 최고($126,200, 2025-10) 대비 −50%, 11월 ETF 순유출 $5.39B(월간 최대).
 *  ⇒ **인플레가 뜨거우면 '인상 지속' → 위험자산 압박(숏), 식으면 '긴축 종료' → 안도 랠리(롱)** 구조다.
 *  단, 고용이 급격히 무너지는 경우(0K 이하)는 '금리'보다 '경기침체'가 앞서 초기 반응이 롱이어도
 *  지속되지 않는다 — 그 예외를 각 카드에 적어 두었다.
 *
 * 주의: 예상치는 발표 전까지 바뀐다. 이 파일의 `CONSENSUS_AS_OF` 이후 컨센서스가 움직였으면
 * 숫자보다 '방향(상회=숏 / 하회=롱)'을 먼저 보라. 투자 권유가 아니다.
 */

export type MacroCategory = 'rates' | 'inflation' | 'jobs' | 'growth' | 'consumer';
export type MacroVerdict = 'long' | 'short' | 'neutral' | 'mixed';

export interface MacroScenario {
  /** '예상 상회' · '예상 부합' · '예상 하회' */
  label: string;
  verdict: MacroVerdict;
  /** 강 · 중 · 약 — 예상과의 괴리 크기에 따른 확신도 */
  strength: '강' | '중' | '약';
  /** 왜 그 방향인지 + 실제 대응 */
  text: string;
}

export interface MacroEvent {
  id: string;
  /** 카드 제목 — '미국 11월 비농업고용(NFP)' */
  name: string;
  /** 배지용 짧은 이름 — NFP · CPI · FOMC */
  short: string;
  /** 발표 시각 (KST, ISO8601 +09:00) */
  at: string;
  /** 중요도 1~3 (★★★ = 변동성 큼) */
  stars: 1 | 2 | 3;
  category: MacroCategory;
  /** 컨센서스 (표시용) — '▲ +90K' */
  consensus: string;
  /** 이전치 */
  previous: string;
  /** 컨센서스 근거 — 왜 이 숫자가 나오는지 (출처 포함) */
  consensusBasis: string[];
  /** 최근 추세 한 줄 요약 */
  trend: string;
  above: MacroScenario;
  inline: MacroScenario;
  below: MacroScenario;
  /** 발표 직전·직후 대응 요령 */
  playbook: string;
  /** 근거 출처 */
  source: string;
}

/** 예상치 기준일 — 이 날짜 이후 컨센서스가 움직였을 수 있다 */
export const CONSENSUS_AS_OF = '2026-11-27';

/** 현재 정책·물가·시장 배경 — 화면 상단 요약 카드 */
export const MACRO_CONTEXT = {
  policyRate: '3.75 ~ 4.00%',
  nextMove: '12월 9일 25bp 인상 확률 약 92~98% (4.00~4.25%)',
  inflation: '10월 CPI +0.4% m/m · 근원 +0.3% (3개월 연속) · PCE 근원 3.3% y/y',
  jobs: '10월 NFP +165K(예상 65K) · 실업률 4.1% · 6개월 평균 +82.5K',
  crypto: 'BTC 약 $61,500 · ATH 대비 −50% · 11월 ETF 순유출 $5.39B',
  rule: '인플레·고용이 뜨거우면 숏, 식으면 롱 — 단 고용 급락은 예외(경기침체 우려)',
  asOf: CONSENSUS_AS_OF,
} as const;

export const MACRO_EVENTS: MacroEvent[] = [
  {
    id: 'ism-mfg-2026-11',
    name: '미국 11월 ISM 제조업 PMI',
    short: 'ISM 제조업',
    at: '2026-12-02T00:00:00+09:00',
    stars: 2,
    category: 'growth',
    consensus: '55.0',
    previous: '55.5',
    consensusBasis: [
      '10월 55.5로 4개월 연속 확장(50 이상) — 관세·AI 데이터센터 투자가 제조업 수주를 받치고 있다.',
      '11월 컨센서스 55.0은 “조금 식지만 확장 유지” 수준. Bloomberg·Wells Fargo 모두 55.0.',
      '제조업은 GDP 비중이 작아 코인 반응은 제한적 — 국채금리 방향으로만 읽는다.',
    ],
    trend: '확장 국면 유지 · 신규주문은 개선, 고용지수는 보합',
    above: {
      label: '예상 상회',
      verdict: 'short',
      strength: '약',
      text: '경기 강세 → 연준 인상 명분 강화. 금리·달러 상승으로 위험자산 압박 → 🔴 숏 쪽 유리(반응 짧음).',
    },
    inline: {
      label: '예상 부합',
      verdict: 'neutral',
      strength: '약',
      text: '이미 알려진 흐름 — 코인은 거의 무반응. 다음 날 ADP·ISM 서비스까지 기다린다.',
    },
    below: {
      label: '예상 하회',
      verdict: 'long',
      strength: '약',
      text: '제조업 둔화 신호 → 인상 기대 후퇴 → 🟢 롱 쪽 유리. 50 아래로 내려가면 반응이 커진다.',
    },
    playbook: '발표 30분 전 포지션을 줄이고, 50선(확장/위축 경계)을 넘는지로 방향을 판단한다.',
    source: 'ISM 제조업 PMI 10월 55.5 (2026-11-02) · 컨센서스 55.0 (Wells Fargo Week Ahead 2026-11-25)',
  },
  {
    id: 'jolts-2026-10',
    name: '미국 10월 구인건수(JOLTS)',
    short: 'JOLTS',
    at: '2026-12-02T00:00:00+09:00',
    stars: 2,
    category: 'jobs',
    consensus: '약 7.1M',
    previous: '약 7.2M',
    consensusBasis: [
      '2026년 내내 7.0~7.4M 박스 — 구인은 줄지도 늘지도 않는 ‘균형’ 상태다.',
      'Indeed 구인공고가 2025년 5월 이후 최고로 올라와 상방 위험이 조금 있다(11월 기준).',
      '연준은 ‘구인/실업자 비율 1.0 근처’를 노동시장 균형의 증거로 본다.',
    ],
    trend: '구인 정체 · 자발적 이직(quits) 감소 · 해고는 사상 최저 수준',
    above: {
      label: '예상 상회',
      verdict: 'short',
      strength: '약',
      text: '노동수요가 강하다 → 임금·물가 압력 지속 → 인상 명분 → 🔴 숏 유리(약).',
    },
    inline: {
      label: '예상 부합',
      verdict: 'neutral',
      strength: '약',
      text: '균형 유지 — 금리 기대 변화 없음. 코인 반응 미미.',
    },
    below: {
      label: '예상 하회',
      verdict: 'long',
      strength: '약',
      text: '구인 급감 → 노동시장 냉각 → 인상 기대 후퇴 → 🟢 롱 유리. 7.0M 아래면 반응 확대.',
    },
    playbook: 'NFP(12/4)의 선행 지표로만 쓴다 — 단독 매매보다 3일 뒤 고용보고서 방향을 가늠한다.',
    source: 'BLS JOLTS 10월 발표 2026-12-01 10:00 ET · 9월 7.2M 수준 · 컨센서스 추정',
  },
  {
    id: 'ism-svc-2026-11',
    name: '미국 11월 ISM 서비스업 PMI',
    short: 'ISM 서비스',
    at: '2026-12-04T00:00:00+09:00',
    stars: 2,
    category: 'growth',
    consensus: '54.7',
    previous: '54.9',
    consensusBasis: [
      '서비스업이 미국 GDP의 70% 이상 — 제조업보다 금리·코인에 더 중요하다.',
      '10월 54.9로 8개월 연속 확장. 11월 54.7은 “거의 그대로”라는 뜻.',
      '물가 지수(지불가격)가 60을 넘으면 인플레 재점화 신호로 읽힌다 — 헤드라인보다 이 항목이 중요.',
    ],
    trend: '확장 유지 · 고용지수 48대로 둔화 · 지불가격은 60 근처',
    above: {
      label: '예상 상회',
      verdict: 'short',
      strength: '중',
      text: '서비스 물가·고용이 강하다 → 인상 지속 → 🔴 숏 유리. 지불가격 60+면 반응이 커진다.',
    },
    inline: {
      label: '예상 부합',
      verdict: 'neutral',
      strength: '약',
      text: '예상 범위 — 금리 기대 유지. 코인은 다음 날 NFP를 기다린다.',
    },
    below: {
      label: '예상 하회',
      verdict: 'long',
      strength: '중',
      text: '서비스 둔화 → 인상 사이클 종료 기대 → 🟢 롱 유리. 52 아래면 ‘경기 둔화’ 해석이 앞선다.',
    },
    playbook: '헤드라인보다 ‘지불가격’과 ‘고용’ 세부지수로 방향을 잡는다.',
    source: 'ISM 서비스 PMI 10월 54.9 (2026-11-04) · 컨센서스 54.7 (Wells Fargo Week Ahead)',
  },
  {
    id: 'nfp-2026-11',
    name: '미국 11월 비농업고용(NFP)',
    short: 'NFP',
    at: '2026-12-04T22:30:00+09:00',
    stars: 3,
    category: 'jobs',
    consensus: '▲ +90K',
    previous: '+165K (10월)',
    consensusBasis: [
      '10월 +165K(예상 65K)는 전문·사업서비스 +70K, 의료 +53K가 끌어올린 이례적 강세 — 11월엔 그 반작용을 본다.',
      'Investing.com·Trading Economics 컨센서스 +90K, Continuum +95K, Wells Fargo +80K — 6개월 평균 +82.5K 근처로 회귀하는 그림.',
      '실업률 4.1% 유지(10월 4.14%에서 반올림), 시간당 임금 +0.3% m/m(10월 +0.4%) 예상.',
      '연준은 12/9 회의 전 마지막 고용지표로 이 보고서를 본다 — 인상 확정(약 92~98%)에 영향.',
    ],
    trend: '고용은 ‘식었지만 무너지지 않음’ · 임금 상승률 3.0%대로 둔화 · 해고 최저',
    above: {
      label: '예상 상회 (+150K 이상)',
      verdict: 'short',
      strength: '강',
      text: '고용·임금이 강하면 연준은 12월 인상에 더 확신하고 2027년 추가 인상까지 시사한다 → 금리·달러↑ 위험자산↓ → 🔴 숏 유리. 임금 +0.4% 이상이면 강도가 커진다.',
    },
    inline: {
      label: '예상 부합 (+70~110K)',
      verdict: 'neutral',
      strength: '중',
      text: '이미 가격에 반영된 시나리오 — 첫 15분 변동성 뒤 방향이 사라지기 쉽다. 12/10 CPI까지 관망이 낫다.',
    },
    below: {
      label: '예상 하회 (+30K 이하)',
      verdict: 'long',
      strength: '중',
      text: '고용 둔화 → 인상 명분 약화 → 🟢 롱 유리. 단 실업률이 4.3% 이상으로 튀면 ‘경기침체’ 해석이 앞서 랠리가 짧다(초기 롱 → 되돌림 주의).',
    },
    playbook:
      '발표 직후 5분은 스프레드가 넓다 — 15분봉 마감으로 방향을 확인하고 들어간다. 실업률과 임금을 함께 본다.',
    source:
      'BLS Employment Situation 11월 발표 2026-12-04 08:30 ET · Investing.com/Continuum/Wells Fargo 컨센서스(2026-11-25~27) · 10월 실적 +165K/4.1%',
  },
  {
    id: 'fomc-2026-12',
    name: 'FOMC 금리 결정 + 점도표(SEP)',
    short: 'FOMC',
    at: '2026-12-10T04:00:00+09:00',
    stars: 3,
    category: 'rates',
    consensus: '25bp 인상 → 4.00~4.25%',
    previous: '3.75~4.00% (10월 동결)',
    consensusBasis: [
      'CME FedWatch 92~98%가 25bp 인상을 반영(11/26 기준) — 사실상 확정 이벤트.',
      '10월 PCE 근원 3.3%(예상 3.2), 3분기 GDP 4.3%로 인상 명분이 굳었다.',
      '9월 점도표 중간값 4.125% — 18명 중 16명이 현 금리보다 높은 점을 찍었다.',
      '이번 회의는 SEP(경제전망)·점도표가 함께 나오는 회의 — 금리 결정보다 ‘2027년 경로’가 핵심.',
    ],
    trend: '긴축 재개 사이클 · Warsh 의장은 포워드가이던스에 부정적 · 10월 반대표 2명(인상 주장)',
    above: {
      label: '50bp 인상 또는 매파적 점도표',
      verdict: 'short',
      strength: '강',
      text: '예상보다 큰 인상이거나 2027년 점도표가 2회 이상 추가 인상을 가리키면 → 실질금리 급등 → 🔴 숏 유리(강).',
    },
    inline: {
      label: '25bp 인상 + “추가 인상 열어둠”',
      verdict: 'short',
      strength: '중',
      text: '이미 반영된 결정. 기자회견에서 ‘추가 인상 여지’를 강조하면 안도 후 재하락 → 🔴 숏 쪽 우위.',
    },
    below: {
      label: '25bp 인상 + “일시 멈춤(pause) 시사”',
      verdict: 'long',
      strength: '강',
      text: '인상은 하되 “지켜보겠다”는 표현이 나오면 긴축 종료 기대 → 금리·달러↓ → 🟢 롱 유리(강). 점도표가 2027년 인상 0~1회로 내려오면 랠리가 가장 크다.',
    },
    playbook:
      '결정(04:00 KST) → 기자회견(04:30 KST) 사이가 가장 위험하다. 첫 반응에 추격하지 말고 기자회견 발언 후 15분봉으로 확인한다.',
    source:
      'Fed FOMC 2026-12-08~09 (결정 14:00 ET) · CME FedWatch 92~98%(2026-11-26) · 9월 SEP 점도표 중간값 4.125%',
  },
  {
    id: 'cpi-2026-11',
    name: '미국 11월 소비자물가(CPI)',
    short: 'CPI',
    at: '2026-12-10T22:30:00+09:00',
    stars: 3,
    category: 'inflation',
    consensus: '헤드라인 0.0% m/m · 3.7% y/y / 근원 0.2~0.3% · 2.9~3.0%',
    previous: '+0.4% m/m · 근원 +0.3%',
    consensusBasis: [
      '휘발유 −6.6% 급락이 헤드라인을 0.0%(Kalshi 중간값 −0.1%)로 끌어내린다 — 에너지 −3.3% 기여.',
      '근원은 3개월 연속 +0.3% 흐름 — Continuum +0.3%(0.28%), Kalshi 중간값 +0.2%로 갈린다.',
      '10월 CPI는 정부 셧다운으로 전년동월 데이터가 없어 y/y를 못 냈다 — 11월 3.7~3.9%는 9월(3.7%)과 비교한 값.',
      '주거비 +0.26%, 항공료 상방 위험 — 근원이 0.3%로 나오면 ‘끈적한 물가’ 확인.',
    ],
    trend: '헤드라인은 유가로 진정, 근원은 3개월 연속 0.3% — 연준 목표(2%)와 거리가 멀다',
    above: {
      label: '예상 상회 (근원 0.4%↑ 또는 헤드라인 +0.2%↑)',
      verdict: 'short',
      strength: '강',
      text: '근원이 다시 0.4%로 튀면 12월 인상에 이어 2027년 1·3월 인상까지 가격에 들어간다 → 🔴 숏 유리(강). 11/10 CPI 서프라이즈 때 BTC가 급락한 패턴과 같다.',
    },
    inline: {
      label: '예상 부합 (근원 0.2~0.3%)',
      verdict: 'neutral',
      strength: '중',
      text: '컨센서스 소화 — 이미 인상은 반영됐다. 헤드라인 −0.1%가 나오면 ‘유가발 둔화’로 짧은 롱 반응이 나올 수 있다.',
    },
    below: {
      label: '예상 하회 (근원 0.1% 이하)',
      verdict: 'long',
      strength: '강',
      text: '근원이 0.1%로 꺾이면 ‘긴축 종료’ 기대가 급격히 커진다 → 🟢 롱 유리(강). 달러·금리 급락과 함께 알트코인 반등 폭이 커진다.',
    },
    playbook:
      '22:30 KST 발표 — 근원 m/m을 먼저 본다. 헤드라인만 보고 움직이면 유가 착시에 걸린다.',
    source:
      'BLS CPI 11월 발표 2026-12-10 08:30 ET · Continuum Economics(2026-11-20) · Kalshi/Polymarket 중간값(2026-11-27) · 10월 +0.4%/근원 +0.3%',
  },
  {
    id: 'ppi-2026-11',
    name: '미국 11월 생산자물가(PPI)',
    short: 'PPI',
    at: '2026-12-15T22:30:00+09:00',
    stars: 2,
    category: 'inflation',
    consensus: '−0.1% m/m · 5.9% y/y (근원 +0.3% · 5.1%)',
    previous: '+0.3% m/m · 6.5% y/y',
    consensusBasis: [
      '10월 PPI는 +0.3% m/m, 전년비 6.5% — 2022년 11월 이후 최대 상승폭이었다.',
      '11월은 휘발유 급락으로 헤드라인 −0.1%, 전년비 5.9%로 내려온다는 전망(Continuum).',
      '근원(식품·에너지 제외)은 +0.3%로 10월과 같은 속도 — 5.1% y/y 유지.',
      '운송·창고 비용(화물운임 +3.9%)이 물가에 전가되는지가 관전 포인트.',
    ],
    trend: '생산자 물가 상승률은 정점(6.5%)에서 내려오는 중이나 여전히 높다',
    above: {
      label: '예상 상회 (근원 0.4%↑)',
      verdict: 'short',
      strength: '중',
      text: '근원 PPI가 높으면 12/23 PCE 근원 상방 위험 → 인상 지속 → 🔴 숏 유리(중).',
    },
    inline: {
      label: '예상 부합',
      verdict: 'neutral',
      strength: '약',
      text: 'CPI(12/10)에서 방향이 이미 정해졌다 — 추가 정보가 적어 반응이 짧다.',
    },
    below: {
      label: '예상 하회 (근원 0.1%↓)',
      verdict: 'long',
      strength: '중',
      text: '생산단 물가 둔화는 6~9개월 뒤 소비자물가 둔화로 이어진다 → 🟢 롱 유리(중).',
    },
    playbook: 'FOMC·CPI를 지나온 뒤라 ‘근원’만 본다. 헤드라인 마이너스는 유가 효과라 의미가 작다.',
    source: 'BLS PPI 11월 발표 2026-12-15 08:30 ET · Continuum Economics(2026-11-23) · 10월 +0.3%/6.5%',
  },
  {
    id: 'retail-2026-11',
    name: '미국 11월 소매판매',
    short: '소매판매',
    at: '2026-12-16T22:30:00+09:00',
    stars: 2,
    category: 'consumer',
    consensus: '+0.2% m/m (근원 +0.3%)',
    previous: '+0.2% (근원 통제군 +0.6%)',
    consensusBasis: [
      '10월 +0.2%로 예상 부합 — 물가 반영 후로는 보합이었다.',
      '통제군(GDP 반영 항목) +0.6%는 온라인·비점포가 3분의 2를 차지한 결과 — 물가 조정 후엔 사실상 횡보.',
      '11월은 블랙프라이데이 효과로 헤드라인은 반등하지만, 실질 소비는 임금(+3%대)과 저축률 하락에 눌린다.',
    ],
    trend: '명목 소비는 버티지만 실질은 정체 · 신용카드 연체·저축률 하락이 부담',
    above: {
      label: '예상 상회 (+0.5%↑)',
      verdict: 'short',
      strength: '약',
      text: '소비가 강하면 인상 여지가 커진다 → 🔴 숏 유리(약). 다만 ‘경기 강세’로 주식이 오르면 코인도 따라오는 혼재가 가능.',
    },
    inline: {
      label: '예상 부합',
      verdict: 'neutral',
      strength: '약',
      text: '연말 소비는 계절성 — 방향 정보가 적다.',
    },
    below: {
      label: '예상 하회 (0% 이하)',
      verdict: 'long',
      strength: '약',
      text: '소비 둔화 → 인상 명분 약화 → 🟢 롱 유리(약). −0.5% 이하면 ‘경기 둔화’ 해석이 앞선다.',
    },
    playbook: '통제군(Control Group) 수치를 본다 — 헤드라인은 자동차·휘발유에 흔들린다.',
    source: 'Census 소매판매 11월 발표 2026-12-16 08:30 ET · 10월 +0.2%/통제군 +0.6%(2026-11-17)',
  },
  {
    id: 'pce-2026-11',
    name: '미국 11월 PCE 물가 + 3분기 GDP 확정치',
    short: 'PCE',
    at: '2026-12-23T22:30:00+09:00',
    stars: 3,
    category: 'inflation',
    consensus: '근원 PCE +0.3% m/m · 3.3% y/y (헤드라인 3.8~3.9%)',
    previous: '근원 +0.3% · 3.3% (10월)',
    consensusBasis: [
      '10월 근원 PCE 3.3%(예상 3.2), 헤드라인 3.8% — 연준이 보는 물가지표다.',
      '11월은 CPI 근원(0.2~0.3%)과 PPI 의료·항공료 하락을 반영해 0.3% 수준으로 추정한다(공식 컨센서스 발표 전 — 추정치).',
      '3분기 GDP는 2차 4.3%에서 확정치가 나온다 — 4%대 성장이면 ‘금리 높아도 버틴다’는 신호.',
      '연준 목표 2% 대비 1.3%p 높은 수준 — 2027년 인상 경로의 근거.',
    ],
    trend: '근원 PCE 3.1%→3.3% 재상승 · 에너지·관세·서비스가 압력',
    above: {
      label: '예상 상회 (근원 0.4%↑/3.4%↑)',
      verdict: 'short',
      strength: '강',
      text: '연준이 가장 중시하는 지표가 뜨거우면 2027년 1·3월 인상이 굳는다 → 🔴 숏 유리(강).',
    },
    inline: {
      label: '예상 부합',
      verdict: 'neutral',
      strength: '중',
      text: '이미 3.3%가 알려졌다 — GDP 확정치가 4%대면 금리 상방 압력이 유지된다.',
    },
    below: {
      label: '예상 하회 (근원 0.2%/3.2%↓)',
      verdict: 'long',
      strength: '중',
      text: '물가가 꺾이면 ‘인상 사이클 종료’ 기대 → 🟢 롱 유리(중). 연말 유동성이 얇아 움직임이 과장될 수 있다.',
    },
    playbook: '연말 저유동성 구간 — 호가 공백으로 급등락이 나온다. 평소의 절반 사이즈로 대응한다.',
    source: 'BEA Personal Income & Outlays 11월 2026-12-23 08:30 ET · 10월 근원 3.3%(2026-11-25) · 컨센서스는 추정',
  },
  {
    id: 'nfp-2026-12',
    name: '미국 12월 비농업고용(NFP)',
    short: 'NFP',
    at: '2027-01-08T22:30:00+09:00',
    stars: 3,
    category: 'jobs',
    consensus: '발표 전 (11월 결과가 기준)',
    previous: '11월 결과 대기',
    consensusBasis: [
      'BLS 일정상 12월 고용보고서는 2027-01-08(금) 08:30 ET — 새해 첫 주요 지표다.',
      '컨센서스는 12월 말에 형성된다 — 그 전에는 11월 결과와 6개월 평균(+82.5K)이 기준.',
      '1월 FOMC(1/26~27) 전 마지막 고용지표라 ‘추가 인상 여부’를 가른다.',
    ],
    trend: '고용 증가폭은 10만 명 아래로 둔화 · 실업률 4.1%대 유지',
    above: {
      label: '예상 상회',
      verdict: 'short',
      strength: '중',
      text: '고용이 강하면 1월 FOMC 추가 인상 확률↑ → 🔴 숏 유리(중).',
    },
    inline: {
      label: '예상 부합',
      verdict: 'neutral',
      strength: '중',
      text: '연초 유동성 복귀와 겹쳐 방향이 엇갈리기 쉽다 — 1월 CPI(1/13)까지 관망.',
    },
    below: {
      label: '예상 하회',
      verdict: 'long',
      strength: '중',
      text: '고용 둔화 → 인상 종료 기대 → 🟢 롱 유리(중). 실업률 급등 시엔 경기침체 해석 주의.',
    },
    playbook: '연초 첫 고용지표 — 12월 계절성(리테일·택배) 조정을 감안해 3개월 평균으로 읽는다.',
    source: 'BLS Employment Situation 12월 발표 2027-01-08 08:30 ET (Admirals/BLS 일정)',
  },
  {
    id: 'cpi-2026-12',
    name: '미국 12월 소비자물가(CPI)',
    short: 'CPI',
    at: '2027-01-13T22:30:00+09:00',
    stars: 3,
    category: 'inflation',
    consensus: '0.0% m/m · 3.4% y/y (근원 +0.3% · 2.9%)',
    previous: '11월 결과 대기',
    consensusBasis: [
      'Kalshi 중간값(2026-11-27): 12월 헤드라인 0.0% m/m, 3.4% y/y, 근원 +0.3%/2.9%.',
      '12월은 2026년 연간 인플레이션을 확정하는 보고서 — 2027년 금리 경로의 출발점.',
      '유가 안정이 헤드라인을 누르지만 근원 서비스는 0.3% 고착.',
    ],
    trend: '헤드라인 3%대 중반으로 하락 · 근원 2.9~3.0% 정체',
    above: {
      label: '예상 상회 (근원 0.4%↑)',
      verdict: 'short',
      strength: '강',
      text: '연간 물가가 3.5% 이상으로 확정되면 3월 인상까지 가격에 들어간다 → 🔴 숏 유리(강).',
    },
    inline: {
      label: '예상 부합',
      verdict: 'neutral',
      strength: '중',
      text: '연간 3.4% 수준이면 ‘고착’ — 금리 기대 유지, 코인은 방향성 부족.',
    },
    below: {
      label: '예상 하회 (근원 0.2%↓)',
      verdict: 'long',
      strength: '강',
      text: '근원이 꺾이면 ‘2027년 인상 없음’ 기대 → 🟢 롱 유리(강).',
    },
    playbook: '연간(y/y) 확정치와 근원을 함께 본다 — 헤드라인만 보면 유가 착시.',
    source: 'BLS CPI 12월 발표 2027-01-13 08:30 ET · Kalshi 중간값(2026-11-27)',
  },
  {
    id: 'ppi-2026-12',
    name: '미국 12월 생산자물가(PPI)',
    short: 'PPI',
    at: '2027-01-14T22:30:00+09:00',
    stars: 2,
    category: 'inflation',
    consensus: '발표 전 (11월 5.9% y/y 기준)',
    previous: '11월 결과 대기',
    consensusBasis: [
      'BLS 일정상 12월 PPI는 2027-01-14 08:30 ET.',
      '11월 전망은 헤드라인 −0.1%/5.9%, 근원 +0.3%/5.1% — 12월도 유가·화물운임이 변수.',
      '근원 PPI는 CPI보다 6~9개월 선행 — 추세 판단에 쓴다.',
    ],
    trend: '생산자 물가 5~6%대 — 여전히 높지만 정점(6.5%) 아래',
    above: {
      label: '예상 상회',
      verdict: 'short',
      strength: '약',
      text: '근원 PPI 반등 → 3월 인상 위험 → 🔴 숏 유리(약).',
    },
    inline: { label: '예상 부합', verdict: 'neutral', strength: '약', text: 'CPI 다음 날이라 반응이 제한된다.' },
    below: {
      label: '예상 하회',
      verdict: 'long',
      strength: '약',
      text: '생산단 물가 둔화 → 🟢 롱 유리(약).',
    },
    playbook: '근원(식품·에너지 제외)만 본다.',
    source: 'BLS PPI 12월 발표 2027-01-14 08:30 ET · Continuum 11월 전망',
  },
  {
    id: 'fomc-2027-01',
    name: 'FOMC 금리 결정 (1월)',
    short: 'FOMC',
    at: '2027-01-28T04:00:00+09:00',
    stars: 3,
    category: 'rates',
    consensus: '동결 또는 25bp 인상 (12월 점도표가 기준)',
    previous: '12월 결과 대기',
    consensusBasis: [
      '2027-01-26~27 회의 — 점도표(SEP)가 없는 회의라 성명·기자회견 문구가 전부다.',
      '12월 점도표가 2027년 1~2회 인상을 가리키면 1월 인상 확률이 올라간다.',
      'Goldman·Deutsche Bank는 12월·1월·3월 연속 인상을 전망(2026-11 기준).',
    ],
    trend: '인상 사이클 지속 여부의 분수령 · Warsh 의장은 회의 예단을 거부',
    above: {
      label: '인상 + 매파적 성명',
      verdict: 'short',
      strength: '강',
      text: '연속 인상은 시장 예상보다 빠른 긴축 → 🔴 숏 유리(강).',
    },
    inline: {
      label: '동결 + “지켜본다”',
      verdict: 'long',
      strength: '중',
      text: '동결은 ‘일시 멈춤’ 신호 → 🟢 롱 유리(중). 다만 “필요하면 언제든” 문구가 남으면 랠리가 제한된다.',
    },
    below: {
      label: '동결 + 비둘기적 문구',
      verdict: 'long',
      strength: '강',
      text: '긴축 종료를 명시하면 위험자산 랠리 → 🟢 롱 유리(강).',
    },
    playbook: '04:00 KST 결정 → 04:30 기자회견. 성명 문구 변화(‘additional’ 유지 여부)를 먼저 본다.',
    source: 'Fed FOMC 2027-01-26~27 (결정 14:00 ET) · Goldman/Deutsche 전망(2026-11)',
  },
  {
    id: 'pce-2026-12',
    name: '미국 12월 PCE 물가 + 4분기 GDP 속보',
    short: 'PCE',
    at: '2027-01-28T22:30:00+09:00',
    stars: 3,
    category: 'inflation',
    consensus: '발표 전 (11월 근원 3.3% 기준)',
    previous: '11월 결과 대기',
    consensusBasis: [
      'BEA 일정: 12월 PCE와 4분기 GDP 속보가 2027-01-28 08:30 ET 같은 시간에 나온다.',
      'FOMC(1/27) 다음 날 — 연준 결정의 ‘검증’ 성격.',
      '4분기 성장률이 3%대면 ‘고금리에도 버틴다’ → 인상 여지 유지.',
    ],
    trend: '근원 PCE 3.3% 고착 · 성장 3~4%대',
    above: {
      label: '예상 상회',
      verdict: 'short',
      strength: '중',
      text: '물가·성장이 함께 강하면 3월 인상 확률↑ → 🔴 숏 유리(중).',
    },
    inline: { label: '예상 부합', verdict: 'neutral', strength: '중', text: '전날 FOMC 방향을 확인하는 수준.' },
    below: {
      label: '예상 하회',
      verdict: 'long',
      strength: '중',
      text: '물가 둔화 + 성장 둔화 → 인상 종료 기대 → 🟢 롱 유리(중).',
    },
    playbook: 'PCE와 GDP가 동시에 나온다 — 물가(숏 재료)와 성장(롱 재료)이 충돌하면 첫 반응 후 되돌림이 잦다.',
    source: 'BEA 2027-01-28 08:30 ET (Personal Income & Outlays 12월 · GDP 4Q advance)',
  },
  {
    id: 'cpi-2027-01',
    name: '미국 1월 소비자물가(CPI)',
    short: 'CPI',
    at: '2027-02-11T22:30:00+09:00',
    stars: 3,
    category: 'inflation',
    consensus: '발표 전 (12월 3.4% 기준)',
    previous: '12월 결과 대기',
    consensusBasis: [
      'BLS 일정: 2027-02-11 08:30 ET.',
      '연초 가격 인상(보험·의료·통신)이 반영되는 달 — 계절적으로 근원 상방 위험이 있다.',
      '3월 FOMC(3/16~17) 전 마지막 CPI — 인상 여부를 가른다.',
    ],
    trend: '근원 3% 안팎 고착 · 연초 재가격(re-pricing) 변수',
    above: {
      label: '예상 상회',
      verdict: 'short',
      strength: '강',
      text: '연초 물가 반등 → 3월 인상 확정 → 🔴 숏 유리(강).',
    },
    inline: { label: '예상 부합', verdict: 'neutral', strength: '중', text: '3월 FOMC까지 관망.' },
    below: {
      label: '예상 하회',
      verdict: 'long',
      strength: '중',
      text: '연초 반등이 없었다는 뜻 → 인상 종료 기대 → 🟢 롱 유리(중).',
    },
    playbook: '1월은 계절조정 계수가 큰 달 — 전월비보다 3개월 평균으로 본다.',
    source: 'BLS CPI 1월 발표 2027-02-11 08:30 ET',
  },
  {
    id: 'pce-2027-01',
    name: '미국 1월 PCE 물가',
    short: 'PCE',
    at: '2027-02-25T22:30:00+09:00',
    stars: 2,
    category: 'inflation',
    consensus: '발표 전',
    previous: '12월 결과 대기',
    consensusBasis: [
      'BEA 일정: 2027-02-25 08:30 ET — GDP 4분기 2차 추정과 같은 날.',
      '연준이 보는 물가지표 — 3월 FOMC 전 마지막 PCE.',
    ],
    trend: '근원 PCE 3%대 초중반',
    above: {
      label: '예상 상회',
      verdict: 'short',
      strength: '중',
      text: '근원 PCE 반등 → 3월 인상 → 🔴 숏 유리(중).',
    },
    inline: { label: '예상 부합', verdict: 'neutral', strength: '약', text: '3월 FOMC 대기.' },
    below: { label: '예상 하회', verdict: 'long', strength: '중', text: '물가 둔화 확인 → 🟢 롱 유리(중).' },
    playbook: '근원 m/m 과 3개월 연율을 함께 본다.',
    source: 'BEA 2027-02-25 08:30 ET',
  },
  {
    id: 'cpi-2027-02',
    name: '미국 2월 소비자물가(CPI)',
    short: 'CPI',
    at: '2027-03-10T22:30:00+09:00',
    stars: 3,
    category: 'inflation',
    consensus: '발표 전',
    previous: '1월 결과 대기',
    consensusBasis: [
      'BLS 일정: 2027-03-10 08:30 ET.',
      '3월 16~17일 FOMC(점도표 회의) 직전 마지막 CPI — 인상/동결의 결정적 근거.',
    ],
    trend: '물가 고착 여부의 최종 확인',
    above: {
      label: '예상 상회',
      verdict: 'short',
      strength: '강',
      text: '3월 인상 + 매파 점도표 → 🔴 숏 유리(강).',
    },
    inline: { label: '예상 부합', verdict: 'neutral', strength: '중', text: '점도표가 방향을 정한다.' },
    below: { label: '예상 하회', verdict: 'long', strength: '강', text: '동결 기대 → 🟢 롱 유리(강).' },
    playbook: '발표 6일 뒤 FOMC — 포지션을 FOMC까지 끌고 갈지 미리 정한다.',
    source: 'BLS CPI 2월 발표 2027-03-10 08:30 ET',
  },
  {
    id: 'fomc-2027-03',
    name: 'FOMC 금리 결정 + 점도표(SEP)',
    short: 'FOMC',
    at: '2027-03-18T03:00:00+09:00',
    stars: 3,
    category: 'rates',
    consensus: '발표 전 (12월·1월 결과가 기준)',
    previous: '1월 결과 대기',
    consensusBasis: [
      'Fed 일정: 2027-03-16~17, 결정 14:00 ET(EDT) = 03:00 KST 3/18.',
      '점도표가 나오는 회의 — 2027년 남은 경로(인상 0~2회)가 여기서 확정된다.',
      '3월 CPI(3/10)가 6일 전에 나와 재료가 겹친다.',
    ],
    trend: '긴축 사이클의 분기점 · 2027년 점도표가 핵심',
    above: {
      label: '인상 + 점도표 상향',
      verdict: 'short',
      strength: '강',
      text: '2027년 추가 인상이 점도표에 남으면 → 🔴 숏 유리(강).',
    },
    inline: {
      label: '동결 + 점도표 유지',
      verdict: 'neutral',
      strength: '중',
      text: '예상대로면 재료 소멸 — 방향은 CPI(3/10)가 이미 정했다.',
    },
    below: {
      label: '동결 + 점도표 하향(인하 시사)',
      verdict: 'long',
      strength: '강',
      text: '인하 기대가 점도표에 들어오면 위험자산 강세 → 🟢 롱 유리(강).',
    },
    playbook: '점도표 중간값과 2027년 말 점 분포를 본다 — 성명보다 점도표가 오래 간다.',
    source: 'Fed FOMC 2027-03-16~17 (결정 14:00 EDT) · 2027 일정은 잠정(tentative)',
  },
  {
    id: 'pce-2027-02',
    name: '미국 2월 PCE 물가',
    short: 'PCE',
    at: '2027-03-31T21:30:00+09:00',
    stars: 2,
    category: 'inflation',
    consensus: '발표 전',
    previous: '1월 결과 대기',
    consensusBasis: ['BEA 일정: 2027-03-31 08:30 ET(EDT).', '3월 FOMC 이후 첫 물가 확인 — 2분기 방향을 가른다.'],
    trend: '근원 PCE 추세 확인',
    above: { label: '예상 상회', verdict: 'short', strength: '중', text: '물가 고착 → 인상 잔존 → 🔴 숏 유리(중).' },
    inline: { label: '예상 부합', verdict: 'neutral', strength: '약', text: '추세 유지.' },
    below: { label: '예상 하회', verdict: 'long', strength: '중', text: '물가 둔화 → 🟢 롱 유리(중).' },
    playbook: '분기 말 유동성·리밸런싱과 겹친다 — 발표 직후 변동성 주의.',
    source: 'BEA 2027-03-31 08:30 ET',
  },
];

/** 카테고리 표기 */
export const MACRO_CATEGORY_LABEL: Record<MacroCategory, string> = {
  rates: '금리',
  inflation: '물가',
  jobs: '고용',
  growth: '경기',
  consumer: '소비',
};

/** KST ISO 문자열 → ms */
export function parseEventTime(at: string): number {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? ms : 0;
}

/** 지금 이후(또는 진행 중) 이벤트만 시간순 */
export function upcomingEvents(now = Date.now(), withinDays = 120): MacroEvent[] {
  const limit = now + withinDays * 86_400_000;
  return MACRO_EVENTS.filter((e) => {
    const t = parseEventTime(e.at);
    return t >= now - 30 * 60_000 && t <= limit;
  }).sort((a, b) => parseEventTime(a.at) - parseEventTime(b.at));
}

/** 가장 가까운 다음 이벤트 */
export function nextEvent(now = Date.now()): MacroEvent | null {
  return upcomingEvents(now, 400)[0] ?? null;
}

/** 발표까지 남은 ms (지났으면 음수) */
export function timeUntil(event: MacroEvent, now = Date.now()): number {
  return parseEventTime(event.at) - now;
}

/** 카운트다운 — '3일 4시간' · '42분' · '발표 중' · '종료' */
export function countdownText(event: MacroEvent, now = Date.now()): string {
  const diff = timeUntil(event, now);
  if (diff <= -30 * 60_000) return '발표 완료';
  if (diff <= 0) return '발표 중';
  const min = Math.floor(diff / 60_000);
  const day = Math.floor(min / 1440);
  const hour = Math.floor((min % 1440) / 60);
  const minute = min % 60;
  if (day > 0) return `${day}일 ${hour}시간`;
  if (hour > 0) return `${hour}시간 ${minute}분`;
  return `${minute}분`;
}

/** KST 표기 — '12/04(금) 22:30' */
export function kstLabel(event: MacroEvent): string {
  const ms = parseEventTime(event.at);
  if (!ms) return '—';
  const d = new Date(ms + 9 * 3600_000);
  const week = ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, '0')}(${week}) ${hh}:${mm}`;
}

/** 별 표기 */
export function starsText(stars: number): string {
  return '★'.repeat(Math.max(1, Math.min(3, Math.round(stars))));
}

/**
 * 지금 알려야 하는 발표인가 (30분 전 알림).
 *  · 발표 `leadMin` 분 전 ~ 발표 시각 +5분 사이에서 한 번만.
 *  · `fired` 는 이미 알린 이벤트 id 집합(중복 방지).
 */
export function dueMacroAlerts(
  now: number,
  leadMin: number,
  fired: ReadonlySet<string>,
  withinDays = 120,
): MacroEvent[] {
  const lead = Math.max(1, Math.min(240, leadMin)) * 60_000;
  return upcomingEvents(now, withinDays).filter((e) => {
    if (fired.has(e.id)) return false;
    const diff = timeUntil(e, now);
    return diff <= lead && diff >= -5 * 60_000;
  });
}

/** 경제지표 알림 문구 — 예상치와 롱/숏 가이드를 짧게 담는다 */
export function buildMacroMessage(event: MacroEvent): { title: string; body: string } {
  const verdict = `${event.inline.verdict === 'long' ? '🟢 롱' : event.inline.verdict === 'short' ? '🔴 숏' : '⚪ 중립'} 기준`;
  const body = [
    `예상 ${event.consensus} · 이전 ${event.previous}`,
    `상회→${verdictOf(event.above.verdict)} / 하회→${verdictOf(event.below.verdict)}`,
    event.trend,
    verdict,
  ].join(' · ');
  return { title: `📊 ${kstLabel(event)} ${event.short} 발표`, body };
}

function verdictOf(v: MacroVerdict): string {
  if (v === 'long') return '롱 유리';
  if (v === 'short') return '숏 유리';
  if (v === 'mixed') return '혼재';
  return '중립';
}

/** 롱/숏 배지 문구 */
export function verdictLabel(v: MacroVerdict): { text: string; tone: 'long' | 'short' | 'neutral' | 'mixed' } {
  switch (v) {
    case 'long':
      return { text: '🟢 롱 유리', tone: 'long' };
    case 'short':
      return { text: '🔴 숏 유리', tone: 'short' };
    case 'mixed':
      return { text: '🟡 혼재', tone: 'mixed' };
    default:
      return { text: '⚪ 중립', tone: 'neutral' };
  }
}

/** 필터별 건수 — 칩 배지 */
export function countsFor(
  events: MacroEvent[],
  filter: 'all' | 'star3' | 'inflation' | 'jobs' | 'rates',
): number {
  if (filter === 'all') return events.length;
  if (filter === 'star3') return events.filter((e) => e.stars === 3).length;
  return events.filter((e) => e.category === filter).length;
}

/** 날짜별 묶음 — 캘린더 목록 */
export function groupByDay(events: MacroEvent[]): Array<{ day: string; events: MacroEvent[] }> {
  const map = new Map<string, MacroEvent[]>();
  for (const e of events) {
    const ms = parseEventTime(e.at);
    const d = new Date(ms + 9 * 3600_000);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }
  return [...map.entries()].map(([day, list]) => ({ day, events: list }));
}
