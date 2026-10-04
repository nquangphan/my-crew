# Task 2 Slice C (S2 / T2-C) — positive persisted Actor resolver và `ProjectOrchestrationPort` thật

**Kết quả: DONE.** RED semantic 124 tests (95 pass / 29 fail, exit 1). GREEN cuối 187/187 (exit 0) trên assistant-authority, assistant-orchestration-port và đủ 5 file B1/B2a/B2b-i. Hồi quy ticket/signal 102/102 (exit 0). Scoped strict tsc exit 0 (output rỗng). Biome exit 0, 0 warning. `crew-docs generate` không đổi gì, `check --all` và `check --staged` ok trong mirror tạm.

App production **chưa inject** resolver hay port: `createTicketServices()` trong app không có `assistant`, nên mọi entry scoped vẫn trả 503 `ORCHESTRATION_UNAVAILABLE`. Ngay cả khi được inject, hôm nay production vẫn bị từ chối vì chưa có receipt PASS nào (R1 live chưa chạy). Lý do từ chối nằm ở dữ liệu persisted, không phải ở stub. Không có test nào dùng test-trust port cho S2.

Worktree `/Volumes/CORSAIR/Projects/my-crew-v2`, nhánh `codex/crew-v2-server`. BASE `cc600ee`; lúc docs check, HEAD là `963dc31` do worker khác commit, không giao file với lát này. Môi trường: Node v24.21.0, pnpm 10.32.1, Biome 2.5.14.

## Thay đổi

| File | Nội dung |
|---|---|
| `v2/server/src/assistant/authority.ts` | `createPersistedAssistantActorResolver({verifierBuildSha256})`: hàm kiểm pin hex64 lúc assembly, rồi chạy chuỗi A3 bước 1–5 (chi tiết ở phần dưới). |
| `v2/server/src/assistant/orchestration.ts` (mới) | `createProjectOrchestrationPort({tickets,resolver})` và `createPersistedOrchestrationAuthority(resolver)` thực thi linkage A2. `command` ném 503 `ORCHESTRATION_COMMAND_NOT_RELEASED`. |
| `v2/server/src/tickets/assistant-access.ts` | Thêm `'signal'` vào `submitted` của `prepare`. |
| `v2/server/src/tickets/service.ts` | Scoped signal chuyển sang `access.prepare/authorize` và `consumeAssistantScope`, bỏ WeakMap `verifiedSignals`. Lõi CAS tách thành `checkSignal` dùng chung. Generic `prepareSignal` chỉ còn phần khóa root → ticket theo ACL rồi gọi `checkSignal`, hành vi không đổi. |
| `v2/server/src/tickets/decisions.ts`, `dependencies.ts` | Thay 3 chỗ `ApiError('ORCHESTRATION_SCOPE_INVALID')` viết inline bằng `invalidScope()` dùng chung. `decisions.ts` dùng `uuid` export thay vì regex lặp (B2a M2). |
| `v2/server/test/support/assistant.ts` | Thêm helper `insertTurnRows` dùng chung; `seedTurn` giữ nguyên rows như cũ (UNVERIFIED, không admission). Thêm `seedAdmittedTurn` (snapshot, authorization, grant, session, receipt PASS ký bằng hằng `fixtureVerifierBuildSha256`), `seedToolOperation` và export `fixtureVerifierBuildSha256`. |
| `v2/server/test/assistant-authority.test.ts` | Test cũ chuyển sang gọi resolver có pin. Thêm 3 test: pin không hợp lệ; Actor dương; hạn session đo bằng `clock_timestamp()` sau khi khóa. |
| `v2/server/test/assistant-orchestration-port.test.ts` (mới) | 25 test port thật trên PostgreSQL. |
| `v2/server/test/assistant-mutations.test.ts` | 2 test chứng minh signal đã có recheck root/project dưới khóa. |
| `v2/docs/flows.yaml`, `v2/docs/files.md` | Thêm `orchestration.ts` và test mới vào flow `server-assistant`, giữ lock manifest. |
| `v2/docs/flows/server-assistant.md`, `server-tickets.md` | Chỉ mô tả hành vi; bỏ câu trạng thái tạm "positive persisted authority vẫn pending". |

