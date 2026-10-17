# 更新日志 · Changelog

轻码编辑器 QingCode 的完整版本历史。版本号规则（x/y/z 的约定）见 [README](README.md)。

> 源码目录只保留最新版；历史版本以本文件记录。

## 近期版本详情（v5.x）

### v5.4.2 更新内容（z 级 · 插件默认沙箱）

- 第三方插件**默认在 Web Worker 沙箱中运行**（此前默认主线程、需手动开沙箱）；
- 沙箱内无法访问 DOM / 原生桥 / 本地存储，只能通过受限 RPC 读写编辑器文本、执行命令；
- 仅对完全信任的插件可从插件卡片关闭沙箱，关闭时需二次确认；
- versionCode：5.4.2 (51)。


### v5.4.1 更新内容（z 级 · 安全审查修复）

依据《QingCode 安全审查与评估报告》修复高风险 2 项、中风险 5 项、低风险 3 项：签名密钥不再随源码分发、插件默认禁用、移除 CDN 兜底、C++ 默认 JSCPP、桥层路径校验、编译器名加引号、外部链接限定 scheme、`allowBackup=false`、缓存键改 sha256。详见 README「安全说明」。

### v5.4 更新内容（y 级 · 性能优化 + 自选壁纸 + 插件沙箱）

- **性能优化**：光标移动合并渲染、内置插件并行加载、编辑器容器渲染隔离，长文件与高频输入更顺；
- **自选壁纸**：设置 → 编辑 → 「🖼 壁纸」，可选预设渐变或**本地图片**（自动压缩），并可调透明度；重启后保留；
- **插件安全沙箱**：插件管理页可把 `/sdcard` 插件切换为「🧪 沙箱」运行——代码在独立 Worker 中执行，**访问不到 DOM / 原生桥 / 本地存储**，只能通过受限接口读写编辑器文本、执行命令；
- versionCode：5.4.0 (49)。

### v5.2.6 更新内容（z 级 · 长按提示修复）

- 修复**手机上长按工具栏按钮没有提示**的问题：之前只监听 `mousedown`，而触屏长按不会合成 mousedown，定时器根本没启动；
- 改为以 `touchstart` 为主通道（含 touchend / touchcancel / touchmove），并屏蔽长按系统菜单；
- 长按约 0.55 秒显示按钮名称（安卓弹 Toast，浏览器输出到终端），**松手不会误执行命令**，短按仍正常执行；
- versionCode：5.2.6 (47)。

### v5.2.5 更新内容（z 级 · 命令面板对齐修复）

- 修复命令面板**输入框被压扁成 17px** 的问题（恢复 40px 高）——之前 ⚙ / × 因此悬空、压在「控制面板」条上；
- 隐藏命令列表滚动条，输入框与列表项右边不再差 8px；
- 实测：输入框与列表项左右边界完全对齐，⚙ / × 垂直居中于输入框；
- versionCode：5.2.5 (46)。

### v5.2.4 更新内容（z 级 · 工具栏可用性）

- **区分两个放大镜**：「符号搜索」图标由 🔎 换成 `{}`，「全局搜索替换」仍是 🔍；
- **长按工具栏按钮**（约 0.55 秒）会显示这个按钮叫什么（安卓弹提示，浏览器在终端输出），长按只提示、不执行；
- versionCode：5.2.4 (45)。

### v5.2.3 更新内容（z 级 · 命令面板对齐 VS Code）

- 命令面板每条命令下方显示**另一种语言**的同一文案（中文界面显示英文、英文界面显示中文），像 VS Code 那样双行；
- 面板右上角新增 **⚙**（直接打开控制面板）和 **×**（关闭面板）；
- versionCode：5.2.3 (44)。

### v5.2.2 更新内容（z 级 · 界面修复）

- **修复顶栏「运行」被挤成竖排**：现在始终横排显示，不再被搜索框压缩；
- 窄屏手机自动隐藏顶栏的应用标题文字，把空间留给搜索框；
- **命令面板改成 VS Code 样式**：每条命令显示「名称 + 命令 ID」，选中有蓝底高亮，支持 ↑↓ 与回车，最近用过的命令带「最近使用」标记；
- **「行操作」按钮不再弹出搜索框**：点开是带标题的操作菜单（不需要输入）；
- versionCode：5.2.2 (43)。

### v5.2.1 更新内容（z 级 · 移除重复的命令面板按钮）

- 顶栏搜索框已经承担「打开命令面板」的职责，**移除编辑器工具栏里原来的 `⌘` 按钮**，两个入口不再重复（工具栏按钮 14 → 13）；
- versionCode：5.2.1 (42)。

### v5.2 更新内容（y 级 · 顶栏命令搜索 + 控制面板骨架）

- **顶栏搜索框**：顶栏中间新增搜索框（与「运行」按钮同高），点一下即弹出命令面板，可直接搜索全部命令；
- **命令面板置顶「控制面板」**：命令列表最上方多了一个带 `CONTROL` 标记的入口，与命令并列但始终置顶，不会被搜索过滤掉；
- **控制面板（骨架）**：点开后是 VS Code 风格的分组面板（编辑器 / 引擎 / 文件 / 插件 / 关于），已接命令的条目能直接用，未做的显示「即将推出」——本期只做界面与入口；
- versionCode：5.2 (41)。

### v5.1 更新内容（y 级 · 导航与搜索）

- **快速打开**：工具栏 📂，输入文件名实时过滤，点一下切换；
- **符号导航**：命令面板「当前文件符号」「全局符号」，跨文件列出 Python 的 `def`/`class`、C++ 的函数/类/宏，点击精确跳到那一行；
- **全局搜索替换**：工具栏 🔍，按关键字或**正则**跨所有文件搜索，点结果跳转；填好替换内容点「全部替换」可批量替换并自动保存；
- **最近文件**：自动记录最近打开过的 20 个文件；
- **书签**：工具栏 🔖 标记/取消当前行，书签面板按文件汇总、点击跳转；
- versionCode：5.1 (40)。

### v5.0 更新内容（x 级 · 编辑器插件化 + 编辑增强）

这次把编辑器拆成「最小内核 + 插件」，并补上一批实用编辑能力：

