# 轻码编辑器 QingCode v5.4.2 · 源码说明

**中文** · [English](README_EN.md)

**中文** · [English](README_EN.md)

安卓端轻量代码编辑器：**CodeMirror 6 + Pyodide（Python WASM）+ Termux Clang/GCC（真实 C++ 编译）**，WebView 壳完全离线运行，命令行直接构建 APK（**无需 Gradle / Android Studio**）。未配置 Termux 时 C++ 自动回退内置 JSCPP 教学解释器。

**v5.0 当前亮点：编辑器插件化重构 —— 内核只保留文档 / 行号 / 撤销 / 高亮 / 错误标注，全部可选编辑能力改由「内置插件」装配（`cm6.js` 重打包 753KB，暴露 `PCCM.modules` 73 个模块 + 4 个插槽，插件增删即时生效）· PCPluginAPI 升到 v3（新增 `editor` 接口：扩展 / 命令 / 工具栏 / 语言 / 补全 / 片段 / 格式化 / 事件）· 内置插件「编辑增强」（27 条命令 + 9 个触屏工具栏按钮 + 命令面板 + 多光标模式 + 行操作 + 折叠 + 片段 + 格式化 + 补全迁移）· 高亮与运行解耦（js/json/html/css/md 可高亮）· 插件管理页可即时启停内置插件 · 插件文案全量中英 i18n。**

**v3.0 奠定的基础：交互式输入输出（非预设式）、编译器启动提速（多级缓存）、依赖自动安装。**

## 功能特性

| 功能 | 说明 |
|---|---|
| 🌍 界面双语 | 首次启动选择中文/English，右上角菜单随时切换 |
| 🐍 Python 离线运行 | 内置 Pyodide（CPython 3.12 WASM，后台 Worker 线程），`input()` 终端式逐行交互（对话框模式自动回退） |
| ⚙️ C++ 真实编译 | Termux clang++/g++ 离线编译，终端实时交互 + 流式输出 |
| ☁️ 免费在线编译 | Wandbox + Judge0 双引擎（**需在设置中手动选择**；默认 JSCPP 不上传代码） |
| 🧠 智能补全 | 关键词/已导入库成员/头文件名，前缀过滤、输入法组合作业友好 |
| 🎯 错误可视化 | 编译/运行错误整行标红 + 波浪线 + 原因气泡，自动跳转最靠前错误行，编辑即消红 |
| 📂 项目空间 | 打开文件夹整目录载入，项目内 `import`/头文件直接生效，30 秒自动保存 |
| 💾 编码可选 | 导出支持 UTF-8/BOM/UTF-16/GBK/ASCII，读取智能识别不乱码 |
| 🖥 内嵌终端会话 | 应用内直连 Termux 持久 shell，指令输出双向实时 |
| 🛡 失控输出保护 | 程序输出超 32MB 自动停止，临时文件结束即清、启动也清 |
| 🤖 引擎自动维护 | Termux Python/clang 后台守护循环：缺失→自动装（清华源）、失败→45s 自动重试、装好→自动就绪，启动零等待 |
| ⏹ 停止立即生效 | 五种运行引擎点停止立即终止，不干等超时 |
| 📋 源码随应用分发 | 关于页可查，自动释放到 `/sdcard/QingCode/源码/`（含第三方开源许可证 `licenses/`） |
| 🧩 编辑增强（内置插件） | 内核最小化 + 插件装配：多光标模式 / 行操作 / 折叠 / 缩进 / 补全 / 片段 / 格式化；触屏工具栏 + 命令面板；插件管理页可即时启停 |
| 🔐 插件安全 | 用户插件支持删除（二次确认）；启用第三方插件前提示「未经安全审核」，插件页常驻安全警告 |
| 🧠 代码理解 | 语义分析 / 类型提示 / 错误警告 / 跳转定义 / 查找引用 / 查看实现 / 符号搜索 / 内联文档 / 调用层级（Python 用 ast 真语义，C++ 启发式） |
| 🧭 导航与搜索 | 快速打开文件 · 类/方法/符号跳转 · 全局搜索替换（支持正则）· 最近文件 · 书签 |
| 🖼 壁纸 | 预设渐变 / 本地图片 / 透明度调节，持久化 |
| 🧪 插件沙箱 | 第三方插件**默认**在 Web Worker 中隔离运行（无 DOM / 原生桥 / 本地存储访问）；仅可信插件可关闭 |
| ⚙ 控制面板 | 顶栏命令搜索框（与运行同高）+ 命令面板置顶入口 + VS Code 风格控制面板（骨架） |

## 下载 APK

前往 [Releases](../../releases) 下载最新 `轻码编辑器-QingCode-v5.4.2.apk`（版本历史见下文版本表）。完整使用教程见 [使用说明.md](使用说明.md)（English: [使用说明_EN.md](使用说明_EN.md)）。

