# PM-02 — Bản đồ công việc Crew v3

Trạng thái bàn giao: **fixround1 đã sửa P2, chờ re-review độc lập của PM**. Không sửa `progress.md`, không tạo ticket Paperclip, không commit/deploy. Điểm dispatch 7 = 1 + U2/C2/I2; model theo brief `gpt-6.1-sol`, effort `high`.

## File bàn giao

- `ticket-map.html`: HTML độc lập, offline, 41.5 KB; không tải thư viện/font hoặc gọi mạng.
- `ticket-map-update.py`: updater dùng Python chuẩn, 37.4 KB; template HTML và parser cùng một file để PM cập nhật bằng một lệnh.
- `ticket-map-preview.png`: ảnh Chromium 1440×1024.
- `ticket-map-browser-evidence.json`: kết quả kiểm chứng trình duyệt, exact ledger SHA và timestamp.

Áp dụng `tro-ly-pm`; đọc `docs/index.md`, plan, ledger và ảnh mẫu `/Users/phannhatquang/Downloads/IMG_6454.JPG`. Không cần đọc/sửa code Crew hoặc thay docs flow cho artifact trong thư mục plan.

## Kết quả

Cây đi ngang: Crew v3 → R1/R2 → nhóm phase/context → thẻ công việc. Đường cây liền mảnh; dependency nét đứt có mũi tên và tô rõ khi chọn task. Cổng release R1 là group dependency riêng, không giả thành một danh sách task đã hoàn thành. Gốc, release và nhóm đều dùng chấm rỗng trung tính. Meta/dialog ghi rõ thống kê task con, tách khỏi nghiệm thu chính node đó. Không suy ra nhóm đã nghiệm thu từ trạng thái con, kể cả toàn bộ con accepted hoặc danh sách rỗng; ledger hiện chưa có schema/evidence gate riêng để hiển thị nghiệm thu nhóm.

31 mục hiện hành được chiếu từ ledger: 30 mục ban đầu và PM-02 do PM vừa thêm. Không hardcode số lượng. PM-01/PM-02 áp dụng cả hai release, hiển thị một lần dưới R1; lọc R2 vẫn gồm chúng. Nhóm phase là cấu trúc trình bày, không claim đã tạo remote ticket cho nhóm hoặc task.

Mỗi thẻ mở native dialog có ID, tiêu đề, trạng thái, release/context, dependency, độ khó, model/effort, worker/reviewer, evidence/blocker và remote status. Các field chưa có trong ledger hiện rõ “chưa ghi/chưa phân công”. Gồm tìm kiếm, lọc release/state, tổng số, chú giải, cuộn hai chiều, zoom, vừa ngang, reset; Enter/Tab/Escape và trả focus sau khi đóng. UI tiếng Việt; ID/model, enum và nội dung deliverable gốc giữ nguyên khi đối chiếu dữ liệu.

Parser đọc lại bảng task registry mỗi lần, đọc alias model từ ledger và hỗ trợ các cột riêng Evidence/Blocker/Worker/Reviewer/Model/Effort/Remote status nếu PM bổ sung vào bảng có ID task. `00-02,03` giải nghĩa thành `00-02,00-03`; `07A-02,03` thành `07A-02,07A-03`; `R1` trỏ group release; phase đứng độc lập hoặc `phase:00` trỏ group phase. Token không xác định, phụ thuộc tự thân hoặc group chứa chính task được báo và không tạo cạnh giả. Token số sau ID ưu tiên viết tắt cùng phase; không âm thầm đoán thành một phase khác khi task tương ứng thiếu. Snapshot cuối có **0 dependency chưa rõ**.

JSON nhúng escape `<`, `>`, `&`, U+2028/U+2029; mọi dữ liệu lên DOM qua `textContent`. Không dùng `innerHTML` hoặc nội suy ledger vào thuộc tính HTML. Bản Việt hóa tiêu đề chỉ áp dụng khi deliverable gốc còn khớp; ledger đổi title sẽ hiển thị title mới thay vì giữ bản dịch cũ.

## Cập nhật sau mỗi thay đổi ledger

Từ gốc repo:

```sh
python3 plans/261005-2154-crew-v3-paperclip/ticket-map-update.py
```

Sau đó tải lại file HTML trong trình duyệt. HTML là snapshot, **không tự đọc ledger đang đổi**. SHA-256 đầy đủ nằm trong JSON nhúng và hộp đối chiếu; footer hiện 12 ký tự cùng giờ tạo theo Asia/Saigon. Updater chỉ đọc ledger; PM tiếp tục là nguồn trạng thái duy nhất. Có thể dùng `--ledger <path> --output <path>` khi cần chiếu một checkpoint khác.

## Kiểm chứng thực chạy

```sh
python3 plans/261005-2154-crew-v3-paperclip/ticket-map-update.py --self-test
python3 plans/261005-2154-crew-v3-paperclip/ticket-map-update.py
```

