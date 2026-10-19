# Báo cáo RR-3 — sửa L1, L4 từ nghiệm thu AC-2

- Worktree `.worktrees/paperclip-r12-retry`, nhánh `crew/r12-retry`, fast-forward lên `crew/r1-2` (`3bbdd554a`) trước khi sửa (nhánh retry đã là tổ tiên của `crew/r1-2`, không có merge commit).
- Commit: **`edbca2b3f`** — `fix(crew): release the lease before stopping remote work and cancel held runs as never started`.

## File đổi

- `server/src/crew/remote-stop.ts`: `REMOTE_STOP_BACKGROUND_LIMIT_MS = 20_000`, `startRemoteStopOnRelease`, `isRemoteStopPending`, `settleRemoteStopsForTests`.
- `server/src/crew/core-hooks.ts`: implementation của `onRunLeaseReleased` gọi `startRemoteStopOnRelease(input)` (không `await`), sửa doc. File thuộc gói `policy`; lead cho phép sửa `server/src/crew/**`. Dòng hook trong `environment-runtime.ts` và `core-hooks.json` không đổi, `check-core-hooks.mjs`: `Hook một dòng: 4/5; mục: 8; lỗi: 0`.
- `server/src/crew/load-gate.ts`: dep `remoteStopPending`; `evaluateBeforeClaim` giữ claim (không ghi mốc) khi environment còn lệnh dừng chạy; `scheduleCancel` mặc định hủy kèm `neverStartedCancelOptions`.
- Test mới: `server/src/__tests__/crew-remote-stop-release.test.ts` (5), `server/src/__tests__/crew-load-gate-cancel.test.ts` (3, embedded PG). Sửa `server/src/__tests__/crew-load-gate.test.ts` (+1 test, dep mới trong harness).

## L1 — nguyên nhân và cách sửa

Thứ tự cũ: `createSshEnvironmentDriver.releaseRunLease` = `await crewCoreHooks.onRunLeaseReleased(...)` (H3, SSH dừng process khoảng 5 giây) rồi mới `environmentsSvc.releaseLease(...)`. Trong 5 giây đó, `getConversationOwnershipBlocker` thấy run `cancelled` có lease `releasedAt is null` nên trả `execution_owner_active` ("has not released its environment lease"). Wake `assignment` của participant kế tiếp bị `recordExecutionWait` ghi `skipped`. Stock chỉ `resumeExecutionWaitComments` cho wait do user yêu cầu, nên wake hệ thống mất hẳn.

Sửa: H3 khởi động lệnh dừng chạy nền rồi trả về ngay, lease được nhả liền sau đó. Kết quả dừng vẫn ghi `crew.remote_stop` như cũ; lỗi SSH ghi `unreachable`/`failed`; quá 20 giây thì ghi `unreachable` "lệnh dừng chưa xong sau 20 giây" và bỏ dấu đang dừng. Hợp đồng R1-1 giữ nguyên:
- Process run cũ vẫn bị dừng ngay khi lease nhả, xong trong ngân sách SSH 12 giây (dưới 30 giây hủy run).
- Không chạy song song: khi còn lệnh dừng trên một environment, cổng tải giữ mọi claim trên environment đó (`remoteStopPending`). ~~Khi server restart, reaper nhả lease thì H3 chạy lại trong process mới~~ — **câu này sai** (review sau AC-2, A2): lease đã nhả trước khi SSH xong nên sau restart H3 không chạy lại. Đã sửa ở mục "Sửa sau review AC-2": dấu đang dừng nằm trong DB. Retry còn có bước dừng run trước trong lệnh kiểm tiến độ (RR-2).

Test tái hiện thứ tự (`crew-remote-stop-release.test.ts`, đi qua `sshDriver().releaseRunLease` thật, mock SSH/DB/activity): `releaseLease` được gọi trong khi SSH còn treo; trong lúc đó `isRemoteStopPending` = true; SSH xong thì activity `stopped` và dấu bị bỏ; SSH lỗi 255 thì `unreachable`; SSH treo thì ở 19 999 ms còn dấu, tới 20 000 ms có activity hết giờ; lease không gắn run thì không SSH.

## L4 — nguyên nhân và cách sửa

