# Report B3a — Route tool của Trợ lý (server) — 04/10/2026

**Kết quả: DONE_WITH_CONCERNS.** Route `POST /v2/assistant/turns/:id/tools` và consumer cho `read_catalog`, `read_docs`, `create_run`, `ask_owner` đã xong; sáu tool còn lại trả `rejected`/`TOOL_NOT_RELEASED` với row ràng hash và không effect. RED 17/17 fail trên scaffold `NOT_IMPLEMENTED`; GREEN cuối 254/254 (237 cũ của S2/S4/S5 cộng 17 mới); hồi quy 102/102; scoped strict tsc exit 0 (log rỗng); Biome 0 lỗi, 0 warning; `crew-docs generate`, `check --all`, `check --staged` ok trên mirror. Production vẫn chưa mount: `app.ts` không gọi `registerAssistantRoutes`, và khi thiếu assembly `tools` thì route trả 503.

Concern chính: header mang `providerCallId` (`x-crew-provider-call-id`) là lựa chọn của em theo đề xuất "approved-in-principle" ở `task-2-preflight.md:95`. Tên header và cách chuẩn hóa chưa được PM freeze (xem mục cuối).

## Bối cảnh

- Worktree `/Volumes/CORSAIR/Projects/my-crew-v2`, nhánh `codex/crew-v2-server`. **BASE `0bbc63e8d967c6ac9ba8a90ad54739a043ff8aee`.** Lúc viết report, HEAD đã lên `22dda3d` do worker web commit; các commit đó không chạm file của lát này.
- Node v24.21.0, pnpm 10.32.1, Biome 2.5.14, TypeScript 7.0.2, PostgreSQL `postgres:18.6` (image local `4ef4dbc939d6`).
- Nguồn đã đọc: brief B3a, phase-06 mục R2, memo PM A2/A3/A7, `progress.md` (các ruling B3), review S2/S4/S5 (N1, N2, W2, W3, W4, W5, W9, M1, M4), source accepted `authority.ts`, `orchestration.ts`, `runs.ts`, `gates.ts`, `operation-request.ts`, `store.ts`, `contracts.ts`, migration 011, `journal/mutation.ts`, `auth/routes.ts`, `docs/read.ts`, fixture `test/support/assistant.ts`.

## File đã đổi

| File | Thay đổi |
|---|---|
| `v2/server/src/assistant/tools.ts` (mới, 422 dòng) | `createAssistantTools({verifierBuildSha256, lookup?})` → `{authorize, consume}`; `registerAssistantToolRoutes`; đọc catalog/docs theo scope |
| `v2/server/src/assistant/routes.ts` | Thêm tham số thứ tư `assembly: {tools?}` (mặc định `{}`) và gọi `registerAssistantToolRoutes`; route config giữ nguyên |
| `v2/server/test/assistant-tools-route.test.ts` (mới) | 17 test qua Fastify inject, authenticator và journal thật, PostgreSQL riêng |
| `v2/server/test/support/assistant.ts` | **Bổ sung fixture test-only:** tùy chọn `snapshotCanonical` của `seedAdmittedTurn` (mặc định `{}` như cũ), để snapshot có `required` cho pin selection. Không đổi hành vi mặc định |
| `v2/docs/flows.yaml` | Thêm `server/src/assistant/tools.ts` và `server/test/assistant-tools-route.test.ts` vào `server-assistant` (sửa dưới lock manifest, đúng hunk của em) |
| `v2/docs/flows/server-assistant.md` | Điểm vào, bước 13–14, bảng Files, Tests |
| `v2/docs/files.md` | Do `crew-docs generate` sinh (2 dòng) |

Không sửa `authority.ts`, `orchestration.ts`, `runs.ts`, `gates.ts`, `operation-request.ts`, `contracts.ts`, migration, `app.ts`, `main.ts`, web hay gateway.

## Trace authority, khóa và replay

Handler, theo đúng thứ tự:

1. `tools` vắng → 503 `ASSISTANT_TOOLS_NOT_CONFIGURED`.
2. Fastify kiểm body bằng `routingToolRequestSchema` strict: tool lạ, trường dư, kết quả giả gắn vào body đều trả 400 và không ghi gì.
3. `deps.auth.authenticate`: không có bearer hoặc bearer sai trả 401; owner trả 403 `ASSISTANT_MACHINE_REQUIRED`.
4. Header `x-crew-provider-call-id` phải có đúng một lần (đếm trên `rawHeaders`), ASCII nhìn thấy được, dài 1–4096, giữ nguyên hoa thường, không trim. Sai trả 400.
5. `deps.mutator` với route `POST:/v2/assistant/turns/:id/tools`, key = `operationId` chữ thường, body journal `{providerCallId, request}`. Mutator lấy advisory lock, rồi `event_cursor` FOR UPDATE, rồi gọi `authorize`:
   - kiểm lại credential máy trong Tx;
   - `:id` phải bằng `fence.turnId`;
   - tìm đúng một `assistant_scopes` của `turn_id` với `input_snapshot_id = pin.snapshotId`, `expires_at > clock_timestamp()`. Scope được suy từ turn và input, model không đưa scopeId;
   - resolver persisted khóa guard → machine → config → designation → turn → monitor → grant → session → selection → receipt (admission, PASS, deployment, verifier);
   - Actor do resolver trả phải đúng máy đã xác thực (S4 W2).

   **Mọi lỗi tới đây đều thành cùng 404 `ASSISTANT_SCOPE_NOT_FOUND` với cùng message**, và chưa đọc ticket nào. Sau đó mới kiểm tiếp:
   - pin input: sha256 của snapshot, input revision, `sha256(canonical(required))` khớp selection, revision và route revision hiện hành của đích. Lệch trả 409 `ASSISTANT_INPUT_STALE`;
   - `scope.tool_names` phải chứa tool, nếu không trả 403 `ASSISTANT_TOOL_NOT_IN_SCOPE`;
   - ngân sách: số operation khác của turn phải nhỏ hơn `maxToolsPerTurn`, và turn chưa quá `maxTurnMs`. Sai trả 409 `ASSISTANT_TOOL_BUDGET_EXHAUSTED`; policy hỏng trả 503.
6. Chỉ sau `authorize` mutator mới tra `idempotency`. Replay cùng body trả response đã lưu, không UPDATE hay upsert gì (S2 N2). Test kiểm `xmin` của row không đổi. Khác body (payload hoặc provider call) trả 409 `IDEMPOTENCY_CONFLICT`.
7. Với operation mới, `consume` chạy theo các bước sau:
   - nếu `operation_id`, `client_sequence` hoặc `provider_call_id` đã có trong turn thì trả 409 `ASSISTANT_OPERATION_CONFLICT`;
   - ghi row `assistant_tool_operations` **trực tiếp trong Tx, không qua savepoint, trước khi gọi port**. `request_hash` được tính bằng `operationRequestSha256`:
     - `read_catalog`, `read_docs`, và tool chưa release: action là tên tool, payload là input;
     - `create_run`: trước hết kiểm `rootTicketId` bằng root của scope (lệch trả 404, không tra ticket). Sau đó gọi `runs.createRunRequest`, tức là sau khi proof đã resolve ra scope (S4 N2), và hash bao gồm graphSha256 do server tự tính;
     - `ask_owner`: payload là `QuestionProposal` đã gửi;
   - gọi port hoặc service: `runs.createRun`, `gates.createOwnerQuestion`, đọc catalog, hoặc đọc docs cộng ghi receipt 011;
   - kiểm kind của kết quả (`catalog`, `docs`, `run`, `question`), rồi UPDATE row từ `pending` sang `completed` với response.
8. Lỗi bất kỳ sau lần ghi đầu đều ném ra ngoài và rollback toàn Tx: row, effect và journal (S4 W4). Response được lưu và trả ở dạng canonical JSON. Khi replay, handler canonical lại phần jsonb đã lưu, nên body giống từng byte.

