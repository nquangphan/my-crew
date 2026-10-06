# Crew v3 R1-1 — Nền và kết nối Mac — Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biến những gì spike stock-first đã chứng minh thành nền dùng được: fork Paperclip có hook và vá đúng khuôn, Mac cài bằng một lệnh, agent không bị bỏ mồ côi khi mất mạng/restart/hủy, Mac quá tải thì run chờ, và VPS backup/restore được.

**Architecture:** Paperclip stock trên VPS là lõi duy nhất. Mac là SSH environment qua Tailscale; agent `claude_local` chạy `in_place` trong git worktree riêng, dùng đăng nhập Claude sẵn có trong Keychain qua một sshd chạy trong phiên desktop. Lõi chỉ đổi bằng hook một dòng có registry (H1, H2, H3) và một số vá adapter/driver theo dõi riêng. Phần riêng của Crew: plugin Paperclip, CLI `crew-mac` trên Mac, script nâng upstream.

**Tech Stack:** Paperclip `v2026.1001.0` (Node ≥ 24.11, pnpm 9.15.4 qua Corepack), plugin SDK `packages/plugins/sdk` 1.0.0, Docker Compose trên VPS Ubuntu 24.04, Tailscale, OpenSSH, launchd (LaunchAgent), Claude Code CLI 2.1.x, TypeScript cho `apps/crew-mac` trong repo Crew.

**Spec:** [Thiết kế v3](../../docs/superpowers/specs/2026-10-05-crew-v3-paperclip-design.md), [kế hoạch stock-first](../261006-0805-crew-v3-stock-first/plan.md) (Phần 2, mục R1-1), [báo cáo spike](../261006-0805-crew-v3-stock-first/spike-report.md) và [các quyết định đã chốt](../261006-0805-crew-v3-stock-first/can-dai-ca-chot.md). Báo cáo spike và quyết định đã chốt được ưu tiên khi khác spec.

## Global Constraints

- Không sửa file lõi Paperclip, trừ hook một dòng ở đầu hàm. Mỗi hook có mục trong `crew/release/core-hooks.json` và có test kiểm hook còn tồn tại. Import của hook đặt ở cuối file.
- Ngân sách tối đa 5 chỉ đếm hook một dòng có registry (owner chốt 06/10/2026). Hiện có H1 `claimQueuedRun`, H2 `runUpdate`, H3 `releaseRunLease` của SSH driver. Vá adapter/driver (claude_local in_place, metadata in_place của SSH driver, `sessionCodec`, dòng log resume) ghi riêng trong `core-hooks.json` với loại `adapter-patch`/`driver-patch` và có PR upstream tương ứng.
- Không tạo scheduler, queue hay bảng ticket thứ hai. Paperclip là nguồn trạng thái duy nhất cho issue/run/session.
- Credential AI chỉ nằm trên Mac. Không token đăng nhập Claude, không bắt login lại: agent dùng đăng nhập Keychain sẵn có (owner chốt 06/10/2026). VPS chỉ giữ auth Paperclip, SSH key vào Mac và secret DB.
- Agent chạy `claude` với `--setting-sources project,local`; được nạp `~/.claude/CLAUDE.md` cá nhân (owner chốt).
- Repo agent làm việc là git worktree riêng; `.paperclip-runtime/` phải nằm trong `info/exclude` của repo. Không đặt repo dưới `/Volumes`, `~/Desktop`, `~/Downloads`; tạm tránh `~/Documents` cho tới khi kiểm. Thư mục worktree mặc định `~/crew-agents`.
- sshd của agent chạy trong phiên desktop: sau khi Mac khởi động lại, agent chỉ chạy được khi owner đã đăng nhập màn hình.
- UI/docs tiếng Việt, identifier/path tiếng Anh, giờ hiển thị Asia/Ho_Chi_Minh.
- Backup DB trước mọi migration hoặc thay đổi dữ liệu. Không dùng cổng 5432. DB dev của repo Crew giữ ở `127.0.0.1:55432`.
- VPS `nhamoiplatform` đang chạy prod (crew v1, kidy, 2ps-landing): chỉ đụng compose project `crew-v3-spike` và `/opt/crew-v3-spike`; build trên VPS dừng khi RAM available < 2 GB; không build full image trên VPS (dùng overlay trên image upstream).
- Không deploy production, không push fork khi chưa có approval của owner.
- Mỗi process nền ghi lệnh/PID/cổng vào `processes.md` của plan này và dừng khi xong task.

