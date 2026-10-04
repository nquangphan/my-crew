import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractImage, extractPdf } from '../src/attachments/extract/index.ts';
import { extractContextFixture, makePdf, makePng } from './fixtures/attachments/make-fixtures.ts';

test('attachment image creates only normalized vision coverage', async () => {
  const r = await extractImage(makePng(3, 2), extractContextFixture('image/png'));
  assert.equal(r.status, 'complete');
  assert.equal(r.units[0]?.needs, 'vision');
  assert.deepEqual(r.units[0]?.locator, { kind: 'image', width: 3, height: 2, box: [0, 0, 1, 1] });
  assert.equal(r.files[0]?.mime, 'image/png');
});
test('attachment huge image is blocked before native allocation', async () =>
  assert.equal(
    (await extractImage(makePng(100000, 100000), extractContextFixture('image/png'))).status,
    'blocked',
  ));
test('attachment truncated image is corrupt', async () =>
  assert.equal(
    (await extractImage(makePng(3, 2).slice(0, 36), extractContextFixture('image/png'))).status,
    'corrupt',
  ));
test('attachment scan cannot become complete text coverage', async () => {
  const r = await extractPdf(makePdf('scan'), extractContextFixture('application/pdf'));
  assert.equal(r.status, 'complete');
  assert.ok(r.units.length > 0);
  assert.ok(r.units.every((u) => u.needs === 'vision' && u.state === 'available'));
  assert.ok(r.files.every((f) => f.kind === 'image'));
  assert.ok(r.units.every((u) => u.locator.kind === 'pdf' && u.locator.page >= 1));
});
test('attachment PDF text supplements every page vision', async () => {
  const r = await extractPdf(makePdf('text'), extractContextFixture('application/pdf'));
  assert.equal(r.status, 'complete');
  assert.ok(r.units.some((u) => u.needs === 'vision'));
  assert.ok(r.units.some((u) => u.needs === 'text'));
});
test('attachment encrypted PDF and corrupt PDF never available', async () => {
  for (const [mode, status] of [
    ['encrypted', 'encrypted'],
    ['corrupt', 'corrupt'],
  ] as const) {
    const r = await extractPdf(makePdf(mode), extractContextFixture('application/pdf'));
    assert.equal(r.status, status);
    assert.equal(r.units.filter((u) => u.state === 'available').length, 0);
  }
});
test('attachment PDF page limit has explicit missing page', async () => {
  const c = extractContextFixture('application/pdf');
  c.config.limits.maxPdfPages = 1;
  const r = await extractPdf(makePdf('mixed'), c);
  assert.equal(r.status, 'partial');
  assert.ok(r.units.some((u) => u.state === 'missing' && u.locator.kind === 'pdf' && u.locator.page === 2));
});
test('attachment JPEG EXIF orientation records original and normalized geometry', async () => {
  const { readFileSync } = await import('node:fs');
  const r = await extractImage(
    readFileSync(new URL('./fixtures/attachments/orientation-6.jpg', import.meta.url)),
    extractContextFixture('image/jpeg'),
  );
  assert.equal(r.status, 'complete');
  assert.deepEqual(r.units[0]?.locator, {
    kind: 'image',
    width: 2,
    height: 3,
    box: [0, 0, 1, 1],
    transform: {
      originalWidth: 3,
      originalHeight: 2,
      orientation: 6,
      normalizedWidth: 2,
      normalizedHeight: 3,
      rotation: 90,
      reflected: false,
    },
  });
});
for (const file of [
  'javascript.pdf',
  'embedded-executable.pdf',
  'launch-escaped.pdf',
  'launch-incremental.pdf',
])
  test(`attachment PDF ${file} is blocked without useful derivatives`, async () => {
    const { readFileSync } = await import('node:fs');
    const r = await extractPdf(
      readFileSync(new URL(`./fixtures/attachments/${file}`, import.meta.url)),
      extractContextFixture('application/pdf'),
    );
    assert.equal(r.status, 'blocked');
    assert.equal(r.files.length, 0);
  });
