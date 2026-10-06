# PM ledger — plan: plans/261005-2154-crew-v3-paperclip/plan.md

Timezone: Asia/Saigon. Spec: [v3](../../docs/superpowers/specs/2026-10-05-crew-v3-paperclip-design.md). Skill: [tro-ly-pm](../../.agents/skills/tro-ly-pm/SKILL.md). Owner yêu cầu thực thi 05/10/2026; constraint “chỉ lập kế hoạch” của bản roadmap cũ đã được yêu cầu mới thay thế. Deploy/push shared branch vẫn cần quyền cụ thể.

## Quyết định và admission

- Quota reserve mới nhất: **1%** (thay 25%). Snapshot mới nhất00:00 ngày06/10 báo weekly used97%, remaining3%; không quy đổi thành số token. Không nhận task mới khi remaining≤1%; đóng/review task đã nhận và cleanup. Có margin closure, không hứa dừng chính xác vì usage delay.
- Owner yêu cầu chừa quota handover: PM soft admission stop3% cho review/status/cleanup/docs, hardreserve1%; nâng margin nếu còn nhiều closure. [HANDOFF.md](HANDOFF.md) đã ghi checkpoint từ bây giờ, tiếp tục cập nhật actual status để không dồn token cuối phiên.
- Snapshot22:32: Mac24GiB/12CPU, memory_pressure free53%, load3.28/4.25/4.54, disk free63GiB. Không suy ra GiB available từ phần trăm. Chưa có heavy test/build do PM này start. Không kill process user/session khác.
- Harness4 seats kể cả PM. Bắt đầu2 worker read/light-write +1 seat review; chỉ1 heavy job. Đo mới trước từng dispatch/follow-up/review/fix.
- Source v2 giữ nguyên `codex/crew-v2-server` SHA51907858d0c8cdb7329759f22104f0727dbe6751; primary main7c090b82 chứa docs/plan untracked từ lượt trước. Không stash/revert hoặc đổi nhánh agent khác.
- Ruling: reuse cùng worker theo context group giữa các task đã review, trái mặc định fresh-task của SDD nhưng đúng yêu cầu owner; reviewer độc lập và gate từng task vẫn giữ. Cost nếu sai: context bias; reset khi context không phù hợp hoặc lỗi lặp.
- Ruling: admission/ownership PM thay SDD serial-only khi miền độc lập; ledger này thay scratch ledger riêng, evidence lưu primary plan và không xóa. Cost nếu sai: conflict hoặc recovery duplication; exact ownership/gates và task-ID mapping bắt buộc.

## Task registry

Điểm sơ bộ1–10 theo uncertainty/coupling/impact trong skill; chấm lại sau baseline. Model S=`gpt-6.1-sol`, A=`gpt-6-astra`, L=`gpt-6-luna`. Medium/high là effort. Không gán reviewer=implementer. Mỗi row có gate riêng; những task sau Phase00 là backlog provisional, chưa đủ brief để dispatch code.

