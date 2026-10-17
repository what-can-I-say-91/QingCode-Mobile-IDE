/* QingCode 内置插件：导航与搜索（id: navigator）
   快速打开（文件/类/方法/符号）· 全局搜索替换 · 最近文件 · 书签 */
(function () {
  'use strict';
  var API = window.PCPluginAPI;
  if (!API || typeof API.register !== 'function') return;

  API.register({
    id: 'navigator', name: '导航与搜索', version: '1.0.0', author: 'QingCode',
    description: '快速打开文件/类/方法/符号 · 全局搜索替换 · 最近文件 · 书签',
    onInit: function (api) {
      var E = api && api.editor;
      if (!E) return;
      function T(k, d) { try { return (api.hasI18n && api.hasI18n(k)) ? api.t(k) : d; } catch (e) { return d; } }
      function view() { return E.view || null; }
      function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
      function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

      var RECENT_KEY = 'pc_recent_files', BOOK_KEY = 'pc_bookmarks';
      var recent = lsGet(RECENT_KEY, []);
      var books = lsGet(BOOK_KEY, {});
      if (!Array.isArray(recent)) recent = [];
      if (!books || typeof books !== 'object') books = {};

      function langOf(name) {
        var n = String(name || '').toLowerCase();
        if (n.endsWith('.py')) return 'python';
        if (/\.(cpp|cc|cxx|h|hpp|hh|c)$/.test(n)) return 'cpp';
        if (n.endsWith('.json')) return 'json';
        if (/\.(js|mjs|cjs|ts)$/.test(n)) return 'javascript';
        if (/\.(html|htm)$/.test(n)) return 'html';
        if (n.endsWith('.css')) return 'css';
        if (/\.(md|markdown)$/.test(n)) return 'markdown';
        return null;
      }

      /* ---------- 轻量符号扫描（不依赖 Python 运行时，快） ---------- */
      function scanSymbols(text, lang) {
        var out = [], lines = String(text || '').split('\n');
        for (var i = 0; i < lines.length; i++) {
          var l = lines[i], m;
          if (lang === 'python') {
            if ((m = /^\s*(?:async\s+)?def\s+(\w+)/.exec(l))) out.push({ name: m[1], kind: 'def', line: i + 1 });
            else if ((m = /^\s*class\s+(\w+)/.exec(l))) out.push({ name: m[1], kind: 'class', line: i + 1 });
          } else if (lang === 'cpp') {
            if (/^\s*using\s+namespace/.test(l)) continue;
            if ((m = /\b(class|struct|enum|namespace)\s+(\w+)/.exec(l))) out.push({ name: m[2], kind: m[1], line: i + 1 });
            else if ((m = /^\s*#\s*define\s+(\w+)/.exec(l))) out.push({ name: m[1], kind: 'macro', line: i + 1 });
            else if ((m = /^\s*(?:[\w:]+(?:<[^;{}]*>)?[\w:\*&\s]*?)\s+(\w+)\s*\([^;{}]*\)\s*(?:const\s*)?\{/.exec(l)) &&
                     ['if', 'for', 'while', 'switch', 'return', 'catch'].indexOf(m[1]) < 0) out.push({ name: m[1], kind: 'func', line: i + 1 });
          }
        }
        return out;
      }
      function allSymbols() {
        var files = E.files ? E.files() : [];
        var out = [];
        files.forEach(function (f) {
          var lg = langOf(f.name);
          if (!lg) return;
          scanSymbols(f.content, lg).forEach(function (s) { out.push({ name: s.name, kind: s.kind, line: s.line, file: f.name }); });
        });
        return out;
      }

      /* ---------- 通用面板 ---------- */
      var mode = 'file', items = [], sel = 0, pendingReplace = null;
      function panel() {
        var el = document.getElementById('nav-panel');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'nav-panel';
        el.className = 'hidden';
        el.innerHTML = '<div class="nv-head"><span id="nv-title" class="nv-title"></span>' +
          '<input id="nv-input" type="text" autocomplete="off" spellcheck="false">' +
          '<button id="nv-close" class="nv-x">×</button></div>' +
          '<div id="nv-repl" class="nv-repl hidden"><input id="nv-replace" type="text" placeholder="" autocomplete="off" spellcheck="false">' +
          '<button id="nv-replace-all" class="nv-btn"></button></div>' +
          '<div id="nv-body"></div>';
        document.body.appendChild(el);
        el.querySelector('#nv-close').addEventListener('mousedown', function (e) { e.preventDefault(); });
        el.querySelector('#nv-close').addEventListener('click', function () { close(); });
        var inp = el.querySelector('#nv-input');
        inp.addEventListener('input', function () { render(); });
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { e.preventDefault(); close(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); markSel(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); markSel(); }
          else if (e.key === 'Enter') { e.preventDefault(); var it = items[sel]; if (it) it.run(); }
        });
        var ra = el.querySelector('#nv-replace-all');
        ra.addEventListener('mousedown', function (e) { e.preventDefault(); });
        ra.addEventListener('click', function () { doReplaceAll(); });
        return el;
      }
      function close() { var el = document.getElementById('nav-panel'); if (el) el.classList.add('hidden'); if (view()) try { E.focus(); } catch (e) {} }
      function open(m, title) {
        mode = m;
        var el = panel();
        el.classList.remove('hidden');
        el.querySelector('#nv-title').textContent = title;
        el.querySelector('#nv-input').value = '';
        el.querySelector('#nv-input').placeholder = T('nv_ph_' + m, '');
        var showRepl = (m === 'search');
        el.querySelector('#nv-repl').classList.toggle('hidden', !showRepl);
        if (showRepl) {
          el.querySelector('#nv-replace').value = '';
          el.querySelector('#nv-replace').placeholder = T('nv_repl_ph', '替换为…');
          el.querySelector('#nv-replace-all').textContent = T('nv_repl_all', '全部替换');
        }
        sel = 0;
        render();
        setTimeout(function () { el.querySelector('#nv-input').focus(); }, 40);
      }
      function markSel() {
        var rows = document.querySelectorAll('#nv-body .nv-row');
        rows.forEach(function (r, i) { r.classList.toggle('act', i === sel); });
        var a = rows[sel]; if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' });
      }
      function render() {
        var el = document.getElementById('nav-panel'); if (!el) return;
        var q = String(el.querySelector('#nv-input').value || '').toLowerCase();
        var body = el.querySelector('#nv-body');
        body.innerHTML = '';
        items = [];
        function row(title, sub, meta, run) {
          var b = document.createElement('button');
          b.className = 'nv-row';
          var a = document.createElement('span'); a.className = 'nv-name'; a.textContent = title;
          var c = document.createElement('span'); c.className = 'nv-meta'; c.textContent = meta || '';
          b.appendChild(a); b.appendChild(c);
          if (sub) { var d = document.createElement('span'); d.className = 'nv-sub'; d.textContent = sub; b.appendChild(d); }
          b.addEventListener('mousedown', function (e) { e.preventDefault(); });
          b.addEventListener('click', run);
          body.appendChild(b);
          items.push({ run: run });
        }
        if (mode === 'file') {
          (E.files ? E.files() : []).forEach(function (f) {
            if (q && f.name.toLowerCase().indexOf(q) < 0) return;
            row(f.name, '', langOf(f.name) || '', function () { E.openFile(f.name); close(); });
          });
        } else if (mode === 'symbol' || mode === 'gsymbol') {
          var list = mode === 'symbol' ? (function () {
            var act = E.activeFileName ? E.activeFileName() : '';
            var f = (E.files ? E.files() : []).filter(function (x) { return x.name === act; })[0];
            return f ? scanSymbols(f.content, langOf(f.name)).map(function (s) { return { name: s.name, kind: s.kind, line: s.line, file: f.name }; }) : [];
          })() : allSymbols();
          list.forEach(function (s) {
            if (q && s.name.toLowerCase().indexOf(q) < 0) return;
            row(s.name, s.file + ' : ' + s.line, s.kind, function () { E.openFile(s.file); setTimeout(function () { E.gotoLine(s.line, 1); }, 120); close(); });
          });
        } else if (mode === 'recent') {
          recent.forEach(function (f) {
            if (q && String(f).toLowerCase().indexOf(q) < 0) return;
            row(f, '', 'recent', function () { E.openFile(f); close(); });
          });
        } else if (mode === 'bookmark') {
          var any = false;
          Object.keys(books).forEach(function (fn) {
            (books[fn] || []).forEach(function (ln) {
              var files = E.files ? E.files() : [];
              var f = files.filter(function (x) { return x.name === fn; })[0];
              var txt = '';
              if (f) { var arr = String(f.content).split('\n'); txt = (arr[ln - 1] || '').trim().slice(0, 80); }
              if (q && (fn + ' ' + txt).toLowerCase().indexOf(q) < 0) return;
              any = true;
              row(fn + ':' + ln, txt, '🔖', function () { E.openFile(fn); setTimeout(function () { E.gotoLine(ln, 1); }, 120); close(); });
            });
          });
          if (!any) { body.innerHTML = '<div class="nv-empty">' + T('nv_no_bm', '还没有书签（工具栏 🔖 可标记当前行）') + '</div>'; }
        } else if (mode === 'search') {
          if (!q) { body.innerHTML = '<div class="nv-empty">' + T('nv_search_hint', '输入关键字或正则，回车/点条目跳转') + '</div>'; return; }
          var flags = 'gi', re = null;
          try { re = new RegExp(el.querySelector('#nv-input').value, flags); } catch (e) { re = null; }
          if (!re) { body.innerHTML = '<div class="nv-empty">' + T('nv_bad_re', '正则表达式无效') + '</div>'; return; }
          var hits = 0;
          (E.files ? E.files() : []).forEach(function (f) {
            var lines = String(f.content).split('\n');
            for (var i = 0; i < lines.length && hits < 400; i++) {
              re.lastIndex = 0;
              if (!re.test(lines[i])) continue;
              hits++;
              (function (fn, ln, txt) {
                row(fn + ':' + ln, txt.trim().slice(0, 100), '🔍', function () { E.openFile(fn); setTimeout(function () { E.gotoLine(ln, 1); }, 120); close(); });
              })(f.name, i + 1, lines[i]);
            }
          });
          if (!hits) body.innerHTML = '<div class="nv-empty">' + T('nv_no_hit', '没有匹配结果') + '</div>';
          pendingReplace = el.querySelector('#nv-input').value;
        }
        markSel();
      }
      function doReplaceAll() {
        var el = document.getElementById('nav-panel'); if (!el) return;
        var q = String(el.querySelector('#nv-input').value || '');
        var rp = String(el.querySelector('#nv-replace').value || '');
        if (!q) return;
        var re;
        try { re = new RegExp(q, 'g'); } catch (e) { if (api.meta) api.meta(T('nv_bad_re', '正则表达式无效')); return; }
        var total = 0, filesChanged = 0;
        (E.files ? E.files() : []).forEach(function (f) {
          var before = String(f.content);
          re.lastIndex = 0;
          var after = before.replace(re, rp);
          if (after !== before) { E.setFileContent(f.name, after); filesChanged++; total += (before.length - after.length === 0 ? 1 : 1); }
        });
        if (E.saveAll) E.saveAll();
        if (api.meta) api.meta(T('nv_replaced', '已替换') + '：' + filesChanged + ' ' + T('nv_files', '个文件'));
        render();
      }

      /* ---------- 最近文件 ---------- */
      function pushRecent(name) {
        if (!name) return;
        recent = [name].concat(recent.filter(function (x) { return x !== name; })).slice(0, 20);
        lsSet(RECENT_KEY, recent);
      }
      if (E.on) E.on('fileOpen', function (p) { if (p && p.name) pushRecent(p.name); });

      /* ---------- 书签 ---------- */
      function currentLine() {
        var v = view(); if (!v) return 0;
        var pos = v.state.selection.main.head;
        return v.state.doc.lineAt(pos).number;
      }
      function toggleBookmark() {
        var fn = E.activeFileName ? E.activeFileName() : '';
        if (!fn) return false;
        var ln = currentLine();
        books[fn] = books[fn] || [];
        var i = books[fn].indexOf(ln);
        if (i >= 0) { books[fn].splice(i, 1); if (api.meta) api.meta(T('nv_bm_removed', '已移除书签') + ' L' + ln); }
        else { books[fn].push(ln); books[fn].sort(function (a, b) { return a - b; }); if (api.meta) api.meta(T('nv_bm_added', '已添加书签') + ' L' + ln); }
        if (!books[fn].length) delete books[fn];
        lsSet(BOOK_KEY, books);
        return true;
      }

      /* ---------- 命令 ---------- */
      function cmd(id, k, run) { E.registerCommand(id, { label: T(k, id), labelKey: k, group: 'nav', run: run }); }
      cmd('nav.quickOpen', 'nv_cmd_open', function () { open('file', T('nv_title_open', '快速打开文件')); return true; });
      cmd('nav.symbols', 'nv_cmd_symbols', function () { open('symbol', T('nv_title_symbols', '当前文件符号')); return true; });
      cmd('nav.gsymbols', 'nv_cmd_gsymbols', function () { open('gsymbol', T('nv_title_gsymbols', '全局符号')); return true; });
      cmd('nav.search', 'nv_cmd_search', function () { open('search', T('nv_title_search', '全局搜索替换')); return true; });
      cmd('nav.recent', 'nv_cmd_recent', function () { open('recent', T('nv_title_recent', '最近文件')); return true; });
      cmd('nav.bookmarks', 'nv_cmd_bookmarks', function () { open('bookmark', T('nv_title_bookmarks', '书签')); return true; });
      cmd('nav.toggleBookmark', 'nv_cmd_toggle_bm', toggleBookmark);

      /* ---------- 工具栏 ---------- */
      [{ icon: '📂', k: 'nv_cmd_open', id: 'nav.quickOpen', order: 120 },
       { icon: '🔍', k: 'nv_cmd_search', id: 'nav.search', order: 130 },
       { icon: '🔖', k: 'nv_cmd_toggle_bm', id: 'nav.toggleBookmark', order: 140 }].forEach(function (b) {
        E.addToolbarButton({ icon: b.icon, label: T(b.k, b.id), order: b.order, run: function () { E.runCommand(b.id); } });
      });

      pushRecent(E.activeFileName ? E.activeFileName() : '');
      if (api.meta) api.meta(T('nv_loaded', '[导航与搜索] 已加载'));
    }
  });
})();
