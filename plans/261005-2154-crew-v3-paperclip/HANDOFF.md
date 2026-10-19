# Handover Crew v3 — thực thi theo Trợ Lý PM

Cập nhật ngày06/10/2026 lúc00:06, múi giờ Asia/Ho_Chi_Minh. Đây là checkpoint đang được cập nhật. Đọc `progress.md` và kiểm Git/quota/tài nguyên trước tiếp tục; không coi tài liệu này là nghiệm thu release.

## Mục tiêu và quyền đã có

Crew v3 dùng fork Paperclip làm lõi ticket/run/scheduler/session/history trên VPS. Crew port các phần v2 phù hợp, thêm Trợ Lý chạy trên Mac chỉ định, gateway outbound và workflow chính thức BMAD/Superpowers. AI credential ở Mac, không đưa provider key lên VPS. Chỉ một scheduler và run authority.

Có đúng hai release. R1 phải thực sự chạy text request → đọc docs → workflow → code/review/merge/docs-sync trên Paperclip; skeleton hoặc prototype chưa đủ phát hành. R2 hoàn thiện file/ảnh/comment, docs graph/dedup, usage/reuse UI và app updater đã ký. V2 được giữ/port theo `v2-reuse.md`, không bỏ toàn bộ.

Owner yêu cầu PM tự chia task, chấm độ khó/chọn model, dispatch song song khi tài nguyên đủ, review từng task và cập nhật status. Dùng `.agents/skills/tro-ly-pm/SKILL.md`. Owner đã chỉ định thực thi trên nhánh `v3`. Không hỏi lại chọn phương pháp giữa các task; push/deploy không tự suy từ quyền implement.

## Nhánh, fork và checkout

| Vai trò | Checkout / branch / ref |
|---|---|
| Repo chính, plans/skill/spec | `/Users/phannhatquang/Documents/projects/crew`; branch `v3` từ main `7c090b82`; origin `git@github.com:nquangphan/my-crew.git` |
| Source v2 phải giữ | `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`; branch `codex/crew-v2-server`; SHA `51907858d0c8cdb7329759f22104f0727dbe6751` |
| Fork Paperclip thực tế | https://github.com/nquangphan/crew-paperclip; checkout `/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-v3`; branch `v3`; SHA `8f8a0ab7effbd6a0584107d8038736c134ee5047` |

Fork origin `git@github.com:nquangphan/crew-paperclip.git`, upstream `https://github.com/paperclipai/paperclip.git`. Pin `v2026.1001.0`; predecessor `v2026.916.1` tại `d554c4789ed3930f8a53ac9fdf6503b3187097da`. MIT notice và package/source refs được baseline review xác minh. Không tự cập nhật master hoặc áp toolchain v2 lên fork.

Repo chính chưa commit/push/deploy các artifacts phiên này. Fork tracked diff sạch và lockfile không đổi sau setup; `.crew-setup/` là tooling/evidence untracked. Checkout fork được loại khỏi repo chính bằng local Git exclude; không đổi tracked ignore hoặc origin repo chính. Kiểm status mới trước quyết định Git; không stash/revert edits của người khác.

## Trạng thái hiện tại

| ID | Trạng thái và phạm vi đã nghiệm thu |
|---|---|
| PM-01 | Accepted: skill validator và independent policy/behavioral review. Chưa chứng nhận runtime/API của sản phẩm |
| PM-02 | Accepted: HTML map offline, updater/parser và real Chromium interactions. Không phải UI tích hợp Crew/API/DB |
| 00-01 | Accepted: pinned source/license/toolchain/interface baseline và scoped fixes. Không phải remote proof |
| 00-02 | Accepted: khảo sát đại diện source v2 và inventory. Không chứng nhận toàn bộ v2 |
| 00-03 | Accepted: frozen install, workspace preflight, shared/SDK build và existing loader test; independent review PASS |
| 00-06 | Accepted plan-only: 5 gate, 26 test dự kiến, independent review và round1 re-review PASS; 0 test prototype đã chạy |
| 00-04 | Waiting quota: bắt đầu gate04-A sau admission mới; chưa coding hoặc chạy API/DB |
| 00-05 và các phase sau | Planned, chưa có đủ detailed brief để dispatch code |

