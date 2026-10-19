# Review PG-2 (gói plugin đợt 2) — 07/10/2026, Asia/Ho_Chi_Minh

Diff `d9ff72dee..5956d62d7` (`2b382bb` đánh thức integrator, `5956d62` so inode). Không chạy lại test (log report khớp SHA; mọi kiểm bên dưới đọc từ nguồn).

## Verdict: CHANGES_REQUESTED (1 major sửa một dòng, 3 minor)

Số finding: critical 0, major 1, minor 3.

## Kiểm cụ thể

1. **Payload `issue.updated`: thật nhưng có sắc thái.** `routes/issues.ts:13955-13987`: payload = `updateFields` (có `status` chỉ khi client gửi) + `identifier` + `_previous` = map `changes[key].from`, **chỉ chứa field thực sự đổi** (`_previous` là `undefined` khi không field nào đổi). `activity-log.ts:198-205` đưa nguyên `details` vào `payload`. Nghĩa là chuyển `in_review -> done` có `_previous.status = "in_review"` (đúng như code giả định); các đường khác (`recovery_action_resolution` 9528, `request_confirmation_accept` 16239, `auto_approval_comment` 17728) cũng ghi `status` và `_previous.status`. Nhưng PATCH `status: "done"` lên issue **đã done** cho ra `payload.status = "done"` mà **không có `_previous.status`**.
2. **Idempotent: đúng cho đường chính, hở ở ca trên (xem M1).** Khóa state `{issue, issue.id, "integrator-wake"}` = `completedAt` ISO; cùng vòng thì bỏ, mở lại rồi `done` lần hai thì `completedAt` mới nên gọi lại (test có). Ghi mốc chỉ sau `invoke` thành công nên lỗi thì lần sau thử lại. Không gọi lặp theo từng `issue.updated` thường (lọc `status === done` + `_previous`).
3. **Không đánh thức khi không phải gốc Crew: đạt.** Bỏ khi có `parentId`, khi policy không đúng 3 stage `review/review/approval`, hoặc stage hai không có đúng một participant agent; đọc lại issue và phải còn `done`. Giới hạn đã ruling: policy ba stage tương tự do board đặt ở company không dùng Crew vẫn bị đánh thức với prompt merge (chấp nhận theo ruling của lead, ghi nhận).
4. **Capability.** `plugin.state.read/write`: cần (`host-client-factory.ts:393-395`, `ctx.state.get/set`). `agents.invoke`: cần (`:492`). `agents.read`: **không cần**, `agents.invoke` chỉ gate theo `agents.invoke` và code không gọi `agents.get` (m1). Triển khai: `plugin-loader.ts:2269` làm mới manifest từ đĩa mỗi lần activate; chặn capability mới ở `distributionPluginActivationGuard` chỉ áp khi gói nằm trong catalog distribution, mà `/app/packages/crew-plugin` ở ngoài (guard `return` sớm, `distribution-plugin-catalog.ts:73`), nên capability mới được nhận sau restart, không cần duyệt. `upgradePlugin` (`:1840`) mới chặn "escalation", nhưng deploy không đi đường đó. Kiểm lại ở D1: manifest trong DB phải có 4 capability mới (`GET /plugins/crew.core`).
5. **Lỗi `invoke` không spam: đạt có điều kiện.** `invoke` lỗi (agent paused/terminated, `Agent wakeup was skipped by heartbeat policy` ở `plugin-host-services.ts:2809-2832`) chỉ sinh một comment cho mỗi sự kiện kích hoạt, không ghi mốc nên lần `done` kế thử lại; cùng điều kiện đó khiến M1 cũng lặp comment.
6. **So inode `-ef`: portable.** `-ef` có trong bash 3.2 (macOS), 5.2 (Ubuntu 24.04), `dash`, coreutils; hai script đều `#!/bin/bash`. Theo symlink, cùng inode với mọi cách viết hoa thường trên APFS; thiếu file thì false (an toàn: vẫn thoát 70). `cd "$ROOT"` sau đó đúng ý. Không có vấn đề.

## Finding

