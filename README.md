# 📈 비트겟 CRT 시그널 스캐너 (bitget-signal-scanner)

비트겟(Bitget) USDT-M 선물의 **코인 + 주식·ETF 선물 + FX·금·원자재·지수**를 실시간으로 스캔해 CRT·FVG·CISD 등
6개 매매법으로 시그널을 만들고, 마켓별로 최근 성과가 가장 좋은 전략만 채택하는 적응형 스캐너입니다.
FX·금 시그널은 **벤티지(Vantage) MT5 호가 오프셋**으로 보정해 실제 주문 화면과 같은 가격으로 볼 수 있습니다. 모든 수치는 비트겟 공개
API의 실제 캔들로 계산하며 더미 데이터는 쓰지 않습니다.

- 스택: React 18 + TypeScript + Vite (외부 UI 라이브러리 없음, 아이콘·차트·공유카드 모두 직접 구현)
- 테마: **다크 네온 트레이딩 터미널** — 딥 블랙/네이비 배경(`#050814`~`#0A0F24`) + 사이버 그리드 + 시안/바이올렛
  오로라 글로우, 다크 글래스모피즘 패널, 네온 시안-에메랄드(롱)/마젠타-레드(숏)/일렉트릭 퍼플(강조)/앰버(EQ·별점)
- 배포 경로 대응: `vite.config.ts`의 `base: './'` → `/bitget-signal-scanner/` 같은 서브패스에서도 자산 경로 유지

## 📱 안드로이드 앱 (APK)

| 항목 | 내용 |
| --- | --- |
| APK 다운로드 | <https://github.com/hw3238/bitget-signal-scanner/releases/latest/download/bitget-crt-scanner.apk> |
| 릴리즈 페이지 | <https://github.com/hw3238/bitget-signal-scanner/releases> |
| 패키지 | `com.hw3238.bitgetscanner` · minSdk 22 / targetSdk 34 · debug 서명 |

- Capacitor Android 프로젝트(`android/`)로 웹 빌드를 감싼 앱입니다. 앱은 실행할 때 `https://hw3238.github.io/bitget-signal-scanner/`
  최신 배포본을 불러오므로(`capacitor.config.ts`의 `server.url`), 웹/전략/UI 수정은 **Pages 재배포만으로 앱에 즉시 반영**됩니다.
- 로딩 실패 시 `assets/public`(내장 dist)로 폴백하고 "온라인 다시 시도" 안내를 띄웁니다.
- **설정 탭 → 앱 · 업데이트**: 현재 버전·설치된 APK 버전, `🔄 업데이트 확인`(GitHub Releases API), `새로고침(캐시 갱신)`,
  새 버전 발견 시 APK 다운로드. 새 릴리즈가 있으면 앱 상단에도 업데이트 배너가 뜹니다.
- PNG 저장은 WebView 제약 때문에 네이티브 플러그인(`AppShellPlugin`)으로 갤러리(`Pictures/CRT-Scanner`)에 저장하고,
  공유는 안드로이드 공유 시트로 전달합니다. 외부 링크는 시스템 브라우저에서 엽니다.

### APK 빌드(로컬)

```bash
# JDK 17 + Android SDK(platforms;android-34, build-tools;34.0.0) 필요
export JAVA_HOME=<jdk17> ANDROID_HOME=<android-sdk>
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
```

> GitHub App 연결에는 `workflows` 권한이 없어 `.github/workflows/` 푸시가 거부됩니다. CI 빌드가 필요하면 저장소
> Settings에서 Actions 권한을 켜고 워크플로를 직접 추가하세요.

### 새 버전 배포 순서

