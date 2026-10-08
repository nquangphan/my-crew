# Review toàn nhánh R1-3 — Trợ Lý

**Verdict: CHANGES_REQUESTED**

Ngày: 08/10/2026, Asia/Ho_Chi_Minh. Nhánh `crew/r1-3`, HEAD `4186028b530a46f4e9ef41823d99f82cab601225`; phạm vi `git diff v3..HEAD`, base `6c20d406c52bd7f5f611fba71375c2abbd2962c5`.

Có **5 finding major**, không có finding critical được chứng minh. F1 là lỗ hổng stock đã tồn tại, được đưa vào vì AC-3 Cổng 2c yêu cầu đóng rõ ràng; F2–F5 thuộc thay đổi mới. Đây là review source và hợp đồng xuyên gói, không phải chứng nhận nghiệm thu runtime.

Đã đọc plan (Global Constraints, Review Focus, Interface, AC-3), ledger O12–O18 và rulings, spike-session, các report SP/BR/PO/RA cùng log lead liên quan, handover R1-2; đối chiếu các đường REST, issue service, claim/execute, authorization và plugin/import. Không sửa code, không commit, không chạy DB/test suite, không gọi model bị cấm. Chỉ ghi file báo cáo này theo phạm vi user giao.

## Findings

### F1 — major — Lọc override của issue chưa đóng đường agent tự thay adapterConfig

**File + symbol:** `server/src/crew/issue-gate.ts:288` — `crewBeforeIssueWrite`; `server/src/crew/issue-create-policy.ts:69` — `decideCreatePolicy`. Đường vòng stock: `server/src/routes/agents.ts:5189` — handler `PATCH /agents/:id`, `assertNoAgentAdapterConfigMutation` tại dòng 2880, `assertCanUpdateAgent` tại dòng 2105; `server/src/services/authorization.ts:2207` — nhánh `agent_config:update`/`allow_self`.

H2/H4 kiểm đúng `assigneeAdapterOverrides`, nhưng không chạy khi sửa agent. Guard adapter ở route chỉ cấm các key instructions-bundle và command trong workspace strategy; `extraArgs`, `command`, `env`, `model` không thuộc allowlist Crew tại đường này. Authorization cho agent tự cập nhật cấu hình khi không có `requiresChangeGrant`. Handler PATCH thông thường gọi authorization mà không đặt cờ đó.

**Kịch bản lỗi:** với agent standard-trust, instructions bundle managed như luồng áp vai trò, dùng chính key của E gửi `PATCH /api/agents/E` với `{"adapterConfig":{"extraArgs":[]}}`. Theo đường source này, request có thể qua `allow_self`, xóa các đối số ghim đã đặt bằng `apply-roles.sh`; request không hề đi qua H2/H4. Có thể tương tự đổi model nền ngoài bảng. Chưa gửi request thật trong lượt review; không khẳng định đã đo HTTP 200 trên spike. Các cấu hình bổ sung như external instructions hoặc trust restriction có thể chặn riêng, nhưng không phải bảo vệ Crew được thiết lập bởi nhánh này.

**Cách sửa:** chặn mutation cấu hình thực thi của agent tại boundary dùng chung cho các đường update/rollback/hire liên quan trong company Crew, hoặc áp một cơ chế authorization stock đã chứng minh chặn cả self-update. Board giữ quyền sửa. Bao phủ `extraArgs`, `command`, `env`, model và đường thay adapter; không chỉ chặn một body mẫu. Việc thêm hook cần ruling theo Q2 và ngân sách 4/5, không được tự suy rộng phê duyệt H5 của spike thành phê duyệt hook khác. Đây là blocker nghiệm thu đã được plan nhận diện, không phải regression do PO-1 gây ra.

**Kiểm lại:** AC-3 2c bằng đúng key executor triển khai; nếu 200 thì hoàn tác, ghi ledger và xử lý điểm dừng owner như plan. Sau biện pháp sửa, chứng minh HTTP 403/422 và cấu hình không đổi; không cần chạy model ngoài bảng để chứng minh.

