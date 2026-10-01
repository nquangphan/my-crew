# Crew v2 — Thiết kế sản phẩm và kiến trúc

Ngày: 2026-10-01, Asia/Ho_Chi_Minh.
Trạng thái: owner đã duyệt bản spec và các bổ sung ngày 2026-10-02; đang lập kế hoạch theo từng phần.

## 1. Mục tiêu và phạm vi

Crew v2 là hệ thống giao việc cho một Trợ lý, điều phối workflow BMAD hoặc Superpowers trên máy local,
và hiển thị tiến độ, kết quả, câu hỏi cùng quyết định trên web. Owner có thể giao yêu cầu bằng ngôn ngữ
tự nhiên; Trợ lý xác định dự án, đọc docs, đánh giá công việc và chọn model phù hợp cho từng ticket.

Làm mới toàn bộ web, server điều phối và app local. Không kế thừa kiến trúc ticket, scheduler hoặc các
prompt role custom của v1. Giữ chuẩn tài liệu dự án v1 dưới dạng hợp đồng dữ liệu; cơ chế thực thi và
bảo đảm cập nhật được xây cho v2. Việc tái sử dụng app hay runtime update code v1 không phải yêu cầu.

Ban đầu chỉ một owner. Web chạy trên VPS; app local chỉ hỗ trợ macOS. Mỗi dự án gắn đúng một máy
thực thi. Trợ lý trung tâm chạy trên một máy local được owner chọn, có thể cùng máy với một dự án.

Chỉ chuyển nội dung docs và thông tin nhận diện cần thiết của các dự án đã tạo. Không chuyển ticket,
lịch sử chạy, cấu hình agent, đăng ký máy hoặc credential v1. Máy đăng ký lại và owner gắn lại checkout.

## 2. Ranh giới thành phần

| Thành phần | Trách nhiệm | Phụ thuộc |
|---|---|---|
| Web | Nhận yêu cầu; quản lý docs, ticket, máy, model, workflow; trả lời và duyệt | API server |
| Server trên VPS | Lưu trạng thái bền vững; phát sự kiện; phân phối lệnh; kiểm soát quyền và version | Database, kết nối máy |
| App macOS | Cổng vào máy: nhận lệnh, chạy agent, cài workflow, báo inventory và trạng thái | Server, checkout, runtime local |
| Trợ lý | Phân tích, điều phối, chọn model, giải đáp, quyết định và giám sát | Docs toàn hệ thống, trạng thái server, model trên máy được chọn |
| Adapter workflow | Ánh xạ định nghĩa workflow thành các bước và bằng chứng cần có | Bộ BMAD hoặc Superpowers đã ghim |
| Adapter runtime | Thực thi agent bằng Claude Code, Codex hoặc API | Runtime đã cài, endpoint, model và credential |
| Cơ chế docs | Kiểm tra cấu trúc, nội dung, phiên bản và đồng bộ | Checkout và commit dự án |

Server quản lý trạng thái và lệnh; suy luận của Trợ lý chạy local. App local có màn hình tối thiểu cho
kết nối, quyền, sức khỏe và lỗi; cấu hình và điều phối thường ngày thực hiện trên web.

App cần duy trì kết nối và job khi người dùng đóng cửa sổ. Không dùng tác vụ suy luận của Trợ lý làm
heartbeat máy: trạng thái kết nối phải được báo độc lập bởi app.

## 3. Trợ lý và quyền quyết định

Owner chọn máy và model Trợ lý từ web. Trợ lý biết danh mục toàn bộ dự án, đọc được docs và biết
snapshot đó thuộc commit nào. Trợ lý truy xuất các docs liên quan trước khi phân tích, không cần nạp
mọi tài liệu vào một context duy nhất.

Trợ lý có thể tự trả lời câu hỏi và quyết định trong phạm vi yêu cầu khi đủ căn cứ từ docs, yêu cầu và
các quyết định owner đã xác nhận. Lưu nội dung, nguồn căn cứ và lý do tự quyết vào ticket. Thiếu căn cứ,
vượt phạm vi được giao hoặc gặp cổng bắt buộc người dùng duyệt của workflow thì chuyển Chờ bạn.

