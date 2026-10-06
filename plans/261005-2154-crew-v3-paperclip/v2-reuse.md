# Crew v3 — Bảng tận dụng phần đã làm ở v2

Ngày: 05/10/2026. Baseline source: `codex/crew-v2-server` tại `51907858d0c8cdb7329759f22104f0727dbe6751`; worktree `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`.

Đây là danh mục port theo module, không phải khẳng định code v2 đã tương thích Paperclip. Nhánh/source/evidence v2 được giữ; không xóa hoặc copy nguyên v2 vào fork. Reuse là ưu tiên bắt buộc: khi có module đáp ứng contract, detailed task phải chọn giữ/port hoặc ghi lý do kỹ thuật cụ thể nếu viết lại.

## Bảng module và release

Đường dẫn nguồn tương đối repo Crew v2; đường dẫn đích tương đối fork Paperclip. Prefix đích `crew/` được khóa lại trong implementation-map sau khảo sát upstream.

| Phần đã có / source | Tận dụng như thế nào | Phải thay hoặc hoàn thiện | Đích / release |
|---|---|---|---|
| `v2/src/{model-policy,workflow-policy,ticket-policy,completion-policy}.ts` | Giữ quy tắc chọn model, pin/gate, 5 vòng sửa và docs completion; giữ các test hành vi | Ánh xạ status/ID/action Paperclip, không cấp authority từ kết quả policy thuần | `crew/contracts/`, workflow/assistant policy; R1 |
| `v2/gateway/src/host/`, `ipc/`; `v2/desktop/src/main/` | Port host lock/status/IPC, quyền và shell tách khỏi process chạy | Nối runtime/transport thật; pairing/auth/version/permission theo fork; installer ký phải nghiệm thu lại | `crew/gateway/`, `crew/desktop/`; R1, updater R2 |
| `v2/gateway/src/journal/`, `resources/`, `telemetry/` | Port journal/process identity, resource ownership, cleanup, macOS telemetry và capacity primitives | Thay grant/fence/run binding bằng Paperclip + Crew contract; kiểm crash/native/process tree trên candidate | `crew/gateway/`; R1 |
| `v2/gateway/src/sync/`, `commands/`, `execution/ticket-command-bridge.ts` | Giữ kinh nghiệm/test về delivery/ACK/replay/STOP; tái dùng primitives phù hợp | HTTP/event payload Crew và 005/007 authority không giữ nguyên; xây remote adapter/facade. Không port scheduler cũ thành scheduler thứ hai | `crew/transport/`, `crew/remote-adapter/`; R1 |
| `v2/gateway/src/workflows/`, `isolation/` | Port fetch/checksum, stage/pin/registry/retention/projection và isolation/audit | Entry/tool sources của Paperclip cũng phải nằm trong audit; exact official version/runtime certification; không gọi test fixture là isolation PASS | `crew/workflows/`, gateway isolation; R1 |
| `v2/gateway/src/assistant/{workflow-manifest,render-executor,render-artifacts}.ts` | Giữ workflow definition, render/artifact inspection và provenance logic | Render receipt/server latch/reconcile còn thiếu phải hoàn thiện; map story/plan artifact sang Paperclip issue graph | `crew/workflows/`; R1 |
| `v2/gateway/src/models/` | Port inventory/probe/source switch/current credential binding/broker logic | Đổi transport và secret flow; provider key giữ local; native adapters/API tool loop/fallback chưa đủ phải xây phần thiếu | `crew/gateway/`, `crew/assistant/`; R1, file capability R2 |
| `v2/gateway/src/runtime/` | Giữ runtime pin/tool-policy/effect-ledger contracts và regression chống duplicate logical effect | Nối launcher/runtime thật và logical operation identity Paperclip; không giữ DB attempt chain Crew song song | `crew/gateway/`, remote adapter; R1 |
| `v2/server/src/assistant/`; `v2/gateway/src/assistant/tool-client.ts` | Port pure schema/authority checks/workflow gates, tool hashing/idempotency và kinh nghiệm inbox | SQL actor/turn/ticket linkage/routes thay bằng facade/namespace tham chiếu core; driver/admission/dispatch/monitor chưa hoàn thành vẫn phải xây | `crew/assistant/`, `crew/workflows/`; R1 |
| `packages/docs-kit/`; `v2/server/src/docs/{validator,manifest,links,checksum}.ts` | Giữ chuẩn docs/CLI, validation, checksum và manifest/link parsing | Bổ sung heading/semantic review/merged-result checks cần thiết; không bỏ R2/R3 freshness contract của docs chuẩn | `crew/docs/`; R1 |
| `v2/server/src/docs/{import,read,search,routes}.ts` | Port import/checksum/search/snapshot semantics và test ACL/restart/restore | Repository/route/auth đổi sang Paperclip namespace; graph/dedup là bổ sung mới, không ghi là v2 đã có | `crew/docs/`; R1 core, R2 graph/dedup |
| `v2/server/src/attachments/extract/`, worker protocol/runner/diagnostic | Port parsers, bounded extraction/provenance, golden corpus và negative fixtures | Corpus/boundary chưa được chứng nhận đầy đủ; storage/access/jobs đổi theo Paperclip attachment IDs và ACL, không copy toàn schema009 | extension extraction trong `crew/`; R2 |
| `v2/web/src/graph/`, `tickets/`, `compose/`, `docs/`, `machines/` | Port layout/node/edge/map/dialog presentation, composer/docs/onboarding UI và acceptance scenarios | Replace API/query/auth/routes/state mapping/theme sang Paperclip UI extension; core board/list có sẵn thì dùng trước, không rebuild bản trùng | `crew/ui/`; R1 map/docs/machine, R2 files/graph/usage |
| `plans/261002-0002-crew-v2/execution-phase*/` | Giữ findings/rulings/test evidence làm checklist regression, tiết kiệm khám phá lại lỗi đã biết | Evidence cũ không cấp PASS cho binary/schema v3; chạy lại test phù hợp exact port candidate | Detailed plans và tests R1/R2 |

