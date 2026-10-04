# Task 5 — re-review fix round 1

**READY: no.** Bốn finding runtime R1–R4 đã được xử lý. Còn một acceptance bắt buộc chưa được kiểm chứng đúng nghĩa: append-only verifier attestation liên kết evidence gốc, tồn tại qua restart và được đọc khi recheck cùng terminal result đã lưu. Không phát hiện regression trực tiếp mới trong source sửa.

## Phạm vi và bằng chứng

- Chỉ review `fc843d2..14a0f7f`: 8 files của Task 5 fix round 1, cùng `task-5-fix.md` và phần acceptance tương ứng trong brief. Không review lại toàn bộ implementation.
- Chấp nhận bằng chứng đã giao: server 127/127, attempts 26/26, commands 9/9, original review probe 4/4 pass trước khi dọn, typecheck, Biome 6 files, docs checks sạch. Không chạy lại suite hoặc probe vì không có nghi vấn runtime mới cần tái hiện.
- Không sửa source/migration/assembly/gateway, không stage/commit/install/subagent, không tác động dịch vụ chung. Chỉ tạo báo cáo này.

## Findings đã xử lý

| Finding | Kết luận | Căn cứ source và regression |
|---|---|---|
| R1 — microsecond page anchor | Addressed | `commands.ts` so sánh với row anchor ngay trong SQL; kiểm quyền anchor vẫn giữ. Test hai outstanding command `.123456Z`/`.123457Z`, limit 1, trả hai ID khác nhau rồi null cursor. Test completed anchor và poll null vẫn có. |
| R2 — pause nhắm attempt cũ | Addressed | Query tái dùng command kiểm tra attempt ID trong payload, machine và binding revision của active attempt. Test A pause/stop trước ACK, resume/claim B, pause B tạo command mới; lặp pause B tái dùng đúng command B; payload A không đổi và checkpoint A bị stale fence. |
| R3 — artifact sau lease hết | Addressed | Active attempt hết lease bị `LEASE_EXPIRED` trước insert; không ghi state rồi rollback. Test evidence count không tăng, guard giữ chỗ, reconcile running cho ghi tiếp, finalizing lease hết vẫn cho artifact trễ. |
| R4 — event trạng thái cũ | Addressed | `tickets/service.ts` lấy status từ row sau callback. Test trước/sau stop proof so khớp event, response, DB, revision, attempt state và guard. Docs đã diễn tả callback có thể finalize ngay. |

Các acceptance bổ sung khác có test thực: ACK đóng writer pool và replay bằng reader mới không chạy work; hai pool claim cạnh tranh; stop/result đồng thời chỉ một verifier/finalized event; owner pause/cancel thắng passed result; negative deploy/dependency/expired permit chặn trước authority callback.

## C1 — P2: Acceptance verifier attestation vẫn thiếu

**Vị trí:** `v2/server/test/attempts.test.ts:846–919`, đặc biệt dòng 881–883 và 903. Báo cáo `task-5-fix.md` mục Acceptance hiện mô tả đúng việc giữ stop observation nhưng chưa đáp ứng yêu cầu khác về verification evidence.

Test `stopped attestation survives pool restart and recheck finalizes without rewriting proof` chỉ ghi `reconciliation_observations`, gửi `outcome:'retry'` với `evidenceIds:[]`, đóng writer/mở reader, rồi truyền `async () => {}` cho verifier. Assertion số observation bằng 1 chứng minh stop proof bền vững; nó không chứng minh verifier tìm được attestation liên kết với evidence đã reported. Test vẫn xanh nếu logic lookup attestation không tồn tại hoặc bỏ qua hoàn toàn.

Brief dòng 184 quy định verification advancement là append-only verifier attestations liên kết `original evidenceId`, không ghi đè evidence bytes; ví dụ ở dòng 222–237 yêu cầu giữ result ban đầu và recheck sau khi evidence được attested. Yêu cầu này đã được nhắc lại trong phạm vi re-review.

**Sửa hẹp để đóng C1:** thêm một integration test với verifier fixture đọc DB thật, không đổi production authority/schema nếu bảng evidence hiện hữu đủ biểu diễn fixture:

1. Ghi reported evidence cùng attempt, gửi passed result tham chiếu chính evidence ID đó, báo stopped; chưa có attestation thì verifier từ chối và guard giữ finalizing.
2. Append một verifier attestation riêng có liên kết exact original evidence ID và cùng ticket/attempt; không UPDATE reported record hoặc terminal result.
3. Commit attestation, đóng pool ghi và mở pool mới. Verifier từ pool mới phải đọc/kiểm attestation bền vững; không dùng boolean/counter trong closure để cấp quyền.
4. Recheck bằng mutation key mới trên cùng attempt/fence/result. Khẳng định done, guard null, một finalized event; reported bytes/metadata, original result/evidence IDs và fence vẫn nguyên. Exact key result cũ tiếp tục trả durable response cũ nếu test đi qua journal.
5. Ít nhất một negative assertion: không có attestation hoặc attestation liên kết sai original ID thì vẫn pending. Cập nhật fix report/docs để phân biệt host stop observation và verifier evidence attestation.

Đây là khoảng trống acceptance/test, chưa phải bằng chứng runtime production sai. Default production verifier vẫn fail closed và Phase 08 verifier thật vẫn thuộc phase sau. Không nên mở rộng thành triển khai Phase 08 trong Task 5.

## Handoff không đổi

Task 7 tiếp tục chịu trách nhiệm binding guard/execution authority assembly, transactional ACL trước replay cho machine mutations còn lại và SSE reauthorization; Phase 06/08 cung cấp authority thật. Các mục đó không được tính thành finding mới của vòng review này.

Sau C1 chỉ cần review test/fixture/docs mới và bằng chứng chạy tương ứng; không lặp R1–R4 hoặc suite rộng nếu source không thay đổi.
