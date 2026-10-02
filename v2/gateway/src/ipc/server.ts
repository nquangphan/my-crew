import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, unlink, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { GatewayStatus } from '../host/status.ts';

type Request = { method: string; route: string; token: string; nonce: string };
type Options = { root: string; getStatus: () => GatewayStatus; openUi?: () => Promise<string> };
type ClientState = {
  phase: 'reading' | 'dispatching' | 'terminal';
  deadline: NodeJS.Timeout;
  onData: (chunk: Buffer) => void;
};

const FRAME_MAX_BYTES = 8192;
const RPC_DEADLINE_MS = 1500;
const DRAIN_MS = 300;

export class GatewayRpcServer {
  private server: Server | null = null;
  private token = '';
  private recentNonces = new Set<string>();
  private readonly clients = new Map<Socket, ClientState>();
  private stopping = false;
  readonly socketPath: string;
  readonly tokenPath: string;
  private readonly options: Options;

  constructor(options: Options) {
    this.options = options;
    this.socketPath = join(options.root, 'host.sock');
    this.tokenPath = join(options.root, 'client-token');
  }

  async start(): Promise<void> {
    this.stopping = false;
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

  async stop(options: { drain: boolean } = { drain: true }): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.stopping = true;
    this.server = null;
    const closed = new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    for (const [socket, state] of this.clients) if (state.phase === 'reading') socket.destroy();
    if (options.drain && [...this.clients.values()].some((state) => state.phase === 'dispatching'))
      await delay(DRAIN_MS);
    for (const socket of this.clients.keys()) socket.destroy();
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        closed,
        new Promise<never>((_, reject) => {
          stopTimer = setTimeout(
            () => reject(new Error('RPC server stop deadline exceeded')),
            RPC_DEADLINE_MS,
          );
        }),
      ]);
    } finally {
      if (stopTimer) clearTimeout(stopTimer);
    }
    await unlink(this.socketPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await unlink(this.tokenPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  private handle(socket: Socket): void {
    if (this.stopping) {
      socket.destroy();
      return;
    }
    socket.on('error', () => {});
    let frame = '';
    let bytes = 0;
    const deadline = setTimeout(() => socket.destroy(), RPC_DEADLINE_MS);
    const onData = (chunk: Buffer) => {
      const state = this.clients.get(socket);
      if (state?.phase !== 'reading') return;
      bytes += chunk.length;
      if (bytes > FRAME_MAX_BYTES) {
        this.respond(socket, { ok: false, error: 'BAD_REQUEST' });
        return;
      }
      frame += chunk.toString('utf8');
      const end = frame.indexOf('\n');
      if (end === -1) return;
      state.phase = 'dispatching';
      socket.off('data', onData);
      let request: Request;
      try {
        request = JSON.parse(frame.slice(0, end));
      } catch {
        this.respond(socket, { ok: false, error: 'BAD_REQUEST' });
        return;
      }
      void this.dispatch(socket, request).catch(() =>
        this.respond(socket, { ok: false, error: 'INTERNAL_ERROR' }),
      );
    };
    this.clients.set(socket, { phase: 'reading', deadline, onData });
    socket.on('data', onData);
    socket.on('close', () => {
      clearTimeout(deadline);
      this.clients.delete(socket);
    });
  }

  private respond(socket: Socket, response: unknown): void {
    const state = this.clients.get(socket);
    if (!state || state.phase === 'terminal' || socket.destroyed) return;
    state.phase = 'terminal';
    socket.off('data', state.onData);
    socket.end(JSON.stringify(response), () => socket.destroy());
    setTimeout(() => socket.destroy(), 100);
  }

  private async dispatch(socket: Socket, request: Request): Promise<void> {
    const expected = Buffer.from(this.token);
    const actual = Buffer.from(typeof request?.token === 'string' ? request.token : '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      this.respond(socket, { ok: false, error: 'UNAUTHORIZED' });
      return;
    }
    if (
      typeof request.nonce !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(request.nonce) ||
      this.recentNonces.has(request.nonce)
    ) {
      this.respond(socket, { ok: false, error: 'BAD_NONCE' });
      return;
    }
    this.recentNonces.add(request.nonce);
    if (this.recentNonces.size > 1024) {
      const oldest = this.recentNonces.values().next();
      if (!oldest.done) this.recentNonces.delete(oldest.value);
    }
    if (request.method === 'GET' && request.route === 'status') {
      this.respond(socket, { ok: true, data: this.options.getStatus() });
      return;
    }
    if (request.method === 'POST' && request.route === 'open-ui') {
      if (!this.options.openUi) {
        this.respond(socket, { ok: false, error: 'NOT_CONFIGURED' });
        return;
      }
      try {
        const url = await this.options.openUi();
        this.respond(socket, { ok: true, data: { url } });
      } catch {
        this.respond(socket, { ok: false, error: 'NOT_CONFIGURED' });
      }
      return;
    }
    this.respond(socket, { ok: false, error: 'UNKNOWN_ROUTE' });
  }
}