### Resolver (A3)

1. Hàm giữ các kiểm tra cũ của fence/scope. Scope thiếu hoặc khác turn trả 404. `assertCurrentTurnFence` khóa guard → machine → config → designation → turn → monitor. Scope hết hạn trả 409, đo bằng `clock_timestamp()`.
2. Turn có `admission_id` null thì giữ 503 `ASSISTANT_ADMISSION_NOT_CONFIGURED`.
3. Lấy session theo `admission_id`, khóa FOR SHARE. Session phải khớp các điều kiện sau:
   - `id = turn.read_session_id`;
   - `state` thuộc `reserved` hoặc `running`;
   - `machine_id` bằng máy của designation;
   - `process_instance_id = fence.processInstanceId` và `designation_revision = fence.designationRevision`;
   - `model_selection_id` bằng selection của turn, và `policy_receipt_id` bằng policy receipt của selection;
   - `snapshot_id = scope.input_snapshot_id`.
4. Selection, policy receipt và capability receipt đều khóa FOR SHARE. Policy receipt phải có `PASS`, `revoked_at` null, `deployment_id` bằng `assistant_config.deployment_id`, `verifier_build_sha256` bằng pin, và `machine_id` bằng máy designation. Capability receipt phải thuộc đúng policy receipt. Hạn của session, receipt và capability đều đo bằng `clock_timestamp()` sau khi khóa.
5. Mọi lệch trả 403 `ASSISTANT_ADMISSION_DENIED`, không fallback. Thành công trả `Object.freeze({kind:'machine', id: designation.machine_id})`.

### Authority và port (A2)

Port chụp `{actor, proof, payload}` đồng bộ bằng `immutableSnapshot`, ghi target của chính lời gọi vào WeakMap theo Tx (một lời gọi đang chạy trên mỗi Tx), rồi gọi entry scoped của `server-tickets` với bản snapshot. `verify` làm các bước sau:

1. Target phải khớp action và hash, actor và proof phải trùng snapshot; target dùng một lần. Thiếu hoặc lệch thì 403 `ORCHESTRATION_SCOPE_INVALID`.
2. Chạy resolver.
3. Actor gọi phải đúng máy designation (so khớp chính xác, kể cả hoa thường), nếu không thì 403 `ORCHESTRATION_ACTOR_MISMATCH`.
4. Action phải thuộc `scope.actions`, nếu không thì 403 `ORCHESTRATION_ACTION_NOT_IN_SCOPE`.
5. Row `assistant_tool_operations` được khóa FOR UPDATE. Row phải `pending` và cùng turn, nếu không thì 404 `ASSISTANT_OPERATION_NOT_FOUND`. `input_snapshot_id` phải bằng của scope, nếu không thì 409 `ASSISTANT_OPERATION_STALE`.
6. Membership: ticket đích, ticket cha hoặc predecessor phải thuộc `scope.root_ticket_id` và project, nếu không thì 404 `NOT_FOUND`. Scope message không có root cũng trả 404 cho mọi ticket đã tồn tại.
7. Request mới chỉ được tạo với scope message. Phải có decision `routing` của message được ghi trong chính Tx (`xmin = pg_current_xact_id()::xid`). Body của decision phải đúng `{operationId, scopeId, ticketSha256 = targetSha256}`, cùng snapshot, đúng input revision hiện hành, actor là máy A, và `sha256` khớp công thức `digest` của `persistMessageInputDecision`. Nếu không thì 403 `ORCHESTRATION_ROUTING_DECISION_REQUIRED`.

`createPersistedOrchestrationAuthority` dùng trần (không qua port) không có target, nên luôn trả 403. Có test cho trường hợp này.

