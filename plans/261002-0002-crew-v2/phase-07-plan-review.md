# Review độc lập kế hoạch phase 07 — Web

**Status: Issues Found — chưa sẵn sàng giao triển khai theo task hiện tại.**

Review STATIC ngày 2026-10-03, theo `writing-plans/plan-document-reviewer-prompt.md`: chỉ chặn lỗi làm triển khai sai yêu cầu hoặc mắc kẹt. Không triển khai source, chạy test/build, Git/index, dependency, DB, browser, container, model hay child agent. Chỉ ghi file báo cáo này; giữ nguyên công việc của peers.

## Đầu vào và phạm vi bằng chứng

- Workspace: `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`.
- Plan: `plans/261002-0002-crew-v2/phase-07-web.md`, SHA256 `f4738274c85aae66c9a61b31cbdd0f6c2736fd7944461ba822d642593ae9e5d7`.
- Spec: `docs/superpowers/specs/2026-10-01-crew-v2-design.md`, SHA256 `14085723bba15c1c00de52eab437cf83af58efef8943b761fd029f36f2523165`.
- Đã đọc hai docs index trước source; đọc flow ticket, journal, identity, attachment, docs-view trước đối chiếu producer liên quan. Không có `.codegraph/` ở worktree. Source citations dưới đây được đọc lại trực tiếp, không lấy số dòng từ scout làm bằng chứng.
- Đã xem ảnh `/Users/phannhatquang/Downloads/IMG_6454.JPG`. Hướng sơ đồ root bên trái, nhánh sang phải và click mở detail phù hợp ảnh cùng bổ sung spec; không cần hỏi lại owner về hướng UI.
- Candidate Assistant011 được xem là chưa accepted theo dispatch và chính plan dòng47. Review này không tiêu thụ schema/store011 như hợp đồng đã khóa, không chứng nhận native/parser/production assembly.

Đường dẫn plan/spec trong findings đều tương đối workspace trên. Kết luận chỉ áp dụng cho kế hoạch, không phải kết quả kiểm thử sản phẩm.

## Findings cần sửa trong một batch

### P07-R1 — P1: Xóa operation ở auth boundary phá bảo đảm retry không trùng

**Vị trí:** `plans/261002-0002-crew-v2/phase-07-web.md:208`, cùng dòng125,171–174,314 và215.

