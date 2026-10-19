---
name: nghiem-thu
description: Các cổng kiểm không biết nói dối. Chạy một lần ở bước tích hợp, trước khi được phép nói "xong".
code: NT
added: 2026-10-06
type: prompt
---

# Nghiệm thu

Đại Ca sẽ **hành động** dựa trên chữ "xong" của bạn — merge, nâng Paperclip, đi làm chuyện khác. Nên chữ đó phải có bằng chứng đứng sau.

Năng lực này tách riêng vì nó là thứ **dễ bỏ qua nhất**: lúc test đã xanh, mọi thứ *có vẻ* đã xong, và chạy thêm cổng nữa thấy như thừa. Đúng lúc đó nó không thừa.

Nghiệm thu chạy **một lần ở bước tích hợp** cho cả yêu cầu, trên tree đã merge — không phải sau mỗi task. Test từng task là việc của implementer và đã được reviewer đọc log (xem `dieu-linh` §Test theo tầng).

## Vì sao test xanh không tính

Test unit chạy mã nguồn trong bộ nhớ, với fixture và mock. Nó không chạy thứ thật sự được dùng: bundle đã build, server thật với DB thật, trình duyệt thật, agent thật trên Mac. Năm con bug đắt nhất ở dự án trước của Đại Ca đều lọt qua test xanh và không con nào sống nổi qua các cổng dưới đây. Xanh là điều kiện cần, chưa bao giờ là điều kiện đủ.

## Các cổng

Chọn cổng theo thứ đã đổi. Cổng nào không áp dụng thì **nói rõ là không áp dụng và vì sao** — đừng lặng lẽ bỏ qua rồi vẫn nói "xong".

**Cổng 1 — thứ thật sự chạy khởi động được.** Build ra đúng artifact người dùng chạy rồi chạy nó:
- `packages/docs-kit`: `pnpm --filter @crew/docs-kit build`, rồi chạy bundle qua đúng đường git hook dùng (`git config --get crew-docs.bundle`) trên repo thật — hook không chạy TypeScript.
- Fork Paperclip (`.worktrees/paperclip-v3`): `corepack pnpm --filter @paperclipai/server typecheck`, rồi `corepack pnpm dev:once` và chờ API ở cổng 3100 trả lời.
- `apps/*` của Crew: build rồi start với biến môi trường thật theo `apps/api/.env.example`.

**Cổng 2 — API thật đối chiếu DB thật.** Gọi endpoint, rồi truy vấn thẳng DB, so hai con số. Không so với mock hay fixture. DB của Crew ở `127.0.0.1:55432`; DB của Paperclip là embedded Postgres của instance đang chạy. Với gate execution policy: thử chuyển `done` qua API bằng token agent, rồi đọc `issue_execution_decisions` và trạng thái issue trong DB.

**Cổng 3 — trình duyệt thật trên local.** Playwright bấm thật: `pnpm --filter @crew/web test:e2e` cho web Crew, hoặc Playwright MCP trên UI Paperclip local. Mở trang, bấm nút, đọc console. Không bấm trên dữ liệu production.

**Cổng 4 — chạy thật trên Mac (v3).** Đổi gì chạm đường thực thi (SSH environment, adapter, workspace `in_place`, hook claim/cancel) thì tạo một issue thật, để agent chạy trên Mac qua SSH, rồi kiểm: commit xuất hiện trong repo trên Mac, file chưa commit của Đại Ca còn nguyên, log/kết quả hiện đúng issue, không còn process mồ côi.

**Cổng 5 — docs khớp code.** `crew-docs check --range <base>..HEAD` đạt trên nhánh tích hợp: mọi file nguồn đổi đều có trang flow được sửa trong cùng lần push.

## Những thứ dễ tự lừa

**Đọc nhầm bản.** Bundle `crew-docs` cũ, server chưa restart, tab trình duyệt còn cache — đều cho ra kết quả của code cũ. Kiểm đúng artifact vừa build, đúng process vừa khởi động.

**Lỗi hỏng trễ.** Có thứ vẫn xanh ngay sau khi chạy rồi mới hỏng — lease hết hạn, reaper dọn run sau timeout, kết nối Tailscale rớt giữa chừng. Kiểm ngay sau khi bấm không đủ; phải hỏi "thứ này còn đúng sau khi hết lease / sau khi server restart không".

**Thứ tự giữa các tiến trình của Paperclip.** Test DB dựng thứ tự theo ý người viết test; máy thật thì không. Ở R1-2, cả 4/4 lần chuyển stage trên Mac mini đều kẹt vì route đánh thức agent kế tiếp trước khi lease nhả ~1 giây — mọi test đều xanh. Cổng 4 phải đo **từng lần chuyển stage** (giờ wake, skip, lease release, run mới) và chạy luồng tự đi, **không** đánh thức tay bằng comment owner rồi tính là đạt.

**Agent thật làm trái instructions.** Lần đầu AC-2 dùng haiku: executor commit sai nhánh, integrator tự `PATCH in_progress`. Gate server phải chặn được cả khi agent sai; instructions chỉ là lớp ngoài.

## Đỏ thì nói đỏ

Không nói "xong nhưng còn chút", không nói "về cơ bản là chạy". Nói đỏ ở đâu, dán nguyên văn lỗi, rồi nói bạn định làm gì tiếp.

Báo hỏng sớm thì Đại Ca còn xoay được. Báo hỏng muộn vì lúc đầu tô hồng thì Đại Ca mất cả buổi.
