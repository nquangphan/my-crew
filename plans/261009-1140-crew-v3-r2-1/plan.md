---
title: "Crew v3 R2-1 — App macOS 2P Crew ký số bọc crew-mac"
description: "App Electron 2P Crew ký Developer ID, sở hữu sshd agent để TCC gán quyền cho app một lần; màn hình cài đặt/sức khỏe/project/run/log/cập nhật; updater từ xa có drain, probation, quay lui; thêm project với bộ agent riêng và vai trò theo project trong DB plugin; gỡ app v2."
status: pending
priority: P1
effort: 9d
branch: r2-1
tags: [crew-v3, mac-app, electron, tcc, sshd, updater, project-roles, crew-mac]
created: 2026-10-09
---

# Crew v3 R2-1 — App macOS 2P Crew — Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trên Mac mini, app "2P Crew" (bundle `com.2p-solutions.crew.mac`, ký Developer ID, notarize) sinh sshd agent cổng 2222 làm process con. Mọi `claude` do Paperclip chạy qua SSH nhận app làm responsible process, nên macOS chỉ hỏi quyền cho app một lần. Đóng cửa sổ, thoát, crash hay cập nhật app không giết run. Owner cài, kiểm sức khỏe, xem run/log, thêm project và cập nhật app bằng màn hình; CLI `crew-mac` vẫn chạy độc lập.

**Architecture:** App Electron mới `apps/mac-app` trong repo Crew. Main process giữ tray, cửa sổ, quit guard, updater và bộ giám sát sshd (`/usr/sbin/sshd -D -f ~/.crew-mac/sshd/sshd_config`). Thao tác dài (doctor, clone, REST) chạy trong `utilityProcess`, gọi `@crew/mac` như thư viện. `@crew/mac` thêm chế độ `sshdOwner: "app" | "launchd"`. LaunchAgent reaper và status giữ nguyên. Phía server chỉ đổi code Crew: plugin `crew.core` có bảng `crew_project_roles` và API route ghi vai trò theo project; `server/src/crew/issue-policy.ts` đọc vai trò theo `issue.projectId` từ bảng đó trước, fallback `CREW_POLICY_CONFIG`. Không thêm hook lõi. Updater dùng `electron-updater` provider GitHub trên repo public `nquangphan/crew-mac-releases`.

**Tech Stack:** Electron 44.4.5, electron-vite 5.0.0, electron-builder 26.15.3, electron-updater ^6.8.9 (cùng bản app v2), React 19 cho renderer, TypeScript 7, Vitest 5, Biome 2.5; `@crew/mac` (Node ≥ 22, ESM); OpenSSH `/usr/sbin/sshd`; `xcrun notarytool`/`stapler`; fork Paperclip `v2026.1005.0` (server Express + Drizzle, plugin SDK `apiRoutes`, `database.migrationsDir`).

**Spec:** [2026-10-09-crew-v3-r2-1-mac-app-design.md](../../docs/superpowers/specs/2026-10-09-crew-v3-r2-1-mac-app-design.md). Mục 16 (owner chốt 09/10/2026) thắng mọi chỗ khác trong spec. Khung tham chiếu: [R1-1](../261006-1355-crew-v3-r1-1/plan.md), [R1-5](../261009-0820-crew-v3-r1-5/plan.md).

**Hiện trạng (09/10/2026 11:40):**
- Repo Crew `v3` @ `6bfcf48`. `apps/crew-mac` có `setup`, `doctor`, `uninstall`, `status`, `stop-run`, `reap`, `workflow-check`; chưa có `exports` thư viện.
- Fork `.worktrees/paperclip-v3` nhánh `v3` @ `4dca97106`, nền `v2026.1005.0`, hook 5/5 (H1–H5), tag phát hành gần nhất `crew/v3.0`.
- Mac mini: `crew-mac` cài ở `~/.crew/app/crew-mac`; LaunchAgent `com.2p.crew-mac-sshd` (cổng 2222, agent đang dùng), `com.2p.crew-mac-reaper`, `com.2p.crew-mac-status`. 5 checkout agent trong `~/crew-agents/`.
- Keychain chưa có `Developer ID Application` (spec E6). App v2 `/Applications/2P Crew.app` 0.3.0 vẫn cài.

## Global Constraints

- **Paperclip ghim `v2026.1005.0` tới hết R3.** Không nâng upstream, không chạy `crew/release/upgrade.sh`.
- **Không thêm hook lõi** (ngân sách 5/5 đã dùng: H1–H5). Không sửa `server/src/**` ngoài `server/src/crew/**`, không sửa `ui/**` lõi. Đổi vai trò theo project chỉ đổi logic trong `server/src/crew/`, có test. `crew/release/check-core-hooks.mjs` vẫn báo đủ 5 mốc. Việc nào buộc phải sửa lõi thì dừng, ghi ledger, hỏi owner.
- **Worker phát triển chỉ là agent Claude.** sonnet cho việc bám khuôn. opus cho: hook/policy, DB/migration plugin, auth/`cli-auth`, sshd/TCC/vòng đời process trên Mac, ký/updater, review cuối toàn nhánh. Không Codex, không fable.
- **Ký/notarize:** chứng chỉ `Developer ID Application` và notary profile `crew-notary` do owner tự tạo trong Keychain. Cổng ký (UPD-3) bị chặn tới khi có; ticket không phụ thuộc nó chạy trước. Không bao giờ in, ghi log hay commit secret (mật khẩu app-specific, `.p12`, board API key, webhook secret, private key).
- **Spike S1–S4 chạy đầu tiên và là cổng đi/không đi (G0).** Nếu app mở từ Finder hoặc login item không giữ quan hệ responsible với sshd con, dừng và báo owner trước khi làm app lõi. S5 (board API key tạo agent/environment) là cổng riêng cho PJ-1.
- **Mac mini dùng chung** (owner chạy nhiều dự án, quota Claude chung). Một việc nặng một lúc: build Electron, test có Postgres nhúng, spike, `claude -p`, `pnpm -r test`. Mọi process nền ghi vào [processes.md](processes.md) (lệnh, PID, cổng, worktree) và tắt khi xong.
- **Không đụng sshd agent đang chạy (cổng 2222, `com.2p.crew-mac-sshd`)** cho tới CV-1. CV-1 có đường lui `crew-mac setup --sshd-owner launchd` và chỉ chạy khi 0 run active. Spike và test dùng cổng tạm `127.0.0.1:22999`, `22998`.
- **App v2 (Q5):** chỉ gỡ app v2 (`/Applications/2P Crew.app` bundle `com.2p-solutions.crew`, login item, `tccutil reset All com.2p-solutions.crew`). Không xóa, không sửa, không đổi tên file v2 nào trong `~/.crew` (`config.yaml`, `desktop.json`, `settings-cache.json`, `state.db`, `runtime/`, `assistant/`, `logs/daemon.log`). App mới chỉ ghi vào `~/.crew` những gì `crew-mac` vốn ghi (`bin/`, `app/`, `workflows/`, `status*.json`, `logs/status.log`).
- **Deploy VPS** (plugin/server Crew) đã được phép, chỉ qua `crew/ops/deploy.sh`: backup, mốc rollback, health ok, plugin `crew.core` healthy, `https://2p-solutions.com` và `https://kidyschool.com` trả 200. Hỏng thì `crew/ops/rollback.sh <TS>` ngay. Deploy khi 0 run active.
- **Push** repo Crew và fork chỉ khi owner nói "push". Tag phát hành fork dùng tiền tố `crew/` (bản này `crew/v3.1`). Tag app trong repo Crew: `mac-app/v<semver>`.
- **Repo `nquangphan/crew-mac-releases`:** tạo repo và đăng release là hành động công khai, chỉ làm ở UPD-4 sau khi owner nói "làm".
- **Vòng mỗi ticket:** implementer (agent mới, model của ticket) → reviewer (agent mới, cùng model, đọc diff + log test, đối chiếu Interface và Review Focus) → Trợ Lý ghi ledger và gộp. Reviewer trả `Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`.
- **Test theo tầng:** implementer chạy test phần đổi + typecheck package đó (+ `pnpm lint` file đổi). Reviewer đọc diff và log test, không chạy lại full suite. Full suite (`pnpm -r test`, `crew/release/verify.sh`), E2E và chạy thật trên Mac mini chỉ ở RV-1/AC.
- **Docs:** mỗi ticket đổi nguồn repo Crew sửa `docs/flows/<id>.md` của mọi flow chứa file đó (R3). File nguồn mới vào `docs/flows.yaml` (R2), rồi `node packages/docs-kit/dist/crew-docs.cjs generate`. Flow mới của app: `mac-app`, `mac-app-sshd`, `mac-app-paperclip`, `mac-app-update` (mục Interface I10). Không sửa mục `source`, `shared`, `unassigned` của `flows.yaml`, không sửa `AGENTS.md`/`CLAUDE.md` (R6). Trước push: `crew-docs check --range v3..HEAD`.
- UI và docs tiếng Việt; identifier, path, route, tên bảng, key tiếng Anh; giờ hiển thị `Asia/Ho_Chi_Minh`. Commit Conventional Commits, không nhắc AI, không ghi mã ticket/plan trong code, test, commit.
- Secret chỉ trong Keychain: board API key service `crew-mac-paperclip`, webhook secret service `crew-mac-status` (như hiện nay). Không dùng Electron `safeStorage`. `app.log` lọc mọi trường tên `token|secret|key|password|authorization` (port `redactFields` của v2).
- Mỗi agent tạo mới có `maxConcurrentRuns = 1`. Không tạo scheduler hay hàng đợi thứ hai: Paperclip là nguồn trạng thái duy nhất.

