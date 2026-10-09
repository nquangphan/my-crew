# AC-6 — Nghiệm thu R2-1 cổng 4/6: một yêu cầu thật trên `2ps-landing`

Ngày 09/10/2026, giờ Asia/Ho_Chi_Minh (đồng hồ Mac mini và VPS khớp nhau). Người chạy: agent Claude (opus), giao từ Trợ Lý.

Lưu ý về giờ: ledger ghi "21:00/21:10" cho bước thay app và thêm project, nhưng đồng hồ thật lúc đó là khoảng 17:00/17:08. Dòng vai trò `crew_project_roles.updated_at` là `10:08:23 UTC`, tức 17:08:23 ICT. Báo cáo này dùng giờ thật.

## Kết luận

**KHÔNG ĐẠT, dừng ở stage đầu tiên.** Issue TPS-71 giao cho assistant của project. Run đầu `6ffb24cc` thất bại sau 3 giây với `adapter_engine_unavailable`. Lỗi nguyên văn:

> Claude ACP supports sandbox remote targets only; this run targets a non-sandbox remote environment. Repair the ACP setup, or explicitly set engine=cli to use the CLI engine.

**Nguyên nhân:** cả 4 agent do app tạo lúc thêm project đều thiếu `adapterConfig.engine`. Các agent cũ (`mac-claude`, `reviewer`, `integrator`, `mac-claude-2`, `tro-ly`) đều có `engine=cli`. Trong code, `apps/mac-app/src/main/paperclip/client.ts:257-261` (`createAgent`, nhánh `r21/paperclip-api` `6861ca5`) chỉ gửi `command`, `extraArgs` và `model` (nếu có). Payload không có `engine: 'cli'` nên Paperclip mặc định chạy ACP, mà ACP không chạy được với environment SSH `in_place`.

Ngoài ra, agent mới không có key `env` và `model`, trong khi agent cũ có. Chưa xác minh hai key này có cần không. Người sửa nên so lại đủ bộ key với `crew/agents/apply-roles.sh` / `merge-agent-config.mjs`.

Theo brief, em **không sửa code, không PATCH agent và không chạy lại**. TPS-71 đã chuyển `cancelled` lúc 17:11:45.

## Tiêu chí

| Tiêu chí | Kết quả | Bằng chứng |
|---|---|---|
| 0 run active trước khi tạo | ĐẠT | `ops/active-runs.sh` không in gì. Health `ok`, commit `2bbda3cb2…`. Backup `backup 20261009-1710 ok: 8.8M total, builtin=ok`. |
| Tạo một yêu cầu nhỏ theo đường R1, giao assistant của project | ĐẠT | Board gọi `api.sh POST /companies/5befeb1a…/issues` lúc 17:11:09 và nhận về **TPS-71** `b17d86cd-23ab-4f23-96cc-873591a2d9b5`: `todo`, `projectId a5ed1f8a…`, assignee `f1bdbd53…` (`p-2ps-landing-assistant`). Nội dung yêu cầu: thêm đúng một dòng "Ghi chú: hướng dẫn này được rà lại ngày 09/10/2026." vào cuối `docs/deployment-guide.md`, không đụng `src/`. |
| Wake assistant | ĐẠT | Run `6ffb24cc` (`assignment`) tạo 17:11:09, bắt đầu 17:11:10. |
| Assistant chạy và tạo con / chuyển stage | **KHÔNG ĐẠT** | Run `6ffb24cc` `failed` lúc 17:11:13, `error_code=adapter_engine_unavailable`, exit 1, stdout và stderr rỗng. Lease `f54ee33a` tạo 17:11:11, nhả 17:11:13, trạng thái `failed`. Paperclip tự đưa TPS-71 sang `blocked` lúc 17:11:13 kèm comment "…still has no live execution path. Moving it to `blocked`…". Agent assistant chuyển `error`. |
| Executor → reviewer → integrator → owner duyệt → push | KHÔNG CHẠY | Bị chặn ở bước trên. Không có duyệt thay và không có comment đánh thức tay. |
| Commit trên `origin/main` của 2ps-landing | KHÔNG CHẠY | `git ls-remote origin main` trả `705b149d61335a9c55c04d03e12cd068ec7e4370`, không đổi. |
| Folder owner không bị đổi | ĐẠT | `/Volumes/CORSAIR/Projects/2ps-landing`: HEAD `main` `705b149`. shasum toàn bộ file tracked và `git status --porcelain --ignored` trước/sau giống hệt (`8eaab35a…`, `bdcee4cf…`). `find -newer <mốc 17:10>` (bỏ `.git`) ra 0 file. |
| Worktree agent không đổi | ĐẠT | 4 worktree `~/crew-agents/p-2ps-landing/*` đều ở `705b149`, 0 thay đổi. |
| Run chạy qua sshd của app (`claude` con của `sshd-session` của PID 44751) | KHÔNG ĐO ĐƯỢC | Run hỏng ở phía server sau 3 giây và không sinh process `claude` nào trên Mac. sshd của app vẫn đúng: listener 2222 là PID 44751, PPID 44681 (`2P Crew`). |
| Không hộp thoại TCC mới | ĐẠT | `~/.crew/bin/crew-mac doctor` (đủ probe) lúc 17:12: 0 lỗi, "Hộp thoại quyền macOS đang chờ: không có trong 24h gần nhất". Mục "Quyền macOS của run gắn với" trả về `com.2p-solutions.crew.mac`. |
| Ảnh chụp docs sang commit mới | KHÔNG CHẠY | Không có commit mới. |
| 0 process mồ côi | ĐẠT | `pgrep -fl "crew-claude-run\|paperclip-runtime\|paperclip-bridge"` ra rỗng. Process `claude` duy nhất là phiên điều phối này (PID 2114, `--resume d10ef178…`), không phải agent. Sau khi hủy, `active-runs.sh` không in gì. |

