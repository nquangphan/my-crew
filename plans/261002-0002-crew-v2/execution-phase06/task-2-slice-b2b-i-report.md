# Task 2 Slice B2b-i — scoped signal (`dependencies_ready`, `wait_owner` chưa chạy)

**Kết quả: DONE.** RED semantic 138 tests (119 pass / 19 fail, exit 1), GREEN 138/138 (exit 0) trên 5 file test của B2a, hồi quy thêm đường signal generic 102/102 (exit 0), scoped strict tsc exit 0 (output rỗng), Biome exit 0 với 0 warning, `crew-docs generate`/`check --all`/`check --staged` ok trong mirror tạm. Không chạm `execution/attempts.ts` hay `execution/commands.ts`, không nới generic ACL, không dùng owner tổng hợp.

Làm theo ruling A1 và S1 trong `pm-next-slices-memo-261004.md`. Worktree `/Volumes/CORSAIR/Projects/my-crew-v2`, nhánh `codex/crew-v2-server`, BASE `d913052` (HEAD lúc commit đã lên `ed781fa` do worker khác commit, không giao file). Node v24.21.0, pnpm 10.32.1, Biome 2.5.14.

## Thay đổi

| File | Nội dung |
|---|---|
| `v2/server/src/tickets/service.ts` | Tách lõi signal thành `prepareSignal` (khóa root → ticket, CAS revision, kiểm predecessor `done`, tra quyết định tiếp tục vòng sửa cho `resume`), `signalTransition` và `persistSignal` (UPDATE + event `ticket.changed`). Generic `signalTicketWithDependencies` giữ nguyên hành vi và gọi lõi chung. Thêm `createAssistantSignalWriter`, nối thành `assistantSignalTicket` trong `createTicketServices`. |
| `v2/server/src/tickets/assistant-access.ts` | Chỉ export `uuid` và `invalidScope` (M2 làm nhân tiện); service.ts dùng lại thay vì regex/ApiError inline. Không đổi hành vi. |
| `v2/server/test/assistant-mutations.test.ts` | Fixture `run` nhận action `signal`; `state()` thêm status/wait_reason/repair-limit columns, `commands`, `attempts`. Thêm 20 test cho 10 case RED của memo. |
| `v2/docs/flows/server-tickets.md` | Bước 4 mô tả lõi `prepareSignal`/`persistSignal`; bước 10 mô tả `assistantSignalTicket`. Bỏ trạng thái tạm (GREEN118/review chờ) ở đoạn B2a và dòng file test (M5). |

### Produced interface

`assistantSignalTicket(tx, actor, proof, ticketId, signal: 'dependencies_ready' | 'wait_owner', expectedRevision): Promise<Ticket>` — khớp `ProjectOrchestrationPort.signal` trong `assistant/contracts.ts`. Hash `orchestrationTargetHash('signal', {ticketId, signal, expectedRevision})`, tức tuple `['crew-v2:orchestration-target:1','signal',payload]` theo đúng spelling gửi lên.

### Thứ tự trong entry scoped

1. `captureAssistantOperation` chụp actor/proof/payload đồng bộ trước mọi await (owner → 403 `ORCHESTRATION_MACHINE_REQUIRED`; actor id không phải UUID → 400).
2. Validate: ticketId UUID, signal thuộc `{dependencies_ready, wait_owner}` (còn lại 400 `VALIDATION`), revision safe integer ≥ 1.
3. Thiếu authority → 503 `ORCHESTRATION_UNAVAILABLE`.
4. `prepareSignal(..., actor=null)`: khóa root → ticket (không áp generic ACL máy; authority quyết định), CAS revision, `DEPENDENCIES_NOT_READY`.
5. Khóa project `for update` (cùng lock order root → ticket → project như B2a).
6. `wait_owner` trên `running` → 409 `EXECUTION_PROOF_REQUIRED`, luôn luôn, bất kể `deps.execution`.
7. `signalTransition` (409 `INVALID_TICKET_TRANSITION`).
8. `verify(tx, actor, proof, 'signal', targetSha256)` bằng method bind lúc tạo factory.
9. Đánh dấu prepared trong `WeakMap` module-private; `persistSignal` tiêu một lần, kiểm cùng Tx, cùng operation, hash tính lại khớp, ticket/signal khớp prepared, không có continuation.

## RED

