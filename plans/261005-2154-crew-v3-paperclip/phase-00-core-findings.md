# Core source/seam findings — Phase 00-01

05/10/2026, Asia/Ho_Chi_Minh. Source duy nhất dùng kết luận code: `paperclipai/paperclip@8f8a0ab7effbd6a0584107d8038736c134ee5047`, stable `v2026.1001.0`. [Baseline/provenance](baseline.md). Read-only survey; proposals chưa implement, tests chưa chạy. Worker core8/A high; independent reviewer quyết định gate. Không tự nhận task00-04 đã đạt.

## Kết luận cho quyết định Phase00

Có seam adapter phù hợp để **thử** remote transport, session/result/log/cancel trong cùng Paperclip run. Chưa đủ để kết luận plugin-only bảo vệ toàn invariant Crew hoặc giữ remote run qua server restart. Cần gate core trong transaction mutation và cấp reservation theo máy ở core claim/dispatch. SDK observer là hậu kiểm. Source survey đã xác định điểm đặt patch; còn workspace realization và recovery adoption cần proof riêng trước freeze patch set.

Không dựng Crew ticket queue/scheduler thứ hai. Crew transport giữ delivery/ACK/journal; chỉ core quyết định run/reservation. Mỗi run/machine/session/workflow pin/lease epoch phải liên kết cùng Paperclip IDs. Disconnect không được coi success hoặc cấp run mới khi chưa biết process cũ đã dừng.

## 1. Adapter contract thực tế

