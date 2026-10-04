SPEC: **NOT READY** — 5 phát hiện Important/P2 về ràng buộc identity và trạng thái bền vững.

QUALITY: **NOT READY / Needs fixes** — T1-S1 đến T1-S5 cần sửa trước khi chốt checksum011 hoặc cho consumer dùng candidate.

## Phạm vi và identity đã kiểm

- Review độc lập, đọc tĩnh, ngày 2026-10-03, Asia/Ho_Chi_Minh. CWD `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`.
- Đọc đầy đủ brief `execution-phase06/task-1-schema-brief.md`, report implementer, source-freeze và package duy nhất `task-1-review-package.diff`; package ghi BASE `98e0c17`, HEAD `77ac18b`, 10 file, 3.681 dòng thêm. Không review toàn branch, không chạy Git, không sửa source/index/tests/DB.
- Package: 190232 bytes, SHA256 `c66b99ea8f45e7272ffd71d17e9b9b6797df693fcef11b2aca8b0539164c0a3d`; report: 10439 bytes, SHA256 `db770c49a192f16910b86255dd77ec70551a4e7264f1a845492e16715aa680b8`; source-freeze: 6470 bytes, SHA256 `3e79fed2ff5cbe42a9bead2bde39d82f14fc669e400dc4fdbcf7cd36afdc3d9b`.
- SQL011 được review là checksum `9dc10ce01e2e2db4e83185f6ca0bd0b0e897ac5daebb2949c446d0480fb649c0`. Migrations001–010 không có hunk thay đổi trong package; controller đã đối chiếu bytes với accepted baseline `0c838d21354bb40494a1280200ae281b2ff19e33` theo dispatch. Reviewer không chạy lại đối chiếu Git đó.
- Đọc root `docs/index.md` trước code, rồi `v2/docs/index.md` và flows server-assistant/server-journal/server-attachments/server-execution. Không có `.codegraph/` tại root checkout. Các phần output bị truncate được đọc lại theo đoạn; không coi đoạn bị khuất là evidence bị thiếu. Changed source được đọc qua diff; các trích dòng sau dùng chính package, không đọc lại file source thay đổi.
- Dùng mẫu `subagent-driven-development/task-reviewer-prompt.md` và `requesting-code-review`; không spawn agent con, không chạy suite, container, PG, HTTP hoặc model.

## Strengths có bằng chứng

- Inbox và cursor commit/rollback cùng transaction; không cấp inference khi enqueue/reconcile. Ingestion khóa journal trước monitor, phân trang 200; revision dedup giữ logical key/cursor ban đầu, lifecycle giữ wake riêng: `v2/server/src/assistant/inbox.ts:31`, `:99`, `:119`; partial unique `v2/server/migrations/011_assistant.sql:112`.
- Claim/ACK kiểm designation, process, generation, machine revoke và state hiện hành; uncertain không được ACK. Replay claim không tăng attempts, ACK terminal không bị rewrite: `v2/server/src/assistant/store.ts:42`, `v2/server/src/assistant/inbox.ts:144`, `:162`.
- Generation dùng shared calibration lock và UPDATE RETURNING trong caller transaction, có overflow guard: `v2/server/src/assistant/store.ts:31`. Không coi allocation là admission.
- Immutability/latches, single live turn, budget uncertain, effect hex64 và operation identity được lưu rõ: `v2/server/migrations/011_assistant.sql:65`, `:201`, `:260`, `:328`, `:419`. R2 tool terminal result không bị thay body sau completed/rejected: SQL `:412`.
- DTO import actual producers; object schemas đóng field dư, discriminator lồng nhau và int64 decimal có giới hạn thật: `v2/server/src/assistant/contracts.ts:1`, `:500`, `:971`. Test dùng public Ajv compiler và các negative nested, không dựng fake HTTP authority: `v2/server/test/support/assistant.ts:16`, `v2/server/test/assistant-store.test.ts:17`, `:37`.
- R3 giữ exact original element, target parent/derived và giới hạn allowOriginal/expiry tương đối; R4 hook atomically bind matching attempt với reservation: `v2/server/migrations/011_assistant.sql:311`, `:467`. Các fixture UNVERIFIED không được mô tả thành certification production.

## Important — cần sửa

### T1-S1 — P2 — Work/scope chưa gắn với target của turn

**Bằng chứng:** `v2/server/src/assistant/inbox.ts:144–158`, `:162–175`; `v2/server/src/assistant/store.ts:59–77`; `v2/server/migrations/011_assistant.sql:91–100`, `:376–394`.

`assertCurrentTurnFence` không lấy conversation/message của turn. `claimWork` chỉ kiểm fence hiện hành rồi gắn bất kỳ work pending vào turn đó; ACK sau đó chỉ so lại turn/generation đã gắn. Vì vậy turn đã lưu cho message A có thể claim rồi ACK work của message B thuộc conversation khác. Scope trigger chỉ kiểm snapshot ↔ scope target; nó cũng chấp nhận `turn_id=A`, `message_id=B`, snapshot của B. Tất cả UUID/FK đều hợp lệ, nhưng receipt/work history bị gắn vào lượt có input khác. Work B đã ACK sẽ bị revision dedup giữ terminal, không tự được reconcile lại.

