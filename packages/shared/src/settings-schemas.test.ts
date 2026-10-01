import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GUARD_POLICY,
  GuardPolicy,
  lineDiff,
  ModelSettings,
  matchesAnyGlob,
  matchPathGlob,
  PathGlob,
  PROMPT_NAMES,
  SettingsKey,
  settingsText,
  validatePromptTemplate,
  validateSettingsContent,
} from './settings-schemas.js';

describe('path globs', () => {
  it('matches docs and root Markdown like the built-in rules', () => {
    const docs = DEFAULT_GUARD_POLICY.docsPaths;
    expect(matchesAnyGlob('docs/flows/a.md', docs)).toBe(true);
    expect(matchesAnyGlob('docs', docs)).toBe(true);
    expect(matchesAnyGlob('README.md', docs)).toBe(true);
    expect(matchesAnyGlob('readme.MD', docs)).toBe(true);
    expect(matchesAnyGlob('src/README.md', docs)).toBe(false);
    expect(matchesAnyGlob('docsx/a.md', docs)).toBe(false);
    expect(matchesAnyGlob('src/app.ts', docs)).toBe(false);
  });

  it('treats dir/** as the directory and everything below it', () => {
    expect(matchPathGlob('.claude', '.claude/**')).toBe(true);
    expect(matchPathGlob('.claude/settings.json', '.claude/**')).toBe(true);
    expect(matchPathGlob('.claude-x/a', '.claude/**')).toBe(false);
  });

  it('supports ** in the middle, * within a segment and ? for one character', () => {
    expect(matchPathGlob('a/b/c/x.md', 'a/**/x.md')).toBe(true);
    expect(matchPathGlob('a/x.md', 'a/**/x.md')).toBe(true);
    expect(matchPathGlob('a/b/x.md', 'a/*.md')).toBe(false);
    expect(matchPathGlob('lefthook.yml', 'lefthook.y?l')).toBe(true);
    expect(matchPathGlob('lefthook.yaml', 'lefthook.y?l')).toBe(false);
  });

  it('escapes regexp characters', () => {
    expect(matchPathGlob('a+b.md', 'a+b.md')).toBe(true);
    expect(matchPathGlob('aab.md', 'a+b.md')).toBe(false);
  });

  it('accepts only safe repo-relative globs', () => {
    for (const glob of ['docs/**', '*.md', '.github/crew-docs/**', 'a/b?.txt']) {
      expect(PathGlob.safeParse(glob).success, glob).toBe(true);
    }
    for (const glob of ['/etc/passwd', '../x', 'a/../b', 'a//b', 'docs/', '', 'a b', '$HOME/x', 'a\\b']) {
      expect(PathGlob.safeParse(glob).success, glob).toBe(false);
    }
  });
});

describe('guard policy', () => {
  it('accepts the bundled rules and refuses unknown fields', () => {
    expect(GuardPolicy.parse(DEFAULT_GUARD_POLICY)).toEqual(DEFAULT_GUARD_POLICY);
    expect(GuardPolicy.safeParse({ ...DEFAULT_GUARD_POLICY, extra: true }).success).toBe(false);
  });
});

describe('prompt templates', () => {
  it('accepts every known variable and partial', () => {
    expect(validatePromptTemplate('dev', '{{> _shared-rules}}\n{{header}}\n{{notes}}')).toEqual([]);
  });

  it('accepts the QC test-plan variables next to the older {{ui_test}}', () => {
    expect(validatePromptTemplate('qc', '{{header}}\n{{test_plan}}\n{{notes}}')).toEqual([]);
    // An override written before the test plan existed still validates.
    expect(validatePromptTemplate('qc', '{{header}}\nKiểm thử UI: {{ui_test}}\n{{notes}}')).toEqual([]);
    expect(validatePromptTemplate('pm-analyze', '{{header}}\n{{test_kinds}}\n{{notes}}')).toEqual([]);
  });

  it('refuses unknown variables and partials, nested partials and empty text', () => {
    expect(validatePromptTemplate('dev', '{{hedaer}}')).toEqual(['Không có biến {{hedaer}}.']);
    expect(validatePromptTemplate('dev', '{{> _nope}}')).toEqual(['Không có phần chung "_nope".']);
    expect(validatePromptTemplate('dev', '{{> dev}}')).toEqual(['Không có phần chung "dev".']);
    expect(validatePromptTemplate('_shared-rules', '{{> _capability-preflight}}')).toHaveLength(1);
    expect(validatePromptTemplate('qc', '   ')).toEqual(['Prompt không được để trống.']);
  });

  it('lists each prompt once, partials with a leading underscore', () => {
    expect(new Set(PROMPT_NAMES).size).toBe(PROMPT_NAMES.length);
    expect(PROMPT_NAMES).toContain('_shared-rules');
  });
});

