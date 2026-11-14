# 开发指引 · QingCode

面向想改代码 / 提 PR 的开发者。先读 `README.md` 了解功能，这里只讲工程怎么跑、怎么改、怎么验。

---

## 1. 仓库结构

本工作区同时存在两个独立工程，共用同一个手机端工作目录 `/sdcard/QingCode`：

```
QingCode-源码/
├── QingtCode-Mobile-IDE/     # 正式版（com.qingcode.editor，APK ~6.7MB）
│   ├── app/src/main/         # AndroidManifest / res / java
│   ├── web/                  # 前端（App 端 assets，浏览器可直接调试）
│   ├── tests/e2e/            # 无头浏览器 + shell 回归
│   └── build.sh              # 无 Gradle 构建脚本
└── lite轻量版/                # 轻量版（com.qingcode.lite，APK ~320KB）
```

两版的差异只在「装了什么」：正式版有 Pyodide / 插件 / SAF / 在线引擎；Lite 只有编辑器 + 固定目录 + Termux 运行。
**改 Lite 时不要引入完整版的大模块**（Pyodide、插件宿主、i18n 字典），它的体积预算就是它的卖点。

---

## 2. 架构

```
┌──────────────────────────┐        ┌────────────────────────────┐
│ WebView (web/index.html) │        │ MainActivity               │
│  · CodeMirror 6 编辑器    │  桥    │  · 文件读写 / 路径校验       │
│  · 文件树 / 标签 / 运行条 │◄──────►│  · SAF / 权限 / Toast       │
│  · 输出面板 / 问题面板    │ window │  · Termux 投递 + 输出轮询    │
└──────────────────────────┘ .Android└──────────┬─────────────────┘
                                                 │ RUN_COMMAND
                                                 ▼
                                     ┌──────────────────────────┐
                                     │ Termux（clang / python）  │
                                     │ 输出写 /sdcard/QingCode   │
                                     └──────────────────────────┘
```

三条硬约束，改代码前必须知道：

1. **应用读不到 Termux 的私有目录**。`$HOME/.pc_work`、`$HOME/.pc_cache` 只有 Termux 能读写；两边共通的只有 `/sdcard/QingCode`（应用写脚本/stdin，Termux 写 stdout/退出码）。
2. **编译产物必须放 `$HOME`**。`/sdcard` 挂载 noexec，直接运行会 permission denied。
3. **`file:///android_asset` 页面不能发网络请求**。CSP 里 `connect-src` 只放行在线编译白名单；新增外部服务必须同时改 `index.html` 的 CSP 与 `MainActivity` 的网络权限，否则会被静默拦截。

---

## 3. 本地环境

| 依赖 | 版本 | 说明 |
|---|---|---|
| JDK | 17 | `javac --release 8` 出包 |
| Android SDK | build-tools 34.0.0 + platforms/android-34 | 只需这两个目录，不需要 Gradle |
| Node.js | 18+ | 跑 CDP 回归（内置 WebSocket，无需装包） |
| Python | 3.9+ | 仅用于起静态服务 |
| 浏览器 | Edge / Chrome | 无头模式跑前端用例 |

```bash
export JAVA_HOME=/path/to/jdk17
export ANDROID_SDK_ROOT=/path/to/android-sdk
export PATH="$JAVA_HOME/bin:$PATH"
```

## 4. 构建

```bash
cd QingtCode-Mobile-IDE
sh build.sh                     # 产物 build/QingCode.apk（调试签名）
RELEASE=1 KEYSTORE=... KEYSTORE_PASS=... sh build.sh   # 发布签名
```

`build.sh` 做六件事：同步 `web/` → `assets/editor/`、打包源码快照 → `assets/source/`、aapt2 编译链接、javac、d8、zipalign + apksigner。

两个坑：

- **中文/空格路径**：aapt2 走 ANSI 路径 API 会报 “failed to open directory”，所以脚本先 `cd "$PROJ"` 再用相对路径调用。
- **沙箱里的 `rm -rf`**：某些环境把它包成回收站操作，删 `assets/source` 会失败并中断构建；用 `find app/src/main/assets/source -mindepth 1 -delete` 再 `rmdir`。

## 5. 前端开发

### 5.1 直接跑浏览器

