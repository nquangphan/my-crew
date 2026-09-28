import { SYSTEMD_UNIT_NAME } from '../../service/systemd.js';
import { type HealthCheck, result } from '../types.js';

/**
 * The daemon must run in the owner's user session so the SDK can read the Claude login (the login
 * Keychain on macOS). On macOS the desktop app's login item starts it; on Linux a systemd user unit.
 */
export const serviceChecks: HealthCheck = {
  id: 'app',
  group: 'app',
  async run(ctx) {
    if (ctx.platform === 'darwin') {
      const manager = ctx.exec('launchctl', ['managername']);
      const name = manager.stdout.trim();
      return [
        manager.code === 0 && (name === 'Aqua' || name === 'Background')
          ? result(
              'app.session',
              'app',
              'Phiên người dùng',
              'green',
              `Chạy trong phiên ${name} của người dùng (đọc được Keychain đăng nhập).`,
            )
          : result(
              'app.session',
              'app',
              'Phiên người dùng',
              'yellow',
              `Không chạy trong phiên người dùng (${name || 'không rõ'}): Keychain đăng nhập có thể không đọc được. Trên macOS hãy chạy daemon qua app 2P Crew.`,
            ),
      ];
    }
    if (ctx.platform === 'linux') {
      const enabled = ctx.exec('systemctl', ['--user', 'is-enabled', SYSTEMD_UNIT_NAME]);
      return [
        enabled.code === 0
          ? result('app.service', 'app', 'Dịch vụ systemd', 'green', `${SYSTEMD_UNIT_NAME} (user) đã bật.`)
          : result(
              'app.service',
              'app',
              'Dịch vụ systemd',
              'yellow',
              `${SYSTEMD_UNIT_NAME} chưa được cài: chạy \`crewd install-service\`.`,
            ),
      ];
    }
    return [
      result(
        'app.service',
        'app',
        'Dịch vụ',
        'yellow',
        `Nền tảng ${ctx.platform} chưa được hỗ trợ chính thức.`,
      ),
    ];
  },
};
