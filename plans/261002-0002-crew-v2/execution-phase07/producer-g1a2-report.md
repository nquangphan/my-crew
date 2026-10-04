# Producer P-G1a2: graph full-root một snapshot

BASE: cccbae17e9aefc6cbbfba907914332408f8a6d08

## Thay đổi
- `v2/server/src/tickets/dependencies.ts` (`readGraph`): `db.begin('isolation level repeatable read read only', ...)`. Snapshot bắt đầu ở truy vấn đầu (resolve root + ACL qua `requireTicket`), rồi nodes, dependencies, repair links cùng đọc từ snapshot đó. Response và ACL không đổi; không đụng hàm assistant/mutation; `routes.ts` không đổi.
- `v2/server/test/ticket-graph-snapshot.test.ts` (mới): proxy `db.begin` chèn một commit trên kết nối khác (tạo step + cạnh) ngay sau truy vấn nodes. Test khẳng định mọi đầu cạnh đều là node, snapshot không thấy ghi chen, và đọc sau đó thấy đủ.
- Docs: `v2/docs/flows/server-tickets.md` (bước 2), `flows.yaml` (thêm test vào flow, dưới manifest lock), `files.md` generated.

## Bằng chứng
- RED (trước fix): fail "edge endpoints must be nodes" (torn read tái hiện được).
- GREEN: snapshot test + dependencies + ticket-reads + tickets + api-acceptance = 28/28 pass. Biome sạch cho 2 file. `tsc` không lỗi ở file tickets (lỗi có sẵn ở pdf.ts/pdf-lib không liên quan).
- Docs: mirror `git archive HEAD:v2` + overlay, `generate`, `check --all` ok, `check --staged` ok.
- PG: container `crew-v2-test-33e2ad73-...` 256m/1CPU/pids64, loopback ngẫu nhiên, đã stop/remove; heavy slot đã trả; heavyEligible=true lúc chạy.

## Lưu ý
- Giữ `requireTicket` làm truy vấn đầu: nếu đảo thứ tự, snapshot sẽ bắt đầu muộn hơn root resolve (vẫn nhất quán nhưng ACL có thể lệch).
- Web chưa dùng `/v2/events/latest`; theo ledger đó là follow-up Task2.