| ID | R | Deliverable / context group | Depends | Score/model | State / worker / review |
|---|---|---|---|---|---|
| PM-01 | cả2 | Skill và behavioral check / pm-policy | — | 6/S medium | accepted / PM / pm_skill_review PASS policy-only |
| PM-02 | cả2 | HTML ticket map/dialog + ledger projection / tracking-ui | PM-01 | 7/S high | accepted / v3_ticket_map / pm_skill_review PASS offline-artifact-only |
| 00-01 | R1 | Exact stable tag/SHA/license/SDK, source seams / core | PM-01 | 8/A high | accepted / v3_core / v3_core_review PASS source-baseline-only |
| 00-02 | R1 | Exact v2 reuse inventory/files/tests/open gaps / reuse | PM-01 | 6/S medium | accepted / v3_reuse / pm_skill_review PASS inventory-only |
| 00-03 | R1 | Fork checkout + baseline check + source file map / core | 00-01 | 6/A high | accepted / v3_core / pm_skill_review PASS scopedsetup-only |
| 00-06 | R1 | Exact gated remote prototype plan / core | 00-01,02 | 9/A high | accepted / v3_core / v3_prototype_review PASS plan-only round1 |
| 00-04 | R1 | Minimal real outbound remote execute/session/cancel/reconnect proof / core-gateway | 00-02,03,00-06 | 9/A high | waiting_quota / PM / resume04-A after new admission |
| 00-05 | R1 | Mutation/spawn gate seams, patch decision, exact Phase01/02 plans / core | 00-04 | 9/A high | planned |
| 01-01 | R1 | Compatibility manifest, facade/patch registry contracts / core | 00-05 | 8/A high | planned |
| 01-02 | R1 | Fork sync/update CI and backup/restore test harness / release | 01-01 | 7/S high | planned |
| 02-01 | R1 | Host/app IPC/pairing/outbound transport / gateway | 01-01 | 7/S high | planned |
| 02-02 | R1 | Journal/resources/STOP/replay/recovery, single-active / gateway | 02-01 | 9/A high | planned |
| 03-01 | R1 | Workflow install/version/pin/retention/isolation / workflow | 01-01,02-01 | 8/A high | planned |
| 03-02 | R1 | Manifest/render/receipts→core story/task + gate contracts / workflow | 03-01 | 8/A high | planned |
| 04-01 | R1 | Inventory/broker/local credentials/switches / runtime | 02-01 | 7/S high | planned |
| 04-02 | R1 | Claude/Codex/API launch/tool-loop/effect/fallback acceptance / runtime | 02-02,04-01 | 9/A high | planned |
| 05A-01 | R1 | Docs standard/validator/import/read/search/snapshot / docs | 01-01,00-02 | 7/S high | planned |
| 05A-02 | R1 | Semantic review/merged-commit freshness sync gate / docs | 05A-01 | 8/A high | planned |
| 06A-01 | R1 | Session checkpoint/reuse independence + usage transport / runtime | 04-02 | 8/A high | planned |
| 07A-01 | R1 | Assistant authority/designation/tools/routing / assistant | 03-02,04-02,05A-01 | 9/A high | planned |
| 07A-02 | R1 | Resource-aware dispatch/review/owner inbox/event+5min monitor / assistant | 07A-01,06A-01 | 9/A high | planned |
| 07A-03 | R1 | Core UI extension chart/dialog/machines/models/docs/text / ui | 03-02,05A-01,07A-01 | 7/S high | planned |
| 08A-01 | R1 | Core auto-merge/tests/docs/complete/no-bypass recovery / integration | 05A-02,07A-02,03 | 10/A high | planned |
| 09A-01 | R1 | Signed installer/native permissions/runbook/manual upgrade / release | 08A-01 | 8/A high | planned |
| 10A-01 | R1 | Actual fork-upgrade/DB+blob restore + R1 acceptance / release | 01-02,09A-01 | 9/A high | planned |
| 05B-01 | R2 | Docs graph/dedup/storage semantics / docs | R1,05A-02 | 8/A high | planned |
| 06B-01 | R2 | File extraction/corpus + atomic create/comment attachment / files | R1 | 8/A high | planned |
| 06B-02 | R2 | Usage normalization/rollup/registry/delta policies / runtime | R1,06A-01 | 8/A high | planned |
| 07B-01 | R2 | File composer/docs graph/usage/registry UI / ui | 05B-01,06B-01,02 | 7/S high | planned |
| 08B-01 | R2 | Full workflow/runtime/file integrated acceptance / integration | 07B-01 | 9/A high | planned |
| 09B-01 | R2 | Signed remote updater/drain/health/rollback / release | 08B-01 | 9/A high | planned |
| 10B-01 | R2 | Full upgrade/restore/native/API/DB/browser release gate / release | 09B-01 | 9/A high | planned |

## Ownership / parallel plan

- PM owns this ledger, roadmap synchronization, integration/Git mutations. Agents own their task reports only until detailed ownership freeze.
- Core scout owns `baseline.md` and `phase-00-core-findings.md`; reuse scout owns `implementation-map.md` and `phase-00-reuse-findings.md`. Both under this plan folder; disjoint writes, source read-only. Reviewer owns `phase-00-review.md`.
- Core context worker continues baseline→facade→seam tasks using deltas after independent review. Gateway worker continues transport→journal/recovery; workflow worker install→render; docs worker standard→freshness; runtime worker inventory→launch→session. Different groups spawn when capacity permits, not all simultaneously.
- Parallel after contracts freeze: gateway/workflow/docs/UI with exact disjoint ownership. Shared registration/lockfile/migration changes go through PM serial queue. Heavy native/browser/DB acceptance serialized until measured peak supports more.
- No dispatchable implementation brief until exact upstream baseline/interfaces/tests known. Separate small task gates within context groups prevent unreviewed multi-phase implementation.

## Reports and process registry

Each report records source/destination exact files, score components/rationale, model/effort, tests/output, commit, open findings, retained v2 behavior, new behavior and cleanup. No raw secrets. Agent ID/round/review verdict updated per task by PM.

## Ticket status registry và đối soát

