---
title: "Phase 4: Web App"
status: todo
priority: P1
effort: 20h
dependsOn: [2, 3]
---

# Phase 4: Web App

<!-- Updated: Validation Session 10 - responsive web UI -->
<!-- Updated: Validation Session 4 - Jira/Confluence-style UX spec -->
<!-- Updated: Validation Session 3 - projects/folders chosen in the local app; takeover needs owner approval; app can create projects -->
<!-- Updated: Desktop App 2026-09-28 - see phase 9 -->
<!-- Updated: Red Team 2026-09-28 - TOTP login, CSRF token, owner-set pairing claims, cancel from any open state, inbox alerts, Last-Event-ID -->

## Overview

A single-owner React SPA (Vite, TanStack Router and TanStack Query) for creating and assigning tickets, watching
agents work live, answering PM questions in the comment thread, reading reports, and managing projects and
machines. The docs viewer UI is added in Phase 5, on top of this router and API client.

## Key Insights

- Live updates come from the owner SSE stream (`/v1/stream`, `Last-Event-ID`), which invalidates TanStack Query keys.
- The owner answers agents by commenting. The server moves `needs_input` back to `in_progress` and wakes the agent. The inbox is the owner's single "needs me" list.

## Requirements

- **Login:** password, then a TOTP step, with a recovery code option. A CSRF token is fetched after login and sent on every mutating request.
- **Board:**
  - A kanban by status, with filters (project, assignee role, type) and "my requests" / "all".
  - Dragging calls the transition endpoint with `actor=owner`. The UI shows 409 `REPORT_REQUIRED` and illegal-transition errors, and the card snaps back.
- **Create ticket:** title, markdown description, priority, and an optional project hint. The assignee is fixed to the assistant. Also a checkbox "config change allowed", which lets agents change R6 paths (Phase 5).
- **Ticket detail:**
  - Header: status, role, machine, model, effort, complexity, required skills, cost against budget.
  - Description.
  - Subtask tree, showing dev↔QC pairing, bug chains with their cycle, and dependencies.
  - Comment thread with a composer.
  - Report panel: summary, files, commits, `head_sha`, skills used and missing, `docs_first`, tests, bugs filed.
  - Event timeline.
  - Actions: cancel (any open state; the confirm dialog lists the descendants that will be cancelled), reopen, unblock.
- **Inbox:** claim requests (approve or reject with TOTP), claim and new-project notices from machines, unowned-project alerts, `needs_input` tickets, `budget.exceeded` approvals, and `machine.offline` alerts with the affected tickets. It shows an unread badge.
- **Projects:**
  - List and edit: key, name, **description** (the only text the assistant uses for routing), repo URL, default branch, budgets and caps.
  - Shows the owning machine and docs status. Reassigning to another machine is an owner action with a confirmation.
- **Machines:**
  - List with online state, paused state, the health status from the desktop app with its failing checks, resources, running jobs, per-project skill inventory, and token expiry.
  - Create a pairing code: confirm the TOTP and see the code once. Projects and folders are chosen later in the desktop app.
  - Revoke.
- Markdown is rendered with sanitization.

## UX Spec (Jira-like)

Mockup (approved by the owner 2026-09-28; the visual reference to implement against; local file, open in a browser): [mockups/web-ui-mockup.html](./mockups/web-ui-mockup.html). It has 5 tabs: board with the side panel, list, full-page ticket, the Docs space, and Mobile (3 phone screens).

The goal is that anyone who has used Jira can use this without learning anything. The UI is in Vietnamese, and the layout and interactions follow Jira Cloud conventions.

**Global layout:**
- A top bar with the logo, quick search, a "Tạo" button, the inbox bell with its unread count, and the owner menu.
- A collapsible left sidebar per project: Board, Danh sách (List), Docs (the Confluence space, Phase 5), and Cài đặt project. Above it sit a project switcher and a "Tất cả request của tôi" entry, which lists the assistant tickets.
- Breadcrumbs on every page, e.g. `Dự án / PRJ / PRJ-12`.

