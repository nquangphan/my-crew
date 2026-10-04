# CREWV2-701 — Task 1 spec + quality review

## Spec Compliance

- **SPEC: ❌ Issues found.** Phần shell/workspace đáp ứng phạm vi bootstrap; coordinator còn thiếu cơ chế hủy request và giới hạn thời gian cleanup để chuyển sang UNKNOWN khi STOP bị treo (`v2/web/scripts/e2e-fixture.ts:228`, `:238`, `:248`, `:256`; I1 dưới đây). Đây là yêu cầu Task1 về finally/abort/UNKNOWN và ruling bounded return, không phải mở rộng sang Task2–8.
- Đủ 14 path trong package diff. Base `feaea55` → candidate chưa commit; review chỉ Task1 cùng Global Constraints và PM rulings. Diff SHA-256 `7bbb15241ff6f46aa45ec64a31f9b88fa78e710137c9c02672cdffd2e500ec1e`; preflight `21d9a0d5edc19845812e0c91ae055e8396d6464a767b9d334c7ce3bb4b0eff19`; draft docs `32f270e32afa7b251622487d4418c4bcab78551ac23d9ff504f37ec542c09ee5`, đều kiểm hash tĩnh khớp dispatch.
- Ruling thay `databaseFixture`/runner force-cleanup bằng coordinator owned được áp dụng đúng; `captureMigrations(11)` và `migrate(db, migrations)` dùng cùng object, bootstrap gọi producer thật; không sửa helper server (`v2/web/scripts/e2e-fixture.ts:81`, `:411`). Không yêu cầu gọi lại helper FORCE đã được PM loại bỏ.
- Không coi việc bỏ Playwright `webServer` là thiếu spec: PM đã chốt một owner callback/listener; config workers=1 không tạo server trùng (`v2/web/playwright.config.ts:3`). Browser context trong lượt MCP do root sở hữu và đóng trước fixture, đúng ruling hiện hành (`execution-phase07/pm-browser-shell-check.md:26`). Worker-scoped feature fixtures/browser registration còn phải được nối trong task sinh feature.
- ⚠️ **Không xác minh độc lập kết quả chạy final:** preflight `:216–230` ghi 4/4 lifecycle, workspace1/1, typecheck/build/Biome exit0 nhưng raw final TAP/check output chỉ còn transcript worker, không có artifact log để reviewer đọc/băm. Đây là giới hạn truy xuất evidence, không kết luận test không tồn tại hoặc đã fail. Hai UNKNOWN case là unit policy; positive HTTP/PG và SIGTERM child mới là actual integration (`v2/web/test/fixture-lifecycle.test.ts:14`, `:98`, `:123`, `:150`). Không chạy lại để tái tạo evidence.
- ⚠️ **Literal Chrome zoom200% chưa xác minh.** Chấp nhận ruling bootstrap dùng viewport640 thật để đánh giá layout intent; reviewer đã xem ba PNG final, chữ/card đầy đủ ở1280/390/640. Không nâng equivalence thành chứng nhận browser zoom (`execution-phase07/pm-browser-shell-check.md:20–24`). Viewport768 riêng và hard-crash/startup-interrupt chưa có evidence final trong gói này.
- ⚠️ Manifest/R2/R3/R6/generated/docs-check/commit nằm ở root integration, chưa được chứng nhận bởi diff14path. Draft `docs/v2/web-shell.md` đủ7H2; quyền coverage đã có ruling; root vẫn cần hoàn tất/check exact integration trước commit. G1–G6 và feature board/dialog/map/API client không được mở bởi review này.

## Strengths

- Package/lock riêng, đủ exact15pins và scripts theo spec; strict/noEmit/react-jsx không bị nới, producer declaration được include theo ruling (`v2/web/package.json:1`, `v2/web/pnpm-lock.yaml:7`, `v2/web/tsconfig.json:2`). Browser source chỉ import thư viện và source nội bộ; server imports giới hạn harness, không có v1 runtime trong14path.
- QueryClient và router tạo bên trong mount; không có module-global user/draft/graph state (`v2/web/src/main.tsx:8`). Base `/crew-v2/`, API proxy `/v2`, guest ghi rõ “Bản minh họa”, semantic landmarks/skip target focusable và reduced-motion phù hợp shell (`v2/web/vite.config.ts:10`, `v2/web/src/router.tsx:7`, `v2/web/src/shell.tsx:44`, `v2/web/src/styles.css:281`).
- Fixture giữ exact nonce/container ID+start/DB OID/listener identity/scratch dev:ino; cleanup không DROP FORCE, không prune và chặn cascade khi identity chưa ghi hoặc STOP chưa xác minh (`v2/web/scripts/e2e-fixture.ts:164`, `:214`, `:264`, `:282`). Password runtime chỉ memory, getter không enumerable (`v2/web/scripts/e2e-fixture.ts:92`, `:490`).
- Positive lifecycle kiểm login/session thật, proxy thật và close lặp; SIGTERM test có child thật, witness và exact container absence (`v2/web/test/fixture-lifecycle.test.ts:50`, `:80`, `:211`). Report tách lịch sử RED, lỗi setup, final GREEN và giới hạn evidence khá rõ (`execution-phase07/task-1-preflight.md:180`, `:194`, `:214`).

