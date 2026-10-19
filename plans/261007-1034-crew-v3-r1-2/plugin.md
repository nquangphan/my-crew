# Gói `plugin` — bundle `crew.core` và kiểm health sau deploy (PG-1)

Fork Paperclip, worktree `.worktrees/paperclip-r12-plugin` nhánh `crew/r12-plugin` từ `v3` (`e1c3dd2db`). Model sonnet (bám khuôn `crew/ops/`). Chuẩn bị như [policy.md](policy.md). Gói này sở hữu `packages/crew-plugin/**`, `crew/ops/**`, `crew/release/verify.sh`, `server/src/__tests__/{crew-plugin-manifest,crew-run-cancelled}.test.ts`. Không deploy trong task này (deploy ở AC-2, điểm dừng D1).

## Bối cảnh đã xác minh

- `packages/crew-plugin/package.json`: `paperclipPlugin.manifest = ./dist/manifest.js`, `worker = ./dist/worker.js`, `build = tsc`. `src/worker.ts` import `@paperclipai/plugin-sdk` và gọi `runWorker(plugin, import.meta.url)` khi import (không import thử worker được).
- `server/src/services/plugin-loader.ts`: `DEV_TSX_LOADER_PATH = …/cli/node_modules/tsx/dist/loader.mjs`; khi plugin có `packagePath` và file loader tồn tại thì `workerOptions.execArgv = ["--import", loader]`. Bundle tự đủ chạy được cả khi có lẫn không có loader.
- `esbuild` là devDependency ở `package.json` gốc fork (`^0.28.2`) và có trong image (`/app/node_modules/.bin/esbuild`, dùng ở `overlay-job.sh`). Script build của plugin import `esbuild` từ `node_modules` gốc — không đổi lockfile.
- `crew/ops/inspect-image.sh`: kiểm `crewCoreHooks` trong ba file dist, bốn file `server/dist/crew/*.js`, plugin package, **tsx loader** (thiếu → `MISSING`, `deploy.sh` từ chối), và import manifest dưới loader.
- `crew/ops/overlay-job.sh`: symlink `@paperclipai/plugin-sdk` vào `packages/crew-plugin/node_modules` (chỉ cần khi plugin không bundle).
- `crew/ops/overlay-source.sh`: `FORK=/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-r1-1` (đường dẫn cứng tới worktree đã xong), mặc định commit `crew/r1-1`.
- `crew/ops/deploy.sh`/`rollback.sh`: chỉ kiểm `/api/health` (thoát 3 khi không ok), chưa kiểm plugin.
- `server/src/routes/plugins.ts`: `GET /plugins/:pluginId/health` nhận cả UUID lẫn plugin key (`crew.core`), trả `PluginHealthCheckResult { pluginId, status, healthy, checks[], lastError? }`.
- `server/src/__tests__/crew-run-cancelled.test.ts`: issue thử tên `"cancelled run returns the issue to todo"` trong khi hành vi đúng là `blocked`.

## Task PG-1

**Files:**
- Create: `packages/crew-plugin/build.mjs`
- Modify: `packages/crew-plugin/package.json` (`scripts.build`)
- Modify: `crew/ops/inspect-image.sh`, `crew/ops/overlay-job.sh`, `crew/ops/overlay-source.sh`, `crew/ops/deploy.sh`, `crew/ops/rollback.sh`
- Modify: `crew/release/verify.sh`
- Modify: `server/src/__tests__/crew-plugin-manifest.test.ts`, `server/src/__tests__/crew-run-cancelled.test.ts`

**Interfaces:**
- Consumes: danh sách file crew trong image (interface ở [plan.md](plan.md)): `core-hooks remote-stop load-gate ssh-in-place issue-policy issue-gate issue-create-policy retry-progress`.
- Produces: `dist/manifest.js`, `dist/worker.js` tự đủ (không còn `import … "@paperclipai/…"`); `inspect-image.sh` in `plugin bundle ok; manifest crew.core <capabilities>`; `deploy.sh` in `plugin crew.core healthy` hoặc thoát **6** khi plugin không healthy sau 60 giây; `rollback.sh` in trạng thái plugin.

