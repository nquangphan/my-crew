# Kiểm tra chuẩn docs (crew-docs)

> Flow `docs-check`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow docs-check` in ra
> đúng danh sách đó.

## Mục đích

Cài đặt CLI `crew-docs`: đọc/validate `docs/flows.yaml`, sinh các block tự động trong `docs/index.md` và
`docs/files.md`, chạy 7 luật kiểm tra R1–R7 (định nghĩa đầy đủ ở `packages/docs-kit/STANDARD.md`), quét
credential trong diff, và hai lệnh tra cứu cho agent (`where`, `flow`). Đây là công cụ mà mọi repo áp dụng
chuẩn docs 2P Crew dùng chung, đóng gói thành một bundle CommonJS đơn file.

## Điểm vào

- `packages/docs-kit/src/bin.ts` — thực thi CLI thật (`crew-docs`), đọc argv/stdin, ghi stdout/stderr, đặt
  exit code.
- `packages/docs-kit/src/cli.ts` → `main()` — logic dispatch lệnh, độc lập I/O thật để test được.

## Các bước

1. `packages/docs-kit/src/cli.ts` → `main()`/`dispatch()`: parse lệnh con (`check`, `init`, `generate`,
   `where`, `flow`, `install-hooks`, `ci-workflow`, `--version`), bắt `UsageError`/`GitError` thành thông báo
   và exit code 2. `check()` khi `outcome.skipped === 'not-initialized'` in đúng một dòng cảnh báo tiếng Việt
   trên stderr thay cho dòng tóm tắt thường (`cảnh báo: repo chưa có docs/flows.yaml nên chưa kiểm tra chuẩn
   docs (áp dụng từ commit docs-init)`) và giữ exit code `0` của `outcome`.
2. `packages/docs-kit/src/commands/check.ts` → `runCheck(root, mode)`: một trong 5 chế độ
   (`staged`/`commit-msg`/`range`/`pre-push`/`all`), mỗi chế độ gọi đúng tập luật R1–R7 theo bảng ở
   `STANDARD.md#chế-độ`. `staged` chỉ chạy R7 (`checkSecrets`) để commit nhanh. `treeRules()` chạy R1 luôn,
   R2+R4 khi manifest hợp lệ. R3 chạy một lần trên cả range qua `rangeFreshness()`: gộp thay đổi của mọi
   commit sau docs-init và báo lỗi trên head; `commitRules()` chỉ còn R6/R7 cho từng commit. Commit merge (`isMerging()` từ
   `git.ts`, hoặc phát hiện qua `firstParent`) được bỏ qua ở R3 và R6 vì các commit nó mang vào đã được kiểm
   tra riêng khi tạo ra; R1, R2, R4, R7 vẫn chạy. Ba chế độ hook (`staged`/`commit-msg`/`pre-push`) gọi
   `notAdopted()` khi `docs/flows.yaml` thiếu ở cả bản đang xét và bản trước (`headManifest()` cho staged/
   commit-msg; tip vừa push và tip đã biết của remote cho từng ref ở `checkCommits(..., hook: true)`): trả
   `CheckOutcome.skipped = 'not-initialized'`, không luật nào chạy, code `0` — để chủ dự án còn commit/push
   được trước khi chạy docs-init; `--all`/`--range` không có lối tắt này, vẫn `uninitialized()` (exit 3).
3. `packages/docs-kit/src/manifest.ts` → `loadManifest()`/`parseManifest()`: parse YAML (`uniqueKeys: true` để
   bắt flow id trùng) rồi validate bằng schema `FlowsManifest` (`packages/docs-kit/src/flows-schema.ts`); `sourceMatcher()` dùng
   `picomatch` để khớp `source.include` trừ `source.exclude`.
4. `packages/docs-kit/src/tree.ts` → `TreeReader`: trừu tượng hoá một phiên bản repo (working tree, index,
   hoặc một commit qua `git cat-file`/`ls-tree`), để cùng một luật chạy được trên cả ba nguồn.
