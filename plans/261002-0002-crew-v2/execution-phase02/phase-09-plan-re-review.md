# Phase09 — scoped re-review fix wave1

**Spec READY: NO. Quality READY: NO.** Cơ chế sửa cả F1–F5 đã giải quyết lỗi gốc. Còn một lỗi conformance mới N1/P2 tại seam effect ID vừa được bổ sung; cần sửa trước freeze09. Không mở lại whole-plan review hoặc các producer reviews đã đóng.

## Revision và phạm vi

- Plan 343 dòng, SHA256 `f1361657487edde690033d9fafe5b5eaa5458823c2af601f1eb8f922208d3952`.
- Exact combined plan/research diff SHA256 `4ea10e9d9a9b99aa65be45c6597c6a9599abaa7318a2c93e1c1ca1486219b867`. Đã tái tạo unified diff từ hai before snapshots; kết quả byte-identical (`exact_diff_matches: True`). Before plan khớp revision review gốc.
- Đọc original review, full fix report, phần sửa plan/research và narrow producer seams cần cho F1–F5. HEAD lúc kiểm tra `d9f91daef2fc87f5d167644a2084b55eeceb8be8`.
- Giữ checklist `writing-plans` đã đọc trong review gốc. Không chạy lại broad producer tests, không source/plan/SQL edits, install/native/live/model/DB/service/deploy/stage/commit hoặc subagent. Chỉ ghi report này.
- Phase08 approved fe280b7/final SHA `54452166e7acab5d139f86b7f4d302d257a5f07c9f002a0bcff12645576a8eec`; không re-review08. Theo controller, Task7 hiện đã hoàn tất review c6f9b60; status09 dòng9 còn ghi finding cũ là metadata cần refresh, không phải blocker hợp đồng mới.

## Closure của findings gốc

| Finding | Kết luận | Plan lines xử lý | Kiểm tra |
|---|---|---|---|
| F1 initial-current bootstrap | **ADDRESSED** | 82–95,116–124,135–137,161–167 | Tagged enrollment scope và proposedRegistrationId không FK install; health receipt độc lập command/grant. Owner intent→003 auth/007 boot→challenge→signed collector→receipt/install/current cùng Tx; activation_generation null chỉ enrollment. Empty012 test cấm seed current/fake grant và kiểm transaction rollback/replay. |
| F2 authenticated health | **ADDRESSED** | 82–95,109,162–168,203,279–280 | Signed canonical observation bao toàn challenge/scope/nonce/issuer/build/policy/measurements/outcome. Native collector tự kiểm process/path/package trước ký; server admission kiểm pinned authority và persisted challenge. UpdateReport chỉ nhận receipt ID; require exact activation/rollback scope. Actual collector/signature path, forged/revoked/wrong boot/new challenge replay negatives đã được giao test. |
| F3 circular fingerprint/ticket ID | **ADDRESSED** | 126–128,144–146,297–307 | Immutable DeployDefinition không chứa server IDs/self hash; actual004 tạo ticket rồi012 đọc stored ID/hash. Approval child dùng known root/inherited pin và unchanged fingerprint. Unique operation/action/effect mapping, append-only recovery admission giữ old attempt immutable; reconcile-only không tự chạy lại. N1 bên dưới là lỗi encoding mới trong seam04 vừa bổ sung, không còn vòng fingerprint gốc. |
| F4 framework symlinks | **ADDRESSED** | 44,57,63,172–175,184–195,200,203,230,245–247 | Separate BundleResourceRegistry/native-bundle-resources với inventory hash ký trong Release; explicit writer/policy/identity, relative internal symlink validation và unlink entry no-follow. Generic03 scratch helper không bị nới. Real framework symlink positive qua attest/publish/retire/delete và substitution/escape/hardlink/mount negatives. |
| F5 operation cleanup ownership | **ADDRESSED** | 176–183,196–203,247 | Separate OperationProcesses/native supervisor có intent/generation/READY/wait/fork evidence, closed tombstone và never_spawned chỉ trước intent. Không fake workflow pin hoặc03 READY. Registry resolve protected proof thay client boolean; typed refs/revisions/transition receipts và lifecycle lock; current/latest previous giữ lại. Actual worker/registry cleanup qua restart và uncertain-window retention được test. |

