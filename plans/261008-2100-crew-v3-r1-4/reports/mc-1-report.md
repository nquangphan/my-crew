# MC-1 report

Status: DONE_WITH_CONCERNS

## Summary

- Commit `1aa3734` (`feat(mac): report signed machine status`) trong worktree `r1-4-mac`; không push, deploy hoặc cài LaunchAgent trên máy thật.
- Thêm `crew-mac status config --url`, `set-secret`, `send`; cấu hình ở `~/.crew/status.json`, secret ở Keychain service `crew-mac-status`, kết quả gửi ở `~/.crew/status-last.json`.
- Bản tin v1 giới hạn 16 KB, dùng các parser/check của doctor, chỉ xuất `id/status/title` trong `checks`, ký HMAC-SHA256 theo interface và POST với hạn chờ 10 giây.
- `setup` cài plist `com.2p.crew-mac-status` mỗi 60 giây, log `~/.crew/logs/status.log`; `uninstall` gỡ plist; `doctor` kiểm job và lần gửi gần nhất.
- Cập nhật flow `mac-setup`, `docs/flows.yaml`, chạy `crew-docs generate` (cập nhật `docs/files.md`).

## TDD và kiểm chứng

- RED: test mới `status.test.ts` ban đầu dừng vì chưa có module status; test setup/doctor thất bại do thiếu job và check; test CLI ghi log thất bại vì in 2 dòng.
- GREEN: test status, setup, doctor đạt 64/64; test CLI ghi một dòng đạt sau khi xử lý `StatusSendError`.
- `pnpm --filter @crew/mac typecheck`: đạt.
- `pnpm --filter @crew/mac exec vitest run --maxWorkers=1`: 266/266 đạt (20 file).
- `pnpm exec biome check` trên 11 file nguồn/test của ticket: đạt.
- `node packages/docs-kit/dist/crew-docs.cjs check --staged`: đạt; hook commit cũng đạt.
- `git diff --cached --check`: đạt trước commit.

## Concerns

- `pnpm --filter @crew/mac test` mặc định thất bại 2 lần, cùng test `crew-claude-run`: thiếu file `started` khi chạy nhiều worker. Test đó chạy riêng đạt 11/11; toàn gói chạy tuần tự đạt 266/266. Không sửa wrapper ngoài phạm vi ticket.
- `pnpm lint` toàn repo thất bại vì lỗi Biome đã có trong `.codex/hooks/**` (136 errors, 123 warnings, 181 infos), ngoài file sở hữu. Biome trên file ticket đạt.
- `security add-generic-password -w <secret>` nhận secret qua argv theo CLI của `security`; process khác có thể thấy argv trong khoảng thời gian ngắn qua `ps`. Giải pháp lâu dài: helper native gọi Keychain API trực tiếp, đưa secret qua stdin/IPC thay vì argv. Secret không nằm trong file cấu hình, bản tin hay log.
