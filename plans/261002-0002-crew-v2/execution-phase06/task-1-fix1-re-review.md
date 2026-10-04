T1-S1 — **ADDRESSED** đối với lỗi cross-target ban đầu; FIX1 còn lỗi expiry mới T1-F1-N1 bên dưới.

T1-S2 — **ADDRESSED**.

T1-S3 — **ADDRESSED**.

T1-S4 — **ADDRESSED**.

T1-S5 — **ADDRESSED**.

SPEC: **NOT READY**. QUALITY: **NOT READY**. FIX1 còn **1 Important/P2 mới: T1-F1-N1**.

## Finding verdicts

- **T1-S1:** `v2/server/src/assistant/inbox.ts:144–160` kiểm work message exact message/conversation của turn; ticket work cần scope cùng turn, root/project và actual unrevoked route nếu là message turn. `:166`, `:185` gọi guard trước cả claim/ACK replay. `v2/server/migrations/011_assistant.sql:376–405` kiểm scope INSERT cùng turn/message/conversation hoặc root route. Không bổ sung root lock sau authority trên message path; ticket vẫn gọi lockWorkRoot trước assertCurrentTurnFence. Tests mới `v2/server/test/assistant-store.test.ts:979` kiểm message khác, forged claimed replay, no-route root scope, routed descendant positive và root ngoài scope; `:1071` kiểm monitor turn cần explicit root scope. Lỗi gắn work/scope của B vào turn A đã được chặn.
- **T1-S2:** `v2/server/migrations/011_assistant.sql:505–519` thêm deferred constraint đối chiếu selection với exact policy/capability key, designation machine và turn.model_selection_id. Immutable identity cũ ngăn thay các field sau INSERT. Deferred timing cho phép vòng turn/selection cùng transaction. Tests `assistant-store.test.ts:1049` kiểm modelId khác, receipt machine khác designation và positive UNVERIFIED. Không biến relational match thành certificate PASS.
- **T1-S3:** `v2/server/migrations/011_assistant.sql:521–547` bind assessment snapshot đúng ticket; dispatch command/step/assessment/decision cùng ticket, workflow run cùng root. Tests `assistant-store.test.ts:1103` kiểm wrong snapshot target và đổi riêng assessment/step/decision. Same-target fixture cũ vẫn thành công trong final cover. Không sửa005 hoặc thêm approval/driver semantics.
- **T1-S4:** `v2/server/migrations/011_assistant.sql:549–571` bind exact request ticket/kind/boot/ownership với receipt; reservation bind command machine/ticket và receipt ownership. Equality JSONB array giữ thứ tự như PM ruling. Tests `assistant-store.test.ts:1148` thay riêng ticket/kind/boot/ownership, wrong reservation ownership và command ticket, rồi positive cùng scope. Immutable triggers cũ giữ identity sau INSERT; deferred check không mở đường update identity.
- **T1-S5:** `v2/server/migrations/011_assistant.sql:446–477` kiểm INSERT lẫn UPDATE released bằng constraint deferred. TG_OP guard tránh dùng OLD như UPDATE trong INSERT; released→nonreleased vẫn bị reject. Trigger đọc attempt/retirement/launch hiện hành ở thời điểm deferred check; event NEW yêu cầu proof khi row đi vào released. Các chuỗi INSERT reserved→released vẫn có event UPDATE kiểm proof; INSERT released cũng luôn kiểm proof. Tests `assistant-store.test.ts:1187` reject terminal INSERT thiếu proof, nhận terminal INSERT có exact never-authorized proof và backup/restore row thật; final cover cũng giữ các test UPDATE release trước đây. Không thấy regression về terminal-state guard hoặc restore trong diff này.

## New breakage trong FIX1

### T1-F1-N1 — Important/P2 — Scope hết hạn trong lúc chờ khóa vẫn được claim/ACK

**Bằng chứng:** `v2/server/src/assistant/inbox.ts:155` dùng `s.expires_at > now()` trong helper mới; caller tại `:164–166` và `:183–185` đã đi qua root/current-authority locks trước helper. Đây là dòng mới thuộc FIX1, không phải mở lại review ngoài phạm vi.

PostgreSQL `now()` là thời điểm bắt đầu transaction, không phải thời điểm thực thi câu SELECT sau khi chờ khóa. Transaction B bắt đầu khi scope còn hạn, đọc work rồi chờ event_cursor/root hoặc authority lock do transaction A giữ; sau khi thời gian thực vượt `expires_at`, A nhả khóa. B tiếp tục qua `assertWorkScope`, nhưng biểu thức vẫn so với thời điểm cũ nên scope hết hạn được chấp nhận. Cả fresh claim lẫn ACK/replay có cùng lỗ hổng; ACK có thể biến work thành terminal sau khi scope đã mất hiệu lực.

