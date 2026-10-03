# A1 — ADDRESSED

**SPEC: PASS cho FIX1 A1/A2. QUALITY: Approved trong phạm vi fix.** Không kết luận full T2 hoặc production acceptance.

## Finding verdicts

- **A1 — session revoked/expired trong authority lock wait: ADDRESSED.** `v2/server/src/assistant/routes.ts:28–38` khóa đúng session cookie hash với `owner_id='owner' FOR SHARE`, sau đó dùng statement riêng kiểm `revoked_at is null` và `expires_at>clock_timestamp()`. `routes.ts:77–78` gọi helper này sau authority locks và trước journal cache/work. `v2/server/src/assistant/authority.ts:66–69` prelock live-turn rows cho đúng trường hợp missing/retired/different designation; do đó reassignment không còn thêm một authority wait chưa được bao phủ sau credential check. Work lặp lại các row locks đang giữ, còn guard giữ identity/config ổn định. Session share lock giữ đến transaction kết thúc: revoke trước final check bị401, revoke đến sau phải chờ transaction. Expiry được đánh giá tại điểm authorization sau chờ, không dùng transaction-start time hoặc `options.now()` lấy trước chờ.
- **A2 — UUID casing sai identity: ADDRESSED.** `routes.ts:66` tạo input nội bộ với machineId chữ thường; `routes.ts:77,81` dùng cùng input đó cho authorization và mutation. `routes.ts:72` vẫn truyền nguyên `request.body` vào journal, nên không làm hai wire payload khác casing trở thành cùng idempotency body. Máy đúng casing được nhận, same-machine policy update không thành reassignment, revoked target vẫn bị chặn.

## Regression evidence

- `v2/server/test/assistant-authority.test.ts:431–504`: tám ca fresh/replay × guard/machine × revoked/expired chờ bằng actual PostgreSQL lock witness; invalidation xảy ra trước release blocker; HTTP401 và config/designation/idempotency không đổi.
- `assistant-authority.test.ts:508–568`: turn-expiry regression quan sát request chờ `assistant_turns`, có DB witness transaction bắt đầu trước expiry và wall clock đã qua expiry; sau blocker release, request bị401, không đổi config/designation/journal. Fixture chuyển turn stopped chỉ để kiểm lock ordering, không được dùng làm chứng nhận runtime stop.
- `assistant-authority.test.ts:571–614`: hai ca fresh/replay giữ request sau final authorization, quan sát UPDATE session bị chính request chặn; sau commit revoke hoàn tất và request sau bị401. Điều này chứng minh shared credential lock được giữ qua cả cache/work, không chỉ kiểm trạng thái hai lần.
- `assistant-authority.test.ts:617–664`: uppercase designation thành công; cùng raw body replay; đổi casing với cùng key trả409; revoked target ở cả casing bị404. Update cùng máy khác casing giữ designation ID/revision và running turn, chỉ tăng config revision theo hành vi hiện có.
- Raw RED credential-order ghi `revoked` thay `blocked`; raw turn RED ghi200 thay401 với lock/DB-time witness. Hai timeout quan sát khóa của lượt RED đầu không được tính làm semantic regression proof; report giữ rõ phân biệt này.
- Raw final GREEN ghi **19/19 PASS**, fail0/skip0, duration7213.031917ms, gồm sáu ca cũ và13 regression; không cộng số test từ nhiều lượt. Đã đọc raw output, không chạy lại.

## New breakage in fix diff

**Không tìm thấy Critical/Important/Minor mới.** Fix giữ nguyên thứ tự guard → machines → config → designation → conditional live turns, bổ sung exact session lock cuối; không có root/input lock muộn, không network trong transaction, không đổi frozen contracts, generic auth producer hoặc quyền admission. Condition prelock bao gồm retired designation đúng với hành vi `readAssistantConfig` trả designation null. Error tiếp tục propagate qua mutation transaction/Fastify; không có catch-swallow mới.

## Out-of-scope observations

Không mở finding mới ngoài fix. Full-server dependency/typecheck limits và các producer/native/app-mount/admission còn hoãn vẫn như vòng trước. Đã giữ nguyên ruling fresh-key save không bắt buộc giữ config revision. Không sửa plan/TODO hoặc task state.

## Checks và exact artifact identity

- Đã áp dụng `.agents/skills/subagent-driven-development/re-review-prompt.md`; đọc lại previous review và đọc đầy đủ `task-2-report.md`. Đọc fix diff đúng một lần, không đọc lại changed files hoặc regenerate Git diff; không hunk nào cần đọc bổ sung.
- Fix package: `task-2-slice-a-fix1-review-package.diff`, SHA256 **e63c117fda7bce4cfe0ff893c8e5a7e6c7b88b311d1dd81b386409a1db4c02c1**, khớp dispatch. Report SHA256 **54e2a8f41c979dec40c621fb15d09b4e66cd4b4ba4d76c9457a386e521a00ed6**, khớp dispatch.
- Source hashes đã đối chiếu trực tiếp: authority **9fea4d72fb779daba72d39fc748eb24ed6401301955b369944ccce1e4c5b19cf**; routes **7ee13c26003aaf83cdaf18a887a96e8580012a7925a7135b35d61cf25e292df1**; test **0366f1b7412c7534ec6b10ce25905d9116d6668fb6b7aecdb8839bf763711c90**.
- Frozen SQL011 **fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841** và contracts **adee25f453fa91e7498a1a300d3c7a4761147b8584e738a54818d9cb4b65412f** vẫn khớp.
- Cả12 raw FIX1 log hashes khớp bảng report. Final GREEN SHA **3c270ca7a7199f203793545503010159c42f47820a224df067bbb97be87506e4**. Scoped strict typecheck log rỗng SHA **e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855**; external-declaration `skipLibCheck` theo ruling cũ, không bỏ strict own source. Biome output `Checked 3 files in 30ms. Fixed 1 file.` diễn ra trước frozen final GREEN; không gọi đó là một lượt no-fix check mới.
- Đã đọc raw final cleanup SHA **e48df1889d94d8628506ae3a0cbb9722db4db537b6826cc56a8f30e440d472e7**: output PID/container chỉ còn header và bốn scratch roots ABSENT. Đây là bằng chứng cleanup đã lưu, không phải kiểm tra live của reviewer.
- Review hoàn toàn tĩnh: không Node/DB/build/dependencies/browser/Git/index/subagent; chỉ tạo file re-review này. Không sửa source hoặc file peer.

## Verdict

**Fix round: All findings addressed, no new Critical/Important breakage. A1 CLOSED; A2 CLOSED.** Đủ để PM tiếp tục gate Slice A trong phạm vi đã duyệt; không phải chứng nhận full T2/native/production.

**Câu hỏi chưa giải quyết:** Không có trong A1/A2 hoặc fix diff.
