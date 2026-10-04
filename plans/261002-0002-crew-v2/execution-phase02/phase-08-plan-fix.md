# Phase08 — plan fix wave1 report

**Disposition:** READY for independent re-review. F1–F4 đã sửa ở mức kế hoạch trong cùng một wave; chưa được reviewer đóng finding và chưa có implementation/runtime PASS.
**Producer baseline:** HEAD `832c9a3d015fd750a489f49ff48db36a1501ae62`; reviewed006 SHA256 `8c48a69a27205ff95d11be8b966ffffcd079f62e537f5263777cd867325b75ae`; actual005 reviewed9dca04e,06-r3 giữ nguyên.
**Review input:** `execution-phase02/phase-08-plan-review.md` đọc đầy đủ; không sửa report review/self-review gốc.

## Exact frozen artifacts

| File | Lines | SHA256 |
|---|---:|---|
| `phase-08-integration-docs-gates.md` | 329 | `5d486a5c3e975edec99049608809dd85c635c3567472c1667682b22e50aae870` |
| `plans/reports/research-261002-crew-v2-integration.md` | 43 | `73492ab84cf3aa44da262b432e943e61a0e9e3010b9eb35ed12897ffb18a1f3e` |
| `execution-phase02/phase-08-plan-fix.before.md` | 267 | `742f82b64ce2dba98afcb43db017dbd6e667e945803717e0974c78a0069d549f` |
| `execution-phase02/phase-08-research-fix.before.md` | 45 | `c71d3d707ddd0662d814d878abc026af346a516fed9328fc12ef0e18313e4d94` |
| `execution-phase02/phase-08-plan-fix.diff` | 374 | `2132bb48a3ce99ecda6a20a4a7f83b4aa6b20eba4b011815324a598fc71e31e4` |

Diff chứa cả plan và research, paths before/after rõ ràng; before snapshots byte-identical reviewed revision. Mọi path ngắn trừ research nằm dưới `plans/261002-0002-crew-v2/`.

## Mapping findings → fixed contract/tests

| Finding | Plan location | Thay đổi và acceptance bắt buộc |
|---|---|---|
| F1 P1 factual commit bootstrap | 178–181; T4 252, T7 301 | Internal acceptVerifiedMergeFact từ accepted011 receipt; cùng Tx verified evidence + factual ticketcommit + head projection + one docs job BEFORE006. Guard/status/revision/intent/result giữ nguyên. Actual HTTP bắt đầu null, rollback/restart/replay/cancel/historic/superseding wave, không seed commit. |
| F2 P1 docs-only | types 90; persistence 139; seam 183–193; T5 270 | Own011 immutable task snapshot+review attestation, distinct nullable/discriminated completion relations. Public reader(null) vẫn null; private callable-associated ticket reader + explicit docs-only predicate returns ready with commit fields null; code không nhận proof này. Wrong-ticket/stale/imported/artifact-only-for-implemented criteria negatives. |
| F3 P2 target onboarding | wire 147; seam 195–199; T2 222 | T1 targets/T2 onboarding+object-transfer/T4 routes; owner chọn bound origin/ref→trusted managed preview→owner activates exact destination. Same branch/ancestry, private object copy, bounded local transfer, persistence/restart/rebind/revoke. Original clean/dirty checkout index/ref/bytes unchanged, no stash/reset/checkout/switch. |
| F4 P2 head authority | seam 201–204; T1 215, T7 304 | Sole011 head with registration/binding generation;003 is atomic projection. Initialization/activate/observe/merge/drift/invalidate writers explicit. Same-machine/same-path rebind retires old proof, all Task7/06/07/completion readers share one head. Two-pool races/restart verify no divergent current head. |

## Producer verification and scope

- Đọc actual006 authorizeDocsSync,004 ticket completion/status writer,005 finalize/default intent, public DocsCompletionReader và domain completion policy; committed HEAD projects/service và identity flow, SQL003/006. Không đọc Task7 app/docs read/search hoặc working project service peer đang sửa.
- Không giả “intent bootstrap” issue:005 default complete đã được xác minh; không reset cancel/pause/retry.
- Không rewrite frozen SQL003/006/public005/FinalEvidencePort. Các thay đổi source tương lai là narrow owner02-reviewed fact/reader/binding seams, ownership gắn rõ; lần này chỉ sửa tài liệu.
- Managed copy được owner chọn làm target thực tế; plan không claim original main đã merged hoặc tự di chuyển checkout. Onboarding certificate và runtime target isolation vẫn là measured future gate.
- Docs-only không fake merge/hash/commit. Internal adapter giải quyết domain hiện chỉ có commit-backed docs branch; default/new unregistered callback vẫn deny, cả hai005 completion paths được test với cùng server-created reader.

## Static verification thực hiện

- Byte/hash check before snapshots khớp hai SHA của reviewed revision.
- Plan 329 dòng, nằm250–350 target; research 43 dòng.
- Placeholder scan không có TBD/TODO/implement later/fill in details/appropriate error handling/Similar to Task.
- Cả plan/research có newline cuối, không trailing whitespace, fenced blocks cân bằng.
- Unified diff sinh trực tiếp từ exact before bytes và final current bytes; SHA ở bảng freeze.
- Không application test, migration, source/SQL edit, install, model/live call, credential access, shared service mutation, stage/commit hay subagent. RED/GREEN trong plan là công việc triển khai tương lai, không phải kết quả đo hiện tại.

## Gate còn mở có chủ đích

Independent re-review F1–F4 trên hash mới; owner02 xem narrow internal seams/Task7 actual constructors; actual03–06/certified observer/managed-target isolation/native ownership chứng minh bằng test thật. Những gate này không bị đổi thành runtime PASS bởi self-review hoặc owner target activation.
