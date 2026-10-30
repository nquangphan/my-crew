import { type MacContext, UsageError } from '../context.js';
import { findTmux } from '../tmux.js';

/** Khóa dự án trong tên phiên; cùng luật với phía server. */
export const TERM_KEY_RE = /^[a-z][a-z0-9-]{1,30}$/;

/** Gắn vào phiên tmux của terminal web khi ngồi ở Mac: `tmux -L crew attach -t crew-owner-<key>`. */
export async function term(ctx: MacContext, key: string): Promise<number> {
  if (!TERM_KEY_RE.test(key)) throw new UsageError(`key dự án không hợp lệ: ${key}`);
  const tmux = await findTmux(ctx);
  if (!tmux) throw new Error('Không thấy tmux. Chạy "crew-mac setup" hoặc tự cài tmux.');
  const session = `crew-owner-${key}`;
  const has = await ctx.runner.run(tmux, ['-L', 'crew', 'has-session', '-t', session], { timeoutMs: 10_000 });
  if (has.code !== 0) {
    ctx.out(`Chưa có phiên terminal của ${key}. Mở terminal dự án trên web Crew trước.`);
    return 1;
  }
  const attach = await ctx.runner.run(tmux, ['-L', 'crew', 'attach', '-t', session], { stdio: 'inherit' });
  return attach.code;
}