## Lệch so với spec (phát hiện khi lập plan, có nguồn)

1. **Route vai trò dùng `POST`, không `PUT`.** Plugin API route chỉ nhận `GET|POST|PATCH|DELETE` (`packages/shared/src/constants.ts` `PLUGIN_API_ROUTE_METHODS`). Route: `POST /api/plugins/crew.core/api/projects/:projectId/roles`.
2. **`ownerUserId` và `trackingProjectIds` vẫn theo company trong `CREW_POLICY_CONFIG`.** Bảng `crew_project_roles` chỉ giữ vai trò agent theo project. File company phải tồn tại để gate bật (như hôm nay).
3. **Spike ký bằng danh tính `Apple Development` sẵn có** (Team ID ổn định, designated requirement ổn định), vì Developer ID chưa có (E6). Hành vi responsible không phụ thuộc loại chứng chỉ. Cổng 2–3 của nghiệm thu đo lại trên bản Developer ID.
4. **`crew-mac setup` không cờ giữ `sshdOwner` hiện có** (cài mới thì `launchd`). Nếu mặc định luôn `launchd`, owner chạy `crew-mac setup` khi app đang giữ cổng sẽ tạo hai chủ cổng 2222. Chỉ `--sshd-owner launchd` mới chuyển về launchd.
5. **Check `tcc-owner` của `doctor` kiểm chuỗi cha** (listener có cha là process chính của `2P Crew.app`), vì Node không gọi được `responsibility_get_pid_responsible_for_pid` mà không có module native. SP-1 xác nhận chuỗi cha khớp responsible thật (E3).

## Review Focus

1. **Thoát, crash hay cập nhật app giữa run.** Run vẫn trả kết quả về Paperclip. Mở lại app thì có đúng một listener trên cổng 2222, không tăng cổng, không giết `sshd-session` nào. Test: AP-2 (`planListenerTakeover` chỉ TERM pid khớp pidfile và argv có `sshd_config` của crew-mac, không bao giờ chọn `sshd-session`), UPD-1 (drain không TERM phiên).
2. **Chuyển chủ cổng 2222 hỏng giữa chừng** (bootout xong nhưng app không sinh được listener, hoặc chạy `crew-mac setup --sshd-owner launchd` khi app đang giữ cổng). Máy phải tự về một chủ duy nhất, không để cổng trống quá 30 giây. Test: MC-2 (chờ listener của app thoát trước khi bootstrap plist; listener mồ côi thì TERM có kiểm argv), AP-5 (bước chuyển sshd tự trả về `launchd` nếu listener không lên trong 15 giây).
3. **Issue của project chưa có dòng vai trò, bảng plugin chưa migrate, hay vai trò trỏ agent đã xóa/khác company.** Gate dùng vai trò company trong file như cũ hoặc từ chối rõ ràng, không 500, không cho `done` sai. Project R1 (`repo-a`) không đổi hành vi. Test: PL-1.
4. **Bản cập nhật hỏng** (không sinh listener, `doctor --no-probe` có `fail` mới, bản tin status không gửi được). Trong 5 phút app tự quay về `previous/`, ghi `update-rolled-back`, và không tự cài lại đúng bản đó. Test: UPD-1 (`badVersions`).
5. **Cài app mới trên máy còn dữ liệu v2.** Không file v2 nào trong `~/.crew` bị xóa hay sửa; chỉ app v2, login item v2 và quyền TCC của bundle v2 bị gỡ. Test: AP-6 (ảnh chụp hash cây `~/.crew` giả trước và sau giống hệt).

---

## Gói ngữ cảnh

Luật chia: vẽ gói ngữ cảnh trước rồi cắt ticket trong gói. Mỗi ticket thuộc đúng một gói. Cùng gói thì làm lần lượt (mỗi ticket một agent mới nạp cùng gói ngữ cảnh, model theo ticket). Song song chỉ giữa gói khác nhau và file ghi rời nhau.

| Gói | Phạm vi ghi | Nạp chung (mọi ticket của gói) | Phần chi tiết |
|---|---|---|---|
| `mac-runtime` | Thư mục spike `~/crew-r21-spike/`; `apps/mac-app/src/main/sshd/**`, `src/main/quit-guard.ts`; thao tác trên Mac mini (CV-1) | Spec §2 (E1–E4), §5, §6; `apps/crew-mac/src/{paths.ts,sshd-config.ts,launchctl.ts}`; `apps/crew-mac/src/reaper/process-table.ts` (`listProcesses`, `ProcInfo`); v2 `my-crew/apps/desktop/src/main/quit-guard.ts` | [mac-runtime.md](mac-runtime.md) |
| `mac-cli` | `apps/crew-mac/**`, `docs/flows/{mac-setup,mac-orphan-reaper}.md`, mục flow crew-mac trong `docs/flows.yaml` | `apps/crew-mac/src/{cli.ts,context.ts,manifest.ts,paths.ts}`, `src/commands/{setup,doctor,uninstall,status}.ts`, `src/status/report.ts`; `docs/flows/mac-setup.md` | [mac-cli.md](mac-cli.md) |
| `app-shell` | `apps/mac-app/**` trừ `src/main/{sshd,paperclip,projects,update}/**`, `scripts/release.mjs`; `docs/flows/mac-app.md` | v2 `my-crew/apps/desktop/{electron-builder.yml,electron.vite.config.ts,package.json}`, `src/main/{index,window,tray,tray-view,login-item,app-log,notifications,full-disk-access,ipc-handlers}.ts`, `src/preload/index.ts`, `src/renderer/{app.tsx,routes/setup-wizard.tsx,components/**}`; Interface I1, I3, I5 | [app-shell.md](app-shell.md) |
| `paperclip-api` | `apps/mac-app/src/main/{paperclip,projects}/**`, `src/renderer/routes/projects.tsx`; `docs/flows/mac-app-paperclip.md`; gọi REST thật (SP-2) | Fork `server/src/routes/{access.ts,agents.ts,environments.ts,projects.ts}`; `crew/agents/{add-base.mjs,merge-agent-config.mjs,render-instructions.mjs,apply-roles.sh}`, `crew/agents/*.md`; Interface I6, I7 | [paperclip-api.md](paperclip-api.md) |
| `policy` | Fork `server/src/crew/**`, `server/src/__tests__/crew-project-roles*.test.ts` | Fork `server/src/crew/{issue-policy.ts,issue-gate.ts,issue-create-policy.ts,agent-config-gate.ts}`, `server/src/services/plugin-database.ts` (`derivePluginDatabaseNamespace`, chỉ đọc); Interface I7 | [fork.md](fork.md) |
| `plugin` | Fork `packages/crew-plugin/**` | Fork `packages/crew-plugin/src/{manifest.ts,worker.ts,features.ts,shared/db.ts,machines/**}`, `migrations/`; `packages/plugins/sdk/src/define-plugin.ts` (`onApiRequest`, `PluginApiRequestInput`); `packages/shared/src/types/plugin.ts` (`PluginApiRouteDeclaration`); Interface I7, I8 | [fork.md](fork.md) |
| `updater` | `apps/mac-app/src/main/update/**`, `apps/mac-app/scripts/release.mjs`, `src/renderer/routes/update.tsx`; `docs/flows/mac-app-update.md`; repo `nquangphan/crew-mac-releases` (UPD-4) | v2 `my-crew/apps/desktop/src/main/updater.ts`, `electron-builder.yml`, `signing/`; spec §9; Interface I3, I4, I9 | [updater.md](updater.md) |
| `ops` | VPS `/opt/crew-v3-spike` qua `crew/ops/*` | Fork `crew/ops/{deploy.sh,rollback.sh,active-runs.sh,plugin-state.sh,overlay-source.sh,overlay-job.sh}`; ledger R1-5 (bẫy `ssh … bash -s`) | [fork.md](fork.md) |

