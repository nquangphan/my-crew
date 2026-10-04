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

## Actual RED-only sequence receipts

```json
[
  {
    "kind": "resource-before-container",
    "timeUnix": 1791021599.39144,
    "data": {
      "pressure": "1",
      "estimatedAvailableBytes": 6603358208,
      "method": "free+inactive+speculative",
      "idlePercent": 83.6,
      "diskBytes": 35276234752
    }
  },
  {
    "kind": "container-intended",
    "timeUnix": 1791021599.391532,
    "data": [
      "docker",
      "create",
      "--name",
      "crew-v2-test-0fa614be-c98e-4cd1-9007-43df33940da6",
      "--label",
      "crew.phase06.task1=34cd2e6f-d460-41b6-af51-2c122abf80b2",
      "--memory",
      "256m",
      "--cpus",
      "1",
      "--pids-limit",
      "64",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      "POSTGRES_DB=crew_v2_test",
      "-p",
      "127.0.0.1::5432",
      "postgres:18.6"
    ]
  },
  {
    "kind": "container-created",
    "timeUnix": 1791021599.807478,
    "data": {
      "id": "a237bbd1f2b2a7c99decc7f1ed4b157b676076a78f70bb6b0254435b2acac112",
      "name": "crew-v2-test-0fa614be-c98e-4cd1-9007-43df33940da6",
      "memory": 268435456,
      "nanoCpus": 1000000000,
      "pidsLimit": 64,
      "image": "sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722"
    }
  },
  {
    "kind": "container-running",
    "timeUnix": 1791021601.069094,
    "data": {
      "mapping": "127.0.0.1:53462",
      "pid": 89364,
      "path": "docker-entrypoint.sh",
      "args": [
        "postgres"
      ],
      "serverVersion": "18.6 (Debian 18.6-1.pgdg13+2)"
    }
  },
  {
    "kind": "resource-before-node",
    "timeUnix": 1791021601.693904,
    "data": {
      "pressure": "1",
      "estimatedAvailableBytes": 5788696576,
      "method": "free+inactive+speculative",
      "idlePercent": 70.94,
      "diskBytes": 35227009024
    }
  },
  {
    "kind": "child-intended",
    "timeUnix": 1791021601.694077,
    "data": {
      "command": [
        "/Users/phannhatquang/.nvm/versions/node/v24.14.0/bin/node",
        "--max-old-space-size=384",
        "--test",
        "--test-isolation=none",
        "--test-name-pattern=assistant store schema",
        "/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/.task-1-schema-red-34cd2e6f/v2/server/test/assistant-store.test.ts"
      ],
      "cwd": "/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/.task-1-schema-red-34cd2e6f/v2/server"
    }
  },
  {
    "kind": "child-created",
    "timeUnix": 1791021601.698858,
    "data": {
      "pid": 91934,
      "psIdentity": "91934 Sat Oct  3 17:00:01 2026     /Users/phannhatquang/.nvm/versions/node/v24.14.0/bin/node --max-old-space-size=384 --test --test-isolation=none --test-name-pattern=assistant store schema /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/.task-1-schema-red-34cd2e6f/v2/server/test/assistant-store.test.ts"
    }
  },
  {
    "kind": "child-closed",
    "timeUnix": 1791021602.023922,
    "data": {
      "pid": 91934,
      "exit": 1,
      "waitObserved": true
    }
  },
  {
    "kind": "red-log",
    "timeUnix": 1791021602.0242612,
    "data": {
      "sha256": "c23e305f6fcf2a7314f4541da3c73ff4f570c31b239d9214deab359af7349de2",
      "bytes": 2144,
      "content": "✖ assistant store schema has a durable empty inbox in the actual PostgreSQL migration prefix (217.832208ms)\nℹ tests 1\nℹ suites 0\nℹ pass 0\nℹ fail 1\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 300.2505\n\n✖ failing tests:\n\ntest at test/assistant-store.test.ts:13:1\n✖ assistant store schema has a durable empty inbox in the actual PostgreSQL migration prefix (217.832208ms)\n  PostgresError: relation \"assistant_work_inbox\" does not exist\n      at ErrorResponse (file:///Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/connection.js:815:30)\n      at handle (file:///Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/connection.js:489:6)\n      at Socket.data (file:///Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/connection.js:324:9)\n      at Socket.emit (node:events:508:28)\n      at addChunk (node:internal/streams/readable:563:12)\n      at readableAddChunkPushByteMode (node:internal/streams/readable:514:3)\n      at Readable.push (node:internal/streams/readable:394:5)\n      at TCP.onStreamRead (node:internal/stream_base_commons:189:23)\n      at cachedError (file:///Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/query.js:170:23)\n      at new Query (file:///Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/query.js:36:24)\n      at sql (file:///Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/src/index.js:112:11)\n      at file:///Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/.task-1-schema-red-34cd2e6f/v2/server/test/assistant-store.test.ts:18:29 {\n    severity_local: 'ERROR',\n    severity: 'ERROR',\n    code: '42P01',\n    position: '40',\n    file: 'parse_relation.c',\n    line: '1498',\n    routine: 'parserOpenTable'\n  }\n"
    }
  },
  {
    "kind": "database-after-test",
    "timeUnix": 1791021602.078094,
    "data": "crew_v2_test"
  },
  {
    "kind": "manifest-recheck",
    "timeUnix": 1791021602.084007,
    "data": {
      "files": 155,
      "sha256": "b0687326097c68261a1923ea38952b98c7df4268151daafbed519cdaf8b9641e",
      "unchanged": true
    }
  },
  {
    "kind": "container-closed",
    "timeUnix": 1791021602.251673,
    "data": {
      "id": "a237bbd1f2b2a7c99decc7f1ed4b157b676076a78f70bb6b0254435b2acac112",
      "status": "exited",
      "pid": 0,
      "exitCode": 0
    }
  },
  {
    "kind": "container-removed",
    "timeUnix": 1791021602.312784,
    "data": {
      "id": "a237bbd1f2b2a7c99decc7f1ed4b157b676076a78f70bb6b0254435b2acac112",
      "absent": true
    }
  },
  {
    "kind": "scratch-removed",
    "timeUnix": 1791021602.333326,
    "data": {
      "root": "/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/.task-1-schema-red-34cd2e6f",
      "identity": {
        "root": "/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/.task-1-schema-red-34cd2e6f",
        "nonce": "34cd2e6f-d460-41b6-af51-2c122abf80b2",
        "dev": 16777229,
        "ino": 64397675,
        "uid": 501,
        "creatorPid": 83970,
        "baseline": "0c838d2",
        "purpose": "phase06 T1 actual schema RED only",
        "dependencyResolution": "Normal ancestor package resolution; same accepted fixture convention as task-3-fix2-test-snapshot.py"
      },
      "absent": true
    }
  }
]
```

