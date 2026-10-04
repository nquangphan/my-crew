# Re-review B3a FIX1 (lens bảo mật) — 04/10/2026

**Phạm vi.** Commit `c348950`. Em chỉ xét các thay đổi server, test và docs của B3a: `tools.ts`, `contracts.ts`, `assistant-tools-route.test.ts`, `support/assistant.ts`, `server-assistant.md`. Các thay đổi web trong khoảng `922abed..c348950` thuộc commit khác nên không nằm trong phạm vi.

**Đầu vào.** Review gốc `task-2-slice-b3a-review.md`, fix report (mục "Fix round 1") và hai ruling lúc 01:40 trong `progress.md`. Hai ruling đó là: field `truncated` bắt buộc, và header provider không được chứa dấu phẩy.

Em không chạy lại test.

## Verdict theo finding

| Finding | Verdict | Căn cứ |
|---|---|---|
| I1 — scope message chưa route | **ADDRESSED** | Fixture có thêm `target: 'root'\|'message'\|'routed'` và đi qua đúng nhánh `project_id = null`. Hai test mới cover các ý sau. (1) Scope chưa route: catalog khớp oracle SQL của mọi dự án; `read_docs` đọc được dự án khác (200) và có receipt; `create_run` trả cùng một 404 cho root có thật và root lạ, không có effect. (2) Scope đã route: catalog chỉ trả đúng một dự án; `read_docs` sang dự án khác trả cùng 404 với dự án lạ, không có effect. Code không đổi, nên hành vi đúng spec (§2 và §3, R2) giờ đã có test chứng minh. |
| M1 — `maxTurnMs` chặn replay | **ADDRESSED** | `tools.ts`: điều kiện `recorded` (đã có row của `(turn, operationId)`) chỉ miễn kiểm `elapsed`. Ngân sách số lời gọi vẫn loại chính operation như trước. Test xác nhận: lời gọi mới sau hạn trả 409, replay giống từng byte, không có effect. Có thêm test cho chính nhánh `maxTurnMs`. |
| M3 — các test còn thiếu | **ADDRESSED** (⚠️ R1) | (a) Header lặp hai lần trả 400. Có hai lớp chặn: hai dòng header thật bị bắt nhờ đếm trên `rawHeaders`; khi các dòng đã bị gộp thành `a,b` thì bị chặn vì regex không nhận dấu phẩy (`\x2c`), đúng ruling 01:40. (b) OperationId đã có ở turn khác trả 409 `ASSISTANT_OPERATION_CONFLICT`, không có effect. (c) Đủ 6/6 tool chưa release (`route_message`, `assess_ticket` và `publish_reply` ở `test:729,741,758`). |
| M5 — dùng `readProjectDocsState` | **ADDRESSED** | Kết quả tương đương bản cũ. Với snapshot đã verified và mới nhất, `projectState === 'current'` khi và chỉ khi `source_commit` có giá trị và bằng `expected_commit`. Đây đúng là điều kiện cũ. Có thêm test cho trường hợp bản verified cũ hơn trả `stale`. |
| W1 — cắt danh sách ở 1000 | **ADDRESSED** | Query lấy 1001 dòng, trả 1000 và đặt `truncated = rows > 1000`. Type và schema strict đều có `truncated: bool` (`contracts.ts`, `bool` ở dòng 635), đúng ruling. Có test với 1000 dự án cộng dự án fixture, kết quả `truncated: true`. Các test catalog khác kiểm `false`. |
| W2 — snapshot mới nhất theo verified | **ADDRESSED** (⚠️ R2) | Catalog lấy `p.latest_verified_snapshot_id`, có join thêm `s.project_id = p.id` nên không trỏ được sang snapshot của dự án khác. Dự án chưa có bản verified trả null/null, test oracle đã cover. |

## Trả lời các câu hỏi lens

1. **Miễn `maxTurnMs` khi replay có bị lợi dụng để chạy effect mới sau hạn không?** Không. Chỉ những `operationId` đã có row trong chính turn mới được miễn. Với một ID như vậy, request đi một trong hai đường:
   - Row được ghi qua route này. Khi đó entry `idempotency` của (máy A, route, key) cũng đã commit cùng Tx. Body giống thì replay chỉ đọc; body khác (payload hay provider khác) thì trả 409 `IDEMPOTENCY_CONFLICT`.
   - Row do writer khác ghi, không có idempotency. Khi đó `consume` gặp trùng PK `operation_id` và trả 409.

   Cả hai đường đều không chạy port. Row `pending` không bao giờ được commit, vì `complete` cập nhật trạng thái trong cùng Tx. Resolver vẫn buộc actor phải là máy designation hiện hành, nên máy khác không dùng lại được row này.

