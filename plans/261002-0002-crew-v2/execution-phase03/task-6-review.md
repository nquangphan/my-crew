# Task 6 — independent full SPEC / QUALITY review

Ngày: 2026-10-02. Base **6150254**, candidate **f6ca0a4**.

**SPEC: NOT READY. QUALITY: NOT READY.** Có **1 finding P2** cần sửa trong Task6. Không có P1; không yêu cầu model turn, native Skill invocation hoặc chứng nhận runtime ngoài phạm vi đã duyệt. Đây là full initial review, không phải acceptance toàn phase03.

## Binding và phạm vi đã đọc

- Đọc Task6 của approved `phase-03-macos-workflows.md`, brief, **toàn bộ `task-6-report.md`**, v2 index, gateway-workflows/gateway-host và các ruling PM16:55,17:26,17:48,18:07,18:18. Các giới hạn init/discovery/overall UNVERIFIED và test-only guard repair là cơ sở review.
- Đọc đầy đủ bốn module isolation, hai isolation tests, hai support files, package script, retirement-crash test và toàn bộ thay đổi R3/R2/generated mapping trong task-only patch. Đối chiếu consumer với actual `OwnedOperations`, native execute/delete, `AtomicRecords` và registry retain/resolve/release; không sửa hoặc mở rộng producer.
- Tự kiểm **12/12 frozen file rows**: mode, bytes và SHA-256 khớp; **87/87 evidence rows**: bytes và SHA-256 khớp. Inventory không tự chứng nhận runtime.
- PM task-only diff `6150254..f6ca0a4`: **104,168 bytes**, SHA-256 **`5842f0c7b1117c9a9e49271e4b9723e65380674e1c3e10ccc4447287a2bfee18`**. Có14 paths:12 frozen files cộng `v2/docs/flows.yaml` và generated `v2/docs/files.md`. Mapping bổ sung đúng4 production files và4 tests/support; reorder các entry cũ không bỏ mapping.
- Candidate binding dựa trên PM exact commit/diff và frozen byte sets đã tự đối chiếu. Reviewer không dùng Git, không lấy peer model/attachment source để chạy test, không ghi source hoặc shared settings.

## Finding cần sửa

### F1 — P2: `.git` exemption của workspace làm HOME audit bỏ qua hardlink nguồn ngoài

**Vị trí chính:** `v2/gateway/src/isolation/inventory.ts:158`.

**Luồng liên quan:** `workspace.ts:560–564` dùng cùng `auditWorkspace` cho `attemptHome`; `policy.ts:24–36` grant toàn bộ attemptHome nhưng deny Git chỉ ở `${workspace}/.git`.

`auditWorkspace` bỏ qua entry `.git` tại gốc **trước `lstat`, inventory, link-count hoặc recursion**, với giả định nó được kiểm bằng Git inventory riêng. Giả định chỉ đúng cho execution workspace. Khi root là HOME, không có bước độc lập nào kiểm `HOME/.git`: `verify()` chỉ kiểm `homeInventory.blockers` và hai baseline config files, còn Git inventory tiếp theo chỉ thuộc workspace.

Trigger cụ thể: sau prepare, tạo directory `attemptHome/.git`, đặt trong đó một hardlink tới canary thuộc nguồn ngoài trên cùng filesystem. Không cần thay source/projection pin, baseline config hoặc workspace bytes. HOME audit sẽ trả không có entry/blocker cho directory này; source/registry verification không nhìn thấy file canary ngoài registry; policy cho đọc path hardlink dưới HOME. Khác symlink, hardlink không canonicalize sang path nguồn ngoài để sandbox chặn. Như vậy preflight có thể tiếp tục các command và ghi `pins-and-workspace: PASS` thay vì phát hiện hardlink/cross-source trước runtime. Overall vẫn UNVERIFIED/disabled nên chưa phải bypass production dispatch; lỗi thuộc chính integrity/alias gate Task6 đang triển khai.

**Bằng chứng:** nhánh `continue` ở158 là vô điều kiện cho mọi root, nên toàn bộ kiểm `nlink !== 1` ở187–188 và `fileDigest` ở138 không thể chạy trên entry này. `workspace.ts:565` chỉ audit `workspace/.git`, không bù HOME gap. Test hiện tại phủ hardlink trực tiếp dưới workspace và HOME symlink, không phủ HOME top-level `.git`. Đây là kết luận xác định từ control flow và policy, **chưa phải canary kernel do reviewer chạy thành công**.