## Ticket

| ID | Việc | Gói | Nạp gì (thêm vào gói) | Phụ thuộc | Model | Worker / trạng thái |
|---|---|---|---|---|---|---|
| SP-1 | Spike S1–S4: app Electron tối thiểu ký `Apple Development`, mở từ Finder và từ login item, sinh sshd cổng `127.0.0.1:22999`; đo responsible, `claude auth status`/`claude -p` qua sshd đó, phiên sống qua TERM listener/thoát app/`kill -9` app, TCC hộp thoại tên app và đổi bản Claude không hỏi lại. Viết `spike-report.md`. **Cổng G0** | `mac-runtime` | spec §5, §12 bước 1, §14; `apps/crew-mac/src/sshd-config.ts` `renderSshdConfig`; `apps/crew-mac/src/commands/doctor.ts` `TCC_PREDICATE`; v2 `src/main/login-item.ts` | — | opus | chưa giao |
| SP-2 | Spike S5: board API key qua `cli-auth` (owner duyệt) tạo được environment SSH và agent `claude_local` trong company, đọc `requireBoardApprovalForNewAgents`; dọn bản ghi thử; ghi vào `spike-report.md` mục S5. **Cổng G5** | `paperclip-api` | `server/src/routes/access.ts` (`/cli-auth/challenges`); `server/src/routes/agents.ts`; `server/src/routes/environments.ts`; `crew/ops/active-runs.sh` | — | opus | chưa giao |
| MC-1 | `@crew/mac` thành thư viện: `src/index.ts`, `exports` + `.d.ts`, `createMacContext({ env, out, cliPath })` tách khỏi `cli.ts`; không đổi hành vi CLI | `mac-cli` | `apps/crew-mac/package.json`; `tsconfig.build.json`; `src/cli.ts` `defaultContext`; `src/reaper/select.ts` `isClaudePrint` | G0 | sonnet | chưa giao |
| MC-2 | `sshdOwner` trong manifest; `setup({ sshdOwner })` và `--sshd-owner app\|launchd` (bootout/bootstrap có chờ, không hai chủ cổng); `doctor` check `sshd-agent` theo chế độ + check `tcc-owner`; `uninstall` chế độ app; flow `mac-setup` | `mac-cli` | `src/commands/setup.ts` `sshdPlistSpec`, `ensureService`; `src/launchctl.ts`; `src/commands/doctor.ts` `checkSshdService`; `src/commands/uninstall.ts` | MC-1 | opus | chưa giao |
| MC-3 | Bản tin máy thêm trường tùy chọn `app` đọc từ `app.json` của app; `macPaths().appState`; flow `mac-setup` | `mac-cli` | `src/status/report.ts` `MachineReport`, `buildMachineReport`; `src/commands/status.ts` `sendStatus`; Interface I3, I8 | MC-2 | sonnet | chưa giao |
| MC-4 | `installCrewMacFrom(srcDir)`: cài bản `crew-mac` mang trong app vào `~/.crew/app/crew-mac` (giữ 1 bản sao lưu, đổi thư mục atomic, từ chối khi có run), viết lại launcher | `mac-cli` | `src/launcher.ts` `renderLauncher`, `parseLauncher`; `src/fs-util.ts`; `src/commands/uninstall.ts` `scanUninstallBlockers`; `plans/261006-1355-crew-v3-r1-1/handover.md` (cách cài hiện tại) | MC-3 | sonnet | chưa giao |
| AP-1 | Khung `apps/mac-app`: electron-vite (main ESM, preload, renderer React, utility), electron-builder (bundle id, Info.plist tiếng Việt, entitlements, arm64, mang `crew-mac` build), single instance, tray, cửa sổ, login item, `app-log`, `AppStateStore` (`app.json`), hợp đồng IPC đủ 6 màn hình, `utilityProcess` gọi `@crew/mac`; flow `mac-app` | `app-shell` | v2 `package.json`, `electron-builder.yml`, `electron.vite.config.ts`; v2 `src/main/{index,tray,login-item,app-log}.ts`; Interface I1, I3, I5 | G0, MC-1 | sonnet | chưa giao |
| AP-2 | Bộ giám sát sshd trong Main: spawn `sshd -D` detached, pidfile, backoff 1s→60s, tiếp quản/TERM listener cũ chỉ khi khớp argv, `pause/resume/stopForQuit`, `activeRuns()`; quit guard 3 lựa chọn; theo dõi `sshdOwner` trong manifest; flow `mac-app-sshd` | `mac-runtime` | `spike-report.md` (S1–S4); `apps/mac-app/src/main/index.ts`; `@crew/mac` `macPaths`, `readManifest`, `listProcesses`, `isClaudePrint`; Interface I4 | AP-1, MC-2 | opus | chưa giao |
| AP-4 | Paperclip client: `cli-auth` (tạo challenge, mở `approvalUrl`, poll, lưu board API key vào Keychain `crew-mac-paperclip`), REST có kiểu (companies, projects, agents, environments, runs cancel, instructions bundle, roles route), không log key; flow `mac-app-paperclip` | `paperclip-api` | `spike-report.md` mục S5; `packages/shared/src/validators/access.ts` `createCliAuthChallengeSchema`; `apps/crew-mac/src/commands/status.ts` `setStatusSecret` (mẫu dùng `security`); Interface I6 | AP-1, SP-2 | opus | chưa giao |
| AP-3 | Màn hình Sức khỏe (doctor `--no-probe` mỗi 15 phút, probe khi bấm, thông báo khi chuyển đỏ), Run đang chạy (`activeRuns`, link web, nút Hủy gọi REST), Log (đuôi 4 file, lọc run id, mở Finder); tray chấm màu + số run | `app-shell` | v2 `src/main/notifications.ts`, `src/renderer/components/health-check-row.tsx`, `src/renderer/routes/status.tsx`; Interface I4, I5, I6 | AP-2, AP-4 | sonnet | chưa giao |
| AP-5 | Wizard cài lần đầu (a)–(f): kiểm máy, đăng nhập Paperclip + chọn company, máy (nhận cài đặt có sẵn từ manifest và `~/.crew/status.json`), Quyền ổ đĩa (FDA), chuyển sshd sang app có tự lui, doctor; cài `crew-mac` mang theo khi rảnh | `app-shell` | v2 `src/main/full-disk-access.ts`, `src/renderer/routes/setup-wizard.tsx`, `src/renderer/components/{wizard-step,full-disk-access}.tsx`; `@crew/mac` `setup`, `configureStatus`, `installCrewMacFrom` | AP-3, MC-4 | sonnet | chưa giao |
| AP-6 | Bước "Gỡ app v2" và "Chuyển vào Applications" trong wizard: phát hiện app v2/login item, nhờ thoát, chuyển app v2 vào Thùng rác, gỡ login item v2, `tccutil reset All com.2p-solutions.crew`, rồi `app.moveToApplicationsFolder()`; không đụng file v2 trong `~/.crew` | `app-shell` | spec §11 + §16 Q5; v2 `src/main/login-item.ts` `fileLoginItem`; `src/main/setup/wizard.ts` (AP-5); `src/main/app-state.ts` `AppStateStore` | AP-5 | sonnet | chưa giao |
| PG-1 | Plugin: migration `0004_project_roles.sql` (`crew_project_roles`), capability `api.routes.register`, route `GET/POST/DELETE /projects/:projectId/roles` (board), kiểm agent thuộc company, test DB | `plugin` | `packages/crew-plugin/src/{manifest.ts,worker.ts,shared/db.ts}`; `migrations/0003_machine_latest.sql`; SDK `onApiRequest`; `server/src/routes/plugins.ts` `companyResolution` | G0 | opus | chưa giao |
| PG-2 | Plugin: `machine-status` nhận trường tùy chọn `app`; thẻ máy hiện phiên bản app, `sshdOwner`, `updateState` | `plugin` | `src/machines/webhook.ts` `parseMachineReport`; `src/machines/data.ts`; `src/ui/machines/**`; Interface I8 | PG-1 | sonnet | chưa giao |
| PL-1 | `server/src/crew/`: `loadCrewRoles({ db, companyId, projectId })` đọc `crew_project_roles` trước, fallback file; H2/H4 dùng vai trò theo project; test round-trip và fallback; hook vẫn 5/5 | `policy` | `server/src/crew/issue-policy.ts` `loadCrewCompanyConfig`, `CrewRoles`; `issue-gate.ts` l.301–311; `issue-create-policy.ts` `crewBeforeIssueCreate`; `plugin-database.ts` `derivePluginDatabaseNamespace`; Interface I7 | PG-1 | opus | chưa giao |
| DP-1 | Gộp `crew/r21-plugin` + `crew/r21-policy` vào `crew/r2-1`, `verify.sh` xanh, deploy bằng `deploy.sh`, tag `crew/v3.1`; kiểm route vai trò và bản tin có `app` | `ops` | `crew/ops/deploy.sh`; `crew/ops/rollback.sh`; `crew/release/verify.sh`; ledger R1-5 (bẫy stdin) | PL-1, PG-2 | opus | chưa giao |
| PJ-1 | Thêm/gỡ project (logic Main, idempotent, tiến độ trong `app.json`): `ls-remote`, clone mirror docs + `add-repo`, tạo project, checkout + environment + agent theo vai trò, `AGENTS.md` có `baseHash`, ghi vai trò; gỡ: pause agent, archive environment, `remove-repo`, xóa vai trò | `paperclip-api` | `crew/agents/{add-base.mjs,merge-agent-config.mjs,render-instructions.mjs}`; `crew/agents/{assistant,executor,reviewer,integrator}.md`; `@crew/mac` `forbiddenRootReason`, `addStatusRepo`, `removeStatusRepo`; Interface I6, I7 | AP-4, DP-1 | opus | chưa giao |
| PJ-2 | Màn hình Project: danh sách project (REST) ghép trạng thái Mac (checkout từng agent, repo ảnh chụp, commit gửi cuối), wizard "Thêm project" (chọn 1–2 executor), "Gỡ khỏi Mac" hiện lệnh xóa thư mục | `paperclip-api` | `apps/mac-app/src/shared/ipc-contract.ts`; `src/main/projects/**` (PJ-1); `@crew/mac` `listStatusRepos`; v2 `src/renderer/components/ui.tsx` | PJ-1, AP-3 | sonnet | chưa giao |
| UPD-2 | `scripts/release.mjs`: cây sạch, tag `mac-app/v<semver>` = HEAD, build, `electron-builder` với `CSC_NAME` tìm trong Keychain, `notarytool --keychain-profile crew-notary`, `stapler`, tự kiểm `codesign`/`spctl`/`stapler`/Team ID, `gh release create`; chế độ `--dry-run` (không ký thật, không đăng) có test | `updater` | v2 `electron-builder.yml`, `signing/`; spec §9 "Ký và notarize"; `apps/mac-app/electron-builder.yml` (AP-1) | AP-1 | opus | chưa giao |
| UPD-1 | Updater: `electron-updater` GitHub `nquangphan/crew-mac-releases`, kiểm lúc mở + mỗi 1 giờ + nút; kiểm phiên bản tăng + arm64; drain (pause listener, chờ hết run ≤ 30 phút, hỏi owner); `previous/`; probation 5 phút + tự quay lui + `badVersions`; qua probation thì cài `crew-mac` mang theo khi rảnh; "Quay về bản trước"; màn hình Cập nhật; flow `mac-app-update` | `updater` | v2 `src/main/updater.ts` (`Updater`, `UpdaterDeps`, `isDeveloperIdSigned`); Interface I3, I4, I9 | AP-2, UPD-2 | opus | chưa giao |
| CV-1 | Chuyển Mac mini sang app: 0 run active, build ký (Developer ID nếu đã có, không thì `Apple Development`), mở app từ thư mục tạm, wizard gỡ app v2 + chuyển vào `/Applications` + "Nhận cài đặt có sẵn", chuyển sshd sang app; kiểm listener/doctor/issue nhỏ; lỗi thì `crew-mac setup --sshd-owner launchd` | `mac-runtime` | `processes.md`; `crew/ops/active-runs.sh`; `apps/crew-mac/src/commands/doctor.ts`; `spike-report.md` | AP-5, AP-6, AP-3, MC-4, DP-1 | opus | chưa giao |
| UPD-3 | **Cổng ký (chờ owner).** Khi Keychain có `Developer ID Application` và profile `crew-notary`: `release.mjs --no-publish` ra zip/dmg ký + notarize thật; tự kiểm đạt; cài lại bản ký lên Mac mini (FDA cấp lại một lần nếu CV-1 dùng `Apple Development`) | `updater` | `scripts/release.mjs`; `security find-identity -v -p codesigning`; spec §13 cổng 1 | UPD-1, UPD-2, owner tạo chứng chỉ | opus | **chặn: chờ owner** |
| UPD-4 | **Cần owner nói "làm".** Tạo repo public `nquangphan/crew-mac-releases`; đăng bản N `v0.1.0` (cổng 2), rồi `v0.1.1`, `v0.1.2` (hỏng probation, từ nhánh bỏ đi) và `v0.1.3` theo cổng 5 | `updater` | `scripts/release.mjs`; `gh repo create`, `gh release create`; Interface I9 | UPD-3, owner nói "làm" | opus | **chặn: chờ owner** |
| RV-1 | Review toàn nhánh repo Crew `r2-1` + fork `crew/r2-1` theo Review Focus, Global Constraints và Interface; full suite `pnpm -r test`, `pnpm -r typecheck`, `pnpm lint`, `verify.sh` | — (Trợ Lý giao) | plan này; spec; `git diff v3..r2-1`; `git -C .worktrees/paperclip-v3 diff v3..crew/r2-1` | mọi ticket code | opus | chưa giao |
| AC-R2-1 | Nghiệm thu 8 cổng trên Mac mini + Paperclip thật | — (Trợ Lý) | mục Nghiệm thu; `sdd-ledger.md`; `spike-report.md`; `processes.md`; `crew/ops/active-runs.sh` | RV-1, CV-1, DP-1, UPD-4, AP-6 | opus | chưa giao |

