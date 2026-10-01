# Nghiệm thu Crew v2 — phần 01

## Kết quả

Đã triển khai năm task của domain foundation trên nhánh `codex/crew-v2-foundation`, base `4da329d`.
Không sửa code ứng dụng v1, không chạm database/production. Chưa merge hoặc push.

- Workspace v2 độc lập và docs chuẩn.
- Model eligibility theo máy/runtime/capability và revision công tắc.
- Workflow pin cùng kiểm tra provenance skill; chưa có sandbox runtime thực tế.
- Ticket transitions và giới hạn năm vòng sửa; đã sửa lỗi inherited-key lookup.
- Completion/docs commit/deploy approval gates.

Đây là thư viện hàm thuần; server, web, macOS app, Trợ lý và runtime adapter chưa được triển khai.
Yêu cầu Trợ lý làm PM, kiểm tra resource mỗi dispatch và cleanup an toàn đã bổ sung vào spec/lộ trình.

## Điều phối và resource

Máy có 24 GiB RAM, 12 CPU logic; các lượt dispatch ghi nhận memory khả dụng 42–48%, disk46Gi,
load khoảng2–7. PM kiểm tra resource trước mọi worker, reviewer và fix dispatch; tối đa3 subagent
hoạt động cùng lúc. Task01 chạy trước; Task02–04 song song, Task05 vào slot trống. Chỉ source/test
khác nhau được viết song song; docs và Git index/commit được serialize.

Implementer dùng gpt-6-sol hoặc gpt-6-luna theo độ phức tạp; reviewer task dùng gpt-6-sol; review
cuối toàn nhánh dùng gpt-6-astra. Không giao worker tự tạo reviewer.

## Review

| Task | Commit ban đầu | Kết quả |
|---|---|---|
| 01 bootstrap | 368fabb | Spec/quality Approved |
| 02 model | 3a76a5f | Approved; minor docs wording được sửa |
| 03 workflow | 011c539 | Approved |
| 04 ticket | b8604ce | P2 inherited lookup tái hiện, sửa ở a5868a1; scoped re-review Approved |
| 05 completion | e590328 | Approved; import/coverage hoàn thiện ở a5868a1 |
| Toàn nhánh | a5868a1 | Không C/I, một minor bảng docs |
| Sửa cuối | 39ecf5c | Minor đã xử lý; scoped final review Approved, không C/I/M còn lại |

## Bằng chứng kiểm tra cuối

- `pnpm --dir v2 test`:14/14 PASS.
- `pnpm --dir v2 typecheck`:PASS.
- Biome check src/test/package/tsconfig:11 files PASS, không error/warning.
- V2 docs `crew-docs check --all` trong Git mirror tạm:PASS; heading đúng thứ tự.
- Root `crew-docs check --range 4da329d..HEAD`:PASS trước commit báo cáo.
- Test/format/style fixes đã có focused evidence; không chạy suite v1 không liên quan.

## Rulings của PM

1. Cho worker ghi file riêng song song dù skill mặc định sequential: owner yêu cầu rõ; rủi ro conflict
   được giảm bằng ownership và serialize shared docs/commit; nếu sai phải tích hợp lại.
2. Execution artifacts nằm trong plans checkout gốc để tuân quy định vị trí Markdown; chi phí là
   bằng chứng nằm ngoài worktree trong lúc chạy, sau đó lưu báo cáo bền vững và xóa scratch.
3. Dùng Git mirror tạm để kiểm tra docs v2 vì CLI v1 lấy outer Git root, không cwd; chi phí là thêm
   bước kiểm tra tới khi có tooling v2. Fixture luôn xóa trong finally.
4. PM ghép docs rồi commit riêng từng task; chi phí là giảm song song phần commit, tránh race Git index.
5. Thêm types:[node] vào tsconfig do TS7 không tự nạp Node types; nếu sai chỉ cần sửa một dòng cấu hình.

## Cleanup và bàn giao