**Sửa yêu cầu:** giới hạn exemption `.git` vào workspace đang có exact Git inventory được kiểm riêng, hoặc từ chối/scan `.git` trong HOME trước bất kỳ measurement nào. Giữ deny object database của execution workspace; không mở grant để làm test qua. Các caller audit Git metadata cũng không được vô tình bỏ qua một subtree `.git` khác.

**Regression yêu cầu:** actual owned fixture chuẩn bị thành công, tạo foreign canary cùng filesystem, hardlink vào `attemptHome/.git/foreign-skill`, rồi preflight phải FAIL với cross-source/integrity blocker và `commands.length === 0`; dọn chỉ owned links theo identity. Thêm HOME `.git` symlink/nested metadata case và control cho workspace Git inventory hợp lệ vẫn hoạt động, còn sửa workspace objectdb vẫn bị reject/deny. Không cần model call hay native producer change.

## Những phần đáp ứng phạm vi đã duyệt

- Factory yêu cầu actual `WorkflowRegistry`, module wrappers chưa bind deny. Consumer input không nhận caller proof/projection path. Source/projection clone và resolve/retain lại bên trong registry transaction; command intents giữ pin khi thiếu closure. Public factory không expose raw `measure`.
- Prepare giữ exact reference trước stage/clone; ordinary CLT Git đọc owner, write chỉ own scratch. Fixed exec-only shell sử dụng quoted argv và exact commit input; không arbitrary eval/script. Pack stdout exclusive, giới hạn64MiB, header/version/trailer/SHA, strict index single-thread, exact HEAD/tree/clean/common-dir checks. Discovery được chuyển khỏi CWD, có per-path inventory và lý do; product docs giữ lại. Pack chứa excluded history được ghi rõ và policy deny toàn bộ workspace Git objectdb.
- Codex discovery geometry giữ P ngoài CWD; một link từ own `.agents/skills` tới P, không transplant15 relative links hoặc sửa upstream bytes. Registry resolve kiểm projection/native policy trước và sau phép đo. Root AGENTS/hooks/marketplace không bị trình bày thành chứng nhận invocation.
- Private HOME/config/TMP/XDG và native fixed environment không kế thừa credential/proxy/module env. Candidate sandbox deny data theo path, fork/network/securityd; literal `/` phục vụ dyld không đồng nghĩa subpath `/`. Shell canaries gồm selected bytes, owned read, absolute/`..`/symlink và actual Git pack denial. F1 là ngoại lệ audit cần đóng trước nghiệm thu.
- Command reserved → owned identity → pending được fsync trước native execute. Receipt được actual `OwnedOperations.execute` đối chiếu operationId/device/inode/nofork/treeEmpty sau native kernel EXIT/wait; không nhận boolean STOP từ caller. Output/stdin/policy/argv identities được ghi, timeout không được đồng nhất với missing receipt. Thiếu receipt/fork khiến verify và cleanup giữ state/pins; reopen không tự chạy lại probe. Numeric PID/start được ghi unavailable theo producer API, không bịa.
- Lock order isolation transaction → registry read/reference; không callback registry quay lại isolation. Cleanup chỉ tiến khi các measurement command có closure receipt; native no-follow identity/quarantine/delete giữ nguyên. Lỗi/mất identity giữ resource thay vì suy quyền xóa từ path/PID absence.
- API audit chỉ source/projection policy inventory. `routerPolicy` source null và disabled. `preflight` không có return overall PASS; mọi surface native Read/Skill/MCP/child/full-tree/renderer invoke luôn có explicit UNVERIFIED blocker ở phase này.

## Validation captured đã kiểm