Không coi việc owner giao một feature là đã duyệt mọi thiết kế hoặc deploy. Các cổng xác nhận của
workflow được giữ nguyên; quyết định được ủy quyền cho Trợ lý phải được ghi nhận rõ.

Nếu máy Trợ lý offline, hệ thống chờ, không tự chuyển Trợ lý sang máy khác. Khi máy online lại, tự
khôi phục với cấu hình model đã chọn và trạng thái lưu trên server. Owner có thể chọn lại máy trên web.
Nếu model Trợ lý lỗi nhưng máy còn online, có thể chuyển sang model phù hợp khác trên cùng máy và
ghi lại việc chuyển, theo chính sách fallback chung.

## 4. Pool model và lựa chọn thực thi

Hỗ trợ ba nguồn: Claude Code, Codex và OpenAI-compatible API. Với API, owner cung cấp endpoint,
credential và danh sách model; adapter thực hiện công cụ, vòng agent và lưu tiến độ, không giả định
một lệnh gọi completion đơn lẻ đủ để thực thi workflow.

Một mục trong pool xác định nguồn/runtime, model, máy, khả năng cần thiết và trạng thái khả dụng.
Cùng tên model ở hai nguồn không được coi là cùng một mục. Trợ lý chọn cặp runtime/model trên máy
sở hữu dự án; không điều chuyển code sang máy khác để tận dụng model.

Web có ba công tắc riêng trên từng máy: Claude Code, Codex và OpenAI-compatible API. Công tắc
điều khiển nguồn thực thi được phép dùng trên máy đó, không gỡ cài đặt runtime hoặc xóa cấu hình.
Tắt một nguồn loại toàn bộ model của nguồn đó khỏi lựa chọn mới và fallback, kể cả lựa chọn model
Trợ lý trên máy. Nếu tắt hết nguồn, máy không nhận thực thi mới và UI hiển thị rõ lý do.

Tắt nguồn không hủy attempt đang chạy; attempt được phép kết thúc, nhưng không nhận bước/attempt
mới từ nguồn đã tắt. Muốn dừng ngay, owner dùng thao tác pause/cancel riêng. Model Trợ lý đã chọn
thuộc nguồn bị tắt được đổi sang nguồn còn bật nếu khả dụng, sau lượt hiện tại; nếu không có nguồn
phù hợp thì chờ và báo owner. Bật lại chỉ đưa các model thực sự khả dụng vào pool, không coi thao
tác bật là bằng chứng runtime đã cài hoặc credential hợp lệ.

Server lưu cấu hình mong muốn, máy xác nhận cấu hình áp dụng và thời điểm. Khi máy offline, web
hiển thị chờ áp dụng; server ngừng dispatch mới từ nguồn đã tắt ngay khi ghi nhận quyết định. Máy
online lại phải đồng bộ công tắc trước khi nhận việc mới. UI phân biệt nguồn bị owner tắt với nguồn
được bật nhưng lỗi/hết quota/chưa cài.

Pool khai báo khả năng đọc ảnh và loại tài liệu của model/runtime. Khi đầu vào chứa ảnh hoặc file,
Trợ lý chọn cách đọc tương thích: model đọc trực tiếp hoặc công cụ trích xuất phù hợp. Không chọn
model chỉ đọc text rồi âm thầm bỏ ảnh; fallback phải giữ khả năng xử lý đầu vào cần thiết.

Đánh giá ticket theo độ phức tạp, phạm vi ảnh hưởng, rủi ro và mức thiếu thông tin. Ticket ít dòng nhưng
đụng auth hoặc migration có thể cần model mạnh. Lưu đánh giá, model chọn và lý do; được đánh giá lại
khi có bằng chứng mới. Không đặt bảng ánh xạ model cứng dựa vào tên hãng.

Lỗi hoặc hết quota: chọn model thay thế có khả năng đáp ứng bước hiện tại. Đối chiếu tiến trình và
artifact trước khi chạy lại. Chuyển runtime không đồng nghĩa có thể tái dùng session ID của runtime cũ;
khôi phục từ checkpoint, artifact và trạng thái ticket khi session không tương thích.

Nếu toàn bộ model trên máy không khả dụng, ticket chờ, hiện lý do trên web và tự thử lại với backoff
khi có model khả dụng. Không tạo vòng retry liên tục gây tiêu hao. Credential không xuất hiện trong
pool, transcript, docs hay thông báo trên web.

