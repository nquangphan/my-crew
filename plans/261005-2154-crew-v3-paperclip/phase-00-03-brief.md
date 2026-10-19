# 00-03 — Fork checkout và baseline hẹp

Source authority: [baseline](baseline.md), [core review](phase-00-core-review.md), [ledger](progress.md), [tro-ly-pm](../../.agents/skills/tro-ly-pm/SKILL.md). Task setup/baseline, chưa remote prototype và chưa sửa source behavior.

## Ownership / interface

- Code checkout: `/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-v3`; expected actual fork https://github.com/nquangphan/crew-paperclip; code branch `v3` tại fullSHA8f8a0ab7effbd6a0584107d8038736c134ee5047. PM serialize clone/remote/branch bootstrap trước dispatch.
- Worker sở hữu `phase-00-03-report.md` trong primary plan folder và setup artifacts ở fork checkout. Không author Markdown ngoài primary plans/docs; upstream files downloaded/read không phải note mới. Không source/lockfile/hook/credential changes, push, agents hoặc commit trong setup task.
- Trước lệnh đọc upstream AGENTS và doc/GOAL.md,PRODUCT.md,SPEC-implementation.md,DEVELOPING.md,DATABASE.md từ pinned checkout; dùng CodeGraph nếu có, không tự index.
- Score6=1+U2+C2+I1. Model actual `gpt-6-astra` high thay planned standard để giữ worker core đang biết source/adapter seams cho00-04 khó9; ghi tier giữ context, không giả follow-up đổi model. Chưa đo token tiết kiệm.

## Setup và acceptance

1. Verify branch/remotes/full SHA/license/toolchain/lockfile SHA từ baseline. Không đổi primary Crew branch/origin, không chạm source v2. Nếu candidate dirty/version mismatch, báo PM trước install.
2. Node24.14.0 hiện đáp ứng >=24.11; root pnpm10.32.1 không đáp ứng pin. Dùng corepack trong cwd fork để lấy **pnpm9.15.4** từ packageManager, kiểm version trước install. Không thay global pnpm hoặc package manifest để che mismatch.
3. Resource admission riêng cho một dependency install; đo peak với time/resource evidence nếu có. Cài frozen lockfile bằng toolchain pinned. Chạy postinstall theo source đã đọc, không ignore-scripts để giả baseline đạt. Không broad native/full suite trong lượt này; Rust1.97.1 chưa xác minh có local toolchain.
4. Chạy source-defined workspace-link preflight và plugin SDK ensure-build-deps. Nếu cần build chỉ dependency closure TypeScript của selected SDK/server adapter loader, không tự chạy native/full build.
5. Chạy existing loader baseline scoped package cwd: `corepack pnpm --filter @paperclipai/server exec vitest run src/adapters/plugin-loader.test.ts`. Log command/exits/testcounts/skips/output; không report all tests PASS. Nếu path/script thực khác thì ledger evidence trước đổi command.
6. Report actual source/runtime/pnpm/fullSHA, lockfile unchanged, dependency size/peak/process cleanup, commands/tests/failures. Missing Rust/full baseline tests là pending rộng, không giả00-03 là Phase00 acceptance.

## Failure / continuation

Install/test failure triage rõ network, engine, dependency linking hay baseline behavior; không bịa type/SDK signature hoặc patch source chỉ để test xanh. Scoped setup fixes được phép nếu không đổi source/lock/policy; source fix cần task riêng với failingtest/review. No DB/ports/provider secret access trong00-03. Không nâng/fetch mutable latest thay pin.

Sau review task này: worker core tiếp tục00-04 với exact adapter factory/types/workspace/auth gate đã biết, thiết kế meaningful failing contracts và real outbound process proof. Package port/destination freeze trước worker reuse copy pure policies. Giữ một scheduler authority; token absent là failclosed khi API capability cần token.
