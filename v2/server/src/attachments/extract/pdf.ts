import { fileURLToPath } from 'node:url';
import {
  append,
  drainFiles,
  type ExtractContext,
  ExtractError,
  type ExtractResult,
  empty,
  failure,
  missing,
} from './index.ts';
export async function extractPdf(bytes: Uint8Array, c: ExtractContext): Promise<ExtractResult> {
  let loading: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
  try {
    const { createCanvas } = await import('@napi-rs/canvas');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const root = new URL('./', import.meta.resolve('pdfjs-dist/package.json'));
    loading = getDocument({
      data: new Uint8Array(bytes),
      stopAtErrors: true,
      enableXfa: false,
      useWorkerFetch: false,
      disableFontFace: true,
      cMapUrl: fileURLToPath(new URL('cmaps/', root)),
      cMapPacked: true,
      standardFontDataUrl: fileURLToPath(new URL('standard_fonts/', root)),
      wasmUrl: fileURLToPath(new URL('wasm/', root)),
      verbosity: 0,
    });
    const abort = () => {
      void loading?.destroy();
    };
    c.signal.addEventListener('abort', abort, { once: true });
    let doc: Awaited<typeof loading.promise>;
    try {
      doc = await loading.promise;
    } catch (e) {
      if (e instanceof Error && e.name === 'PasswordException') throw new ExtractError('PASSWORD_REQUIRED');
      if (e instanceof Error && ['InvalidPDFException', 'UnknownErrorException'].includes(e.name))
        throw new ExtractError('CORRUPT_DOCUMENT');
      throw e;
    }
    const r = empty();
    try {
      const unsupportedStructure = await inspectPdfStructure(bytes, c);
      if (await doc.getJSActions()) throw new ExtractError('ACTIVE_CONTENT_BLOCKED');
      const attachments = await doc.getAttachments();
      if (
        attachments &&
        [...attachments.values()].some((a) => /\.(exe|dll|com|bat|cmd|js|vbs|ps1|sh)$/i.test(a.filename))
      )
        throw new ExtractError('ACTIVE_CONTENT_BLOCKED');
      if (attachments || doc.isPureXfa || unsupportedStructure)
        missing(r, { kind: 'pdf', page: 1, box: [0, 0, 0, 0], rotation: 0 }, 'vision', 'UNSUPPORTED_VISUAL');
      const metadata = await doc.getMetadata();
      const info: unknown = metadata.info;
      if (
        info &&
        typeof info === 'object' &&
        (('IsXFAPresent' in info && info.IsXFAPresent) ||
          ('IsCollectionPresent' in info && info.IsCollectionPresent))
      )
        if (!r.units.length)
          missing(
            r,
            { kind: 'pdf', page: 1, box: [0, 0, 0, 0], rotation: 0 },
            'vision',
            'UNSUPPORTED_VISUAL',
          );
      for (let n = 1; n <= Math.min(doc.numPages, c.config.limits.maxPdfPages); n++) {
        c.signal.throwIfAborted();
        let page: Awaited<ReturnType<typeof doc.getPage>>;
        try {
          page = await doc.getPage(n);
        } catch {
          missing(r, { kind: 'pdf', page: n, box: [0, 0, 1, 1], rotation: 0 }, 'vision', 'CORRUPT_DOCUMENT');
          continue;
        }
        try {
          if (await page.getJSActions()) throw new ExtractError('ACTIVE_CONTENT_BLOCKED');
          const annotations = await page.getAnnotations({ intent: 'display' });
          if (annotations.some((a) => a.actions || a.action === 'Launch'))
            throw new ExtractError('ACTIVE_CONTENT_BLOCKED');
          const viewport = page.getViewport({ scale: c.config.limits.pdfDpi / 72 });
          const locator = {
            kind: 'pdf' as const,
            page: n,
            box: [0, 0, 1, 1] as [number, number, number, number],
            rotation: ((page.rotate % 360) + 360) % 360,
          };
          if (Math.ceil(viewport.width) * Math.ceil(viewport.height) > c.config.limits.maxPagePixels) {
            missing(r, locator, 'vision', 'LIMIT_EXCEEDED');
            continue;
          }
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const render = page.render({
            canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
            canvas: canvas as unknown as HTMLCanvasElement,
            viewport,
          });
          const cancel = () => render.cancel();
          c.signal.addEventListener('abort', cancel, { once: true });
          try {
            await render.promise;
          } finally {
            c.signal.removeEventListener('abort', cancel);
          }
          if (!append(r, locator, canvas.toBuffer('image/png'), 'image', c)) break;
          const content = await page.getTextContent();
          let textBytes = 0;
          for (const item of content.items) {
            if (!('str' in item) || !item.str) continue;
            const body = Buffer.from(
              `${JSON.stringify({ text: item.str, transform: item.transform, width: item.width, height: item.height })}\n`,
            );
            textBytes += body.length;
            if (textBytes > c.config.limits.maxTextBytes) {
              missing(
                r,
                { kind: 'pdf', page: n, box: [0, 0, 0, 0], rotation: locator.rotation },
                'text',
                'LIMIT_EXCEEDED',
              );
              break;
            }
            const x = item.transform[4] ?? 0,
              y = item.transform[5] ?? 0;
            const box: [number, number, number, number] = [
              x - (page.view[0] ?? 0),
              y - (page.view[1] ?? 0),
              item.width,
              item.height,
            ];
            if (!append(r, { ...locator, box }, body, 'text', c)) break;
          }
        } catch (e) {
          if (e instanceof ExtractError && e.code === 'ACTIVE_CONTENT_BLOCKED') throw e;
          if (
            e instanceof Error &&
            ['RenderingCancelledException', 'InvalidPDFException', 'UnknownErrorException'].includes(e.name)
          )
            missing(
              r,
              { kind: 'pdf', page: n, box: [0, 0, 1, 1], rotation: 0 },
              'vision',
              'CORRUPT_DOCUMENT',
            );
          else throw e;
        } finally {
          page.cleanup();
          await drainFiles(r, c);
        }
      }
      if (doc.numPages > c.config.limits.maxPdfPages)
        missing(
          r,
          { kind: 'pdf', page: c.config.limits.maxPdfPages + 1, box: [0, 0, 1, 1], rotation: 0 },
          'vision',
          'LIMIT_EXCEEDED',
        );
      return r;
    } finally {
      c.signal.removeEventListener('abort', abort);
    }
  } catch (e) {
    return failure(e);
  } finally {
    await loading?.destroy();
  }
}

