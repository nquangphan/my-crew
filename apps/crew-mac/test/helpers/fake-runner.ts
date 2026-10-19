import type { CommandRunner, RunOptions, RunResult } from '../../src/system.js';

export type FakeHandler = (args: readonly string[], options: RunOptions) => Partial<RunResult> | undefined;

export class FakeRunner implements CommandRunner {
  readonly calls: { command: string; args: string[]; options: RunOptions }[] = [];
  private readonly handlers = new Map<string, FakeHandler>();

  on(command: string, handler: FakeHandler): this {
    this.handlers.set(command, handler);
    return this;
  }

  async run(command: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
    this.calls.push({ command, args: [...args], options });
    const result = this.handlers.get(command)?.(args, options);
    if (!result)
      return { code: 127, stdout: '', stderr: `fake: không có handler cho ${command}`, timedOut: false };
    return { code: 0, stdout: '', stderr: '', timedOut: false, ...result };
  }

  commands(): string[] {
    return this.calls.map((call) => [call.command, ...call.args].join(' '));
  }
}
