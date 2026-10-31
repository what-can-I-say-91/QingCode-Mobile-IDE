#!/bin/sh
# ============================================================
# 前端回归启动器（无头浏览器 + CDP）
#
# 用法：
#   sh tests/e2e/run.sh                # 跑全部（用 sh 调用，不依赖文件可执行位）
#   sh tests/e2e/run.sh e2e-security.mjs
#
# 依赖：Edge/Chrome/Chromium、Node 18+（内置 WebSocket）、Python 3（静态服务）
# 可用 EDGE / NODE / PY / QC_PORT / QC_CDP_PORT 覆盖。
#
# 注意：每个用例单独起一个浏览器实例（独立 profile）。
# 共用一个实例时 localStorage 会跨用例残留，导致结果互相污染（v5.10.0 踩过）。
# ============================================================
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(cd "$DIR/../.." && pwd)"
SCRIPT="${1:-all}"
PORT="${QC_PORT:-8765}"
CDP_PORT="${QC_CDP_PORT:-9225}"

EDGE="${EDGE:-}"
if [ -z "$EDGE" ]; then
  for c in "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
           "/c/Program Files/Microsoft/Edge/Application/msedge.exe" \
           "/c/Program Files/Google/Chrome/Application/chrome.exe" \
           "$(command -v chromium 2>/dev/null)" \
           "$(command -v google-chrome 2>/dev/null)"; do
    [ -n "$c" ] && [ -f "$c" ] && { EDGE="$c"; break; }
  done
fi
[ -z "$EDGE" ] && { echo "找不到浏览器，请用 EDGE=/path/to/browser 指定"; exit 2; }

NODE="${NODE:-node}"
PY="${PY:-python3}"
command -v "$NODE" >/dev/null 2>&1 || { echo "找不到 node，请用 NODE=/path/to/node 指定"; exit 2; }

PROF="$DIR/.e2e-prof"
(cd "$PROJ/web" && "$PY" -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
HTTP_PID=$!
# 退出时连浏览器 profile 一起删：它含 Cookies / History，几十 MB，不该留在仓库里
trap '[ -n "${EDGE_PID:-}" ] && kill "$EDGE_PID" 2>/dev/null; kill $HTTP_PID 2>/dev/null; rm -rf "$PROF" 2>/dev/null' INT TERM EXIT


start_edge() {
  rm -rf "$PROF"
  "$EDGE" --headless --disable-gpu --remote-debugging-port=$CDP_PORT --remote-allow-origins=* \
    --user-data-dir="$PROF" --no-first-run --no-default-browser-check \
    about:blank > /tmp/qc_edge.log 2>&1 &
  EDGE_PID=$!
  i=0
  while [ $i -lt 40 ]; do
    curl -s -m 1 "http://127.0.0.1:$CDP_PORT/json/version" > /dev/null && return 0
    sleep 0.5; i=$((i + 1))
  done
  return 1
}
stop_edge() {
  [ -n "${EDGE_PID:-}" ] && kill "$EDGE_PID" 2>/dev/null
  EDGE_PID=""
  i=0
  while [ $i -lt 20 ]; do
    curl -s -m 1 "http://127.0.0.1:$CDP_PORT/json/version" > /dev/null || return 0
    sleep 0.25; i=$((i + 1))
  done
  return 0
}

run_one() {
  start_edge || { echo "!! 无法启动无头浏览器"; return 1; }
  QC_CDP="http://127.0.0.1:$CDP_PORT" QC_APP="http://127.0.0.1:$PORT/index.html" "$NODE" "$DIR/$1"
  rc=$?
  stop_edge
  return $rc
}

RC=0
if [ "$SCRIPT" = "all" ]; then
  for f in e2e-security.mjs e2e-run.mjs; do
    [ -f "$DIR/$f" ] || continue
    echo "--- $f ---"
    run_one "$f" || RC=1
  done
else
  run_one "$SCRIPT" || RC=1
fi
exit $RC
