# R2-4 — Gói `probe` (SP-0, cổng G0)

Model opus. Không code nguồn, không commit nhánh code.
- **Ghi:** `reports/sp-0-probe.md`, `processes.md`, `sdd-ledger.md`.
- **Thư mục tạm:** `~/crew-r24-probe/` (không dưới `/Volumes`, `~/Documents`).
- **Quota:** đúng 1 `opencode run`, 0 run Codex, 0 run Paperclip.
- **Credential:**
  - không đọc nội dung `~/.codex/auth.json`, `~/.local/share/opencode/auth.json`, chỉ `test -e`/`stat -f '%Lp %z'`;
  - không chạy `security … -w` ra terminal: chỉ dùng trong lệnh con mà đầu ra không in giá trị (Step O2).

Đầu ra mỗi mục: `ĐẠT` / `KHÔNG ĐẠT` / `CHỜ` + bằng chứng (lệnh, đầu ra rút gọn, `file:dòng`) + giá trị điền vào
Interface của plan.

### Task SP-0

**Files:**
- Create: `plans/261010-0100-crew-v3-r2-4/reports/sp-0-probe.md`
- Modify: `plans/261010-0100-crew-v3-r2-4/{processes.md,sdd-ledger.md}`

- [ ] **Step 1: Ghi giờ bắt đầu.** `TZ=Asia/Ho_Chi_Minh date '+%Y-%m-%d %H:%M'`. Thêm dòng `SP-0 bắt đầu` vào ledger.
  Tạo `~/crew-r24-probe/`, ghi `processes.md`.

- [ ] **Step 2: C1 — Codex đăng nhập trong phiên sshd agent.**
  Chạy qua sshd agent (cổng 2222, khóa doctor như R2-2 DP-1):

```bash
ssh -F /dev/null -p 2222 -i ~/.crew-mac/doctor_ed25519 -o BatchMode=yes -o IdentitiesOnly=yes \
  -o UserKnownHostsFile="$HOME/.crew-mac/known_hosts" "$USER@127.0.0.1" \
  '~/.local/bin/codex login status; echo rc=$?; ~/.local/bin/codex --version'
```

  - Đạt khi `rc=0` và dòng trạng thái báo đã đăng nhập (ghi nguyên văn dòng, không có token).
  - Ghi thêm `stat -f '%Lp' ~/.codex/auth.json` (quyền) và `codex --version`.
  - Ghi nguyên văn chuỗi trạng thái cho MR-4 parse (I8 `loggedIn`).

- [ ] **Step 3: C2 — `restore` của asset `home` khi `auth.json` thiếu.**
  Đọc `packages/adapters/codex-local/src/server/codex-auth-copyback.ts` và `remote-managed-runtime.ts:238–256` trên
  `crew/r2-3`. Viết test tạm (không commit) trong worktree tạm của fork:

```ts
// ~/crew-r24-probe/copyback.probe.test.ts — chạy bằng: corepack pnpm --filter @paperclipai/adapter-codex-local exec vitest run <đường dẫn>
import { describe, expect, it } from "vitest";
import { copyBackCodexAuth } from "../<worktree>/packages/adapters/codex-local/src/server/codex-auth-copyback.ts";
describe("copy-back khi sandbox không có auth.json", () => {
  it("không ném và không ghi host", async () => {
    const writes: string[] = [];
    await expect(copyBackCodexAuth({
      readSandboxAuth: async () => { const e = new Error("ENOENT"); (e as NodeJS.ErrnoException).code = "ENOENT"; throw e; },
      hostAuthPath: "/nonexistent/host/auth.json",
      log: (line) => writes.push(line),
      env: {},
    } as never)).resolves.not.toThrow();
    expect(writes.join("\n")).not.toMatch(/installed|copied/i);
  });
});
```

  - Đạt khi test xanh. Nếu chữ ký hàm khác thì chỉnh test theo chữ ký thật và ghi lại.
  - Ghi thêm: `CODEX_HOME` mà adapter truyền xuống lệnh remote là đường tuyệt đối dưới
    `<worktree>/.paperclip-runtime/codex/home` (đọc `execute.ts` quanh `assetDirs.home`, ghi `file:dòng`).
  - Không đạt thì ghi phương án dự phòng (plan Đợt 0 a).

