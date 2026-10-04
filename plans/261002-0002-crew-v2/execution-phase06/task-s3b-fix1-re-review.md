# Re-review S3b vòng sửa 1 (c184944 → 963dc31)

Phạm vi: `task-s3b-fix1-review-package.diff`, đọc một lần. Kiểm tra đích ngoài diff:
- `objectSchema` (`v2/server/src/gateway/contracts.ts:165`, mặc định required = mọi key);
- `RenderLayerPath` (`v2/gateway/src/assistant/render-artifacts.ts:12–18`);
- nhánh Superpowers của `loadDefinition` (`workflow-manifest.ts:211–250`);
- mapping projection production (`v2/gateway/src/workflows/audit.ts:64,176`, `native-projection.ts:24–44`).

Không chạy lại test.

## Verdict từng finding

| Finding | Verdict | Bằng chứng |
|---|---|---|
| I1 schema `render` mở → 500 | **ADDRESSED** | `renderSchema` = `objectSchema` đóng, required `source`/`projection`/`selectedProjectionSha256`/`layers`. `source`/`projection` dùng đúng `sourceSchema`/`projectionSchema`. `selectedProjectionSha256` là map tối đa 2000 khóa, giá trị `digestSchema`. `layers` chỉ nhận đúng 7 path, khớp từng chữ với `RenderLayerPath`; giá trị là digest hoặc null. Khi `definitionMatches` chạy, `render.source`/`render.projection` luôn đã tồn tại và là JSON thuần, nên `canonicalJson(undefined)` không còn chạm được. Khóa `__proto__` bị parser JSON của Fastify chặn trước (400). Test 13 biến thể đều 400; render đúng hình nhưng khác pin trả 200 `accepted=false`. Không tìm thấy đường 500 nào còn lại trong nhánh definition. |
| M1 loader nuốt mọi lỗi | **ADDRESSED** | Chỉ `WORKFLOW_DEFINITION_UNAVAILABLE` được bỏ qua. Lỗi khác cho slot `error` + `DEFINITION_FAILED`, message chỉ chèn mã khi khớp `^[A-Z][A-Z0-9_]{0,63}$`, ngược lại ghi `UNKNOWN` (`code` undefined cũng thành `UNKNOWN`), nên không lộ đường dẫn. Có test cho cả ba nhánh. |
| M2 thiếu `lastError` | **ADDRESSED** | `slot.lastError ??= {code:'DEFINITION_MISMATCH', …}` chạy sau `cleanInventory`, nên message cố định và không bị sanitize đè. Test khẳng định cho cả 4 loại mismatch. |
| M3 thiếu vector chung | **ADDRESSED** | `install-report-vector.json` được sinh bằng `createWorkflowManifest(...).loadDefinition` thật (Superpowers claude, BMAD claude có `render`). Test gateway so khớp byte với file đã commit (sinh lại qua `CREW_UPDATE_DEFINITION_VECTOR=1`); test server đọc đúng file đó (`../../gateway/test/fixtures/...`), đòi `accepted=true` và lưu nguyên bản, còn đổi một layer digest thì `accepted=false`. |

## Phase03-owner

**Điều kiện chuyển giao đã thỏa.** I1 đã đóng.
- `body_hash`, `same()` và phép so pin vẫn không đổi.
- Report không có `definition` đi đúng đường cũ.
- Idempotency không đổi.
- Không có migration hay route mới.

Có một thay đổi ngữ nghĩa acceptance mới, phát sinh từ M1, chỉ có hiệu lực khi `SyncOptions.definitions` được nối (hiện chưa có caller production nào):
- Loader lỗi khác `UNAVAILABLE` sẽ biến một projection khớp pin thành slot `error`, và report không accepted.
- Đây là chính sách fail-closed hợp lý: projection không chứng minh được toàn vẹn thì không nên coi là applied.

Em đã kiểm tra để chắc rằng chính sách này không chặn sai các install hợp lệ:
- Mapping production của Superpowers giữ nguyên `skills/` → `skills/` (`audit.ts:64,176`); codex native chép nguyên source rồi thêm symlink `.agents/skills` (`native-projection.ts:37–44`).
- Vì vậy nhánh Superpowers của `loadDefinition` (đòi `skills/*/SKILL.md` có mặt ở cả source lẫn projection với cùng sha) không bị lỗi `WORKFLOW_SKILL_MISMATCH` một cách hệ thống trên codex/api.
- BMAD ngoài claude ném `UNAVAILABLE` trước khi resolve.

## Breakage mới

Không có breakage chặn. Các điểm cần ghi nhận:

- ⚠️ `v2/gateway/src/sync/gateway-sync.ts` (nhánh `DEFINITION_FAILED`): slot lỗi dùng `...slot()` nên ghi `installed: null`, làm mất thông tin projection đã cài đúng pin. Server/owner chỉ thấy "error, không có gì cài". Không ảnh hưởng tính đúng; muốn dễ chẩn đoán hơn thì giữ `installed: pin`. Server sẽ vẫn coi slot là không accepted vì `state !== 'current'`.
- ⚠️ Từ M1: lỗi I/O tạm thời của loader (ví dụ `ENOENT` trong lúc đọc) giờ chặn acceptance tới lần retry partial kế tiếp (có backoff). Chấp nhận được, nhưng cần ghi vào hợp đồng khi nối `definitions` ở host assembly.
- ⚠️ Các test-support recipe (`v2/gateway/test/support/workflow-archives.ts:117`) map `skills` → `.${runtime}/skills`. Nếu sau này có test nào nối loader thật vào sync với các recipe này, Superpowers sẽ ra `DEFINITION_FAILED`. Đây là rủi ro fixture, production không bị ảnh hưởng.
- ⚠️ Các lưu ý từ vòng đầu vẫn còn nguyên: `definitions` chưa được nối trong production; definition có thể đến từ report không accepted; S4 phải chỉ đọc slot `state=current` và so pin của slot.

## Assessment

**Task quality:** Approved. I1, M1, M2, M3 đều ADDRESSED; phase03-owner chấp thuận chuyển giao.
