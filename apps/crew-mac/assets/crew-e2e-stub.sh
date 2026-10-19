#!/bin/sh
# Stub cho nghiệm thu UI Crew: không gọi model. Chỉ chạy khi wrapper thấy checkout e2e-* có tệp đánh dấu.
# Dòng đầu của tệp đánh dấu là số giây ngủ (0–900; sai thì 5). CREW_E2E_STUB_SLEEP chỉ dùng cho test.
marker=$1
secs=$(head -n 1 "$marker" 2>/dev/null | tr -cd '0-9')
case "$secs" in ''|*[!0-9]*) secs=5 ;; esac
[ "${#secs}" -gt 3 ] && secs=900
[ "$secs" -gt 900 ] && secs=900
${CREW_E2E_STUB_SLEEP:-sleep} "$secs" &
pid=$!
trap 'kill "$pid" 2>/dev/null; exit 143' TERM
wait "$pid"
printf '%s\n' '{"type":"result","subtype":"success","is_error":false,"result":"crew-e2e-stub","session_id":"crew-e2e-stub","total_cost_usd":0}'
exit 0
