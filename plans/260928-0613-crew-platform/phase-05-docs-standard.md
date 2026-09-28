---
title: "Phase 5: Docs Standard and Enforcement"
status: completed
priority: P1
effort: 18h
dependsOn: [1, 3, 4]
---

# Phase 5: Docs Standard and Enforcement

<!-- Updated: Validation Session 1 - docs written in Vietnamese; GitHub Actions confirmed -->
<!-- Updated: Validation Session 4 - Jira/Confluence-style UX spec -->
<!-- Updated: Desktop App 2026-09-28 - see phase 9 -->
<!-- Updated: Red Team 2026-09-28 - init commit detection, hook chaining + pre-push gate, no per-commit changelog, R6 protected paths, secret scan, sync validation, depends on Phase 4 -->

## Overview

Define **one** docs standard for every project and ship `crew-docs`, a language-agnostic CLI bundled as a single
file. It:
- scaffolds and validates the standard;
- enforces "every commit updates docs" with pre-commit, pre-push and CI checks;
- blocks credentials from being committed or pushed;
- answers agent lookups ("which files implement flow X", "which flows touch file Y").

This phase also adds the docs snapshot sync endpoint and the read-only docs viewer, with search, on the web. The
platform repo itself adopts the standard.

## Key Insights

- No existing tool enforces "a changed source file must belong to a flow and that flow's doc must change". It is a small custom check (research 02 §5).
- Projects may be in any language. The CLI is one esbuild-bundled file installed at `~/.crew/bin/crew-docs`, and hooks call it through an **absolute runtime path** and the bundle path. On a desktop-app machine the runtime is the app binary with `ELECTRON_RUN_AS_NODE=1` (Phase 9); on the CLI it is the `node` the installer found. The installer takes the runtime path explicitly, so launchd, IDE and nvm PATH differences cannot break it.
- A hook only proves docs were *touched*. QC and PM review accuracy (Phase 7).
- Git history *is* the change log. Flow docs have no per-commit change log, which removes a guaranteed source of merge conflicts.

## The Standard (v1)

```
<repo>/
  AGENTS.md                 # How to work here: build/test commands, conventions, "READ docs/index.md FIRST"
  CLAUDE.md                 # One line: @AGENTS.md
  docs/
    index.md                # Entry: purpose, stack, module map, flow list (generated block), how to use docs
    architecture.md         # Components, data stores, external services, deployment shape
    flows.yaml              # Machine-readable manifest (source of truth for flow ↔ files)
    files.md                # Generated reverse index: file → flows (never hand-edited)
    flows/<flow-id>.md      # One per business/technical flow
```

`flows.yaml` is validated by the schema in `@crew/shared/docs-schemas.ts`:

```yaml
version: 1
source:
  include: ["src/**", "apps/**", "packages/**"]
  exclude: ["**/*.test.*", "**/dist/**", "**/generated/**"]
flows:
  ticket-assignment:
    title: Ticket assignment
    doc: docs/flows/ticket-assignment.md
    entrypoints: [apps/api/src/routes/ticket-routes.ts]
    files: [apps/api/src/services/ticket-service.ts]
    tests: [apps/api/test/transition.test.ts]
shared:            # cross-cutting files; must list the flows that rely on them
  apps/api/src/db/client.ts: [ticket-assignment, machine-pairing]
unassigned:        # explicit, reasoned exceptions
  - path: scripts/dev-reset.sh
    reason: local dev helper, no runtime flow
```

**Language (owner decision):** all docs prose is Vietnamese. Code identifiers, file paths, flow ids, YAML keys and generated-block markers stay English, so the tooling stays language-neutral. The flow doc template has fixed Vietnamese headings (Mục đích, Điểm vào, Các bước, Files, Dữ liệu, Flow liên quan, Tests), mapped to these meanings:
- Purpose
- Trigger / Entry points
- Steps: a numbered sequence, each step naming its file and symbol
- Files: a table of path, role and key symbols
- Data: tables, events and external calls
- Related flows
- Tests

## Check Rules (`crew-docs check`)