## Issues

### Critical (Must Fix)

- Không có phát hiện Critical trong phạm vi đã đọc.

### Important (Should Fix)

- **I1 — Cleanup có thể chờ vô hạn trước khi báo UNKNOWN.** `v2/web/scripts/e2e-fixture.ts:228`, `:238`, `:248`, `:256`, `:275` await Vite/Fastify/HTTP server/pool shutdown trực tiếp; `v2/web/e2e/support/fixture.ts:43–44` cũng await stop/confirm mà không deadline. Coordinator không giữ AbortController/request/socket cancellation cho run. Một request đang xử lý hoặc body chưa kết thúc trên owned listener có thể giữ `server.close()`/`app.close()` chờ; query đang chạy có thể giữ pool shutdown. Lúc đó `close()` không trả CleanupResult UNKNOWN, registry chỉ ở `closing`, callback/CLI không kết thúc có giới hạn; watchdog bên ngoài kill process không thực hiện contract này. Producer check xác nhận `connectDb` chỉ có connect/idle timeout (`v2/server/src/db/client.ts:14`) và `buildApp` không cấu hình shutdown deadline/cancel cho caller (`v2/server/src/app.ts:29–50`). **Sửa:** theo dõi/hủy các request/socket do fixture sở hữu, đặt deadline cho từng pha close/verify, latch UNKNOWN và giữ registry/DB/container nếu không chứng minh STOP. Không dùng Promise.race đơn thuần rồi để nhánh cleanup trễ tiếp tục DROP/remove sau UNKNOWN. Thêm đúng một regression có active request giữ mở rồi gọi close hoặc SIGTERM, đòi bounded STOP hoặc bounded UNKNOWN và không xóa asset khi STOP chưa rõ. Bốn case hiện tại đã hoàn tất HTTP trước close hoặc gửi SIGTERM khi idle nên chưa trả lời tình huống này (`v2/web/test/fixture-lifecycle.test.ts:80`, `:211`). Phát hiện từ source; reviewer không chạy reproduction vì gate STATIC.

### Minor (Nice to Have)

- **M1 — Callback throw giá trị falsy bị nuốt.** `v2/web/e2e/support/fixture.ts:54–71` lưu caught value rồi chỉ throw khi truthy. `throw undefined`, `null`, `0` hoặc `''` khiến `withFixture` resolve sau cleanup thành công. Dùng cờ `runFailed`/`cleanupFailed` riêng hoặc tagged result để bảo toàn mọi rejection; thêm unit nhỏ nếu sửa. Đây là edge case helper, không phải lý do chính chặn bootstrap.

## Assessment

**QUALITY: Needs fixes.** Shell và ranh giới workspace tốt; I1 làm harness chưa bảo đảm liveness/UNKNOWN trong lỗi mà chính Task1 yêu cầu. Sau sửa I1, chỉ cần regression mục tiêu và các check bị ảnh hưởng trên freeze mới, không cần lặp toàn suite để tái tạo log cũ.

**Kiểm tra reviewer đã làm:** đọc full diff3931 dòng gồm lock mechanical theo từng đoạn; không mở lại file source đã đổi. Output đầu bị tool cắt nên đọc lại phần diff/evidence bị mất; không có hunk code bị cắt giữa hàm phải mở file khác. `.codegraph/` không tồn tại. Chỉ đọc ngoài diff `server/src/db/client.ts` và phần factory `server/src/app.ts` cho rủi ro cụ thể shutdown có producer deadline hay không. Không Git/Node/install/test/PG/browser launch; chỉ đọc tài liệu, băm SHA và xem PNG đã có. Ba hash PNG khớp PM evidence: desktop `694921eef690eb9783e1c62f013ff0df24383bf77ce64c870404dc11e91a2094`, mobile `9a90cfd94f112d77f655edfb96145d3241f5f1a2332516c82900e3dace665919`, reflow `d57c480fc98c744b3c9f1b9d98df3f2b83c4c96f0a2b74694e7847983abd696d`.

**Câu hỏi còn mở:** không cần quyết định UI/owner mới; root xử lý I1 và giữ rõ các giới hạn evidence/integration nêu trên.
