import { describe, expect, it } from 'vitest';
import { docsFirst } from '../src/roles/docs-first-check.js';
import type { ToolLogEntry } from '../src/state-db.js';

const cwd = '/repo/.crew/worktrees/WEB-1';
const e = (tool: string, target: string | null, decision: 'allow' | 'deny' = 'allow'): ToolLogEntry => ({
  jobId: 'j',
  seq: 0,
  tool,
  target,
  decision,
  reason: null,
  at: '',
});

describe('docs-first check', () => {
  it('passes when docs/index.md or a docs lookup comes before the first source read', () => {
    expect(docsFirst([e('Read', `${cwd}/docs/index.md`), e('Read', `${cwd}/src/app.ts`)], cwd)).toBe(true);
    expect(docsFirst([e('Read', 'docs/index.md'), e('Grep', 'foo @ src')], cwd)).toBe(true);
    expect(
      docsFirst([e('mcp__tickets__docs_flow', '{"id":"cart"}'), e('Read', `${cwd}/src/a.ts`)], cwd),
    ).toBe(true);
    expect(docsFirst([e('mcp__tickets__docs_where', '{}'), e('Grep', 'x')], cwd)).toBe(true);
    expect(docsFirst([e('Bash', 'crew-docs flow cart'), e('Read', `${cwd}/src/a.ts`)], cwd)).toBe(true);
  });

  it('fails when a source file is read or grepped first', () => {
    expect(docsFirst([e('Read', `${cwd}/src/app.ts`), e('Read', `${cwd}/docs/index.md`)], cwd)).toBe(false);
    // A Grep without a path searches the whole worktree, source included.
    expect(docsFirst([e('Grep', 'TODO'), e('Read', `${cwd}/docs/index.md`)], cwd)).toBe(false);
    expect(docsFirst([e('Grep', 'x @ src/lib'), e('mcp__tickets__docs_flow', '{}')], cwd)).toBe(false);
  });

  it('ignores reads outside the worktree, of docs and agent config, and denied calls', () => {
    const log = [
      e('Read', '/Users/me/.claude/skills/api/SKILL.md'),
      e('Read', '/tmp/job/notes.txt'),
      e('Read', `${cwd}/.claude/skills/shop/SKILL.md`),
      e('Read', `${cwd}/AGENTS.md`),
      e('Read', `${cwd}/README.md`),
      e('Read', `${cwd}/docs/flows/cart.md`),
      e('Read', `${cwd}/src/secret.ts`, 'deny'),
      e('Read', `${cwd}/docs/index.md`),
      e('Read', `${cwd}/src/app.ts`),
    ];
    expect(docsFirst(log, cwd)).toBe(true);
    expect(docsFirst([], cwd)).toBe(true);
    expect(docsFirst([e('Bash', 'npm test'), e('Glob', '**/*.ts')], cwd)).toBe(true);
  });

  it('judges several runs of a ticket in order (dev run, then its docs job)', () => {
    const dev = [e('Read', `${cwd}/docs/index.md`), e('Read', `${cwd}/src/app.ts`)];
    const docsJob = [e('Read', `${cwd}/src/app.ts`)];
    expect(docsFirst([...dev, ...docsJob], cwd)).toBe(true);
    expect(docsFirst([...docsJob, ...dev], cwd)).toBe(false);
  });
});
