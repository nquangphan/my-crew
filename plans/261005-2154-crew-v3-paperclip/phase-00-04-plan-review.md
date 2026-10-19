# Review 00-06 — Kế hoạch prototype 00-04

Review bắt đầu 05/10, chốt 06/10/2026, Asia/Ho_Chi_Minh. Review **plan-only**, không nghiệm thu prototype. Reviewer độc lập; chỉ sở hữu báo cáo này. Không sửa plan/source/ledger, không build/install/test/DB/server/commit hoặc spawn agent.

## Kết luận

- **Spec: PASS về phạm vi và các invariant thiết kế.** Một scheduler, core run identity, device credential khác agent JWT, unknown ownership giữ reservation, cancel cần physical proof, và workspace/recovery có gate riêng. Không coi đây là R1 hoặc production proof.
- **Quality/executability: NEEDS FIXES — 2 P1, 2 P2.** Plan chưa đủ để chấp nhận toàn bộ 00-06 là kế hoạch runnable. Các lỗi dưới thuộc bootstrap/harness/commands, không phải yêu cầu implement toàn R1 trước prototype.
- **Riêng 04-A:** không tìm thấy blocker bắt buộc phải giải xong workspace/recovery trước unit adapter gate. Có thể cho phép riêng gate này sau PM admission và chốt package/lock policy đã nêu ở plan. Không suy từ điều này rằng B–E sẵn sàng chạy.

Scope: [implementation plan](phase-00-04-implementation.md), 272 dòng; [plan report](phase-00-04-plan-report.md), 31 dòng; đối chiếu brief/spec, source seams và upstream rules. Actual fork HEAD xác minh `8f8a0ab7effbd6a0584107d8038736c134ee5047`; status chỉ có `.crew-setup/` untracked. Không có `.codegraph/`, không index. Dùng protocol `requesting-code-review` và ownership `tro-ly-pm`; không tìm thấy `scout`/`code-review` trong các skill roots đã kiểm, nên scout edge case trực tiếp trước kết luận.

Trong các link source dưới, `../../.worktrees/paperclip-v3/` là fork đã ghim.

## Findings phải sửa

### F1 — P1: Harness chưa cô lập Paperclip home trước import/register adapter

**Plan:** [dòng 127](phase-00-04-implementation.md:127), [134](phase-00-04-implementation.md:134), [264](phase-00-04-implementation.md:264). Có `localPluginDir`, storage root và instanceId riêng, nhưng không có `PAPERCLIP_HOME` hoặc contract environment trước khi import app/registry.

**Source:** [adapter-plugin-store.ts:44](../../.worktrees/paperclip-v3/server/src/services/adapter-plugin-store.ts:44) lấy thư mục từ `resolvePaperclipHomeDir()`, [dòng 100](../../.worktrees/paperclip-v3/server/src/services/adapter-plugin-store.ts:100) ghi `adapter-plugins.json`. [shared/home-paths.ts:16](../../.worktrees/paperclip-v3/packages/shared/src/home-paths.ts:16) mặc định vào `~/.paperclip`. [registry.ts:927](../../.worktrees/paperclip-v3/server/src/adapters/registry.ts:927) load external adapters ngay khi module khởi tạo. `localPluginDir` không đổi adapter store này.

**Tác động:** actual `/api/adapters/install` có thể ghi vào registration của người dùng; import sớm có thể load adapter/config ngoài task. DB/storage disposable không đủ để cô lập bài test. Restart cũng có thể đọc store khác với fixture.

**Sửa kỳ vọng:** trước import đầu tiên của API child và runner test, cấp `PAPERCLIP_HOME` task-owned và `PAPERCLIP_INSTANCE_ID` nhất quán; giữ cùng home cho restart trong một scenario, tạo mới giữa scenarios. Freeze child env allowlist cùng signing secrets sinh riêng, không kế thừa ambient credentials. Assert registration/log/config nằm trong owned root và cleanup không chạm home người dùng. Chốt trước **04-B bootstrap/04-C registration**, không chặn unit thuần 04-A.

