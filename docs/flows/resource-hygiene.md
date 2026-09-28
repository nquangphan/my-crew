# Dọn tài nguyên sau mỗi job

> Flow `resource-hygiene`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow
> resource-hygiene` in ra đúng danh sách đó.

## Mục đích

Đảm bảo một job không để lại tiến trình, cổng, file tạm hay container chạy mãi trên máy: dừng đúng những gì
job đó (và chỉ nó) đã khởi động khi job kết thúc, quét định kỳ những gì job trước đó lỡ để lại, và cho PM một
cách an toàn để xem/dọn tài nguyên qua ticket tool.

## Điểm vào

- `apps/daemon/src/runner/job-cleanup.ts` → `cleanupJob()` — gọi ở cuối mọi job (kể cả `backoff`, `cancelled`)
  từ `JobRunner` (flow `agent-runs`), và từ vòng sweep định kỳ của `createDaemon()` (flow `daemon-runtime`).

## Các bước

1. `apps/daemon/src/runner/resource-tracker.ts` → `ResourceTracker.jobProcesses()`: liệt kê tiến trình của
   đúng user hệ điều hành hiện tại (`ps -E` trên macOS đọc env kèm theo command; `/proc/<pid>/environ` trên
   Linux), rồi gán mỗi tiến trình cho một job theo thẻ env `CREW_JOB_ID`, theo process group (job pgid), hoặc
   theo tổ tiên của một tiến trình đã gán — vì macOS ẩn env của một số binary hệ thống (`/bin/sleep`) nên cây
   tiến trình và process group bù cho việc đó.
2. `apps/daemon/src/runner/resource-tracker.ts` → `listeningPorts()`/`listContainers()`: `lsof -nP -iTCP
   -sTCP:LISTEN` cho cổng đang nghe theo pid; `docker ps -a` cho container kèm thời điểm tạo — container chỉ
   được **báo cáo**, không bao giờ tự dừng.
3. `apps/daemon/src/runner/job-cleanup.ts` → `cleanupJob()`: gửi `SIGTERM` tới process group của job và mọi
   tiến trình gắn thẻ, chờ tối đa `graceMs` (mặc định 10s), còn sống thì `SIGKILL`; xóa thư mục tạm của job
   (`jobTmpDir`); ghi một dòng vào `job_cleanup` (pid, cổng, byte đã giải phóng, container thấy được trong cửa
   sổ thời gian job chạy). Chạy ở mọi điểm kết thúc job, kể cả `backoff`/`cancelled`, không chỉ khi xong.
4. `apps/daemon/src/runner/job-cleanup.ts` → `findOrphans()`/`sweepOrphans()`: tìm tiến trình gắn thẻ một job
   mà state DB này biết và job đó không còn chạy trong tiến trình daemon hiện tại, cùng thư mục tạm của job
   không chạy; tiến trình gắn thẻ một job DB này không biết (của daemon khác) bị bỏ qua; thư mục tạm của job
   không rõ nguồn gốc vẫn bị xóa vì nó nằm dưới home của chính daemon này. `createDaemon().sweep()` gọi hàm
   này lúc khởi động và mỗi 10 phút.
5. `apps/daemon/src/runner/resource-report.ts` → `buildResourceReport()`: gộp snapshot tài nguyên máy, job
   đang chạy, tiến trình/thư mục tạm/worktree/container liên quan tới job (đánh dấu `cleanable` khi job của
   chúng không còn chạy, hoặc với worktree khi ticket đã `done`/`cancelled`), và các lần dọn gần đây
   (`job_cleanup`).
6. `apps/daemon/src/runner/resource-report.ts` → `ResourceOps.report()`/`cleanup()`: `cleanup_resources` chỉ
   được tác động lên id nằm trong báo cáo (`resource_report`) **gần nhất** và được đánh dấu `cleanable` (hoặc
   một container) — nên agent không thể nêu tùy ý một tiến trình hay đường dẫn ngoài danh sách đã thấy;
   container chỉ dừng khi được yêu cầu đích danh.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/daemon/src/runner/job-cleanup.ts` | Dọn một job khi kết thúc, quét orphan | `cleanupJob`, `findOrphans`, `sweepOrphans`, `jobTmpDir` |
| `apps/daemon/src/runner/resource-tracker.ts` | Đọc tiến trình, cổng, container của hệ điều hành | `ResourceTracker`, `parsePsLines`, `parseLsof`, `parseDockerTime`, `pathSize` |
| `apps/daemon/src/runner/resource-report.ts` | Báo cáo và dọn theo yêu cầu PM | `buildResourceReport`, `ResourceOps`, `ResourceReport` |

## Dữ liệu

- Bảng: ghi `job_cleanup` (sở hữu bởi flow này) mỗi lần dọn; đọc `jobs` để biết job nào còn chạy/đã đóng
  (`apps/daemon/src/state-db.ts`, flow `daemon-runtime`).
- Sự kiện: không phát/nhận sự kiện.
- Gọi ngoài: `ps`, `lsof`, `docker ps`/`docker stop` cục bộ; tín hiệu POSIX (`SIGTERM`/`SIGKILL`) tới tiến
  trình và process group.

## Flow liên quan

- agent-runs: `JobRunner.cleanup()` gọi `cleanupJob()` ở mọi điểm kết thúc job; `resourceOps` được lắp vào
  ticket tool `resource_report`/`cleanup_resources` (chỉ PM).
- daemon-runtime: `createDaemon().sweep()` gọi `sweepOrphans()` lúc khởi động và theo timer 10 phút.
- agent-workspace: `ResourceOps` gọi `removeWorktree()` khi PM dọn một worktree đã đóng ticket.

## Tests

- `apps/daemon/test/resources.test.ts`: phân tích đúng output `ps`, `lsof`, `docker`; tìm tiến trình gắn thẻ
  qua env và không bao giờ động vào tiến trình không gắn thẻ; `SIGTERM` process group và tiến trình gắn thẻ,
  `SIGKILL` tiến trình còn sống sau grace period, xóa thư mục tạm và ghi lại; sweep dọn orphan của job đã biết
  và bỏ qua orphan của daemon khác cũng như job còn chạy; `resource_report` liệt kê đúng những gì job đã kết
  thúc để lại, `cleanup_resources` chỉ tác động mục đã liệt kê và đủ điều kiện dọn.
