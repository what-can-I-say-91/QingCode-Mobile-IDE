# QingCode Editor v4.11 · User Guide

**[中文](使用说明.md) · English**

A lightweight code editor for Android with a VSCode-style interface, built-in **Python 3.12** and **C++ (real Clang/GCC via Termux)**, plus a **free online compiler engine** (no Termux, no installation — compile and run over the network), an **interactive terminal**, fast startup and automatic dependency installation.

## v4.11.2 Updates (z · systematic debug: 10 defects fixed)

This round ran a full sweep (front/back-end contract cross-checks + runtime smoke tests + an independent static review) and fixed:

- **"Open folder" (workspace) was completely broken**: the callback name the native side used after reading a folder was never defined on the web side, so the null-guard short-circuited — the UI did nothing after you picked a folder. It is wired up now and the project loads immediately;
- **The Run button could stay stuck on "Stop" forever**: with the C++ engine set to "Termux only" and Termux unprepared, an exception aborted the flow before the state reset, so the button never returned to "Run". Fixed;
- **The plugin API gained its three documented methods**: `writeSwapFile` / `readSwapFile` / `deleteSwapFile` were documented but never attached, so a plugin written to those docs failed on the first call;
- **Text and menu paths aligned**: the New-file dialog title used a wrong translation key (it rendered as `newfile`); the Termux setup guide still named the old menu — both now point at "Settings → Engines & Termux";
- **One initialization recipe**: the copyable manual commands now match the wizard — switch to the Tsinghua mirror and refresh the index first, then install clang;
- **The bundled source snapshot is complete**: the copy extracted to `/sdcard/QingCode/源码/` was missing the app icon resources and the JSCPP engine file, so it could not reproduce a build. Fixed;
- **Workspace loading is more complete**: `.java` / `.js` / `.html` / `.css` / `.xml` / `.csv` files now load when you open a folder (previously only `.py` / `.cpp` and friends);
- **A failed send is no longer reported as success**: when a Termux command never reaches Termux you are told immediately instead of waiting out the 60 s timeout;
- **Android 10 compatibility is kept**: the legacy-storage switch is deliberately retained and now carries a comment (Android 10 honours only that switch; removing it makes the swap directory unwritable);
- Other details: "cancel input" and "empty line" are no longer conflated, run-session directory names are unique, plugin temp files are cleaned up, a failed terminal-session start no longer leaves a polling thread behind, and dead code / orphan strings were removed;
- versionCode: 4.11.2 (38).

## v4.11.1 Updates (z · automatic installs now use the Tsinghua mirror)

- **Automatic installs switched to the Tsinghua mirror (several times faster in China)**: v4.11's background auto-install used the official Termux source, which is slow or even times out when downloading python / clang in China; the environment check now also inspects the apt mirror — if it is not Tsinghua, the install command first switches to the Tsinghua mirror and runs `apt update` to refresh the index (without refreshing, downloads still hit the official source), then installs the components; the mirror command is identical to the one in the configuration dialog wizard;
- **pip mirror automated as well**: the Python install command also switches pip to the Tsinghua PyPI mirror; if Python is already installed but pip has no mirror configured, the background guard loop fills it in automatically (a second-level idempotent command), so future `pip install` runs go through the mirror too;
- **Visible switching**: every switch / fill-in is announced in the terminal, and the check script now reports the Tsinghua-mirror status of both the apt and pip sources;
- versionCode: 4.11.1 (37).

## v4.11 Updates (y · fully automatic background maintenance for Termux engines: detect → install → retry, zero waiting)

- **No more waiting for Termux installs at startup**: the C++ (Termux) stage of the splash screen now only does "detect + kick off install" and passes immediately — previously it could block up to 5 minutes when components were missing; now a missing Python / clang triggers `pkg install` in the background and the app enters right away, with engines becoming available automatically once installed;
- **Background guard loop (recheck every 45 s)**: a new Termux-engine guard keeps watch — a failed startup check, a busy Termux, or an install broken by network loss is all retried automatically (if the install is still missing after 15 minutes the command is re-issued; dpkg is idempotent so repeats are harmless); the old behavior of "check fails at startup, then nothing happens until you tap Run and wait for the download" is gone;
- **Automatic takeover after installing Termux later**: if you install the editor first and Termux afterwards, the moment Termux is present (detected when you switch back to the app) the next guard round (≤45 s) auto-detects and installs Python / clang, and the engine dropdowns re-enable themselves — **no editor restart needed**;
- **Auto-ready when done**: when Python / clang are both ready the terminal announces "engines ready — real C++ compile and Termux Python are now available", and the guard loop stops (no resources wasted); the runtime in-script auto-install fallback is kept as a second safety net;
- versionCode: 4.11 (36).

## v4.10 Updates (y · built-in Python: true terminal-style input + force-interruptible)

