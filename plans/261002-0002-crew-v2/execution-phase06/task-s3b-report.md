# S3b: install report mang `definition`

**Status: DONE.** BASE `e9cdd37afbf912faeb9b838e65a2a08e30d59ef9` (HEAD lúc commit đã tiến tới 5d62379 do worker khác). Node v24.21.0, pnpm 10.32.1.

## Hình dạng

Slot projection của install report (không phải heartbeat) có thêm `definition?: {sha256, skills, customizationSha256, render?}` ngay cạnh `installed`, đúng `gateway_applied.workflow_status[workflow].projections[runtime].definition`. `render` giữ nguyên nếu `loadDefinition` trả (BMAD claude); S3b không giả định definition BMAD cho Codex.

- Gateway: `SyncOptions.definitions?: {loadDefinition(source, projection)}` (khớp `createWorkflowManifest`). Chỉ gắn cho projection vừa `current`; loader lỗi/không có (BMAD ngoài claude) thì slot vẫn `current` không có trường; không cấp loader thì report y như cũ. Kiểu `ReportedInventory` nằm ở `commands/contracts.ts`.
- Server: schema chỉ install report mở `definition` (heartbeat vẫn đóng). `definitionMatches` yêu cầu slot `current`, `installed` và source đúng pin mong muốn, `render` (nếu có) cùng source/projection, và `sha256 == SHA-256(canonicalJson({source, projection, skills, customizationSha256, render|null}))`, đúng công thức `definition()` của D2. Hợp lệ: lưu nguyên bản ở `workflow_status` và `gateway_install_reports.report`. Không hợp lệ: bỏ definition, slot `mismatch`, `accepted=false`, `appliedRevision` giữ cũ. `hash(input)` (body_hash) và `same(slot.installed, pin)` không đổi; chỉ thêm một nhánh.

## Files sửa (chốt trước khi sửa)

Source: `v2/server/src/gateway/service.ts`, `v2/server/src/gateway/contracts.ts`, `v2/gateway/src/sync/gateway-sync.ts`, `v2/gateway/src/commands/contracts.ts` (DTO report nằm ở đây). Tests: `v2/server/test/gateway.test.ts`, `v2/gateway/test/sync.test.ts`. Docs: `v2/docs/flows/server-gateway.md`, `v2/docs/flows/gateway-host.md`. Không migration, không route mới. `contracts.ts` server nằm ngoài danh sách tường minh nhưng là nơi duy nhất giữ schema đóng nên bắt buộc sửa (cùng flow server-gateway).

## RED (source ở HEAD, chỉ tests mới)

- Server `gateway.test.ts`: 25 test, 22 pass, **3 fail**, exit 1. Fail: lưu definition nguyên bản (400 INVALID_INPUT vì schema đóng), từ chối definition lệch (400 thay vì accepted=false), và schema/pin-drift. Các test cũ (kể cả body_hash/pin) pass.
- Gateway `sync.test.ts`: 6 test, 5 pass, **1 fail** (definition `undefined` thay vì giá trị loader).
- Log: `task-s3b-red-server.log`, `task-s3b-red-gateway.log`. Đây là assertion ngữ nghĩa, không phải lỗi setup/compile.
- Để chạy RED tôi sao lưu 4 file source đã viết vào scratch, đưa về HEAD bằng `git show`, chạy, rồi chép lại nguyên bản (không stash/revert Git).

## GREEN

| Lệnh | Kết quả |
|---|---|
| server `node --test --test-concurrency=1 --test-timeout=60000 gateway.test.ts model-certification.test.ts model-pool.test.ts` (PG riêng) | 38/38 pass, 0 fail, exit 0 |
| gateway `node --test --test-timeout=60000 test/sync.test.ts` | 6/6 pass, exit 0 |
| gateway `pnpm exec tsc --noEmit` | exit 0 |
| server strict scoped tsc (`--ignoreConfig ... src/platform/picomatch.d.ts src/platform/thread-stream.d.ts src/attachments/extract/yauzl.d.ts src/gateway/service.ts src/gateway/contracts.ts test/gateway.test.ts`) | exit 0 |
| Biome 2.5.14 `check` trên 6 file owned (trước sửa lỗi) | lỗi `noUnsafeOptionalChaining`/`any` trong test mới đã sửa bằng helper `slotOf`; cuối: **src gateway+sync+commands và server test: 0 diagnostic**. `gateway/test/sync.test.ts` còn đúng 12 warning cũ (dòng < 392, không phải code mới); code mới 0 warning |
| Docs mirror (`git archive HEAD:v2` + overlay file của tôi) | `generate` unchanged, `check --all` ok, `check --staged` ok |

Test mới: server 3 (lưu nguyên + backward + replay/hash conflict; 4 loại mismatch sha/skills/customization/render sai pin; pin drift vẫn mismatch, definition trên slot không pin bị từ chối, schema đóng gồm heartbeat). Gateway 1 (có/không loader, BMAD codex/api vắng definition nhưng vẫn `current`, source slot không có).

