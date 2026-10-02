# Registry nguồn và projection workflow bất biến

## Mục đích

Giữ BMAD và Superpowers cạnh nhau trong registry riêng của host, kiểm chứng byte tải, provenance và cây chuẩn hóa trước publish. Nguồn và projection cho Claude/Codex/API có khóa riêng; cập nhật một slot không sửa thư mục của run cũ. Đây là nền tảng local Task 4, chưa gắn HTTP desired/applied, boot, dispatch hoặc chứng nhận cách ly runtime vào host.

## Điểm vào

- `gateway/src/workflows/registry.ts` → `WorkflowRegistry.open`, `installSource`, `deriveProjection`, `resolve`, `retain`, `release`.
- `gateway/src/workflows/fetch.ts` → `fetchSource` chỉ tải URL HTTPS của release ghim, kiểm từng redirect.
- `gateway/src/workflows/audit.ts` → `buildSourceAudit`, `auditSuperpowersClaude` sinh candidate để PM/server duyệt; không tự cấp quyền chạy.

## Các bước

1. `pins.ts` → `validateSourcePin`, `validateProjectionPin`, `officialSourceUrl`: nhận DTO đúng key, hash lowercase SHA-256, release BMAD `6.12.0`/revision `05bfbd46d00766ec88eb9b42e76be2c575d64d7b` hoặc Superpowers `6.4.2`/revision `8ca22dba9a94f28898bbce59f2537ff4d87c747d`. URL chỉ GitHub/codeload đúng repository và revision/tag, hoặc npm tarball BMAD đúng version. Không query, credential, port tùy ý hay floating latest.
2. `fetch.ts` → `fetchSource`, `suppliedArchive`: giới hạn archive 32 MiB, download 30 giây và ba redirect; SHA-256 exact payload trước extract, npm thêm SHA-512 SRI. Registry caller phải truyền audit đã duyệt; URL allowlist không tự là chứng minh provenance của một stream tùy ý.
3. `stage.ts` → `parseArchive`, `validateFiles`, `writeTree`, `scanTree`: parser tar-stream `3.1.7` đọc gzip/ustar/PAX; chỉ file/directory/symlink, bỏ một prefix archive. Chặn traversal, separator sai, Unicode NFC/case collision, hardlink/special file, setuid và executable ngoài manifest audit. Cây tối đa 128 MiB, 20.000 entries, dòng gzip giải nén có bound riêng. Chỉ ghi link sau file/directory; realpath phải ở trong staging, dangling/cycle/escape bị từ chối. Mode directory `0755`, file `0644` hoặc `0755` theo manifest; symlink mode null. Không lấy executable bit tùy ý làm quyền thực thi.
4. `stage.ts` → `manifest`, `manifestHash`; `pins.ts` → `sourceTreeHash`, `projectionTreeHash`: sort entry theo byte UTF-8 của path slash/NFC; JSON canonical sort key. Entry gồm path/type/mode/bytes/sha256 và target của symlink. Mtime, UID/GID, xattr, archive order không thuộc hash; generated pin/manifest/payload nằm ngoài cây. Source tree hash gồm sourceManifestSha256/sourceRevision/packageIntegrity/payloadSha256. Projection tree hash gồm sourceTreeSha256/runtime/manifestSha256 và năm trường derivation. Do payload thuộc source tree hash, archive khác byte dù cùng manifest vẫn tạo source tree hash khác.
5. `registry.ts` → `installSource`, `publish`: một writer OS lock và transaction queue qua `AtomicRecords`, journal intent trước staging directory. File/directory fsync rồi rename vào khóa source `(name,sourceTreeSha256)`; kiểm lại nếu tồn tại, không ghi đè cây đã publish. Current source pointer chỉ đổi sau publish. Hủy hoặc extract lỗi giữ current cũ và stage có lỗi; không dùng mtime/timeout làm ownership proof. Writer cạnh tranh khác process bị lock từ chối để retry; duplicate request trong cùng writer tạo một cây.
6. `registry.ts` → `deriveProjection`, `project`: chỉ recipe có trong `RegistryOptions.projections` đã duyệt, khớp exact source/runtime/officialEntrypoints và pin projection dự kiến. Mapping chỉ copy skill/script gốc; API có file adapter-policy đúng policy hash, không sinh prompt PM/dev/QC của Crew. Derivation chạy hai lần trên cùng source và so hash, rồi scan staging trước publish. Đây là phép biến đổi byte thuần, không spawn installer hoặc runtime.
7. `registry.ts` → `resolve`: kiểm full SourcePin/ProjectionPin, payload/SRI và cả manifest/tree hash mỗi lần; trả sourceRoot, projectionRoot và manifest tái tính. `retain`/`release` ghi ref bền vững theo run + pair. `retained` đọc lại ref registry và mọi pair trong `ProcessJournal.processes`, kể cả unknown/reserved; một release registry không xóa reference producer.
8. `registry.ts` → `stagingInventory`: báo ID/kind/state, identity root, payloadBytes, bytes đã tính hoặc null, reason và deletionEligible=false. Stage failed/interrupted và mọi cây publish được giữ; không có GC/xóa đệ quy. Chỉ phase09 operation authority có chứng minh dừng và no-follow deletion mới được dọn. Generic ResourceRegistry không được sửa hay nhận fake process stopped để xóa cây chứa symlink hợp lệ.