## 架构

```
┌─ WebView (appassets.local = assets/editor/) ─────────────────┐
│  CodeMirror 6 (vendor/cm6.js)  ·  i18n.js 双语  ·  底部终端     │
│      │ Pyodide (pyodide/)           │ C++ 引擎分发              │
│      └ Python 3.12 WASM             ├─ Termux 桥 → 真实 clang++ │
│        启动页加载 Python 运行时      └─ JSCPP Worker 兜底       │
└──────────────────────────────────────────────────────────────┘
          │ window.Android (JS 桥)
┌─ MainActivity ───────────────────────────────────────────────┐
│  assets 拦截（js/css 1天、wasm/zip 7天 Cache-Control + COOP/COEP）│
│  requestInput: CountDownLatch 同步对话框 → Python input() 实时交互│
│  TermuxBridge: md5 编译缓存($HOME/.pc_cache) · 缺编译器自动 pkg │
│    → mkfifo 交互管道 + sleep 保活写端 · 后台运行 + 增量轮询 stdout │
│    → emitStream 流式输出 · 终端输入行 sendCppInput 实时写管道    │
└──────────────────────────────────────────────────────────────┘
```

## 目录结构

```
QingCode-源码/
├── app/                        # Android 工程
│   ├── src/main/AndroidManifest.xml          # v3.0(3)：RUN_COMMAND 权限 + queries com.termux
│   ├── src/main/java/.../MainActivity.java   # WebView 壳 + 交互桥 + Termux FIFO 交互
│   └── src/main/res/mipmap-*                 # 应用图标
├── web/                        # 前端（= APK 内 assets，可直接本地起服务预览）
│   ├── index.html / style.css / app.js       # 底部终端 + 双语 data-i18n 标记
│   ├── i18n.js                 # v4.2 界面双语字典与切换逻辑（zh/en，120+ key）
│   ├── vendor/cm6.js           # CodeMirror 6 打包版（esbuild，753KB）
│   ├── vendor/JSCPP.js         # JSCPP 兜底引擎（esbuild 打包，含 stream/util shim）
│   ├── vendor/cpp-worker.js    # JSCPP Worker（超时可终止）
│   ├── plugins/editor-plus.js  # v5.0 内置插件「编辑增强」（多光标/行操作/折叠/片段/格式化/命令面板）
│   ├── plugins/code-intel.js   # v5.0 内置插件「代码理解」（语义分析/跳转定义/引用/调用层级，Python 用 ast）
│   ├── plugins/navigator.js    # v5.1 内置插件「导航与搜索」（快速打开/全局搜索替换/最近文件/书签）
│   ├── sandbox-worker.js       # v5.4 插件安全沙箱（Web Worker）
│   └── pyodide/                # Pyodide 0.26.4 core（CPython 3.12 标准库，5 文件）
├── build.sh                    # 一键构建（自动组装 assets → aapt2 → javac → d8 → 签名）；并生成 assets/source 源码快照（含 res 图标、vendor/JSCPP.js 与 licenses/，仅排除 Pyodide 二进制）
├── plugins/                    # v4.4 插件接口：接口说明（中/英）+ 语言插件示例骨架（插件放手机 /sdcard/QingCode/plugins/）
├── licenses/                   # 第三方开源组件许可证原文（CodeMirror / Pyodide+CPython / JSCPP / lodash / Emscripten / Termux / Judge0 / Wandbox，索引见其 README）
├── debug.keystore              # 调试签名（口令见 build.sh；缺失时构建自动生成）
├── LICENSE                     # MIT 许可证（含开发者联系方式与问题反馈邮箱）
├── README.md / README_EN.md    # 本文件：功能、架构、目录、机制、构建与二次开发
├── CHANGELOG.md / CHANGELOG_EN.md # 完整版本历史（48 个版本 + 近期详情）
├── 使用说明.md                  # 面向使用者的完整教程（安装/配置/常见问题）
├── 使用说明_EN.md               # User guide in English（与中文版内容对应）
├── .gitignore                  # GitHub 上传用（Android 模板 + 构建产物排除）
```

## 关键机制

### 1. 交互式 I/O（v3.0 核心）

| 引擎 | 交互方式 | 实现原理 |
|---|---|---|
| Python (Pyodide) | **实时**：程序执行到 `input()` 时在底部终端逐行输入（提示语实时回显，回车即发送） | v4.10 起运行在 Worker 线程：`SharedArrayBuffer` + `Atomics.wait/notify` 跨线程握手阻塞读行（零轮询）；`Worker.terminate()` 可强制中断；环境无跨域隔离时自动回退主线程 + JS 桥 `requestInput` 对话框 |
| C++ (Termux) | **实时**：流式输出 + 终端输入行逐行发送 | `mkfifo $HOME/.pc_in` 命名管道 + `sleep 100000 > fifo &` 保活写端防 EOF；程序后台运行，原生 200ms 增量轮询 `.stdout`（RandomAccessFile offset）→ `emitStream` 流式回调；前端终端输入行 `sendCppInput()` 以 `printf '%s\n' … > $HOME/.pc_in` 写入 |
| C++ (JSCPP 兜底) | **一次性**：运行前检测 `cin/scanf/getchar` 弹多行输入框整体收集 | JSCPP `drain` 为一次性输入模型，无法逐行交互（实测仅回调 1 次） |