Về thứ tự khóa: turn (qua resolver) bị khóa trước root (trong `createRun`), đảo so với plan. Điều này vẫn an toàn: writer nào giữ root rồi mới khóa guard/turn đều đi qua `event_cursor` trước (S2 W4), và route giữ `event_cursor` trước tất cả. Đây cũng là thứ tự memo A2 yêu cầu ("transport resolve proof → scope trước mọi truy vấn ticket").

Các ràng buộc 1–10 của brief:

| # | Ràng buộc | Thực hiện |
|---|---|---|
| 1 | Xác thực máy, fence, input, tool_names, ngân sách đều xong trước replay | Kiểm trong `authorize` |
| 2 | Không cho dò sự tồn tại | Một hình dạng 404 trước khi resolve scope |
| 3 | Mọi tool ràng hash | Tính bằng `operationRequestSha256` |
| 4 | Thứ tự ghi | Row ghi trực tiếp trước port, `event_cursor` khóa trước |
| 5 | Replay | Chỉ đọc kết quả đã lưu, ID xung đột trả 409 |
| 6 | Một port mỗi assembly | Mỗi assembly có đúng một resolver và một port, dùng chung cho runs và gates |
| 7 | Actor | So máy đã xác thực với resolver; ticket mang `created_actor` = A |
| 8 | All-or-nothing | Rollback toàn Tx khi lỗi |
| 9 | Đúng kind kết quả | Tool lạ trả 400 |
| 10 | `ask_owner` | Câu hỏi không có ticket trả 422; wait intent còn pending |

## TDD

| Lượt | Nội dung | Kết quả | Exit | Log SHA (16) |
|---|---|---|---|---|
| RED | `assistant-tools-route.test.ts` trên scaffold: `createAssistantTools` và handler đều ném `NOT_IMPLEMENTED` | 17/17 fail: 16 fail tại `createAssistantTools` sau khi fixture đã seed row thật, 1 fail vì 500 ≠ 503 | 1 | `dac866168b144866` |
| GREEN run1 | cùng file | 13/17. Hai lỗi: (a) oracle `create_run` của test được tính sau khi run đã tồn tại; (b) replay trả thứ tự key jsonb | 1 | `97acf2cf3fb39b48` |
| GREEN run2 | sau khi sửa: oracle tính trước; response canonical ở handler | 17/17 | 0 | `a600ec3f9b4e4d2d` |
| GREEN | 9 file: tools-route, workflows, authority, orchestration-port, mutations, orchestration, tickets, deploy, dependencies | 254/254 | 0 | `dec752a40651c1f9` |
| Hồi quy | api-acceptance, assistant-store, attachments-routing, attachments-snapshots, attempts, completion, docs-read, repair | 102/102 | 0 | `496dedc3df968a8f` |
| GREEN cuối | 9 file như trên, trên source cuối (sau khi sửa cleanup fixture trong test) | 254/254, 101 scratch tạo và 101 xóa | 0 | `fc8d542cb6467bef` |
| tsc strict scoped | `tools.ts`, `routes.ts`, test, `support/assistant.ts` | log rỗng | 0 | `e3b0c44298fc1c14` |
| Biome | 4 file sở hữu | `Checked 4 files`, 0 lỗi, 0 warning | 0 | `316b2e405612b93d` |

Test được viết trước source. Thứ duy nhất có trước RED là scaffold khai báo type, cộng dòng nối `registerAssistantToolRoutes` vào `routes.ts` với handler ném `NOT_IMPLEMENTED`. Không có source nháp nào ngoài repo.

17 test phủ đủ danh sách RED tối thiểu:

