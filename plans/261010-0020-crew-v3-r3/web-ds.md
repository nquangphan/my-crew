# Crew v3 R3: gói `ds` (DS-1..DS-4), kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khung `packages/crew-web` cho mọi màn hình khác. Gồm design system (token, component clone, widget), lớp hai ngôn ngữ, shell, router, client REST/plugin, đăng nhập và `/cli-auth`.

**Architecture:**
- Vite 8 + React 19 SPA. Build ra `dist/`, OP-1 chép vào `server/ui-dist`.
- Route và locale gom bằng `import.meta.glob` theo feature (plan I5), nên các gói khác không phải sửa file của gói này.
- Component clone từ `ui/src/components/ui/*` @ `v2026.1005.0`, mỗi file ghi nguồn ở dòng đầu.

**Tech Stack:** react 19.2, react-dom, react-router-dom 7.18, @tanstack/react-query 5.102, tailwindcss 4.3 + @tailwindcss/vite, radix-ui, class-variance-authority, clsx, tailwind-merge, lucide-react, i18next 26 + react-i18next 17, react-markdown 10 + remark-gfm 4, @xyflow/react 12 (DS-4), vitest 4 + jsdom + @testing-library/react (dev), typescript 7. Mọi bản lấy đúng range trong `ui/package.json` để dùng chung lockfile.

**Spec:** [plan.md](plan.md) (Global Constraints, Lệch 1, 2, 4, Review Focus 3, 4, Interface I5, I6, I8) và spec §4.1–4.4.

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng gói này:

- Chỉ ghi `packages/crew-web/` trừ `src/features/**`, `src/lib/instructions/**`, `test/features/**`, `test/lib/**`, `test/e2e-coverage.test.ts`, `e2e/**`, `playwright.config.ts`; cộng `pnpm-lock.yaml`.
- Không import `ui/src/**`, không thêm `@paperclipai/ui` vào dependency. Kiểu API import từ `@paperclipai/shared`.
- Lệnh chung (chạy trong worktree `.worktrees/paperclip-r3-ds`):
  - test: `corepack pnpm --filter @crew/paperclip-web test`
  - typecheck: `corepack pnpm --filter @crew/paperclip-web typecheck`
  - build: `CREW_UI_COMMIT=$(git rev-parse HEAD) corepack pnpm --filter @crew/paperclip-web build`
  - lint: `npx biome check packages/crew-web`
- Mỗi ticket bắt đầu bằng `git merge --ff-only crew/r3`.

---

### Task 1 (DS-1): Khung package, token, component clone, luật design system

**Files:**
- Create:
  - `packages/crew-web/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`
  - `src/main.tsx`
  - `src/ds/tokens.css`, `src/ds/index.ts`, `src/ds/README.md`, `src/ds/cn.ts`, `src/ds/icons.ts`
  - `src/ds/components/{button,input,textarea,label,select,checkbox,toggle-switch,dialog,alert-dialog,sheet,popover,dropdown-menu,tooltip,tabs,badge,card,avatar,separator,skeleton,scroll-area,command,breadcrumb,collapsible,table,field,empty-state,error-state,spinner}.tsx`
  - `src/ds/brand/{logo.svg,Logo.tsx}`, `public/favicon.svg`
  - `src/dev/ds-page.tsx`
  - `test/guards/design-system.test.ts`, `test/ds/button.test.tsx`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces:
  - `@/ds` exports theo plan I5 (phần component);
  - `cn(...classes)`;
  - `@/ds/icons` (re-export icon lucide được phép);
  - `LAYOUT_CLASSES` trong test luật;
  - mốc `crew-ui` trong `index.html`.

- [ ] **Step 1: package.json và config**

```json
{
  "name": "@crew/paperclip-web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5183 --strictPort",
    "build": "tsc -b --noEmit && vite build",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@paperclipai/shared": "workspace:*",
    "@crew/paperclip-plugin": "workspace:*"
  }
}
```

