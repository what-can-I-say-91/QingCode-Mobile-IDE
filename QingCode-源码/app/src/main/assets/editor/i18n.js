/* ============================================================
 * 轻码编辑器 QingCode —— i18n.js (v4.2)
 * 界面双语：中文(zh) / English(en)
 * 首次启动弹出语言选择；之后可在「更多菜单 → 🌐 语言 / Language」切换
 * 选择持久化于 localStorage('pc_lang')；静态节点用 data-i18n 系列属性驱动
 *   data-i18n      → textContent        data-i18n-html → innerHTML
 *   data-i18n-title→ title 属性         data-i18n-ph   → placeholder
 * ============================================================ */
'use strict';

/* ---------- 字典 ---------- */
const I18N = {
  zh: {
    doc_title: '轻码编辑器 QingCode',
    app_title: '轻码编辑器',
    t_menu_filelist: '文件列表', t_run: '运行', run: '运行', t_more: '更多',
    explorer: '资源管理器', t_openfile: '打开文件', t_openfolder: '打开文件夹（项目空间）', t_newfile: '新建文件',
    runtime: '运行时状态',
    terminal: '终端', t_clear: '清空输出', t_toggle: '收起/展开',
    out_hint: '// 终端就绪。点击 ▶ 运行当前文件，程序请求输入时会弹窗或在下方输入。',
    out_hint_ready: '// 终端就绪。点击 ▶ 运行当前文件。',
    ph_term: '程序运行时可在此交互输入，回车发送', send: '发送',
    ph_fname: '文件名，如 demo.py 或 hello.cpp', cancel: '取消', ok: '确定', close: '关闭',
    dl_title: '获取 Termux 安装包',
    dl_desc: 'Termux 用于真实 C++ 编译（一次性安装，之后全离线可用）',
    dl_github: '前往 GitHub 下载', dl_email: '联系开发者获取安装包',
    init_title: '一键初始化 Termux', init_open: '打开 Termux',
    init_steps: '<b>第 1 步（推荐 · 国内加速）</b>：切换清华源——在 Termux 粘贴执行这条命令（长按命令可选中复制）：'
      + '<div class="init-cmd"><span class="no">1</span>echo "deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main" &gt; $PREFIX/etc/apt/sources.list</div>'
      + '<b>第 2 步</b>：按顺序逐条复制粘贴执行下面 5 条命令——<b>上一条执行完再复制下一条</b>，不要混在一起（长按命令可选中复制）：'
      + '<div class="init-cmd"><span class="no">2</span>termux-setup-storage</div>'
      + '<div class="init-note">↑ 首次执行会弹「允许访问」提示，点允许</div>'
      + '<div class="init-cmd"><span class="no">3</span>mkdir -p ~/.termux</div>'
      + '<div class="init-cmd"><span class="no">4</span>echo "allow-external-apps=true" &gt;&gt; ~/.termux/termux.properties</div>'
      + '<div class="init-cmd"><span class="no">5</span>termux-reload-settings</div>'
      + '<div class="init-cmd"><span class="no">6</span>pkg install -y clang</div>'
      + '<div class="init-note">↑ 询问 <b>(y/n)</b> 时输入 <b>y</b> 后回车（第 1 步换过源下载更快）</div>'
      + '<div class="init-cmd"><span class="no">7</span>echo \'\'; echo \'== 初始化完成，请返回轻码编辑器 ==\'</div>'
      + '<b>第 3 步</b>：看到「== 初始化完成，请返回轻码编辑器 ==」后返回本应用，打开「设置 → 引擎与 Termux → ⚙️ 配置 C++」点「立即检测并自动配置」（若提示权限问题，按提示允许「所有文件访问」）。',
    about_name: '轻码编辑器 QingCode',
    ab_tos: '用户协议', ab_credits: '使用项目及致谢', ab_dev: '开发者信息及开源协议',
    mi_rename: '重命名当前文件', mi_delete: '删除当前文件', mi_export: '导出当前文件',
    mi_fontp: '字号 +', mi_fontm: '字号 −',
    cpp_engine: 'C++ 引擎', cpp_compiler: 'C++ 编译器', py_engine: 'Python 引擎',
    eng_auto: '自动（Termux 优先）', eng_termux: 'Termux（真实编译）', eng_online: '在线编译（免费）',
    eng_jscpp: '内置 JSCPP（离线教学）', eng_pyodide: '内置 Pyodide（离线）',
    eng_py_termux: 'Termux Python（原生·可 pip 装库）',
    py_termux_switch: 'Python 引擎已切换为：Termux Python（设备原生解释器，可 pip 安装任意第三方库；未安装时首次运行会自动 pkg install python，需联网一次；与 C++ 的 clang 配置相互独立）',
    py_online_switch: 'Python 引擎已切换为：在线编译（真实编译，需联网；交互输入会一次性收集）',
    py_pyodide_switch: 'Python 引擎已切换为：内置 Pyodide（离线，支持逐步交互）',
    py_termux_done: '进程已结束，退出代码 {exit}，耗时 {secs} 秒 [Termux python]',
    mi_openfolder: '📂 打开文件夹（项目空间）', mi_openfile: '📄 打开文件（本地）',
    mi_closeproj: '✖ 关闭项目空间', mi_saveall: '💾 保存全部到项目',
    mi_autosave: '定时自动保存（30 秒）：开', encoding: '文件编码',
    mi_term: '连接 Termux 终端会话（内嵌）', mi_tty: '在 Termux 终端中交互运行 C++',
    mi_envdl: '环境向导 ① 获取 Termux',
    mi_cfg_cpp: '⚙️ 配置 C++（编译器）', mi_cfg_py: '🐍 配置 Python（解释器）',
    cfg_title: '环境配置（手动备选）',
    cfg_tab_cpp: 'C++（clang 编译器）', cfg_tab_py: 'Python（解释器）',
    cfg_cpp_note: 'C++ 真实编译需要 clang：应用每次启动会自动检测并在后台安装（保持联网即可），本向导仅作手动备选。',
    cfg_py_note: 'Termux Python 为设备原生解释器（可 pip 安装任意第三方库）。应用每次启动会自动检测并在后台安装（保持联网即可）；默认 Python 引擎仍是内置 Pyodide，需在菜单「Python 引擎」切换。',
    cfg_py_steps: '<b>方式一（推荐）</b>：保持联网，应用启动时会<b>自动检测并后台安装</b>，无需手动操作。'
      + '<b>方式二（手动）</b>：在 Termux 中逐条执行（长按命令可复制）：'
      + '<div class="init-cmd"><span class="no">1</span>pkg install -y python</div>'
      + '<div class="init-note">↑ 询问 <b>(y/n)</b> 时输入 <b>y</b> 后回车（换过清华源下载更快）</div>'
      + '<div class="init-cmd"><span class="no">2</span>pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple</div>'
      + '<div class="init-note">↑ 可选：pip 换清华源，装第三方库更快</div>'
      + '<b>使用</b>：菜单 →「Python 引擎」→ 选「Termux Python（原生·可 pip 装库）」，点 ▶ 运行即用真实解释器。',
    cfg_recheck: '立即检测并自动配置',
    mi_log: '导出调试日志（排障）', mi_reset: '恢复示例代码', mi_about: '关于',
    mi_plugins: '🧩 插件管理',
    /* v4.6 插件管理页 */
    pp_title: '插件管理', pp_back: '返回',
    pp_tab_loaded: '已加载', pp_tab_langs: '语言', pp_tab_settings: '设置',
    pp_hint: '插件文件放于 /sdcard/QingCode/plugins/*.js，放入后重启应用自动加载。',
    pp_none: '暂无插件。将 .js 插件文件放入上面的目录后重启应用。',
    pp_enabled: '已启用', pp_disabled: '已禁用', pp_enable: '启用', pp_disable: '禁用',
    pp_toggle_restart: '状态已保存，重启应用后生效',
    pp_lang_none: '暂无插件注册语言。',
    pp_lang_ext: '扩展名', pp_lang_name: '语言', pp_lang_by: '提供插件',
    pp_api_ver: '插件接口', pp_dir: '插件目录',
    pp_master: '启用插件系统（总开关）',
    pp_master_desc: '关闭后启动时不再加载任何插件（重启生效）。',
    pp_reserve: '预留：插件市场 / 在线安装 / 按插件权限授权等能力将在后续版本接入。',
    /* v4.6 启动页 */
    splash_py: '正在加载 Python 运行时…',
    splash_compile: '正在初始化解释器（首次较慢）…',
    splash_done: '就绪',
    splash_fail: 'Python 运行时加载失败',
    splash_skip: '跳过 →',
    splash_tip: '首次启动需编译运行时；v4.5 起支持编译缓存，之后启动更快',
    /* v4.9 跳过确认 + 设置页 + Termux 缺失提示 */
    splash_skip_title: '确认跳过加载？',
    splash_skip_body: '跳过后部分功能可能不可用，界面可能出现短暂卡顿；引擎仍在后台继续准备，就绪后自动可用。',
    spc_cancel: '继续等待',
    spc_ok: '确认跳过',
    sp_title: '设置',
    sp_search: '搜索设置…',
    sp_search_none: '未找到匹配的设置项',
    sp_tab_edit: '编辑',
    sp_tab_engine: '引擎与 Termux',
    sp_tab_file: '文件',
    sp_tab_general: '通用',
    termux_missing_banner: '未检测到 Termux：C++（Termux 编译）与 Termux Python 引擎暂不可用，仅可使用内置引擎与在线编译。安装 Termux 后重启应用即可解锁（设置 → 引擎与 Termux → 获取 Termux）。',
    run_need_termux: '未检测到 Termux，该功能不可用。请先安装 Termux（设置 → 引擎与 Termux → 获取 Termux），安装后重启应用。',
    /* v4.9 双引擎进度条 */
    splash_eng_py: 'Python 引擎',
    splash_eng_cpp: 'C++ 引擎 · Termux',
    splash_wait_py: '等待 Python 就绪…',
    splash_tx_check: '正在检测 Termux（python / clang）…',
    splash_tx_install: '组件缺失，正在自动安装（首次约 1~5 分钟）…',
    splash_tx_ready: '就绪',
    splash_tx_none: '未检测到 Termux，已跳过',
    splash_tx_bg: '仍在后台安装，先进入软件',
    splash_tx_fail: '检测失败，可进入后在菜单「配置 C++」重试',
    splash_tx_slow: '若 Termux 加载较慢，请先手动打开 Termux，再重新打开编辑器',
    /* 动态文案 */
    state_ready: '就绪', state_loading: '预加载中…', state_error: '加载失败', state_unloaded: '未加载',
    py_preloaded: 'Python 运行时预加载完成 ✓',
    autosave_off_txt: '定时自动保存（30 秒）：关',
    autosave_disabled: '定时自动保存已关闭（编辑内容仍保存在应用内）。',
    not_in_project: '当前不在项目空间（菜单 → 打开文件夹可开启）。',
    enc_switched: '文件编码已切换为 ', enc_switched2: '（作用于导出与项目自动保存）',
    new_file: '新建文件', rename: '重命名',
    delete_q: '删除文件 ', delete_q2: '？', delete_btn: '删除', irreversible: '此操作不可恢复',
    need_name: '请输入文件名', bad_chars: '文件名不能包含 \\ / : * ? " < > |', too_long: '文件名过长',
    dup_name: '同名文件已存在', bad_ext: '请使用 .py / .cpp / .c / .h / .txt 等扩展名',
    fname_eg: '如 demo.py 或 hello.cpp',
    perm_title: '需要「所有文件访问」权限', perm_ok: '前往设置开启',
    perm_desc: '即将打开系统设置页。\n请开启「所有文件访问」开关（允许管理所有文件），\n然后返回轻码编辑器，重新运行或检测即可。',
    termux_help: '在手机上配置真实 C++ 编译器（一次性操作）：\n'
      + '① 设置 → 引擎与 Termux →「环境向导 ① 获取 Termux」：GitHub 下载，或联系开发者索取安装包\n'
      + '② 设置 → 引擎与 Termux →「⚙️ 配置 C++」：按向导逐条复制命令到 Termux 执行（清华源 → 存储授权 → allow-external-apps → 安装 clang），完成后点「立即检测并自动配置」\n'
      + '③ 侧栏 C++ 变绿点即就绪。日常无需手动配置——应用每次启动都会自动检测并在后台安装（保持联网即可）\n'
      + '提示：首次编译 C++ 时若未装 clang，会自动执行 pkg install 安装。',
    reset_title: '恢复示例代码？', reset_ok: '恢复',
    reset_desc: '将重建 main.py 与 hello.cpp 示例（不影响其他文件）',
    only_android: '该功能仅在安卓应用内可用。\n',
    perm_missing: '缺少「所有文件访问」权限：交换目录不可写。\n',
    termux_missing: 'Termux 未安装：设置 → 引擎与 Termux →「环境向导 ① 获取 Termux」（GitHub 下载，或联系开发者）。\n',
    font: '字号',
    cpp_termux: '需配置 Termux', cpp_jscpp: '内置 JSCPP', cpp_online: '在线编译',
    src_ready: '📄 源代码已置于本应用目录：/sdcard/QingCode/源码/',
    src_pending: '📄 源代码已随应用打包，授予存储权限并重新打开应用后，将自动释放到 /sdcard/QingCode/源码/',
    welcome: '<h1>轻码编辑器</h1><p>QingCode · 移动端轻量代码编辑器</p><ul>'
      + '<li>支持 <b>Python</b> 与 <b>C++</b>（Termux 真实编译）</li>'
      + '<li>点击 <b>▶ 运行</b>，在下方终端中交互输入输出</li>'
      + '<li>右上角菜单：环境向导 / 引擎切换</li></ul>',
    about_tos: '<h4>用户协议</h4><ol>'
      + '<li><b>软件性质</b>：本应用为免费的学习型代码编辑器，供编程学习与日常练习使用，禁止用于任何违法违规用途。</li>'
      + '<li><b>数据与隐私</b>：你编写的代码与文件仅保存在设备本地，本应用不收集、不上传任何个人数据。</li>'
      + '<li><b>在线编译服务</b>：使用「在线编译」引擎时，当前代码与输入内容会发送至第三方公益编译服务（Wandbox / Judge0）处理，请勿提交涉密或敏感内容；介意者请改用离线引擎（Termux / 内置 Pyodide / JSCPP）。</li>'
      + '<li><b>第三方应用</b>：Termux 为独立开源应用，其安装、配置与使用遵循其自身许可条款；本应用仅通过其官方公开接口调用。</li>'
      + '<li><b>免责声明</b>：本应用按「现状」提供，不附带任何明示或默示担保；对因使用或无法使用本应用导致的任何直接或间接损失，开发者不承担责任。</li>'
      + '<li><b>条款生效</b>：安装并继续使用本应用即表示你已阅读并同意以上条款。</li></ol>',
    about_credits: '<h4>使用项目及致谢</h4><table>'
      + '<tr><td>CodeMirror 6</td><td>编辑器内核 · MIT License</td></tr>'
      + '<tr><td>Pyodide</td><td>CPython 3.12 WebAssembly · MPL-2.0</td></tr>'
      + '<tr><td>JSCPP</td><td>C++ 教学解释器 · MIT License</td></tr>'
      + '<tr><td>Wandbox</td><td>免费在线编译公益服务</td></tr>'
      + '<tr><td>Judge0 CE</td><td>免费在线执行公益服务</td></tr>'
      + '<tr><td>Termux</td><td>Android 终端环境（独立应用）· GPLv3</td></tr></table>'
      + '<p>感谢以上开源项目与公益服务的维护者——本应用得以建立在开源社区的成果之上。</p>',
    about_dev: '<h4>开发者信息</h4>'
      + '<p><b>开发者</b>：冯隽熙</p>'
      + '<p><b>开发方式</b>：人机协作——开发者提出整体架构并负责调试；<b>GLM 5.3Flash</b> 负责主要代码编写；<b>DeepSeek V4.1Flash</b> 负责 bug 修复与性能优化。</p>'
      + '<h4>开源协议</h4>'
      + '<p>本应用采用 <b>MIT License</b> 开源：允许自由使用、学习、修改与再分发（含商用），但须在副本中保留原作者版权声明与许可文本。</p>'
      + '<p class="dim">完整协议文本见源码目录下的 LICENSE 文件。</p>'
  },
  en: {
    doc_title: 'QingCode Editor',
    app_title: 'QingCode',
    t_menu_filelist: 'File list', t_run: 'Run', run: 'Run', t_more: 'More',
    explorer: 'Explorer', t_openfile: 'Open file', t_openfolder: 'Open folder (workspace)', t_newfile: 'New file',
    runtime: 'Runtime',
    terminal: 'Terminal', t_clear: 'Clear output', t_toggle: 'Collapse/Expand',
    out_hint: '// Terminal ready. Tap ▶ Run for the current file; if the program asks for input, use the popup or type below.',
    out_hint_ready: '// Terminal ready. Tap ▶ to run the current file.',
    ph_term: 'Type input here while the program runs; press Enter to send', send: 'Send',
    ph_fname: 'File name, e.g. demo.py or hello.cpp', cancel: 'Cancel', ok: 'OK', close: 'Close',
    dl_title: 'Get Termux',
    dl_desc: 'Termux provides real C++ compilation (one-time setup, fully offline afterwards)',
    dl_github: 'Download from GitHub', dl_email: 'Ask the developer for the APK',
    init_title: 'Initialize Termux', init_open: 'Open Termux',
    init_steps: '<b>Step 1 (recommended · faster in China)</b>: switch to the Tsinghua mirror — paste and run this command in Termux (long-press to copy):'
      + '<div class="init-cmd"><span class="no">1</span>echo "deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main" &gt; $PREFIX/etc/apt/sources.list</div>'
      + '<b>Step 2</b>: copy, paste and run the following 5 commands one by one — <b>finish one before copying the next</b>, do not mix them (long-press to copy):'
      + '<div class="init-cmd"><span class="no">2</span>termux-setup-storage</div>'
      + '<div class="init-note">↑ A permission prompt appears on first run — tap Allow</div>'
      + '<div class="init-cmd"><span class="no">3</span>mkdir -p ~/.termux</div>'
      + '<div class="init-cmd"><span class="no">4</span>echo "allow-external-apps=true" &gt;&gt; ~/.termux/termux.properties</div>'
      + '<div class="init-cmd"><span class="no">5</span>termux-reload-settings</div>'
      + '<div class="init-cmd"><span class="no">6</span>pkg install -y clang</div>'
      + '<div class="init-note">↑ When asked <b>(y/n)</b>, type <b>y</b> and press Enter (faster if Step 1 was done)</div>'
      + '<div class="init-cmd"><span class="no">7</span>echo \'\'; echo \'== Setup complete, return to QingCode ==\'</div>'
      + '<b>Step 3</b>: when you see "== Setup complete, return to QingCode ==", go back to this app, open "Settings → Engines & Termux → ⚙️ Configure C++" and tap "Detect now & auto-configure" (if prompted about permissions, allow "All files access").',
    about_name: 'QingCode',
    ab_tos: 'Terms of Service', ab_credits: 'Credits & Thanks', ab_dev: 'Developer & License',
    mi_rename: 'Rename current file', mi_delete: 'Delete current file', mi_export: 'Export current file',
    mi_fontp: 'Font +', mi_fontm: 'Font −',
    cpp_engine: 'C++ Engine', cpp_compiler: 'C++ Compiler', py_engine: 'Python Engine',
    eng_auto: 'Auto (Termux first)', eng_termux: 'Termux (real build)', eng_online: 'Online (free)',
    eng_jscpp: 'Built-in JSCPP (offline)', eng_pyodide: 'Built-in Pyodide (offline)',
    eng_py_termux: 'Termux Python (native · pip packages)',
    py_termux_switch: 'Python engine switched to: Termux Python (device-native interpreter, pip-install any third-party library; auto "pkg install python" on first run if missing — one-time network; fully separate from the C++ clang setup)',
    py_online_switch: 'Python engine switched to: Online (real build, needs network; input is collected in one shot)',
    py_pyodide_switch: 'Python engine switched to: Built-in Pyodide (offline, step-by-step interaction)',
    py_termux_done: 'Process finished, exit code {exit}, {secs} s [Termux python]',
    mi_openfolder: '📂 Open folder (workspace)', mi_openfile: '📄 Open file (local)',
    mi_closeproj: '✖ Close workspace', mi_saveall: '💾 Save all to project',
    mi_autosave: 'Autosave (30 s): On', encoding: 'Encoding',
    mi_term: 'Termux terminal session (embedded)', mi_tty: 'Run C++ interactively in Termux',
    mi_envdl: 'Setup ① Get Termux',
    mi_cfg_cpp: '⚙️ Configure C++ (compiler)', mi_cfg_py: '🐍 Configure Python (interpreter)',
    cfg_title: 'Environment Setup (manual fallback)',
    cfg_tab_cpp: 'C++ (clang compiler)', cfg_tab_py: 'Python (interpreter)',
    cfg_cpp_note: 'Real C++ builds need clang: the app auto-detects and auto-installs in the background on every launch (just stay online); this wizard is a manual fallback only.',
    cfg_py_note: 'Termux Python is the device-native interpreter (pip-install any third-party library). The app auto-detects and auto-installs in the background on every launch (just stay online); the default Python engine remains built-in Pyodide — switch via Menu → "Python engine".',
    cfg_py_steps: '<b>Way 1 (recommended)</b>: stay online — the app <b>auto-detects and auto-installs in the background</b> on every launch, no manual steps needed.'
      + '<b>Way 2 (manual)</b>: run in Termux one by one (long-press to copy):'
      + '<div class="init-cmd"><span class="no">1</span>pkg install -y python</div>'
      + '<div class="init-note">↑ When asked <b>(y/n)</b>, type <b>y</b> and press Enter (faster with the Tsinghua mirror)</div>'
      + '<div class="init-cmd"><span class="no">2</span>pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple</div>'
      + '<div class="init-note">↑ Optional: switch pip to the Tsinghua mirror for faster installs</div>'
      + '<b>Use</b>: Menu → "Python engine" → "Termux Python (native · pip packages)", then tap ▶ Run to use the real interpreter.',
    cfg_recheck: 'Detect now & auto-configure',
    mi_log: 'Export debug logs', mi_reset: 'Restore samples', mi_about: 'About',
    mi_plugins: '🧩 Plugin manager',
    /* v4.6 plugin manager page */
    pp_title: 'Plugin manager', pp_back: 'Back',
    pp_tab_loaded: 'Loaded', pp_tab_langs: 'Languages', pp_tab_settings: 'Settings',
    pp_hint: 'Plugin files live in /sdcard/QingCode/plugins/*.js — drop them in and restart the app to load.',
    pp_none: 'No plugins yet. Put .js plugin files into the folder above and restart the app.',
    pp_enabled: 'Enabled', pp_disabled: 'Disabled', pp_enable: 'Enable', pp_disable: 'Disable',
    pp_toggle_restart: 'Saved — takes effect after restarting the app',
    pp_lang_none: 'No languages registered by plugins.',
    pp_lang_ext: 'Extension', pp_lang_name: 'Language', pp_lang_by: 'Provided by',
    pp_api_ver: 'Plugin API', pp_dir: 'Plugin folder',
    pp_master: 'Enable plugin system (master switch)',
    pp_master_desc: 'When off, no plugins are loaded at startup (takes effect after restart).',
    pp_reserve: 'Reserved: plugin market / online install / per-plugin permissions will arrive in future versions.',
    /* v4.6 splash screen */
    splash_py: 'Loading Python runtime…',
    splash_compile: 'Initializing interpreter (slower on first run)…',
    splash_done: 'Ready',
    splash_fail: 'Failed to load the Python runtime',
    splash_skip: 'Skip →',
    splash_tip: 'First start compiles the runtime; compile caching (since v4.5) makes later starts faster',
    /* v4.9 skip-confirm + settings page + Termux-missing notice */
    splash_skip_title: 'Skip loading?',
    splash_skip_body: 'Some features may be unavailable and the UI may briefly stutter after skipping; engines keep preparing in the background and become ready automatically.',
    spc_cancel: 'Keep waiting',
    spc_ok: 'Skip anyway',
    sp_title: 'Settings',
    sp_search: 'Search settings…',
    sp_search_none: 'No matching settings',
    sp_tab_edit: 'Editor',
    sp_tab_engine: 'Engines & Termux',
    sp_tab_file: 'Files',
    sp_tab_general: 'General',
    termux_missing_banner: 'Termux not found: C++ (Termux build) and the Termux Python engine are unavailable — only built-in engines and online compilers work. Install Termux and restart the app to unlock them (Settings → Engines & Termux → Get Termux).',
    run_need_termux: 'Termux not found — this feature is unavailable. Install Termux first (Settings → Engines & Termux → Get Termux), then restart the app.',
    /* v4.9 dual-engine progress */
    splash_eng_py: 'Python engine',
    splash_eng_cpp: 'C++ engine · Termux',
    splash_wait_py: 'Waiting for Python…',
    splash_tx_check: 'Checking Termux (python / clang)…',
    splash_tx_install: 'Missing packages — installing (1-5 min on first run)…',
    splash_tx_ready: 'Ready',
    splash_tx_none: 'Termux not found, skipped',
    splash_tx_bg: 'Still installing in background — entering app',
    splash_tx_fail: 'Check failed — retry later via menu "Configure C++"',
    splash_tx_slow: 'If Termux loads slowly, open Termux manually first, then reopen this editor',
    /* dynamic */
    state_ready: 'Ready', state_loading: 'Loading…', state_error: 'Failed', state_unloaded: 'Not loaded',
    py_preloaded: 'Python runtime preloaded ✓',
    autosave_off_txt: 'Autosave (30 s): Off',
    autosave_disabled: 'Autosave disabled (edits are still kept inside the app).',
    not_in_project: 'Not in a workspace (Menu → Open folder to enable).',
    enc_switched: 'Encoding switched to ', enc_switched2: ' (applies to export & project autosave)',
    new_file: 'New File', rename: 'Rename',
    delete_q: 'Delete file ', delete_q2: '?', delete_btn: 'Delete', irreversible: 'This cannot be undone',
    need_name: 'Please enter a file name', bad_chars: 'File name cannot contain \\ / : * ? " < > |', too_long: 'File name too long',
    dup_name: 'A file with the same name already exists', bad_ext: 'Use an extension like .py / .cpp / .c / .h / .txt',
    fname_eg: 'e.g. demo.py or hello.cpp',
    perm_title: '"All files access" permission required', perm_ok: 'Open Settings',
    perm_desc: 'The system settings page will open.\nTurn on "All files access" (allow managing all files),\nthen return to QingCode and run or re-check again.',
    termux_help: 'Set up a real C++ compiler on your phone (one-time):\n'
      + '① Settings → Engines & Termux → "Setup ① Get Termux": download from GitHub, or ask the developer for the APK\n'
      + '② Settings → Engines & Termux → "⚙️ Configure C++": copy the wizard commands into Termux one by one (Tsinghua mirror → storage grant → allow-external-apps → clang install), then tap "Detect now & auto-configure"\n'
      + '③ A green dot next to C++ in the sidebar means ready. No manual setup needed day-to-day — the app detects and installs in the background on every launch (just stay online)\n'
      + 'Tip: if clang is missing on first C++ build, pkg install runs automatically.',
    reset_title: 'Restore sample code?', reset_ok: 'Restore',
    reset_desc: 'Recreates the main.py & hello.cpp samples (other files untouched)',
    only_android: 'This feature is only available inside the Android app.\n',
    perm_missing: 'Missing "All files access": the swap directory is not writable.\n',
    termux_missing: 'Termux not installed: Settings → Engines & Termux → "Setup ① Get Termux" (GitHub or ask the developer).\n',
    font: 'Font',
    cpp_termux: 'Termux required', cpp_jscpp: 'Built-in JSCPP', cpp_online: 'Online build',
    src_ready: '📄 Source code placed at: /sdcard/QingCode/源码/',
    src_pending: '📄 Source is bundled with the app. Grant storage permission and reopen to extract it to /sdcard/QingCode/源码/',
    welcome: '<h1>QingCode</h1><p>QingCode · Lightweight mobile code editor</p><ul>'
      + '<li><b>Python</b> and <b>C++</b> (real build via Termux)</li>'
      + '<li>Tap <b>▶ Run</b>, then interact in the terminal below</li>'
      + '<li>Top-right menu: setup guide / engine switch</li></ul>',
    about_tos: '<h4>Terms of Service</h4><ol>'
      + '<li><b>Nature</b>: this is a free learning-oriented code editor for study and practice; illegal use is prohibited.</li>'
      + '<li><b>Data & Privacy</b>: your code and files stay on your device only; the app collects and uploads no personal data.</li>'
      + '<li><b>Online compilation</b>: when using the online engine, the current code and input are sent to third-party public services (Wandbox / Judge0) — do not submit confidential or sensitive content; use offline engines instead if concerned (Termux / built-in Pyodide / JSCPP).</li>'
      + '<li><b>Third-party apps</b>: Termux is an independent open-source app governed by its own license; this app only calls its official public interface.</li>'
      + '<li><b>Disclaimer</b>: the app is provided "as is", without warranty of any kind; the developer is not liable for any direct or indirect loss arising from its use.</li>'
      + '<li><b>Effect</b>: installing and continuing to use this app means you have read and agreed to these terms.</li></ol>',
    about_credits: '<h4>Credits & Thanks</h4><table>'
      + '<tr><td>CodeMirror 6</td><td>Editor core · MIT License</td></tr>'
      + '<tr><td>Pyodide</td><td>CPython 3.12 WebAssembly · MPL-2.0</td></tr>'
      + '<tr><td>JSCPP</td><td>C++ teaching interpreter · MIT License</td></tr>'
      + '<tr><td>Wandbox</td><td>Free online compilation service</td></tr>'
      + '<tr><td>Judge0 CE</td><td>Free online execution service</td></tr>'
      + '<tr><td>Termux</td><td>Android terminal environment (standalone app) · GPLv3</td></tr></table>'
      + '<p>Thanks to the maintainers of the projects and services above — this app stands on the shoulders of the open-source community.</p>',
    about_dev: '<h4>Developer</h4>'
      + '<p><b>Developer</b>: Feng Junxi (冯隽熙)</p>'
      + '<p><b>How it is built</b>: human–AI collaboration — the developer designed the architecture and did the debugging; <b>GLM 5.3Flash</b> wrote the main code; <b>DeepSeek V4.1Flash</b> fixed bugs and optimized performance.</p>'
      + '<h4>License</h4>'
      + '<p>Released under the <b>MIT License</b>: free to use, study, modify and redistribute (commercially included), provided the original copyright notice and license text are kept in copies.</p>'
      + '<p class="dim">See the LICENSE file in the source directory for the full text.</p>'
  }
};