Fixture docs của worker/PM đã xóa. Scratch SDD, các brief/diff/helper/report trung gian và node_modules
riêng vừa cài cho v2 sẽ được dọn sau khi lưu báo cáo này. Giữ code/commit/docs/lockfile và worktree có
nhánh chờ quyết định tích hợp. Không xóa cache/tooling cũ, backup, tài nguyên của project/run khác.

Muốn typecheck sau cleanup: `pnpm --dir v2 install --ignore-workspace --frozen-lockfile`.
Tests dùng Node tích hợp và không cần node_modules. Worktree giữ để owner review, không phải scratch.

## Evidence của implementer


### task-01-report.md

# Task 01 — Workspace Crew v2

Trạng thái: **DONE**. Không commit; PM sẽ gom source và docs rồi commit theo thứ tự chung.

## File đã tạo

- `v2/.gitignore`, `v2/package.json`, `v2/pnpm-lock.yaml`, `v2/tsconfig.json`
- `v2/test/workspace.test.ts`
- `v2/AGENTS.md`, `v2/CLAUDE.md`
- `v2/docs/index.md`, `v2/docs/architecture.md`, `v2/docs/flows.yaml`, `v2/docs/files.md`, `v2/docs/flows/domain-foundation.md`

## Bằng chứng RED → GREEN

1. Tạo `test/workspace.test.ts`, chạy `node --test v2/test/workspace.test.ts`: **FAIL 1/1**, `ENOENT` do `v2/package.json` chưa tồn tại. Đây là lỗi dự kiến của test.
2. Tạo manifest và cấu hình, chạy `pnpm --dir v2 install --ignore-workspace`: exit 0; cài `@types/node 26.6.3` và `typescript 7.0.2` chỉ trong `v2/`.
3. Chạy `pnpm --dir v2 test`: **PASS 1/1**.
4. Chạy `pnpm --dir v2 typecheck`: **FAIL**, TS2591 trên ba import `node:*`. `@types/node` hiện diện trong `v2/node_modules` nhưng TypeScript 7 chưa nạp Node types từ cấu hình này. Bổ sung `compilerOptions.types: ["node"]`; chạy lại: **PASS**.
5. Kiểm tra cuối: `pnpm --dir v2 test` **PASS 1/1** và `pnpm --dir v2 typecheck` **PASS**, exit 0.

## Docs

Đã tạo Git fixture tạm `/tmp/crew-v2-docs.GizvCX` với bản sao package/docs/test của Task 01. Tại đó chạy bundle `crew-docs generate` (cập nhật `docs/index.md`, `docs/files.md`) và `crew-docs check --all` (**ok**, exit 0), chép hai file sinh tự động về `v2/docs/`. Sau khi thêm `AGENTS.md` và `CLAUDE.md`, chạy lại `check --all` trong fixture (**ok**). Fixture đã được xóa bằng `rm -r /tmp/crew-v2-docs.GizvCX`; không còn tài nguyên tạm của task.

## Ruling và tự rà soát

- `tsconfig.json` thêm `types: ["node"]` ngoài mẫu brief để TypeScript 7 nhận các import `node:*`; nếu sai, chi phí là một dòng cấu hình. `noEmit: true` giữ TS không phát sinh code.
- Không chạy `crew-docs` trực tiếp trong `v2/` của worktree: CLI lấy Git root của repo v1. Fixture Git riêng tránh tạo/đổi Git metadata ở `v2/` product.
- `git diff -- pnpm-lock.yaml` không có thay đổi; `git check-ignore -v v2/node_modules` xác nhận `.gitignore` của `v2/` đang áp dụng.
- Khi các task sau thêm `v2/src/*.ts` và test, cần cập nhật `v2/docs/flows.yaml`, trang flow và sinh lại `v2/docs/index.md`/`files.md` trong Git fixture mới trước commit. Kiểm tra docs ở đây chỉ bao phủ file của Task 01.
- Không sửa file v1; chưa stage hoặc commit.


