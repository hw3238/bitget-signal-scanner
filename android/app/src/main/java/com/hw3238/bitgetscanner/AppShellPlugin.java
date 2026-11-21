package com.hw3238.bitgetscanner;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 앱 셸 전용 네이티브 기능.
 * - saveImage: WebView에서 막히는 blob 다운로드를 갤러리 저장으로 대체
 * - shareImage: 저장된 PNG를 안드로이드 공유 시트로 전달
 * - openExternal: APK 다운로드 같은 외부 링크를 시스템 브라우저로 열기
 * - appInfo: 설치된 APK의 버전 확인
 */
@CapacitorPlugin(name = "AppShell")
public class AppShellPlugin extends Plugin {

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
