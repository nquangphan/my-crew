# SDD ledger — plan: plans/261002-0002-crew-v2/phase-07-web.md

## CREWV2-701 — Task1 bootstrap

Status: static preflight, no web implementation accepted.

Ruling: owner authorized complete v2 web rewrite, approved UI and docs/plans in worktree; adding necessary web source coverage is within that approved scope. CREWV2-701 is the PM-assigned actual local work-item key (not a remote ticket). Source/shared/unassigned changes will be limited to web/src and web/scripts coverage, tied to this work item, reviewed and committed with Crew-Owner-Approved: CREWV2-701; protection must be validated explicitly. Wrong ruling costs reversible manifest/source rework, not a deployment.

Detailed plan FIX1 review APPROVED R1–R5; report phase-07-plan-fix1-re-review.md SHA d1f1d4ca741a259bdcdb6b5819ae93fec0644d422c458f2af1bd986747f23364. All live producer gates stay pending. T1 accepted feaea55 only storage/schema/inbox.

Task1 preflight must freeze actual buildApp/captureMigrations/databaseFixture/bootstrapOwner contracts and exact migration prefix001–011. Missing contract or lifecycle ownership blocks its integration acceptance; source milestone never counts as API/DB/browser acceptance.

Task1: active web_bootstrap, exclusive fourteen planned web paths transferred for source/RED authoring, execution/install held until sole-heavy slot. Static preflight FULLREAD/hash7ce19b0d3813bf803a16ac740106a5cf6fda94d5320a3e02c39abc7e31c111b2; fifteen official registry pins200 and actual accepted assembly/migration001–011 hashes captured.

Ruling: web-owned physical fixture coordinator reuses connectDb/captureMigrations(11)/migrate(same captured set)/bootstrapOwner/buildApp; it replaces reuse of test-only databaseFixture/test-db runner because their unconditional force-drop/finally-stop would delete UNKNOWN resources. No server helper changes. Wrong ruling costs test-harness rework; acceptance requires real isolated HTTP/PG and measured lifecycle, not mocks. No DROP FORCE or unconditional stop. Registry identities recorded before resource creation, unknown resources retained with bounded return and nonsecret checkpoint.

Ruling: one worker-scoped withFixture callback owns API/Vite programmatic listeners on OS-assigned loopback ports and DB/container through the run. Playwright config workers1 owns no duplicate webServer; browser contexts close before fixture teardown. MCP preview later consumes separate explicitly owned coordinator mode. No preselect/free-port race or shared service restart. Source milestone never equals A1 acceptance.

20:35 Task1: all fourteen paths authored. Prior eleven-path workspace1/1/typecheck/build/scopedBiome verified; lifecycle RED now reports 3/3 semantic failures against deny scaffold (callback not entered, identity mismatch and STOP-unverified cleanup results missing), no import failure. No PG/browser/listener created; test reaped and heavy slot released. Worker may implement three physical fixture paths Node-free; actual GREEN, A1 and MCP acceptance remain pending. Weekly46used54remaining.

20:48 Physical fixture candidate authored Node-free. Actual lifecycle GREEN-only slot granted after fresh pressure1/available5.63GiB/idle76.36/disk25.729, weekly49used51remaining. One bounded PG18.6 and Node384 run, real OS-bound web/API listeners plus Vite/proxy, actual POST/GET session; 120s watchdog must preserve UNKNOWN on uncertain STOP, no force-drop. No browser yet; exact identity/cleanup and results pending. Scoped types/Biome permitted sequential after fresh gates, install/build/browser require separate slot. Other workers static.

21:01 Final lifecycle3/3 includes exact nonce/container/image/DBOID/ports/scratch dev:ino and cleanup results; worker reports exact container/PIDs/listeners/scratch absent. Web typecheck/build/workspace1/1/scopedBiome passed. Root full report/raw/hash review pending. MCP preview granted separately after fresh pressure1/available5.959GiB/idle84.2/disk26.668, weekly52used48remaining; script preview mode being added in original owned path, affected checks required before launch. Root owns only its browser tab; worker awaits explicit tab-close signal before fixture cleanup.

