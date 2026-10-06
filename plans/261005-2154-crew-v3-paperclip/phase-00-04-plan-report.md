# 00-06 — Báo cáo kế hoạch prototype 00-04

Trạng thái: **closure round1 saved/frozen để scoped re-review F1–F4; chưa triển khai 00-04**. Deliverable [implementation plan](phase-00-04-implementation.md). Actual model **A / gpt-6-astra high**, score 9=1+U3+C3+I2; giữ core context 00-01/03, không spawn agent. PM xác nhận 00-03 accepted scoped setup; [review](phase-00-03-review.md). Admission closure 06/10 00:00 kernel pressure1/free70%/swap6060MiB/load9.71/disk56GiB; quota3%, giữ reserve1%. Lượt này chỉ đọc source hẹp và ghi hai owned plan files.

## Delta đã khóa

- Source actual fork `/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-v3`, pinned SHA `8f8a0ab7effbd6a0584107d8038736c134ee5047`, branch `v3`. Không cần raw scratch source/archive nữa; PM có thể cleanup trong scope PM. Em không cleanup.
- Workspace: heartbeat resolve anchor/host workspace trước environment realization; ordinary plugin environment trả target null. Cần adapter-specific patch decision trước resolution và OS denial probe ở 04-B; 04-C mới chứng minh full core lifecycle dưới cùng boundary.
- Recovery: legacy controller/reaper không có recover hook. 04-E đề xuất server-only CAS adoption same core run và internal executeRun recovery option, giữ process nonce/cursor. Interface mới ghi rõ NEW.
- Auth: device token khác JWT. Exact POST path allowlist ở actorMiddleware dẫn tới device handler bắt buộc; không broad API bypass. Adapter routes giữ core auth; missing JWT fail closed trước attach.
- Setup native binlinks ENOENT còn unverified. Preflight đúng tsx/Vitest/module closure; SDK TypeScript compilation không chứng minh native readiness.

## Gate và review

| Gate | Nội dung | Score / actual tier | Minimum mới |
|---|---|---|---|
|04-A|Adapter auth/session/loader contract|8 / A high|8 tests|
|04-B|Workspace patch decision và backup/restore harness|9 / A high|3 tests|
|04-C|Outbound process/API/DB và admission|9 / A high|6 tests|
|04-D|Cancel và physical root/descendant stop|9 / A high|4 tests|
|04-E|Server/gateway restart và adoption race|10 / A high|5 tests|

Same core worker theo follow-up; independent reviewer trước successor. Tổng 26 là expected minimum; **0 test thực thi trong lượt lập kế hoạch**. Plan có destination map, typed production/harness interfaces, behavioral RED examples, commands/cwd, backup trước scenario/migration và teardown ownership. Không thêm scheduler hoặc paid provider.

## Self-review và giới hạn

- Coverage: same core ID/log/result/session, lost ACK, duplicate/stale epoch/cross-company, cancel startup/disconnect, unknown hold, OS isolation, backup/restore đều có gate.
- Bỏ command ellipsis; harness methods có signatures và gate implementation; task B dùng workspace probe riêng, không gọi lifecycle methods chưa có từ C. New contracts không trình bày thành existing SDK.
- Unresolved bounded decisions: B freeze exact host-IO bypass diff sau RED; E map common finalizer dependencies trước successor. Worker B phải preflight real BetterAuth fixture bootstrap và required module closure; không always-admin mock. Nếu thêm source path ngoài map, PM/reviewer xét patch registry trước tiếp.
- Local sandbox proof chưa là production VPS/Linux proof. Project-primary text fixture chưa chứng minh git worktree/finalize/merge/deploy/paid runtime/UI. Backup trước mỗi scenario và migration, không mỗi SQL statement nội bộ.
- Không sửa source/lock/schema, không mở DB/service, không chạy compilation/tests hoặc commit/push. Chỉ hai owned Markdown files; shared ledger thuộc PM.

## Closure round1 — phản hồi review F1–F4

Đối chiếu [review độc lập](phase-00-04-plan-review.md); đây là sửa plan, chưa tự đánh dấu findings được reviewer đóng.

| Finding | Delta đã lưu | Gate |
|---|---|---|
|F1/P1|NEW Node-only runner tạo home/instance và child env allowlist trước cả Vitest/config/app/registry import; secrets riêng, không ambient credential/DSN. Home giữ qua restart, đổi mỗi scenario; assert registration/config/log nằm trong owned root.|B bootstrap/C registration|
|F2/P2|Fresh API child đợi actual lease hết hạn rồi private IPC gọi actual `heartbeatService(db).reapOrphanedRuns({staleThresholdMs:0})`; capture core call→CAS→same-run reattach. Không sidecar-only adoption.|E|
|F3/P2|Recovery timeout240000ms, hook60000ms, outer300s; bootstrap30s/wait90s/assert15s/cleanup45s. Finally abort/drain mọi pending poll trước cleanup; factory failure cũng cleanup.|E|
|F4/P1|Bỏ raw DB regression command. Upstream process-recovery suite **blocked** tới khi PM freeze/review safe runner/setup hook bao phủ cả support probe/migration/scenario. Không claim new-tests backup bao phủ suite upstream.|E regression|

Kiểm tra văn bản: wrapper commands thay B–E raw Vitest; typed harness bổ sung abortPending; recovery snippet có timeout và finally abort. Exact source kiểm lại: adapter store home path, reaper signature/default0/startup call và upstream timeout15s. Không chạy test; 26 vẫn là minimum dự kiến. B/E patch decisions và auth/module bootstrap thực nghiệm vẫn giữ bounded gates, không mở rộng core scope. Plan có thể review tiếp; DB regression chưa được phép chạy và chưa được coi hoàn tất verification.