**Unaddressed original findings: none.** Một new fix-diff finding còn mở: N1.

## N1 — P2: Effect ID từ04 bị gắn validator UUID của09

**Plan lines:** 54,298,306; producer evidence `phase-04-runtime-models.md:162,168`, `phase-06-assistant-workflows.md:118,136`.

Fix mới dòng306 bắt buộc request dùng exact effect ID của04. Producer04 derive `effectId=SHA-256(runId,stepOperationId,actionKind,targetIdentity,preconditionSha256)`, tức digest hex64;010 lưu stable effect linkage qua `assistant_operation_ids`. Nhưng09 định nghĩa `Id=string(UUID)` và `DeployPlan.effectId:Id`; `DeployRequest` lấy nguyên field đó, rồi recovery cũng kế thừa. Với strict wire schemas của plan, effect hợp lệ từ04 sẽ bị từ chối vì không phải UUID. Nếu fixture sinh UUID để chạy được thì không còn kiểm đúng producer04 hoặc cross-attempt dedup đã yêu cầu.

**Sửa hẹp:** Định nghĩa `EffectId=Sha256`/exact04 digest representation riêng và dùng nhất quán cho request/plan/recovery/persistence effect fields; giữ UUID cho operation/ticket/attempt/action IDs. Ghi rõ server đối chiếu fields với010 `assistant_operation_ids` trong Tx, còn local04 EffectLedger chịu execution/reconcile, tránh hiểu “server effect ledger” thành một local ledger có thể đọc qua SQL. Không đổi producer04 hashing hoặc SQL001–011 để làm digest thành UUID.

**Regression cần thêm:** Tạo effect bằng actual04 canonical derive + persisted010 mapping, gửi hex64 qua real09 prepare→recovery/receipt path thành công; UUID-looking effect, wrong digest/precondition/action hoặc digest thuộc ticket/run khác bị từ chối. Fixture không tự tạo effect UUID và không bypass HTTP parser. Chỉ cần scoped contract check, không chạy lại broad04/06 suites trong plan review.

## Các điểm triển khai vẫn là genuine gates

- Health issuer key/build protection và collector IPC phải đo bằng native negatives trước trusted production enrollment; key fixture chỉ thay enrolled identity. Chữ ký app không tự chứng minh same-UID process isolation. Plan163–168 nêu đúng giới hạn này; không cần owner key/cert để sửa N1.
- Native operation supervisor phải chứng minh actual no-fork/wait witnesses và giữ UNKNOWN khi mất chứng cứ. Native helper/worker IPC và launcher cần nằm trong measured boundary; code không được vô tình spawn helper như con của no-fork worker rồi gọi nó stopped. Plan196–203 đã giao own modules, stop-witness certification và uncertain-window retention, chưa claim implementation PASS.
- Bundle registry phải thực hiện exact manifest/FD checks và ref transitions dưới cùng lifecycle lock; signed inventory không thay quyền xóa. Swap rebind, partial unlink uncertainty và stable app-path exclusion cần native crash evidence.
- Actual03–08 integration/certificates, authorized signed A/B lane,07 UI approval, bounded model allowance và exact production deploy approval vẫn riêng. Không dùng plan review hoặc Task7 API completion thay những bằng chứng này.

Sau sửa N1 và refresh bookkeeping Task7, chỉ cần scoped re-review đúng diff/type propagation của N1 để freeze09; không cần lặp F1–F5 hoặc whole08 review. Review này không cấp implementation/runtime/signing/deployment PASS.
