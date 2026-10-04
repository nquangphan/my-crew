# Task 6 S6docs — re-review vòng sửa 1

Phạm vi: `cfc233c` (12 file, chỉ `v2/web/src/docs/*`, test docs, docs flow; không chạm `tickets/*`, router, contracts).
Đối chiếu producer `server/src/docs/{read,links}.ts`, `server/src/tickets/routes.ts:502-530`, `web/src/lib/{api,pending-operation}.ts`.
Không chạy lại test.

## Verdict từng mục

- **I1 — ADDRESSED.** `docsStateKey = ['v2','docs',projectId,'state']` (`queries.ts:387-389`) nằm dưới `queryRoots.docs(projectId)`
  / `allDocs`, nên `docs.synced`, `docs.imported`, `project.bound` (`events.ts:72-82,103-109`) đều invalidate. Không đụng key
  page (5 phần tử, vị trí 4 là UUID) hay tree. Câu sai ở `web-docs.md` đã sửa.
- **I2 — ADDRESSED.** Đối chiếu từng luật với `server/src/docs/links.ts:150-170`: `?` ở bất kỳ đâu, `%2e/%2f/%5c` trong rawPath,
  `/` đầu, `\`, `/` cuối (server `validPath` loại segment rỗng), giải mã lần hai ra traversal (`safeDecodedPath` ≙ `validPath`),
  không fallback `index.md`, page thiếu → blocked. Percent hỏng: server cho về `fromPath`, web chặn — chặt hơn, chấp nhận được.
  Web còn chặt hơn ở ký tự điều khiển và `\` trong fragment; vô hại.
- **I3 — ADDRESSED (component chưa được mount).** `ticket-links.tsx`: PUT `{snapshotId, paths, expectedRevision}` khớp
  `docsLinksBody`; intent cố định `ticket-docs-links:<id>`; `IntentUnresolvedError` → dùng lại operation cũ; chỉ xóa draft khi
  `bodyJson` khớp; 409 → `pending.reject` (non-uncertain) nên lần sau có khóa mới; chặn lưu khi `hasNextPage`, rỗng, >100;
  invalidate `queryKeys.ticket(id)` làm mới cả revision lẫn docs-links. Chưa có chỗ nào render editor (`TicketDetail` chưa
  nhúng) — controller phải làm.
- **Minor urlTransform — ADDRESSED.** Chỉ `a[href]` đi nguyên (component `a` bắt buộc qua `resolveDocLink`); `img[src]` và mọi
  thuộc tính URL khác qua `defaultUrlTransform`. Raw HTML vẫn thành text nên `cite/action/formAction/input src` không thể sinh từ
  markdown. Không còn lỗ cho `img/src` (và `<img>` không bao giờ được dựng).
- **Minor metadata khi lỗi — ADDRESSED.** Commit/audit lấy từ tree cùng snapshot (page.auditState vốn là audit của snapshot),
  contentClass từ row hoặc `mixed`, “Nhận lúc” ghi rõ không có.
- **Minor audit warning — ADDRESSED.** `audit !== 'verified' && docsState !== audit`: stale + invalid hiện cả hai; chỉ khử khi
  trùng đúng trạng thái.
- **404 theo message — ADDRESSED nhưng mong manh** (Minor M1 bên dưới).

## Findings mới

### Important
- Không có.

### Minor
1. `v2/web/src/docs/space.tsx:427-432` — phân biệt 404 bằng `/dự án/i.test(failure.message)` phụ thuộc chuỗi tiếng Việt của
   `read.ts:34/40`. Mong manh: (a) đổi/viết lại message (ví dụ “Không tìm thấy tài liệu của dự án”) lật nhánh; (b) 404 không phải
   JSON (proxy, route chưa mount) có message `HTTP_404` → rơi vào nhánh “chưa có tài liệu” với `role=status` — mặc định sai về
   phía im lặng. Phương án tất định đã có sẵn: `useProjectDocsState` (GET project) — project 404 ⇒ không tìm thấy dự án,
   `docsState === 'missing'` ⇒ chưa có tài liệu, còn lại ⇒ lỗi. Ít nhất đảo mặc định: chỉ coi là “chưa có tài liệu” khi message
   khớp đúng “Không tìm thấy tài liệu”.
2. `v2/web/src/docs/ticket-links.tsx:562-582` + `lib/api.ts:105,278-283` — sau một lần gửi mơ hồ (timeout/5xx), lần thử lại
   nhận 409 `REVISION_CONFLICT` không thuộc `bodyDeterministic` nên operation vẫn `ambiguous`; `stuck` còn đó, nút Lưu gửi lại
   đúng byte với `expectedRevision` cũ → 409 lặp mãi, trong khi thông báo 409 bảo “kiểm tra lại rồi lưu lần nữa”. Lối thoát duy
   nhất là “Bỏ lần gửi treo”. Fix: khi `stuck` tồn tại và lỗi là 409, thông báo chỉ thẳng nút bỏ; thêm test ambiguous → 409.
3. `v2/web/src/docs/ticket-links.tsx:517,541-543` — `draft` không gắn với `snapshotId`. Nếu tree refetch ra snapshot mới (sync/
   import/focus) khi đang sửa, các path đã chọn mà snapshot mới không có vẫn nằm trong `paths` nhưng không còn checkbox nào hiển
   thị, rồi được gửi kèm snapshot mới → 422 khó hiểu. Fix: lưu draft kèm snapshotId, reset hoặc cảnh báo khi snapshot đổi; hoặc
   lọc `paths` theo `tree.data.pages`.
4. `v2/web/src/docs/page.tsx:314` — với TanStack, refetch lỗi giữ `data` cũ nên trang hiện cả nội dung và lỗi; cùng key (cùng
   snapshot+path) nên không sai bytes, chỉ ghi nhận.

### Còn treo từ vòng trước (đã khai, không chặn)
- Test đổi snapshot trong cùng dự án, href thật của router, `new Set(seen)`, NFC/NFD, cuộn fragment, A6docs E2E.

## Assessment

**Task quality:** Approved — I1/I2/I3 và 3 Minor đã xử lý đúng với producer; urlTransform không còn lỗ. Bốn Minor mới không
chặn, nên sửa M1–M3 trước khi controller nhúng editor/route.
