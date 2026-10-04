# Review T3-D2 — gateway workflow definition v2 (commit 57601b9)

Phạm vi: `57601b9^..57601b9`, đọc qua `task-3-d2-review-package.diff`; đối chiếu memo PM §A5, §A6, §S3 và Ruling 10:15 (`progress.md:103`). Không chạy lại test (theo yêu cầu). Có ba kiểm tra ngoài diff, mỗi kiểm tra cho một rủi ro cụ thể: (1) consumer của `loadDefinition`/`WorkflowDefinition` trong `v2/gateway/src` và `v2/server/src`; (2) ràng buộc expectation D1 trong `render-artifacts.ts:142-148, 286-322`; (3) 34 hash `official` của fixture so với `workflow-builder/independent-builds.json`.

### Spec Compliance

- ✅ A5.1: nhánh BMAD không còn ném `RENDER_ARTIFACT_REQUIRED`. `loadBmadDefinition` resolve registry rồi chọn các mục sau:
  - mọi `.md` dưới `bmad-build/`, cộng `customize.toml`;
  - `_bmad/scripts/{render_skill,config_utils}.py`;
  - 7 layer đo từ projection.

  Hàm trả `{sha256, skills, customizationSha256, render}` với `render = Omit<CapturedRenderExpectation,'projectRoot'|'generationRoot'>` (`workflow-manifest.ts:17,166-206`).
- ✅ A6: `customizationContext` là hàm thuần dùng chung. Context đúng nguyên văn `{schema:'crew-v2:workflow-customization:1', workflow, sourceTreeSha256, projectionTreeSha256, layers}` và được hash qua `canonicalJson`. Superpowers `layers={}`, được ràng vào `projectionTreeSha256`. BMAD có đủ 7 key, mỗi key là digest hoặc `null`; required layer bằng `null` bị deny; key lạ hoặc thiếu bị deny; prototype không phải plain object bị deny. Không có placeholder.
- ✅ S3 Produces: `WorkflowDefinition = {sha256, skills, customizationSha256, render?}`, và `render` có đúng 4 key D1.
- ✅ RED 1: digest không đổi khi đảo thứ tự key, đổi khi `treeSha256` đổi.
- ✅ RED 2: có 7 layer; thiếu `_bmad/config.toml` hoặc `customize.toml` trả `WORKFLOW_SKILL_MISMATCH`; layer là symlink bị deny.
- ✅ RED 3: optional layer `_bmad/custom/bmad-build.toml` xuất hiện → `skills`/`selected` giữ nguyên, nhưng `customizationSha256` và `sha256` đổi.
- ✅ RED 4: có đúng 14 `.md` trừ `SKILL.md`, bắt buộc có `workflow.md`. Fixture có `bmad-build-auto` làm mồi nhiễu và nó bị loại đúng.
- ✅ RED 5: `SOURCE_PROJECTION_MISMATCH` xảy ra trước khi gọi resolver.
- ✅ RED 6: không có `child_process` trong source. Spy 7 hàm qua `syncBuiltinESMExports` đếm 0 lần gọi. Không spawn uv hay renderer.
- ✅ Ownership: commit chỉ chạm `workflow-manifest.ts`, hai file test, fixture mới và flow doc. Không chạm `render-artifacts.ts`, `registry.ts`, `builder.ts`, workspace hay sync.
- ✅ Ruling 10:15: hunk `render-artifacts.test.ts` chỉ thay test cuối (cũ là dòng 570-577) và giữ tên/bất biến "inspection tách khỏi adapter". Test mới assert `definition.render` bằng expectation D1 trừ hai root, và inspector vẫn cần byte snapshot do host cấp. Test không bị xoá.
- ✅ Ruling D1 về `resolved_values` (key token chính xác, deny key lạ/lồng/số/mơ hồ): diff không chạm. Các test D1 hiện có vẫn nằm trong 38/38 (theo log của implementer).
- ✅ Pin source: các entry `official` của fixture lấy bytes từ `bmad-6.12.0.tgz` (test assert hash từng file). Em kiểm độc lập: cả 34 hash đều có trong `independent-builds.json`. Config layer là synthetic và được khai báo rõ, projection pin được tính lại; đây là identity mức unit, không phải chứng nhận projection thật. Implementer đã nêu giới hạn này.
- ✅ Thay đổi `sha256` của Superpowers so với T3: không có consumer nào ngoài file ở `v2/gateway/src` hay `v2/server/src` (grep trả rỗng), cũng chưa có giá trị persisted. Thay đổi chấp nhận được và đã ghi trong report và flow doc.
- ⚠️ BMAD chỉ nhận runtime `claude` (`workflow-manifest.ts:172`). Memo không quy định điều này. Lý do kỹ thuật hợp lệ, vì `RenderLayerPath` của D1 cố định `.claude/...`. Tuy vậy, một projection BMAD codex đã cài giờ sẽ nhận `WORKFLOW_DEFINITION_UNAVAILABLE`. PM cần xác nhận đây là phạm vi chủ ý (S4 "BMAD 2 path" là dispatch/oneshot, không phải hai runtime).
- ⚠️ Superpowers `layers={}`: implementation không "đo" gì trong projection, chỉ ràng vào tree hash. Cách này khớp ý A6 ("được ràng vào `projectionTreeSha256`"). Phần chứng minh "không có customization lọt vào runtime" được A6 giao cho T4 (`record.exclusions`), lát này không kiểm được.

