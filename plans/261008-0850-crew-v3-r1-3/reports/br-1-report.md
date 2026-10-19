# Báo cáo BR-1 — nối session cùng gói khi claim

Cập nhật: 08/10/2026 14:34:19 (Asia/Ho_Chi_Minh).

**Status: DONE cho phần triển khai được giao; chờ lead chạy test DB trước nghiệm thu.**

- Commit: `b1ce9b8fce5d69d4690138cf01ef16dafecaa3c1`.
- Nhánh/worktree: `crew/r13-session`, `/Users/phannhatquang/Documents/Projects/crew/.worktrees/paperclip-r13-session`.
- Tiền đề: SP-1 GO H1 tại `8ba201d31`, lead chạy 3/3 xanh ngoài sandbox ([log](sp-1-lead-run-2.log)).
- Không thêm hook; ngân sách giữ 4/5. Không sửa `heartbeat.ts`, `issues.ts`, schema, migration hoặc file ngoài sở hữu.

## File đổi và hành vi

| File | Thay đổi |
|---|---|
| `server/src/crew/bundle-resume.ts` | Export regex/parser, chọn/tìm tiền nhiệm, apply và wrapper fail open. |
| `server/src/crew/core-hooks.ts` | Cổng tải trước; nếu không giữ run thì thử nối session rồi cho stock claim; mô tả mutation context. |
| `server/src/__tests__/crew-bundle-resume.test.ts` | 10 ca không cần DB và 15 ca DB; dùng wake request liên kết giống harness SP-1 đã GO. |
| `crew/release/core-hooks.json` | Mục H1 thêm mô tả và hai test session; giữ anchor và số hook. |
| `crew/ops/inspect-image.sh` | Kiểm cả `bundle-resume.js` và `model-policy.js` (module thứ hai đến từ gói policy khi tích hợp). |

Chỉ nối khi B giao cho agent của run, có marker hợp lệ, agent chưa có task session riêng trên B; A là blocker trực tiếp cùng company/bundle, seq nhỏ hơn và done, có session của cùng agent/adapter với lastRunId và params không rỗng. Chọn seq lớn nhất, hòa chọn updatedAt mới nhất.

Resume được merge vào context DB hiện tại khi run còn queued; guard DB không đè explicit resume mới ghi từ lần đọc khác. Ghi activity `crew.bundle_resume` cùng transaction với patch; chỉ mutate object run và publish event sau commit. Lỗi DB rollback rồi log `crew-bundle-resume: failed open`, không giữ run. Lỗi publish sau commit chỉ warn, vẫn applied.

## TDD: RED rồi GREEN

Test được viết trước implementation. Lệnh cả RED và GREEN:

```sh
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-bundle-resume.test.ts -t 'parseCrewBundle|pickBundlePredecessor|applyBundleResumeSafely|thứ tự cổng tải'
```

RED: đúng lỗi module chưa tồn tại như Step 2 của session.md (chưa có assertion chạy), exit 1:

```text
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/__tests__/crew-bundle-resume.test.ts [ src/__tests__/crew-bundle-resume.test.ts ]
Error: Cannot find module '/src/crew/bundle-resume.ts' imported from /Users/phannhatquang/Documents/Projects/crew/.worktrees/paperclip-r13-session/server/src/__tests__/crew-bundle-resume.test.ts
 ❯ src/__tests__/crew-bundle-resume.test.ts:17:1
     15| } from "@paperclipai/db";
     16| import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestData…
     17| import {
       | ^
     18|   applyBundleResume,
     19|   applyBundleResumeSafely,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  no tests
   Start at  14:29:11
   Duration  1.18s (transform 538ms, setup 97ms, import 0ms, tests 0ms, environment 0ms)

undefined
/Users/phannhatquang/Documents/Projects/crew/.worktrees/paperclip-r13-session/server:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: vitest run src/__tests__/crew-bundle-resume.test.ts -t parseCrewBundle|pickBundlePredecessor|applyBundleResumeSafely|thứ tự cổng tải
```

GREEN sau implementation: **10 passed, 15 skipped do bộ lọc tên test**; không gọi PostgreSQL setup. Exit 0:

```text

 RUN  v4.1.11 /Users/phannhatquang/Documents/Projects/crew/.worktrees/paperclip-r13-session/server

[14:30:31] WARN: CREW_POLICY_CONFIG chưa đặt: gate Crew (review, integrator, owner, docs) tắt cho mọi company {"env":"CREW_POLICY_CONFIG"}

 Test Files  1 passed (1)
      Tests  10 passed | 15 skipped (25)
   Start at  14:30:23
   Duration  10.27s (transform 7.07s, setup 114ms, import 10.03s, tests 5ms, environment 0ms)

```

Các ca không cần DB phủ marker CRLF/giới hạn/dòng đầu; điều kiện chọn seq/session; lỗi đọc DB fail open; cổng tải giữ run thì không resume và cổng mở trước resume.

## Kiểm tra bổ sung

`corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-core-hooks.test.ts` → **7 passed**, exit 0. Warn SSH timeout là ca mô phỏng lỗi có chủ đích:

```text

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  14:31:16
   Duration  4.46s (transform 2.69s, setup 75ms, import 4.29s, tests 9ms, environment 0ms)

```

`node crew/release/check-core-hooks.mjs` → exit 0:

```text
CẢNH BÁO P1: chưa có PR upstream
CẢNH BÁO P2: chưa có PR upstream
CẢNH BÁO P3: chưa có PR upstream
CẢNH BÁO P4: chưa có PR upstream
Hook một dòng: 4/5; mục: 8; lỗi: 0
```

`bash -n crew/ops/inspect-image.sh` và `git diff --cached --check` → exit 0. Chưa chạy Docker inspect/build image.

`corepack pnpm --filter @paperclipai/server exec tsc --noEmit` → exit 1; **115 diagnostics, giống hệt tập diagnostics của sp-1-harness-typecheck.log, thêm 0/bớt 0**. Thiếu declarations paperclip-runner cùng implicit-any liên quan; không diagnostics tại file BR-1. Không sửa/build package ngoài sở hữu:

