# Phase06/T1 — Báo cáo chuẩn bị schema và durable work inbox

Trạng thái lúc 2026-10-03 17:00 Asia/Ho_Chi_Minh: **actual schema RED đã quan sát; chưa implementation, chưa nghiệm thu**. PM cấp riêng RED-only slot; đã chạy PostgreSQL18.6 prefix010 thật, 1 test chạy/0 PASS/1 expected FAIL `42P01 relation assistant_work_inbox does not exist`. Toàn bộ runtime fixture đã đóng và dọn, slot trả PM; chờ quyền viết production011/store/inbox/contracts. Các đoạn chuẩn bị bên dưới là lịch sử trước RED; actual receipts cuối báo cáo là trạng thái mới nhất.

## Phạm vi và nguồn

- Worktree: `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`.
- Baseline được PM chỉ định: `0c838d2`; producer009 accepted `ec02ac0`, comment010 accepted `f6d3728`. Chưa tự thực hiện Git archive/đối chiếu HEAD trong lượt static; chưa có executable frozen fixture.
- Đã đọc toàn bộ task brief, approved spec, `docs/index.md`, `v2/docs/index.md`, các flow journal/attachments/execution trước thiết kế test. Skill TDD và writing-good-tests đã đọc; worker không spawn agent khác.
- Test dùng actual `Event`, `MessageSubmission`, `createMessageServices`, `appendComment`, journal và fixture009. Không dựng HTTP Assistant, grant authority, model inference hoặc production routing certificate.
- Chỉ tạo `v2/server/test/assistant-store.test.ts` và `v2/server/test/support/assistant.ts`, cùng báo cáo này. Migrations001–010, manifest, app, gateway, package, shared Git index không được sửa.

## Quyết định PM và các gate

PM xác nhận lúc 16:48:

1. `enqueueWork`/`ingestEvents` dùng authority của transaction event_cursor/monitor, không cần live turn. Inbox phải tiếp tục tích lũy khi không designation/offline; ingestion không được tự tạo turn.
2. `claimWork`/`ackWork` phải đối chiếu exact persisted designation/process/generation/state và TurnFence hiện hành.
3. Cho phép additive `reconcileWork(tx)` quét revision ticket/message thật để bù wake bị bỏ lỡ, khử trùng cùng target/revision/work kind với event work. Hàm này không bootstrap/model authority và không đổi counter009.
4. Fixture T1 chỉ dùng DB thực/producer009 và test-only SQL fence seed. HTTP clients/certification/executable-run production của T2–7 chưa có; giữ producer gate, không giả API.
5. Heavy slot vẫn chưa mở; phải thấy actual expected missing-schema/service RED trước khi viết production code.

PM chốt bổ sung lúc 16:49:35:

- Shared monotonic allocator dùng `assistant_monitor.generation` cho normal turn và calibration. T1 export persistence-only `allocateAssistantGeneration(tx)`, atomic UPDATE RETURNING dưới cùng guard/singleton authority lock, bigint không reset/overflow phải fail. Caller T2 chỉ gọi trong transaction reserve/admission thành công, bind exact launch/turn; allocator không cấp authority hay commit riêng.
- Giữ nguyên columns011: non-null `input_revision` chỉ input wake; null là lifecycle event wake. Partial unique `(target_kind,target_id,input_revision)` khi non-null áp dụng cả pending/claimed/acked. Conflict vẫn tiến event cursor; giữ original source cursor/logical key/history, không overwrite claimed/acked receipt. Lifecycle events giữ logical key cursor riêng. Không thêm `work_kind`.

## Test đã soạn

Mười ba test hành vi `assistant store` đã soạn, **chưa chạy**; thêm một schema test đã chạy RED thực tế. Tổng14 test, chỉ1 test đã chạy:

1. Message chưa route giữ đúng ID/conversation/text, pending và không tạo thêm ticket qua duplicate ingestion và đóng/mở pool.
2. Crash rollback cả inbox INSERT và monitor cursor; retry phục hồi một wake.
3. Cursor tăng theo event, không skip message sau hoặc lùi khi ingest cursor cũ.
4. Hai connection ingest đồng thời chỉ tạo một work cho cùng event.
5. Legacy root comment fanout đúng descendants và không bump lại counter009.
6. Child comment không đánh thức ancestor/sibling.
7. Event nội bộ `probe` không tạo inference work nhưng cursor vẫn tiến.
8. Revision scan phục hồi message chưa route, idempotent và không trùng khi event đến sau; không mint turn.
9. Revision scan nhận revision mới của child và giữ sibling; không mint turn.

10. Hai input events cùng revision giữ một wake, bảo toàn source cursor/logical key ban đầu; monitor cursor vẫn tiến.
11. Hai lifecycle events từ actual ticket service không bị dedup nhầm chỉ vì input revision không đổi.
12. Claim bằng fence chưa persist bị409 và giữ work pending.
13. ACK mere delivery bằng fence chưa persist bị409 và không đổi turn/attempt/ACK state.

Test 8–9 đã lọc input wake theo ruling non-null revision. Các test fence/ACK409, turn uncertain guard, generation/calibration, immutable linkage, R1–R4 constraints/hook, effect hex64/ordinal, schema backup/restore còn phải bổ sung theo TDD trước implementation tương ứng.

## Kiểm tra tĩnh và lỗi đã gặp

- `pnpm exec biome check` hai file: lần đầu FAIL duy nhất vì format; đã format và chạy lại PASS (2 files, 20ms). Đây chỉ là kiểm tra tĩnh, không phải test hoặc typecheck PASS.
- Không chạy `pnpm test`, `node --test`, PostgreSQL, Docker, native fixture, install hoặc live/paid provider call.
- Một shell write bị hook `.ckignore` từ chối vì comment chứa chuỗi trông như path `target/revision`. Lệnh không chạy; dùng công cụ patch cho đúng hai file được giao sau khi bỏ comment gây nhận diện nhầm. Không đổi hook/ignore.
- Lệnh đọc kèm đường dẫn binary trong `node_modules` bị hook từ chối; không chạy. Dùng `pnpm exec biome` là entrypoint chuẩn, không đọc dependency tree hoặc đổi ignore.

## Hash và tài nguyên

Inventory file sau kiểm tra tĩnh:

| File | Bytes | SHA256 |
|---|---:|---|
| `v2/server/test/assistant-store.test.ts` | 17847 | `93cccf9d20a876f52d2ca06f450833e9c498fd6136e308f3e1dfe7ebbfd755da` |
| `v2/server/test/support/assistant.ts` | 2654 | `49eaf7c09405fff55d722d48f5884585dcd7c316e0e464127b09f2c465478150` |

Telemetry dispatch PM 16:39: pressure2 WARN, available4.58GiB, CPU85%idle, disk34GiB. PM refresh16:48: pressure2, idle74.59%, available khoảng5.1GiB, disk34GiB. Worker chỉ chạy đọc/ghi file và Biome nhẹ; vm_stat16:47 có free15862 pages/inactive308140 pages (page16KiB), không suy đây là quyền chạy fixture.

Không tạo container/database/process nền/root tạm nên không có tài nguyên runtime cần cleanup. Các shell/Biome đã exit. Root nonce/dev/inode/UID và child/container PID/argv/port phải ghi **trước lần create thực tế** khi được cấp slot; chưa có bằng chứng đó.

## Phần còn lại trước nghiệm thu

1. PM cấp slot bằng telemetry mới; hai ambiguity schema đã chốt như trên.
2. Freeze accepted HEAD read-only/archive + đúng own overlays, loại access FIX2/parser/runtime chưa review; ghi SHA/bytes manifest trước chạy.
3. Ghi owner/nonce/dev/inode/UID và process/port identity; tạo private PG18.6 khác5432/55432; actual expected RED.
4. TDD toàn schema011/contracts/store/inbox và các constraint/hook R1–R4; unknown process không release bằng TTL, budget default0/uncertain giữ nguyên.
5. Backup prefix010 trước migration, prefix011 checksum/backup/restore với data/hash rehearsal; focused tests và server typecheck/Biome/R3 sau source cuối.
6. Viết flow `server-assistant.md` đúng7 H2 tiếng Việt phản ánh source đã triển khai; PM sở hữu manifest mapping/commit.
7. Đóng child/pool/container, kiểm identity trước cleanup, báo receipt thực tế; independent SPEC/QUALITY review và controller integration còn pending.

