import { type HealthCheck, type HealthCheckResult, result } from '../types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const serverChecks: HealthCheck = {
  id: 'server',
  group: 'server',
  async run(ctx) {
    const results: HealthCheckResult[] = [];
    if (!ctx.config || !ctx.vps) {
      return [
        result(
          'server.config',
          'server',
          'Cấu hình',
          'red',
          'Chưa có ~/.crew/config.yaml: chạy `crewd pair --code <mã>`.',
        ),
      ];
    }
    try {
      await ctx.vps.health();
      results.push(result('server.reachable', 'server', 'Kết nối VPS', 'green', ctx.config.apiUrl));
    } catch (error) {
      results.push(
        result(
          'server.reachable',
          'server',
          'Kết nối VPS',
          'red',
          `Không kết nối được ${ctx.config.apiUrl}: ${(error as Error).message}`,
        ),
      );
      return results;
    }
    if (!ctx.tokenStore.get()) {
      results.push(
        result(
          'server.token',
          'server',
          'Token máy',
          'red',
          'Máy chưa được ghép: chạy `crewd pair --code <mã>` hoặc ghép lại trong app.',
          { id: 'repair', label: 'Ghép lại máy' },
        ),
      );
      return results;
    }
    try {
      await ctx.vps.listProjects();
    } catch (error) {
      results.push(
        result(
          'server.token',
          'server',
          'Token máy',
          'red',
          `Token bị từ chối (${(error as Error).message}): ghép lại máy.`,
          { id: 'repair', label: 'Ghép lại máy' },
        ),
      );
      return results;
    }
    const expiresAt = ctx.state?.getMeta('tokenExpiresAt');
    const days = expiresAt ? Math.floor((Date.parse(expiresAt) - Date.now()) / DAY_MS) : null;
    if (days !== null && days < 14) {
      results.push(
        result(
          'server.token',
          'server',
          'Token máy',
          'yellow',
          `Token hết hạn sau ${days} ngày: đổi token (\`crewd rotate-token\`).`,
          { id: 'rotate-token', label: 'Đổi token' },
        ),
      );
    } else {
      results.push(
        result(
          'server.token',
          'server',
          'Token máy',
          'green',
          days === null ? 'Token hợp lệ.' : `Token hợp lệ, còn ${days} ngày.`,
        ),
      );
    }
    if (ctx.daemon) {
      const status = ctx.daemon.status();
      const last = status.lastEventAt ? `, sự kiện cuối lúc ${formatTime(status.lastEventAt)}` : '';
      results.push(
        status.connected
          ? result('server.stream', 'server', 'Luồng sự kiện (SSE)', 'green', `Đã kết nối${last}.`)
          : result(
              'server.stream',
              'server',
              'Luồng sự kiện (SSE)',
              status.running ? 'red' : 'yellow',
              status.running ? `Mất kết nối luồng sự kiện${last}.` : 'Daemon chưa chạy.',
              { id: 'reconnect', label: 'Kết nối lại' },
            ),
      );
    }
    return results;
  },
  async fix(ctx, fixId) {
    if (fixId === 'rotate-token' && ctx.vps) {
      const rotated = await ctx.vps.rotateToken();
      ctx.tokenStore.set(rotated.token);
      ctx.state?.setMeta('tokenExpiresAt', rotated.expiresAt);
    } else if (fixId === 'reconnect' && ctx.daemon) {
      await ctx.daemon.stream.stop();
      ctx.daemon.stream.start();
      // Give the stream a moment to connect before the re-check.
      for (let i = 0; i < 50 && !ctx.daemon.stream.connected; i++)
        await new Promise((r) => setTimeout(r, 100));
    }
  },
};

/** `HH:mm dd/MM` in the owner's time zone. */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}
