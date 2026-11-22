# COTA — 실시간 트레이딩 시그널

비트겟 USDT-M **코인 선물**을 실시간으로 스캔해 고승률 셋업만 골라 주는 모바일 우선 스캐너입니다.
토스/토스증권 스타일의 라이트 UI, 전면 한글 라벨, 종목별 가격 가독성, 내 시드 기준 COTA 추천 레버리지를 제공합니다.

| 구분 | 링크 |
| --- | --- |
| 웹 (GitHub Pages) | <https://hw3238.github.io/bitget-signal-scanner/> |
| APK 다운로드 | <https://github.com/hw3238/bitget-signal-scanner/releases/latest/download/bitget-crt-scanner.apk> |
| 현재 버전 | **v1.4.0** (versionCode 5) |

## 주요 기능

- **스캔 속도(v1.4.0)** — 164개 마켓을 **2단계 우선 스캔**합니다. 즐겨찾기 종목 + 비트·이더·솔을 맨 앞에 두어
  **첫 시그널이 2초 안에** 뜨고, 나머지 마켓이 이어서 채워집니다. 캔들 캐시(1H 90초 · 4H 180초 TTL)와
  분석 결과 재사용으로 자동 갱신은 **티커만 새로 받아 0.3~0.5초**에 현재가·수익률을 갱신합니다.
  앱을 다시 열면 직전 스캔 스냅숏을 즉시 복원하고 뒤에서 조용히 최신화합니다(헤드리스 실측: 첫 시그널 11.3→2.4초,
  전체 스캔 18.2→11.0초, 재진입 11.0→0.8초, 429 0건). 상단에 `⚡ 10.8초 완료` / `⚡ 캐시 0.4초`로 걸린 시간이 표시됩니다.
- **스캐너** — 코인 선물 시그널(기본 코인 필터, 주식선물은 필터로 선택). 승률 55%·손익비 1.5R 이상 전략만 채택.
- **정밀 타점 · 타이트 손절** — 손절은 직전 스윙·오더블록·FVG 경계, 신호 캔들 극값에 최소 버퍼만 붙여 붙이고,
  진입가 대비 손절폭 상한(**1H 3.5% · 4H 4.5%**, 하한 0.3%)을 넘는 시그널은 만들지 않습니다(목표가 ≤ 0 원천 차단).
- **비트겟 앱 바로가기** — 카드·공유 모달의 `비트겟 거래`는 안드로이드 APK에서 **비트겟 앱**으로 바로 열립니다
  (앱 링크 → 커스텀 딥링크 → 비트겟 앱 실행 → 미설치 시에만 브라우저).
- **카드** — `롱 · 매수 / 숏 · 매도`, `진입가 · 목표가 · 본전(EQ) · 손절가`, `손익비 1 : n`, `최근 승률`,
  천단위 콤마 가격, 미니 캔들 차트, 진행률, `발송 11. 21. 09:00` 시그널 발송 시각.
- **실시간 수익률** — 진행 중 시그널은 `현재 수익률 (진입가 기준)`으로 진입가 대비 현재가 변동률 × 레버리지를
  보여 주고, 내 시드 기준 `평가손익 +$321 / -$157`도 함께 표시합니다. 목표·손절 시나리오는
  `목표 시 예상 수익 / 손절 시 손실`로 따로 구분해 현재 손익과 섞이지 않습니다.
- **코인 로고** — 카드·공유 카드에 실제 코인 로고를 표시합니다. `1000PEPE` 같은 단위 파생 심볼은 원 코인(PEPE)
  로고로 맞추고, 로고가 없는 신규 밈코인·주식선물은 토스 스타일 글자 아바타로 깔끔하게 폴백합니다(깨진 이미지 0건).
  아이콘은 `npm run icons`(배포 시 자동)가 OKX → Binance → CoinCap 순으로 HTTP 200을 확인해 `public/coin-icons/`에
  내려받고 `manifest.json`으로 관리합니다. 없는 코인에 요청을 보내지 않아 콘솔 404가 없고, 같은 출처 파일이라
  PNG 공유 카드 캔버스도 오염되지 않습니다.
- **비트겟 바로가기** — 카드의 `비트겟 바로가기 ↗` 버튼과 공유 카드 모달의 `비트겟 거래 ↗` 버튼이
  해당 종목 선물 페이지(`https://www.bitget.com/futures/usdt/{SYMBOL}`, 예: `BTCUSDT`)를 새 창/외부 브라우저로
  엽니다. 카드 본문 탭(공유 카드 모달)과 분리되어 있어 시그널을 보다가 바로 거래 화면으로 넘어갈 수 있습니다.