```text
src/services/provider-trace-workspace-diff-reprojection.ts(98,58): error TS7006: Parameter 'file' implicitly has an 'any' type.
src/services/question-response-delivery.ts(205,8): error TS7006: Parameter 'optionId' implicitly has an 'any' type.
src/vendor/paperclip-runner/index.ts(10,35): error TS2307: Cannot find module '@paperclipai/paperclip-runner' or its corresponding type declarations.
src/vendor/paperclip-runner/index.ts(58,8): error TS2307: Cannot find module '@paperclipai/paperclip-runner' or its corresponding type declarations.
src/vendor/paperclip-runner/index.ts(60,10): error TS2307: Cannot find module '@paperclipai/paperclip-runner' or its corresponding type declarations.
src/vendor/paperclip-runner/index.ts(62,10): error TS2307: Cannot find module '@paperclipai/paperclip-runner' or its corresponding type declarations.
src/vendor/paperclip-runner/index.ts(94,20): error TS2307: Cannot find module '@paperclipai/paperclip-runner' or its corresponding type declarations.
src/vendor/paperclip-runner/index.ts(95,13): error TS2307: Cannot find module '@paperclipai/paperclip-runner' or its corresponding type declarations.
src/vendor/paperclip-runner/testing.ts(9,42): error TS2307: Cannot find module '@paperclipai/paperclip-runner/testing' or its corresponding type declarations.
src/vendor/paperclip-runner/testing.ts(21,8): error TS2307: Cannot find module '@paperclipai/paperclip-runner/testing' or its corresponding type declarations.
undefined
/Users/phannhatquang/Documents/Projects/crew/.worktrees/paperclip-r13-session/server:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: tsc --noEmit
```

[Log RED](br-1-red.log) · [Log GREEN](br-1-green.log) · [Log registry hook test](br-1-core-hooks.log) · [Log checker](br-1-registry.log) · [Log typecheck](br-1-typecheck.log).

## Test DB đã viết, chưa chạy tại đây

15 ca bao gồm: hai loại wake tới adapter; khác gói/thiếu marker/khác agent không nối nhưng run vẫn thực thi; B có session riêng; A chưa done; explicit resume có sẵn; run mất queued; merge context DB mới + mutate object + activity một lần; không đè explicit resume từ snapshot cũ; B đổi assignee; company boundary ở relation/blocker; khác adapter; rollback khi persistActivity lỗi.

Theo chỉ thị user, **không chạy PostgreSQL trong sandbox**. Chưa có RED/GREEN cho các ca DB này; không gọi 15 ca filtered là đã pass. Không chạy full suite, E2E, deploy, SSH, push. Không đặt PAPERCLIP_RUN_ID.

Cần lead chạy (từ worktree):

```sh
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-bundle-resume.test.ts src/__tests__/crew-claim-resume-contract.test.ts src/__tests__/crew-core-hooks.test.ts src/__tests__/crew-before-claim.test.ts
```

Sau khi có kết quả, lead đánh giá DB/integration. Dừng tại bàn giao này.

## Giả định, ruling và lệch plan

- Đưa setup PostgreSQL vào beforeAll của nhóm DB để lọc unit thật sự không chạm DB; nhóm DB không silently skip khi support hỏng.
- Fixture B seed agent_wakeup_requests và wakeupRequestId theo sửa harness SP-1; mọi ca kiểm runtime đều đòi đúng một adapter call và succeeded, tránh false positive null khi không execute.
- Bổ sung company filter ở join blocker/agent, bỏ params rỗng, kiểm explicit resume trong UPDATE để bảo vệ snapshot cũ.
- Dùng persistActivity + publishActivity thay cho logActivity trực tiếp nhằm commit audit cùng patch và publish sau commit, bảo đảm fail open khi audit ghi lỗi.
- Lead chạy DB ngoài sandbox theo lệnh mới; chỉ bàn giao implementation DONE, không tuyên bố nghiệm thu toàn gói xanh.
- Điều kiện môi trường giữ như plan: cùng executor/environment in_place, maxConcurrentRuns=1; stock vẫn có thể xoay session vì compaction hoặc credential.
- Tất cả lựa chọn kỹ thuật đã append ledger. Không có migration/dữ liệu cần dọn; rollback revert commit này.

## Review độc lập

Reviewer chỉ đọc đã kiểm điều kiện B/A, scope company/agent/adapter, transaction/context/activity, guard queued/explicit resume, thứ tự cổng tải, fixture và 4 hook. Không finding cần sửa; không tự chạy DB. Review không thay cho kết quả lead chạy 15 ca DB.

## Sửa F2

Cập nhật: 08/10/2026 14:55:06 (Asia/Ho_Chi_Minh). **Status: DONE trong phạm vi sửa F2 được giao.**

Commit mới: `2bba0f0ca4ad978c7b292efc40f6d7302befe165` — `fix(crew): scope bundle session reuse to sibling issues`. Nhánh `crew/r13-session`, base trước sửa `b1ce9b8fce5d69d4690138cf01ef16dafecaa3c1`.

### Thay đổi

- `server/src/crew/bundle-resume.ts`: đọc `parentId` của B; bỏ qua khi null. Query blocker A yêu cầu `A.parentId = B.parentId`, cùng các điều kiện company, marker gói, seq nhỏ hơn, blocker trực tiếp, A done và task session cùng agent/adapter đang có. Cả A/B vì vậy đều là con cùng một parent khác null.
- `server/src/__tests__/crew-bundle-resume.test.ts`: fixture A/B mặc định nằm dưới một issue gốc thật; hai happy path cùng gốc vẫn đi qua claim → adapter cho cả wake `issue_blockers_resolved` và `issue_assigned`. Thêm ca hai gốc cùng company/tên gói/agent có blocker chéo: B phải execute với sessionId null, context không có resumeFromRunId, không có activity resume. Thêm ba ca A/B/cả hai không phải issue con: skipped và không ghi DB/activity.

### TDD trên PostgreSQL thật

Lệnh RED và GREEN:

```sh
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-bundle-resume.test.ts
```

**RED trước sửa production:** 4 failed / 25 passed. Ca blocker chéo thực sự nhận `sess-a` thay vì null; ba ca issue gốc trả applied thay vì skipped. Happy path mới đã có parent chung vẫn xanh ở lượt RED.

