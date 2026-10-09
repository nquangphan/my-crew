# Crew v3 R2-3: gói `mac-workflows` (MW-1…MW-4) trong repo Crew, kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `crew-mac` ghim BMAD cạnh Superpowers, nhận đúng một workflow đã chứng nhận mỗi run, chặn nạp chéo, có lệnh
`workflows list|install|gc` và `bmad stories|setup-project`, dọn bản ghim cũ khi không còn run dùng.

**Architecture:** Tổng quát hóa `apps/crew-mac/src/workflows/` (pin → sổ workflow), thêm `src/bmad/` (parser file
epic/story, luật câu trả lời port v2, dựng `_bmad/` bằng `setup.py` của bản ghim). Wrapper giữ luật một `--plugin-dir`,
chỉ thêm dấu `.in_use`. Không đụng `src/files/**`.

**Tech Stack:** Node ≥ 22 ESM, TypeScript 7, Vitest, Biome 2.5; `/usr/bin/git`, `tar`, `uv`.

**Spec:** [plan.md](plan.md) (Global Constraints, Review Focus 1, 2, 3, 5; Interface I1–I5) và spec §4.2–4.6.

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng gói này:

- Worktree `.worktrees/crew-r23-workflows`, nhánh `r23/mac-workflows` rẽ từ `r2-3`. Mỗi ticket bắt đầu bằng
  `git merge --ff-only r2-3`.
- Không sửa `apps/mac-app/**`, `apps/crew-mac/src/files/**`. `src/cli.ts`: MW-1 thêm `case 'workflows'`, MW-3 thêm
  `case 'bmad'`, mỗi ticket kèm dòng usage; không sửa nhánh khác.
- Test không gọi mạng, không chạy `claude`, `uv` thật. Git thật được dùng trong repo tạm (như `workflows-inventory.test.ts`).
  Lệnh ngoài đi qua `ctx.runner` (`FakeRunner` trong test).
- Hằng số `BMAD_PIN.checksum`, `BMAD_PIN.executables` chép nguyên từ mục "Giá trị cho MW-1/MW-3" của `probe-report.md`.
- Lệnh kiểm mỗi ticket (trong worktree):
  `pnpm --filter @crew/mac test -- <file test của ticket> && pnpm --filter @crew/mac typecheck && pnpm exec biome check apps/crew-mac docs && node packages/docs-kit/dist/crew-docs.cjs check --staged`.

---

### Task 1 (MW-1): Sổ workflow, bản ghim BMAD, cài, `workflows list|install`, doctor

**Files:**
- Create: `apps/crew-mac/src/workflows/{registry,bmad-pin,bmad-install}.ts`, `src/commands/workflows.ts`,
  `test/workflows-bmad-install.test.ts`, `test/workflows-registry.test.ts`, `test/workflows-command.test.ts`
- Modify: `src/workflows/pin.ts` (`WorkflowId`, `pinDir`), `src/workflows/install.ts` (dùng `pinDir`),
  `src/context.ts` + `src/context-factory.ts` (`bmadPin`), `src/commands/setup.ts` (cài BMAD, in hai `extraArgs`),
  `src/commands/doctor.ts` (`bmad-pin`, `agent-uv`), `src/cli.ts` (`case 'workflows'`), `src/index.ts` (export),
  `test/helpers/fake-mac.ts` (`FIXTURE_BMAD_PIN` dựng động, `bmadPin`), `test/{workflows-pin,setup,doctor}.test.ts`,
  `docs/flows/{mac-workflows,mac-setup}.md`, `docs/flows.yaml` (khối `mac-workflows`), `docs/files.md` (sinh)

**Interfaces:**
- Consumes: `treeChecksum`, `missingExecutables` (`install.ts`), `SetupError`, `MacContext`.
- Produces: I1 nguyên văn; `workflowsCommand(ctx, argv): Promise<number>` với `list [--json]`, `install`; setup trả thêm
  `bmad: { dir: string; extraArgs: string[] }`.

- [ ] **Step 1: Test sổ và pin** (`test/workflows-registry.test.ts`, thêm ca vào `workflows-pin.test.ts`):

