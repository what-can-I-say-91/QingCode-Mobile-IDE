#!/bin/bash
# ============================================================
# 轻码编辑器 QingCode —— 命令行构建脚本（无需 Gradle/Android Studio）
# 依赖：JDK 11+、Android SDK（build-tools;34.0.0 与 platforms;android-34）
# 用法：ANDROID_SDK_ROOT=/opt/android-sdk ./build.sh
# ============================================================
set -e

SDK="${ANDROID_SDK_ROOT:-/opt/android-sdk}"
BT="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"
PROJ="$(cd "$(dirname "$0")" && pwd)"
OUT="$PROJ/build"
KEYSTORE="$PROJ/debug.keystore"

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
mkdir -p "$SRC_OUT/web/vendor" "$SRC_OUT/app/src/main/java/com/qingcode/editor" "$SRC_OUT/app/src/main/res" "$SRC_OUT/plugins" "$SRC_OUT/licenses"
cp "$PROJ/web/app.js" "$PROJ/web/index.html" "$PROJ/web/style.css" "$SRC_OUT/web/"
cp "$PROJ/web/i18n.js" "$PROJ/web/py-worker.js" "$SRC_OUT/web/"
cp "$PROJ/web/vendor/cm6.js" "$PROJ/web/vendor/cpp-worker.js" "$SRC_OUT/web/vendor/"
cp "$PROJ/web/vendor/JSCPP.js" "$SRC_OUT/web/vendor/"
cp "$PROJ/app/src/main/java/com/qingcode/editor/MainActivity.java" "$SRC_OUT/app/src/main/java/com/qingcode/editor/"
cp "$PROJ/app/src/main/AndroidManifest.xml" "$SRC_OUT/app/src/main/"
cp -r "$PROJ/app/src/main/res/." "$SRC_OUT/app/src/main/res/"
cp -r "$PROJ/licenses/." "$SRC_OUT/licenses/"
cp "$PROJ/build.sh" "$PROJ/README.md" "$PROJ/README_EN.md" "$PROJ/使用说明.md" "$PROJ/使用说明_EN.md" "$PROJ/LICENSE" "$SRC_OUT/"
cp "$PROJ/plugins/插件接口说明.md" "$PROJ/plugins/Plugin-API-Guide_EN.md" "$PROJ/plugins/example-lang-plugin.js" "$SRC_OUT/plugins/"
cp "$PROJ/debug.keystore" "$SRC_OUT/"

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
javac --release 8 -classpath "$PLATFORM" \
  -d "$OUT/obj" \
  "$OUT/gen/com/qingcode/editor/R.java" \
  "$PROJ/app/src/main/java/com/qingcode/editor/MainActivity.java"

echo "[3/6] d8 转 dex"
"$BT/d8" --release --lib "$PLATFORM" \
  --output "$OUT/dex" \
  $(find "$OUT/obj" -name '*.class')
cd "$OUT/dex" && zip -q -j "$OUT/apk/base.apk" classes.dex && cd - >/dev/null

echo "[4/6] 对齐 zipalign"
"$BT/zipalign" -f -p 4 "$OUT/apk/base.apk" "$OUT/apk/base-aligned.apk"

echo "[5/6] 生成调试签名"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass pocketcode \
    -keypass pocketcode -alias pocketcode -keyalg RSA -keysize 2048 \
    -validity 10000 -dname "CN=QingCode, OU=Dev, O=Dev, C=CN"
fi

echo "[6/6] apksigner 签名"
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:pocketcode \
  --key-pass pass:pocketcode \
  --out "$OUT/QingCode.apk" "$OUT/apk/base-aligned.apk"

"$BT/apksigner" verify "$OUT/QingCode.apk" && echo "OK => $(ls -lh "$OUT/QingCode.apk" | awk '{print $5, $9}')"