```text
     × cả hai không phải issue con: không nối 9ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/__tests__/crew-bundle-resume.test.ts > nối session trong gói khi claim > hai gốc dùng cùng tên gói và blocker chéo: B chạy session mới
AssertionError: expected 'sess-a' to be null

- Expected:
null

+ Received:
"sess-a"

 ❯ src/__tests__/crew-bundle-resume.test.ts:254:57
    252|     await db.update(issues).set({ parentId: otherParentId }).where(eq(…
    253|     await claimAll();
    254|     expect((await runtimeOf(s.runB)).sessionId ?? null).toBeNull();
       |                                                         ^
    255|     const [run] = await db.select().from(heartbeatRuns).where(eq(heart…
    256|     expect(run!.contextSnapshot).not.toHaveProperty("resumeFromRunId");

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

 FAIL  src/__tests__/crew-bundle-resume.test.ts > nối session trong gói khi claim > A không phải issue con: không nối
 FAIL  src/__tests__/crew-bundle-resume.test.ts > nối session trong gói khi claim > B không phải issue con: không nối
 FAIL  src/__tests__/crew-bundle-resume.test.ts > nối session trong gói khi claim > cả hai không phải issue con: không nối
AssertionError: expected 'applied' to be 'skipped' // Object.is equality

Expected: "skipped"
Received: "applied"

 ❯ src/__tests__/crew-bundle-resume.test.ts:265:56
    263|     if (root !== "A") await db.update(issues).set({ parentId: null }).…
    264|     const [run] = await db.select().from(heartbeatRuns).where(eq(heart…
    265|     expect(await applyBundleResume({ db, run: run! })).toBe("skipped");
       |                                                        ^
    266|     const [after] = await db.select().from(heartbeatRuns).where(eq(hea…
    267|     expect(after!.contextSnapshot).not.toHaveProperty("resumeFromRunId…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯


 Test Files  1 failed (1)
      Tests  4 failed | 25 passed (29)
   Start at  14:51:27
   Duration  17.37s (transform 6.78s, setup 138ms, import 10.37s, tests 6.72s, environment 0ms)

undefined
/Users/phannhatquang/Documents/Projects/crew/.worktrees/paperclip-r13-session/server:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: vitest run src/__tests__/crew-bundle-resume.test.ts
```

**GREEN sau sửa:** 29/29 passed, 0 skipped, exit 0; bao gồm toàn bộ test DB cũ và bốn ca mới.

```text

 Test Files  1 passed (1)
      Tests  29 passed (29)
   Start at  14:51:58
   Duration  38.48s (transform 20.79s, setup 285ms, import 26.79s, tests 11.13s, environment 0ms)

```

[Log RED](br-1-parent-red.log) · [Log GREEN](br-1-parent-green.log).

### Kiểm tra bổ sung và tài nguyên

- Đã kiểm `ipcs -m` trước cả hai lượt DB: 5/32 segment, không đầy. Không chạy ipcrm hay gỡ segment nào. Sau GREEN, ipcs -m -p -o vẫn đúng 5 segment cũ; PostgreSQL test được helper cleanup.
- `node crew/release/check-core-hooks.mjs` → exit 0, `Hook một dòng: 4/5; mục: 8; lỗi: 0`. Cảnh báo upstream P1–P4 có sẵn.
- `git diff --cached --check` → exit 0.
- `corepack pnpm --filter @paperclipai/server exec tsc --noEmit` → exit 1, **115 diagnostics cũ, thêm 0/bớt 0** so với br-1-typecheck.log; thiếu declarations paperclip-runner và các implicit-any liên quan, không lỗi mới tại hai file sửa. Không build/sửa package ngoài sở hữu.

```text
src/vendor/paperclip-runner/index.ts(60,10): error TS2307: Cannot find module '@paperclipai/paperclip-runner' or its corresponding type declarations.
src/vendor/paperclip-runner/index.ts(62,10): error TS2307: Cannot find module '@paperclipai/paperclip-runner' or its corresponding type declarations.
src/vendor/paperclip-runner/index.ts(94,20): error TS2307: Cannot find module '@paperclipai/paperclip-runner' or its corresponding type declarations.
src/vendor/paperclip-runner/index.ts(95,13): error TS2307: Cannot find module '@paperclipai/paperclip-runner' or its corresponding type declarations.
src/vendor/paperclip-runner/testing.ts(9,42): error TS2307: Cannot find module '@paperclipai/paperclip-runner/testing' or its corresponding type declarations.
src/vendor/paperclip-runner/testing.ts(21,8): error TS2307: Cannot find module '@paperclipai/paperclip-runner/testing' or its corresponding type declarations.
undefined
/Users/phannhatquang/Documents/Projects/crew/.worktrees/paperclip-r13-session/server:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: tsc --noEmit
```

[Log typecheck](br-1-parent-typecheck.log). Không chạy full suite/E2E; chỉ chạy file test bị sửa và typecheck package server theo luật test tầng. Không push, SSH, thao tác ~/crew-agents hay rm -rf. Tất cả exec đã kết thúc, không giữ dịch vụ nền.

### Phạm vi và giả định

Đúng thay đổi user yêu cầu cho F2: giới hạn session theo cùng parentId khác null. “Cùng agent” giữ cách kiểm task session của executor đang có; không thêm điều kiện assignee hiện tại của A sau review. Không đổi giao thức marker, không thêm hook, bảng hoặc scheduler. Việc bảo vệ marker trước sửa trong cùng một parent (đề xuất rộng hơn trong whole-branch-review) chưa nằm trong yêu cầu sửa này.

Ruling đã append sdd-ledger.md. Không kết luận toàn nhánh R1-3 đã hết các finding khác.


## Sửa 4a.5

Cập nhật: 08/10/2026 17:30:09 (Asia/Ho_Chi_Minh).

**Status: DONE phần fallback session trong phạm vi implementer; chưa nghiệm thu lại AC-3 máy thật.**