- Thêm `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `i18next`, `react-i18next`, `react-markdown`, `remark-gfm`, `@xyflow/react` với range chép y nguyên từ `ui/package.json` (và `packages/crew-plugin/package.json` cho `@xyflow/react`).
- Dev: `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss`, `typescript`, `vitest`, `@types/react`, `@types/react-dom`, `@types/node` (range như `ui`), `jsdom`, `@testing-library/react` (bản mới nhất đã có trong lockfile nếu có; không có thì bản ổn định mới nhất). Chạy `corepack pnpm install` một lần.
- `vite.config.ts`: alias `@` → `src`; `server.proxy['/api']` → `process.env.CREW_WEB_API ?? 'http://127.0.0.1:3199'` (`ws: true`, `changeOrigin: false`); plugin `crewUiCommit()`:

```ts
function crewUiCommit(): Plugin {
  return {
    name: 'crew-ui-commit',
    transformIndexHtml(html, ctx) {
      const commit = process.env.CREW_UI_COMMIT ?? '';
      if (!ctx.server && !/^[0-9a-f]{40}$/.test(commit)) throw new Error('CREW_UI_COMMIT phải là commit 40 hex khi build');
      return html.replace('%CREW_UI_COMMIT%', commit || 'dev');
    },
  };
}
```

- `index.html` có `<meta name="crew-ui" content="%CREW_UI_COMMIT%">` và `<title>2P Crew</title>`. Không có mốc branding của Paperclip.

- [ ] **Step 2: Viết test luật design system (đỏ)**

```ts
// test/guards/design-system.test.ts
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

export const LAYOUT_CLASSES = /^(?:(?:sm|md|lg|xl):)?(?:flex|inline-flex|grid|hidden|block|contents|flex-(?:row|col|wrap|1)|grow|shrink-0|items-\w+|justify-\w+|self-\w+|gap-(?:[0-6]|8)|col-span-\d+|row-span-\d+|grid-cols-\d+|min-w-0|w-full|h-full|truncate|overflow-(?:auto|hidden))$/;
const screens = () => globSync('src/{features,app}/**/*.tsx', { cwd: process.cwd() });
const nonDs = () => globSync('src/**/*.{ts,tsx}', { cwd: process.cwd() }).filter((f) => !f.startsWith('src/ds/'));

