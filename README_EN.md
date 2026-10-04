# QingCode Editor v4.2 · Source Guide

[中文](README.md) · **English**

A lightweight Android code editor: **CodeMirror 6 + Pyodide (Python WASM) + Termux Clang/GCC (real C++ compilation)**, running fully offline in a WebView shell, with the APK built directly from the command line (**no Gradle / Android Studio needed**). Without Termux configured, C++ automatically falls back to the built-in JSCPP teaching interpreter.

**v4.2 highlights: bilingual UI (choose Chinese/English on first launch, switch anytime from the menu) · runaway-output protection for the swap directory (32 MB cap + auto cleanup) · free online compilers (Wandbox/Judge0 dual fallback) · workspace (open folder + autosave) · smart code completion · error-line highlighting with jump & edit-to-clear · instant stop · selectable export encodings (incl. GBK).**

**Foundations from v3.0: interactive I/O (not canned runs), faster compiler startup (multi-level caching), automatic dependency installation.**

![Smart completion](截图/v4.0-智能补全.png)
![Interactive terminal](截图/v3.0-交互终端.png)

## Features

| Feature | Notes |
|---|---|
| 🌍 Bilingual UI | Choose Chinese/English on first launch; switch anytime from the menu |
| 🐍 Offline Python | Built-in Pyodide (CPython 3.12 WASM); realtime `input()` via dialog |
| ⚙️ Real C++ builds | Termux clang++/g++ offline compilation; realtime terminal I/O with streaming output |
| ☁️ Free online compilers | Wandbox + Judge0 dual fallback; zero setup, just internet |
| 🧠 Smart completion | Keywords / imported-library members / header names; prefix filtering, IME-friendly |
| 🎯 Error visualization | Full-line red highlight + squiggles + reason bubble; auto-jump to the earliest error; editing clears the mark |
| 📂 Workspace | Open a folder to load the whole tree; project `import`/headers just work; 30 s autosave |
| 💾 Encoding options | Export as UTF-8/BOM/UTF-16/GBK/ASCII; smart read detection, no mojibake |
| 🖥 Embedded terminal | Persistent Termux shell inside the app; two-way realtime command/output |
| 🛡 Runaway-output guard | Programs printing over 32 MB are stopped automatically; temp files cleaned after every run and on launch |
| ⏹ Instant stop | All five run engines terminate immediately on Stop—no waiting for timeouts |
| 📋 Bundled source | Viewable in About; auto-extracted to `/sdcard/QingCode/源码/` |

## Download APK

Grab the latest `轻码编辑器-QingCode-v4.2.apk` from [Releases](../../releases) (see the version table below for history). The full user guide lives in [使用说明.md](使用说明.md) (Chinese).

## Architecture

```
┌─ WebView (appassets.local = assets/editor/) ─────────────────┐
│  CodeMirror 6 (vendor/cm6.js)  ·  i18n.js bilingual  ·  terminal │
│      │ Pyodide (pyodide/)           │ C++ engine dispatch      │
│      └ Python 3.12 WASM             ├─ Termux bridge → real clang++ │
│        idle preload (boot+800ms)    └─ JSCPP Worker fallback   │
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
│   ├── vendor/cm6.js           # CodeMirror 6 bundle (esbuild, 560KB)
│   ├── vendor/JSCPP.js         # JSCPP fallback engine (esbuild bundle, stream/util shims)
│   ├── vendor/cpp-worker.js    # JSCPP worker (terminable on timeout)
│   └── pyodide/                # Pyodide 0.26.4 core (CPython 3.12 stdlib, 5 files)
├── build.sh                    # one-click build (assemble assets → aapt2 → javac → d8 → sign)
├── debug.keystore              # debug signing key (password hardcoded in build.sh; auto-generated if missing)
├── LICENSE                     # MIT license (with developer contact & feedback email)
├── .gitignore                  # for GitHub upload (Android template + build outputs)
└── 截图/                       # v1.0 – v3.4 screenshots
```

## Key Mechanisms

### 1. Interactive I/O (core of v3.0)

| Engine | Interaction | How it works |
|---|---|---|
| Python (Pyodide) | **Realtime**: when the program hits `input()`, an input dialog pops up, echoes, then continues | `setStdin` → JS bridge `requestInput` (`CountDownLatch` blocks the UI thread showing an `AlertDialog`, released on Enter) |
| C++ (Termux) | **Realtime**: streaming output + terminal input row sends line by line | `mkfifo $HOME/.pc_in` named pipe + `sleep 100000 > fifo &` keeps the writer open (no EOF); program runs in background; native 200 ms incremental polling of `.stdout` (RandomAccessFile offset) → `emitStream` streaming callbacks; the frontend input row `sendCppInput()` writes `printf '%s\n' … > $HOME/.pc_in` |
| C++ (JSCPP fallback) | **One-shot**: detects `cin/scanf/getchar` before running and collects input in a multi-line box | JSCPP `drain` is a one-shot input model; line-by-line interaction is impossible (only 1 callback in practice) |