**Board:**
- Columns by status, with the WIP count in each header.
- Filters: a type icon filter, assignee role avatars, priority, and "chỉ ticket của tôi". Rows can be grouped as swimlanes by parent (the pm_task).
- Cards show:
  - a type icon: request, pm_task, dev, qc, bug, docs_init;
  - the key, title and priority arrow;
  - the assignee role avatar (TL, PM, DEV, QC), with a spinner while an agent job is running;
  - a red badge for `needs_input` or `blocked`.
- Drag and drop between columns.
- Clicking a card opens the ticket in a **right-side panel over the board**, keeping the board in place. There is an "Mở toàn trang" link.

**List/Backlog view:**
- A table with sortable, resizable columns: key, type, title, status, role, priority, model, cost and updated.
- Bulk select for cancel or priority changes. Status and priority can be edited inline.
- Filters are saved in the URL, so any view can be bookmarked.

**Ticket view** (side panel or full page, same component):
- The left and centre area holds:
  - the title, editable inline;
  - the description with a markdown editor;
  - child issues, showing the dev↔QC pairs and the bug chain;
  - "Docs liên quan": links to each flow in `flows[]`;
  - the Activity tabs: **Bình luận**, **Lịch sử** (the event timeline) and **Report**.
- The right column holds a **Details** box with status as a dropdown showing only legal transitions, the assignee role, the machine, priority, complexity, model, effort, required skills, cost, and created and updated times.
- Action buttons: Hủy (cancel), Mở lại (reopen) and Bỏ chặn (unblock).
- `needs_input` shows a yellow banner "Agent đang chờ bạn trả lời" that focuses the comment box.

**Create dialog:** a Jira-style modal with the project hint, priority, title, description, and the "cho phép sửa config" checkbox. "Tạo thêm" keeps the modal open.

**Quick search and shortcuts:**
- `/` focuses search. Results cover tickets by key or title and docs pages, and Enter opens the selection.
- `c` opens Create, `g b` goes to the board, `g l` to the list, `g d` to docs, `g i` to the inbox.
- `j`/`k` move between cards or rows, and `Esc` closes the panel. `?` shows the shortcut sheet.

**Responsive** (owner requirement: usable on phone, tablet and desktop):
- **Desktop, ≥ 1280 px:** the layout as in the mockup. Full sidebar; the ticket opens as a right-side panel over the board.
- **Tablet, 768–1279 px:**
  - The sidebar collapses to an icon rail, and expands on tap.
  - The ticket side panel becomes a full-height overlay covering about 80% of the width.
  - The list view hides the model, cost and updated columns (still shown in the ticket).
  - On the ticket page the Details box moves above the Activity tabs.
- **Phone, < 768 px:**
  - The top bar keeps the logo, a search icon (which opens search full screen), the Inbox bell and a "+" button.
  - The sidebar becomes a drawer opened from a menu button.
  - The board shows one column per screen with horizontal swipe and snap, plus column tabs across the top.
  - Cards are full width. Moving a card uses the Details status dropdown or a long-press drag.
  - Tickets open full screen: the Details box collapses into a summary row, and Activity sits below.
  - The list view becomes a stacked card list. Bulk actions go in a bottom bar.
  - The `needs_input` banner and the reply box stay pinned at the bottom, so answering an agent from the phone is one tap.
- **Everywhere:**
  - Touch targets are at least 44 px. There is no hover-only information: tooltips are also reachable by tap.
  - No horizontal page scroll, except inside the board swimlane.
  - Keyboard shortcuts are desktop only.
  - Built with mobile-first Tailwind breakpoints (`md`, `xl`), using the same components at every size.

**Visual style:**
- A clean light theme close to Atlassian (neutral greys, blue accent), plus a dark mode.
- Status lozenges in Jira colours: grey for todo, blue for in progress, green for done, yellow for needs_input, red for blocked.
- Components come from shadcn/ui (Radix), styled with Tailwind v4.

