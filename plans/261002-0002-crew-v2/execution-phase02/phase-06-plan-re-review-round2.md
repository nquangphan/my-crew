# Phase06 — scoped re-review round2, chỉ R2a

Ngày: 2026-10-02. **READY: YES ở mức kế hoạch.** R2a addressed; không còn finding Important/blocking trong phạm vi sửa và regression trực tiếp. R1/R3/R4 giữ kết luận closed của vòng trước.

**Spec verdict: đạt cho R2a.** Assistant local đã có đường nhận execution candidates của đúng máy dự án trước khi chọn model và lưu căn cứ. **Quality/architecture verdict: READY cho implementation theo các gate đã nêu.** Candidate snapshot không trở thành quyền dispatch và không mở generic project-machine ACL.

## Phạm vi và bằng chứng

- Đọc `phase-06-plan-fix-round2.md`, exact unified diff `phase-06-plan-fix-round2.diff`, các block thay đổi trong plan hiện tại348 dòng và research90 dòng; đối chiếu finding R2a của `phase-06-plan-re-review.md`.
- Đọc lại producer04 `PoolEntry` và `getPool(db,machineId,source:SourcePin)` cùng quy tắc latest inventory/current boot/config/probe ở `phase-04-runtime-models.md:60–64,128,140–142`. Đây là reviewed plan contract; không khẳng định actual008 đã có.
- So sánh read-only các file hiện tại với before-fix copies thật trong `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-phase06-round2-1c9bbmby`: saved unified diff khớp hoàn toàn; các block R1, R3, R4 byte-identical.
- Không mở lại source/spec/workflow hoặc findings đã closed. Không chạy test/model/install/commit; chỉ tạo báo cáo này. So sánh tài liệu không phải implementation test.

## R2a — Addressed

| Mắt xích | Bằng chứng plan hiện tại | Kết luận |
|---|---|---|
| Producer đúng máy/workflow | 220–221: real actorA có current metadata scope; server derive máyB và exact SourcePin từ binding/run; gọi đúng `getPool(db,machineId,source)` | Không dùng routing poolA, không giả `getPool(Tx)` hoặc cho caller tự chọn máy/source. |
| Typed request/bootstrap/result | 193–214,110: ExecutionCandidateScope/Snapshot/Reader, tool `read_execution_candidates`, result `execution_candidates`, bootstrap/driver executionContext riêng | Driver có dữ liệu và context cần để đọc poolB; null trước route/run không được dùng để đoán model/source. |
| Read nhất quán và persistence | 221–224: authorization/version capture → getPool → Tx reauthorization/version comparison → existing010 tool-operation result | Thay đổi dependency giữa các bước trả stale409; receipt/result bền vững và replay theo operation, không cấp permit từ observation. |
| Model local chọn từ dữ liệu nhận được | 83,197,222,229: candidateReadOperationId, chosen/candidateReasons thuộc exact returned keys, rationale/snapshot hash/context persisted | Khép kín gap thiếu input cho assessment proposal; test không được nhúng keyB vào runtime script để che dataflow. |
| Current gate trước thực thi | 222,300–307: assessment, prepare và atomic claim đọc lại binding/input/run/source/config/probe/projection/certificate; fresh sample/capacity giữ nguyên | Historical read/replay không lách OFF, stale probe hoặc thay binding/workflow. |
| Ownership/assembly | 47,300–301,334: T4 candidates service/test, T2 protocol, T7 injection `executionCandidates` | Có producer, consumer, file owner và integration test cụ thể, không chỉ thêm tên interface. |

`ExecutionCandidate` tách declared và measured capabilities, giữ full key `(machineId,runtime,providerId,modelId)`, current revisions/receipt IDs/hashes và safe unavailable reasons. DTO allowlist cấm endpoint, credential reference/token, owner path, environment và raw errors; không spread upstream objects. Metadata scope của A không cấp claim/code authority của B.

Refresh và replay được phân biệt rõ: cùng operation trả immutable observation sau current authorization; thay đổi state đòi new read operation và local reevaluation/wait. Snapshot cũ không được ghi đè để giả freshness. Nguồn routing A OFF sau admission vẫn giữ lượt hiện tại nếu authority khác còn current; mỗi admission thực thi B vẫn qua current gates riêng.

## Regression matrix 13 ca

Đánh giá dưới đây là độ đầy đủ của plan/test requirements, không phải kết quả test đã chạy.

| Ca | Kết luận review |
|---|---|
| 1. PoolA khác poolB | Covered tại229: fake runtime gọi production candidate tool, xây proposal từ responseB rồi đi actual capacity→prepare→claimB; không seed assessment/decision/dispatch hoặc keyB trong script. |
| 2. Chưa route/run hoặc approved source/definition | Covered tại220: context null; create/resume official graph qua gates; thiếu source/definition thì wait, không dispatch sớm. |
| 3. Caller gửi machine/source hoặc foreign ticket/run | Covered tại196,201,220: strict input chỉ ticketId/runId, derive machine/source server-side, current scope404/stale409. |
| 4. Same-name model khác provider/runtime | Covered tại194,221–222,301: full exact key xuyên result/proposal; không nhập nhằng bằng modelId. |
| 5. Dependency đổi trong capture→read→persist | Covered tại221: final reauthorization/version comparison, `EXECUTION_CANDIDATES_STALE`, không publish snapshot usable. |
| 6. OFF/probe expiry/model/gateway config đổi sau read | Covered tại222,301: current assessment reject, new operation refresh/reevaluate hoặc wait. |
| 7. Binding/input/run/workflow đổi sau read | Covered tại220–222,301: stale hoặc foreign-scope deny; đọc mới chỉ current authorized context. |
| 8. Policy đổi sau assessment hoặc trước claim | Covered tại222,301–307: prepare/claim revalidate, snapshot không là authority. |
| 9. Unknown/foreign read operation hoặc key ngoài response | Covered tại222,301: proposal phải tham chiếu đúng scoped operation và returned keys; lưu snapshot hash/context cùng rationale. |
| 10. Lost read reply/replay | Covered tại221–224: durable operation, exact body replay/current scope, immutable observation; refresh dùng operation mới. |
| 11. DTO secrecy | Covered tại194–195,221,301: explicit allowlist/safe reason codes và negative DTO assertions. |
| 12. Exact current routing turnA sau source OFF | Covered tại222,301: scoped read tiếp tục nếu security/input current; B execution vẫn current-policy admission. |
| 13. Closed findings và gates còn lại | Direct byte comparison xác nhận R1/R3/R4 unchanged; diff không thay official source/parallel policy/max5 hoặc08 default deny. |

## Ranh giới READY

READY này đóng R2a và hoàn tất các findings của plan review06; chưa xác nhận implementation hay runtime. Actual007/008/009 và010 integration, native process-tree supervision/certification, direct multimodal comprehension, cùng Phase08 verifier vẫn là gates riêng. Native03 UNKNOWN/unsupported descendant observation không được coi là stopped-tree proof; production thiếu authority vẫn fail closed. Task5 reviewed9dca04e được giữ, không dùng candidate docs StageB như consumer PASS.

Không yêu cầu sửa thêm trong phạm vi R2a. Khi triển khai, chạy các tests đã giao và independent review producer→consumer thực tế trước mở gate.
