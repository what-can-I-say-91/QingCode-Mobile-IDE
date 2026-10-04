# 轻码编辑器 QingCode v4.2 · 源码说明

**中文** · [English](README_EN.md)

安卓端轻量代码编辑器：**CodeMirror 6 + Pyodide（Python WASM）+ Termux Clang/GCC（真实 C++ 编译）**，WebView 壳完全离线运行，命令行直接构建 APK（**无需 Gradle / Android Studio**）。未配置 Termux 时 C++ 自动回退内置 JSCPP 教学解释器。

**v4.2 当前亮点：界面双语（首启选择中文/English，菜单随时切换）· 交换目录失控输出保护（32MB 上限 + 自动清理）· 免费在线编译引擎（Wandbox/Judge0 双兜底）· 项目空间（打开文件夹 + 自动保存）· 智能补全 · 错误行标注跳转与编辑消红 · 停止立即生效 · 保存编码可选（含 GBK）。**

**v3.0 奠定的基础：交互式输入输出（非预设式）、编译器启动提速（多级缓存）、依赖自动安装。**

![智能补全](截图/v4.0-智能补全.png)
![交互终端](截图/v3.0-交互终端.png)

## 功能特性

| 功能 | 说明 |
|---|---|
| 🌍 界面双语 | 首次启动选择中文/English，右上角菜单随时切换 |
| 🐍 Python 离线运行 | 内置 Pyodide（CPython 3.12 WASM），`input()` 弹窗实时交互 |
| ⚙️ C++ 真实编译 | Termux clang++/g++ 离线编译，终端实时交互 + 流式输出 |
| ☁️ 免费在线编译 | Wandbox + Judge0 双引擎兜底，零配置联网即用 |
| 🧠 智能补全 | 关键词/已导入库成员/头文件名，前缀过滤、输入法组合作业友好 |
| 🎯 错误可视化 | 编译/运行错误整行标红 + 波浪线 + 原因气泡，自动跳转最靠前错误行，编辑即消红 |
| 📂 项目空间 | 打开文件夹整目录载入，项目内 `import`/头文件直接生效，30 秒自动保存 |
| 💾 编码可选 | 导出支持 UTF-8/BOM/UTF-16/GBK/ASCII，读取智能识别不乱码 |
| 🖥 内嵌终端会话 | 应用内直连 Termux 持久 shell，指令输出双向实时 |
| 🛡 失控输出保护 | 程序输出超 32MB 自动停止，临时文件结束即清、启动也清 |
| ⏹ 停止立即生效 | 五种运行引擎点停止立即终止，不干等超时 |
| 📋 源码随应用分发 | 关于页可查，自动释放到 `/sdcard/QingCode/源码/` |

## 下载 APK

前往 [Releases](../../releases) 下载最新 `轻码编辑器-QingCode-v4.2.apk`（版本历史见下文版本表）。完整使用教程见 [使用说明.md](QingCode-使用说明.md)。

## 架构

```
┌─ WebView (appassets.local = assets/editor/) ─────────────────┐
│  CodeMirror 6 (vendor/cm6.js)  ·  i18n.js 双语  ·  底部终端     │
│      │ Pyodide (pyodide/)           │ C++ 引擎分发              │
│      └ Python 3.12 WASM             ├─ Termux 桥 → 真实 clang++ │
│        空闲预加载(boot+800ms)        └─ JSCPP Worker 兜底       │
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
│   ├── vendor/cm6.js           # CodeMirror 6 打包版（esbuild，560KB）
│   ├── vendor/JSCPP.js         # JSCPP 兜底引擎（esbuild 打包，含 stream/util shim）
│   ├── vendor/cpp-worker.js    # JSCPP Worker（超时可终止）
│   └── pyodide/                # Pyodide 0.26.4 core（CPython 3.12 标准库，5 文件）
├── build.sh                    # 一键构建（自动组装 assets → aapt2 → javac → d8 → 签名）
├── debug.keystore              # 调试签名（口令见 build.sh；缺失时构建自动生成）
├── LICENSE                     # MIT 许可证（含开发者联系方式与问题反馈邮箱）
├── 使用说明.md                  # 面向使用者的完整教程（安装/配置/常见问题）
├── .gitignore                  # GitHub 上传用（Android 模板 + 构建产物排除）
└── 截图/                       # v1.0 ~ v3.4 界面截图
```

