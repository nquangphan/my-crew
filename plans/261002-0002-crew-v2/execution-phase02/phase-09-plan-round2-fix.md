# Phase09 round2 — N1 và cùng EffectId encoding defect trong08

**Trạng thái:** Sửa hẹp xong, chờ joint scoped independent review08/09. Original09 F1–F5 đã CLOSED;08 F1–F4 giữ CLOSED và approval lịch sử. Không tự freeze/approve revision mới.09 hiện344 dòng,08 hiện330 dòng.

## Revision và exact artifacts

| File | Before SHA-256 | After SHA-256 |
|---|---|---|
| `plans/261002-0002-crew-v2/phase-08-integration-docs-gates.md` | `54452166e7acab5d139f86b7f4d302d257a5f07c9f002a0bcff12645576a8eec` | `1aa930e91b11c43d784eb89ffbf9a35d10a0f53e99d0f28a45c33eac1a7beb08` |
| `plans/261002-0002-crew-v2/phase-09-updates-operations.md` | `f1361657487edde690033d9fafe5b5eaa5458823c2af601f1eb8f922208d3952` | `69af0ac6e139648eb26919d373e6860576cd5aeba7003c290dd9a2c2203646e8` |
| `plans/reports/research-261002-crew-v2-integration.md` | `73492ab84cf3aa44da262b432e943e61a0e9e3010b9eb35ed12897ffb18a1f3e` | `a2ec3dd79266e33c1ce5b7b10a2eca844735d23a0c87aa8e528d796553f980bf` |
| `plans/reports/research-261002-crew-v2-updates-operations.md` | `0921da7195b1bbbae926f3136c592f7822b85e9da7875be996ee1ebc28876769` | `d1802d7a59a4f9b606b8d74bed7836129796286a0c73f8119452f0e4ccf8872f` |

Exact before files cùng thư mục report: `phase-08-plan-round2.before.md`, `phase-09-plan-round2.before.md`, `phase-08-research-round2.before.md`, `phase-09-research-round2.before.md`. Combined four-file diff `phase-09-plan-round2.diff`, SHA256 `ec9f9edfc2f1137d0652a3f004870916a865dab578a7fcecd202e7ed231d0743`. HEAD read-only cuối `d9f91daef2fc87f5d167644a2084b55eeceb8be8`; peers đang triển khai03 nên revision review dùng exact file hashes.

## N1 → thay đổi và regression

- Đọc toàn bộ `phase-09-plan-re-review.md`; producer04 `phase-04-runtime-models.md:162,168` derive SHA-256 canonical(runId,stepOperationId,actionKind,targetIdentity,preconditionSha256).06 `phase-06-assistant-workflows.md:136` định nghĩa persisted010 assistant_operation_ids; workflow_steps/assistant_dispatches nối run/step với ticket/command. Đây là producer contract cần actual implementation trong acceptance, chưa là runtime PASS.
-09 L54,76,126–127,298,306–307: `EffectId=Sha256`, lowercase hex64; DeployPlan→DeployRequest→DeployRecoveryAdmission, drain unresolved effects,012 effect text và plan-hash receipt linkage giữ representation. Operation/action/ticket/attempt/receipt IDs vẫn UUID. Parser không coercion UUID hoặc fallback tạo effect ID khác.
-09 prepare/recovery đọc010 mapping trong cùng Tx, khớp id=stepOperationId/run/step/action/target/precondition và actual005 ticket/attempt command; kiểm lại digest bằng unchanged04 canonical derive. Local04 EffectLedger giữ execution/reconcile, không giả là SQL server ledger. New actual04-derived digest + actual010 producer-persisted mapping đi qua HTTP09 prepare/recovery/signed receipt; UUID/wrong digest/precondition/action/target/foreign run hoặc ticket phải deny trước effect. Không SQL-seed mapping hoặc bypass parser.
-08 L57,64,83,85,105–106,123,251,254: cùng thin alias correction cho Candidate/MergePermit/MergeReceipt/CandidateBuilder/IntegrationGit, parser,011 effect text và exact journal/effect-lock/ref-key digest. Server đối chiếu010 mapping, local ledger giữ ownership. New HTTP candidate→permit→apply→signed receipt→restart/reconcile regression với actual04-derived hex64; negative UUID/digest/action/target/precondition/foreign run. Không sửa factual writer, private reader, managed-target onboarding hoặc head authority đã duyệt.
- Metadata09 cập nhật Task7 COMPLETE4ae9ed9+c6f9b60, F1/M1 closed, M2 minor ledger.08 approval lịch sử giữ exact before SHA; thin correction mới và09 dependency SHA ghi PROVISIONAL đến joint scoped review. Research chỉ bổ sung bằng chứng representation này và bookkeeping liên quan.

## Self-review và giới hạn

Static checks PASS: không còn `effectId:Id` hoặc `unresolvedEffectIds:Id` trong08/09; fences cân bằng; byte-exact before08 khớp approved SHA;09 reference đúng new08 hash; combined diff tái tạo từ đủ bốn before snapshots. Soát diff chỉ thấy alias/propagation/parser/persistence/assertion/metadata được giao, cùng regression cho N1. Không đổi04 hashing hoặc actual SQL001–011/public005/FinalEvidencePort.

Không chạy broad04/06 tests hoặc native/runtime/model/live tests để chứng minh một plan edit. Không source/install/DB/Keychain/signing/service/deploy/stage/commit/subagent; giữ source và registry edits của peers. Signing/native trust/certification/UI approval/bounded live budget/exact production authorization vẫn là genuine external gates, không cản sửa encoding. Joint reviewer chỉ cần N1 và cross08 thin encoding diff; self-review không thay independent acceptance.
