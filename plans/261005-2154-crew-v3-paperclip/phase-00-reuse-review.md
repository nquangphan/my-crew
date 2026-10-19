# Review độc lập 00-02 — reuse inventory

Ngày05/10/2026, Asia/Saigon. Reviewer `pm_skill_review`, không implement00-02. Áp dụng tro-ly-pm; chỉ sở hữu file này, không sửa reports worker/ledger/source. Score6 =1+U2+C2+I1; actual model `gpt-6.1-sol`, effort medium theo PM/harness hiện tại. Admission PM22:57: memory_pressure free35% (không quy đổi GiB), load7,44, disk63GiB, quota11%, reserve1% và closure margin; chỉ light source/report review, không heavy suite.

## Verdict

**Spec compliance: PASS trong bounded inventory gate. Quality: PASS với một minor P3 không chặn.** Có thể accept00-02 là inventory/task refinement đã review; chưa accept pure port, native runtime, integration, workflow certification hoặc sản phẩm v3.

Inputs: `implementation-map.md`, `phase-00-reuse-findings.md`, brief00-02 tại `phase-00-briefs.md`. Source read-only `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`; reviewer xác minh HEAD full `51907858d0c8cdb7329759f22104f0727dbe6751`. `.codegraph/` không tồn tại nên không sử dụng/index. Đọc root/v2 docs index và domain/workflow/server-platform/docs/runtime/assistant flow trước representative source. Không read toàn repo.

## Evidence reviewer tự xác minh

- Mở rộng brace/glob các path fully qualified trong bảng inventory/manifest: **157 path patterns**, tất cả có match. Đây là kiểm tồn tại paths, không phải audit implementation157 files; các shorthand/supporting paths khác vẫn theo mức kiểm worker công bố.
- Đọc manifest domain/gateway/server/web/desktop/docs-kit: versions/dependencies/scripts khớp báo cáo; không có package exports, domain không runtime dependencies. Gateway test build trước node:test; server DB runner khác unit runner; web E2E Playwright và docs-kit Vitest. Chưa install/typecheck/run tests.
- Đọc bốn policy source và model/completion test: eligibleModels đúng machine/source-switch/revisions/capabilities; workflow pin check và exact targets; completion giữ evidence/mandatory/docs merged-commit; deploy authority tách riêng. `transition` là graph riêng v2, `recordRepairFailure` độc lập. Candidate đầu chỉ port predicates/repair cap, **không copy graph/lifecycle/scheduler/SQL chain**. Trusted readers/core adapter vẫn bắt buộc, boolean input không chứng nhận permission.
- Source gap `main.ts` chỉ truyền DB/origin/cookie/key/time; `app.ts` default deny dispatch/final result, không assembly Assistant. Legacy preflight luôn throw `ISOLATION_NOT_BOUND` và factory có implementation; RuntimeAdapter là interface, RuntimeAdmission có test-certification. Không đánh schema/interface/fixture thành native capability.
- Registry export `WorkflowRegistry` tồn tại line98, imports journal/process/build/owned operations; capacity export không import dependency. Đọc pin-retirement test thấy default deny/missing actual STOP và exact receipt tests; sự tồn tại test không chứng nhận PASS hiện tại.
- Gateway prerequisites hook tồn tại59–63 và tiêu thụ241–243; bridge beforeRelease61 và gọi279–286 trước launcher.release. Worker nêu đúng gap là server receipt/prerequisite witness/latch/reconcile/assembly, không nói thiếu gateway hook.
- Assistant tool unresolved enum `TOOL_NOT_RELEASED`276 và thiếu assembly503 ở404 vẫn tồn tại. Docs checksum import canonicalJson; validator/source test có byte/CRLF/Unicode/base64/duplicate-path checks. Docs canonical/contracts dependency đã ghi trong proposal, không gọi toàn pipeline thuần independent.
- Source git status cho representative source set không có tracked mutation. Các reads/review không tạo background job, DB/container/process/dep/commit. Không có resource của reviewer cần stop ngoài evidence file yêu cầu giữ.

