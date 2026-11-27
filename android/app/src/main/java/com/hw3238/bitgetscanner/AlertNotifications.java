package com.hw3238.bitgetscanner;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * 🔔 알림 채널 4종 (v1.5.8).
 *
 *  · 사용자가 Android 설정에서 **종류별로** 소리·진동·차단을 바꿀 수 있도록 채널을 나눈다.
 *    cota_signal(시그널) · cota_price_alert(지정가·지표) · cota_macro(경제지표) · cota_news(뉴스)
 *  · 알림을 누르면 앱이 열린다(MainActivity, SINGLE_TOP).
 *  · 기존 `bitget_signals` 채널은 v1.5.7 이하 호출부(자동매매 체결 알림)가 계속 쓰므로 남겨 둔다.
 */
public final class AlertNotifications {

    public static final String CH_SIGNAL = "cota_signal";
    public static final String CH_PRICE = "cota_price_alert";
    public static final String CH_MACRO = "cota_macro";
    public static final String CH_NEWS = "cota_news";

    private AlertNotifications() {
    }

    /** 4개 채널을 만든다(이미 있으면 그대로 — 사용자가 바꾼 설정을 덮지 않는다). */
    public static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        create(manager, CH_SIGNAL, "COTA 전략 시그널", "새 시그널 감지 — 앱을 꺼도 알림", true);
        create(manager, CH_PRICE, "COTA 지정가·지표 알림", "내가 건 가격·RSI·펀딩 조건 도달", true);
        create(manager, CH_MACRO, "COTA 경제지표", "미국 주요 지표 발표 30분 전 예상치·롱숏 가이드", true);
        create(manager, CH_NEWS, "COTA 코인 뉴스", "호재·악재 속보", false);
        // v1.5.7 이하에서 쓰던 채널 — 자동매매 체결 알림이 계속 이 채널로 나간다(새 설치에서도 만들어 둔다).
        create(manager, "bitget_signals", "시그널 알림", "COTA 시그널·자동매매 체결 알림", true);
    }

    private static void create(NotificationManager manager, String id, String name, String desc, boolean sound) {
        if (manager.getNotificationChannel(id) != null) return;
        NotificationChannel channel = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(desc);
        channel.setShowBadge(true);
        channel.enableLights(true);
        channel.setLightColor(Color.parseColor("#3182F6"));
        if (sound) {
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[] { 0, 240, 140, 240 });
            AudioAttributes audio = new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .build();
            channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), audio);
        } else {
            // 뉴스는 소리 없이 — 많이 오는 알림이라 기본을 조용하게 두고 사용자가 켜게 한다
            channel.enableVibration(false);
            channel.setSound(null, null);
        }
        manager.createNotificationChannel(channel);
    }

    /** 알림 표시 — 채널별로 소리·진동이 다르다. 탭하면 앱이 열린다. */
    public static void post(Context context, String channelId, String title, String body, int id) {
        ensureChannels(context);
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("bgss.alertNotification", true);
        intent.putExtra("bgss.alertChannel", channelId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(context, id, intent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_stat_signal)
                .setColor(Color.parseColor("#3182F6"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(AlertNotifications.CH_MACRO.equals(channelId)
                        ? NotificationCompat.CATEGORY_EVENT
                        : NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true)
                .setContentIntent(pending);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setDefaults(soundFor(channelId) ? NotificationCompat.DEFAULT_ALL : NotificationCompat.DEFAULT_LIGHTS);
        }
        try {
            NotificationManagerCompat.from(context).notify(id, builder.build());
        } catch (Exception ignored) {
            /* 알림 권한이 없으면 조용히 넘어간다 — 감시는 계속 */
        }
    }

    private static boolean soundFor(String channelId) {
        return !CH_NEWS.equals(channelId);
    }

    /** 알림 id — 같은 조건·기사는 같은 id 로 교체된다 */
    public static int idFor(String key) {
        int hash = 0;
        for (int i = 0; i < key.length(); i++) hash = hash * 31 + key.charAt(i);
        return (Math.abs(hash) % 100000) + 1;
    }
}
