# Khảo sát cổng macOS và runtime Crew v2 — phần 03/04

Ngày kiểm tra: 2026-10-02, Asia/Ho_Chi_Minh. Phạm vi: spec `docs/superpowers/specs/2026-10-01-crew-v2-design.md` đã đọc toàn bộ và roadmap `plans/261002-0002-crew-v2/plan.md`. Không sửa code v1/v2, không cài/cập nhật công cụ toàn máy, không gọi model có phí. Nguồn là tài liệu và repository chính thức, cộng kiểm tra CLI cài tại máy.

## Kết luận để lập kế hoạch

Có đường triển khai native trên macOS: host riêng giữ job và journal, mỗi attempt có home/config/workspace do Crew sở hữu; chỉ đưa bộ workflow được ghim vào nguồn discovery; kiểm tra nguồn thật của skill/script tại điểm nạp; giới hạn Read/Bash/subagent bằng policy và sandbox hệ điều hành. Hai bộ tồn tại trong registry trên máy, nhưng một process thực thi chỉ có một bộ được chọn. Phiên Trợ lý định tuyến dùng namespace cấu hình riêng.

**Chưa thể nghiệm thu cách ly runtime đầy đủ.** Spike không gọi model đã chứng minh Codex inventory sạch khi đổi home/config và checkout sạch; đồng thời chứng minh `codex sandbox` chặn đọc một nguồn canary ngoài workspace mà vẫn đọc được nguồn cho phép. Chưa chứng minh toàn bộ discovery, native Read, lời gọi skill, child agent, MCP, symlink, shell escape và script của workflow cùng bị chặn trong attempt thật. Claude mới được xác minh tài liệu và CLI help, chưa chạy init/skill execution. Các mục đó phải là gate của phần 03, không được ghi thành đã hoàn thành.

## 1. Phiên bản và nguồn ghim