```ts
it('pinDir theo workflow, superpowersPinDir giữ nguyên', () => {
  expect(pinDir('/Users/a', BMAD_PIN)).toBe('/Users/a/.crew/workflows/bmad/6.13.0-next-d009608292d8');
  expect(superpowersPinDir('/Users/a')).toBe('/Users/a/.crew/workflows/superpowers/6.4.1-5bf4e7801107');
});
it('BMAD_SOURCE chỉ trỏ repo chính thức qua https và đúng revision ghim', () => {
  expect(BMAD_SOURCE.repoUrl).toBe('https://github.com/bmad-code-org/bmad-plugins.git');
  expect(BMAD_PIN.revision).toBe(BMAD_SOURCE.revision);
  expect(BMAD_PIN.revision).toMatch(/^[0-9a-f]{40}$/);
  expect(BMAD_PLUGIN_JSON).toBe('{"name":"bmad","version":"6.13.0-next","description":"BMAD Method (bmad-method + bmad-toolbox), Crew pin d009608292d8"}\n');
  expect(JSON.parse(BMAD_PLUGIN_JSON).name).toBe(BMAD_PIN.workflow);
});
it('sổ có đúng hai workflow, superpowers mặc định, chỉ claude_local', () => {
  const list = certifiedWorkflows({ superpowersPin: SUPERPOWERS_PIN, bmadPin: BMAD_PIN });
  expect(list.map((w) => [w.id, w.isDefault, w.runtimes])).toEqual([
    ['superpowers', true, ['claude_local']],
    ['bmad', false, ['claude_local']],
  ]);
});
it('workflowForPluginDir nhận đúng thư mục ghim (so comparablePath), từ chối marketplace và cache owner', () => {
  const ctx = { home: '/Users/a', superpowersPin: SUPERPOWERS_PIN, bmadPin: BMAD_PIN };
  expect(workflowForPluginDir(ctx, '/Users/a/.crew/workflows/bmad/6.13.0-next-d009608292d8')?.id).toBe('bmad');
  expect(workflowForPluginDir(ctx, '/Users/A/.crew/workflows/superpowers/6.4.1-5bf4e7801107/')?.id).toBe('superpowers');
  expect(workflowForPluginDir(ctx, '/Users/a/.claude/plugins/marketplaces/bmad/plugins/method')).toBeNull();
});
it('pluginKeys phân đúng key enabledPlugins', () => {
  const [sp, bmad] = certifiedWorkflows({ superpowersPin: SUPERPOWERS_PIN, bmadPin: BMAD_PIN });
  expect(sp.pluginKeys.some((r) => r.test('superpowers@claude-plugins-official'))).toBe(true);
  for (const k of ['bmad@x', 'bmad-method@bmad', 'bmad-toolbox@bmad']) expect(bmad.pluginKeys.some((r) => r.test(k))).toBe(true);
  expect(bmad.pluginKeys.some((r) => r.test('bmadx@y'))).toBe(false);
});
```

- [ ] **Step 2: Test cài** (`test/workflows-bmad-install.test.ts`). Helper `seedBmadMarketplace(home)` dựng repo git thật
  ở `<home>/.claude/plugins/marketplaces/bmad` với `plugins/method/skills/m1/SKILL.md`,
  `plugins/toolbox/skills/bmad/scripts/setup.py` (mode 0755), commit, trả `{ revision }`; `fixtureBmadPin(revision)` tính
  checksum từ một cây tham chiếu dựng tay (`skills/m1/SKILL.md`, `skills/bmad/scripts/setup.py`,
  `.claude-plugin/plugin.json` = `BMAD_PLUGIN_JSON`) bằng `treeChecksum`, `executables: ['skills/bmad/scripts/setup.py']`.
  Ca:
  1. Marketplace có revision → `source: 'marketplace'`, thư mục ghim đúng checksum, `plugin.json` đúng byte, setup.py
     có bit x, không còn `*.tmp-*`, không file mới dưới `~/.claude` ngoài repo đã dựng (so danh sách trước/sau).
  2. Lần hai → `source: 'existing'`, không gọi `git` (đếm lệnh `FakeRunner` hoặc mtime không đổi).
  3. Marketplace HEAD đã sang commit mới (thêm commit sửa `SKILL.md`) → vẫn ra đúng cây của revision ghim.
  4. Không có marketplace → gọi `git clone --filter=blob:none --no-checkout <repoUrl> <tmp>`: test truyền `source` có
     `repoUrl` là đường dẫn repo tạm (tham số thứ hai của `installBmadPin`), kiểm `source: 'github'`.
  5. Hai cây trùng tên skill → `SetupError` `tên skill trùng giữa bmad-method và bmad-toolbox: <tên>`, không để lại thư
     mục ghim hay bản tạm.
  6. Thư mục ghim có sẵn mà lệch checksum (sửa một byte) → `SetupError` có `WORKFLOW_SOURCE_MISMATCH`, không ghi đè.
  7. Bản tạm `<dir>.tmp-<pid khác>` còn sót → bị xóa trước khi cài.
  8. Cả hai nguồn lỗi (marketplace không có revision, clone lỗi) → `SetupError`
     `không lấy được BMAD <version> (<rev12>): cần mạng tới github.com hoặc marketplace bmad có commit này`.

- [ ] **Step 3: Test lệnh và doctor/setup.** `test/workflows-command.test.ts`:
  - `workflows list --json` in `[{"id":"superpowers","version":…,"revision":…,"checksum":…,"runtimes":["claude_local"],"isDefault":true,"purpose":…,"dir":…,"installed":true|false},{"id":"bmad",…}]`;
    `installed` = thư mục có và đúng checksum. Không `--json`: mỗi workflow một dòng
    `<id> <version> rev=<rev12> <đã cài|chưa cài|lệch checksum> <mặc định|->`.
  - `workflows install`: gọi `installSuperpowersPin` rồi `installBmadPin`, in hai dòng
    `extraArgs (vai thường): ["--setting-sources","project,local","--plugin-dir","<dir sp>"]` và
    `extraArgs (vai bmad): [… "<dir bmad>"]`, thoát 0; `SetupError` → in câu lỗi, thoát 1. Không gọi gì của sshd/launchctl
    (`FakeRunner` không ghi nhận lệnh `launchctl`, `sshd`).
  - `doctor`: `bmad-pin` ok/error (thiếu, lệch checksum, thiếu bit x); `agent-uv` ok khi `command -v uv` trong
    `zsh -c` với PATH như check `agent-node` hiện có, `error` kèm cách sửa `cài uv: curl -LsSf https://astral.sh/uv/install.sh | sh` khi không có.
  - `setup`: cài cả hai, trả `bmad.extraArgs`; BMAD lỗi thì `setup` ném `SetupError` sau khi Superpowers đã cài (thứ tự
    giữ: Superpowers trước).
