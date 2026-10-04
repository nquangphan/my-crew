# CREWV2-701 / Task 5 S5a — composer chung và tệp đính kèm

BASE `43792f1`, commit `aa98e43` (nhánh `codex/crew-v2-server`), Node v24.21.0, pnpm 10.32.1, Asia/Ho_Chi_Minh. Worker web-s5a; không dispatch subagent/reviewer.

**Trạng thái: S5a DONE_WITH_CONCERNS. A5 BLOCKED (G2).**

## 1. Phạm vi và file

Source: `v2/web/src/compose/{state,controller,file-hash,file-hash.worker}.ts`, `v2/web/src/compose/composer.tsx`, `v2/web/src/attachments/{queries.ts,preview.tsx}`. Test: `v2/web/test/compose.test.ts`, `v2/web/test/compose-submit.test.ts`, cùng file hỗ trợ `v2/web/test/support/compose-server.ts`. File hỗ trợ này nằm ngoài danh sách brief: đây là producer giả trong bộ nhớ dùng chung cho hai file test, và không bị glob `test/*.test.ts` chạy. Docs: `v2/docs/flows/web-attachments.md` mới, thêm hunk flow `web-attachments` vào `v2/docs/flows.yaml`, và cập nhật khối generated của `index.md`/`files.md`.

Không sửa main/router/styles, auth/lib/contracts, tickets, harness hay server. `v2/web/e2e/compose.spec.ts` **không được tạo** (xem mục 4).

## 2. Interface cho Task3 S3b / Task6

- `AttachmentComposer(props: ComposerProps)` đúng interface brief. App phải gắn `ComposeServicesProvider services={{ client, pending, session, storage: sessionStorage }}` (export từ `compose/composer.tsx`) bên trong vùng đã xác thực, cùng `QueryClientProvider`. Phần nối này thuộc controller wiring.
- Form giữ submission, và mỗi lần sửa truyền lại qua `submission`/`onSubmissionChange`. Form khóa field của mình khi `onStateChange` khác `editing`. Ngoại lệ: khi khóa cũ chỉ còn tombstone (sau đăng xuất), composer báo `editing` để owner nhập lại đúng nội dung. `onAccepted` được gọi một lần cho mỗi receipt; sau đó composer bắt đầu draft mới, còn Task6 tự cấp `clientMessageId` mới.
- `state.ts` export `freezeSubmission`, `canSubmit`, `submissionRequest`, `validateSubmission`, `decodeComposeReceipt`, `receiptSummary`, các type của brief và `ComposeTarget`.

## 3. Lệch so với brief (cần PM/controller biết)

1. **Key của `freezeSubmission`:** `PendingStore.begin` của Task2 tự cấp id, không nhận `operationId` từ ngoài. Vì vậy `freezeSubmission` là hàm thuần (validate và serialize một lần), còn controller đăng ký bằng `pending.begin` với đúng path/body đó. Test chứng minh `freezeSubmission({operationId: op.id})` bằng đúng `op` (khớp từng byte).
2. `ComposeTarget` được suy từ decoder `ComposeSession` của Task2. Decoder `AssistantMessage` tạm nằm trong `compose/state.ts` vì contracts Task2 chưa có; nên chuyển vào `contracts/attachments.ts` khi controller cho phép.
3. Bản text đầy đủ mà composer không đọc lại được từ tombstone: sau đăng xuất, owner phải nhập lại, rồi composer gọi `PendingStore.resume`. Rủi ro B1 (cờ resumed chỉ nằm trong bộ nhớ) vẫn như Task2; composer không làm nó tệ hơn vì không tự resume và body tạo ra là tất định.
4. Không có phần trăm tiến độ tải lên vì `OwnerClient.upload` dùng fetch; UI chỉ hiện “Đang tải lên”, không có phần trăm giả.
5. Bytes để preview được đọc bằng fetch same-origin riêng trong `fetchVerifiedBytes`, vì `OwnerClient.get` chỉ đọc JSON. Khi gặp 401, hàm gọi callback `onUnauthorized` để caller cho phiên hết hạn.
6. Nhóm tệp theo bình luận và nhãn nguồn request/step/bình luận cần projection G2. UI hiện liệt kê danh sách phẳng kèm ghi chú, không suy luận nhóm từ thứ tự.

