# Phase06/T2 — Slice A bàn giao independent review

**Status: DONE_WITH_CONCERNS cho Slice A được PM release; full T2 chưa hoàn tất.** Source freeze ngày2026-10-03 lúc19:43 Asia/Ho_Chi_Minh. Không commit/Git/index hoặc thay file peer. PM thông báo HEAD docs-only `3c222c5`; T1 source vẫn accepted `feaea55`. Brief/spec/checksum và full preflight ở `task-2-preflight.md`.

## Phạm vi đã làm

Chỉ ba file source/test được release:

| File | SHA256 cuối |
|---|---|
| `v2/server/src/assistant/authority.ts` | `71ff48e99e9725c26dacc49c1be74ddd3615079554a01872213449d2f5b58621` |
| `v2/server/src/assistant/routes.ts` | `5059e6467f39a9a53b93499f16af948f2e7172a45211c89ef19d089d8936180f` |
| `v2/server/test/assistant-authority.test.ts` | `e98b691527e79c7260fc43e2a2d2b3334365e867549a1ed12f90570ceb122694` |

`registerAssistantRoutes` cung cấp owner GET/PUT `/v2/assistant/config`, chỉ nhận `preferred:null`. Dùng actual owner cookie/Origin/CSRF, strict body/query/schema, credential recheck trong transaction trước cached reply và journal thật. Owner chọn một máy chưa revoke, config CAS theo revision. Replay giữ response cũ và không tạo designation thứ hai; revoke session hoặc máy đích chặn cả replay. Cập nhật policy cùng máy giữ designation identity; reassignment khi idle retire identity cũ và tạo revision mới. Máy bất kỳ không thể tự designate. Metadata config không tạo turn/grant/admission/receipt/command.

Reassignment khi có turn chưa stopped trả409 và không thay config/authority. Slice này chưa có actual retirement/stop producer nên không retire một phần hoặc tạo pending designation giả. Calibration guard đang active cũng giữ config. SQL011 và contracts frozen không sửa.

Internal seam được định kiểu `PersistedAssistantActorResolver = (tx:Tx, proof:OrchestrationProof) => Promise<Actor>`, factory `createPersistedAssistantActorResolver()`. Factory chỉ có diagnostics scope/fence hiện hành rồi **luôn từ chối admission**; không có callback/boolean cho phép giả measured trust. Thiếu scope404, stale fence/scope409, current identity vẫn503 `ASSISTANT_ADMISSION_NOT_CONFIGURED`. Caller tương lai giữ root/tickets/projects trước gọi resolver; Slice A không đọc input/grant hoặc chạy callback late-fence009. T3 có thể capture function này trong constructor, nhưng chưa thể tạo run thành công bằng nó.

## TDD và kiểm thử đã chạy

Scaffold tối thiểu trước RED: routes factory không đăng ký handler, resolver ném unavailable. Không có compiler/import failure được tính là RED.

Command RED và GREEN (cwd managed worktree):

```sh
NODE_OPTIONS=--max-old-space-size=384 \
CREW_V2_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:58362/crew_v2_test \
CREW_V2_TEST_CONTAINER_ID=8d790307dfe30f7effb88bb8d7562183c83f77e1c549ec849f60eed61761cbc1 \
node --test --test-concurrency=1 v2/server/test/assistant-authority.test.ts
```

- RED đầu:4/4 thất bại, exit1. Expected HTTP200/403 trả404; resolver chưa phân biệt missing scope.
- RED expanded trước implementation:6/6 thất bại, exit1. Thêm CAS race nhận404/404 thay200/409; live reassignment404 thay409. Raw logs giữ nguyên.
- GREEN implementation đầu:6/6 PASS, exit0.
- Sau sửa own nullability type error và thêm explicit revoked-target replay assertion, final affected run: **6/6 PASS**, fail0/skip0, exit0, duration2031.87075ms. Không cộng nhiều lượt thành tổng test mới.

Sáu test dùng actual Fastify route/auth/mutator và PostgreSQL011 riêng; không provider/network inference. Chúng kiểm owner CAS/replay/persisted audit/no grant, machine/CSRF/schema/target denial, session revoke giữa preflight và transaction, current SQL UNVERIFIED fixture không cấp Actor/expired scope/stale fence/revoked machine, simultaneous CAS+idle retirement, live turn hold và unrelated config update giữ turn. Relational negative fixture dùng accepted assistantFixture(db), UNVERIFIED receipt và canonical snapshot `{}`; không dùng các hàng đó làm production proof, bootstrap hoặc input success.