## Review Focus

1. Mạng giữa VPS và Mac rớt khi agent đang chạy: khi mạng về, không có process `claude` của run cũ nào còn ghi vào worktree, và issue không bị chuyển `done` bởi run đã bị đánh fail. (Ticket RT-1, MS-2)
2. Restart server Paperclip khi run đang chạy: run mới không chạy song song với process cũ trên cùng worktree. (RT-1)
3. Hủy run: process trên Mac dừng trong 30 giây và issue không kẹt `in_progress`. (RT-1)
4. Claude Code tự cập nhật bản mới trên Mac: `crew-mac doctor` phát hiện hộp thoại quyền macOS đang chờ và chỉ đúng chỗ bấm, thay vì agent treo im lặng. (MS-1)
5. Mac quá tải hoặc không vào được quá lâu: run không chờ vô hạn mà chuyển trạng thái rõ ràng sau thời hạn, kèm lý do đọc được trên UI. (RT-2)

---

## Gói ngữ cảnh và ticket

Luật chia: vẽ gói ngữ cảnh trước, rồi cắt ticket trong gói. Cùng gói thì một worker làm lần lượt. Song song chỉ giữa các gói khác nhau và file ghi rời nhau.

| Gói | Nạp gì | Worker đề xuất | Model |
|---|---|---|---|
| `release` | Fork Paperclip: cấu trúc registry hook, `crew/release/`, `packages/crew-plugin/`, test vá adapter; kết quả `spike-upgrade.md` | Worker gói `upgrade` của spike (đã làm S6) | opus |
| `runtime` | Fork: SSH driver (`environment-runtime.ts`), `claimQueuedRun`, `crew-load-gate.ts`, server spike trên VPS; kết quả S3, S5 | Worker `moi-truong-2` của spike (đã làm S5) | opus |
| `mac-setup` | Mac mini: sshd phiên desktop, TCC, Keychain, LaunchAgent, Claude Code CLI; repo Crew `apps/` | Debugger gói `claude-mac` của spike (đã làm D1, D2) | opus |

| ID | Việc | Gói | Phụ thuộc | Phần chi tiết |
|---|---|---|---|---|
| RL-1 | Nhánh `v3` của fork: registry hook `server/src/crew/core-hooks.ts` (H1–H3 no-op), `core-hooks.json` + `check-core-hooks.mjs`, plugin rỗng, port vá P1–P4 từ nhánh spike (P1 metadata in_place SSH driver qua `server/src/crew/ssh-in-place.ts`, P2 claude_local in_place, P3 `sessionCodec`, P4 dòng log resume), test Crew ở file riêng | `release` | — | [release.md](release.md) |
| RL-2 | `crew/release/upgrade.sh` (fetch, nhánh `sync/paperclip-<nhãn>`, merge) gọi `crew/release/verify.sh` (kiểm mốc, build trước, test vá, tsc), chạy thử trên `upstream/master` | `release` | RL-1 | [release.md](release.md) |
| RT-1 | H3 thật: SSH driver dừng process group của run khi trả lease (cancel, restart, mất lease); chạy lại các kịch bản S3 | `runtime` | RL-1 | [runtime.md](runtime.md) |
| RT-2 | H1 thật: cổng tải theo máy có cache kết quả đo, ghi lý do chờ, thời hạn chờ rồi chuyển trạng thái rõ | `runtime` | RL-1 | [runtime.md](runtime.md) |
| RT-3 | Backup/restore DB và thư mục dữ liệu Paperclip trên VPS; restore ra instance mới đọc đúng issue/run cũ | `runtime` | — | [runtime.md](runtime.md) |
| RT-4 | Deploy nhánh `v3` mới lên VPS dạng overlay (gồm `server/src/crew/`), cài plugin `packages/crew-plugin/` lên server thật và kiểm plugin load | `runtime` | RL-1, RT-1, RT-2, MS-1 | [runtime.md](runtime.md) |
| MS-1 | CLI `apps/crew-mac` (repo Crew): `setup`, `doctor`, `uninstall` (idempotent): sshd phiên desktop, key Paperclip, PATH, thư mục worktree, kiểm Claude login, thử `claude -p` có tự SIGKILL, phát hiện hộp thoại TCC; flow docs `mac-setup` | `mac-setup` | — | [mac-setup.md](mac-setup.md) |
| MS-2 | `crew-mac reap` qua LaunchAgent mỗi 60 giây, dọn process mồ côi khớp cách H3 dừng process group; flow docs `mac-orphan-reaper` | `mac-setup` | RT-1 (interface) | [mac-setup.md](mac-setup.md) |
| AC-1 | Nghiệm thu R1-1: gỡ cài đặt spike trên Mac mini, cài lại bằng `crew-mac setup`, chạy issue thử; restore ra instance mới; chạy lại S3 đạt | Trợ Lý | tất cả | Mục "Nghiệm thu" bên dưới |

