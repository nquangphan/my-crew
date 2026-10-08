# UI-1 — khung UI plugin crew.core

Status: DONE_WITH_CONCERNS

## SDK và host đã đối chiếu

- `PaperclipPluginManifestV1` hỗ trợ `entrypoints.ui`, `ui.slots` loại `detailTab` có `entityTypes`, `webhooks` qua `endpointKey`, `database.migrationsDir` và `coreReadTables`. Capability dùng đúng tên trong `PLUGIN_CAPABILITIES`. Nguồn: `packages/plugins/sdk/src/types.ts`, `packages/shared/src/{validators/plugin.ts,constants.ts}`, kitchen-sink và llm-wiki manifests.
- UI dùng `usePluginData` và component host `DataTable`, `StatusBadge`, `Spinner` từ `@paperclipai/plugin-sdk/ui`. SDK thật không có `usePluginHostComponents`; import trực tiếp là cơ chế trong `doc/plugins/PLUGIN_SPEC.md` §19 và ví dụ kitchen-sink. Bundle ESM external React, react-dom, react/jsx-runtime và SDK UI.
- Bridge `getData` của host kiểm quyền company, chuyển `companyId` từ context vào params của handler. Handler `crew.map` đối chiếu company đó với issue trong DB. `ctx.db.query` chỉ SELECT bảng lõi được khai trong allowlist. `ctx.issues.getSubtree` và relations cũng có trong SDK, nhưng map dùng query SQL để lấy cả execution JSON và comment cho cạnh repair trong một lần đọc.
- Webhook stock nhận raw body và headers, ghi delivery trước khi gọi `onWebhook`; handler ném lỗi thì host ghi delivery `failed` và trả 502. `ctx.config.get(companyId)` cần company ID tường minh; `ctx.secrets.resolve(ref,{companyId})` chỉ nhận object `secret_ref` bound với plugin/company. Nguồn: `doc/plugins/PLUGIN_SPEC.md` §18, `server/src/routes/plugins.ts`, `packages/plugins/sdk/src/{define-plugin.ts,host-client-factory.ts}`.
- Host config UI tạo object `{type:"secret_ref",secretId,version?}`; Ajv kiểm `instanceConfigSchema` trước khi lưu. Schema giữ `format:"secret-ref"` cho picker và `type:"object"` cho giá trị thật. Test gọi validator host thật để chứng minh config hợp lệ.

## Đã làm

- Manifest có đúng một slot `detailTab`: `crew-issue`, export `CrewIssueTab`; hai webhook `machine-status`, `docs-snapshot`; schema config `companies:[{companyId,webhookSecretRef}]`; migration directory và sáu bảng lõi đọc được. Slot `page` và `dashboardWidget` thuộc UI-2/UI-4, chưa khai.
- `features.ts` đăng ký `crew.map`; worker giữ handler `agent.run.cancelled` và có dispatcher `onWebhook` để UI-3/UI-4 gắn handler thật. UI-1 không ghi machine/docs report.
- `verifyCrewSignature` dùng HMAC-SHA256 trên `<timestamp>.<rawBody>`, giới hạn ±300 giây và `timingSafeEqual`. Vector cố định: `6ee0c20d3f215ce4a77295bac40239010978f18848bf25541d7bb317e3358411`.
- `authenticateCrewWebhook` kiểm byte limit → header/thời gian → chọn company từ JSON chưa tin cậy → đọc config theo company → resolve secret mỗi lần → HMAC → envelope version 1. Trả mã lỗi lý do, không gọi DB. Handler UI-3/UI-4 sẽ validate schema riêng của từng bản tin trước khi ghi.
- `crew.map` đi từ issue hiện tại tới gốc, đọc subtree có ràng buộc company, lấy cạnh parent từ `parent_id`, dependency từ `issue_relations` loại `blocks`, repair từ marker `crew-fix base=<sha>` ghép comment `crew-commit sha=<sha>`; vòng reviewer hiện bằng cạnh repair tự nối. Stage từ `executionState`, vòng sửa từ `changesRequestedCount`, giới hạn từ policy (mặc định stock 3).
- `CrewIssueTab` là component thật: tải map, hiển thị bảng nút và danh sách cạnh, vị trí issue con, trạng thái tải/lỗi trong tab. Issue không có policy Crew được báo riêng.
- Build xuất `dist/ui/index.js`; overlay chép cả `dist` lẫn `migrations`; `inspect-image.sh` kiểm UI bundle và in kích thước gzip.

## TDD và xác minh

- Đỏ: sau khi viết test, Vitest báo không tìm thấy `shared/signature.js` và `data/map.js` (2 suite fail). Sau triển khai lần đầu, test DB thật báo map CRE-36 có 0 nút vì JSONB trả về dạng string; sửa parser JSONB rồi xanh.
- Xanh: `corepack pnpm --filter @crew/paperclip-plugin test` — 9/9 test, gồm PostgreSQL embedded dựng CRE-36 (gốc bốn stage xong, ba con, CRE-37 blocks CRE-38, marker bundle) và CRE-44 (issue gốc, con gốc, issue fix và hai vòng sửa). Test còn kiểm company khác bị từ chối, signature, webhook auth và schema config host.
- `corepack pnpm --filter @crew/paperclip-plugin typecheck` — đạt.
- `corepack pnpm --filter @crew/paperclip-plugin build` — đạt. `dist/ui/index.js`: 2.866 byte thô, 1.191 byte gzip (dưới 1,5 MiB).
- `node --test crew/ops/*.test.mjs` — 23/23 đạt. `bash -n` / `sh -n` cho ba script sửa — đạt.
- `node crew/release/check-core-hooks.mjs` — hook 5/5, lỗi 0 (cảnh báo PR upstream sẵn có).
- `git diff --check` — đạt. Trước test embedded PostgreSQL, `ipcs -m` có 5 segment, không cần gỡ.
- Vì thiếu `node_modules`, đã chạy `corepack pnpm install --frozen-lockfile` đúng một lần.

## Concerns

- Chưa có image được build trong phạm vi local; không chạy `inspect-image.sh` trên image thật và không SSH/deploy theo chỉ dẫn. Script đã được sửa để kiểm file trong image khi giai đoạn tích hợp chạy.
- UI-3/UI-4 sẽ thêm handler webhook ghi DB và migration; trước các ticket đó, webhook đã khai nhưng dispatcher sẽ ném lỗi “chưa có handler”, host trả 502.

Commit: `8567eac5b` — `feat(plugin): add Crew issue tab and map data`. Không push.
