import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Một request server giả nhận được (body đã parse JSON nếu có). */
export interface SeenRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  authorization: string | null;
  body: unknown;
}

export type FakeReply = { status: number; body?: unknown; delayMs?: number };
export type FakeHandler = (req: SeenRequest) => FakeReply;

/** Paperclip giả trên `http://127.0.0.1:<cổng ngẫu nhiên>`: ghi lại mọi request, trả theo `handler`. */
export async function startFakePaperclip(handler: FakeHandler) {
  const requests: SeenRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const text = Buffer.concat(chunks).toString('utf8');
      const seen: SeenRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        authorization: req.headers.authorization ?? null,
        body: text ? JSON.parse(text) : undefined,
      };
      requests.push(seen);
      const reply = handler(seen);
      const send = () => {
        if (res.destroyed) return;
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(reply.body === undefined ? '' : JSON.stringify(reply.body));
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