## Dòng thời gian TPS-71 (đo từ `heartbeat_runs`, `environment_leases`, `issues`)

| Giờ | Sự kiện |
|---|---|
| 17:10 | Backup `20261009-1710`. Chụp mốc folder owner. |
| 17:11:09 | Board tạo TPS-71, giao `p-2ps-landing-assistant`. Run `6ffb24cc` queued. |
| 17:11:10 | Run bắt đầu. |
| 17:11:11 | Lease `f54ee33a` tạo. |
| 17:11:13 | Run `failed` `adapter_engine_unavailable`. Lease nhả (`failed`). Issue chuyển `blocked`, agent chuyển `error`. |
| 17:11:45 | Board `PATCH status=cancelled` kèm comment lý do. |
| 17:13 | Kiểm xong: 0 run active, folder owner và origin không đổi. Đã xóa file tạm `/tmp/ac6-*` trên VPS. |

## Lệnh

```sh
ssh nhamoiplatform '/opt/crew-v3-spike/ops/active-runs.sh </dev/null'      # 0 run
ssh nhamoiplatform '/opt/crew-v3-spike/ops/backup.sh </dev/null'           # 20261009-1710
ssh nhamoiplatform 'cd /opt/crew-v3-spike && ./api.sh POST /companies/<company>/issues "$(cat /tmp/ac6-issue.json)" </dev/null'
# đọc DB: psql chỉ đọc trong crew-v3-spike-db-1 (heartbeat_runs, environment_leases, issues, issue_comments, agents.adapter_config: chỉ lấy key và engine)
ssh nhamoiplatform 'cd /opt/crew-v3-spike && ./api.sh PATCH /issues/<TPS-71> "{\"status\":\"cancelled\",...}" </dev/null'
git -C /Volumes/CORSAIR/Projects/2ps-landing ls-remote origin main; ~/.crew/bin/crew-mac doctor
```

## Trạng thái để lại

- TPS-71 ở `cancelled`.
- **Agent `p-2ps-landing-assistant` đang `error`.** Run hỏng đã đặt trạng thái này. Em không đổi, vì brief không cho sửa. Sau khi sửa `engine`, cần resume hoặc đặt lại agent.
- 3 agent còn lại `idle`. Cả 4 vẫn thiếu `engine=cli`.
- Quota: 1 run Claude, hỏng trước khi gọi model, nên gần như không tốn quota.
- Không push. Không sửa code. Không có Codex hay fable.

## Cần làm tiếp (không thuộc phạm vi AC-6)

1. Sửa `createAgent` trong `apps/mac-app/src/main/paperclip/client.ts` để gửi `engine: 'cli'`, cùng test khóa payload. So thêm `env`/`model` với agent do `apply-roles.sh` tạo.
2. Sửa 4 agent hiện có của `2ps-landing`: PATCH `adapterConfig.engine=cli` bằng board (theo H5, agent không tự sửa được), rồi resume assistant.
3. Chạy lại AC-6 một lần.

