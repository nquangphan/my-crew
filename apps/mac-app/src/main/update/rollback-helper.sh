#!/bin/sh
# rollback-helper.sh <now|watchdog> <pid chờ thoát> <thư mục app support> <bản đang thử>
#
# Chạy tách rời khỏi app (detached), sống qua lúc app thoát hay bị Squirrel thay.
# - now: chờ pid thoát rồi thay app bằng previous/2P Crew.app và mở lại.
# - watchdog (sinh ngay trước quitAndInstall, pid = app cũ). Không đếm giờ khi app cũ còn sống:
#   1. Chờ app cũ thoát, không giới hạn. Cài hỏng mà app cũ ở lại: updater ghi <bản>.cancelled, helper thôi.
#   2. Từ lúc app cũ thoát: chờ bản mới ghi <bản>.started tối đa START_WAIT. Không thấy thì: ShipIt (Squirrel) còn
#      chạy thì chờ nó xong tối đa SHIPIT_WAIT, quá hạn thì thoát 5 và không đụng app (không bao giờ ghi app đích
#      cùng lúc với ShipIt); không có app nào chạy thì `open` app một lần và chờ thêm START_WAIT.
#   3. Từ lúc thấy <bản>.started: chờ <bản>.ok/.failed tối đa WATCH (>= hạn probation + biên).
#   Hết hạn mà không có marker: TERM đúng binary app đích rồi quay lui như now.
# Chỉ ghi vào app đích và thư mục app support. Test đặt CREW_ROLLBACK_TARGET, CREW_ROLLBACK_OPEN và các hạn
# CREW_ROLLBACK_START_WAIT, CREW_ROLLBACK_WATCH, CREW_ROLLBACK_SHIPIT_WAIT (giây).
set -eu
MODE=$1; WAIT_PID=$2; SUPPORT=$3; TO=$4
TARGET=${CREW_ROLLBACK_TARGET:-/Applications/2P Crew.app}
OPEN=${CREW_ROLLBACK_OPEN:-open}
START_WAIT=${CREW_ROLLBACK_START_WAIT:-600}
WATCH=${CREW_ROLLBACK_WATCH:-1200}
SHIPIT_WAIT=${CREW_ROLLBACK_SHIPIT_WAIT:-1200}
APP_BIN="$TARGET/Contents/MacOS/2P Crew"
SHIPIT="$TARGET/Contents/Frameworks/Squirrel.framework/Resources/ShipIt"
PREV="$SUPPORT/previous/2P Crew.app"
MARK="$SUPPORT/probation"

settled() { [ -f "$MARK/$TO.ok" ] || [ -f "$MARK/$TO.failed" ] || [ -f "$MARK/$TO.cancelled" ]; }
started() { [ -f "$MARK/$TO.started" ] || settled; }
app_running() { pgrep -f "$APP_BIN" >/dev/null 2>&1; }
shipit_done() { ! pgrep -f "$SHIPIT" >/dev/null 2>&1; }
# wait_until <giây> <hàm>: thành công khi hàm đúng trong hạn.
wait_until() {
  n=0
  until "$2"; do
    [ "$n" -ge "$1" ] && return 1
    sleep 1
    n=$((n + 1))
  done
}

if [ "$MODE" = watchdog ]; then
  while kill -0 "$WAIT_PID" 2>/dev/null; do
    settled && exit 0
    sleep 1
  done
  if ! wait_until "$START_WAIT" started; then
    wait_until "$SHIPIT_WAIT" shipit_done || exit 5
    if ! started && ! app_running; then
      "$OPEN" "$TARGET" || true
      wait_until "$START_WAIT" started || true
    fi
  fi
  settled && exit 0
  if [ -f "$MARK/$TO.started" ]; then
    wait_until "$WATCH" settled && exit 0
  fi
  pkill -TERM -f "$APP_BIN" || true
  WAIT_PID=$(pgrep -f "$APP_BIN" | head -1 || true)
fi
mkdir -p "$MARK"
: > "$MARK/$TO.failed"
while [ -n "$WAIT_PID" ] && kill -0 "$WAIT_PID" 2>/dev/null; do sleep 1; done
[ -d "$PREV" ] || exit 3
rm -rf "$TARGET.rollback-tmp"
mv "$TARGET" "$TARGET.rollback-tmp"
if ! ditto "$PREV" "$TARGET"; then
  rm -rf "$TARGET"
  mv "$TARGET.rollback-tmp" "$TARGET"
  exit 4
fi
rm -rf "$TARGET.rollback-tmp"
echo "$TO" > "$MARK/rolled-back"
"$OPEN" "$TARGET"
