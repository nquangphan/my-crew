import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { hash } from '../journal/atomic-records.ts';
import { officialSourceUrl, type SourcePin, validateSourcePin } from './pins.ts';
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export async function readArchive(
  stream: AsyncIterable<Uint8Array | string>,
  limit = MAX_ARCHIVE_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const b = Buffer.from(chunk);
    bytes += b.length;
    if (bytes > limit) throw new Error('ARCHIVE_SIZE_LIMIT');
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}
export function verifyPayload(pin: SourcePin, bytes: Buffer): void {
  if (hash(bytes) !== pin.payloadSha256) throw new Error('CHECKSUM_MISMATCH');
  if (
    pin.packageIntegrity &&
    `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== pin.packageIntegrity
  )
    throw new Error('PACKAGE_INTEGRITY_MISMATCH');
}
export async function fetchSource(
  pin: SourcePin,
  options: { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number; transport?: typeof fetch } = {},
): Promise<Buffer> {
  validateSourcePin(pin);
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? 30_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  let url = officialSourceUrl(pin, pin.sourceUrl);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await (options.transport ?? fetch)(url, {
      redirect: 'manual',
      signal,
      headers: { 'accept-encoding': 'identity' },
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const target = response.headers.get('location');
      if (!target) throw new Error('DOWNLOAD_FAILED');
      url = officialSourceUrl(pin, new URL(target, url).href);
      continue;
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error('DOWNLOAD_FAILED');
    }
    const max = Math.min(options.maxBytes ?? MAX_ARCHIVE_BYTES, MAX_ARCHIVE_BYTES);
    const size = Number(response.headers.get('content-length'));
    if (Number.isFinite(size) && size > max) {
      await response.body.cancel();
      throw new Error('ARCHIVE_SIZE_LIMIT');
    }
    const bytes = await readArchive(response.body, max);
    verifyPayload(pin, bytes);
    return bytes;
  }
  throw new Error('REDIRECT_LIMIT');
}
export async function suppliedArchive(pin: SourcePin, stream: Readable): Promise<Buffer> {
  validateSourcePin(pin);
  let timer: NodeJS.Timeout | undefined;
  try {
    timer = setTimeout(() => stream.destroy(new Error('ARCHIVE_TIMEOUT')), 30_000);
    timer.unref();
    const bytes = await readArchive(stream);
    verifyPayload(pin, bytes);
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}
