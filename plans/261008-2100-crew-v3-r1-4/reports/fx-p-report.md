# FX-P — sửa plugin sau review

Ngày 08/10/2026, giờ Asia/Ho_Chi_Minh. Worktree `paperclip-r14-int`, nhánh `crew/r1-4`.

## Kết quả theo review

| Mục | Sửa gì | Test đỏ → xanh |
|---|---|---|
| RV1-01 | Validator chấp nhận `parentPath` là thư mục cha chính xác; cây UI tạo nút thư mục từ path. | `docs.test.ts` đỏ với `docs-snapshot: trang không hợp lệ`; xanh với ba trang `docs/flows/a.md`, `docs/guide/sub/b.md`, `docs/index.md`. `docs.db.test.ts` nhận ảnh chụp và đọc lại cả ba `parentPath`; `ui/docs/tree.test.ts` kiểm cấu trúc cây. |
| RV1-02 | Cho phép `null` ở các probe đã liệt kê; UI hiện “Không rõ”, phân biệt `loggedIn: false` với `null`. | `machines.test.ts` đỏ ở parser khi gửi bản tin probe hỏng; xanh sau sửa. `ui/machines/card.test.ts` đỏ vì chưa có seam component, xanh với dữ liệu null. |
| RV1-05 | `machine_latest` có khóa `(company_id,machine_id)` và upsert; `machine_reports` chỉ giữ lịch sử, DELETE có điều kiện company. | Review RV-1 đã tái hiện máy biến mất sau 25 giờ; test DB mới kiểm A vẫn mất liên lạc nhưng còn trong latest khi B gửi, và lịch sử company khác không bị xóa; xanh 24/24. Không có lượt chạy đỏ riêng cho ca DB mới trong phiên này. |
| RV1-06 | Chọn marker mới nhất của agent participant ở stage review thứ hai trước approval, đúng quy tắc issue-gate; marker mới nhất hỏng trả `invalid: true` kèm tác giả; UI hiện trạng thái và tác giả. | Review RV-1 đã tái hiện marker giả; `docs.db.test.ts` kiểm executor/user giả, nhiều commit và marker integrator mới nhất sai định dạng. `ui/docs/content.test.ts` đỏ khi component chưa có, sau đó xanh. |
| RV1-07 | Nhận diện root bằng cấu trúc stage và principal của template code/research, `maxReviewRounds=5`; kind research chỉ theo template research. | `roots.data.test.ts` đỏ vì policy stock 4 stage giả lọt vào danh sách; xanh sau sửa. `map.data.test.ts` dùng policy template thực. |
| RV1-08 | Nhãn stage theo vị trí stage ID trong policy: Reviewer, Integrator merge/docs, Owner, Integrator push; status/kind/online hiển thị tiếng Việt. | `ui/map/component.test.ts` đỏ với `review` và ba stage trùng nhãn; xanh sau sửa, có ca research Owner. |
| RV1-09 | Chặn load1 0–1000, cpuCount 1–1024, memFreePct 0–100, chuỗi tối đa 200 ký tự và NUL trước mọi ghi DB. | `machines.test.ts` kiểm giá trị vượt biên bị ném và số dòng history/latest không đổi; đỏ ban đầu ở parser null (cùng RV1-02), xanh sau sửa. |
| RV1-10 | Khi nhận snapshot, xóa staging cùng company+project cũ hơn 10 phút mà không được `docs_current` tham chiếu; thêm index ở migration mới. | Review RV-1 đã ghi nhận staging mồ côi; `docs.db.test.ts` fault injection lúc INSERT trang, lùi tuổi bản tạm, ghi lại và kiểm chỉ còn snapshot hiện hành; xanh. Không có lượt chạy đỏ riêng cho ca fault injection trong phiên này. |
| RV1-11 | Bỏ shim React, dùng `@types/react` có sẵn; sửa props theo kiểu SDK; gom UUID/namespace/JSON helper; tách validation, SQL và đăng ký thành khối đọc được. | Sau khi xóa shim, `pnpm typecheck` đỏ ở props `ErrorBoundary`, `DataTable` và widget; sửa xong typecheck xanh. |

## Migration và kiểm tra

Host dùng ledger theo `migrationKey` và SHA-256 checksum (`server/src/services/plugin-database.ts`, `applyMigrations`); sửa `0001`/`0002` sẽ gây checksum mismatch ở nơi đã áp dụng. Vì vậy giữ nguyên hai file đó, thêm `0003_machine_latest.sql` để nới NULL, tạo/latest backfill, thêm index docs. Test DB chạy cả 3 migration, kiểm từng statement của `0003` và mọi lệnh ghi máy bằng validator host.