## Typecheck, Biome và giới hạn bằng chứng

1. `NODE_OPTIONS=--max-old-space-size=384 pnpm --dir v2/server typecheck` exit1. Một lỗi own `designationId: string|undefined` tại authority.ts đã sửa thành nullable SQL parameter. Cùng lượt full check còn lỗi ngoài slice: thiếu `@napi-rs/canvas`, `pdfjs-dist`, `pdf-lib`; dependent `a` implicit any và `object` unknown trong extractor PDF; PDF/image test thiếu pdf-lib. Giữ nguyên raw full failure, không install/edit peer hoặc tuyên bố full typecheck PASS.
2. Scoped strict tsc không skipLibCheck sau own fix: chỉ lỗi external `thread-stream/index.d.ts(96,73)` thiếu `worker_threads.TransferListItem`. Raw log giữ riêng.
3. PM cho phép external-declaration skip. Final frozen scoped command dưới **exit0, không diagnostic**, giữ strict cho ba file và imported source dependency closure:

```sh
NODE_OPTIONS=--max-old-space-size=384 pnpm --dir v2/server exec tsc \
  --noEmit --ignoreConfig --skipLibCheck --target ESNext --module NodeNext \
  --strict --allowImportingTsExtensions --erasableSyntaxOnly --verbatimModuleSyntax \
  --types node src/assistant/authority.ts src/assistant/routes.ts test/assistant-authority.test.ts
```

4. `NODE_OPTIONS=--max-old-space-size=384 pnpm exec biome check v2/server/src/assistant/authority.ts v2/server/src/assistant/routes.ts v2/server/test/assistant-authority.test.ts`: exit0, `Checked 3 files in 26ms. No fixes applied.` Earlier scoped --write chỉ format đúng ba file. Direct node_modules binary command bị context hook chặn; dùng command pnpm exec chuẩn, không sửa ignore/permission.
5. Full server test suite chưa chạy: PM chỉ release sole heavy slot cho scoped Slice A. Không có full T2/docs/assembly/native certification acceptance.

## Resource evidence và cleanup

- Private PostgreSQL18.6 image local `sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`; container `8d790307dfe30f7effb88bb8d7562183c83f77e1c549ec849f60eed61761cbc1`, name `crew-v2-test-82f2550f-72a8-46f0-b8da-542c1b4c9769`, random loopback port58362. No shared/prod DB/service restart.
- docker inspect đo memory268435456, nanoCPUs1000000000, pids64. TCP SQL `select 1` qua127.0.0.1 trong container sẵn sàng trước Node.
- Mỗi heavy launch có fresh sysctl/vm_stat/top/df. Pressure tất cả1; available được tính `(free+inactive+speculative)*16384` byte, không tính compressor, mọi lần ≥4GiB (lowest final tsc khoảng4.58GiB). CPU idle các lượt ≥59.77%; disk luôn hơn29GiB. Trước create container: free38380/inactive350684/speculative1772, idle70.53%. Trước final tests:10654/340992/1052, idle70.51%. Trước final tsc:12073/283927/4081, idle78.81%. Usage limit đã đọc34% used/66% remaining. Node heap384 và test concurrency1.
- Mỗi databaseFixture tạo logical DB `crew_v2_test_<uuid>`, drop trong finally. Trước stop container, actual psql list `datname like 'crew_v2_test_%'` trả không hàng.
- Final test process PID30552 đã exit, `ps -p30552` không output. Final test scratch roots `.../crew-v2-attachments-dJaHW9` và `.../crew-v2-attachments-xh9Swp` được fixture kiểm inode/nonce rồi xóa; shell kiểm không còn. Cleanup log cũng đối chiếu toàn bộ7 roots từ bốn lượt RED/GREEN, đều ABSENT.
- `docker stop <exact ID>` thành công; `docker ps -a --filter id=<exact ID>` không hàng (`--rm`). Không tài nguyên test còn giữ; heavy slot trả PM.
- SQL011 SHA vẫn `fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841`; contracts SHA vẫn `adee25f453fa91e7498a1a300d3c7a4761147b8584e738a54818d9cb4b65412f`.

## Self-review và ruling hiện hành