### task-02-report.md

# Task 02: Model eligibility report

## Behavior implemented

`eligibleModels(models, policy)` returns no candidates while `desiredRevision` and `appliedRevision` differ. Otherwise it preserves input order and filters candidates to the selected `machineId`, available models, enabled runtimes, and models containing every required capability. The function filters eligibility only; it does not rank candidates.

## Red/green evidence

- Red: `node --test v2/test/model-policy.test.ts` failed because `v2/src/model-policy.ts` did not exist (`ERR_MODULE_NOT_FOUND`). The test itself parsed and loaded; this was the expected missing-module failure.
- Green: after implementing the module, the focused test passed: 3 tests, 3 passed, 0 failed.
- Formatting: `biome format --write v2/src/model-policy.ts v2/test/model-policy.test.ts` formatted both owned files; focused test rerun passed: 3 tests, 3 passed, 0 failed.

## Docs integration text

For `domain-foundation` flow, describe `eligibleModels(models, policy)` as keeping candidates only when their machine matches the selection, they are available, their runtime is enabled, they satisfy all required capabilities, and the desired/applied config revisions match. It does not score or rank remaining candidates. Add `src/model-policy.ts` under Files and `test/model-policy.test.ts` under Tests. The focused tests cover machine isolation, disabled runtime and stale config revision, capability requirements, unavailable candidates, and preserving an eligible candidate.


### task-03-report.md

# Task03 report — workflow pin và skill provenance

## Kết quả

Đã tạo đúng hai file trong phạm vi được giao:
- `v2/src/workflow-policy.ts`
- `v2/test/workflow-policy.test.ts`

`samePin` so sánh workflow, version, revision và checksum. `workflowsReady` yêu cầu đúng một pin cho mỗi workflow bắt buộc (`bmad`, `superpowers`) và cần tìm thấy pin khớp trong danh sách đã cài. `assertSkillAllowed` ném `WORKFLOW_SOURCE_MISMATCH` khi pin nguồn skill không khớp pin run. Đây là contract gate; không triển khai skill-loader/runtime isolation.

## Red/green

- RED: `node --test v2/test/workflow-policy.test.ts` thất bại với `ERR_MODULE_NOT_FOUND` cho `v2/src/workflow-policy.ts` (module chưa tồn tại; test parse được, không phải syntax error).
- GREEN: `/Users/phannhatquang/Documents/projects/crew/node_modules/.bin/biome format --write v2/src/workflow-policy.ts v2/test/workflow-policy.test.ts` — `Formatted 2 files ... Fixed 1 file.`
- GREEN: `node --test v2/test/workflow-policy.test.ts` — 2 tests pass, 0 fail.

Chưa chạy typecheck/package-wide suite/docs generation theo ranh giới task; typecheck tích hợp được giao cho PM. Không tạo commit.

## Đề xuất nội dung docs cho người tích hợp

**`v2/docs/flows.yaml`**: trong `flows.domain-foundation.files`, thêm `src/workflow-policy.ts`; trong `tests`, thêm `test/workflow-policy.test.ts`.

**`v2/docs/flows/domain-foundation.md` — Các bước**: thêm bước `src/workflow-policy.ts` → `samePin`, `workflowsReady`, `assertSkillAllowed`: readiness cần đúng một pin của mỗi workflow `bmad` và `superpowers`, khớp workflow/version/revision/checksum với pin đã cài; skill chỉ được chấp nhận khi provenance pin trùng pin run, sai thì báo `WORKFLOW_SOURCE_MISMATCH`.

**Files**: thêm `src/workflow-policy.ts` | Contract pin workflow và nguồn skill | `samePin`, `workflowsReady`, `assertSkillAllowed`; thêm `test/workflow-policy.test.ts` | Kiểm tra readiness hai workflow và chặn skill sai workflow/revision/checksum | `cần đủ hai bộ đúng version revision checksum`, `skill bộ khác hoặc revision khác bị chặn, kể cả khi tên skill giống`.

