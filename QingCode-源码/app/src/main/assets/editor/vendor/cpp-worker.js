/* C++ 运行 Worker：JSCPP 在此执行，主线程可随时 terminate 防死循环 */
'use strict';
importScripts('JSCPP.js');

self.onmessage = function (e) {
  const data = e.data || {};
  const code = data.code || '';
  const input = data.input == null ? '' : String(data.input);
  try {
    const ec = JSCPP.run(code, input, {
      stdio: {
        write: function (s) { self.postMessage({ type: 'out', text: String(s) }); }
      }
    });
    self.postMessage({ type: 'done', ec: (typeof ec === 'object' && ec !== null && 'v' in ec) ? ec.v : ec });
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) ? err.message : String(err) });
  }
};
