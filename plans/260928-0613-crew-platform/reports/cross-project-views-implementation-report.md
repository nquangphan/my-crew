# Cross-project views ("Tất cả dự án" and "Cây ticket"): implementation report

Status: done, not committed. Branch `main`, working tree only.

## Why

Request AST-2 was routed to five projects. Each project got a pm_task with a `docs_init` child. The owner
could only look at one project's board or list at a time, and saw a single ticket. There was no view across
projects.

## What changed

### "Tất cả dự án" board and list

- **Routes.** There are two new routes, `/board` (`routes/all-board.tsx` → `AllProjectsBoardPage`) and
  `/list` (the existing `ListPage` with `projectKey={null}`).
  - They are reachable from a new top sidebar entry, "Tất cả dự án", which is active on both routes.
  - The project switcher menu now starts with "Tất cả dự án".
  - A new shortcut, `g a`, opens `/board`.
  - The board and the list link to each other ("Xem danh sách" / "Xem board") and keep the project filter.
  - I chose `/board` and `/list` over `/all/...` because they sit naturally beside `/requests` and
    `/projects/$projectKey/...`.
- **Same components.** `BoardView` gets an optional `projects` prop, which turns on cross-project mode.
  `IssueTable` gets an optional `projectKeyOf` prop. The project pages are unchanged: they still have no
  project column or filter, and they still use pm_task lanes.
- **Filters.**
  - "Dự án" is a multi-select stored in the URL as `project=WEB,APP` (keys, so the URL stays readable). It is
    sent to the API as `projectIds`.
  - The type filter covers request, pm_task, dev, qc, bug and docs_init.
  - Every existing filter is kept: status (list), "Chỉ ticket của tôi", role, priority, text and sort.
  - The list can also sort by project.
- **Project badge.** A project key badge (`components/project-badge.tsx`) appears on:
  - board cards and the drag overlay;
  - a "Dự án" column in the list on desktop and tablet;
  - the card rows on phones.

  Requests have no project, so they show no badge.
- **Swimlanes.** `lanesOf(tickets, all, mode, projects)` is now exported. Its modes are `parent`, `request`,
  `project` and `none`.
  - The all-projects board defaults to **Request → PM task**. A request's lane holds the request and all its
    pm_tasks, in every project it was routed to. Each pm_task's children follow in a nested "› KEY · title"
    lane.
  - The **Dự án** grouping is one lane per project, with requests that have no project first.
  - The board fetches every status except `cancelled`, which, as before, only appears in the list.

### API

I verified that `GET /v1/tickets` without `projectId` already returned every project's tickets and the
requests. Two additive changes were still needed; both have tests.

1. **The `projectIds` filter** (comma-separated uuids, at most 100). It keeps:
   - the tickets of those projects;
   - the requests routed to one of them (a child in the project, checked with an `EXISTS` subquery);
   - the requests hinted at one of them.

   Without it, filtering a request-grouped board by project would drop the request itself, and filtering
   in the client would break server-side paging. It combines with the other filters and with keyset
   pagination.
2. **`GET /v1/tickets/:id/tree`** returns every descendant of a ticket, open or closed, in one call.
   - It makes one query per level, so there are at most 4 queries for the three-level hierarchy.
   - Parents come before their children, oldest first.
   - It is capped at `TREE_LIMIT` = 1000 and returns `truncated: true` when the tree is cut.
   - The items carry `agentActivity`.
   - The response schema is `TicketTreeResponse` in `@crew/shared`.

   I chose this over extending `fetchOpenDescendants`, which lists level by level with one HTTP request per
   parent. With AST-2 that means 1 + 5 + N paged calls for every refresh, and the tree refreshes on every
   ticket event. The endpoint costs one round trip whatever the fan-out.

### Ticket tree

- **Placement.** "Cây ticket (n)" (`components/ticket-tree.tsx`) replaces the flat "Ticket con" list on a
  `request` or `pm_task` that has children. Other ticket types keep the existing `SubtaskTree` of siblings.
- **What it shows.** pm_tasks come first, one per project, then their dev, qc, bug and docs_init children.
  - dev↔QC pairs, bug chains and "Chờ KEY" waits are grouped with the existing `buildSubtaskTree()`.
  - Each row shows the type icon, the key, the project badge, the title, the status lozenge,
    `AgentActivityMark` (waiting, failed or unknown), and the role avatar with a spinner while a job runs.
  - Clicking a row opens the ticket.
- **Live updates.** The query key `['descendants', id, 'tree']` sits under the `descendants` prefix. The
  owner stream (`invalidationsFor`) and `invalidateTicketData` already invalidate that prefix, so no new
  wiring was needed.
- **Fallbacks.** While the tree loads, the direct children from the detail response are shown, so nothing
  flashes. If the call fails, an error line appears and the direct children stay. A truncated tree says so.