- 503 khi thiếu assembly;
- 401 khi thiếu hoặc sai token; header provider sai trả 400;
- một hình dạng lỗi cho 10 biến thể trước resolve: path ≠ fence, turn lạ, generation, process, designation, designation revision, snapshot lạ, máy C, máy B, scope hết hạn;
- tool lạ, trường dư, kết quả giả, operationId hỏng, sequence 0 → 400;
- pin cũ (sha, selection, revision, đích đã sang revision mới) → 409;
- tool ngoài `tool_names` → 403;
- ngân sách: lần gọi kế bị từ chối nhưng replay vẫn được;
- `read_catalog`: hash oracle, các field của row, response;
- `read_docs`: `DocRead` và receipt; dự án ngoài scope, dự án lạ, path thiếu → cùng 404;
- `create_run` thành công: ticket mang actor A, journal actor A, hash bằng oracle độc lập;
- `create_run` trên root ngoài scope và root lạ → cùng 404;
- `ask_owner` thành công; không ticket → 422; lỗi muộn sau khi ghi row → rollback row;
- ba tool chưa release → `rejected` với hash oracle, không effect;
- replay sau commit không ghi thêm; bốn kiểu xung đột → 409;
- response mất trước commit: không effect, retry áp dụng đúng một lần;
- ba request trùng chạy đồng thời → một run.

Lệnh test: `NODE_OPTIONS=--max-old-space-size=384 CREW_V2_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/crew_v2_test CREW_V2_TEST_CONTAINER_ID=<id> node --test --test-concurrency=1 --test-timeout=180000 <files>` (chạy trong `v2/server`).

Lệnh tsc: `pnpm exec tsc --noEmit --ignoreConfig --skipLibCheck --target ESNext --module NodeNext --strict --allowImportingTsExtensions --erasableSyntaxOnly --verbatimModuleSyntax --types node src/platform/picomatch.d.ts src/platform/thread-stream.d.ts src/attachments/extract/yauzl.d.ts <4 file>`.

Lệnh Biome: `node_modules/.bin/biome check <4 file>` (chạy ở gốc repo).

## Hash source cuối (SHA-256)

| File | SHA-256 |
|---|---|
| `v2/server/src/assistant/tools.ts` | `7e0952fbbedaf13157941acd21afa55e45c7f3dee7a1984445a03a6d6cfcd32c` |
| `v2/server/src/assistant/routes.ts` | `27535bc048947ddf3ce4c1a3c50a73d8291002e84131f2bcdedc9736b101b432` |
| `v2/server/test/support/assistant.ts` | `60f16b43b4ed8a8fcea8f73ecc8553fa4fef705242a1245b399afbeeb8f62122` |
| `v2/docs/flows.yaml` | `807063642fa3f64765720ea9fc486875ac29bedefe7e26c7c05d8ad34bccdefc` |
| `v2/docs/flows/server-assistant.md` | `8d5fe52ceca1efd9131ab39e9f5a2e61b3e11fb97c7b985bb99cf4520165679c` |
| `v2/docs/files.md` | `3f479cd5c3620da157c1c4642ea2a489d6ea07d48dba877d3ae213d9624694ba` |

Test file đổi sau GREEN đầu (thêm `closeAttachments`). Hash của nó nằm trong commit; lượt GREEN cuối chạy trên đúng bản này.

## Docs

Đã cập nhật `server-assistant.md` (điểm vào, bước 13–14, Files, Tests) và hai dòng manifest. Kiểm trên mirror trong `$TMPDIR/crew-v2-b3a/mirror`: lấy `git archive HEAD:v2`, commit baseline, rồi overlay đúng 6 file của lát. `crew-docs generate` cho `index.md` unchanged và `files.md` updated (2 dòng, đã chép về worktree). `check --all` ok, `check --staged` ok. Mirror đã xóa. Hook commit chạy lại khi commit.

## Tài nguyên và dọn dẹp