Ledger hiện có32 planning IDs. Không có remote Paperclip tickets được tạo; không bịa remote status hoặc claim đã đồng bộ API. PM sở hữu ledger và status audit; worker chỉ report riêng. Phase00 chưa complete, R1/R2 chưa nghiệm thu.

## Evidence setup00-03 và giới hạn

Node24.14.0, Corepack0.34.6, pinned pnpm9.15.4. Lock SHA256 `d7d96cf0d98cf0946f6195e29ba173b03711a947a1c38f312b67cda56c254c22` trước/sau không đổi.

Lượt install đầu bị supervisor dừng sau4.07s khi kernel memory pressure lên warning; PID/PGID92985, exit143. Đây là resource interruption, chưa xác định install gây pressure toàn máy. Retry chỉ sau admission mới, giữ nguyên warning-stop gate và giảm network concurrency từ4 xuống1.

Retry1 frozen install exit0 sau254.94s, postinstall linked9 excluded plugins. Preflight và shared/SDK TypeScript build exit0. Loader đạt1 file/4 tests/0 skips; reviewer chạy lại cũng đạt4/4. Đây là pure loader capability validation, chưa chứng minh remote transport, JWT/API, mutation gate hoặc DB. Install sampled tree RSS peak khoảng1.85GiB; time maxRSS khoảng2.23GiB, không phải peak toàn hệ thống.

Logs giữ ở fork `.crew-setup/phase00-03/`: `measure.py`, initial `install.{log,metrics.json}` và retry1 labels `install-retry1`, `preflight-retry1`, `sdk-retry1`, `loader-retry1`, mỗi label có `.log`/`.metrics.json`. Không ghi đè bằng chứng lần failure đầu.

Native runner eval/proxy/sidecar và SDK dev-server bin từng cảnh báo ENOENT trong install. SDK TS build không chứng minh mọi bin đã relink hoặc Rust/native runner sẵn sàng. Full typecheck/test/build, Rust/native, browser sản phẩm, API/DB và gateway proof chưa chạy. Hook chặn đo dependency size nên số đó chưa biết; không bypass hook/generated paths để đo.

## Nơi đọc và thứ tự tiếp tục

1. Đọc repo AGENTS, `.claude/rules/development-rules.md`, `docs/index.md`, skill `tro-ly-pm`, `progress.md` và roadmap `plan.md`/`releases.md`. Spec ở `docs/superpowers/specs/2026-10-05-crew-v3-paperclip-design.md`.
2. Xem `baseline.md`, `phase-00-core-findings.md`, `phase-00-core-review.md`; reuse inventory ở `implementation-map.md`, `phase-00-reuse-findings.md`, `phase-00-reuse-review.md` và `v2-reuse.md`.
3. Setup brief/report/review: `phase-00-03-brief.md`, `phase-00-03-report.md`, `phase-00-03-review.md`. Không giao lại setup đã accepted.
4. Nhận report của00-06, đọc `phase-00-04-plan-brief.md`, `phase-00-04-implementation.md` và `phase-00-04-plan-report.md` khi đã được worker lưu. Plan/report đã saved/frozen và independent review + round1 re-review PASS ở cấp plan. Không dùng plan PASS làm bằng chứng runtime; đọc cả report/review trước code.
5. Tách actual prototype thành các gate theo plan đã review. Cùng core worker tiếp tục với delta và review riêng; API/DB disposable phải có backup trước schema/data mutation, port riêng và teardown. Không production/VPS deploy hoặc DB5432.
6. Chỉ sau real remote proof mới freeze mutation/spawn/recovery patch set và detailed Phase01/02. Không thay Paperclip bằng scheduler Crew thứ hai.

