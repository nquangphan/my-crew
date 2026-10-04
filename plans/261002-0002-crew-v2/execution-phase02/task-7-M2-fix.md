# Phase02 Task7 — M2 fixture warnings

Trạng thái: READY cho independent scoped review M2. Baseline khi nhận task: HEAD `8e7d313` trên worktree `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`. Không stage/commit; PM serialize Git. Không mở lại F1/M1 hoặc claim toàn phase hoàn tất.

## Thay đổi chính xác

- `v2/server/test/docs-read.test.ts`: bỏ 12 non-null assertion, thêm assertion hiện diện cho project import, inventory project, foreign project và ba search item trước dùng. Giữ nguyên các assertion về số item, khác path, cursor, snapshot scope, Unicode/raw byte và completion.
- `v2/server/test/api-acceptance.test.ts`: bỏ 10 non-null assertion; env container/database bắt buộc được assert; database row phải hiện diện và `name` có kiểu string trước pg_dump (bỏ cast `as string`); assert project import, successful claim attempt và body SSE trước dùng. Các HTTP status, request, positive/negative expectation và cleanup giữ nguyên.
- `v2/docs/flows/server-docs-view.md`: thêm đúng một paragraph Tests mô tả fail-fast fixture (R3). Giữ paragraph gateway integration của peer.

Exact diff lưu tại `task-7-M2-evidence/owned.diff`: docs flow +2/-0, api acceptance +22/-10, docs read +23/-9. Chỉ ba file trên được sửa ngoài report/evidence này. Không sửa production/support, không suppression, không optional-chain route, không cast mới, không test mới, không shared manifest/generated docs hoặc file Task3/Task4. Search deadline/current credential/SSE logic không thay đổi.

## Kiểm chứng sau batch source cuối

Mỗi command chạy đúng một lần, exit 0:

| Command | Kết quả | Evidence |
|---|---|---|
| `pnpm --dir v2/server typecheck` | `tsc --noEmit`, exit 0 | `task-7-M2-evidence/typecheck.log` |
| `pnpm exec biome check v2/server/test/docs-read.test.ts v2/server/test/api-acceptance.test.ts v2/server/test/support/http.ts` | Checked 3 files; 0 error, 0 warning, no fixes | `task-7-M2-evidence/biome.log` |
| `pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/docs-read.test.ts` | 5/5 pass, 0 fail/cancelled/skipped | `task-7-M2-evidence/docs-read.log` |
| `pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/api-acceptance.test.ts` | 9/9 pass, 0 fail/cancelled/skipped | `task-7-M2-evidence/api-acceptance.log` |
| `git diff --check -- v2/server/test/docs-read.test.ts v2/server/test/api-acceptance.test.ts v2/docs/flows/server-docs-view.md` | exit 0 | Worker command output |

Runner mỗi lần nhận ONE absolute file; fixture prefix 001–006. Không chạy broad server/domain/gateway suite. Có self-review exact diff: mọi value trước đây được `!` khẳng định đều có assertion hiện diện/type thật trước dereference; existing negative expectations không yếu đi.

## Bằng chứng runtime và cleanup

Docs deadline test dùng private DB `crew_v2_test_70879050927841508f3c636212c81dac`, port `57517` khác 5432/55432. Lock fixture vẫn hữu hạn và cleanup finally; timeout SQL trả lỗi, single-connection backend PID `107` được dùng lại sau rollback. Cursor malformed vẫn 400. HTTP fixture dùng listener loopback port0; acceptance restart chuyển `http://127.0.0.1:57672` sang `http://127.0.0.1:57677`, pool mới cùng private DB. `pg_dump -Fc`/`pg_restore` 74979 bytes vào `crew_v2_restore_8aad56bc779347c38c1b918d4acfb352`, digest gồm graph/docs bytes/cursor/command results qua assertion. Các tests SSE revoke, owner expiry và app shutdown đều pass.

Hai container runner sở hữu được auto stop/remove đúng ID. `docker inspect --format '{{.Name}}' <ID>` từng ID trả exit 1 `no such object`; evidence `task-7-M2-evidence/cleanup.log`:

- `b6ceb9de31ac3c6e73e10bade7491cec465e597c1b24959f1a6ef992681b90c3` (docs-read)
- `0bfd5bffe5fa98bdf4fab3085270874af8bd7a78c3706e68cb4ff3f7906f819f` (api-acceptance)

Fixture finally đóng app/pool, drop đúng private DB/restore DB; container absence xác nhận không còn DB/container của hai runs. Không tạo temp file, lock hay container khác; evidence lưu có chủ đích trong execution report folder. Không đụng shared services/credentials/v1, không global cleanup.

## Freeze source SHA-256

| File | SHA-256 |
|---|---|
| `v2/server/test/docs-read.test.ts` | `29a6d628545d1489015a58ea98d930e15ff4ec9320ac61d2f812b5ceef50d37d` |
| `v2/server/test/api-acceptance.test.ts` | `d1c6a26f9772028aa5dca3250ea4a7c25ef4840855deba8f07979ed6f73dfe0c` |
| `v2/docs/flows/server-docs-view.md` | `59e6b3f1068a050741c5d6ca87f02badb124d452ecdc4238f5d50c72c9c0eb36` |

`task-7-M2-evidence/source-sha256.txt` còn ghi production search `4b741e890fa5af07919cc4f2b3d724d2d807f13daec5fe38a663bfa9b4c18365` và support/http `d7e3855ccf1eea9a04a1330879cc126b32959e14435382b6fff5f7120322a699`; git diff hai file đó rỗng. M2 không thay public protocol/default deny hoặc producer authority. Ba owned files đã freeze, chờ PM/reviewer scoped follow-up.