- Mọi lượt nặng đều lấy `$TMPDIR/crew-v2-heavy-slot.lock` với owner `b3a`, và chỉ chạy khi `pm-telemetry.py` trả `heavyEligible=true`: available 4,16–5,03 GiB, pressure 1, CPU idle ≥ 77,99 %. Có 13 lần kiểm cho kết quả không đủ điều kiện (3,42–3,99 GiB); những lần đó em trả lock và chờ, không chạy. Lock được trả bằng `rm -rf` đúng thư mục trong trap EXIT; hiện tại không còn lock của `b3a`.
- PG chạy 6 container `crew-v2-test-<uuid>` với `--rm --memory 256m --cpus 1 --pids-limit 64 -p 127.0.0.1::5432`. Inspect cho 268435456 / 1000000000 / 64. Port loopback ngẫu nhiên: 63966, 50214, 49491, 50360, 51538, 54843. Sau mỗi lượt: `pg_database like 'crew_v2_test_%'` = 0, `docker stop`. Kiểm lại cuối: cả 6 ID cho `docker ps -a --filter id` rỗng. Không chạm container của người khác.
- Không còn process `node --test`.
- Fixture scratch: các lượt đầu để lại root `crew-v2-attachments-*`, vì `close()` của test em che mất `close()` của fixture attachment. Em đã sửa test để gọi `closeAttachments()`; lượt GREEN cuối tạo 101 root và xóa 101. Ngoài ra em xóa 68 root còn sót. Mỗi root đó đều có tên trong log của chính em và có `.fixture-owner.json`; kiểm lại cho 0 còn lại.
- Script runner nằm ở `$TMPDIR/crew-v2-b3a/` (thư mục scratch riêng của em). Log và resource log mới đều mang tên `task-2-slice-b3a-*`.

## Tự review

- Không có port test-trust: test dùng `seedAdmittedTurn` thật với resolver production và hằng verifier của fixture.
- Không test nào chỉ kiểm mock.
- Các lỗi trước khi resolve scope không lộ sự tồn tại ticket hay project. Sau khi resolve, `create_run` và `read_docs` ngoài scope trả 404 mà không tra row.
- Một cast có chú thích: `toolRequestSha256` ép `{action: toolName, payload}` sang `OperationRequest`. Lý do: union chỉ liệt kê action mà port tiêu thụ, và `operation-request.ts` đã được nghiệm thu nên không thuộc quyền sửa của lát này. Hash vẫn dùng đúng tag `crew-v2:operation-request:1`, và tên tool tách miền khỏi các action của port.
- Ngoài ngân sách `maxToolsPerTurn` (cần cho RED), em có thêm `maxTurnMs`. Đây là phần mở rộng theo cách em đọc chữ "budget" của brief; PM có thể bỏ nếu cho là ngoài phạm vi.
- Validator Fastify của assembly production phải cấu hình `removeAdditional:false`, `coerceTypes:false`, `useDefaults:false` như doc 011 đã ghi. `buildApp` hiện chỉ đặt `removeAdditional:false`. Việc này không ảnh hưởng hôm nay vì route chưa mount, nhưng là điều kiện khi release.

## Câu hỏi và việc còn mở

1. **Carrier `providerCallId` chưa được freeze.** Em dùng header `x-crew-provider-call-id`: đúng một lần, ASCII `0x21–0x7e`, dài 1–4096, không trim, đưa vào body journal và cột `provider_call_id`, nhưng không vào `request_hash` (để giữ ràng buộc 3). PM cần xác nhận tên và quy tắc này, hoặc ra ruling khác, trước khi gateway `tool-client.ts` dùng.
2. `ask_owner`: wait intent (phase-06:226) vẫn chưa làm. Câu hỏi không có ticket vẫn trả 422 (S5 W5).
3. Chưa có `GET /v2/assistant/turns/:id/tools/:operationId`. Plan R2 nhắc tới route này nhưng brief B3a không giao.
4. Catalog của scope message trả mọi dự án, tối đa 1000, không phân trang. `read_docs` với scope message chưa route được đọc docs của mọi dự án. Đây là cách em hiểu quyền route message theo plan ("message read/propose"); cần PM xác nhận.
5. Production assembly, tức inject `createAssistantTools` và mount `registerAssistantRoutes`, chờ PM release riêng.

## Fix round 1 — 04/10/2026