Ruling: web fixture compiler explicitly includes accepted ../server/src/platform/picomatch.d.ts producer declaration. No new ambient stub, dependency install, weakened strictness or source exclusion. Wrong ruling costs fixture type configuration rework; imported source remains checked. Earlier TS7016 preserved as diagnostic.

21:32 web four-case run: three normal/policy tests pass, actual SIGTERM child setup exits before ready; not semantic GREEN. Own UNKNOWN container ea2e1bb147cce3a69e58f749be6cf1e9d12787fca9b6b0bcec0ece4bf4693eca retained until read-only identity and catalog/activity zero reconciliation. PM authorized exact own stop/inspect/rm and dev:ino-checked scratch cleanup; worker reports absence, no DROP/force/prune. Root absence check below. Fresh source fix retains bounded real SQL readiness and nonsecret child stderr; actual startup race remains inference, not confirmed cause. Heavy slot released for Node-free edits.

21:35 web focused actual SIGTERM GREEN reported1/1 exit0 after SQL-readiness/signal fixes. Exact child/container/scratch cleanup asserted; root final raw/hash review pending. Final all4 lifecycle + scoped types/Biome/build/workspace required on freeze; no browser yet. B1 FIX1 targeted8 regressions source-authored only, queued behind web slot.

Task1 FIX1/5: full independent review95fc6c1a SPEC issues/QUALITY Needs fixes; I1 unbounded active-request cleanup mandatory. Original worker authoring actual incomplete-body shutdown RED, script/support baseline unchanged; released soleheavy21:59 after fresh5.975GiB/pressure1/idle78.11/disk24.552 weekly64used36remaining. M1 falsy callback rejection minor (deferred), wholebranch review must triage before merge. Cannot-verify items: historical final4 raw/checklogs transcript-only, literalzoomunmeasured coveredlayout-equivalent ruling, separate768/hardcrash notmeasured; no fabricated PASS. Root docs/R6/generated integration still pendingTask1acceptance.

22:09 Task1 FIX1 actual incomplete-body RED exit1 ACTIVE_REQUEST_CLOSE_DEADLINE observed, raw583f2b2d preserved; own socket destroyed after deadline and original cleanup exactSTOP/absence. Nodefree bounded cancellation/phase deadlines authored, focused GREEN granted fresh6.197GiB/pressure1/idle84.58/disk24.546 weekly66used34remaining. Root requires raw logs on new checks; no browser/UI changes, historical MCP screenshots remain sameUI freeze. Original reviewer scoped re-review follows covering checks.

22:27 Task1 FIX1 scoped re-review915272fa fully read: active-body cleanup fixed, final5 raw verified, but I1 remains open due scratch stat resolving after REMOVE timeout/UNKNOWN then launching recursive rm without AbortSignal fence. Root confirmed actual409–412. FIX2/5 original implementer resumed regression authoring only; no Node while CPUidle7.55% fails gate. M1 remains deferred. Root verified prior known PIDs and final three owned PG containers absent. No UI reapproval/new UI run; three-path fixture delta only.

22:38 FIX2 actual helper delayed-stat RED assertionremoveCalls1vs0 raw482aa14f rootverified; old callback behavior-preserving extraction beforeRED, narrow post-stat AbortSignal fence only afterRED. FocusedGREEN1/1 raw4cc8c5a1 rootverified plus exact unit scratchZAGNfP/devino16777229:64675993 andPID84133absence. Final6/strict/Biome pending B2a stable source closure and fresh resource grant, originalreviewerFIX2 scoped follows. Existing UI11hashes unchanged/no repeatedMCP. Weekly71used29remaining, no newtask.

