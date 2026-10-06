import type { CommandRunner } from './system.js';

export interface MacContext {
  home: string;
  user: string;
  uid: number;
  platform: NodeJS.Platform;
  runner: CommandRunner;
  now: () => Date;
  out: (line: string) => void;
  /** Node cho LaunchAgent reaper; ưu tiên symlink ổn định của Homebrew. */
  nodePath: string;
  /** Đường dẫn thật của cli.js đã build, dùng trong plist reaper. */
  cliPath: string;
}

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}
