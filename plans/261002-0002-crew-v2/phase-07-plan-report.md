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
