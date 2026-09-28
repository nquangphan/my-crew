# Phase 5 (Docs Standard and Enforcement): Implementation Report

Date: 2026-09-29 · Status: done · Scope: `packages/docs-kit/**`, `packages/shared/src/**` (additive),
`apps/api/**`, `apps/web/**`, the repo's own `AGENTS.md`, `CLAUDE.md`, `docs/**`, `.githooks/**` and local git
config, lockfile.

## What was built

- **The standard.** `packages/docs-kit/STANDARD.md` (Vietnamese) is the normative spec agents are pointed at.
  Templates live in `packages/docs-kit/templates/`: `AGENTS.md`, `index.md`, `architecture.md`, `flow.md`
  (fixed headings Mục đích, Điểm vào, Các bước, Files, Dữ liệu, Flow liên quan, Tests), `flows.yaml` and the
  CI workflow `crew-docs.yml`. The manifest schema is `FlowsManifest` in `@crew/shared` (`docs-schemas.ts`).
- **`crew-docs` CLI** (`packages/docs-kit/src/`): `cli.ts`, `bin.ts`, `git.ts` (staged and commit diffs with
  `-M`, first parents, messages, merge detection), `tree.ts` (working tree, index and commit readers),
  `manifest.ts`, `generate.ts`, `secret-scan.ts`, `hook-installer.ts`, `rules/r1-manifest.ts` …
  `rules/r7-secrets.ts` (pure functions), `commands/{check,init,generate,where,flow,install-hooks,ci-workflow}.ts`.
- **Single-file bundle.** `pnpm --filter @crew/docs-kit build` (`build.mjs`, esbuild) writes one CommonJS file,
  `packages/docs-kit/dist/crew-docs.cjs` (about 0.8 MB: zod, yaml, picomatch and the templates inlined).
  `node <abs>/crew-docs.cjs --version` works with an empty environment and no PATH (tested).
- **Docs sync API.** Migration `apps/api/drizzle/0002_docs_snapshots.sql` adds `docs_snapshots` (one row per
  project: commit, branch, syncing machine, parsed manifest, size, time) and `docs_files` (path, title, kind,
  flow id, content). `apps/api/src/services/docs-service.ts` and `routes/docs-routes.ts`:
  - `PUT /v1/daemon/projects/:key/docs` (machine token, `Idempotency-Key`), body
    `{commit, branch, files: [{path, content}]}`. Only the machine that owns the project may call it (403
    otherwise). Validation: `commit` must match `^[0-9a-f]{40}$`; each path is normalized (`.` and empty
    segments dropped, `..`, absolute paths and backslashes refused) and must match
    `^(docs/[A-Za-z0-9._/-]+\.(md|yaml)|AGENTS\.md)$`; paths are unique; the files total at most 5 MB (the
    body limit is 6 MB to allow for JSON escaping); `docs/flows.yaml` is required and must parse (duplicate
    keys refused) and match `FlowsManifest`. A sync replaces the previous snapshot, sets
    `projects.docs_status = 'ready'` and appends `docs.synced {projectId, commitSha}` to the owner stream.
    Response: `{projectId, commit, branch, syncedAt, fileCount}`.
  - Owner reads: `GET /v1/projects/:id/docs` (page tree summary and manifest), `GET
    /v1/projects/:id/docs/page?path=`, `GET /v1/projects/:id/docs/search?q=` (ILIKE over title, path and
    content, `%` and `_` escaped, with a snippet). `GET /v1/search` now fills `docs` too.
  - `likePattern` moved to `services/like-pattern.ts` (re-used by ticket and docs search, no import cycle).
- **Web docs space** (`apps/web`, built by a delegated engineer against the contract above): each project is a
  Confluence-like space: page tree (Tổng quan, Kiến trúc, Flows sorted by title, Tra cứu file, then "Khác"),
  breadcrumbs, sanitized markdown with heading anchors, a sticky "Trên trang này" table of contents, the
  "Cập nhật ở commit `abc1234` lúc …" line, "Xem trên GitHub" only for `https://` repos, flow pages with a
  "File của flow" table (links to `repoUrl/blob/<commit>/<encoded path>`) and "Ticket liên quan" with status
  lozenges, space search, file lookup (uses the shared `flowsForPath`), and a read-only "Chỉnh sửa" hint. On
  phone and tablet the tree is a drawer and the TOC is a collapsed block; wide tables and code blocks scroll in
  their own box. Files: `routes/project-docs.tsx`, `components/docs-page-tree.tsx`, `docs-page-view.tsx`,
  `docs-toc.tsx`, `flow-view.tsx`, `related-tickets.tsx`, `file-lookup.tsx`, `lib/docs-space.ts`; the
  placeholder `routes/docs.tsx` is gone and `lib/docs-links.ts` keeps its URL shape.
