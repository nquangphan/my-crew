# MVP2 — Docs, graph flow, lưu trữ, token usage và vòng đời agent

Trạng thái: yêu cầu đã được owner chốt trong hội thoại ngày 04/10/2026; chưa triển khai.
Tài liệu bổ sung roadmap Crew v2, không tuyên bố các phần bên dưới đã nghiệm thu.
Không tiếp tục dispatch triển khai khi quota tuần còn 5% hoặc thấp hơn theo cập nhật owner trong handover trên main (commit 127a7e2); khép các task đã dispatch, không giao mới.

## 1. Docs thống nhất và cập nhật với code

- Giữ chuẩn Crew cho mọi dự án: nội dung tiếng Việt, cấu trúc docs chung và 7 mục cố định của trang flow.
- Kế thừa validator v2 hiện có; bổ sung kiểm tra cấu trúc, nội dung bắt buộc, manifest, coverage và liên kết còn thiếu, không xây lại phần đã nghiệm thu.
- Worker cập nhật docs trong ticket triển khai. Reviewer đối chiếu với diff code, ghi project, ticket, base/target commit, hash nội dung, flow đã xét, findings và kết luận.
- Bằng chứng phải gắn với nguồn thực tế; sửa Markdown không liên quan hoặc lời tự báo của worker không đủ cấp verified. Code/docs bị thay đổi làm mất hiệu lực bằng chứng của phần bị ảnh hưởng.
- Kiểm bản cuối sau ghép nhánh, kể cả conflict. Sau merge, chỉ hoàn thành feature khi snapshot verified khớp commit thực tế.
- Artifact BMAD/Superpowers giữ định dạng gốc, tách khỏi docs mô tả hệ thống đã triển khai.
- Audit docs cũ trước khi cấp verified; không ghi đè bản nhập nguyên trạng.

## 2. Graph cho người và agent

- Dùng PostgreSQL hiện có; không thêm graph database hoặc Understand-Anything trong phạm vi này.
- Node gồm project, flow, source file, docs page và ticket. Quan hệ lấy từ manifest và liên kết có cấu trúc; không suy đoán dependency từ văn xuôi.
- Bổ sung quan hệ flow có cấu trúc vào manifest, mặc định rỗng cho dữ liệu cũ.
- Web và agent dùng cùng API đọc theo project/snapshot, bộ lọc flow/loại node, metadata commit và trạng thái kiểm chứng; giữ quyền truy cập theo project.
- UI chuyển giữa trang docs và graph; node dẫn tới nguồn/trang/flow, ticket mở dialog.
- Graph flow không được trình bày như call graph hoặc bằng chứng hành vi runtime.

## 3. Lưu trữ và vận hành

- Nội dung docs lưu theo SHA-256; snapshot bất biến tham chiếu phiên bản file, tránh sao chép file không đổi.
- Chỉ dùng lại nội dung khi hash, kích thước và byte khớp; quyền đọc vẫn kiểm tra qua project/snapshot. Giữ provenance, audit và review evidence.
- Attachment, transcript và evidence lớn nằm trong kho file/object storage; DB giữ metadata, checksum và liên kết. Thay đổi lưu trữ là công việc mới, không mô tả đây là hành vi đã có.
- UI thống kê riêng docs, graph/index, ticket/event và artifact; phân biệt dung lượng logic, vật lý và số liệu chưa đo. Không cộng dung lượng physical dùng chung nhiều lần cho các project.
- Không tự xóa lịch sử. Migration mới phải backup, đối chiếu checksum, diễn tập restore; không sửa migration đã áp dụng.
- Xử lý theo sự kiện merge/sync và kiểm tra dự phòng mỗi 5 phút; retry bền vững, chống trùng và không cảnh báo lặp khi trạng thái không đổi.
- Sync lỗi sau merge chỉ retry sync, không build/merge lại. Hiển thị missing/unverified/invalid/stale/current và commit đã kiểm chứng.
- Đồng bộ phiên bản chuẩn/validator trên máy con; không review toàn bộ docs khi không có thay đổi.

## 4. Token usage theo ticket

### Thu thập