- [ ] **Step 4: Chạy** `pnpm --filter @crew/mac test -- test/workflows-registry.test.ts test/workflows-pin.test.ts test/workflows-bmad-install.test.ts test/workflows-command.test.ts test/setup.test.ts test/doctor.test.ts`
  → FAIL (thiếu module/hàm).
- [ ] **Step 5: Cài.**
  - `pin.ts`: `export type WorkflowId = 'superpowers' | 'bmad'`; `WorkflowPin.workflow: WorkflowId`;
    `pinDir(home, pin) = join(macPaths(home).workflowsRoot, pin.workflow, `${pin.version}-${pin.revision.slice(0, 12)}`)`;
    `superpowersPinDir(home, pin = SUPERPOWERS_PIN) = pinDir(home, pin)`.
  - `bmad-pin.ts`: đúng I1; comment đầu file: nguồn, ngày đo (SP-0), cách nâng bản (sửa hằng số, `crew-mac workflows
    install`, `apply-roles.sh agent <id> bmad <dir mới>`).
  - `bmad-install.ts`:

```ts
export function installBmadPin(ctx: MacContext, source: typeof BMAD_SOURCE | BmadSourceOverride = BMAD_SOURCE): BmadInstallResult {
  const pin = ctx.bmadPin;
  const dir = pinDir(ctx.home, pin);
  removeStaleTemps(dir);                       // xóa `${dir}.tmp-*` mọi pid
  if (pathExists(dir)) return { dir, source: verifyExisting(dir, pin) };   // ném WORKFLOW_SOURCE_MISMATCH như Superpowers
  const tmp = `${dir}.tmp-${process.pid}`;
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  try {
    const tar = join(tmp, '.src.tar');
    const from = archiveFromMarketplace(ctx, source, tar) ? 'marketplace' : archiveFromClone(ctx, source, tar, tmp);
    extractAndAssemble(ctx, tar, tmp, source.trees);   // tar -x vào tmp/.src, chuyển skills/<tên> lên tmp/skills, trùng tên → SetupError
    rmSync(join(tmp, '.src'), { recursive: true, force: true }); rmSync(tar, { force: true });
    mkdirSync(join(tmp, '.claude-plugin'), { mode: 0o755 });
    writeFileSync(join(tmp, '.claude-plugin', 'plugin.json'), BMAD_PLUGIN_JSON, { mode: 0o644 });
    setExecutables(tmp, pin);
    if (treeChecksum(tmp).checksum !== pin.checksum) throw new SetupError(`bản BMAD tải về lệch checksum ghim (WORKFLOW_SOURCE_MISMATCH)`);
    renameSync(tmp, dir);
    return { dir, source: from };
  } catch (err) { rmSync(tmp, { recursive: true, force: true }); throw err; }
}
```

    Lệnh git: `git -C <marketplace> cat-file -e <rev>^{commit}`, `git -C <marketplace> archive --format=tar -o <tar> <rev> <trees…>`;
    clone: `git clone --filter=blob:none --no-checkout <repoUrl> <tmp>/.clone`, rồi `archive` từ đó, xóa `.clone`. Mọi
    lệnh qua `ctx.runner` với timeout 120 giây cho clone, 30 giây cho lệnh khác. `extractAndAssemble` dùng `tar -x -f`.
  - `registry.ts`: đúng I1, thứ tự `[superpowers, bmad]`; `workflowForPluginDir` so `comparablePath(dir)` với
    `comparablePath(pinDir(...))` (bỏ `/` cuối).
  - `commands/workflows.ts`: `list`, `install` như Step 3. `cli.ts`: `case 'workflows': return workflowsCommand(ctx, rest)`;
    usage `crew-mac workflows list [--json] | install | gc`.
  - `setup.ts`: sau `installSuperpowersPin(ctx)` gọi `installBmadPin(ctx)`; kết quả thêm `bmad`; in thêm dòng `extraArgs`
    vai bmad. `doctor.ts`: check `bmad-pin` (title `BMAD <version> đã ghim`), `agent-uv` (title `uv trong PATH của sshd agent`).
  - `context.ts`/`context-factory.ts`: `bmadPin: WorkflowPin` (CLI: `BMAD_PIN`).
- [ ] **Step 6: Chạy lại test Step 4** → PASS; chạy cả `pnpm --filter @crew/mac test` (gói nhỏ, dưới 1 phút) để chắc
  ca cũ của `superpowersPinDir`/`setup`/`doctor`/`status` không vỡ.
