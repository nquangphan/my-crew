# MC-2 — Ảnh chụp docs

Status: DONE_WITH_CONCERNS

## Summary

- Nhánh `r1-4-mac`, commit `64ccab6` (`feat(mac): publish signed docs snapshots for registered repos`) và `0c7a406` (`fix(mac): secure docs snapshot scanning and repo updates`). Không push/deploy/SSH, không cài launchd hay Keychain thật, không POST server thật. Working tree sạch.
- Thêm `crew-mac status add-repo <projectId> <path>`, `remove-repo <projectId>`, `list-repos`. File `~/.crew/status-repos.json` có mode `0600`; xác nhận UUID, đường dẫn tuyệt đối và git root.
- Sau bản tin máy, `status send` chọn commit `origin/HEAD`, sau đó `main`, `master`, cuối cùng `HEAD`; không fetch hay sửa working tree repo. Commit đổi thì lấy mọi `.md` dưới `docs/`, dựng pages/links/dropped, chạy `crew-docs check --all` ở detached worktree tạm, ký HMAC và POST `docs-snapshot`. HTTP 2xx mới cập nhật `lastCommit`; body > 5 MiB không gửi.
- R7 secret-scan chạy trên nội dung từng trang qua tên tạm an toàn; file có NUL bị bỏ theo hướng fail-closed. `ls-tree -z` giữ đúng tên file Unicode. Cập nhật `lastCommit` dùng khóa liên tiến trình và chỉ sửa repo còn được đăng ký. Checkout tạm tắt hook và được gỡ cả khi tạo lỗi.
- Cập nhật `docs/flows/mac-setup.md`, `docs/flows.yaml`, sinh lại `docs/files.md`.

## TDD và kiểm chứng

- Đỏ: 3 test đầu fail do thiếu lệnh; test git root fail khi nhận thư mục con; các test NUL, Unicode/tên có dấu cách, cập nhật repo đồng thời và post-checkout hook đều fail trước khi sửa.
- Xanh: `pnpm --filter @crew/mac test` → 21 file, 280 test pass. `pnpm --filter @crew/mac typecheck` → pass. Biome trên file sửa → pass.
- `crew-docs check --staged` → pass trước cả hai commit; `crew-docs check --range 6cfeebc..HEAD` → pass (2 commits).
- Test dùng repo git tạm và fetcher giả lập. Trước test không cần embedded Postgres.

## Concerns

- `@crew/docs-kit` không export API secret-scan; giải pháp dùng bundle `crew-docs` từ git config `crew-docs.bundle`. Repo chưa cấu hình bundle sẽ được cảnh báo và giữ `lastCommit` để thử lại.
- Parser link hiện hỗ trợ Markdown inline `[text](href)`; link reference-style và HTML chưa được trích xuất.
- Thư mục tạm do `mkdtemp` tạo được để nguyên theo yêu cầu; git worktree bên trong được gỡ qua `git worktree remove --force`.
