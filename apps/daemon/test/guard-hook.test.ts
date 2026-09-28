import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { createGuardHook, evaluateToolCall, type GuardContext } from '../src/runner/guard-hook.js';
import { StateDb } from '../src/state-db.js';
import { makeRepo, tempDir } from './helpers/git.js';

const MANIFEST = `version: 1
source:
  include: ["src/**"]
flows:
  cart:
    title: Giỏ hàng
    doc: docs/flows/cart.md
    entrypoints: [src/cart.ts]
    files: []
    tests: []
shared: {}
unassigned: []
`;

/** A worktree whose repo `.claude/settings.json` allows everything: the guard must not care. */
function permissiveRepo() {
  const repo = makeRepo({
    '.claude/settings.json': JSON.stringify({
      permissions: { allow: ['Bash(*)', 'Write(*)', 'Edit(*)'], defaultMode: 'bypassPermissions' },
    }),
    'docs/flows.yaml': MANIFEST,
    'src/cart.ts': 'export {};\n',
  });
  return repo;
}

const input = (tool: string, toolInput: Record<string, unknown>): PreToolUseHookInput => ({
  hook_event_name: 'PreToolUse',
  session_id: 's',
  transcript_path: '',
  cwd: '/',
  tool_name: tool,
  tool_input: toolInput,
  tool_use_id: `t-${tool}`,
});