- [ ] **Step 1: Test thất bại cho bundle** — thêm vào `server/src/__tests__/crew-plugin-manifest.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/crew-plugin");

describe("bundle plugin Crew", () => {
  it("dist tự đủ: không còn import @paperclipai/* và manifest giống bản nguồn", async () => {
    execFileSync(process.execPath, ["build.mjs"], { cwd: pluginDir, stdio: "pipe" });
    for (const file of ["dist/worker.js", "dist/manifest.js"]) {
      const text = readFileSync(path.join(pluginDir, file), "utf8");
      expect(text, file).not.toMatch(/from\s*["']@paperclipai\//);
      expect(text, file).not.toMatch(/import\(\s*["']@paperclipai\//);
    }
    const built = (await import(path.join(pluginDir, "dist/manifest.js"))).default;
    expect(built).toEqual(manifest);
  }, 60_000);
});
```

- [ ] **Step 2: Chạy, kỳ vọng FAIL**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-plugin-manifest.test.ts`
Expected: FAIL `Cannot find module …/build.mjs`.

- [ ] **Step 3: Viết `packages/crew-plugin/build.mjs`** và đổi script

```js
// Bundles the Crew plugin into self-contained ESM files, so the Paperclip image does not need
// the dev tsx loader or TypeScript sources of workspace packages to run it.
import { build } from "esbuild";