---

# Lần 2 — sau FX-6 (09/10/2026, 17:14–17:33 ICT, giờ theo `date` của Mac)

## Kết luận

**ĐẠT luồng chính, còn 1 tiêu chí KHÔNG ĐẠT do lỗi có từ trước, không do FX-6 gây ra.** Sau khi sửa engine, yêu cầu thật TPS-72 trên `2ps-landing` đi đủ 4 stage tới push trong **12 phút 20 giây**, tính từ lúc tạo issue (17:18:46) tới lúc gốc `done` (17:31:06):

- origin `main` đổi `705b149` → `546c746`.
- Folder owner không đổi gì.
- Mọi run `claude` chạy dưới sshd do app giữ.
- `doctor` báo 0 lỗi, không còn process mồ côi.

Tiêu chí KHÔNG ĐẠT: `status-repos.json` của 2ps-landing vẫn có `lastCommit: null`, và ảnh chụp docs chưa gửi lên server. Lỗi này có từ lúc thêm project (17:10), trước cả lần chạy này. `~/.crew/logs/status.log` đã ghi 20 lần liền "không gửi được ảnh chụp docs của a5ed1f8a…". Em đã dựng lại lỗi trong thư mục tạm:

- `buildDocsSnapshot` tạo `docs/flows.yaml` mẫu `version: 1\nflows: {}` cho bước secret-scan.
- Bundle `~/.crew/bin/crew-docs.cjs` (bản 15:32, sha `356fea6a…`) mà 2ps-landing được gán từ chối file đó. Lỗi nguyên văn: `R1 docs/flows.yaml: source: Invalid input: expected object, received undefined; fix the manifest`, exit 1, 0 dòng R7.
- Kết quả là code ném "Secret-scan không trả kết quả", lỗi bị nuốt, nên không có request nào tới server (bảng `plugin_webhook_deliveries` chỉ có dòng `machine-status`).
- repo-a không bị vì dùng bundle cũ `crew-docs-2ce11c9.cjs`.

Lỗi này cần một ticket riêng ở `crew-mac` `status/docs.js` (file mẫu thiếu `source`), hoặc cho 2ps-landing dùng bundle cũ. Em không sửa vì nằm ngoài FX-6.

## FX-6 — đối chiếu cấu hình agent (đọc `GET /companies/<id>/agents`, chỉ in tên key của `env`)

| Trường | Agent R1 (`mac-claude`, `mac-claude-2`, `reviewer`, `integrator`, `tro-ly`) | 4 agent app tạo | Quyết định |
|---|---|---|---|
| `adapterType` | `claude_local` | `claude_local` | giống |
| `adapterConfig.engine` | `cli` | **thiếu** | **App phải đặt `cli`**. Thiếu thì Paperclip chạy ACP và hỏng `adapter_engine_unavailable`. |
| `adapterConfig.model` | `claude-sonnet-5`; riêng `tro-ly` dùng `claude-opus-5` (O10/O16) | **thiếu** | **App phải đặt theo vai**: assistant `claude-opus-5`, executor/reviewer/integrator `claude-sonnet-5`. |
| `adapterConfig.env` | `{}` (0 key, không có secret) | **thiếu** | **App đặt `{}`**. Ledger R1-2 ghi PATCH bỏ trống `env` thì server giữ env cũ, nên ghi rõ `{}` để khớp R1. |
| `adapterConfig.command` / `extraArgs` | wrapper `crew-claude-run`, Superpowers ghim `6.4.1-5bf4e7801107` | giống | giữ nguyên |
| `instructions*` (4 key) | `managed`, `AGENTS.md` | giống | do server đặt |
| `adapterConfig.paperclipSkillSync` | chỉ `tro-ly` có (`desiredSkills: []`) | không có | không cần: các agent R1 khác cũng không có |
| `runtimeConfig` | `heartbeat {enabled:false, maxConcurrentRuns:1}` | giống | giữ nguyên |
| `title` | có (vd. "Crew reviewer") | `null` | không cần, chỉ để hiển thị |
| `role` | `engineer` / `general` | `general` | không cần: vai trò do server đọc từ file cấu hình/plugin (`apply-roles.sh` không ghi `role`) |
| `defaultEnvironmentId` | mỗi agent một environment riêng | mỗi agent một environment riêng | giống |
| `permissions`, `budgetMonthlyCents`, `metadata`, `capabilities`, `reportsTo` | `canCreateAgents/Skills: true`, 0, null, null, null | giống | giống |