**Tests**: ghi `test/workflow-policy.test.ts` kiểm tra readiness đòi đủ hai workflow, từ chối pin checksum khác và pin workflow trùng; từ chối provenance khác workflow hoặc revision; chấp nhận pin giống hoàn toàn.

## Tự rà soát / lưu ý

Implementation bám contract ở brief, giữ thuần và không tạo state/runtime side effect. `workflowsReady` kiểm tra hai workflow cố định, nên `required` cần có đúng một pin cho cả hai; danh sách installed có thể chứa pin thừa nhưng không thay pin khớp bắt buộc. Có thể chưa có kiểm tra này trong test focused: test hiện chỉ chứng minh thiếu workflow, checksum khác, pin đúng và workflow lặp trong required.

Trong worktree còn có `v2/test/model-policy.test.ts` và `v2/test/ticket-policy.test.ts` là untracked do phần việc song song; em không chỉnh sửa chúng.


### task-04-report.md

# Task04 report — Ticket transitions và năm vòng sửa

## Kết quả

Đã thêm `v2/src/ticket-policy.ts` và `v2/test/ticket-policy.test.ts` theo contract Task04. `transition` chỉ cho phép các cạnh trạng thái đã định nghĩa; trạng thái `running` không nhận `start`/`resume`, `paused`/`needs_input` resume về `pending` để caller đánh giá điều kiện lại, và `reconciled_stopped` đưa run đang chạy về `pending`. `recordRepairFailure` giới hạn counter trong 0–5, bão hòa ở 5 và yêu cầu hỏi owner từ chu kỳ thất bại thứ năm.

## Evidence và lệnh

- RED: `node --test v2/test/ticket-policy.test.ts` — thất bại đúng do `ERR_MODULE_NOT_FOUND` cho `v2/src/ticket-policy.ts`; test parse được, không phải syntax error.
- GREEN sau implementation: `node --test v2/test/ticket-policy.test.ts` — 3 tests pass, 0 fail.
- Format theo yêu cầu PM: `/Users/phannhatquang/Documents/projects/crew/node_modules/.bin/biome format --write v2/src/ticket-policy.ts v2/test/ticket-policy.test.ts` — `Formatted 2 files in 12ms. Fixed 1 file.`
- Verification sau format: `node --test v2/test/ticket-policy.test.ts` — 3 tests pass, 0 fail.
- `git diff --check -- v2/src/ticket-policy.ts v2/test/ticket-policy.test.ts` — exit 0, không có lỗi whitespace.

Không chạy `pnpm --dir v2 typecheck`, toàn bộ `pnpm --dir v2 test` hay `crew-docs check --all`: phần tích hợp docs và typecheck thuộc PM; em chỉ chạy focused test theo yêu cầu thực thi trong worktree chia sẻ. Chưa commit.

## Đoạn đề xuất cho `v2/docs/flows/domain-foundation.md`

`transition(status, signal)` chỉ quyết định cạnh chuyển trạng thái trong miền. Caller chỉ phát các signal xác nhận như `pause_confirmed`, `cancel_confirmed` và `passed` sau khi đã đối soát process; việc kiểm tra dependency và lease phải diễn ra trong transaction phía server. Mất mạng không tự cho phép khởi chạy hoặc resume một attempt đang chạy: caller cần reconciliation để xác nhận process đã dừng rồi mới phát `reconciled_stopped`. `recordRepairFailure(completedCycles)` đếm chu kỳ sửa và kiểm tra lại đã hoàn tất nhưng thất bại; lỗi review ban đầu và quota không tính vào counter. Ở chu kỳ thất bại thứ năm, action là `ask_owner` và counter không tăng thêm hoặc tự reset.

## Phạm vi / lưu ý

