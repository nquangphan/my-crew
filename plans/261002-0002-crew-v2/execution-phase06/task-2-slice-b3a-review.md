# Review B3a — Route tool của Trợ lý (server) — 04/10/2026

Phạm vi: `922abed^..922abed` (bỏ log), gồm `v2/server/src/assistant/tools.ts` (422 dòng, mới), `routes.ts` (+6), `test/assistant-tools-route.test.ts` (mới, 17 test), `test/support/assistant.ts` (+13/−5), docs `server-assistant`. Em đối chiếu với brief B3a (10 ràng buộc và RED tối thiểu), phase-06 mục R2, các ruling trong ledger (tới 00:50, carrier providerCallId), và spec thiết kế §2/§3. Em trace vào code đã nghiệm thu: `journal/mutation.ts`, `authority.ts` (resolver), `store.ts` (`assertCurrentTurnFence`), `orchestration.ts` (verify, graph, consumed GUC), `runs.ts` (`createRunRequest`/`planRun`), `gates.ts` (`createOwnerQuestion`), `docs/read.ts`, `attachments/snapshots.ts` và `references.ts`, migration 011. Em không chạy lại test. SHA của `tools.ts` và `support/assistant.ts` trên worktree khớp với report.

### Spec Compliance

| # | Ràng buộc brief | Kết quả | Căn cứ |
|---|---|---|---|
| 1 | Xác thực trước replay: máy, turn/process/generation/designation/fence, snapshot, tool_names, ngân sách | ✅ | `mutation.ts:31-34`: advisory lock → `event_cursor` FOR UPDATE → `authorize` → mới tra `idempotency`. `tools.ts:127-202` kiểm credential trong Tx (route 404-406), path = fence, scope theo (turn, snapshot, còn hạn), resolver khóa toàn chuỗi, actor = máy đã xác thực, pin, `tool_names`, ngân sách |
| 2 | Chống dò: proof → scope trước mọi query ticket; lỗi trước đó cùng hình dạng | ✅ | `tools.ts:138-150`: mọi `ApiError` trong khối này (gồm 409/503/403 của resolver) đổi thành cùng 404. Test `:388` so `deepEqual` cả status lẫn body của 10 biến thể. `create_run` kiểm root trước khi tra ticket (`:252`) |
| 3 | `request_hash = operationRequestSha256` cho mọi tool, kể cả tool chưa release | ✅ | `:102-104`, `:239/243/255/259/273`. Cast `as unknown as OperationRequest` vô hại: hàm chỉ băm `{schema, action, payload}`, và tên tool không trùng action nào của port ngoài `create_run`/`ask_owner`, vốn cùng ngữ nghĩa |
| 4 | Row pending ghi trực tiếp trong Tx, không savepoint, trước port; `event_cursor` khóa trước root; `createRunRequest` gọi sau khi resolve | ✅ | `:221-226` chèn trên `tx`. `createRunRequest` → `planRun` chỉ đọc (đã kiểm `runs.ts:346-353`). Port/gates kiểm `xmin=pg_current_xact_id()` |
| 5 | Replay chỉ đọc kết quả đã lưu; trùng ID mà payload khác → 409 | ✅ | Replay trả `idempotency.response`, không UPDATE gì (test kiểm `xmin` không đổi, `:728`). Khác body hoặc providerCallId → `IDEMPOTENCY_CONFLICT`. ID, sequence hoặc provider đã có trong turn → `ASSISTANT_OPERATION_CONFLICT` (`:215-219`) |
| 6 | Một port mỗi assembly | ✅ | `:115-118`. Tập consumed hiện nằm trong GUC cục bộ của Tx (`orchestration.ts:100-111`), nên dù có nhiều instance port cũng không mở được lỗ hổng |
| 7 | So actor của resolver với máy đã xác thực; ticket mang actor A | ✅ | `:146`; test `:602` kiểm `created_actor` và actor journal = A |
| 8 | All-or-nothing | ✅ | Lỗi ném ra ngoài `db.begin` → rollback. Test ask_owner lỗi muộn (`:678`) và response mất trước commit (`:771`) |
| 9 | Mỗi tool đúng một kind; tool lạ bị từ chối, không lưu JSON tùy ý | ✅ | `:69-74`, `:228`. Schema strict trả 400. Tool chưa release chỉ lưu hash và response cố định |
| 10 | ask_owner: không ticket → 422; wait intent pending | ✅ ⚠️ | `gates.ts:732-733`; pending đã ghi trong report và docs |
| R2 | `GET /v2/assistant/turns/:id/tools/:operationId` | ⚠️ | Brief B3a không giao; còn pending |
| R2 | Unrouted scope chỉ có quyền đọc/đề xuất cho message | ✅ ⚠️ | Đọc catalog/docs của mọi dự án khớp spec §2 (dòng 29: "Docs toàn hệ thống"), §3 (dòng 42: "biết danh mục toàn bộ dự án, đọc được docs") và R2 (`route_message.docReadIds`). Nhưng nhánh này chưa có test (I1) |