| Rule | What fails |
|------|------------|
| R1 manifest | `flows.yaml` invalid; a listed file, doc or test is missing; duplicate flow ids |
| R2 coverage | A source file (include minus exclude) is in no flow, no `shared` entry and no `unassigned` entry |
| R3 freshness | A non-merge commit adds, modifies, deletes or renames a source file without modifying the `docs/flows/<id>.md` of each affected flow in the same commit. Affected flows: those listing the file before or after the change; for a `shared` file, its listed flows. Merge commits are skipped, because their parent commits are checked |
| R4 generated | The generated blocks in `index.md` or `files.md` differ from `crew-docs generate` |
| R5 initialized | No `flows.yaml` → exit 3 `NOT_INITIALIZED` |
| R6 protected | Outside a docs-init commit, a commit changes `.claude/**`, `.githooks/**`, `CLAUDE.md`, or the `source`, `unassigned` or `shared` sections of `flows.yaml`, and lacks the trailer `Crew-Owner-Approved: <ticket-key>`. The daemon adds that trailer only for tickets whose description the owner marked "config change allowed" |
| R7 secrets | A staged or pushed diff contains a credential. Detection uses a bundled `gitleaks` ruleset where available, with a built-in regex set as fallback |

**Init commit:** the docs-init commit is the commit that adds `docs/flows.yaml` and carries the trailer
`Crew-Docs-Init: true`. It is exempt from R3 and R6. Detection survives rebase and squash. There is no other bypass.

Modes:
- `check --staged`: pre-commit.
- `check --range <base>..<head>`: pre-push and CI, checking every non-merge commit individually.
- `check --all`: R1, R2 and R4 over the whole tree.

## Other Commands

- `crew-docs init`: scaffolds the templates and prints the docs-init checklist.
- `crew-docs generate`: rewrites the generated blocks. Run it after merges.
- `crew-docs where <file>` and `crew-docs flow <id>`: agent lookups.
- `crew-docs install-hooks`: installs once per repo, **in the main checkout**. Worktrees inherit the hooks through the shared git dir.
  - When the repo has no `core.hooksPath` and no hook manager, it sets `core.hooksPath=.githooks` and writes `pre-commit` (`check --staged` plus R7) and `pre-push` (`check --range @{u}..HEAD` plus R7).
  - When husky, lefthook or an existing `core.hooksPath` is detected, it appends one guarded line to that manager's `pre-commit` and `pre-push` instead of replacing them.
  - Idempotent: running it twice changes nothing.
- `crew-docs ci-workflow`: writes `.github/workflows/crew-docs.yml` (runs `check --range` on push and PR). The docs-init ticket commits it.

## Docs Sync to Web

- `PUT /v1/daemon/projects/:key/docs {commit, branch, files:[{path, content}]}`. Only the machine that owns the project may call it.
- Validation:
  - `commit` must match `^[0-9a-f]{40}$`.
  - Each path is normalized and must match `^(docs/[A-Za-z0-9._/-]+\.(md|yaml)|AGENTS\.md)$`.
  - The whole snapshot is capped at 5 MB.
- Stored as the latest snapshot per project (`docs_snapshots`, `docs_files`). Appends `docs.synced` to the owner stream.
- The daemon syncs after every successful merge to the default branch (Phase 7) and after docs init.
- **Web viewer (Confluence-like).** Each project is a **space**, reached from the project sidebar's "Docs" entry:
  - **Page tree** on the left: Tổng quan (`index.md`), Kiến trúc (`architecture.md`), Flows (a child page per flow, sorted by title) and Tra cứu file (`files.md`).
  - **Page view:**
    - breadcrumbs (`Space / Flows / Ticket assignment`);
    - the rendered markdown with anchors on each heading;
    - a sticky **table of contents** on the right;
    - a header line "Cập nhật ở commit `abc1234` lúc …";
    - a "Xem trên GitHub" link.
  - **Flow page extras:** the files table links to `repoUrl/blob/<commit>/<encoded path>`, only when `repoUrl` is `https://`. A **"Ticket liên quan"** panel lists recent tickets whose `flows[]` include this flow, with status lozenges.
  - **Space search:** a search box in the space scoped to that project's snapshot. Global quick search (Phase 4) also returns docs pages.
  - **File lookup:** type a path and see the flows that own it.
  - Responsive: on phone and tablet the page tree moves into a drawer and the table of contents becomes a collapsible "Trên trang này" block at the top. Wide tables and code blocks scroll inside their own box, never the page.
  - Read-only: no editor, because git is the source of truth. An "Chỉnh sửa" hint explains that docs change through commits.
  - Search is an `ILIKE` over snapshot files, with `%` and `_` escaped.