- **COTA 추천 레버리지** — 손절 폭·최근 승률·손익비로 시그널마다 배율을 계산합니다.
  - 보수적 매매: **2x ~ 5x** (손절 시 시드 손실을 12% 안쪽으로 억제)
  - 공격적 매매: **10x ~ 25x** (`floor(80 / 손절폭)` 안전 마진을 넘지 않음)
  - 카드에 `COTA 추천 Nx` 배지 + 내 시드 기준 **예상 수익(+)·손절 손실(-)** 표시
  - 레버리지 선택: `COTA 추천`(기본) 또는 `5x · 10x · 20x · 50x` 고정
- **첫 실행 온보딩** — 투자 시드($100/$500/$1,000/$5,000 프리셋)와 매매 성향(보수적/공격적)을 받아
  `localStorage('cota.profile.v1')`에 저장합니다. 설정 탭 `💼 내 투자 프로필`에서 언제든 다시 설정할 수 있습니다.
- **시황** — 코인·주식선물 상승/하락/거래대금/펀딩비 TOP에 더해
  **공포·탐욕 지수**(alternative.me), **펀딩비·OI 스퀴즈 레이더**(8시간·연환산 펀딩, 미결제약정,
  롱/숏 스퀴즈 경고 배지), **시황 속보 PNG 카드**(1080px, 스레드·텔레그램 공유용)를 제공합니다.
- **메뉴(트레이더 올인원)** — 7가지 실전 도구를 모은 허브. 각 도구는 전용 화면으로 열리고 `← 메뉴`로 돌아옵니다.
  - **🚀 김프 & 송금 레이더** — 업비트(또는 빗썸) 원화 시세 · 비트겟 USDT 가격 · USD/KRW 환율로
    코인별 김치프리미엄을 계산하고, 예상 출금 수수료까지 반영해 **국내→해외 송금에 가장 유리한 TOP 3**를 뽑습니다.
  - **🎯 키맞추기 레이더** — 24h 거래대금 상위 30종목 + BTC의 1시간봉 60개를 받아 BTC와의 수익률 상관계수와
    최근 4·6시간 괴리를 계산, **상관은 높은데 아직 덜 움직인 후발주자**를 롱/숏으로 나눠 보여 줍니다.
  - **🔮 차트 도플갱어** — 최근 18·24·36봉과 겹치지 않는 과거 구간을 **피어슨 상관**으로 비교해
    가장 닮은 과거 TOP 3와 그 직후 12봉 실제 등락률·오버레이 SVG·PNG 카드를 제공합니다.
  - **🩺 포지션 생존 성적표** — 유지증거금을 반영한 예상 청산가, 청산 여유, 물타기 후 평단·청산가,
    펀딩비·왕복 수수료를 계산하고 **S~F 등급 + 촌평**과 PNG 카드를 만듭니다.
  - **📐 포지션 사이징** — 시드·허용 손실률·진입/손절/목표가로 수량·권장 레버리지·손익비·손익분기 승률.
  - **🧾 수수료 & 페이백** — 지정가/시장가 비중, 거래 횟수, 할인·페이백으로 월·연 수수료와 절감액.
  - **⚙️ 전략엔진** — 기존 6개 매매법 실시간 백테스트 순위와 자동 교체 로그(메뉴 안으로 이동).
- **기록** — 탐지 이후 실제 캔들로 목표 달성/손절 종료를 검증한 추적 기록.
- **설정** — 🔔 핸드폰 알림(비트·이더·솔 / 주요 코인 / 전체 종목), ntfy 외부 푸시(`bgss-hw3238-9f4k2m`),
  레버리지 모드·최소 손익비·자동 갱신, 앱 버전/업데이트.
- **앱 안에서 바로 업데이트(v1.4.0)** — 새 APK가 있으면 상단 배너·설정의 `바로 업데이트 (vX.Y.Z)` 버튼이
  앱을 나가지 않고 APK를 내려받아(진행률 % 표시) 안드로이드 설치 화면을 엽니다. Android 8.0+ 에서
  "출처를 알 수 없는 앱 설치"가 꺼져 있으면 설정 화면으로 안내하고, 허용 후 다시 누르면 이어서 설치합니다.
  웹/UI만 바뀐 경우는 설정의 `웹 화면 즉시 새로고침`(캐시 비우기)으로 바로 반영됩니다.
- **공유 카드** — 라이트 COTA 카드 PNG 저장/공유(진입가·목표가·손절가·손익비·COTA 추천 배지).