### F2 — P2: Restart harness chưa có đường thực sự gọi reaper/adoption

**Plan:** [dòng 134](phase-00-04-implementation.md:134) boot bằng `createApp`; [206–207](phase-00-04-implementation.md:206) đặt adoption trong reaper; [260](phase-00-04-implementation.md:260) chỉ nói restart và đợi adoption 90s.

**Source:** `createApp` không gọi `reapOrphanedRuns`. Startup reaping thuộc [index.ts:1488](../../.worktrees/paperclip-v3/server/src/index.ts:1488); periodic path ở [index.ts:1761](../../.worktrees/paperclip-v3/server/src/index.ts:1761) dùng stale threshold 5 phút. Service có export `reapOrphanedRuns` tại [heartbeat.ts:29440](../../.worktrees/paperclip-v3/server/src/services/heartbeat.ts:29440). Lease 60s tại [legacy-controller-lease.ts:7](../../.worktrees/paperclip-v3/server/src/services/legacy-controller-lease.ts:7).

**Tác động:** restart `createApp` rồi polling không kích hoạt patch recovery. Nếu sau này vô tình reuse periodic startup path với ngưỡng 5 phút thì 90s cũng không chứng minh adoption. Test có thể chỉ timeout hoặc phải bổ sung hành vi chưa được freeze.

**Sửa kỳ vọng:** ghi exact bootstrap seam trong `crew-remote-server.ts`: fresh child/boot UUID, load adapter registry hoàn tất, sau real lease expiry gọi actual `heartbeatService(db).reapOrphanedRuns(...)` với stale policy rõ; capture evidence call→CAS→same-run reattach. Hoặc freeze đường production bootstrap khác cùng lifecycle shutdown. Không chỉ gọi sidecar `adoptRemoteRun` trực tiếp để thay kiểm core path. Chốt trước **04-E**, không yêu cầu quyết định toàn finalizer patch bây giờ.

### F3 — P2: Lệnh recovery test hết timeout trước khi lease có thể hết hạn

**Plan:** [dòng 210–225](phase-00-04-implementation.md:210) dùng `it(...)` không timeout override, chờ lease thật 60s; [260](phase-00-04-implementation.md:260) bounded wait90s. Command dòng225 chỉ có `--maxWorkers=1`.

**Source:** [server/vitest.config.ts:36](../../.worktrees/paperclip-v3/server/vitest.config.ts:36) đặt `testTimeout: 15000`, hook/teardown 30000.

**Tác động:** scenario restart không thể đạt adoption trước khi Vitest hủy test; phần async pending có thể còn chạy trong cleanup và làm hỏng evidence hoặc scenario sau.

**Sửa kỳ vọng:** timeout per-test hoặc CLI được ghi cụ thể, lớn hơn tổng bootstrap + 90s wait + assertions, cùng bounded cleanup và abort polling trong `finally`. Ví dụ explicit 180000ms cho recovery test, chọn hook timeout theo vị trí bootstrap/teardown. Không giảm/mock lease để xanh. Sửa command/snippet trước **04-E execution**.

### F4 — P1: Regression command bỏ qua backup/DB ownership contract

**Plan:** [dòng 226](phase-00-04-implementation.md:226) chạy thẳng upstream `heartbeat-process-recovery.test.ts`; [152](phase-00-04-implementation.md:152) yêu cầu backup trước mỗi scenario/migration và không dùng helper migrate-trước-backup.

**Source:** [heartbeat-process-recovery.test.ts:251](../../.worktrees/paperclip-v3/server/src/__tests__/heartbeat-process-recovery.test.ts:251) nhận ambient `PAPERCLIP_TEST_DATABASE_URL`; [458–475](../../.worktrees/paperclip-v3/server/src/__tests__/heartbeat-process-recovery.test.ts:458) dùng DB đó và insert trực tiếp, hoặc gọi `startEmbeddedPostgresTestDatabase`. [test-embedded-postgres.ts:282–286](../../.worktrees/paperclip-v3/packages/db/src/test-embedded-postgres.ts:282) create DB/migrate ngay. Ngay support probe cũng boot embedded DB. Upstream suite không đi qua new backup helper của plan.

