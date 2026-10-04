# Re-review Task 5 S5a: vòng sửa 3, B1/B2 (`8c5ce41` → `cccbae1`)

Phạm vi: phần web của `cccbae1` (`controller.ts`, `composer.tsx`, `compose-submit.test.ts`, `compose-server.ts`, `package.json`) và mục 10 của report. Các file server trong khoảng này thuộc task khác nên không xét. Không chạy lại test.

## Verdict

- **B1: ADDRESSED** (trong phạm vi phương án tạm PM đã chấp nhận).
  - `#expired()` trả false khi draft đang `sending`, hoặc khi khóa submit đang `pending` trong `PendingStore` (đang được gửi từ panel).
  - Hết hạn chỉ được tính khi `expiresAt + 5 phút <= giờ client`.
  - Có hai test, đều RED trước khi sửa:
    - client nhanh 3 phút, server còn hạn 1 phút: compose và khóa được giữ;
    - đang gửi mà GET báo hết hạn: không nhả khóa, vẫn chỉ một comment.
  - Rủi ro còn lại đã ghi nhận: client lệch nhanh hơn 5 phút vẫn kết luận sai. Việc trả header `Date` đã vào follow-up Task2.
  - Nhánh “khóa đang `pending` do panel gửi” chưa có test riêng (Minor, không chặn).
- **B2: ADDRESSED.**
  - `#discarding` bật ngay đầu `discard()`. Trong lúc đó `submittable=false`, `submit()` trả null, `discardable=false`. `startNew` tắt cờ.
  - DELETE chưa xác nhận: giữ draft, báo `DISCARD_UNCONFIRMED` (kèm message nếu là 5xx), khóa DELETE vẫn hiện trong panel. Bấm bỏ lần nữa gửi lại đúng khóa đó.
  - Từ chối đã được chứng minh thì tiếp tục bỏ.
  - Test “đang bỏ thì không có POST” và “DELETE lỗi transport rồi bỏ lại cùng key, compose `abandoned`” đều assert trên dây.
  - Thứ tự microtask đã kiểm: phần tiếp của `discard` chạy trước một `#refresh` xếp hàng sau abandon, nên `startNew` xong trước và refresh thấy `sessionId=null` rồi return. Không bị detach nhầm.
- **Peer `@testing-library/dom` 10.4.2:** đã khai báo trong devDependencies (B3 phần peer).

## Breakage mới

- **C1 — Minor — `controller.ts` `#refresh`/`#reserve`/`#upload`: trong biên 5 phút sau khi hết hạn, file không được chuyển sang compose mới dù server đã chứng minh compose đóng.**
  - `#reserve` nhận 409 `ATTACHMENT_COMPOSE_CLOSED`, refresh, `#expired()` vẫn false, `sessionId` không đổi, lỗi được ném ra, file thành `failed`.
  - PUT nhận `ATTACHMENT_UPLOAD_EXPIRED` (thuộc `definitiveUpload`), file thành `failed`.
  - Submit nhận `SELECTION_CHANGED`, refresh, owner gửi lại, lại nhận `SELECTION_CHANGED`.
  - Tối đa 5 phút không tiến triển và thông báo gây hiểu nhầm. Sau đó composer tự lành.
  - Fix: tách hai việc.
    - Chuyển file sang compose mới không cần biên giờ khi server đã trả mã chứng minh compose đóng hoặc hết hạn (`ATTACHMENT_COMPOSE_CLOSED`, `ATTACHMENT_UPLOAD_EXPIRED`), vì việc chuyển file là an toàn.
    - Chỉ nhả khóa submit mới cần biên giờ, hoặc chờ giờ server.
- **C2 — Minor — `discard()` cùng `#send`: khóa DELETE abandon thành tombstone sau đăng xuất thì không bỏ được nữa.**
  - Sau `DISCARD_UNCONFIRMED`, nếu owner đăng xuất, `tombstoneAll` biến khóa abandon thành tombstone.
  - Lần `discard` sau: `begin` ném `IntentUnresolvedError`, `get` trả undefined, `#send` ném `INTENT_UNRESOLVED`, `#unresolved` vẫn thấy tombstone, nên lại báo `DISCARD_UNCONFIRMED`. Lặp vô hạn.
  - Composer không bao giờ `resume` tombstone này, còn `#refresh` chỉ giải quyết intent reserve/remove, không giải quyết intent abandon.
  - Fix: resume tombstone abandon bằng body tất định `{expectedRevision: tombstone.expectedRevision}`, hoặc để GET compose giải quyết nó (compose không còn `open` thì `reject`, rồi bỏ tiếp).
- **C3 — Minor (lộ ra từ nhánh có sẵn) — `#abandonSession` trong `discard()`:**
  - Hai lần 409 stale liên tiếp làm vòng lặp thoát mà không ném lỗi. Hoặc 409 rồi `#readCompose` lỗi transport: khóa DELETE đã bị reject nên `#unresolved` false. Cả hai trường hợp đều bị coi là “từ chối đã chứng minh”, nên draft bị bỏ và khóa của session bị nhả trong khi compose có thể vẫn `open` (chiếm quota tới hết TTL; không tạo bản trùng).
  - `#discarding` không có timeout: nếu DELETE treo, nút gửi và nút bỏ đều bị khóa vô thời hạn.
  - Fix: chỉ `startNew` sau khi đọc được compose ở trạng thái khác `open`; nếu không thì báo `DISCARD_UNCONFIRMED`. Cân nhắc cho phép hủy hoặc đặt timeout cho discard.

## Assessment

B1 và B2 đã được sửa đúng cause, có RED trước khi sửa và test assert trên dây. Peer dependency đã được khai báo. Ba breakage mới đều Minor, nằm ở cửa sổ hẹp hoặc nhánh phục hồi hiếm (trong biên hết hạn, đăng xuất giữa lúc discard, DELETE stale/treo). Không có Important mới.

**Task quality:** Approved (C1–C3 Minor, đưa vào ledger)
