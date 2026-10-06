# Paperclip baseline — Phase 00-01

Checked: 05/10/2026, Asia/Ho_Chi_Minh. Status: khảo sát nguồn hoàn tất, chờ independent review; chưa build/test/runtime acceptance. Context core; score 8 = 1+U3+C2+I2, model gpt-6-astra/high theo dispatch. Chỉ hai report này do worker sửa; không sửa ledger/source v2 hoặc tạo fork.

## Baseline đã khóa

| Thuộc tính | Giá trị đã xác minh |
|---|---|
| Official repository | https://github.com/paperclipai/paperclip |
| Default branch | `master` (GitHub repository API, checked live) |
| Stable được chọn | `v2026.1001.0`, GitHub latest, draft=false/prerelease=false; published `2026-10-02T01:54:00Z` |
| Full commit | `8f8a0ab7effbd6a0584107d8038736c134ee5047` |
| Predecessor stable | `v2026.916.1`, published `2026-09-21T21:22:44Z` |
| Predecessor full commit | `d554c4789ed3930f8a53ac9fdf6503b3187097da` |
| License tại pinned source | MIT, `LICENSE:1–21`, copyright `2025 Paperclip AI`; giữ notice khi phân phối |
| Runtime | Node `>=24.11.0`; package manager `pnpm@9.15.4` |
| Plugin SDK | `packages/plugins/sdk/package.json:2–5`: `@paperclipai/plugin-sdk@1.0.0` |
| Adapter contract | `packages/adapter-utils/package.json:2–3`: `@paperclipai/adapter-utils@0.3.1`; types là source tại SHA trên |
| Core package versions | server/ui/db/CLI `0.3.1`; không dùng các version này thay tag/SHA release |
| Native runner | `packages/paperclip-runner@0.0.0`, Rust `1.97.1` từ `packages/paperclip-runner/rust-toolchain.toml:1–4`; full build gọi cargo release |
| JS tools | root package TypeScript `^7.0.2`, Vitest `^4.1.11`, Playwright `^1.62.1`; lockfile ghi TS7.0.2/Vitest4.1.11 |
| Lockfile | `pnpm-lock.yaml`, format9.0; SHA256 `d7d96cf0d98cf0946f6195e29ba173b03711a947a1c38f312b67cda56c254c22` |

Đây là stable mới nhất GitHub API trả về tại lần kiểm; không suy từ ngày máy hoặc kết quả search cache. Hai refs là lightweight tags trỏ trực tiếp commit. Chọn rehearsal **v2026.916.1 → v2026.1001.0**, development baseline ở bản mới. Chưa chứng nhận upgrade hoặc tính tương thích DB giữa hai bản. Predecessor root package cũng yêu cầu Node>=24.11.0 và pnpm9.15.4; chưa tải toàn predecessor source.

