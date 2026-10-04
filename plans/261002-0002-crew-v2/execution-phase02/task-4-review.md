# Phase 02 Task 4 — review độc lập

Đối chiếu `task-4-brief.md`, spec đã duyệt, báo cáo và toàn bộ `task-4-diff.txt` (`ca9e12e..44f79fd`). Chỉ review tĩnh; không sửa source, không chạy lại suite. Báo cáo worker ghi 81/81 test đạt, typecheck và Biome trên 15 file đạt; đây là kết quả đã báo, không phải kiểm chứng mới của reviewer.

## Kết luận tuân thủ spec

**Cần sửa trước khi tích hợp Task 5/7.** Migration 004 và route/service đã có cây ba cấp, giới hạn project/root cho dependency, khóa root và CTE ngăn hai cạnh đối nghịch cùng commit. Public route không nhận tín hiệu process-confirmed/`passed`; mặc định execution/docs callback từ chối. Decision `owner_answer`/`approval` chỉ owner ghi qua service; repair result luôn qua callback fence trước khi tra cycle lặp. Journal chỉ thêm metadata đúng whitelist. Những điểm này phù hợp phần lớn brief.

Các lỗ hổng còn lại nằm ở tính bất biến của cây sau hoàn tất, trạng thái `ready` sau khi sửa DAG, quyền tạo deploy ticket và giữ lý do sau vòng sửa thứ năm. Chưa thể coi Task 4 đạt gate cuối vì các trạng thái sai này là dữ liệu đầu vào trực tiếp của Task 5.

## Kết luận chất lượng

**Changes requested.** Phạm vi file và flow docs phù hợp; diff không đưa credential/text bình luận vào event. Test 81/81 được báo đạt nhưng chưa bao phủ các trình tự bên dưới. Không coi thiếu integration với bảng 005/006 là lỗi riêng của Task 4: `ExecutionAuthority`, `DocsCompletionReader` và `DocsSourceReader` hiện fail closed; Task 5 phải nối proof attempt/fence/stopped thật trong cùng transaction, Task 7 phải nối verified snapshot reader. Tests callback giả hiện chứng minh hành vi service chứ không chứng minh process đã dừng hoặc docs đã đối chiếu checkout.

## Findings theo mức ưu tiên

1. **[P1] Có thể thêm hậu duệ bắt buộc sau khi cha/gốc đã `done`.** `v2/server/src/tickets/service.ts:130-150` đọc parent rồi khóa root nhưng chỉ kiểm tra cấp, project và pin; không kiểm tra `parent.status` hoặc `root.status`. Tái hiện: hoàn tất request hợp lệ, sau đó gọi `createTicket` thêm step `mandatory:true` dưới request đó; insert thành công, request vẫn `done` dù `readCompletionFacts` sẽ thấy step `pending`. Tương tự với task mới dưới step `done`. Khóa root làm hai transaction có thứ tự, nhưng không chặn insert sau khi completion commit. Sau khi khóa root, đọc lại parent/root và từ chối tạo con cho cây đã hoàn tất/hủy; thêm test tuần tự và concurrent với completion.

2. **[P1] Machine có thể tạo deploy ticket rồi vượt completion gate deploy mà không có owner approval.** `v2/server/src/tickets/routes.ts:176-185` nhận machine cho mọi kind; `v2/server/src/tickets/service.ts:125-150` không lưu nguồn tạo ticket. Trong `v2/server/src/tickets/completion.ts:57-63`, `hasDeployTicket` luôn `true` ở nhánh deploy request, nên `canDeploy` bỏ qua kết quả truy vấn approval. Tái hiện: machine bound POST request `kind:'deploy'` không có owner approval; sau khi có evidence được verifier đánh dấu verified, completion gate deploy chấp nhận. Brief yêu cầu owner duyệt hành động cụ thể hoặc owner tạo ticket deploy; provenance hiện không thể chứng minh vế thứ hai. Giới hạn tạo deploy request cho owner hoặc lưu và kiểm tra owner-created intent; Task 5/6 phải dùng cùng điều kiện tại cổng thực thi, trước khi chạy deploy. Task 4 chưa có route chạy deploy, nên finding này nói về gate/trust contract, không khẳng định đã thực thi deploy.

3. **[P2] Thêm dependency mới có thể để ticket `ready` dù predecessor còn `pending`.** `v2/server/src/tickets/dependencies.ts:24-42` chỉ chặn target `done/cancelled`, còn `ready/running` được thêm cạnh và chỉ tăng revision. Tái hiện: `dependencies_ready` cho A chưa có cạnh → A `ready`; thêm A phụ thuộc B `pending` → A vẫn `ready`. Nếu Task 5 lấy `ready` làm điều kiện claim, điều kiện phụ thuộc bị bỏ qua. Chặn sửa graph khi target đã `ready/running` hoặc hạ về `pending` một cách có kiểm soát và buộc dispatch recheck dependencies trong cùng transaction; test trạng thái sau mutation.

4. **[P2] Lý do vòng sửa thứ năm bị mất khi finalize `needs_input`.** `v2/server/src/tickets/repair.ts:50-55,96-97` lưu `wait_reason='repair_limit'`, nhưng `v2/server/src/tickets/service.ts:232-234` luôn ghi `owner_input` khi `applyExecutionSignal(...,'wait_owner')` chuyển sang `needs_input`. Tái hiện: repair failure thứ năm → confirmed stop → apply internal `wait_owner`; ticket không còn lý do `repair_limit` dù spec yêu cầu hiện nguyên nhân và những gì đã thử. Giữ terminal reason đã persisted từ execution/repair khi finalize; `owner_input` chỉ dùng cho yêu cầu chờ owner thông thường.

5. **[P2] Quyết định cũ có thể mở lại vòng sửa thứ năm nhiều lần.** `v2/server/src/tickets/service.ts:194-197` tìm bất kỳ `owner_answer` cùng ticket có scope `continueAfterFive:true`, không ràng buộc quyết định được ghi sau failure thứ năm hoặc với terminal intent/cycle cần duyệt. Tái hiện: owner ghi quyết định này khi counter còn 0; sau vòng thứ năm, machine gửi `resume` và điều kiện vẫn đạt. Cùng quyết định đó tiếp tục dùng cho lần chờ sau. Gắn approval với cycle/terminal intent cụ thể và kiểm tra thời điểm/ID tại resume; test quyết định cũ và replay.

## Điểm kiểm tra khi nối phần sau

- Task 5 cần chứng minh `verifySignal`/`verifyRepairResult` tra guard, attempt, fence, process instance và xác nhận stop trong transaction; callback hiện chỉ là giao diện. `requestTerminalIntent` của Task 4 phải được adapter ánh xạ sang command/decision thật của Task 5.
- Task 7 chỉ trả docs commit sau khi snapshot `verified`, đúng project và đúng merge commit; callback mặc định `null`/`false` đang an toàn.
- Task 8 mới có authority xác minh merge. `verification:'verified'` trong test được chèn trực tiếp để kiểm tra gate logic, không phải bằng chứng production có thể tự chứng thực.
