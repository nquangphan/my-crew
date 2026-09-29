# Per-project filter audit and docs home: implementation report

Status: done. Branch `worktree-agent-a7bcc95229aa47d6b`, one commit, not pushed.

## Why

The owner reported: "Mở docs trên web thấy mỗi 1 dự án, không coi doc dự án khác được." The docs space lives at
`/projects/$projectKey/docs`, and nothing in it led to another project's docs. The owner then asked that every
feature let them filter by project ("check luôn tất cả các tính năng phải cho filter theo dự án").

## Audit

Every route in `apps/web/src/router.tsx`, plus the shell pieces. The pattern for a fix is the one the
all-projects board already used: a "Dự án" multi-select stored in the URL as `?project=KEY,KEY`, and a project
badge on each item.

| Screen | How it was scoped | Could the owner reach every project's data? | Fix |
|---|---|---|---|
| Home `/` | Redirects to the current project's board, or to `/requests` | Yes, through the sidebar | None |
| All-projects board `/board` and list `/list` | Every project, with a `?project=` filter and badges | Yes | Its filter now uses the shared `ProjectFilterMenu` (no behaviour change) |
| Project board and list `/projects/KEY/board\|list` | One project | Only through the sidebar switcher, which always opened the board | The switcher now keeps the open page (board, list, docs or settings) |
| Ticket detail `/tickets/KEY` | One ticket; the breadcrumb links to its project | Yes | None |
| Create-ticket dialog (project hint) | Lists every project; defaults to the current one | Yes | None |
| Quick search (top bar, phone overlay) | Every project, with no way to narrow it; ticket results had no project | Partly | A scope chip in the search bar ("Tất cả" or one project) sends `projectIds`. Ticket and docs results show a `ProjectBadge`. The API returns each ticket's `projectId` |
| Docs space `/projects/KEY/docs` | One project, with no way out except the sidebar | **No** | A project switcher in the docs header: in the page tree on desktop, in the space header on phone and tablet, and on the empty-space page. It keeps the same page path when the other project has it. Breadcrumbs start with "Tài liệu" (→ `/docs`) |
| Docs search (space search box) | One project | **No** | A scope toggle, "Dự án này" or "Mọi dự án". The cross-project results carry project badges. New endpoint `GET /v1/docs/search` |
| Docs overview | Did not exist | **No** | New docs home `/docs`: every project with its docs state (ready: file count, commit, sync time; otherwise "Chưa có docs" with the reason and a link to the docs-init ticket), a cross-project search, and a `?project=` filter. New endpoint `GET /v1/docs` |
| File lookup (on the `docs/files.md` page) | The project's own manifest | Yes, once the switcher reaches every space; a path belongs to one repo | None |
| Inbox `/inbox` (notices, claims, pending changes, waiting tickets, machines, unowned projects) | Everything mixed, no project shown on tickets or notices | Everything was visible, but nothing could be narrowed | A `?project=` filter over every group. Waiting tickets are fetched with `projectIds`, with the same semantics as the board. Badges on tickets and notices. The bell badge and read state stay global |
| Machines `/machines` (jobs per project) | Every machine; jobs showed no project | Everything was visible, but nothing could be narrowed | A `?project=` filter keeps the machines that hold a chosen project and only those projects' jobs. Each job line shows its ticket's project badge. The "Dự án" fact shows badges |
| My requests `/requests` | Every request | Everything was visible, but nothing could be narrowed | A `?project=` filter, sent as `projectIds` (requests routed or hinted to those projects). Requests have no project, so they carry no badge |
| Project settings `/projects/KEY/settings` | One project | Only through the sidebar switcher, which jumped to the board | The switcher now keeps the settings page |
| Projects list `/projects` | Every project | Yes | Each card gets a "Xem docs" link |
| Keyboard shortcuts | `g d` did nothing outside a project URL (it used the stored project) | Partly | `g d` opens the URL project's docs, or else the docs home `/docs`. `g a` (all projects) is unchanged |
| Sidebar | Only the per-project "Docs" entry | **No** docs overview | A new top entry, "Tài liệu" (→ `/docs`). The per-project "Docs" entry is active only under `/projects/…/docs` |

## What changed

### API (with tests)

- `GET /v1/docs` (`getDocsOverview()`) returns every project, in key order, with:
  - `docsStatus`;
  - the latest snapshot's commit, branch and `syncedAt`, or null;
  - `fileCount`;
  - `docsInit`: the newest docs_init ticket of the project (key, title, status), or null. This is how the
    docs home explains an empty space: blocked, waiting for an answer, in progress, done but waiting for the
    sync, cancelled, or no ticket at all (with or without a machine holding the project).
- `GET /v1/docs/search?q=&projectIds=` (`searchDocsAcrossProjects()`) searches every project, or only the
  listed ones.
  - Title matches come first, then results are ordered by project key and path.
  - At most 50 results, each with its `projectId` and a snippet.
- `GET /v1/search` accepts `projectIds` and returns a `projectId` on each ticket.
  - The ticket filter is the board's filter, extracted into `inProjectsFilter()`. It keeps the tickets of
    those projects plus the requests routed or hinted to one of them.
  - `searchAllDocs()` takes the same filter.
- Shared, additive changes in `api-schemas.ts`:
  - new: `DocsOverviewResponse`, `DocsOverviewItem`, `DocsInitTicketInfo`, `CrossDocsSearchQuery`,
    `CrossDocsSearchResponse`;
  - `SearchQuery.projectIds`, and `SearchResponse` tickets gain `projectId` (default null);
  - `ListTicketsQuery.projectIds` now reuses `ProjectIdsFilter`, with the same validation.

