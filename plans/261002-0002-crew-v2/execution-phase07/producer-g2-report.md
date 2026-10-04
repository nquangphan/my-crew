# Producer P-G2: mount attachment trong buildApp và projection commentId→refs

**Trạng thái: DONE_WITH_CONCERNS.** BASE `2a9126e`; HEAD lúc commit `329e1df` (hai commit S5a FIX1 chen vào, không chạm file của P-G2). Commit: `b39f2fbf7fc02c2b4025d25fe744a830a90d6f17`.

## 1. Kết quả

- `buildApp` (`v2/server/src/app.ts`) nhận `attachments?: AttachmentAssembly` (`config`, `storageHostId` UUID, `extractorVersion?`, `receivers?`). Khi có assembly, server dựng `createFileBlobStore`, receiver Linux native (`readLocalWriterIdentity` + `createReceiverRegistry`, closed-ACK), `createStageServices`, `createAttachmentSubmissions` (ticket factory thật) và `createMessageServices`, rồi mount `registerAttachmentRoutes`. Assembly lỗi (storageHostId sai, không phải Linux, root không private) làm `buildApp` thất bại trước khi tạo Fastify.
- `registerInputScopeRoutes` luôn được mount. Các port chưa có producer không được truyền: execution gate machine (409 `ATTACHMENT_EXECUTION_NOT_CONFIGURED`), Task6 `inputs` (409 `INPUT_SERVICES_NOT_CONFIGURED`), routing (503 `INPUT_ROUTING_NOT_CONFIGURED`), retire (503), selection/Assistant (deny mặc định), decision authority (503 cho machine/scope/reply). Không có authority test nào đi vào production.
- `extractorVersion` không truyền thì `queuePolicy` vắng. Submission có tệp trả 503 `EXTRACTION_NOT_CONFIGURED`; submission chỉ có chữ vẫn chạy. Task5 parser chưa có phiên bản được chứng nhận, nên production phải giữ trạng thái này.
- Projection mới `GET /v2/tickets/:id/attachments/by-comment?limit=&cursor=` (`attachments/comment-refs.ts` → `readCommentAttachmentGroups`) trả `{items:[{commentId,attachments:TicketAttachmentRef[]}],nextCursor}`. Endpoint dùng chung ACL với danh sách phẳng (current credential, owner hoặc machine đúng project, ticket lạ trả 404) và chỉ lấy link sống thuộc comment của chính ticket. Nhóm xếp theo commentId, cursor là commentId cuối trang, ref trong nhóm xếp theo linkId. Không cần đổi schema; migration 001–011 giữ nguyên. DTO ref dùng chung `ticketAttachmentRef` với `GET /v2/tickets/:id/attachments`, và DTO cũ không đổi (web decode strict nên em không thêm field vào danh sách phẳng).
- `registerInputScopeRoutes` đổi kiểu các port `selection/assistant/routing/retire` thành optional. Code đã có `??`/kiểm vắng sẵn, nên runtime không đổi.

## 2. Danh mục endpoint (phase-07 dòng 115–125)

| Endpoint | Có trong `routes.ts` | Mount qua buildApp |
|---|---|---|
| GET `/v2/attachment-policy`, POST/GET/DELETE compose, POST uploads, PUT content, DELETE upload | có | có khi có assembly |
| POST `/v2/attachment-submissions/tickets`, POST `/v2/tickets/:id/attachment-comments` | có | có khi có assembly; có tệp mà thiếu extractor thì 503 |
| GET `/v2/tickets/:id/attachments`, GET content/derivative content, GET extractions | có | có khi có assembly |
| GET `/v2/tickets/:id/attachments/by-comment` | **mới** | có khi có assembly |
| POST `/v2/attachment-conversations`, POST `/v2/attachment-submissions/messages`, GET `/v2/attachment-conversations/:id/messages` | có | luôn mount; thiếu storage thì 409 `INPUT_SERVICES_NOT_CONFIGURED` |
| POST `/v2/attachment-messages/:id/route` | có | luôn mount; 503 `INPUT_ROUTING_NOT_CONFIGURED` |
| Machine manifests/receipts/content, grants/sessions/snapshots | có | mount theo nhóm trên; mặc định từ chối |

