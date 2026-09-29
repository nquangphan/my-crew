import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadPrompt, setPromptsDir } from '../../daemon/src/roles/prompt-templates.js';
import { STAGES } from '../../daemon/src/roles/role-registry.js';
import { copyRolePrompts } from '../electron.vite.config.js';

const out = mkdtempSync(join(tmpdir(), 'crew-prompts-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('role prompts in the packaged main bundle', () => {
  it('ships every stage prompt and partial next to the main bundle', () => {
    copyRolePrompts.writeBundle({ dir: out });
    setPromptsDir(join(out, 'prompts'));
    for (const stage of Object.values(STAGES)) {
      const text = loadPrompt(stage.prompt);
      expect(text.length, stage.prompt).toBeGreaterThan(0);
      for (const [, partial] of text.matchAll(/\{\{>\s*([\w-]+)\s*\}\}/g)) {
        expect(loadPrompt(partial as string).length, partial).toBeGreaterThan(0);
      }
    }
  });
});
