/* ============================================================
 * 轻码编辑器 QingCode v3.0
 * CodeMirror 6 + Pyodide(Python WASM) + Termux Clang/GCC(交互式真实编译)
 * v3.0：交互式终端（对话框输入 / FIFO 管道实时交互 + 流式输出）
 *       启动提速（Pyodide 预加载 + assets 缓存 + md5 编译缓存）
 *       依赖自动安装（编译器缺失自动 pkg install + 环境向导）
 * ============================================================ */
'use strict';

/* ---------- 常量 ---------- */
const APP_VERSION = '4.11.2';
const PYODIDE_VERSION = '0.26.4';
const PY_BASES = ['pyodide/', 'https://cdn.jsdelivr.net/pyodide/v' + PYODIDE_VERSION + '/full/'];
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
let cppEngine = localStorage.getItem('pc_cpp_engine') || 'auto';
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
function loadStore() {
  let files;
  try { files = JSON.parse(localStorage.getItem('pc_files') || 'null'); } catch { files = null; }
  if (!files || !files.length) {
    files = [
      { name: 'main.py', content: PY_DEFAULT_CODE },
      { name: 'hello.cpp', content: CPP_DEFAULT_CODE }
    ];
  }
  let active = localStorage.getItem('pc_active');
  if (!files.some(f => f.name === active)) active = files[0].name;
  return { files, active };
}
function saveStore() {
  try {
    localStorage.setItem('pc_files', JSON.stringify(state.files));
    localStorage.setItem('pc_active', state.active || '');
    localStorage.setItem('pc_fontsize', String(fontSize));
    localStorage.setItem('pc_cpp_engine', cppEngine);
    localStorage.setItem('pc_cpp_compiler', cppCompiler);
    localStorage.setItem('pc_py_engine', pyEngine);
    localStorage.setItem('pc_encoding', exportEncoding);
    localStorage.setItem('pc_autosave', autoSaveOn ? 'on' : 'off');
  } catch (e) { console.warn('save failed', e); }
}

/* ---------- 语言 ---------- */
function langOf(name) {
  const n = name.toLowerCase();
  if (n.endsWith('.py')) return 'python';
  if (n.endsWith('.cpp') || n.endsWith('.cc') || n.endsWith('.cxx') ||
      n.endsWith('.hpp') || n.endsWith('.h') || n.endsWith('.c')) return 'cpp';
  return null;
}
function langLabel(lang) { return lang === 'python' ? 'Python' : lang === 'cpp' ? 'C++' : '文本'; }

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
function outAppend(text, cls) {
  const log = $('output-log');
  const hint = log.querySelector('.out-hint'); if (hint) hint.remove();
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  log.appendChild(span);
  $('output-view').scrollTop = $('output-view').scrollHeight;
}
function outClear() { $('output-log').innerHTML = '<span class="out-hint">' + t('out_hint_ready') + '</span>'; }
function outMeta(text) { outAppend(text + '\n', 'out-meta'); }
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
    return navigator.onLine === false ? 'jscpp' : 'online';   // 无 Termux 且有网 → 在线
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
  if (state.active) openFile(state.active);
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
/** 同步获取一行输入：安卓原生对话框 / 浏览器 prompt；取消 => EOF('') */
function interactInput(promptText) {
  let v;
  if (window.Android && Android.requestInput) {
    v = Android.requestInput(promptText || '程序请求输入', '');
  } else {
    v = window.prompt(promptText || '程序请求输入：');
  }
  const isEof = (v === null || v === undefined);   // v4.11.2：区分「取消（EOF）」与「输入空行」，空行不再被当成 EOF
  v = isEof ? '' : String(v);
  if (isEof) outAppend('(EOF，输入被取消)\n', 'out-err');
  else outEcho(v);
  return v;
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
      '        return _f(prompt)\n' +
      '    return _pc_input\n' +
      '_b.input = _pc_make_input()\n' +
      'del _b, _pc_make_input\n');
  } catch (e) { console.warn('[pyodide] input() patch failed', e); }
}

