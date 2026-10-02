# Tệp đính kèm và kho original bền vững

## Mục đích

Owner giữ original trước khi tạo ticket, comment hoặc gửi inbox. Mỗi upload UUID có bytes và key riêng kể cả checksum giống nhau. Task 1 cung cấp reserve, private stage, exclusive publication và trạng thái ready; các service submit/access/extraction/reconcile được tích hợp trong task sau.

## Điểm vào

- `server/src/attachments/config.ts` → `loadAttachmentConfig`: root tuyệt đối bắt buộc, giới hạn operator chỉ giảm trong maximum, policy/hash và cấu trúc lồng nhau được freeze.
- `server/src/attachments/storage.ts` → `createFileBlobStore`: file/directory fsync, kiểm no-symlink, durable intent và publication không ghi đè.
- `server/src/attachments/receivers.ts` → `readLocalWriterIdentity`, `createReceiverRegistry`: writer Linux có boot/PID namespace/PID/start ticks, private abort socket và stop proof.
- `server/src/attachments/staging.ts` → `createStageServices`: owner-only compose/reserve/receive/replay/abandon.

## Các bước

1. JSON mutation dùng journal mutator hiện có. Compose giữ target hợp lệ; reserve khóa scope/session và accounting owner, kiểm revision/count/byte quota, lưu original UUID/hash/length, ownership nonce và accepted policy trước disk I/O. Root tuyệt đối không lưu trong DB policy.
2. Private begin mutation đăng ký receiver ID/generation/start identity và nonce operation. Owner directory/operation marker được fsync trước mở writable stage. Production register chỉ chạy trên cùng host Linux/native PID namespace; không dùng TTL để suy process chết.
3. Stream không giữ SQL transaction. Storage băm/đếm bytes và giới hạn từng write 64 KiB. Staging kiểm magic và text decoding trước publication, heartbeat theo policy/generation và max wall; abort không tạo callback publish sau terminal. Nếu upstream stream còn một `next` chưa settle, operation chưa ACK và chưa có stop proof.
4. Sau stage file sync/close + directory sync, publication tạo hard-link độc quyền rồi sync directory và unlink stage. Destination đã có chỉ được replay nếu cùng inode của chính stage; checksum bằng nhau không chứng minh ownership. Intent local giữ key/generation/hash/length/nonce; derivative bắt buộc có callback ghi GC journal trước bytes.
5. Managed receiver chờ mọi work/FD/control connection settle, đóng private socket rồi mới ghi/fsync closed ACK. Ready mutation kiểm lại compose, upload generation, receiver, abort flag và exact closed proof. `attachment.changed` chỉ có `{attachmentId,state,extraction}`; draft chưa có live link có project/ticket/audience null. Event contract chưa đăng ký khiến ready transaction rollback; original/intent vẫn được giữ.
6. PUT ready replay băm toàn bộ body và kiểm original hiện hữu; bytes khác trả conflict. Replay dùng accepted uploadMaxWallMs và kiểm caller abort/deadline trước success, cả khi iterator hoặc verify đang chờ. Deadline trả ATTACHMENT_UPLOAD_TIMEOUT409, không STOP/ACK/quota release. Registry replay theo DB/upload giữ pending next/return/verify cùng cleanup identity; request có thể timeout nhưng lượt tiếp theo BUSY tới actual teardown. Closure thiếu/thất bại giữ unknown/BUSY. Timer/listener được clear, late bytes không được nhận thành success. Validator chạy cho mọi decoded text, gồm EOF prefix và decoder flush; one-byte control bị415 trước publication, vẫn giữ empty/ASCII/tabLFCR/splitUTF16. Abandon giữ quota và bytes, gửi abort cho receiver; cleanup tương lai chỉ được release quota khi terminal deleted + stop/ownership proof. Original từng có `linked_at` không được automatic GC trong phase05.
7. SQL009 thêm inbox/messages/routes, immutable snapshots/manifests/receipts, scoped authorizations/grants/sessions, extraction/derivatives/GC và dispatch input pins cho task sau. Trigger009 trên actual legacy `comments` lấy root → affected descendants → input revisions; một INSERT bump mỗi descendant đúng một lần, lazy base1→2. Rollback comment cũng rollback counters; event consumer không bump lại.

## Files