Song song được: `release`, `mac-setup` và RT-3 ngay từ đầu (file rời nhau: fork nhánh `v3`, repo Crew `apps/crew-mac`, `/opt/crew-v3-spike` trên VPS). RT-1/RT-2 chờ RL-1. RT-4 chờ RT-1, RT-2. Server spike chỉ restart khi không có run đang chạy.

## Interface giữa các gói

- **Registry hook** (RL-1 tạo, RT-1/RT-2 điền): `server/src/crew/core-hooks.ts` export `crewCoreHooks`, mặc định no-op: `beforeClaim({ db, run }): Promise<boolean>` (`true` = giữ `queued`); `beforeIssueWrite({ tx, issueId, existing, patch, actorAgentId, actorUserId }): Promise<void>` (chặn bằng `HttpError`); `onRunLeaseReleased(input: EnvironmentDriverReleaseInput & { db: Db }): Promise<void>` (registry nuốt lỗi, ghi log; cần `db` để giải key SSH trong secret). Plugin không đăng ký hook được vì chạy process riêng, nên implementation thật nằm trong `server/src/crew/`.
- **H2 logic thật** (chặn `done` khi chưa đủ stage, chặn agent sửa/xóa `executionPolicy`) thuộc R1-2, gói `policy`; R1-1 chỉ cài điểm cắm no-op.
- **PR upstream cho P1–P4** cần owner duyệt push trước khi mở.
- **Nhận diện process của run trên Mac** (RT-1 chốt, MS-2 dùng): RT-1 export `PAPERCLIP_RUN_ID` trước khi exec `claude` và ghi process group id vào `<worktree>/.paperclip-runtime/runs/<runId>/pgid`; mỗi lệnh SSH đã tự có process group riêng (macOS không có `setsid`). H3 dừng group đó qua SSH. MS-2 dọn `claude` chạy `--print`/`-p` có `PAPERCLIP_RUN_ID` khi chuỗi tiến trình cha không còn `sshd`/`sshd-session` quá 2 phút (không dùng tiêu chí PPID 1, vì cha trực tiếp thường vẫn sống khi phiên SSH chết); TERM, chờ 10 giây, rồi KILL.
- **Wrapper `crew-claude-run`** (MS-1 sở hữu, RT-1 dùng): nguồn `apps/crew-mac/assets/crew-claude-run.sh` (repo Crew), cài vào `~/.crew/bin/crew-claude-run`; agent `claude_local` đặt `adapterConfig.command` tới đường dẫn đó. Khi có `PAPERCLIP_RUN_ID`, wrapper ghi `pgid` và `started` vào `$PWD/.paperclip-runtime/runs/<runId>/` rồi `exec claude`. Test macOS của RT-1 dùng fixture giữ đúng hợp đồng này.
- **Cửa sổ mồ côi khi mất mạng:** sshd agent `ClientAliveInterval 15`, `ClientAliveCountMax 2` (phiên chết sau khoảng 30 giây), MS-2 chờ thêm 60 giây; process của run cũ biến mất trong tối đa 3 phút sau khi mất mạng (thường khoảng 90 giây; tệ nhất khoảng 2 phút 40 giây: 30 giây sshd, 60 giây ân hạn, tối đa 60 giây chu kỳ LaunchAgent, 10 giây chờ TERM). Mạng chập chờn dưới 30 giây không làm chết run.
- **Cổng sshd agent** (MS-1 chốt, RT-* dùng): `crew-mac setup` cài sshd phiên desktop trên một cổng cố định (mặc định 2222) chỉ nghe trên IP Tailscale; environment Paperclip trỏ cổng đó.