- Commit mới: `b1ff97fcce1d705b1a513c90e5dd0e758421d424`, nhánh `crew/r13-session`, trên `2bba0f0ca` (F2).
- Chỉ đổi `server/src/crew/bundle-resume.ts` và thêm `server/src/crew/crew-bundle-resume.cancelled.test.ts`. Không sửa core route/heartbeat, schema, adapter hoặc registry; không thêm hook.
- Checker tại worktree này: **4/5 hook, 8 mục, 0 lỗi**, giống baseline. Nhánh này chưa có hook thứ 5 của nhánh tích hợp; delta hook bằng 0, nên giữ ngân sách 5/5 khi lead tích hợp. Không ghi sai kết quả local thành 5/5.

### Chứng minh theo symbol: session còn ở đâu sau cancellation

| Nguồn | Bằng chứng code và giới hạn |
|---|---|
| `issues.ts::issueRoutes`, PATCH `/:id`, nhánh `assigneeWillChange` (~13400) | Gọi `resolveActiveIssueRun` rồi `heartbeat.cancelRun(..., { errorCode: "issue_reassigned", resultJson: { reassignmentStopConfirmed: true } })` trước khi cập nhật assignee. Workflow handoff có thể đi qua nhánh này. |
| `heartbeat.ts::cancelRunInternal` (~28667) | Đọc run hiện tại, merge `resultJson` với metadata stop, chuyển terminal bằng `setRunStatusFromLive`. Patch cancellation không xóa các cột session đang có. Test gọi chính `heartbeatService.cancelRun`, kiểm run thành `cancelled/issue_reassigned` và không có task-session A. |
| `heartbeat_runs.session_id_before` | `executeRun` (~22631) ghi `runtimeForAdapter.sessionDisplayId ?? sessionId` và context trước dispatch. Có thể còn session đã resume; run đầu mở mới thường null. |
| `heartbeat_runs.session_id_after`, `result_json.sessionId/session_id` | `executeRun::finalRunPatch` (~24837) ghi session sau adapter và result. Claude `execute` (~1125, 1230–1261) lấy ID từ stream/`session_id`, trả `sessionId`, `sessionParams`, `resultJson`. Đây là hai lớp riêng: **không giả định `result_json` chứa toàn bộ `sessionParams`**. Khi terminal write thua cancellation, nhánh `!persistedRun` (~24892) có thể return trước task-session/runtime-state; chỉ một số đường native/process cancellation được phép ghi late metadata. Không khẳng định mọi run hủy đều có after/result. |
| `contextSnapshot.resumeSessionParams` | Context lưu explicit resume từ trước; có thể giữ ID và metadata của session đã resume. Không phải nơi đảm bảo lưu ID mới sinh trong run đầu. `paperclipEnvironment` (~22316) lưu host/port/username/remoteCwd SSH, `paperclipWorkspace` (~22380) lưu cwd/workspace/repo trước dispatch. |
| `agent_runtime_state` | `updateRuntimeState` (~19629), được gọi sau finalization (~25217), có `sessionId/lastRunId` nhưng scope toàn agent. Có thể chưa cập nhật hoặc thuộc issue khác; fallback **không đọc nguồn này**. Test đối chứng đặt runtime session của task khác vẫn không nối. |
| `agent_task_sessions` | `upsertTaskSession` (~25237) nằm sau ghi final run. Chính vì bước này có thể bị bỏ qua, chỉ đọc bảng này làm mất cơ hội resume từ run còn giữ ID. |

Test mô phỏng đúng trạng thái lỗi được giao bằng DB thật: A là issue con done cùng parent/gói, blocker trực tiếp của B, run A của executor đang running, chưa có task session; gọi cancellation thật với `issue_reassigned`, sau đó claim B qua `heartbeatService.resumeQueuedRuns`/`drainActiveRunExecutions`. Adapter được mock để kiểm runtime nhận đúng ID, context `resumeFromRunId` và đúng một activity. Không giả tạo row `agent_task_sessions` cho A trong ca regression. Đây là test cancellation service + claim, không phải chạy lại route workflow/SSH/Claude thật.

### Hành vi sửa

1. Giữ nguyên các cổng F2: B giao đúng agent, cả A/B là con cùng `parentId`, cùng company/gói, blocker trực tiếp, seq A nhỏ hơn B, A done; B chưa có task session và không đè explicit resume.
2. Task session A đúng adapter vẫn ưu tiên. Chỉ fallback khi chính agent chưa có task session A ở **bất kỳ adapter nào**, tránh lách guard khác adapter hoặc row session đã bị clear/không hợp lệ.
3. Tìm đúng **run mới nhất của agent/company trên A**, theo `createdAt DESC, id DESC`, không lọc bỏ `cancelled/issue_reassigned`. Chọn run trước, tìm ID sau; không lùi về run cũ có ID nếu run mới nhất không có ID.
4. Thứ tự nguồn: `sessionIdAfter` → `resultJson.sessionId` → `resultJson.session_id` → `sessionIdBefore` → `contextSnapshot.resumeSessionParams.sessionId`. Chỉ nhận string không rỗng; Claude/Codex phải UUID, Hermes theo canonical pattern của stock; adapter khác dùng opaque nonempty ID.
5. Metadata explicit resume chỉ được giữ khi ID khớp; workspace/SSH lấy từ context của đúng run nguồn. Identity SSH cùng shape với `buildRemoteExecutionSessionIdentity`. Test gọi pure `remoteExecutionSessionMatches`: identity đúng qua, đổi username bị từ chối. Không mở SSH.
6. Patch context queued + audit vẫn dùng transaction/guard sẵn có; không thêm hook hay sửa cách hủy run.

### TDD và kiểm tra

Trước **mỗi** lần chạy test DB đã kiểm `ipcs -m`: có **5/32 segment** trước chạy; không cần `ipcrm`, không gỡ segment nào. Sau suite cuối còn đúng 5 segment ban đầu. `TMPDIR` và `PAPERCLIP_HOME` trỏ vào `tmp/br-1-4a5/` trong worktree để giữ DB/runtime test trong phạm vi được phép.

RED chạy trước khi sửa implementation:

```sh
TMPDIR="$PWD/tmp/br-1-4a5/tmp" PAPERCLIP_HOME="$PWD/tmp/br-1-4a5/paperclip"   corepack pnpm --filter @paperclipai/server exec vitest run   src/crew/crew-bundle-resume.cancelled.test.ts
```

**7 failed, 15 passed**, exit 1: các ca positive nhận null/undefined hoặc skipped thay vì session/applied. Ca không ID, cổng F2 và run mới nhất không ID đã qua. [Log RED](br-1-4a5-red.log).

GREEN cuối, sau thêm đối chứng thứ tự run/task-session/metadata:

```sh
TMPDIR="$PWD/tmp/br-1-4a5/tmp" PAPERCLIP_HOME="$PWD/tmp/br-1-4a5/paperclip"   corepack pnpm --filter @paperclipai/server exec vitest run   src/crew/crew-bundle-resume.cancelled.test.ts   src/__tests__/crew-bundle-resume.test.ts   src/__tests__/crew-claim-resume-contract.test.ts   src/__tests__/crew-core-hooks.test.ts
```

**4 files passed, 64/64 tests passed**, exit 0; 25 test mới + 39 test sẵn có, không skip. [Log GREEN](br-1-4a5-green.log). Các warning connection-tools/policy/SSH timeout trong suite là fixture hoặc mock của test; không có kết nối SSH thật.

`corepack pnpm --filter @paperclipai/server exec tsc --noEmit` → exit 1, **115 diagnostics**, so sánh tập diagnostic với `br-1-typecheck.log`: **thêm 0, bớt 0**, không lỗi ở hai file sửa. Vẫn thiếu declarations `@paperclipai/paperclip-runner` và lỗi nền kéo theo. [Log typecheck](br-1-4a5-typecheck.log).

`node crew/release/check-core-hooks.mjs` → exit 0, hook **4/5**, lỗi 0. [Log hooks](br-1-4a5-hooks.log). `git diff --check` và `git diff --cached --check` đều qua. Không chạy full repo typecheck/test/build vì phạm vi được giao là fallback + ba suite cụ thể, server typecheck đang vướng baseline; không tuyên bố PR-ready toàn repo.

### Concerns / bàn giao lead

- AC-3 lần 3 chứng minh executor CRE-37 có before/after null và không task session. Báo cáo chưa chứng minh có ID trong `result_json`/resume context của chính run đó. Không SSH/query instance thật theo giới hạn task, nên **không tuyên bố run đã quan sát được cứu hay 4a.5 live đã đạt**. Lead cần kiểm nguồn còn lại/rerun AC-3 sau tích hợp.
- Nếu cả các nguồn trên run đều không có ID hợp lệ, fallback trả null và B chạy mới như test đối chứng. Không thể tạo lại ID provider chưa từng được lưu chỉ bằng `findBundlePredecessor`; giữ đúng phạm vi không thêm hook.
- Adapter vẫn giữ kiểm tra identity SSH/cwd/prompt/MCP riêng. Test này chứng minh params tới adapter boundary và identity SSH phù hợp, không chứng minh argv `--resume` trên máy thật.
- Không push/deploy/SSH, không đụng `~/crew-agents`, không dùng `rm -rf`. Report/log để tại plan path được chỉ định, không upload sang dịch vụ ngoài phạm vi filesystem được giao.


## Sửa 4a.5 lần 2

Cập nhật: 08/10/2026 17:42:10 (Asia/Ho_Chi_Minh).

**Status: DONE phần sửa và test trong phạm vi implementer; chưa nghiệm thu lại AC-3 trên máy thật.**

**Summary:** commit `337c6701c61c01ca2fe187e3236efb33f1a4bec7` — `fix(crew): recover cancelled bundle sessions from run logs`, nhánh `crew/r13-session`, base `b1ff97fcc`. Chỉ sửa `server/src/crew/bundle-resume.ts` và `server/src/crew/crew-bundle-resume.cancelled.test.ts`. Không sửa core, adapter, schema hoặc hook registry.

### Đính chính bằng chứng và nguyên nhân theo symbol

Bằng chứng máy thật do user cung cấp bác bỏ khả năng cứu run chỉ bằng các cột trong bản sửa trước: run executor bị `cancelled/issue_reassigned`, cả hai cột session NULL, result không có ID, context không có resume params, không có task-session. ID vẫn tồn tại trong stdout của run log. Kết luận trước rằng thiếu ID trên các cột là hết đường cứu là thiếu nguồn **run log**.

- `heartbeat.ts::executeRun` (~22631) ghi `sessionIdBefore` từ runtime trước dispatch; run mở mới có thể NULL. `runLogStore.begin` (~22711) ghi `logStore/logRef` ngay khi bắt đầu; `onLog` (~22724) append stdout/stderr thành record `{ts, stream, chunk, seq}`. Không cần có provider init trong `heartbeat_run_events`; lifecycle/adapter.invoke ở bảng events không thay thế stdout log.
- `claude-local/src/server/execute.ts::runAttempt` (~975–994) await process rồi mới `parseClaudeStreamJson(proc.stdout)`. `parse.ts::parseClaudeStreamJson` (~70) lấy `session_id` ở `system/init`; `toAdapterResult` (~1126, 1254) mới trả session params/ID về heartbeat. `codex-local/src/server/parse.ts::parseCodexJsonl` (~54) lấy `thread_id` từ `thread.started`. Vì vậy stdout có thể đã lưu init dù adapter chưa trả kết quả để persist session.
- `heartbeat.ts::cancelRunInternal` (~28667) merge metadata stop và chuyển trạng thái qua `setRunStatusFromLive`; không parse stdout và không gọi `upsertTaskSession` để cứu ID mới sinh. Trong `executeRun`, ghi `finalRunPatch` (~24837) dùng điều kiện còn running. Nếu cancellation đã thắng và không đủ điều kiện late metadata write, nhánh `!persistedRun` (~24892–24901) return trước `updateRuntimeState` và `upsertTaskSession` (~25237). Nhánh catch cũng return khi ghi failure thua trạng thái terminal (~25479–25493). Có ngoại lệ late write cho native/owned process cancellation, nên không khẳng định mọi cancellation đều mất session. Hình dạng dữ liệu thật chứng minh đường persist session không hoàn tất, nhưng không tự suy ra chính xác stack trace của hai run từ các cột NULL.
- `services/run-log-store.ts::getRunLogStore().read` dùng `logRef`, đọc range từ file qua stat, có fallback storage do store quản lý. Không phụ thuộc `heartbeat_runs.logBytes` hay `finalize`. Đây cũng là API store mà `heartbeatService.readLog` (~29375) dùng để phục vụ GET log; Crew gọi trực tiếp API store, không gọi HTTP vòng lại hoặc đọc file production bằng fs.
- `context.paperclipEnvironment` (~22316) lưu SSH host/port/username/remoteCwd trước dispatch; `paperclipWorkspace` (~22380) lưu cwd/workspace/repo. Giữ cách dựng metadata như b1ff97f là đúng; không suy đoán từ cấu hình agent hiện tại hay runtime state toàn agent.