PASS self-test: Node VM chạy hàm aggregate thật trong template, kiểm all-child-accepted/no gate, empty và running đều trả neutral aggregate. Updater thông thường chỉ cần Python chuẩn; nhánh `--self-test` dùng thêm Node có sẵn của repo. PASS parser: projection từ bảng, thay đổi state/title từ ledger, model alias, dependency task/group/shorthand, token mơ hồ không thành cạnh giả, ID trùng bị từ chối, HTML trong dữ liệu không thoát JSON script. Trước implementation đã thấy test fail ở projection; test title bị giữ cũ và dependency viết tắt mơ hồ cũng fail trước bản sửa.

Chromium headless thật qua `@playwright/test` 1.63.0 đã có trong repo, chạy script Node qua stdin, mở HTML bằng `file://` trực tiếp. Snapshot được kiểm tại **05/10/2026 23:13:26 Asia/Saigon**, generated **23:11:52**, ledger SHA:

`236b6b1e39a007ef7b15368588985cf63878186c0a9eb679ef3d81161050823f`

PASS: 31 card và hash ledger khớp; click/Enter mở đúng dialog; dependency `00-04` gồm `00-02/00-03`; model đúng; Escape và focus return; Tab ở trong native dialog; tìm ID/trạng thái trống/filter state và R2; zoom/reset/toggle dependency; cạnh release R1 → 05B-01; viewport 390×844 không tràn body, vừa ngang và dialog vừa màn hình; payload HTML trong title/evidence chỉ là text, không tạo DOM/chạy mã. **0 console/page errors, 0 external network requests**. Evidence JSON ghi scope và exact SHA.

Một lượt đầu bắt đúng SHA ledger đã đổi trong lúc PM cập nhật; regenerate rồi kiểm lại đạt. Harness injection lần đầu dùng lại global JS context của `setContent` nên lỗi redeclare, đã sửa bằng điều hướng trang mới trước setContent; không phải lỗi artifact. Browser MCP chặn `file://`, nên dùng Chromium local đã có, không mở server/cổng hoặc cài dependency. Đã đóng browser local trong `finally` và đóng đúng tab blank MCP do worker tạo. Không để background process.

## Fixround1 — P2 không false-accepted nhóm/release

Review độc lập `ticket-map-review.md` tái hiện `tallyState([{state:'accepted'}, ...])` và `tallyState([])` cùng trả `accepted`, khiến dot root/release/group mang màu nghiệm thu dù không có gate. Worker xác minh qua Node VM hàm lấy từ HTML và thấy regression fail **trước sửa**, cả hai actual=`accepted`.

Sửa duy nhất semantics aggregate trong updater/template: mọi aggregate trả `aggregate` trung tính; CSS dùng chấm rỗng; legend ghi rõ “Nhóm · thống kê task con” và “Task đã nghiệm thu”; meta/tooltip/dialog ghi rõ đây là thống kê task con. `stateCounts([])` ghi “Không có công việc con.” Không nhập trạng thái fixture vào ledger, không giả có gate riêng để đổi màu.

Self-test thường trực chạy đúng hàm template qua Node VM cho ba case accepted-all/empty/running. Một lỗi regex ở lượt patch tự động đầu được self-test bắt, sửa đúng matcher và hàm JS trước các lượt GREEN cuối. Regression Chromium thật dùng dữ liệu clone in-memory: 31 task accepted vẫn chỉ có leaf màu xanh, toàn bộ root/release/phase là `.dot.aggregate`; dialog root ghi “Thống kê task con” và chưa có evidence gate; fixture empty không tạo dot accepted và có empty state rõ ràng. Fixture là bằng chứng hành vi UI, **không phải bằng chứng release thật đã nghiệm thu**.

Lượt browser fixround1 đồng thời chạy lại click/Enter/Tab/Escape/focus-return, search/no-results/state/R2, zoom/reset/dependency, viewport390/fit/dialog và injection. 0 errors, 0 external requests. Snapshot thực kiểm có PM-02=`fixing`, không tự chuyển ledger hoặc claim accepted. Browser đã đóng trong finally; không có port/server/background do worker để lại. Evidence JSON và preview đã thay bằng candidate fixround1.

## Giới hạn và vấn đề còn mở

- Đây là acceptance của **artifact theo dõi offline**, không phải UI tích hợp Crew/Paperclip và không chứng nhận API/DB E2E.
- Browser evidence gắn snapshot đã ghi; PM regenerate sau transition tiếp theo thì SHA/time thay đổi. Tải lại HTML để xem bản mới.
- Dependency có một đầu bị ẩn bởi bộ lọc không vẽ trên sơ đồ; hộp chi tiết vẫn liệt kê đầy đủ dependency đã giải nghĩa.
- Ledger hiện chưa có U/C/I, UUID worker/reviewer và evidence/blocker riêng cho mọi task; artifact không tự suy ra từ event log. Dữ liệu đó cần PM bổ sung nếu muốn hiện đủ chi tiết.
- Remote IDs đều `not-created` theo registry hiện tại. Không claim đã lưu ticket/status vào Paperclip.
- Không chạy suite toàn repo theo phạm vi “artifact only, không heavy suites”; không thay source/flow, protected files hoặc process của agent khác.

Câu hỏi chưa giải quyết: không có câu hỏi chặn artifact. P2 đã sửa và có regression thực; re-review độc lập cùng trạng thái PM-02 do PM quyết định.