**Sửa:** kiểm quan hệ work ↔ target/scope đã persist của chính turn trong cùng transaction, trước cả claim/ACK replay. Message cần cùng message/conversation; ticket cần đúng root/project được scope của turn cho phép. Guard scope INSERT cũng phải đối chiếu với turn, không chỉ snapshot. Giữ lock order đã duyệt; không thêm root lock sau authority cho message path.

**Focused regression đề nghị, chưa chạy:** dùng hai message khác conversation, seed một turn cho A, ingest cả hai; claim/ACK B với fence A phải reject và B giữ pending. Thử INSERT scope turn A + message/snapshot B phải reject. Existing test `assistant-store.test.ts:525` chỉ thử sai fence trên work của đúng message, nên không phát hiện trường hợp này.

### T1-S2 — P2 — Model selection có thể mượn receipt của model/machine khác

**Bằng chứng:** `v2/server/migrations/011_assistant.sql:81–90`, `:349–374`.

FK `(probe_receipt_id,policy_receipt_id)` chứng minh hai receipt liên quan nhau; không chứng minh `assistant_model_selections.model_key` là key của cặp receipt đó hoặc machine trong key là machine designation của turn. Trigger context chỉ chạy trên policy/capability receipt. Một selection mới cho key B với cặp receipt key A vẫn qua mọi FK/check/immutable trigger và trở thành selection bất biến của turn.

**Sửa:** thêm kiểm tra relational context khi ghi selection, bind exact model key với receipt và machine của turn/designation. Kiểm deferred nếu cần để giữ vòng INSERT turn/selection trong một transaction. Không đòi status PASS hay verifier production từ fixture: đây chỉ là kiểm identity giữa các hàng đã có.

**Focused regression đề nghị, chưa chạy:** dựng cặp policy/capability UNVERIFIED hợp lệ của A, INSERT selection cho modelId B hoặc machine B tham chiếu cặp đó; transaction phải reject. Giữ positive cùng key. Test `assistant-store.test.ts:662` mới kiểm mismatch khi INSERT policy receipt và update immutable receipt, chưa kiểm mismatch selection.

### T1-S3 — P2 — Dispatch có thể ghép command với workflow/assessment của ticket khác

**Bằng chứng:** `v2/server/migrations/011_assistant.sql:156–166`, `:311–324`; producer command/attempt tại `v2/server/migrations/005_execution.sql:1`, `:22` và `v2/server/src/execution/attempts.ts:149–202`.

`assistant_dispatches` chỉ có FK riêng tới command, decision, assessment và composite step/run. Không có constraint buộc command.ticket_id = step.ticket_id = assessment.ticket_id hoặc decision cùng ticket. Assessment cũng không buộc snapshot target là ticket của assessment. Chọn command của A cùng step/assessment/decision của B tạo được dispatch hợp lệ về FK. Hook claim011 chỉ cần dispatch tồn tại và launch/reservation khớp command; nó không sửa liên kết sai này. Claim005 tự kiểm command/ticket, nhưng không biết các hàng011 nên không đóng được khoảng trống.

**Sửa:** bind chuỗi durable command → step/run → assessment → snapshot và decision về cùng target phù hợp, bằng composite relation hoặc constraint trigger011. Giữ005 nguyên trạng. Đây là identity của chứng từ, không phải logic chọn model, approval hay driver T4/T5.

**Focused regression đề nghị, chưa chạy:** hai ticket/step A và B; INSERT assessment A với snapshot B phải reject; INSERT dispatch command A cùng step/assessment/decision B phải reject; positive đồng scope commit được. Fixture `support/assistant.ts:506` chỉ seed một chuỗi cùng target.

### T1-S4 — P2 — Capacity receipt/reservation chưa giữ exact request identity

**Bằng chứng:** `v2/server/migrations/011_assistant.sql:168–194`.

FK receipt → request chỉ so `(request_id,machine_id)`. Receipt của request A vẫn có thể lưu ticket B, kind khác, boot generation khác, ownership khác. FK reservation → receipt cũng chỉ so receipt/machine; command của ticket A có thể dùng receipt của ticket B và một ownership set khác. Hash vẫn là hex64 hợp lệ và immutable, nên các guard hash không phát hiện sự ghép scope sai. Những field này quyết định capacity/ownership accounting; dữ liệu bền vững không còn chứng minh receipt thuộc dispatch nào.

**Sửa:** validate exact ticket/kind/boot/ownership giữa request và receipt, và command machine/ticket cùng ownership giữa reservation và receipt. Dùng representation canonical của ownership mà producer quy định. Không chuyển việc chứng nhận telemetry/sample freshness hoặc tính canonical DTO hash từ T4 sang T1; chỉ khóa quan hệ identity đã persist.