## Tài nguyên và dọn dẹp

Slot `$TMPDIR/crew-v2-heavy-slot.lock` (owner=s3b) giữ từ 03:09:41Z đến sau cleanup, rồi `rm -rf` đúng thư mục đó. Gate (`task-s3b-resource.log`): pressure 1, available 4.73-5.01 GiB, CPU idle 75-85%, disk 753 GiB; lần lấy đầu available 3.74 GiB nên tôi nhả slot và chờ. NODE_OPTIONS=--max-old-space-size=384, `--test-concurrency=1`. PG `postgres:18.6`, container `crew-v2-test-ca29849d-d786-449d-a436-fa5d27fb587c` (ID ef67d94f...3dc6), 256m/1 CPU/pids 64 (inspect 268435456/1000000000/64), loopback 52675. Dừng bằng `docker stop <id>`, `docker ps -a --filter name=` rỗng, không còn node test (`task-s3b-cleanup.log`). Không chạm container khác.

## SHA256 file cuối

| File | SHA256 |
|---|---|
| `v2/server/src/gateway/service.ts` | `44711ba983168bbf4ca78cd4d982a2386032f31f76ad5bb6d061fe24c85536cd` |
| `v2/server/src/gateway/contracts.ts` | `e16a904c54bf6578ed6156ea598f72d16f500500c1c4de23509a965982655060` |
| `v2/gateway/src/sync/gateway-sync.ts` | `9c2d7607c255946c8447bd38b715993bebe96ef81ebc3e8d66b832bcfba838c4` |
| `v2/gateway/src/commands/contracts.ts` | `ca79be05e5051f3dd264f587cfcbc986bb35850c46618c945c8465327ccf1be3` |
| `v2/server/test/gateway.test.ts` | `6c7ffcedb2a06b5f91e747fea56e5416eda63e90ad69ec1294012ccb902260b2` |
| `v2/gateway/test/sync.test.ts` | `b63daa668cc1cf581108bf5f69d140e9b3b53f521369fbcff381f65d37d49a82` |

## Self-review

- Không sửa `body_hash`/`same()` pin comparison, migration, route, DTO công khai khác. Heartbeat schema vẫn đóng, test có khẳng định.
- Giới hạn đã biết: server không tự dựng lại `skills`/`render` từ bytes, chỉ chứng minh chúng gắn với pin qua hash do gateway tạo (gateway đã được xác thực bằng machine token; một gateway gian vẫn có thể gửi skills tùy ý kèm hash khớp). Thuộc về tin cậy máy, nằm ngoài S3b; consumer S4 nên chỉ đọc definition từ slot `state=current`.
- `render` chỉ được ràng buộc là object (giới hạn bởi body limit Fastify); chưa kiểm cấu trúc bên trong vì S4/A5.1 mới tiêu thụ.
- Phase03-owner review vẫn bắt buộc theo memo.

---

# Fix round 1/5 (I1, M1, M2, M3)

**Status: DONE.** Node v24.21.0. Slot nặng giữ từ lúc lấy (gate lần đầu đã đạt: pressure 1, available 4.57 GiB, idle 79.8%, disk 753 GiB), trả sau cleanup. PG `postgres:18.6` riêng, 256m/1 CPU/pids 64 (inspect 268435456/1000000000/64), loopback ngẫu nhiên; dừng bằng `docker stop`, `docker ps -a --filter name=` rỗng, không còn `node --test` (`task-s3b-fix1-cleanup.log`, `task-s3b-fix1-resource.log`). NODE_OPTIONS=--max-old-space-size=384.

## Sửa gì

- **I1** `server/src/gateway/contracts.ts`: `renderSchema` đóng theo `RenderDefinition` (source, projection đầy đủ, `selectedProjectionSha256` map path -> digest tối đa 2000, `layers` chỉ 7 path chính thức, mỗi giá trị digest hoặc null, không trường lạ). Hình dạng sai là 400 ở schema nên `canonicalJson(undefined)` không còn chạm được.
- **M1** `gateway/src/sync/gateway-sync.ts`: `definition()` chỉ nuốt `WORKFLOW_DEFINITION_UNAVAILABLE`. Lỗi khác làm slot thành `state:'error'`, `installed:null`, `lastError.code='DEFINITION_FAILED'`, message chứa mã lỗi chỉ khi khớp `^[A-Z][A-Z0-9_]{0,63}$`, ngược lại ghi `UNKNOWN` (không lộ đường dẫn).
- **M2** `server/src/gateway/service.ts`: slot bị hạ vì definition nhận `lastError={code:'DEFINITION_MISMATCH', message:'Definition workflow không khớp pin đã cài'}` (không ghi đè lastError sẵn có).
- **M3** File mới `v2/gateway/test/fixtures/workflow-definitions/install-report-vector.json` (sinh bằng `createWorkflowManifest(...).loadDefinition` thật trên fixture official: Superpowers claude và BMAD claude có `render`). Test gateway so sánh output hiện tại với file (cờ `CREW_UPDATE_DEFINITION_VECTOR=1` để sinh lại); test server đọc đúng file này và đòi `accepted=true`, lưu nguyên bản.

