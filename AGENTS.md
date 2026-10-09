# AGENTS.md

Hướng dẫn cho agent (và người) làm việc trong repo này. Repo `crew` là pnpm TypeScript monorepo của **2P
Crew**. Sản phẩm Crew v3 chạy trên bản fork Paperclip nằm ở repo khác; repo này chỉ giữ `apps/crew-mac` (CLI
`crew-mac` cài và kiểm Mac chạy agent), `apps/mac-app` (app macOS "2P Crew" bằng Electron, bọc `@crew/mac`,
ký Developer ID), `packages/docs-kit` (CLI `crew-docs`), cùng `docs/` và `plans/`.

## Đọc trước tiên

1. Đọc `docs/index.md` TRƯỚC khi đọc code.
2. Tìm flow liên quan: `crew-docs where <file>` cho biết file thuộc flow nào, `crew-docs flow <id>` liệt kê
   đúng các file của một flow.
3. Đọc `docs/flows/<id>.md` của flow đó, rồi mới mở các file nó liệt kê.

## Lệnh

- Cài đặt: `pnpm install`
- Typecheck: `pnpm -r typecheck`
- Test (tất cả package): `pnpm -r test`
- Lint (biome, toàn repo): `pnpm lint`
- Build (tất cả package): `pnpm -r build`
- Build bundle `crew-docs`: `pnpm --filter @crew/docs-kit build` (ra `packages/docs-kit/dist/crew-docs.cjs`)
- Build `crew-mac`: `pnpm --filter @crew/mac build` (ra `apps/crew-mac/dist/cli.js`)
- Build app macOS: `pnpm --filter @crew/mac-app build` (electron-vite, ra `apps/mac-app/out/`). Đóng gói thử:
  `pnpm --filter @crew/mac-app release -- --dev-sign --no-publish` (ký Apple Development, không đăng) hoặc `--dry-run`
  (không ký, chỉ thử build). Không gọi `electron-builder` trực tiếp để đóng gói không ký: bản đã lật fuse mà không có
  chữ ký hợp lệ bị kernel giết (mã 137), và `electron-builder` không tự build lại `@crew/mac`.

## Quy ước

- Toàn bộ UI và docs viết bằng tiếng Việt; identifier, đường dẫn file, route, tên bảng và key YAML giữ tiếng
  Anh.
- Giờ hiển thị theo múi giờ `Asia/Ho_Chi_Minh`.
- Commit theo Conventional Commits.
- Lint/format bằng Biome (`biome.json` ở gốc repo); không dùng ESLint/Prettier.

## Docs đi cùng mỗi lần push

- Mỗi lần push hoặc merge, nếu tập commit đổi file nguồn thì phải có commit (trong cùng lần đó) sửa
  `docs/flows/<id>.md` của mọi flow chứa file đó (luật R3). Từng commit riêng lẻ không cần tự sửa docs.
- File nguồn mới phải có mặt trong một flow của `docs/flows.yaml` (luật R2).
- Sửa `docs/flows.yaml` xong thì chạy bundle `crew-docs generate` (build bằng
  `pnpm --filter @crew/docs-kit build`, ra `packages/docs-kit/dist/crew-docs.cjs`).
- Không sửa `.claude/**`, `.githooks/**`, `CLAUDE.md`, `AGENTS.md` hay các mục `source`, `shared`, `unassigned` của
  `docs/flows.yaml` khi ticket không được chủ dự án cho phép (luật R6) — commit như vậy cần trailer
  `Crew-Owner-Approved: <ticket-key>`.
- Commit khởi tạo docs (thêm `docs/flows.yaml` lần đầu) cần trailer `Crew-Docs-Init: true`.
- Không bao giờ commit credential (luật R7).
- Pre-commit chỉ chặn credential (`crew-docs check --staged`, R7). Kiểm docs trước khi push:
  `crew-docs check --range <base>..HEAD`.