- [ ] **Step 4: C3 — quota Codex đọc được không cần token.**

```bash
f=$(ls -t ~/.codex/sessions/*/*/*/*.jsonl 2>/dev/null | head -1); echo "$f"
grep -o '"rate_limits":{[^}]*}[^}]*}' "$f" | tail -1 | sed -E 's/"(access|refresh|id)_token":"[^"]*"/"\1_token":"<bỏ>"/g'
```

  Ghi tên trường `used_percent`, `resets_at` (hoặc tên thật) cho MR-4. Không có file thì ghi `CHỜ`. MR-4 khi đó trả
  `null`.

- [ ] **Step 5: O1 — năng lực model OpenCode Go.**

```bash
opencode models opencode-go --verbose > ~/crew-r24-probe/models-verbose.txt 2>&1; echo rc=$?
```

  Với `deepseek-v4-flash`, `kimi-k3`, `glm-5.3`, ghi:
  - có nhận ảnh không (`modalities.input` có `image`, hoặc `attachment: true`, theo đúng tên trường in ra);
  - có tool call không.

  Model không có tool call → đề xuất thay bằng model cùng mức có tool call, ghi vào báo cáo (Trợ Lý đưa vào câu hỏi
  owner, không tự đổi I1). Điền `vision` cho I1.

- [ ] **Step 6: O4 — mẫu lỗi quota/đăng nhập của OpenCode.**
  - Tìm trong mã nguồn bản cài: `ls /opt/homebrew/Cellar/opencode/*/libexec` hoặc gói npm. Nếu là binary thì dùng
    `strings <binary> | grep -iE 'quota|rate limit|insufficient|usage limit|unauthorized|invalid api key|401|402|429' | sort -u | head -50`.
  - Trong log cũ: `grep -hiE 'quota|rate.?limit|429|402|401|unauthori' ~/.local/share/opencode/log/*.log | cut -c1-200 | sort -u | head -30`.
    Trước khi ghi báo cáo, xóa mọi chuỗi giống key (`sk-`, chuỗi base64 ≥ 24 ký tự).
  - Chốt hai regex (I5) cho PL-2, ví dụ dạng `/(rate limit|quota|usage limit|insufficient balance|\b429\b|\b402\b)/i`
    và `/(unauthori[sz]ed|invalid api key|\b401\b|no api key)/i`, kèm câu thật làm ca test.

- [ ] **Step 7: P1 — payload `agent.run.failed`.**
  - Đọc chỗ phát sự kiện trong `server/src/services/heartbeat.ts` (`grep -n '"agent.run.failed"'`) và
    `plugin-host-services.ts`.
  - Ghi các trường payload thật: có `errorCode`? `errorFamily`? `error` (thông điệp)? `issueId`? `adapterType`?
  - Thiếu `errorFamily`: tìm đường plugin đọc `resultJson` hoặc run (SDK `ctx.runs`?
    `grep -n "runs\." packages/plugins/sdk/src/types.ts`).
  - Không có đường nào thì I5 dùng `errorCode` + thông điệp. Ghi rõ là `quota` của Codex được nhận qua
    `errorCode === "provider_quota"` hoặc chuỗi thông điệp.

- [ ] **Step 8: P2 — đổi assignee có hủy run cũ không.**
  - Đọc `server/src/services/issues.ts` (`update`) và `heartbeat.ts`: khi `assigneeAgentId` đổi qua service (không
    qua route), run `queued` / `scheduled_retry` của agent cũ có bị hủy không. Tìm `issue_reassigned`,
    `lock_released_on_reassignment`.
  - Kết luận `stock hủy` hoặc `cần cancelSuperseded`, kèm `file:dòng`.
  - Kiểm thêm: run `queued` của agent cũ tới lượt claim mà issue đã đổi assignee thì stock làm gì (bỏ qua, chạy,
    hủy).

- [ ] **Step 9: Chụp `ps` thật.**
  - Chụp đúng lúc run O2 đang chạy:
    `ps -E -ww -o pid=,ppid=,pgid=,etime=,command= | grep -E 'opencode run' | grep -v grep | sed -E 's/(KEY|TOKEN|SECRET)[A-Z_]*=[^ ]+/\1=<bỏ>/g' > ~/crew-r24-probe/ps-opencode.txt`.
  - Với Codex không có run: lấy dòng lệnh từ `codex-args.ts` (`exec --json … -`) và ghi rõ là dựng tay.
  - Lưu bản đã làm sạch vào báo cáo cho MR-3 fixture.