**Code** (worktree `crew-r21-api`, nhánh `r21/paperclip-api`, commit `fb36a4d` nằm trên `6861ca5`, chưa push, chưa merge):

- `createAgent` gửi `adapterConfig = { engine: 'cli', command, extraArgs, model, env: {} }`. `model` giờ là bắt buộc: thiếu thì ném lỗi, không gọi mạng.
- `getAgent`/`agents` trả thêm `engine`, không giữ `env`.
- `add-project` đặt model theo vai qua `AGENT_MODELS`.
- Bước `check` đọc lại từng agent, gặp `engine !== 'cli'` thì ném lỗi và không resume agent nào.
- Làm TDD: 5 test đỏ trước (client 3, add-project 2), sau đó xanh.
- Kiểm tra: `@crew/mac-app` 38 file / 398 test pass (cùng 24 test node), typecheck sạch, `pnpm lint` sạch, `crew-docs check --staged` ok.
- Docs: `docs/flows/mac-app-paperclip.md`.

**Dữ liệu prod:**

- Lúc 17:17:47: `active-runs.sh` không còn run nào, đã backup `20261009-1717 ok: 8.8M total, builtin=ok`.
- 17:18: PATCH 4 agent qua board, mỗi body = `adapterConfig` hiện có cộng `{engine:"cli", model, env:{}}`. Đọc lại thấy engine `cli`, model đúng vai, `env` 0 key, `extraArgs` không đổi.
- Assistant đang `error` thì gọi `POST /agents/:id/resume`. Hàm `svc.resume` của Paperclip đặt `idle` và xóa `errorReason`. Kết quả: 4 agent `idle`, `errorReason=null`.
- Không sửa agent R1 nào.

## Tiêu chí lần 2