- Trước test embedded PostgreSQL: `ipcs -m` có 5 segment, không cần gỡ.
- Trong `packages/crew-plugin`: `npx vitest run` **12 file, 24/24**; `corepack pnpm typecheck` **PASS**; `corepack pnpm build` **PASS**.
- `node crew/release/check-core-hooks.mjs`: **5/5**, 0 lỗi; 4 cảnh báo chưa có PR upstream.
- `node --test crew/ops/*.test.mjs`: **23/23**.
- UI bundle gzip **94.883 byte**, dưới 1,5 MB.
- `git diff --check` **PASS**. Sau commit, `git status --ignored --short packages/crew-plugin` chỉ hiện `dist/` và `node_modules/` bị ignore; không có source bị ignore. Worktree sạch.

Commits: `26eda232d` (docs), `ff7bc02d7` (máy), `06de07457` (policy/UI), `e251f7279` (kiểm runtime SQL).

## Status

**DONE_WITH_CONCERNS**

## Summary

Đã sửa toàn bộ mục plugin được giao trong phạm vi `packages/crew-plugin/**`, không thêm hook hay sửa lõi Paperclip.

## Concerns

- Không chạy trình duyệt/host thật hoặc luồng Mac → webhook; đó là cổng tích hợp AC-4, ngoài bộ test hẹp được yêu cầu ở Mac mini dùng chung.
- RV1-05 và RV1-10 có bằng chứng đỏ từ review trước và ca DB mới xanh, nhưng không có lượt chạy đỏ riêng sau khi viết test trong phiên sửa này. Các mục còn lại có log đỏ trực tiếp hoặc đỏ typecheck như bảng trên.

## Bind mảng trên host

- `bindSql` trong `server/src/services/plugin-database.ts` bind từng placeholder bằng `sql\`${params[index - 1]}\``, nên array bị bung thành nhiều tham số.
- Test tích hợp plugin dùng `pluginDatabaseService` thật và embedded PostgreSQL; lần đầu đỏ ở `crew.map` với `cannot cast type record to uuid[]`.
- `crew.map` relation và comments chuyển ID sang `ids.join(",")` cùng `string_to_array($n, ',')::uuid[]`; không query nếu danh sách rỗng.
- `crew.docsCheck` chuyển danh sách tác giả stage thành chuỗi cùng cách cast, và chỉ query khi có authors.
- Fixture gồm cây CRE-36, ba con, quan hệ `blocks` và marker docs-check; cả map lẫn docs-check cùng đi qua bind của host.
- Sau sửa: `pnpm build`, `pnpm typecheck`, `npx vitest run` đều PASS (12 file, 24/24); hook `check-core-hooks` 5/5, 0 lỗi.
- `ipcs -m` trước lượt test ghi nhận 5 shared-memory segment hiện hữu; không gỡ segment nào.

## React trong bundle CJS

- Thêm esbuild resolver riêng cho require-call `react`, `react-dom` và `react/jsx-runtime`; ESM imports vẫn external như trước.
- Shim CJS đọc lần lượt `__paperclipPluginBridge__.react`, `.reactDom`, `.reactJsxRuntime` và ném lỗi có ngữ cảnh nếu host chưa khởi tạo bridge.
- Test build bundle, xác nhận không có lời gọi `require("react` và import bundle qua các data URL mô phỏng host rewrites.
- Test kiểm `CrewIssueTab`, `CrewPage`, `MachinesWidget` đều export function.
- `pnpm build`, `pnpm typecheck`, `npx vitest run`: PASS (13 file, 25/25); `grep -c 'require("react' dist/ui/index.js`: 0.
- `node --test crew/ops/*.test.mjs`: PASS (23/23); `check-core-hooks`: 5/5; `bash -n crew/ops/inspect-image.sh`: PASS.

## Slot trong giao diện chat

- Đăng ký `taskDetailView` cho issue với id `crew-issue-summary`; giữ `detailTab` cho giao diện classic.
- Export `CrewIssueSummary`; dùng capability hiện có `ui.detailTab.register`, dùng chung cho slot inline theo SDK.
- Summary trả `null` nếu `crew.map` không xác định được root Crew; với CRE-36 hiện “Crew · 2/3 con xong · Integrator · merge + docs · docs Đạt”.
- Nút “Mở map” mở bản đồ và panel kiểm docs đã dùng ở tab; mặc định thu gọn.
- Trang Máy chỉ còn một tiêu đề; biểu đồ 24 giờ cao 5rem, nét 1.5, dùng `currentColor` và có nhãn Max.
- Kiểm tra: build/typecheck PASS; Vitest 13 file, 25/25; core hooks 5/5, 0 lỗi.
- Bundle host giả export `CrewIssueSummary` dạng function; `grep -c 'require("react' dist/ui/index.js` trả 0.