5. `packages/docs-kit/src/rules/r1-manifest.ts` … `r7-secrets.ts` → `checkManifest`, `checkCoverage`,
   `checkFreshness`, `checkGenerated`, `notInitialized`, `checkProtected`, `checkSecrets`: từng luật độc lập,
   nhận `TreeReader`/`FlowsManifest`/diff và trả `Violation[]` (`{rule, path, message, commit?}`).
6. `packages/docs-kit/src/secret-scan.ts` → `scanPatch()`: trích các dòng được thêm từ diff (`addedLines()`),
   quét bằng bộ luật built-in (`SECRET_RULES`, cổng chuỗi từ gitleaks mặc định cộng token máy 2P Crew
   `crew_mt_...`), cộng thêm `gitleaks` nếu có trong PATH (`findGitleaks()`), không có cơ chế bỏ qua nào khác.
7. `packages/docs-kit/src/generate.ts` → `applyBlock()`/`isBlockCurrent()`: sinh nội dung giữa marker
   `<!-- crew-docs:flows:start -->`/`files` từ manifest; `packages/docs-kit/src/commands/generate.ts` →
   `generateCommand()` ghi lại `docs/index.md`/`docs/files.md` nếu khác.
8. `packages/docs-kit/src/commands/init.ts` → `initCommand()`: sao chép template (`AGENTS.md`, `CLAUDE.md`,
   `docs/index.md`, `docs/architecture.md`, `docs/flows.yaml`) mà không ghi đè file đã có, in
   `INIT_CHECKLIST`; `--flow <id> --title` tạo một trang flow từ `templates/flow.md`
   (`renderFlowTemplate()`).
9. `packages/docs-kit/src/commands/where.ts`/`flow.ts` → `whereCommand()`/`flowCommand()`: tra `flow ↔ file`
   hai chiều qua `flowsForPath()` (`packages/docs-kit/src/flows-schema.ts`) cho agent dùng trước khi sửa code.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `packages/docs-kit/src/bin.ts` | Thực thi CLI thật (argv/stdio) | — |