- **Shared contracts** (`packages/shared/src/docs-schemas.ts`, additive): `FlowId`, `FLOWS_MANIFEST_PATH`,
  `flowsForPath()` (used by `crew-docs where`, `files.md` generation and the web file lookup),
  `normalizeDocsPath()`, `DOCS_SYNC_PATH_RE`, `DOCS_SNAPSHOT_MAX_BYTES`, `CommitSha`, `DocsSyncRequest`,
  `DocsSyncResponse`, `DocsSnapshotInfo`, `DocsPageKind`, `DocsPageSummary`, `DocsSpaceResponse`,
  `DocsPageResponse`, `DocsSearchResponse` and their query schemas.
- **Dogfooding.** The repo now has `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`), `docs/index.md`,
  `docs/architecture.md`, `docs/flows.yaml` (13 flows covering every source file, 6 shared files, 1 unassigned:
  the daemon placeholder), generated `docs/files.md` and `docs/flows/*.md`, all in Vietnamese. The flow docs
  were written by a delegated sonnet agent and checked by `crew-docs check --all`. The hooks are installed
  (see "Hook setup in this repo").

## CLI surface (for Phases 6, 7 and 9)

| Command | What it does | Exit codes |
|---|---|---|
| `crew-docs check --staged` | pre-commit: R1, R2, R4 on the index; R3 on the staged diff (skipped when the index adds `docs/flows.yaml`, or while a merge is concluded); R7 on the added lines | 0, 1, 3 |
| `crew-docs check --commit-msg <file>` | commit-msg: R6 on the staged diff with the message's trailers; the docs-init commit (adds `flows.yaml` + `Crew-Docs-Init: true`) and merges pass | 0, 1, 3 |
| `crew-docs check --range <base>..<head>` | R1, R2, R4 on the `<head>` commit; R3, R6, R7 on every non-merge commit in the range, oldest first; commits from before the docs init are skipped | 0, 1, 3 |
| `crew-docs check --pre-push [remote url]` | pre-push: reads git's ref lines from stdin; `<remote sha>..<local sha>` per ref, or every commit no remote-tracking ref has for a new branch; deletions skipped | 0, 1, 3 |
| `crew-docs check --all` | R1, R2, R4 over the working tree (untracked, non-ignored files count) | 0, 1, 3 |
| `crew-docs init [--flow <id> [--title <t>]]` | scaffolds the standard without overwriting, writes the generated blocks, prints the docs-init checklist; `--flow` writes `docs/flows/<id>.md` from the template | 0, 2 |
| `crew-docs generate` | rewrites the generated blocks of `docs/index.md` and `docs/files.md` | 0, 1 (invalid manifest), 3 |
| `crew-docs where <file>` | one line per owning flow: `<flow-id>\t<role>\t<doc>\t<title>` (role `entrypoint`, `file`, `test`, `shared`), or `unassigned\t<reason>` | 0; 1 when a source file is in no flow (prints an R2 line); 3 |
| `crew-docs flow <id>` | `flow:`, `title:`, `doc:`, then `entrypoints:`, `files:`, `tests:`, `shared:` lists (`  - <path>`) | 0; 1 unknown flow; 3 |
| `crew-docs install-hooks [--runtime <abs>] [--bundle <abs>]` | see below; defaults: the running `node` and the running bundle | 0; 2 on a relative/missing runtime or bundle, or when run in a linked worktree |
| `crew-docs ci-workflow [--bundle <abs>]` | writes `.github/workflows/crew-docs.yml` and vendors the bundle to `.github/crew-docs/crew-docs.cjs` | 0, 2 |
| `crew-docs --version` | prints the package version (`0.1.0`) | 0 |

Exit codes everywhere: `0` ok, `1` violations, `2` usage or git error, `3` NOT_INITIALIZED.
Output: one violation per line on stdout, `RULE path: message` where the message ends with the fix, plus
` [commit abc1234]` in range and pre-push modes. A summary goes to stderr:
`crew-docs check --<mode>: ok (N commits)`, `…: N violation(s)…` or `…: NOT_INITIALIZED`. The R5 line is
`R5 docs/flows.yaml: NOT_INITIALIZED: …`.

