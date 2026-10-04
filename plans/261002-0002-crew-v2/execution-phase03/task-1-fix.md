# Task 1 — sửa review vòng 1

**Kết quả:** Đã sửa F1/F2/F3 trong host/IPC Task1. Các kiểm tra gateway và desktop thật đều qua tại worktree; controller cần thêm hai file mới vào `v2/docs/flows.yaml`, generate/check docs và commit theo ownership chung. Không claim phần server/runtime các task sau.

## Findings và thay đổi

| Review | RED được tái hiện | Fix và GREEN |
|---|---|---|
| F1 P1 — frame oversized lần hai làm crash host | Test gửi 9000 byte rồi gửi thêm 9000 byte sau response; trước fix host exit 1 vì write after end. | `GatewayRpcServer.handle/respond` theo dõi phase socket, bỏ data listener ở nhánh terminal, xử lý socket error và dispatch rejection. Cùng test xác nhận host vẫn trả status với boot ID cũ. |
| F2 P2 — residue recovery/init lock chặn reboot | Fault injection `host-recovery.lock` rỗng sau SIGKILL và `host.lock` rỗng trước boot đều làm test fail trước fix. | `ProcessLock.acquire` dùng khóa OS `lockf` trên macOS (`flock` trên Linux) giữ bởi helper sống theo pipe host, nên crash thả khóa. `GatewayHost.removeProvenLegacyResidue` chỉ xử lý file cũ sau khi có guard; kiểm root inode/UID, loại/UID/mode/link/inode từng resource, PID sống/không rõ thì từ chối, file rỗng cần `lsof` chứng minh không còn handle. Live contender không takeover; symlink không bị xóa. |
| F3 P2 — drip client giữ SIGTERM | Trước fix test gửi byte liên tục không có newline và host không thoát trong deadline. | Deadline frame tuyệt đối 1500 ms từ accept; `GatewayRpcServer.stop` theo dõi toàn bộ socket, hủy frame dở ngay, drain dispatch tối đa 300 ms rồi hủy socket còn lại và chờ server close có deadline. Test SIGTERM/reboot và dispatch treo đều qua. |

`host.guard` là file riêng tư có thể còn sau stop/crash nhưng khóa OS không còn; file đó không được xóa khi recovery. Không dựa vào timeout đơn thuần để xóa `host.lock`/`host-recovery.lock`. PID tái sử dụng được xử lý bảo thủ: PID còn sống luôn bị xem là owner có thể còn hoạt động, nên từ chối recovery.

## Kiểm tra

- RED: `pnpm --dir v2/gateway test` trước implementation: 5 regression mới fail đúng F1/F2/F3; 2 test contender/symlink pass. Một lần suite bị treo do teardown fixture auth cũ xóa root trước khi đợi host SIGTERM. Đã sửa `host-lifecycle.test.ts` để await child exit rồi mới xóa root.
- GREEN sau fix: `pnpm --dir v2/gateway test` **13/13 pass**, gồm 8 regression mới và 5 lifecycle cũ; macOS LaunchAgent dùng nhãn test riêng.
- `pnpm --dir v2/gateway typecheck` exit 0.
- `pnpm exec biome check` trên 5 file gateway sửa/mới exit 0 sau `--write`.
- `pnpm --dir v2/desktop test` **5/5 pass**, gồm Electron macOS thật: đóng cửa sổ, crash main và mở lại vẫn giữ host boot ID. Không dùng fake Electron để suy ra vòng đời GUI.
- Sau lần sửa cuối trong `noOpenHandles`, đã chạy lại gateway suite/typecheck/Biome một lần; cả ba exit 0 như phần Final check.

## Phạm vi, cleanup và giới hạn

Chỉ sửa gateway host/IPC, test gateway và flow `v2/docs/flows/gateway-host.md`. Hai file nguồn/test mới cần controller map vào `v2/docs/flows.yaml` (R2) và generate docs; worker không chạm manifest shared, index, commit hay server/desktop source. Không chạy model, DB, owner LaunchAgent hoặc thay global config. Fixture chỉ dùng root `mkdtemp` và process/label test riêng; cuối suite đã kiểm `ps` không còn process mang tiền tố fixture Task1. Disk còn khoảng 44 GiB tại lần kiểm; không tạo process lâu dài.

`lsof`/`lockf` là phụ thuộc OS cho runtime macOS hiện tại. Nếu owner cũ có PID còn sống hoặc metadata/handle không chứng minh an toàn, host từ chối takeover và cần chẩn đoán thủ công. Cơ chế này không khẳng định chống thao túng chủ động của một tiến trình khác cùng UID đối với thư mục trạng thái; quyền OS `0700/0600` chặn UID khác. Signed bundle/private Node và ServiceManagement thuộc phase09.

## Final check

Sau thay đổi `stderr` của `lsof`: `pnpm --dir v2/gateway test` **13/13 pass**, `pnpm --dir v2/gateway typecheck` exit 0, `pnpm exec biome check` trên năm file gateway exit 0 (`Checked 5 files ... No fixes applied`). Desktop suite 5/5 pass trước thay đổi này; thay đổi chỉ siết nhánh kiểm chứng residue host và không đổi IPC/API desktop.
