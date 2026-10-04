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

## 9. Vòng sửa 2 (re-review `task-5-s5a-fix1-re-review.md`: N1–N5, I5 DOM; khớp hợp đồng G2 theo `producer-g2-review.md`)

**Owner đã quyết:** giữ `discard()` kèm cảnh báo có thể tạo bản trùng; thêm devDependency chỉ dùng cho test. Controller ủy quyền tôi sửa `v2/web/package.json` và lock.

**Dependency (pin chính xác, `pnpm add -D --save-exact --ignore-workspace` trong `v2/web`):** `jsdom` **30.1.1**, `@testing-library/react` **16.3.3**. Peer bắt buộc `@testing-library/dom` **10.4.2** được pnpm tự cài, chỉ nằm trong `pnpm-lock.yaml`, không có trong `package.json`. `package.json` chỉ đổi đúng hai dòng (thứ tự cũ giữ nguyên); `pnpm install --frozen-lockfile` trả “Already up to date”. Không thêm `@types/jsdom`: kiểu tối thiểu nằm ở `test/support/jsdom.d.ts`. Cấu hình test: `test/support/dom.ts` dựng jsdom thành global và trả hàm đóng cửa sổ; `test/support/tsx-loader.ts` là module hook nạp `.tsx` bằng `transformWithOxc` của Vite. Repo đã có tiền lệ nạp JSX qua Vite SSR trong `app-wiring.test.ts`. Script `test` không đổi.

| Mục | Test | RED trước khi sửa | Sửa |
|---|---|---|---|
| N1 | “panel khôi phục replay sau khi composer dựng lại…” | fail (`fix2-red.log`) | “Ours” xác định bằng `pending.get(id)` (`#ownsSubmit`). Controller subscribe `PendingStore`: khóa biến mất mà không có body thì vào `SUBMIT_UNCONFIRMED` rồi GET compose. Bấm gửi lúc đó chỉ chờ GET, không gửi gì. Op bị tombstone ngoài tầm controller thì chuyển sang `suspended` |
| N2 | “nhả trạng thái chưa xác nhận… consent cũ không còn bị khóa” | fail | `#unlockUnconfirmed` xóa `#assistantRead`/`#lastSubmitId`/`#frozen` ở cả hai chỗ mở khóa |
| N3 | “discard bị chặn khi đang gửi…” | fail | `discard` return khi `sending`; `discardable`/`showDiscard` loại `sending`. Bộ đếm `#generation`: kết quả về sau của draft đã bỏ không được gắn vào draft mới |
| N4 | “discard bỏ lượt gửi còn mở và chỉ giữ khóa submit ở panel” | fail | `discard` abandon compose cũ (DELETE; nếu đã `submitted` thì đọc lại rồi dừng) và nhả khóa reserve/remove của lượt đó. Khóa submit giữ nguyên, đúng cảnh báo. Ghi chú: ở trạng thái được phép discard (re-entry hoặc khóa), tệp đã khóa nên thường không còn reserve/remove treo; phần dọn khóa là phòng thủ |
| N5 | Bỏ tiền tố `I1:`…`I5 composer:` khỏi tên test | — | Đổi sang mô tả hành vi |
| I5 DOM | `test/composer-dom.test.ts` (6 test, jsdom + RTL, component thật qua provider thật, producer giả) | “receipt… consent tắt” fail thật: consent của ý định cũ mang sang ý định mới. Năm test nối dây PASS ngay, nên mỗi điểm nối được chứng minh bằng đột biến (`fix2-mutation.log`): bỏ `preventDefault` khi paste, dragOver bỏ qua khóa, textarea không bao giờ `readOnly`, consent không bao giờ `disabled`, ẩn nút bỏ bản nháp, bỏ lý do máy chủ. Mỗi đột biến làm đúng test đó fail; control 6/6 | Reset consent khi giao receipt |

