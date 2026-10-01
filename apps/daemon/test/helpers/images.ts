import { crc32, deflateSync } from 'node:zlib';
import type { Fixture } from './api.js';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** A valid 8-bit RGB PNG whose pixels come from `pixel` (no image library needed). */
export function makePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number],
): Buffer {
  const row = 1 + width * 3;
  const raw = Buffer.alloc(height * row);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * row + 1 + x * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A tiny PNG of one colour; a different `seed` gives different bytes. */
export const tinyPng = (seed: number): Buffer =>
  makePng(4, 4, () => [seed & 255, (seed * 7) & 255, (seed * 13) & 255]);

/** A PNG of noise (about 50 KB: it does not compress), to tell real image bytes from a few stray ones. */
export function noisePng(seed: number): Buffer {
  let state = seed >>> 0 || 1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 24;
  };
  return makePng(128, 128, () => [next(), next(), next()]);
}

/** Stripe colours a vision model names reliably, by the letter a test asks for. */
export const STRIPE_COLOURS = {
  R: [220, 30, 30],
  G: [30, 160, 60],
  B: [30, 70, 220],
  Y: [250, 220, 30],
} as const satisfies Record<string, readonly [number, number, number]>;

/** A PNG of equal vertical stripes, left to right in the colours `letters` names (e.g. `BRYG`). */
export function stripesPng(letters: string, stripeWidth = 80, height = 160): Buffer {
  const colours = [...letters].map((letter) => STRIPE_COLOURS[letter as keyof typeof STRIPE_COLOURS]);
  return makePng(
    colours.length * stripeWidth,
    height,
    (x) => colours[Math.floor(x / stripeWidth)] ?? [0, 0, 0],
  );
}

/** Pastes an image into a ticket through the real owner route; returns its id and the markdown the web inserts. */
export async function uploadImage(
  f: Fixture,
  ticketId: string,
  bytes: Buffer,
  mimeType = 'image/png',
): Promise<{ id: string; markdown: string }> {
  const response = await f.server.app.inject({
    method: 'POST',
    url: `/v1/tickets/${ticketId}/attachments`,
    headers: f.owner.headers,
    payload: { filename: 'ảnh dán.png', mimeType, content: bytes.toString('base64') },
  });
  if (response.statusCode !== 201)
    throw new Error(`image upload failed: ${response.statusCode} ${response.body}`);
  const { id, url } = response.json() as { id: string; url: string };
  return { id, markdown: `![ảnh](${url})` };
}

/** The owner edits a ticket's description on the web (the real owner route). */
export async function ownerDescribes(f: Fixture, ticketId: string, description: string): Promise<void> {
  const response = await f.server.app.inject({
    method: 'PATCH',
    url: `/v1/tickets/${ticketId}`,
    headers: f.owner.headers,
    payload: { description },
  });
  if (response.statusCode !== 200)
    throw new Error(`description edit failed: ${response.statusCode} ${response.body}`);
}
