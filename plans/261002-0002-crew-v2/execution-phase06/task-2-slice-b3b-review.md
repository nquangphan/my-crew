# Review B3b — gateway tool client (97737a1)

Phạm vi: `v2/gateway/src/assistant/tool-client.ts`, `v2/gateway/test/assistant-tool-client.test.ts`, docs flow. Đọc code, đối chiếu `server/src/assistant/{tools,store,contracts,operation-request}.ts`, `server/src/journal/mutation.ts`, `server/src/app.ts`, `gateway/src/journal/http-operations.ts`. Không chạy lại test.

### Spec Compliance
- ✅ Validate union trước mọi I/O (`assertToolEvent`/`assertTurn`, dòng 323-342); test "invalid events" khẳng định 0 request và 0 file journal.
- ✅ operationId tất định = UUID layout v5 của sha256(canonicalJson([tag, turnId lowercase, providerCallId, sequence])); mảng JSON nên không va chạm ranh giới; khác turn/provider/sequence cho ID khác. Khớp `assertAssistantId` của server (version 1-8, variant 89ab).
- ✅ Journal (`prepare`) trước HTTP (dòng 507 trước 528); cùng ID+body sau restart dùng lại record; khác body → `OPERATION_CONFLICT` → `conflict` cục bộ không gửi.
- ✅ Body đúng 5 field; fence/inputSnapshot copy từ turn hiện hành.
- ✅ Header `x-crew-provider-call-id` gửi đúng một lần từ `phase`, regex giống hệt server (`[\x21-\x2b\x2d-\x7e]{1,4096}`), nằm ngoài body nên không vào request_hash; bearer chỉ trong closure.
- ✅ Retry cùng body+operationId khi mạng/timeout/500/502/503/504, có trần `maxAttempts` (mặc định 6) và backoff 1s→60s.
- ✅ Chỉ nhận kind khớp tool; catalog bắt buộc `truncated:boolean`; envelope đúng 4 field; operationId phải khớp.
- ✅ Không log, không driver/model.
- ⚠️ Xử lý 4xx "theo hợp đồng server": mapping `409 ASSISTANT_TURN_STALE → stale` gần như không bao giờ xảy ra qua route (xem Issue I2); 401/429/408 bị coi là terminal và journal vĩnh viễn (Issue I1).
- ⚠️ `pending` không có đường poll (GET chưa tồn tại); journal giữ nguyên `pending` mãi (Minor M3). Server hiện không bao giờ trả `pending` (consume hoàn tất trong cùng Tx).
- ⚠️ Tiền tố `prose` 32768 / giới hạn mảng của client chưa đối chiếu từng số với `contracts.ts` (server vẫn là bên kiểm sâu); lệch chỉ làm client chặt hơn/lỏng hơn, không phá idempotency.

### Fake vs real contract
Khớp: bearer machine; đúng một header provider-call, cùng regex; body đúng 5 key; idempotency theo operationId trên `{providerCallId, request}`; 409 khi khác body; 409 khi trùng clientSequence/providerCallId của lượt khác ID; trả lại reply đã lưu; reply `rejected/TOOL_NOT_RELEASED` cho tool chưa phát hành.
Lệch:
1. Fake chỉ trả `completed` cho `read_catalog`, mọi tool khác `rejected`. Server thật phát hành 4 tool (read_catalog, read_docs, create_run, ask_owner) và trả `docs`/`run`/`question` completed. Shape `docs`/`run`/`question` của `valueShapes` KHÔNG có test chấp nhận nào (chỉ có test "wrong kind").
2. Schema 400 thật là `INVALID_INPUT` (app.ts:124); fake dùng `VALIDATION`. 413 `BODY_TOO_LARGE`, 503 `SERVICE_UNAVAILABLE` (lỗi không mong đợi), 503 `ASSISTANT_TOOLS_NOT_CONFIGURED`, 403 `ASSISTANT_MACHINE_REQUIRED`, 409 `IDEMPOTENCY_CONFLICT` (khác body, mã khác `ASSISTANT_OPERATION_CONFLICT`) không có trong fake.
3. Fake so khớp URL với `fence.turnId` đúng hoa/thường; route thật so sánh sau `toLowerCase()`.
4. Fake không chạy authorize (fence hiện hành, pin, scope, tool_names, budget) và không lưu theo turn (map toàn cục); route thật chạy authorize TRƯỚC replay và mọi lỗi resolver gộp thành 404 `ASSISTANT_SCOPE_NOT_FOUND`.
5. Fake trả mã `ASSISTANT_TURN_STALE`/`ASSISTANT_INPUT_STALE` ở 409 tuỳ ý; thực tế stale fence qua resolver ra 404 (xem I2).
Kết luận: fake đủ để kiểm chứng giao thức client (header, replay, retry), không chứng minh tương thích route thật. Cần slice tích hợp với `buildApp` (đã nêu trong report).

