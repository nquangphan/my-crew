# Đánh giá khả thi Crew v3 trên Paperclip — hướng "stock-first"

Ngày: 06/10/2026, Asia/Ho_Chi_Minh. Nguồn: fork `.worktrees/paperclip-v3` (pin `v2026.1001.0` = `8f8a0ab7e`), `upstream/master` = `72ff3a9f2` (05/10/2026). Mọi thử nghiệm merge chạy trên worktree tạm và đã gỡ.

## Kết luận

Giữ được khả năng cập nhật Paperclip theo upstream là **khả thi**, với điều kiện đổi chiến lược: dùng tối đa tính năng có sẵn của Paperclip và chỉ giữ một lớp hook rất mỏng trong lõi. Kế hoạch cũ (tự viết remote adapter, transport, reaper/adoption và patch P1–P4 sâu trong `heartbeat.ts`) không khả thi về mặt bảo trì, vì upstream ra stable gần như hằng tuần và mỗi đợt đổi hàng trăm dòng ở đúng các hàm cần vá.

Upstream đã có sẵn ba thứ mà kế hoạch cũ định tự xây: chạy Claude/Codex/OpenCode trên máy khác qua SSH environment, stage review/approval do runtime cưỡng chế, và runner native kết nối outbound. Phần còn phải chứng minh bằng spike thật là đường SSH tới Mac, hành vi khi mất kết nối, và cách giới hạn tải theo máy.

## Bằng chứng 1 — tốc độ thay đổi của upstream

- Stable tags: `v2026.817.0`, `824.0`, `831.1`, `916.1`, `1001.0`; mỗi tag nằm trên nhánh phát hành riêng với một commit release notes.
- `v2026.916.1 → v2026.1001.0`: 77 commit, 1.142 file, +74.807/−15.343 dòng; `heartbeat.ts` đổi 680 dòng. `heartbeat.ts` hiện 29.641 dòng và tăng khoảng 5.000 dòng trong hai tuần cuối tháng 8.
- Upstream đang đầu tư mạnh cho native runtime (runnerd Rust, `codex_app_server`, `acpx_runtime`, ...). Đường `legacy` vẫn là mặc định (native là `eligible_opt_in`), chưa có thông báo bỏ.

## Bằng chứng 2 — thử nghiệm merge với hook mỏng

Mô phỏng patch Crew bằng một dòng `await crewHooks.hN?.(...)` ở đầu 7 hàm neo (`runUpdate`, `issues.create`, `claimQueuedRun`, `startNextQueuedRunForAgent`, `executeRun`, `reapOrphanedRuns`, `cancelRunInternal`), rồi merge bản upstream kế tiếp.

| Lượt nâng | Không có hook | Hook + import đầu file | Hook + import cuối file |
|---|---|---|---|
| 817.0 → 831.1 | — | sạch | sạch |
| 831.1 → 916.1 | 1 conflict (UI, do tag) | 7 hunk | 4 hunk (đổi chữ ký hàm) |
| 916.1 → 1001.0 | sạch | 1 hunk (import) | sạch |
| 1001.0 → master | sạch | 3 hunk (import, `adapter.execute`) | sạch |

Kết luận: conflict chủ yếu đến từ vị trí import và hook chèn giữa dòng upstream hay sửa. Hook đặt ở đầu hàm, import ở cuối file thì 3/4 lượt sạch; lượt còn lại chỉ cần chèn lại một dòng, tự động hóa được bằng script áp patch theo neo và test kiểm hook còn đủ. Patch sâu bên trong thân hàm (kiểu P2/P3 cũ) sẽ conflict nhiều hơn hẳn, chưa đo.

## Bằng chứng 3 — tính năng upstream thay cho phần tự xây