- **input() in the built-in Python now works like a real terminal, line by line**: the built-in Pyodide engine has moved into a dedicated background thread (Web Worker, `web/py-worker.js`) — the prompt text of `input("prompt")` **shows up in the output area in real time first** (even without a trailing newline it is flushed before waiting for input), the cursor auto-focuses the terminal input row at the bottom, and you **type line by line, Enter to send** — exactly like C++ / Termux Python, no more popup dialogs;
- **Fixed the `NameError: name '_pi' is not defined` in the sample code**: a bug introduced by the v4.9.4 input patch (deleting temp variables also removed a module-level name the function still needed at runtime); it now uses a **factory-function closure** instead — the fixed patch is kept for the main-thread fallback mode, while Worker mode uses the native input() (handshaking directly with the terminal input row), so the patch is no longer needed there;
- **The built-in Python can finally be "Stopped"**: the program runs in its own thread; pressing "Stop" **force-terminates that thread** (`Worker.terminate()`) — even an infinite loop dies instantly — and the run state is fully reset; the engine auto-restarts on the next run (the WASM compile cache is shared across threads, so restart stays fast);
- **Cross-thread sync**: terminal input reaches Python through a `SharedArrayBuffer` + `Atomics.wait/notify` handshake channel (control word + length + up to 64 KB data area); Pyodide's `setStdin` is hooked to a blocking read-line function — Python's `input()` truly "sleeps" until the user presses Enter, zero polling, zero jank;
- **Automatic fallback**: when the environment lacks cross-thread sync (no `SharedArrayBuffer`, e.g. a browser without cross-origin isolation headers), it automatically falls back to "main thread + dialog input" mode (same behavior as v4.9.4) with no loss of functionality;
- versionCode: 4.10 (35).

## v4.9.4 Updates (z · run-channel fixes: real kill on Stop + artifact isolation + polling guards)

- **The "Stop" button now really kills processes inside Termux**: the old implementation merely enqueued one kill command into the Termux command queue — while the queue was blocked by a long-running script, the kill only got its turn after the script ended on its own, i.e. it killed nothing; every run script now embeds a **watchdog** subprocess (checking every 0.5 s): pressing Stop makes the App write a `.cancel` marker file directly into the session directory (visible across apps instantly, zero latency), and the watchdog immediately kills the compile / run / keep-alive processes, terminates the script and frees the queue;
- **Fixed the leftover cross-project artifact hazard**: v4.9.3 isolated sources and outputs per session directory, but the compiled binary still shared `$HOME/.pc_prog.out` — investigation also uncovered an older bug: **on md5 cache miss (first compile of a new program) the fresh binary was never placed on the run path, so the stale binary left by the previous run actually executed** (one of the culprits behind "runs the default project instead of the current one"; "sometimes fine" = re-running the same file hit the cache branch); binaries are now **per-session** (`pc_prog_<session>.out`), and cache writes use "temp file + atomic rename", fully avoiding ETXTBSY and half-written corruption;
- **Polling guards**: `.run.exit` must be a non-empty valid exit code (0–255) to count as finished — zero-byte or half-written files no longer trigger a bogus "exit=0 finished instantly with empty output"; if the session directory disappears unexpectedly the run is reported terminated, **never falling back to reading stale root files**;
- **Cleaner session hygiene**: session dirs bearing an `.active` marker (running or queued in Termux) are no longer wiped by startup/finish cleanup; each finished run purges only its own session directory; starting a new run auto-cancels a still-alive previous session (zombie self-healing); session dirs older than 24 h are auto-cleaned;
- **input() shows its prompt** (built-in Pyodide engine): the text inside `input("Your name: ")` now appears in the input dialog and the output area (real-terminal feel) instead of a fixed generic line;
- versionCode: 4.9.4 (34).

## v4.9.3 Updates (z · fix multi-project run crossover)

- **Fixed "with multiple C++ projects, running executes the default project instead of the current one, and sometimes it works fine"**: all runs shared one swap directory while Termux commands execute asynchronously in a queue — running projects back-to-back let the later-written file overwrite the one the earlier queued script reads, and outputs cross-contaminated; when Termux responded fast it happened to work, hence the intermittence;
- **Fix: per-run session directory isolation** — every run now creates its own `.run_<timestamp>` subdirectory holding the main file, project headers/same-dir modules, build artifacts and program output; Stop and output reading locate files via the session directory; the FIFO input pipe name is uniquified per session; historical session dirs are cleaned on next launch; the Termux Python engine gets the same fix;
- In practice: no matter how many C++ projects you have or how densely you run them, **every run always executes the code currently open in the editor**.
- versionCode: 4.9.3 (33).

## v4.9.2 Updates (z · splash slow-Termux hint)

- **Slow-Termux hint**: when the C++ (Termux) stage on the splash screen stays unfinished for 15 seconds, an amber note appears under that progress bar — **"If Termux loads slowly, open Termux manually first, then reopen this editor"** (following this noticeably speeds up a slow Termux cold start);
- The note only appears when it is actually slow: it never shows when the stage finishes normally or skips instantly (no Termux), and disappears once the stage ends or after skipping into the app.