Nguồn chính thức: [release hiện tại](https://github.com/paperclipai/paperclip/releases/tag/v2026.1001.0), [release trước](https://github.com/paperclipai/paperclip/releases/tag/v2026.916.1), [current tag ref](https://api.github.com/repos/paperclipai/paperclip/git/ref/tags/v2026.1001.0), [predecessor ref](https://api.github.com/repos/paperclipai/paperclip/git/ref/tags/v2026.916.1), [pinned package](https://github.com/paperclipai/paperclip/blob/8f8a0ab7effbd6a0584107d8038736c134ee5047/package.json), [pinned license](https://github.com/paperclipai/paperclip/blob/8f8a0ab7effbd6a0584107d8038736c134ee5047/LICENSE).

## Khác với giả định ban đầu

- Spec nói SDK alpha dựa docs nghiên cứu trước; selected source package ghi1.0.0. Compatibility manifest phải ghi giá trị thực này, chưa suy ra mọi extension API ổn định.
- Release notes ghi mặc định execution harness thành full-auto; pin explicit permission configuration và giữ Crew controller gate. Không lấy provider permission prompt làm gate nghiệp vụ.
- Native runner và legacy adapter là hai nhánh thực thi riêng trong cùng heartbeat controller. Plugin observer không chặn được mutation trước commit. Xem [seam findings](phase-00-core-findings.md).
- Workspace target hiện là local/SSH/sandbox; chưa có Crew outbound-machine target. Custom adapter có thể làm transport nhưng chưa chứng minh core workspace realization phù hợp Mac-only repo.

## Source scratch và provenance

Registered path: `/Users/phannhatquang/Documents/projects/crew/plans/261005-2154-crew-v3-paperclip/scratch-paperclip-source`.

- `v2026.1001.0/`: source archive exact full SHA, 135MiB theo `du -sh`, không có `.git`/`.codegraph`; không index, không sửa nguồn.
- `source.tar.gz`: 36MiB, codeload exact SHA; SHA256 `469619fe6f4452fee0ffac721de68d1a397fde8571a32cbabac19f25487ca58c`.
- `tree.json`: GitHub recursive tree, `truncated=false`; `tag-current.json`, `tag-predecessor.json`, `release-latest.json`, `predecessor-package.json`: saved official responses.
- Codeload và raw HTTP có latency; lần đầu Python request `/commits/tag` bị chờ, đã dừng đúng PID92804 do worker tạo, thay bằng ref API và bounded curl. Tất cả lệnh download đã kết thúc; không background service/DB/install.
- Scratch giữ cho reviewer/00-03 dùng lại, PM quyết định cleanup sau lưu evidence. Không stage archive/source scratch vào Crew.

## Handoff 00-03: commands đã đối chiếu source, CHƯA CHẠY

PM tạo actual owner fork bằng công cụ GitHub đã được cấp quyền, xác định URL thật; không tự đoán owner. Checkout độc lập, không đổi primary Crew/v3. Ví dụ sau khi có fork checkout:

```sh
git remote add upstream https://github.com/paperclipai/paperclip.git
git fetch upstream tag v2026.1001.0 tag v2026.916.1
git rev-parse 'v2026.1001.0^{commit}'
git rev-parse 'v2026.916.1^{commit}'
git switch -c v3 8f8a0ab7effbd6a0584107d8038736c134ee5047
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm run preflight:workspace-links
pnpm --filter @paperclipai/plugin-sdk ensure-build-deps
pnpm --filter @paperclipai/server exec vitest run src/adapters/plugin-loader.test.ts
```

Hai SHA phải bằng bảng trên; nếu `upstream` hoặc branch đã tồn tại thì inspect/reuse, không chạy add/switch mù. `pnpm install` có postinstall `scripts/link-plugin-dev-sdk.mjs`. Đọc `AGENTS.md` và `doc/{GOAL,PRODUCT,SPEC-implementation,DEVELOPING,DATABASE}.md` trước sửa source fork. `doc/DEVELOPING.md:20–24` cho biết upstream CI sở hữu lockfile; Crew fork cần policy riêng reviewed khi thêm package, không sửa lock chỉ để che drift.

Vitest hẹp chạy theo package cwd để `include/setupFiles` resolve đúng. Không báo test pass khi suite bị skip.

Baseline rộng sau admission resource riêng, tuần tự:

```sh
pnpm typecheck
pnpm test:run
pnpm build
```

Root scripts có workspace-link preflight; `pnpm build` bao gồm native Rust build. `scripts/run-vitest-stable.mjs` phân nhóm serialized suites và native suite có thể compile Rust; không coi full suite là lightweight. Local test helper dùng embedded Postgres thật và có nhánh skip khi unsupported (`server/src/__tests__/issues-service.test.ts:38–59`); kiểm số test skipped. Mỗi DB/browser/native job phải đăng ký port/PID/temp DB trước chạy; không trỏ vào Crew DB/port5432. Chưa tự chạy `pnpm dev` hoặc migrate. UI/API test chỉ sau sandbox DB/process brief00-04.

Upgrade rehearsal sau này phải tạo fixture trên predecessor, backup DB+blob, merge/fetch candidate, migrate clone, kiểm Crew namespace/gates/session, rồi thử restore đồng bộ. Việc khóa hai tags ở đây chưa thay cho rehearsal.

## Verification thực hiện / còn mở

PASS source evidence: release refs, archive extraction, source paths/types/test-file existence, lock/archive hashes; 13 file trọng yếu có Git blob SHA1 trùng official recursive tree; mọi source-link path/starting line trong hai report hợp lệ. Primary branch vẫn `v3`. Không chạy install/typecheck/unit/integration/DB/browser/native. Gate00-01 chỉ nên đạt sau independent review các source links và các câu hỏi giới hạn ở findings; Phase00 chưa complete.