Dependency không có cột actor, nên provenance của nó là row tool operation (turn → designation → máy A) cộng journal actor A. Test kiểm journal actor A cho cả create, decision, dependency và signal.

## RED

Lệnh RED chạy trên scaffold:
- `tickets/*` giữ nguyên HEAD.
- `authority.ts` nhận deps nhưng hành vi không đổi (luôn 503).
- `orchestration.ts` uỷ quyền cho `createTicketServices()` không có authority (503), `command` trả 503 `ORCHESTRATION_UNAVAILABLE`.

Lệnh: `node --test --test-concurrency=1 --test-timeout=120000 v2/server/test/assistant-authority.test.ts v2/server/test/assistant-orchestration-port.test.ts v2/server/test/assistant-mutations.test.ts`. Biến môi trường: `NODE_OPTIONS=--max-old-space-size=384`, `CREW_V2_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:51861/crew_v2_test`, `CREW_V2_TEST_CONTAINER_ID=548e9d26…`.

Kết quả: tests 124, pass 95, fail 29, exit 1, 31.8 s. Cả 29 lỗi đều semantic:
- nhận `ORCHESTRATION_UNAVAILABLE` hoặc `ASSISTANT_ADMISSION_NOT_CONFIGURED` thay vì mã kỳ vọng;
- "Missing expected rejection" ở 2 test recheck signal và ở test pin;
- không có lỗi import, setup hay trigger.

Hash source tại RED: authority scaffold `5c4a4b18…`, orchestration scaffold `bb2144c3…`, service HEAD `345afbf8…`, port test `5efbd389…`.

Sau RED, GREEN run1 lộ ra một lỗi trong chính test: `portFixture` trả actor `a`/`b` đè lên ticket `f.a`/`f.b`, nên các lời gọi decision dùng ID máy làm ticket. Tôi đổi tên thành `assistantA`/`boundB`. Run2 lộ thêm việc response journal `null` cho dependency trả void; tôi bọc response thành `{value}`. Cả hai chỉ sửa test, không sửa source. Lỗi đè tên làm vài test RED fail sớm hơn (cùng mã 503), nhưng vẫn là fail semantic.

### Map case memo → test

| Case | Test |
|---|---|
| (1) không admission → 503 | `S2 turn without admission stays 503…` và resolver test cũ |
| (2) admission + PASS → port thành công, actor A | `S2 admitted PASS turn creates A→B child…`, `S2 decision, dependency and signal…`, `S2 new root requires the same-Tx routing decision…` (nhánh thành công), resolver `returns the designation machine…` |
| (3) UNVERIFIED/FAIL/expired/revoked/deployment/verifier/session → 403, state không đổi | 11 test `S2 admission denies …`, cộng test `measures session expiry with clock_timestamp after locking` (witness `now()<expires_at`, `clock_timestamp()>=expires_at`) |
| (4) operation → 404/409 | `S2 operation must be a pending row…` (thiếu, completed, lệch snapshot; cộng pending đã commit trước vẫn hợp lệ) |
| (5) action ngoài scope → 403 | `S2 action outside the persisted scope actions…` |
| (6) new root thiếu decision cùng Tx hoặc hash lệch → 403; child ngoài root → 404 | `S2 new root requires…` (thiếu, hash khác, decision đã commit ở Tx trước), `S2 root scope cannot create a new root…`, `S2 message scope without a root…`, `S2 tickets outside the scope root…` |
| (7) caller actor khác designation → 403 | `S2 caller actor other than the designation machine…` (máy B và A viết hoa) |
| (8) generic routes 404 | `S2 generic ticket routes stay 404…` (create, decisions, dependencies, signals qua Fastify với token A) |
| (9) `command` → 503 | `S2 command stays unreleased…` |
| Unification signal | `scoped signal rechecks project…` và `…root under the shared prefix before authority` |
| Thêm | `S2 port snapshots caller arguments…`, `S2 bare persisted authority without the port target fails closed`, `resolver requires a valid pinned verifier build` |

