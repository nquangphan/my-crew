# Phase03 Task 2 — fix round 1/5

Finding P2 trong `task-2-review.md` đã sửa hẹp và kiểm chứng cục bộ; diff freeze để PM review độc lập/commit. Producer được review là `d3c7629`; HEAD khi làm fix là `832c9a3d015fd750a489f49ff48db36a1501ae62`. Không stage/commit hay sửa các thay đổi server/planner đang song song.

## Nguyên nhân và thay đổi

`native-resources.c` so `st_nlink` hiện tại với snapshot lúc attest trước quarantine/recover/delete. Directory trên APFS đổi số này khi runtime tạo/xóa nội dung, trong khi device/inode/UID/type vẫn đúng. Equality vì vậy chặn cleanup hợp lệ và có thể chặn retry sau partial delete.

- Native chỉ bỏ equality link count của directory ở đầu thao tác. `argv[11]` và JSON `identity.linkCount` vẫn giữ tương thích ABI/durable format v1, được ghi nhận là snapshot quan sát.
- Giữ nguyên `dir_at`/`match`: device/inode/UID/type/private mode, directory FD và `O_NOFOLLOW`; giữ root/objects/quarantine identity, `RENAME_EXCL`, recheck trước delete và scan UID/type/device/no symlink/foreign mount.
- Regular file vẫn phải `st_nlink === 1` khi scan và ngay trước `unlinkat`; run-B hardlink vẫn bị giữ lại. Không sửa `registry.ts`, ProcessJournal, Launcher, release gate hay stop proof.
- R3 flow cập nhật semantics directory snapshot và hai regression; vẫn đúng bảy heading level 2.

## RED → GREEN và regression

1. Runtime regression tạo scratch với file/subdirectory trong callback trước attest, rồi reserve/spawn child Node thật qua READY gate. Sau register exact process/start identity và RELEASE, child thêm output/file/subdirectory, xóa file/subdirectory cũ và tạo/xóa transient directory. Chờ exact native stopped proof, xác nhận device/inode/UID không đổi và `nlink` đã đổi, rồi cleanup/idempotence.
   - RED trên native equality cũ: assertion cleanup nhận `deleted: []`, UUID trong cả `retained` và `failed`, dù `observe(record) === 'stopped'` và identity vẫn đúng.
   - GREEN sau bỏ equality: scratch bị xóa, repeated cleanup trả cùng receipt `deleted`.
   - Harness đầu chưa làm số entry cuối khác số entry đầu nên assertion nlink chưa đổi; đã chỉnh fixture thêm root output file trước RED thực sự ở trên. Không tính lỗi harness là bằng chứng sản phẩm.
2. Partial-delete regression dùng hook `onDurableCleanup('quarantined')` đã có để đặt `uchg` bằng `/usr/bin/chflags` lên directory riêng của fixture sau quarantine. Native thực sự xóa nested regular file rồi `unlinkat` directory bị lỗi; không thêm fault hook production.
   - Xác nhận bytes đã mất nhưng nested directory còn, quarantine root giữ exact device/inode/UID, durable record `state: quarantined`, `lastError: CLEANUP_IDENTITY_OR_IO_FAILURE`.
   - Gỡ flag trên đúng fixture path, đóng/mở registry, xác nhận record lỗi không đổi qua restart rồi retry delete/idempotence thành công.
3. Các negative case cũ vẫn GREEN: unknown process/pure reserve/unattested, owner checkout symlink, object/parent symlink hoặc parent replacement, run-B hardlink, dirty/other-run reference, cancellation và abort sau quarantine; không nới alias/gate để chữa P2.

## Lệnh và bằng chứng cuối