### Test independence
Sẽ bắt: bỏ validate trước I/O (test invalid + `seen.length===0`); gửi trước khi journal (test "durable before HTTP" khẳng định file journal tồn tại sau lần gửi mất); header lặp/thiếu (so mảng header); đổi operationId giữa các lần retry (so `canon(body)` các lần); không có trần retry (test outage `rejects unavailable`); nhận sai kind/extra field/thiếu `truncated`; lộ bearer trong journal/message; replay 4xx sau restart phải không I/O.
Sẽ KHÔNG bắt / yếu:
- Không có test fence/pin đổi giữa hai lần chạy → `conflict` cục bộ (concern 3 không có test).
- Không mô phỏng crash thật giữa `prepare` và HTTP; test chỉ dùng `drop` rồi mở client mới (đủ cho "reuse", chưa cho "chết trước send").
- Assertion backoff lỏng (`sleeps.length>=3`, đơn điệu); outage chỉ khẳng định `seen<=3`. Không phát hiện lệch gate-vs-sleep hay việc tiêu hao lượt không gửi (I3).
- Không có test: cùng providerCallId khác sequence, khác providerCallId cùng sequence (đều do server 409, chưa kiểm hành vi client sau đó, journal vĩnh viễn); 2xx khác 200; 3xx (redirect:'error' → thành TransportFailure → retry vô ích); tên tool chưa phát hành với value hợp lệ; header CR/LF ở tầng transport (`UNSAFE_TOOL_REQUEST`); concurrent `execute` cùng op.
- Test bảng 4xx dùng mã server do fake tự dựng, nên xác nhận mapping chứ không xác nhận mapping khớp server.
- Không có RED run (TDD vi phạm đã tự khai); các test trên được đánh giá bằng đọc mã như trên, không có bằng chứng chạy đỏ.

### Strengths
- Dùng nguyên `HttpOperationJournal`, không tái cài đặt; phase mang providerCallId nên header sống qua restart; kiểm tra lại header ở transport (defence in depth).
- Replay trả đúng bytes đã lưu; commit-then-drop được phủ.
- Lỗi chỉ mang kind/status/mã server (regex `[A-Za-z0-9_]{1,64}`), không rò body.

### Issues

**Critical:** không có.

