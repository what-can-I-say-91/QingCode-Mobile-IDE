# QingCode Editor v5.4.2 · Source Guide

**[中文](README.md) · English**

A lightweight Android code editor: **CodeMirror 6 + Pyodide (Python WASM) + Termux Clang/GCC (real C++ compilation)**, running fully offline in a WebView shell, with the APK built directly from the command line (**no Gradle / Android Studio needed**). Without Termux configured, C++ automatically falls back to the built-in JSCPP teaching interpreter.

**v5.0 highlights: editor pluginization — the core keeps only document / gutter / undo / highlighting / error marks, and every optional editing capability is assembled by a built-in plugin (`cm6.js` re-bundled to 753 KB, exposing `PCCM.modules` with 73 modules + 4 compartments; plugins add/remove instantly) · PCPluginAPI v3 (new `editor` interface: extension / command / toolbar / language / completion / snippets / formatter / events) · built-in plugin "Editor Plus" (27 commands + 9 touch-toolbar buttons + command palette + multi-cursor mode + line ops + folding + snippets + formatting + completion migration) · highlighting decoupled from running (js/json/html/css/md) · built-in plugins can be toggled instantly from the plugin page · full zh/en i18n for plugin strings.**

**Foundations from v3.0: interactive I/O (not canned runs), faster compiler startup (multi-level caching), automatic dependency installation.**

## Features

| Feature | Notes |
|---|---|
| 🌍 Bilingual UI | Choose Chinese/English on first launch; switch anytime from the menu |
| 🐍 Offline Python | Built-in Pyodide (CPython 3.12 WASM, background Worker thread); terminal-style line-by-line `input()` (auto dialog fallback) |
| ⚙️ Real C++ builds | Termux clang++/g++ offline compilation; realtime terminal I/O with streaming output |
| ☁️ Free online compilers | Wandbox + Judge0 dual engines (**manual opt-in**; default JSCPP never uploads code) |
| 🧠 Smart completion | Keywords / imported-library members / header names; prefix filtering, IME-friendly |
| 🎯 Error visualization | Full-line red highlight + squiggles + reason bubble; auto-jump to the earliest error; editing clears the mark |
| 📂 Workspace | Open a folder to load the whole tree; project `import`/headers just work; 30 s autosave |
| 💾 Encoding options | Export as UTF-8/BOM/UTF-16/GBK/ASCII; smart read detection, no mojibake |
| 🖥 Embedded terminal | Persistent Termux shell inside the app; two-way realtime command/output |
| 🛡 Runaway-output guard | Programs printing over 32 MB are stopped automatically; temp files cleaned after every run and on launch |
| 🤖 Engine auto-maintenance | Background guard loop for Termux Python/clang: missing → auto-install (Tsinghua mirror), failure → retry every 45 s, ready → announced automatically, zero waiting at startup |
| ⏹ Instant stop | All five run engines terminate immediately on Stop—no waiting for timeouts |
| 📋 Bundled source | Viewable in About; auto-extracted to `/sdcard/QingCode/源码/` (includes third-party licenses in `licenses/`) |
| 🧩 Editor Plus (built-in plugin) | Minimal core + plugin assembly: multi-cursor mode / line ops / folding / indent / completion / snippets / format; touch toolbar + command palette; enable/disable instantly from the plugin page |
| 🔐 Plugin safety | User plugins can be deleted (with confirmation); a "not security-reviewed" warning precedes enabling a third-party plugin, and a permanent banner sits on the plugin page |
| 🧠 Code intelligence | Semantic analysis / type hints / errors & warnings / go to definition / find references / go to implementation / symbol search / inline docs / call hierarchy (Python via real ast, C++ heuristic) |
| 🧭 Navigation & search | Quick open · class/method/symbol jump · global search & replace (regex) · recent files · bookmarks |
| 🖼 Wallpaper | preset gradients / local image / opacity, persisted |
| 🧪 Plugin sandbox | third-party plugins run isolated in a Web Worker **by default** (no DOM / native bridge / storage); only trusted ones may opt out |
| ⚙ Control panel | Title-bar command search (same height as Run) + pinned palette entry + VS Code style control panel (skeleton) |

## Download APK

Grab the latest `轻码编辑器-QingCode-v5.4.2.apk` from [Releases](../../releases) (see the version table below for history).The full user guide: [使用说明_EN.md](使用说明_EN.md) (English) / [使用说明.md](使用说明.md) (Chinese).

## Architecture