- Đọc lại toàn bộ hai source file và helper/test boundaries: không actor substitution, global ACL extension, source grant/certificate/approval, command execution hoặc expiry-based stop. Calls dùng caller Tx và generic producer không thay.
- Config order: journal advisory/event_cursor → calibration guard → current/target machines sorted → config → current designation → live turns nếu đổi máy. Guard dùng chung với T1 serialize config/admission; không lock input009 trong Slice A. Pre-cache authorization không kiểm expectedRevision để same-key replay hợp lệ; mutation mới kiểm CAS. Current target revocation vẫn được kiểm trước cache.
- HTTP route validate full policy theo frozen strict schema; setAssistantConfig là internal route service với documented validated-body precondition. Không có service caller nhận arbitrary provider payload.
- accepted PM rulings: captured persistedActorResolver+orchestration không đổi public createRun/answerGate; gate reserve UUID rồi materialize với actual artifact và missing gate deny; live reassign409 tới retirement producer; metadata không cấp execution.
- Deferred: positive admission/input/session resolver, G1 producers,009 grants/text-only/R3, docs read success, turn lifecycle/reassignment pending, protocol/provider correlation, R1 certifier/G2 driver/native measured boundary, T4–T7 assembly. Không giả PASS để chạy các phần đó.
- ProviderCallId carrier chỉ approved-in-principle, chưa wire/source. Proposal cho Slice C review: một canonical bounded header, reject duplicates/control/oversize, giữ case, không trim làm hai provider IDs nhập một; request digest SHA256 canonical tuple namespace/version + normalized providerCallId + exact frozen RoutingToolRequest, same effective envelope trong journal và immutable tool row. Same op/sequence khác correlation/hash409; correlation không cấp quyền. Exact header name/normalization/bounds chưa frozen và không triển khai.
-009 same-order prelock recipe và exact G1/R3 producer transfers vẫn gate trước Slice B/C. Không gọi full fence trong late grant callback.

## Evidence files SHA256

Các file dưới cùng thư mục report:

| File | SHA256 |
|---|---|
| task-2-slice-a-red.log | 0cdaea42dd879232ae4e18d68ce74d7b414706ce020d06ff627fced5152a0504 |
| task-2-slice-a-red-expanded.log | 643930e611ba4d891a6955e12037afa06453169347cf168a0c081a7ee33edb90 |
| task-2-slice-a-green.log | b15b976948373fcdfca3c36dcc4cfac2be3cfedc856e533fa1247419d592778e |
| task-2-slice-a-green-final.log | fd7c37d36f971d5c43d9b4ead387963419046358370b2283268e44fe7c6eb098 |
| task-2-slice-a-typecheck.log | a71884a131262537f3a82531efacba9b5e61e4fd0a8f99888b2c0be4cd57ce29 |
| task-2-slice-a-scoped-typecheck.log | 4c564f16cb543c778d7f834be013e608b33ceb79eb3285c5eee816245c72bc4c |
| task-2-slice-a-scoped-typecheck-final.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| task-2-slice-a-biome.log | ceb7ed95b18271c966627ded3adef7564c7739e46f60540f916253bd8b002618 |
| task-2-slice-a-cleanup.log | 323d0d29af319f486fe04496a958cc93b26acfb0a8ae5266873129385f86acb7 |

Documentation draft để PM tích hợp flow: `task-2-slice-a-docs-draft.md`. Chờ independent review Slice A và ruling/release slice tiếp; không có human question hoặc authorization request.

## FIX1/5 — A1/A2: ready for independent review

Independent review `task-2-slice-a-review.md` SHA256 d6048e0aa9b13412ccd28842d23d0a7f25461f7119f0d49048d6e3f901d5dbc9 yêu cầu hai sửa đổi: credential snapshot trước lock wait và UUID casing. Scope vẫn đúng ba file source/test, không thay auth producer, schema, DTO hoặc ACL.

RED baseline ban đầu: authority SHA71ff48e99e9725c26dacc49c1be74ddd3615079554a01872213449d2f5b58621; routes SHA5059e6467f39a9a53b93499f16af948f2e7172a45211c89ef19d089d8936180f. Batch12 exit1: tám A1 guard/machine × fresh/replay × revoke/expiry có actual pg_blocking_pids witness, HTTP200 thay401; hai A2 có404 thay200. Hai reverse credential-order test chỉ timeout quan sát khóa5s, được phân loại diagnostic, không dùng làm semantic RED.

