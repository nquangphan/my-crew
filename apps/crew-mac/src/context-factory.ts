import { homedir, userInfo } from 'node:os';
import type { MacContext } from './context.js';
import { stableNodePath } from './node-runtime.js';
import { createRunner } from './system.js';
import { BMAD_PIN } from './workflows/bmad-pin.js';
import { SUPERPOWERS_PIN } from './workflows/pin.js';

/**
 * `nodePath` thiếu thì dò đồng bộ bằng `stableNodePath`: dưới Electron (app 2P Crew) không có node dùng được thì ném,
 * không bao giờ ghi binary của app vào launcher/plist.
 */
export function createMacContext(input: {
  env: NodeJS.ProcessEnv;
  out: (line: string) => void;
  cliPath: string;
  nodePath?: string;
}): MacContext {
  const home = input.env.HOME ?? homedir();
  return {
    home,
    user: userInfo().username,
    uid: process.getuid?.() ?? 0,
    platform: process.platform,
    runner: createRunner(),
    now: () => new Date(),
    out: input.out,
    nodePath: input.nodePath ?? stableNodePath({ home }),
    cliPath: input.cliPath,
    superpowersPin: SUPERPOWERS_PIN,
    bmadPin: BMAD_PIN,
  };
}