## 关键机制

### 1. 交互式 I/O（v3.0 核心）

| 引擎 | 交互方式 | 实现原理 |
|---|---|---|
| Python (Pyodide) | **实时**：程序执行到 `input()` 即弹输入对话框，回显后继续 | `setStdin` → JS 桥 `requestInput`（`CountDownLatch` 阻塞 UI 线程弹 `AlertDialog`，回车后释放） |
| C++ (Termux) | **实时**：流式输出 + 终端输入行逐行发送 | `mkfifo $HOME/.pc_in` 命名管道 + `sleep 100000 > fifo &` 保活写端防 EOF；程序后台运行，原生 200ms 增量轮询 `.stdout`（RandomAccessFile offset）→ `emitStream` 流式回调；前端终端输入行 `sendCppInput()` 以 `printf '%s\n' … > $HOME/.pc_in` 写入 |
| C++ (JSCPP 兜底) | **一次性**：运行前检测 `cin/scanf/getchar` 弹多行输入框整体收集 | JSCPP `drain` 为一次性输入模型，无法逐行交互（实测仅回调 1 次） |

### 2. 启动提速（v3.0）

- **Pyodide 空闲预加载**：界面就绪 800ms 后后台 `loadPyodide`，点运行时秒出结果（冷启动实测约 12 秒完成加载，预加载后接近 0 等待）；
- **WebView 资源缓存**：`shouldInterceptRequest` 对本地 assets 注入 `Cache-Control`（js/css 1 天、wasm/zip 7 天）+ `Cross-Origin-Opener-Policy/Embedder-Policy` 头，二次启动直接命中磁盘缓存，WASM 编译产物也被缓存；
- **md5 编译缓存**：C++ 源码 md5 → `$HOME/.pc_cache/<hash>`，同代码秒编译（命中缓存跳过 clang++）；
- **动态 import 修复**：相对路径 import 必须 `./` 前缀 + `new URL(base, location.href)` 解析 indexURL，确保离线本地加载而非静默回退 CDN。

### 3. 依赖自动安装（v3.0）

- 运行 C++ 时脚本自动检测 `command -v clang++`，缺失则 `pkg install -y clang`（需联网一次，之后全离线）；
- 菜单「环境向导」三步：`获取 Termux` → `初始化`（**逐条命令指引**：清华源切换 + 5 条初始化命令独立展示、带序号与说明，用户长按自行复制按序执行，配置 allow-external-apps + 装 clang）→ `重新检测`。

### 4. Termux C++ 流程（v3.0 重写）

1. 代码写入 `/storage/emulated/0/QingCode/<文件名>`；
2. 发 `com.termux.RUN_COMMAND` Intent 执行脚本：自动装编译器 → md5 缓存命中检查 → `clang++ -std=c++17` 编译到 **$HOME 私有目录**（/sdcard noexec 不可执行）→ `mkfifo` 建管道 → 后台运行；
3. 原生 200ms 增量轮询 `.stdout` → `emitStream` 流式输出；`.compile.exit` / `.run.exit` 判定阶段；
4. 终端输入行实时写入 FIFO；`scanf`/`cin` 阻塞等待输入；
5. 超时（默认 60 秒）kill `.prog.pid` / `.keep.pid`；Termux 侧需 `allow-external-apps=true` + 授予「所有文件访问」；
6. **失控输出保护（v4.1.3）**：轮询发现 `.stdout` 超 32MB 立即杀进程并提示；编译/运行结束自动清理交换目录全部临时文件（`.stdout/.stderr/.exit/.pid/.termux.log/源码副本`，保留 `源码/` 与 `.app.log`）；App 启动亦清理上次残留；终端会话 `.term_out` 超 64MB 自动断开。

## 本地预览 / 构建

