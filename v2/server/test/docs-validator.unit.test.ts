import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bundleHash, hashBytes, snapshotHash, sourceTreeHash } from '../src/docs/checksum.ts';
import { validateDocs } from '../src/docs/validator.ts';
import { docsValidationFixture } from './support/docs.ts';

function file(files: Map<string, Buffer>, path: string): Buffer {
  const bytes = files.get(path);
  assert(bytes, `Thiếu fixture ${path}`);
  return bytes;
}

test('hash bytes keeps CRLF and Unicode, snapshot hash is order independent and class sensitive', () => {
  const raw = readFileSync(new URL('./fixtures/legacy-docs/crlf-unicode.md', import.meta.url));
  assert.equal(hashBytes(raw), createHash('sha256').update(raw).digest('hex'));
  assert.notEqual(hashBytes(raw), hashBytes(Buffer.from(raw.toString().replaceAll('\r\n', '\n'))));
  const a = {
    path: 'docs/a.md',
    bytesBase64: raw.toString('base64'),
    sha256: hashBytes(raw),
    contentClass: 'implemented' as const,
  };
  const b = {
    path: 'docs/b.md',
    bytesBase64: 'eA==',
    sha256: hashBytes(Buffer.from('x')),
    contentClass: 'workflow_artifact' as const,
  };
  assert.equal(snapshotHash([a, b]), snapshotHash([b, a]));
  assert.notEqual(snapshotHash([a, b]), snapshotHash([a, { ...b, contentClass: 'implemented' }]));
});

test('snapshot hash rejects noncanonical base64 and duplicate exact paths', () => {
  const a = {
    path: 'docs/a.md',
    bytesBase64: 'eA==',
    sha256: hashBytes(Buffer.from('x')),
    contentClass: 'implemented' as const,
  };
  assert.throws(() => snapshotHash([{ ...a, bytesBase64: 'eA' }]), { message: 'INVALID_BASE64' });
  assert.throws(() => snapshotHash([a, a]), { message: 'DUPLICATE_PATH' });
});

test('source tree hash is stable for path order and changes when a tracked path changes', () => {
  assert.equal(sourceTreeHash(['src/b.ts', 'src/a.ts']), sourceTreeHash(['src/a.ts', 'src/b.ts']));
  assert.notEqual(sourceTreeHash(['src/a.ts']), sourceTreeHash(['src/A.ts']));
});

test('bundle hash excludes its own digest field and covers backup provenance', () => {
  const input = { sourceSystem: 'crew-v1' as const, backupManifestSha256: 'a'.repeat(64), inventory: [] };
  const expected = createHash('sha256')
    .update(`{"backupManifestSha256":"${'a'.repeat(64)}","inventory":[],"sourceSystem":"crew-v1"}`)
    .digest('hex');
  assert.equal(bundleHash(input), expected);
  assert.notEqual(bundleHash({ ...input, backupManifestSha256: 'b'.repeat(64) }), expected);
});

test('valid standard snapshot is structurally valid but legacy source tree is unverified', () => {
  const result = validateDocs(docsValidationFixture());
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert(result.issues.some((issue) => issue.code === 'SOURCE_TREE_UNVERIFIED'));
});

test('CLAUDE redirect rejects extra blank lines', () => {
  const input = docsValidationFixture({ 'CLAUDE.md': Buffer.from('@AGENTS.md\n\n') });
  assert(validateDocs(input).issues.some((issue) => issue.code === 'CLAUDE_REDIRECT_INVALID'));
});

test('checkout source coverage finds unmapped source and dotfiles', () => {
  const input = docsValidationFixture({}, 'checkout_sync');
  input.trackedSourcePaths.push('src/new.ts', 'src/.hidden.ts');
  const result = validateDocs(input);
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.issues
      .filter((issue) => issue.code === 'SOURCE_UNMAPPED')
      .map((issue) => issue.path)
      .sort(),
    ['src/.hidden.ts', 'src/new.ts'],
  );
});

test('duplicate YAML keys, wrong heading order and stale generated block are errors', () => {
  const input = docsValidationFixture();
  input.files.set(
    'docs/flows.yaml',
    Buffer.from(
      file(input.files, 'docs/flows.yaml').toString().replace('flows:\n', 'flows:\n  sample: {}\n'),
    ),
  );
  input.files.set('docs/flows/sample.md', Buffer.from('# X\n## Mục đích\n## Các bước\n## Điểm vào\n'));
  input.files.set(
    'docs/index.md',
    Buffer.from(file(input.files, 'docs/index.md').toString().replace('Luồng mẫu', 'Luồng cũ')),
  );
  const result = validateDocs(input);
  assert.equal(result.valid, false);
  assert(result.issues.some((issue) => issue.code === 'MANIFEST_INVALID'));
  const separately = docsValidationFixture();
  separately.files.set('docs/flows/sample.md', file(input.files, 'docs/flows/sample.md'));
  separately.files.set('docs/index.md', file(input.files, 'docs/index.md'));
  const separateResult = validateDocs(separately);
  assert(separateResult.issues.some((issue) => issue.code === 'FLOW_HEADINGS_INVALID'));
  assert(separateResult.issues.some((issue) => issue.code === 'GENERATED_BLOCK_STALE'));
});