Trailers are read from any line of the message, so they survive rebase and squash:
`Crew-Docs-Init: true` (the commit that adds `docs/flows.yaml`) and `Crew-Owner-Approved: <KEY-123>`.

### Hook installer

- The runtime and bundle paths are stored as absolute paths in local git config (`crew-docs.runtime`,
  `crew-docs.bundle`), shared by every worktree. Each hook runs
  `ELECTRON_RUN_AS_NODE=1 "$(git config --get crew-docs.runtime …)" "$(git config --get crew-docs.bundle …)" check …`,
  so committed hook files are identical on every machine and PATH never matters. A machine without the config
  fails closed with `/crew-docs-runtime-not-configured: No such file…`. Phase 9 passes
  `--runtime <app binary>`.
- Plain repo: `core.hooksPath=.githooks` plus `.githooks/{pre-commit,commit-msg,pre-push}`.
- husky: the guarded line (marker `# crew-docs:<hook>`) goes into `.husky/<hook>`, and a relative
  `core.hooksPath` (`.husky/_`) is made absolute, because husky's runner dir is gitignored and linked worktrees
  would otherwise run no hooks at all.
- lefthook: a `crew-docs` command is added under each hook in the lefthook config (comments and other commands
  kept; `use_stdin: true` for pre-push, `{1}` for commit-msg), then `lefthook install` runs when a binary is
  found.
- An existing `core.hooksPath` or existing scripts in `.git/hooks`: the line is inserted in place.
- The line always goes right after the shebang, so an existing hook's own `exit 0` cannot skip it. Re-running
  changes nothing (tested by comparing hook files, modes and local config).

## Tests

- `packages/docs-kit`: 36 tests in `test/rules.test.ts` and `test/hook-installer.test.ts`, all on real temp git
  repos with an isolated git config (fixture `test/fixtures/basic`). Temp dirs are removed after each test.
  - Rules, pass and fail: R1 (bad YAML, duplicate flow id, missing file, unknown shared flow, bad doc path),
    R2 (`--all` and `--staged`), R3 (edit, rename, delete, shared file, unassigned file, one bad commit in a
    range tagged with its SHA, merge commits skipped), the docs-init commit (with and without the trailer,
    after a squash that buries the trailer, history before the init), R4, R5 in every mode, R6 with and
    without the trailer (`.claude/settings.json`, protected manifest sections vs the `flows` section), R7 with
    a fake AWS key at commit and in a range, the diff parser, a stub gitleaks binary, `where`, `flow`, `init`,
    usage errors.
  - Hooks through the real bundle and real `git commit` / `git push`: plain repo (R3, R6 and R7 blocked at
    commit, R7 and R3 blocked at push to a bare remote, clean push accepted), idempotency, a commit from a
    linked worktree, install refused in a worktree, fail-closed without runtime config, input validation,
    a merge of approved config changes, real husky 9 (its own hook still runs, worktree covered), real
    lefthook 2 (existing command kept, R3 and R6 enforced), a custom `core.hooksPath` and existing
    `.git/hooks` scripts.
- `packages/shared`: `docs-schemas.test.ts` (path normalization, sync body validation, 5 MB cap,
  `flowsForPath`).
- `apps/api`: `test/docs-sync.test.ts` (10 tests): storage and page classification, replace semantics, owner
  machine only, auth and idempotent replay, SHA/path/manifest/size validation, owner reads, space search with
  wildcards escaped, global search, owner-only access. API total 136.
- `apps/web`: 58 unit tests (20 new for the docs space) and the E2E suite (7 tests, new
  `e2e/docs-space.spec.ts` at 390×844, 820×1180 and 1440×900 seeding a snapshot through the real daemon
  endpoint).

From the root, `pnpm -r typecheck`, `pnpm -r test`, `pnpm lint` and `pnpm -r build` pass, and
`crew-docs check --all` passes on this repo.

## Hook setup in this repo

- `git config --local core.hooksPath .githooks` (relative, as the phase specifies), with
  `.githooks/pre-commit`, `.githooks/commit-msg` and `.githooks/pre-push` (untracked until the next commit).
