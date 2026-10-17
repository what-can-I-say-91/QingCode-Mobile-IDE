#!/bin/bash
# ============================================================
# 轻码编辑器 QingCode —— 命令行构建脚本（无需 Gradle/Android Studio）
# 依赖：JDK 11+、Android SDK（build-tools;34.0.0 与 platforms;android-34）
# 用法：ANDROID_SDK_ROOT=/opt/android-sdk ./build.sh
# ============================================================
set -e

# 统一 UTF-8：assets/source/源码/ 等中文路径在 zip 条目里必须是 UTF-8，
# 否则 Android 侧 getAssets().list() 可能拿到乱码目录名。
# 只设 LANG、不设 LC_ALL —— LC_ALL 会覆盖调用者的全部 locale 设置，影响面过大。
export LANG=C.UTF-8

# 依赖检查：缺一即退出，避免构建到一半才失败。
for _c in javac keytool zip; do
  command -v "$_c" >/dev/null 2>&1 || { echo "缺少命令：$_c（请安装后重试）" >&2; exit 1; }
done

SDK="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
BT="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"
PROJ="$(cd "$(dirname "$0")" && pwd)"
OUT="$PROJ/build"
# v5.4.1 安全（审查高风险 #1）：发布签名密钥绝不能进仓库/进 APK
# 发布时用环境变量指定私有密钥；不要用 debug.keystore 签发布版
KEYSTORE="${KEYSTORE:-$PROJ/debug.keystore}"
KS_PASS="${KEYSTORE_PASS:-pocketcode}"
KEY_PASS="${KEY_PASS:-pocketcode}"
KEY_ALIAS="${KEY_ALIAS:-pocketcode}"

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/obj" "$OUT/apk" "$OUT/dex"

echo "[0/6] 组装 assets（web/ -> app/src/main/assets/editor）"
WEB_SRC="$PROJ/web"
[ -d "$WEB_SRC" ] || WEB_SRC="$PROJ/../web"     # 兼容 web 与 app 平级的布局
if [ -d "$WEB_SRC" ]; then
  rm -rf "$PROJ/app/src/main/assets/editor"
  mkdir -p "$PROJ/app/src/main/assets/editor"
  cp -r "$WEB_SRC/." "$PROJ/app/src/main/assets/editor/"
fi

# v3.3：打包源代码到 assets/source（运行时释放到 /sdcard/QingCode/源码/）
# 排除 Pyodide 二进制资源（14M），源码包保持轻量；pyodide 可从官方 release 获取
# v4.11.2：一并打包第三方开源许可证 licenses/（随源码释放，便于用户查阅）
echo "[0.5/6] 打包源码到 assets/source"
SRC_OUT="$PROJ/app/src/main/assets/source"
rm -rf "$SRC_OUT"
mkdir -p "$SRC_OUT/web/vendor" "$SRC_OUT/web/plugins" "$SRC_OUT/app/src/main/java/com/qingcode/editor" "$SRC_OUT/app/src/main/res" "$SRC_OUT/plugins" "$SRC_OUT/licenses"
cp "$PROJ/web/app.js" "$PROJ/web/index.html" "$PROJ/web/style.css" "$SRC_OUT/web/"
cp "$PROJ/web/i18n.js" "$PROJ/web/py-worker.js" "$PROJ/web/sandbox-worker.js" "$SRC_OUT/web/"
cp "$PROJ/web/vendor/cm6.js" "$PROJ/web/vendor/cpp-worker.js" "$SRC_OUT/web/vendor/"
cp "$PROJ/web/vendor/JSCPP.js" "$SRC_OUT/web/vendor/"
cp -r "$PROJ/web/plugins/." "$SRC_OUT/web/plugins/"
cp "$PROJ/app/src/main/java/com/qingcode/editor/MainActivity.java" "$SRC_OUT/app/src/main/java/com/qingcode/editor/"
cp "$PROJ/app/src/main/AndroidManifest.xml" "$SRC_OUT/app/src/main/"
cp -r "$PROJ/app/src/main/res/." "$SRC_OUT/app/src/main/res/"
cp -r "$PROJ/licenses/." "$SRC_OUT/licenses/"
cp "$PROJ/build.sh" "$PROJ/README.md" "$PROJ/README_EN.md" "$PROJ/使用说明.md" "$PROJ/使用说明_EN.md" "$PROJ/CHANGELOG.md" "$PROJ/CHANGELOG_EN.md" "$PROJ/LICENSE" "$SRC_OUT/"
cp "$PROJ/plugins/插件接口说明.md" "$PROJ/plugins/Plugin-API-Guide_EN.md" "$PROJ/plugins/example-lang-plugin.js" "$SRC_OUT/plugins/"

echo "[1/6] aapt2 编译链接资源与 assets"
"$BT/aapt2" compile --dir "$PROJ/app/src/main/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/apk/base.apk" \
  --manifest "$PROJ/app/src/main/AndroidManifest.xml" \
  -I "$PLATFORM" \
  --java "$OUT/gen" \
  --auto-add-overlay \
  "$OUT/res.zip"
# 把 assets 追加进 APK
cd "$PROJ/app/src/main" && zip -q -r "$OUT/apk/base.apk" assets && cd - >/dev/null

echo "[2/6] javac 编译 Java 源码"
# -encoding UTF-8：MainActivity.java 含中文字符串，显式指定避免构建机 locale 影响
javac --release 8 -encoding UTF-8 -classpath "$PLATFORM" \
  -d "$OUT/obj" \
  "$OUT/gen/com/qingcode/editor/R.java" \
  "$PROJ/app/src/main/java/com/qingcode/editor/MainActivity.java"

echo "[3/6] d8 转 dex"
# find -exec ... {} + 是 POSIX 标准：路径含空格安全、空输入不执行、Linux/macOS 行为一致。
# --min-api 24 与 AndroidManifest 的 minSdkVersion 保持一致。
find "$OUT/obj" -name '*.class' -exec "$BT/d8" --release \
  --min-api 24 --lib "$PLATFORM" --output "$OUT/dex" {} +
cd "$OUT/dex" && zip -q -j "$OUT/apk/base.apk" classes.dex && cd - >/dev/null

echo "[4/6] 对齐 zipalign"
"$BT/zipalign" -f -p 4 "$OUT/apk/base.apk" "$OUT/apk/base-aligned.apk"

echo "[5/6] 生成调试签名"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" \
    -keypass "$KEY_PASS" -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 \
    -validity 10000 -dname "CN=QingCode, OU=Dev, O=Dev, C=CN"
fi

echo "[6/6] apksigner 签名"
if [ "$KEYSTORE" = "$PROJ/debug.keystore" ]; then
  echo "⚠️  正在使用仓库内的 debug.keystore 签名——仅限调试，请勿发布此 APK！"
  echo "    发布请用: KEYSTORE=/path/to/release.jks KEYSTORE_PASS=... ./build.sh"
fi
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:"$KS_PASS" \
  --key-pass pass:"$KEY_PASS" \
  --out "$OUT/QingCode.apk" "$OUT/apk/base-aligned.apk"

"$BT/apksigner" verify "$OUT/QingCode.apk" && echo "OK => $(ls -lh "$OUT/QingCode.apk" | awk '{print $5, $9}')"
