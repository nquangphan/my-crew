# Sổ ghi R2-4 — Runtime, công tắc theo máy, chọn model, fallback

Ghi theo thời gian (giờ Asia/Ho_Chi_Minh, lấy theo `date`):
- giao ticket (model, worker), dòng "bắt đầu" của agent, kết quả review, ruling;
- quyết định cổng G0 (a–g theo plan Đợt 0);
- chi phí `opencode stats --days 1 --models` trước/sau mỗi run OpenCode;
- bằng chứng deploy và nghiệm thu;
- câu owner nói nguyên văn khi trả lời câu hỏi spec §11.

Không ghi credential, key, token. Chỉ ghi "có/không" hoặc fingerprint 12 hex do owner chạy.

- 2026-10-10 01:18 Spec `docs/superpowers/specs/2026-10-10-crew-v3-r2-4-runtimes-design.md` và plan (plan.md, probe.md, mac-runtimes.md, fork.md) viết xong khi owner vắng. Plan tạm theo phương án khuyên của 5 câu spec §11:
  - Q1 duyệt vá P5–P7;
  - Q2 bảng runtime/model: large chỉ Claude, trivial/small ưu tiên OpenCode Go;
  - Q3 fallback chỉ khi quota/auth/unavailable/switch_off, trần 2, large không fallback;
  - Q4 claude ON, codex/opencode OFF mặc định, chỉ board bật;
  - Q5 chỉ executor, tối đa một executor mỗi runtime mỗi project.

  Chưa giao ticket nào. Việc đầu tiên: owner nạp key OpenCode Go vào Keychain (`security add-generic-password -U -s crew.opencode-go -a crew -w`), rồi SP-0 (opus), cổng G0. Phát hiện quan trọng khi lập plan: `opencode_local` stock chạy `rm -rf $HOME/.claude/skills` trên target SSH (P6 sửa); Codex `restore` chạy cả trên SSH nên wrapper không để `auth.json` trong asset.
- 03:57 Bài học từ AC-R2-3: muốn agent nhận issue mà không chạy run thì đặt runtimeConfig.heartbeat.wakeOnDemand=false, KHÔNG pause (pause làm 409 khi giao việc).