- [ ] **Step 7: Docs.** `docs/flows/mac-workflows.md`: đổi tiêu đề thành "Ghim Superpowers và BMAD, chặn nạp chéo trên
  Mac"; mục Mục đích thêm BMAD (nguồn, revision, lắp một plugin, vì sao không theo HEAD marketplace); bước 1–2 thêm
  `bmad-pin.ts`, `bmad-install.ts`, `registry.ts`; mục "Nâng bản" thêm BMAD; bảng Files thêm file mới. `mac-setup.md`:
  `setup` cài cả hai, in hai `extraArgs`; `workflows list|install`; doctor `bmad-pin`, `agent-uv`. `flows.yaml` khối
  `mac-workflows`: `title` mới, `entrypoints` thêm `src/commands/workflows.ts`, `files` thêm 3 file, `tests` thêm 3 file.
  `crew-docs generate`.
- [ ] **Step 8: Commit.**

```bash
git add apps/crew-mac docs
git commit -m "feat(crew-mac): ghim BMAD cạnh Superpowers và công bố workflow đã chứng nhận"
```

---

### Task 2 (MW-2): Cách ly theo workflow của run

**Files:**
- Modify: `src/workflows/inventory.ts`, `src/workflows/run-init.ts`, `src/workflows/policy.ts` (nếu cần
  `samePin` cho pin bất kỳ), `src/commands/workflow-check.ts`, `assets/crew-claude-run.sh`,
  `test/{workflows-inventory,workflow-check,crew-claude-run}.test.ts`, `docs/flows/{mac-workflows,mac-setup}.md`

**Interfaces:**
- Consumes: I1 (`certifiedWorkflows`, `workflowForPluginDir`, `pinDir`, `ctx.bmadPin`).
- Produces: I3, I4. `workflowCheck(ctx, { root, pluginDir })` (bỏ tham số `pin`; test dùng `ctx.superpowersPin`/
  `ctx.bmadPin` giả). `DiscoveredSource.kind` thêm `'bmad'`.

- [ ] **Step 1: Test nguồn** (`workflows-inventory.test.ts`, repo git thật tạm, HOME giả có thư mục ghim BMAD giả dựng
  bằng helper `seedBmadPinDir(home, pin)` với `skills/bmad/scripts/{setup,resolve_config}.py`):

```ts
it('run BMAD: repo bật superpowers trong enabledPlugins thì chặn nạp chéo', async () => {
  commitFile(repo, '.claude/settings.json', JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } }));
  const s = await discoverSources(ctx, repo, ctx.bmadPin);
  expect(s).toContainEqual(expect.objectContaining({ kind: 'plugin', origin: 'blocked', reason: 'bật workflow superpowers khác với workflow của run (nạp chéo)' }));
});
it('run Superpowers: repo bật bmad-method@bmad thì chặn; superpowers vẫn pinned', async () => { /* hai key trong cùng settings */ });
it('run BMAD: _bmad/scripts đã commit giống byte bản ghim → project; khác một byte → blocked BMAD_SCRIPT_MISMATCH_REASON kèm fix', async () => {});
it('run BMAD: _bmad/scripts chưa commit nhưng giống byte → pinned (run trước bị ngắt)', async () => {});
it('run BMAD: _bmad/config.toml chưa track → blocked UNTRACKED_REASON; sửa dở → blocked DIRTY_REASON', async () => {});
it('run BMAD: _bmad/custom/bmad-prd.user.toml chưa track → blocked BMAD_PERSONAL_REASON; đã commit sạch → project', async () => {});
it('run BMAD: _bmad/memory/** và _bmad-output/** không phải nguồn nạp, không xét', async () => {});
it('run Superpowers: _bmad/ lạ chưa track không ảnh hưởng (không có nguồn nào kind bmad)', async () => {});
it('repo chỉ có _bmad (không .claude, không .mcp.json): run BMAD vẫn gọi git và xét _bmad', async () => {});
```

- [ ] **Step 2: Test kiểm run** (`workflow-check.test.ts`):
  - `--plugin-dir` = thư mục ghim BMAD, repo sạch → ok, dòng đầu đúng I3
    `crew-workflow ok pin=bmad@<v> rev=<rev12> sum=<checksum12> project=0 pinned-dup=0`; với Superpowers dòng cũng có
    `rev=`/`sum=`.
  - `--plugin-dir` marketplace/cache → blocked câu I3 liệt kê cả hai thư mục ghim.
  - Thư mục ghim BMAD sửa một byte → `WORKFLOW_SOURCE_MISMATCH`.
  - `runInitCheck` với init giả: plugin `bmad` path thư mục ghim + skill `bmad:bmad-prd` → 0; thêm plugin
    `superpowers` (path cache owner) → 78 `nạp nhiều hơn một workflow`; không plugin ghim nào → 78
    `không nạp workflow ghim nào`; plugin `bmad` path marketplace, version đúng, checksum khác → 78
    `WORKFLOW_SOURCE_MISMATCH`. Ca cũ của Superpowers (fixture `paperclip-run-init.json`) vẫn 0.
