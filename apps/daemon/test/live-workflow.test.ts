import { describe, expect, it } from 'vitest';
import { ticketReports, tickets } from '../../api/src/db/schema.js';
import { claim } from '../../api/src/services/claim-service.js';
import { createRequestTicket } from '../../api/src/services/ticket-service.js';
import { pairTestMachine } from '../../api/test/helpers/machines.js';
import { seedAndLogin } from '../../api/test/helpers/owner-session.js';
import { createTestProject } from '../../api/test/helpers/test-db.js';
import { rolePlanner } from '../src/roles/role-planner.js';
import { createSdkRunner } from '../src/runner/agent-runner.js';
import { commentsOf, type Fixture, ownerComment, useApi } from './helpers/api.js';
import { makeDaemon, sleep } from './helpers/daemon.js';
import { git, tempDir } from './helpers/git.js';
import { stuckTickets } from './helpers/lifecycle.js';
import { makeWorkflowRepo } from './helpers/workflow.js';

/**
 * The whole workflow on real models (the owner's subscription login): request "add /health" on a web
 * fixture repo with docs, a project skill for its domain and a project Playwright MCP server; one PM
 * question answered by the owner; dev, docs-update, QC, local merge and push to a bare remote, close.
 * Opt in with CREW_LIVE_AGENT_TESTS=1.
 */
const live = process.env.CREW_LIVE_AGENT_TESTS === '1';
const api = useApi();

const SKILL = `---
name: health-endpoints
description: Quy ước của dự án shop cho endpoint giám sát sức khỏe (/health) — định dạng phản hồi, mã trạng thái, nơi đăng ký route và test bắt buộc. Dùng khi phân tích yêu cầu, lập kế hoạch hoặc viết một endpoint health.
---

# Endpoint health của dự án shop

- Trả mã \`200\`, header \`content-type: application/json\`, thân \`{"status":"ok"}\`.
- Đăng ký route trong \`src/middle.js\` (object \`routes\`), không sửa \`src/app.js\`.
- Mỗi endpoint có một test \`node:test\` trong \`test/\` gọi thẳng handler.
`;

const MCP_JSON = `${JSON.stringify(
  {
    mcpServers: {
      playwright: { command: 'npx', args: ['-y', '@playwright/mcp@0.0.82', '--headless', '--isolated'] },
    },
  },
  null,
  2,
)}\n`;

