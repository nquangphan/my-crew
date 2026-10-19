# FX-M — sửa sau review phía Mac

Status: DONE

## Summary

- Sửa `parentPath` theo thư mục cha, kể cả `docs` cho file ở gốc cây docs.
- Bản tin máy giữ các trường probe lỗi ở `null`; Claude dùng đường dẫn tuyệt đối lưu trong cấu hình status, có fallback cho PATH launchd tối thiểu. Bản tin máy và docs được gửi độc lập; lỗi của một phía làm job trả lỗi nhưng không chặn phía kia.
- Snapshot chỉ nhận Git blob mode `100644`/`100755`; secret-scan cả path, title và tên repo. File có metadata trúng scan bị bỏ và đường dẫn trong `dropped` được che. Tên repo trúng scan khiến snapshot không gửi, log không chứa tên.
- Cập nhật `docs/flows/mac-setup.md`. Commit: `333550e fix(mac): keep status and docs reports resilient`.

## TDD và kiểm tra

- Đỏ trước sửa: `vitest run test/status.test.ts test/status-docs.test.ts` — 4 ca thất bại đúng ở CPU probe trả `0` thay vì `null`, `parentPath` của `docs/index.md`, metadata có token và symlink được đưa vào pages.
- Xanh sau sửa: `pnpm --filter @crew/mac test` — 21 file, 292 test đạt; gồm logout, timeout probe, thiếu Claude/Superpowers, PATH tối thiểu, symlink ngoài docs/khóa SSH, gitlink submodule, token trong path/title/tên repo và lỗi HTTP độc lập hai webhook.
- `pnpm --filter @crew/mac typecheck` đạt; Biome trên 7 file TypeScript đã sửa đạt; `git diff --cached --check` đạt.
- `crew-docs check --staged` đạt trước commit; `node packages/docs-kit/dist/crew-docs.cjs check --range v3..HEAD` đạt (6 commits). Worktree sạch sau commit.

## Concerns

- Không chạy launchd, Keychain hay POST server thật theo giới hạn tác vụ. HTTP được giả lập tại biên fetch; snapshot dùng repo Git và scanner docs-kit thật.

## Probe TCC nối tiếp

- Status bỏ probe TCC 24 giờ của doctor; doctor tương tác tiếp tục quét 24 giờ.
- Checkpoint `~/.crew/status-tcc.json` ghi atomic mode `0600`; lưu `scannedUntil`, pending và `msgId` để ghép RESULT ở lượt sau.
- Parser thuần giữ prompt chưa có RESULT, gỡ prompt đã có RESULT và xử lý nhiều client.
- Probe timeout 20 giây giữ state, không tiến mốc và thêm check cảnh báo `tcc-probe`.
- Lần đầu đổi sang `--last 2h`; nếu timeout vẫn ghi checkpoint `scannedUntil` tại lúc bắt đầu, `pending: []` và cảnh báo bắt đầu theo dõi theo giờ địa phương; timeout các lượt sau vẫn giữ nguyên state.
- Đo hai lượt liên tiếp trên log máy thật với HOME tạm, không chạm `~/.crew`: lượt 1 `4.299s`, lượt 2 `0.722s`, không cảnh báo; lượt hai dưới 10 giây.
- Test cập nhật bao phủ cửa sổ 2 giờ và timeout lần đầu tạo checkpoint rỗng cùng tiêu đề cảnh báo chính xác.
- Test `@crew/mac`: 22 file, 297 test đạt; typecheck và build đạt.

## Fetch trước khi chụp docs

- `status send` fetch `origin` trước khi chọn commit; giới hạn 20 giây, không chạy hook và không yêu cầu prompt tương tác.
- Nếu fetch lỗi, ảnh chụp dùng ref sẵn có và log cảnh báo chỉ kèm `projectId`, không kèm URL remote.
- Repo thiếu `origin` (gồm repo bare) bỏ qua fetch; fallback vẫn lần lượt dùng `origin/HEAD`, `main`, `master`, `HEAD`.
- Test bare và hai clone xác nhận commit mới từ remote được chụp; test lỗi remote và không origin cũng đạt.