Hiện chưa tạo ticket trong Paperclip hoặc hệ remote khác; IDs bảng task là planning IDs, không phải ticket đã lưu server. PM chịu trách nhiệm status update/read-back cho mọi task/parent đã tạo khi core sẵn sàng; không chỉ cập nhật file này rồi claim remote done.

| Task/ticket ID | Project/parent/workflow pin | Remote status / verified time | Sync target/error/retry/owner |
|---|---|---|---|
| All current planning IDs / not-created | Await Paperclip baseline/core | Không có remote status | PM tạo/map khi ticket core sẵn sàng |

Map actual state machine trước transition; report/review/docs gates trước terminal. Event+5 phút fallback audit remote status, parent dependencies, evidence và pending sync. Timeout thì read/reconcile trước retry; pending status không PM close. Closeout/handoff/quota stop phải có status audit/checkpoint cho mọi ticket đã tạo.

| Task | Process command / PID / port / checkout | Needed / cleanup |
|---|---|---|
| 00-03 | Git clone session11053 PID65918 +children ended exit0; checkout .worktrees/paperclip-v3 actualfork | Retain code checkout, no server/port/orphan |
| 00-03 | corepack frozeninstallPID92985 endedSIGTERM143 after4.07s kernelpressure1→2; treeRSSpeak559568KiB, .crew-setup/phase00-03logs | Worker reports no survivors; deps incomplete, SDK/tests not-run; checkpoint before resource retry |

## Event log

- 22:31–22:33: Read skills/rules/plan; resource and quota verified. Baseline skill scenarios run with same L worker via follow-up, isolated context.
- Owner lowered reserve to1%; resumed admission eligibility. No implementation claim yet, no fork/deploy/push yet.
- 22:36: Owner yêu cầu nhánh v3; tạo `v3` từ main7c090b82 và giữ các file đang soạn. Nhánh/source v2 không đổi. Mọi implement/report tiếp theo trên v3; Git mutations serialize bởi PM.
- 22:36: Resource fresh24GiB/12CPU/free50%/load4.28, disk63GiB; admitted independent `pm_skill_review` S medium, owns pm-skill-review.md only, no heavy job. Static validator first failed missing PyYAML in system Python; rerun unchanged validator on existing YAML-capable uv runtime passed.
- Skill review round1: 2 P1/2 P2 confirmed; clarified parallel/ledger precedence, prose model floor/actual follow-up model and binding quota windows. Scoped re-review pending; no project worker dispatched before skill gate.
- 22:41: Round1 skill spec/quality PASS4/4; user added ticket-status responsibility, scoped addition review in progress. Started 00-01 `v3_core` A high read-only source and PM-02 `v3_ticket_map` S high disjoint HTML writes; pm_skill_review S medium is third light seat. Latest fresh free49%,load7.40,disk63GiB, weeklyremaining14%, reserve1%; no heavy jobs admitted.
- PM skill-created-before-execution requirement satisfied; added ticket-status audit ongoing. Exact fork baseline still pending. All remote tickets remain not-created.
- Skill status-section scoped review PASS spec/quality,0 open. PM-01 accepted policy/behavioral simulation only; validator PASS on existing uv Python. No runtime API certification implied. Review report pm-skill-review.md contains original/fix/addition verdicts.
- 22:44: Admitted00-02 v3_reuse S medium read-only source/light report; fresh free52%,swap1350MiB/load5.13/disk63GiB, quota14%. Three agents core/map/reuse, PM fourth seat; no further dispatch until a seat frees. Updated spec/phase07 to require actual PM status reconciliation, not ledger-only claim.
- 22:47: fresh free46%,swap1326MiB/load7.98/disk63GiB; weeklyremaining13%. No new dispatch/heavy build. Source baseline early tag v2026.1001.0 fullSHA8f8a0ab7effbd6a0584107d8038736c134ee5047; final source/seam evidence and independent review pending.
- PreToolUse hook blocked checking bundled docs CLI path because `dist` filter; no bypass/config changes. Docs pre-commit gate not yet verified; no commit/push performed.
- 22:56: 00-01/00-02 implemented report scope only, moved in_review. Actual SDK1.0.0/adapter-utils0.3.1 from pinned source;13critical blobs checked by worker against official tree. Pure-policy ports chosen P01/P02/P03; lifecycle stays core. Native/runtime/exhaustive bypass proof still open; no Phase00 complete claim.
- 22:57: Admitted v3_core_review A high và reused pm_skill_review S medium cho00-02 (không phải implementer). Fresh free35%,swap1412MiB/load7.44/disk63GiB,remaining11%;3light seats gồm mapworker. Handover checkpoint viết trước closure, softreserve3% theo PM budget để đáp ứng owner, không đổi hardreserve1%.
- 23:04: 00-02 P3references fixed + scopedreviewPASS; accepted bounded inventory.00-01 F1/F2 fixed, scopedrereview next. PM-02 implemented31tasks/realofflineChromium evidence, in_review by existingpm_skill_review S medium (actualeffort), no fullsuite.
- Actual fork created https://github.com/nquangphan/crew-paperclip (no primary remote mutation). First CLI attempt rejected unsupported --remote with explicit repo; removed unsupported flag, fork succeeded. Clone registered .worktrees/paperclip-v3, localGit exclude added only for that checkout; no source v2 or tracked .gitignore change. No code branch push/deploy.
- Admission23:04 free41%,load4.88,disk61GiB,remaining10%; clone controller-owned plus2lightreview contexts, no heavy build yet. Sourcebaseline review allowed checkout independently of reportfixes, not overallPhase00PASS.
- 00-01 scoped F1/F2review PASS0open; accepted SOURCE BASELINE only. Full Phase00/prototype/native/build not accepted. Node24.14.0 meetsfloor; rootpnpm10.32.1 differs pinned9.15.4, corepack exists; rustup notinstalled from command probe. Toolchain/baseline gate must record actual setup evidence next.
- PM-02 review round1 P2: release/root aggregate returns accepted without explicit gate (also empty list). Spec/qualityFAIL, status fixing. Original worker to fix neutral aggregate + regression, rerun covering browser/parser; standalone artifact not accepted until scopedreview.
- 23:14: Clone completed exit0; upstream added/fetched two tags, localfork branchv3 pinned8f8a0ab7effbd6a0584107d8038736c134ee5047, clean. Primarybranchv3/sourcev2 unchanged. Admitted SAME v3_core A high for00-03 scopedsetup; score6 remains, actualtierA retained for future00-04context (not measured savings). Snapshot free67%,swap8254MiB/load4.70/disk55GiB,remaining10%; one measured dependencyinstall only, capchildconcurrency1 if CLI supports, no Rust/fullsuite/native/DB.
- PM-02 fixround1 implemented: all-child-accepted and emptygroup regression reproduced then PASS; root/release/phase neutral child-statistics dots, no fake groupacceptance. Worker Chromium covering interactions PASS snapshot236b6b1e39a0; in_review scoped fix, artifact-only.
- PM-02 scopedreview spec/qualityPASS0open; independentChromium via sanctionedpackage runner passed aggregates/allaccepted/empty/dialogEscape/mobile/errorchecks. Accepted OFFLINE ARTIFACT only; regenerate after status changes, no API/DB/release claim.
- 00-03 frozeninstall stopped by worker supervisor at kernel warning, peak~546MiB/4.07s, exit143; lock unchanged, no survivors reported, .crew-setupuntracked only. Status blocked_resource/checkpoint; no full/native/SDKtest run. Diagnose current/stable resource before retry, no source/lock/env bypass.