## Related Code Files

Create:
- `packages/docs-kit/src/cli.ts`, `src/manifest.ts`, `src/git.ts` (staged and range diff with `-M`, trailers, merge detection), `src/hook-installer.ts`, `src/secret-scan.ts`, `src/rules/r1-manifest.ts` … `r7-secrets.ts`, `src/generate.ts`, `src/commands/{init,check,generate,where,flow,install-hooks,ci-workflow}.ts`
- `packages/docs-kit/templates/` (AGENTS.md, index.md, architecture.md, flow.md, flows.yaml, crew-docs.yml)
- `packages/docs-kit/STANDARD.md`: the normative spec that agents are pointed at
- `packages/docs-kit/build.mjs` (single-file bundle)
- `packages/docs-kit/test/fixtures/*` and `test/rules.test.ts`, `test/hook-installer.test.ts`
- `apps/api/src/routes/docs-routes.ts`, `apps/api/src/services/docs-service.ts`
- `apps/web/src/routes/project-docs.tsx` (space layout), `apps/web/src/components/docs-page-tree.tsx`, `docs-page-view.tsx`, `docs-toc.tsx`, `flow-view.tsx`, `related-tickets.tsx`, `file-lookup.tsx`
- Platform repo dogfooding: `AGENTS.md`, `CLAUDE.md`, `docs/index.md`, `docs/architecture.md`, `docs/flows.yaml`, `docs/files.md`, `docs/flows/*.md`, `.githooks/pre-commit`, `.githooks/pre-push`

Modify:
- `apps/api/src/db/schema.ts`: add `docs_snapshots` and `docs_files`, and set `projects.docs_status`.
- `.github/workflows/ci.yml` (Phase 8 owns the file): the crew-docs step is added there, with no separate workflow in the platform repo.

## Implementation Steps

1. STANDARD.md, the templates, and the manifest schema.
2. Git helpers (diff, renames, trailers, merge commits), rules R1–R7 as pure functions, and the secret scanner.
3. CLI commands with exit codes: 0 ok, 1 violations (`RULE path: fix hint`), 3 not initialized.
4. The hook installer covering: plain repo, husky, lefthook and a custom `core.hooksPath`; commits from the main checkout and from a worktree; idempotency.
5. The esbuild bundle. `crew-docs --version` works with only an absolute node path.
6. Fixture tests for each rule, pass and fail. Cases:
   - rename, delete, shared file, unassigned file
   - the init commit, including after a squash
   - a merge commit
   - a range with one bad commit
   - R6 with and without the trailer
   - R7 with a fake AWS key
7. The docs sync API with validation, and the web viewer with search.
8. Dogfood: document the platform repo, install the hooks, add the CI step.

## Todo

- [x] STANDARD.md, templates, manifest schema
- [x] Rules R1–R7 and CLI commands
- [x] Hook installer that chains with existing hooks and uses absolute paths
- [x] Single-file bundle
- [x] Fixture tests per rule and per hook setup
- [x] Docs sync endpoint (validated) and a Confluence-like space viewer: page tree, breadcrumbs, table of contents, related tickets, space search, file lookup
- [x] Platform repo dogfoods the standard

## Success Criteria

- A mapped source file committed without its flow doc is blocked by R3, which names the doc. The same commit passes once the doc is edited.
- A new unmapped file fails R2. A commit that edits `.claude/settings.json` without the trailer fails R6. A staged fake credential fails R7 at both commit and push.
- In a husky repo, `install-hooks` keeps husky's hooks running and adds the crew-docs checks. A commit from a worktree runs the same hooks.
- `crew-docs flow <id>` prints exact files, and the web shows the same flow after sync.

## Risk Assessment

- **Strict R3 on tiny edits.** Touching the flow doc is enough, for example tightening a step line. QC judges quality.
- **Glob mistakes.** `check --all` in CI plus the reasoned `unassigned` list.
- **Generated-block conflicts on merge.** The PM merge step runs `crew-docs generate` and commits the result, so the blocks are never merged by hand.

## Security Considerations

- R6 stops agents from widening their own permissions or exemptions through repo config. R7 stops credentials from leaving the machine through git.
- Docs sync uses an allow-list for paths, SHA and URL. The viewer sanitizes markdown and encodes links.
