import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, unlink, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import type { GatewayStatus } from '../host/status.ts';

type Request = { method: string; route: string; token: string; nonce: string };
type Options = { root: string; getStatus: () => GatewayStatus; openUi?: () => Promise<string> };

export class GatewayRpcServer {
  private server: Server | null = null;
  private token = '';
  private recentNonces = new Set<string>();
  readonly socketPath: string;
  readonly tokenPath: string;
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
    this.socketPath = join(options.root, 'host.sock');
    this.tokenPath = join(options.root, 'client-token');
  }

  async start(): Promise<void> {
    this.token = randomBytes(32).toString('hex');
    await writeFile(this.tokenPath, `${this.token}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(this.tokenPath, 0o600);
    const server = createServer((socket) => this.handle(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    await chmod(this.socketPath, 0o600);
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await unlink(this.socketPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await unlink(this.tokenPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  private handle(socket: Socket): void {
    socket.setTimeout(1500, () => socket.destroy());
    let frame = '';
    socket.on('data', (chunk) => {
      frame += chunk.toString();
      if (frame.length > 8192) {
        socket.end(JSON.stringify({ ok: false, error: 'BAD_REQUEST' }));
        return;
      }
      const end = frame.indexOf('\n');
      if (end === -1) return;
      socket.removeAllListeners('data');
      let request: Request;
      try {
        request = JSON.parse(frame.slice(0, end));
      } catch {
        socket.end(JSON.stringify({ ok: false, error: 'BAD_REQUEST' }));
        return;
      }
      void this.dispatch(socket, request);
    });
  }

  private async dispatch(socket: Socket, request: Request): Promise<void> {
    const expected = Buffer.from(this.token);
    const actual = Buffer.from(typeof request?.token === 'string' ? request.token : '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      socket.end(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }));
      return;
    }
    if (
      typeof request.nonce !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(request.nonce) ||
      this.recentNonces.has(request.nonce)
    ) {
      socket.end(JSON.stringify({ ok: false, error: 'BAD_NONCE' }));
      return;
    }
    this.recentNonces.add(request.nonce);
    if (this.recentNonces.size > 1024) {
      const oldest = this.recentNonces.values().next();
      if (!oldest.done) this.recentNonces.delete(oldest.value);
    }
    if (request.method === 'GET' && request.route === 'status') {
      socket.end(JSON.stringify({ ok: true, data: this.options.getStatus() }));
      return;
    }
    if (request.method === 'POST' && request.route === 'open-ui') {
      if (!this.options.openUi) {
        socket.end(JSON.stringify({ ok: false, error: 'NOT_CONFIGURED' }));
        return;
      }
      try {
        const url = await this.options.openUi();
        socket.end(JSON.stringify({ ok: true, data: { url } }));
      } catch {
        socket.end(JSON.stringify({ ok: false, error: 'NOT_CONFIGURED' }));
      }
      return;
    }
    socket.end(JSON.stringify({ ok: false, error: 'UNKNOWN_ROUTE' }));
  }
}
