# QingCode Editor v5.4.2 · User Guide

**[中文](使用说明.md) · English**

A lightweight code editor for Android with a VSCode-style interface, built-in **Python 3.12** and **C++ (real Clang/GCC via Termux)**, plus a **free online compiler engine** (no Termux, no installation — compile and run over the network), an **interactive terminal**, fast startup and automatic dependency installation.

> Release notes for every version live in [CHANGELOG_EN.md](CHANGELOG_EN.md).

## 1. Installation

Copy `轻码编辑器-QingCode-v5.4.2.apk` to the phone and install.

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
1. "Settings → Engines & Termux" → **C++ engine** → "**Online**" (the default is JSCPP, which runs locally without stdin; online compiles with a real compiler and sends the code to Wandbox/Judge0);
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

## 4. Code intelligence

A built-in "Code Intelligence" plugin brings common IDE navigation to the phone:

- **Semantic analysis**: Command palette → "Semantic analysis" reports definition / reference / call counts and lists every symbol; **Python is backed by a real `ast` parse** (not regex guessing);
- **Type hints**: the symbol list shows function signatures (e.g. `(a: int, b: int) -> int`), inferred variable types and imported modules;
- **Errors / warnings**: syntax errors, undefined names, unused imports and duplicate definitions; error lines are also marked in red (folded blocks auto-unfold);
- **Go to definition**: put the cursor on a symbol → "Go to definition";
- **Find references**: lists every reference in the file, tap one to jump;
- **Go to implementation**: jumps to the function / class implementation (Python has no interface/implementation split, so it equals the definition);
- **Symbol search**: toolbar **🔎**, filter all symbols by name;
- **Inline docs**: the symbol list shows the first line of the docstring / comment block;
- **Call hierarchy**: with the cursor on a function name → "Call hierarchy" expands a tree of what it calls and what calls it (up to 6 levels).

> Two new toolbar buttons: **🔎 symbol search** and **⚠ errors/warnings**. Python analysis runs on the built-in Python runtime (the first use waits for it to load); **C++ is a pure-frontend heuristic** — it finds functions / classes / macros / calls and checks bracket balance, but performs no type inference. That is the honest trade-off without a clang frontend.

## 5. Feature overview

| Feature | Notes |
|---|---|
| Editor | CodeMirror 6: syntax highlighting, folding, search, Python completion, multi-cursor |
| Python | Built-in Pyodide (CPython 3.12, offline, interactive) / Termux-native Python (pip-installable) / online compile (Wandbox/Judge0); switch via the dropdown under "Settings → Engines & Termux" |
| C++ | JSCPP (default, local, no upload) / Termux real compile (interactive) / online (Wandbox primary + Judge0 backup — manual opt-in); switch via the dropdown under "Settings → Engines & Termux" |
| Files | New / rename / delete / autosave / export to Downloads |
| Terminal | Streamed output + live input line (❯ prompt, Enter sends) |

## 6. Source code

Full source lives in `QingCode-源码/` (README includes architecture notes and a one-command build script — no Gradle needed); the `licenses/` folder inside contains the **full license texts of every third-party open-source component** used (CodeMirror 6 / Pyodide / CPython / JSCPP / lodash / Emscripten / Termux / Judge0 CE / Wandbox, with a source-URL index).