## GREEN

| Lượt | Lệnh | Kết quả |
|---|---|---|
| Biome format | `pnpm dlx @biomejs/biome@2.5.14 format --write <10 file ts sở hữu>` | exit 0 |
| Biome | `… check <10 file>` | exit 0, `Checked 10 files`, 0 warning |
| tsc | `pnpm exec tsc --noEmit --ignoreConfig --skipLibCheck --target ESNext --module NodeNext --strict --allowImportingTsExtensions --erasableSyntaxOnly --verbatimModuleSyntax --types node src/platform/picomatch.d.ts src/platform/thread-stream.d.ts src/attachments/extract/yauzl.d.ts` cộng 6 file src và 4 file test sở hữu (chạy từ `v2/server`) | exit 0, output rỗng |
| GREEN | assistant-authority, assistant-orchestration-port, assistant-mutations, assistant-orchestration, tickets, deploy, dependencies | tests 187, pass 187, fail 0, cancelled 0, exit 0, 41.5 s |
| Hồi quy | api-acceptance, assistant-store, attachments-routing, attachments-snapshots, attempts, completion, docs-read, repair | tests 102, pass 102, fail 0, exit 0, 37.4 s |

Format chạy trước tsc và các lượt test trong cùng một lần giữ slot, nên mọi lượt tính kết quả đều chạy trên source cuối. Run1 (124: 118/6) và run2 (25: 24/1) là các lượt trung gian, log được giữ lại.

## Docs

Mirror nằm trong scratchpad: `git archive HEAD:v2` (HEAD `963dc31`), commit baseline, overlay đúng 14 file của lát này, rồi chạy `packages/docs-kit/dist/crew-docs.cjs`. `generate` báo `index.md`/`files.md` unchanged; `check --all` ok; `check --staged` ok. Mirror đã xoá.

Lock manifest `$TMPDIR/crew-v2-manifest.lock` được giữ từ lúc đọc lại HEAD tới khi commit xong. Diff của `flows.yaml`/`files.md` so với HEAD chỉ gồm 2+2 dòng của lát này.

## Tài nguyên và cleanup

Heavy slot `$TMPDIR/crew-v2-heavy-slot.lock`, owner `s2-t2c`, lấy qua `mkdir` nguyên tử:

| Lần | Giữ (UTC) | Việc |
|---|---|---|
| 1 | 03:30:51–03:31:27 | RED. Trước đó chờ `web-wiring` giữ slot. |
| 2 | 04:17:59–04:18:35 | tsc run1 và GREEN run1 |
| 3 | 04:19:12–04:19:22 | run2 |
| 4 | 04:19:39–04:21:06 | Biome, tsc, GREEN, hồi quy |

Mọi lần đọc telemetry đều `heavyEligible=true`: pressure 1, available 4.5–5.0 GiB, CPU idle 76–86 %, disk khoảng 751 GiB.

Container: `postgres:18.6` local (image `4ef4dbc939d6`, không pull), `--rm --memory 256m --cpus 1 --pids-limit 64 -p 127.0.0.1::5432`. Inspect cho mem 268435456, nanoCPUs 1e9, pids 64; `pg_isready` ok ở lần thử 2.

| Lượt | Container | Port |
|---|---|---|
| RED | `crew-v2-test-cf5da7d2-…` id `548e9d26…` | 51861 |
| GREEN | `crew-v2-test-c0609c95-…` id `14c5af31…` | 61491 |
| Hồi quy | `crew-v2-test-8156b36d-…` id `f3a304d9…` | 61994 |

Hai lượt trung gian dùng container riêng, ghi trong `*-run1/run2-resource.log`.

Cleanup sau mọi lượt: `crew_v2_test_%` còn 0, `docker stop` thành công (auto-remove), `docker ps -a` rỗng, `docker inspect` báo no such object, không còn process `node --test`. Không chạm container của người khác.