- [ ] **Step 3: Test wrapper** (`crew-claude-run.test.ts`, `CREW_MAC_BIN`/`CREW_CLAUDE_BIN` giả như ca hiện có):
  - Hai `--plugin-dir` → 78, stderr có `cần đúng một --plugin-dir (bản workflow đã ghim)`.
  - `workflow-check` giả thoát 0 → có file `<plugin_dir>/.in_use/<runId>` nội dung `^\d+ \d+\n$`, pid = pid của
    process `claude` giả (script giả in `$$`), và `.paperclip-runtime/runs/<runId>/{pgid,started}` như cũ.
  - `PAPERCLIP_RUN_ID` có ký tự lạ → không ghi `.in_use`.
  - `.in_use` không ghi được (plugin dir chỉ đọc) → vẫn chạy agent (không chặn run).
- [ ] **Step 4: Chạy** `pnpm --filter @crew/mac test -- test/workflows-inventory.test.ts test/workflow-check.test.ts test/crew-claude-run.test.ts` → FAIL.
- [ ] **Step 5: Cài.**
  - `inventory.ts`:
    - export 3 hằng số lý do I4; `DiscoveredSource.kind` thêm `'bmad'`.
    - `discoverSources(ctx, root, pin)`: `pinDir` từ `pinDir(ctx.home, pin)`; `hasSources` thêm
      `pin.workflow === 'bmad' && existsSync(join(root, '_bmad'))`; pathspec của `readGit` thêm `_bmad` khi pin là bmad.
    - `enabledPlugins`: lấy `certifiedWorkflows(ctx)`; key khớp `pluginKeys` của `pin.workflow` → `pinned`; khớp workflow
      khác → `blocked` `CROSS_WORKFLOW_REASON` với fix
      `Bỏ "<key>" khỏi enabledPlugins của .claude/settings.json (commit), hoặc giao issue cho agent của workflow <id>.`;
      còn lại như cũ.
    - Khi pin là bmad: `judgeBmad(root, git, pinDir)`:
      - `_bmad/scripts/**` (mọi file, bỏ `isJunk`): so byte với `<pinDir>/skills/bmad/scripts/<cùng đường>`, và tập file
        hai bên bằng nhau; khác → một nguồn `blocked` `BMAD_SCRIPT_MISMATCH_REASON` (path = `_bmad/scripts`, fix
        `Xem: git -C <root> status -- _bmad/scripts; khôi phục: git -C <root> checkout HEAD -- _bmad/scripts, hoặc xóa _bmad/scripts rồi chạy crew-mac bmad setup-project.`);
        giống → `project` nếu mọi file tracked sạch, `pinned` nếu có file chưa track.
      - `_bmad/config.toml`, `_bmad/custom/**/*.toml` không đuôi `.user.toml`: `judge(path, 'bmad', [path])` với luật
        chặn như settings (không phải warnOnly).
      - `_bmad/**/*.user.toml`: chưa track/ignore/sửa dở → `blocked` `BMAD_PERSONAL_REASON`, fix
        `xóa file đó (lớp cá nhân không dùng trong run agent), hoặc commit nếu cố ý dùng cho cả nhóm`.
  - `workflow-check.ts`: `workflowCheck(ctx, { root, pluginDir })` tìm `workflowForPluginDir`; null → blocked I3; có thì
    kiểm checksum/bit thực thi của pin đó, `discoverSources(ctx, root, wf.pin)`, dòng ok I3.
  - `run-init.ts`: `checkInitEvent(init, allow)` giữ chữ ký; `runInitCheck` chọn pin: duyệt `plugins` không `@builtin`,
    tên thuộc `{superpowers, bmad}`; 0 → vi phạm `không nạp workflow ghim nào`; > 1 tên khác nhau → `nạp nhiều hơn một
    workflow (<a>, <b>)`; đúng 1 → `allow.pin` = pin đó, `allow.pinDir` = `pinDir(...)`, `projectPlugins` bỏ key thuộc
    workflow khác. Câu `không nạp Superpowers từ bản ghim` thành `không nạp <id> từ bản ghim <dir>`.
  - `assets/crew-claude-run.sh`: đổi câu lỗi theo I3; trong nhánh `case "$PAPERCLIP_RUN_ID"` hợp lệ, sau khi ghi
    `started`:

```sh
        if mkdir -p "$plugin_dir/.in_use" 2>/dev/null; then
          printf '%s %s\n' "$$" "$(cat "$dir/started" 2>/dev/null || echo 0)" > "$plugin_dir/.in_use/$PAPERCLIP_RUN_ID.tmp" 2>/dev/null \
            && mv "$plugin_dir/.in_use/$PAPERCLIP_RUN_ID.tmp" "$plugin_dir/.in_use/$PAPERCLIP_RUN_ID" 2>/dev/null
        fi
```

    (`$$` là pid sẽ `exec claude`; lỗi ghi không chặn run.)
- [ ] **Step 6: Chạy lại** test Step 4 → PASS; `pnpm --filter @crew/mac test` toàn gói (ca cũ inventory/doctor dùng
  pin Superpowers).
- [ ] **Step 7: Docs.** `mac-workflows.md`: bảng "Phân loại nguồn" thêm 5 dòng (nạp chéo `enabledPlugins`; `_bmad/scripts`
  giống/khác byte; `_bmad/config.toml`/`custom`; `*.user.toml`); bước 5 wrapper thêm `.in_use`; bước 6 dòng ok mới;
  bước 8 `run-init-check` tự nhận pin; mục "Đọc log khi run bị chặn" thêm 3 lý do mới và cách sửa. `mac-setup.md`: câu
  lỗi mới của wrapper.
