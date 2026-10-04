# Báo cáo tổng hợp Crew v2 — 04/10/2026

Crew v2 đã có nền tảng backend và gateway, nhưng chưa có bản hoàn chỉnh để dùng thực tế. Các phần đã qua review riêng chưa đồng nghĩa toàn hệ thống đã nghiệm thu.

## Trạng thái các phần

| Phần | Kết quả hiện có | Việc còn lại |
|---|---|---|
| 01. Hợp đồng miền | Nền tảng v2 độc lập đã merge main. | Nghiệm thu khi ghép toàn hệ thống. |
| 02. Server và docs | Các task nền tảng API, ticket, binding, journal và docs đã qua review theo phạm vi trong worktree v2. | Tích hợp với Trợ Lý và web, nghiệm thu luồng sản phẩm. |
| 03. Gateway macOS và workflow | Có registry, ghim phiên bản, đồng bộ và nền tảng cách ly. | Kiểm chứng đầy đủ trên native runtime và host vận hành thật. |
| 04. Runtime và model pool | Có phần cấu hình, công tắc và kiểm soát model. | Adapter Claude/Codex chạy task thật, chứng nhận runtime, Keychain và tích hợp provider. |
| 05. Attachment | Có upload, linking, submission và quyền đọc đã review. | Parser còn chờ corpus và giới hạn vận hành thực tế; chưa chứng nhận production. |
| 06. Trợ Lý | Schema/inbox, chỉ định máy và tạo ticket có quyền hạn đã review, commit. Manifest workflow ghim nguồn đã commit. | Quyết định/dependency chờ GREEN và review. Điều phối đầy đủ, chọn model, review/fix và monitor 5 phút chưa hoàn tất. |
| 07. Web | Có shell độc lập, kiểm giao diện bằng browser. | Fixture còn vòng kiểm/review cuối. Board/list, ticket dialog, flow chart, docs và điều khiển máy còn phía trước. |
| 08. Tích hợp và docs gates | Kế hoạch đã có. | Tích hợp, chứng cứ cuối, merge và đồng bộ docs theo commit. |
| 09. App update và vận hành | Chưa nghiệm thu v2. | Signed updater, drain, rollback, health và release. |

## Những việc đang khép

- Trợ Lý quyết định và dependency: đã viết xong năm file theo phạm vi; RED có 55 case, 10 control qua và 45 thất bại đúng hành vi còn thiếu. Chưa chạy GREEN 118 case hay review bản triển khai mới.
- Kiểm tra artifact BMAD: bản sửa có 25/25 unit test, gateway typecheck và Biome đạt; PM đã đối chiếu hash và log cuối, reviewer đã xác nhận cả bốn finding được xử lý, không có lỗi mới chặn trong delta. Chỉ kiểm byte được cung cấp, chưa chứng minh lệnh render chính thức hay cho phép chạy BMAD.
- Fixture web: lỗi xóa scratch sau timeout đã có RED thật và focused GREEN. Full lifecycle 6 case, typecheck và review cuối còn chờ. Source UI giữ nguyên từ lượt browser đã kiểm.

## Code, merge và vận hành

Main hiện ở `325244b`, mới có nền tảng v2. Phần triển khai tiếp nằm tại worktree `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`, nhánh `codex/crew-v2-server`, HEAD `340851c`. Các commit đã xác minh gần nhất:

- `feaea55`: schema, storage và inbox Trợ Lý đã nghiệm thu trong phạm vi.
- `a96c932`: chỉ định Trợ Lý và kiểm quyền owner.
- `29e7265`: manifest workflow gắn nguồn và skill pin bất biến.
- `340851c`: Trợ Lý tạo ticket qua quyền hạn hẹp.

Phần này chưa merge về main, chưa push và chưa deploy. Các thay đổi candidate chưa review đầy đủ vẫn giữ trong worktree; không tính là đã giao sản phẩm.

## Quota, tài nguyên và tiến độ

Quota tuần được đọc trực tiếp sáng 04/10: đã dùng 74%, còn 26%. Theo yêu cầu owner, khi còn 25% hoặc thấp hơn sẽ ngừng giao việc mới, chỉ khép việc đang thực hiện và lưu checkpoint.

Gate web lúc 07:08:18 Asia/Ho_Chi_Minh không đạt: available 3,439 GiB, CPU idle 21,39%, pressure 2. Worker chưa tạo Node hoặc PostgreSQL mới và đã trả slot. Kết quả này chỉ nói về lượt kiểm tra đó; không suy tình trạng máy cả ngày.

Không báo phần trăm hoàn thành hoặc ngày xong vì chưa có số đo tốc độ đủ tin cậy. Các phần native, parser, tích hợp và web nghiệp vụ còn nhiều cổng nghiệm thu thực tế.

## Nguồn đối chiếu

Báo cáo dựa trên Git hiện tại, roadmap `plans/261002-0002-crew-v2/plan.md`, ledger phase06/phase07 và báo cáo B2a, D1, CREWV2-701 trong worktree v2. Roadmap có một số dòng trạng thái cũ; các kết quả mới trong báo cáo này lấy từ ledger, commit và log task tương ứng.

Không có quyết định sản phẩm mới cần owner duyệt ở thời điểm báo cáo. Deploy tiếp tục cần owner duyệt hoặc ticket deploy như đã chốt.