### F2 — major — Marker có thể nối session qua hai yêu cầu/gói độc lập

**File + symbol:** `server/src/crew/bundle-resume.ts:63` — `findBundlePredecessor`, đặc biệt SELECT B dòng 68 và SELECT blocker dòng 88; `pickBundlePredecessor` dòng 38. Producer: `crew/agents/assistant.md:47`, `:71`.

Định danh gói hiện chỉ là chuỗi tự do trong description. Query kiểm company, agent, adapter, blocker trực tiếp, status và seq; không lấy `parentId`, không đòi A/B là con cùng gốc, cũng không xác thực nguồn hoặc việc sửa marker. Tên như `greet`/`readme` được tái sử dụng giữa các yêu cầu, không phải định danh duy nhất trong company.

**Kịch bản lỗi/tấn công:** A là con đã done của R-old, có `crew-bundle id=greet seq=1` và session của executor E. Agent tạo B dưới R-new, giao E, đặt `blockedByIssueIds=[A]` và sao marker thành `crew-bundle id=greet seq=2`. B chưa có session. Mọi điều kiện hiện tại đều đạt, nên H1 chép session A vào B dù chúng thuộc hai kế hoạch độc lập. Không cần sửa A hay đoán UUID session. Nếu B vốn thuộc gói khác, đổi description của B cũng tạo cùng hiệu ứng. Đây là trộn/chiếm ngữ cảnh trong cùng company và cùng executor; **không phải** bằng chứng lấy được session của company hay agent khác.

**Cách sửa:** tối thiểu ràng buộc A/B là issue con có cùng `parentId` khác null, cùng company, cùng gói và đúng quan hệ trước–sau; nếu cho phép khác project thì phải có hợp đồng rõ. Để chống đổi marker trong cùng gốc, H4/H2 cần bảo vệ membership gói hoặc đối chiếu với kế hoạch có nguồn tin cậy. Chỉ thêm root vào chuỗi marker mà vẫn cho agent tự sửa toàn bộ không tạo ra boundary xác thực. Thực hiện bằng module/hook đang có, không cần scheduler hay bảng mới.

**Kiểm lại:** ca hai gốc dùng cùng tên gói + blocker chéo phải skipped; ca agent sửa marker để nhập gói khác phải bị từ chối hoặc không resume; happy path cùng gốc vẫn nối. Giữ các ca khác company/agent/adapter hiện có. Fixture BR-1 hiện tạo A/B không có parent, nên chưa kiểm được hợp đồng “issue con cùng gói của một yêu cầu”.

### F3 — major — Reviewer dùng SHA nền crew-stack từ comment chưa xác thực tác giả

**File + symbol:** `crew/agents/reviewer.md:23` — “Cách review”, nhánh `crew-stack`; đối chiếu `crew/agents/executor.md:23` và `crew/agents/integrator.md` — “Gộp”.

Executor yêu cầu comment nền “do reviewer viết”, integrator cũng kiểm `authorAgentId` theo policy. Nhưng instruction mới của reviewer chỉ bảo lấy `crew-review … verdict=approved` mới nhất trên issue nền. Không đòi tác giả hợp lệ, completed stage, SHA khớp commit đã review, hay quan hệ bundle/blocker. Các marker review này không có parser server để xác thực thay instruction.

**Kịch bản tấn công:** B stack trên A đã done. Executor tạo commit X của B chứa thay đổi chưa được xem xét rồi đăng trên A một comment của chính executor: `crew-review sha=X verdict=approved`. Khi reviewer B làm đúng câu lệnh hiện tại, “mới nhất” có thể là comment giả và diff trở thành `git diff X..X`, rỗng. Reviewer ký B tại X; lần này integrator nhìn thấy một approval thật của reviewer cho X, nên việc lọc tác giả ở integrator không cứu được phần code reviewer đã bỏ qua. Kịch bản áp dụng khi executor có quyền comment A; không cần giả `authorAgentId` trong API.