```bash
cd web && python -m http.server 8765
# 打开 http://127.0.0.1:8765/index.html
```

没有 `window.Android` 时，Lite 会自动装内存 mock；正式版需要手动注入最小桥（见 `tests/e2e/e2e-security.mjs` 的 `window.Android = {}`）。**所有涉及原生的分支都要能在无桥时降级**，否则浏览器里调不了。

### 5.2 编辑器接口（PCCM）

`web/vendor/cm6.js` 是对 CodeMirror 6 的二次打包，暴露 `window.PCCM`：

| 调用 | 用途 |
|---|---|
| `PCCM.create(el, {doc, lang, fontSize, onChange, onCursor})` | 建编辑器，返回 view |
| `PCCM.setDoc(view, text, lang?)` | 换文档（同时换语言） |
| `PCCM.setLang(view, 'cpp'\|'python'\|...)` | 只换高亮语言，传 `null` 关闭高亮 |
| `PCCM.markErrors(view, errs)` / `clearErrors(view)` | 行标红 + 波浪线，`errs` 需带 `line/col/message/anchor/anchorEnd` |
| `PCCM.modules` | 底层 CM6 模块（`EditorView`/`EditorState`/`EditorSelection`…） |

模块是 `web/vendor/cm6.js` 打包进去的，**新增语言或扩展必须改打包源再重新生成，不要手改 vendor 文件**。

### 5.3 状态与持久化

- `state.files` 是唯一文件真相，`content === null` 表示「惰性未加载」，用 `ensureContent(f)` 补读。
- `_saved` 记录上次落盘内容，`content !== _saved` 即脏；`_sig` 是磁盘 `size+mtime` 签名，用于外部修改冲突检测。
- 元数据 / 草稿在 IndexedDB（`DraftStore` / `WsMeta`），**不要把文件内容写进 localStorage**。
- 切换文件前用 `captureViewState()` 存选区与滚动，回来用 `restoreViewState()`。

### 5.4 新增文案

`web/i18n.js` 一份字典两套语言，**必须同时加 `zh` 和 `en`**，键名小写下划线。测试 `e2e-core.mjs` 有一条断言检查新增键是否中英齐。

## 6. 原生桥

### 6.1 加一个方法

```java
@JavascriptInterface
public String doSomething(String rel) { ... }   // 返回值建议 JSON 字符串
```

规则：

1. **路径必须过 `safeRelativePath()`**，再 `getCanonicalPath()` 校验没有越出工作区。
2. **失败要返回原因**，不要只返回 boolean——前端没有日志可看。
3. **JS 侧调用要包 try/catch**：桥方法抛异常在 JS 里表现为 `undefined`。
4. **不要在主线程做重活**：文件遍历、`readChunk`、Termux 投递都在子线程或轮询里做。

### 6.2 SAF（正式版）

工作区路径是令牌 `saf:<id>`，`safSplit()` 拆令牌与相对路径，`safDocId()` 逐段按 displayName 解析（**绝不拼 documentId**），写入用「临时文件 + 替换」。新增任何文件操作都要同时处理普通路径与 SAF 两条分支——`statFile` 就是因为漏了 SAF 分支导致冲突检测失效。

### 6.3 Termux 运行链路

```
JS run() → buildScript() 拼 shell → RUN_COMMAND 投递
        → 轮询 .qc/run.log（增量）+ .qc/exit（退出码）→ __qcEvent 回传
```

要点：

- 脚本里的路径一律 `q()` 单引号转义（文件名可能含空格/中文/单引号）。
- `$!` 必须是**程序本身**的 pid，停止才有效；不要用 `timeout ... &`，那样拿到的是 timeout 的 pid。
- 退出码文件必须**最后**写，否则前端可能在最后一行日志落盘前就结束。
- 输出轮询单次读取有上限（正式版 64KB / Lite 64KB），不要改回「一次读完整文件」。

## 7. 测试

```bash
cd QingtCode-Mobile-IDE
sh tests/e2e/run.sh                 # 全部：e2e-core(13) + e2e-security(13) + termux-quoting(6)
sh tests/e2e/run.sh e2e-core.mjs    # 只跑一套
sh tests/e2e/termux-quoting.sh      # 单独跑 shell 用例
```

Lite：

