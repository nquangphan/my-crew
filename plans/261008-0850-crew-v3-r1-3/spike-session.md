# SP-1 — spike session: BLOCKED do môi trường

Cập nhật: 08/10/2026 14:10:04 +07 (Asia/Ho_Chi_Minh).

Commit test: `ff3fe2c6dcfc8858806a39503fdf7b3e99f436d1`. Gốc: `6c20d406c52bd7f5f611fba71375c2abbd2962c5`.

**Kết luận: chưa thể phân loại go (H1) / no-go (H5).** PostgreSQL không khởi tạo được trong sandbox; lỗi xảy ra trước khi chạy assertion. Không có bằng chứng stock ghi đè/xóa resume, nên không được gọi đây là no-go H1. BR-1 và H5 đều chưa triển khai.

Lệnh: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-claim-resume-contract.test.ts`.

| Ca | Kỳ vọng | Runtime thực đo |
|---|---|---|
| `issue_blockers_resolved`, injection trước claim | `runtime.sessionId = "sess-a"`, B lưu session A | Chưa đo được |
| `issue_assigned`, injection trước claim | `runtime.sessionId = "sess-a"`, B lưu session A | Chưa đo được |
| Đối chứng không injection | `runtime.sessionId = null` | Chưa đo được |

Số test đạt: **0**. Lần đầu theo harness plan: 3 skipped. Đã đổi support guard để lỗi hạ tầng không bị hiểu nhầm là xanh; bản cuối exit 1, suite fail ở collection, `Tests no tests`. Đây không phải RED hành vi hợp lệ và chưa có GREEN.

Bằng chứng nguyên nhân từ `initdb` trực tiếp trong thư mục `mktemp -d`:

```text
creating subdirectories ... ok
selecting dynamic shared memory implementation ... sysv
selecting default "max_connections" ... 20
selecting default "shared_buffers" ... 400kB
selecting default time zone ... Asia/Ho_Chi_Minh
creating configuration files ... ok
running bootstrap script ... 2026-10-08 14:05:43.180 +07 [68115] FATAL:  could not create shared memory segment: Operation not permitted
2026-10-08 14:05:43.180 +07 [68115] DETAIL:  Failed system call was shmget(key=227823184, size=56, 03600).
child process exited with exit code 1
initdb: removing data directory "/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T/tmp.bg8UuCO1c1/pg"
```

Thử cấu hình chính thức `-c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap` cũng bị `shmget(..., size=56, ...)` từ chối. Không sửa thư viện, sandbox hay code sản phẩm để vượt giới hạn.

Đuôi lần chạy bản test cuối:

```text

 RUN  v4.1.11 /Users/phannhatquang/Documents/Projects/crew/.worktrees/paperclip-r13-session/server

[14:07:31] WARN: CREW_POLICY_CONFIG chưa đặt: gate Crew (review, integrator, owner, docs) tắt cho mọi company {"env":"CREW_POLICY_CONFIG"}
 ❯ src/__tests__/crew-claim-resume-contract.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/__tests__/crew-claim-resume-contract.test.ts [ src/__tests__/crew-claim-resume-contract.test.ts ]
