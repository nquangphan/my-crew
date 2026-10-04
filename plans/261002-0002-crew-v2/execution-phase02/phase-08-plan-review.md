# Phase08 — independent spec và quality readiness review

**Spec readiness: NO. Quality readiness: NO.** Cần sửa 4 gap trong kế hoạch trước triển khai; không cần mở lại phỏng vấn spec. Đây là review kế hoạch, không phải kết luận implementation/test/runtime đã đạt.

## Phạm vi và bằng chứng

- Worktree: `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`; HEAD đọc được `832c9a3d015fd750a489f49ff48db36a1501ae62`.
- Đọc toàn bộ plan 267 dòng, research 45 dòng, self-review và planner brief. Plan SHA256 `742f82b64ce2dba98afcb43db017dbd6e667e945803717e0974c78a0069d549f`; research SHA256 `c71d3d707ddd0662d814d878abc026af346a516fed9328fc12ef0e18313e4d94` khớp self-review.
- Đọc root/v2 docs index, flow docs-import/execution/tickets/identity/platform/domain trước khi đối chiếu source producer liên quan; approved spec §6–9/12 và hợp đồng FinalEvidencePort/DocRead của06.
- Actual006 checksum đọc trực tiếp: `8c48a69a27205ff95d11be8b966ffffcd079f62e537f5263777cd867325b75ae`. F1/F2 đã đóng theo bàn giao PM; status plan dòng9/36 cần cập nhật cùng revision tiếp theo. Việc status cũ không phải finding độc lập.
- Không đọc app/read/search Task7 đang được peer sửa; không sửa source, plan, tests hoặc migration; không chạy test/model/install/DB/service/Git mutation. Chỉ tạo báo cáo này. Actual03–010 chưa đủ implementation/certificate là gate được chấp nhận, không tự động là finding.

## Findings

### F1 — P1: Chưa có writer pre-sync cho `tickets.merged_commit`, tạo vòng chặn docs/finalization

**Vị trí plan:** dòng194–205 (accept merge/recovery), 217–220 (gọi006 và docs completion), 232 (requestDocsSync), 240–242 (assembly).

**Bằng chứng actual producer:** `v2/server/src/docs/import.ts:387–413` đọc `t.merged_commit`, đòi attempt active/finalizing còn reserved, `terminal_intent='complete'`, rồi từ chối nếu commit không bằng `input.sourceCommit`. Writer hiện có trong `v2/server/src/tickets/service.ts:281–295` chỉ đặt merged_commit khi signal passed **sau** `readCompletionFacts(...).ready`. `v2/server/src/execution/attempts.ts:492–517` cũng gọi final verifier và docs completion trước transition đó. `v2/server/migrations/005_execution.sql:37` mặc định terminal_intent là complete; vì vậy chính intent không phải bootstrap blocker, nhưng cancel/pause/retry không được tự đổi lại complete để lách gate.

**Failure path:** request code mới có merged_commit null → accepted011 merge receipt/job →006 sync trả DOCS_COMMIT_MISMATCH → không có receipt/attestation → final verifier/readCompletionFacts không cho passed → writer duy nhất không chạy. Kế hoạch chỉ ghi011 receipt/head; chưa chỉ ai ghi factual merge vào ticket trước006. Đổi current-evidence selector ở dòng241 không giải quyết điều kiện authorizeDocsSync này. Test có seed merged_commit/receipt sẽ che vòng chặn.

**Sửa hẹp:** chỉ định một internal producer seam được owner02 review, ví dụ accept verified merge fact trong transaction acceptMerge: root/attempt/current binding/fence và target reservation được khóa đúng thứ tự; accepted011 receipt/evidence + factual `tickets.merged_commit` + head projection liên quan cùng commit DB. Không đổi ticket status, không release guard, không sửa immutable terminal result/intent, không nhận commit trực tiếp từ client như trust. Quy định exact replay, crash sau Git trước DB, historic merge sau drift và superseding wave. Nếu chọn producer khác, phải chỉ ra chữ ký, file owner, transaction và thứ tự tương đương; không đổi frozen SQL/public005 DTO hoặc nới006 authorization.

**Test/gate:** real HTTP request code từ merged_commit null → actual trusted merge admission → row commit có giá trị nhưng ticket chưa done/guard còn giữ →006 sync/011 attestation → stop/result/finalize mới done. Crash/restart giữa từng bước không mất writer hoặc lặp merge; cancel intent không bị đổi; stale/historic receipt không ghi đè current merge. Gate trước T4/T5 assembly: owner02 duyệt seam và constructors actual Task7.

### F2 — P1: Đường yêu cầu chỉ tài liệu vẫn bị contract merge-only khóa

**Vị trí plan:** dòng84–86 (DocsAttestation), 121–123 (jobs/attestations/completions), 210–220 (T5), 225–232 (T6), đặc biệt câu “Pure docs/research … no code merge requirement” ở dòng220.

