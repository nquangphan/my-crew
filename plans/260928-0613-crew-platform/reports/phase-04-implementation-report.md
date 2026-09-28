# Phase 4 (Web App): Implementation Report

Date: 2026-09-28 · Status: done · Scope: `apps/web/**`, small additive changes in `packages/shared/src/**` and
`apps/api/**`, lockfile. The docs space is not built here; Phase 5 owns it (see "Extension points").

## What was built

The web app is a React 19.3 single-page app built with Vite 8.3, TanStack Router 1.170 (code-based routes) and
TanStack Query 5.104. It uses Tailwind v4 and shadcn-style components on Radix (`radix-ui`), with `@dnd-kit/core`
for drag and drop and `react-markdown` with `rehype-sanitize` for markdown. Every visible label is Vietnamese,
and every date is shown in Asia/Ho_Chi_Minh. Fonts are self-hosted (IBM Plex, as in the mockup).

- **Shell** (`src/layout/`):
  - The top bar has the logo, quick search, "Tạo", the Inbox bell with its badge, and the owner menu (theme,
    shortcut sheet, logout). The menu also warns when three or fewer recovery codes are left.
  - The project sidebar has a project switcher, "Tất cả request của tôi", Board, Danh sách, Docs, Cài đặt
    project, then Inbox, Dự án and Máy. Its footer shows the owning machine's state.
  - Every page has breadcrumbs. Light and dark themes use the mockup's palette.
- **Shortcuts** (`src/lib/shortcuts.ts`): `/`, `c`, `g b`, `g l`, `g d`, `g i`, `j`/`k` and Enter, `Esc` and
  `?`. They work at desktop width only, and are ignored while typing or while a dialog is open.
- **Responsive layout**:
  - Desktop has the full sidebar and a 580 px side panel.
  - Tablet has an icon rail that expands on tap, an 80 % overlay panel, and a list without the model, cost
    and updated columns. On the ticket page the Details box sits above the Activity tabs.
  - Phone has a drawer sidebar, a full-screen search, a board with one column per screen (swipe and snap,
    column tabs, dots), and full-screen tickets. The Details box collapses to a summary row, the reply box
    for `needs_input` is pinned at the bottom, the list becomes stacked cards, and bulk actions move to a
    bottom bar.
  - Touch targets are at least 44 px below the desktop breakpoint. Information that was hover-only (skill
    descriptions, comment times) is in tap popovers (`ui/info-tip.tsx`).
- **Board** (`components/board-view.tsx`, `ticket-card.tsx`):
  - Status columns show their counts, and cards are grouped into swimlanes by parent.
  - Filters cover type, role avatars, priority, "Chỉ ticket của tôi" and grouping. They are all kept in the
    URL.
  - Cards show the type icon, key, priority arrow, the role avatar with a spinner while a job runs, and
    badges.
  - Drag and drop uses the mouse, or a long press on touch. It calls the transition endpoint optimistically;
    a refusal (`REPORT_REQUIRED`, an illegal move) shows a toast and the card snaps back.
  - Clicking a card opens the side panel (`?selected=KEY`), which has a "Mở toàn trang" link.
- **List** (`routes/list.tsx`, `components/issue-table.tsx`):
  - Every column sorts. Columns can be resized, and the widths are remembered in this browser.
  - Status (legal moves only) and priority can be edited in place.
  - Bulk actions change priority or cancel (with confirmation).
  - Filters and sort live in the URL.
- **Ticket view** (`components/ticket-view.tsx`): one component for the panel and the full page.
  - The title is edited inline and the description in a markdown editor.
  - The subtask tree shows dev↔QC pairs, the bug chain with "vòng n/3", and "Chờ KEY" dependency waits.
  - "Docs liên quan" links each entry in `flows[]`.
  - The Activity tabs are Bình luận, Lịch sử and Report (all report fields, with a version picker).
  - The Details box's status dropdown offers only `allowedTransitions('owner', …)`.
  - Actions are Hủy (the dialog lists every open descendant), Mở lại and Bỏ chặn.
  - `needs_input` shows the yellow banner, and "Trả lời" focuses the reply box.
- **Create dialog**: project hint, priority, title, markdown description, "Cho phép sửa config" and
  "Tạo thêm". The assignee is fixed to the assistant.
- **Login** (`routes/login.tsx`): password, then TOTP, with a recovery-code option. An expired challenge
  sends the owner back to the password step. The route guard redirects a 401 to `/login?redirect=…`, and
  only same-site paths are followed after login.
- **API client** (`lib/api-client.ts`):
  - It is typed, and it validates every response against the shared zod schemas.
  - It sends the CSRF header on every write, from the session response, or from the cookie before the
    session has been read.
  - A 401 is handled globally.
- **Live events** (`lib/live-events.ts`):
  - It maps the owner SSE stream to query invalidations, batched every 100 ms.
  - The browser resumes with `Last-Event-ID`. If it gives up, the stream reopens with `?cursor=`, and every
    query is invalidated after any reconnect.