- **Chạy agent trên máy khác:** `packages/shared/src/environment-support.ts` cho phép `claude_local`, `codex_local`, `opencode_local` (và vài adapter khác) chạy trên driver `ssh`/`sandbox`. Adapter chạy CLI trên máy đích nên dùng login Claude/Codex của chính máy đó; credential không lên VPS.
- **Mô hình workspace SSH hiện tại:** server giữ worktree, mỗi run đóng gói worktree gửi sang máy đích, chạy xong khôi phục commit về server (`docs/guides/board-operator/execution-workspaces-and-runtime-services.md`, mục no-remote-git). Repo gốc vì vậy nằm trên VPS. Chế độ `in_place` (làm trực tiếp trên repo của máy đích, `remoteCwd = authoritativeRoot`) có từ commit `4e0081857` (25/07/2026) và đã nằm trong `v2026.1001.0` (`server/src/services/workspace-realization.ts`). Chế độ này được bật qua metadata `workspaceRealization.mode` của lease/provider; chưa xác minh SSH driver stock có cho cấu hình trực tiếp hay cần sandbox provider plugin.
- **Runner outbound:** `packages/adapter-utils/src/runner-connectivity.ts` có transport `direct_outbound` tới `/api/runner/v1/connect`; runnerd do server khởi chạy trong environment, sau đó tự kết nối ngược về server. Bộ test macOS đầy đủ của runner còn lỗi theo nền tảng; Linux là nền tảng đạt chuẩn.
- **Gate review/approval:** `docs/guides/execution-policy.md` mô tả `executionPolicy` với stage review/approval do runtime chặn chuyển `done`, loại người thực thi khỏi người review, ghi `issue_execution_decisions`. Người tham gia stage có thể là agent hoặc user (owner).
- **Giới hạn tải:** chỉ có `maxConcurrentRuns` theo agent, chưa có giới hạn theo máy. Sandbox provider có thể là plugin, nên lease acquisition qua plugin là ứng viên làm gate trước spawn mà không vá lõi; chưa kiểm chứng.

## Hệ quả cho kế hoạch

1. Bỏ remote adapter, transport, journal/reaper/adoption tự viết và patch P3/P4. Dùng SSH environment của upstream; Mac được nối qua mạng riêng như Tailscale (kết nối do Mac chủ động, không mở cổng public).
2. Gate cốt lõi dựng trên `executionPolicy` + blockers. Gate riêng Crew (docs-sync theo merged commit, merge, trần 5 vòng sửa) làm thành stage review do agent/plugin Crew đảm nhiệm; leo thang owner bằng plugin quan sát.
3. Patch lõi chỉ được phép dưới dạng hook một dòng ở đầu hàm, có script áp lại, test hiện diện hook và registry. Mục tiêu là số hook bằng 0 sau spike.
4. `in_place` đã có trong bản pin; spike chỉ cần chứng minh cách bật nó cho Mac qua SSH (cấu hình stock hoặc plugin provider).
5. Một số module v2 trong danh sách "bắt buộc giữ" (transport, journal process, ACK/replay) sẽ do upstream thay; telemetry/resource check, policy, workflow registry/isolation, docs-kit, UI map vẫn giữ.

## Việc còn phải chứng minh bằng spike thật

- Paperclip stock chạy một issue bằng `claude_local` trên Mac qua SSH environment, log/session/commit trở về đúng issue.
- Mất kết nối giữa chừng và server restart: run có bị đánh fail hay chạy lại không, process trên Mac có bị bỏ mồ côi không.
- `codex_local` và `opencode_local` với endpoint OpenAI-compatible chạy được trên cùng máy.
- Stage review/approval chặn được agent tự chuyển `done` qua API.
- Giới hạn tải theo máy: plugin lease hay hook đầu `claimQueuedRun`.

## Câu hỏi chưa giải quyết

- Owner có chấp nhận repo gốc nằm trên VPS (chế độ copy) ở R1, hay bắt buộc repo nằm trên Mac (`in_place`, cần bản upstream mới hơn hoặc plugin provider)?
- Owner có chấp nhận Tailscale/SSH thay cho gateway tự viết kết nối outbound?
- Owner có chấp nhận thay một phần module v2 bắt buộc giữ (transport/journal/ACK) bằng cơ chế upstream?