Đầu vào: review `task-2-slice-b3a-review.md` (không có lỗ hổng authority) và các ruling PM do coordinator chuyển. Lượt này sửa I1, M1, M3, M5, W1, W2. M2, M4, M6 và W3–W6 PM đã ghi vào ledger và checklist T7. Lượt sửa bắt đầu từ HEAD `42d68a2`; khi commit, HEAD đã là `d87f2fd` do worker khác commit.

**Kết quả: DONE_WITH_CONCERNS.**

- RED: 23 test, 18 pass, 5 fail, mỗi test fail đúng vì tính năng còn thiếu.
- GREEN: 260/260 (237 test S2/S4/S5 cộng 23 test của route tool).
- Hồi quy: 102/102.
- Kiểm tĩnh: scoped strict tsc exit 0, log rỗng. Biome 0 lỗi, 0 warning.
- Docs: `crew-docs check --all` và `check --staged` đều ok.

Concern duy nhất: W1 buộc phải thêm field vào contract, nên `contracts.ts` (ngoài danh sách sở hữu ban đầu) bị đổi theo yêu cầu của PM.

| Mục | Thay đổi | Test |
|---|---|---|
| I1 | Không đổi code. Bổ sung test cho đúng ba nhánh scope message. Fixture route test có thêm `target: 'root'\|'message'\|'routed'`: turn và scope theo message; scope `routed` dựa trên row decision và route test-only | Scope chưa route: catalog trả mọi dự án (so oracle SQL), `read_docs` đọc dự án khác được 200 và có receipt, `create_run` trả cùng 404 với root lạ mà không có effect. Scope đã route: catalog chỉ trả đúng một dự án, docs của dự án khác cho cùng 404 với dự án lạ |
| M1 (ruling) | Nếu đã có row của chính `operationId` trong turn thì miễn `maxTurnMs` cho lần đó (ngân sách số lời gọi vốn đã loại chính operation); lời gọi mới vẫn chịu hạn | Sau khi đặt `maxTurnMs = 1`: lời gọi mới trả 409 `ASSISTANT_TOOL_BUDGET_EXHAUSTED`, replay trả 200 giống từng byte và không có effect |
| M3 | Header provider không còn nhận dấu phẩy, vì dấu phẩy là cách các dòng header lặp bị gộp. RED cho thấy `inject` gộp hai giá trị thành `a,b` nên lọt qua bộ đếm `rawHeaders`. Bộ đếm vẫn giữ để bắt hai dòng thật | Header lặp trả 400 `PROVIDER_CALL_ID_INVALID`. OperationId đã có ở turn khác (row test-only tạo trong phiên replica) trả 409 `ASSISTANT_OPERATION_CONFLICT`, không có effect. `route_message`, `assess_ticket`, `publish_reply` trả `rejected` với hash oracle, không có effect (giờ đủ 6/6 tool chưa release) |
| M5 | `read_docs` lấy trạng thái current/stale từ `readProjectDocsState(tx, projectId)` của `docs/read.ts`. Snapshot chưa verified là `unverified`; là bản mới nhất và project `current` thì `current`; còn lại `stale`. Bỏ phần so `expected_commit` tự viết | Test có sẵn (`current`) cộng test mới: bản verified cũ hơn trả `stale` |
| W2 (ruling) | `latestSnapshotId` lấy theo `projects.latest_verified_snapshot_id` và commit của snapshot đó; null nếu chưa có bản verified | Có một snapshot unverified mới hơn nhưng catalog vẫn trả bản verified. Dự án chưa verified trả null/null (trong oracle của test scope message) |
| W1 | `RoutingToolValue` kind `catalog` thêm `truncated: boolean` (cả type lẫn schema strict trong `contracts.ts`). Query lấy 1001 dòng, chỉ trả 1000 và đặt `truncated = rows > 1000`. Mẫu contract trong `support/assistant.ts` thêm `truncated:false` | 1000 dự án thêm vào cộng dự án fixture: trả 1000 item và `truncated: true`. Các test catalog khác kiểm `truncated: false`. `assistant-store` (kiểm schema strict với mẫu) PASS |

**Bằng chứng**