Tái hiện bằng đường stock trên embedded PG (wake thật → run `queued` bị giữ → `cancelRun`):
- Run thường, hoặc retry lần 1, bị hủy khi đang giữ: không có recovery action, wake sau tạo run. Đạt.
- Retry có `scheduledRetryAttempt = 2` (`transient_failure`): `legacyExecutionNeedsReconciliation` trả `true` vì `executionFailureRetryCount(run) >= 2` được kiểm **trước** chỗ miễn bằng chứng `bootstrap`/`providerWorkStarted: false` (stock tự gắn khi hủy run `queued`). `terminalizeLegacyExecution` tạo recovery action `legacy_execution_requires_reconciliation` trỏ tới run chưa từng chạy, nên wake sau bị `skipped` `execution_reconciliation_required`. Lời nhắn của owner đi `admitExplicitNativeContinuation` thì bị chặn ở `process_identity_missing`: run không có pid/pgid, `errorCode` không phải `execution_reconciliation_required` (`unusedAdmission`), adapter không phải `paperclip_runner` (`isCancelledNativeStartup`). Khớp triệu chứng CRE-21.
- Với adapter hội thoại, stock tự thêm `conversationContinuation: continue_conversation_v1` cho run hủy khi việc dừng đã được xác nhận (`mergeRunStopMetadataForAgent`), và `legacyExecutionNeedsReconciliation` coi chính sách đó là "lượt mới, agent tự quyết phần còn lại", không giữ đối soát. Run mà cổng tải giữ chưa từng có process, nên việc dừng của nó coi như đã được xác nhận, nhưng stock không biết điều đó.

Sửa: khi cổng tải tự hủy run hết hạn chờ (`scheduleCancel`), nếu run vẫn `queued`, chưa `startedAt`, không pid/pgid và adapter là adapter hội thoại, thì `cancelRun` được gọi kèm `resultJson: { executionCancellation: { state: "acknowledged", proof: "crew_load_gate_never_started" }, conversationContinuation: "continue_conversation_v1" }`. Adapter khác giữ nguyên stock.

Test (`crew-load-gate-cancel.test.ts`, cổng thật hết hạn qua `resumeQueuedRuns`): retry `claude_local` lần 2 → run `cancelled`, `startedAt` null, `resultJson` có hai khóa trên, không có recovery action, `getExecutionBlocker` = null, wake sau tạo run và không có wakeup `execution_reconciliation_required`; run thường không hold; adapter `process` không bị gắn chính sách.

## Lệnh test

RED (test mới trên nguồn `3bbdd554a`):

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-remote-stop-release.test.ts src/__tests__/crew-load-gate.test.ts src/__tests__/crew-load-gate-cancel.test.ts
  × retry đã hết lượt của adapter hội thoại: hủy không sinh hold đối soát, đánh thức sau vẫn tạo run
  × holds the run without probing while a stop of the previous run is still running on that host
  × nhả lease trước khi lệnh dừng qua SSH xong, rồi mới ghi kết quả dừng
  × SSH lỗi thì ghi activity unreachable và bỏ dấu đang dừng
  × lệnh dừng treo quá giới hạn thì bỏ dấu đang dừng và ghi activity hết giờ
  (cùng 3 test khác: thiếu export / lỗi helper test, đã sửa helper trước khi viết mã)
```

GREEN:

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts src/__tests__/crew-load-gate-cancel.test.ts src/__tests__/crew-remote-stop-release.test.ts src/__tests__/crew-retry-progress.test.ts src/__tests__/crew-before-claim.test.ts src/__tests__/crew-remote-stop.test.ts src/__tests__/crew-core-hooks.test.ts src/__tests__/environment-runtime.test.ts src/__tests__/environment-runtime-driver-contract.test.ts src/__tests__/heartbeat-run-terminalize-before-release.test.ts src/services/legacy-execution-recovery.test.ts src/__tests__/heartbeat-retry-scheduling.test.ts
 Test Files  12 passed (12)
      Tests  261 passed (261)
corepack pnpm --filter @paperclipai/server exec tsc --noEmit   # exit=0
node crew/release/check-core-hooks.mjs                          # Hook một dòng: 4/5; mục: 8; lỗi: 0
```

Test stock lân cận chọn theo symbol: `releaseRunLease` (environment-runtime, driver-contract, terminalize-before-release), `legacyExecutionNeedsReconciliation`/`executionFailureRetryCount` (legacy-execution-recovery, retry-scheduling).

## Giả định và chỗ còn hở

