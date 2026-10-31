/* ============================================================
 * 轻码编辑器 QingCode v3.0
 * CodeMirror 6 + Pyodide(Python WASM) + Termux Clang/GCC(交互式真实编译)
 * v3.0：交互式终端（对话框输入 / FIFO 管道实时交互 + 流式输出）
 *       启动提速（Pyodide 预加载 + assets 缓存 + md5 编译缓存）
 *       依赖自动安装（编译器缺失自动 pkg install + 环境向导）
 * ============================================================ */
'use strict';

/* ---------- 常量 ---------- */
const APP_VERSION = '5.10.1';
const PYODIDE_VERSION = '0.26.4';
/* v5.4.1 安全（审查 #6）：移除 jsDelivr 兜底——CDN 加载无 SRI，可被网络层替换；
   本项目自带 web/pyodide/，本地缺失时应直接报错而不是静默从外部拉取代码。 */
const PY_BASES = ['pyodide/'];
const CPP_WORKER_URL = 'vendor/cpp-worker.js';


const PY_DEFAULT_CODE = `import math

def is_prime(n):
    """判断素数"""
    if n < 2:
        return False
    for i in range(2, int(math.sqrt(n)) + 1):
        if n % i == 0:
            return False
    return True

name = input("你叫什么名字？")
print(f"你好，{name}！欢迎来到轻码编辑器")

print("100 以内的素数：")
primes = [n for n in range(2, 100) if is_prime(n)]
print(primes)
print(f"共 {len(primes)} 个")
`;

/* v3.0 示例：交互式（Termux 引擎支持运行中实时输入） */
const CPP_DEFAULT_CODE = `#include <iostream>
#include <vector>
#include <algorithm>
#include <string>
using namespace std;

// 完整 C++（Termux Clang 真实编译）· 支持运行中交互输入
int main() {
    cout << "=== 交互式 C++ 演示 ===" << endl;
    cout << "你的名字: " << flush;
    string name;
    getline(cin, name);

    int n;
    cout << "你好, " << name << "! 输入数字个数 N: " << flush;
    cin >> n;

    vector<int> nums(n);
    cout << "依次输入 " << n << " 个整数（每次回车）:" << endl;
    for (int i = 0; i < n; i++) {
        cout << "nums[" << i << "] = " << flush;
        cin >> nums[i];
    }
    sort(nums.begin(), nums.end());
    cout << "排序结果: ";
    for (int x : nums) cout << x << " ";
    cout << "\\n总和 = " << (nums.empty() ? 0 : nums.back() * n) << "（演示值）" << endl;
    return 0;
}
`;

const CPP_JSCPP_CODE = `#include <iostream>
#include <cmath>
using namespace std;

bool is_prime(int n) {
    if (n < 2) return false;
    for (int i = 2; i * i <= n; i++)
        if (n % i == 0) return false;
    return true;
}

int main() {
    cout << "Hello, QingCode!" << endl;
    int n;
    cout << "输入一个数 N: ";
    cin >> n;
    cout << n << " 以内的素数：" << endl;
    for (int i = 2; i <= n; i++)
        if (is_prime(i)) cout << i << " ";
    cout << endl;
    return 0;
}
`;

/* ---------- 全局状态 ---------- */
let cm = null;
let editorReady = false;
let pyodide = null;
let pyState = 'idle';
/* v4.10 内置 Python Worker 通道（终端式交互输入） */
let pyMode = null;               // 'worker' | 'main'（首次 ensurePyodide 时按环境决定）
let pyMainBlocked = false;       // v5.10.1：主线程回退已被禁用（安全审查 P0-4）
let pyWorker = null;
let pyWorkerOk = false;
let pyWorkerLoadPromise = null;
let pyWorkerCtl = null;          // {resolve, timeout, climb}
let pyWorkerBroken = false;      // worker 初始化失败 → 本会话回退主线程模式
let pySAB = null, pyCTRL = null, pyDATALEN = null;
let pyInputWait = false;         // worker 正在等待 input() 的终端输入
let pyRunDone = null;            // 当前 worker 运行的收尾 resolve
let pyOutCount = 0;              // worker 输出字节计数（32MB 失控保护）
let cppWorker = null;
let running = false;
let runningKind = null;          // 'python' | 'termux' | 'jscpp'
let fontSize = parseInt(localStorage.getItem('pc_fontsize') || '14', 10);
if (!(fontSize >= 10 && fontSize <= 28)) fontSize = 14;
/* v5.9.0：缩进宽度可配置（此前固定 4） */
let tabSize = parseInt(localStorage.getItem('pc_tab_size') || '4', 10);
if (!(tabSize >= 2 && tabSize <= 8)) tabSize = 4;
/* v5.4.1 安全（审查 #7）：默认 jscpp —— 不再默认把代码上传到在线编译器；
   需要 Termux/在线时由用户显式选择（设置页 → 引擎与 Termux）。 */
let cppEngine = localStorage.getItem('pc_cpp_engine') || 'jscpp';
let cppCompiler = localStorage.getItem('pc_cpp_compiler') || 'clang++';
let termuxEnv = null;
let cppRunning = false;          // Termux 交互运行中（终端输入可用）
let cppBeatTimer = null;         // Termux 响应心跳计时器
let pyEngine = localStorage.getItem('pc_py_engine') || 'pyodide';   // pyodide | termux | online

/* v4.0：项目空间 / 编码 / 终端会话 / 自动保存 */
let projectRoot = null;                                          // 项目根目录绝对路径（null=默认空间）
let autoSaveOn = localStorage.getItem('pc_autosave') !== 'off';  // 定时自动保存（默认开）
let exportEncoding = localStorage.getItem('pc_encoding') || 'UTF-8';
let termSessionActive = false;                                   // Termux 终端会话状态
let projectSaveTimer = null;

const $ = (id) => document.getElementById(id);
const state = loadStore();

/* ---------- 存储 ---------- */
function defaultFiles() {
  /* v5.7.0：_saved 是「磁盘/初始版本」基线，必须始终有值——否则未保存判据会把未知当成不脏 */
  return [
    { name: 'main.py', content: PY_DEFAULT_CODE, _saved: PY_DEFAULT_CODE },
    { name: 'hello.cpp', content: CPP_DEFAULT_CODE, _saved: CPP_DEFAULT_CODE }
  ];
}
function loadStore() {
  let files = null, ws = null;
  try { files = JSON.parse(localStorage.getItem('pc_files') || 'null'); } catch (e) { files = null; }
  try { ws = JSON.parse(localStorage.getItem('pc_workspace') || 'null'); } catch (e) { ws = null; }
  /* v5.6.0：有工作区待恢复时先给默认占位——项目内容以磁盘为准，不从 localStorage 反序列化
     v5.7.0：工作区元数据已迁到 IndexedDB，这里只做旧版残留的兜底 */
  if (ws && ws.root) return { files: defaultFiles(), active: 'main.py', tabs: ['main.py'] };
  /* v5.6.0：惰性文件的 content 是 null（内容不持久化），不能当成空文件加载，否则会被误保存为空 */
  files = (Array.isArray(files) ? files : []).filter(f => f && f.name && typeof f.content === 'string');
  if (!files.length) files = defaultFiles();
  /* v5.7.0：补齐 _saved 基线（旧数据 / 默认文件可能没有），否则「未保存」判据永远为假 */
  for (const f of files) if (typeof f._saved !== 'string') f._saved = f.content;
  let active = localStorage.getItem('pc_active');
  if (!files.some(f => f.name === active)) active = files[0].name;
  /* v5.7.0 多标签：恢复上次打开的标签集合（仅保留仍然存在的文件） */
  let tabs = null;
  try { tabs = JSON.parse(localStorage.getItem('pc_tabs') || 'null'); } catch (e) { tabs = null; }
  tabs = (Array.isArray(tabs) ? tabs : []).filter(n => typeof n === 'string' && files.some(f => f.name === n));
  if (!tabs.length) tabs = [active];
  if (tabs.indexOf(active) < 0) tabs.push(active);
  return { files, active, tabs };
}
function saveStore() {
  try {
    /* v5.6.0：项目模式不把文件内容塞进 localStorage（内容在磁盘上，惰性文件为 null） */
    const forStore = projectMode()
      ? state.files.map(f => ({ name: f.name, content: null, _size: f._size == null ? null : f._size }))
      : state.files;
    localStorage.setItem('pc_files', JSON.stringify(forStore));
    localStorage.setItem('pc_active', state.active || '');
    localStorage.setItem('pc_tabs', JSON.stringify(state.tabs || []));
    localStorage.setItem('pc_fontsize', String(fontSize));
    localStorage.setItem('pc_tab_size', String(tabSize));
    localStorage.setItem('pc_cpp_engine', cppEngine);
    localStorage.setItem('pc_cpp_compiler', cppCompiler);
    localStorage.setItem('pc_py_engine', pyEngine);
    localStorage.setItem('pc_encoding', exportEncoding);
    localStorage.setItem('pc_autosave', autoSaveOn ? 'on' : 'off');
    saveWorkspaceMeta();   // v5.5.0：工作区元数据（不含内容），重启后据此恢复
  } catch (e) {
    /* v5.7.0：配额不足 / 存储被禁用时不再只写 console —— 状态栏 + 终端都要能看见 */
    console.warn('save failed', e);
    storeIssue(t('store_meta_fail'));
  }
}
/* ---------- v5.7.0 存储异常可见化 ---------- */
const storeIssues = new Set();
/** 在状态栏亮出存储异常；同一类问题只在终端提示一次 */
function storeIssue(msg) {
  const el = $('status-store');
  if (el) { el.textContent = '⚠ ' + msg; el.title = msg; el.classList.remove('hidden'); }
  if (!storeIssues.has(msg)) { storeIssues.add(msg); outAppend('⚠ ' + msg + '\n', 'out-err'); }
}
function storeOk() {
  const el = $('status-store');
  if (el) { el.classList.add('hidden'); el.textContent = ''; el.removeAttribute('title'); }
}

/* ---------- 语言 ---------- */
function langOf(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.py')) return 'python';
  if (n.endsWith('.cpp') || n.endsWith('.cc') || n.endsWith('.cxx') ||
      n.endsWith('.hpp') || n.endsWith('.h') || n.endsWith('.c')) return 'cpp';
  return null;
}
function langLabel(lang) { return lang === 'python' ? 'Python' : lang === 'cpp' ? 'C++' : t('lang_text'); }
/* v5.0：高亮语言与可运行语言解耦——js/json/html/css/markdown 只高亮、不参与运行分流 */
function hlLangOf(name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.py')) return 'python';
  if (/\.(cpp|cc|cxx|hpp|hh|h|c)$/.test(n)) return 'cpp';
  if (n.endsWith('.json')) return 'json';
  if (/\.(js|mjs|cjs|ts)$/.test(n)) return 'javascript';
  if (/\.(html|htm)$/.test(n)) return 'html';
  if (n.endsWith('.css')) return 'css';
  if (/\.(md|markdown)$/.test(n)) return 'markdown';
  return null;
}

/* ---------- 工具 ---------- */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('load fail: ' + src));
    document.head.appendChild(s);
  });
}
async function urlExists(url) {
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch { return false; }
}

/* ---------- 终端输出 ---------- */
/* v5.4.3 修复（审查 #19）：逐行输出会为每个 chunk 建一个 <span>，十万行即十万 DOM 节点，
   长时间运行会把终端拖到卡死。保留最近 MAX_OUT_NODES 个节点（滚动缓冲语义）。 */
const MAX_OUT_NODES = 4000;
const MAX_OUT_BYTES = 1536 * 1024;   // v5.10.0：字节上限（与节点上限并行，死循环打印时两道闸）
let outPending = [];                  // 待刷新的片段（同一任务内的多次输出合并成一次 DOM 写入）
let outPendingChars = 0;
let outScheduled = false;
let outCharsNow = 0;
function outFlush() {
  outScheduled = false;
  if (!outPending.length) return;
  const log = $('output-log');
  if (!log) { outPending = []; outPendingChars = 0; return; }
  const hint = log.querySelector('.out-hint'); if (hint) hint.remove();
  // 相邻同类片段先合并：循环打印 10 万行 → 一个文本节点，而不是 10 万个 <span>
  const runs = [];
  for (const it of outPending) {
    const last = runs[runs.length - 1];
    if (last && last.cls === it.cls) last.text += it.text;
    else runs.push({ cls: it.cls, text: it.text });
  }
  outPending = []; outPendingChars = 0;
  const frag = document.createDocumentFragment();
  for (const r of runs) {
    /* 单段就超过总上限（例如一次推送几 MB）：只保留尾部，否则字节上限形同虚设 */
    let text = r.text;
    if (text.length > MAX_OUT_BYTES) {
      text = '…（前 ' + Math.round((text.length - MAX_OUT_BYTES) / 1024) + 'KB 已省略）\n'
        + text.slice(text.length - MAX_OUT_BYTES);
    }
    const span = document.createElement('span');
    if (r.cls) span.className = r.cls;
    span.textContent = text;
    frag.appendChild(span);
    outCharsNow += text.length;
  }
  log.appendChild(frag);
  /* 双上限：节点数（滚动缓冲语义）+ 字符数（单个节点就能撑爆内存的情形） */
  while (log.childNodes.length > MAX_OUT_NODES) {
    const n = log.firstChild;
    outCharsNow -= (n.textContent || '').length;
    log.removeChild(n);
  }
  while (outCharsNow > MAX_OUT_BYTES && log.childNodes.length > 1) {
    const n = log.firstChild;
    outCharsNow -= (n.textContent || '').length;
    log.removeChild(n);
  }
  const v = $('output-view');
  if (v) v.scrollTop = v.scrollHeight;
}
function outAppend(text, cls) {
  const str = String(text == null ? '' : text);
  if (!str) return;
  const c = cls || '';
  const last = outPending[outPending.length - 1];
  /* 入队时先合并同类：避免「一个任务内推 10 万行」把队列撑成 10 万个对象 */
  if (last && last.cls === c) {
    last.text += str;
    outPendingChars += str.length;
    /* 同类合并不能无上限增长：超过总上限就只留尾部 */
    if (last.text.length > MAX_OUT_BYTES) {
      outPendingChars -= last.text.length - MAX_OUT_BYTES;
      last.text = last.text.slice(last.text.length - MAX_OUT_BYTES);
    }
  }
  else { outPending.push({ text: str, cls: c }); outPendingChars += str.length; }
  /* 队列本身也不能无限涨：超过字节上限就丢掉前面积压的 */
  while (outPendingChars > MAX_OUT_BYTES && outPending.length > 1) {
    outPendingChars -= outPending[0].text.length;
    outPending.shift();
  }
  if (!outScheduled) { outScheduled = true; queueMicrotask(outFlush); }
}
function outClear() {
  outPending = []; outPendingChars = 0; outScheduled = false; outCharsNow = 0;
  $('output-log').innerHTML = '<span class="out-hint">' + t('out_hint_ready') + '</span>';
}
function outMeta(text) { outAppend(text + '\n', 'out-meta'); logAppend(text); }

/* ============================================================
 * v5.9.0：底部三个面板 —— 终端（程序输出）/ 输出（状态消息）/ 问题（诊断）
 * 终端保持原有行为；状态消息另存一份到「输出」；诊断另存一份到「问题」并支持点击跳转。
 * ============================================================ */
let panelTab = 'term';
const LOG_MAX_LINES = 500;
const logLines = [];
function logAppend(text) {
  const s = String(text == null ? '' : text);
  if (!s) return;
  logLines.push(s);
  while (logLines.length > LOG_MAX_LINES) logLines.shift();
  const v = $('log-view');
  if (v) {
    v.textContent = logLines.join('\n');
    const pane = $('panel-log');
    if (pane && panelTab === 'log') pane.scrollTop = pane.scrollHeight;
  }
}
let panelProblems = [];
function setPanelProblems(list) {
  panelProblems = (list || []).map(function (e) {
    return { line: e.line || 1, col: e.col || 1, message: e.message || '' };
  });
  renderProblems();
}
function renderProblems() {
  const box = $('prob-list');
  if (!box) return;
  box.innerHTML = '';
  const badge = $('prob-count');
  if (!panelProblems.length) {
    const em = document.createElement('div'); em.className = 'pp-empty'; em.textContent = t('pn_no_problems');
    box.appendChild(em);
    if (badge) { badge.classList.add('hidden'); badge.textContent = '0'; }
    return;
  }
  if (badge) { badge.classList.remove('hidden'); badge.textContent = String(panelProblems.length); }
  panelProblems.forEach(function (p) {
    const b = document.createElement('button');
    b.className = 'prob-row'; b.type = 'button';
    const loc = document.createElement('span'); loc.className = 'prob-loc'; loc.textContent = 'L' + p.line + ':' + p.col;
    const msg = document.createElement('span'); msg.className = 'prob-msg'; msg.textContent = p.message;
    b.appendChild(loc); b.appendChild(msg);
    b.addEventListener('click', function () {
      if (typeof EditorAPI !== 'undefined' && EditorAPI.gotoLine) EditorAPI.gotoLine(p.line, p.col);
    });
    box.appendChild(b);
  });
}
function switchPanelTab(id) {
  panelTab = id;
  const map = { term: ['ptab-output', 'output-view'], log: ['ptab-log', 'panel-log'], problems: ['ptab-problems', 'panel-problems'] };
  Object.keys(map).forEach(function (k) {
    const btn = $(map[k][0]), pane = $(map[k][1]);
    if (btn) btn.classList.toggle('active', k === id);
    if (pane) pane.classList.toggle('hidden', k !== id);
  });
  const row = $('term-input-row');
  if (row) row.classList.toggle('hidden', id !== 'term');
}
function outEcho(text) { outAppend('> ' + text + '\n', 'out-echo'); }

function setPyState(s, text) {
  pyState = s;
  $('dot-py').className = 'dot ' + (s === 'ready' ? 'ok' : s === 'loading' ? 'busy' : '');
  $('py-state').textContent = text || (s === 'ready' ? t('state_ready') : s === 'loading' ? t('state_loading') : s === 'error' ? t('state_error') : t('state_unloaded'));
}
function cppEngineName() {
  const m = resolveCppEngine(true);
  return m === 'termux' ? ('Termux ' + cppCompiler)
       : m === 'online' ? t('cpp_online')
       : m === 'unavail' ? t('cpp_termux') : t('cpp_jscpp');
}
function updateCppStateUi() {
  const m = resolveCppEngine(true);
  $('cpp-state').textContent = cppEngineName();
  $('dot-cpp').className = 'dot ' + (m === 'termux' ? 'ok' : m === 'unavail' ? 'busy' : '');
  const se = $('sel-cpp-engine'); if (se) se.value = cppEngine;
  const sc = $('sel-cpp-compiler'); if (sc) sc.value = cppCompiler;
  const sp = $('sel-py-engine'); if (sp) sp.value = pyEngine;
}

/* ---------- C++ 引擎解析 ---------- */
function resolveCppEngine(silent) {
  if (cppEngine === 'jscpp') return 'jscpp';
  if (cppEngine === 'online') return 'online';
  const termuxOk = !!(window.Android && Android.runCpp && termuxEnv && termuxEnv.termux && termuxEnv.storage);
  if (cppEngine === 'termux') return termuxOk ? 'termux' : 'unavail';
  if (cppEngine === 'auto') {
    if (!window.Android || !Android.runCpp) return 'jscpp';
    if (termuxOk) return 'termux';
    /* v5.4.3 修复（审查 #4）：auto 在缺少 Termux 时一律回退内置 JSCPP。
       旧逻辑「有网 → online」会在用户不知情时把源码上传到 Wandbox/Judge0，
       与 v5.4.1「默认不上传代码」的承诺、以及 runCurrent 的错误提示文案都矛盾。
       在线引擎必须由用户在设置里显式选择。 */
    return 'jscpp';
  }
  return 'jscpp';
}

/* ---------- 在线编译（免费公益 API：Wandbox 主 + Judge0 备） ---------- */
const WB_COMPILER = { python: 'cpython-3.13.8', 'c++': 'gcc-head' };
const JUDGE0_LANG = { python: 71, 'c++': 54 };   // 54=C++(GCC) 71=Python 3.8
function b64encodeUtf8(s) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}
function b64decodeUtf8(s) {
  if (!s) return '';
  const bin = atob(s); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
async function runWandbox(lang, code, stdin, signal) {
  const r = await fetch('https://wandbox.org/api/compile.json', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: signal || undefined,
    body: JSON.stringify({
      compiler: WB_COMPILER[lang], code: code, stdin: stdin || '', save: false,
      options: lang === 'python' ? '' : '-Wall -O2 -std=c++17'
    })
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  if (d.signal) throw new Error('程序被信号终止 (' + d.signal + ')');
  return {
    stdout: d.program_output || '',
    stderr: (d.compiler_error || '') + (d.program_error || ''),
    code: parseInt(d.status, 10) || 0
  };
}
async function runJudge0(lang, code, stdin, signal) {
  const r = await fetch('https://ce.judge0.com/submissions?base64_encoded=true&wait=true', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: signal || undefined,
    body: JSON.stringify({
      language_id: JUDGE0_LANG[lang],
      source_code: b64encodeUtf8(code),
      stdin: b64encodeUtf8(stdin || '')
    })
  });
  if (r.status === 429) throw new Error('限流，请稍后重试');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  if (d.error) throw new Error(d.error);
  const st = d.status && d.status.id;
  if (st === 6) return { stdout: '', stderr: b64decodeUtf8(d.compile_output) + b64decodeUtf8(d.stderr || ''), code: 1 };
  if (st === 5) throw new Error('云端运行超时');
  return {
    stdout: b64decodeUtf8(d.stdout || ''),
    stderr: b64decodeUtf8(d.stderr || '') || b64decodeUtf8(d.compile_output || ''),
    code: st === 3 ? 0 : 1
  };
}
async function runOnlineExe(lang, code, stdin) {
  onlineAbort = new AbortController();
  const signal = onlineAbort.signal;
  try {
    try { return await runWandbox(lang, code, stdin, signal); }
    catch (e1) {
      if (e1 && e1.name === 'AbortError') throw e1;
      try { return await runJudge0(lang, code, stdin, signal); }
      catch (e2) {
        if (e2 && e2.name === 'AbortError') throw e2;
        throw new Error('Wandbox (' + (e1.message || e1) + ') 与 Judge0 (' + (e2.message || e2) + ') 均失败');
      }
    }
  } finally { onlineAbort = null; }
}
function probeTermux() {
  if (!(window.Android && Android.getEnv)) termuxEnv = { termux: false, storage: false, message: '浏览器环境' };
  else {
    try { termuxEnv = JSON.parse(Android.getEnv()); }
    catch (e) { termuxEnv = { termux: false, storage: false, message: '检测失败' }; }
  }
  applyTermuxAvailability();
  updateCppStateUi();
  if (state.active) updateEngineStatus();   // v5.4.3：只刷新状态栏，不再重开文件（避免清掉错误标注）
}

/* ---------- v4.9：Termux 可用性 —— 未安装则取消所有 Termux 编译项目，仅保留内置/在线引擎 ---------- */
let termuxMissing = false;
function applyTermuxAvailability() {
  termuxMissing = !(termuxEnv && termuxEnv.termux);
  // 引擎下拉：未装 Termux 时禁用全部 Termux 相关选项
  const cppSel = $('sel-cpp-engine'), pySel = $('sel-py-engine');
  if (cppSel) [...cppSel.options].forEach(o => { if (o.value === 'termux') o.disabled = termuxMissing; });
  if (pySel) [...pySel.options].forEach(o => { if (o.value === 'termux') o.disabled = termuxMissing; });
  // 已保存的选择是 Termux → 强制回退到可用引擎（C++ 用 auto 自动降级，Python 回内置 Pyodide）
  if (termuxMissing) {
    if (cppSel && cppSel.value === 'termux') { cppEngine = 'auto'; cppSel.value = 'auto'; }
    if (pySel && pySel.value === 'termux') { pyEngine = 'pyodide'; pySel.value = 'pyodide'; }
    saveStore();
    updateCppStateUi();
  }
}
/** Termux 类功能的统一拦截：未安装时给出明确提示并阻止执行 */
function guardTermux() {
  if (!termuxMissing) return true;
  outAppend('⚠ ' + t('run_need_termux') + '\n', 'out-err');
  outMeta(t('run_need_termux'));
  return false;
}

/* ---------- 交互输入 ---------- */
/** 同步获取一行输入：安卓原生对话框 / 浏览器 prompt；取消 => null（EOF） */
function interactInput(promptText) {
  let v;
  if (window.Android && Android.requestInput) {
    v = Android.requestInput(promptText || '程序请求输入', '');
  } else {
    v = window.prompt(promptText || '程序请求输入：');
  }
  const isEof = (v === null || v === undefined);   // v4.11.2：区分「取消（EOF）」与「输入空行」
  if (isEof) outAppend('(EOF，输入被取消)\n', 'out-err');
  else outEcho(String(v));
  /* v5.4.3 修复（审查 #5）：EOF 必须回传 null 才能让 Pyodide 的 stdin 协议与
     Python 侧包装都识别为「流结束」；返回 '' 会被当成用户敲了一个空行。 */
  return isEof ? null : String(v);
}
/** 多行一次性输入（内置 JSCPP 兜底用） */
function collectMultiInput() {
  if (window.Android && Android.requestMultiInput) {
    return Android.requestMultiInput('', '') || '';
  }
  const lines = [];
  for (;;) {
    const v = window.prompt('内置引擎为一次性输入。\n已收集 ' + lines.length + ' 行，留空或取消结束：');
    if (v === null || v === '') break;
    lines.push(v);
    if (lines.length >= 50) break;
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}

/* v4.9.4/v4.10：重写内置 Python 的 input()——把 input("提示") 括号里的提示语传进输入对话框并回显到输出区。
   仅在「主线程回退模式」（环境不支持 Worker+SAB）下使用；Worker 模式用原生 input()（提示语走 stdout 实时回显）。
   注意：input 闭包必须经工厂函数捕获 js 导入（v4.9.4 曾直接 del _pi 导致运行时 NameError）。 */
function patchPyodideInput(py) {
  try {
    window.__pcInteractInput = function (promptText) {
      const p = (promptText === null || promptText === undefined) ? '' : String(promptText);
      if (p) outAppend(p);   // 模拟真实终端：提示语先出现在输出区，输入回显随后
      return interactInput(p || '程序请求输入：');
    };
    py.runPython(
      'import builtins as _b\n' +
      'def _pc_make_input():\n' +
      '    from js import __pcInteractInput as _f\n' +
      '    def _pc_input(prompt=""):\n' +
      '        v = _f(prompt)\n' +
      '        if v is None:\n' +
      '            raise EOFError("EOF when reading a line")\n' +
      '        return v\n' +
      '    return _pc_input\n' +
      '_b.input = _pc_make_input()\n' +
      'del _b, _pc_make_input\n');
  } catch (e) { console.warn('[pyodide] input() patch failed', e); }
}

/* v5.9.0：主线程回退模式下的中断支持。
   Pyodide 提供 setInterruptBuffer：往共享缓冲写 2，运行中的 Python 会抛 KeyboardInterrupt。
   此前主线程模式只能提示「无法中断」，现在可以真正打断无限循环。 */
let pyInterrupt = null;
function ensurePyInterrupt(py) {
  if (pyInterrupt) return true;
  try {
    if (!py || typeof py.setInterruptBuffer !== 'function') return false;
    if (typeof SharedArrayBuffer === 'undefined') return false;
    pyInterrupt = new Int32Array(new SharedArrayBuffer(4));
    py.setInterruptBuffer(pyInterrupt);
    return true;
  } catch (e) { pyInterrupt = null; return false; }
}
function interruptMainThreadPy() {
  if (!pyInterrupt) return false;
  try { Atomics.store(pyInterrupt, 0, 2); } catch (e) { return false; }
  /* 中断送达后要把标志清掉，否则下一次运行会立即再抛 KeyboardInterrupt */
  setTimeout(function () { try { Atomics.store(pyInterrupt, 0, 0); } catch (e) {} }, 1200);
  return true;
}

/* ---------- CodeMirror 6 ---------- */
let cursorRaf = null, cursorL = 1, cursorC = 1;
let curHlLang = undefined;   /* v5.4.3：记录编辑器当前的语言包，供 openFile 判断是否需要重配 */
const BIG_FILE_BYTES = 800 * 1024;   /* v5.4：超过 800KB 进入「大文件模式」 */
function isBigFile(name) {
  const f = state.files.find(x => x.name === name);
  if (!f) return false;
  /* v5.6.0：惰性文件还没有内容，用元数据里的体积估算 */
  if (f.content != null) return f.content.length > BIG_FILE_BYTES;
  return (f._size || 0) > BIG_FILE_BYTES;
}
async function initEditor() {
  await loadScript('vendor/cm6.js');
  const f = state.files.find(x => x.name === state.active) || state.files[0];
  cm = PCCM.create($('editor-container'), {
    doc: f.content,
    lang: hlLangOf(f.name),
    fontSize: fontSize,
    onChange: (t, up) => {
      const cur = state.files.find(x => x.name === state.active);
      if (cur) { cur.content = t; scheduleSave(); }
      if (up && up.docChanged) {
        clearErrorsTouchedBy(up);   // v4.1.1：编辑过的标红行立即取消标红
        try { LS.bump(LS.uriOf()); } catch (e) {}   // v5.9.0：文档版本 +1，过期分析结果会被丢弃
        pcEmit('docChange', { text: t, update: up });
        refreshActiveTabDirty();    // v5.7.0：标签上的未保存圆点
      }
    },
    onCursor: (l, c) => {
      /* v5.4 性能：光标移动是高频事件，用 rAF 合并为每帧最多一次 DOM 写入 */
      cursorL = l; cursorC = c;
      if (cursorRaf) return;
      cursorRaf = requestAnimationFrame(() => {
        cursorRaf = null;
        $('status-cursor').textContent = 'Ln ' + cursorL + ', Col ' + cursorC;
        pcEmit('selection', { line: cursorL, col: cursorC });
      });
    }
  });
  editorReady = true;
  try { PCCM.setTabSize(cm, tabSize); } catch (e) {}   // v5.9.0：按用户设置初始化缩进
  curHlLang = hlLangOf(f.name);
  try { applyWallpaper(loadWallpaper()); } catch (e) {}   /* v5.4 恢复壁纸 */
  openFile(f.name);
  renderToolbar();
}
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () { saveStore(); scheduleDraft(); }, 400);
}

/* ---------- v5.7.0 多标签 + 每文件 EditorState ----------
 * 单个 EditorView 复用；每个标签保存自己的 EditorState（选区 / 撤销历史 / 折叠等）
 * 与滚动位置，切回来时 setState 还原，撤销栈也一并回来。
 * 内存：每标签多存一份文档 rope + 历史，所以标签数设上限，超出淘汰最久未用的非活动标签。 */
const MAX_TABS = 12;
const viewStates = new Map();   // name -> { state, scrollTop }

function tabList() { if (!Array.isArray(state.tabs)) state.tabs = []; return state.tabs; }

/** 把文件加入标签集合；超出上限时淘汰最久未用的非活动标签 */
function ensureTab(name) {
  const tabs = tabList();
  if (tabs.indexOf(name) < 0) tabs.push(name);
  while (tabs.length > MAX_TABS) {
    const idx = tabs.findIndex(n => n !== state.active && n !== name);
    if (idx < 0) break;
    const gone = tabs.splice(idx, 1)[0];
    viewStates.delete(gone);
  }
}
function dropTab(name) {
  const tabs = tabList();
  const i = tabs.indexOf(name);
  if (i >= 0) tabs.splice(i, 1);
  viewStates.delete(name);
}
/** 只刷新活动标签的「未保存」小圆点（输入时不重建整个标签栏） */
function refreshActiveTabDirty() {
  const box = $('tabs');
  if (!box) return;
  const f = state.files.find(x => x.name === state.active);
  if (!f) return;
  const dirty = (f.content !== null && f._saved !== undefined && f._saved !== null && f.content !== f._saved);
  for (const tab of box.children) {
    if (!tab.classList || !tab.classList.contains('active')) continue;
    const dot = tab.querySelector('.dot-dirty');
    if (dirty && !dot) {
      const d = document.createElement('span');
      d.className = 'dot-dirty'; d.title = t('tab_dirty');
      const nameEl = tab.querySelector('.fname');
      tab.insertBefore(d, nameEl || null);
    } else if (!dirty && dot) dot.remove();
  }
}

/** 记住当前文件的视图状态（切换前调用） */
function captureViewState(name) {
  if (!cm || !name || !cm.state) return;
  try {
    viewStates.set(name, {
      state: cm.state,
      scrollTop: cm.scrollDOM ? cm.scrollDOM.scrollTop : 0
    });
  } catch (e) { console.warn('[tabs] capture failed', e); }
  /* 只保留仍开着的标签的状态，避免关闭/淘汰后残留 */
  const keep = tabList();
  for (const k of Array.from(viewStates.keys())) if (keep.indexOf(k) < 0) viewStates.delete(k);
}
/** 还原视图状态；文档内容已变（外部改过 / 草稿合并 / 插件写入）时作废并返回 false */
function restoreViewState(name, f) {
  const vs = viewStates.get(name);
  if (!vs || !vs.state) return false;
  let same = false;
  try { same = vs.state.doc.toString() === f.content; } catch (e) { same = false; }
  if (!same) { viewStates.delete(name); return false; }
  try {
    cm.setState(vs.state);
    /* setState 会带回保存时的 facet 值；字号 / 缩进 / 插件扩展是全局的，按当前值重配一次 */
    try { PCCM.setFontSize(cm, fontSize); } catch (e) {}
    try { PCCM.setTabSize(cm, tabSize); } catch (e) {}
    try { if (PCCM.setPluginExtensions) PCCM.setPluginExtensions(cm, cm.__pcPluginExts || []); } catch (e) {}
    curHlLang = hlLangOf(name);
    const top = vs.scrollTop || 0;
    requestAnimationFrame(() => { try { cm.scrollDOM.scrollTop = top; } catch (e) {} });
    return true;
  } catch (e) {
    console.warn('[tabs] restore failed', e);
    viewStates.delete(name);
    return false;
  }
}

