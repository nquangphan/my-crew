# Spike SP-1: `--plugin-dir` và các nguồn skill lọt vào run (07/10/2026, Mac mini)

**Kết luận:** `--plugin-dir` chạy được dưới `--setting-sources project,local`. Superpowers 6.4.1 được nạp từ đúng thư mục ghim (`source: superpowers@inline`, `path` = thư mục ghim). Skill cá nhân `~/.claude/skills` (`find-skills`, `synced`, `tro-ly`) **không** lọt. 12 plugin user-scope và các hook trong `~/.claude/settings.json` cũng không lọt. Vì vậy giữ ruling `--plugin-dir`, làm SP-2/SP-3 như kế hoạch, không cần nhánh dự phòng (settings project-scope trong worktree).

## Môi trường

- `claude` 2.1.289, model `claude-haiku-4-5-20251001`, chạy trong phiên Terminal của owner, **không** đặt `PAPERCLIP_RUN_ID` (đã `env -u PAPERCLIP_RUN_ID -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT`).
- Thư mục thử `/private/tmp/claude-501/sp-spike.T4BT/` (ngoài `~/crew-agents` và repo Crew), đã xóa sau spike.
- Repo đồ chơi `sp-spike/` có 2 commit: `init` (rỗng) và `.claude/skills/spike-project-skill/SKILL.md` đã được git track.
- Thư mục ghim thử: bản **copy** của `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1` sang `…/pin/superpowers-6.4.1` (`rsync -a --exclude '/.in_use'`), gồm 231 file. Không đụng `~/.claude/plugins`, không cài gì vào `~/.crew/`.
- Owner có ở user-scope: `~/.claude/skills/{find-skills,synced,tro-ly}`; `enabledPlugins` gồm 12 plugin (`backend-tools@claudekit-skills`, `code-review@claude-plugins-official`, `context7@…`, `devops-tools@…`, `figma@…`, `frontend-design@…`, `playwright@…`, `skill-creator@…`, `swift-lsp@…`, `typescript-lsp@…`, `ui-ux-pro-max@ui-ux-pro-max-skill`, `web-dev-tools@claudekit-skills`); hook cho 14 sự kiện (`SessionStart`, `PreToolUse`, `SubagentStart`, …). Không có `~/.claude/agents` hay `~/.claude/commands`.

## Lệnh đã chạy

```bash
BASE=$(mktemp -d /private/tmp/claude-501/sp-spike.XXXX); SCR="$BASE/sp-spike"
# dựng repo đồ chơi + project skill như SP-1 Step 1
PIN="$BASE/pin/superpowers-6.4.1"; rsync -a --exclude '/.in_use' "$ORIG/" "$PIN/"
R() { env -u PAPERCLIP_RUN_ID -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT claude -p --model haiku --max-turns 1 \
      --output-format stream-json --verbose "$@" "Trả lời đúng một chữ: ok" </dev/null >"$BASE/$OUT.jsonl"; }
OUT=a-plugin-dir R --setting-sources project,local --plugin-dir "$PIN"
OUT=b-no-plugin  R --setting-sources project,local
OUT=c-local-only R --setting-sources local --plugin-dir "$PIN"
```

Plan gốc dùng `| head -1`, nhưng ở đây em lưu toàn bộ stream. Lý do: khi có hook SessionStart, dòng đầu là `system/hook_started` chứ không phải `system/init`. Cả ba lượt đều thoát 0 và trả `ok`, tổng chi phí khoảng 0,045 USD.

**Thứ tự sự kiện:** A và C có `hook_started` → `hook_response` (hook `SessionStart:startup` của Superpowers, `additionalContext` bắt đầu bằng `<EXTREMEL…`) → `init` → … → `result/success`. B bắt đầu thẳng bằng `init`.

Các khóa có thật trong `system/init`: `agents, analytics_disabled, apiKeySource, capabilities, claude_code_version, cwd, fast_mode_disabled_reason, fast_mode_state, mcp_servers, memory_paths, messaging_socket_path, model, output_style, per_turn_effort_active, permissionMode, plugins, product_feedback_disabled, session_id, skills, slash_commands, subtype, terminal_slash_commands, tools, type, uuid, view_mode`.

## Bảng kết quả

| Lượt | `--setting-sources` | `--plugin-dir` | Superpowers từ thư mục ghim | `spike-project-skill` | `find-skills`/`synced`/`tro-ly` | Plugin user-scope (12) | Hook user | Plugin khác |
|---|---|---|---|---|---|---|---|---|
| A | `project,local` | có | **có** (15 skill `superpowers:*`) | **có** | không | không | không | chỉ builtin `cc-plugin-telemetry` |
| B | `project,local` | không | không | có | không | không | không | builtin `cc-plugin-agents-md`, `cc-plugin-telemetry`, `cc-plugin-plugin-authoring` |
| C | `local` | có | có | **không** | không | không | không | ba builtin như B |