### Frozen source inventory

```json
[
  {
    "path": "v2/server/.env.example",
    "bytes": 377,
    "sha256": "f1212f54cdfd5bcac71a6c60cc398fa4240e89d34509223b0c60affc16ba77f6"
  },
  {
    "path": "v2/server/extractor.Dockerfile",
    "bytes": 661,
    "sha256": "6b90aea51d0b5f56c5112b46becc3d19a463d0cd66662fb1f7fd7ccb7c28f003"
  },
  {
    "path": "v2/server/extractor.dockerignore",
    "bytes": 101,
    "sha256": "14bc90088f0bbf149c8f18da73058cb7b5020508d4af47978bf1788f08bb89a7"
  },
  {
    "path": "v2/server/migrations/001_platform.sql",
    "bytes": 286,
    "sha256": "dda56a23030e01ee5025d61578969b53157f96fd19ffe6172108b652f6adfa76"
  },
  {
    "path": "v2/server/migrations/002_journal.sql",
    "bytes": 837,
    "sha256": "11806e8bb34e6aefb2f225d1499052d66d76c06f1ccd278021353fcc7fed78e9"
  },
  {
    "path": "v2/server/migrations/003_identity.sql",
    "bytes": 1294,
    "sha256": "0949541124c0ff26fec05030b8693afe65705ff2d63887f7e452fa6d37487d5d"
  },
  {
    "path": "v2/server/migrations/004_tickets.sql",
    "bytes": 4975,
    "sha256": "1149012423551fb847c6a9adf3784906d466a6026d8edb67e079d433dcf8af4f"
  },
  {
    "path": "v2/server/migrations/005_execution.sql",
    "bytes": 3270,
    "sha256": "b8351b54e99ae91a3d2476df812b8fc374860ae472cfe8b7459a4dfc61e41027"
  },
  {
    "path": "v2/server/migrations/006_docs.sql",
    "bytes": 4364,
    "sha256": "8c48a69a27205ff95d11be8b966ffffcd079f62e537f5263777cd867325b75ae"
  },
  {
    "path": "v2/server/migrations/007_gateway.sql",
    "bytes": 6548,
    "sha256": "9a5542b2a58dd151d1ad78a7dc799ba7bee157abfd094c3c1ebfebf1a2d49eb4"
  },
  {
    "path": "v2/server/migrations/008_model_pool.sql",
    "bytes": 15261,
    "sha256": "d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f"
  },
  {
    "path": "v2/server/migrations/009_attachments.sql",
    "bytes": 20136,
    "sha256": "fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a"
  },
  {
    "path": "v2/server/migrations/010_attachment_comment_text.sql",
    "bytes": 253,
    "sha256": "aa2a308ba8a180186e57fb08f93fac7195fc6c0468b821f96c107f4e13ccf59d"
  },
  {
    "path": "v2/server/package.json",
    "bytes": 843,
    "sha256": "8e01dac8d9073a87cab6d1ad5cbf40dc718bb8dafa153844c2c16297083c7a02"
  },
  {
    "path": "v2/server/pnpm-lock.yaml",
    "bytes": 25548,
    "sha256": "2b828b05f94774ed27baa1d2883f7ded6d93fcce0824f1d519ca6b72bf5ede77"
  },
  {
    "path": "v2/server/scripts/docs-import.ts",
    "bytes": 10757,
    "sha256": "8b9929beac141bae684547b047aee536d86d5566880ae33aae116e0b13dc08b5"
  },
  {
    "path": "v2/server/scripts/test-db-signals.mjs",
    "bytes": 6680,
    "sha256": "78bb69e304343765b49e75dc2f2912fbb0aca3441e6f2ba678a38725053c3c2c"
  },
  {
    "path": "v2/server/scripts/test-db.ts",
    "bytes": 4907,
    "sha256": "d8872ea3c72c4e4e90be1d289977d496f314687f8027fc65f712855fd6c7b932"
  },
  {
    "path": "v2/server/src/app.ts",
    "bytes": 4149,
    "sha256": "c0052279dc95a5f512047add2ca8dcd1c94935c45c79ab218721a0bb58e493c3"
  },
  {
    "path": "v2/server/src/attachments/access.ts",
    "bytes": 7807,
    "sha256": "fcd8e5ca144ffb437f2656c02bc8c6f73fa57fa84475fbce3f7fb9ede3141d9d"
  },
  {
    "path": "v2/server/src/attachments/config.ts",
    "bytes": 3804,
    "sha256": "821ce0d6d8deb92c405b2bb5ab009eff4c8515c9aecc265b5c6f5b033ec36b03"
  },
  {
    "path": "v2/server/src/attachments/contracts.ts",
    "bytes": 11551,
    "sha256": "5b6a496b4c0e86298a2d69d76f4666e07cbb783d8ca153ccb4f17fc4f45eb906"
  },
  {
    "path": "v2/server/src/attachments/grants.ts",
    "bytes": 21430,
    "sha256": "3e4a585f0ce266d921fe24f954dbb805a84e4730a30926ac43a08f559d3272b3"
  },
  {
    "path": "v2/server/src/attachments/jobs.ts",
    "bytes": 15120,
    "sha256": "2984081650f272b0404902d9bac5c15430656d1bfd3b3430f6c5f043dcc8221d"
  },
  {
    "path": "v2/server/src/attachments/messages.ts",
    "bytes": 11390,
    "sha256": "c88e5e1ea870541244f7cace3e3cefab7c7f55a94a5beb25f492592f150c3508"
  },
  {
    "path": "v2/server/src/attachments/receivers.ts",
    "bytes": 15805,
    "sha256": "44a5e3bd1ef62e73c773a1c0531b21569da9ad8b3e94b473a11d91f268eeb21b"
  },
  {
    "path": "v2/server/src/attachments/references.ts",
    "bytes": 10961,
    "sha256": "839ac3e672d82281b341656937c7328176e5809b0b99259e952bb09a2b668082"
  },
  {
    "path": "v2/server/src/attachments/routes.ts",
    "bytes": 34017,
    "sha256": "075b9852de78f4794b8b907c54a6ce496479897c2cb26fddef0fbcdf1ef355b4"
  },
  {
    "path": "v2/server/src/attachments/routing.ts",
    "bytes": 10106,
    "sha256": "b6ff9476d4926437b55c015043a6337d1c2feff951893837781dcf765160234c"
  },
  {
    "path": "v2/server/src/attachments/snapshots.ts",
    "bytes": 16398,
    "sha256": "c498e9e953c7eae2aa840c9fc97cef0e0b5bcf88071315be60ebb9bf918f3969"
  },
  {
    "path": "v2/server/src/attachments/staging.ts",
    "bytes": 31433,
    "sha256": "8472c49eb19ae9acf679718f079aacdbe256f1ace82bae656461692c162de7ee"
  },
  {
    "path": "v2/server/src/attachments/storage.ts",
    "bytes": 15312,
    "sha256": "b252f6b1f97fd08359c9f369bebf2f680fce2abc0a23793cd63d8eb678c9db2c"
  },
  {
    "path": "v2/server/src/attachments/submissions.ts",
    "bytes": 20248,
    "sha256": "0bf63fae11bfc591ce82351746b1be1fe112695ca65845e76e102174da2a0b99"
  },
  {
    "path": "v2/server/src/attachments/worker-diagnostic.ts",
    "bytes": 5612,
    "sha256": "eb9100e61b9fc5587c7aaafed21ad65b96a4578727c15d1a8827564ff4f28a8b"
  },
  {
    "path": "v2/server/src/attachments/worker-entry.ts",
    "bytes": 1636,
    "sha256": "826cbb9395f0a4837e9f862b92fa8cb9c81e664e0752840cf1ac81d45d4b6566"
  },
  {
    "path": "v2/server/src/attachments/worker-protocol.ts",
    "bytes": 17349,
    "sha256": "836615d455854469acc8280c3d66e97adff1b190df7a2ece234e101b1d156aa5"
  },
  {
    "path": "v2/server/src/attachments/worker-runner.ts",
    "bytes": 16751,
    "sha256": "5080d8182fbd59e984f6e7856cf063a147221308fda5fe1f0de1a99f51f0cf48"
  },
  {
    "path": "v2/server/src/auth/bootstrap.ts",
    "bytes": 1384,
    "sha256": "3bf1b6ce86a466864335bc80efbe318595d10efb5ea8f66110499b93e0dcecde"
  },
  {
    "path": "v2/server/src/auth/machine.ts",
    "bytes": 974,
    "sha256": "9b9eadc6d3f5725e7af32450cc49ea48d657d17ae405c1d69546bcdb6b9e8d39"
  },
  {
    "path": "v2/server/src/auth/password.ts",
    "bytes": 1136,
    "sha256": "cc3ba563c155d181ab40049f0b31c89f34f5dcfe860b475b1752cbae1e98e100"
  },
  {
    "path": "v2/server/src/auth/routes.ts",
    "bytes": 11029,
    "sha256": "2d8da9363305e88880483b37d0f694daea6a01e5909eb4da8c2243048f7c5821"
  },
  {
    "path": "v2/server/src/auth/session.ts",
    "bytes": 5262,
    "sha256": "abd4bf6cc9dcc38c589053958cfa2c79dd970a69dfb46090ea557ffc4d353f52"
  },
  {
    "path": "v2/server/src/db/client.ts",
    "bytes": 540,
    "sha256": "07aae6bf75475eb7616156af3bf2ab7b9b42e20234a782e888260c6b617218d7"
  },
  {
    "path": "v2/server/src/db/migrate.ts",
    "bytes": 4403,
    "sha256": "47956c0308883839fd70ce5c7d78101cc7457a92ef2c37f78657aeccf99f6c8b"
  },
  {
    "path": "v2/server/src/docs/checksum.ts",
    "bytes": 1470,
    "sha256": "7260013f4d17dabfdd14ce604db237b95712b25e55525aa8ff364be689586175"
  },
  {
    "path": "v2/server/src/docs/contracts.ts",
    "bytes": 1551,
    "sha256": "1f6896c2ea0d3c2694f88034c03f2b988fafbf92a9335d5b68a5122d884421f6"
  },
  {
    "path": "v2/server/src/docs/import.ts",
    "bytes": 20403,
    "sha256": "86e3399ad6677ae124691c1536c1e5d253d1f5ba2dabf446940fd1ce7dbd3e15"
  },
  {
    "path": "v2/server/src/docs/links.ts",
    "bytes": 7779,
    "sha256": "378dfccd70a72d2ebe314869499fb40ed715d2ce9babf1ab67d494cd915e35a1"
  },
  {
    "path": "v2/server/src/docs/manifest.ts",
    "bytes": 9290,
    "sha256": "4d2b79e1ac05be0250122a41968cb90236a4f8a19c08be1dcd02f5bf52423df0"
  },
  {
    "path": "v2/server/src/docs/read.ts",
    "bytes": 8080,
    "sha256": "d69c2bead5ab71ca3ec4d6efb660d98e2892981f854c911c85bef48d852b1d99"
  },
  {
    "path": "v2/server/src/docs/routes.ts",
    "bytes": 3985,
    "sha256": "cdaf4ffdc949312ac4adbb15880d139203612078df0df96517fa8934f5e3c82f"
  },
  {
    "path": "v2/server/src/docs/search.ts",
    "bytes": 7014,
    "sha256": "4b741e890fa5af07919cc4f2b3d724d2d807f13daec5fe38a663bfa9b4c18365"
  },
  {
    "path": "v2/server/src/docs/validator.ts",
    "bytes": 6815,
    "sha256": "988c28daa055e707b07182268cce7e665bfffa1e9545e8780cc0eba13adcdcd1"
  },
  {
    "path": "v2/server/src/execution/attempts.ts",
    "bytes": 30776,
    "sha256": "ac69a4f0ba76539bc5dcf2bb7e90dde3b634417359cdb321c2293a0765aeeb02"
  },
  {
    "path": "v2/server/src/execution/commands.ts",
    "bytes": 10793,
    "sha256": "1b646d5e7a855707bbb0d472aa081f5589260c4302f9b947e45136c8868be527"
  },
  {
    "path": "v2/server/src/execution/contracts.ts",
    "bytes": 1388,
    "sha256": "3a8d714b667d86a6ff09979b9b58ad7e0dc1d82db546c0511d9689d7dc0c58ac"
  },
  {
    "path": "v2/server/src/execution/reconcile.ts",
    "bytes": 71,
    "sha256": "58d53b565592e1a6673bbd86f8840811c67fc5fdc4b9ac5cd36faf0defccc6fd"
  },
  {
    "path": "v2/server/src/execution/routes.ts",
    "bytes": 15180,
    "sha256": "5c72ddb5a50f934646afb8d1cb942599be4e5dfe08ae77cd58c4a770a8b8e2ac"
  },
  {
    "path": "v2/server/src/gateway/contracts.ts",
    "bytes": 9232,
    "sha256": "546ee14da64b367a95d70943bfb2394ca11ee643905391ab7fa53a0797fa38eb"
  },
  {
    "path": "v2/server/src/gateway/routes.ts",
    "bytes": 6342,
    "sha256": "27f551e751766b8a4ecba5f2c24f21170fd40b11076b4868d9439521af58f348"
  },
  {
    "path": "v2/server/src/gateway/service.ts",
    "bytes": 24410,
    "sha256": "07cfebeebc7ae0f57534cd4d9b478e0e45e363c094e8a2d2d6b11ae0cfe2f605"
  },
  {
    "path": "v2/server/src/journal/canonical.ts",
    "bytes": 1447,
    "sha256": "dbb85d4a8a70035bb5934bb42a1a1f3cb21f4ad36fefc7f35e18febda5b9af79"
  },
  {
    "path": "v2/server/src/journal/event-contracts.ts",
    "bytes": 13153,
    "sha256": "c9ced53a9c760cac95ab738eabb2634cd0f271b25693b15cc458b2fcace6343f"
  },
  {
    "path": "v2/server/src/journal/events.ts",
    "bytes": 3181,
    "sha256": "d5b7b7299f6b6688baa59037e96e9720760a0f826899682b5e68bd7ec85782d1"
  },
  {
    "path": "v2/server/src/journal/mutation.ts",
    "bytes": 2782,
    "sha256": "968ba8a8ac3d8a5725e8facb593a287e1555b71b9c627ab6f47e69e6624dd27f"
  },
  {
    "path": "v2/server/src/journal/routes.ts",
    "bytes": 5344,
    "sha256": "805d75799f38c2272015d7f51ea1c8da5c06fccb8a88c5d5270cf48cdf1b9de2"
  },
  {
    "path": "v2/server/src/main.ts",
    "bytes": 1269,
    "sha256": "4cf6e959b08b97846582d314b4a9b0c70733c31eed8600838da5ade11a68d7b6"
  },
  {
    "path": "v2/server/src/models/catalog.ts",
    "bytes": 17027,
    "sha256": "bbd2e7c3db28c2760286be7d69a6fa4ed2fd11a2ee24e2cc0a93a653f138b0fc"
  },
  {
    "path": "v2/server/src/models/certification.ts",
    "bytes": 7569,
    "sha256": "c4800e84aad828da849db6ed6c281b45ef3c9c28e76f0b10ca2d418362a6166f"
  },
  {
    "path": "v2/server/src/models/commands.ts",
    "bytes": 1626,
    "sha256": "b70bf6a551b69f66b2af882269e85b36d66b4504f4e711a6c9b3e96d821a20cc"
  },
  {
    "path": "v2/server/src/models/config.ts",
    "bytes": 6401,
    "sha256": "c56ddff69ec4a85a914be803f2aa2d4e4cbaab15b93fdcdb4b0aed6c7b67c952"
  },
  {
    "path": "v2/server/src/models/contracts.ts",
    "bytes": 9185,
    "sha256": "f991a57bb4013ec5d33254bab88d7377e66cb31d9fec383f8cd378b86b197cde"
  },
  {
    "path": "v2/server/src/models/helpers.ts",
    "bytes": 1614,
    "sha256": "27e64870938fe9d1986261fd458247c70c2fb482f574e1b02a68ed0db6297490"
  },
  {
    "path": "v2/server/src/models/routes.ts",
    "bytes": 11162,
    "sha256": "76d1433ef88ef10e48deaffd2de940fbaebbdb831f3d01f36763eed6f06315c3"
  },
  {
    "path": "v2/server/src/models/secret-envelopes.ts",
    "bytes": 11946,
    "sha256": "b118ec7deff4fcbe3797a71e7eee8746d2cc144a5edef49699e0fffed2b584ad"
  },
  {
    "path": "v2/server/src/platform/config.ts",
    "bytes": 1569,
    "sha256": "e00f3a5347ba279fbf3968cbc5fcaf73d1c841a9976ea00fd3e5d5af34f9efe1"
  },
  {
    "path": "v2/server/src/platform/contracts.ts",
    "bytes": 2478,
    "sha256": "9022d40070f91dab3ffeb78d94c787bc3e0db86767cb6ce5b21df1877089e14f"
  },
  {
    "path": "v2/server/src/platform/errors.ts",
    "bytes": 333,
    "sha256": "1d082a2c69035cf70b05f3cc817286fbdda7138ef47b28784bec8c458cda959d"
  },
  {
    "path": "v2/server/src/platform/picomatch.d.ts",
    "bytes": 162,
    "sha256": "2327b1b48df9eefe9437cdaa1ce012e93ae07ab66e19519af949190b324650ac"
  },
  {
    "path": "v2/server/src/platform/thread-stream.d.ts",
    "bytes": 262,
    "sha256": "bd0b8b0bf4dc685f779e04ddce95e2d6a0f211c3729520902eb40426d7633280"
  },
  {
    "path": "v2/server/src/projects/routes.ts",
    "bytes": 4209,
    "sha256": "ca7ef26f47da2f8e6b2d5c7f17a3b785733a39a64a7f132ee0a6395d9e365c77"
  },
  {
    "path": "v2/server/src/projects/service.ts",
    "bytes": 5594,
    "sha256": "96767f204937ebd40aa4eb9337ab357dbec48375d331d8b098d2c77516f0cf28"
  },
  {
    "path": "v2/server/src/tickets/authorization.ts",
    "bytes": 1567,
    "sha256": "2f5e7e42988461fd1898cd0872012cfb9a7d2f6413aa059c56001d20cc7ec2a6"
  },
  {
    "path": "v2/server/src/tickets/completion.ts",
    "bytes": 2874,
    "sha256": "06cebd525cc0700c515dae35786e2120561e3dbaacb1d8505feb8422127c20b6"
  },
  {
    "path": "v2/server/src/tickets/contracts.ts",
    "bytes": 3156,
    "sha256": "352f831eb2d23d96dccefd07b45ec41e3e2a82c25912307c2cea1eaea3ff485a"
  },
  {
    "path": "v2/server/src/tickets/decisions.ts",
    "bytes": 7009,
    "sha256": "93ffcd5601bbeb3754778bfab12907f0d62bf6ec2a726623ae98c17a2f46aa5c"
  },
  {
    "path": "v2/server/src/tickets/dependencies.ts",
    "bytes": 4106,
    "sha256": "0e6a227bbab2d9a95d67a691e495a2a029482cb5ff727c3bf05a3823cd789eb9"
  },
  {
    "path": "v2/server/src/tickets/deploy.ts",
    "bytes": 2418,
    "sha256": "d49449a4eeb1283e4ca8beba0e717c81bcc14a1ceeeb92588895fa73121f847b"
  },
  {
    "path": "v2/server/src/tickets/docs-links.ts",
    "bytes": 1926,
    "sha256": "5d27ac47cb31a78d61e29735dae275fd6a58dfd5c309e9eb5982c551f4fd2714"
  },
  {
    "path": "v2/server/src/tickets/repair.ts",
    "bytes": 5151,
    "sha256": "7f66469e7219fca29658c62a4530464ec67c0d5298e52e36b2f983429b64c966"
  },
  {
    "path": "v2/server/src/tickets/routes.ts",
    "bytes": 16896,
    "sha256": "c62eae0dc6c8722dd88a1d545d897cd6d2668105421a20f12e43a3fd1b0d1fb7"
  },
  {
    "path": "v2/server/src/tickets/service.ts",
    "bytes": 16424,
    "sha256": "e235e098fea042ce9be79b9bfc9e61a5f7c9b4f85c141bb6049463f5d24e619c"
  },
  {
    "path": "v2/server/test/api-acceptance.test.ts",
    "bytes": 31696,
    "sha256": "88a4c15c6ba1017a46a3961543653490393a92d7d188ea65888998de0f41c74a"
  },
  {
    "path": "v2/server/test/assistant-store.test.ts",
    "bytes": 17847,
    "sha256": "93cccf9d20a876f52d2ca06f450833e9c498fd6136e308f3e1dfe7ebbfd755da"
  },
  {
    "path": "v2/server/test/attachment-event.test.ts",
    "bytes": 2166,
    "sha256": "56cc3a520b31ff527dc51e0a56d8e09d1c2395cb5dd3202d92b2396cb3985e50"
  },
  {
    "path": "v2/server/test/attachments-access.test.ts",
    "bytes": 7960,
    "sha256": "1cfe82ab94342e8be7a90194a218365c5f734521c1565677fd6cfb058fd73371"
  },
  {
    "path": "v2/server/test/attachments-api.test.ts",
    "bytes": 9562,
    "sha256": "b87e2bebf7b1c7680e3df9121514e51c75ba7de718551ac021d20249935fd1ee"
  },
  {
    "path": "v2/server/test/attachments-comment-factory.test.ts",
    "bytes": 22759,
    "sha256": "1e887655dc5d15aa6c3d44e6bd9d3d5b46955e18a903eb7730ac2c3a020aedd2"
  },
  {
    "path": "v2/server/test/attachments-events.unit.test.ts",
    "bytes": 2429,
    "sha256": "ae0b69ad82805893b5d6425e0e2ac3324ced6107891ed1735889a156547fbed7"
  },
  {
    "path": "v2/server/test/attachments-grants.test.ts",
    "bytes": 17390,
    "sha256": "7a417a468e3fb7c333eab1aa5ca11ba5b22555f9e69ddf3b3c989ff82250577d"
  },
  {
    "path": "v2/server/test/attachments-messages.test.ts",
    "bytes": 8144,
    "sha256": "64cea548dbddf20102bb3909e606ea8d6c25fffc4e0415e7937ec3efdc0331c1"
  },
  {
    "path": "v2/server/test/attachments-routing.test.ts",
    "bytes": 16176,
    "sha256": "17d0e170ea0681c1ae2d0af1a188cd21d8977f48a8a4c11188c8da5ab194094c"
  },
  {
    "path": "v2/server/test/attachments-snapshots.test.ts",
    "bytes": 31643,
    "sha256": "14cd2467cca851ecbfce4aaaa71b892b8b8002e59e22106d59f2de0fd1b7b464"
  },
  {
    "path": "v2/server/test/attachments-staging.test.ts",
    "bytes": 37395,
    "sha256": "2375711bff9f89dc0e69f03f5ca58f587b18481a8b3a78bb7b2855c41ef85493"
  },
  {
    "path": "v2/server/test/attachments-storage.test.ts",
    "bytes": 20433,
    "sha256": "47a6fefadb13c4c7f4b72da43e421c254a0003967499e89bb678bc9c936f6ad8"
  },
  {
    "path": "v2/server/test/attachments-submissions.test.ts",
    "bytes": 20884,
    "sha256": "770c9e033b5a2b634872ee31d471d37e998ed7a085ffa51dd658db036a910dfb"
  },
  {
    "path": "v2/server/test/attachments-worker-live.test.ts",
    "bytes": 9651,
    "sha256": "d657aa48a669b85525ed89bbb8cfae629121b9e9b6967729d605b4ea882c0e7c"
  },
  {
    "path": "v2/server/test/attachments-worker.test.ts",
    "bytes": 22302,
    "sha256": "9c0308d278cf366202ebb7bd71dae235a8a55fe7b9266d161c1217afc2a20765"
  },
  {
    "path": "v2/server/test/attempts.test.ts",
    "bytes": 51969,
    "sha256": "f850bbd06ff3482791c6d39949f7442b9e35b17ffa1744046d92856878a224d9"
  },
  {
    "path": "v2/server/test/auth.test.ts",
    "bytes": 14087,
    "sha256": "8bd744003065a8498afd6ae61abe8ea2476a271aa3ee34aeaef97bf7b2f22a63"
  },
  {
    "path": "v2/server/test/commands.test.ts",
    "bytes": 10501,
    "sha256": "714620338d8cd5f3fed2ba7cf98a4f606a6ff81aafc14ac5fdb571eab5b3c87f"
  },
  {
    "path": "v2/server/test/completion.test.ts",
    "bytes": 5760,
    "sha256": "724394abf84eae7729784d1c9f1826ed53898ace6352a44bed6efb58506be21e"
  },
  {
    "path": "v2/server/test/dependencies.test.ts",
    "bytes": 5783,
    "sha256": "5186728030badfcec08639891013956a62455584767059dd7bc9366f8e22f583"
  },
  {
    "path": "v2/server/test/deploy.test.ts",
    "bytes": 8802,
    "sha256": "a447ae5cad1a7fd5264748eeb169f8d7075714002eb81d3469294ef541da0433"
  },
  {
    "path": "v2/server/test/docs-events.unit.test.ts",
    "bytes": 1285,
    "sha256": "b54b4acc7f0b93c9eeb4d6229c3f13ea5e85efdad9c1fed35d4cdea253856ff5"
  },
  {
    "path": "v2/server/test/docs-import-cli.unit.test.ts",
    "bytes": 11585,
    "sha256": "0c7d00b59ef6eec73e667265badd318d0ae839e25de18b4582cfbe193139b961"
  },
  {
    "path": "v2/server/test/docs-import.test.ts",
    "bytes": 37124,
    "sha256": "cf7db19a8a4d01918af2c9316597eb1667f3774affa190a941e4b7d2b3effced"
  },
  {
    "path": "v2/server/test/docs-read.test.ts",
    "bytes": 19022,
    "sha256": "29a6d628545d1489015a58ea98d930e15ff4ec9320ac61d2f812b5ceef50d37d"
  },
  {
    "path": "v2/server/test/docs-validator.unit.test.ts",
    "bytes": 16996,
    "sha256": "12fb13fd87dae593503bf5060be6c55c720c9d922840e742c84bc130867e3756"
  },
  {
    "path": "v2/server/test/execution-events.unit.test.ts",
    "bytes": 886,
    "sha256": "8f4a98abcece514729843b7476c3e3a55dd9d5ccef4c08da4e800b27c288e7cc"
  },
  {
    "path": "v2/server/test/fixtures/legacy-docs/crlf-unicode.md",
    "bytes": 36,
    "sha256": "8463548e313aa8a34ca11e7ae4bacc2a6e7aefc00e15eb63b128ca1d121c7c94"
  },
  {
    "path": "v2/server/test/gateway.test.ts",
    "bytes": 40301,
    "sha256": "fbad7ca2ce5bc1b8db6867953968fb6ca798e4af41b8a996483124431f06451f"
  },
  {
    "path": "v2/server/test/journal-scope.test.ts",
    "bytes": 2625,
    "sha256": "1ffceeda7b3586202a85147b0ca3ddc312388640f08af29784e6578268ec5415"
  },
  {
    "path": "v2/server/test/journal.test.ts",
    "bytes": 12033,
    "sha256": "ccbef091f00c392bf9db01badf3e603897e7d83adc59b01d03afcd8f123abac2"
  },
  {
    "path": "v2/server/test/model-certification.test.ts",
    "bytes": 27474,
    "sha256": "dc3274bb399350cd44abafc431c6c758c6d510f21f615825908b869d8b4aa322"
  },
  {
    "path": "v2/server/test/model-current-credentials.test.ts",
    "bytes": 11100,
    "sha256": "42bb2269aa57f604ffe1747d481043d6b22fb576f4a4c526bdd02cfabfcb858b"
  },
  {
    "path": "v2/server/test/model-pool.test.ts",
    "bytes": 23260,
    "sha256": "1f32c2a8ab90e82ce68264ca3be52b43f3fb8e0e6c6604805f7f088d98240ba5"
  },
  {
    "path": "v2/server/test/model-secret.test.ts",
    "bytes": 26475,
    "sha256": "d170a084184db72808e875516af27a8ad5253e70884cc5bc1e940baa6f8d1c23"
  },
  {
    "path": "v2/server/test/platform.test.ts",
    "bytes": 8850,
    "sha256": "7b442863c5aa50619bdc4443b4a7d2cebf95887d6508b401e829eee6f3a46ce7"
  },
  {
    "path": "v2/server/test/projects.test.ts",
    "bytes": 8111,
    "sha256": "c0220e8b289ae46e705614a00ff7a8257d6caaadae9bee43770d20f09f16d6a2"
  },
  {
    "path": "v2/server/test/repair.test.ts",
    "bytes": 6234,
    "sha256": "099cd2e1c98ad07974b98a64c9f3ca931fd65f1f2146d3e9a99795c7dce4f3e9"
  },
  {
    "path": "v2/server/test/support/assistant.ts",
    "bytes": 2654,
    "sha256": "49eaf7c09405fff55d722d48f5884585dcd7c316e0e464127b09f2c465478150"
  },
  {
    "path": "v2/server/test/support/attachment-access-authority.ts",
    "bytes": 3152,
    "sha256": "ef5552440b35c377244a3abd70b8592190d18fb5a52da18b0e59d2dcf3a90dce"
  },
  {
    "path": "v2/server/test/support/attachment-access-inbox.ts",
    "bytes": 8158,
    "sha256": "ceca393fb252b019b650f6eabee91b1fb5f11bd1a1e6e16c2240a69d525f911b"
  },
  {
    "path": "v2/server/test/support/attachment-access-publication.ts",
    "bytes": 5388,
    "sha256": "579fc484af1bf8bfc8b2931f3de7342a324d4a42e48f433a77b13e5f63df10a4"
  },
  {
    "path": "v2/server/test/support/attachment-access.ts",
    "bytes": 15234,
    "sha256": "cf5120b6d879510997a9fec332ec6e21d4d9326f8f2a6c2bd02c55cd82ab4744"
  },
  {
    "path": "v2/server/test/support/attachment-snapshot-work.ts",
    "bytes": 1689,
    "sha256": "577ea7bfc40f8bc86965c3babd353e4c77638d2f338b6e3183cfb2191ceb4c3a"
  },
  {
    "path": "v2/server/test/support/attachments.ts",
    "bytes": 26365,
    "sha256": "62e6bac7f87210d107e441565a7f7f50ab94c8128582f15f945bd42e688613b4"
  },
  {
    "path": "v2/server/test/support/db.ts",
    "bytes": 2315,
    "sha256": "2d840b2710c76a629d95ef5dd4a67e1b4edd6f4cb14d9e61e8314ee7035f5a96"
  },
  {
    "path": "v2/server/test/support/docs.ts",
    "bytes": 4112,
    "sha256": "c29fd3b8e216941369764af729edb218fd7fe2e928c2a98f640a61c34ac91631"
  },
  {
    "path": "v2/server/test/support/execution.ts",
    "bytes": 2109,
    "sha256": "904da47e1c5e3062cb1cda1d5171d6afb37c8b4775b6b68ccaeae1f128c1467c"
  },
  {
    "path": "v2/server/test/support/gateway.ts",
    "bytes": 13272,
    "sha256": "e76fa45ec525922c16e6d3351b1d15dfbd5300c2c7a260fe32df31bc3424d29a"
  },
  {
    "path": "v2/server/test/support/http.ts",
    "bytes": 7325,
    "sha256": "6da03aed379f2034064245be21151fc23ae23766fec8be9ea298a7e1f11ba151"
  },
  {
    "path": "v2/server/test/support/identity-app.ts",
    "bytes": 5264,
    "sha256": "a3b638a01930c638f25c901e6f84fa8072dd30eca116c1650b632d1ca7153768"
  },
  {
    "path": "v2/server/test/support/model-certification.ts",
    "bytes": 2061,
    "sha256": "776d8f9acbf9fc359cf1d2e90a36dcbb3448144968ad0d138d55125448ecf048"
  },
  {
    "path": "v2/server/test/support/model-http.ts",
    "bytes": 6939,
    "sha256": "619f44e7e367340b231d468b946562fb9f1a061156fb4071c64a7fe2d44c668c"
  },
  {
    "path": "v2/server/test/support/model-observer.ts",
    "bytes": 2459,
    "sha256": "022a531f5d89847d583af3a88d690927ed51785ea151990a2a8a24966eb9ee4a"
  },
  {
    "path": "v2/server/test/support/tickets.ts",
    "bytes": 2363,
    "sha256": "c5b900e7f9d6ee65571264f58df8cedcd9828c77aafc9e5acdf620f3d2b1fbb7"
  },
  {
    "path": "v2/server/test/ticket-events.unit.test.ts",
    "bytes": 1413,
    "sha256": "d420b4da1f57c1bb38b04a5e6fc550ecdfbe831eeae6d9bda6b3ce21f784c50d"
  },
  {
    "path": "v2/server/test/tickets.test.ts",
    "bytes": 4693,
    "sha256": "5aba710e7998a229016618eb2fffedc1984d06c4cc5baa2102fad234d03100fd"
  },
  {
    "path": "v2/server/tsconfig.json",
    "bytes": 332,
    "sha256": "5d1c621ff9a9d952e4fc8e6e1e275a71c3b92c14df5ec2f8ecd08b9fa254c0c4"
  },
  {
    "path": "v2/src/completion-policy.ts",
    "bytes": 663,
    "sha256": "88f1b7dd0cccbedbf6f0bdbf90fe5a67c01e446c1c6fa70b27f732142951be14"
  },
  {
    "path": "v2/src/model-policy.ts",
    "bytes": 691,
    "sha256": "b93d0c3112082d5c3d74cb04f668d7b7345665f9843468df5c52db77182dad31"
  },
  {
    "path": "v2/src/ticket-policy.ts",
    "bytes": 1686,
    "sha256": "919f5a0a56d6bb96a604e9614f40103c0b075170126f32721691d182c6ea0645"
  },
  {
    "path": "v2/src/workflow-policy.ts",
    "bytes": 830,
    "sha256": "7b02e7b5942b159f8bd0e85d6493d0565aee93a7b6c9a270c2fdc4473427b206"
  }
]
```