### Web

- New files:
  - `routes/docs-home.tsx`: `DocsHomePage` and `noDocsReason()`;
  - `components/docs-project-switcher.tsx`: `DocsProjectSwitcher` and `switchTarget()`;
  - `components/project-filter.tsx`: `ProjectFilterMenu` and `selectedProjects()`, which the board, list,
    requests, inbox, machines and docs home all use.
- `DocsPageTree` gains the scope toggle (a fieldset with `aria-pressed` buttons), the `switcher` slot, and the
  exported `DocsSearchHits`.
- `MenuContent` has an optional `onCloseAutoFocus`, so the quick-search scope menu returns focus to the input.
- Live events: ticket events also invalidate `['docs','overview']`, so a docs-init ticket that changes status
  refreshes the docs home.
- Responsive:
  - the docs cards are one column on phone, two on tablet and three on desktop;
  - filters and switchers are 44 px tall on touch screens;
  - on phone and tablet the switcher sits in the space header, and the search and scope toggle are in the
    drawer.
- Keyboard: every new control is a Radix menu or a native button or input. `g d` works as described in the
  audit.

## Tests

- **API:** `apps/api/test/docs-overview.test.ts`, 6 tests.
  - The overview: order, snapshot, file count, a blocked docs-init ticket, and owner-only access.
  - The cross-project search: every project, `projectIds`, 400 on a bad uuid or an empty query, and 401.
  - `/v1/search`: `projectId` on each ticket, and the `projectIds` narrowing (the routed request is kept).
- **Web components:**
  - `docs-home.test.tsx` (4 tests);
  - `docs-project-switcher.test.tsx` (5 tests: `switchTarget`, keeping the page, the fallback to the home,
    "Tất cả dự án", the phone header and the empty space, and the scope toggle);
  - `quick-search.test.tsx`;
  - `project-sidebar.test.tsx`;
  - `machines.test.tsx` (2 tests);
  - a new case in `inbox.test.tsx`;
  - a new case in `all-projects.test.tsx` (my requests);
  - `live-events.test.ts`, updated.
- **E2E:** `apps/web/e2e/docs-across-projects.spec.ts`, at phone, tablet and desktop. The spec checks that:
  - the sidebar "Tài liệu" opens the docs home, which lists SHOP and a second project as ready, and a third
    project with "Chưa có docs" and its blocked docs-init link;
  - switching from SHOP's "Kiến trúc" to the second project keeps `?path=docs/architecture.md`;
  - "Mọi dự án" search shows both projects' badges, and a result opens that project's page;
  - the machines page with `?project=` shows only that project's job and hides machine B, and adding SHOP
    brings its job back;
  - on desktop, `g d` from `/inbox` opens `/docs`;
  - no page overflows sideways.

  I checked the screenshots at each viewport.
- **`docs-space.spec.ts`:**
  - It now expects the "Tài liệu" breadcrumb.
  - Its desktop quick-search step narrows the search to SHOP with the scope chip. The new spec syncs
    "Kiến trúc" pages for other projects, so an unscoped search matches several.
- **Quick-search fix found by the E2E run:** a fast pick in the scope menu reopened the results, and then the
  blur's delayed close shut them again. Focusing the input again now cancels that pending close. The unit test
  covers it.
- **Gate:** on isolated databases (`crew_xp_test` for the packages, the configured `crew_e2e_test` for E2E):
  - `pnpm -r typecheck`, `pnpm -r --workspace-concurrency=1 test`, `pnpm lint` and `pnpm -r build` all pass;
  - the full web E2E suite passes.
- **Daemon flake:** `apps/daemon/test/lifecycle.test.ts › capability-preflight` failed 3 times in a row while
  the machine was busy (60–126 s per run; `r.runs` empty). It then passed 3 times in a row with the same code,
  in about 8 s, and it passes in the full suite run. The runner records no API call to the changed endpoints,
  and the daemon code is untouched. The failure looks timing-dependent, but I did not prove its cause. With
  the API changes reverted it passed on its only run. Keep an eye on it after the merge.

## Docs

- `docs/flows.yaml` (flows section only):
  - new files go into `docs-sync-viewer` (the docs home, the switcher and their tests), `web-shell`
    (the sidebar and quick-search tests), `web-tickets` (`project-filter.tsx`) and `web-admin`
    (`machines.test.tsx`);
  - `docs/files.md` was regenerated with `crew-docs generate`.
- A sonnet subagent updated the flow docs, as the owner decided, and I checked them against the code:
  `docs-sync-viewer`, `web-shell`, `web-tickets`, `web-admin`, `event-delivery`, `ticket-lifecycle` and
  `owner-auth` (`api-schemas.ts` is shared with it). `crew-docs check --all` passes.
- `routes/docs-home.tsx` is listed under `files`, not `entrypoints`. Listing it as an entrypoint would change
  the generated block of `docs/index.md`, which is outside the files I may change.

## Decisions and limits

- **Default scopes.** Quick search and the space search default to all projects and to "Dự án này"
  respectively. The scope is per visit and is not stored.
- **Machines filter.** It keeps the machines that hold a chosen project (`projectKeys`). A job whose ticket is
  still loading stays visible until its project is known.
- **Inbox filter.** It hides the assistant-role claims and notices with no project, because they belong to no
  project. The bell count stays global.
- **Requests.** They carry no project badge, because a request belongs to no project. The filter still finds
  them through routing or the hint.

## Unresolved questions

- Should the docs home become an entrypoint of `docs-sync-viewer`? That needs a regenerated `docs/index.md` in
  the same commit.
- Should the quick-search scope default to the project in the URL when the owner is inside a project?
