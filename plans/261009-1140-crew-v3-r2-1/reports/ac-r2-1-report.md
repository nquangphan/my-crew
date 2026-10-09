# AC-R2-1 — Báo cáo nghiệm thu app macOS (phần làm được khi owner vắng)

Ngày 09/10/2026, 17:50–18:17, giờ Asia/Ho_Chi_Minh theo `date` của Mac mini (VPS khớp). Người chạy: agent Claude (opus),
giao từ Trợ Lý. Máy: Mac mini, app `/Applications/2P Crew.app` bản PJ-3 `6861ca5` (0.1.0, ký Apple Development),
`crew-mac` bản FX-9 `ed6b8f5`, Claude Code `2.1.295`. Prod Paperclip `v3-2bbda3cb2`.

## Kết luận

**Mọi phần chạy được khi owner vắng đều ĐẠT, kể cả `kill -9` app giữa run.** Còn 1 tiêu chí chỉ đạt sau một bản
sửa: ảnh chụp docs lúc thêm project không lên trong 2 phút. Khi đó cần FX-7. Sau FX-7, ảnh chụp lên 29 giây sau push.

Cổng 1, 2, 5 và phần UI của cổng 4, 7 vẫn **CHỜ OWNER**: cần Developer ID, cần đăng release, hoặc cần owner bấm.

Chạy đúng **một** yêu cầu thật, **TPS-76**. Gốc chuyển `done` lúc 18:15:23. `origin/main` của 2ps-landing đổi
`546c746` → `f0555c6`.

Hai phát hiện mới, không do app, đều cần ticket (chi tiết ở mục Phát hiện):

