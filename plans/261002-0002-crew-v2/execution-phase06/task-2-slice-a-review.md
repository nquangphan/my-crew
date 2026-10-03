# SPEC: ❌ Cần sửa — Phase06/T2 Slice A

**QUALITY: Needs fixes.** Hai finding trong phạm vi candidate ba file; không kết luận nghiệm thu full T2 hoặc production.

## Phạm vi và bằng chứng

- Base được brief chỉ định: `3c222c5`, T1 accepted source `feaea55`; không chạy lại Git để suy rộng phạm vi.
- Đọc đúng một lần package `task-2-slice-a-review-package.diff`: 24.615 byte, SHA256 `6fabd99574600f215511d7331493154dd409c2c893238cb96ce7c7d46c8b8736` khớp. Ba file mới, 546 dòng: `authority.ts` 125, `routes.ts` 70, `assistant-authority.test.ts` 351. Không đọc lại changed files; không có hunk bị cắt giữa hàm.
- `task-2-report.md` SHA256 `f49e00f194d8841cd7d9486b56b08c152fe8cb3c559fd5e856d7d73431daa44b` khớp. SHA256 cả ba candidate source/test, frozen contracts và SQL011 đều khớp report.
- Đã đọc official `.agents/skills/subagent-driven-development/task-reviewer-prompt.md`, root/v2 docs index và flow `server-assistant`, `server-identity`, `server-journal`. Không tìm thấy skill `scout`/`code-review` tại các thư mục skill local/global đã kiểm tra; dùng bounded edge-case scouting trực tiếp theo official task-reviewer protocol. Checkout không có `.codegraph/`.
- Chỉ review tĩnh; không chạy Node, build, DB, dependencies, browser hoặc subagent; không sửa source/index/manifest/plan/task state.

## Điểm đã kiểm chứng

- `routes.ts:50–64` sử dụng owner authenticator, journal thật và callback authorization trước cache; không nhận Actor từ HTTP body. `routes.ts:13–23` giới hạn body strict, `preferred:null` và frozen policy schema; validator test tắt coercion/default/removal.
- `authority.ts:47–65`, đối chiếu `journal/mutation.ts:30–41` và `assistant/store.ts:49–61`: journal khóa event cursor trước guard; config khóa guard → machines theo thứ tự → config → designation. Không phát hiện đảo khóa với T1 trong slice này; callback không khóa root/input muộn.
- `authority.ts:84–100`: đổi máy kiểm tất cả turn chưa `stopped` trước khi retire designation; partial unique index `011_assistant.sql:80` giới hạn live turn. Policy update cùng máy không tạo designation hoặc cập nhật turn. Metadata không tạo admission/grant/command/stop evidence.
- `authority.ts:111–124`: resolver kiểm scope/fence rồi luôn ném `ASSISTANT_ADMISSION_NOT_CONFIGURED`; không có nhánh biến fixture UNVERIFIED thành Actor. Scope expiry dùng `clock_timestamp()` sau fence locks.
- PM làm rõ `CAS/noop/replay` trong brief là replay không lặp hiệu ứng; không có mandate giữ nguyên config revision khi fresh-key PUT có nội dung không đổi. Không ghi revision churn thành missing-spec finding.

## Critical

Không tìm thấy defect Critical trong phạm vi đọc.

## Important — cần sửa trước khi nhận Slice A

### A1 — High / P1: session có thể bị thu hồi hoặc hết hạn trong lúc PUT chờ authority lock, nhưng request vẫn được ghi hoặc replay

**Vị trí:** `v2/server/src/assistant/routes.ts:57–61`.

Callback gọi `authenticateCurrentCredential` trước `authorizeAssistantConfigChange`. Hàm thứ hai có thể chờ guard hoặc machine row lock. Focused dependency check cho rủi ro TOCTOU xác nhận `auth/routes.ts:257–262` chỉ SELECT session, không giữ row lock; expiry dùng `Date` đã truyền vào. Logout tại `auth/routes.ts:146–148` gọi `auth/session.ts:120–123`, cập nhật session trực tiếp, không bị journal event-cursor lock chặn.

Interleaving cụ thể: transaction khác giữ calibration guard; PUT đã qua preflight và session recheck rồi chờ guard; owner logout hoàn tất và session đã revoked; transaction kia thả guard; PUT tiếp tục, journal trả cached response hoặc chạy mutation mới. Không còn credential check sau lần chờ. Trường hợp session hết hạn trong lúc chờ có cùng kết quả. Target machine được bảo vệ bằng row lock và kiểm tra sau chờ, còn owner credential chưa có bảo vệ tương ứng. Test hiện có chỉ revoke giữa preflight và transaction, nên không bắt được cửa sổ này.

**Sửa:** trong authorization của slice, khóa chính session credential đến hết transaction để serialize với revoke, và kiểm expiry bằng thời điểm hiện hành sau các authority lock có thể chờ; hoặc thiết kế lại thứ tự sao cho session bị revoke khi request đang chờ phải bị phát hiện trước cache/work. Không chỉ lặp lại cùng helper trước một lock khác. Không cần mở rộng generic ACL hoặc đổi frozen contracts.

**Regression cần thêm:** dùng hai connection, giữ guard/machine row; cho PUT đi qua credential check tới điểm chờ; revoke session rồi giải phóng blocker. Kiểm request bị từ chối hoặc revocation được serialize đúng theo session lock, tuyệt đối không nhận thành công với credential đã revoked tại điểm authorization cuối. Chạy cả fresh mutation và cached replay; thêm expiry crossing trong khoảng chờ. Kiểm config/designation/journal không có hiệu ứng mới khi bị từ chối.

