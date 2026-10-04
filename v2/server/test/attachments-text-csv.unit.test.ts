import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractCsv, extractText, verifyExtraction } from '../src/attachments/extract/index.ts';
import { extractContextFixture } from './fixtures/attachments/make-fixtures.ts';

const text = (r: Awaited<ReturnType<typeof extractText>>) =>
  Buffer.concat(r.files.map((f) => Buffer.from(f.bytes))).toString();
test('attachment text preserves UTF8 source byte spans and literal scripts', async () => {
  const b = Buffer.from('Việt\n<script>x()</script>\u0000');
  const r = await extractText(b, extractContextFixture('text/plain'));
  assert.equal(r.status, 'complete');
  assert.match(text(r), /Việt/);
  assert.match(text(r), /\\u0000/);
  assert.deepEqual(r.units[0]?.locator, {
    kind: 'text',
    byteStart: 0,
    byteEnd: b.length,
    lineStart: 1,
    lineEnd: 2,
  });
});
test('attachment text UTF16 endian BOM and invalid UTF8', async () => {
  assert.equal(
    (await extractText(Buffer.from([0xff, 0xfe, 65, 0]), extractContextFixture('text/plain'))).status,
    'complete',
  );
  assert.equal(
    (await extractText(Buffer.from([0xfe, 0xff, 0, 65]), extractContextFixture('text/plain'))).status,
    'complete',
  );
  assert.equal(
    (await extractText(Buffer.from([0xc0, 0xaf]), extractContextFixture('text/plain'))).status,
    'unsupported',
  );
});
test('attachment text cap preserves missing original tail', async () => {
  const c = extractContextFixture('text/plain');
  c.config.limits.maxTextBytes = 4;
  const r = await extractText(Buffer.from('abc\ndef'), c);
  assert.equal(r.status, 'partial');
  assert.ok(
    r.units.some((u) => u.state === 'missing' && u.locator.kind === 'text' && u.locator.byteEnd === 7),
  );
});
test('attachment csv retains multiline quoted cells without evaluating formula', async () => {
  const r = await extractCsv(
    Buffer.from('name,value\r\n"a\nb","=1+1"\r\n'),
    extractContextFixture('text/csv'),
  );
  assert.equal(r.status, 'complete');
  assert.match(text(r), /=1\+1/);
  assert.match(text(r), /a\\nb/);
  assert.ok(r.units.some((u) => u.locator.kind === 'csv' && u.locator.rowStart === 2));
});
for (const bad of ['a"b,c', '"a"x,c', '"unclosed'])
  test(`attachment malformed CSV ${JSON.stringify(bad)}`, async () =>
    assert.equal((await extractCsv(Buffer.from(bad), extractContextFixture('text/csv'))).status, 'corrupt'));
