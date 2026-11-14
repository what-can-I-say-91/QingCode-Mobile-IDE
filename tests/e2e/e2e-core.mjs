/* 正式版核心回归（v5.11.0）：错误解析/问题面板/大文件/日志/编码/关闭保护/分片补读/i18n
   在无头浏览器里直接调用页面函数，原生桥用最小 mock。真机链路见 tests/README。 */
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
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: APP });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { ready = await evalJs('(typeof cm !== "undefined" && !!cm && typeof parseCompileErrors === "function")'); } catch (e) { ready = false; }
    if (ready) break;
  }
  const results = [];
  const check = (n, ok, extra) => results.push({ n, ok: !!ok, extra });
  if (!ready) {
    console.log('FAIL  C1 页面未就绪');
    console.log('== e2e-core: 0 passed, 1 failed ==');
    process.exit(1);
  }
  await evalJs('window.Android = window.Android || {}; "ok"');

  /* C1 编译错误：保留文件身份 + 路径含空格 */
  const c1 = JSON.parse(await evalJs(`JSON.stringify(parseCompileErrors(
    'src/a b.cpp:12:4: error: expected ;\\nmain.cpp:3:1: error: boom', 'main.cpp'))`));
  check('C1 编译错误解析带 file 且支持含空格路径',
    c1.length === 2 && c1[0].file === 'a b.cpp' && c1[1].file === 'main.cpp',
    JSON.stringify(c1));

  /* C2 问题面板显示文件名，点击可跳（这里只验证渲染） */
  await evalJs(`setPanelProblems(parseCompileErrors('src/a b.cpp:12:4: error: x', 'main.cpp'))`);
  const c2 = await evalJs(`(document.querySelector('#prob-list .prob-loc') || {}).textContent || ''`);
  check('C2 问题面板带出文件名', /a b\.cpp/.test(c2), c2);

  /* C3 大文件模式真正降级：不挂语法高亮 */
  const c3 = JSON.parse(await evalJs(`(function(){
    try {
      var big = new Array(900 * 1024 + 1).join('x');
      state.files.push({ name: 'big.cpp', content: big, _saved: big });
      openFile('big.cpp');
      return JSON.stringify({ big: isBigFile('big.cpp'), hl: curHlLang });
    } catch (e) { return JSON.stringify({ err: String(e) }); }
  })()`));
  check('C3 超过 800KB 自动关闭语法高亮', c3.big === true && c3.hl === null, JSON.stringify(c3));

  /* C4 日志增量追加：节点数受限且内容完整 */
  const c4 = JSON.parse(await evalJs(`(function(){
    var v = document.getElementById('log-view');
    if (v) v.textContent = '';
    logLines.length = 0;
    for (var i = 0; i < 20; i++) logAppend('L' + i);
    return JSON.stringify({ kids: v ? v.childNodes.length : -1, text: v ? v.textContent : '' });
  })()`));
  check('C4 日志按条追加而不是整块重写', c4.kids === 20 && /L19/.test(c4.text), JSON.stringify(c4).slice(0, 120));

  /* C5 大文本 base64 不再一次性展开参数 */
  const c5 = await evalJs(`(function(){
    try { return b64encodeUtf8(new Array(60000).join('中')).length > 0; } catch (e) { return 'ERR:' + e; }
  })()`);
  check('C5 大文本 base64 分块编码不抛异常', c5 === true, String(c5));

  /* C6 关闭项目时保护未保存内容 */
  const c6 = JSON.parse(await evalJs(`(function(){
    projectRoot = '/sdcard/Demo';
    state.files = [{ name: 'a.cpp', content: 'changed', _saved: 'origin' }];
    state.active = 'a.cpp';
    state.tabs = ['a.cpp'];
    closeProject();
    return JSON.stringify({
      modal: !document.getElementById('modal-mask').classList.contains('hidden'),
      title: document.getElementById('modal-title').textContent
    });
  })()`));
  check('C6 有未保存改动时关闭项目先弹确认', c6.modal === true, JSON.stringify(c6));
  await evalJs(`hideModal()`);

  /* C7 分片补读：同步阶段只处理首批，剩余在后续帧完成 */
  const c7a = await evalJs(`(function(){
    Android.readProjectFile = function(){ return 'x'; };
    Android.statFile = function(){ return ''; };
    projectRoot = '/sdcard/P2';
    state.files = [];
    for (var i = 0; i < 20; i++) state.files.push({ name: 'f' + i + '.cpp', content: null, _saved: '', _size: 10, _lazy: true });
    window.__chunkDone = 0;
    ensureAllChunked(function(){ window.__chunkDone = 1; });
    return state.files.filter(function(f){ return f.content !== null; }).length;
  })()`);
  await sleep(200);
  const c7b = JSON.parse(await evalJs(`JSON.stringify({ done: window.__chunkDone, loaded: state.files.filter(function(f){return f.content!==null;}).length })`));
  check('C7 全局搜索补读分片进行（不阻塞主线程）', c7a > 0 && c7a < 20 && c7b.done === 1 && c7b.loaded === 20, 'first=' + c7a + ' ' + JSON.stringify(c7b));

  /* C8 新增 i18n 键中英都有 */
  const c8 = await evalJs(`JSON.stringify({
    zh: !!(I18N.zh.close_project_title && I18N.zh.rename_disk_fail && I18N.zh.delete_disk_fail),
    en: !!(I18N.en.close_project_title && I18N.en.rename_disk_fail && I18N.en.delete_disk_fail)
  })`);
  const c8v = JSON.parse(c8);
  check('C8 新增文案中英同步', c8v.zh && c8v.en, c8);

  /* C9 未加载文件不可被写入（防止 String(null) 被当成正文落盘） */
  const c9 = await evalJs(`(function(){
    state.files = [{ name: 'lazy.cpp', content: null, _saved: '', _size: 10 }];
    var wrote = EditorAPI.setFileContent('lazy.cpp', 'hacked');
    return JSON.stringify({ wrote: wrote, content: state.files[0].content });
  })()`);
  const c9v = JSON.parse(c9);
  check('C9 惰性未加载文件拒绝被写入', c9v.wrote === false && c9v.content === null, c9);

  /* C10 同名不同目录的错误不互相误标 */
  const c10 = JSON.parse(await evalJs(`(function(){
    state.files = [{ name: 'a/util.cpp', content: 'x', _saved: 'x' }, { name: 'b/util.cpp', content: 'y', _saved: 'y' }];
    state.active = 'a/util.cpp';
    var errs = parseCompileErrors('b/util.cpp:12:1: error: boom', 'a/util.cpp');
    showCodeErrors(errs);
    return JSON.stringify({ files: errs.map(function(e){return e.file}), marked: currentErrs.length });
  })()`));
  check('C10 同名文件不互相误标（只认精确路径）', c10.files[0] === 'b/util.cpp' && c10.marked === 0, JSON.stringify(c10));

  /* C11 跨文件点击问题条目后，问题列表不能被 openFile 清空 */
  const c11 = JSON.parse(await evalJs(`(function(){
    projectRoot = '/sdcard/P4';
    state.files = [{ name: 'cur.cpp', content: 'a', _saved: 'a' }, { name: 'other.cpp', content: 'b', _saved: 'b' }];
    state.active = 'cur.cpp';
    setPanelProblems([{ file: 'other.cpp', line: 2, col: 1, message: 'e1' }, { file: 'cur.cpp', line: 3, col: 1, message: 'e2' }]);
    var rows = document.querySelectorAll('#prob-list .prob-row');
    if (rows[0]) rows[0].click();
    return JSON.stringify({ active: state.active, left: panelProblems.length });
  })()`));
  check('C11 点跨文件错误后问题列表仍在', c11.active === 'other.cpp' && c11.left === 2, JSON.stringify(c11));

  /* C12 子目录文件可改名（保持目录） */
  const c12 = JSON.parse(await evalJs(`(function(){
    projectRoot = '/sdcard/P5';
    state.files = [{ name: 'sub/a.cpp', content: 'x', _saved: 'x' }];
    state.active = 'sub/a.cpp';
    state.tabs = ['sub/a.cpp'];
    window.__ren = null;
    Android.renameProjectEntry = function(root, from, to){ window.__ren = { root: root, from: from, to: to }; return true; };
    modalMode = 'rename'; modalTarget = 'sub/a.cpp';
    document.getElementById('modal-input').value = 'b.cpp';
    modalOk();
    return JSON.stringify({ name: state.files[0].name, call: window.__ren });
  })()`));
  check('C12 子目录文件改名保持目录并落盘', c12.name === 'sub/b.cpp' && c12.call && c12.call.to === 'sub/b.cpp', JSON.stringify(c12));

  /* C13 全程无脚本异常 */
  check('C13 全程无未捕获异常', logs.filter(x => !/favicon/.test(x)).length === 0, logs.slice(0, 2).join(' | '));

  let pass = 0;
  results.forEach(r => { console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n + (r.ok || !r.extra ? '' : '  [' + r.extra + ']')); if (r.ok) pass++; });
  console.log('---');
  console.log('== e2e-core: ' + pass + ' passed, ' + (results.length - pass) + ' failed ==');
  ws.close();
  process.exit(pass === results.length ? 0 : 1);
}

/* 看门狗：CDP 目标失效时 promise 可能永挂，Node 会因「事件循环空闲」静默退出（退出码 0），
   看起来像通过。这里保活并在超时后明确失败。 */
const __watchdog = setTimeout(() => {
  console.error('FATAL 测试超时 120s（CDP 连接可能已失效）');
  process.exit(1);
}, 120000);

main().catch(e => { console.error('FATAL', e); process.exit(1); });
