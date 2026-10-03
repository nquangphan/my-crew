# Phase 07 — Scoped re-review FIX1

**Status: Approved trong phạm vi FIX1 R1–R5.** Cả năm finding được khép ở mức kế hoạch; không phát hiện blocking regression trong delta đã rà. Kết luận cho phép controller dùng DAG đã sửa khi các producer/resource gate tương ứng mở; không chứng nhận web đã triển khai hoặc nghiệm thu E2E.

Review STATIC ngày 2026-10-03 tại `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`, dùng tiêu chí completeness/spec alignment/decomposition/buildability của `writing-plans/plan-document-reviewer-prompt.md`. Chỉ rà R1–R5 và contract vừa đổi; không làm lại full-branch review. Không chạy Git/index, source mutation, test/build, dependency, browser, DB, container, model hoặc child agent. Chỉ tạo báo cáo này.

## Đầu vào đã đối chiếu

| Artifact | SHA256 |
|---|---|
| `phase-07-web.md` FIX1 | `58506c23236b70c7318d1261e7e7115cc158e92e2a2ef33e1f3b4dd9232b7d15` |
| `phase-07-plan-report.md` | `f1a25176cb2fd7b2db73a7d06c916a8432ea7f22ebff6eb91168d17f0d5d9bff` |
| `phase-07-plan-fix1.diff` | `b32b7a71390c1c1002ee4ba5022205a9d3335492af5747b9d5a2f415227b2874` |
| Review gốc `phase-07-plan-review.md` | `bc3c1bd0c01b0f8a90124772e5c80fc214a680f32f9feaf6acde56d5e6e54f87` |

Các artifact trên nằm trong `plans/261002-0002-crew-v2/`. Citation `plan:L` dưới đây là `plans/261002-0002-crew-v2/phase-07-web.md:L`, tương đối workspace trên. Đã đọc report FIX1, các hunk delta liên quan và ngữ cảnh task hiện hành; chỉ đọc lại producer trực tiếp liên quan tới các sửa đổi.

## Verdict từng finding

### R1 — CLOSED: Recovery qua hết phiên và logout đã tách riêng

**Bằng chứng plan:** `plan:202` định nghĩa owner/intent/key và trạng thái suspended; `plan:208` tách RecoveryTombstone; `plan:254` cấm cấp key mới khi ý định còn ambiguous/suspended/unresolved. `plan:255` giữ exact nonsecret body/key/compose revision khi401, khóa writes, scrub credential/cache, rồi GET session xác minh same owner và replay với CSRF mới. `plan:256` xử lý deliberate logout khác expiry: wipe payload/secret, chỉ giữ tombstone, nhập lại exact input cùng key hoặc tiếp tục pending nếu không còn dữ liệu. Không có receipt endpoint tự bịa, không lưu secret/hash của secret, không chuyển409 sang key mới.

**Trace đối chiếu:** `getSession` tại `v2/server/src/auth/session.ts:95` kiểm missing/revoked/expired và trả401 tại dòng101–104. `createMutator` tại `v2/server/src/journal/mutation.ts:29` scope theo actor/route/key, authorize ở dòng33 trước receipt lookup dòng35; cùng body replay dòng39, khác body409 dòng38. Atomic attachment route `v2/server/src/attachments/routes.ts:220` xác thực trước mutator và recheck credential tại dòng228. Đăng nhập lại same owner với key/body cũ phù hợp contract producer.

**Acceptance đã giao:** `plan:258` có baseline project commit→lost reply→expiry→UI reauth→same-key replay và một entity/receipt ở A2, không phụ thuộc composer; atomic ticket/comment thuộc A5/A3 tại `plan:289` và `plan:398`. Logout tombstone, secret memory-only và wrong-body409 có negative cases. R1 được sửa bằng state/lifetime contract, không chỉ thêm câu khẳng định.

### R2 — CLOSED: Harness sớm và DAG source/acceptance tháo vòng cũ

**Bằng chứng plan:** `plan:148` tách S và A, source commit không thành task/phase accepted. `plan:150`–152 liệt kê predecessors/topological order; S3b tiêu thụ S5a, A3 chờ A5, A4 chờ A3, A8 chờ các feature acceptance. Task1 sở hữu harness/config/support/lifecycle tại `plan:155` và `plan:161`; Task8 chỉ dùng lại tại `plan:465` và `plan:473`. Mỗi feature sở hữu E2E spec riêng.