### 2. 启动提速（v3.0）

- **启动页顺序加载**（v4.6 起，取代 v3.0 的空闲预加载）：启动页实时显示「Python → C++（Termux）」双引擎进度，Python 就绪后才进主界面、进入即可秒跑；配合 v4.5 的 WASM 编译缓存，二次冷启动跳过编译阶段；
- **WebView 资源缓存**：`shouldInterceptRequest` 对本地 assets 注入 `Cache-Control`（js/css 1 天、wasm/zip 7 天）+ `Cross-Origin-Opener-Policy/Embedder-Policy` 头，二次启动直接命中磁盘缓存，WASM 编译产物也被缓存；
- **md5 编译缓存**：C++ 源码 md5 → `$HOME/.pc_cache/<hash>`，同代码秒编译（命中缓存跳过 clang++）；
- **动态 import 修复**：相对路径 import 必须 `./` 前缀 + `new URL(base, location.href)` 解析 indexURL，确保离线本地加载而非静默回退 CDN。

### 3. 依赖自动安装（v3.0）

- 运行 C++ 时脚本自动检测 `command -v clang++`，缺失则 `pkg install -y clang`（需联网一次，之后全离线）；
- **日常无需手动配置**（v4.11 起）：启动时自动检测 python/clang，缺失即在后台用清华源安装，45 秒一轮守护循环自动重试、装好自动就绪；手动入口在「设置 → 引擎与 Termux」的 `环境向导 ① 获取 Termux` 与 `⚙️ 配置 C++`（逐条命令指引：清华源切换 + 初始化命令独立展示、带序号与说明，长按自行复制按序执行）。

### 4. Termux C++ 流程（v3.0 重写）

1. 代码写入 `/storage/emulated/0/QingCode/<文件名>`；
2. 发 `com.termux.RUN_COMMAND` Intent 执行脚本：自动装编译器 → md5 缓存命中检查 → `clang++ -std=c++17` 编译到 **$HOME 私有目录**（/sdcard noexec 不可执行）→ `mkfifo` 建管道 → 后台运行；
3. 原生 200ms 增量轮询 `.stdout` → `emitStream` 流式输出；`.compile.exit` / `.run.exit` 判定阶段；
4. 终端输入行实时写入 FIFO；`scanf`/`cin` 阻塞等待输入；
5. 超时（默认 60 秒）kill `.prog.pid` / `.keep.pid`；Termux 侧需 `allow-external-apps=true` + 授予「所有文件访问」；
6. **失控输出保护（v4.1.3）**：轮询发现 `.stdout` 超 32MB 立即杀进程并提示；编译/运行结束自动清理交换目录全部临时文件（`.stdout/.stderr/.exit/.pid/.termux.log/源码副本`，保留 `源码/` 与 `.app.log`）；App 启动亦清理上次残留；终端会话 `.term_out` 超 64MB 自动断开。

### 5. 插件化编辑器（v5.0）

内核只保留「文档 / 行号 / 撤销 / 高亮 / 错误标注 / onChange·onCursor」，其余全部走插槽：

- **`PCCM.modules`**：把 CM6 的 `state` / `view` / `language` / `commands` / `autocomplete` / `search` / `lint` / 各语言包 / `oneDark` 共 **73 个导出**交给插件，语言包不再重复打包；
- **四个 `Compartment` 插槽**：`lang`（语言）/ `font`（字号）/ `indent`（缩进）/ **`plugins`（插件扩展集）**，`PCCM.setPluginExtensions(view, exts)` 即时重配；
- **PCPluginAPI v3**：`editor` 接口提供 `addExtension` / `registerCommand` / `addToolbarButton` / `registerLanguage` / `registerCompletion` / `snippets` / `formatter` / `on`（`docChange`·`selection`·`fileOpen`），并带归属追踪，插件可被**即时卸载**；
- **内置插件加载顺序**：`web/plugins/*.js`（随 APK 打包，浏览器预览同样加载）→ 再加载 `/sdcard/QingCode/plugins/*.js` 用户插件；任一插件失败只影响自身。

## 本地预览 / 构建

```bash
# 预览（浏览器：Python 可跑，C++ 走 JSCPP 兜底，Python input() 走 window.prompt）
cd web && python3 -m http.server 8899

# 构建 APK
ANDROID_SDK_ROOT=/opt/android-sdk ./build.sh
# 产物：build/QingCode.apk（versionName 5.4.0 / versionCode 49）
```