```
┌─ WebView (appassets.local = assets/editor/) ─────────────────┐
│  CodeMirror 6 (vendor/cm6.js)  ·  i18n.js bilingual  ·  terminal │
│      │ Pyodide (pyodide/)           │ C++ engine dispatch      │
│      └ Python 3.12 WASM             ├─ Termux bridge → real clang++ │
│        splash loads the runtime     └─ JSCPP Worker fallback   │
└──────────────────────────────────────────────────────────────┘
          │ window.Android (JS bridge)
┌─ MainActivity ───────────────────────────────────────────────┐
│  assets interception (js/css 1d, wasm/zip 7d Cache-Control + COOP/COEP) │
│  requestInput: CountDownLatch modal → Python input() realtime │
│  TermuxBridge: md5 build cache ($HOME/.pc_cache) · auto pkg install │
│    → mkfifo interactive pipe + sleep keep-alive writer · background run + incremental stdout polling │
│    → emitStream streaming output · terminal input row sendCppInput writes pipe in realtime │
└──────────────────────────────────────────────────────────────┘
```

## Directory Layout

```
QingCode-源码/
├── app/                        # Android project
│   ├── src/main/AndroidManifest.xml          # RUN_COMMAND permission + queries com.termux
│   ├── src/main/java/.../MainActivity.java   # WebView shell + JS bridge + Termux FIFO I/O
│   └── src/main/res/mipmap-*                 # App icons
├── web/                        # Frontend (= APK assets; serve locally to preview)
│   ├── index.html / style.css / app.js       # bottom terminal + bilingual data-i18n markers
│   ├── i18n.js                 # v4.2 bilingual UI dictionary & switching (zh/en, 120+ keys)
│   ├── vendor/cm6.js           # CodeMirror 6 bundle (esbuild, 753KB)
│   ├── vendor/JSCPP.js         # JSCPP fallback engine (esbuild bundle, stream/util shims)
│   ├── vendor/cpp-worker.js    # JSCPP worker (terminable on timeout)
│   ├── plugins/editor-plus.js  # v5.0 built-in plugin "Editor Plus" (multi-cursor / line ops / folding / snippets / format / command palette)
│   ├── plugins/code-intel.js   # v5.0 built-in plugin "Code Intelligence" (semantic analysis / go-to-def / references / call hierarchy, Python via ast)
│   ├── plugins/navigator.js    # v5.1 built-in plugin "Navigator" (quick open / global search-replace / recent files / bookmarks)
│   ├── sandbox-worker.js       # v5.4 plugin sandbox (Web Worker)
│   └── pyodide/                # Pyodide 0.26.4 core (CPython 3.12 stdlib, 5 files)
├── build.sh                    # one-click build (assemble assets → aapt2 → javac → d8 → sign); also generates the assets/source snapshot (incl. res icons, vendor/JSCPP.js and licenses/; only Pyodide binaries are excluded)
├── plugins/                    # v4.4 plugin interface: API docs (zh/en) + language-plugin skeleton (plugins go into /sdcard/QingCode/plugins/ on the phone)
├── licenses/                   # Third-party license texts (CodeMirror / Pyodide+CPython / JSCPP / lodash / Emscripten / Termux / Judge0 / Wandbox; see its README for the index)
├── debug.keystore              # debug signing key (password hardcoded in build.sh; auto-generated if missing)
├── LICENSE                     # MIT license (with developer contact & feedback email)
├── README.md / README_EN.md    # This file: features, architecture, layout, mechanics, build & extending
├── CHANGELOG.md / CHANGELOG_EN.md # Full version history (48 releases + recent details)
├── 使用说明.md                  # Full user guide (install / config / FAQ, Chinese)
├── 使用说明_EN.md               # User guide in English (mirrors the Chinese edition)
├── .gitignore                  # for GitHub upload (Android template + build outputs)
```

## Key Mechanisms

### 1. Interactive I/O (core of v3.0)

| Engine | Interaction | How it works |
|---|---|---|
| Python (Pyodide) | **Realtime**: when the program hits `input()`, you type line by line in the bottom terminal (the prompt is echoed live; Enter sends) | Since v4.10 it runs on a Worker thread: a `SharedArrayBuffer` + `Atomics.wait/notify` handshake blocks the read (zero polling); `Worker.terminate()` force-interrupts; without cross-origin isolation it falls back to the main thread + the `requestInput` JS-bridge dialog |
| C++ (Termux) | **Realtime**: streaming output + terminal input row sends line by line | `mkfifo $HOME/.pc_in` named pipe + `sleep 100000 > fifo &` keeps the writer open (no EOF); program runs in background; native 200 ms incremental polling of `.stdout` (RandomAccessFile offset) → `emitStream` streaming callbacks; the frontend input row `sendCppInput()` writes `printf '%s\n' … > $HOME/.pc_in` |
| C++ (JSCPP fallback) | **One-shot**: detects `cin/scanf/getchar` before running and collects input in a multi-line box | JSCPP `drain` is a one-shot input model; line-by-line interaction is impossible (only 1 callback in practice) |

