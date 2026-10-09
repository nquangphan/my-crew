import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeError, createBridgeClient } from '../../src/files/bridge.js';

const ENV = { PAPERCLIP_API_URL: 'http://127.0.0.1:3100/', PAPERCLIP_API_KEY: 'tok-bridge' };
const LEAK = 'MÃ-KIỂM-RÒ-RỈ';

interface Seen {
  url: string;
  auth: string | null;
}

function fakeFetch(handler: (url: string) => Response | Promise<Response>, seen: Seen[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
    return handler(url);
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.useRealTimers());

describe('createBridgeClient', () => {
  it('mọi request có Bearer, URL ghép không thừa dấu /, comments theo order=asc', async () => {
    const seen: Seen[] = [];
    const bridge = createBridgeClient(
      ENV,
      fakeFetch(
        (url) => (url.includes('/comments') || url.endsWith('/attachments') ? json([]) : json({})),
        seen,
      ),
    );
    await bridge.issue('i1');
    await bridge.heartbeatContext('i1');
    await bridge.comments('i1');
    await bridge.attachments('i1');
    expect(seen.map((s) => s.url)).toEqual([
      'http://127.0.0.1:3100/api/issues/i1',
      'http://127.0.0.1:3100/api/issues/i1/heartbeat-context',
      'http://127.0.0.1:3100/api/issues/i1/comments?order=asc',
      'http://127.0.0.1:3100/api/issues/i1/attachments',
    ]);
    expect(seen.every((s) => s.auth === 'Bearer tok-bridge')).toBe(true);
  });

  it('500 kèm thân có chuỗi mốc → BridgeError http, message không chứa chuỗi mốc', async () => {
    const bridge = createBridgeClient(
      ENV,
      fakeFetch(() => new Response(LEAK, { status: 500 })),
    );
    const error = await bridge.issue('i1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BridgeError);
    expect((error as BridgeError).code).toBe('http');
    expect((error as BridgeError).status).toBe(500);
    expect(String((error as BridgeError).message)).not.toContain(LEAK);
  });

  it('JSON sai dạng → BridgeError, không lộ thân', async () => {
    const bridge = createBridgeClient(
      ENV,
      fakeFetch(() => new Response(`${LEAK} không phải JSON`)),
    );
    const error = await bridge.issue('i1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BridgeError);
    expect(String((error as BridgeError).message)).not.toContain(LEAK);
  });

  it('danh sách mà server trả không phải mảng → BridgeError', async () => {
    const bridge = createBridgeClient(
      ENV,
      fakeFetch(() => json({ oops: 1 })),
    );
    await expect(bridge.attachments('i1')).rejects.toBeInstanceOf(BridgeError);
  });

  it('fetch không trả lời → timeout', async () => {
    vi.useFakeTimers();
    const hang = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as typeof fetch;
    const bridge = createBridgeClient(ENV, hang);
    const pending = bridge.issue('i1').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(120_000);
    const error = (await pending) as BridgeError;
    expect(error).toBeInstanceOf(BridgeError);
    expect(error.code).toBe('timeout');
  });

  it('lỗi mạng → BridgeError network', async () => {
    const bridge = createBridgeClient(ENV, (async () => {
      throw new TypeError(`fetch failed ${LEAK}`);
    }) as typeof fetch);
    const error = (await bridge.issue('i1').catch((e: unknown) => e)) as BridgeError;
    expect(error.code).toBe('network');
    expect(error.message).not.toContain(LEAK);
  });

  it('content trả luồng byte và gọi đúng đường dẫn', async () => {
    const seen: Seen[] = [];
    const bridge = createBridgeClient(
      ENV,
      fakeFetch(() => new Response(new Uint8Array([1, 2, 3])), seen),
    );
    const chunks: Uint8Array[] = [];
    for await (const c of await bridge.content('att-1', 100)) chunks.push(c);
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]));
    expect(seen[0]?.url).toBe('http://127.0.0.1:3100/api/attachments/att-1/content');
  });

  it('content 404 → BridgeError http 404 ngay khi gọi', async () => {
    const bridge = createBridgeClient(
      ENV,
      fakeFetch(() => new Response(LEAK, { status: 404 })),
    );
    const error = (await bridge.content('att-1', 100).catch((e: unknown) => e)) as BridgeError;
    expect(error.code).toBe('http');
    expect(error.status).toBe(404);
    expect(error.message).not.toContain(LEAK);
  });

  it('content vượt maxBytes khi stream → too_large', async () => {
    const big = new Uint8Array(50);
    const bridge = createBridgeClient(
      ENV,
      fakeFetch(() => new Response(big)),
    );
    const iterable = await bridge.content('att-1', 10);
    const error = await (async () => {
      try {
        for await (const _ of iterable);
        return null;
      } catch (e) {
        return e as BridgeError;
      }
    })();
    expect(error).toBeInstanceOf(BridgeError);
    expect(error?.code).toBe('too_large');
  });

  it('content có Content-Length vượt maxBytes → too_large trước khi đọc thân', async () => {
    const bridge = createBridgeClient(
      ENV,
      fakeFetch(() => new Response(new Uint8Array(5), { headers: { 'content-length': '999' } })),
    );
    const error = (await bridge.content('att-1', 10).catch((e: unknown) => e)) as BridgeError;
    expect(error.code).toBe('too_large');
  });
});
