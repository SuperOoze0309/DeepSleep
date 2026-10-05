package com.deepsleep.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Locale;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 单 Activity + WebView 外壳。
 *
 * 前端页面由 LocalServer 通过 http://127.0.0.1:port 提供，
 * 所有 AI 请求经本地代理转发到用户自己填写的 OpenAI 兼容接口。
 *
 * 顶部采用「只让状态栏区域浸入」的方案：SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
 * 让内容画到状态栏底下，再把状态栏高度以 CSS 变量 --inset-top 交给页面；
 * 底部不进浸入，交给 adjustResize 处理键盘，这样各版本行为最稳定。
 */
public class MainActivity extends Activity {

    private static final String TAG = "DeepSleep";
    private static final int REQ_FILE_CHOOSER = 1001;

    /** 尽量固定本地端口，保证页面 origin 稳定（localStorage 按源隔离） */
    private static final int[] PORT_CANDIDATES = { 8791, 8792, 8793, 8794 };

    private FrameLayout root;
    private WebView web;
    private LocalServer server;
    private String appToken;
    private String startUrl;
    private ValueCallback<Uri[]> fileCallback;
    private volatile boolean darkTheme = false;

    /** 由 WindowInsets 回调测量到的状态栏高度（dp），-1 表示还没测到 */
    private int measuredTopInsetDp = -1;
    /** 最近一次真正推送给页面的值，用来避免重复推送 */
    private int pushedTopInsetDp = Integer.MIN_VALUE;


    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String pendingSpeak = null;
    private String ttsVoiceName = null;
    private float ttsRate = 1.0f;
    private float ttsPitch = 1.0f;
    /** 每次朗读自增的代号，用来过滤被打断那条的迟到回调 */
    private int ttsGen = 0;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        int nightMode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        darkTheme = nightMode == Configuration.UI_MODE_NIGHT_YES;

        WebView.setWebContentsDebuggingEnabled(true);

        root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        createWebView();
        // 必须在 createWebView 之后再加开屏 —— root 是 FrameLayout，
        // 后加的在上面；顺序反了 WebView 会把开屏整个盖住，
        // 表现就是「完全没有开屏画面」。
        showSplash();
        applySystemBars(darkTheme, defaultBarColor(darkTheme));
        installInsetsListener(root);

        appToken = randomToken();