09:38 04/10 PM Claude: B2a GREEN118 `213cc5d` (Node24.21), full independent review đang chạy. Ruling: chạy Task1 FIX2 final lifecycle6/strict/Biome ngay trên closure `213cc5d` thay vì chờ B2a review khép — fixture chỉ import buildApp, B2a fix (nếu có) nằm trong tickets/* nội bộ — sai thì phải chạy lại final6 sau B2a fix. Gate quota đổi thành còn>5% theo owner. Web worker giữ sole heavy slot; B2a fix round (nếu có) chờ slot.

09:45 04/10 FIX2 final checks `d3f092f`: lifecycle6/6, typecheck exit0, Biome exit0 (2 warning noNonNullAssertion e2e-fixture.ts:318/:391 ngoài diff, 29 info useTemplate). Scoped re-review FIX2 `task-1-fix2-re-review.md`: I1 ADDRESSED, F1 ADDRESSED, không breakage mới.
Task 1: complete — d3f092f. S1 source và A1 (fixture lifecycle thật + shell UI evidence `ui-evidence/`) đạt; literal zoom200% vẫn là layout-equivalent ruling cũ, không claim PASS literal.
Task 1: minor (deferred): M1 callback rejection falsy trong withFixture (`v2/web/e2e/support/fixture.ts:112-115`).
Task 1: minor (deferred): Biome 2 warning noNonNullAssertion `v2/web/scripts/e2e-fixture.ts:318,:391` có sẵn trước FIX2.

09:48 Task2 dispatch (brief `execution-phase07/task-2-brief.md`, BASE ghi khi commit này). Ruling: sole heavy slot giữa các worker song song được điều phối bằng lock thư mục atomic `$TMPDIR/crew-v2-heavy-slot.lock` (mkdir, ghi owner/PID/thời điểm; rmdir khi trả) — việc tĩnh không cần lock — sai thì hai job nặng có thể chồng nhau nếu worker bỏ qua lock.

10:55 04/10 Task2 full review `task-2-review.md`: Spec ❌, Needs fixes, Critical0/Important1/Minor6/⚠️5. FIX1/5 resume implementer gốc: I1 403 CSRF/ORIGIN nhả key → suspend + refresh CSRF + replay cùng key/body.
Task 2: minor (deferred): abort khi backoff ném DOMException thô thay ApiFailure('ABORTED') (`api.ts:126,181,191,207`).
Task 2: minor (deferred): containsSecret chỉ theo tên key — sót secret dưới key trung tính, bắt nhầm tokenBudget (`pending-operation.ts:52,75-83`); cần triage trước merge vì liên quan secret.
Task 2: minor (deferred): record sai version/hỏng làm tab ngừng lưu operation im lặng (`pending-operation.ts:218-221,400`).
Task 2: minor (deferred): stream chỉ heartbeat bị proxy đóng sớm tính failure, 6 lần → failed không có UI retry (`events.ts:362,373,442`).
Task 2: minor (deferred): logout DELETE lỗi mạng xóa local nhưng session server còn sống (`session.ts:276-284`).
Task 2: minor (deferred): upload 5xx không retry/ambiguous — chấp nhận tới G2, cần ghi docs flow (`api.ts:217-248`).
Ruling: ⚠️ listener-before-GET, focus refetch, login/expired vào router thuộc lượt controller wiring `main.tsx`/`router.tsx` sau khi Task2 khép; ⚠️ tab mới đọc journal từ 0 cần producer server "latest cursor" — đưa vào backlog phase07 producer G, không chặn Task2 — sai thì tab mới chậm với journal lớn.

11:25 04/10 Task2 FIX1 `a69ea3b` scoped re-review `task-2-fix1-re-review.md`: I1 ADDRESSED; mới N1 Important (resume tombstone gặp 400/413/415 nhả key), N2/N3/N4 Minor. FIX2/5 resume implementer.
Ruling: nâng N2 (mutate song song nhả key) và N4 (replay sau abort) vào FIX2 dù reviewer xếp Minor — cùng bất biến chống mutation trùng, nằm trong delta đang sửa — sai thì tốn thêm một ít diff ở vòng này.
Task 2: minor (deferred): N3 nhãn "Tạm dừng vì hết phiên" cho operation giữ vì 403 khi phiên còn sống (`session-boundary.tsx:96-100`).
Ruling: concern "không có cách bỏ request ambiguous" là quyết định UX của owner (chấp nhận rủi ro trùng) — hỏi owner khi tới UI composer/Task5, không chặn Task2.

12:00 04/10 Task2 FIX2 `6c35218` scoped re-review `task-2-fix2-re-review.md`: Approved; N1/N2/N4 ADDRESSED, N3 vẫn hoãn.
Task 2: complete — 6c35218 (source 2b958b8 + FIX1 a69ea3b + FIX2 6c35218). S2 source và A2 (lost-response→expiry→reauth→replay trên API/PG thật) đạt.
Task 2: minor (deferred, PHẢI triage trước merge): B1 cờ resumed chỉ ở memory — reload biến operation nhập lại thành thường, 400/413/415 nhả key (`pending-operation.ts:166,278-288`).
Task 2: minor (deferred): B2 thông báo "Máy chủ từ chối yêu cầu" khi payload nhập lại về tombstone — gộp với N3.
Kế tiếp web: controller wiring `main.tsx`/`router.tsx` (SessionBoundary/LoginScreen/wireSession, QueryClient retry off cho OwnerClient.get, focus refetch, listener trước initial GET) rồi theo source topo S3a/S5a/S6docs/S7basic.

12:05 Dispatch song song: controller wiring main.tsx/router.tsx (sonnet); S3a read/detail (brief task-3-brief.md, chỉ phần S3a); S5a composer source (brief task-5-brief.md). A3/A5 acceptance chờ G1/G2 — worker chỉ claim S, không claim A khi producer chưa mount.

12:30 04/10 Wiring `e901fd7` review `task-2-wiring-review.md`: Spec tuân thủ, Approved có điều kiện I1/I2 (Important2/Minor6). FIX1/5 resume: commit `e2e/app-router.spec.ts` (router thật + listener trước GET), M2/M4/M6.
Ruling: chấp nhận ngoại lệ ownership `v2/web/src/app-runtime.ts` (Node test import .ts), nút Đăng xuất trong shell.tsx, 4 locator scope `#task2-harness` ở auth/events spec — cần cho real app render login riêng — sai thì đổi lại locator.
Wiring: minor (deferred): M3 `returnTo` thành required search của /login (`router.tsx:128`); M5 runtime không dispose khi HMR dev (`main.tsx`).
Ruling: workers không amend commit (concurrency) — tạo commit mới.

12:55 Wiring FIX1 `b08a927` re-review: I1/I2 ADDRESSED, mới Important R2 thiếu app-router.spec trong manifest; FIX2/5 resume (R2, M6 có tác dụng, assert vacuous, câu docs logout).
Ruling: khi S3a/S5a gắn GET dữ liệu thật vào ProtectedLayout, controller phải thêm assert đích danh GET đó đứng sau catch-up `/v2/events` trong `e2e/app-router.spec.ts` — ghi checklist S3b/S5 acceptance.
Wiring: minor (deferred): `app-router.spec.ts:132` phụ thuộc Chromium requestfailed khi abort stream — theo dõi flaky.
Ruling 13:20: sửa `v2/docs/flows.yaml`/`files.md`/generated phải giữ lock riêng `$TMPDIR/crew-v2-manifest.lock` (mkdir) từ lúc đọc HEAD tới khi commit xong, rebase hunk lên HEAD mới nhất — wiring dbeb6da từng ghi đè entry S3a (đã khôi phục e2dd3e4, net 2 dòng đã PM kiểm) — sai thì mất entry manifest của worker khác.

13:30 Wiring FIX2 re-review `task-2-wiring-fix2-re-review.md`: APPROVED, R2/M6/assert/docs ADDRESSED.
Task 2 wiring: complete — e2dd3e4 (e901fd7 + b08a927 + dbeb6da/e2dd3e4).
Task 2 wiring: pending check: PM chạy full web `tsc` khi S3a/S5a ổn định (wiring round2 chưa có full tsc do file worker khác dở).

13:50 S3a review `task-3-s3a-review.md`: Spec ✅, Approved, Critical0/Important0/Minor6/⚠️6.
Task 3 S3a: complete — 167f79c (ba58e42 + 167f79c manifest fix + 5175e23 report). A3 pending G1/G2/G3.
Task 3 S3a: minor (scheduled S3b): M1 ticketId không lowercase → deep link UUID hoa lệch query key/invalidation và revision guard (`queries.ts:75-78,223-246`).
Task 3 S3a: minor (scheduled S3b): M2 failureText gọi lỗi local/aborted là "Máy chủ báo lỗi" (`history.tsx:41-48`).
Task 3 S3a: minor (scheduled S3b): M4 waitReason chỉ hiện ở needs_input, final_result_pending không bao giờ hiện (`detail.tsx:163-167`, `status.ts:87`).
Task 3 S3a: minor (deferred): M3 role=status bao nút và alert lồng (`list.tsx:82-106`); M5 heading phẳng h2 (`dialog.tsx:76`); M6 refetch toàn trang history/graph mỗi event — ghi giới hạn vào docs.
Ruling: docs canonical cho web là `v2/docs/flows/<flow>.md` (không phải `docs/v2/...` như brief) — chuẩn v2 docs 7 H2 + manifest — sai thì chỉ đổi đường dẫn tham chiếu.
Ruling: ⚠️ callers 4/6, hai route ticket, deep link/reload/404/zoom200%, focus-return browser test → checklist S3b + controller mount route + A3.

14:05 S5a `aa98e43` full review `task-5-s5a-review.md`: Spec ❌, Needs fixes, Important5 (I1 entity trùng qua 409 COMPOSE_ALREADY_SUBMITTED, I2 tombstone+file kẹt, I3 reserve không gắn session, I4 receiving không resume, I5 TDD vi phạm/thiếu test nhánh) /Minor7. FIX1/5 resume implementer, RED bắt buộc từng finding, gộp M5.
Ruling: `freezeSubmission` giữ là hàm thuần validate/serialize; key do `PendingStore.begin` cấp (Task2 đã accept) — lệch chữ brief nhưng đúng bất biến một nguồn cấp key — sai thì đổi chữ ký nhỏ. M1 (không có caller production) → controller dùng nó khi wiring ComposeServicesProvider hoặc xóa ở final triage.
Task 5 S5a: minor (deferred): M2 double-click race UI; M3 controller không subscribe PendingStore; M4 dispose không reject hash; M6 preview đọc hết body trước kiểm size; M7 docs tham chiếu routes.ts cũ.
Producer gap: A5/A3 chặn bởi G2 (buildApp chưa mount registerAttachmentRoutes/registerInputScopeRoutes, thiếu projection commentId→refs) và G1/G3 — PM cần xác định owner G1/G2 trong phase05/08 trước khi A3/A5.

14:20 PM tra producer gate (Explore): G1–G6 đều pending, chưa có owner chốt.
Ruling owner producer: P-G2 (mount registerAttachmentRoutes/registerInputScopeRoutes trong buildApp + projection commentId→refs, production giữ 409 INPUT_SERVICES_NOT_CONFIGURED/503 khi thiếu port phase05 Task6/phase06 routing) do controller giao một worker server ngay — không phụ thuộc phase06 T3–T7/phase04. P-G1a (filter request-root + phân trang root, route history/chronology additive, docs-related phân trang >20) giao sau P-G2. G1b (attempt/machine/model/assessment/evidence) chờ phase04/phase06 T4. G3 chờ phase06 T3–T7 (cấm bịa route Assistant). G4 phần đọc/catalogue giao sau P-G1a. G5 chờ phase08 chốt DTO; G6 chờ phase09 + native signing — sai thì phải chuyển owner, không đổi hợp đồng.
Backlog producer: "latest cursor" journal (Task2 ⚠️) gộp vào P-G1a.

15:00 04/10 OWNER QUYẾT (AskUserQuestion): (1) cho owner nút "Bỏ" draft/request bị kẹt kèm cảnh báo có thể trùng — giữ discard() của S5a; (2) thêm devDependency jsdom + React Testing Library (pin chính xác, chỉ test) vào v2/web cho component test.
S5a FIX1 `99cbff8` re-review `task-5-s5a-fix1-re-review.md`: I1–I4/M5 ADDRESSED, I5 PARTIAL, mới N1 Important (op mất sau reload/remount → Gửi lại ném SUBMIT_UNCONFIRMED vĩnh viễn) + N2–N5 Minor. FIX2/5: N1, N2–N4 (liên quan discard owner vừa duyệt), N5 tên test chứa mã finding, I5 component test bằng jsdom/RTL (worker S5a được controller ủy quyền sửa v2/web/package.json + lockfile cho đúng 2 devDeps).
P-G2 `b39f2fb`/`09803aa` xong, chờ review. Ruling: owner conversations/messages chạy production với decision authority vắng → 503 cho machine/scope/reply decisions là đúng phạm vi G2 — sai thì gỡ mount message services. Ruling: nối `attachments` vào `v2/server/src/main.ts` (loadAttachmentConfig + storage-host UUID env, chỉ Linux host) thuộc controller assembly phase08/T7 — ghi checklist; upload production 404 tới khi đó. A5 với file thật chặn thêm bởi phase05 Task5 extractor certified (503 EXTRACTION_NOT_CONFIGURED).

15:25 P-G2 review `producer-g2-review.md`: Spec đạt, Approved, Important1 (report §6 sai — PM đã đính chính trong report) /Minor5/⚠️3/mismatch7.
Producer P-G2: complete — b39f2fb (mount + by-comment). G2 vẫn PENDING cho A5 tới khi main.ts nối attachments (controller assembly, Linux host) và phase05 Task5 extractor certified.
P-G2: minor (deferred): M1 uuidPattern chỉ nhận chữ thường cho storageHostId (`app.ts`) — lưu ý khi nối main.ts; M2 thiếu test buildApp({attachments}) throw trên non-Linux/root không private; M3 by-comment hai query READ COMMITTED có thể trả nhóm rỗng khi revoke chen giữa (`comment-refs.ts:43-50`); M4 thiếu assert machine bound 200/link thừa kế/Origin sai; M5 liveLinkIds đệ quy + IN-list không giới hạn (`comment-refs.ts:41`).
7 mismatch fake web ↔ server chuyển cho S5a FIX2 (server là chuẩn).

15:55 S5a FIX2 `8c5ce41` DONE (N1–N5, I5 DOM test jsdom 30.1.1 + @testing-library/react 16.3.3, 7 mismatch G2; 102/102). Harness delta controller: fixture `e2e-fixture.ts:551` cần truyền AttachmentAssembly (+receivers port trên macOS) để mở A5 text-only — controller task sau review. Scoped re-review FIX2 dispatched.

16:05 P-G1a `fa8ccbc`/`e074bc6` DONE (level filter, history, docs-links paginated, /v2/events/latest; 37/37). Ruling: coherent full-root graph (readGraph một snapshot, `tickets/dependencies.ts`) tách thành P-G1a2 sau khi S2 FIX1 khép (tránh đụng file assistant scoped); web dùng /v2/events/latest thuộc consumer Task2 follow-up — sai thì graph có thể torn tới lúc đó.

16:15 P-G1a review `producer-g1a-review.md`: Needs fixes, Important2 (latest cursor lộ bộ đếm toàn cục cho machine; thiếu test machine/401) /Minor4. FIX1/5 resume.
Ruling: `/v2/events/latest` owner-only — web owner là consumer duy nhất — sai thì machine phải dùng readEvents scoped.
P-G1a: minor (deferred): history lộ actor.id owner/machine (nhất quán per-resource); docs-links order collate "C" không khớp PK index, thiếu test limit biên.

16:25 S5a FIX2 re-review `task-5-s5a-fix2-re-review.md`: Approved; N1–N5/I5 ADDRESSED, 7 mismatch G2 khớp server.
Task 5 S5a: complete — 8c5ce41 (aa98e43 + 99cbff8 + 8c5ce41). A5 BLOCKED: fixture Task1 chưa truyền AttachmentAssembly; file thật cần extractor phase05 Task5.
Task 5 S5a: minor (PHẢI sửa trước A5): B1 #refresh nhả khóa submit theo đồng hồ client khi compose "hết hạn" — có thể trùng nếu request cũ còn chạy; không release khi sending, dùng giờ server/biên lệch.
Task 5 S5a: minor (PHẢI sửa trước A5): B2 nút gửi còn bật trong lúc discard() chờ abandon; lỗi transport DELETE abandon bị nuốt — cờ discarding khóa nút ngay đầu discard.
Task 5 S5a: minor (deferred): B3 tsx-loader là cơ chế biên dịch thứ hai không dùng config Vite; register()/jsdom global toàn process; peer @testing-library/dom chưa khai báo trong package.json. I5 còn trống: dispose/StrictMode, reconcile sau login, invalidate sau receipt, nút abandon/chọn lại tệp, preventDefault onDrop khi khóa. Minor cũ M1/M2/M4/M6 vẫn mở.

17:00 P-G1a FIX1 `78bf6c3`/`ccb3f99`: latest owner-only + test machine 403/401, history so text, docs cursor. Sự cố quy trình: lượt RED chạy khi heavyEligible=false (3.724GiB < 4GiB, ~1s, container dừng ngay) — worker tự báo và sửa cách lấy slot; không coi RED đó là bằng chứng tài nguyên hợp lệ, GREEN chạy khi eligible. Nhắc mọi worker: phải chặn theo heavyEligible.

17:10 P-G1a FIX1 re-review `producer-g1a-fix1-re-review.md`: Approved, hai Important + Minor ADDRESSED, không breakage.
Producer P-G1a: complete — 78bf6c3 (fa8ccbc + 78bf6c3).
Kế tiếp: P-G1a2 (readGraph một snapshot nhất quán, `tickets/dependencies.ts`) dispatch; web lib/events.ts dùng `/v2/events/latest` (owner session) là follow-up Task2 sau khi controller integration khép.

17:25 S5a follow-up `cccbae1` (B1 biên 5 phút + không release khi sending; B2 cờ discarding + lỗi DELETE hiện ra; peer @testing-library/dom 10.4.2). Sự cố quy trình lần 2: pnpm add chạy trước khi kiểm heavyEligible (3.77GiB) — nhỏ, đã trả slot; ghi nhận. Ruling: B1 dùng biên lệch giờ thay giờ server vì OwnerClient chưa trả header Date — follow-up Task2 lộ Date header (cùng lượt dùng /v2/events/latest) — sai thì đồng hồ client lệch >5 phút vẫn có rủi ro. tsc đỏ do test/ticket-routes.test.ts chưa track của controller integration.

17:45 S5a B1/B2 re-review `task-5-s5a-fix3-re-review.md`: Approved; B1 (biên tạm) và B2 ADDRESSED.
Task 5 S5a follow-up: complete — cccbae1. B1/B2 điều kiện trước A5 đã đóng (B1 còn phụ thuộc follow-up Date header Task2).
Task 5 S5a: minor (deferred, xử lý cùng lượt A5): C1 trong biên 5 phút file không chuyển lượt gửi dù server đã chứng minh compose đóng; C2 tombstone DELETE abandon sau logout làm discard lặp DISCARD_UNCONFIRMED vô hạn; C3 #abandonSession coi rejected khi compose có thể còn open, #discarding không timeout.

18:00 P-G1a2 review `producer-g1a2-review.md`: Spec ✅, Approved; một caller production (routes.ts:256, Db không Tx), pool an toàn, RED tất định.
Producer P-G1a2: complete — 148875a. G1a (đọc) đã đủ cho S3b/A3 trừ G1b (attempt/machine/model/evidence).
P-G1a2: minor (deferred): hook test khớp text SQL `where root_id=` — ghi comment coupling (`ticket-graph-snapshot.test.ts:10-26`).