| Đường dẫn từ `v2/` | Vai trò |
|---|---|
| `server/migrations/009_attachments.sql` | Schema cả phase05, identity/retention/quota invariants và legacy comment fanout |
| `server/src/attachments/contracts.ts` | Shared storage, coverage, snapshot, inbox, grant, receipt và authority types |
| `server/src/attachments/config.ts` | Policy giới hạn/hash/freeze, không default HOME |
| `server/src/attachments/storage.ts` | Private ownership marker, durable intent, exclusive publish/read/remove |
| `server/src/attachments/receivers.ts` | Linux birth identity, private abort control, terminal ACK/native gone proof |
| `server/src/attachments/staging.ts` | Compose, reserve, receive, heartbeat/CAS, replay và abandon |
| `server/test/support/attachments.ts` | Root có nonce/identity, clock, actual mutator, fixture terminal port; native registry tùy chọn Linux |
| `server/test/attachments-storage.test.ts` | Pure config/storage và native process birth/proof tests |
| `server/test/attachments-staging.test.ts` | DB reserve/stream/replay/quota/CAS/abort/event/R1/backup-restore regressions |
| `server/test/attachment-event.test.ts` | Exact metadata và scope attachment.changed, không bytes/path/content |

## Dữ liệu

Original dùng `uploads/<uuid>/original`, stage có generation và receiver UUID. Derivative dùng attachment/extraction/derivative UUID riêng; `.owner.json`, `.operation.<receiver>.json`, `.intent.<stage>.json`, `.closed.<receiver>.json` là private0600 metadata, không trả trong wire attachment. `ownership_nonce`, accepted policy/hash, receiver row và stop proof giữ provenance; quota là tổng expected bytes với latch `quota_released_at IS NULL`, không checksum refcount. Once-linked retention không bị xóa bởi revoke link.

## Flow liên quan

`server-platform` cấp migration prefix/checksum/fixture riêng; `server-journal` cấp mutator/idempotency/event validation; `server-identity` và `server-tickets` cấp project/target/root. Task 2–7 nối atomic submit, quyền/grants/snapshot, extractor và recovery. Controller duy nhất sửa app/manifests/Git; ownership bổ sung Task1 cho whitelist `attachment.changed` và regression metadata đã được PM giao riêng. Native process-kill receiver recovery nhiều process thuộc Task 7; test birth identity riêng chưa chứng nhận toàn pipeline.

## Tests

Pure run: `node --test v2/server/test/attachments-storage.test.ts`. Native run cùng file trong immutable Node24.12.0 Linux container riêng, network none, read-only repo, tmpfs và resource bounds; macOS fixture port chỉ chứng minh terminal protocol, không cấp native gone proof. DB tests chỉ được chạy `databaseFixture(9)` sau actual008 được PM review READY/checksum, event metadata đã đăng ký. Cuối task chạy một covering qua `pnpm --dir v2/server test --test-file <absolute-wrapper.test.mjs>` với đúng 24 file test server đã review ở candidate d249a82 và ba file test Task1, typecheck và Biome sau final production change; report ghi commands/exits/counts/checksums/resource cleanup. Khi gate008 chưa READY, chưa công bố DB/integration hoàn tất.

Actual008 đã độc lập SPEC+QUALITY READY tại candidate d249a82, checksum `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f`. Test Task1 dùng actual PostgreSQL private runner, migration009 pinned `fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a`. Native driver chạy immutable Linux Node24.12.0 trong namespace network của đúng private PG container, chỉ proxy loopback random để kiểm actual receiver lifecycle. Đây là connectivity của test có kiểm soát; không phải extraction sandbox hoặc certification. Driver kiểm birth identity DB, heartbeat, socket abort khi producer đang chờ, ACK chỉ sau terminal, replay ACK sau local map release và quota còn giữ. Backup `pg_dump -Fc`/restore prefix008→009 và prefix009 giữ marker, legacy ticket, reserved identity và checksum; deliberate test-owned drift bị từ chối. Fault sau publication giữ blob/intent nhưng vẫn ghi terminal close ACK.

FIX1/5 đáp ứng hai P2 của review f58f27d: actual PostgreSQL regressions kiểm saved wall policy khác currentconfig, stalled/caller-abort/verification/noncooperative cleanup;29 control một byte và EOF UTF8/UTF16 dở dang bị từ chối, receiver terminal/quota giữ/original chưa có. Probe Linux privatePG có exact birth/ACK và cùng EOF/replay cases, dùng immutable Nodeimage/resource bounds; các artifact nằm execution-phase05/task-1-fix1-*. Original report/evidence giữ nguyên; báo cáo FIX1 riêng, không suy timeout thành process STOP hoặc chứng nhận recovery Task7.
