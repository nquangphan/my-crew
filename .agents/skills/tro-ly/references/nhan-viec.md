---
name: nhan-viec
description: Biến một câu yêu cầu của Đại Ca thành kế hoạch chạy được — cân độ lớn, chọn đường Superpowers, chốt chỗ chưa rõ, chọn model.
code: NV
added: 2026-10-06
type: prompt
---

# Nhận việc

Đây là **lúc duy nhất** bạn được phép làm phiền Đại Ca. Sau bước này bạn im mà làm.

Đích đến là một kế hoạch mà **chính bạn ở bước `dieu-linh` đọc là chạy được ngay**, lúc đó Đại Ca không còn trong phòng nữa. Mọi thứ mơ hồ còn sót lại sẽ thành phán đoán của bạn giữa chừng — và phán đoán giữa chừng là chỗ đẻ ra việc làm lại.

## Hỏi khi Đại Ca chưa nói mong muốn

Đại Ca thường nói *cái gì*, ít khi nói *tới đâu là đủ*. Thiếu chỗ nào thì hỏi ngay, gọn, gộp một lượt — đừng hỏi nhỏ giọt từng câu. Nhưng **đừng hỏi thứ tự tra được**: file nào, flow nào, bảng nào, đã có gì rồi — tra `docs/index.md`, `crew-docs where`/`flow`, kế hoạch đang chạy trong `plans/` và repo trước, chỉ hỏi cái repo không trả lời được.

Đoán được và đoán sai không tốn gì thì cứ đoán, nói rõ mình đang đoán, rồi làm tiếp. Chỉ chặn lại khi đoán sai làm hỏng việc.

## Cân độ lớn — chọn đường Superpowers

| Đường | Khi nào | Chuỗi skill |
|---|---|---|
| **Đủ** | Đụng từ 2 package/app trở lên, **hoặc** schema/migration, **hoặc** auth/phân quyền, **hoặc** hook lõi Paperclip / execution policy / scheduler, **hoặc** hợp đồng công khai (API, giao thức gateway, luật `crew-docs`) | `superpowers:brainstorming` → spec ở `docs/superpowers/specs/` → `superpowers:writing-plans` → plan ở `plans/<yymmdd-hhmm>-<slug>/` → `superpowers:using-git-worktrees` → `superpowers:subagent-driven-development` → `superpowers:requesting-code-review` → `superpowers:verification-before-completion` → `superpowers:finishing-a-development-branch` |
| **Gọn** | Một package, không chạm các thứ trên, đã có khuôn để bám | Một agent theo `superpowers:test-driven-development` → một reviewer độc lập → `superpowers:verification-before-completion` |
| **Lỗi** | Có triệu chứng mà chưa biết nguyên nhân | `superpowers:systematic-debugging` trước, chứng minh nguyên nhân rồi mới chọn đường Gọn hay Đủ để sửa |

Ranh giới này là để **tiết kiệm**, không phải để làm cho long trọng. Việc nhỏ mà kéo cả brainstorm-spec-plan thì Đại Ca đợi lâu vô ích; việc lớn mà giao thẳng thì không ai review, và nó sẽ quay lại thành bug.

Brainstorming là bước **có Đại Ca trong phòng** — nó thuộc về lúc nhận việc này, không phải giữa lúc điều lính. Gộp câu hỏi của brainstorming vào cùng lượt hỏi ở trên.

## Chọn model

| Việc | Model |
|---|---|
| Ghi doc flow, đổi chuỗi, quét/đối chiếu số, sửa fixture, edit cơ học có spec đầy đủ | `haiku` |
| Bám khuôn có sẵn: thêm endpoint/route, component giống cái đã có, test cho code đã rõ | `sonnet` |
| Hook lõi Paperclip, execution policy, scheduler/claim · schema/migration · auth/phân quyền · SSH/Tailscale/process lifecycle trên Mac · luật `crew-docs` dùng chung · lượt review cuối toàn nhánh | `opus` |
| Kẹt thật (2 lần sửa hỏng, hoặc ngã rẽ thiết kế rủi ro cao) | Hỏi `kongming` (chạy `fable`), không đổi model của cả phiên |

Cân **theo thứ việc chạm vào**, không theo cảm giác khó. Một dòng hook trong `issues.ts` của Paperclip vẫn là `opus`, vì nó chặn mọi lần ghi issue.

Chạy trên Codex thay vì Claude Code thì dùng tier tương ứng (nhanh/chuẩn/mạnh) theo allowlist thật của máy, ghi đúng model ID.

## Kế hoạch giao ra

Đủ để bước sau chạy không cần hỏi lại: làm gì, chạm file/package/flow nào, đi đường nào, model nào cho từng chặng, nghiệm thu bằng cổng nào (`nghiem-thu`), và **điều gì bạn đang giả định**.

Đường Đủ thì kế hoạch chính là plan của `writing-plans`; đường Gọn thì vài dòng trong tin nhắn giao việc là đủ — đừng đẻ file plan cho việc mười phút.

Ghi giả định ra thành chữ. Giả định không ghi là giả định sẽ bị quên, rồi sau này không ai truy được vì sao làm thế.
