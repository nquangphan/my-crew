# Producer P-G4r: đọc owner cho máy và workflow (gate G4, phần đọc)

BASE `746083ce4f69e8a70936b26ddda1446825c6e185`, nhánh `codex/crew-v2-server`. Chỉ additive: không migration, không đổi `body_hash`/`same()`/chấp nhận install report. Mọi route dưới đây là owner session; machine bearer nhận 403, không cookie 401.

## Endpoint cho web

| Method và path | Request | Response |
|---|---|---|
| `GET /v2/gateway/machines/:id/status` (mở rộng) | không | Trường cũ giữ nguyên, thêm `hostVersion: string\|null`, `appVersion: string\|null`, `observedAt: string\|null` (giờ host báo, chỉ tham khảo), `telemetry: {cpuLoad1,cpuCount,memoryAvailableBytes,memoryPressure,diskAvailableBytes,activeJobs,configuredMaxJobs}\|null`. Lấy từ heartbeat cuối của boot hiện hành; chưa heartbeat hoặc boot mới thì null (giống `lastTelemetryAt`). Online vẫn theo `serverConnection`/`receivedAt`. |
| `GET /v2/gateway/machines/:id/workflows` | không | `{machineId, desiredConfigRevision, appliedConfigRevision, latestReport:{reportId,configRevision,accepted,receivedAt}\|null, official:{bmad,superpowers:{version,sourceRevision,allowedSourceUrls[]}}, workflows:{bmad,superpowers:{source:{desired,installed,state,verdict,versionMismatch,lastError,observedAt}, projections:{claude,codex,api:{desired,installed,state,verdict,definition,lastError,observedAt}}}}}`. `verdict` là `match\|mismatch\|not_installed\|installing\|error\|not_desired`, so với desired hiện tại, không suy từ `appliedConfigRevision`. `definition` chỉ khác null khi slot `current`, installed bằng đúng desired source/projection và digest canonical khớp. 404 máy lạ. |
| `POST /v2/gateway/machines/:id/workflows/retry` | CSRF + `Idempotency-Key`; body `{expectedRevision: 1..2147483646}` (đóng) | 200 `{created, configRevision, command}`. Chưa có config 409 `CONFIG_NOT_CONFIGURED`; revision lệch 409 `CONFIG_REVISION_CONFLICT`; body thừa/thiếu 400. Đã có `sync_workflows` chưa completed cho revision đó thì `created:false` kèm command ấy. Ngược lại xếp `sync_workflows {configRevision}` mới (cursor 007, event `gateway.command.created`). |
| `GET /v2/gateway/machines/:id/commands?before=<cursor>&limit=<1..100>` | mặc định limit 50 | `{items: GatewayCommand[] (mới nhất trước, có state/result/time), nextBefore: string\|null}`. Result đã được làm sạch ở ACK. 404 máy lạ, 400 cursor/limit sai. |

Gợi ý cho web: workflow panel dùng `verdict` + `versionMismatch` + `latestReport.accepted` (phân biệt partial); "pending vs applied" so `desiredConfigRevision` với `appliedConfigRevision`; nút Cài lại gọi retry với `desiredConfigRevision`, nút Cập nhật vẫn dùng PUT config khi desired đổi.

## Quyết định thiết kế

- `service.ts` rút bảng release chính thức thành `officialReleases`/`officialSourceUrls` dùng chung cho validate và catalogue, hành vi validate không đổi (gateway.test.ts 27/27). Export thêm `definitionMatches`, `mapCommand`.
- Retry dùng cùng khóa máy và `authorizeGatewayMutation` như PUT config. Không chặn theo `enabled` (OFF không phải gỡ cài).

## RED / GREEN

- RED: cây BASE (git archive) cộng file test mới: 6 test, 0 pass, 6 fail, đều lỗi hành vi (trường undefined, route 404), không phải lỗi setup. Exit 1.
- GREEN: `gateway-owner-read.test.ts` 6/6 exit 0; `gateway.test.ts` 27/27 exit 0; hồi quy liên quan (api-acceptance, auth, model-pool, model-secret, model-current-credentials, model-certification) 48/48 exit 0.
- `tsc --noEmit` v2/server: chỉ còn lỗi có sẵn `pdf-lib` (pdf.ts, attachments-pdf-image test), không từ gateway. Biome check sạch trên gateway và test mới. `crew-docs check --all` ok.

## Hash

| Tệp | SHA256 |
|---|---|
| catalogue.ts | `4da0e340b16a18ec339c345c0277af07f33dbc67250d09b9dbf886cd563dcda7` |
| contracts.ts | `f7f3dc1c523b1b1d884682db9f4cbeec7c3ba077cbb0717c7514d6ab61058fd8` |
| routes.ts | `ab89eb646b96edbe9b055e56f68ab5cdda824d9e291b105e49cda8e40caf4b02` |
| service.ts | `086d2aa3369411de2555aea7b88049cee39910d9b5e455641af73fcfde754646` |
| gateway-owner-read.test.ts | `5ea125974c1dd82f39816e9f6e8ce74c854bcd59c3d1fa4875a4ff3ca74421a5` |
| red.log | `912cb6dbfab2dbc838b2841d9b9aa4c3668b8096e55302b04bf13822ac48803c` |
| green-gateway-owner-read.log | `a6241af744e2641e7d7024326e553e19f804679e8f2b7b0e2d1714998229715a` |
| green-gateway.log | `2c73ec5ed78b1bc30e71acb91f6662931c05dc61c519d37310758a4451ac993b` |
| green-related.log | `0921f750ac6fc26aa643d8cfabd9228a378f7213b002d7d4dbcd910451991007` |

Log thô ở `$TMPDIR/crew-v2-g4r/` (không commit).

## Tài nguyên và dọn

Slot nặng lấy lúc telemetry heavyEligible (5.04GiB, pressure 1, idle 76.8%), trả lại bằng `rm -rf` đúng lock. Postgres 18.6 `crew-v2-test-<uuid>` (ID `1e229e32...c4a`), memory 268435456, 1 CPU, pids 64, loopback 64026; dùng ~66MiB. Đã `docker stop` (--rm), `docker ps -a` lọc tên còn 0. Node heap 384, concurrency 1. Không đụng container/log của bên khác. Manifest lock chỉ giữ lúc generate/commit.

## Còn chờ

- Đọc key credential active: chờ phase04 Keychain, chưa làm.
- Digest pin chuẩn (payload/tree/projection) server không có; web chỉ dùng pin đã nằm trong desired hoặc máy đã báo cài. Nếu muốn nút "cài bản chuẩn" từ trống cần nguồn pin tin cậy (gateway hoặc bảng seed), cần quyết định riêng.
- Owner đọc command/attempt thực thi ticket (G5) không thuộc slice này; chỉ đọc command máy gateway.
