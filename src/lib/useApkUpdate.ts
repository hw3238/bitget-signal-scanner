import { useCallback, useState } from 'react';
import { canInstallApk, downloadAndInstallApk, isNativeApp, openInstallPermissionSettings } from './native';

export type ApkUpdatePhase = 'idle' | 'permission' | 'downloading' | 'installed' | 'error';

export interface ApkUpdateState {
  phase: ApkUpdatePhase;
  /** 0~100 */
  pct: number;
  note: string;
}

const IDLE: ApkUpdateState = { phase: 'idle', pct: 0, note: '' };

/**
 * 앱 안에서 바로 업데이트 — APK 다운로드 진행률을 보여주고 설치 화면까지 연다.
 * 웹 브라우저에서는 예전처럼 새 탭으로 APK를 내려받는다.
 */
export function useApkUpdate() {
  const [state, setState] = useState<ApkUpdateState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);

  const start = useCallback(async (url: string | null | undefined) => {
    if (!url) {
      setState({ phase: 'error', pct: 0, note: '내려받을 APK 주소를 찾지 못했습니다.' });
      return;
    }
    if (!isNativeApp()) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    // Android 8.0+ 는 '출처를 알 수 없는 앱 설치' 허용이 필요하다.
    const allowed = await canInstallApk();
    if (!allowed) {
      await openInstallPermissionSettings();
      setState({
        phase: 'permission',
        pct: 0,
        note: '설정에서 COTA의 "앱 설치 허용"을 켠 뒤 다시 눌러주세요.',
      });
      return;
    }
    setState({ phase: 'downloading', pct: 0, note: 'APK를 내려받는 중…' });
    try {
      const res = await downloadAndInstallApk(url, (pct) =>
        setState({ phase: 'downloading', pct, note: `APK 내려받는 중 ${pct}%` }),
      );
      if (res?.needsPermission) {
        setState({
          phase: 'permission',
          pct: 0,
          note: '설정에서 COTA의 "앱 설치 허용"을 켠 뒤 다시 눌러주세요.',
        });
        return;
      }
      if (res?.started) {
        setState({ phase: 'installed', pct: 100, note: '설치 화면을 열었습니다. "설치"를 눌러 마무리하세요.' });
        return;
      }
      setState({ phase: 'error', pct: 0, note: '다운로드를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    } catch (e) {
      setState({
        phase: 'error',
        pct: 0,
        note: e instanceof Error ? e.message : '업데이트에 실패했습니다.',
      });
    }
  }, []);

  return { state, start, reset };
}
