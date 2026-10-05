/* QingCode v4.10 内置 Python Worker
 *
 * 把 Pyodide 移入 Web Worker：
 *  - Python 同步执行不再阻塞主线程，「停止」按钮可随时 terminate 强制中断；
 *  - input() 通过 SharedArrayBuffer + Atomics.wait 实现跨线程同步等待——
 *    终端输入行逐行交互（与 C++ Termux 引擎一致的体验），
 *    input("提示") 的提示语作为 stdout 原生输出，经 raw 通道即时冲刷显示；
 *  - 需要 crossOriginIsolated（原生壳 AssetClient 已注入 COOP/COEP 头）；
 *    环境不支持时前端自动回退主线程 + 对话框模式（py-worker 不会被创建）。
 *
 * 消息协议：
 *  主 → worker: {type:'init', bases:[...]} / {type:'run', code, files:[{name,content}]?}
 *  worker → 主: {type:'sab', sab} / {type:'progress', pct, key} / {type:'ready', version}
 *             / {type:'load-error', message} / {type:'out'|'err', text}
 *             / {type:'need-input'} / {type:'done'} / {type:'error', traceback}
 *  输入握手：worker 写 need-input → Atomics.wait(CTRL,0,0)；主线程把「行+换行」写入 DATA 区，
 *            置 DATALEN、CTRL=1 并 Atomics.notify；CTRL=2 表示 EOF（stdin 返回空串）。
 */

const DATA_CAP = 65536;
let pyodide = null;
let SAB = null, CTRL = null, DATALEN = null;

/* ---------- stdout / stderr：raw 逐字节收集，遇换行或 need-input 冲刷 ---------- */
let outBytes = [], outDec = new TextDecoder('utf-8');
let errBytes = [], errDec = new TextDecoder('utf-8');
const post = (m) => postMessage(m);
function flushOut() {
  if (outBytes.length) {
    post({ type: 'out', text: outDec.decode(new Uint8Array(outBytes), { stream: true }) });
    outBytes = [];
  }
}
function flushErr() {
  if (errBytes.length) {
    post({ type: 'err', text: errDec.decode(new Uint8Array(errBytes), { stream: true }) });
    errBytes = [];
  }
}

/* ---------- v4.5 WASM 编译缓存（worker 内同 IndexedDB，与主线程回退模式共享） ---------- */
let _wasmHooked = false;
function hookWasmCache() {
  if (_wasmHooked) return;
  _wasmHooked = true;
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
          post({ type: 'wasm-hit' });
          return { module: cached, instance: new WebAssembly.Instance(cached, imports || {}) };
        }
        const mod = await WebAssembly.compile(bytes);
        try { await idbSet('mod', { url: resp.url, size: bytes.byteLength, mod }); } catch (e) {}
        return { module: mod, instance: new WebAssembly.Instance(mod, imports || {}) };
      }
    } catch (e) { /* 回退原始路径 */ }
    return origStreaming.apply(WebAssembly, arguments);
  };
}

/* ---------- 同步读一行：阻塞 worker，主线程回车后经 SAB 唤醒 ---------- */
function blockingReadLine() {
  Atomics.store(CTRL, 0, 0);
  flushOut(); flushErr();                        // 先把 input() 的提示语冲到界面
  post({ type: 'need-input' });
  Atomics.wait(CTRL, 0, 0);                      // 直到主线程写 1(一行输入) 或 2(EOF)
  const cmd = Atomics.load(CTRL, 0);
  if (cmd === 2) return '';                      // EOF
  const n = Math.min(Atomics.load(DATALEN, 0), DATA_CAP);
  if (n <= 0) return '';
  const tmp = new Uint8Array(n);   // 复制到普通内存：TextDecoder.decode 禁止作用于 SharedArrayBuffer 视图
  tmp.set(new Uint8Array(SAB, 8, n));
  return new TextDecoder().decode(tmp);
}

/* ---------- 项目内 .py 注入虚拟文件系统（/home/pyodide/，同目录 import 可用） ---------- */
function injectFiles(files) {
  if (!files || !files.length) return;
  const FS = pyodide.FS;
  for (const f of files) {
    try {
      const full = '/home/pyodide/' + String(f.name).split('/').pop();
      const dir = full.slice(0, full.lastIndexOf('/'));
      const parts = dir.split('/').filter(Boolean);
      let cur = '';
      for (const p of parts) { cur += '/' + p; try { FS.mkdir(cur); } catch (e2) {} }
      FS.writeFile(full, f.content);
    } catch (e) { /* 单文件失败不阻断 */ }
  }
}

async function initPy(bases) {
  let lastErr = null;
  for (const base of bases) {
    try {
      const isHttp = base.startsWith('http');
      const jsUrl = isHttp ? base + 'pyodide.mjs' : new URL(base + 'pyodide.mjs', import.meta.url).href;
      const idxUrl = isHttp ? base : new URL(base, import.meta.url).href;
      post({ type: 'progress', pct: 30, key: 'splash_compile' });
      const mod = await import(jsUrl);
      pyodide = await mod.loadPyodide({ indexURL: idxUrl });
      hookWasmCache();
      pyodide.setStdout({ raw: (b) => { outBytes.push(b); if (b === 10) flushOut(); } });
      pyodide.setStderr({ raw: (b) => { errBytes.push(b); if (b === 10) flushErr(); } });
      pyodide.setStdin({ stdin: blockingReadLine });
      post({ type: 'ready', version: pyodide.version || '' });
      return;
    } catch (e) { lastErr = e; }
  }
  post({ type: 'load-error', message: String((lastErr && lastErr.message) || lastErr) });
}

async function runCode(code, files) {
  try {
    injectFiles(files);
    await pyodide.runPythonAsync(code);
    flushOut(); flushErr();
    post({ type: 'done' });
  } catch (e) {
    flushOut(); flushErr();
    post({ type: 'error', traceback: String((e && e.message) || e) });
  }
}

self.onmessage = (e) => {
  const d = e.data || {};
  if (d.type === 'init') {
    if (typeof SharedArrayBuffer === 'undefined') {
      post({ type: 'load-error', message: 'SharedArrayBuffer unavailable' });
      return;
    }
    SAB = new SharedArrayBuffer(8 + DATA_CAP);
    CTRL = new Int32Array(SAB, 0, 1);
    DATALEN = new Int32Array(SAB, 4, 1);
    post({ type: 'sab', sab: SAB });
    post({ type: 'progress', pct: 8, key: 'splash_py' });
    initPy(d.bases || ['pyodide/']);
  } else if (d.type === 'run') {
    if (!pyodide) { post({ type: 'error', traceback: 'Python 运行时未就绪' }); return; }
    runCode(d.code, d.files);
  }
};
