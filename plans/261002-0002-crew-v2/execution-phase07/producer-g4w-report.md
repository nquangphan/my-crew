# Producer G4w - ba switch nguồn runtime

BASE: ab4750713f5adb1736032222c8a2ce89eb768cb1.

## Quyết định lưu trữ (đính chính tiền đề)
Ba switch desired Claude/Codex/API **đã tồn tại** từ migration 008: bảng `model_source_configs` (`enabled jsonb` ba khóa boolean, CAS `revision`), owner `PUT/GET /v2/machines/:id/model-sources` (desired tách khỏi `applied` từ `model_source_applied`), command `sync_models`, và gateway `v2/gateway/src/models` đã áp `enabled[runtime]` (inventory/reporter/credential bỏ qua nguồn OFF, không đụng attempt đang chạy). Thêm `sources` vào config gateway sẽ tạo hai authority cho cùng một thứ, nên KHÔNG thêm; không cần migration, không sửa gateway-sync.ts. Pool SQL (008) đã đòi `gc.enabled` và `mc.enabled->>runtime`.

## Phần thật sự còn thiếu, đã làm
- `isSourceEnabled(tx, machineId, runtime)` (gateway/service.ts, đọc thuần, chưa nối admission): false nếu chưa có gateway config hoặc `enabled` của máy tắt; nếu có `model_source_configs` thì theo `enabled[runtime]`; **quy tắc tương thích**: máy chưa có source config (cấu hình cũ) suy mọi nguồn từ cờ `enabled` của máy (tức true).
- Retry `POST /v2/gateway/machines/:id/workflows/retry` nhận thêm `runtime?: claude|codex|api` (additive); có `runtime` mà nguồn OFF hoặc máy tắt → 409 `CONFIG_DISABLED` (không xếp command); không có `runtime` giữ hành vi cũ.
- Docs: v2/docs/flows/server-gateway.md; `crew-docs generate` unchanged, `check --all` ok.

## RED/GREEN
RED ngữ nghĩa (scaffold giữ hành vi cũ: chỉ cờ máy): 1 test mới fail do assertion deep-equal [true,false,false] (log `/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T//crew-v2-g4w/red.log`, lần đầu fail do setup 007 thiếu bảng nên đã sửa fixture lên 008, không tính RED). GREEN: gateway-owner-read + gateway + model-pool = 46/46 pass, exit 0. tsc: lỗi sẵn có chỉ ở attachments/pdf (thiếu pdf-lib), 0 lỗi ở gateway. Biome sạch.

## Hash (12 ký tự đầu sha256)


## Tài nguyên / dọn dẹp
Slot nặng lấy/trả bằng mkdir/rm -rf. PG postgres:18.6 `crew-v2-test-257e5bc7-32c1-44d3-be19-facaace0775e` 256m/1CPU/pids64, loopback 54296; `docker rm -f` rồi lọc docker ps -a: 0 dòng. Scratch `/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T//crew-v2-g4w` (log).

(Hash bên dưới tính trước commit.)
- addfddf2fad5  v2/server/src/gateway/contracts.ts
- 7947f8d36926  v2/server/src/gateway/routes.ts
- 323c3155214e  v2/server/src/gateway/service.ts
- c7500c4645c5  v2/server/test/gateway-owner-read.test.ts
- c670d178599c  v2/docs/flows/server-gateway.md
