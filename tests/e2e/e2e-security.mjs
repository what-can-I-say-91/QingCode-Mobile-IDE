/* E2E：安全审查（v5.10.1）改动回归
   覆盖 CSP 是否打断应用、插件权限默认值与主线程只读提示、
   一次性校验读取（TOCTOU）、.qingcode.json 加固与首次确认、在线安装二次确认。 */
const BASE = process.env.QC_CDP || 'http://127.0.0.1:9225';
const APP = process.env.QC_APP || 'http://127.0.0.1:8765/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(BASE + '/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const logs = [];
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error('EVAL FAIL: ' + (ex.exception?.description || ex.text));
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Page.navigate', { url: APP });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { ready = await evalJs('!!(typeof cm !== "undefined" && cm && typeof pluginTrustSection === "function")'); } catch (e) { ready = false; }
    if (ready) break;
  }
  if (!ready) throw new Error('页面未就绪（可能被 CSP 拦住了脚本）');

  /* 注入最小原生桥（浏览器里没有 Android 对象；测试只关心前端承接逻辑） */
  await evalJs('window.Android = window.Android || {}; "ok"');

  const results = [];
  const check = (n, ok, extra) => results.push({ n, ok: !!ok, extra });

  /* S1 CSP 下能正常启动 */
  const s1 = await evalJs('JSON.stringify({ ver: APP_VERSION, doc: cm.state.doc.length, csp: !!document.querySelector("meta[http-equiv=\\"Content-Security-Policy\\"]") })');
  const s1v = JSON.parse(s1);
  check('S1 CSP 生效时应用仍能启动（编辑器就绪）', s1v.doc > 0, s1);

  /* S2 CSP 关键指令 */
  const s2 = await evalJs(`
    (function(){
      var m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      var c = m ? m.getAttribute('content') : '';
      return JSON.stringify({ has: !!m, object: /object-src 'none'/.test(c), base: /base-uri 'none'/.test(c),
        connect: /connect-src[^;]*https:\\/\\/wandbox\\.org/.test(c), evalOk: /'unsafe-eval'/.test(c), wasm: /'wasm-unsafe-eval'/.test(c) });
    })()
  `);
  const s2v = JSON.parse(s2);
  check('S2 CSP 含 object-src/base-uri 限制与在线编译白名单', s2v.has && s2v.object && s2v.base && s2v.connect && s2v.evalOk && s2v.wasm, s2);

  /* S3 新插件默认权限全 false */
  const s3 = await evalJs('JSON.stringify(PLUGIN_DEFAULT_PERMS)');
  const s3v = JSON.parse(s3);
  check('S3 新插件默认权限全为 false', !s3v.storage && !s3v.network && !s3v.workspace && !s3v.termux, s3);

  /* S4 旧数据迁移不再给全权 */
  const s4 = await evalJs(`
    (function(){
      localStorage.removeItem('pc_trust_migrated');
      localStorage.setItem('pc_plugins_seen', JSON.stringify(['mig.js']));
      localStorage.setItem('pc_plugins_inline', JSON.stringify([]));
      localStorage.setItem('pc_plugins_disabled', JSON.stringify([]));
      localStorage.removeItem('pc_plugin_trust');
      var infos = [{ name: 'mig.js', sha256: 'abc', cacheSha256: '' }];
      migrateLegacyPluginTrust(infos);
      var rec = PluginTrust.get('mig.js');
      return JSON.stringify(rec ? rec.permissions : null);
    })()
  `);
  const s4v = JSON.parse(s4);
  check('S4 迁移记录不再默认全权', s4v && !s4v.storage && !s4v.network && !s4v.workspace && !s4v.termux, s4);

  /* S5 主线程插件：只读提示，没有勾选框 */
  const s5 = await evalJs(`
    (function(){
      localStorage.setItem('pc_plugin_trust', JSON.stringify({
        'inl.js': { sha256: 'h1', version: 1, permissions: { storage: false, network: false, workspace: false, termux: false }, mode: 'inline' }
      }));
      pluginInfos.set('inl.js', { name: 'inl.js', sha256: 'h1', cacheSha256: 'h1' });
      var box = pluginTrustSection('inl.js');
      return JSON.stringify({ boxes: box.querySelectorAll('input[type=checkbox]').length,
        note: /不受权限约束/.test(box.textContent) });
    })()
  `);
  const s5v = JSON.parse(s5);
  check('S5 主线程插件卡片只读提示、无权限勾选', s5v.boxes === 0 && s5v.note, s5);

  /* S6 沙箱插件：4 个勾选框，默认全不勾 */
  const s6 = await evalJs(`
    (function(){
      localStorage.setItem('pc_plugin_trust', JSON.stringify({}));
      pluginInfos.set('sbx.js', { name: 'sbx.js', sha256: 'h2', cacheSha256: '' });
      var box = pluginTrustSection('sbx.js');
      var cb = box.querySelectorAll('input[type=checkbox]');
      var checked = 0;
      for (var i = 0; i < cb.length; i++) if (cb[i].checked) checked++;
      return JSON.stringify({ n: cb.length, checked: checked });
    })()
  `);
  const s6v = JSON.parse(s6);
  check('S6 沙箱插件权限勾选默认全不勾', s6v.n === 4 && s6v.checked === 0, s6);

  /* S7 一次性校验读取：哈希一致才返回内容 */
  const s7 = await evalJs(`
    (function(){
      Android.readPluginVerified = function (n) { return JSON.stringify({ content: 'window.__ran=1;', sha256: 'GOOD' }); };
      localStorage.setItem('pc_plugin_trust', JSON.stringify({
        'v.js': { sha256: 'GOOD', version: 1, permissions: {}, mode: 'sandbox' }
      }));
      var ok = resolvePluginSource('v.js', { name: 'v.js', sha256: 'GOOD', cacheSha256: 'GOOD' }, 'approved');
      localStorage.setItem('pc_plugin_trust', JSON.stringify({
        'v.js': { sha256: 'OTHER', version: 1, permissions: {}, mode: 'sandbox' }
      }));
      var bad = resolvePluginSource('v.js', { name: 'v.js', sha256: 'GOOD', cacheSha256: 'GOOD' }, 'approved');
      return JSON.stringify({ ok: ok, bad: bad });
    })()
  `);
  const s7v = JSON.parse(s7);
  check('S7 哈希一致才执行、不一致返回 null', s7v.ok === 'window.__ran=1;' && s7v.bad === null, s7);

  /* S8 .qingcode.json：compiler 带路径被拒 */
  const s8 = await evalJs(`
    (function(){
      state.files = [
        { name: '.qingcode.json', content: JSON.stringify({ compiler: '../../bin/sh' }), _saved: '' },
        { name: 'main.cpp', content: 'int main(){}', _saved: '' }
      ];
      ProjectConfig._cacheKey = null;
      var c = ProjectConfig.get();
      return JSON.stringify({ cxx: c.compiler, errs: ProjectConfig.errors() });
    })()
  `);
  const s8v = JSON.parse(s8);
  check('S8 compiler 只能写可执行名（拒绝路径）', s8v.cxx === null && s8v.errs.length >= 1, s8);

  /* S9 env 黑名单 */
  const s9 = await evalJs(`
    (function(){
      state.files[0].content = JSON.stringify({ env: { LD_PRELOAD: '/tmp/x.so', PATH: '/evil', OK: '1' } });
      ProjectConfig._cacheKey = null;
      var c = ProjectConfig.get();
      return JSON.stringify({ env: c.env, errs: ProjectConfig.errors().length });
    })()
  `);
  const s9v = JSON.parse(s9);
  check('S9 LD_PRELOAD / PATH 被拒，其余保留',
    s9v.env.OK === '1' && !('LD_PRELOAD' in s9v.env) && !('PATH' in s9v.env) && s9v.errs === 2, s9);

  /* S10 首次运行带配置的项目要确认一次，记住后不再问 */
  const s10 = await evalJs(`
    (function(){
      localStorage.removeItem('pc_qc_approved');
      state.files[0].content = JSON.stringify({ flags: ['-O2'] });
      ProjectConfig._cacheKey = null;
      var first = ProjectConfig.ensureApproved();
      var shown = modalMode === 'qc-approve' && !document.getElementById('modal-mask').classList.contains('hidden');
      ProjectConfig.markApproved();
      hideModal();
      var second = ProjectConfig.ensureApproved();
      return JSON.stringify({ first: first, shown: shown, second: second });
    })()
  `);
  const s10v = JSON.parse(s10);
  check('S10 带配置的项目首次运行需确认、确认后不再打扰',
    s10v.first === false && s10v.shown === true && s10v.second === true, s10);

  /* S11 无配置文件时不打扰 */
  const s11 = await evalJs(`
    (function(){
      state.files = [{ name: 'main.cpp', content: 'int main(){}', _saved: '' }];
      ProjectConfig._cacheKey = null;
      return JSON.stringify({ ok: ProjectConfig.ensureApproved() });
    })()
  `);
  check('S11 没有 .qingcode.json 时不弹确认', JSON.parse(s11).ok === true, s11);

  /* S12 在线安装：先给指纹与前 50 行，确认后才落盘 */
  const s12 = await evalJs(`
    (function(){
      window.__wrote = [];
      Android.writePlugin = function (n, t) { window.__wrote.push(n); return true; };
      window.fetch = function () {
        return Promise.resolve({ ok: true, status: 200, text: function () {
          var s = '';
          for (var i = 1; i <= 60; i++) s += '// line ' + i + '\\n';
          return Promise.resolve(s);
        } });
      };
      return installPluginFromUrl('https://example.com/demo.js').then(function (r) {
        var mask = document.getElementById('modal-mask');
        var desc = document.getElementById('modal-error').textContent;
        var wroteBefore = window.__wrote.length;
        var shown = !mask.classList.contains('hidden') && modalMode === 'plugin-install';
        var hasHash = /[0-9a-f]{16}/.test(desc);
        var hasPreview = /line 1\\b/.test(desc) && /line 50\\b/.test(desc) && !/line 51\\b/.test(desc);
        modalOk();
        return JSON.stringify({ r: r, shown: shown, hasHash: hasHash, hasPreview: hasPreview,
          wroteBefore: wroteBefore, wroteAfter: window.__wrote.length });
      });
    })()
  `);
  const s12v = JSON.parse(s12);
  check('S12 在线安装先展示指纹与前 50 行，确认后才写入',
    s12v.shown && s12v.hasHash && s12v.hasPreview && s12v.wroteBefore === 0 && s12v.wroteAfter === 1, s12);

  /* S13 无未捕获异常（排除被 CSP 预期拦截的网络请求） */
  const realLogs = logs.filter(l => !/pyodide|Failed to load resource|net::ERR|favicon|Refused to/i.test(l));
  check('S13 无脚本异常', realLogs.length === 0, realLogs.slice(0, 3).join(' | '));

  let pass = 0;
  for (const r of results) {
    if (r.ok) { pass++; console.log('PASS  ' + r.n); }
    else console.log('FAIL  ' + r.n + '  [' + (r.extra || '') + ']');
  }
  console.log('== e2e-security: ' + pass + ' passed, ' + (results.length - pass) + ' failed ==');
  ws.close();
  process.exit(pass === results.length ? 0 : 1);
}
main().catch(e => { console.error('HARNESS', e.message); process.exit(2); });
