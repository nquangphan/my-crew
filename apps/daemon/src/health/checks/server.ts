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
          'Máy chưa được ghép: chạy `crewd pair --code <mã>`.',
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
          `Token hết hạn sau ${days} ngày: chạy \`crewd rotate-token\`.`,
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
    return results;
  },
};