- Frozen suite: **126/127 PASS,1 FAIL,0 skip**, wall264.97s, exit1. Cả6 Task6 tests PASS. Failure baseline là retirement `after-write`, `Host guard unavailable (75)`.
- Narrow whole-file rerun trước repair: **2/3 PASS,1 FAIL** ở `after-filter`, cùng lỗi75. Giữ nguyên hai failure logs này.
- PM18:18 chỉ duyệt test-only retry acquisition cho exact `process-journal` và `workflows`: actual AtomicRecords acquire rồi close/await, chỉ exact message75, deadline1500ms/backoff10–100ms; lỗi khác propagate. Test không retry cả fixture, không xóa lockfile/force unlock hoặc biến SIGKILL worker thành STOP của guarded helper.
- Sau exact one-file overlay: strict types exit0, **whole retirement file3/3 PASS** một lần, wall7.79s; Biome test exit0. Không gọi đây là127/127 PASS và không cộng các lượt thành union PASS. Phần assertions retirement/receipt/GC/resurrection vẫn nguyên.
- Frozen build/full strict types exit0. Scoped Biome9 files:0 errors/warnings; formatting diagnostics trước đó và test formatting repair còn trong evidence. Snapshot nguồn trước256 entries, sau258 vì đúng2 compiler configs; final source delta chỉ approved retirement test repair. Loader chỉ resolve bare `tar-stream`, TS path chỉ exact installed declaration, không wildcard hoặc `skipLibCheck`.
- Cover manifest có23 explicit test files =21 accepted gateway +2 isolation, private PostgreSQL prefix8, baseline9182e89 cùng13 accepted7c7c719 overlays và own Task6 files. Không peer model/attachment candidate hoặc migration009+ trong cover. PM package script/R3 được kiểm riêng sau snapshot, không tuyên bố chúng có trong baseline package snapshot.
- Hai package CLI probes exact args Claude/Codex đều exit0, wall26.84s/15.22s. Tự parse7 raw runtime/API results từ cover và hai logs: tất cả **UNVERIFIED**, `productionEnabled:false`. Mọi command receipt trong7 results khớp operationId/device/inode của stage, treeEmpty=true/forkObserved=false; không coi việc parse receipt là độc lập đo native kernel.
- Claude CLI list ghi selected Superpowers6.4.2; initialize empty/timeout không chứng minh loaded hooks/skills. Codex initialize metadata có thật, không có skills/hooks/config replies; không suy IPC unsupported từ EPERM lịch sử. API7-command audit không phải model/tool loop. Sanitized matrix là summary, raw logs giữ exact paths/argv/hash.
- Reviewer không rerun broad tests, DB, Git clone hoặc runtime discovery; captured checks không bao gồm regression F1 còn thiếu. Không có claim các test trên do reviewer tự chạy.

## Non-blockers và handoff

- Linked owner common-dir ngoài allowed root tiếp tục fail closed/UNVERIFIED theo ruling; Task7/trusted composition và review riêng phải xử lý binding, không grant guessed parent. Không yêu cầu worker mở rộng ở review này.
- Actual native Read/Skill/Bash/MCP/child load+invoke, inherited boundary/full-tree, BMAD runtime, system/common skill provenance, official renderer và executable deployment/certification vẫn là gate phase04/09. Init/CLI/version/source checksums không thay những gate đó. HOME dynamic discovery inventory cũng phải được audit trong chứng nhận sau này; F1 là lỗi alias cụ thể hiện tại, không yêu cầu complete paid-runtime proof.
- Script probe dùng executable paths của máy fixture hiện hành; missing runtime trả UNVERIFIED. Chưa là portable production packaging/host composition.
- Source integrity đang được đo, không phải certificate chống mọi concurrent same-UID mutation. Review không coi source SHA/receipt đơn lẻ là authority bật dispatch; phase06/08 defaults còn riêng.

## Resources, cleanup và hạn chế evidence

Worker inventory hash-verified có **23 Task6 roots:15 absent,4 reserved-intent UNKNOWN,4 historical identity-evidence gaps**. Bốn negative roots giữ24,217,120 bytes theo report; bốn diagnostic Unix artifacts đã overwrite root identity bằng stage identity nên không được xóa dựa current stat. Không nâng những gap này thành stopped.

Baseline cover/rerun inventory ghi50 identities:39 absent/11 retained, gồm9 UNKNOWN và2 guard-race roots, cộng1 baseline genuine-fork retained. Captured private container absent và snapshot deletion riêng; reviewer xác nhận snapshot exact path hiện absent. Không rescan/reap hoặc xóa UNKNOWN/baseline roots.

First15 cleanup receipt table bị reconciliation lần2 overwrite: còn raw native logs và script/count nhưng thiếu bảng đầu để reviewer độc lập chứng minh đầy đủ từng deletion. Đây là **evidence limitation được giữ nguyên**, không gọi là full cleanup proof; không sửa lịch sử hoặc tạo receipt để lấp. Không có bằng chứng code candidate nới native deletion authority từ lỗi diagnostic này.

Reviewer dự định một canary filesystem nhỏ cho F1; **PreToolUse hook chặn toàn bộ command trước chạy** với `Access to '.git' denied`. Không đổi ignore/settings, không dùng đường vòng. Vì command chưa chạy, reviewer không tạo temp root, native child, journal guard, DB/container hoặc resource cleanup riêng. Finding F1 dựa trên line-by-line code/policy proof; regression thực cần thực hiện trong lượt fix được PM duyệt.

## Disposition

Một batch sửa duy nhất cho **F1/P2** cùng regression và R3 tương ứng; review lại exact diff. Giữ nguyên mọi producer/native/proof/schema/model gate. Không có finding thứ hai bị giữ lại cho lượt sau; các nội dung chưa đo được ghi rõ trong handoff thay vì yêu cầu mở rộng scope.