## 5. Workflow và version

Hỗ trợ BMAD và Superpowers. Superpowers là mặc định khi owner không chỉ định; owner có thể chọn
BMAD cho một yêu cầu. Các role phát sinh dùng hướng dẫn và skill của workflow, không dùng bộ prompt
PM/dev/QC riêng do Crew tự viết.

Server lưu phiên bản chuẩn của cả hai bộ, revision và checksum gói. Tất cả máy đăng ký phải cài đủ
cả hai. Web có nút cài/cập nhật cho máy; app tải, kiểm tra, cài và báo kết quả. Máy offline nhận lệnh
khi online; trạng thái yêu cầu cài đặt và trạng thái đã cài phải phân biệt rõ.

UI phân biệt chưa cài, đang cài, đúng phiên bản, lệch phiên bản và lỗi. Máy lệch phiên bản không nhận
run mới trước khi đồng bộ. Việc cài một bộ thành công không được báo cả hai bộ đã sẵn sàng.

Mỗi run ghim workflow, version và revision ngay từ đầu. Run đang chạy giữ bản đã ghim; update được
cài cạnh bản cũ và chỉ áp dụng cho run mới. Chỉ dọn bản cũ khi không còn run tham chiếu tới nó.

### Cách ly skill

- Hai bộ cài trong hai thư mục riêng.
- Phiên phân tích/định tuyến của Trợ lý tách khỏi phiên thực thi workflow.
- Phiên thực thi chỉ thấy bộ đã chọn và các công cụ chung cần thiết; không nạp cả hai rồi chỉ nhắc bằng prompt.
- Kiểm soát cả skill/plugin từ project, cấu hình user, runtime và các agent con.
- Agent con kế thừa workflow/version của run; kiểm tra nguồn skill tại điểm nạp và gọi.
- Phát hiện gọi chéo thì chặn bước, ghi lỗi và báo Trợ lý; không âm thầm chạy tiếp.
- Đổi workflow tạo run mới, có thể tham chiếu artifact cũ làm đầu vào nhưng không đổi nhãn run đang chạy.

Adapter lấy bước từ định nghĩa của phiên bản đã cài. Chuỗi BMAD spec → story → build → review → QC
trong trao đổi là ví dụ, không phải quy trình BMAD cố định. Kế hoạch adapter phải đối chiếu bộ BMAD
thực tế và ghi rõ các workflow được hỗ trợ trước khi nghiệm thu.

## 6. Ticket và trạng thái

Ba cấp: ticket yêu cầu → ticket bước → ticket công việc khi bước lớn. Phụ thuộc giữa các ticket quyết
định điều kiện chạy; không ép mọi workflow thành chuỗi tuyến tính. Trợ lý lưu tiêu chí hoàn thành và
đầu vào/đầu ra cần có cho từng bước, gắn với skill và phiên bản nguồn.

Ví dụ feature lớn theo Superpowers:

| Ticket bước | Skill | Đầu ra |
|---|---|---|
| Làm rõ và thiết kế | brainstorming | Thiết kế được duyệt theo cổng workflow |
| Lập kế hoạch | writing-plans | Task và cách kiểm chứng |
| Triển khai | executing-plans hoặc subagent-driven-development | Code, test, artifact |
| Review | requesting-code-review, receiving-code-review | Kết quả review và xử lý nhận xét |
| Xác minh và tích hợp | verification-before-completion, finishing-a-development-branch | Bằng chứng đạt, merge và đồng bộ docs |

TDD nằm trong triển khai. Review có thể lặp ở task con theo workflow. Thay đổi nhỏ dùng đường bounded
của Superpowers; bug dùng systematic-debugging; spike kết thúc bằng kết luận. Không tự cắt các cổng
workflow chỉ để giảm số ticket. Ticket bàn giao phản ánh lựa chọn tự merge đã được owner ủy quyền.

