# Phase06 plan — fix wave1 R1–R4

**READY cho scoped re-review kế hoạch.** Đã sửa cả bốn Important trong một wave; chưa có implementation/model/certification/live PASS. Không sửa source, chạy tests, install hoặc commit.

## Phạm vi và bằng chứng

Đọc đầy đủ `phase-06-plan-review.md`; đối chiếu actual producer reviewed `9dca04e`: claimAttempt lock/replay/fresh-authorizer order, recordRepairResult→repair_results/evidence reported, source005 DTO. Đọc Task5 final re-review; refresh status COMPLETE/reviewed, không tuyên bố verifier08 đã có. Hash phase05 xác minh `6906ca1eafaefe7472c233053a89d6ff83135d6194cb669c58d9671825caf41a` tại approved/frozen `fc843d2`.

PM cập nhật HEAD hiện tại `f2b9b3f` là StageB candidate, independent review pending; producer Task5 vẫn `9dca04e`. Không có saved before-fix snapshot của hai file untracked nên không dựng historical diff; bảng dưới chỉ rõ các block cần scoped review.

Owned writes duy nhất: `phase-06-assistant-workflows.md`, `plans/reports/research-261002-crew-v2-assistant.md`, báo cáo này. Giữ nguyên công việc importer/native gateway và shared manifests. Skill receiving-code-review dùng để đối chiếu feedback với producer, không mở lại approved spec.

## Finding → thay đổi cụ thể

| Finding | Plan lines sau fix | Sửa và producer handoff |
|---|---|---|
| R1 certification bootstrap | 65–66, 152, 166–188, 324, 327 | Typed context/challenge/launch/evidence/issuer/admit/verifier và separate certification supervisor; immutable010 rows, singleton calibration guard, one-use nonce+identity/budget. CLI calibration-only target-deployment composition đo first canary, sinh routing-specific capability receipt + policy receipt, normal production không nhận test admission hoặc test DB receipt. Initial designation preferred:null tháo vòng cần model certified trước chọn máy; live gate bootstrap trước normal turn. |
| R2 local inference wire | 109–115, 190–220, 291, 302, 324 | AsyncIterable RoutingEvent + resolve, bootstrap selection/frame, strict RoutingTool/typed result union và machine-authenticated production tool route. Atomic operation journal/receipts, lost-reply replay/current read; model reasoning được đưa vào AssessmentProposal, server validates và persists. Question/answer/resume, run/dispatch/capacity, reply/review branch có consumer cụ thể. A request review; B dùng actual004 result/fence/cycle; A không giả PASS. |
| R3 scoped creator009 | 45, 222–233 | Factory injected creator tại existing createTicket callsite trong caller009 Tx; ownership routing/routes/grants giao rõ cho T2 sau producer review. Owner generic creator, actorA scoped creator; rollback/link/replay giữ nguyên. Derived route-input authorization chỉ cùng submitted parent IDs/hashes/expiry qua010 provenance; route invalidation đóng lượt cũ, bootstrap snapshot mới trước assessment. Không nới generic B ACL hoặc sửa009 SQL/DTO. |
| R4 unclaimed retirement | 47, 134, 235–254 | Typed prelaunch authorization và no-launch/stopped proof;010 retirement/launch rows + INSERT-attempt hook cho phase06 commands. Bridge handoff trước dormant spawn; lock order khớp actual005. No launch authorization→safe never-authorized release; issued/unknown→retiring; any attempt/lost reply→normal finalization giữ slot. Internal command helper retire queued command, giữ immutable audit. |
| Status/docs | 9, 34, 329; research 5, 67, 71–80 | Task5 COMPLETE/reviewed9dca04e; phase05 approved hash; source file mappings bổ sung cho certifier/protocol/retirement/009 wiring. Research giữ official bytes/gates đã khảo sát, bổ sung đúng sửa và limits. |

Bỏ assertion-kernel section cũ dùng variables đã seed; thay bằng protocol bắt buộc và acceptance đi qua runtime fake transport + production HTTP/service path. Kế hoạch hiện 338 dòng, 7 tasks; T1 sở hữu toàn bộ SQL010/hook trước freeze, các task sau consume, không sửa applied migration.

## Regression matrix cho scoped re-review / implementation tương lai

| Case | Expected state/invariant | Planned owner |
|---|---|---|
| Fresh no routing certificate | One bounded cert launch; full measured surfaces mới cấp receipt rồi normal turn | R1/T2 + T7 |
| Wrong/expired/reused nonce; model/binary/policy/OS/process mismatch | Deny; identical replay same launch, no budget/expiry reset | R1 |
| Missing native Read/child/path/tool evidence; test DB receipt in production | UNVERIFIED/deny; no caller PASS boolean | R1 |
| Runtime tool stream→docs→route→assessment→capacity→claim | Real production route chain, no seeded assessment/decision/dispatch | R2/T7 |
| Question + owner answer + resume; reviewerB failed repair | Exact gate/cycle, independent evidence path004, max5 unchanged | R2/T5 |
| Unknown tool/forged approval/wrong fence/input/duplicate/lost response | Reject or replay exact durable result; no repeated effect | R2 |
| A routes to B offline, link fails, retry/re-route | ActorA + one atomic ticket/route/link; rollback all, old active/unknown route blocks correction | R3 |
| Parent authorization revoke/expiry after routing | Derived authorization no broader, old turn cannot publish from stale snapshot | R3 |
| Prepare→offline expiry/no prelaunch token | Retire fresh claim, release capacity once via never-authorized proof | R4 |
| Prepare→source/input stale with token or dormant helper | Hold until fsynced no-launch tombstone or exact stopped proof | R4 |
| Claim committed/reply lost, cancel-vs-claim race | Any attempt retains slot/guard; only one race winner/replacement after finalize | R4 |
| macOS fork/setsid descendant not supervised | UNKNOWN; no PID/groupempty/initial-child-only stop proof, no cleanup/replacement | R1/R4 +04 dependency |
| Source OFF after009 admission | Exact turn continues while other security/input/grant checks valid; fresh turn/fallback/child still current-policy gate | Existing T2/T4 unchanged |
| Official pin/owner parallel policy/08 verifier | Official bytes/templates/gates preserved; scoped parallel only safe units; final evidence remains default deny | Existing T3/T5/T7 unchanged |

## Verification và giới hạn

Đã tự rà type/port producer→consumer, exact lock order và no-loop bootstrap; kiểm tra Markdown fences/whitespace/placeholder bằng đọc file. Không chạy unit/integration/live test vì đây là plan-only fix wave. Các assertions trong ma trận là test requirements, không phải kết quả đã chạy. Runtime03 process-tree limitation do PM cung cấp được giữ như dependency04, không nâng thành measured certification.

Đề nghị scoped re-review R1–R4 và regression trực tiếp ở bảng trên. Không cần full spec re-interview, source implementation hoặc test rerun trong vòng review kế hoạch này.
