# 第三方开源组件与许可证（Third-Party Notices）

本目录收录 QingCode 使用或分发的**全部第三方开源组件**所适用的许可证原文，均为官方文本、未作改写。
QingCode 自身的许可证为 MIT，见仓库根目录 [LICENSE](../LICENSE)。

## 一、随应用分发的组件（打包进 APK）

| 组件 | 版本 | 许可证 | 用在哪里 | 许可证文件 |
|---|---|---|---|---|
| CodeMirror 6（含 `@codemirror/*`、`@lezer/*`、`style-mod`、`w3c-keyname` 等依赖） | 6.x | MIT | `web/vendor/cm6.js` —— 编辑器内核（语法高亮 / 折叠 / 搜索 / 补全） | [MIT-CodeMirror.txt](MIT-CodeMirror.txt) |
| JSCPP | 2.0.9 | MIT | `web/vendor/JSCPP.js` —— C++ 教学解释器（无 Termux 时的兜底引擎） | [MIT-JSCPP.txt](MIT-JSCPP.txt) |
| lodash | 4.x | MIT | 由 JSCPP 打包内联（见 `JSCPP.js` 末尾的 `Bundled license information`） | [MIT-lodash.txt](MIT-lodash.txt) |
| Pyodide | 0.26.4 | MPL-2.0 | `web/pyodide/` —— CPython 3.12 WebAssembly 运行时（内置 Python 引擎） | [MPL-2.0.txt](MPL-2.0.txt) |
| CPython | 3.12.1 | PSF-2.0 | `web/pyodide/python_stdlib.zip` —— Python 标准库（由 Pyodide 打包） | [PSF-2.0-CPython.txt](PSF-2.0-CPython.txt) |
| Emscripten 运行时 | 3.1.58 | MIT / University of Illinois | `web/pyodide/pyodide.asm.js`、`pyodide.asm.wasm` —— 由 Pyodide 构建链生成 | [MIT-Emscripten.txt](MIT-Emscripten.txt) |

> **关于 Pyodide 的可选包**：`web/pyodide/pyodide-lock.json` 中列出约 310 个**可选**第三方包（numpy、pandas、matplotlib 等），它们**不随本应用分发**（本应用只内置 core + CPython 标准库；这些包需联网从 Pyodide 官方 CDN 按需加载），因此本目录未收录其许可证。若将来改为内置某些包，请同步补充对应许可证。

## 二、通过官方接口调用的外部应用 / 服务（不分发其代码）

| 组件 | 许可证 | 与本项目的关系 | 许可证文件 |
|---|---|---|---|
| Termux | GPL-3.0 | **独立应用**，本应用仅通过其官方 `RUN_COMMAND` 接口调用（真实 C++ 编译 / Termux Python），不打包其任何代码 | [GPL-3.0.txt](GPL-3.0.txt) · [NOTICE-Termux.txt](NOTICE-Termux.txt) |
| Judge0 CE | GPL-3.0 | 公益在线执行服务；仅当用户选择「在线编译」引擎时，代码经网络提交处理 | [GPL-3.0.txt](GPL-3.0.txt) |
| Wandbox | Boost Software License 1.0 | 公益在线编译服务；仅当用户选择「在线编译」引擎时，代码经网络提交处理 | [BSL-1.0-Wandbox.txt](BSL-1.0-Wandbox.txt) |

> 使用「在线编译」引擎会把当前代码与输入发送到上述第三方公益服务（Wandbox 主、Judge0 备），应用内「关于 → 用户协议」亦有告知；请勿提交涉密内容。

## 三、许可证原文来源（便于核对）

| 文件 | 来源 |
|---|---|
| MIT-CodeMirror.txt | `https://cdn.jsdelivr.net/gh/codemirror/dev@main/LICENSE`（CodeMirror 官方仓库） |
| MIT-JSCPP.txt | `https://cdn.jsdelivr.net/npm/JSCPP@2.0.9/LICENSE` |
| MIT-lodash.txt | `https://cdn.jsdelivr.net/npm/lodash@4.17.21/LICENSE` |
| MPL-2.0.txt | `https://cdn.jsdelivr.net/gh/pyodide/pyodide@main/LICENSE`（Pyodide 官方仓库） |
| PSF-2.0-CPython.txt | `https://cdn.jsdelivr.net/gh/python/cpython@v3.12.1/LICENSE`（与 Pyodide 内嵌版本一致） |
| MIT-Emscripten.txt | `https://cdn.jsdelivr.net/gh/emscripten-core/emscripten@main/LICENSE` |
| GPL-3.0.txt | `https://www.gnu.org/licenses/gpl-3.0.txt`（GNU 官方全文） |
| NOTICE-Termux.txt | `https://cdn.jsdelivr.net/gh/termux/termux-app@master/LICENSE.md`（Termux 官方附加说明） |
| BSL-1.0-Wandbox.txt | `https://cdn.jsdelivr.net/gh/melpon/wandbox@master/LICENSE`（Wandbox 官方仓库） |

## 四、维护约定

1. **本目录文件为官方原文，不得改写内容**（如需补充说明，写在本 README 里）；
2. 升级任一第三方组件时，请一并核对许可证是否变化，并更新本目录与上表；
3. 新增第三方组件（含随包分发的资源）时，必须同步在此收录其许可证与来源；
4. 行尾遵循仓库根目录的 [.gitattributes](../.gitattributes)。