Không ticket nào ghi file của gói khác. Các điểm nối chung (`src/main/index.ts`, `src/renderer/app.tsx`) chỉ thêm đúng một dòng đăng ký mỗi ticket (mục "Sở hữu file").

### Đợt chạy

| Đợt | Ticket | Ghi chú |
|---|---|---|
| 0 | SP-1 ∥ SP-2 | SP-2 chỉ gọi REST, không nặng trên Mac. Hết đợt: **cổng G0** (S1–S4) và **G5** (S5). G0 hỏng thì dừng toàn plan, báo owner kèm số liệu, đề xuất so sánh lại phương án `SMAppService.agent` |
| 1 | MC-1 → MC-2 → MC-3 → MC-4 (mac-cli) ∥ AP-1 (sau MC-1) ∥ PG-1 → PL-1 ∥ PG-2 | Một việc nặng một lúc: build Electron của AP-1 không chạy cùng test Postgres nhúng của PG-1/PL-1/PG-2 |
| 2 | AP-2 ∥ AP-4 ∥ UPD-2 ∥ DP-1 | DP-1 chỉ deploy khi 0 run active |
| 3 | AP-3 → AP-5 → AP-6 ∥ UPD-1 ∥ PJ-1 → PJ-2 | PJ-1 cần G5 đạt |
| 4 | CV-1, UPD-3 (khi có chứng chỉ), RV-1 | CV-1 là lần đầu đụng sshd cổng 2222, cần DP-1 đã deploy (bản tin có trường `app`) |
| 5 | UPD-4 (khi owner nói "làm"), AC-R2-1 | |

