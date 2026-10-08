# RA-1 — Instructions Trợ Lý

- SHA: `86a4d98bb3e5518ddd13e156febebf3c0d462987`
- File đổi: `crew/agents/assistant.md`, `crew/agents/instructions.test.mjs`.
- ĐỎ: `node --test crew/agents/instructions.test.mjs` (exit 1). Đuôi log: `Error: ENOENT: no such file or directory, open '…/crew/agents/assistant.md'`; `exit=1`.
- XANH: cùng lệnh (exit 0). Đuôi log: `tests 32; pass 30; fail 0; skipped 2; duration_ms 445.330709`.
- Giả định: đối chiếu `model-policy.ts` và `bundle-resume.ts` sẽ chạy trên nhánh tích hợp; hiện hai file chưa có trong worktree này nên hai test skip như plan.
- Lệch plan: đưa chú thích sau marker `crew-stack` và `crew-kind research` sang dòng riêng để dòng mẫu khớp regex; commit message dùng tiếng Anh theo luật chung.