/** Parse the object graph independently before emitting any rendered page. */
async function inspectPdfStructure(bytes: Uint8Array, c: ExtractContext): Promise<boolean> {
  const {
    PDFDocument,
    PDFDict,
    PDFArray,
    PDFRef,
    PDFName,
    PDFRawStream,
    PDFString,
    PDFHexString,
    PDFNumber,
  } = await import('pdf-lib');
  let document: Awaited<ReturnType<typeof PDFDocument.load>>;
  try {
    document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
      parseSpeed: 100,
    });
  } catch {
    throw new ExtractError('CORRUPT_DOCUMENT');
  }
  const objects = document.context.enumerateIndirectObjects();
  if (objects.length > 100000) throw new ExtractError('LIMIT_EXCEEDED');
  const seen = new Set<unknown>();
  let count = 0,
    streamBytes = 0,
    unsupported = false;
  const visit = (object: unknown, depth: number): void => {
    c.signal.throwIfAborted();
    if (depth > c.config.limits.maxXmlDepth || ++count > 200000) throw new ExtractError('LIMIT_EXCEEDED');
    if (object instanceof PDFRef) {
      const target = document.context.lookup(object);
      if (!target) throw new ExtractError('CORRUPT_DOCUMENT');
      visit(target, depth + 1);
      return;
    }
    if (seen.has(object)) return;
    seen.add(object);
    if (object instanceof PDFRawStream) {
      const length = object.dict.lookup(PDFName.of('Length'));
      if (!(length instanceof PDFNumber) || length.asNumber() !== object.getContentsSize())
        throw new ExtractError('CORRUPT_DOCUMENT');
      const filter = object.dict.lookup(PDFName.of('Filter'));
      const filters = filter instanceof PDFArray ? filter.asArray() : filter ? [filter] : [];
      for (const item of filters) {
        const resolved = item instanceof PDFRef ? document.context.lookup(item) : item;
        if (
          !(resolved instanceof PDFName) ||
          ![
            'FlateDecode',
            'Fl',
            'ASCIIHexDecode',
            'AHx',
            'ASCII85Decode',
            'A85',
            'LZWDecode',
            'LZW',
            'RunLengthDecode',
            'RL',
            'CCITTFaxDecode',
            'CCF',
            'DCTDecode',
            'DCT',
            'JPXDecode',
            'JBIG2Decode',
          ].includes(resolved.decodeText())
        )
          throw new ExtractError('UNSUPPORTED_TYPE');
      }
      streamBytes += object.getContentsSize();
      if (streamBytes > c.config.limits.maxExpandedBytes) throw new ExtractError('LIMIT_EXCEEDED');
      visit(object.dict, depth + 1);
    } else if (object instanceof PDFArray) {
      for (let i = 0; i < object.size(); i++) visit(object.get(i), depth + 1);
    } else if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        const name = key.decodeText();
        if (['JS', 'JavaScript'].includes(name)) throw new ExtractError('ACTIVE_CONTENT_BLOCKED');
        if (['Collection', 'XFA', 'RichMediaContent', '3DD'].includes(name)) unsupported = true;
        const resolved = value instanceof PDFRef ? document.context.lookup(value) : value;
        if (!resolved) throw new ExtractError('CORRUPT_DOCUMENT');
        if (name === 'S' && resolved instanceof PDFName) {
          const action = resolved.decodeText();
          if (['Launch', 'JavaScript'].includes(action)) throw new ExtractError('ACTIVE_CONTENT_BLOCKED');
          if (['GoToR', 'GoToE', 'SubmitForm', 'ImportData', 'Rendition', 'Movie', 'Sound'].includes(action))
            unsupported = true;
        }
        if (
          ['F', 'UF'].includes(name) &&
          (resolved instanceof PDFString || resolved instanceof PDFHexString) &&
          /\.(exe|dll|com|bat|cmd|js|vbs|ps1|sh)$/i.test(resolved.decodeText())
        )
          throw new ExtractError('ACTIVE_CONTENT_BLOCKED');
        visit(value, depth + 1);
      }
    }
  };
  for (const [, object] of objects) visit(object, 0);
  return unsupported;
}