/* ---------- 核心 API ---------- */
let LANG = localStorage.getItem('pc_lang'); // null = 首启尚未选择
function t(k) {
  const d = LANG === 'en' ? I18N.en : I18N.zh;
  return d[k] != null ? d[k] : (I18N.zh[k] != null ? I18N.zh[k] : k);
}
function applyLang() {
  const lang = LANG === 'en' ? 'en' : 'zh';
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  document.title = t('doc_title');
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  // 动态文案刷新（app.js 已加载后调用安全）
  try {
    const sz = document.getElementById('status-size');
    if (sz && typeof fontSize === 'number') sz.textContent = t('font') + ' ' + fontSize;
    if (typeof syncProjectMenu === 'function') syncProjectMenu();
    if (typeof updateCppStateUi === 'function') updateCppStateUi();
    if (typeof setPyState === 'function' && typeof pyState !== 'undefined') setPyState(pyState);
    const oc = document.getElementById('output-log');
    if (oc && oc.querySelector('.out-hint') && oc.children.length === 1) oc.innerHTML = '<span class="out-hint">' + t('out_hint') + '</span>';
  } catch (e) {}
}
function chooseLang(l, persist) {
  LANG = l;
  if (persist !== false) localStorage.setItem('pc_lang', l);
  applyLang();
  const m = document.getElementById('lang-mask');
  if (m) m.classList.add('hidden');
}
/* 语言选择对话框（首启必选；菜单进入可取消） */
function showLangDialog(allowCancel) {
  const m = document.getElementById('lang-mask'), c = document.getElementById('lang-cancel');
  if (!m) return;
  if (c) c.classList.toggle('hidden', !allowCancel);
  m.classList.remove('hidden');
}
document.addEventListener('DOMContentLoaded', () => {
  const bz = document.getElementById('lang-zh'), be = document.getElementById('lang-en'), bc = document.getElementById('lang-cancel');
  if (bz) bz.addEventListener('click', () => chooseLang('zh'));
  if (be) be.addEventListener('click', () => chooseLang('en'));
  if (bc) bc.addEventListener('click', () => document.getElementById('lang-mask').classList.add('hidden'));
});