Các tên file không có path đầy đủ ở trên nằm trong thư mục handover này, trừ đường dẫn repo/skill/spec được nói rõ. Đọc actual source nếu thay đổi; report cũ không là quyền bỏ qua baseline.

## Các câu hỏi kỹ thuật cần prototype trả lời

- Workspace/environment realization xảy ra trước adapter.execute. Repo chỉ trên Mac phải dùng outbound target/driver phù hợp; không giả VPS cwd bằng Mac path.
- Adapter contract pinned có `createServerAdapter(): ServerAdapterModule`, Promise execute và optional AbortSignal/onCancellationReady. Không bịa SDK `cancel(runId)` method.
- Agent JWT conditional theo legacy runtime/capability/signing configuration. API capability cần token mà token thiếu phải fail closed trước dispatch. Pairing/device credential và company/project/machine grant độc lập.
- Durable ownership/adoption cùng run qua server restart, disconnect, ACK mất và stale epoch cần bằng chứng thật. Unknown process không là stopped; giữ reservation, không cấp replacement.
- Mutation guard phải sau fresh row lock, bao gồm null-actor native projection/create paths. Common machine reservation trước claim/dispatch, native warm paths và mọi writer còn cần exhaustive inventory.

Pure policy port đầu tiên dự kiến `eligibleModels`, immutable workflow-pin predicates và repair/completion predicates. Không copy lifecycle SQL hoặc queue của v2. Gateway prerequisites/beforeRelease hooks có ở v2; gap là server receipt/latch/reconcile assembly, không lặp kết luận cũ rằng hooks hoàn toàn thiếu.

## Agent context, tài nguyên và quota

Context còn giữ: `v3_core` gpt-6-astra/high, core survey→setup→prototype plan; `pm_skill_review` gpt-6.1-sol/medium, reviewer độc lập skill/inventory/map/setup; `v3_ticket_map` gpt-6.1-sol/high, map worker; `v3_prototype_review` gpt-6-astra/high, independent plan/recovery reviewer. Các task đã nhận đều đóng report/review; không có worker đang implement. Kiểm live agents trước reuse; agent bị evict không coi còn context. Reviewer không là implementer. Không spawn fresh worker chỉ vì đổi task cùng miền.

Owner hard reserve tuần1%, yêu cầu chừa đủ quota handover. PM soft stop admission3%, tăng nếu còn nhiều closure/review; không đảm bảo dừng chính xác vì quota usage có độ trễ. Snapshot06/10 00:06 weekly used97%, remaining3%; kernel pressure1, swap6060.06MiB, load1.90/3.16/4.08, disk56GiB. Soft stop đã chạm, task đã nhận đóng/review xong, không nhận code mới. Mọi dispatch/follow-up/review/fix cần snapshot mới; không đổi phần trăm thành token hoặc freeGiB.

Fourseat gồm PM; tối đa3 agent, một heavy job mỗi lượt tới khi peak chứng minh đủ. Setup đã kết thúc; own PGIDs92985/11420/18113/18682/19342 sạch. Không own server/port/watch/tunnel đang chạy. Kidy Vitest/session khác có thể cùng dùng host; không kill hoặc dọn resource của họ.

## Cleanup, status và lỗi công cụ

Giữ source v2, actual fork, plans/spec/skill/review/evidence. Raw source/archive copies trong `scratch-paperclip-source` đã dọn sau khi worker xác nhận không cần, archive hash được kiểm trước xóa. Metadata release/tag/tree/package và `scratch-cleanup.md` còn giữ; actual fork/source v2 không xóa. Không stage dependencies. Không xóa worktree hoặc cache của người khác.

Map offline ở `ticket-map.html`; refresh sau mỗi ledger state change bằng `python3 plans/261005-2154-crew-v3-paperclip/ticket-map-update.py`, self-test thêm `--self-test`. ID task theo format hiện hỗ trợ; attempted00-04P bị parser từ chối, PM đổi precursor thành00-06 và regenerate PASS. Group chỉ thống kê task con, không tự accepted release khi mọi con xanh. HTML là snapshot, phải reload.

