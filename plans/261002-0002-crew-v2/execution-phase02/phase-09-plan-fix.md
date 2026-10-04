# Phase09 — Fix wave1 F1–F5

**Trạng thái:** Đã sửa toàn bộ năm finding trong cùng wave ở mức plan; chờ scoped independent review. Không tự đóng finding hoặc freeze09. Bản mới 343 dòng, giữ public005/FinalEvidencePort và SQL001–011 nguyên trạng.

## Revision chính xác

| Artifact | SHA-256 |
|---|---|
| `phase-09-plan-fix.before.md` | `9bae3aa86b14a23db905f419ca86a32a4ffdb239a1c5d123566ecbc963b58aa1` |
| `../phase-09-updates-operations.md` | `f1361657487edde690033d9fafe5b5eaa5458823c2af601f1eb8f922208d3952` |
| `phase-09-research-fix.before.md` | `cc3f846b4f5e1010dbaf7709aef745b8ee2f492cff7017b9d31b2a6bf0eeb757` |
| `../../reports/research-261002-crew-v2-updates-operations.md` | `0921da7195b1bbbae926f3136c592f7822b85e9da7875be996ee1ebc28876769` |
| `phase-09-plan-fix.diff` | `4ea10e9d9a9b99aa65be45c6597c6a9599abaa7318a2c93e1c1ca1486219b867` |

Before snapshot khớp exact SHA trong review gốc; diff gồm cả plan và research. Phase08 approved fe280b7/final SHA `54452166e7acab5d139f86b7f4d302d257a5f07c9f002a0bcff12645576a8eec` thay metadata provisional; không sửa contract08. HEAD worktree tại lần kiểm tra cuối `d9f91daef2fc87f5d167644a2084b55eeceb8be8` gồm tiến độ của peers; hash plan là revision review chính xác. Task7 candidate4ae9ed9 có search-deadline finding tại handoff, không suy closed từ HEAD mới.

## Mapping finding → producer/consumer và regression

| Finding gốc | Thay đổi trong plan mới | Regression phải chứng minh khi implementation |
|---|---|---|
| F1 P1 initial current circular | L82–95,112–125,138–140,159–168: tagged enrollment health scope; owner requestEnrollment + native preview + boot-bound challenge; enrollment/health tables và routes riêng; receipt/install/current cùng transaction từ revision0, không FK command/grant giả | Actual HTTP empty012→manual A→signed native initial health→current A→update B. Không seed current/desired/grant; mất reply/API restart, CAS/expiry/wrong boot/release và transaction fault không ghi current nửa chừng |
| F2 P1 unsigned health | L82–95,159–168,277–279: entire canonical signed observation có issuer/build/policy, nonce/expiry, install/machine, boot/start, command/grant/generation/release/outcome; native collector thật, server HealthAuthority admission/require + immutable receipt; rollback đúng previous release | Actual signature verifier/collector với fixture enrolled key; forged bearer booleans, wrong/revoked key/build, foreign operation/boot/generation/start, reused trace/nonce và altered rollback deny; restart giữ receipt và một lần current transition |
| F3 P1 circular deploy input | L126–128,147–149,297–308: immutable DeployDefinition trước actual004 create không chứa ticketId/self hash; stored ticket/hash tạo DeployPlan sau authorization; action/effect/operation uniqueness, recovery admission reconcile-only, typed services/routes; private08 branch giữ public005/SQL011 | Owner root + preapproved child qua actual createTicket/HTTP, không seeded ID/hash; prepare/finalize thật; thay target/release/config/backup/action/effect hoặc replay ticket khác deny, unknown effect không triển khai lần hai |
| F4 P1 symlink policy mismatch | L44,170–203,236–247: separate BundleResourceRegistry/native-bundle-resources ownership; signed Release.inventory artifact→strict BundleStagePolicy/BundleWriter; exact native entry identity/target, FD quarantine và unlink no-follow; generic03 scratch giữ nguyên | `.app` framework symlink thật qua stage/attest/publish/eligible cleanup; escape/cycle/target replacement/mount/hardlink/inode substitution giữ lại; crash từng bước và existing03 negatives |
| F5 P2 missing operation process proof | L170–203,247,274: separate OperationProcesses/native supervisor; controlled no-fork download/extract/coordinator, durable intent/READY/wait evidence; never_spawned chỉ trước mọi spawn intent; typed reference revisions/release receipts và lifecycle lock; current/latest previous luôn giữ | Actual supervisor+registry process stop→last ref release→cleanup qua restart; pre-spawn reservation cleanup, ambiguous intent/live/unknown retain; bytes của current/previous/other operation không đổi; không mock counter/fake workflow pin |

## Đối chiếu actual producer và self-review

- Đọc toàn bộ `phase-09-plan-review.md`, actual004 `tickets/deploy.ts:8` và `tickets/service.ts:128,166`: fingerprint bao gồm inputs, ID sinh trước hash. Không đổi actual fingerprint hoặc ticket API để né F3.
- Actual03 `resources/native-resources.c:49,136,203` chặn mọi symlink ở scan; `resources/registry.ts:175,207–223` đòi workflow READY và giữ khi không owner. F4/F5 chọn producer riêng với ownership rõ, không giả đây là capability hiện có của03.
- Rà complete plan sau sửa: mỗi typed DTO có route/service/persistence consumer, tác vụ owner và positive/negative regression; inventory do builder cuối phát hành, publisher manifest ký hash, stage xác minh trước population. Reference API trả ID/revision để releaseReference dùng được.
- Chạy structural checks: 343 dòng; code fences cân bằng; đủ F1–F5; không còn HealthProof/EnrollmentProof cũ, inputs.deployPlan hay health_report_id FK. SHA before khớp review gốc. Exact diff tạo từ before bytes, không dùng working-tree Git diff che file untracked.
- Không chạy implementation/native/live tests cho một docs-only planning fix. Các checkbox RED→GREEN là việc phải thực hiện sau approval, không phải kết quả PASS. Không sửa source/SQL, không install/ký/Keychain/notary/LaunchAgent/DB/model/deploy/stage/commit; giữ nguyên edits workflow registry của peer.

## Gate thật còn mở

Actual03–08 integration/certification; protected native observer key và trusted collector isolation; durable native operation stop witnesses; stable authorized signing/notary identity và disposable macOS test account/permission;07 UI approval; bounded live model allowance; exact owner production action sau artifact/backup/restore preview. Không gate nào thay thế việc sửa năm contract defects trên. Reviewer tiếp theo chỉ cần focused diff + producer seams và tests đã chỉ định; self-review này không là independent acceptance.