/** 渲染标签栏（显示 basename，完整路径在 title 里） */
function renderTabs() {
  const box = $('tabs');
  if (!box) return;
  box.innerHTML = '';
  for (const name of tabList()) {
    const f = state.files.find(x => x.name === name);
    if (!f) continue;
    const tab = document.createElement('div');
    tab.className = 'tab' + (name === state.active ? ' active' : '');
    tab.title = name;
    const lang = langOf(name);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
    svg.innerHTML = '<path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>';
    svg.style.color = lang === 'python' ? '#4B8BBE' : lang === 'cpp' ? '#7aa2f7' : '#888';
    const span = document.createElement('span');
    span.className = 'fname';
    span.textContent = name.split('/').pop();
    tab.appendChild(svg);
    /* 未保存指示：与保存逻辑同一判据（惰性文件 content 为 null 不算脏） */
    if (f.content !== null && f._saved !== undefined && f._saved !== null && f.content !== f._saved) {
      const dot = document.createElement('span'); dot.className = 'dot-dirty'; dot.title = t('tab_dirty');
      tab.appendChild(dot);
    }
    tab.appendChild(span);
    const x = document.createElement('button');
    x.className = 'tab-x'; x.textContent = '×'; x.title = t('close');
    x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(name); });
    tab.appendChild(x);
    tab.addEventListener('click', () => { if (name !== state.active) openFile(name); });
    box.appendChild(tab);
  }
  const act = box.querySelector('.tab.active');
  if (act && act.scrollIntoView) { try { act.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
}

/** 关闭标签：只关视图，不删文件；至少保留一个（否则编辑器没有活动文档） */
function closeTab(name) {
  const tabs = tabList();
  if (tabs.length <= 1) { outMeta(t('tab_keep_one')); return; }
  const i = tabs.indexOf(name);
  if (i < 0) return;
  const wasActive = (name === state.active);
  if (wasActive && cm) captureViewState(name);
  dropTab(name);
  if (wasActive) {
    const next = tabs[Math.min(i, tabs.length - 1)];
    openFile(next);
  } else {
    renderTabs();
    saveStore();
  }
}

function openFile(name) {
  const f = state.files.find(x => x.name === name);
  if (!f) return;
  /* v5.6.0：惰性文件首次打开才读磁盘；读失败时不切换活动文件，避免把空内容当成文件内容写回去 */
  if (f.content === null && !ensureContent(f)) {
    outAppend('无法读取文件：' + name + '（可能已被移动、删除或超过 1MB）\n', 'out-err');
    return;
  }
  const prev = state.active;
  try { if (prev !== name) LS.bump(LS.uriOf(name)); } catch (e) {}   // v5.9.0：换文件即新版本
  if (cm && prev && prev !== name) captureViewState(prev);
  state.active = name;
  ensureTab(name);
  const lang = langOf(name);
  const hlLang = hlLangOf(name);
  if (typeof EditorAPI !== 'undefined' && EditorAPI) EditorAPI._ownLang = null;
  if (cm) {
    const restored = (prev !== name) ? restoreViewState(name, f) : false;
    /* v5.4.3 修复（审查 #9）：内容相同但语言不同时也必须重配语言包，
       否则两个空文件互切（a.py ↔ b.cpp）会停留在上一个文件的高亮上，
       而状态栏已显示新语言。 */
    if (!restored && (f.content !== cm.state.doc.toString() || hlLang !== curHlLang)) {
      viewStates.delete(name);            // 内容已变，旧视图状态作废
      PCCM.setDoc(cm, f.content, hlLang);
      curHlLang = hlLang;
    }
  }
  clearCodeErrors();
  renderTabs();
  $('welcome').classList.add('hidden');
  updateEngineStatus();
  renderFileList();
  saveStore();
  pcEmit('fileOpen', { name: name, lang: hlLang });
}
/** v5.4.3：状态栏的语言/引擎文案单独抽出——probeTermux 只需刷新这一处，
 *  不再走 openFile()（那会 clearCodeErrors 并把整个文件列表 + localStorage 重写一遍）。 */
function updateEngineStatus() {
  const lang = langOf(state.active);
  $('status-lang').textContent = langLabel(lang);
  $('status-engine').textContent = lang === 'python'
    ? (pyEngine === 'online' ? '在线编译（真实编译）' : pyEngine === 'termux' ? 'Termux Python（原生 CPython）' : 'Pyodide (WebAssembly)')
    : lang === 'cpp' ? (cppEngineName() + (resolveCppEngine(true) === 'termux' ? ' · 真实编译 · 可交互' : resolveCppEngine(true) === 'online' ? ' · 真实编译 · 在线' : ' · 教学级')) : '—';
}
/* v5.9.0：目录树（项目里带子目录时）——目录按需展开，未展开的子树不建 DOM */
let treeOpen = new Set();
try { treeOpen = new Set(JSON.parse(localStorage.getItem('pc_tree_open') || '[]')); } catch (e) { treeOpen = new Set(); }
function saveTreeOpen() {
  try { localStorage.setItem('pc_tree_open', JSON.stringify(Array.from(treeOpen))); } catch (e) {}
}
function fileIconSvg(name) {
  const lang = langOf(name);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '15'); svg.setAttribute('height', '15');
  svg.innerHTML = '<path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>';
  svg.style.color = lang === 'python' ? '#4B8BBE' : lang === 'cpp' ? '#7aa2f7' : '#888';
  return svg;
}
function fileRow(f, depth) {
  const li = document.createElement('li');
  if (f.name === state.active) li.className = 'active';
  if (projectMode()) li.classList.add('project-mode');
  if (depth) li.style.paddingLeft = (12 + depth * 14) + 'px';
  const span = document.createElement('span');
  span.className = 'fname'; span.textContent = f.name.split('/').pop();
  li.title = f.name;
  li.appendChild(fileIconSvg(f.name)); li.appendChild(span);
  li.addEventListener('click', () => { openFile(f.name); closeSidebar(); });
  li.addEventListener('dblclick', () => startRename(f.name));
  return li;
}
function renderFileList() {
  const ul = $('file-list');
  ul.innerHTML = '';
  const withDirs = state.files.some(f => f.name.indexOf('/') >= 0);
  if (!withDirs) { state.files.forEach(f => ul.appendChild(fileRow(f, 0))); return; }

  const root = { dirs: new Map(), files: [] };
  for (const f of state.files) {
    const parts = String(f.name).split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts[i];
      if (!node.dirs.has(d)) node.dirs.set(d, { name: d, path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [] });
      node = node.dirs.get(d);
    }
    node.files.push(f);
  }
  const renderNode = function (node, depth) {
    node.dirs.forEach(function (sub) {
      const li = document.createElement('li');
      li.className = 'dir';
      li.style.paddingLeft = (12 + depth * 14) + 'px';
      /* 活动文件在折叠目录里时自动展开祖先，否则树上看不到当前文件 */
      const activeInside = state.active && String(state.active).indexOf(sub.path + '/') === 0;
      const open = treeOpen.has(sub.path) || activeInside;
      const caret = document.createElement('span'); caret.className = 'dir-caret'; caret.textContent = open ? '▾' : '▸';
      const name = document.createElement('span'); name.className = 'fname'; name.textContent = sub.name + '/';
      li.appendChild(caret); li.appendChild(name);
      li.addEventListener('click', function () {
        if (treeOpen.has(sub.path)) treeOpen.delete(sub.path); else treeOpen.add(sub.path);
        saveTreeOpen(); renderFileList();
      });
      ul.appendChild(li);
      if (open) renderNode(sub, depth + 1);   // 懒加载：只渲染展开的子树
    });
    node.files.forEach(function (f) { ul.appendChild(fileRow(f, depth)); });
  };
  renderNode(root, 0);
}

/* ---------- Python ---------- */
/* v4.5 WASM 编译产物缓存：pyodide.asm.wasm 的编译结果（WebAssembly.Module）持久化到 IndexedDB，
   下次冷启动直接实例化，跳过最耗时的 WASM 编译阶段（V8 编译产物只能存于浏览器内部持久存储，
   交换目录无法承载；HTTP 层资源缓存头由原生 AssetClient 提供） */
let _wasmCacheHooked = false;
let _wasmCacheHit = false;
function hookWasmCache() {
  if (_wasmCacheHooked) return;
  _wasmCacheHooked = true;
  if (typeof indexedDB === 'undefined') return;
  const DB = 'pc_py_cache', STORE = 'wasm';
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { try { r.result.createObjectStore(STORE); } catch (e) {} };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const idbGet = (k) => open().then(db => new Promise((res, rej) => {
    const q = db.transaction(STORE, 'readonly').objectStore(STORE).get(k);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  }));
  const idbSet = (k, v) => open().then(db => new Promise((res, rej) => {
    const q = db.transaction(STORE, 'readwrite').objectStore(STORE).put(v, k);
    q.onsuccess = () => res(true); q.onerror = () => rej(q.error);
  }));
  const origStreaming = WebAssembly.instantiateStreaming;
  WebAssembly.instantiateStreaming = async function (respOrPromise, imports) {
    try {
      const resp = respOrPromise instanceof Response ? respOrPromise : await respOrPromise;
      if (resp && resp.url && resp.url.indexOf('/pyodide/') >= 0) {
        const bytes = await resp.clone().arrayBuffer();
        let cached = null;
        try {
          const rec = await idbGet('mod');
          if (rec && rec.url === resp.url && rec.size === bytes.byteLength
              && rec.mod instanceof WebAssembly.Module) cached = rec.mod;
        } catch (e) {}
        if (cached) {
          _wasmCacheHit = true;
          console.log('[pyodide] WASM 编译缓存命中，跳过编译（compile cache hit）');
          const inst = new WebAssembly.Instance(cached, imports || {});
          return { module: cached, instance: inst };
        }
        const mod = await WebAssembly.compile(bytes);
        try { await idbSet('mod', { url: resp.url, size: bytes.byteLength, mod }); } catch (e) {}
        console.log('[pyodide] WASM 编译完成并已缓存（compile cached for next cold start）');
        return { module: mod, instance: new WebAssembly.Instance(mod, imports || {}) };
      }
    } catch (e) { console.warn('[pyodide] wasm cache path failed, fallback', e); }
    return origStreaming.apply(WebAssembly, arguments);
  };
}
/* ---------- v4.10 Python 引擎调度：Worker 优先（终端式输入），不支持时回退主线程 ---------- */
function pyEngineReady() {
  return pyMode === 'worker' ? (pyWorker !== null && pyWorkerOk) : (pyodide !== null);
}
function pyWorkerSupported() {
  return !pyWorkerBroken && typeof Worker !== 'undefined'
    && typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true;
}
async function ensurePyodide(opts) {
  opts = opts || {};
  if (pyMode === null) {
    pyMode = pyWorkerSupported() ? 'worker' : 'main';
    if (Android.appendLog) { try { Android.appendLog('js', 'pyMode=' + pyMode + ' coi=' + self.crossOriginIsolated); } catch (e) {} }
  }
  if (pyMode === 'worker') {
    const ok = await ensurePyWorker(opts);
    if (ok === true) return true;
    // v5.10.1 安全（审查 P0-4）：worker 初始化失败不再回退到主线程执行用户代码
    pyMode = 'main';
    pyMainBlocked = true;
    setPyState('idle');
  }
  return ensurePyodideMain(opts);
}
function ensurePyWorker(opts) {
  const prog = (pct, key) => { try { if (opts.onProgress) opts.onProgress(pct, key); } catch (e) {} };
  pySplashProg = opts.onProgress || null;
  if (pyWorker && pyWorkerOk) { prog(100, 'splash_done'); return Promise.resolve(true); }
  if (!pyWorkerLoadPromise) {
    setPyState('loading');
    prog(8, 'splash_py');
    let climbPct = 8;
    const climb = setInterval(() => { if (climbPct < 85) prog(++climbPct); }, 300);
    pyWorkerLoadPromise = new Promise((resolve) => {
      let w;
      try {
        w = new Worker('py-worker.js', { type: 'module' });
      } catch (e) {
        pyWorkerBroken = true;
        clearInterval(climb);
        resolve(false);
        return;
      }
      pyWorker = w;
      pyWorkerCtl = { resolve, climb, timeout: null };
      pyWorkerCtl.timeout = setTimeout(() => {
        /* v5.4.3 修复（审查 #15）：超时后必须终止 Worker 并清空引用。
           旧逻辑只 resolve('timeout')，Worker 仍在后台加载 —— 主线程回退模式会再加载
           一份 Pyodide，内存里同时存在两份运行时；且「停止」分支只在 pyMode==='worker'
           时 terminate，旧 Worker 永远杀不掉。 */
        if (pyWorkerCtl) { clearTimeout(pyWorkerCtl.timeout); clearInterval(pyWorkerCtl.climb); pyWorkerCtl = null; }
        try { if (pyWorker) pyWorker.terminate(); } catch (e) {}
        pyWorker = null; pyWorkerOk = false; pyWorkerLoadPromise = null; pyInputWait = false;
        resolve('timeout');
      }, 90000);   // 90s 超时兜底
      w.onmessage = onPyWorkerMessage;
      w.onerror = (e) => {
        // module 加载失败等致命错误（走 load-error 之外的通知路径）
        if (pyWorkerCtl) { clearTimeout(pyWorkerCtl.timeout); clearInterval(pyWorkerCtl.climb); }
        pyWorkerBroken = true; pyWorker = null; pyWorkerOk = false; pyWorkerLoadPromise = null;
        setPyState('error');
        outAppend('Python Worker 加载失败，本次将改用主线程模式。\n', 'out-err');
        resolve(false);
      };
      w.postMessage({ type: 'init', bases: PY_BASES });
    });
  }
  return pyWorkerLoadPromise.then((r) => {
    if (r === true) prog(100, 'splash_done');
    return r === true;
  });
}
function onPyWorkerMessage(e) {
  const d = e.data || {};
  switch (d.type) {
    case 'sab':
      pySAB = d.sab;
      pyCTRL = new Int32Array(pySAB, 0, 1);
      pyDATALEN = new Int32Array(pySAB, 4, 1);
      break;
    case 'progress':
      if (pyWorkerCtl && pyWorkerCtl.climb) { clearInterval(pyWorkerCtl.climb); pyWorkerCtl.climb = null; }
      if (pySplashProg) pySplashProg(d.pct, d.key);
      break;
    case 'wasm-hit':
      _wasmCacheHit = true;
      break;
    case 'ready':
      pyWorkerOk = true;
      if (pyWorkerCtl) { clearTimeout(pyWorkerCtl.timeout); clearInterval(pyWorkerCtl.climb); }
      setPyState('ready');
      if (pyWorkerCtl) { pyWorkerCtl.resolve(true); pyWorkerCtl = null; }
      break;
    case 'load-error':
      if (pyWorkerCtl) { clearTimeout(pyWorkerCtl.timeout); clearInterval(pyWorkerCtl.climb); }
      pyWorkerBroken = true; pyWorkerOk = false;
      try { if (pyWorker) pyWorker.terminate(); } catch (e2) {}
      pyWorker = null; pyWorkerLoadPromise = null;
      setPyState('error');
      outAppend('Python Worker 加载失败（' + (d.message || '未知原因') + '），本次将改用主线程模式。\n', 'out-err');
      if (pyWorkerCtl) { pyWorkerCtl.resolve(false); pyWorkerCtl = null; }
      break;
    case 'out': {
      pyOutCount += (d.text || '').length;
      outAppend(d.text);
      if (pyOutCount > 32 * 1024 * 1024) pyWorkerOverflowStop();
      break;
    }
    case 'err':
      outAppend(d.text, 'out-err');
      break;
    case 'eval-result': {
      const w = pyEvalWaiters[d.id];
      if (w) { delete pyEvalWaiters[d.id]; w(d.ok ? d.value : null, d.ok ? null : d.value); }
      break;
    }
    case 'need-input':
      pyInputWait = true;
      {
        const box = $('term-input');
        if (box) {
          box.disabled = false;
          box.placeholder = 'input() 等待输入，回车发送（直接回车 = 空行）';
          box.focus();
        }
      }
      break;
    case 'done':
    case 'error': {
      pyInputWait = false;
      pyTermInputReset();
      const fin = pyRunDone; pyRunDone = null;
      if (fin) fin(d.type === 'error' ? { error: d.traceback || '运行异常' } : {});
      break;
    }
  }
}
let pySplashProg = null;   // 启动页进度回调（splash 阶段由 ensurePyWorker 透传）
/* v5.1 代码智能：在主线程 / Worker 两种模式下求值 Python 脚本，返回字符串（失败返回 null） */
let pyEvalSeq = 0;
const pyEvalWaiters = Object.create(null);
/* ============================================================
 * v5.9.0 LanguageService
 * 统一异步协议：diagnostics / completion / definition / references / documentSymbol
 * · 每个请求带 documentUri + documentVersion + requestId
 * · 文档版本在请求返回后已变化（或请求被取消）→ 结果标记 stale，调用方直接丢弃
 * · 提供者由插件注册（Python 走 Pyodide，C++ 走现有启发式作为降级后端）
 * ============================================================ */
const LS = {
  seq: 0,
  providers: new Map(),   // lang -> provider
  versions: new Map(),    // uri -> number
  inflight: new Map(),    // requestId -> { kind, uri, version, cancelled }
  uriOf(name) { return 'file:///' + encodeURI(String(name == null ? state.active : name) || ''); },
  version(uri) { return this.versions.get(uri) || 0; },
  bump(uri) {
    const v = this.version(uri) + 1;
    this.versions.set(uri, v);
    return v;
  },
  register(lang, provider) {
    if (!lang || !provider) return false;
    this.providers.set(String(lang).toLowerCase(), provider);
    return true;
  },
  unregister(lang) { this.providers.delete(String(lang).toLowerCase()); },
  providerFor(lang) { return this.providers.get(String(lang || '').toLowerCase()) || null; },
  cancel(requestId) {
    const rec = this.inflight.get(requestId);
    if (rec) { rec.cancelled = true; return true; }
    return false;
  },
  /** 发起请求；返回 { ok, data, error, stale, requestId, documentUri, documentVersion } */
  async request(kind, lang, params) {
    const p = Object.assign({}, params || {});
    const uri = p.uri || p.documentUri || LS.uriOf();
    const version = LS.version(uri);
    const id = 'ls' + (++LS.seq);
    const rec = { id, kind, uri, version, cancelled: false };
    LS.inflight.set(id, rec);
    const provider = LS.providerFor(lang || p.lang || '');
    const base = { requestId: id, documentUri: uri, documentVersion: version };
    if (!provider || typeof provider[kind] !== 'function') {
      LS.inflight.delete(id);
      return Object.assign({ ok: false, error: 'no-provider:' + kind }, base);
    }
    try {
      const data = await provider[kind](Object.assign({ documentUri: uri, documentVersion: version, requestId: id }, p));
      const stale = rec.cancelled || LS.version(uri) !== version;
      return Object.assign({ ok: true, data: data, stale: stale }, base);
    } catch (e) {
      return Object.assign({ ok: false, error: String((e && e.message) || e), stale: rec.cancelled }, base);
    } finally {
      LS.inflight.delete(id);
    }
  }
};

/* 独立的分析用 Pyodide 实例：单独开一个 py-worker，避免与用户程序共用全局状态。
   只在校验请求到来时惰性启动；启动失败一次就不再重试，回退到用户运行时。 */
const LsHost = {
  worker: null, ready: false, loading: null, seq: 0, waiters: new Map(), disabled: false,
  ensure() {
    if (this.ready) return Promise.resolve(true);
    if (this.disabled) return Promise.resolve(false);
    if (this.loading) return this.loading;
    this.loading = new Promise((resolve) => {
      let w;
      try { w = new Worker('py-worker.js'); } catch (e) { this.disabled = true; resolve(false); return; }
      this.worker = w;
      const done = (ok) => { clearTimeout(to); if (!ok) this.disabled = true; resolve(ok); };
      const to = setTimeout(() => done(false), 90000);
      w.onmessage = (e) => {
        const d = e.data || {};
        if (d.type === 'ready') { this.ready = true; done(true); return; }
        if (d.type === 'load-error') { done(false); return; }
        if (d.type === 'eval-result') {
          const cb = this.waiters.get(d.id);
          if (cb) { this.waiters.delete(d.id); cb(d); }
        }
      };
      w.onerror = () => done(false);
      try { w.postMessage({ type: 'init', bases: PY_BASES }); } catch (e) { done(false); }
    });
    return this.loading;
  },
  /** 返回字符串结果；失败返回 null */
  eval(code, timeoutMs) {
    if (!this.ready || !this.worker) return Promise.resolve(null);
    const id = 'lse' + (++this.seq);
    return new Promise((resolve) => {
      this.waiters.set(id, (d) => resolve(d && d.ok ? String(d.value == null ? '' : d.value) : null));
      setTimeout(() => { if (this.waiters.has(id)) { this.waiters.delete(id); resolve(null); } }, timeoutMs || 20000);
      try { this.worker.postMessage({ type: 'eval', id: id, code: code }); }
      catch (e) { this.waiters.delete(id); resolve(null); }
    });
  },
  reset() {
    try { this.worker && this.worker.terminate(); } catch (e) {}
    this.worker = null; this.ready = false; this.loading = null; this.waiters.clear();
  }
};
/** 设置项：分析是否使用独立实例（默认开） */
function lsDedicated() { return localStorage.getItem('pc_ls_dedicated') !== 'off'; }

async function pyEval(code) {
  try {
    /* v5.9.0：代码分析优先使用独立实例，避免污染用户程序的全局状态 */
    if (lsDedicated() && !LsHost.disabled) {
      const ok = await LsHost.ensure();
      if (ok) {
        const r = await LsHost.eval(code);
        if (r != null) return r;
      }
    }
    if (pyMode === 'worker') {
      if (!(pyWorker && pyWorkerOk)) { const ok = await ensurePyodide(); if (!ok) return null; }
      if (!(pyWorker && pyWorkerOk)) return null;
      const id = 'cie' + (++pyEvalSeq);
      return await new Promise(function (resolve) {
        pyEvalWaiters[id] = function (val) { resolve(val == null ? null : String(val)); };
        try { pyWorker.postMessage({ type: 'eval', id: id, code: code }); }
        catch (e) { delete pyEvalWaiters[id]; resolve(null); return; }
        setTimeout(function () { if (pyEvalWaiters[id]) { delete pyEvalWaiters[id]; resolve(null); } }, 20000);
      });
    }
    if (!pyodide) { const ok = await ensurePyodide(); if (!ok) return null; }
    if (!pyodide) return null;
    const r = await pyodide.runPythonAsync(code);
    return r == null ? '' : String(r);
  } catch (e) { console.warn('[pyEval]', e); return null; }
}
function pyWorkerOverflowStop() {
  pyOutCount = 0;
  try { if (pyWorker) pyWorker.terminate(); } catch (e) {}
  pyWorker = null; pyWorkerOk = false; pyWorkerLoadPromise = null; pyInputWait = false;
  pyTermInputReset();
  const fin = pyRunDone; pyRunDone = null;
  if (fin) fin({});
  outAppend('\n输出超过 32MB 上限，已自动停止（疑似死循环打印等失控输出）。\n', 'out-err');
}
function pyTermInputReset() {
  const box = $('term-input');
  if (box) box.placeholder = '程序运行时可在此交互输入，回车发送';
}
/** 把终端输入行的一行内容写给 worker 的 input()（含换行；Atomics 唤醒阻塞中的 worker） */
function pyWorkerSendInput(line) {
  pyInputWait = false;
  if (!pySAB) return;
  try {
    const bytes = new TextEncoder().encode(String(line) + '\n');
    const n = Math.min(bytes.length, 65536);
    new Uint8Array(pySAB, 8, n).set(bytes.subarray(0, n));
    Atomics.store(pyDATALEN, 0, n);
    Atomics.store(pyCTRL, 0, 1);
    Atomics.notify(pyCTRL, 0);
  } catch (e) { console.warn('send input failed', e); }
}

async function ensurePyodideMain(opts) {
  opts = opts || {};
  const prog = (pct, key) => { try { if (opts.onProgress) opts.onProgress(pct, key); } catch (e) {} };
  if (pyodide) { prog(100, 'splash_done'); return true; }
  if (pyState === 'loading') {
    // 预加载中：等待完成（最多 120 秒；点「停止」可取消等待）
    prog(30, 'splash_py');
    for (let i = 0; i < 240 && running && !pyodide && pyState === 'loading'; i++) {
      await new Promise(r => setTimeout(r, 500));
    }
    return !!pyodide;
  }
  setPyState('loading');
  prog(8, 'splash_py');
  hookWasmCache();
  const t0 = performance.now();
  // v4.6：loadPyodide 无进度回调，用平滑爬升动画表现初始化推进（8%→85% 封顶）
  let pct = 8;
  const climb = setInterval(() => { if (pct < 85) prog(++pct); }, 300);
  for (const base of PY_BASES) {
    try {
      const url = base.startsWith('http') ? base + 'pyodide.mjs' : './' + base + 'pyodide.mjs';
      const mod = await import(url);
      prog(30, 'splash_compile');
      const indexURL = base.startsWith('http') ? base : new URL(base, location.href).href;
      pyodide = await mod.loadPyodide({ indexURL });
      clearInterval(climb);
      pyodide.setStdout({ batched: (s) => outAppend(s + '\n') });
      pyodide.setStderr({ batched: (s) => outAppend(s + '\n', 'out-err') });
      patchPyodideInput(pyodide);   // v4.9.4：input("提示") 的提示语进对话框
      ensurePyInterrupt(pyodide);   // v5.9.0：主线程模式也能中断（把 2 写进 SAB 触发 KeyboardInterrupt）
      setPyState('ready');
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      if (runningKind !== 'python') outMeta(t('py_preloaded') + ' · ' + secs + 's'
        + (_wasmCacheHit ? (LANG === 'en' ? ' (compile cache hit)' : '（编译缓存命中）') : ''));
      try { localStorage.setItem('pc_py_ready_once', '1'); } catch (e) {}
      prog(100, 'splash_done');
      return true;
    } catch (e) { console.warn('pyodide base fail:', base, e); }
  }
  clearInterval(climb);
  setPyState('error');
  outAppend('Python 运行时加载失败，请检查网络或重启应用。\n', 'out-err');
  prog(-1, 'splash_fail');
  return false;
}
async function runPython() {
  outAppend('$ python ' + state.active + '\n', 'out-echo');
  const t0 = performance.now();
  /* v4.10：Worker 通道——终端式逐行交互（与 C++ 一致），运行中可随时停止 */
  if (pyMode === 'worker' && pyWorker && pyWorkerOk) {
    const files = projectMode()
      ? state.files.filter(f => f.name.endsWith('.py')).map(f => ({ name: f.name, content: f.content }))
      : null;
    pyOutCount = 0;
    const r = await new Promise((resolve) => {
      let settled = false;
      let guard = null;
      const settle = (val) => {
        if (settled) return;
        settled = true;
        if (guard) clearTimeout(guard);
        if (pyRunDone === settle) pyRunDone = null;
        resolve(val);
      };
      /* v5.4.3 修复（审查 #20）：Worker 崩溃（OOM 等）不会发 done/error，
         旧逻辑会让 pyRunDone 永挂 —— 界面一直显示「运行中」，只能手动点停止。
         这里加 10 分钟兜底：超时即终止 Worker 并报告失败。 */
      guard = setTimeout(() => {
        try { if (pyWorker) pyWorker.terminate(); } catch (e) {}
        pyWorker = null; pyWorkerOk = false; pyWorkerLoadPromise = null; pyInputWait = false;
        pyTermInputReset();
        settle({ error: 'Python Worker 长时间无响应（可能已崩溃），已强制终止。请重新运行。' });
      }, 600000);
      pyRunDone = settle;
      try { pyWorker.postMessage({ type: 'run', code: cm.state.doc.toString(), files }); }
      catch (e) { settle({ error: String((e && e.message) || e) }); }
    });
    if (r && r.error) {
      outAppend(r.error + '\n', 'out-err');
      const errs = parsePythonErrors(r.error, state.active);
      if (errs.length) { outMeta('已在编辑器标注错误位置（红色行 + 波浪线），并显示错误原因。'); showCodeErrors(errs); }
      outMeta('进程异常退出，耗时 ' + ((performance.now() - t0) / 1000).toFixed(2) + ' 秒');
    } else {
      outMeta('进程已结束，耗时 ' + ((performance.now() - t0) / 1000).toFixed(2) + ' 秒');
    }
    return;
  }
  try {
    injectProjectToPyodide();
    pyodide.setStdin({ stdin: () => interactInput('程序请求输入（input）：') });
    await pyodide.runPythonAsync(cm.state.doc.toString());
    outMeta('进程已结束，耗时 ' + ((performance.now() - t0) / 1000).toFixed(2) + ' 秒');
  } catch (e) {
    const tb = String(e.message || e);
    outAppend(tb + '\n', 'out-err');
    const errs = parsePythonErrors(tb, state.active);
    if (errs.length) {
      outMeta('已在编辑器标注错误位置（红色行 + 波浪线），并显示错误原因。');
      showCodeErrors(errs);
    }
    outMeta('进程异常退出，耗时 ' + ((performance.now() - t0) / 1000).toFixed(2) + ' 秒');
  }
}