Error: Embedded PostgreSQL unavailable: Failed to start embedded PostgreSQL test database after 5 attempts: embedded Postgres startup failed: Postgres init script exited with code 1. Please check the logs for extra info. The data directory might already exist. Recent embedded Postgres logs: 20 | selecting default "shared_buffers" ... | 400kB | selecting default time zone ... | Asia/Ho_Chi_Minh | creating configuration files ... | ok | running bootstrap script ...
 ❯ src/__tests__/crew-claim-resume-contract.test.ts:25:31
     23| });
     24| const support = await getEmbeddedPostgresTestSupport();
     25| if (!support.supported) throw new Error(`Embedded PostgreSQL unavailab…
       |                               ^
     26| const suite = describe;
     27|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  no tests
   Start at  14:07:28
   Duration  40.89s (transform 23.44s, setup 144ms, import 0ms, tests 0ms, environment 0ms)

undefined
/Users/phannhatquang/Documents/Projects/crew/.worktrees/paperclip-r13-session/server:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command failed with exit code 1: vitest run src/__tests__/crew-claim-resume-contract.test.ts
```

Cần chạy lại ở môi trường cho phép PostgreSQL nhúng khởi động. Sau đó thực hiện RED đối chứng, GREEN injection và trích runtime của cả ba ca; chỉ khi đủ bằng chứng go mới làm BR-1. Nếu thực sự no-go do stock, dừng để lead xác nhận H5 theo chỉ thị phiên này.

Chi tiết: [báo cáo SP-1](reports/sp-1-report.md), [log đầy đủ](reports/sp-1-evidence/sp-final.log).

## Sửa harness

Cập nhật 08/10/2026 14:24:50 (Asia/Ho_Chi_Minh). **DONE cho yêu cầu sửa harness**, chưa nghiệm thu SP-1 và chưa kết luận go/no-go H1. Commit: `8ba201d31e8e2b6aa6a4e22b75430b1cd6a373b0`.

Lead đã chạy ngoài sandbox: [sp-1-lead-run-1.log](reports/sp-1-lead-run-1.log), 3/3 ca đỏ, kể cả đối chứng vì không có call tới adapter. Cảnh báo runtime tools chứng tỏ run đã vào `executeRun`, không phải bằng chứng run chưa được claim.

Đối chiếu mã nguồn xác định fixture tạo run `invocationSource=automation` nhưng bỏ trống `wakeupRequestId`. `withChatControlRecoveryGate` (`heartbeat.ts:16876`) ghi admission ở claim; `readChatControlRecoveryAdmission` (`chat-control-recovery-stop.ts:47`) yêu cầu UUID wake hợp lệ. Vì vậy admission bị coi là invalid tại dispatch, trước `adapter.execute`. Đây là chẩn đoán từ source khớp log; lần chạy lead tiếp theo cần xác nhận bằng runtime.

Đã sửa duy nhất `server/src/__tests__/crew-claim-resume-contract.test.ts`:

- Seed `agentWakeupRequests` cho B với đúng company, agent, reason, payload issueId, source automation, trigger system và runId B; đặt `heartbeatRuns.wakeupRequestId` trỏ ngược lại. Bám fixture stock `heartbeat-dependency-scheduling.test.ts:953`, không đổi nguồn wake để né admission gate.
- Dùng helper `claimAndGetRuntime`: gọi scheduler thật, drain execution, đọc run rồi kiểm adapter được gọi đúng một lần và run succeeded. Lỗi assertion kèm status/errorCode/error/executionStage.
- Giữ nguyên cả hai wake, injection DB + object run, kỳ vọng session A và đối chứng sessionId null; giữ assertion session lưu trên B. Không sửa core hoặc mock claim/dispatch.

Kiểm tra: `git diff --cached --check` đạt. Typecheck `corepack pnpm --filter @paperclipai/server exec tsc --noEmit` exit 1: vẫn thiếu `@paperclipai/paperclip-runner` declarations và implicit-any ngoài file sở hữu; không báo lỗi tại test mới. [Log typecheck](reports/sp-1-harness-typecheck.log).

Không chạy Vitest/PostgreSQL trong sandbox ở lượt sửa này theo chỉ thị lead. Log RED là lần chạy lead đã cung cấp; **chưa có log GREEN**, không khẳng định đối chứng đã xanh. BR-1/H5 chưa làm.

Cần lead chạy (từ worktree `paperclip-r13-session`): `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-claim-resume-contract.test.ts`

Nếu cả ba ca xanh thì lead xác nhận go; nếu vẫn đỏ, thông báo assertion mới sẽ chỉ trạng thái/lỗi cụ thể. Chờ lead báo go/no-go trước BR-1.

## Kết luận của lead (08/10/2026 14:26)

**GO — H1.** Lead chạy ngoài sandbox trên `8ba201d31` (log `reports/sp-1-lead-run-2.log`): 3/3 xanh. Ghi `resumeFromRunId`/`resumeSessionParams`/`resumeSessionDisplayId` vào `contextSnapshot` của run B trong `beforeClaim` (UPDATE có điều kiện `status='queued'`) → adapter nhận `runtime.sessionId = "sess-a"` với cả wake `issue_blockers_resolved` lẫn `issue_assigned`; đối chứng không đặt gì → `null`; run B chạy đúng một lần, `succeeded`. Không cần H5; ngân sách hook giữ 4/5.
