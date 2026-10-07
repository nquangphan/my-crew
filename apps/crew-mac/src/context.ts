import type { CommandRunner } from './system.js';
import type { WorkflowPin } from './workflows/pin.js';

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
  /** Bản Superpowers ghim cho agent; CLI luôn dùng `SUPERPOWERS_PIN`, test thay bằng cây giả. */
  superpowersPin: WorkflowPin;
}

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}
