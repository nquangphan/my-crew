# Kiểm tra sức khỏe máy (crewd doctor)

> Flow `daemon-health`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow daemon-health`
> in ra đúng danh sách đó.

## Mục đích

Một bộ kiểm tra dùng chung cho `crewd doctor` (dòng lệnh) và dashboard app desktop (flow `desktop-app`): máy
có kết nối được VPS, token còn hạn, luồng sự kiện còn sống, Claude Code đăng nhập đúng gói đăng ký (không lỡ
tính phí qua API key), MCP server và skill agent thấy được trong worktree đúng như checkout chính, mỗi repo có
git/crew-docs/hook/docs và không còn worktree thừa, tài nguyên máy (job cũ, tiến trình, thư mục tạm, container)
đã được dọn, và daemon chạy trong đúng phiên hệ điều hành để đọc được Keychain đăng nhập. Một số lỗi có thể tự
sửa một lần rồi kiểm lại; app desktop còn cho fix mở thêm màn hình khác (ví dụ ghép lại máy).

## Điểm vào

- `apps/daemon/src/commands/doctor.ts` → `doctor()` — gọi từ `crewd doctor` (`cli.ts`, flow `daemon-runtime`)
  và dùng lại nguyên trạng bởi `HealthOps` của app desktop (`apps/desktop/src/daemon-host/health-ops.ts`, flow
  `desktop-app`).

## Các bước

1. `apps/daemon/src/health/health-runner.ts` → `runHealthChecks()`: chạy tuần tự `HEALTH_CHECKS` theo đúng
   thứ tự dashboard — server, claude, mcp, skills, repos, machine, resources, app; một check ném lỗi thì kết
   quả đỏ với thông báo lỗi thay vì làm hỏng cả lượt chạy. Với `fix: true` (mặc định của `crewd doctor`), kết
   quả không xanh mà có `fix` được sửa một lần (`check.fix()`) rồi `check.run()` lại; nếu lần sau xanh thì
   đánh dấu `fixed: true`. `applyHealthFix(ctx, group, fixId)` áp đúng một fix theo nhóm — đây là hàm app
   desktop gọi khi chủ dự án bấm nút sửa một dòng cụ thể trên dashboard.
2. `apps/daemon/src/health/checks/server.ts` → `serverChecks.run()`/`fix()`: chưa có config → đỏ (gợi ý
   `crewd pair`); `GET /v1/health` không tới được → đỏ; chưa có token hoặc bị từ chối ở `listProjects()` → đỏ
   (fix `repair`: ghép lại máy — app desktop điều hướng sang bước Ghép máy, CLI chỉ in gợi ý); còn dưới 14
   ngày hết hạn → vàng (fix `rotate-token`); còn daemon đang chạy (`ctx.daemon` có, tức app desktop hoặc
   `crewd start`) thì thêm dòng luồng sự kiện SSE — mất kết nối → đỏ/vàng tuỳ daemon có đang chạy không, fix
   `reconnect` khởi động lại `stream`.
3. `apps/daemon/src/health/checks/claude.ts` → `claudeChecks.run()`: `ANTHROPIC_API_KEY` có trong env dịch vụ
   → đỏ, fix `api-key-help` (app desktop mở hộp hướng dẫn gỡ biến tại chỗ; CLI chỉ in gợi ý); runtime Claude
   Code đóng gói theo Agent SDK (`claude.runtime`, từ `sdkRuntimeVersion()`) thiếu hoặc cũ hơn
   `MIN_CLAUDE_VERSION` → đỏ; CLI `claude --version` thiếu → vàng, cũ hơn `MIN_CLAUDE_VERSION` (2.1.277 — từ
   bản này resume session mới khôi phục đúng chi phí) → đỏ; khi không phải lượt chạy nhanh (`quick`) và không
   bị bỏ qua (`skipLoginProbe`) thì `loginProbe()` — một turn haiku không tool, không settings, phí thấp nhất
   có thể — thất bại hoặc `apiKeySource !== 'none'` → đỏ (đang tính phí qua API key), fix `open-claude-login`
   (app desktop mở Terminal chạy `claude`; CLI chỉ gợi ý lệnh).
4. `apps/daemon/src/health/checks/mcp.ts` → `mcpChecks.run()`/`fix()`: mỗi project, đọc kho MCP đã dò
   (`storedInventory()`) — chưa có thì vàng, fix `refresh-inventory:<key>`; mỗi server không bị tắt cho
   project mà không `connected` → đỏ, fix `mcp-disable:<key>:<server>`; server MCP test UI bắt buộc cho loại
   project (`OFFICIAL_UI_TEST_SERVERS`, mặc định Playwright cho web, Maestro cho mobile qua `qcDefaultMcps()`)
   thiếu → đỏ, fix `mcp-install:<key>:<role>` (chạy `claude mcp add --scope user`); đang bị tắt dù QC bắt buộc
   dùng → đỏ, fix `mcp-enable:<key>:<server>`; project cần thiết bị (`mobile`/`web_mobile`) mà không có
   simulator/emulator sẵn sàng (`xcrun simctl`/`adb devices`) → vàng, fix `open-simulator` trên macOS.
5. `apps/daemon/src/health/checks/skills.ts` → `skillChecks.run()`/`fix()`: mỗi project, kho skill đã dò
   (`storedInventory()`) — chưa có thì vàng, fix `skills-refresh:<key>`; khi có `probeCheckout` (không phải
   lượt nhanh), dò skill của checkout chính rồi so với inventory trong worktree job — thiếu skill nào → đỏ,
   fix `skills-redetect:<key>` (xoá worktree probe để dò lại thư mục dùng chung); có kho skill cấp máy (dùng
   cho job trợ lý, `storedInventory(ctx, null)`) thì thêm một dòng riêng.
6. `apps/daemon/src/health/checks/repos.ts` → `repoChecks.run()`/`fix()`: kiểm `git --version`; crew-docs đã
   cài ở `~/.crew/bin` chưa (fix `install-crew-docs`: `installCrewDocs()`, chạy bằng runtime của
   `ctx.crewDocs` — binary app khi gọi từ desktop, `process.execPath` khi gọi từ CLI); mỗi project trong
   config dùng `repoFolderChecks()` (`repo-probe.ts`, dùng chung với trình cài đặt của app desktop) cho thư
   mục/`origin`/nhánh mặc định/quyền push/working tree; hook crew-docs đã cài đủ file chưa
   (`hookStatus()`/`missingHookFiles()`) và có phải bản crew-docs hiện tại của máy không, fix
   `install-hooks:<key>`; docs đã khởi tạo chưa (`docs/flows.yaml`) — chưa có thì vàng, không có fix (một
   ticket docs-init sẽ tự chạy trước); worktree thừa của ticket đã đóng (`orphanWorktrees()`) → vàng, fix
   `clean-worktrees:<key>`.
7. `apps/daemon/src/health/checks/machine.ts` → `machineChecks.run()`: dùng `takeSnapshot()`/`totalSlots()`
   (flow `daemon-scheduling`) báo số slot trống — 0 → vàng (máy đang bận hoặc giới hạn quá chặt), fix
   `adjust-limits` (app desktop mở mục Tài nguyên trong Cài đặt); đĩa trống dưới `MIN_DISK_FREE_GB` (10 GB,
   cần cho worktree và file tạm) → vàng.
8. `apps/daemon/src/health/checks/resources.ts` → `resourceChecks.run()`/`fix()`: dùng lại đúng `ResourceOps`
   mà PM dùng cho `resource_report`/`cleanup_resources` (flow `resource-hygiene`) qua `healthResourceOps()`;
   tiến trình mồ côi, thư mục tạm, worktree của ticket đã đóng còn sót → vàng, fix chung `cleanup-resources`;
   container do job tạo còn chạy → vàng, chỉ báo cáo (PM tự dừng khi cần, không có fix tự động).
9. `apps/daemon/src/health/checks/app.ts` → `serviceChecks.run()`: macOS kiểm `launchctl managername` phải là
   `Aqua`/`Background` (phiên người dùng, đọc được Keychain đăng nhập) — không đúng thì vàng, gợi ý chạy qua
   app 2P Crew; Linux kiểm `systemctl --user is-enabled crewd.service` — chưa cài thì vàng, gợi ý `crewd
   install-service`. Khi `ctx.app` có mặt (chỉ app desktop truyền, qua `HealthOps.facts`) thêm ba dòng riêng
   của app: `app.daemon` (daemon runtime có đang chạy không, đỏ + fix `restart-daemon` nếu không),
   `app.login-item` (đã bật mở cùng máy chưa, vàng + fix `enable-login-item` nếu chưa), `app.version` (có bản
   cập nhật
   hay lỗi kiểm tra thì vàng + fix `install-update`, ngược lại xanh).
10. `apps/daemon/src/health/health-runner.ts` → `summarize()`: gộp mọi kết quả thành `HealthSummary` (trạng
    thái tệ nhất cộng danh sách check không xanh) gửi kèm heartbeat (`daemon.ts`, flow `daemon-runtime`); app
    desktop gọi lại `daemon.heartbeat()` ngay khi trạng thái đổi, nên trang Máy trên web thấy đúng lúc.
11. `apps/daemon/src/commands/doctor.ts` → `renderHealth()`: in kết quả dạng text theo nhóm, dùng đúng tiêu
    đề `HEALTH_GROUP_TITLES` (Server, Claude, MCP, Skill, Repo, Máy, Tài nguyên, Ứng dụng) theo thứ tự
    dashboard, có đánh dấu "(đã tự sửa)" và gợi ý sửa cho mục còn đỏ/vàng — cùng nhóm và thứ tự mà
    `HealthPage` của app desktop (`groupResults()`) dùng để vẽ dashboard.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/daemon/src/commands/doctor.ts` | Lệnh `crewd doctor`: chạy + render | `doctor`, `renderHealth` |