**Tác động:** command có thể ghi vào một external DB kế thừa environment; ngay cả khi không có biến đó, nó vẫn không tuân backup-before-mutation đã bắt buộc. Việc suite là upstream regression không làm nó an toàn theo contract riêng task.

**Sửa kỳ vọng:** bỏ quyền chạy command trần. Chỉ chạy qua task-owned runner xác minh localhost/port/ownership và backup riêng trước migration/scenario, hoặc bổ sung setup hook được review cho suite này; nếu cần thêm file/path thì PM freeze ownership trước. Không đưa production/shared DSN vào `PAPERCLIP_TEST_DATABASE_URL`. Giữ regression **blocked** nếu chưa đáp ứng contract, không tự coi global backup của new tests bao phủ suite upstream. Chốt trước **regression 04-E**.

## Scout và các quyết định chưa phải blocker

- Loader zero-argument `createServerAdapter`, optional token/cancel callbacks và `supportsLocalAgentJwt` khớp types/source. Source chỉ mint JWT ở legacy và có thể tiếp tục khi signing secret thiếu; fail-closed của adapter vì vậy là cần thiết. Integration phải chứng minh zero delivery/spawn cho missing/invalid/cross-company JWT, không chỉ test device token hoặc decode JWT.
- Exact POST allowlist của device ingress là giới hạn hợp lý nếu mandatory device handler và tests suffix/method/ambient session giữ nguyên. Actor none không tự có quyền: route mới phải kiểm company/machine/reservation/epoch. Chưa có implementation để chứng nhận điều này.
- Workspace resolution/realization đúng là chạy trước adapter. 04-B có RED + exact patch registry + review; không yêu cầu plan đoán hết callsites ngay. Shape `RealizedExecutionWorkspace` hoặc Mac cwd riêng chưa là proof; OS denial và full core lifecycle 04-C mới quyết định.
- Legacy lease expiry không cho phép kết luận process stopped. 04-E nêu rõ NEW recovery option/CAS; chưa giả recover SDK hook. Mapping setup/finalizer được chặn tại patch decision là hợp lý, nhưng F2/F3 vẫn cần sửa để gate có thể chạy.
- BetterAuth fixture ở dòng134 còn là nhiệm vụ bootstrap, không phải fixture đã có: helper `runner-api-server.ts` được tham chiếu **không** tạo board session. Actual factories nằm ở [auth/better-auth.ts:241](../../.worktrees/paperclip-v3/server/src/auth/better-auth.ts:241), wiring ở [index.ts:714](../../.worktrees/paperclip-v3/server/src/index.ts:714). Trước chấp nhận B, worker phải chứng minh thật session/admin role/company membership, trusted origin và isolated secret; không gọi `authReady: true` là authentication proof.
- Session pin, event digest/replay, epoch CAS và physical descendants proof được nêu rõ. Chưa có code/schema/query plans nên không thể xác nhận race-free, indexes/N+1, catch propagation hay secret redaction bằng runtime.

## Xác minh và follow-up

Tests/build/lint/typecheck thực chạy: **0**, đúng phạm vi plan review. Không có tỷ lệ type/test coverage hoặc lint count đã đo; ghi N/A, không 100% hay 0 lỗi. Source references được đối chiếu checkout thật; no runtime PASS.

TODO của implementation plan đều chưa thực thi, phù hợp trạng thái hiện tại. Trả cả bốn findings cho **worker core gốc** sửa hai owned plan/report files; reviewer chỉ re-review delta. PM cập nhật ledger, không reviewer.

Đề nghị PM giữ 00-06 `fixing` tới khi F1–F4 được xử lý trong plan. Có thể tách quyết định cho 04-A chạy riêng nếu cần, nhưng successor phải qua independent gate và không được kế thừa một verdict PASS toàn plan.