## v4.9.1 Updates (z · settings-page polish)

- **The selected settings tab now turns blue**: light-blue text + pale blue background + blue underline, following whichever tab is active;
- **The settings header is slimmer** (41px → 35px): the back button is a fixed 28px square — **only touching the button itself exits**, no more accidental touches on the rest of the header;
- **The freed header space becomes a settings search box**: typing filters all settings items across the four tabs — tapping a button-type result runs it directly, a dropdown-type result jumps to its tab and highlights the row; aliases supported ("font" matches "字号", "clang" matches "Configure C++", "install" matches "Get Termux"); an empty-state note shows when nothing matches, and the search clears automatically when opening/closing the settings page.

## v4.9 Updates (y · full-screen Settings page + Termux-missing disable + splash skip confirm)

- **The "⋯" button is now a full-screen Settings page**: tapping "⋯" no longer opens a small dropdown — it goes straight to a full-screen settings UI; every original menu item is kept, regrouped into **four tabs: "Editor / Engines & Termux / Files / General"** (engine & compiler dropdowns, Get Termux, Configure C++/Python, terminal session, workspace, encodings, plugin manager, language, debug log, About — nothing dropped); close with the back arrow;
- **Termux detection at launch**: when Termux is not installed, **all Termux build features are cancelled** — the Termux options in the C++ / Python engine dropdowns are greyed out, and any previously saved Termux choice falls back automatically (C++ → auto, Python → built-in Pyodide); after entering the main UI the terminal and status bar show **"Termux missing — only some features available"**; tapping any Termux-dependent feature (real build / Termux Python / terminal session / interactive run) is uniformly intercepted with install guidance;
- **Persistent "Skip →" at the splash's top-right corner**: tapping it opens a confirmation dialog — "some features may be unavailable and the UI may briefly stutter; engines keep preparing in the background and become ready automatically" — "Keep waiting" stays on the splash, "Skip anyway" enters the main UI immediately while **unfinished loading / install tasks keep running in the background**;
- versionCode: 4.9 (30).

## v4.8.1 Updates (z · dual-engine splash progress bars)

- **The splash screen now shows two progress bars**: **Python engine** on top (Pyodide loading progress) and **C++ engine · Termux** below (each with its own label, percentage and status text; the C++ bar uses a green gradient and stays dimmed with "Waiting for Python…" until its turn);
- **Strict order: Termux is only built after Python is in** — once the Python engine is ready (or has failed / timed out), the C++ stage starts: it auto-detects python / clang in Termux and, when missing, **installs them automatically and waits right on the splash screen** (the bar advances in realtime, up to 5 minutes);
- **Bounded wait**: if the install exceeds 5 minutes (slow network, big packages), it shows "Still installing in background — entering app" and opens the main UI; once the background install finishes the engine status refreshes automatically; with no Termux installed the C++ bar skips instantly ("Termux not found, skipped");
- versionCode: 4.8.1 (29).

## v4.8 Updates (y · automatic Termux env maintenance + dual-tab setup dialog)

- **Every launch auto-detects and configures Termux**: after the app opens (Python runtime ready, UI & plugins loaded — non-blocking), it automatically sends detection commands to Termux in the background and **runs `pkg install -y python / clang` in the background whenever either is missing** (visible in the terminal, no popups) — just stay online, fully automatic;
- **"Configure C++ / Configure Python" dual-tab dialog**: two new three-dot-menu entries open the same dialog with top C++ / Python tabs — the C++ tab keeps the original init wizard (7 commands), the Python tab holds `pkg install -y python` + a pip Tsinghua-mirror command + engine-switch guidance; both tabs share a "Detect now & auto-configure" button that manually triggers the same detect-and-inject flow;
- **The manual wizard is a fallback only**: daily use relies on launch-time automation plus in-run-script auto-install fallbacks; the wizard remains for special cases (proxies, mirror switching);
- **Launch order unchanged**: the default Python engine is still built-in Pyodide (instant, offline); Termux detection runs in the background only after the main preparations, never slowing startup;
- versionCode: 4.8 (28).

## v4.7 Updates (y · Termux-native Python engine)

- **Termux Python becomes the third Python engine**: Menu → "Python engine" gains "**Termux Python (native · pip packages)**" alongside built-in Pyodide and online; it uses the **real CPython on your device** — any library pip-installed in Termux (including C extensions like numpy) works directly, with none of Pyodide's memory or compatibility limits;
- **Setup fully separated from C++**: installing Python does not touch the C++ init wizard — when Python is missing, the first run **auto-executes `pkg install -y python`** (one-time network, fully offline afterwards), independent of the C++ clang install;
- **Same experience as C++**: reuses the same interactive pipeline — `input()` typed line-by-line in the terminal below, streaming realtime output, Stop terminates instantly, and the 32MB runaway-output guard / timeout kill apply as well;
- **Workspace mode**: all project .py files are flattened into the swap dir before running, so same-directory modules import directly (complex package layouts: put packages under `/sdcard/QingCode/site-packages/` (with PYTHONPATH) or use Menu → "Run C++ interactively in Termux" style terminal session);
- versionCode: 4.7 (27).