describe.skipIf(!live)('live workflow on real models', () => {
  it(
    'request → triage → PM question → breakdown → dev → docs-update → QC → merge and push → close',
    async () => {
      const db = api.db;
      const server = await api.server();
      const machine = await pairTestMachine(db, 'live-mac');
      const project = await createTestProject(db, { ownerMachineId: machine.machineId, platform: 'web' });
      const owner = await seedAndLogin(server.app, db);
      await db.transaction((tx) => claim(tx, machine.machineId, { hostsAssistant: true }));
      const f: Fixture = { server, machine, owner, projectId: project.id, projectKey: project.key };
      const { repo, remote } = makeWorkflowRepo({
        docs: true,
        extra: { '.mcp.json': MCP_JSON, '.claude/skills/health-endpoints/SKILL.md': SKILL },
      });
      const logs: string[] = [];
      const t = makeDaemon(f, {
        repoPath: repo,
        home: tempDir('crewd-live-home-'),
        config: {
          models: {
            allow: ['haiku', 'sonnet'],
            complexityMap: {
              trivial: { model: 'haiku', effort: 'low' },
              small: { model: 'haiku', effort: 'medium' },
              medium: { model: 'sonnet', effort: 'medium' },
              large: { model: 'sonnet', effort: 'high' },
            },
          },
          budgets: { perJobUsd: 3 },
          projects: [
            {
              key: project.key,
              repoPath: repo,
              defaultBranch: 'main',
              testCommand: 'node --test',
              sharedPaths: [],
              disabledMcpServers: [],
            },
          ],
        },
        extra: {
          planner: rolePlanner,
          runner: createSdkRunner(),
          inventory: true,
          logger: (level, message, fields) =>
            logs.push(`${level} ${message} ${JSON.stringify(fields ?? {})}`),
        },
      });
      await t.daemon.start();
      const [machineInventory, projectInventory] = await Promise.all([
        t.daemon.refreshInventory(null),
        t.daemon.refreshInventory(project.key),
      ]);
      console.info(
        `[live] inventory: ${projectInventory?.skills.length} skills (project: ${projectInventory?.skills
          .filter((s) => s.source === 'project')
          .map((s) => s.name)
          .join(
            ', ',
          )}), MCP ${JSON.stringify(projectInventory?.mcpServers.map((s) => [s.name, s.source, s.status]))}; machine ${machineInventory?.skills.length} skills`,
      );
      expect(projectInventory?.skills.map((s) => s.name)).toContain('health-endpoints');
      expect(projectInventory?.mcpServers.find((s) => s.name === 'playwright')?.status).toBe('connected');

      const request = await createRequestTicket(db, {
        title: 'Thêm endpoint /health',
        description:
          'Tôi cần endpoint GET /health cho hệ thống giám sát của cửa hàng. PM: trước khi chia việc, hãy hỏi tôi đúng một câu để xác nhận định dạng phản hồi.',
      });

      const answered = new Set<string>();
      const deadline = Date.now() + 55 * 60_000;
      let closed = false;
      while (Date.now() < deadline) {
        const rows = await db.select().from(tickets);
        const req = rows.find((row) => row.id === request.id);
        if (req?.status === 'in_review' || req?.status === 'done') {
          closed = true;
          break;
        }
        const blocked = rows.filter((row) => row.status === 'blocked');
        if (blocked.length > 0 && t.daemon.state.listJobs(['running', 'queued']).length === 0) break;
        for (const row of rows.filter(
          (r) => r.status === 'needs_input' && !answered.has(`${r.id}:${r.updatedAt}`),
        )) {
          answered.add(`${row.id}:${row.updatedAt}`);
          const answer =
            row.type === 'pm_task'
              ? 'Trả JSON {"status":"ok"} với mã 200 và content-type application/json. Không cần xác thực.'
              : 'Làm theo quy ước của dự án và tiêu chí nghiệm thu trong ticket.';
          console.info(`[live] owner answers ${row.key} (${row.type})`);
          await ownerComment(f, row.id, answer);
        }
        await sleep(3_000);
      }

      // Let the last runs (the close job, a PM wake-up) finish and book their cost.
      const settle = Date.now() + 10 * 60_000;
      while (t.daemon.state.listJobs(['running', 'queued']).length > 0 && Date.now() < settle) {
        await sleep(2_000);
      }
      const rows = await db.select().from(tickets);
      const reports = (await db.select().from(ticketReports)).filter((r) => r.isCurrent);
      const reportOf = (id: string) => reports.find((r) => r.ticketId === id);
      const jobs = t.daemon.state.listJobs();
      const summary = rows.map((row) => ({
        key: row.key,
        type: row.type,
        status: row.status,
        costUsd: Number(row.costUsd.toFixed(4)),
        runs: jobs
          .filter((job) => job.ticketId === row.id)
          .map((job) => `${job.stage ?? job.kind}:${job.model}:${job.status}:${job.costUsd.toFixed(4)}`),
      }));
      console.info(`[live] tickets\n${JSON.stringify(summary, null, 2)}`);
      console.info(`[live] total cost ${rows.reduce((sum, row) => sum + row.costUsd, 0).toFixed(4)} USD`);
      if (!closed) {
        for (const row of rows) {
          const notes = (await commentsOf(db, row.id)).slice(-3).map((c) => c.body.slice(0, 800));
          console.info(`[live] ${row.key} ${row.status}: ${notes.join('\n  | ')}`);
        }
        console.info(`[live] daemon log\n${logs.slice(-40).join('\n')}`);
      }
      expect(closed).toBe(true);

      const pm = rows.find((row) => row.type === 'pm_task');
      const devs = rows.filter((row) => row.type === 'dev' || row.type === 'bug');
      const qcs = rows.filter((row) => row.type === 'qc');
      expect(pm?.status).toBe('done');
      expect(devs.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(reportOf(row.id), `${row.key} report`).toBeTruthy();
        expect(row.costUsd, `${row.key} cost`).toBeGreaterThan(0);
      }
      // Exactly one manual step: the owner's answer to the PM.
      expect([...answered].map((a) => a.split(':')[0])).toEqual([pm?.id]);
      // The PM analyze run picked the project's domain skill with a reason and invoked it.
      const pmReport = reportOf(pm?.id as string);
      expect(pmReport?.skillsSelected.find((s) => s.name === 'health-endpoints')?.reason).toBeTruthy();
      const analyze = jobs.filter((job) => job.ticketId === pm?.id && job.stage === 'pm_analyze');
      expect(analyze.some((job) => job.skillsInvoked.includes('health-endpoints'))).toBe(true);
      for (const dev of devs.filter((row) => row.status === 'done')) {
        const devJobs = jobs.filter((job) => job.ticketId === dev.id);
        expect(
          devJobs.filter((job) => job.kind === 'docs_update').every((job) => job.model === 'sonnet'),
        ).toBe(true);
        expect(reportOf(dev.id)?.docsFirst, `${dev.key} docs_first`).toBe(true);
        const head = reportOf(dev.id)?.commits[0] as string;
        const files = git(repo, 'show', '--name-only', '--format=', head);
        expect(files, `${dev.key} commit`).toMatch(/docs\/flows\//);
      }
      for (const qc of qcs.filter((row) => row.status === 'done')) {
        expect(reportOf(qc.id)?.mcpsUsed, `${qc.key} mcps`).toContain('playwright');
      }
      expect(git(remote, 'show', 'main:src/middle.js')).toContain('/health');
      expect(git(remote, 'rev-parse', 'main').trim()).toBe(pmReport?.headSha);
      expect(await stuckTickets(api, jobs)).toEqual([]);
      await t.daemon.stop();
    },
    60 * 60_000,
  );
});