| Lượt | Kết quả | Exit | Log SHA (16) |
|---|---|---|---|
| RED | 23 test, 18 pass, 5 fail: catalog thiếu `truncated` và latest theo `received_at` (2 test), cờ cắt (1), replay bị chặn bởi `maxTurnMs` (1), header lặp trả 200 (1) | 1 | `bcb72a07daeb2120` |
| GREEN run1 | tools-route cộng assistant-store: 62/62 | 0 | `a5df5b21cccc1bbb` |
| GREEN | 9 file như lượt trước: 260/260 | 0 | `bd272ec8ad6fe07f` |
| Hồi quy | 8 file: 102/102 | 0 | `209974402ed2b31a` |
| tsc strict scoped | `tools.ts`, `routes.ts`, `contracts.ts`, `assistant-tools-route.test.ts`, `support/assistant.ts`, `assistant-store.test.ts` | 0, log rỗng | `e3b0c44298fc1c14` |
| Biome | 4 file: `tools.ts`, `contracts.ts`, test, support | 0 | `227777352c39f0b2` |

Hash source cuối (SHA-256):

| File | SHA-256 |
|---|---|
| `tools.ts` | `6c1751c9af576698390dea280d05aacc0445345ec845bae70f6cba5b6b5e0d85` |
| `contracts.ts` | `20f368f46ea4032b68ffafa7226f1c1915be6b3b827b2e8c9e72a0899c62132f` |
| `assistant-tools-route.test.ts` | `2813913678651548e96630cd0532c32a38fb45b7c13d26ee8dcd30a903bda074` |
| `support/assistant.ts` | `b6935fb8550f4b623b5e1b64daf0406cbbc00c91afe74750f66df847c177ceaf` |
| `server-assistant.md` | `f71c31466e728d800afa0a8f95566139aeec5a61ba3d02ff86fe11b89be4066b` |

**Docs.** `server-assistant.md` cập nhật bước 13 (header không nhận dấu phẩy, replay đã commit được miễn ngân sách), bước 14 (catalog theo phạm vi, verified, `truncated`; trạng thái docs qua `readProjectDocsState`) và bảng Files. Manifest không đổi vì `contracts.ts` đã nằm trong flow `server-assistant`. Kiểm trên mirror: `generate` cho `index.md` và `files.md` unchanged; `check --all` và `--staged` ok. Mirror đã xóa.

**Tài nguyên.** Có 5 lượt nặng, cả 5 đều được lock owner `b3a` với `heavyEligible=true` (available 4,31–4,92 GiB, pressure 1). Bốn container PG `crew-v2-test-<uuid>` (256m / 1 CPU / pids 64), port loopback 62151, 62564, 62357, 63278. Sau mỗi lượt còn 0 DB; kiểm `docker ps -a` cho cả 4 ID đều rỗng. Không còn `node --test` nào. Fixture scratch: số root tạo bằng số root xóa ở mọi lượt (23/23, 57/57, 107/107, 53/53), không còn root sót. Không còn lock.

**Concern.**

1. W1 đổi frozen contract `RoutingToolValue` (thêm `truncated` bắt buộc) trong `v2/server/src/assistant/contracts.ts`. File này nằm ngoài danh sách sở hữu của brief; em đổi theo yêu cầu trực tiếp của PM ở lượt này. Gateway hay web chưa có consumer nào của kind `catalog`. Plan phase-06 mục R2 cần được cập nhật type cho khớp.
2. Test "operationId đã có ở turn khác" giả lập turn kia bằng một row test-only chèn trong phiên replica, vì mỗi lần chỉ có một turn sống và fixture không dựng được turn thứ hai. Test này đi qua nhánh PK/`consume`. Nhánh journal khác body (cùng máy, turn khác) đã được phủ gián tiếp bởi các test `IDEMPOTENCY_CONFLICT`.
3. Header provider giờ không nhận dấu phẩy. Đây là thu hẹp so với ruling 00:50 (ASCII nhìn thấy được), có tài liệu đi kèm; PM xác nhận.