- **L4 — chưa đọc DB spike:** em không truy cập server spike. Nguyên nhân được chứng minh bằng tái hiện, với giả định run `bbd9bdec` là retry đã hết lượt (`scheduled_retry_attempt >= 2`) và bị **cổng tải** hủy khi hết hạn chờ (ngưỡng 8, tải 15–87). Cần kiểm ở AC-2: `select scheduled_retry_attempt, scheduled_retry_reason, error_code, result_json from heartbeat_runs where id::text like 'bbd9bdec%'` và `select cause, evidence from issue_recovery_actions where source_issue_id = '4471d9f1-e932-4aa3-9fe4-2b21053eb9b2'`. Nếu run đó bị **stock** hủy (đổi assignee, đổi status) thì sửa này không phủ (xem ruling); issue kẹt kiểu đó gỡ bằng `POST /issues/:id/recovery-actions/resolve` (board).
- **L1 — còn khe hở rất ngắn do stock:** lease được nhả ở `finally` của `executeRun` (`releaseEnvironmentLeasesForRun`), chạy độc lập với route `PATCH` (route `await cancelRun` rồi đánh thức). Bỏ 5 giây SSH thu khe hở từ khoảng 5 giây xuống vài thao tác DB, nhưng thứ tự vẫn không được đảm bảo tuyệt đối. Không đóng được trong `server/src/crew/**` mà không thêm hook lõi. AC-2 cần chạy lại luồng chuyển stage để đo.
- Giữ claim khi còn lệnh dừng chỉ áp cho environment có `crewLoadGate` (H1 chỉ biết environment qua `loadTarget`). Ba environment Mac mini đều có.
- ~~Lệnh dừng chạy nền mất nếu process server thoát giữa chừng. Trường hợp này giống bản cũ: hook cũ cũng không còn ai chờ, và khi restart, reaper nhả lease nên H3 chạy lại.~~ **Sai** (A2): lease đã nhả nên không có H3 lần hai. Xem "Sửa sau review AC-2".

## L4 ca thật

Lead đọc DB spike: run `bbd9bdec…` có `scheduled_retry_attempt=0`, `status=cancelled`, `error_code=issue_continuation_waiting_on_review`, `result_json.timeoutSource=stale_queued_run_gate`. Giả định ở trên (retry ≥ 2, cổng tải hết hạn) **sai**: stock stale gate đã hủy run còn `queued` mà cổng tải đang giữ, vì issue đang chờ review. Sửa trong commit **`d95c9a88d`** — `fix(crew): mark runs held by the load gate as never started` (trên `edbca2b3f`). File: `server/src/crew/load-gate.ts`, `server/src/__tests__/{crew-load-gate,crew-load-gate-cancel}.test.ts`.

**Nguyên nhân (theo symbol):**
1. `run-dispatch/adapters/postgres.ts` `cancelStaleRunInTx` (`timeoutSource: "stale_queued_run_gate"`): ghi `cancelled` + `errorCode` của quyết định (`issue_continuation_waiting_on_review`), giữ `...parseObject(run.resultJson)`, **không** thêm `executionRecovery: { kind: "bootstrap", providerWorkStarted: false }`. Khác `heartbeat.ts` `setRunStatus`/`setRunStatusFromLive`: hai hàm này tự thêm bằng chứng đó khi hủy run `queued` chưa `startedAt`/pid.
2. `recovery/service.ts` `reconcileStrandedAssignedIssues`: lấy run nguồn của issue và gọi `legacyExecutionNeedsReconciliation(source)`. Run đó `cancelled`, không có bằng chứng `bootstrap`, `executionFailureRetryCount = 0`, nên rơi xuống dòng cuối `return !(bootstrap && !started)` = `true` → `terminalizeLegacyExecution` → recovery action `legacy_execution_requires_reconciliation` trỏ tới run chưa từng chạy.
3. `explicit-native-continuation.ts` `admitExplicitNativeContinuation`: run nguồn không có pid/pgid; không phải `unusedAdmission` (đòi `errorCode = execution_reconciliation_required`); không phải `isCancelledNativeStartup` (chỉ cho `paperclip_runner`); chưa có `hasNativeLocalProcessStop` → `process_identity_missing`. Hold không gỡ được bằng lời nhắn, nên mọi wake bị `skipped`.

Stock thường không gặp ca này vì run `queued` được claim ngay; cổng tải giữ run hàng chục phút nên stale gate mới kịp hủy nó.

