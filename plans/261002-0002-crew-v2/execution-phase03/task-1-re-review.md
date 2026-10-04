# Task1 — re-review vòng sửa 1

**READY: No.** F1/F3 và residue cụ thể của F2 đã được xử lý; cơ chế khóa thay thế có một regression macOS mới cần sửa hẹp trước khi đóng review.

## Phạm vi và bằng chứng đã chấp nhận

- Candidate `7a246cb..7d4b6f0`: chỉ diff gateway sửa F1/F2/F3, `process-lock.ts`, `host-failures.test.ts`, teardown lifecycle và flow/manifest/generated mapping đi cùng.
- Đọc `task-1-fix.md`, review cũ và flow gateway mới; không review lại toàn bộ Task1/server/desktop.
- Chấp nhận covering proof: gateway **13/13**, typecheck exit 0, Biome 5 file sạch; desktop Electron macOS thật **5/5** trước lần siết stderr lsof cuối, sau lần đó gateway **13/13** + typecheck/Biome qua lại. Chấp nhận nested docs `--all`/`--staged` và root staged check của controller. Không chạy lại suite.
- Một targeted reproduction vì có concern cụ thể về semantics `/usr/bin/lockf`; dùng Node v24.14.0, ProcessLock nguồn hiện tại, root và helper riêng của review.

## Kết quả F1/F2/F3

| Finding cũ | Kết luận |
|---|---|
| F1 P1 — oversized lần hai crash host | **Addressed.** `server.ts:87-135` quản lý reading/dispatching/terminal, bỏ listener khi terminal, chỉ respond một lần, xử lý socket error và dispatch rejection. Regression gửi lại oversized xác nhận boot ID không đổi và host không exit. |
| F2 P2 — recovery/init lock residue wedge reboot | **Residue cũ addressed.** Có process-bound guard trước recovery; root identity và type/UID/mode/nlink/inode được kiểm, PID sống/không rõ từ chối, lsof chỉ chấp nhận exit1 + stdout/stderr rỗng, resource có handle từ chối. Tests empty init/recovery, live contender và symlink qua. **Chưa đóng F2 toàn bộ** do regression khóa thay thế N1 bên dưới. |
| F3 P2 — drip client giữ shutdown | **Addressed.** Frame deadline tuyệt đối 1500ms từ accept; reading socket bị destroy ngay khi stop, dispatch drain tối đa 300ms rồi destroy, server close có deadline. Tests drip frame, SIGTERM/new boot và stalled dispatch phủ failure cũ. |

Helper stdin pipe là hướng phù hợp: host exit đóng writer, holder nhận EOF/exit và OS thả khóa; mất helper làm host fail closed. Legacy recovery không xóa mù file rỗng, không diễn giải PID reuse sống là process chết. Nhận định này giữ nguyên giới hạn không chống thao túng chủ động cùng UID đã nêu trong fix report.

## N1 — P2: `lockf` xóa guard trên macOS, cho hai contenders giữ khóa trên hai inode

**File/line:** `v2/gateway/src/host/process-lock.ts:36-41`, cụ thể macOS args tại dòng 39 thiếu `-k`.

`lockf` macOS mặc định unlink file khi command hoàn tất. Man page tại máy review xác nhận điều này và khuyến nghị `-k` khi đồng bộ nhiều tiến trình để bảo đảm lock ordering. Vì vậy `ProcessLock.release()` thực tế xóa `host.guard`, trái với ý định guard là file ổn định chỉ thả khóa OS. Một contender đã mở guard trước thời điểm owner release có thể sau đó lấy khóa trên inode đã bị unlink; contender mới tạo path guard khác và lấy khóa inode mới. Singleton guard lúc đó không còn loại trừ hai tiến trình đang khởi động/recovery. Đây là race do vòng đời guard, không cần một tiến trình cùng UID chủ động xóa/đổi file.

**Targeted proof trực tiếp, có fault injection rõ ràng:**

1. `first = new ProcessLock(root,...); await first.acquire()`.
2. `fd = await open(host.guard,'r')` giữ inode cũ, mô phỏng contender bị tạm dừng giữa bước open file và flock.
3. `await first.release()`; `lstat(host.guard)` báo không còn path.
4. Spawn `/usr/bin/lockf -t 0 /dev/fd/3 <node> -e <pipe-holder>` với fd cũ ở descriptor3; chờ READY. Chế độ fd giữ khóa inode cũ.
5. `await new ProcessLock(root,...).acquire()` thành công đồng thời khi holder inode cũ còn sống.

Output: `pathRemainsAfterRelease:false`, `oldInode:63075829`, `newInode:63075835`, `oldFdContenderStillAlive:true`, `newProcessLockAcquired:true`. Đây là chứng minh trực tiếp hai guard lock có thể cùng được giữ bằng lịch open/release/reacquire; không tuyên bố đã quan sát hai GatewayHost phục vụ RPC đồng thời ngoài fixture.

**Fix hẹp đề nghị:** Thêm `-k` cho lockf macOS để guard không bị unlink khi holder exit. Có thể thêm `-n` vì file đã tạo và kiểm UID/type/mode trước spawn; mất path phải fail closed thay vì để lockf âm thầm tạo file khác. Giữ nguyên recovery checks và helper pipe. Thêm regression macOS kiểm guard tồn tại và giữ cùng dev/inode sau release/crash và reacquire, cùng xác nhận contender trên guard đó bị từ chối khi owner sống. Đây là sửa vòng đời guard; không cần thay đổi RPC/desktop/server contract.

## Contract, quality và docs correspondence

- Không đổi GatewayStatus, route/token/nonce wire contract, truth unconfigured hay API preload. F1/F3 giới hạn lỗi client vào socket đúng yêu cầu; process-bound guard thêm phụ thuộc OS `lockf`/`lsof` đã công bố, không cài công cụ toàn máy.
- Eight regressions mới kiểm đúng failures và restart/ownership; teardown auth cũ nay await host exit trước rm root, là thay đổi hợp lý.
- Manifest và generated file index map hai file mới đúng flow. Flow giữ bảy mục, các bước khớp symbol; phần deadline/drain/recovery cập nhật đúng sửa đổi. Tuy nhiên mô tả guard bền trên đĩa phải được bảo đảm bằng `-k` và regression N1 trước approval.
- Không còn finding khác trong scoped fix sau kiểm tra nguồn. Không suy ra readiness journal/server/model/runtime từ gateway hoặc Electron pass.

## Verification và cleanup của reviewer

Chỉ chạy `man lockf | col -b` để kiểm semantics OS và một heredoc `node --input-type=module` cho N1. Không sửa source, install, stage, commit, spawn subagent, chạy server/DB/model hoặc dùng owner LaunchAgent.

Reproduction exit0 sau khi thu bằng chứng; `finally` release hai ProcessLock, kết thúc/await holder dùng fd cũ, đóng fd và rm chính root `mkdtemp('crew-v2-review-lockf-')`. Output cuối: `review-owned lock helpers, fd and root cleaned`.

**Điều kiện READY:** sửa N1 bằng guard ổn định, cung cấp regression/verification gateway tương ứng và giữ docs khớp. Các finding F1/F3 không cần mở lại nếu không đổi nhánh đó; bằng chứng Electron hiện có vẫn được chấp nhận trong phạm vi Task1.
