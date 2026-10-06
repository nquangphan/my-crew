import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setup } from '../src/commands/setup.js';
import { uninstall } from '../src/commands/uninstall.js';
import { macPaths, SPIKE_LABEL, SSHD_LABEL } from '../src/paths.js';
import { PATH_BLOCK_BODY, SPIKE_PATH_COMMENT } from '../src/zshenv.js';
import { fakeMac, PAPERCLIP_PUB } from './helpers/fake-mac.js';

const OWNER_KEY = 'ssh-ed25519 AAAAOwnerKey owner@macbook';

function seedSpike(home: string) {
  const paths = macPaths(home);
  mkdirSync(paths.spikeDir, { recursive: true });
  writeFileSync(join(paths.spikeDir, 'sshd_config'), 'Port 2222\n');
  mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(paths.spikePlist, '<plist/>\n');
  writeFileSync(paths.zshenv, `${SPIKE_PATH_COMMENT}\n${PATH_BLOCK_BODY}\n`);
  mkdirSync(join(home, '.ssh'), { recursive: true });
  writeFileSync(
    paths.authorizedKeys,
    `${OWNER_KEY}\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISpikeKey crew-v3-spike-paperclip\n`,
  );
}

describe('crew-mac uninstall', () => {
  it('gỡ phần spike rồi setup cài lại được (kịch bản AC-1)', async () => {
    const { home, ctx, loaded } = fakeMac({ spikeLoaded: true });
    seedSpike(home);
    const paths = macPaths(home);

    const first = await uninstall(ctx);
    expect(first.removed).toContain(`LaunchAgent ${SPIKE_LABEL}`);
    expect(loaded.has(SPIKE_LABEL)).toBe(false);
    expect(existsSync(paths.spikePlist)).toBe(false);
    expect(existsSync(paths.spikeDir)).toBe(false);
    expect(existsSync(paths.zshenv)).toBe(false);
    expect(readFileSync(paths.authorizedKeys, 'utf8')).toBe(`${OWNER_KEY}\n`);

    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    expect(loaded.has(SSHD_LABEL)).toBe(true);
  });

  it('gỡ đúng những gì setup cài, giữ nội dung của owner và thư mục worktree', async () => {
    const { home, ctx, loaded } = fakeMac();
    const paths = macPaths(home);
    writeFileSync(paths.zshenv, 'export EDITOR=vim\n');
    mkdirSync(join(home, '.ssh'), { recursive: true });
    writeFileSync(paths.authorizedKeys, `${OWNER_KEY}\n`);
    mkdirSync(join(home, '.crew'), { recursive: true });
    writeFileSync(join(home, '.crew', 'config.yaml'), 'apiUrl: x\n');
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });

    const report = await uninstall(ctx);

    expect(loaded.size).toBe(0);
    expect(existsSync(paths.sshdPlist)).toBe(false);
    expect(existsSync(paths.root)).toBe(false);
    expect(readFileSync(paths.zshenv, 'utf8')).toBe('export EDITOR=vim\n');
    expect(readFileSync(paths.authorizedKeys, 'utf8')).toBe(`${OWNER_KEY}\n`);
    expect(existsSync(join(home, 'crew-agents'))).toBe(true);
    expect(report.kept).toEqual([join(home, 'crew-agents')]);
    expect(existsSync(paths.wrapper)).toBe(false);
    expect(readFileSync(join(home, '.crew', 'config.yaml'), 'utf8')).toBe('apiUrl: x\n');
  });

  it('chạy lại khi đã gỡ hết thì không lỗi và không gỡ gì', async () => {
    const { ctx } = fakeMac();
    await setup(ctx, { paperclipKey: PAPERCLIP_PUB });
    await uninstall(ctx);
    expect(await uninstall(ctx)).toEqual({ removed: [], kept: [] });
  });
});
