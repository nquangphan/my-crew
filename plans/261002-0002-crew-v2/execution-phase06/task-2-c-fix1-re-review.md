# Scoped re-review S2 / T2-C — vòng sửa 1

Phạm vi: commit `c54efb5`, gồm `authority.ts`, `orchestration.ts`, port test, `support/assistant.ts` và `flows/server-assistant.md`. Các file khác trong khoảng `3fddbeb..c54efb5` (web, `tickets/history.ts`, `tickets/routes.ts`, `journal/routes.ts`) là commit của worker khác, không thuộc lượt này nên không review. Đối chiếu với `task-2-c-review.md` và mục "Fix round 1" của `task-2-c-report.md`. Đọc thêm ngoài diff: `attachments/routing.ts:120-170`, `attachments/grants.ts:355-372`, `attachments/references.ts:175-182`, `journal/mutation.ts:31-32`. Không chạy lại test.

## Verdict theo finding

| Finding | Verdict | Bằng chứng |
|---|---|---|
| I1 — operation chỉ hợp lệ khi ghi trong cùng Tx, và chỉ dùng một lần | **ADDRESSED** | `orchestration.ts`: truy vấn operation thêm `xmin=pg_current_xact_id()::xid ... for update`; row đã commit từ Tx trước rơi vào cùng nhánh 404 `ASSISTANT_OPERATION_NOT_FOUND`. `consumed: WeakMap<Tx,Set<operation_id>>` tiêu operation sau khi kiểm turn/state/snapshot và trước membership; lần dùng thứ hai trả 409 `ASSISTANT_OPERATION_CONSUMED`. Assertion cũ "still authorizes" đã đổi thành 404. Có test mới `S2 one operation authorizes exactly one mutation in its Tx`. RED fail đúng 2 test này (semantic). |
| I2 — grant phải khóa trước session; revoke/hết hạn/sai máy/sai snapshot/sai designation thì 403 | **ADDRESSED** | `authority.ts`: đọc `grant_id` không khóa (theo `read_session_id` + `admission_id`), rồi grant FOR SHARE, rồi session FOR SHARE. Sau đó kiểm lại `session.grant_id = grant.id`, `revoked_at is null`, `expires_at>clock_timestamp()` (cùng statement đo hạn sau khóa), `machine_id`, `snapshot_id = session.snapshot_id`, `designation_id`/`designation_revision` = fence. Mọi lệch trả 403 `ASSISTANT_ADMISSION_DENIED`. Test: grant bị thu hồi bằng đúng SQL re-route trong khi session vẫn `reserved`, grant hết hạn, grant cấp cho máy khác (cả 3 đều RED trước khi sửa). |
| M1 — các nhánh deny thiếu test | **ADDRESSED** | Thêm 5 biến thể: capability hết hạn, receipt sai máy, session sai máy, session sai snapshot, `read_session_id` trỏ session khác. Cả 5 PASS ngay ở RED, đúng kỳ vọng vì code đã có các nhánh này. Ba biến thể giả lập dữ liệu import dùng `replica` trong Tx tamper riêng (cùng lý do W1). |
| M2 — đọc message dưới FOR SHARE | **ADDRESSED** | `verifyNewRoot`: `... order by d.id for share of m`. Khi không có decision nào thì không khóa được gì, nhưng nhánh đó ném 403 ngay nên vô hại. |
| M3 — tra session thẳng | **ADDRESSED** | `where id=${turn.read_session_id} and admission_id=${turn.admission_id}`. |

## Lens bảo mật