## Ma trận constraint tĩnh trước SQL011

Đây là checklist thiết kế, **chưa phải bằng chứng constraint đã tồn tại/đạt**. Mọi kiểm tra SQL phải chạy trên prefix011 thật, với positive baseline rồi negative mutation, trước khi freeze checksum.

| Nhóm persistence | Constraint và ca kiểm tra cần viết/chạy |
|---|---|
| `assistant_designations`, `assistant_config` | Một designation current, revision dương/unique, exact machine FK; config singleton, deployment UUID bất biến, preferred nullable, policy strict/paid budget mặc định0. Hai current designation hoặc thay deployment bị từ chối. |
| `assistant_monitor`, `assistant_calibration_guard` | Cursor không âm, generation bigint dùng chung normal/calibration, increment atomic/rollback và overflow không wrap; singleton calibration không giải phóng bằng expiry. |
| `assistant_turns`, `assistant_model_selections` | Exact conversation/message liên kết009, designation revision, process UUID/generation/model selection unique; circular turn/selection FK deferred. Singleton live turn giữ qua reserved/running/uncertain/finalizing; stale process/generation/designation ACK409. Đổi conversation/message hoặc model-selection owner sau reserve bị chặn. |
| `assistant_policy_receipts`, `routing_capability_receipts` | Receipt routing-only gắn deployment/challenge/machine/model/binary/policy/probe context/OS; probe và evidence immutable, chỉ revoke timestamp riêng. Không nhận workflow008 receipt hoặc context mismatched; fixture receipt không là production authority. |
| `routing_certification_challenges`, `routing_certification_evidence` | Nonce lưu hash hex64, bounded expiry/budgets ở service; exact immutable context và launch, challenge/receipt FK, launch unique. Evidence body/hash append-only; changed launch/body replay không gia hạn expiry/budget. Verify authority thuộc T2. |
| `assistant_scopes` | Exactly one message/root, project null chỉ pre-route message; exact snapshot/hash, actions/tool names finite và không wildcard, expiry/authorization pinned. Claim/ACK không tự mở scope mới. |
| `assistant_work_inbox` | Unique logical key; partial unique input revision xuyên event/reconcile và terminal ACK. Pending không có ACK timestamp; claimed/acked giữ turn + generation matching. Payload chỉ IDs; original source cursor/history giữ bất biến. |
| `workflow_runs`, `workflow_steps`, `workflow_gates` | Pinned source/projection/definition/customization hashes; run revision dương; step ticket UNIQUE; run/step/root/scope/gate FK nhất quán; decision gắn artifact/hash và required_actor owner/delegated, không đổi approval sang artifact khác. |
| `assistant_questions`, `assistant_answers` | Question revision/scope/optional run/step/gate/cycle pin; UNIQUE(question_id,question_revision). Answer content/scope immutable, không chuyển answer sang revision/cycle khác. |
| `assistant_assessments`, `assistant_dispatches` | Exact ticket/input snapshot + body/hash; command PK/decision/run/step/assessment restrictive FK, permit persisted. Không thay đổi005 permit/007 selection/008 choice/009 pin schema. |
| `assistant_capacity_requests`, `assistant_capacity_receipts` | Request machine/ticket/kind/ownership/boot/expiry, unique receipt liên kết request và UNIQUE(machine,request). Receipt immutable không kéo dài TTL. Sample/request freshness và actual telemetry adapter thuộc T4. |
| `assistant_reservations` | Command unique, receipt/machine/ownership exact, states reserved/active/retiring/released. Không release bằng deadline; claimed cần stop+accepted finalization, unclaimed cần R4 proof. |
| `assistant_dispatch_retirements`, `assistant_launch_authorizations` | Command PK, retirement/launch IDs unique, exact machine/process/boot/generation và attempt nullable unique. AFTER INSERT attempts hook chỉ áp dụng assistant dispatch, match launch process/machine/state và bind attempt/reservation atomically; mismatch rollback. Prefix005 claim giữ nguyên. |
| `assistant_route_authorizations` | Route PK, parent/derived009 authorization restrictive FK, derived UNIQUE, exact parent scope hash. Parent expiry/allowOriginal/scope không tăng; revoke/route current check do actual009 trusted bridge thuộc T2/phase05. |
| `assistant_tool_operations` | Operation PK + UNIQUE(turn,client_sequence); immutable provider mapping/request hash/snapshot, state và persisted response atomic với service/event. ProviderCallId/fallback không cấp lại effect. |
| `assistant_operation_ids` | UUID operation/run/step, effect TEXT lowercase hex64 UNIQUE, UNIQUE(step,action,target_identity,precondition). Intentional repeat giữ ordinal bền vững trong target identity, không suy từ provider call hoặc argsHash. |
| `assistant_interventions` | Work FK, operation UNIQUE, UNIQUE(work,action,state_digest) để suppress unchanged intervention; retry/attempts không âm. |
| `assistant_text_receipts`, doc read receipts | Session/snapshot FK009 và reported_transport trust duy nhất; doc receipt exact turn/docs snapshot/path/hash. Hash transport không chứng minh semantic comprehension. |
| `assistant_budget_reservations` | Conversation/run scope, command UNIQUE nullable, reserved/spent numeric hữu hạn không âm, state reserved/settled/uncertain. Restart/fallback giữ reservation; unknown spend không release bởi timeout. |

