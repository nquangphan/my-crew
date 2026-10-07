# MC-2 report

- SHA: bf5114a (nhánh `r1-2/crew-mac`)
- File đổi: `apps/crew-mac/src/commands/doctor.ts` (`checkCrewDocs`, gọi sau `checkWorktreeRoot`), `apps/crew-mac/test/doctor.test.ts`, `docs/flows/mac-setup.md`. `fake-mac.ts` không phải sửa thêm (handler `/usr/bin/git` đăng ký trong từng test).
- Test: `pnpm --filter @crew/mac exec vitest run test/doctor.test.ts` → 26 passed; typecheck sạch; biome sạch. `crew-docs check --range v3..HEAD` ok (2 commits). Đã kiểm bundle thật: `node crew-docs.cjs --version` in `0.1.0`, mã 0.
- Giả định: chỉ quét worktree cấp 1 dưới `worktreeRoot`, bỏ thư mục bắt đầu bằng `.`.
- Lệch plan: test dùng `installed(okSsh)` + `macPaths(home).defaultWorktreeRoot` (không có `installedMac`); thêm test bundle không tồn tại/không chạy; cập nhật danh sách id mong đợi trong test "máy khỏe" (thêm `crew-docs`).

## Sửa sau review

- SHA: deb8503 (chung commit với MC-1). RED/GREEN: xem mục "Sửa sau review" của mc-1-report.md (cùng lệnh, 15 test fail trên code cũ, 56 passed sau sửa).
- Major 2: `checkCrewDocs` chạy qua sshd agent (`sshArgs`, key doctor) như `checkWrapper`: một lệnh đọc `crew-docs.bundle`, `crew-docs.runtime`, git common dir (timeout 30 giây), rồi `node <bundle> --version` (node theo PATH của agent) và `ELECTRON_RUN_AS_NODE=1 <runtime> <bundle> --version` (hook pre-commit; timeout 20 giây). Quá hạn thì báo "quá N giây (có thể do hộp thoại quyền, xem tcc-pending)" và dừng kiểm các worktree còn lại. `fail` kèm gợi ý dời khi bundle, runtime hoặc git dir dưới `~/Documents`, `~/Desktop`, `~/Downloads`, `/Volumes` (`tccProtectedReason`); thiếu `crew-docs.runtime` cũng fail.
- Minor (b): cache `--version` theo cặp runtime/bundle (3 worktree cùng bundle → 2 lệnh). (c): `readdirSync` lỗi → `warn`; dùng `statSync` nên worktree symlink được theo link.
- Giả định: cấp 1 dưới `worktreeRoot` là đủ (đúng chỉ đạo). Hook dùng `crew-docs.runtime` luôn được `install-hooks` đặt cùng bundle, nên thiếu runtime là lỗi.
- Hạn chế: `git rev-parse --path-format=absolute` cần git ≥ 2.31; thiếu thì GITDIR rỗng và bỏ qua kiểm git dir (bundle/runtime vẫn kiểm).

## Sửa sau re-review

- SHA: a15e4fc. R2: `--version` quá hạn cũng đặt cờ dừng (bỏ runtime check và các worktree còn lại), thêm trần tổng 60 giây (`CREW_DOCS_TOTAL_BUDGET_MS`, kiểm đầu mỗi vòng lặp). Test: 3 worktree 3 bundle khác nhau, `--version` quá hạn → chỉ 2 lệnh ssh. RED/GREEN: xem `mc-1-report.md` mục "Sửa sau re-review".
- Giả định: trần 60 giây kiểm trước mỗi worktree, không cắt lệnh đang chạy, nên xấu nhất vẫn vượt trần tối đa một lệnh (30 giây); chưa có test cho trần vì `Date.now` thật.