describe('settings content', () => {
  it('keeps sonnet allowed and never accepts fable', () => {
    const map = {
      trivial: { model: 'haiku', effort: 'low' },
      small: { model: 'sonnet', effort: 'medium' },
      medium: { model: 'sonnet', effort: 'high' },
      large: { model: 'opus', effort: 'high' },
    };
    expect(ModelSettings.safeParse({ allow: ['haiku', 'opus'], complexityMap: map }).success).toBe(false);
    expect(ModelSettings.safeParse({ allow: ['sonnet', 'fable'], complexityMap: map }).success).toBe(false);
    expect(
      ModelSettings.safeParse({
        allow: ['sonnet'],
        complexityMap: { ...map, large: { model: 'fable', effort: 'high' } },
      }).success,
    ).toBe(false);
    expect(ModelSettings.safeParse({ allow: ['haiku', 'sonnet', 'opus'], complexityMap: map }).success).toBe(
      true,
    );
    // Every complexity entry must name an allowed model.
    const outside = ModelSettings.safeParse({ allow: ['sonnet', 'opus'], complexityMap: map });
    expect(outside.success).toBe(false);
    expect(outside.error?.issues[0]?.path).toEqual(['complexityMap', 'trivial', 'model']);
  });

  it('validates numbers in range and prompt variables', () => {
    expect(
      validateSettingsContent('resources', '', { maxConcurrentJobs: 0, minFreeMemGb: 1, maxLoadPerCpu: 1 }),
    ).toHaveLength(1);
    expect(validateSettingsContent('prompt', 'qc', { text: '{{bogus}}' })).toEqual([
      { path: 'text', message: 'Không có biến {{bogus}}.' },
    ]);
    expect(validateSettingsContent('project_mcp', '', { disabledMcpServers: ['a', 'a'] })).toHaveLength(1);
  });
});

describe('settings keys', () => {
  const machineId = '7c2b8f0e-2f4e-4f5e-9d61-1d2c3b4a5f60';
  it('checks the scope of each kind and the ids it needs', () => {
    expect(SettingsKey.safeParse({ kind: 'resources', scope: 'machine', machineId }).success).toBe(true);
    expect(SettingsKey.safeParse({ kind: 'resources', scope: 'global' }).success).toBe(false);
    expect(SettingsKey.safeParse({ kind: 'models', scope: 'machine' }).success).toBe(false);
    expect(SettingsKey.safeParse({ kind: 'prompt', scope: 'global', name: 'dev' }).success).toBe(true);
    expect(SettingsKey.safeParse({ kind: 'prompt', scope: 'global', name: 'nope' }).success).toBe(false);
    expect(SettingsKey.safeParse({ kind: 'policy', scope: 'global', name: 'dev' }).success).toBe(false);
  });
});

describe('line diff', () => {
  it('marks kept, removed and added lines', () => {
    expect(lineDiff('a\nb\nc', 'a\nc\nd')).toEqual([
      { op: 'same', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'same', text: 'c' },
      { op: 'add', text: 'd' },
    ]);
    expect(lineDiff('', 'x')).toEqual([{ op: 'add', text: 'x' }]);
  });

  it('shows prompts as text and other settings as JSON', () => {
    expect(settingsText('prompt', { text: 'Xin chào' })).toBe('Xin chào');
    expect(settingsText('budgets', { perJobUsd: 2 })).toBe('{\n  "perJobUsd": 2\n}');
    expect(settingsText('budgets', null)).toBe('');
  });
});
