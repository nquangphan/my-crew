# Task7 fix round1 — READY for scoped independent follow-up

Đọc toàn bộ `task-7-review.md`: F1 Important (thiếu SQL deadline), M1 Minor (cursor UUID coercion/path), M2 Minor (22 fixture non-null warnings). F1 và M1 đã sửa theo dispatch PM; M2 deferred theo phạm vi được giao. Worker không stage/commit/subagent. Base trước fix `fe280b7`; HEAD hiện `afe36f3` là commit PM đồng thời, không bị revert.

## Thay đổi và semantics

- `v2/server/src/docs/search.ts`: thêm budget monotonic **2000ms** từ lúc transaction callback bắt đầu. `set_config('statement_timeout',remainingMilliseconds,true)` đặt **transaction-local** trước scope đầu tiên; giảm budget trước explicit snapshot scope, main FTS OR literal query và từng related-ticket query. Kiểm tra thời gian còn lại trước trả response; budget cạn hoặc PostgreSQL query-cancel code **57014** được map sang **ApiError `SEARCH_DEADLINE_EXCEEDED`, HTTP503**, không báo items rỗng thành công. postgres.js rollback transaction tự động; timeout không persist vào connection dùng lại.
- Cursor giữ nguyên envelope/hash/order/protocol, nhưng `typeof projectId/snapshotId === 'string'` bắt buộc trước regex; path dùng producer `validPath`, từ chối empty/traversal/encoded traversal trước SQL. Tuple singleton UUID array nhận **CURSOR_INVALID400**.
- `v2/server/test/docs-read.test.ts`: thêm **2 substantive regressions**. Deadline test tạo DB/private pools, giữ ACCESS EXCLUSIVE docs_files; direct reader trên pool max1 và HTTP search đều deadline503. Trước khi nhả lock, SELECT tiếp theo dùng **cùng backend PID**, timeout setting giống trước transaction và query thành công. Watchdog5s hữu hạn; finally clear timer, nhả lock, chờ pending queries kết thúc, close HTTP và hai pool; databaseFixture drop logical DB, runner stop đúng container. M1 test thử array UUID cho cả2 fields cùng empty/traversal/encoded path.
- `v2/docs/flows/server-docs-view.md`, `server-docs-import.md`: ghi budget/set_config/error/rollback và actual regression. Public exports/signatures/001–006/default deny/auth/replay/read/projection/search scope/FTS fallback giữ nguyên. Không đổi API acceptance fixture, manifest/generated docs hoặc files của peer.

## RED/GREEN và covering hẹp

Evidence đầy đủ tại `task-7-fix-evidence/`.

1. RED trước sửa: `pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/docs-read.test.ts --test-name-pattern='search SQL deadline|search cursor tuple'` → **0/2 pass,2fail**, exit1. Old query bị block tới watchdog5s; old cursor singleton array trả200. Finally nhả lock nên old SQL hoàn tất, không hang runner.
2. GREEN2 regressions cùng command → **2/2 pass**,0fail, exit0; deadline case2400.28975ms gồm login/import+2 concurrent SQL deadlines, cùng backend95 dùng lại; HTTP2 error code chuẩn.
3. Covering một lượt sau source/docs final: `pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/docs-read.test.ts` → **5/5 pass**,0fail/skip/cancel, duration3583.885042ms, exit0. Cả3 docs-read/search tests cũ và2 regressions mới chạy; không rerun169/domain.
4. `pnpm --dir v2/server typecheck` → exit0.
5. `pnpm exec biome check v2/server/src/docs/search.ts v2/server/test/docs-read.test.ts` → exit0, **0errors**,12 existing noNonNullAssertion warnings trong docs-read test. New regressions dùng assertions narrowing và không thêm warning. M2 toàn bộ22 fixture warnings vẫn deferred, không claim warning-free.
6. Flow structure check dùng Python đọc hai owned pages → exact7 STANDARD headings đúng thứ tự; `git diff --check` → exit0.

Để ghi exact cleanup provenance cho RED (lượt đầu chưa ghi container ID), chạy lại chỉ2 regressions với producer code `git show fe280b7:v2/server/src/docs/search.ts`, rồi restore fixed source trong Python finally. Recorded RED vẫn0/2,2fail, watchdog5s và200!=400; source restored SHA khớp covering GREEN trước/sau. Đây là bounded resource-evidence replay, không broad test repeat hoặc source change sau freeze. Log `red-resources.log`.

## Tài nguyên và cleanup

- Recorded RED container `c74ffc2b300226ccd9073917e7864600a263fb7b3789e5e27b29ece1ac57de4f`, DB `crew_v2_test_6e39cf3b7368409e890e7844be9d730a`, own loopback port54751. Lock nhả trong finally dù watchdog RED; runner hoàn tất, exact ID inspect **no such object**.
- GREEN regression container `dd860d9d275e118c06940ede5d632fc4deabc2d8834b73b9b65c786de20afd48`, DB `crew_v2_test_887fc75c110e4676a371ea4b725f622b`, own port54067; direct search/backend95 reuses connection, local timeout restored; exact ID absent.
- Final covering container `be9cba4900348066d1e107d48363ecd807bb87f7b2641b58ba02696a45f03605`, DB `crew_v2_test_9dc20047a5c74a01ad4cb2fbc6c9a7f6`, own port54317; backend101 reuses connection; exact ID absent.
- `cleanup.json` contains actual inspect exit1/no-such-object for all3 IDs. Prefix001–006, no5432/55432. Không custom temp Git mirror, container/service dùng chung, global cleanup hoặc persistent process. Owned scratch logs được copy vào plan evidence rồi xóa theo explicit filenames; in-memory RED source restored by finally.

## Freeze/hash/self-review

- search.ts SHA256 **`4b741e890fa5af07919cc4f2b3d724d2d807f13daec5fe38a663bfa9b4c18365`**.
- docs-read.test.ts SHA256 **`6d845c2b1ede486a314e70cbbbd5569afaba9406116af2bbe56a1da967263f88`**.
- Frozen006 SHA256 unchanged **`8c48a69a27205ff95d11be8b966ffffcd079f62e537f5263777cd867325b75ae`**.

Self-review: deadline set before scope, covers all SQL consumers via shrinking budget, unknown errors rethrow to existing handler, cancellation deliberate503, rollback/settings/PID reuse proven, cursor rejects types before regex and paths before SQL, no big dataset/stress. SQL budget starts on acquired transaction; không claim bound auth/network hoặc waiting to acquire pool. Future production Phase06/08 authority remains denied/unknown as prior report. PM serializes fix candidate and original reviewer scoped F1/M1 follow-up; worker không tự đóng review gate. M2 deferred: original22 fixture non-null warnings; cost là compile-only fixture assertions còn cần readability cleanup, functional evidence không bị vô hiệu.
