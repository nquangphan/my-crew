# Nghiên cứu Phase08 — integration và docs completion

Ngày 2026-10-02; worktree `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`. Fix wave1 đối chiếu actual HEAD `832c9a3d015fd750a489f49ff48db36a1501ae62`; planning-only, chưa có implementation/runtime certification08. Báo cáo review gốc và self-review gốc giữ nguyên lịch sử; lần sửa có fix-report và before/fix diff riêng.

## Bằng chứng local đã đọc

- Root/v2 docs index, approved spec §6–9/12, roadmap; flow docs-import/execution/tickets/identity/platform/domain trước source. Không đọc Task7 app/docs-read/search hoặc project service working file peer đang sửa; identity flow và projects/service đọc `git show HEAD:...`.
- Actual006 tại832c9a3 checksum `8c48a69a27205ff95d11be8b966ffffcd079f62e537f5263777cd867325b75ae`, F1/F2 storage fixes được PM xác nhận closed. Immutable snapshot `unverified`, receipt attempt/mergedCommit/inputSHA không được UPDATE; FTS bounded projection không đổi byte gốc.
- `v2/server/src/docs/import.ts:374` authorizeDocsSync khóa root/ticket/guard/attempt/command/project/machine, đòi complete intent, current binding/fence và `tickets.merged_commit==sourceCommit`; host verification không cấp trust.
- `v2/server/src/tickets/service.ts:281` chỉ ghi mergedCommit sau completion ready. `execution/attempts.ts:492` gọi verifier và readCompletionFacts trước transition. Vì vậy F1 cần internal accepted-merge fact writer trước006 sync, không thể đợi passed.
- `005_execution.sql:37` terminal_intent mặc định complete. Không cần set intent để bootstrap; cancel/pause/retry/needs_input không được reset nhằm sync.
- `tickets/completion.ts` hiện chọn earliest verified merge; truyền commit=null cho DocsCompletionReader nếu không merge. `v2/src/completion-policy.ts:12` docs branch đòi truthy docsCommit, trong khi spec cho docs-only không merge code. F2 cần riêng scoped snapshot proof/predicate, không giả Git SHA hoặc fallback snapshot toàn project.
- `tickets/contracts.ts:64` DocsCompletionReader `(tx,projectId,commit|null)=>Promise<string|null>` giữ nguyên. FinalEvidencePort06 và public005 DTO giữ nguyên; private factory associates extra ticket reader with same callable for both existing completion call paths.
- `003_identity.sql:33` có projects.expected_commit. HEAD projects/service.ts bindProject tăng binding revision và xóa expected_commit, kể cả same machine/path. F4 phải invalidation011 cùng transaction và giữ003 là projection một authority, không để reader tự chọn hai head.
- `docs/checksum.ts` sourceTreeHash chỉ hash sorted paths; SourceProof011 thêm bytes/mode/blob manifest. STANDARD R3 chỉ touch và miễn merge commit; structural validator không thay independent semantic code/docs review.

## Git official references và quyết định

Git update-ref hỗ trợ old-OID compare và transaction stdin để đổi target cùng receipt ref có precondition; không phải transaction với PostgreSQL. Reservation/journal/reconciliation giữ khoảng hở. [Git update-ref](https://git-scm.com/docs/git-update-ref).

Commit-tree tạo object tree/parents trước khi đổi branch; kiểm chứng chính candidate commit đó rồi CAS sang đúng OID. [Git commit-tree](https://git-scm.com/docs/git-commit-tree).

Ls-tree cung cấp tree entries/NUL paths, kết hợp actual blob bytes/hashes và path validation độc lập. [Git ls-tree](https://git-scm.com/docs/git-ls-tree).

Các tài liệu official đã mở trực tiếp ở lượt planning đầu; không chạy Git mutation hoặc live probe trong fix wave. Power-loss durability của shipped Git/macOS vẫn phải đo khi triển khai, ambiguity giữ uncertain.

## Quyết định F1–F4 sau đối chiếu producer

1. F1: acceptMerge gọi acceptVerifiedMergeFact trong cùng Tx trusted receipt + verified evidence + factual ticketcommit + head projection + docs job. Không đổi ticket status/revision/terminal intent/result hoặc guard. Historic/canceled effect giữ provenance; chỉ current complete-intent effect tạo sync job; real HTTP test bắt đầu commit null, không seed.
2. F2: own011 docs-only immutable snapshots/files/attestations, scoped ticket/attempt/input/criteria và independent review; separate merged versus docs_only relations. Public docs reader(null) vẫn null; module-private registered scoped reader tạo explicit ready predicate cho docs-only, commit fields vẫn null. Code yêu cầu actual merge như cũ. Required implemented pages cần structural/source-basis proof; standalone workflow artifacts giữ format.
3. F3: owner chọn bound repository/ref, trusted helper chuẩn bị private managed copy có cùng branch/ancestry, owner duyệt exact preview và chọn nó làm target. Đây là target đã được ủy quyền mới, không claim original main được cập nhật. Original clean/dirty index/bytes/ref không đổi; no stash/reset/checkout/branchswitch. Bounded local object bundles, explicit request/proof/activation/registration/API và restart/rebind/revoke lifecycle.
4. F4:011 head có registration/binding generation là authority duy nhất;003 expected_commit là projection cùng Tx. Activation/observe/merge/drift/invalidation dùng một writer. Rebind kể cả cùng machine/path tăng generation, clear cả hai, giữ historic proof không current. Task7/06/07/completion dùng một reader; unchanged observation không tăng revision khiến docs stale giả.

## Gate triển khai vẫn cần evidence

- Owner02 review internal fact writer, bound completion-reader factory, project binding/revocation hook và actual Task7 constructor integration trước freeze011/T4/T5.
- Actual03 journal/ResourceRegistry/HTTP operations,04 EffectLedger/runtime ownership,05 input snapshots,06 assembly/gates/review artifacts; approved plans không thay implementation evidence.
- Trusted observer enrollment và managed target write isolation cần measured negative probes. Native ownership UNKNOWN không được thành PASS do signature, owner activation hoặc lease expiry.
- Independent re-review exact fixed plan/hash và F1–F4 test matrix; deterministic fixtures không chứng minh live model semantic quality.

## Kiểm chứng lượt planning

Chỉ static contract/coverage/placeholder/format/hash/diff checks; không application tests/migration/model/live calls/source edits. Exact before snapshots và unified diff cùng fix-report trong `execution-phase02/phase-08-plan-fix*`; self-review ban đầu giữ hash cũ đúng lịch sử.