## 4. A5: BLOCKED

`registerAttachmentRoutes`/`registerInputScopeRoutes` không được gọi ở đâu ngoài `server/src/attachments/routes.ts`. `buildApp` (`server/src/app.ts`) chưa mount policy/compose/upload/submission/messages. Handoff producer còn thiếu (G2):

- mount các factory đã accept, gồm durable storage, receiver registry có closed-ACK, queue/extraction policy và input authority;
- projection `commentId → refs` cho danh sách tệp ticket.

Khi G2 mở, cần viết `compose.spec.ts` theo kịch bản A5 trên fixture Task1 thật. Lượt này không viết spec, vì spec không chạy được sẽ là code chưa kiểm chứng và không được tính là PASS.

## 5. TDD và kiểm chứng

Giữ heavy slot (telemetry: 4,476 GiB khả dụng, pressure 1, CPU idle 73,41%, đĩa 751 GiB), heap 384 MiB, watchdog Python.

| Bước | Kết quả | Log, SHA-256 |
|---|---|---|
| Lượt chạy đầu (source viết trước test, **lệch TDD**) | 25/25 PASS | `task-5-s5a-first-run.log` `4e034fc2…ce1` |
| Kiểm đột biến trên bản sao scratch | M2 (lọc tệp lỗi), M3 (cấp key submit mới), M4 (bỏ refetch khi 409) bị bắt. M1 (bỏ tái dùng operation reserve chưa giải quyết) **sống sót** và lộ lỗi thật: reserve chưa tới server bị kẹt ở `unknown` | `task-5-s5a-mutation.log` `41c39d84…c5d` |
| RED thật: test “reserve chưa tới server… retry đúng key/body cũ” trên source cũ | fail `TIMEOUT:ready` | `task-5-s5a-red.log` `e251962d…ba` |
| GREEN focused (sau khi sửa và thêm test preview) | 29/29 | `task-5-s5a-green-focused.log` `3a3011fc…da` |
| Biome 10 file | exit 0, không còn diagnostic | `task-5-s5a-biome.log` `727dbf37…76f` |
| Web unit sau format (compose + client/events/auth-recovery, không gồm lifecycle DB và test của worker khác) | 68/68 | `task-5-s5a-unit-full.log` `09b4fcb5…478` |
| `tsc --noEmit && vite build` (outDir scratch) | exit 0 | `task-5-s5a-build.log` `1394e7f0…37a` |
| `crew-docs generate` + `check --all` (bản sao HEAD có `v2/` làm root); hook `check --staged`/`--commit-msg` | ok | — |

`vite build` chưa bundle composer/worker, vì composer chưa được nối vào `main.tsx`. Việc Vite bundle worker bằng `new URL('./file-hash.worker.ts', import.meta.url)` chỉ được kiểm khi có wiring.

## 6. Tài nguyên và cleanup

Heavy slot và manifest lock đều đã trả bằng `rm -rf` đúng thư mục lock; `ls` xác nhận lock không còn. Không chạy container hay E2E. Thư mục scratch (dist, bản sao mutation, docs) đã xóa. Commit chỉ gồm 14 path của tôi. `git diff aa98e43^ aa98e43 -- v2/docs/flows.yaml v2/docs/files.md` chỉ có hunk `web-attachments`.

## 7. Câu hỏi còn mở

- Controller có chuyển `decodeAssistantMessage` vào `contracts/attachments.ts` và nhận `test/support/compose-server.ts` vào danh sách file chính thức không?
- Giữ `freezeSubmission` là hàm thuần (key do `PendingStore` cấp) có chấp nhận được không, hay cần Task2 thêm `begin` nhận id?