**Khớp hợp đồng G2 (server là chuẩn), RED → GREEN (`fix2-g2-red.log`: 7 fail):**
1. Thêm by-comment vào fake, cùng `commentAttachmentsQuery` + `groupTicketAttachments` (decoder `{items:[{commentId,attachments}],nextCursor}`). `TicketAttachments` hiện nhóm theo bình luận, phần còn lại là “Tệp của ticket và tệp kế thừa”.
2. 503 `EXTRACTION_NOT_CONFIGURED`: Task2 đổi code thành `UNCONFIRMED` và giữ khóa. View thêm `errorMessage` (message của 5xx), composer hiện “Máy chủ báo: Chưa cấu hình xử lý tệp”; retry dùng cùng key. Có test controller và test DOM.
3. Id lạ trong selection: fake trả 404 `NOT_FOUND` theo đúng thứ tự kiểm của `submissions.ts`. Composer đọc lại compose và đánh dấu `ATTACHMENT_MISSING` (đột biến bỏ refresh cho NOT_FOUND làm test fail).
4. 403 `ORIGIN_INVALID` (làm mới phiên một lần, giữ khóa `suspended`, retry cùng key) và `OWNER_REQUIRED` (lần gửi đầu bị từ chối hẳn). Test ORIGIN ban đầu viết sai kỳ vọng, vì lỗi xảy ra ở bước mở compose chứ không phải submit; đã sửa để assert đúng hành vi giữ và tái dùng khóa.
5. Login trả 200.
6. Hết hạn: `SELECTION_CHANGED` khi compose hết hạn, `ATTACHMENT_COMPOSE_CLOSED` khi giữ chỗ và `ATTACHMENT_UPLOAD_EXPIRED` khi PUT. Ba test RED (`TIMEOUT:moved`). Sửa: `#refresh` coi compose `open` có `expiresAt` đã qua là đóng: nhả khóa submit chưa giải quyết (lượt mở đã hết hạn thì không thể commit) rồi chuyển tệp sang lượt mới. `#reserve` gặp `ATTACHMENT_COMPOSE_CLOSED` thì GET compose; `#upload` dừng khi tệp đã được chuyển đi. Mã lỗi hiển thị là `COMPOSE_EXPIRED`.
7. 401 `SESSION_INVALID`: phiên hết hạn, đăng nhập lại (200) rồi gửi lại cùng khóa.

**E2E `compose.spec.ts`: BLOCKED.** `web/scripts/e2e-fixture.ts:551` gọi `buildApp` không kèm `attachments`. Không sửa harness thì API của fixture không có route attachment, nên kể cả đường text-only cũng không chạy được. Handoff cho controller: fixture cần truyền `AttachmentAssembly` (`storageRoot`/`storageHostId`; trên macOS cần cả cổng `receivers`, vì mặc định đòi native Linux closed-ACK). Đường có tệp còn cần extractor đã được chứng nhận.

| Lệnh (sole heavy slot, heap 384 MiB, watchdog Python) | Kết quả | Log, SHA-256 |
|---|---|---|
| RED N1–N4 + DOM (3 file) | 5 test fail theo assertion. Process DOM không tự exit (timer gc của React Query, cửa sổ jsdom còn mở) nên watchdog dừng ở 300 giây, log không có dòng tổng; đã sửa bằng `after(closeDom)` + `gcTime` vô hạn. Kiểm `ps`: không còn process `node --test` | `task-5-s5a-fix2-red.log` `40a575a487339662a1e9d609b638cf02cf61f07a983d21a1b35fb5a12369b7cb` |
| Sau sửa N (trung gian) | 51/53: còn 2 lỗi trong test (thiếu `await discard()`, chờ sai điều kiện), đã sửa | `task-5-s5a-fix2-green-n.log` `0a2b00d1ce016b398cbd78d1a08e6aec7c9d334b14a9cf63bd04c97d5f3cb606` |
| RED G2 | 63 test, 7 fail | `task-5-s5a-fix2-g2-red.log` `b0c84508c3301d2c8247be7a40a1775f716965c46a69b881498186b9d50c354e` |
| GREEN (trước format) | 63/63 | `task-5-s5a-fix2-green.log` `655604db05599cc77ab33ca9035837ff0b9089e490d584730c0e8773e55181a7` |
| Đột biến nối dây DOM + NOT_FOUND | control 6/6; 7 đột biến đều bị bắt | `task-5-s5a-fix2-mutation.log` `2e9c52a60342a2dc64718bcae6a717a57cf4746676176269ff5ded7853eed7dc` |
| `biome check` 15 file (gồm `package.json`) | exit 0 | `task-5-s5a-fix2-biome.log` `21d462a13fb241168cefa03678f4c5d4cc99c5aba7ff821f96ed7931261108c2` |
| `tsc --noEmit && vite build` | exit 0 | `task-5-s5a-fix2-build.log` `0b7ca9020da47675b38f806c4adcc31e209d0ae0a64340382ff2b459fc93da80` |
| Focused sau format | 63/63 | `task-5-s5a-fix2-green-final.log` `af2eb8dad4593053d2720f3024fb41836ed8795ff506ba27bc96d736b7653b07` |
| Web unit không DB (compose ×3 + client/events/auth-recovery) | 102/102 | `task-5-s5a-fix2-unit-full.log` `5c0e4ab13582bacd0c8d4350ab1ee2f67a75d6d5497b30f2e11673572ff04d76` |

