# 00-03 — Baseline setup hẹp, retry1

Updated05/10/2026 23:36 Asia/Ho_Chi_Minh. **Implemented, chờ independent review:** frozen install, workspace preflight, shared/SDK TypeScript build và adapter-loader test đều exit0. Scope test đúng **1file/4tests passed,0skips**. Không phải full baseline hoặc Phase00 remote acceptance. Lần install đầu bị resource stop được giữ nguyên evidence phía dưới.

Context core cùng worker; score6=1+U2+C2+I1. Actual model `gpt-6-astra` high thay planned standard theo PM để giữ verified core context cho00-04 risk9; chưa đo lượng token tiết kiệm. Ownership chỉ report này và isolated setup artifacts trong fork; không source/lockfile/protected-policy edits, agents, commit hoặc push.

## Checkout và toolchain đã xác minh

- Fork `/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-v3`, branch `v3`, HEAD `8f8a0ab7effbd6a0584107d8038736c134ee5047`.
- origin `git@github.com:nquangphan/crew-paperclip.git`; upstream `https://github.com/paperclipai/paperclip.git` (cả fetch/push).
- Node `v24.14.0`, Corepack `0.34.6`; `corepack pnpm --version`=`9.15.4` đúng packageManager. Không đổi global pnpm.
- Lockfile SHA256 trước/sau hai lượt install đều `d7d96cf0d98cf0946f6195e29ba173b03711a947a1c38f312b67cda56c254c22`.
- `git diff --exit-code` exit0 và `git status --short --branch` sau checks chỉ `?? .crew-setup/` ngoài branchv3. Tracked source không đổi; primary Crew/v3 và sourcev2 không sửa.
- Không có `.codegraph`, không index. Đã đọc upstream AGENTS/bộ docs prerequisite; setup/test/security/DB sections được đọc riêng. `doc/DEVELOPING.md:348–372` yêu cầu check hẹp trước; docs/spec illustrative adapter interface không thay actual types pinned.
- Root postinstall `scripts/link-plugin-dev-sdk.mjs` đã đọc: links excluded plugins. SDK helper `scripts/ensure-plugin-build-deps.mjs` đã đọc: TypeScript shared→SDK tuần tự, có lock/fingerprint.

## Commands đã chạy theo thứ tự và kết quả

Cwd tất cả ở fork. Từng command được `.crew-setup/phase00-03/measure.py` bọc `/usr/bin/time -l`, chạy process group riêng, sample RSS/kernel pressure mỗi2s, dừng khi warning/critical. Không ignore-scripts. `pnpm help install` xác nhận hỗ trợ hai concurrency flags.

```sh
corepack pnpm install --frozen-lockfile --child-concurrency 1 --network-concurrency 1 --reporter append-only
corepack pnpm run preflight:workspace-links
corepack pnpm --filter @paperclipai/plugin-sdk ensure-build-deps
corepack pnpm --filter @paperclipai/server exec vitest run src/adapters/plugin-loader.test.ts
```

| Label evidence | PID/PGID | Exit | Elapsed supervisor | Kết quả |
|---|---:|---:|---:|---|
| install-retry1 | 11420 | 0 | 254.94s | Frozen install + lifecycle scripts hoàn tất; root postinstall linked9 excludedplugins, skipped0 |
| preflight-retry1 | 18113 | 0 | 2.02s | Workspace-link preflight thành công |
| sdk-retry1 | 18682 | 0 | 2.02s | Helper ghi Building @paperclipai/shared và @paperclipai/plugin-sdk; TypeScript closure hoàn tất |
| loader-retry1 | 19342 | 0 | 2.02s | Vitest4.1.11: 1file/4tests passed,0skips; runner duration209ms |

Loader test xác minh `validateAdapterModule` chấp nhận không có/đúng login capability và từ chối malformed/non-object capability. Đây là existing pure loader contract tests, không chứng minh remote transport, auth JWT issuance, mutation gate hoặc DB. Không mở app server/DB trong task này.

## Resource và process proof

PM admission retry23:29 weekly remaining8%/reserve1%; kernel1/free79%/swap6953MiB/load3.58/disk57GiB. Worker pre-retry23:30 kernel1/free78%/swap6937.62MiB/load4.56/disk57GiB. Các retry1 samples đều kernelpressure1; không resource stop.