```bash
cd lite轻量版
sh tests/e2e/run.sh                 # e2e-lite(14)
sh tests/e2e/termux-run.sh          # Termux 脚本逻辑(11)，含超时/编译失败/中文名
```

写用例的套路：

- 无头浏览器用例用 CDP `Runtime.evaluate` 直接调页面函数，断言 `check(name, ok, extra)`。
- 有 UI 状态的断言**要看真实可见性**（`getComputedStyle` / `getBoundingClientRect` / `elementFromPoint`），只查 `el.hidden` 会漏掉 CSS 覆盖 `hidden` 这类 bug。
- Termux 脚本逻辑用假编译器跑真 shell；`termux-run.sh` 里的 `gen_script` 是 Java `buildScript()` 的逐行镜像，**改 Java 脚本必须同步改它**。
- 每套用例独立浏览器 profile，建在系统临时目录（`/tmp/qc-e2e-*`），跑完自动清理；即使删不掉也只留在临时目录，不会污染仓库。
- 用例最后必须打印 `== 套件名: N passed, M failed ==` 汇总行：`run.sh` 会校验这一行，缺了就判失败——
  防止 CDP 目标失效导致进程静默退出（退出码 0 但一条用例都没跑）。三套前端用例另有 120 秒看门狗。

## 8. 性能守则

| 场景 | 做法 |
|---|---|
| 打开大文件 | `>800KB` 关闭语法高亮（正式版 `isBigFile()`，Lite `512KB` 直接判 length） |
| 日志 / 输出 | 增量 append，不要每次重写全量文本；条数上限 500 |
| 全局搜索 | 分片补读（每片 8 个文件），不要同步遍历整个项目 |
| 原生读文件 | 单次 ≤64KB，靠 offset 续读 |
| 切换文件 | 用 viewState 恢复，不要重建 EditorView |
| 高频 UI 更新 | `requestAnimationFrame` 合并（光标位置已有） |

## 9. 发版流程

1. 改版本号：`AndroidManifest.xml`（versionCode +1、versionName）、`web/app.js` 的 `APP_VERSION`、`web/index.html` 的 `#splash-ver`。
2. 写 `CHANGELOG.md` / `CHANGELOG_EN.md`：顶部新条目 + 「完整版本表」加一行（表是**降序**，新的加在最前）。
3. 同步 `README.md` / `README_EN.md`（标题、APK 文件名、构建输出注释、版本表描述）与 `使用说明.md` / `使用说明_EN.md`。
4. 跑全量回归，`sh build.sh` 出包，确认 `apksigner verify` 通过。
5. 发布签名必须用私有 keystore；`RELEASE=1` 且用 `debug.keystore` 时 `build.sh` 会直接拒绝。

版本号规则：`x.y.z` —— 重构/换引擎升 x，逻辑一般更改升 y，细节修复升 z。

## 10. 常见坑

| 现象 | 原因 / 处理 |
|---|---|
| 构建报 “failed to open directory” | 项目路径含中文，aapt2 需相对路径调用 |
| `git diff` 整个文件都变了 | 行尾被改成 LF；`.md`/`.java` 保持 CRLF，`.sh` 保持 LF |
| 抽屉/面板「关了还在」 | CSS `display:flex` 盖掉 `hidden`，需要 `[hidden]{display:none!important}` |
| 页面白屏、返回键也退不出 | 前端 JS 崩了；原生用 `pageReady` 判断，页面没就绪时走系统默认返回 |
| 用例全绿但真机出错 | 断言只查了状态属性，没查可见性/真实文件 |
| 无头浏览器启动失败 | 端口被占用或上一个 profile 没清；删 `tests/e2e/.e2e-prof` |
| Termux 首次运行卡住 | 正在 `pkg install clang`，看输出面板日志；超时上限 1–3 分钟 |

## 11. Lite 与正式版的同步原则

- **只在 Lite 做性能/稳定性取舍时对照正式版**：分块读取、增量日志、大文件降级、缓存，这些改法可以互相抄。
- **不要把 Lite 的功能往正式版搬**（它本来就是子集）；也不要把 Pyodide/插件/SAP 搬进 Lite。
- 两版的 Termux 脚本思路一致但独立实现：正式版有会话隔离、缓存、私有副本；Lite 只有最小可运行链路。改一边不必改另一边，但**语法与转义规则要一致**。
