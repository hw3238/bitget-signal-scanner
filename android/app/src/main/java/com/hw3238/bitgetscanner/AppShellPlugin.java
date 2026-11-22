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
import android.provider.Settings;
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
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

/**
 * 앱 셸 전용 네이티브 기능.
 * - saveImage: WebView에서 막히는 blob 다운로드를 갤러리 저장으로 대체
 * - shareImage: 저장된 PNG를 안드로이드 공유 시트로 전달
 * - openExternal: APK 다운로드 같은 외부 링크를 시스템 브라우저로 열기
 * - openBitgetFutures: 비트겟 선물 화면을 비트겟 안드로이드 앱으로 바로 열기(앱 링크 → 딥링크 → 앱 실행 → 브라우저 폴백)
 * - appInfo: 설치된 APK의 버전 확인
 * - notifySignal: 시그널을 안드로이드 상단 알림바에 표시(소리·진동, 탭하면 앱 열림)
 * - notificationPermission / requestNotificationPermission: Android 13+ 알림권한
 * - canInstallPackages / openInstallPermissionSettings / downloadAndInstallApk: 앱 안에서 APK 다운로드 → 설치 화면
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

    private static final String BITGET_PACKAGE = "com.bitget.exchange";
    private static final String CHANNEL_ID = "bitget_signals";
    private static final String CHANNEL_NAME = "시그널 알림";
    private static final String CHANNEL_DESC = "COTA의 새 시그널 알림";

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
        channel.setLightColor(Color.parseColor("#3182F6"));
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
        String title = call.getString("title", "COTA 시그널");
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
            .setColor(Color.parseColor("#3182F6"))
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

    /**
     * 비트겟 선물 화면을 **비트겟 안드로이드 앱**으로 연다.
     *  1) 웹 선물 URL(https://www.bitget.com/futures/usdt/{SYMBOL}) + setPackage(비트겟) → 앱 링크(App Link)
     *  2) 비트겟 커스텀 스킴(bitget://...) + setPackage
     *  3) 비트겟 앱 자체 실행(getLaunchIntentForPackage)
     *  4) 비트겟 앱이 없는 기기에서만 기본 브라우저 폴백
     * Android 11+ 패키지 가시성 때문에 AndroidManifest 의 <queries> 에 비트겟 패키지가 필요하다.
     */
    @PluginMethod
    public void openBitgetFutures(PluginCall call) {
        Context context = getContext();
        android.content.pm.PackageManager pm = context.getPackageManager();
        String symbol = call.getString("symbol", "");
        String sym = symbol == null ? "" : symbol.replace(" ", "").toUpperCase(Locale.ROOT);
        String url = call.getString("url", "");
        if (url == null || url.isEmpty()) {
            url = sym.isEmpty()
                ? "https://www.bitget.com/futures/usdt/BTCUSDT"
                : "https://www.bitget.com/futures/usdt/" + sym;
        }
        boolean installed = isPackageInstalled(pm);

        // 1) 앱 링크 — 웹 URI 를 비트겟 앱이 직접 받는다(비트겟 assetlinks 에 등록된 패키지).
        if (installed && startInPackage(pm, Intent.ACTION_VIEW, Uri.parse(url))) {
            resolveRoute(call, "app-link", true);
            return;
        }
        // 2) 비트겟 커스텀 스킴 — 앱이 선언한 딥링크 후보를 순서대로 시도.
        if (installed && !sym.isEmpty()) {
            String[] schemes = new String[] {
                "bitget://futures/usdt/" + sym,
                "bitget://www.bitget.com/futures/usdt/" + sym,
                "bitget://futures/trade?symbol=" + sym,
            };
            for (String scheme : schemes) {
                if (startInPackage(pm, Intent.ACTION_VIEW, Uri.parse(scheme))) {
                    resolveRoute(call, "deeplink", true);
                    return;
                }
            }
        }
        // 3) 비트겟 앱은 깔려 있는데 위 인텐트를 못 받는 경우 — 앱 자체를 연다(웹사이트 대신).
        if (installed) {
            Intent launch = pm.getLaunchIntentForPackage(BITGET_PACKAGE);
            if (launch != null) {
                try {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(launch);
                    resolveRoute(call, "app-launch", true);
                    return;
                } catch (Exception ignored) {
                    /* 다음 폴백으로 */
                }
            }
        }
        // 4) 최종 폴백 — 비트겟 앱이 없거나 열 수 없을 때만 기본 브라우저.
        try {
            Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            browser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(browser);
            resolveRoute(call, "browser", installed);
        } catch (Exception e) {
            call.reject("비트겟 링크 열기 실패: " + e.getMessage());
        }
    }

    private boolean isPackageInstalled(android.content.pm.PackageManager pm) {
        try {
            pm.getPackageInfo(BITGET_PACKAGE, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 패키지를 고정한 인텐트가 실제로 처리 가능할 때만 실행한다. */
    private boolean startInPackage(android.content.pm.PackageManager pm, String action, Uri uri) {
        try {
            Intent intent = new Intent(action, uri);
            intent.setPackage(BITGET_PACKAGE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (intent.resolveActivity(pm) == null) {
                return false;
            }
            getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void resolveRoute(PluginCall call, String via, boolean installed) {
        JSObject ret = new JSObject();
        ret.put("via", via);
        ret.put("installed", installed);
        call.resolve(ret);
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

    /* ------------------------------------------------------------------ *
     * 앱 안에서 바로 업데이트 — APK 다운로드(진행률) → 안드로이드 설치 화면
     * ------------------------------------------------------------------ */

    /** Android 8.0+ 에서 "출처를 알 수 없는 앱 설치" 허용 여부 */
    private boolean isInstallAllowed() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getContext().getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", isInstallAllowed());
        ret.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    /** 설정 → 앱 → 출처를 알 수 없는 앱 설치 허용 화면으로 이동 */
    private void startInstallPermissionSettings() {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        } else {
            intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        try {
            startInstallPermissionSettings();
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("설정 화면을 열지 못했습니다: " + e.getMessage());
        }
    }

    /**
     * APK를 앱 캐시에 내려받아 설치 화면을 연다.
     *  - 진행률은 'apkProgress' 이벤트(0~100)로 웹에 전달한다.
     *  - Android 8.0+ 에서 설치 권한이 없으면 needsPermission=true 로 응답하고 설정 화면을 띄운다.
     */
    @PluginMethod
    public void downloadAndInstallApk(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url required");
            return;
        }
        final String fileName = call.getString("fileName", "cota-update.apk");
        if (!isInstallAllowed()) {
            try {
                startInstallPermissionSettings();
            } catch (Exception ignored) {
                /* 설정 화면을 못 열어도 결과는 돌려준다 */
            }
            JSObject ret = new JSObject();
            ret.put("started", false);
            ret.put("needsPermission", true);
            call.resolve(ret);
            return;
        }

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                File dir = new File(getContext().getCacheDir(), "apk-update");
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new Exception("다운로드 폴더를 만들 수 없습니다");
                }
                File target = new File(dir, fileName);

                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(60000);
                conn.setRequestProperty("User-Agent", "COTA-Android");
                conn.setRequestProperty("Accept", "application/vnd.android.package-archive,*/*");
                int code = conn.getResponseCode();
                // http → https 리다이렉트는 자동으로 따라가지 않으므로 몇 단계 직접 따라간다.
                int hops = 0;
                while (code >= 300 && code < 400 && hops < 4) {
                    String location = conn.getHeaderField("Location");
                    if (location == null) break;
                    URL base = conn.getURL();
                    conn.disconnect();
                    conn = (HttpURLConnection) new URL(base, location).openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(60000);
                    conn.setRequestProperty("User-Agent", "COTA-Android");
                    code = conn.getResponseCode();
                    hops += 1;
                }
                if (code != HttpURLConnection.HTTP_OK) {
                    throw new Exception("HTTP " + code);
                }
                long total = conn.getContentLengthLong();
                long downloaded = 0;
                int lastPct = -1;
                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(target)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = in.read(buffer)) > 0) {
                        out.write(buffer, 0, read);
                        downloaded += read;
                        int pct = total > 0 ? (int) Math.min(100, downloaded * 100 / total) : -1;
                        if (pct >= 0 && pct != lastPct) {
                            lastPct = pct;
                            notifyApkProgress(pct, downloaded, total);
                        }
                    }
                    out.flush();
                }
                if (target.length() <= 0) {
                    throw new Exception("내려받은 파일이 비어 있습니다");
                }
                notifyApkProgress(100, target.length(), target.length());

                // 설치 화면 열기 — FileProvider URI + 패키지 설치 인텐트
                Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    target
                );
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(install);

                JSObject ret = new JSObject();
                ret.put("started", true);
                ret.put("needsPermission", false);
                ret.put("bytes", target.length());
                ret.put("path", target.getAbsolutePath());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("APK 다운로드 실패: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    /** 진행률 이벤트(0~100%) */
    private void notifyApkProgress(int pct, long bytes, long total) {
        JSObject data = new JSObject();
        data.put("progress", pct);
        data.put("bytes", bytes);
        data.put("total", total);
        notifyListeners("apkProgress", data);
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
                Environment.DIRECTORY_PICTURES + "/COTA"
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
            "COTA"
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
