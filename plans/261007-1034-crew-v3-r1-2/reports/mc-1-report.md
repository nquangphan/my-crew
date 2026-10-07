# MC-1 report

- SHA: 811e0c9 (nhánh `r1-2/crew-mac`, worktree `.worktrees/crew-r12-mac`)
- File đổi: `apps/crew-mac/src/{cli.ts,commands/uninstall.ts,commands/doctor.ts}`, test `uninstall`/`doctor`/`cli`, `test/helpers/fake-mac.ts`, `docs/flows/mac-setup.md`.
- Test: `pnpm --filter @crew/mac exec vitest run test/uninstall.test.ts test/cli.test.ts test/doctor.test.ts` → 3 files, 39 passed. `pnpm --filter @crew/mac typecheck` sạch. `biome check apps/crew-mac docs/flows` sạch. Hook `crew-docs check --staged`/`--commit-msg` ok.
- Giả định: định dạng dòng `ps` mẫu của plan khớp `TREE_RE` nên không phải chỉnh.
- Lệch plan: (1) bỏ tiền tố "crew-mac: " trong thông báo SetupError (main đã thêm). (2) `LIVE_PS`, `LIVE_RUN_ID` export từ `fake-mac.ts` để cli test dùng chung. (3) Đã viết test và code trong cùng lượt nên chưa chạy riêng bước "kỳ vọng FAIL"; test mới kiểm hành vi đúng nên vẫn có giá trị hồi quy.
- Doc: thêm `liveRunIds`, `isAgentTccSubject`, `/bin/ps`, đường dẫn tuyệt đối sysctl/memory_pressure, quy tắc `tcc-pending`.

## Sửa sau review

- SHA: deb8503 (một commit chung cho MC-1 và MC-2 vì `doctor.ts`/`doctor.test.ts` đan xen).
- Major 1: `scanUninstallBlockers` (fail-closed) từ chối khi còn claude/node `--print` có run id; claude/node `--print` không tty mà env không đọc được; con cháu của job sshd agent (`SSHD_LABEL`, `SPIKE_LABEL`, lấy pid qua `launchctl print`); hoặc `ps` lỗi. `--force` bỏ qua tất cả. Claude thủ công có tty vẫn được qua.
- Minor 3: thông báo (uninstall và cli) ghi rõ `--force` bỏ qua CẢ hai kiểm. Minor 4: docs ghi khe giữa kiểm và bootout, nên tạm dừng agent. Minor 5: `PendingPrompt.identifier`; `isAgentTccSubject(subject, identifier)` nhận `com.anthropic.claude-code`; thêm test ca hỗn hợp (fail, `app khác:`, hint chỉ của agent) và ca identifier.
- RED: chạy test mới trên code cũ (HEAD trước sửa, file nguồn tạm khôi phục rồi trả lại) cho 15 test fail:
```
     × process claude --print không tty mà env không đọc được thì từ chối, claude thủ công có tty thì cho qua 7ms
     × claude cài bằng npm chạy dưới tên node vẫn được nhận là run 2ms
     × node --print không tty không đọc được env cũng bị từ chối 2ms
     × còn phiên sshd của agent (con cháu của job sshd) thì từ chối 2ms
     × thông báo nói rõ --force bỏ qua cả hai kiểm 2ms
     × chạy qua sshd agent: node theo PATH của agent và runtime Electron của hook 9ms
     × bundle hoặc runtime dưới ~/Documents, ~/Desktop, ~/Downloads, /Volumes thì fail kèm gợi ý dời 6ms
     × git dir dưới vùng TCC cũng fail 3ms
     × quá hạn (treo TCC) thì fail và nói rõ quá hạn, dừng kiểm worktree còn lại 4ms
     × --version quá hạn hoặc file thiếu thì fail 4ms
     × nhiều worktree cùng bundle thì chỉ chạy --version một lần cho mỗi cặp runtime/bundle 4ms
     × thư mục worktree không đọc được thì warn, không làm sập doctor; symlink worktree được theo link 4ms
     × nhận claude, bản claude theo version và node 0ms
     × chỉ trả hộp thoại chưa có kết quả 1ms
     × identifier com.anthropic.claude-code đủ để coi là agent dù đường dẫn lạ 4ms
⎯⎯⎯⎯⎯⎯ Failed Tests 15 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  2 failed (2)
      Tests  15 failed | 34 passed (49)
```
- GREEN: `pnpm --filter @crew/mac exec vitest run test/doctor.test.ts test/uninstall.test.ts test/cli.test.ts` → 3 files, 56 passed. Typecheck sạch, biome sạch, `crew-docs check --range v3..HEAD` ok.
- Lệch: `cli.test.ts` không đổi (test cũ vẫn đúng). Ghi ledger: không chặn `~/Documents` trong `forbiddenRootReason` (ticket riêng).

## Sửa sau re-review

- SHA: a15e4fc. R1: `ProcInfo.envReadable` (`isEnvReadable` trong `process-table.ts`, reaper giữ hành vi cũ); nhánh "không chắc" chỉ áp khi tty `??`, không run id và env thật sự không đọc được; `node` chỉ tính khi argv có token chứa "claude" trước `--print`/`-p`. R3: bỏ `liveRunIds` và dòng trong bảng Files; `mac-orphan-reaper.md` thêm `isEnvReadable` (R3 docs vì sửa `process-table.ts`).
- RED (code cũ của `uninstall.ts`, `doctor.ts`, `process-table.ts`; test mới):
```
     × claude -p nền đọc được env nhưng không có run id thì không chặn 4ms
     × node -p "<expr>" (cờ eval của node) không chặn dù không đọc được env 1ms
     × --version quá hạn thì dừng ngay, kể cả khi mỗi worktree một bundle khác nhau 7ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  2 failed (2)
      Tests  3 failed | 49 passed (52)
```
- GREEN: `pnpm --filter @crew/mac exec vitest run test/doctor.test.ts test/uninstall.test.ts test/cli.test.ts test/run-members.test.ts test/reaper-select.test.ts` → 5 files, 90 passed. Typecheck, biome sạch, `crew-docs check --range v3..HEAD` ok.
- Lệch: test cũ "node --print không đọc được env" đổi argv thành script `claude-code/cli.js` cho khớp luật mới; fixture `run-members.test.ts` thêm `envReadable`.
