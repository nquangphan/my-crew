# Phase06/T3 — Re-review vòng sửa 1 lát S6b-ii (lens bảo mật kiêm phase03-owner)

Ngày 04/10/2026 (Asia/Ho_Chi_Minh). Phạm vi `8689125 → cf78d0f` (commit sửa `cf78d0f`; bỏ qua log). Em chỉ đọc
diff nguồn và test của vòng sửa, đối chiếu với `task-3-s6b-ii-review.md`, và không chạy lại suite. Kết quả GREEN
113/113 lấy theo log của báo cáo.

## Verdict

**Approved.** Cả sáu mục ADDRESSED. Không có breakage chặn. Ba ghi nhận mới bên dưới không chặn.

| Mục | Verdict | Bằng chứng |
|---|---|---|
| I1 | ADDRESSED | `workspace.ts:671-678`: khi có `render`, nếu audit `before` có entry `_bmad` hoặc `_bmad/**` thì ném `BMAD_TRACKED_IN_CHECKOUT` trước vòng exclusion. Fixture tách thành `owner` (chỉ track `.claude`) và `trackedOwner`. Test khẳng định: bị từ chối, record `retained`, `_bmad/legacy.toml` còn nguyên cả trong clone lẫn checkout, cleanup ra `deleted`. Prepare không render vẫn phủ exclusion qua `trackedOwner` |
| M1 | ADDRESSED | `gateway-sync.ts:148`: `resolve` đã nằm trong `try`. Test: slot vẫn `current`, definition giữ nguyên, không có trường `prerequisites` |
| M2 | ADDRESSED | `ProbeRunner(file, args, {cwd})`, cả ba lệnh probe chạy với `cwd = projectionRoot`; runner mặc định truyền `cwd` vào `execFile` |
| M3 | ADDRESSED | `reclaimRenderStage`: `lstat` stage, ENOENT thì bỏ qua `remove` và chỉ dọn `.leader`; stage còn tồn tại vẫn đi qua helper có kiểm identity. Test: bản ghi `complete` của stage đã mất → cleanup ra `deleted` |
| M4 | ADDRESSED | In ra `sys.implementation.name` cùng version; regex `^cpython (3\.N\.N…)$` với N ≥ 11; `version` chỉ ghi phần số. Test: PyPy, GraalPy và output thiếu implementation đều bị từ chối |
| M5 | ADDRESSED | Trở lại dùng escape ``/`` ở cả ba chỗ. Test đọc source để chặn ký tự private-use literal |

## Ba điểm được yêu cầu soi thêm