**Sửa (không đụng lõi):** mỗi khi cổng tải giữ một run (`evaluateBeforeClaim` trả `true`), run được gắn đúng bằng chứng stock `resultJson.executionRecovery = { kind: "bootstrap", providerWorkStarted: false, heldBy: "crew_load_gate" }`. Chỉ gắn khi run còn `queued`, chưa `startedAt`/pid và chưa có `executionRecovery`; ghi một lần. Như vậy mọi đường hủy của stock (stale gate giữ `resultJson`; `cancelRun` vốn tự gắn) đều thấy run là "chưa bắt đầu", và `legacyExecutionNeedsReconciliation` trả `false` (với `executionFailureRetryCount < 2`).
- Khi cổng tải cho claim, dấu được xóa trước (chỉ xóa khi `heldBy = crew_load_gate`), kể cả khi environment không còn `crewLoadGate`. Xóa lỗi thì giữ run `queued`. Nếu cổng tự lỗi mà run còn mang dấu, `crewBeforeClaim` cũng giữ run. Nhờ vậy run đã thật sự chạy không bao giờ mang dấu "chưa bắt đầu".
- Ghi dấu lỗi thì chỉ log, run vẫn bị giữ.
- Bản sửa ca retry ≥ 2 khi cổng tải tự hủy (`neverStartedCancelOptions`) **giữ nguyên**: dấu `bootstrap` không phủ được ca đó, vì stock kiểm số lần thử lại trước.

**Test tái hiện ca thật** (`crew-load-gate-cancel.test.ts`, embedded PG):
- Wake stock tạo run; một tick cổng tải thật (Mac không vào được) giữ run `queued`.
- Hủy bằng đúng phép ghi của `cancelStaleRunInTx` (`errorCode issue_continuation_waiting_on_review`, `timeoutSource stale_queued_run_gate`, giữ `resultJson`, bỏ khóa thực thi issue).
- Chạy `heartbeatService(db).reconcileStrandedAssignedIssues()` thật. Kỳ vọng: không có action `legacy_execution_requires_reconciliation`, `getExecutionBlocker` = null, wake sau tạo run.
- Thêm: run được cổng cho chạy thì `resultJson` lúc claim không còn `executionRecovery`, và adapter được gọi đúng một lần.
- Unit test: gắn dấu một lần; gắn lỗi vẫn giữ run; xóa trước khi claim; xóa lỗi thì giữ run; environment hết gate vẫn xóa; `crewBeforeClaim` lỗi mà run có dấu thì giữ run.

Phép hủy trong test là bản sao phép ghi của stale gate, không gọi `decideQueuedRunStaleness`, vì dựng đủ trạng thái "issue chờ review" (execution policy, stage, participant) quá nặng cho test tầng này. AC-2 kiểm trên máy thật.

RED (test mới trên `edbca2b3f`):

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate-cancel.test.ts
  × stock stale gate hủy run đang chờ máy (issue chờ review): recovery không sinh hold, đánh thức sau vẫn tạo run
      AssertionError: expected [ { …(26) } ] to deeply equal []      # có action legacy_execution_requires_reconciliation
  × run được cổng tải cho chạy thì bỏ dấu chưa bắt đầu trước khi claim
      Tests  2 failed | 3 passed (5)
```

GREEN:

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts src/__tests__/crew-load-gate-cancel.test.ts src/__tests__/crew-remote-stop-release.test.ts src/__tests__/crew-retry-progress.test.ts src/__tests__/crew-before-claim.test.ts src/__tests__/crew-remote-stop.test.ts src/__tests__/crew-core-hooks.test.ts src/services/legacy-execution-recovery.test.ts src/__tests__/heartbeat-retry-scheduling.test.ts src/__tests__/heartbeat-run-terminalize-before-release.test.ts
 Test Files  10 passed (10)
      Tests  173 passed (173)
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/disposition-repair.test.ts src/__tests__/heartbeat-process-recovery.test.ts src/modules/run-dispatch/adapters/postgres.test.ts src/modules/run-dispatch/domain/policy.test.ts   # theo symbol stale_queued_run_gate / issue_continuation_waiting_on_review
 Test Files  4 passed (4)
      Tests  389 passed (389)
corepack pnpm --filter @paperclipai/server exec tsc --noEmit   # exit=0
```

**Còn hở:** retry có `executionFailureRetryCount >= 2` mà bị **stock** hủy (stale gate, đổi assignee) lúc đang chờ ở cổng tải vẫn sinh hold. Stock kiểm số lần thử lại trước bằng chứng `bootstrap`, nên muốn phủ thì phải gắn `conversationContinuation` lên run đang `queued`; em không làm vì nó đổi cách stock xử lý run đó. Ca này gỡ bằng `POST /issues/:id/recovery-actions/resolve`.


## Sửa sau review AC-2