| Tiêu chí | Kết quả | Bằng chứng |
|---|---|---|
| 4 agent `idle` + `engine=cli` trước khi chạy | ĐẠT | 17:18:19: executor-1/reviewer/integrator `claude-sonnet-5`, assistant `claude-opus-5`, cả 4 đều `idle`, `cli`. |
| 0 run active, có backup trước khi tạo | ĐẠT | `active-runs.sh` rỗng; backup `20261009-1717`. |
| Tạo yêu cầu nhỏ, giao assistant | ĐẠT | 17:18:46 tạo **TPS-72** `eff83344…`, cùng tiêu đề/mô tả/project với TPS-71, assignee `p-2ps-landing-assistant`. |
| Stage 1: Trợ Lý lập kế hoạch, tạo con | ĐẠT | Run `165a3c6e` chạy 17:18:48–17:21:50. `crew-plan root=TPS-72 children=1` lúc 17:20:50. Con **TPS-73** (gói `deploy-docs`, sonnet/low) tạo 17:21:10. |
| Stage 2: executor → reviewer con | ĐẠT | Executor `a74c7f3c` chạy 17:21:11–17:22:30 (cancelled `issue_reassigned` là đúng thiết kế khi chuyển sang reviewer), commit `9955ff3`. Reviewer `66b24b1e` chạy 17:22:31–17:22:59, TPS-73 `done` lúc 17:22:54. Trợ Lý `94379684` ghi `crew-assistant done` lúc 17:23:33. |
| Stage 3: reviewer gốc | ĐẠT | `4e05472c` chạy 17:23:34–17:25:03. `crew-review root children=TPS-73 verdict=approved` lúc 17:25:04. |
| Stage 4: integrator, owner duyệt, push | ĐẠT | Integrator `f8fee8ec` chạy 17:25:05–17:27:33: merge `--no-ff` thành `546c746`, `crew-docs-check … exit=0` lúc 17:27:24, chuyển sang stage `approval` lúc 17:27:33. Em duyệt thay owner lúc 17:28:02 (board `PATCH status=done` kèm comment). Integrator `311e23b8` chạy 17:28:03–17:31:14, ghi `crew-merge sha=546c7465… branch=main pushed=yes` lúc 17:30:55. Gốc `done` lúc 17:31:06, `completedStageIds` = 4. |
| Commit trên `origin/main` | ĐẠT | `git ls-remote origin main` = `546c7465b7699ab2e947dba92667cb016575647b`. Commit chỉ đổi `docs/deployment-guide.md` (+2 dòng: 1 dòng trống và "Ghi chú: hướng dẫn này được rà lại ngày 09/10/2026."). Trợ Lý ghi giả định là bỏ dấu `>` của ticket. |
| Folder owner không đổi | ĐẠT | `/Volumes/CORSAIR/Projects/2ps-landing`: HEAD `main` `705b149`. shasum file tracked `8eaab35a…` và `status --porcelain --ignored` `bdcee4cf…` trùng trước/sau (và trùng lần 1). `find -newer <mốc 17:18>` (bỏ `.git`) ra 0 file. |
| `claude` chạy dưới `sshd-session` con của listener sshd của app | ĐẠT | Listener 2222 là PID 44751, PPID 44681 (`2P Crew`), trước và sau đều vậy. Lúc 17:19 thấy `claude … --model claude-opus-5` PID 77503 → `sshd-session …@notty` 77502 → `[priv]` 77500 → 44751. Lúc 17:22 thấy sonnet 86868 → 86866 → 86844 → 44751 và opus 91624 → 91623 → 91607 → 44751. |
| `crew-mac doctor` 0 lỗi | ĐẠT | 17:31 (đủ probe): mọi mục ĐẠT. "sshd agent (do app 2P Crew giữ): listener pid 44751", TCC 0 hộp thoại trong 24h, `claude -p` ok. |
| `status-repos.json` `lastCommit` cập nhật | **KHÔNG ĐẠT** | 17:32 vẫn `null`. Job chạy ở commit `546c746` nhưng gửi ảnh chụp docs thất bại (nguyên nhân ở Kết luận). Lỗi này có từ 17:10, không do FX-6. |
| Ảnh chụp docs sang commit mới | KHÔNG ĐẠT | Cùng nguyên nhân: không có delivery `docs-snapshot` nào. |
| 0 process mồ côi, 0 run active | ĐẠT | 17:33: `pgrep -fl "crew-claude-run\|paperclip-bridge\|claude --print"` rỗng, `active-runs.sh` rỗng, không còn `/tmp/crew-mac-docs-*`. Lưu ý: lúc 17:19, `paperclip-bridge-server.mjs` (77461) chạy với PPID 1 trong lúc run assistant đang chạy, sau đó tự tắt. |
| Worktree agent | Như mong đợi | assistant/reviewer `705b149` sạch; executor-1 `9955ff3` (`crew/TPS-73`) sạch; integrator `546c746` (`crew/req/TPS-72`) sạch. |

## Dòng thời gian TPS-72 (`heartbeat_runs`, `issues`, `issue_comments`; giờ ICT)

| Giờ | Sự kiện | Thời lượng stage |
|---|---|---|
| 17:18:46 | Board tạo TPS-72 → run assistant `165a3c6e` | |
| 17:20:50 / 17:21:10 | `crew-plan`; tạo con TPS-73 | Lập kế hoạch: 2 phút 24 giây |
| 17:21:11 → 17:22:54 | Executor làm TPS-73, rồi reviewer con duyệt, TPS-73 `done` | Con: 1 phút 44 giây |
| 17:23:33 | Trợ Lý `crew-assistant done`, gốc sang reviewer | |
| 17:23:34 → 17:25:04 | Reviewer gốc `verdict=approved` | Review: 1 phút 30 giây |
| 17:25:05 → 17:27:33 | Integrator merge + docs-check, sang `approval` | Tích hợp: 2 phút 28 giây |
| 17:28:02 | Duyệt thay owner | Chờ duyệt: 29 giây |
| 17:28:03 → 17:31:06 | Integrator push (`pushed=yes` 17:30:55), gốc `done` | Push: 3 phút 3 giây |

## Trạng thái để lại

- TPS-72 và TPS-73 `done`, không phải cancel. TPS-71 vẫn `cancelled`.
- 4 agent 2ps-landing `idle`, `engine=cli`.
- 2ps-landing `origin/main` = `546c746`. Folder owner vẫn ở `705b149`; owner tự pull khi muốn.
- Đã xóa file tạm trên VPS (`/tmp/ac6b-*`, `/tmp/fx6-*`).
- Quota: 7 run Claude (2 opus assistant, 5 sonnet) cộng 1 probe `claude -p` của doctor.
- Không push, không Codex/fable, không đụng sshd/app.