**Sửa có mục tiêu:** so expiry với server wall clock tại lần kiểm scope sau các khóa, chẳng hạn `clock_timestamp()`. Giữ nguyên identity predicates, thứ tự khóa và kiểm trước replay; không đổi producer hay TTL policy.

**Focused regression cần bổ sung, chưa chạy:** tạo scope TTL ngắn, transaction A giữ một khóa mà ticket claim/ACK phải đợi; transaction B thực sự bắt đầu và chờ khóa trước expiry. Sau khi server clock đã vượt expiry, nhả A rồi assert B trả `ASSISTANT_WORK_SCOPE_MISMATCH`, giữ nguyên pending/claimed/acked state và attempts. Có thể dùng long transaction với kiểm mốc DB rõ ràng thay cho lock barrier để chứng minh `now()` cũ, nhưng phải kiểm ít nhất claim và ACK/replay qua helper. Existing test `assistant-store.test.ts:1089–1096` chỉ tạo scope đã hết hạn trước transaction (`-60`) hoặc còn một giờ (`3600`), nên 35/35 PASS chưa trả lời trường hợp này.

## Checks và evidence

- Re-review chỉ S1–S5 và fix diff, theo `subagent-driven-development/re-review-prompt.md` cùng receiving/requesting-code-review. Brief và full review đã đọc trong lượt review gốc; áp dụng PM rulings mới về monitor/root scope, ownership array order và deferred release. Không đọc lại whole branch, không chạy Git/test/PG/container/native/browser/model, không spawn agent. Chỉ tạo report này; giữ source/index và peer files nguyên trạng.
- Fix base `77ac18b`; package là diff của các owned paths hiện hành, không tự coi là một HEAD commit mới. Đọc đầy đủ package37791B, SHA256 `7276fdeb91e35555d262645f99e077c9b0cf27e75d1dffc7d31e2289d25ea65b`.
- Report17050B SHA256 `7eb7d43571fad97724895be7ff5086cbb64727b070c0f282c2fa5f97c7d57001`; freeze8345B SHA256 `07ee4abe62b2394814f4fd8f8bc6c38587c46e3b925ae0f23601eb8cac7c7051`. Source SQL011 trong freeze: `fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841`; inbox `c6706c71261eaba23a8b3987523ded7b5af4bdc50b88042c1014fc0bf04b498f`. Contracts/store không đổi. Root đã kiểm actual7paths và001–010 với accepted baseline theo dispatch; không chạy lại việc đó.
- Actual final covering log `task-1-evidence/logs/task-1-fix1-complete-cover-2.log`: SHA256 `ad2bc6747344529cc8f6ca406879fee11f805c772524d7d4741e9e012afdc7ce`, một lượt35/35 PASS, 0FAIL, 0skipped; sáu test FIX1 đều có PASS. Types SHA `c9fa85e4aa6397b7fb2b2f6a8e3bd0cc9efdc93485f211cfc5ad154acc411465`, Biome SHA `46bfe88c959dd8272ecffcca47a153403ab304b5ef546d96476b1cf321516364` khớp freeze. Scan toàn log không có warning/error; không cộng dồn historical/focused runs thành final PASS.
- Final restore receipts giữ prefix010 trước upgrade, prefix011 inbox/data và prefix011 terminal released có proof. Terminal source/restored data SHA cùng `97eb9be60f22d1d41188a89023c367e8cece429cd024f059c1cf1d6011ef519f`; test mới gọi actual verifyBackupRestore. Root đã xác minh child/container closure và scratch cleanup theo dispatch; reviewer không tạo resource để lặp lại.
- Mức kiểm chứng: static proof cho các guard mới cộng raw evidence của implementer. Chưa chạy reproduction T1-F1-N1 vì dispatch cấm rerun DB; test được đề nghị có mục tiêu, không yêu cầu mở rộng suite hoặc scope.

## Out-of-scope observations

- Không có observation mới ngoài fix diff. Các gate T2–T7 và giới hạn R3 bridge đã ghi ở full review vẫn giữ nguyên, không dùng để kéo dài FIX1.

## Verdict

**Fix round: Findings remain open — T1-F1-N1 (P2).** Năm lỗi ban đầu đã được xử lý về identity/state; lỗi expiry mới trong helper S1 phải sửa trước READY. Không yêu cầu làm lại S2–S5 hoặc mở lại toàn bộ review.

**Câu hỏi chưa giải quyết:** không có; next action là sửa wall-clock predicate và xác minh focused expiry regression.
