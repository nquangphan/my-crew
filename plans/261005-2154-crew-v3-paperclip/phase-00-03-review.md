# 00-03 — Review độc lập scoped setup

Ngày05/10/2026, Asia/Saigon. Reviewer `pm_skill_review`, không implementer; actual `gpt-6.1-sol` medium. Ownership chỉ report này, không source/lock/hook/ledger/commit/agent edits. Admission PM23:38: weeklyremaining7% từ provider23:34; kernel1/free73%/swap6625MiB/load9,45/disk55GiB; không tác động unrelatedKidyVitest. Chỉ logs/Git/light checks và một loader test được brief cho phép.

## Verdict

**Spec compliance PASS. Quality PASS. 0 finding chặn scopedsetup00-03.** Bốn checks setup hẹp có evidence độc lập; không phải fullbaseline, native/runtime/API/DB/remote hoặc Phase00/release acceptance. Dependency size chưa đo là giới hạn công khai, không được suy từ disk delta.

Inputs: exact `phase-00-03-review-brief.md`, setupbrief và report frozen retry1. Đọc pinned AGENTS/prerequisite doc sections trước representative loader/helper source. Không có source behavior change nên không yêu cầu source-flow patch ở setup gate này.

## Evidence độc lập

- Git tại `.worktrees/paperclip-v3`: branchv3, fullHEAD `8f8a0ab7effbd6a0584107d8038736c134ee5047`. origin fetch/push `git@github.com:nquangphan/crew-paperclip.git`, upstream fetch/push `https://github.com/paperclipai/paperclip.git`; đúng authority trong brief. LICENSE là MIT, copyrightPaperclipAI2025.
- Runtime commands: Nodev24.14.0, Corepack0.34.6, `corepack pnpm --version`9.15.4. Pinned manifest yêu cầu Node>=24.11.0/packageManagerpnpm@9.15.4. Không mutate global pnpm/package pin.
- Reviewer SHA lock trước/sau narrowtest `d7d96cf0d98cf0946f6195e29ba173b03711a947a1c38f312b67cda56c254c22`, khớp recorded trước/sau install. Git tracked diff trống; status sau test chỉ `?? .crew-setup/`, branchv3. Generated deps/build/test cache không phải authored tracked code change.
- Đọc install-retry1 log: frozen lock command child1/network1, root postinstall `link-plugin-dev-sdk.mjs` linked9 excludedplugins/skipped0 và Done. Metrics command/exits0, elapsed254,94s;126pressure samples đều1, pressure_stopfalse. Không ignore-scripts hoặc bypass warning gate.
- Preflight log chạy source-defined workspace-links, nhận stale @paperclipai/shared link ở orchestration example và relink. Metrics exit0,2,02s; đây là setup link repair, không sửa tracked source/lock. SDK log đúng helper building shared→plugin-sdk và exit0. Đọc helper source cho thấy buildTargets TypeScript closure/shared dependency, lock/fingerprint; không broad nativebuild.
- Worker loader log Vitest4.1.11,1file/4tests passed, không skip entry. Đọc actual loader test có bốn it không skip/todo; scope chỉ loginCapability absent/valid/malformed/non-object trong validateAdapterModule, không execute remote/auth/DB.

## Narrowtest reviewer tự chạy

Trước test lấy fresh kernelpressure1, memory_pressurefree75%,load6,28/6,45/5,76 lúc23:39. Không đổi percent thành availableGiB; prior measured loader RSS nhỏ và brief cho phép một selectedfile. Không broad retry khác.

`corepack pnpm --filter @paperclipai/server exec vitest run src/adapters/plugin-loader.test.ts` tại fork → **exit0,1file/4tests passed,0skips**, Start23:39:27,Duration224ms. Tiếp tục `git diff --exit-code`, lockhash và status: tracked clean, lock không đổi, chỉ setup artifact untracked. Không mở server/DB/native/browser/install. Reviewer test foreground đã kết thúc.

## Firstfailure, warnings và resources

Đọc initial metrics riêng còn tồn tại: installnetwork4/child1/PID92985,exit-15,4,07s,pressure_stoptrue,samples1→2warning,peak559568KiB. Supervisor measure.py lấy kernelpressure và TERM đúng new process group khi>=2; timeout20s thì KILL đúng group. Retry chỉ sau fresh admission với network1, vẫn giữ cùng gate; không suy install là nguyên nhân pressure toàn máy.

Retry sampled treeRSS1938176KiB; time log maxRSS2397470720bytes. Preflight/SDK/loader metrics chỉ một sample, tương ứng1216/1472/1920KiB; time maxRSS141836288/740818944/158711808bytes. Report nêu sample2s bỏ lỡ short peaks và time RSS không là toàn systempeak, đúng giới hạn accounting.

Install log vẫn có ENOENT bin warnings cho SDK plugin-dev-server chưa build lúc linking và các paperclip-runner eval/proxy/sidecar outputs. Không đọc blocked generated paths hoặc tự rebuild để che warnings. SDK TypeScript closure sau install đạt nhưng report/checks không chứng minh mọi CLI bin đã được relink hay Rust/native runner tồn tại; **runtime/pluginCLI/native readiness vẫn pending**, không ảnh hưởng gate bốn scopedchecks được giao. Trước00-04 chọn runtime nào phải verify exact required binary/module bằng taskbrief mới, không suy installexit0 thành native ready.

Reviewer `ps -axo pid=,pgid=` hai lần: không còn thành viên thuộc92985/11420/18113/18682/19342. Không kill process khác, kể cảKidyVitest. `.crew-setup` evidence/tooling giữ cho PM archive/cleanup; deps/output giữ để nexttask dùng. Không worker-owned backgroundserver/port được nhận thấy từ owned group check; check này không exhaustive audit toàn máy.

## Gate và limits

Có thể accept00-03 **scopedsetup** và chuẩn bị brief00-04; không tự dispatch successor hoặc transition remote ticket. Exact candidate/ref/toolchain/frozeninstall/preflight/SDKclosure/loader có evidence. Wholeworkspace typecheck/test/build, Rust/native/CLI paths, outboundMacprocess/same-runrecovery/cancellation/authgate/API/DB proof vẫn chưa chạy. Dependency disk size blocked bởi hook đã được report, không bypass bằng path khác. Không còn finding mở trong phạm vi setup; warnings/limits trên phải carry vào nextbrief và handoff.
