# UP-3 — Sửa F1–F4 từ review UP-2

Ngày 09/10/2026 (Asia/Ho_Chi_Minh). Worktree `/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-sync-1005`, chỉ sửa `crew/**`.

## F1 (major) — upload AGENTS.md cần base
- Hợp đồng đọc từ `server/src/routes/agents.ts:5193-5221` và `packages/shared/src/validators/agent.ts:36-42`: entry file cần `baseHash` (64 hex, hoặc `null` khi file chưa có) hoặc `baseRevisionId`; body `.strict()`. GET `…/instructions-bundle/file?path=AGENTS.md` trả `contentHash`.
- Thêm `crew/agents/add-base.mjs`: đọc phản hồi GET, thêm `baseHash`. Lỗi "not found" thì `null`; lỗi khác hoặc thiếu hash thì dừng (không đoán).
- `crew/agents/apply-roles.sh` (nhánh `agent`): GET file hiện tại trước, PUT **trước**, PATCH extraArgs **sau**. GET hoặc PUT lỗi thì chưa ghi gì vào extraArgs; PATCH lỗi sau PUT thì chạy lại an toàn (nội dung giống trả `changed:false`).
- Test: `crew/agents/add-base.test.mjs` (4), `crew/agents/apply-roles.test.mjs` (4; server mock đúng hợp đồng: thiếu base thì 422 `INSTRUCTION_BASE_REQUIRED`, có base thì 200, body strict; kiểm thứ tự PUT trước PATCH, file chưa có, và GET lỗi thì không PUT/PATCH).
- Commit `e9591724b`.

## F2 (minor) — không ghi sau PATCH chuyển stage
- Cả 4 vai trò: thêm mục "Không bao giờ" về ghi sau PATCH chuyển stage (403 `agent_run_cancelled`), PATCH là lệnh ghi cuối, 422 thì dừng run.
- `integrator.md`: bỏ "ghi lại bằng chứng rồi PATCH một lần nữa" và "sửa thứ tự đăng một lần"; bước 8 stage 4 kiểm thứ tự `crew-merge` trước khi PATCH, 422 thì dừng. `reviewer.md`, `executor.md`, `assistant.md`: bỏ chỉ dẫn comment sau 422 của PATCH quyết định/done.
- Test (`instructions.test.mjs`): 3 test chuỗi (quy tắc có ở cả 4 vai trò, integrator không còn câu cũ và bằng chứng/`crew-merge` đứng trước PATCH, reviewer/executor/assistant).
- Commit `40ad77859` (chung với F3 vì cùng các file).

## F3 (minor) — PUT title
- Cả 4 vai trò: cấm `PUT /api/issues/<id>/title`; cần đổi tiêu đề thì `PATCH /api/issues/<id>` với `title`. Đã kiểm: `PATCH /api/issues/:id` có trong allowlist (`sandbox-callback-bridge.ts:170`), `updateIssueSchema` là partial của `createIssueBaseSchema` (có `title`).
- Test: 2 test chuỗi (cấm PUT + dùng PATCH title; allowlist có PATCH, không có PUT title, đọc từ nguồn bridge).
- Commit `40ad77859`.

## F4 (minor) — verify.sh
- Thêm `run 3 node --test crew/release/upgrade.test.mjs crew/ops/compose-set-image.test.mjs crew/ops/pull-backup.test.mjs`; `pnpm install` thành `--frozen-lockfile`. Các `crew/**/*.test.mjs` còn lại đã có sẵn trong verify (check-core-hooks, plugin-state, policy-config ops, `crew/agents/*`); 11 file, không sót.
- Commit `6b8b75a7d`.

## Chạy
- `node --test crew/agents/*.test.mjs crew/ops/*.test.mjs crew/release/*.test.mjs`: 113/113 pass. `bash -n` apply-roles.sh và verify.sh đạt.
- `crew/release/verify.sh` (load 9.03, `ipcs -m` 5 segment): XANH, exit 0, cây sạch. Hai lần trước đỏ ở `roots.data.test.ts` (embedded Postgres quá timeout 5s khi chạy song song với load 10-11; chạy riêng 3s và pass 3/3). Không liên quan thay đổi này (không đụng plugin).

Status: DONE_WITH_CONCERNS
Summary: F1-F4 đã sửa, test mới xanh, verify.sh XANH ở lần chạy thứ ba.
Concerns/Blockers: `roots.data.test.ts` flaky khi load máy > ~10 (timeout 5s mặc định của vitest với embedded Postgres); nên nâng timeout test đó ở lượt riêng. Chưa chạy apply-roles.sh thật trên server (chỉ mock đúng hợp đồng).
