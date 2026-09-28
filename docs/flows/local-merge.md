# Nghiệm thu: merge cục bộ, cổng pre-push và push

> Flow `local-merge`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow local-merge` in ra
> đúng danh sách đó.

## Mục đích

Merge cục bộ kết quả mọi ticket dev, bug và docs-init đã xong của một `pm_task` vào một nhánh tích hợp, chạy
cổng trước khi đẩy (test dự án, `crew-docs check --range`, đường dẫn được bảo vệ), rồi push lên nhánh mặc định
của `origin` — không có bước nào trong đây agent tự chạy `git merge`/`git push`. Đây là cách duy nhất một
`pm_task` được coi là nghiệm thu xong: chủ dự án không tự tay merge PR nào.

## Điểm vào

- `apps/daemon/src/roles/merge-policy.ts` → `mergeAndPush()` — gọi bởi công cụ ticket `merge_and_push`
  (`apps/daemon/src/tools/ticket-mcp-server.ts`, flow `agent-runs`) ở bước `pm_accept` (`docs/flows/agent-roles.md`).

## Các bước

1. `apps/daemon/src/roles/merge-policy.ts` → `acceptanceViolations()`: một report dev/bug với
   `docsFirst=false` luôn bị từ chối; `skillsMissing` khác rỗng hay `leftResources=true` bị từ chối trừ khi PM
   truyền ticket đó vào `acceptedExceptions` của `merge_and_push`. Một vi phạm được miễn khi một bug sau của
   cùng chuỗi (`chainRoot()`, theo `originDevId`) đã `done` — PM đã từ chối ticket đó và bug mang bản sửa.
2. `apps/daemon/src/roles/merge-policy.ts` → `mergeOrder()`: thứ tự merge xác định — `docs_init` trước, rồi
   theo `dependsOn` giữa các ticket đang merge và theo chuỗi bug (bug sau `bugCycle` của bug trước); vòng phụ
   thuộc không xảy ra vì server chỉ chấp nhận `dependsOn` là ticket anh em đã tồn tại.
3. `apps/daemon/src/roles/merge-policy.ts` → `mergeAndPush()`: có vi phạm nghiệm thu thì dừng ngay
   (`status: rejected`, không đụng git); worktree PM còn thay đổi chưa commit cũng dừng
   (`status: gate_failed`); `git fetch origin <default>` rồi merge nhánh mặc định (`origin/<default>` nếu có)
   vào `crew/<pm-key>` trước, sau đó từng `head_sha` theo `mergeOrder()`.
4. `apps/daemon/src/roles/merge-policy.ts` → `mergeOne()`/`takeOurs()`: mỗi merge dùng `--no-ff`; xung đột giới
   hạn đúng trong `docs/index.md`/`docs/files.md` (block sinh tự động) được tự giải quyết — giữ "ours"
   (`takeOurs()` giữ nguyên hai bên hunk sạch, bỏ phần xung đột của "theirs") rồi `crew-docs generate` và
   commit; xung đột nào khác abort merge và trả `status: conflict` kèm danh sách file cho PM tạo subtask giải
   quyết.
5. `apps/daemon/src/roles/merge-policy.ts` → `mergeAndPush()` (sau khi merge xong): `crew-docs generate` một
   lần nữa trên cây đã merge và commit nếu đổi khác; đã sạch thì không tạo commit rỗng.
6. `apps/daemon/src/roles/merge-policy.ts` → `prePushGate()`: chạy `project.testCommand` của máy (không có thì
   coi là đạt, ghi rõ lý do), `crew-docs check --range <base>..HEAD` (R1–R7 trên toàn bộ commit vừa gộp),
   `protectedPathCheck()` (đường dẫn được bảo vệ đổi trong `range` phải có commit mang trailer
   `Crew-Owner-Approved: <ticket-key>` hoặc `Crew-Docs-Init: true`). Bất kỳ bước nào rớt trả `status:
   gate_failed` kèm output từng bước; không có gì được push.
7. `apps/daemon/src/roles/merge-policy.ts` → `mergeAndPush()` (đẩy lên): `git push origin
   HEAD:refs/heads/<default>` — hook `pre-push` của repo (`docs-hooks`) chạy lại ở phía git; push bị hook hay
   remote từ chối cũng trả `gate_failed`.
8. `apps/daemon/src/roles/merge-policy.ts` → `updateLocalDefault()`: dời nhánh mặc định cục bộ lên head vừa
   push — nhánh mặc định đang được checkout ở đâu đó thì fast-forward checkout đó khi nó sạch (có thay đổi chưa
   commit thì để nguyên và ghi lý do); không checkout ở đâu thì `update-ref` khi đó là fast-forward.
9. `apps/daemon/src/roles/merge-policy.ts` → `mergeAndPush()` (cuối): head vừa push có `docs/flows.yaml` thì
   đồng bộ snapshot docs (`syncDocs`, flow `docs-sync-viewer`) rồi trả `status: merged` (danh sách ticket đã
   merge/đã có sẵn, head, commit, kết quả từng bước cổng).
10. `apps/daemon/src/tools/ticket-mcp-server.ts` → tool `merge_and_push`: gọi `mergeAndPush()` với report hiện
    hành của từng ticket con đã `done`; `status: gate_failed` bình luận output và tự chuyển `pm_task` sang
    `blocked` rồi kết thúc lượt chạy ngay (`requestEnd('blocked')`); `status: merged` ghi `head`/`commits` vào
    `job.handoff` (`MergeHandoff`) để `reportOverlay()` của flow `agent-roles` điền vào report `pm_accept`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/daemon/src/roles/merge-policy.ts` | Luật nghiệm thu, thứ tự merge, merge cục bộ, cổng pre-push, push | `mergeAndPush`, `acceptanceViolations`, `mergeOrder`, `prePushGate`, `takeOurs` |