describe('guard hook', () => {
  it('denies writes outside cwd and to .githooks even with a planted permissive settings file', async () => {
    const cwd = permissiveRepo();
    const outside = tempDir('crewd-outside-');
    const state = new StateDb(':memory:');
    const job = state.insertJob({ ticketId: 't', projectId: null, role: 'dev', trigger: 'x' });
    const hook = createGuardHook({ cwd, kind: 'agent', jobId: job.id, state });
    const signal = new AbortController().signal;

    const denied = async (tool: string, toolInput: Record<string, unknown>) => {
      const out = await hook(input(tool, toolInput), 'id', { signal });
      return 'hookSpecificOutput' in out && out.hookSpecificOutput?.hookEventName === 'PreToolUse'
        ? out.hookSpecificOutput.permissionDecision === 'deny'
        : false;
    };
    expect(await denied('Write', { file_path: join(outside, 'x.txt'), content: 'x' })).toBe(true);
    expect(await denied('Edit', { file_path: '../escape.txt', old_string: 'a', new_string: 'b' })).toBe(true);
    expect(await denied('Write', { file_path: '.githooks/pre-commit', content: 'exit 0' })).toBe(true);
    expect(
      await denied('Edit', {
        file_path: join(cwd, '.claude/settings.json'),
        old_string: 'a',
        new_string: 'b',
      }),
    ).toBe(true);
    expect(await denied('Bash', { command: 'git push --force origin main' })).toBe(true);
    expect(await denied('Write', { file_path: 'src/cart.ts', content: 'export const cart = 1;\n' })).toBe(
      false,
    );
    expect(await denied('Bash', { command: 'pnpm test' })).toBe(false);

    const log = state.toolLog(job.id);
    expect(log).toHaveLength(7);
    expect(log.map((entry) => entry.decision)).toEqual([
      'deny',
      'deny',
      'deny',
      'deny',
      'deny',
      'allow',
      'allow',
    ]);
    expect(log[0]?.reason).toMatch(/ngoài thư mục làm việc/);
  });

  it('allowed calls carry no decision, so dontAsk and allowedTools still apply', async () => {
    const cwd = permissiveRepo();
    const state = new StateDb(':memory:');
    const hook = createGuardHook({ cwd, kind: 'agent', jobId: 'j', state });
    const out = await hook(input('Read', { file_path: 'docs/index.md' }), 'id', {
      signal: new AbortController().signal,
    });
    expect(out).toEqual({});
    expect(state.toolLog('j')[0]).toMatchObject({ tool: 'Read', target: 'docs/index.md', decision: 'allow' });
  });

  describe('protected paths and job kinds', () => {
    const ctx = (kind: GuardContext['kind'], cwd: string): GuardContext => ({ cwd, kind });

    it('protects CLAUDE.md, .claude, husky, lefthook and the crew-docs CI files except for docs-init', () => {
      const cwd = permissiveRepo();
      for (const path of [
        'CLAUDE.md',
        '.claude/skills/x/SKILL.md',
        '.husky/pre-commit',
        'lefthook.yml',
        '.github/workflows/crew-docs.yml',
        '.github/crew-docs/crew-docs.cjs',
      ]) {
        expect(
          evaluateToolCall(ctx('agent', cwd), 'Write', { file_path: path, content: '' }).decision,
          path,
        ).toBe('deny');
        expect(
          evaluateToolCall(ctx('docs_init', cwd), 'Write', { file_path: path, content: '' }).decision,
          path,
        ).toBe('allow');
      }
    });

    it('lets agents edit the flows section of docs/flows.yaml but not source, shared or unassigned', () => {
      const cwd = permissiveRepo();
      const flowsEdit = {
        file_path: 'docs/flows.yaml',
        old_string: 'files: []',
        new_string: 'files: [src/cart-item.ts]',
      };
      expect(evaluateToolCall(ctx('docs_update', cwd), 'Edit', flowsEdit).decision).toBe('allow');
      const sourceEdit = {
        file_path: 'docs/flows.yaml',
        old_string: 'include: ["src/**"]',
        new_string: 'include: ["**"]',
      };
      expect(evaluateToolCall(ctx('docs_update', cwd), 'Edit', sourceEdit).decision).toBe('deny');
      const rewrite = MANIFEST.replace('unassigned: []', 'unassigned: [{path: src/x.ts, reason: r}]');
      expect(
        evaluateToolCall(ctx('agent', cwd), 'Write', { file_path: 'docs/flows.yaml', content: rewrite })
          .decision,
      ).toBe('deny');
      expect(
        evaluateToolCall(ctx('docs_init', cwd), 'Write', { file_path: 'docs/flows.yaml', content: rewrite })
          .decision,
      ).toBe('allow');
    });

    it('limits the docs-update job to docs/', () => {
      const cwd = permissiveRepo();
      expect(
        evaluateToolCall(ctx('docs_update', cwd), 'Write', { file_path: 'docs/flows/cart.md', content: '#' })
          .decision,
      ).toBe('allow');
      expect(
        evaluateToolCall(ctx('docs_update', cwd), 'Edit', {
          file_path: 'src/cart.ts',
          old_string: 'export',
          new_string: 'x',
        }).decision,
      ).toBe('deny');
      expect(
        evaluateToolCall(ctx('agent', cwd), 'Edit', {
          file_path: 'src/cart.ts',
          old_string: 'export',
          new_string: 'x',
        }).decision,
      ).toBe('allow');
    });

    it('judges a path through a symlink where it lands, except linked shared paths', () => {
      const cwd = permissiveRepo();
      const outside = tempDir('crewd-outside-');
      mkdirSync(join(outside, 'kit'));
      symlinkSync(outside, join(cwd, 'escape'));
      writeFileSync(join(outside, 'AGENTS.md'), '# shared\n');
      symlinkSync(join(outside, 'AGENTS.md'), join(cwd, 'AGENTS.md'));
      expect(
        evaluateToolCall(ctx('agent', cwd), 'Write', { file_path: 'escape/x.txt', content: '' }).decision,
      ).toBe('deny');
      expect(
        evaluateToolCall({ cwd, kind: 'agent', sharedPaths: ['AGENTS.md'] }, 'Write', {
          file_path: 'AGENTS.md',
          content: '',
        }).decision,
      ).toBe('allow');
    });
  });

  describe('Bash patterns (best effort)', () => {
    const cwd = '/work/repo';
    const bash = (command: string, extra: Partial<GuardContext> = {}) =>
      evaluateToolCall(
        { cwd, kind: 'agent', tmpDir: '/home/me/.crew/tmp/job', home: '/home/me', ...extra },
        'Bash',
        { command },
      ).decision;

    it('denies force pushes in any spelling', () => {
      for (const command of [
        'git push -f',
        'git push --force-with-lease origin x',
        'git push origin +main',
        'cd x && git push -uf origin a',
        'FOO=1 git push --force',
      ]) {
        expect(bash(command), command).toBe('deny');
      }
      expect(bash('git push origin crew/WEB-1')).toBe('allow');
      expect(bash('git push -u origin crew/WEB-1')).toBe('allow');
    });

    it('denies rm -rf outside cwd, allows it inside cwd and the job temp dir', () => {
      for (const command of [
        'rm -rf /',
        'rm -rf ~',
        'rm -fr ../other',
        'rm -r -f /tmp/x',
        'rm --recursive --force $HOME/x',
        'rm -rf $SOMEVAR/x',
        'rm -rf .',
        'sudo rm -rf /etc',
      ]) {
        expect(bash(command), command).toBe('deny');
      }
      for (const command of [
        'rm -rf node_modules',
        'rm -rf ./build dist',
        'rm -rf "$TMPDIR/cache"',
        'rm -rf /work/repo/tmp',
        'rm -f /tmp/x',
        'rm -r build',
      ]) {
        expect(bash(command), command).toBe('allow');
      }
    });

    it('denies changing core.hooksPath', () => {
      expect(bash('git config core.hooksPath /dev/null')).toBe('deny');
      expect(bash('git config --unset core.hooksPath')).toBe('deny');
      expect(bash('git -c core.hooksPath=/tmp commit -m x')).toBe('deny');
      expect(bash('git config user.name x')).toBe('allow');
    });
  });
});