2. **Test operationId của turn khác dựng row giả trong phiên replica có chứng minh đúng nhánh không?** Nó chứng minh được nhánh chặn ở `consume` (trùng PK toàn cục): operation đã tồn tại nhưng không có idempotency của actor hiện tại thì bị 409 và không có effect. Đây là đường mà máy khác đi khi designation đổi. Row trỏ tới một turn không tồn tại, vì FK bị tắt trong phiên replica. Điều đó không làm sai nhánh này, vì `consume` so `operation_id` toàn cục. `recorded` của turn hiện tại vẫn là false, nên request không được miễn ngân sách.

   Test **không** đi qua đường thực tế khi cùng máy A dùng lại ID ở turn khác. Đường đó dừng ở `IDEMPOTENCY_CONFLICT` trước, vì khóa idempotency không gồm turn còn body chứa fence nên khác. Nhánh này là cơ chế idempotency chung, đã có test với cùng mã lỗi. → ⚠️ R1, không chặn.

3. **`readProjectDocsState` có làm đổi ACL không?** Không. Hàm này chỉ đọc trạng thái (`audit_state`, `source_commit`, `expected_commit`) của `projectId`. Nó được gọi sau khi đã kiểm scope (`tools.ts`: `scope.projectId !== null && projectId !== scope.projectId` → 404) và sau khi tìm thấy snapshot và file của chính dự án đó. Hàm không trả dữ liệu ra ngoài, chỉ quyết định `state`. Nhánh 404 và thứ tự lỗi giữ nguyên. Hàm không gọi `requireDocsScope`, và vốn cũng không cần, vì authority ở đây là scope của Trợ lý.

4. **Có breakage mới không?** Không thấy. `truncated` là field thêm vào kind `catalog`. Grep `'catalog'` chỉ thấy `contracts.ts`, `tools.ts`, test và fixture; web, gateway và desktop chưa có consumer nào. Mẫu contract trong `support/assistant.ts` đã cập nhật. Regex header chỉ thu hẹp, đã có ruling. Ngân sách chỉ nới cho replay của operation đã ghi.

## ⚠️ còn lại (không chặn)

- **R1.** Đường cùng máy A dùng lại operationId ở turn khác (dừng ở `IDEMPOTENCY_CONFLICT` vì khóa idempotency không chứa turn) chưa có test riêng. Muốn có thì fixture cần dựng được turn thứ hai; có thể để T7 làm.
- **R2.** Catalog trỏ tới bản verified mới nhất. Nhưng `read_docs` vẫn tính `latest_id` theo `received_at` của mọi snapshot, và `readProjectDocsState` cũng mô tả bản mới nhất theo `received_at`. Vì vậy khi có một bản import mới hơn chưa verified, đọc đúng `latestSnapshotId` mà catalog vừa trả sẽ ra `state: 'stale'`. Kết quả này nhất quán với dịch vụ docs, nhưng có thể làm model hiểu nhầm. PM có thể ruling sau (nhãn `stale` hay `current` cho bản verified mới nhất); không phải lỗi bảo mật.
- **R3.** Type `RoutingToolValue` ở phase-06 mục R2 chưa có `truncated` trong văn bản plan (grep không thấy). Ruling 01:40 đã nói là "coi như cập nhật"; cần sửa văn bản khi chỉnh plan lần tới.
- **R4.** Scope message chưa route gọi `ask_owner` chưa có test riêng. `gates.ts` trả 404 do `scope.root_ticket_id !== root.id`, nhưng chỉ sau khi đã đọc và khóa root của ticket có tên trong request. Đây là hành vi của code S5 đã nghiệm thu, sau bước resolve scope, nên không vi phạm ràng buộc 2.

## Kết luận

Cả 6/6 finding (I1, M1, M3, M5, W1, W2) đều ADDRESSED. Không có breakage bảo mật và không có lỗ hổng authority mới.

**Task quality:** Approved.
