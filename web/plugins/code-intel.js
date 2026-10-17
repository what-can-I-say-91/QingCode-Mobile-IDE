/* QingCode 内置插件：代码理解与智能（id: code-intel）
   语义分析 / 类型提示 / 错误警告 / 跳转定义 / 查找引用 / 查看实现 / 符号搜索 / 内联文档 / 调用层级
   Python：借助 Pyodide 的 ast 做真语义分析；C++：纯前端启发式（无 clang 前端的现实取舍）。 */
(function () {
  'use strict';
  var API = window.PCPluginAPI;
  if (!API || typeof API.register !== 'function') return;

  /* ===== Python 分析脚本（在 Pyodide 中执行，返回 JSON 字符串） ===== */
  var PY_SCRIPT = [
    'import ast, json, base64, builtins',
    'src = base64.b64decode(__CI_B64__).decode("utf-8")',
    'out = {"ok": True, "defs": [], "refs": [], "calls": [], "diagnostics": []}',
    'try:',
    '    tree = ast.parse(src)',
    'except SyntaxError as e:',
    '    out["ok"] = False',
    '    out["diagnostics"].append({"line": e.lineno or 1, "col": e.offset or 1, "severity": "error", "message": "SyntaxError: " + (e.msg or ""), "code": "syntax"})',
    '    print(json.dumps(out)); raise SystemExit',
    '',
    'def _doc(n):',
    '    d = ast.get_docstring(n)',
    '    return d.strip().split("\\n")[0][:200] if d else ""',
    '',
    'def _ann(a):',
    '    if a is None: return ""',
    '    try: return ast.unparse(a)',
    '    except Exception: return ""',
    '',
    'def _infer(n):',
    '    if isinstance(n, ast.Constant):',
    '        return "None" if n.value is None else type(n.value).__name__',
    '    if isinstance(n, ast.List): return "list"',
    '    if isinstance(n, ast.Dict): return "dict"',
    '    if isinstance(n, ast.Set): return "set"',
    '    if isinstance(n, ast.Tuple): return "tuple"',
    '    if isinstance(n, ast.JoinedStr): return "str"',
    '    if isinstance(n, ast.Call):',
    '        f = n.func',
    '        if isinstance(f, ast.Name): return f.id',
    '        if isinstance(f, ast.Attribute): return f.attr',
    '    if isinstance(n, ast.BinOp) and isinstance(n.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)): return "number"',
    '    return ""',
    '',
    'defs, refs, calls = out["defs"], out["refs"], out["calls"]',
    'for n in ast.walk(tree):',
    '    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):',
    '        a = n.args',
    '        ps = []',
    '        for x in list(a.posonlyargs) + list(a.args) + list(a.kwonlyargs):',
    '            ps.append(x.arg + (": " + _ann(x.annotation) if x.annotation else ""))',
    '        ret = _ann(n.returns)',
    '        sig = "(" + ", ".join(ps) + ")"',
    '        if ret: sig += " -> " + ret',
    '        defs.append({"name": n.name, "kind": "function", "line": n.lineno, "col": n.col_offset + 1, "type": sig, "doc": _doc(n)})',
    '    elif isinstance(n, ast.ClassDef):',
    '        defs.append({"name": n.name, "kind": "class", "line": n.lineno, "col": n.col_offset + 1, "type": "class", "doc": _doc(n)})',
    '    elif isinstance(n, ast.Assign):',
    '        for t in n.targets:',
    '            if isinstance(t, ast.Name):',
    '                defs.append({"name": t.id, "kind": "variable", "line": n.lineno, "col": n.col_offset + 1, "type": _infer(n.value), "doc": ""})',
    '    elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name):',
    '        defs.append({"name": n.target.id, "kind": "variable", "line": n.lineno, "col": n.col_offset + 1, "type": _ann(n.annotation), "doc": ""})',
    '    elif isinstance(n, (ast.Import, ast.ImportFrom)):',
    '        for al in n.names:',
    '            nm = al.asname or al.name.split(".")[0]',
    '            defs.append({"name": nm, "kind": "import", "line": n.lineno, "col": n.col_offset + 1, "type": "module", "doc": ""})',
    '',
    'for n in ast.walk(tree):',
    '    if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load):',
    '        refs.append({"name": n.id, "line": n.lineno, "col": n.col_offset + 1})',
    '    elif isinstance(n, ast.Call):',
    '        f = n.func',
    '        ce = f.id if isinstance(f, ast.Name) else (f.attr if isinstance(f, ast.Attribute) else "")',
    '        if ce:',
    '            calls.append({"callee": ce, "line": n.lineno})',
    '            refs.append({"name": ce, "line": n.lineno, "col": n.col_offset + 1})',
    '',
    'bound = set(dir(builtins)) | {"__name__", "__file__", "__doc__", "__spec__", "self", "cls", "super"}',
    'for n in ast.walk(tree):',
    '    if isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)):',
    '        bound.add(n.id)',
    '    elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):',
    '        bound.add(n.name)',
    '    elif isinstance(n, ast.arg):',
    '        bound.add(n.arg)',
    '    elif isinstance(n, ast.ExceptHandler) and n.name:',
    '        bound.add(n.name)',
    '    elif isinstance(n, ast.Global):',
    '        for g in n.names: bound.add(g)',
    '    elif isinstance(n, ast.Nonlocal):',
    '        for g in n.names: bound.add(g)',
    '    elif isinstance(n, (ast.Import, ast.ImportFrom)):',
    '        for al in n.names: bound.add(al.asname or al.name.split(".")[0])',
    '    elif isinstance(n, ast.alias):',
    '        bound.add(n.asname or n.name.split(".")[0])',
    '    elif isinstance(n, ast.comprehension):',
    '        pass',
    '',
    'seen = set()',
    'for r in refs:',
    '    nm = r["name"]',
    '    if nm in bound or nm.startswith("_"): continue',
    '    k = (nm, r["line"])',
    '    if k in seen: continue',
    '    seen.add(k)',
    '    out["diagnostics"].append({"line": r["line"], "col": r["col"], "severity": "warning", "message": "未定义或未导入的名称：" + nm, "code": "undefined-name"})',
    '',
    'used = set(r["name"] for r in refs)',
    'for d in defs:',
    '    if d["kind"] == "import" and d["name"] not in used and not d["name"].startswith("_"):',
    '        out["diagnostics"].append({"line": d["line"], "col": d["col"], "severity": "warning", "message": "导入未使用：" + d["name"], "code": "unused-import"})',
    '',
    'cnt = {}',
    'for d in defs:',
    '    if d["kind"] in ("function", "class"):',
    '        cnt[(d["name"], d["kind"])] = cnt.get((d["name"], d["kind"]), 0) + 1',
    'for d in defs:',
    '    if d["kind"] in ("function", "class") and cnt.get((d["name"], d["kind"]), 0) > 1 and d["line"] > 0:',
    '        out["diagnostics"].append({"line": d["line"], "col": d["col"], "severity": "warning", "message": "重复定义：" + d["name"], "code": "duplicate-def"})',
    '        cnt[(d["name"], d["kind"])] = 0',
    '',
    'out["defs"].sort(key=lambda d: d["line"])',
    'out["refs"].sort(key=lambda d: d["line"])',
    'out["diagnostics"].sort(key=lambda d: d["line"])',
    'print(json.dumps(out))'
  ].join("\n");

  /* ===== C++ 启发式分析 ===== */
  function analyzeCpp(text) {
    var lines = text.split("\n");
    var out = { ok: true, defs: [], refs: [], calls: [], diagnostics: [], lang: "cpp" };
    var i, m;
    var docBuf = [];
    for (i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var line = raw.replace(/\/\/.*$/, "");
      /* 文档注释累积 */
      var dm = /^\s*\/\/[/!]?\s?(.*)$/.exec(raw) || /^\s*\*\s?(.*)$/.exec(raw);
      if (dm) { docBuf.push(dm[1].trim()); }
      else if (!/^\s*\/\*/.test(raw) && !/^\s*\*/.test(raw) && raw.trim() !== "") { if (docBuf.length) docBuf = []; }
      /* 类/结构体/枚举/命名空间 */
      var rc = /\b(class|struct|enum|union|namespace)\s+(\w+)/.exec(line);
      if (rc && !/^\s*using\s+namespace\b/.test(raw)) out.defs.push({ name: rc[2], kind: rc[1], line: i + 1, col: raw.indexOf(rc[2]) + 1, type: rc[1], doc: docBuf.join(" ").slice(0, 200) });
      /* 宏 */
      var rd = /^\s*#\s*define\s+(\w+)/.exec(raw);
      if (rd) out.defs.push({ name: rd[1], kind: "macro", line: i + 1, col: raw.indexOf(rd[1]) + 1, type: "#define", doc: docBuf.join(" ").slice(0, 200) });
      /* 函数定义：返回类型 + 名字(参数) { */
      var rf = /^\s*(?:[\w:]+(?:<[^;{}]*>)?[\w:\*&\s]*?)\s+(\w+)\s*\(([^;{}]*)\)\s*(?:const\s*)?\{/.exec(line);
      if (rf && rf[1] !== "if" && rf[1] !== "for" && rf[1] !== "while" && rf[1] !== "switch") {
        var ret = line.slice(0, raw.indexOf(rf[1], raw.indexOf(rf[1]))).trim();
        out.defs.push({ name: rf[1], kind: "function", line: i + 1, col: raw.indexOf(rf[1]) + 1, type: ret + " (" + rf[2].trim().slice(0, 60) + ")", doc: docBuf.join(" ").slice(0, 200) });
        docBuf = [];
      } else if (rf) { docBuf = []; }
      /* 调用 */
      var cr = /(\w+)\s*\(/g;
      while ((m = cr.exec(line))) {
        if (["if", "for", "while", "switch", "return", "sizeof", "catch"].indexOf(m[1]) < 0) out.calls.push({ callee: m[1], line: i + 1 });
      }
      /* 引用：标识符 */
      var ir = /\b[A-Za-z_]\w{2,}\b/g;
      while ((m = ir.exec(line))) {
        if (["int", "char", "float", "double", "void", "bool", "long", "short", "unsigned", "signed", "const", "static", "class", "struct", "enum", "namespace", "return", "using", "template", "typename", "public", "private", "protected", "include", "define", "ifdef", "endif", "nullptr", "true", "false"].indexOf(m[1]) < 0)
          out.refs.push({ name: m[1], line: i + 1, col: m.index + 1 });
      }
    }
    /* 括号配对（去字符串/注释后） */
    var clean = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
    var pairs = [["{", "}"], ["(", ")"], ["[", "]"]];
    for (var pi = 0; pi < pairs.length; pi++) {
      var o = pairs[pi][0], c = pairs[pi][1], depth = 0;
      for (var k = 0; k < clean.length; k++) { if (clean[k] === o) depth++; else if (clean[k] === c) { depth--; if (depth < 0) break; } }
      if (depth !== 0) out.diagnostics.push({ line: lines.length, col: 1, severity: "error", message: "括号不匹配：" + o + c + "（" + (depth > 0 ? "缺少 " + c : "多余 " + c) + "）", code: "bracket" });
    }
    out.defs.sort(function (a, b) { return a.line - b.line; });
    out.diagnostics.sort(function (a, b) { return a.line - b.line; });
    var q = (clean.match(/"/g) || []).length;
    if (q % 2 !== 0) out.diagnostics.push({ line: lines.length, col: 1, severity: "warning", message: "双引号数量为奇数，可能有未闭合字符串", code: "string" });
    out.lang = "cpp";
    return out;
  }

  API.register({
    id: 'code-intel', name: '代码理解', version: '1.0.0', author: 'QingCode',
    description: '语义分析 / 类型提示 / 错误警告 / 跳转定义 / 查找引用 / 查看实现 / 符号搜索 / 内联文档 / 调用层级',
    onInit: function (api) {
      var E = api && api.editor;
      if (!E) return;
      var M = E.modules || {};
      function T(k, d) { try { return (api.hasI18n && api.hasI18n(k)) ? api.t(k) : d; } catch (e) { return d; } }
      function view() { return E.view || null; }
      var cache = { text: null, res: null };
      var lastDiagCount = -1;

      /* ---------- 分析入口 ---------- */
      function b64(s) { try { var b = new TextEncoder().encode(s); var bin = ""; for (var i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]); return btoa(bin); } catch (e) { return ""; } }
      async function analyze(force) {
        var v = view();
        if (!v) return null;
        var text = v.state.doc.toString();
        if (!force && cache.text === text && cache.res) return cache.res;
        var lang = E.currentLanguage ? E.currentLanguage() : null;
        var res = null;
        if (lang === 'python') {
          if (!api.pyEval) { res = { ok: false, defs: [], refs: [], calls: [], diagnostics: [{ line: 1, col: 1, severity: "error", message: T('ci_no_py', 'Python 运行时未就绪'), code: "no-runtime" }], lang: 'python' }; }
          else {
            var code = PY_SCRIPT.replace('__CI_B64__', JSON.stringify(b64(text)));
            var out = await api.pyEval(code);
            if (out) {
              try { res = JSON.parse(out); res.lang = 'python'; } catch (e) { res = null; }
            }
            if (!res) res = { ok: false, defs: [], refs: [], calls: [], diagnostics: [{ line: 1, col: 1, severity: "error", message: T('ci_py_fail', 'Python 分析失败（运行时未就绪或超时）'), code: "runtime" }], lang: 'python' };
          }
        } else if (lang === 'cpp') {
          res = analyzeCpp(text);
        } else {
          res = { ok: true, defs: [], refs: [], calls: [], diagnostics: [], lang: lang || 'text' };
        }
        res.defs = res.defs || []; res.refs = res.refs || []; res.calls = res.calls || []; res.diagnostics = res.diagnostics || [];
        cache = { text: text, res: res };
        if (res.diagnostics.length !== lastDiagCount) {
          lastDiagCount = res.diagnostics.length;
          try { if (res.diagnostics.length) { var errs = res.diagnostics.filter(function (d) { return d.severity === 'error'; }); if (errs.length && window.PCCM && PCCM.markErrors) PCCM.markErrors(v, errs.slice(0, 6).map(function (d) { return { line: d.line, col: d.col, message: d.message }; })); } } catch (e) {}
        }
        return res;
      }

      /* ---------- 面板 ---------- */
      function ensurePanel() {
        var el = document.getElementById('ci-panel');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'ci-panel';
        el.className = 'hidden';
        el.innerHTML = '<div class="ci-head"><b id="ci-title"></b><span class="ci-sp"></span>' +
          '<button class="ci-tab" data-ci="symbols"></button>' +
          '<button class="ci-tab" data-ci="refs"></button>' +
          '<button class="ci-tab" data-ci="calls"></button>' +
          '<button class="ci-tab" data-ci="diag"></button>' +
          '<button id="ci-close" class="ci-x">×</button></div><div id="ci-body"></div>';
        document.body.appendChild(el);
        el.querySelector('#ci-close').addEventListener('click', function () { el.classList.add('hidden'); });
        el.querySelectorAll('.ci-tab').forEach(function (b) {
          b.addEventListener('mousedown', function (e) { e.preventDefault(); });
          b.addEventListener('click', function () { E.runCommand('ci.' + b.dataset.ci); });
        });
        return el;
      }
      function goto(line, col) {
        var v = view(); if (!v) return;
        var d = v.state.doc;
        if (line < 1 || line > d.lines) return;
        var ln = d.line(line);
        var pos = Math.min(ln.to, ln.from + Math.max(0, (col || 1) - 1));
        v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
        try { E.focus(); } catch (e) {}
      }
      function clearErrMarks() { try { if (window.PCCM && PCCM.clearErrors && view()) PCCM.clearErrors(view()); } catch (e) {} }
      function render(tab, res, filter, focusName) {
        var el = ensurePanel();
        el.classList.remove('hidden');
        el.querySelector('#ci-title').textContent = T('ci_title', '代码智能') + ' · ' + (res.lang === 'python' ? 'Python' : res.lang === 'cpp' ? 'C++' : res.lang);
        el.querySelectorAll('.ci-tab').forEach(function (b) {
          var k = b.dataset.ci;
          b.textContent = k === 'symbols' ? T('ci_tab_symbols', '符号') : k === 'refs' ? T('ci_tab_refs', '引用') : k === 'calls' ? T('ci_tab_calls', '调用') : T('ci_tab_diag', '问题');
          b.classList.toggle('act', k === tab);
        });
        var body = el.querySelector('#ci-body');
        body.innerHTML = '';
        var q = (filter || '').toLowerCase();
        function row(title, sub, meta, onTap) {
          var r = document.createElement('button');
          r.className = 'ci-row';
          var t1 = document.createElement('span'); t1.className = 'ci-name'; t1.textContent = title;
          var t2 = document.createElement('span'); t2.className = 'ci-meta'; t2.textContent = meta || '';
          r.appendChild(t1); r.appendChild(t2);
          if (sub) { var t3 = document.createElement('span'); t3.className = 'ci-sub'; t3.textContent = sub; r.appendChild(t3); }
          r.addEventListener('mousedown', function (e) { e.preventDefault(); });
          r.addEventListener('click', onTap);
          body.appendChild(r);
        }
        if (tab === 'symbols') {
          var defs = res.defs.filter(function (d) { return !q || String(d.name).toLowerCase().indexOf(q) >= 0; });
          if (!defs.length) { body.innerHTML = '<div class="ci-empty">' + T('ci_none', '没有匹配的符号') + '</div>'; return; }
          defs.forEach(function (d) {
            row(d.name, d.doc || d.type || '', d.kind + ' · L' + d.line, function () { goto(d.line, d.col); });
          });
        } else if (tab === 'refs') {
          var name = focusName || '';
          var rs = res.refs.filter(function (r) { return (!name || r.name === name) && (!q || String(r.name).toLowerCase().indexOf(q) >= 0); });
          if (!rs.length) { body.innerHTML = '<div class="ci-empty">' + T('ci_none_refs', '没有找到引用') + (name ? '：' + name : '') + '</div>'; return; }
          rs.slice(0, 300).forEach(function (r) { row(r.name, '', 'L' + r.line, function () { goto(r.line, r.col); }); });
        } else if (tab === 'diag') {
          var ds = res.diagnostics;
          if (!ds.length) { body.innerHTML = '<div class="ci-empty">' + T('ci_ok', '未发现问题') + '</div>'; return; }
          ds.forEach(function (d) {
            row((d.severity === 'error' ? '⛔ ' : '⚠ ') + d.message, '', 'L' + d.line, function () { goto(d.line, d.col); });
          });
        } else if (tab === 'calls') {
          var root = focusName || '';
          if (!root) { body.innerHTML = '<div class="ci-empty">' + T('ci_pick', '把光标放在函数名上再试') + '</div>'; return; }
          var seen = Object.create(null);
          var out = [];
          function walk(fn, depth) {
            if (depth > 6 || seen[fn]) return;
            seen[fn] = 1;
            var cs = res.calls.filter(function (c) { return c.callee === fn; });
            var names = [];
            var uniq = Object.create(null);
            cs.forEach(function (c) { if (!uniq[c.callee]) { uniq[c.callee] = 1; names.push(c.callee); } });
            var callees = Object.create(null);
            res.calls.forEach(function (c) { if (c.callee !== fn) callees[c.callee] = 1; });
            var children = res.defs.filter(function (d) { return d.kind === 'function' && seen[d.name] === undefined; });
            /* 简化：把 (fn) 里出现的调用按行范围归属 */
            var lines = [];
            var self = res.defs.filter(function (d) { return d.name === fn && d.kind === 'function'; })[0];
            if (!self) return;
            var startLine = self.line, endLine = 1e9;
            var next = res.defs.filter(function (d) { return d.kind === 'function' && d.line > startLine; }).sort(function (a, b) { return a.line - b.line; })[0];
            if (next) endLine = next.line;
            res.calls.forEach(function (c) { if (c.line >= startLine && c.line < endLine && c.callee !== fn) lines.push(c.callee); });
            out.push({ fn: fn, depth: depth, callees: lines });
            var u2 = Object.create(null);
            lines.forEach(function (n) { if (!u2[n]) { u2[n] = 1; walk(n, depth + 1); } });
          }
          walk(root, 0);
          if (!out.length) { body.innerHTML = '<div class="ci-empty">' + T('ci_no_calls', '没有找到可展开的调用') + '</div>'; return; }
          out.forEach(function (o) {
            row(new Array(o.depth + 1).join('  ') + (o.depth ? '└ ' : '') + o.fn, (o.callees || []).join(', '), '', function () {
              var d = res.defs.filter(function (x) { return x.name === o.fn && x.kind === 'function'; })[0];
              if (d) goto(d.line, d.col);
            });
          });
        }
      }

      function wordAtCursor() {
        var v = view(); if (!v) return '';
        var pos = v.state.selection.main.head;
        var d = v.state.doc;
        var line = d.lineAt(pos);
        var t = line.text, start = pos - line.from, a = start, b = start;
        while (a > 0 && /[\w$]/.test(t[a - 1])) a--;
        while (b < t.length && /[\w$]/.test(t[b])) b++;
        return b > a ? t.slice(a, b) : '';
      }

      /* ---------- 命令 ---------- */
      function cmd(id, k, run) { E.registerCommand(id, { label: T(k, id), labelKey: k, group: 'intel', run: run }); }
      function withRes(tab, opts) {
        return function () {
          var v = view(); if (!v) return false;
          var name = (opts && opts.name) || wordAtCursor();
          analyze(false).then(function (res) {
            if (!res) return;
            render(tab, res, '', name);
            if (res.diagnostics.length) {
              try { if (window.PCCM && PCCM.markErrors) PCCM.markErrors(v, res.diagnostics.filter(function (d) { return d.severity === 'error'; }).slice(0, 6).map(function (d) { return { line: d.line, col: d.col, message: d.message }; })); } catch (e) {}
            }
          });
          return true;
        };
      }
      cmd('ci.symbols', 'ci_cmd_symbols', withRes('symbols', { name: '' }));
      cmd('ci.refs', 'ci_cmd_refs', withRes('refs'));
      cmd('ci.diag', 'ci_cmd_diag', withRes('diag', { name: '' }));
      cmd('ci.calls', 'ci_cmd_calls', withRes('calls'));
      cmd('ci.def', 'ci_cmd_def', function () {
        var v = view(); if (!v) return false;
        var name = wordAtCursor();
        if (!name) return false;
        analyze(false).then(function (res) {
          var d = res.defs.filter(function (x) { return x.name === name; })[0];
          if (d) goto(d.line, d.col);
          else if (api.meta) api.meta(T('ci_no_def', '未找到定义') + '：' + name);
        });
        return true;
      });
      cmd('ci.implement', 'ci_cmd_impl', function () {
        var v = view(); if (!v) return false;
        var name = wordAtCursor();
        if (!name) return false;
        analyze(false).then(function (res) {
          var ds = res.defs.filter(function (x) { return x.name === name && (x.kind === 'function' || x.kind === 'class' || x.kind === 'struct'); });
          if (ds.length) { goto(ds[0].line, ds[0].col); if (api.meta) api.meta(T('ci_impl', '实现位置') + '：L' + ds[0].line); }
          else if (api.meta) api.meta(T('ci_no_impl', '未找到实现（Python 无接口/实现分离，等同于定义）'));
        });
        return true;
      });
      cmd('ci.analyze', 'ci_cmd_analyze', function () {
        var v = view(); if (!v) return false;
        analyze(true).then(function (res) {
          if (!res) return;
          var msg = T('ci_summary', '语义分析') + '：' + res.defs.length + ' ' + T('ci_defs', '定义') + ' · ' + res.refs.length + ' ' + T('ci_refs', '引用') + ' · ' + res.calls.length + ' ' + T('ci_calls', '调用') + ' · ' + res.diagnostics.length + ' ' + T('ci_issues', '问题');
          if (api.out) api.out(msg + '\n', 'out-meta');
          render('symbols', res, '', '');
        });
        return true;
      });

      /* ---------- 工具栏 ---------- */
      [{ icon: '{}', k: 'ci_cmd_symbols', id: 'ci.symbols', order: 100 },
       { icon: '⚠', k: 'ci_cmd_diag', id: 'ci.diag', order: 110 }].forEach(function (b) {
        E.addToolbarButton({ icon: b.icon, label: T(b.k, b.id), order: b.order, run: function () { E.runCommand(b.id); } });
      });

      if (api.meta) api.meta(T('ci_loaded', '[代码理解] 已加载（Python 用 ast 真语义，C++ 为启发式）'));
    }
  });
})();