Producer gap đã được PM xác nhận lúc16:54:46: prefix001–010 chỉ có `evidence(id,ticket_id NOT NULL,attempt_id nullable)`, chưa có standalone artifact table cho checkpoint/stop của inbox chưa route hoặc R1 trace artifact. Không thể tùy tiện FK mọi artifact UUID vào ticket evidence. PM chốt giữ typed UUID nullable như approved, không invented evidence FK/table; T2/native producer phải verify identity/checksum/current turn/scope trước ghi pointer, default deny nếu thiếu. Artifact ID đơn thuần không cho phép stop/release. Không tạo artifact table/authority giả.


## Bằng chứng đã tách riêng

Raw receipts, log và155file manifest nằm trong `task-1-evidence/`; bản báo cáo RED cũ được giữ nguyên ở `historical-red-report.md`.

- [historical-red-report.md](task-1-evidence/historical-red-report.md): 46043 bytes, SHA256 `e88c17c9f87b6f93f6316506f2f8ffeaf2fbdb910456e466555d32fc744018f7`.
- [initial-red-receipts.json](task-1-evidence/initial-red-receipts.json): 6916 bytes, SHA256 `0445a05924db83a55f118c1905bbdb3b0c7aa23d1e9b82ec7ea47df9ee5a81e6`.
- [initial-red-source-manifest.json](task-1-evidence/initial-red-source-manifest.json): 24846 bytes, SHA256 `b0687326097c68261a1923ea38952b98c7df4268151daafbed519cdaf8b9641e`.
- [initial-red.log](task-1-evidence/initial-red.log): 2144 bytes, SHA256 `c23e305f6fcf2a7314f4541da3c73ff4f570c31b239d9214deab359af7349de2`.

## Cập nhật implementation chưa nghiệm thu

PM đã cho phép sourceauthoring sau actual RED. Đã viết migration011, contracts/store/inbox và thêm fixture SQL turn + tests. Chưa có GREEN. First cover17:20:22 bị resourcegate từ chối vì CPUidle19.69%; không tạo root/container/process, receipt `task-1-evidence/task-1-first-cover-pressure.json`. Tiếp tục static; mọi vòng PG/runner phải freshgate theo PM.