Hai vòng gốc đã có đường thoát cụ thể: A1 dùng HTTP login test-only, không chờ login UI ở Task2 (`plan:154`, `plan:186`); screenshot Task1 chỉ shell, ảnh board/docs/map/dialog chuyển về task tạo chúng (`plan:188`). A5 mount shared composer trong fixture host, gọi API/DB thật, không cần Task3; integrated ticket/dialog được kiểm ở A3/A4 (`plan:153`, `plan:287`, `plan:339`). Không phải clone production composer hoặc thêm runner thứ hai.

**Trace đối chiếu harness:** `captureMigrations` tại `v2/server/src/db/migrate.ts:20` trả prefix đã băm; `databaseFixture` tại `v2/server/test/support/db.ts:11` giữ DB trong callback, đóng pool tại dòng53 và drop DB trong finally tại dòng57. `plan:178` đã chỉ rõ callback phải sống suốt run và UNKNOWN không được rơi vào cleanup force. `bootstrapOwner` tại `v2/server/src/auth/bootstrap.ts:7` là bootstrap private fixture, không yêu cầu endpoint production mới. `buildApp` tại `v2/server/src/app.ts:30` giữ caller ownership và default-deny.

**Acceptance không bị hạ:** `plan:185`–186 yêu cầu isolated API/PostgreSQL thật, exact resource ownership và STOP trước cleanup; `plan:526` phân phối actual feature acceptance theo DAG; `plan:539` giữ Playwright MCP bắt buộc, thiếu thì pending. S không được dùng thay A. Không còn blocker Task8→Task1/2/3… trong DAG đã khai báo.

### R3 — CLOSED: CreateTicket có form owner và controlled composer contract

**Bằng chứng plan:** `plan:269` giao create-request/state/test cho Task3. `plan:280` có RequestFormFields; `plan:288` map đầy đủ CreateTicket và target, với kind/title/description/workflowChoice do form cung cấp. `plan:353` phân biệt ticket/comment/message; `plan:368` freezeSubmission nhận exact submission/selection/intent/operation; `plan:370` có controlled input/change/state/receipt callbacks. `plan:377` phân định form metadata và file/session state, không shadow-copy, khóa form khi sending/ambiguous/suspended. Bảng `plan:379` và validation tại `plan:385` chốt exact body/path và giữ key/clientMessageId qua retry.

**Trace đối chiếu:** `CreateTicket` tại `v2/server/src/tickets/contracts.ts:7`, `ComposeTarget` tại `v2/server/src/attachments/contracts.ts:28` và strict atomic schema tại `v2/server/src/attachments/routes.ts:117` là các contract đã đối chiếu ở review gốc. Delta message receipt khớp `AssistantMessage` tại `v2/server/src/attachments/contracts.ts:270`; route `v2/server/src/attachments/routes.ts:685` nhận conversationId/clientMessageId/text/selection/assistantRead và trả kết quả submit, không reply giả. Empty selection cho ticket không file phù hợp ready-set comparison tại `v2/server/src/attachments/submissions.ts:141`–148: active set rỗng và selection rỗng khớp nhau, vẫn phải có compose hiện hành.

**Acceptance đã giao:** `plan:289`, `plan:387` và `plan:487` kiểm exact persisted fields, code/research × BMAD/Superpowers × có/không file, target mismatch, payload bất biến và retry/reauth một entity. Task3 không còn phải tự phát minh dữ liệu bắt buộc hoặc sửa ownership Task5 để tạo request.

### R4 — CLOSED: Login/reauth và onboarding có owner, route và test cụ thể

**Bằng chứng plan:** Task2 sở hữu login/session-boundary/auth recovery/E2E tại `plan:197`. SessionClient tại `plan:215` và `plan:257` có login unauthenticated riêng, không đi qua protected OwnerClient/PendingOperation; có guest/expired state, throttle/bootstrap errors, safe internal return route và logout wiring.

Task7 sở hữu machine onboarding/project setup/test tại `plan:436`; `plan:448` nhận token transient không cache/persist/log/evidence; `plan:449` map project create và binding CAS; `plan:450` giữ ACTIVE_EXECUTION guard, không kill/pause tự động để rebind. A7basic độc lập G3/G4 tại `plan:451` tránh chờ chức năng tương lai để nghiệm thu baseline onboarding.