| Trạng thái | Ý nghĩa |
|---|---|
| Chờ thực hiện | Chưa đủ điều kiện chạy |
| Sẵn sàng | Phụ thuộc và điều kiện thực thi đã đạt |
| Đang chạy | Có lần thực thi đang hoạt động |
| Chờ bạn | Cần thông tin hoặc quyết định owner |
| Tạm dừng | Owner chủ động dừng |
| Hoàn thành | Đạt tiêu chí và có bằng chứng |
| Đã hủy | Không tiếp tục |

Chờ máy, chờ model, cài workflow hoặc chờ sync là lý do chờ; không thêm trạng thái riêng. Hiển thị
các lý do này ở Chờ thực hiện khi chưa đủ điều kiện chạy; khi chưa có xác nhận tiến trình đã dừng thì
không tự đổi Đang chạy sang Sẵn sàng để dispatch lần nữa.

Review/QC không đạt tạo hoặc mở lại công việc sửa liên quan, giữ lịch sử kết quả. Tối đa 5 vòng sửa
và kiểm tra lại cho cùng bước kiểm tra, không đếm lỗi hạ tầng hoặc chuyển model là vòng sửa. Sau
vòng thứ 5 vẫn không đạt, chuyển Chờ bạn với nguyên nhân, những gì đã thử và đề xuất. Không reset
bộ đếm bằng cách đổi model hoặc tạo lại ticket; chỉ tiếp tục theo quyết định owner được ghi nhận.

Ticket bước hoàn thành theo tiêu chí riêng. Ticket yêu cầu có thay đổi code chỉ hoàn thành khi mọi
bước bắt buộc đạt, code đã merge và snapshot docs web khớp commit được merge. Yêu cầu chỉ nghiên
cứu hoặc tài liệu hoàn thành theo artifact và tiêu chí phù hợp, không bắt buộc có merge code.

## 7. Merge, deploy và phục hồi

Tự merge khi các cổng workflow, test, review và docs đạt. Kiểm tra trên kết quả ghép với nhánh đích
hiện tại; thay đổi nhánh đích hoặc conflict làm bằng chứng cũ cần được đánh giá lại. Ghi commit thực
tế sau merge. Deploy chỉ chạy khi owner duyệt hành động cụ thể trên web hoặc tạo ticket deploy.

Lệnh từ web có định danh, xác nhận tiếp nhận và kết quả; gửi lại lệnh không tạo tác vụ trùng. Mỗi
ticket chỉ có một quyền thực thi đang hiệu lực. Khi app/agent kết nối lại, đối chiếu tiến trình, quyền
thực thi và artifact trước khi retry. Không coi mất heartbeat là bằng chứng tiến trình đã chết.

Checkpoint lưu bước, quyết định, artifact, commit và attempt. Tác vụ đã merge không merge lại chỉ
vì chưa báo được kết quả; ưu tiên xác minh commit và tiếp tục đồng bộ docs. Tạm dừng/hủy được xác
nhận tới tiến trình thực tế và lưu trạng thái, không chỉ đổi nhãn trên UI.

## 8. Giám sát vận hành

Sự kiện cần xử lý đánh thức Trợ lý ngay: câu hỏi, model lỗi, máy mất kết nối, bước kết thúc, version
lệch và lỗi docs. Kiểm tra dự phòng mỗi 5 phút tìm trạng thái stuck hoặc sự kiện bị bỏ lỡ. Server lưu
việc cần xử lý khi máy Trợ lý offline; khi online khôi phục kiểm tra, không tạo nhiều Trợ lý song song.

Stuck được đánh giá theo heartbeat tiến trình, hoạt động, timeout phù hợp loại bước và kết quả thực
tế. Trợ lý giải đáp, khôi phục, đổi model, retry có kiểm soát hoặc hỏi owner. Mọi can thiệp ghi nguyên
nhân, hành động và kết quả. Không thông báo lặp khi trạng thái không đổi; web giữ các việc cần chú ý.

## 9. Docs là điều kiện hoàn thành

Dùng lại chuẩn trong packages/docs-kit/STANDARD.md của v1: AGENTS.md, docs/index.md,
docs/architecture.md, docs/flows.yaml, docs/files.md và docs/flows/<id>.md; tiếng Việt cho nội dung,
tiếng Anh cho identifier và path. Giữ manifest ánh xạ file ↔ flow và các bảng sinh tự động.

