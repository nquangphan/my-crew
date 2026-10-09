# Chuẩn docs 2P Crew (v1)

Tài liệu này là chuẩn bắt buộc cho mọi dự án chạy trên 2P Crew. Agent đọc nó khi khởi tạo docs (ticket
docs-init) và khi cập nhật docs (job docs-update). Công cụ `crew-docs` kiểm tra đúng những luật ở đây.

Prose viết bằng tiếng Việt. Identifier trong code, đường dẫn file, flow id, key YAML và marker của block sinh
tự động giữ tiếng Anh, để công cụ không phụ thuộc ngôn ngữ.

## 1. Cấu trúc

```
<repo>/
  AGENTS.md                 # Cách làm việc: lệnh build/test, quy ước, "ĐỌC docs/index.md TRƯỚC"
  CLAUDE.md                 # Đúng một dòng: @AGENTS.md
  docs/
    index.md                # Mục đích, stack, bản đồ module, danh sách flow (block sinh tự động)
    architecture.md         # Thành phần, lưu trữ dữ liệu, dịch vụ ngoài, cách triển khai
    flows.yaml              # Manifest cho máy đọc: nguồn sự thật flow ↔ file
    files.md                # Tra ngược file → flow, sinh tự động, không sửa tay
    flows/<flow-id>.md      # Mỗi flow nghiệp vụ hoặc kỹ thuật một trang
```

`crew-docs init` tạo các file này từ template (không ghi đè file đã có) và in checklist docs-init.

## 2. `docs/flows.yaml`

Schema nằm ở `packages/docs-kit/src/flows-schema.ts` (`FlowsManifest`).

```yaml
version: 1
source:                      # file nguồn = include trừ exclude (glob, tính cả dotfile)
  include: ["src/**", "apps/**", "packages/**"]
  exclude: ["**/*.test.*", "**/dist/**", "**/generated/**"]
flows:
  ticket-assignment:         # flow id: kebab-case
    title: Giao ticket       # tên hiển thị
    doc: docs/flows/ticket-assignment.md
    entrypoints: [apps/api/src/routes/ticket-routes.ts]
    files: [apps/api/src/services/ticket-service.ts]
    tests: [apps/api/test/transition.test.ts]
shared:                      # file dùng chung: liệt kê mọi flow dựa vào nó
  apps/api/src/db/client.ts: [ticket-assignment, machine-pairing]
unassigned:                  # ngoại lệ có lý do rõ ràng
  - path: scripts/dev-reset.sh
    reason: công cụ dev cục bộ, không thuộc flow nào
```

- Mọi đường dẫn là đường dẫn tương đối từ gốc repo, dấu `/`, ghi đúng từng file (không dùng glob trong flows,
  shared hay unassigned).
- Một file có thể thuộc nhiều flow. File dùng chung bởi nhiều flow thì đặt vào `shared` thay vì chép vào từng flow.
- `source`, `shared` và `unassigned` là mục được bảo vệ (luật R6). Mục `flows` thì agent được sửa.

## 3. Trang flow `docs/flows/<id>.md`

Heading cố định, đúng thứ tự:

| Heading | Nội dung |
|---------|----------|
| `# <Tên flow>` | Tiêu đề trang |
| `## Mục đích` | Flow giải quyết việc gì, cho ai |
| `## Điểm vào` | Route, lệnh, sự kiện hoặc màn hình khởi động flow |
| `## Các bước` | Danh sách đánh số; mỗi bước nêu file và symbol: `` `path` → `symbol`: việc làm `` |
| `## Files` | Bảng: đường dẫn, vai trò, symbol chính |
| `## Dữ liệu` | Bảng DB, sự kiện, lời gọi ra ngoài |
| `## Flow liên quan` | Flow khác và quan hệ |
| `## Tests` | File test và điều chúng kiểm tra |

`crew-docs init --flow <id> --title "<tên>"` tạo trang từ template. Không có change log trong trang flow:
lịch sử git chính là change log.

## 4. Block sinh tự động

`crew-docs generate` viết lại phần nằm giữa các marker, từ `docs/flows.yaml`:

- `docs/index.md`: `<!-- crew-docs:flows:start -->` … `<!-- crew-docs:flows:end -->` (danh sách flow).
- `docs/files.md`: `<!-- crew-docs:files:start -->` … `<!-- crew-docs:files:end -->` (bảng file → flow và
  các ngoại lệ unassigned).

