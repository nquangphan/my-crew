import { describe, expect, it } from 'vitest';
import { projects } from '../../api/src/db/schema.js';
import { readBmadInstall, readBmadProfile } from '../src/skills/bmad-profile.js';
import { BMAD_6_0, BMAD_6_10, BMAD_6_11, BMAD_6_12, PERSONAL_NAME } from './fixtures/bmad-installs.js';
import { fixture, useApi } from './helpers/api.js';
import { makeDaemon, waitFor } from './helpers/daemon.js';
import { makeRepo, tempDir, writeFiles } from './helpers/git.js';

const folderWith = (files: Record<string, string>) => {
  const dir = tempDir('crew-bmad-');
  writeFiles(dir, files);
  return dir;
};

describe('BMAD profile reader', () => {
  it('reads a 6.12 install: version, modules, tools, languages, output folder and team answers', () => {
    const profile = readBmadProfile(folderWith(BMAD_6_12));
    expect(profile).toEqual({
      version: '6.12.0',
      lastUpdated: '2026-09-24T15:27:41.562Z',
      modules: ['core', 'bmm', 'bmb', 'cis', 'tea', 'bmad-loop'],
      tools: ['claude-code', 'codex', 'cursor', 'github-copilot', 'opencode'],
      communicationLanguage: 'Vietnamese',
      documentOutputLanguage: 'Vietnamese',
      outputFolder: '_bmad-output',
      settings: [
        { module: 'core', key: 'project_name', value: 'kidy_school' },
        { module: 'bmm', key: 'planning_artifacts', value: '{project-root}/_bmad-output/planning-artifacts' },
        {
          module: 'bmm',
          key: 'implementation_artifacts',
          value: '{project-root}/_bmad-output/implementation-artifacts',
        },
        { module: 'bmm', key: 'project_knowledge', value: '{project-root}/docs' },
        { module: 'bmb', key: 'bmad_builder_output_folder', value: '{project-root}/skills' },
        { module: 'bmb', key: 'bmad_builder_reports', value: '{project-root}/skills/reports' },
        { module: 'cis', key: 'visual_tools', value: 'intermediate' },
        { module: 'tea', key: 'test_artifacts', value: '{project-root}/_bmad-output/test-artifacts' },
        { module: 'tea', key: 'tea_use_playwright_utils', value: 'true' },
        { module: 'tea', key: 'tea_use_pactjs_utils', value: 'false' },
        { module: 'tea', key: 'tea_pact_mcp', value: 'mcp' },
        { module: 'tea', key: 'risk_threshold', value: 'p1' },
        { module: 'tea', key: 'test_design_output', value: '_bmad-output/test-artifacts/test-design' },
      ],
    });
  });

  it('reads a 6.11 install with English documents and a deprecated external module', () => {
    const profile = readBmadProfile(folderWith(BMAD_6_11));
    expect(profile).toMatchObject({
      version: '6.11.0',
      lastUpdated: '2026-08-21T04:00:00.000Z',
      modules: ['core', 'bmm', 'bmb', 'automator'],
      tools: ['claude-code', 'codex', 'opencode'],
      communicationLanguage: 'Vietnamese',
      documentOutputLanguage: 'English',
      outputFolder: '_bmad-output',
    });
    expect(profile?.settings.map((s) => `${s.module}.${s.key}`)).toEqual([
      'core.project_name',
      'bmm.planning_artifacts',
      'bmm.implementation_artifacts',
      'bmm.project_knowledge',
      'bmb.bmad_builder_output_folder',
      'bmb.bmad_builder_reports',
    ]);
  });

  it('drops absolute paths, credential-like keys and answers of modules that are not installed (6.10)', () => {
    const profile = readBmadProfile(folderWith(BMAD_6_10));
    expect(profile).toMatchObject({
      version: '6.10.0',
      modules: ['core', 'bmm', 'tea', 'cis'],
      tools: ['claude-code'],
      communicationLanguage: 'English',
      documentOutputLanguage: 'Vietnamese',
      outputFolder: 'docs/bmad',
    });
    expect(profile?.settings).toEqual([
      { module: 'core', key: 'project_name', value: 'crazii-signal' },
      { module: 'bmm', key: 'planning_artifacts', value: '{project-root}/docs/bmad/planning-artifacts' },
      { module: 'tea', key: 'tea_use_playwright_utils', value: 'true' },
      { module: 'tea', key: 'tea_pact_mcp', value: 'none' },
      { module: 'tea', key: 'ci_platform', value: 'auto' },
      { module: 'cis', key: 'visual_tools', value: 'intermediate,advanced' },
    ]);
  });

  it('never carries personal answers, _bmad/custom or _bmad/memory', () => {
    for (const files of [BMAD_6_12, BMAD_6_11, BMAD_6_10, BMAD_6_0]) {
      const text = JSON.stringify(readBmadProfile(folderWith(files)));
      expect(text).not.toContain(PERSONAL_NAME);
      expect(text).not.toContain('user_name');
      expect(text).not.toContain('user_skill_level');
      expect(text).not.toContain('should-never-leave');
      expect(text).not.toContain('/Users/');
      expect(text).not.toContain('Mary');
    }
  });

  it('reads the 6.0 layout from core/config.yaml', () => {
    expect(readBmadProfile(folderWith(BMAD_6_0))).toEqual({
      version: '6.0.4',
      lastUpdated: '2026-02-10T09:00:00.000Z',
      modules: ['core', 'bmm'],
      tools: ['claude-code', 'cursor'],
      communicationLanguage: 'Vietnamese',
      documentOutputLanguage: 'English',
      outputFolder: '_bmad-output',
      settings: [],
    });
  });

  it('answers null without a manifest, and reads just the install for the local state', () => {
    expect(readBmadProfile(folderWith({ 'README.md': '#\n' }))).toBeNull();
    expect(readBmadInstall(folderWith({ 'README.md': '#\n' }))).toBeNull();
    expect(readBmadInstall(folderWith(BMAD_6_11))).toEqual({
      version: '6.11.0',
      lastUpdated: '2026-08-21T04:00:00.000Z',
      modules: ['core', 'bmm', 'bmb', 'automator'],
      tools: ['claude-code', 'codex', 'opencode'],
    });
  });
});

describe('daemon: BMAD profile report', () => {
  const api = useApi();

  it('reports the owned project profile on the inventory probe, once per manifest change', async () => {
    const f = await fixture(api);
    const repo = makeRepo({ 'README.md': '# r\n', ...BMAD_6_11 });
    const t = makeDaemon(f, {
      repoPath: repo,
      extra: { inventory: true, probe: async () => ({ skills: [], mcpServers: [] }) },
    });
    const stored = async () =>
      (await api.db.select().from(projects)).find((row) => row.id === f.projectId)?.bmadProfile ?? null;
    await t.daemon.start();
    await waitFor(async () => (await stored()) !== null, 15_000, 'profile reported');
    expect(await stored()).toMatchObject({ version: '6.11.0', modules: ['core', 'bmm', 'bmb', 'automator'] });

    // The same manifest is not sent again (the fixture has this one project); a newer install is.
    await api.db.update(projects).set({ bmadProfile: null });
    await t.daemon.refreshInventory(f.projectKey);
    expect(await stored()).toBeNull();
    writeFiles(repo, BMAD_6_12);
    await t.daemon.refreshInventory(f.projectKey);
    expect(await stored()).toMatchObject({ version: '6.12.0', communicationLanguage: 'Vietnamese' });
    await t.daemon.stop();
  });
});