**`plugins` của A (nguyên văn):**

```json
[{"name":"superpowers","path":"/private/tmp/claude-501/sp-spike.T4BT/pin/superpowers-6.4.1","source":"superpowers@inline","version":"6.4.1"},
 {"name":"cc-plugin-telemetry","path":"builtin","source":"cc-plugin-telemetry@builtin"}]
```

**`skills` của A (nguyên văn):** `spike-project-skill, deep-research, superpowers:brainstorming, superpowers:diagnosing-superpowers, superpowers:dispatching-parallel-agents, superpowers:executing-plans, superpowers:finishing-a-development-branch, superpowers:receiving-code-review, superpowers:requesting-code-review, superpowers:subagent-driven-development, superpowers:systematic-debugging, superpowers:test-driven-development, superpowers:using-git-worktrees, superpowers:using-superpowers, superpowers:verification-before-completion, superpowers:writing-plans, superpowers:writing-skills, design, design-sync, dataviz, update-config, verify, debug, code-review, simplify, batch, fewer-permission-prompts, doctor, loop, schedule, claude-api, workflow-authoring, run, run-skill-generator`

**`skills` của B:** `spike-project-skill, deep-research, design, design-sync, dataviz, update-config, verify, debug, code-review, simplify, batch, fewer-permission-prompts, doctor, loop, schedule, claude-api, workflow-authoring, run, run-skill-generator, plugin-authoring`

**`skills` của C:** giống A nhưng không có `spike-project-skill`, và có thêm `plugin-authoring`.

**Chung cả ba lượt:** `agents` = `claude, Explore, general-purpose, Plan, statusline-setup` (chỉ có agent dựng sẵn). `mcp_servers` = `[{"name":"claude.ai Claude Docs","status":"connected","source":"claudeai"}]`. `memory_paths` = `{"auto": "~/.claude/projects/-private-tmp-claude-501-sp-spike-T4BT-sp-spike/memory/"}`. `apiKeySource` = `none`.

**Checksum cây** (thuật toán ở `superpowers-mac.md`), đo trước và sau ba lượt, cho cả bản gốc lẫn bản copy: `3f0ff8c82c0795dae8de3cc3ef358364d4f3de81e78b86e1d64b03ac2f9cbd9a`, không đổi. Bản copy không có `.in_use`. Như vậy claude, kể cả hook SessionStart của Superpowers, không ghi gì vào thư mục ghim.

## Phân tích nguồn

- **Thư mục ghim (`--plugin-dir`):** được nạp ngay cả khi không có nguồn `user`. Nó hiện trong `init` dưới dạng `source: "superpowers@inline"` kèm `path` tuyệt đối. Vì vậy SP-3/Cổng 4 kiểm được `path` == thư mục ghim và `version` == `6.4.1`.
- **Project `.claude/` đã commit:** nạp khi có `project` trong `--setting-sources` (A, B), không nạp khi chỉ có `local` (C). Điều này khớp O6 (nguồn `project` là allowed). Không được bỏ `project` khỏi `extraArgs`.
- **Skill user `~/.claude/skills`:** **không lọt** dưới `project,local`. Ruling Q2 vẫn đúng nhưng không cần dùng tới. Hệ quả: agent sẽ không thấy `tro-ly` nếu repo dự án không tự commit nó.
- **Plugin user-scope (`enabledPlugins` trong `~/.claude/settings.json`) và hook user:** không lọt. Hook SessionStart duy nhất chạy là của Superpowers.
- **Skill không chặn được bằng `--setting-sources`:** `deep-research, design, design-sync, dataviz, update-config, verify, debug, code-review, simplify, batch, fewer-permission-prompts, doctor, loop, schedule, claude-api, workflow-authoring, run, run-skill-generator` có mặt ở cả ba lượt, kể cả C (chỉ `local`). Đây là skill dựng sẵn của CLI 2.1.289, không đến từ `~/.claude/skills` hay plugin của owner. Lưu ý `code-review` ở đây là skill dựng sẵn, không phải plugin `code-review@claude-plugins-official` (plugin đó không có trong `plugins`).
- **Plugin builtin `cc-plugin-*`:** lượt A thiếu `cc-plugin-agents-md` và `cc-plugin-plugin-authoring` (B và C đều có). Chỉ có một mẫu nên chưa rõ đây là do nạp không tất định hay có quy tắc ẩn. Việc này không ảnh hưởng ruling.
- **MCP `claude.ai Claude Docs` (`source: claudeai`):** connector gắn với tài khoản claude.ai, không đi qua settings, nên `--setting-sources` không chặn được. Nó không phải skill/plugin.
- **Auto-memory:** ghi vào `~/.claude/projects/<cwd mã hóa>/memory/` theo từng cwd. Với agent, đường dẫn này sẽ theo worktree `~/crew-agents/<agent>`.