/* ---------- C++ · Termux 交互式（FIFO + 流式输出） ---------- */
/** v5.10.0：解析本次要运行的入口与其内容（.qingcode.json 的 entry 优先） */
function resolveRunTarget(wantLang) {
  const entry = ProjectConfig.entryFor(state.active);
  let f = state.files.find(x => x.name === entry);
  if (!f) f = state.files.find(x => x.name === state.active);
  if (!f) return null;
  if (wantLang && langOf(f.name) !== wantLang) return null;
  if (f.content === null && !ensureContent(f)) return null;
  return f;
}
/** 组装交给原生的项目配置（只在 C++ 通道有意义，但字段通用） */
function runOptsFor(target) {
  const cfg = ProjectConfig.get();
  return {
    sources: ProjectConfig.extraSources(target.name),
    includeDirs: cfg.includeDirs,
    compiler: cfg.compiler || '',
    standard: cfg.standard,
    flags: cfg.flags,
    args: cfg.args,
    env: cfg.env,
    cwd: cfg.cwd,
    cacheMaxMB: cfg.cacheMaxMB,
    cacheMaxEntries: cfg.cacheMaxEntries
  };
}
function runCppTermux() {
  if (!guardTermux()) return;   // v4.9：未装 Termux 时取消所有 Termux 编译项目
  const target = resolveRunTarget('cpp');
  if (!target) { outAppend('找不到可运行的 C++ 文件。\n', 'out-err'); return; }
  const cfg = ProjectConfig.get();
  ProjectConfig.report();
  if (!ProjectConfig.ensureApproved()) return;   // 安全审查 P1-8：首次运行带配置的项目需要确认
  const cxx = cfg.compiler || cppCompiler;
  const sources = ProjectConfig.extraSources(target.name);
  if (cfg.entry && cfg.entry !== state.active) outMeta(t('qc_using_entry').replace('{f}', cfg.entry));
  cppRunning = true;
  document.body.classList.add('term-live');
  if (Android.appendLog) Android.appendLog('js', 'runCppTermux engine=' + cppEngine
      + ' compiler=' + cxx + ' entry=' + target.name + ' sources=' + sources.length);
  outAppend('$ ' + cxx + ' -std=' + cfg.standard + ' ' + target.name
      + (sources.length ? ' (+' + sources.length + ' 个源文件)' : '') + ' && 运行   [Termux 真实编译 · 可交互]\n', 'out-echo');
  outMeta('已发送编译请求到 Termux，等待响应…（首次编译约 10~30 秒）');
  // v4.9.3 运行会话目录：每次运行独立子目录，多项目连续运行（Termux 队列异步）不再互相覆盖文件与输出
  let sess = '';
  try { sess = (Android.beginRunSession ? (Android.beginRunSession() || '') : ''); } catch (e) {}
  window.__runSession = sess;
  RunSession.begin('cpp', sess);
  RunSession.set('preparing');
  const staged = stageProjectForTermux(sess, 'cpp');   // v5.10.0：保留相对目录结构
  if (staged) outMeta(t('run_staged').replace('{n}', staged));
  RunSession.set('building');
  window.__cppT0 = performance.now();
  if (cppBeatTimer) clearInterval(cppBeatTimer);
  cppBeatTimer = setInterval(() => {
    if (!cppRunning) { clearInterval(cppBeatTimer); cppBeatTimer = null; return; }
    outMeta('… Termux 处理中 ' + Math.round((performance.now() - window.__cppT0) / 1000) + 's（' + cfg.timeoutSec + 's 超时后会给出诊断）');
  }, 10000);
  try {
    const opts = JSON.stringify(runOptsFor(target));
    const ok = Android.runCppEx
      ? Android.runCppEx(sess, target.name, target.content, opts, cfg.timeoutSec, cxx)
      : Android.runCpp(sess, target.name, target.content, cxx, cfg.timeoutSec);
    if (!ok) { finishCpp(); outAppend('Termux 启动失败，请检查配置指引。\n', 'out-err'); }
  } catch (e) {
    finishCpp();
    outAppend('Termux 调用异常: ' + (e.message || e) + '\n', 'out-err');
  }
}
/* v5.10.0：编译 / 运行分离——用上次的产物重跑，不再调用编译器 */
function rerunCached() {
  if (running) { outMeta('正在运行，请先停止。'); return; }
  if (!(window.Android && Android.runCachedBinary)) { outAppend('当前环境不支持「重跑（不重新编译）」。\n', 'out-err'); return; }
  if (!guardTermux()) return;
  const target = resolveRunTarget('cpp');
  if (!target) { outAppend('找不到可运行的 C++ 文件。\n', 'out-err'); return; }
  const cfg = ProjectConfig.get();
  cppRunning = true;
  document.body.classList.add('term-live');
  outAppend('$ ./重新运行（跳过编译）' + (cfg.args.length ? ' ' + cfg.args.join(' ') : '') + '\n', 'out-echo');
  let sess = '';
  try { sess = (Android.beginRunSession ? (Android.beginRunSession() || '') : ''); } catch (e) {}
  window.__runSession = sess;
  RunSession.begin('cpp-rerun', sess);
  RunSession.set('preparing');
  stageProjectForTermux(sess, 'cpp');
  RunSession.set('running');
  window.__cppT0 = performance.now();
  try {
    const ok = Android.runCachedBinary(sess, cfg.timeoutSec);
    if (!ok) { finishCpp(); outAppend('重跑启动失败。\n', 'out-err'); }
  } catch (e) {
    finishCpp();
    outAppend('重跑异常: ' + (e.message || e) + '\n', 'out-err');
  }
}
/* ---------- v4.7：Termux 原生 Python 解释器（与 C++ 通道共用 FIFO 交互与轮询；配置完全分离） ---------- */
function runPythonTermux() {
  if (!guardTermux()) return;   // v4.9：未装 Termux 时取消所有 Termux 编译项目
  const target = resolveRunTarget('python');
  if (!target) { outAppend('找不到可运行的 Python 文件。\n', 'out-err'); return; }
  cppRunning = true;
  document.body.classList.add('term-live');
  window.__pyTermuxRun = true;
  if (Android.appendLog) Android.appendLog('js', 'runPythonTermux entry=' + target.name);
  outAppend('$ python ' + target.name + '   [Termux 原生解释器 · 可交互]\n', 'out-echo');
  outMeta('已发送运行请求到 Termux…（未装 Python 时首次运行会自动 pkg install python，约 1~3 分钟）');
  // v4.9.3 运行会话目录（与 C++ 同机制）：项目 .py 与产物按会话隔离
  let sess = '';
  try { sess = (Android.beginRunSession ? (Android.beginRunSession() || '') : ''); } catch (e) {}
  window.__runSession = sess;
  RunSession.begin('py-termux', sess);
  RunSession.set('preparing');
  const staged = projectMode() ? stageProjectForTermux(sess, 'py') : 0;   // v5.10.0：保留包目录结构
  if (staged) outMeta(t('run_staged').replace('{n}', staged));
  RunSession.set('running');
  window.__cppT0 = performance.now();
  if (cppBeatTimer) clearInterval(cppBeatTimer);
  cppBeatTimer = setInterval(() => {
    if (!cppRunning) { clearInterval(cppBeatTimer); cppBeatTimer = null; return; }
    outMeta('… Termux 处理中 ' + Math.round((performance.now() - window.__cppT0) / 1000) + 's（可点「停止」终止）');
  }, 10000);
  try {
    const ok = Android.runPyTermux(sess, target.name, target.content, ProjectConfig.get().timeoutSec);
    if (!ok) { finishCpp(); outAppend('Termux 启动失败，请检查 Termux 是否已安装并完成授权。\n', 'out-err'); }
  } catch (e) {
    finishCpp();
    outAppend('Termux 调用异常: ' + (e.message || e) + '\n', 'out-err');
  }
}
/* ---------- 在线运行（Wandbox/Judge0） ---------- */
async function runCppOnline() {
  const code = cm.state.doc.toString();
  const needIn = /\b(cin|getline|getchar|scanf)\b/.test(code) || /scanf\s*\(/.test(code);
  const stdin = needIn ? collectMultiInput() : '';
  outAppend('$ [在线编译] ' + cppCompiler + ' ' + state.active + '\n', 'out-echo');
  outMeta('已提交到云端编译运行…（一次性提交' + (needIn ? '，含预填输入' : '') + '，不支持逐步交互）');
  try {
    const r = await runOnlineExe('c++', code, stdin);
    if (r.stdout) outAppend(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
    if (r.stderr) outAppend(r.stderr, 'out-err');
    if (r.code !== 0) {
      const errs = parseCompileErrors((r.stderr || '') + '\n' + (r.stdout || ''), state.active);
      if (errs.length) {
        outMeta('已在编辑器标注 ' + errs.length + ' 处错误（红色行 + 波浪线），并显示首个错误原因。');
        showCodeErrors(errs);
      }
    }
    outMeta('程序已结束，退出代码 ' + r.code + '（在线引擎 · 免费公益 API）');
  } catch (e) {
    if (e && e.name === 'AbortError') { outAppend('⏹ KeyboardInterrupt: 已手动停止（云端请求已取消，进程被终止）\n', 'out-err'); return; }
    outAppend('在线运行失败: ' + (e.message || e) + '\n请检查网络，或在菜单切换其他 C++ 引擎。\n', 'out-err');
  }
}
async function runPythonOnline() {
  const code = cm.state.doc.toString();
  const needIn = /input\s*\(/.test(code);
  const stdin = needIn ? collectMultiInput() : '';
  outAppend('$ [在线编译] python3 ' + state.active + '\n', 'out-echo');
  outMeta('已提交到云端运行…（一次性提交' + (needIn ? '，含预填输入' : '') + '）');
  try {
    const r = await runOnlineExe('python', code, stdin);
    if (r.stdout) outAppend(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
    if (r.stderr) outAppend(r.stderr, 'out-err');
    if (r.code !== 0) {
      const errs = parsePythonErrors(r.stderr || '', state.active);
      if (errs.length) {
        outMeta('已在编辑器标注错误位置（红色行 + 波浪线），并显示错误原因。');
        showCodeErrors(errs);
      }
    }
    outMeta('程序已结束，退出代码 ' + r.code);
  } catch (e) {
    if (e && e.name === 'AbortError') { outAppend('⏹ KeyboardInterrupt: 已手动停止（云端请求已取消，进程被终止）\n', 'out-err'); return; }
    outAppend('在线运行失败: ' + (e.message || e) + '\n请检查网络，或在菜单把 Python 引擎切回内置 Pyodide。\n', 'out-err');
  }
}

function finishCpp() {
  cppRunning = false;
  try { RunSession.end(); } catch (e) {}   // v5.10.0：会话进入 terminal 并清空
  window.__pyTermuxRun = false;
  // v4.9.3：结束运行会话（pollTask 已停，目录保留至下次启动由 cleanSwapTemp 统一清理）
  if (window.Android && Android.endRunSession) { try { Android.endRunSession(); } catch (e) {} }
  window.__runSession = null;
  if (cppBeatTimer) { clearInterval(cppBeatTimer); cppBeatTimer = null; }
  document.body.classList.remove('term-live');
  setRunning(false);
}
/* ---------- 编译/运行错误标注（v3.4：整行红高亮 + 波浪线 + 5 秒错误泡；v4.1.1：跳最前行 + 编辑该行即取消标红） ---------- */
let currentErrs = [];   // 当前标红集合 [{line, col, message, anchor(行首pos), anchorEnd(行尾pos)}]，anchor 随编辑自动映射
function clearCodeErrors() {
  currentErrs = [];
  if (cm && PCCM.clearErrors) { try { PCCM.clearErrors(cm); } catch (e) {} }
  hideErrBubble();
  try { if (typeof setPanelProblems === 'function') setPanelProblems([]); } catch (e) {}   // v5.9.0
}

/** 解析 GCC/Clang 错误输出 → [{line, col, message}]（最多 6 处） */
function parseCompileErrors(text, fileName) {
  const errs = [], seen = new Set();
  if (!text) return errs;
  const base = (fileName || '').split('/').pop();
  const re = /^(\S+?):(\d+):(?:(\d+):)?\s*(?:fatal\s+)?(?:error|错误|致命错误)\s*[：:]\s*(.*)$/gim;
  let m;
  while ((m = re.exec(text))) {
    const file = m[1].split('/').pop();
    // 头文件的错误不标到主文件（如 #include 找不到 .h）；其余（当前文件 / 在线引擎的 prog.cc、main.cpp）均接受
    if (/\.(h|hpp|hh|tcc)$/i.test(file) && file !== base) continue;
    const line = parseInt(m[2], 10), col = parseInt(m[3] || '1', 10) || 1;
    const msg = m[4].trim();
    const key = line + ':' + col + ':' + msg;
    if (seen.has(key)) continue;
    seen.add(key);
    errs.push({ line, col, message: file + ':' + line + ':' + col + '  ' + msg });
    if (errs.length >= 6) break;
  }
  return errs;
}

/** 解析 Python Traceback → [{line, col, message}]（取最后帧行号） */
function parsePythonErrors(text, fileName) {
  const errs = [];
  if (!text) return errs;
  const lines = String(text).split('\n');
  let lineNo = 0, msg = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const L = lines[i];
    if (!msg) {
      const em = /^\s*([\w.]+(?:Error|Exception|Interrupt|Warning))(?::\s*(.*))?$/.exec(L);
      if (em) { msg = em[1] + (em[2] ? ': ' + em[2] : ''); continue; }
    }
    if (msg) {
      const fm = /^\s*File\s+"[^"]*",\s*line\s+(\d+)/.exec(L);
      if (fm) { lineNo = parseInt(fm[1], 10); break; }
    }
  }
  if (lineNo) {
    const base = (fileName || '').split('/').pop();
    errs.push({ line: lineNo, col: 1, message: (base || 'python') + ':' + lineNo + '  ' + (msg || 'Python 运行错误') });
  }
  return errs;
}

/* 错误泡（5 秒自动消失） */
let errBubbleTimer = null;
function ensureErrBubble() {
  let b = document.getElementById('err-bubble');
  if (!b) {
    b = document.createElement('div');
    b.id = 'err-bubble';
    document.body.appendChild(b);
  }
  return b;
}
function hideErrBubble() {
  const b = document.getElementById('err-bubble');
  if (b) b.classList.remove('show');
  clearTimeout(errBubbleTimer);
}
function showErrorBubble(err) {
  if (!cm || !err) return;
  const doc = cm.state.doc;
  if (err.line < 1 || err.line > doc.lines) return;
  const l = doc.line(err.line);
  const pos = Math.min(l.to, l.from + Math.max(0, (err.col || 1) - 1));
  try { cm.dispatch({ selection: { anchor: pos }, scrollIntoView: true }); } catch (e) {}
  setTimeout(() => {
    try {
      const coord = cm.coordsAtPos(pos);
      if (!coord) return;
      const b = ensureErrBubble();
      b.textContent = '⛔ ' + err.message;
      b.style.left = Math.max(8, Math.min(window.innerWidth - 24 - b.offsetWidth, coord.left)) + 'px';
      b.style.top = Math.min(window.innerHeight - 60, coord.bottom + 6) + 'px';
      b.classList.add('show');
      clearTimeout(errBubbleTimer);
      errBubbleTimer = setTimeout(hideErrBubble, 5000);
    } catch (e) {}
  }, 90);
}
/** 标注错误集合：按行号排序全部标红 + 波浪线，跳转到最靠前的错误行并显示 5 秒泡 */
function showCodeErrors(errs) {
  if (!cm || !errs || !errs.length) return;
  const doc = cm.state.doc;
  currentErrs = [];
  for (const e of errs.slice().sort((a, b) => a.line - b.line)) {
    if (!e || e.line < 1 || e.line > doc.lines) continue;
    const l = doc.line(e.line);
    currentErrs.push({ line: e.line, col: e.col || 1, message: e.message, anchor: l.from, anchorEnd: l.to });
  }
  if (!currentErrs.length) return;
  /* v5.0：错误行若落在折叠块内，先展开，保证标红可见 */
  try {
    const M = window.PCCM && PCCM.modules;
    if (M && M.unfoldCode) {
      for (const e of currentErrs.slice().sort((a, b) => a.line - b.line)) M.unfoldCode(cm, doc.line(e.line).from);
    }
  } catch (e) {}
  if (PCCM.markErrors) { try { PCCM.markErrors(cm, currentErrs); } catch (e) {} }
  showErrorBubble(currentErrs[0]);   // 行号最小的错误
}

/** 编辑触及某标红行 → 该行标红立即消失（不论改对改错），其余标红保留且行号随增删行自动偏移 */
function clearErrorsTouchedBy(up) {
  if (!currentErrs.length) return;
  const d2 = up.state.doc;
  const kept = [];
  let removed = false;
  for (const e of currentErrs) {
    // 本次变更区间（变更前坐标）与该行 [anchor, anchorEnd] 相交 ⇒ 该行被编辑
    let touched = false;
    up.changes.iterChanges((fromA, toA) => {
      if (fromA <= e.anchorEnd && toA >= e.anchor) touched = true;
    });
    if (touched) { removed = true; continue; }
    const np = up.changes.mapPos(e.anchor);
    if (np == null) { removed = true; continue; }
    const l2 = d2.lineAt(Math.min(Math.max(0, np), d2.length));
    e.anchor = l2.from; e.anchorEnd = l2.to; e.line = l2.number;
    kept.push(e);
  }
  if (removed) {
    currentErrs = kept;
    if (kept.length) { if (PCCM.markErrors) { try { PCCM.markErrors(cm, kept); } catch (e) {} } }
    else { if (PCCM.clearErrors) { try { PCCM.clearErrors(cm); } catch (e) {} } hideErrBubble(); }
  }
}

window.__onCppStream = function (text, sid) {
  /* v5.10.0：带 sessionId 的事件——上一轮会话迟到的输出不再混进本次运行 */
  if (sid && !RunSession.isCurrent(sid)) return;
  if (RunSession.state === 'building' || RunSession.state === 'preparing') RunSession.set('running');
  if (text) outAppend(text);
};
window.__onCppStreamErr = function (text, sid) {
  if (sid && !RunSession.isCurrent(sid)) return;
  if (text) outAppend(text, 'out-err');
};
window.__onCppResult = function (res) {
  res = res || {};
  if (Android.appendLog) Android.appendLog('js', 'onCppResult ' + JSON.stringify(res).slice(0, 300));
  /* v5.10.0：丢弃过期会话的结果（例如上一轮超时后 Termux 队列里迟到的收尾事件） */
  if (res.sid && !RunSession.isCurrent(res.sid)) {
    if (Android.appendLog) Android.appendLog('js', 'drop stale session result ' + res.sid);
    return;
  }
  const wasPyTermux = !!window.__pyTermuxRun;   // v4.9.4：先取快照（finishCpp 会清掉该标记，旧代码永远读不到）
  finishCpp();
  const elapsed = ((performance.now() - (window.__cppT0 || performance.now())) / 1000).toFixed(2);
  if (res.stage === 'setup') {
    outAppend((res.message || 'Termux 未就绪') + '\n\n' + t('termux_help') + '\n', 'out-err');
    if (res.message && res.message.indexOf('所有文件访问') >= 0) setTimeout(guideStoragePermission, 1500);
    return;
  }
  if (res.stage === 'compile') {
    if (res.stderr) outAppend(res.stderr, 'out-err');
    outMeta('编译失败（退出代码 ' + res.exit + '），耗时 ' + elapsed + ' 秒');
    const errs = parseCompileErrors(res.stderr || '', state.active);
    if (errs.length) { showCodeErrors(errs); outMeta('已在编辑器标注 ' + errs.length + ' 处错误（红色行 + 波浪线），并显示首个错误原因。'); }
  } else if (res.stage === 'timeout') {
    outAppend('\n' + (res.stderr || '') + '运行超时，已强制停止。\n', 'out-err');
  } else if (res.stage === 'run') {
    if (res.exit === -1) {
      // v4.9.4：会话目录丢失等异常终止（无有效退出码）
      outAppend((res.stderr || '运行已被终止') + '\n', 'out-err');
      outMeta('运行已终止，耗时 ' + elapsed + ' 秒');
    } else if (wasPyTermux) {
      outMeta(t('py_termux_done').replace('{exit}', res.exit).replace('{secs}', elapsed));
    } else {
      outMeta('进程已结束，退出代码 ' + res.exit + '，耗时 ' + elapsed + ' 秒 [Termux ' + cppCompiler + ']');
    }
  } else {
    outMeta('运行结束，耗时 ' + elapsed + ' 秒');
  }
};

/* ---------- C++ · 内置 JSCPP 兜底（一次性输入） ---------- */
function ensureCppWorker() {
  if (cppWorker) return cppWorker;
  cppWorker = new Worker(CPP_WORKER_URL);
  return cppWorker;
}
function runCppJscpp() {
  const code = cm.state.doc.toString();
  const needInput = /\b(cin\b|scanf\b|getline\b|getchar\b)/.test(code);
  let input = '';
  if (needInput) {
    input = collectMultiInput();
    if (input) input.split('\n').forEach(l => l !== '' && outEcho(l));
  }
  outAppend('$ 编译运行 ' + state.active + '   [内置 JSCPP 教学级]\n', 'out-echo');
  const t0 = performance.now();
  const w = ensureCppWorker();
  let done = false;
  jscppTimer = setTimeout(() => {
    if (done) return;
    done = true;
    jscppTimer = null;
    w.terminate(); cppWorker = null;
    outAppend('\n运行超时（超过 10 秒），已强制停止。请检查是否存在死循环。\n', 'out-err');
    setRunning(false);
  }, 10000);
  w.onmessage = (e) => {
    const d = e.data || {};
    if (d.type === 'out') { outAppend(d.text); return; }
    if (done) return;
    done = true; clearTimeout(jscppTimer); jscppTimer = null;
    if (d.type === 'done') {
      outMeta('进程已结束，退出代码 ' + d.ec + '，耗时 ' + ((performance.now() - t0) / 1000).toFixed(2) + ' 秒 [JSCPP]');
    } else {
      outAppend(String(d.message) + '\n', 'out-err');
      if (/cannot find library|unsupported|Parsing Failure/i.test(String(d.message))) {
        outAppend('提示：内置为教学级解释器，不支持 STL/模板。配置 Termux 后可用真实 Clang 交互编译（菜单 → 环境向导）。\n', 'out-err');
      }
      outMeta('进程异常退出，耗时 ' + ((performance.now() - t0) / 1000).toFixed(2) + ' 秒');
    }
    setRunning(false);
  };
  w.onerror = (e) => {
    if (done) return;
    done = true; clearTimeout(jscppTimer); jscppTimer = null;
    outAppend('运行错误: ' + (e.message || 'worker error') + '\n', 'out-err');
    setRunning(false);
  };
  w.postMessage({ code, input });
}

/* ---------- 运行入口 ---------- */
let jscppTimer = null;            // JSCPP 超时计时器（手动停止时清理）
let onlineAbort = null;           // 云端运行请求的中止控制器（点停止立即取消）
function setRunning(v, kind) {
  running = v;
  runningKind = v ? kind : null;
  const btn = $('btn-run');
  btn.classList.toggle('running', v);
  /* v5.4.3：按钮文案走 i18n（此前硬编码中文，英文界面下运行一次就变回中文） */
  btn.querySelector('span').textContent = v ? t('t_stop') : t('run');
}
/* ============================================================
 * v5.10.0：项目配置 `.qingcode.json` + 运行会话状态机
 * ============================================================ */
const PROJECT_CONFIG_FILE = '.qingcode.json';
/* 安全审查 P1-8：可注入行为的环境变量一律拒绝 */
const QC_ENV_BLOCKED = ['LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT', 'PATH'];
/** 项目配置：只做解析 + 校验，不执行任何东西；解析失败一律回落到默认值并报告原因 */
const ProjectConfig = {
  _cacheKey: null, _cfg: null, _errs: [],
  defaults() {
    return {
      entry: null, sources: [], includeDirs: [], compiler: null, standard: 'c++17',
      flags: [], args: [], env: {}, cwd: null, timeoutSec: 60,
      cacheMaxMB: 256, cacheMaxEntries: 40
    };
  },
  /** 取配置文件原文（惰性文件先读盘）；没有配置文件返回 null */
  source() {
    const f = state.files.find(x => x.name === PROJECT_CONFIG_FILE);
    if (!f) return null;
    if (f.content === null && !ensureContent(f)) return null;
    return f.content == null ? '' : String(f.content);
  },
  parse(text) {
    const cfg = this.defaults(), errs = [];
    let obj;
    try { obj = JSON.parse(text); }
    catch (e) { errs.push(t('qc_bad_json').replace('{m}', (e && e.message) || e)); return { ok: false, cfg: cfg, errs: errs }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { errs.push(t('qc_bad_root')); return { ok: false, cfg: cfg, errs: errs }; }
    const names = new Set(state.files.map(f => f.name));
    const strList = function (v, field) {
      if (v == null) return [];
      if (!Array.isArray(v)) { errs.push(t('qc_bad_field').replace('{f}', field)); return []; }
      const out = [];
      for (const x of v) {
        if (typeof x !== 'string' || !x.trim()) { errs.push(t('qc_bad_field').replace('{f}', field)); continue; }
        out.push(x.trim());
      }
      return out;
    };
    if (obj.entry != null) {
      if (typeof obj.entry !== 'string' || !obj.entry.trim()) errs.push(t('qc_bad_field').replace('{f}', 'entry'));
      else if (!names.has(obj.entry.trim())) errs.push(t('qc_entry_missing').replace('{f}', obj.entry.trim()));
      else cfg.entry = obj.entry.trim();
    }
    for (const s of strList(obj.sources, 'sources')) {
      if (!names.has(s)) errs.push(t('qc_source_missing').replace('{f}', s));
      else if (cfg.sources.indexOf(s) < 0) cfg.sources.push(s);
    }
    for (const d of strList(obj.includeDirs, 'includeDirs')) {
      if (d.indexOf('..') >= 0 || d.charAt(0) === '/' || /^[A-Za-z]:/.test(d)) { errs.push(t('qc_bad_path').replace('{f}', d)); continue; }
      cfg.includeDirs.push(d.replace(/\/+$/, ''));
    }
    if (obj.compiler != null) {
      /* 安全审查 P1-8：只允许裸可执行名（clang++ / g++ / c++），禁止路径与 .. */
      if (typeof obj.compiler !== 'string' || !/^[A-Za-z0-9_.+-]+$/.test(obj.compiler)) errs.push(t('qc_bad_field').replace('{f}', 'compiler'));
      else cfg.compiler = obj.compiler.trim();
    }
    if (obj.standard != null) {
      if (typeof obj.standard !== 'string' || !/^[cg]\+\+[0-9]{2}$/.test(obj.standard)) errs.push(t('qc_bad_field').replace('{f}', 'standard'));
      else cfg.standard = obj.standard;
    }
    cfg.flags = strList(obj.flags, 'flags');
    cfg.args = strList(obj.args, 'args');
    if (obj.env != null) {
      if (typeof obj.env !== 'object' || Array.isArray(obj.env)) errs.push(t('qc_bad_field').replace('{f}', 'env'));
      else for (const k of Object.keys(obj.env)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) { errs.push(t('qc_bad_field').replace('{f}', 'env.' + k)); continue; }
        /* 安全审查 P1-8：这些变量能改变动态链接器 / 命令解析，等于绕过编译器本身 */
        if (QC_ENV_BLOCKED.indexOf(k.toUpperCase()) >= 0) { errs.push(t('qc_env_blocked').replace('{f}', k)); continue; }
        const v = obj.env[k];
        if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') { errs.push(t('qc_bad_field').replace('{f}', 'env.' + k)); continue; }
        cfg.env[k] = String(v);
      }
    }
    if (obj.cwd != null) {
      if (typeof obj.cwd !== 'string' || obj.cwd.indexOf('..') >= 0 || obj.cwd.charAt(0) === '/') errs.push(t('qc_bad_path').replace('{f}', 'cwd'));
      else cfg.cwd = obj.cwd.replace(/\/+$/, '');
    }
    if (obj.timeoutSec != null) {
      const n = Number(obj.timeoutSec);
      if (!isFinite(n)) errs.push(t('qc_bad_field').replace('{f}', 'timeoutSec'));
      else cfg.timeoutSec = Math.max(5, Math.min(600, Math.round(n)));
    }
    if (obj.cacheMaxMB != null) {
      const n = Number(obj.cacheMaxMB);
      if (isFinite(n) && n > 0) cfg.cacheMaxMB = Math.max(16, Math.min(4096, Math.round(n)));
    }
    if (obj.cacheMaxEntries != null) {
      const n = Number(obj.cacheMaxEntries);
      if (isFinite(n) && n > 0) cfg.cacheMaxEntries = Math.max(2, Math.min(500, Math.round(n)));
    }
    return { ok: errs.length === 0, cfg: cfg, errs: errs };
  },
  /** 带缓存：原文没变就不重复解析 */
  get() {
    const text = this.source();
    if (text === null) { this._cacheKey = null; this._cfg = this.defaults(); this._errs = []; return this._cfg; }
    if (this._cacheKey === text) return this._cfg;
    const r = this.parse(text);
    this._cacheKey = text; this._cfg = r.cfg; this._errs = r.errs;
    return r.cfg;
  },
  errors() { this.get(); return this._errs; },
  /** 本次运行使用的主文件：配置的 entry 优先，否则当前活动文件 */
  entryFor(name) {
    const cfg = this.get();
    if (cfg.entry) return cfg.entry;
    return name || state.active;
  },
  /** 除主文件外的额外源文件（去重、排除 entry 自身） */
  extraSources(entry) {
    const cfg = this.get();
    return cfg.sources.filter(s => s !== entry);
  },
  /** 配置指纹：项目路径 + 配置内容哈希 + 长度（安全审查 P1-8：按「项目 + 配置」记住确认结果） */
  approvalKey() {
    const text = this.source();
    if (text === null) return null;
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return (projectMode() ? projectRoot : 'default') + '#' + h.toString(16) + '#' + text.length;
  },
  approved() {
    const k = this.approvalKey();
    if (!k) return true;
    try { return (JSON.parse(localStorage.getItem('pc_qc_approved') || '[]') || []).indexOf(k) >= 0; }
    catch (e) { return false; }
  },
  markApproved() {
    const k = this.approvalKey();
    if (!k) return;
    try {
      const arr = JSON.parse(localStorage.getItem('pc_qc_approved') || '[]') || [];
      if (arr.indexOf(k) < 0) arr.push(k);
      localStorage.setItem('pc_qc_approved', JSON.stringify(arr.slice(-20)));
    } catch (e) {}
  },
  /** 带配置的项目首次运行前确认一次（配置变了会重新确认） */
  ensureApproved() {
    if (this.source() === null) return true;      // 没有配置文件，不需要确认
    if (this.approved()) return true;
    const cfg = this.get();
    const bits = [];
    if (cfg.compiler) bits.push('compiler = ' + cfg.compiler);
    if (cfg.standard) bits.push('standard = ' + cfg.standard);
    if (cfg.flags.length) bits.push('flags = ' + cfg.flags.join(' '));
    if (cfg.args.length) bits.push('args = ' + cfg.args.join(' '));
    if (cfg.cwd) bits.push('cwd = ' + cfg.cwd);
    if (Object.keys(cfg.env).length) bits.push('env = ' + JSON.stringify(cfg.env));
    showModal({
      title: t('qc_confirm_title'), withInput: false, okText: t('qc_confirm_ok'),
      desc: t('qc_confirm_desc') + '  ' + bits.join(' · '), showCancel: true
    });
    modalMode = 'qc-approve';
    return false;
  },
  report() {
    const errs = this.errors();
    if (!errs.length) return;
    for (const e of errs) outAppend('⚠ .qingcode.json: ' + e + '\n', 'out-err');
    outMeta(t('qc_fallback'));
  }
};

/** 运行会话状态机：queued → preparing → building → running ⇄ waitingInput → stopping → terminal */
const RUN_STATES = ['queued', 'preparing', 'building', 'running', 'waitingInput', 'stopping', 'terminal'];
const RunSession = {
  seq: 0, id: null, sid: null, kind: '', state: 'idle', startedAt: 0, history: [],
  begin(kind, sid) {
    this.seq += 1;
    this.id = 'rs' + this.seq;
    this.sid = sid || this.id;     // 原生侧用会话目录名回传，故以它为准
    this.kind = kind || '';
    this.state = 'queued';
    this.startedAt = performance.now();
    this.history = [{ state: 'queued', at: 0 }];
    RunSession._render();
    return this.sid;
  },
  set(state) {
    if (RUN_STATES.indexOf(state) < 0 || this.state === 'idle') return false;
    if (this.state === state) return true;
    this.state = state;
    this.history.push({ state: state, at: Math.round(performance.now() - this.startedAt) });
    RunSession._render();
    return true;
  },
  /** 事件是否属于当前会话：没有 sid 的事件按「属于」处理（兼容旧原生实现） */
  isCurrent(sid) { return !!this.sid && (!sid || sid === this.sid); },
  end() {
    if (this.state !== 'idle') this.state = 'terminal';
    this.sid = null; this.state = 'idle'; this.kind = '';
    RunSession._render();
  },
  _render() {
    const el = $('status-run');
    if (!el) return;
    const map = { queued: 'run_queued', preparing: 'run_preparing', building: 'run_building', running: 'run_running', waitingInput: 'run_waiting', stopping: 'run_stopping', terminal: 'run_terminal' };
    el.textContent = this.state === 'idle' ? '' : t(map[this.state] || 'run_running');
    el.classList.toggle('hidden', this.state === 'idle');
    el.dataset.state = this.state;
  }
};

async function runCurrent() {
  if (running) {
    // 运行中点击 = 停止：按引擎立即终止，不再等超时
    if (runningKind === 'termux' || runningKind === 'py-termux') {
      RunSession.set('stopping');   // v5.10.0
      if (window.Android && Android.cancelCpp) Android.cancelCpp();
      outAppend('⏹ KeyboardInterrupt: 已手动停止（Termux ' + (runningKind === 'py-termux' ? 'Python' : '编译/运行') + '进程已终止）\n', 'out-err');
      finishCpp();
    } else if (runningKind === 'jscpp') {
      if (jscppTimer) { clearTimeout(jscppTimer); jscppTimer = null; }
      if (cppWorker) { try { cppWorker.terminate(); } catch (e) {} cppWorker = null; }
      outAppend('⏹ KeyboardInterrupt: 已手动停止（JSCPP 进程已终止）\n', 'out-err');
      setRunning(false);
    } else if (runningKind === 'cpp-online' || runningKind === 'py-online') {
      if (onlineAbort) { try { onlineAbort.abort(); } catch (e) {} }
      outMeta('已取消云端运行请求…');
    } else {
      // 内置 Python：v4.10 Worker 模式可强制终止；主线程回退模式仍无法中断同步执行
      if (pyMode === 'worker' && pyWorker) {
        try { pyWorker.terminate(); } catch (e) {}
        if (pyWorkerCtl) { clearTimeout(pyWorkerCtl.timeout); clearInterval(pyWorkerCtl.climb); pyWorkerCtl.resolve('stopped'); pyWorkerCtl = null; }
        pyWorker = null; pyWorkerOk = false; pyWorkerLoadPromise = null;
        pySAB = null; pyCTRL = null; pyDATALEN = null; pyInputWait = false;
        pyOutCount = 0;
        setPyState('idle');
        pyTermInputReset();
        if (pyRunDone) { const f = pyRunDone; pyRunDone = null; f({}); }
        outAppend('⏹ KeyboardInterrupt: 已强制终止（Python Worker 已停止，下次运行自动重启）\n', 'out-err');
      } else if (interruptMainThreadPy()) {
        outAppend('⏹ KeyboardInterrupt: 已向主线程 Python 发送中断请求…\n', 'out-err');
      } else {
        outMeta('已停止（当前环境不提供中断缓冲，无法强制中断运行中的程序；无限循环请改用在线引擎或 Termux）。');
      }
      setRunning(false);
    }
    return;
  }
  if (!editorReady || !cm) { outAppend('编辑器尚未就绪，请稍候。\n', 'out-err'); return; }
  const pl = pluginLangOf(state.active);
  const lang = pl ? 'plugin' : langOf(state.active);
  if (!lang) { outAppend('仅支持运行 .py 与 .cpp/.c 文件（插件语言见其说明）。\n', 'out-err'); return; }
  saveStore();
  $('output-view').classList.remove('hidden');
  clearCodeErrors();
  if (lang === 'plugin') {
    // v4.4 插件语言：交给插件 onRun 自行编排（execTermux / runCapture）
    const f = state.files.find(x => x.name === state.active);
    try {
      const taken = pl.plugin.onRun && pl.plugin.onRun(f, f.content, pl.def, window.PCPluginAPI);
      if (!taken) outAppend('[插件] ' + (pl.plugin.id || '?') + ' 未提供 onRun 运行逻辑。\n', 'out-err');
    } catch (e) {
      outAppend('[插件] 运行出错：' + (e.message || e) + '\n', 'out-err');
    }
    return;
  }
  const mode = lang === 'python' ? null : resolveCppEngine();
  setRunning(true, lang === 'python' ? (pyEngine === 'online' ? 'py-online' : pyEngine === 'termux' ? 'py-termux' : 'python')
    : (mode === 'termux' ? 'termux' : mode === 'online' ? 'cpp-online' : 'jscpp'));
  if (lang === 'python') {
    if (pyEngine === 'termux') {
      // v4.7 Termux 原生解释器：真实 CPython，可 pip 安装任意第三方库（与 C++ 配置分离，python 自动安装）
      if (!window.Android || !Android.runPyTermux) { outAppend('Termux Python 仅在安卓应用内可用，请切换其他引擎。\n', 'out-err'); setRunning(false); return; }
      if (!(termuxEnv && termuxEnv.termux)) { outAppend('未检测到 Termux 应用：菜单 → 环境向导 ① 获取 Termux。\n', 'out-err'); setRunning(false); return; }
      if (projectMode()) outMeta('提示：项目内 .py 会平铺写入交换目录，同目录模块可直接 import；带目录结构的复杂包请把包放入 /sdcard/QingCode/site-packages/ 或在 Termux 终端运行。');
      runPythonTermux();
      return;   // 结果经 __onCppResult 回调收尾
    }
    if (pyEngine === 'online') {
      if (projectMode()) outMeta('提示：在线引擎暂不支持 import 项目内其他文件；需项目内互相调用请切换 Python 引擎为「内置 Pyodide」。');
      await runPythonOnline(); setRunning(false); return;
    }
    /* v5.10.1 安全（审查 P0-4）：主线程模式下用户代码 `import js` 就能调 js.Android.execTermux，
       等于绕过插件权限与 Termux 确认。缺少跨域隔离时不再静默回退，直接拒绝运行并说明原因。 */
    if (!pyWorkerSupported() || pyMode === 'main') {
      outAppend('⚠ ' + t('py_no_isolation') + '\n', 'out-err');
      outMeta(t('py_no_isolation_hint'));
      setRunning(false);
      return;
    }
    const ok = await ensurePyodide();
    if (!ok) { setRunning(false); return; }
    await runPython();
    setRunning(false);
  } else {
    const mode2 = resolveCppEngine();
    if (mode2 === 'termux') runCppTermux();
    else if (mode2 === 'online') {
      if (projectMode() && state.files.some(f => /\.(h|hpp|hh)$/i.test(f.name)))
        outMeta('提示：在线引擎暂不支持项目内头文件（#include "xxx.h"）；需使用请切换 C++ 引擎为 Termux。');
      await runCppOnline(); setRunning(false);
    }
    else if (mode2 === 'unavail') {
      outAppend('已选择「仅 Termux」但 Termux 未就绪。\n\n' + t('termux_help') + '\n', 'out-err');
      setRunning(false);
    } else {
      if (cppEngine === 'auto' && window.Android && !(termuxEnv && termuxEnv.termux)) {
        outMeta('未检测到已配置的 Termux，使用内置 JSCPP（菜单 → 环境向导可配置真实编译）');
      }
      if (cppEngine === 'auto' && termuxEnv && termuxEnv.termux && !termuxEnv.storage) {
        outAppend('Termux 已就绪，但缺少「所有文件访问」权限（交换目录不可写）。\n', 'out-err');
        setRunning(false);
        guideStoragePermission();
        return;
      }
      runCppJscpp();
    }
  }
}

/* ---------- 智能补全（v4.0：标准语法/函数 + 已导入库成员 + 文档单词） ---------- */
const PC_KEYWORDS = {
  python: ['def', 'class', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'as', 'return',
    'try', 'except', 'finally', 'with', 'lambda', 'None', 'True', 'False', 'and', 'or', 'not', 'in',
    'is', 'pass', 'break', 'continue', 'global', 'nonlocal', 'yield', 'raise', 'assert', 'del',
    'print(', 'len(', 'range(', 'input(', 'int(', 'str(', 'float(', 'list(', 'dict(', 'set(',
    'tuple(', 'sorted(', 'reversed(', 'sum(', 'min(', 'max(', 'abs(', 'round(', 'enumerate(',
    'zip(', 'map(', 'filter(', 'type(', 'isinstance(', 'open(', 'format(', 'any(', 'all(',
    'dir(', 'hasattr(', 'getattr(', 'setattr(', 'ord(', 'chr(', 'hex(', 'bin(', 'oct(',
    'divmod(', 'pow(', 'repr(', 'hash(', 'iter(', 'next(', 'super(', 'staticmethod(', 'classmethod('],
  cpp: ['int', 'float', 'double', 'char', 'bool', 'void', 'long', 'short', 'signed', 'unsigned',
    'const', 'static', 'struct', 'class', 'public:', 'private:', 'protected:', 'virtual', 'override',
    'friend', 'template<typename T>', 'typename', 'namespace', 'using namespace std;', 'return',
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'default:',
    'new', 'delete', 'this', 'nullptr', 'true', 'false', 'try', 'catch', 'throw', 'sizeof',
    'typedef', 'enum', 'auto', 'inline', 'explicit', 'mutable', 'operator', 'std::cout', 'std::cin',
    'std::endl', 'std::string', 'std::vector<>', 'std::map<>', 'std::set<>', 'std::pair<>',
    'printf(', 'scanf(', 'memset(', 'memcpy(', 'malloc(', 'free(', 'strlen(', 'strcpy(']
};
const PC_LIB_MEMBERS = {
  python: {
    math: ['sin(', 'cos(', 'tan(', 'sqrt(', 'pi', 'e', 'log(', 'log2(', 'log10(', 'floor(', 'ceil(',
      'pow(', 'fabs(', 'factorial(', 'gcd(', 'exp(', 'degrees(', 'radians(', 'inf', 'tau'],
    random: ['random()', 'randint(', 'choice(', 'shuffle(', 'uniform(', 'sample(', 'seed(', 'randrange('],
    os: ['path', 'name', 'getcwd()', 'listdir(', 'makedirs(', 'mkdir(', 'remove(', 'rename(', 'system(',
      'sep', 'path.join(', 'path.exists(', 'path.basename(', 'path.dirname(', 'environ'],
    sys: ['argv', 'path', 'stdin', 'stdout', 'stderr', 'exit(', 'version', 'maxsize', 'platform'],
    time: ['time()', 'sleep(', 'strftime(', 'localtime()', 'ctime()', 'gmtime()', 'perf_counter()'],
    json: ['dumps(', 'loads(', 'dump(', 'load(', 'JSONEncoder', 'JSONDecoder'],
    re: ['match(', 'search(', 'findall(', 'sub(', 'split(', 'compile(', 'escape(', 'fullmatch('],
    turtle: ['Turtle()', 'Screen()', 'forward(', 'backward(', 'right(', 'left(', 'penup()',
      'pendown()', 'color(', 'begin_fill()', 'end_fill()', 'goto(', 'speed(', 'done()'],
    collections: ['Counter(', 'defaultdict(', 'OrderedDict(', 'deque(', 'namedtuple('],
    itertools: ['chain(', 'product(', 'permutations(', 'combinations(', 'count(', 'cycle('],
    functools: ['reduce(', 'lru_cache(', 'partial(', 'wraps('],
    datetime: ['datetime(', 'date(', 'time(', 'timedelta(', 'now()', 'today()', 'strftime('],
    tkinter: ['Tk()', 'Canvas(', 'Button(', 'Label(', 'Entry(', 'mainloop()', 'geometry(']
  },
  cpp: {
    std: ['cout', 'cin', 'endl', 'cerr', 'string', 'vector<>', 'map<>', 'set<>', 'unordered_map<>',
      'unordered_set<>', 'pair<>', 'tuple<>', 'array<>', 'queue<>', 'stack<>', 'deque<>', 'list<>',
      'sort(', 'reverse(', 'find(', 'max(', 'min(', 'max_element(', 'min_element(', 'swap(',
      'abs(', 'floor(', 'ceil(', 'sqrt(', 'pow(', 'to_string(', 'stoi(', 'stoll(', 'stod(',
      'upper_bound(', 'lower_bound(', 'count(', 'accumulate(', 'fill(', 'copy(', 'move(',
      'make_pair(', 'make_tuple(', 'getline(', 'push_back(', 'pop_back(', 'size()', 'empty()',
      'clear()', 'begin()', 'end()', 'insert(', 'erase(', 'resize(', 'front()', 'back()', 'flush']
  }
};
const PC_INCLUDES = ['iostream', 'cmath', 'cstring', 'cstdio', 'cstdlib', 'ctime', 'vector', 'map',
  'set', 'unordered_map', 'unordered_set', 'algorithm', 'string', 'queue', 'stack', 'deque',
  'bitset', 'utility', 'functional', 'numeric', 'cassert', 'fstream', 'sstream', 'iomanip', 'memory'];
/* ---------- 项目空间（v4.0：本地文件夹作为工程，文件互相调用 + 定时自动保存） ---------- */
function projectMode() { return !!projectRoot; }

/* ============================================================
 * v5.5.0 工作区持久化 + 未保存缓冲区（移动 IDE 改造 · 阶段 1 的一部分）
 * - localStorage 只放工作区元数据（根路径 / 活动文件 / 每个文件的磁盘签名）；
 * - 未保存内容放 IndexedDB（容量远大于 localStorage 的 5MB），保存成功后删除对应草稿；
 * - 保存前比对磁盘签名（size:mtime），外部改过的文件不静默覆盖。
 * 尚未覆盖：按需加载、多标签、每文件 EditorState、SAF（见后续阶段）。
 * ============================================================ */
const WS_KEY = 'pc_workspace';                  // v5.7.0 起只用于旧版数据迁移
const DRAFT_DB = 'pc_ws', DRAFT_STORE = 'drafts', META_STORE = 'meta';
const DraftStore = {
  _dbP: null,
  open() {
    if (this._dbP) return this._dbP;
    if (typeof indexedDB === 'undefined') { this._dbP = Promise.reject(new Error('no indexedDB')); return this._dbP; }
    this._dbP = new Promise((res, rej) => {
      /* v5.7.0：版本 2 新增 meta 存储（工作区元数据，localStorage 只留界面设置） */
      const r = indexedDB.open(DRAFT_DB, 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        try { if (!db.objectStoreNames.contains(DRAFT_STORE)) db.createObjectStore(DRAFT_STORE); } catch (e) {}
        try { if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE); } catch (e) {}
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { storeIssue(t('store_draft_fail')); rej(r.error); };
    });
    return this._dbP;
  },
  put(key, val) {
    return this.open().then(db => new Promise((res, rej) => {
      const tx = db.transaction(DRAFT_STORE, 'readwrite');
      tx.objectStore(DRAFT_STORE).put(val, key);
      tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
    })).then(ok => { if (ok) storeOk(); return ok; })
      .catch(() => { storeIssue(t('store_draft_fail')); return false; });
  },
  del(key) {
    return this.open().then(db => new Promise((res, rej) => {
      const tx = db.transaction(DRAFT_STORE, 'readwrite');
      tx.objectStore(DRAFT_STORE).delete(key);
      tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
    })).catch(() => false);
  },
  /** 返回 [[key, content], ...]（单事务内同时取 keys/values，避免两次读取错位） */
  all() {
    return this.open().then(db => new Promise((res, rej) => {
      const tx = db.transaction(DRAFT_STORE, 'readonly');
      const st = tx.objectStore(DRAFT_STORE);
      const kr = st.getAllKeys(), vr = st.getAll();
      tx.oncomplete = () => res(kr.result.map((k, i) => [k, vr.result[i]]));
      tx.onerror = () => rej(tx.error);
    })).catch(() => []);
  }
};
/** v5.7.0：工作区元数据（根路径 / 活动文件 / 标签 / 文件签名）存 IndexedDB */
const WsMeta = {
  get() {
    return DraftStore.open().then(db => new Promise((res, rej) => {
      const q = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get('ws');
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    })).catch(() => null);
  },
  put(val) {
    return DraftStore.open().then(db => new Promise((res, rej) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put(val, 'ws');
      tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
    })).then(ok => { if (ok) storeOk(); return ok; })
      .catch(() => { storeIssue(t('store_meta_fail')); return false; });
  },
  clear() {
    return DraftStore.open().then(db => new Promise((res, rej) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).delete('ws');
      tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
    })).catch(() => false);
  }
};
function draftKey(rel) { return (projectRoot || '') + '\n' + rel; }