- **触屏工具栏**：编辑器上方新增一排按钮（撤销 / 重做 / 缩进 / 折叠 / 多光标 / 行操作 / 命令面板 / 格式化），**点按钮不会收起软键盘**；
- **命令面板**：点 ${⌘} 打开，可搜索全部命令；点「行操作…」只列出行相关命令；
- **多光标模式**：点 ${⊕} 开启后，**点空白处加光标、点已有光标移除**；也可用「向上/向下加光标」「选择下一个相同词」；
- **行操作**：上移 / 下移 / 复制到上方 / 复制到下方 / 删除行 / 切换注释 / 断行 / 重复行 / 合并到下一行；
- **代码片段**：输入 ${def}、${main}、${cout} 等触发词即可在补全里看到模板，Tab 跳占位符；**自定义片段**在「插件管理 → 🧩 片段」里增删改，保存即生效；
- **补全升级**：换成编辑器原生补全——关键词、已导入库成员（${math.} / ${std::}）、头文件名、当前文件内标识符、代码片段都在候选里；中文输入法打字时不再乱弹；
- **格式化**：「轻量格式化」收拾行尾空白与多余空行（Python 缩进不动）；「Termux 格式化」调用 clang-format / black，**没装会告诉你装什么，不会自动装**；
- **高亮扩展**：${.js} / ${.json} / ${.html} / ${.css} / ${.md} 现在也能语法高亮（只有 ${.py} / ${.cpp} 能运行，两者已解耦）；
- **插件可启停**：插件管理页里内置插件可单独禁用/启用，**即时生效、不用重启**；即使禁用，编辑器照样能输入、撤销、保存、运行；
- **插件删除与安全提示**：`/sdcard/QingCode/plugins/` 下的用户插件支持**删除**（先弹确认框，删除后立即从列表移除）；**启用任何第三方插件前都会提示「该插件未经安全审核」**，插件管理页顶部也常驻安全警告——插件以脚本形式运行，可能读写文件、执行 Termux 命令、访问网络，请只启用可信来源；
- **报错定位更准**：错误行若被折叠，会自动展开再标红；
- **插件接口 v3**：第三方插件可用 ${editor} 接口注册扩展 / 命令 / 工具栏按钮 / 语言 / 补全 / 片段 / 格式化，并监听 ${docChange} / ${selection} / ${fileOpen} 事件；v2 插件原样可用。
- versionCode：5.0 (39)。

> 更早版本（v3.0 – v4.11.2）的更新记录见 [README 的版本历史](README.md)。

## 完整版本表

