import type { HttpOperationJournal, HttpTransport } from '../journal/http-operations.ts';
export class GatewayHttpError extends Error {
  readonly status: number;
  constructor(status: number, body: unknown) {
    super((body as { error?: { code?: string } })?.error?.code ?? `HTTP_${status}`);
    this.status = status;
  }
}
export async function mutate<T>(
  http: HttpOperationJournal,
  operationId: string,
  route: string,
  phase: string,
  body: unknown,
): Promise<T> {
  await http.prepare({ operationId, method: 'POST', route, phase, canonicalBody: body });
  const response = await http.retryTransient(operationId);
  if (response.status < 200 || response.status >= 300)
    throw new GatewayHttpError(response.status, response.body);
  return response.body as T;
}
/** Bearer lives only in transport closure, never durable request bodies. */
export function machineTransport(baseUrl: string, bearer: string, transport: typeof fetch = fetch) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === '127.0.0.1'))
    throw new Error('UNSAFE_SERVER_URL');
  const request = async (route: string, method: string, body?: unknown, key?: string) => {
    if (!route.startsWith('/v2/') || route.includes('..') || route.startsWith('//'))
      throw new Error('UNSAFE_SERVER_ROUTE');
    const response = await transport(new URL(route, base), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: {
        authorization: `Bearer ${bearer}`,
        ...(key ? { 'idempotency-key': key } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const write: HttpTransport = (req) => request(req.route, req.method, req.canonicalBody, req.idempotencyKey);
  async function* stream(after: string, signal: AbortSignal) {
    if (!/^(0|[1-9][0-9]*)$/.test(after)) throw new Error('INVALID_EVENT_CURSOR');
    const response = await transport(new URL(`/v2/events/stream?after=${after}`, base), {
      redirect: 'error',
      signal,
      headers: { authorization: `Bearer ${bearer}`, accept: 'text/event-stream' },
    });
    if (response.status !== 200 || !response.body) throw new GatewayHttpError(response.status, {});
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        if (buffer.length > 65536) throw new Error('EVENT_FRAME_TOO_LARGE');
        for (;;) {
          const boundary = buffer.indexOf('\n\n');
          if (boundary < 0) break;
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const id = /^id: ?([0-9]+)$/m.exec(frame)?.[1];
          if (id) yield id;
        }
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
  return {
    write,
    stream,
    read: async (route: string) => {
      const r = await request(route, 'GET');
      if (r.status !== 200) throw new GatewayHttpError(r.status, r.body);
      return r.body;
    },
  };
}