Sửa observer của đúng hai reverse test để phân biệt actual committed revoked row với actual lock wait. Rerun chỉ hai test exit1: cả hai quan sát revoked=true trong khi request đã authorize đang pause, actual `revoked` thay `blocked`. Không cộng các lượt thành một suite tổng. Mã production chưa thay giữa hai RED này.

Sau RED mới sửa route: chuẩn hóa machineId nội bộ sau schema; journal vẫn hash body gốc. Sau authority lock, khóa đúng session owner FOR SHARE rồi query riêng kiểm revoked/expiry bằng clock_timestamp; giữ khóa qua cache/work/commit. PM chấp thuận thêm prelock live-turn theo condition reassignment hiện hữu để credential check nằm sau mọi authority wait. Regression turn-expiry trên partial FIX1 đã RED riêng1/1 (exit1): actual200 thay401, pg wait90→89 tại assistant_turns và DB expiry/xact-start witness. Baseline authority71ff48e9… chưa đổi, route7ee13c26003aaf83cdaf18a887a96e8580012a7925a7135b35d61cf25e292df1 có helper/session lock và normalization; không restore source cũ. Sau RED mới thêm prelock live-turn theo điều kiện missing/retired/different designation, giữ validation order ở work.

RED resource/cleanup: own PG446a1e9ac3899e7be4981d50be3f3f3ce6bf411fe4aa69c011d35afad519f088, name crew-v2-test-a1fe16e8-2e83-4525-b8dc-9ac95719882c, loopback60288, memory256MiB/CPU1/pids64. Fresh gates trong resource log đều pressure1, available≥4GiB, idle≥50%, disk≥8GiB. Nodeheap384/concurrency1. Container đã stop và --rm; logical test DB không còn; ps không còn assistant-authority Node. Raw cleanup có docker/ps current-absence witness cho cả historical container8d790…/PID30552; không rerun historical suite.

Evidence hiện có: task-2-slice-a-fix1-red.log; task-2-slice-a-fix1-red-credential-lock.log; task-2-slice-a-fix1-red-resource.log; task-2-slice-a-fix1-red-cleanup.log. Turn RED logs: task-2-slice-a-fix1-turn-{red,resource,cleanup}.log. Private PG0fbf2ab286eeeb0591a4a7fa74c470fe9464bc92c346abe8dd6ad536ec443f7e loopback49398 đã dọn; PID27495/scratchECx3P5 absent, logical test DB empty. Docker --rm thoáng trả Dead sau stop rồi lần quan sát kế tiếp không hàng; giữ cả hai raw output. GREEN/source freeze/final hashes đã chốt dưới đây.

### FIX1 final verification

Final affected run: **19/19 PASS**, fail0/skip0, exit0, duration7213.031917ms. Sau prelock và format, chỉ chạy một lần. Sáu test Slice A cũ và 13 regression FIX1; không cộng RED/GREEN thành số test tổng.

```sh
NODE_OPTIONS=--max-old-space-size=384 \
CREW_V2_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:50601/crew_v2_test \
CREW_V2_TEST_CONTAINER_ID=fbb31be9ff9ccfe94085add6337f344c3f42cac2ebcdc5f147eba308bc78c536 \
node --test --test-concurrency=1 v2/server/test/assistant-authority.test.ts
```

Scoped strict command giữ đúng flags đã ghi ở mục typecheck trên: exit0, raw log rỗng; skipLibCheck chỉ bỏ external declarations. Biome check --write đúng ba paths exit0, `Checked 3 files in 30ms. Fixed 1 file.` (test formatting), trước final GREEN. Không rerun full server typecheck/install dependencies; historical full-check failure và giới hạn extractor/declarations giữ nguyên.

Lock order: journal advisory/event_cursor → calibration guard → sorted current/target machines → config → designation → live turns nếu reassignment → exact owner session FOR SHARE → statement mới kiểm revoked/expiry bằng clock_timestamp → journal cache hoặc work/commit. Work query lại các row locks đã giữ. Owner credential dùng existing readSessionCookie/sha256 và owner_id='owner'; actor hiện hành vẫn so với preflight owner. Revoke đến trước final check trả401; đến sau chờ commit. Expiry kiểm tại authorization linearization sau lock waits. Raw request body vẫn là journal hash identity. Same-machine uppercase nội bộ canonical, không thành reassignment.

