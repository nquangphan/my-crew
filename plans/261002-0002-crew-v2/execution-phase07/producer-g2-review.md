# Review P-G2: mount attachment trong buildApp và projection commentId→refs

Commit `b39f2fb` (diff `b39f2fb^..b39f2fb`, bỏ log). Review độc lập, không chạy lại test. Code ngoài diff chỉ mở để kiểm từng rủi ro đã nêu.

### Spec Compliance

- ✅ `registerAttachmentRoutes` được mount trong `buildApp` bằng factory thật đã accept (`createFileBlobStore`, `createReceiverRegistry` + `readLocalWriterIdentity`, `createStageServices`, `createAttachmentSubmissions` với `createTicketServices`, `createMessageServices`) — `v2/server/src/app.ts` `assembleAttachments`, mount ở cuối chuỗi register.
- ✅ `registerInputScopeRoutes` luôn được mount. Các port chưa có producer (selection, assistant, routing, retire, `inputs` Task6, `executionGate`) không được truyền. Mặc định đều fail-closed: `executionGate ?? denyAttachmentExecution` (`routes.ts:343`), `inputs` vắng trả 409 `INPUT_SERVICES_NOT_CONFIGURED` (`routes.ts:603`), `messages` vắng trả 409 (`routes.ts:679`), routing vắng trả 503, storage vắng trả 503 (`routes.ts:901`). Code production không chứa authority test hay authority giả.
- ✅ Không đổi migration; schema 009 đủ dùng (`attachment_links.comment_id`, check loại trừ `message_route_id`).
- ✅ Projection additive `GET /v2/tickets/:id/attachments/by-comment` lọc theo ACL, thứ tự ổn định (nhóm theo commentId, ref theo linkId). DTO ref dùng chung `ticketAttachmentRef` với danh sách phẳng, nên DTO phẳng giữ nguyên về ngữ nghĩa (`fileName`/`mime` chỉ thêm `String()`/giữ null).
- ✅ Không sửa tickets/assistant/gateway/web. Docs R3 đã cập nhật: flows `server-attachments`, `server-docs-view`, `flows.yaml`, `files.md`.
- ✅ Thu hẹp kiểu `registerInputScopeRoutes` (các port thành optional) khớp hành vi runtime sẵn có (`??` / kiểm vắng).
- ⚠️ G2 (phase-07 dòng 74) chưa đóng trọn: thiếu wiring `main.ts`, nên entrypoint prod trả 404 cho upload. Bằng chứng parser/corpus/publication/recovery của Task5 cũng chưa có, nên submission có tệp trả 503 `EXTRACTION_NOT_CONFIGURED`. PM ruling 15:00 đã chấp nhận hai điểm này ngoài phạm vi P-G2. Gate G2 phải để PENDING, không được ghi PASS.
- ⚠️ Message services chạy production mà không có decision authority, nên machine/scope/reply trả 503. PM ruling 15:00 đã chấp nhận.
- ⚠️ Writer upload trong test buildApp là fixture port macOS. Đường native Linux `readLocalWriterIdentity` → `createReceiverRegistry` qua `buildApp` chưa được test nào chạy.

### Security

- ACL của by-comment giống hệt danh sách phẳng. Route gọi `deps.auth.authenticate`, rồi `authenticateCurrentCredential`, rồi `requireProjectScope` (`tickets/service.ts:61`: machine phải đúng `projects.machine_id`, sai thì 404). Ticket lạ trả 404 trước khi đọc link. Đã kiểm.
- Không lộ ref của comment mà caller không được thấy. Bảng `comments` (`migrations/004_tickets.sql:52`) không có cột hiển thị hay xóa mềm, nên ai có scope ticket thì thấy mọi comment của ticket. Query join `c.id=l.comment_id and c.ticket_id=l.ticket_id` và `l.ticket_id=${ticketId}`. Link thừa kế (`references.ts:82`) và link route (`routing.ts:161`) không ghi `comment_id`, nên không lọt vào projection. Link bị revoke và chuỗi kế thừa không hợp lệ bị `liveLinkIds` loại.
- Mutation đi qua `jsonRoutes`/`requireOwner` sẵn có (`auth/routes.ts:43-50`): có bearer thì 403 `OWNER_REQUIRED`, Origin sai thì 403 `ORIGIN_INVALID`, CSRF sai thì 403 `CSRF_INVALID`. Mount test chỉ kiểm CSRF trên PUT content; Origin dựa vào suite attachments-api sẵn có.
- Fail-closed khi thiếu config là đúng: không có assembly thì không mount storage route (policy 404). `storageHostId` sai, root không private hoặc host không phải Linux đều làm `buildApp` throw trước khi tạo Fastify. `extractorVersion` rỗng thì throw. Không có `persistIntent`, nên owner route không ghi blob extraction.
- Download giữ `private, no-store` và `content-disposition: attachment`. Policy không lộ storage root (có test).

### Web contract mismatches

So `v2/web/test/support/compose-server.ts` với server tại HEAD `b39f2fb`:

1. Fake không có `GET /v2/tickets/:id/attachments/by-comment`. Web cần decoder `{items:[{commentId,attachments:Ref[]}],nextCursor}`.
2. Fake không mô phỏng 503 `EXTRACTION_NOT_CONFIGURED` (`submissions.ts:147`) cho submission có tệp.
3. Selection chứa `attachmentId` lạ: server trả 404 `NOT_FOUND` "Không tìm thấy tệp" (`submissions.ts:138-140`), fake trả 409 `SELECTION_CHANGED` (`compose-server.ts:372`).
4. Fake không phát 403 `ORIGIN_INVALID`/`OWNER_REQUIRED` (`auth/routes.ts:43,47`), chỉ có `CSRF_INVALID`.
5. `POST /v2/auth/session`: server trả 200 (handler return mặc định, mount test assert 200), fake trả 201 (`compose-server.ts:163`).
6. Fake không có hết hạn: server trả 409 `SELECTION_CHANGED` khi compose hết hạn (`submissions.ts:133`) và 409 `ATTACHMENT_UPLOAD_EXPIRED` (`staging.ts:391`). Fake không có cả hai nhánh.
7. 401: server còn có `SESSION_INVALID` (`auth/session.ts:116`), fake chỉ có `UNAUTHENTICATED`.

Report §6 nêu ví dụ lệch "`SELECTION_CHANGED` vs `ATTACHMENT_SELECTION_STALE`". **Ví dụ này sai.** Server dùng `ATTACHMENT_SELECTION_STALE`/`ATTACHMENT_COMPOSE_CLOSED`/`ATTACHMENT_UPLOAD_CONFLICT` ở staging (`staging.ts:342,344,389,622,630,640`) và `SELECTION_CHANGED` ở submission (`submissions.ts:135,146`). Fake dùng đúng như vậy ở cùng tầng (`compose-server.ts:262-295` và `366/372`). Các mã `ATTACHMENT_NOT_FOUND`, `ATTACHMENT_UPLOAD_BUSY`, `ATTACHMENT_REPLAY_MISMATCH`, `COMPOSE_ALREADY_SUBMITTED`, `IDEMPOTENCY_CONFLICT`, `ATTACHMENT_NOT_READY` 422 đều khớp.

### Strengths

- Keyset projection theo `comment_id` UUID cùng thứ tự với `GET /v2/tickets/:id/comments` (`tickets/routes.ts:357`, `order by id`). Web có thể ghép trang comment và trang ref theo cùng cursor.
- Gom DTO vào `ticketAttachmentRef` loại được một bản sao mapping, không đổi wire.
- Lỗi assembly làm startup thất bại sớm, không chạy nửa vời.

### Issues

**Critical:** không có.

**Important**

- I1 — `producer-g2-report.md` §6: ví dụ mismatch `SELECTION_CHANGED` vs `ATTACHMENT_SELECTION_STALE` là sai (xem bằng chứng ở trên). S5a có thể đổi mã đang đúng của web theo ví dụ này. Ngược lại, các lệch thật (#3 404 vs 409, #5, #6) lại không được nêu. Fix: controller dùng danh sách 7 mục ở trên thay cho §6 khi giao S5a; ghi đính chính vào ledger.

**Minor**

- M1 — `v2/server/src/app.ts` `uuidPattern`: regex chỉ nhận chữ thường. Nếu env sau này chứa UUID viết hoa, startup thất bại với `ATTACHMENT_STORAGE_HOST_INVALID`. Vẫn fail-closed, nhưng dễ gây bất ngờ khi nối `main.ts`. Fix: thêm cờ `/i` và `toLowerCase()` trước khi lưu, hoặc ghi rõ ràng buộc chữ thường trong `.env.example` khi wiring.
- M2 — `v2/server/test/attachment-mount.test.ts`: chưa có test chứng minh `buildApp({attachments})` không có `receivers` sẽ throw trên host không phải Linux, hay root không private sẽ throw. Report khẳng định điều này nhưng chưa có bằng chứng. Fix: thêm một test `assert.rejects(buildApp(...))` trên darwin (hoặc dùng `storageHostId` sai).
- M3 — `v2/server/src/attachments/comment-refs.ts:43-50`: hai query riêng (danh sách comment, rồi danh sách ref) chạy dưới READ COMMITTED. Nếu một link bị revoke chen giữa hai query, một nhóm có thể ra với `attachments: []`. Fix: gộp thành một query (CTE chọn comment id rồi join), hoặc lọc nhóm rỗng.
- M4 — `v2/server/test/attachment-mount.test.ts` (projection test): chưa assert machine đã bind đúng project đọc được (200), chưa assert link thừa kế không xuất hiện trong by-comment, và chưa kiểm Origin sai trên mutation. Fix: thêm ba assert này.
- M5 — `comment-refs.ts:41`: mỗi trang chạy lại `liveLinkIds` đệ quy trên mọi link của ticket và đẩy cả danh sách vào `in (...)`. Chi phí không bị chặn theo số link của ticket. Danh sách phẳng cũng làm như vậy nên không phải hồi quy, nhưng nên ghi nợ hiệu năng.

### Assessment

**Task quality:** Approved

Không có lỗi chặn về spec hay bảo mật. Trước khi giao S5a, I1 phải được đính chính trong ledger/handoff (sửa tài liệu, không sửa code). Gate G2 vẫn PENDING cho tới khi có wiring `main.ts` và extractor Task5 được chứng nhận.
