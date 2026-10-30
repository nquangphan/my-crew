import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setup } from '../src/commands/setup.js';
import { macPaths } from '../src/paths.js';
import { checkTmux, ensureTmux, findTmux, TMUX_CONF, TMUX_NO_BREW_HINT, tmuxConfPath } from '../src/tmux.js';
import { fakeMac, PAPERCLIP_PUB } from './helpers/fake-mac.js';

const TMUX = '/opt/homebrew/bin/tmux';
const BREW = '/opt/homebrew/bin/brew';

describe('tmux', () => {
  it('TMUX_CONF có đủ cấu hình cho Claude Code', () => {
    expect(TMUX_CONF).toBe(`set -g extended-keys on
set -as terminal-features 'xterm*:extkeys'
set -g escape-time 0
set -g mouse on
set -g default-terminal "tmux-256color"
set -as terminal-overrides ',xterm*:Tc'
set -g history-limit 10000
set -g window-size latest
set -g focus-events on
`);
  });

  it('findTmux thử Homebrew, rồi command -v', async () => {
    const mac = fakeMac();
    expect(await findTmux(mac.ctx)).toBeNull();
    mac.runner.on('/bin/sh', () => ({ stdout: '/usr/bin/tmux\n' }));
    expect(await findTmux(mac.ctx)).toBe('/usr/bin/tmux');
    mac.runner.on(TMUX, () => ({ stdout: 'tmux 3.5a\n' }));
    expect(await findTmux(mac.ctx)).toBe(TMUX);
  });

  it('ensureTmux: thiếu tmux mà có brew thì brew install tmux', async () => {
    const mac = fakeMac();
    let installed = false;
    mac.runner
      .on(BREW, (args) => {
        if (args[0] === 'install') installed = true;
        return {};
      })
      .on(TMUX, () => (installed ? {} : { code: 127 }));
    const result = await ensureTmux(mac.ctx);
    expect(result).toEqual({ path: TMUX, installed: true });
    expect(mac.runner.commands()).toContain(`${BREW} install tmux`);
    expect(mac.runner.calls.find((c) => c.args[0] === 'install')?.options.timeoutMs).toBe(600_000);
  });

  it('ensureTmux: không có brew thì không gọi brew, trả hint', async () => {
    const mac = fakeMac();
    const result = await ensureTmux(mac.ctx);
    expect(result).toEqual({ path: null, installed: false, hint: TMUX_NO_BREW_HINT });
    expect(mac.runner.commands().some((c) => c.includes('install'))).toBe(false);
  });

  it('setup ghi tmux.conf và cài tmux khi thiếu', async () => {
    const mac = fakeMac();
    let installed = false;
    mac.runner
      .on(BREW, (args) => {
        if (args[0] === 'install') installed = true;
        return {};
      })
      .on(TMUX, () => (installed ? {} : { code: 127 }));
    const report = await setup(mac.ctx, { paperclipKey: PAPERCLIP_PUB });
    expect(report.tmux).toEqual({ path: TMUX, installed: true });
    expect(readFileSync(tmuxConfPath(mac.home), 'utf8')).toBe(TMUX_CONF);
    expect(report.changed).toContain(tmuxConfPath(mac.home));
    const again = await setup(mac.ctx, { paperclipKey: PAPERCLIP_PUB });
    expect(again.changed).not.toContain(tmuxConfPath(mac.home));
  });

  it('setup không có brew: không gọi brew, trả hint, vẫn ghi tmux.conf', async () => {
    const mac = fakeMac();
    const report = await setup(mac.ctx, { paperclipKey: PAPERCLIP_PUB });
    expect(report.tmux).toEqual({ path: null, installed: false, hint: TMUX_NO_BREW_HINT });
    expect(mac.runner.commands().some((c) => c.includes('install tmux'))).toBe(false);
    expect(readFileSync(tmuxConfPath(mac.home), 'utf8')).toBe(TMUX_CONF);
  });

  it('checkTmux: ok / warn / fail', async () => {
    const mac = fakeMac();
    const paths = macPaths(mac.home);
    expect((await checkTmux(mac.ctx, paths)).status).toBe('fail');
    mac.runner.on(TMUX, () => ({}));
    const missing = await checkTmux(mac.ctx, paths);
    expect(missing).toMatchObject({ id: 'tmux', status: 'warn', hint: 'crew-mac setup' });
    mkdirSync(dirname(tmuxConfPath(mac.home)), { recursive: true });
    writeFileSync(tmuxConfPath(mac.home), 'set -g mouse off\n');
    expect((await checkTmux(mac.ctx, paths)).status).toBe('warn');
    writeFileSync(tmuxConfPath(mac.home), TMUX_CONF);
    expect((await checkTmux(mac.ctx, paths)).status).toBe('ok');
  });
});
