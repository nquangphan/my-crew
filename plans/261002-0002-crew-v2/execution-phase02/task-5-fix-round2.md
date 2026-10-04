# Task 5 — fix round 2, C1 acceptance

## Kết quả

Đã thêm một integration test cho verifier attestation append-only liên kết exact ID của reported artifact và terminal result gốc. Đây là fixture kiểm thử đọc DB trong transaction, không phải verifier production hay quyền `verified` từ machine/client. Không đổi source, migration, authority, app hoặc gateway. R1–R4 đã được re-review xác nhận addressed; vòng này chỉ đóng khoảng trống C1 trong acceptance.

## Bằng chứng C1

Test `append-only verifier attestation linked to original reported evidence advances persisted passed result after pool restart` trong `v2/server/test/attempts.test.ts` thực hiện chuỗi sau:

1. Claim attempt, tạo `artifact` evidence có `verification='reported'`, locator/SHA-256/source commit, rồi gửi `outcome:'passed'` với `evidenceIds:[originalId]` qua journal key `original-passed-result`. Response bền vững ban đầu có state `active`.
2. Ghi stop observation. Verifier fixture truy vấn DB theo `attemptId`, `ticketId`, original evidence ID, loại evidence, metadata và liên kết `originalEvidenceId`. Khi chưa có attestation, recheck giữ `finalizing` và guard vẫn trỏ attempt.
3. Append một `research_result` verified cùng ticket/attempt nhưng liên kết sai original ID. Recheck vẫn `finalizing`, guard chưa giải phóng. Điều này chứng minh có hàng verified đúng loại vẫn không đủ nếu liên kết sai.
4. Append hàng attestation thứ hai với exact original ID và metadata trùng reported evidence; không UPDATE hàng reported hay `terminal_result`. Mỗi insert autocommit, sau đó đóng writer pool.
5. Mở pool mới, gọi recheck bằng journal key mới `attested-recheck` trên cùng attempt/fence/process và verifier đọc DB trong transaction. Ticket thành `done`, attempt `stopped`, guard null, đúng một event `attempt.finalized`. Chỉ có một stop observation; verifier attestation là hàng evidence riêng, không phải stop proof.
6. So sánh JSONB text của reported evidence và `terminal_result` trước/sau, giữ nguyên evidence ID và fence. Replay key result cũ từ pool mới trả đúng cached response `active`, không chạy work và không giả làm trạng thái hiện hành `stopped`.

Test fixture dùng trực tiếp bảng `evidence` hiện có để mô phỏng attestation tin cậy. Production `verifyFinalResult` vẫn fail closed; Phase 08 phải cung cấp verifier receipt thật. Hash/locator do machine báo cáo vẫn chỉ là dữ liệu reported.

## Kiểm tra

- `pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/attempts.test.ts`: 27/27.
- `pnpm --dir v2/server typecheck`: pass.
- `pnpm exec biome check v2/server/test/attempts.test.ts`: pass sau format.
- `git diff --check`: pass.

Không lặp full server 127-test suite vì vòng này chỉ thêm test/docs, không sửa production code. Fixture dùng PostgreSQL Docker riêng, tạo và xóa logical DB; writer/reader pool trong test đều đóng. Không stage/commit hoặc tác động DB/dịch vụ chung.

Files: `v2/server/test/attempts.test.ts`, R3 docs `v2/docs/flows/server-execution.md`, báo cáo này.
