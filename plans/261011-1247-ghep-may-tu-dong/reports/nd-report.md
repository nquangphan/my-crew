# ND — Node: báo cáo thi công

Ngày 11/10/2026 (Asia/Ho_Chi_Minh). Worktree `~/Documents/projects/crew/.worktrees/crew-pair`, nhánh `r25-pair`
(từ `ed5bd3f`). Commit `d0f5829` `fix(crew-mac): dò hoặc tải node thật, không ghi binary của app vào launcher`.
Chưa push.

## Kết quả

Đã làm đủ phần ND trong plan và spec §7.

- `apps/crew-mac/src/node-runtime.ts` (mới):
  - `resolveNode` dò Homebrew, rồi `<prefix>/node`, rồi `/bin/zsh -ilc 'command -v node'` (quá hạn 15 giây, lấy dòng
    cuối là đường tuyệt đối). Chỉ nhận node major ≥ 22 và không nằm trong `.app/Contents/` (kể cả sau `realpath`).
  - `downloadNode` lấy bản LTS đầu tiên trong `index.json`, tải tarball darwin và `SHASUMS256.txt`, so sha256 (lệch
    thì xóa tệp và báo lỗi). Sau đó giải nén bằng `/usr/bin/tar` vào `node.tmp-<rand>`, chạy thử, rồi `rename`
    nguyên khối thành `node`.
  - `ensureNode` gộp hai bước trên. `fetch` và `arch` tiêm được.
  - `stableNodePath({home})` dò đồng bộ Homebrew, `~/.crew/node`, rồi node trong launcher. Dưới Electron hàm ném
    `Chưa có node dùng được`. CLI vẫn rơi về `execPath`.
- `context-factory.ts` dùng `stableNodePath` mới. `index.ts` export các hàm node.
- CLI có lệnh `crew-mac node [--prefix <dir>] [--skip-system] [--json]`. Khi phải tải, dòng tiến độ in ra stderr để
  stdout chỉ còn JSON.
- Doctor:
  - `checkLauncher` báo `fail` khi node trong launcher nằm trong `.app`.
  - `checkAgentNode` thêm "Launcher trỏ vào app 2P Crew, không phải node" vào detail khi launcher trỏ vào `.app`.
  - Câu ở check `crew-docs` (cũ là `doctor.ts:1054`) và `checkAgentNode` dùng chung `NODE_HINT`, không còn câu "thêm
    …Helper… vào PATH".
- `mac-app`:
  - `ops.ts` có op `ensureNode`. Utility nhớ `nodePath` và truyền vào mọi `createMacContext`. Khi chưa nhớ được, nó
    dò đồng bộ trước, rồi dò shell đăng nhập (một lần cho mỗi process). Không thấy thì báo mở bước Kiểm tra máy.
  - Kiểu op nằm ở `ops-bridge.ts`.
  - Bước `check` có thêm dòng `node`: `Node <v> (<nhãn nguồn>)`, lỗi thì kèm cách sửa. `register.ts` truyền
    `ctx.ops.call('ensureNode')` vào.
- Docs: `docs/flows/mac-setup.md` có mục mới "Node cho launcher và agent", `docs/flows/mac-app.md` đã cập nhật,
  `docs/flows.yaml` thêm `node-runtime.ts` và test của nó, `docs/files.md` đã sinh lại. `crew-docs check --staged`
  đạt.

## Kiểm

- `pnpm --filter @crew/mac test`: 63 file, 1097 ca đạt. Lần đầu có 20 ca `status-docs` đỏ vì worktree chưa build
  `packages/docs-kit/dist/crew-docs.cjs`. Lỗi này có sẵn từ trước, không do ND. Build docs-kit xong thì xanh.
- `pnpm --filter @crew/mac-app test`: vitest 45 file, 568 ca đạt; `node --test` 24 ca đạt.
- `tsc --noEmit` đạt cả hai package. `pnpm lint` (biome) sạch.
- Test mới:
  - `node-runtime.test.ts`: thứ tự dò, loại major < 22, loại `.app` (không chạy thử), shell in rác. Tải bằng fetch
    giả và tar thật: checksum đúng, checksum sai giữ bản cũ, đổi chỗ nguyên khối, HTTP lỗi, kiến trúc lạ.
    `stableNodePath` dưới Electron không trả `execPath`.
  - Doctor: launcher trỏ vào Helper.
  - CLI: lệnh `node`.
  - Ops: `ensureNode` nhớ `nodePath`, shell đăng nhập chỉ dò một lần.
  - `checkMachine`: dòng `node`.
- Smoke thật trên Mac mini:
  - `node apps/crew-mac/dist/cli.js node --prefix <scratch> --skip-system --json` in
    `{"source":"downloaded","version":"24.21.0"}` sau khoảng 6,7 giây. Đây đúng là bản LTS đầu tiên trong
    `index.json` (Krypton), và checksum khớp vì code chỉ trả kết quả khi sha256 trùng.
  - `<scratch>/node/bin/node -v` in `v24.21.0`. Thư mục scratch đã bỏ vào Thùng rác bằng `trash`.
  - Không cờ thì in `{"path":"/opt/homebrew/bin/node","source":"homebrew",…}`.

## Lệch so với spec

- Câu gợi ý chung của doctor thêm "chạy lại `crew-mac setup`" trước "và doctor". Chỉ dò hoặc tải node thì chưa ghi
  lại launcher, plist và khối PATH, nên thiếu bước setup thì làm theo gợi ý vẫn không hết lỗi.
- Dòng `node` không hiện chữ "Đang tải Node LTS…" trong lúc tải. Bước `check` trả kết quả một lần, và trong lúc chạy
  renderer chỉ hiện "Đang chạy...". Muốn có chữ đó thì phải sửa `renderer/routes/setup.tsx`, file của AP.

## Cho AP

- `ops.ts` và `ops-bridge.ts` đã có op `ensureNode` và `OpsDeps.node`. AP thêm `testStatus` và `machineFacts` vào
  cùng chỗ.
- `register.ts` chỉ đổi một dòng ở bước `check`.
- Gợi ý: `STEP_META.check.description` trong `setup.tsx` có thể thêm "Node 22+ (app tự tải nếu thiếu)".

## Câu hỏi còn mở

Không có.