/* ---------- v5.6.0 按需加载：惰性文件（content === null）在首次需要时才读磁盘 ---------- */
/** 读项目内单个文件；失败返回 null（空文件返回 ""） */
function loadProjectFile(rel) {
  if (!(window.Android && Android.readProjectFile) || !projectRoot) return null;
  try {
    const r = Android.readProjectFile(projectRoot, rel);
    return (r === null || r === undefined) ? null : String(r);
  } catch (e) { return null; }
}
/** 确保文件内容已加载；成功返回 true。加载后把 _saved 对齐磁盘版本（不算脏）。 */
function ensureContent(f) {
  if (!f) return false;
  if (f.content !== null) return true;
  const txt = loadProjectFile(f.name);
  if (txt === null) return false;
  f.content = txt;
  f._saved = txt;
  f._lazy = false;
  /* 读到的就是当前磁盘版本 → 刷新签名，这样「加载后被外部改过」才能被检测到 */
  f._sig = sigOf(f.name) || f._sig;
  return true;
}
/** 加载惰性文件（全局搜索 / 符号需要）。带内存预算：跳过会超出预算的大文件，返回本次加载数量。 */
const ENSURE_ALL_BUDGET = 20 * 1024 * 1024;   // 20MB
function ensureAllContent() {
  let n = 0, bytes = 0;
  for (const f of state.files) {
    if (f.content !== null) continue;
    const sz = f._size || 0;
    if (bytes + sz > ENSURE_ALL_BUDGET) continue;   // 预算外的大文件不加载，避免整项目塞进内存
    if (ensureContent(f)) { n++; bytes += sz; }
  }
  return n;
}

let pendingRestore = null;   // 启动恢复时暂存的工作区元数据，等 readProject 回调后应用
let restoreMeta = null;      // v5.7.0：本次恢复所用的元数据（含上次关闭时的磁盘签名与标签）
let draftTimer = null;
let wsMetaTimer = null;
let wsMetaStored = false;   // 是否真的写过元数据（避免默认空间每次 saveStore 都开事务去清）

/** 工作区元数据（不含文件内容）：重启后据此恢复项目模式、标签与活动文件
 *  v5.7.0：改存 IndexedDB（localStorage 只留界面设置），并合并写以减少事务次数 */
function saveWorkspaceMeta() {
  if (!projectRoot) {
    if (wsMetaTimer) { clearTimeout(wsMetaTimer); wsMetaTimer = null; }
    if (wsMetaStored) { wsMetaStored = false; WsMeta.clear(); }
    return;
  }
  if (wsMetaTimer) clearTimeout(wsMetaTimer);
  wsMetaTimer = setTimeout(flushWorkspaceMeta, 500);
}
function flushWorkspaceMeta() {
  if (wsMetaTimer) { clearTimeout(wsMetaTimer); wsMetaTimer = null; }
  if (!projectRoot) return;
  wsMetaStored = true;
  WsMeta.put({
    v: 2,
    root: projectRoot,
    active: state.active || null,
    tabs: (state.tabs || []).slice(),
    files: state.files.map(f => ({ rel: f.name, sig: f._sig || null })),
    savedAt: Date.now()
  });
}
/** 旧版把元数据放在 localStorage：这里读出并迁移，随后由 restoreWorkspace 使用 */
function takeLegacyWsMeta() {
  let raw = null;
  try { raw = localStorage.getItem(WS_KEY); } catch (e) { return null; }
  if (!raw) return null;
  try { localStorage.removeItem(WS_KEY); } catch (e) {}
  try {
    const o = JSON.parse(raw);
    if (o && o.root) { WsMeta.put(o); return o; }
  } catch (e) {}
  return null;
}

/** 磁盘签名（size:mtime）；浏览器 / 无原生桥时返回 null（跳过冲突检测） */
function sigOf(rel) {
  if (!(window.Android && Android.statFile)) return null;
  try {
    const raw = Android.statFile(projectRoot + '/' + rel);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return (o && o.size != null && o.mtime != null) ? (o.size + ':' + o.mtime) : null;
  } catch (e) { return null; }
}

/** 编辑后延迟落草稿（1.2s 合并高频输入） */
function scheduleDraft() {
  if (!projectMode()) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(function () {
    const f = state.files.find(x => x.name === state.active);
    if (!f) return;
    if (f._saved === f.content) DraftStore.del(draftKey(f.name));
    else DraftStore.put(draftKey(f.name), String(f.content == null ? '' : f.content));
  }, 1200);
}

/** 把草稿合并回刚读取的磁盘内容（保留 _saved 为磁盘版本 → 仍算脏，等待保存）
 *  v5.7.0：同时比对上一次关闭时记录的磁盘签名——
 *  · 期间被外部改过 → 保留草稿，但把 _sig 还原成「草稿所基于的版本」，
 *    这样保存时既有的冲突检查会拒绝覆盖并报告，绝不静默盖掉对方的修改；
 *  · 文件在磁盘上已删除 → 草稿无处可放，明确报告而不是悄悄丢弃。 */
function applyDrafts() {
  const metaSig = new Map();
  if (restoreMeta && Array.isArray(restoreMeta.files)) {
    for (const it of restoreMeta.files) if (it && it.rel) metaSig.set(it.rel, it.sig || null);
  }
  DraftStore.all().then(list => {
    const prefix = projectRoot + '\n';
    let n = 0;
    const changed = [], orphans = [];
    for (const pair of list) {
      const k = pair[0], v = pair[1];
      if (typeof k !== 'string' || k.indexOf(prefix) !== 0) continue;
      const rel = k.slice(prefix.length);
      const f = state.files.find(x => x.name === rel);
      if (!f) { orphans.push(rel); continue; }
      if (f.content === v) { DraftStore.del(k); continue; }
      /* 草稿基于旧版本，而磁盘已经变了 → 记下旧签名，保存时走「不覆盖 + 报告」分支 */
      const oldSig = metaSig.get(rel);
      if (oldSig && f._sig && oldSig !== f._sig) { f._sig = oldSig; changed.push(rel); }
      f.content = v;
      viewStates.delete(rel);      // 内容已变，旧的视图状态作废（避免切回来还原出草稿前的文档）
      n++;
    }
    outAppend('📁 ' + projectLabel() + '\n', 'out-echo');
    if (state.active) openFile(state.active);   // 刷新编辑器为合并后的内容
    if (n) outMeta(t('ws_restored').replace('{n}', state.files.length).replace('{m}', n));
    else outMeta(t('ws_reopened').replace('{n}', state.files.length));
    if (changed.length) {
      outAppend('⚠ ' + t('ws_external_changed') + '\n' + changed.map(r => '  · ' + r).join('\n') + '\n', 'out-err');
    }
    if (orphans.length) {
      outAppend('⚠ ' + t('ws_draft_orphan') + '\n' + orphans.map(r => '  · ' + r).join('\n') + '\n', 'out-err');
      for (const rel of orphans) DraftStore.del(prefix + rel);
    }
    renderFileList();
    renderTabs();
  });
}

/** 启动时尝试恢复上次的工作区（目录仍可访问才恢复；失败则清掉元数据）
 *  v5.7.0：元数据在 IndexedDB → 变成异步；同时接管旧版 localStorage 数据。 */
async function restoreWorkspace() {
  if (projectMode()) return;
  if (!(window.Android && Android.readProject && Android.projectExists)) return;
  let meta = null;
  try { meta = await WsMeta.get(); } catch (e) { meta = null; }
  if (!meta || !meta.root) meta = takeLegacyWsMeta();
  if (!meta || !meta.root) return;
  /* v5.10.0：SAF 工作区用 "saf:<id>" 令牌恢复；令牌能解析即说明授权仍在 */
  const isSaf = String(meta.root).indexOf('saf:') === 0;
  if (isSaf && Android.treeWorkspaceInfo) {
    try {
      const info = Android.treeWorkspaceInfo(String(meta.root));
      if (info) projectDisplayName = JSON.parse(info).name || '';
    } catch (e) {}
  }
  const label = isSaf ? (projectDisplayName || t('saf_workspace')) : meta.root;
  let ok = false;
  try { ok = Android.projectExists(meta.root); } catch (e) { ok = false; }
  if (!ok) {
    /* 授权失效 / 目录被删 / 存储不可访问：不再盲目重试，明确告知并清掉元数据 */
    outAppend('⚠ ' + t('ws_lost') + label + '\n', 'out-err');
    WsMeta.clear();
    return;
  }
  pendingRestore = meta;
  outMeta(t('ws_restoring') + label);
  if (Android.readProjectMeta) Android.readProjectMeta(meta.root);
  else Android.readProject(meta.root);
}

/* v5.6.0：超过任一阈值就走「按需加载」，小项目仍全量读取（保持原有行为与插件兼容） */
const LAZY_MIN_FILES = 40;
const LAZY_MIN_BYTES = 1.5 * 1024 * 1024;

function onProjectLoaded(data) {
  if (!data || data.error) {
    outAppend('打开项目失败：' + (data && data.error || '未知错误') + '\n', 'out-err');
    pendingRestore = null;
    return;
  }
  /* 元数据回调：小项目回退到一次全量读取（pendingRestore 保留到那次回调消费） */
  if (data.metaOnly) {
    /* v5.10.0：SAF 工作区一律按需加载（原生没有「一次读全」的 SAF 版本，
       直接走 readProject 会撞上绝对路径校验） */
    if (data.saf) { buildProjectFiles(data, true); return; }
    let total = 0;
    for (const f of data.files) total += (f.size || 0);
    if (data.files.length <= LAZY_MIN_FILES && total <= LAZY_MIN_BYTES) {
      Android.readProject(data.path);
      return;
    }
    buildProjectFiles(data, true);
    return;
  }
  buildProjectFiles(data, false);
}

function buildProjectFiles(data, lazy) {
  projectRoot = data.path;
  if (data.saf && data.name) projectDisplayName = data.name;   // v5.10.0：SAF 工作区显示名
  const files = [];
  for (const f of data.files) {
    /* 惰性模式下 content 为 null（未加载）；_saved 也置 null，避免被当成「已保存的空文件」写回磁盘 */
    files.push({
      name: f.rel,
      content: lazy ? null : f.content,
      _saved: lazy ? null : f.content,
      _sig: (f.size != null && f.mtime != null) ? (f.size + ':' + f.mtime) : null,
      _size: f.size != null ? f.size : null,
      _lazy: !!lazy
    });
  }
  if (!files.length) files.push({ name: 'main.py', content: '', _saved: '', _lazy: false });
  state.files = files;
  const restoring = !!pendingRestore;
  restoreMeta = restoring ? { files: pendingRestore.files || [], tabs: pendingRestore.tabs || [] } : null;
  const wantActive = pendingRestore && pendingRestore.active;
  state.active = (wantActive && files.some(f => f.name === wantActive)) ? wantActive : files[0].name;
  /* v5.7.0：恢复上次的标签集合（只保留仍然存在的文件）；新开项目 / 换项目一律重置 */
  viewStates.clear();
  let tabs = restoring ? restoreMeta.tabs.filter(n => files.some(f => f.name === n)) : [];
  if (tabs.indexOf(state.active) < 0) tabs.unshift(state.active);
  state.tabs = tabs;
  pendingRestore = null;
  saveStore();
  renderFileList();
  openFile(state.active);
  syncProjectMenu();
  if (restoring) applyDrafts();
  else {
    outAppend('📁 项目已打开：' + projectRoot + '（' + files.length + ' 个文件'
      + (lazy ? '，按需加载' : '') + '）\n', 'out-echo');
    outMeta(lazy
      ? t('ws_lazy_hint').replace('{n}', files.length)
      : '文件夹即项目空间：Python 可直接 import 项目内模块；每 30 秒自动保存到原位置。');
  }
}

/* v4.11.2 修复：原生 readProject() 的回调名是 window.__onProjectLoaded，
   此前只声明了内部函数名 onProjectLoaded，原生的 `window.__onProjectLoaded && …` 被短路，
   导致选完项目目录后界面毫无反应（打开文件夹功能完全失效）。 */
window.__onProjectLoaded = onProjectLoaded;

function openProjectFolder() {
  if (!(window.Android && Android.pickProjectFolder)) {
    outAppend(t('only_android'), 'out-err');
    return;
  }
  outMeta('请在弹出的对话框中选择项目文件夹…');
  const path = Android.pickProjectFolder();
  if (!path) { outMeta('已取消。'); return; }
  /* v5.6.0：先取元数据（快），再由 onProjectLoaded 决定全量还是按需 */
  if (Android.readProjectMeta) Android.readProjectMeta(path);
  else Android.readProject(path);
}

/** 打开单个本地文件（智能编码识别）加入当前文件列表 */
function openLocalFile() {
  if (!(window.Android && Android.pickOpenFile)) {
    outAppend(t('only_android'), 'out-err');
    return;
  }
  const path = Android.pickOpenFile();
  if (!path) return;
  outMeta('正在打开：' + path);
  Android.readSingleFile(path);
}
window.__onSingleFileLoaded = function (data) {
  if (!data || data.error) {
    outAppend('打开文件失败：' + (data && data.error || '未知错误') + '\n', 'out-err');
    return;
  }
  let name = data.name || 'untitled.txt';
  let base = name, ext = '', n = 1;
  const dot = name.lastIndexOf('.');
  if (dot > 0) { base = name.slice(0, dot); ext = name.slice(dot); }
  while (state.files.some(f => f.name === name)) name = base + ' (' + (++n) + ')' + ext;
  state.files.push({ name, content: data.content, _saved: data.content });
  saveStore();
  renderFileList();
  openFile(name);
  outMeta('📄 已打开 ' + name + '（' + data.content.length + ' 字符' + (projectMode() ? '，加入项目空间' : '') + '）');
}

function closeProject() {
  const oldRoot = projectRoot;
  projectRoot = null;
  /* v5.5.0：主动关闭项目 → 丢弃该工作区的未保存草稿，避免下次恢复时又冒出来 */
  if (oldRoot) {
    const prefix = oldRoot + '\n';
    DraftStore.all().then(list => {
      for (const pair of list) if (typeof pair[0] === 'string' && pair[0].indexOf(prefix) === 0) DraftStore.del(pair[0]);
    });
  }
  state.files = [
    { name: 'main.py', content: PY_DEFAULT_CODE, _saved: PY_DEFAULT_CODE },
    { name: 'hello.cpp', content: CPP_DEFAULT_CODE, _saved: CPP_DEFAULT_CODE }
  ];
  state.active = 'main.py';
  state.tabs = ['main.py'];     // v5.7.0：换空间 → 标签与视图状态一并重置
  viewStates.clear();
  saveStore();
  renderFileList();
  openFile(state.active);
  outMeta('已关闭项目空间，恢复默认示例文件。');
  syncProjectMenu();
}

/** 项目内全部 py 写入 Pyodide 虚拟文件系统 → import 项目模块可用 */
function injectProjectToPyodide() {
  if (!projectMode() || !pyodide) return;
  try {
    const FS = pyodide.FS;
    if (!FS || !FS.analyzePath) return;
    for (const f of state.files) {
      if (!f.name.endsWith('.py')) continue;
      if (f.content === null && !ensureContent(f)) continue;   // v5.6.0：运行需要内容，按需加载
      const full = '/home/pyodide/' + f.name;
      const dir = full.slice(0, full.lastIndexOf('/'));
      if (!FS.analyzePath(dir).exists) {
        const parts = dir.split('/').filter(Boolean);
        let cur = '';
        for (const p of parts) { cur += '/' + p; try { FS.mkdir(cur); } catch (e2) {} }
      }
      FS.writeFile(full, f.content);
    }
  } catch (e) { console.warn('inject FS', e); }
}

/** 项目内头文件写入 Termux 运行会话目录 → #include "xxx.h" 可用（v4.9.3：与会话同目录；无会话回退交换目录） */
/* v5.10.0：运行暂存器——所有引擎共用，保留项目相对目录结构。
   旧实现把文件平铺到会话根目录（只取 basename），于是 #include "sub/x.h"、
   import 包内模块一类带目录的引用一律找不到。 */
function writeSessionFile(sess, rel, content) {
  try {
    if (sess && Android.saveFileRel) return !!Android.saveFileRel(sess, rel, content);
    /* 老版本原生没有 saveFileRel：退化为平铺（保持可用，不阻断运行） */
    const base = String(rel).split('/').pop();
    if (sess && Android.saveFileIn) return !!Android.saveFileIn(sess, base, content);
    if (Android.writeSwapFile) return !!Android.writeSwapFile(base, content);
  } catch (e) {}
  return false;
}
function stageProjectForTermux(sess, kind) {
  if (!projectMode() || !window.Android) return 0;
  const want = kind === 'py' ? /\.py$/i : /\.(c|cc|cpp|cxx|h|hpp|hh|hxx|inc)$/i;
  let n = 0;
  for (const f of state.files) {
    if (!want.test(f.name)) continue;
    if (f.content === null && !ensureContent(f)) continue;   // v5.6.0：惰性文件先读盘
    if (writeSessionFile(sess, f.name, f.content)) n++;
  }
  return n;
}

/** 定时自动保存：把改动写回项目原位置（按编码） */
function autoSaveProject(manual) {
  if (!projectMode() || !window.Android || !Android.writeProjectFile) return;
  if (!autoSaveOn && !manual) return;
  let n = 0, fail = 0;
  const conflicts = [];
  for (const f of state.files) {
    if (f._saved !== undefined && f._saved === f.content) continue;
    if (f.content === null) continue;          // v5.6.0：未加载的惰性文件绝不写入
    /* v5.5.0：保存前校验磁盘签名——文件在外部被改过就跳过，绝不静默覆盖 */
    const cur = sigOf(f.name);
    if (cur && f._sig && cur !== f._sig) { conflicts.push(f.name); continue; }
    const full = projectRoot + '/' + f.name;
    const ok = Android.writeProjectFile(full, f.content, exportEncoding);
    if (ok) {
      f._saved = f.content;
      f._sig = sigOf(f.name) || f._sig;      // 写后刷新签名，后续比较以新版本为准
      DraftStore.del(draftKey(f.name));      // 已落盘 → 草稿不再需要
      n++;
    } else fail++;
  }
  if (n || manual) {
    outMeta((manual ? '已手动保存 ' : '自动保存 ') + n + ' 个文件 → ' + projectRoot + '（' + exportEncoding + '）');
  }
  if (conflicts.length) {
    outAppend('⚠ ' + t('ws_conflict') + conflicts.join('、') + '\n' + t('ws_conflict_hint') + '\n', 'out-err');
  }
  if (fail) {
    let why = '';
    try { why = (Android && Android.lastWriteError) ? String(Android.lastWriteError() || '') : ''; } catch (e) { why = ''; }
    outAppend('⚠ 有 ' + fail + ' 个文件保存失败' + (why ? ('：' + why) : '') + '\n'
      + (why ? '' : '（常见原因：所选编码不支持文件内容，如 ASCII 含中文；可在菜单切换编码后重试）\n'), 'out-err');
  }
  if (n) { renderTabs(); refreshActiveTabDirty(); }   // v5.7.0：保存后清掉标签上的未保存圆点
}
function startAutoSaveLoop() {
  clearInterval(projectSaveTimer);
  projectSaveTimer = setInterval(() => autoSaveProject(false), 30000);
}

/* ============================================================
 * v5.10.0：SAF 工作区
 * projectRoot 在 SAF 模式下是 "saf:<id>" 令牌；原生按令牌走 ContentResolver，
 * 其余代码（读/写/签名/恢复）无需区分——所有写入都绑定在已授权的目录树上。
 * ============================================================ */
let projectDisplayName = '';
function projectLabel() {
  if (!projectMode()) return '';
  return projectRoot.indexOf('saf:') === 0 ? (projectDisplayName || t('saf_workspace')) : projectRoot;
}
function openSafWorkspace() {
  if (!(window.Android && Android.openTreeWorkspace)) {
    outAppend('该功能仅在安卓应用内可用。\n', 'out-err');
    return false;
  }
  outMeta(t('saf_picking'));
  try { return !!Android.openTreeWorkspace(); }
  catch (e) { outAppend('打开目录选择器失败：' + (e.message || e) + '\n', 'out-err'); return false; }
}
/** 系统目录选择器回调 */
window.__onTreeWorkspace = function (info) {
  if (!info || info.cancelled) { outMeta(t('saf_cancelled')); return; }
  if (!info.id) { outAppend('未取得工作区标识。\n', 'out-err'); return; }
  const token = 'saf:' + info.id;
  projectDisplayName = info.name || '';
  outMeta(t('saf_opened').replace('{n}', projectDisplayName || info.id));
  pendingRestore = null;
  if (Android.readProjectMeta) Android.readProjectMeta(token);
  else Android.readProject(token);
};
function syncProjectMenu() {
  const btn = document.getElementById('mi-close-project');
  if (btn) btn.style.display = projectMode() ? 'block' : 'none';
  const sa = document.getElementById('mi-save-all');
  if (sa) sa.style.display = projectMode() ? 'block' : 'none';
  const as = document.getElementById('mi-autosave');
  if (as) as.textContent = autoSaveOn ? t('mi_autosave') : t('autosave_off_txt');
  const ts = document.getElementById('mi-term-session');
  if (ts) ts.textContent = termSessionActive ? (LANG === 'en' ? 'Disconnect Termux session' : '断开 Termux 终端会话') : t('mi_term');
}

/* ---------- 编码导出（v4.0） ---------- */
const ENCODINGS = ['UTF-8', 'UTF-8 BOM', 'UTF-16LE', 'UTF-16BE', 'GBK', 'ASCII'];

/* ---------- Termux 内嵌终端会话（v4.0） ---------- */
window.__onTermOut = function (text) {
  if (text) outAppend(text);
};
function toggleTermSession() {
  if (!(window.Android && Android.startTermSession)) {
    outAppend('该功能仅在安卓应用内可用（需已安装 Termux）。\n', 'out-err');
    return;
  }
  if (termSessionActive) {
    Android.stopTermSession();
    termSessionActive = false;
    outAppend('会话已断开。\n', 'out-meta');
  } else {
    outAppend('$ 正在连接 Termux 终端会话…（sh 持久会话：cd/环境状态保持）\n', 'out-echo');
    const ok = Android.startTermSession();
    termSessionActive = !!ok;
    if (ok) outMeta('会话已连接：在下方输入框输入命令回车执行（如 ls、python3、cd）。命令实时传至 Termux，输出实时回传。');
    else outAppend('连接失败：请确认已安装 Termux 并批准运行命令权限。\n', 'out-err');
  }
  syncProjectMenu();
}

/* ---------- 终端输入行 ---------- */
function sendTermInput() {
  const box = $('term-input');
  const line = box.value;
  box.value = '';
  if (termSessionActive) {
    outEcho(line);
    if (window.Android && Android.sendTermCmd) Android.sendTermCmd(line);
    else outAppend('(未连接 Termux)\n', 'out-err');
  } else if (cppRunning) {
    outEcho(line);
    if (window.Android && Android.sendCppInput) Android.sendCppInput(line);
    else outAppend('(未连接 Termux)\n', 'out-err');
  } else if (runningKind === 'python' && pyMode === 'worker' && pyInputWait) {
    // v4.10：内置 Python（Worker 模式）的 input() 终端式输入——与 C++ 体验一致
    outEcho(line);
    pyWorkerSendInput(line);
  } else if (runningKind === 'python') {
    outMeta(pyMode === 'worker'
      ? '程序尚未请求输入：调用 input() 时才需要在终端输入。'
      : 'Python 的 input() 通过弹窗输入，无需在此发送。');
  } else {
    outMeta('当前没有需要输入的程序。可运行 C++（Termux 引擎）交互，或在菜单连接 Termux 终端会话。');
  }
}
$('btn-send').addEventListener('click', sendTermInput);
$('term-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendTermInput(); }
});

/* ---------- 对话框 ---------- */
let modalMode = 'new';
function showModal({ title, withInput = true, value = '', okText = t('ok'), placeholder = '', desc = '', showCancel = true }) {
  $('modal-title').textContent = title;
  $('modal-input').classList.toggle('hidden', !withInput);
  $('modal-input').value = value;
  $('modal-input').placeholder = placeholder;
  $('modal-error').textContent = desc;
  $('modal-ok').textContent = okText;
  $('modal-cancel').classList.toggle('hidden', !showCancel);
  // 纯信息对话框（无取消按钮）唯一按钮即「关闭」，确定后直接收起，不进任何业务分支
  if (!showCancel) modalMode = 'info';
  $('modal-mask').classList.remove('hidden');
  if (withInput) setTimeout(() => $('modal-input').focus(), 50);
}
function hideModal() { $('modal-mask').classList.add('hidden'); }

/* ---------- v4.4 插件接口（宿主只提供加载与通道，插件由用户自行开发；放 /sdcard/QingCode/plugins/*.js） ---------- */
const PluginHost = {
  loaded: [],      // 已加载插件元数据
  langs: {},       // '.ext' → { def, plugin }  插件注册的语言
  menus: [],       // { label, cb }  插件注册的菜单项
  skipped: [],     // v4.6 已禁用而未加载的插件文件名
  pages: {},       // v4.6 插件注册的「插件管理页」自定义选项卡 tabId → { title, render }
  blocked: {},     // v5.8.0 未授权 / 授权失效的插件：name → 'pending' | 'changed' | 'nohash'
};
/* v4.6 插件启停：localStorage 'pc_plugins_disabled'（禁用文件名数组）+ 'pc_plugins_enabled'（总开关） */
function disabledPlugins() { try { return JSON.parse(localStorage.getItem('pc_plugins_disabled') || '[]'); } catch (e) { return []; } }
function setPluginDisabled(name, dis) {
  const arr = disabledPlugins().filter(x => x !== name);
  if (dis) arr.push(name);
  try { localStorage.setItem('pc_plugins_disabled', JSON.stringify(arr)); } catch (e) {}
}
function pluginsEnabled() { return localStorage.getItem('pc_plugins_enabled') !== '0'; }
function pluginLangOf(name) {
  const i = name.lastIndexOf('.');
  if (i < 0) return null;
  return PluginHost.langs[name.slice(i).toLowerCase()] || null;
}
/* ============================================================
 * v5.0：编辑器插件宿主 —— PCPluginAPI v3 的 editor 接口
 * 内核只保留最小能力，所有可选编辑功能由内置插件 editor-plus 装配。
 * ============================================================ */
const PCCommands = new Map();
const PCToolbarItems = [];
const PCExtEntries = [];   // [{ ext, owner }]：插件扩展集（带归属，便于即时卸载）
let PCPluginCurrent = null;   // 当前正在初始化的插件 id（onInit 期间设置）
const PCCompletion = new Map();
const PCSnips = new Map();
const PCFmt = new Map();
const PCEvents = { docChange: [], selection: [], fileOpen: [] };