### Nhánh và worktree

- Repo Crew: nhánh tích hợp `r2-1` từ `v3`. Worktree theo gói: `.worktrees/crew-r21-cli` (`r21/mac-cli`), `.worktrees/crew-r21-app` (`r21/app-shell`), `.worktrees/crew-r21-runtime` (`r21/mac-runtime`), `.worktrees/crew-r21-api` (`r21/paperclip-api`), `.worktrees/crew-r21-update` (`r21/updater`). Mỗi nhánh gói rẽ từ `r2-1` sau khi các phụ thuộc đã gộp vào `r2-1`.
- Fork: nhánh tích hợp `crew/r2-1` từ `v3`. Worktree `.worktrees/paperclip-r21-plugin` (`crew/r21-plugin`), `.worktrees/paperclip-r21-policy` (`crew/r21-policy`, rẽ sau khi PG-1 gộp).
- Spike SP-1: thư mục ngoài repo `~/crew-r21-spike/` (không dưới `/Volumes`, `~/Desktop`, `~/Downloads`, `~/Documents`), xóa ở cuối SP-1 sau khi lưu số liệu vào `spike-report.md`.
- Trợ Lý gộp nhánh gói vào nhánh tích hợp. Xung đột trong `docs/flows.yaml` (mỗi gói một khối flow riêng) và `docs/files.md` (sinh tự động) thì giải bằng hợp danh sách rồi chạy lại `crew-docs generate`.

### Sở hữu file

| Ticket | Ghi |
|---|---|
| MC-1 | `apps/crew-mac/{package.json,tsconfig.build.json}`, `src/index.ts`, `src/context-factory.ts`, sửa `src/cli.ts` (chỉ dùng `createMacContext`), test `test/index.test.ts` |
| MC-2 | `src/manifest.ts`, `src/commands/{setup,doctor,uninstall}.ts`, `src/sshd-owner.ts` (mới), sửa `src/cli.ts` (cờ `--sshd-owner`), test `test/{setup,doctor,uninstall,sshd-owner}.test.ts`, `docs/flows/mac-setup.md`, khối `mac-setup` trong `flows.yaml` |
| MC-3 | `src/paths.ts` (thêm `appState`), `src/status/report.ts`, `src/status/app-state.ts` (mới), test `test/status.test.ts`, `test/status-app.test.ts`, `docs/flows/mac-setup.md` |
| MC-4 | `src/install-cli.ts` (mới), test `test/install-cli.test.ts`, `docs/flows/mac-setup.md`, khối `mac-setup` |
| AP-1 | Toàn bộ khung `apps/mac-app/**` (`package.json`, `electron.vite.config.ts`, `electron-builder.yml`, `build/{entitlements.mac.plist,icon.png}`, `src/main/{index,window,tray,login-item,app-log,app-state,ops-bridge,ipc}.ts`, `src/utility/ops.ts`, `src/preload/index.ts`, `src/shared/ipc-contract.ts`, `src/renderer/{index.html,main.tsx,app.tsx,styles.css,lib/ipc.ts,components/ui.tsx}`), `pnpm-lock.yaml`, `docs/flows/mac-app.md`, khối `mac-app` |
| AP-2 | `src/main/sshd/{supervisor,takeover,backoff,active-runs}.ts`, `src/main/quit-guard.ts`, test tương ứng; 1 dòng `src/main/index.ts`; `docs/flows/mac-app-sshd.md`, khối `mac-app-sshd` |
| AP-3 | `src/main/{health,runs,logs,notifications}.ts`, `src/renderer/routes/{health,runs,logs}.tsx`, `src/renderer/components/check-row.tsx`, sửa `src/main/tray.ts`; 1 dòng mỗi màn hình trong `app.tsx`; `docs/flows/mac-app.md` |
| AP-5 | `src/main/setup/{wizard,machine-check,import-existing,disk-access,sshd-handoff}.ts`, `src/renderer/routes/setup.tsx`, `src/renderer/components/wizard-step.tsx`; `docs/flows/mac-app.md` |
| AP-6 | `src/main/setup/v2-removal.ts`, test; 1 bước trong `src/renderer/routes/setup.tsx`; `docs/flows/mac-app.md` |
| AP-4 | `src/main/paperclip/{client,cli-auth,keychain,types}.ts`, test; `docs/flows/mac-app-paperclip.md`, khối `mac-app-paperclip` |
| PJ-1 | `src/main/projects/{add-project,remove-project,instructions,progress}.ts`, `src/main/projects/templates/*.md` (chép từ fork `crew/agents/*.md`), test; `docs/flows/mac-app-paperclip.md` |
| PJ-2 | `src/renderer/routes/projects.tsx`, `src/main/projects/ipc.ts`; 1 dòng `app.tsx`; `docs/flows/mac-app-paperclip.md` |
| UPD-1 | `src/main/update/{updater,drain,probation,rollback,versions}.ts`, `src/main/update/rollback-helper.sh`, `src/renderer/routes/update.tsx`, test; 1 dòng `index.ts`, 1 dòng `app.tsx`; `docs/flows/mac-app-update.md`, khối `mac-app-update` |
| UPD-2 | `apps/mac-app/scripts/{release.mjs,release-lib.mjs,release-lib.test.mjs}`; mục `publish` trong `electron-builder.yml` (UPD-1 thêm một dòng `extraResources` cho `rollback-helper.sh`); `docs/flows/mac-app-update.md` |
| PG-1 | Fork `packages/crew-plugin/migrations/0004_project_roles.sql`, `src/roles/{api.ts,data.ts}`, `src/__tests__/roles.db.test.ts`, mục `apiRoutes` + capability trong `src/manifest.ts`, 1 dòng `src/worker.ts` (`onApiRequest`) |
| PG-2 | Fork `src/machines/{webhook.ts,data.ts}`, `src/ui/machines/**`, `src/__tests__/{webhook,machines}.test.ts` |
| PL-1 | Fork `server/src/crew/{project-roles.ts (mới),issue-policy.ts,issue-gate.ts,issue-create-policy.ts}`, `server/src/__tests__/crew-project-roles.test.ts`, `crew-project-roles.db.test.ts` |

## Interface giữa các gói

**I1. Thư viện `@crew/mac`** (MC-1 tạo; AP-1, AP-2, AP-3, AP-5, PJ-1 dùng).
- `apps/crew-mac/package.json`: `"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`; `tsconfig.build.json` thêm `"declaration": true`. `bin` giữ nguyên.
- `createMacContext(input: { env: NodeJS.ProcessEnv; out: (line: string) => void; cliPath: string; nodePath?: string }): MacContext` trong `src/context-factory.ts`. CLI truyền `realpathSync(fileURLToPath(import.meta.url))`. App luôn truyền `~/.crew/app/crew-mac/dist/cli.js` (đường dẫn cài, không phải đường dẫn trong bundle), để plist reaper/status không trỏ vào bundle sẽ bị thay khi cập nhật.
- `src/index.ts` export đúng: `setup`, `SetupOptions`, `SetupReport`, `doctor`, `DoctorOptions`, `CheckResult`, `CheckStatus`, `uninstall`, `scanUninstallBlockers`, `configureStatus`, `setStatusSecret`, `addStatusRepo`, `removeStatusRepo`, `listStatusRepos`, `readStatusConfig`, `sendStatus`, `StatusConfig`, `StatusRepo`, `WorkflowReport`, `stopRun`, `listProcesses`, `readCwds`, `ProcInfo`, `isClaudePrint`, `readManifest`, `Manifest`, `SshdOwner`, `macPaths`, `MacPaths`, `forbiddenRootReason`, `SSHD_LABEL`, `DEFAULT_PORT`, `MacContext`, `SetupError`, `createMacContext`, `workflowCheck`, `installCrewMacFrom` (MC-4 thêm dòng export cùng file của nó), `readAppState` (MC-3).

