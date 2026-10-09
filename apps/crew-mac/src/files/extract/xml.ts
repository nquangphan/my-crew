// Port từ v2/server/src/attachments/extract/xml.ts (a13dd7d).
import * as saxes from 'saxes';
import { ExtractError } from './index.js';
import type { WorkerConfig } from './limits.js';
import { decodeText } from './text.js';
export type XmlEvent = {
  kind: 'open' | 'close' | 'text';
  uri: string;
  local: string;
  attributes: Readonly<Record<string, string>>;
  text: string;
};
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
type SaxesInstance = {
  on(event: string, callback: (value: unknown) => void): unknown;
  write(text: string): unknown;
  close(): unknown;
};
function isParser(v: unknown): v is SaxesInstance {
  return (
    object(v) && typeof v.on === 'function' && typeof v.write === 'function' && typeof v.close === 'function'
  );
}
function newParser(): SaxesInstance {
  // saxes 6.0.0 có khai báo generic không ràng buộc, không hợp TS7: chỉ dùng API chạy qua lớp kiểm này.
  // Import tĩnh để esbuild gom saxes vào bundle worker (bản cài không có node_modules).
  const dependency: unknown = saxes;
  if (!object(dependency) || typeof dependency.SaxesParser !== 'function')
    throw new ExtractError('EXTRACTOR_UNAVAILABLE');
  const parser: unknown = Reflect.construct(dependency.SaxesParser, [{ xmlns: true }]);
  if (!isParser(parser)) throw new ExtractError('EXTRACTOR_UNAVAILABLE');
  return parser;
}
export function parseXml(bytes: Uint8Array, onNode: (event: XmlEvent) => void, config: WorkerConfig): void {
  if (bytes.length > config.limits.maxEntryBytes) throw new ExtractError('LIMIT_EXCEEDED');
  const decoded = decodeText(bytes).text;
  let depth = 0,
    total = 0;
  const parser = newParser();
  parser.on('doctype', () => {
    throw new ExtractError('ACTIVE_CONTENT_BLOCKED');
  });
  parser.on('error', () => {
    throw new ExtractError('CORRUPT_XML');
  });
  const tag = (value: unknown, kind: 'open' | 'close') => {
    if (!object(value) || typeof value.uri !== 'string' || typeof value.local !== 'string')
      throw new ExtractError('EXTRACTOR_FAILED');
    const attributes: Record<string, string> = {};
    if (kind === 'open') {
      if (++depth > config.limits.maxXmlDepth) throw new ExtractError('LIMIT_EXCEEDED');
      if (!object(value.attributes)) throw new ExtractError('EXTRACTOR_FAILED');
      for (const a of Object.values(value.attributes)) {
        if (
          !object(a) ||
          typeof a.name !== 'string' ||
          typeof a.uri !== 'string' ||
          typeof a.local !== 'string' ||
          typeof a.value !== 'string'
        )
          throw new ExtractError('EXTRACTOR_FAILED');
        attributes[a.name] = a.value;
        attributes[`{${a.uri}}${a.local}`] = a.value;
      }
    }
    onNode({ kind, uri: value.uri, local: value.local, attributes, text: '' });
    if (kind === 'close') depth--;
  };
  parser.on('opentag', (v) => tag(v, 'open'));
  parser.on('closetag', (v) => tag(v, 'close'));
  const text = (value: unknown) => {
    if (typeof value !== 'string') throw new ExtractError('EXTRACTOR_FAILED');
    const n = Buffer.byteLength(value);
    total += n;
    if (n > config.limits.maxTextNodeBytes || total > config.limits.maxTextBytes)
      throw new ExtractError('LIMIT_EXCEEDED');
    onNode({ kind: 'text', uri: '', local: '', attributes: {}, text: value });
  };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.write(decoded);
  parser.close();
}
