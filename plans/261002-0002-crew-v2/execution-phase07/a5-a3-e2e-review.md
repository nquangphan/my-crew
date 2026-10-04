## Review a5-a3-e2e (62fd150), chưa chạy lại test

### Spec Compliance
- ✅ Tạo yêu cầu + bình luận chỉ văn bản: một entity, một receipt, một event, đếm bằng truy vấn PG thật (`compose.spec.ts:340-377`, helper `:42-83`), không chỉ UI.
- ✅ Mất response sau commit: `route.fetch()` chờ producer trả lời (đã commit) rồi mới `route.abort` (`:105-115`); assert `served[0]===201` và đếm DB = 1 TRƯỚC khi hết phiên (`:403-408`, `:474-477`).
- ✅ Hết phiên qua cập nhật `sessions.expires_at` trên DB fixture, cùng cách với `auth.spec.ts:53` (A2); không tạo authority giả. Replay cùng key/body, CSRF mới, DB vẫn 1 ticket/1 comment/1 receipt/1 event.
- ✅ Discard khi ambiguous: cảnh báo trùng, Giữ lại, Vẫn bỏ; ticket vẫn 1, key còn giữ trong pending (`:529-552`).
- ✅ File → 503: không ticket, không receipt, không link, cùng key/body (`:580-592`). Không mock network ngoài việc drop response; host chỉ mount component.
- ⚠️ "Không retry mù" không được assert: test 5 chấp nhận `attempts.length >= 1`, nên 3x retry đã biết lọt qua. Không mâu thuẫn với product bug nhưng tên/ý định test không được chứng minh; 503 + mã `EXTRACTION_NOT_CONFIGURED` cũng không được assert ở mức HTTP, chỉ qua text UI.
- ⚠️ Các phần bị chặn (file thành công, G3, A3 đầy đủ) đã được ghi rõ trong report, không bị làm giả. Báo cáo cũng nêu thẳng việc chạy một lượt khi không giữ heavy slot.
- ⚠️ Chưa verify độc lập: "5/5 hai lượt", hash log (theo yêu cầu không chạy lại).

### Strengths
- Mọi kết luận "đúng một entity" đều đếm DB (tickets, comments, events, idempotency receipt); drop-after-commit đã được chứng minh bằng DB trước khi replay.
- Replay assert key không đổi, body không đổi, CSRF khác, pending store rỗng sau cùng.
- Chờ bằng điều kiện `expect` có timeout, không sleep để đồng bộ nghiệp vụ.

### Issues
**Critical:** không có.

**Important**
- `compose.spec.ts:580-585`: test 5 chỉ có `>=1` POST. Why: không khóa hành vi "không retry mù"; sửa product thành 1 POST hay giữ 3 POST đều xanh. Fix: assert tường minh hành vi hiện tại có comment gắn follow-up Task2 (ví dụ `toBeLessThanOrEqual(4)` kèm TODO) hoặc `test.fail`/annotation cho đến khi Task2 sửa; thêm assert response 503 + `code` qua `page.on('response')`.

**Minor**
- `:142` `waitForTimeout(1500)` trong `warmUp`: sleep cố định cho Vite re-optimize. Fix: chờ điều kiện (import thành công hai lần liên tiếp hoặc `waitForResponse` deps) thay vì sleep.
- `:152-159` host dò URL `.vite/deps` từ nguồn `main.tsx`: phụ thuộc nội bộ Vite dev, giòn khi đổi bundler/dep. Fix: dùng entry test do fixture cung cấp, nhưng thuộc harness Task1, chỉ ghi nhận.
- `:353`, `:590` đếm `attachment_uploads` theo toàn owner, không theo ticket: ổn nhờ serial nhưng sẽ vỡ nếu thêm scenario có link thành công trong cùng worker.
- `:66-83` đếm theo title/text toàn DB: ổn nhờ title duy nhất, nên ghi chú ràng buộc đó.
- `:297` `evidence` ghi stdout, không phải assert; chỉ là log.

### Assessment
**Task quality:** Approved (kèm Important xử lý khi Task2 sửa retry 503 hoặc trước khi đóng A5)