**Trace đối chiếu:** POST machine tại `v2/server/src/auth/routes.ts:152` kiểm owner+CSRF dòng165, mutator/key dòng166–173; `provisionMachine` tại `v2/server/src/auth/machine.ts:9` tạo machine/token và trả `{machine,token}` dòng23. `bindProject` tại `v2/server/src/projects/service.ts:85` kiểm path/revision, khóa project dòng101, CAS103, live machine105, guard107 rồi update109. `assertNoActiveProjectExecution` tại `v2/server/src/execution/attempts.ts:354` từ chối active/uncertain/finalizing/active guard dòng356–357. Plan dùng những producer hiện hữu; không thêm service hoặc authority riêng cho UI.

**Acceptance đã giao:** Clean browser login→register→create project→bind→reload, two-tab stale409, active/uncertain rebind409, token/password không xuất hiện trong storage/cache/log/evidence. Browser không bị giả định đã có cookie/fixture IDs. Coverage thiếu trong R4 đã được giao thực thi cụ thể.

### R5 — CLOSED: Attention question và nonquestion có consumer cùng resolution semantics

**Bằng chứng plan:** `plan:405` giao attention/state/unit/E2E cho Task6; `plan:424`–427 chốt panel/navigation, pagination/loading/error/stale, question và docs/model/machine/version/intervention/cleanup items, scoped deep link và server resolution. Chỉ đóng panel/dismiss không cấp approval hoặc tự resolve; action chỉ gửi sau freeze exact G3 method/body/revision/auth/idempotency. Không suy owner HTTP từ OwnerQuestion và không tạo browser monitor.

Task2 attention query key/invalidation tại `plan:235` và `plan:261` được nối với dedup/revision/refetch ở `plan:426`. Case item không phải question, refresh/reconnect không mất/trùng, server resolution và wrong-scope action có API/PG+MCP acceptance ở `plan:427`. Missing G3 wire vẫn là future gate, không được thay bằng fake data để PASS.

**Kết luận:** Consumer bị thiếu đã có owner/flow/test; chưa cần và không được bịa DTO/HTTP trước producer freeze. R5 được khép ở mức plan.

## Regression và giới hạn kết luận

- Không phát hiện blocking regression trong batch. Readonly snippets đã sửa (`plan:230`, `plan:279`). Shared harness/controller và feature-file ownership được tách; không thêm graph service, scheduler, second composer hay auth bypass.
- Graph topology, same-source board/list/map và giữ viewport/dialog vẫn giữ acceptance; FIX1 chỉ chuyển lịch/test ownership. API–PostgreSQL thật và Playwright MCP vẫn bắt buộc (`plan:483`–496), không có mock/unit-only completion.
- Effort tại `plan:144` là96h base +16h allowance =112h planning budget. Đã phân bổ thêm harness/auth/create/attention/onboarding; ghi rõ không là benchmark/cam kết và không gồm producer wait. Không dùng con số này làm bằng chứng năng suất.
- Không rà lại các producer gap không thuộc delta. UI approval owner vẫn có hiệu lực, không cần hỏi lại UX. G0–G6 còn phải mở theo handoff và acceptance hiện hành; approval report này không tự mở một gate.

## Producer fact tại thời điểm re-review

Theo dispatch controller, Assistant T1 đã **ACCEPTED tại commit `feaea55` sau full review + FIX1 + FIX2 READY**; authority T2–T7 vẫn pending/default deny. Không dùng Git để xác minh commit trong lượt STATIC này. Đã đối chiếu file trực tiếp:

- `v2/server/migrations/011_assistant.sql`: SHA256 `fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841`.
- `v2/server/src/assistant/contracts.ts`: SHA256 `adee25f453fa91e7498a1a300d3c7a4761147b8584e738a54818d9cb4b65412f`, khớp typed contract controller cung cấp.
- `buildApp`, `v2/server/src/app.ts:33`–34, vẫn mặc định deny dispatch/final result nếu không có trusted authority.

Các đoạn plan/report nói candidate011 chưa accepted là snapshot lúc tác giả viết, đã cũ so với thông tin controller vừa giao; không xem là regression FIX1 và không sửa plan để thay lịch sử. T1 accepted không đồng nghĩa owner wire/routing/attention/runtime assembly của toàn G3 đã mở.

## Handoff

R1 CLOSED; R2 CLOSED; R3 CLOSED; R4 CLOSED; R5 CLOSED. Không còn yêu cầu sửa blocking trong phạm vi re-review này. Controller có thể khép FIX1 plan review và giao các mốc source/acceptance đúng DAG khi producer/quota/resource gates cho phép. Không có câu hỏi mới cần owner quyết định; real implementation/test evidence vẫn phải được tạo ở từng task.
