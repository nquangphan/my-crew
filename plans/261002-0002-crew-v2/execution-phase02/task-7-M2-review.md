# Phase02 Task7 — scoped re-review M2

**Spec compliance: YES. Code quality: YES. Verdict: READY trong phạm vi M2. M2: CLOSED.** Không có Critical/Important hoặc finding mới cần sửa trong candidate này. Đây là chấp nhận cleanup fixture warnings, không phải phê duyệt toàn bộ runtime/product.

## Phạm vi và căn cứ

Review exact candidate `e638615..29d626d`: chỉ `v2/server/test/docs-read.test.ts`, `v2/server/test/api-acceptance.test.ts` và paragraph Tests R3 trong `v2/docs/flows/server-docs-view.md`. Đã đọc finding M2 gốc trong `task-7-review.md`, toàn bộ `task-7-M2-fix.md`, exact candidate diff, `task-7-M2-evidence/owned.diff`, source hashes và logs liên quan. `owned.diff` khớp toàn bộ candidate diff. Không mở lại review Task3 hoặc đưa working changes của peer vào verdict.

## Kết quả kiểm tra

- **22 non-null assertions đã được thay bằng runtime assertions thật.** Docs fixtures xác nhận project import, inventory/foreign project và từng search item trước dereference. HTTP fixtures xác nhận env container/database, current database row và kiểu string của tên database, project import, successful claim attempt và SSE body. Assertion thiếu dữ liệu sẽ fail ngay; không chuyển thành route chứa `undefined`, silent skip hoặc optional access. Cast `as string` của database name được bỏ; không thêm cast/suppression.
- **Kỳ vọng kiểm thử giữ nguyên.** Search vẫn kiểm tra số item, khác path, ba path duy nhất và kết thúc cursor; các negative cursor/scope/HTTP expectations không yếu đi. SSE vẫn xác nhận HTTP 200 trước đọc body. Deadline/rollback, current credential, revoke/expiry, restart/backup/restore, execution guard và fifth repair assertions cùng cleanup không đổi.
- **Phạm vi code giữ hẹp.** Production search và support HTTP không đổi; F1 deadline và M1 malformed cursor không bị tác động. Paragraph docs mô tả đúng fail-fast behavior mới, không mở rộng claim authority hoặc acceptance.

## Verification đã đối chiếu

Ba SHA-256 của live frozen files khớp report/evidence: docs-read `29a6d628545d1489015a58ea98d930e15ff4ec9320ac61d2f812b5ceef50d37d`; api-acceptance `d1c6a26f9772028aa5dca3250ea4a7c25ef4840855deba8f07979ed6f73dfe0c`; docs flow `59e6b3f1068a050741c5d6ca87f02badb124d452ecdc4238f5d50c72c9c0eb36`. Production search hash `4b741e890fa5af07919cc4f2b3d724d2d807f13daec5fe38a663bfa9b4c18365` và support HTTP hash `d7e3855ccf1eea9a04a1330879cc126b32959e14435382b6fff5f7120322a699` cũng khớp.

Worker evidence ghi typecheck thành công, Biome 3 files không lỗi/cảnh báo; docs-read **5/5** và HTTP acceptance **9/9**, không fail/cancel/skip. Mỗi run dùng một absolute test file qua prefix 001–006. Docs log còn xác nhận deadline rollback và backend PID 107 được dùng lại. Cleanup log ghi inspect đúng hai container IDs `b6ceb9de31ac3c6e73e10bade7491cec465e597c1b24959f1a6ef992681b90c3` và `0bfd5bffe5fa98bdf4fab3085270874af8bd7a78c3706e68cb4ff3f7906f819f` đều trả `no such object`.

Reviewer trực tiếp đối chiếu diff và hashes, đọc evidence đã có; không chạy lại covering suites, tạo service/container hoặc sửa source. Không còn nghi vấn cụ thể trong diff cần một runtime probe bổ sung. F1/M1 đã đóng ở review trước; M2 được đóng tại đây.
