# Phase06 — scoped re-review fix wave1 R1–R4

Ngày: 2026-10-02. **READY: NO ở mức kế hoạch.** R1, R3, R4 addressed; R2 addressed phần lớn nhưng còn một thiếu sót Important trong đường đưa candidate model thực thi tới inference local.

**Spec verdict: chưa đạt** ở lựa chọn model có căn cứ cho máy dự án. **Quality/architecture verdict: chưa READY**, do strict wire contract mới chưa cung cấp dữ liệu đầu vào cho chính proposal mà nó yêu cầu. Không có finding khác trong phạm vi sửa và regression trực tiếp đã rà.

## Phạm vi và nguồn

Đọc `phase-06-plan-fix.md`, báo cáo whole-plan `phase-06-plan-review.md`, các block được chỉ định trong bản plan hiện tại 338 dòng và research cập nhật. Không có saved before-fix snapshot cho hai file untracked: review so nội dung hiện tại với bốn finding gốc và ma trận 14 ca của fix report, không dựng historical diff và không mở lại spec/official workflow đã chốt.

Đối chiếu lại actual005 `claimAttempt` tại `v2/server/src/execution/attempts.ts:149–205`: root→command→ticket→project; prior attempt lookup trước fresh authorizer; guard lock trước callback; attempt INSERT sau authorization. Task5 vẫn reviewed `9dca04e`. StageB `f2b9b3f` là candidate đang review riêng, không được dùng như consumer PASS. Các flow/spec/contracts đã đọc ở whole review được giữ làm baseline; không đọc lại hoặc thay đổi công việc importer/native gateway đang chạy song song.

## Kết quả theo finding

| Finding | Bằng chứng plan hiện tại | Kết luận |
|---|---|---|
| R1 routing certification bootstrap | 65–66,152,166–188,324,327: typed challenge/context/launch/evidence/authority; issuer/admit/verifier; calibration-only composition dùng deployment đích; first canary được miễn đúng prior certificate/probe PASS; singleton calibration guard, nonce/identity/budget, trusted observer, routing-only capability receipt | **Addressed ở mức plan.** Không còn vòng certificate-before-first-canary; production không nhận test admission/PASS boolean hoặc import test DB authority. |
| R2 local inference wire | 109–115,190–220,291,302,324: event stream/resolve; work/bootstrap; strict tool request/result; durable operation; service mapping, assessment proposal, question/resume, capacity continuation, reviewerB dùng actual004 | **Partially addressed.** Invocation/receipt/actor chain đã rõ; còn R2a dưới đây: không có candidate-discovery wire cho project execution model. |
| R3 router009 gọi scoped creator | 45,222–233: factory injection đúng callsite trong caller Tx; owner generic/A scoped; exact message decision/proof/hash, atomic route/link; derived input consent010 và fresh post-route bootstrap | **Addressed ở mức plan.** Không còn buộc A đi qua generic projectB ACL hoặc giả owner/B; producer handoff và rollback/replay tests rõ. |
| R4 unclaimed reservation retirement | 47,134,235–254: prelaunch authority trước dormant spawn; retirement/tombstone010; any-attempt branch; hook binds attempt; no-issued authorization vs issued/unknown; exact proof trước release | **Addressed ở mức plan.** Expired unclaimed command có đường release an toàn; claimed/lost reply không được TTL-release. Actual005 lock/lookup order được giữ. |
| Status/dependency refresh | 9,34,329; research phần status/fix-wave | **Addressed.** Task5 reviewed,009 vẫn plan,08 default deny; không nâng native03 observation thành process-tree proof. |

## R2a — Important: local Assistant chưa có đường đọc execution candidates trước khi chọn model

**Vị trí:** `phase-06-assistant-workflows.md:193–210,213–217,291–295`; producer đối chiếu: phase04 `getPool(db,machineId,source):Promise<PoolEntry[]>` và plan06:36,92–96.

`AssessmentProposal` bắt buộc có `chosen:ModelKey`, `choiceRationale` và `candidateReasons`; consumer kiểm chosen thuộc máy đang bind dự án và current PoolEntry. Nhưng các đầu vào mà driver local nhận chưa có pool đó:

- `AssistantWorkService.bootstrap` trả turn/snapshot/grant/scope; turn.selection là model chạy routing trên A.
- `read_catalog` chỉ trả danh mục dự án/snapshot/commit; `read_docs` trả DocRead.
- Strict `RoutingTool` và `RoutingToolValue` không có operation/result đọc model candidates của máy B. `RoutingModelPort.candidates` là routing namespace, không thay cho workflow-specific execution `getPool` của phase04.
- `assess_ticket` đã đòi choice trước khi server validate; không có response chứa candidates để local inference đánh giá lại. Unknown tool/extra field bị từ chối theo protocol mới.