## 개발

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run icons      # 코인 로고 아이콘 갱신(public/coin-icons) — 배포 스크립트가 자동 실행
npm run build      # tsc + vite build → dist/
```

### 검증 스크립트

```bash
npm run build
npm run check:stops                 # 손절폭 상한(1H 3.5% / 4H 4.5%) 회귀
npm run check:calc                  # 김프·청산가·물타기·사이징·수수료·피어슨·도플갱어·괴리 단위 검증(49건)
node scripts/features-check.mjs     # 메뉴 7도구·김프·생존·사이징·수수료·도플갱어·키맞추기·시황 카드 E2E (스크린샷 25~36)
node scripts/toss-ui-check.mjs      # 5탭·코인 집중·한글화·가격·온보딩·COTA 추천·공유카드 (스크린샷 18~22)
node scripts/coin-logo-check.mjs    # 코인 로고·글자 아바타 폴백·비트겟 바로가기 URL (스크린샷 23)
node scripts/notify-check.mjs       # 알림 로직 + 설정 UI
node scripts/favorites-check.mjs    # 즐겨찾기·검색·더보기·기록
node scripts/pages-check.mjs        # /bitget-signal-scanner/ 서브패스 배포 경로
node scripts/live-check.mjs         # 라이브 Pages 검증
node scripts/live-notify-check.mjs  # 라이브 알림 UI 검증
```

이 환경에서 헤드리스 Chromium은 추가 라이브러리가 필요합니다:
`LD_LIBRARY_PATH=/workspace/.deps/root/usr/lib/x86_64-linux-gnu node scripts/coin-logo-check.mjs`

### APK 빌드 (로컬)

```bash
# JDK 17 + Android SDK(platforms;android-34, build-tools;34.0.0)
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
```

### 새 버전 배포 순서

1. `src/lib/update.ts`의 `APP_VERSION`, `package.json`의 `version`, `android/app/build.gradle`의
   `versionCode`·`versionName`을 올립니다.
2. `npm run build` → `npx cap sync android` → `cd android && ./gradlew assembleDebug`.
3. `./scripts/deploy-gh-pages.sh`로 `dist/`를 `gh-pages` 브랜치에 게시합니다.
4. APK를 새 태그 릴리즈에 `bitget-crt-scanner.apk` 이름으로 첨부합니다(파일명 유지 → latest 다운로드 URL 호환).

## 구조

```
src/
  components/   SignalCard · CoinLogo · ScannerTab · MarketTab · EngineTab · HistoryTab · SettingsTab
                MenuTab(허브) · KimchiRadar · KeyMatchRadar · Doppelganger · PositionSurvival
                SizingCalc · FeeCalc · ImageCardModal · cardKit · marketBriefCard · survivalCard · doppelCard
                ShareModal · OnboardingModal · MiniCandles · BottomNav · shareCard(canvas)
  engine/       backtest · strategies · indicators · universe(코인 주력+주식 워치리스트)
  hooks/        useScanner · useFavorites
  lib/          format(가격·손익비) · profile(시드·추천 레버리지) · coinLogo(로고 매니페스트·비트겟 URL)
                calc(김프·청산가·물타기·사이징·수수료·피어슨·도플갱어·괴리 순수 함수)
                oiSnapshot(OI 관측 기록) · shareImage(PNG 저장/공유) · notify · storage · update · native
  api/          bitget(공개 USDT-M 계약·티커·캔들) · publicMarket(펀딩·공포탐욕·환율·업비트·빗썸)
public/coin-icons/  코인 로고 PNG + manifest.json (scripts/fetch-coin-icons.mjs 생성)
```

## 데이터

- 비트겟 공개 API: `GET /api/v2/mix/market/contracts|tickers|candles|current-fund-rate|open-interest?productType=USDT-FUTURES`
  (tickers의 `holdingAmount` = 미결제약정 수량 → USD 환산. OI 과거 시계열 API가 없어 변동률은 COTA가 관측한 직전 기록 대비)
- 업비트 `GET /v1/ticker|/v1/market/all` · 빗썸 `GET /public/ticker/ALL_KRW` · 환율 `open.er-api.com` ·
  공포·탐욕 `api.alternative.me/fng` — 모두 브라우저 CORS 통과를 헤드리스 Chromium으로 확인한 엔드포인트입니다.
- 1H/4H 200봉 실데이터를 최근 60봉 기준으로 백테스트해 승률·손익비 미달 전략은 즉시 교체합니다.

## 주의

COTA는 비트겟 공개 시세를 계산해 과거 통계를 보여주는 **정보 도구**입니다. 투자 권유가 아니며,
표시된 승률·수익률은 과거 데이터 기준으로 미래 성과를 보장하지 않습니다. 레버리지 거래는 원금 전액을
잃을 수 있습니다. 카드의 예상 손익은 시드 전액을 한 포지션에 넣는 기준의 단순 계산입니다.
