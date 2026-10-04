# Phase09 round2 — joint scoped N1 / Phase08 EffectId conformance review

**Phase09 Spec READY: YES. Quality READY: YES — ở mức kế hoạch.** N1 **ADDRESSED**. **Phase08 thin contract correction READY: YES** về spec/quality trong phạm vi encoding được giao. Không phát hiện blocker mới trong four-file fix diff. Original09 F1–F5 và08 F1–F4 giữ CLOSED; không mở lại whole-plan review.

## Exact revision và evidence

| Artifact | SHA256 đã kiểm tra |
|---|---|
| Phase08 before đã approved | `54452166e7acab5d139f86b7f4d302d257a5f07c9f002a0bcff12645576a8eec` |
| Phase08 after,330 dòng | `1aa930e91b11c43d784eb89ffbf9a35d10a0f53e99d0f28a45c33eac1a7beb08` |
| Phase09 before round2 | `f1361657487edde690033d9fafe5b5eaa5458823c2af601f1eb8f922208d3952` |
| Phase09 after,344 dòng | `69af0ac6e139648eb26919d373e6860576cd5aeba7003c290dd9a2c2203646e8` |
| Combined four-file diff | `ec9f9edfc2f1137d0652a3f004870916a865dab578a7fcecd202e7ed231d0743` |
| Research08 after | `a2ec3dd79266e33c1ce5b7b10a2eca844735d23a0c87aa8e528d796553f980bf` |
| Research09 after | `d1802d7a59a4f9b606b8d74bed7836129796286a0c73f8119452f0e4ccf8872f` |

Đọc full `phase-09-plan-round2-fix.md` và exact diff; đối chiếu before09 với N1 review, before08 với approval lịch sử. Tái tạo unified diff từ đủ bốn before snapshots cho kết quả byte-identical (`exact_diff_matches: True`); research before hashes cũng khớp fix report. HEAD read-only `d9f91daef2fc87f5d167644a2084b55eeceb8be8`; revision review dựa exact file hashes vì peers đang làm source.

## N1 closure và thin08 verdict

| Seam | Exact plan lines | Kết luận |
|---|---|---|
|09 scalar/wire types |54,76,298 | EffectId=Sha256 lowercase hex64 được tách khỏi UUID; DrainSnapshot dùng EffectId[], DeployPlan.effectId truyền nguyên qua DeployRequest Pick và DeployRecoveryAdmission. Receipt planSha256 ràng buộc digest trong immutable plan; không cần đổi receipt ID thành digest. |
|09 persistence/admission |126–127,306 |012 effect_id text/check hex64 thay UUID expectation; prepare/recovery đối chiếu010 assistant_operation_ids và current ticket/attempt command trong Tx. Canonical digest được kiểm lại, changed effect409; operation/ticket/attempt/action vẫn UUID. |
|09 positive/negative acceptance |307 | Actual04 derive + actual010 producer-persisted mapping đi qua real HTTP prepare/recovery/signed receipt/restart; reject UUID-looking/wrong digest/action/target/precondition/foreign run/ticket. Không seed UUID hoặc bypass parser. |
|08 DTO/ports/persistence |57,64,83,85,105–106,123 | Candidate, MergePermit, MergeReceipt, builder và reconcile đều dùng exact EffectId; mọi011 effect field/JSON có cùng representation. Public005/FinalEvidencePort không đổi; sửa kế hoạch không là quyền rewrite SQL đã freeze. |
|08 journal/Git/authority |251,254,262 | Journal key, effect lock và refs/crew/integration/<effectId> dùng nguyên digest, không truncate/rehash/UUID-parse. Server mapping check và HTTP candidate→permit→apply→signed receipt→restart/reconcile regression giữ identity liên tục. Target lock/CAS/factual writer/reader/onboarding/head semantics không đổi. |

**Unaddressed N1 items: none. New fix-diff findings: none.** Các alias propagation được kiểm tra trên toàn bộ occurrences của effect fields trong đúng hai plan, không thấy `effectId:Id` hoặc `unresolvedEffectIds:Id` còn sót.

## Producer conformance trong phạm vi hẹp

- Reviewed04 `phase-04-runtime-models.md:162,168` derive SHA-256 canonical(runId,stepOperationId,actionKind,targetIdentity,preconditionSha256) và giữ local EffectLedger intent/receipt/reconcile. Hai consumer nay giữ nguyên representation/derive; không đổi thuật toán producer để hợp UUID.
- Reviewed06 `phase-06-assistant-workflows.md:131,133,136` cung cấp workflow_steps(run_id,ticket_id), assistant_dispatches(command_id,run_id,step_id) và assistant_operation_ids(id,run_id,step_id,action_kind,target_identity,precondition_sha256,effect_id). Các field cần cho mapping/join mới đã có trong producer plan, nên server không cần đọc local ledger qua SQL/network trong Tx. Actual implementation của producers vẫn phải có trước acceptance; review này không tuyên bố010 hiện đã chạy.
-09 metadata nay ghi Task7 COMPLETE4ae9ed9+c6f9b60 và giữ new012 wiring review riêng. Reference09 tới new08 SHA khớp file thật; historical08 approval được giữ rõ. Controller có thể cập nhật wording pending/provisional sang scoped-review closed mà không đổi hợp đồng đã review.

## Giới hạn xác minh

Đây là static plan/producer-contract review: không chạy application/native/live tests, không sửa source/SQL/plans/research, không install/service/DB/model/deploy/stage/commit hoặc spawn subagent; chỉ tạo report này. Tests được yêu cầu trong kế hoạch vẫn là việc phải chạy khi implementation, không phải PASS đã đo.

Actual03–08 integration, protected observer/key/process evidence, signed/notarized A/B update,07 UI approval, bounded live model allowance và exact production deployment approval vẫn là genuine gates. READY của plan không cấp runtime/signing/production PASS hoặc quyền deploy.