Trước khi viết source, thêm scaffold tối thiểu `assistantSignalTicket` ủy quyền thẳng cho generic `signalTicketWithDependencies` (ACL máy bound), để RED là thất bại ngữ nghĩa (404 `NOT_FOUND`) chứ không phải `TypeError` thiếu hàm.

- Lệnh (qua script, container riêng): `NODE_OPTIONS=--max-old-space-size=384 CREW_V2_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:62204/crew_v2_test CREW_V2_TEST_CONTAINER_ID=944d4b8c… node --test --test-concurrency=1 --test-timeout=60000 v2/server/test/assistant-mutations.test.ts v2/server/test/assistant-orchestration.test.ts v2/server/test/tickets.test.ts v2/server/test/deploy.test.ts v2/server/test/dependencies.test.ts`
- Kết quả: tests 138, pass 119, fail 19, cancelled 0, skipped 0, exit 1, 24335.75 ms.
- 119 pass = 118 test cũ (B1 47 + B2a 55 + existing 16, không vỡ sau khi mở rộng fixture) + case (1) generic route 404 (control, vốn đúng trước khi có source).
- 19 fail đều semantic: 18 test nhận `NOT_FOUND` thay vì mã kỳ vọng (`ORCHESTRATION_UNAVAILABLE`, `TEST_TRUST_DENIED`, `DEPENDENCIES_NOT_READY`, `EXECUTION_PROOF_REQUIRED`, `REVISION_CONFLICT`, `VALIDATION`, hoặc thành công); test `owner` không bị từ chối (generic path cho owner signal thành công). Không có lỗi import/compile/setup.
- Hash source lúc RED: service.ts (scaffold) `47b998fb…`, test `165867ac…`.

### Map 10 case → test

| Case memo | Test |
|---|---|
| (1) generic `/v2/tickets/:id/signals` A→B 404 | `B2b-i real machine-authenticated generic signal route keeps A→B ACL` (cả hai signal) |
| (2) không authority 503, revision không đổi | `B2b-i signal without orchestration authority…` |
| (3) sai proof/hash/action/Tx deny | 8 test `B2b-i signal rejects {owner,actor,operation,action,hash,root,project,tx}…` |
| (4) `dependencies_ready` predecessor chưa done 409; đủ done → ready, revision+1, event | `B2b-i dependencies_ready requires done predecessors…` (kèm kiểm snapshot: mutate actor/proof/payload sau khi gọi không ảnh hưởng hash/audit; journal actor máy A) |
| (5) `wait_owner` pending/ready → `needs_input`, `owner_input`, revision+1 | 2 test `B2b-i wait_owner on {pending,ready}…` |
| (6) `wait_owner` running → 409, không command mới, attempt không đổi, không event | `B2b-i wait_owner on running ticket fails closed without synthetic owner command` |
| (7) stale revision 409 | `B2b-i signal stale revision conflicts…` |
| (8) `resume`/`start`/`passed` 400 | 3 test `B2b-i scoped signal rejects {resume,start,passed}…` |
| (9) repair-limit: scoped không tiêu continuation | `B2b-i scoped wait_owner on repair-limit ticket never consumes owner continuation` |
| (10) signal và dependency serialize trên root | `B2b-i scoped signal and dependency edge serialize on the root before verify` |

Ghi chú case (6): memo viết "`attempts.terminal_intent` null", nhưng cột là `not null default 'complete'` (migration 005). Test khẳng định `terminal_intent='complete'` và `terminal_reason=null` không đổi, đúng tinh thần "không đổi". Test còn dựng services có `execution` thật (spy) và khẳng định không callback nào được gọi, tức nhánh fail-closed không phụ thuộc vào việc thiếu `deps.execution`.

Ghi chú case (10): hook trong verify của signal khẳng định root, ticket và project đã bị khóa (`for update nowait` → 55P03), giữ verify mở trong lúc dependency `a←b` chạy ở connection khác; sau 200 ms dependency chưa tới verify (observed vẫn 1). Thả ra thì signal commit (`ready`, revision 2), dependency nhận `REVISION_CONFLICT`, không có cạnh nào được ghi.

## GREEN

