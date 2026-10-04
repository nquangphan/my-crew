# Phase02 — plan review round1 correction report

Ngày: 2026-10-02. Chỉ sửa kế hoạch; không sửa source/domain, không chạy test/DB, không commit hoặc dispatch subagent.

**Frozen revision:** `phase02-r2-2026-10-02`.
**Plan:** `plans/261002-0002-crew-v2/phase-02-server-docs.md` (727 lines).
**SHA256:** `58a18a4a7eb8052398b0f66effcacc4a26259f8195b80e082cf0ad9ab81e0417`.
**Review input:** `execution-phase02/plan-review.md`, snapshot review `ea9b7ec984e5a867f92dd57b565c1dedbfc60ce4721f6af5ff4effe3a53e2ff9`.

## Findings addressed

- **I1:** attempt có `finalizing` sau xác nhận process stopped; partial unique và execution guard vẫn giữ quyền. Ticket giữ running/final_result_pending, chưa relabel pending/ready. Terminal intent/result/stopped proof lưu riêng; `finalizeAttempt` áp dụng đúng domain signal từ running và release guard cùng transaction. Pause, cancel, wait_owner và repair vòng5 ghi intent rõ; wait_owner dùng pause command hiện có, không command wait chưa định nghĩa. Late result route, explicit recheck-finalization route với key mới, verifier attestation append-only cho evidence tới trước/sau stop. Có test result-before-exit, exit-before-result/restart, response lost/concurrent finalize, wait_owner, repair vòng5 và late verification không tạo fence mới. Default completion verifier fail-closed; research owner approval phải gắn evidence/criteria, code verifier ở phase08.
- **I2:** source/unit docs validator được chạy song song; full006 SQL và DB import gate chỉ sau Task5. `databaseFixture(N)` và immutable `MigrationSet` ghim prefix từng file (1/2/3/4/5/6), không migrate dynamic all-files directory. Unit validator không DB; thiếu prerequisite migration được báo blocked thay vì RED nghiệp vụ.
- **I3:** DocsFile có contentClass bắt buộc, backup inventory/checksum chứa class. Snapshot có aggregate mixed, mỗi docs_files page có implemented/workflow_artifact; known Superpowers/BMAD artifact paths không được nhãn implemented. Original bytes/path giữ nguyên, validator STANDARD chỉ áp dụng implemented subset. Mixed fixture có flow+spec và assertions DB bytes/class; Task7 tree/search/page giữ nhãn theo page/source/checksum; completion chỉ lấy required implemented standard pages đã verified.
- **M1:** docs_links identity `(snapshot_id,from_path,occurrence)` và original_href/fragment; hai fragment cùng target hoặc link lặp không dedup mất audit. Fixture3 occurrences kiểm tra anchor hợp lệ/thiếu/lặp; DB roundtrip/rerun giữ3 rows.
- **Controller extra:** Task2 machine event scope có `EventScopeReader` injected, ownerOnlyEventScope không query projects; machine/actual binding integration sau schema003 dùng projectEventScope. Scope signature cho readEvents và stream explicit, không phụ thuộc relation chưa tồn tại.

## Self-review performed

Đã rà lại dependency table, schema fields/partial unique, route inventory, Task1 migration fixture signature, Task4 process-signal restrictions, Task5 terminal transaction/test examples, Task6 per-page classification/hash/link identity và Task7 completion/search labels. Placeholder scan không có TODO/TBD. Giữ nguyên7 task; chỉ sửa plan và report này. Hash trên là bản đóng băng gửi controller/independent reviewer; chưa tuyên bố review round2 đạt hoặc implementation hoàn thành.
