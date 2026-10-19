import { describe, expect, it } from 'vitest';
import { BMAD_PIN, BMAD_PLUGIN_JSON, BMAD_SOURCE } from '../src/workflows/bmad-pin.js';
import { pinDir, SUPERPOWERS_PIN, superpowersPinDir } from '../src/workflows/pin.js';
import { certifiedWorkflows, workflowForPluginDir } from '../src/workflows/registry.js';

describe('sổ workflow đã chứng nhận', () => {
  it('pinDir theo workflow, superpowersPinDir giữ nguyên', () => {
    expect(pinDir('/Users/a', BMAD_PIN)).toBe('/Users/a/.crew/workflows/bmad/6.13.0-next-d009608292d8');
    expect(superpowersPinDir('/Users/a')).toBe('/Users/a/.crew/workflows/superpowers/6.4.1-5bf4e7801107');
    expect(pinDir('/Users/a', SUPERPOWERS_PIN)).toBe(superpowersPinDir('/Users/a'));
  });

  it('BMAD_SOURCE chỉ trỏ repo chính thức qua https và đúng revision ghim', () => {
    expect(BMAD_SOURCE.repoUrl).toBe('https://github.com/bmad-code-org/bmad-plugins.git');
    expect(BMAD_SOURCE.marketplaceDir).toBe('.claude/plugins/marketplaces/bmad');
    expect(BMAD_SOURCE.trees).toEqual(['plugins/method/skills', 'plugins/toolbox/skills']);
    expect(BMAD_PIN.revision).toBe(BMAD_SOURCE.revision);
    expect(BMAD_PIN.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(BMAD_PLUGIN_JSON).toBe(
      '{"name":"bmad","version":"6.13.0-next","description":"BMAD Method (bmad-method + bmad-toolbox), Crew pin d009608292d8"}\n',
    );
    expect(JSON.parse(BMAD_PLUGIN_JSON).name).toBe(BMAD_PIN.workflow);
  });

  it('BMAD_PIN chép nguyên số đo của bản lắp d009608', () => {
    expect(BMAD_PIN).toEqual({
      workflow: 'bmad',
      version: '6.13.0-next',
      revision: 'd009608292d8a2ea4df846de7dca2f0d78a9e22d',
      checksum: '7f62e5cb6033d039505afdce2a1d411cbff064a83f13df1d467987f698cd82d2',
      executables: ['skills/bmad/scripts/resolve_customization.py'],
    });
  });

  it('sổ có đúng hai workflow, superpowers mặc định chạy cả Codex/OpenCode, BMAD chỉ claude_local', () => {
    const list = certifiedWorkflows({ superpowersPin: SUPERPOWERS_PIN, bmadPin: BMAD_PIN });
    expect(list.map((w) => [w.id, w.isDefault, w.runtimes])).toEqual([
      ['superpowers', true, ['claude_local', 'codex_local', 'opencode_local']],
      ['bmad', false, ['claude_local']],
    ]);
    expect(list.map((w) => w.purpose)).toEqual(['design/plan/task, code, review, merge', 'epic/story']);
    expect(list.map((w) => w.pin)).toEqual([SUPERPOWERS_PIN, BMAD_PIN]);
  });

  it('workflowForPluginDir nhận đúng thư mục ghim (so comparablePath), từ chối marketplace và cache owner', () => {
    const ctx = { home: '/Users/a', superpowersPin: SUPERPOWERS_PIN, bmadPin: BMAD_PIN };
    expect(workflowForPluginDir(ctx, '/Users/a/.crew/workflows/bmad/6.13.0-next-d009608292d8')?.id).toBe(
      'bmad',
    );
    expect(workflowForPluginDir(ctx, '/Users/A/.crew/workflows/superpowers/6.4.1-5bf4e7801107/')?.id).toBe(
      'superpowers',
    );
    expect(workflowForPluginDir(ctx, '/Users/a/.claude/plugins/marketplaces/bmad/plugins/method')).toBeNull();
    expect(
      workflowForPluginDir(ctx, '/Users/a/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1'),
    ).toBeNull();
  });

  it('pluginKeys phân đúng key enabledPlugins', () => {
    const [sp, bmad] = certifiedWorkflows({ superpowersPin: SUPERPOWERS_PIN, bmadPin: BMAD_PIN });
    expect(sp?.pluginKeys.some((r) => r.test('superpowers@claude-plugins-official'))).toBe(true);
    for (const k of ['bmad@x', 'bmad-method@bmad', 'bmad-toolbox@bmad'])
      expect(bmad?.pluginKeys.some((r) => r.test(k))).toBe(true);
    expect(bmad?.pluginKeys.some((r) => r.test('bmadx@y'))).toBe(false);
    expect(sp?.pluginKeys.some((r) => r.test('bmad-method@bmad'))).toBe(false);
    expect(bmad?.pluginKeys.some((r) => r.test('superpowers@claude-plugins-official'))).toBe(false);
  });
});