## v4.6 Updates (y · splash screen + plugin manager + plugin API v2)

- **Splash screen (main UI locked until Python is ready)**: on launch the app stays on a self-made splash (logo + version + progress bar + stage status text), starts loading the Python runtime immediately with **live progress**, and **only enters the main UI once the runtime is ready** — Python runs instantly once inside, and the "frozen first seconds" are gone for good (the splash itself is the waiting UI, so compile-time CPU saturation never feels like a hang); with the v4.5 compile cache, second cold starts fly through; **on load failure or timeout (90 s)** the splash shows a "Skip loading and enter" button — you are never locked out (loading continues in the background and Python remains available afterwards);
- **Plugin manager page**: top-right menu → "🧩 Plugin manager", a full-screen page with **top tabs**: **Loaded** (one card per plugin: name/version/author/description/source file + enabled state, one-tap enable/disable, effective after restart) / **Languages** (overview of plugin-registered languages) / **Settings** (plugin system master switch, API version & plugin folder);
- **Plugin API upgraded to PCPluginAPI v2**: plugins can call `PCPluginAPI.page(tabId, { title, render })` to **add their own tabs to the plugin manager**; `register` meta gains standard `author`/`description`/`homepage`/`onUnload` fields (shown in the manager); **plugin enable/disable** added (disabled plugins remembered by filename, effective after restart); v1 plugins stay compatible unchanged;
- versionCode: 4.6 (26).

## v4.5 Updates (y · Python compile cache + bilingual docs)

- **Python runtime compile cache**: the **compiled result** of `pyodide.asm.wasm` (~10 MB) is persisted to the app's internal storage (IndexedDB); on the **next cold start the WASM compilation stage is skipped entirely** (the largest part of load time), making Python ready noticeably faster. First load shows its duration in the status bar; on cache hit it says "compile cache hit". Note: a compiled WASM module is a V8-engine internal object and can only live in the app's internal persistent storage — the effect is exactly "cached for fast reuse across cold starts". The cache key includes the file size, so it invalidates and rebuilds automatically after app upgrades.
- **All documentation now bilingual**: README, this user guide ([使用说明.md](使用说明.md) / English) and the plugin API guide all have Chinese and English versions.
- versionCode: 4.5 (25).

## v4.4 Updates (y · plugin interface reserved + first-launch speedup)

