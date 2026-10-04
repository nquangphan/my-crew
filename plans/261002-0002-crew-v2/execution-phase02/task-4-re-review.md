# Phase 02 Task 4 — re-review fix round 1

Phạm vi: đối chiếu năm finding của `task-4-review.md` với toàn bộ `task-4-fix-diff.txt` (`44f79fd..1fdac34`), phần bổ sung của `task-4-report.md` và source hiện tại. Chỉ review tĩnh; không sửa source, không chạy lại suite. Worker báo 91/91 test, typecheck, Biome 12 file và diff/docs checks đạt; reviewer chưa xác minh độc lập các lệnh này.

## Verdict tuân thủ spec

**Chưa đạt gate để Task 5 dùng quyền deploy.** Bốn finding cũ được xử lý. Finding deploy được xử lý cho request gốc do machine tạo và approval gắn đúng fingerprint, nhưng nhánh kế thừa từ owner-created deploy root còn cho phép machine tự định nghĩa hành động deploy khác mà không cần owner duyệt hành động đó. `readDeployAuthorization` là contract Task 5 sẽ dùng tại claim, nên cần đóng lỗ này trước khi nối cổng thực thi.

## Verdict chất lượng

**Changes requested — một P1 còn mở.** Fix giữ thứ tự khóa root trước child và có test cạnh tranh; DAG vẫn dùng root lock/CTE; repair giữ lý do và quyết định theo cycle, timestamp, tiêu thụ một lần. Migration 004 chưa phát hành được mở rộng có FK/unique cho metadata mới; flow docs được cập nhật. Test mới đi đúng các luồng báo lỗi cũ, nhưng test deploy hiện xác nhận machine deploy child bất kỳ dưới owner deploy root được phép, chính là đường cần ràng buộc thêm.

## Trạng thái năm finding cũ

| Finding | Trạng thái | Bằng chứng dòng và giới hạn |
|---|---|---|
| 1. Thêm con sau `done` | **Đã xử lý** | `service.ts:140-153` khóa root rồi khóa/đọc lại parent, chặn `done/cancelled`; `service.ts:215-218` signal completion khóa root trước ticket. Test tuần tự và concurrent ở `dependencies.test.ts`. |
| 2. Deploy thiếu owner intent | **Xử lý một phần; P1 còn mở** | `service.ts:133-136` cấm machine tạo deploy root; `deploy.ts:21-33,42-59` kiểm tra approval đúng root/hash và decision owner. Nhưng `deploy.ts:40-41` cho mọi deploy descendant dưới owner deploy root qua không so định nghĩa hành động; xem finding mới bên dưới. |
| 3. Sửa dependency sau `ready` | **Đã xử lý** | `dependencies.ts:23-30` chỉ nhận target `pending/needs_input/paused`, chặn `ready/running` sau root và target lock. Test tương ứng ở `dependencies.test.ts`. Task 5 vẫn phải recheck predecessor `done` khi claim. |
| 4. Mất `repair_limit` lúc finalize | **Đã xử lý** | `repair.ts:51-57,98-104` lưu reason; `service.ts:264-266,292-295` giữ `repair_limit` trong public terminal intent và internal transition. Test finalize ở `repair.test.ts`. |
| 5. Dùng lại owner answer cũ | **Đã xử lý** | `repair.ts:98-104` lưu cycle và thời điểm mới; `service.ts:239-255` chọn owner answer cùng cycle và sau failure, `service.ts:294-299` xóa pending cycle và lưu decision đã dùng dưới root/step lock. Test quyết định sớm, hai resume concurrent và cycle thứ sáu ở `repair.test.ts`. Counter vẫn 5. |

## Finding mới do fix round tạo

**[P1] Deploy root của owner đang cấp quyền cho mọi deploy descendant do machine tự tạo.** `v2/server/src/tickets/service.ts:154-155,168-183` cho machine tạo deploy step/task nếu root là deploy request do owner tạo; không so `title`, `criteria`, `inputs`, `outputs` hoặc hash của child với phạm vi owner đã chọn. `v2/server/src/tickets/deploy.ts:35-41` trả `owner_deploy_request` cho mọi child `kind='deploy'` dưới root đó, trước khi xét approval cụ thể. Tái hiện: owner tạo request “Triển khai staging”; machine tạo step deploy “Triển khai production” dưới request đó, không gửi `deployApprovalDecisionId`; `readDeployAuthorization(child.id)` vẫn trả `owner_deploy_request`. Nếu Task 5 dùng reader này ở claim như báo cáo yêu cầu, hành động production sẽ qua cổng deploy dù owner chỉ tạo ticket staging. Cần ràng buộc deploy child với hành động cụ thể của root bằng dữ liệu bất biến có thể kiểm tra, hoặc yêu cầu exact owner approval cho từng deploy child do machine tạo. Thêm test child đổi target/action dưới owner root bị từ chối, giữ case cùng hành động được phép. `deploy.test.ts` hiện chỉ test một child mặc định, nên chưa chứng minh ranh giới này.

## Hợp đồng phần sau

Task 5 phải gọi `readDeployAuthorization` và recheck dependencies trong cùng transaction claim, đồng thời nối authority thật cho attempt/fence/stop; Task 7 mới nối verified snapshot reader. Các hook hiện vẫn fail closed khi chưa tích hợp. Không coi kết quả callback giả trong test là bằng chứng process hoặc docs thật.

## Re-review fix round 2 — `1fdac34..e4fa9a1`

**Verdict tuân thủ spec: đạt cho contract Task 4; residual P1 đã đóng.** `service.ts:133-135` tiếp tục chặn machine tạo deploy request. `service.ts:165-179` buộc mọi deploy child do machine tạo có decision ID mà `verifyDeployApprovalForCandidate` kiểm tra đúng root và fingerprint; quyền từ root không còn được kế thừa. `deploy.ts:35-40` chỉ trả `owner_deploy_request` khi ticket được hỏi là chính root request do owner tạo. Mọi child phải đi qua nhánh approval ở `deploy.ts:41-58`; owner-created child chưa được duyệt trả null. Test `deploy.test.ts:48-113` bao phủ root tự có quyền, child không approval bị từ chối, thay title/body bị từ chối, child đúng approval được cấp quyền và owner-created child chưa approval trả null.

**Verdict chất lượng: chấp nhận fix round 2 trong phạm vi deploy.** Diff chỉ sửa `deploy.ts`, `service.ts`, test deploy và flow docs; không thấy đường mới cho machine vượt approval hoặc regression trong nhánh owner approval cụ thể. Worker báo focused RED 3/4 rồi GREEN 4/4, typecheck/Biome ba file và diff/docs checks đạt. Reviewer chỉ đọc diff và source; không chạy lại test. Mốc 91/91 thuộc fix round 1, chưa được chạy lại sau round 2. Task 5 có thể bắt đầu tích hợp contract này, nhưng phải **từ chối claim deploy khi `readDeployAuthorization` trả null** trong cùng transaction, đồng thời recheck dependencies và proof attempt/fence; kết quả Task 4 không chứng minh các cổng đó đã được Task 5 triển khai.
