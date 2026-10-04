# Phase06 plan — fix round2/5, R2a only

**READY cho scoped re-review R2a.** Chỉ bổ sung execution candidate discovery cho local Assistant; chưa có implementation/test/model/certification PASS. R1/R3/R4 đã closed theo `phase-06-plan-re-review.md` và giữ nguyên từng byte trong cả ba block plan.

## Bằng chứng và phạm vi

Đọc toàn bộ scoped re-review và đối chiếu producer04 `PoolEntry` dòng60–64, `getPool(db,machineId,source:SourcePin)` dòng128, policy/latest inventory ở140–142 trong `phase-04-runtime-models.md`. Đây là reviewed plan producer; actual008 vẫn là implementation gate. Task5 reviewed9dca04e, phase05 frozen hash và08 default deny giữ nguyên. Áp dụng receiving-code-review/writing-plans cho sửa hẹp, không mở lại approved spec hoặc official pins/owner parallel policy.

Before-fix copies thật được lưu tại `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-phase06-round2-1c9bbmby`; unified diff của đúng plan + research tại `execution-phase02/phase-06-plan-fix-round2.diff`. Không dựng lại lịch sử. Owned writes chỉ hai tài liệu đó, báo cáo này và diff được PM yêu cầu; không sửa nguồn/shared manifests hoặc công việc agent khác.

## Changed blocks sau fix

| File / lines | Thay đổi R2a |
|---|---|
| Plan 9,47 | Round2 status; T4 owns candidates.ts + assistant-candidates.test.ts |
| Plan 83,110 | Assessment bắt buộc candidateReadOperationId; driver nhận executionContext tách routing selectionA |
| Plan 193–214 | Typed scope/allowlisted entry/snapshot/reader; strict read_execution_candidates request + execution_candidates result; bootstrap context nullable trước route/run |
| Plan 220–222 | Real actorA scoped metadata auth; derive B/source từ stored binding/run; exact getPool producer; capture/recheck + durable read result; candidate snapshot chỉ observation, current policy kiểm lại ở assessment/prepare/claim |
| Plan 226,229 | Mapping read tools rõ; production fake-transport integration gọi candidate read trước proposal, chỉ dùng returned keys, rồi đi actual capacity→prepare→claimB |
| Plan 300–301,334 | Reader factory/ownership/test command/negative cases; T7 assembly injection |
| Research 82–86 | Producer evidence, gap resolution/data flow và giới hạn plan-only |

## Regression matrix cho implementation và scoped re-review

| Case | Expected |
|---|---|
| PoolA khác poolB; bootstrap routing modelA | Production tool nhận exact scoped poolB theo workflow source; runtime chọn từ response trước proposal, không scripted seed keyB |
| Chưa có route/run; source/definition chưa approved | Context null; tạo/resume official graph bằng existing gate hoặc chờ; không đoán model/source hoặc dispatch sớm |
| Read request tự đưa machine/source hoặc foreign ticket/run | Strict schema reject hoặc404; real actorA scope, generic B ACL không mở |
| Same-name model khác runtime/provider | So full machine/runtime/provider/model key; candidateReasons/chosen dùng exact returned keys |
| Config/probe/latest inventory/source/projection đổi trong capture→read→persist | Final Tx recheck trả409 EXECUTION_CANDIDATES_STALE, không publish snapshot usable |
| Desired OFF/probe expiry/model hoặc gateway config đổi sau read | Assessment rejects stale/ineligible; fresh operation đọc lại rồi reevaluate/wait |
| Binding/input/run đổi sau read | Stale409 hoặc foreign-scope404; read mới chỉ current authorized context |
| Đổi các state trên sau assessment hoặc trước claim | Prepare và atomic claim current checks deny; historical candidate snapshot không là permit |
| Unknown/foreign read operation hoặc chosen key ngoài response | Assessment reject; persist receipt hash/context/rationale với accepted assessment |
| Lost candidate-read reply / replay | Same operation/body/current scope trả immutable observation; refresh dùng new operation, không overwrite old receipt |
| DTO secrecy | Chỉ allowlist keys/capabilities/reasons/revisions/hashes/receipt IDs; không endpoint/credentialRef/token/path/env/raw errors |
| Exact current routing turnA sau source OFF | Scoped read được tiếp tục nếu security/input current; fresh B execution admission vẫn kiểm current policy |
| Closed R1/R3/R4, official workflow/parallel, max5,08 deny | Three closed blocks byte-identical; không đổi những gates còn lại |

## Self-review và giới hạn

Plan 348 dòng, research90; kiểm tra whitespace/fences và so before/after ba closed blocks bằng script thành công. Type chain producer→reader→tool result→driver→proposal→current admission đã tự rà. Không chạy tests, model, install, source change hoặc commit; test matrix là yêu cầu tương lai. Không gắn nhãn implementation PASS từ việc sửa tài liệu.
