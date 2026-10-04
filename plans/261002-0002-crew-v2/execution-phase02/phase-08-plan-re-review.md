# Phase08 — scoped re-review fix wave1

**Spec READY: YES. Quality READY: YES — ở mức kế hoạch.** F1–F4 đã được xử lý; không phát hiện blocker mới trong phạm vi diff sửa. Kết luận này không cấp implementation/runtime/production PASS và không bỏ các producer/certification gates của kế hoạch.

## Revision và phạm vi

- Plan 329 dòng, SHA256 `5d486a5c3e975edec99049608809dd85c635c3567472c1667682b22e50aae870`.
- Exact combined plan/research diff SHA256 `2132bb48a3ce99ecda6a20a4a7f83b4aa6b20eba4b011815324a598fc71e31e4`; kiểm tra read-only tái tạo unified diff từ before snapshots cho kết quả byte-identical (`exact_diff_matches: True`).
- Đối chiếu original review, `phase-08-plan-fix.md`, các phần sửa của plan/research và narrow actual producer paths. Không mở lại whole-plan review.
- Đã đọc Task7 report và flow `server-docs-view` trước actual `app.ts`, docs reader và route composition. Báo cáo test Task7 là evidence của worker, không phải test em chạy lại. Không test runtime/model/install/DB/service, không stage/commit hoặc source/plan edits; chỉ tạo report này.

## Closure F1–F4

| Finding gốc | Trạng thái | Exact plan lines xử lý | Kết luận đối chiếu |
|---|---|---|---|
| F1 P1: sync cần ticket merged_commit trước completion | **ADDRESSED** | 178–181; 136–137; 252, 262, 293, 301 | `acceptVerifiedMergeFact` chỉ nhận accepted receipt; cùng Tx receipt/evidence + factual ticket commit + head projection + một job. Ghi trước006, không đổi status/guard/revision/intent/result; historic/cancel/stale không bootstrap current fact. Full HTTP từ commit null và forced rollback/restart được yêu cầu. |
| F2 P1: docs-only bị merge-only contract khóa | **ADDRESSED** | 89–95; 139–141; 158–159; 174; 183–193; 270, 279–281, 302 | Own011 snapshot/attestation scoped ticket/attempt/input/criteria, không merge FK hoặc fake commit. Public reader(null) tiếp tục null; private callable-associated reader và explicit docs-only predicate trả ready với cả hai commit null. Code không nhận nhánh này. Có negative wrong-ticket/stale/imported/implemented-page và positive HTTP không merge. |
| F3 P2: thiếu managed-target onboarding producer | **ADDRESSED** | 129–130; 147–152; 167; 195–199; 215, 221–222 | Named T1/T2/T4 producers, target-request/challenge/prepared/owner-activation, immutable identity/generation và bounded object transfer đã có. Owner chọn explicit managed repo làm destination; giữ nguyên origin checkout clean/dirty/index/ref. Restart/rebind/substitution và target retention được giao test. |
| F4 P2:003 expected_commit và011 head chưa thống nhất | **ADDRESSED** | 135; 201–204; 215, 304 |011 là sole authority;003 là projection cùng Tx từ một writer. Initialization/activation/observe/merge/drift/invalidate có owner, CAS và generation; cùng máy/cùng path rebind cũng invalidate. Reader kiểm current binding/nonrevoked machine, mismatch deny; same pin/OID refresh không tăng revision giả. |

**Unaddressed original findings: none. New blocking findings in fix diff: none.**

## Actual producer compatibility

1. **Factual writer khép vòng006:** actual `docs/import.ts:406–421` vẫn đòi complete intent, reserved attempt, exact ticket commit và docs_verification provenance. Plan178–181 cung cấp writer trước sync;143/277 tiếp tục cấp docs_verification riêng trước006. `tickets/service.ts:281–295` và `execution/attempts.ts:492–517` vẫn có thể giữ gate done sau docs, không cần đổi public005 hay nới006 authorization. Job aliases136–137/293 ngăn monitor tạo job thứ hai từ operationId khác.
2. **Callable association đi qua producer hiện có:** actual `app.ts:65–72` hiện hardcode reader006 vào cả ticket/execution route; vì vậy T7 phải thay composition bằng reader011 được bind, đúng ownership300–302, không được nghĩ verifier injection tự thay docs reader. `execution/routes.ts:183,387,418,458` chuyển callable qua service; `execution/attempts.ts:514,530` sử dụng cùng reference ở cả completion precheck và `createTicketServices`; `tickets/service.ts:307–311` giữ reference thay vì wrap. Do đó WeakMap association là seam khả thi về contract. Test mất association/default deny ở192/302 vẫn cần chạy khi triển khai.
3. **Null docs-only có semantics rõ:** actual `docs/read.ts:151–155` trả null khi commit null và dùng raw verified pointer; plan174/193 không sửa nghĩa public reader hoặc bịa Git OID. Internal scoped predicate là thay đổi behavior có owner02 review, được đặt rõ ở `completion-readers.ts`/`completion.ts`; raw006 rows không bị nâng nhãn.
4. **Head/read composition cần thực thi đúng handoff:** actual `docs/read.ts:172–184` dùng raw audit và003 expected_commit; actual `projects/routes.ts:38–43,61–62` đã có callback docsState. Plan201–204/280 yêu cầu thay bằng shared011 current-head/derived reader và giữ raw audit riêng. Existing Task7 reader chưa phải trusted011 reader; gate trước freeze011/T4/T5 ở204 và actual constructor acceptance300–304 phải chứng minh việc nối này.
5. **Destination authorization không đánh tráo origin:** plan195–199 xác định managed copy là auto-merge target được owner chọn sau preview, không tự claim branch trong origin checkout đã được cập nhật. Owner activation không thay trusted observer/OS isolation certificate; no credentials/network/hardlinks và identity invalidation vẫn là measured implementation gates.

## Gates giữ nguyên khi triển khai

| Gate | Bằng chứng phải có sau implementation |
|---|---|
| Owner02 internal seams trước freeze011/T4/T5 | Fact writer, callable reader/completion adapter, binding/revocation hook và exact Task7 constructors được review; public005/FinalEvidencePort giữ nguyên |
| Full merge→docs→finalization | Actual HTTP từ null ticket commit, accepted observation/merge, atomic job/head projection,006 immutable sync,011 attestation và005 finalization; rollback/restart/replay không seed PASS |
| Docs-only | Same-ticket current proof + independent review hoàn tất với commit null; code/wrong scope/imported/stale proof deny; standalone artifact không bắt buộc managed-target registration khi không có source basis |
| Managed target/current head | Owner-requested preview/activation, immutable source transfer, dirty origin preserved, rebind/drift/identity substitution deny và003/011 projection nhất quán |
| Trust/runtime/native/resource | Actual03–06 constructors, observer/key/journal isolation, native-tree stop proof, real Git durability/recovery; UNKNOWN giữ reservation/resource; fixture signatures và plan approval không là certificate |
| Closeout | Focused regressions rồi batch gates/docs/backup-restore và independent whole-phase review trên exact implementation HEAD |

Kế hoạch sửa đủ cụ thể để chuyển sang các producer-gated implementation tasks. Không cần thêm vòng spec interview hoặc sửa public contract để đóng F1–F4.