### Strengths

- Adapter và D1 dùng chung danh sách layer, required set và pattern tên `.md`. Có test chứng minh `definition.render` + root được D1 inspector chấp nhận nguyên trạng, nên hai tầng không lệch nhau ở hình dạng.
- Mọi file được chọn và mọi layer có mặt đều được đọc lại bytes (`O_NOFOLLOW|O_NONBLOCK`, `nlink===1`). Có test tamper layer để chứng minh không tin vào manifest claim.
- `customizationContext` validate lại pin và tự từ chối input sai, nên caller ngoài adapter không tạo được digest cho cấu hình thiếu layer.

### Issues

**Critical:** không có.

**Important:** không có.

**Minor**

1. `v2/gateway/src/assistant/workflow-manifest.ts:186`: script `_bmad/scripts/*.py` được push vào `selected` mà không kiểm `entry.type`. Code này khác cách xử lý của skill tree (dòng 178-180) và của layer (`entry.type !== 'file'`). Nếu manifest khai script là symlink, `open(O_NOFOLLOW)` ném lỗi errno thô (`ELOOP`) thay cho `WORKFLOW_SKILL_MISMATCH`. Kết quả vẫn fail-closed, nhưng mã lỗi không ổn định cho caller hay audit. Cách sửa: `if (entry && entry.type !== 'file') throw new Error('WORKFLOW_SKILL_MISMATCH')`, và thêm một case test symlink cho script.
2. `workflow-manifest.ts:166-206` so với `render-artifacts.ts:66-71,139-140,299-304`: adapter không áp các giới hạn mà D1 áp cho expectation, gồm `maxSelectedFiles=128`, tên `.md` ≤ 512 ký tự kèm `posix.normalize`, `acceptedBmadSourceTree` và giới hạn kích thước file. Hệ quả là adapter có thể trả về một definition mà D1 inspector luôn từ chối, và lỗi chỉ lộ ra lúc receipt (S6/T4). `readPinnedFile` cũng đọc toàn bộ file mà không có giới hạn. Rủi ro thấp vì registry chỉ resolve projection đã pin. Cách sửa (S6 hoặc lát sau): export một validator thuần cho expectation từ D1 và gọi nó trong adapter, hoặc thêm assert chặn số file đã chọn.
3. `workflow-manifest.ts:172`: xem ⚠️ về runtime chỉ là `claude`. Nên ghi quyết định này vào memo hoặc ledger để S3b/S4 không giả định BMAD codex có definition.

### Assessment

Spec đạt, không có lỗi chặn. Hành vi deny vẫn đúng: BMAD không còn deny ở gateway, nhưng production vẫn default-deny ở admission T4 khi `rendered_artifact_id=null`. Phần này thuộc S4/T4 và chưa có trong lát này.

**Task quality:** Approved
