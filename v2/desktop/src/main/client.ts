import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

export class GatewayClient {
  private readonly root: string;
  constructor(root = join(homedir(), 'Library', 'Application Support', '2PCrewV2', 'gateway')) {
    this.root = root;
  }

  async getStatus(): Promise<unknown> {
    return this.request('GET', 'status');
  }
  async openDashboard(): Promise<string> {
    const data = await this.request('POST', 'open-ui');
    if (typeof data !== 'object' || data === null || !('url' in data) || typeof data.url !== 'string')
      throw new Error('INVALID_HOST_RESPONSE');
    return data.url;
  }

  private async request(method: 'GET' | 'POST', route: string): Promise<unknown> {
    const directory = await lstat(this.root);
    if (
      !directory.isDirectory() ||
      directory.isSymbolicLink() ||
      directory.uid !== process.getuid?.() ||
      (directory.mode & 0o077) !== 0
    )
      throw new Error('UNTRUSTED_HOST_DIRECTORY');
    const tokenPath = join(this.root, 'client-token');
    const tokenFile = await lstat(tokenPath);
    if (
      !tokenFile.isFile() ||
      tokenFile.isSymbolicLink() ||
      tokenFile.uid !== process.getuid?.() ||
      (tokenFile.mode & 0o077) !== 0
    )
      throw new Error('UNTRUSTED_HOST_TOKEN');
    const token = (await readFile(tokenPath, 'utf8')).trim();
    const socketPath = join(this.root, 'host.sock');
    const socketFile = await lstat(socketPath);
    if (
      !socketFile.isSocket() ||
      socketFile.isSymbolicLink() ||
      socketFile.uid !== process.getuid?.() ||
      (socketFile.mode & 0o077) !== 0
    )
      throw new Error('UNTRUSTED_HOST_SOCKET');
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath);
      socket.setTimeout(1500, () => socket.destroy(new Error('HOST_TIMEOUT')));
      let reply = '';
      socket.on('connect', () =>
        socket.write(`${JSON.stringify({ method, route, token, nonce: randomUUID() })}\n`),
      );
      socket.on('data', (chunk) => {
        reply += chunk;
        if (reply.length > 65536) socket.destroy(new Error('HOST_RESPONSE_TOO_LARGE'));
      });
      socket.on('end', () => {
        try {
          const parsed = JSON.parse(reply);
          parsed.ok ? resolve(parsed.data) : reject(new Error(parsed.error));
        } catch (error) {
          reject(error);
        }
      });
      socket.on('error', reject);
    });
  }
}