### Major
- **M1. `done -> done` đánh thức lại integrator.** `packages/crew-plugin/src/integrator-wake.ts:46` (`if (payload._previous?.status === "done") return;`) chỉ chặn khi `_previous.status` có mặt, nhưng khi status không đổi thì `_previous` không có (mục 1). Trong khi `services/issues.ts:10752` (`applyStatusSideEffects`) đặt `completedAt = new Date()` cho mọi PATCH có `status: "done"`, kể cả issue đã done (route không cắt status không đổi). Kết quả: PATCH `done` lặp (owner bấm lại, integrator hay executor PATCH `done` sau khi merge xong) sinh `completedAt` mới, qua cổng idempotent và gọi integrator lần nữa: có thể thành vòng lặp tốn run, và nếu `invoke` lỗi thì lặp comment. Sửa: yêu cầu chuyển trạng thái thật: `const from = payload._previous?.status; if (typeof from !== "string" || from === "done") return;` (mọi đường chuyển sang `done` thật đều có `_previous.status`, mục 1). Thêm test: `emit("issue.updated", { status: "done" }, …)` không có `_previous` thì `invoked` rỗng, và `_previous.status` khác done mà `completedAt` đã ghi mốc thì không gọi.

### Minor
- **m1. Bỏ `agents.read` khỏi `manifest.ts`** (không dùng, report cũng nhận). Đặc quyền thừa; test bundle so manifest nguồn nên bỏ không ảnh hưởng.
- **m2. Lần wake không mang issue context.** `invoke` chỉ truyền `prompt` (`plugin-host-services.ts:2815-2830` không có `issueId`/`taskId`), nên run của integrator không có issue được checkout sẵn và dựa hoàn toàn vào identifier trong prompt (`crew/req/<id>`). Ổn nếu instructions integrator tự tìm issue theo identifier; xác nhận ở Cổng 4 rằng run thấy prompt (`paperclipAgentMessage`).
- **m3. Lỗi trong nhánh `catch`** (`createComment` ném) hoặc `ctx.state.set` ném sau khi `invoke` đã thành công thì handler lỗi, chỉ bus ghi warn; ca sau có thể gọi trùng lần sau. Xác suất thấp, chấp nhận hoặc bọc `set` trong try.

## Khác
- Test mới tốt ở các ca idempotent, vòng mới, issue con/không template, mở lại trước khi sự kiện tới, lỗi invoke rồi retry; thiếu ca M1.
- `5956d62` không có vấn đề, ruling cuối ledger khớp code.

## Câu hỏi còn mở
- Không.

## Review sau review toàn nhánh (diff `e346fb136..2606ab3f0`, chỉ M3 và m1; 07/10/2026)

Không chạy lại test (cùng SHA với report; chỉ đọc nguồn và đối chiếu `crew/r1-2`).

### Verdict: CHANGES_REQUESTED (1 major vận hành, 2 minor; critical 0)