Đánh giá v1 trên repo Crew: check --all đạt; 41/41 test docs-kit đạt. R3 chỉ xác nhận trang flow có
được sửa cùng code, chưa xác minh nội dung đúng. Heading trang chưa được validator bắt buộc;
merge commit được miễn R3 nên sửa conflict cần thêm kiểm tra. Chưa audit docs mọi dự án cũ.

V2 yêu cầu:

1. Cập nhật docs trong ticket triển khai, không đợi một agent docs riêng sau cùng.
2. Validator kiểm tra cấu trúc, heading, manifest, độ phủ và block sinh tự động.
3. Review đối chiếu nội dung docs với diff code, ghi bằng chứng và các điểm chưa xác minh.
4. Kiểm tra bản cuối sau ghép nhánh trước tự merge, kể cả phần giải quyết conflict.
5. Sau merge, sync docs theo commit thực tế; snapshot trên web lưu commit và thời điểm.
6. UI hiển thị rõ snapshot thiếu hoặc chưa theo kịp; không trình bày bản cũ là bản hiện tại.
7. Kiểm tra 5 phút phát hiện sync lỗi và khôi phục, không đánh thức review toàn bộ docs khi không có thay đổi.

Docs BMAD/Superpowers giữ định dạng gốc của workflow và được liên kết từ docs dự án; không ép
artifact thiết kế/story/plan vào template flow. Chuẩn Crew mô tả trạng thái hệ thống đã triển khai;
artifact workflow mô tả ý định và kế hoạch, hai loại phải được phân biệt trên UI.

## 10. UI web

UI quản lý công việc tham khảo Jira: điều hướng theo dự án, board theo trạng thái, danh sách có bộ lọc,
chi tiết ticket, phân cấp ticket và lịch sử. UI docs tham khảo Confluence: không gian tài liệu theo dự
án, cây trang, tìm kiếm, liên kết giữa trang và ticket, hiển thị commit nguồn cùng trạng thái cập nhật.
Đây là định hướng trải nghiệm, không yêu cầu sao chép thương hiệu hoặc toàn bộ chức năng của hai sản phẩm.

Web cung cấp hội thoại với Trợ lý, chọn dự án/workflow, xem docs và trả lời tại ticket đang chờ.
Trang yêu cầu thể hiện các bước, phụ thuộc, bước hiện tại, các nhánh sửa và ticket con. Timeline ghi
quyết định, can thiệp, review, fallback và artifact, không chỉ transcript agent.

Ticket hiển thị workflow/version, skill hiện tại, độ khó và lý do, máy/model, trạng thái/lý do chờ,
số vòng sửa, kết quả kiểm chứng, commit và trạng thái docs. Trang máy hiển thị kết nối, dự án,
pool model, hai bộ workflow và app version, cùng nút cài/update. Có lựa chọn máy/model Trợ lý và
danh sách vấn đề cần owner xử lý. Điều khiển pause, cancel và duyệt deploy gửi lệnh có phản hồi thực.
Trang máy có công tắc Claude Code, Codex và API độc lập theo máy, hiển thị cấu hình đang áp dụng
hoặc chờ xác nhận; model từ nguồn bị tắt không thể được chọn trong form cấu hình Trợ lý.

### Tạo ticket, clipboard và attachment

Owner có thể paste ảnh trực tiếp từ clipboard vào form tạo ticket trước khi ticket tồn tại, chọn
file để đính kèm hoặc kéo thả. Hiển thị ảnh xem trước, tên file, dung lượng và trạng thái upload;
cho phép gỡ attachment trước khi gửi. Cùng khả năng này áp dụng khi bổ sung thông tin vào ticket
hoặc hội thoại với Trợ lý.

Form comment trong ticket có đầy đủ khả năng paste ảnh clipboard, kéo thả/chọn file, preview,
gỡ attachment trước khi gửi và retry upload như form tạo ticket. Attachment gắn với đúng comment;
có thể gửi comment chỉ chứa ảnh/file. Gửi lại không tạo comment hoặc attachment trùng. Trợ lý được
đánh thức khi có comment mới, đọc cả nội dung và attachment trước khi trả lời hoặc đánh giá lại
ticket. Comment đến trong lúc đang chạy được ghi nhận bền vững, không bị bỏ qua và không tạo một
lần thực thi ticket trùng. Các yêu cầu về quyền truy cập, trích xuất, fallback và báo lỗi đọc file
áp dụng như attachment lúc tạo ticket.