Task2 yêu cầu xóa cả operation memory/tab khi logout/**auth boundary**, trong khi Task5 yêu cầu giữ nguyên key/body khi kết quả chưa xác nhận. Chưa phân biệt hết phiên tạm thời, reauthentication cùng owner, logout chủ động và operation đã có receipt. Đây là mâu thuẫn về dữ liệu khôi phục, không chỉ là thiếu test.

**Trace producer:** `getSession` tại `v2/server/src/auth/session.ts:95` trả401 khi cookie thiếu hoặc session hết hạn/thu hồi ở dòng101–104. Route attachment xác thực trước mutator tại `v2/server/src/attachments/routes.ts:220`, rồi kiểm credential hiện hành trước replay ở dòng228. `createMutator` tại `v2/server/src/journal/mutation.ts:29` định danh replay bằng actor/route/key, đọc receipt dòng35–39; khóa thuộc owner chứ không thuộc session. Vì vậy đăng nhập lại cùng owner có thể replay đúng nếu client còn key/body.

**Tình huống tái hiện theo plan:** Tạo ticket/comment đã commit nhưng response mất → operation ambiguous → cookie hết hạn → retry401/GET session401 → xử lý auth boundary xóa key/body → đăng nhập lại. Client không còn dữ liệu để thực hiện retry đã hứa; gửi lại bằng key mới có thể tạo comment/ticket trùng, còn cấm gửi vĩnh viễn thì làm mất đường khôi phục.

**Sửa:** Chốt state machine riêng cho session và operation recovery. Hết phiên phải suspend operation, khóa writes, xóa credential/cache nhạy cảm nhưng giữ khả năng reconcile cùng ý định sau xác thực cùng owner. Với logout chủ động/secret operation, nêu rõ metadata nào được giữ an toàn và cách ngăn tạo key mới khi kết quả cũ chưa rõ; không tự persist secret. Không cần đổi server idempotency.

**Nghiệm thu bổ sung:** API/PG thật: commit rồi mất response, hết phiên, đăng nhập lại, replay đúng key/body; DB chỉ có một entity/receipt và draft chỉ clear sau confirmed acceptance. Có negative test logout/secret không rò dữ liệu. Risk M×H.

### P07-R2 — P1: Dependency nghiệm thu tạo vòng giữa task đầu và task cuối

**Vị trí:** `plans/261002-0002-crew-v2/phase-07-web.md:133`, dòng157,212,238,282,317,344,369 và376–386.

Task1 yêu cầu chụp actual board/docs/map/dialog rồi review trước commit; các màn này chỉ được tạo ở Task3/4/6, vốn phụ thuộc Task1/2. Task2 cần actual auth/SSE private HTTP fixture trước approval; Task3–7 cũng cần browser/API acceptance. Nhưng fixture runner, Playwright config và toàn bộ E2E files được sở hữu/tạo ở Task8, và Task8 bị chặn bởi mọi feature. Task3 còn yêu cầu inject composer Task5 dù bảng cho Task3 và5 chạy song song, không ghi dependency tích hợp. Pure/static preview được cho phép ở dòng80 nhưng không thay acceptance bắt buộc của từng task ở dòng129/241.

**Tình huống tái hiện:** Executor khép Task1 đúng checklist thì chưa có map/dialog; bỏ qua rồi khép Task2 thì chưa có owned fixture; giao Task8 sớm lại vi phạm blockers và có nguy cơ worker ngoài Task8 tự tạo duplicate harness. Đây là vòng trong kế hoạch, độc lập với producer G0–G6.

**Sửa:** Đưa runner/controller fixture cùng browser config vào bootstrap đủ sớm, hoặc chỉ rõ sử dụng fixture hiện hữu bằng path/interface và ownership. Đặt screenshot của từng feature vào task sinh feature, Task1 chỉ chụp shell/preview được gắn nhãn. Tách mốc hoàn tất pure projection khỏi mốc integration acceptance; ghi Task3 detail composition phụ thuộc Task5, và Task4 dialog acceptance phụ thuộc mốc đó. Giữ Task8 cho integration cuối/actions/update, không để nó sở hữu điều kiện chạy test của các task tiền nhiệm.

**Nghiệm thu bổ sung:** Bảng DAG có thứ tự topo rõ cho source và acceptance, mỗi test có producer/runner sẵn ở thời điểm chạy, mỗi file harness có đúng một owner. Không hạ yêu cầu API/PG thật hoặc Playwright MCP để làm DAG hết vòng. Risk H×H.

### P07-R3 — P1: Contract composer chưa truyền được dữ liệu tạo request

**Vị trí:** `plans/261002-0002-crew-v2/phase-07-web.md:123`, dòng219–241 và293–313.

Plan ghi Task3 sở hữu lựa chọn workflow và công bố body `CreateTicket`, nhưng Task3 chỉ định nghĩa list/detail/dialog, không có create form/controller được giao cụ thể. `ComposerProps` chỉ nhận `draftKey`, `ComposeTarget`, `onAccepted`; `ComposeDraft` chỉ có text/files/session/operation, không có title/kind/workflow. `ComposeTarget` không chứa các field này. Chưa có callback/factory hoặc typed submission input nối form request với atomic composer; comment và message có text còn ticket cần DTO khác.

**Trace producer:** `ComposeTarget` tại `v2/server/src/attachments/contracts.ts:28` chỉ định target project/ticket/conversation. `CreateTicket` tại `v2/server/src/tickets/contracts.ts:7` yêu cầu kind/title/description/criteria cùng các field hierarchy. Atomic route `v2/server/src/attachments/routes.ts:453` nhận `{ticket,selection,assistantRead}`; schema dòng117–145 yêu cầu title/kind và không thể suy chúng từ ComposeTarget. Đây là contract hiện hữu, không phải gap chờ G3.

**Tình huống tái hiện:** Từ board chọn tạo request, chọn BMAD, nhập title/kind/description, paste PNG rồi submit. Implementer Task5 làm đúng interface vẫn không nhận được title/kind/workflow do Task3 giữ; phải tự thêm contract hoặc nhân đôi form/state/client ngoài ownership đã khóa. Nếu dùng text làm title hoặc mặc định kind thì làm sai ý định owner.

**Sửa:** Chỉ định owner/file tạo request và discriminated input/submit contract rõ cho ticket/comment/message. Ghi field nào thuộc form, field nào thuộc draft/composer; quy tắc validation và freeze payload trước gửi; truyền lựa chọn workflow chính xác vào criteria như dòng123. Cùng shared composer xử lý file/selection/retry, không tạo composer thứ hai. Bổ sung dependency integration trong R2.

**Nghiệm thu bổ sung:** E2E tạo code/research request và BMAD/Superpowers, có/không file; kiểm exact persisted title/kind/description/workflowChoice/attachment IDs sau retry. Các field mandatory không lấy từ dữ liệu minh họa. Risk H×H.

### P07-R4 — P2: Luồng đăng nhập và thiết lập máy/project chỉ có trong catalogue HTTP

**Vị trí:** `plans/261002-0002-crew-v2/phase-07-web.md:86`, dòng101–106,148–158,176–179,197–208 và351–369.

Plan yêu cầu test login/reload/logout ở dòng396, liệt kê POST project/POST machine/PUT binding ở dòng106 và giữ v2 độc lập, nhưng không giao bước UI/owner/entry point cho login/reauth, đăng ký máy hoặc gắn lại checkout. Task1 chỉ scaffold shell; Task2 chỉ transport/session; Task7 mô tả **đọc** binding/status rồi cấu hình model/workflow. `OwnerClient` chỉ có get/mutate/upload và test cấm mutation trước session, chưa định nghĩa ngoại lệ unauthenticated login hoặc method session riêng. Một executor có thể hoàn tất các trang cho seeded cookie/machine/project mà người dùng mới không vào được hệ thống hay gắn máy mới.

**Trace producer:** `registerAuthRoutes` tại `v2/server/src/auth/routes.ts:91` tạo session sau password/Origin, dòng141 yêu cầu session hiện hữu và không đăng nhập thay người dùng. POST machine ở dòng152 yêu cầu owner đã xác thực ở dòng165. `registerProjectRoutes` tại `v2/server/src/projects/routes.ts:80` tạo project và dòng98–118 bind máy/checkout qua CAS. Spec `docs/superpowers/specs/2026-10-01-crew-v2-design.md:19` yêu cầu máy đăng ký lại, owner gắn lại checkout; dòng34–35 đặt cấu hình thường ngày trên web.

**Sửa:** Giao cụ thể UI đăng nhập/reauth/logout, bootstrap guest→authenticated và safe return route; password không vào pending operation persist. Giao luồng đăng ký máy/token transient và project binding/rebinding, hoặc cite chính xác deliverable/owner của phase khác nếu phần onboarding được thực hiện ở đó. Không buộc web làm OS folder picker. Có thể dùng cùng shell/machine files đã liệt kê, không cần thêm service.

**Nghiệm thu bổ sung:** Browser context sạch login bằng UI → đăng ký máy test → bind project/checkout → reload giữ trạng thái; session expired có đường reauth; stale binding409 và active-execution rebind bị chặn. Token/password không nằm trong cache/log/evidence. Risk M×H.

### P07-R5 — P2: Danh sách vấn đề cần owner xử lý chưa có consumer và acceptance

**Vị trí:** `plans/261002-0002-crew-v2/phase-07-web.md:75`, dòng324–345 và425.

G3 yêu cầu producer `attention routes`, bảng coverage nhận trách nhiệm spec8 ở Task6, nhưng Task6 chỉ mô tả hội thoại/config/câu hỏi bound scope. Không có bước render danh sách attention bền vững, deep link tới ticket/máy/action hay test trạng thái attention sau refresh/reconnect. Đây không chỉ là câu hỏi cần trả lời: lỗi docs, model/máy, intervention hoặc cleanup cần chú ý cũng phải thấy được theo spec.

**Căn cứ:** `docs/superpowers/specs/2026-10-01-crew-v2-design.md:217` nêu các loại sự kiện và dòng223 yêu cầu web giữ các việc cần chú ý; dòng270 yêu cầu danh sách vấn đề cần owner xử lý. Không cần chốt URL mới trước G3, nhưng cần giao consumer rõ ràng để gate có người sử dụng.

**Tình huống tái hiện:** Producer accepted trả một attention item vì lỗi docs/cleanup, không tạo OwnerQuestion. Mọi checklist Task6 hiện tại vẫn đạt với conversation và questions, nhưng owner không có danh sách để thấy item đó sau reload.

**Sửa:** Giao attention panel/list vào Task6 với đúng owner/file, consumes frozen G3 DTO, trạng thái/loading/error/pagination và đường mở đúng đối tượng. Chỉ gửi action qua producer được review, không biến dismiss thành approval và không thêm monitor ở browser.

**Nghiệm thu bổ sung:** Có question và ít nhất một attention không phải question; reload/reconnect vẫn còn item đúng, event replay không nhân đôi, resolution từ server làm view cập nhật. Risk M×M.

## Các gate tương lai không bị tính thành lỗi plan

| Gate | Đánh giá |
|---|---|
| G0 | Ledger, R6 coverage, package/lock riêng là gate đúng. Chưa mở không đồng nghĩa UI được phép tự sửa manifest hoặc bịa schema. |
| G1 | Gap coherent graph được nêu đúng: `readGraph`, `v2/server/src/tickets/dependencies.ts:64`, đọc nodes/dependencies/repair qua ba SELECT dòng66–70 trong transaction mặc định. Đọc cả root và giữ typed edges là đúng; cần producer snapshot/projection/pagination trước real consumer. |
| G2 | `buildApp`, `v2/server/src/app.ts:72`, chỉ mount auth/project/ticket/execution/docs/gateway/model/events tới dòng85. Không mount attachment; plan không giả rằng scoped API review đã mở production. Parser/corpus/authority/comment grouping vẫn phải bàn giao. |
| G3 | Candidate011/store/inbox chưa accepted; owner configuration/replies/questions/run/attention và routing isolation phải có wire riêng đã review. Không chấp nhận tự suy HTTP từ type. R5 chỉ yêu cầu giao consumer, không yêu cầu bịa wire ngay. |
| G4 | Version/telemetry/catalogue/install retry/credential key/owner receipts là handoff đúng. OFF, applied/desired và ACK được phân biệt rõ trong task. |
| G5 | Default deny ở `v2/server/src/app.ts:33`–34 phải giữ tới authority08. Plan đã phân biệt approval bound scope và comment, ACK và STOP, reported và verified. |
| G6 | Updater09/signing/native health/rollback chưa có không phải lý do bỏ UX đã yêu cầu, cũng không được thay bằng download-success. Full acceptance giữ pending. |

Phần graph đã đáp ứng hướng spec: một nguồn DTO với board/list, hierarchy/dependency/repair riêng, không giả chain, giữ hidden edges khi collapse, dialog không unmount graph, có phép đo viewport. Không phát hiện lý do cần một graph service/backend hoặc scheduler thứ hai. HTTP same-origin/CSRF, replay authorization, docs snapshot, safe Markdown và safe attachment preview được mô tả hợp lý ngoài R1/R3/R4.

## Khuyến nghị không chặn riêng

- Sửa hai chữ dịch nhầm trong TypeScript signatures tại plan dòng185 và229: `chỉ đọc` phải là `readonly`. Đây là lỗi snippet có cách sửa trực tiếp, không phải một architecture fork.
- Tổng72h loại trừ producer wait là minh bạch, nhưng Task8 chỉ6h gộp actions08/updater09, fixture, toàn suite MCP và evidence/review. Sau khi sửa R2, tách effort bootstrap harness, mỗi feature acceptance và final integration; ghi allowance sửa findings. Hiện chưa có benchmark năng suất để khẳng định con số thay thế hoặc cam kết72h.
- Tiếp tục dùng API–PostgreSQL thật cô lập và Playwright MCP như matrix dòng394–407; unit/mock screenshot không thay acceptance. Không phát sinh chạy native/model chỉ để khép review tài liệu này.

## Điều kiện khép review và câu hỏi còn mở

Sửa R1–R5 trong plan và cập nhật task dependency/ownership/test tương ứng; review lại delta trước dispatch. Giữ producer gates tách biệt, không cần hỏi lại owner UX. Chưa có câu hỏi kiến trúc nào cần owner quyết định thêm trong batch này. G0–G6 vẫn cần producer/controller bàn giao hợp đồng và bằng chứng theo plan; review này không mở các gate đó.
