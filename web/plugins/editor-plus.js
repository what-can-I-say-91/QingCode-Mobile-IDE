/* QingCode 内置插件：编辑增强（id: editor-plus）
   一个插件承载全部可选编辑能力，经 PCPluginAPI v3 的 editor 接口装配。
   随 APK 打包、启动时最先加载（早于 /sdcard 用户插件）；单条命令失败不影响编辑器核心。
   文案全部走 PCPluginAPI.t()，字典缺失时回退中文。 */
(function () {
  'use strict';
  var P = window.PCPluginAPI;
  if (!P || typeof P.register !== 'function') return;

  function lightFormat(text, lang) {
    var lines = String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].replace(/[ \t]+$/, '');
      if (lang === 'python') l = l.replace(/^( +)\t+/g, function (m, sp) { return sp + '    '; });
      out.push(l);
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n') + '\n';
  }

  var USER_KEY = 'pc_user_snippets';

  P.register({
    id: 'editor-plus', name: '编辑增强', version: '2.0.0', author: 'QingCode',
    description: '多光标 / 行操作 / 折叠 / 缩进 / 补全 / 片段 / 格式化 / 命令面板',
    onInit: function (api) {
      var E = api && api.editor;
      if (!E) return;
      var M = E.modules || {};
      /** 文案：优先 i18n 字典，其次中文兜底 */
      function T(k, d) { try { return (api.hasI18n && api.hasI18n(k)) ? api.t(k) : d; } catch (e) { return d; } }
      function view() { return E.view || null; }
      function guard(fn) {
        return function () {
          var v = view(); if (!v) return false;
          try { var r = fn(v); if (E.focus) E.focus(); return r === undefined ? true : r; }
          catch (e) { if (api.meta) api.meta('[editor-plus] ' + (e && e.message ? e.message : e)); return false; }
        };
      }
      function reg(id, k, group, run) { E.registerCommand(id, { label: T(k, id), labelKey: k, group: group, run: guard(run) }); }

      /* ---- 基础 / 缩进 ---- */
      reg('edit.undo', 'ep_undo', 'basic', function (v) { M.undo(v); });
      reg('edit.redo', 'ep_redo', 'basic', function (v) { M.redo(v); });
      reg('edit.indentMore', 'ep_indentMore', 'indent', function (v) { M.indentMore(v); });
      reg('edit.indentLess', 'ep_indentLess', 'indent', function (v) { M.indentLess(v); });
      reg('edit.transpose', 'ep_transpose', 'indent', function (v) { M.transposeChars(v); });

      /* ---- 行操作 ---- */
      reg('line.up', 'ep_lineUp', 'line', function (v) { M.moveLineUp(v); });
      reg('line.down', 'ep_lineDown', 'line', function (v) { M.moveLineDown(v); });
      reg('line.copyUp', 'ep_copyUp', 'line', function (v) { M.copyLineUp(v); });
      reg('line.copyDown', 'ep_copyDown', 'line', function (v) { M.copyLineDown(v); });
      reg('line.delete', 'ep_lineDelete', 'line', function (v) { M.deleteLine(v); });
      reg('line.comment', 'ep_comment', 'line', function (v) { M.toggleComment(v); });
      reg('line.split', 'ep_split', 'line', function (v) { M.splitLine(v); });
      reg('line.duplicate', 'ep_duplicate', 'line', function (v) {
        var s = v.state, ch = [], anchor = 0;
        for (var i = 0; i < s.selection.ranges.length; i++) {
          var r = s.selection.ranges[i], ln = s.doc.lineAt(r.head);
          var text = s.doc.sliceString(ln.from, ln.to);
          ch.push({ from: ln.to, insert: '\n' + text });
          if (!i) anchor = r.head + text.length + 1;
        }
        v.dispatch({ changes: ch, selection: { anchor: anchor } });
      });
      reg('line.join', 'ep_join', 'line', function (v) {
        var s = v.state, ch = [];
        for (var i = 0; i < s.selection.ranges.length; i++) {
          var r = s.selection.ranges[i], ln = s.doc.lineAt(r.head);
          if (ln.number >= s.doc.lines) continue;
          ch.push({ from: ln.to, to: s.doc.line(ln.number + 1).from, insert: ' ' });
        }
        if (ch.length) v.dispatch({ changes: ch });
      });

      /* ---- 折叠 ---- */
      reg('fold.toggle', 'ep_foldToggle', 'fold', function (v) {
        var s = v.state, ln = s.doc.lineAt(s.selection.main.head);
        var r = M.foldable ? M.foldable(s, ln.from, ln.to) : null;
        if (r) M.foldCode(v, ln.from); else M.unfoldCode(v, ln.from);
      });
      reg('fold.all', 'ep_foldAll', 'fold', function (v) { M.foldAll(v); });
      reg('fold.unfoldAll', 'ep_unfoldAll', 'fold', function (v) { M.unfoldAll(v); });

      /* ---- 多光标 ---- */
      reg('cursor.above', 'ep_cursorAbove', 'cursor', function (v) { M.addCursorAbove(v); });
      reg('cursor.below', 'ep_cursorBelow', 'cursor', function (v) { M.addCursorBelow(v); });
      reg('cursor.nextOccurrence', 'ep_cursorNext', 'cursor', function (v) { M.selectNextOccurrence(v); });
      reg('cursor.clear', 'ep_cursorClear', 'cursor', function (v) { v.dispatch({ selection: { anchor: v.state.selection.main.head } }); });

      /* 多光标模式：点空白处加光标，点已有光标移除 */
      var mcMode = false;
      function setMcMode(on) {
        mcMode = !!on;
        if (api.meta) api.meta(T(mcMode ? 'ep_mc_on' : 'ep_mc_off', mcMode ? '多光标模式：开（点击空白处加光标）' : '多光标模式：关'));
        if (mcBtn) { mcBtn.el.style.background = mcMode ? 'rgba(79,124,255,.30)' : ''; }
      }
      E.registerCommand('cursor.mode', { label: T('ep_cursorMode', '多光标模式'), group: 'cursor', run: function () { setMcMode(!mcMode); return true; } });
      if (M.EditorView && M.EditorSelection) {
        E.addExtension(M.EditorView.domEventHandlers({
          mousedown: function (e, v) {
            if (!mcMode || e.button !== 0) return false;
            var pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos == null) return false;
            var ranges = v.state.selection.ranges.slice();
            var hit = -1;
            for (var i = 0; i < ranges.length; i++) if (ranges[i].head === pos) { hit = i; break; }
            if (hit >= 0 && ranges.length > 1) ranges.splice(hit, 1);
            else ranges.push(M.EditorSelection.cursor(pos));
            v.dispatch({ selection: M.EditorSelection.create(ranges) });
            return true;
          }
        }));
      }

      /* ---- 片段 ---- */
      var BUILTIN = {
        python: [
          { label: 'def', detail: T('ep_snip_def', '函数定义'), template: 'def ${name}(${args}):\n    ${pass}' },
          { label: 'class', detail: T('ep_snip_class', '类定义'), template: 'class ${Name}:\n    def __init__(self${args}):\n        ${pass}' },
          { label: 'for', detail: T('ep_snip_for', 'for 循环'), template: 'for ${i} in ${iterable}:\n    ${pass}' },
          { label: 'ifmain', detail: T('ep_snip_main', 'main 入口'), template: 'if __name__ == "__main__":\n    ${main()}' },
          { label: 'try', detail: T('ep_snip_try', 'try/except'), template: 'try:\n    ${pass}\nexcept ${Exception} as e:\n    ${pass}' }
        ],
        cpp: [
          { label: 'main', detail: T('ep_snip_cmain', 'main 函数'), template: 'int main() {\n    ${}\n    return 0;\n}' },
          { label: 'for', detail: T('ep_snip_for', 'for 循环'), template: 'for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n    ${}\n}' },
          { label: 'vec', detail: T('ep_snip_vec', 'vector 声明'), template: 'std::vector<${int}> ${v};' },
          { label: 'cout', detail: T('ep_snip_cout', '输出'), template: 'std::cout << ${expr} << std::endl;' },
          { label: 'cin', detail: T('ep_snip_cin', '输入'), template: 'std::cin >> ${var};' }
        ]
      };
      function loadUser() {
        try { var o = JSON.parse(localStorage.getItem(USER_KEY) || '{}'); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
      }
      function saveUser(o) { try { localStorage.setItem(USER_KEY, JSON.stringify(o)); } catch (e) {} }
      function applySnippets() {
        var user = loadUser();
        for (var lang in BUILTIN) if (Object.prototype.hasOwnProperty.call(BUILTIN, lang)) {
          var list = BUILTIN[lang].slice();
          var u = user[lang] || [];
          for (var i = 0; i < u.length; i++) {
            if (!u[i] || !u[i].label || !u[i].template) continue;
            list.push({ label: String(u[i].label), detail: String(u[i].detail || ''), template: String(u[i].template) });
          }
          if (E.setSnippets) E.setSnippets(lang, list);
          else if (E.registerSnippets) E.registerSnippets(lang, list);
        }
      }
      applySnippets();

      /* 片段管理页（插件管理 → 片段） */
      if (api.page) {
        api.page('ep-snippets', {
          title: T('ep_snippets', '片段'),
          render: function (box) {
            box.innerHTML = '';
            var hint = document.createElement('div'); hint.className = 'pp-hint';
            hint.textContent = T('ep_snips_hint', '自定义片段保存在本机，保存后立即生效；模板用 ${name} 表示可跳转占位。');
            box.appendChild(hint);
            var user = loadUser();

            function row(lang, sn, idx) {
              var d = document.createElement('div'); d.className = 'pp-card';
              var head = document.createElement('div'); head.className = 'pp-card-head';
              var nm = document.createElement('span'); nm.className = 'pp-card-name'; nm.textContent = sn.label;
              var ver = document.createElement('span'); ver.className = 'pp-card-ver'; ver.textContent = lang;
              head.appendChild(nm); head.appendChild(ver);
              d.appendChild(head);
              var pre = document.createElement('div'); pre.className = 'pp-card-desc';
              pre.style.whiteSpace = 'pre-wrap'; pre.style.fontFamily = 'monospace';
              pre.textContent = sn.template;
              d.appendChild(pre);
              var foot = document.createElement('div'); foot.className = 'pp-card-foot';
              var del = document.createElement('button'); del.className = 'pp-btn';
              del.textContent = T('ep_del', '删除');
              del.addEventListener('click', function () {
                user[lang].splice(idx, 1);
                saveUser(user); applySnippets();
                api.page && renderBox(box);
                if (api.meta) api.meta(T('ep_saved', '已保存'));
              });
              foot.appendChild(del); d.appendChild(foot);
              return d;
            }
            function renderBox(box2) {
              box2.innerHTML = '';
              box2.appendChild(hint);
              var any = false;
              for (var lang in user) {
                if (!Object.prototype.hasOwnProperty.call(user, lang)) continue;
                for (var i = 0; i < user[lang].length; i++) { box2.appendChild(row(lang, user[lang][i], i)); any = true; }
              }
              if (!any) {
                var e0 = document.createElement('div'); e0.className = 'pp-empty';
                e0.textContent = T('ep_snip_none', '还没有自定义片段，用下面的表单添加。');
                box2.appendChild(e0);
              }
              // 新增表单
              var form = document.createElement('div'); form.className = 'pp-card';
              var h2 = document.createElement('div'); h2.className = 'pp-card-head';
              var t2 = document.createElement('span'); t2.className = 'pp-card-name'; t2.textContent = T('ep_add', '新增片段');
              h2.appendChild(t2); form.appendChild(h2);
              var langSel = document.createElement('select');
              ['python', 'cpp'].forEach(function (l) { var o = document.createElement('option'); o.value = l; o.textContent = l; langSel.appendChild(o); });
              langSel.style.cssText = 'margin:8px 0;padding:6px;border-radius:6px;background:#1e1e1e;color:#ddd;border:1px solid #444';
              form.appendChild(langSel);
              var inLabel = document.createElement('input'); inLabel.placeholder = T('ep_snip_label', '触发词，如 mylog');
              var inDetail = document.createElement('input'); inDetail.placeholder = T('ep_snip_detail', '说明（可空）');
              var inTpl = document.createElement('textarea'); inTpl.placeholder = T('ep_snip_tpl', '模板，例如 print(${x})');
              [inLabel, inDetail, inTpl].forEach(function (el) {
                el.style.cssText = 'display:block;width:100%;margin:6px 0;padding:8px;border-radius:6px;background:#1e1e1e;color:#ddd;border:1px solid #444;font-family:inherit';
                form.appendChild(el);
              });
              inTpl.rows = 4;
              var save = document.createElement('button'); save.className = 'pp-btn';
              save.textContent = T('ep_save', '保存');
              save.addEventListener('click', function () {
                var l = langSel.value, lab = inLabel.value.trim(), tpl = inTpl.value;
                if (!lab || !tpl) { if (api.meta) api.meta(T('ep_need', '触发词和模板都不能为空')); return; }
                user[l] = user[l] || [];
                user[l].push({ label: lab, detail: inDetail.value.trim(), template: tpl });
                saveUser(user); applySnippets();
                if (api.meta) api.meta(T('ep_saved', '已保存'));
                renderBox(box2);
              });
              var foot = document.createElement('div'); foot.className = 'pp-card-foot';
              foot.appendChild(save); form.appendChild(foot);
              box2.appendChild(form);
            }
            renderBox(box);
          }
        });
      }
      reg('snippets.manage', 'ep_snippets', 'snippets', function () {
        if (typeof openPluginPage === 'function') { openPluginPage(); switchPluginTab('ep-snippets'); }
        else if (E.openCommandPalette) E.openCommandPalette('snippets.');
      });

      /* ---- 格式化 ---- */
      reg('format.light', 'ep_formatLight', 'format', function (v) {
        var before = v.state.doc.toString();
        var after = lightFormat(before, E.currentLanguage ? E.currentLanguage() : null);
        if (after === before) return;
        v.dispatch({ changes: { from: 0, to: before.length, insert: after } });
      });
      E.registerCommand('format.termux', { label: T('ep_formatTermux', '格式化（Termux：clang-format / black）'), group: 'format', run: function () {
        var v = view(); if (!v) return;
        var lang = E.currentLanguage ? E.currentLanguage() : '';
        var py = lang === 'python';
        var bin = py ? 'black' : 'clang-format';
        var pkg = py ? 'python-black' : 'clang-tools';
        var name = py ? 'fmt_input.py' : 'fmt_input.cpp';
        var code = v.state.doc.toString();
        if (!api.writeSwapFile || !api.runCapture) { api.out('[format] ' + T('ep_only_android', '该能力仅在安卓应用内可用') + '\n', 'out-err'); return; }
        if (!api.writeSwapFile(name, code)) { api.out('[format] ' + T('ep_write_fail', '写入交换目录失败（检查「所有文件访问」权限）') + '\n', 'out-err'); return; }
        api.runCapture('command -v ' + bin).then(function (r) {
          if (!r || r.code !== 0 || !String(r.output || '').trim()) {
            api.out('[format] ' + T('ep_fmt_missing', '未安装') + ' ' + bin + '。' + (py ? 'pkg install -y ' : 'pkg install -y ') + pkg + '\n', 'out-err');
            return;
          }
          var cmd = py ? (bin + ' -q - < /sdcard/QingCode/' + name) : (bin + ' < /sdcard/QingCode/' + name);
          return api.runCapture(cmd).then(function (r2) {
            var outText = String((r2 && r2.output) || '');
            if (r2 && r2.code === 0 && outText.trim()) {
              var b2 = v.state.doc.toString();
              if (outText !== b2) v.dispatch({ changes: { from: 0, to: b2.length, insert: outText } });
              if (api.meta) api.meta('[format] ' + T('ep_fmt_done', '已完成') + ' (' + bin + ')');
            } else api.out('[format] ' + bin + ' ' + T('ep_fmt_fail', '执行失败') + '：' + outText.slice(0, 400) + '\n', 'out-err');
          });
        });
      } });

      /* ---- 工具栏 ---- */
      var mcBtn = null;
      var TB = [
        { icon: '↶', k: 'ep_undo', order: 10, cmd: 'edit.undo' },
        { icon: '↷', k: 'ep_redo', order: 20, cmd: 'edit.redo' },
        { icon: '⇤', k: 'ep_indentLess', order: 30, cmd: 'edit.indentLess' },
        { icon: '⇥', k: 'ep_indentMore', order: 40, cmd: 'edit.indentMore' },
        { icon: '▸', k: 'ep_foldToggle', order: 50, cmd: 'fold.toggle' },
        { icon: '⊕', k: 'ep_cursorMode', order: 60, cmd: 'cursor.mode', id: 'mc' },
        { icon: '≡', k: 'ep_lineOps', order: 70, cmd: 'ui.commands.line' },
        { icon: '✨', k: 'ep_formatLight', order: 90, cmd: 'format.light' }
      ];
      if (E.addToolbarButton) {
        for (var i = 0; i < TB.length; i++) (function (b) {
          var el = E.addToolbarButton({
            icon: b.icon, label: T(b.k, b.cmd), order: b.order,
            run: function () {
              if (b.cmd === 'ui.commands.line') { if (E.openCommandPalette) E.openCommandPalette('line.', { noInput: true, title: T('ep_lineOps', '行操作') }); return; }
              if (E.runCommand) E.runCommand(b.cmd);
            }
          });
          if (b.id === 'mc') mcBtn = { el: el };
        })(TB[i]);
      }
      E.registerCommand('ui.commands.line', { label: T('ep_lineOps', '行操作'), group: 'ui', run: function () { if (E.openCommandPalette) E.openCommandPalette('line.', { noInput: true, title: T('ep_lineOps', '行操作') }); } });

      /* ---- 补全 ---- */
      var CD = E.completionData || null;
      if (CD && M.EditorState && M.snippetCompletion) {
        function detectImports(text, lang) {
          var set = Object.create(null), m;
          if (lang === 'python') {
            var re1 = /^\s*import\s+([\w.]+)/gm;
            while ((m = re1.exec(text))) set[m[1].split('.')[0]] = 1;
            var re2 = /^\s*from\s+([\w.]+)\s+import/gm;
            while ((m = re2.exec(text))) set[m[1].split('.')[0]] = 1;
          } else {
            var re3 = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm;
            while ((m = re3.exec(text))) set[m[1]] = 1;
          }
          return set;
        }
        function buildCompletions(ctx) {
          var lang = E.currentLanguage ? E.currentLanguage() : null;
          if (!lang || !CD.keywords[lang]) return null;
          var state = ctx.state, pos = ctx.pos;
          var line = state.doc.lineAt(pos);
          var before = line.text.slice(0, pos - line.from);
          var items = [], seen = Object.create(null);
          function add(label, apply, detail, type) {
            if (seen[label]) return;
            seen[label] = 1;
            items.push({ label: label, apply: apply, detail: detail, type: type });
          }
          var mem = /([\w]+)(?:\.|::)(\w*)$/.exec(before);
          if (mem) {
            var obj = mem[1], typed = mem[2] || '';
            var libs = detectImports(state.doc.sliceString(0, pos), lang);
            var table = (CD.members[lang] || {})[obj];
            if (table && (libs[obj] || lang === 'python')) {
              var sep = lang === 'cpp' ? '::' : '.';
              for (var i = 0; i < table.length; i++) add(obj + sep + table[i], table[i], obj, 'property');
              return { from: pos - typed.length, options: items, validFor: /^[\w$]*$/ };
            }
            if (lang === 'cpp' && obj === 'std') {
              var st = CD.members.cpp.std;
              for (var j = 0; j < st.length; j++) add('std::' + st[j], st[j], 'std', 'property');
              return { from: pos - typed.length, options: items, validFor: /^[\w$]*$/ };
            }
            return null;
          }
          if (/#\s*include\s*[<"][\w]*$/.test(before)) {
            var w0 = /([\w]*)$/.exec(before)[1];
            for (var k = 0; k < CD.includes.length; k++) add(CD.includes[k], CD.includes[k], 'header', 'keyword');
            return { from: pos - w0.length, options: items, validFor: /^[\w]*$/ };
          }
          var word = /[\w$]*$/.exec(before)[0];
          if (!word) return null;
          var kws = CD.keywords[lang] || [];
          for (var a = 0; a < kws.length; a++) if (kws[a] !== word) add(kws[a], kws[a], null, 'keyword');
          var docText = state.doc.toString(), ids = Object.create(null);
          var re = /[\w$]{3,}/g, mm, nn = 0;
          while ((mm = re.exec(docText)) && nn < 300) { if (!ids[mm[0]]) { ids[mm[0]] = 1; nn++; } }
          for (var id in ids) if (id !== word) add(id, id, null, 'text');
          var snips = E.getSnippets ? E.getSnippets(lang) : [];
          for (var s2 = 0; s2 < snips.length; s2++) {
            var sn = snips[s2];
            if (seen[sn.label]) continue;
            seen[sn.label] = 1;
            items.push(M.snippetCompletion(sn.template, { label: sn.label, detail: sn.detail, type: 'snippet' }));
          }
          if (!items.length) return null;
          return { from: pos - word.length, options: items, validFor: /^[\w$]*$/ };
        }
        E.addExtension(M.autocompletion({ override: [buildCompletions] }));
      }

      if (api.meta) api.meta(T('ep_loaded', '[编辑增强] 已加载') + ' ' + (E.listCommands ? E.listCommands().length : 0) + ' ' + T('ep_cmds', '条命令'));
    }
  });
})();