### 2. Fast startup (v3.0)

- **Pyodide idle preload**: `loadPyodide` runs 800 ms after the UI is ready, so tapping Run is instant (cold start takes ~12 s to load; preload makes it near-zero wait);
- **WebView asset caching**: `shouldInterceptRequest` injects `Cache-Control` into local assets (js/css 1 day, wasm/zip 7 days) plus `Cross-Origin-Opener-Policy/Embedder-Policy` headers; second launches hit the disk cache directly, WASM compiled artifacts included;
- **md5 build cache**: C++ source md5 → `$HOME/.pc_cache/<hash>`; identical code builds instantly (skips clang++ on cache hit);
- **Dynamic import fix**: relative imports require the `./` prefix + `new URL(base, location.href)` to resolve indexURL, ensuring offline local loading instead of silently falling back to a CDN.

### 3. Automatic dependency installation (v3.0)

- When running C++, the script checks `command -v clang++` and runs `pkg install -y clang` if missing (one network pass, fully offline afterwards);
- The "Setup guide" menu has three steps: `Get Termux` → `Initialize` (**per-command guide**: Tsinghua mirror switch + 5 init commands shown individually, numbered with hints; user long-presses to copy and runs them in order, configuring allow-external-apps + installing clang) → `Re-check`.

### 4. Termux C++ pipeline (rewritten in v3.0)

1. Code is written to `/storage/emulated/0/QingCode/<file>`;
2. A `com.termux.RUN_COMMAND` intent runs the script: auto-install compiler → md5 cache check → `clang++ -std=c++17` builds into **$HOME private dir** (/sdcard is noexec) → `mkfifo` creates the pipe → background run;
3. Native 200 ms incremental polling of `.stdout` → `emitStream` streaming output; `.compile.exit` / `.run.exit` decide the phase;
4. The terminal input row writes to the FIFO in realtime; `scanf`/`cin` block waiting for input;
5. On timeout (60 s default) `.prog.pid` / `.keep.pid` are killed; Termux needs `allow-external-apps=true` + the "All files access" grant;
6. **Runaway-output protection (v4.1.3)**: if `.stdout` exceeds 32 MB during polling, the process is killed immediately with a notice; after every build/run all temp files in the swap directory are cleaned up (`.stdout/.stderr/.exit/.pid/.termux.log/source copies`; `源码/` and `.app.log` are kept); the app also cleans leftovers on startup; a terminal session auto-disconnects when `.term_out` exceeds 64 MB.

## Local Preview / Build

