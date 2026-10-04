# Review độc lập Phase03 Task 2

- Candidate: `d3c7629`; base: `6b76ead`.
- Phạm vi: diff 19 file / 2783 dòng thêm, journal/telemetry/resources và docs/tests liên quan; đối chiếu `task-2-brief.md`, `task-2-report.md`, flow `gateway-host.md` và `native-tree-handoff.md`.
- **Spec READY: NO. Quality READY: NO. Overall READY: NO.** Có một finding P2 cần sửa trước khi nhận Task 2.

## Finding

### P2 — Directory link count thay đổi hợp lệ khiến scratch không thể cleanup

**Vị trí:** `v2/gateway/src/resources/native-resources.c:134`; dữ liệu được giữ từ `registry.ts:168` và truyền lại ở `registry.ts:123`.

Native helper bắt buộc `st_nlink` của directory hiện tại bằng `linkCount` ghi lúc attest trước mọi thao tác quarantine/recover/delete. Trên APFS, số này thay đổi khi nội dung directory thay đổi. Một resource được attest rồi dùng để tạo output bình thường vì thế bị xem là identity mismatch, dù device/inode/UID vẫn đúng, không symlink/hardlink/reference và toàn bộ process đã có exact stopped proof. Caller không có API attest lại resource đã tạo (`RESOURCE_ALREADY_CREATED`); retry tiếp tục lỗi. Cùng điều kiện này còn có thể chặn retry sau delete bị gián đoạn khi một số entry đã được xóa. Điều đó vi phạm mục đích cleanup scratch sau run và retry lỗi I/O/abort của Task 2.

**Bằng chứng tái hiện trực tiếp:** một fixture riêng dùng `ownedRun(root)` hiện có, `reserveOwnedPath({runId:'run',kind:'scratch'})`, `createAndAttest` tạo file `before`, sau đó `mkdir(runtime-output)` và ghi file bên trong. Link count lúc attest là `3`, sau tạo output là `4`; `cleanup('run')` trả `deleted:[]`, resource nằm trong cả `retained` và `failed`. Fixture đã có stopped proof thật; không mock process identity. Test hiện tại chỉ tạo nested data bên trong callback trước attest nên không phát hiện trường hợp này.

**Sửa hẹp:** phân biệt directory với regular file khi kiểm alias. Giữ kiểm device/inode/UID/type/no-follow, parent/quarantine identity và scan regular-file `st_nlink === 1`; không dùng số entry/link count cũ của directory làm định danh bất biến. Nếu vẫn cần điều kiện nlink cho directory, dùng một quy tắc phù hợp semantics macOS/APFS thay vì equality với thời điểm trước run.

**Kiểm chứng cần thêm:** attest một scratch rỗng hoặc có file, cho run thêm/xóa file và thư mục con sau attest, xác nhận exact stop rồi cleanup thành công; retry idempotent; thêm regression retry sau partial deletion nếu fixture có thể tạo gián đoạn xác định. Giữ các regression hardlink run B, symlink/parent swap, unknown process, dirty/reference và abort vẫn retain đúng.

## Đối chiếu còn lại

- Reservation fsync trước spawn; marker exclusive chặn launch kép; READY mang launch/process/PID/birth/PGID/UID; authorization exact source/projection/fence/attempt được ghi trước RELEASE. RELEASE mặc định denied, callback server verifier và capacity mới là dependency rõ ràng. Test concurrent RELEASE kiểm side effect một lần.
- HTTP journal giữ body/key/route/phase và response durable, replay lost reply dùng cùng mutation identity. Consumer phải reconcile server trước side effect; Task 2 không quảng cáo tự cấp claim permit.
- Native initial-child pipe gate arm NOTE_FORK/NOTE_EXIT trước exec; fork hoặc thiếu wait/receipt giữ UNKNOWN. Giới hạn NOTE_TRACK, supervision/confinement Phase04 và signed prebuilt/private Node Phase09 là staged dependency đã được PM chấp nhận, không phải finding mở rộng phạm vi.
- Cleanup dùng directory FD, no-follow, quarantine và kiểm UID/device/inode, giữ unknown/dirty/reference/abort; vấn đề directory link count ở trên là lỗi riêng đã tái hiện. Không phát hiện thêm blocker trong phần được review.
- Telemetry lấy sample mỗi call, có tuổi monotonic/wall và ngưỡng pressure/RAM/disk/load/jobs/ownership; chưa tích hợp entrypoint/Task3/5 được công bố đúng.

## Bằng chứng và giới hạn review

- Đọc toàn bộ 10 source Task 2, tests/support liên quan, diff và docs. Scoped working tree không khác candidate `d3c7629` lúc review; các thay đổi server/docs của agent khác không thuộc review và không bị sửa.
- Dùng bằng chứng producer: full 37/37, focused 23/23, resources 8/8, typecheck, Biome 14 TS, native C compile `-Wall -Wextra -Werror`, source/build tests. Không chạy lại broad suite.
- Chỉ chạy fixture tối thiểu cho finding. Lần harness đầu dùng `node --input-type=module` khiến flag truyền sang fork và helper thoát `EXIT_BEFORE_READY`; đã bỏ inherited flag trong harness rồi tái hiện thành công. Đây là lỗi harness review, không quy thành finding sản phẩm.
- Mọi fixture review dưới prefix riêng `crew-review-task2-*` đã dọn, kiểm lại `remainingReviewFixtures: []`. Không sửa source/docs/plan khác, không install/model/LaunchAgent owner/cache chung/restart/DB/deploy, không commit.