- **P1.** Khi gate trả 422 cho lệnh `done` của agent, run của chính agent đó vẫn bị hủy ("Cancelled before issue
  reassignment"). Agent không kịp sửa. Paperclip chạy lại đúng lỗi đó 2 lần rồi chuyển issue sang `blocked`.
- **P2.** Integrator viết dòng bằng chứng `crew-docs-check … exit=0` dính liền khối ``` ở cùng dòng. Regex của gate
  (neo `$`) không đọc được, nên gate báo `docs_missing`. Em phải dùng board khôi phục stage một lần, kèm comment hướng
  dẫn. Sau đó luồng đi tiếp bình thường.

## Bảng cổng

| Cổng | Tiêu chí | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 Build/ký/notarize | `release.mjs` tag `mac-app/v0.1.0`, `codesign`, `spctl` Notarized, `stapler`, OU, release + R7 sạch | **CHỜ OWNER** | Cần chứng chỉ Developer ID Application và `xcrun notarytool store-credentials crew-notary` (UPD-3). Bản Apple Development đã đạt `codesign --verify --deep --strict` lúc build CV-1 (ledger). |
| 2 Cài trên Mac mini | Mở dmg từ Releases, wizard nhận cài đặt có sẵn, `launchctl` không còn job, `lsof` đúng 1 pid là con app, `doctor` 0 fail + `tcc-owner` ok, thẻ máy | **CHỜ OWNER** (phần dmg/Gatekeeper) | Chưa có dmg trên Releases (UPD-4). Các phần sau đã thấy trên bản đang chạy, chỉ để tham khảo: 18:16 `launchctl print gui/501/com.2p.crew-mac-sshd` rc=113 (không còn job); `lsof -iTCP:2222 LISTEN` = 89725, PPID 89519 = app; `crew-mac doctor --no-probe` 0 fail, "Quyền macOS của run gắn với … com.2p-solutions.crew.mac" ĐẠT. |
| 3 TCC | FDA một lần; `claude --version` trước/sau đổi bản | **CHỜ** đổi bản Claude | Hiện tại `2.1.295`. Claude chưa tự cập nhật, nên phần "đổi bản rồi chạy một issue tới `done`" phải chờ. |
| 3 | 0 `AUTHREQ_PROMPTING` có subject `claude/versions/…` hoặc `com.2p-solutions.crew.mac` | ĐẠT (với bản hiện tại) | `log show --start "2026-10-09 16:24:00" --predicate 'process == "tccd"'` lúc 17:58: 1894 dòng AUTHREQ, **0** dòng `AUTHREQ_PROMPTING` (của bất kỳ subject nào). Từ 17:57 (khung TPS-76) cũng 0. |
| 3 | `AUTHREQ_ATTRIBUTION` của `claude` có responsible `com.2p-solutions.crew.mac` | ĐẠT | Từ 16:24 có 4 dòng: 16:24:07, 17:21:54 (×2), 17:21:55. Trong khung TPS-76 có 13 dòng `accessing=com.anthropic.claude-code …/versions/2.1.295`, `responsible=com.2p-solutions.crew.mac`, lúc 18:00:04–18:00:06, ngay sau khi mở lại app. Dòng `claude` có responsible khác chỉ là phiên điều phối của em (Orca). |
| 4 Đóng UI | Đóng cửa sổ giữa run → `done` | **CHỜ OWNER** | Cần bấm UI. |
| 4 | Thoát giữa run, chọn "Thoát ngay, run vẫn chạy" → run `succeeded`, issue chuyển stage | **CHỜ OWNER** | Cần bấm hộp thoại. |
| 4 | Mở lại app: listener mới, `pgrep` = 1, không cổng khác | ĐẠT (đo sau `kill -9`, không đo sau Thoát) | Xem dòng `kill -9` bên dưới. |
| 4 | **`kill -9` app giữa run: run vẫn xong; mở lại thì listener mồ côi bị thay, chỉ một listener** | **ĐẠT** | 17:57:35 thấy `claude --model claude-opus-5` PID 78908 (run assistant `3d4bbb37`) theo chuỗi 78908 ← `sshd-session @notty` 78896 ← `[priv]` 78881 ← listener **44751** ← app **44681**. 17:57:40 `kill -9 44681` (pid lấy bằng `pgrep -f "^/Applications/2P Crew.app/Contents/MacOS/2P Crew$"`). Không kill sshd, sshd-session hay claude. 17:57:43: app không còn; 44751 có PPID 1 và vẫn giữ 2222; claude 78908 sống. 17:59: `doctor --no-probe` báo CẢNH BÁO "listener mồ côi" và `tcc-owner` CẢNH BÁO (đúng thiết kế MC-2). Run `3d4bbb37` `succeeded` 18:00:17. **Luồng đi tiếp qua listener mồ côi:** con TPS-77 tạo xong, executor `3cfd5ab1` start 17:59:38, `claude` 88015 ← 88014 ← 87990 ← 44751. 17:59:56 `open "/Applications/2P Crew.app"` khi còn **2 run đang chạy** (assistant và executor): app 89519, `app.log` `sshd-takeover pid 44751` 17:59:56.944, `sshd-spawned pid 89725` 17:59:57.201, state `running restarts 0`. 18:00:03: 44751 đã thoát; chỉ còn listener 89725, PPID 89519; `lsof` 2222 một pid; `pgrep -f "sshd.*crew-mac/sshd/sshd_config"` trừ `sshd-session` = 1; `lsof` LISTEN của sshd = 1 cổng. Hai `claude` 78908 và 88015 vẫn sống (`[priv]` chuyển sang PPID 1). Không run nào bị cắt: assistant `succeeded`, executor kết thúc `cancelled issue_reassigned` lúc 18:00:51 (bình thường khi chuyển sang reviewer, có commit `baab85a`), reviewer con `0a8c5646` `succeeded`. Không cần đường lui `setup --sshd-owner launchd`. |
| 5 Updater | N, N+1, N+2 hỏng, N+3 | **CHỜ OWNER** | Cần Developer ID (bản Apple Development tự tắt updater) và đăng 4 bản trên `crew-mac-releases` (UPD-3/UPD-4). |
| 6 Thêm project | Project, 4 agent `maxConcurrentRuns=1`, 4 environment `in_place`; `GET …/roles` đúng 4 id | **ĐẠT** | 17:52 board `GET /plugins/crew.core/api/projects/a5ed1f8a…/roles?companyId=5befeb1a…` trả assistant `f1bdbd53…`, executor `[41b3c7cc…]`, reviewer `265ecb67…`, integrator `041466d8…`, trùng 4 agent `p-2ps-landing-*` (`idle`, `maxConcurrentRuns 1`, `engine cli`). 4 environment `active`, `ssh`, `in_place`, `remoteWorkspacePath ~/crew-agents/p-2ps-landing/<vai>`, cổng 2222. Không có environment archived nào của project. |
| 6 | Ảnh chụp docs hiện trên trang Crew trong 2 phút | **ĐẠT sau FX-7**; lúc thêm project KHÔNG ĐẠT | Lúc thêm project (17:08) ảnh chụp không gửi được. Lỗi R1 của `flows.yaml` mẫu, đã sửa ở FX-7. Ảnh đầu tiên lên lúc 17:38:47, sau khi cài FX-7. Lần này: push `f0555c6` lúc 18:15:16 → `docs_current` = `f0555c61` `verified`, 7 trang, lúc **18:15:45 (29 giây)**. `status-repos.json` `lastCommit` = `f0555c61…`. Trang Crew đọc qua `POST /plugins/crew.core/data/crew.docs.projects` thấy `2ps-landing`; `crew.docs.tree` trả 7 trang (architecture, deployment-guide, files, 3 flow, index). Em không chụp màn hình trình duyệt. |
| 6 | Issue thật Trợ Lý → executor → reviewer → integrator → owner duyệt → `done`; commit trên origin; `repo-a` không có commit mới | ĐẠT | AC-6 lần 2 (TPS-72, `546c746`) và lần này (TPS-76 / con TPS-77, `f0555c6`). Folder owner `705b149` không đổi: hash `status --porcelain --ignored` `bdcee4cf…` và shasum file tracked `8eaab35a…` trùng trước và sau. Em không kiểm `git log origin/HEAD` của `repo-a` ở lượt này. Các run TPS-76 chỉ chạy ở worktree `p-2ps-landing/*`. |
| 6 | Gate R1-2 rút gọn trên project mới: agent tự `PATCH` khi chưa đủ stage → 422 | **ĐẠT** | Issue thử TPS-74 `0c2bdaa4…`, board tạo 17:54:49, không assignee. Policy tạo ra có 4 stage theo **vai trò project** (reviewer `265ecb67…`, integrator `041466d8…`, approval owner, integrator), không theo vai trò file. Key tạm của executor `p-2ps-landing-executor-1`: token chỉ nằm trong file 0600 của `mktemp -d` trên VPS, không in ra. Không có `X-Paperclip-Run-Id` thì mọi lệnh 403 (luật cross-issue stock). Dùng run id cũ của chính executor (`a74c7f3c…`), lúc 17:56:01–03: `status=cancelled` → 422 `crew_gate_blocked` `agent_cancel_forbidden`; `executionPolicy=null` → 422 `crew_policy_locked`; `assignee=integrator` → 422 `crew_role_assignee`; `assignee=reviewer` → 422 `crew_role_assignee`. TPS-74 không đổi (`backlog`, không assignee, 4 stage). **`status=done` khi chưa đủ stage:** em làm trên gốc TPS-76 lúc 18:12:46, khi stage owner duyệt đang chờ (mới xong 2/4) → **422** "Only the active reviewer or approver can advance the current execution stage", trạng thái không đổi. Em không `done` trên TPS-74: issue chưa có stage nào thì Paperclip mở workflow (200 → `in_review`, giao reviewer, đánh thức). Như vậy là một run Claude thứ hai (đọc `issue-execution-policy.ts`, nhánh `shouldStartWorkflow`; khớp AC-2 R1-2: "PATCH done lần 1 → 200 in_review"). Đã thu hồi cả 3 key `ac-r21-gate` (sau mỗi lần thu hồi, `agents/me` → 401; DB 3/3 `revoked_at`). |
| 6 | Issue `repo-a` vẫn theo vai trò company cũ | ĐẠT (phần policy) | TPS-75 `2cca2345…`, board tạo trong `Spike Mac` lúc 17:56:19, không assignee → stage reviewer `946f1a73…`, integrator `b7cd2d89…` (vai trò file `crew-policy.json`), hủy 17:56:20. Em không chạy đủ stage vì giới hạn quota (DP-1 TPS-70 cũng chỉ kiểm policy). |
| 6 | "Gỡ khỏi Mac" | **CHỜ OWNER** | Để owner quyết (brief cấm làm). |
| 7 CLI độc lập | 0 run: thoát app, `setup --sshd-owner launchd`, `doctor`, `ssh` của doctor; mở app, wizard chuyển lại | **CHỜ OWNER** | Cần bấm Thoát và bấm wizard. Không phải dùng đường lui vì listener lên ngay. |
| 7 | `pnpm -r test`, `pnpm -r typecheck`, `pnpm lint` | **ĐẠT** | Worktree `crew-r21-cli`, HEAD = `r2-1` = `ed6b8f5`, 17:51–17:52: `pnpm -r test` rc 0. Chi tiết: crew-mac 26 file / 391 test, docs-kit 3 / 43, mac-app 38 / 398 cộng node `--test` 24/24. `pnpm -r typecheck` rc 0. `pnpm lint` (biome) 235 file sạch. `crew-docs check --range v3..r2-1` → `ok (30 commits)`. |
| 7 | `crew/release/verify.sh` của fork đạt, hook 5/5 | ĐẠT (dẫn chiếu) | DP-2 lúc 14:09:49→14:12:15 trên `2bbda3cb2` (bản đang ở prod) thoát 0 "XANH", hook 5/5, lỗi 0 (ledger). Fork không đổi từ đó. |
| 8 Gỡ v2 | `mdfind` bundle `com.2p-solutions.crew` rỗng ngoài Thùng rác | ĐẠT | 17:57 `mdfind "kMDItemCFBundleIdentifier == 'com.2p-solutions.crew'"` → rỗng. Bundle `.mac` → `/Applications/2P Crew.app`. Shell không có FDA nên không liệt kê được `~/.Trash`. |
| 8 | Không còn login item v2 (`sfltool dumpbtm`) | **CHỜ OWNER** | `sfltool` cần admin. Login item SMAppService của v2 không gỡ được bằng CLI (ledger 16:20). Owner xem trong Cài đặt → Mục đăng nhập. |
| 8 | `tccutil reset All com.2p-solutions.crew` đã chạy, có dòng trong `app.log` | ĐẠT một phần | Trợ Lý chạy tay khoảng 16:20 (ledger ghi "20:20", lệch +4h) → OK. **Không có dòng trong `app.log`**, vì không chạy qua bước v2 của wizard (`grep tcc` = 0). |
| 8 | File v2 trong `~/.crew` giữ nguyên (shasum trước/sau) | ĐẠT một phần: **không có baseline trước khi gỡ** | 17:58: `config.yaml` `0ee8b39e…` (30/09 15:53), `desktop.json` `a157d380…` (29/09), `settings-cache.json` `1f6adda8…` (30/09 16:41), `state.db` `0dd2c5ac…` (09/10 16:19), `logs/daemon.log` `bd3f2ef7…` (16:19), `logs/app.log` v2 `57bf889b…` (16:19). `runtime/` 66 file, sha danh sách `475d88931bac`, mới nhất 01/10 22:07. `assistant/` 0 file. File đổi sau 16:20 chỉ là file trạng thái của crew-mac v3 (`status*.json`, `status-repos.json`, `logs/status.log`), không có file v2 nào. Lần ghi cuối của v2 là 16:19, lúc app v2 thoát, trước khi gỡ. Đây là bằng chứng gián tiếp, không phải so trước/sau. |
| Dọn | Cancel issue thử, 0 run, không process nền, thu hồi key | ĐẠT | TPS-74 `cancelled` 18:16:46, TPS-75 `cancelled`. 3/3 key thu hồi. `active-runs.sh` rỗng; `heartbeat_runs` queued/running = 0. Watcher của em đã thoát, không còn `/tmp/acr21-*` trên VPS. Orphan `crew-claude-run`/`paperclip-bridge`/`claude --print` = 0. Còn `~/crew-r21-spike/`: plan giữ cho S1b/S2b/S4 chờ owner, em không xóa. |

## Dòng thời gian TPS-76 (giờ ICT)

Backup trước khi tạo bản ghi: `20261009-1754` (trước TPS-74/75) và `20261009-1757` (trước TPS-76). Lúc 17:54 và 17:57
không có run nào đang chạy.

| Giờ | Sự kiện |
|---|---|
| 17:57:29 | Board tạo **TPS-76** `f1deabff…`: thêm 1 dòng ghi chú cuối `docs/deployment-guide.md`, giao `p-2ps-landing-assistant`. |
| 17:57:30 | Run assistant `3d4bbb37` chạy. |
| 17:57:40 | **`kill -9` app 44681** khi `claude` 78908 đang chạy. Listener 44751 thành mồ côi. |
| 17:59:16 / 17:59:38 | `crew-plan`; con TPS-77 → executor `3cfd5ab1` chạy qua listener mồ côi. |
| 17:59:56 | Mở lại app (89519). Tiếp quản 44751 → listener mới 89725. |
| 18:00:17 | Assistant `succeeded`. |
| 18:00:51–18:01:22 | Executor xong (commit `baab85a`), reviewer con `succeeded`, TPS-77 `done`. |
| 18:02:11 | `crew-assistant done`. 18:03:08: reviewer gốc `verdict=approved`. |
| 18:03–18:10 | Integrator merge `f0555c6`, chạy docs check exit 0, nhưng `done` bị 422 `docs_missing` 3 lần (18:05:10, 18:07:30, 18:10:12). Mỗi lần run bị hủy "Cancelled before issue reassignment". 18:10:19 recovery chuyển gốc sang `blocked` (P1, P2). |
| 18:11:41 | Board `PATCH {status: in_review, assigneeAgentId: integrator}` kèm comment chỉ đúng dạng bằng chứng. |
| 18:12:28 / 18:12:36 | Integrator đăng bằng chứng đúng một dòng, rồi `done` → stage owner duyệt. |
| 18:12:46 | Thử gate: executor `done` → 422. |
| 18:12:52 | Board duyệt thay owner. |
| 18:15:16 / 18:15:23 | `crew-merge sha=f0555c61… pushed=yes`; gốc `done`, 4/4 stage. |
| 18:15:45 | Ảnh chụp docs `f0555c61` `verified` trên server. |
| 18:16 | `doctor --no-probe` 0 fail (sshd con của app 89519, `tcc-owner` ok, hộp thoại TCC 0); 0 orphan; worktree sạch. |

Quota Claude: 1 yêu cầu thật, 10 run Claude: 2 opus (assistant) và 8 sonnet. Trong 8 run sonnet có 3 run integrator
bị hủy oan vì P1. Ngoài ra có 1 run `setup_failed`, không tốn quota. Em không chạy `doctor` có probe.

## Phát hiện

- **P1 — Lệnh `done` bị gate từ chối vẫn hủy run của chính agent.** Bằng chứng: log server có
  `issue update rejected with 422` lúc 18:05:10, cùng giây `environment.lease_released` với
  `failureReason: "Cancelled before issue reassignment"` và `crew.remote_stop`. Run `981b59f2`, `1d39d37f`, `5239774d`
  đều `cancelled issue_reassigned` dù assignee không đổi. Nghĩa là Paperclip hủy run của assignee *trước khi* biết lệnh
  ghi có thành công hay không. Hệ quả:
  - agent không nhận được 422 để tự sửa;
  - mỗi lần chạy lại tốn một run;
  - sau 2 lần chạy lại, issue chuyển `blocked`.

  Đề xuất ticket nhỏ ở fork (gói policy/hook): chỉ hủy run khi lệnh ghi đã commit, hoặc gate kiểm trước bước hủy.
- **P2 — Gate đọc bằng chứng docs quá chặt về định dạng.** Regex
  `^crew-docs-check commit=… range=… exit=([0-3])$` ở `server/src/crew/issue-policy.ts:245` cần đuôi dòng. Integrator
  (sonnet) viết `exit=0` rồi dính liền "```crew-docs check …```" trên cùng dòng. Lần AC-6 viết đúng dạng. Đề xuất: nới
  regex (cho phép phần thừa sau `exit=N`), hoặc nhắc rõ trong `AGENTS.md` mẫu của integrator. Ưu tiên P1 hơn.
- **Ghi chú:** run `2862f047` của assistant `setup_failed` "Issue is blocked by unresolved blockers" lúc 18:00:19.
  Đây là lượt đánh thức tự động khi gốc đang chờ con, không phải lỗi.

## Việc owner cần làm

1. Tạo Developer ID Application (team `J7Y2DL6HZV`) và `xcrun notarytool store-credentials crew-notary` → mở cổng 1, 5
   (UPD-3), rồi nói "làm" để đăng release (UPD-4) → cổng 2 (dmg từ Releases, wizard nhận cài đặt có sẵn).
2. Cài bản app mới nhất (FX-6 `fb36a4d` trở lên; hiện `/Applications` là `6861ca5`). Cần bấm Thoát app khi 0 run.
3. Cổng 4 phần UI: đóng cửa sổ giữa một run; thoát giữa run, chọn "Thoát ngay, run vẫn chạy"; mở lại.
4. Cổng 7 phần CLI: khi 0 run, thoát app → `~/.crew/bin/crew-mac setup --sshd-owner launchd` → `doctor` → mở app,
   wizard chuyển lại.
5. Cổng 3: khi Claude Code tự cập nhật khỏi `2.1.295`, chạy một issue tới `done` rồi kiểm lại log `tccd`.
6. Cổng 8: xem Mục đăng nhập, tắt "2P Crew" v2 nếu còn (hoặc `sudo sfltool dumpbtm | grep com.2p-solutions.crew`).
7. Cổng 6 "Gỡ khỏi Mac" (owner quyết có thử trên 2ps-landing không).
8. S1b login item (một lần đăng xuất/đăng nhập).
9. Quyết ticket cho P1/P2.
10. 2ps-landing: `origin/main` = `f0555c6`, folder owner vẫn `705b149` (owner tự pull).