function pcEmit(evt, payload) {
  const arr = PCEvents[evt];
  if (arr && arr.length) {
    /* v5.4.3：监听项改为 { fn, owner }，便于禁用插件时按归属清理 */
    for (const e of arr.slice()) {
      if (!e || typeof e.fn !== 'function') continue;
      try { e.fn(payload); } catch (err) { console.warn('[plugin] evt ' + evt, err); }
    }
  }
  /* v5.4.3 修复（审查 #24）：把事件转发给沙箱插件（只发给订阅过该事件的 Worker），
     此前 _rpc 的 'on' 只回 true，沙箱里 editor.on() 永远收不到回调。
     try 包住：SandboxHost 在文件后部才声明，极端早期调用时避免 TDZ 报错。 */
  try {
    for (const s of SandboxHost.list) {
      if (s.events && s.events[evt]) {
        try { s.worker.postMessage({ type: 'event', evt: evt, payload: payload }); } catch (e) {}
      }
    }
  } catch (e) {}
}
function pcApplyExts() {
  if (!cm) return;
  try { if (window.PCCM && PCCM.setPluginExtensions) PCCM.setPluginExtensions(cm, PCExtEntries.map(function (e) { return e.ext; })); }
  catch (e) { console.warn('[plugin] applyExts', e); }
}

function renderToolbar() {
  const bar = $('editor-toolbar');
  if (!bar) return;
  bar.innerHTML = '';
  const items = PCToolbarItems.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'etb-btn';
    b.type = 'button';
    b.textContent = it.icon || it.label || '•';
    b.title = it.label || '';
    /* v5.4.3 修复（审查 #10）：支持声明式激活态。以前插件靠 addToolbarButton() 返回的
       DOM 引用来改样式，但 renderToolbar() 每次新增按钮都会全量重建，旧引用早已脱离文档。
       现在每次重建时重新求值 it.active()，插件只需在状态变化后调 refreshToolbar()。 */
    try { if (typeof it.active === 'function' ? it.active() : it.active) b.classList.add('on'); } catch (e) {}
    /* 关键：mousedown 阶段阻止默认行为，按钮不夺取编辑器焦点，软键盘不会被收起 */
    /* v5.2.6：长按 550ms 显示按钮名称。
       坑：手机上长按【不会】触发 mousedown（触摸是 touchstart → 长按 → contextmenu，
       没有 touchend 就没有合成 mousedown），所以必须以 touchstart 为主通道。 */
    let lpTimer = null, lpFired = false;
    const clearLp = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
    const startLp = () => {
      lpFired = false;
      clearLp();
      lpTimer = setTimeout(() => {
        lpFired = true;
        const msg = it.label || '';
        try { if (window.Android && Android.showToast) { Android.showToast(msg); return; } } catch (err) {}
        try { outMeta('▸ ' + msg); } catch (e2) {}
      }, 550);
    };
    b.addEventListener('touchstart', () => startLp(), { passive: true });
    b.addEventListener('touchend', clearLp);
    b.addEventListener('touchcancel', clearLp);
    b.addEventListener('touchmove', clearLp, { passive: true });
    b.addEventListener('contextmenu', (e) => e.preventDefault());   /* 屏蔽长按系统菜单 */
    b.addEventListener('mousedown', (e) => { e.preventDefault(); startLp(); });
    b.addEventListener('mouseup', clearLp);
    b.addEventListener('mouseleave', clearLp);
    b.addEventListener('click', (e) => {
      e.preventDefault();
      clearLp();
      if (lpFired) { lpFired = false; return; }   /* 长按只提示名称，不执行命令 */
      try { it.run(); } catch (err) { outAppend('[工具栏] ' + (err.message || err) + '\n', 'out-err'); }
      if (cm) cm.focus();
    });
    it.__el = b;
    bar.appendChild(b);
  }
  bar.classList.toggle('hidden', !items.length);
}

function ensurePalette() {
  let el = $('cmd-palette');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'cmd-palette';
  el.className = 'hidden';
  el.innerHTML = '<div class="cp-box"><input id="cp-input" type="text" autocomplete="off" spellcheck="false">' +
    '<div class="cp-actions"><button id="cp-gear" type="button">⚙</button><button id="cp-x" type="button">×</button></div>' +
    '<div id="cp-list"></div></div>';
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target === el) closePalette(); });
  const inp = el.querySelector('#cp-input');
  inp.addEventListener('input', () => renderPalette(el.dataset.filter || '', inp.value));
  const xBtn = el.querySelector('#cp-x'), gearBtn = el.querySelector('#cp-gear');
  if (xBtn) { xBtn.addEventListener('mousedown', (e) => e.preventDefault()); xBtn.addEventListener('click', () => closePalette()); }
  if (gearBtn) {
    gearBtn.addEventListener('mousedown', (e) => e.preventDefault());
    gearBtn.addEventListener('click', () => { closePalette(); openControlPanel(); });
  }
  inp.addEventListener('keydown', (e) => {
    const rows = el.querySelectorAll('#cp-list .cp-item:not(.cp-item-ctrl)');
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.max(0, Math.min(rows.length - 1, palSel + 1)); palMarkSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); palMarkSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[palSel]; if (r) r.click(); }
  });
  return el;
}
/* v5.2.2：opts.noInput=true 时以「操作菜单」形态打开（无输入框、顶部显示标题） */
function openCommandPalette(filter, opts) {
  opts = opts || {};
  const el = ensurePalette();
  el.dataset.mode = '';
  el.dataset.filter = filter || '';
  el.classList.remove('hidden');
  const box = el.querySelector('.cp-box');
  const inp = el.querySelector('#cp-input');
  let title = el.querySelector('#cp-titlemode');
  if (opts.noInput) {
    if (!title) { title = document.createElement('div'); title.id = 'cp-titlemode'; box.insertBefore(title, box.firstChild); }
    title.textContent = opts.title || t('cp_title_ops');
    title.style.display = '';
    inp.style.display = 'none';
  } else {
    if (title) title.style.display = 'none';
    inp.style.display = '';
    inp.value = '';
    inp.placeholder = t('cp_ph');
  }
  palSel = 0;
  renderPalette(filter || '', '');
  if (!opts.noInput) setTimeout(() => { try { inp.focus(); } catch (e) {} }, 30);
}
function closePalette() { const el = $('cmd-palette'); if (el) el.classList.add('hidden'); }
/* ============================================================
 * v5.2：控制面板（VS Code Control Panel 风格）
 * 当前为界面骨架：分组 + 条目；条目若已绑定命令则真实执行，否则标注「即将推出」。
 * 内部扩展点：CP_GROUPS 可直接追加分组，无需改动渲染逻辑。
 * ============================================================ */
function ensureControlPanel() {
  let el = $('control-panel');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'control-panel';
  el.className = 'hidden';
  el.innerHTML = '<div class="cp2-head"><b id="cp2-title"></b><button id="cp2-close" class="cp2-x" type="button">×</button></div><div id="cp2-body"></div>';
  document.body.appendChild(el);
  el.querySelector('#cp2-close').addEventListener('click', closeControlPanel);
  return el;
}
function openControlPanel() {
  const el = ensureControlPanel();
  el.classList.remove('hidden');
  renderControlPanel();
}
function closeControlPanel() {
  const el = $('control-panel');
  if (el) el.classList.add('hidden');
  if (cm) cm.focus();
}
/* 扩展点：控制面板分组定义（内部用，不对外公开） */
function cpGroups() {
  const soon = t('cp2_soon');
  return [
    { title: t('cp2_g_editor'), items: [
      { icon: '🔤', label: t('cp2_i_font'), type: 'stepper', unit: 'px',
        get: () => fontSize, set: (v) => setFontSize(v), min: 10, max: 28, step: 1 },
      { icon: '↔', label: t('cp2_i_indent'), type: 'stepper', unit: ' ',
        get: () => tabSize, set: (v) => setTabSize(v), min: 2, max: 8, step: 2 },
      { icon: '⊕', label: t('cp2_i_multicursor'), run: () => EditorAPI.runCommand('cursor.mode') },
      { icon: '✨', label: t('cp2_i_format'), run: () => EditorAPI.runCommand('format.light') },
    ]},
    { title: t('cp2_g_engine'), items: [
      { icon: '⚙', label: t('cp2_i_cpp'), type: 'select',
        options: engineOptions('sel-cpp-engine'), get: () => cppEngine, set: (v) => setEngineValue('sel-cpp-engine', v) },
      { icon: '🐍', label: t('cp2_i_py'), type: 'select',
        options: engineOptions('sel-py-engine'), get: () => pyEngine, set: (v) => setEngineValue('sel-py-engine', v) },
      { icon: '🧠', label: t('cp2_i_intel'), run: () => { closeControlPanel(); EditorAPI.runCommand('ci.analyze'); } },
    ]},
    { title: t('cp2_g_file'), items: [
      { icon: '📂', label: t('cp2_i_openfolder'), run: () => { closeControlPanel(); openProjectFolder(); } },
      { icon: '⬇', label: t('cp2_i_export'), run: () => { closeControlPanel(); exportFile(); } },
    ]},
    { title: t('cp2_g_plugin'), items: [
      { icon: '🧩', label: t('cp2_i_plugins'), run: () => { closeControlPanel(); openPluginPage(); } },
    ]},
    { title: t('cp2_g_about'), items: [
      { icon: 'ℹ', label: t('cp2_i_about'), run: () => { closeControlPanel(); const b = $('mi-about'); if (b) b.click(); } },
    ]},
  ];
}
/** v5.9.0：控制面板里的行内控件（数值步进 / 下拉），替代原来的「即将推出」 */
function cpControlRow(it) {
  const row = document.createElement('div');
  row.className = 'cp2-row';
  const ico = document.createElement('span'); ico.className = 'cp2-ico'; ico.textContent = it.icon || '•';
  const lab = document.createElement('span'); lab.className = 'cp2-label'; lab.textContent = it.label || '';
  row.appendChild(ico); row.appendChild(lab);
  if (it.type === 'stepper') {
    const wrap = document.createElement('span'); wrap.className = 'cp2-step';
    const minus = document.createElement('button'); minus.type = 'button'; minus.className = 'cp2-stepbtn'; minus.textContent = '−';
    const val = document.createElement('span'); val.className = 'cp2-stepval';
    const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'cp2-stepbtn'; plus.textContent = '+';
    const sync = function () { val.textContent = it.get() + (it.unit || ''); };
    const apply = function (v) {
      it.set(Math.max(it.min, Math.min(it.max, v)));
      sync();
    };
    minus.addEventListener('click', function (e) { e.stopPropagation(); apply(it.get() - it.step); });
    plus.addEventListener('click', function (e) { e.stopPropagation(); apply(it.get() + it.step); });
    sync();
    wrap.appendChild(minus); wrap.appendChild(val); wrap.appendChild(plus);
    row.appendChild(wrap);
    return row;
  }
  const sel = document.createElement('select');
  sel.className = 'cp2-sel';
  (it.options || []).forEach(function (o) {
    const op = document.createElement('option');
    op.value = o.value; op.textContent = o.label;
    sel.appendChild(op);
  });
  sel.value = it.get();
  sel.addEventListener('change', function (e) { e.stopPropagation(); it.set(sel.value); });
  sel.addEventListener('click', function (e) { e.stopPropagation(); });
  row.appendChild(sel);
  return row;
}
function renderControlPanel() {
  const el = ensureControlPanel();
  const title = el.querySelector('#cp2-title');
  if (title) title.textContent = t('cp_ctrl');
  const body = el.querySelector('#cp2-body');
  if (!body) return;
  body.innerHTML = '';
  cpGroups().forEach((g) => {
    const box = document.createElement('div');
    box.className = 'cp2-group';
    const h = document.createElement('div');
    h.className = 'cp2-gtitle';
    h.textContent = g.title;
    box.appendChild(h);
    (g.items || []).forEach((it) => {
      if (it.type === 'stepper' || it.type === 'select') { box.appendChild(cpControlRow(it)); return; }
      const b = document.createElement('button');
      b.className = 'cp2-row' + (it.run ? '' : ' disabled');
      b.type = 'button';
      const ico = document.createElement('span'); ico.className = 'cp2-ico'; ico.textContent = it.icon || '•';
      const lab = document.createElement('span'); lab.className = 'cp2-label'; lab.textContent = it.label || '';
      const hint = document.createElement('span'); hint.className = 'cp2-hint'; hint.textContent = it.run ? '' : (it.hint || t('cp2_soon'));
      b.appendChild(ico); b.appendChild(lab); b.appendChild(hint);
      b.addEventListener('click', () => {
        if (it.run) { try { it.run(); } catch (e) { outAppend(String(e && e.message || e) + '\n', 'out-err'); } }
        else outMeta(t('cp2_soon') + '：' + (it.label || ''));
      });
      box.appendChild(b);
    });
    body.appendChild(box);
  });
}

/* v5.2.2：最近使用的命令（localStorage 持久化，最多 8 条） */
const CP_RECENT_KEY = 'pc_recent_cmds';
let cpRecent = [];
try { cpRecent = JSON.parse(localStorage.getItem(CP_RECENT_KEY) || '[]'); } catch (e) { cpRecent = []; }
if (!Array.isArray(cpRecent)) cpRecent = [];
function cpMarkRecent(id) {
  cpRecent = [id].concat(cpRecent.filter(function (x) { return x !== id; })).slice(0, 8);
  try { localStorage.setItem(CP_RECENT_KEY, JSON.stringify(cpRecent)); } catch (e) {}
}
let palSel = 0;
function palMarkSel() {
  const rows = document.querySelectorAll('#cp-list .cp-item:not(.cp-item-ctrl)');
  rows.forEach(function (r, i) { r.classList.toggle('act', i === palSel); });
  const a = rows[palSel]; if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' });
}
/* ============================================================
 * v5.9.0：顶栏搜索框 → 统一快速搜索（文件 / 符号 / 全文 / 最近命令）
 * 文件结果内联呈现；符号与全文交给导航插件的面板并预填当前查询词。
 * ============================================================ */
function fuzzyScore(name, ql) {
  const n = String(name || '').toLowerCase();
  if (!ql) return 0;
  if (n === ql) return 0;
  const i = n.indexOf(ql);
  if (i >= 0) return 1 + i;               // 连续命中：越靠前越好
  let pos = 0, gaps = 0;                   // 否则退化为子序列匹配（fzf 风格）
  for (let k = 0; k < ql.length; k++) {
    const j = n.indexOf(ql[k], pos);
    if (j < 0) return -1;
    gaps += j - pos;
    pos = j + 1;
  }
  return 1000 + gaps;
}
function openQuickSearch() {
  const el = ensurePalette();
  el.dataset.mode = 'search';
  el.dataset.filter = '';
  el.classList.remove('hidden');
  const title = el.querySelector('#cp-titlemode');
  if (title) title.style.display = 'none';
  const inp = el.querySelector('#cp-input');
  inp.style.display = '';
  inp.value = '';
  inp.placeholder = t('qs_ph');
  palSel = 0;
  renderPalette('', '');
  setTimeout(function () { try { inp.focus(); } catch (e) {} }, 30);
}
function renderQuickSearch(el, q) {
  const list = el.querySelector('#cp-list');
  if (!list) return;
  list.innerHTML = '';
  const query = String(q || '').trim();
  const ql = query.toLowerCase();
  const add = function (icon, label, sub, run) {
    const b = document.createElement('button');
    b.className = 'cp-item'; b.type = 'button';
    const ico = document.createElement('span'); ico.className = 'cp-ico'; ico.textContent = icon;
    const main = document.createElement('span'); main.className = 'cp-main'; main.textContent = label;
    const s2 = document.createElement('span'); s2.className = 'cp-sub'; s2.textContent = sub || '';
    b.appendChild(ico); b.appendChild(main); b.appendChild(s2);
    b.addEventListener('click', function () {
      closePalette();
      try { run(); } catch (e) { outAppend('[搜索] ' + (e && e.message || e) + '\n', 'out-err'); }
    });
    list.appendChild(b);
  };
  const nav = (window.PCPluginAPI && window.PCPluginAPI.nav) || null;
  if (!query) {
    const rec = cpRecent.map(function (id) { return PCCommands.get(id); }).filter(Boolean).slice(0, 5);
    rec.forEach(function (c) { add('⟳', c.labelKey ? t(c.labelKey) : (c.label || c.id), t('cp_recent'), function () { c.run(); }); });
    const hint = document.createElement('div'); hint.className = 'cp-empty';
    hint.textContent = t('qs_empty_hint');
    list.appendChild(hint);
    palSel = 0; palMarkSel();
    return;
  }
  const hits = state.files
    .map(function (f) { return { f: f, s: fuzzyScore(f.name, ql) }; })
    .filter(function (x) { return x.s >= 0; })
    .sort(function (a, b) { return a.s - b.s; })
    .slice(0, 8);
  hits.forEach(function (h) { add('📄', h.f.name, t('qs_open'), function () { openFile(h.f.name); }); });
  if (nav) {
    add('🔍', t('qs_search_all').replace('{q}', query), t('qs_scope_text'), function () { nav.search(query); });
    add('{}', t('qs_symbols').replace('{q}', query), t('qs_scope_symbol'), function () { nav.symbols(query); });
    add('🌐', t('qs_gsymbols').replace('{q}', query), t('qs_scope_gsymbol'), function () { nav.gsymbols(query); });
  }
  if (!list.children.length) {
    const em = document.createElement('div'); em.className = 'cp-empty';
    em.textContent = t('cp_empty');
    list.appendChild(em);
  }
  palSel = 0; palMarkSel();
}

function renderPalette(prefix, q) {
  const el = $('cmd-palette');
  if (!el) return;
  if (el.dataset.mode === 'search') { renderQuickSearch(el, q); return; }
  const list = el.querySelector('#cp-list');
  const group = String(prefix || '').replace(/\.$/, '');
  const ql = String(q || '').toLowerCase();
  const items = [...PCCommands.values()]
    .filter(c => !group || (c.group && String(c.group) === group) || String(c.id).startsWith(group + '.'))
    .filter(c => !ql || String(c.label || '').toLowerCase().includes(ql) || String(c.id).toLowerCase().includes(ql));
  /* v5.9.0：最近使用过的命令排到最前（此前只打「最近」标签，位置不变） */
  if (cpRecent.length) {
    const rank = (id) => { const i = cpRecent.indexOf(id); return i < 0 ? 999 : i; };
    items.sort((a, b) => rank(a.id) - rank(b.id));
  }
  list.innerHTML = '';
  /* v5.2：置顶「控制面板」入口——与命令并列但置顶、带特殊标记，且不参与命令过滤 */
  const ctrl = document.createElement('button');
  ctrl.className = 'cp-item cp-item-ctrl';
  ctrl.type = 'button';
  ctrl.innerHTML = '<span class="cp-ctrl-ico">⚙</span><span class="cp-ctrl-name"></span><span class="cp-ctrl-tag"></span>';
  ctrl.querySelector('.cp-ctrl-name').textContent = t('cp_ctrl');
  ctrl.querySelector('.cp-ctrl-tag').textContent = t('cp_ctrl_tag');
  ctrl.addEventListener('click', () => { closePalette(); openControlPanel(); });
  list.appendChild(ctrl);
  if (!items.length) { const em = document.createElement('div'); em.className = 'cp-empty'; em.textContent = t('cp_empty'); list.appendChild(em); return; }
  items.forEach(function (c) {
    const b = document.createElement('button');
    b.className = 'cp-item';
    b.type = 'button';
    const main = document.createElement('span'); main.className = 'cp-main';
    main.textContent = c.labelKey ? t(c.labelKey) : (c.label || c.id);
    const sub = document.createElement('span'); sub.className = 'cp-sub';
    /* v5.2.3：副标题显示「另一语言」的同一命令文案（中↔英），没有时回退命令 id */
    const curL = (typeof LANG !== 'undefined' && LANG) ? LANG : 'zh';
    const otherL = curL === 'zh' ? 'en' : 'zh';
    const otherTxt = (c.labelKey && typeof I18N !== 'undefined' && I18N[otherL] && I18N[otherL][c.labelKey]) || '';
    sub.textContent = otherTxt || c.id;
    b.appendChild(main); b.appendChild(sub);
    if (cpRecent.indexOf(c.id) >= 0) {
      const tag = document.createElement('span'); tag.className = 'cp-tag'; tag.textContent = t('cp_recent');
      b.appendChild(tag);
    }
    b.addEventListener('click', () => {
      closePalette();
      cpMarkRecent(c.id);
      try { c.run(); } catch (e) { outAppend('[命令] ' + (e.message || e) + '\n', 'out-err'); }
      if (cm) cm.focus();
    });
    list.appendChild(b);
  });
  palSel = 0;
  palMarkSel();
}

const EditorAPI = {
  get view() { return cm; },
  get modules() { return (window.PCCM && PCCM.modules) || {}; },
  currentLanguage() { return EditorAPI._ownLang || hlLangOf(state.active); },
  /* 插件可强制指定语言（影响补全/格式化）；切文件时由 openFile 清空 */
  _ownLang: null,
  addExtension(ext) { if (ext) { PCExtEntries.push({ ext: ext, owner: PCPluginCurrent }); pcApplyExts(); } return ext; },
  removeExtension(ext) { for (let i = PCExtEntries.length - 1; i >= 0; i--) if (PCExtEntries[i].ext === ext) { PCExtEntries.splice(i, 1); pcApplyExts(); } },
  setExtensions(list) { PCExtEntries.length = 0; (list || []).forEach(e => PCExtEntries.push({ ext: e, owner: PCPluginCurrent })); pcApplyExts(); },
  registerCommand(id, meta) { PCCommands.set(id, Object.assign({ id: id, owner: PCPluginCurrent }, meta || {})); },
  unregisterCommand(id) { PCCommands.delete(id); },
  listCommands() { return [...PCCommands.values()]; },
  runCommand(id) {
    const c = PCCommands.get(id);
    if (!c) return false;
    try { return c.run(); } catch (e) { outAppend('[命令] ' + (e.message || e) + '\n', 'out-err'); return false; }
  },
  addToolbarButton(btn) { if (btn) { btn.owner = PCPluginCurrent; PCToolbarItems.push(btn); renderToolbar(); return btn.__el || null; } return null; },
  removeToolbarButton(id) { const i = PCToolbarItems.findIndex(b => b.id === id); if (i >= 0) { PCToolbarItems.splice(i, 1); renderToolbar(); } },
  /** v5.4.3：重绘工具栏（插件改了按钮状态/文案后调用；返回的 DOM 引用不保证长期有效） */
  refreshToolbar() { renderToolbar(); },
  registerLanguage(names, factory) { try { PCCM.registerLanguage(names, factory); } catch (e) {} },
  setLanguage(name) { EditorAPI._ownLang = name || null; if (cm) { PCCM.setLang(cm, name); curHlLang = name || null; } },
  /** v5.4.3：外部（代码智能等）标注错误时同步内核的 currentErrs，
   *  否则「编辑该行即消红」与「清除旧标记」都无法工作。传空数组即清除。 */
  setErrors(list) {
    if (!cm) return false;
    const doc = cm.state.doc;
    currentErrs = [];
    (list || []).forEach(function (e) {
      if (!e || !(e.line >= 1) || e.line > doc.lines) return;
      const l = doc.line(e.line);
      currentErrs.push({ line: e.line, col: e.col || 1, message: e.message || '', anchor: l.from, anchorEnd: l.to });
    });
    try {
      if (currentErrs.length) PCCM.markErrors(cm, currentErrs);
      else { PCCM.clearErrors(cm); hideErrBubble(); }
    } catch (e) {}
    try { setPanelProblems(currentErrs); } catch (e) {}   // v5.9.0：同步到「问题」面板
    return true;
  },
  clearErrors() { clearCodeErrors(); },
  registerCompletion(lang, source) { PCCompletion.set(lang, source); },
  /* v5.0：把内置补全数据表交给插件（数据在宿主，UI 在插件） */
  get completionData() { return { keywords: PC_KEYWORDS, members: PC_LIB_MEMBERS, includes: PC_INCLUDES }; },

  /* v5.1：插件可在 Python 运行时里求值（代码智能用） */
  pyEval(code) { return pyEval(code); },
  /* v5.1：文件与内容服务（导航 / 全局搜索 / 书签用）；v5.6.0 起 content 可能为 null（惰性未加载） */
  files() { return state.files.map(function (f) { return { name: f.name, content: f.content, lazy: f.content === null, size: f._size == null ? null : f._size }; }); },
  /** v5.6.0：把惰性文件全部读入内存（全局搜索 / 全局符号需要），返回本次加载数量 */
  ensureAll() { return ensureAllContent(); },
  activeFileName() { return state.active; },
  openFile(name) { try { if (name && name !== state.active) { openFile(name); return true; } } catch (e) {} return false; },
  setFileContent(name, content) {
    const f = state.files.find(function (x) { return x.name === name; });
    if (!f) return false;
    f.content = String(content == null ? '' : content);
    f._lazy = false;   // v5.6.0：插件写入后视为已加载
    viewStates.delete(name);   // v5.7.0：内容由插件改写，旧视图状态作废
    if (state.active === name && cm) { try { PCCM.setDoc(cm, f.content, hlLangOf(name)); curHlLang = hlLangOf(name); } catch (e) {} }
    try { scheduleSave(); } catch (e) {}
    return true;
  },
  saveAll() {
    try { saveStore(); } catch (e) {}
    try { if (typeof autoSaveProject === 'function') autoSaveProject(); } catch (e) {}
    return true;
  },
  gotoLine(line, col) {
    if (!cm) return false;
    const d = cm.state.doc;
    if (!(line >= 1 && line <= d.lines)) return false;
    const ln = d.line(line);
    const pos = Math.min(ln.to, ln.from + Math.max(0, (col || 1) - 1));
    cm.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    try { cm.focus(); } catch (e) {}
    return true;
  },
  getCompletion(lang) { return PCCompletion.get(lang) || null; },
  registerSnippets(lang, list) { PCSnips.set(lang, (PCSnips.get(lang) || []).concat(list || [])); },
  setSnippets(lang, list) { PCSnips.set(lang, (list || []).slice()); },
  getSnippets(lang) { return PCSnips.get(lang) || []; },
  registerFormatter(lang, fn) { PCFmt.set(lang, fn); },
  getFormatter(lang) { return PCFmt.get(lang) || null; },
  on(evt, fn) { if (PCEvents[evt] && typeof fn === 'function') PCEvents[evt].push({ fn: fn, owner: PCPluginCurrent }); },
  focus() { if (cm) cm.focus(); },
  insertText(text) { if (cm) cm.dispatch(cm.state.replaceSelection(String(text == null ? '' : text))); },
  openCommandPalette(filter, opts) { openCommandPalette(filter, opts); }
};

/* 插件即时卸载：清掉该插件注册的命令 / 工具栏 / 扩展 / 管理页选项卡，无需重启 */
function unloadPlugin(id) {
  const p = PluginHost.loaded.find(x => x.id === id);
  if (!p) return false;
  for (const k of [...PCCommands.keys()]) { const c = PCCommands.get(k); if (c && c.owner === id) PCCommands.delete(k); }
  for (let i = PCToolbarItems.length - 1; i >= 0; i--) if (PCToolbarItems[i].owner === id) PCToolbarItems.splice(i, 1);
  for (let i = PCExtEntries.length - 1; i >= 0; i--) if (PCExtEntries[i].owner === id) PCExtEntries.splice(i, 1);
  /* v5.4.3 修复（审查 #25）：事件监听按归属清理，否则禁用插件后其 docChange/fileOpen 回调仍在跑 */
  for (const k of Object.keys(PCEvents)) PCEvents[k] = PCEvents[k].filter(function (e) { return !e || e.owner !== id; });
  PluginHost.menus = PluginHost.menus.filter(function (m) { return !m || m.owner !== id; });
  for (const k of Object.keys(PluginHost.pages)) if (PluginHost.pages[k].__owner === id) delete PluginHost.pages[k];
  PluginHost.loaded = PluginHost.loaded.filter(x => x.id !== id);
  try { if (p.onUnload) p.onUnload(window.PCPluginAPI); } catch (e) { console.warn('[plugin] onUnload', e); }
  if (p.__file) { PluginHost.disabledBuiltin = (PluginHost.disabledBuiltin || []).concat([p.__file]); try { localStorage.setItem('pc_builtin_disabled', JSON.stringify(PluginHost.disabledBuiltin)); } catch (e) {} }
  renderToolbar(); pcApplyExts(); renderPluginMenus();
  outMeta((LANG === 'en' ? '[plugin] disabled: ' : '[插件] 已禁用：') + (p.name || p.id));
  return true;
}
/* 重新启用内置插件（即时生效，不用重启） */
async function enableBuiltinPlugin(file) {
  try {
    const mark = PluginHost.loaded.length;
    await loadScript('plugins/' + file);
    for (let i = mark; i < PluginHost.loaded.length; i++) PluginHost.loaded[i].__file = file;
    const p = PluginHost.loaded.find(x => x.__file === file);
    if (p && !p.__builtinInit) {
      p.__builtinInit = true;
      PCPluginCurrent = p.id || null;
      try { if (p.onInit) p.onInit(window.PCPluginAPI); } catch (e) { console.warn('[plugin] onInit', e); }
      PCPluginCurrent = null;
    }
    if (Array.isArray(PluginHost.disabledBuiltin)) PluginHost.disabledBuiltin = PluginHost.disabledBuiltin.filter(x => x !== file);
    try { localStorage.setItem('pc_builtin_disabled', JSON.stringify(PluginHost.disabledBuiltin || [])); } catch (e) {}
    renderToolbar(); pcApplyExts(); renderPluginMenus();
    outMeta((LANG === 'en' ? '[plugin] enabled: ' : '[插件] 已启用：') + (p ? (p.name || p.id) : file));
    return true;
  } catch (e) { console.warn('[plugin] enable fail', e); return false; }
}

/* 内置插件：先于 /sdcard 用户插件加载；浏览器预览同样可加载 */
async function loadBuiltinPlugins() {
  /* v5.4：内置插件彼此独立，并行加载缩短启动时间 */
  try { PluginHost.disabledBuiltin = JSON.parse(localStorage.getItem('pc_builtin_disabled') || '[]'); } catch (e) { PluginHost.disabledBuiltin = []; }
  if (!Array.isArray(PluginHost.disabledBuiltin)) PluginHost.disabledBuiltin = [];
  const names = ['editor-plus', 'code-intel', 'navigator'].filter(function (n) { return PluginHost.disabledBuiltin.indexOf(n + '.js') < 0; });
  /* v5.4：并行加载（彼此独立），加载后按 id 回填 __file（并行时下标区间不可靠） */
  await Promise.all(names.map(function (n) {
    return loadScript('plugins/' + n + '.js').catch(function (e) { console.warn('[builtin] load fail ' + n, e); });
  }));
  names.forEach(function (n) {
    var id = n.replace(/\.js$/, '');
    var p = PluginHost.loaded.find(function (x) { return x.id === id; });
    if (p) p.__file = n;
  });
  const before = 0;
  /* 关键：loadPlugins() 在无原生桥（浏览器预览 / 纯内置）时会提前 return，
     故内置插件必须在此处自行触发 onInit，并用 __builtinInit 防重复。 */
  for (let i = before; i < PluginHost.loaded.length; i++) {
    const p = PluginHost.loaded[i];
    if (p.__builtinInit) continue;
    if (p.__file) p.__builtin = true;
    p.__builtinInit = true;
    PCPluginCurrent = p.id || null;
    try { if (p.onInit) p.onInit(window.PCPluginAPI); }
    catch (e) { console.warn('[builtin] onInit ' + (p.id || i), e); }
    PCPluginCurrent = null;
  }
  renderPluginMenus();
}

