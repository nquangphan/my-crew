import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { Duplex } from 'node:stream';
import { hash } from '../journal/atomic-records.ts';
export interface SecurityBridge {
  put(service: string, account: string, value: Buffer): Promise<void>;
  read(service: string, account: string): Promise<Buffer | null>;
  remove(service: string, account: string): Promise<void>;
}
export type SecurityHelper = {
  path: string;
  sha256: string;
  signedAclVerified?: (input: { pid: number; sha256: string }) => Promise<boolean>;
};
/** Signed packaging/ACL proof is supplied only by trusted phase09 composition. */
export class SecurityFrameworkBridge implements SecurityBridge {
  private readonly helper: SecurityHelper;
  constructor(helper: SecurityHelper) {
    this.helper = helper;
  }
  private async exchange(
    op: number,
    service: string,
    account: string,
    value: Buffer = Buffer.alloc(0),
  ): Promise<Buffer | null> {
    if (
      !/^com\.2pcrew\.v2\.[A-Za-z0-9.-]{1,200}$/.test(service) ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(account) ||
      value.length > 8192
    )
      throw new Error('SECURITY_SCOPE_INVALID');
    let fd: Awaited<ReturnType<typeof open>> | undefined;
    try {
      if (
        process.platform !== 'darwin' ||
        !this.helper.path.startsWith('/') ||
        !this.helper.signedAclVerified
      )
        throw new Error();
      fd = await open(this.helper.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await fd.stat();
      if (
        !stat.isFile() ||
        stat.uid !== process.getuid?.() ||
        stat.nlink !== 1 ||
        (stat.mode & 0o077) !== 0 ||
        !(stat.mode & 0o100) ||
        stat.size > 4 * 1024 * 1024 ||
        hash(await fd.readFile()) !== this.helper.sha256
      )
        throw new Error();
    } catch {
      await fd?.close();
      throw new Error('SECURITY_BRIDGE_UNVERIFIED');
    }
    const s = Buffer.from(service),
      a = Buffer.from(account),
      frame = Buffer.alloc(16 + s.length + a.length + value.length);
    frame.writeUInt32BE(op, 0);
    frame.writeUInt32BE(s.length, 4);
    frame.writeUInt32BE(a.length, 8);
    frame.writeUInt32BE(value.length, 12);
    s.copy(frame, 16);
    a.copy(frame, 16 + s.length);
    value.copy(frame, 16 + s.length + a.length);
    try {
      return await new Promise<Buffer | null>((resolve, reject) => {
        const child = spawn(this.helper.path, [], { env: {}, stdio: ['ignore', 'ignore', 'ignore', 'pipe'] }),
          channel = child.stdio[3] as Duplex;
        const chunks: Buffer[] = [];
        let size = 0,
          settled = false;
        const finish = (error: boolean, result: Buffer | null = null) => {
          if (settled) {
            result?.fill(0);
            return;
          }
          settled = true;
          clearTimeout(timer);
          channel.destroy();
          child.kill();
          for (const chunk of chunks) chunk.fill(0);
          if (error) reject(new Error('SECURITY_BRIDGE_FAILED'));
          else resolve(result);
        };
        const timer = setTimeout(() => finish(true), 3000);
        channel.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 8200) finish(true);
          else chunks.push(chunk);
        });
        channel.on('error', () => finish(true));
        child.on('error', () => finish(true));
        child.on('close', (code) => {
          if (code !== 0 || size < 8) return finish(true);
          const reply = Buffer.concat(chunks);
          try {
            const status = reply.readInt32BE(0),
              len = reply.readUInt32BE(4);
            if (len !== reply.length - 8 || len > 8192) return finish(true);
            if (status === 1 && len === 0) return finish(false, null);
            if (status !== 0) return finish(true);
            finish(false, Buffer.from(reply.subarray(8)));
          } finally {
            reply.fill(0);
          }
        });
        // Verify the loaded dormant helper's signing identity/ACL before releasing any request bytes.
        if (!child.pid) finish(true);
        else
          this.helper.signedAclVerified?.({ pid: child.pid, sha256: this.helper.sha256 }).then(
            (verified) => {
              if (settled) return;
              if (!verified) finish(true);
              else channel.end(frame);
            },
            () => finish(true),
          );
      });
    } finally {
      frame.fill(0);
      await fd?.close();
    }
  }
  async put(service: string, account: string, value: Buffer): Promise<void> {
    const bytes = await this.exchange(1, service, account, value);
    bytes?.fill(0);
  }
  read(service: string, account: string): Promise<Buffer | null> {
    return this.exchange(2, service, account);
  }
  async remove(service: string, account: string): Promise<void> {
    const bytes = await this.exchange(3, service, account);
    bytes?.fill(0);
  }
}
