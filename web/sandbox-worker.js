/* QingCode 插件安全沙箱（Web Worker）
 * 隔离目标：插件无法访问 window / document / Android 原生桥 / localStorage / DOM。
 * 诚实边界：Worker 里仍然可以 fetch 网络；本沙箱隔离的是 DOM 与原生能力，不是网络。
 * 与主线程的通信：受限 PCPluginAPI 通过异步 RPC 转发。 */
'use strict';

var pending = Object.create(null);
var seq = 0;
var handlers = Object.create(null);
var listeners = Object.create(null);

function rpc(method, args) {
  return new Promise(function (resolve, reject) {
    var id = ++seq;
    pending[id] = { resolve: resolve, reject: reject };
    self.postMessage({ type: 'rpc', id: id, method: method, args: args || [] });
  });
}

var PCPluginAPI = {
  apiVersion: 3,
  sandboxed: true,
  /* 受限编辑器接口：只有可序列化的操作，不能注册 CM6 扩展/工具栏 */
  editor: {
    getText: function () { return rpc('getText'); },
    setText: function (t) { return rpc('setText', [String(t == null ? '' : t)]); },
    runCommand: function (id) { return rpc('runCommand', [String(id)]); },
    currentLanguage: function () { return rpc('currentLanguage'); },
    activeFileName: function () { return rpc('activeFileName'); },
    registerCommand: function (id, meta) {
      handlers[String(id)] = (meta && meta.run) || null;
      return rpc('registerCommand', [String(id), String((meta && meta.label) || id)]);
    },
    on: function (evt, fn) {
      listeners[String(evt)] = listeners[String(evt)] || [];
      listeners[String(evt)].push(fn);
      return rpc('on', [String(evt)]);
    }
  },
  t: function (k, d) { return rpc('t', [String(k), String(d || '')]); },
  log: function (m) { self.postMessage({ type: 'log', msg: String(m) }); },
  out: function (m) { self.postMessage({ type: 'log', msg: String(m) }); },
  meta: function (m) { self.postMessage({ type: 'log', msg: String(m) }); },
  register: function (p) { registerPlugin(p); }
};

function registerPlugin(p) {
  if (!p) return;
  try {
    if (typeof p.onInit === 'function') {
      Promise.resolve(p.onInit(PCPluginAPI)).catch(function (e) {
        self.postMessage({ type: 'error', message: 'onInit: ' + String(e && e.message || e) });
      });
    }
    self.postMessage({ type: 'registered', id: String(p.id || 'sandbox-plugin') });
  } catch (e) {
    self.postMessage({ type: 'error', message: 'register: ' + String(e && e.message || e) });
  }
}

self.onmessage = function (e) {
  var d = e.data || {};
  if (d.type === 'init') {
    try {
      /* 在函数作用域内执行插件代码：插件拿不到 self/window（window 在 Worker 中不存在） */
      var fn = new Function('PCPluginAPI', String(d.src));
      fn(PCPluginAPI);
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
    return;
  }
  if (d.type === 'rpc-result') {
    var p = pending[d.id];
    if (!p) return;
    delete pending[d.id];
    if (d.ok) p.resolve(d.result);
    else p.reject(new Error(d.error || 'rpc failed'));
    return;
  }
  if (d.type === 'event') {
    var arr = listeners[d.evt] || [];
    for (var i = 0; i < arr.length; i++) { try { arr[i](d.payload); } catch (err) {} }
    return;
  }
  if (d.type === 'call') {
    var h = handlers[d.cmd];
    if (!h) { self.postMessage({ type: 'call-result', id: d.id, ok: false }); return; }
    try {
      Promise.resolve(h()).then(function (r) {
        self.postMessage({ type: 'call-result', id: d.id, ok: true, result: r });
      }, function (e) {
        self.postMessage({ type: 'call-result', id: d.id, ok: false, error: String(e && e.message || e) });
      });
    } catch (err2) { self.postMessage({ type: 'call-result', id: d.id, ok: false, error: String(err2) }); }
  }
};