## Kết luận cho SP-2/SP-3

1. Giữ ruling: `adapterConfig.extraArgs = ["--setting-sources","project,local","--plugin-dir","<thư mục pin>"]`. Không cần nhánh dự phòng settings project-scope.
2. **SP-3/Cổng 4, kiểm bằng `system/init`:** `plugins` có đúng một phần tử không phải builtin, với `name: "superpowers"`, `source: "superpowers@inline"`, `path` == `superpowersPinDir(home)`, `version` == `6.4.1`. Thêm vào đó, `skills` có `superpowers:using-superpowers`. Cổng 4 ghi "không có skill/plugin cá nhân" nên phải dùng danh sách cho phép: bỏ qua plugin `*@builtin` và tập skill dựng sẵn ở trên, nếu không thì kiểm sẽ báo sai.
3. Với stream-json, dòng đầu có thể là `system/hook_started` vì hook SessionStart của Superpowers. Code nào đọc `init` phải tìm `type=system, subtype=init`, không được lấy dòng đầu.
4. SP-2 copy cây bằng cách bỏ `.in_use` ở gốc. Bản copy ra đúng checksum `3f0ff8c8…bd9a` và 231 file. Claude không ghi vào thư mục plugin, nên kiểm checksum ở thời điểm chạy (wrapper/doctor) là ổn định.

## Ruling

Không đổi cách bật. Ruling Q2 (chấp nhận skill user lọt) vẫn giữ làm phương án phòng hờ, vì thực đo thì skill user không lọt.

## Dọn

Đã `rm -rf /private/tmp/claude-501/sp-spike.T4BT`. Đã xóa luôn 3 transcript phiên mà spike sinh ra tại `~/.claude/projects/-private-tmp-claude-501-sp-spike-T4BT-sp-spike/`. `pgrep -fl sp-spike` rỗng.

## Đo khác version (07/10/2026, sau review SP-3)

- **Hỏi:** repo commit `enabledPlugins` `superpowers@claude-plugins-official` (bản owner 6.4.1) cộng `--plugin-dir` trỏ một bản khác version thì claude nạp bản nào, mấy bản?
- **Lệnh:** 1 lượt `claude -p --model haiku --max-turns 1 --output-format stream-json --verbose --setting-sources project,local --plugin-dir <bản copy>`.
  - Chạy trong repo tạm `/private/tmp/claude-501/sp-m2.*`, có commit `.claude/settings.json` = `{"enabledPlugins":{"superpowers@claude-plugins-official":true}}`.
  - `<bản copy>` là bản copy tạm của 6.4.1 đã sửa `.claude-plugin/plugin.json` thành `"version": "6.4.1-test"`.
  - Không đặt `PAPERCLIP_RUN_ID`, không đụng `~/.claude/plugins`. Đã xóa thư mục tạm và transcript.
- **Kết quả `system/init`:** `plugins` có đúng MỘT superpowers, `{"name":"superpowers","path":"<bản copy>","source":"superpowers@inline","version":"6.4.1-test"}`, cùng ba plugin builtin. Có 15 skill `superpowers:*`, không có skill namespace nào khác.
- **Lưu ý khi đọc kết quả:** bản owner cài theo scope **project** cho `/Volumes/CORSAIR/Projects/my-crew` (`installed_plugins.json`). Vì vậy ở thư mục khác (repo tạm, cũng như worktree `~/crew-agents/*`), `enabledPlugins` của repo có thể không tìm được bản owner. Lượt đo không tách được hai khả năng "`--plugin-dir` thắng" và "bản owner không áp cho thư mục này". Cả hai đều cho cùng hệ quả với agent: chỉ bản `--plugin-dir` được nạp.
- **Kết luận theo luật của lead:** chỉ bản `--plugin-dir` nạp. Vì vậy nguồn repo `enabledPlugins` superpowers được xếp `pinned` (không chặn, không đọc `installed_plugins.json` mỗi run). Doctor `superpowers-pin` báo `warn` khi bản owner khác pin. `run-init-check` vẫn bắt trường hợp nạp đôi nếu sau này có.
