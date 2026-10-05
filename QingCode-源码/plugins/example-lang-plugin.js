/**
 * QingCode 语言插件骨架（v4.4 · PCPluginAPI v1）
 * ================================================
 * 使用方法：
 *   1. 复制本文件到手机 /sdcard/QingCode/plugins/ 目录（没有就新建）；
 *   2. 把下面的 'lua' / '.lua' / 'lua main.lua' 换成你要接入的语言；
 *   3. 重启 QingCode，启动时自动加载；终端会输出「[插件] 已加载：xxx.js」。
 * 前置条件：Termux 已安装并完成「设置 → 引擎与 Termux → ⚙️ 配置 C++」初始化（allow-external-apps + 存储授权）。
 *
 * 完整 API 文档见 plugins/插件接口说明.md
 */
PCPluginAPI.register({
  id: 'my-lang',                       // 必填：唯一 ID
  name: 'MyLang',
  version: '1.0',

  // —— 注册语言：扩展名进入「新建文件」白名单，▶ 运行时走本插件的 onRun ——
  languages: [{
    id: 'lua',                         // 语言 ID（仅标识用）
    name: 'Lua',                       // 显示名
    exts: ['.lua'],                    // 接管的文件扩展名（可多个）
    defaultCode: 'print("Hello, MyLang!")',   // 新建文件默认代码
    comment: '--',                     // 行注释符（预留字段）
  }],

  // —— 注册「更多菜单」项（可选）——
  menu: [{
    label: 'MyLang 示例',
    onClick(api) { api.toast('MyLang 插件已加载'); },
  }],

  // —— 加载完成回调（可选）——
  onInit(api) {
    // api.out('[my-lang] ready\n');
  },

  // —— 运行钩子：用户点 ▶ 运行 .lua 文件时进入 ——
  async onRun(file, code, langDef, api) {
    // 1) 把代码写入交换目录（Termux 侧按绝对路径读取）
    if (!api.writeSwapFile('plug_main.lua', code)) {
      api.out('写入交换目录失败（请检查「所有文件访问」权限）\n', 'out-err');
      return true;
    }

    // 2) 解释器缺失时自动安装（首次运行稍慢）
    api.meta('正在准备运行环境…');
    await api.runCapture('command -v lua >/dev/null 2>&1 || pkg install -y lua');

    // 3) 运行并捕获 stdout + stderr
    const r = await api.runCapture('lua /sdcard/QingCode/plug_main.lua');

    // 4) 输出结果
    api.out(r.output, r.code === 0 ? 'out-echo' : 'out-err');
    api.meta('MyLang 运行结束，退出码 ' + r.code);

    return true;   // 返回 true = 已接管本次运行
  },
});