Thiếu: **`v2/server/src/main.ts` chưa truyền `attachments`** vì file này nằm ngoài phạm vi được giao. Vì vậy entrypoint production hiện chưa có route storage (404), còn route input trả 409/503. Phần wiring còn lại chỉ là `loadAttachmentConfig(env)` cộng một biến storage host UUID (ví dụ `CREW_V2_ATTACHMENT_STORAGE_HOST_ID`) rồi truyền vào `buildApp`, và chỉ chạy được trên host Linux.

## 3. RED/GREEN

| Bước | Lệnh | Kết quả |
|---|---|---|
| RED | Tạm khôi phục `app.ts` và `routes.ts` của HEAD, chạy `node --test --test-timeout=300000 test/attachment-mount.test.ts` | exit 1, tests 3, pass 0, fail 3. Cả ba fail vì route chưa mount (actual 404, expected 401/409/201). Log: `producer-g2-red.log` |
| GREEN focused | cùng lệnh, source mới | exit 0, 3/3. Log: `producer-g2-green.log` |
| Affected | `--test-concurrency=1`: attachment-mount, attachments-api/access/routing/messages/submissions, api-acceptance, model-certification, model-secret | exit 0, 52/52. Log: `producer-g2-affected.log` |
| buildApp consumers | docs-read, model-pool, gateway | exit 0, 42/42. Log: `producer-g2-affected-buildapp.log` |
| Typecheck | `pnpm typecheck` (server) | exit 1, chỉ còn lỗi baseline `pdf-lib` ở `extract/pdf.ts` và `attachments-pdf-image.unit.test.ts` (Task5 pending, không phải file của em). File của em không có lỗi. Log: `producer-g2-typecheck.log` |
| Biome | `biome check` 4 file | exit 0. Log: `producer-g2-biome.log` |
| Docs | `crew-docs generate` + `check --all` trên bản sao HEAD có `v2/` làm root; `check --staged` và hook commit-msg | ok |

Nội dung test (`v2/server/test/attachment-mount.test.ts`, buildApp thật):

1. Policy 401 khi chưa đăng nhập, 200 khi có session và không lộ root. Compose → reserve → PUT 201 rồi replay 200; thiếu CSRF bị 403. Đọc compose thấy trạng thái ready; download 200 với `no-store` và `attachment` disposition, chưa đăng nhập bị 401. Comment có tệp 201, danh sách phẳng giữ đúng DTO. Machine chưa bind nhận 404 khi đọc list và 403 khi tải nội dung. Compose sang project khác bị 404.
2. Assembly mặc định không có storage: policy 404, conversation 409 `INPUT_SERVICES_NOT_CONFIGURED`, route 503 `INPUT_ROUTING_NOT_CONFIGURED`. Có storage nhưng không có extractor: conversation/message chỉ chữ trả 201 và list thấy message; route 503; comment có tệp 503 `EXTRACTION_NOT_CONFIGURED`; machine manifest 409 `INPUT_SERVICES_NOT_CONFIGURED`.
3. Projection: hai comment có tệp trên ticket a được nhóm đúng commentId; comment chỉ chữ, comment của ticket b và comment có link đã revoke đều bị loại. Ref trong nhóm theo linkId; gọi lặp lại cho kết quả giống hệt; trang limit=1 chuyển đúng cursor và trang cuối có cursor null. Kiểm thêm 401, limit=0 trả 400, ticket lạ 404, machine chưa bind 404.

Riêng writer upload trong test dùng fixture port macOS (`attachmentFixture().receivers`), vì registry native cần `/proc` của Linux. Native registry đã có kiểm thử riêng trong suite staging Linux.

## 4. Hash (sha256)

- `v2/server/src/app.ts` `6c8af4986579b89b542d518f356c5d8c4e3dcc7ea86e80fe44fb6997424cace5`
- `v2/server/src/attachments/routes.ts` `1f48d3968421eee4689298b7f019e15e48bc0e5d5fe9e6964af72d7d28732807`
- `v2/server/src/attachments/comment-refs.ts` `24132e2afee745a9d99f71b8bf7a75ad0528db2209c4186edd3993f580a5f549`
- `v2/server/test/attachment-mount.test.ts` `fbe1dbc674de3eb6d47279112057958c01994db90c2cf333fc2beca0a77ede39`