**Important**
- I1. `tool-client.ts:409-424,533-536` + journal `replay` (immutable first response): mọi 4xx được ghi bất biến, gồm 401 (bearer hết hạn/xoay), 408, 425, 429 và 413 từ proxy/Fastify. Lỗi hạ tầng/credential tạm thời "đầu độc" operation vĩnh viễn: sau khi sửa bearer, cùng lời gọi (ID+body) không bao giờ được gửi lại, caller phải bỏ lời gọi dù server chưa thấy nó. Fix: chỉ ghi terminal cho mã nghiệp vụ (400 INVALID_INPUT/PROVIDER_CALL_ID_INVALID, 403 scope, 404 scope, 409, 422); với 401/408/425/429 không ghi vào journal (ném lỗi từ transport, hoặc coi như `unavailable` retryable) hoặc retry có điều kiện sau khi đổi bearer. Thêm test: 401 rồi bearer đúng, cùng operation phải gửi lại được.
- I2. `tool-client.ts:417` + test 509-513: `ASSISTANT_TURN_STALE` được ánh xạ `stale`, nhưng route tools gộp mọi ApiError của resolver thành 404 `ASSISTANT_SCOPE_NOT_FOUND` (tools.ts:149); chỉ fence sai định dạng (`assertTurnFence`, store.ts:48) cho 409 TURN_STALE. Hệ quả: fence cũ/turn bị thay ra `not_found`, không phải `stale`; caller phân nhánh theo `kind==='stale'` sẽ bỏ sót. Fix: tài liệu hoá và test `not_found` = "scope/turn không còn hiện hành" (terminal, dừng turn), hoặc gom `not_found` và `stale` cùng xử lý ở caller; bỏ ảo giác khỏi bảng test hoặc đánh dấu rõ.
- I3. `http-operations.ts:141-160` kết hợp `tool-client.ts:473-486`: lần 5xx đầu được ghi nhận, vòng kế tiếp chỉ tạo history và trả lại 5xx cũ mà KHÔNG gửi, nhưng vẫn tiêu một `attempt` và ngủ 2s. Với `maxAttempts` mặc định 6 chỉ gửi 5 lần; với `maxAttempts:1` hoặc 2 các lần gọi `execute` kế tiếp trả `unavailable` mà không gửi gì trong ~1s đầu. Không phá an toàn, nhưng "bounded retry" kém hơn khai báo và test không bắt. Fix: sau khi nhận 5xx lần đầu, đợi tối thiểu trước, hoặc không tính vòng không gửi (phát hiện bằng `seen`/biến cờ do transport set), và thêm test đếm số lần gửi chính xác theo `maxAttempts`.

**Minor**
- M1. `tool-client.ts:131-135,509-513`: `fence.turnId` trong body giữ nguyên hoa/thường còn operationId lowercase; cùng lượt truyền hoa/thường khác nhau → body khác → `conflict` cục bộ giả. Chuẩn hoá lowercase mọi UUID trong body trước khi journal.
- M2. `http-operations.ts:15-27` (`rejectSecrets`) áp cho cả khoá bên trong `ticket`/`ask_owner` (vd khoá `password`, `secret` hợp lệ trong nội dung ticket) → `invalid` oan. Nên ghi chú giới hạn hoặc tránh áp cho payload tự do.
- M3. `pending` 200 được ghi và phát lại vĩnh viễn, không có poll; hiện server không phát sinh. Ghi rõ là hợp đồng chờ GET `/tools/:operationId` (T7).
- M4. `AbortSignal.timeout(30000)` và `redirect:'error'` cố định; 3xx bị biến thành `TransportFailure` và retry vô ích tới trần. Phân loại 3xx là terminal `response_invalid`.
- M5. Journal `assistant-tools` không có GC; mỗi lời gọi tồn tại vĩnh viễn (kể cả body `route_message`/`publish_reply` lớn). Cần chính sách dọn khi turn kết thúc (slice sau).
- M6. Khi hai client cùng mở một `root` sẽ bị khoá AtomicRecords; không có lỗi ánh xạ rõ (rơi vào `journal`/ném thẳng ở `open`). Chấp nhận được, nên có test.

### Assessment
Giao thức cốt lõi (ID tất định, journal trước HTTP, header một lần, retry cùng body, kind khớp) đúng và nhất quán với server. Rủi ro lớn nhất là journal hoá vĩnh viễn các 4xx do hạ tầng/credential (I1), mã `stale` không khớp hành vi route thật (I2), và test chưa chứng minh gate retry/fence-change/giá trị docs-run-question.

**Task quality:** Needs fixes