Chỉ hai file ownership được tạo/chỉnh sửa. `git status` cũng có `v2/test/model-policy.test.ts` và `v2/test/workflow-policy.test.ts` chưa được track từ worker khác; giữ nguyên các file đó. Không chạm shared docs, registry hay Git staging.

## Round 1 reviewer fix: inherited property lookup

Thêm regression coverage cho inherited keys ở cả status và signal: signal `toString`/`constructor`, status `toString`/`constructor` kết hợp với inherited edge key. RED command `node --test v2/test/ticket-policy.test.ts` thất bại trong test mới với `AssertionError: Missing expected exception` tại assertion đầu tiên (`transition('pending', 'toString' as Signal)`), chứng minh lookup cũ chấp nhận key kế thừa.

Fix dùng `Object.hasOwn(edges, status)` trước khi lấy status table và `Object.hasOwn(statusEdges, signal)` trước khi lấy transition. Giữ nguyên signature và bảng edge. Chạy `/Users/phannhatquang/Documents/projects/crew/node_modules/.bin/biome check --write v2/src/ticket-policy.ts v2/test/ticket-policy.test.ts` — `Checked 2 files in 21ms. Fixed 2 files.` Sau đó `node --test v2/test/ticket-policy.test.ts` — 4 tests pass, 0 fail; test prototype mới cùng ba test hành vi trước đều qua. `git diff --check -- v2/src/ticket-policy.ts v2/test/ticket-policy.test.ts` không báo lỗi. Chưa commit; shared docs vẫn do PM cập nhật.

## Integration typecheck correction

Thêm `type Signal` và `type Status` vào import của regression test vì các type casts mới dùng chúng. Chạy `/Users/phannhatquang/Documents/projects/crew/node_modules/.bin/biome check --write v2/test/ticket-policy.test.ts` — `Checked 1 file in 23ms. Fixed 1 file.` Focused `node --test v2/test/ticket-policy.test.ts` — 4 pass, 0 fail. `pnpm --dir v2 typecheck` — thành công (`tsc --noEmit`, exit 0).


### task-05-report.md

# Task05 report — completion policy

## Kết quả

Đã tạo `v2/src/completion-policy.ts` và `v2/test/completion-policy.test.ts` theo ownership. `canComplete` yêu cầu các bước bắt buộc và evidence sẵn sàng; với `code`, cần merge commit và docs commit trùng nhau; `docs` cần docs commit; `research` không cần merge nhưng vẫn cần evidence và các bước bắt buộc. `canDeploy` chỉ cho qua khi có deploy ticket hoặc owner approval.

## TDD và kiểm tra

- RED: `node --test v2/test/completion-policy.test.ts` thất bại do không resolve được module `../src/completion-policy.ts` vì file chưa tồn tại; đây là lỗi thiếu module dự kiến, không phải syntax error.
- Format: `/Users/phannhatquang/Documents/projects/crew/node_modules/.bin/biome format --write v2/src/completion-policy.ts v2/test/completion-policy.test.ts` — hoàn tất, định dạng 2 file.
- GREEN: `node --test v2/test/completion-policy.test.ts` — 3 tests pass.
- Self-review: xem lại hai file thuộc ownership; `git diff --check -- v2/src/completion-policy.ts v2/test/completion-policy.test.ts` không báo lỗi. Không chạy typecheck hoặc suite rộng vì PM giữ integrated typecheck và xác nhận tích hợp.

## Đề xuất nội dung docs cho PM

Trong `v2/docs/flows.yaml`, thêm `src/completion-policy.ts` vào `files` và `test/completion-policy.test.ts` vào `tests` của `domain-foundation`.

Trong `v2/docs/flows/domain-foundation.md`, cập nhật bước để mô tả:

