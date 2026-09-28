import { join } from 'node:path';
import { inject } from 'vitest';
import { runCrewDocs } from '../../src/git/docs-kit-bridge.js';
import { git, tempDir, writeFiles } from './git.js';

/** A small Node web app used by the workflow tests; `node --test` passes on it. */
export const APP_SOURCES: Record<string, string> = {
  'package.json': '{ "name": "shop", "private": true, "type": "commonjs" }\n',
  'src/app.js':
    "const http = require('node:http');\nconst { routes } = require('./middle.js');\n\nexports.server = () => http.createServer((q, s) => (routes[q.url] ?? (() => s.end('404')))(q, s));\n",
  'src/middle.js': "exports.routes = { '/': (q, s) => s.end('ok') };\n",
  'src/store.js': 'exports.items = [];\n',
  'test/app.test.js':
    "const test = require('node:test');\nconst assert = require('node:assert');\ntest('routes', () => assert.ok(require('../src/middle.js').routes['/']));\n",
  'README.md': '# Shop\n\nCửa hàng thử nghiệm.\n',
};

const FLOW_DOC = `# Ứng dụng web

## Mục đích

Máy chủ HTTP của cửa hàng.

## Điểm vào

- \`src/app.js\` → \`server\`: tạo máy chủ HTTP.

## Các bước

1. \`src/app.js\` → \`server\`: nhận request.
2. \`src/middle.js\` → \`routes\`: chọn handler theo đường dẫn.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| \`src/app.js\` | điểm vào | \`server\` |
| \`src/middle.js\` | định tuyến | \`routes\` |
| \`src/store.js\` | dữ liệu | \`items\` |

## Dữ liệu

Dữ liệu nằm trong bộ nhớ.

## Flow liên quan

Không có.

## Tests

- \`test/app.test.js\`: có route gốc.
`;

export const DOCS_FILES: Record<string, string> = {
  'AGENTS.md':
    '# Cách làm việc\n\nĐỌC docs/index.md TRƯỚC.\n\n- Test: `node --test`\n- Chạy thử: `node -e "require(\'./src/app.js\').server().listen(4398)"` (nhớ dừng tiến trình sau khi thử).\n',
  'CLAUDE.md': '@AGENTS.md\n',
  'docs/index.md':
    '# Tổng quan\n\nCửa hàng thử nghiệm.\n\n## Danh sách flow\n\n<!-- crew-docs:flows:start -->\n<!-- crew-docs:flows:end -->\n',
  'docs/architecture.md': '# Kiến trúc\n\nMột tiến trình Node.\n',
  'docs/files.md': '# Tra cứu file\n\n<!-- crew-docs:files:start -->\n<!-- crew-docs:files:end -->\n',
  'docs/flows.yaml': `version: 1
source:
  include: ["src/**"]
  exclude: ["**/*.test.*"]
flows:
  app:
    title: Ứng dụng web
    doc: docs/flows/app.md
    entrypoints:
      - src/app.js
    files:
      - src/middle.js
      - src/store.js
    tests:
      - test/app.test.js
`,
  'docs/flows/app.md': FLOW_DOC,
};

export const bundlePath = (): string => inject('bundlePath');

export function crewDocs(cwd: string, ...args: string[]) {
  const result = runCrewDocs(bundlePath(), args, cwd);
  if (result.code !== 0) {
    throw new Error(`crew-docs ${args.join(' ')} exit ${result.code}: ${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

export interface WorkflowRepo {
  repo: string;
  /** The bare `origin` the PM pushes to. */
  remote: string;
}

/**
 * A fixture project on `main` with a bare `origin`. With `docs`, it follows the docs standard: the docs,
 * the crew-docs hooks (the real bundle) and the docs-init commit are in place, so every later commit runs
 * the real R1–R7 checks. Without, it is plain code (docs-init first).
 */
export function makeWorkflowRepo(options: { docs: boolean; extra?: Record<string, string> }): WorkflowRepo {
  const repo = tempDir('crewd-flow-repo-');
  const remote = join(tempDir('crewd-flow-remote-'), 'origin.git');
  git(repo, 'init', '-q', '-b', 'main');
  writeFiles(repo, { ...APP_SOURCES, ...(options.extra ?? {}) });
  if (options.docs) {
    writeFiles(repo, { ...DOCS_FILES, ...(options.extra ?? {}) });
    crewDocs(repo, 'generate');
    crewDocs(repo, 'check', '--all');
    crewDocs(repo, 'install-hooks', '--runtime', process.execPath, '--bundle', bundlePath());
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', options.docs ? 'init\n\nCrew-Docs-Init: true' : 'init');
  git(join(remote, '..'), 'init', '-q', '--bare', '-b', 'main', remote);
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', 'origin', 'main');
  git(repo, 'fetch', '-q', 'origin');
  return { repo, remote };
}