## SHA256

| File | SHA256 |
|---|---|
| v2/server/src/assistant/authority.ts | `4d225a9c8586351eca961ebe37be22ebf5d2cc03f251c4e717af155d0f690d28` |
| v2/server/src/assistant/orchestration.ts | `ec359ba7920d2b4441679453196cf2053cf1f78a0227388d06970427b13c29e2` |
| v2/server/src/tickets/service.ts | `56214e1a692057b4649d750c0c5feacdd58709e568447c0cb6f106eaf3c2a121` |
| v2/server/src/tickets/assistant-access.ts | `8af3cc8a992639a891208ee7da3efccac966c3f60bcd53bb061ec2220aa65109` |
| v2/server/src/tickets/decisions.ts | `c48747f003b2cd5c6a7eccb93deb4b92f53f1dedc2d1e0bf9852e7888582d2b5` |
| v2/server/src/tickets/dependencies.ts | `0ed91f53971bbf34ad2fa916a873437a9bdc01a92ffd14ac9178e8b6145346a4` |
| v2/server/test/assistant-authority.test.ts | `6b1cac516d482f2bff5b31619bc08b1ead7b208628ce7c9f66f0a136ab4bf07b` |
| v2/server/test/assistant-orchestration-port.test.ts | `c7db513ab7f94ca52ce23c16763c39f0353e8e50700bc8d357a428db3f213b3f` |
| v2/server/test/assistant-mutations.test.ts | `2f522dd684aa4b37d0a1772728eb39f977a7e20f1468c34e0609743470328b72` |
| v2/server/test/support/assistant.ts | `31fbd5befe1ab19a52941f0efcc387cf9b1a51453183e6b8806bf0f854aedd17` |
| v2/docs/flows.yaml | `df8241470bd470cad031920e854470f9ea74641919ef71d027f7b728e598c1cc` |
| v2/docs/files.md | `12240cdf2b075fa21ae418cac502cc5331f641d170a3d97f08401beaad9953c4` |
| v2/docs/flows/server-assistant.md | `672d6c9e1f72d15a1e42b33f59adb33754a4ab25a7211b2cc43aadb30b8f906d` |
| v2/docs/flows/server-tickets.md | `0a361c1442e00a029b604ffadad6a8d47d819a104b1dc440d442cb12617dbbde` |
| task-2-c-red.log | `f08678a382bf5bd91a788bcf256ececb2997021d3e8cc7414fda2d0df9d1a7d9` |
| task-2-c-green.log | `60d28985f9ddea2e1951a0917c55a924bcdea155e2af7150c4b9699bc97c51f1` |
| task-2-c-regression.log | `01bfac67090d5289cca5d0451d4ae6f194d4f34c9eb64cd3739e608d34a7ddad` |
| task-2-c-typecheck.log | `e3b0c442…b855` (rỗng) |
| task-2-c-biome.log | `57b30860705f74f96dedf69f2172eee6a50cb9c7ca08a9182cd7708b65196a62` |
| task-2-c-docs.log | `6b564c704f0508f5902e08813c4b6e32980ce3882d3a1f0290353450971f657a` |

Các log resource/cleanup/run1/run2 khác nằm cùng thư mục, tiền tố `task-2-c-`.

## Self-review (caller và lock order)

**Caller.** Chỉ test gọi `createProjectOrchestrationPort` và `createPersistedAssistantActorResolver`. `src/` không inject ở đâu: `attempts.ts` và `routing.ts` gọi `createTicketServices` không có `assistant`. Vì vậy app vẫn trả 503.