## Dữ liệu

- Bảng: không đọc/ghi trực tiếp; đọc report (`Report`) của từng ticket con qua `VpsClient.getTicket()` (flow
  `ticket-lifecycle`), ghi kết quả qua `syncDocs()` (flow `docs-sync-viewer`).
- Sự kiện: không tự phát; `job.handoff` (`MergeHandoff`) do tool `merge_and_push` ghi được flow `agent-roles`
  đọc lại khi PM nộp report.
- Gọi ngoài: `git` cục bộ (`fetch`, `merge`, `commit`, `push`, `update-ref`) và tiến trình test của dự án
  (`project.testCommand`) trên máy chạy PM; `crew-docs generate`/`check --range` qua `docs-kit-bridge.ts`; push
  lên `origin` (remote git của dự án, không phải VPS API).

## Flow liên quan

- agent-roles: `pm-accept.md` mô tả đúng luồng nghiệm thu gọi `merge_and_push`; `reportOverlay()` lấy
  `headSha`/`commits` từ `job.handoff` khi `stage === 'pm_accept'`.
- agent-runs: tool `merge_and_push` (`ticket-mcp-server.ts`) chỉ có ở vai trò PM
  (`tool-scopes.ts` → `ROLE_EXTRAS.pm`).
- ticket-lifecycle: nguồn `head_sha` của mỗi ticket con là `report.headSha` ghi bởi flow đó (job docs commit
  code+test+docs, hoặc `docs_init` commit docs).
- docs-check / docs-hooks: `crew-docs generate`/`check --range` và hook `pre-push` chạy trong bước 6–7.
- docs-sync-viewer: snapshot docs được đồng bộ ngay sau khi push thành công.

## Tests

- `apps/daemon/test/merge-policy.test.ts`: vi phạm nghiệm thu (docs_first, skill thiếu, tài nguyên để lại) và
  miễn trừ khi PM chấp nhận hoặc một bug sau đã sửa; thứ tự merge theo `dependsOn` và chuỗi bug; `takeOurs()`
  giữ đúng hunk sạch; xung đột giới hạn trong block docs sinh tự động tự giải quyết, xung đột khác abort và trả
  danh sách file; cổng pre-push chặn đúng bước rớt (test, `crew-docs check`, đường dẫn được bảo vệ thiếu
  trailer); push thật lên remote bare và dời nhánh mặc định cục bộ mà không đụng checkout đang dirty.
