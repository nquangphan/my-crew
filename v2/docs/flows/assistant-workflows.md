# Workflow chính thức của Trợ lý — bản nháp phase06/T3

## Mục đích

Gắn định nghĩa workflow với đúng source và projection bất biến trước khi tạo run. Bản hiện tại có adapter manifest Superpowers và bộ kiểm tra byte artifact BMAD trong gateway. Run graph, gate, reader và renderer BMAD ở server/host chưa có producer được chứng thực.

## Điểm vào

- `gateway/src/assistant/workflow-manifest.ts` → `createWorkflowManifest(registry).loadDefinition(source, projection)`.
- `gateway/src/workflows/registry.ts` → `WorkflowRegistry.resolve` kiểm cached source/projection và trả root cùng manifest.
- `gateway/src/assistant/render-artifacts.ts` → factory chụp expectation và kiểm artifact byte được cung cấp, trả loại `artifact-inspection` không có authority.
- `gateway/test/workflow-manifest.test.ts` → kiểm bytes nguồn/projection, pin, mismatch và BMAD mặc định từ chối.

## Các bước

1. Chụp sâu `SourcePin` và `ProjectionPin`, kể cả `derivation.options`, trước mọi lần chờ. Kiểm hai snapshot và dùng chính chúng cho `WorkflowRegistry.resolve`, so manifest và tính digest. Caller sửa object sau lời gọi không thể đổi identity đã xác thực.
2. Chọn các `skills/*/SKILL.md` từ manifest source chính thức. Mỗi path phải là regular file trong cả source và projection, có cùng SHA-256. Adapter đọc lại bytes ở hai root, kiểm hash thực tế và so toàn bộ manifest source/projection với pin. File được mở với `O_NOFOLLOW | O_NONBLOCK`; `fstat` loại FIFO và file không regular trước khi đọc; FD được đóng trong `finally`.
3. Định nghĩa trả SHA-256 của canonical `{source,projection,skills}` từ các snapshot và danh sách path/hash skill đã chọn. Identity này chỉ chứng minh định nghĩa manifest đã đọc; nó không cấp quyền chạy model, phát lệnh hay chứng nhận runtime isolation.
4. Bộ kiểm tra artifact nhận byte manifest, projected sources, config layers và output. Nó từ chối proxy/accessor trước khi đọc, giới hạn tổng byte trước copy và kiểm hai quan sát của cùng `customize.toml` nhất quán. Path identity phải là Unicode hợp lệ; manifest schema1 và generation identity khớp canonical JSON của renderer Python. `resolved_values` chỉ nhận key từ token source đã chụp và loại scalar/string-list/review-layer chính thức của exact BMAD tree được chấp nhận. Unknown pin/category, key thừa hoặc short token mơ hồ đều bị từ chối.
5. BMAD trả `RENDER_ARTIFACT_REQUIRED` khi chưa có reader được host tin cậy, gắn project root và current render generation. Không dùng hash/path do client khai báo làm bằng chứng renderer.

## Files

| Đường dẫn | Vai trò |
|---|---|
| `gateway/src/assistant/workflow-manifest.ts` | Adapter manifest Superpowers, BMAD deny khi thiếu renderer reader |
| `gateway/src/assistant/render-artifacts.ts` | Bộ kiểm tra thuần byte của artifact BMAD, không đọc host hoặc chạy renderer |
| `gateway/test/render-artifacts.test.ts` | Kiểm consistency, cap, descriptor, category và Unicode trên byte fixture |
| `gateway/test/workflow-manifest.test.ts` | Kiểm fixture official source/projection và các điều kiện từ chối |

## Dữ liệu

Server `createRun` và `answerGate` cần persisted Actor A, TurnFence/scope hiện hành và orchestration port thật. Definition/render receipt phải đi từ host producer đã review sang server với exact source, projection, customization/config, project root và rendered bytes. SQL fixture chỉ kiểm quan hệ; không chứng nhận producer hoặc authority. Gate chỉ materialize khi artifact thật đã được xác minh; UUID đặt trước không thay cho `workflow_gates.artifact_sha256` bắt buộc.

## Flow liên quan

`gateway-workflows` giữ registry và pin source/projection; `server-assistant` giữ scope/TurnFence; `server-tickets` giữ root ticket và owner decisions. Phase06/T3 chưa nối adapter manifest với authority và run graph. Native workflow runtime/admission vẫn cần chứng cứ riêng, không suy ra từ unit fixture này.

## Tests

Focused `node --test --test-name-pattern='workflow manifest' test/workflow-manifest.test.ts` từ `v2/gateway`: 7/7 pass trên fixture official đã audit. Regression dùng resolver chờ để phát hiện caller đổi pin/nested derivation sau lời gọi; FIFO trong scratch được kiểm bằng child Node giới hạn 3 giây, có dấu `RESOLVED`, PID/reap và cleanup. `tsc --noEmit -p tsconfig.json` và Biome hai file pass. D1 sau full review và một vòng sửa/re-review đạt 25/25 test, gateway strict typecheck và Biome hai file trên freeze cuối; bốn finding đã được xử lý. Các positive fixture gồm string-list và normalized review-layer đúng nguồn chính thức. Đây chỉ là kiểm byte được cung cấp, không chứng minh filesystem confinement, lệnh render chính thức, receipt hoặc BMAD admission. Chưa có test renderer thực hoặc server run/gate; không coi unit fixture là production acceptance.