**Bằng chứng:** mọi DocsAttestation bắt buộc `mergeReceiptId`/`mergedCommit`; job và reader yêu cầu accepted merge và equality với merge receipt. Actual `v2/server/src/tickets/completion.ts:47–68` lấy commit từ merge evidence, truyền null cho docsReader nếu không có merge, rồi `v2/src/completion-policy.ts:12` đòi docsCommit khác null cho docs request. `DocsCompletionReader` actual (`tickets/contracts.ts:64`) cho phép commit null, nhưng plan dòng220 chỉ mô tả đường có merge receipt, không có nhánh xử lý null đủ authority.

**Failure path:** docs-only request tạo tài liệu/artifact hợp lệ và review đạt mà không merge code, đúng spec §6; nó không tạo được attestation có mandatory mergeReceiptId, reader không chứng minh được snapshot, completion bị chặn. Trusted ArtifactProof của research không tự cấp docs snapshot proof. Câu ngoại lệ trong prose chưa có kiểu dữ liệu, producer, reader hoặc acceptance thực thi được.

**Sửa hẹp:** định nghĩa riêng proof/receipt và current-result selection cho docs-only theo đúng criteria, scoped ticket/attempt, immutable bytes/snapshot và review provenance. Chỉ rõ cách reader nhận proof khi commit null, tránh chọn bất kỳ snapshot khác trong project. Nếu cần thêm internal ticket-scoped reader/selector, giao producer02 review; giữ public FinalEvidencePort và005 DTO. Không giả tạo merge receipt hoặc nâng imported/unverified snapshot thành verified. Với docs thực sự sửa repo, đường commit/sync vẫn có thể dùng; không áp nghĩa vụ merge code cho mọi docs request.

**Test/gate:** một docs-only request đạt bằng snapshot/artifact+criteria review và không có merge receipt; thiếu/wrong-ticket/stale proof vẫn deny; imported hoặc artifact-only snapshot không thỏa yêu cầu trang implemented. Code request với cùng proof phải tiếp tục deny khi thiếu actual merge. Gate trước freeze011/T5: shape receipt/nullable relations và reader handoff đã được review.

### F3 — P2: Managed-target onboarding chưa có producer thực tế để thoát khỏi trạng thái deny

**Vị trí plan:** dòng115–120, 129–145 và174; research dòng30/41.

**Bằng chứng:** dòng143 gọi tuple `(projectId,bindingRevision,repositoryIdentity,targetRef)` là server-owned configuration, nhưng persistence/wire không có registration/config producer tương ứng; ownership không chỉ task/file tạo hoặc tiếp nhận nó. Dòng174 từ chối target đang checkout ở mọi owner worktree và chờ “explicit safe checkout arrangement”. Actual binding (`v2/server/src/projects/service.ts:7–9,85–117`) chỉ nhận machineId/checkoutPath/revision, chưa cung cấp managed-target contract. T2 fixture bare repo chứng minh thuật toán Git, không chứng minh project bình thường đã bound có đường onboarding.

**Failure path:** project được bind vào owner checkout đang ở main, là cấu hình thường gặp → mọi gate pass nhưng apply luôn bị chặn. Người triển khai chưa biết ai chuẩn bị managed repository/ref, source objects đi từ implementation workspace vào đó bằng authority nào, owner đăng ký đúng nhánh đích ra sao, hoặc sau crash/rebind lấy lại identity nào. Đây là thiếu đường cấu hình sử dụng được, tách biệt với việc certificate OS/process còn chờ04/09; không yêu cầu tự cấp certificate hoặc thay checkout owner.

**Sửa hẹp:** thêm bước/handoff onboarding có owner, file, typed input/output và persistence: chủ dự án chọn đúng repository/ref; helper tạo hoặc kiểm chứng vùng managed phù hợp, pin identity/binding và source-transfer policy, ghi registration server có kiểm chứng; target checked-out/dirty chưa sẵn sàng trả reason+next action cụ thể. Có thể chọn server/deployment config với runbook hữu hạn thay API mới, nhưng phải chỉ reader/writer và cách registration khôi phục/revoked khi identity/binding đổi. Không tự checkout/reset/stash owner hoặc ngầm chọn branch khác; pin managed target phải vẫn là target mà owner đã ủy quyền auto-merge.

**Test/gate:** từ project bound vào owner checkout sạch và dirty: denial không đổi byte/index; explicit run-owned managed arrangement → đăng ký → full auto-merge path; restart/rebind/path inode substitution làm registration cũ vô hiệu. Trước T2/T4 assembly cần reviewed onboarding producer/handoff; certification negative probes vẫn là gate riêng ở T7/04/09.

### F4 — P2: Chưa chốt quan hệ `projects.expected_commit` với authoritative011 head qua rebind/read

**Vị trí plan:** dòng120 (integration_project_heads), 139/143–145 (binding), 219–220 và241–242 (readers/current head).