### 2. Fast startup (v3.0)

- **Sequential splash loading** (since v4.6, replacing the v3.0 idle preload): the splash screen shows live progress for both engines — Python first, then C++ (Termux) — and the main UI opens once Python is ready, so runs start instantly; combined with the v4.5 WASM compile cache, the next cold start skips compilation;
- **WebView asset caching**: `shouldInterceptRequest` injects `Cache-Control` into local assets (js/css 1 day, wasm/zip 7 days) plus `Cross-Origin-Opener-Policy/Embedder-Policy` headers; second launches hit the disk cache directly, WASM compiled artifacts included;
- **md5 build cache**: C++ source md5 → `$HOME/.pc_cache/<hash>`; identical code builds instantly (skips clang++ on cache hit);
- **Dynamic import fix**: relative imports require the `./` prefix + `new URL(base, location.href)` to resolve indexURL, ensuring offline local loading instead of silently falling back to a CDN.

### 3. Automatic dependency installation (v3.0)

- When running C++, the script checks `command -v clang++` and runs `pkg install -y clang` if missing (one network pass, fully offline afterwards);
- **No manual setup needed day-to-day** (since v4.11): python/clang are checked at launch and missing ones are installed in the background from the Tsinghua mirror — a 45 s guard loop retries automatically and announces readiness; manual entries live under "Settings → Engines & Termux" as `Setup ① Get Termux` and `⚙️ Configure C++` (per-command guide: mirror switch + numbered init commands with hints, long-press to copy and run in order).

### 4. Termux C++ pipeline (rewritten in v3.0)

1. Code is written to `/storage/emulated/0/QingCode/<file>`;
2. A `com.termux.RUN_COMMAND` intent runs the script: auto-install compiler → md5 cache check → `clang++ -std=c++17` builds into **$HOME private dir** (/sdcard is noexec) → `mkfifo` creates the pipe → background run;
3. Native 200 ms incremental polling of `.stdout` → `emitStream` streaming output; `.compile.exit` / `.run.exit` decide the phase;
4. The terminal input row writes to the FIFO in realtime; `scanf`/`cin` block waiting for input;
5. On timeout (60 s default) `.prog.pid` / `.keep.pid` are killed; Termux needs `allow-external-apps=true` + the "All files access" grant;
6. **Runaway-output protection (v4.1.3)**: if `.stdout` exceeds 32 MB during polling, the process is killed immediately with a notice; after every build/run all temp files in the swap directory are cleaned up (`.stdout/.stderr/.exit/.pid/.termux.log/source copies`; `源码/` and `.app.log` are kept); the app also cleans leftovers on startup; a terminal session auto-disconnects when `.term_out` exceeds 64 MB.

### 5. Plugin-based editor (v5.0)

The core keeps only document / gutter / undo / highlighting / error marks / onChange·onCursor; everything else is a slot:

- **`PCCM.modules`** exposes **73 exports** of CM6 (`state` / `view` / `language` / `commands` / `autocomplete` / `search` / `lint` / language packs / `oneDark`) so language packs never re-bundle the core;
- **Four `Compartment` slots**: `lang` / `font` / `indent` / **`plugins`**, reconfigured live via `PCCM.setPluginExtensions(view, exts)`;
- **PCPluginAPI v3**: the `editor` interface offers `addExtension` / `registerCommand` / `addToolbarButton` / `registerLanguage` / `registerCompletion` / `snippets` / `formatter` / `on` (`docChange`·`selection`·`fileOpen`), with ownership tracking so a plugin can be **unloaded instantly**;
- **Load order**: `web/plugins/*.js` (bundled in the APK, also loads in browser preview) first, then user plugins from `/sdcard/QingCode/plugins/*.js`; a failing plugin only affects itself.

## Local Preview / Build

