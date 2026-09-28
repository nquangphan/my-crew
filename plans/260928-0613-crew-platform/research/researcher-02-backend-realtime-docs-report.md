# Backend, Realtime Delivery, Auth, Data Model, and Docs-for-Agents Standard

Research for: Jira/Confluence-like system for AI agents, single human owner, VPS-hosted TS pnpm monorepo (React + Node API + Postgres), NAT'd local-machine daemons running Claude Code agents.

## 1. Daemon <-> VPS connectivity behind NAT

**Constraint that decides the shape of the answer:** every daemon sits behind NAT, so the VPS can never open a connection to a daemon. All transports here are daemon-initiated (outbound), which is exactly what WebSocket, SSE, and long-polling all support; the only real design question is which one, plus how delivery is made reliable and resumable. This is consistent across independent write-ups on the topic ([fratepietro.com](https://www.fratepietro.com/2025/websocket-sse-longpolling/), [caduh.com](https://www.caduh.com/blog/long-polling-vs-websockets-vs-sse), [formation.dev](https://formation.dev/blog/server-push-websockets-sse-polling)).

**Transport comparison:**

| Transport | Direction | NAT fit | Complexity | Notes |
|---|---|---|---|---|
| Outbound WebSocket | Bidirectional | Good — single long-lived outbound TCP connection | Medium (needs ping/pong keepalive, reconnect logic) | Best fit when the daemon must also receive assignment pushes and send status in the same channel |
| SSE + REST | Server push one-way, writes via separate REST calls | Good — plain HTTP, survives most proxies | Low | Server push, client actions via normal POST; no separate socket protocol to debug |
| Long polling | Request/response looped | Good but wasteful | Low conceptually, higher operational noise | Widely regarded as rarely worth it in 2025-2026 write-ups once SSE is available ([fratepietro.com](https://www.fratepietro.com/2025/websocket-sse-longpolling/)) |

Idle NAT/firewall sessions get dropped after roughly 60-300 seconds of inactivity in typical gateways, so whichever transport is chosen needs a heartbeat: SSE comments/pings every ~25s, WebSocket ping frames every ~30s with pong timeout, long-poll server timeouts capped around 55s ([fratepietro.com](https://www.fratepietro.com/2025/websocket-sse-longpolling/)).

**Recommendation:** SSE (VPS -> daemon push of new assignments/events) + plain REST (daemon -> VPS for comments/status/report writes). This is simpler to operate than WebSocket (no socket-specific proxy/Caddy config beyond normal HTTP streaming, no framing protocol, ordinary HTTP auth headers per request) and is sufficient because the daemon-to-VPS traffic is low-volume and not bidirectional-in-the-same-frame. Keep WebSocket only if a future requirement needs the VPS to interrupt/cancel a running agent with sub-second latency; for ticket assignment and comment relay, SSE's push latency is irrelevant.

**Reliable delivery — outbox + ack + cursor, regardless of transport chosen:**

- Write every outbound event (ticket assigned, comment posted, status changed) into an **outbox table** in the same DB transaction as the business write. A separate relay reads the outbox and pushes it out; consumers must be idempotent since delivery is at-least-once ([microservices.io](https://microservices.io/patterns/data/transactional-outbox.html), [Conduktor](https://www.conduktor.io/glossary/outbox-pattern-for-reliable-event-publishing), [softwarecraftsperson.com](https://www.softwarecraftsperson.com/posts/2025-10-08-transactional-outbox-pattern/)).
- Each event carries a monotonically increasing id (a plain bigserial/sequence is enough at this volume). The daemon persists the last-processed id locally and, on reconnect, calls `GET /events?since=<cursor>` to replay anything missed — this is the standard cursor/resume-token approach for resumable transports ([softwarecraftsperson.com](https://www.softwarecraftsperson.com/posts/2025-10-08-transactional-outbox-pattern/)).
- Per-event ack: the daemon acks (or the assignment/comment write itself acts as the ack) so the VPS can mark the outbox row delivered; unacked rows are redelivered on a timer. No need for a full lease/visibility-timeout worker-pool model (that matters at high concurrency with many competing consumers) — here each daemon is the sole consumer of its own event stream, so a simple per-daemon cursor plus ack is enough. Add a lease/visibility-timeout only if multiple daemons could ever race to claim the same ticket concurrently.

**Postgres-native queue vs Redis-native queue:** Given the stack already has Postgres and the volume is low (a handful of agents, not thousands of jobs/sec), adding Redis purely for BullMQ is unjustified operational surface. The current comparative material is consistent: pg-boss and Graphile Worker both use `SKIP LOCKED` for safe concurrent claim with full ACID guarantees inside the existing database; BullMQ/Redis wins only at high throughput or when Redis is already part of the stack ([hookdeck.com](https://hookdeck.com/webhooks/platforms/bullmq-alternatives-for-webhook-retries), [dev.to/aws-builders](https://dev.to/aws-builders/i-removed-redis-from-my-stack-and-used-postgresql-for-job-queues-instead-2lp5)). Between pg-boss and Graphile Worker: Graphile Worker leans harder on LISTEN/NOTIFY for low-latency wakeup and lets you enqueue jobs from SQL/transactions directly; pg-boss provides a more complete surrounding job system (archiving, cron/RRULE scheduling, dead-letter queues with redrive, job-dependency workflows) and is the more actively maintained/documented option (4,000+ GitHub stars, Node 22.12+/Bun support, ongoing commits) confirmed directly from its own repository ([github.com/timgit/pg-boss](https://github.com/timgit/pg-boss)).

**Recommendation:** Do not add Redis. Use a hand-rolled outbox table (bigserial id, payload, target daemon/project, delivered_at, attempt_count) drained by a lightweight internal loop using Postgres `LISTEN/NOTIFY` to wake a worker immediately, falling back to a short poll interval as a safety net. Reach for **pg-boss** only if you want its batteries (retries/backoff, DLQ, cron) rather than writing that logic yourself — at this scale a custom outbox table is genuinely simpler to reason about than adopting a job-queue library's full model, and KISS favors it unless retry/backoff/DLQ semantics are needed immediately. If you do want the library, pg-boss over Graphile Worker for its more complete retry/DLQ/scheduling feature set and current maintenance activity.

## 2. Backend framework, ORM, and web stack

**Backend framework — Fastify vs NestJS vs Hono:**

Raw throughput differences are real but rarely the bottleneck (DB queries and agent-orchestration logic dominate response time here) ([Hono benchmarks](https://hono.dev/docs/concepts/benchmarks)). The real axis is "how much framework do you want":
- **Hono**: lightweight, Web-Standards-based, edge-native; best when deploying to edge runtimes (Cloudflare Workers/Deno) — not the case here, since this is a single VPS running long-lived Node processes.
- **Fastify**: mid-weight, first-class TypeScript support, built-in JSON-schema request/response validation, plugin ecosystem (auth, CORS, rate-limit, SSE-friendly streaming), minimal opinion — matches a small team building one API.
- **NestJS**: heavyweight, DI/module architecture, largest ecosystem — valuable for large teams and long-lived enterprise codebases with many contributors, but adds structural overhead (modules, decorators, DI container) that a single-owner project doesn't need.

**Recommendation: Fastify.** It has native SSE/streaming support, first-class schema validation for the ticket/comment/event API surface, and low ceremony appropriate for a single-owner codebase that AI agents will also be reading/editing (less indirection than Nest's DI graph is easier for an agent to reason about locally). Treat the specific benchmark numbers found in aggregator/SEO-style comparison sites (e.g., pkgpulse.com, ecosire.com, tech-insider.org) as directional only, not verified — cross-check any hard throughput number against the frameworks' own docs before quoting it externally.

**ORM — Drizzle vs Prisma:**

Both are credible and widely used. Drizzle generates SQL directly with a thin runtime (no separate query-engine process), smaller footprint, and a schema-as-TypeScript approach that maps cleanly onto a self-referencing `parent_id` ticket hierarchy. Prisma's `prisma migrate` is more guardrailed (warns on destructive migrations, tracks migration state formally) and its schema DSL is arguably more approachable, but that guardrailing matters most for larger teams; a single owner reviewing every migration by hand loses less from Drizzle's more manual, explicit SQL-like approach ([bytebase.com](https://www.bytebase.com/blog/drizzle-vs-prisma/), [makerkit.dev](https://makerkit.dev/blog/tutorials/drizzle-vs-prisma)). For a self-hosted VPS (not edge), Drizzle's bundle-size/perf edge matters less than for edge deployments, but its directness and lack of a generated query-engine binary are still an operational simplification.

**Recommendation: Drizzle** — pairs naturally with Fastify (both minimal, explicit), and its migration files are plain SQL that an AI agent (and you) can read/audit directly, which matters for a system whose ticket/comment history other agents will need to reason about.

**Web app — React+Vite+TanStack Router/Query vs Next.js:**

Next.js brings SSR/RSC, its own routing conventions, and a larger deployment surface (Node server with framework-specific build output) that mostly pays off for public-facing, SEO-sensitive, multi-tenant apps. This is a single-user internal dashboard behind auth — there is no SEO requirement and no need for server components. A Vite SPA with TanStack Router (end-to-end typed routes/params) and TanStack Query (server-state caching, works well with SSE-driven invalidation) is simpler to deploy (static build served by Caddy, no separate Node SSR runtime for the frontend) ([kylegill.com](https://www.kylegill.com/essays/next-vs-tanstack/), general 2026 comparison consensus across multiple sources for internal/dashboard-style apps).

**Recommendation: React + Vite + TanStack Router + TanStack Query.** Simpler ops (static assets behind Caddy, no Next server process to manage), fully typed routing, and TanStack Query pairs naturally with an SSE-based live-update model (invalidate queries on incoming events).

## 3. Auth, HTTPS, deployment, backups

**Owner login:** Given this is a single human owner, avoid over-engineering multi-user auth infrastructure (no OAuth/OIDC provider needed). Two viable, complementary options:
- **Password + server-side session** (session id in an httpOnly, secure, SameSite cookie; session record in Postgres or an in-memory store). Sessions are trivially revocable (delete the row) which matters more than statelessness for a single-user system with no horizontal scaling need — the stateless-JWT tradeoff (easy horizontal scaling, harder revocation) is irrelevant here since there's exactly one owner and one API instance ([authgear.com](https://www.authgear.com/post/nodejs-security-best-practices/)).
- **Passkey (WebAuthn)** as the primary or secondary factor: phishing-resistant, no password to leak, backed by the device's platform authenticator. `@simplewebauthn/server` is the commonly recommended Node library, with documented Fastify/Express integration guides ([freecodecamp.org](https://www.freecodecamp.org/news/set-up-webauthn-in-node-js-for-passwordless-biometric-login/)).

**Recommendation:** Passkey as the primary login (register one passkey on your primary device/browser), with a password fallback stored via a strong KDF (argon2id) for account recovery, both backed by a server-side session cookie (not JWT — no scaling need, and immediate revocation is valuable for a system that controls automated agents).

**Per-machine device tokens:** Treat each daemon as a distinct principal. Issue an opaque token (long random string) at registration time, shown once, and store only its hash (argon2id or sha256 is commonly used for this purpose since it's not a password but still should not be recoverable from a DB dump) ([design pattern corroborated across several implementation write-ups](https://dev.to/monocloud_admin/protecting-nodejs-apis-audiences-scopes-and-bearer-tokens-1dg3)). Each token record should carry: owning machine id, allowed project scopes, created_at, last_used_at, revoked_at. Check revocation and expiry **at verification time on every request**, not only at issuance — a revoked token that keeps working until natural expiry defeats the point of "revocable" ([oneuptime.com](https://oneuptime.com/blog/post/2026-01-30-how-to-build-api-authentication-patterns/view)). Scope tokens to the specific projects the daemon registered ownership of; reject requests for tickets/projects outside that scope with 403.

**HTTPS / reverse proxy:** Caddy in front of the Node API and the static web build, in the same Docker Compose stack. Caddy's automatic HTTPS (Let's Encrypt/ZeroSSL cert issuance and renewal) needs only a domain name in the Caddyfile; standard compose pattern maps 80/443 (+443/udp for HTTP/3) into the Caddy container, and internal services are reached by Compose service name (e.g., `api:3000`), keeping Postgres off the public network entirely ([oneuptime.com](https://oneuptime.com/blog/post/2026-01-16-docker-caddy-automatic-https/view), [dev.to/amorizz](https://dev.to/amorizz/put-self-hosted-exception-tracking-behind-caddy-keep-postgres-off-the-host-3gpo)).

**Postgres backups:** Scheduled `pg_dump` (or `pg_dumpall` for roles/globals) to a separate volume/off-box location (object storage or another host) on a cron, with periodic restore testing. This is the standard baseline for single-instance self-hosted Postgres; the search did not surface a materially different 2026 best practice for a system at this scale — WAL-archiving/PITR (e.g., via `pgbackrest`) is the natural next step only once data loss tolerance drops below "a day," which is unlikely to matter for a single-owner internal tool. Flag this as a judgment call rather than a sourced recommendation, since the search results for this specific sub-question were thin (see Unresolved Questions).

## 4. Data model essentials

Corroborated by both Jira's own documented hierarchy model and general issue-tracker schema write-ups ([tempo.io](https://www.tempo.io/products/project-portfolio-management-software-ppm/jira-hierarchy), [databasesample.com](https://databasesample.com/database/jira-database)):

- **`tickets`** table: self-referencing `parent_id` (nullable) is the standard way to express ticket -> subtask hierarchy without a separate join table; Jira itself uses exactly this pattern plus a `hierarchy_level` concept if you need epic/story/subtask ordering. Columns: `id, project_id, parent_id, type, title, description, status_id, priority, reporter (human or agent), assignee_agent_role, assignee_machine_id, created_at, updated_at, resolved_at`.
- **Assignee modeling**: since an assignee here is "an agent role (assistant/PM/dev/QC) on a specific machine, for a specific project," model this as a foreign key to a `machine_project_assignments` (or `agent_bindings`) table — `(machine_id, project_id, role)` — rather than a flat `assignee_id` on the user table. This reflects that a ticket's assignee is really a (role, machine, project) triple, and machines register/deregister project ownership independently of any single ticket.
- **`comments`** table: `ticket_id, author_kind (human|agent_role), author_ref, body, created_at` — a flat thread ordered by `created_at` is sufficient for Q&A between PM agent and human; no need for nested replies unless a concrete requirement emerges.
- **Status workflow**: a small fixed enum (e.g., `todo -> in_progress -> in_review -> done`, plus `blocked`) is enough for a single-owner system; avoid Jira's fully configurable workflow-scheme complexity (YAGNI) unless multiple distinct workflows per project type become an actual requirement.
- **Reports on Done**: model as a `ticket_reports` table (or a typed attachment: `ticket_id, kind, content_ref/path, created_at`) rather than overloading the comment thread, since reports are structured artifacts from the agent run, distinct from conversational Q&A, and should be independently retrievable when a ticket moves to Done.
- **Audit/event log**: a single append-only `events` table (this doubles as the outbox described in Section 1) with `id (bigserial), ticket_id, actor_kind, actor_ref, event_type, payload (jsonb), created_at` gives you both the audit trail and the delivery mechanism for daemon notification from one source of truth — do not build two separate tables for "audit log" and "outbox," that violates DRY when they're the same append-only stream with different consumers (UI audit view vs. daemon delivery).

## 5. "Always up-to-date docs" standard for agent-consumed codebases

**Existing approaches surveyed:**

- **AGENTS.md** — an open, vendor-neutral format (originated at OpenAI, now stewarded by the Agentic AI Foundation under the Linux Foundation, adopted across 60,000+ repos) for giving coding agents build/test/convention instructions. It is unopinionated about structure/required sections and is read by the nearest file in the directory tree, so subprojects can override ([agents.md](https://agents.md/), [github.com/agentsmd/agents.md](https://github.com/agentsmd/agents.md)). It is a good *entry-point* file (where do I start, how do I build/test) but is not designed to map "flow -> files," so it does not by itself solve the docs-freshness problem you're describing.
- **llms.txt** — a markdown convention (H1 title, blockquote summary, H2-delimited link lists to detail pages) meant to give an LLM a small, curated index into a larger docs set, keeping the entry file inside a small context budget while linking out to full detail pages ([llmstxt.org](https://llmstxt.org/)). Structurally, this is close to what you're describing for `docs/index` — a single small index file with links, not the mechanism that keeps those links correct as code changes.
- **Aider's repo map** — a different approach: instead of hand-maintained docs, Aider builds a *code-derived* map automatically via tree-sitter parsing (previously ctags), ranking files/symbols by a dependency graph so the most-referenced definitions surface first, keeping the map inside the LLM's context budget ([aider.chat/docs/repomap.html](https://aider.chat/docs/repomap.html), [aider.chat/2023/10/22/repomap.html](https://aider.chat/2023/10/22/repomap.html)). This is generated on every run, so it never goes stale — but it describes *symbols*, not *flows/features*, so it doesn't replace a "docs/flows/<flow>.md" style human-authored index that explains intent and business logic, only the raw code shape.
- **Docs-as-code / CI enforcement** — the general pattern found across multiple sources is: docs live in the same repo as code, are edited as markdown, and CI is configured to fail when code changes aren't accompanied by doc changes, or when docs contradict a published spec ([dev.to/dailycontext](https://dev.to/dailycontext/optimizing-for-agents-with-llmstxt-14l0), general docs-as-code consensus). Concrete "enforce that every commit touching file X also touches its doc" implementations are not a well-established off-the-shelf tool — most of what's out there (docstring-coverage tools like `interrogate`, doc-build-on-changed-paths CI triggers) checks that *some* doc exists or that docs *build*, not that a specific changed source file is *referenced* in a specific flow index. This appears to be a genuine gap: expect to build this validation script yourself rather than adopt an existing one.

**Proposed concrete standard** (synthesizing the above into something buildable):

1. **`docs/index.md`** — llms.txt-style root index: H1 title, one-paragraph summary, H2 sections linking to `docs/flows/*.md` and any reference docs. Small, hand-curated, rarely changes.
2. **`docs/flows/<flow-name>.md`** — one file per business flow/feature (e.g., `ticket-assignment.md`, `agent-registration.md`), each containing a short description plus an explicit **file list**: the source files that implement that flow. This is the human-meaningful layer llms.txt and Aider's repo map both lack.
3. **`docs/flows.yaml`** (machine-readable manifest) — mirrors the same flow -> files mapping in structured form:
   ```yaml
   flows:
     ticket-assignment:
       doc: docs/flows/ticket-assignment.md
       files:
         - apps/api/src/routes/tickets.ts
         - apps/api/src/services/assignment.ts
         - apps/daemon/src/handlers/assign.ts
   ```
   This is the file a validation script parses; the `.md` file is for humans/agents to read, the `.yaml` is the contract a script checks against.
4. **Validation algorithm** (runs in a git pre-commit or commit-msg hook, and again in CI as the authoritative gate — pre-commit is a convenience/fast-fail, CI is what actually blocks merges):
   - Compute the changed file set for the commit/PR (`git diff --name-only <base>...<head>`).
   - Load `docs/flows.yaml`; build a reverse index of file -> flow(s).
   - For each changed source file (filtered to source directories, excluding test/config/generated paths): if the file appears in at least one flow's file list, pass. If not, fail with a message telling the author to either add it to an existing flow's file list or create a new flow doc.
   - Separately, for each flow whose file list changed in this commit, require that the flow's `.md` doc's own content (not just its YAML entry) was also touched in the same commit — this is the actual "docs must be updated" enforcement, not just "docs must exist." A cheap version: require the flow `.md` file's mtime/diff-hash to appear in the changed-file set whenever its file list in YAML changes.
   - New files with no flow assignment yet (e.g., mid-refactor scratch files) can be exempted via a `docs/flows.yaml` `unassigned:` allowlist with a required inline comment explaining why, so the check doesn't block legitimate WIP but does make "forgot to document" visible and explicit rather than silently passing.
5. Keep `AGENTS.md` at the repo root for build/test/convention instructions (the "how do I work in this repo" layer) separate from `docs/index.md` (the "what does this system do, where do I look" layer) — they answer different questions and both existing conventions are worth keeping rather than merging.

This design directly answers your ask (single docs structure, per-flow index, manifest, pre-commit + CI enforcement) using the primitives that already have real adoption (llms.txt's small-index-with-links shape, AGENTS.md's agent-instructions convention) while acknowledging that the specific "flow ownership of files, enforced" mechanism has no existing off-the-shelf tool to adopt — it needs a small custom script (a few dozen lines: YAML parse + git diff + set membership), which is itself consistent with KISS.

## Recommendations summary

1. **Transport**: SSE (push) + REST (writes), not raw WebSocket — lower operational complexity, sufficient for low-volume ticket/comment traffic.
2. **Reliable delivery**: custom outbox table (doubles as audit/event log) with bigserial cursor + per-daemon ack + LISTEN/NOTIFY wakeup. Skip Redis/BullMQ entirely; consider pg-boss only if you want its retry/DLQ/cron machinery for free.
3. **Backend**: Fastify. **ORM**: Drizzle. **Web**: React + Vite + TanStack Router + TanStack Query (not Next.js).
4. **Auth**: passkey (WebAuthn via `@simplewebauthn/server`) as primary owner login with password+argon2id fallback, server-side session cookie (not JWT). Per-machine opaque tokens, hashed at rest, scoped to project(s), revocation/expiry checked on every request.
5. **Deployment**: Docker Compose with Caddy for automatic HTTPS + reverse proxy, Postgres kept off the public network; scheduled `pg_dump` to off-box storage as the backup baseline.
6. **Data model**: self-referencing `tickets.parent_id` for hierarchy; assignee modeled as `(machine_id, project_id, role)` binding, not a flat user FK; single append-only `events` table serving as both audit log and delivery outbox; separate `ticket_reports` table for Done-stage artifacts distinct from the `comments` thread.
7. **Docs-for-agents standard**: `docs/index.md` (llms.txt-style root) + `docs/flows/<flow>.md` (human-readable per-flow file lists) + `docs/flows.yaml` (machine-readable manifest) + a custom git-diff-vs-manifest validation script run in pre-commit and CI, alongside a root `AGENTS.md` for build/convention instructions (different purpose, keep both).

## Limitations / what this did not cover

- Did not benchmark Fastify/Hono/NestJS or Drizzle/Prisma directly; relied on published comparisons, several of which come from content/SEO-oriented sites (pkgpulse.com, ecosire.com, tech-insider.org, kostra.io) whose methodology is unverified — treat their specific throughput numbers as directional, not authoritative. Where possible this report cross-checked against primary sources (Hono's own benchmarks page, pg-boss's own repository).
- Did not research Postgres point-in-time-recovery/WAL-archiving tooling (e.g., pgBackRest, WAL-G) in depth; only baseline `pg_dump` scheduling is covered. If RPO tighter than ~24h is ever needed, that's a follow-up research item.
- Did not evaluate a specific WebAuthn/passkey library beyond `@simplewebauthn/server`, nor design the exact session-store schema.
- Did not find an existing off-the-shelf tool that implements "changed source file must be referenced in a flow index" — this is proposed as a small custom script, not a verified adopted pattern from another organization; treat it as a design proposal to prototype, not a proven-in-production standard.
- Did not investigate multi-daemon race conditions in depth (two daemons both claiming the same project) — the data model section assumes one machine per project per role, but concurrent-claim handling at the DB level (e.g., unique constraint on `(project_id, role)` in the assignment table) needs explicit design during implementation planning.

## Unresolved questions

- Is exactly one machine ever registered per (project, role), or can multiple machines compete for the same project's tickets? This changes whether the assignment table needs a lease/visibility-timeout model or a simple unique constraint suffices.
- What RPO/RTO is acceptable for Postgres backups (minutes vs. a day)? Determines whether `pg_dump`-on-cron is sufficient or WAL-archiving/PITR is needed.
- Should the owner's passkey be the sole factor, or is a fallback (password/TOTP) required for account recovery if the passkey device is lost?
- Do reports attached on Done need versioning/history (e.g., re-run producing a second report on the same ticket), or is one report per ticket sufficient?

Status: DONE
Summary: Researched NAT-safe daemon connectivity (recommend SSE+REST with a Postgres outbox table, no Redis), backend/ORM/web framework choice (Fastify + Drizzle + Vite/TanStack over NestJS/Prisma/Next.js), owner+device auth (passkey + session, hashed scoped device tokens) and Caddy/Compose/pg_dump deployment baseline, a Jira-like data model (self-referencing tickets, machine/project/role assignee binding, unified event/outbox/audit table), and a concrete docs-for-agents standard (docs/index.md + docs/flows/*.md + docs/flows.yaml + custom pre-commit/CI validation script) built from llms.txt, AGENTS.md, and Aider's repo-map precedents. Full report at /Users/admin/Documents/Projects/AI-company/plans/260928-1310-agent-jira-platform/research/researcher-02-backend-realtime-docs-report.md.
