# CREWV2-701 / Task 1 — tiền kiểm và chứng cứ triển khai

**Trạng thái hiện tại:** FIX2/F1 đã chặn scratch `rm` khởi chạy sau REMOVE deadline; test cùng callback production RED → focused GREEN với raw logs/SHA ở mục FIX2 cuối. Full lifecycle 6 case, strict typecheck và Biome trên source FIX2 **chưa chạy**, chờ B2a ổn định và slot mới. FIX1 trước đó đạt lifecycle PostgreSQL/API 5/5, typecheck/Biome trên source FIX1; không suy kết quả đó cho FIX2. Shell UI không đổi sau preview MCP xác nhận focus, console và viewport 1280/390/640; literal browser zoom 200% chưa đo được. Review lại FIX2, tích hợp docs/manifest và commit Task1 còn chờ PM; không tự mở G1–G6 hoặc gọi A1 toàn phần đã nghiệm thu. Các mục RED/scaffold/freeze cũ phía dưới là **nhật ký tại thời điểm chạy**, bảng hash mới nhất nằm ở mục FIX2 cuối. Brief đúng SHA-256 `6ef878092dbfb005eabe3201f4ce7ea2a1a1346a030cbc94f6e9a7f8ae5136d1`; spec đúng SHA `14085723bba15c1c00de52eab437cf83af58ef8943b761fd029f36f2523165`. Baseline code được giao `feaea55`; đã đọc `docs/index.md`, `v2/docs/index.md`, các flow và PM ledger trước source; worktree không có `.codegraph/`.

## Hợp đồng source hiện tại

| Điểm nối | Chữ ký và hành vi xác nhận | Dấu vân tay SHA-256 file |
|---|---|---|
| `v2/server/src/app.ts:30` | `buildApp(input: AppOptions): Promise<FastifyInstance>`. `AppOptions` cần `db`, `publicOrigin`, `secureCookies`, `sessionEncryptionKey: Buffer`, `now`; `authorizeDispatch`/`verifyFinalResult` tùy chọn và mặc định deny. Hàm ghép auth, project, ticket, execution, docs, gateway, model, event rồi `ready()`. Không migrate, listen, đóng DB; không mount attachment/Assistant. Caller sở hữu `app.close()`, listener và DB. | `c0052279dc95a5f512047add2ca8dcd1c94935c45c79ab218721a0bb58e493c3` |
| `v2/server/src/db/migrate.ts:20,43` | `captureMigrations(through: number, migrationsDir = defaultDir): Promise<MigrationSet>` chụp tuần tự đúng một file `.sql` cho mỗi phiên bản, SHA-256 và SQL trong object/array frozen. `migrate(db: Db, set: MigrationSet): Promise<void>` xác nhận identity/checksum và áp dụng transaction; không tự chọn prefix. | `47956c0308883839fd70ce5c7d78101cc7457a92ef2c37f78657aeccf99f6c8b` |
| `v2/server/test/support/db.ts:11` | `databaseFixture(through: number, options: {migrate?: boolean} = {})` trả callback `(fn: (db: Db) => Promise<void>) => Promise<void>`. Nó tự gọi `captureMigrations`, bắt buộc `CREW_V2_TEST_DATABASE_URL` là `postgres://postgres@127.0.0.1:<cổng riêng>/crew_v2_test`, kiểm `CREW_V2_TEST_CONTAINER_ID` 64 hex và Docker name/mapping, tạo DB `crew_v2_test_<uuid>`, migrate mặc định, giữ DB trong callback, rồi `db.end()` và `DROP DATABASE <name> WITH (FORCE)` trong `finally`. Không xuất DB name/ownership ID/giữ lại khi UNKNOWN. | `2d840b2710c76a629d95ef5dd4a67e1b4edd6f4cb14d9e61e8314ee7035f5a96` |
| `v2/server/src/auth/bootstrap.ts:7` | `bootstrapOwner(db: Db, password: string): Promise<void>` băm password, transaction/advisory lock, insert owner `id='owner'`; lần hai lỗi `OWNER_ALREADY_EXISTS`. Gọi trực tiếp trong DB fixture; không tạo endpoint. | `3bf1b6ce86a466864335bc80efbe318595d10efb5ea8f66110499b93e0dcecde` |

`Db = postgres.Sql` và `ServerOptions` ở `v2/server/src/platform/contracts.ts:9,43`; `connectDb` chỉ chấp nhận tên `crew_v2_...` và từ chối cổng loopback 5432/55432. `POST /v2/auth/session` cần `Origin === publicOrigin`, JSON `{password}` và trả `{owner:{id:'owner'},csrfToken}` cùng cookie; `GET` cần cookie, trả cùng shape (`auth/routes.ts:91–145`). Test phải gọi HTTP thật qua listener loopback, giữ cookie; `app.inject()` chỉ kiểm route nội bộ, không đủ A1. API `publicOrigin` nên là origin web do fixture cấp để proxy `/v2` và cookie same-origin nhất quán. `buildApp` không đọc cấu hình env và không thay thế ownership của listener/pool.

Prefix A1 đề xuất **001–011**, chụp bằng `captureMigrations(11)` trước DB run và đối chiếu hash theo bảng; 011 đã được PM xác nhận accepted/bất biến tại `feaea55`, dù app chưa mount Assistant. `databaseFixture(11)` tự chụp prefix; tránh chụp set riêng rồi dùng set khác một cách không kiểm soát. Nếu test cần dùng chính set đã chụp, helper hiện chưa nhận `MigrationSet`; PM phải chốt contract trước source. Hash dưới đây là SHA-256 file thực tại lượt tiền kiểm, không phải chứng cứ migrate đã chạy.

| Migration | SHA-256 |
|---|---|
| `001_platform.sql` | `dda56a23030e01ee5025d61578969b53157f96fd19ffe6172108b652f6adfa76` |
| `002_journal.sql` | `11806e8bb34e6aefb2f225d1499052d66d76c06f1ccd278021353fcc7fed78e9` |
| `003_identity.sql` | `0949541124c0ff26fec05030b8693afe65705ff2d63887f7e452fa6d37487d5d` |
| `004_tickets.sql` | `1149012423551fb847c6a9adf3784906d466a6026d8edb67e079d433dcf8af4f` |
| `005_execution.sql` | `b8351b54e99ae91a3d2476df812b8fc374860ae472cfe8b7459a4dfc61e41027` |
| `006_docs.sql` | `8c48a69a27205ff95d11be8b966ffffcd079f62e537f5263777cd867325b75ae` |
| `007_gateway.sql` | `9a5542b2a58dd151d1ad78a7dc799ba7bee157abfd094c3c1ebfebf1a2d49eb4` |
| `008_model_pool.sql` | `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f` |
| `009_attachments.sql` | `fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a` |
| `010_attachment_comment_text.sql` | `aa2a308ba8a180186e57fb08f93fac7195fc6c0468b821f96c107f4e13ccf59d` |
| `011_assistant.sql` | `fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841` |

## Dependency registry 03/10/2026

Đọc trực tiếp JSON từng phiên bản từ `https://registry.npmjs.org/<encoded-package>/<version>`; cả 15 request HTTP 200, trường `version` trùng pin, có `dist.integrity`, không có `deprecated`. Bảng ghi peer/engine có liên quan; `—` là metadata không khai báo, không phải chứng nhận chạy được. Không install, tạo lock hay audit transitive/security trong lượt STATIC.

