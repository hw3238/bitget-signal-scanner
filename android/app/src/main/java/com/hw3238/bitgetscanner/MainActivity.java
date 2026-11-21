package com.hw3238.bitgetscanner;

import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int NEON_BG = Color.parseColor("#050814");
    private static final String REMOTE_URL = "https://hw3238.github.io/bitget-signal-scanner/";
    private static final String FALLBACK_URL = "file:///android_asset/public/index.html";

    private boolean usingFallback = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppShellPlugin.class);
        super.onCreate(savedInstanceState);

        applyNeonChrome();

        WebView webView = bridge.getWebView();
        webView.getSettings().setAllowFileAccess(true);
        webView.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url != null && url.startsWith("file:///android_asset/public/")) {
                    injectOfflineNotice(view);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
                    loadFallback(view);
                    return;
                }
                super.onReceivedError(view, request, error);
            }

            @Override
            public void onReceivedHttpError(
                WebView view,
                WebResourceRequest request,
                WebResourceResponse response
            ) {
                if (
                    request != null &&
                    request.isForMainFrame() &&
                    response != null &&
                    response.getStatusCode() >= 400
                ) {
                    loadFallback(view);
                    return;
                }
                super.onReceivedHttpError(view, request, response);
            }
        });
    }

    /** 상태바·내비게이션 바를 앱 배경(#050814)과 같은 다크 네온으로 맞춘다. */
    private void applyNeonChrome() {
        Window window = getWindow();
        window.setStatusBarColor(NEON_BG);
        window.setNavigationBarColor(NEON_BG);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = window.getDecorView().getSystemUiVisibility();
            flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            window.getDecorView().setSystemUiVisibility(flags);
        }
    }

    /** GitHub Pages 로딩이 실패하면 앱에 내장된 dist 화면으로 폴백한다. */
    private void loadFallback(WebView view) {
        if (usingFallback) return;
        usingFallback = true;
        view.loadUrl(FALLBACK_URL);
    }

    /** 폴백 화면 위에 '온라인 다시 시도' 안내를 얹는다. */
    private void injectOfflineNotice(WebView view) {
        String js =
            "(function(){try{if(document.getElementById('offline-banner'))return;" +
            "var d=document.createElement('div');d.id='offline-banner';" +
            "d.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:10px 12px;" +
            "background:#141024;color:#e8eeff;font:13px/1.4 system-ui,sans-serif;display:flex;gap:10px;" +
            "align-items:center;border-top:1px solid rgba(122,158,255,.4)';" +
            "var s=document.createElement('span');s.style.flex='1';" +
            "s.textContent='내장된 오프라인 화면입니다. 네트워크 연결 후 최신 버전을 불러올 수 있어요.';" +
            "var b=document.createElement('button');b.textContent='온라인 다시 시도';" +
            "b.style.cssText='background:#00f5a0;color:#04121f;border:0;border-radius:10px;padding:6px 10px;" +
            "font-weight:700;white-space:nowrap';" +
            "b.onclick=function(){location.href='" + REMOTE_URL + "';};" +
            "d.appendChild(s);d.appendChild(b);document.body.appendChild(d);}catch(e){}})();";
        view.evaluateJavascript(js, null);
    }
}