- **Phone.** Rows wrap, and the title moves to its own line.

## Files

- **Web:**
  - new: `routes/all-board.tsx`, `components/project-badge.tsx`, `components/ticket-tree.tsx`
  - changed: `router.tsx`, `routes/list.tsx`, `components/board-view.tsx`, `ticket-card.tsx`,
    `issue-table.tsx`, `ticket-view.tsx`, `layout/project-sidebar.tsx`, `layout/app-shell.tsx`,
    `lib/search-params.ts`, `lib/queries.ts`, `lib/api-client.ts`, `lib/shortcuts.ts`
  - tests: `test/fixtures.ts` (`project()` fixture), `e2e/helpers.ts` (`Agent.createProject`)
- **API:** `services/ticket-query-service.ts` (`projectIds` filter, `getTicketTree`) and
  `routes/ticket-routes.ts` (the tree route).
- **Shared:** `api-schemas.ts`, additive (`ListTicketsQuery.projectIds`, `TicketTreeResponse`).
- **Docs:**
  - `docs/flows.yaml`, flows section only: the new files are listed in `web-tickets`, and the API test in
    `ticket-lifecycle`.
  - `docs/flows/web-tickets.md`, `web-shell.md`, `ticket-lifecycle.md` and `owner-auth.md` were written by
    sonnet subagents and checked by me. `owner-auth.md` is included because rule R3 requires it:
    `api-schemas.ts` is shared with that flow.
  - `routes/all-board.tsx` is listed under `files` of `web-tickets`, not under `entrypoints`. Listing it as an
    entrypoint would change the generated block of `docs/index.md`, which is outside the files I may change.
    `docs/index.md` is unchanged.
  - `docs/files.md` was regenerated with `crew-docs generate`.

## Tests

- **API:** `apps/api/test/cross-project-tickets.test.ts`, 8 tests:
  - a listing without a project;
  - `projectIds` with a routed request and a hinted request;
  - `projectIds` combined with the type filter, and paged with a cursor;
  - a malformed uuid gives 400;
  - the tree: its order, closed tickets included, agent activity, a pm_task subtree, a leaf, 404 and 401;
  - truncation at the limit.
- **Web:**
  - `components/ticket-tree.test.tsx`, 3 tests:
    - nesting, badges, statuses, dependency waits, activity marks and click-to-open;
    - a request's `TicketView` makes exactly one `/tree` call and no per-level list calls, and refreshes on
      a `descendants` invalidation;
    - the fallback when `/tree` fails.
  - `routes/all-projects.test.tsx`, 5 tests:
    - request → pm_task lanes with badges, and cancelled tickets not fetched;
    - grouping by project;
    - the project filter sends `projectIds` and writes `project=` to the URL;
    - the all-projects list with its project column, filter and sort;
    - the project list stays unchanged.
- **E2E:** `e2e/cross-project-views.spec.ts` at phone, tablet and desktop. A request is routed to SHOP and
  to a second project created for each viewport (`XPP`, `XPT` or `XPD`, which sort after SHOP so the other
  specs keep their default project). The spec checks that:
  - both pm_tasks and their children are on the board, which it reaches from the sidebar, with lane and
    badges;
  - the project filter narrows the board and the list;
  - the request's tree lists all four descendants with project and status;
  - the tree updates live when the dev ticket moves to review.

  No page overflows sideways. I checked the screenshots at each viewport.
- **Gate:**
  - `pnpm -r typecheck`, `pnpm -r test`, `pnpm lint` and `pnpm -r build` all pass.
  - Tests ran one package at a time, on isolated databases `crew_xpv_*_test`.
  - The full web E2E suite passes: 20 tests on the isolated database `crew_xpv_e2e_test`. Both E2E servers
    were stopped afterwards.
- **Docs check:** `crew-docs check --staged` and `--commit-msg` (no trailer) pass on a temporary index built
  from HEAD plus this change. The real index was not touched.

## Decisions and limits

- **Load cap.** The all-projects board and list load at most 1000 tickets (the most recently updated), like
  the project pages (`listAllTickets`). When the owner has more, the project filter narrows the load on the
  server.
- **Unknown project keys.** A key in `project=` that no longer exists is ignored. If no key matches, the view
  shows every project.
- **Tree scope on a pm_task.** A pm_task's "Cây ticket" shows its own descendants, as asked. It does not show
  the sibling pm_tasks of its request; the request's tree does that.
- **Cancel dialog.** `fetchOpenDescendants` is left unchanged. It could reuse the tree endpoint later.

## Unresolved questions

- Should `routes/all-board.tsx` become an entrypoint of `web-tickets`? That needs a regenerated
  `docs/index.md` in the same commit.

- Should a pm_task's tree start at its request, so the owner sees the other projects' pm_tasks from any
  pm_task?
