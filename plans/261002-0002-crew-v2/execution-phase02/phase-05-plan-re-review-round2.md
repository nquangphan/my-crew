# Phase05 — scoped re-review round2

Ngày: 2026-10-02. **READY: YES ở mức kế hoạch.** P1-R1 và P2-R2 đã addressed; không còn finding blocking trong phạm vi hai thay đổi và regression trực tiếp của chúng. Đây không phải implementation/live-test PASS.

Phạm vi chỉ R1 legacy comment revision và R2 source OFF/admitted turn từ `phase-05-plan-re-review.md`. Đọc fix-round2, phần sửa của plan/research và đối chiếu actual legacy comment, mutator, claim và child-create producers. Không mở lại whole-plan review, không sửa source/frozen plans, install, DB/test/model call, commit hoặc delegation. Hai lỗi transcription phát hiện trong lượt review đã được planner/controller sửa; reviewer đọc lại bản lưu trước kết luận.

## Mapping finding → bằng chứng → kết luận

| Finding | Bằng chứng bản plan hiện tại | Kết luận |
|---|---|---|
| P1-R1 legacy comment không cập nhật revision CAS | `phase-05-attachments.md:258–290`: additive009 BEFORE INSERT trigger trên comments, root/affected-target/input-row locks; `544–545`: wrapper không bump lần hai, event cursor chỉ wake; `948–980`: actual legacy producer, fanout, barriers, rollback/replay tests. | **Addressed.** Legacy và attachment comment dùng cùng INSERT invariant, không cần sửa public appendComment signature hay SQL004. |
| P2-R2 config blanket revoke làm hỏng lượt Assistant hiện tại | `phase-05-attachments.md:304–314,339–347,363`: typed/stored immutable admission, phân biệt fresh admission với current admitted session; `1008–1017`: OFF trước/sau admission, replay, next turn/fallback và security revoke tests. | **Addressed.** OFF chặn lượt mới; exact lượt đã admitted được fetch/receipt/reply nếu các authority khác còn hợp lệ. Spec/frozen phase04 giữ nguyên. |
| R1 typed snapshot / SQL transcription | `phase-05-attachments.md:235–239` có `InputSnapshot.comments`; SQL function đóng bằng `END; $$;` tại283. Prose canonical ancestor comment IDs/body hashes ở976 thống nhất literal. | **Đã sửa và đọc lại.** Không còn bất nhất chặn implementer ở hai chỗ này. |
| Regression trực tiếp của R1/R2 | Lock order, snapshot child mới, no double bump, replay/current admission, expiry/revoke và fallback xét dưới đây. `research-261002-crew-v2-attachments.md:83–85` thống nhất hợp đồng. | **Không phát hiện blocker mới trong phạm vi.** |

## R1: producer tới claim/reply và child snapshot

- Producer thực `v2/server/src/tickets/decisions.ts:10–25` INSERT comment rồi appendEvent trong caller Tx. Trigger009 do Task1 sở hữu bắt đúng INSERT này và INSERT của attachment method; source cũ không cần biết bảng mới. `v2/server/src/journal/mutation.ts:30–41` khóa event_cursor trước callback/replay, tương thích yêu cầu trigger không lấy journal lock sau root.
- Actual005 `v2/server/src/execution/attempts.ts:152–155` khóa root → command → target → project; `authorizeDispatch` tại197 chạy trước fence increment/attempt INSERT tại198–202. Plan đặt `assertDispatchInputsCurrent` trong hook đó, lấy input row sau locks đã có; không thêm field vào DispatchPermit hoặc đổi claim signature. Replay attempt đã tồn tại vẫn là replay của claim cũ, không phải fresh dispatch; counter mới chặn publication tiếp theo theo policy đã ghi.
- Root lock serialize fanout comment với child creation; actual `v2/server/src/tickets/service.ts:139–144` lấy root/parent trước child INSERT. Comment tại ancestor tăng counter của ancestor và descendants đang tồn tại; comment ở child không bump sibling. Child tạo sau comment lấy ancestor history vào snapshot đầu; không cần làm revision số của child bằng revision số parent để có snapshot đúng. Canonical snapshot chứa ordered inherited comment IDs/body hashes và counter.
- Attachment wrapper được yêu cầu prelock cùng affected descendant set/input rows trước compose. Trigger re-lock cùng set không đảo thứ tự. Trigger là writer duy nhất của comment insertion; linkSelection/finishSubmission và event replay không bump lại. Link failure/transaction rollback cùng rollback comment, counter, links và event. Extraction completion là mutation sau riêng nên tăng thêm counter là đúng.
- Acceptance hiện yêu cầu actual appendComment + actual mutate; fixture không UPDATE revision hoặc giả event. Barriers đặt sau lock trong callback và kiểm cả hai thứ tự commit, không đòi hai callback cùng qua global serialized region. Comment thắng thì stale claim/reply409; claim/reply thắng thì lần đó hợp lệ, comment tạo pending-input cho hành động sau. Actual phase06 publish path vẫn phải chạy lại integration cases trước enable.

## R2: current authority khác fresh admission

- `authorizeSession` tạo admission server-side khi source ON, model/policy hợp lệ, trong Tx khóa config/designation/grant/snapshot. Session lưu exact admission/model/runtime/process/expiry; reserved sau commit là một lượt đã nhận, không phải quyền mint lượt khác.
- Replay tìm session cũ và kiểm persisted identity/current authority trước fresh admission gate; không mint admission, reset expiry hoặc reopen terminal session. OFF thắng trước admission thì wait/deny; admission thắng trước OFF thì chỉ exact lượt đó tiếp tục. Request không tự cấp admissionId thành quyền.
- `assertSessionCurrent` không đòi current source ON hoặc config revision bằng admission revision cho lượt cũ. Nó vẫn kiểm grant/session expiry, snapshot/input/route, designation, explicit revoke/pause/cancel và security authority. Vì vậy OFF đơn thuần không làm hỏng receipt/reply, nhưng không tắt các cổng revoke đã có.
- New selection/session/turn/fallback và child/code dispatch vẫn phải qua current source/model/permit gates; admission cũ không khởi tạo transport khác. Đây là semantics spec:73–76/frozen phase04:211, không thay public RuntimeAdapter hay tạo project attempt giả.

## Ranh giới kết luận

Review chấp nhận hai sửa đổi ở mức plan; actual migration009, trigger SQL/locking/concurrency tests, model-source race tests, và phase06 authority/driver integration còn phải được thực hiện. Các gates extractor/native stop proof/runtime delivery từ review trước vẫn giữ nguyên. Không có test hay runtime certificate nào được báo PASS từ lần re-review này.