Không sửa tay phần giữa marker. Sau khi sửa `flows.yaml` hoặc sau khi merge, chạy `crew-docs generate`.

## 5. Luật kiểm tra (`crew-docs check`)

| Luật | Lỗi khi |
|------|---------|
| R1 manifest | `flows.yaml` sai YAML hoặc sai schema; flow id trùng; file doc, entrypoint, file, test, shared hay unassigned được liệt kê mà không tồn tại; shared trỏ tới flow không có; doc không phải `docs/**.md`; một file vừa unassigned vừa thuộc flow |
| R2 coverage | Một file nguồn (include trừ exclude) không thuộc flow nào, không nằm trong `shared` hay `unassigned` |
| R3 freshness | Tập commit của một lần push, merge hoặc range CI (không tính commit merge, commit docs-init và lịch sử trước nó) thêm, sửa, xóa hoặc đổi tên file nguồn mà không commit nào trong tập đó sửa `docs/flows/<id>.md` của mọi flow bị ảnh hưởng. Lỗi được báo trên commit đầu (head) của range. Flow bị ảnh hưởng: flow liệt kê file đó trước hoặc sau thay đổi, kể cả qua `shared` |
| R4 generated | Block sinh tự động trong `index.md` hay `files.md` khác với kết quả `crew-docs generate` |
| R5 initialized | `check --all`/`check --range`: không có `docs/flows.yaml` → exit 3 `NOT_INITIALIZED`. Ở `check --staged`/`--commit-msg`/`--pre-push`: nếu manifest thiếu ở CẢ bản đang xét và bản trước (HEAD cho staged/commit-msg; tip vừa push và tip đã biết của remote cho mỗi ref pre-push) thì không kiểm tra gì, in một dòng cảnh báo trên stderr và exit 0 — chủ dự án vẫn commit/push được trước khi chạy docs-init. Xoá manifest khỏi repo đã có docs vẫn bị chặn (exit 3) như cũ |
| R6 protected | Ngoài commit docs-init, commit đổi `.claude/**`, `.githooks/**`, `CLAUDE.md`, `AGENTS.md` ở gốc repo (một `AGENTS.md` lồng trong thư mục con, ví dụ `src/AGENTS.md`, không được bảo vệ), file cấu hình hook (`.husky/**`, `lefthook.yml`, thư mục `core.hooksPath` trong repo), `.github/workflows/crew-docs.yml`, `.github/crew-docs/**`, hoặc các mục `source`, `unassigned`, `shared` của `flows.yaml`, mà không có trailer `Crew-Owner-Approved: <ticket-key>` |
| R7 secrets | Dòng được thêm trong diff staged hoặc diff được push chứa credential. Luôn dùng bộ luật có sẵn (lấy từ cấu hình mặc định của gitleaks, thêm token máy 2P Crew); nếu máy có `gitleaks` trong PATH thì chạy thêm gitleaks |

Không có marker bỏ qua cho R7: chuỗi có dạng credential không được commit, kể cả trong test (hãy ghép chuỗi lúc
chạy).

### Commit docs-init

Commit docs-init là commit thêm `docs/flows.yaml` (commit cha không có file này) và có dòng
`Crew-Docs-Init: true` ở bất kỳ đâu trong message. Nó được miễn R3 và R6. Trailer được tìm trên mọi dòng nên vẫn
nhận ra sau rebase hoặc squash. Không có cách bỏ qua nào khác. Lịch sử trước commit docs-init không bị kiểm tra.

### Chế độ

| Lệnh | Dùng ở | Kiểm tra |
|------|--------|----------|
| `check --staged` | pre-commit | Chỉ R7 trên diff staged, để commit luôn nhanh; luật docs chạy lúc push |
| `check --commit-msg <file>` | commit-msg | R6 với trailer của message; miễn cho commit docs-init có trailer |
| `check --range <base>..<head>` | CI, cổng merge/trước khi push | R1, R2, R4 tại `<head>`; R3 trên toàn range; R6, R7 cho từng commit không phải merge |
| `check --pre-push` | pre-push | Như `--range` cho mỗi ref git sắp push (đọc từ stdin); nhánh mới thì kiểm tra mọi commit chưa có trên remote |
| `check --all` | CI, docs-init | R1, R2, R4 trên working tree (kể cả file chưa track mà không bị ignore) |