| Lệnh tại worktree | Kết quả |
|---|---|
| `pnpm --dir v2/gateway exec node --test --test-name-pattern='runtime output changes|actual partial native deletion' test/resources.test.ts` | GREEN 2/2 sau source fix |
| `pnpm --dir v2/gateway exec node --test test/resources.test.ts` | GREEN 10/10 |
| `pnpm --dir v2/gateway exec node --test --test-name-pattern='actual partial native deletion' test/resources.test.ts` | GREEN 1/1 sau bổ sung assert exact quarantine identity + durable error qua restart |
| `pnpm --dir v2/gateway test` | Build + GREEN 39/39, fail/skip/cancel 0; chạy một covering suite sau source fix |
| `pnpm --dir v2/gateway typecheck` | Exit 0 sau test edits cuối |
| `pnpm exec biome check v2/gateway/test/resources.test.ts` | Exit 0, 1 file, không fix/error/warning |
| `/usr/bin/clang -Wall -Wextra -Werror -fsyntax-only v2/gateway/src/resources/native-resources.c` | Exit 0; native fixtures còn build binary thật với `-Wall -Wextra -Werror -O2` vào private root mới |
| `git diff --check` | Exit 0 |

Không chạy desktop/domain/server suite; không package/lock/shared manifest/host/IPC/server edits hoặc global install/service/DB/model call. Shared manifest/index/generated docs và commit do PM giữ.

## Cleanup và giới hạn

Mọi fixture mới dùng canonical private `mkdtemp`, Node helper/cache/clang output chỉ nằm trong root fixture. Partial-delete teardown gỡ `uchg` đúng directory, và `finally` đóng registry/launcher/journal ngay cả khi gỡ flag lỗi. Runtime fixture wait child exact proof trước cleanup; không timeout/PID đơn lẻ làm death proof.

Lần harness partial-delete đầu dùng nhầm `/bin/chflags` (ENOENT), rồi lỗi teardown trước khi đóng writer locks. Đã sửa sang `/usr/bin/chflags` và bọc đóng fixture trong `finally`. Dọn đúng fixture `crew-resource-partial-delete-KNTbDx`: worker PID 99663 được kiểm command test/UID 501 và recheck native birth `1790911141:531571` trước SIGTERM; native probes xác nhận worker và lock-holder PIDs 99673/99674/99788/99789 đã vắng. Chỉ sau đó kiểm root UID/birth `2026-10-02T03:19:01.594Z`/device `16777229`/inode `63180641` rồi xóa exact root. Không kill hoặc xóa process/cache/bytes của agent khác.

Inventory cuối từ 21 prefix fixture Task 2 (gồm hai prefix mới `crew-resource-runtime-links-`, `crew-resource-partial-delete-`) tại canonical temp root: `remainingTask2FixtureDirectories: []`. Các run xanh tự wait/close own child/writer và xóa exact roots; không còn immutable flag fixture.

Giới hạn đã được PM duyệt giữ nguyên: fork/escaped descendant hoặc thiếu tracking/receipt vẫn durable `PROCESS_TREE_UNKNOWN`; Phase04 cần supervisor/spawn broker/confinement toàn cây, Phase09 phải ship signed prebuilt native helper/private Node. Fix này không chứng nhận platform/model/runtime release, không hoàn tất server gate Task 3/5/7. Crash sau native delete trước durable receipt vẫn giữ failure/manual handling.

## Freeze diff

- `v2/gateway/src/resources/native-resources.c`: +3/-1; SHA-256 `1aa1870f3f1dd6d9ed0725b7a73f3dab14b47f50b764e167cda4283aee34fc17`.
- `v2/gateway/test/resources.test.ts`: +153/-0; SHA-256 `6400c5ab5d03be3483d3a49e684987e02b3249c32df9005340b098a2a6959cae`.
- `v2/docs/flows/gateway-host.md`: +2/-2; SHA-256 `b3eace83405397126f1456de2f3dfbdbf314d9923648c80d19899b6c1439e5f5`.
- `plans/261002-0002-crew-v2/execution-phase03/task-2-fix.md`: report mới này.

API exports/durable formats không thay đổi. Chưa có commit của agent fix; PM commit và scoped review là bước kế tiếp.