| `packages/docs-kit/src/cli.ts` | Dispatch lệnh, độc lập I/O | `main`, `USAGE` |
| `packages/docs-kit/src/commands/check.ts` | 5 chế độ kiểm tra | `runCheck`, `CheckMode`, `CheckOutcome` |
| `packages/docs-kit/src/commands/init.ts` | Scaffold docs + trang flow | `initCommand`, `INIT_CHECKLIST` |
| `packages/docs-kit/src/commands/generate.ts` | Sinh lại block tự động | `generateCommand` |
| `packages/docs-kit/src/commands/where.ts` | Tra file → flow | `whereCommand` |
| `packages/docs-kit/src/commands/flow.ts` | Tra flow → file | `flowCommand` |
| `packages/docs-kit/src/commands/lookup.ts` | Load manifest + resolve path cho lệnh tra cứu | `lookupManifest`, `repoRelative` |
| `packages/docs-kit/src/commands/io.ts` | Giao diện I/O, mã lỗi CLI | `Io`, `EXIT`, `UsageError` |
| `packages/docs-kit/src/git.ts` | Bọc lệnh git dùng cho mọi luật | `git`, `stagedChanges`, `commitChanges`, `isMerging`, `hasTrailer` |
| `packages/docs-kit/src/tree.ts` | Đọc file từ working tree/index/commit | `TreeReader`, `workingTreeReader`, `indexReader`, `commitReader` |
| `packages/docs-kit/src/flows-schema.ts` | Schema zod của `flows.yaml` và tra chủ sở hữu của một path | `FlowsManifest`, `FlowId`, `flowsForPath`, `FLOWS_MANIFEST_PATH` |
| `packages/docs-kit/src/manifest.ts` | Parse + truy vấn `flows.yaml` | `loadManifest`, `sourceMatcher`, `mappedPaths`, `flowsListing` |
| `packages/docs-kit/src/generate.ts` | Sinh/so khớp block tự động | `applyBlock`, `isBlockCurrent`, `blockBody` |
| `packages/docs-kit/src/secret-scan.ts` | Quét credential trong diff | `scanPatch`, `SECRET_RULES`, `findGitleaks` |
| `packages/docs-kit/src/rules/types.ts` | Kiểu `Violation` dùng chung | `Violation`, `formatViolation` |
| `packages/docs-kit/src/rules/r1-manifest.ts` | R1: manifest hợp lệ, path tồn tại | `checkManifest` |
| `packages/docs-kit/src/rules/r2-coverage.ts` | R2: mọi file nguồn có flow | `checkCoverage` |
| `packages/docs-kit/src/rules/r3-freshness.ts` | R3: đổi file nguồn phải đổi doc flow | `checkFreshness` |
| `packages/docs-kit/src/rules/r4-generated.ts` | R4: block tự động đã cập nhật | `checkGenerated` |
| `packages/docs-kit/src/rules/r5-initialized.ts` | R5: chưa có `flows.yaml` | `notInitialized` |
| `packages/docs-kit/src/rules/r6-protected.ts` | R6: đường dẫn/mục bảo vệ cần trailer duyệt | `checkProtected`, `isDocsInitMessage`, `PROTECTED_PATTERNS` |
| `packages/docs-kit/src/rules/r7-secrets.ts` | R7: không commit credential | `checkSecrets` |
| `packages/docs-kit/src/templates.ts` | Nội dung template inline vào bundle | `TEMPLATES`, `renderFlowTemplate` |
| `packages/docs-kit/src/version.ts` | Phiên bản bundle | `VERSION` |
| `packages/docs-kit/src/raw-imports.d.ts` | Kiểu cho import `?raw` và hằng số build-time | — |
| `packages/docs-kit/templates/AGENTS.md` | Template AGENTS.md | — |
| `packages/docs-kit/templates/index.md` | Template docs/index.md | — |
| `packages/docs-kit/templates/architecture.md` | Template docs/architecture.md | — |
| `packages/docs-kit/templates/flow.md` | Template một trang flow | — |
| `packages/docs-kit/templates/flows.yaml` | Template `docs/flows.yaml` rỗng | — |

## Dữ liệu

- Bảng: không (công cụ CLI, không chạm DB).
- Sự kiện: không.
- Gọi ngoài: gọi tiến trình `git` cục bộ (`node:child_process`), tuỳ chọn `gitleaks` nếu có trong PATH; không
  gọi mạng.

## Flow liên quan

- docs-hooks: `install-hooks`/`ci-workflow` (flow riêng) dùng cùng bundle và gọi `crew-docs check` qua hook.

## Tests

- `packages/docs-kit/test/rules.test.ts`: từng luật R1–R7, cả 5 chế độ `check`, pre-commit không chặn R2/R3,
  R3 chấp nhận doc được sửa ở commit sau trong cùng range và báo lỗi trên head, lệnh `where`/`flow`, sinh block
  tự động, hành vi bỏ qua R3/R6 trên commit merge, `--all`/`--range` vẫn báo `NOT_INITIALIZED`, ba chế độ hook
  cho qua với đúng một dòng cảnh báo khi repo chưa có `docs/flows.yaml` ở cả hai bản so sánh, và vẫn từ chối
  (exit 3) khi một commit hay một push xoá manifest khỏi repo đã khởi tạo docs; R6 với `AGENTS.md` ở gốc repo:
  thất bại khi thiếu trailer, đạt với trailer, một `AGENTS.md` lồng trong thư mục con (ví dụ
  `src/checkout/AGENTS.md`) không bị coi là đường dẫn được bảo vệ, và commit docs-init vẫn được miễn như
  `CLAUDE.md`.
- `packages/docs-kit/test/flows-schema.test.ts`: `flowsForPath()` trả đúng các flow sở hữu một path cùng vai trò, lý do `unassigned` và path lạ.