Review: mục "Review sau AC-2" của [rr-review.md](rr-review.md) (A1 critical, A2, A3 major; b1–b3 minor). Sửa trong commit **`54a819878`** — `fix(crew): let stock cancel stale held runs before the marker goes and persist pending stops` (trên `d95c9a88d`). File: `server/src/crew/{load-gate,remote-stop,core-hooks}.ts`, `server/src/__tests__/{crew-load-gate,crew-load-gate-cancel,crew-remote-stop-release}.test.ts`.

| Mục | Sửa |
|---|---|
| A1 | Chọn (a), dùng chính stock. Khi cổng định cho claim, `releaseHeld` đọc DB. Nếu run còn dấu `heldBy=crew_load_gate`, cổng gọi `createRunDispatch(db).cancelStaleQueuedRun({ expectedStatus: "queued" })`: đúng hàm stale gate mà `claimQueuedRun` gọi ngay sau H1, chạy dưới `withIssueThenRunLocks`. Stale thì stock tự hủy run trong lúc dấu `bootstrap` còn nguyên; cổng phát sự kiện `heartbeat.run.status` như `applyRunDispatchPostCommitEffects` và trả `true` (`claimQueuedRun` trả `null`). Không stale thì UPDATE xóa dấu rồi trả `false`, sau đó stock chạy lại stale gate như thường. Hàm đánh giá chỉ đọc (`decideCurrentRunStaleness`) không được export nên không dùng. |
| A2 | `startRemoteStopOnRelease` ghi activity `crew.remote_stop.started` (`details.environmentId`, `runId`) **trước** khi SSH; hook `await` bước ghi này (một INSERT) rồi mới trả về, nên dấu có trước khi lease nhả. Activity kết quả `crew.remote_stop` giờ luôn được ghi (cả `stopped matched=0`), để đóng dấu. `remoteStopPending` = cache bộ nhớ hoặc truy vấn DB: có `started` cho environment trong `REMOTE_STOP_PENDING_WINDOW_MS = 120 000` ms mà chưa có `crew.remote_stop` cùng run, mới hơn. Không tự khởi động lại lệnh dừng mồ côi; sau restart, giữ claim tối đa 120 giây và dựa vào reaper trên Mac. |
| A3 | Khi cho claim, `releaseHeld` luôn chạy trong DB cho run trên environment có gate (hoặc có dấu trong bản `run`). Xóa bằng `UPDATE … WHERE result_json->'executionRecovery'->>'heldBy' = 'crew_load_gate'`, không dựa bản `run` trong bộ nhớ. Lỗi thì giữ run. |
| b1, b2 | Không sửa; ruling chấp nhận trong ledger. |

**Test (đi đúng đường thật):**
- A1 `crew-load-gate-cancel.test.ts` "issue chuyển sang chờ review trong lúc cổng giữ run…":
  - run continuation của executor (`wakeReason: issue_continuation_needed`, summary "Wait for reviewer feedback…") do wake stock tạo;
  - tick 1 qua `resumeQueuedRuns` → `claimQueuedRun` thật, cổng thật (Mac không vào được) giữ run;
  - issue chuyển `in_progress` (stale gate coi executor phải chờ review);
  - tick 2 qua `claimQueuedRun` thật, Mac ổn;
  - kỳ vọng: run `cancelled`, `errorCode = issue_continuation_waiting_on_review`, `timeoutSource = stale_queued_run_gate`, `executionRecovery.bootstrap` còn, adapter không được gọi; `reconcileStrandedAssignedIssues` thật không sinh `legacy_execution_requires_reconciliation`; blocker null; wake sau tạo run.
  - RED trên `d95c9a88d`: run bị hủy đúng `stale_queued_run_gate` nhưng **không còn** `executionRecovery`, tái hiện đúng A1.
  - Test cũ "chép phép ghi của stale gate" đã bỏ.
- A3: "hai lần đánh giá song song…". Lần A giữ run và commit dấu; lần B dùng bản `run` đọc trước đó và cho claim; sau B, DB không còn dấu.
- A2:
  - `remoteStopPending` trên DB khi bộ nhớ trống (giả lập restart): `started` 5 giây trước → giữ; 150 giây trước → không; environment khác → không; có kết quả → không.
  - `crew-remote-stop-release.test.ts`: `started` được ghi trước khi nhả lease; kết quả được ghi cả khi `matched=0`.
- Unit `crew-load-gate.test.ts`: `releaseHeld` luôn được gọi khi cho claim trên environment có gate, dù bản `run` chưa thấy dấu; `cancelled` → giữ; lỗi → giữ; environment hết gate vẫn xóa nếu bản `run` có dấu.