- Adapter Claude Code, Codex và OpenAI-compatible API lấy usage runtime/provider cung cấp. Không gọi thêm model chỉ để tính usage; không lưu transcript chỉ để đếm token.
- Mỗi bản ghi giữ project/ticket/attempt, runtime, provider/model, session/request hoặc event identity, thời điểm và phiên bản adapter.
- Giữ breakdown input/output/cache/reasoning theo semantics provider; cached input hoặc reasoning có thể là tập con, không cộng hai lần. Lưu nguồn, phạm vi đo và đơn vị của từng counter.
- Nhãn chất lượng gồm reported, estimated và unavailable; completeness gồm complete/partial. Trường thiếu là null kèm lý do, không chuyển thành 0.
- Với counter tích lũy, lưu checkpoint và chỉ cộng delta đúng session/phạm vi; phát hiện reset. Replay/reconnect không tạo usage mới.
- Claude SDK: xác minh trên phiên bản được ghim; không dùng usage của main loop làm tổng cả cây. Phân biệt modelUsage bao gồm subagent và các counter theo message; không cộng đồng thời tổng bao gồm con với số liệu con.
- Provider không trả usage hoặc runtime crash phải hiển thị partial/unavailable. Không hứa đo chính xác mọi adapter trước khi có acceptance thực tế.

### Quy thuộc và tổng hợp

- Tính cả các attempt thất bại, retry, review và subagent. Mỗi khoản chỉ có một chủ sở hữu trong ledger.
- Ticket hiển thị tổng trực tiếp và tổng gồm ticket con riêng biệt; không cộng hai tổng này thành tổng mới. Parent rollup dựa trên hierarchy hiện hành và nguồn ledger không trùng.
- Usage Trợ Lý phục vụ rõ một ticket gắn ticket đó; usage điều phối nhiều dự án/ticket ghi bucket chung, không tự phân bổ bằng tỷ lệ phỏng đoán.
- Ghi theo response/usage event hoặc kết quả cuối, không ghi DB mỗi token streaming. Host lưu hàng đợi bền vững và gửi theo batch; retry idempotent khi offline/restart.
- Không để lỗi telemetry làm chạy lại model hoặc làm mất kết quả task; ghi nhận thiếu số liệu và reconcile riêng.

### Chi phí và UI

- Hiển thị input/output/cache/reasoning khi có, model/runtime, breakdown theo bước/attempt, tổng trực tiếp/tổng gồm con và mức đầy đủ.
- USD ước tính lưu kèm nguồn giá, ngày/phiên bản giá và tiền tệ; thiếu giá thì null. Không coi SDK estimate hoặc giá niêm yết là hóa đơn thực trả.
- Nếu có dữ liệu billing chính thức, hiển thị riêng và chỉ quy thuộc ticket khi có liên kết chứng minh được.
- Không quy đổi token thành phần trăm quota subscription. Quota tài khoản và usage ticket là hai nguồn đo riêng.
- Dùng lịch sử đã đo để hỗ trợ chọn model; dữ liệu partial/estimated phải được nhận diện, không dùng như số liệu đầy đủ.

## 5. Tái sử dụng agent và context

- Trợ Lý kiểm tra registry trước mỗi dispatch: ưu tiên resume agent phù hợp; spawn mới phải lưu lý do. Chính sách không được bỏ qua yêu cầu tạo agent mới của official skill/workflow đã ghim.
- Resume worker khi bổ sung hoặc sửa cùng task; resume reviewer để kiểm findings và delta của bản sửa; hỏi tiếp explorer khi còn trong cùng phạm vi module.
- Task độc lập cần song song, project/workflow khác, context quá dài hoặc nhiễu, session không thể resume, hay yêu cầu đánh giá độc lập thì tạo agent mới với handover có nguồn.
- Review lần đầu và nghiệm thu toàn nhánh giữ tính độc lập. Không dùng worker làm reviewer cho chính thay đổi của mình; reuse reviewer không làm mất giới hạn 5 vòng sửa của task.
- Registry bền vững lưu project, task, role, phạm vi sở hữu, machine/runtime/model, session ID, workflow/version/checksum, trạng thái, commit cuối đã đọc, checkpoint, findings còn mở và usage. Role vẫn lấy từ official skill, không thêm bộ prompt role riêng.
- Khi resume, xác minh credential, binding máy/project, workflow đã ghim và quyền hiện tại; gửi yêu cầu mới cùng delta kể từ checkpoint. Agent đối chiếu checkout thực tế và xử lý context cũ trước khi sửa code.
- Không chuyển session giữa project/workflow. Đổi runtime/model chỉ resume nếu adapter xác nhận tương thích; nếu không, tạo session mới từ artifact/checkpoint và ghi provenance, không giả chuyển được context native.
- Mỗi session chỉ có một lượt điều khiển active, có fencing/idempotency và ownership riêng; request trùng không mở lượt chạy hoặc worker thứ hai. Không giao thêm việc vào session đang chạy ngoài hợp đồng hàng đợi của adapter.
- Session rảnh có thể đóng process nhưng giữ checkpoint/session ID để resume. Resume không bảo đảm token miễn phí hoặc cache hit; đo usage thực tế.
- Nếu session bị mất, checkpoint không tương thích hoặc resume thất bại, reconcile lượt cũ trước khi tạo lượt mới; không chạy lại tác vụ có side effect chỉ vì mất kết nối.
- UI hiển thị agent mới/resume, lý do lựa chọn, phạm vi đang sở hữu và liên kết các lượt trong cùng task. Không hiển thị credential hoặc transcript nhạy cảm trong registry.
- Đánh giá bằng tổng token/task, số lần spawn/resume, số vòng sửa, thời gian hoàn thành và lỗi nghiệm thu; không kết luận tiết kiệm chỉ từ số agent giảm. Số lần đọc lại chỉ báo khi có telemetry đo được.