- 23:22: Owner nhắc reserve handover; PM cập nhật HANDOFF ngay với PM-02 accepted,00-03 blocked_resource và exact resume/logs. Weeklyremaining9%; kernelpressure1/swap7778.94MiB/load8.05/disk56GiB. Reconcile không còn owninstaller PGID92985 hoặc server/test. Không dispatch heavy từ snapshot đơn lẻ; closure margin3% sẽ tăng nếu lượng việc đang chạy cần nhiều review. Remote tickets vẫn not-created, không có pending transition bị bỏ lại.

- 23:29: Owner yêu cầu tiếp tục, quotaweeklyremaining8% (>soft3%). Freshkernelpressure1/free79%/swap6953.62MiB/load3.58/4.25/4.93/disk57GiB, không ownbackgroundjob. Admitted một controlled retry00-03 cùng v3_core A high/context, child1/network1, supervisor warning stop giữ nguyên; không chạy heavy song song. Trackedsource/lock immutable, reviewgate trước00-04.

- 23:32: Retry1 đang download/link tiến triển (resolved1301/downloaded642), kernelpressure1. Supervisor11414, timewrapper11420/PGID11420, corepacknode11422; fork cwd, không service/port. SnapshotRSS node~919MiB tại02:43, không coi là totalpeak. Mộtheavyjobđangchạy; không dispatchheavykhác.

- 23:38:00-03 worker report saved/frozen: retryinstall/preflight/SDKbuild exit0, loader1file4PASS0skip; lock unchanged/trackedclean, no ownPGIDs. Admit independentpm_skill_review S medium scopedsetup review only, noinstall/full/native/DB. Kernelnormal at admission; weeklyremaining7% lastprovidercheck23:34, hard1/soft3. Resourcecheck command attached this event; exact currentmetrics reviewerreport.

