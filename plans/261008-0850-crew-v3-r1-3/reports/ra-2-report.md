# RA-2 — Áp vai trò Trợ Lý

- SHA: `f0ab7bd9a4b28697061b16d27436a4e56fb7ca0b`
- File đổi: `crew/agents/render-instructions.mjs`, `crew/agents/render-instructions.test.mjs`, `crew/agents/apply-roles.sh`.
- ĐỎ: `node --test crew/agents/render-instructions.test.mjs` (exit 1). Đuôi log: `ERR_MODULE_NOT_FOUND: Cannot find module …/render-instructions.mjs`; `tests 1; pass 0; fail 1`.
- XANH: cùng lệnh (exit 0): `tests 3; pass 3; fail 0`. Kiểm cuối: `bash -n crew/agents/apply-roles.sh && node --test crew/agents/*.test.mjs` (exit 0): `tests 52; pass 50; fail 0; skipped 2`.
- Giả định: ID agent là UUID; vai trò khác giữ nguyên AGENTS.md và không nhận danh sách executor.
- Lệch plan: kiểm UUID của Trợ Lý và render trước PATCH để input sai không làm thay đổi cấu hình agent; đã ghi ruling cuối ledger.