## 6. Task và phụ thuộc

1. Chốt contract chuẩn docs, review evidence, graph snapshot và storage dedup; đối chiếu spec v2 hiện tại.
2. Hoàn thiện validator và review docs; có thể tách ownership độc lập sau khi contract ổn định.
3. Storage dedup và migration backup/restore; kế thừa snapshot bất biến.
4. Cổng merge/docs sync và monitor; phụ thuộc review evidence và storage contract.
5. Graph/API và UI docs/dung lượng; API hoàn thiện trước UI.
6. Usage ledger/server và adapter normalization; adapter độc lập có thể song song sau khi chốt ledger contract.
7. UI usage, rollup và acceptance xuyên runtime; phụ thuộc task 6.
8. Agent registry và policy resume/spawn thuộc phase 03/04/06, tích hợp UI phase 07 và recovery phase 08/09; dùng usage ledger để đo hiệu quả. Chốt khả năng resume từng adapter trước thực thi policy.

Mỗi task cần kế hoạch kỹ thuật cụ thể trước thực thi và review riêng theo Superpowers. Đây là phạm vi sản phẩm đã chốt, không thay thế các kế hoạch task/code của phase 02–09. Usage thuộc phase 04/06/07 và tích hợp phase 08; docs/graph/storage thuộc phase 02/07/08, vận hành thuộc phase 09.

## 7. Nghiệm thu

- Docs: sai heading, mục rỗng, shared file/rename/delete, artifact workflow, sửa docs đối phó, sai commit/hash/project và conflict merge.
- Storage: file không đổi dùng chung, file khác không bị gộp, cross-project access, snapshot cũ, migration và restore checksum.
- Graph: cùng snapshot cho web/agent trả cùng quan hệ, không cạnh treo, không rò dữ liệu project khác.
- Sync: restart/replay/sự kiện trùng, lỗi sau merge, retry và cảnh báo không lặp.
- Usage: retry vẫn được tính, duplicate không được tính; cumulative/reset/resume; subagent không đếm trùng; nhiều model; cache/reasoning subset; provider thiếu usage; crash/offline/restart; tổng parent và bucket chung.
- Chi phí: đổi giá, thiếu giá, số đo partial và estimate không bị trình bày thành billing hoặc quota chính xác.
- Agent lifecycle: cùng task dùng lại đúng session; workflow bắt buộc agent mới được tuân thủ; delta/commit thay đổi được recheck; project/workflow khác không reuse; worker/reviewer độc lập; context cũ hoặc session mất có handover; resume trùng không chạy hai lượt; offline/crash không lặp side effect; phiên bản/model không tương thích không giả resume.
- Đo dung lượng PostgreSQL thực với nhiều snapshot và nhiều usage event của dữ liệu cỡ Crew; không dùng ước lượng hội thoại làm kết quả benchmark.
- UI E2E dùng Playwright với API/DB thật: stale/current, trang–graph, ticket dialog, usage/rollup, bàn phím và màn hình nhỏ; lưu evidence.
- Trước mỗi dispatch kiểm resource máy; ownership riêng, tối đa 5 vòng sửa rồi hỏi owner. Không tự deploy; cần owner duyệt hoặc ticket deploy.