**Lock order trong một lời gọi port**, ví dụ decision:
1. Snapshot đồng bộ.
2. `access.prepare`: khóa root, rồi các ticket theo thứ tự đã sắp, rồi project.
3. `prepareDecision`.
4. `authorize` → `verify`.
5. Resolver: guard → machine → config → designation → turn → monitor (fence), sau đó session → selection → policy receipt → capability (FOR SHARE), rồi mới đo hạn.
6. Tool operation (FOR UPDATE).
7. Membership: đọc lại các ticket đã khóa.

Create đi theo prefix của B1: `prepareTicket` khóa root → parent, rồi project. Signal giờ dùng cùng prefix với B2a. Thứ tự tickets → sessions khớp với `attachments/routing.ts` (roots → tickets → sessions).

**Hành vi B1/B2a/B2b-i không đổi**, có 187 + 102 test xác nhận, trừ các khe được đóng có chủ đích:
- Signal scoped giờ kiểm lại root/project dưới khóa và tiêu scope một lần qua `consumeAssistantScope`.
- Project của signal scoped bị khóa trước CAS thay vì sau. Mã lỗi giữ nguyên.

**Không thêm SQL hay migration**, không sửa `attempts.ts`, `commands.ts`, `gateway/*`, web hay app wiring.

## Concerns

1. **Membership cần payload thật.** `verify(tx,actor,proof,action,targetSha256)` không mang ID ticket, nên port tự ghi lại target đã chụp của chính lời gọi (WeakMap theo Tx). Authority dùng trần thì fail closed (403). Target này không cấp quyền gì; mọi quyền vẫn đến từ các hàng persisted.
2. **`operationId` chưa ràng `request_hash` với `targetSha256`.** Memo A2 chỉ yêu cầu pending, cùng turn và cùng snapshot. Một row pending đã commit từ Tx trước vẫn hợp lệ (đúng ngữ nghĩa kết quả tool `pending` của R2). B3 transport nên ràng thêm request → target.
3. **Scope message chỉ tạo được request mới.** Mọi ticket đã tồn tại phải đi qua root scope. Đây là cách diễn giải fail-closed của dòng "children inherit exact root scope".
4. **Case "sai deployment" mô phỏng row import** bằng `session_replication_role=replica`. FK/trigger 011 không cho tạo receipt deployment lạ theo cách thường.
5. **Lọt kiểm tra file sở hữu:** `files.md` được sinh lại cùng `flows.yaml` (2 dòng). Hai file này nằm ngoài danh sách "Files you may modify" trong brief, nhưng là bắt buộc theo R2/generate. Lát này đã giữ lock manifest khi sửa.

---

# Fix round 1 (review `task-2-c-review.md`): I1, I2, M1, M2, M3

**Kết quả: DONE.** Tôi viết RED trước khi sửa source. RED chạy port suite: 34 tests, 29 pass, 5 fail, exit 1. GREEN cuối 196/196 (187 test cũ cộng 9 test mới), exit 0. Hồi quy 102/102, exit 0. Scoped strict tsc exit 0 (output rỗng). Biome exit 0, 0 warning. crew-docs `generate`/`check --all`/`check --staged` đều ok. Lượt này không thêm SQL hay migration, không sửa wiring, và app production vẫn trả 503.

## Sửa