| `apps/daemon/src/health/health-runner.ts` | Chạy mọi check, áp dụng fix, tóm tắt | `runHealthChecks`, `applyHealthFix`, `summarize`, `HEALTH_CHECKS`, `execCommand` |
| `apps/daemon/src/health/types.ts` | Kiểu chung của một check/kết quả/ngữ cảnh | `HealthCheck`, `HealthCheckResult`, `HealthContext`, `HealthAppFacts`, `result` |
| `apps/daemon/src/health/checks/server.ts` | Kết nối VPS, token, luồng sự kiện | `serverChecks` |
| `apps/daemon/src/health/checks/claude.ts` | Runtime/CLI Claude Code, đăng nhập, không lộ API key | `claudeChecks`, `loginProbe`, `compareVersions`, `MIN_CLAUDE_VERSION` |
| `apps/daemon/src/health/checks/mcp.ts` | MCP server đã dò được và MCP test UI bắt buộc | `mcpChecks`, `OFFICIAL_UI_TEST_SERVERS` |
| `apps/daemon/src/health/checks/skills.ts` | Kho skill của project và khớp checkout chính | `skillChecks`, `describeSkills` |
| `apps/daemon/src/health/checks/repos.ts` | git, crew-docs, hook, docs, worktree thừa mỗi project | `repoChecks`, `missingHookFiles`, `orphanWorktrees` |
| `apps/daemon/src/health/checks/machine.ts` | Tài nguyên máy, đĩa trống | `machineChecks`, `MIN_DISK_FREE_GB` |
| `apps/daemon/src/health/checks/resources.ts` | Tiến trình/thư mục tạm/worktree/container mồ côi | `resourceChecks`, `healthResourceOps` |
| `apps/daemon/src/health/checks/app.ts` | Phiên hệ điều hành / dịch vụ hệ thống / trạng thái app desktop | `serviceChecks` |
| `apps/daemon/src/health/repo-probe.ts` | Kiểm tra thư mục repo dùng chung với trình cài đặt app | `repoFolderChecks`, `inspectFolder`, `runGit`, `normalizeRepoUrl`, `suggestProjectKey` |
| `apps/daemon/src/health/project-views.ts` | Đọc project phía server, kho skill/MCP đã lưu | `serverProjects`, `storedInventory`, `updateProjectConfig` |
| `packages/shared/src/health-schemas.ts` | Schema zod dùng chung cho check/report/nhóm | `HealthGroup`, `HEALTH_GROUP_TITLES`, `HealthCheckResult`, `HealthReport`, `HealthFixId` |