- 23:38: Admit00-06 samev3_core A high, planning-onlydisjoint fromsetupreview. Freshremaining7%/pressure1/free74%/swap6577MiB/load7.92/disk55GiB. Ruling: detailedplanresearch depends acceptedsource00-01/02, notsetup00-03; actualcoding/runtime retainssetupreviewgate. Costifwrong: source-dependentplanrevision; noexecutionbeforegate. Briefphase-00-04-plan-brief.md; noheavyjobs/sourcewrites.

- Maprefresh rejected invalid taskID00-04P beforewritingartifact. PM aligned newplan-gateID to supported00-06; no parser/source change. Regenerate/selftestnext.

- 23:41:00-03 independentreview specPASS/qualityPASS0blocking. Reviewer rerunloader1file4PASS0skip, Git/remotes/toolchain/frozenlock/processproofverified. Accepted scopedsetupONLY; native/Rust/full/API/DB/remote readiness pending. Task00-06 planningstillrunning;00-04actualproof plannedpendingplanreview.

- 23:47: Weeklyremaining5% (used95%), vẫn trênsoft3%.00-06detailedplan đang chạy, không admitjobheavy. Closure gồmplanreview/fixes/status/process/handover; tasksetupaccepted và mapcurrent. PMcleanupscratch chỉ sauworkercore confirms khôngcầnrawcopies.

- 23:51: Coreworker confirms no scratchneeded, traces dùng actualfork. PM verifiedarchivehash rồi xóa onlyownedsource.tar.gz +unpackedv2026.1001.0; giữofficialmetadata/sourceevidence vàactualfork. scratch-cleanup.md lưuprovenance; no globalcache/others/sourcev2deletion.

- 23:54:00-06 saved/frozen272lines,5prototypegates/26expectedtests(0executed). Admit freshindependentv3_prototype_review A high(score9) because oldcorereviewcontextnotlive and S reviewer insufficientauthorityrisk; notfreshimplementationcontext. Freshremaining5%/kernel1/free68%/swap6068MiB/load2.96/disk56GiB; read-onlyplan/source review,noheavyjobs. Samecoreworker reservedfixes.

- 23:57: remaining4% (used96%);00-06planreview found3harnessissues, finalreportpending. Knownfirst04-A notblocked butwholeplan needsfixreview. Closureplanfix/re-review/status/handover reserved, no runtimeimplementationdispatch yet. Kernelnormal/free72%/swap6068MiB/load4.98/disk56GiB; noownheavyjobs.

- 06/10 00:00: Weeklyremaining3%=softstop, no newfeature/runtimeadmission.00-06specPASS/qualityNEEDSFIXES(2P1/2P2): isolatePapercliphome, actualreaperbootstrap, testtimeouts, regressionDBbackupownership. Admitclosurefixround1 SAMEv3_core A high onlyownedplan/report; freshkernel1/free70%/swap6060MiB/load9.71/disk56GiB, read-onlysource/noheavyjobs. Re-reviewclosure remainsallowed, hardreserve1%; checkpointifallowanceends.

- 06/10 00:04: Closurefixround1 saved/frozen292lines+report. F1isolatedpreimportenv/F2actualreaper/F3timeoutsabort/F4rawDBregression explicitlyblockedpendingownedbackup-safehook. Admit SAMEv3_prototype_review A high scopedF1–F4 only; freshremaining3%/kernel1/free70%/swap6060MiB/load2.23/disk56GiB,noheavyjobs. Plan/runtimeacceptance notclaimed.

- 06/10 00:06:00-06 scopedrereview specPASS/qualityPASS plan-only,F1–F4closedatplanlevel. F4upstreamDBregression remainsblocked/notrun pendingreviewedbackup-safehook; B/E exactpatchdecision gates openwork. No00-04implementation/tests.
- Closeoutaudit00:06: acceptedPM-01/PM-02/00-01/00-02/00-03/00-06(6distinctscopegates);00-04waiting_quota, otherbacklogplanned. Remoteallnot-created/no pendingremote transition. Currentweeklyremaining3%, no newadmission; exactnext04-Apackage/lock freeze→RED tests→implementation→independentreview. No worker running/noowninstall/test/server/port survives; forksourceclean/.crew-setupuntracked. Primaryv3 artifactsuncommitted/no push/deploy. HANDOFFupdated; HTMLrefresh+selftestnext.