| Mục | File | Thay đổi |
|---|---|---|
| I1 | `v2/server/src/assistant/orchestration.ts` | Câu truy vấn operation thêm `xmin=pg_current_xact_id()::xid`, tức row phải do chính Tx hiện tại ghi (cùng cơ chế với `verifyNewRoot`). Row đã commit từ Tx trước trả 404 `ASSISTANT_OPERATION_NOT_FOUND`. Mỗi authority giữ `WeakMap<Tx, Set<operation_id>>` theo `operation_id` chuẩn hoá từ DB; lần dùng thứ hai trong cùng Tx trả 409 `ASSISTANT_OPERATION_CONSUMED`. Operation được tiêu ngay khi đã hợp lệ, trước bước membership. |
| I2 và M3 | `v2/server/src/assistant/authority.ts` | Tra session thẳng theo `id=turn.read_session_id and admission_id=turn.admission_id` (M3). Khoá grant FOR SHARE trước session, theo thứ tự grant → session của plan. Grant phải: `revoked_at is null`; `expires_at>clock_timestamp()` (đo cùng statement sau khoá); `machine_id` bằng máy designation; `snapshot_id` bằng snapshot của session; `designation_id` và revision khớp fence. Ngoài ra kiểm `session.grant_id` bằng grant đã khoá. Mọi lệch trả 403 `ASSISTANT_ADMISSION_DENIED`. |
| M2 | `orchestration.ts` | `verifyNewRoot` thêm `for share of m` khi đọc `attachment_messages.input_revision`. |
| M1 | `v2/server/test/assistant-orchestration-port.test.ts` | Thêm các biến thể deny vào bảng admission: capability hết hạn, receipt sai máy, session sai máy, session sai snapshot, `read_session_id` trỏ session khác. |
| Test I1 | cùng file, `v2/server/test/support/assistant.ts` | `run` nhận thêm `operationId` dạng hàm, để seed operation ngay trong Tx đang test. Test operation đổi lại: row completed và row lệch snapshot được ghi trong Tx; row pending đã commit từ Tx trước giờ phải bị 404 (thay assert cũ "still authorizes"). Thêm test `S2 one operation authorizes exactly one mutation in its Tx`: decision thành công, sau đó signal dùng cùng proof bị 409 và toàn bộ Tx rollback. Test new-root với decision đã commit nay dùng operation ghi trong Tx có `operationId` chọn trước, để vẫn đúng là nhánh decision khác Tx bị chặn. `seedToolOperation` nhận `operationId` tuỳ chọn. |
| Test I2 | port test | Thêm 3 test: grant bị thu hồi theo đúng câu SQL re-route của `attachments/routing.ts` trong khi session vẫn `reserved`; grant hết hạn; grant cấp cho máy khác. |
| Docs | `v2/docs/flows/server-assistant.md` | Mô tả kiểm grant, operation cùng Tx dùng một lần, khoá message. Thêm một dòng precondition: gọi port trong `mutate()` hoặc khoá `event_cursor` trước root (W4); router ghi trực tiếp trong Tx, không qua savepoint, và ghi decision trước khi tăng `input_revision` (W5). `flows.yaml` và `files.md` không đổi nên lượt này không cần lock manifest. |

Biến thể giả lập dữ liệu import (capability hết hạn, receipt sai máy, `read_session_id` khác) dùng `session_replication_role=replica` trong một Tx tamper riêng, cùng lý do như W1.

## RED (trên source `3fddbeb`, test mới)

Lệnh: `node --test --test-concurrency=1 --test-timeout=120000 v2/server/test/assistant-orchestration-port.test.ts`. Môi trường: `NODE_OPTIONS=--max-old-space-size=384`, PG riêng port 50187.

Kết quả: tests 34, pass 29, fail 5, exit 1. Cả 5 test fail đều là "Missing expected rejection", tức là semantic:
- `grant revoked by re-route while session stays reserved`
- `grant expired`
- `grant for another machine`
- `operation must be a pending row written in this Tx` (fail ở nhánh row đã commit từ Tx trước)
- `one operation authorizes exactly one mutation`

Năm biến thể M1 đã PASS ngay ở RED. Điều này đúng kỳ vọng: các nhánh đó đã có trong code, lượt này chỉ thêm test để khoá chúng lại.

Hash tại RED: authority `4d225a9c…`, orchestration `ec359ba7…`, port test `b614d15a…`, support `f38f2e73…`.

## GREEN

