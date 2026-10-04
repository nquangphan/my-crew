# Workflow chính thức của Trợ lý — bản nháp phase06/T3

## Mục đích

Gắn định nghĩa workflow với đúng source và projection bất biến trước khi tạo run. Gateway trả định nghĩa cho Superpowers và BMAD cùng một digest customization chung, và có bộ kiểm tra byte artifact BMAD. BMAD là định nghĩa hai tầng: tầng định nghĩa đến từ registry, render receipt được latch sau ở server. Run graph, gate, renderer và receipt BMAD ở server/host chưa có producer được chứng thực.

## Điểm vào

- `gateway/src/assistant/workflow-manifest.ts` → `createWorkflowManifest(registry).loadDefinition(source, projection)` trả `WorkflowDefinition = {sha256, skills, customizationSha256, render?}`; `customizationContext(source, projection, layers)` là hàm thuần tính digest customization dùng chung.
- `gateway/src/workflows/registry.ts` → `WorkflowRegistry.resolve` kiểm cached source/projection và trả root cùng manifest.
- `gateway/src/assistant/render-artifacts.ts` → factory chụp expectation và kiểm artifact byte được cung cấp, trả loại `artifact-inspection` không có authority.
- `gateway/test/workflow-manifest.test.ts` → kiểm bytes nguồn/projection, pin, mismatch, digest customization và định nghĩa BMAD hai tầng.

## Các bước

1. Chụp sâu `SourcePin` và `ProjectionPin`, kể cả `derivation.options`, trước mọi lần chờ. Kiểm hai snapshot và dùng chính chúng cho `WorkflowRegistry.resolve`, so manifest và tính digest. Caller sửa object sau lời gọi không thể đổi identity đã xác thực.
2. Chọn các `skills/*/SKILL.md` từ manifest source chính thức. Mỗi path phải là regular file trong cả source và projection, có cùng SHA-256. Adapter đọc lại bytes ở hai root, kiểm hash thực tế và so toàn bộ manifest source/projection với pin. File được mở với `O_NOFOLLOW | O_NONBLOCK`; `fstat` loại FIFO và file không regular trước khi đọc; FD được đóng trong `finally`.
3. `customizationSha256` là SHA-256 của canonical `{schema: 'crew-v2:workflow-customization:1', workflow, sourceTreeSha256, projectionTreeSha256, layers}`. Superpowers có `layers = {}`: projection đã pin không chứa layer tùy biến nào, và phát biểu đó gắn vào `projectionTreeSha256`, nên đổi projection thì đổi digest; thứ tự key không ảnh hưởng. BMAD có đủ 7 layer path (SHA-256 hoặc `null`) đo từ projection. Hàm kiểm lại pin, từ chối source/projection lệch nhau, layer thừa/thiếu và layer bắt buộc bằng `null`.
4. BMAD chỉ nhận runtime `claude`. Từ manifest projection, adapter chọn mọi file `.md` dưới `.claude/skills/bmad-build/` (kể cả thư mục con, không lấy `bmad-build-auto`), `customize.toml` và `_bmad/scripts/{render_skill,config_utils}.py`. Thiếu `SKILL.md`, `workflow.md`, `customize.toml`, một trong hai script, layer bắt buộc `_bmad/config.toml`, hoặc gặp symlink/không phải file ở cây skill hay layer path đều trả `WORKFLOW_SKILL_MISMATCH`. Mọi file được chọn và mọi layer có mặt được đọc lại bytes thật trong projection root. `skills` là các `.md` được chọn trừ `SKILL.md`. `render = {source, projection, selectedProjectionSha256, layers}` đúng bằng expectation của bộ kiểm tra artifact khi bỏ `projectRoot`/`generationRoot` do host gắn sau.
5. `sha256` của định nghĩa là SHA-256 của canonical `{source, projection, skills, customizationSha256, render}` (Superpowers: `render = null`). Identity này chỉ chứng minh định nghĩa manifest đã đọc; nó không cấp quyền chạy model, phát lệnh hay chứng nhận runtime isolation. Adapter không chạy renderer, `uv` hay process con nào.
6. Bộ kiểm tra artifact nhận byte manifest, projected sources, config layers và output. Nó từ chối proxy/accessor trước khi đọc, giới hạn tổng byte trước copy và kiểm hai quan sát của cùng `customize.toml` nhất quán. Path identity phải là Unicode hợp lệ; manifest schema1 và generation identity khớp canonical JSON của renderer Python. `resolved_values` chỉ nhận key từ token source đã chụp và loại scalar/string-list/review-layer chính thức của exact BMAD tree được chấp nhận. Unknown pin/category, key thừa hoặc short token mơ hồ đều bị từ chối.
7. Adapter không còn trả `RENDER_ARTIFACT_REQUIRED`. Việc từ chối BMAD chưa có artifact thuộc server: run BMAD được tạo với `rendered_artifact_id = null` và admission từ chối dispatch khi giá trị này còn `null`. Không dùng hash/path do client khai báo làm bằng chứng renderer.