- `crew-docs.runtime` = the absolute `node` used to install (nvm's Node 24), `crew-docs.bundle` =
  `<repo>/packages/docs-kit/dist/crew-docs.cjs`. If the bundle is missing (fresh clone, cleaned build) the
  hooks fail closed; run `pnpm --filter @crew/docs-kit build`, or `crew-docs install-hooks` again after a Node
  upgrade.
- **A plain `git commit` from the controller runs the checks.** The next commit must be the docs-init commit:
  commit everything (code, docs, `.githooks`, `CLAUDE.md`) in one commit whose message contains the line
  `Crew-Docs-Init: true`. Without that line, commit-msg fails R6 (the new manifest sections, `CLAUDE.md` and
  `.githooks/**` are protected). A commit that leaves `docs/flows.yaml` unstaged fails with exit 3
  NOT_INITIALIZED, because HEAD has no manifest yet.
- After that commit, every code change needs its flow doc (R3). Changes to `.claude/**` (AgentKit updates),
  `.githooks/**`, `CLAUDE.md` or the protected manifest sections need a `Crew-Owner-Approved: <KEY-n>` trailer.
  `git commit --no-verify` still bypasses local hooks, as with any git hook; pre-push and CI are the backstop.

## Deviations and decisions

1. **A third hook, commit-msg.** Git does not expose the message to pre-commit, so R6 and the init-trailer
   check run in `check --commit-msg`. pre-commit skips R3 only when the index adds `docs/flows.yaml`; range
   mode (pre-push, CI) re-checks both with the real message.
2. **pre-push reads git's ref lines** instead of `@{u}..HEAD`, so a new branch (no upstream) and pushes of
   other refs are checked too. `check --range` stays for CI and the Phase 7 gate.
3. **Hook paths live in local git config**, not in the hook text, so the committed hooks work on any machine
   and the runtime path stays explicit and absolute.
4. **Wider R6 list.** Besides `.claude/**`, `.githooks/**`, `CLAUDE.md` and the three manifest sections, R6
   protects the files that wire crew-docs in: `.husky/**`, lefthook configs, a custom `core.hooksPath` dir
   inside the repo, `.github/workflows/crew-docs.yml` and `.github/crew-docs/**`. Otherwise an agent could
   remove its own gate.
5. **R7.** A built-in ruleset ported from gitleaks' defaults (AWS, GitHub, GitLab, Slack, Stripe, Google,
   OpenAI, Anthropic, npm, private keys, JWT) plus 2P Crew machine tokens always runs; if `gitleaks` is on
   PATH its full ruleset runs too (`gitleaks stdin`). There is no inline allow marker. Tests assemble fake
   keys at runtime.
6. **R1 extras:** unknown flow ids in `shared`, a doc outside `docs/**.md`, and a path both unassigned and
   mapped are reported. Paths in the manifest are exact files (no globs), which keeps R3 and `where` exact.
7. **CI.** `crew-docs ci-workflow` vendors the bundle into `.github/crew-docs/` so the workflow needs no
   network or package registry. For the platform repo itself, `.github/workflows/ci.yml` belongs to Phase 8
   and was not created here (see below).
8. **Sync needs `docs/flows.yaml`.** A snapshot without a valid manifest is refused, because the space's flow
   pages and file lookup come from it. `docs_status` is set to `ready` on sync; the `missing` and
   `initializing` states are for the daemon (Phases 6 and 7) to report.
9. **Merge commits** are skipped by R3 and R6 in every mode, including a `git merge` concluded through the
   hooks (their commits were checked individually).
10. **Web deviations** (from the delegated engineer): the leading `# Title` line is not rendered twice; a
    "File của flow" section is added to flow pages; `useDebounced` moved to `lib/ui-state.ts`; heading ids
    are added after sanitizing, without the `user-content-` prefix, so TOC links and anchors agree.

## Left undone

- **Platform CI step.** Phase 8 owns `.github/workflows/ci.yml`; it must add
  `node packages/docs-kit/dist/crew-docs.cjs check --range "$BASE..$HEAD"` (after
  `pnpm --filter @crew/docs-kit build`, with `fetch-depth: 0`) and `check --all`. The generated
  `crew-docs.yml` template shows the base/head selection for push and pull_request events.
- Installing the bundle to `~/.crew/bin` and `doctor` checks are Phase 6 and 9 work. This repo's hooks point
  at the in-repo build output instead.
- `plans/` was off limits except for this report, so the phase file's todo boxes are unchanged.

## Unresolved questions

- Should R6 also protect the dogfooded `docs/flows.yaml` `flows` section of a project? The phase keeps it
  writable so the docs-update job can map new files; this report follows the phase.
- The plain setup uses the relative `core.hooksPath=.githooks` from the phase. A linked worktree whose branch
  predates the `.githooks` commit runs no hooks until it is rebased; pre-push and CI still catch it. Switch to
  an absolute path if daemon worktrees can start from older bases.