test('attachment PDF Launch action is blocked before rendering', async () => {
  const { readFileSync } = await import('node:fs');
  const r = await extractPdf(
    readFileSync(new URL('./fixtures/attachments/launch.pdf', import.meta.url)),
    extractContextFixture('application/pdf'),
  );
  assert.equal(r.status, 'blocked');
  assert.equal(r.files.length, 0);
});
test('attachment rotated PDF retains page rotation and portfolio cannot be complete', async () => {
  const { readFileSync } = await import('node:fs');
  const rotated = await extractPdf(
    readFileSync(new URL('./fixtures/attachments/rotated.pdf', import.meta.url)),
    extractContextFixture('application/pdf'),
  );
  assert.equal(rotated.status, 'complete');
  assert.ok(rotated.units.every((u) => u.locator.kind === 'pdf' && u.locator.rotation === 90));
  const portfolio = await extractPdf(
    readFileSync(new URL('./fixtures/attachments/portfolio.pdf', import.meta.url)),
    extractContextFixture('application/pdf'),
  );
  assert.equal(portfolio.status, 'partial');
  assert.ok(portfolio.units.some((u) => u.state === 'missing'));
});
test('attachment image presentation metadata cannot evade origin identity', async () => {
  const { locatorKey } = await import('../src/attachments/worker-protocol.ts');
  const normal = { kind: 'image', width: 3, height: 2, box: [0, 0, 1, 1] };
  const rotated = {
    kind: 'image',
    width: 2,
    height: 3,
    box: [0, 0, 1, 1],
    transform: {
      originalWidth: 3,
      originalHeight: 2,
      orientation: 6,
      normalizedWidth: 2,
      normalizedHeight: 3,
      rotation: 90,
      reflected: false,
    },
  };
  assert.equal(locatorKey(normal), locatorKey(rotated));
});

test('attachment PDF compressed object stream Launch remains blocked', async () => {
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const doc = await PDFDocument.load(makePdf('text'), { updateMetadata: false });
  doc.catalog.set(
    PDFName.of('OpenAction'),
    doc.context.register(doc.context.obj({ S: PDFName.of('Launch'), F: 'inert' })),
  );
  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false });
  assert.ok(Buffer.from(bytes).includes(Buffer.from('/ObjStm')));
  const { readFileSync } = await import('node:fs');
  assert.deepEqual(
    Buffer.from(bytes),
    readFileSync(new URL('./fixtures/attachments/launch-compressed.pdf', import.meta.url)),
  );
  const r = await extractPdf(bytes, extractContextFixture('application/pdf'));
  assert.equal(r.status, 'blocked');
  assert.equal(r.files.length, 0);
});
test('attachment optional EXIF provenance rejects extras and inconsistent finite geometry', async () => {
  const { readFileSync } = await import('node:fs');
  const { verifyExtraction } = await import('../src/attachments/extract/index.ts');
  const { validateWorkerResult } = await import('../src/attachments/worker-protocol.ts');
  const c = extractContextFixture('image/jpeg');
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
  const r = verifyExtraction(
    input,
    await extractImage(readFileSync(new URL('./fixtures/attachments/orientation-6.jpg', import.meta.url)), c),
  );
  for (const patch of [
    { extra: true },
    { originalWidth: 0 },
    { originalWidth: Infinity },
    { orientation: 1.5 },
    { orientation: 9 },
    { rotation: 270 },
    { reflected: true },
    { normalizedWidth: 3 },
  ]) {
    const copy = structuredClone(r);
    const locator = copy.units[0]?.locator;
    assert.ok(locator?.kind === 'image' && locator.transform);
    Object.assign(locator.transform, patch);
    assert.throws(() => validateWorkerResult(input, copy));
  }
});
