# Ticket spike stock-first

Bảng giao việc cho Phần 1 của [plan.md](plan.md). Bản xem online, trạng thái cập nhật trực tiếp: https://claude.ai/artifact/14g64yScV5ZwaT9cNUEjh5 (dữ liệu ở collection `packs`, `tickets`, `log`). Nội dung từng bước vẫn nằm trong plan; file này chỉ ghi chia gói ngữ cảnh, ai giữ gói và trạng thái.

Luật chia: vẽ gói ngữ cảnh trước rồi mới cắt ticket. Ticket cùng gói thì gộp; gộp quá lớn để review một lượt thì giữ nhiều ticket nhưng giao chung một worker làm lần lượt. Không có hai agent song song cùng nạp một gói. Reviewer cũng theo gói và không review ticket mình làm.

## Quyết định

- 06/10/2026: Đại Ca chốt chạy spike trên VPS như v1 (Ubuntu, Docker Compose, sau nginx biên `2ps-landing-nginx`, xem `docs/flows/deployment.md`), không chạy container trên Mac. Paperclip spike là compose project riêng ở `/opt/crew-v3-spike` trên `nhamoiplatform`, không đụng stack `crew` của v1 ở `/opt/crew`, UI chỉ mở qua Tailscale.
- 06/10/2026: Máy chạy agent (máy "Mac" trong plan) là **Mac mini** `phans-mac-mini`, không phải MacBook đang chạy phiên Trợ Lý. Mac mini chỉ là máy thử cho spike: agent Paperclip chạy Claude Code trên đó bằng tài khoản của Mac mini, nhưng chỉ làm việc thử trong `~/crew-spike/repo-a`. Code dự án Crew v3 vẫn làm trên MacBook.

## Gói ngữ cảnh

| Gói | Nạp gì (trong fork `.worktrees/paperclip-v3`, tìm theo symbol) | Môi trường dùng chung | Worker · model | Reviewer · model |
|---|---|---|---|---|
| `moi-truong` | `server/src/services/workspace-realization.ts`, `environment-runtime.ts`, `environment-run-orchestrator.ts`, `plugin-environment-driver.ts`, `environment-probe.ts`, `packages/plugins/sdk/src/types.ts`; trong `heartbeat.ts` chỉ mở `claimQueuedRun`, `reapOrphanedRuns`, `cancelRunInternal` | Server Paperclip của S1 trên VPS, SSH qua Tailscale từ VPS tới Mac mini, repo thử `~/crew-spike/repo-a` | chưa giao · opus | chưa giao · opus |
| `policy` | `docs/guides/execution-policy.md`, `applyIssueExecutionPolicyTransition`, `issueService` (`runUpdate`), `routes/issues.ts`; trong `heartbeat.ts` chỉ mở `deriveTaskKey`, `agentTaskSessions` | Dùng chung server của S1, company riêng; không dựng server thứ hai | chưa giao · opus | chưa giao · opus |
| `upgrade` | `spike-moi-truong.md` (kết luận hook của S3/S5), remote `upstream` của fork, `server/src/adapters/plugin-loader.test.ts` | Worktree tạm trong scratchpad, không đụng nhánh `v3` | chưa giao · opus | chưa giao · sonnet |
| `tong-hop` | `spike-*.md` của ba gói trên, spec v3, Phần 2 của plan | — | Trợ Lý tự làm | Đại Ca chốt go/no-go |

Opus cho `moi-truong`, `policy`, `upgrade` vì cả ba đụng scheduler, execution policy hoặc hook lõi Paperclip. Reviewer `upgrade` dùng sonnet vì chỉ đối chiếu số conflict và log test với commit.

## Ticket

| ID | Việc | Gói | Thêm so với gói | Phụ thuộc | Cần Đại Ca | Trạng thái |
|---|---|---|---|---|---|---|
| S1 | Dựng Paperclip stock, nối Mac làm SSH environment, probe pass | `moi-truong` | `processes.md` | — | Bật Remote Login; đăng nhập Tailscale | chờ Đại Ca |
| S2 | Issue thật chạy `in_place` trên repo Mac, kiểm credential | `moi-truong` | — | S1 | — | chờ |
| S3 | Mất kết nối, restart server, hủy run | `moi-truong` | — | S2 | — | chờ |
| S5 | Kiểm tải Mac trước spawn, hành vi khi Mac offline | `moi-truong` | — | S3 | — | chờ |
| S4 | Gate review/owner/docs bằng execution policy, vòng sửa, blockers, dùng chung session giữa hai issue (Step 6) | `policy` | — | S1 | Duyệt approval ở Step 2 với vai owner | chờ |
| S6 | Diễn tập nâng upstream với plugin rỗng và hook đã chọn | `upgrade` | — | S3, S5 | — | chờ |
| S7 | Kết luận go/no-go, cập nhật spec và Phần 2 | `tong-hop` | — | S4, S5, S6 | Chốt go/no-go | chờ |

S1→S2→S3→S5 cùng gói nên không gộp làm một ticket (quá lớn để review một lượt) mà giao chung một worker làm lần lượt. S4 chạy song song với S2–S5 được vì khác gói và ghi file riêng; S4 dùng chung server S1 dựng trên VPS, không bật server Paperclip thứ hai.

## File ghi của từng gói

Các gói chạy song song nên không cùng sửa `spike-report.md`. Mỗi gói ghi file riêng, S7 gom về `spike-report.md`:

| Gói | Ghi vào |
|---|---|
| `moi-truong` | `spike-moi-truong.md`, `processes.md` |
| `policy` | `spike-policy.md` |
| `upgrade` | `spike-upgrade.md` |
| `tong-hop` | `spike-report.md`, spec v3, `plan.md` Phần 2 |

## Nhật ký giao việc

Ghi mỗi lần giao: giờ, ticket, gói, agent (tên/ID), model, spawn mới hay nhắn tiếp.

_Chưa giao ticket nào._