**Cách sửa:** đồng bộ việc chọn nền ở executor/reviewer: lọc tác giả theo participant reviewer của policy A (ngoại lệ owner escalation phải tường minh), A done và stage đã hoàn tất, SHA khớp `crew-commit` mới nhất, cùng gốc/gói và blocker đúng O18. Kiểm commit nền là tổ tiên của tip B; ghi lại SHA nền đã dùng để tránh đọc một comment mới làm đổi phạm vi diff giữa executor và reviewer. Không dùng nội dung marker làm bằng chứng danh tính.

**Kiểm lại:** đăng comment giả mới hơn approval thật trên A, rồi review B; reviewer phải bỏ comment giả và vẫn thấy diff từ SHA thật của A tới X. Thêm ca SHA stale, A chưa done, marker trỏ issue ngoài gói. Test instructions hiện chỉ kiểm tồn tại câu `git diff <sha nền>..<sha>`, chưa phủ nguồn SHA.

### F4 — major — Tạo con dở lô làm mất phần kế hoạch còn lại

**File + symbol:** `crew/agents/assistant.md:25` — “Mỗi lần được đánh thức”; `:65`, `:80`, `:82` — “Tạo issue con”; `:90` — “Đóng issue gốc”.

Trợ Lý tạo con tuần tự, chỉ ghi `crew-plan` sau khi xong cả lô. Khi một POST lỗi thì dừng. Lần đánh thức sau, có bất kỳ con chưa done thì bị yêu cầu “không tạo thêm”; nếu các con hiện hữu đều done thì chuyển ngay sang đóng gốc. Không có trạng thái kế hoạch chưa tạo đủ, số con dự kiến đã lưu trước mutation, hay cơ chế idempotency cho POST bị mất response.

**Kịch bản lỗi:** dự kiến A/B/C; tạo A thành công, POST B lỗi hoặc run bị ngắt. A tiếp tục làm. Một wake trong lúc A chưa done có thể bị dependency gate hủy; khi A done, stock phát `issue_children_completed`. Trợ Lý thấy một con done và đóng gốc, B/C không được tạo. Reviewer tổng có thể bắt thiếu việc, nhưng đó chỉ chuyển sang vòng lặp F5. Nếu POST B đã commit mà response bị mất, cũng thiếu quy tắc đối soát chắc chắn để tránh trùng.

**Cách sửa:** lưu toàn bộ kế hoạch và khóa định danh từng con trước POST đầu; mỗi wake đối soát số việc dự kiến với các con đã tạo, tiếp tục phần thiếu bằng idempotency key ổn định/khả năng stock tương ứng. Chỉ đóng khi kế hoạch đã materialize đủ và mọi con cần thiết đã review. Cho phép nhánh “tiếp tục lô chưa hoàn tất” dù đã có con; không hỏi owner lại. Dự liệu wake sẽ chỉ chạy sau khi blocker hiện hữu được giải quyết, hoặc dùng cơ chế stock tạo lô phù hợp.

**Kiểm lại:** cố ý ngắt sau POST đầu, làm lỗi POST giữa lô và mất response sau create thành công. Run sau phải tạo đúng các con còn thiếu, không trùng, không gửi gốc đi review sớm. `blockParentUntilDone` trong service tạo relation, không tự hủy run đang chạy tại chính POST; lỗi cần sửa ở đây là phục hồi sau interruption, không phải khẳng định mọi lô đều bị hủy sau con đầu.

### F5 — major — Reviewer trả gốc về Trợ Lý nhưng Trợ Lý chỉ gửi lại done

