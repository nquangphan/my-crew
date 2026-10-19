# Review PG-1 (gói plugin) — 07/10/2026, Asia/Ho_Chi_Minh

Diff `e1c3dd2db..e02e83f00`. Không chạy lại test (log report khớp SHA `e02e83f00`). Chỉ kiểm tay thêm bằng bundle sẵn có trong worktree.

## Verdict: APPROVE

Số finding: critical 0, major 0, minor 4. Không có lỗi chặn. Bốn minor nên xử lý trước hoặc tại D1, không cần sửa lại task.

## Kiểm cụ thể

1. **Bỏ tsx loader: đạt.** `packages/crew-plugin/dist/worker.js` (1,29 MB) không còn `__dirname`/`__filename`, không còn `require("<non-node>")`. Banner `createRequire` đủ cho builtin. Em spawn `node ./dist/worker.js` bằng node thường (không `--import` loader): tiến trình sống ổn định sau 2,5 giây, không lỗi. `manifest.ts` chỉ import type nên bundle manifest 559 byte. Plugin-loader vẫn chèn `--import` khi file loader tồn tại, bundle chạy được cả hai trường hợp.
2. **`overlay-source.sh`: đạt.** `crew/ops/overlay-source.sh:5` `FORK=$(cd "$(dirname "$0")/../.." && pwd -P)`, không còn đường dẫn cứng; mặc định `HEAD`. Kiểm sạch cây và `HEAD == COMMIT` (dòng 13-14) chạy trước bước build, nên dist build từ đúng commit. Chỉ copy `package.json` + `dist` vào overlay.
3. **`deploy.sh`/`rollback.sh`: đạt, có minor.** `deploy.sh:29-36` lặp 30 lần x 2 giây (60 giây), thoát 6 kèm lệnh rollback khi không healthy. `rollback.sh` không có vòng chờ plugin, chỉ in trạng thái một lần (`rollback.sh:19-20`), vòng chờ server bị chặn 60 lần và thoát 3 khi không ok, nên **không bị kẹt**. Sai JSON, api.sh lỗi, plugin không tồn tại đều ra `P` rỗng rồi `|| true`, không chết vì `set -e`/`pipefail`. Biểu thức python `"healthy" if healthy else (status or "unknown")` đúng. Route `/plugins/:pluginId/health` nhận plugin key và trả `healthy` (`server/src/routes/plugins.ts:2103-2151`).
4. **`inspect-image.sh`: đạt.** Liệt kê đúng 8 file Interface: `core-hooks remote-stop load-gate ssh-in-place issue-policy issue-gate issue-create-policy retry-progress`. In `plugin bundle ok; manifest crew.core …` hoặc `plugin bundle FAIL`; `deploy.sh:13` chặn theo `MISSING|FAIL`.
5. **`ensure-build-deps`: không nặng VPS.** `overlay-source.sh` chạy trên máy dev, tar rồi scp lên VPS. `overlay-job.sh` trên VPS chỉ esbuild từng file server và `docker build`, đã bỏ symlink SDK. Cái giá chỉ là build SDK mỗi lần trên máy dev.

## Finding

### Minor

- **m1. Health plugin có thể dương tính giả ngay sau restart.** `crew/ops/deploy.sh:30-33`: route health chỉ đọc `plugin.status === "ready"` trong DB (`plugins.ts:2120`), không hỏi worker. Trạng thái `ready` còn từ trước restart nên vòng đầu có thể pass trước khi worker nạp bundle; nếu bundle hỏng thì status mới chuyển `error` sau đó và deploy đã báo thành công. Sửa: chờ thêm vài giây rồi đọc hai lần healthy liên tiếp, hoặc gọi `/plugins/crew.core/dashboard` (có chẩn đoán worker, `plugins.ts:2981`) kiểm worker đang chạy. Với D1, owner/AC-2 phải tự chạy lại `./api.sh GET /plugins/crew.core/health` sau vài giây (plan đã có sẵn bước này).
- **m2. Cú pháp `api.sh` chưa kiểm.** `crew/ops/deploy.sh:31`, `rollback.sh:19`: Step 9 yêu cầu đọc `/opt/crew-v3-spike/api.sh`, báo cáo nói không đọc vì luật cấm SSH (ghi rõ ở "Giả định", không giấu). `api.sh` không nằm trong repo; bằng chứng gián tiếp (`plans/261006-1355-crew-v3-r1-1/runtime.md:1784-1863`) cho thấy dạng `./api.sh GET /issues/...` không có tiền tố `/api` và dùng được với `/plugins/...`. Rủi ro còn lại: nếu sai thì `deploy.sh` luôn thoát 6 (fail an toàn, không dương tính giả). Xác nhận tại D1 bằng một lần chạy tay.
- **m3. `inspect-image.sh:11` chỉ dò `from "@paperclipai/`.** Không dò `import("@paperclipai/…")` động như test (`crew-plugin-manifest.test.ts` kiểm cả hai). Bù lại bước import manifest chạy thật; worker không được import thử ở image. Ca này đã được em kiểm tay ở mục 1, chấp nhận. Có thể thêm `import\\(` vào regex cho đồng bộ.
- **m4. Test bundle phụ thuộc SDK đã build** (`crew-plugin-manifest.test.ts`, `execFileSync build.mjs`): worktree sạch phải chạy `ensure-build-deps` trước, nếu không test vỡ với lỗi esbuild khó hiểu. `verify.sh:25` đã có bước đó trước dòng build; không cần sửa code, chỉ lưu ý khi chạy lẻ test này trên máy mới.