## Dữ liệu

- Bảng: đọc `meta` (`tokenExpiresAt`, `inventory:<key>` — kho MCP/skill máy hoặc từng project) của
  `apps/daemon/src/state-db.ts` (flow `daemon-runtime`); không ghi bảng nào ngoài các fix (ví dụ
  `rotate-token` ghi lại `tokenExpiresAt`).
- Sự kiện: không tự phát sự kiện; `summarize()` được nhúng vào body heartbeat (`HeartbeatRequest.health`); app
  desktop còn phát `HealthReport` đầy đủ qua sự kiện nội bộ `health.report` (flow `desktop-app`).
- Gọi ngoài: `GET /v1/health`, `GET /v1/daemon/projects` qua `VpsClient`; Agent SDK (`loginProbe()`, một turn
  haiku thật; `claude mcp add --scope user` khi cài MCP test UI); `git --version`, `claude --version`,
  `launchctl managername` (macOS), `systemctl --user` (Linux), `xcrun simctl`/`adb devices` (thiết bị
  mobile), `open -a Simulator` (fix) qua `execCommand()`.

## Flow liên quan

- daemon-runtime: `crewd doctor` gọi `doctor()`; `HealthSummary` được gắn vào heartbeat của `createDaemon()`.
- daemon-scheduling: `machineChecks` dùng lại `takeSnapshot()`/`totalSlots()`.
- agent-workspace: `repoChecks` gọi `hookStatus()`/`installCrewDocs()`/`installHooks()` của
  `docs-kit-bridge.ts`; `skillChecks`/`mcpChecks` đọc lại kho mà `probeInventory()` (flow `agent-workspace`)
  lưu vào `meta`.
