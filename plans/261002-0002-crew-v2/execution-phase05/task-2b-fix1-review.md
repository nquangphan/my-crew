# Task05/2b FIX1/5 — Scoped independent re-review

**SPEC READY. QUALITY READY. F1 ADDRESSED.** Không có finding P1/P2 mới trong FIX1 diff. Đây là scoped re-review finding duy nhất của full review6150254 và ba file mới sửa; không mở lại full schema/producer review hoặc cấp chứng nhận cho các task tích hợp sau.

## Source binding và phạm vi

Candidate `490001ceaebec040f2d0434c3f68f516ff10a9ad`, diff từ `1f28754`: đúng `v2/server/src/attachments/submissions.ts`, `v2/server/test/attachments-submissions.test.ts`, `v2/docs/flows/server-attachments.md`. Đã đọc original task-2b-review.md, appended FIX1 report, full ba-file review package, source/evidence/cleanup inventory, RED/final/types/Biome logs, per-run manifests và evidence-only launcher. Không đọc/import Task5 parser hoặc source/package/lock peer đang sửa để kiểm candidate.

Reviewer đối chiếu bytes/SHA current files với inventory và `git show 490001c`: cả ba source và mười migrations001–010 khớp. Mười migration giữ accepted bytes. Toàn bộ17 evidence entries khớp bytes/SHA. Report gốc trong `task-2b-report-before-fix1.md` giữ SHA `2e5d93565b1236d9892a5f20dc3ccde3cdd86e7246661f6503ec34dbe2321771`; report mới giữ nguyên byte prefix cũ và append FIX1.

| File | SHA-256 |
|---|---|
| submissions.ts | `0bf63fae11bfc591ce82351746b1be1fe112695ca65845e76e102174da2a0b99` |
| attachments-submissions.test.ts | `770c9e033b5a2b634872ee31d471d37e998ed7a085ffa51dd658db036a910dfb` |
| server-attachments.md | `642bb1b129cc729cb72de11b167ec7038bd700e204e2cb3cd721fc1d0edc2232` |
| task-2b-fix1-source-inventory.json | `0e419ae3b842867e719e4218a8cd38614256da5d3538eb525997ef6830cf25cb` |
| task-2b-fix1-evidence-inventory.json | `9b9257250c9345425ad9bd6fcde0d7ba368f74febd88b0d5d845ffd29cc0dda2` |
| task-2b-fix1-cleanup-inventory.json | `6be70044e18a114b970cd1b72453ea966787fd471cd431724ed436ae8cf61e16` |
| task-2b-fix1-review-package.diff | `1a9801660840771c81375809a1c54464087531e64b1d9aff4a6c60bf58729419` |

Final test và types snapshots đều277 entries. Reviewer so toàn bộ manifest với Git objects: **273 files từ6150254 + ba candidate overlays + một ownership marker; zero mismatch**. Không lấy working peer code vào source binding. Captured source before/after không đổi. RED source SHA là baseline `ab4bc7b0d46125313a1209dc0125afe4bfdec158f3cefb6f300d5eec65705efd`; final source SHA đúng bảng trên.

## F1 disposition và kiểm tác động

F1 ở `submissions.ts:174–175` nay bắt buộc `proof.kind === 'closed-ack'` và `proof.proofSha256 === receiver.closed_ack_sha256`. Nhánh invented `process-gone` bị loại; unknown discriminator không còn đường đi tới blob verification/retention. Cùng validator được ticket/comment/inbox consumer dùng nên sửa đúng shared boundary.

`native-process-gone` tiếp tục fail closed là đúng: actual reviewed `receivers.proveStopped` chỉ ghi stop proof, không biến receiver thành closed/publication-ready. Nhận native proof để publish/reconcile cần Task7 transition được review riêng. FIX1 không đổi enum thành native rồi suy STOP đủ để release quota.

Diff giữ nguyên owner/scope, exact selection, ready/durable/expiry, receiver ID/generation/writer instance, closed_at/state, original hash/byte verification, lock order, caller Tx, quota latch, replay và event semantics. Không thay producer/schema hoặc callbacks. R3 addition mô tả đúng giới hạn và regression, không nâng native recovery thành completed.