**File + symbol:** `crew/agents/assistant.md:27`, `:90` — dispatch theo trạng thái con và đóng gốc; `crew/agents/reviewer.md:35` — review tổng. Stock: `server/src/services/issue-execution-policy.ts:849` — nhánh changes requested, trả `returnAssignee` tại dòng 894.

Reviewer được hướng dẫn request changes khi acceptance criteria gốc chưa được phủ. Stock trả gốc về Trợ Lý với `executionState.status=changes_requested`; các con đã duyệt vẫn done. Instructions Trợ Lý không có nhánh xử lý quyết định này, trong khi nhánh “mọi con done” lại dẫn thẳng tới PATCH done. Nó cũng không được sửa code, nên cần một đường tạo/giao việc sửa riêng.

**Kịch bản lỗi:** A/B đều done nhưng thiếu một hành vi xuyên gói. Reviewer tổng trả `in_progress` với comment “Reviewer: cần sửa — thiếu …”. Trợ Lý đọc danh sách con, không thấy con chưa done, đăng lại `crew-assistant done` mà không tạo việc sửa. Reviewer lại từ chối; sau 5 vòng stock đẩy cho owner. Cổng 4 có thể xanh ở happy path nhưng luồng tự sửa thực tế bị kẹt và tốn quota. Owner request changes ở stage approval cũng cần đường xử lý, không tự gửi lại cùng kết quả.

**Cách sửa:** ưu tiên kiểm executionState/decision/comment yêu cầu sửa trước nhánh children-completed. Chuyển các điểm phải sửa thành issue con mới có tiêu chí, executor và model theo O14, dùng `crew-fix`/`crew-stack` khi cần, rồi chờ review con; chỉ submit lại gốc sau khi chứng minh từng điểm đã được xử lý. Không tự sửa repo hoặc hỏi owner xác nhận danh sách sửa. Bổ sung test hợp đồng instructions và một vòng sửa thật.

**Kiểm lại:** reviewer từ chối tổng sau khi mọi con done; phải có việc sửa mới và bằng chứng mới trước lần submit tiếp theo. Kiểm tương tự owner yêu cầu sửa và không tăng review round bằng những lần submit nguyên trạng.

## Đối chiếu sáu trọng tâm

| Trọng tâm | Kết quả đọc source |
|---|---|
| Marker | Regex `crew-bundle` khớp interface, lấy dòng hợp lệ đầu, hỗ trợ CRLF. `crew-model`, `crew-stack`, `crew-kind research`, `crew-plan`, `crew-assistant done`, `crew-report`, `crew-review research verdict=approved` khớp mẫu instructions. Theo interface chúng là giao tiếp agent, không phải regex gate server. Gate server parse bằng chứng docs/merge cũ. Vấn đề là nguồn tin cậy/luồng sử dụng, F2–F3, không phải sai chính tả marker. |
| Resume | Có kiểm B assigned đúng agent, own session, A blocker trực tiếp/done/seq nhỏ hơn và session cùng company/agent/adapter; chọn seq lớn nhất. UPDATE guard queued, company/agent/issue, không đè explicit resume; merge context DB rồi cập nhật object run. Audit cùng transaction; đọc/ghi lỗi fail open, publish lỗi sau commit chỉ warn. Thiếu scope yêu cầu/membership gói: F2. |
| Tương tác R1-2 | H1 gọi cổng tải trước resume; hold thì không resume. Logic gỡ dấu never-started và remote-stop/retry vẫn chạy trước khi mở gate; không thấy thay đổi phá logic này trong diff. Explicit resume được execute ưu tiên hơn reset của `issue_assigned`. Handoff stock nhận biết explicit blocker, nên Trợ Lý chờ con có đường chờ hợp lệ; không thể dựa vào handoff để tự khôi phục phần kế hoạch chưa lưu (F4). |
| Override/model | Allowlist H2/H4 chỉ model/effort, giá trị Sonnet/Opus và low/medium/high; undefined/null/{} hợp lệ; không fallback model ngoài bảng. Bảng assistant khớp O14, việc lõi/bảo mật/migration/scheduler chọn Opus/high. O16 yêu cầu model nền assistant là Opus phải kiểm trên agent triển khai; script áp vai trò không tự chọn model. F1 vẫn mở. |
| Research | H4 chỉ tự chọn 2 stage cho board-created root, nhãn cùng company tên research không phân biệt hoa thường, không có policy do board gửi riêng. Agent create bị ép child policy; PATCH policy bị H2 khóa. Đổi nhãn/description sau create không đổi policy, nên không thấy đường chuyển code root 4 stage thành research 2 stage chỉ bằng marker/label. Executor/reviewer vẫn tin `crew-kind` của con; nên kiểm loại con đối chiếu policy gốc ở nghiệm thu adversarial, tránh xử lý sai dù không bỏ được integrator gate của gốc. |
| Global Constraints | Diff 22 file không thêm core hook/site ngoài registry, không sửa heartbeat/issues core, không thêm scheduler/queue/schema/migration. Checker tại HEAD: 4/5 hook, 8 mục, 0 lỗi; bốn cảnh báo PR upstream cũ. Không có invocation model bị cấm; literal model bị cấm trong test là dữ liệu để từ chối. |