window.PCPluginAPI = {
  apiVersion: 3,   // v3：新增 editor 接口（扩展 / 命令 / 工具栏 / 语言 / 补全 / 片段 / 格式化 / 事件）
  editor: EditorAPI,
  /** v5.9.0：LanguageService —— 插件注册提供者，宿主负责 documentUri/version、取消与过期丢弃 */
  lsp: {
    register: (lang, provider) => LS.register(lang, provider),
    unregister: (lang) => LS.unregister(lang),
    request: (kind, lang, params) => LS.request(kind, lang, params),
    cancel: (requestId) => LS.cancel(requestId),
    uriOf: (name) => LS.uriOf(name),
    version: (uri) => LS.version(uri || LS.uriOf()),
    bump: (uri) => LS.bump(uri || LS.uriOf()),
    kinds: ['diagnostics', 'completion', 'definition', 'references', 'documentSymbol']
  },
  /** v5.0：插件可直接使用界面翻译（zh/en），避免硬编码中文 */
  t: (k, ...args) => t(k, ...args),
  hasI18n: (k) => k in I18N.zh || k in I18N.en,
  /** 注册插件。meta = {
   *    id: '唯一ID', name: '显示名', version: '1.0',           // 必填：id；v2 建议提供 name/version
   *    author: '作者', description: '一句话描述', homepage: '主页', // v2 标准字段：显示在插件管理页
   *    languages: [{ id, name, exts: ['.rs'], defaultCode, comment }],  // 注册语言：扩展名入新建白名单 + 运行分流
   *    menu: [{ label, onClick }],                                      // 注册「更多菜单」项
   *    onInit(api),                                                     // 加载完成回调（一次性）
   *    onUnload(api),                                                   // v2 预留：禁用/卸载回调（当前禁用=重启生效）
   *    onRun(file, code, langDef, api)                                  // 运行钩子：返回 true 表示已接管
   *  } */
  register(meta) {
    if (!meta || !meta.id) return false;
    if (PluginHost.loaded.some(p => p.id === meta.id)) return false;
    (meta.languages || []).forEach(L => (L.exts || []).forEach(e => {
      PluginHost.langs[String(e).toLowerCase()] = { def: L, plugin: meta };
    }));
    (meta.menu || []).forEach(m => PluginHost.menus.push(
      typeof m === 'string' ? { label: m, cb: null, owner: meta.id } : { label: String(m.label || ''), cb: m.onClick, owner: meta.id }));
    PluginHost.loaded.push(meta);
    return true;
  },
  /** v4.6：向「插件管理页」注册自定义选项卡。page(tabId, { title, render(container, api) })
   *  render 在切到该选项卡时惰性调用，container 为内容容器（可自由填充 DOM）
   *  内置选项卡 id（loaded/langs/settings）不可覆盖 */
  page(tabId, def) {
    if (!tabId || !def || typeof def.render !== 'function') return false;
    if (['loaded', 'langs', 'settings'].indexOf(String(tabId)) >= 0) return false;
    PluginHost.pages[String(tabId)] = { title: String(def.title || tabId), render: def.render, __owner: PCPluginCurrent };
    return true;
  },
  out: (txt, cls) => outAppend(txt.endsWith('\n') ? txt : txt + '\n', cls || 'out-echo'),  // 终端输出
  meta: (txt) => outMeta(String(txt)),                                                     // 状态栏消息
  toast: (msg) => { if (window.Android && Android.showToast) Android.showToast(String(msg)); },
  /** 底层原语：向 Termux 发送任意脚本（输出重定向/轮询由插件自理，或用 runCapture） */
  execTermux: (script, bg) => (window.Android && Android.execTermux) ? !!Android.execTermux(String(script), bg !== false) : false,
  /** 高层封装：执行脚本并捕获输出（stdout/stderr 重定向到交换目录临时文件 + 轮询 + 自动清理），120s 超时
   *  返回 Promise<{ code:number, output:string }>；脚本内可用绝对路径 /sdcard/QingCode/ 读写工作文件 */
  runCapture(script) {
    return new Promise(resolve => {
      if (!(window.Android && Android.execTermux && Android.writeSwapFile && Android.readSwapFile)) {
        resolve({ code: -1, output: '插件运行通道不可用（需在安卓应用内并已授权存储）\n' }); return;
      }
      const tag = 'plug_' + Date.now();
      Android.writeSwapFile(tag + '.exit', 'running');
      const ok = Android.execTermux(
        String(script) + ' > /sdcard/QingCode/' + tag + '.out 2>&1; echo $? > /sdcard/QingCode/' + tag + '.exit', true);
      if (!ok) {
        // v4.11.2：发送失败时也要清掉刚写的标记文件，避免在交换目录留下 plug_*.exit 垃圾
        try { if (window.Android && Android.deleteSwapFile) Android.deleteSwapFile(tag + '.exit'); } catch (e) {}
        resolve({ code: -1, output: 'Termux 命令发送失败（Termux 未安装或被系统拦截）\n' });
        return;
      }
      const t0 = Date.now();
      const timer = setInterval(() => {
        let exit = '';
        try { exit = Android.readSwapFile(tag + '.exit'); } catch (e) {}
        if (exit !== null && String(exit).trim() !== '' && String(exit).trim() !== 'running') {
          clearInterval(timer);
          let out = '';
          try { out = Android.readSwapFile(tag + '.out') || ''; } catch (e) {}
          try { Android.deleteSwapFile(tag + '.exit'); Android.deleteSwapFile(tag + '.out'); } catch (e) {}
          resolve({ code: parseInt(String(exit).trim(), 10) || 0, output: out });
        } else if (Date.now() - t0 > 120000) {
          clearInterval(timer);
          /* v5.4.3 修复（审查 #21）：超时也要清理临时文件，否则 plug_*.out/.exit 永久残留 */
          try { Android.deleteSwapFile(tag + '.exit'); Android.deleteSwapFile(tag + '.out'); } catch (e) {}
          resolve({ code: -1, output: 'runCapture 超时（120 秒）\n' });
        }
      }, 300);
    });
  },
  copy: (txt) => { if (window.Android && Android.copyText) Android.copyText(String(txt)); },
  /** 插件隔离键值存储（localStorage，键自动加 pc_plugin_<id>_ 前缀） */
  storage(id) {
    const k = 'pc_plugin_' + String(id).replace(/[^A-Za-z0-9_]/g, '') + '_';
    return {
      get: (key, dft) => { const v = localStorage.getItem(k + key); return v === null ? dft : v; },
      set: (key, val) => localStorage.setItem(k + key, String(val)),
      del: (key) => localStorage.removeItem(k + key),
    };
  },
  /* v4.11.2 修复：接口文档 API 表列出的三个方法此前未挂载，照文档写的插件调用即 TypeError */
  writeSwapFile: (name, content) => !!(window.Android && Android.writeSwapFile)
    && Android.writeSwapFile(String(name), String(content == null ? '' : content)),
  readSwapFile: (name) => (window.Android && Android.readSwapFile) ? (Android.readSwapFile(String(name)) || '') : '',
  deleteSwapFile: (name) => !!(window.Android && Android.deleteSwapFile) && Android.deleteSwapFile(String(name)),
};
/* ============================================================
 * v5.8.0 插件信任模型
 * 记录：{ sha256, size, version, approvedAt, permissions{storage,network,workspace,termux}, mode:'sandbox'|'inline' }
 * 规则：
 *  · 没有记录 = 未授权 → 不执行（不再用「见过文件名」当信任依据）
 *  · 记录哈希 == 共享文件哈希 → 已授权；同时把源码复制到应用私有目录留底
 *  · 共享文件被改但私有副本仍是批准版本 → 继续运行私有副本，标记「更新待授权」
 *  · 共享文件被改且没有可用副本 → 授权失效，必须重新授权
 * 共享目录（/sdcard/QingCode/plugins）只作导入入口，执行优先使用私有副本。
 * ============================================================ */
const PLUGIN_TRUST_KEY = 'pc_plugin_trust';
const PLUGIN_PERM_KEYS = ['storage', 'network', 'workspace', 'termux'];
/* v5.10.1 安全（审查 P0-1）：默认全 false——网络与工作区读写也必须由用户显式勾选 */
const PLUGIN_DEFAULT_PERMS = { storage: false, network: false, workspace: false, termux: false };
const pluginInfos = new Map();   // name -> { name, size, mtime, sha256, cacheSha256 }（本次启动读取）

function normPerms(p) {
  const o = {};
  for (const k of PLUGIN_PERM_KEYS) o[k] = !!(p && p[k]);
  return o;
}
const PluginTrust = {
  all() {
    try {
      const v = JSON.parse(localStorage.getItem(PLUGIN_TRUST_KEY) || '{}');
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    } catch (e) { return {}; }
  },
  save(obj) {
    try { localStorage.setItem(PLUGIN_TRUST_KEY, JSON.stringify(obj || {})); return true; }
    catch (e) { storeIssue(t('store_meta_fail')); return false; }
  },
  get(name) {
    const r = this.all()[name];
    return (r && typeof r === 'object') ? r : null;
  },
  approve(name, info, perms, mode) {
    const all = this.all();
    const prev = all[name] || {};
    const rec = {
      sha256: (info && info.sha256) || '',
      size: info ? (info.size == null ? null : info.size) : null,
      version: (typeof prev.version === 'number' ? prev.version : 0) + 1,
      approvedAt: Date.now(),
      permissions: normPerms(perms),
      mode: mode === 'inline' ? 'inline' : 'sandbox'
    };
    all[name] = rec;
    this.save(all);
    return rec;
  },
  revoke(name) {
    const all = this.all();
    delete all[name];
    this.save(all);
    try { if (window.Android && Android.deletePluginCopy) Android.deletePluginCopy(name); } catch (e) {}
  },
  /** 只改运行模式（沙箱 / 主线程），保留哈希与权限 */
  setMode(name, mode) {
    const all = this.all();
    const rec = all[name];
    if (!rec) return false;
    rec.mode = (mode === 'inline') ? 'inline' : 'sandbox';
    this.save(all);
    return true;
  },
  permsOf(name) {
    const r = this.get(name);
    return r ? normPerms(r.permissions) : normPerms(PLUGIN_DEFAULT_PERMS);
  }
};

/** 授权状态：approved | stale-shared（运行私有副本，更新待授权）| pending（未授权）| changed（授权失效）| nohash（无法校验） */
function pluginTrustState(name, info) {
  const rec = PluginTrust.get(name);
  if (!rec || !rec.sha256) return 'pending';
  if (!info || !info.sha256) return 'nohash';
  if (rec.sha256 === info.sha256) return 'approved';
  if (info.cacheSha256 && info.cacheSha256 === rec.sha256) return 'stale-shared';
  return 'changed';
}
function pluginTrustLabel(state) {
  return state === 'approved' ? t('pp_trust_ok')
    : state === 'stale-shared' ? t('pp_trust_stale')
    : state === 'changed' ? t('pp_trust_changed')
    : state === 'nohash' ? t('pp_trust_nohash')
    : t('pp_trust_pending');
}
/** 是否在沙箱运行：信任记录优先（mode），旧版 pc_plugins_inline 作为兜底 */
function isPluginSandboxed(name) {
  const rec = PluginTrust.get(name);
  if (rec && rec.mode) return rec.mode !== 'inline';
  return SandboxHost.inlineList().indexOf(name) < 0;
}
/** 取可执行源码：批准版本优先用私有副本；否则用共享文件并同步留底 */
/**
 * 安全审查 P0-6：读取插件源码时，内容与哈希必须来自「同一次读取」。
 * 旧实现先由 pluginInfo 算一次哈希、再由 readPlugin 读一次内容，两次之间文件可被替换（TOCTOU）。
 * 返回 { content, sha256 }；不一致或读不到返回 null（调用方必须拒绝执行）。
 */
function readVerifiedPlugin(name, fromCopy) {
  try {
    const fn = fromCopy ? 'readPluginCopyVerified' : 'readPluginVerified';
    if (!(window.Android && Android[fn])) return null;
    const raw = Android[fn](name);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o.content !== 'string' || !o.sha256) return null;
    return { content: o.content, sha256: String(o.sha256) };
  } catch (e) { return null; }
}
function resolvePluginSource(name, info, state) {
  const rec = PluginTrust.get(name);
  if (!rec || !rec.sha256) return null;
  const fromCopy = state === 'stale-shared';
  const v = readVerifiedPlugin(name, fromCopy);
  if (!v) return null;
  /* 内容与批准记录不一致 → 拒绝执行（宁可让插件停用，也不执行没批准过的代码） */
  if (v.sha256 !== String(rec.sha256)) {
    if (Android.appendLog) Android.appendLog('js', 'plugin hash mismatch on read: ' + name);
    return null;
  }
  if (!fromCopy) {
    try {
      if (window.Android && Android.cachePluginCopy && (!info || info.cacheSha256 !== v.sha256)) {
        Android.cachePluginCopy(name, v.content);   // 用同一份内容留底，共享目录以后被改也能继续跑这份
      }
    } catch (e) {}
  }
  return v.content;
}
/** 旧版信任数据迁移：只有「此前确实被用户启用过」的插件才继承授权（迁移时记录当前哈希） */
function migrateLegacyPluginTrust(infos) {
  try { if (localStorage.getItem('pc_trust_migrated') === '1') return; } catch (e) { return; }
  let seen = [], inline = [], disabled = [];
  try { seen = JSON.parse(localStorage.getItem('pc_plugins_seen') || '[]') || []; } catch (e) {}
  try { inline = JSON.parse(localStorage.getItem('pc_plugins_inline') || '[]') || []; } catch (e) {}
  try { disabled = JSON.parse(localStorage.getItem('pc_plugins_disabled') || '[]') || []; } catch (e) {}
  const all = PluginTrust.all();
  let migrated = 0;
  for (const info of infos) {
    const n = info && info.name;
    if (!n || all[n] || !info.sha256) continue;
    if (seen.indexOf(n) < 0 || disabled.indexOf(n) >= 0) continue;
    PluginTrust.approve(n, info,
      /* v5.10.1 安全（审查 P0-1）：迁移不再默认全权，一律按最小权限记 false；
         用户需要在插件管理页重新勾选需要的权限 */
      { storage: false, network: false, workspace: false, termux: false },
      inline.indexOf(n) >= 0 ? 'inline' : 'sandbox');
    migrated++;
  }
  try { localStorage.setItem('pc_trust_migrated', '1'); } catch (e) {}
  if (migrated) outMeta(t('pp_trust_migrated').replace('{n}', migrated));
}

/* ---------- 权限闸门：主线程插件按声明裁剪能力 ---------- */
const pluginDenied = new Set();
function pluginDeny(file, perm, what) {
  const k = file + '|' + perm;
  if (pluginDenied.has(k)) return;
  pluginDenied.add(k);
  outAppend('⚠ [插件] ' + file + ' 调用 ' + what + ' 需要「' + perm + '」权限，已拒绝（可在插件管理页重新授权）\n', 'out-err');
}
function pluginAPIFor(file) {
  const base = window.PCPluginAPI;
  const rec = PluginTrust.get(file);
  const perms = rec ? normPerms(rec.permissions) : normPerms(PLUGIN_DEFAULT_PERMS);
  const api = Object.create(base);
  api.editor = Object.create(base.editor);
  api.trust = { pluginId: file, permissions: perms, mode: (rec && rec.mode) || 'sandbox' };
  if (!perms.termux) {
    api.execTermux = function () { pluginDeny(file, 'termux', 'execTermux'); return false; };
    api.runCapture = function () { pluginDeny(file, 'termux', 'runCapture'); return Promise.resolve({ code: -1, output: '权限未授予：termux\n' }); };
  }
  if (!perms.storage) {
    api.writeSwapFile = function () { pluginDeny(file, 'storage', 'writeSwapFile'); return false; };
    api.readSwapFile = function () { pluginDeny(file, 'storage', 'readSwapFile'); return ''; };
    api.deleteSwapFile = function () { pluginDeny(file, 'storage', 'deleteSwapFile'); return false; };
  }
  if (!perms.workspace) {
    api.editor.files = function () { pluginDeny(file, 'workspace', 'editor.files'); return []; };
    api.editor.ensureAll = function () { return 0; };
    api.editor.setFileContent = function () { pluginDeny(file, 'workspace', 'editor.setFileContent'); return false; };
    api.editor.saveAll = function () { return false; };
    api.editor.openFile = function () { return false; };
  }
  return api;
}

async function loadPlugins() {
  if (!(window.Android && Android.listPlugins && Android.readPlugin)) return;
  let infos = [];
  try {
    if (window.Android.pluginInfo) infos = JSON.parse(Android.pluginInfo()) || [];
    else infos = (JSON.parse(Android.listPlugins()) || []).map(n => ({ name: n, sha256: '', cacheSha256: '' }));
  } catch (e) { return; }
  if (!Array.isArray(infos)) infos = [];
  pluginInfos.clear();
  for (const it of infos) if (it && it.name) pluginInfos.set(it.name, it);
  if (!infos.length) return;
  // v4.6 总开关：关闭则不加载任何插件
  if (!pluginsEnabled()) {
    outMeta(LANG === 'en' ? 'Plugin system disabled (Plugin manager → Settings)' : '插件系统已关闭（插件管理 → 设置）');
    return;
  }
  migrateLegacyPluginTrust(infos);
  const disabled = disabledPlugins();
  PluginHost.blocked = PluginHost.blocked || {};
  const warned = new Set();
  for (const info of infos) {
    const n = info && info.name;
    if (!n) continue;
    if (disabled.indexOf(n) >= 0) { PluginHost.skipped.push(n); continue; }   // v4.6 用户显式禁用
    const state = pluginTrustState(n, info);
    if (state !== 'approved' && state !== 'stale-shared') {
      PluginHost.skipped.push(n);
      PluginHost.blocked[n] = state;
      if (!warned.has(n)) {
        warned.add(n);
        outMeta(state === 'changed'
          ? t('pp_trust_changed_note').replace('{name}', n)
          : t('pp_trust_new_note').replace('{name}', n));
      }
      continue;
    }
    const src = resolvePluginSource(n, info, state);
    if (!src) {
      PluginHost.blocked[n] = 'changed';
      PluginHost.skipped.push(n);
      outAppend((LANG === 'en' ? '[plugin] cannot read: ' : '[插件] 读取失败：') + n + '\n', 'out-err');
      continue;
    }
    try {
      if (isPluginSandboxed(n)) {
        const entry = SandboxHost.spawn(n, src);
        if (entry) {
          PluginHost.sandboxed = PluginHost.sandboxed || [];
          PluginHost.sandboxed.push(n);
        } else {
          /* v5.9.1：Worker 创建失败时不要把它记成「沙箱运行中」，否则管理页显示假状态 */
          PluginHost.blocked[n] = 'error';
          if (PluginHost.skipped.indexOf(n) < 0) PluginHost.skipped.push(n);
          outAppend((LANG === 'en' ? '[plugin] sandbox failed: ' : '[插件] 沙箱启动失败：') + n + '\n', 'out-err');
        }
        continue;
      }
      const api = pluginAPIFor(n);
      const before = PluginHost.loaded.length;
      new Function('PCPluginAPI', src)(api);
      for (let i = before; i < PluginHost.loaded.length; i++) {
        PluginHost.loaded[i].__file = n;   // v4.6 记录来源文件（供启停管理）
        PluginHost.loaded[i].__api = api;  // v5.8.0：onInit / 后续回调都用带权限裁剪的 API
      }
      outAppend((LANG === 'en' ? '[plugin] loaded: ' : '[插件] 已加载：') + n
        + (state === 'stale-shared' ? (LANG === 'en' ? ' (approved copy)' : '（运行已批准的私有副本）') : '') + '\n', 'out-echo');
    } catch (e) {
      outAppend((LANG === 'en' ? '[plugin] load failed: ' : '[插件] 加载失败：') + n + ' — ' + (e.message || e) + '\n', 'out-err');
    }
  }
  PluginHost.loaded.forEach(p => { if (p.__builtinInit) return; p.__builtinInit = true; PCPluginCurrent = p.id || null; try { p.onInit && p.onInit(p.__api || window.PCPluginAPI); } catch (e) { console.warn('[plugin]', p.id, e); } PCPluginCurrent = null; });
  renderPluginMenus();
  outMeta((LANG === 'en' ? 'Plugins loaded: ' : '已加载插件：') + PluginHost.loaded.length
    + (PluginHost.skipped.length ? (LANG === 'en' ? ' (disabled: ' + PluginHost.skipped.length + ')' : '（已禁用 ' + PluginHost.skipped.length + ' 个）') : ''));
}
function renderPluginMenus() {
  const anchor = $('mi-about');
  if (!anchor) return;
  /* v5.4.3 修复：每次重绘先移除旧菜单项。此前只 insertBefore 不清理，
     loadBuiltinPlugins/loadPlugins/unloadPlugin 每次调用都会重复插入一份。 */
  document.querySelectorAll('#more-menu .plugin-menu-item').forEach(function (el) { el.remove(); });
  if (!PluginHost.menus.length) return;
  PluginHost.menus.forEach(m => {
    const b = document.createElement('button');
    b.className = 'plugin-menu-item';
    b.textContent = '🧩 ' + m.label;
    b.addEventListener('click', () => {
      $('more-menu').classList.add('hidden');
      try { m.cb && m.cb(window.PCPluginAPI); } catch (e) { console.warn(e); }
    });
    anchor.parentNode.insertBefore(b, anchor);
  });
}

/* ---------- v5.0 插件删除 / 启用确认 ---------- */
let pendingPluginFile = null;
function confirmDeletePlugin(p) {
  pendingPluginFile = (p && p.__file) || null;
  showModal({
    title: t('pp_del_title'), withInput: false, okText: t('pp_del_ok'),
    desc: t('pp_del_desc').replace('{name}', (p && p.__file) || ''), showCancel: true
  });
  modalMode = 'plugin-del';
}
function confirmSandboxOff(file) {
  pendingPluginFile = file || null;
  showModal({
    title: t('pp_sbx_off_title'), withInput: false, okText: t('pp_sbx_off_ok'),
    desc: t('pp_sbx_off_desc'), showCancel: true
  });
  modalMode = 'plugin-sandbox-off';
}

/* ============================================================
 * v5.4：本地安全沙箱（Web Worker）
 * 在沙箱中运行的插件：拿不到 window / document / Android 原生桥 / localStorage / DOM。
 * 诚实边界：Worker 仍可发起网络请求；隔离的是 DOM 与原生能力。
 * 通信：受限 PCPluginAPI 全部走异步 RPC。
 * ============================================================ */
