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

test('inline-code label and shortcut reference retain broken link occurrences and original hrefs', () => {
  const raw = Buffer.from('[`Thiết kế`](missing.md#first) [Thiết kế]\r\n[Thiết kế]: missing.md#second\r\n');
  const input = docsValidationFixture({ 'docs/a.md': raw });
  const before = Buffer.from(raw);
  const result = validateDocs(input);
  const links = result.links.filter((link) => link.fromPath === 'docs/a.md');
  assert.deepEqual(
    links.map((link) => link.occurrence),
    [0, 1],
  );
  assert.deepEqual(
    links.map((link) => link.originalHref),
    ['missing.md#first', 'missing.md#second'],
  );
  assert.deepEqual(
    links.map((link) => link.fragment),
    ['first', 'second'],
  );
  assert.deepEqual(
    links.map((link) => link.status),
    ['missing', 'missing'],
  );
  assert.equal(result.valid, false);
  assert.equal(
    result.issues.filter((issue) => issue.code === 'LINK_MISSING' && issue.path === 'docs/a.md').length,
    2,
  );
  assert(raw.equals(before));
});

test('unsupported link-like syntax warns instead of silently claiming full audit', () => {
  const input = docsValidationFixture({ 'docs/a.md': Buffer.from('[nested [label]](missing.md)') });
  assert(
    validateDocs(input).issues.some(
      (issue) => issue.code === 'UNVERIFIED_LINK_SYNTAX' && issue.path === 'docs/a.md',
    ),
  );
});

test('artifact-only snapshot passes integrity audit without STANDARD pages; mixed subset still requires them', () => {
  const artifact = 'docs/superpowers/specs/design.md';
  const only = docsValidationFixture();
  only.files = new Map([[artifact, Buffer.from('# Dự kiến\r\n')]]);
  only.contentClasses = new Map([[artifact, 'workflow_artifact']]);
  const isolated = validateDocs(only);
  assert.equal(isolated.valid, true, JSON.stringify(isolated.issues));
  assert.equal(isolated.issues.filter((issue) => issue.code === 'REQUIRED_DOC_MISSING').length, 0);

  const mixed = docsValidationFixture({ [artifact]: Buffer.from('# Dự kiến\r\n') });
  assert.equal(validateDocs(mixed).valid, true);
  mixed.files.delete('docs/index.md');
  const incomplete = validateDocs(mixed);
  assert.equal(incomplete.valid, false);
  assert(
    incomplete.issues.some(
      (issue) => issue.code === 'REQUIRED_DOC_MISSING' && issue.path === 'docs/index.md',
    ),
  );
  assert.equal(mixed.contentClasses.get(artifact), 'workflow_artifact');
});

test('every numbered step in actual Các bước section needs file and symbol', () => {
  const input = docsValidationFixture();
  const flow = file(input.files, 'docs/flows/sample.md').toString();
  input.files.set(
    'docs/flows/sample.md',
    Buffer.from(
      flow
        .replace(
          '1. `src/a.ts` → `run`: chạy.',
          '1. `src/a.ts` → `run`: chạy.\n```md\n2. ví dụ trong code\n```\n2. làm gì đó',
        )
        .replace('## Dữ liệu\n', '## Dữ liệu\n3. ví dụ ở phần khác\n'),
    ),
  );
  const result = validateDocs(input);
  assert(
    result.issues.some(
      (issue) => issue.code === 'FLOW_STEPS_INVALID' && issue.path === 'docs/flows/sample.md',
    ),
  );

  input.files.set(
    'docs/flows/sample.md',
    Buffer.from(
      flow
        .replace(
          '1. `src/a.ts` → `run`: chạy.',
          '1. `src/a.ts` → `run`: chạy.\n```md\n2. ví dụ trong code\n```\n2. `src/b.ts` → `next`: tiếp tục.',
        )
        .replace('## Dữ liệu\n', '## Dữ liệu\n3. ví dụ ở phần khác\n'),
    ),
  );
  assert.equal(
    validateDocs(input).issues.some((issue) => issue.code === 'FLOW_STEPS_INVALID'),
    false,
  );
});