Các đường ghi đã lần theo: REST create, `/children`, accepted-plan decomposition và PATCH gắn actor từ request vào `issueService.create/update`; interaction suggest-tasks cũng truyền actor. Safe company import không cho `assigneeAdapterOverrides` khác null, nên không tìm thấy bypass override qua import này. Plugin host có thể nhận actor rỗng và lúc đó H2/H4 coi là system; SDK đòi plugin chủ động truyền actor. Chưa tìm thấy tool/plugin đang triển khai trong phạm vi nhánh cho agent chuyển tùy ý override qua đường ấy, vì vậy không nâng giả thuyết này thành finding có exploit chắc chắn. Cần kiểm inventory plugin thật trong AC-3; không tuyên bố H2/H4 tự xác thực được mọi mutation do plugin trung gian.

## Bằng chứng và giới hạn xác minh

- Đã chạy checker chỉ đọc `node crew/release/check-core-hooks.mjs`: exit 0, 4/5 hook; `git diff --check v3..HEAD`: exit 0; `bash -n crew/agents/apply-roles.sh crew/ops/inspect-image.sh`: exit 0.
- Không chạy Vitest, DB, typecheck/build hay agent thật trong lượt này theo phạm vi reviewer. Không tạo process nền.
- Log lead `sp-1-lead-run-2.log` ghi 3/3 pass, `br-1-lead-run.log` ghi 81/81 pass. Ledger 14:40 ghi kết quả tích hợp 284/284 server Crew, adapter 14/14, agents 55/55, ops+release 40/40 và tsc OK. Đây là bằng chứng được kế thừa, không phải kết quả reviewer tự chạy lại.
- Các phần đầu report SP-1 còn BLOCKED và report RA-3 còn nói chờ owner chốt stack là lịch sử: phần kết luận spike/ledger mới hơn đã GO H1 và O18 đã duyệt. Không dùng ghi chú cũ làm blocker mới.
- Test session dùng adapter mock/process; chưa thay thế được chứng cứ `claude_local`/SSH/in_place thật, remoteExecution đầy đủ và run liên tiếp trên worktree. Hai hạn chế assertion payload của spike đã có trong report cũ vẫn cần AC-3 bù.

## AC-3 cần kiểm thêm trước khi approve

