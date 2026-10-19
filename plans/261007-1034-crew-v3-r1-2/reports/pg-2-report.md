# Báo cáo PG-2 (gói plugin, lượt giao tiếp)

Nhánh `crew/r12-plugin`, không push, không deploy.

## Việc 1: plugin đánh thức integrator
- SHA: `2b382bb64bda19a5269603039813ce4000990f38`.
- File: mới `packages/crew-plugin/src/integrator-wake.ts`, `server/src/__tests__/crew-integrator-wake.test.ts`; sửa `worker.ts`, `manifest.ts` (thêm `agents.read`, `agents.invoke`, và `plugin.state.read/write` cho idempotency).
- Hành vi: bắt `issue.updated` có `status: done` (và `_previous.status` khác `done`), đọc lại issue (phải còn `done`, không `parentId`), lấy integrator rồi gọi `ctx.agents.invoke(integratorAgentId, companyId, { prompt, reason: "crew_merge" })`. Idempotent theo issue và `completedAt` (state `integrator-wake`): chạy lại sau một vòng hoàn tất mới thì đánh thức lại, cùng vòng thì không. `invoke` lỗi (paused, terminated…) thì ghi log lỗi và comment vào issue, không ghi mốc nên lần sau thử lại.
- Lệnh: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-integrator-wake.test.ts src/__tests__/crew-plugin-manifest.test.ts src/__tests__/crew-run-cancelled.test.ts` → `Test Files 3 passed (3) / Tests 15 passed (15)` (gồm test bundle). `corepack pnpm --filter @crew/paperclip-plugin typecheck` sạch.

### Lệch yêu cầu: không đọc `CREW_POLICY_CONFIG`
Worker plugin chạy với env tối thiểu: `plugin-worker-manager.ts` (`spawnProcess`) không spread `process.env`, `buildPluginWorkerEnv` chỉ chuyển biến adapter khi plugin có `environment.drivers.register`. Biến `CREW_POLICY_CONFIG` không tới được worker. Em lấy `integratorAgentId` từ `executionPolicy` của chính issue gốc: template gốc `[review reviewer, review integrator, approval owner]`, stage thứ hai là integrator. Server khoá policy trước agent sửa, nên nguồn này tin được; issue không có template (company chưa cấu hình Crew) thì plugin không làm gì, tương đương "company vắng". Sai thì lệch nếu board gửi policy riêng cho issue gốc: khi đó không có đúng cấu trúc ba stage thì plugin bỏ qua.

### Khác
- Board ép `done` khi stage integrator chưa chạy cũng đánh thức integrator; integrator tự kiểm bằng chứng docs theo instructions nên không merge nếu thiếu.
- `agents.read` đã khai báo theo yêu cầu nhưng code chưa gọi `ctx.agents.get`.
- Chưa kiểm trên server thật: sự kiện `issue.updated` mang `status` và `_previous.status` ở payload (đọc từ `routes/issues.ts` và `activity-log.ts`); AC-2 nên kiểm một lần.

## Việc 2: `verify.sh` với đường dẫn khác hoa thường
- SHA: `5956d62d743b6fe825e9ef261ad27394cbadda67`.
- Nguyên nhân: `$PWD` giữ nguyên hoa thường người dùng gõ (`~/Documents/projects`), `git rev-parse --show-toplevel` trả `Projects`; so chuỗi `"$ROOT" != "$(pwd -P)"` ra khác nhau và thoát 70.
- Sửa: `verify.sh` so `[ "$ROOT" -ef . ]` (cùng inode) rồi `cd "$ROOT"`. Cùng kiểu so chuỗi còn ở `crew/release/upgrade.sh` (`check_toplevel`): đổi sang `-ef`. Đã rà `crew/ops/*.sh` (ROOT cố định `/opt/crew-v3-spike`, `FORK` tính bằng `pwd -P` rồi chỉ dùng làm cwd, không so chuỗi), `check-core-hooks.mjs` (không so đường dẫn): không cần sửa.
- Tái hiện và test thật: `PWD=/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-r12-plugin bash -c '… old check …'` in `old check would exit 70`; cùng điều kiện chạy `bash crew/release/verify.sh` → `rc=0`, đuôi log `XANH: mốc hook đủ, test vá và typecheck đạt` (gồm bước build plugin). `node --test crew/release/upgrade.test.mjs` → `tests 8 / pass 8 / fail 0`. `bash -n` đạt.

## Sửa sau review
- SHA: `e346fb136673eeb231c6d0af2a118a59b419602f`.
- M1: chỉ đánh thức khi `typeof _previous.status === "string" && _previous.status !== "done"`; PATCH `done` lên issue đã done (không có `_previous`) không còn gọi integrator.
- m1: bỏ `agents.read` khỏi manifest (còn `events.subscribe`, `issues.read`, `issues.update`, `issue.comments.create`, `agents.invoke`, `plugin.state.read/write`).
- m2: `invoke` của SDK chỉ nhận `prompt` và `reason`, không có trường ngữ cảnh issue, nên prompt nêu cả identifier lẫn id issue.
- m3: ghi mốc state chỉ sau khi `invoke` thành công; `state.set` lỗi thì log error và chấp nhận gọi trùng (đã ghi ruling vào ledger); comment báo lỗi cũng bọc try để lỗi comment không làm ném handler.
- RED: 3 test mới fail (`Tests 3 failed | 7 passed (10)`). GREEN: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-integrator-wake.test.ts src/__tests__/crew-plugin-manifest.test.ts src/__tests__/crew-run-cancelled.test.ts` → `Test Files 3 passed (3) / Tests 18 passed (18)`; `corepack pnpm --filter @crew/paperclip-plugin typecheck` sạch.

## Sửa sau review toàn nhánh
- SHA (M3, m1): `2606ab3f0966ddf2be35f0f3286795ae6ec9f3a8`. C1 chưa sửa, xem dưới.

### C1: NEEDS_CONTEXT
Không có đường đánh thức integrator mang issue context qua SDK plugin mà không sửa lõi. Bằng chứng:
- `ctx.agents.invoke` (`server/src/services/plugin-host-services.ts`, hàm `invoke`, và `packages/plugins/sdk/src/types.ts` `PluginAgentsClient.invoke`): chỉ nhận `{ prompt, reason }`, không có `issueId`/`taskId`; run sinh ra bị 403 `cross_issue_influence_run_context_required` (`cross-issue-influence-limit.ts` `observeCrossIssueInfluence`).
- Comment có @mention: `ctx.issues.createComment` (`plugin-host-services.ts` `createComment`) chỉ gọi `issues.addComment`, không có xử lý mention; wake `issue_comment_mentioned` chỉ có trong route HTTP (`routes/issues.ts` ~14727, ~18153). Chỉ comment do người (`actorUserId`) mới đánh thức assignee, không đánh thức người được mention.
- `ctx.issues.requestWakeup` (`plugin-host-services.ts` `requestWakeup`) có `issueId` nhưng chỉ đánh thức assignee của issue và ném lỗi khi issue `done`/`backlog`; assignee của issue gốc đã duyệt là owner (user), không phải integrator.
- Đường khác cần đổi thiết kế: plugin tạo issue mới giao thẳng cho integrator (wake assignment stock có `issueId` của issue mới) nhưng integrator ghi `crew-merge` lên issue gốc cũng cần issue context của issue gốc, và H4 từ chối giao việc cho integrator.
Giữ nguyên `invoke` trong plugin, chưa bỏ. Lựa chọn cho owner: (1) owner @mention integrator trong comment lúc duyệt (stock, có `issueId`); (2) sửa lõi `plugin-host-services.ts` để `invoke` nhận `issueId` và đưa vào `contextSnapshot`/`payload` (cần owner cho phép thêm hook/đổi file lõi).

### M3
- `deploy.sh` source `crew/ops/policy-env.sh`: file `/opt/crew-v3-spike/crew-policy/crew-policy.json` nằm ngoài `data/`; `deploy.sh` ghi `docker-compose.crew-policy.yml` (env `CREW_POLICY_CONFIG=/crew-policy/crew-policy.json`, mount thư mục `:ro`) và chạy compose với `COMPOSE_FILE=docker-compose.yml:docker-compose.crew-policy.yml`.
- Trước khi đổi image: `policy-config.py file` từ chối (thoát 7) khi file thiếu, JSON lỗi hay không có object `companies`. Sau health server: `docker logs` qua `policy-config.py startup-log`, thoát 8 nếu không có dòng `crew policy config enabled` hoặc có cảnh báo "gate Crew" tắt, kèm lệnh rollback.
- `rollback.sh` ghi lại override nếu file còn hợp lệ (compose khôi phục không có mount), không thì cảnh báo.
- Test: `node --test crew/ops/policy-config.test.mjs` → `tests 5 / pass 5 / fail 0` (file hợp lệ/lỗi, log khởi động, nội dung override). Đã thêm vào `verify.sh`. `bash -n`/`sh -n` đạt cho `deploy.sh rollback.sh policy-env.sh inspect-image.sh verify.sh`. Chưa chạy deploy/rollback thật.

### m1
- `deploy.sh` chỉ qua khi `issues crewCoreHooks=3` (đếm 2 hoặc 4 bị từ chối, kiểm bằng grep với 2/3/4); `inspect-image.sh` in `issues.js FAIL` khi đếm khác 3 nên bị chặn cả bởi `MISSING|FAIL`.

## O9 + sửa review
- SHA: `78e68939fbcb13484a134eeda13312b610760628`.
- O9: bỏ `integrator-wake.ts` và `crew-integrator-wake.test.ts`; `worker.ts` và `manifest.ts` về đúng bản trước PG-2 (capabilities: `events.subscribe`, `issues.read`, `issues.update`, `issue.comments.create`; không còn `agents.invoke`, `plugin.state.*`). `crew-plugin-manifest` và `crew-run-cancelled`: `Test Files 2 passed / Tests 8 passed`; typecheck plugin sạch.
- M-1: `write_policy_override` (trong `policy-env.sh`, dùng bởi `deploy.sh` và `rollback.sh`) ghi `COMPOSE_FILE=docker-compose.yml:docker-compose.crew-policy.yml` vào `/opt/crew-v3-spike/.env` qua `policy-config.py compose-env`: giữ nguyên mọi dòng khác, thay dòng `COMPOSE_FILE` cũ và bỏ trùng, không ghi lại khi không đổi, không in nội dung.
- m-a: sau health, `docker compose exec -T server test -r <đường dẫn trong container>`; lỗi thì thoát 8 kèm lệnh rollback.
- m-b: kiểm `docker compose exec -T server printenv CREW_POLICY_CONFIG` khác rỗng thay cho dòng log `enabled` (thoát 8 nếu rỗng); `startup-log` chỉ còn lỗi khi log có cảnh báo "gate Crew".
- Test: `node --test crew/ops/policy-config.test.mjs` → `tests 8 / pass 8 / fail 0` (có `.env` mẫu trong thư mục tạm: tạo mới, giữ dòng khác và không in secret, idempotent và thay/bỏ trùng `COMPOSE_FILE`, override). `bash -n` đạt cho `deploy.sh rollback.sh policy-env.sh`. Chưa chạy deploy/rollback thật; `docker compose exec` chỉ kiểm được trên VPS tại D1.