**I2. `sshdOwner`** (MC-2 tạo; AP-2, AP-5, CV-1 dùng).
- `export type SshdOwner = 'launchd' | 'app'`. `Manifest` thêm `sshdOwner?: SshdOwner` (không có = `launchd`; `version` vẫn 1, manifest cũ vẫn đọc được).
- `SetupOptions` thêm `sshdOwner?: SshdOwner` và `force?: boolean`. Không truyền `sshdOwner` thì giữ giá trị manifest (cài mới: `launchd`). Đổi chủ khi còn run đang chạy thì `SetupError`, trừ `force: true`; kiểm `SSH_CONNECTION` (lệnh chạy qua chính sshd agent) nằm ở `cli.ts`.
- `setup({ sshdOwner: 'app' })`: ghi `sshd_config`, host key, authorized_keys như cũ; **không** ghi plist sshd; `launchctl bootout gui/<uid>/com.2p.crew-mac-sshd` nếu đang nạp, xóa file plist; ghi manifest `sshdOwner: 'app'`. Không tự sinh sshd. `SetupReport` thêm `sshdHandoff: 'app' | 'launchd' | 'unchanged'`.
- `setup({ sshdOwner: 'launchd' })` khi manifest đang `app`: ghi manifest `launchd` trước (app thấy và tự dừng listener), chờ tối đa 15 giây cho pid trong `~/.crew-mac/sshd/sshd.pid` biến mất; còn sống và argv có `-f <sshdConfig>` thì TERM (listener mồ côi của app đã crash); rồi ghi plist và bootstrap như cũ.
- `doctor`: `sshdOwner === 'app'` thì check `sshd-agent` kiểm pidfile còn sống, argv có `-f <sshdConfig>`, và cha là process có đường dẫn trong `2P Crew.app/Contents/MacOS/`; app không chạy thì `fail`, gợi ý "Mở 2P Crew". Check mới `tcc-owner`: `ok` "sshd là con của 2P Crew, quyền macOS gắn với app" / `warn` "chế độ LaunchAgent, quyền gắn theo bản Claude".

**I3. Trạng thái app `app.json`** (AP-1 tạo `AppStateStore`; AP-2, AP-5, PJ-1, UPD-1 ghi qua store; MC-3 đọc).
- File `~/Library/Application Support/2P Crew/app.json`, mode 600, ghi atomic, chỉ Main process ghi (`AppStateStore.update(fn)` nối tiếp).
- Kiểu:

```ts
export type UpdateState = 'idle' | 'downloading' | 'waiting-idle' | 'installing' | 'probation' | 'rolled-back';
export interface AppState {
  version: 1;
  appVersion: string;
  sshdOwner: 'app' | 'launchd';
  sshdPid: number | null;
  updateState: UpdateState;
  update: { from: string | null; to: string | null; installedAt: string | null; badVersions: string[]; baseline: string[] };
  setup: { step: 'check' | 'v2' | 'move' | 'paperclip' | 'machine' | 'disk-access' | 'sshd' | 'doctor' | 'done'; paperclipOrigin: string | null; companyId: string | null };
  projects: Record<string, ProjectProgress>;
}
export interface ProjectProgress {
  key: string; origin: string; projectId: string | null;
  done: Array<'ls-remote' | 'mirror' | 'project' | 'status-repo' | `role:${string}` | 'roles' | 'check'>;
  agents: Record<string, { agentId: string | null; environmentId: string | null; checkout: string }>;
  error: string | null;
}
```

- `crew-mac` (MC-3) chỉ đọc `appVersion`, `sshdOwner`, `updateState`; file thiếu hay hỏng thì bản tin không có trường `app`.

**I4. Bộ giám sát sshd** (AP-2 tạo trong `src/main/sshd/supervisor.ts`; AP-3, AP-5, UPD-1 dùng).

```ts
export type SupervisorState = 'starting' | 'running' | 'backoff' | 'paused' | 'stopped' | 'disabled';
export interface SshdSupervisor {
  start(): Promise<void>;          // tiếp quản: listener cũ khớp argv thì TERM rồi sinh mới, cùng cổng
  pause(): Promise<void>;          // TERM listener của mình, không tự sinh lại; phiên đang mở vẫn sống
  resume(): Promise<void>;
  stopForQuit(): Promise<void>;    // như pause, dùng khi thoát/cập nhật
  status(): { state: SupervisorState; pid: number | null; restarts: number; lastError: string | null };
  activeRuns(): Promise<ActiveRun[]>;
  onChange(listener: () => void): () => void;
}
export interface ActiveRun { pid: number; runId: string; worktree: string | null; startedAt: number; children: number }
```

- `activeRuns()` = `listProcesses()` lọc `runId !== null && isClaudePrint(command)`; `worktree` từ `readCwds`. Không phụ thuộc listener còn sống (phiên SSH sau khi listener chết được launchd nhận nuôi).
- Manifest `sshdOwner !== 'app'` thì supervisor ở `disabled`, không sinh listener (chế độ CLI).

**I5. Hợp đồng IPC** (AP-1 viết đủ trong `src/shared/ipc-contract.ts`; mỗi ticket cài handler của kênh mình).
- `health:run(probe: boolean) → CheckResult[]`, `health:last() → { at: string; results: CheckResult[] } | null` (AP-3).
- `runs:list() → ActiveRun[]`, `runs:cancel(runId: string) → { ok: boolean; message: string }` (AP-3).
- `logs:tail(file: 'app' | 'sshd' | 'reaper' | 'status', lines: number, runId?: string) → string[]`, `logs:reveal(file)` (AP-3).
- `setup:state() → AppState['setup']`, `setup:step(step, input) → StepResult` (AP-5, AP-6).
- `paperclip:login(origin) → { approvalUrl: string }`, `paperclip:loginStatus() → 'pending' | 'approved' | 'expired' | 'cancelled'`, `paperclip:companies() → { id: string; name: string }[]` (AP-4).
- `projects:list() → ProjectRow[]`, `projects:add(input: AddProjectInput) → ProjectProgress`, `projects:remove(projectId) → { removed: string[]; manualCommand: string }` (PJ-1/PJ-2).
- `update:state() → UpdateView`, `update:check()`, `update:installWhenIdle()`, `update:rollback()` (UPD-1).
- Sự kiện Main → renderer: `state:changed` (không payload; renderer gọi lại kênh đọc).

**I6. Paperclip client** (AP-4 tạo trong `src/main/paperclip/client.ts`; AP-3, AP-5, PJ-1 dùng).

```ts
export interface PaperclipClient {
  origin: string;
  me(): Promise<{ userId: string }>;
  companies(): Promise<{ id: string; name: string; requireBoardApprovalForNewAgents: boolean }[]>;
  projects(companyId: string): Promise<{ id: string; name: string; key: string | null }[]>;
  createProject(companyId: string, input: { name: string; description?: string }): Promise<{ id: string }>;
  createEnvironment(companyId: string, input: SshEnvironmentInput): Promise<{ id: string }>;
  archiveEnvironment(environmentId: string): Promise<void>;
  createAgent(companyId: string, input: ClaudeLocalAgentInput): Promise<{ id: string }>;
  patchAgent(agentId: string, patch: Record<string, unknown>): Promise<void>;
  getInstructionsFile(agentId: string, path: 'AGENTS.md'): Promise<{ content: string; hash: string } | null>;
  putInstructionsFile(agentId: string, path: 'AGENTS.md', content: string, baseHash: string | null): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  runWebUrl(runId: string): Promise<string>;   // link mở run trên web, dạng lấy từ SP-2
  getRoles(companyId: string, projectId: string): Promise<ProjectRoles | null>;
  setRoles(companyId: string, projectId: string, roles: ProjectRoles): Promise<void>;
  deleteRoles(companyId: string, projectId: string): Promise<void>;
}
```