### Security trace

- **Thứ tự auth trước replay:** 503 (thiếu assembly) → schema 400 → bearer 401 → owner 403 → header 400 → trong Tx: credential hiện hành, path/fence, scope, resolver, actor, pin 409, tool_names 403, ngân sách 409/503 → idempotency → consume. Không có nhánh replay nào chạy trước `authorize`. Các lỗi đứng trước bước scope (400/401/403/503) chỉ phụ thuộc vào hình dạng request hoặc credential, không phụ thuộc vào việc turn/scope có tồn tại hay không.
- **Chống dò:** Một mã 404 với cùng message. Lỗi không phải `ApiError` (lỗi PG) bị ném lại thành 500, nhưng mọi ID đã qua kiểm UUID trước, nên input của model không gây ra được lỗi PG. Thời gian xử lý khác nhau giữa turn không tồn tại (thoát sớm ở `:142`) và turn của máy khác (đi hết chuỗi khóa của resolver). Chỉ máy đã xác thực mới đo được khác biệt này, và ID là UUIDv4, nên em chấp nhận.
- **Model không mint được scope:** Scope được chọn theo (turn, `pin.snapshotId`). Resolver yêu cầu `session.snapshot_id = scope.input_snapshot_id` với đúng read session của turn (`authority.ts:206`), nên mỗi turn chỉ có một snapshot hợp lệ.
- **Binding hash:** read và tool chưa release băm `{action: tên tool, payload: input}`. `create_run` băm `bound` do server dựng, gồm graphSha256. `ask_owner` băm proposal và được `gates.ts:762` đối chiếu lại. Row `rejected` không phải `pending`, nên port không dùng nó để authorize được.
- **Replay và xung đột:** Khóa idempotency là (actor, route, operationId chữ thường). Dùng lại operationId ở turn khác: authorize theo turn mới, sau đó body hash khác → 409. Máy khác dùng lại: idempotency không thấy, `consume` gặp PK → 409. Ba request trùng chạy đồng thời được tuần tự hóa bằng advisory lock và `event_cursor` (test `:789`).
- **Header carrier:** Đếm trên `rawHeaders` nên không bị gộp bằng dấu phẩy. Chỉ nhận `0x21–0x7e`, dài 1–4096, chặn được Unicode, CR/LF và khoảng trắng. Giá trị ghi bằng tham số SQL và chỉ đi vào hash của journal. Khớp ruling 00:50.
- **Khóa input:** Pin được đọc mà không FOR SHARE. Điều này vẫn an toàn vì mọi writer của link/routing/revision đều khóa `event_cursor` trước (`references.ts:120,151`), và route giữ `event_cursor` suốt Tx. Đây là một bất biến cần giữ (⚠️).
- **Tài nguyên:** Body ≤ 1 MiB (mặc định của Fastify). Ngân sách số lời gọi không tính lời gọi bị lỗi 4xx (M2). Ngân sách không bị bypass qua replay, vì replay không tạo row.

### Strengths

- Mọi kiểm authority nằm trong `authorize` và chạy trước idempotency. Đây đúng là kiểu bypass replay mà các slice trước hay mắc.
- Test anti-probe so cả body, không chỉ status. Test effect đếm 8 bảng, gồm `events` và `idempotency`.
- `WeakSet` cộng điều kiện `call.tx === tx` ngăn dùng lại một `AuthorizedToolCall` ở Tx khác.

### Issues

**Critical:** không có.

**Important**

- **I1 — Nhánh scope message chưa route (đọc chéo dự án) không có test.** File `tools.ts:287-293` (`${scope.projectId}::uuid is null or …`) và `:314`. Fixture `assistant-tools-route.test.ts:138-142` chỉ seed scope root với `project_id` đặt sẵn. *Vì sao quan trọng:* đây là nhánh có quyền đọc rộng nhất của route, đúng nhánh report đề nghị PM xác nhận (open question 4). Hiện chưa có test nào chứng minh ba điều: scope message chưa route đọc được catalog và docs của dự án khác; scope message đã route (có `project_id`) bị giới hạn về đúng dự án đó; `create_run`/`ask_owner` từ scope message trả 404 mà không tra ticket. *Cách sửa:* thêm một test seed `assistant_scopes` với `root_ticket_id=null, message_id=<msg>, project_id=null`, rồi assert ba điều sau: (a) `read_catalog` trả cả hai dự án, sắp xếp theo key; (b) `read_docs` của dự án thứ hai trả 200 và ghi receipt; (c) `create_run` trả cùng 404 như root lạ. Thêm một biến thể với `project_id` = dự án 1 và assert `read_docs` của dự án 2 trả 404.