```bash
# 预览（浏览器：Python 可跑，C++ 走 JSCPP 兜底，Python input() 走 window.prompt）
cd web && python3 -m http.server 8899

# 构建 APK
ANDROID_SDK_ROOT=/opt/android-sdk ./build.sh
# 产物：build/QingCode.apk（versionName 4.2 / versionCode 22）
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
| 应用名 / 版本号 | `AndroidManifest.xml`（当前 versionCode 22 / versionName 4.2）+ `web/app.js` `APP_VERSION` |
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

## 版本号规则与历史

**版本号格式 `x.y.z`**（z=0 时可省略显示为 x.y）：

| 变更级别 | 改动位 | 示例 |
|---|---|---|
| 重构、换编译器等**大更改** | x（y、z 归零） | 2.0 → 3.0 |
| **逻辑一般更改** | y（z 归零） | 3.0 → 3.1 |
| **细节更改、轻度优化** | z | 3.0 → 3.0.1 |

> 迭代时**不更改以往文件**：历史版本 APK 保留原文件名，新版本以新文件名交付（源码目录保持最新版，历史以本表记录）。

| 版本 | 级别 | 要点 |
|---|---|---|
| v1.0 | x（初版） | Monaco + Pyodide + JSCPP，WebView 壳，命令行构建 |
| v2.0 | x（换编辑器/编译器） | 编辑器换 CodeMirror 6，C++ 换 Termux 真实编译，JSCPP 降为兜底 |
| v3.0 | x（交互重构） | **交互式 I/O（对话框/终端输入行/流式输出）、启动提速（预加载+缓存头+md5 编译缓存）、依赖自动安装 + 环境向导** |
| **v3.0.1** | z（细节优化） | **「获取 Termux」双选项对话框**（GitHub 下载 / 复制开发者邮箱 19587486395@163.com）；新增 `copyText` 原生桥；versionCode 4。签名密钥自此固定于 `debug.keystore`（口令见 build.sh） |
| **v3.0.2** | z（细节优化） | **存储权限自动引导**：重新检测 / 运行 C++ 时若 Termux 已装但交换目录不可写，自动弹转系统「所有文件访问」设置页（此前 `openAllFilesAccess` 桥无前端入口，会静默降级 JSCPP）；versionCode 5 |
| **v3.0.3** | z（细节优化） | **初始化指引化**：「环境向导 ②」改为先弹 4 步指引对话框（不再直接跳 Termux）：清华源切换命令（仅展示，长按手动复制，不进一键复制）→ 复制初始化命令 → 粘贴执行 → **(y/n) 输入 y 确认** 提示；权限请求前先弹说明对话框（「前往设置开启」确认后才跳系统设置页）；versionCode 6 |
| **v3.0.4** | z（细节优化） | **运行链路可观测**：点运行后立即输出「已发送编译请求」，每 10s 心跳显示等待时长；超时 stderr 改为 4 步诊断清单（Termux 错误通知 / 通知权限 / 冷重启 / 终端直跑绕行）；versionCode 7 |
| **v3.0.5** | z（细节优化） | **修复 setup 判定不一致**：运行前 `ensureStorageAccess` 与环境检测统一为「实际写入测试」为准（此前运行额外强制 `isExternalStorageManager`，与检测绿灯矛盾导致误拦）；`cppJson` 补 `message` 字段，setup 失败真实原因（被吞 → 恒显示「Termux 未就绪」）可透传到终端；失败涉及权限时自动弹「前往设置开启」引导；versionCode 8 |
| **v3.1** | y（新增日志功能） | **调试日志系统**：原生关键路径全量落日志（getEnv/权限状态/写文件/`startService` 返回值/轮询退出码/超时，内存环形 500 条 + `/sdcard/QingCode/.app.log` 文件）；Termux 侧脚本执行留痕（`.termux.log`，轮询增量透出 `[termux]` 前缀）；菜单新增「导出调试日志（排障）」一键输出+复制；新增 `getLogs`/`appendLog` 桥；versionCode 9 |
| **v3.1.1** | z（细节优化） | **修复 SecurityException 根因**：日志实证 `RUN_COMMAND` 为 dangerous 级自定义权限，仅 manifest 声明不够——`runCpp`/`runInTermuxTerminal` 前增加运行时 `requestPermissions` 授权（未授权时弹系统窗口并提示，批准后重试即可）；日志导出增加「保存到下载文件夹」（`Downloads/QingCode-日志-<时间戳>.log`，`exportLogs` 桥）；versionCode 10 |
| **v3.1.2** | z（细节优化） | **轮询快照排障增强**：编译/运行轮询每 5s 在日志中记录 `poll#N` 文件快照（交换目录产物大小与 `.termux.log` 增量偏移），Termux 侧 start/end 留痕；`cppJson` 透出真实 stderr 原因；versionCode 11 |
| **v3.2** | y（新增在线编译引擎） | **C++/Python 各加免费在线引擎（Wandbox 主 + Judge0 CE 备，双引擎自动兜底）**：无需 Termux 即可真实编译运行，运行前检测输入语句预填 stdin（一次性提交，不支持逐步交互）；**引擎切换改下拉菜单**（C++ 引擎 auto/Termux/在线/JSCPP、编译器 clang++/g++、Python 引擎 Pyodide/在线，选择持久化并即时提示）；**修复「关于」双按钮**：对话框加 `showCancel` 控制，纯信息对话框（关于/Termux 指引）只显示「关闭」且确定后直接收起（此前残留上一次 modalMode 误入文件名校验分支，导致「取消+关闭」同时出现且关闭报「请输入文件名」）；versionCode 12 |
| **v3.3** | y（关于改版 + 源码随应用分发） | **「关于」全新改版**：logo + 版本号 + 三个选项卡（**用户协议** / **使用项目及致谢**（CodeMirror 6、Pyodide、JSCPP、Wandbox、Judge0、Termux）/ **开发者信息及开源协议**（开发者冯隽熙；GLM 5.3Flash 主代码、DeepSeek V4.1Flash 修复 bug 与性能优化；采用 **MIT License**，随源码附 LICENSE 文件））；**源代码随应用分发**：构建时打包到 `assets/source/`（排除 Pyodide 二进制与截图），启动/授权后自动释放到 **`/sdcard/QingCode/源码/`**（`.version` 标记按版本增量更新），「关于」底部告知释放路径与状态（新增 `sourcesReady` 桥）；versionCode 13 |
| **v3.4** | y（编译错误可视化标注） | **编译/运行错误直接标进编辑器**：错误输出解析（GCC/Clang `file:line:col: error:` 与 Python Traceback 最后帧）→ **整行问题代码红色高亮**（红底 + 左侧红边条）+ **错误语法/函数下红色波浪线**（自动圈选所在单词）+ **错误处文字泡显示原因**（5 秒自动消失，光标自动滚动定位到错误处）；覆盖全部引擎：Termux 编译失败、在线 C++ 编译错误、内置 Pyodide 异常、在线 Python Traceback（每处最多标 6 个，运行/切文件自动清除）；实现：`cm6.js` bundle 内注入 `StateEffect`/`StateField`/`Decoration` 错误标注模块并暴露 `PCCM.markErrors/clearErrors`；versionCode 14 |
| **v4.0** | x（全面升级 · 四大功能） | **① 智能补全**：输入实时弹出候选浮层（120ms debounce），三类场景——标准语法/关键词补全（`pri`→`print(`）、**已成功导入库的成员补全**（`import math` 后 `math.`→sin/cos/sqrt… 共 20 项；`#include <cmath>` 后 `std::` 补全；import/from/#include 正则扫描已导入库）、头文件名补全（`#include <`→25 个常用头）；↑↓ 选择 / Tab 或 Enter 采纳 / Esc 关闭，capture 阶段键盘拦截不影响正常编辑；**② 项目空间**：菜单「打开文件夹」原生目录浏览器（`CountDownLatch` + `AlertDialog` + `ListView`）选定后递归载入全部代码文件（≤200 个/个≤1MB）为项目，文件树显示相对路径、标题栏进入项目模式、**Python `import` 项目内模块自动生效**（运行前 Pyodide `FS.writeFile` 注入虚拟 FS / Termux 头文件写入交换目录）、**每 30 秒自动保存**全部修改回原路径；**③ 保存编码可选**：菜单编码下拉（UTF-8 / UTF-8 BOM / UTF-16LE / UTF-16BE / **GBK** / ASCII），「导出」按所选编码写文件（原生 `encodeBytes` 六编码），读取智能检测（BOM 优先 → UTF-8 严格解码 → GBK 回退，中文不乱码）；**④ 应用内 Termux 终端会话**：菜单「Termux 终端会话」在应用内直连 Termux 开持久 shell（前台不切换 App）——FIFO（`$HOME/.pc_term_in`，写端 `sleep 86400` 保活）+ 交换目录 out 文件 200ms 增量轮询，**指令与输出双向实时回传**，命令 base64 编码经 RUN_COMMAND 写入避免转义问题；新桥：`pickProjectFolder/readProject/writeProjectFile/saveFileEx/startTermSession/sendTermCmd/stopTermSession/encodeBytes/readFileSmart`；versionCode 15 |
| **v4.0.1** | z（全面 debug 修复） | **前端 6 项**：①成员补全按已输入前缀过滤（`math.fa`→只弹 fabs(/factorial(，此前弹全表）；②采纳补全后浮层不再立即重弹（`applySuppressPos` 抑制 + 继续输入恢复）；③`std::` 作用域成员补全修复（成员正则只认 `.` 不认 `::`，此前 `std::co` 永远无法弹出 std 表）；④`#include <` 头文件补全同样补上前缀过滤（`cma`→cmath）；⑤中文输入法组合中（`cm.composing`）不再弹英文候选；⑥补全浮层在矮视口下 top 加 `Math.max(4,…)` 防负坐标；项目文件保存失败（如 ASCII 含中文）时终端明确输出失败数与原因提示。**原生 6 项**：⑦`readAllBytes`/`readFile` 单次 `read()` 改循环读满（大文件理论截断风险）；⑧UTF-16LE/BE 导出加 BOM（此前导出文件回读必乱码）；⑨ASCII 含中文改为明确报错提示（此前静默变 `?` 损坏内容）；⑩项目目录对话框 `show()` 失败时 `countDown` 防 JS 桥线程卡 180 秒；⑪`sendTermCmd` 包 `timeout 3`（shell 退出后 FIFO 无读端会永久阻塞）；⑫`onDestroy` 停 Termux 轮询线程、Pyodide 注入改用标准 `FS.analyzePath`；在线引擎 + 项目模式运行时提示暂不支持项目内 import/头文件；Playwright 回归实测 7 项全过；versionCode 16 |
| **v4.1** | y（真机反馈修复 + 打开文件） | **🔴 重大修复：v4.0 原生桥全部断裂**——`pickProjectFolder/readProject/writeProjectFile/saveFileEx/startTermSession/sendTermCmd/stopTermSession` 七个 `@JavascriptInterface` 方法误加在 `MainActivity` 类主体（编译可过），而 JS 桥对象是 `NativeBridge` 内部类，`window.Android` 上根本不存在这些方法 → 真机上「打开文件夹」提示「仅安卓应用内可用」、编码导出走浏览器降级、Termux 会话无法连接。全部移入 `NativeBridge`；**新增打开单个本地文件**：原生选择器（目录+代码文件混合列表，点文件即选）→ `readSingleFile`（智能编码识别）→ `__onSingleFileLoaded` 加入文件列表（重名自动加序号），资源管理器头部新增「打开文件」「打开文件夹」按钮（与新建文件并排），菜单同步加「打开文件」；**UI 修复**：更多菜单内容超屏不可滚动（`overflow:hidden` → `max-height: calc(100vh - 62px)` + `overflow-y:auto`）；「关于」三个选项卡在窄屏被挤出（`white-space:nowrap` → 允许换行 + `flex-wrap`）；目录选择器列表按「目录在前+名称排序」，文件对话框扩展名白名单（py/cpp/c/h/txt/md/json/java/js/html/css/xml/csv）；versionCode 17 |
| **v4.1.1** | z（错误标注交互优化） | **① 跳转到最靠前的错误行**：标注前按行号排序，光标自动跳转 + 滚动定位到行号最小的错误（此前跳的是解析输出顺序的第一个，不保证最靠前），5 秒错误泡也显示该行错误；**② 编辑标红行立即消红**：`cm6.js` 监听器回调加传 `update` 对象，`onChange` 里用 `changes.iterChanges` 判断本次编辑是否触及标红行区间（行首/行尾双锚点，变更前坐标系求交），触及即从标红集合移除该行（**不论改对改错**），其余标红保留且锚点经 `changes.mapPos` 随增删行自动偏移（增行后标红跟随到新行号）；标红全部清完后自动清理装饰与错误泡；重新运行/切换文件仍清全部标红；versionCode 18 |
| **v4.1.2** | z（停止立即生效） | **运行中点「停止」按引擎立即终止，不再等超时**：①**在线引擎**——`runWandbox`/`runJudge0` fetch 接入 `AbortController`（`runOnlineExe` 统一创建），点停止立即 `abort()`，请求取消、进程终止，终端输出非实质错误 `⏹ KeyboardInterrupt: 已手动停止`；②**JSCPP**——超时计时器提为全局 `jscppTimer`，点停止立即 `terminate()` Worker + 清计时器 + 状态复位（此前只能干等 10 秒超时）；③**Termux**——此前 `cancelCpp` 杀进程后前端轮询已停、`onCppResult` 永不到达导致运行状态卡死，现停止后前端立即 `finishCpp()` 复位并输出停止信息；④**内置 Python**——等待 Pyodide 加载时点停止立即取消等待（循环加 `running` 条件）；执行中因 Pyodide 主线程同步执行无法强制中断，如实提示（无限循环建议在线引擎/Termux）；运行类型细化为 `python/py-online/termux/cpp-online/jscpp` 五类分别处理；versionCode 19 |
| **v4.1.3** | z（交换目录失控输出保护 + 临时文件自动清理） | **三重防护治理 `/sdcard/QingCode/` 交换目录残留**（用户实测死循环打印使 `.stdout` 膨胀至 614.86MB）：①**运行中超限保护**——轮询发现 `.stdout` 超 32MB 立即杀 `.prog.pid`/`.keep.pid` 进程，终端输出 `⏹ timeout exit 125（输出超过 32MB 上限，已自动停止，疑似死循环打印等失控输出）`；②**结束后自动清理**——编译失败/运行结束/超时三分支结束后自动删除 `.stdout/.stderr/.compile.exit/.run.exit/.prog.pid/.keep.pid/.termux.log/.pc_in/.term_out` 与交换目录下源码副本（保留 `源码/` 与 `.app.log`）；③**启动清理**——App 启动即清掉上次残留（旧版 615MB 巨型 `.stdout` 装上即被清掉）；④**终端会话保护**——Termux 会话 `.term_out` 超 64MB 自动断开会话并提示；修复 `stopTermSession` 提取为 `stopTermSessionInternal`（内部类与轮询线程共用）；versionCode 20 |
| **v4.1.4** | z（初始化向导逐条命令化） | **「环境向导 ②」初始化指引改为逐条命令展示**：原来第 2 步是一条 `;` 串联的复合初始化命令（`termux-setup-storage; mkdir…; pkg install…`）+「一键复制」按钮整串复制；现拆为 **7 条独立命令**（清华源 1 条 + 初始化 6 条：setup-storage / mkdir / allow-external-apps / reload-settings / pkg install clang / 完成提示 echo），每条独立代码块、左侧序号标签（`position:absolute` + `user-select:none`，序号不会被选中混入复制内容），按顺序从上到下执行、上一条执行完再复制下一条；**去掉「一键复制」按钮**（用户长按自行复制），每条命令下附灰色小字说明（首次弹「允许访问」点允许、`(y/n)` 输 y）；`INIT_CMD` 复合串重构为 `INIT_CMDS` 数组（浏览器降级提示同步逐条输出）；versionCode 21 |
| **v4.2** | y（界面双语：中文 / English） | **首次启动弹出语言选择对话框**（logo + 双语标题，「中文」「English」两按钮，选择持久化 `localStorage('pc_lang')`，不选不进主界面）；**之后可随时切换**：更多菜单新增「🌐 语言 / Language」入口（对话框带「取消」，可关闭不改）；**界面全量双语**——新增 `web/i18n.js`（中英字典 120+ key + `t()`/`applyLang()`，静态节点 `data-i18n`/`data-i18n-html`/`data-i18n-title`/`data-i18n-ph` 四类属性驱动替换），覆盖顶栏/侧栏/欢迎页/终端面板/状态栏/通用对话框/获取 Termux/初始化向导（含 7 条命令步骤全文）/关于页三选项卡/更多菜单全部菜单项与引擎下拉选项，及动态文案（Pyodide 状态、新建/重命名/删除对话框、文件名校验提示、权限引导、Termux 指引、恢复示例、编码切换、自动保存开关等 20+ 处 `t()` 改造）；切换即时生效无需重启，刷新后持久保持；终端程序输出内容不参与翻译（程序输出保持原样）；Playwright 实测六场景（首启弹窗/English 生效/菜单切换/中文恢复/刷新持久/英文下向导+新建+关于页全英文）全过，修复批量替换产生的 5 处 `data-i18n` 属性缺失闭合引号导致 `mi-rename` 等元素解析异常；versionCode 22 |


