# Đọc tài liệu và ghép API bền vững Crew v2

## Mục đích

Cung cấp cây tài liệu, trang nguyên trạng, tìm kiếm Unicode và API HTTP ghép đầy đủ các producer phần 02. Mỗi kết quả giữ nguồn snapshot, commit, audit và phân loại từng file. Snapshot nhập từ v1 vẫn là `unverified` hoặc `invalid`; server không nâng nhãn từ lời báo của host.

## Điểm vào

- `server/src/app.ts` → `buildApp`: ghép route trên pool caller cung cấp, không migrate hoặc mở listener.
- `server/src/main.ts` → `main`: đọc cấu hình, mở listener loopback và đóng app/pool khi nhận tín hiệu.
- `server/src/docs/routes.ts` → `registerDocsRoutes`: tree/page/search, owner import và machine sync.

## Các bước

1. `server/src/app.ts` → `buildApp`: tạo Fastify với AJV giữ trường dư để schema từ chối, body thường tối đa 1 MiB, credential log được redaction; `ApiError` giữ status/code, lỗi JSON/schema trả 400, body quá lớn 413, lỗi DB không nhận diện trả 503 chung. Callback dispatch/final verification mặc định `denyDispatch`/`denyFinalResult`; authority được caller cung cấp rõ ràng, không có biến môi trường bật bypass.
2. `server/src/docs/routes.ts` → `registerDocsRoutes`: tree/page ở `/v2/projects/:id/docs/tree|page`, search ở `/v2/docs/search`; query chỉ nhận trường khai báo, snapshot UUID phải thuộc đúng project. Import `POST /v2/docs/imports` cần owner/Origin/CSRF; sync `POST /v2/projects/:id/docs/sync` cần máy đúng project/attempt/fence, callback `authorizeDocsSync(tx)` chạy trước response cached. Hai upload có giới hạn JSON 24 MiB; các giới hạn decoded/file/project của producer vẫn giữ nguyên.
3. `server/src/docs/read.ts` → `readDocsTree`, `readDocsPage`: kiểm tra project và máy chưa bị thu hồi trong transaction read-only repeatable-read. Mặc định chọn snapshot có `received_at,id` mới nhất; snapshot tường minh không vượt project. Tree dùng trang tổ tiên thật gần nhất, ưu tiên `index.md` trong thư mục; giữ link/import occurrence. Page decode UTF-8 strict từ bytea, giữ CRLF, BOM và NUL, SHA lấy từ byte gốc; API trả JSON text, không thực thi/render Markdown. `relatedTicketIds` tối đa 20 và chỉ trong project đã được phép.
4. `server/src/docs/search.ts` → `searchDocs`: query 1–256 ký tự, giới hạn 1–100; dùng SQL tham số với `websearch_to_tsquery('simple',q)` và GIN rank trên prefix 8192 ký tự. Luôn bổ sung literal ILIKE trên `search_text` đầy đủ, escape `%`, `_`, `\`; query chứa NUL dùng cùng `projectStorageText` của producer. Snippet là string projection thuần tối đa 240 code point, không chèn HTML highlight và không tuyên bố bỏ dấu. Cursor base64url chứa score/project/snapshot/path và hash query/filter, được kiểm tra kiểu string UUID và path bằng validPath trước bind SQL; thứ tự score DESC rồi project/snapshot/path giữ tie ổn định. Chỉ tìm snapshot mới nhất mỗi project nếu chưa chọn snapshot tường minh. Transaction có budget monotonic 2000 ms; set_config statement_timeout transaction-local trước scope/query và giảm theo thời gian còn lại trước từng truy vấn tiếp theo. PostgreSQL cancellation 57014 hoặc budget cạn trả ApiError SEARCH_DEADLINE_EXCEEDED 503, rollback và không trả items rỗng như thành công.
5. `server/src/docs/read.ts` → `readProjectDocsState`, `docsSourceReader`, `docsCompletionReader`: state `missing` khi chưa có snapshot, `unverified`/`invalid` theo audit, `current` chỉ khi snapshot verified và commit khác null khớp `expected_commit`, còn lại `stale`. Composite project/snapshot/path kiểm tra ticket links. Completion dùng pointer latest verified checkout snapshot, commit và receipt cùng project/merged commit, sáu trang chuẩn implemented cùng tất cả flow docs được manifest yêu cầu. Aggregate mixed được chấp nhận khi phần chuẩn implemented đủ; artifact không thay trang chuẩn. Producer 006 chưa tạo verified authority nên đường production tiếp tục fail closed tới phần 08.
6. `server/src/app.ts` → `buildApp`: nối `createExecutionAuthority`, guard rebind `assertNoActiveProjectExecution`, source/completion readers, project docs state và current credential reader vào route factory. Ticket mutation giữ thứ tự root/ticket/project/machine và recheck trước replay. SSE recheck credential cùng scope/event trong mỗi transaction snapshot; session hết hạn hoặc token thu hồi đóng stream. `preClose` đóng socket SSE trước Fastify chờ shutdown.
7. `server/src/main.ts` → `main`: chỉ chạy khi file được gọi trực tiếp; `CREW_V2_PORT` mặc định entrypoint là 8792, bind `127.0.0.1`. Không auto-migrate/start host agent; config producer độc lập giữ mặc định 8788 nếu được gọi trực tiếp ngoài main. Signal đóng listener/SSE và pool. Import module không tạo side effect.

8. `server/src/app.ts` → `buildApp`: ghép `registerGatewayRoutes` cho namespace007; AppOptions nhận optional GatewayProjectionPolicy do composition phase06 cấp, mặc định SELECTION_NOT_CONFIGURED. ServerOptions/DispatchPermit và hai default deny execution/final giữ nguyên; không auto-migrate007. Gateway mutation recheck actual credential dưới khóa machine/entity trước cache. Flow `server-gateway` mô tả boot/config/report/command/projection.

## Files

| Đường dẫn từ `v2/` | Vai trò |
|---|---|
| `server/src/app.ts`, `server/src/main.ts` | Route composition và entrypoint loopback |
| `server/src/docs/read.ts` | Tree/page, source/completion reader và docs state |
| `server/src/docs/search.ts` | FTS/literal fallback, scoped cursor, plain snippet |
| `server/src/docs/routes.ts` | Docs endpoints và bounded upload |
| `server/test/support/http.ts` | Bootstrap/login cookie-CSRF qua Node fetch, port 0, identity replay qua restart |
| `server/test/docs-read.test.ts` | Unicode/raw bytes/audit/class, full-prefix fallback, tree/source references và completion fixture |
| `server/test/api-acceptance.test.ts` | HTTP execution, restart/restore, replay races, credential snapshot/SSE, default deny và shutdown |

## Dữ liệu

Cấu hình giữ các tên `CREW_V2_DATABASE_URL`, `CREW_V2_PUBLIC_ORIGIN`, `CREW_V2_PORT`, `CREW_V2_SESSION_ENCRYPTION_KEY`; migration vẫn do CLI riêng và `CREW_V2_MIGRATION_THROUGH` chọn prefix. Main không đọc credential v1. Test dùng container UUID riêng trên port loopback ngẫu nhiên khác 5432/55432, logical DB `crew_v2_test_<uuid>` với prefix 001–006; backup restore vào `crew_v2_restore_<uuid>`. Test close app/pool, drop đúng DB và runner dừng đúng container đã tạo.

Test authority là callback và attestation do test tạo, có provenance `testAuthority: Task7`; không là bằng chứng quyền thực thi/kiểm chứng merge của production. Fixture verified tạo snapshot immutable mới, không sửa imported row hay migration 006. Page dùng byte gốc; snippet/link/audit projection biểu diễn NUL bằng literal `\u0000`, nhãn và warnings của import vẫn giữ.

## Flow liên quan

`server-platform` cấp DB/config; `server-journal` cấp transaction/replay/cursor và SSE; `server-identity` cấp current credential/binding; `server-tickets` cấp hierarchy, docs refs và completion policy; `server-execution` cấp fencing/reconcile/guards; `server-docs-import` bảo toàn byte, class, audit và receipts. Runtime/planner/merge verifier thật thuộc các phần sau.

## Tests

`pnpm --dir v2/server test` chạy toàn bộ test gồm HTTP listener thật port 0, cookie/CSRF, graph/dependency/comment/decision, owner import replay, checkpoint/pause ACK/reconcile, token cũ, hai pool race trước cached replay, current credential/event snapshot, SSE revoke/expiry/shutdown, default dispatch 503 và reported→finalizing giữ guard. Restart đóng app/pool rồi mở lại cùng DB, so graph/docs/events/command results; `pg_dump -Fc`/`pg_restore` trong container riêng so counts, byte checksums, cursor và command result. `pnpm --dir v2/server typecheck`, `pnpm --dir v2 test`, `pnpm --dir v2 typecheck` là covering gates. Regression search deadline giữ ACCESS EXCLUSIVE trên docs_files trong DB riêng, chứng minh direct reader và HTTP cùng trả lỗi deadline 503; pool max1 dùng lại chính backend PID và statement_timeout được phục hồi sau rollback. Harness hữu hạn 5 giây luôn nhả lock/đóng pool trong finally, kể cả RED của code cũ. Cursor singleton UUID array và unsafe path trả CURSOR_INVALID400. Không có production Phase08 attestation trong bộ kiểm thử này.