- **Plugin interface reserved (PCPluginAPI v1)**: drop a `.js` plugin into `/sdcard/QingCode/plugins/` on the phone and it loads automatically at startup. Plugins can **run other languages** (extension registration + ▶ run dispatched to the plugin's own logic) or **extend features** (register overflow-menu items, terminal output, Toast, namespaced storage, etc.). The host provides `runCapture` (run a Termux command and capture output) and `execTermux` (low-level primitive) channels. See the `plugins/` directory in the source tree for the API docs and a sample (plugins are developed by you; this release only reserves the interface).
- **First-launch speedup**: the first few seconds after opening are no longer frozen — Python preload is deferred to 3.5 s (previously it started compiling ~10 MB of WASM at 0.8 s, saturating the CPU and freezing the UI), and the startup white flash is gone.
- versionCode: 4.4 (24).

## v4.3 Updates (y · renamed to QingCode + permission-guide rework + background Termux wake)

- **Renamed to QingCode**: the former English name PocketCode collided with well-known open-source projects; the new name **QingCode** is the pinyin rendering of 「轻码」 ("light code"), so the Chinese and English names correspond exactly. The Chinese display name 「轻码编辑器」 is unchanged; package name, swap directory and docs were all synced.
- **Proactive permission requests on launch**: on open, the app walks you through the "Termux run command" dialog and then the "All files access" settings page. **Every launch re-runs the guide** until all permissions are granted; if a permission is in the system "don't ask again" state, the app opens its own settings page for manual granting.
- **Grant-return auto refresh**: returning from the settings page after enabling permissions re-probes automatically — the swap directory becomes usable immediately, no restart needed.
- **Background auto-wake of Termux**: tapping compile/run first revives the Termux service in the background, so **you no longer need to open Termux manually after the system killed it** (if your ROM still blocks it, disable battery optimization / allow autostart for Termux).
- versionCode: 4.3 (23).

## v4.2 Updates (y · bilingual UI: 中文 / English)

- **First launch shows a language dialog**: "中文" / "English", remembered afterwards;
- **Switch anytime**: overflow menu → "🌐 语言 / Language" (instant, no restart);
- **Fully bilingual UI**: menus, sidebar, terminal panel, status bar, welcome page, every dialog (new/delete/init guide/Get Termux/About tabs), engine dropdown, status and validation messages — all in both languages;
- **Program output stays as-is** (not translated);
- versionCode: 4.2 (22).

## v4.1.4 Updates (z · init guide, one command per block)

The "Environment Wizard ②" init guide no longer chains 6 commands with one copy-all button. **Each command is its own code block**:

- **7 independent commands**: Tsinghua mirror (1) + init (6: storage grant → mkdir → allow-external-apps → reload → install clang → done echo), each with a **sequence number** (numbered labels are selection-proof so they never end up in your clipboard);
- **Order is obvious**: execute top to bottom, **copy the next only after the previous finished**;
- **No more copy-all button**: long-press to copy manually; grey hint below each command (tap Allow on the first access dialog; answer `y` when `pkg install` asks `(y/n)`);
- versionCode: 4.1.4 (21).

## v4.1.3 Updates (z · runaway-output protection + temp cleanup)

If you ever see a **614 MB giant `.stdout`** under `/sdcard/QingCode/` in your file manager — that was runaway output from an infinite print loop. v4.1.3 adds triple protection, and the **first launch after install cleans up the 615 MB leftovers automatically**.

- **Runtime cap**: when program output (.stdout) exceeds **32 MB**, the process is killed immediately with `⏹ 输出超过 32MB 上限…（疑似失控输出）` — no more filling your storage;
- **Auto cleanup after each run**: every compile/run (success, failure or timeout) deletes all temp files in the swap dir (table below), keeping only the 源码/ folder and the debug log;
- **Cleanup at launch**: leftovers from previous runs are wiped when the app starts;
- **Terminal session cap**: Termux session output beyond **64 MB** disconnects the session;
- versionCode: 4.1.3 (20).

### What's inside the swap directory `/sdcard/QingCode/`?

| File/folder | What it is | Kept? |
|---|---|---|
| `源码/` | Full source code bundled with the app (since v3.3), for reference | ✅ kept |
| `.app.log` | App debug log (export via menu "Export debug logs") | ✅ kept |
| `.stdout` | **Your program's output stream** (what you see scrolling in the terminal) | 🧹 deleted after run |
| `.stderr` | Program's error stream | 🧹 deleted after run |
| `.compile.exit` | Compile exit code (0 = success) | 🧹 deleted after run |
| `.run.exit` | Run exit code (0 = normal exit) | 🧹 deleted after run |
| `.prog.pid` / `.keep.pid` | PID of the running process (used by the Stop button) | 🧹 deleted after run |
| `.termux.log` | Termux-side script trace (for debugging) | 🧹 deleted after run |
| `hello.cpp` etc. | Source copies placed in the swap dir when you tap Run (compilers need a real file path) | 🧹 deleted after run |

## v4.1.2 Updates (z · instant Stop)

- **Tapping Stop while running now terminates immediately** (ends as `⏹ KeyboardInterrupt: 已手动停止`):
  - **Online engines**: cloud request cancelled instantly (measured 1.7 s, previously waited until the cloud timeout);
  - **Built-in JSCPP**: interpreter killed instantly (measured 1.1 s, previously a fixed 10 s wait);
  - **Termux real compile**: compile/run processes killed instantly; fixed the stuck Stop button;
  - **Built-in Python**: cancelling during runtime load works; a running program cannot be force-killed due to its single-threaded nature (honestly reported; for infinite loops use the online engine or Termux);
- versionCode: 4.1.2 (19).

## v4.1.1 Updates (z · error-marker UX)

- **Jump to the earliest error line**: with multiple errors, the cursor jumps to the **smallest line number** (previously the first in compiler output order); the 5-second error bubble shows that line's reason;
- **Editing a marked line clears it immediately** (right or wrong): touching a highlighted line removes its red background and squiggle at once; untouched marks stay;
- Markers **follow line shifts** when lines are added/removed;
- All-clear state removes decorations and bubbles automatically; re-running or switching files clears everything;
- versionCode: 4.1.1 (18).

## v4.1 Updates (y · real-device fixes + open file)

- **🔴 Fixed native features dead in v4.0**: the bridge methods for workspace, encoding export and Termux session were registered in the wrong place — real devices said "only available inside the Android app" for "Open folder", export fell back to browser mode, Termux sessions failed to connect. **All fixed**; the four native v4.0 features now work on devices;
- **New "Open file"**: open a single local file (.py/.cpp/.c/.h/.txt/.md/.json/.java/.js/.html etc., auto-detects UTF-8/GBK/UTF-16); it joins the sidebar file list (duplicates get a suffix);
- **Two new buttons in the file panel**: "📄 Open file" and "📂 Open folder" next to "New file" (same entries in the overflow menu);
- **Fixed the overflow menu not scrolling** when items exceed one screen;
- **Fixed About dialog tabs squeezed** off-screen on narrow phones;
- versionCode: 4.1 (17).

## v4.0.1 Updates (z · full debug pass)

A systematic debug round over all v4.0 features — **12 fixes**, highlights:

- **Smarter completion**: candidates filtered by typed prefix — `math.fa` only suggests `fabs( / factorial(`; `#include <cma` only `cmath`;
- **Fixed `std::` member completion** (`std::co` now suggests `std::cout` etc.);
- Popup **no longer re-pops instantly** after accepting a candidate; no English candidates while typing pinyin;
- **More reliable encoding export**: UTF-16LE/BE adds a **BOM** automatically; ASCII export with Chinese now errors clearly; project autosave failures report the reason;
- **Sturdier Termux sessions**: 3 s timeout for command writes after shell exit; polling stops when the app exits;
- Misc: full-read of large files, directory-picker exception guard, "project imports unsupported" hint for online engines;
- versionCode: 4.0.1 (16).

## v4.0 Updates (x · four major features)

### ① Smart code completion
- **Real-time suggestion popup** (~0.1 s after typing), three kinds:
  - **Standard syntax/functions**: `pri` → `print(`, `ran` → `random( / randint( / randrange(`;
  - **Members of imported libraries**: after `import math`, `math.` suggests `sin( cos( sqrt( pi …` — **only libraries you actually imported**; C++ likewise with `std::` after `#include <cmath>`;
  - **Header name completion**: `#include <` lists 25 common headers;
- **Keyboard**: ↑↓ select, Tab/Enter accept, Esc close, typing filters;

### ② Open files/folders · workspace · autosave
- Overflow menu → **"📂 Open folder"**: native directory browser (/sdcard); the picked folder loads as a **project workspace** — the file tree lists its code files (.py/.cpp/.c/.h etc., up to 200);
- **Files can import each other**: Python can `import <sibling file>` (project files are injected before running); C++ `.h` headers are found too;
- **Autosave every 30 s** back to the original files; menu gains "Save all"; "Close project" exits workspace mode;
- Temporary scratch code (no workspace open) stays inside the app as before;

### ③ Selectable save encoding
- Overflow menu gains an **encoding dropdown**: UTF-8 / UTF-8 BOM / UTF-16LE / UTF-16BE / **GBK** / ASCII;
- "Export" writes in the chosen encoding — e.g. export a **GBK** `.py`/`.cpp` that opens without mojibake in old Dev-C++/Notepad on Windows;
- **Encoding auto-detection on open** (BOM → UTF-8 → GBK), old GBK files open correctly;

### ④ In-app Termux terminal session
- Overflow menu → **"Termux terminal session"**: open a persistent shell inside the app — **no app switching to Termux**;
- Type any command (`ls`, `g++`, `python`, `pkg install` …) in the bottom terminal — executed live in Termux with output streamed back;
- Tap the menu item again to end; requires Termux installed and initialized (online engines unaffected — work without Termux);

- versionCode: 4.0 (15).

> Tip: for ② ③ ④ (native picker, encoding writes, Termux session), after installing try "open folder → edit import → run", "switch to GBK and export", "run `ls` in a Termux session" once each to verify on-device behavior; smart completion works out of the box everywhere.

## v3.4 Updates (y · compile errors visualized)

- **Errors marked right in the editor** (like VSCode):
  - **whole-line red highlight** (red background + left edge bar);
  - **red squiggle** under the faulty token;
  - **error bubble** with the reason (e.g. `⛔ hello.cpp:5:9 error: expected ';'`), **auto-dismissed after 5 s**, cursor auto-scrolls to the spot;
- **All four engines covered**: Termux compile errors / online C++ errors / built-in Pyodide tracebacks (located to the failing frame) / online Python tracebacks;
- Up to 6 marks at once (the first is usually the key one); cleared on re-run or file switch;
- versionCode: 3.4 (14).

## v3.3 Updates (y · About revamp + bundled source)

- **Brand-new "About"** (menu → About):
  - Header with **app logo + version**;
  - Three tabs: **User agreement**; **Credits** (CodeMirror 6, Pyodide, JSCPP, Wandbox, Judge0, Termux); **Developer & license** (developer **冯隽熙 / Feng Junxi**; human-AI collaboration — architecture & debugging by the developer, main code by **GLM 5.3Flash**, bug fixes & performance by **DeepSeek V4.1Flash**; licensed under **MIT License**);
  - Footer note: **where the source lives**;
- **Source code bundled with the app**: packed at build time under `assets/source/` (Pyodide binaries excluded) and **auto-extracted to `/sdcard/QingCode/源码/`** on first launch or when storage permission is granted — full frontend, Java shell, build.sh, README, LICENSE and the debug signing key; builds are reproducible;
- versionCode: 3.3 (13).

## v3.2 Updates (y · new features)

- **Free online engines for C++ / Python**:
  - **Wandbox primary + Judge0 CE backup** (dual public APIs, automatic fallback) — **real compile & run** over the network, no Termux setup required;
  - Online runs are **one-shot**: `input()` / `cin` detected before submission → one dialog collects all input (no step-by-step interaction; use the Termux engine or built-in Pyodide for that);
- **Engine switch becomes dropdowns** (in the overflow menu):
  - **C++ engine**: Auto (Termux first) / Termux / Online / Built-in JSCPP;
  - **C++ compiler**: clang++ / g++;
  - **Python engine**: Built-in Pyodide (offline) / Online;
  - Choices are **remembered**; "Auto" logic: Termux if present → online if reachable → JSCPP fallback;
- **Fixed About dialog showing both Cancel and Close**: info-only dialogs now show a single Close button (previously also falsely warned "please enter a file name");
- versionCode: 3.2 (12).

## v3.1.1 Updates (z · fixes)

- **Fixed the root cause of "Termux call failed"** (proven by logs): Termux's `RUN_COMMAND` is a dangerous-level custom permission — declaring it is not enough, it must be requested at runtime. The first run now **pops the system permission dialog**; approve it and tap run again;
- **Logs saved to Downloads**: "Export debug logs" also saves `Downloads/QingCode-日志-<timestamp>.log` (and copies to clipboard);
- versionCode: 3.1.1 (10).

## v3.1 Updates (y · new feature)

- **Debug logging system** (troubleshooting superpower):
  - Menu → "**Export debug logs**" — prints the last 500 entries to the terminal and copies to clipboard;
  - Records: environment probes (Termux install / write test / all-files-access / Android version), every pre-run check, **Intent send results** (`startService` returning null means system-blocked), polling exit codes and timeouts;
  - **Termux-side traces**: script start/end are appended to `.termux.log` in the swap dir and streamed into the terminal with a `[termux]` prefix — if even `[termux] script start` doesn't appear, the request never reached Termux;
  - Logs also land on disk: `/sdcard/QingCode/.app.log`;
- versionCode: 3.1 (9).

## v3.0.5 Updates

- **Fixed "green light but still can't run"**: permission checks unified with the environment probe (both use the real write test) — previously the run path additionally demanded the "manage all files" special switch, contradicting the green light, and swallowed the real reason behind "Termux not ready";
- Run failures now show the **real reason**; permission issues trigger a "go to settings" guide automatically;
- **Permission key point**: system settings → apps → QingCode Editor → permissions → Files and media → must pick **"Allow management of all files"** ("only media access" is not enough);
- versionCode: 3.0.5 (8).

## v3.0.4 Updates

- **Observable run pipeline**: tapping ▶ immediately prints "compile request sent to Termux"; every 10 s a heartbeat shows the wait; at the 60 s timeout a **4-step diagnostic checklist** appears (check Termux error notifications → enable Termux notifications → cold-restart Termux → use "Run interactively in a Termux terminal" as a bypass);
- **Troubleshooting hint**: if tapping run does nothing, first check system settings → apps → QingCode Editor → **"display pop-up windows while running in the background"** (some vendor ROMs deny cross-app launches by default);
- versionCode: 3.0.4 (7).

## v3.0.3 Updates

- **"Environment Wizard ② one-tap init" became a guided flow**: tapping it opens a 4-step guide dialog (no longer jumps straight to Termux) —
  1. Recommended first: switch to the Tsinghua mirror (command shown, long-press to copy; **not part of the copy-all content**);
  2. Tap "Copy init commands" → open Termux, paste and run;
  3. Answer **y** at the `(y/n)` prompt;
  4. Return and re-check;
- **Explain before requesting permissions**: when "All files access" is needed, a dialog explains first; only "Go to settings" actually opens system settings;
- versionCode: 3.0.3 (6).

## v3.0.2 Updates

- **Storage permission auto-guide**: when Termux is installed but the swap dir is not writable (missing "All files access"), both "Environment Wizard ③ re-check" and C++ runs **auto-open the settings switch page**; no more silent fallback to the teaching interpreter;
- versionCode: 3.0.2 (5).

## v3.0.1 Updates

- **"Environment Wizard ① Get Termux" became a two-option dialog**:
  1. **Download from GitHub** — opens the official Releases page;
  2. **Ask the developer for the APK** — copies the developer email `19587486395@163.com` (no redirect); please state "requesting the Termux APK" in your mail;
- A Termux APK ships alongside: `Termux-v0.118.3-arm64.apk` (official GitHub build, no extra download needed);
- versionCode: 3.0.1 (4). Under the versioning rule (x=major, y=minor, z=patch) this is a patch release.

## v3.0 Updates

| Item | v2.0 | v3.0 |
|---|---|---|
| Input | pre-filled stdin panel | **interactive**: Python dialog input, C++ terminal live line input |
| C++ output | one-shot after finish | **streamed live** (watch it run) |
| Startup | 10~35 s wait on first run | **auto-preload** Python (loads in background) + WASM disk cache + **md5 compile cache** (unchanged code starts instantly) |
| Dependencies | manual Termux/clang | **auto `pkg install clang`** at compile; **Environment Wizard** (Get Termux → one-tap init → re-check) |
| Version | 2.0 (2) | **3.0 (3)** |

## 1. Installation

Copy `轻码编辑器-QingCode-v4.11.2.apk` to the phone and install.

> **First launch** shows the language dialog: "中文" / "English" — the choice is remembered; switch anytime from "**Settings → General → 🌐 语言 / Language**".

> **Permission auto-request (v4.3)**: on launch the app proactively guides you — first the "Termux run command" dialog; tap **Allow**, then the system settings page opens — enable "**All files access**" and go back (state re-probes automatically; the swap dir is usable at once). Android 10 and below request storage + RUN_COMMAND in one dialog. The guide re-runs on every launch until all permissions are granted; if it says "don't ask again", the app's own settings page opens — enable it under "Permissions".

> **Upgrade note**: the signing key changed in v3.0.1 — if v3.0 is installed, **uninstall it first** (only two sample files are lost). Since then the signature stays the same and upgrades install right over.

## 2. Quick tour

1. Opening the app preloads Python in the background (sidebar Python turns green when ready; runs start instantly);
2. Tap ▶ on `main.py` → when the program calls `input()`, **type line by line in the bottom terminal** (the prompt is printed live first, the input row auto-focuses, Enter sends);
3. After a C++ (Termux engine) run, **type in the bottom terminal input and press Enter** to interact live (`cin`/`getline` both receive it); output streams;
4. While running, ▶ becomes **Stop** — tap to force-kill (works for C++).

## 3. Real C++ compile setup

**Since v3.2, C++ has two real compile paths — pick either:**

### Option A: Online compile (zero setup, try this first)
1. "Settings → Engines & Termux" → **C++ engine** → "**Online**" (or keep "Auto" — without Termux it uses online automatically);
2. Tap ▶ — code is submitted to the Wandbox/Judge0 cloud (free public APIs) and compiled;
3. Programs with input get a pre-run input dialog (one-shot submission); requires network; no step-by-step interaction.

### Option B: Termux engine (fully offline + interactive)
"Settings → Engines & Termux" (open Settings via the top-right ⋯):

1. **Setup ① Get Termux**: dialog with two options —
   - **Download from GitHub**: opens the official Releases page;
   - **Ask the developer**: copies email `19587486395@163.com`, mail with "requesting the Termux APK" (or just install the bundled `Termux-v0.118.3-arm64.apk`);
2. **⚙️ Configure C++**: per-command guide (since v4.1.4 each command is its own numbered block; **long-press to copy yourself**, one at a time) — run 7 commands in order (① Tsinghua mirror recommended first → ② storage grant → ③ mkdir → ④ allow-external-apps → ⑤ reload → ⑥ install clang (**answer y at (y/n)**) → ⑦ done echo);
3. Tap "**Detect now & auto-configure**": the sidebar C++ turns green when ready.

> Since v4.11 **no manual setup is needed day-to-day** — the app checks python / clang on every launch and installs missing ones in the background from the Tsinghua mirror (a 45 s guard loop retries automatically and announces readiness); just stay online. The wizard above is a manual fallback.

Also grant the app "**All files access**" in system settings (since v3.0.2 missing permission auto-opens the page; manually: settings → apps → QingCode Editor → permissions → Files and media → Allow management of all files).

### Speed notes
- **Compile cache**: unchanged source reuses the previous build (md5 check) — reruns start instantly;
- **Auto dependencies**: first compile without clang auto-runs `pkg install -y clang` (only the first time, 1-3 min);
- **WASM cache**: Python engine assets ship with cache headers; since v4.5 the WASM **compile result** is persisted (IndexedDB) so the next cold start skips compilation.

### Two C++ run modes
- **In-app interactive** (default): terminal input line + streamed output;
- **Run in Termux terminal** (menu "Run C++ interactively in a Termux terminal"): full TTY inside Termux, good for long interactive programs.

> Without Termux, C++ falls back to the built-in JSCPP teaching interpreter (one-shot input dialog before run; no STL; a run error opens the setup guide).

## 4. Feature overview

| Feature | Notes |
|---|---|
| Editor | CodeMirror 6: syntax highlighting, folding, search, Python completion, multi-cursor |
| Python | Built-in Pyodide (CPython 3.12, offline, interactive) / Termux-native Python (pip-installable) / online compile (Wandbox/Judge0); switch via the dropdown under "Settings → Engines & Termux" |
| C++ | Termux real compile (interactive) or online (Wandbox primary + Judge0 backup) or JSCPP fallback; switch via the dropdown under "Settings → Engines & Termux" |
| Files | New / rename / delete / autosave / export to Downloads |
| Terminal | Streamed output + live input line (❯ prompt, Enter sends) |

## 5. Source code

Full source lives in `QingCode-源码/` (README includes architecture notes and a one-command build script — no Gradle needed).
