import { SYSTEMD_UNIT_NAME } from '../../service/systemd.js';
import { type HealthCheck, type HealthCheckResult, type HealthContext, result } from '../types.js';

/** The desktop app's own checks: the daemon process, start at login and the app version. */
function desktopChecks(ctx: HealthContext): HealthCheckResult[] {
  const app = ctx.app;
  if (!app) return [];
  const running = ctx.daemon?.status().running ?? false;
  const update = app.update;
  const results = [
    running
      ? result('app.daemon', 'app', 'Daemon', 'green', `Daemon đang chạy (pid ${process.pid}).`)
      : result('app.daemon', 'app', 'Daemon', 'red', 'Daemon không chạy: máy này không nhận việc.', {
          id: 'restart-daemon',
          label: 'Khởi động lại daemon',
        }),
    app.loginItem
      ? result('app.login-item', 'app', 'Mở cùng máy', 'green', 'App tự chạy khi đăng nhập macOS.')
      : result(
          'app.login-item',
          'app',
          'Mở cùng máy',
          'yellow',
          'App chưa tự chạy khi đăng nhập: sau khi khởi động lại máy sẽ không nhận việc.',
          { id: 'enable-login-item', label: 'Bật mở cùng máy' },
        ),
  ];
  if (update.state === 'available' || update.state === 'downloaded') {
    results.push(
      result(
        'app.version',
        'app',
        'Phiên bản app',
        'yellow',
        `Đang dùng ${app.version}, có bản mới ${update.version ?? ''}${update.canAutoInstall ? '' : ' (bản chưa ký: tải về và cài thủ công)'}.`,
        { id: 'install-update', label: update.canAutoInstall ? 'Cài bản mới' : 'Tải bản mới' },
      ),
    );
  } else if (update.state === 'error') {
    results.push(
      result(
        'app.version',
        'app',
        'Phiên bản app',
        'yellow',
        `Đang dùng ${app.version}; không kiểm tra được bản mới: ${update.message ?? 'lỗi không rõ'}.`,
      ),
    );
  } else {
    const note =
      update.state === 'disabled' ? ' (bản chạy thử: không kiểm tra cập nhật)' : ', đã là bản mới nhất';
    results.push(result('app.version', 'app', 'Phiên bản app', 'green', `Phiên bản ${app.version}${note}.`));
  }
  return results;
}

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
        ...desktopChecks(ctx),
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