## Acceptance từng yêu cầu brief

| Yêu cầu | Kết quả |
|---|---|
| Source SHA/path/export/test, giữ vs adapter vs mới | PASS: inventory14 rows theo category, exact source + regression + deps/verdict; representative verification trên candidate đúng SHA. |
| Inspected/uninspected scope cho retained modules | PASS: đoạn mức kiểm chỉ rõ bốn policy/test đọc đủ, representative entry/import/export ở mọi retained group; supporting implementation/native/parser/UI/SQL/ledgers chưa audit đủ. Không suy luận toàn category complete từ symbol. |
| First pure-policy/docs/gateway primitives, no lifecycle duplication | PASS: initial predicates/repair cap tách graph; docs canonical adapter dependencies nêu rõ; capacity không tự spawn. |
| Context task breakdown, score/model/deps/ownership và parallel | PASS: P/C/G/T/W/M/R/A/D/U/F slices đủ deliverable review; U/C/I score/model/effort rõ. Path đích logical/provisional, shared schema/facade/entry/lockfile serialize, không coi bảng này là code brief. |
| Known gaps/historical tests | PASS: receipt/render/uv/assistant/native/Keychain/effect uncertainty/corpus/updater và deferred ledger IDs giữ pending triage. Historical PASS không dùng chứng nhận v3. |
| Upstream destination chưa baseline | PASS: exact destination/signature/toolchain chờ00-01/03; không bịa upstream paths hiện tồn tại; không metric reuse theo LOC. |

## Finding

**P3 — Sai line reference của default deny trong app.ts.** `phase-00-reuse-findings.md`, mục Gap xác minh trực tiếp, ghi `app.ts:99` composition và default deny108–109; tại pinned SHA, buildApp ở91, authorizeDispatch default deny ở95 và verifyFinalResult ở96. Symbol và kết luận đúng; line reference dẫn reviewer tới nhầm đoạn. Sửa hẹp references thành91/95–96. Không cần sửa source, chạy suite hoặc làm lại inventory. Minor này không thay đổi gate; PM ghi deferred hoặc nhờ worker sửa report trước final handoff.

## Giới hạn và câu hỏi còn mở

Không audit hết v2 hoặc xác nhận historical findings vẫn lỗi/đã fix. Chưa run commands test; source-test reads chỉ xác nhận negative intent tồn tại. Exact destination/core mutation/spawn/run/session/approval/grant contracts, commands trên v3 và deferred ledgers triage cần giải trước code dispatch. Không gọi inventories là production-ready. Không còn blocker cho bounded00-02 ngoài minor reference cần đồng bộ trước dùng làm evidence lâu dài.

## Scoped re-review P3 — vòng 1

Admission PM23:03 Asia/Saigon: memory_pressure free49%, load3,27, disk62GiB; quota11%, hard reserve1%, soft3%; light review đã nhận. Không đổi free% sang GiB, không admission thêm task hoặc chạy suite.

Đọc đúng dòng report đã sửa và Fix evidence, đối chiếu `nl -ba` source app.ts: comment composition **91**, export `buildApp` **92**, default `denyDispatch` **95**, default `denyFinalResult` **96**. Candidate references92/95–96 đúng; Fix evidence mô tả command và pinned full SHA. Reviewer vòng đầu ghi buildApp91 đã gộp nhầm comment với export; vòng này xác nhận export92 mới chính xác.

**P3: ADDRESSED.** Thay đổi chỉ references và evidence trong phần được re-review, không thay kết luận hoặc thêm claim runtime PASS; không thấy harmful change mới trong phạm vi fix. **Spec PASS, quality PASS, 0 finding mở cho00-02 bounded inventory gate.** Giới hạn không chứng nhận full v2/v3 và các câu hỏi trước code dispatch trong report gốc vẫn áp dụng. Không sửa worker report, source, ledger; không rerun inventory/suite hoặc tạo process cần cleanup.