Skill validator system Python từng thiếu PyYAML; chạy nguyên validator bằng YAML-capable runtime sẵn có đã PASS, không sửa skill script. GitHub fork CLI `--remote` với explicit repo từng unsupported; bỏ flag và fork thành công. Hook chặn logs dưới Git metadata/generated dependency paths, đã dùng tooling folder bình thường; không sửa hook/ignore để né.

Trước stop/handover phải đọc lại mọi status, open review/fix và owned process; pending remote sync có owner/retry nếu sau này đã tạo tickets. Status transitions cần expected prior/version, idempotency/read-back và reconcile lost ACK. Parent chỉ terminal khi dependencies, review, docs và acceptance riêng đạt. Event reconciliation cộng fallback5 phút là yêu cầu sản phẩm, không chỉ PM nhớ báo.

Các adapter ruling đã ghi trong skill/ledger: owner context reuse thay fresh-per-task; disjoint parallel thay SDD serial-only; primary ledger thay scratch ledger. Preserve workflow pin/role isolation, independent task review và evidence. Tối đa5 semantic fix rounds, không park load-bearing failure để gọi done.

## Delta23:54

00-06 đã saved/frozen: phase-00-04-implementation.md và phase-00-04-plan-report.md,5gate04-A/B/C/D/E với26testminimumexpected,0executed. V3 prototype plan reviewer mới A high được admission read-only; worker core giữcontext để sửa. Old core reviewer không cònlive, không giả reuse. Quota tuầnremaining5%; actualcoding00-04 chưadispatch.

## Delta23:57

Quota tuầnremaining4%;00-06review đang chốt3harnessfindings: PAPERCLIP_HOME chưaisolated, reaper chưastart trongharness, timeout15s khôngđủlease60/90s. Chưa cófinalverdict hoặcfixdispatch; chờreport đểfollow-upworker gốc mộtlượt, re-review. Khôngclaimplanaccepted hoặcprototypeimplemented.

## Delta06/10 00:00 — admission stop

Weeklyremaining3% đãchạmsoftstop; không nhận taskcode/runtime mới.00-06fixround1 current: specPASS/qualityNEEDSFIXES, fourfindings F1–F4 trong phase-00-04-plan-review.md. Worker core gốc sửa ownedplan/report, reviewer gốc scopedre-review; chưaacceptedplan. Task04-A dù không cóblocker riêng vẫnchưadispatch vìquota. Hardreserve1% vàclosurestatus/docs/process cònưu tiên.

## Closeout06/10 00:06 — trạng thái cuối lượt

00-06 đã accepted **plan-only** sau scoped re-review round1: spec/quality PASS, không còn finding mở trong phạm vi sửa. F1–F3 có plan fix; F4 đóng bằng explicit block, regression DB upstream vẫn chưa được chạy cho tới safe runner/setup hook được freeze/review. B/E workspace/recovery patch decisions là công việc thực còn lại; không miễn gate.

Không còn task đang running/review/fixing từ batch đã nhận. Sáu IDs accepted đúng scope;00-04 waiting_quota, các task còn lại planned. Remote tickets not-created, không bỏ pending status transition. Loader baseline4tests là test duy nhất đã chạy cho setup; các26test prototype chỉ dự kiến. Chưa implement prototype, chưa release, chưa commit/push/deploy.

Bước mở phiên sau: kiểm quota mới và resource, đọc skill/ledger/candidate plan+review. Nếu được admission, reuse v3_core cho04-A adapter/auth/session; trước write chốt exact package/lock policy của fork, tạo report/taskstatus và independent reviewer. Không đốt lại baseline/install hoặc recreate fork/sourcev2. Sau04-A accepted mới04-B, rồiC/D/E đúng gates; không chạy raw upstream DB regression.

Own install/test groups đã kết thúc, không own background service/port cần tiếp tục; raw duplicate source/archive đã dọn, metadata/report/logs/fork còn giữ. Handover này là latest snapshot; các delta phía trên là lịch sử, không thay current table hoặc progress ledger.
