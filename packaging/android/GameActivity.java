package io.github.dontcry522.realmechoes.reborn;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.res.AssetManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.webkit.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** A local-asset host for the unchanged game; no JavaScript-to-native bridge. */
public final class GameActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView web;
    private Set<String> files;
    private boolean workerConfigured;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Request safe bounds; Android 15 edge-to-edge also needs explicit insets below.
        WindowManager.LayoutParams params = getWindow().getAttributes();
        params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER;
        getWindow().setAttributes(params);
        try {
            files = new HashSet<>();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(getAssets().open("asset-paths.txt"), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) files.add("/game/" + line);
            }
            web = new WebView(this);
        } catch (Exception error) {
            new AlertDialog.Builder(this).setTitle("暂时无法启动")
                .setMessage("请在系统应用商店更新 Android System WebView / 系统网页组件，再重新打开游戏。")
                .setPositiveButton("关闭", (dialog, which) -> finish()).show();
            return;
        }
        web.setBackgroundColor(Color.rgb(16, 46, 44));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        // No network fallback: every request, including worker requests, is handled locally.
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !local(request.getUrl()) || !files.contains(request.getUrl().getPath());
            }
            @Override public void onPageFinished(WebView view, String url) { immersive(); }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                view.destroy(); web = null;
                new AlertDialog.Builder(GameActivity.this).setTitle("游戏画面已停止")
                    .setMessage("系统释放了网页渲染进程。可以重新打开游戏；已保存的设置与图鉴仍在，当前对局无法恢复。")
                    .setPositiveButton("重新打开", (dialog, which) -> recreate())
                    .setNegativeButton("关闭", (dialog, which) -> finish()).show();
                return true;
            }
        });
        ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request) { return serve(request); }
        });
        workerConfigured = true;
        web.setWebChromeClient(new WebChromeClient());
        FrameLayout content = new FrameLayout(this);
        content.setBackgroundColor(Color.BLACK);
        content.addView(web, new FrameLayout.LayoutParams(-1, -1));
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            android.view.DisplayCutout cutout = insets.getDisplayCutout();
            view.setPadding(cutout == null ? 0 : cutout.getSafeInsetLeft(), cutout == null ? 0 : cutout.getSafeInsetTop(), cutout == null ? 0 : cutout.getSafeInsetRight(), cutout == null ? 0 : cutout.getSafeInsetBottom());
            return insets;
        });
        setContentView(content);
        immersive();
        web.loadUrl("https://" + HOST + "/game/play.html?v=229");
    }

    private static boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }
    private WebResourceResponse serve(WebResourceRequest request) {
        Uri uri = request.getUrl();
        String path = uri.getPath();
        if (!local(uri) || !"GET".equals(request.getMethod()) || !files.contains(path)) return missing();
        try {
            InputStream stream = getAssets().open(path.substring(1), AssetManager.ACCESS_STREAMING);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            headers.put("X-Content-Type-Options", "nosniff");
            // .gz files are payloads decompressed by character-loader.js, not HTTP encodings.
            return new WebResourceResponse(mime(path), "UTF-8", 200, "OK", headers, stream);
        } catch (IOException error) { return missing(); }
    }
    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    private static String mime(String path) {
        String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (ext) {
            case "js": case "mjs": return "text/javascript";
            case "html": return "text/html";
            case "css": return "text/css";
            case "json": return "application/json";
            case "webmanifest": return "application/manifest+json";
            case "gltf": return "model/gltf+json";
            case "glb": return "model/gltf-binary";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "ogg": return "audio/ogg";
            case "mp3": return "audio/mpeg";
            case "svg": return "image/svg+xml";
            case "txt": case "md": return "text/plain";
            default: return "application/octet-stream";
        }
    }
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) immersive();
    }
    @Override protected void onPause() {
        if (web != null) {
            web.evaluateJavascript("(()=>{const g=window.game3d;if(g?.state==='playing')g.pause();g?.audio?.ctx?.suspend().catch(()=>{});})()", null);
            web.onPause();
        }
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume(); // The player resumes the paused game explicitly.
    }
    @Override public void onBackPressed() {
        if (web == null) { finish(); return; }
        web.evaluateJavascript("(()=>{const g=window.game3d;if(g?.state==='playing'){g.pause();return 'paused';}return 'exit';})()", result -> {
            if (!"\"paused\"".equals(result)) new AlertDialog.Builder(this).setTitle("退出异境回响？")
                .setMessage("设置与图鉴会保留，当前对局不会保存。")
                .setNegativeButton("留在游戏", null).setPositiveButton("退出", (dialog, which) -> finish()).show();
        });
    }
    @Override protected void onDestroy() {
        if (workerConfigured) ServiceWorkerController.getInstance().setServiceWorkerClient(null);
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