- **Inbox** (`routes/inbox.tsx`, `lib/inbox.ts`):
  - It lists takeover requests (approve or reject with TOTP), tickets waiting for an answer, cap and budget
    holds, offline machines with their affected open tickets, machines with red health, projects with no
    machine, and a machine notice feed.
  - The bell badge counts the action items plus unread notices.
- **Projects**: list, create and edit. The description hint says it drives routing. The page also covers
  budgets and caps, platform and UI-test MCP names, the owning machine, the docs status, and moving a project
  to another machine with confirmation. "Cài đặt project" shows the same form for the current project.
- **Machines**:
  - Each machine shows online and stream state, paused state, health with its failing checks, resources, and
    running jobs linked to their tickets.
  - It also shows projects, versions, token expiry (red under 14 days), and the skill and MCP inventory per
    project.
  - Actions: create a pairing code (TOTP, shown once, with a countdown), revoke, and make this machine the
    assistant host.

## Tests

- **Vitest and Testing Library** (jsdom): 15 files, 38 tests, all under `src/**`. The five cases the phase
  asks for:
  - the `REPORT_REQUIRED` refusal in the ticket view, plus the board's optimistic snap-back;
  - a comment post (CSRF header, body, clearing the box, the error path);
  - a subtask tree with a bug chain, its retests and a dependency;
  - the cancel dialog listing descendants across levels;
  - the TOTP login step (wrong code, then success, a recovery code, a wrong password).

  Also covered:
  - live-event mapping, cursor resume and invalidation after a reconnect;
  - the API client (CSRF, 401 handling, contract validation, paging);
  - shortcuts, URL filters and `safeRedirect`;
  - status targets checked against `canTransition('owner', …)` for every status;
  - board filters and list sorting;
  - date and error formatting;
  - inbox claim approval with a TOTP (and a wrong code);
  - the pairing dialog;
  - sanitised markdown (no `<img onerror>`, no `javascript:` links).
- **Playwright E2E** runs against the real API and Postgres, at 390×844, 820×1180 and 1440×900.
  - `e2e/core-flows.spec.ts` runs at all three viewports: login with TOTP, then create a ticket and open it in
    the panel. An agent (the real daemon REST API with a paired machine token) triages it and asks a
    question. Then:
    - the owner finds the pm_task on the board and opens it;
    - a new agent comment appears in under 2 s without a reload;
    - the owner answers, and the ticket leaves `needs_input`;
    - a status change from the Details dropdown shows the `REPORT_REQUIRED` refusal, then passes once a
      report exists;
    - the owner opens the docs from a flow chip and from the sidebar;
    - cancelling an in-progress pm_task cancels its open QC child and leaves the done dev ticket alone.

    `scrollWidth <= innerWidth` is checked on every page.
  - `e2e/owner-admin.spec.ts` runs on desktop only:
    - the shortcuts, including "Tạo thêm";
    - quick search: `/`, then Enter;
    - a real mouse drag to "Xong" that is refused and snaps back;
    - a bulk priority change;
    - pairing with TOTP;
    - a machine-B takeover approved in the inbox with TOTP, then the project moved back from the projects
      page;
    - dark mode.
- **API**: `apps/api/test/owner-web-support.test.ts` (5 tests). The API total is 126 tests and all pass.
- **Screenshots**: I compared the board with its panel, the list, the ticket page, the inbox and the machines
  page at the three viewports, plus the board in dark mode, against the mockup. The mismatches I found are
  fixed:
  - the sidebar shrank next to a wide table;
  - the card meta row overflowed;
  - pm_task lanes had the wrong labels;
  - six columns did not fit at 1440 px;
  - the filter bar took three rows on a phone (it is now a "Bộ lọc" toggle).

  The screenshots are written to `apps/web/test-results/` (gitignored).

From the repo root, `pnpm -r typecheck && pnpm -r test && pnpm lint && pnpm -r build` passes. The E2E command
is `pnpm --filter @crew/web test:e2e`, and all 4 tests pass.

## API and shared changes

All of these are additive, and all API tests pass. They were committed together with the controller's
202-claim change in `0910549`.

1. `PATCH /v1/tickets/:id` (owner, CSRF) takes `UpdateTicketRequest {title?, description?, priority?}` and
   returns a `Ticket`. The UX needs it for inline title and description edits and for priority changes
   (inline and bulk). The service is `updateTicket()`, and it never wakes an agent.
2. There is a new event, `ticket.updated {ticketId, change: comment|report|meta|fields}`. It is untargeted, so
   it reaches the owner stream only. It is emitted for agent and system comments, report submissions,
   agent-meta and owner edits. Before this change an agent comment produced no event, so the "agent comment
   in under 2 s" criterion could not be met. The daemons never receive it.
