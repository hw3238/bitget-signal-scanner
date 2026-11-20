# 📈 비트겟 CRT 시그널 스캐너 (bitget-signal-scanner)

비트겟(Bitget) USDT-M 선물의 **코인 + 주식·ETF 선물**을 실시간으로 스캔해 CRT·FVG·CISD 등 6개 매매법으로
시그널을 만들고, 마켓별로 최근 성과가 가장 좋은 전략만 채택하는 적응형 스캐너입니다. 모든 수치는 비트겟 공개
API의 실제 캔들로 계산하며 더미 데이터는 쓰지 않습니다.

- 스택: React 18 + TypeScript + Vite (외부 UI 라이브러리 없음, 아이콘·차트·공유카드 모두 직접 구현)
- 테마: **다크 네온 트레이딩 터미널** — 딥 블랙/네이비 배경(`#050814`~`#0A0F24`) + 사이버 그리드 + 시안/바이올렛
  오로라 글로우, 다크 글래스모피즘 패널, 네온 시안-에메랄드(롱)/마젠타-레드(숏)/일렉트릭 퍼플(강조)/앰버(EQ·별점)
- 배포 경로 대응: `vite.config.ts`의 `base: './'` → `/bitget-signal-scanner/` 같은 서브패스에서도 자산 경로 유지

## 실행

```bash
export PATH="$HOME/.local/node/node-v22.14.0-linux-x64/bin:$PATH"
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # tsc + vite build → dist/
npm run preview  # http://127.0.0.1:4173
```

## 화면

| 탭 | 내용 |
| --- | --- |
| 스캐너 | TS 발생 종목 카운터(롱/숏/1시간/4시간), 전체·코인·주식선물 필터, 레버리지(5/10/20/50x), 최소 손익비(1.2~2.5R), 시그널 카드(미니 캔들 차트·목표/EQ/진입/무효·진행 게이지·전략 승률) |
| 시황 | 코인/주식선물 상승·하락 TOP, 거래대금 TOP, 펀딩비 극단, 상승·하락 종목 수·평균 펀딩비·24h 거래대금 |
| 전략엔진 | 6개 매매법 실시간 순위(채택 마켓·채택 승률·표본·손익비·기대 수익), 자동 교체 로그, 백테스트 재실행 |
| 기록 | 탐지된 시그널의 적중/무효/진행 추적, 실현·미실현 레버리지 수익률 |
| 설정 | 레버리지·최소 손익비·자동 갱신 주기(30/60/120초·꺼짐)·알림음, 엔진 기준, 데이터 초기화 |

시그널 카드를 탭하면 **다크 네온 공유 카드**(캔버스 렌더링)가 열리고 PNG로 저장하거나 Web Share로 보낼 수
있습니다.

## 데이터 소스 (Bitget 공개 API · CORS 허용)

| 용도 | 엔드포인트 |
| --- | --- |
| 계약 목록(890개) | `GET /api/v2/mix/market/contracts?productType=USDT-FUTURES` |
| 실시간 티커 | `GET /api/v2/mix/market/tickers?productType=USDT-FUTURES` |
| 캔들 200봉 | `GET /api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=..&granularity=1H\|4H&limit=200` |

- `granularity`는 실제 호출로 검증한 대문자 포맷(`1H`/`4H`)만 사용합니다.
- 계약의 `isRwa` 플래그로 주식·ETF 선물을 구분하고, 원자재·금속·외환(XAU, CL, COPPER, EURUSD 등)은
  `commodity`로 분류해 주식선물 목록과 섞지 않습니다.
- 스캔 유니버스 = 주식선물 주요 43종목(TSLA, NVDA, MSTR, COIN, QQQ, SPY, SOXL, TQQQ …) + 거래대금 상위
  코인 30종목, 각 1H/4H → 마켓 146개. 요청은 워커 3개·간격 165ms로 제한하고 429 발생 시 지수 백오프로
  재시도합니다. 캔들 갱신 주기 기본 60초.

## 엔진

### 전략 6종 (`src/engine/strategies.ts`)

1. **CRT + FVG + CISD** — 20봉 레인지 스윕 + FVG/구조전환 확인, 진입은 레인지 바깥 45% 구간에서만
2. **Liquidity Sweep + Order Block** — 30봉 유동성 스윕 후 오더블록 리테스트, EMA50 추세 정렬
3. **EMA 20/50 Pullback + RSI Divergence** — 추세 방향 EMA20 눌림 + RSI 다이버전스/회복
4. **Bollinger Squeeze + Volume Breakout** — 밴드 폭 하위 30% 수축 후 거래량 1.35배 돌파
5. **EQ Mean Reversion + Engulfing** — 30봉 스윙 EQ(0.5)에서 장악형 반전
6. **SuperTrend / Donchian Momentum** — SuperTrend 전환 또는 돈치안 20 돌파

### 백테스트·판정

- 각 마켓의 실제 캔들 200봉에 6개 전략을 전부 돌려 1건씩 트레이드로 기록(중복 진입 방지, 최대 42봉 판정).
- 목표/무효 도달 여부로 적중·무효 판정, 같은 봉에서 동시 도달 시 **무효 우선**(보수적).
- 워크포워드: 과거 구간(최근 60봉 이전) 1위 전략을 최근 60봉에서 다시 채점 → 승률 55%·손익비 1.5R·표본
  2건을 못 넘으면 **현재 최고 성과 전략으로 즉시 교체**하고 교체 로그(시각·마켓·이전/신규 전략·사유)를 남깁니다.
- 시그널은 채택 전략이 최근 10봉 안에 낸 셋업만 노출하며, 진입 손익비가 사용자가 정한 최소 손익비 미만이면 제외합니다.
- 레버리지 수익률 = (가격 변동 ÷ 진입가) × 배율. 기록 탭의 누적 수익률은 무효가까지 거리(%)를 가중해 합산합니다.

## 검증

```bash
npm run build
LD_LIBRARY_PATH=/workspace/.deps/apt/usr/usr/lib/x86_64-linux-gnu \
PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright node scripts/capture.mjs      # 390×844 + 1280×800, 콘솔 에러 수집, PNG 저장 검증
LD_LIBRARY_PATH=/workspace/.deps/apt/usr/usr/lib/x86_64-linux-gnu \
PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright node scripts/pages-check.mjs    # /bitget-signal-scanner/ 서브패스 검증
node scripts/live-check.mjs                                                        # 라이브 Pages 반영 확인
```

결과 스크린샷은 `docs/screens/`에 저장됩니다(`01-scanner.png`, `02-dark-card.png`, `03-strategy-engine.png`,
`04-market.png`, `05-history.png`, `06-desktop.png`, `07-pages-subpath.png`, `08-settings.png`,
`09-live-pages.png`, `02-dark-card-export.png`).

## 배포 (GitHub Pages)

- 라이브: **https://hw3238.github.io/bitget-signal-scanner/** (브랜치 `gh-pages` / 루트, HTTP 200·실데이터 렌더링 확인)
- 소스: https://github.com/hw3238/bitget-signal-scanner (`main`)
- 재배포는 아래 스크립트로 `dist` 내용을 `gh-pages` 루트에 올립니다.

```bash
./scripts/deploy-gh-pages.sh hw3238/bitget-signal-scanner
```

## 면책

정보 도구입니다. 투자 권유가 아니며 표시된 승률·수익률은 과거 데이터 통계로 미래 성과를 보장하지 않습니다.
레버리지 거래는 원금 전액을 잃을 수 있습니다.
