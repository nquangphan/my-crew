import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CREW_DOCS_BUNDLE,
  hookStatus,
  installCrewDocs,
  installHooks,
  runCrewDocs,
} from '../../git/docs-kit-bridge.js';
import { git } from '../../git/worktree-manager.js';
import { type HealthCheck, type HealthCheckResult, result } from '../types.js';

export const repoChecks: HealthCheck = {
  id: 'repos',
  group: 'repos',
  async run(ctx) {
    const results: HealthCheckResult[] = [];
    const gitVersion = ctx.exec('git', ['--version']);
    results.push(
      gitVersion.code === 0
        ? result('repos.git', 'repos', 'git', 'green', gitVersion.stdout.trim())
        : result(
            'repos.git',
            'repos',
            'git',
            'red',
            'Không tìm thấy git: cài git (Xcode Command Line Tools trên macOS).',
          ),
    );

    const bundle = join(ctx.paths.bin, CREW_DOCS_BUNDLE);
    const version = existsSync(bundle) ? runCrewDocs(bundle, ['--version'], ctx.paths.home) : null;
    results.push(
      version?.code === 0
        ? result(
            'repos.crew-docs',
            'repos',
            'crew-docs',
            'green',
            `crew-docs ${version.stdout.trim()} tại ${bundle}.`,
          )
        : result(
            'repos.crew-docs',
            'repos',
            'crew-docs',
            'red',
            `crew-docs chưa được cài vào ${ctx.paths.bin}.`,
            {
              id: 'install-crew-docs',
              label: 'Cài crew-docs',
            },
          ),
    );

    for (const project of ctx.config?.projects ?? []) {
      const id = `repos.${project.key}`;
      let isRepo = false;
      try {
        isRepo =
          existsSync(project.repoPath) &&
          git(project.repoPath, ['rev-parse', '--show-toplevel']).trim() !== '';
      } catch {
        isRepo = false;
      }
      if (!isRepo) {
        results.push(
          result(
            `${id}.path`,
            'repos',
            `Thư mục ${project.key}`,
            'red',
            `${project.repoPath} không tồn tại hoặc không phải repo git: chọn lại thư mục.`,
          ),
        );
        continue;
      }
      results.push(result(`${id}.path`, 'repos', `Thư mục ${project.key}`, 'green', project.repoPath));
      const hooks = hookStatus(project.repoPath);
      results.push(
        hooks.installed
          ? result(
              `${id}.hooks`,
              'repos',
              `Hook crew-docs của ${project.key}`,
              'green',
              `Hook dùng ${hooks.bundle}.`,
            )
          : result(
              `${id}.hooks`,
              'repos',
              `Hook crew-docs của ${project.key}`,
              'red',
              'Hook crew-docs chưa được cài.',
              {
                id: `install-hooks:${project.key}`,
                label: 'Cài lại hook',
              },
            ),
      );
    }
    return results;
  },
  async fix(ctx, fixId) {
    if (fixId === 'install-crew-docs') {
      installCrewDocs(ctx.paths.bin);
      return;
    }
    if (fixId.startsWith('install-hooks:')) {
      const project = ctx.config?.projects.find((p) => p.key === fixId.slice('install-hooks:'.length));
      if (!project) return;
      const bundle = join(ctx.paths.bin, CREW_DOCS_BUNDLE);
      if (!existsSync(bundle)) installCrewDocs(ctx.paths.bin);
      const installed = installHooks(project.repoPath, bundle);
      if (installed.code !== 0) throw new Error(installed.stderr || installed.stdout);
    }
  },
};
