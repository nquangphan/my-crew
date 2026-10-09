import { existsSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import type { MacContext } from './context.js';
import { createRunner } from './system.js';
import { SUPERPOWERS_PIN } from './workflows/pin.js';

export function stableNodePath(): string {
  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    if (existsSync(candidate)) return candidate;
  }
  return process.execPath;
}

export function createMacContext(input: {
  env: NodeJS.ProcessEnv;
  out: (line: string) => void;
  cliPath: string;
  nodePath?: string;
}): MacContext {
  return {
    home: input.env.HOME ?? homedir(),
    user: userInfo().username,
    uid: process.getuid?.() ?? 0,
    platform: process.platform,
    runner: createRunner(),
    now: () => new Date(),
    out: input.out,
    nodePath: input.nodePath ?? stableNodePath(),
    cliPath: input.cliPath,
    superpowersPin: SUPERPOWERS_PIN,
  };
}