## Related Code Files

Create under `apps/web/`:
- `index.html`, `vite.config.ts`, `src/main.tsx`, `src/router.tsx`
- `src/lib/api-client.ts` (typed, CSRF header), `src/lib/live-events.ts` (EventSource mapped to query invalidation; all queries invalidated after a reconnect)
- `src/routes/login.tsx`, `board.tsx`, `list.tsx`, `ticket-detail.tsx`, `inbox.tsx`, `projects.tsx`, `machines.tsx`, `my-requests.tsx`
- `src/layout/app-shell.tsx` (top bar, project sidebar, breadcrumbs), `src/layout/quick-search.tsx`, `src/lib/shortcuts.ts`
- `src/components/ticket-view.tsx` (shared by the side panel and the full page), `ticket-side-panel.tsx`, `details-box.tsx`, `status-dropdown.tsx`, `type-icon.tsx`, `role-avatar.tsx`, `status-lozenge.tsx`, `issue-table.tsx`, `ui/` (shadcn components)
- `src/components/ticket-card.tsx`, `comment-thread.tsx`, `report-panel.tsx`, `subtask-tree.tsx`, `event-timeline.tsx`, `markdown-view.tsx`, `new-ticket-dialog.tsx`, `pairing-dialog.tsx`, `cancel-dialog.tsx`
- `src/styles/` (Tailwind v4)
- `src/**/*.test.tsx`

## Implementation Steps

1. Scaffold Vite, React and TanStack Router, with an auth guard (401 → login).
2. API client with CSRF, query hooks, and live invalidation.
3. Board with `@dnd-kit`, ticket detail, comments, report panel, subtask tree, and timeline.
4. Inbox (including claim approval), projects (descriptions, budgets, reassign), and machines (pairing, revoke).
5. Markdown with `react-markdown` and `rehype-sanitize`.
6. Component tests:
   - the report-required error
   - a comment post
   - a subtask tree with a bug chain
   - the cancel dialog listing descendants
   - the TOTP step

## Todo

- [ ] App shell: top bar, project sidebar, breadcrumbs, quick search, keyboard shortcuts, light and dark themes
- [ ] Responsive layouts for phone, tablet and desktop (drawer sidebar, swipe board, full-screen ticket, card list), with viewport E2E tests
- [ ] Board with swimlanes, card badges and the ticket side panel
- [ ] List/Backlog view with sortable columns, inline edit, bulk actions and URL filters
- [ ] Ticket view with the Details box, legal-transition dropdown, Activity tabs and related docs links

- [ ] Scaffold, router, auth guard, TOTP login
- [ ] API client with CSRF and live invalidation
- [ ] Board, ticket detail, comments, report panel, timeline, cancel, unblock
- [ ] Inbox with alerts
- [ ] Projects and machines, pairing, claim approval in the inbox
- [ ] Component tests

## Success Criteria

- Playwright runs the core flows at three viewports: 390×844 (phone), 820×1180 (tablet) and 1440×900 (desktop). The flows are: create a ticket, open it, answer `needs_input`, change status, and open docs. There is no horizontal page overflow at any viewport (`document.documentElement.scrollWidth <= innerWidth`).

- A Jira user can do these without guidance: create a ticket (`c`), find it (`/`), open it in the side panel from the board, change its status from the Details dropdown, and answer a `needs_input` banner. This is checked in the Phase 8 E2E.
- The status dropdown only offers transitions that `canTransition('owner', …)` allows.

- `pnpm --filter web build` succeeds, and the tests pass.
- An agent comment appears on the open ticket page in under 2 s without a reload (checked in the Phase 8 E2E).
- Cancelling an `in_progress` pm_task from the UI cancels it and its open children.

## Risk Assessment

- Missed events during an SSE reconnect: `Last-Event-ID`, plus invalidating everything on reconnect.

## Security Considerations

- Rendered markdown is sanitized, because agent content is untrusted. Every mutation sends the CSRF token.