| Lượt | Lệnh | Kết quả |
|---|---|---|
| Biome format | `pnpm dlx @biomejs/biome@2.5.14 format --write <10 file>` | exit 0 |
| Biome | `… check <10 file>` | exit 0, `Checked 10 files`, 0 warning |
| tsc | Cùng lệnh scoped strict như lượt đầu | exit 0, output rỗng |
| GREEN | assistant-authority, assistant-orchestration-port, assistant-mutations, assistant-orchestration, tickets, deploy, dependencies | tests 196, pass 196, fail 0, cancelled 0, exit 0, 45.5 s |
| Hồi quy | api-acceptance, assistant-store, attachments-routing, attachments-snapshots, attempts, completion, docs-read, repair | tests 102, pass 102, fail 0, exit 0, 38.9 s |

Lưu ý: lượt hồi quy chạy trên working tree đang có thay đổi chưa commit của worker khác (`v2/server/src/tickets/routes.ts`, `v2/server/src/journal/routes.ts`). Lát này không chạm hai file đó.

## Docs

Mirror tạm dựng từ `git archive HEAD:v2` (HEAD `694fb49`), overlay 5 file. `generate` không đổi file nào; `check --all` ok; `check --staged` ok. Mirror đã xoá.

## Tài nguyên và cleanup

Heavy slot owner `s2-t2c`:
- 04:48:39–04:48:51 UTC: RED, sau khi chờ slot bận.
- 04:51:31–04:53:03 UTC: Biome, tsc, GREEN và hồi quy.

Telemetry mọi lần đều `heavyEligible=true`: pressure 1, available 4.05–4.78 GiB, CPU idle trên 80 %. Container `postgres:18.6` local, 256m, 1 CPU, pids 64, loopback port 50187 (RED), 51273 (GREEN), 51837 (hồi quy). Cleanup cả ba lượt: `crew_v2_test_%` còn 0, container đã stop và auto-remove, `docker inspect` báo no such object, không còn `node --test`.

## SHA256

| File | SHA256 |
|---|---|
| v2/server/src/assistant/authority.ts | `5f300e5e4333d44e5d22c2bff8f6470179d1d496d2937e637afa5081fcc9dc27` |
| v2/server/src/assistant/orchestration.ts | `e395d9771c650e11f5eb812e4bf15033365bec211c811bb5d7138586d76f95a4` |
| v2/server/test/assistant-orchestration-port.test.ts | `e2b5bf5dd0fbc9205c87f3c9ba9f001b464b259841bb438d221582936d0431e9` |
| v2/server/test/support/assistant.ts | `f38f2e73c5769d2952215b7ce8a601288770c8d619d997fd2e52455eb132e188` |
| v2/docs/flows/server-assistant.md | `b586ddb42e6fcdc91be8107dd4099088e31b6f9e15df064b38f2eef696c4b076` |
| task-2-c-fix1-red.log | `fc076b9a6ded63fca0a1123a0e475adcf085d5d7c4663d9c8b403a388d90c451` |
| task-2-c-fix1-green.log | `1ae05652d9503b33f656a4817e36d7e9b3da83b5b557a3d94ef0e08fb6db61cd` |
| task-2-c-fix1-regression.log | `243eb5da039a494034b3a596a96e9f3eb134f1cfadb1e9a58bb2f799cff6d164` |
| task-2-c-fix1-typecheck.log | `e3b0c442…b855` (rỗng) |
| task-2-c-fix1-biome.log | `723e07d61baca9a940e9218dc2e8d565525db53626aef91e6d54e717d567ca31` |
| task-2-c-fix1-docs.log | `d1857e0ecc2a4f0226080c1be7cd3fdfb21d5c61128e8e316d3681fc0a51efdd` |

## Còn lại

- Ngoài lát này, `attachments/routing.ts` lúc re-route không đổi state của session `reserved`. Resolver giờ đã chặn trường hợp này qua grant, nhưng writer đó vẫn nên được owner phase05/T5 xử lý cho nhất quán.
- Ràng buộc `request_hash` ↔ `targetSha256` vẫn để B3 làm, theo ruling 15:00.
- M2 không có test đồng thời riêng; lượt này chỉ thêm khoá và ghi precondition.