**Bằng chứng:** actual003 có `projects.expected_commit` (`v2/server/migrations/003_identity.sql:33`), và actual bindProject xóa trường đó khi tăng binding revision (`projects/service.ts:109`). Plan thêm `integration_project_heads.expected_commit` và dùng nó làm completion truth; head row chỉ nêu project PK, không nêu binding/registration generation hoặc invalidation writer. Plan không xác định trường003 được projection đồng bộ, retired, hay mọi Task7/06/07 consumer phải chuyển sang011. Không đọc source Task7 đang sửa nên không khẳng định reader hiện tại đã mắc lỗi này.

**Failure path:** writer cập nhật011 nhưng một producer read vẫn lấy003 null/old → UI/Assistant và completion bất đồng current/stale; hoặc rebind đã xóa003 nhưng row011 vẫn mang head/attestation binding cũ. Chặn rebind khi permit unresolved là đúng, nhưng chưa giải quyết rebind hợp lệ sau release. “Same snapshot/Tx” và CAS head không tự nối hai nguồn truth này.

**Sửa hẹp:** chọn011 làm authority với registration/binding generation và quy định rõ003 là projection cập nhật cùng transaction hay bị loại khỏi các consumer bằng adapter có owner review. Thêm exact writer cho initialization/current target/merge acceptance/out-of-band drift/rebind invalidation; không để reader độc lập tự chọn truth. Historic attestation giữ provenance nhưng không current sau generation đổi cho tới trusted observation mới. Handoff Task7/06/07 phải nêu field raw/derived và expected head từ nguồn nào; không sửa SQL003/006 đã freeze.

**Test/gate:** bind A→merge+attest→release→bind B (kể cả cùng máy/path khác) phải trở về unverified/stale ở toàn bộ reader và block completion cho tới observation hợp lệ; atomic projection race/restart không có hai expectedCommit khác nhau. Gate trước T5/T7: producer owner ký contract nguồn truth/invalidation và actual constructor tests.

## Test và gate matrix cho revision sửa

Các ô dưới là yêu cầu tương lai; review này không chạy application tests và không ghi PASS runtime.

| Chuỗi/ca | Đánh giá plan hiện tại | Gate/test bắt buộc |
|---|---|---|
| Signed observer → nonce → immutable receipt | Cấu trúc đủ cho triển khai có điều kiện | T1 discriminant/hash/current auth trước replay, scope/expiry/key/build/policy; production absent verifier503 |
| Observer key/process isolation | Gate được chấp nhận, chưa chứng nhận | Actual trusted enrollment/certification negative probes; fixture signature không là production proof |
| Managed target registration → candidate | F3 cần sửa | Onboarding từ bound owner checkout; managed target/source-transfer/identity, dirty preservation, wrong/rebound identity deny |
| Source manifest → exact candidate → checks/reviews | Coverage phù hợp | Actual child exit/output/binary/env, Git blob inventory, independent task/request/docs review, source/target conflict new wave |
| Permit → ref CAS → exact recovery | Coverage phù hợp | T4 before/after ref/journal/server crash, same effect across fallback, no duplicate merge, uncertain giữ reservation |
| Accepted merge → ticket fact →006 sync | F1 cần sửa | Atomic internal writer trước sync; null initial row; no seed; current authority/cancel/historic negative cases |
| Raw006 snapshot/receipt →011 attestation | Coverage phù hợp sau F1 | Per-attempt input receipt, raw bytes/audit immutable, cached ACK không tạo proof, required implemented pages |
| Docs-only result → completion | F2 cần sửa | No-code-merge positive path, wrong-ticket/stale/import-only negative, code path không nhận nhầm proof |
|011 expected head →003/Task7/06/07 readers | F4 cần sửa | Single authority+projection/generation, rebind/out-of-band drift invalidation, same transaction selection |
| Current result selector →005 finalization | Narrow seam đã được nêu, đợi actual review | Two waves first stale; both ticket/finalize injection; default deny; exact immutable result linkage |
| Repair5/monitor/sync retry/source OFF | Coverage phù hợp | Existing004/06 counters, transport retry same payload without rereview, current versus admitted source semantics |
| Cancel/UNKNOWN/resource cleanup | Coverage phù hợp, native gate còn mở | Stop/result/finalize before release, owned resource identity checks, no native descendant certainty inferred from journal |
| Assembly/backup/docs closeout | Chưa thực thi, gate rõ | Actual Task7/03–06 reviewed constructors; real HTTP/DB/Git restarts;011 backup restore; baseline-aware docs checks; whole-phase review |

## Disposition và điều kiện re-review

Sửa kế hoạch bằng các handoff producer hẹp ở F1–F4, gắn ownership/test vào T1/T2/T4/T5/T7 và cập nhật current006 gate. Sau đó review lại exact plan hash và constructor contracts khi producer sẵn sàng. Không cần sửa công khai FinalEvidencePort/005 DTO, hạ trust boundary, mở lại spec interview hoặc chạy model/live services trong lượt sửa plan.

**Spec READY: NO — F1/F2 chặn outcome merge→docs→complete và docs-only, F3 thiếu đường onboarding auto-merge. Quality READY: NO — producer/writer và head truth F1/F3/F4 chưa kín.** Missing native certification/actual03–010 hiện vẫn là explicit future gates, không bị dùng làm lý do finding bổ sung.
