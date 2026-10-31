/* QingCode 插件安全沙箱（Web Worker）
 * 隔离边界（如实说明）：Worker 内没有 DOM / Android 原生桥 / localStorage；
 * 网络请求仍然可达（fetch / XMLHttpRequest / WebSocket / importScripts 均可发起请求）。
 * 下面在 init 分支仅遮蔽逃逸面相关的全局（self / window / document / localStorage）
 * 作为纵深防御，网络与 IndexedDB 按文档保留；这不是硬隔离
 * （插件仍可能通过原生原型链绕过）。真正的能力约束来自受限的 PCPluginAPI。
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

/* v5.9.0：沙箱里做不到的注册能力给出明确错误（此前是 undefined，调用即 TypeError 且没有解释） */
function sandboxUnsupported(name) {
  return function () {
    var msg = '沙箱内不支持 ' + name + '：Worker 无法注册 DOM / 扩展 / 工具栏。如需该能力，请在插件管理页「信任并改为主线程运行」。';
    try { self.postMessage({ type: 'error', message: msg }); } catch (e) {}
    throw new Error(msg);
  };
}
['registerLanguage', 'registerSnippets', 'registerCompletion', 'registerFormatter',
 'addToolbarButton', 'removeToolbarButton', 'registerMenu', 'page', 'runCommandSync'
].forEach(function (k) { PCPluginAPI[k] = sandboxUnsupported(k); });

var pluginMeta = null;
function registerPlugin(p) {
  if (!p) return;
  pluginMeta = p;
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

/** 卸载时清空所有注册状态（宿主随后 terminate，这里只是不留悬挂引用） */
function destroy() {
  pluginMeta = null;
  handlers = Object.create(null);
  listeners = Object.create(null);
  pending = Object.create(null);
}

self.onmessage = function (e) {
  var d = e.data || {};
  if (d.type === 'init') {
    try {
      /* Worker 内没有 DOM / Android 原生桥 / localStorage；网络请求仍可达。
       * 仅遮蔽逃逸面相关的全局（self / window / document / localStorage）作为
       * 纵深防御，网络与 IndexedDB 按文档保留（fetch / XMLHttpRequest / WebSocket /
       * importScripts / indexedDB / caches / globalThis 均不遮蔽）。
       * 这不是硬隔离：插件仍可能通过原生原型链绕过，例如 (function(){}).constructor。
       * 真正的能力约束来自受限的 PCPluginAPI。 */
      var fn = new Function(
        'PCPluginAPI','self','window','document','localStorage',
        String(d.src));
      fn(PCPluginAPI, undefined, undefined, undefined, undefined);
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
  if (d.type === 'unload') {
    try {
      if (pluginMeta && typeof pluginMeta.onUnload === 'function') pluginMeta.onUnload(PCPluginAPI);
    } catch (e) {
      self.postMessage({ type: 'error', message: 'onUnload: ' + String(e && e.message || e) });
    }
    self.postMessage({ type: 'unloaded', id: String((pluginMeta && pluginMeta.id) || '') });
    destroy();
    return;
  }
  if (d.type === 'call') {
    var h = handlers[d.cmd];
    if (!h) { self.postMessage({ type: 'call-result', id: d.id, cmd: d.cmd, ok: false, error: 'unregistered command' }); return; }
    try {
      Promise.resolve(h()).then(function (r) {
        self.postMessage({ type: 'call-result', id: d.id, cmd: d.cmd, ok: true, result: r });
      }, function (e) {
        self.postMessage({ type: 'call-result', id: d.id, cmd: d.cmd, ok: false, error: String(e && e.message || e) });
      });
    } catch (err2) { self.postMessage({ type: 'call-result', id: d.id, cmd: d.cmd, ok: false, error: String(err2) }); }
  }
};