### Hành vi cuối

1. Giữ nguyên mọi điều kiện F2: B được giao đúng executor và chưa có task-session riêng/explicit resume; A done, blocker trực tiếp, cùng company, cùng parent khác NULL, cùng bundle, seq nhỏ hơn. A có thể đang được giao reviewer sau handoff. Task-session A đúng adapter vẫn ưu tiên; row A khác adapter/đã clear không bị lách bằng log.
2. Fallback chọn **run mới nhất của đúng company/agent trên A** trước khi tìm ID, theo `createdAt DESC, id DESC`. Không tìm lại log của run cũ khi run mới nhất thiếu ID; run reviewer không che run executor.
3. Thứ tự nguồn: after → result.sessionId/session_id → **init trong log** → before → resume params cũ. Giữ các cột vì vẫn có ích cho run đã persist kết quả hoặc đang resume; init mới ưu tiên hơn ID đầu vào khi CLI mở session mới. Chỉ giữ metadata resume cũ khi ID khớp.
4. Log chỉ áp dụng cho `claude_local` (`system/init.session_id`) và `codex_local` (`thread.started.thread_id`), UUID hợp lệ. Chỉ đọc stdout; không bắt ID trong lời assistant, stderr hoặc event của adapter khác. `logRef` phải đúng đường dẫn company/agent/run mà `begin` tạo.
5. Parser ghép hai lớp: record NDJSON của store qua các page, và dòng JSON provider qua các chunk stdout, kể cả stderr xen kẽ. Đọc page 256.000 byte, tối đa prefix 4 MiB; dừng khi tìm được init hợp lệ đầu tiên. JSON init hoàn chỉnh ở EOF không bắt buộc newline cuối. Không có init hợp lệ, log thiếu/hỏng hoặc lỗi đọc thì trả null, không throw; với hình dạng thật không có nguồn cột thì B mở session mới.
6. Session phục hồi vẫn mang cwd/workspace/repo và identity SSH của chính context run A. Transaction patch queued + audit giữ nguyên; không thêm hook hay sửa cancellation.

### TDD và validation

Fixture DB dùng PostgreSQL thật, file log thật do `getRunLogStore().begin/append` tạo; **không gọi finalize**. A là issue con done đã giao reviewer; run A của executor được hủy bằng API `heartbeat.cancelRun(... issue_reassigned ...)`. Khẳng định before/after NULL, result không có sessionId/session_id, context không resume params, logStore local_file, logBytes NULL, task-session A không tồn tại. Claim B dùng `resumeQueuedRuns` → `drainActiveRunExecutions`; adapter được mock để kiểm đúng một invocation với session ID, run succeeded, resume context và đúng một audit. Đây là test dữ liệu máy thật + cancellation/claim API, không phải chạy CLI/SSH thật.

**RED trước sửa production:** 4 failed / 31 passed, exit 1. Hai ca Claude/Codex nhận NULL thay vì UUID; ca metadata SSH nhận skipped; ca chọn executor từ log nhận undefined. Đối chứng log thiếu init/hỏng đã qua. [Log RED](br-1-4a5-2-red.log).

```sh
TMPDIR="$PWD/tmp/br-1-4a5-2/tmp" PAPERCLIP_HOME="$PWD/tmp/br-1-4a5-2/paperclip" \
  corepack pnpm --filter @paperclipai/server exec vitest run \
  src/crew/crew-bundle-resume.cancelled.test.ts
```

**GREEN toàn bộ bộ test yêu cầu + regression:** 4 files passed, 74/74 passed, 0 skipped, exit 0. [Log GREEN](br-1-4a5-2-green.log).

```sh
TMPDIR="$PWD/tmp/br-1-4a5-2/tmp" PAPERCLIP_HOME="$PWD/tmp/br-1-4a5-2/paperclip" \
  corepack pnpm --filter @paperclipai/server exec vitest run \
  src/crew/crew-bundle-resume.cancelled.test.ts \
  src/__tests__/crew-bundle-resume.test.ts \
  src/__tests__/crew-claim-resume-contract.test.ts \
  src/__tests__/crew-core-hooks.test.ts
```

Sau đó chỉ mở rộng fixture/test, không đổi production: khởi tạo agent đúng Claude/Codex ngay từ trước cancellation, thêm biên page/EOF, ưu tiên init so với before, final result ưu tiên, stderr/logRef khác run, giới hạn đọc, chạy toàn bộ 9 cổng F2 với cả nguồn cột và log. Chạy lại file regression theo lệnh RED: **48/48 passed**, exit 0. [Log ca biên GREEN](br-1-4a5-2-edge-green.log). Cùng 39 ca của ba suite không đổi đã qua, tổng **87 ca** được kiểm chứng; không trình bày đây là một lượt 87 ca duy nhất.

`corepack pnpm --filter @paperclipai/server exec tsc --noEmit` ở trạng thái cuối → exit 1, **115 diagnostics**, so với `br-1-4a5-typecheck.log`: thêm 0/bớt 0. Không có diagnostic trong hai file sửa. Lỗi baseline thiếu declarations paperclip-runner và các lỗi kéo theo. [Log typecheck](br-1-4a5-2-typecheck.log).