**1. I1 — trước khi từ chối, còn đường nào chạm `_bmad` của owner không?** Không có đường nào **ghi** vào checkout
của owner. Mọi lệnh trước bước từ chối chỉ đọc owner (`rev-parse`, `pack-objects --revs`) và chạy với
`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `core.hooksPath` riêng, `core.fsmonitor=false`. `init`,
`index-pack` và `checkout` đều chạy trên clone mới dưới `operations/stages/{op}/workspace`, nên `_bmad` của owner chỉ
được **đọc** qua pack rồi checkout vào clone do Crew sở hữu. Audit `before` chỉ đọc clone. Lệnh từ chối nằm trước
mọi `rename`/materialize/render, và test xác nhận file còn nguyên ở cả hai phía. Hệ quả còn lại là một clone
`retained` chứa bản `_bmad` tracked của owner; cleanup thu hồi được nó (test `deleted`). Chấp nhận.

**2. M2 — cwd là projection root tạo khoảng trống với project tự pin `.python-version`.** Có khoảng trống, nhưng
chấp nhận được:
- Executor không bị ảnh hưởng. Lúc render, `UV_PYTHON` được ghim bằng realpath và sha, chạy trong stage, nên cwd
  của probe chỉ quyết định **interpreter nào được ghi vào install report**.
- Generation identity (`render_skill.py:351-356`) không chứa phiên bản Python. Nếu runtime chọn Python khác vì
  `.python-version` của project, nó vẫn ra cùng `generation_hash`, và `_publish` thấy output byte-identical (Q2).
  Lệch duy nhất là `witness.python` không còn mô tả interpreter mà runtime dùng. Witness vốn chỉ là nhân chứng,
  không phải điều kiện khớp.
- Install report đo theo máy, không có một project cụ thể. Đo theo cwd của gateway, như trước khi sửa, còn tệ hơn.
- Phần dư: nếu project pin Python < 3.11, `uv run` của runtime sẽ hỏng. Đó là lỗi môi trường phía runtime, Crew
  không gây ra. `uv` còn dò `.python-version`/`.venv` ở các thư mục **cha** của projection root (vd. `~`), và
  runtime của project nằm dưới `~` cũng chịu cùng tác động đó, nên hai bên không lệch thêm.

Đề xuất (không chặn): thêm một câu vào thông báo prerequisite cho owner, đại ý "project tự pin
`.python-version` thì interpreter đó cũng phải là CPython ≥ 3.11". S6b-iv có thể đo thêm một case `.python-version`.

**3. Breakage mới?** Không có breakage chặn. Có ba ghi nhận:
- **⚠️N1 — `reclaimRenderStage` giờ nuốt mất trường hợp stage biến mất bất thường.** Hàm này cũng được dùng trong
  executor (`reclaim` sau `measure`). Trước đây, stage bị xóa từ bên ngoài giữa lúc chạy và lúc reclaim sẽ thành
  `RENDER_CLEANUP_FAILED`; giờ nó im lặng thành `deleted`. Đường dẫn nằm trong `operations/` 0700 của owner, và kết
  quả vẫn qua inspector cùng audit `after`, nên rủi ro thấp. Nếu muốn chặt hơn: chỉ chấp nhận ENOENT trong nhánh
  cleanup (truyền cờ `allowAbsent`), còn executor giữ hành vi cũ.
- **⚠️N2 — stage đã bị dời vào `quarantine` nhưng chưa xóa (crash giữa hai lệnh helper của `remove`).** `lstat`
  thấy ENOENT nên bản ghi thành `deleted`, còn bản trong `quarantine/` thì không ai dọn. Chỉ tốn dung lượng, không
  phải vấn đề an toàn. Dọn được bằng reconcile quarantine của `OwnedOperations` nếu đã có, còn không thì để T7.
- **⚠️N3 — phạm vi của luật I1 đúng theo ruling (`git ls-files _bmad`, chỉ ở gốc), nên có hai trường hợp không bị
  từ chối:** (a) `_bmad` tracked lồng trong thư mục con, vẫn bị exclusion như phase03 cũ; (b) owner track
  `.claude/skills/bmad-build/**`: file đó bị exclusion rồi bị bản materialize đè lên, runtime thấy thành "đã sửa",
  cùng loại rủi ro commit-thay-thế như I1. Trường hợp (b) cần PM chốt có mở rộng luật từ chối sang
  `.claude/skills/bmad-build` hay không.
- Đổi chữ ký `ProbeRunner` (export) chỉ ảnh hưởng test; ngoài test không có caller nào. `lstat` đã được import sẵn.
  Không đổi gì ở đường non-BMAD.

## Phase03-owner verdict

**Chấp nhận** `workspace.ts`/`inventory.ts` tại `cf78d0f`. Điều kiện I1 đã thỏa. Thay đổi ở `prepareWorkspace` là
một guard chỉ chạy khi có `render`. Hành vi M3 ở `cleanupWorkspace` giờ idempotent. Prepare không render và
exclusion của phase03 giữ nguyên, và vẫn được test phủ qua `trackedOwner`. ⚠️N3(b) để PM quyết định, không chặn việc
chấp nhận transfer.

**Task quality:** Approved