await build({
  entryPoints: ["src/manifest.ts", "src/worker.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outdir: "dist",
  logLevel: "warning",
  banner: {
    js: "import { createRequire as __crewCreateRequire } from 'node:module'; const require = __crewCreateRequire(import.meta.url);",
  },
});
```

`packages/crew-plugin/package.json`: `"build": "node build.mjs"` (giữ `"typecheck": "tsc --noEmit"`).

- [ ] **Step 4: Chạy, kỳ vọng PASS**

Run: `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-plugin-manifest.test.ts src/__tests__/crew-run-cancelled.test.ts`
Run: `corepack pnpm --filter @crew/paperclip-plugin typecheck`
Expected: PASS. Nếu bundle còn import `@paperclipai/…` do SDK dùng `import()` động, ghi tên module vào báo cáo và thêm module đó vào `bundle` (không `external`).

- [ ] **Step 5: Sửa tên issue thử** trong `crew-run-cancelled.test.ts`: `"cancelled run returns the issue to todo"` → `"cancelled run moves the issue to blocked"`; mọi tên `it(...)` trong file còn chữ `todo` mà kỳ vọng `blocked` cũng đổi theo hành vi thật. Chạy lại Step 4.

- [ ] **Step 6: `crew/ops/inspect-image.sh`** — thay toàn bộ thân bằng:

```sh
#!/bin/sh
# Checks a built overlay image before deploy. Usage: inspect-image.sh <image-tag>
# The plugin is a self-contained esbuild bundle: it must import with plain node, without the tsx loader.
docker run --rm --entrypoint sh "$1" -c '
  S=/app/server/dist/services
  for f in heartbeat environment-runtime issues; do printf "%s crewCoreHooks=%s\n" "$f" "$(grep -c crewCoreHooks "$S/$f.js")"; done
  for f in core-hooks remote-stop load-gate ssh-in-place issue-policy issue-gate issue-create-policy retry-progress; do
    [ -f "/app/server/dist/crew/$f.js" ] && echo "crew/$f.js ok" || echo "crew/$f.js MISSING"
  done
  P=/app/packages/crew-plugin
  for f in package.json dist/manifest.js dist/worker.js; do [ -f "$P/$f" ] && echo "plugin $f ok" || echo "plugin $f MISSING"; done
  if grep -q -E "from ?[\"\x27]@paperclipai/" "$P/dist/worker.js" "$P/dist/manifest.js" 2>/dev/null; then echo "plugin bundle FAIL: still imports @paperclipai/*"; fi
  cd "$P" && node --input-type=module -e "import(\"./dist/manifest.js\").then((m) => console.log(\"plugin bundle ok; manifest \" + m.default.id + \" \" + m.default.capabilities.join(\",\")), (e) => console.log(\"plugin bundle FAIL \" + e.message))"
'
```

Kiểm thêm `issues crewCoreHooks=` phải ≥ 2 (H2 + H4): sửa `deploy.sh` (Step 9) từ chối khi `issues crewCoreHooks=0` hoặc `=1`.

- [ ] **Step 7: `crew/ops/overlay-job.sh`** — xóa hai dòng `mkdir -p /app/packages/crew-plugin/node_modules/@paperclipai; \` và `ln -sfn /app/packages/plugins/sdk …; \` trong Dockerfile heredoc; giữ `chown -R node:node "/app/server/$OUT" /app/packages/crew-plugin`.

- [ ] **Step 8: `crew/ops/overlay-source.sh`** — thay hai dòng đầu biến:

```bash
FORK=$(cd "$(dirname "$0")/../.." && pwd -P)
BASE=v2026.1001.0
COMMIT=$(git -C "$FORK" rev-parse "${1:-HEAD}")
```

và comment usage: `Usage: overlay-source.sh [<commit>] (default HEAD of the fork worktree this script lives in)`. Bước build plugin giữ `corepack pnpm --filter @crew/paperclip-plugin build` (giờ là esbuild).

- [ ] **Step 9: `crew/ops/deploy.sh`** — sau dòng `INSPECT=…`/kiểm `MISSING|FAIL`, thêm:

```bash
if printf '%s\n' "$INSPECT" | grep -q -E '^issues crewCoreHooks=[01]$'; then echo "deploy: issues.js lacks the H2/H4 hooks, refusing to deploy" >&2; exit 4; fi
```

Sau khối chờ `/api/health` ok (trước dòng `echo "deploy ok: …"`):

```bash
P=""
for i in $(seq 1 30); do
  P=$("$ROOT/api.sh" GET /plugins/crew.core/health 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print("healthy" if d.get("healthy") else d.get("status") or "unknown")' 2>/dev/null || true)
  [ "$P" = healthy ] && break
  sleep 2
done
[ "$P" = healthy ] || { echo "deploy: plugin crew.core not healthy (${P:-no answer}), run ops/rollback.sh $TS" >&2; exit 6; }
echo "plugin crew.core healthy"
```

Trước khi viết, đọc `/opt/crew-v3-spike/api.sh` trên VPS (`ssh nhamoiplatform 'cat /opt/crew-v3-spike/api.sh'`, chỉ đọc) để chắc cú pháp `api.sh <METHOD> <path>` và tiền tố `/api`; lệch thì sửa lời gọi cho khớp và ghi vào báo cáo. Comment đầu file thêm mã thoát 6.

- [ ] **Step 10: `crew/ops/rollback.sh`** — sau dòng `echo "rollback: server image …"`, thay dòng nhắc plugin bằng:

```bash
P=$("$ROOT/api.sh" GET /plugins/crew.core/health 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print("healthy" if d.get("healthy") else d.get("status") or "unknown")' 2>/dev/null || true)
echo "rollback: plugin crew.core ${P:-unknown}; if it is in error on an image without the bundle, disable it (POST /plugins/crew.core/disable)"
```

- [ ] **Step 11: `crew/release/verify.sh`** — sau `run 6 corepack pnpm --filter @crew/paperclip-plugin exec tsc --noEmit` thêm `run 6 corepack pnpm --filter @crew/paperclip-plugin build`.

- [ ] **Step 12: Kiểm script** — `sh -n crew/ops/inspect-image.sh && bash -n crew/ops/deploy.sh crew/ops/rollback.sh crew/ops/overlay-job.sh crew/ops/overlay-source.sh crew/release/verify.sh` (không lỗi cú pháp). Không chạy deploy/rollback.

- [ ] **Step 13: Commit**

```bash
git add packages/crew-plugin/build.mjs packages/crew-plugin/package.json crew/ops/inspect-image.sh crew/ops/overlay-job.sh \
  crew/ops/overlay-source.sh crew/ops/deploy.sh crew/ops/rollback.sh crew/release/verify.sh \
  server/src/__tests__/crew-plugin-manifest.test.ts server/src/__tests__/crew-run-cancelled.test.ts
git commit -m "build(crew): ship the Crew plugin as a self-contained bundle and check its health after deploy"
```

`packages/crew-plugin/dist/` không commit (đã nằm trong `.gitignore` của fork; kiểm `git status` không thấy `dist/`).

## Rủi ro và rollback

| Rủi ro | Khả năng × tác động | Giảm thiểu |
|---|---|---|
| SDK dùng `require` động hoặc file JSON ngoài bundle | Trung bình × Trung bình | Banner `createRequire`; test import manifest; `inspect-image` import bằng node thường |
| Health plugin chưa `healthy` trong 60 giây sau restart | Thấp × Thấp | Thoát 6 kèm lệnh rollback; owner quyết |
| `api.sh` khác cú pháp giả định | Trung bình × Thấp | Step 9 đọc file thật trước khi viết |

Rollback: `crew/ops/rollback.sh <TS>` về image trước (`in-place-6ab1aa8` vẫn giữ theo ruling R1-1); revert commit để quay lại build `tsc` + symlink SDK.