## 5. Tài nguyên và dọn dẹp

- Telemetry trước khi chạy: pressure 1, available 4,83 GiB, CPU idle 78,7%, đĩa trống 751 GiB. Trước lượt affected: 4,92 GiB, idle 86,6%.
- Heavy slot `$TMPDIR/crew-v2-heavy-slot.lock` (owner=producer-g2) giữ từ 03:50:46Z tới khi chạy xong test, rồi đã `rm -rf`.
- PostgreSQL riêng `postgres:18.6` tên `crew-v2-test-97e577c9-0920-49de-ac9e-58c7637a713d` (id `42af61f3624f…`), 256m/1CPU/pids64, cổng `127.0.0.1:56603`. Container đã stop (`--rm`) và `docker ps -a` không còn. Scratch `crew-v2-attachments-*` đã bị fixture xóa (đếm còn 0). Test chạy với `NODE_OPTIONS=--max-old-space-size=384` và `--test-concurrency=1`.
- Manifest lock giữ từ lúc đọc HEAD `329e1df` tới khi commit xong, rồi đã xóa. Index chỉ nhận hai dòng của em trong `flows.yaml` và `files.md` (đã kiểm `git show HEAD`); hunk `assistant/orchestration` của worker khác vẫn nằm nguyên, chưa stage, trong working tree.

## 6. Lệch hợp đồng so với fake web (`v2/web/test/support/compose-server.ts`)

- Fake chưa có `GET /v2/tickets/:id/attachments/by-comment`, nên web cần decoder mới (nhóm `commentId` + ref cùng DTO với danh sách phẳng).
- Fake chưa mô phỏng 503 `EXTRACTION_NOT_CONFIGURED`. Server thật trả lỗi này cho mọi submission có tệp cho tới khi có extractorVersion được chứng nhận, nên A5 với tệp thật vẫn bị chặn bởi Task5.
- Fake trả mã `ATTACHMENT_SELECTION_STALE`/`ATTACHMENT_COMPOSE_CLOSED`/`ATTACHMENT_UPLOAD_CONFLICT`; server dùng các mã của `staging.ts`/`submissions.ts` (ví dụ `SELECTION_CHANGED`). Em chưa đối chiếu hết từng mã. Nguồn đúng là server.
- Shape `ComposeSession`, `{attachment,selectionRevision}`, `{session,attachments}`, `Comment` và `AssistantMessage` khớp contracts server ở những trường mà test đã chạm tới.

## 7. Câu hỏi mở

1. Ai sở hữu wiring `main.ts` cùng biến môi trường storage host (cần một dòng `attachments: {config: loadAttachmentConfig(env), storageHostId}`)? Trước khi có wiring này, entrypoint production chưa phục vụ upload.
2. Production đang mount `createMessageServices` (Task2b đã accept) không kèm decisionAuthority: owner tạo được conversation và message, còn machine/scope/reply bị 503. Cần PM xác nhận đây là phạm vi G2 mong muốn.

## Đính chính §6 (PM, 04/10 15:25, theo review `producer-g2-review.md` I1)

Ví dụ "`SELECTION_CHANGED` vs `ATTACHMENT_SELECTION_STALE`" ở §6 là sai: fake và server dùng cùng mã ở cùng tầng (staging `staging.ts:344` ↔ `compose-server.ts:263`; submission `submissions.ts:135` ↔ `compose-server.ts:366`). Danh sách lệch đã xác nhận giữa fake web `v2/web/test/support/compose-server.ts` và server là 7 mục ở mục "Web contract mismatches" của `producer-g2-review.md`: thiếu route by-comment; thiếu 503 `EXTRACTION_NOT_CONFIGURED`; selection chứa id lạ server trả 404 `NOT_FOUND` còn fake 409 `SELECTION_CHANGED`; thiếu `ORIGIN_INVALID`/`OWNER_REQUIRED`; login server 200 còn fake 201; thiếu nhánh hết hạn (`SELECTION_CHANGED` khi compose hết hạn, `ATTACHMENT_UPLOAD_EXPIRED`); thiếu 401 `SESSION_INVALID`. Server là hợp đồng chuẩn.