1. `src/lib/update.ts`의 `APP_VERSION`, `package.json`의 `version`, `android/app/build.gradle`의 `versionCode`·`versionName`을 올립니다.
2. `npm run build` → `npx cap sync android` → `cd android && ./gradlew assembleDebug`.
3. `dist/`를 `gh-pages` 브랜치에 게시(Pages 반영)하고 앱 APK를 새 태그 릴리즈에 첨부합니다.
   설치된 앱의 **설정 → 앱 · 업데이트**가 GitHub Releases API로 새 버전을 감지해 다운로드 버튼을 띄웁니다.

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
| 스캐너 | TS 발생 종목 카운터(롱/숏/1시간/4시간/**FX·금**), **🥇 금 · 💶 유로 · ₿ 비트 주력 퀵 필터**, **종목·심볼·전략 검색**, 전체·코인·주식선물·**FX·금** 필터, 레버리지(5/10/20/50x), 최소 손익비(1.2~2.5R), 진행중/종료, **⭐ 즐겨찾기 모아보기**, 12건씩 펼치는 **이전 시그널 더보기**, **Vantage 호가 보정 미니 바**, 시그널 카드(⭐ 즐겨찾기·미니 캔들 차트·목표/EQ/진입/무효·진행 게이지·전략 승률) |
| 시황 | 코인/주식선물/**FX·금** 상승·하락 TOP, 거래대금 TOP, 펀딩비 극단, 상승·하락 종목 수·평균 펀딩비·24h 거래대금 |
| 전략엔진 | 6개 매매법 실시간 순위(채택 마켓·채택 승률·표본·손익비·기대 수익), 자동 교체 로그, 백테스트 재실행 |
| 기록 | 탐지된 시그널의 적중/무효/진행 추적(최대 400건 보관), **종목·전략 검색**, 15건씩 펼치는 **이전 기록 더보기**, 실현·미실현 레버리지 수익률 |
| 설정 | 레버리지·최소 손익비·자동 갱신 주기(30/60/120초·꺼짐)·알림음, **FX·금 종목별 벤티지 호가 보정 표**, **Twelve Data API 키(선택)**, 엔진 기준, 데이터 초기화, **앱 버전·업데이트 확인·캐시 갱신** |

시그널 카드를 탭하면 **다크 네온 공유 카드**(캔버스 렌더링)가 열리고 PNG로 저장하거나 Web Share로 보낼 수
있습니다.

### ⭐ 즐겨찾기 · 검색 · 이전 시그널 더보기

- 카드 우측 상단 **⭐ 버튼**(공유 모달 안에도 있음)으로 시그널을 찜합니다. 버튼 클릭은 `stopPropagation()`으로
  공유 카드를 열지 않고 즉시 토글되며, 활성 상태는 네온 골드(`#FFD166`) 글로우로 표시됩니다.
- 즐겨찾기는 `localStorage`의 `bgss.favorites.v1`에 저장되어 새로고침·60초 자동 갱신 후에도 유지됩니다. 키는
  `심볼|타임프레임|방향|감지봉 시각`이라 스캔이 반복돼도 같은 시그널을 가리킵니다.
- **⭐ 즐겨찾기 (N)** 필터를 켜면 진행중/종료·자산·타임프레임·최소 손익비와 무관하게 찜한 시그널을 모두 모아
  보여줍니다. 현재 스캔에 살아 있으면 최신 현재가·레버리지 수익률·진행도로 갱신되고, 스캔에서 사라진 시그널은
  마지막 스냅샷 카드(보관된 스냅샷)로 남아 확인·해제할 수 있습니다.
- 검색창은 심볼(`BTCUSDT`)·종목명·전략명(`EMA`, `CRT`, `SuperTrend`)·태그를 대소문자 구분 없이 실시간으로
  걸러주며, 공백으로 여러 단어를 넣으면 AND 조건입니다. 입력값이 있으면 우측 `×`로 즉시 초기화됩니다.
- 채택 전략의 시그널 중 **진행중(최근 10봉)** + **종료(적중/무효, 최근 160봉)** 을 마켓당 최대 18건까지 모아,
  스캐너는 12건씩 `이전 시그널 더보기 (+N건)`, 기록 탭은 15건씩 `이전 기록 더보기 (+N건)`으로 계속 펼쳐 봅니다.

## 데이터 소스 (Bitget 공개 API · CORS 허용)

| 용도 | 엔드포인트 |
| --- | --- |
| 계약 목록(890개) | `GET /api/v2/mix/market/contracts?productType=USDT-FUTURES` |
| 실시간 티커 | `GET /api/v2/mix/market/tickers?productType=USDT-FUTURES` |
| 캔들 200봉 | `GET /api/v2/mix/market/candles?productType=USDT-FUTURES&symbol=..&granularity=1H\|4H&limit=200` |

- `granularity`는 실제 호출로 검증한 대문자 포맷(`1H`/`4H`)만 사용합니다.
- 계약의 `isRwa` 플래그로 주식·ETF 선물을 구분하고, 원자재·금속·외환·지수(XAU, XAG, CL, COPPER, EURUSD,
  NDX100, HSI …)는 `fx` 카테고리로 모아 주식선물 목록과 섞지 않습니다. 표기 소수점은 계약의 `pricePlace`를 씁니다.
- 스캔 유니버스 = **주력 3종목(XAUUSDT·EURUSDUSDT·BTCUSDT, 항상 맨 앞)** + FX·금·원자재·지수 21종목 +
  주식선물 주요 43종목 + 거래대금 상위 코인 30종목, 각 1H/4H → 마켓 약 95개·캔들 190건. 요청은 워커 3개·간격
  165ms로 제한하고 429 발생 시 지수 백오프로 재시도합니다. 캔들 갱신 주기 기본 60초.

## FX·금 스캐너 · Vantage 호가 보정

### 스캔 심볼 (벤티지 MT5 표기)

| 비트겟 계약 | 표기 | 비고 |
| --- | --- | --- |
| `XAUUSDT` | **XAUUSD+** | 금 현물 프록시 (주력) |
| `EURUSDUSDT` | **EURUSD+** | 유로/달러 (주력) |
| `BTCUSDT` | **BTCUSDT** | 비트겐 코인 (주력) |
| `XAGUSDT` · `XPTUSDT` · `XPDUSDT` | `XAGUSD+` · `XPTUSD+` · `XPDUSD+` | 은·백금·팔라듐 |
| `XAUTUSDT` · `PAXGUSDT` | `XAUT+` · `PAXG+` | 금 토큰(Tether/Paxos Gold) |
| `EURUSD` · `GBPUSD` · `USDJPY` · `USDBRL` | `EURUSD+` · `GBPUSD+` · `USDJPY+` · `USDBRL+` | FX |
| `CLUSDT` · `BZUSDT` · `NATGASUSDT` · `COPPERUSDT` | `USOIL+` · `UKOIL+` · `NATGAS+` · `COPPER+` | 원자재 |
| `DXYUSDT` | `DXY+` | 달러 인덱스 |
| `NDX100` · `SP500` · `JP225` · `HSI` · `KR200` | `NAS100+` · `US500+` · `JP225+` · `HK50+` · `KR200+` | 지수 |

- 자산 필터 **FX·금** 탭에서만 이 카테고리를 모아 봅니다(배지 `FX·금`). FX 카드는 `pricePlace` 기준 고정 소수점
  (EURUSD 4자리, USDJPY·XAUUSD 2자리, 지수 0~2자리)으로 표기합니다.
- **주력 퀵 필터**: 🥇 금(`XAU`) · 💶 유로(`EURUSD`) · ₿ 비트(`BTC`) 칩을 누르면 해당 자산 탭 + 검색어가 한 번에
  적용되고(진행중 시그널이 없으면 종료 셋업까지 표시) 다시 누르면 해제됩니다.

### 벤티지 호가 보정(오프셋)

- FX·금 탭 상단 미니 바 또는 **설정 → FX·금 · 벤티지 호가 보정**에서 종목별 오프셋을 입력합니다.
  목록 맨 위는 주력 3종목(`XAUUSD+`, `EURUSD+`, `BTCUSDT`)으로 고정되어 있습니다.
- 입력 즉시 카드와 다크 공유 카드의 **현재가·진입가·목표가·EQ·무효가**가 같은 값만큼 이동합니다. 가격 차이의
  비율인 **손익비·R배수는 그대로**이고, 수익률(%)만 보정된 진입가 기준으로 다시 계산됩니다.
- 설정 탭에서는 `MT5가 입력` 칸에 벤티지 화면의 현재가를 그대로 넣으면 `오프셋 = MT5가 − 비트겟가`로 계산됩니다.
- 값은 `localStorage`(`bgss.settings.v1.fxOffsets`)에 저장되어 새로고침·자동 갱신 후에도 유지되고, `전체 초기화`로
  한 번에 지울 수 있습니다.

### Twelve Data 보조 페어 (선택)

- 설정 → **Twelve Data**에 무료 API 키를 넣으면 `AUD/USD`·`USD/CAD`·`USD/CHF`·`NZD/USD`·`EUR/JPY`·`GBP/JPY`를
  1H/4H로 함께 스캔합니다. 키가 비어 있으면 호출하지 않고 비트겟 실시간 FX·금 피드만 사용합니다.
- 무료 플랜 분당 8회 제한을 지키기 위해 요청을 **7.8초 간격·60초 창 8회**로 직렬화하고, 1H 캔들 1회만 받아
  4H를 로컬 리샘플링하며, 페어당 5분 캐시를 둡니다. 보조 페어 스캔은 본 스캔을 막지 않고 뒤에서 진행됩니다.

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
LD_LIBRARY_PATH=/workspace/.local/sysroot/root/usr/lib/x86_64-linux-gnu \
PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright node scripts/capture.mjs      # 390×844 + 1280×800, 콘솔 에러 수집, PNG 저장 검증
LD_LIBRARY_PATH=/workspace/.local/sysroot/root/usr/lib/x86_64-linux-gnu \
PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright node scripts/fx-check.mjs     # FX·금 탭·소수점·호가 보정·퀵 필터·회귀 검증
LD_LIBRARY_PATH=/workspace/.local/sysroot/root/usr/lib/x86_64-linux-gnu \
PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright node scripts/pages-check.mjs    # /bitget-signal-scanner/ 서브패스 검증
node scripts/favorites-check.mjs                                                  # ⭐ 즐겨찾기·검색·더보기·새로고침 유지·보관 스냅샷 검증
node scripts/live-check.mjs                                                        # 라이브 Pages 반영 확인
```

결과 스크린샷은 `docs/screens/`에 저장됩니다(`01-scanner.png`, `02-dark-card.png`, `03-strategy-engine.png`,
`04-market.png`, `05-history.png`, `06-desktop.png`, `07-pages-subpath.png`, `08-settings.png`,
`09-live-pages.png`, `02-dark-card-export.png`). FX 관련 화면은 `13-fx-scanner.png`(FX·금 탭), `13-fx-offset.png`
(호가 보정 적용), `13-fx-quick-gold.png`(금 퀵 필터), `13-fx-share.png`(FX 공유 카드), `13-settings-fx.png`
(종목별 보정 표), `13-fx-desktop.png`(데스크톱)입니다.

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