**Declined to judge:** full R1 workflows/runtime/UI; production VPS/Linux isolation; exhaustive mọi mutation/native path; merge/deploy/installer; throughput và query performance thực tế — ngoài scope prototype plan hiện tại, giữ ở roadmap gates. Không bỏ qua auth/ownership/recovery thuộc prototype.

**Unresolved:** exact B host-IO patch diff, auth/module bootstrap thực nghiệm và E common-finalizer dependency map còn là bounded gate work; chưa có owner product question cần hỏi. Không cần thêm phạm vi R1 để sửa bốn lỗi trên.

## Scoped re-review round1 — 06/10/2026

**Verdict mới thay verdict vòng đầu: Spec PASS; Quality PASS cho kế hoạch có các gate và giới hạn đã ghi. F1–F4 đóng ở cấp sửa plan; 0 finding mở trong delta này.** Chưa có prototype implementation/runtime acceptance. Đặc biệt, đóng F4 không có nghĩa upstream DB regression đã chạy hoặc đã đạt.

Đã đọc revision implementation 292 dòng ở các đoạn sửa và closure table của worker; kiểm hẹp lại actual exported reaper/signature và registry readiness. Không đọc lại toàn baseline, không mở rộng audit sang 00-05. Fork status vẫn chỉ `.crew-setup/` untracked; không source write. Tests/build/DB thực chạy **0**.

| Finding | Verdict | Bằng chứng closure trong plan hiện tại |
|---|---|---|
|F1/P1|Đóng — plan fix đủ|Dòng129–137: NEW Node-only runner tạo owned home/instance và fresh child env trước Vitest/config/app/registry imports; tách gateway khỏi signing secret/DB; giữ home qua restart, đổi giữa scenario; registration/path assertions. Dòng58 đã thêm runner vào ownership map, B–E commands đi qua runner. Runtime isolation còn phải chứng minh khi implement B/C.|
|F2/P2|Đóng — plan fix đủ|Dòng217: fresh API child chờ registry/app ready và real lease expiry, private IPC gọi actual `heartbeatService(db).reapOrphanedRuns({staleThresholdMs:0})`; có evidence core call→CAS→same-run reattach. Source `heartbeat.ts:18744,29440` xác nhận signature/export; `registry.ts:958` có `waitForExternalAdapters()`. Không còn dựa vào `createApp` tự chạy reaper hoặc polling5 phút.|
|F3/P2|Đóng — plan fix đủ|Dòng232–240: test240s, hook60s, outer300s; bounds30+90+15+45s nằm trong test budget; abort/drain và nested finally vẫn gọi cleanup khi drain lỗi. `abortPending` đã có trong typed harness dòng256. Không mock/giảm lease.|
|F4/P1|Đóng bằng explicit block — regression vẫn pending|Dòng241 bỏ raw DB regression command và cấm ambient DSN; safe runner/setup hook phải được PM freeze/review trước probe/migration/scenario. Dòng242 tách loader-only regression và yêu cầu kiểm không DB mutation. Plan nói rõ chưa được gọi toàn04-E verification complete khi DB regression blocked. Đây là đúng resolution đã yêu cầu, không phải miễn gate.|

Không thấy breakage mới đủ bằng chứng trong phạm vi bốn sửa này. New runner và bootstrap là **deliverable phải implement**, không executable đã tồn tại; review này chấp nhận hướng dẫn thực thi theo gate, không chứng nhận binaries/BetterAuth/module closure đang ready. 04-B workspace patch và 04-E finalizer/adoption exact diff vẫn cần review riêng như trước.

Đề nghị PM có thể chấp nhận **00-06 plan-only** và giữ 00-04 chưa triển khai. 04-A không bị chặn bởi F1–F4; chỉ bắt đầu sau admission/ownership theo PM. Upstream process-recovery regression tiếp tục **blocked/not run** đến khi safe-hook contract được freeze và review; không được mất trạng thái này khi handoff hoặc closeout 04-E.

Unresolved của scoped re-review: không có câu hỏi cần owner quyết định; các technical gate và regression block nêu trên vẫn còn công việc thực tế.
