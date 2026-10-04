# Task05/2a — Producer candidate, pending schema ruling

**NOT READY.** Actual PostgreSQL prefix9 chặn comment chỉ có attachment: frozen004 comments_text_check line57 yêu cầu length(text) BETWEEN1 AND32768, SQLSTATE23514 ở INSERT trước callback.009 không relax constraint. Không chèn dummy space, không dùng client allowEmpty/count, không sửa schema/frozen001–009. PM đã nhận exact finding và yêu cầu ruling ownership/migration trước edit.

Producer candidate đã thêm CommentAttachmentInput, CommentAttachmentLinker, AppendAttachmentComment và optional TicketServiceDependencies.commentAttachments. Factory chụp callback vào immutable dependency object lúc tạo; method mới mặc định503 ATTACHMENT_LINKER_NOT_CONFIGURED trước INSERT, kiểm text<=32768 và text.trim hoặc requested IDs nonempty. INSERT→trusted linker→một existing comment.created trong caller Tx. Legacy appendComment và CreateTicket không đổi. Trigger009 vẫn writer input revision duy nhất. Consumer chưa triển khai/chưa được mở gate.

Owned paths/bytes/SHA trong task-2a-inventory-pending.json. R3 server-tickets ghi cả producer contract và unresolved actual constraint. Chỉ tickets/contracts, decisions, service, new attachments-comment-factory.test.ts và server-tickets flow sửa. Test-owned actual-ready callback đọc ready/durable rows, kiểm original thật qua store.verify và tạo links trong Tx; không giả count và không là implementation selection/submission/retention Task2b.

| Evidence | Kết quả |
|---|---|
| logs/task-2a-red.log |exit1,9total1legacyPASS8FAIL missing producer method, không import/config failure|
| logs/task-2a-green.log |exit1,9total5PASS4FAIL actual comments_text_check23514. PASS default deny+absence freeze, legacy whitespace/empty, mixed/whitespace with actual original, invalid text/max guard, exact32768. FAIL attachment-only fanout, fake/missing/reserved, callback rollback và callback replacement vì empty INSERT bị schema chặn trước callback|
| logs/task-2a-typecheck-first.log |exit0 trên frozen source|

Chưa claim callback atomicity/attachment-only acceptance đã PASS. Chưa chạy broader final regression khi prerequisite schema chưa được chốt. Source-only strict types không thay actual DB proof.

Readonly snapshot task-2a-red/green-source-manifest.json: git archive f58:v2 + exact ec02ac0 ba FIX1 files, own test trước RED/own producer overlay trước GREEN.231 files pinned; không current peer model/gateway source hoặc unfinished tests, không dependency copies/symlinks/install/settings/hook edits. Snapshot root nonce/dev/ino/UID được giữ để tiếp tục theo ruling, không tạo managed worktree/Git mutation.

Resource receipts trong task-2a-resource-pending.json: trước stage work log exact private PG ID/randomloopback port/logical DB/PID/command; root nonce và dev/ino/UID. RED/GREEN hai exact container ID inspect exit1 no such object,18 roots created/removed và host absent. Snapshot chưa xóa vì pending ruling, identity giữ nguyên. Không shared/prod DB, service/ownersecret/paid model/Keychain/globalHOME mutations.

Next: PM quyết định narrow schema producer extension và review/checksum/migration policy; worker chỉ tiếp tục phạm vi được giao. Sau actual empty-path prerequisite chạy meaningful TDD và một explicit tickets/dependencies/completion/repair/input-revision regression sau last production change, types/Biome/source freeze/owned cleanup. Consumer MUST wait independent producer review.
