# SPEC + QUALITY — Phase06/T3 gateway manifest slice

**Spec compliance: ❌ Cần sửa. Task quality: Needs fixes.** Hai lỗi trong bounded slice; không kết luận toàn bộ T3 hoặc production acceptance.

## Phạm vi và bằng chứng

- Base theo brief: `3c222c5`, candidate chưa commit: `v2/gateway/src/assistant/workflow-manifest.ts` (81 dòng), `v2/gateway/test/workflow-manifest.test.ts` (147 dòng), `v2/docs/flows/assistant-workflows.md` (33 dòng); tổng 261 dòng mới.
- Đã đọc gói diff một lần, toàn bộ ba hunk đều đầy đủ; không mở lại changed files, không Git hoặc sinh diff. Diff SHA-256: `6724ca834717664a3ea684a8708b530541e7e99b58866134ba282a33b644d305`. Report SHA-256: `b0f263bbdf622ad9dba929f4afbb4e2dce98e8c253e3e196c278f9e7de0b8375`.
- Protocol: official `subagent-driven-development/task-reviewer-prompt.md`; đọc docs/index, v2/docs/index và flow gateway-workflows trước unchanged source. Không tìm thấy `scout`/`code-review` trong catalog hoặc các skill roots đã kiểm; không tuyên bố đã chạy hai skill đó. Edge-case scouting thực hiện tĩnh theo các rủi ro có tên dưới đây. Không có `.codegraph` trong checkout này.

## Phần đáp ứng yêu cầu

- `workflow-manifest.ts:38–48`: capability registry được truyền qua constructor; validator dùng release cố định; BMAD deny `RENDER_ARTIFACT_REQUIRED` trước resolve. Không thêm renderer giả hoặc custom role prompt.
- `workflow-manifest.ts:49–78`: chọn source SKILL paths, đối chiếu regular-file/hash với projection, đọc lại bytes hai phía và bind hai full manifests; digest có source, projection và selected skills.
- `workflow-manifest.test.ts:30–61,68–91`: official archive và audited Claude projection được tái dựng; test yêu cầu 15 skills, hai literal hashes và replay digest. Resolver được ghi rõ unit-only; nó không chứng minh production Registry/native admission.
- `assistant-workflows.md:16–22,33`: ghi đúng giới hạn manifest identity, BMAD, authority, gate producer và production acceptance. Docs manifest integration còn do root xử lý trước commit theo brief.

## Findings — một batch cho SPEC và QUALITY

### Important / P1 — Pin dùng để tạo digest có thể khác pin Registry đã kiểm

**Vị trí:** `v2/gateway/src/assistant/workflow-manifest.ts:41–48,70–76`.

`loadDefinition` validate trực tiếp các object do caller sở hữu rồi giữ chúng qua nhiều `await`; cuối cùng lại hash chính các object này. `WorkflowRegistry.resolve` thực tế clone input ngay đầu hàm (`registry.ts:659–666`), nên registry kiểm snapshot riêng còn adapter sử dụng reference có thể đổi.

Trigger không cần sửa registry hay filesystem: gọi `const pending = adapter.loadDefinition(source, projection)`, rồi đổi `projection.runtime` hoặc `projection.derivation.options` trước khi await `pending`. Registry tiếp tục kiểm pin Claude gốc, hai manifest hashes vẫn khớp, nhưng digest trả về bind metadata/pin đã đổi và chưa được validate; đổi `source.name` cũng có thể vượt qua BMAD branch đã chạy trước await. Vì output được dùng làm identity của định nghĩa, đây là sai lệch trust binding trong đúng phạm vi slice.

**Root fix:** capture deep snapshots của cả hai input ngay đầu hàm, validate snapshots, và dùng cùng snapshots cho mọi điều kiện, `registry.resolve`, so manifest và digest. Phải clone cả nested `projection.derivation.options`, không chỉ spread object ngoài. Bổ sung regression có deferred resolver, mutate original inputs khi pending và assert kết quả vẫn chỉ bind snapshot ban đầu (hoặc reject theo contract đã định). Chưa chạy regression trong review static-only.

### Important / P2 — File-type drift có thể treo trước khi kiểm tra loại file

**Vị trí:** `v2/gateway/src/assistant/workflow-manifest.ts:23–33`, đặc biệt `:29`.

