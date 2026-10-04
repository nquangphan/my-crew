# Re-review độc lập Phase03 Task 2 — fix round 1

- Candidate: `859d671`; phạm vi diff: `832c9a3..859d671`, chỉ finding P2 của `task-2-review.md`.
- **Spec READY: YES. Quality READY: YES. Overall READY: YES trong phạm vi Task 2 và giới hạn producer đã chấp nhận.**
- **P2 đã đóng. Không có finding mới trong diff sửa.**

## Đối chiếu sửa lỗi

`v2/gateway/src/resources/native-resources.c:134–136` bỏ đúng equality giữa directory `st_nlink` hiện tại và snapshot lúc attest. `argv[11]`/JSON `linkCount` vẫn giữ tương thích ABI/durable format và được chú thích rõ là quan sát, không phải identity bất biến. Đây là thay đổi trực tiếp xử lý trigger APFS đã tái hiện ở review trước.

Các hàng rào còn nguyên: `match` và `dir_at` dòng 15–26 kiểm directory/UID/private mode/device/inode qua `openat(O_DIRECTORY|O_NOFOLLOW)`; walker dòng 49–76 kiểm UID/device/type/no-symlink và identity khi descent/unlink. Regular-file `st_nlink === 1` vẫn được kiểm cả lúc scan (dòng 73) và ngay trước unlink (dòng 76). Quarantine vẫn mở đúng parent FD, dùng `RENAME_EXCL` và recheck same inode cùng fsync (dòng 168–183); delete recheck directory identity trước unlink (dòng 210). Không sửa process stop proof, retention/reference/abort gate hoặc registry state machine.

Flow `gateway-host.md` cập nhật đúng semantics directory link count và mô tả regression; không nâng claim về runtime certification hay full process tree.

## Bằng chứng regression

1. `resources.test.ts:274`: resource được attest trước, sau đó child Node thật đi qua READY/registerProcess/RELEASE thêm/xóa file và subdirectory. Test wait rồi nhận `observe(record) === 'stopped'`, kiểm device/inode/UID giữ nguyên nhưng nlink khác snapshot, xác nhận output thực và cleanup/idempotence. Đây là trigger trực tiếp của P2, không dựa vào mock process hoặc bỏ ownership gate.
2. `resources.test.ts:347`: `uchg` chỉ áp lên directory fixture sau durable quarantine; native walker thực sự xóa nested file rồi gặp lỗi unlink directory. Test kiểm bytes đã mất nhưng directory còn, exact quarantine identity và durable `quarantined`/`CLEANUP_IDENTITY_OR_IO_FAILURE`; gỡ flag, đóng/mở registry, kiểm error receipt còn nguyên rồi retry thành công/idempotent. Không thêm fault bypass production.

Reviewer chạy độc lập đúng hai regression:

```text
pnpm --dir v2/gateway exec node --test --test-name-pattern='runtime output changes|actual partial native deletion' test/resources.test.ts
tests 2; pass 2; fail 0; cancelled 0; skipped 0; exit 0
```

Bằng chứng covering suite của producer trong `task-2-fix.md`: resources 10/10, gateway build + 39/39, typecheck, Biome và native compiler warnings đều GREEN. Đã đọc test/evidence; không chạy lại broad suite. Scoped files hiện tại không khác candidate `859d671` khi review.

## Cleanup và phạm vi kết luận

Hai test tự đóng launcher/journal/registry, wait own child và dọn exact temp root; kiểm lại hai prefix `crew-resource-runtime-links-*`, `crew-resource-partial-delete-*` trả `remainingScopedFixtures: []`. Reviewer chỉ tạo báo cáo này, không sửa source/stage/commit, không chạm phần việc agent khác.

Native fork/escaped descendant hoặc mất receipt vẫn UNKNOWN; Phase04 supervision/confinement và Phase09 signed prebuilt/private Node giữ nguyên là staged dependencies. Re-review này đóng P2 của Task 2; không chứng nhận các gate server/host integration hoặc model/runtime thuộc task/phase sau.