```bash
# Preview (browser: Python works, C++ falls back to JSCPP, Python input() uses window.prompt)
cd web && python3 -m http.server 8899

# Build APK
ANDROID_SDK_ROOT=/opt/android-sdk ./build.sh
# Output: build/QingCode.apk (versionName 5.4.0 / versionCode 49)
```

Requirements: JDK 11+, Android SDK (build-tools;34.0.0, platforms;android-34). First build auto-generates `debug.keystore` (password hardcoded in build.sh).

## Development Guide

| What to change | Where |
|---|---|
| Editor behavior/theme | `web/app.js` `initEditor()`, `web/vendor/cm6.js` (bundle sources below) |
| Re-bundle CM6 | `import {python…}` entry + `esbuild entry.js --bundle --format=iife --global-name` exposing `window.PCCM` |
| Termux build/interaction script | script string in `MainActivity.java` `runCpp()` (FIFO, cache, auto-install all live here) |
| Input dialog text/logic | `MainActivity.java` `requestInput()` (CountDownLatch + AlertDialog) |
| Terminal input row | `web/index.html` `#term-input-row`, `web/app.js` `sendTermInput()` |
| Streaming poll interval | `MainActivity.java` 200 ms handler |
| Timeout duration | frontend `Android.runCpp(…, 60)` and `timeout 50` inside the Termux script |
| C++ sample code | `CPP_DEFAULT_CODE` (STL interactive) / `CPP_JSCPP_CODE` (fallback-compatible) at the top of `web/app.js` |
| App name / version | `AndroidManifest.xml` (currently versionCode 49 / versionName 5.4.0) + `web/app.js` `APP_VERSION` |
| Built-in plugin / edit commands | `web/plugins/editor-plus.js` (commands / toolbar / snippets / formatting), registered through `PCPluginAPI.v3`'s `editor` interface |
| Plugin extension surface | `EditorAPI` in `web/app.js` (extension / command / toolbar / language / completion / snippets / formatter / events) + `PCCM.modules` |
| Bilingual UI strings | `web/i18n.js` dictionary (driven by `data-i18n*` attributes); add attributes + bilingual keys for new UI elements |
| Runaway-output thresholds | `MainActivity.java` `pollTask()` (32 MB) and `termPoll` (64 MB), `cleanSwapTemp()` |

### Rebuilding runtime assets from scratch

```bash
# CodeMirror 6 (if upgrading)
npm i codemirror @codemirror/lang-python @codemirror/lang-cpp @codemirror/theme-one-dark esbuild
# Pyodide (China-friendly: download the 5 core files from jsdelivr one by one; if wasm fails use fastly/gcore mirrors)
curl -LO https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide-core-0.26.4.tar.bz2 && tar xjf pyodide-core-0.26.4.tar.bz2
# JSCPP (note the capitalization)
npm pack JSCPP@2.0.9 && npx esbuild lib/commonjs.js --bundle --global-name=JSCPP --format=iife \
  --alias:stream=shim-stream.js --alias:util=shim-util.js --minify -o vendor/JSCPP.js
```

## Security notes

- **Signing key**: the bundled `debug.keystore` is for local debugging only and its password is public. **Release builds must use a private key**:
  `KEYSTORE=/path/to/release.jks KEYSTORE_PASS=... ./build.sh`; anything signed with the debug key is for personal use only.
- **Third-party plugins**: a **newly appeared** file under `/sdcard/QingCode/plugins/` is **disabled by default** and must be confirmed in the plugin manager; **plugins run in a "🧪 sandbox" by default** (no DOM / native bridge / storage); only a fully trusted plugin may have its sandbox turned off to run on the main thread (with a second confirmation).
- **Online compilers**: the default C++ engine is JSCPP (local, no upload); code is only sent to Wandbox/Judge0 when you explicitly pick "Online".
- **Path validation**: the native bridge whitelists plugin/file names and canonicalises project paths, rejecting out-of-root paths; external links are handed to the system for http/https/mailto only.

## Versioning

**Format `x.y.z`** (z shown as omitted x.y when z=0):

| Change level | Bumped digit | Example |
|---|---|---|
| Refactors, compiler swaps and other **major changes** | x (y, z reset) | 2.0 → 3.0 |
| **General logic changes** | y (z reset) | 3.0 → 3.1 |
| **Minor tweaks, light optimizations** | z | 3.0 → 3.0.1 |

> Past releases are never modified: historical APKs keep their original filenames and new versions ship under new names (the source directory always holds the latest; history lives in this table).

**The full version history (48 releases) lives in [CHANGELOG_EN.md](CHANGELOG_EN.md).**
