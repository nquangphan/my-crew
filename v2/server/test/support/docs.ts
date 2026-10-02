import { bundleHash, hashBytes, snapshotHash } from '../../src/docs/checksum.ts';
import type { DocsFile, DocsImport, DocsValidationInput, ImportResult } from '../../src/docs/contracts.ts';
import { importDocs } from '../../src/docs/import.ts';
import { requiredClass } from '../../src/docs/manifest.ts';
import { mutate } from '../../src/journal/mutation.ts';
import type { Db } from '../../src/platform/contracts.ts';
import { owner } from './tickets.ts';

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

export function legacyBundle(
  files: Record<string, Buffer>,
  classes: Record<string, DocsFile['contentClass']> = {},
): DocsImport {
  const entries = Object.entries(files).map(([path, bytes]) => {
    const contentClass = classes[path] ?? requiredClass(path);
    if (contentClass === null || contentClass === undefined) throw new Error('FIXTURE_CLASS_REQUIRED');
    return { path, bytesBase64: bytes.toString('base64'), sha256: hashBytes(bytes), contentClass };
  });
  const input = {
    sourceSystem: 'crew-v1' as const,
    backupManifestSha256: 'b'.repeat(64),
    inventory: [
      {
        legacyProjectId: 'legacy-1',
        key: 'LEGACY',
        name: 'Dự án cũ',
        repositoryUrl: null,
        sourceCommit: null,
        snapshotSha256: snapshotHash(entries),
        files: entries,
      },
    ],
  };
  return { ...input, bundleSha256: bundleHash(input) };
}

export function rehashBundle(input: DocsImport): DocsImport {
  for (const project of input.inventory) project.snapshotSha256 = snapshotHash(project.files);
  const { bundleSha256: _, ...body } = input;
  input.bundleSha256 = bundleHash(body);
  return input;
}

export async function importWithKey(db: Db, input: DocsImport, key: string): Promise<ImportResult> {
  return (
    await mutate(db, { actor: owner, route: '/v2/docs/imports', key, body: input }, async (tx) => ({
      status: 201,
      body: await importDocs(tx, input, owner),
    }))
  ).body;
}