| Lượt | Lệnh | Kết quả |
|---|---|---|
| Biome run1 | `pnpm dlx @biomejs/biome@2.5.14 check <3 owned files>` | exit 1, chỉ 2 lỗi format (xuống dòng). Sửa bằng `biome format --write` trên đúng 3 file. |
| Biome final | cùng lệnh | exit 0, `Checked 3 files`, 0 warning |
| tsc | `NODE_OPTIONS=--max-old-space-size=384 pnpm --dir v2/server exec tsc --noEmit --ignoreConfig --skipLibCheck --target ESNext --module NodeNext --strict --allowImportingTsExtensions --erasableSyntaxOnly --verbatimModuleSyntax --types node src/platform/picomatch.d.ts src/platform/thread-stream.d.ts src/attachments/extract/yauzl.d.ts src/tickets/service.ts src/tickets/decisions.ts src/tickets/dependencies.ts src/tickets/assistant-access.ts test/assistant-mutations.test.ts` | exit 0, output rỗng |
| GREEN | 5 file như RED | tests 138, pass 138, fail 0, cancelled 0, skipped 0, exit 0, 24760.95 ms |
| Hồi quy signal generic | `api-acceptance`, `assistant-store`, `attachments-routing`, `attachments-snapshots`, `attempts`, `completion`, `docs-read`, `repair` | tests 102, pass 102, fail 0, exit 0, 36832.89 ms |

Lượt hồi quy thêm vì lát này refactor cả đường generic `signalTicket`/`applyExecutionSignal` (mọi file test gọi hai hàm này hoặc route `/signals`). Thứ tự kiểm ở generic đổi nhẹ: kiểm execution-signal giờ chạy sau CAS/predecessor/continuation thay vì trước. Vì tập execution signal và `{dependencies_ready, resume}` rời nhau, không signal nào thấy khác biệt; 102/102 xác nhận.

Mọi lượt tính kết quả chạy trên source cuối (hash bên dưới); Biome format chạy trước tsc/GREEN.

## Docs (R3)

Chỉ flow `server-tickets` chứa 3 file source/test đã đổi. Mirror tạm trong scratchpad: `git archive HEAD:v2` (HEAD `ed781fa`), commit baseline, overlay đúng 4 file của lát này (không overlay thay đổi chưa commit của worker khác), chạy `packages/docs-kit/dist/crew-docs.cjs`: `generate` (index.md/files.md unchanged), `check --all` ok, `check --staged` ok. Mirror đã xóa. Không sửa `docs/flows.yaml`.

## Tài nguyên và cleanup

Heavy slot `$TMPDIR/crew-v2-heavy-slot.lock`: lần 1 giữ 02:56:30–02:57:3x UTC (RED), trả trước khi sửa source; lần 2 slot đang do `web-task2` giữ, chờ nền (thử lại mỗi 2 phút), lấy được 03:01:18, trả 03:03:37 UTC. Mọi lượt telemetry `heavyEligible=true`: pressure 1, available 4.78–5.03 GiB, CPU idle 71.8–86.5 %, disk ~753.5 GiB.

| Lượt | Container | ID | Port |
|---|---|---|---|
| RED | crew-v2-test-5f96f86e-9357-4ab9-a87d-d6b458608fc8 | 944d4b8c32e3dc9c7598008dc90dd9f61855c560e98a37f457fa91a16f888f57 | 62204 |
| GREEN | crew-v2-test-f0b1d2ad-e754-47d9-a7dd-e1919601e0fc | f1741009dac2701667d7808b1d44e3c1f78b86793afe69dd0e1145fbe788f5b0 | 65260 |
| Hồi quy | crew-v2-test-fc4b3e60-19a1-4b42-a2ac-e68de0b11b47 | 4ca3bb768596652104a0961dfa3fe181971d2a74b0abf8798cea55ca1432212d | 49295 |

Mỗi container: `postgres:18.6` local (image `4ef4dbc939d6`, không pull), `--rm --memory 256m --cpus 1 --pids-limit 64 -p 127.0.0.1::5432`, inspect mem 268435456 / nanoCPUs 1000000000 / pids 64, `pg_isready` ok ở lần thử 3. Cleanup mỗi lượt: `pg_database like 'crew_v2_test_%'` 0, `docker stop <id>` (auto-remove), `docker ps -a --filter id` rỗng, `docker inspect` no such object, không còn process `node --test`. Không chạm container của người khác. Script runner và mirror nằm trong scratchpad, mirror đã xóa.

## SHA256

