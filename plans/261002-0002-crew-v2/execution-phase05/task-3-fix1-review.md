**T3-Q1 / P2 — ADDRESSED.** `v2/server/src/attachments/snapshots.ts:130` precompute persisted unit-array digest một lần mỗi row; `:142` tạo index text/vision, `:143` validate mỗi manifest derivative một lần, `:174` lookup candidate theo unit. Vòng unit không còn scan derivatives hoặc hash grouped arrays. Đây là closure của defect coverage đã nêu, không phải chứng nhận toàn snapshot path tuyến tính.

## Finding Verdicts

- **T3-Q1 — ADDRESSED.** Persisted row map lookup bằng exact derivative UUID; SQL vẫn scope exact extraction/original và thêm explicit row extraction/original checks. Manifest validation giữ verified, original UUID/hash/owner, extraction UUID, extractor version/config, persisted SHA/byte length/MIME/kind/verification và canonical unit-array equality (`snapshots.ts:127`, `:147`). Index nằm trong original/extraction loop nên unit ID trùng giữa originals không nhập quyền. Separate text/vision maps giữ modality; candidate đầu tiên hợp lệ theo manifest order được giữ. Unit availability, selected derivative IDs và required capabilities vẫn được kiểm/suy từ coverage thực (`:168`, `:174`).
- **Regression cho bounded work — đủ evidence trong scope.** `v2/server/test/attachments-snapshots.test.ts:651` dùng actual fixture publication của 2.048 unique text units/1 derivative, yêu cầu ready/text/exact selected derivative/exact original/full coverage trước assertions về work. `test/support/attachment-snapshot-work.ts:7` gọi nguyên transaction/query rồi wrap actual returned PostgreSQL rows; không fabricate query result hoặc manifest. Proxy đếm SHA-property reads và numeric unit-array reads, trả nguyên values bằng Reflect. Lower bounds yêu cầu validation/hash traversal thực; removal thành no-op không qua regression. Test tamper riêng còn yêu cầu SHA, byte length, MIME, kind, verification, unit IDs, original UUID và extraction UUID sai đều waiting/empty selection/empty capabilities, restore exact row trở lại baseline.

## New Breakage in the Fix Diff

- **None.** Không thấy new Critical/Important/Minor defect trong seven-file FIX1 diff. Grouped fixture mặc định vẫn một unit; image giữ một unit, grouped text tạo distinct locators và exact shared derivative unit IDs. Documentation/R2 helper mapping phù hợp thay đổi.
- **Modality check — accepted producer provenance confirmed.** Chỉ đọc frozen `task-3-accepted-worker-protocol.ts`, SHA256 `836615d455854469acc8280c3d66e97adff1b190df7a2ece234e101b1d156aa5`, khớp provenance c5f9ad3 và GREEN/types manifests. Protocol chỉ chấp nhận text/plain text hoặc image/png image; mỗi file unit phải available và needs khớp file kind. Vì vậy branch image→vision, text→text của index giữ accepted modality semantics. Không đọc hay nghiệm thu current peer Task5 protocol bytes.

## Checks and Evidence

- **Static review only.** Đọc brief, previous review, FIX1 report và immutable `.superpowers/sdd/phase-05-attachments/review-c5f9ad3..0c838d2.diff` một lần. Candidate base `c5f9ad3`, head `0c838d2`. Không chạy Git, test suite, PostgreSQL, Docker, native fixture hoặc provider; không sửa source/index/HEAD. Sole output mutation là report này.
- **FIX1 report integrity — confirmed.** Recomputed SHA256 `27023f9592405cfa70b257ecb5a4c491551fc86b23d359a1abf08c8ddd2925d3`, khớp dispatch.
- **Retained RED — confirmed.** `task-3-fix1-red-evidence.json` child exit1/closed; raw log 0 passed/1 failed, queries1/rows1, validationReads2.048, unitElementReads4.194.304. Failure ở bounded assertion sau positive coverage checks. Recomputed log SHA256 `67804e79b889df20a31ab106cc5aaedb4cbb3814a5a682236e9e5f320b5c0503`, khớp evidence/report.
- **Retained GREEN — confirmed.** `task-3-fix1-green-evidence.json` child exit0/closed; raw log 3 passed, 0 failed/cancelled/skipped/todo: grouped coverage, eight persisted tamper faults, existing repeated-unit-ID exact-original subset selection. Same actual queries1/rows1; validationReads1, unitElementReads2.048. Recomputed log SHA256 `5a8ea3f3497bf7b09f447778e1dc212e82c9b3d110426c19709866509586eb00`, khớp evidence/report. Counts là quan sát work, không phải latency benchmark.
- **Retained source types/Biome — confirmed within their stated scope.** Types evidence child exit0/closed, command `tsc --noEmit`; log SHA256 `5815a471862da02ac019cf69b0af359b0d4642cb779015db4ca3ed44de8c3bdb`. Scoped Biome log checked4/no fixes, SHA256 `939e213a763db07420c1bc46a8df031a6cdfc05a0e93442ed49bceeca3884187`. GREEN/types manifests agree on production snapshots SHA `c498e9e953c7eae2aa840c9fc97cef0e0b5bcf88071315be60ebb9bf918f3969` và three changed test/helper hashes. Không claim test TS được strict typecheck hoặc original44 là current-source PASS.

## Out-of-Scope Observations

- **T3-Q2 — PM-owned, non-blocking for FIX1.** Existing subset `.includes` và per-requested-unit `.find` costs đã được PM ledger riêng, planned FIX2. Chúng nằm ngoài changed coverage block; không re-review hoặc dùng để mở lại T3-Q1. Các Task6/Phase06 authority, production assembly/publication/enqueue và native/provider/comprehension gates của original review vẫn giữ nguyên.

## Verdict

- **Fix round: All scoped findings addressed, no new Critical/Important breakage.** T3-Q1 closed; no open finding trong FIX1.
- **SPEC / QUALITY: scoped FIX1 READY.** Đây không phải full Task3/phase/production acceptance; T3-Q2 và các deferred gates vẫn do PM xử lý riêng.
- **Unresolved questions: none for scoped T3-Q1 closure.**
