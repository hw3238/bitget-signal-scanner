package com.hw3238.bitgetscanner;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

/**
 * 🔔 재부팅·앱 업데이트 뒤 백그라운드 알림 감시를 되살린다 (v1.5.8).
 *
 *  · 사용자가 알림을 켜 둔 상태(AlertStore.enabled)면 서비스를 다시 시작한다.
 *  · Android 12+ 백그라운드 시작 제한이 있지만 BOOT_COMPLETED 는 허용된 예외 상황이다.
 *  · 알림이 모두 꺼져 있으면 아무것도 하지 않는다(배터리).
 */
public class AlertBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                && !"android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            return;
        }
        if (!AlertStore.enabled(context)) return;
        try {
            Intent service = new Intent(context, AlertMonitorService.class);
            service.setAction(AlertMonitorService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(context, service);
            } else {
                context.startService(service);
            }
        } catch (Exception ignored) {
            /* 기기 정책상 시작할 수 없으면 다음 앱 실행에서 다시 시작된다 */
        }
    }
}
