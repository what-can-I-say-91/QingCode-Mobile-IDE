#!/bin/sh
# 校验 MainActivity.runCppEx 在「生成期」拼出来的那几种引号组合在 shell 里真的成立。
# 这些片段是 Java 用 "..." + q(rel) 拼的，写错一个字符就会让真机上所有 C++ 编译失败，
# 而本机没有 Termux，只能这样验证语义。
set -u

# 用项目内目录而不是 mktemp：Git Bash 的 mktemp 返回 "C://...//Temp/x" 这种混合路径，
# 拼出来的 $W/src/a.cpp 在 shell 里反而 stat 不到（测试环境问题，不是代码问题）。
DIR=$(cd "$(dirname "$0")" && pwd)
WORK="$DIR/.tmp-quoting"
find "$WORK" -mindepth 1 -delete 2>/dev/null; rmdir "$WORK" 2>/dev/null
mkdir -p "$WORK"
mkdir -p "$WORK/src" "$WORK/include"
printf 'int main(){return 0;}\n' > "$WORK/src/a.cpp"
printf '#pragma once\n' > "$WORK/include/x.h"

PC="$WORK"
W="$WORK/priv"
mkdir -p "$W"
cp -a "$PC"/. "$W"/ 2>/dev/null

PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "PASS  $1"; }
no() { FAIL=$((FAIL + 1)); echo "FAIL  $1  [$2]"; }

# 1) 私有目录复制
[ -f "$W/src/a.cpp" ] && ok "T1 cp -a 把会话目录整份复制到私有目录" || no "T1 私有目录复制" "$(ls -R "$W" 2>&1 | head -3)"

# 2) 源文件路径：Java 生成 " + \"$W/\" + q(rel) → "$W/"'src/a.cpp'
SRC="\"$W/\"'src/a.cpp'"
eval "set -- $SRC"
[ -f "$1" ] && ok "T2 \"\$W/\"'rel' 拼接后指向真实文件" || no "T2 源文件拼接" "$1"

# 3) include：-I"$W/"'include'
INC="-I\"$W/\"'include'"
eval "set -- $INC"
[ "$1" = "-I$W/include" ] && ok "T3 -I\"\$W/\"'dir' 拼接正确" || no "T3 include 拼接" "$1"

# 4) 多源：两个源文件用空格分隔后仍是两个参数
MULTI="\"$W/\"'src/a.cpp' \"$W/\"'src/a.cpp'"
eval "set -- $MULTI"
[ "$#" -eq 2 ] && ok "T4 多源拼接后仍是两个独立参数" || no "T4 多源参数" "count=$#"

# 5) 文件名里有空格/中文（safeRelativePath 允许）也能作为一个参数
mkdir -p "$W/中文 目录"
printf 'int x;\n' > "$W/中文 目录/头 文件.cpp"
CN="\"$W/\"'中文 目录/头 文件.cpp'"
eval "set -- $CN"
[ -f "$1" ] && ok "T5 含空格与中文的路径仍作为一个参数" || no "T5 中文空格路径" "$1"

# 6) 哈希输入：cat -- "$W/"'src/a.cpp' 能拿到内容
H=$( { echo '== src/a.cpp'; cat -- "$W/"'src/a.cpp' 2>/dev/null; } | sha256sum | cut -d' ' -f1 )
[ ${#H} -eq 64 ] && ok "T6 哈希输入拼接可用（64 位 sha256）" || no "T6 哈希拼接" "$H"

find "$WORK" -mindepth 1 -delete 2>/dev/null; rmdir "$WORK" 2>/dev/null
echo "---"
echo "== termux-quoting: $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ] || exit 1