- [ ] **Step 10: O2 + O3 — một `opencode run` với key từ Keychain, HOME/XDG tạm, worktree có gitdir ngoài.**
  Điều kiện: owner đã chạy `security add-generic-password -U -s crew.opencode-go -a crew -w` (gõ key tay).
  Kiểm có mục mà không in: `security find-generic-password -s crew.opencode-go -a crew >/dev/null 2>&1 && echo có`.
  Chưa có thì ghi `CHỜ`, bỏ Step 10, sang Step 11.
  - Ghi `opencode stats --days 1 --models` vào ledger trước khi chạy.
  - Script (lưu `~/crew-r24-probe/o2.sh`, chạy một lần):

```sh
#!/bin/sh
set -eu
P="$HOME/crew-r24-probe"
rm -rf "$P/repo" "$P/wt" "$P/xdg"; mkdir -p "$P/xdg/data" "$P/xdg/state" "$P/xdg/cache" "$P/xdg/config"
git init -q "$P/repo" && git -C "$P/repo" commit -q --allow-empty -m init
git -C "$P/repo" worktree add -q -b probe "$P/wt"
CREW_OPENCODE_GO_KEY=$(/usr/bin/security find-generic-password -s crew.opencode-go -a crew -w) || { echo "không đọc được key"; exit 1; }
export CREW_OPENCODE_GO_KEY
export XDG_DATA_HOME="$P/xdg/data" XDG_STATE_HOME="$P/xdg/state" XDG_CACHE_HOME="$P/xdg/cache" XDG_CONFIG_HOME="$P/xdg/config"
export OPENCODE_CONFIG_CONTENT='{"provider":{"opencode-go":{"options":{"apiKey":"{env:CREW_OPENCODE_GO_KEY}"}}},"permission":{"edit":"allow","bash":"allow","external_directory":"allow"}}'
cd "$P/wt"
opencode run --format json -m opencode-go/deepseek-v4-flash "Chạy đúng lệnh: git commit --allow-empty -m probe-r24 ; rồi trả lời một chữ: xong" > "$P/o2.jsonl" 2> "$P/o2.err"; echo "rc=$?"
git -C "$P/wt" log --oneline -1
```

  - **O2 đạt** khi `rc=0` và có trả lời.
  - Không đạt vì auth: thử lại **trong cùng lượt quota đã tính** bằng biến môi trường provider mà OpenCode dùng (tìm
    `opencode-go` + `env` trong `strings`, ví dụ `OPENCODE_API_KEY`), không chạy model lần hai. Chỉ kiểm bằng
    `opencode models opencode-go` (không tốn quota) xem có báo lỗi auth không. Ghi kết luận.
  - **O3 đạt** khi `git log` in `probe-r24`.
  - Sau khi chạy, `grep -c "$CREW_OPENCODE_GO_KEY"` trên `o2.jsonl`, `o2.err` và `$P/xdg` (chạy trong cùng script con,
    chỉ in số dòng). Phải là 0.
  - Ghi chi phí sau run (`opencode stats --days 1 --models`).

- [ ] **Step 11: Viết `reports/sp-0-probe.md`.**
  - Bảng C1–C3, O1–O4, P1–P2, ps.
  - Mục "Giá trị điền vào plan":
    - `vision` (I1);
    - tên biến key và dạng `OPENCODE_CONFIG_CONTENT` (I6);
    - `OPENCODE_QUOTA_RE`, `OPENCODE_AUTH_RE` + câu mẫu (I5);
    - nguồn `errorFamily` (I5);
    - `cancelSuperseded` cần hay không (I4);
    - chuỗi `codex login status` (I8);
    - tên trường quota Codex (I8);
    - dòng `ps` mẫu (MR-3).

- [ ] **Step 12: Dọn.**
  - `git -C ~/crew-r24-probe/repo worktree remove --force ~/crew-r24-probe/wt`; `rm -rf ~/crew-r24-probe`.
  - Không để process nền.
  - `processes.md` đổi trạng thái `đã gỡ`.
  - Ghi ledger dòng `SP-0 xong` + giờ + tóm tắt quyết định đề xuất cho G0.