## Files

| Đường dẫn | Vai trò |
|---|---|
| `gateway/src/assistant/workflow-manifest.ts` | Adapter định nghĩa Superpowers/BMAD hai tầng và digest customization chung |
| `gateway/src/assistant/render-artifacts.ts` | Bộ kiểm tra thuần byte của artifact BMAD, không đọc host hoặc chạy renderer |
| `gateway/test/render-artifacts.test.ts` | Kiểm consistency, cap, descriptor, category và Unicode trên byte fixture |
| `gateway/test/workflow-manifest.test.ts` | Kiểm fixture official source/projection, digest customization, định nghĩa BMAD và các điều kiện từ chối |
| `gateway/test/fixtures/workflow-definitions/bmad-claude-projection.json` | Tập con layout projection BMAD claude: bytes chính thức lấy từ archive đã pin, config layer tổng hợp |

## Dữ liệu

Server `createRun` và `answerGate` cần persisted Actor A, TurnFence/scope hiện hành và orchestration port thật. Definition/render receipt phải đi từ host producer đã review sang server với exact source, projection, customization/config, project root và rendered bytes. SQL fixture chỉ kiểm quan hệ; không chứng nhận producer hoặc authority. Gate chỉ materialize khi artifact thật đã được xác minh; UUID đặt trước không thay cho `workflow_gates.artifact_sha256` bắt buộc.

## Flow liên quan

`gateway-workflows` giữ registry và pin source/projection; `server-assistant` giữ scope/TurnFence; `server-tickets` giữ root ticket và owner decisions. Phase06/T3 chưa nối adapter manifest với authority và run graph. Native workflow runtime/admission vẫn cần chứng cứ riêng, không suy ra từ unit fixture này.

## Tests

Từ `v2/gateway`: `node --test test/workflow-manifest.test.ts test/render-artifacts.test.ts`. Superpowers dùng archive 6.4.2 và projection đã audit. BMAD dùng fixture `workflow-definitions/bmad-claude-projection.json`: bytes `bmad-build`, `customize.toml` và script lấy từ archive 6.12.0 đã pin và khớp hash projection build độc lập; config layer là bytes tổng hợp vì bytes installer sinh ra không được giữ lại. Test tính lại `ProjectionPin` trên cây tập con, nên chỉ chứng minh logic chọn/đo, không chứng nhận projection thật. Các case: digest Superpowers đổi theo `projection.treeSha256` và không đổi theo thứ tự key; BMAD đúng 7 layer, thiếu layer bắt buộc hoặc layer là symlink bị từ chối; layer tùy chọn xuất hiện làm đổi digest dù skill và token giữ nguyên; `skills` đúng tập `.md` trừ `SKILL.md` và phải có `workflow.md`; pin lệch trả `SOURCE_PROJECTION_MISMATCH` trước khi gọi registry; spy `child_process` xác nhận không có process con. Test ở `render-artifacts.test.ts` xác nhận `render` của adapter đúng bằng expectation D1 trừ hai root và inspector vẫn là bước riêng. Regression snapshot pin và FIFO giữ nguyên. Chưa có test renderer thực hoặc server run/gate; unit fixture không phải production acceptance.
