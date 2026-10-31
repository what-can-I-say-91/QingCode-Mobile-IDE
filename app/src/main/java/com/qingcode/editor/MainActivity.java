package com.qingcode.editor;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.Settings;
import android.text.InputType;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * 轻码编辑器 QingCode v3.0 —— 安卓壳
 *
 * 新增：
 * 1. 交互式 C++：FIFO 管道 stdin + 增量轮询 stdout（流式回传），App 内实时终端体验；
 * 2. 编译提速：md5 编译缓存（源码未变秒启动）、assets HTTP 缓存加速 Pyodide 冷启动；
 * 3. 依赖自动安装：编译前检测无编译器自动 pkg install -y clang；环境向导（下载页/一键初始化）；
 * 4. 同步输入对话框：Python input() 弹原生对话框阻塞获取输入。
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.local";
    private static final String ASSET_ROOT = "editor/";
    private static final String SWAP_DIR_NAME = "QingCode";
    private static final String TERMUX_PKG = "com.termux";
    private static final long POLL_MS = 200;

    // v4.11.2：与界面向导同源——界面 7 条（换源 1 条 + 初始化 6 条），此处多一条 apt update -y 用于刷新索引（此前不含换源，用户粘贴后下载仍慢）
    private static final String INIT_SCRIPT =
            "echo \"deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main\" > $PREFIX/etc/apt/sources.list; "
            + "apt update -y; "
            + "termux-setup-storage; mkdir -p ~/.termux; "
            + "echo \"allow-external-apps=true\" >> ~/.termux/termux.properties; termux-reload-settings; "
            + "pkg install -y clang; echo ''; echo '== 初始化完成，请返回轻码编辑器 =='\n";

    private WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean cppPolling = false;
    private volatile long cppDeadline = 0;
    private int cppTimeoutSec = 60;
    private long cppStartMs = 0;
    private long stdoutOffset = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#3c3c3c"));
        getWindow().setNavigationBarColor(Color.parseColor("#007acc"));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#1e1e1e"));   // v4.4：消除启动白屏（与主题底色一致）
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        web.setWebChromeClient(new ChromeClient());
        web.setWebViewClient(new AssetClient());
        web.addJavascriptInterface(new NativeBridge(), "Android");
        setContentView(web);
        web.loadUrl("https://" + HOST + "/index.html");

        // v4.2：启动即主动请求权限（全新安装/更换包名后授权清零，不再等用户点运行才弹）
        requestPermissionsOnLaunch();

        // v3.3：后台释放随应用打包的源代码到 /sdcard/QingCode/源码/
        new Thread(() -> {
            try {
                if (swapDirWritable()) {
                    cleanSwapTemp();   // 启动即清理上次编译/运行残留（含失控输出的巨型 .stdout）
                    extractSourcesIfNeeded();
                } else alog("sources: storage not ready, skip extract (retry on next launch)");
            } catch (Exception e) {
                alog("sources: EXCEPTION " + e);
            }
        }, "pc-sources").start();
    }

    /** 清理交换目录的编译/运行临时文件（保留 源码/ 文件夹与 .app.log）。
     *  v4.9.3 起每次运行都使用 .run_* 会话目录，根目录不再写入源码，
     *  因此不再删除根目录下的 .py/.cpp 等源码文件——避免误删用户直接放在
     *  /sdcard/QingCode/ 根目录的代码文件（该清理每次运行结束都会触发）。 */
    private void cleanSwapTemp() {
        try {
            File dir = swapDir();
            String[] names = {".stdout", ".stderr", ".compile.exit", ".run.exit",
                    ".prog.pid", ".keep.pid", ".termux.log", ".pc_in", ".term_out"};
            for (String n : names) { try { new File(dir, n).delete(); } catch (Exception ignored) {} }
            File[] fs = dir.listFiles();
            if (fs != null) {
                for (File f : fs) {
                    String n = f.getName();
                    if (n.startsWith(".run_") && f.isDirectory()) {   // v4.9.3：清理历史运行会话目录
                        // v4.9.4：带 .active 标记且未超过 24h 的是活跃/排队中会话——Termux 队列里的脚本
                        // 可能正要 cd 进去，误删会让它 cd FAILED 空跑（也是轮询读不到产物的原因之一）
                        boolean active = new File(f, ".active").exists();
                        long ageMs = System.currentTimeMillis() - f.lastModified();
                        if (active && ageMs < 24 * 3600_000L) continue;
                        deleteRecursive(f);
                        continue;
                    }
                }
            }
            alog("cleanSwapTemp done");
        } catch (Exception e) {
            alog("cleanSwapTemp FAIL " + e);
        }
    }

    /* ================= 源代码释放（v3.3：assets/source -> /sdcard/QingCode/源码） ================= */
    private File sourcesDir() { return new File(swapDir(), "源码"); }

    private String appVersionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) { return "?"; }
    }

    private void extractSourcesIfNeeded() {
        File dir = sourcesDir();
        File mark = new File(dir, ".version");
        if (mark.exists() && appVersionName().equals(readTextFile(mark))) {
            alog("sources: up-to-date (" + appVersionName() + ")");
            return;
        }
        long t0 = System.currentTimeMillis();
        deleteRecursive(dir);
        dir.mkdirs();
        int n = copyAssetsDir("source", dir);
        writeTextFile(mark, appVersionName());
        alog("sources: extracted " + n + " files -> " + dir.getAbsolutePath()
                + " (" + (System.currentTimeMillis() - t0) + "ms)");
    }

    private int copyAssetsDir(String assetPath, File target) {
        int count = 0;
        try {
            String[] items = getAssets().list(assetPath);
            if (items == null || items.length == 0) return 0;
            for (String name : items) {
                String childAsset = assetPath + "/" + name;
                File childFile = new File(target, name);
                String[] sub = getAssets().list(childAsset);
                if (sub != null && sub.length > 0) {
                    childFile.mkdirs();
                    count += copyAssetsDir(childAsset, childFile);
                } else {
                    copyAssetFile(childAsset, childFile);
                    count++;
                }
            }
        } catch (Exception e) {
            alog("sources: copy FAIL " + assetPath + " -> " + e);
        }
        return count;
    }

    private void copyAssetFile(String asset, File target) throws IOException {
        InputStream is = null;
        OutputStream os = null;
        try {
            is = getAssets().open(asset);
            os = new FileOutputStream(target);
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) os.write(buf, 0, n);
        } finally {
            try { if (is != null) is.close(); } catch (IOException ignored) { }
            try { if (os != null) os.close(); } catch (IOException ignored) { }
        }
    }

    private void deleteRecursive(File f) {
        if (f == null) return;
        File[] list = f.listFiles();
        if (list != null) for (File c : list) deleteRecursive(c);
        if (!f.delete()) alog("sources: delete failed " + f.getAbsolutePath());
    }

    private String readTextFile(File f) {
        try {
            FileInputStream is = new FileInputStream(f);
            StringBuilder sb = new StringBuilder();
            byte[] buf = new byte[512];
            int n;
            while ((n = is.read(buf)) > 0) sb.append(new String(buf, 0, n, "UTF-8"));
            is.close();
            return sb.toString().trim();
        } catch (Exception e) { return ""; }
    }

    private void writeTextFile(File f, String s) {
        try {
            FileOutputStream os = new FileOutputStream(f);
            os.write(s.getBytes("UTF-8"));
            os.close();
        } catch (Exception e) {
            alog("sources: write mark FAIL " + e);
        }
    }

    /* ================= assets 拦截（带 HTTP 缓存，加速 WASM 冷启动） ================= */
    private class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
            String asset = ASSET_ROOT + path.substring(1);
            try {
                InputStream is = getAssets().open(asset);
                Map<String, String> h = new HashMap<>();
                h.put("Access-Control-Allow-Origin", "*");
                h.put("Access-Control-Allow-Headers", "*");
                h.put("Cross-Origin-Opener-Policy", "same-origin");
                h.put("Cross-Origin-Embedder-Policy", "require-corp");
                h.put("Cross-Origin-Resource-Policy", "cross-origin");
                // 大文件长缓存（wasm/js/zip），让 WebView 磁盘缓存 + WASM 编译缓存生效
                h.put("Cache-Control", cacheControlOf(asset));
                WebResourceResponse resp = new WebResourceResponse(mimeOf(asset), "utf-8", is);
                resp.setResponseHeaders(h);
                return resp;
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                        null, new ByteArrayInputStream("404 Not Found".getBytes()));
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            if (HOST.equals(req.getUrl().getHost())) return false;
            /* v5.4.1 安全（审查低风险）：只把 http/https/mailto 交给系统，其他 scheme 一律忽略 */
            String scheme = req.getUrl().getScheme();
            if (scheme == null) return true;
            scheme = scheme.toLowerCase();
            if (!"http".equals(scheme) && !"https".equals(scheme) && !"mailto".equals(scheme)) return true;
            try { startActivity(new Intent(Intent.ACTION_VIEW, req.getUrl())); } catch (Exception ignored) { }
            return true;
        }
    }

    private static String cacheControlOf(String asset) {
        String p = asset.toLowerCase();
        if (p.endsWith(".wasm") || p.endsWith(".zip")) return "public, max-age=604800";
        if (p.endsWith(".js") || p.endsWith(".css") || p.endsWith(".mjs")) return "public, max-age=86400";
        return "no-cache";
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json") || p.endsWith(".map")) return "application/json";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".zip")) return "application/zip";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    /* ================= JS alert / confirm / prompt ================= */
    private class ChromeClient extends WebChromeClient {
        @Override
        public boolean onJsAlert(WebView v, String url, String msg, final JsResult result) {
            buildDialog("提示", msg, false, false, null, result, null).show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView v, String url, String msg, final JsResult result) {
            buildDialog("确认", msg, false, false, null, result, null).show();
            return true;
        }

        @Override
        public boolean onJsPrompt(WebView v, String url, String msg, String defaultValue, final JsPromptResult result) {
            buildDialog("输入", msg, true, false, defaultValue, null, result).show();
            return true;
        }

        /* v5.4：支持页面里的 <input type="file">（自选壁纸选图片） */
        @Override
        public boolean onShowFileChooser(WebView v, android.webkit.ValueCallback<android.net.Uri[]> callback,
                                         android.webkit.WebChromeClient.FileChooserParams params) {
            if (fileChooserCallback != null) { fileChooserCallback.onReceiveValue(null); fileChooserCallback = null; }
            fileChooserCallback = callback;
            try {
                android.content.Intent intent = params.createIntent();
                intent.addCategory(android.content.Intent.CATEGORY_OPENABLE);
                MainActivity.this.startActivityForResult(intent, FILE_CHOOSER_CODE);
                return true;
            } catch (Exception e) {
                alog("onShowFileChooser EX " + e);
                fileChooserCallback = null;
                return false;
            }
        }
    }

    private AlertDialog buildDialog(String title, String msg, boolean withInput, boolean multiLine,
                                    String defaultValue, final JsResult jsResult,
                                    final JsPromptResult promptResult) {
        return buildDialogFull(title, msg, withInput, multiLine, defaultValue, jsResult, promptResult, "确定", "取消");
    }

    private AlertDialog buildDialogFull(String title, String msg, boolean withInput, boolean multiLine,
                                        String defaultValue, final JsResult jsResult,
                                        final JsPromptResult promptResult,
                                        String okText, String cancelText) {
        return buildDialogFull(title, msg, withInput, multiLine, defaultValue, jsResult, promptResult, okText, cancelText, null);
    }

    private AlertDialog buildDialogFull(String title, String msg, boolean withInput, boolean multiLine,
                                        String defaultValue, final JsResult jsResult,
                                        final JsPromptResult promptResult,
                                        String okText, String cancelText, final EditText[] inputOut) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (18 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 2, pad, 0);

        TextView tv = new TextView(this);
        tv.setText(msg == null ? "" : msg);
        tv.setTextSize(15);
        tv.setTextColor(Color.parseColor("#dddddd"));
        box.addView(tv);

        final EditText input = new EditText(this);
        if (withInput) {
            input.setText(defaultValue == null ? "" : defaultValue);
            input.setTextSize(14);
            input.setTextColor(Color.parseColor("#eeeeee"));
            if (multiLine) {
                input.setSingleLine(false);
                input.setMinLines(3);
                input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            }
            box.addView(input);
            if (inputOut != null) inputOut[0] = input;
        }

        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle(title)
                .setView(box)
                .setPositiveButton(okText, (dlg, w) -> {
                    if (promptResult != null) promptResult.confirm(input.getText().toString());
                    else if (jsResult != null) jsResult.confirm();
                });
        if (cancelText != null) {
            b.setNegativeButton(cancelText, (dlg, w) -> {
                if (promptResult != null) promptResult.cancel();
                else if (jsResult != null) jsResult.cancel();
            });
        }
        b.setOnCancelListener(dlg -> {
            if (promptResult != null) promptResult.cancel();
            else if (jsResult != null) jsResult.cancel();
        });
        AlertDialog d = b.create();
        d.setOnShowListener(dlg -> {
            d.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(Color.parseColor("#4fc3f7"));
            if (cancelText != null) d.getButton(AlertDialog.BUTTON_NEGATIVE).setTextColor(Color.parseColor("#999999"));
        });
        return d;
    }

    /* ================= JS 桥 ================= */
    private class NativeBridge {

        @JavascriptInterface
        public void saveFile(final String name, final String content) {
            runOnUiThread(() -> saveToDownloads(name, content));
        }

        @JavascriptInterface
        public boolean isAndroid() { return true; }

        /** 同步输入对话框：供 Python input() 阻塞获取一行输入；
         *  取消返回 null（前端视为 EOF），确定返回输入文本（可能为空串） */
        @JavascriptInterface
        public String requestInput(final String prompt, final String defaultValue) {
            final CountDownLatch latch = new CountDownLatch(1);
            final String[] holder = new String[]{null};
            final EditText[] inputHolder = new EditText[1];
            runOnUiThread(() -> {
                AlertDialog d = buildDialogFull("程序输入", prompt == null || prompt.isEmpty() ? "程序请求输入：" : prompt,
                        true, false, defaultValue == null ? "" : defaultValue, null, null, "发送", "取消(EOF)", inputHolder);
                d.setOnDismissListener(dlg -> latch.countDown());
                d.setOnShowListener(dlg -> {
                    d.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(Color.parseColor("#4fc3f7"));
                    d.getButton(AlertDialog.BUTTON_NEGATIVE).setTextColor(Color.parseColor("#999999"));
                });
                d.show();
                d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                    holder[0] = inputHolder[0].getText().toString();
                    d.dismiss();
                });
                d.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener(v -> {
                    holder[0] = null;      // 取消 => EOF
                    d.dismiss();
                });
            });
            try { latch.await(5, TimeUnit.MINUTES); } catch (InterruptedException ignored) { }
            return holder[0];   // 取消/超时 → null（前端判 EOF）；确定为输入文本（可为空串）
        }

        /** 多行输入对话框：供内置 JSCPP 兜底引擎一次性收集全部输入 */
        @JavascriptInterface
        public String requestMultiInput(final String prompt, final String defaultValue) {
            final CountDownLatch latch = new CountDownLatch(1);
            final String[] holder = new String[]{null};
            final EditText[] inputHolder = new EditText[1];
            runOnUiThread(() -> {
                AlertDialog d = buildDialogFull("预填程序输入",
                        (prompt == null || prompt.isEmpty() ? "该程序需要输入。" : prompt)
                                + "\n（内置引擎为一次性读取，请一次填入全部输入，每行一项）",
                        true, true, defaultValue == null ? "" : defaultValue, null, null, "发送", "空运行", inputHolder);
                d.setOnDismissListener(dlg -> latch.countDown());
                d.setOnShowListener(dlg -> {
                    d.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(Color.parseColor("#4fc3f7"));
                    d.getButton(AlertDialog.BUTTON_NEGATIVE).setTextColor(Color.parseColor("#999999"));
                });
                d.show();
                d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                    holder[0] = inputHolder[0].getText().toString();
                    d.dismiss();
                });
                d.getButton(AlertDialog.BUTTON_NEGATIVE).setOnClickListener(v -> {
                    holder[0] = "";
                    d.dismiss();
                });
            });
            try { latch.await(10, TimeUnit.MINUTES); } catch (InterruptedException ignored) { }
            return holder[0] == null ? "" : holder[0];
        }

        /** 环境检测 JSON：{termux, storage, message} */
        @JavascriptInterface
        public String getEnv() {
            JSONObject o = new JSONObject();
            try {
                boolean termux = isTermuxInstalled();
                boolean storage = swapDirWritable();
                boolean afs = Build.VERSION.SDK_INT >= 30 && Environment.isExternalStorageManager();
                o.put("termux", termux);
                o.put("storage", storage);
                o.put("message", termux ? (storage ? "ok" : "交换目录不可写，需授予所有文件访问权限") : "未安装 Termux");
                alog("getEnv: termux=" + termux + " storage=" + storage
                        + " allFilesManager=" + afs + " sdk=" + Build.VERSION.SDK_INT);
                // v3.3：存储就绪后补释放源代码（授权后无需重启）
                if (storage) extractSourcesIfNeeded();
            } catch (Exception ignored) { }
            return o.toString();
        }

        /** v3.3：源代码释放状态（ok=已释放且为当前版本 / stale=旧版本 / no-storage=尚未释放） */
        @JavascriptInterface
        public String sourcesReady() {
            try {
                File mark = new File(sourcesDir(), ".version");
                if (!mark.exists()) return "no-storage";
                return appVersionName().equals(readTextFile(mark)) ? "ok" : "stale";
            } catch (Exception e) { return "no-storage"; }
        }

        /**
         * 用 Termux 编译运行 C++（交互式）：
         * FIFO 管道 stdin + 后台运行 + 增量 stdout 轮询；md5 编译缓存；编译器缺失自动 pkg install。
         */
        @JavascriptInterface
        /** v5.10.0：不传项目配置的兼容入口（插件仍在使用），等价于 runCppEx(..., "{}", ...) */
        public boolean runCpp(final String session, final String fileName, final String code,
                              final String compiler, final int timeoutSec) {
            return runCppEx(session, fileName, code, "{}", timeoutSec == 0 ? 60 : timeoutSec, compiler);
        }

        /**
         * v5.10.0：多源 + 缓存 + 项目配置的运行入口。
         * optsJson 字段：sources[] includeDirs[] compiler standard flags[] args[] env{} cwd
         *                cacheMaxMB cacheMaxEntries
         * ① 多源编译：entry + sources 一起交给编译器（此前只编译当前文件）
         * ② 缓存键覆盖全部输入：每个源文件 + 所有头文件（带路径）+ flags/include/std + 编译器路径与版本
         * ③ 缓存容量上限 + LRU 清理（此前缓存无上限，只会无限增长）
         * ④ 编译与运行分离：产物留在缓存，runCachedBinary 可重跑而不重新编译
         */
        @JavascriptInterface
        public boolean runCppEx(final String session, final String fileName, final String code,
                                final String optsJson, final int timeoutSec, final String compilerArg) {
            JSONObject o;
            try { o = new JSONObject(optsJson == null || optsJson.trim().isEmpty() ? "{}" : optsJson); }
            catch (Exception e) { alog("runCppEx: bad opts json " + e); o = new JSONObject(); }
            String cxx = o.optString("compiler", "").trim();
            if (cxx.isEmpty()) cxx = (compilerArg == null || compilerArg.trim().isEmpty()) ? "clang++" : compilerArg.trim();
            String std = o.optString("standard", "c++17").trim();
            if (!std.matches("[cg]\\+\\+[0-9]{2}")) std = "c++17";
            int maxMB = o.optInt("cacheMaxMB", 256);
            int maxEntries = o.optInt("cacheMaxEntries", 40);
            if (maxMB < 16) maxMB = 16; if (maxMB > 4096) maxMB = 4096;
            if (maxEntries < 2) maxEntries = 2; if (maxEntries > 500) maxEntries = 500;

            /* ---- 源文件清单（entry 优先，其余来自配置；逐个校验存在且不是路径穿越） ---- */
            java.util.List<String> rels = new java.util.ArrayList<>();
            String entryRel = safeRelativePath(fileName);
            if (entryRel != null) rels.add(entryRel);
            JSONArray arr = o.optJSONArray("sources");
            if (arr != null) for (int i = 0; i < arr.length(); i++) {
                String rel = safeRelativePath(arr.optString(i, ""));
                if (rel != null && !rels.contains(rel)) rels.add(rel);
            }
            if (rels.isEmpty()) {
                emitCpp(cppJson("setup", false, 0, "", "主文件名不合法：" + fileName));
                return true;
            }

            cppTimeoutSec = Math.max(15, timeoutSec <= 0 ? 60 : timeoutSec);
            cppStartMs = System.currentTimeMillis();
            alog("runCppEx: session=" + session + " entry=" + entryRel + " srcs=" + rels + " cxx=" + cxx
                    + " std=" + std + " timeout=" + cppTimeoutSec);
            if (!isTermuxInstalled()) {
                emitCpp(cppJson("setup", false, 0, "", "未检测到 Termux 应用。请在「更多菜单 → 环境向导」中安装配置。"));
                return true;
            }
            if (!ensureRunCommandPerm()) {
                emitCpp(cppJson("setup", false, 0, "", "需要「Termux 运行命令」权限：请批准弹出的授权窗口并重新点运行；"
                        + "若提示不再询问或未弹窗，请在弹出的应用设置 → 权限中手动开启后重试。"));
                return true;
            }
            if (!ensureStorageAccess()) {
                emitCpp(cppJson("setup", false, 0, "",
                        "需要「所有文件访问」权限用于与 Termux 交换代码，请在系统设置中允许后重试。"));
                return true;
            }
            File base = swapDir();
            File dir = validSession(session) ? new File(base, session) : base;
            if (dir != base && !dir.exists()) dir.mkdirs();
            try {
                File prev = runSessionDir;
                if (prev != null && !prev.equals(dir) && prev.exists()) {
                    writeFile(new File(prev, ".cancel"), "1");
                    alog("runCppEx: cancel stale previous session " + prev.getName());
                }
            } catch (Exception ignored) { }
            runSessionDir = (dir != base) ? dir : null;
            cppSessionId = (dir != base) ? dir.getName() : "";
            String sessSan = session == null ? "" : session.replaceAll("[^0-9A-Za-z]", "");
            cppFifoName = ".pc_in_" + sessSan;
            if (cppFifoName.length() < 7) cppFifoName = ".pc_in";
            cppBinName = sessSan.isEmpty() ? "" : "pc_prog_" + sessSan + ".out";
            if (!writeFile(new File(dir, fileName), code)) {
                alog("runCppEx: FAIL write " + new File(dir, fileName).getAbsolutePath());
                emitCpp(cppJson("setup", false, 0, "", "无法写入交换目录 " + dir.getAbsolutePath()));
                return true;
            }
            for (String rf : new String[]{".stdout", ".stderr", ".compile.exit", ".compile.pid",
                    ".run.exit", ".prog.pid", ".keep.pid", ".watch.pid", ".script.pid", ".cancel", ".cache.key"}) {
                try { new File(dir, rf).delete(); } catch (Exception ignored) { }
            }
            lastErr = ""; lastErrSentAll = false; errBuf.setLength(0); stderrOffset = 0;

            String pcBin = (cppBinName == null || cppBinName.isEmpty()) ? "pc_prog_legacy.out" : cppBinName;

            /* ---- 字面量参数（全部在生成期用单引号包好，运行时按字面传递，不经二次解析） ---- */
            StringBuilder srcLit = new StringBuilder();
            for (String r : rels) { if (srcLit.length() > 0) srcLit.append(' '); srcLit.append(q(r)); }
            StringBuilder hashLit = new StringBuilder();
            for (String r : rels) {
                hashLit.append(" echo ").append(q("== " + r)).append("; cat -- ").append(q(r)).append(" 2>/dev/null;");
            }
            StringBuilder incLit = new StringBuilder();
            JSONArray incs = o.optJSONArray("includeDirs");
            if (incs != null) for (int i = 0; i < incs.length(); i++) {
                String d = safeRelativePath(incs.optString(i, ""));
                if (d != null) incLit.append(" -I").append(q(d));
            }
            StringBuilder flagLit = new StringBuilder();
            JSONArray flags = o.optJSONArray("flags");
            if (flags != null) for (int i = 0; i < flags.length(); i++) {
                String f = flags.optString(i, "");
                if (f != null && !f.trim().isEmpty()) flagLit.append(' ').append(q(f.trim()));
            }
            StringBuilder argLit = new StringBuilder();
            JSONArray args = o.optJSONArray("args");
            if (args != null) for (int i = 0; i < args.length(); i++) {
                String a = args.optString(i, "");
                if (a != null) argLit.append(' ').append(q(a));
            }
            StringBuilder envLit = new StringBuilder();
            JSONObject env = o.optJSONObject("env");
            if (env != null) {
                java.util.Iterator<String> it = env.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    if (!k.matches("[A-Za-z_][A-Za-z0-9_]*")) continue;   // 防止注入额外赋值
                    envLit.append(' ').append(k).append('=').append(q(env.optString(k, "")));
                }
            }
            String cwdRel = safeRelativePath(o.optString("cwd", ""));
            String cwdLine = (cwdRel == null) ? "cd \"$PC\"" : "cd \"$PC/" + cwdRel + "\" 2>/dev/null || cd \"$PC\"";

            /* ---- 运行段落（重跑时原样复用，故只依赖变量与字面量） ---- */
            String runTail =
                "if [ \"$(cat .compile.exit 2>/dev/null)\" = \"0\" ] && [ -f \"$CACHE/$H\" ] && [ ! -f \"$PC/.cancel\" ]; then\n" +
                "  cp \"$CACHE/$H\" \"$BIN\" 2>/dev/null\n" +
                "  rm -f \"$HOME/$PCFIFO\"; mkfifo \"$HOME/$PCFIFO\"\n" +
                "  sleep 100000 > \"$HOME/$PCFIFO\" & echo $! > .keep.pid\n" +
                "  ( " + cwdLine + "; exec env" + envLit + " timeout " + Math.max(10, cppTimeoutSec - 10) + " \"$BIN\"" + argLit + " ) < \"$HOME/$PCFIFO\" > .stdout 2>> .stderr &\n" +
                "  echo $! > .prog.pid\n" +
                "  wait $(cat .prog.pid); RC=$?\n" +
                "  kill -9 $(cat .keep.pid 2>/dev/null) 2>/dev/null\n" +
                "  rm -f \"$HOME/$PCFIFO\"\n" +
                "  echo $RC > .run.exit\n" +
                "fi\n" +
                "rm -f \"$BIN\" .watch.pid .script.pid .compile.pid .cancel 2>/dev/null\n" +
                "echo \"[$(date +%H:%M:%S)] termux script end\" >> \"$PC/.termux.log\"\n";
            lastRunTail = runTail;

            String script =
                "export TMPDIR=$PREFIX/tmp\n" +
                "PC=" + q(dir.getAbsolutePath()) + "\n" +
                "PCFIFO=" + q(cppFifoName) + "\n" +
                "PCBIN=" + q(pcBin) + "\n" +
                "BIN=\"$HOME/$PCBIN\"\n" +
                "CACHE=\"$HOME/.pc_cache\"\n" +
                "PC_MAX_ENTRIES=" + maxEntries + "\n" +
                "PC_MAX_KB=" + (maxMB * 1024) + "\n" +
                "CXX=" + q(cxx) + "\n" +
                "PCSTD=" + q("-std=" + std) + "\n" +
                "prune_cache() {\n" +
                "  [ -d \"$CACHE\" ] || return 0\n" +
                "  N=$(ls -1 \"$CACHE\" 2>/dev/null | wc -l)\n" +
                "  if [ \"$N\" -gt \"$PC_MAX_ENTRIES\" ]; then\n" +
                "    ls -1t \"$CACHE\" 2>/dev/null | tail -n +$((PC_MAX_ENTRIES+1)) | while IFS= read -r x; do rm -f \"$CACHE/$x\"; done\n" +
                "  fi\n" +
                "  while : ; do\n" +
                "    KB=$(du -sk \"$CACHE\" 2>/dev/null | cut -f1)\n" +
                "    [ -z \"$KB\" ] && break\n" +
                "    [ \"$KB\" -le \"$PC_MAX_KB\" ] && break\n" +
                "    OLD=$(ls -1t \"$CACHE\" 2>/dev/null | tail -1)\n" +
                "    [ -z \"$OLD\" ] && break\n" +
                "    rm -f \"$CACHE/$OLD\"\n" +
                "  done\n" +
                "}\n" +
                "echo \"[$(date +%H:%M:%S)] termux script start\" >> \"$PC/.termux.log\"\n" +
                "cd \"$PC\" || { echo \"[$(date +%H:%M:%S)] cd FAILED\" >> \"$PC/.termux.log\"; exit 9; }\n" +
                "if [ -f \"$PC/.cancel\" ]; then rm -f \"$PC/.cancel\"; echo \"[$(date +%H:%M:%S)] cancelled while queued\" >> \"$PC/.termux.log\"; exit 0; fi\n" +
                watchdogScript() +
                "command -v \"$CXX\" >/dev/null 2>&1 || { echo '[首次运行：自动安装编译器，约1-3分钟...]'; pkg install -y " +
                (cxx.equals("g++") ? "clang" : "clang") + " 2>&1 | tail -1; }\n" +
                "mkdir -p \"$CACHE\"\n" +
                /* 缓存键：所有源 + 所有头文件（带路径）+ flags/include/std + 编译器路径与版本 */
                "H=$( {" + hashLit +
                " echo '== headers'; find . -type f \\( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.inc' \\) 2>/dev/null | sort | while IFS= read -r h; do echo \"== $h\"; cat -- \"$h\" 2>/dev/null; done;" +
                " echo '== flags'; echo " + q(flagLit.toString().trim()) + ";" +
                " echo '== inc'; echo " + q(incLit.toString().trim()) + ";" +
                " echo '== std'; echo \"$PCSTD\";" +
                " echo '== cxx'; command -v \"$CXX\"; \"$CXX\" --version 2>/dev/null | head -1; } | sha256sum | cut -d' ' -f1 )\n" +
                "echo \"$H\" > .cache.key\n" +
                "echo \"[$(date +%H:%M:%S)] cache key=$H\" >> \"$PC/.termux.log\"\n" +
                "if [ -n \"$H\" ] && [ -x \"$CACHE/$H\" ]; then\n" +
                "  echo '[缓存命中：跳过编译]'\n" +
                "  echo 0 > .compile.exit\n" +
                "else\n" +
                "  rm -f \"$CACHE/.$H.tmp\"\n" +
                "  \"$CXX\" \"$PCSTD\"" + flagLit + incLit + " -o \"$CACHE/.$H.tmp\"" + " " + srcLit + " 2> .stderr < /dev/null &\n" +
                "  echo $! > .compile.pid\n" +
                "  wait $(cat .compile.pid); echo $? > .compile.exit\n" +
                "  if [ \"$(cat .compile.exit)\" = \"0\" ]; then mv -f \"$CACHE/.$H.tmp\" \"$CACHE/$H\" 2>/dev/null; fi\n" +
                "fi\n" +
                "prune_cache\n" +
                runTail;

            lastCacheKey = "";   // 编译成功后才由 .cache.key 回填（见 pollTask）
            alog("runCppEx: script built, len=" + script.length() + " srcs=" + rels.size());
            if (!sendRunCommand(script, true)) {
                alog("runCppEx: FAIL sendRunCommand returned false");
                emitCpp(cppJson("setup", false, 0, "",
                        "调用 Termux 失败。请在 Termux 中执行一次性初始化（菜单 → 环境向导 → 一键初始化）。"));
                return true;
            }
            stdoutOffset = 0;
            termuxLogOffset = 0;
            new File(dir, ".termux.log").delete();
            startPolling();
            alog("runCppEx: polling started");
            return true;
        }

        /** v5.10.0：编译 / 运行分离——用上次编译好的产物重跑，不再调用编译器。
         *  JS 传入新会话目录（隔离输出），产物从 $HOME/.pc_cache 取。 */
        @JavascriptInterface
        public boolean runCachedBinary(final String session, final int timeoutSec) {
            if (lastCacheKey == null || lastCacheKey.isEmpty() || lastRunTail.isEmpty()) {
                emitCpp(cppJson("setup", false, 0, "", "还没有可复用的编译产物：请先运行一次。"));
                return true;
            }
            if (!isTermuxInstalled() || !ensureRunCommandPerm() || !ensureStorageAccess()) {
                emitCpp(cppJson("setup", false, 0, "", "Termux 或权限未就绪，无法重跑。"));
                return true;
            }
            cppTimeoutSec = Math.max(15, timeoutSec <= 0 ? 60 : timeoutSec);
            cppStartMs = System.currentTimeMillis();
            File base = swapDir();
            File dir = validSession(session) ? new File(base, session) : base;
            if (dir != base && !dir.exists()) dir.mkdirs();
            runSessionDir = (dir != base) ? dir : null;
            cppSessionId = (dir != base) ? dir.getName() : "";
            String sessSan = session == null ? "" : session.replaceAll("[^0-9A-Za-z]", "");
            cppFifoName = ".pc_in_" + sessSan;
            if (cppFifoName.length() < 7) cppFifoName = ".pc_in";
            cppBinName = sessSan.isEmpty() ? "" : "pc_prog_" + sessSan + ".out";
            for (String rf : new String[]{".stdout", ".stderr", ".compile.exit", ".compile.pid",
                    ".run.exit", ".prog.pid", ".keep.pid", ".watch.pid", ".script.pid", ".cancel"}) {
                try { new File(dir, rf).delete(); } catch (Exception ignored) { }
            }
            lastErr = ""; lastErrSentAll = false; errBuf.setLength(0); stderrOffset = 0;
            String pcBin = (cppBinName == null || cppBinName.isEmpty()) ? "pc_prog_legacy.out" : cppBinName;
            String script =
                "export TMPDIR=$PREFIX/tmp\n" +
                "PC=" + q(dir.getAbsolutePath()) + "\n" +
                "PCFIFO=" + q(cppFifoName) + "\n" +
                "PCBIN=" + q(pcBin) + "\n" +
                "BIN=\"$HOME/$PCBIN\"\n" +
                "CACHE=\"$HOME/.pc_cache\"\n" +
                "H=" + q(lastCacheKey) + "\n" +
                "echo \"[$(date +%H:%M:%S)] rerun (no compile) key=$H\" >> \"$PC/.termux.log\"\n" +
                "cd \"$PC\" || exit 9\n" +
                watchdogScript() +
                "if [ -x \"$CACHE/$H\" ]; then echo 0 > .compile.exit; else echo 127 > .compile.exit; "
                    + "echo '编译产物已被清理，请重新运行以重新编译。' >> \"$PC/.termux.log\"; fi\n" +
                lastRunTail;
            alog("runCachedBinary: session=" + session + " key=" + lastCacheKey);
            if (!sendRunCommand(script, true)) {
                emitCpp(cppJson("setup", false, 0, "", "调用 Termux 失败。"));
                return true;
            }
            stdoutOffset = 0;
            termuxLogOffset = 0;
            startPolling();
            return true;
        }

        /** v4.7：Termux 原生 Python 解释器（与 C++ 通道共用 FIFO 交互与轮询设施；配置完全分离——
         *  python 缺失时自动 pkg install python，与 C++ 的 clang 安装互不影响，无 md5 编译缓存阶段） */
        @JavascriptInterface
        public boolean runPyTermux(final String session, final String fileName, final String code, final int timeoutSec) {
            cppTimeoutSec = Math.max(15, timeoutSec);
            cppStartMs = System.currentTimeMillis();
            alog("runPyTermux: file=" + fileName + " timeout=" + cppTimeoutSec + " codeLen=" + code.length());
            if (!isTermuxInstalled()) {
                alog("runPyTermux: FAIL termux not installed");
                emitCpp(cppJson("setup", false, 0, "", "未检测到 Termux 应用。请在「更多菜单 → 环境向导」中安装配置。"));
                return true;
            }
            if (!ensureRunCommandPerm()) {
                emitCpp(cppJson("setup", false, 0, "", "需要「Termux 运行命令」权限：请批准弹出的授权窗口并重新点运行；"
                        + "若提示不再询问或未弹窗，请在弹出的应用设置 → 权限中手动开启后重试。"));
                return true;
            }
            if (!ensureStorageAccess()) {
                alog("runPyTermux: FAIL storage access");
                emitCpp(cppJson("setup", false, 0, "",
                        "需要「所有文件访问」权限用于与 Termux 交换代码，请在系统设置中允许后重试。"));
                return true;
            }
            File base = swapDir();
            File dir = validSession(session) ? new File(base, session) : base;
            if (dir != base && !dir.exists()) dir.mkdirs();
            // v4.9.4：开新运行前，给上一个仍存活的会话写 .cancel（僵尸运行自愈）
            try {
                File prev = runSessionDir;
                if (prev != null && !prev.equals(dir) && prev.exists()) {
                    writeFile(new File(prev, ".cancel"), "1");
                    alog("runPyTermux: cancel stale previous session " + prev.getName());
                }
            } catch (Exception ignored) { }
            runSessionDir = (dir != base) ? dir : null;
            cppSessionId = (dir != base) ? dir.getName() : "";   // v5.10.0：事件带回 sessionId
            String sessSan = session == null ? "" : session.replaceAll("[^0-9A-Za-z]", "");
            cppFifoName = ".pc_in_" + sessSan;
            if (cppFifoName.length() < 7) cppFifoName = ".pc_in";
            cppBinName = "";   // Python 无编译产物
            if (!writeFile(new File(dir, fileName), code)) {
                alog("runPyTermux: FAIL write " + new File(dir, fileName).getAbsolutePath());
                emitCpp(cppJson("setup", false, 0, "", "无法写入交换目录 " + dir.getAbsolutePath()));
                return true;
            }
            for (String rf : new String[]{".stdout", ".stderr", ".run.exit", ".prog.pid",
                    ".keep.pid", ".watch.pid", ".script.pid", ".compile.pid", ".cancel"}) {
                try { new File(dir, rf).delete(); } catch (Exception ignored) { }
            }
            lastErr = ""; lastErrSentAll = false;

            String script =
                "export TMPDIR=$PREFIX/tmp\n" +
                "PC=" + q(dir.getAbsolutePath()) + "\n" +
                "PCFIFO=" + q(cppFifoName) + "\n" +
                "PCBIN=\n" +
                "echo \"[$(date +%H:%M:%S)] termux py script start\" >> \"$PC/.termux.log\"\n" +
                "cd \"$PC\" || { echo \"[$(date +%H:%M:%S)] cd FAILED\" >> \"$PC/.termux.log\"; exit 9; }\n" +
                // 0. v4.9.4：排队期间已被取消 → 立即退出让位
                "if [ -f \"$PC/.cancel\" ]; then rm -f \"$PC/.cancel\"; echo \"[$(date +%H:%M:%S)] cancelled while queued\" >> \"$PC/.termux.log\"; exit 0; fi\n" +
                watchdogScript() +
                // 1. Python 缺失则自动安装（独立于 C++ 的 clang 安装——配置语句分离）
                "command -v python >/dev/null 2>&1 || { echo '[首次运行：自动安装 Python（pkg install python），约 1~3 分钟...]'; pkg install -y python 2>&1 | tail -1; }\n" +
                "if ! command -v python >/dev/null 2>&1; then\n" +
                "  echo 'Python 安装失败：请检查网络后，在 Termux 中手动执行 pkg install python 再重试。' > .stdout\n" +
                "  echo 1 > .run.exit; exit 0\n" +
                "fi\n" +
                // 2. 解释执行（无编译阶段）：-u 无缓冲实时输出 + -X utf8 避免编码问题；取消时看门狗杀进程
                "if [ ! -f \"$PC/.cancel\" ]; then\n" +
                "  rm -f \"$HOME/$PCFIFO\"; mkfifo \"$HOME/$PCFIFO\"\n" +
                "  sleep 100000 > \"$HOME/$PCFIFO\" & echo $! > .keep.pid\n" +
                "  timeout " + Math.max(10, cppTimeoutSec - 10) + " python -X utf8 -u " + q(fileName) + " < \"$HOME/$PCFIFO\" > .stdout 2> .stderr &\n" +
                "  echo $! > .prog.pid\n" +
                "  wait $(cat .prog.pid); RC=$?\n" +
                "  kill -9 $(cat .keep.pid 2>/dev/null) 2>/dev/null\n" +
                "  rm -f \"$HOME/$PCFIFO\"\n" +
                "  echo $RC > .run.exit\n" +
                "fi\n" +
                "rm -f .watch.pid .script.pid .compile.pid .cancel 2>/dev/null\n" +
                "echo \"[$(date +%H:%M:%S)] termux py script end\" >> \"$PC/.termux.log\"\n";

            alog("runPyTermux: script built, len=" + script.length());
            if (!sendRunCommand(script, true)) {
                alog("runPyTermux: FAIL sendRunCommand returned false");
                emitCpp(cppJson("setup", false, 0, "",
                        "调用 Termux 失败。请确认 Termux 已安装并可正常运行（可在 Termux 终端会话中测试）。"));
                return true;
            }
            stdoutOffset = 0;
            termuxLogOffset = 0;
            new File(dir, ".termux.log").delete();
            startPolling();
            alog("runPyTermux: polling started (waiting python output)");
            return true;
        }

        /** 交互运行中：把用户一行输入写入 FIFO 管道（v4.9.3：FIFO 名按会话唯一化） */
        @JavascriptInterface
        public boolean sendCppInput(final String line) {
            String safe = line == null ? "" : line.replace("'", "'\\''");
            return sendRunCommand("printf '%s\\n' '" + safe + "' > $HOME/" + cppFifoName + " 2>/dev/null; true", true);
        }

        /* ---------- v4.9.3 运行会话目录桥：每次运行独立子目录，多项目连续运行互不串扰 ---------- */
        /** 开始一次运行会话：创建 .run_<时间戳> 目录并设为当前运行目录，返回会话名（失败返回空串=旧模式） */
        @JavascriptInterface
        public String beginRunSession() {
            try {
                // v4.9.4：顺手清理 24 小时前的历史会话目录，防止无限累积
                try {
                    File[] old = swapDir().listFiles();
                    if (old != null) for (File f : old) {
                        if (f.isDirectory() && f.getName().startsWith(".run_")
                                && System.currentTimeMillis() - f.lastModified() > 24 * 3600_000L)
                            deleteRecursive(f);
                    }
                } catch (Exception ignored) { }
                File dir = new File(swapDir(), ".run_" + System.currentTimeMillis() + "_" + (++runSessionSeq));   // v4.11.2：序号递增保证同一毫秒内也不重名
                if (!dir.mkdirs()) { alog("beginRunSession: mkdirs FAIL"); return ""; }
                writeFile(new File(dir, ".active"), "1");   // v4.9.4：活跃标记（cleanSwapTemp 保护排队/运行中的会话）
                runSessionDir = dir;
                alog("runSession begin: " + dir.getName());
                return dir.getName();
            } catch (Exception e) { alog("beginRunSession EX " + e); return ""; }
        }

        /** 向指定运行会话目录写文件（项目头文件/同目录模块注入用；与主文件同目录 → #include/import 可用） */
        @JavascriptInterface
        public boolean saveFileIn(String session, String name, String content) {
            if (!validSession(session)) return false;
            /* v5.4.1 安全（审查 #3）：文件名校验（仍拒绝 ../ 穿越，放开中文等 Unicode 文件名） */
            if (!safeUserFileName(name)) {
                alog("saveFileIn: rejected name " + name);
                return false;
            }
            try {
                File f = new File(new File(swapDir(), session), name);
                File parent = f.getParentFile();
                if (parent != null && !parent.exists()) parent.mkdirs();
                return writeFile(f, content == null ? "" : content);
            } catch (Exception e) { alog("saveFileIn EX " + e); return false; }
        }

        /** v5.10.0：按相对路径写入运行会话目录（保留项目目录结构）。
         *  与 saveFileIn 的区别：允许 a/b/c.cpp 这样的多级相对路径，但仍拒绝绝对路径与 .. 穿越。 */
        @JavascriptInterface
        public boolean saveFileRel(String session, String rel, String content) {
            if (!validSession(session)) return false;
            String clean = safeRelativePath(rel);
            if (clean == null) { alog("saveFileRel: rejected path " + rel); return false; }
            try {
                File base = new File(swapDir(), session);
                File f = new File(base, clean);
                /* 双保险：规范化后必须仍在会话目录内 */
                if (!f.getCanonicalPath().startsWith(base.getCanonicalPath() + File.separator)) return false;
                return writeFile(f, content == null ? "" : content);
            } catch (Exception e) { alog("saveFileRel EX " + e); return false; }
        }

        /** 结束运行会话（JS 收尾时调用；目录保留至下次启动统一清理） */
        @JavascriptInterface
        public void endRunSession() { runSessionDir = null; }

        /** 停止当前 C++/Python 运行（v4.9.4 重写）：
         *  旧实现只发一条 kill 进 Termux 命令队列——而队列被正在运行的长脚本占住时，排队的 kill
         *  要等脚本自然结束才轮得到执行，「停止」实际杀不掉任何进程（中断后旧程序继续写输出的根源）。
         *  新实现：① App 直接向会话目录写 .cancel 标记文件（跨应用立即可见，零延迟），
         *  脚本内的看门狗子进程 0.5s 内发现并杀掉 编译/运行/保活 三类进程、终结脚本释放队列；
         *  ② 队列 kill 兜底（看门狗缺失的异常场景）。 */
        @JavascriptInterface
        public void cancelCpp() {
            stopPolling();
            File dir = currentRunDir();
            try {
                if (writeFile(new File(dir, ".cancel"), "1"))
                    alog("cancelCpp: .cancel written -> " + dir.getName());
            } catch (Exception e) { alog("cancelCpp: write .cancel FAIL " + e); }
            // 队列兜底：正则字符类包住模式首两字符，避免 pkill 匹配到承载本命令的 sh -c 自身
            String pk = "";
            if (cppBinName != null && !cppBinName.isEmpty() && cppBinName.length() > 2) {
                pk = "pkill -9 -f \"" + cppBinName.substring(0, 1) + "[" + cppBinName.substring(1, 2) + "]"
                        + cppBinName.substring(2) + "\" 2>/dev/null; ";
            }
            sendRunCommand(pk
                    + "kill -9 $(cat " + q(new File(dir, ".prog.pid").getAbsolutePath()) + " 2>/dev/null) 2>/dev/null; "
                    + "kill -9 $(cat " + q(new File(dir, ".compile.pid").getAbsolutePath()) + " 2>/dev/null) 2>/dev/null; "
                    + "kill -9 $(cat " + q(new File(dir, ".keep.pid").getAbsolutePath()) + " 2>/dev/null) 2>/dev/null; "
                    + "rm -f $HOME/" + cppFifoName + "; true", true);
        }

        /** 在 Termux 终端中交互运行（完整 TTY，跳转 Termux 界面） */
        @JavascriptInterface
        public boolean runInTermuxTerminal(final String fileName, final String code, final String compiler) {
            if (!isTermuxInstalled()) return false;
            if (!ensureRunCommandPerm()) return false;
            if (!ensureStorageAccess()) return false;
            File dir = swapDir();
            if (!writeFile(new File(dir, fileName), code)) return false;
            String script =
                "cd " + q(dir.getAbsolutePath()) + " && " + q(compiler) + " -std=c++17 -O0 " + q(fileName)
                + " -o $HOME/.pc_tty.out 2>&1 && echo '--- 编译完成，程序输出如下 (Ctrl+C 退出) ---' && timeout 120 $HOME/.pc_tty.out; echo; "
                + "echo '--- 程序已结束，可关闭此会话返回轻码编辑器 ---'\n";
            try {
                Intent i = new Intent("com.termux.RUN_COMMAND");
                i.setComponent(new ComponentName(TERMUX_PKG, "com.termux.app.RunCommandService"));
                i.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/sh");
                i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", script});
                i.putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home");
                i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", false);   // 打开终端会话
                startService(i);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /** 调试：返回内存中的日志（最近 500 条） */
        @JavascriptInterface
        public String getLogs() {
            return logsText();
        }

        /** 调试：日志保存到下载文件夹，返回文件名 */
        @JavascriptInterface
        public String exportLogs() {
            String logs = logsText();
            String name = "QingCode-日志-" + new java.text.SimpleDateFormat("yyyyMMdd-HHmmss", java.util.Locale.US)
                    .format(new java.util.Date()) + ".log";
            saveToDownloads(name, logs);
            alog("exportLogs: saved Downloads/" + name + " (" + logs.length() + " chars)");
            return name;
        }

        /** 调试：前端事件写入日志 */
        @JavascriptInterface
        public void appendLog(String tag, String msg) {
            alog("[" + (tag == null ? "js" : tag) + "] " + msg);
        }

        /** 通用：复制文本到剪贴板 */
        @JavascriptInterface
        public void copyText(String text) {
            runOnUiThread(() -> {
                try {
                    ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    cm.setPrimaryClip(ClipData.newPlainText("pc-copy", text));
                    toast("已复制到剪贴板");
                } catch (Exception e) {
                    toast("复制失败: " + e.getMessage());
                }
            });
        }

        /** 环境向导：打开 Termux 下载页 */
        @JavascriptInterface
        public void openTermuxDownload() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/termux/termux-app/releases")));
                } catch (Exception e) {
                    toast("无法打开浏览器，请手动下载 Termux（F-Droid 或 GitHub Releases）");
                }
            });
        }

        /** 环境向导：复制一键初始化命令并打开 Termux */
        @JavascriptInterface
        public void initTermux() {
            runOnUiThread(() -> {
                try {
                    ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                    cm.setPrimaryClip(ClipData.newPlainText("pc-init", INIT_SCRIPT));
                    toast("初始化命令已复制，请在 Termux 中粘贴并回车执行");
                    Intent i = getPackageManager().getLaunchIntentForPackage(TERMUX_PKG);
                    if (i != null) { i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(i); }
                    else toast("未找到 Termux，请先安装");
                } catch (Exception e) {
                    toast("操作失败: " + e.getMessage());
                }
            });
        }

        @JavascriptInterface
        public void openAllFilesAccess() {            runOnUiThread(() -> {
                try {
                    if (Build.VERSION.SDK_INT >= 30) {
                        startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                                Uri.parse("package:" + getPackageName())));
                    } else {
                        requestPermissions(new String[]{"android.permission.WRITE_EXTERNAL_STORAGE"}, 41);
                    }
                } catch (Exception e) {
                    toast("请到 系统设置 → 应用 → 轻码编辑器 中开启文件权限");
                }
            });
        }

        /* ============ v4.4 插件接口桥（宿主只提供加载与底层通道，插件由用户自行开发） ============ */

        private File safeSwapChild(String name) {
            if (name == null || name.contains("..") || !name.matches("[A-Za-z0-9_\\.\\-]+")) return null;
            try {
                File f = new File(swapDir(), name);
                if (!f.getCanonicalPath().startsWith(swapDir().getCanonicalPath())) return null;
                return f;
            } catch (Exception e) { return null; }
        }

        /** 列出 /sdcard/QingCode/plugins/ 下可加载的插件（*.js），返回 JSON 数组；目录不存在返回 [] */
        @JavascriptInterface
        public String listPlugins() {
            org.json.JSONArray arr = new org.json.JSONArray();
            try {
                File dir = new File(swapDir(), "plugins");
                File[] fs = dir.listFiles();
                if (fs != null) {
                    java.util.Arrays.sort(fs, (a, b) -> a.getName().compareTo(b.getName()));
                    for (File f : fs) {
                        /* v5.9.1：与 readPlugin 用同一套命名规则，否则 Foo.JS 会被列出来但读不出 */
                        if (f.isFile() && f.getName().matches("[A-Za-z0-9_\\.\\-]+\\.js")) arr.put(f.getName());
                    }
                }
            } catch (Exception ignored) { }
            return arr.toString();
        }

        /** 读取插件源码（name 仅允许字母数字点下划线横线，防路径穿越） */
        @JavascriptInterface
        public String readPlugin(String name) {
            try {
                if (name == null || !name.matches("[A-Za-z0-9_\\.\\-]+\\.js")) return "";
                File f = new File(new File(swapDir(), "plugins"), name);
                return (f.isFile()) ? readTextFile(f) : "";
            } catch (Exception e) { return ""; }
        }

        /* ---------- v5.8.0 插件信任：内容哈希 + 应用私有副本 ---------- */

        /** 插件信任信息：[{name,size,mtime,sha256,cacheSha256}]。
         *  sha256 = 共享目录里当前文件的内容哈希；cacheSha256 = 已批准的私有副本哈希（无副本为 ""）。
         *  前端据此判断「未授权 / 已批准 / 内容已变化」。 */
        @JavascriptInterface
        public String pluginInfo() {
            org.json.JSONArray arr = new org.json.JSONArray();
            try {
                File dir = new File(swapDir(), "plugins");
                File[] fs = dir.listFiles();
                if (fs == null) return arr.toString();
                java.util.Arrays.sort(fs, (a, b) -> a.getName().compareTo(b.getName()));
                for (File f : fs) {
                    if (!f.isFile() || !f.getName().matches("[A-Za-z0-9_\\.\\-]+\\.js")) continue;   // 与 readPlugin 一致
                    try {
                        File c = new File(pluginCacheDir(), f.getName());
                        arr.put(new org.json.JSONObject()
                            .put("name", f.getName())
                            .put("size", f.length())
                            .put("mtime", f.lastModified())
                            .put("sha256", sha256Of(f))
                            .put("cacheSha256", c.isFile() ? sha256Of(c) : ""));
                    } catch (Exception ignored) { }
                }
            } catch (Exception ignored) { }
            return arr.toString();
        }

        /** 把已批准的插件源码复制到应用私有目录（共享目录只作导入入口，执行用私有副本） */
        @JavascriptInterface
        public boolean cachePluginCopy(String name, String src) {
            try {
                if (name == null || !name.matches("[A-Za-z0-9_\\.\\-]+\\.js") || src == null) return false;
                File dir = pluginCacheDir();
                File tmp = new File(dir, name + ".tmp");
                writeFile(tmp, src);
                File dst = new File(dir, name);
                if (dst.exists() && !dst.delete()) alog("cachePluginCopy: cannot replace " + name);
                boolean ok = tmp.renameTo(dst);
                if (!ok) { writeFile(dst, src); ok = dst.isFile(); tmp.delete(); }
                return ok;
            } catch (Exception e) { alog("cachePluginCopy EX " + e); return false; }
        }

        /** 读取已批准的私有副本（不存在返回 ""） */
        @JavascriptInterface
        public String readPluginCopy(String name) {
            try {
                if (name == null || !name.matches("[A-Za-z0-9_\\.\\-]+\\.js")) return "";
                File f = new File(pluginCacheDir(), name);
                return f.isFile() ? readTextFile(f) : "";
            } catch (Exception e) { return ""; }
        }

        /** 删除私有副本（撤销授权 / 删除插件时调用） */
        @JavascriptInterface
        public boolean deletePluginCopy(String name) {
            try {
                if (name == null || !name.matches("[A-Za-z0-9_\\.\\-]+\\.js")) return false;
                File f = new File(pluginCacheDir(), name);
                return !f.exists() || f.delete();
            } catch (Exception e) { return false; }
        }

        /** 通用 Termux 命令执行（插件运行其他语言的底层原语；返回 false = 未发出，如被系统拦截） */
        @JavascriptInterface
        public boolean execTermux(final String script, final boolean background) {
            return sendRunCommand(script, background);
        }

        /** v5.0：删除用户插件文件（仅 `/sdcard/QingCode/plugins/<name>.js`，防路径穿越） */
        @JavascriptInterface
        public boolean deletePlugin(String name) {
            try {
                if (name == null || !name.matches("[A-Za-z0-9_\\.\\-]+\\.js")) return false;
                File f = new File(new File(swapDir(), "plugins"), name);
                if (!f.isFile()) { alog("deletePlugin: not a file " + name); return false; }
                boolean ok = f.delete();
                alog("deletePlugin: " + name + " -> " + ok);
                return ok;
            } catch (Exception e) { alog("deletePlugin EX " + e); return false; }
        }

        /** v5.9.0：在线安装插件——把下载到的源码写入 /sdcard/QingCode/plugins/<name>。
         *  只允许 .js、单文件 ≤ 512KB；写入后仍是「未授权」状态，必须在插件管理页勾选权限后才会运行。 */
        @JavascriptInterface
        public boolean writePlugin(String name, String content) {
            try {
                if (name == null || !name.matches("[A-Za-z0-9_\\.\\-]+\\.js") || content == null) return false;
                int bytes = content.getBytes("UTF-8").length;
                if (bytes > 512 * 1024) { alog("writePlugin: too large " + bytes + "B"); return false; }
                File dir = new File(swapDir(), "plugins");
                if (!dir.exists() && !dir.mkdirs()) return false;
                writeFile(new File(dir, name), content);
                alog("writePlugin: " + name + " (" + content.length() + " chars)");
                return true;
            } catch (Exception e) { alog("writePlugin EX " + e); return false; }
        }

        /** v5.10.0：打开系统目录选择器，选一个目录作为工作区（SAF，无需「所有文件访问」） */
        @JavascriptInterface
        public boolean openTreeWorkspace() {
            try {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                startActivityForResult(i, TREE_CHOOSER_CODE);
                return true;
            } catch (Exception e) { alog("openTreeWorkspace EX " + e); return false; }
        }

        /** v5.10.0：查询已保存的 SAF 工作区（token 为空则返回当前唯一的那个，没有则返回空串） */
        @JavascriptInterface
        public String treeWorkspaceInfo(String token) {
            try {
                String id = null;
                if (token != null && !token.isEmpty()) {
                    id = token.startsWith("saf:") ? token.substring(4) : token;
                } else {
                    java.util.Map<String, ?> all = treePrefs().getAll();
                    for (String k : all.keySet()) { if (k.startsWith("uri:")) { id = k.substring(4); break; } }
                }
                if (id == null) return "";
                String uri = treePrefs().getString("uri:" + id, null);
                if (uri == null) return "";
                return new JSONObject().put("id", id).put("name", safName("saf:" + id)).put("uri", uri).toString();
            } catch (Exception e) { alog("treeWorkspaceInfo EX " + e); return ""; }
        }

        /** v5.10.0：忘记一个 SAF 工作区（不删除磁盘上的文件） */
        @JavascriptInterface
        public boolean closeTreeWorkspace(String token) {
            try {
                String id = token != null && token.startsWith("saf:") ? token.substring(4) : token;
                if (id == null || id.isEmpty()) return false;
                String uri = treePrefs().getString("uri:" + id, null);
                if (uri != null) {
                    try {
                        getContentResolver().releasePersistableUriPermission(Uri.parse(uri),
                                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
                                        | android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    } catch (Exception ignored) { }
                }
                treePrefs().edit().remove("uri:" + id).remove("name:" + id).apply();
                return true;
            } catch (Exception e) { return false; }
        }

        /** 读取交换目录下的文件（插件轮询输出用；防路径穿越） */
        @JavascriptInterface
        public String readSwapFile(String name) {
            try {
                File f = safeSwapChild(name);
                return (f != null && f.isFile()) ? readTextFile(f) : "";
            } catch (Exception e) { return ""; }
        }

        /** 写交换目录下的文件（插件放置待执行代码用；防路径穿越） */
        @JavascriptInterface
        public boolean writeSwapFile(String name, String content) {
            try {
                File f = safeSwapChild(name);
                if (f == null) return false;
                java.io.FileOutputStream fo = new java.io.FileOutputStream(f);
                fo.write((content == null ? "" : content).getBytes("UTF-8"));
                fo.close();
                return true;
            } catch (Exception e) { return false; }
        }

        /** 删除交换目录下的文件（插件清理临时文件用；防路径穿越） */
        @JavascriptInterface
        public boolean deleteSwapFile(String name) {
            try {
                File f = safeSwapChild(name);
                return f != null && f.isFile() && f.delete();
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public void showToast(final String msg) {
            runOnUiThread(() -> toast(msg == null ? "" : msg));
        }

        /* ============ v4.1 项目空间 / 打开文件 / 编码 / Termux 会话（桥方法必须在 NativeBridge 内才能暴露给 JS） ============ */

        /** 打开文件夹（项目空间）：浏览目录，「选择此目录」确认 */
        @JavascriptInterface
        public String pickProjectFolder() { return pickNativePath(false); }

        /** 打开单个文件：列表含代码文件，点击文件立即返回其路径（"" = 取消） */
        @JavascriptInterface
        public String pickOpenFile() { return pickNativePath(true); }

        /** 读取单个文件（智能编码识别）→ __onSingleFileLoaded({name,path,content}) */
        @JavascriptInterface
        public boolean readSingleFile(String path) {
            try {
                if (!swapDirWritable()) {
                    emitJs("window.__onSingleFileLoaded && window.__onSingleFileLoaded({\"error\":\"无存储权限\"})");
                    return true;
                }
                File f = new File(path);
                if (!withinSharedStorage(f)) {
                    emitJs("window.__onSingleFileLoaded && window.__onSingleFileLoaded({\"error\":\"路径不在共享存储内，已拒绝\"})");
                    return true;
                }
                if (!f.isFile() || f.length() > 1024L * 1024L) {
                    emitJs("window.__onSingleFileLoaded && window.__onSingleFileLoaded({\"error\":\"文件不存在或超过 1MB\"})");
                    return true;
                }
                String json = "{\"name\":" + org.json.JSONObject.quote(f.getName())
                        + ",\"path\":" + org.json.JSONObject.quote(f.getAbsolutePath())
                        + ",\"content\":" + org.json.JSONObject.quote(readFileSmart(f)) + "}";
                emitJs("window.__onSingleFileLoaded && window.__onSingleFileLoaded(" + json + ")");
                alog("readSingleFile: " + path);
            } catch (Exception e) {
                emitJs("window.__onSingleFileLoaded && window.__onSingleFileLoaded({\"error\":"
                        + org.json.JSONObject.quote(String.valueOf(e)) + "})");
            }
            return true;
        }

        /* v5.4.1 安全（审查 #3）：路径必须落在共享存储内，防止读取应用私有目录 */
        private boolean withinSharedStorage(File f) {
            try {
                String root = Environment.getExternalStorageDirectory().getCanonicalPath();
                String p = f.getCanonicalPath();
                return p.equals(root) || p.startsWith(root + File.separator);
            } catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public boolean readProject(String path) {
            try {
                if (!swapDirWritable()) {
                    emitJs("window.__onProjectLoaded && window.__onProjectLoaded({\"error\":\"无存储权限\"})");
                    return true;
                }
                File root = new File(path);
                if (!withinSharedStorage(root)) {
                    emitJs("window.__onProjectLoaded && window.__onProjectLoaded({\"error\":\"路径不在共享存储内，已拒绝\"})");
                    return true;
                }
                if (!root.isDirectory()) {
                    emitJs("window.__onProjectLoaded && window.__onProjectLoaded({\"error\":\"目录不存在\"})");
                    return true;
                }
                StringBuilder arr = new StringBuilder("[");
                collectCodeFiles(root, root, arr, new int[]{0});
                arr.append("]");
                emitJs("window.__onProjectLoaded && window.__onProjectLoaded({\"path\":"
                        + org.json.JSONObject.quote(root.getAbsolutePath()) + ",\"files\":" + arr + "})");
                alog("readProject: " + path);
            } catch (Exception e) {
                emitJs("window.__onProjectLoaded && window.__onProjectLoaded({\"error\":" + org.json.JSONObject.quote(String.valueOf(e)) + "})");
            }
            return true;
        }

        @JavascriptInterface
        public boolean writeProjectFile(String path, String content, String encoding) {
            /* v5.10.0：SAF 走 ContentResolver，不再依赖绝对路径与「所有文件访问」 */
            String[] saf = safSplit(path);
            if (saf != null) {
                Uri tree = safTreeUri(saf[0]);
                if (tree == null) { lastWriteError = "未知的 SAF 工作区：" + saf[0]; return false; }
                if (saf[1] == null) { lastWriteError = "非法的相对路径"; return false; }
                String err = safWrite(tree, saf[1], content == null ? "" : content);
                lastWriteError = err == null ? "" : err;
                if (err != null) alog("writeProjectFile(saf): " + err);
                return err == null;
            }
            try {
                if (!swapDirWritable()) return false;
                File f = new File(path);
                if (!withinSharedStorage(f)) { alog("writeProjectFile: rejected path " + path); return false; }
                File p = f.getParentFile();
                if (p != null && !p.exists()) p.mkdirs();
                FileOutputStream os = new FileOutputStream(f, false);
                os.write(encodeBytes(content, encoding));
                os.close();
                return true;
            } catch (Exception e) {
                alog("writeProjectFile FAIL " + path + " -> " + e);
                return false;
            }
        }

        /** v5.6.0：只读目录元数据（不读文件内容），用于大项目「按需加载」。
         *  返回 {"metaOnly":true,"path":...,"files":[{rel,size,mtime}]} */
        @JavascriptInterface
        public boolean readProjectMeta(String path) {
            /* v5.10.0：SAF 工作区（"saf:<id>"）——授权本身即权限，不看共享存储写权限 */
            Uri safTree = safTreeUri(path);
            if (safTree != null) {
                try {
                    StringBuilder arr = new StringBuilder("[");
                    safCollect(safTree, DocumentsContract.getTreeDocumentId(safTree), "", arr, new int[]{0}, 0);
                    arr.append("]");
                    JSONObject o = new JSONObject();
                    o.put("metaOnly", true);
                    o.put("saf", true);
                    o.put("path", path);
                    o.put("name", safName(path));
                    o.put("files", new JSONArray(arr.toString()));
                    emitJs("window.__onProjectLoaded && window.__onProjectLoaded(" + o.toString() + ")");
                    alog("readProjectMeta(saf): " + path);
                } catch (Exception e) {
                    emitJs("window.__onProjectLoaded && window.__onProjectLoaded({\"error\":"
                            + JSONObject.quote("读取 SAF 工作区失败：" + e) + "})");
                }
                return true;
            }
            try {
                if (!swapDirWritable()) {
                    emitJs("window.__onProjectLoaded && window.__onProjectLoaded({\"error\":\"无存储权限\"})");
                    return true;
                }
                File root = new File(path);
                if (!withinSharedStorage(root)) {
                    emitJs("window.__onProjectLoaded && window.__onProjectLoaded({\"error\":\"路径不在共享存储内，已拒绝\"})");
                    return true;
                }
                if (!root.isDirectory()) {
                    emitJs("window.__onProjectLoaded && window.__onProjectLoaded({\"error\":\"目录不存在\"})");
                    return true;
                }
                StringBuilder arr = new StringBuilder("[");
                collectCodeMetaFiles(root, root, arr, new int[]{0});
                arr.append("]");
                emitJs("window.__onProjectLoaded && window.__onProjectLoaded({\"metaOnly\":true,\"path\":"
                        + org.json.JSONObject.quote(root.getAbsolutePath()) + ",\"files\":" + arr + "})");
                alog("readProjectMeta: " + path);
            } catch (Exception e) {
                emitJs("window.__onProjectLoaded && window.__onProjectLoaded({\"error\":" + org.json.JSONObject.quote(String.valueOf(e)) + "})");
            }
            return true;
        }

        /** v5.6.0：按需读取项目内单个文件。失败返回 null（空文件返回 ""）。 */
        @JavascriptInterface
        public String readProjectFile(String rootPath, String rel) {
            try {
                if (rel == null || rel.isEmpty() || rel.contains("..") || rel.startsWith("/") || rel.contains("\\")) {
                    alog("readProjectFile: rejected rel " + rel);
                    return null;
                }
                String[] saf = safSplit(rootPath);
                if (saf != null) {
                    Uri tree = safTreeUri(saf[0]);
                    if (tree == null || saf[1] == null) return null;
                    String docId = safDocId(tree, saf[1]);
                    return docId == null ? null : safRead(tree, docId);
                }
                File root = new File(rootPath);
                if (!withinSharedStorage(root) || !root.isDirectory()) return null;
                File f = new File(root, rel);
                if (!withinSharedStorage(f)) return null;
                if (!f.isFile() || f.length() > 1024L * 1024L) return null;
                return readFileSmart(f);
            } catch (Exception e) { return null; }
        }

        /** v5.6.0：读取单个路径的磁盘签名（size + mtime），用于保存前的外部修改检测。
         *  返回 "" 表示路径不存在或不在共享存储内；否则返回 {"size":n,"mtime":ms}。 */
        @JavascriptInterface
        public String statFile(String path) {
            try {
                File f = new File(path);
                if (!withinSharedStorage(f) || !f.exists()) return "";
                JSONObject o = new JSONObject();
                o.put("size", f.length());
                o.put("mtime", f.lastModified());
                return o.toString();
            } catch (Exception e) { return ""; }
        }

        /** v5.5.0：启动恢复工作区前探测目录是否仍可访问（存在且位于共享存储内） */
        @JavascriptInterface
        public boolean projectExists(String path) {
            Uri safTree = safTreeUri(path);
            if (safTree != null) {
                /* SAF：根文档仍可解析即视为存在（授权被撤销/目录被删都会返回 null） */
                try { return safDocId(safTree, "") != null; } catch (Exception e) { return false; }
            }
            try {
                File f = new File(path);
                return withinSharedStorage(f) && f.isDirectory();
            } catch (Exception e) { return false; }
        }

        /** v5.10.0：最近一次写失败的详细原因（SAF 替换失败等），供前端明确提示 */
        @JavascriptInterface
        public String lastWriteError() { return lastWriteError == null ? "" : lastWriteError; }

        /** 导出 Downloads 并按编码写（UTF-8/UTF-8 BOM/UTF-16LE/UTF-16BE/GBK/ASCII） */
        @JavascriptInterface
        public boolean saveFileEx(String name, String content, String encoding) {
            try {
                /* v5.4.1 安全（审查 #3）：导出文件名校验（仍拒绝 ../ 穿越，放开中文等 Unicode 文件名） */
                if (!safeUserFileName(name)) {
                    alog("saveFileEx: rejected name " + name);
                    return false;
                }
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, name);
                FileOutputStream fos = new FileOutputStream(f);
                fos.write(encodeBytes(content, encoding));
                fos.close();
                toast("已保存（" + encoding + "）: " + f.getAbsolutePath());
                return true;
            } catch (Exception e) {
                toast("保存失败: " + e.getMessage());
                return false;
            }
        }

        @JavascriptInterface
        public boolean startTermSession() {
            if (!isTermuxInstalled()) return false;
            if (!ensureRunCommandPerm()) return false;
            File swap = swapDir();
            String s = swap.getAbsolutePath();
            termOffset = 0;
            String script = "H=$HOME;S=" + s + ";rm -f $H/.pc_term_in;rm -f $S/.term_out $H/.pc_term_pid;"
                    + "mkfifo $H/.pc_term_in;touch $S/.term_out;"
                    + "(sleep 86400 > $H/.pc_term_in &);"
                    + "sh -i < $H/.pc_term_in >> $S/.term_out 2>&1 &"
                    + "echo $! > $H/.pc_term_pid";
            boolean ok = sendRunCommand(script, true);
            alog("termSession: start sent, ok=" + ok);
            if (ok) startTermPoll();   // v4.11.2：发送失败时不留无人接收的轮询线程（前端此时已显示连接失败）
            return ok;
        }

        @JavascriptInterface
        public boolean sendTermCmd(String cmd) {
            try {
                String b64 = android.util.Base64.encodeToString(cmd.getBytes("UTF-8"), android.util.Base64.NO_WRAP);
                // timeout 3：shell 已退出（FIFO 无读端）时写管道会阻塞，超时丢弃本次命令避免堆积
                String script = "H=$HOME;B=" + b64 + ";timeout 3 sh -c \"{ echo $B | base64 -d; echo; } >> $H/.pc_term_in\"";
                return sendRunCommand(script, true);
            } catch (Exception e) {
                alog("sendTermCmd FAIL " + e);
                return false;
            }
        }

        @JavascriptInterface
        public boolean stopTermSession() {
            stopTermSessionInternal();
            return true;
        }
    }

    /* ---------- Termux 调用 ---------- */
    private boolean isTermuxInstalled() {
        try {
            getPackageManager().getApplicationInfo(TERMUX_PKG, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private File swapDir() {
        File d = new File(Environment.getExternalStorageDirectory(), SWAP_DIR_NAME);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /* ---------- v5.8.0 插件信任：私有副本目录 + 内容哈希 ---------- */
    /** 已批准插件的私有副本目录（应用内部存储，其他应用无法写入；共享目录只作导入入口） */
    private File pluginCacheDir() {
        File d = new File(getFilesDir(), "plugin_cache");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** 文件内容 SHA-256（小写十六进制）；读不到返回 ""（前端据此视为「无法校验」→ 不授权） */
    private static String sha256Of(File f) {
        if (f == null || !f.isFile()) return "";
        java.io.InputStream in = null;
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            in = new java.io.FileInputStream(f);
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            byte[] out = md.digest();
            StringBuilder sb = new StringBuilder(out.length * 2);
            for (byte b : out) sb.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            return sb.toString();
        } catch (Exception e) {
            return "";
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignored) { }
        }
    }

    /* ---------- v4.9.3 运行会话目录：修复多项目连续运行串项目 ---------- */
    /** 根因：此前所有运行共用同一交换目录，而 Termux 命令是异步排队执行的——
     *  连续运行两个项目（尤其同名 main.cpp）时，后写入的文件覆盖先运行脚本要读的文件，
     *  .stdout 等产物也交叉污染，表现为「运行的是默认项目而非当前项目，有时又好了」。
     *  修复：每次运行创建独立 .run_<时间戳> 会话目录，主文件/头文件/产物全部隔离在其中。 */
    private volatile File runSessionDir = null;
    private int runSessionSeq = 0;
    private volatile String cppFifoName = ".pc_in";   // FIFO 必须放 $HOME（sdcard 不支持 mkfifo），名字按会话唯一化
    private volatile String cppBinName = "";          // v4.9.4：会话独立编译产物名（$HOME/pc_prog_<会话>.out），Python 无

    private static boolean validSession(String s) {
        return s != null && s.matches("\\.run_[0-9A-Za-z_]+");
    }

    /** 轮询/停止等运行期路径：精确返回当前运行目录（会话目录，旧模式为根目录）。
     *  v4.9.4：去掉「目录不存在则回退根目录」的旧逻辑——回退后会读到根目录残留的旧
     *  .run.exit/.stdout，把别人的残留当成自己的运行结果（「秒完成 + 空输出」假象的来源之一）。
     *  会话目录丢失由 pollTask 显式检测并报告。 */
    private File currentRunDir() {
        File s = runSessionDir;
        return (s != null) ? s : swapDir();
    }

    /** v4.9.4 运行会话看门狗：脚本内子进程每 0.5s 检查会话目录的 .cancel 标记文件（由 App 直接写入，
     *  跨应用立即可见，不经过 Termux 命令队列——队列被长脚本占住时，排队的 kill 永远轮不到执行）。
     *  发现取消即杀 编译/运行/保活 三类进程、清 FIFO/二进制、写 .run.exit=130 并终结主脚本（立即释放队列）。
     *  主脚本正常退出后 kill -0 失败自动退场；14400 次 × 0.5s = 2 小时上限防 PID 复用悬挂。 */
    private String watchdogScript() {
        return
            "echo $$ > .script.pid\n" +
            "( W=$(cat .script.pid 2>/dev/null); n=0\n" +
            "  while kill -0 \"$W\" 2>/dev/null && [ \"$n\" -lt 14400 ]; do\n" +
            "    n=$((n+1))\n" +
            "    if [ -f \"$PC/.cancel\" ]; then\n" +
            "      kill -9 $(cat .prog.pid 2>/dev/null) 2>/dev/null\n" +
            "      kill -9 $(cat .compile.pid 2>/dev/null) 2>/dev/null\n" +
            "      kill -9 $(cat .keep.pid 2>/dev/null) 2>/dev/null\n" +
            "      rm -f \"$HOME/$PCFIFO\" \"$HOME/$PCBIN\" 2>/dev/null\n" +
            "      echo 130 > .run.exit 2>/dev/null\n" +
            "      echo \"[$(date +%H:%M:%S)] watchdog: cancelled -> killed prog/compile/keep\" >> \"$PC/.termux.log\"\n" +
            "      kill -9 \"$W\" 2>/dev/null\n" +
            "      break\n" +
            "    fi\n" +
            "    sleep 0.5\n" +
            "  done ) &\n" +
            "echo $! > .watch.pid\n";
    }

    /** v4.9.4：运行结束后精准清理本次会话目录（只删确知的会话目录，绝不动其他活跃/排队会话；
     *  旧模式 runSessionDir==null 时什么都不删，根目录残留交给 cleanSwapTemp） */
    private void purgeRunDir(File dir) {
        try {
            if (runSessionDir != null && dir != null
                    && dir.getAbsolutePath().equals(runSessionDir.getAbsolutePath())) {
                deleteRecursive(dir);
                alog("poll: session dir purged " + dir.getName());
            }
        } catch (Exception e) { alog("purgeRunDir FAIL " + e); }
    }

    /* ---------- 调试日志 ---------- */
    private final java.util.Deque<String> logBuf = new java.util.ArrayDeque<String>();
    private int termuxLogOffset = 0;
    private int pollN = 0;

    private void alog(String msg) {
        String ts = new java.text.SimpleDateFormat("HH:mm:ss.SSS", java.util.Locale.US)
                .format(new java.util.Date());
        String line = "[" + ts + "] " + msg;
        synchronized (logBuf) {
            logBuf.addLast(line);
            while (logBuf.size() > 500) logBuf.pollFirst();
        }
        android.util.Log.i("QingCode", msg);
        try {
            File f = new File(swapDir(), ".app.log");
            java.io.FileWriter w = new java.io.FileWriter(f, true);
            w.write(line + "\n");
            w.close();
        } catch (Exception ignored) { }
    }

    private String logsText() {
        synchronized (logBuf) {
            StringBuilder sb = new StringBuilder();
            for (String s : logBuf) sb.append(s).append('\n');
            return sb.toString();
        }
    }

    private boolean swapDirWritable() {
        File d = swapDir();
        alog("swapDirWritable: dir=" + d.getAbsolutePath() + " exists=" + d.exists());
        try {
            File t = new File(d, ".write_test");
            FileOutputStream fo = new FileOutputStream(t);
            fo.write(1);
            fo.close();
            boolean del = t.delete();
            alog("swapDirWritable: OK (test deleted=" + del + ")");
            return true;
        } catch (Exception e) {
            alog("swapDirWritable: FAIL -> " + e);
            return false;
        }
    }

    /* ================= v4.2 权限引导统一入口 ================= */

    /** 权限被系统「不再询问」：请求过至少一次（pc_prefs 记录）后 shouldShowRequestPermissionRationale 仍为 false */
    private boolean isPermanentlyDenied(String perm) {
        android.content.SharedPreferences sp = getSharedPreferences("pc_perms", MODE_PRIVATE);
        return sp.getBoolean("requested_" + perm, false)
                && !shouldShowRequestPermissionRationale(perm);
    }

    /** 请求单个运行时权限（先记录请求事实，供 isPermanentlyDenied 判定），code 为回调请求码 */
    private void requestPerm(String perm, int code) {
        try {
            getSharedPreferences("pc_perms", MODE_PRIVATE)
                    .edit().putBoolean("requested_" + perm, true).apply();
        } catch (Exception ignored) { }
        requestPermissions(new String[]{perm}, code);
    }

    /** 跳应用详情设置页（权限被「不再询问」后的唯一解法：手动开启） */
    private void openAppSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            toast("请到 系统设置 → 应用 → 轻码编辑器 → 权限 中开启相关权限");
        }
    }

    /** RUN_COMMAND 权限确保：已授权返回 true；否则弹窗请求或跳应用设置（永久拒绝时），返回 false */
    private boolean ensureRunCommandPerm() {
        if (checkSelfPermission("com.termux.permission.RUN_COMMAND") == PackageManager.PERMISSION_GRANTED)
            return true;
        if (isPermanentlyDenied("com.termux.permission.RUN_COMMAND")) {
            alog("RUN_COMMAND permanently denied -> open app settings");
            openAppSettings();
        } else {
            alog("RUN_COMMAND not granted -> requesting (code 42)");
            requestPerm("com.termux.permission.RUN_COMMAND", 42);
        }
        return false;
    }

    /** 与环境检测(getEnv)保持同一判定：以实际写入测试为准，失败时才引导开启「所有文件访问」 */
    private boolean ensureStorageAccess() {
        if (swapDirWritable()) return true;
        if (Build.VERSION.SDK_INT >= 30) {
            if (!Environment.isExternalStorageManager()) requestAllFilesAccess();
        } else if (checkSelfPermission("android.permission.WRITE_EXTERNAL_STORAGE") != PackageManager.PERMISSION_GRANTED) {
            requestPerm("android.permission.WRITE_EXTERNAL_STORAGE", 41);
        }
        return false;
    }

    private void requestAllFilesAccess() {
        try {
            startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            try { startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)); } catch (Exception ignored) { }
        }
    }

    /** v4.2：启动即主动请求权限——权限未齐时每次启动都引导（直到全部授权成功，无一次性标记）；
     *  Android 11+ 先弹 RUN_COMMAND 授权窗（批准后 onRequestPermissionsResult 自动衔接「所有文件访问」设置页）；
     *  被系统「不再询问」的权限改跳应用详情设置页手动开启 */
    private void requestPermissionsOnLaunch() {
        try {
            boolean needRunCmd = checkSelfPermission("com.termux.permission.RUN_COMMAND")
                    != PackageManager.PERMISSION_GRANTED;
            boolean needStorage = Build.VERSION.SDK_INT >= 30
                    ? !Environment.isExternalStorageManager()
                    : checkSelfPermission("android.permission.WRITE_EXTERNAL_STORAGE")
                            != PackageManager.PERMISSION_GRANTED;
            if (!needRunCmd && !needStorage) {
                alog("launch perms: all granted");
                return;
            }
            alog("launch perms: needRunCmd=" + needRunCmd + " needStorage=" + needStorage);
            if (Build.VERSION.SDK_INT >= 30) {
                if (needRunCmd) {
                    if (isPermanentlyDenied("com.termux.permission.RUN_COMMAND")) {
                        alog("launch perms: RUN_COMMAND permanently denied -> app settings");
                        openAppSettings();
                    } else {
                        requestPerm("com.termux.permission.RUN_COMMAND", 42);
                    }
                } else {
                    ensureStorageAccess();   // 缺「所有文件访问」→ 跳设置页
                }
            } else {
                java.util.List<String> ps = new java.util.ArrayList<>();
                if (needStorage) ps.add("android.permission.WRITE_EXTERNAL_STORAGE");
                if (needRunCmd) ps.add("com.termux.permission.RUN_COMMAND");
                requestPermissions(ps.toArray(new String[0]), 40);
            }
        } catch (Exception e) {
            alog("launch perms EXCEPTION " + e);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        alog("onRequestPermissionsResult: code=" + requestCode);
        // RUN_COMMAND 授权窗口关闭后再衔接「所有文件访问」引导，两个引导不同时抢屏
        if (requestCode == 42 && Build.VERSION.SDK_INT >= 30
                && !Environment.isExternalStorageManager()) {
            alog("onRequestPermissionsResult: -> guide all-files-access");
            ensureStorageAccess();
        }
    }

    private static String q(String s) {
        return "'" + (s == null ? "" : s.replace("'", "'\\''")) + "'";
    }

    /** v4.3：后台唤醒 Termux——进程被系统杀掉后，先发一条无害后台命令（sh -c true）拉起
     *  RunCommandService/TermuxService，主命令随后入队自动执行，无需用户先手动打开 Termux */
    private void wakeTermux() {
        try {
            Intent i = new Intent("com.termux.RUN_COMMAND");
            i.setComponent(new ComponentName(TERMUX_PKG, "com.termux.app.RunCommandService"));
            i.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/sh");
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", "true"});
            i.putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home");
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            ComponentName cn = startService(i);
            alog("wakeTermux: startService returned=" + cn
                    + (cn == null ? " (null => 系统拦截，建议给 Termux 关闭电池优化/加自启动白名单)" : ""));
        } catch (Exception e) {
            alog("wakeTermux EXCEPTION " + e);
        }
    }

    private boolean sendRunCommand(String script, boolean background) {
        try {
            wakeTermux();   // v4.3：先唤醒（Termux 已运行时该调用几乎零开销），主命令随后入队执行
            Intent i = new Intent("com.termux.RUN_COMMAND");
            i.setComponent(new ComponentName(TERMUX_PKG, "com.termux.app.RunCommandService"));
            i.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/usr/bin/sh");
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", script});
            i.putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home");
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", background);
            ComponentName cn = startService(i);
            alog("sendRunCommand: bg=" + background + " startService returned=" + cn
                    + (cn == null ? " (null => 系统拦截或目标不可达)" : ""));
            return cn != null;   // v4.11.2：startService 返回 null 即被系统拦截，此前恒返回 true 让前端误判为发送成功
        } catch (Exception e) {
            alog("sendRunCommand: EXCEPTION " + e);
            return false;
        }
    }

    /* ---------- 轮询：增量 stdout + 退出码 ---------- */
    private void startPolling() {
        cppPolling = true;
        cppDeadline = System.currentTimeMillis() + cppTimeoutSec * 1000L;
        main.postDelayed(pollTask, POLL_MS);
    }

    private void stopPolling() {
        cppPolling = false;
        main.removeCallbacks(pollTask);
    }

    private final Runnable pollTask = new Runnable() {
        @Override
        public void run() {
            if (!cppPolling) return;
            File dir = currentRunDir();   // v4.9.3：读当前运行会话目录（隔离产物）
            // 0. v4.9.4 会话目录丢失保护：会话目录被删（如被其他进程清理）时立即终止本轮报告，
            //    绝不回退根目录——否则会读到根目录残留的旧 .run.exit，把别人的结果当成自己的运行结果
            if (runSessionDir != null && !dir.exists()) {
                stopPolling();
                alog("poll: session dir GONE " + dir.getName() + " -> abort (no root fallback)");
                emitCpp(cppJson("run", false, -1, "", "运行会话目录已丢失，本次运行已终止。请重新运行。"));
                return;
            }
            // 0. Termux 侧脚本留痕增量推送
            File tlf = new File(dir, ".termux.log");
            if (tlf.exists() && tlf.length() > termuxLogOffset) {
                /* 与 stdout 同一套 UTF-8 边界读取：即使日志里出现中文也不会因偏移错位而乱码 */
                long[] tadv = new long[]{termuxLogOffset};
                String tchunk = readChunk(tlf, termuxLogOffset, tadv);
                if (tchunk != null && !tchunk.isEmpty()) {
                    termuxLogOffset = (int) tadv[0];
                    emitStream(tchunk.replaceAll("(?m)^", "[termux] "));
                }
            }
            // 1. 增量推送 stdout
            File outF = new File(dir, ".stdout");
            // 1.5 输出超限保护：.stdout 超过 32MB 视为失控输出（死循环打印），立即杀进程停止。
            //     必须先于「读取 stdout」判断——否则要先把这个巨型文件整个读进内存并注入 JS，
            //     真正失控时保护形同虚设。
            if (outF.exists() && outF.length() > 32L * 1024L * 1024L) {
                stopPolling();
                alog("poll: stdout OVERFLOW " + outF.length() + "B, killing process");
                try { writeFile(new File(dir, ".cancel"), "1"); } catch (Exception ignored) { }   // v4.9.4：看门狗即时杀，不等队列
                sendRunCommand("kill -9 $(cat " + q(new File(dir, ".prog.pid").getAbsolutePath()) + " 2>/dev/null) 2>/dev/null; "
                        + "kill -9 $(cat " + q(new File(dir, ".compile.pid").getAbsolutePath()) + " 2>/dev/null) 2>/dev/null; "
                        + "kill -9 $(cat " + q(new File(dir, ".keep.pid").getAbsolutePath()) + " 2>/dev/null) 2>/dev/null; "
                        + "rm -f $HOME/" + cppFifoName + "; true", true);
                emitCpp(cppJson("timeout", false, 125, "",
                        "输出超过 32MB 上限，已自动停止（疑似死循环打印等失控输出）。\n提示：点「停止」也可随时手动终止；可用菜单「导出调试日志」查看详情。"));
                purgeRunDir(dir);
                cleanSwapTemp();
                return;
            }
            if (outF.exists() && outF.length() > stdoutOffset) {
                long[] adv = new long[]{stdoutOffset};
                String chunk = readChunk(outF, stdoutOffset, adv);
                if (chunk != null && !chunk.isEmpty()) {
                    stdoutOffset = adv[0];
                    emitStream(chunk);
                }
            }
            /* 2. stderr 增量推送（v5.10.0：此前每 200ms 把整份 .stderr 重读一遍，
                  输出多时是 O(n²) 的读盘与字符串比较；改为按偏移只读新增部分，
                  同时累积到 errBuf，编译失败时仍有完整文本可交给前端解析错误行） */
            File errF = new File(dir, ".stderr");
            if (errF.exists() && errF.length() > stderrOffset) {
                long[] eadv = new long[]{stderrOffset};
                String echunk = readChunk(errF, stderrOffset, eadv);
                if (echunk != null && !echunk.isEmpty()) {
                    stderrOffset = eadv[0];
                    if (errBuf.length() < 512 * 1024) errBuf.append(echunk);   // 只保留前 512KB 供错误解析
                    lastErr = errBuf.toString();
                    emitStreamErr(echunk);
                }
            }
            String err = errBuf.toString();
            /* 2.5 记录本次编译产物缓存键（供「重跑（不重新编译）」使用） */
            if (lastCacheKey.isEmpty()) {
                String ck = readFile(new File(dir, ".cache.key"));
                if (ck != null && ck.trim().length() == 64) lastCacheKey = ck.trim();
            }
            // 3. 编译失败
            String compileExit = readFile(new File(dir, ".compile.exit"));
            if (compileExit != null && !compileExit.trim().isEmpty()) {
                int ce = parseIntSafe(compileExit.trim(), -1);
                if (ce != 0) {
                    stopPolling();
                    alog("poll: compile FAILED exit=" + ce + " stderrLen=" + (err == null ? 0 : err.length()));
                    emitCpp(cppJson("compile", false, ce, "", err == null ? "" : err));
                    purgeRunDir(dir);
                    cleanSwapTemp();
                    return;
                }
            }
            // 4. 运行结束（v4.9.4 严格判定：.run.exit 必须非空、解析为 0~255 的合法退出码才算完成。
            //    0 字节空文件 / FUSE 延迟可见的半写入内容 / 垃圾内容一律继续等待，不再误判「exit=0 秒完成」）
            String runExit = readFile(new File(dir, ".run.exit"));
            if (runExit != null && !runExit.trim().isEmpty()) {
                int re = parseIntSafe(runExit.trim(), -1);
                if (re >= 0 && re <= 255 && runExit.trim().length() <= 4) {
                    stopPolling();
                    alog("poll: run finished exit=" + re);
                    emitCpp(cppJson("run", re == 0, re, "", err != null && !lastErrSentAll ? err : ""));
                    purgeRunDir(dir);
                    cleanSwapTemp();
                    return;
                }
                alog("poll: .run.exit invalid='" + runExit.trim() + "' (len=" + runExit.trim().length() + "), keep waiting");
            }
            // 5. 文件快照（每 5 秒记录 App 视角的交换目录状态，用于诊断跨应用可见性）
            if (++pollN % 25 == 1) {
                File cef = new File(dir, ".compile.exit"), ref = new File(dir, ".run.exit");
                File sef = new File(dir, ".stderr"), prf = new File(dir, ".prog.pid");
                alog("poll#" + pollN + " snap: .stdout=" + outF.length() + "B .compile.exit=" + cef.length()
                        + "B .run.exit=" + ref.length() + "B .stderr=" + sef.length() + "B .prog.pid=" + prf.length()
                        + "B .termux.log=" + tlf.length() + "B allFilesMgr="
                        + (Build.VERSION.SDK_INT >= 30 && Environment.isExternalStorageManager()));
            }
            // 6. 超时
            if (System.currentTimeMillis() > cppDeadline) {
                stopPolling();
                alog("poll: TIMEOUT after " + cppTimeoutSec + "s, termuxLogOffset=" + termuxLogOffset);
                try { writeFile(new File(dir, ".cancel"), "1"); } catch (Exception ignored) { }   // v4.9.4：看门狗即时杀
                sendRunCommand("kill -9 $(cat " + q(new File(dir, ".prog.pid").getAbsolutePath()) + " 2>/dev/null) 2>/dev/null; "
                        + "kill -9 $(cat " + q(new File(dir, ".compile.pid").getAbsolutePath()) + " 2>/dev/null) 2>/dev/null; "
                        + "kill -9 $(cat " + q(new File(dir, ".keep.pid").getAbsolutePath()) + " 2>/dev/null) 2>/dev/null; "
                        + "rm -f $HOME/" + cppFifoName + "; true", true);
                emitCpp(cppJson("timeout", false, 124, "",
                        "运行超时（" + cppTimeoutSec + " 秒），已强制停止。\n【诊断】\n1) 下拉通知栏：查看 Termux 是否弹出错误通知；\n2) 给 Termux 开通知权限：系统设置 → 应用 → Termux → 通知（Android 13+ 必需）；\n3) 从最近任务完全划掉 Termux → 重新打开 Termux → 回本应用再运行一次；\n4) 仍失败可用菜单「在 Termux 终端中交互运行」绕过后台通道。"));
                purgeRunDir(dir);
                cleanSwapTemp();
                return;
            }
            main.postDelayed(this, POLL_MS);
        }
    };

    private String lastErr = "";
    private boolean lastErrSentAll = false;
    /* v5.10.0：运行会话与增量读取 */
    private String cppSessionId = "";        // 当前会话标识（= 会话目录名），随所有事件回传前端
    private long stderrOffset = 0;           // stderr 增量偏移（此前每 200ms 整份重读）
    private final StringBuilder errBuf = new StringBuilder();   // 增量累积，编译失败时交由前端解析
    private volatile String lastWriteError = "";   // v5.10.0：最近一次写失败原因（SAF 用）
    private String lastCacheKey = "";        // 上次编译产物缓存键（编译/运行分离）
    private String lastRunTail = "";         // 运行段落脚本（重跑时复用，免去重新编译）

    /* ---------- 结果回传 JS ---------- */
    private JSONObject cppJson(String stage, boolean ok, int exit, String stdout, String stderr) {
        JSONObject o = new JSONObject();
        try {
            o.put("stage", stage);
            o.put("ok", ok);
            o.put("exit", exit);
            o.put("stdout", stdout == null ? "" : clamp(stdout));
            o.put("stderr", stderr == null ? "" : clamp(stderr));
            o.put("message", stderr == null ? "" : clamp(stderr));   // 前端 setup 分支读取 message 展示真实失败原因
            o.put("timeout", cppTimeoutSec);
            o.put("elapsed", (System.currentTimeMillis() - cppStartMs) / 1000.0);
            o.put("sid", cppSessionId);   // v5.10.0：前端据此丢弃过期会话的事件
        } catch (Exception ignored) { }
        return o;
    }

    private static String clamp(String s) {
        return s.length() > 256 * 1024 ? s.substring(0, 256 * 1024) + "\n...[输出过长已截断]" : s;
    }

    private void emitCpp(final JSONObject result) {
        runOnUiThread(() -> web.evaluateJavascript(
                "window.__onCppResult && window.__onCppResult(" + result + ")", null));
    }

    private void emitStream(final String text) {
        final String sid = cppSessionId;
        runOnUiThread(() -> web.evaluateJavascript(
                "window.__onCppStream && window.__onCppStream(" + org.json.JSONObject.quote(text)
                        + "," + org.json.JSONObject.quote(sid) + ")", null));
    }

    private void emitStreamErr(final String text) {
        lastErrSentAll = true;   // v4.11.2：完整 stderr 已流式送出，运行结束时不再重发整份（此前该标志恒为 false）
        final String sid = cppSessionId;
        runOnUiThread(() -> web.evaluateJavascript(
                "window.__onCppStreamErr && window.__onCppStreamErr(" + org.json.JSONObject.quote(text)
                        + "," + org.json.JSONObject.quote(sid) + ")", null));
    }

    /* ---------- 文件 IO ---------- */
    /** 用户文件名统一校验：允许中文等 Unicode 字符，但拒绝路径穿越（/ \ ..）与非法字符。
     *  原先的 [A-Za-z0-9_\.\-]+ 白名单会把「测试.py」这类中文名判为非法，
     *  导出/注入静默失败而前端仍提示成功。 */
    /* ============================================================
     * v5.10.0：SAF 工作区（Storage Access Framework）
     * · 根令牌形如 "saf:<id>"，与绝对路径共用同一套 JS 调用面
     * · 解析路径时逐段按 displayName 查子项，绝不拼接 documentId
     * · 写入采用「临时文件 + 替换」，替换失败保留备份并明确报错
     * ============================================================ */
    private static final String[] SAF_COLS = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED
    };
    private static final String SAF_DIR = DocumentsContract.Document.MIME_TYPE_DIR;

    private android.content.SharedPreferences treePrefs() {
        return getSharedPreferences("qc_tree", MODE_PRIVATE);
    }

    private static String treeIdOf(Uri uri) {
        return "ws" + Integer.toHexString(uri.toString().hashCode());
    }

    private String treeDisplayName(Uri uri) {
        try {
            String rootId = DocumentsContract.getTreeDocumentId(uri);
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(uri, rootId);
            android.database.Cursor c = getContentResolver().query(doc, SAF_COLS, null, null, null);
            if (c != null) {
                try { if (c.moveToFirst()) return c.getString(1); } finally { c.close(); }
            }
        } catch (Exception ignored) { }
        return uri.getLastPathSegment() == null ? "工作区" : uri.getLastPathSegment();
    }

    /** "saf:<id>" → 已持久授权的 tree Uri；不是令牌或查不到返回 null */
    private Uri safTreeUri(String token) {
        if (token == null || !token.startsWith("saf:")) return null;
        String s = treePrefs().getString("uri:" + token.substring(4), null);
        if (s == null) return null;
        try { return Uri.parse(s); } catch (Exception e) { return null; }
    }

    private String safName(String token) {
        if (token == null || !token.startsWith("saf:")) return "";
        return treePrefs().getString("name:" + token.substring(4), "");
    }

    /** 把 "saf:<id>/a/b.cpp" 拆成 [令牌, 相对路径]；不是 SAF 令牌返回 null */
    private String[] safSplit(String path) {
        if (path == null || !path.startsWith("saf:")) return null;
        int slash = path.indexOf('/');
        if (slash < 0) return new String[]{path, ""};
        return new String[]{path.substring(0, slash), safeRelativePath(path.substring(slash + 1))};
    }

    /** 逐段解析相对路径 → documentId；任一段不存在返回 null */
    private String safDocId(Uri tree, String rel) {
        try {
            String cur = DocumentsContract.getTreeDocumentId(tree);
            if (rel == null || rel.isEmpty()) return cur;
            for (String seg : rel.split("/")) {
                if (seg.isEmpty() || seg.equals(".") || seg.equals("..")) return null;
                String found = null;
                Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, cur);
                android.database.Cursor c = getContentResolver().query(children, SAF_COLS, null, null, null);
                if (c != null) {
                    try {
                        while (c.moveToNext()) {
                            if (seg.equals(c.getString(1))) { found = c.getString(0); break; }
                        }
                    } finally { c.close(); }
                }
                if (found == null) return null;
                cur = found;
            }
            return cur;
        } catch (Exception e) { alog("safDocId EX " + e); return null; }
    }

    private String safRead(Uri tree, String docId) {
        try {
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, docId);
            java.io.InputStream in = getContentResolver().openInputStream(doc);
            if (in == null) return null;
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            in.close();
            return bo.toString("UTF-8");
        } catch (Exception e) { alog("safRead EX " + e); return null; }
    }

    /** 用「临时文件 + 替换」写入；成功返回 null，失败返回可直接展示的错误描述。
     *  替换失败时用备份恢复原文件——绝不出现「原文件没了、新内容也没写进去」。 */
    private String safWrite(Uri tree, String rel, String content) {
        int slash = rel.lastIndexOf('/');
        String parentRel = slash < 0 ? "" : rel.substring(0, slash);
        String name = slash < 0 ? rel : rel.substring(slash + 1);
        String parentId = safDocId(tree, parentRel);
        if (parentId == null) return "目录不存在：" + (parentRel.isEmpty() ? "（根目录）" : parentRel);
        String existing = safDocId(tree, rel);
        String backup = existing == null ? null : safRead(tree, existing);
        Uri tmp = null;
        try {
            Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(tree, parentId);
            tmp = DocumentsContract.createDocument(getContentResolver(), parentUri,
                    "application/octet-stream", ".qc_tmp_" + System.currentTimeMillis());
            if (tmp == null) return "无法在此目录创建文件（可能没有写权限）";
            java.io.OutputStream os = getContentResolver().openOutputStream(tmp, "wt");
            if (os == null) return "无法打开临时文件";
            os.write(content.getBytes("UTF-8"));
            os.flush();
            os.close();
            if (existing != null) {
                if (!DocumentsContract.deleteDocument(getContentResolver(),
                        DocumentsContract.buildDocumentUriUsingTree(tree, existing)))
                    return "原文件无法替换（删除失败），内容未改动";
            }
            Uri renamed = DocumentsContract.renameDocument(getContentResolver(), tmp, name);
            if (renamed == null) {
                if (backup != null) {
                    try {
                        Uri restore = DocumentsContract.createDocument(getContentResolver(),
                                DocumentsContract.buildDocumentUriUsingTree(tree, parentId),
                                "application/octet-stream", name);
                        if (restore != null) {
                            java.io.OutputStream os2 = getContentResolver().openOutputStream(restore, "wt");
                            if (os2 != null) { os2.write(backup.getBytes("UTF-8")); os2.flush(); os2.close(); }
                        }
                    } catch (Exception ignored) { }
                }
                return "重命名失败，已尝试恢复原文件";
            }
            return null;
        } catch (Exception e) {
            alog("safWrite EX " + e);
            return "写入失败：" + e;
        } finally {
            try { if (tmp != null) DocumentsContract.deleteDocument(getContentResolver(), tmp); } catch (Exception ignored) { }
        }
    }

    /** 递归收集工作区文件元数据（与 collectCodeMetaFiles 同口径：跳过隐藏项/构建目录，单文件 ≤1MB，最多 200 个） */
    private void safCollect(Uri tree, String docId, String prefix, StringBuilder arr, int[] n, int depth) {
        if (n[0] >= 200 || depth > 8) return;
        try {
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId);
            android.database.Cursor c = getContentResolver().query(children, SAF_COLS, null, null, null);
            if (c == null) return;
            java.util.List<Object[]> rows = new java.util.ArrayList<>();
            try {
                while (c.moveToNext()) {
                    rows.add(new Object[]{c.getString(0), c.getString(1), c.getString(2), c.isNull(3) ? 0L : c.getLong(3), c.isNull(4) ? 0L : c.getLong(4)});
                }
            } finally { c.close(); }
            rows.sort((a, b) -> String.valueOf(a[1]).compareToIgnoreCase(String.valueOf(b[1])));
            for (Object[] r : rows) {
                if (n[0] >= 200) return;
                String nm = String.valueOf(r[1]);
                if (nm.startsWith(".") || nm.equals("build") || nm.equals("node_modules")) continue;
                String rel = prefix.isEmpty() ? nm : prefix + "/" + nm;
                if (SAF_DIR.equals(r[2])) { safCollect(tree, String.valueOf(r[0]), rel, arr, n, depth + 1); continue; }
                long size = (Long) r[3];
                if (size > 1024 * 1024) continue;
                if (!nm.matches(".*\\.(py|cpp|cc|cxx|c|h|hpp|hh|txt|md|json|java|js|html|css|xml|csv)$")) continue;
                if (arr.length() > 1) arr.append(",");
                arr.append("{\"rel\":").append(JSONObject.quote(rel))
                   .append(",\"size\":").append(size)
                   .append(",\"mtime\":").append((Long) r[4]).append("}");
                n[0]++;
            }
        } catch (Exception e) { alog("safCollect EX " + e); }
    }

    /** v5.10.0：相对路径校验（允许子目录，拒绝绝对路径 / .. / 空段 / 非法字符），返回规范化后的相对路径 */
    private static String safeRelativePath(String rel) {
        if (rel == null) return null;
        String p = rel.replace('\\', '/').trim();
        if (p.isEmpty() || p.length() > 240) return null;
        if (p.startsWith("/") || p.matches("^[A-Za-z]:.*")) return null;
        StringBuilder out = new StringBuilder();
        for (String seg : p.split("/")) {
            if (seg.isEmpty() || seg.equals(".") || seg.equals("..")) return null;
            if (seg.length() > 120 || seg.matches(".*[<>:\"|?*].*") || seg.indexOf('\0') >= 0) return null;
            if (out.length() > 0) out.append('/');
            out.append(seg);
        }
        return out.length() == 0 ? null : out.toString();
    }

    private static boolean safeUserFileName(String name) {
        if (name == null || name.isEmpty() || name.length() > 120) return false;
        if (name.contains("..") || name.contains("/") || name.contains("\\") || name.indexOf('\0') >= 0) return false;
        return !name.matches(".*[<>:\"|?*].*");
    }

    private boolean writeFile(File f, String content) {
        try {
            // 文件名可能是 "src/main.py" 这类带子目录的相对路径：先建父目录，否则 FileOutputStream 直接抛异常
            File parent = f.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();
            FileOutputStream fo = new FileOutputStream(f);
            fo.write(content.getBytes("UTF-8"));
            fo.close();
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    private static String readFile(File f) {
        try {
            FileInputStream fi = new FileInputStream(f);
            java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = fi.read(buf)) > 0) bo.write(buf, 0, n);
            fi.close();
            return new String(bo.toByteArray(), "UTF-8");
        } catch (IOException e) {
            return null;
        }
    }

    private static String readFrom(File f, long offset) {
        try {
            RandomAccessFile raf = new RandomAccessFile(f, "r");
            long len = raf.length();
            if (len <= offset) { raf.close(); return ""; }
            raf.seek(offset);
            byte[] b = new byte[(int) (len - offset)];
            raf.readFully(b);
            raf.close();
            return new String(b, "UTF-8");
        } catch (IOException e) {
            return null;
        }
    }

    /** 从 offset 读到文件末尾，末尾若是不完整的多字节字符则留到下次；next[0] = 下次起始偏移。
     *  按「实际消费的字节数」推进偏移，避免 new String(...) 把半截字符变成 U+FFFD 后
     *  getBytes().length 与实际字节数不等导致的偏移错位（跨块中文乱码/重复的根因）。 */
    private static String readChunk(File f, long offset, long[] next) {
        try {
            RandomAccessFile raf = new RandomAccessFile(f, "r");
            long len = raf.length();
            if (len <= offset) { raf.close(); next[0] = offset; return ""; }
            raf.seek(offset);
            byte[] b = new byte[(int) (len - offset)];
            raf.readFully(b);
            raf.close();
            int n = completeUtf8Prefix(b);
            next[0] = offset + n;
            return new String(b, 0, n, "UTF-8");
        } catch (IOException e) {
            next[0] = offset;
            return null;
        }
    }

    /** 返回 b 中最后一个完整 UTF-8 字符结束位置（避免把多字节字符切成两半） */
    private static int completeUtf8Prefix(byte[] b) {
        int i = b.length - 1, cont = 0;
        while (i >= 0 && (b[i] & 0xC0) == 0x80 && cont < 3) { i--; cont++; }
        if (i < 0) return b.length;
        int lead = b[i] & 0xFF;
        int need = lead < 0x80 ? 1 : (lead >> 5) == 0x6 ? 2 : (lead >> 4) == 0xE ? 3 : (lead >> 3) == 0x1E ? 4 : 1;
        return (cont + 1 < need) ? i : b.length;   // 不足一个字符 → 回退到 lead 之前
    }

    private static int parseIntSafe(String s, int def) {
        try { return Integer.parseInt(s); } catch (Exception e) { return def; }
    }

    /* ---------- 导出 Downloads ---------- */
    private void saveToDownloads(String name, String content) {
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues cv = new ContentValues();
                cv.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name);
                cv.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mimeOf(name));
                cv.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (uri == null) throw new IOException("无法创建文件");
                OutputStream os = getContentResolver().openOutputStream(uri);
                os.write(content.getBytes("UTF-8"));
                os.close();
                toast("已保存到 Downloads/" + name);
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists()) dir.mkdirs();
                File f = new File(dir, name);
                FileOutputStream fos = new FileOutputStream(f);
                fos.write(content.getBytes("UTF-8"));
                fos.close();
                toast("已保存到 " + f.getAbsolutePath());
            }
        } catch (Exception e) {
            toast("保存失败: " + e.getMessage());
        }
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }

    /* ================= v4.0 项目空间 / 文件编码 / Termux 终端会话 ================= */

    private void emitJs(final String expr) {
        runOnUiThread(() -> web.evaluateJavascript(expr, null));
    }

    /* ---------- 编码工具 ---------- */
    /** 按目标编码转字节；GBK 由 Android ICU 提供 */
    private static byte[] encodeBytes(String s, String enc) throws Exception {
        if (enc == null) enc = "UTF-8";
        switch (enc) {
            case "UTF-8 BOM": {
                byte[] b = s.getBytes("UTF-8");
                byte[] out = new byte[b.length + 3];
                out[0] = (byte) 0xEF; out[1] = (byte) 0xBB; out[2] = (byte) 0xBF;
                System.arraycopy(b, 0, out, 3, b.length);
                return out;
            }
            case "UTF-16LE": {   // 带 BOM：导出后其他编辑器可正确识别、本应用回读不乱码
                byte[] b = s.getBytes("UTF-16LE");
                byte[] out = new byte[b.length + 2];
                out[0] = (byte) 0xFF; out[1] = (byte) 0xFE;
                System.arraycopy(b, 0, out, 2, b.length);
                return out;
            }
            case "UTF-16BE": {
                byte[] b = s.getBytes("UTF-16BE");
                byte[] out = new byte[b.length + 2];
                out[0] = (byte) 0xFE; out[1] = (byte) 0xFF;
                System.arraycopy(b, 0, out, 2, b.length);
                return out;
            }
            case "GBK": return s.getBytes("GBK");
            case "ASCII": {      // 含非 ASCII 字符时明确报错，避免静默变「?」损坏内容
                for (int i = 0; i < s.length(); i++) {
                    if (s.charAt(i) > 127)
                        throw new Exception("ASCII 编码不支持中文等非 ASCII 字符（第 "
                                + (i + 1) + " 字：「" + s.charAt(i) + "」），请改用 UTF-8 或 GBK");
                }
                return s.getBytes("US-ASCII");
            }
            default: return s.getBytes("UTF-8");
        }
    }

    private static byte[] readAllBytes(File f) throws IOException {
        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
        FileInputStream fi = new FileInputStream(f);
        byte[] buf = new byte[65536];
        int n;
        while ((n = fi.read(buf)) > 0) bo.write(buf, 0, n);
        fi.close();
        return bo.toByteArray();
    }

    /** 智能读取：BOM 优先 → UTF-8 严格解码 → GBK 回退 */
    private static String readFileSmart(File f) {
        try {
            byte[] b = readAllBytes(f);
            if (b.length >= 3 && (b[0] & 0xff) == 0xEF && (b[1] & 0xff) == 0xBB && (b[2] & 0xff) == 0xBF)
                return new String(b, 3, b.length - 3, "UTF-8");
            if (b.length >= 2 && (b[0] & 0xff) == 0xFF && (b[1] & 0xff) == 0xFE)
                return new String(b, 2, b.length - 2, "UTF-16LE");
            if (b.length >= 2 && (b[0] & 0xff) == 0xFE && (b[1] & 0xff) == 0xFF)
                return new String(b, 2, b.length - 2, "UTF-16BE");
            try {
                java.nio.charset.CharsetDecoder dec = java.nio.charset.StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                        .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT);
                return dec.decode(java.nio.ByteBuffer.wrap(b)).toString();
            } catch (Exception ue) {
                return new String(b, "GBK");
            }
        } catch (Exception e) {
            return "";
        }
    }

    /* ---------- 项目空间 / 打开文件：原生目录·文件选择器 ---------- */
    /** pickFile=false：浏览目录后按「选择此目录」返回文件夹；pickFile=true：列表含代码文件，点击文件立即返回其路径 */
    private String pickNativePath(final boolean pickFile) {
        final File[] result = new File[1];
        final CountDownLatch latch = new CountDownLatch(1);
        runOnUiThread(() -> {
            final File[] cur = {Environment.getExternalStorageDirectory()};
            LinearLayout box = new LinearLayout(this);
            box.setOrientation(LinearLayout.VERTICAL);
            TextView pathView = new TextView(this);
            pathView.setPadding(28, 28, 28, 10);
            pathView.setTextIsSelectable(false);
            ListView lv = new ListView(this);
            box.addView(pathView);
            box.addView(lv);
            final Runnable[] refresh = new Runnable[1];
            refresh[0] = () -> {
                pathView.setText("📁 " + cur[0].getAbsolutePath());
                java.util.List<String> names = new java.util.ArrayList<>();
                java.util.List<File> items = new java.util.ArrayList<>();
                // 只要不是外部存储根目录就提供「返回上级」（Environment 实际返回
                // /storage/emulated/0，旧代码用 startsWith("/sdcard") 判断永远为假）
                File storageRoot = Environment.getExternalStorageDirectory();
                File parent = cur[0].getParentFile();
                if (parent != null && !cur[0].getAbsolutePath().equals(storageRoot.getAbsolutePath())) {
                    names.add("⬆️ 返回上级");
                    items.add(parent);
                }
                File[] subs = cur[0].listFiles();
                if (subs != null) {
                    java.util.Arrays.sort(subs, (a, b) -> {
                        if (a.isDirectory() != b.isDirectory()) return a.isDirectory() ? -1 : 1;
                        return a.getName().compareToIgnoreCase(b.getName());
                    });
                    for (File f0 : subs) {
                        if (f0.getName().startsWith(".")) continue;
                        if (f0.isDirectory()) {
                            names.add("📂 " + f0.getName());
                            items.add(f0);
                        } else if (pickFile && f0.getName().matches(
                                ".*\\.(py|cpp|cc|cxx|c|h|hpp|hh|txt|md|json|java|js|html|css|xml|csv)$")) {
                            names.add("📄 " + f0.getName());
                            items.add(f0);
                        }
                    }
                }
                ArrayAdapter<String> ad = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, names);
                lv.setAdapter(ad);
                lv.setOnItemClickListener((p, v, pos, id) -> {
                    File it = items.get(pos);
                    if (it.isDirectory()) { cur[0] = it; refresh[0].run(); }
                    else if (pickFile) { result[0] = it; latch.countDown(); }
                });
            };
            refresh[0].run();
            try {
                AlertDialog.Builder b = new AlertDialog.Builder(this)
                        .setTitle(pickFile ? "选择要打开的文件" : "选择项目文件夹")
                        .setView(box)
                        .setNegativeButton("取消", (d, w) -> latch.countDown());
                if (!pickFile) b.setPositiveButton("选择此目录", (d, w) -> { result[0] = cur[0]; latch.countDown(); });
                b.show();
            } catch (Exception e) {
                latch.countDown();   // 对话框弹出失败（如 Activity 非前台）时不阻塞 JS 桥线程
                alog("pickNativePath dialog FAIL " + e);
            }
        });
        try { latch.await(180, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
        File f = result[0];
        return f == null ? "" : f.getAbsolutePath();
    }

    /* ---------- 项目空间：读取代码文件 ---------- */
    /** v5.6.0：只枚举元数据，不读内容（按需加载用） */
    private void collectCodeMetaFiles(File root, File dir, StringBuilder arr, int[] n) {
        File[] fs = dir.listFiles();
        if (fs == null || n[0] >= 200) return;
        java.util.Arrays.sort(fs, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));
        for (File f : fs) {
            if (n[0] >= 200) return;
            String nm = f.getName();
            if (nm.startsWith(".") || nm.equals("build") || nm.equals("node_modules")) continue;
            if (f.isDirectory()) { collectCodeMetaFiles(root, f, arr, n); continue; }
            if (f.length() > 1024 * 1024) continue;
            if (!nm.matches(".*\\.(py|cpp|cc|cxx|c|h|hpp|hh|txt|md|json|java|js|html|css|xml|csv)$")) continue;
            String rel = root.toPath().relativize(f.toPath()).toString().replace(File.separatorChar, '/');
            if (arr.length() > 1) arr.append(",");
            arr.append("{\"rel\":").append(org.json.JSONObject.quote(rel))
               .append(",\"size\":").append(f.length())
               .append(",\"mtime\":").append(f.lastModified()).append("}");
            n[0]++;
        }
    }

    private void collectCodeFiles(File root, File dir, StringBuilder arr, int[] n) {
        File[] fs = dir.listFiles();
        if (fs == null || n[0] >= 200) return;
        java.util.Arrays.sort(fs, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));
        for (File f : fs) {
            if (n[0] >= 200) return;
            String nm = f.getName();
            if (nm.startsWith(".") || nm.equals("build") || nm.equals("node_modules")) continue;
            if (f.isDirectory()) { collectCodeFiles(root, f, arr, n); continue; }
            if (f.length() > 1024 * 1024) continue;
            if (!nm.matches(".*\\.(py|cpp|cc|cxx|c|h|hpp|hh|txt|md|json|java|js|html|css|xml|csv)$")) continue;   // v4.11.2：与「打开文件」白名单对齐
            String rel = root.toPath().relativize(f.toPath()).toString().replace(File.separatorChar, '/');
            if (arr.length() > 1) arr.append(",");
            /* v5.5.0：附带 size/mtime 作为磁盘签名，前端据此判断文件是否被外部修改 */
            arr.append("{\"rel\":").append(org.json.JSONObject.quote(rel))
               .append(",\"size\":").append(f.length())
               .append(",\"mtime\":").append(f.lastModified())
               .append(",\"content\":").append(org.json.JSONObject.quote(readFileSmart(f))).append("}");
            n[0]++;
        }
    }

    /* ---------- Termux 内嵌终端会话（FIFO 持久 sh + 交换目录轮询；桥方法在 NativeBridge 内） ---------- */
    private Thread termPollThread = null;
    private long termOffset = 0;

    private void startTermPoll() {
        stopTermPoll();
        termPollThread = new Thread(() -> {
            File out = new File(swapDir(), ".term_out");
            int beat = 0;
            while (termPollThread != null && !Thread.currentThread().isInterrupted()) {
                try {
                    if (out.exists() && out.length() > 64L * 1024L * 1024L) {
                        // 会话输出超 64MB：自动断开会话保护存储
                        String chunk = readFrom(out, termOffset);
                        if (chunk != null && !chunk.isEmpty()) {
                            emitJs("window.__onTermOut && window.__onTermOut(" + org.json.JSONObject.quote(chunk) + ")");
                        }
                        termOffset = out.length();
                        emitJs("window.__onTermOut && window.__onTermOut(\"\\n[输出超过 64MB，终端会话已自动断开]\\n\")");
                        alog("termPoll: term_out OVERFLOW " + out.length() + "B, session stopped");
                        stopTermSessionInternal();
                        break;
                    }
                    long[] adv = new long[]{termOffset};
                    String chunk = readChunk(out, termOffset, adv);
                    if (chunk != null && !chunk.isEmpty()) {
                        termOffset = adv[0];
                        emitJs("window.__onTermOut && window.__onTermOut(" + org.json.JSONObject.quote(chunk) + ")");
                    }
                    if (++beat % 25 == 0) alog("termPoll#" + beat + " offset=" + termOffset);
                    Thread.sleep(200);
                } catch (InterruptedException ie) {
                    break;
                } catch (Exception e) {
                    try { Thread.sleep(500); } catch (InterruptedException ignored) { break; }
                }
            }
        }, "pc-term-poll");
        termPollThread.start();
    }

    private void stopTermPoll() {
        if (termPollThread != null) { termPollThread.interrupt(); termPollThread = null; }
    }

    /** 停止 Termux 终端会话（主体方法：NativeBridge.stopTermSession 与 termPoll 溢出保护共用） */
    private void stopTermSessionInternal() {
        stopTermPoll();
        String script = "kill $(cat $HOME/.pc_term_pid 2>/dev/null) 2>/dev/null;"
                + "pkill -f \"sleep 86400\" 2>/dev/null;rm -f $HOME/.pc_term_in";
        sendRunCommand(script, true);
        alog("termSession: stopped");
    }

    /* ---------- 生命周期 ---------- */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    /** v4.4：上一次 onResume 时的交换目录可写状态（用于检测授权回流） */
    private boolean lastStorageOk = false;
    private final android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        // v4.4：授权回流检测移到后台线程（磁盘写测试不再占用主线程，避免恢复瞬间卡顿）
        new Thread(() -> {
            try {
                boolean ok = swapDirWritable();
                boolean finalOk = ok;
                mainHandler.post(() -> {
                    if (finalOk && !lastStorageOk && web != null) {
                        web.evaluateJavascript("typeof probeTermux==='function'&&probeTermux();", null);
                        alog("onResume: storage became writable -> re-probe frontend");
                    }
                    lastStorageOk = finalOk;
                });
            } catch (Exception e) {
                alog("onResume storage-check EXCEPTION " + e);
            }
        }, "pc-resume").start();
    }

    /* v5.4：WebView <input type="file"> 的文件选择回调（自选壁纸用） */
    private android.webkit.ValueCallback<android.net.Uri[]> fileChooserCallback = null;
    private static final int FILE_CHOOSER_CODE = 1001;
    private static final int TREE_CHOOSER_CODE = 1002;   // v5.10.0：SAF 工作区目录选择

    @Override
    protected void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        if (requestCode == FILE_CHOOSER_CODE) {
            android.net.Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getData() != null) {
                    results = new android.net.Uri[]{ data.getData() };
                } else if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    results = new android.net.Uri[n];
                    for (int i = 0; i < n; i++) results[i] = data.getClipData().getItemAt(i).getUri();
                }
            }
            if (fileChooserCallback != null) {
                fileChooserCallback.onReceiveValue(results);
                fileChooserCallback = null;
            }
            return;
        }
        /* v5.10.0：SAF 工作区——拿到 tree Uri 后立刻持久化授权，重启后仍可访问 */
        if (requestCode == TREE_CHOOSER_CODE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                Uri tree = data.getData();
                try {
                    getContentResolver().takePersistableUriPermission(tree,
                            android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
                                    | android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                } catch (Exception e) { alog("tree: takePersistable FAIL " + e); }
                String id = treeIdOf(tree);
                String name = treeDisplayName(tree);
                treePrefs().edit().putString("uri:" + id, tree.toString()).putString("name:" + id, name).apply();
                alog("tree picked: " + id + " " + tree);
                String js = "";
                try {
                    js = "window.__onTreeWorkspace && window.__onTreeWorkspace("
                            + new JSONObject().put("id", id).put("name", name).put("uri", tree.toString()).toString() + ")";
                } catch (Exception e) {
                    /* org.json 的 put 声明了 JSONException，这里退化为手工拼一份最小的 */
                    js = "window.__onTreeWorkspace && window.__onTreeWorkspace({id:" + JSONObject.quote(id)
                            + ",name:" + JSONObject.quote(name) + "})";
                }
                final String jsCall = js;
                runOnUiThread(() -> web.evaluateJavascript(jsCall, null));
            } else {
                runOnUiThread(() -> web.evaluateJavascript("window.__onTreeWorkspace && window.__onTreeWorkspace({cancelled:true})", null));
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onDestroy() {
        stopPolling();
        stopTermPoll();   // 退出时停止 Termux 输出轮询线程（Termux 侧会话由下次连接自愈重建）
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