| File | SHA256 |
|---|---|
| v2/server/src/tickets/service.ts | `345afbf84a59d509daecf9149c4debe7b031882c04ea87f643ca632aaf3adeb7` |
| v2/server/src/tickets/assistant-access.ts | `50f8d9240cbb5b254047c631c0e4be105d16fa5052f3b57d5c5448f9d44f1ab7` |
| v2/server/test/assistant-mutations.test.ts | `5c294aecb8ff78c5c2fcfc597a34afb9e09569f7fff5fc45f74630034c05ddb1` |
| v2/docs/flows/server-tickets.md | `933da5a93d11cf7b011de6061b580f622997acdd7af436d2f1050211f0bbf57d` |
| task-2-slice-b2b-i-red.log | `ae2793b557b06f9a3c3ea4296f4f2302678c05878112b1cf4fd9a1fae7daa743` |
| task-2-slice-b2b-i-red-resource.log | `ce2998a238966971315e7825b619fc459d22b1357a3821e7425e5051aa46bc3c` |
| task-2-slice-b2b-i-red-cleanup.log | `a51c4c07116999524763dec424906b559aebeb307321b9fbc3895856c4047159` |
| task-2-slice-b2b-i-green.log | `f164019ab7ea8390378e84779536fbaffdef7e542b986990e3b0aa9efab1765e` |
| task-2-slice-b2b-i-green-resource.log | `aad8474b1115c9e4b6d391bacb4caba9a1a0af940a3a27ddf4823d3eab9e60c0` |
| task-2-slice-b2b-i-green-cleanup.log | `8a0a6c700472beaef244e99fbfba90fa567323c129a9991625966c391c395b92` |
| task-2-slice-b2b-i-signal-regression.log | `cd54a15d5185a0e0358c89e0955c496662a9c384d653dd3956c36bf10c782f22` |
| task-2-slice-b2b-i-signal-regression-resource.log | `addc432c3e8d5fcf7e26b84c1970788824cd14a416827e9b05af32e8bd30822b` |
| task-2-slice-b2b-i-signal-regression-cleanup.log | `23db866a41c1910723b39fcc8d14e69cee851c9718dfb204ce7142654098cfaa` |
| task-2-slice-b2b-i-typecheck.log | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (rỗng) |
| task-2-slice-b2b-i-typecheck-resource.log | `654db8e728acdadc2b0595b1ad89a594b968737a231a2981babddb4a44d73fd7` |
| task-2-slice-b2b-i-biome-run1.log | `9e5bfd478f932de859a44999e3d7d707bd5eb7bf1f8e9aef3042a264477b013f` |
| task-2-slice-b2b-i-biome.log | `bbdf6f36fe15c9242b39e0e609578ef2daba00b9bab06a0e542e3640cb3c2d41` |
| task-2-slice-b2b-i-docs.log | `b173cfd3e9d2d518c7ce2c6f59d350e4042a00b290e1beaa872d830468b71e54` |

## Self-review

- **Spec A1/S1:** union kiểu chỉ hai signal; runtime 400 cho phần còn lại; running `wait_owner` 409 trước verify, không gọi `requestTerminalIntent`, không tạo command; continuation chỉ cho `resume` nên scoped không thể tiêu; payload hash đúng ba key; snapshot trước await; lock root → ticket → project trước verify, không khóa muộn sau verify.
- **Không synthetic owner:** entry scoped không bao giờ truyền actor owner hoặc gọi callback execution; test (6) chứng minh bằng spy.
- **Generic không đổi hành vi:** cùng mã lỗi, cùng event, cùng nhánh running owner (vẫn dùng `requestTerminalIntent` như phase02, đúng trap C7 để lại cho triage). 102 + 138 test xác nhận.
- **Khác biệt nhỏ cần biết:** scoped dùng `select * … for update` thay vì `access.prepare` của B2a, vì `prepare` chỉ nhận action `decision`/`dependency`; mở rộng nó cho `signal` là đổi hành vi `assistant-access.ts` ngoài quyền được cấp (chỉ export). Lock order và token một lần vẫn tương đương B2a; nếu PM muốn hợp nhất, việc đó là sửa một dòng `submitted` trong `prepare`.
- **M2:** sửa phần thuộc service.ts/assistant-access.ts. `decisions.ts`/`dependencies.ts` vẫn có regex/ApiError inline vì không thuộc ownership lát này.
- **Giới hạn:** scoped strict không phải full-server typecheck; production resolver vẫn deny (chỉ test-trust allowlist); B2b-ii (running `wait_owner`, `createAssistantCommand`) vẫn thuộc T4. Independent review chưa chạy (brief không cho dispatch).