`node crew/release/check-core-hooks.mjs` → exit 0, **Hook một dòng: 4/5; mục: 8; lỗi: 0**, đúng baseline của worktree này; delta hook = 0. Nhánh này không có hook thứ năm của nhánh tích hợp; không sửa core để biến kết quả local thành 5/5. Bản sửa không tiêu thêm ngân sách hook của bản tích hợp 5/5. [Log hooks](br-1-4a5-2-hooks.log).

`git diff --check` và `git diff --cached --check` qua trước commit. Trước mỗi lượt DB đều kiểm `ipcs -m`: **5/32 segment**; sau lượt cuối vẫn đúng 5 segment gốc. Không chạy ipcrm. TMPDIR/PAPERCLIP_HOME và log fixture đều nằm trong `tmp/br-1-4a5-2/` của worktree. Helper đã cleanup DB. Không chạy full repo typecheck/test/build hoặc browser E2E vì phạm vi chỉ fallback và các suite yêu cầu, typecheck server còn lỗi baseline; không tuyên bố PR-ready toàn repo.

### Concerns

- Chưa chạy lại AC-3/Claude/SSH trên máy thật. Test chứng minh params tới adapter và pure `remoteExecutionSessionMatches` đúng host/user/cwd; CLI còn có các kiểm tra cwd/prompt/MCP/credential riêng.
- Fallback log lấy init hợp lệ đầu tiên trong prefix 4 MiB. Nếu init nằm ngoài giới hạn, file mất/chưa ghi đủ init, hoặc chỉ có protocol khác stream-json/JSONL, không suy đoán ID và mở mới khi không còn nguồn cột hợp lệ. Không phục hồi được transcript provider đã mất trên máy executor.
- Cần lead xác nhận lại AC-3 sau tích hợp commit; không còn lý do bắt buộc sửa core cho hình dạng dữ liệu được cung cấp.
- Không push/deploy/SSH, không `rm -rf`, không sửa ngoài worktree và thư mục reports được giao. Report/log giữ ở đường dẫn được user yêu cầu, không upload ra dịch vụ ngoài phạm vi.

## Sửa 4a.5 lần 3

Ngày 08/10/2026, Asia/Ho_Chi_Minh. **Status: DONE phần sửa và kiểm chứng local; chưa nghiệm thu lại AC-3 máy thật.**

**Summary:** Commit `b485fc926014186a406e63fe41a526d8cb6c3729` — `fix(crew): restore MCP identity for recovered bundle sessions`, trên `crew/r13-session`, parent `337c6701c`. Chỉ sửa `server/src/crew/bundle-resume.ts` và `server/src/crew/crew-bundle-resume.cancelled.test.ts`. Dùng cách B được giao: bổ sung MCP identity vào params Claude phục hồi từ run khi trường đó thiếu/rỗng. Không sửa lõi/adapter, không thêm hook. Worktree sạch sau commit.

### Lần theo symbol và quyết định nguồn identity

- `server/src/services/heartbeat.ts:4485`, `buildPaperclipRuntimeMcpServers`: đọc `toolAccessService.getEffectiveProfilesForAgent`, identity/responsible user của run, lọc installed/permitted/healthy connections và allowed tools. Khi không có connection vẫn ghi delivery diagnostic; khi có thì có thể tạo profile/gateway và mint token bằng `createNamedGatewayToken`. Đây không phải hàm thuần chỉ đọc danh sách identity.
- `heartbeat.ts:24243`, nhánh legacy trong `executeRun`: sau builder trên, thêm `Paperclip connections` khi có runtime tools và adapter chọn `native_mcp`; thêm `Paperclip projects` khi có auth token, configured API URL và issue. Thứ tự cuối là projects → connections → assigned gateway (nếu có). `createAdapterRuntimeMcpAccess` tại dòng4787 chỉ đóng băng/copy snapshot đã có; `getServers` tại4793 trả danh sách ấy.
- Như vậy không có resolver thuần sẵn có trả **đầy đủ đúng danh sách** tại claim. Gọi builder tại claim vừa tạo tác dụng phụ, vừa thiếu hai mục được thêm ở dispatch; sao chép điều kiện lắp danh sách vào Crew sẽ tạo nguồn thứ hai dễ lệch. Không chọn cách A.
- `packages/adapters/claude-local/src/server/execute.ts:554` tính `JSON.stringify(runtimeMcpServers.map(({ name, url, connectionId }) => ({ name, url, connectionId })))`, lưu vào session params tại1153. Token không thuộc identity. Dùng nguyên chuỗi đã lưu từ task-session cùng company/agent/adapter là fallback B; không tự chuẩn hóa/sắp lại JSON hay mang credential sang B. Bằng chứng lead rằng identity ổn định hỗ trợ fallback này, nhưng không coi đó là invariant vĩnh viễn của mọi cấu hình.

### Hành vi và các guard còn lại

`sessionFromRun(db, run, adapterType)` vẫn chọn UUID và lấy metadata theo các nguồn đã có. Chỉ với `claude_local` thiếu/rỗng `mcpServerIdentity`, truy vấn `agent_task_sessions` của **chính company, agent, adapter**, lọc JSON string có ký tự khác whitespace, sắp `updated_at DESC, id DESC`, lấy một row. Copy duy nhất `mcpServerIdentity`; không ghi đè identity đã có của session A. Không có nguồn hợp lệ thì không đoán identity. Các session đã lưu trên A, session riêng/explicit resume của B và mọi cổng F2 giữ nguyên.

| Guard của `canResumeSession` | Nguồn/kiểm chứng |
|---|---|
| UUID hợp lệ | Init log hoặc cột/result/resume của run A theo ưu tiên cũ; không lấy UUID task khác. |
| `mcpServerIdentity` | Bổ sung theo fallback trên. Adapter tiếp tục so khớp chính xác với danh sách hiện tại; MCP đổi vẫn mở mới. |
| `promptBundleKey` | Thiếu/rỗng được guard chấp nhận. Chỉ giữ key đã biết thuộc UUID A; không mượn key task khác. |
| `cwd` | Lấy `paperclipWorkspace.cwd` của A. `claudeSessionCwdMatchesExecutionTarget` chấp nhận cwd rỗng và chấp nhận host cwd khác remote cwd khi chạy remote; local cwd đã có phải khớp target. |
| `remoteExecution` | Giữ identity SSH từ `paperclipEnvironment` của A (host/port/username/remoteCwd/transport); `adapterExecutionTargetSessionMatches` thật chấp nhận target đúng, từ chối đổi host. Không lấy remote identity của task khác. |