| Thành phần | Kết quả xác minh ngày 2026-10-02 | Nguồn |
|---|---|---|
| BMAD METHOD | Stable latest `v6.12.0`, phát hành `2026-09-04T02:31:25Z`, tag resolve tới `05bfbd46d00766ec88eb9b42e76be2c575d64d7b` | [release chính thức](https://github.com/bmad-code-org/BMAD-METHOD/releases/tag/v6.12.0), [GitHub API release](https://api.github.com/repos/bmad-code-org/BMAD-METHOD/releases/latest) |
| Superpowers | Stable latest `v6.4.2`, phát hành `2026-09-25T18:08:09Z`, tag resolve tới `8ca22dba9a94f28898bbce59f2537ff4d87c747d` | [release chính thức](https://github.com/obra/superpowers/releases/tag/v6.4.2), [GitHub API release](https://api.github.com/repos/obra/superpowers/releases/latest) |
| Claude Code local | `/Users/phannhatquang/.local/bin/claude`, `2.1.284 (Claude Code)` | Đã chạy `claude --version`, `claude --help` |
| Codex CLI local | `/Users/phannhatquang/.local/bin/codex`, `codex-cli 0.159.3` | Đã chạy `codex --version`, `codex exec --help`, `codex app-server --help`, `codex sandbox --help` |
| Máy khảo sát | Darwin, macOS `26.5.2`; có `uv` và `/usr/bin/sandbox-exec` | `uname -s`, `sw_vers -productVersion`, `command -v` |

Đây là baseline đề xuất cho spike, chưa là quyết định release sản phẩm. Tag và npm version chưa thay cho checksum payload. Registry lưu cả version, full revision, hash gói tải và hash manifest cây đã cài. Cài vào staging, xác minh rồi publish bằng rename; không update đè thư mục đang được run tham chiếu.

BMAD npm `6.12.0` được kiểm tra qua [registry version](https://registry.npmjs.org/bmad-method/6.12.0): Node `>=20.12.0`; tarball `bmad-method-6.12.0.tgz`, integrity `sha512-gbbHo32TxCPwo4Yy70kqykFRwN5UdYqfnDKTsKAsF9m5qtLeoiCgEawj/LuzLBHLrYA0WTOyL/XWtXpgyDonMQ==`. Crew vẫn tính SHA-256 payload tải thực tế. Chưa tải/cài tarball nên chưa có SHA-256 gói trong khảo sát này.

Theo [hướng dẫn cài BMAD tại tag](https://github.com/bmad-code-org/BMAD-METHOD/blob/v6.12.0/docs/start/install-bmad.md), installer tạo skill trong thư mục runtime và `_bmad` chứa cấu hình/script; cài headless có `--yes --modules bmm --tools claude-code`. Cách ghim core/BMM là ghim npm package, ví dụ `npx --yes bmad-method@6.12.0 install ...`, không dùng `@latest`/`@next` lúc thực thi. Chạy installer trong workspace staging riêng, không target checkout owner. `uv` cần cho các workflow render/run Python; installer hoàn thành dù thiếu `uv` không có nghĩa build chạy được.

Superpowers tag có [manifest Claude](https://github.com/obra/superpowers/blob/v6.4.2/.claude-plugin/plugin.json) và [manifest Codex](https://github.com/obra/superpowers/blob/v6.4.2/.codex-plugin/plugin.json). [README tag](https://github.com/obra/superpowers/blob/v6.4.2/README.md) hướng dẫn marketplace theo runtime; Codex hiện dùng official plugin marketplace. Đề xuất Crew lấy bundle từ revision cố định và cài vào namespace riêng; không nhờ global marketplace tự update khi run đang chạy. Cơ chế tải gói Codex riêng cần spike manifest/packaging, không giả định layout Claude và Codex giống nhau.

## 2. BMAD thực tế không là một chuỗi story cố định

Danh mục `src/bmm-skills` tại `v6.12.0` có nhóm plan (`bmad-product-brief`, `bmad-prd`, `bmad-spec`, `bmad-architecture`, `bmad-create-epics-and-stories`, `bmad-sprint-planning`, UX/context) và ship (`bmad-build`, `bmad-build-auto`, `bmad-code-review`, `bmad-qa-generate-e2e-tests`, `bmad-correct-course`, retrospective/walkthrough). Các tên cũ `bmad-create-story`, `bmad-dev-story`, `bmad-quick-dev` nằm trong `v6-shims`; fresh install không mặc định bật shims theo release notes. Không map mặc định vào các tên cũ.

| Đường hỗ trợ đầu tiên đề xuất | Artifact/cổng thực tế cần giữ |
|---|---|
| `bmad-spec` | Folder `spec-{slug}` có `SPEC.md`, companion, `.memlog.md` canonical append-only; có thể có `stories.yaml`; headless thiếu intent/slug trả lỗi. Không sửa `SPEC.md` bên ngoài single writer |
| `bmad-build` | SKILL chạy đúng một lần `uv run --no-cache .../_bmad/scripts/render_skill.py --project-root ... --skill ...`; đọc đường `workflow.md` snapshot được in ra. Render lỗi thì HALT, không chạy source trực tiếp |
| Build nhiều bước | Source có clarify/route → plan → implement → review → present và đường oneshot; bước/cổng thực thi lấy từ snapshot đã render. Không ép mọi change qua đầy đủ một chuỗi cố định |
| `bmad-code-review` | Đọc bước context rồi các step; giữ checkpoint người dùng và findings. Không lấy lời agent nói PASS làm bằng chứng code/test đạt |
| `bmad-sprint-planning` | Readiness gate `PASS/CONCERNS/FAIL`, `sprint-status.yaml`; headless ambiguity phải blocked |

Nguồn: [spec skill](https://github.com/bmad-code-org/BMAD-METHOD/blob/v6.12.0/src/bmm-skills/plan/bmad-spec/SKILL.md), [build entrypoint](https://github.com/bmad-code-org/BMAD-METHOD/blob/v6.12.0/src/bmm-skills/ship/bmad-build/SKILL.md), [build workflow](https://github.com/bmad-code-org/BMAD-METHOD/blob/v6.12.0/src/bmm-skills/ship/bmad-build/workflow.md), [customize build](https://github.com/bmad-code-org/BMAD-METHOD/blob/v6.12.0/src/bmm-skills/ship/bmad-build/customize.toml), [review skill](https://github.com/bmad-code-org/BMAD-METHOD/blob/v6.12.0/src/bmm-skills/ship/bmad-code-review/SKILL.md), [sprint planning](https://github.com/bmad-code-org/BMAD-METHOD/blob/v6.12.0/src/bmm-skills/plan/bmad-sprint-planning/SKILL.md).

BMAD customization có khả năng thay instruction, persistent facts, activation commands và review layers. Do đó ghim release thôi chưa đủ: run còn ghim resolved customization hash, generated workflow snapshot/hash và config đầu vào. Không vô tình lấy `_bmad/custom/*.user.toml` hoặc scripts từ owner checkout khi isolation định dùng bundle chuẩn. Review layer của BMAD có hướng dẫn riêng; giữ prompt đi kèm release thay vì viết prompt role Crew mới.

Superpowers giữ phân loại spike/bounded/architectural, approval của từng stage, written spec và plan cho nhánh architectural; TDD trong implement, review và finishing sau verify. Nguồn [brainstorming](https://github.com/obra/superpowers/blob/v6.4.2/skills/brainstorming/SKILL.md) và [writing-plans](https://github.com/obra/superpowers/blob/v6.4.2/skills/writing-plans/SKILL.md). Crew biểu diễn những cổng này bằng quyết định bền vững; không coi yêu cầu feature ban đầu là phê duyệt artifact chưa tồn tại.

## 3. Controls runtime và giới hạn

### Claude Code

Đã thấy trong local help: `--setting-sources`, `--settings`, `--plugin-dir` theo session, `--strict-mcp-config`, `--input-format stream-json`, `--output-format stream-json`, `--session-id`, `--resume`, `--disable-slash-commands`, `--safe-mode`, `--bare`.

- `CLAUDE_CONFIG_DIR` chuyển settings/history/plugins; tạo đường Crew sở hữu theo attempt. `--setting-sources ''` là ứng viên để bỏ user/project/local settings, cộng chỉ định bundle bằng `--plugin-dir`. Phải spike việc parser chấp nhận chuỗi rỗng và discovery đúng bản local. [Settings](https://code.claude.com/docs/en/settings), [CLI](https://code.claude.com/docs/en/cli-reference).
- Help local nói rõ `--bare` vẫn resolve skills; không dùng nó như bằng chứng đã chặn skill. `--safe-mode` tắt customization, cần xác minh có cho bộ được Crew nạp hoạt động; không chọn làm đường chuẩn khi chưa thử.
- SDK hiện có `settingSources`, plugin local và exact `skills` allowlist. **Allowlist không chặn file Read/Bash; slash dispatch `/name` còn bỏ qua allowlist.** `init.skills` không liệt kê skill `user-invocable: false` và không phản ánh việc lọc allowlist. Dùng nó chỉ như một nguồn audit phụ, thêm source manifest/tool interception và chặn command dispatch ngoài namespace. [SDK skills](https://code.claude.com/docs/en/agent-sdk/skills), [SDK plugins](https://code.claude.com/docs/en/agent-sdk/plugins).
- Dùng sandbox `enabled: true`, `failIfUnavailable: true`, `allowUnsandboxedCommands: false`, `filesystem.denyRead` cho các nguồn không chọn; permission Read deny/hook kiểm tra canonical path cho native tools. Sandbox Bash bảo vệ subprocess, không tự là chứng minh discovery/native Read đều bị chặn. [Sandbox](https://code.claude.com/docs/en/sandboxing).

### Codex

Đã thấy local: `exec --json`, `--image`, `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, `--profile`, `--strict-config`, `app-server --listen stdio://`, `sandbox -P`.

- `CODEX_HOME` riêng chứa auth/config/state. **Đổi CODEX_HOME đơn lẻ không thay `$HOME/.agents/skills`, repo `.agents/skills`, admin `/etc/codex/skills` hoặc system skills.** Codex theo symlink khi discover. [Skill discovery](https://developers.openai.com/codex/skills).
- `--ignore-user-config` không có nghĩa bỏ project configuration/skills. `--ignore-rules` không là kiểm soát skill. Sandbox mặc định workspace-write chủ yếu giới hạn writes, phải thêm deny-read. [Security](https://developers.openai.com/codex/security).
- `skills.config` disable theo path, plugin enablement theo identity; có thể làm config trong home attempt. Ghim process riêng cho attempt và preflight `skills/list`, `hooks/list`, plugin/config effective. Không gọi `skills/config/write` vào home owner. [Config reference](https://developers.openai.com/codex/config-reference).
- Permission profile có `read/write/deny`, `:minimal`, `:workspace_roots`; đường cụ thể hơn thắng. Chặn user/plugin/workflow nguồn ngoài, cho project scratch và runtime tools. Đã thử thành công deny-read qua `codex sandbox`; chưa thử policy với toàn app-server. [Permissions](https://developers.openai.com/codex/permissions).
- Managed requirements hữu ích để cấm nâng quyền/MCP trái policy ở tổ chức nhưng là cấu hình admin của máy, không có bằng chứng là cơ chế per-run skill allowlist. Không sửa `/etc` hoặc profile MDM như phần cài Crew. [Managed configuration](https://developers.openai.com/codex/enterprise/managed-configuration).

## 4. Phương án cách ly đủ thực tế để spike

1. Tạo execution clone/workspace độc lập dưới Crew, cùng commit checkout owner, chứa code/docs nghiệp vụ. Không tự sửa/xóa thư mục workflow ở checkout owner. Workspace discovery sạch: không nhập `.agents`, `.claude`, `.codex` tùy tiện, không nhập `_bmad` cá nhân; chuẩn project instruction giữ lại sau audit source workflow. Khi thư mục đó có source sản phẩm cần thiết, tạo inventory/phân loại và policy path cụ thể; không exclude cả cây mù quáng.
2. Một namespace attempt gồm `home`, `claude-config`, `codex-home`, `workspace`, `tmp`, `logs`, `workflow-snapshot`. Set home/config **trên environment của process con**, không đổi shell/home/global config hiện tại. Không symlink config owner nguyên cây. Worktree có `.git` trỏ common-dir owner cần grant thêm và serialize Git index; execution clone độc lập dễ giữ ranh giới hơn ở spike đầu.
3. Registry chứa cả BMAD và Superpowers cạnh nhau, nhưng execution process chỉ được đọc bundle chọn, common tool library và scripts renderer của bundle đó. Canonicalize `realpath`; kiểm hash manifest trước nạp; ghi `sourcePath/workflow/version/revision/hash`. Phải chặn đọc đường absolute bộ kia, symlink sang bộ kia, và gọi binary agent ngoài supervisor. Skill name allowlist dùng bổ sung, không là ranh giới nguồn.
4. Home riêng là isolation cấu hình, **không phải OS boundary**: cùng UID vẫn đọc real home qua absolute path hoặc getpwuid. Dùng policy deny-read tại runtime và filesystem sandbox subprocess; không cho bypass sandbox. Nếu không chặn được native discovery/Read của harness, cần helper supervisor áp policy cho toàn cây process hoặc môi trường VM. Không tuyên bố sandbox Bash là sandbox toàn runtime.
5. Native macOS không có Linux namespace/container tương đương chỉ bằng đổi env. Docker Desktop chạy VM và làm đổi môi trường tool macOS; hợp với workload Linux nhưng không tự đáp ứng build iOS/macOS. Dedicated OS user có ranh giới UNIX permissions nhưng cần onboarding/admin và shared project ACL, không phải một flag per-run. Chọn phương án tối thiểu ở 1–4 trước; VM/user riêng là fallback sau spike thất bại, không thay requirement native một cách âm thầm.
6. Credential chỉ là reference tới broker/Keychain/credential runtime riêng. Không copy nguyên home đăng nhập, không in key/token vào argv/log hoặc discovery evidence. Home mới có thể làm subscription auth không còn được tìm thấy; coi đây là blocker onboarding cần spike credential injection hợp lệ từng runtime. Runtime parent có credential không đồng nghĩa Bash/child được nhận credential đó.
7. Child agent chỉ do adapter/supervisor dispatch, kế thừa immutable isolation context. Hook/tool request chặn đọc/skill chéo trước thực thi; phát hiện sau khi source đã nạp chỉ là incident, không đủ nghiệm thu. Cho phép script chính thức BMAD và tools build/test trong source policy thay vì cấm mọi shell khiến workflow không thể chạy.

## 5. Bằng chứng đã chạy, không tiêu thụ model

| Kiểm tra | Kết quả | Giới hạn |
|---|---|---|
| CLI versions/help | Claude `2.1.284`, Codex `0.159.3`; flags trên tồn tại | Không chứng minh semantics khi chạy agent |
| Codex app-server init + `skills/list` | Temp home/config + repo mới chỉ thấy `crew-isolation-canary` scope repo và 5 system skills (`imagegen`, `openai-docs`, `review-agent`, `skill-creator`, `skill-installer`); `errors: []` | Không có workflow bundle thật, chưa chạy skill/model/child; system skills vẫn có, phải phân loại common hoặc disable |
| `codex sandbox -P crew-research` đọc canary bị deny | Exit 1, `Operation not permitted`; marker nguồn cấm không xuất hiện | Chỉ một command OS sandbox, chưa toàn adapter |
| Cùng profile đọc selected canary workspace | Exit 0, đọc được canary chọn | Chưa test build tools, symlink, clone Git |

Scratch khảo sát: `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-isolation-research-bmn2j0qy`. Không dùng credential và không gửi `turn/start`; số model calls = 0. Process app-server đã terminate. Scratch chỉ chứa fixture/config/system skill tự sinh, không artifact owner; đã dọn đúng thư mục này sau khi xác nhận process khảo sát đã terminate. Bảng kết quả và lệnh tái lập được giữ trong báo cáo.

Cách tái lập inventory bằng Python/subprocess (đường scratch/binary do host cung cấp, không sửa global):

```python
env = dict(os.environ)
env["HOME"] = str(attempt_home)
env["CODEX_HOME"] = str(attempt_codex_home)
process = subprocess.Popen(
    [codex_binary, "app-server", "--listen", "stdio://"],
    cwd=clean_workspace, env=env,
    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
)
# Gửi từng JSON line; đọc response đúng id trước bước sau:
# {"id":1,"method":"initialize","params":{"clientInfo":{"name":"crew_v2_spike","version":"0.0.0"}}}
# {"method":"initialized","params":{}}
# {"id":2,"method":"skills/list","params":{"cwds":["<clean_workspace>"],"forceReload":true}}
# Không gửi turn/start trong spike inventory miễn phí.
```

Profile dùng trong phép thử OS đã chạy, đường thay bằng fixture thật:

```toml
default_permissions = "crew-research"
[permissions.crew-research.filesystem]
":minimal" = "read"
"/absolute/fixture/workspace" = "write"
"/absolute/fixture/forbidden" = "deny"
[permissions.crew-research.network]
enabled = false
```

Lệnh test nằm trong env process riêng:

```sh
codex sandbox -P crew-research -C /absolute/fixture/workspace /bin/cat /absolute/fixture/forbidden/canary.txt
codex sandbox -P crew-research -C /absolute/fixture/workspace /bin/cat /absolute/fixture/workspace/.agents/skills/crew-isolation-canary/SKILL.md
```

### Ma trận nghiệm thu cách ly còn phải chạy

| Case | Kỳ vọng cứng | Trạng thái |
|---|---|---|
| BMAD/Superpowers × Claude/Codex | Inventory có đúng bộ/version; bộ còn lại không nạp | Codex fixture sạch đã thử; cả bốn kết hợp thật chưa thử |
| User/project/local plugin/skills canary, nested cwd, admin/system | Nguồn không phép không có trong effective catalog hoặc đã disable; unknown source fail closed | Chưa thử đầy đủ |
| Read/Bash absolute path, symlink, subprocess khác, curl tải bộ kia | Nguồn bị deny trước load; network/tool policy không cho tự đưa nguồn mới vào run | Chưa thử |
| Child và reviewer/fix agent | Cùng pin + source policy, không gọi chéo | Chưa thử |
| BMAD render/script + Superpowers hook/bootstrap | Workflow chọn chạy được, script/helper chính thức được grant có hash | Chưa thử |
| Resume/reconnect/update giữa run | Không thay pin/source và không tạo process/attempt trùng | Chưa thử |
| Credential subscription/API trong home riêng | Auth được, child tools không đọc key, log không chứa secret | Chưa thử; không trích xuất credential trong khảo sát |

Lệnh Claude spike có phí sau này: process env riêng, cwd sạch, `claude -p --setting-sources '' --settings <owned-settings.json> --plugin-dir <pinned-selected-bundle> --strict-mcp-config --mcp-config <owned-mcp.json> --input-format stream-json --output-format stream-json --verbose`. Pin nội dung settings và intercept tools; xác nhận init/source và skill execution. Không thêm `--bare` tự động vì auth/keychain và hook semantics khác. Đây là command candidate cần thử, chưa được xác nhận chạy thành công.

## 6. Checkpoint, cancel và reconcile

Claude CLI cung cấp session UUID/resume; SDK persist session và `resume`/fork. Session là conversation, không filesystem. File checkpoint SDK chỉ bao phủ Write/Edit/NotebookEdit, thiếu Bash và phần lớn subagent writes; dùng commit/diff/artifact registry Crew làm checkpoint chuẩn liên runtime. Nguồn [sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [file checkpointing](https://code.claude.com/docs/en/agent-sdk/file-checkpointing).

Codex app-server có init handshake, `thread/start/resume`, `turn/start/steer/interrupt`, event `turn/completed` với `interrupted`; cũng có background terminal/process controls. Ưu tiên stdio process riêng, không port WS công khai. `exec --json` phù hợp spike một lượt; app-server phù hợp điều khiển multi-turn/cancel và kiểm inventory. Binding phải được generate/pin từ binary vì app-server CLI vẫn ghi experimental. Nguồn [app-server](https://developers.openai.com/codex/app-server).

Contract tối thiểu chung: `inventory`, `prepareIsolation`, `start`, `sendInput`, `checkpoint`, `cancel`, `reconcile`. Result `cancel requested` khác `process stopped`; cần xác nhận exit/process tree/active tools rồi mới đánh dấu paused/cancelled và cleanup. Reconnect kiểm PID kèm start-time/process identity, runtime session, attempt lease fencing, event cursor, Git HEAD/diff và artifacts. Mất heartbeat trả `unknown`, không trả `dead`. Runtime session ID có `runtime` namespace; fallback bắt đầu session mới với checkpoint Crew, không dùng session ID runtime trước.

## 7. Multimodal và API tương thích

Codex `exec --image` tồn tại local; app-server có input image/localImage và model inventory `inputModalities` theo tài liệu. Claude runtime có stream input/API message path nhưng cần fixture ảnh thật qua SDK để xác minh adapter chọn. Không suy ra PDF/DOCX/XLSX đọc native từ việc model nhìn được ảnh. Phase 05 dùng extractor/OCR chung có trang/sheet/vùng ảnh và attachment ID, giữ original qua resume/fallback.

OpenAI-compatible API cần khai báo rõ protocol (`responses` hoặc `chat-completions`) và probe endpoint/model: text, tool schema/result correlation, streaming, vision nếu yêu cầu, cancellation và lỗi/quota. Agent loop thực thi tool qua cùng source/sandbox policy, ghi kết quả tool trước vòng model kế tiếp, giới hạn budget và vòng; không giả định một completion tạo ra workflow. Chuẩn OpenAI là nguồn để xây adapter, không bằng chứng mọi provider tương thích: [function calling](https://developers.openai.com/api/docs/guides/function-calling), [vision](https://developers.openai.com/api/docs/guides/images-vision). Chưa gọi endpoint thật trong khảo sát.

## 8. Cổng macOS và hợp đồng nhỏ nhất

Đề xuất phần 03: app shell mới và Node host độc lập v1; shell đóng cửa sổ thì giữ main/tray sống, host giữ journal/process children/heartbeat độc lập với LLM. Electron có sự kiện `window-all-closed` để điều khiển hành vi và utility process cho Node; utility process phụ thuộc app lifecycle, không tự đáp ứng tiếp tục sau app quit. Nếu cần sống sau quit/login, dùng LaunchAgent/helper qua ServiceManagement; phase 09 ký/update/drain cần thiết kế thêm. Nguồn [Electron app](https://www.electronjs.org/docs/latest/api/app), [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process), [Apple SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice). Stack này là đề xuất, không tái sử dụng runtime v1.

Các record tối thiểu để kế hoạch phần 03/04 kiểm chứng được:

- `WorkflowInstallation`: workflow/version/revision, payloadChecksum, installedTreeChecksum, status, root, installedAt, installerVersion; desired riêng installed.
- `RunIsolation`: immutable pin, resolvedConfigHash, workflowSnapshotHash, workspace/home/config roots, canonical source allowlist, common tools, denied roots, runtimeBinaryVersion, policyHash.
- `AttemptProcess`: attemptId, fencingToken, runtime/session/thread/turn, PID/start-time/process group, journal sequence, cancellation acknowledgement; một active execution lease.
- `Checkpoint`: workflow step/gate/decision IDs, commit/diff/artifact checksum và attachment refs; runtime session chỉ là gợi ý khôi phục, không nguồn sự thật.
- `MachineInventory`: observed runtime availability/capabilities, desired/applied source switches/revision; telemetry timestamp/load/memory pressure/disk/jobs trước mỗi dispatch.
- `ResourceRegistry`: path/PID và owner attempt, loại/purpose, references/retention, trạng thái cleanup; chỉ xóa sau process stopped, không git clean thư mục chung.

Command protocol phân biệt received/applied/completed, có commandId/idempotencyKey/configRevision/fencingToken. Cài workflow và reconnect đều có journal trước side effect. Phần 03 có thể nghiệm thu transport/host/registry bằng fake runtime miễn phí, nhưng phải giữ trạng thái runtime isolation chưa đạt cho đến matrix thật. Phần 04 làm tool-loop và capabilities/fallback; chỉ nghiệm thu trên checkout fixture, không trên dự án owner đang có job.

## 9. Blocker phải đi vào kế hoạch

1. Chưa có bằng chứng bốn kết hợp workflow/runtime chạy thật với deny source, child agent và script hợp lệ. Không được chỉ thêm prompt “không gọi bộ kia”.
2. Config-home isolation làm thay auth discovery; cần supported authentication path riêng, không sao chép bí mật hoặc home owner toàn cây.
3. Workspace sanitize phải bảo toàn code/docs và instruction project; repo có workflow source lẫn source sản phẩm cần phân loại, không chỉ exclude tên thư mục.
4. Native filesystem tool/discovery có thể chạy ngoài sandbox Bash; cần tool interceptor hoặc process-wide confinement, fail closed nếu chưa bảo đảm.
5. API provider capabilities chưa probe; không mặc định vision/tool calling/resume chỉ vì nhãn OpenAI-compatible.
6. BMAD v6.12 renderer/customization snapshot và shims khác assumption cũ; adapter phải support catalog cụ thể và artifact gốc, không tự bịa story pipeline.
7. Cancel acknowledgement không chứng minh mọi background child đã dừng; test crash sau side effect, lost network và stale lease phải nằm trong nghiệm thu.