## Nghiệm thu (AC-1)

- [ ] Trên Mac mini, chạy trong Terminal trên màn hình Mac (không qua SSH tới sshd agent): `crew-mac uninstall` gỡ phần spike (LaunchAgent `com.2p.crew-spike-sshd`, `~/.crew-spike-sshd`, dòng PATH spike trong `~/.zshenv`, key `crew-v3-spike-paperclip`), rồi `crew-mac setup` cài lại; quét lại host key cho environment Paperclip vì sshd mới có host key mới; `crew-mac doctor` toàn đạt.
- [ ] Một issue thử trên server đã deploy RT-4 chạy `in_place`, commit trong worktree agent, checkout của owner nguyên.
- [ ] Ba kịch bản S3: restart server và hủy run thì process của run cũ trên Mac dừng trong 30 giây; mất mạng 60 giây thì process cũ biến mất trong tối đa 3 phút sau khi mất mạng (thường khoảng 90 giây; tệ nhất khoảng 2 phút 40 giây: 30 giây sshd, 60 giây ân hạn, tối đa 60 giây chu kỳ LaunchAgent, 10 giây chờ TERM). Không commit trùng; sau hủy issue chuyển `blocked`, không kẹt `in_progress`.
- [ ] Restore bản backup ra một compose project mới trên VPS: đọc đúng issue/run của bản cũ, rồi gỡ instance thử.
- [ ] `crew/release/upgrade.sh` chạy trên `upstream/master`: mốc hook đủ, test vá xanh.

## Self-review

Trợ Lý tự review 06/10/2026 sau khi ba gói viết xong phần chi tiết:

- **Phủ spec:** R1-1 trong plan stock-first yêu cầu fork pin + script nâng + test hook (RL-1, RL-2), `crew-mac doctor/setup` (MS-1), kiểm tải theo máy (RT-2), backup/restore VPS (RT-3); điều kiện go từ spike là H3 + dọn mồ côi + chạy lại S3 (RT-1, MS-2, AC-1). H2 logic thật thuộc R1-2.
- **Placeholder:** quét `TBD`, `TODO`, `implement later`, `similar to task` trên cả bốn file: không có.
- **Nhất quán interface:** chữ ký registry (`beforeClaim`, `beforeIssueWrite`, `onRunLeaseReleased` có `db`), tên vá P1–P4, đường dẫn wrapper, hợp đồng `pgid`/`started`/`PAPERCLIP_RUN_ID`, thông số `ClientAlive` và grace 60 giây đã đối chiếu giữa `release.md`, `runtime.md`, `mac-setup.md`.
- **Review Focus:** mỗi dòng có ticket sở hữu test: 1 → RT-1 + MS-2; 2, 3 → RT-1; 4 → MS-1 (`doctor` phát hiện TCC); 5 → RT-2.

Còn chờ owner: duyệt push fork để mở PR upstream cho P1–P4; chọn nơi đặt bản sao backup ngoài VPS.
