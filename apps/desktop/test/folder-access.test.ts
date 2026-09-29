import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { awaitFolderAccess } from '../src/daemon-host/folder-access.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('awaitFolderAccess (a pending macOS folder-permission prompt)', () => {
  it('waits for a slow folder without blocking the event loop, logs the wait and reads one folder at a time', async () => {
    const events: string[] = [];
    let ticks = 0;
    const ticker = setInterval(() => ticks++, 5);
    await awaitFolderAccess(['/slow', '/fast'], {
      waitingAfterMs: 20,
      read: async (path) => {
        events.push(`read ${path}`);
        if (path === '/slow') await sleep(120);
      },
      onWaiting: (path) => events.push(`waiting ${path}`),
      onResolved: (path, ms, error) => events.push(`resolved ${path} ${ms >= 100} ${error}`),
    });
    clearInterval(ticker);
    expect(events).toEqual(['read /slow', 'waiting /slow', 'resolved /slow true null', 'read /fast']);
    expect(ticks).toBeGreaterThan(5);
  });

  it('reports a refused folder by its error code and a readable one silently', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crew-folder-access-'));
    const events: string[] = [];
    try {
      await awaitFolderAccess([dir, join(dir, 'missing')], {
        waitingAfterMs: 0,
        read: async (path) => {
          await sleep(10);
          if (path.endsWith('missing')) throw Object.assign(new Error('denied'), { code: 'EPERM' });
        },
        onWaiting: () => undefined,
        onResolved: (path, _ms, error) => events.push(`${path === dir ? 'dir' : 'missing'} ${error}`),
      });
      expect(events).toEqual(['dir null', 'missing EPERM']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