| Command | Sampled process-tree peak RSS KiB | `/usr/bin/time -l` max resident set size bytes |
|---|---:|---:|
| Install retry1 | 1938176 (≈1.85GiB) | 2397470720 (≈2.23GiB) |
| Preflight | 1216 | 141836288 |
| SDK closure | 1472 | 740818944 |
| Loader | 1920 | 158711808 |

Sampling2s bỏ lỡ peak của các command ngắn; dùng thêm time maxRSS, không gọi sample là peak tuyệt đối. Time maxRSS là accounting của lệnh/con, không phải tổng peak toàn hệ thống. Sau checks23:36 kernel1/free73%/swap6681.62MiB/disk55GiB; không suy GiB available từ freepercentage hoặc coi chênh lệch disk toàn hệ thống là dependency size.

23:36:23+07 đã kiểm danh sách PID/PGID: **không còn process thuộc11420/18113/18682/19342**. Không background server/port/job do worker giữ. Dependency/output artifacts giữ nguyên để next task dùng, không xóa cache hoặc source scratch.

## Evidence paths

Tất cả logs/tooling trong fork `.crew-setup/phase00-03/`:

- `measure.py` — supervisor/resource stop.
- `install-retry1.log`, `install-retry1.metrics.json`.
- `preflight-retry1.log`, `preflight-retry1.metrics.json`.
- `sdk-retry1.log`, `sdk-retry1.metrics.json`.
- `loader-retry1.log`, `loader-retry1.metrics.json`.
- `install.log`, `install.metrics.json` — lần đầu bị resource stop, không ghi đè.

Không dump env/provider credential. `.crew-setup` chưa stage/ignore; PM quyết định archive/cleanup trước commit. Hook `.ckignore` chặn đề xuất log dưới `.git` trước khi chạy, đã chuyển thư mục tooling thường. Hook chặn `du -sh node_modules`, nên dependency size chưa đo; không sửa hook hoặc dùng cách khác đọc đường bị chặn. Native dependency lifecycle trong install đã chạy theo pnpm; không đồng nghĩa Paperclip native runner/Rust build đã chạy.

## Lần đầu và giới hạn hiện tại

Initial install dùng network-concurrency4/child1, PID92985, stop sau4.07s khi kernelpressure1→2 warning; subprocess-15/SIGTERM, wrapper143. Sampled treeRSS559568KiB; log cuối resolved1301/reused309/downloaded33/added342. Không kết luận install gây system warning. Process group đã sạch23:17:28; lockfile không đổi. Retry1 chỉ chạy sau PM admission mới, giảm network1 và không tự retry vòng lặp.

**Native/full scope vẫn pending:** không chạy full typecheck/test/build, Rust/native suite, browser, API/DB hoặc real gateway Mac process. Rust chưa cài/xác minh; không gọi cargo. Không migration/DB mutation, không remote prototype, không dùng4tests này làm chứng nhận no-bypass/restart hoặc release. Dependency install thành công không đổi các acceptance gates này.

## Delta cho00-04, chưa thực thi

Đã có exact fork/toolchain/dependency closure và loader contract executable. Prototype package dùng `createServerAdapter(): ServerAdapterModule`, execute Promise, optional AbortSignal/onCancellationReady, sessionCodec và event/log/result callbacks. Actor token cần runtime legacy+supportsLocalAgentJwt+signing config; task cần API token phải fail closed khi thiếu. Guard mutation nằm sau row lock `issueService.update`; machine reservation thuộc core claim/common dispatch.

Chưa freeze implementation: outbound Mac-only workspace realization, exhaustive writer/native warm-dispatch inventory, durable same-run adoption/restart và physical stop proof còn cần brief/test riêng. Paperclip giữ scheduler/run authority; không queue Crew thứhai. Worker giữ core context chờ PM review00-03 và dispatch00-04, không tự làm tiếp.

Unresolved Qs: dependency disk size bị local hook chặn; full/native/API/DB/gateway proof ngoài scope chưa chạy. Không có blocker còn mở đối với bốn checks baseline hẹp đã giao.