1. **Cổng 1:** image đúng SHA sau fixes, inspect có cả hai module mới; health API và plugin đúng build; áp lại đủ instructions và xác nhận assistant Opus theo O16, hai executor/environment riêng, `maxConcurrentRuns=1`. Chạy kiểm định theo plan ngoài sandbox phù hợp; giữ ngân sách hook và registry.
2. **Cổng 2a:** cả `/children`, create với parent, PATCH, decomposition/interaction tạo task nếu bật: key agent bị từ chối `extraArgs`/`command`/`env`/`useProjectWorkspace`/model ngoài bảng; DB không đổi; model/effort hợp lệ được lưu; board vẫn sửa được. Dùng chuỗi model bị cấm chỉ làm input từ chối, không invoke.
3. **Cổng 2c/F1:** đo self-PATCH trên đúng executor spike trước khi gọi policy an toàn. Nếu 200, hoàn tác và thực hiện điểm dừng owner theo plan. Kiểm thêm thay model/adapter và config rollback sau giải pháp bảo vệ.
4. **Cổng 2b + 4c:** research root 2 stage, code root 4 stage; gắn/đổi nhãn và chèn `crew-kind research` vào code không làm giảm stage. Research con báo `crew-report`, reviewer duyệt, gốc tới owner, không integrator/docs/push; không activity board override. Kiểm con sai loại bị phát hiện, không được lặng lẽ coi code là research.
5. **Cổng 4a/session:** hai wake `issue_assigned` và `issue_blockers_resolved` thật; đối chiếu contextSnapshot, session params có remoteExecution, `adapter.invoke --resume`, session before/after, activity đúng một lần. Ca đối chứng thiếu marker/khác gói/agent/company/adapter/A chưa done/B có session riêng; thêm hai gốc trùng tên gói và sửa marker (F2). Không coi runtime.sessionId của mock là đủ.
6. **Cổng 4a/stack:** comment approval giả mới hơn, SHA stale, nền sai gói/không phải blocker/A chưa done (F3); happy path B chứa code A và reviewer thấy đúng phần B, integrator merge thứ tự blocker.
7. **Cổng 4a/phục hồi:** interruption giữa lô và response create bị mất (F4); request changes của reviewer tổng và owner sau khi các con đã done (F5). Kiểm số con đúng kế hoạch và không có vòng submit lại nguyên trạng.
8. **Wake/chờ owner:** interaction pending + wake không liên quan không được tạo con/đóng gốc; owner trả lời đánh thức được và không hỏi lại. Có con blocked thì gốc chưa đóng; sau blocker cuối done phải wake đúng assignee. Thử board cancel một con: stock parent-completion tính terminal nhưng dependency readiness chỉ giải blocker done; phải có hướng xử lý minh bạch, không coi cancel là approval. Câu “con nào cancelled thì ghi rõ” trong mục đóng gốc không tự giải quyết blocker này.
9. **R1-2 tải/handoff:** hold trước claim không có resume activity, release gỡ never-started trước provider work; timeout/cancel không tạo tiến trình mồ côi; run chờ con không sinh handoff-rewake vô hạn. Kiểm hai executor thực sự chồng thời gian, resume cùng gói vẫn tuần tự. Nếu nâng tải theo O17 phải ghi và trả về 8.
10. **Cổng 4b + 5:** bug có bằng chứng debug/test đỏ–xanh, gốc đi đủ 4 stage, docs evidence đúng merged SHA, owner duyệt trước push; origin chứa đủ commit. File chưa commit của owner còn nguyên. Ghi transcript/activity/log đúng SHA, dọn issue/process theo plan; chưa push hoặc merge trong lượt review này.

## Status/Summary

**Status: CHANGES_REQUESTED — review hoàn tất, nhánh chưa đủ điều kiện approve.**

**Summary:** H2/H4 và cơ chế ghi resume đáp ứng nhiều guard cơ bản, hook vẫn 4/5. Cần xử lý self-update adapter (F1), scope/xác thực gói session (F2), nguồn SHA nền review (F3), phục hồi tạo con dở lô (F4), và vòng sửa issue gốc (F5); sau đó kiểm các ca AC-3 nêu trên. Lượt này chỉ tạo báo cáo, không sửa code hoặc chạy DB.
