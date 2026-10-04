# Re-review S5 FIX1 — `2bdc332..4653b89`

Reviewer: code-reviewer (scoped, lăng kính bảo mật). Đọc diff source `gates.ts`, `runs.ts`, `operation-request.ts` cùng các test mới. Đối chiếu thêm: `docs/manifest.ts:36–64` (`validPath`), `migrations/004_tickets.sql:78–86` (`evidence.created_at default now()`), `migrations/002_journal.sql:16–17` (index events), `journal/events.ts:37–46`, `runs.ts:200` (`readRun` cùng dùng thứ tự journal). Không chạy lại test.

## Verdict từng mục

| Mục | Verdict | Ghi chú |
|---|---|---|
| I1 artifact bị thay | **ADDRESSED** | `artifactState` lấy row mới nhất theo `attempts.fence desc, evidence.created_at desc`, chỉ trong binding hiện hành. Nếu nhiều row cùng mốc thì tất cả phải cùng SHA. Hỏi hoặc approve bytes cũ trả 409, `reject` vẫn được (`allowSuperseded` chỉ bật cho reject). Đã có test approve X sau Y, test reject sau Y, và test ghi lại X. Xem N1 về liveness. |
| W7 run bị thay | **ADDRESSED** | `assertRunCurrent` chạy cả lúc hỏi (mọi câu hỏi gắn run) lẫn lúc load khi trả lời. So sánh dùng `min(cursor)` của `ticket.created`, cùng nguồn với `readRun`. Xem N2 và N3. |
| M1 lock order | **ADDRESSED** | `recordGateAnswer` khóa `event_cursor` trước `loadQuestion`. `createOwnerQuestion` và `answerGate` không append event nên không cần khóa này. Precondition đã ghi trong JSDoc. Test `55P03` chứng minh thứ tự khóa. |
| M2 so path | **PARTIALLY ADDRESSED** | Đã chuẩn hóa `./`, `/` cuối, chặn `..`/tuyệt đối/`//`/`\`, và phát hiện quan hệ cha/con. Còn lọt: khác hoa thường, khác chuẩn Unicode, và percent-encoding (N4). |
| M3 validator chung | **ADDRESSED** | `parallelUnits(value, shapeError)` được dùng ở cả hai nơi. Không có import vòng (`gates.ts` không import `runs.ts`). |
| M4 union `ask_owner` | **ADDRESSED** | Đã thêm member vào union và bỏ cast; tag vẫn là `crew-v2:operation-request:1`. Các port khác tự tính expected hash theo action của chính mình, nên member mới không mở thêm quyền. |
| M5 test | **ADDRESSED** | Có test mới cho decision của gate khác hoặc root khác, cho câu hỏi đã trả lời, và cho ask_owner trong form đã gắn tag. Giải thích ca (d) là đúng. |

## Trả lời các lens

- **Thao túng "mới nhất" khi `created_at` trùng.**
  - Không leo thang quyền được. `fence` và `created_at` đều do server đặt, và máy vốn đã là nguồn tin của artifact (`verification:'reported'`).
  - Khi trùng mốc (nhiều evidence trong cùng một Tx, vì `now()` là giờ bắt đầu Tx), nếu SHA khác nhau thì mọi row đều bị coi là superseded, tức đóng an toàn.
  - Hai Tx đồng thời trên cùng attempt có thể có `created_at` ngược với thứ tự commit (`now()` lấy lúc bắt đầu Tx). Khi đó row "mới nhất" là row bắt đầu sau, không phải row commit sau. Chỉ chính máy đó tạo được tình huống này, và hệ quả bị giới hạn: owner vẫn chỉ approve đúng SHA đã hiển thị. Chấp nhận.
  - Thứ tự đặt `fence` trước là đúng: artifact của attempt cũ không đè được attempt mới.
- **Thứ tự journal có tin được không.** Có. `events.cursor` chỉ cấp qua UPDATE `event_cursor`, và khóa row này giữ đến khi commit, nên cursor đơn điệu theo thứ tự commit. Chỉ server ghi được. Ngoại lệ là run không có event `ticket.created` (N3).
- **5 thay đổi hành vi của `runs.ts` có phá bất biến S4 không.** Không phá. Các thay đổi đều chặt hơn và đóng an toàn: tuần tự vẫn là mặc định, approval của root khác vẫn trả `null` trước khi gọi `units()`, xung đột vẫn bị từ chối (nay thêm path lồng nhau và `dependsOn`), và test song song S4 đã nghiệm thu vẫn xanh. Key không phải path như `migration:011` hay `index:x` vẫn qua `validPath` vì dấu `:` hợp lệ. Hai chỗ đổi đáng chú ý:
  - Decision `parallelApprovalId` đã lưu mà có field lạ, hoặc key không phải path, nay sẽ bị 409. Chấp nhận được vì production chưa có dữ liệu.
  - `workflow_steps.ownership_keys` vẫn lưu key thô chưa chuẩn hóa (N5).
- **Path phân biệt hoa thường trên macOS.** Chưa xử lý (N4). Hướng sai an toàn là từ chối thừa, nên chi phí sửa thấp.

## Finding / breakage mới

**Important:** không có.

**Minor**

- **N1 — Liveness của gate khi bước có nhiều artifact.** `gates.ts` `artifactState`.
  - **Vấn đề:** "mới nhất" tính trên mọi evidence `artifact` của ticket bước, không phân biệt `locator`. Nếu một bước ghi hai file khác nhau (ví dụ spec và sơ đồ), file ghi trước bị coi là superseded, nên câu hỏi hoặc approve trên file đó trả 409. Nếu hai file được ghi trong cùng Tx thì cả hai đều superseded.
  - **Tác động:** đóng an toàn, gỡ được bằng cách ghi lại, không phải lỗ bảo mật.
  - **Sửa:** so "mới nhất" theo cùng `data.locator` của artifact đã ghim, hoặc xin PM ruling rằng mỗi gate bước có đúng một artifact.
- **N2 — Hiệu năng của `assertRunCurrent` (và `readRun`).** Join `events` theo `ticket_id`/`type`, nhưng `events` chỉ có index `(project_id,cursor)` và `(audience_machine_id,cursor)`. Mọi lần hỏi hoặc trả lời đều có thể seq-scan cả journal, vốn tăng không giới hạn. **Sửa:** thêm điều kiện `e.project_id=…` để dùng được index hiện có (không cần migration), hoặc ghi nợ index `(ticket_id,type)` cho lát schema.
- **N3 — Run không có `ticket.created` lọt khỏi kiểm tra supersede.** Nếu run hiện tại không có cursor (row import hoặc restore thiếu event), CTE không có row `own`, nên run luôn được coi là hiện hành (fail-open). Ngược lại, một run mới hơn thiếu event cũng không thay thế được run cũ. **Sửa:** nếu run hiện tại không có cursor thì từ chối với 409 `WORKFLOW_RUN_SUPERSEDED` hoặc 409 riêng.
- **N4 — So path chưa tính hoa thường, Unicode và percent-encoding.** `gates.ts` `ownershipPath`/`nested`. `Src/A.ts` với `src/a.ts` (APFS mặc định không phân biệt hoa thường), NFC với NFD, và `src/%61.ts` với `src/a.ts` (`validPath` có decode để kiểm nhưng so sánh vẫn dùng chuỗi thô) đều không bị coi là xung đột. **Sửa:** chỉ khi so xung đột, dùng `decodeURIComponent(path).normalize('NFC').toLowerCase()`; vẫn lưu key gốc.
- **N5 — `ownership_keys` lưu chưa chuẩn hóa.** `runs.ts` `units()` trả `ownershipKeys` thô vào step. Consumer T7 so với tập file thực tế phải dùng chung hàm chuẩn hóa. Nên export hàm này cùng `parallelUnits` hoặc ghi vào checklist T7.

## Assessment

**Task quality:** Approved with minor follow-ups. I1, W7, M1, M3, M4, M5 ADDRESSED; M2 PARTIALLY ADDRESSED. Không tìm thấy breakage bảo mật mới. Nên làm N4 vì rẻ và trúng target macOS. N1–N3 và N5 có thể chuyển sang ledger hoặc làm trong lát kế.