const SANDBOX_KEY = 'pc_sandbox_plugins';        // 旧键（v5.4）：开启沙箱的列表，仅用于迁移
const SANDBOX_INLINE_KEY = 'pc_plugins_inline';  // v5.4.2：在主线程运行的插件白名单（默认空 = 全部走沙箱）
const SandboxHost = {
  list: [],
  inlineList() { try { const v = JSON.parse(localStorage.getItem(SANDBOX_INLINE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } },
  saveInlineList(v) { try { localStorage.setItem(SANDBOX_INLINE_KEY, JSON.stringify(v || [])); } catch (e) {} },
  /* v5.4.2：默认在沙箱运行；v5.8.0：运行模式记在信任记录里（mode），旧列表仅作兜底 */
  isSandboxed(file) { return isPluginSandboxed(file); },
  setSandbox(file, on) {
    const mode = on ? 'sandbox' : 'inline';
    PluginTrust.setMode(file, mode);
    const list = this.inlineList().filter(function (x) { return x !== file; });
    if (mode === 'inline') list.push(file);
    this.saveInlineList(list);
    this.stop(file);
  },
  toggle(file) { const now = this.isSandboxed(file); this.setSandbox(file, !now); return !now; },
  running(file) { return this.list.some(x => x.file === file); },
  spawn(file, src) {
    if (this.running(file)) return null;
    let w;
    try { w = new Worker('sandbox-worker.js'); } catch (e) { outAppend('[沙箱] 无法创建 Worker：' + (e.message || e) + '\n', 'out-err'); return null; }
    const entry = { file: file, worker: w, commands: [], events: {} };
    this.list.push(entry);
    w.onmessage = (e) => this._onMsg(entry, e.data || {});
    w.onerror = (e) => { outAppend('[沙箱] ' + file + ' 运行错误：' + ((e && e.message) || e) + '\n', 'out-err'); };
    w.postMessage({ type: 'init', src: String(src || '') });
    return entry;
  },
  _onMsg(entry, d) {
    if (d.type === 'ready') outMeta('🧪 [沙箱] ' + entry.file + ' 已启动');
    else if (d.type === 'registered') outMeta('🧪 [沙箱] ' + entry.file + ' 注册插件 ' + d.id);
    else if (d.type === 'error') outAppend('🧪 [沙箱] ' + entry.file + '：' + d.message + '\n', 'out-err');
    else if (d.type === 'log') outMeta('🧪 ' + entry.file + '：' + d.msg);
    else if (d.type === 'unloaded') outMeta('🧪 [沙箱] ' + entry.file + ' 已卸载（onUnload 已调用）');
    /* v5.9.0：命令执行结果回传——此前 call-result 无人处理，插件里的异常完全看不到 */
    else if (d.type === 'call-result') {
      entry.lastResult = { cmd: d.cmd || '', ok: !!d.ok, value: d.result, error: d.error || '' };
      if (!d.ok) {
        outAppend('🧪 [沙箱] ' + entry.file + ' 命令 ' + (d.cmd || '?') + ' 执行失败：'
          + (d.error || '未注册该命令') + '\n', 'out-err');
      }
      if (entry.events && entry.events['commandResult']) {
        try { entry.worker.postMessage({ type: 'event', evt: 'commandResult', payload: entry.lastResult }); } catch (e) {}
      }
    }
    else if (d.type === 'rpc') this._rpc(entry, d);
  },
  _rpc(entry, d) {
    const reply = (ok, result, error) => { try { entry.worker.postMessage({ type: 'rpc-result', id: d.id, ok: ok, result: result, error: error }); } catch (e) {} };
    const a = d.args || [];
    try {
      switch (d.method) {
        case 'getText': reply(true, cm ? cm.state.doc.toString() : ''); break;
        case 'setText': {
          if (cm) {
            const cur = state.files.find(x => x.name === state.active);
            if (cur) {
              cur.content = String(a[0] == null ? '' : a[0]);
              viewStates.delete(state.active);   // v5.7.0：沙箱改写全文，旧视图状态作废
              PCCM.setDoc(cm, cur.content, hlLangOf(state.active));
              curHlLang = hlLangOf(state.active);
              scheduleSave();
            }
          }
          reply(true, true); break;
        }
        case 'runCommand': reply(true, EditorAPI.runCommand(String(a[0]))); break;
        case 'currentLanguage': reply(true, EditorAPI.currentLanguage()); break;
        case 'activeFileName': reply(true, state.active); break;
        case 't': reply(true, t(String(a[0]))); break;
        case 'on': entry.events[String(a[0])] = true; reply(true, true); break;   // v5.4.3：记录订阅，pcEmit 据此转发事件
        case 'registerCommand': {
          const cmdId = String(a[0]), label = String(a[1]);
          EditorAPI.registerCommand(cmdId, { label: label, group: 'sandbox', run: function () {
            entry.worker.postMessage({ type: 'call', cmd: cmdId, id: 'sc' + Date.now() });
            return true;
          } });
          if (entry.commands.indexOf(cmdId) < 0) entry.commands.push(cmdId);
          reply(true, true); break;
        }
        /* v5.9.0：沙箱拿不到的注册类能力，明确告诉插件为什么失败 */
        case 'registerLanguage': case 'registerSnippets': case 'registerCompletion':
        case 'registerFormatter': case 'addToolbarButton': case 'removeToolbarButton':
        case 'registerMenu': case 'page':
          reply(false, null, '沙箱内不支持 ' + d.method + '：请信任并改为主线程运行');
          break;
        default: reply(false, null, 'unknown method: ' + d.method);
      }
    } catch (e) { reply(false, null, String(e && e.message || e)); }
  },
  stop(file) {
    const i = this.list.findIndex(x => x.file === file);
    if (i < 0) return;
    const e = this.list.splice(i, 1)[0];
    for (const id of e.commands) { try { EditorAPI.unregisterCommand(id); } catch (err) {} }
    /* v5.9.0：先给插件一次 onUnload 的机会，再强制 terminate（最多等 250ms） */
    try { e.worker.postMessage({ type: 'unload' }); } catch (err) {}
    setTimeout(function () { try { e.worker.terminate(); } catch (err) {} }, 250);
  },
  stopAll() { this.list.slice().forEach(e => this.stop(e.file)); }
};

/* ============================================================
 * v5.4：自选壁纸（预设渐变 / 本地图片 / 透明度）
 * 存储：localStorage['pc_wallpaper'] = { kind:'preset'|'image', value, op }
 * ============================================================ */
const WP_KEY = 'pc_wallpaper';
const WP_PRESETS = [
  { name: '纯色', css: '#1e1e1e' },
  { name: '暮紫', css: 'linear-gradient(135deg,#1e1e2e,#2d1b4e 55%,#3b1f5e)' },
  { name: '深海', css: 'linear-gradient(135deg,#0f2027,#203a43 50%,#2c5364)' },
  { name: '午夜', css: 'linear-gradient(135deg,#1a1a2e,#16213e 50%,#0f3460)' }
];
function loadWallpaper() {
  try { const w = JSON.parse(localStorage.getItem(WP_KEY) || 'null'); return (w && w.kind) ? w : null; } catch (e) { return null; }
}
function saveWallpaper(w) { try { if (w) localStorage.setItem(WP_KEY, JSON.stringify(w)); else localStorage.removeItem(WP_KEY); } catch (e) {} }
function applyWallpaper(w) {
  const c = $('editor-container');
  if (!c) return;
  if (!w) {
    c.classList.remove('wp-on');
    c.style.removeProperty('--wp-img');
    c.style.removeProperty('--wp-op');
    return;
  }
  c.classList.add('wp-on');
  c.style.setProperty('--wp-img', w.kind === 'image' ? 'url("' + w.value + '")' : w.value);
  c.style.setProperty('--wp-op', String(w.op == null ? 0.35 : w.op));
}
function compressWallpaper(file) {
  return new Promise(function (resolve) {
    try {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = function () {
        try {
          let w = img.width, h = img.height, maxW = 1440;
          if (w > maxW) { h = Math.max(1, Math.round(h * maxW / w)); w = maxW; }
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          cv.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL('image/jpeg', 0.82));
        } catch (e) { resolve(null); }
        try { URL.revokeObjectURL(url); } catch (e) {}
      };
      img.onerror = function () { resolve(null); try { URL.revokeObjectURL(url); } catch (e) {} };
      img.src = url;
    } catch (e) { resolve(null); }
  });
}
function ensureWallpaperPanel() {
  let el = $('wp-panel');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'wp-panel';
  el.className = 'hidden';
  const sws = WP_PRESETS.map(function (p, i) {
    return '<button class="wp-sw" data-wp="' + i + '" title="' + p.name + '" style="background:' + p.css + '"></button>';
  }).join('');
  el.innerHTML = '<div class="wp-head"><b></b><button id="wp-close" class="wp-x" type="button">×</button></div>'
    + '<div class="wp-body">'
    + '<div class="wp-sec"><div class="wp-label" id="wp-lb-preset"></div><div class="wp-presets">' + sws + '</div></div>'
    + '<div class="wp-sec"><div class="wp-label" id="wp-lb-image"></div><label class="wp-file"><input type="file" id="wp-file" accept="image/*"><span id="wp-pick-txt"></span></label></div>'
    + '<div class="wp-sec"><div class="wp-label"><span id="wp-lb-op"></span> <span id="wp-opv">35%</span></div>'
    + '<input type="range" id="wp-op" min="5" max="80" value="35"></div>'
    + '<button id="wp-clear" class="wp-clear" type="button"></button>'
    + '</div>';
  document.body.appendChild(el);
  el.querySelector('#wp-close').addEventListener('click', () => el.classList.add('hidden'));
  el.querySelectorAll('.wp-sw').forEach(function (b) {
    b.addEventListener('click', function () {
      const w = { kind: 'preset', value: WP_PRESETS[+b.dataset.wp].css, op: curWpOp() };
      saveWallpaper(w); applyWallpaper(w); highlightWpSw(b);
    });
  });
  el.querySelector('#wp-op').addEventListener('input', function (e) {
    const w = loadWallpaper() || { kind: 'preset', value: WP_PRESETS[0].css };
    w.op = Math.max(0.05, Math.min(0.8, +e.target.value / 100));
    el.querySelector('#wp-opv').textContent = Math.round(w.op * 100) + '%';
    saveWallpaper(w); applyWallpaper(w);
  });
  el.querySelector('#wp-file').addEventListener('change', async function (e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const dataUrl = await compressWallpaper(f);
    if (!dataUrl) { outAppend(t('wp_fail') + '\n', 'out-err'); return; }
    const w = { kind: 'image', value: dataUrl, op: curWpOp() };
    try { saveWallpaper(w); } catch (err) { outAppend(t('wp_too_big') + '\n', 'out-err'); return; }
    applyWallpaper(w);
    outMeta(t('wp_done'));
    e.target.value = '';
  });
  el.querySelector('#wp-clear').addEventListener('click', function () { saveWallpaper(null); applyWallpaper(null); highlightWpSw(null); });
  return el;
}
function curWpOp() {
  const w = loadWallpaper();
  if (w && w.op != null) return w.op;
  const r = $('wp-op');
  return r ? Math.max(0.05, Math.min(0.8, +r.value / 100)) : 0.35;
}
function highlightWpSw(btn) {
  const el = $('wp-panel'); if (!el) return;
  el.querySelectorAll('.wp-sw').forEach(function (b) { b.classList.toggle('act', b === btn); });
}
function openWallpaperPanel() {
  const el = ensureWallpaperPanel();
  el.classList.remove('hidden');
  const setTxt = function (id, key) { const n = el.querySelector(id); if (n) n.textContent = t(key); };
  setTxt('.wp-head b', 'wp_title');
  setTxt('#wp-lb-preset', 'wp_preset');
  setTxt('#wp-lb-image', 'wp_image');
  setTxt('#wp-pick-txt', 'wp_pick');
  setTxt('#wp-lb-op', 'wp_opacity');
  setTxt('#wp-clear', 'wp_clear');
  const w = loadWallpaper();
  const op = w && w.op != null ? w.op : 0.35;
  el.querySelector('#wp-op').value = Math.round(op * 100);
  el.querySelector('#wp-opv').textContent = Math.round(op * 100) + '%';
  if (w && w.kind === 'preset') {
    const idx = WP_PRESETS.findIndex(function (p) { return p.css === w.value; });
    if (idx >= 0) highlightWpSw(el.querySelector('.wp-sw[data-wp="' + idx + '"]')); else highlightWpSw(null);
  } else highlightWpSw(null);
}

/* ---------- v4.6 插件管理页（更多菜单 → 🧩 插件管理） ---------- */
let ppTab = 'loaded';
function openPluginPage() {
  $('more-menu').classList.add('hidden');
  $('plugin-page').classList.remove('hidden');
  buildPluginTabs();
  switchPluginTab(ppTab);
}
function buildPluginTabs() {
  const box = $('pp-tabs');
  box.querySelectorAll('.pp-tab[data-dyn]').forEach(el => el.remove());
  Object.keys(PluginHost.pages).forEach(id => {
    const p = PluginHost.pages[id];
    const btn = document.createElement('button');
    btn.className = 'pp-tab'; btn.dataset.pp = id; btn.dataset.dyn = '1';
    btn.textContent = '🧩 ' + p.title;
    btn.addEventListener('click', () => switchPluginTab(id));
    box.appendChild(btn);
  });
  $('pp-count').textContent = PluginHost.loaded.length ? ('· ' + PluginHost.loaded.length) : '';
}
function switchPluginTab(id) {
  ppTab = id;
  document.querySelectorAll('#pp-tabs .pp-tab').forEach(el => el.classList.toggle('active', el.dataset.pp === id));
  const body = $('pp-body');
  body.innerHTML = '';
  if (PluginHost.pages[id]) {          // 插件注册的自定义选项卡：惰性渲染
    try { PluginHost.pages[id].render(body, window.PCPluginAPI); } catch (e) {
      body.innerHTML = '';
      const er = document.createElement('div'); er.className = 'pp-empty';
      er.textContent = 'page error: ' + (e.message || e);
      body.appendChild(er);
    }
    return;
  }
  if (id === 'langs') renderLangsTab(body);
  else if (id === 'settings') renderSettingsTab(body);
  else renderLoadedTab(body);
}
function renderLoadedTab(body) {
  const hint = document.createElement('div');
  hint.className = 'pp-hint';
  hint.textContent = t('pp_hint');
  body.appendChild(hint);
  const warn = document.createElement('div');
  warn.className = 'pp-warn';
  warn.textContent = t('pp_sec_warn');
  body.appendChild(warn);
  /* v5.4：正在沙箱（Worker）中运行的插件 */
  SandboxHost.list.forEach(function (e) {
    const card = document.createElement('div');
    card.className = 'pp-card';
    const head = document.createElement('div');
    head.className = 'pp-card-head';
    const nm = document.createElement('b'); nm.textContent = e.file;
    const bd = document.createElement('span'); bd.className = 'pp-badge'; bd.textContent = '🧪 ' + t('pp_sandbox_badge');
    head.appendChild(nm); head.appendChild(bd);
    const desc = document.createElement('div'); desc.className = 'pp-card-desc'; desc.textContent = t('pp_sandbox_running');
    card.appendChild(head); card.appendChild(desc);
    /* v5.8.0：沙箱插件同样要能看到授权状态，并能撤销授权（否则默认沙箱的插件没有入口） */
    card.appendChild(pluginTrustSection(e.file));
    const foot = document.createElement('div'); foot.className = 'pp-card-foot';
    /* v5.4.3 修复（审查 #1）：沙箱插件不会进入 PluginHost.loaded（loadPlugins 里 spawn 后直接
       continue），而「沙箱开/关」按钮只渲染在 loaded 插件卡片上 —— 用户永远没有入口把插件
       切回主线程。这里给沙箱卡片补一个显式入口，复用同一套二次确认。 */
    const tr = document.createElement('button'); tr.className = 'pp-btn'; tr.textContent = t('pp_sandbox_trust');
    tr.addEventListener('click', function () { confirmSandboxOff(e.file); });
    foot.appendChild(tr);
    const st = document.createElement('button'); st.className = 'pp-btn pp-btn-danger'; st.textContent = t('pp_sandbox_stop');
    st.addEventListener('click', function () { SandboxHost.stop(e.file); openPluginPage(); });
    foot.appendChild(st);
    const rv = document.createElement('button'); rv.className = 'pp-btn pp-btn-danger'; rv.textContent = t('pp_trust_revoke');
    rv.addEventListener('click', function () {
      PluginTrust.revoke(e.file);
      SandboxHost.stop(e.file);
      outMeta(t('pp_trust_revoked').replace('{name}', e.file));
      openPluginPage();
    });
    foot.appendChild(rv);
    card.appendChild(foot);
    body.appendChild(card);
  });
  if (!PluginHost.loaded.length && !PluginHost.skipped.length) {
    const empty = document.createElement('div'); empty.className = 'pp-empty';
    empty.textContent = t('pp_none');
    body.appendChild(empty);
    return;
  }
  PluginHost.loaded.forEach(p => body.appendChild(pluginCard(p)));
  PluginHost.skipped.forEach(n => body.appendChild(pluginCard({ __file: n, __disabled: true })));
  (PluginHost.disabledBuiltin || []).forEach(f => body.appendChild(pluginCard({ __file: f, __disabled: true, __builtin: true })));
}
function pluginCard(p) {
  const card = document.createElement('div');
  const isUser = !!(p.__file && !p.__builtin);
  const info = isUser ? (pluginInfos.get(p.__file) || null) : null;
  const trust = isUser ? pluginTrustState(p.__file, info) : 'approved';
  const approved = (trust === 'approved' || trust === 'stale-shared');
  card.className = 'pp-card' + ((p.__disabled || !approved) ? ' off' : '');
  const head = document.createElement('div'); head.className = 'pp-card-head';
  head.innerHTML = '<span class="pp-card-icon">🧩</span><span class="pp-card-name"></span><span class="pp-card-ver"></span>';
  head.querySelector('.pp-card-name').textContent = p.name || p.id || p.__file || '?';
  if (p.version) head.querySelector('.pp-card-ver').textContent = 'v' + p.version;
  card.appendChild(head);
  const metaBits = [p.__builtin ? t('pp_builtin') : null, p.author, p.homepage, p.id ? ('id: ' + p.id) : null, p.__file && !p.__disabled ? p.__file : null].filter(Boolean);
  if (metaBits.length) {
    const m = document.createElement('div'); m.className = 'pp-card-meta';
    m.textContent = metaBits.join(' · ');
    card.appendChild(m);
  }
  if (p.description) {
    const d = document.createElement('div'); d.className = 'pp-card-desc';
    d.textContent = p.description;
    card.appendChild(d);
  }
  /* v5.8.0：用户插件的信任状态 / 权限 / 授权入口 */
  if (isUser) card.appendChild(pluginTrustSection(p.__file));

  const foot = document.createElement('div'); foot.className = 'pp-card-foot';
  const st = document.createElement('span');
  st.className = 'pp-state' + ((p.__disabled || !approved) ? ' off' : '');
  st.textContent = !approved ? t('pp_trust_not_running') : (p.__disabled ? t('pp_disabled') : t('pp_enabled'));
  foot.appendChild(st);

  /* 未授权 / 授权失效：不提供「启用」，必须先授权（授权按钮在信任区块里） */
  if (isUser && !approved) {
    const del0 = document.createElement('button');
    del0.className = 'pp-btn pp-btn-danger';
    del0.textContent = t('pp_delete');
    del0.addEventListener('click', () => confirmDeletePlugin(p));
    foot.appendChild(del0);
    card.appendChild(foot);
    return card;
  }

  const btn = document.createElement('button'); btn.className = 'pp-btn';
  btn.textContent = p.__disabled ? t('pp_enable') : t('pp_disable');
  btn.addEventListener('click', () => {
    if (!p.__file) return;
    /* 内置插件：即时启停（无需重启） */
    if (p.__builtin) {
      if (p.__disabled) enableBuiltinPlugin(p.__file).then(function () { openPluginPage(); });
      else { unloadPlugin(p.id); openPluginPage(); }
      return;
    }
    /* 用户插件：已授权 → 直接启停；未授权走上面的授权区块 */
    if (p.__disabled) {
      setPluginDisabled(p.__file, false);
      try { if (window.Android && Android.showToast) Android.showToast(t('pp_toggle_restart')); } catch (e) {}
      openPluginPage();
      return;
    }
    setPluginDisabled(p.__file, true);
    try { if (window.Android && Android.showToast) Android.showToast(t('pp_toggle_restart')); } catch (e) {}
    openPluginPage();
  });
  foot.appendChild(btn);
  /* 只有 /sdcard 用户插件可删除（内置插件随包，删不掉也不该删） */
  if (isUser) {
    /* v5.4：沙箱开关（切换后重启生效） */
    const sb = document.createElement('button');
    sb.className = 'pp-btn';
    const inSandbox = SandboxHost.isSandboxed(p.__file);
    sb.textContent = inSandbox ? t('pp_sandbox_on') : t('pp_sandbox_off');
    if (!inSandbox) sb.className = 'pp-btn pp-btn-danger';
    sb.addEventListener('click', function () {
      if (inSandbox) { confirmSandboxOff(p.__file); return; }   /* 关闭沙箱必须二次确认 */
      SandboxHost.setSandbox(p.__file, true);
      try { if (window.Android && Android.showToast) Android.showToast(t('pp_sandbox_restart')); } catch (e) {}
      openPluginPage();
    });
    foot.appendChild(sb);
    const rv = document.createElement('button');
    rv.className = 'pp-btn pp-btn-danger';
    rv.textContent = t('pp_trust_revoke');
    rv.addEventListener('click', function () {
      PluginTrust.revoke(p.__file);
      setPluginDisabled(p.__file, true);
      outMeta(t('pp_trust_revoked').replace('{name}', p.__file));
      openPluginPage();
    });
    foot.appendChild(rv);
    const del = document.createElement('button');
    del.className = 'pp-btn pp-btn-danger';
    del.textContent = t('pp_delete');
    del.addEventListener('click', () => confirmDeletePlugin(p));
    foot.appendChild(del);
  }
  card.appendChild(foot);
  return card;
}

/** 插件卡片里的信任区块：状态徽标 + 内容指纹 + 权限清单 / 勾选授权 */
function pluginTrustSection(name) {
  const info = pluginInfos.get(name) || null;
  const state = pluginTrustState(name, info);
  const rec = PluginTrust.get(name);
  const box = document.createElement('div');
  box.className = 'pp-trust';
  const head = document.createElement('div'); head.className = 'pp-trust-head';
  const badge = document.createElement('span');
  badge.className = 'pp-badge ' + (state === 'approved' ? 'ok' : state === 'stale-shared' ? 'warn' : 'bad');
  badge.textContent = pluginTrustLabel(state);
  head.appendChild(badge);
  if (info && info.sha256) {
    const h = document.createElement('span'); h.className = 'pp-trust-hash';
    h.textContent = t('pp_trust_hash') + ' ' + String(info.sha256).slice(0, 8);
    head.appendChild(h);
  }
  box.appendChild(head);

  /* v5.10.1 安全（审查 P0-1）：主线程插件根本不受权限约束——它能直接摸到 window.Android，
     勾选框只会给人「已隔离」的错觉。这里改成只读提示，不提供可勾选项。 */
  const inlineMode = !isPluginSandboxed(name);
  if (inlineMode) {
    const warn = document.createElement('div');
    warn.className = 'pp-card-meta';
    warn.style.color = '#f0cd8a';
    warn.textContent = t('pp_trust_inline_note');
    box.appendChild(warn);
    if (rec && (state === 'approved' || state === 'stale-shared')) {
      const v = document.createElement('div'); v.className = 'pp-card-meta';
      v.textContent = '(v' + (rec.version || 1) + ')';
      box.appendChild(v);
      return box;
    }
    const foot0 = document.createElement('div'); foot0.className = 'pp-card-foot';
    const btn0 = document.createElement('button');
    btn0.className = 'pp-btn pp-btn-primary';
    btn0.textContent = t('pp_trust_approve');
    btn0.addEventListener('click', function () { approvePlugin(name, normPerms(PLUGIN_DEFAULT_PERMS)); });
    foot0.appendChild(btn0);
    box.appendChild(foot0);
    return box;
  }

  if (rec && (state === 'approved' || state === 'stale-shared')) {
    const p = normPerms(rec.permissions);
    const granted = PLUGIN_PERM_KEYS.filter(k => p[k]);
    const line = document.createElement('div'); line.className = 'pp-card-meta';
    line.textContent = t('pp_trust_perm') + ': '
      + (granted.length ? granted.map(k => t('pp_perm_' + k)).join(' · ') : t('pp_perm_none'))
      + '   (v' + (rec.version || 1) + ')';
    box.appendChild(line);
    return box;
  }

  /* 未授权 / 内容已变化：逐项勾选权限后授权（默认全不勾） */
  const pick = document.createElement('div'); pick.className = 'pp-perm-pick';
  const dft = normPerms(PLUGIN_DEFAULT_PERMS);
  const boxes = {};
  PLUGIN_PERM_KEYS.forEach(function (k) {
    const lab = document.createElement('label'); lab.className = 'pp-perm-item';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!dft[k];
    const sp = document.createElement('span'); sp.textContent = t('pp_perm_' + k);
    lab.appendChild(cb); lab.appendChild(sp);
    pick.appendChild(lab);
    boxes[k] = cb;
  });
  box.appendChild(pick);
  const foot = document.createElement('div'); foot.className = 'pp-card-foot';
  const btn = document.createElement('button');
  btn.className = 'pp-btn pp-btn-primary';
  btn.textContent = t('pp_trust_approve');
  btn.addEventListener('click', function () {
    const perms = {};
    PLUGIN_PERM_KEYS.forEach(function (k) { perms[k] = !!boxes[k].checked; });
    approvePlugin(name, perms);
  });
  foot.appendChild(btn);
  box.appendChild(foot);
  return box;
}

/** 授权并启用：记录内容指纹 + 权限，并把源码复制到应用私有目录作为执行副本 */
function approvePlugin(name, perms) {
  const info = pluginInfos.get(name) || null;
  if (!info || !info.sha256) {
    outAppend('⚠ 无法读取插件内容指纹，拒绝授权：' + name + '\n', 'out-err');
    return false;
  }
  const rec = PluginTrust.approve(name, info, perms, isPluginSandboxed(name) ? 'sandbox' : 'inline');
  if (!rec) return false;
  setPluginDisabled(name, false);   // 授权即启用
  try {
    if (window.Android && Android.cachePluginCopy) {
      const src = Android.readPlugin(name) || '';
      if (src) Android.cachePluginCopy(name, src);
    }
  } catch (e) {}
  outMeta(t('pp_trust_approved').replace('{name}', name).replace('{h}', String(rec.sha256).slice(0, 8)));
  try { if (window.Android && Android.showToast) Android.showToast(t('pp_trust_need_restart')); } catch (e) {}
  openPluginPage();
  return true;
}
function renderLangsTab(body) {
  const keys = Object.keys(PluginHost.langs);
  if (!keys.length) {
    const e = document.createElement('div'); e.className = 'pp-empty';
    e.textContent = t('pp_lang_none');
    body.appendChild(e);
    return;
  }
  const tbl = document.createElement('table'); tbl.className = 'pp-table';
  const thead = document.createElement('tr');
  [t('pp_lang_ext'), t('pp_lang_name'), t('pp_lang_by')].forEach(h => {
    const th = document.createElement('th'); th.textContent = h; thead.appendChild(th);
  });
  tbl.appendChild(thead);
  keys.forEach(ext => {
    const L = PluginHost.langs[ext];
    const tr = document.createElement('tr');
    [ext, (L.def && (L.def.name || L.def.id)) || '', (L.plugin && (L.plugin.name || L.plugin.id)) || ''].forEach(v => {
      const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
    });
    tbl.appendChild(tr);
  });
  body.appendChild(tbl);
}
function renderSettingsTab(body) {
  const info = document.createElement('div'); info.className = 'pp-hint';
  info.textContent = t('pp_api_ver') + ': PCPluginAPI v' + window.PCPluginAPI.apiVersion + ' · ' + t('pp_dir') + ': /sdcard/QingCode/plugins/';
  body.appendChild(info);
  const row = document.createElement('div'); row.className = 'pp-card';
  const head = document.createElement('div'); head.className = 'pp-card-head';
  head.innerHTML = '<span class="pp-card-name"></span>';
  head.querySelector('.pp-card-name').textContent = t('pp_master');
  row.appendChild(head);
  const desc = document.createElement('div'); desc.className = 'pp-card-desc';
  desc.textContent = t('pp_master_desc');
  row.appendChild(desc);
  const foot = document.createElement('div'); foot.className = 'pp-card-foot';
  const st = document.createElement('span');
  st.className = 'pp-state' + (pluginsEnabled() ? '' : ' off');
  st.textContent = pluginsEnabled() ? t('pp_enabled') : t('pp_disabled');
  const btn = document.createElement('button'); btn.className = 'pp-btn';
  btn.textContent = pluginsEnabled() ? t('pp_disable') : t('pp_enable');
  btn.addEventListener('click', () => {
    localStorage.setItem('pc_plugins_enabled', pluginsEnabled() ? '0' : '1');
    try { if (window.Android && Android.showToast) Android.showToast(t('pp_toggle_restart')); } catch (e) {}
    renderSettingsTab($('pp-body'));
  });
  foot.appendChild(st); foot.appendChild(btn);
  row.appendChild(foot);
  body.appendChild(row);
  /* v5.9.0：常用键条开关（横屏/平板上尤其有用） */
  const kbRow = document.createElement('div'); kbRow.className = 'pp-card';
  const kbHead = document.createElement('div'); kbHead.className = 'pp-card-head';
  kbHead.innerHTML = '<span class="pp-card-name"></span>';
  kbHead.querySelector('.pp-card-name').textContent = t('kb_title');
  kbRow.appendChild(kbHead);
  const kbDesc = document.createElement('div'); kbDesc.className = 'pp-card-desc';
  kbDesc.textContent = t('kb_desc');
  kbRow.appendChild(kbDesc);
  const kbFoot = document.createElement('div'); kbFoot.className = 'pp-card-foot';
  const kbState = document.createElement('span');
  kbState.className = 'pp-state' + (keybarEnabled() ? '' : ' off');
  kbState.textContent = keybarEnabled() ? t('pp_enabled') : t('pp_disabled');
  const kbBtn = document.createElement('button'); kbBtn.className = 'pp-btn';
  kbBtn.textContent = keybarEnabled() ? t('pp_disable') : t('pp_enable');
  kbBtn.addEventListener('click', function () { setKeybarEnabled(!keybarEnabled()); renderSettingsTab($('pp-body')); });
  kbFoot.appendChild(kbState); kbFoot.appendChild(kbBtn);
  kbRow.appendChild(kbFoot);
  body.appendChild(kbRow);

  /* v5.9.0：在线安装插件（从链接下载 .js → 写入插件目录 → 仍是「未授权」，需勾选权限） */
  const inst = document.createElement('div'); inst.className = 'pp-card';
  const ihead = document.createElement('div'); ihead.className = 'pp-card-head';
  ihead.innerHTML = '<span class="pp-card-name"></span>';
  ihead.querySelector('.pp-card-name').textContent = t('pp_install_title');
  inst.appendChild(ihead);
  const idesc = document.createElement('div'); idesc.className = 'pp-card-desc';
  idesc.textContent = t('pp_install_desc');
  inst.appendChild(idesc);
  const iurl = document.createElement('input');
  iurl.type = 'url'; iurl.placeholder = t('pp_install_ph'); iurl.setAttribute('autocapitalize', 'off');
  iurl.style.cssText = 'display:block;width:100%;margin:8px 0;padding:8px;border-radius:6px;background:#1e1e1e;color:#ddd;border:1px solid #444';
  inst.appendChild(iurl);
  const ifoot = document.createElement('div'); ifoot.className = 'pp-card-foot';
  const ibtn = document.createElement('button'); ibtn.className = 'pp-btn pp-btn-primary';
  ibtn.textContent = t('pp_install_btn');
  ibtn.addEventListener('click', function () { installPluginFromUrl(iurl.value.trim()); });
  ifoot.appendChild(ibtn);
  inst.appendChild(ifoot);
  body.appendChild(inst);
  const reserve = document.createElement('div'); reserve.className = 'pp-hint dim';
  reserve.textContent = t('pp_reserve');
  body.appendChild(reserve);
}
/** v5.9.0：从 HTTPS 链接安装插件。只负责下载与落盘，授权仍需用户在卡片上勾选权限。 */
let pendingInstall = null;   // v5.10.1（审查 P1-10）：等待用户确认的安装任务
async function installPluginFromUrl(url) {
  const u = String(url || '').trim();
  if (!/^https:\/\/[^\s]+$/i.test(u)) { outAppend('⚠ ' + t('pp_install_bad_url') + '\n', 'out-err'); return false; }
  if (!(window.Android && Android.writePlugin)) { outAppend(t('only_android') + '\n', 'out-err'); return false; }
  let name = '';
  try { name = decodeURIComponent((new URL(u)).pathname.split('/').pop() || ''); } catch (e) { name = ''; }
  name = name.replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!/\.js$/i.test(name)) name = (name || 'plugin') + '.js';
  let text = '';
  const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 25000);
  try {
    const r = await fetch(u, ctrl ? { signal: ctrl.signal, mode: 'cors' } : {});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    text = await r.text();
    if (text.length > 512 * 1024) throw new Error(t('pp_install_too_big'));
  } catch (e) {
    clearTimeout(timer);
    outAppend('⚠ ' + t('pp_install_fail') + (e && e.message ? e.message : e) + '\n', 'out-err');
    return false;
  }
  clearTimeout(timer);
  /* 安全审查 P1-10：安装前先给出指纹与源码片段，再让用户确认一次。
     下载完成不等于可信——这一步就是给「来源是否可信」留一个明确的判断点。 */
  let hex = '';
  try { hex = await sha256Hex(text); } catch (e) { hex = ''; }
  const lines = String(text).split('\n').slice(0, 50).join('\n');
  pendingInstall = { name: name, text: text, hex: hex };
  showModal({
    title: t('pp_install_confirm_title'), withInput: false, okText: t('pp_install_confirm_ok'),
    desc: t('pp_install_confirm_desc')
      .replace('{name}', name)
      .replace('{h}', hex ? hex.slice(0, 16) + '…' : '?')
      + '\n\n' + lines,
    showCancel: true
  });
  modalMode = 'plugin-install';
  return true;
}

/** SHA-256（十六进制）；环境不支持时返回空串，不影响流程但会显示 "?" */
async function sha256Hex(text) {
  try {
    if (!(window.crypto && crypto.subtle)) return '';
    const buf = new TextEncoder().encode(String(text));
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(d)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  } catch (e) { return ''; }
}

/** 用户在确认框点了「安装」之后才真正落盘 */
async function finishPluginInstall() {
  const pi = pendingInstall;
  pendingInstall = null;
  if (!pi) return false;
  const name = pi.name, text = pi.text;
  let ok = false;
  try { ok = Android.writePlugin(name, text); } catch (e) { ok = false; }
  if (!ok) { outAppend('⚠ ' + t('pp_install_fail') + name + '\n', 'out-err'); return false; }
  /* 刷新插件清单：新文件没有信任记录 → 卡片显示「待授权」 */
  try {
    if (Android.pluginInfo) {
      const infos = JSON.parse(Android.pluginInfo()) || [];
      pluginInfos.clear();
      for (const it of infos) if (it && it.name) pluginInfos.set(it.name, it);
      if (infos.some(function (x) { return x && x.name === name; })) {
        PluginHost.blocked[name] = 'pending';
        if (PluginHost.skipped.indexOf(name) < 0) PluginHost.skipped.push(name);
      }
    }
  } catch (e) {}
  outMeta(t('pp_install_ok').replace('{name}', name));
  switchPluginTab('loaded');
  return true;
}
$('mi-plugins').addEventListener('click', openPluginPage);
$('pp-back').addEventListener('click', () => $('plugin-page').classList.add('hidden'));
// 内置选项卡点击切换（插件注册的动态选项卡在 buildPluginTabs 中绑定）
document.querySelectorAll('#pp-tabs .pp-tab:not([data-dyn])').forEach(b =>
  b.addEventListener('click', () => switchPluginTab(b.dataset.pp)));