**Minor**

- **M1 — Ngân sách thời gian chặn cả replay của operation đã commit.** File `tools.ts:196-202`. Ngân sách số lời gọi đã loại chính operation (`operation_id<>…`), nhưng điều kiện `elapsed` áp cho mọi request. Nếu response bị mất sau commit gần hạn `maxTurnMs`, gateway không lấy lại được kết quả: route GET chưa có, nên effect rơi vào trạng thái uncertain. Mốc thời gian còn đo từ `assistant_turns.created_at` (lúc reserve), không phải lúc driver thật sự bắt đầu. *Cách sửa:* bỏ qua `elapsed` khi đã có row của chính `operationId` trong turn (giống ngân sách số), hoặc để PM ruling rằng "budget trước replay" bao gồm cả thời gian. Ngoài ra thêm một test cho `maxTurnMs`; hiện nhánh này không có test.
- **M2 — Lời gọi lỗi 4xx không tính vào ngân sách.** File `tools.ts:196-198` kết hợp với rollback. Một vòng lặp model gọi `read_docs` vào path không có có thể lặp vô hạn trong một turn. Mỗi lần gọi đều giữ `event_cursor` FOR UPDATE toàn cục và cả chuỗi khóa của resolver, nên chặn mọi mutation khác. *Cách sửa:* ghi vào checklist T7 (rate limit hoặc đếm lỗi theo turn). Không cần sửa trong lát này.
- **M3 — Thiếu test cho vài nhánh đã có code:** header provider trùng hai lần (`:356-361`); dùng lại operationId ở turn khác; `route_message`, `assess_ticket`, `publish_reply` chưa release (mới test 3/6). *Cách sửa:* thêm vào bảng case hiện có.
- **M4 — Harness test khác `buildApp`.** Test dùng AJV `coerceTypes:false, useDefaults:false` và error handler riêng (`test:168-178`), còn `app.ts:102` chỉ đặt `removeAdditional:false`. Test hiện chưa chứng minh được hành vi khi chạy trong assembly production. *Cách sửa:* đưa vào checklist T7 như điều kiện để mount route.
- **M5 — `readDoc` và `readCatalog` viết lại logic của `docs/read.ts`.** Gồm `validPath`, decode UTF-8 fatal, và trạng thái current/stale trùng `readProjectDocsState`. Viết lại có lý do: `readDocsPage` tự mở Tx và dùng scope theo binding máy. Nhưng logic trạng thái nên gọi `readProjectDocsState(tx, projectId)` để hai nơi không lệch nhau. Không chặn.
- **M6 — Fixture `test/support/assistant.ts` nằm ngoài danh sách ownership của brief.** Đây là thay đổi test-only, giữ mặc định cũ, đã nêu trong report và docs flow đã cập nhật. Không chặn; chỉ ghi lại.

### ⚠️ cần PM ghi nhận

- W1 — Catalog `limit 1000`, không phân trang và không có cờ báo bị cắt. Contract đã freeze nên dự án thứ 1001 trở đi biến mất mà không có tín hiệu. Ghi vào T7, hoặc thêm trường vào contract sau.
- W2 — Đọc chéo dự án của scope chưa route là đúng spec, nhưng PM cần ruling rõ: tiếp tục dùng `latestSnapshotId` theo `received_at` (gồm cả snapshot unverified/invalid, giống `readProjectDocsState`), hay chỉ dùng `latest_verified_snapshot_id`.
- W3 — Pin input đọc không khóa và dựa vào bất biến "mọi writer revision đều khóa `event_cursor` trước". Writer mới nào đi ngoài `mutate()` sẽ phá bất biến này.
- W4 — Còn pending: route GET `tools/:operationId`, wait intent của `ask_owner`, mount production và inject `createAssistantTools`, gateway `tool-client.ts`.
- W5 — Cast trong `toolRequestSha256` an toàn chừng nào chưa có action port nào trùng tên tool. Khi mở rộng `OperationRequest`, phải giữ tách miền.
- W6 — `maxTurnMs` là field có sẵn trong policy contract (`contracts.ts:48,545`), không phải field tự chế. Việc áp nó ở tầng tool là mở rộng hợp lý, nhưng xem M1.

### Assessment

Không có lỗ hổng authority. Thứ tự auth → replay, binding hash, ghi row trực tiếp trước port, rollback toàn phần và chống dò đều đúng, có trace và có test. Lát này cần một test bổ sung cho nhánh scope message chưa route trước khi khép.

**Task quality:** Needs fixes (I1; M1 và M3 nên làm cùng lượt).