`--staged`, `--commit-msg` và `--pre-push` là các chế độ chạy trong git hook cục bộ (xem R5): trong repo chưa
khởi tạo docs, chúng không kiểm tra gì và cho qua với một cảnh báo, để chủ dự án vẫn commit/push được trước
docs-init. `--all` và `--range` luôn báo `NOT_INITIALIZED` khi thiếu manifest, vì daemon dùng `--all` để phát
hiện lúc nào cần chạy ticket docs-init, còn CI và cổng trước khi push của PM dùng `--range`.

Commit merge được bỏ qua ở R3 và R6 (kể cả khi kết thúc một `git merge` qua hook) vì các commit nó mang vào đã
được kiểm tra riêng. R1, R2, R4 tại head và R7 vẫn chạy.

### Kết quả

- Mỗi vi phạm một dòng trên stdout: `RULE path: thông báo và cách sửa`, thêm ` [commit abc1234]` ở chế độ range.
- Dòng tóm tắt trên stderr: `crew-docs check --<mode>: ok` hoặc số vi phạm; ở chế độ hook khi repo chưa khởi
  tạo docs thì thay bằng một dòng cảnh báo duy nhất (`cảnh báo: repo chưa có docs/flows.yaml nên chưa kiểm
  tra chuẩn docs (áp dụng từ commit docs-init)`).
- Exit code: `0` đạt (kể cả trường hợp cảnh báo trên ở `--staged`/`--commit-msg`/`--pre-push`), `1` có vi
  phạm, `2` sai tham số hoặc lỗi git, `3` chưa khởi tạo (`NOT_INITIALIZED`, chỉ ở `--all`/`--range`).

## 6. Lệnh tra cứu cho agent

- `crew-docs where <file>`: mỗi flow sở hữu file một dòng `<flow-id>\t<vai trò>\t<doc>\t<tên>` (vai trò:
  `entrypoint`, `file`, `test`, `shared`), hoặc `unassigned\t<lý do>`. Exit 1 khi file nguồn chưa thuộc flow nào.
- `crew-docs flow <id>`: tên, doc, entrypoints, files, tests và các file shared của flow. Exit 1 khi không có flow.

Quy trình đọc: `docs/index.md` → `crew-docs flow <id>` hoặc `crew-docs where <file>` → `docs/flows/<id>.md` →
các file được liệt kê.

## 7. Hook và CI

- `crew-docs install-hooks [--runtime <đường dẫn tuyệt đối>] [--bundle <đường dẫn tuyệt đối>]` chạy một lần
  trong main checkout. Nó lưu runtime (node, hoặc binary app desktop chạy với `ELECTRON_RUN_AS_NODE=1`) và bundle
  vào git config cục bộ `crew-docs.runtime` và `crew-docs.bundle`, nên hook không phụ thuộc PATH và file hook
  được commit giống nhau trên mọi máy.
  - Repo chưa có hook manager: đặt `core.hooksPath=.githooks` và viết `.githooks/pre-commit`,
    `.githooks/commit-msg`, `.githooks/pre-push`.
  - Có husky, lefthook, `core.hooksPath` riêng hoặc hook sẵn trong `.git/hooks`: thêm một dòng có marker
    `# crew-docs:<hook>` (hoặc một command `crew-docs` trong lefthook) mà không thay các hook đang có.
  - Chạy lại không đổi gì. Worktree dùng chung git config và hook của repo.
  - Thiếu cấu hình runtime thì hook thất bại (fail closed) với thông báo chỉ rõ.
- `crew-docs ci-workflow` viết `.github/workflows/crew-docs.yml` (chạy `check --range` và `check --all` khi push
  và PR) và chép bundle vào `.github/crew-docs/crew-docs.cjs` để CI không cần mạng.

## 8. Checklist docs-init

1. Điền `AGENTS.md`; `CLAUDE.md` chỉ có `@AGENTS.md`.
2. Viết `docs/index.md` và `docs/architecture.md`.
3. Chỉnh `source.include` / `source.exclude`.
4. Mỗi flow: `crew-docs init --flow <id> --title "<tên>"`, viết trang, khai báo trong `flows.yaml`.
5. Đưa mọi file nguồn vào flow, `shared` hoặc `unassigned`.
6. `crew-docs generate`; `crew-docs check --all` phải đạt.
7. `crew-docs install-hooks` rồi `crew-docs ci-workflow`.
8. Commit tất cả trong một commit có trailer `Crew-Docs-Init: true`.
