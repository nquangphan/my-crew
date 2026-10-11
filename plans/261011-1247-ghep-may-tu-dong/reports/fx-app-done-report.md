# FX — Màn done đổi company / ghép lại máy

Ngày 11/10/2026. Worktree `.worktrees/crew-pair`, nhánh `r25-pair`. Chưa push, chưa build hay cài app.

## Đã làm
- Main (`wizard.ts`): `reopenMachine()` đưa `setup.step` về `paperclip` khi tiến độ đã qua bước đó (giữ origin, company). Chỉ Main đổi state.
- IPC: `setup:reopenMachine` (đổi bước, trả setup state) và `setup:machineReport` (đọc `~/.crew/status-last.json`, chỉ đọc, `null` nếu chưa có hoặc hỏng). Khai ở `ipc-contract.ts`, cài ở `register.ts`.
- Bước `paperclip`: đổi company thì reset `pairedEnvironmentId` (tránh dùng environment của company cũ); chọn lại cùng company thì giữ.
- Renderer (`setup.tsx`, `DonePanel`): khung "Company và máy" với nút "Đổi company / Ghép lại máy". Lần gửi gần nhất `ok:false` thì hiện cảnh báo "Máy này không báo trạng thái lên Paperclip" (HTTP 401/403 có gợi ý máy có thể đã bị gỡ; không có mã HTTP là không gửi được tới server) kèm cùng nút. Nạp lại khi mở và khi cửa sổ focus.
- Docs: `docs/flows/mac-app.md`. Không thêm file nguồn mới nên không đổi `flows.yaml`.

## Kiểm
- vitest `apps/mac-app`: 46 file, 605 ca đạt. `node --test scripts/*.test.mjs`: 24 đạt. `tsc --noEmit` đạt. `pnpm lint` sạch. `crew-docs check --staged` ok.
- Test mới: `setup-wizard.test.ts` (reopen, reset env khi đổi company, readMachineReport), `ipc-contract.test.ts`, `renderer/setup.test.tsx` (nút, lỗi reopen, cảnh báo 401/403/502/null, không cảnh báo khi ok hoặc chưa có).

## Lưu ý
- Quay về `paperclip` thì các bước sau (disk-access, sshd, doctor, done) phải đi lại tuần tự như wizard thường; các bước này idempotent nhưng owner phải bấm qua.
- Cảnh báo dựa trên `status-last.json` (top-level `ok`/`httpStatus`); `machine_revoked` hiện qua HTTP của nó, file không lưu mã `code` của plugin nên câu cảnh báo chỉ nêu HTTP.
- Không sửa `apps/crew-mac`.

Status: DONE
