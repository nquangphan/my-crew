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

## 8. Vòng sửa 1 (review `task-5-s5a-review.md`: I1–I5, M5)

Quy trình: viết test cho mọi finding trước. API mới (`isActive`, `takeReceipt`, `discard`, các field view `assistantRead`/`discardable`, helper `pasteDecision`/`fileActions`/`composeLocks`) được thêm ở dạng stub trả giá trị sai để test chạy được và fail theo hành vi, không fail vì lỗi import. Sau khi lưu log RED mới sửa source. Mọi lệnh chạy trong `v2/web`, giữ sole heavy slot, heap 384 MiB, watchdog Python.

| Finding | Test | RED (trước sửa) | Sửa | GREEN |
|---|---|---|---|---|
| I1 | `compose-submit`: “201 không giải mã được…”, “lượt gửi đã submitted mà op cục bộ đã mất…”, “op được panel khôi phục replay…” | state `editing` thay vì khóa; panel replay → receipt `undefined`, vì body dựng lại từ consent hiện tại khác body gốc (409 `COMPOSE_ALREADY_SUBMITTED`) | Giữ body đóng băng `#frozen` (gồm `assistantRead`) trong bộ nhớ. Khi khóa mất, gửi lại đúng body đó trên cùng compose. Decode lỗi giữ `ambiguous`. `submitted` mà không có khóa/body cục bộ, hoặc gặp 409 `COMPOSE_ALREADY_SUBMITTED`, thì `#lockReason='SUBMITTED_ELSEWHERE'`: không detach, không mở compose mới, chỉ thoát bằng `discard()`. Reload mà khóa đã mất thì `SUBMIT_UNCONFIRMED`; GET compose sẽ khóa hẳn (`submitted`) hoặc mở lại (`open`). Key cuối được persist khi còn khóa | PASS |
| I2 | “nhập lại sau logout với file và consent selected-inputs…” | file `unknown` thay vì `ready` | `#refresh` với compose `submitted` vẫn map file từ server (`#mergeFiles(view, false)`, giữ revision của body gốc). `assistantRead` được persist trong draft record và dùng khi `resume`. Composer hiện consent đã khóa. Có nút “Bỏ bản nháp này”. Test phủ thêm `IDEMPOTENCY_CONFLICT` khi nhập sai: khóa cũ vẫn giữ | PASS |
| I3 | `compose`: “đổi project khi reserve chưa xác nhận…” | `TIMEOUT:moved` | Intent reserve gồm `sessionId`. `#detachFromSession` nhả (`reject`) các khóa reserve/remove chưa giải quyết của compose cũ, vì compose đó đã đóng hoặc không bao giờ được dùng lại | PASS |
| I4 | “PUT còn receiving sau vòng chờ, Thử lại…”, “reload khi server receiving và không còn bytes…” | `TIMEOUT:ready`; state `uploading` thay vì `unknown` | `#process` nhận state `uploading` và có guard chống chạy trùng (`isActive`). `retryFile`/`reconcile` lập lịch lại `uploading` khi còn bytes. Không còn bytes thì `#stalled` đổi thành `unknown`/`UPLOAD_RECEIVING`, kèm nút Thử lại (`fileActions`) | PASS |
| I5 | Ba test helper composer (paste, nút theo trạng thái, khóa/consent/state báo form), `takeReceipt` một lần, cùng 4 test nhánh: SELECTION_CHANGED→refresh, PUT 401→unknown→reconcile, nhả DELETE chưa commit nhờ GET, abandon gặp stale | 4 test mới đầu fail theo assertion. 4 test nhánh PASS ngay vì nhánh đã đúng | `composer.tsx` dùng `pasteDecision`/`fileActions`/`composeLocks`/`takeReceipt` | PASS; đột biến từng nhánh làm đúng test đó fail (`fix1-mutation.log`, mỗi dòng `fail 1`; control `pass 4`) |
| M5 | `canSubmit` thêm ca `ambiguous`/`suspended` + op → true | (assert mới) | — | PASS |

**Môi trường DOM:** repo chưa có jsdom/RTL hay Playwright component testing. Theo chỉ thị, tôi **không thêm dependency** (NEEDS_CONTEXT cho component test thật). Mọi quyết định UI quan trọng (consent, nút Thử lại, khóa form, state báo cho form, paste) được tách thành helper thuần trong `state.ts` và test ở đó. Phần JSX còn lại chỉ nối dây.

| Lệnh | Kết quả | Log, SHA-256 |
|---|---|---|
| RED `node --test test/compose.test.ts test/compose-submit.test.ts` | exit 1, tests 44, pass 33, fail 11 (đều fail theo assertion/TIMEOUT) | `task-5-s5a-fix1-red.log` `6c6ffbc5aec1a3497b597bb4dbb3f3111fbaf557b53330a7774249e71c527026` |
| GREEN cùng lệnh (trước format) | 44/44 | `task-5-s5a-fix1-green-focused.log` `0678aa769f4717e990f2a290ed2c5eefa0b7eabfab1d16209856857b297fb75b` |
| Đột biến 4 nhánh I5 trên bản sao scratch | control pass 4; mỗi đột biến fail 1 | `task-5-s5a-fix1-mutation.log` `5d70b903bad44c970a8faead423b9e4d546268d11e33e874889740616c4879b1` |
| `biome check` 10 file | exit 0, không còn diagnostic | `task-5-s5a-fix1-biome.log` `e360af9f409e08f25ebfae737807cb2c4969d46a6816daedcada14b30a55fbf8` |
| Focused sau format | 44/44 | `task-5-s5a-fix1-green-focused-final.log` `c8e3cabdacb0f573d9f134a5379027a5af3a06d37bf075b2d3708c8abf8987bc` |
| Web unit không DB (compose + client/events/auth-recovery) sau format | 83/83 | `task-5-s5a-fix1-unit-full.log` `339c0c835167cded603a3ec1a53e46389463302e53f307732137a9aa344f7d56` |
| `tsc --noEmit && vite build` (outDir scratch) | exit 0 | `task-5-s5a-fix1-build.log` `e74f730f86730b781532cd2cfb660fd4263bed51c32e8b8fcfc14cb0b792fd83` |

Telemetry khi lấy slot: RED 5,238 GiB / pressure 1 / CPU idle 84,36% / đĩa 751 GiB; GREEN 4,968 / 1 / 85,76 / 751. Slot đã trả sau mỗi đợt. Không chạy container hay E2E. Docs `v2/docs/flows/web-attachments.md` cập nhật bước 5/4/7/9/10/11 và Tests. Manifest/generated không đổi (không có file mới), nên không cần manifest lock.

**Còn lại / cần quyết định:**
- `discard()` để owner bỏ bản nháp đang khóa: khóa cũ vẫn nằm trong `PendingStore`/panel; gửi nội dung mới sau đó có thể tạo thêm mục nếu yêu cầu cũ đã được lưu. Ledger ghi việc “bỏ request ambiguous” là quyết định UX của owner. Hiện composer chỉ cho bỏ ở trạng thái re-entry hoặc `SUBMITTED_ELSEWHERE`/`SUBMIT_UNCONFIRMED`, kèm cảnh báo; cần owner chốt.
- Tải lại trang sau khi 201 không giải mã được thì body đóng băng (chỉ nằm trong bộ nhớ) không còn. Draft bị khóa `SUBMITTED_ELSEWHERE` và receipt chỉ xem được ở danh sách.
- Các Minor M1–M4, M6, M7 chưa sửa (M7 đã sửa tham chiếu dòng trong docs).
