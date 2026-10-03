# CREWV2-701 — Web bootstrap task brief

## Global Constraints

- Owner đã nói “duyệt UI ok” ngày 03/10. Không hỏi lại hướng UI; chưa thấy artifact mockup/prototype phase07 trong phạm vi giao, không claim artifact không tồn tại đã được duyệt.
- V2 độc lập; không import/copy app/schema nghiệp vụ/scheduler/role prompt v1. Giữ chuẩn docs v1 chỉ như hợp đồng dữ liệu.
- Một owner; UI/docs tiếng Việt, identifiers/path/YAML tiếng Anh; giờ `Asia/Ho_Chi_Minh`.
- Ticket request→step→task, bảy trạng thái; lý do chờ không là trạng thái mới. Server giữ review ≤5 vòng, workflow/version/run và completion authority.
- Superpowers mặc định; BMAD do owner chọn. Không gắn cứng chuỗi ví dụ BMAD/Superpowers hoặc prompt PM/dev/QC.
- Migration 001–010 immutable;011/schema/store đang triển khai, chưa freeze. Runtime/native/parser/corpus/merge08/updater09 có gate riêng.
- Mỗi source task có docs cùng commit; source milestone S được ghi acceptance pending khi A chưa đạt, không tự mở producer gate. Flow đúng 7H2: Mục đích, Điểm vào, Các bước, Files, Dữ liệu, Flow liên quan, Tests. Controller map R2/R3/generated/Git index/commit/shared files; worker không stage dirty tree.
- Manifest `v2/docs/flows.yaml:2` chưa include web/src. Controller phải có bằng chứng quyền R6 coverage trước source đầu tiên; không tự sửa source/shared/unassigned hoặc dùng trailer giả. Markdown chỉ nằm trong `plans/` hoặc `docs/` đã được owner cho phép; lượt FIX1 sửa plan/report ở managed worktree đã được owner cho phép; canonical main là bản lịch sử, không sửa cả hai bản.
- Trước mỗi dispatch mới kiểm quota tuần; còn ≤25% hoặc quota không đọc được thì dừng giao mới, chỉ khép inflight. Trước implement/review/fix lấy telemetry mới; thiếu/critical thì chờ. WARN heavy chỉ khi controller xác nhận available ≥4GiB, CPU idle ≥50%, disk ≥8GiB, sole slot; Node heap không phải RSS cây process.
- Lượt này STATIC; schema giữ sole heavy slot; không install/build/DB/browser/native/container hoặc child agents.


## Task 1: Shell độc lập và bằng chứng hướng UI

**Files mới:** `v2/web/package.json`, `v2/web/pnpm-lock.yaml`, `v2/web/tsconfig.json`, `v2/web/vite.config.ts`, `v2/web/index.html`, `v2/web/src/main.tsx`, `v2/web/src/router.tsx`, `v2/web/src/shell.tsx`, `v2/web/src/styles.css`, `v2/web/test/workspace.test.ts`, `v2/web/scripts/e2e-fixture.ts`, `v2/web/e2e/support/fixture.ts`, `v2/web/playwright.config.ts`, `v2/web/test/fixture-lifecycle.test.ts`. Controller sở hữu config/lock/router/styles. Docs canonical `docs/v2/web-shell.md`.

**Interfaces:** SPA base `/crew-v2/`, API prefix `/v2`; shell có outlet, project navigation và loading/error/empty panels. QueryClient là một instance mỗi authenticated browser app, không singleton process/SSR. Draft và graph view có lifetime per tab/root/ticket, không module-global user state. Source không import server runtime/DB hoặc v1.

```ts
type OwnedResource = { kind: 'database' | 'container' | 'listener' | 'scratch' | 'browser';
  id: string; ownershipNonce: string; startIdentity: string };
type CleanupResult = { resourceId: string; state: 'removed' | 'stopped' | 'unknown'; reason: string | null };
interface FixtureHandle {
  readonly apiOrigin: string; readonly webOrigin: string;
  readonly ownerPassword: string; readonly dbName: string;
  readonly resources: readonly OwnedResource[];
  close(): Promise<readonly CleanupResult[]>;
}
function withFixture(run: (handle: FixtureHandle) => Promise<void>): Promise<void>;
```

FixtureHandle/OwnedResource/CleanupResult/withFixture là interface mới Task1 trong e2e/support/fixture.ts, process-lifetime của một isolated test run; ownerPassword không được serialize handle/log. Test spec tiêu thụ cùng handle. withFixture giữ callback databaseFixture mở suốt feature run, không return handle ra ngoài callback rồi để helper drop DB sớm. close dừng và đối chiếu listener/browser/process trước khi callback kết thúc để helper đóng pool/drop riêng DB. Test unknown identity giữ run/resource để controller reconcile, không return vào cleanup force khi STOP chưa rõ. close xác minh resource registry/ownership trước mutation và idempotent; không suy STOP từ port đóng đơn thuần.


