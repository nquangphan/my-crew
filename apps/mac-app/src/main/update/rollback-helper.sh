#!/bin/sh
# rollback-helper.sh <now|watchdog> <pid chờ thoát> <thư mục app support> <bản đang thử>
#
# Chạy tách rời khỏi app (detached), sống qua lúc app thoát hay bị Squirrel thay.
# - now: chờ pid thoát rồi thay app bằng previous/2P Crew.app và mở lại.
# - watchdog: ngủ 6 phút; bản mới chưa ghi probation/<bản>.ok hay .failed (treo, crash khi mở) thì giết nó và quay lui.
# Chỉ ghi vào app đích và thư mục app support. Test đặt CREW_ROLLBACK_TARGET, CREW_ROLLBACK_OPEN, CREW_ROLLBACK_WAIT.
set -eu
MODE=$1; WAIT_PID=$2; SUPPORT=$3; TO=$4
TARGET=${CREW_ROLLBACK_TARGET:-/Applications/2P Crew.app}
OPEN=${CREW_ROLLBACK_OPEN:-open}
WAIT=${CREW_ROLLBACK_WAIT:-360}
PREV="$SUPPORT/previous/2P Crew.app"
MARK="$SUPPORT/probation"
if [ "$MODE" = watchdog ]; then
  sleep "$WAIT"
  [ -f "$MARK/$TO.ok" ] && exit 0
  [ -f "$MARK/$TO.failed" ] && exit 0
  pkill -TERM -f "$TARGET/Contents/MacOS/2P Crew" || true
  WAIT_PID=$(pgrep -f "$TARGET/Contents/MacOS/2P Crew" | head -1 || true)
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
