import type { DocsFile, DocsValidationInput } from '../../src/docs/contracts.ts';

const flow =
  '# Luồng mẫu\n\n## Mục đích\nMô tả.\n\n## Điểm vào\nLệnh.\n\n## Các bước\n1. `src/a.ts` → `run`: chạy.\n\n## Files\n| File | Vai trò | Symbol chính |\n|---|---|---|\n| `src/a.ts` | nguồn | `run` |\n\n## Dữ liệu\nKhông.\n\n## Flow liên quan\nKhông.\n\n## Tests\nKhông.\n';
const manifest =
  'version: 1\nsource:\n  include: ["src/**"]\n  exclude: ["**/*.test.ts"]\nflows:\n  sample:\n    title: Luồng mẫu\n    doc: docs/flows/sample.md\n    entrypoints: [src/a.ts]\n    files: []\n    tests: []\nshared: {}\nunassigned: []\n';
const index =
  '# Tổng quan\n\n<!-- crew-docs:flows:start -->\n| Flow | Id | Điểm vào |\n|------|----|----------|\n| [Luồng mẫu](flows/sample.md) | `sample` | `src/a.ts` |\n<!-- crew-docs:flows:end -->\n';
const files =
  '# Tra cứu file\n\n<!-- crew-docs:files:start -->\n> Sinh tự động bởi `crew-docs generate` từ `docs/flows.yaml`. Không sửa tay.\n\n| File | Flows |\n|------|-------|\n| `src/a.ts` | [sample](flows/sample.md) (điểm vào) |\n<!-- crew-docs:files:end -->\n';

export const validDocs = (): Record<string, Buffer> => ({
  'AGENTS.md': Buffer.from('# Agent\nĐọc docs/index.md trước.\n'),
  'CLAUDE.md': Buffer.from('@AGENTS.md\n'),
  'docs/index.md': Buffer.from(index),
  'docs/architecture.md': Buffer.from('# Kiến trúc\n'),
  'docs/flows.yaml': Buffer.from(manifest),
  'docs/files.md': Buffer.from(files),
  'docs/flows/sample.md': Buffer.from(flow),
});

export function docsValidationFixture(
  overrides: Record<string, Buffer> = {},
  mode: DocsValidationInput['mode'] = 'legacy_import',
): DocsValidationInput {
  const files = new Map(Object.entries({ ...validDocs(), ...overrides }));
  const contentClasses = new Map<string, DocsFile['contentClass']>();
  for (const path of files.keys()) {
    contentClasses.set(
      path,
      path.startsWith('docs/superpowers/') ||
        path.startsWith('docs/bmad/') ||
        path.startsWith('docs/artifacts/') ||
        path.startsWith('_bmad-output/')
        ? 'workflow_artifact'
        : 'implemented',
    );
  }
  return { files, contentClasses, trackedSourcePaths: ['src/a.ts'], mode };
}