**Failure trace:** owner gửi yêu cầu cho projectB; Assistant A đọc docs rồi bootstrap ticket snapshot mới sau route. Server có poolB gồm các exact runtime/provider/model keys, capability/availability/probe/source/projection khác poolA. A không thể lấy poolB qua các tool/frame đã khai báo nên chỉ có thể đoán ModelKey, dùng nhầm selection của A hoặc implementation phải tự thêm đường đọc chưa được review. Server validation đúng có thể reject lựa chọn sai, nhưng không cung cấp dữ liệu để local model thực hiện lựa chọn có căn cứ như spec yêu cầu. Fake integration chỉ cho sẵn keyB trong scripted response sẽ che khuất lỗ này.

**Sửa hẹp:** bổ sung một typed read tool/result hoặc typed bootstrap/context field cho **execution candidates**, có scope current ticket/project/workflow/input và binding hiện hành. Consumer gọi producer04 `getPool` cho exact target machine/source; trả dữ liệu metadata đủ để local inference so sánh exact keys, capability, availability/reasons cùng observed config/probe/source/projection references, không credential. Đây là read scope của Assistant A, không là quyền claim/code B. Local model dùng chính snapshot candidates đó khi tạo proposal; server vẫn revalidate current policy ở assessment/prepare/claim, không coi candidate snapshot là permit. Giao rõ T2 protocol/T4 reader cùng test owner. Giữ `RoutingModelPort` cho router A; không gộp nó thành generic cross-machine authority.

**Regression cần thêm:** A và B có pool khác nhau; fake runtime phải gọi production candidate-read rồi dựa vào returned keys để submit assessment/choice, không seed/nhúng keyB sẵn. Đổi desired OFF/probe/config/binding sau read phải khiến stale choice bị reject hoặc refresh theo current gate; same-name model khác provider/runtime không bị nhập nhằng; foreign scope không đọc được, DTO không secret. Sau đó đi tiếp actual capacity→prepare→claim của B.

## Rà ma trận 14 ca của fix wave

Các kết quả dưới là đánh giá coverage/hợp đồng của **plan**, không phải test đã chạy.

| Ca trong fix report | Kết quả scoped review |
|---|---|
| 1. Fresh no routing certificate | Đủ bootstrap: designated machine có thể preferred:null; calibration-only first launch; receipt thật trước normal turn. |
| 2. Nonce/context/OS/process mismatch và replay | Đủ: issued→admitted bind exact identity, bounded expiry/budget, replay không tạo launch mới. |
| 3. Missing native surfaces / test DB authority | Đủ: trusted trace verifier; thiếu surface UNVERIFIED; deployment/verifier binding; production không nhận test admission. |
| 4. Tool stream→docs→route→assessment→capacity→claim | Chưa đủ end-to-end data flow vì R2a. Phần mutation/continuation/receipt đã có consumer cụ thể. |
| 5. Question/answer/resume và reviewerB repair | Đủ actor/protocol: scope/gate/cycle từ server; B ghi actual004 result, A chỉ request review/consume persisted evidence, không tự PASS. |
| 6. Unknown tool/forged approval/fence/duplicate/lost response | Đủ: strict union, current authorization trước replay, durable operation+mutation cùng Tx, fsync client result, explicit pending/current-read path. |
| 7. A→B offline, rollback/retry/re-route | Đủ: injected creator cùng route/link Tx, actual actorA, no nested/separate creator, generic ACL giữ nguyên. |
| 8. Parent input authorization revoke/expiry | Đủ: derived010 provenance giữ exact parent IDs/hashes/expiry, revoke cascades; route result/checkpoint rồi stop, fresh ticket snapshot trước assessment. |
| 9. Expiry không có prelaunch token | Đủ: serialized retirement, no-ever-issued authorization proof, certified bridge cấm pre-spawn, offline safe release một lần. |
| 10. Stale input/source sau issued token/dormant spawn | Đủ: retiring tới durable no-launch tombstone hoặc exact stopped proof; deadline không là proof. |
| 11. Lost claim reply / retire-vs-claim | Đủ: any existing attempt đi normal finalization; same root/command lock quyết định race; old replay không release slot. |
| 12. macOS fork/setsid descendant chưa supervised | Đủ giới hạn: UNKNOWN/held, no PID/groupempty/initial-child-only inference; phải có actual04 constrained/brokered proof. |
| 13. OFF sau009 admission | Không thấy regression: exact current turn vẫn hợp lệ nếu security/input/grant current; candidate freshness của dispatch là admission riêng. |
| 14. Official source/parallel override/08 | Không thấy regression: official bytes/gates, owner-scoped independent units và default-deny final evidence giữ nguyên. |

## Giới hạn và handoff

Chỉ cần sửa R2a và scoped re-review producer→tool/context→local choice→server validation cùng các regression trực tiếp của nó. R1/R3/R4 không cần mở lại whole-plan review; vẫn là contract gates phải kiểm chứng khi implementation. Native03 NOTE_TRACK/NOTE_CHILD unsupported hoặc any-fork UNKNOWN là giới hạn producer, không phải process-wide proof; plan đã chuyển đúng dependency sang actual04 supervision/certification.

Không chạy test, model, install hoặc commit; chỉ tạo báo cáo này. Không có implementation/certification/comprehension/merge/docs PASS phát sinh từ lượt re-review.