- `src/completion-policy.ts` → `canComplete`: mọi loại cần mandatory steps và evidence; `code` chỉ đóng khi merge commit và docs commit giống nhau; `docs` cần docs commit; `research` không cần merge.
- `src/completion-policy.ts` → `canDeploy`: cần deploy ticket riêng hoặc owner approval, độc lập với việc feature đã hoàn tất.
- Thêm hai dòng trên vào bảng Files với symbols `canComplete`, `canDeploy`; thêm test `test/completion-policy.test.ts` vào Tests, ghi các trường hợp docs chưa sync, research không cần merge nhưng cần evidence, và điều kiện deploy.

## Giả định nguồn và giới hạn

Các điều kiện bool/commit trong `Completion` và đầu vào `canDeploy` là dữ liệu đã được server xác minh; module miền chỉ áp dụng gate và không chứng thực nguồn approval, commit hay artifact. Không suy ra `docsCommit` là commit ancestor hay một dạng đồng bộ khác: theo brief, với code nó phải bằng chính xác `mergedCommit`.


### integration-report.md

# Báo cáo rà soát tích hợp Crew v2

## Phạm vi và thay đổi

- `v2/src/workflow-policy.ts`: bỏ non-null assertion bằng guard `target !== undefined`, giữ điều kiện đúng một pin bắt buộc cho mỗi workflow.
- `v2/test/completion-policy.test.ts`: bổ sung ca docs thiếu/có snapshot và xác nhận `mandatoryStepsPassed`, `evidenceReady` đều bắt buộc cho code, research, docs.
- `v2/test/completion-policy.test.ts`, `v2/test/model-policy.test.ts`, `v2/test/workflow-policy.test.ts`, `v2/test/workspace.test.ts`: chuẩn hóa thứ tự import bằng Biome.
- `v2/docs/index.md`, `v2/docs/flows/domain-foundation.md`: phản ánh bốn policy đã có, các giới hạn tích hợp, điều kiện hoàn tất và guard khóa status/signal thuộc chính đối tượng. Thứ tự bước 1–6 liên tục.
- Không sửa `v2/src/ticket-policy.ts`, `v2/test/ticket-policy.test.ts`, manifest hay các file ngoài phạm vi; worker khác phụ trách ticket policy.

## Kiểm chứng

| Lệnh | Kết quả |
|------|---------|
| `/Users/phannhatquang/Documents/projects/crew/node_modules/.bin/biome check --write v2/src/workflow-policy.ts v2/test/completion-policy.test.ts v2/test/model-policy.test.ts v2/test/workflow-policy.test.ts v2/test/workspace.test.ts` | Exit 0; 5 file được kiểm tra, 4 file được sửa. |
| `/Users/phannhatquang/Documents/projects/crew/node_modules/.bin/biome check v2/src/workflow-policy.ts v2/test/completion-policy.test.ts v2/test/model-policy.test.ts v2/test/workspace.test.ts` | Exit 0; 5 file sạch. |
| `pnpm --dir v2 test` | Exit 0; 14/14 test đạt, 0 fail. |
| `pnpm --dir v2 typecheck` | Exit 1; `test/ticket-policy.test.ts` dòng 25–29 thiếu import type `Signal` và `Status` (6 lỗi TS2304). Đã báo parent; file thuộc worker khác. |

Các lệnh chạy tại `/Users/phannhatquang/.codex/worktrees/crew-v2-foundation/crew`. PM sẽ chạy lại typecheck sau khi worker ticket sửa import, cùng bước kiểm tra tích hợp cuối. Chưa chạy check docs theo checkout `v2/` riêng vì checkout hiện tại có Git root là repo Crew gốc; PM xử lý bước tích hợp/check cuối.

## Bổ sung sau rà soát tài liệu

Đã bỏ đúng bốn dòng trống giữa các hàng trong bảng `Files` của `v2/docs/flows/domain-foundation.md`; các phần khác giữ nguyên. Kiểm tra bằng Python xác nhận 13 dòng bảng liên tục, tất cả bắt đầu bằng `|`. `git diff --check -- v2/docs/flows/domain-foundation.md` đạt (exit 0); diff chỉ gồm bốn dòng trống bị xóa.

