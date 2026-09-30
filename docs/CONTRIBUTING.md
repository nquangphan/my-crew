# Hướng dẫn đóng góp

Hướng dẫn này dành cho người hoặc agent sắp commit vào repo `crew`. Muốn dựng máy dev trước, xem
[`guides/dev-setup.md`](guides/dev-setup.md).

## Thứ tự đọc trước khi sửa code

1. [`index.md`](index.md) — mục đích, stack, bản đồ module, danh sách flow.
2. `crew-docs where <file>` (file đã có) hoặc `crew-docs flow <id>` (biết trước flow) để biết đúng flow sở hữu
   phần mình sắp sửa.
3. `docs/flows/<id>.md` tương ứng — mục đích, điểm vào, các bước, file, dữ liệu, flow liên quan, test.
4. Chỉ sau đó mới mở mã nguồn được liệt kê trong trang flow.

Đọc code trước docs dễ suy đoán sai chủ đích và bỏ sót chỗ cần sửa theo cùng flow.

## Quy ước

- UI và docs viết bằng tiếng Việt; identifier, đường dẫn file, route, tên bảng và key YAML giữ tiếng Anh.
- Giờ hiển thị theo múi giờ `Asia/Ho_Chi_Minh`.
- Commit theo [Conventional Commits](https://www.conventionalcommits.org/).
- Lint/format bằng Biome (`biome.json` ở gốc repo, chạy `pnpm lint` để kiểm và `pnpm format` để tự sửa); không
  dùng ESLint hay Prettier.

## Docs đi cùng mỗi commit

Repo áp dụng chuẩn docs-kit chung (định nghĩa đầy đủ ở đường dẫn `packages/docs-kit/STANDARD.md`, kiểm bằng CLI
`crew-docs`). Bốn luật hay gặp nhất khi sửa code:

- **R2 (coverage)** — mọi file nguồn mới (khớp `source.include` trừ `source.exclude` của `docs/flows.yaml`)
  phải thuộc một flow trong mục `flows`, hoặc được khai vào `shared`/`unassigned` kèm lý do.
- **R3 (freshness)** — commit đổi một file nguồn mà không sửa `docs/flows/<id>.md` của mọi flow chứa file đó
  (kể cả qua `shared`) trong cùng commit sẽ bị chặn. Sửa trang flow tương ứng cùng lúc với code.
- **R4 (generated)** — block tự động trong `index.md`/`files.md` (giữa marker `crew-docs:flows`/`crew-docs:files`)
  phải khớp đúng kết quả `crew-docs generate`; không sửa tay phần đó.
- **R6 (protected)** — đổi `.claude/**`, `.githooks/**`, `CLAUDE.md`, `AGENTS.md` ở gốc repo, file cấu hình hook
  (`.husky/**`, `lefthook.yml`, thư mục `core.hooksPath`), `.github/workflows/crew-docs.yml`,
  `.github/crew-docs/**`, hoặc mục `source`/`shared`/`unassigned` của `docs/flows.yaml` cần trailer
  `Crew-Owner-Approved: <ticket-key>` trong commit message — chỉ dùng khi chủ dự án đã cho phép thay đổi đó.
- **R7 (secrets)** — không dòng nào được thêm trong diff chứa credential thật; không có cách bỏ qua, kể cả
  trong test (ghép chuỗi bí mật lúc chạy thay vì viết cứng).

## Trailer đặc biệt

- `Crew-Owner-Approved: <ticket-key>` — bắt buộc khi commit chạm một đường dẫn/mục được bảo vệ ở R6 và chủ dự
  án đã đồng ý cho ticket đó.
- `Crew-Docs-Init: true` — chỉ dùng cho đúng commit khởi tạo docs (commit đầu tiên thêm `docs/flows.yaml`);
  commit này được miễn R3 và R6.

## Trước khi commit / sau khi sửa manifest

- Trước khi commit: chạy `crew-docs check --staged` (hoặc để hook cài bằng `crew-docs install-hooks` tự chạy).
- Sau khi sửa `docs/flows.yaml`: chạy `crew-docs generate` để sinh lại block tự động trong
  `index.md`/`files.md`, rồi `git add` các file đó trước khi commit.

## Hook git và CI

`crew-docs install-hooks` cài hook pre-commit/commit-msg/pre-push cục bộ (tương thích husky, lefthook,
`core.hooksPath` có sẵn — không phá hook đang có), và `crew-docs ci-workflow` sinh
`.github/workflows/crew-docs.yml` chạy `check --range`/`check --all` bằng một bundle vendor sẵn, không cần
mạng. Chi tiết cơ chế phát hiện hook và nội dung workflow đó nằm ở
[`flows/docs-hooks.md`](flows/docs-hooks.md).

CI chính của repo (không phải workflow riêng của crew-docs) chạy trong `.github/workflows/ci.yml`: job `check`
gồm typecheck, lint, `crew-docs check --range` rồi `check --all`, toàn bộ test, build web/daemon/desktop, và
shellcheck script deploy; job `e2e` chạy Playwright toàn hệ thống; job `release`/`runtime-release` build và
phát hành khi đẩy tag `v*`/`runtime-v*`. Tóm tắt đầy đủ từng bước nằm ở mục CI trong
[`flows/deployment.md`](flows/deployment.md).

## Thêm file nguồn mới

1. Nếu đường dẫn chưa khớp pattern có sẵn trong `source.include`/`source.exclude` của `docs/flows.yaml`, cần
   chủ dự án cho phép sửa mục `source` (luật R6) trước.
2. Gán file vào flow đang có (thêm vào `files`/`entrypoints`/`tests` của flow đó trong `docs/flows.yaml`) hoặc
   vào `shared` nếu nhiều flow cùng dùng, hoặc `unassigned` kèm lý do ngắn nếu file không thuộc flow nào.
3. Sửa `docs/flows/<id>.md` của flow đó cho khớp file mới (luật R3), rồi `crew-docs generate` và
   `crew-docs check --all`.

## Thêm flow mới

1. `crew-docs init --flow <id> --title "<tên>"` để tạo trang từ template.
2. Viết trang `docs/flows/<id>.md` theo đúng khung 7 heading cố định: `Mục đích`, `Điểm vào`, `Các bước`,
   `Files`, `Dữ liệu`, `Flow liên quan`, `Tests`.
3. Khai flow mới (title, doc, entrypoints, files, tests) vào mục `flows` của `docs/flows.yaml`.
4. `crew-docs generate` để cập nhật danh sách flow trong `index.md`/`files.md`, rồi `crew-docs check --all`
   phải đạt trước khi commit.

## Không commit credential

Không commit mật khẩu, token, khoá ký hay bất kỳ giá trị bí mật thật nào — kể cả trong test hay file mẫu
(`.env.example` chỉ chứa tên biến và giá trị mẫu cục bộ vô hại). `crew-docs check` chặn credential ở dòng mới
thêm trong diff (luật R7) và không có cách bỏ qua.
