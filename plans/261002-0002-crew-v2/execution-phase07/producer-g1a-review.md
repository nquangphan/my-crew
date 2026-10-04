## Review P-G1a (fa8ccbc)

### Spec Compliance
- ✅ GET /v2/tickets?level=request|step|task: enum validate (400), cùng ACL machine_id, order t.id keyset giống quy ước cũ.
- ✅ History: journal-only, keyset theo cursor BigInt (string, parseCursor + regex 19 chữ số -> 400), lọc audience (owner thấy hết, machine: audience null hoặc chính nó), requireTicket cho ACL project. comment/decision chỉ lộ id + actor (event data contract chỉ có commentId / decisionId+kind).
- ✅ docs-links GET: default 20, max 100, keyset (snapshot_id, path collate "C"), cursor opaque được validate (400).
- ✅ latest: cursor decimal string, không migration, additive.
- ⚠️ latest không lọc theo audience (xem Important #1).
- ⚠️ Chưa có full-root graph (đúng ruling, P-G1a2).

### Strengths
- Tái dùng requireTicket/parseCursor/readOnly-RR transaction, không thêm helper song song.
- Cursor tie-break ổn định (cursor unique; (snapshot_id,path) là PK suffix).
- Test phủ pagination, ACL machine cross-project, BigInt > 2^53.

### Issues
**Critical:** không.

**Important**
1. v2/server/src/journal/routes.ts:77-86: /v2/events/latest trả bộ đếm journal TOÀN CỤC cho cả machine. Machine suy ra tốc độ event của dự án/machine khác (side-channel nhỏ), và cursor có thể nhảy qua nhiều event machine không thấy. Fix: owner -> giá trị global; machine -> `max(cursor)` trong tập events machine được thấy (cùng predicate với readEvents: audience = id hoặc audience null + project thuộc machine), mặc định '0'. Hoặc ghi rõ owner-only (requireOwner) nếu web là consumer duy nhất, rồi test machine.
2. v2/server/test/ticket-reads.test.ts:265-280: latest chỉ test với owner; không test machine/401, nên claim "không lộ" không được chứng minh.

**Minor**
3. history.ts:38-42: left join ép `(e.data->>'commentId')::uuid` trong ON; planner không bảo đảm chỉ chạy với type tương ứng. Hiện an toàn vì contract validate uuid và chỉ comment.created có key này, nhưng mong manh nếu type khác thêm commentId không-uuid. Fix: `case when e.type='comment.created' then ... end` hoặc join theo text `c.id::text = e.data->>'commentId'`.
4. history.ts:33: actor.id của owner/machine lộ cho machine qua comment/decision author; nhất quán với per-resource read, chỉ lưu ý.
5. history.ts docs query: `order by snapshot_id, path collate "C"` không khớp PK index (collation DB) nên có thể sort; chấp nhận được với <=100 hàng/ticket nhưng chưa có test limit biên.
6. tickets/routes.ts: history `limit` default 50 vs docs-links 20 là đúng spec nhưng nextCursor của list ticket vẫn dạng uuid, history là bigint, docs là base64: 3 kiểu cursor, cần ghi trong docs flow (đã có một phần).

### Assessment
**Task quality:** Needs fixes (Important #1-2: chốt phạm vi audience của /v2/events/latest cho machine và thêm test).