- [ ] **Step 8: Commit** `feat(crew-mac): mỗi run chỉ nạp một workflow đã ghim, chặn nạp chéo và kiểm _bmad`.

---

### Task 3 (MW-3): `crew-mac bmad stories|setup-project`

**Files:**
- Create: `src/bmad/{epics,answers,setup-project}.ts`, `src/commands/bmad.ts`,
  `test/{bmad-epics,bmad-answers,bmad-setup-project,bmad-command}.test.ts`,
  `test/fixtures/bmad/{epics-ok,epics-gap,epics-wrong-epic,epics-no-ac,epics-31}.md`
- Modify: `src/cli.ts` (`case 'bmad'`), `src/index.ts`, `docs/flows/{mac-workflows,mac-setup}.md`, `docs/flows.yaml`
  (khối `mac-workflows`: `entrypoints` + `src/commands/bmad.ts`, `files` + 3 file, `tests` + 4 file), `docs/files.md`

**Interfaces:**
- Consumes: I1 (`pinDir`, `ctx.bmadPin`), `ctx.runner`.
- Produces: I5 nguyên văn; `bmadCommand(ctx, argv): Promise<number>`.

- [ ] **Step 1: Fixture.** `epics-ok.md` theo đúng `templates/epics-template.md` của BMAD: frontmatter, `## Overview`,
  `## Requirements Inventory`, `## Epic List`, `## Epic 1: Trang giới thiệu` (goal 1 dòng) với
  `### Story 1.1: Hiện thông tin` và `### Story 1.2: Ảnh đại diện`, `## Epic 2: Form liên hệ` với
  `### Story 2.1: Gửi form`; mỗi story có "As a …, I want …, So that …" và `**Acceptance Criteria:**` với hai khối
  `**Given** … **When** … **Then** … **And** …`. Các fixture lỗi chép `epics-ok.md` rồi đổi đúng một chỗ: `epics-gap`
  (1.1, 1.3), `epics-wrong-epic` (`### Story 2.1` dưới `## Epic 1`), `epics-no-ac` (story 1.2 không có
  `**Acceptance Criteria:**`), `epics-31` (31 story sinh bằng script trong test, không commit file lớn: tạo trong test).
- [ ] **Step 2: Test parser** (`bmad-epics.test.ts`):