Regression mới dùng actual reserve/receive và file store trên private PostgreSQL prefix10. Capture actual ACK; thay riêng kind thành `process-gone`, `native-process-gone`, `unknown-proof`; mỗi case phải ATTACHMENT_NOT_READY, không comment/link/submission/job, input revisions và toàn upload row gồm quota latch giữ nguyên, original vẫn present. Sau đó khôi phục ACK thực đã capture, submit thành công với một live link, retained/quota latch và pending extraction. Positive không synthesize ACK; negative không giả native process proof. Test này đóng đúng lỗ hổng F1 và giữ behavior hợp lệ.

## Verification

| Run | Evidence được kiểm | Kết quả |
|---|---|---|
| RED | Actual new regression trên production baseline; log có `Missing expected rejection` tại invented kind | Child exit1,0/1 pass,1 fail,0 skip |
| Final affected cover | Hai explicit files attachments-submissions + attachments-comment-factory, `node --test --test-concurrency=2`, exact frozen277 manifest | Child exit0, **22/22 PASS**,0 fail/cancel/skip/todo,5372.718292ms |
| Strict types | Cùng277 source manifest, ordinary `pnpm … typecheck` → `tsc --noEmit` | Child exit0, no diagnostics |
| Scoped Biome | Hai changed TS files | PASS, no fixes |

Final cover còn gồm relevant exact set/replay/current guard/retained accounting/rollback/receiver-state negatives và actual producer legacy empty/whitespace,009 fanout,010 forward/restore regressions. Reviewer kiểm command argv, child exit/closure và log SHA; không lấy outer Python exit0 làm RED PASS. Initial formatting diagnostics được report riêng rồi format owned test; không có production semantic round khác.

Không rerun broad suite hoặc tạo canary mới vì captured actual regression và frozen source đủ xử lý F1. Original51/51 vẫn evidence lịch sử;22/22 là affected FIX1 cover riêng, không cộng union hoặc suy full server/native pipeline PASS.

## Cleanup và giới hạn

Đã đọc cleanup inventory bằng parser và kiểm lại filesystem: **23/23 fixture roots và3/3 snapshot roots absent**. Mỗi fixture receipt có nonce SHA/dev/inode/UID/PID và removal log. Captured children actual exit trước snapshot cleanup; final child92861 exit0, types92832 exit0. Hai exact private PostgreSQL container IDs có absence receipts sau closure:

- RED `7eae323386ff0cb88b3ccf64488c351f62098953f33140ecdaa108d2d488da8d`, loopback61541.
- Final `6d82f06f3a11e51ab6b3748e4d2c3563d979a7eac5c4ae513542201050074ca1`, loopback61958.

Reviewer không chạy Docker/shared services hoặc cleanup lại, không tạo process fixture/DB/blob/scratch. Chỉ các readonly inspection commands đã kết thúc và file review này được tạo; không có resource mới cần thu hồi. Một inspection script ban đầu giả cleanup JSON là object thay vì list, kết thúc AttributeError sau khi đã kiểm source/evidence; lần đọc list đúng sau đó kiểm đủ mọi receipt. Đây là lỗi đọc evidence của reviewer, không test/product failure và không có mutation.

Hai historical57P03 runs thiếu full container IDs vẫn giữ limitation gốc, FIX1 không lấp bằng receipt mới. Task3 HTTP/access/grant/snapshot/stream wiring, Task4/5 extraction, Task6 transport/runtime và Task7 native process-kill/recovery chưa được acceptance từ report này. Cross-machine routing observation vẫn **NOT A FINDING**, deferred theo approved phase06 R3; FIX1 không sửa hoặc bật adapter đó. Không có paid/live provider call, runtime comprehension hoặc native proof certification.

**Kết luận:** original F1 **ADDRESSED**, zero unresolved findings trong phạm vi full Task2b review + FIX1 diff đã được giao. **SPEC READY / QUALITY READY** cho consumer candidate490001c; PM có thể đóng FIX1/5 và quyết định acceptance Task2b, giữ các integration gates nêu trên.