## Phần Paperclip thay thế

- Server ticket/project/comment identity, login/auth và lifecycle/run scheduler của Crew: dùng core Paperclip, không copy các bảng/API v2 để quản lý cùng ticket hai lần.
- Execution command/attempt DB chain: ánh xạ contract cần thiết sang run core và namespace local grant; invariant no-duplicate/STOP/effect được giữ nhưng implementation persistence có thể thay.
- Web shell/auth/board/list nền: ưu tiên UI Paperclip, port phần đặc thù Crew như map, docs, máy/model/workflow. Không bỏ test UX chỉ vì component core đã có.
- Credential/machine/run/ticket data v1/v2 không tự nhập; code reuse khác data migration. Docs/identity project nhập có audit như spec.

## Phần phải xây mới hoặc hoàn thiện

Remote adapter Paperclip, compatibility facade, core pre-mutation/pre-spawn patch nếu SDK thiếu, version/patch/update pipeline, host assembly, AI runtime/tool loop/fallback, Assistant orchestration hoàn chỉnh, semantic docs gate, graph/dedup, usage normalization/registry và signed remote updater còn các khoảng trống. Không cộng source stub/schema hoặc test unit thành hoàn thành toàn module.

## Hợp đồng cho mỗi task port

Trước viết code, detailed plan phải có một record với:

1. Source branch/full SHA, exact file list và upstream license/provenance nếu source chứa code bên thứ ba.
2. Chức năng giữ nguyên, schema/API/runtime/authority sẽ thay và invariants phải giữ.
3. Tập test v2 được giữ; findings/ruling nào còn mở; test Paperclip integration mới.
4. Đường dẫn đích/ownership/release A hoặc B; shared mutation/facade/schema edits serialize.
5. Verdict giữ nguyên có wrapper, port một phần, Paperclip thay thế, hoặc viết lại có lý do. Ước lượng sau khi đọc contract, không dùng số dòng làm tiết kiệm.

Gate port: source provenance kiểm được → meaningful regression → test GREEN trên candidate → independent review → integration acceptance đúng release. Native/browser/DB evidence phải thật. Lỗi chưa đạt của v2 vẫn giữ trong backlog và không được biến mất trong đổi tên module.

## Theo dõi mức tận dụng

Ledger ghi theo capability/module: giữ nguyên logic, port có thay đổi, upstream thay thế, xây mới; kèm commit/tests/findings và effort đo. Không hứa tỷ lệ reuse code hoặc token tiết kiệm trước khi port. Nếu viết lại module trong bảng, reviewer kiểm lý do tránh bỏ công v2 chỉ vì repo đích mới.

R1 gate phải có reuse inventory và report module đã port; R2 bổ sung phần parsers/UI/storage và giữ inventory toàn bộ. Nhánh v2 giữ làm nguồn đối chiếu tới sau acceptance v3, không dọn như scratch của một run.