[Types pinned](https://github.com/paperclipai/paperclip/blob/8f8a0ab7effbd6a0584107d8038736c134ee5047/packages/adapter-utils/src/types.ts#L77):

| Seam | Exact source | Ý nghĩa |
|---|---|---|
| Execute | `packages/adapter-utils/src/types.ts:453–460`, `ServerAdapterModule.execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult>` | Promise giữ lifecycle lượt chạy, không trả success khi mới ACK dispatch |
| Env probe | cùng file `:456`, `testEnvironment(ctx): Promise<AdapterEnvironmentTestResult>`; result `:261–267` | pass/warn/fail + checks + testedAt; chỉ kiểm khả dụng, không cấp quyền spawn |
| Cancel | cùng file `:197–203`, optional `signal`, `onCancellationReady(): Promise<void>`, `stopRemoteStartup()` | Không có module method `cancel(runId)`. Adapter đăng ký cancellation trước provider work, nhận AbortSignal và settle thực tế trước return |
| Input identity | cùng file `:206–224`: runId, agent, runtime, config/context, executionTarget/transport, onLog | Gateway nhận envelope đã kiểm quyền; không tin run/company/project IDs tự gửi từ agent |
| Evidence/event | cùng file `:223–239`: onLog, onMeta, onEvent, onRuntimeProgress, onDispatch/onSpawn | `onDispatch` là thông báo bắt đầu; callback trả void, không là admission veto |
| Session | cùng file `:20–23`, `:104–106`, `:143–147` | runtime sessionParams/displayId; codec deserialize/serialize/getDisplayId. Crew bổ sung machine/project/runtime/workflow identity; opaque session alone chưa chống reuse sai miền |
| Result/recovery | cùng file `:77–142` | exitCode/signal/timedOut, usageBasis, sessionParams, resultJson, clearSession; executionRecovery đòi positive bootstrap/interrupted evidence |
| External registration | `server/src/adapters/plugin-loader.ts:149–203` | package root export `createServerAdapter()` đồng bộ trả ServerAdapterModule; không mặc định export object |
| Registration route | `server/src/routes/adapters.ts:303` | actual install route `/adapters/install`; đọc quyền/body route khi implement, chưa gọi route này |

[Loader source](https://github.com/paperclipai/paperclip/blob/8f8a0ab7effbd6a0584107d8038736c134ee5047/server/src/adapters/plugin-loader.ts#L149). `server/src/adapters/types.ts` chỉ re-export adapter-utils. Tách **external adapter package** khỏi **plugin SDK worker**; không giả plugin SDK là nơi định nghĩa execute. Actual SDK package là `packages/plugins/sdk` phiên bản1.0.0.

Prototype package đề xuất `crew/remote-adapter` (path MỚI, chưa có upstream; root workspace hiện không include `crew/*`). Exports createServerAdapter, type `crew_remote`, execute/testEnvironment/sessionCodec, pin adapter-utils source. Nếu prototype cần Paperclip API access bằng JWT injected của core, khai báo `supportsLocalAgentJwt: true` và chứng nhận nhánh runtime legacy; capability này không bảo đảm token luôn có (xem §6). Thêm workspace pattern/registration serial bởi PM. Không lấy `paperclip_runner` type cho adapter mới: `server/src/adapters/registry.ts:360–383` execute của type này chỉ trả lỗi yêu cầu native coordinator.

## 2. Run/scheduler authority

[Heartbeat source](https://github.com/paperclipai/paperclip/blob/8f8a0ab7effbd6a0584107d8038736c134ee5047/server/src/services/heartbeat.ts#L19700):

1. `startNextQueuedRunForAgent(agentId)` ở `:19700–19839`: suppression → agent invokability → maxConcurrentRuns per-agent → dependency priority → `claimQueuedRun` → `executeRun`. Capacity **per agent** này chưa là capacity chung của một Mac có nhiều agents.
2. `claimQueuedRun` ở `:17124`: kiểm invokability/budget/daily cap/pause/dependency và nhiều claim branches. `executeRun` ở `:19930` cũng gọi claim khi run còn queued (`:19957`). Không chỉ patch vòng scheduler đầu vào: resume/retry/direct execution có thể đi nhánh khác.
3. `dispatchResolvedInteractionContinuationWithAtomicGate` ở `:22178–22231`: assert controller lease, retry/chat gate. Nhưng nhánh `:22199–22204` dispatch thẳng nếu không phải resolved interaction/native-safe-replacement. Đây **không phải general Crew pre-spawn gate**.
4. Cả native (`:24062–24065`, `executePaperclipNativeSession`) và legacy (`:24277–24358`, `adapter.execute`) dùng helper trên; là candidate common pre-dispatch seam. Native có continuation/resumption riêng; khảo sát chưa chứng minh mọi warm/native turn đi helper này.
5. `adapter.execute` được cấp signal + onCancellationReady từ host tại `:24304–24341`; host callback đọc lại run và abort nếu run đã terminal. Custom adapter phải await callback trước gửi lệnh, và kiểm abort ngay trước dispatch.

**Proposal P2 — admission/reservation:** package policy Crew thuần + bridge core trong `heartbeat.ts`. Reserve atomically theo company/project binding/machine/workflow/runtime switch/telemetry TTL/resource budget/Git ownership trước claim chuyển khỏi queued; deny-wait giữ queued, không viết failed để sinh retry vòng. Hợp nhất admission cho các claim branches và dispatch recheck; recheck dùng reservation epoch và pin, không giữ DB transaction qua network. Reservation là record quyền thực thi gắn run, không là queue thứ hai. Release chỉ sau terminal ownership/process proof; server restart/disconnect không tự giải phóng.

**Gate tests mới cần viết:** hai agents cùng một machine tranh slot, telemetry stale, binding changed giữa claim và dispatch, switch OFF trước dispatch, duplicate wake/replay, direct execute/retry/native resume, controller lease lost, admission throw/timeout. Assert denied run không mở provider và số reservation active không vượt capacity.

## 3. Mutation và completion gate

[Issue service](https://github.com/paperclipai/paperclip/blob/8f8a0ab7effbd6a0584107d8038736c134ee5047/server/src/services/issues.ts#L10464): `issueService(db).update(id,data,dbOrTx=db,postCommitActivityPublications?,postCommitActions?,options?)` ở `:10464–10477`. `data` có actorAgentId/actorUserId/companyGuard. Row lock trong `runUpdate` ở `:10781–10787`; existing connection-review check chỉ chạy `actorAgentId && patch.status === done` (`:10788–10790`), SQL update ở `:10837–10842`.

- REST routes giữ service `server/src/routes/issues.ts:3510`; plugin host gọi cùng service `server/src/services/plugin-host-services.ts:1951–1987`.
- Native status projection đi `issueService(tx).update` tại [`native-runtime/status-decision-committer.ts:1876–1890`](https://github.com/paperclipai/paperclip/blob/8f8a0ab7effbd6a0584107d8038736c134ee5047/server/src/services/native-runtime/status-decision-committer.ts#L1876), **actor IDs null**. Gate chỉ áp dụng actorAgentId sẽ bị nhánh controller này bỏ qua.
- Issue create ở `issues.ts:9634`; child native delegation ở `status-decision-committer.ts:667` dùng create. Gate update-only chưa chặn tạo trực tiếp issue ở trạng thái terminal hoặc đổi parent/project/workflow binding.
- `companyGuard` được service mang vào read/lock/write predicate, nhưng là optional. Crew facade phải truyền verified company; không suy quyền từ IDs trong config.

**Proposal P1 — guard trước write:** gọi pure Crew invariant guard ở `runUpdate` sau row lock, trước update; đọc Crew namespace cùng transaction và locked fresh row (đừng chỉ dùng `existing` đọc trước lock). Guard dựa association Crew của issue/company/project + transition/evidence revision, không actor-only, không prompt. Thêm create guard ở transaction insert với initial status/hierarchy. Bảo vệ pin, dependencies, review độc lập, repair-count≤5, owner approval scope/revision, merge và docs merged-SHA trước done. Throw rollback toàn transaction; phát activity sau commit. Đề xuất internal authority context cho controller là server-owned; không chấp nhận flag bypass từ body/plugin patch.

**Coverage giới hạn:** đã trace REST/plugin/native status projection và native child create. Chưa liệt kê exhaustive mọi direct SQL writer/import/bulk/portability/routine path trong repo này; trước P1 accepted phải inventory writer và chứng minh không bypass. Đừng gọi patch `issues.update` là chứng nhận no-bypass cho toàn source.

**Gate tests:** board/agent/SDK/native null-actor đều bị chặn khi thiếu evidence; valid completed state được ghi đúng một lần; create(done), child hierarchy change, cross-company, stale status/evidence/approval revision, concurrent update, native transaction rollback không để wake/activity/done dở dang; routine/bulk/import writers đưa vào coverage inventory.

## 4. Plugin event không phải veto

[Activity source](https://github.com/paperclipai/paperclip/blob/8f8a0ab7effbd6a0584107d8038736c134ee5047/server/src/services/activity-log.ts#L45): `publishPluginDomainEvent` gọi `void _pluginEventBus.emit(...).then(...)` ở `:45–58`; `publishActivity` ở `:151–157`, persist activity `:163` và publish `:222–228`. Issue service có postCommitActivityPublications/postCommitActions. SDK `PluginIssuesClient` (`packages/plugins/sdk/src/types.ts:1422–1480`) cho CRUD; event API `:539–570` là subscribe/emit. Các seam đã đọc không cung cấp synchronous transaction veto hoặc capacity reservation.

Kết luận giới hạn: không dùng events để bảo vệ gate trước commit/spawn. Plugin worker phù hợp UI/observability/inbox/indexing và CRUD qua guarded core; P1/P2 phải được core gọi trực tiếp. Chưa tuyên bố exhaustive toàn SDK không có hook khác; cần chứng minh tương đương transaction/admission trước thay patch proposal bằng SDK hook.

## 5. Session, cancel, disconnect và restart

- `heartbeat.ts:12540–12584` upsertTaskSession; `:25214–25253` persist result/session theo company,agent,adapterType,taskKey. `clearSession` xóa có expectedRunId. Đây là persistence có sẵn để port codec, chưa có durable outbound transport continuation.
- `cancelRunInternal` ở `:28666`; capture adapter stop ownership trước run lock. Signal support là in-memory control; gateway cần stop ACK + physical stopped proof, không chỉ HTTP/socket ack. Adapter không báo Mac PID qua onSpawn như local VPS PID; PID thuộc host khác và reaper có liveness logic local.
- `reapOrphanedRuns` ở `:18744`, locallyTracked = processes/activeRunExecutions/native controller ở `:19017–19020`; legacy live controller check `:19065`; sau expiry + thiếu process ownership, reaper đi failure ở `:19141+`. Generic remote adapter chưa có restart reattach callback trong ServerAdapterModule.
- [`legacy-execution-recovery.ts:14–47`](https://github.com/paperclipai/paperclip/blob/8f8a0ab7effbd6a0584107d8038736c134ee5047/server/src/services/legacy-execution-recovery.ts#L14) đòi positive evidence, thường giữ reconciliation cho failed/interrupted; terminalize `:50–153` còn giải phóng issue run pointers và tạo owner recovery action. Đây là safer default, chưa đáp ứng remote run liên tục sau restart.

**Proposal P3 — durable remote ownership/reconciliation:** Crew namespace lưu run ID, machine generation, execution reservation epoch, monotonic delivery/event sequence, lastACK, session pin và terminal/stop proof. Narrow reaper/cancel integration trong `heartbeat.ts` kiểm adapter `crew_remote`: adopt/reconnect cùng run khi journal và epoch xác nhận; unknown giữ hold, không finalize success/retry/release reservation; cancel persisted tới gateway, trả pending khi chưa chứng minh stop. Type hook recover/adopt nếu cần thêm vào `adapter-utils/src/types.ts` phải version/contract tested. Không thêm giả `cancel()` vào SDK hiện hữu.

**Tests:** socket drop khi process sống; server kill/restart; gateway restart; ACK mất/replay; duplicate/out-of-order log/result; cancel trước/đồng thời startup và sau disconnect; stale epoch/result của run cũ; single-active session; usageBasis per_run/cumulative idempotence. Unit mock chỉ chuẩn bị;00-04 phải chạy real outbound Mac process + thật API/DB và process-stop evidence.

## 6. Auth/workspace boundary và blocker cho prototype

[`middleware/auth.ts:221–270`](https://github.com/paperclipai/paperclip/blob/8f8a0ab7effbd6a0584107d8038736c134ee5047/server/src/middleware/auth.ts#L221) tạo board implicit ở local_trusted hoặc resolve authenticated session/bearer; VPS chọn authenticated. `routes/authz.ts:85–125` giới hạn company/membership; `routes/projects.ts:145–158` gọi authorization action `project:read`, `runtime:manage`. `services/authorization.ts:482–486` có shadow mode env; production acceptance phải enforce, không shadow. Giữ Paperclip login/session làm authority.

Gateway device auth mới phải bind machine+company+project scope và server-issued run/reservation; không tái dùng provider credential làm hệ auth. AI credential chỉ ở Mac theo spec. `AdapterExecutionContext.authToken?: string` và `ServerAdapterModule.supportsLocalAgentJwt?: boolean` đều optional (`packages/adapter-utils/src/types.ts:235,462`). [`heartbeat.ts:23686–23717`](https://github.com/paperclipai/paperclip/blob/8f8a0ab7effbd6a0584107d8038736c134ee5047/server/src/services/heartbeat.ts#L23686) chỉ gọi `createLocalAgentJwt` khi `nativeRuntimeResolution.kind === "legacy"` và adapter bật `supportsLocalAgentJwt`; hàm trả null thì host chỉ log warning về signing secret missing/invalid rồi tiếp tục không injected token. Không mặc định nhánh native nhận token này.

[`server/src/agent-auth-jwt.ts:39–44,122–160`](https://github.com/paperclipai/paperclip/blob/8f8a0ab7effbd6a0584107d8038736c134ee5047/server/src/agent-auth-jwt.ts#L122) lấy signing secret từ `PAPERCLIP_AGENT_JWT_SECRET`, fallback `BETTER_AUTH_SECRET`; thiếu cả hai thì trả null. JWT chứa agent/company/adapter/run/responsible-user/instance và expiry; `skill_test` có scope issue riêng, standard không tự là project/machine grant. Signing key được derive theo company/instance. Chỉ gửi token cần thiết tới runtime đã bind, không log/persist raw token; không gửi signing secret tới Mac. Gateway pairing/device credential vẫn độc lập với JWT agent và với provider credential.

**Contract test F1 đề xuất, chưa chạy:** matrix legacy/native × supportsLocalAgentJwt true/false × signing config có/thiếu; xác minh khi nào context có token. Task cần Paperclip API access mà token thiếu/rỗng phải fail closed trước `onDispatch` hoặc gateway enqueue/spawn (assert zero outbound dispatch/provider start), kể cả host chỉ warning. Với token có, xác minh signature/expiry và agent/company/run/instance/scope qua API thật; token sai/expired/cross-company hoặc sai run bị từ chối, token hợp lệ cũng không cấp pairing/machine/project authority. Kiểm log không lộ token/secret. Không dùng decode JWT không verify làm acceptance.

**P4 candidate, chưa freeze:** `heartbeat.ts:22115–22162` environment/workspace realization xảy ra **trước** adapter.execute, gắn persisted workspace rồi nhận executionTarget. [`adapter-utils/src/execution-target.ts:131–239`](https://github.com/paperclipai/paperclip/blob/8f8a0ab7effbd6a0584107d8038736c134ee5047/packages/adapter-utils/src/execution-target.ts#L131) union chỉ local/remote SSH/remote sandbox. Chưa có machine outbound target. 00-04 phải thử repo chỉ tồn tại Mac; nếu core cố chuẩn bị trên VPS thì thêm environment driver/target extension hẹp, không giả server cwd=Mac path hoặc tải key lên VPS. Chưa kết luận cần patch union hay plugin environment driver đủ: tiếp tục trace realization/provider seam trong context core sau review.

## 7. Tests có sẵn và next brief

Các file sau **đã kiểm tồn tại**, chưa chạy; đọc setup trước thực thi, nhiều suite dùng embedded Postgres:

```sh
pnpm --filter @paperclipai/server exec vitest run src/adapters/plugin-loader.test.ts
pnpm --filter @paperclipai/server exec vitest run src/__tests__/issues-service.test.ts src/__tests__/issue-agent-mutation-ownership-routes.test.ts
pnpm --filter @paperclipai/server exec vitest run src/__tests__/heartbeat-dependency-scheduling.test.ts src/__tests__/heartbeat-process-recovery.test.ts src/__tests__/heartbeat-native-runner-cancellation.test.ts
pnpm --filter @paperclipai/server exec vitest run src/__tests__/agent-auth-middleware.test.ts src/__tests__/authorization-service.test.ts
```

Run serial theo admission; `server/vitest.config.ts:17–51` node/forks/maxWorkers1/setup-supertest. Existing tests là regression seeds, không chứng minh Crew gates mới. New test filenames/package paths do00-04/05 detailed brief quyết định sau source driver trace.

Next smallest proof: external adapter loader contract → run trên isolated core gọi gateway outbound thực → logs/result/session → cancel → disconnect/restart; policy test trước patch. Dùng cùng context worker; PM/reviewer review từng gate, không giao tất cả phase implementation một lượt. Baseline fork checkout00-03 có thể bắt đầu sau review baseline, không đợi exhaustive repo audit.

## Unresolved Qs

1. Plugin environment-driver contract có biểu diễn Mac workspace in-place qua outbound gateway, hay cần target extension P4? Chưa trace hết.
2. Danh sách đầy đủ writers/import/routine/native warm continuation nào chưa đi P1/P2? Chưa chứng nhận no-bypass.
3. Persisted legacy controller/adoption và run log sink có đủ để resume remote adapter cùng run, hay phải thêm typed recover hook P3? Cần real restart proof.
4. Actual fork owner URL, dependency installation/baseline tests, upgrade rehearsal/DB restore đều do next tasks; không có acceptance hiện tại.

Không có unresolved owner product question ở task này; đây là câu hỏi kỹ thuật của next gated survey/prototype. Process ownership: downloads kết thúc, source135MiB read-only; không server/DB/job background. Không commit.

## Delta review round1

F1/P2: làm rõ capability JWT conditional, legacy-only path, signing config/null semantics, namespace claims và fail-closed tests; F2/P3: sửa exact Rust path và row-lock/done-write/locallyTracked anchors. Đối chiếu lại pinned source bằng numbered lines; chỉ sửa hai report sở hữu. Chưa chạy runtime tests; source baseline ready cho fork theo reviewer, Phase00 proof vẫn chưa ready.
