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

PROF=""
(cd "$PROJ/web" && "$PY" -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
HTTP_PID=$!
# 退出时连浏览器 profile 一起删：它含 Cookies / History，几十 MB，不该留在仓库里。
# 用 find -delete 而不是 rm -rf：某些环境把 rm 包成「移到回收站」，会失败并留下残留。
cleanup_prof() {
  # 浏览器刚退出时文件锁可能还没释放，删一次常常失败 → 重试几次
  _n=0
  while [ $_n -lt 4 ]; do
    [ -n "${PROF:-}" ] && [ -d "$PROF" ] || return 0
    find "$PROF" -mindepth 1 -delete 2>/dev/null
    rmdir "$PROF" 2>/dev/null
    _n=$((_n + 1))
    sleep 0.6
  done
}

# 启动前清扫上一次可能没删干净的 profile（含 Cookies/History，几十 MB 一个）
for _d in "$DIR"/.e2e-prof*; do
  [ -d "$_d" ] || continue
  find "$_d" -mindepth 1 -delete 2>/dev/null
  rmdir "$_d" 2>/dev/null
done
# profile 统一放系统临时目录：删不掉也只是留在 /tmp，不会污染仓库
trap '[ -n "${EDGE_PID:-}" ] && kill "$EDGE_PID" 2>/dev/null; kill $HTTP_PID 2>/dev/null; cleanup_prof' INT TERM EXIT


cdp_ready() {
  curl -s -m 1 "http://127.0.0.1:$CDP_PORT/json/version" 2>/dev/null | grep -q '"Browser"'
}

start_edge() {
  # v5.11.0：两处硬约束
  #  · 唯一 profile：固定目录删不掉时会残留 Chromium 单例锁，新实例被旧进程接管
  #  · 端口必须干净：上一轮浏览器没退干净时，/json/list 会给到已销毁的 target，
  #    测试脚本连上后 promise 永挂、进程静默退出（退出码 0，看起来「全绿」）
  _try=0
  while [ $_try -lt 5 ]; do
    _try=$((_try + 1))
    PROF="${TMPDIR:-/tmp}/qc-e2e-main-$$.$_try"
    rm -rf "$PROF" 2>/dev/null
    mkdir -p "$PROF" 2>/dev/null
    if cdp_ready; then
      CDP_PORT=$((CDP_PORT + 1))    # 端口被残留实例占着 → 换一个
      continue
    fi
    "$EDGE" --headless --disable-gpu --remote-debugging-port=$CDP_PORT --remote-allow-origins=* \
      --user-data-dir="$PROF" --no-first-run --no-default-browser-check \
      about:blank > /tmp/qc_edge.log 2>&1 &
    EDGE_PID=$!
    i=0
    while [ $i -lt 40 ]; do
      if cdp_ready; then
        sleep 0.3
        kill -0 "$EDGE_PID" 2>/dev/null || { echo "!! 浏览器进程已退出（见 /tmp/qc_edge.log）"; return 1; }
        return 0
      fi
      sleep 0.5; i=$((i + 1))
    done
    CDP_PORT=$((CDP_PORT + 1))
  done
  return 1
}
stop_edge() {
  # Windows 上 kill 父进程不会带走 crashpad 等子进程，它们会继续占着 profile 里的文件，
  # 导致清理失败、残留几十 MB。这里按进程树结束。
  if [ -n "${EDGE_PID:-}" ]; then
    case "$(uname -s 2>/dev/null)" in
      MINGW*|MSYS*|CYGWIN*) taskkill //F //T //PID "$EDGE_PID" >/dev/null 2>&1 ;;
      *) kill "$EDGE_PID" 2>/dev/null ;;
    esac
  fi
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
  OUT="$DIR/.e2e-out.txt"
  QC_CDP="http://127.0.0.1:$CDP_PORT" QC_APP="http://127.0.0.1:$PORT/index.html" "$NODE" "$DIR/$1" > "$OUT" 2>&1
  rc=$?
  cat "$OUT"
  # v5.11.0：必须真的产出汇总行，否则判失败——防止「进程静默退出但退出码 0」被当成通过
  if ! grep -q '^== ' "$OUT"; then
    echo "!! $1 没有输出结果汇总行（疑似未真正执行）"
    rc=1
  fi
  rm -f "$OUT" 2>/dev/null
  stop_edge
  return $rc
}

RC=0
if [ "$SCRIPT" = "all" ]; then
  # 自动发现 e2e-*.mjs：仓库里实际存在多少套就跑多少套，不再手写清单
  # （手写清单漏项时会被 [ -f ] 静默跳过，看起来「全绿」其实没跑）
  for p in "$DIR"/e2e-*.mjs; do
    [ -f "$p" ] || continue
    f=$(basename "$p")
    echo "--- $f ---"
    run_one "$f" || RC=1
  done
  # v5.11.0：shell 用例也要进 all。此前只发现 .mjs，所谓「全量」其实只有 13 项
  for p in "$DIR"/*.sh; do
    [ -f "$p" ] || continue
    case "$p" in */run.sh) continue ;; esac
    echo "--- $(basename "$p") ---"
    sh "$p" || RC=1
  done
else
  run_one "$SCRIPT" || RC=1
fi
exit $RC