Với hình dạng AC-3 lần4, không thiếu thêm trường bắt buộc nào ngoài MCP. Không cần sửa guard hoặc điền prompt/cwd/remote bằng cấu hình hiện tại để ép resume. Local không cần remote identity; sandbox identity/lease khác vẫn chịu guard stock và không được giả lập bằng metadata task khác.

### TDD và bằng chứng

**RED trước sửa production:** 53 ca, **4 failed / 49 passed**, exit1. Hai ca claim (nguồn log/cột) thiếu MCP identity, ca lọc nguồn thiếu identity, và ca gọi adapter thật không có `--resume`. [Log RED](br-1-4a5-3-red.log).

Fixture log dùng PostgreSQL embedded thật và `getRunLogStore().begin/append` ghi local_file thật, chưa finalize. A done sau handoff, run executor A bị hủy qua `heartbeat.cancelRun` với `issue_reassigned`; before/after NULL, result không session ID, không task-session executor trên A. Một task-session **khác task** của executor mang MCP identity cùng metadata cố tình khác (UUID, cwd, prompt, SSH). `resumeQueuedRuns` → `drainActiveRunExecutions` chứng minh B có `resumeFromRunId=A`, UUID init A và MCP identity đúng, audit đúng một lần; metadata task khác không bị sao chép.

Test adapter import trực tiếp `execute` từ `@paperclipai/adapter-claude-local/server`; `canResumeSession` là biến cục bộ không export nhưng chạy thật qua `execute`. Chỉ provider CLI là script Node cục bộ do test tạo. Hai MCP fixture dùng đúng phép stringify của adapter; token ở invocation đổi để chứng minh token không ảnh hưởng identity. Params do `applyBundleResume` dựng được truyền thẳng vào `execute`:

- Khớp: đúng một invocation có `--resume <UUID A>` và kết quả giữ `sessionId=UUID A`, không phải null.
- Đối chứng: bỏ MCP, đổi MCP, đổi local cwd, đổi prompt key, thêm remote identity không khớp local target đều không phát `--resume`.
- SSH dùng trực tiếp hai hàm guard stock nêu trên, không mở SSH. Không tuyên bố đây là chạy Claude thật trên máy executor.
- Test nguồn kiểm row mới nhất không rỗng, bỏ null/blank/number/object/array, bỏ company/agent/adapter khác; identity đã có của A không bị ghi đè.

**GREEN:** cả 4 file yêu cầu, **92/92 passed, 0 skipped**, exit0. [Log GREEN](br-1-4a5-3-green.log).

```sh
ipcs -m
TMPDIR="$PWD/tmp/br-1-4a5-3/tmp" PAPERCLIP_HOME="$PWD/tmp/br-1-4a5-3/paperclip" \
  corepack pnpm --filter @paperclipai/server exec vitest run \
  src/crew/crew-bundle-resume.cancelled.test.ts \
  src/__tests__/crew-bundle-resume.test.ts \
  src/__tests__/crew-claim-resume-contract.test.ts \
  src/__tests__/crew-core-hooks.test.ts
```

Lượt RED dùng cùng env và chỉ file cancelled. Trước mỗi lượt DB kiểm `ipcs -m`: **5/32 segment**. Sau GREEN vẫn đúng 5 segment gốc (`131072`, `131073`, `131074`, `129236995`, `786463`); không dùng `ipcrm`. DB/helper và CLI fixture dùng đường dẫn trong worktree; không `rm -rf`, không push/deploy/SSH.

`corepack pnpm --filter @paperclipai/server exec tsc --noEmit` exit1: **115 diagnostics**, so với `br-1-4a5-2-typecheck.log` thêm0/bớt0, không lỗi trong hai file sửa. Baseline thiếu declarations paperclip-runner và lỗi kéo theo. [Log typecheck](br-1-4a5-3-typecheck.log).

`node crew/release/check-core-hooks.mjs` exit0: **Hook một dòng: 4/5; mục: 8; lỗi: 0**, đúng baseline của HEAD337c670. Nhánh session chưa có hook thứ5 của nhánh tích hợp; delta hook bằng0 nên không tăng ngân sách5/5 khi tích hợp. Không sửa core để thay đổi con số này. [Log hooks](br-1-4a5-3-hooks.log). `git diff --check` và `git diff --cached --check` qua trước commit.

### Concerns

- Cần lead chạy lại AC-3 4a.5 trên máy thật sau tích hợp. Test này chứng minh guard adapter chấp nhận params phục hồi, không chứng minh transcript provider còn tồn tại hoặc Claude thật đã resume trên SSH.
- Fallback phụ thuộc task-session trước đó của cùng executor có MCP identity. Chưa có nguồn ấy hoặc danh sách/URL/order MCP hiện tại thay đổi thì adapter vẫn có thể mở mới; guard không bị nới lỏng. Đây là giới hạn cách B đã được giao.
- Không chạy full repo typecheck/test/build hoặc browser E2E: thay đổi hẹp trong Crew đã chạy đủ suite yêu cầu; typecheck server còn lỗi baseline. Không tuyên bố PR-ready toàn repo hay AC-3 đạt.
- Report/log nằm trong thư mục reports được chỉ định; không publish/upload ra dịch vụ ngoài phạm vi.

### Bổ sung fallback identity cấp company

MCP identity được dùng chung ở cấp company: `sessionFromRun` ưu tiên session mới nhất của chính agent trong cùng company/adapter, rồi mới fallback sang agent bất kỳ cùng company và cùng adapter.
Guard adapter vẫn đối chiếu identity hiện tại, nên MCP đổi thì không resume; không truy vấn chéo company hoặc adapter.
DB test mới xác nhận executor không có task session nhận identity từ agent khác cùng company/adapter, đồng thời bỏ qua identity mới hơn của agent thuộc company khác.
Đã kiểm tra `ipcs -m` trước test: 5/32 segment, không cần dọn SysV segment.