- resource-hygiene: `resourceChecks` dùng chung `ResourceOps` với `cleanup_resources`/`resource_report`
  (`healthResourceOps()`).
- desktop-app: `HealthOps` (`apps/desktop/src/daemon-host/health-ops.ts`) dựng `HealthContext` với thêm
  `daemon`, `app`, `crewDocs`, `probeCheckout`, `quick` rồi gọi đúng `runHealthChecks()`/`applyHealthFix()`
  của flow này cho dashboard và các nút sửa.

## Tests

- `apps/daemon/test/health-checks.test.ts`: so sánh phiên bản và phân tích output CLI; báo lỗi khi
  `ANTHROPIC_API_KEY` có trong env dịch vụ hoặc CLI quá cũ; login probe phát hiện billing qua API key; `crewd
  doctor` tự cài crew-docs và hook còn thiếu rồi báo xanh; check server: kết nối được, token hợp lệ, hạn dùng;
  systemd user unit sinh ra không có API key và cài được qua `systemctl --user`.
- `apps/daemon/test/health-groups.test.ts`: helper kiểm tra thư mục repo (chuẩn hoá URL, gợi ý key, đọc
  origin/nhánh, phát hiện không có quyền push); nhóm repos chuyển đỏ khi hook bị xoá, sai origin hay có
  worktree thừa rồi các fix đưa nó về xanh, và báo vàng khi repo chưa có docs; nhóm mcp/skills: bắt buộc
  Playwright cho project web, cài được qua `claude mcp add`, tắt được server lỗi, so khớp inventory worktree
  với checkout chính; nhóm resources/server/app: dọn được thư mục tạm của job đã xong bằng đúng code dọn tài
  nguyên, hiện đúng trạng thái SSE và kết nối lại được, thêm đúng ba dòng riêng khi app desktop truyền facts,
  và chạy đủ mọi nhóm theo đúng thứ tự dashboard (từ chối fix cho nhóm không có cách sửa).
