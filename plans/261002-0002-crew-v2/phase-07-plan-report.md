# Báo cáo plan phase07 web

Đã viết STATIC plan tiếng Việt, tám task độc lập có review/test cycle, tổng effort dự kiến72h chưa tính producer wait. Chưa triển khai web, cài dependency, đổi source/Git/index/schema hay chạy DB/browser/E2E.

- Plan: `phase-07-web.md`, SHA256 `f4738274c85aae66c9a61b31cbdd0f6c2736fd7944461ba822d642593ae9e5d7`.
- Source snapshot ban đầu: `98e0c173ab6ee68894c5c0f2e7441abd0b285a05`; HEAD đọc khi khép plan: `77ac18b5df41eba0c0e63787caebf985110d1629`. Candidate Assistant T1 có independent review NOT READY, FIX1 đang xử lý;011 chưa accepted.
- Spec managed hiện hành SHA256 `14085723bba15c1c00de52eab437cf83af58efef8943b761fd029f36f2523165`. Owner03/10 duyệt hướng UI; đã xem trực tiếp `/Users/phannhatquang/Downloads/IMG_6454.JPG`. Không có bằng chứng artifact prototype phase07 đã được duyệt.
- Static document checks đạt: tám task, bảy gate, 20 source paths tồn tại, 78 planned files không trùng ownership, code fences cân bằng, risk/rollback/success cho mọi task. Đây là kiểm tra plan, không phải test sản phẩm.

Plan bao phủ board/list/request/detail/history, sơ đồ request→step→task với mọi dependency/repair, dialog giữ viewport/draft/focus, docs snapshot/search/commit/stale, hội thoại/câu hỏi, máy/model/ba switches/workflow install/version, multi-attachment/paste/retry/image-only comment/create và actions/update. Ma trận yêu cầu API–PostgreSQL thật cô lập và Playwright MCP; mock/unit/build không thay nghiệm thu.

Producer gates còn mở: G0 ledger/R6 web coverage; G1 coherent graph/root pagination/current-attempt/history/related-doc links; G2 attachment mount/durable receiver/parser/comment grouping/read authority; G3 accepted011 và owner Assistant/routing/question/reply wire; G4 version/telemetry/catalogue/install retry/active credential key/owner command receipts; G5 target-bound merge/deploy08; G6 signed updater09. Các cổng đều có consumer và negative tests, không route giả hoặc boolean bypass.

Controller sở hữu mapping R2/R3/7H2/generated/Git và serialize producer integration. Plan giữ riêng v2, không import v1 hay sửa prompt. Mỗi task có cleanup tài nguyên sở hữu, auth/CSRF/version conflict/idempotent replay, rollback không xóa dữ liệu đã accept. Plan cần independent review trước dispatch triển khai.

Quota cuối do parent cung cấp:22% đã dùng/78% còn; reserve25%, chỉ khép việc đã giao. Lượt này STATIC và không chiếm heavy slot; không đo mới hay suy telemetry đã cũ thành quyền chạy heavy.

## FIX1 — batch R1–R5, STATIC ngày2026-10-03

Đã FULLREAD review `phase-07-plan-review.md`, SHA256 `bc3c1bd0c01b0f8a90124772e5c80fc214a680f32f9feaf6acde56d5e6e54f87`, và đối chiếu source thực tế trước sửa. Báo cáo ban đầu phía trên là lịch sử; FIX1 này thay plan SHA/effort/ownership/checks, không sửa bản canonical main f473… hoặc review của peer.

| Finding | Delta đã sửa, chờ scoped re-review | Real acceptance giữ nguyên hoặc bổ sung |
|---|---|---|
|R1|Session expiry suspend original key/body; same-owner reauth dùng CSRF mới và replay authorization. Deliberate logout wipe payload/secret nhưng giữ tombstone unresolved; cùng intent không có key mới. Secret chỉ memory, cần re-enter same-key khi payload mất.|A2 baseline project commit→lostreply→expiry→reauth một entity/receipt; A5/A3 atomic ticket/comment đúng key/body; logout/secret/wrong-body negative tests.|
|R2|Harness/config/registry/fixture-lifecycle controller-owned Task1; source và acceptance predecessor sets/topo riêng. Feature E2E mỗi task sở hữu; Task3b chờ Task5, graph dialog acceptance chờ Task3. Task1 chỉ chụp shell; Task8 dùng harness có sẵn.|A1 real isolated API/PG baseline trước A2–A8; mỗi feature dùng actual HTTP/DB/Playwright MCP, không mock để cắt vòng. Source milestone không là full acceptance.|
|R3|Task3 own create-request form/state; exact CreateTicket metadata; shared composer Task5 controlled discriminated ticket/comment/message input, immutable atomic payload/selection/key và state callback khóa form.|code/research × BMAD/Superpowers × with/without file; persisted title/kind/description/workflowChoice/file IDs sau retry/reauth chỉ một entity.|
|R4|Task2 SessionClient/login/reauth/logout/safe return route; auth POST ngoại lệ không PendingOperation. Task7 machine registration transient token và project create/bind/rebind với exact CAS/active guard.|Clean browser UI login→register→create project→bind→reload; stale/active/uncertain rebind409; password/token không storage/cache/log/evidence.|
|R5|Task6 own attention panel/state/tests; G3 frozen owner DTO/pagination/events/resolution; question và nonquestion targets; deep link shared ticket/machine/action, dismiss không approval.|Actual question+docs/cleanup/model attention; reload/reconnect/dedup; server resolution cập nhật, wrong scope bị từ chối.|

Readonly snippets đã sửa. Effort rebudget96h base +16h review/fix allowance =112h planning budget, thay72h cũ; chưa đo năng suất, không benchmark/cam kết, không gồm producer wait. G0–G6 không được mở bởi FIX1. UI approval vẫn có hiệu lực; không hỏi lại owner.

Static checks của tài liệu đạt:8 tasks,7 gates,27 existing source paths,95 planned files không trùng ownership, fences cân bằng, readonly snippets, mỗi task có risk/rollback/success; base hours cộng đúng96. Declared source topo: S1, S2, S3a, S5a, S6docs, S7basic, S3b, S4, S6assistant, S7full, S8actions. Acceptance topo: A1, A2, A5, A6docs, A7basic, A3, A6full, A7full, A4, A8; không có back-edge giữa các task. Diff với canonical lịch sử: +151/−62 dòng. Đây là static document checks, không chạy mã sản phẩm hoặc E2E.

Owned paths chỉ hai file managed:

- `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/plans/261002-0002-crew-v2/phase-07-web.md`
- `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/plans/261002-0002-crew-v2/phase-07-plan-report.md`

Plan FIX1 SHA256 `58506c23236b70c7318d1261e7e7115cc158e92e2a2ef33e1f3b4dd9232b7d15`. Report SHA ghi trong handback để tránh hash tự tham chiếu. Source HEAD đọc `77ac18b5df41eba0c0e63787caebf985110d1629`; Assistant011 chưa accepted, producer/parser/native/production gates giữ nguyên. Không source/Git/index/dependency/DB/browser/container changes hoặc child agents trong FIX1.

Dispatch parent cung cấp quota27%used/73%remaining, reserve25%; telemetry pressure2/available4.61GiB/CPU66.42idle/disk29GiB chỉ cho STATIC, không suy quyền heavy. Plan/report cần independent reviewer scoped-review R1–R5 delta trước dispatch triển khai; chưa claim findings đã được reviewer close.
