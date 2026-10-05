# QingCode Plugin API Guide (PCPluginAPI v2)

> The plugin interface is reserved since v4.4 and upgraded to v2 in v4.6 (adds plugin-manager custom tabs via `page()`, standard meta fields and plugin enable/disable; **v1 plugins stay compatible unchanged**). The host only provides loading and low-level channels — **plugins are developed by you**.

**[中文](插件接口说明.md) · English**

## 1. What a plugin is & where it goes

- One plugin = one `.js` file (plain JavaScript, not an ES module);
- Put it into **`/sdcard/QingCode/plugins/`** on the phone (create the folder if missing); plugins load automatically at startup, in filename order;
- Loading: `new Function('PCPluginAPI', source)(PCPluginAPI)` — plugins reach host capabilities through the `PCPluginAPI` argument, without polluting globals;
- Plugin errors stay contained (the terminal shows `[plugin] load failed: …`); the host is never taken down;
- With no storage permission or an empty folder, loading is skipped at zero cost.

## 2. Registering a plugin

```js
// /sdcard/QingCode/plugins/hello.js — minimal example
PCPluginAPI.register({
  id: 'hello',            // required, unique (duplicate IDs are ignored)
  name: 'Hello plugin',
  version: '1.0',
  author: 'Your name',            // v2 standard field: shown in the plugin manager
  description: 'One-line intro',  // v2 standard field: shown in the plugin manager
  homepage: 'https://…',          // v2 optional: homepage / repo link
  menu: [                 // optional: register overflow-menu items
    { label: 'Hello world', onClick: (api) => api.toast('Hello, QingCode!') },
  ],
  onInit(api) {           // optional: called once after all plugins load
    api.out('[hello] plugin ready\n');
  },
  onUnload(api) {         // v2 optional: disable/unload callback (disable currently takes effect on restart; reserved for future hot-unload)
  },
});
```

## 3. Language plugins (running other languages)

Two steps: declare `languages` in `register()` (extensions join the new-file whitelist), then provide an `onRun` hook. When ▶ run is tapped and the file extension matches a plugin language, the plugin's `onRun` takes over.

```js
// /sdcard/QingCode/plugins/lua.js — Lua language plugin (example)
PCPluginAPI.register({
  id: 'lua',
  name: 'Lua',
  version: '1.0',
  languages: [{
    id: 'lua',
    name: 'Lua',
    exts: ['.lua'],                       // extensions to take over
    defaultCode: 'print("Hello, Lua!")',  // optional: default code for new files
    comment: '--',                        // optional: line comment token
  }],
  async onRun(file, code, langDef, api) {
    // 1. write the code into the swap directory (readable from the Termux side)
    if (!api.writeSwapFile('plug_main.lua', code)) {
      api.out('failed to write swap file (check storage permission)\n', 'out-err'); return true;
    }
    // 2. make sure the interpreter exists in Termux (auto-install if missing)
    await api.runCapture('command -v lua >/dev/null || pkg install -y lua');
    // 3. run and capture output
    const r = await api.runCapture('lua /sdcard/QingCode/plug_main.lua');
    api.out(r.output, r.code === 0 ? 'out-echo' : 'out-err');
    api.meta('Lua finished, exit code ' + r.code);
    return true;   // returning true means this run is taken over
  },
});
```

Prerequisites: Termux installed and initialized via "Settings → Engines & Termux → ⚙️ Configure C++" (the `pkg install` commands rely on the Tsinghua mirror). The first run of a language auto-installs its interpreter, which takes a while.

## 4. API reference

| API | Description |
|---|---|
| `register(meta)` | Register a plugin (duplicate IDs ignored); `meta` fields as above |
| `out(text, cls?)` | Append to the terminal; cls: `out-echo` normal / `out-err` error (default normal) |
| `meta(text)` | Status-bar message |
| `toast(msg)` | Android Toast |
| `execTermux(script, background=true)` | **Low-level primitive**: send an arbitrary script to Termux, returns whether it was dispatched; output redirection/polling is up to the plugin |
| `runCapture(script)` | **High-level wrapper**: run a script and capture stdout+stderr, returns `Promise<{code, output}>` (output redirected to a swap-dir temp file + polling + auto cleanup, 120 s timeout) |
| `writeSwapFile(name, content)` | Write a file under `/sdcard/QingCode/` (path-traversal safe: name limited to alphanumerics/dots/underscores/hyphens, no `..`) |
| `readSwapFile(name)` | Read a file under the swap directory; returns `''` when missing |
| `deleteSwapFile(name)` | Delete a file under the swap directory |
| `copy(text)` | Copy to clipboard |
| `storage(id)` | Namespaced key-value storage: `get(key, dft)` / `set(key, val)` / `del(key)` (localStorage with an automatic `pc_plugin_<id>_` prefix) |
| `page(tabId, def)` | **New in v2**: register a custom tab in the plugin manager, `def = { title, render(container, api) }`; `render` is lazily called each time the tab is activated, `container` is the content container you can fill freely; returns success (built-in tab ids `loaded`/`langs`/`settings` cannot be overridden) |
| `apiVersion` | Interface version, currently `2` (bumped on breaking changes) |

## 5. Plugin manager extensions (v4.6)

"Menu → 🧩 Plugin manager" is the management center for plugins (top tabs: **Loaded / Languages / Settings**). Plugins can do three things:

### 1. Add custom tabs

```js
PCPluginAPI.register({
  id: 'mytool',
  name: 'MyTool',
  version: '1.0',
  onInit(api) {
    // register a "My tools" tab in the plugin manager
    api.page('mytool', {
      title: 'My tools',
      render(container, api) {
        // container is the page content div; called again every time the tab activates
        const btn = document.createElement('button');
        btn.textContent = 'Tap to run';
        btn.onclick = () => api.toast('Hello from a plugin tab!');
        container.appendChild(btn);
      },
    });
  },
});
```

### 2. Present metadata

`name` / `version` / `author` / `description` / `homepage` from `register` are shown automatically on the plugin cards in the "Loaded" tab.

### 3. Enable / disable (user action)

- Each card in the "Loaded" tab carries an **enable/disable** button: disabled plugins are remembered **by filename** (`localStorage('pc_plugins_disabled')`) and are not loaded after an app restart;
- The "Settings" tab has a **plugin system master switch** (`pc_plugins_enabled`): when off, startup skips all plugins;
- Toggling shows a toast "takes effect after restarting the app"; disabled-but-present plugins stay listed as "Disabled" cards and can be re-enabled at any time.

## 6. Notes

- Plugins run inside the frontend WebView; their capability boundary is exactly the `PCPluginAPI` channels — do not reach into host internals (they may change without notice);
- `onRun` is currently a synchronous call: use an `async` function and `await` inside for long tasks; the Stop button does not yet take over plugin runs (reserved for API v1);
- `runCapture` times out at 120 seconds; interactive programs (stdin) should use `execTermux` for custom orchestration or guide the user to "run in a Termux terminal";
- See `plugins/example-lang-plugin.js` for a fully commented skeleton (rename it, drop it into the plugins folder and it works).