Telemetry khi lấy slot: 4,535 GiB / pressure 1 / CPU idle 82,16% / đĩa 751 GiB. Slot đã trả. Manifest lock giữ từ lúc đọc HEAD `31ced2b` tới khi commit, chỉ thêm hunk của tôi (4 file test vào flow `web-attachments`, cùng 4 dòng generated trong `files.md`). Docs: `web-attachments.md` cập nhật; `web-shell.md` thêm devDependency ở hàng `package.json` (R3).

**Còn lại:** M1–M4 (M3 một phần, nhờ subscribe `PendingStore`), M6 chưa sửa; A5 blocked như trên.

## 10. Vòng sửa 3 (`task-5-s5a-fix2-re-review.md`: B1, B2; khai báo peer)

| Lỗi | Test (`compose-submit.test.ts`) | RED (`fix3-red.log`, 4/67 fail) | Sửa (`controller.ts`) |
|---|---|---|---|
| B1 lệch giờ | “đồng hồ client chạy nhanh hơn server…” (client +3 phút, server còn 1 phút) | `sessionId` thành null: compose còn hạn bị bỏ | `#expired()` chỉ coi `expiresAt` là đã qua sau biên `expirySkewMs` = 5 phút. API owner không có giờ server: `OwnerClient` không trả header `Date` và không được sửa `lib/api.ts`, nên tôi chọn phương án biên lệch giờ mà review nêu |
| B1 đang gửi | “đang gửi thì GET compose báo hết hạn cũng không nhả khóa…” | state `editing` giữa lúc gửi | `#expired()` trả false khi `sending` hoặc khi khóa submit đang `pending` trong `PendingStore` (đang được gửi ở nơi khác) |
| B2 khe gửi | “đang bỏ bản nháp thì không gửi được” | `submittable` true trong lúc DELETE | Cờ `#discarding` bật ngay đầu `discard()`: `submittable` false, `submit()` trả null, nút bỏ ẩn. `startNew` tắt cờ |
| B2 lỗi DELETE | “DELETE bỏ lượt gửi lỗi transport…” | `errorCode` null, lỗi bị nuốt | DELETE chưa xác nhận: giữ bản nháp, báo `DISCARD_UNCONFIRMED` (kèm message máy chủ nếu là 5xx), khóa DELETE còn trong panel. Bấm bỏ lần nữa gửi lại đúng khóa đó. Từ chối đã được chứng minh thì tiếp tục bỏ như cũ |

Hai test lúc đầu dựng tình huống bằng cách sửa `compose.state = 'open'` sau khi đã commit. Cách này không thực tế, nên tôi đổi sang `failBefore` (request không tới server) trước khi chạy RED.

`@testing-library/dom` **10.4.2** được khai báo trong `devDependencies` (đúng version trong lock). `package.json` thêm 1 dòng, lock thêm 3 dòng importer.

| Lệnh | Kết quả | Log, SHA-256 |
|---|---|---|
| RED 3 file compose | 67 test, 4 fail theo assertion | `task-5-s5a-fix3-red.log` `dd36fa71ded8c37e5f1c67d0a8e92ea16b888c6e92d29281908d274f2ce6a1d7` |
| Biome 5 file | exit 0 | `task-5-s5a-fix3-biome.log` `c30e8a91ea5575eebfac61ef398baac5a6de55f4c59fc0ddfcfc1d8a67da57a5` |
| GREEN sau format | 67/67 | `task-5-s5a-fix3-green.log` `50549f13269810cb7b6bbe558e1d0f6c695341a13c9e8792b5c1a8547818650c` |
| Web unit không DB | 106/106 | `task-5-s5a-fix3-unit-full.log` `474a27f10cccdaa12e6fb72ed3d635525f96e753849888015c45ecbedc4141a2` |
| `tsc --noEmit` | exit 1, 3 lỗi đều ở `test/ticket-routes.test.ts` (untracked, của worker khác đang sửa router/tickets); 0 lỗi ở file của tôi | `task-5-s5a-fix3-build.log` `70cee45923d59a3f8683fa4a94501ff552e59427465118b1a27f15b8ea51f61c` |
| `vite build` | exit 0 | `task-5-s5a-fix3-vite.log` `ce3b89999fdaeb99ea6d7dcf990d70a271b08543141ebb31fc16201638231976` |