`open(path, O_RDONLY | O_NOFOLLOW)` được await trước `file.stat()`. `O_NOFOLLOW` chỉ chặn symlink ở thành phần cuối; FIFO vẫn được mở theo semantics blocking. Nếu một selected SKILL regular file bị đổi thành FIFO không có writer sau Registry verification và trước lần đọc lại này, promise treo tại open, không bao giờ tới kiểm `!stat.isFile()`. Các lần await lstat/open/read của 30 selected files tạo cửa sổ thực tế cho drift; điều này trái với yêu cầu file/type drift phải deny. Đây là static failure path, chưa phải observed production incident. Một trusted immutable registry ở trạng thái bình thường không kích hoạt lỗi; chính trường hợp drift mà adapter định kiểm tra mới kích hoạt.

**Root fix:** dùng regular-file read không thể block ở open của FIFO, ví dụ thêm `O_NONBLOCK` cùng `O_NOFOLLOW`, rồi fstat và reject loại không phải regular trước read; giữ close trong finally. Với trusted reader khác, contract phải bảo đảm cùng thuộc tính. Thêm regression có bounded completion cho FIFO type drift (unit resolver chỉ đóng vai snapshot đã resolve); không chạy native/Node trong lượt review này. Nếu host root bất biến được dùng để loại threat này, cần bằng chứng enforcement đã tồn tại và contract rõ ràng, không dựa vào production isolation còn deferred.

## Edge-case scouting và focused unchanged checks

- **Rủi ro pin tự khai / release mới lọt vào:** kiểm `pins.ts:16–25,64–118`, `registry.ts:171–176,410–430,475–495,659–673`. Validator cố định Superpowers 6.4.2/revision; registry so exact audited source/projection và actual full tree/payload. Không tìm thấy defect bổ sung trong contract này; actual host composition chưa thuộc slice.
- **Rủi ro async input ownership:** cùng focused resolve check cho thấy registry clone còn adapter không clone; sinh finding P1, không crawl callers của feature chưa tích hợp.
- **Rủi ro filesystem drift giữa resolve và reader:** kiểm `stage.ts:169–214` và resolve contract. Registry kiểm full tree nhưng trả pathname, không trả FD/lease xuyên lifetime đọc của adapter. Finding P2 nằm ở reader mới; không mở rộng review hoặc yêu cầu sửa toàn registry. Parent-directory replacement/GC sau resolve vẫn cần production admission/isolation assessment sau này; không cấp chứng nhận từ unit tests.
- **Rủi ro canonical manifest tự nhất quán:** `stage.ts:217–227` hash canonical entries, adapter so hash với pinned manifest. Không đề nghị reimplement helper.

## Verification và checklist

- Đọc raw RED: 5 behavioral failures (`WORKFLOW_DEFINITION_UNAVAILABLE`), không import failure. Raw GREEN: 5/5 pass, 0 skipped/cancelled. Typecheck log rỗng; exit 0 là claim trong implementer report. Biome raw: `Checked 2 files ... No fixes applied.`; không warning trong final logs. Hash cả bốn logs khớp report.
- Không rerun test/typecheck/lint/build, không Node/native/browser/DB/network/dependency/model/children. Không sửa source, index, manifest hoặc plan task states.
- Resource evidence giữ nguyên giới hạn: RED thiếu strict vm_stat available-memory proof; GREEN thiếu pressure ordinal độc lập trước từng launch. Không gọi đây là resource certification PASS.
- Concurrency/state mutation: P1, filesystem async drift: P2. Errors còn lại propagate, FD đã mở được đóng trong finally. Contract/backwards compatibility: module mới, không sửa exported interface cũ hoặc DB schema. Input validation: có pins/path filtering nhưng P1 làm mất binding sau await. Auth/authz, DB queries/index/N+1 và external error/PII exposure: không có server route/DB/output boundary mới trong slice; không suy rộng kết luận sang T2/server/host. Read I/O tuần tự bounded bởi audited source (15 skills), không N+1 DB.
- Type coverage/test coverage: không có số đo phần trăm; không suy ra từ tsc hoặc 5 tests. Không full-build/E2E/production certification.

## Hành động và trạng thái plan

1. Sửa cả hai root causes trong đúng hai gateway files; bổ sung focused regressions khi controller cấp resource slot.
2. Gửi một frozen fix diff + raw evidence cho scoped re-review hai findings. Không cần chạy lại RED lịch sử hay mở rộng full T3 review.
3. Root hoàn tất flow manifest/generation/docs checks trước source commit. Giữ full T3 server graph/gates, BMAD trusted renderer, T2 integration, production host/admission/isolation và runtime acceptance ở trạng thái pending đúng brief.

**Unresolved:** chưa có runtime regression cho hai findings; chưa chứng nhận actual host binding. Các phần deferred không bị báo nhầm là thiếu phạm vi bounded slice.