**Focused regression đề nghị, chưa chạy:** cùng machine, hai ticket; thay lần lượt ticket/kind/boot/ownership khi INSERT receipt với request_id cũ phải reject; reservation ghép command A + receipt B phải reject. Existing test `assistant-store.test.ts:905` kiểm hash shape/immutability/latch và positive canonical hash, không kiểm cross-scope fields.

### T1-S5 — P2 — INSERT reservation released bỏ qua toàn bộ release proof

**Bằng chứng:** `v2/server/migrations/011_assistant.sql:188–194`, `:435–465`.

State CHECK cho phép `released` khi INSERT nhưng `assistant_reservation_release` chỉ chạy BEFORE UPDATE. Một command chưa có attempt/retirement/stop proof vẫn INSERT được reservation với state released miễn command/receipt/machine tồn tại. Như vậy bất biến R4 “release chỉ khi stopped+finalized hoặc retirement+proof” chỉ đúng cho đường UPDATE, không đúng cho bảng durable.

**Sửa:** chặn trạng thái terminal không có proof cả ở INSERT; có thể bắt row mới bắt đầu reserved hoặc chạy guard thích hợp cho INSERT/UPDATE. Không dùng UUID artifact đơn lẻ làm stop certificate, và giữ khả năng dump/restore hợp lệ.

**Focused regression đề nghị, chưa chạy:** tạo command/receipt không có reservation rồi INSERT state released khi chưa có attempt/retirement, kỳ vọng reject; giữ positive reserved → released qua exact proof. Tests `assistant-store.test.ts:789` và `:826` chỉ exercise UPDATE release.

## Checks, giới hạn và gate tương lai

- Log cuối có đúng một lượt 29/29 PASS, 0 FAIL, 0 skipped; typecheck/Biome thành công. Reviewer đối chiếu SHA của cả ba log với freeze: cover `dcc17c3a3dc5f0be9bd7153fd61fb6f4a457669b8b29b40b0fd84d6d9d7accd4`, types `64701009df5162d8801c5450a1c44cad8d97c7a204d680cd70b2991963a23bfe`, Biome `5fcdeaba39959b0d62f52e621fdd2406a07d36cbbd775c64540e5d3247401b5c`. Không chạy lại suite. Output có diagnostics identity/cleanup chủ động; scan không có warning/error thực, chuỗi `--exit-on-error` là argument pg_restore.
- Backup/restore log và code `assistant-store.test.ts:952` chứng minh prefix010 được restore trước upgrade, prefix011 có dữ liệu được restore và so toàn bộ bảng/migration checksums. Không coi cover này đã bao gồm các negative mới đề nghị ở trên.
- Named-risk ngoài diff đã kiểm: R4/005 claim lock order và columns thật (`execution/attempts.ts:139–206`, `005_execution.sql:1–74`); R3 revocation và session identity (`009_attachments.sql:153–193`, `:231`, `attachments/grants.ts:118–136`, `:346–378`); schema drift của các DTO producer (`tickets/contracts.ts:7–43`, `execution/contracts.ts:5–16`, `gateway/contracts.ts:86–95`, `:151–185`, `models/contracts.ts:55–63`, `attachments/contracts.ts:368–374`). Không phát hiện type-shape drift trong các contract đã kiểm; không dùng peer producer để chứng minh production acceptance.
- ⚠️ R3 live-parent check theo thời gian và revoke cascade còn là gate bridge T2/phase05: SQL011 `:475–480` chỉ chặn revoked và expiry vượt parent, không kiểm expiry còn sống ở thời điểm link; existing revoke service chỉ revoke grants trực tiếp của authorization (`grants.ts:346–353`). Chưa có producer bridge trong T1. Đây được ghi là giới hạn integration cần test khi bridge triển khai, không tính thêm blocker T1.
- ⚠️ Native artifact verification, certification PASS measurement, calibration admission/release, hash producer T4, telemetry sampling, production tool authorization, HTTP/driver assembly và actual executable runs thuộc T2–T7. Không yêu cầu T1 tạo các producer này và không nghiệm thu chúng qua seed SQL. Read-session/admission and owner-authority linkage cũng phải được producer kiểm exact current scope trước dùng; report này không cấp authority từ FK/UUID.
- ⚠️ Không kết luận toàn hệ thống không deadlock hoặc toàn schema không còn lỗi từ lần đọc tĩnh này. Các checks cụ thể trên các hàm inbox hiện có giữ journal/root trước authority ở ticket path, message path không bổ sung root lock. Race/revoke tests cho future callers phải theo gate tương ứng.
- Phân loại: không có Critical/P0; 5 Important/P2 chặn T1; không thêm Minor về format/file size. Các file mới contracts1087/test977/support806 dòng tương ứng toàn DTO/suite/fixture được yêu cầu; không coi độ dài tự nó là lỗi chặn.
- Câu hỏi chưa giải quyết: không có câu hỏi cần owner để sửa T1-S1…T1-S5; consumer T2–T7 vẫn chưa được phép coi checksum011 này là accepted.