        try {
            server = new LocalServer(getAssets(), appToken, appVersion(), new LocalServer.Logger() {
                @Override
                public void log(String message) {
                    Log.d(TAG, message);
                }
            });
            int port = server.start(PORT_CANDIDATES);
            startUrl = "http://127.0.0.1:" + port + "/";
            Log.i(TAG, "local server on 127.0.0.1:" + port + " (origin must stay stable)");
            web.loadUrl(startUrl);
        } catch (Exception e) {
            Log.e(TAG, "failed to start local server", e);
            Toast.makeText(this, "本地服务启动失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /* ==================================================================
       开屏画面
       盖在 WebView 上面，至少显示 1 秒再淡出。
       本地服务器起来 + WebView 首帧渲染要一点时间，没有它就会先白屏一下。
       ================================================================== */

    private static final long SPLASH_MIN_MS = 1000;

    private View splashView = null;
    private long splashShownAt = 0;
    private boolean pageReady = false;

    private void showSplash() {
        try {
            FrameLayout wrap = new FrameLayout(this);
            wrap.setBackgroundColor(0xFFFFFFFF);
            wrap.setClickable(true);   // 挡住底下的点击，别让用户点到 WebView

            ImageView img = new ImageView(this);
            // 这套构建流程不生成 R.java（此前所有资源都是代码里设的），
            // 所以按名字取 drawable，而不是写 R.drawable.xxx
            // 开屏图跟随设置：maid = 鲸娘女仆，其余（含自定义）先用像素鲸鱼
            boolean useMaid = "maid".equals(getSharedPreferences("deepsleep", MODE_PRIVATE)
                    .getString("splashArt", "pixel"));
            int drawableId = getResources().getIdentifier(
                    useMaid ? "splash_char" : "splash_pixel", "drawable", getPackageName());
            if (drawableId != 0) img.setImageResource(drawableId);
            img.setBackgroundColor(useMaid ? 0xFFFFFFFF : 0xFFFDEBF3);
            img.setScaleType(ImageView.ScaleType.FIT_CENTER);
            FrameLayout.LayoutParams ilp = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT);
            ilp.gravity = Gravity.CENTER;
            img.setLayoutParams(ilp);
            wrap.addView(img);

            root.addView(wrap, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
            splashView = wrap;
            splashShownAt = System.currentTimeMillis();

            // 兜底：万一 onPageFinished 没来（加载失败、本地服务器异常），
            // 也不能让开屏一直挂着把界面挡死
            wrap.postDelayed(new Runnable() {
                @Override
                public void run() {
                    pageReady = true;
                    hideSplashWhenReady();
                }
            }, SPLASH_MIN_MS + 4000);
        } catch (Exception e) {
            Log.w(TAG, "showSplash failed", e);
        }
    }

    /** 页面就绪后调用；不足 1 秒就补足，然后淡出 */
    private void hideSplashWhenReady() {
        final View v = splashView;
        if (v == null || !pageReady) return;
        long delay = Math.max(0, SPLASH_MIN_MS - (System.currentTimeMillis() - splashShownAt));
        v.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (splashView != v) return;   // 已经被换掉了
                splashView = null;
                v.animate().alpha(0f).setDuration(260).withEndAction(new Runnable() {
                    @Override
                    public void run() {
                        try { root.removeView(v); } catch (Exception ignored) { }
                    }
                }).start();
            }
        }, delay);
    }

    /* ==================================================================
       WebView 生命周期
       ================================================================== */

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(web);

        configureWebView();
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        clearWebCacheIfUpgraded();
    }

    /**
     * 版本变化时清掉 WebView 的 HTTP 缓存。
     *
     * 前端资源是打在 APK 里的，按理说跟着版本走就行；但 WebView 会把它们
     * 按响应头缓存下来，旧的 js/css 可能存活到过期为止。升级后如果出现
     * 「新页面配旧脚本」，症状会非常费解（例如切到新配色却提示切成官方蓝）。
     * 现在资源响应已经是 no-store，这里再兜一道，保证升级后立刻用新代码。
     *
     * 注意只清 HTTP 缓存，不动 WebStorage —— 那里面还有用户的 localStorage 副本。
     */
    private void clearWebCacheIfUpgraded() {
        try {
            SharedPreferences sp = getSharedPreferences("deepsleep", MODE_PRIVATE);
            int seen = sp.getInt("assetVersion", -1);
            int now = getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
            if (seen != now) {
                web.clearCache(true);
                sp.edit().putInt("assetVersion", now).apply();
                Log.i(TAG, "webview cache cleared for upgrade " + seen + " -> " + now);
            }
        } catch (Exception e) {
            Log.w(TAG, "clearWebCacheIfUpgraded failed", e);
        }
    }

    /** 渲染进程被系统回收（内存紧张）后用新 WebView 顶上，避免留下无法操作的白屏 */
    private void rebuildWebView() {
        Log.w(TAG, "rebuilding WebView after renderer loss");
        try {
            root.removeView(web);
            web.destroy();
        } catch (Exception e) {
            Log.w(TAG, "failed to tear down dead WebView", e);
        }
        createWebView();
        applySystemBars(darkTheme, defaultBarColor(darkTheme));
        installInsetsListener(root);
        pushedTopInsetDp = Integer.MIN_VALUE;
        if (startUrl != null) web.loadUrl(startUrl);
    }

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1.0.0";
        }
    }

    private static String randomToken() {
        byte[] raw = new byte[16];
        new SecureRandom().nextBytes(raw);
        StringBuilder sb = new StringBuilder(32);
        for (byte b : raw) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadsImagesAutomatically(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // 图片附件依赖 WebView 读取 content:// URI
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);

        s.setUserAgentString(s.getUserAgentString() + " DeepSleep/" + appVersion());

        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // 页面里可能已经有 pending 的流式输出，先让它落盘
                view.evaluateJavascript("window.__onPauseFlush&&window.__onPauseFlush()", null);
                // 关键：页面重新加载后必须把状态栏高度再推一次，
                // 否则首次推送发生在页面脚本就绪之前会被丢掉，顶栏会钻到状态栏下面。
                pushedTopInsetDp = Integer.MIN_VALUE;
                pushTopInset();
                view.evaluateJavascript("window.__onNativeTheme&&window.__onNativeTheme()", null);
                // 页面就绪，开屏可以退场了（内部会补足最短显示时间）
                pageReady = true;
                hideSplashWhenReady();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // 返回 true = 已处理，否则系统会连带杀掉整个 App
                Log.e(TAG, "render process gone, didCrash=" + (detail != null && detail.didCrash()));
                rebuildWebView();
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(
                            Intent.createChooser(intent, "选择图片"), REQ_FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "没有可用的文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage msg) {
                Log.d(TAG, "[web] " + msg.message() + " @" + msg.sourceId() + ":" + msg.lineNumber());
                return true;
            }
        });
    }

    /** 站内地址留在 WebView，其余一律交给系统浏览器 */
    private boolean handleUrl(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.US);
        String host = uri.getHost() == null ? "" : uri.getHost();

        if (("http".equals(scheme) || "https".equals(scheme))
                && ("127.0.0.1".equals(host) || "localhost".equals(host))) {
            return false;
        }
        if ("http".equals(scheme) || "https".equals(scheme)
                || "mailto".equals(scheme) || "tel".equals(scheme) || "sms".equals(scheme)) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, uri);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception e) {
                Toast.makeText(this, "无法打开链接", Toast.LENGTH_SHORT).show();
            }
            return true;
        }
        return true;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (fileCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        results = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            results[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    } else if (data.getData() != null) {
                        results = new Uri[]{data.getData()};
                    }
                }
                fileCallback.onReceiveValue(results);
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /* ==================================================================
       状态栏 / 导航栏
       ================================================================== */

    @SuppressWarnings("deprecation")
    private void applySystemBars(boolean dark, int navColor) {
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(navColor);
        if (Build.VERSION.SDK_INT >= 29) {
            w.setNavigationBarContrastEnforced(false);
        }

        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
        if (!dark) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= 26) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
        }
        w.getDecorView().setSystemUiVisibility(flags);
    }

    @SuppressWarnings("deprecation")
    private void installInsetsListener(final View target) {
        target.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int topPx;
                if (Build.VERSION.SDK_INT >= 30) {
                    topPx = insets.getInsets(
                            WindowInsets.Type.statusBars() | WindowInsets.Type.displayCutout()).top;
                } else {
                    topPx = insets.getSystemWindowInsetTop();
                }
                measuredTopInsetDp = pxToDp(topPx);
                pushTopInset();
                return insets;
            }
        });
        target.requestApplyInsets();
    }

    private static int defaultBarColor(boolean dark) {
        return dark ? 0xFF131417 : 0xFFFFFFFF;
    }

    /** 解析 "#RRGGBB"，失败时返回 fallback */
    private static int parseHexColor(String hex, int fallback) {
        if (hex == null) return fallback;
        String s = hex.trim();
        if (s.startsWith("#")) s = s.substring(1);
        if (s.length() == 3) {
            s = "" + s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
        }
        if (s.length() != 6) return fallback;
        try {
            return 0xFF000000 | Integer.parseInt(s, 16);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private int pxToDp(int px) {
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) return px;
        return Math.round(px / density);
    }

    /** 兜底：即使 insets 回调没触发，也用系统资源里的状态栏高度撑住顶部 */
    private int statusBarHeightDp() {
        int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
        int px = id > 0 ? getResources().getDimensionPixelSize(id) : 0;
        int dp = pxToDp(px);
        return dp > 0 ? dp : 24;
    }

    private int currentTopInsetDp() {
        return measuredTopInsetDp >= 0 ? measuredTopInsetDp : statusBarHeightDp();
    }

    private void pushTopInset() {
        int top = currentTopInsetDp();
        if (top == pushedTopInsetDp) return;
        pushedTopInsetDp = top;
        dispatchJs("window.__onInsets&&window.__onInsets(" + top + ",0)");
    }

    private void dispatchJs(final String js) {
        if (web == null) return;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    web.evaluateJavascript(js, null);
                } catch (Exception e) {
                    Log.w(TAG, "evaluateJavascript failed: " + e);
                }
            }
        });
    }

    /** 拼一个安全的 JS 单引号字符串字面量 */
    private static String jsQuote(String s) {
        if (s == null) return "''";
        StringBuilder sb = new StringBuilder("'");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '\'': sb.append("\\'"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                case '\u2028': sb.append("\\u2028"); break;
                case '\u2029': sb.append("\\u2029"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('\'').toString();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        boolean dark = (newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        darkTheme = dark;
        applySystemBars(dark, defaultBarColor(dark));
        pushTopInset();
        dispatchJs("window.__onNativeTheme&&window.__onNativeTheme()");
    }

    /* ==================================================================
       生命周期 / 返回键
       ================================================================== */

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(
                "(function(){try{return window.__onBack?window.__onBack():false}catch(e){return false}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (!"true".equals(value)) {
                            finish();
                        }
                    }
                });
    }

    @Override
    protected void onPause() {
        super.onPause();
        dispatchJs("window.__onPauseFlush&&window.__onPauseFlush()");
    }

    @Override
    protected void onDestroy() {
        try {
            if (tts != null) {
                tts.stop();
                tts.shutdown();
                tts = null;
                ttsReady = false;
            }
        } catch (Exception e) {
            Log.w(TAG, "tts shutdown failed", e);
        }
        // 退出前把未落盘的键值数据刷掉
        try {
            kvDirty.set(true);
            writeKvNow();
            kvExecutor.shutdown();
        } catch (Exception e) {
            Log.w(TAG, "kv flush on destroy failed", e);
        }
        if (server != null) server.stop();
        if (web != null) {
            try {
                web.removeJavascriptInterface("AndroidBridge");
                root.removeView(web);
                web.destroy();
            } catch (Exception e) {
                Log.w(TAG, "webview teardown failed", e);
            }
            web = null;
        }
        super.onDestroy();
    }

    /* ==================================================================
       原生键值存储
       页面跑在 http://127.0.0.1:<port> 上，localStorage 按源隔离，
       端口一变数据就没了（用户反馈过「配置 API 以后没有保存」）。
       这里用文件 + JSON 做一份权威存储，前端读写都走它，
       localStorage 只作为副本与降级路径。
       ================================================================== */

    private final Object kvLock = new Object();
    private JSONObject kvData = null;
    private File kvFile = null;
    private final java.util.concurrent.ExecutorService kvExecutor =
            java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.concurrent.atomic.AtomicBoolean kvDirty =
            new java.util.concurrent.atomic.AtomicBoolean(false);

    private File kvFile() {
        if (kvFile == null) kvFile = new File(getFilesDir(), "app-store.json");
        return kvFile;
    }

    private JSONObject kv() {
        synchronized (kvLock) {
            if (kvData == null) {
                kvData = new JSONObject();
                try {
                    File f = kvFile();
                    if (f.exists() && f.length() > 0) {
                        FileInputStream in = new FileInputStream(f);
                        ByteArrayOutputStream bos = new ByteArrayOutputStream();
                        byte[] buf = new byte[8192];
                        int n;
                        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                        in.close();
                        String text = new String(bos.toByteArray(), StandardCharsets.UTF_8);
                        if (text.length() > 0) kvData = new JSONObject(text);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "kv load failed, starting empty", e);
                    kvData = new JSONObject();
                }
            }
            return kvData;
        }
    }

    private void kvScheduleFlush() {
        kvDirty.set(true);
        kvExecutor.execute(new Runnable() {
            @Override
            public void run() {
                // 合并期间的多次写入，只落盘最后状态
                while (kvDirty.compareAndSet(true, false)) {
                    writeKvNow();
                }
            }
        });
    }

    private void writeKvNow() {
        synchronized (kvLock) {
            try {
                File f = kvFile();
                File tmp = new File(f.getParentFile(), f.getName() + ".tmp");
                FileOutputStream fos = new FileOutputStream(tmp);
                fos.write(kv().toString().getBytes(StandardCharsets.UTF_8));
                fos.flush();
                fos.close();
                if (f.exists() && !f.delete()) Log.w(TAG, "kv: could not delete old file");
                if (!tmp.renameTo(f)) Log.w(TAG, "kv: rename failed");
            } catch (Exception e) {
                Log.e(TAG, "kv write failed", e);
            }
        }
    }

    /* ==================================================================
       朗读（系统 TextToSpeech）
       ================================================================== */

    private void ensureTts() {
        if (tts != null) return;
        try {
            tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() {
                @Override
                public void onInit(int status) {
                    ttsReady = (status == TextToSpeech.SUCCESS);
                    if (!ttsReady) {
                        dispatchJs("window.__onTtsError&&window.__onTtsError('朗读引擎初始化失败，设备可能没有可用的 TTS')");
                        return;
                    }
                    try {
                        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override
                            public void onStart(String id) {
                                if (isCurrentUtterance(id)) {
                                    dispatchJs("window.__onTtsState&&window.__onTtsState('speaking')");
                                }
                            }

                            @Override
                            public void onDone(String id) {
                                if (isCurrentUtterance(id)) {
                                    dispatchJs("window.__onTtsState&&window.__onTtsState('idle')");
                                }
                            }

                            @Override
                            public void onError(String id) {
                                // 被打断的那条也会回调 onError，但它的代号已经过期，
                                // 直接忽略，免得把新一次朗读的状态冲掉、还弹个假错误
                                if (!isCurrentUtterance(id)) return;
                                dispatchJs("window.__onTtsState&&window.__onTtsState('idle')");
                                dispatchJs("window.__onTtsError&&window.__onTtsError('朗读失败')");
                            }
                        });
                    } catch (Exception e) {
                        Log.w(TAG, "setUtteranceProgressListener failed", e);
                    }
                    applyTtsPrefs();
                    dispatchJs("window.__onTtsReady&&window.__onTtsReady(" + ttsVoicesJson() + ")");
                    if (pendingSpeak != null) {
                        String t = pendingSpeak;
                        pendingSpeak = null;
                        speakNow(t);
                    }
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "TextToSpeech init failed", e);
            dispatchJs("window.__onTtsError&&window.__onTtsError('设备不支持朗读')");
        }
    }

    private void applyTtsPrefs() {
        if (tts == null || !ttsReady) return;
        try {
            tts.setSpeechRate(ttsRate);
            tts.setPitch(ttsPitch);
            if (ttsVoiceName != null) {
                java.util.Set<Voice> voices = tts.getVoices();
                if (voices != null) {
                    for (Voice v : voices) {
                        if (v.getName().equals(ttsVoiceName)) {
                            tts.setVoice(v);
                            return;
                        }
                    }
                }
            }
            // 没指定音色就跟随系统语言；中文设备上默认就是中文发音
            tts.setLanguage(Locale.getDefault());
        } catch (Exception e) {
            Log.w(TAG, "applyTtsPrefs failed", e);
        }
    }

    /** 可选音色列表；只保留中英与系统语言，且优先离线音色，否则会有上百项 */
    private String ttsVoicesJson() {
        JSONArray arr = new JSONArray();
        try {
            if (tts == null) return arr.toString();
            java.util.Set<Voice> voices = tts.getVoices();
            if (voices == null) return arr.toString();

            String devLang = Locale.getDefault().getLanguage();
            java.util.List<Voice> keep = new java.util.ArrayList<Voice>();
            for (Voice v : voices) {
                if (v == null || v.getLocale() == null) continue;
                String lang = v.getLocale().getLanguage();
                if (!"zh".equals(lang) && !"en".equals(lang) && !lang.equals(devLang)) continue;
                if (v.isNetworkConnectionRequired()) continue;
                keep.add(v);
            }
            java.util.Collections.sort(keep, new java.util.Comparator<Voice>() {
                @Override
                public int compare(Voice a, Voice b) {
                    int c = a.getLocale().toString().compareTo(b.getLocale().toString());
                    return c != 0 ? c : a.getName().compareTo(b.getName());
                }
            });

            int limit = Math.min(keep.size(), 40);
            for (int i = 0; i < limit; i++) {
                Voice v = keep.get(i);
                JSONObject o = new JSONObject();
                o.put("name", v.getName());
                o.put("locale", v.getLocale().toLanguageTag());
                o.put("label", voiceLabel(v, i + 1));
                arr.put(o);
            }
        } catch (Exception e) {
            Log.w(TAG, "ttsVoicesJson failed", e);
        }
        return arr.toString();
    }

    private static String voiceLabel(Voice v, int index) {
        String lang = v.getLocale().getDisplayName();
        int q = Voice.QUALITY_NORMAL;
        try { q = v.getQuality(); } catch (Exception ignored) { }
        String qs = q >= Voice.QUALITY_VERY_HIGH ? "高品质"
                : (q >= Voice.QUALITY_HIGH ? "较优" : "标准");
        return lang + " · 音色 " + index + "（" + qs + "）";
    }

    /**
     * 只认当前这次朗读的回调。
     *
     * tts.stop() 会让被打断的那一条也回调 onDone/onError。如果不做过滤，
     * 那个迟到的 idle 会在新一次朗读开始之后才到达，把前端的「正在朗读」
     * 状态清掉 —— 表现就是再点一下不会停，而是从头重新念一遍。
     */
    private boolean isCurrentUtterance(String id) {
        return id != null && id.startsWith("ds-" + ttsGen + "-");
    }

    private void speakNow(String text) {
        ensureTts();
        if (tts == null || !ttsReady) {
            pendingSpeak = text;   // 引擎还没就绪，先记下来
            return;
        }
        final String t = (text == null ? "" : text.trim());
        if (t.isEmpty()) return;
        final int gen = ++ttsGen;   // 先换代号，再 stop，这样被打断那条的回调自动失效
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    applyTtsPrefs();
                    tts.stop();
                    int max = TextToSpeech.getMaxSpeechInputLength() - 200;
                    if (max < 500) max = 500;
                    if (t.length() <= max) {
                        tts.speak(t, TextToSpeech.QUEUE_FLUSH, null, "ds-" + gen + "-0");
                        return;
                    }
                    // 超长文本按句子切开排队，否则会被引擎截断
                    int i = 0, n = 0;
                    while (i < t.length()) {
                        int end = Math.min(t.length(), i + max);
                        if (end < t.length()) {
                            int cut = t.lastIndexOf('。', end);
                            if (cut < i + max / 2) cut = t.lastIndexOf('\n', end);
                            if (cut < i + max / 2) cut = end - 1;
                            end = cut + 1;
                        }
                        tts.speak(t.substring(i, end),
                                n == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD,
                                null, "ds-" + gen + "-" + n);
                        i = end;
                        n++;
                    }
                } catch (Exception e) {
                    Log.e(TAG, "speak failed", e);
                    dispatchJs("window.__onTtsError&&window.__onTtsError('朗读失败')");
                }
            }
        });
    }

    private void stopTts() {
        pendingSpeak = null;
        ttsGen++;   // 让被打断那条的迟到回调失效
        try {
            if (tts != null) tts.stop();
        } catch (Exception e) {
            Log.w(TAG, "tts stop failed", e);
        }
        dispatchJs("window.__onTtsState&&window.__onTtsState('idle')");
    }



    /* ==================================================================
       JS 桥
       ================================================================== */

    public class Bridge {

        @JavascriptInterface
        public void copyText(final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("deepsleep", text));
                    } catch (Exception e) {
                        Log.w(TAG, "copy failed", e);
                    }
                }
            });
        }

        @JavascriptInterface
        public void shareText(final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType("text/plain");
                        i.putExtra(Intent.EXTRA_TEXT, text);
                        startActivity(Intent.createChooser(i, "分享"));
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "无法分享", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }

        @JavascriptInterface
        public void setDark(final boolean dark) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    darkTheme = dark;
                    applySystemBars(dark, defaultBarColor(dark));
                }
            });
        }

        /** 由前端传入当前配色主题的页面背景色，让系统栏与页面融为一体 */
        @JavascriptInterface
        public void setSystemBars(final boolean dark, final String bgHex) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    darkTheme = dark;
                    applySystemBars(dark, parseHexColor(bgHex, defaultBarColor(dark)));
                }
            });
        }

        /** 页面主动拉取状态栏高度，避免「推送早于脚本就绪」导致的顶栏错位 */
        @JavascriptInterface
        public int getTopInsetDp() {
            return currentTopInsetDp();
        }

        @JavascriptInterface
        public void toast(final String message) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public void vibrate(int ms) {
            try {
                android.os.Vibrator v = (android.os.Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                if (Build.VERSION.SDK_INT >= 26) {
                    v.vibrate(android.os.VibrationEffect.createOneShot(
                            Math.max(1, ms), android.os.VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(Math.max(1, ms));
                }
            } catch (Exception e) {
                Log.w(TAG, "vibrate failed", e);
            }
        }

        @JavascriptInterface
        public String appVersionName() {
            return appVersion();
        }

        /* ---------------- 朗读 ---------------- */

        @JavascriptInterface
        public void setSplashArt(String key) {
            getSharedPreferences("deepsleep", MODE_PRIVATE)
                    .edit().putString("splashArt", key == null ? "pixel" : key).apply();
        }

        @JavascriptInterface
        public boolean ttsAvailable() {
            try {
                Intent i = new Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE);
                return !getPackageManager().queryIntentServices(i, 0).isEmpty();
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public void ttsInit() {
            ensureTts();
        }

        @JavascriptInterface
        public String ttsVoices() {
            ensureTts();
            return ttsVoicesJson();
        }

        @JavascriptInterface
        public void ttsSpeak(String text) {
            speakNow(text);
        }

        @JavascriptInterface
        public void ttsStop() {
            stopTts();
        }

        @JavascriptInterface
        public void ttsSetVoice(final String name) {
            ttsVoiceName = (name == null || name.isEmpty()) ? null : name;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyTtsPrefs();
                }
            });
        }

        @JavascriptInterface
        public void ttsSetRate(final float rate) {
            ttsRate = Math.max(0.3f, Math.min(2.5f, rate));
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyTtsPrefs();
                }
            });
        }

        @JavascriptInterface
        public void ttsSetPitch(final float pitch) {
            ttsPitch = Math.max(0.3f, Math.min(2.5f, pitch));
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyTtsPrefs();
                }
            });
        }

        /** 导出对话：优先写入系统「下载」目录 */
        @JavascriptInterface
        public String saveFile(String name, String content) {
            try {
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mimeFor(name));
                    cv.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri uri = getContentResolver()
                            .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (uri == null) return null;
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    if (os == null) return null;
                    os.write(bytes);
                    os.flush();
                    os.close();
                    cv.clear();
                    cv.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContentResolver().update(uri, cv, null, null);
                    return "下载/" + name;
                }
                File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) dir = getFilesDir();
                if (!dir.exists() && !dir.mkdirs()) return null;
                File out = new File(dir, name);
                FileOutputStream fos = new FileOutputStream(out);
                fos.write(bytes);
                fos.flush();
                fos.close();
                return out.getAbsolutePath();
            } catch (Exception e) {
                Log.e(TAG, "saveFile failed", e);
                return null;
            }
        }

        @JavascriptInterface
        public String kvGet(String key) {
            if (key == null) return null;
            synchronized (kvLock) {
                JSONObject o = kv();
                if (!o.has(key) || o.isNull(key)) return null;
                return o.optString(key, null);
            }
        }

        @JavascriptInterface
        public void kvSet(String key, String value) {
            if (key == null) return;
            synchronized (kvLock) {
                try {
                    kv().put(key, value);
                } catch (Exception e) {
                    Log.w(TAG, "kv put failed", e);
                    return;
                }
            }
            kvScheduleFlush();
        }

        @JavascriptInterface
        public void kvRemove(String key) {
            if (key == null) return;
            synchronized (kvLock) {
                kv().remove(key);
            }
            kvScheduleFlush();
        }

        @JavascriptInterface
        public void log(String message) {
            Log.d(TAG, "[js] " + message);
        }
    }

    private static String mimeFor(String name) {
        String n = name.toLowerCase(Locale.US);
        if (n.endsWith(".md")) return "text/markdown";
        if (n.endsWith(".txt")) return "text/plain";
        return "application/json";
    }
}
