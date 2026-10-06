# Hook git và CI của crew-docs

> Flow `docs-hooks`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow docs-hooks` in ra
> đúng danh sách đó.

## Mục đích

Gắn `crew-docs check` vào git hook cục bộ (pre-commit, commit-msg, pre-push) của một repo mà không phá hook
manager đã có (husky, lefthook, `core.hooksPath` riêng), và sinh workflow GitHub Actions chạy lại luật R1–R7
trên push/PR với bundle vendor sẵn (CI không cần mạng).

## Điểm vào

- `packages/docs-kit/src/commands/install-hooks.ts` → `installHooksCommand` (lệnh `crew-docs install-hooks`).
- `packages/docs-kit/src/commands/ci-workflow.ts` → `ciWorkflowCommand` (lệnh `crew-docs ci-workflow`).

## Các bước

1. `packages/docs-kit/src/commands/install-hooks.ts` → `installHooksCommand()`: gọi `installHooks()`, in kiểu
   hook đã phát hiện, đường dẫn runtime/bundle, danh sách file đổi và ghi chú.
2. `packages/docs-kit/src/hook-installer.ts` → `installHooks()`: chặn nếu chạy trong worktree phụ
   (`isLinkedWorktree`, phải chạy ở main checkout vì worktree dùng chung git config); lưu đường dẫn tuyệt đối
   của runtime và bundle vào git config cục bộ (`RUNTIME_KEY='crew-docs.runtime'`,
   `BUNDLE_KEY='crew-docs.bundle'`) — nên hook không phụ thuộc PATH và giống nhau trên mọi máy.
3. `packages/docs-kit/src/hook-installer.ts` → `detectHookSetup()`: phát hiện cấu hình hook đã có theo thứ tự
   — husky (`.husky/` hoặc `core.hooksPath` trỏ vào đó), file config lefthook, `core.hooksPath` tuỳ chỉnh khác,
   hook thô có sẵn trong `.git/hooks`, mặc định `.githooks/` nếu chưa có gì.
4. Trường hợp `githooks`/`hooks-path`/`git-hooks-dir`/`husky`: `ensureShellHooks()` →
   `withHookLine()` chèn đúng một dòng có marker `# crew-docs:<hook>` ngay sau shebang của mỗi file
   `pre-commit`/`commit-msg`/`pre-push`, thay dòng crew-docs cũ nếu có, giữ nguyên phần còn lại của hook.
   Trường hợp `lefthook`: `withLefthookCommands()` thêm một command `crew-docs` vào từng hook trong YAML
   (giữ comment và command khác), rồi chạy `lefthook install` nếu tìm thấy binary.
5. `packages/docs-kit/src/hook-installer.ts` → `hookLine()`: dòng lệnh thật sự chạy —
   `ELECTRON_RUN_AS_NODE=1 "$(git config --get crew-docs.runtime || echo …not-configured)" "$(git config
   --get crew-docs.bundle || echo …not-configured)" check --staged|--commit-msg "$1"|--pre-push "$@" || exit 1`
   — máy chưa cấu hình sẽ fail closed với thông báo rõ đường dẫn thiếu. Ba chế độ này (flow `docs-check`) tự
   nhận ra repo chưa có `docs/flows.yaml` (luật R5) và cho qua với một dòng cảnh báo (exit 0) thay vì chặn, nên
   hook cài xong trước docs-init không khoá chủ dự án lại; từ commit docs-init thì check chạy đầy đủ như mọi
   repo khác.
6. `packages/docs-kit/src/commands/ci-workflow.ts` → `ciWorkflowCommand()`: ghi
   `.github/workflows/crew-docs.yml` từ `TEMPLATES.ciWorkflow` (chỉ ghi khi nội dung khác), và vendor bundle
   đang chạy vào `.github/crew-docs/crew-docs.cjs` (so sánh byte, chỉ copy khi khác) — CI chạy `check --range`
   rồi `check --all` bằng bản vendor này, không tải gì từ mạng.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/docs-kit/src/commands/install-hooks.ts` | Lệnh `install-hooks` | `installHooksCommand` |
| `packages/docs-kit/src/commands/ci-workflow.ts` | Lệnh `ci-workflow` | `ciWorkflowCommand`, `WORKFLOW_PATH`, `VENDORED_BUNDLE_PATH` |
| `packages/docs-kit/src/hook-installer.ts` | Phát hiện + cài hook, dòng lệnh hook | `installHooks`, `detectHookSetup`, `hookLine`, `withHookLine`, `withLefthookCommands` |
| `packages/docs-kit/templates/crew-docs.yml` | Template workflow GitHub Actions | — |

## Dữ liệu

- Bảng: không.
- Sự kiện: không.
- Gọi ngoài: `git config` cục bộ (lưu đường dẫn runtime/bundle), tuỳ chọn gọi binary `lefthook install`; không
  gọi mạng.

## Flow liên quan

- docs-check: hook và CI ở đây chỉ là lớp gọi `crew-docs check` (flow `docs-check`) đúng chế độ đúng thời
  điểm; dùng chung `TEMPLATES`, `getConfig`/`setLocalConfig`/`isLinkedWorktree` từ `git.ts`.

## Tests

- `packages/docs-kit/test/hook-installer.test.ts`: phát hiện đúng loại hook (`githooks`, husky, lefthook,
  `hooks-path` tuỳ chỉnh), chèn/dòng thay thế đúng marker mà không phá hook có sẵn, chạy lại không đổi gì,
  chặn khi chạy trong worktree phụ, lefthook YAML giữ nguyên cấu trúc; hook cho chủ dự án commit và push trước
  docs-init (đúng một dòng cảnh báo), rồi từ commit docs-init trở đi lại chặn đúng như thường: pre-commit
  chặn credential (R7), commit-msg chặn đường dẫn được bảo vệ (R6), pre-push chặn thiếu docs (R3).