依赖：JDK 11+、Android SDK（build-tools;34.0.0、platforms;android-34）。首次构建自动生成 `debug.keystore`（口令见 build.sh）。

## 二次开发指引

| 改动点 | 位置 |
|---|---|
| 编辑器行为/主题 | `web/app.js` `initEditor()`、`web/vendor/cm6.js` 打包源见下 |
| CM6 重新打包 | `import {python…}` 入口 + `esbuild entry.js --bundle --format=iife --global-name` 置于 `window.PCCM` |
| Termux 编译/交互脚本 | `MainActivity.java` `runCpp()` 中 script 字符串（FIFO、缓存、自动安装都在此） |
| 交互输入对话框文案/逻辑 | `MainActivity.java` `requestInput()`（CountDownLatch + AlertDialog） |
| 终端输入行 | `web/index.html` `#term-input-row`、`web/app.js` `sendTermInput()` |
| 流式轮询间隔 | `MainActivity.java` 200ms handler |
| 超时时长 | 前端 `Android.runCpp(…, 60)` 与 Termux 脚本内 `timeout 50` |
| C++ 示例代码 | `web/app.js` 顶部 `CPP_DEFAULT_CODE`（STL 交互版）/ `CPP_JSCPP_CODE`（兜底兼容版） |
| 应用名 / 版本号 | `AndroidManifest.xml`（当前 versionCode 49 / versionName 5.4.0）+ `web/app.js` `APP_VERSION` |
| 内置插件 / 编辑命令 | `web/plugins/editor-plus.js`（命令 / 工具栏 / 片段 / 格式化），经 `PCPluginAPI.v3` 的 `editor` 接口注册 |
| 插件扩展面 | `web/app.js` 的 `EditorAPI`（扩展 / 命令 / 工具栏 / 语言 / 补全 / 片段 / 格式化 / 事件）+ `PCCM.modules` |
| 界面文案双语 | `web/i18n.js` 字典（`data-i18n` 系列属性驱动）；新增界面元素时加属性 + 双语 key |
| 失控输出阈值 | `MainActivity.java` `pollTask()`（32MB）与 `termPoll`（64MB）、`cleanSwapTemp()` |

### 从零重建运行时资源

```bash
# CodeMirror 6（如需升级）
npm i codemirror @codemirror/lang-python @codemirror/lang-cpp @codemirror/theme-one-dark esbuild
# Pyodide（国内可达：jsdelivr 逐文件下载 5 个核心文件，wasm 失败可换 fastly/gcore 镜像）
curl -LO https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide-core-0.26.4.tar.bz2 && tar xjf pyodide-core-0.26.4.tar.bz2
# JSCPP（注意包名大写）
npm pack JSCPP@2.0.9 && npx esbuild lib/commonjs.js --bundle --global-name=JSCPP --format=iife \
  --alias:stream=shim-stream.js --alias:util=shim-util.js --minify -o vendor/JSCPP.js
```

## 安全说明

- **签名密钥**：仓库内的 `debug.keystore` 仅用于本地调试，口令公开。**发布 APK 必须使用私有密钥**：
  `KEYSTORE=/path/to/release.jks KEYSTORE_PASS=... ./build.sh`；用 debug 密钥签出的包只应自用。
- **第三方插件**：`/sdcard/QingCode/plugins/` 下**新出现的插件默认禁用**，需在「插件管理」中确认后启用；
  **插件默认在「🧪 沙箱」中运行**（Web Worker 内无法访问 DOM / 原生桥 / 存储）；只有对完全信任的插件才可在插件卡片上关闭沙箱改为主线程运行（需二次确认）。
- **在线编译**：C++ 默认引擎为 JSCPP（本机执行），**不会上传代码**；只有显式选择「在线编译」才会把代码发给 Wandbox/Judge0。
- **路径校验**：原生桥对插件文件名、导出文件名与项目路径做白名单 / canonical 校验，拒绝越界路径；外部链接只交给系统处理 http/https/mailto。

## 版本号规则

**版本号格式 `x.y.z`**（z=0 时可省略显示为 x.y）：

| 变更级别 | 改动位 | 示例 |
|---|---|---|
| 重构、换编译器等**大更改** | x（y、z 归零） | 2.0 → 3.0 |
| **逻辑一般更改** | y（z 归零） | 3.0 → 3.1 |
| **细节更改、轻度优化** | z | 3.0 → 3.0.1 |

> 迭代时**不更改以往文件**：历史版本 APK 保留原文件名，新版本以新文件名交付（源码目录保持最新版，历史以本表记录）。

**完整版本历史（48 个版本）见 [CHANGELOG.md](CHANGELOG.md)。**
