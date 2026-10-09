# UP-4: sửa restore drill cho cấu hình public (09/10/2026, Asia/Ho_Chi_Minh)

## Thay đổi (`crew/ops/restore-drill.sh`, nhánh sync/paperclip-v2026.1005.0)
- Lấy `PAPERCLIP_PUBLIC_URL` từ compose đã restore (`$DRILL/docker-compose.yml`, fallback `.env`); thiếu thì thoát mã 4.
- Host header = host của public URL (private: `100.105.105.12:3100`, public: `crew.2p-solutions.com`); thêm `X-Forwarded-Proto: https` khi URL là https.
- Cookie phiên đọc từ `.board-cookies` (dòng có tên kết thúc `session_token`, gỡ tiền tố `#HttpOnly_`), gửi bằng `Cookie:` header; giá trị nằm trong biến, không in (log chỉ in `cookie=yes/no`).
- Health check và gọi API dùng chung mảng header. Giữ nguyên cách ly/quarantine và cleanup trap.
- `bash -n` OK; `node --test crew/ops/*.test.mjs`: 23/23 pass (không có test riêng cho drill).
- Lưu ý: cookie xuất hiện trong argv của curl trên VPS trong vài giây (chỉ user có quyền xem process).

## Triển khai
Bản cũ: `/opt/crew-v3-spike/backups/restore-drill.sh.before-public`; bản mới scp vào `/opt/crew-v3-spike/ops/restore-drill.sh`.

## Log lần chạy thật (backup TS 20261009-0828)
```
drill: issues match (77), heartbeat_runs=203
drill: API host=crew.2p-solutions.com proto=https cookie=yes
drill: API issue 4df65adc-... status=done expected=done
drill: builtin paperclip-20261009-004812.sql.gz restored, issues=77
DRILL OK   (rc=0, không WARN)
```
Dọn dẹp: `docker compose ls` không còn `crew-v3-spike-restore`; `/opt/crew-v3-spike/restore-drill` đã xóa.