### Kiểm cụ thể
1. **Override `COMPOSE_FILE` không làm hỏng project hiện có: đạt về cấu trúc.** `policy-env.sh` đặt `COMPOSE_FILE=docker-compose.yml:docker-compose.crew-policy.yml` sau `cd /opt/crew-v3-spike`. Project name Compose lấy từ thư mục của file đầu tiên (`crew-v3-spike`, không đổi); override chỉ khai `services.server` thêm một biến `environment` và một `volumes`, không đổi tên service/volume nào, và `up -d --no-deps server` không đụng service khác. Danh sách `volumes` được merge theo target (`/crew-policy` không trùng mount nào), `environment` dạng map hay list đều merge được. Compose project khác của prod trên VPS không bị ảnh hưởng: biến chỉ `export` trong shell của `deploy.sh`/`rollback.sh` và đường dẫn tuyệt đối cố định. `restore-drill.sh` dùng `-p`/`-f` riêng nên không dính. Test chỉ kiểm nội dung file override, chưa kiểm merge thật bằng `docker compose config` (chưa chạy được ngoài VPS; kiểm tại D1: `docker compose config` trong `/opt/crew-v3-spike` có `CREW_POLICY_CONFIG` và mount).
2. **Mount `:ro` ngoài thư mục dữ liệu: đạt.** `/opt/crew-v3-spike/crew-policy:/crew-policy:ro` (thư mục, không phải file đơn lẻ nên cả ghi tại chỗ lẫn `mv` đều hiện ra), tách khỏi `data/`.
3. **Thoát 7/8 và đường lùi: đạt, có minor m-b.** Thoát 7 xảy ra trước `backup.sh`, trước khi sửa compose và trước khi đổi container, nên không có gì để lùi. Thoát 8 sau khi server đã đổi image, kèm lệnh `rollback.sh $TS`. Chuỗi kiểm khớp code `crew/r1-2`: `server/src/crew/issue-policy.ts:235` ghi cảnh báo `gate Crew` (warn), `:239` ghi `crew policy config enabled` (info) ngay lúc nạp module khi khởi động, trước khi `/api/health` ok; container vừa tạo mới nên `docker logs` chỉ có lần khởi động này.
4. **`rollback.sh` giữ mount: đạt.** Compose khôi phục (`.bak-$TS`) không có mount, script ghi lại override nếu `policy-config.py file` đạt, nếu không thì cảnh báo "gates off" rồi vẫn khởi động (hợp lý: đường lùi không bị chặn). Image cũ bỏ qua biến lạ.
5. **m1: đạt.** `crew/r1-2` có đúng 3 dòng `crewCoreHooks` trong `services/issues.ts` (9639 H4, 10779 H2, 13230 import), nên `=3` đúng; `inspect-image.sh` in `issues.js FAIL` và `deploy.sh` kiểm `^issues crewCoreHooks=3$` (2 hoặc 4 đều bị từ chối). Lưu ý: nhánh `crew/r12-plugin` hiện chỉ có 2 dòng vì H4 nằm ở nhánh policy; con số 3 đúng sau tích hợp. Thêm hook thứ 4 ở `issues.ts` về sau sẽ buộc đổi hằng này (chủ ý, ngân sách 5 hook).

### Finding
- **M-1 (major, vận hành): `COMPOSE_FILE` chỉ sống trong shell của deploy/rollback.** Mọi lệnh `docker compose up -d`/`--force-recreate` chạy tay trong `/opt/crew-v3-spike` (không có biến) sẽ tạo lại `server` **không có mount và không có env**, gate Crew tắt mà server vẫn báo healthy: đúng loại lỗi mà thoát 8 sinh ra để chặn, nhưng ở đường không đi qua `deploy.sh`. Sửa: ghi dòng `COMPOSE_FILE=docker-compose.yml:docker-compose.crew-policy.yml` vào `/opt/crew-v3-spike/.env` (Compose đọc `.env` cùng thư mục) một cách idempotent trong `write_policy_override` (kiểm dòng đã có, không đè biến khác), hoặc gộp phần override vào chính `docker-compose.yml` ở D1. Tối thiểu: ghi vào runbook D1 "chỉ recreate server bằng deploy.sh/rollback.sh".
- **m-a. Log `enabled` không chứng minh container đọc được file.** `issue-policy.ts:231-239` chỉ kiểm env đã đặt, còn file được đọc lười theo từng company (`:145`). Exit 7 kiểm bằng user trên host; nếu file/thư mục không đọc được bởi user `node` trong container (quyền 600 hoặc sở hữu root), gate vẫn fail closed ở runtime mà deploy báo thành công. Sửa: sau health, thêm `docker exec crew-v3-spike-server-1 test -r /crew-policy/crew-policy.json` (hoặc `node -e` đọc JSON) trước khi in thành công, thoát 8 nếu hỏng; hoặc ghi chú đặt `chmod 644` khi `apply-roles.sh policy-config` ghi file.
- **m-b. Phụ thuộc mức log.** Dòng `enabled` ở `info`; nếu `LOG_LEVEL` của server cao hơn `info` thì deploy báo nhầm exit 8 (fail an toàn, không dương tính giả). Ghi vào runbook hoặc chấp nhận.

### Ghi nhận
- `policy-env.sh` và `policy-config.py` phải được chép lên `/opt/crew-v3-spike/ops/` cùng `deploy.sh`/`rollback.sh` (như m5 cũ); thiếu thì `deploy.sh` dừng sớm do `. policy-env.sh` thất bại dưới `set -e`, trước khi đổi gì.
- Test `policy-config.test.mjs` bao đủ file hợp lệ/lỗi, log khởi động (kể cả `enabled` kèm `off`) và nội dung override.
