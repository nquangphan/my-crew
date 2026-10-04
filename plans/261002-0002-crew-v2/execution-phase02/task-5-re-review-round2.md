# Task 5 — final re-review C1

**READY: yes.** C1 đã được xử lý đúng yêu cầu. R1–R4 tiếp tục giữ kết luận addressed từ vòng trước; không mở lại các phần đó. Không phát hiện regression trong phần test/docs thay đổi.

## Phạm vi

Review riêng `a42e0a7..9dca04e`: test mới trong `v2/server/test/attempts.test.ts` và cập nhật `v2/docs/flows/server-execution.md`, đối chiếu `task-5-fix-round2.md`. Không thay production source, schema hay authority. Không chạy lại suite hoặc review toàn bộ source.

## C1 — Addressed

Test `append-only verifier attestation linked to original reported evidence advances persisted passed result after pool restart` kiểm chứng đúng đường còn thiếu:

- Tạo artifact reported thật qua service, gửi passed result tham chiếu original evidence ID qua journal. Durable response ban đầu là active.
- Verifier fixture truy vấn DB bằng transaction được truyền vào, đối chiếu ticket/attempt, original evidence ID, kind, reported/verified state và locator/SHA-256/sourceCommit. Không dùng boolean/counter trong closure để cho phép finalize.
- Khi thiếu attestation hoặc chỉ có verified row liên kết sai original ID, recheck giữ finalizing và guard còn nguyên. Verified row đúng loại nhưng sai liên kết không đủ cấp quyền.
- Attestation đúng được append thành evidence row riêng bằng insert autocommit. Writer pool được đóng trước khi mở reader pool mới và recheck qua journal key mới, cùng attempt/fence/process và terminal result đã lưu.
- Recheck bằng verifier đọc DB thật chuyển ticket done, attempt stopped, guard null và chỉ một finalized event. Original reported JSONB và terminal result giữ nguyên; fence không đổi; stop observation vẫn là bản ghi riêng duy nhất.
- Replay original result key qua reader pool trả đúng cached response active, không chạy lại work và không thay thế bằng trạng thái hiện hành stopped.

Docs đã phân biệt stop observation với verifier evidence attestation, nêu rõ đây là fixture và verifier production vẫn fail closed tới Phase 08. Không có đường nâng dữ liệu reported của machine thành verified trong production.

## Bằng chứng và giới hạn

Chấp nhận bằng chứng đã giao: targeted attempts 27/27, typecheck, Biome 1 file, diff/docs checks pass. Không lặp full server suite vì vòng này chỉ thêm test/docs; runtime R1–R4 và original probe đã được kiểm chứng ở vòng trước. Test mới dùng prefix 5, DB riêng và đóng cả writer/reader pool trong finally.

Không còn finding trong phạm vi Task 5 đã review. Kết luận READY cho tích hợp Task 5 không khẳng định Phase 03 process attestation, Phase 06 dispatch authority, Phase 08 receipt verifier hoặc Task 7 assembly đã hoàn thành. Handoff binding guard, transactional ACL trước replay và SSE reauthorization giữ nguyên như các báo cáo trước.