Upload dùng vùng tạm gắn với owner và lần soạn yêu cầu; khi gửi, liên kết attachment đã upload
thành công với ticket. Upload lỗi phải hiện rõ và cho retry; không tạo ticket thiếu attachment
mà owner tưởng đã gửi. File tạm bị bỏ hoặc form bị đóng được dọn sau thời gian lưu tạm. Tạo ticket
và gắn các attachment phải có cơ chế chống trùng khi retry.

Trợ lý phải đọc nội dung ảnh và file liên quan trước khi phân tích, tạo ticket bước hoặc trả lời.
Hỗ trợ ảnh, PDF, văn bản/code, DOCX và bảng tính XLSX/CSV; tài liệu scan cần đọc ảnh trang hoặc OCR.
Giữ bản gốc và metadata; phần trích xuất phải liên kết tới attachment, trang, sheet hoặc vùng ảnh
khi có thể để owner kiểm tra căn cứ. Ticket con nhận tham chiếu tới attachment cần thiết, không
phải tải lại hoặc nhân bản mọi file. Attachment vẫn khả dụng khi resume hoặc đổi model/runtime.

Loại file không hỗ trợ, file hỏng, có mật khẩu hoặc đọc chưa đầy đủ phải được báo rõ trên ticket;
Trợ lý không tuyên bố đã đọc hoặc suy đoán nội dung bị thiếu. UI công bố giới hạn upload được cấu
hình và kiểm tra ở cả client/server. File được kiểm tra loại nội dung, truy cập theo quyền owner
và machine được giao việc. Nội dung file là dữ liệu đầu vào, không được dùng để ghi đè quyền hạn
hay workflow của agent hoặc tự thực thi macro/script nhúng trong tài liệu.

### Chế độ flow chart

Ngoài board và danh sách, mỗi yêu cầu có chế độ flow chart tương tác của workflow thực tế. Node biểu
diễn ticket bước; cạnh biểu diễn phụ thuộc, nhánh thực thi và vòng quay lại sửa khi review không đạt.
Hiển thị bước hiện tại, trạng thái, lý do chờ, máy/model và số vòng sửa. Phân biệt bước chưa chạy,
đang chạy, hoàn thành và đang cần owner bằng nhãn cùng biểu tượng, không chỉ bằng màu.

Owner có thể zoom, pan, đưa toàn bộ sơ đồ vào khung nhìn và mở chi tiết ticket bằng cách chọn node.
Bước lớn có thể mở rộng để xem ticket công việc; mặc định giữ mức bước để sơ đồ dễ đọc. Cập nhật
tiến độ từ cùng nguồn trạng thái với board và danh sách; chuyển chế độ không tạo bản workflow khác.
Sơ đồ phản ánh các bước của workflow/version đã ghim, không gắn cứng chuỗi ví dụ BMAD hoặc Superpowers.

Flow chart phục vụ quan sát và thao tác trên ticket. Chỉnh sửa định nghĩa workflow bằng kéo thả
không thuộc phạm vi yêu cầu hiện tại. Trên màn hình nhỏ vẫn có thể mở ticket và theo dõi bước hiện
tại qua danh sách, không bắt buộc thao tác sơ đồ rộng để trả lời Trợ lý.

## 11. Cập nhật app macOS từ xa

Owner kích hoạt cập nhật từ web. App tải gói có chữ ký, kiểm tra chữ ký, checksum và khả năng
tương thích, rồi chờ không còn job đang chạy trước khi chuyển phiên bản. Máy Trợ lý cần lưu
checkpoint và dừng nhận lượt mới trước khi chuyển. Khởi động hoặc kiểm tra sức khỏe thất bại
thì rollback bản trước, báo web; không đánh dấu thành công chỉ vì tải xong.

Giữ định danh ký app ổn định giữa các bản để hạn chế mất quyền macOS; cập nhật từ xa không thể
tự cấp quyền hệ điều hành chưa có. App hiển thị quyền cần owner cấp trực tiếp khi cần.

## 12. Chuyển dữ liệu và kiểm thử nghiệm thu