- Đường dẫn REST, body đúng và quy tắc `baseHash` lấy từ kết quả SP-2 (ghi trong `spike-report.md` mục S5); AP-4 không đoán.
- Key chỉ đọc từ Keychain lúc gọi (`security find-generic-password -s crew-mac-paperclip -a <origin> -w`), không giữ trong biến toàn cục quá một lời gọi, không ghi log. Lỗi 401 thì trạng thái "Cần đăng nhập lại".

**I7. Vai trò theo project** (PG-1 tạo bảng và route; PL-1 đọc trên server; AP-4/PJ-1 gọi route).
- DDL (`packages/crew-plugin/migrations/0004_project_roles.sql`):

```sql
CREATE TABLE plugin_crew_core_0433ea20b6.crew_project_roles (
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  assistant_agent_id uuid NOT NULL,
  executor_agent_ids uuid[] NOT NULL,
  reviewer_agent_id uuid NOT NULL,
  integrator_agent_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id text NOT NULL,
  PRIMARY KEY (company_id, project_id),
  CHECK (reviewer_agent_id <> integrator_agent_id),
  CHECK (cardinality(executor_agent_ids) BETWEEN 1 AND 2)
);
```

  Namespace viết đúng như `0002_machines.sql` (= `derivePluginDatabaseNamespace("crew.core")`; PL-1 có test khẳng định giá trị này).
- Route (manifest `apiRoutes`, `auth: "board"`, capability `api.routes.register`):
  - `GET /projects/:projectId/roles?companyId=<uuid>` (`companyResolution: { from: "query", key: "companyId" }`) → `200 { roles: ProjectRoles | null }`.
  - `POST /projects/:projectId/roles` body `{ companyId, assistantAgentId, executorAgentIds, reviewerAgentId, integratorAgentId }` (`companyResolution: { from: "body", key: "companyId" }`) → `200 { roles }`; `400` khi agent không thuộc company, project không thuộc company, reviewer = integrator, executor ngoài 1–2, id lặp giữa vai trò.
  - `DELETE /projects/:projectId/roles?companyId=<uuid>` → `200 { deleted: boolean }`.
  - `ProjectRoles = { assistantAgentId: string; executorAgentIds: string[]; reviewerAgentId: string; integratorAgentId: string }`.
- Server (PL-1): `loadCrewRoles(input: { db: Db; companyId: string; projectId: string | null }): Promise<CrewCompanyConfig>`. Có dòng cho `(companyId, projectId)` thì trả config company với `roles` thay bằng `{ reviewerAgentId, integratorAgentId }` của dòng; không có dòng, `projectId` null, bảng chưa có (`42P01`) hay lỗi đọc thì trả config company như `loadCrewCompanyConfig` hôm nay (lỗi đọc ghi log một lần mỗi phút). Config `absent` (không có file) thì vẫn `absent`: gate tắt như hôm nay.

**I8. Trường `app` của bản tin máy** (MC-3 gửi; PG-2 nhận). Tùy chọn, `version` bản tin vẫn 1:

```json
"app": { "version": "0.1.0", "sshdOwner": "app", "updateState": "idle" }
```

`version` là semver ≤ 32 ký tự, `sshdOwner ∈ {app, launchd}`, `updateState` thuộc `UpdateState`. Plugin từ chối (502, delivery `failed`) khi trường có mà sai dạng; bản tin không có `app` vẫn hợp lệ. **PG-2 phải deploy (DP-1) trước khi Mac gửi `app`** (CV-1 sau DP-1), nếu không bản tin bị 502.

**I9. Kênh phát hành** (UPD-2 tạo; UPD-1 đọc).
- Repo `nquangphan/crew-mac-releases`, release tag `v<semver>` (tag trong repo phát hành), tag nguồn trong repo Crew `mac-app/v<semver>`.
- Tên file: `2P-Crew-<version>-arm64-mac.zip`, `2P-Crew-<version>-arm64.dmg`, `latest-mac.yml`, `*.blockmap`. `electron-builder.yml` `publish: { provider: github, owner: nquangphan, repo: crew-mac-releases, releaseType: release }`, `artifactName: "2P-Crew-${version}-${arch}${/*-mac*/}.${ext}"` theo đúng khuôn v2.
- Không `allowDowngrade`, không `allowPrerelease`.

**I10. Flow docs của app** (mỗi gói sở hữu một khối trong `docs/flows.yaml` và một file `docs/flows/<id>.md`):
- `mac-app` (AP-1, AP-3, AP-5, AP-6): khung, tray, cửa sổ, log, sức khỏe, run, cài đặt, gỡ v2.
- `mac-app-sshd` (AP-2): giám sát sshd, quit guard.
- `mac-app-paperclip` (AP-4, PJ-1, PJ-2): đăng nhập, REST, thêm/gỡ project.
- `mac-app-update` (UPD-1, UPD-2): updater, phát hành.

## Nghiệm thu (AC-R2-1)

Mọi cổng làm trên Mac mini thật với Paperclip `v2026.1005.0` image của DP-1, bằng chứng (lệnh, đầu ra rút gọn, giờ) ghi vào [sdd-ledger.md](sdd-ledger.md). Cổng 1, 2, 3, 5 cần UPD-3/UPD-4 (chứng chỉ của owner, owner nói "làm").

- [ ] **Cổng 1 — Build/ký/notarize.**
  - `node apps/mac-app/scripts/release.mjs` (tag `mac-app/v0.1.0`) thoát 0 và ra zip + dmg.
  - `codesign --verify --deep --strict --verbose=2 "2P Crew.app"` thoát 0.
  - `spctl -a -vv "2P Crew.app"` có dòng `source=Notarized Developer ID`.
  - `xcrun stapler validate` trên app và dmg: `The validate action worked!`.
  - `codesign -d -r- "2P Crew.app"` có `certificate leaf[subject.OU] = "<Team ID>"`.
  - Release trên `nquangphan/crew-mac-releases` có zip, dmg, blockmap và `latest-mac.yml`. `git grep` và log release không có secret (`crew-docs check --range` R7 sạch).
- [ ] **Cổng 2 — Cài trên Mac mini.**
  - Mở dmg tải từ Releases: không cảnh báo Gatekeeper nào ngoài "tải từ Internet".
  - Wizard "Nhận cài đặt có sẵn" không sinh key mới: fingerprint host key `~/.crew-mac/sshd/host_ed25519` không đổi, environment Paperclip không phải quét lại host key.
  - `launchctl print gui/501/com.2p.crew-mac-sshd` thoát khác 0 (không còn job).
  - `lsof -nP -iTCP:2222 -sTCP:LISTEN` ra đúng một pid; `ps -o ppid= -p <pid>` là pid process chính của `2P Crew.app`.
  - `crew-mac doctor` 0 `fail`, có check `tcc-owner` `ok`.
  - Thẻ máy trên web "Trực tuyến", hiện phiên bản app và `sshdOwner app`.
- [ ] **Cổng 3 — TCC.**
  - Cấp Full Disk Access một lần cho "2P Crew". Ghi bản Claude trước/sau khi đổi bản (`claude --version`).
  - Đổi bản Claude Code, chạy một issue thật tới `done`.
  - `/usr/bin/log show --start "<mốc>" --predicate 'process == "tccd"'` trong khung đó: 0 dòng `AUTHREQ_PROMPTING` có subject là đường dẫn `claude/versions/…` hay bundle `com.2p-solutions.crew.mac`.
  - Các dòng `AUTHREQ_ATTRIBUTION` của `claude` có responsible `com.2p-solutions.crew.mac`.