/* ---------- CodeMirror 6 ---------- */
async function initEditor() {
  await loadScript('vendor/cm6.js');
  const f = state.files.find(x => x.name === state.active) || state.files[0];
  cm = PCCM.create($('editor-container'), {
    doc: f.content,
    lang: langOf(f.name),
    fontSize: fontSize,
    onChange: (t, up) => {
      const cur = state.files.find(x => x.name === state.active);
      if (cur) { cur.content = t; scheduleSave(); }
      if (up && up.docChanged) clearErrorsTouchedBy(up);   // v4.1.1：编辑过的标红行立即取消标红
      triggerCompletion();
    },
    onCursor: (l, c) => { $('status-cursor').textContent = 'Ln ' + l + ', Col ' + c; }
  });
  editorReady = true;
  openFile(f.name);
}
let saveTimer = null;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveStore, 400); }

function openFile(name) {
  const f = state.files.find(x => x.name === name);
  if (!f) return;
  state.active = name;
  const lang = langOf(name);
  if (cm && f.content !== cm.state.doc.toString()) PCCM.setDoc(cm, f.content, lang);
  clearCodeErrors();
  $('tab-name').textContent = name;
  $('tab-fileicon').style.color = lang === 'python' ? '#4B8BBE' : lang === 'cpp' ? '#7aa2f7' : '#888';
  $('welcome').classList.add('hidden');
  $('status-lang').textContent = langLabel(lang);
  $('status-engine').textContent = lang === 'python'
    ? (pyEngine === 'online' ? '在线编译（真实编译）' : pyEngine === 'termux' ? 'Termux Python（原生 CPython）' : 'Pyodide (WebAssembly)')
    : lang === 'cpp' ? (cppEngineName() + (resolveCppEngine(true) === 'termux' ? ' · 真实编译 · 可交互' : resolveCppEngine(true) === 'online' ? ' · 真实编译 · 在线' : ' · 教学级')) : '—';
  renderFileList();
  saveStore();
}
function renderFileList() {
  const ul = $('file-list');
  ul.innerHTML = '';
  for (const f of state.files) {
    const li = document.createElement('li');
    if (f.name === state.active) li.className = 'active';
    if (projectMode()) li.classList.add('project-mode');
    const lang = langOf(f.name);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '15'); svg.setAttribute('height', '15');
    svg.innerHTML = '<path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>';
    svg.style.color = lang === 'python' ? '#4B8BBE' : lang === 'cpp' ? '#7aa2f7' : '#888';
    const span = document.createElement('span');
    span.className = 'fname'; span.textContent = f.name;
    li.appendChild(svg); li.appendChild(span);
    li.addEventListener('click', () => { openFile(f.name); closeSidebar(); });
    li.addEventListener('dblclick', () => startRename(f.name));
    ul.appendChild(li);
  }
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
    // worker 初始化失败 → 本会话起回退主线程模式（含 wasm 缓存，仍可用对话框输入）
    pyMode = 'main';
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
      pyWorkerCtl.timeout = setTimeout(() => resolve('timeout'), 90000);   // 90s 超时兜底
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
      pyRunDone = resolve;
      try { pyWorker.postMessage({ type: 'run', code: cm.state.doc.toString(), files }); }
      catch (e) { pyRunDone = null; resolve({ error: String((e && e.message) || e) }); }
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
function runCppTermux() {
  if (!guardTermux()) return;   // v4.9：未装 Termux 时取消所有 Termux 编译项目
  cppRunning = true;
  document.body.classList.add('term-live');
  if (Android.appendLog) Android.appendLog('js', 'runCppTermux engine=' + cppEngine
      + ' termuxEnv=' + JSON.stringify(termuxEnv) + ' compiler=' + cppCompiler);
  outAppend('$ ' + cppCompiler + ' ' + state.active + ' && 运行   [Termux 真实编译 · 可交互]\n', 'out-echo');
  outMeta('已发送编译请求到 Termux，等待响应…（首次编译约 10~30 秒）');
  // v4.9.3 运行会话目录：每次运行独立子目录，多项目连续运行（Termux 队列异步）不再互相覆盖文件与输出
  let sess = '';
  try { sess = (Android.beginRunSession ? (Android.beginRunSession() || '') : ''); } catch (e) {}
  window.__runSession = sess;
  injectProjectHeadersToTermux(sess);
  window.__cppT0 = performance.now();
  if (cppBeatTimer) clearInterval(cppBeatTimer);
  cppBeatTimer = setInterval(() => {
    if (!cppRunning) { clearInterval(cppBeatTimer); cppBeatTimer = null; return; }
    outMeta('… Termux 处理中 ' + Math.round((performance.now() - window.__cppT0) / 1000) + 's（60s 超时后会给出诊断）');
  }, 10000);
  try {
    const ok = Android.runCpp(sess, state.active, cm.state.doc.toString(), cppCompiler, 60);
    if (!ok) { finishCpp(); outAppend('Termux 启动失败，请检查配置指引。\n', 'out-err'); }
  } catch (e) {
    finishCpp();
    outAppend('Termux 调用异常: ' + (e.message || e) + '\n', 'out-err');
  }
}
/* ---------- v4.7：Termux 原生 Python 解释器（与 C++ 通道共用 FIFO 交互与轮询；配置完全分离） ---------- */
/** 项目模式下把所有 .py 平铺写入运行会话目录 → Termux python 的 sys.path 覆盖 → 同目录 import 可用 */
function injectProjectPyToTermux(sess) {
  if (!projectMode() || !window.Android || !Android.saveFile) return;
  for (const f of state.files) {
    if (!f.name.endsWith('.py')) continue;
    try {
      if (sess && Android.saveFileIn) Android.saveFileIn(sess, f.name.split('/').pop(), f.content);
      else Android.saveFile(f.name.split('/').pop(), f.content);
    } catch (e) {}
  }
}
function runPythonTermux() {
  if (!guardTermux()) return;   // v4.9：未装 Termux 时取消所有 Termux 编译项目
  cppRunning = true;
  document.body.classList.add('term-live');
  window.__pyTermuxRun = true;
  if (Android.appendLog) Android.appendLog('js', 'runPythonTermux termuxEnv=' + JSON.stringify(termuxEnv));
  outAppend('$ python ' + state.active + '   [Termux 原生解释器 · 可交互]\n', 'out-echo');
  outMeta('已发送运行请求到 Termux…（未装 Python 时首次运行会自动 pkg install python，约 1~3 分钟）');
  // v4.9.3 运行会话目录（与 C++ 同机制）：项目 .py 与产物按会话隔离
  let sess = '';
  try { sess = (Android.beginRunSession ? (Android.beginRunSession() || '') : ''); } catch (e) {}
  window.__runSession = sess;
  if (projectMode()) injectProjectPyToTermux(sess);
  window.__cppT0 = performance.now();
  if (cppBeatTimer) clearInterval(cppBeatTimer);
  cppBeatTimer = setInterval(() => {
    if (!cppRunning) { clearInterval(cppBeatTimer); cppBeatTimer = null; return; }
    outMeta('… Termux 处理中 ' + Math.round((performance.now() - window.__cppT0) / 1000) + 's（可点「停止」终止）');
  }, 10000);
  try {
    const ok = Android.runPyTermux(sess, state.active, cm.state.doc.toString(), 60);
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

window.__onCppStream = function (text) {
  if (text) outAppend(text);
};
window.__onCppStreamErr = function (text) {
  if (text) outAppend(text, 'out-err');
};
window.__onCppResult = function (res) {
  res = res || {};
  if (Android.appendLog) Android.appendLog('js', 'onCppResult ' + JSON.stringify(res).slice(0, 300));
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
  btn.querySelector('span').textContent = v ? '停止' : '运行';
}
async function runCurrent() {
  if (running) {
    // 运行中点击 = 停止：按引擎立即终止，不再等超时
    if (runningKind === 'termux' || runningKind === 'py-termux') {
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
      } else {
        outMeta('已停止（当前环境为主线程回退模式，无法强制中断运行中的程序；无限循环请改用在线引擎或 Termux）。');
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
let completionList = [];      // 当前补全候选 [{label, insert}]
let completionIdx = 0;
let completionPos = null;     // {from, to} 插入替换范围

function detectImports(text, lang) {
  const libs = new Set();
  if (lang === 'python') {
    let m;
    const re1 = /^\s*import\s+([\w.]+)/gm;
    while ((m = re1.exec(text))) libs.add(m[1].split('.')[0]);
    const re2 = /^\s*from\s+([\w.]+)\s+import/gm;
    while ((m = re2.exec(text))) libs.add(m[2] ? m[1] + '.' : m[1].split('.')[0]);
  } else {
    let m;
    const re = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm;
    while ((m = re.exec(text))) libs.add(m[1]);
  }
  return libs;
}

function computeCompletions() {
  if (!cm) return [];
  const doc = cm.state.doc;
  const pos = cm.state.selection.main.head;
  const line = doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const lang = langOf(state.active);
  const items = [];
  const add = (label, insert) => {
    if (!items.some(x => x.label === label)) items.push({ label, insert: insert || label });
  };
  // 场景 1：成员补全 obj. / lib. / std::
  const mem = /([\w]+)(?:\.|::)(\w*)$/.exec(before);
  if (mem) {
    const obj = mem[1], typed = mem[2].toLowerCase();
    const libs = detectImports(doc.toString().slice(0, pos), lang);
    const has = libs.has(obj);
    const table = (PC_LIB_MEMBERS[lang] || {})[obj];
    if (table && (has || lang === 'python')) {
      table.forEach(m => { if (!typed || m.toLowerCase().startsWith(typed)) add(obj + '.' + m, m); });
      return items.slice(0, 30);
    }
    if (lang === 'cpp' && obj === 'std') {
      PC_LIB_MEMBERS.cpp.std.forEach(m => { if (!typed || m.toLowerCase().startsWith(typed)) add('std::' + m, m); });
      return items.slice(0, 30);
    }
    // 文档内对象属性猜测：退化为空
    return [];
  }
  // 场景 2：#include 头文件补全
  if (/#\s*include\s*[<"]\w*$/.test(before)) {
    const typed = /([\w]*)$/.exec(before)[1].toLowerCase();
    PC_INCLUDES.forEach(h => { if (!typed || h.toLowerCase().startsWith(typed)) add(h); });
    return items;
  }
  // 场景 3：普通标识符补全
  const word = /[\w$]*$/.exec(before)[0];
  if (!word || word.length < 1) return [];
  const lower = word.toLowerCase();
  (PC_KEYWORDS[lang] || []).forEach(k => {
    if (k.toLowerCase().startsWith(lower) && k !== word) add(k);
  });
  // 已导入库名也参与补全（输入 import x 时）
  detectImports(doc.toString(), lang).forEach(l => { if (l.toLowerCase().startsWith(lower)) add(l); });
  // 文档内标识符
  const ids = new Set();
  const idre = /[\w$]{3,}/g;
  let m;
  const text = doc.toString();
  while ((m = idre.exec(text)) && ids.size < 400) ids.add(m[0]);
  ids.forEach(id => { if (id.toLowerCase().startsWith(lower) && id !== word) add(id); });
  // 距离光标越近的候选排前面
  const wStart = pos - word.length;
  items.sort((a, b) => {
    const ai = text.indexOf(a.label), bi = text.indexOf(b.label);
    const ad = ai >= 0 ? Math.abs(ai - wStart) : 1e9;
    const bd = bi >= 0 ? Math.abs(bi - wStart) : 1e9;
    return ad - bd;
  });
  return items.slice(0, 12);
}

function completionWordRange() {
  if (!cm) return null;
  const pos = cm.state.selection.main.head;
  const line = cm.state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const m = /[\w$]*$/.exec(before);
  const after = /^^[\w$]*/.exec(line.text.slice(pos - line.from))[0] || '';
  const word = m[0];
  if (!word) return null;
  return { from: pos - word.length, to: pos + after.length, word };
}

function showCompletion() {
  if (!cm) return hideCompletion();
  const pos = cm.state.selection.main.head;
  const line = cm.state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  // 场景 A：成员补全（obj. / lib. / std:: 前缀，点后即使无字符也触发）
  const mem = /([\w]+)(?:\.|::)(\w*)$/.exec(before);
  if (mem) {
    completionList = computeCompletions();
    if (!completionList.length) return hideCompletion();
    completionPos = { from: pos - mem[2].length, to: pos };
    renderCompletion();
    return;
  }
  // 场景 B：普通词前缀补全
  const range = completionWordRange();
  if (!range) return hideCompletion();
  completionList = computeCompletions();
  if (!completionList.length) return hideCompletion();
  completionPos = { from: range.from, to: range.to };
  renderCompletion();
}
function renderCompletion() {
  const box = document.getElementById('pc-complete') || (() => {
    const el = document.createElement('div');
    el.id = 'pc-complete';
    $('editor-container').appendChild(el);
    el.addEventListener('pointerdown', (e) => {
      const it = e.target.closest('.pc-ci');
      if (it) { e.preventDefault(); applyCompletion(parseInt(it.dataset.i, 10)); }
    });
    return el;
  })();
  completionIdx = 0;
  box.innerHTML = completionList.map((c, i) =>
    `<div class="pc-ci${i === 0 ? ' act' : ''}" data-i="${i}">${c.label}</div>`).join('');
  const anchor = completionPos ? completionPos.from : cm.state.selection.main.head;
  const coord = cm.coordsAtPos(anchor);
  if (coord) {
    box.style.display = 'block';
    const cont = $('editor-container').getBoundingClientRect();
    box.style.left = Math.max(4, coord.left - cont.left) + 'px';
    box.style.top = Math.max(4, Math.min(cont.height - 20 - Math.min(completionList.length, 8) * 26,
      coord.bottom - cont.top + 2)) + 'px';
  }
}
function hideCompletion() {
  const box = document.getElementById('pc-complete');
  if (box) box.style.display = 'none';
  completionList = [];
}
function moveCompletion(d) {
  if (!completionList.length) return;
  completionIdx = (completionIdx + d + completionList.length) % completionList.length;
  const box = document.getElementById('pc-complete');
  if (box) {
    box.querySelectorAll('.pc-ci').forEach((el, i) => el.classList.toggle('act', i === completionIdx));
    const act = box.querySelector('.pc-ci.act');
    if (act) act.scrollIntoView({ block: 'nearest' });
  }
}
function applyCompletion(i) {
  const c = completionList[i !== undefined ? i : completionIdx];
  hideCompletion();
  if (!c || !completionPos || !cm) return;
  applySuppressPos = completionPos.from + c.insert.length;   // 采纳位置：此后 onChange 不重弹浮层
  cm.dispatch({
    changes: { from: completionPos.from, to: completionPos.to, insert: c.insert },
    selection: { anchor: completionPos.from + c.insert.length }
  });
  cm.focus();
}

/* 键盘拦截（capture 阶段，浮层激活时优先处理） */
document.addEventListener('keydown', (e) => {
  if (!completionList.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); moveCompletion(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); moveCompletion(-1); }
  else if (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey)) {
    if (e.key === 'Tab' || completionList.length <= 3) { e.preventDefault(); e.stopPropagation(); applyCompletion(); }
    else hideCompletion();
  }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideCompletion(); }
}, true);

/* 输入触发（onChange 里调用） */
let completionDefer = null;
let applySuppressPos = -1;    // 刚采纳补全的光标位置：浮层不立即重弹，继续输入后恢复
function triggerCompletion() {
  clearTimeout(completionDefer);
  completionDefer = setTimeout(() => {
    if (!cm || !document.activeElement || !$('editor-container').contains(document.activeElement)) return;
    if (cm.composing) return;                                  // 中文输入法组合中不弹英文候选
    if (cm.state.selection.main.head === applySuppressPos) return;   // 刚采纳完（未继续输入）
    applySuppressPos = -1;
    showCompletion();
  }, 120);
}

/* ---------- 项目空间（v4.0：本地文件夹作为工程，文件互相调用 + 定时自动保存） ---------- */
function projectMode() { return !!projectRoot; }

function onProjectLoaded(data) {
  if (!data || data.error) {
    outAppend('打开项目失败：' + (data && data.error || '未知错误') + '\n', 'out-err');
    return;
  }
  projectRoot = data.path;
  const files = [];
  for (const f of data.files) {
    files.push({ name: f.rel, content: f.content, _saved: f.content });
  }
  if (!files.length) files.push({ name: 'main.py', content: '', _saved: '' });
  state.files = files;
  state.active = files[0].name;
  saveStore();
  renderFileList();
  openFile(state.active);
  outAppend('📁 项目已打开：' + projectRoot + '（' + files.length + ' 个文件）\n', 'out-echo');
  outMeta('文件夹即项目空间：Python 可直接 import 项目内模块；每 30 秒自动保存到原位置。');
  syncProjectMenu();
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
  Android.readProject(path);
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
  projectRoot = null;
  state.files = [
    { name: 'main.py', content: PY_DEFAULT_CODE },
    { name: 'hello.cpp', content: CPP_DEFAULT_CODE }
  ];
  state.active = 'main.py';
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
function injectProjectHeadersToTermux(sess) {
  if (!projectMode() || !window.Android || !Android.saveFile) return;
  for (const f of state.files) {
    if (/\.(h|hpp|hh)$/i.test(f.name)) {
      try {
        if (sess && Android.saveFileIn) Android.saveFileIn(sess, f.name.split('/').pop(), f.content);
        else Android.saveFile(f.name.split('/').pop(), f.content);
      } catch (e) {}
    }
  }
}

/** 定时自动保存：把改动写回项目原位置（按编码） */
function autoSaveProject(manual) {
  if (!projectMode() || !window.Android || !Android.writeProjectFile) return;
  if (!autoSaveOn && !manual) return;
  let n = 0, fail = 0;
  for (const f of state.files) {
    if (f._saved !== undefined && f._saved === f.content) continue;
    const ok = Android.writeProjectFile(projectRoot + '/' + f.name, f.content, exportEncoding);
    if (ok) { f._saved = f.content; n++; } else fail++;
  }
  if (n || manual) {
    outMeta((manual ? '已手动保存 ' : '自动保存 ') + n + ' 个文件 → ' + projectRoot + '（' + exportEncoding + '）');
  }
  if (fail) {
    outAppend('⚠ 有 ' + fail + ' 个文件保存失败（常见原因：所选编码不支持文件内容，如 ASCII 含中文）。'
      + '可在菜单切换编码（如 UTF-8 / GBK）后重试。\n', 'out-err');
  }
}
function startAutoSaveLoop() {
  clearInterval(projectSaveTimer);
  projectSaveTimer = setInterval(() => autoSaveProject(false), 30000);
}

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
window.PCPluginAPI = {
  apiVersion: 2,   // 插件接口版本（v2：新增 page() 管理页选项卡、meta 标准字段、插件启停）
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
      typeof m === 'string' ? { label: m, cb: null } : { label: String(m.label || ''), cb: m.onClick }));
    PluginHost.loaded.push(meta);
    return true;
  },
  /** v4.6：向「插件管理页」注册自定义选项卡。page(tabId, { title, render(container, api) })
   *  render 在切到该选项卡时惰性调用，container 为内容容器（可自由填充 DOM）
   *  内置选项卡 id（loaded/langs/settings）不可覆盖 */
  page(tabId, def) {
    if (!tabId || !def || typeof def.render !== 'function') return false;
    if (['loaded', 'langs', 'settings'].indexOf(String(tabId)) >= 0) return false;
    PluginHost.pages[String(tabId)] = { title: String(def.title || tabId), render: def.render };
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
async function loadPlugins() {
  if (!(window.Android && Android.listPlugins && Android.readPlugin)) return;
  let names = [];
  try { names = JSON.parse(Android.listPlugins()) || []; } catch (e) { return; }
  if (!names.length) return;
  // v4.6 总开关：关闭则不加载任何插件
  if (!pluginsEnabled()) {
    outMeta(LANG === 'en' ? 'Plugin system disabled (Plugin manager → Settings)' : '插件系统已关闭（插件管理 → 设置）');
    return;
  }
  const disabled = disabledPlugins();
  for (const n of names) {
    try {
      if (disabled.indexOf(n) >= 0) { PluginHost.skipped.push(n); continue; }  // v4.6 禁用跳过
      const src = Android.readPlugin(n);
      if (!src) continue;
      const before = PluginHost.loaded.length;
      new Function('PCPluginAPI', src)(window.PCPluginAPI);
      for (let i = before; i < PluginHost.loaded.length; i++) PluginHost.loaded[i].__file = n; // v4.6 记录来源文件（供启停管理）
      outAppend((LANG === 'en' ? '[plugin] loaded: ' : '[插件] 已加载：') + n + '\n', 'out-echo');
    } catch (e) {
      outAppend((LANG === 'en' ? '[plugin] load failed: ' : '[插件] 加载失败：') + n + ' — ' + (e.message || e) + '\n', 'out-err');
    }
  }
  PluginHost.loaded.forEach(p => { try { p.onInit && p.onInit(window.PCPluginAPI); } catch (e) { console.warn('[plugin]', p.id, e); } });
  renderPluginMenus();
  outMeta((LANG === 'en' ? 'Plugins loaded: ' : '已加载插件：') + PluginHost.loaded.length
    + (PluginHost.skipped.length ? (LANG === 'en' ? ' (disabled: ' + PluginHost.skipped.length + ')' : '（已禁用 ' + PluginHost.skipped.length + ' 个）') : ''));
}
function renderPluginMenus() {
  if (!PluginHost.menus.length) return;
  const anchor = $('mi-about');
  if (!anchor) return;
  PluginHost.menus.forEach(m => {
    const b = document.createElement('button');
    b.textContent = '🧩 ' + m.label;
    b.addEventListener('click', () => {
      $('more-menu').classList.add('hidden');
      try { m.cb && m.cb(window.PCPluginAPI); } catch (e) { console.warn(e); }
    });
    anchor.parentNode.insertBefore(b, anchor);
  });
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
  if (!PluginHost.loaded.length && !PluginHost.skipped.length) {
    const empty = document.createElement('div'); empty.className = 'pp-empty';
    empty.textContent = t('pp_none');
    body.appendChild(empty);
    return;
  }
  PluginHost.loaded.forEach(p => body.appendChild(pluginCard(p)));
  PluginHost.skipped.forEach(n => body.appendChild(pluginCard({ __file: n, __disabled: true })));
}
function pluginCard(p) {
  const card = document.createElement('div');
  card.className = 'pp-card' + (p.__disabled ? ' off' : '');
  const head = document.createElement('div'); head.className = 'pp-card-head';
  head.innerHTML = '<span class="pp-card-icon">🧩</span><span class="pp-card-name"></span><span class="pp-card-ver"></span>';
  head.querySelector('.pp-card-name').textContent = p.name || p.id || p.__file || '?';
  if (p.version) head.querySelector('.pp-card-ver').textContent = 'v' + p.version;
  card.appendChild(head);
  const metaBits = [p.author, p.homepage, p.id ? ('id: ' + p.id) : null, p.__file && !p.__disabled ? p.__file : null].filter(Boolean);
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
  const foot = document.createElement('div'); foot.className = 'pp-card-foot';
  const st = document.createElement('span');
  st.className = 'pp-state' + (p.__disabled ? ' off' : '');
  st.textContent = p.__disabled ? t('pp_disabled') : t('pp_enabled');
  foot.appendChild(st);
  const btn = document.createElement('button'); btn.className = 'pp-btn';
  btn.textContent = p.__disabled ? t('pp_enable') : t('pp_disable');
  btn.addEventListener('click', () => {
    if (!p.__file) return;
    setPluginDisabled(p.__file, !p.__disabled);
    try { if (window.Android && Android.showToast) Android.showToast(t('pp_toggle_restart')); } catch (e) {}
    openPluginPage();  // 重开页面刷新列表
  });
  foot.appendChild(btn);
  card.appendChild(foot);
  return card;
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
  const reserve = document.createElement('div'); reserve.className = 'pp-hint dim';
  reserve.textContent = t('pp_reserve');
  body.appendChild(reserve);
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
function doNewFile() { showModal({ title: t('new_file'), placeholder: t('fname_eg') }); modalMode = 'new'; }
function startRename(old) {
  state.active = old;
  showModal({ title: t('rename'), value: old, desc: '' });
  modalMode = 'rename';
}
function doDelete() {
  if (!state.active) return;
  showModal({ title: t('delete_q') + state.active + t('delete_q2'), withInput: false, okText: t('delete_btn'), desc: t('irreversible') });
  modalMode = 'confirm';
}
function modalOk() {
  const name = $('modal-input').value.trim();
  if (modalMode === 'new') {
    const err = validName(name);
    if (err) { $('modal-error').textContent = err; return; }
    state.files.push({ name, content: '' });
    openFile(name); closeSidebar(); hideModal();
  } else if (modalMode === 'rename') {
    const old = state.active;
    if (name === old) { hideModal(); return; }
    const err = validName(name);
    if (err) { $('modal-error').textContent = err; return; }
    state.files.find(x => x.name === old).name = name;
    state.active = name;
    openFile(name); hideModal();
  } else if (modalMode === 'confirm') {
    state.files = state.files.filter(x => x.name !== state.active);
    if (!state.files.length) state.files.push({ name: 'main.py', content: PY_DEFAULT_CODE });
    openFile(state.files[0].name); hideModal();
  }
}

/* ---------- 导出 ---------- */
function exportFile() {
  const f = state.files.find(x => x.name === state.active);
  if (!f) return;
  if (window.Android && Android.saveFileEx) { Android.saveFileEx(f.name.split('/').pop(), f.content, exportEncoding); outMeta('已导出 ' + f.name + '（' + exportEncoding + '）到下载文件夹'); return; }
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
    const r = await window.PCPluginAPI.runCapture(TERMUX_PROBE);
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
    try { r = await window.PCPluginAPI.runCapture(TERMUX_PROBE); } catch (e) { r = null; }
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

const _modalOk = modalOk;
$('modal-ok').addEventListener('click', () => {
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
$('btn-clear-out').addEventListener('click', outClear);
$('btn-panel-toggle').addEventListener('click', () => {
  $('bottom-panel').classList.toggle('collapsed');
  setTimeout(() => cm && cm.requestMeasure(), 200);
});
$('tab-close').addEventListener('click', () => {
  $('welcome').classList.remove('hidden');
});

/* ---------- 快捷键 ---------- */
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runCurrent(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveStore(); outMeta('已保存 ✓'); }
});

/* ---------- 启动 ---------- */
(async function boot() {
  $('status-size').textContent = '字号 ' + fontSize;
  $('app-title').textContent = '轻码编辑器 v' + APP_VERSION;
  renderFileList();
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
  // v4.4 插件加载（/sdcard/QingCode/plugins/*.js；无存储权限或无插件时自动跳过）
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