```bash
# Preview (browser: Python works, C++ falls back to JSCPP, Python input() uses window.prompt)
cd web && python3 -m http.server 8899

# Build APK
ANDROID_SDK_ROOT=/opt/android-sdk ./build.sh
# Output: build/QingCode.apk (versionName 4.2 / versionCode 22)
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
| App name / version | `AndroidManifest.xml` (currently versionCode 22 / versionName 4.2) + `web/app.js` `APP_VERSION` |
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

## Versioning & History

**Format `x.y.z`** (z shown as omitted x.y when z=0):

| Change level | Bumped digit | Example |
|---|---|---|
| Refactors, compiler swaps and other **major changes** | x (y, z reset) | 2.0 → 3.0 |
| **General logic changes** | y (z reset) | 3.0 → 3.1 |
| **Minor tweaks, light optimizations** | z | 3.0 → 3.0.1 |

> Past releases are never modified: historical APKs keep their original filenames and new versions ship under new names (the source directory always holds the latest; history lives in this table).

| Version | Level | Highlights |
|---|---|---|
| v1.0 | x (initial) | Monaco + Pyodide + JSCPP, WebView shell, command-line build |
| v2.0 | x (editor/compiler swap) | Editor switched to CodeMirror 6; C++ switched to real Termux compilation; JSCPP demoted to fallback |
| v3.0 | x (interaction rewrite) | **Interactive I/O (dialog/terminal input row/streaming output), fast startup (preload + cache headers + md5 build cache), auto dependency install + setup guide** |
| v3.0.1 | z | **"Get Termux" dual-option dialog** (GitHub download / copy developer email 19587486395@163.com); new `copyText` native bridge; versionCode 4. Signing key fixed at `debug.keystore` (password hardcoded in build.sh) from this release on |
| v3.0.2 | z | **Storage-permission auto guidance**: if Termux is installed but the swap dir is unwritable, Re-check / Run C++ auto-opens the system "All files access" page (previously the `openAllFilesAccess` bridge had no frontend entry and silently fell back to JSCPP); versionCode 5 |
| v3.0.3 | z | **Guided initialization**: "Setup ②" now opens a 4-step guide dialog instead of jumping straight to Termux: mirror-switch command (display only, long-press to copy) → copy init command → paste & run → **(y/n) type y** hint; a permission explainer dialog shows before jumping to system settings; versionCode 6 |
| v3.0.4 | z | **Observable run pipeline**: "build request sent" printed immediately on Run; 10 s heartbeat shows wait time; timeout stderr became a 4-step diagnosis checklist (Termux error notification / notification permission / cold restart / run in terminal directly); versionCode 7 |
| v3.0.5 | z | **Fixed setup-check inconsistency**: `ensureStorageAccess` before runs unified with environment detection on an "actual write test" basis (previously runs also enforced `isExternalStorageManager`, contradicting the green detection dot); `cppJson` gained a `message` field so the real setup-failure reason reaches the terminal; permission failures auto-open the "Open Settings" guide; versionCode 8 |
| v3.1 | y (logging) | **Debug logging system**: full native logging on key paths (getEnv/permission states/file writes/`startService` return/poll exit codes/timeouts; 500-entry memory ring + `/sdcard/QingCode/.app.log`); Termux-side script traces (`.termux.log`, `[termux]`-prefixed incremental output); menu "Export debug logs" one-tap output + copy; new `getLogs`/`appendLog` bridges; versionCode 9 |
| v3.1.1 | z | **SecurityException root cause fixed**: logs proved `RUN_COMMAND` is a dangerous-level custom permission—manifest declaration alone is not enough; runtime `requestPermissions` added before `runCpp`/`runInTermuxTerminal`; log export adds "Save to Downloads" (`Downloads/QingCode-日志-<timestamp>.log`, `exportLogs` bridge); versionCode 10 |
| v3.1.2 | z | **Poll snapshot diagnostics**: build/run polling logs a `poll#N` file snapshot every 5 s (swap-dir artifact sizes and `.termux.log` offsets) plus Termux-side start/end traces; `cppJson` surfaces the real stderr reason; versionCode 11 |
| v3.2 | y (online compilers) | **Free online engines for C++/Python (Wandbox primary + Judge0 CE backup, auto failover)**: real compilation without Termux; input statements detected and pre-filled as stdin (one-shot submit, no step-by-step interaction); **engine switch moved to dropdown menus** (C++ engine auto/Termux/online/JSCPP, compiler clang++/g++, Python engine Pyodide/online; persisted with instant toast); **fixed About double buttons**: dialogs gained `showCancel`, info-only dialogs (About/Termux guide) show a single "Close" and dismiss on OK; versionCode 12 |
| v3.3 | y (About revamp + bundled source) | **New About dialog**: logo + version + three tabs (**Terms of Service / Credits & Thanks (CodeMirror 6, Pyodide, JSCPP, Wandbox, Judge0, Termux) / Developer & License** (developer Feng Junxi; GLM 5.3Flash main code, DeepSeek V4.1Flash bug fixes & optimization; **MIT License**, LICENSE file shipped with source)); **source bundled with app**: packed into `assets/source/` at build time (Pyodide binaries & screenshots excluded), auto-extracted to **`/sdcard/QingCode/源码/`** on launch/permission (`.version` marker updated incrementally), path & status shown at the bottom of About (new `sourcesReady` bridge); versionCode 13 |
| v3.4 | y (error visualization) | **Build/runtime errors marked right in the editor**: error output parsing (GCC/Clang `file:line:col: error:` and the last frame of Python Tracebacks) → **full-line red highlight** (red background + left red bar) + **red squiggle under the offending symbol/function** (auto word selection) + **error bubble with the reason** (auto-dismisses in 5 s, cursor scrolls to the error); covers all engines: Termux build failures, online C++ errors, built-in Pyodide exceptions, online Python tracebacks (max 6 marks per run, cleared on re-run/file switch); implemented by injecting `StateEffect`/`StateField`/`Decoration` into the `cm6.js` bundle exposing `PCCM.markErrors/clearErrors`; versionCode 14 |
| v4.0 | x (major upgrade · four features) | **① Smart completion**: realtime suggestion popup (120 ms debounce) in three scenarios—standard syntax/keywords (`pri`→`print(`), **member completion for successfully imported libraries** (`import math` then `math.`→sin/cos/sqrt… 20 items; `std::` after `#include <cmath>`; import/from/#include regex scanning), header-name completion (`#include <`→25 common headers); ↑↓ select / Tab or Enter accept / Esc close, capture-phase interception without disturbing typing; **② Workspace**: menu "Open folder" native directory browser (`CountDownLatch` + `AlertDialog` + `ListView`), recursively loads all code files (≤200 files, ≤1 MB each) as a project, file tree with relative paths, project mode in the title bar, **Python `import` of project modules just works** (Pyodide `FS.writeFile` injects the virtual FS before runs / Termux headers written to the swap dir), **30 s autosave** of all edits back to original paths; **③ Export encoding**: menu encoding dropdown (UTF-8 / UTF-8 BOM / UTF-16LE / UTF-16BE / **GBK** / ASCII), "Export" writes with the selected encoding (native `encodeBytes`, six encodings), smart read detection (BOM first → strict UTF-8 → GBK fallback, no mojibake); **④ Embedded Termux terminal session**: menu "Termux terminal session" opens a persistent shell connected inside the app (no app switching)—FIFO (`$HOME/.pc_term_in`, writer kept alive by `sleep 86400`) + 200 ms incremental polling of the out file, **two-way realtime command/output**, commands base64-encoded via RUN_COMMAND to dodge escaping; new bridges: `pickProjectFolder/readProject/writeProjectFile/saveFileEx/startTermSession/sendTermCmd/stopTermSession/encodeBytes/readFileSmart`; versionCode 15 |
| v4.0.1 | z (full debug pass) | **Frontend, 6 fixes**: ① member completion filtered by typed prefix (`math.fa`→only fabs(/factorial(, previously the full table); ② popup no longer re-opens right after accepting (`applySuppressPos` suppression + resumes on further typing); ③ `std::` scope member completion fixed (member regex only matched `.`, so `std::co` could never trigger); ④ `#include <` header completion got prefix filtering too (`cma`→cmath); ⑤ no English suggestions while an IME composition is active (`cm.composing`); ⑥ completion popup top clamped with `Math.max(4,…)` on short viewports; failed project-file saves (e.g. ASCII with Chinese) now report count & reason in the terminal. **Native, 6 fixes**: ⑦ `readAllBytes`/`readFile` loop to read full contents (single `read()` risked truncation); ⑧ UTF-16LE/BE exports got BOMs (previously always mojibake on re-read); ⑨ ASCII export with Chinese now errors clearly (previously silently wrote `?`); ⑩ project dialog `show()` failure counts down the latch (no more 180 s bridge hang); ⑪ `sendTermCmd` wrapped in `timeout 3` (writing a FIFO with no reader blocks forever); ⑫ `onDestroy` stops the Termux poll thread; Pyodide injection uses standard `FS.analyzePath`; online engine + project mode warn about unsupported project imports/headers; 7 Playwright regression checks passed; versionCode 16 |
| v4.1 | y (real-device fixes + open file) | **🔴 Major fix: the entire v4.0 native bridge was broken**—the seven `@JavascriptInterface` methods `pickProjectFolder/readProject/writeProjectFile/saveFileEx/startTermSession/sendTermCmd/stopTermSession` were mistakenly placed on the `MainActivity` class body (compiles fine), but the JS bridge object is the `NativeBridge` inner class, so those methods never existed on `window.Android` → on real devices "Open folder" said "Android app only", encoding export fell back to browser mode, Termux sessions could not connect. All moved into `NativeBridge`; **new: open a single local file**—native picker (mixed folder + code-file list, tap to select) → `readSingleFile` (smart encoding detection) → `__onSingleFileLoaded` adds it to the file list (duplicate names auto-numbered); Explorer header gains "Open file"/"Open folder" buttons (alongside New file), menu gains "Open file"; **UI fixes**: overflow menu was unscrollable (`overflow:hidden` → `max-height: calc(100vh - 62px)` + `overflow-y:auto`); About tabs squeezed off-screen on narrow displays (`white-space:nowrap` → wrapping + `flex-wrap`); directory picker sorts folders first then names; file dialog extension whitelist (py/cpp/c/h/txt/md/json/java/js/html/css/xml/csv); versionCode 17 |
| v4.1.1 | z (error-mark UX) | **① Jump to the earliest error line**: marks are sorted by line number first, the cursor jumps & scrolls to the smallest line number (previously the first parse order, not necessarily earliest); the 5 s bubble shows that error too; **② editing a marked line clears its mark**: the `cm6.js` listener now passes the `update` object; `onChange` uses `changes.iterChanges` to test whether this edit touched a marked range (line-start/end dual anchors, pre-change coordinates); if touched, the line leaves the marked set (**regardless of correctness**), other marks survive with anchors remapped via `changes.mapPos` (insertions shift marks to new line numbers); when all marks clear, decorations & bubble clean up automatically; re-running/file switching still clears everything; versionCode 18 |
| v4.1.2 | z (instant stop) | **Tapping "Stop" now terminates immediately per engine, no timeout wait**: ① **online engines**—`runWandbox`/`runJudge0` fetch wired to an `AbortController` (created in `runOnlineExe`); stop calls `abort()` instantly, request cancelled & process killed, terminal prints `⏹ KeyboardInterrupt: stopped manually`; ② **JSCPP**—timeout timer promoted to global `jscppTimer`; stop immediately `terminate()`s the worker + clears the timer + resets state (previously waited the full 10 s); ③ **Termux**—previously `cancelCpp` killed the process but frontend polling had stopped so `onCppResult` never fired, wedging the run state; now the frontend immediately `finishCpp()` resets and prints the stop message; ④ **built-in Python**—cancels waiting for Pyodide load instantly (loop checks `running`); mid-execution cannot be interrupted (single-threaded), reported honestly (infinite loops: use the online engine or Termux); run kinds refined into `python/py-online/termux/cpp-online/jscpp` handled separately; versionCode 19 |
| v4.1.3 | z (runaway-output protection + temp cleanup) | **Three-layer protection for the `/sdcard/QingCode/` swap dir** (a real user hit a 614.86 MB `.stdout` from an infinite print loop): ① **runtime cap**—polling kills `.prog.pid`/`.keep.pid` the moment `.stdout` exceeds 32 MB, terminal prints `⏹ timeout exit 125 (output exceeded the 32 MB cap; stopped automatically—suspected runaway output)`;
② **auto cleanup after runs**—on build failure/run end/timeout, `.stdout/.stderr/.compile.exit/.run.exit/.prog.pid/.keep.pid/.termux.log/.pc_in/.term_out` and source copies in the swap dir are deleted (keeping `源码/` and `.app.log`); ③ **startup cleanup**—the app clears leftovers on launch (the old 615 MB `.stdout` vanishes on first open of the new version); ④ **session guard**—a Termux session auto-disconnects when `.term_out` exceeds 64 MB; `stopTermSession` refactored into `stopTermSessionInternal` (shared by the inner class and the polling thread); versionCode 20 |
| v4.1.4 | z (per-command init guide) | **"Setup ②" now shows initialization as per-command blocks**: step 2 used to be one `;`-joined compound command (`termux-setup-storage; mkdir…; pkg install…`) behind an "one-tap copy" button; now split into **7 standalone commands** (1 mirror switch + 6 init: setup-storage / mkdir / allow-external-apps / reload-settings / pkg install clang / completion echo), each in its own code block with a left number badge (`position:absolute` + `user-select:none` so numbers never get copied), executed top-to-bottom—finish one before copying the next; **"one-tap copy" removed** (long-press to copy yourself), each command has a grey hint below (tap Allow on the first permission prompt; type y at `(y/n)`); `INIT_CMD` refactored into the `INIT_CMDS` array (browser fallback prints the list too); versionCode 21 |
| v4.2 | y (bilingual UI: 中文 / English) | **First launch shows a language dialog** (logo + bilingual title, "中文"/"English" buttons; choice persisted in `localStorage('pc_lang')`; the main UI stays locked until chosen); **switch anytime after**: the overflow menu gains "🌐 语言 / Language" (dialog has "Cancel" to exit without changing); **fully bilingual UI**—new `web/i18n.js` (zh/en dictionary with 120+ keys + `t()`/`applyLang()`; static nodes driven by `data-i18n`/`data-i18n-html`/`data-i18n-title`/`data-i18n-ph` attribute replacement) covering the top bar/sidebar/welcome/terminal panel/status bar/general dialogs/Get Termux/init guide (all 7 command steps)/About tabs/every menu item & engine dropdown option, plus 20+ dynamic strings (Pyodide states, new/rename/delete dialogs, filename validation, permission guide, Termux guide, restore samples, encoding switch, autosave toggle…); switching is instant (no restart) and persists across restarts; terminal program output is not translated (stays as printed); six Playwright scenarios passed (first-launch dialog / English applies / menu switch / back to Chinese / persistence / English renders for guide+new-file+About), fixing 5 `data-i18n` attributes missing closing quotes from the bulk replace that broke `mi-rename` etc.; versionCode 22 |