- [ ] **Cổng 4 — Đóng UI không dừng job.**
  - Đóng cửa sổ giữa run: run tới `done`.
  - Thoát app giữa run, chọn "Thoát ngay, run vẫn chạy": run vẫn trả kết quả về Paperclip (run `succeeded`, issue chuyển stage).
  - Mở lại app: listener mới trên 2222, `pgrep -f "sshd.*crew-mac/sshd/sshd_config" | wc -l` = 1 (không tính `sshd-session`), không có cổng khác.
  - `kill -9` process chính của app giữa run: run vẫn xong; mở lại app thì listener mồ côi bị thay, vẫn chỉ một listener.
- [ ] **Cổng 5 — Updater.** Bốn bản: N = `0.1.0` (đã cài ở cổng 2), N+1 = `0.1.1`, N+2 = `0.1.2` cố ý hỏng, N+3 = `0.1.3`.
  - Đăng N+1. App N tự thấy trong 1 giờ hoặc khi bấm "Kiểm ngay"; đang có run thì trạng thái "chờ rảnh" và không cài.
  - Run xong: app cài, mở lại, thẻ máy hiện N+1, `app.log` có `update-installed`.
  - Bấm "Quay về bản trước": về N, mở lại được, đúng một listener; `badVersions` chứa N+1 và app không tự cài lại N+1.
  - Đăng N+2, build từ nhánh bỏ đi `mac-app/break-probation` có đúng một commit làm `supervisor.start()` ném lỗi (nhánh không gộp, xóa sau cổng). App N cài N+2, trong 5 phút tự về N; `app.log` có `update-probation-failed` và `update-rolled-back`; `badVersions` chứa N+2; app không cài lại N+2.
  - Đăng N+3: app N cài, qua probation, thẻ máy hiện N+3. Đây là bản ở lại trên máy.
- [ ] **Cổng 6 — Thêm project.**
  - Từ app thêm một repo thật owner chọn (1 executor). Project, 4 agent (`maxConcurrentRuns = 1`), 4 environment `in_place` có trên web; `GET …/projects/<id>/roles` trả đúng 4 id.
  - Ảnh chụp docs của repo hiện trên trang Crew trong 2 phút.
  - Tạo một issue thật trong project đó trên web: đi Trợ Lý → executor → reviewer → integrator → owner duyệt → `done`. Commit nằm trên origin của repo đó; `git -C ~/crew-agents/mac-claude log origin/HEAD` của `repo-a` không có commit mới.
  - Chạy lại kịch bản gate R1-2 rút gọn trên project mới: agent tự `PATCH status=done` khi chưa đủ stage nhận 422; một issue `repo-a` vẫn đi đủ stage với vai trò company cũ.
  - "Gỡ khỏi Mac": agent `paused`, environment archived, repo bỏ khỏi `status-repos.json`, dòng vai trò bị xóa; thư mục checkout vẫn còn và app hiện lệnh xóa.
- [ ] **Cổng 7 — CLI độc lập.**
  - Khi 0 run active: thoát app, `crew-mac setup --sshd-owner launchd` → `launchctl print gui/501/com.2p.crew-mac-sshd` có `state = running`, `crew-mac doctor` 0 `fail` (check `tcc-owner` `warn`), một lệnh `ssh` của doctor vào được.
  - Mở app, wizard bước (e) chuyển lại sang app; listener đúng một.
  - `pnpm -r test`, `pnpm -r typecheck`, `pnpm lint` của repo Crew đạt; `crew/release/verify.sh` của fork đạt, hook 5/5.
- [ ] **Cổng 8 — Gỡ v2.**
  - Không còn `/Applications/2P Crew.app` có bundle id `com.2p-solutions.crew` (`mdfind "kMDItemCFBundleIdentifier == 'com.2p-solutions.crew'"` rỗng ngoài Thùng rác).
  - Không còn login item v2 (`sfltool dumpbtm | grep -c com.2p-solutions.crew` chỉ khớp bundle `.mac`).
  - `tccutil reset All com.2p-solutions.crew` đã chạy (dòng trong `app.log`).
  - Mọi file v2 trong `~/.crew` giữ nguyên: `shasum` của `config.yaml`, `desktop.json`, `settings-cache.json`, `state.db`, `logs/daemon.log` và danh sách file `runtime/`, `assistant/` trước và sau giống hệt (lưu ở ledger).
- [ ] **Dọn.** Cancel issue thử, 0 run active, không còn process nền trong `processes.md` ở trạng thái "đang chạy", `~/crew-r21-spike/` đã xóa. Push chỉ khi owner nói "push".

## Self-review

Trợ Lý tự review 09/10/2026 sau khi viết đủ plan và các phần chi tiết.

- **Phủ spec:**
  - §1.1 app ký + TCC → SP-1, AP-1, AP-2, UPD-2, UPD-3.
  - §1.2 đóng UI không dừng job → AP-2.
  - §1.3 màn hình → AP-3 (sức khỏe, run, log), AP-5 (cài đặt), PJ-2 (project), UPD-1 (cập nhật).
  - §1.4 thêm project → PJ-1, PJ-2, PG-1, PL-1, DP-1.
  - §1.5 updater → UPD-1, UPD-2, UPD-4.
  - §1.6 CLI độc lập → MC-1, MC-2.
  - §4 kiến trúc (bundle id, utilityProcess, login item, `app.json`, Keychain) → AP-1, AP-4.
  - §5 TCC (FDA, Info.plist, `tcc-owner`) → AP-1, AP-5, MC-2.
  - §6 vòng đời → AP-2.
  - §7 quan hệ CLI → MC-1…MC-4.
  - §8 màn hình → AP-3, AP-5, PJ-2, UPD-1.
  - §9 updater/phát hành/báo phiên bản lên web → UPD-1…UPD-4, MC-3, PG-2.
  - §10 thêm/gỡ project → SP-2, PJ-1, PJ-2, PG-1, PL-1.
  - §11 + §16 Q5 gỡ v2 → AP-6.
  - §12 thứ tự (spike đầu, cổng) → Đợt 0–5.
  - §13 nghiệm thu → AC-R2-1 cổng 1–8.
  - §16 Q1–Q4 → PG-1/PL-1, UPD-4, UPD-2/UPD-3, AP-5.
- **Mỗi ticket một gói:** cột "Gói" của bảng có đúng một giá trị; bảng "Sở hữu file" không có file nào ghi bởi hai gói, trừ các dòng đăng ký một dòng trong `src/main/index.ts`/`src/renderer/app.tsx` (Trợ Lý gộp) và `docs/flows/mac-setup.md` (chỉ gói `mac-cli`).
- **Placeholder:** quét `TBD`, `TODO`, `implement later`, `similar to task` trên plan và 6 file chi tiết: không có.
- **Nhất quán interface:** tên `SshdOwner`, `createMacContext`, `AppState`, `UpdateState`, `SshdSupervisor.activeRuns`, `ProjectRoles`, `loadCrewRoles`, route `POST /projects/:projectId/roles`, file `app.json`, repo `crew-mac-releases`, tag `mac-app/v<semver>` đối chiếu giữa plan, `mac-cli.md`, `mac-runtime.md`, `app-shell.md`, `paperclip-api.md`, `fork.md`, `updater.md`.
- **Review Focus:** 1 → AP-2, UPD-1; 2 → MC-2, AP-5; 3 → PL-1; 4 → UPD-1; 5 → AP-6.

**Còn chờ owner:**
1. Tạo `Developer ID Application` (team 2P SOLUTIONS `J7Y2DL6HZV`?) và `xcrun notarytool store-credentials crew-notary` → mở UPD-3.
2. Nói "làm" để tạo repo `nquangphan/crew-mac-releases` và đăng release → UPD-4.
3. Một lần đăng xuất/đăng nhập màn hình Mac mini trong SP-1 (đo login item), hẹn giờ không có run.
4. Cho phép sửa `AGENTS.md` repo Crew (R6) để ghi `apps/mac-app` và lệnh build app; nếu cho, commit kèm trailer `Crew-Owner-Approved: <ticket>`.
5. Chọn repo thật cho cổng 6.
