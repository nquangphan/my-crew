# Kiểm tra sức khỏe máy (crewd doctor)

> Flow `daemon-health`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow daemon-health`
> in ra đúng danh sách đó.

## Mục đích

Một bộ kiểm tra dùng chung cho `crewd doctor` (dòng lệnh) và dashboard app desktop (Phase 9): máy có kết nối
được VPS, token còn hạn, Claude Code đăng nhập đúng gói đăng ký (không lỡ tính phí qua API key), mỗi repo có
git/crew-docs/hook, tài nguyên máy đủ, và daemon chạy trong đúng phiên hệ điều hành để đọc được Keychain đăng
nhập. Một số lỗi có thể tự sửa một lần rồi kiểm lại.

## Điểm vào

- `apps/daemon/src/commands/doctor.ts` → `doctor()` — gọi từ `crewd doctor` (`cli.ts`, flow `daemon-runtime`)
  và dùng lại nguyên trạng bởi dashboard app desktop.

## Các bước

1. `apps/daemon/src/health/health-runner.ts` → `runHealthChecks()`: chạy tuần tự `HEALTH_CHECKS` (server,
   claude, repos, machine, app); một check ném lỗi thì kết quả đỏ với thông báo lỗi thay vì làm hỏng cả lượt
   chạy. Với `fix: true` (mặc định), kết quả không xanh mà có `fix` được sửa một lần (`check.fix()`) rồi
   `check.run()` lại; nếu lần sau xanh thì đánh dấu `fixed: true`.
2. `apps/daemon/src/health/checks/server.ts` → `serverChecks.run()`: chưa có config → đỏ (gợi ý `crewd pair`);
   `GET /v1/health` không tới được → đỏ; chưa có token → đỏ; token bị từ chối ở `listProjects()` → đỏ (gợi ý
   ghép lại máy); còn dưới 14 ngày hết hạn → vàng (gợi ý `crewd rotate-token`); ngược lại xanh.
3. `apps/daemon/src/health/checks/claude.ts` → `claudeChecks.run()`: `ANTHROPIC_API_KEY` có trong env dịch vụ
   → đỏ (billing phải ở lại đăng nhập gói đăng ký); CLI `claude --version` thiếu → vàng, cũ hơn
   `MIN_CLAUDE_VERSION` (2.1.277 — từ bản này resume session mới khôi phục đúng chi phí) → đỏ; rồi
   `loginProbe()` — một turn haiku không tool, không settings, phí thấp nhất có thể — thất bại hoặc
   `apiKeySource !== 'none'` → đỏ (đang tính phí qua API key); `--no-login-probe` bỏ qua bước tốn phí này.
4. `apps/daemon/src/health/checks/repos.ts` → `repoChecks.run()`/`fix()`: kiểm `git --version`; crew-docs đã
   cài ở `~/.crew/bin` chưa (fix: `installCrewDocs()`); mỗi project trong config có phải thư mục git hợp lệ
   không, và hook crew-docs đã cài chưa (`hookStatus()`, fix: `installHooks()`).
5. `apps/daemon/src/health/checks/machine.ts` → `machineChecks.run()`: dùng `takeSnapshot()`/`totalSlots()`
   (flow `daemon-scheduling`) báo số slot trống (0 → vàng, máy đang bận); đĩa trống dưới `MIN_DISK_FREE_GB`
   (10 GB, cần cho worktree và file tạm) → vàng.
6. `apps/daemon/src/health/checks/app.ts` → `serviceChecks.run()`: macOS kiểm `launchctl managername` phải là
   `Aqua`/`Background` (phiên người dùng, đọc được Keychain đăng nhập) — không đúng thì vàng, gợi ý chạy qua
   app 2P Crew; Linux kiểm `systemctl --user is-enabled crewd.service` — chưa cài thì vàng, gợi ý `crewd
   install-service`.
7. `apps/daemon/src/health/health-runner.ts` → `summarize()`: gộp mọi kết quả thành `HealthSummary` (trạng
   thái tệ nhất cộng danh sách check không xanh) gửi kèm heartbeat (`daemon.ts`, flow `daemon-runtime`).
8. `apps/daemon/src/commands/doctor.ts` → `renderHealth()`: in kết quả dạng text theo nhóm (Server, Claude,
   Repo, Máy, Dịch vụ), có đánh dấu "(đã tự sửa)" và gợi ý sửa cho mục còn đỏ/vàng — cùng dữ liệu app desktop
   dùng để vẽ dashboard.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/daemon/src/commands/doctor.ts` | Lệnh `crewd doctor`: chạy + render | `doctor`, `renderHealth` |
| `apps/daemon/src/health/health-runner.ts` | Chạy mọi check, áp dụng fix, tóm tắt | `runHealthChecks`, `summarize`, `HEALTH_CHECKS`, `execCommand` |
| `apps/daemon/src/health/types.ts` | Kiểu chung của một check/kết quả | `HealthCheck`, `HealthCheckResult`, `HealthContext`, `result` |
| `apps/daemon/src/health/checks/server.ts` | Kết nối VPS, token | `serverChecks` |
| `apps/daemon/src/health/checks/claude.ts` | Đăng nhập Claude Code, không lộ API key | `claudeChecks`, `loginProbe`, `compareVersions`, `MIN_CLAUDE_VERSION` |
| `apps/daemon/src/health/checks/repos.ts` | git, crew-docs, hook mỗi project | `repoChecks` |
| `apps/daemon/src/health/checks/machine.ts` | Tài nguyên máy, đĩa trống | `machineChecks`, `MIN_DISK_FREE_GB` |
| `apps/daemon/src/health/checks/app.ts` | Phiên hệ điều hành / dịch vụ hệ thống | `serviceChecks` |

## Dữ liệu

- Bảng: đọc `meta` (`tokenExpiresAt`) của `apps/daemon/src/state-db.ts` (flow `daemon-runtime`); không ghi
  bảng nào.
- Sự kiện: không phát sự kiện; `summarize()` được nhúng vào body heartbeat (`HeartbeatRequest.health`).
- Gọi ngoài: `GET /v1/health`, `GET /v1/daemon/projects` qua `VpsClient`; Agent SDK (`loginProbe()`, một turn
  haiku thật); `git --version`, `claude --version`, `launchctl managername` (macOS), `systemctl --user`
  (Linux) qua `execCommand()`.

## Flow liên quan

- daemon-runtime: `crewd doctor` gọi `doctor()`; `HealthSummary` được gắn vào heartbeat của `createDaemon()`.
- daemon-scheduling: `machineChecks` dùng lại `takeSnapshot()`/`totalSlots()`.
- agent-workspace: `repoChecks` gọi `hookStatus()`/`installCrewDocs()`/`installHooks()` của
  `docs-kit-bridge.ts`.

## Tests

- `apps/daemon/test/health-checks.test.ts`: so sánh phiên bản và phân tích output CLI; báo lỗi khi
  `ANTHROPIC_API_KEY` có trong env dịch vụ hoặc CLI quá cũ; login probe phát hiện billing qua API key; `crewd
  doctor` tự cài crew-docs và hook còn thiếu rồi báo xanh; check server: kết nối được, token hợp lệ, hạn dùng;
  systemd user unit sinh ra không có API key và cài được qua `systemctl --user`.