**Lệnh:**

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-remote-stop-release.test.ts src/__tests__/crew-load-gate.test.ts src/__tests__/crew-load-gate-cancel.test.ts   # RED trên d95c9a88d: 3 test DB mới + 4 test release + unit (interface async) fail
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts src/__tests__/crew-load-gate-cancel.test.ts src/__tests__/crew-remote-stop-release.test.ts src/__tests__/crew-retry-progress.test.ts src/__tests__/crew-before-claim.test.ts src/__tests__/crew-remote-stop.test.ts src/__tests__/crew-core-hooks.test.ts src/services/legacy-execution-recovery.test.ts src/__tests__/heartbeat-run-terminalize-before-release.test.ts src/__tests__/environment-runtime.test.ts src/modules/run-dispatch/adapters/postgres.test.ts src/modules/run-dispatch/domain/policy.test.ts
 Test Files  12 passed (12)
      Tests  320 passed (320)
corepack pnpm --filter @paperclipai/server exec tsc --noEmit   # exit=0
```

**Còn hở:**
- A1: issue có thể đổi trạng thái trong khe giữa lần stale gate cổng gọi (không stale, dấu bị xóa) và lần stale gate mà `claimQueuedRun` gọi ngay sau đó. Khe này chỉ gồm một UPDATE và vài truy vấn; nếu xảy ra thì lại sinh hold như CRE-21.
- A3: run vẫn có thể mang dấu nếu lần A ghi dấu đúng trong khe giữa UPDATE xóa dấu của lần B và lúc stock chuyển run sang `running`. Hai lần đánh giá dùng chung probe đã cache, nên hiếm khi quyết khác nhau.
- A2: mỗi lần nhả lease run SSH thêm hai activity (`started` + kết quả).

## Sửa sau re-review AC-2

Re-review (mục "Re-review sau AC-2" của [rr-review.md](rr-review.md)): A1–A3 APPROVE có điều kiện. Commit **`5bbec62ad`** — `perf(crew): scope the pending remote stop lookup to the run's company` trên `54a819878`. File: `server/src/crew/load-gate.ts`, `server/src/__tests__/{crew-load-gate,crew-load-gate-cancel}.test.ts`.

- **c1:**
  - Theo schema `packages/db/src/schema/activity_log.ts`, các chỉ mục là `activity_log_company_created_idx (company_id, created_at)`, `activity_log_company_agent_created_idx`, `activity_log_company_responsible_user_created_idx`, `activity_log_run_id_idx (run_id)`, `activity_log_entity_type_id_idx (entity_type, entity_id)`.
  - `remoteStopPending(environmentId, companyId)` giờ lọc `company_id = <company của run>` và `created_at >= now − 120 s` (khớp chỉ mục `(company_id, created_at)`), rồi `action`, `entity_type = 'heartbeat_run'`, `details->>'environmentId'`.
  - Truy vấn con `NOT EXISTS` lọc `entity_type = 'heartbeat_run'`, `entity_id = <run>` (khớp chỉ mục `(entity_type, entity_id)`), cùng company, `action = 'crew.remote_stop'`.
  - Activity `started` và kết quả đều ghi `companyId = lease.companyId`, `entityType = "heartbeat_run"`, `entityId = run id` (`remote-stop.ts` `recordStarted`/`recordActivity`).
  - Test: cùng environment nhưng company khác thì không giữ claim. RED trước khi sửa: 2 test fail.
- **c2:**
  - `applyRunDispatchPostCommitEffects` nằm trong closure `heartbeatService`, không được export; `publishRunLifecyclePluginEventData` cũng vậy.
  - `cancelIfStale` giữ phần phát `heartbeat.run.status`, và gọi thêm hai helper stock có export: `clearHeartbeatRunRuntimeStatus(runId)` và `emitAgentTaskRunById(db, …)`.
  - Sự kiện vòng đời run cho plugin không được phát (ruling).
- **c3:** ruling chấp nhận.

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts src/__tests__/crew-load-gate-cancel.test.ts src/__tests__/crew-remote-stop-release.test.ts src/__tests__/crew-retry-progress.test.ts src/__tests__/crew-before-claim.test.ts src/__tests__/crew-remote-stop.test.ts src/__tests__/crew-core-hooks.test.ts
 Test Files  7 passed (7)
      Tests  112 passed (112)
