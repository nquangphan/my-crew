import type { CommandRunner } from '@crew/mac';

type Reply = { code?: number; stdout?: string; stderr?: string } | ((args: readonly string[]) => unknown);

/** Runner giả: khóa là `lệnh arg1 arg2 ...`; lệnh lạ trả mã 127. Ghi lại mọi lời gọi. */
export function fakeRunner(replies: Record<string, Reply>): CommandRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(command, args) {
      const key = [command, ...args].join(' ');
      calls.push(key);
      const reply = replies[key];
      if (reply === undefined) return { code: 127, stdout: '', stderr: 'not found', timedOut: false };
      const value = typeof reply === 'function' ? (reply(args) as object) : reply;
      return { code: 0, stdout: '', stderr: '', timedOut: false, ...value };
    },
  };
}
