## Re-review P-G1a fix1 (fa8ccbc..78bf6c3)

**Verdict: ADDRESSED (Approved)**

- Important 1 (latest lộ cho machine): ADDRESSED. `requireOwner(request,{csrf:false})`; auth thật (auth/routes.ts:43) trả 403 OWNER_REQUIRED cho bearer machine, không phiên 401. GET nên không cần CSRF.
- Important 2 (test machine/401): ADDRESSED. Test mới kiểm machine 403 + code, anonymous 401, owner 200 `{"cursor":"41"}`; stub requireOwner mô phỏng đúng hành vi thật. Assert `!body.includes('41')` yếu nhưng body lỗi cố định nên đủ.
- Minor history `::uuid`: ADDRESSED. `c.id::text = lower(e.data->>'commentId')` đúng: uuid::text luôn lowercase, lower() xử lý contract regex /i cho phép chữ hoa; NULL (event khác type) -> không khớp; không còn cast có thể ném lỗi.
- Index: `c.id::text` không dùng được PK(id) nhưng join vẫn có `c.ticket_id = e.ticket_id` (= tham số ticketId) nên dùng `comments_ticket_id(ticket_id,id)`/`decisions_ticket_id`; quét giới hạn theo comment của một ticket, chấp nhận được.
- Minor docs cursor: ADDRESSED (cả hai flow ghi ba kiểu cursor và latest owner-only).
- Body lỗi không chứa cursor: ĐÚNG. Error handler (app.ts:116-124) trả message cố định cho ApiError và INVALID_INPUT cho validation schema; CURSOR_INVALID không echo giá trị.
- Breakage mới: không. Lưu ý (không chặn): web consumer cần phiên owner cho latest; hai Minor (actor id, collate "C") để PM ledger như fix report.