```ts
it('đọc đúng epic/story/tiêu chí của file chuẩn', () => {
  const r = parseEpics(read('epics-ok.md'));
  expect(r.problems).toEqual([]);
  expect(r.epics.map((e) => [e.n, e.title, e.storyKeys])).toEqual([[1, 'Trang giới thiệu', ['1.1', '1.2']], [2, 'Form liên hệ', ['2.1']]]);
  expect(r.stories[0]).toMatchObject({ key: '1.1', epic: 1, seq: 1, title: 'Hiện thông tin' });
  expect(r.stories[0].acceptance[0]).toMatch(/^Given .+; When .+; Then .+/);   // ** bị bỏ, một tiêu chí một dòng
  expect(r.stories[0].body).toContain('As a');
});
it.each([
  ['epics-gap.md', 'story 1.3: số thứ tự phải là 1.2'],
  ['epics-wrong-epic.md', 'story 2.1 nằm dưới Epic 1'],
  ['epics-no-ac.md', 'story 1.2: thiếu Acceptance Criteria'],
])('%s → %s', (file, problem) => expect(parseEpics(read(file)).problems).toContain(problem));
it('quá 30 story', () => expect(parseEpics(make31()).problems).toContain('31 story, vượt trần 30'));
it('không có epic nào', () => expect(parseEpics('# x\n').problems).toContain('không có "## Epic N: <tên>" nào'));
it('heading trong khối code bị bỏ qua', () => { /* ```md\n## Epic 9: giả\n``` không thành epic */ });
it('CRLF và khoảng trắng cuối dòng vẫn đọc đúng', () => {});
```

  Câu vấn đề (cố định, dùng trong I5): `không có "## Epic N: <tên>" nào`; `epic <n>: số thứ tự phải là <k>`;
  `story <N.M>: số thứ tự phải là <N.k>`; `story <N.M> nằm dưới Epic <k>`; `story <N.M>: thiếu Acceptance Criteria`;
  `story <N.M>: tên rỗng hoặc dài hơn 200 ký tự`; `epic <n>: không có story nào`; `<n> story, vượt trần 30`.
- [ ] **Step 3: Test luật câu trả lời** (`bmad-answers.test.ts`, port ca từ v2 `bmad-schemas`): khóa `user_name`,
  `user_skill_level` bị từ chối; `communication_language`/`document_output_language` chỉ nhận khi `allowLanguage` và giá
  trị là tên ngôn ngữ (`Vietnamese`); khóa khớp `/(token|secret|password|passwd|credential|api_?key|private)/i` bị từ
  chối; giá trị bắt đầu `/` hoặc `~`, chứa `..` như đoạn đường dẫn, ký tự điều khiển, dài hơn 500 → từ chối; giá trị có
  `{project-root}/…` hợp lệ.
- [ ] **Step 4: Test setup-project** (`bmad-setup-project.test.ts`, `FakeRunner`):
  - Đã có `_bmad/scripts/resolve_config.py` → `skipped`, không gọi `uv`.
  - `uv` thiếu (`command -v uv` lỗi) → ném `SetupError` `thiếu uv trong PATH`.
  - Luồng đạt: runner trả JSON câu hỏi đúng mẫu `probe-report.md` A2 cho lệnh `--list-config-questions`; kiểm lệnh thứ hai
    có cờ câu trả lời (tên cờ theo A2) trỏ file tạm mode 0600 nằm ngoài `root`, file tạm bị xóa sau; giả `setup.py` ghi
    `_bmad/scripts/*` (chép từ thư mục ghim giả) và `_bmad/config.toml` → `ok`, `files` sắp xếp.
  - `setup.py` ghi thêm `_bmad/config.user.toml` → file đó bị xóa, không có trong `files`.
  - Script sau setup khác bản ghim → `SetupError` `script _bmad sau setup khác bản ghim`.
  - Câu hỏi có `default` vi phạm `checkBmadAnswers` → `SetupError` `câu trả lời BMAD không hợp lệ: <module>.<key>` và
    không chạy lệnh setup.
- [ ] **Step 5: Test lệnh** (`bmad-command.test.ts`, repo git thật tạm):
  - `bmad stories --root <repo> --file docs/epics.md --json` (file trên đĩa) → 0, JSON đúng I5, `digest` = sha256 bytes,
    `scriptsMatchPin: null` khi không có `_bmad/scripts`.
  - `--rev <sha>`: đọc nội dung ở commit (sửa file trên đĩa sau commit, kết quả vẫn theo commit); `scriptsMatchPin` theo
    `git ls-tree -r <sha> _bmad/scripts` + `git show` từng blob so với bản ghim giả; khác → `false`, thoát 3.
  - Thoát 2: `--file /etc/x.md`, `--file ../x.md`, `--file a.txt`, `--rev abc`, `--rev <40 hex không tồn tại>`, file không
    có. Thoát 3 với fixture lỗi; dòng `crew-bmad problem: …`.
  - Không `--json`: dòng đầu `crew-bmad stories file=… epics=2 stories=3 digest=<64> scripts=none`.
  - `bmad setup-project --root <repo>` in đúng I5; lỗi → thoát 1, một dòng `crew-bmad setup: <câu>`.
- [ ] **Step 6: Chạy** `pnpm --filter @crew/mac test -- test/bmad-epics.test.ts test/bmad-answers.test.ts test/bmad-setup-project.test.ts test/bmad-command.test.ts` → FAIL.
- [ ] **Step 7: Cài.**
  - `epics.ts`: chuẩn hóa `\r\n` → `\n`; bỏ dòng trong khối ``` ; quét heading bằng
    `/^## Epic (\d+):\s*(.+?)\s*$/` và `/^### Story (\d+)\.(\d+):\s*(.+?)\s*$/`; `goal` = đoạn văn đầu sau heading epic;
    `body` = toàn bộ markdown của story tới heading kế (`#{1,3} `), cắt khoảng trắng; tiêu chí: sau dòng
    `**Acceptance Criteria:**`, mỗi dòng bắt đầu `**Given**` mở một tiêu chí, dòng `**When**`/`**Then**`/`**And**` nối vào
    tiêu chí đang mở bằng `; `, bỏ `**`; dòng `- …` là một tiêu chí riêng.
  - `answers.ts`: port nguyên regex/luật của v2 `bmad-schemas.ts` (ghi một dòng comment nguồn
    `// Port luật từ my-crew packages/shared/src/bmad-schemas.ts (v2).`), không dùng zod.
  - `setup-project.ts`: `S = <pinDir>/skills/bmad`; `uv run --no-cache <S>/scripts/setup.py --project-root <root> --skill <S> --list-config-questions`
    (timeout 120 giây, env thêm `NO_COLOR=1`); dựng câu trả lời (`default`; ngôn ngữ = `Vietnamese`); `checkBmadAnswers`;
    ghi TOML `[modules."<m>"]` vào `mkdtemp(os.tmpdir())/answers.toml` 0600; chạy setup (cờ theo A2); xóa file tạm; xóa
    `_bmad/**/*.user.toml`; so `_bmad/scripts` với `<S>/scripts` (bỏ `tests/` nếu A2 ghi setup không chép `tests/`);
    `files` = `git status --porcelain --untracked-files=all -- _bmad` (đường dẫn).
    **Đường dự phòng A2** (khi G0 ghi A2 không đạt): không tạo `setup-project.ts` và lệnh con `setup-project`; bỏ Step 4;
    `bmad.md` theo nhánh dự phòng ở [fork.md](fork.md).
  - `commands/bmad.ts`: phân tích đối số, kiểm đường dẫn (tương đối, không `..`, đuôi `.md`), `--rev` regex
    `^[0-9a-f]{40}$` + `git cat-file -e <rev>^{commit}`; `scriptsMatchPin` dùng chung hàm so byte với MW-2 (export từ
    `inventory.ts`: `compareBmadScripts(files: Map<string, Buffer>, pinDir): boolean`); in theo I5.
  - `cli.ts`: `case 'bmad': return bmadCommand(ctx, rest)`; usage
    `crew-mac bmad stories --root <dir> --file <file.md> [--rev <sha>] [--json] | setup-project --root <dir>`.
- [ ] **Step 8: Chạy lại** → PASS; toàn gói.
- [ ] **Step 9: Docs.** `mac-workflows.md` thêm mục "BMAD trong repo dự án" (setup-project, file nào phải commit, luật
  `_bmad/`) và "Đọc file epic/story" (định dạng, câu vấn đề, mã thoát, `crew-bmad-result`); bảng Files; Tests.
  `mac-setup.md`: usage mới. `flows.yaml`, `crew-docs generate`.
- [ ] **Step 10: Commit** `feat(crew-mac): đọc file epic/story BMAD và dựng _bmad cho dự án`.

---

### Task 4 (MW-4): Dọn bản ghim cũ

**Files:**
- Create: `src/workflows/workflow-gc.ts`, `test/workflows-gc.test.ts`
- Modify: `src/commands/workflows.ts` (`gc`), `src/commands/setup.ts` (gọi GC cuối), `src/reaper/reap.ts` (gọi GC tối đa
  mỗi giờ), `test/reaper-reap.test.ts` (ca gọi GC), `docs/flows/{mac-workflows,mac-orphan-reaper}.md`, `docs/flows.yaml`
  (khối `mac-workflows`: `files` + `workflow-gc.ts`, `tests` + `workflows-gc.test.ts`), `docs/files.md`

**Interfaces:**
- Consumes: I1 (`certifiedWorkflows`, `pinDir`), I2 (`.in_use`).
- Produces:

```ts
export interface WorkflowGcReport { removed: string[]; kept: Array<{ dir: string; reason: 'current' | 'in_use' | 'recent' }> }
export function gcWorkflowPins(ctx: MacContext, opts?: { isAlive?: (pid: number) => boolean }): WorkflowGcReport;
export const WORKFLOW_GC_INTERVAL_MS = 60 * 60 * 1000;
export const WORKFLOW_GC_RECENT_MS = 24 * 60 * 60 * 1000;
export const IN_USE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
```

- [ ] **Step 1: Test** (`workflows-gc.test.ts`, HOME giả, `ctx.now` cố định, `isAlive` giả):
  1. Thư mục hiện hành của cả hai workflow luôn `kept: current`, kể cả không có `.in_use`.
  2. `bmad/6.12.0-aaaaaaaaaaaa` có `.in_use/<uuid>` = `"4242 1760000000\n"`, `isAlive(4242) = true` → `in_use`.
  3. Cùng thư mục, pid chết, mtime thư mục và dấu lùi 25 giờ → dấu bị xóa rồi thư mục bị xóa (`removed`).
  4. Pid chết nhưng thư mục đổi trong 24 giờ → dấu xóa, thư mục `recent`.
  5. Dấu không parse được (`"abc"`) → coi như sống (`in_use`) cho tới khi dấu cũ hơn 7 ngày thì xóa dấu.
  6. Thư mục `*.tmp-*` không bị GC đụng (việc của install).
  7. Thư mục lạ không theo mẫu `<version>-<12 hex>` dưới `workflows/<id>/` → giữ (không xóa thứ không nhận ra).
  8. Gọi hai lần liên tiếp không lỗi khi thư mục đã mất giữa chừng (`ENOENT` bỏ qua).
  9. `workflows gc` in `Đã dọn: <n> bản ghim cũ` và từng thư mục; thoát 0.
  10. `reap` gọi GC khi `~/.crew/state/workflows-gc.stamp` cũ hơn 1 giờ hoặc chưa có, rồi chạm stamp; stamp mới thì
      không gọi (đếm lời gọi qua dependency injection hiện có của `reap`).
- [ ] **Step 2: Chạy** `pnpm --filter @crew/mac test -- test/workflows-gc.test.ts test/reaper-reap.test.ts` → FAIL.
- [ ] **Step 3: Cài** `workflow-gc.ts` theo test; `isAlive` mặc định `(pid) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } }`;
  xóa bằng `rmSync(dir, { recursive: true, force: true })` sau khi kiểm `lstat` không phải symlink. `setup.ts` và
  `workflows install` gọi `gcWorkflowPins(ctx)` sau khi cài, in `Đã dọn …` khi `removed` khác rỗng. `reap.ts` gọi trong
  `try/catch` (lỗi GC chỉ log, không làm hỏng lượt reap).
- [ ] **Step 4: Chạy lại** → PASS; toàn gói.
- [ ] **Step 5: Docs.** `mac-workflows.md` mục "Pin theo run và dọn bản cũ" (dấu `.in_use`, luật giữ/xóa, khi nào chạy);
  `mac-orphan-reaper.md` một bước: `reap` gọi `gcWorkflowPins` tối đa mỗi giờ. `flows.yaml`, `crew-docs generate`.
- [ ] **Step 6: Commit** `feat(crew-mac): dọn bản workflow ghim cũ khi không còn run dùng`.