3. `GET /v1/notices?limit=` returns `NoticeListResponse`: the newest `NOTICE_EVENT_TYPES` events. The inbox
   needs a history of the machine notices (`machine.claimed`, `project.created`, `machine.released`,
   `claim.requested`, `machine.offline`, `machine.unhealthy`, `budget.exceeded`).

## Deviations and interpretations

- **Board columns.** Blocked tickets sit in "Đang làm" with a red "Bị chặn" badge, as in the mockup, rather
  than in a separate column. Cancelled tickets appear only in the list.
- **"Chỉ ticket của tôi"** shows the tickets that wait for the owner: `needs_input`, `blocked` or a budget
  hold. The owner is the only human and every ticket comes from their requests, so "mine" has no other
  useful meaning.
- **Swimlanes** are lane labels inside each column, as in the mockup's `.lane`. pm_tasks share one "PM task"
  lane, and their children sit under their pm_task. The lanes are on by default for projects and off for
  the requests board.
- **Phone "+".** It is in the top bar, as the spec says, instead of the mockup's floating button.
- **Badge colours.** The `needs_input` badge is yellow "Chờ bạn" (the Jira and mockup colour) and `blocked`
  is red.
- **List view.** Filters run on the server. Sorting is done in the client over all loaded rows (up to 1000),
  because the server sorts only 4 of the 9 columns. Rows open the full ticket page.
- **Inbox read marker.** It is stored per browser in localStorage. Action items come from live state, so
  they never depend on the marker.
- **Refreshing machine data.** Heartbeats emit no events, so machines, health and running jobs refresh every
  30 s as well as on events.
- **Bundle size.** The app is one chunk of about 890 kB (274 kB gzipped). Vite prints a size warning; the app
  is not code-split.

## How to run

```bash
docker compose -f docker-compose.dev.yml up -d --wait          # crew-dev-postgres on 127.0.0.1:55432
# API on 8787 (env as in apps/api/.env.example):
DATABASE_URL=postgres://crew:crew@127.0.0.1:55432/crew SESSION_SECRET=<32+ chars> \
PUBLIC_ORIGIN=http://127.0.0.1:5173 COOKIE_SECURE=false pnpm --filter @crew/api dev
pnpm --filter @crew/web dev                                     # http://127.0.0.1:5173, proxies /v1 to 8787
```

`CREW_API_URL` overrides the proxy target. The Origin allow-list must contain `http://127.0.0.1:5173`: use
`PUBLIC_ORIGIN` as above, or `ALLOWED_ORIGINS`.

**E2E:** `pnpm --filter @crew/web test:e2e`. If Chromium is missing, run
`pnpm --filter @crew/web exec playwright install chromium` once.

- **Ports and database.** It uses its own ports (API 8798, preview 4178) and its own database,
  `crew_e2e_test`, which it creates if missing. The database is on the same container and never on port 5432.
- **Each run:**
  - `e2e/prepare-db.ts` recreates the schema and seeds an owner with a random password and TOTP secret.
  - The global setup pairs two machines over HTTP.
  - Playwright builds the app, starts both servers, and stops them afterwards.
- **Secrets.** The secrets of a run exist only in the gitignored `apps/web/.e2e/state.json`.

## Extension points for Phase 5 (docs space)

- **Route.** `docsRoute` in `src/router.tsx` is `/projects/$projectKey/docs`, with search `{flow?, path?}`
  (validated in `src/lib/search-params.ts`). Replace the placeholder `DocsPage` in `src/routes/docs.tsx`, or
  add child routes under it.
- **Links.** `src/lib/docs-links.ts` (`docsHome`, `docsFlow`, `docsPage`) is the only place that builds docs
  URLs. The ticket "Docs liên quan" chips, quick-search docs results, the sidebar "Docs" entry and `g d` all
  use it. Keep the URL shape, or change it only there.
- **Search.** Quick search already renders `SearchResponse.docs` and navigates to `docsPage(projectKey, path)`.
  Filling `docs` on the server is enough.
- **Live updates.** A `docs.synced` event invalidates the `['docs']` and `['projects']` query prefixes. Key
  docs queries under `['docs', …]`.
- **Reusable parts.** `Breadcrumbs`, `MarkdownView` (sanitised), `useViewport()` (phone, tablet or desktop),
  `useProjectByKey()` and `StatusLozenge` for the "Ticket liên quan" box. `GET /v1/tickets?flow=` already
  lists the tickets that touch a flow. The app shell's `<main>` is the scroll container; the docs page can
  render its own page tree next to its content.

## Left undone

Nothing else in the phase scope is left undone. The docs space belongs to Phase 5. `plans/` was off limits except for this report, so the phase
file's todo boxes are unchanged.

## Unresolved questions

- Is "Chỉ ticket của tôi" as "waiting for me" the meaning you want?
- Should the inbox read marker be server-side, so a phone and a desktop share it? It would need a small
  owner-state table.