| Pin | Engine / peer liên quan |
|---|---|
| [`react@19.3.0`](https://registry.npmjs.org/react/19.3.0), [`react-dom@19.3.0`](https://registry.npmjs.org/react-dom/19.3.0) | React engine `>=0.10.0`; React DOM peer `react ^19.3.0` |
| [`@tanstack/react-router@1.170.41`](https://registry.npmjs.org/%40tanstack%2Freact-router/1.170.41), [`@tanstack/react-query@5.104.1`](https://registry.npmjs.org/%40tanstack%2Freact-query/5.104.1) | Router Node `>=20.19`, React/DOM `>=18 || >=19`; Query React `^18 || ^19` |
| [`@xyflow/react@12.12.0`](https://registry.npmjs.org/%40xyflow%2Freact/12.12.0), [`@radix-ui/react-dialog@1.1.23`](https://registry.npmjs.org/%40radix-ui%2Freact-dialog/1.1.23) | React/DOM >=17 và `^19` tương ứng; type peers tùy chọn |
| [`react-markdown@10.1.0`](https://registry.npmjs.org/react-markdown/10.1.0), [`remark-gfm@4.0.1`](https://registry.npmjs.org/remark-gfm/4.0.1) | Markdown peer React/types >=18; remark không khai báo peer |
| [`vite@8.3.2`](https://registry.npmjs.org/vite/8.3.2), [`@vitejs/plugin-react@6.1.1`](https://registry.npmjs.org/%40vitejs%2Fplugin-react/6.1.1) | Cả hai Node `^20.19.0 || >=22.12.0`; plugin peer Vite `^8.0.0`; các plugin tùy chọn khác không bắt buộc |
| [`typescript@7.0.2`](https://registry.npmjs.org/typescript/7.0.2), [`@types/react@19.3.0`](https://registry.npmjs.org/%40types%2Freact/19.3.0), [`@types/react-dom@19.3.0`](https://registry.npmjs.org/%40types%2Freact-dom/19.3.0), [`@types/node@26.6.3`](https://registry.npmjs.org/%40types%2Fnode/26.6.3) | TS Node `>=16.20`; React DOM types peer React types `^19.3.0`; các type khác không khai báo engine |
| [`@playwright/test@1.63.0`](https://registry.npmjs.org/%40playwright%2Ftest/1.63.0) | Node `>=20` |

Pin trực tiếp trên tương thích với Node ≥24.12 của v2 theo metadata này. Chưa xác minh dependency transitive, pnpm lock, browser binary, build hoặc advisory: làm khi PM mở install/source. Không cần pin thay thế ở thời điểm này. `@types/node@26` trên runtime Node24 cần typecheck thực tế; metadata không chứng nhận API runtime tương ứng.

## RED và vòng đời fixture đề xuất khi được release

1. Viết `v2/web/test/workspace.test.ts` trước scaffold: test fail vì thiếu `v2/web/package.json` với thông điệp rõ; sau đó kiểm `private`, scripts đúng plan, Vite base `/crew-v2/`, API `/v2`, package/lock cục bộ và quét import từ web source để từ chối `apps/`, `packages/shared`, v1 roles/runtime. Test phải đọc artifact thật, report RED thực tế trước GREEN. Không dùng test chỉ soi chữ của chính script để tuyên bố build/UX đạt.
2. Viết `fixture-lifecycle.test.ts` trước helper: một run dùng PostgreSQL18.6 riêng qua DB callback, password ngẫu nhiên chỉ ở memory, `bootstrapOwner`, `buildApp` default deny, listener OS cấp cổng loopback, HTTP POST login + GET session, assert owner/cookie; `close()` hai lần cho cùng kết quả và xác nhận tài nguyên thuộc run đã dừng. Thử identity mismatch/interrupt ở isolated run để giữ UNKNOWN, không đụng peer. RED cần lỗi hành vi dự kiến, không lỗi import/typing giả. Web shell/browser screenshot là nghiệm thu riêng của A1.
3. Registry ghi **trước launch** nonce, scratch `dev:ino`, exact Docker container ID/name/mapping, DB name, PID + process start identity của listener, browser context ID và trạng thái staging. Chỉ close khi identity hiện hành khớp registry. `close()` cache Promise để idempotent; abort request, đóng browser/context, web listener, API `app.close()` rồi xác nhận process/listener STOP bằng identity, sau đó để DB callback đóng pool/drop DB, và parent dừng đúng container/scratch. Không suy STOP từ việc port thôi nghe. Identity thiếu/khác hoặc STOP chưa chắc chắn → UNKNOWN và giữ resource/registry cho controller đối chiếu, không force cleanup.
4. Playwright cần cùng process-lifetime fixture cho feature specs, worker=1 và `reuseExistingServer=false`. Chốt một owner duy nhất cho API/web listener, DB, browser và container; không vừa cho Playwright `webServer` vừa cho `withFixture` khởi động cùng listener. A1 dùng HTTP thật, shell preview desktop/mobile bằng Playwright MCP sau resource gate; content giả phải ghi “Bản minh họa”. S1 source/build không tự thành A1 PASS.

**Xung đột contract cần PM giải quyết trước A1:** `databaseFixture` hiện `DROP ... WITH (FORCE)` vô điều kiện sau callback; `test-db.ts:144–152` luôn `docker stop` ID khi `finally`, không chừa UNKNOWN. Không thể vừa sử dụng chúng nguyên dạng vừa bảo đảm “identity chưa rõ thì giữ DB/container và registry” khi callback thoát/throw hoặc runner bị ngắt. Ngoài ra `databaseFixture` không xuất DB name trước callback, trong khi registry yêu cầu ghi DB ID trước tạo. Cần controller giao quyền sửa đúng helper server/runner thành safe conditional cleanup + identity output **hoặc** chốt harness web sở hữu toàn bộ container/DB với protocol an toàn riêng; nếu vẫn bắt buộc gọi `databaseFixture`, phải giới hạn helper đó cho nhánh success và chứng minh nhánh UNKNOWN ở owner khác. Không dùng mock, `inject()` hay cleanup force để lấp khoảng trống. Phải chốt layout parent/Playwright worker để cùng handle tồn tại suốt run, vì config webServer và callback DB có process boundary.

## G0 / scope handoff

`v2/docs/flows.yaml:2` hiện `source.include` chưa phủ `web/src/**`/`web/scripts/**`; PM ledger đã ghi quyền owner cho CREWV2-701 và PM nhận phần R6/trailer/manifest. Controller còn phải thực thi, kiểm chứng R2/R3/R6/Git index/commit trước source; worker không sửa manifest hay stage. T1 baseline chỉ chốt storage/schema/inbox, không cấp Assistant HTTP authority. Thực thi source cần PM báo exact ownership/release, quota và telemetry mới; lần tiền kiểm này không dùng sole heavy slot, không có test pass hoặc resource mới.

## Bổ sung sau ruling PM — RED và scaffold

PM chốt toàn bộ 14 file Task1 `v2/web/` do worker sở hữu; controller giữ Git/manifest/docs generate/check. Harness web tự sở hữu container/DB và không gọi `databaseFixture`/`test-db.ts` trong nhánh kiểm cleanup UNKNOWN; dùng `captureMigrations(11)` đúng một lần, kiểm hash prefix, rồi `migrate` cùng object trên DB riêng qua `connectDb`. Parent Playwright không tạo `webServer` thứ hai; worker-scoped fixture dùng cùng callback `withFixture` cho một run, API/Vite chọn cổng loopback bằng OS. Đây là thay đổi ruling cho harness web, không sửa helper server.

Đã viết `v2/web/test/workspace.test.ts` trước package. Test đọc package thật; khi package chưa có, assertion fail rõ `Thiếu v2/web/package.json` trước khi import Vite. Sau scaffold, cùng test kiểm tên/private/type/packageManager, scripts, lock riêng, Vite base/proxy được cấp origin động, và import source nằm trong `v2/web` không trỏ v1.

**RED thực:** trước launch `vm_stat` cho `(free+inactive+speculative)×16KiB ≈ 4.64GiB`, `top` CPU idle 55.15%, `df` 27GiB; PM xác nhận pressure2 và sole slot. Chạy `NODE_OPTIONS='--max-old-space-size=128' node --test v2/web/test/workspace.test.ts` tại repo root. Exit **1**, Node thoát/reap trong 0.5s; output `tests 1, pass 0, fail 1`, `AssertionError [ERR_ASSERTION]: Thiếu v2/web/package.json: chưa tạo workspace web độc lập` tại dòng20. Đây là missing-feature RED đúng dự kiến, không phải import/typing crash. Đã báo PM slot FREE trước mọi sửa GREEN. Test về sau được siết thêm để assert proxy target bằng origin động; assertion mới và GREEN chưa chạy.

Sau RED đã tạo Node-free 10/14 path: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/router.tsx`, `src/shell.tsx`, `src/styles.css`, `test/workspace.test.ts`, `playwright.config.ts`. Package có 15 pin chính xác và scripts plan. Shell guest có nhãn “Bản minh họa”, router base `/crew-v2/`, QueryClient được tạo trong mỗi mount; CSS có landmark/focus/390px/reduced-motion. Vite serve yêu cầu API origin thật do caller cấp, không có placeholder/backend dùng chung. Playwright config workers1 và không tạo webServer thứ hai. Đã tạo draft docs 7H2 `docs/v2/web-shell.md`; chưa gọi doc checker/generate.

**Tại thời điểm scaffold, còn thiếu/chờ gate:** `scripts/e2e-fixture.ts`, `e2e/support/fixture.ts`, `test/fixture-lifecycle.test.ts` chờ behavioral RED/lifecycle slot. Không tạo test import-error giả hoặc triển khai cleanup khi chưa thấy RED. API/PG18.6/HTTP và Playwright MCP screenshot khi đó chưa chạy; trạng thái mới hơn nằm ở phần final freeze bên dưới.

Ruling listener của PM: một HTTP web listener owned gọi `listen(0)` và giữ socket, trả 503 khi chưa ready; dùng web origin thật để `buildApp`, API `listen(0)`, rồi mount Vite middleware với proxy tới API origin thật trên **cùng web listener**. HMR tắt hoặc gắn cùng listener. Browser chỉ mở sau ready. Không preselect/free-port race; đóng browser, Vite, API, web listener theo identity trước pool/DB cleanup. Đây là recipe chưa code/test, không phải nghiệm thu.

Inventory process **dự kiến lúc scaffold**: lượt install sau release là `pnpm` riêng `v2/web` với `--ignore-workspace`, kiểm lock/integrity; A1 sau đó có một test worker Node owner, một container `postgres:18.6`, API/Vite trên listener thuộc worker, rồi Playwright browser/context thuộc run. Nếu Playwright runner sinh worker/browser child, ghi PID + start identity trước dùng và xác minh terminal trước cleanup; đóng listener không đồng nghĩa dừng worker. Shell screenshot MCP dùng mode fixture riêng sau resource gate, không chạy đồng thời lifecycle test. Trạng thái process hiện tại ghi ở đầu báo cáo.

**Câu hỏi khi mới scaffold:** thời điểm PM cấp lifecycle RED/A1 slot; đã được giải quyết ở các lượt dưới, không cần owner duyệt lại thiết kế.

## Bổ sung install và kiểm scaffold

PM cấp sole heavy slot với quota tuần 56% còn. Trước **mỗi** launch Node/pnpm, script telemetry PM xác nhận available 7.085–7.532GiB, pressure1, CPU idle 82.42–88.90%, disk25.84–25.87GiB, đều qua gate4/50/8. Install đúng một lần trong `v2/web`: `NODE_OPTIONS='--max-old-space-size=384' pnpm install --ignore-workspace --ignore-scripts --network-concurrency=1 --child-concurrency=1`, exit0 sau32.5s, 15 pin đúng phiên bản. `pnpm-lock.yaml` do pnpm sinh, SHA-256 `477c3a3bb178c1274939d9c4274ec42645a807cef4587451766bb0aa7859c7b4`. Không sửa lock root/server/domain, không browser install hoặc script lifecycle package.

Workspace GREEN lần đầu exit1 vì **lỗi test**: `webRoot` có dấu `/` cuối, assertion import nội bộ `./router.tsx` bị báo nhầm ra ngoài. Sửa test thành `resolve(fileURLToPath(...))`; lần cuối `NODE_OPTIONS='--max-old-space-size=384' node --test test/workspace.test.ts` tại `v2/web` exit0, `tests1/pass1/fail0`. Đây là một lần sửa test, không phải defect source isolation.

`NODE_OPTIONS='--max-old-space-size=384' pnpm typecheck` exit0. Build cuối `NODE_OPTIONS='--max-old-space-size=384' pnpm build` exit0: `tsc --noEmit`, Vite8.3.2 transform150 modules, `dist/index.html` và bundle CSS/JS. Scoped `pnpm exec biome check` lần đầu exit1 vì format bốn file và `aria-label` trên `div`; đổi grid thành `section`, rồi `pnpm exec biome check --write --files-ignore-unknown=true` trên đúng mười file Task1 exit0 (`Checked 10 files`, `Fixed 4 files`). Lần build cuối sau thay đổi đó exit0; không gọi lint toàn repo. Lệnh gọi trực tiếp đường `node_modules/.bin/biome` bị PreToolUse hook chặn, nên dùng `pnpm exec biome` được phép; không sửa ignore/hook.

Sau tất cả lệnh Node/pnpm đã exit/reap, em trả sole heavy slot cho PM trước phần fixture. Không có Task1 server, container hoặc browser đang chạy. `docs/v2/web-shell.md` đã cập nhật thành draft7H2 validation pending; root giữ manifest/Git/commit. Còn ba lifecycle file, A1 HTTP/PG và screenshot MCP.

## Nhật ký lifecycle RED source trước khi thực thi

Trong lúc T2 giữ sole heavy slot, đã author ba path còn lại, không chạy Node/DB/browser/install: `v2/web/test/fixture-lifecycle.test.ts` yêu cầu `withFixture` **gọi callback** với handle có resource identity, web/API loopback và logical DB riêng; callback thực sự gọi HTTP `POST/GET /v2/auth/session` sau `bootstrapOwner`, nhận cookie/CSRF, sau đó gọi `close()` hai lần và so kết quả. `v2/web/e2e/support/fixture.ts` chỉ khai báo interface plan và deny scaffold `FIXTURE_UNAVAILABLE`; `v2/web/scripts/e2e-fixture.ts` cũng là deny scaffold, chưa tạo tài nguyên. Test đầu tiên bắt lỗi scaffold rồi assert `entered === true`, nên RED dự kiến là callback không được gọi, **không phải** import/compile error; nhánh HTTP/PG sẽ chỉ được kiểm thật sau implementation. Chưa có output RED thực; không ghi PASS.

## RED vòng đời thực và candidate sau RED (chưa GREEN)

Ba file deny scaffold trước RED có SHA-256 lần lượt `scripts/e2e-fixture.ts`=`4de7d2f1371d05f340f14131f660ecbc4bec9706dfc27379f57399f2ddba0284`, `e2e/support/fixture.ts`=`e8a90d5c08c940e9433304035b0b913d68bbcd6c7978836628428ce52a2473af`, `test/fixture-lifecycle.test.ts`=`8601921030f0d21fd9f0bc62e988f028d2942c8a1547a9165d778d52f2f4ea87`. Trước Node launch, gate đo được 6.633 GiB available, pressure 1, CPU idle 62.74%, disk 25.846 GiB. `NODE_OPTIONS='--max-old-space-size=384' node --test test/fixture-lifecycle.test.ts` chạy riêng trong `v2/web`: exit 1, 3 test/0 pass/3 fail; cả ba thất bại ở assertion hành vi (callback chưa được gọi, identity mismatch trả `undefined`, STOP chưa xác minh trả `undefined`), **không phải** import/compiler failure. Process đã exit/reap, deny scaffold không tạo container/DB/listener/browser. Sole heavy slot đã trả PM trước khi author implementation.

Sau RED, ba file fixture được sửa Node-free. Candidate coordinator gọi `captureMigrations(11)` đúng một lần và so 11 hash frozen trước Docker; tạo registry nonsecret chứa nonce, process start identity, pending-attempt flags và exact resource identities; cấp PostgreSQL18.6 container/DB riêng, dùng cùng migration set cho `migrate`, `bootstrapOwner`, `buildApp` default deny. Web HTTP listener giữ cổng OS cấp và trả 503 tới khi API listener/Vite middleware/proxy ready; HMR tắt. `close()` idempotent đối chiếu PID/start, container id/name/label/start, DB OID và scratch dev/ino trước stop/remove/drop; không `DROP WITH FORCE` hoặc stop container nếu identity/STOP không rõ. Nếu launch/CREATE/LISTEN không ghi được identity, cleanup giữ UNKNOWN và chặn cascade. Test positive có deadline 10 giây mỗi HTTP request; readiness loop có deadline 30 giây, docker command tối đa 20 giây. Đây là **candidate chưa typecheck, chưa chạy GREEN/PG/HTTP/browser**. Lượt GREEN kế tiếp cần gate RAM/CPU/disk/pressure mới và sole heavy slot, chạy `NODE_OPTIONS='--max-old-space-size=384' node --test test/fixture-lifecycle.test.ts` với subprocess watchdog khoảng 120 giây; capture exit/assertions/registry/STOP và reap. Browser MCP shell desktop/mobile là lượt nghiệm thu riêng, A1/S1 chưa PASS.

## GREEN vòng đời thực và giới hạn bằng chứng

Lượt GREEN đầu sau implementation gặp `ERR_MODULE_NOT_FOUND` do bốn import từ `v2/web/scripts` đi lên sai mức (`../../../server` trỏ repo-root `server`, không tồn tại). Node exit/reap ~0,1 giây; chưa tạo PostgreSQL, listener hoặc browser. Đã sửa cùng một nguyên nhân về `../../server`; đây là lỗi setup, không tính behavioral GREEN/RED. Trước lượt chạy lại, gate đo 5.198 GiB available, pressure 1, CPU idle 74.1%, disk 26.726 GiB. Bounded runner Node heap 384 MiB, timeout ngoài 120 giây, PostgreSQL18.6 giới hạn 256 MiB/CPU1/pids64; kết quả raw exit 0, timeout false, worker/runner PID 88993/88992 đã reap, test 3/3 PASS trong 1,91 giây. Positive đi qua Docker container/DB riêng, web+API loopback cổng OS cấp, Vite middleware proxy thật; HTTP POST login nhận cookie/CSRF, GET session trực tiếp và qua web `/v2` đều 200. `close()` hai lần cùng kết quả và mọi `CleanupResult` trong callback là stopped/removed. Hai unit âm đối chiếu identity lạ và STOP chưa xác minh trả UNKNOWN, không remove. API log cho thấy cổng 127.0.0.1:59894. Kiểm tra độc lập sau test: `docker ps -a --filter label=crew.v2.run` rỗng; `ps -p 88992,88993` rỗng; `lsof -nP -iTCP:59894 -sTCP:LISTEN` rỗng; không còn `crew-v2-web-*` trong `tmpdir()` macOS. Sole heavy slot trả PM.

Kết quả này xác nhận baseline lifecycle thực, **chưa** xác nhận crash/interrupt thực, browser context/MCP desktop/mobile, typecheck/build/Biome sau ba file fixture, hay toàn bộ A1/S1. Không có claim feature board/map hoặc ticket UI ở Task1.

Raw output GREEN (đã kiểm không có password, cookie, token hoặc key):

```text
owned_test_pid=88992
{"level":30,"time":1791035418688,"pid":88993,"hostname":"Phans-MacBook-Pro.local","msg":"Server listening at http://127.0.0.1:59894"}
✔ withFixture giữ API, web và DB riêng suốt callback rồi đóng đúng tài nguyên (1665.781458ms)
✔ unit: identity lạ giữ UNKNOWN và không gọi stop/remove (0.308334ms)
✔ unit: STOP chưa xác minh giữ UNKNOWN và không remove (0.083584ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1909.49675
raw_exit=0 timed_out=False reaped=True
```

## Final freeze sau typecheck/build và identity witness

Web typecheck đầu trên source fixture dừng TS7016 tại `v2/server/src/docs/manifest.ts:2`: closure của web thiếu declaration producer `v2/server/src/platform/picomatch.d.ts` dù declaration này đã được server chấp nhận. PM chốt thêm đúng `../server/src/platform/picomatch.d.ts` vào `v2/web/tsconfig.json` `include`; SHA-256 producer `2327b1b48df9eefe9437cdaa1ce012e93ae07ab66e19519af949190b324650ac`. Không thêm ambient stub, dependency, nới strict hay loại server source khỏi typecheck. Sau sửa, scoped Biome exit0 (`Checked 13 files`, lock YAML không được Biome nhận), `NODE_OPTIONS='--max-old-space-size=384' pnpm typecheck` exit0, `pnpm build` exit0 (Vite8.3.2, 150 modules), workspace test 1/1 PASS. Biome `--write` đã format ba file fixture và một lỗi `noAssignInExpressions` trong `close()` đã sửa; vì source đổi, lifecycle được chạy lại một lần ở final freeze.

Gate ngay trước lifecycle final: available 5.483 GiB, pressure 1, CPU idle 82.21%, disk 26.751 GiB. Bounded runner 120 giây/Node heap384 MiB: raw exit0, timeout false, tests 3/3 PASS, runner PID7117 và test worker PID7118 đã reap. Fixture xuất nonsecret identity trước cleanup, rồi trả STOP/REMOVE đúng thứ tự. Exact witness:

```text
owned_test_pid=7117
{"level":30,"time":1791035835516,"pid":7118,"hostname":"Phans-MacBook-Pro.local","msg":"Server listening at http://127.0.0.1:62503"}
fixture-identities={"containerName":"crew-v2-web-8e648fb5-0fa4-4fab-8669-481a68ca9df0","containerImageDigest":"sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722","dbPort":62486,"dbName":"crew_v2_test_b904e60cb9894d1f8574201f98cceb51","apiOrigin":"http://127.0.0.1:62503","webOrigin":"http://127.0.0.1:62501","registryPath":"/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-web-VUXR4I/registry.json","resources":[{"kind":"scratch","id":"/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-web-VUXR4I","ownershipNonce":"8e648fb5-0fa4-4fab-8669-481a68ca9df0","startIdentity":"16777229:64591466"},{"kind":"container","id":"b724525c3c6f5beb13c7b585605e6ea42f2f422af2ac4585d58f07fb299fc26c","ownershipNonce":"8e648fb5-0fa4-4fab-8669-481a68ca9df0","startIdentity":"b724525c3c6f5beb13c7b585605e6ea42f2f422af2ac4585d58f07fb299fc26c:2026-10-03T13:57:13.921123918Z"},{"kind":"database","id":"crew_v2_test_b904e60cb9894d1f8574201f98cceb51","ownershipNonce":"8e648fb5-0fa4-4fab-8669-481a68ca9df0","startIdentity":"b724525c3c6f5beb13c7b585605e6ea42f2f422af2ac4585d58f07fb299fc26c:16385"},{"kind":"listener","id":"web:62501","ownershipNonce":"8e648fb5-0fa4-4fab-8669-481a68ca9df0","startIdentity":"7118:Sat Oct  3 20:57:13 2026:web:62501:8e648fb5-0fa4-4fab-8669-481a68ca9df0"},{"kind":"listener","id":"api:62503","ownershipNonce":"8e648fb5-0fa4-4fab-8669-481a68ca9df0","startIdentity":"7118:Sat Oct  3 20:57:13 2026:api:62503:8e648fb5-0fa4-4fab-8669-481a68ca9df0"}]}
fixture-cleanup=[{"resourceId":"api:62503","state":"stopped","reason":null},{"resourceId":"web:62501","state":"stopped","reason":null},{"resourceId":"crew_v2_test_b904e60cb9894d1f8574201f98cceb51","state":"removed","reason":null},{"resourceId":"b724525c3c6f5beb13c7b585605e6ea42f2f422af2ac4585d58f07fb299fc26c","state":"removed","reason":null},{"resourceId":"/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-web-VUXR4I","state":"removed","reason":null}]
✔ withFixture giữ API, web và DB riêng suốt callback rồi đóng đúng tài nguyên (2175.807417ms)
✔ unit: identity lạ giữ UNKNOWN và không gọi stop/remove (0.320584ms)
✔ unit: STOP chưa xác minh giữ UNKNOWN và không remove (0.093584ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2417.618
raw_exit=0 timed_out=False reaped=True
```

Sau run, `docker container inspect b724525c...` trả `No such container`, `docker image inspect postgres:18.6` trả đúng image SHA ở trên, `ps -p 7117,7118` rỗng, `lsof` trên cổng DB62486/web62501/API62503 rỗng, exact scratch path và registry path không còn. Registry gốc bị xóa khi cleanup thành công; block nonsecret ở trên là bản sao evidence cho review, không phải claim registry còn tồn tại. Browser MCP desktop/mobile, crash/interrupt thực và docs check/manifest do controller còn chờ; chưa có A1 browser acceptance hay commit Task1.

Source freeze **trước preview/interrupt** SHA-256 (14 path Task1 do web worker sở hữu; bảng final mới hơn ở cuối báo cáo):

| Path dưới `v2/web/` | SHA-256 |
|---|---|
| `package.json` | `fe1193fca8a0569a48263de921b55f95ca03e0576b2c1de68d679e5ffe39fa82` |
| `pnpm-lock.yaml` | `477c3a3bb178c1274939d9c4274ec42645a807cef4587451766bb0aa7859c7b4` |
| `tsconfig.json` | `b3b18b9d4e46d2e0b753fd2266fe1f3f7ac2ba62ec8ed2c354500b9c87b2c8f1` |
| `vite.config.ts` | `9f925f091186d159d9bebc0f3a564869aa2652abd79ee251d1e4851175890b7f` |
| `index.html` | `da116e8e4ec98db945b7a839bb207f300937d8ec49310c2c2ba6993f69917d14` |
| `src/main.tsx` | `67b5097e0c88ff60f659c403b60a6d57b34670347f580b2353dd88318c176497` |
| `src/router.tsx` | `41912b038b696dfd76bd12bbb83900c502359ceb5edfb9a11709ba7195c78e3c` |
| `src/shell.tsx` | `324cdad64f97b092370ccebeef26a904b994d553e7e971aef297db4695ef6268` |
| `src/styles.css` | `5f327e3d61fa9b50f03070ea208e351d2293d74fbaa0337550f1c906e0caef80` |
| `test/workspace.test.ts` | `9e8fa161c7722c9f1dc4529811729863bdf74d817bf4c9803bd6488ed4e521e2` |
| `scripts/e2e-fixture.ts` | `833c394412e064353aef856a3f9db514ddbcc25d0e5afc36c8cd8cf25b13f74b` |
| `e2e/support/fixture.ts` | `bc1879e7eeef7d3bd03fc64f55e3fee0af3e172fc95a289d9f3ef3d4abc2688a` |
| `playwright.config.ts` | `0bf38e474605cba6b7a8436764358e05390e95759038c33166d6e3ce44fb363a` |
| `test/fixture-lifecycle.test.ts` | `6dd6fc618135dc4ada4ca0a5206012d450c4d5e0b66a91c1c0985fa04c51643d` |

Draft 7H2 `docs/v2/web-shell.md` SHA-256 `3e3cae04f72ba34139b7eb2c1a2ca7d273ed5e98f12e01a7c3a765e128b5d17c`; controller sẽ hòa vào flow chính thức `v2/docs/flows/web-shell.md` và map manifest. Không tự commit/stage/sửa manifest trong lượt worker này.

## Preview MCP đầu và source sau quan sát

PM cấp preview mode sau final lifecycle: `NODE_OPTIONS='--max-old-space-size=384' node scripts/e2e-fixture.ts --preview` tại `v2/web` dùng lại cùng coordinator, chờ lệnh stdin `close` sau browser tab đóng. Trước launch, gate 5.792 GiB/pressure1/CPU idle88.41%/disk26.602 GiB. Process PID21308/start `Sat Oct 3 21:02:49 2026` đã ghi; `preview-ready` xuất web `http://127.0.0.1:64593`, API `http://127.0.0.1:64594`, DB port64585/logical DB `crew_v2_test_b44cc28d09f947548e90bd09facfef5c`; nonce `5868db4c-3bd8-46c4-a5a5-2cfe98fb8d2a`, container ID `cf1496aa6656b39f30cfa177132100ea747b139190b6bbcc8978966ead367e7f`, image SHA `sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`, scratch `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-web-aU77kL` dev:ino `16777229:64593706`, registry cùng path `/registry.json`. Không xuất owner password/cookie/token.

Root dùng Playwright MCP trên tab riêng: desktop viewport1280 và mobile390 đều có `document.scrollWidth === viewport width`, skip link focus-visible xuất hiện. Khi Enter trên skip link, hash đổi `#main-content` nhưng `document.activeElement` vẫn là `BODY`: regression focus thật. Shortcut Ctrl+Equal không đổi browser zoom. Phép CDP metric override yêu cầu viewport640/DPR2 cho screenshot `shell-reflow-200.png`, nhưng file thực 640×534 và cắt sidebar/card phía phải; `scrollWidth==640` không đủ chứng minh layout reflow. **Cả 200% literal lẫn phép tương đương 640 hiện INCONCLUSIVE**; cần `page.setViewportSize(640,400)`, đo bounding boxes và chụp lại trong lượt MCP sau. Console có duy nhất favicon404. Root giữ ba screenshot trong `ui-evidence` và sẽ tự copy/clean scratch PNG, worker không vận hành browser. Sau khi root xác nhận `BROWSER_TAB_CLOSED`, worker gửi `close` vào session58655: process exit0/reaped; `preview-cleanup` báo API/web stopped, DB/container/scratch removed, reason null. Kiểm tra độc lập exact ID: Docker `No such container`, `ps -p 21308` rỗng, `lsof` cổng64585/64593/64594 rỗng, scratch/registry path không còn. Sole heavy slot đã trả PM.

Source Node-free sau quan sát: `src/shell.tsx` thêm `tabIndex={-1}` cho `main#main-content` để fragment target có thể nhận focus; `index.html` thêm inline SVG favicon; `test/fixture-lifecycle.test.ts` thêm bài test thực spawn preview child, chờ registry, gửi SIGTERM, đòi cleanup witness/exit0/exact Docker ID biến mất. RED của test này ở mục kế tiếp; không claim interrupt PASS. Sau các thay đổi này, scoped typecheck/build/Biome/lifecycle/browser focus rerun đều còn chờ gate mới. Bảng 14 hash phía trên là freeze trước preview, không phải hash source hiện tại; sẽ cập nhật sau RED/GREEN và review.

## SIGTERM preview-child RED thực

PM cấp lượt RED chỉ cho bài test SIGTERM. Gate ngay trước launch: available 5.458 GiB, pressure2, CPU idle85.25%, disk26.316 GiB. `NODE_OPTIONS='--max-old-space-size=384' node --test --test-name-pattern=SIGTERM test/fixture-lifecycle.test.ts` trong `v2/web` với watchdog90 giây: raw exit1, timeout ngoài false, test 1/fail1 sau17.16 giây. Fail hành vi `PREVIEW_DEADLINE` khi chờ preview child tự exit trong15 giây; **không** lỗi import/compiler/setup. Trước tín hiệu, test chụp child PID50983, PGID50981, start `Sat Oct 3 21:13:44 2026`, nonce `a6883eed-098b-4aec-a76f-cff38b84cdbd`, container ID `a949ae5dcf827403b5958479ab7105c25b59a51a57b0d9d8215adbe057b4c3c1`, logical DB `crew_v2_test_0df7a67d495440618e184e650abcafef`, web52754/API52755, scratch `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-web-VsuBGs` dev:ino `16777229:64608855`, registry cùng path `/registry.json`. Sau `finally` reap own child, kiểm read-only exact Docker ID trả `No such container`, `ps -p 50981,50983` rỗng, `lsof` web/API rỗng, scratch/registry không còn. Việc tài nguyên đã cleanup không cứu được hành vi preview CLI: signal handler đóng resource nhưng `readline` vẫn chờ stdin nên không phát `preview-cleanup` và không exit0. Sole heavy slot trả PM trước sửa source.

```text
owned_test_pid=50981
interrupt-ready={"childPid":50983,"processRecord":"50981 Sat Oct  3 21:13:44 2026","registryPath":"/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-web-VsuBGs/registry.json","resources":[{"kind":"scratch","id":"/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-web-VsuBGs","ownershipNonce":"a6883eed-098b-4aec-a76f-cff38b84cdbd","startIdentity":"16777229:64608855"},{"kind":"container","id":"a949ae5dcf827403b5958479ab7105c25b59a51a57b0d9d8215adbe057b4c3c1","ownershipNonce":"a6883eed-098b-4aec-a76f-cff38b84cdbd","startIdentity":"a949ae5dcf827403b5958479ab7105c25b59a51a57b0d9d8215adbe057b4c3c1:2026-10-03T14:13:44.530650752Z"},{"kind":"database","id":"crew_v2_test_0df7a67d495440618e184e650abcafef","ownershipNonce":"a6883eed-098b-4aec-a76f-cff38b84cdbd","startIdentity":"a949ae5dcf827403b5958479ab7105c25b59a51a57b0d9d8215adbe057b4c3c1:16385"},{"kind":"listener","id":"web:52754","ownershipNonce":"a6883eed-098b-4aec-a76f-cff38b84cdbd","startIdentity":"50983:Sat Oct  3 21:13:44 2026:web:52754:a6883eed-098b-4aec-a76f-cff38b84cdbd"},{"kind":"listener","id":"api:52755","ownershipNonce":"a6883eed-098b-4aec-a76f-cff38b84cdbd","startIdentity":"50983:Sat Oct  3 21:13:44 2026:api:52755:a6883eed-098b-4aec-a76f-cff38b84cdbd"}]}
✖ SIGTERM trên preview child đóng đúng run và xác minh STOP trước khi thoát (16916.917417ms)
Error: PREVIEW_DEADLINE
raw_exit=1 timed_out=False reaped=True
```

Sau RED, source candidate `scripts/e2e-fixture.ts` thêm nhánh signal cho CLI wait: SIGTERM/SIGINT giải `Promise.race` với `readline`, sau đó await cùng `handle.close()` idempotent và phát cleanup witness. Đây là sửa **Node-free, chưa GREEN**; không chạm helper server, Docker hoặc file peer. Cần gate mới để chạy focused SIGTERM GREEN, rồi scoped typecheck/Biome/build/lifecycle và browser rerun cho focus/favicon.

## GREEN toàn lifecycle dừng ở setup child, UNKNOWN được giữ

PM cấp sole heavy slot, trước launch gate 6.276 GiB/pressure1/CPU idle58.56%/disk25.146 GiB. Bounded `node --test test/fixture-lifecycle.test.ts` raw exit1, timeout ngoài false, runner PID79594/test worker79595 đã reap: positive HTTP/PG và hai unit policy đều PASS, test SIGTERM fail **trước** `preview-ready` với `PREVIEW_EXIT_BEFORE_READY:1:null` sau0.935 giây. Đây là lỗi setup child, không phải GREEN/RED của signal. Child stderr chỉ nằm trong biến `output` của test rồi bị bỏ khi reject, không có transcript để khẳng định lỗi cụ thể; phải sửa test để giữ stderr ở lượt sau. Test positive trước đó có riêng container ID `5d26cc331e9bdd35e537edbebbd3f4a680e42e21caccfbce4d6fcb8aa95592ea`, DB `crew_v2_test_d7dc2d0aa0d946a59bb8e287b89abdd2`, web63852/API63860, cleanup báo tất cả stopped/removed.

Child setup đã ghi registry nonsecret rồi exit: `workerIdentity=79785:Sat Oct 3 21:27:09 2026`, ownership nonce `b91bafd3-d038-4251-8f50-92b9045abf1b`, phase `unknown`, container ID `ea2e1bb147cce3a69e58f749be6cf1e9d12787fca9b6b0bcec0ece4bf4693eca`, name `crew-v2-web-b91bafd3-d038-4251-8f50-92b9045abf1b`, image SHA `sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`, loopback DB port63879, planned logical DB `crew_v2_test_595cda1a58094707b1ab80d315fdf0b5`. `containerLaunchAttempted=true`, `databaseCreateAttempted=true`, `webListenAttempted=false`, `apiListenAttempted=false`, và resources chỉ có scratch + container. Registry path `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-web-4nyvDk/registry.json`; scratch dev:ino `16777229:64615149`, mode0700; registry mode0600. Đúng policy UNKNOWN, fixture **không** tự stop container khi DB create identity chưa được ghi.

Raw registry trước cleanup (không chứa credential):

```json
{"ownershipNonce":"b91bafd3-d038-4251-8f50-92b9045abf1b","phase":"unknown","workerIdentity":"79785:Sat Oct  3 21:27:09 2026","containerName":"crew-v2-web-b91bafd3-d038-4251-8f50-92b9045abf1b","containerId":"ea2e1bb147cce3a69e58f749be6cf1e9d12787fca9b6b0bcec0ece4bf4693eca","containerImageDigest":"sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722","dbName":"crew_v2_test_595cda1a58094707b1ab80d315fdf0b5","dbPort":63879,"containerLaunchAttempted":true,"databaseCreateAttempted":true,"webListenAttempted":false,"apiListenAttempted":false,"apiOrigin":"","webOrigin":"","resources":[{"kind":"scratch","id":"/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-web-4nyvDk","ownershipNonce":"b91bafd3-d038-4251-8f50-92b9045abf1b","startIdentity":"16777229:64615149"},{"kind":"container","id":"ea2e1bb147cce3a69e58f749be6cf1e9d12787fca9b6b0bcec0ece4bf4693eca","ownershipNonce":"b91bafd3-d038-4251-8f50-92b9045abf1b","startIdentity":"ea2e1bb147cce3a69e58f749be6cf1e9d12787fca9b6b0bcec0ece4bf4693eca:2026-10-03T14:27:09.796269333Z"}]}
```

`docker container inspect` xác nhận exact ID/name/image/label/start/mapping 127.0.0.1:63879 và container RUNNING. `docker exec ... psql` read-only trên chính container trả `pg_database` count0 và `pg_stat_activity` count0 cho logical DB exact name; hiện không có DB để DROP. Docker log cho thấy lúc init handoff có `FATAL: the database system is starting up` tại 14:27:10.480 UTC rồi mới `database system is ready to accept connections`. Đây là **giả thuyết race readiness**, không có stderr child để xác nhận CREATE gặp đúng lỗi đó. PM đã cho phép reconcile exact run với kiểm tra catalog/identity lại trước stop; không DROP, không force/prune.

Reconciliation đã hoàn tất sau ruling: recheck exact Docker ID/name/nonce/image/start/mapping đều khớp; catalog logical DB count0 và activity0; scratch dev:ino `16777229:64615149` mode0700. `docker stop --time 5 <exactID>` exit0, rồi `docker inspect` xác nhận `Running=false`, `Status=exited` cùng ID/name/start/nonce; `docker rm <exactID>` exit0. Re-stat scratch cùng dev:ino trước khi Python `shutil.rmtree` đúng path. Final `docker container inspect` trả `No such container`, PID79785 không còn, `lsof` port63879 rỗng, scratch/registry không còn. Không DROP, force, prune hoặc động peer asset. Sole heavy slot trả PM.

Source sửa Node-free sau chẩn đoán: bỏ readiness gate `docker exec pg_isready` vì nó có thể thành công trong giai đoạn PostgreSQL init handoff; thay bằng kết nối `connectDb` tới **mapped loopback base DB** và retry `select current_database()` tới khi trả `crew_v2_test`, kiểm lại container identity mỗi lượt, deadline30 giây. Chỉ sau đó mới ghi `databaseCreateAttempted` và CREATE logical DB. Test SIGTERM child nay giữ 4KiB cuối stdout/stderr trong lỗi setup `PREVIEW_EXIT_BEFORE_READY` để lần sau không mất chẩn đoán. Lượt GREEN sau sửa ở mục kế tiếp; không gọi race đã được xác nhận chỉ từ log PG.

Hai test đơn vị riêng dùng port `readStartIdentity/stop/confirmStopped/remove` giả chỉ để kiểm policy cleanup: identity lạ trả `UNKNOWN/IDENTITY_MISMATCH` và không gọi stop/remove; STOP chưa xác minh trả `UNKNOWN/STOP_UNVERIFIED` và không remove. Chúng không chứng nhận tình huống crash/interrupt container/DB thật; positive lifecycle riêng ở trên mới kiểm PostgreSQL/HTTP và cleanup thành công. Không sửa server helper, không thêm endpoint hay mock entity.

## Freeze cuối sau readiness và SIGTERM GREEN

Sau sửa readiness, focused SIGTERM child trên PostgreSQL/API/web listener thật đạt 1/1, exit 0 trong 2,33 giây. Bản nguồn sau format được kiểm tuần tự với gate tài nguyên mới trước mỗi lần launch: scoped Biome toàn bộ 14 path exit 0 (13 file được Biome hỗ trợ; YAML lock không nằm trong checker), strict `pnpm typecheck` exit 0, `pnpm build` exit 0 (Vite 8.3.2, 150 modules), workspace test 1/1 exit 0. Biome ban đầu chỉ tìm khác biệt format ở `scripts/e2e-fixture.ts`, `test/fixture-lifecycle.test.ts`, `tsconfig.json`; `biome check --write` đúng ba file đó exit 0, rồi chạy lại các phép kiểm trên source cuối. Không sửa package/server/peer hay chạy install lại.

Lượt **final sau format** dùng `NODE_OPTIONS='--max-old-space-size=384' node --test test/fixture-lifecycle.test.ts`, watchdog ngoài 120 giây; gate 6,136 GiB/pressure1/CPU idle87,4%/disk24,873 GiB; raw exit 0, timeout=false, reaped=true, tests 4/pass 4/fail 0, duration 4,236 giây. Case positive dùng HTTP thực `POST /v2/auth/session`, `GET /v2/auth/session` trực tiếp và qua proxy, migration cùng frozen set 001–011, close lặp. Case SIGTERM dùng child preview thực và kiểm exit0/cleanup; hai case identity mismatch và STOP-unverified là unit policy, không đại diện cho DB thật.

Các trị số chép từ stdout và wrapper của lượt này, trình bày rút gọn thay vì giả là bản TAP nguyên văn (transcript tool không được lưu thành file log riêng để cấp SHA-256; không dựng lại bằng lượt test mới):

```text
tests 4
pass 4
fail 0
duration 4.236s
raw_exit=0 timed_out=False reaped=True
```

Các check scoped sau format cũng chỉ có transcript của lượt chạy, không có log artifact để băm: Biome `Checked 13 files`/exit0; strict `pnpm typecheck`/exit0; Vite8.3.2 `150 modules transformed`, `dist/index.html` 0,79 kB, CSS3,83 kB, JS322,46 kB/exit0; workspace test1/pass1/fail0/exit0. Con số build là output đã capture, không đại diện size sau compression. SHA-256 của source dưới đây là dấu vân tay tái kiểm tra tĩnh, không thay thế raw log.

| Run | Exact resource identity trước cleanup | Chứng cứ sau cleanup |
|---|---|---|
| Positive | Runner PID11304, test worker11311; nonce `73f68fda-e4a8-47ac-a40e-447e4507255e`; container `71d52c6f034e19eb27e07226c0a5a65b9b8f4efa558d5f7f7d78d032a7ab3b0d`; DB `crew_v2_test_5ada476e000543b199bfb6040ddc6a6c`; DB port52749/web53108/API53109; scratch `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-web-0SR1TY`, dev:ino `16777229:64631264`, registry cùng path. | Cleanup witness `stopped/removed`, reason null; exact Docker ID vắng, các port/PID và scratch/registry vắng. |
| SIGTERM child | PID11541; nonce `f75b0936-a80c-4b33-bbd6-ef4cc4f4a8b8`; container `9f513bbbb65b7ac6cb42289d56deca83e53d0b3f5a0e012b4d1ef5ce3d5813d7`; DB `crew_v2_test_158a15d700774d94b619b30f2cccae4a`; web53450/API53451; scratch `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-web-YpydO4`, dev:ino `16777229:64631286`, registry cùng path. | `interrupt-cleanup` ghi STOP/remove, reason null, child exit0; exact Docker ID vắng, PID/port/scratch/registry vắng. |

Cả hai dùng image digest `sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`. Kiểm độc lập `docker container inspect` trên từng exact ID trả `No such container`; `ps -p 11304,11311,11541` rỗng; `lsof` trên năm cổng nói trên rỗng; hai scratch và `registry.json` không còn. Đây là chứng cứ STOP của lượt kiểm cuối, không suy ra crash cứng đã được test. Preview MCP lần hai đang chờ browser xác nhận; focus/favicon đã sửa source nhưng chưa có bằng chứng browser trên source này. A1 đầy đủ, review độc lập, map flow/manifest và commit còn chờ PM.

### SHA-256 của đúng 14 path web sau format

| Path | SHA-256 |
|---|---|
| `v2/web/package.json` | `fe1193fca8a0569a48263de921b55f95ca03e0576b2c1de68d679e5ffe39fa82` |
| `v2/web/pnpm-lock.yaml` | `477c3a3bb178c1274939d9c4274ec42645a807cef4587451766bb0aa7859c7b4` |
| `v2/web/tsconfig.json` | `3b293b02a2fa58300b06d37d84172bf96a18034b365c88a7d4c8efa4d4802006` |
| `v2/web/vite.config.ts` | `9f925f091186d159d9bebc0f3a564869aa2652abd79ee251d1e4851175890b7f` |
| `v2/web/index.html` | `66975279061d98af40f7dd53dd3d48f9138aea297bee24abc4b20d187ac15794` |
| `v2/web/src/main.tsx` | `67b5097e0c88ff60f659c403b60a6d57b34670347f580b2353dd88318c176497` |
| `v2/web/src/router.tsx` | `41912b038b696dfd76bd12bbb83900c502359ceb5edfb9a11709ba7195c78e3c` |
| `v2/web/src/shell.tsx` | `4f62e80d9fb4086a7e8dc31824b697c26212d2c53b723a2f82c538441ed619dc` |
| `v2/web/src/styles.css` | `5f327e3d61fa9b50f03070ea208e351d2293d74fbaa0337550f1c906e0caef80` |
| `v2/web/test/workspace.test.ts` | `9e8fa161c7722c9f1dc4529811729863bdf74d817bf4c9803bd6488ed4e521e2` |
| `v2/web/scripts/e2e-fixture.ts` | `892232866e4e43f7ca7cb099628fcf639db7945718074d166d8f3a53bc5a38e1` |
| `v2/web/e2e/support/fixture.ts` | `bc1879e7eeef7d3bd03fc64f55e3fee0af3e172fc95a289d9f3ef3d4abc2688a` |
| `v2/web/playwright.config.ts` | `0bf38e474605cba6b7a8436764358e05390e95759038c33166d6e3ce44fb363a` |
| `v2/web/test/fixture-lifecycle.test.ts` | `93c36bef485f2cbc36eaf2299596302eca635c7c9560968db02e77148f8e8fde` |

Web tsconfig include declaration producer `v2/server/src/platform/picomatch.d.ts` SHA `2327b1b48df9eefe9437cdaa1ce012e93ae07ab66e19519af949190b324650ac` để typecheck dependency closure, không thêm ambient stub trong web. Draft `docs/v2/web-shell.md` là handoff 7H2; flow chính thức và manifest do PM sở hữu.

## Preview MCP cuối trên source freeze

PM cấp riêng preview fixture sau khi final lifecycle 4/4; gate trước launch 6,032 GiB/pressure1/CPU idle88,65%/disk24,742 GiB. `NODE_OPTIONS='--max-old-space-size=384' node scripts/e2e-fixture.ts --preview` ở `v2/web`, PTY session95758, PID23240/start `Sat Oct 3 21:40:24 2026`. `preview-ready` ghi web `http://127.0.0.1:55467`, API `http://127.0.0.1:55469`, DB loopback port55135/logical DB `crew_v2_test_ef2bb3debab44c8a873e3876367b7ee0`/OID16385; nonce `a7c02352-7a8f-4ea9-97d4-1277ff1cd81b`, container exact `e8b410e13fd085c2a2ecbbd4bdd1dcf5110167aa996ca034f4ed9d2e872e04a3`, image digest `sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`, scratch `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-web-gXRkhs` dev:ino `16777229:64632067`, registry cùng path. Không xuất password, cookie, token.

Root điều khiển tab MCP riêng. Quan sát cuối: focus-visible skip link xuất hiện và Enter chuyển `activeElement` thành `MAIN#main-content`; console error 0 (favicon inline không còn 404). Viewport thật 1280 và 390 đều có `document.scrollWidth` bằng viewport width. Dùng `page.setViewportSize(640,400)` thật rồi đo `main.right=640`, `nav.right=183`, `content.right=620.8`; screenshot full page 640×534 cho thấy toàn bộ card nằm trong khung, root đã xem ảnh. Ba screenshot nằm tại `ui-evidence/shell-final-{desktop,mobile,reflow}.png` trong worktree cho PM đánh giá. Shortcut Meta+Equal lặp bốn lần không đổi zoom metrics; **literal browser zoom 200% chưa chứng minh**, phép 640px chỉ chứng minh bố cục tương đương theo CSS viewport. Đây là bằng chứng browser tập trung cho shell guest, không phải nghiệm thu những trang nghiệp vụ Task2–8.

Sau tín hiệu `BROWSER_TAB_CLOSED` của root, worker gửi stdin `close` đúng session95758, process exit0/reaped. `preview-cleanup` ghi API/web `stopped`, logical DB/container/scratch `removed`, tất cả `reason:null`. Đối chiếu độc lập: `docker container inspect` exact ID trả `No such container`; `ps -p 23240` rỗng; `lsof -sTCP:LISTEN` trên ports55135/55467/55469 rỗng; exact scratch/registry không còn. `lsof` không lọc trạng thái còn vài socket Chrome `CLOSED`, không phải listener fixture. Sole heavy slot đã trả PM. Không sửa source sau lượt final lifecycle và MCP này.

## FIX1 / I1 — active request và cleanup có deadline

Review `task-1-review.md` SHA-256 `95fc6c1abb50aab7a788ee134f92185ba497edd6c7dc1fc3ed46d0afdf5eb321` phát hiện `vite.close`/`app.close`/`server.close`/pool và `closeOwnedResource` chờ vô hạn. Trên source reviewer chưa sửa, test mới mở **request HTTP thật** `POST /v2/auth/session` tới API riêng, gửi đủ headers và một byte JSON nhưng giữ body chưa hết, rồi gọi `handle.close()` khi socket còn mở. RED có `ACTIVE_REQUEST_CLOSE_DEADLINE` sau5 giây, raw exit1, tests1/pass0/fail1, runner PID85772/worker85773, outer90s không timeout; test tự hủy đúng socket và chờ original close, không dùng force cleanup. Log nguyên văn `task-1-fix1-red.log` SHA `583f2b2d025fe35d3b77dbf079fb366bab52515ef5cc281d191deb66f36a6115`. Run nonce `f8a13ac4-e563-44af-9a1f-1d766b6a8b89`, container `440c373e4732fb8d56cc05d58abfe682f894698ab03898a54062bfeb2233a45a`, DB `crew_v2_test_dfa151af876b49909f5e6e5a9d0fbb60`/OID16385, web63803/API63804, scratch `crew-v2-web-rQ0uCK` dev:ino `16777229:64643099`. Sau RED, exact Docker ID/PIDs/LISTEN ports/scratch-registry đều vắng. Đây là lỗi hành vi thực, không phải setup/import/type failure.

GREEN giới hạn thay đổi ở `scripts/e2e-fixture.ts`, `e2e/support/fixture.ts` và test trên, không đổi UI, server helper hay package. Coordinator theo dõi các socket API/web do chính fixture nhận, từ chối socket mới lúc đóng và hủy socket đang chạy trước các pha Vite/Fastify/HTTP close. Mỗi pha read identity → STOP → xác minh STOP → remove có deadline và AbortSignal; timeout trả `UNKNOWN`, không khởi chạy pha tiếp. Nếu Vite close không rõ, vẫn thử đóng listener của mình trong hạn, nhưng không DROP DB/rm container; pool dùng `end({timeout:2})` để hủy query. `DROP DATABASE` chỉ được gọi sau STOP DB xác minh, trên connection admin reserved với `statement_timeout=3000` và `query.cancel()` khi abort; tín hiệu được kiểm trước khi gửi lệnh. Docker CLI nhận abort signal; UNKNOWN giữ registry và container để PM đối chiếu. Các lệnh remove đã bắt đầu mà mất phản hồi vẫn phải được PM reconcile, không thể suy STOP từ Promise timeout. M1 callback throw falsy là Minor review riêng, chưa sửa trong FIX1.

Focused GREEN trên request gửi dở: raw exit0, tests1/pass1/fail0 trong2,291 giây, log `task-1-fix1-green-focused.log` SHA `abae0366797fbfae3c305eb09b19d310e029233098c2249f258c8d51d3f2a50a`. Run nonce `17ae459d-332a-4cdd-a0b7-d1e3ac57a8b8`, container `281c4ea34ab11444a5d70446469a3912241fdce6774764573cbabb7c812d0c85`, DB `crew_v2_test_04edb011a36f4bc09211aae88893e642`/OID16385, web51881/API51883, scratch `crew-v2-web-uFYGGf` dev:ino `16777229:64646391`; cleanup witness all `stopped/removed`, reason null, exact Docker ID/PIDs/listener/scratch-registry vắng.

Sau format-only (`biome check --write` sửa 2 file), check cuối trên **source đã format**: `pnpm typecheck` exit0, raw `task-1-fix1-typecheck-final.log` SHA `7b03903838eaa7a5bfa440398bd0c61811a385f32768e9e19efd9040136ed835`; scoped Biome 3 path exit0, raw `task-1-fix1-biome-final.log` SHA `2a118c6d22331a9d205d1066d761a01093204f39eddffa9dfd6b98e828a77179`. Lượt Biome đầu chỉ báo format, exit1, log `task-1-fix1-biome.log` SHA `3f2e3b3c282d86504ff3543891d761fad1299f861bbc3241e024a668bced4f91`; lượt `--write` exit0, log `task-1-fix1-biome-write.log` SHA `bf941693634ad38c32110a0bcf199f0ef49a5994072e3dc6884a667c89a4cc1d`. Không chạy build/browser/install vì ba path này không sửa UI/bundle dependency và grant chỉ dành affected lifecycle.

Final affected lifecycle `NODE_OPTIONS='--max-old-space-size=384' node --test test/fixture-lifecycle.test.ts`: raw exit0, tests5/pass5/fail0, duration6,123 giây, outer120s không timeout, runner PID14535/worker14536/SIGTERM child14876 đều reap. Log nguyên văn `task-1-fix1-lifecycle-final.log` SHA `b463f2d3f7d6d85a4f91919b22251469e40ae7256f50e94dd035fbc852b3a363`. Case1 HTTP login/session/proxy + close lặp, case2–3 unit UNKNOWN policy, case4 active partial-body request, case5 preview SIGTERM thật. Ba container exact `c2782fe6584169003ee66742509659cccea2a416df25383ae3070d2f4ba440cb`, `4231556d336a5a7af30f78841cf1c607c17df1c327a3f7b514d5d588284b2070`, `3eedefed8ea52b7f39cf316b3559185851c5b10e9f2df87522bd0e7e95ad79ff`; ba scratch `crew-v2-web-MgcavL` dev:ino `16777229:64647231`, `crew-v2-web-sY80XP` dev:ino `16777229:64647252`, `crew-v2-web-6tWjiz` dev:ino `16777229:64647272`. Cleanup log cho mỗi run ghi API/web stopped, DB/container/scratch removed, reason null. Đối chiếu độc lập exact cả ba Docker ID `No such container`; `ps -p 14535,14536,14876` rỗng; LISTEN ports52854/53201/53203/53569/53575/53945/53947 rỗng; ba scratch và registry không còn. Không có UNKNOWN tồn dư từ lượt kiểm này.

SHA-256 mới nhất của đúng 3 path đổi trong FIX1: `v2/web/scripts/e2e-fixture.ts` = `3274e39da3c6a799e855530f8899585dd4fb01216f615f66650332c0bedf39df`; `v2/web/e2e/support/fixture.ts` = `5701820d97284fd2c82c697406881d3cd87d47a2139289e8fcd4ee192c3f43bb`; `v2/web/test/fixture-lifecycle.test.ts` = `ae89453ed9f3932488fb80af9c054aeca043ef61a345d2e445d65852e977f135`. 11 hash còn lại trong bảng freeze trước FIX1 không đổi. Slot heavy đã trả PM; review lại I1, docs flow/manifest và commit do root điều phối.

## FIX2 / F1 — scratch remove trả trễ sau UNKNOWN

Review `task-1-fix1-re-review.md` SHA `915272fa8f2e522eebaee9644ed8020533422a5846d71f04fade7fdd716745d4` tìm thấy callback scratch `remove` còn bỏ qua AbortSignal: khi `stat` của REMOVE trả sau deadline, nó vẫn có thể gọi `rm` xóa registry đã được đánh dấu UNKNOWN. Ba file FIX1 đã được chụp nguyên byte trong `execution-phase07/task-1-fix1-baseline/` trước khi sửa; script/test/support lần lượt SHA `3274e39d…`, `ae89453e…`, `5701820d…`. Theo ruling PM, worker chỉ tách callback cũ thành `createScratchRemoval` trong cùng `scripts/e2e-fixture.ts`, production dùng chính helper ấy; hành vi thiếu guard vẫn giữ để test RED có ý nghĩa.

Test unit tạo scratch/registry tạm do mình sở hữu, dùng helper production với `stat` được trì hoãn qua deadline250ms của `closeOwnedResource`, rồi nhả `stat` và kiểm `rm` không được gọi trễ, registry còn tại thời điểm UNKNOWN. RED trên hành vi cũ: raw exit1, tests1/pass0/fail1, `removeCalls` thực1 thay vì0; TAP534,91075ms, wrapper0,563s, watchdog90s không timeout, PID76193 đã reap. Raw `task-1-fix2-red.log` SHA `482aa14f0e913e4578279917363a25a83cf938f36780683cc02105c48dc8b41e`. Lượt RED đầu không in exact temp path/dev:ino trước cleanup, nên không dựng lại danh tính giả; test `finally` đã dọn own temp, kiểm sau run không còn thư mục `crew-v2-web-fix2-*` trong OS tmp root. Không mở PostgreSQL/browser.

Sau RED, helper nhận `signal` và kiểm `signal.aborted` **ngay sau** awaited `stat`, trước identity check và `rm`; không đổi các pha còn lại. Audit hẹp: DB remove kiểm abort sau `readDbIdentity`, `reserve`, `SET` trước DROP; Docker remove kiểm sau `readContainerIdentity` trước `docker rm`; scratch nay kiểm sau `stat` trước `rm`. Operation đã gửi trước timeout vẫn có thể cần reconcile nếu mất phản hồi; fix này chặn operation mới khởi chạy sau UNKNOWN.

Focused GREEN chỉ test scratch: raw exit0, tests1/pass1/fail0, TAP952,808292ms, wrapper1,017s, watchdog90s không timeout, PID84133 đã reap. Raw `task-1-fix2-green-focused.log` SHA `4cc8c5a143bf960032ac44b1dedc8b02fe77726489a595461933778f183af069`. Exact temp `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-web-fix2-ZAGNfP`, registry cùng path `/registry.json`, dev:ino `16777229:64675993`; assertion xác nhận `REMOVE_DEADLINE`, `rm` không được gọi sau nhả `stat`, registry còn tại thời điểm UNKNOWN. Test sau đó tự dọn đúng scratch tạm; independent PID84133 và exact temp/registry vắng. Không có resource production cần reconcile.

FIX2 scoped Biome đầu chỉ báo import order/format ở test, raw exit1, log `task-1-fix2-biome-before.log` SHA `37013611f71787f71989bfa3714b72ff7a81ed47a57e561bf2d3b62cab70a8d2`. Gate CPU lúc đó chỉ38,34% idle nên worker sửa đúng các dòng format bằng patch Node-free; sau telemetry mới hợp lệ, scoped Biome hai path exit0, `Checked 2 files. No fixes applied`, log `task-1-fix2-biome-final.log` SHA `585079f16552e5d2e0bc64392004127942a02ccd430c9375d907f9975272ceeb`. Không đổi hành vi sau focused GREEN.

FIX2 source hiện tại sau format: `v2/web/scripts/e2e-fixture.ts` SHA `3788a4e1333b1b6990dfddc4f7634a4e87a1472c00472f614c3f708d0a7745a7`; `v2/web/test/fixture-lifecycle.test.ts` SHA `f0f11bef68ac18cca60968cb3dd8d4657f3d4e70ca7c8e9e75aa57ac2d0a48a1`; `v2/web/e2e/support/fixture.ts` không đổi, SHA `5701820d97284fd2c82c697406881d3cd87d47a2139289e8fcd4ee192c3f43bb`. 11 path UI/package không đổi. Slot heavy đã trả; full6/typecheck và independent FIX2 re-review còn chờ gate sau.

## FIX2 final checks 04/10 (Claude)

Môi trường: worktree `my-crew-v2`, HEAD `6040292`, Node v24.21.0, pnpm 10.32.1, Asia/Ho_Chi_Minh, heap 384 MiB, watchdog Python 120 giây. Ba file fixture không đổi so với freeze FIX2 (SHA khớp): `v2/web/scripts/e2e-fixture.ts` `3788a4e1333b1b6990dfddc4f7634a4e87a1472c00472f614c3f708d0a7745a7`; `v2/web/test/fixture-lifecycle.test.ts` `f0f11bef68ac18cca60968cb3dd8d4657f3d4e70ca7c8e9e75aa57ac2d0a48a1`; `v2/web/e2e/support/fixture.ts` `5701820d97284fd2c82c697406881d3cd87d47a2139289e8fcd4ee192c3f43bb`. Không sửa source, không chạm server/peer.

Gate trước từng lượt (available GiB / pressure / CPU idle / disk GiB): install 5,207/1/82,41/754,1; lifecycle 4,881/1/81,96/754,1; typecheck+Biome 4,675/1/82,63/753,9. Đều đạt ngưỡng.

| Lệnh (tại `v2/web`) | Kết quả | Log, SHA-256 |
|---|---|---|
| `pnpm install --frozen-lockfile --ignore-workspace` | exit0, 1,5 giây | `task-1-fix2-install.log` `2e113907cda6d5787bbf15667ae414e0102b4315b2e084b80f14dbab6b02d25f` |
| `node --test test/fixture-lifecycle.test.ts` | raw exit0, timeout=false, tests6/pass6/fail0, duration 7,52 giây (wall 7,58) | `task-1-fix2-lifecycle-final.log` `d185988701e49ecd5966dcd4154556d782718914a40b0bb4efa87abe852c7173` |
| `pnpm typecheck` (tsc --noEmit) | exit0 | `task-1-fix2-typecheck-final.log` `f9298a7c434333ec4b4350b047dff28c620bf765247f816f3b0f36a7cd8c9ca5` |
| `pnpm exec biome check` 3 path fixture | exit0, Checked 3 files, 2 warnings/29 infos (lint/style/useTemplate, không chặn) | `task-1-fix2-biome-final.log` `f90d0cc0c7e570c0a8c82d22f2c9e23abaea8304f2e21848fb0a0abf0f4b66c1` |

Sáu case PASS: withFixture positive, unit identity lạ, unit STOP chưa xác minh, unit scratch REMOVE hết hạn rồi stat trả trễ (252 ms, `rm` không gọi, registry còn), request gửi dở, SIGTERM preview child. Log trước đó giữ nguyên: RED `482aa14f…`, focused GREEN `4cc8c5a1…`, Biome-before `37013611…`.

Identity run: runner PID8231, SIGTERM child PID8649; ví dụ nonce-container `crew-v2-web-198844d4-579a-46cb-8d4f-f324eb52bfbf`, DB port57830, web58213/API58214 và API58626; ba container exact `0f7346a0871731ed9a4d85ec469367fe13cf7dcb1a7f3719bdf1727a5a3e6ec6`, `62ef6b97c9622cc0abe496c1624a59433313e595293b6b2a910301a4805303b7`, `978e9ae89ccd9a90d58d97b6a8cb727d1edf42c396167b5c704c58a298050820`; image digest `4ef4dbc9…c2280` (postgres:18.6 local). Scratch (TMPDIR `/var/folders/wr/3y_dzgm55m3fy0gtp5sznlnh0000gn/T`): `crew-v2-web-fHUpFD`, `-jaquZS`, `-NYooz1`, `-fix2-tony8x`.

Cleanup witness: log ghi 6 `stopped` và 9 `removed`, tất cả `reason:null`. Độc lập sau run: `docker container inspect` ba exact ID đều exit1 (không tồn tại); `docker ps -a --filter name=crew-v2-web` rỗng; `ps -p 8231,8649` rỗng; `lsof` LISTEN trên 57830/58213/58214/58626 rỗng; không còn thư mục `crew-v2-web*` trong TMPDIR. Container `magical_lehmann`, `modest_jemison`, `crew-dev-postgres`, `visinote-*` không do em tạo, không chạm. Docs R3: không có source đổi nên không cần sửa flow/manifest. Slot heavy trả PM.