## Test bao phủ mới

| Test | Phủ |
|---|---|
| server `render sai hình dạng ... không bao giờ 500` | 13 biến thể (`{}`, thiếu source/projection/layers, trường lạ, null, mảng, chuỗi, digest sai, layer path lạ, layer digest sai, source/projection sai kiểu) đều 400; render đúng hình nhưng thuộc pin khác là 200 `accepted=false` |
| server `từ chối definition lệch pin` (mở rộng) | `lastError.code === DEFINITION_MISMATCH` cho cả 4 loại mismatch |
| server `golden vector chung` | definition thật của gateway (Superpowers + BMAD render) được nhận và lưu nguyên; đổi 1 layer digest trong render thì `accepted=false` |
| gateway `golden vector` | output `loadDefinition` thật khớp byte với JSON committed, BMAD có `render`, Superpowers không |
| gateway `integrity failure ... error slot` | `WORKFLOW_SKILL_MISMATCH` -> error + `DEFINITION_FAILED` kèm mã; lỗi lạ -> `UNKNOWN` không lộ `/secret/path`; `WORKFLOW_DEFINITION_UNAVAILABLE` -> vẫn `current` không trường |

## RED (nguồn ở c184944, chỉ tests mới)

Server `gateway.test.ts`: 27 test, 25 pass, **2 fail** (render sai hình dạng; thiếu `DEFINITION_MISMATCH`), exit 1. Gateway `sync.test.ts`: 8 test, 7 pass, **1 fail** (integrity failure bị nuốt), exit 1. Golden vector (cả hai phía) pass ngay vì công thức đã tương thích; đây là guard hồi quy, không phải RED. Log: `task-s3b-fix1-red-server.log`, `task-s3b-fix1-red-gateway.log`. Dựng RED bằng cách chép 3 file nguồn sang scratch, `git show HEAD:` đưa về c184944, chạy, chép nguyên bản lại (không stash/revert Git).

## GREEN

| Lệnh | Kết quả |
|---|---|
| `node --test --test-concurrency=1 --test-timeout=60000 v2/server/test/gateway.test.ts v2/server/test/model-certification.test.ts v2/server/test/model-pool.test.ts` (PG riêng) | 40/40 pass, exit 0 |
| `node --test --test-timeout=120000 test/sync.test.ts test/workflow-manifest.test.ts test/render-artifacts.test.ts` (trong v2/gateway) | 46/46 pass, exit 0 |
| gateway `pnpm exec tsc --noEmit` | exit 0 |
| server scoped strict tsc (cùng 3 file .d.ts + service.ts, contracts.ts, test/gateway.test.ts) | exit 0 |
| Biome 2.5.14 `check` trên src/gateway, server test, gateway sync/commands, sync.test.ts | exit 0, 12 warning, toàn bộ là 12 warning cũ của các test có sẵn (`noExplicitAny`/`noNonNullAssertion` ở các test trước), code mới 0 |
| docs mirror (`git archive` + overlay) | `generate` unchanged, `check --all` ok, `check --staged` ok |

Log: `task-s3b-fix1-green-server.log`, `task-s3b-fix1-green-gateway.log`, `task-s3b-fix1-tsc-*.log`, `task-s3b-fix1-biome.log`.

## SHA256 sau fix

| File | SHA256 |
|---|---|
| `v2/server/src/gateway/service.ts` | `f142cef646cfbde81b8fddb3db372c5448ec032986eba6a4769e1a6d60d385a6` |
| `v2/server/src/gateway/contracts.ts` | `ddecd7c260d1d04e21cd99e8e2638f2b4a15f43106d85faadba1e9647c130313` |
| `v2/gateway/src/sync/gateway-sync.ts` | `6fced9c8d9be1d8ec2b120a4527443b9b0466a9397783130597dbbfe59c5dbec` |
| `v2/server/test/gateway.test.ts` | `5daa049b0c7e86986644fc11338d47ff3fb4b7c9c666ed38e9d707cd82e32ac4` |
| `v2/gateway/test/sync.test.ts` | `49e2ded875a594d4dd0f62543d018113bdc0481cdb87a2e218b6c44cce74a987` |
| `v2/gateway/test/fixtures/workflow-definitions/install-report-vector.json` | `1bd0a6df9a39d4c6d90e02f5f214b694c72d57a859896c3780880484aa2228d1` |

## Ghi chú

- File mới duy nhất: `install-report-vector.json` (fixture test, thuộc cùng nhóm fixtures của flow gateway-host; `check --all` ok). Helper sinh vector nằm trong `sync.test.ts`, không có support module mới.
- Flow docs cập nhật: `server-gateway.md`, `gateway-host.md`.