corepack pnpm --filter @paperclipai/server exec tsc --noEmit   # exit=0
```

## L1 lần 2

Số đo trên máy thật (image `v3-80f987263`, CRE-26 `ba0f4472`):
- 16:20:35.043: run executor `f7172577` kết thúc.
- 16:20:35.465: wake reviewer bị `skipped` `execution_reconciliation_required` ("has not released its environment lease").
- 16:20:36.421: `crew.remote_stop.started`.
- 16:20:36.425: lease `64939761` nhả.

Wake tới trước lúc nhả lease khoảng 1 giây, và stock không thử lại. Vậy rút ngắn H3 là không đủ.

Sửa trong commit **`1757eb729`** — `fix(crew): replay the participant wake stock skipped while the lease was still held` (trên `5bbec62ad`). Chọn hướng (a), xác định theo thứ tự, không dùng hẹn giờ.

**Bằng chứng theo symbol:**
- `routes/issues.ts` `buildExecutionStageWakeup`: route `await heartbeat.cancelRun(...)` rồi đánh thức participant ngay.
- `services/heartbeat.ts`: lease chỉ nhả ở `finally` của `executeRun` (`releaseEnvironmentLeasesForRun` → driver `releaseRunLease` → H3 → `releaseLease`).
- `conversation-continuation.ts` `getConversationOwnershipBlocker`: run `cancelled` còn lease `releasedAt is null` → blocker.
- `heartbeat.ts` `deferBlockedExecution` → `recordExecutionWait`: ghi wake `skipped`, `reason = execution_reconciliation_required`, giữ `payload` (có `executionStage`), mất `reason` gốc.
- `resumeExecutionWaitComments`: chỉ chạy lại wait do `user` yêu cầu, không chạy lại wake hệ thống.

**Cách sửa:**
- `remote-stop.ts` `startRemoteStopOnRelease` (H3): ghi `crew.remote_stop.started`, rồi **tự nhả lease** bằng đúng lệnh `environmentService(db).releaseLease(lease.id, status)` mà driver gọi ngay sau hook. Lệnh này lặp lại vô hại vì cùng tham số; nó chỉ cập nhật `lastUsedAt`/`updatedAt` và bỏ `remoteExecutionTermination`, như driver.
- Sau khi nhả xong mới gọi `handoff-rewake.ts` `rewakeAfterLeaseRelease`, rồi mới chạy lệnh dừng nền như cũ. Thứ tự "nhả lease → đánh thức lại" vì vậy là thứ tự `await`, không đoán giờ.
- `rewakeAfterLeaseRelease`:
  - lấy issue của run (`lease.issueId`, `nativeIssueId` hoặc `contextSnapshot.issueId`);
  - dừng nếu issue `done`/`cancelled`/`blocked`, không có assignee, hoặc assignee là chính agent của run;
  - lấy wake `skipped` `execution_reconciliation_required` mới nhất của assignee cho issue đó, kể từ lúc run được tạo;
  - bỏ qua nếu wake đó đã có activity `crew.handoff_rewake` (`entity agent_wakeup_request/<id>`, idempotent), nếu assignee đã có run `queued`/`running`/`scheduled_retry` trên issue, hoặc nếu `getExecutionBlocker` vẫn còn chặn;
  - nếu qua hết: ghi activity rồi gọi `heartbeatService(db).wakeup` của stock với `source`, `triggerDetail`, người yêu cầu và `payload` gốc (bỏ `executionWait`), `contextSnapshot` có `executionStage` và `crewHandoffRewake: { skippedWakeId, previousRunId }`.
  - Lỗi chỉ log.
- `crew/ops/inspect-image.sh` (gói `plugin`, lead cho sửa): thêm kiểm `server/dist/crew/handoff-rewake.js`.

**Lệch yêu cầu (ruling):** `reason` của wake phát lại là reason gốc, khôi phục từ `payload.executionStage.wakeRole` (`reviewer` → `execution_review_requested`, `approver` → `execution_approval_requested`, `executor` → `execution_changes_requested`; không có stage mà `source=assignment` → `issue_assigned`; còn lại `crew_handoff_rewake`). Em không dùng reason riêng `crew_handoff_rewake`, vì stock xử lý riêng các reason này (`shouldRequireIssueCommentForWake`, `EXECUTION_REVIEW_PARTICIPANT_RECOVERY_WAKE_REASONS` trong wake-queue, tập reason ở `heartbeat.ts` ~1242). Dấu vết Crew nằm ở `contextSnapshot.source = crew.handoff_rewake`, `crewHandoffRewake` và activity.

**Test** `crew-handoff-rewake.test.ts` (embedded PG, đường stock thật):
- Dựng: run executor `cancelled` (`issue_reassigned`, adapter `claude_local`) còn lease SSH chưa nhả; issue `in_review`, giao cho reviewer.
- `heartbeatService.wakeup(reviewer, execution_review_requested)` thật trả `null` và ghi wake `skipped`, `error` "has not released its environment lease". Đây là tái hiện đúng L1.
- `startRemoteStopOnRelease` với lệnh dừng giả: lease có `releasedAt`; reviewer có đúng **1** run mới, `contextSnapshot` có `wakeReason: execution_review_requested`, `executionStage.wakeRole: reviewer`, `crewHandoffRewake`; có 1 activity `crew.handoff_rewake`.
- Nhả lần hai (driver nhả lại) vẫn chỉ 1 run.
- Không đánh thức khi issue bị chuyển `blocked`, khi không có wake bị bỏ, hoặc khi assignee đã đổi.

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-handoff-rewake.test.ts   # RED trên 5bbec62ad: 1 failed (lease chưa nhả, không đánh thức lại) | 3 passed
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-handoff-rewake.test.ts src/__tests__/crew-load-gate.test.ts src/__tests__/crew-load-gate-cancel.test.ts src/__tests__/crew-remote-stop-release.test.ts src/__tests__/crew-retry-progress.test.ts src/__tests__/crew-before-claim.test.ts src/__tests__/crew-remote-stop.test.ts src/__tests__/crew-core-hooks.test.ts src/__tests__/environment-runtime.test.ts src/__tests__/environment-runtime-driver-contract.test.ts src/__tests__/heartbeat-run-terminalize-before-release.test.ts src/__tests__/heartbeat-dependency-scheduling.test.ts
 Test Files  12 passed (12)
      Tests  232 passed (232)
corepack pnpm --filter @paperclipai/server exec tsc --noEmit   # exit=0
node crew/release/check-core-hooks.mjs                          # Hook một dòng: 4/5; mục: 8; lỗi: 0
bash -n crew/ops/inspect-image.sh                               # ok
```

