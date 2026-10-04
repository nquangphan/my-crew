# Nghiên cứu Phase08 — integration và docs completion

Ngày 2026-10-02; worktree `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`, baseline HEAD `6b76eadf3d0fdac692ea2809e2d0a156c6d3339a`. Planning-only, chưa có implementation/test/runtime certification08. Chỉ ghi ba tài liệu được giao; không chạm source đang do gateway/docsfix sở hữu.

## Bằng chứng local đã đọc

- `docs/index.md`, approved spec §6–9/12, roadmap, `v2/docs/index.md`; flow execution/tickets/platform/domain. Flow docs-import đọc phiên bản `git show HEAD:...` để không đọc file peer đang sửa; StageB dựa báo cáo/handoff, final006 SHA/re-review chưa freeze.
- Reviewed plans02–06,06-r3 exact FinalEvidencePort, native-tree handoff03. Các trạng thái implementation trong report không được nâng thành acceptance hiện tại.
- Actual `v2/server/src/platform/contracts.ts`: verifyFinalResult nhận attemptId/ticketId/kind/outcome/evidenceIds; không nhận `passed` boolean cấp quyền.
- Actual `v2/server/src/tickets/completion.ts`: evidence filter dùng `data.verification==='verified'`; merge chọn `.find()` theo created_at/id. Đây là seam cần reviewed current-evidence selection, nếu có nhiều validation wave không được lấy merge cũ.
- Actual `DocsCompletionReader` chỉ trả commit hoặc null, do đó raw/derived UI state phải là reader riêng; additive DTO cần02Task7/06 owner review.
- Actual `docs/checksum.ts`: `sourceTreeHash(paths)` hash canonical sorted path list. Giữ field006 này; source manifest011 thêm mode/blob/byte SHA để chứng minh nội dung ở exact commit.
- Actual006 handoff: immutable checkout_sync snapshot `unverified`, immutable receipt theo attempt/commit/input hash; original provenance không được UPDATE. Snapshot reuse giữa attempts bắt buộc join receipt riêng, không lấy first snapshot audit evidence làm provenance của retry khác.
- STANDARD xác nhận R3 chỉ page touch và miễn merge commit. Vì vậy structural validator + semantic code/docs review trên exact candidate vẫn bắt buộc, conflict diff không được bỏ qua.

## Git official references và quyết định

Git update-ref hỗ trợ old-OID compare và transaction qua stdin, phù hợp để đổi target cùng receipt ref có kiểm tra precondition. Đây không phải transaction với PostgreSQL;011 reservation/journal/reconciliation chịu trách nhiệm khoảng hở. [Git update-ref](https://git-scm.com/docs/git-update-ref).

Commit-tree cho phép tạo object với tree và parents cụ thể trước khi đổi branch. Kế hoạch tạo candidate commit một lần, test/review chính commit đó rồi CAS target sang đúng OID; không tạo merge khác sau review. [Git commit-tree](https://git-scm.com/docs/git-commit-tree).

Ls-tree cung cấp tree entries và NUL-delimited paths để thu inventory từ commit; kết hợp cat-file/hash bytes và path validation độc lập. Tree object/hash client báo không tự chứng minh authority. [Git ls-tree](https://git-scm.com/docs/git-ls-tree).

Các docs tham khảo đã mở trực tiếp; không chạy Git mutation spike trong lượt planning. Power-loss fsync behavior của shipped Git/macOS chưa đo; T4 phải đo trước assertion durability, ambiguity giữ uncertain.

## Các quyết định kế hoạch

1. SQL011 append-only attestations; derived verified/current reader riêng, raw006 audit/bytes/provenance và latest_verified pointer không bị giả nhãn.
2. Trusted observer dùng pinned key/build/policy, nonce/current scope, measured agent isolation. Bearer, process exit từ client, signature của máy tự đăng ký hoặc model nói PASS không đủ.
3. Target authority bounded theo project/binding/repo/ref, source từ accepted report. Managed ref phải có chứng cứ agent không ghi trực tiếp; target checked out trong owner worktree chặn apply, không reset hoặc sửa dirty files.
4. Fenced permit/target reservation, current source+target CAS, pre-created exact candidate, stable effect ID và immutable receipt ref giải quyết crash/fallback. Unknown descendants giữ resource/guard.
5. Durable011 docs jobs do frozen06 FinalEvidencePort tạo; own command namespace không thêm command enum005. Five-minute monitor06 chỉ retry sync lỗi transport, không rereview unchanged docs.
6. Deploy chưa có verifier08 và giữ exact004 owner intent/fingerprint tới09; merge không ngầm push/deploy.

## Gate cần PM/producer xác nhận khi triển khai

- Final006 F1/F2 independent review và checksum; actual02Task7 routes/read/currentcredential semantics.
- Actual03 journal/ResourceRegistry/HttpOperationJournal,04 EffectLedger/runtime ownership,05 input snapshots,06 assembly/gates/reviews. Approved plans không thay code evidence.
- Narrow reviewed selector cho completion.ts để chọn current011 evidence thay earliest historical merge; constructor wiring vào cả ticket và005 finalize path, không đổi frozen public005 DTO.
- Explicit additive raw/derived docs read contract cho02Task7/06/07; current binding guard bổ sung unresolved011 target reservation.
- Production observer admission và managed target write isolation phải được đo; native ownership UNKNOWN không được xử lý bằng fake certificate hay tự cấp quyền OS.

## Kiểm chứng của lượt planning

Self-review report `plans/261002-0002-crew-v2/execution-phase02/phase-08-plan-self-review.md` ghi coverage, contract scan và scope. Không chạy application tests vì chưa sửa source; các RED/GREEN trong plan là công việc tương lai, không là PASS hiện tại.