test('fenced heading examples do not change the required flow heading sequence', () => {
  const input = docsValidationFixture();
  const flow = file(input.files, 'docs/flows/sample.md').toString();
  input.files.set(
    'docs/flows/sample.md',
    Buffer.from(
      flow.replace(
        '1. `src/a.ts` → `run`: chạy.',
        '1. `src/a.ts` → `run`: chạy.\n```md\n## Ví dụ\n2. thiếu symbol\n```',
      ),
    ),
  );
  const result = validateDocs(input);
  assert.equal(
    result.issues.some((issue) => issue.code === 'FLOW_HEADINGS_INVALID'),
    false,
  );
  assert.equal(
    result.issues.some((issue) => issue.code === 'FLOW_STEPS_INVALID'),
    false,
  );
});

test('empty numbered marker in Các bước is audited as an invalid step', () => {
  const input = docsValidationFixture();
  const flow = file(input.files, 'docs/flows/sample.md').toString();
  input.files.set(
    'docs/flows/sample.md',
    Buffer.from(flow.replace('1. `src/a.ts` → `run`: chạy.', '1. `src/a.ts` → `run`: chạy.\n2. ')),
  );
  const result = validateDocs(input);
  assert.equal(result.valid, false);
  assert(
    result.issues.some(
      (issue) => issue.code === 'FLOW_STEPS_INVALID' && issue.path === 'docs/flows/sample.md',
    ),
  );
});

test('task-list checkboxes do not consume link occurrences or create link warnings', () => {
  const raw = Buffer.from('- [x] done\r\n- [ ] todo\r\n[real](missing.md#one)\r\n');
  const input = docsValidationFixture({ 'docs/a.md': raw });
  const before = Buffer.from(raw);
  const result = validateDocs(input);
  const links = result.links.filter((link) => link.fromPath === 'docs/a.md');
  assert.deepEqual(
    links.map((link) => link.occurrence),
    [0],
  );
  assert.deepEqual(
    links.map((link) => link.originalHref),
    ['missing.md#one'],
  );
  assert.deepEqual(
    links.map((link) => link.fragment),
    ['one'],
  );
  assert.deepEqual(
    links.map((link) => link.status),
    ['missing'],
  );
  assert.equal(
    result.issues.filter((issue) => issue.code === 'UNVERIFIED_LINK_SYNTAX' && issue.path === 'docs/a.md')
      .length,
    0,
  );
  assert(raw.equals(before));
});

test('task-list marker variants preserve real link and shortcut occurrences', () => {
  for (const marker of [
    '- [x]',
    '+ [ ]',
    '* [X]',
    '1. [x]',
    '1) [x]',
    '> - [x]',
    '> 2) [ ]',
    '> > * [X]',
    '  - [x]',
    '- 1) [x]',
  ]) {
    const raw = Buffer.from(
      `${marker} done\r\n[real](missing.md#one) [shortcut] [\`Code\`](missing.md#three)\r\n[shortcut]: missing.md#two\r\n`,
    );
    const input = docsValidationFixture({ 'docs/a.md': raw });
    const before = Buffer.from(raw);
    const result = validateDocs(input);
    const links = result.links.filter((link) => link.fromPath === 'docs/a.md');
    assert.deepEqual(
      links.map((link) => link.occurrence),
      [0, 1, 2],
      marker,
    );
    assert.deepEqual(
      links.map((link) => link.originalHref),
      ['missing.md#one', 'missing.md#two', 'missing.md#three'],
      marker,
    );
    assert.deepEqual(
      links.map((link) => link.fragment),
      ['one', 'two', 'three'],
      marker,
    );
    assert.deepEqual(
      links.map((link) => link.status),
      ['missing', 'missing', 'missing'],
      marker,
    );
    assert.equal(
      result.issues.filter((issue) => issue.code === 'UNVERIFIED_LINK_SYNTAX' && issue.path === 'docs/a.md')
        .length,
      0,
      marker,
    );
    assert(raw.equals(before), marker);
  }
});