**Thứ tự khóa grant → session so với re-route (`attachments/routing.ts:120-153`).** Không có deadlock:
- Các writer khác đều đi theo thứ tự grant → session, giống resolver: `revokeAssistantGrant` (`grants.ts:363-365`: UPDATE grant rồi UPDATE session) và `references.ts:178-181` (cùng thứ tự).
- Re-route đi theo thứ tự ngược: session `FOR UPDATE of s` (chỉ session `running/unknown`) rồi UPDATE grant. Nhưng nếu tìm thấy session nào, nó ném `ROUTE_IN_USE` *trước* khi UPDATE grant. Vì vậy không bao giờ có trạng thái vừa giữ khóa session vừa chờ grant, và vòng chờ với resolver (giữ grant SHARE, chờ session SHARE) không khép được. Khi session còn `reserved`, re-route không khóa session nào và chỉ chờ grant: trường hợp này chỉ chờ một chiều.
- Cả re-route lẫn port, khi chạy trong `mutate()`, đều khóa `event_cursor` FOR UPDATE trước tiên (`journal/mutation.ts:32`), nên thực tế chúng chạy tuần tự hoàn toàn. Precondition W4 đã được ghi vào flow doc.
- Việc đọc `grant_id` không khóa trước khi khóa grant là an toàn, vì sau khi khóa session code kiểm lại `session.grant_id = grant.id`.

**"Consumed" có rò sang Tx khác không.** Không. Set gắn với key là object Tx (WeakMap), và bản thân `xmin` đã loại mọi row không do Tx hiện tại ghi. Vì vậy Tx khác không thể dùng operation này, dù nó đã bị tiêu hay chưa. Tiêu xong mà mutation lỗi (ví dụ trong savepoint rồi retry) thì lần sau trả 409, tức là fail closed.

**404/409 có giúp dò tồn tại không.** Không đáng kể. Cả ba mã đều chỉ xuất hiện sau khi resolver đã xác thực turn/fence/admission. Operation của turn khác, của Tx khác, hoặc không tồn tại đều trả cùng một 404. `ASSISTANT_OPERATION_STALE` chỉ đến sau khi đã khớp turn của chính caller. `ASSISTANT_OPERATION_CONSUMED` chỉ phản ánh trạng thái trong Tx của chính caller.

## Breakage / finding mới

**N1 (Minor) — Tập "consumed" thuộc từng instance authority, không dùng chung toàn module** (`orchestration.ts`, `persistedAuthority`). Nếu cùng một Tx gọi hai instance `createProjectOrchestrationPort(...)` (ví dụ T3 và T4 mỗi bên tự dựng port), cùng một `operationId` sẽ authorize được một mutation ở *mỗi* port. Hôm nay chưa xảy ra vì chưa có assembly. Sửa: chuyển `consumed` lên cấp module (`const consumed = new WeakMap<Tx,Set<string>>()` ngoài factory), hoặc ghi rõ ràng buộc "một port cho mỗi assembly" vào brief T7.

**N2 (⚠️, ràng buộc cho B3) — `xmin` nghĩa là "lần ghi cuối nằm trong Tx này", không phải "insert trong Tx này".** Nếu transport B3 UPDATE hoặc upsert (`on conflict do update`) một row pending đã commit trước đó (ví dụ trên đường replay), row đó mang xmin của Tx hiện tại và lại hợp lệ. Brief B3 phải ghi rõ: đường replay chỉ được đọc kết quả đã lưu, không được ghi lại row pending; row pending mới phải được INSERT trong Tx gọi port. `SELECT ... FOR UPDATE` không đổi xmin, nên verify không tự gây ra vấn đề này.

**N3 (Minor) — Thiếu test cho hai điều kiện grant mới.** Hai nhánh grant `designation_id`/`designation_revision` lệch fence và `grant.snapshot_id ≠ session.snapshot_id` có trong code nhưng chưa có test deny riêng. Nên thêm 2 biến thể vào `admissionDenials`.

Không thấy breakage chức năng. Các entry B1/B2a/B2b-i và generic ACL không đổi trong commit này; app production vẫn 503.

## Assessment

**Task quality:** Approved

I1, I2, M1, M2, M3 đều đã được xử lý. Cả hai finding mới đều là Minor (N1, N3), cộng một ràng buộc cho B3 (N2); không có lỗi nào chặn. Đề nghị PM ghi N1/N2 vào checklist B3/T7.