| 版本 | 级别 | 主要变更 |
|---|---|---|
| **v1.0** | x（初版） | Monaco + Pyodide + JSCPP，WebView 壳，命令行构建 |
| **v2.0** | x（换编辑器/编译器） | 编辑器换 CodeMirror 6，C++ 换 Termux 真实编译，JSCPP 降为兜底 |
| **v3.0** | x（交互重构） | **交互式 I/O（对话框/终端输入行/流式输出）、启动提速（预加载+缓存头+md5 编译缓存）、依赖自动安装 + 环境向导** |
| **v3.0.1** | z（细节优化） | **「获取 Termux」双选项对话框**（GitHub 下载 / 复制开发者邮箱 19587486395@163.com）；新增 `copyText` 原生桥；versionCode 4。签名密钥自此固定于 `debug.keystore`（口令见 build.sh） |
| **v3.0.2** | z（细节优化） | **存储权限自动引导**：重新检测 / 运行 C++ 时若 Termux 已装但交换目录不可写，自动弹转系统「所有文件访问」设置页（此前 `openAllFilesAccess` 桥无前端入口，会静默降级 JSCPP）；versionCode 5 |
| **v3.0.3** | z（细节优化） | **初始化指引化**：「环境向导 ②」改为先弹 4 步指引对话框（不再直接跳 Termux）：清华源切换命令（仅展示，长按手动复制，不进一键复制）→ 复制初始化命令 → 粘贴执行 → **(y/n) 输入 y 确认** 提示；权限请求前先弹说明对话框（「前往设置开启」确认后才跳系统设置页）；versionCode 6 |
| **v3.0.4** | z（细节优化） | **运行链路可观测**：点运行后立即输出「已发送编译请求」，每 10s 心跳显示等待时长；超时 stderr 改为 4 步诊断清单（Termux 错误通知 / 通知权限 / 冷重启 / 终端直跑绕行）；versionCode 7 |
| **v3.0.5** | z（细节优化） | **修复 setup 判定不一致**：运行前 `ensureStorageAccess` 与环境检测统一为「实际写入测试」为准（此前运行额外强制 `isExternalStorageManager`，与检测绿灯矛盾导致误拦）；`cppJson` 补 `message` 字段，setup 失败真实原因（被吞 → 恒显示「Termux 未就绪」）可透传到终端；失败涉及权限时自动弹「前往设置开启」引导；versionCode 8 |
| **v3.1** | y（新增日志功能） | **调试日志系统**：原生关键路径全量落日志（getEnv/权限状态/写文件/`startService` 返回值/轮询退出码/超时，内存环形 500 条 + `/sdcard/QingCode/.app.log` 文件）；Termux 侧脚本执行留痕（`.termux.log`，轮询增量透出 `[termux]` 前缀）；菜单新增「导出调试日志（排障）」一键输出+复制；新增 `getLogs`/`appendLog` 桥；versionCode 9 |
| **v3.1.1** | z（细节优化） | **修复 SecurityException 根因**：日志实证 `RUN_COMMAND` 为 dangerous 级自定义权限，仅 manifest 声明不够——`runCpp`/`runInTermuxTerminal` 前增加运行时 `requestPermissions` 授权（未授权时弹系统窗口并提示，批准后重试即可）；日志导出增加「保存到下载文件夹」（`Downloads/QingCode-日志-<时间戳>.log`，`exportLogs` 桥）；versionCode 10 |
| **v3.1.2** | z（细节优化） | **轮询快照排障增强**：编译/运行轮询每 5s 在日志中记录 `poll#N` 文件快照（交换目录产物大小与 `.termux.log` 增量偏移），Termux 侧 start/end 留痕；`cppJson` 透出真实 stderr 原因；versionCode 11 |
| **v3.2** | y（新增在线编译引擎） | **C++/Python 各加免费在线引擎（Wandbox 主 + Judge0 CE 备，双引擎自动兜底）**：无需 Termux 即可真实编译运行，运行前检测输入语句预填 stdin（一次性提交，不支持逐步交互）；**引擎切换改下拉菜单**（C++ 引擎 auto/Termux/在线/JSCPP、编译器 clang++/g++、Python 引擎 Pyodide/在线，选择持久化并即时提示）；**修复「关于」双按钮**：对话框加 `showCancel` 控制，纯信息对话框（关于/Termux 指引）只显示「关闭」且确定后直接收起（此前残留上一次 modalMode 误入文件名校验分支，导致「取消+关闭」同时出现且关闭报「请输入文件名」）；versionCode 12 |
| **v3.3** | y（关于改版 + 源码随应用分发） | **「关于」全新改版**：logo + 版本号 + 三个选项卡（**用户协议** / **使用项目及致谢**（CodeMirror 6、Pyodide、JSCPP、Wandbox、Judge0、Termux）/ **开发者信息及开源协议**（开发者冯隽熙；采用 **MIT License**，随源码附 LICENSE 文件））；**源代码随应用分发**：构建时打包到 `assets/source/`（排除 Pyodide 二进制），启动/授权后自动释放到 **`/sdcard/QingCode/源码/`**（`.version` 标记按版本增量更新），「关于」底部告知释放路径与状态（新增 `sourcesReady` 桥）；versionCode 13 |
| **v3.4** | y（编译错误可视化标注） | **编译/运行错误直接标进编辑器**：错误输出解析（GCC/Clang `file:line:col: error:` 与 Python Traceback 最后帧）→ **整行问题代码红色高亮**（红底 + 左侧红边条）+ **错误语法/函数下红色波浪线**（自动圈选所在单词）+ **错误处文字泡显示原因**（5 秒自动消失，光标自动滚动定位到错误处）；覆盖全部引擎：Termux 编译失败、在线 C++ 编译错误、内置 Pyodide 异常、在线 Python Traceback（每处最多标 6 个，运行/切文件自动清除）；实现：`cm6.js` bundle 内注入 `StateEffect`/`StateField`/`Decoration` 错误标注模块并暴露 `PCCM.markErrors/clearErrors`；versionCode 14 |
| **v4.0** | x（全面升级 · 四大功能） | **① 智能补全**：输入实时弹出候选浮层（120ms debounce），三类场景——标准语法/关键词补全（`pri`→`print(`）、**已成功导入库的成员补全**（`import math` 后 `math.`→sin/cos/sqrt… 共 20 项；`#include <cmath>` 后 `std::` 补全；import/from/#include 正则扫描已导入库）、头文件名补全（`#include <`→25 个常用头）；↑↓ 选择 / Tab 或 Enter 采纳 / Esc 关闭，capture 阶段键盘拦截不影响正常编辑；**② 项目空间**：菜单「打开文件夹」原生目录浏览器（`CountDownLatch` + `AlertDialog` + `ListView`）选定后递归载入全部代码文件（≤200 个/个≤1MB）为项目，文件树显示相对路径、标题栏进入项目模式、**Python `import` 项目内模块自动生效**（运行前 Pyodide `FS.writeFile` 注入虚拟 FS / Termux 头文件写入交换目录）、**每 30 秒自动保存**全部修改回原路径；**③ 保存编码可选**：菜单编码下拉（UTF-8 / UTF-8 BOM / UTF-16LE / UTF-16BE / **GBK** / ASCII），「导出」按所选编码写文件（原生 `encodeBytes` 六编码），读取智能检测（BOM 优先 → UTF-8 严格解码 → GBK 回退，中文不乱码）；**④ 应用内 Termux 终端会话**：菜单「Termux 终端会话」在应用内直连 Termux 开持久 shell（前台不切换 App）——FIFO（`$HOME/.pc_term_in`，写端 `sleep 86400` 保活）+ 交换目录 out 文件 200ms 增量轮询，**指令与输出双向实时回传**，命令 base64 编码经 RUN_COMMAND 写入避免转义问题；新桥：`pickProjectFolder/readProject/writeProjectFile/saveFileEx/startTermSession/sendTermCmd/stopTermSession/encodeBytes/readFileSmart`；versionCode 15 |
| **v4.0.1** | z（全面 debug 修复） | **前端 6 项**：①成员补全按已输入前缀过滤（`math.fa`→只弹 fabs(/factorial(，此前弹全表）；②采纳补全后浮层不再立即重弹（`applySuppressPos` 抑制 + 继续输入恢复）；③`std::` 作用域成员补全修复（成员正则只认 `.` 不认 `::`，此前 `std::co` 永远无法弹出 std 表）；④`#include <` 头文件补全同样补上前缀过滤（`cma`→cmath）；⑤中文输入法组合中（`cm.composing`）不再弹英文候选；⑥补全浮层在矮视口下 top 加 `Math.max(4,…)` 防负坐标；项目文件保存失败（如 ASCII 含中文）时终端明确输出失败数与原因提示。**原生 6 项**：⑦`readAllBytes`/`readFile` 单次 `read()` 改循环读满（大文件理论截断风险）；⑧UTF-16LE/BE 导出加 BOM（此前导出文件回读必乱码）；⑨ASCII 含中文改为明确报错提示（此前静默变 `?` 损坏内容）；⑩项目目录对话框 `show()` 失败时 `countDown` 防 JS 桥线程卡 180 秒；⑪`sendTermCmd` 包 `timeout 3`（shell 退出后 FIFO 无读端会永久阻塞）；⑫`onDestroy` 停 Termux 轮询线程、Pyodide 注入改用标准 `FS.analyzePath`；在线引擎 + 项目模式运行时提示暂不支持项目内 import/头文件；Playwright 回归实测 7 项全过；versionCode 16 |
| **v4.1** | y（真机反馈修复 + 打开文件） | **🔴 重大修复：v4.0 原生桥全部断裂**——`pickProjectFolder/readProject/writeProjectFile/saveFileEx/startTermSession/sendTermCmd/stopTermSession` 七个 `@JavascriptInterface` 方法误加在 `MainActivity` 类主体（编译可过），而 JS 桥对象是 `NativeBridge` 内部类，`window.Android` 上根本不存在这些方法 → 真机上「打开文件夹」提示「仅安卓应用内可用」、编码导出走浏览器降级、Termux 会话无法连接。全部移入 `NativeBridge`；**新增打开单个本地文件**：原生选择器（目录+代码文件混合列表，点文件即选）→ `readSingleFile`（智能编码识别）→ `__onSingleFileLoaded` 加入文件列表（重名自动加序号），资源管理器头部新增「打开文件」「打开文件夹」按钮（与新建文件并排），菜单同步加「打开文件」；**UI 修复**：更多菜单内容超屏不可滚动（`overflow:hidden` → `max-height: calc(100vh - 62px)` + `overflow-y:auto`）；「关于」三个选项卡在窄屏被挤出（`white-space:nowrap` → 允许换行 + `flex-wrap`）；目录选择器列表按「目录在前+名称排序」，文件对话框扩展名白名单（py/cpp/c/h/txt/md/json/java/js/html/css/xml/csv）；versionCode 17 |
| **v4.1.1** | z（错误标注交互优化） | **① 跳转到最靠前的错误行**：标注前按行号排序，光标自动跳转 + 滚动定位到行号最小的错误（此前跳的是解析输出顺序的第一个，不保证最靠前），5 秒错误泡也显示该行错误；**② 编辑标红行立即消红**：`cm6.js` 监听器回调加传 `update` 对象，`onChange` 里用 `changes.iterChanges` 判断本次编辑是否触及标红行区间（行首/行尾双锚点，变更前坐标系求交），触及即从标红集合移除该行（**不论改对改错**），其余标红保留且锚点经 `changes.mapPos` 随增删行自动偏移（增行后标红跟随到新行号）；标红全部清完后自动清理装饰与错误泡；重新运行/切换文件仍清全部标红；versionCode 18 |
| **v4.1.2** | z（停止立即生效） | **运行中点「停止」按引擎立即终止，不再等超时**：①**在线引擎**——`runWandbox`/`runJudge0` fetch 接入 `AbortController`（`runOnlineExe` 统一创建），点停止立即 `abort()`，请求取消、进程终止，终端输出非实质错误 `⏹ KeyboardInterrupt: 已手动停止`；②**JSCPP**——超时计时器提为全局 `jscppTimer`，点停止立即 `terminate()` Worker + 清计时器 + 状态复位（此前只能干等 10 秒超时）；③**Termux**——此前 `cancelCpp` 杀进程后前端轮询已停、`onCppResult` 永不到达导致运行状态卡死，现停止后前端立即 `finishCpp()` 复位并输出停止信息；④**内置 Python**——等待 Pyodide 加载时点停止立即取消等待（循环加 `running` 条件）；执行中因 Pyodide 主线程同步执行无法强制中断，如实提示（无限循环建议在线引擎/Termux）；运行类型细化为 `python/py-online/termux/cpp-online/jscpp` 五类分别处理；versionCode 19 |
| **v4.1.3** | z（交换目录失控输出保护 + 临时文件自动清理） | **三重防护治理 `/sdcard/QingCode/` 交换目录残留**（用户实测死循环打印使 `.stdout` 膨胀至 614.86MB）：①**运行中超限保护**——轮询发现 `.stdout` 超 32MB 立即杀 `.prog.pid`/`.keep.pid` 进程，终端输出 `⏹ timeout exit 125（输出超过 32MB 上限，已自动停止，疑似死循环打印等失控输出）`；②**结束后自动清理**——编译失败/运行结束/超时三分支结束后自动删除 `.stdout/.stderr/.compile.exit/.run.exit/.prog.pid/.keep.pid/.termux.log/.pc_in/.term_out` 与交换目录下源码副本（保留 `源码/` 与 `.app.log`）；③**启动清理**——App 启动即清掉上次残留（旧版 615MB 巨型 `.stdout` 装上即被清掉）；④**终端会话保护**——Termux 会话 `.term_out` 超 64MB 自动断开会话并提示；修复 `stopTermSession` 提取为 `stopTermSessionInternal`（内部类与轮询线程共用）；versionCode 20 |
| **v4.1.4** | z（初始化向导逐条命令化） | **「环境向导 ②」初始化指引改为逐条命令展示**：原来第 2 步是一条 `;` 串联的复合初始化命令（`termux-setup-storage; mkdir…; pkg install…`）+「一键复制」按钮整串复制；现拆为 **7 条独立命令**（清华源 1 条 + 初始化 6 条：setup-storage / mkdir / allow-external-apps / reload-settings / pkg install clang / 完成提示 echo），每条独立代码块、左侧序号标签（`position:absolute` + `user-select:none`，序号不会被选中混入复制内容），按顺序从上到下执行、上一条执行完再复制下一条；**去掉「一键复制」按钮**（用户长按自行复制），每条命令下附灰色小字说明（首次弹「允许访问」点允许、`(y/n)` 输 y）；`INIT_CMD` 复合串重构为 `INIT_CMDS` 数组（浏览器降级提示同步逐条输出）；versionCode 21 |
| **v4.2** | y（界面双语：中文 / English） | **首次启动弹出语言选择对话框**（logo + 双语标题，「中文」「English」两按钮，选择持久化 `localStorage('pc_lang')`，不选不进主界面）；**之后可随时切换**：更多菜单新增「🌐 语言 / Language」入口（对话框带「取消」，可关闭不改）；**界面全量双语**——新增 `web/i18n.js`（中英字典 120+ key + `t()`/`applyLang()`，静态节点 `data-i18n`/`data-i18n-html`/`data-i18n-title`/`data-i18n-ph` 四类属性驱动替换），覆盖顶栏/侧栏/欢迎页/终端面板/状态栏/通用对话框/获取 Termux/初始化向导（含 7 条命令步骤全文）/关于页三选项卡/更多菜单全部菜单项与引擎下拉选项，及动态文案（Pyodide 状态、新建/重命名/删除对话框、文件名校验提示、权限引导、Termux 指引、恢复示例、编码切换、自动保存开关等 20+ 处 `t()` 改造）；切换即时生效无需重启，刷新后持久保持；终端程序输出内容不参与翻译（程序输出保持原样）；Playwright 实测六场景（首启弹窗/English 生效/菜单切换/中文恢复/刷新持久/英文下向导+新建+关于页全英文）全过，修复批量替换产生的 5 处 `data-i18n` 属性缺失闭合引号导致 `mi-rename` 等元素解析异常；versionCode 22 |
| **v4.3** | y（更名 QingCode + 权限引导重构 + Termux 后台唤醒） | **英文名由 PocketCode 更名为 QingCode**（规避与知名项目重名；「轻码」拼音直译，中英文完全对应；中文显示名「轻码编辑器」不变）——包名 `com.pocketcode.editor` → `com.qingcode.editor`、交换目录 `/sdcard/PocketCode/` → `/sdcard/QingCode/`、日志 TAG 与导出文件名、签名证书 CN、构建产物名、README/使用说明/LICENSE 全量同步；**启动即主动请求权限**（权限未齐时每次启动都引导，直到授权成功）：`onCreate` 新增 `requestPermissionsOnLaunch()`——Android 11+ 先弹「Termux 运行命令」运行时授权窗口、批准后在 `onRequestPermissionsResult` 自动衔接跳转「所有文件访问」设置页（两个引导不同时抢屏），被系统「不再询问」的权限自动改跳应用详情设置页手动开启（修复 RUN_COMMAND 死路：旧版提示「请批准弹窗」但系统永远不再弹窗），Android 10 及以下合并请求写存储 + RUN_COMMAND（code 40）；`onResume` 授权回流检测——从设置页开完权限返回后自动重新探测并刷新前端环境状态（存储由不可写变可写即触发 `probeTermux()`），无需重启或手动检测；**Termux 后台自动唤醒**：`sendRunCommand` 前新增 `wakeTermux()`，先发一条无害后台命令（`sh -c true`）拉起 RunCommandService/TermuxService，Termux 进程被系统杀掉后点编译/运行即自动后台拉起再入队执行，无需先手动打开 Termux（唤醒日志在系统拦截 startService 时提示关闭电池优化/加自启动白名单）；versionCode 23 |
| **v4.4** | y（插件接口预留 + 首启提速） | **插件接口预留（PCPluginAPI v1，插件由用户自行开发）**：新增 `web/app.js` `PluginHost`/`window.PCPluginAPI`——`register(meta)` 注册插件（`languages` 注册语言：扩展名并入「新建文件」白名单且 ▶ 运行按扩展名分流到插件 `onRun(file, code, langDef, api)`；`menu` 注册「更多菜单」项；`onInit` 加载回调）；能力通道：`out`/`meta`/`toast`/`copy`/`storage(id)` 隔离存储、**`execTermux(script, bg)` 底层原语**（任意 Termux 脚本）与 **`runCapture(script)` 高层封装**（输出重定向到交换目录临时文件 + 300ms 轮询 + 自动清理，120s 超时，返回 `Promise<{code, output}>`）；原生新增 7 个桥方法：`listPlugins`（列 `/sdcard/QingCode/plugins/*.js`）/`readPlugin`/`execTermux`/`readSwapFile`/`writeSwapFile`/`deleteSwapFile`/`showToast`（交换目录文件读写均防路径穿越：限名字符集 + canonical path 校验）；插件以 `new Function('PCPluginAPI', src)` 隔离加载、报错不影响主程序；接口文档与语言插件骨架见源码 `plugins/`（`插件接口说明.md` + `example-lang-plugin.js`，build.sh 同步打入源码快照）；**首启提速**——定位卡顿根因为启动 800ms 即开始预加载 Pyodide（约 10MB WASM 编译抢满 CPU 数秒致 UI 冻结）：预加载延后至 3.5s；`onCreate` 给 WebView 设置主题底色 `#1e1e1e` 消除启动白屏；`onResume` 的存储写测试移至后台线程（主线程不再做磁盘 IO）；versionCode 24 |
| **v4.5** | y（Python 编译缓存 + 说明文件双语） | **Python 运行时编译缓存**：`ensurePyodide` 加载前挂接 `WebAssembly.instantiateStreaming` 钩子——`pyodide.asm.wasm`（约 10MB）的编译结果 `WebAssembly.Module` 持久化到 IndexedDB（键含 URL 与字节数，升级自动失效重建），**下次冷启动直接 `new WebAssembly.Instance(cachedModule)` 跳过整个编译阶段**（加载耗时大头），状态栏显示加载耗时并在命中缓存时提示「编译缓存命中」；说明：V8 编译产物为引擎内部对象，只能存于应用内部持久存储（IndexedDB），交换目录无法承载——效果即「编译状态跨冷启动快速调用」，HTTP 层资源缓存头（wasm 7 天 / js 1 天）原生侧早已有之；**说明文件全面双语**：新增 `使用说明_EN.md`（英文版使用说明全文）与 `plugins/Plugin-API-Guide_EN.md`（插件接口英文版），中文版顶部加中英切换行，README/使用说明/插件文档三份说明全部中英对照；versionCode 25 |
| **v4.6** | y（启动页 + 插件管理页 + 插件接口 v2） | **启动页（Python 就绪前不进主界面）**：新增全屏启动页（logo + 版本号 + 进度条 + 阶段状态文字），启动即触发 Python 运行时加载并实时显示进度（加载 pyodide.mjs → 初始化解释器平滑爬升 8%→85% → 就绪 100%），**就绪后才进入主界面**；取代 v4.4 的「预加载延后 3.5s」方案——启动页本身就是等待 UI，编译占用 CPU 不再有「卡顿感」，且进入应用即可秒跑 Python；**失败/超时兜底**：加载失败或 90s 超时显示「跳过加载，直接进入」按钮（不锁死应用，后台继续加载，进入后 Python 可用照常）；`ensurePyodide` 支持 `onProgress` 进度回调；v4.5 编译缓存命中后二次冷启动进度飞快；**插件管理页（更多菜单 → 🧩 插件管理）**：全屏页面 + **顶部选项卡**——内置「已加载」（插件卡片：名称/版本/作者/描述/id/来源文件 + 启用状态与启停按钮）/「语言」（插件注册语言表格）/「设置」（插件接口与目录信息 + **插件系统总开关** + 预留说明）；**预留 API（PCPluginAPI 升级 v2）**：`page(tabId, { title, render(container, api) })` 向管理页注册自定义选项卡（惰性渲染，内置选项卡不可覆盖）、meta 新增 `author`/`description`/`homepage`/`onUnload` 标准字段（管理页展示）、**插件启停**：`localStorage('pc_plugins_disabled')` 按文件名禁用 + `pc_plugins_enabled` 总开关，`loadPlugins` 跳过禁用插件（重启生效），管理页可切换并 toast 提示；versionCode 26 |
| **v4.7** | y（Termux 原生 Python 引擎） | **Termux Python 成为 Python 的第三个引擎**（菜单「Python 引擎」新增「Termux Python（原生·可 pip 装库）」，与内置 Pyodide / 在线编译并列）：复用 C++ 的整套 Termux 基建（RUN_COMMAND + wakeTermux 后台唤醒 + mkfifo 交互管道 + 200ms 增量轮询 + 32MB 失控输出保护 + 超时强杀），新增原生桥 `runPyTermux`——**无编译阶段**，`python -X utf8 -u` 直接解释执行交换目录中的 .py（`-u` 实时流式输出，`-X utf8` 避免编码问题）；**配置语句与 C++ 完全分离**：python 缺失时运行脚本自动 `pkg install -y python`（联网一次），与 C++ 的 clang 安装、初始化向导互不影响；`input()` 交互与 C++ 一致（终端输入行写 FIFO 逐行实时）；项目模式下所有 .py 平铺写入交换目录，同目录模块可直接 import（复杂包结构建议 site-packages 或 Termux 终端）；停止键与 C++ 同路径即时终止；versionCode 27 |
| **v5.4.2** | z（插件默认沙箱） | **第三方插件默认改为在 Web Worker 沙箱中运行**（此前默认主线程）：沙箱内拿不到 `window` / `document` / `Android` 原生桥 / `localStorage`，只能通过受限 RPC 读写编辑器文本、执行命令；存储语义改为 `pc_plugins_inline`（**在主线程运行的白名单**，默认空）；插件管理页对可信插件可关闭沙箱，关闭时需**二次确认**并明确提示「可访问原生桥」。配合 v5.4.1 的「新插件默认禁用」，形成「先确认、再沙箱」的双重默认安全。versionCode 51 |
| **v5.4.1** | z（安全审查修复） | 依据《QingCode 安全审查与评估报告》修复：①**签名密钥**——`build.sh` 不再把 `debug.keystore` 复制进 `assets/source`（运行时不再分发到 `/sdcard`），支持 `KEYSTORE`/`KEYSTORE_PASS`/`KEY_PASS`/`KEY_ALIAS` 环境变量指定私有发布密钥，用 debug 密钥签名时打印警告；②**插件默认禁用**——`/sdcard` 下**新出现的插件默认禁用**（`pc_plugins_seen` 记录已见文件），必须到插件管理页确认后启用，堵住「其他应用往插件目录丢 .js → 下次启动获得 Termux 命令能力」；③**移除 Pyodide CDN 兜底**（jsDelivr 无 SRI）；④**C++ 默认引擎改为 JSCPP**（不再默认把代码上传到 Wandbox/Judge0）；⑤**桥层路径校验**——`saveFileIn`/`saveFileEx` 文件名白名单、`readProject`/`readSingleFile`/`writeProjectFile` 限定共享存储 canonical 路径；⑥`command -v` 的编译器名加引号；⑦外部链接只放行 http/https/mailto；⑧`allowBackup=false`；⑨编译缓存 md5→sha256；⑩文档新增「安全说明」章节并修正沙箱/在线编译表述。versionCode 50 |
| **v5.4.0** | y（性能 + 壁纸 + 插件沙箱） | ①**性能**：光标移动用 rAF 合并 DOM 写入、内置插件**并行加载**、编辑器容器 `contain: strict` 渲染隔离、大文件阈值 800KB；②**自选壁纸**：设置页 → 编辑 → 「🖼 壁纸」，4 种预设渐变 + **本地图片**（自动压缩到 ≤1440px JPEG）+ 透明度 5%–80%，持久化 localStorage，编辑器背景自动透明适配；③**插件安全沙箱**：`/sdcard` 插件可切换「🧪 沙箱运行」，代码在 **Web Worker** 中执行，**拿不到 window / document / Android 原生桥 / localStorage**，通过异步 RPC 提供受限 API（getText/setText/runCommand/currentLanguage/registerCommand/t/log）；插件管理页显示沙箱状态与停止按钮。诚实边界：Worker 仍可发起网络请求。versionCode 49 |
| **v5.2.6** | z（长按提示修复） | 修复**手机上长按工具栏按钮没有提示**：原实现只监听 `mousedown`，但触摸端长按时不会合成 mousedown（事件流是 `touchstart` → 长按 → `contextmenu`），定时器从未启动。改为 **`touchstart` 为主通道**（touchstart / touchend / touchcancel / touchmove + 桌面 mousedown 双通道），并屏蔽长按系统菜单；长按 550ms 显示按钮名称（安卓 Toast / 浏览器终端），松手后不会误执行命令。versionCode 47 |
| **v5.2.5** | z（命令面板对齐修复） | ①修复命令面板**输入框被 flex 压缩成 17px** 的问题（加 `flex:0 0 auto`，恢复 40px 高）——此前 ⚙/× 因输入框过矮而悬空、压在下方「控制面板」条上；②隐藏命令列表滚动条，消除**输入框比列表项宽 8px** 的右边错位；③实测输入框与列表项左右边界完全对齐（337/337）、⚙/× 垂直居中于输入框。versionCode 46 |
| **v5.2.4** | z（工具栏可用性） | ①**消除图标歧义**：「符号搜索」图标由 🔎 改为 `{}`，与「全局搜索替换」的 🔍 区分开（此前两个放大镜容易混）；②**长按工具栏按钮 550ms 显示按钮名称**（安卓弹 Toast、浏览器输出到终端），解决触摸端图标无文字、`title` 不可见的问题；长按只提示名称、不执行命令。versionCode 45 |
| **v5.2.3** | z（命令面板对齐 VS Code） | ①命令面板每条命令的副标题改为**另一种语言的同一文案**（中↔英双语显示，与 VS Code 命令面板一致；无翻译时回退命令 ID）；②面板右上角新增 **⚙（打开控制面板）** 与 **×（关闭）** 两个操作；③输入框右侧留白避免与操作图标重叠。versionCode 44 |
| **v5.2.2** | z（界面修复） | ①**顶栏「运行」不再被搜索框挤成竖排**（`white-space:nowrap` + 禁止 flex 收缩）；②窄屏（≤430px）自动隐藏顶栏标题文字，把空间让给搜索框；③**命令面板 VS Code 化**：每条命令显示「名称 + 命令 ID 副标题」，新增选中高亮与 ↑↓/Enter 导航，并给最近用过的命令加「最近使用」标记；④**「行操作」按钮改为操作菜单形态**——点开是无输入框、带标题的菜单，不再像在「搜索命令」；⑤顶栏搜索框与「行操作」共用同一面板的两种形态（搜索 / 操作菜单）。versionCode 43 |
| **v5.2.1** | z（去重） | 顶栏搜索框已承担命令面板入口，**删除编辑器工具栏里重复的 `⌘` 按钮**（工具栏按钮 14 → 13），并移除只服务于该按钮的 `ui.palette` 命令。versionCode 42 |
| **v5.2** | y（顶栏命令搜索 + 控制面板骨架） | ①**顶栏命令搜索框**：与「运行」按钮**同行同高**（32px），点击弹出命令面板（readonly 不弹软键盘），移动端也能快速检索全部命令；②**命令面板新增置顶「控制面板」入口**：与命令并列但**始终置顶**、带 `CONTROL` 特殊标记与渐变高亮，且**不参与命令过滤**；③**控制面板（VS Code Control Panel 风格骨架）**：分组展示「编辑器 / 引擎 / 文件 / 插件 / 关于」，已绑定命令的条目直接执行，未实现的标注「即将推出」——**本期只做界面与内部扩展点，不做实质功能**。versionCode 41 |
| **v5.1** | y（导航与搜索） | **新增内置插件「导航与搜索」**：①**快速打开**（工具栏 📂）：按文件名实时过滤，点击即切换；②**符号导航**：「当前文件符号」「全局符号」——跨全部文件扫描 Python `def`/`class` 与 C++ 函数/类/宏，点击精确跳行；③**全局搜索替换**（工具栏 🔍）：跨所有文件按关键字或**正则**搜索（上限 400 条），点击跳转；支持「替换为… + 全部替换」批量替换并自动保存；④**最近文件**：自动记录最近 20 个打开过的文件（localStorage 持久化）；⑤**书签**（工具栏 🔖）：一键标记/取消当前行，书签面板按文件汇总、点击跳转（持久化）；⑥**插件间协作**：`editor` 接口新增 `files()` / `openFile()` / `setFileContent()` / `gotoLine()` / `saveAll()` 文件级 API，插件互不依赖。versionCode 40 |
| **v5.0** | x（编辑器插件化重构 + 编辑增强） | **内核最小化 + 插件装配**：①内核只保留文档 / 行号 / 撤销 / 高亮 / 错误标注，`cm6.js` 重打包 **753KB**、导出 **73 个模块**（新增 `PCCM.modules` 与 `lang`/`font`/`indent`/**`plugins`** 四个 `Compartment` 插槽），插件增删**即时生效**；②**PCPluginAPI v3**：新增 `editor` 接口（`extension`/`command`/`toolbar`/`language`/`completion`/`snippets`/`formatter`/`on`/`view`/`modules`/`completionData`），v2 插件原样可用；③**内置插件「编辑增强」**（`web/plugins/editor-plus.js`，随 APK 打包、先于 `/sdcard` 用户插件、浏览器预览亦可加载）：27 条命令 + **9 个触屏工具栏按钮**（`mousedown` 拦默认，不夺焦点、不收键盘）+ **命令面板**（搜索 / 按组过滤）；④**新能力**：多光标模式（点空白加光标、点已有光标移除）、行操作 8 项（含重复行 / 合并行）、折叠 3 项、缩进 / 反缩进、**代码片段**（内置 10 个 + 用户自定义，管理页增删改即生效）、**两层格式化**（轻量：去行尾空白 + 末尾换行，Python 不动缩进语义；Termux：clang-format / black，先探测后提示安装，不自动装）；⑤**补全迁移**：删除自写浮层 194 行与 capture 键盘拦截，改 CM6 `completionSource`（关键词 / 库成员 / `std::` / 头文件 / 文档标识符 / 片段），并以 `autocompletion({override})` 覆盖语言包自带源；⑥**高亮与运行解耦**（新增 js/json/html/css/markdown 高亮）；⑦**错误行自动展开折叠块**；⑧**插件管理页**：内置插件带「内置插件」标记、可**即时禁用/启用**，禁用后编辑器仍可输入 / 撤销 / 保存 / 运行；⑨插件文案 **50 个 key 中英 i18n**，切换语言实时生效；⑩**代码理解与智能**（内置插件 `code-intel`）：语义分析 / 类型提示 / 错误警告 / 跳转定义 / 查找引用 / 查看实现 / 符号搜索 / 内联文档 / 调用层级——**Python 走 Pyodide 的 `ast` 真语义**（签名、docstring、调用图、未定义/未使用诊断），C++ 为纯前端启发式；⑪**插件安全**：用户插件可删除（二次确认）、启用第三方插件前提示「未经安全审核」、插件页常驻安全警告。versionCode 39 |
| **v4.11.2** | z（系统 debug：10 处缺陷修复） | **一轮全量排查（前后端契约交叉扫描 + 运行时冒烟测试 + 独立静态复核）修复 10 处缺陷，含 3 处严重**：①**「打开文件夹（项目空间）」完全失效**——原生 `readProject()` 的回调名 `window.__onProjectLoaded` 在网页侧从未定义，原生 `&&` 短路使选完目录后界面毫无反应（本次补上导出）；②**`TERMUX_HELP` 未定义致运行按钮卡死**——引擎选「仅 Termux」而环境未就绪时抛 ReferenceError，其后的状态复位永不执行，按钮永久停在「停止」（改用 i18n 的 `termux_help`）；③**插件接口缺 `writeSwapFile`/`readSwapFile`/`deleteSwapFile`**——文档 API 表与示例都这么写而实际未挂载，照文档写的插件第一步即 TypeError；④i18n key `newfile` 拼写错（→ `new_file`）；⑤Termux 指引文案统一到「设置 → 引擎与 Termux」；⑥初始化命令与界面口径统一（原生补清华源 + `apt update -y`，浏览器降级提示同步）；⑦源码快照补 `res/` 与 `vendor/JSCPP.js`（此前快照无法复现构建）；⑧项目扫描白名单与「打开文件」对齐（java/js/html/css/xml/csv）；⑨`sendRunCommand` 发送失败不再被当成成功（`return cn != null`，runCpp 与插件 runCapture 不再空等超时）；⑩细节：区分「取消输入」与「输入空行」、运行会话目录名唯一化、插件临时标记文件清理、终端会话发送失败不再遗留轮询线程、删除死绑定与孤儿文案。**明确保留 `requestLegacyExternalStorage`**（Android 10 只认该开关，删掉会丧失 /sdcard 直写）。versionCode 38 |
| **v4.11.1** | z（自动安装改走清华源） | **自动安装接入清华镜像（国内提速数倍）**：①**检测增强**——`TERMUX_PROBE` 顺带报告 apt 源（`grep $PREFIX/etc/apt/sources.list` 是否含 `mirrors.tuna.tsinghua.edu.cn`）与 pip 源（`pip config get global.index-url` 是否含 tuna）状态；②**apt 换源**——`src:missing` 时安装命令自动变为「写入清华源 → `apt update -y` 刷新索引 → `pkg install`」（旧索引仍指向官方源，不刷新则下载不提速）；命令与配置对话框向导完全一致，全分号串联单段失败不阻断；③**pip 换源**——装 python 的命令尾部顺带 `pip config set global.index-url`（清华 pypi 镜像）；python 已装但 pip 未配置时守护循环自动补配（秒级幂等），不影响就绪判定状态机；④换源/补配动作均在终端输出说明；versionCode 37 |
| **v4.11** | y（Termux 引擎全自动后台维护：检测→安装→重试，零等待） | **Termux Python / clang 的检测与安装全程后台化，启动零等待**——①**启动页只检测+发起安装即通过**：删除 C++（Termux）阶段「等待安装完成（最长 5 分钟）」的逻辑，检测到组件缺失立即后台发起 `pkg install` 并直接进入主界面（进度条直接显示「仍在后台安装，先进入软件」）；②**后台守护循环** `startTermuxGuard()`（每 45s 一轮）：启动检测失败 / Termux 忙碌静默下轮重试；组件缺失幂等补发 `pkg install`（dpkg 对已装包 no-op、Termux 队列串行无并发冲突）；**15 分钟仍未装好自动重发**（断网/中断自愈）；**全部就绪 → `probeTermux()` 刷新引擎下拉、终端提示「引擎已就绪」、循环自动停止**；③**后装 Termux 自动接管**：守护循环每轮静默刷新 `getEnv()`（不动编辑器 UI、不打断输入法），Termux 后装切回 App 后 ≤45s 自动检测安装，无需重启；④状态机 init→installing→ok 支持回环（就绪后组件被卸载可重新自愈）；运行时脚本内自动安装兜底保留（双保险）；versionCode 36 |
| **v4.10** | y（内置 Python Worker 化：真终端式 input + 可强制中断） | **内置 Pyodide 移入后台 Worker（`web/py-worker.js`，module Worker），input() 变成真终端**——①**终端式逐行输入**：`input("提示语")` 的提示文字经 raw stdout 逐字节收集 + `TextDecoder` 流式解码**实时显示在输出区**（无换行提示语在等待输入前冲刷），光标自动聚焦底部终端输入行，逐行输入回车即发，与 C++/Termux Python 体验完全一致，不再弹对话框；跨线程同步用 `SharedArrayBuffer` + `Atomics.wait/notify` 握手（CTRL 状态字 0 等待/1 有行/2 EOF + 64KB 数据区），`setStdin` 挂接阻塞读行函数，Python 侧真正睡眠等输入、零轮询；②**修复示例代码 `NameError: name '_pi' is not defined`**（v4.9.4 补丁 `del` 掉了闭包运行时需要的模块全局 → 改 `_pc_make_input()` 工厂闭包捕获；主线程回退模式保留修复补丁，Worker 模式用原生 input() 不再需要补丁）；③**内置 Python 可强制中断**：独立线程运行，「停止」即 `Worker.terminate()` 强杀 + 全状态复位，无限循环秒杀，下次运行自动重启（WASM 编译缓存 IndexedDB 跨线程共享，重启仍快）；④**自动回退**：`crossOriginIsolated === false`（无跨域隔离头）时回退主线程 + 对话框模式；versionCode 35 |
| **v4.9.4** | z（修复：运行通道——中断真杀进程 + 产物隔离 + 轮询防误判） | **针对中断/串跑问题的五项根因全部修复**。①**「停止」真正杀死 Termux 进程**：旧实现只把 kill 排进 Termux 命令队列，队列被长脚本占住时 kill 永远轮不到执行——现在运行脚本内置**看门狗**子进程（0.5s 轮询），点停止时 App 直接向会话目录写 `.cancel` 标记文件（跨应用零延迟），看门狗立即杀 编译(`.compile.pid`)/运行(`.prog.pid`)/保活(`.keep.pid`) 三类进程并终结脚本释放队列，队列 kill 仅作兜底；顺带修复 cancelCpp 里 `rm -f $HOME/.pc_in` 用错旧 FIFO 名的 bug；②**产物隔离补全**：编译二进制改为会话独立 `pc_prog_<会话>.out`（旧版共用 `$HOME/.pc_prog.out`，且排查发现**md5 缓存未命中分支从不把新二进制放到运行路径——实际跑的是上一个项目残留的旧程序**，这正是「运行的是默认项目」的元凶之一），缓存写入改「临时文件+原子替换」杜绝 ETXTBSY 与半写入；③**轮询严格判定**：`.run.exit` 必须非空且为 0~255 合法退出码才算结束（0 字节/半写入/FUSE 延迟内容不再误判 exit=0 秒完成），会话目录丢失直接报告终止、绝不回退根目录读残留旧文件（`currentRunDir()` 移除 exists 回退）；④**清理保护**：带 `.active` 标记的活跃/排队会话目录不再被 cleanSwapTemp 误删，运行结束只精准 purge 自己的会话目录（新增 `purgeRunDir`），开新运行自动补发 .cancel 给上一个存活会话（僵尸自愈），历史会话 24h 自动清理；⑤**input() 提示语**：重写内置 Python `builtins.input`，`input("提示")` 的提示文字传入输入对话框并回显输出区（原 setStdin 回调拿不到提示语）；附带修复 `__onCppResult` 中 `window.__pyTermuxRun` 被 finishCpp 提前清空导致 Termux Python 完成文案永远走 C++ 分支的时序 bug；versionCode 34 |
| **v4.9.3** | z（修复：多项目运行串项目） | **修复「有多个 C++ 项目时运行的是默认项目而非当前项目，有时又好了」**。根因：此前所有运行共用同一交换目录，而 Termux 命令是**异步排队执行**的——连续运行两个项目（尤其默认同名 main.cpp）时，后写入的文件覆盖先运行脚本要读的文件，`.stdout` 等产物也交叉污染；Termux 响应快（队列不积压）时就正常，所以「有时又好了」。修复：**运行会话目录隔离**——每次运行创建独立 `.run_<时间戳>` 子目录，主文件、项目头文件/同目录模块（新增 `beginRunSession` / `saveFileIn` / `endRunSession` 桥）、编译产物与输出全部落在会话目录内；轮询读取与「停止」按会话目录定位；FIFO 管道名按会话唯一化（`$HOME/.pc_in_<会话>`）；历史会话目录在下次启动时统一清理；Termux Python 引擎同机制修复；versionCode 33 |
| **v4.9.2** | z（启动页提示） | **Termux 慢加载提示**：启动页 C++（Termux）阶段持续 15 秒仍未完成时，在该进度条下方显示琥珀色小字提示「若 Termux 加载较慢，请先手动打开 Termux，再重新打开编辑器」——Termux 冷启动/初始化慢时用户有了明确的处置办法；阶段正常完成或未装 Termux 秒过时提示不出现（不打扰），阶段结束/跳过进入后自动消失；versionCode 32 |
| **v4.9.1** | z（设置页细节优化） | **选中的设置选项卡变蓝**：文字亮蓝 + 淡蓝背景 + 蓝色下划线，切换即时跟随；**设置头部收窄**（41px → 35px），返回按钮固定 28px 方块，只有碰到按钮本身才退出，不再有大片误触区；**头部空位改为设置搜索框**：输入即跨「编辑 / 引擎与 Termux / 文件 / 通用」四个选项卡过滤全部设置项（支持别名：搜「字体」命中「字号」、搜「clang」命中「配置 C++」），点按钮类结果直接触发功能、下拉类结果自动跳到对应选项卡并高亮 1.5 秒，无结果显示空态提示，打开/关闭设置页自动清空；versionCode 31 |
| **v4.9** | y（全屏设置页 + Termux 缺失禁用 + 启动页跳过确认） | **右上角「⋯」升级为全屏设置页**：点击后直接进入全屏设置界面（不再弹下拉小菜单），原有全部菜单项按「编辑 / 引擎与 Termux / 文件 / 通用」四个选项卡分组保留（引擎与编译器下拉、获取 Termux、配置 C++ / Python、终端会话、项目空间、编码、插件、语言、调试日志、关于等一项不少），返回键或「⋯」关闭；**启动时检测 Termux 是否安装**：未安装则取消所有 Termux 编译项目——C++ 与 Python 引擎下拉中的 Termux 选项置灰禁用、已保存为 Termux 的引擎自动回退（C++ → 自动降级 / Python → 内置 Pyodide），进入主界面后终端与状态栏提示「缺少 Termux，仅可使用部分功能」，运行 Termux 类功能（真实编译 / Termux Python / 终端会话 / 交互运行）统一拦截并给出安装指引；**启动页右上角常驻「跳过 →」**：点击弹确认对话框（「跳过后部分功能可能不可用，界面可能出现短暂卡顿；引擎仍在后台继续准备」），确认后直接进入主界面，未完成的加载 / 安装任务在后台继续；versionCode 30 |
| **v4.8.1** | z（启动页双引擎进度条） | **启动页改为「Python + C++」双进度条**：Python（Pyodide）在上、C++（Termux）在下（各自标签/百分比/状态文字，C++ 条绿色渐变区分，等待期间置灰）；**严格顺序加载**——Python 引擎就绪（或失败/90s 超时）后，才启动 C++ Termux 阶段：检测 python/clang → 缺失自动注入 `pkg install` 并**在启动页等待安装完成**（每 8s 复检，最长等 5 分钟；超时转后台继续安装并自动进入，装好后自动刷新引擎状态）；**未装 Termux / 浏览器环境秒过**（显示「未检测到 Termux，已跳过」），不拖慢进入；取代 v4.8 的「boot 末尾 2.5s 后台静默检测」——检测前置可视、等待有兜底，任一引擎失败仍可「跳过进入」不锁死；versionCode 29 |
| **v4.8** | y（Termux 环境自动维护 + 配置对话框双选项卡） | **每次启动自动检测并配置 Termux**：boot 末尾（Python 运行时就绪、界面与插件等主要准备工作完成后，延迟 2.5s 不阻塞）执行 `autoTermuxSetup()`——向 Termux 后台发送检测脚本（`command -v python / clang`，经 runCapture 通道捕获结果），**Python 或 clang 缺失即自动在后台注入 `pkg install -y python / clang`**（终端留痕、不弹窗、不阻塞；Termux 未安装或无权限时静默跳过；runCapture 120s 超时保护）；**「配置 C++」「配置 Python」双选项卡**：三点菜单原「环境向导 ② 初始化」「③ 重新检测」两项合并升级为「⚙️ 配置 C++」「🐍 配置 Python」两个入口，点击打开同一个配置对话框（顶部 C++ / Python 选项卡）——C++ 选项卡保留原初始化 7 条命令向导，Python 选项卡为 `pkg install -y python` + pip 清华源换源命令 + 引擎切换说明，两选项卡共用「立即检测并自动配置」按钮（手动触发同一检测注入流程）；**自动化仍是主路径**：运行时脚本内的自动安装兜底（C++ 与 Termux Python 均有）保留，手动向导仅为备选；versionCode 28 |