## Files

| Đường dẫn | Vai trò |
|---|---|
| `gateway/src/workflows/pins.ts` | Frozen DTO, URL/release allowlist và công thức hash |
| `gateway/src/workflows/fetch.ts` | Download có giới hạn, payload/SRI verification |
| `gateway/src/workflows/stage.ts` | Tar header validation, cây canonical, symlink và fsync |
| `gateway/src/workflows/registry.ts` | Publish, resolve, runtime projection, journal reference/stage |
| `gateway/src/workflows/audit.ts` | Candidate từ archive ghim và layout Superpowers Claude thực tế |
| `gateway/test/workflow-registry.test.ts` | Matrix synthetic, negative supply chain, retention và archive chính thức |
| `gateway/test/support/workflow-archives.ts` | Archive/pin synthetic độc lập, không phải recipe chính thức BMAD Codex |
| `gateway/test/fixtures/workflows/bmad-6.12.0.tgz` | Byte npm package ghim dùng offline test |
| `gateway/test/fixtures/workflows/superpowers-6.4.2.tgz` | Byte Git source commit ghim dùng offline test |
| `gateway/test/fixtures/workflows/official-audits.json` | Golden pin/executable manifest/candidate projection |

## Dữ liệu

BMAD npm payload SHA-256 `ac05c93f0b3c4256bb4072e6e1ff181eaad6cc0a64a27a63893bfb2b0b64aed2`; SRI `sha512-gbbHo32TxCPwo4Yy70kqykFRwN5UdYqfnDKTsKAsF9m5qtLeoiCgEawj/LuzLBHLrYA0WTOyL/XWtXpgyDonMQ==`. Registry metadata `gitHead` khớp revision, nhưng npm payload và Git archive vẫn là provenance riêng, không khẳng định byte tương đương. [Metadata npm đúng version](https://registry.npmjs.org/bmad-method/6.12.0), [BMAD release](https://github.com/bmad-code-org/BMAD-METHOD/releases/tag/v6.12.0).

Superpowers source payload SHA-256 `29714b2c4c727ecc6600f9e5982a0dcbb829860ba79626f1941a0f233e85331a`. Candidate Claude giữ nguyên `.claude-plugin/plugin.json`, `skills/`, `hooks/`; source này không có `lib/`. Plugin version, bootstrap skill và script/hook giữ byte gốc. [Claude manifest](https://github.com/obra/superpowers/blob/v6.4.2/.claude-plugin/plugin.json), [hooks](https://github.com/obra/superpowers/blob/v6.4.2/hooks/hooks.json).

Candidate Superpowers Codex/API và cả ba BMAD projection hiện null. BMAD Claude recipe chính thức là `bmad-method@6.12.0 install --yes --modules bmm --tools claude-code`; cần môi trường dependency/renderer và `uv` được audit, không thể coi source-copy là installer tương đương. [BMAD hướng dẫn cài](https://github.com/bmad-code-org/BMAD-METHOD/blob/v6.12.0/docs/start/install-bmad.md). Superpowers README tại tag chỉ hướng dẫn Codex marketplace; `.codex/INSTALL.md` không tồn tại và release không có asset package. [Builder Codex chính thức](https://github.com/obra/superpowers/blob/v6.4.2/scripts/package-codex-plugin.sh) cần metadata `skills/*/agents/openai.yaml` từ package chính thức trước, không nằm trong Git source này. Registry không tự sinh metadata hoặc giả một recipe native. [README runtime](https://github.com/obra/superpowers/blob/v6.4.2/README.md).

RegistryOptions là input của application đã audit, không route/config authorizer. Source/projection candidate chưa được server preapprove hoặc runtime certification. Không secret, credential owner, dịch vụ hay model call trong unit này.

## Flow liên quan

`gateway-host` cung cấp journal/OS writer lock và ProcessJournal; `domain-foundation` giữ `Pin` cũ qua `toDomainPin`. Task3/server duyệt desired hash và applied; Task5 gắn sync/install report; Task6 kiểm nguồn và preflight; Phase04 kiểm runtime/tool loop; Phase09 cấp authority dọn operation và signed helper. Stage retention không sửa contract stopped/UNKNOWN của producer Task2.

## Tests

`pnpm --dir v2/gateway exec node --test --test-name-pattern='workflow registry' test/workflow-registry.test.ts` kiểm archive chính thức offline, source/projection concurrency, Claude/Codex từ cùng synthetic source, synthetic API policy, old pair qua source/projection update/restart, ProcessJournal recovered refs, hash/mode/path/Unicode/SRI/redirect/size failure, internal symlink và cancellation/truncated extract rollback. Synthetic matrix không chứng nhận recipe BMAD Codex/API hay runtime thật. Python tarfile/json/hashlib đã kiểm độc lập golden source manifest cho cả hai archive; evidence nằm trong task report.