test('manifest rejects dangerous keys, missing mapped sources and unexpected fields', () => {
  const input = docsValidationFixture({}, 'checkout_sync');
  input.files.set(
    'docs/flows.yaml',
    Buffer.from(
      file(input.files, 'docs/flows.yaml')
        .toString()
        .replace(
          'flows:\n',
          'flows:\n  constructor:\n    title: Hidden\n    doc: docs/flows/constructor.md\n    entrypoints: []\n    files: []\n    tests: []\n',
        ),
    ),
  );
  assert(validateDocs(input).issues.some((issue) => issue.code === 'MANIFEST_INVALID'));
  const other = docsValidationFixture({}, 'checkout_sync');
  other.trackedSourcePaths = [];
  assert(
    validateDocs(other).issues.some(
      (issue) => issue.code === 'MANIFEST_FILE_MISSING' && issue.path === 'src/a.ts',
    ),
  );
  other.files.set(
    'docs/flows.yaml',
    Buffer.from(
      file(other.files, 'docs/flows.yaml').toString().replace('shared: {}', 'extra: true\nshared: {}'),
    ),
  );
  assert(validateDocs(other).issues.some((issue) => issue.code === 'MANIFEST_INVALID'));
});

test('case-sensitive filenames, traversal and invalid UTF8 are detected without changing bytes', () => {
  const input = docsValidationFixture({
    'docs/A.md': Buffer.from('A\r\n'),
    'docs/a.md': Buffer.from('a\n'),
    'docs/../escape.md': Buffer.from('bad'),
    'docs/bad.md': Buffer.from([0xff]),
  });
  const before = Buffer.from(file(input.files, 'docs/A.md'));
  const result = validateDocs(input);
  assert(result.issues.some((issue) => issue.code === 'PATH_INVALID' && issue.path === 'docs/../escape.md'));
  assert(result.issues.some((issue) => issue.code === 'INVALID_UTF8' && issue.path === 'docs/bad.md'));
  assert(file(input.files, 'docs/A.md').equals(before));
  assert.notEqual(file(input.files, 'docs/A.md').toString(), file(input.files, 'docs/a.md').toString());
});

test('workflow artifacts retain their class and standard pages cannot be artifacts', () => {
  const input = docsValidationFixture({ 'docs/superpowers/specs/design.md': Buffer.from('# Planned\n') });
  assert.equal(validateDocs(input).valid, true);
  input.contentClasses.set('docs/superpowers/specs/design.md', 'implemented');
  input.contentClasses.set('docs/index.md', 'workflow_artifact');
  const result = validateDocs(input);
  assert(result.issues.filter((issue) => issue.code === 'CONTENT_CLASS_MISMATCH').length >= 2);
});

test('repeated links and fragments keep distinct occurrence and missing status', () => {
  const input = docsValidationFixture({
    'docs/a.md': Buffer.from('[Một](b.md#one) [Sai](b.md#absent) [Lặp](b.md#one)'),
    'docs/b.md': Buffer.from('# One\n'),
  });
  const result = validateDocs(input);
  const links = result.links.filter((link) => link.fromPath === 'docs/a.md');
  assert.deepEqual(
    links.map((link) => link.occurrence),
    [0, 1, 2],
  );
  assert.deepEqual(
    links.map((link) => link.status),
    ['ok', 'missing', 'ok'],
  );
  assert.equal(result.valid, false);
});

test('reference links and images resolve, code links are ignored and escapes fail', () => {
  const input = docsValidationFixture({
    'docs/a.md': Buffer.from(
      '![Pic][img] [Ref][doc]\n[img]: b.md#one\n[doc]: b.md#one\n`[skip](missing.md)`\n```md\n[skip](missing.md)\n```\n[bad](%2e%2e/%2e%2e/out.md)\n',
    ),
    'docs/b.md': Buffer.from('# One\n'),
  });
  const result = validateDocs(input);
  const links = result.links.filter((link) => link.fromPath === 'docs/a.md');
  assert.deepEqual(
    links.map((link) => link.status),
    ['ok', 'ok', 'unverified'],
  );
  assert(result.issues.some((issue) => issue.code === 'LINK_PATH_ESCAPE'));
});

test('relative parent link inside docs and duplicate heading suffixes resolve', () => {
  const input = docsValidationFixture({
    'docs/flows/a.md': Buffer.from('[Arch](../architecture.md) [Second](../b.md#one-1)'),
    'docs/b.md': Buffer.from('# One\n# One\n'),
  });
  const links = validateDocs(input).links.filter((link) => link.fromPath === 'docs/flows/a.md');
  assert.deepEqual(
    links.map((link) => link.status),
    ['ok', 'ok'],
  );
});

test('missing workflow artifact warns, unsupported heading slug stays unverified', () => {
  const input = docsValidationFixture({
    'docs/a.md': Buffer.from('[Design](superpowers/specs/missing.md) [Heading](b.md#custom)'),
  });
  input.files.set('docs/b.md', Buffer.from('# {#custom}\n'));
  input.contentClasses.set('docs/b.md', 'implemented');
  const result = validateDocs(input);
  assert(
    result.issues.some(
      (issue) => issue.code === 'EXTERNAL_ARTIFACT_NOT_IMPORTED' && issue.severity === 'warning',
    ),
  );
  assert(result.issues.some((issue) => issue.code === 'UNVERIFIED_LINK_SYNTAX'));
});

test('nested Markdown link is flagged as unverified syntax', () => {
  const input = docsValidationFixture({ 'docs/a.md': Buffer.from('[outer [inner]](b.md)') });
  const result = validateDocs(input);
  assert(
    result.issues.some((issue) => issue.code === 'UNVERIFIED_LINK_SYNTAX' && issue.path === 'docs/a.md'),
  );
});