### A2 — Medium / P2: UUID hợp lệ viết hoa bị báo không tồn tại; so sánh cùng máy cũng dùng dạng chưa chuẩn hóa

**Vị trí:** `v2/server/src/assistant/authority.ts:59`, cùng đường dữ liệu tại `authority.ts:84` và `routes.ts:20`.

HTTP schema nhận UUID và `assertAssistantId` cho phép hex không phân biệt hoa/thường (`assistant/store.ts:5–9`). PostgreSQL so khớp UUID khi truy vấn nhưng trả UUID chuẩn chữ thường. `machines.some(machine => machine.id === machineId ...)` lại so sánh chuỗi request nguyên bản. Vì vậy cùng một máy còn hiệu lực, UUID viết hoa qua validation và SQL lookup nhưng bị trả404. Nếu chỉ sửa predicate này, phép so sánh `current.designation.machineId !== input.machineId` còn lại sẽ nhận nhầm policy update cùng máy là reassignment: có turn sống thì409, idle thì retire/tạo designation không cần thiết.

**Sửa:** chuẩn hóa machineId một lần sau validation và dùng identity chuẩn nhất quán cho lock list, authorization và so sánh designation; hoặc dùng ID chuẩn từ hàng DB đã khóa xuyên suốt service. Giữ payload hashing/replay nhất quán, không thay frozen schema.

**Regression cần thêm:** PUT UUID viết hoa để designate thành công; tiếp theo policy update cùng UUID khác casing phải giữ designation ID/revision và turn đang admitted. Máy revoked vẫn bị từ chối dù casing nào.

## Minor / non-blocking

- `assistant-authority.test.ts:1–351`: 6 test hiện có chứng minh happy path, schema/auth denial, pre-transaction revoke, fence/default-deny, concurrent CAS và running-turn hold; chưa trực tiếp kiểm calibration-active và uncertain-turn hold. Source guard/state predicate xử lý chúng, nên đây là giới hạn coverage, không phải một blocker độc lập.

## Các focused dependency check từ scout

| Rủi ro cụ thể | Code đã đối chiếu | Kết quả |
|---|---|---|
| Replay trước current authorization / commit không atomic | `journal/mutation.ts:30–50` | Callback trước cache; throw rollback work và idempotency. A1 xảy ra bên trong callback trước lock wait, không phải lỗi thứ tự cache của journal. |
| Lock inversion với T1 và live authority | `assistant/store.ts:29–79`, `011_assistant.sql:33–37,65–80` | Guard chung và thứ tự machine/config/designation/turn tương thích; live hold bounded, không partial retirement. |
| Owner credential revocation/expiry trong lúc chờ | `auth/routes.ts:41–53,146–148,242–262`; `auth/session.ts:95–109,120–123` | A1. Helper là snapshot reader, không phải credential lock. |
| UUID HTTP/DB/caller contract khác nhau | `assistant/store.ts:5–9`, `011_assistant.sql:2–14` | A2; validator nhận UUID case-insensitive, service so chuỗi raw. |
| Frozen policy/output contract bị nới | `assistant/contracts.ts:536–555` | Route tái sử dụng schema; source hash khớp frozen. Không widening frozen DTO. |

## Verification và giới hạn

- Đã đọc raw final GREEN: 6/6 pass, fail0/skip0, 2031.87075ms; không chạy lại và không gọi là full suite. Các dòng scratch-root/nonce là fixture diagnostic, không phải compiler warning hoặc failure.
- Đã đọc full typecheck failure: own nullable error có trong log cũ; candidate SQL parameter hiện nullable và final scoped strict check không diagnostic. External extractor/dependency failures vẫn còn ở full-check evidence; scoped external `thread-stream` declaration failure được giữ riêng. `skipLibCheck` cuối theo PM ruling, không bỏ strict own source.
- Final Biome: `Checked 3 files in 26ms. No fixes applied.` Type coverage % và test coverage % không được đo; không suy từ 6/6.
- SHA256 toàn bộ chín raw logs khớp report. Cleanup log xác nhận bảy scratch root ABSENT; final test log ghi remove hai root của lượt cuối. Report có tuyên bố container/PID cleanup nhưng raw cleanup log này không chứa docker/ps witness; chỉ coi phần đó là reported evidence, không tự nâng thành kiểm chứng live.
- Checklist: concurrency có A1; error propagation qua Fastify/mutator, không catch-swallow mới; API contract có A2; không đổi exported producer signature/schema DB; external input qua strict route schema; owner+target authorization có A1; không N+1/unbounded DB call loop mới; response mới chỉ config metadata; plan/brief references được kiểm tra theo scope, không sửa TODO.
- Positive admission, G1/009, docs/run success, native/certifier/protocol và app mount được hoãn có chủ đích, default-deny; không phải missing requirement của Slice A. Desired-OFF không có producer mới trong diff; slice không tạo STOP hoặc sửa admitted turn, nhưng không chứng nhận end-to-end OFF behavior.

## Hành động và câu hỏi còn mở

1. Sửa A1 và A2 trong ownership được PM release; thêm regression tương ứng, rồi gửi một scoped fix package để review lại.
2. PM giữ full T2 ở trạng thái chưa hoàn tất; cập nhật flow/manifest theo docs draft khi tích hợp, reviewer không sửa plan hoặc trạng thái task.
3. Không còn câu hỏi scope cần owner trả lời. Bằng chứng cần bổ sung ở fix pass: concurrency regression A1, casing regression A2; nếu muốn xác nhận cleanup độc lập thì đính raw docker/ps witness đã lưu, không cần restart/rerun.