- [ ] Kiểm G0, R6 coverage, quota/telemetry trước source. Read spec+roadmap hiện hành và producer ledger, không bắt đầu package từ main cũ.
- [ ] Pin registry chính thức đã đọc ngày 03/10: `react/react-dom@19.3.0`, `@tanstack/react-router@1.170.41`, `@tanstack/react-query@5.104.1`, `@xyflow/react@12.12.0`, `@radix-ui/react-dialog@1.1.23`, `react-markdown@10.1.0`, `remark-gfm@4.0.1`; dev `vite@8.3.2`, `@vitejs/plugin-react@6.1.1`, `typescript@7.0.2`, `@types/react/@types/react-dom@19.3.0`, `@types/node@26.6.3`, `@playwright/test@1.63.0`. Recheck official peer/engines/security notices tại implementation; pnpm `--ignore-workspace` chỉ trong web, không đổi lock server/domain. Biome dùng runner đã ghim repo, không thêm formatter.
- [ ] Write workspace isolation RED test trước scaffold: parse package/scripts/base và scan imports cấm `apps/`, `packages/shared`, v1 roles. Missing package phải fail rõ. Sau scaffold test pass không thay acceptance chức năng.
- [ ] Định nghĩa script thực thi: `dev: vite --host 127.0.0.1`, `build: tsc --noEmit && vite build`, `typecheck: tsc --noEmit`, `test: node --test test/*.test.ts`, `test:e2e: playwright test`. Strict/JSX react-jsx/noEmit; pure tests `.ts` không JSX. Vite API proxy vào owned listener controller cấp; production same-origin, không gọi v1.
- [ ] Controller tạo harness sớm trong task này: dùng `buildApp`, `v2/server/src/app.ts:30` (caller sở hữu migrate/listener/pool), `captureMigrations`, `v2/server/src/db/migrate.ts:20`, và `databaseFixture`, `v2/server/test/support/db.ts:11`, sau G0 freeze migration prefix/assembly đã accepted. `FixtureHandle` gồm apiOrigin, webOrigin, ownerPassword chỉ memory, dbName, resource identities và close() idempotent; `e2e/support/fixture.ts` cấp handle cho từng feature spec. Playwright config workers=1, webServer.reuseExistingServer=false, listener loopback do fixture sở hữu. Không dùng backend chung hoặc đóng pool/server của peer.
- [ ] A1 test fixture lifecycle trên API–PostgreSQL18.6 thật, cổng loopback được OS cấp khác5432/55432 và DB `crew_v2_` riêng: gọi `bootstrapOwner`, `v2/server/src/auth/bootstrap.ts:7`, trên DB fixture với password runtime-generated; HTTP login/current session rồi close/verify owned resources. Không có endpoint bootstrap mới và không cần UI login để khép A1. Registry trước launch ghi scratch nonce/dev/ino, exact container/DB ID, listener PID/start identity, browser context và staging. Finally abort requests, đóng browser/listener/pool, xác nhận STOP trước drop DB/rm exact stopped container/scratch; UNKNOWN giữ lại/report. Test interrupt/crash/repeated cleanup không xóa peer assets. Không broad prune/rm/tmp/git clean.
- [ ] Viết shell/tokens mới theo hướng Jira/Confluence: sidebar theo dự án, toolbar gọn, status có chữ+icon, docs tree/content, responsive1280/768/390. Có focus-visible/reduced-motion/semantic landmarks; mobile không overflow ngoài map. Icon action có accessible name.
- [ ] Chụp shell guest/static preview desktop/mobile bằng Playwright MCP sau resource gate, ghi “Bản minh họa” nếu có fixture content. Task1 không chờ board/docs/map/dialog chưa được tạo. Screenshot của từng feature nằm ở task sinh feature, lưu path/hash và đối chiếu ảnh owner đã xem; không hỏi lại hướng UI.
- [ ] Chạy web typecheck/build/scoped Biome và workspace test; docs7H2/map/check qua controller. Independent spec/quality review trước commit Conventional Commit exact owned files.

**Success:** Build độc lập, không import v1; viewport390px không overflow nội dung; zoom200% vẫn dùng shell được; A1 có actual fixture baseline và screenshot shell đúng nguồn. Ticket/map acceptance thuộc task sau. **Risk:** M×M toolchain drift, mitigation exact pins/peer/lock check; H×H cleanup nhầm tài nguyên được giảm bằng registry exact identity, interrupt/repeated-close/UNKNOWN tests trong A1. **Rollback:** tháo riêng static web entry/bundle; không đổi DB/API/v1.

Nguồn primary: [React versions](https://react.dev/versions), [Vite guide](https://vite.dev/guide/), [React Flow accessibility](https://reactflow.dev/learn/advanced-use/accessibility), [TanStack query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys), [WAI modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Exact publisher version/peer metadata đọc trực tiếp `https://registry.npmjs.org/<encoded-package>/<version>`; chưa build thử stack mới trong lượt STATIC.


## PM execution rulings

- This is a real local plan work item CREWV2-701 created by PM from approved Phase07 Task1; it is not an external tracker claim. Existing owner authorization to rebuild v2 web, approved UI and docs/plans authorization covers necessary web source coverage. PM will use actual task key for R6 trailer and validate protection deliberately, not exploit nested manifest omission. Worker does not edit source/shared/unassigned or Git.
- First pass STATIC preflight only: freeze Task1 assembly/identity/migration contracts and dependency metadata, propose workspace RED and lifecycle recipe; no source/Node/install/DB/browser until PM release.
- T1 accepted at feaea55; immutable011 SHA fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841. Existing auth/project/ticket/execution/docs/gateway/model/event assembly is accepted baseline; no attachment/Assistant authority injection, production default deny preserved. G1–G6 are not opened by bootstrap.
- No v1 source reuse, source imports or shared backend restart; libraries metadata from primary official registry only. No invented package versions to match future date. If pins unavailable propose exact verified compatible alternatives before install.
- Not alone in codebase; do not revert peers. No children/Git/index/commit/packages outside v2/web. Task1 exclusive ownership per above may be transferred from controller after preflight; docs draft only under plans/docs.