Trước chuyển dữ liệu: backup dữ liệu/docs v1, kiểm kê project, bản docs, commit nguồn và checksum.
Nhập vào v2 có đối chiếu nội dung, link nội bộ và định danh; có thể chạy lại không tạo bản trùng.
Giữ bản nhập nguyên trạng, đánh dấu kết quả audit; không tuyên bố docs cũ cập nhật với code nếu
chưa đối chiếu checkout. Không sửa dữ liệu v1 trong giai đoạn khảo sát hoặc thử nhập.

Các tình huống bắt buộc nghiệm thu:

- Feature lớn, thay đổi nhỏ, bug và yêu cầu chỉ nghiên cứu đi đúng workflow.
- Cả hai workflow cùng cài; chỉ bộ được chọn được nạp, kể cả agent con và plugin user.
- Cài/update một bộ thất bại; máy offline; version lệch; run cũ vẫn giữ version đã ghim.
- Claude Code, Codex, API thực thi được công cụ; fallback giữa runtime không chạy trùng hoặc mất artifact.
- Tất cả model hết quota; máy dự án hoặc Trợ lý offline; khôi phục sau reconnect.
- Bật/tắt Claude Code, Codex và API độc lập theo máy; nguồn tắt không nhận việc hoặc fallback mới,
  attempt đang chạy không bị hủy; tắt hết nguồn, tắt nguồn của Trợ lý và thay đổi lúc máy offline
  đều có trạng thái chờ rõ ràng, đồng bộ trước dispatch và khôi phục đúng khi bật lại.
- Review thất bại đến vòng 5; câu hỏi được tự trả lời hoặc chuyển owner đúng phạm vi.
- Crash sau merge trước báo kết quả; conflict; nhánh đích đổi; không merge/deploy trùng.
- Docs đổi sơ sài bị review phát hiện; cấu trúc sai bị validator chặn; sync lỗi không đóng ticket sớm.
- Cập nhật app có chữ ký, đợi job, rollback lỗi và bảo toàn checkpoint.
- Nhập docs cũ giữ nội dung; không nhập ticket, credential hoặc đăng ký máy v1.
- Board, danh sách và flow chart phản ánh cùng trạng thái; sơ đồ hiển thị phụ thuộc, ticket con và vòng sửa,
  mở đúng ticket khi chọn node; không nhầm sơ đồ workflow định nghĩa với lịch sử run thực tế.
- Docs có cây trang, tìm kiếm và liên kết ticket theo dự án; trạng thái cập nhật và commit nguồn nhìn thấy được.
- Paste ảnh và thêm nhiều attachment ngay lúc tạo ticket; preview, gỡ, retry upload, gửi lại không trùng,
  dọn file tạm; ảnh/file còn truy cập được sau resume và fallback.
- Comment hỗ trợ cùng thao tác ảnh/file, kể cả comment chỉ có attachment; gắn đúng comment,
  không trùng khi gửi lại; Trợ lý đọc comment và file mới trong cả ticket đang chờ hoặc đang chạy.
- Trợ lý đọc ảnh, PDF scan, DOCX, XLSX/CSV và text/code; kết luận truy được về nguồn; file không đọc
  được hoặc chỉ đọc một phần được báo rõ, không âm thầm bỏ qua đầu vào.

## 13. Phân rã kế hoạch tiếp theo

Đây là spec tổng thể, không phải một task triển khai nguyên khối. Kế hoạch sẽ chia thành các phần
có hợp đồng và nghiệm thu độc lập, thống nhất theo spec này:

1. Nền tảng v2, định danh dự án và nhập/audit docs.
2. Cổng macOS, đăng ký máy và đồng bộ/cách ly workflow.
3. Adapter runtime, API agent loop và pool model.
4. Trợ lý, ticket, quyết định, phục hồi và giám sát.
5. UI workflow, docs, máy/model và vận hành.
6. Merge/docs gates, deploy approval, cập nhật app và kiểm thử tích hợp.

Lựa chọn stack, phiên bản BMAD, gói cài đặt và giao thức chi tiết là quyết định cần giải quyết bằng
khảo sát kỹ thuật trong kế hoạch; không được thay đổi các hợp đồng sản phẩm đã chốt ở trên.
