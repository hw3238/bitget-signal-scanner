package com.hw3238.bitgetscanner;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 앱 셸 전용 네이티브 기능.
 * - saveImage: WebView에서 막히는 blob 다운로드를 갤러리 저장으로 대체
 * - shareImage: 저장된 PNG를 안드로이드 공유 시트로 전달
 * - openExternal: APK 다운로드 같은 외부 링크를 시스템 브라우저로 열기
 * - appInfo: 설치된 APK의 버전 확인
 * - notifySignal: 시그널을 안드로이드 상단 알림바에 표시(소리·진동, 탭하면 앱 열림)
 * - notificationPermission / requestNotificationPermission: Android 13+ 알림권한
 */
@CapacitorPlugin(
    name = "AppShell",
    permissions = {
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class AppShellPlugin extends Plugin {

    private static final String CHANNEL_ID = "bitget_signals";
    private static final String CHANNEL_NAME = "시그널 알림";
    private static final String CHANNEL_DESC = "비트겟 CRT 스캐너의 새 시그널 알림";

    /** 알림 채널 생성 — Android 8+ 는 채널 중요도가 소리·진동·헤드업을 결정한다. */
    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = (NotificationManager) getContext()
            .getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(CHANNEL_DESC);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 260, 160, 260 });
        channel.enableLights(true);
        channel.setLightColor(Color.parseColor("#00F5A0"));
        channel.setShowBadge(true);
        AudioAttributes audio = new AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .build();
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), audio);
        manager.createNotificationChannel(channel);
    }

    /** android.permission.POST_NOTIFICATIONS 허용 여부 (Android 13 미만은 알림 차단 설정 여부) */
    private boolean hasNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            int state = ContextCompat.checkSelfPermission(
                getContext(),
                Manifest.permission.POST_NOTIFICATIONS
            );
            if (state != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
        }
        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
    }

    private JSObject permissionResult(boolean granted) {
        JSObject ret = new JSObject();
        ret.put("supported", true);
        ret.put("granted", granted);
        return ret;
    }

    @PluginMethod
    public void notificationPermission(PluginCall call) {
        call.resolve(permissionResult(hasNotificationPermission()));
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasNotificationPermission()) {
            call.resolve(permissionResult(hasNotificationPermission()));
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        call.resolve(permissionResult(hasNotificationPermission()));
    }

    @PluginMethod
    public void notifySignal(PluginCall call) {
        String title = call.getString("title", "비트겟 CRT 시그널");
        String body = call.getString("body", "");
        Integer idValue = call.getInt("id");
        int id = idValue != null ? idValue : (int) (System.currentTimeMillis() % 100000) + 1;
        try {
            ensureChannel();
            post(title, body, id);
            JSObject ret = new JSObject();
            ret.put("shown", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("알림 표시 실패: " + e.getMessage());
        }
    }

    /** 알림바 표시 — 탭하면 앱이 열리도록 PendingIntent 를 연결한다. */
    private void post(String title, String body, int id) {
        Context context = getContext();
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("bgss.signalNotification", true);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pending = PendingIntent.getActivity(context, id, intent, flags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_signal)
            .setColor(Color.parseColor("#00F5A0"))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setWhen(System.currentTimeMillis())
            .setShowWhen(true)
            .setContentIntent(pending);

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // 채널이 없는 버전은 알림 자체에 소리·진동 기본값을 붙인다.
            builder.setDefaults(NotificationCompat.DEFAULT_ALL);
        }
        NotificationManagerCompat.from(context).notify(id, builder.build());
    }

    @PluginMethod
    public void saveImage(PluginCall call) {
        byte[] bytes = decode(call);
        if (bytes == null) {
            return;
        }
        String fileName = call.getString("fileName", "crt-signal.png");
        try {
            String uri = writeToGallery(bytes, fileName);
            JSObject ret = new JSObject();
            ret.put("uri", uri);
            toast("PNG를 갤러리에 저장했습니다");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("저장 실패: " + e.getMessage());
        }
    }

    @PluginMethod
    public void shareImage(PluginCall call) {
        byte[] bytes = decode(call);
        if (bytes == null) {
            return;
        }
        String fileName = call.getString("fileName", "crt-signal.png");
        try {
            File dir = new File(getContext().getCacheDir(), "shared");
            if (!dir.exists() && !dir.mkdirs()) {
                throw new Exception("cache dir 생성 실패");
            }
            File file = new File(dir, fileName);
            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(bytes);
            }
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/png");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "시그널 카드 공유");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("공유 실패: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url required");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("링크 열기 실패: " + e.getMessage());
        }
    }

    @PluginMethod
    public void appInfo(PluginCall call) {
        try {
            android.content.pm.PackageInfo info = getContext()
                .getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;
            JSObject ret = new JSObject();
            ret.put("versionName", info.versionName);
            ret.put("versionCode", code);
            ret.put("packageName", getContext().getPackageName());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private void toast(final String message) {
        if (getActivity() == null) return;
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(getContext(), message, Toast.LENGTH_SHORT).show();
            }
        });
    }

    private byte[] decode(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null || base64.isEmpty()) {
            call.reject("base64 required");
            return null;
        }
        int comma = base64.indexOf(',');
        if (comma > -1) {
            base64 = base64.substring(comma + 1);
        }
        try {
            return Base64.decode(base64, Base64.DEFAULT);
        } catch (Exception e) {
            call.reject("이미지 데이터 오류: " + e.getMessage());
            return null;
        }
    }

    private String writeToGallery(byte[] bytes, String fileName) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            values.put(
                MediaStore.Images.Media.RELATIVE_PATH,
                Environment.DIRECTORY_PICTURES + "/CRT-Scanner"
            );
            values.put(MediaStore.Images.Media.IS_PENDING, 1);
            ContentResolver resolver = getContext().getContentResolver();
            Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                throw new Exception("MediaStore 저장소를 열 수 없습니다");
            }
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) {
                    throw new Exception("출력 스트림을 열 수 없습니다");
                }
                out.write(bytes);
            }
            values.clear();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            return uri.toString();
        }

        File dir = new File(
            getContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES),
            "CRT-Scanner"
        );
        if (!dir.exists() && !dir.mkdirs()) {
            throw new Exception("저장 폴더를 만들 수 없습니다");
        }
        File file = new File(dir, fileName);
        try (FileOutputStream fos = new FileOutputStream(file)) {
            fos.write(bytes);
        }
        return file.getAbsolutePath();
    }
}
