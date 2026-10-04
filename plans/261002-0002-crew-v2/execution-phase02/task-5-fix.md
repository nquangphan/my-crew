# Task 5 — fix round 1

## Kết quả

Đã sửa cả bốn finding R1–R4 trong `task-5-review.md`. Không sửa migration, app assembly, manifest, gateway hay authority production; không stage/commit. Callback kiểm chứng dùng trong test chỉ thuộc fixture, mặc định production vẫn fail closed.

| Finding | Sửa hẹp | Bằng chứng |
|---|---|---|
| R1 page anchor microsecond | `listCommands` kiểm quyền anchor rồi so sánh `(created_at,id)` với hàng anchor ngay trong SQL, không đi qua JavaScript `Date`. | Hai lệnh queued có timestamp `.123456Z` và `.123457Z`, `limit=1` trả từng ID một, cursor kết thúc `null`; test completed anchor/poll từ `null` cũ vẫn pass. |
| R2 pause/cancel tái dùng lệnh cũ | Tái dùng command chưa ACK completed chỉ khi `ticket_id`, type, machine, binding revision và `payload.attemptId` đều khớp attempt giữ guard hiện tại. Không sửa payload command cũ. | Pause A, stop proof trước ACK, resume/claim B, pause B tạo command mới nhắm B; lặp pause B dùng lại chính command B. Checkpoint cũ của A bị `STALE_FENCE`. |
| R3 artifact sau lease | Attempt `active` có lease hết hạn trả `LEASE_EXPIRED` trước insert; guard vẫn giữ, không ghi state `uncertain` trong transaction bị rollback. Reconcile `running` gia hạn lease rồi mới ghi tiếp. Ngoại lệ `finalizing` vẫn nhận artifact trễ. | Evidence count không tăng khi lease hết; guard còn A; sau reconcile ghi được; finalizing dù lease cũ hết vẫn ghi được. Scoped durable replay sau finalize được test cũ bảo vệ. |
| R4 event wait_owner | Event của outer ticket mutation lấy `status` và `revision` từ row sau callback terminal intent. | `wait_owner` trước stop: response/DB/event đều `running`, guard còn A. Sau stop: response/DB/event đều `needs_input`, revision khớp, guard null và attempt stopped. |

Probe độc lập `/tmp/crew-task5-review-probe.test.ts` của reviewer đổi từ 4 failures ghi trong review thành 4/4 pass sau sửa: page tiếp theo là lệnh thứ hai, pause B nhắm B, artifact hết lease bị từ chối, event cuối `needs_input` revision 4. Đã xóa probe tạm sau khi ghi bằng chứng; fixture Docker tự dọn logical DB/container.

## Acceptance bổ sung

- Writer pool ACK đóng rồi reader pool mới replay cùng response từ DB; callback work không chạy lại, chỉ một event ACK.
- Hai pool độc lập tranh claim cho hai process ID: đúng một attempt/fence, process thắng replay từ pool còn lại.
- Stop và retry result đồng thời: đúng một verification, một event finalized, một lần giải phóng guard.
- Owner pause/cancel thắng passed result đã lưu: ticket thành paused/cancelled; verifier complete không chạy.
- Attestation stopped là bản ghi append-only qua đóng/mở pool; recheck đọc lại và finalize, observation vẫn đúng một bản ghi.
- Claim thực sự từ chối deploy chưa duyệt, predecessor chưa done và permit hết hạn trước khi callback authority test chạy; không tạo attempt hoặc chuyển ticket running.

## Kiểm tra cuối

- `pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/attempts.test.ts`: 26/26.
- `pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/commands.test.ts`: 9/9.
- `pnpm --dir v2/server test --test-file /tmp/crew-task5-review-probe.test.ts`: 4/4 trước khi dọn probe.
- `pnpm --dir v2/server test`: 127/127.
- `pnpm --dir v2/server typecheck`: pass.
- `pnpm exec biome check v2/server/src/execution/attempts.ts v2/server/src/execution/commands.ts v2/server/src/tickets/service.ts v2/server/test/attempts.test.ts v2/server/test/commands.test.ts v2/server/test/support/execution.ts`: pass, không warning.
- `git diff --check`: pass.

## Files thuộc fix

`v2/server/src/execution/{commands,attempts}.ts`, `v2/server/src/tickets/service.ts`, `v2/server/test/{commands,attempts}.test.ts`, `v2/server/test/support/execution.ts`, và R3 docs `v2/docs/flows/{server-execution,server-tickets}.md`.

Handoff Task 7/phase sau không đổi: lắp transactional ACL cho các machine route còn lại, binding guard và execution authority; giữ dispatch/final verification fail closed cho tới producer/verifier thật.