Self-review: đã đọc lại helper/auth ordering, pre-cache boundary, conditional prelock và new race tests. Guard giữ config/designation ổn định; prelock bao gồm retired current designation tương ứng readAssistantConfig trả null. Turn-stop trong regression chỉ là relational fixture với UNVERIFIED turn, không phải runtime/production stop proof. Resolver vẫn default deny. Không thay auth helper, tickets ACL, SQL001–011, contracts, assembly, manifests hoặc peer files. Không commit/stage.

Final GREEN resource: own name crew-v2-test-cb8aed28-921e-4f93-b166-b7395a8121aa, PG18.6 container fbb31be9ff9ccfe94085add6337f344c3f42cac2ebcdc5f147eba308bc78c536, loopback50601, memory268435456/nanoCPUs1000000000/pids64. Mỗi Biome/create/test/tsc launch có fresh pressure1/vm_stat/top/df; available≥4GiB, idle thấp nhất75.97%, disk≥25GiB, Nodeheap384. PM quota45% used/55% remaining. Logical test DB query trước stop không hàng. Actual docker ps không còn container; psPID32326 và process-pattern không còn test/tsc/Biome; bốn scratch roots rDWfL4/5wNbj3/BSwqPO/lFgORp đều ABSENT. Trả sole heavy slot trước hoàn thiện report.

### FIX1 frozen files và raw evidence

| File | SHA256 |
|---|---|
| v2/server/src/assistant/authority.ts | 9fea4d72fb779daba72d39fc748eb24ed6401301955b369944ccce1e4c5b19cf |
| v2/server/src/assistant/routes.ts | 7ee13c26003aaf83cdaf18a887a96e8580012a7925a7135b35d61cf25e292df1 |
| v2/server/test/assistant-authority.test.ts | 0366f1b7412c7534ec6b10ce25905d9116d6668fb6b7aecdb8839bf763711c90 |
| v2/server/migrations/011_assistant.sql | fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841 |
| v2/server/src/assistant/contracts.ts | adee25f453fa91e7498a1a300d3c7a4761147b8584e738a54818d9cb4b65412f |
| task-2-slice-a-fix1-biome.log | c624c7e12756f007408a50a674375aae670394be44aaf205db94c5b20c1a4775 |
| task-2-slice-a-fix1-green-cleanup.log | e48df1889d94d8628506ae3a0cbb9722db4db537b6826cc56a8f30e440d472e7 |
| task-2-slice-a-fix1-green-resource.log | 4bf2c3f89dfe62aded42587aa4dad04f701fe7973ba9b1241905293b3fee2cd7 |
| task-2-slice-a-fix1-green.log | 3c270ca7a7199f203793545503010159c42f47820a224df067bbb97be87506e4 |
| task-2-slice-a-fix1-red-cleanup.log | 90fe331574f7bfd1d18df6cc58f583562f1604c38689da1b8b45a24f304cabbd |
| task-2-slice-a-fix1-red-credential-lock.log | b395d16b32346616cc61072f077f8a285ad902c10dfadc3e2a6c5e3d886a7ab7 |
| task-2-slice-a-fix1-red-resource.log | 20d99831b3ef17da9b29e88b89a5a13aabed934150f60fc60d158b590ac29b64 |
| task-2-slice-a-fix1-red.log | 82e1720fff6db7323f3e496d140066cb82da86e26840d4c8a7b6dca40cee8244 |
| task-2-slice-a-fix1-turn-cleanup.log | 8b4af914496cd9ef1b4c5352c3749669ad7de8993dff7e3bb842deabde48643b |
| task-2-slice-a-fix1-turn-red.log | 918a2606b6b36d26fb4f50dcd44743cc1cbdceccb4becf0f47f6093127662d6c |
| task-2-slice-a-fix1-turn-resource.log | 9f958571785fd83eeee342207d70a52cf7d901a8ce52a1f755a6f7a17ff5c193 |
| task-2-slice-a-fix1-typecheck.log | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |

Status: **DONE_WITH_CONCERNS — FIX1 Slice A ready for independent review**. Full-server dependency/typecheck limitation và deferred T2 slices vẫn giữ nguyên; không có known A1/A2 failure trong 19 tests. Chờ PM independent review; chưa accepted/full T2 complete.