## Khác

- Lệch plan đã khai báo (ensure-build-deps ở overlay-source, regex portable) hợp lý. `deploy.sh` thoát 4 cho `issues crewCoreHooks=0|1` đúng plan. Test `crew-run-cancelled` đổi tên đúng hành vi (`blocked`); các `it` còn lại không còn chữ `todo`.
- `dist/` không nằm trong commit, `git status` sạch.
- Chưa kiểm được 8 file `server/dist/crew/*.js` có mặt trong image thật (file của gói policy/runtime-retry chưa gộp); sẽ lộ ra ở `inspect-image.sh` tại Cổng 1 sau tích hợp.

## Câu hỏi còn mở
- m1: owner muốn nâng cấp kiểm health (hai lần đọc hoặc dashboard) trong PG-1 hay chấp nhận kiểm tay ở AC-2?

## Re-review m1 (diff `e02e83f00..d9ff72dee`, 07/10/2026)

### Verdict: APPROVE (m1 đã đóng). Finding mới: critical 0, major 0, minor 2.

Đã kiểm: HEAD worktree đúng `d9ff72dee`; `node --test crew/ops/plugin-state.test.mjs` chạy lại (nghi nhẹ vì test rẻ): 5/5 pass.

- **Logic chống `ready` cũ: đạt.** `plugin-state.py` yêu cầu health `healthy` và `worker.status == running`, có `pid`, `uptime` (ms, khớp `diagnostics()` trong `plugin-worker-manager.ts`: `Date.now() - startedAt`, chỉ khác null khi running) với `now - uptime >= containerStart - 5s`. Worker là con của server mới nên uptime luôn tính sau container start; worker crash-restart cũng reset uptime về sau, không dương tính giả. Ca thiếu/sai kiểu đều ra lý do chứ không `healthy`. Dashboard route cùng điều kiện auth với health, trả `worker.{status,pid,uptime}` như script đọc.
- **Python trên Ubuntu 24.04: đạt.** Chỉ `json`, `sys`, `time`, `datetime` (stdlib), Python 3.12 có sẵn. Không dùng cú pháp mới hơn 3.8.
- **Múi giờ/định dạng `StartedAt`: đạt.** Docker luôn trả UTC kiểu `2026-10-07T04:31:22.123456789Z`. `plugin-state.sh` cắt `s[:19]` rồi gắn `+00:00` nên bỏ nano giây (tránh `fromisoformat` lỗi với 9 chữ số) và không lệch múi giờ (em chạy thử chuỗi 9 chữ số ra epoch 1791347482.0 đúng). `now` là `time.time()` cùng host, container dùng chung kernel clock, nên không lệch đồng hồ; dung sai 5 giây đủ cho phần thập phân bị cắt (<1 giây).
- **Credential: không lộ.** Script không đọc, in hay `set -x` credential; `api.sh` chạy với `2>/dev/null`, stdout vào file trong `mktemp -d` (mode 0700), xóa bằng `trap EXIT`; chỉ in `healthy` hoặc lý do ngắn. Lưu ý: dashboard JSON (webhook, job gần đây) nằm tạm trên đĩa vài giây, chấp nhận.
- **Fail an toàn:** `docker inspect` hoặc parse lỗi → in `container start unknown` (deploy thoát 6, không dương tính giả).

### Minor mới
- **m5. Phải chép `plugin-state.sh` + `plugin-state.py` lên `/opt/crew-v3-spike/ops/` (chmod +x) trước D1.** `deploy.sh`/`rollback.sh` gọi `$ROOT/ops/plugin-state.sh`; nếu thiếu thì `P` rỗng và deploy luôn thoát 6 (fail an toàn nhưng dễ gây nhầm là plugin hỏng). Repo không có bước đồng bộ `crew/ops/` lên VPS (pattern cũ của các script khác); ghi vào checklist D1.
- **m6. `rollback.sh:19` chỉ đọc một lần ngay khi server `ok`**, worker có thể chưa `running` nên in `worker not running` dù sau đó ổn. Chỉ là thông tin, không ảnh hưởng exit code; đọc lại tay nếu cần.

m2 (cú pháp `api.sh`), m3, m4 giữ nguyên trạng thái như trên.