/* ---------- v4.9 启动页：双引擎进度条（py 通道 = Pyodide，cpp 通道 = Termux） ---------- */
function splashSet(ch, pct, msgKey) {
  const fill = $('splash-' + ch + '-fill'), pctEl = $('splash-' + ch + '-pct'),
        st = $('splash-' + ch + '-status'), grp = $('splash-grp-' + ch);
  if (!fill || !pctEl || !st) return;
  if (grp) grp.classList.remove('splash-group-dim');   // 一旦有动静就点亮
  if (pct < 0) {  // 失败/超时：进度条变红（右上角「跳过」按钮常驻可用）
    fill.classList.add('fail');
    fill.style.width = '100%';
    pctEl.textContent = '✕';
    if (msgKey) st.textContent = t(msgKey);
    return;
  }
  if (pct >= 100) fill.classList.add('ok');
  fill.style.width = pct + '%';
  pctEl.textContent = Math.round(pct) + '%';
  if (msgKey) st.textContent = t(msgKey);
}
function splashHide() {
  const sp = $('splash');
  if (!sp || sp.classList.contains('hide')) return;
  sp.classList.add('hide');
  setTimeout(() => { sp.style.display = 'none'; }, 400);
}
// v4.9：右上角「跳过」常驻——点击弹确认框，确认后才进入主界面（未完成任务在后台继续编译/安装）
$('splash-skip').addEventListener('click', () => $('splash-confirm').classList.remove('hidden'));
$('spc-cancel').addEventListener('click', () => $('splash-confirm').classList.add('hidden'));
$('spc-ok').addEventListener('click', () => {
  $('splash-confirm').classList.add('hidden');
  splashHide();
});
function validName(name) {
  if (!name) return t('need_name');
  if (/[\\/:*?"<>|]/.test(name)) return t('bad_chars');
  if (name.length > 60) return t('too_long');
  if (state.files.some(f => f.name === name)) return t('dup_name');
  // v4.4：插件注册的语言扩展名并入白名单
  const pluginExts = Object.keys(PluginHost.langs)
    .map(e => e.replace(/^\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean);
  const extRe = new RegExp('\\.(py|cpp|cc|cxx|c|h|hpp|txt|md|json' + (pluginExts.length ? '|' + pluginExts.join('|') : '') + ')$', 'i');
  if (!extRe.test(name)) return t('bad_ext');
  return null;
}
let modalTarget = null;   // v5.7.0：重命名/删除的目标文件（不再借用 state.active，避免编辑中的文件被顶掉）
function doNewFile() { showModal({ title: t('new_file'), placeholder: t('fname_eg') }); modalMode = 'new'; modalTarget = null; }
function startRename(old) {
  modalTarget = old;
  showModal({ title: t('rename'), value: old, desc: '' });
  modalMode = 'rename';
}
function doDelete() {
  const target = state.active;      // 删除始终作用于当前打开的文件
  if (!target) return;
  modalTarget = target;
  showModal({ title: t('delete_q') + target + t('delete_q2'), withInput: false, okText: t('delete_btn'), desc: t('irreversible') });
  modalMode = 'confirm';
}
function modalOk() {
  const name = $('modal-input').value.trim();
  if (modalMode === 'qc-approve') {
    ProjectConfig.markApproved();
    hideModal();
    runCppTermux();
    return;
  }
  if (modalMode === 'plugin-install') {
    hideModal();
    finishPluginInstall();
    return;
  }
  if (modalMode === 'new') {
    const err = validName(name);
    if (err) { $('modal-error').textContent = err; return; }
    state.files.push({ name, content: '', _saved: '' });
    openFile(name); closeSidebar(); hideModal();
  } else if (modalMode === 'rename') {
    const old = modalTarget || state.active;
    if (name === old) { hideModal(); return; }
    const err = validName(name);
    if (err) { $('modal-error').textContent = err; return; }
    const target = state.files.find(x => x.name === old);
    if (!target) { hideModal(); return; }
    /* v5.6.0：重命名要迁移草稿键，并把磁盘签名置空（磁盘上仍是旧文件名）
       v5.7.0：标签与视图状态同样迁移，否则切回来会找不到状态 */
    const oldDraftKey = draftKey(old);
    target.name = name;
    target._sig = null;
    const ti = tabList().indexOf(old);
    if (ti >= 0) tabList()[ti] = name;
    const vs = viewStates.get(old);
    if (vs) { viewStates.delete(old); viewStates.set(name, vs); }
    if (state.active === old) state.active = name;
    if (projectMode()) {
      DraftStore.del(oldDraftKey);
      if (target.content !== null && target.content !== target._saved) DraftStore.put(draftKey(name), target.content);
    }
    if (state.active === name) openFile(name); else { renderTabs(); saveStore(); }
    modalTarget = null;
    hideModal();
  } else if (modalMode === 'confirm') {
    const gone = modalTarget || state.active;
    const wasActive = (gone === state.active);
    state.files = state.files.filter(x => x.name !== gone);
    if (projectMode()) DraftStore.del(draftKey(gone));   // v5.6.0：删除文件同时清理草稿
    dropTab(gone);                                       // v5.7.0：标签一起关掉
    if (!state.files.length) state.files.push({ name: 'main.py', content: PY_DEFAULT_CODE, _saved: PY_DEFAULT_CODE });
    if (!tabList().length) state.tabs = [state.files[0].name];
    if (wasActive || !state.files.some(f => f.name === state.active)) openFile(tabList()[0]);
    else { renderTabs(); saveStore(); }
    modalTarget = null;
    hideModal();
  }
}

/* ---------- 导出 ---------- */
function exportFile() {
  const f = state.files.find(x => x.name === state.active);
  if (!f) return;
  if (f.content === null && !ensureContent(f)) { outAppend('导出失败：无法读取文件内容。\n', 'out-err'); return; }
  if (window.Android && Android.saveFileEx) {
    /* v5.4.3 修复（审查 #13）：不再无条件提示成功——文件名非法（旧白名单拒绝中文）、
       编码不支持（ASCII 含中文）时原生会返回 false。 */
    const ok = Android.saveFileEx(f.name.split('/').pop(), f.content, exportEncoding);
    if (ok) outMeta('已导出 ' + f.name + '（' + exportEncoding + '）到下载文件夹');
    else outAppend('导出失败：文件名不被接受或所选编码（' + exportEncoding + '）无法表示文件内容。'
      + '可在菜单切换编码（如 UTF-8 / GBK）后重试。\n', 'out-err');
    return;
  }
  const blob = new Blob([f.content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = f.name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  outMeta('已导出 ' + f.name + '（浏览器环境仅支持 UTF-8）');
}

/* ---------- 侧栏与菜单 ---------- */
function closeSidebar() { document.body.classList.remove('sidebar-open'); }
$('btn-menu').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
$('sidebar-mask').addEventListener('click', closeSidebar);
$('btn-run').addEventListener('click', runCurrent);
/* v5.10.0：编译 / 运行分离——用上次编译产物重跑（不再调用编译器） */
if (typeof EditorAPI !== 'undefined' && EditorAPI && EditorAPI.registerCommand) {
  EditorAPI.registerCommand('run.rerun', {
    label: t('run_rerun'), labelKey: 'run_rerun', group: 'run',
    run: function () { rerunCached(); return true; }
  });
}
/* v5.4：设置页 → 编辑 → 壁纸 */
(function bindWallpaper() {
  const b = $('mi-wallpaper');
  if (b) b.addEventListener('click', function () { $('more-menu').classList.add('hidden'); openWallpaperPanel(); });
})();
/* v5.2：顶栏搜索框（与运行同高）——点击即弹出命令面板；readonly 避免弹出软键盘 */
(function bindTitleSearch() {
  const box = $('title-search'), inp = $('title-search-input');
  if (!box) return;
  const fire = (e) => { if (e) e.preventDefault(); openQuickSearch(); };   // v5.9.0：文件 / 符号 / 全文统一搜索
  box.addEventListener('mousedown', (e) => e.preventDefault());
  box.addEventListener('click', fire);
  if (inp) { inp.addEventListener('focus', (e) => { e.target.blur(); fire(); }); }
})();
$('btn-newfile').addEventListener('click', doNewFile);
/* v4.1 资源管理器：打开文件 / 打开文件夹（与新建文件并排） */
$('btn-openfile') && $('btn-openfile').addEventListener('click', () => { closeSidebar(); openLocalFile(); });
$('btn-openfolder') && $('btn-openfolder').addEventListener('click', () => { closeSidebar(); openProjectFolder(); });
$('btn-more').addEventListener('click', (e) => { e.stopPropagation(); $('more-menu').classList.toggle('hidden'); });
/* v4.9 设置页：右上角「⋯」直接进入全屏设置界面；菜单项按四个选项卡分组（原有功能全部保留） */
function switchSettingsTab(id) {
  document.querySelectorAll('#sp-tabs .sp-tab').forEach(b => b.classList.toggle('active', b.dataset.sp === id));
  document.querySelectorAll('#more-menu .sp-panel').forEach(p => { p.hidden = p.dataset.panel !== id; });
}
document.querySelectorAll('#sp-tabs .sp-tab').forEach(b =>
  b.addEventListener('click', () => switchSettingsTab(b.dataset.sp)));
$('sp-back').addEventListener('click', () => $('more-menu').classList.add('hidden'));
/* v4.9.1 设置搜索：头部搜索框跨全部选项卡过滤设置项，点结果直达功能 */
const spSearch = $('sp-search'), spSearchPanel = $('sp-search-panel');
function spSearchReset() {
  spSearchPanel.hidden = true;
  spSearchPanel.innerHTML = '';
  const active = document.querySelector('#sp-tabs .sp-tab.active');
  document.querySelectorAll('#more-menu .sp-panel:not([data-panel="search"])')
    .forEach(p => { p.hidden = p.dataset.panel !== (active && active.dataset.sp); });
}
const SP_TAB_KEY = { edit: 'sp_tab_edit', engine: 'sp_tab_engine', file: 'sp_tab_file', general: 'sp_tab_general' };
spSearch.addEventListener('input', () => {
  const q = spSearch.value.trim().toLowerCase();
  if (!q) { spSearchReset(); return; }
  const hits = [];
  document.querySelectorAll('#more-menu .sp-panel:not([data-panel="search"])').forEach(p => {
    const tab = p.dataset.panel;
    p.querySelectorAll('button[id]').forEach(b => {
      const txt = b.textContent.trim();
      const alias = b.dataset.search || '';
      if (txt && (txt + ' ' + alias).toLowerCase().includes(q) && b.style.display !== 'none') hits.push({ tab, el: b, txt });
    });
    p.querySelectorAll('.menu-row').forEach(row => {
      const label = (row.querySelector('span') || {}).textContent || '';
      const sel = row.querySelector('select');
      if (!sel) return;
      const all = [...sel.options].map(o => o.textContent.trim()).join(' ') + ' ' + (row.dataset.search || '');
      if ((label + ' ' + all).toLowerCase().includes(q))
        hits.push({ tab, el: row, txt: label + '：' + sel.options[sel.selectedIndex].textContent.trim() });
    });
  });
  document.querySelectorAll('#more-menu .sp-panel').forEach(p => { p.hidden = p.dataset.panel !== 'search'; });
  spSearchPanel.hidden = false;
  spSearchPanel.innerHTML = '';
  if (!hits.length) {
    const empty = document.createElement('div');
    empty.className = 'sp-search-empty';
    empty.textContent = t('sp_search_none');
    spSearchPanel.appendChild(empty);
    return;
  }
  hits.forEach(h => {
    const btn = document.createElement('button');
    btn.textContent = t(SP_TAB_KEY[h.tab] || '') + ' › ' + h.txt;
    btn.addEventListener('click', () => {
      spSearch.value = '';
      spSearchReset();
      switchSettingsTab(h.tab);
      if (h.el.tagName === 'BUTTON') h.el.click();          // 直接触发原功能（原有关闭设置页逻辑照常）
      else {                                                 // 下拉类：滚到对应行并高亮
        h.el.scrollIntoView({ block: 'center' });
        h.el.style.outline = '2px solid #4f7cff';
        setTimeout(() => { h.el.style.outline = ''; }, 1500);
      }
    });
    spSearchPanel.appendChild(btn);
  });
});
// 打开/关闭设置页时清空搜索，恢复选项卡视图
function spSearchClear() { spSearch.value = ''; spSearchReset(); }
$('sp-back').addEventListener('click', spSearchClear);
$('btn-more').addEventListener('click', spSearchClear);
document.addEventListener('click', (e) => {
  if (!$('more-menu').contains(e.target) && e.target !== $('btn-more')) $('more-menu').classList.add('hidden');
});
$('mi-rename').addEventListener('click', () => { $('more-menu').classList.add('hidden'); startRename(state.active); });
$('mi-delete').addEventListener('click', () => { $('more-menu').classList.add('hidden'); doDelete(); });
$('mi-export').addEventListener('click', () => { $('more-menu').classList.add('hidden'); exportFile(); });
$('mi-font-plus').addEventListener('click', () => { $('more-menu').classList.add('hidden'); setFontSize(fontSize + 1); });
$('mi-font-minus').addEventListener('click', () => { $('more-menu').classList.add('hidden'); setFontSize(fontSize - 1); });
$('sel-cpp-engine') && $('sel-cpp-engine').addEventListener('change', (e) => {
  cppEngine = e.target.value; saveStore(); updateCppStateUi();
  outMeta('C++ 引擎已切换为：' + cppEngineName() +
    (cppEngine === 'online' ? '（在线真实编译，需联网）' : ''));
});
$('sel-cpp-compiler') && $('sel-cpp-compiler').addEventListener('change', (e) => {
  cppCompiler = e.target.value; saveStore(); updateCppStateUi();
  outMeta('C++ 编译器已切换为：' + cppCompiler);
});
$('sel-py-engine') && $('sel-py-engine').addEventListener('change', (e) => {
  pyEngine = e.target.value; saveStore(); updateCppStateUi();
  outMeta(pyEngine === 'online' ? t('py_online_switch')
    : pyEngine === 'termux' ? t('py_termux_switch')
    : t('py_pyodide_switch'));
});
$('mi-run-tty').addEventListener('click', () => {
  $('more-menu').classList.add('hidden');
  if (!editorReady) return;
  if (!guardTermux()) return;   // v4.9：未装 Termux 时取消所有 Termux 编译项目
  if (!window.Android || !Android.runInTermuxTerminal) { outAppend(t('only_android'), 'out-err'); return; }
  const lang = langOf(state.active);
  if (lang !== 'cpp') { outAppend('请在 .cpp/.c 文件中使用此功能。\n', 'out-err'); return; }
  saveStore();
  const ok = Android.runInTermuxTerminal(state.active, cm.state.doc.toString(), cppCompiler);
  outMeta(ok ? '已在 Termux 终端中打开编译运行会话，请切换到 Termux 与程序交互。'
             : '启动失败：请先完成环境向导配置。');
});
const DEV_EMAIL = '19587486395@163.com';
function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}
function copyDevEmail() {
  if (window.Android && Android.copyText) { Android.copyText(DEV_EMAIL); return true; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(DEV_EMAIL).catch(() => fallbackCopyText(DEV_EMAIL));
  } else fallbackCopyText(DEV_EMAIL);
  return true;
}
$('mi-env-dl').addEventListener('click', () => {
  $('more-menu').classList.add('hidden');
  $('dl-email-tip').classList.remove('show');
  $('dl-modal').classList.remove('hidden');
});
$('dl-github').addEventListener('click', () => {
  $('dl-modal').classList.add('hidden');
  if (window.Android && Android.openTermuxDownload) Android.openTermuxDownload();
  else window.open('https://github.com/termux/termux-app/releases', '_blank');
});
$('dl-email').addEventListener('click', () => {
  copyDevEmail();
  $('dl-email-tip').classList.add('show');
});
$('dl-close').addEventListener('click', () => $('dl-modal').classList.add('hidden'));
const INIT_CMDS = [
  'echo "deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main" > $PREFIX/etc/apt/sources.list',
  'apt update -y',
  'termux-setup-storage',
  'mkdir -p ~/.termux',
  'echo "allow-external-apps=true" >> ~/.termux/termux.properties',
  'termux-reload-settings',
  'pkg install -y clang',
  "echo ''; echo '== 初始化完成，请返回轻码编辑器 =='"
];
function guideStoragePermission() {
  showModal({
    title: t('perm_title'), withInput: false, okText: t('perm_ok'),
    desc: t('perm_desc')
  });
  modalMode = 'perm';
}
/* v4.8 环境配置对话框（C++ / Python 双选项卡）+ 启动自动检测注入 */
function openCfgModal(tab) {
  $('more-menu').classList.add('hidden');
  switchCfgTab(tab || 'cpp');
  $('init-modal').classList.remove('hidden');
}
function switchCfgTab(tab) {
  document.querySelectorAll('#cfg-tabs .ab-tab').forEach(b => b.classList.toggle('active', b.dataset.cfg === tab));
  $('cfg-cpp-panel').classList.toggle('hidden', tab !== 'cpp');
  $('cfg-py-panel').classList.toggle('hidden', tab !== 'py');
}
document.querySelectorAll('#cfg-tabs .ab-tab').forEach(b =>
  b.addEventListener('click', () => switchCfgTab(b.dataset.cfg)));

/* v4.11.1：清华镜像源命令（与配置对话框向导完全一致）——自动安装前先切源，国内下载提速数倍 */
const APT_TUNA_CMD =
  'echo "deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main stable main" > $PREFIX/etc/apt/sources.list';
const PIP_TUNA_CMD = 'pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple';
/** 构造安装命令：v4.11.1 起自动带上清华源——src:missing 时先切 apt 源 + apt update（旧索引仍指向官方源，不换索引下载不提速），
 *  装 python 的命令尾部顺带配置 pip 清华源（一次执行全部搞定）。全分号串联：单段失败不阻断后续。 */
function buildInstallCmd(kind, needSrc) {
  const pre = needSrc ? (APT_TUNA_CMD + '; apt update -y; ') : '';
  return pre + (kind === 'py'
    ? ('pkg install -y python; ' + PIP_TUNA_CMD + ' 2>/dev/null; true')
    : 'pkg install -y clang');
}
/** v4.8/v4.9/v4.11：检测 Termux 中 python / clang 是否可用，缺失则自动注入安装命令。
 *  manual=true：由配置对话框触发，输出详细过程，注入后立即返回（不等安装）。
 *  manual=false：启动期调用；opts = { onProgress(pct,key) }。
 *  v4.11 起启动页不再等待安装——检测并（缺失时）发起安装后立即返回，后续安装进度、
 *  失败重试、后装 Termux 的接管全部由 startTermuxGuard() 后台守护循环负责。
 *  v4.11.1：检测顺带报告 apt 源 / pip 源是否为清华镜像，安装命令自动先切源（国内加速）。
 *  返回 { ready, absent, failed, bg }。 */
/**
 * v5.10.1 安全（审查 P0-2）：后台环境检测不该触发「执行 Termux 命令」的确认弹窗，
 * 因此优先走原生固定探针（不接受参数，输出到固定文件）；老版本原生没有该接口时回退 runCapture。
 */
async function termuxProbeRun() {
  if (window.Android && Android.probeTermuxEnv && Android.readEnvProbe) {
    try {
      if (!Android.probeTermuxEnv()) return { code: -1, output: '' };
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        await new Promise(function (r) { setTimeout(r, 400); });
        const out = Android.readEnvProbe() || '';
        if (out.indexOf('DONE') >= 0) return { code: 0, output: out };
      }
      return { code: -1, output: '' };
    } catch (e) { /* 回退 */ }
  }
  return window.PCPluginAPI.runCapture(TERMUX_PROBE);
}

const TERMUX_PROBE =
  'echo py:$(command -v python >/dev/null 2>&1 && echo ok || echo missing);' +
  'echo cpp:$(command -v clang >/dev/null 2>&1 && echo ok || echo missing);' +
  'echo src:$(grep -qs "mirrors.tuna.tsinghua.edu.cn" "$PREFIX/etc/apt/sources.list" && echo ok || echo missing);' +
  'echo pip:$(command -v pip >/dev/null 2>&1 && (pip config get global.index-url 2>/dev/null | grep -qs tuna) && echo ok || echo missing)';
let termuxSetupBusy = false;
async function autoTermuxSetup(manual, opts) {
  opts = opts || {};
  const onP = (pct, key) => { try { if (opts.onProgress) opts.onProgress(pct, key); } catch (e) {} };
  const res = { ready: false, absent: false, failed: false, bg: false };
  if (termuxSetupBusy) { if (manual) outMeta('正在检测中，请稍候…'); onP(100, 'splash_tx_none'); res.absent = true; return res; }
  if (!(window.Android && Android.execTermux && Android.readSwapFile && Android.writeSwapFile)) {
    if (manual) outAppend(t('only_android'), 'out-err');
    onP(100, 'splash_tx_none'); res.absent = true; return res;
  }
  if (!(termuxEnv && termuxEnv.termux)) {
    if (manual) { outAppend(t('termux_missing'), 'out-err'); probeTermux(); }
    onP(100, 'splash_tx_none'); res.absent = true; return res;
  }
  termuxSetupBusy = true;
  try {
    outMeta(manual
      ? (LANG === 'en' ? 'Checking Termux environment (python / clang)…' : '正在检测 Termux 环境（python / clang）…')
      : (LANG === 'en' ? 'Checking Termux env in background…' : '正在后台检测 Termux 环境（python / clang）…'));
    onP(10, 'splash_tx_check');
    const r = await termuxProbeRun();
    const out = (r && r.output) || '';
    const pyOk = /py:ok/.test(out), cppOk = /cpp:ok/.test(out);
    const needPy = /py:missing/.test(out), needCpp = /cpp:missing/.test(out);
    const needSrc = /src:missing/.test(out);                       // v4.11.1：apt 源非清华
    const needPipCfg = pyOk && /pip:missing/.test(out);            // v4.11.1：python 已装但 pip 源未配清华
    if (r && r.code === 0 && (pyOk || cppOk || needPy || needCpp)) {
      const parts = [];
      if (pyOk) parts.push('Python ✓'); else if (needPy) parts.push(LANG === 'en' ? 'Python missing' : 'Python 缺失');
      if (cppOk) parts.push('clang ✓'); else if (needCpp) parts.push(LANG === 'en' ? 'clang missing' : 'clang 缺失');
      outMeta('[Termux 环境] ' + parts.join(' · '));
      if (needSrc && (needPy || needCpp)) {
        outAppend(LANG === 'en'
          ? '[Termux] Switching apt mirror to Tsinghua (China mirror — much faster downloads)…\n'
          : '[Termux 环境] 检测到未使用清华源——安装前自动切换（清华镜像，国内下载提速数倍）。\n', 'out-echo');
      }
      if (needPy) {
        outAppend(LANG === 'en'
          ? '[Termux] Python missing — auto-installing in background (Tsinghua mirror, online, ~1-3 min). No waiting needed — engines become available automatically when done.\n'
          : '[Termux 环境] Python 未安装，已在后台自动安装（清华源，联网，约 1~3 分钟，顺带配置 pip 清华源）。无需等待，装好后引擎自动可用。\n', 'out-echo');
        Android.execTermux(buildInstallCmd('py', needSrc), true);
      }
      if (needCpp) {
        outAppend(LANG === 'en'
          ? '[Termux] clang missing — auto-installing in background (Tsinghua mirror, online, ~1-3 min). No waiting needed.\n'
          : '[Termux 环境] clang 未安装，已在后台自动安装（清华源，联网，约 1~3 分钟）。无需等待。\n', 'out-echo');
        Android.execTermux(buildInstallCmd('cpp', needSrc), true);
      }
      if (needPipCfg) {
        outAppend(LANG === 'en'
          ? '[Termux] pip index not on Tsinghua mirror — switching in background (faster pip install in China).\n'
          : '[Termux 环境] pip 源未配置清华镜像——已在后台自动切换（国内 pip install 提速）。\n', 'out-echo');
        Android.execTermux(PIP_TUNA_CMD + ' 2>/dev/null; true', true);
      }
      if (manual && !needPy && !needCpp && !needPipCfg) {
        outMeta(LANG === 'en' ? '[Termux] All set, nothing to configure.' : '[Termux 环境] 全部就绪，无需配置。');
        onP(100, 'splash_tx_ready'); res.ready = true; return res;
      }
      if (needPy || needCpp) {
        // v4.11：安装发起后立即转后台守护循环——启动页不等安装完成
        onP(100, 'splash_tx_bg');
        res.bg = true;
      }
      return res;
    } else if (manual) {
      outAppend(LANG === 'en'
        ? '[Termux] Check failed: Termux may be initializing or unresponsive. Open Termux, run any command once, then retry.\n'
        : '[Termux 环境] 检测失败：Termux 可能正在初始化或无响应。请打开 Termux 手动执行一次命令后重试。\n', 'out-err');
      onP(-1, 'splash_tx_fail');
    } else {
      // v4.11：非手动检测失败不再标红卡进度——后台守护循环会持续自动重试
      console.warn('[env] auto check skipped/failed, code=', r && r.code);
      onP(100, 'splash_tx_bg'); res.failed = true;
    }
  } catch (e) { console.warn('[env] autoTermuxSetup error', e); onP(100, 'splash_tx_bg'); res.failed = true; }
  finally { termuxSetupBusy = false; }
  return res;
}

/* ---------- v4.11：Termux 引擎后台守护循环（检测→安装→重试→就绪，全程零等待） ----------
 *  每 45s 一轮：未装 Termux 时空转（装上后自动接管）；检测失败静默下轮重试；
 *  组件缺失则幂等补发安装（dpkg 对已装包为 no-op，Termux 队列串行不会并发冲突），
 *  安装中断/断网 15 分钟未完成自动重发；全部就绪后刷新引擎可用性、提示一次并停止循环。
 *  运行时脚本内的自动安装兜底保留（双保险）。 */
const termuxGuard = { timer: null, busy: false, state: 'init', injectedAt: 0 };
function startTermuxGuard() {
  if (termuxGuard.timer) return;
  termuxGuard.timer = setInterval(termuxGuardTick, 45000);
  termuxGuardTick();
}
async function termuxGuardTick() {
  if (termuxGuard.busy || termuxSetupBusy) return;
  if (!(window.Android && Android.getEnv && Android.execTermux && Android.readSwapFile && Android.writeSwapFile)) return;
  // 静默刷新 Termux 安装状态（不调 probeTermux，避免重渲染编辑器打断输入法）；后装 Termux 的用户自动接管
  try {
    const env = JSON.parse(Android.getEnv());
    const changed = !!env.termux !== !!(termuxEnv && termuxEnv.termux);
    termuxEnv = env;
    if (changed) { applyTermuxAvailability(); termuxGuard.state = 'init'; }
  } catch (e) { }
  if (!(termuxEnv && termuxEnv.termux)) return;
  termuxGuard.busy = true;
  try {
    let r = null;
    try { r = await termuxProbeRun(); } catch (e) { r = null; }
    const out = (r && r.output) || '';
    // 检测失败 / Termux 忙（命令排队）：本轮放弃，下一轮自动重试
    if (!(r && r.code === 0 && /py:(ok|missing)/.test(out) && /cpp:(ok|missing)/.test(out))) return;
    const needPy = /py:missing/.test(out), needCpp = /cpp:missing/.test(out);
    const needSrc = /src:missing/.test(out);                    // v4.11.1：apt 源非清华
    const needPipCfg = !needPy && /py:ok/.test(out) && /pip:missing/.test(out);   // v4.11.1
    if (!needPy && !needCpp) {
      if (needPipCfg) {
        // v4.11.1：python 已装但 pip 源未配清华——秒级幂等命令，直接补上（不受 installing 状态机限制）
        Android.execTermux(PIP_TUNA_CMD + ' 2>/dev/null; true', true);
      }
      if (!needPipCfg && termuxGuard.state !== 'ok') {
        const wasInstalling = termuxGuard.state === 'installing';
        try { probeTermux(); } catch (e) {}   // 刷新引擎下拉可用状态（此刻无输入法冲突风险）
        if (wasInstalling) {
          outMeta(LANG === 'en' ? '[Termux] Background install finished — Python / C++ engines ready.'
                                : '[Termux 环境] 后台安装完成，Python / C++ 引擎已就绪。');
          outAppend(LANG === 'en'
            ? '[Termux] Engines ready — real C++ compile and Termux Python are now available.\n'
            : '[Termux 环境] 引擎就绪——真实 C++ 编译与 Termux Python 现已可用。\n', 'out-echo');
        }
        termuxGuard.state = 'ok';
        clearInterval(termuxGuard.timer); termuxGuard.timer = null;   // 全部就绪 → 停止守护（运行时兜底仍在）
      }
      return;
    }
    if (termuxGuard.state !== 'installing') {
      termuxGuard.state = 'installing';
      termuxGuard.injectedAt = Date.now();
      outAppend(LANG === 'en'
        ? (needSrc
          ? '[Termux] python/clang missing — switching to Tsinghua mirror and installing in background (auto-retry every 45s, engines ready automatically when done, no waiting needed).\n'
          : '[Termux] python/clang missing — installing in background (Tsinghua mirror, auto-retry every 45s, engines ready automatically when done, no waiting needed).\n')
        : (needSrc
          ? '[Termux 环境] Python / clang 缺失——已自动切换清华源并在后台安装（每 45 秒自动复检，装好后引擎自动可用，无需等待）。\n'
          : '[Termux 环境] Python / clang 缺失——已在后台安装（清华源，每 45 秒自动复检，装好后引擎自动可用，无需等待）。\n'), 'out-echo');
      if (needPy) Android.execTermux(buildInstallCmd('py', needSrc), true);
      if (needCpp) Android.execTermux(buildInstallCmd('cpp', needSrc), true);
    } else if (Date.now() - termuxGuard.injectedAt > 900000) {
      // 15 分钟仍未完成：安装大概率中断/断网——重新发起（dpkg 幂等，重复执行无害）
      termuxGuard.injectedAt = Date.now();
      outAppend(LANG === 'en'
        ? '[Termux] Still missing after 15 min — re-issuing install (offline or interrupted?).\n'
        : '[Termux 环境] 组件 15 分钟仍未装好——已重新发起安装（可能断网或安装中断）。\n', 'out-echo');
      if (needPy) Android.execTermux(buildInstallCmd('py', needSrc), true);
      if (needCpp) Android.execTermux(buildInstallCmd('cpp', needSrc), true);
    }
  } finally { termuxGuard.busy = false; }
}
$('mi-cfg-cpp').addEventListener('click', () => openCfgModal('cpp'));
$('mi-cfg-py').addEventListener('click', () => openCfgModal('py'));
$('cfg-recheck').addEventListener('click', () => { autoTermuxSetup(true).then(() => probeTermux()); });
$('init-open').addEventListener('click', () => {
  if (window.Android && Android.initTermux) Android.initTermux();
  else outAppend('该功能仅在安卓应用内可用。请手动打开 Termux，按顺序逐条执行（一条执行完再复制下一条）：\n'
    + INIT_CMDS.map((c, i) => (i + 1) + '. ' + c).join('\n') + '\n', 'out-err');
});
$('init-close').addEventListener('click', () => $('init-modal').classList.add('hidden'));
$('mi-dbg-log').addEventListener('click', () => {
  $('more-menu').classList.add('hidden');
  if (!(window.Android && Android.getLogs)) { outAppend('日志功能仅在安卓应用内可用。\n', 'out-err'); return; }
  if (Android.appendLog) Android.appendLog('js', 'export logs; engine=' + cppEngine
      + '; termuxEnv=' + JSON.stringify(termuxEnv) + '; appVer=' + APP_VERSION);
  const t = Android.getLogs();
  outAppend('===== 调试日志（最近 500 条） =====\n' + t + '===== 日志结束 =====\n', 'out-echo');
  let saved = '';
  try { if (Android.exportLogs) saved = Android.exportLogs(); } catch (e) { saved = ''; }
  if (Android.copyText) { Android.copyText(t); outMeta('日志已复制到剪贴板；已保存到 下载/' + saved
      + '；实时日志文件在 /sdcard/QingCode/.app.log'); }
});
$('mi-reset').addEventListener('click', () => {
  $('more-menu').classList.add('hidden');
  showModal({ title: t('reset_title'), withInput: false, okText: t('reset_ok'), desc: t('reset_desc') });
  modalMode = 'reset';
});
/* v4.0 菜单：项目空间 / 编码 / 自动保存 / Termux 会话 */
$('mi-open-folder') && $('mi-open-folder').addEventListener('click', () => {
  $('more-menu').classList.add('hidden');
  openProjectFolder();
});
/* v5.10.0：SAF 工作区——系统目录选择器授权，普通编辑不再依赖「所有文件访问」 */
$('mi-open-saf') && $('mi-open-saf').addEventListener('click', () => {
  $('more-menu').classList.add('hidden');
  openSafWorkspace();
});
$('mi-open-file') && $('mi-open-file').addEventListener('click', () => {
  $('more-menu').classList.add('hidden');
  openLocalFile();
});
$('mi-close-project') && $('mi-close-project').addEventListener('click', () => {
  $('more-menu').classList.add('hidden');
  closeProject();
});
$('mi-autosave') && $('mi-autosave').addEventListener('click', () => {
  $('more-menu').classList.add('hidden');
  autoSaveOn = !autoSaveOn; saveStore(); syncProjectMenu();
  if (autoSaveOn) { autoSaveProject(true); }
  else outMeta(t('autosave_disabled'));
});
$('mi-term-session') && $('mi-term-session').addEventListener('click', () => {
  $('more-menu').classList.add('hidden');
  if (!guardTermux()) return;   // v4.9：未装 Termux 时取消所有 Termux 编译项目
  toggleTermSession();
});
$('mi-save-all') && $('mi-save-all').addEventListener('click', () => {
  $('more-menu').classList.add('hidden');
  if (!projectMode()) { outMeta(t('not_in_project')); return; }
  autoSaveProject(true);
});
(() => {
  const se = document.getElementById('sel-encoding');
  if (!se) return;
  se.innerHTML = ENCODINGS.map(e =>
    `<option value="${e}"${e === exportEncoding ? ' selected' : ''}>${e}</option>`).join('');
  se.addEventListener('change', () => {
    exportEncoding = se.value; saveStore();
    outMeta(t('enc_switched') + exportEncoding + t('enc_switched2'));
  });
})();
/* ---------- 关于对话框（logo + 版本号 + 选项卡） ---------- */
function aboutTabHtml(key) { return key === 'tos' ? t('about_tos') : key === 'credits' ? t('about_credits') : t('about_dev'); }
function showAboutTab(key) {
  document.querySelectorAll('.ab-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === key));
  $('about-body').innerHTML = aboutTabHtml(key);
}
$('mi-lang') && $('mi-lang').addEventListener('click', () => {
  $('more-menu').classList.add('hidden');
  showLangDialog(true);
});
$('mi-about').addEventListener('click', () => {
  $('more-menu').classList.add('hidden');
  $('about-ver').textContent = 'v' + APP_VERSION;
  showAboutTab('tos');
  const note = $('about-note');
  let ok = false;
  if (window.Android && Android.sourcesReady) {
    try { ok = Android.sourcesReady() === 'ok'; } catch (e) {}
  }
  note.textContent = ok ? t('src_ready') : t('src_pending');
  $('about-mask').classList.remove('hidden');
});
document.querySelectorAll('.ab-tab').forEach(b => b.addEventListener('click', () => showAboutTab(b.dataset.tab)));
$('about-close').addEventListener('click', () => $('about-mask').classList.add('hidden'));
$('about-mask').addEventListener('click', (e) => { if (e.target === $('about-mask')) $('about-mask').classList.add('hidden'); });
function setFontSize(v) {
  fontSize = Math.max(10, Math.min(28, v));
  if (cm) PCCM.setFontSize(cm, fontSize);
  $('status-size').textContent = t('font') + ' ' + fontSize;
  saveStore();
}
/** v5.9.0：缩进宽度（空格数），2–8 */
function setTabSize(v) {
  tabSize = Math.max(2, Math.min(8, v));
  if (cm) { try { PCCM.setTabSize(cm, tabSize); } catch (e) {} }
  saveStore();
}
/** 控制面板用：从设置页的 <select> 取选项，切换时复用同一套 change 处理 */
function engineOptions(selectId) {
  const sel = $(selectId);
  if (!sel) return [];
  return [...sel.options].map(function (o) { return { value: o.value, label: o.textContent }; });
}
function setEngineValue(selectId, v) {
  const sel = $(selectId);
  if (!sel) return;
  sel.value = v;
  sel.dispatchEvent(new Event('change'));
}

const _modalOk = modalOk;
$('modal-ok').addEventListener('click', () => {
  if (modalMode === 'plugin-del') {
    hideModal();
    const file = pendingPluginFile; pendingPluginFile = null;
    if (!file) return;
    if (!(window.Android && Android.deletePlugin)) { outAppend(t('only_android'), 'out-err'); return; }
    const ok = Android.deletePlugin(file);
    if (ok) {
      PluginHost.loaded = PluginHost.loaded.filter(x => x.__file !== file);
      PluginHost.skipped = (PluginHost.skipped || []).filter(x => x !== file);
      PluginHost.disabledBuiltin = (PluginHost.disabledBuiltin || []).filter(x => x !== file);
      if (PluginHost.blocked) delete PluginHost.blocked[file];
      pluginInfos.delete(file);
      PluginTrust.revoke(file);     // v5.8.0：删除 = 撤销授权 + 删除私有副本
      setPluginDisabled(file, false);
      try { localStorage.setItem('pc_builtin_disabled', JSON.stringify(PluginHost.disabledBuiltin)); } catch (e) {}
      renderToolbar(); pcApplyExts();
      outMeta(t('pp_del_done') + file);
      openPluginPage();
    } else outAppend(t('pp_del_fail') + '\n', 'out-err');
    return;
  }
  if (modalMode === 'plugin-sandbox-off') {
    hideModal();
    const file = pendingPluginFile; pendingPluginFile = null;
    if (!file) return;
    SandboxHost.setSandbox(file, false);   /* 关闭沙箱 = 加入主线程白名单 */
    try { if (window.Android && Android.showToast) Android.showToast(t('pp_sandbox_restart')); } catch (e) {}
    openPluginPage();
    return;
  }
  if (modalMode === 'perm') {
    hideModal();
    if (window.Android && Android.openAllFilesAccess) Android.openAllFilesAccess();
    else outAppend('请在系统设置 → 应用 → 轻码编辑器 → 权限中开启「所有文件访问」。\n', 'out-err');
    return;
  }
  if (modalMode === 'reset') {
    const defs = [['main.py', PY_DEFAULT_CODE], ['hello.cpp', CPP_DEFAULT_CODE]];
    for (const [n, code] of defs) {
      const f = state.files.find(x => x.name === n);
      if (f) f.content = code; else state.files.push({ name: n, content: code });
    }
    if (state.active === 'main.py' || state.active === 'hello.cpp') openFile(state.active);
    renderFileList(); saveStore(); hideModal();
    return;
  }
  if (modalMode === 'info') { hideModal(); return; }
  _modalOk();
});
$('modal-cancel').addEventListener('click', hideModal);
$('modal-mask').addEventListener('click', (e) => { if (e.target === $('modal-mask')) hideModal(); });
$('modal-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('modal-ok').click(); });

/* ---------- 面板 ---------- */
$('ptab-output') && $('ptab-output').addEventListener('click', function () { switchPanelTab('term'); });
$('ptab-log') && $('ptab-log').addEventListener('click', function () { switchPanelTab('log'); });
$('ptab-problems') && $('ptab-problems').addEventListener('click', function () { switchPanelTab('problems'); });
$('btn-clear-out').addEventListener('click', outClear);
$('btn-panel-toggle').addEventListener('click', () => {
  $('bottom-panel').classList.toggle('collapsed');
  setTimeout(() => cm && cm.requestMeasure(), 200);
});
/* v5.7.0：标签的关闭按钮改为 renderTabs() 内逐个绑定，这里不再固定绑 #tab-close */

/* ============================================================
 * v5.9.0：可配置键条（Esc / Tab / 方向键 / 符号）
 * 数据存 localStorage：pc_keybar = 'on' | 'off'，pc_keybar_keys = ["(", ...]
 * ============================================================ */
const KEYBAR_DEFAULT = ['Esc', 'Tab', '←', '↑', '↓', '→', '(', ')', '[', ']', '{', '}', '<', '>', ':', '"', "'", '=', '+', '-', '*', '/', '#', '_', '.', ':'];
function keybarEnabled() { return localStorage.getItem('pc_keybar') === 'on'; }
function keybarKeys() {
  try {
    const v = JSON.parse(localStorage.getItem('pc_keybar_keys') || 'null');
    if (Array.isArray(v) && v.length) return v;
  } catch (e) {}
  return KEYBAR_DEFAULT;
}
function setKeybarEnabled(on) {
  try { localStorage.setItem('pc_keybar', on ? 'on' : 'off'); } catch (e) {}
  renderKeybar();
}
function renderKeybar() {
  const bar = $('keybar');
  if (!bar) return;
  const on = keybarEnabled();
  bar.classList.toggle('hidden', !on);
  if (!on) return;
  bar.innerHTML = '';
  keybarKeys().forEach(function (k) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'kb-btn'; b.textContent = k;
    b.addEventListener('mousedown', function (e) { e.preventDefault(); });   // 不抢编辑器焦点
    b.addEventListener('click', function () { keybarPress(k); });
    bar.appendChild(b);
  });
}
function keybarPress(k) {
  if (!cm) return;
  if (k === 'Esc') { closePalette(); try { document.activeElement.blur(); } catch (e) {} return; }
  if (k === 'Tab') {
    const ok = EditorAPI.runCommand('edit.indentMore');
    if (!ok) { try { cm.dispatch(cm.state.replaceSelection(' '.repeat(tabSize))); } catch (e) {} }
    cm.focus(); return;
  }
  if (k === '←' || k === '→' || k === '↑' || k === '↓') {
    const sel = cm.state.selection.main;
    const doc = cm.state.doc;
    const line = doc.lineAt(sel.head);
    const col = sel.head - line.from;
    let pos = sel.head;
    if (k === '←') pos = Math.max(0, sel.head - 1);
    else if (k === '→') pos = Math.min(doc.length, sel.head + 1);
    else if (k === '↑' || k === '↓') {
      const targetNo = line.number + (k === '↑' ? -1 : 1);
      if (targetNo >= 1 && targetNo <= doc.lines) {
        const tl = doc.line(targetNo);
        pos = tl.from + Math.min(col, tl.length);   // 保持列位，短行夹到行尾
      }
    }
    cm.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    cm.focus(); return;
  }
  try { cm.dispatch(cm.state.replaceSelection(k)); } catch (e) {}
  cm.focus();
}

/* v5.9.0：软键盘适配——用 visualViewport 算出键盘占位，收起时让出空间但不挡住输入行 */
(function bindKeyboardInsets() {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = function () {
    const kb = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
    document.documentElement.style.setProperty('--kb', kb + 'px');
    document.body.classList.toggle('kb-open', kb > 80);
    if (kb <= 80) { try { cm && cm.requestMeasure(); } catch (e) {} }
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
})();

/* ---------- 快捷键 ---------- */
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') { e.preventDefault(); runCurrent(); return; }
  if (e.key === 'F5') { e.preventDefault(); runCurrent(); return; }
  if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveStore(); outMeta('已保存 ✓'); return; }
  /* v5.9.0：外接键盘常用快捷键 */
  if (mod && !e.shiftKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); openQuickSearch(); return; }
  if (mod && e.shiftKey && (e.key === 'P' || e.key === 'p')) { e.preventDefault(); openCommandPalette(''); return; }
  if (mod && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    if (window.PCPluginAPI && PCPluginAPI.nav) PCPluginAPI.nav.search('');
    else openCommandPalette('nav.');
    return;
  }
  if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); document.body.classList.toggle('sidebar-open'); return; }
  if (mod && (e.key === '`' || e.key === '\'')) { e.preventDefault(); $('bottom-panel').classList.toggle('collapsed'); return; }
  if (mod && (e.key === '/' || e.key === '?')) { e.preventDefault(); EditorAPI.runCommand('line.comment'); return; }
});

/* ---------- 启动 ---------- */
/* v5.7.0：退出 / 切后台前立即把工作区元数据落盘（saveWorkspaceMeta 有 500ms 合并窗口） */
window.addEventListener('pagehide', () => { try { flushWorkspaceMeta(); } catch (e) {} });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { try { flushWorkspaceMeta(); } catch (e) {} }
});
(async function boot() {
  $('status-size').textContent = '字号 ' + fontSize;
  $('app-title').textContent = '轻码编辑器 v' + APP_VERSION;
  renderFileList();
  renderTabs();     // v5.7.0：先按上次的标签集合出标签栏，编辑器就绪后 openFile 会再刷新
  renderKeybar();   // v5.9.0：按用户设置显示常用键条
  renderProblems(); // v5.9.0：问题面板（初始为空）
  updateCppStateUi();
  probeTermux();
  syncProjectMenu();
  startAutoSaveLoop();
  try {
    await initEditor();
  } catch (e) {
    console.error(e);
    $('welcome').classList.remove('hidden');
    outAppend((LANG === 'en' ? 'Editor init failed: ' : '编辑器初始化失败：') + (e.message || e) + '\n', 'out-err');
  }
  // v4.2 语言：已选过则应用（未选等启动页结束后再弹，首启启动页先以默认语言显示）
  if (LANG) applyLang();
  /* v5.5.0：恢复上次工作区放在这里——与 Python 加载并行，不等 Termux 检测（那可能耗时 2 分钟）；
     编辑器此时已就绪，readProject 回调回来即可直接填充文件列表。 */
  try { restoreWorkspace(); } catch (e) { console.warn('[workspace] restore failed', e); }
  // v4.4 插件加载（/sdcard/QingCode/plugins/*.js；无存储权限或无插件时自动跳过）
  try { await loadBuiltinPlugins(); } catch (e) { console.warn('[builtin]', e); }
  try { await loadPlugins(); } catch (e) { console.warn('[plugins]', e); }
  // v4.9 启动页：双引擎顺序加载——先 Python（Pyodide），就绪后才检测/编译 C++ 的 Termux，
  // 双条全部完成后才进入主界面（取代 v4.8 的 2.5s 后台静默检测）
  const spVer = $('splash-ver');
  if (spVer) spVer.textContent = 'v' + APP_VERSION;
  if (pyodide) splashSet('py', 100, 'splash_done');
  let pyOk = false;
  try {
    pyOk = await Promise.race([
      ensurePyodide({ onProgress: (pct, key) => splashSet('py', pct, key) }),
      new Promise(r => setTimeout(() => r('timeout'), 90000)),  // 90s 超时兜底
    ]);
  } catch (e) { pyOk = false; }
  if (pyOk === true && pyEngineReady()) {
    splashSet('py', 100, 'splash_done');
  } else if (pyOk !== true) {
    // 失败或超时：py 条红 ✕ + 显示「跳过进入」按钮；后台若仍在加载，进入后照常可用
    if (pyState !== 'error' || !pyEngineReady()) splashSet('py', -1, 'splash_fail');
  }
  // Python 引擎阶段结束（成败均算）→ 才开始 C++ Termux 引擎阶段：
  // v4.11 起只做「检测 + （缺失时）发起安装」即通过——启动页不再等待安装完成，
  // 安装进度 / 失败重试 / 后装 Termux 的接管全部交给 startTermuxGuard() 后台守护循环；
  // 未装 Termux / 桥不可用秒过
  const txStage = autoTermuxSetup(false, {
    onProgress: (pct, key) => splashSet('cpp', pct, key),
  }).catch(() => null);
  // v4.9.2：C++（Termux）阶段持续 15s 未完成 → 显示「手动打开 Termux 后重开编辑器」提示；
  // 正常完成 / 未装 Termux 秒过时不打扰（计时器被清除）
  const txHint = $('splash-cpp-hint');
  const txHintTimer = setTimeout(() => { if (txHint) txHint.classList.remove('hidden'); }, 15000);
  txStage.then(() => {
    clearTimeout(txHintTimer);
    if (txHint) txHint.classList.add('hidden');
    startTermuxGuard();   // v4.11：启动后台守护循环（45s 复检：缺装→装、失败→重试、装好→刷新引擎并停止）
    // v4.9：未检测到 Termux —— 提示仅可使用部分功能（Termux 相关引擎已被禁用）
    if (termuxMissing && window.Android) {
      outAppend('⚠ ' + t('termux_missing_banner') + '\n', 'out-err');
      outMeta(t('termux_missing_banner'));
    }
    if (!LANG) showLangDialog(false);  // 首启语言选择（启动页结束后弹出）
    setTimeout(splashHide, 600);       // 短暂停留让用户看到双条完成态
  });
})();