describe('design system', () => {
  it('màn hình không dùng style inline', () => {
    const bad = screens().filter((f) => /\sstyle=\{/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('className ngoài ds chỉ dùng class bố cục', () => {
    const bad: string[] = [];
    for (const f of nonDs()) {
      for (const m of readFileSync(f, 'utf8').matchAll(/className=["'`]([^"'`]*)["'`]/g)) {
        for (const cls of m[1].split(/\s+/).filter(Boolean)) if (!LAYOUT_CLASSES.test(cls)) bad.push(`${f}: ${cls}`);
      }
      if (/className=\{(?!cn\()/.test(readFileSync(f, 'utf8'))) bad.push(`${f}: className động ngoài ds`);
    }
    expect(bad).toEqual([]);
  });
  it('ngoài ds không import thư viện UI thô', () => {
    const banned = /from ['"](radix-ui|@base-ui\/react|class-variance-authority|lucide-react)['"]/;
    expect(nonDs().filter((f) => banned.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
  it('mỗi component clone ghi nguồn', () => {
    const missing = globSync('src/ds/components/*.tsx').filter((f) => !/^\/\/ (clone: ui\/src\/components\/ui\/[\w-]+\.tsx @ v2026\.1005\.0|crew: tự dựng)/.test(readFileSync(f, 'utf8')));
    expect(missing).toEqual([]);
  });
});
```

Trong cùng file, thêm một fixture tạm `test/guards/__fixtures__/bad-screen.tsx` có `style={{color:'red'}}` và `className="text-red-500"`. Thêm ca khẳng định bộ quét bắt được fixture (dùng hàm quét có tham số danh sách file), để test không xanh vì quét rỗng.

- [ ] **Step 3: Chạy test, thấy đỏ** (`vitest run test/guards/design-system.test.ts`). Lý do đỏ: chưa có file nào, ca fixture fail vì hàm quét chưa tách. Tách hàm `scanStyle(files)`, `scanClasses(files)`, `scanImports(files)`, `scanCloneHeaders(files)` rồi cho ca thật và ca fixture cùng gọi.

- [ ] **Step 4: Token và component**
  - `tokens.css`: chép nguyên khối `:root`, `.dark`, `@theme inline` của `ui/src/index.css` và toàn bộ `ui/src/motion-tokens.css`. Đầu file `@import "tailwindcss";`. Bỏ mọi selector riêng của trang stock (chỉ giữ biến và base layer).
  - Mỗi component: copy file `ui/src/components/ui/<tên>.tsx`, dòng 1 `// clone: ui/src/components/ui/<tên>.tsx @ v2026.1005.0`, đổi import `@/lib/utils` → `../cn`, đổi icon import sang `../icons`.
  - `table, field, empty-state, error-state, spinner` tự dựng, dòng 1 `// crew: tự dựng`.
    - `Field` có `label`, `hint?`, `error?`, `children`.
    - `ErrorState` có `title`, `message?: string`, `onRetry?`. Hiện `message` nguyên văn trong `<pre>` bọc dòng. Không render HTML.
  - Brand: logo SVG chữ "2P Crew" đơn giản (một màu `currentColor`). Không dùng logo Paperclip.

- [ ] **Step 5: Trang `/ds` (dev)** `src/dev/ds-page.tsx` render mọi export của `@/ds` ở theme sáng và theme `.dark`. `main.tsx` chỉ gắn route `/ds` khi `import.meta.env.DEV`. DS-3 sẽ thay `main.tsx` bằng router thật và giữ điều kiện này.

- [ ] **Step 6: Test component tối thiểu** `test/ds/button.test.tsx`: render `Button` với `variant="destructive"`, khẳng định có class lấy từ cva và click gọi handler.

- [ ] **Step 7: Chạy test, typecheck, build.** Kỳ vọng: test xanh; `build` với `CREW_UI_COMMIT=<40 hex>` ra `dist/index.html` có `content="<commit>"`; `build` không có biến thì lỗi `CREW_UI_COMMIT phải là commit 40 hex khi build`.

- [ ] **Step 8: Commit**

```bash
git add packages/crew-web pnpm-lock.yaml
git commit -m "feat(crew-web): khung UI Crew, token và component design system"
```

---

### Task 2 (DS-2): Widget chung và lớp hai ngôn ngữ

**Files:**
- Create:
  - `src/ds/widgets/{status-badge,stage-badge,issue-row,run-row,agent-row,markdown-view,transcript,confirm-dialog,wizard,property-list,page-header,filter-bar,attachment-picker}.tsx`
  - `src/i18n/{index.ts,format.ts}`, `src/i18n/locales/{vi,en}.json`
  - `test/guards/i18n.test.ts`
  - `test/ds/{markdown-view,wizard,attachment-picker,status-badge}.test.tsx`, `test/i18n/format.test.ts`
- Modify: `src/ds/index.ts`

**Interfaces:**
- Consumes: component DS-1.
- Produces:
  - Widget theo plan I5.
  - `initI18n(): Promise<i18n>` nạp `src/i18n/locales/*.json` (namespace `common`) và `src/features/*/locales/*.json` (namespace = tên thư mục feature).
  - `useT(ns?: string)`.
  - `setLanguage(lang: 'vi' | 'en')` (ghi `localStorage['crew.lang']` trong try/catch).
  - `formatDateTime(iso, lang)`, `formatRelative(iso, lang, now?)` theo `Asia/Ho_Chi_Minh`.
- Hợp đồng widget:
  - `StatusBadge({status})`: nhãn qua `t('common:status.<status>')`.
  - `StageBadge({stage, round?, maxRounds?})`.
  - `Wizard({steps: {id, title, state: 'pending'|'running'|'done'|'failed'|'waiting', detail?}[], error?, onResume?})`.
  - `AttachmentPicker({onFiles, warnFor: (name) => string | null})`: hiện cảnh báo trước khi gửi.
  - `ConfirmDialog({title, body, confirmLabel, destructive?, requireText?, onConfirm})`.
  - `MarkdownView({markdown})`: react-markdown + remark-gfm, **không** `rehype-raw`, link ngoài `rel="noreferrer noopener" target="_blank"`.

- [ ] **Step 1: Test i18n (đỏ)**

```ts
// test/guards/i18n.test.ts
import ts from 'typescript';
// 1) key parity: với mọi cặp src/**/locales/vi.json, en.json: tập key (làm phẳng a.b.c) bằng nhau.
// 2) AST: với mọi .tsx trong src/features/**, src/app/**, src/ds/widgets/**: không có JsxText chứa /\p{L}/u sau trim,
//    không có JsxAttribute tên title|placeholder|aria-label|alt|label|confirmLabel mà giá trị là StringLiteral chứa /\p{L}/u,
//    trừ ALLOWED = new Set(['Crew', '2P Crew', 'Paperclip', 'Claude', 'VI', 'EN']).
// 3) Fixture __fixtures__/hardcoded.tsx có <p>Xin chào</p> và placeholder="Tìm" → bộ quét phải báo 2 lỗi.
```

Viết đầy đủ ba ca bằng TypeScript compiler API (`ts.createSourceFile`, duyệt `forEachChild`), giống cách tách hàm quét ở DS-1.

- [ ] **Step 2: Chạy, thấy đỏ** (fixture chưa có, `initI18n` chưa có).

- [ ] **Step 3: Cài `i18n/index.ts`**

```ts
const common = import.meta.glob('./locales/*.json', { eager: true, import: 'default' });
const features = import.meta.glob('../features/*/locales/*.json', { eager: true, import: 'default' });
export function buildResources(): Resource {
  const res: Record<'vi' | 'en', Record<string, unknown>> = { vi: {}, en: {} };
  for (const [path, data] of Object.entries(common)) res[lang(path)].common = data;
  for (const [path, data] of Object.entries(features)) res[lang(path)][path.split('/')[2]] = data;
  return res;
}
// initI18n: i18next.use(initReactI18next).init({ resources: buildResources(), lng: readLang(), fallbackLng: 'vi', defaultNS: 'common', interpolation: { escapeValue: false } })
```

`readLang()` đọc `localStorage['crew.lang']` trong try/catch, chỉ nhận `vi|en`, mặc định `vi`.

- [ ] **Step 4: `format.ts` + test** `formatDateTime('2026-10-09T17:31:26Z','vi')` → `10/10/2026 00:31`; `'en'` → `10/10/2026, 00:31`. Đều dùng `Intl.DateTimeFormat(locale, { timeZone: 'Asia/Ho_Chi_Minh', … })`.

- [ ] **Step 5: Widget + test.**
  - `markdown-view.test.tsx`: input `'<img src=x onerror="alert(1)"> **đậm**'` → DOM không có `img[onerror]`, có `<strong>`.
  - `wizard.test.tsx`: bước `failed` hiện `error` và nút "Chạy tiếp" (`t('common:wizard.resume')`) gọi `onResume`.
  - `attachment-picker.test.tsx`: `warnFor('a.zip')` trả câu thì cảnh báo hiện trước khi gửi, vẫn cho gửi.
  - `status-badge.test.tsx`: đổi `setLanguage('en')` → nhãn tiếng Anh.

- [ ] **Step 6: Locale chung** `common`: `status.*` (mọi status issue/run/agent của Paperclip), `wizard.*`, `action.*` (lưu, hủy, đóng, thử lại…), `error.*`, `time.*`. Viết `vi.json` trước, `en.json` dịch cùng key.

- [ ] **Step 7: Chạy test, typecheck, lint.** Xanh.

- [ ] **Step 8: Commit** `feat(crew-web): widget dùng chung và lớp hai ngôn ngữ`.

---

### Task 3 (DS-3): Shell, router, client API, đăng nhập, cli-auth

**Files:**
- Create:
  - `src/app/{router.tsx,providers.tsx,hooks.ts,routes-util.ts}`
  - `src/app/shell/{shell.tsx,sidebar.tsx,company-switcher.tsx,account-menu.tsx,language-switch.tsx,command-palette.tsx}`
  - `src/app/auth/{login-page.tsx,cli-auth-page.tsx,require-session.tsx}`
  - `src/app/live/live-events.ts`
  - `src/api/{http.ts,endpoints.ts,queryKeys.ts,index.ts}`
  - `src/api/paperclip/{auth,companies,issues,comments,attachments,documents,interactions,projects,agents,environments,runs,inbox,dashboard,skills,search,sidebar,cli-auth,health,profile}.ts`
  - `src/api/crew/{types.ts,data.ts,roles.ts,jobs.ts,setup.ts}`
  - `test/api/{http,endpoints}.test.ts`, `test/app/{router,company-switcher,cli-auth,login,live-events}.test.tsx`
- Modify: `src/main.tsx`, `src/i18n/locales/{vi,en}.json`

**Interfaces:**
- Consumes: DS-1, DS-2; plan I1, I2, I6 (kiểu plugin, chép trong `src/api/crew/types.ts`).
- Produces:
  - `api` (object gom theo tài nguyên, ví dụ `api.issues.list(companyId, query)`, `api.issues.patch(id, body)`).
  - `ApiError`.
  - `queryKeys`.
  - `useCompany(): { company: {id, name, issuePrefix}; companies: … }`, `useMe()`, `useLiveEvents()`.
  - `ENDPOINTS` (bảng hằng, mỗi dòng `{ id: 'S6.7', method, path }`, `id` là mã BA của nút dùng endpoint đó).
  - Router gom `features/*/routes.tsx`.

- [ ] **Step 1: Test `http.ts` (đỏ)**

```ts
// test/api/http.test.ts
it('401 chuyển về /login?next= và ném ApiError', async () => {
  globalThis.fetch = vi.fn(async () => new Response('{}', { status: 401 }));
  const nav = vi.fn();
  setUnauthorizedHandler(nav);
  await expect(http('GET', '/api/companies')).rejects.toMatchObject({ status: 401 });
  expect(nav).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?next=/));
});
it('4xx giữ nguyên message của server', async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'reviewer và integrator phải là hai agent khác nhau' }), { status: 400 }));
  await expect(http('POST', '/api/plugins/crew.core/api/projects/x/roles', {})).rejects.toMatchObject({ status: 400, message: 'reviewer và integrator phải là hai agent khác nhau' });
});
it('gửi credentials include và JSON', async () => { /* kiểm init.credentials === 'include', header content-type */ });
```

- [ ] **Step 2: Test `endpoints` (đỏ):** mọi hàm trong `src/api/paperclip/*.ts` gọi `http()` với `(method, path)` khớp một dòng của `ENDPOINTS`. Cách kiểm: mỗi module export `__endpoints: EndpointId[]`, test so tập này với `ENDPOINTS`. Không có endpoint lạ, mọi dòng `ENDPOINTS` đều được dùng.

- [ ] **Step 3: Cài `http.ts`, `endpoints.ts`, client.**
  - `ENDPOINTS` lấy đủ các dòng "Tác dụng thật" của BA S0–S19 (gồm `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out`, `GET /api/auth/get-session`, `GET/POST /api/cli-auth/challenges/:id[/approve|/cancel]`, `GET /api/health`, `PATCH /api/auth/profile`).
  - Plugin: `POST /api/plugins/crew.core/data/:key`, `/api/plugins/crew.core/api/...` (I1, I2, I6).
  - Kiểu body/response import từ `@paperclipai/shared` khi có; không có thì khai trong file client, ghi nguồn route server (`server/src/routes/<file>.ts:<dòng>`).

- [ ] **Step 4: Router và shell.**
  - `router.tsx`: `createBrowserRouter`.
    - `/login`, `/cli-auth/:id` ngoài guard.
    - `/:companyPrefix/*` trong `RequireSession` + `Shell`, children gom từ `import.meta.glob('../features/*/routes.tsx', { eager: true })` (mỗi module export `routes`).
    - `/` chuyển tới `/<prefix>/dashboard` của company đầu tiên trong `crew.companies`.
    - `/ds` chỉ khi DEV.
  - Sidebar (S0.1): mục theo BA S0.1, link tới path I5. Badge Hộp thư lấy `GET /companies/:c/sidebar-badges`. Mục của feature chưa có route thì không hiện (đọc từ danh sách route đã gom, không dựng link chết).
  - Switcher (S0.2): chỉ company có trong `crew.companies`; đổi company thì chuyển sang `/<prefix mới>/dashboard`.
  - Ngôn ngữ (S0.3): nút VI/EN gọi `setLanguage`.
  - Palette (S0.4): Cmd/Ctrl+K, gõ `PREFIX-123` mở issue; gõ chữ thì tìm `GET /companies/:c/issues?q=`.
  - Tài khoản (S0.6): Đăng xuất gọi `POST /api/auth/sign-out` rồi về `/login`.
  - `live-events.ts` (S0.5): WS `/api/companies/:c/events/ws` (URL theo `location`, `wss` nếu https). Sự kiện → `queryClient.invalidateQueries` theo bảng ánh xạ loại sự kiện → `queryKeys`. Mất kết nối thì thử lại theo backoff 1–30 giây. Tham khảo `ui/src/context/LiveUpdatesProvider.tsx`.

- [ ] **Step 5: Đăng nhập và cli-auth.**
  - `login-page.tsx` (S1.1): form email/mật khẩu → `POST /api/auth/sign-in/email`. Sai thì hiện lỗi. Không có link đăng ký. Thành công thì về `next` (chỉ nhận path bắt đầu bằng `/` và không bắt đầu bằng `//`).
  - `cli-auth-page.tsx` (S1.2): đọc challenge `GET /api/cli-auth/challenges/:id`, hiện tên client và mã. Nút Cho phép gọi `/approve`, Hủy gọi `/cancel`. Chưa đăng nhập thì về `/login?next=/cli-auth/:id`. Đọc `ui/src/pages/CliAuth.tsx` để giữ đúng body và các trạng thái (hết hạn, đã duyệt).

- [ ] **Step 6: Test.**
  - `router.test.tsx`: route lạ hiện trang 404 có nút về Tổng quan.
  - `company-switcher.test.tsx`: `crew.companies` trả 1 company, `/api/companies` trả 2 → chỉ hiện 1.
  - `cli-auth.test.tsx`: bấm Cho phép gọi đúng `POST …/approve`, hiển thị "Đã cho phép".
  - `login.test.tsx`: `next=//evil.com` → về `/`.
  - `live-events.test.tsx`: sự kiện `issue.updated` gọi invalidate `queryKeys.issue(id)`.

- [ ] **Step 7: Chạy test, typecheck, build, lint.**

- [ ] **Step 8: Commit** `feat(crew-web): shell, điều hướng, client API, đăng nhập và duyệt đăng nhập CLI`.

---

### Task 4 (DS-4): Widget Crew

**Files:**
- Create: `src/ds/widgets/crew/{crew-summary,crew-map,docs-check-panel,machine-card,readiness-badge}.tsx`, `test/ds/crew/*.test.tsx`
- Modify: `src/ds/index.ts`

**Interfaces:**
- Consumes:
  - `@crew/paperclip-plugin/shared/{map,docs-tree,machine-card,attachment-rules}` (PL-3);
  - `AgentReadiness`, `ProjectReadiness` (WZ-1, chỉ kiểu, import từ `@/features/readiness` qua `index.ts`);
  - dữ liệu `crew.map`, `crew.docsCheck`, `crew.machines` (I6).
- Produces:
  - `CrewSummary({roots|map, docsCheck, onToggleMap})`;
  - `CrewMap({map, onOpenIssue})`, nạp lười `@xyflow/react`;
  - `DocsCheckPanel({result})`;
  - `MachineCard({report, latestAt, now})`: "Mất liên lạc" khi `now - latestAt > 3 phút`;
  - `ReadinessBadge({state, failed})`.

- [ ] **Step 1: Test (đỏ).** Dữ liệu vào lấy từ fixture JSON (`test/ds/crew/__fixtures__/*.json`) chép từ test plugin (`packages/crew-plugin/src/__tests__/map.data.test.ts` …).
  - `crew-map.test.tsx`: số node render bằng số node của fixture; click node gọi `onOpenIssue(id)`.
  - `machine-card.test.tsx`: `latestAt` cách 4 phút hiện `t('common:machine.offline')`; report thiếu `checkouts` vẫn render.
  - `readiness-badge.test.tsx`: `not_ready` có `failed: [{id:'A5'}]` hiện "Thiếu checkout trên máy".

- [ ] **Step 2: Chạy, đỏ.** **Step 3: Cài** (component React mới, logic thuần import từ plugin, chuỗi qua `t()`). **Step 4: Xanh**, typecheck, lint.

- [ ] **Step 5: Commit** `feat(crew-web): widget Crew cho map, docs, máy và trạng thái sẵn sàng`.