**Vi phạm quy trình slot:** lệnh `pnpm add @testing-library/dom` chạy ngay sau khi lấy lock, trong cùng lệnh in telemetry, nên chưa chặn theo kết quả. Telemetry khi đó là `heavyEligible: false` (3,774 GiB khả dụng / pressure 1 / CPU idle 78,99%). Lệnh cài nhỏ (khoảng 1,3 giây, lock thêm 3 dòng); slot được trả ngay sau đó. Lần thử kế tiếp (3,455 GiB) bị từ chối và trả lock. Các lượt sau dùng vòng lặp chỉ chạy khi `heavyEligible` true; RED/GREEN chạy lúc 4,856 GiB / 1 / 81,17% / 751 GiB. Slot đã trả.

Docs: `web-attachments.md` (biên lệch giờ, `discard`), `web-shell.md` (peer đã khai báo). Hai file này nằm ngoài danh sách được giao lượt này, nhưng luật R3 bắt buộc sửa vì `controller.ts`/`composer.tsx`/`package.json` thay đổi. Manifest không đổi.

## 11. API `discardDraft`/`onHandle` cho S3b (ruling 19:50)

**Interface:** `ComposerProps.onHandle?(handle: ComposerHandle)`, với `ComposerHandle = { discardDraft(): Promise<'discarded' | 'blocked' | 'unconfirmed'> }`. Composer gọi `onHandle` mỗi lần controller được tạo; handle là một object ổn định, luôn gọi tới controller hiện tại. Phía controller là `ComposeController.discardDraft(): Promise<DiscardResult>`:
- `blocked` khi `sending` hoặc đang bỏ dở; không làm gì.
- Ở `editing`, `ambiguous`/`suspended`, tombstone hay trạng thái khóa: bật `#discarding` (khóa nút gửi), `DELETE /v2/attachment-compose/:id` theo flow hiện có (abandon session và upload). Thành công thì nhả khóa reserve/remove của lượt đó, gọi `startNew()` và trả `discarded`. Khóa submit chưa giải quyết vẫn ở panel, đúng như owner đã duyệt.
- DELETE chưa xác nhận: trả `unconfirmed`, giữ bản nháp và khóa DELETE, báo `DISCARD_UNCONFIRMED`, rồi lập lịch lại tệp còn bytes. Gọi lại thì gửi lại cùng khóa (như B2).
- `discard()` (trạng thái khóa) và `abandon()` (nút “Bỏ bản nháp tệp”) giờ ủy quyền cho `discardDraft`. Vì vậy `abandon()` không còn nuốt lỗi và `startNew()` cả khi DELETE thất bại. Composer reset consent khi nhận `discarded`.

| Lệnh (scratch `$TMPDIR/crew-v2-web-s5a/`; slot chỉ chạy khi `heavyEligible` true: 5,016 GiB / 1 / 62,69% / 750 GiB) | Kết quả | Log, SHA-256 |
|---|---|---|
| RED (stub trả `blocked`, `onHandle` chưa gọi) | 73 test, 5 fail theo assertion (`'blocked' !== 'discarded'/'unconfirmed'`, `TIMEOUT:handle`). Test “đang gửi thì blocked” PASS trên stub, được chứng minh bằng đột biến bên dưới | `task-5-s5a-fix4-red.log` `14cbc67f945b9bc7ad705aede0e0c7bbea3faf519360a4c19a78f5ff339767d6` |
| GREEN (sau Biome) | 73/73 | `task-5-s5a-fix4-green.log` `8903190b5123a86bcc0f86e5baedb70b1aa027db7cf08ca71e2bfcf785f2c229` |
| Đột biến | control 8/8; bỏ nhánh `sending` → fail 1. Guard `#discarding` trong pipeline **không** bị test nào bắt: đây là phòng thủ cho race băm xong rồi giữ chỗ trong lúc bỏ, chưa có test tái hiện | `task-5-s5a-fix4-mutation.log` `a3c21ce5790cda6432b3eb29ee246bbefc42a7675d3842fbcaeb9052e056f040` |
| Biome 4 file | exit 0 | `task-5-s5a-fix4-biome.log` `4f05f3940c640fb53b47216753079e32099bab6ff37cf684b41626ba889a0103` |
| Web unit không DB | 112/112 | `task-5-s5a-fix4-unit-full.log` `8db77ef2b76e22534c037cdc1d8b63718e403d4fa7a49841872907c73c444a63` |
| `tsc --noEmit` | exit 0, không lỗi | `task-5-s5a-fix4-tsc.log` `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (rỗng) |
| `vite build` | exit 0 | `task-5-s5a-fix4-vite.log` `11c5c8a518e2b4b7d491faf91f6d81de96413cc293a4d9c7d1843cd6b45726ea` |

Đã kiểm mọi import tương đối trong file compose và test đều trỏ tới file đã track. Slot đã trả; scratch đã xóa. Manifest không đổi. Docs: `web-attachments.md`.
