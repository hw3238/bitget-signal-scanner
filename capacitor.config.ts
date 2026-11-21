import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hw3238.bitgetscanner',
  appName: 'COTA',
  webDir: 'dist',
  server: {
    // GitHub Pages 최신 배포본을 그대로 불러온다 → 웹/전략/UI 수정은 재배포만으로 앱에 즉시 반영.
    // 네트워크가 없거나 로딩에 실패하면 MainActivity가 내장 dist(assets/public)로 폴백한다.
    url: 'https://hw3238.github.io/bitget-signal-scanner/',
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
