# PL — Plugin ghép máy — Báo cáo

Ngày: 11/10/2026 (Asia/Ho_Chi_Minh). Worktree `~/Documents/projects/crew/.worktrees/paperclip-pair-pl`, nhánh
`crew/pair-pl`, commit `ba7a7ef56` (chưa push).

## Kết quả

PL đã xong. Plugin có bảng ghép, ba route, webhook dùng key máy, `crew.machines` có `pairing` và config có
`paperclipSshPublicKey`. Không thêm capability (vẫn 28) và không sửa lõi.

## File

- Mới: `packages/crew-plugin/migrations/0014_machine_pairings.sql`, `src/machines/pairing.ts`,
  `src/__tests__/machine-pairing.db.test.ts`, `src/__tests__/migration-0014.db.test.ts`.
- Sửa: `src/shared/webhook.ts`, `src/machines/data.ts`, `src/shared-web/machine-card.ts` (export thêm
  `CrewMachinePairing`), `src/manifest.ts`, `src/worker.ts`, `src/__tests__/webhook.test.ts`.
- Sửa ngoài danh sách, chỉ là test bắt buộc phải theo: `src/__tests__/roles.db.test.ts` (danh sách route đầy đủ),
  `src/__tests__/machines.test.ts` (áp thêm migration 0014, vì webhook giờ đọc bảng ghép), `src/ui/machines/card.test.ts`
  (fixture thêm `pairing: null`).

## Lệch so với spec

- **routeKey `machines.pair-info` thay cho `machines.pairInfo`.** Validator manifest của host chỉ nhận routeKey chữ
  thường (`^[a-z0-9][a-z0-9._:-]*$`). Đường HTTP vẫn đúng spec (`GET /machines/pair-info`), nên WB và AP không bị ảnh
  hưởng.
- **Mã lỗi thêm `pairing_unavailable`.** Khi đọc `machine_pairings` lỗi, webhook từ chối chứ không rơi về secret company.
  Như vậy một máy đã gỡ không thể lọt qua lúc DB trục trặc.
- **`unpair` máy chưa từng ghép trả 404 `Máy chưa được ghép`.** Spec không nói tới ca này.

## Hành vi chính

- Key máy là `base64url(HMAC-SHA256(secret company, "crew-machine-key/v1\n"+companyId+"\n"+machineId+"\n"+nonce))`.
  Uuid được hạ chữ thường trước khi băm.
- `pair` upsert với nonce mới, xóa `revoked_*`, rồi đọc lại nonce đã lưu để dẫn xuất key. Plugin không có transaction
  host, nên hai lần ghép cùng lúc vẫn ra key khớp với dòng cuối cùng. Log chỉ ghi `companyId`, `machineId`, `userId`.
  Test xác nhận key không có trong log.
- Route nào cũng kiểm `actorType === "user"`. Lỗi DB trả 500 với câu chung, chi tiết chỉ nằm ở log server.
- Webhook đọc bảng ghép khi `machineId` là uuid:
  - không có dòng thì dùng secret company như trước (đường Mac mini);
  - dòng đã gỡ thì ném `machine_revoked`;
  - dòng còn hiệu lực thì kiểm bằng key máy.

  Mỗi bản tin vẫn chỉ resolve secret một lần, luôn kèm `{companyId}`.

## Kiểm

- Typecheck plugin: đạt. Build plugin: đạt.
- Test unit: `webhook.test.ts`, `force-done`, `worker-definition`, `shared-exports`, `src/ui` (gồm guide/ui-bundle sau
  build). Tất cả đạt.
- Test DB, chạy từng file một: `migration-0014` (1), `machine-pairing` (16), `machines` (4), `roles` (3),
  `runtime-switches` (7), `docs` (1), `docs-graph` (5), `companies` (6), `attachments-audit` (1). Tất cả đạt.
- Đã có regression cho máy chưa ghép dùng secret company, chạy được ở cả `machine-status` lẫn `docs-snapshot`. Ca này có
  ở unit (db giả) và ở DB thật, kể cả sau khi máy khác bị gỡ.
- Test không để lại tiến trình Postgres nào. Tiến trình duy nhất còn chạy là instance T1 của worktree
  `paperclip-issues-ui`, không phải của em.

## Chưa làm / cần biết

- Chưa chạy `inspect-image`, vì việc này thuộc DP khi build image. PL không đụng lõi nên số hook lõi không đổi.
- Ngoài `card.test.ts`, crew-web cũng có fixture `CrewMachine`, nhưng fixture đó ép kiểu `as unknown as` nên typecheck
  không vỡ. WB sẽ thêm `pairing` khi làm thẻ máy.