**Còn hở:**
- Wake mà transaction của nó đọc lease lúc chưa nhả nhưng commit sau truy vấn của Crew sẽ bị sót. Khe này nằm giữa `releaseLease` và truy vấn ngay sau, chỉ vài mili giây.
- Chỉ đường lease SSH (đi qua H3) được đánh thức lại.
- Chỉ phát lại wake mới nhất cho mỗi (issue, assignee).

## Sửa sau review L1 lần 2

Review: mục "Review L1 lần 2" của [rr-review.md](rr-review.md), APPROVE kèm 4 minor. Sửa d1 trong commit **`01ccd366e`** — `fix(crew): mark a replayed wake only after stock accepted it` (trên `1757eb729`). File: `server/src/crew/handoff-rewake.ts`, `server/src/__tests__/crew-handoff-rewake.test.ts`.

- **d1:** `wakeup` được gọi trước. Thành công thì mới ghi dấu `crew.handoff_rewake`. Lỗi thì log `warn`, ghi activity `crew.handoff_rewake.failed` (`details.error`), không ghi dấu, nên lần nhả lease sau của issue thử lại được.
  - Test "wakeup lỗi thì không ghi dấu…": `wakeup` ném lỗi → 0 dấu, 1 activity lỗi, không có run; gọi lại với `wakeup` thật → 1 run, 1 dấu.
  - RED trên `1757eb729`: dấu đã có dù `wakeup` lỗi (`expected … length of +0 but got 1`).
- **d2, d3, d4:** không sửa, ruling chấp nhận trong ledger.

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-handoff-rewake.test.ts   # RED: 1 failed | 4 passed
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-handoff-rewake.test.ts src/__tests__/crew-load-gate.test.ts src/__tests__/crew-load-gate-cancel.test.ts src/__tests__/crew-remote-stop-release.test.ts src/__tests__/crew-retry-progress.test.ts src/__tests__/crew-before-claim.test.ts src/__tests__/crew-remote-stop.test.ts src/__tests__/crew-core-hooks.test.ts
 Test Files  1 failed | 7 passed (8)   # 1 failed: crew-remote-stop "finds a node process by its PAPERCLIP_RUN_ID token…" (dựa trên ps, chạy song song nặng)
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-remote-stop.test.ts   # chạy riêng 2 lần: 27 passed (27) cả hai
corepack pnpm --filter @paperclipai/server exec tsc --noEmit   # exit=0
```

Test `crew-remote-stop` bị lỗi khi chạy chung không đụng tới phần sửa (file đó không đổi trong commit này). Đây là test flaky dựa trên bảng process.