test('attachment CSV cap reports missing rows', async () => {
  const c = extractContextFixture('text/csv');
  c.config.limits.maxCsvRows = 1;
  const r = await extractCsv(Buffer.from('a\nb\nc'), c);
  assert.equal(r.status, 'partial');
  assert.ok(r.units.some((u) => u.state === 'missing'));
});
test('attachment verification binds bytes and rejects missing coverage', async () => {
  const c = extractContextFixture('text/plain');
  const input = {
    version: 1 as const,
    jobId: '22222222-2222-4222-8222-222222222222',
    generation: '1',
    original: c.original,
    mime: c.mime,
    inputName: 'original' as const,
    extractorVersion: 'fixture',
    config: c.config,
  };
  const r = await extractText(Buffer.from('hello'), c);
  const v = verifyExtraction(input, r);
  assert.equal(v.files[0]?.byteLength, r.files[0]?.bytes.length);
  assert.match(v.files[0]?.sha256 ?? '', /^[0-9a-f]{64}$/);
  assert.throws(() => verifyExtraction(input, { ...r, files: [] }));
  assert.throws(() => verifyExtraction(input, { ...r, units: [...r.units, ...r.units] }));
});
test('attachment UTF16 capped tail uses real byte and line boundaries', async () => {
  const c = extractContextFixture('text/plain');
  c.config.limits.maxTextBytes = 2;
  const r = await extractText(Buffer.concat([Buffer.from([255, 254]), Buffer.from('a\nb\nc', 'utf16le')]), c);
  const tail = r.units.find((u) => u.state === 'missing');
  assert.deepEqual(tail?.locator, { kind: 'text', byteStart: 6, byteEnd: 12, lineStart: 2, lineEnd: 3 });
});
test('attachment complete text whitespace has explicit zero content coverage', async () => {
  const r = await extractText(Buffer.from(' \n\t'), extractContextFixture('text/plain'));
  assert.equal(r.status, 'complete');
  assert.equal(r.units.length, 1);
  assert.equal(r.units[0]?.state, 'available');
});
test('attachment entire golden corpus verifies every available derivative and original identity', async () => {
  const { corpusCases } = await import('./fixtures/attachments/make-fixtures.ts');
  const { extractAttachment } = await import('../src/attachments/extract/index.ts');
  const { createHash } = await import('node:crypto');
  for (const item of corpusCases()) {
    const c = extractContextFixture(item.mime);
    c.original.sha256 = createHash('sha256').update(item.bytes).digest('hex');
    const input = {
      version: 1 as const,
      jobId: '22222222-2222-4222-8222-222222222222',
      generation: '1',
      original: c.original,
      mime: c.mime,
      inputName: 'original' as const,
      extractorVersion: 'fixture',
      config: c.config,
    };
    const r = await extractAttachment(item.bytes, c);
    assert.equal(r.status, item.status, item.name);
    const verified = verifyExtraction(input, r);
    assert.equal(verified.original.sha256, c.original.sha256, item.name);
    if (item.text) assert.ok(text(r).includes(item.text), item.name);
    assert.ok(
      verified.units
        .filter((u) => u.state === 'available')
        .every((u) => verified.files.some((f) => f.unitIds.includes(u.id))),
      item.name,
    );
  }
});
test('attachment corpus challenge cannot act as production admission', async () => {
  const { createDockerExtractorRunner, createExtractorCorpusVerifier } = await import(
    '../src/attachments/worker-runner.ts'
  );
  const config = {
    dockerBinary: '/usr/local/bin/docker',
    storageRoot: '/tmp/fixture',
    imageDigest: `sha256:${'a'.repeat(64)}`,
    sourceTreeSha256: 'b'.repeat(64),
    wallMs: 1000,
  };
  assert.throws(() =>
    createExtractorCorpusVerifier(config, {
      version: 1,
      imageDigest: config.imageDigest,
      sourceTreeSha256: config.sourceTreeSha256,
      corpusSha256: 'c'.repeat(64),
      config: extractContextFixture('text/plain').config,
      originals: [],
      maxCases: 1,
    }),
  );
  await assert.rejects(
    createDockerExtractorRunner(config).start({} as never, '/tmp/fixture'),
    /PRODUCTION_CORPUS_REQUIRED/,
  );
});
test('attachment corpus verifier binds immutable challenge before any spawn', async () => {
  const { createExtractorCorpusVerifier } = await import('../src/attachments/worker-runner.ts');
  const { createHash } = await import('node:crypto');
  const originals = [{ sha256: 'a'.repeat(64), mime: 'text/plain' }];
  const config = {
    dockerBinary: '/usr/local/bin/docker',
    storageRoot: '/tmp/fixture',
    imageDigest: `sha256:${'a'.repeat(64)}`,
    sourceTreeSha256: 'b'.repeat(64),
    wallMs: 1000,
  };
  const v = createExtractorCorpusVerifier(config, {
    version: 1,
    imageDigest: config.imageDigest,
    sourceTreeSha256: config.sourceTreeSha256,
    corpusSha256: createHash('sha256').update(JSON.stringify(originals)).digest('hex'),
    config: extractContextFixture('text/plain').config,
    originals,
    maxCases: 1,
  });
  assert.equal(typeof v.verify, 'function');
});
test('attachment framed extraction emits bounded chunks and matching terminal digest', async () => {
  const { Writable } = await import('node:stream');
  const { extractToFrames } = await import('../src/attachments/extract/index.ts');
  const c = extractContextFixture('text/plain');
  const input = {
    version: 1 as const,
    jobId: '22222222-2222-4222-8222-222222222222',
    generation: '1',
    original: c.original,
    mime: c.mime,
    inputName: 'original' as const,
    extractorVersion: 'fixture',
    config: c.config,
  };
  const lines: string[] = [];
  await extractToFrames(
    input,
    Buffer.from('a'.repeat(70000)),
    new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    }),
  );
  const frames = lines.map((line) => JSON.parse(line));
  assert.equal(frames.at(-1).kind, 'result');
  assert.equal(frames.at(-1).body.status, 'complete');
  assert.ok(
    frames
      .filter((f) => f.kind === 'file-chunk')
      .every((f) => Buffer.from(f.base64, 'base64').length <= 65536),
  );
  assert.ok(lines.every((line) => Buffer.byteLength(line) <= 131072));
});
test('attachment metadata overflow preserves prefix and declares missing tail', async () => {
  const c = extractContextFixture('text/plain');
  const input = {
    version: 1 as const,
    jobId: '22222222-2222-4222-8222-222222222222',
    generation: '1',
    original: c.original,
    mime: c.mime,
    inputName: 'original' as const,
    extractorVersion: 'fixture',
    config: c.config,
  };
  const units = Array.from({ length: 100001 }, (_, i) => ({
    id: `u${i}`,
    locator: { kind: 'text' as const, byteStart: i, byteEnd: i + 1, lineStart: 1, lineEnd: 1 },
    needs: 'text' as const,
    state: 'missing' as const,
    reason: 'LIMIT_EXCEEDED',
  }));
  const r = verifyExtraction(input, { status: 'partial', units, files: [], problems: [] });
  assert.equal(r.status, 'partial');
  assert.ok(r.units.length <= 100000);
  const last = r.units.at(-1);
  assert.ok(last?.locator.kind === 'text' && last.locator.byteEnd === 100001);
});
test('attachment production authority rejects wrong permit before Docker and binds full limits', async () => {
  const { createDockerExtractorRunner } = await import('../src/attachments/worker-runner.ts');
  const c = extractContextFixture('text/plain');
  const input = {
    version: 1 as const,
    jobId: '22222222-2222-4222-8222-222222222222',
    generation: '1',
    original: c.original,
    mime: c.mime,
    inputName: 'original' as const,
    extractorVersion: `crew-extractor-v1+pdfjs6.3.289+canvas1.0.3+yauzl3.4.0+saxes6.0.0+pdf-lib1.17.1+${'b'.repeat(64)}`,
    config: c.config,
  };
  const config = {
    dockerBinary: '/does-not-exist/docker',
    storageRoot: '/tmp/fixture',
    imageDigest: `sha256:${'a'.repeat(64)}`,
    sourceTreeSha256: 'b'.repeat(64),
    wallMs: 1000,
  };
  const runner = createDockerExtractorRunner(config, {
    async authorize(binding) {
      return {
        ...binding,
        workerConfigSha256: '0'.repeat(64),
        reviewedEvidenceSha256: 'c'.repeat(64),
        lockSha256: 'd'.repeat(64),
        nativeIntegrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
        boundaryEvidenceSha256: 'e'.repeat(64),
        corpusEvidenceSha256: 'f'.repeat(64),
      };
    },
  });
  await assert.rejects(runner.start(input, '/tmp/fixture'), /WORKER_PRODUCTION_ADMISSION_INVALID/);
  c.config.limits.maxPdfPages = 1;
  await assert.rejects(runner.start(input, '/tmp/fixture'), /WORKER_PRODUCTION_ADMISSION_INVALID/);
});
test('attachment CSV Unicode field byte cap uses codepoints and large row sets group coverage', async () => {
  const c = extractContextFixture('text/csv');
  c.config.limits.maxCsvFieldBytes = 4;
  assert.equal((await extractCsv(Buffer.from('😀'), c)).status, 'complete');
  const rows = await extractCsv(Buffer.from('x\n'.repeat(12000)), extractContextFixture('text/csv'));
  assert.equal(rows.status, 'complete');
  assert.ok(rows.units.length < 10000);
  assert.ok(rows.units.some((u) => u.locator.kind === 'csv' && u.locator.rowEnd === 12000));
});
test('attachment missing coverage append is bounded before allocation grows', async () => {
  const { missing, empty, problem } = await import('../src/attachments/extract/index.ts');
  const r = empty();
  r.problems = Array(100000).fill(problem('LIMIT_EXCEEDED'));
  assert.throws(
    () =>
      missing(
        r,
        { kind: 'text', byteStart: 0, byteEnd: 1, lineStart: 1, lineEnd: 1 },
        'text',
        'LIMIT_EXCEEDED',
      ),
    /LIMIT_EXCEEDED/,
  );
});
test('attachment metadata budget retains a verifiable available prefix before progressive output', async () => {
  const { append, empty, verifyExtraction } = await import('../src/attachments/extract/index.ts');
  const c = extractContextFixture('application/docx');
  const r = empty();
  for (let n = 1; n <= 9000; n++)
    append(
      r,
      { kind: 'docx', part: 'a'.repeat(1024), paragraph: n, table: null, row: null, cell: null },
      new Uint8Array(),
      'text',
      c,
    );
  const result = verifyExtraction(
    {
      version: 1,
      jobId: '22222222-2222-4222-8222-222222222222',
      generation: '1',
      original: c.original,
      mime: c.mime,
      inputName: 'original',
      extractorVersion: 'fixture',
      config: c.config,
    },
    r,
  );
  assert.equal(result.status, 'partial');
  assert.ok(result.files.length > 0);
  assert.ok(result.units.some((u) => u.state === 'missing'));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 8 * 1024 * 1024);
  assert.equal(result.files.length, r.files.length);
});
