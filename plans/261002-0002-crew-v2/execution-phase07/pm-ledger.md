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
