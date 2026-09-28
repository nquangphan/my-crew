import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SYSTEMD_UNIT_NAME = 'crewd.service';

export interface UnitOptions {
  /** Absolute Node runtime. */
  nodePath: string;
  /** Absolute path of the `crewd` CLI script. */
  cliPath: string;
  /** Crew home (`~/.crew`). */
  crewHome: string;
}

const quote = (value: string) =>
  /^[A-Za-z0-9_./:@%+=-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`;

/**
 * A systemd **user** unit: it runs in the owner's session and reads `~/.claude`, and it never passes an
 * API key to the daemon (billing stays on the subscription login).
 */
export function systemdUnit(options: UnitOptions): string {
  return [
    '[Unit]',
    'Description=2P Crew daemon (crewd)',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${quote(options.nodePath)} ${quote(options.cliPath)} start`,
    `Environment=CREW_HOME=${quote(options.crewHome)}`,
    'UnsetEnvironment=ANTHROPIC_API_KEY',
    'Restart=on-failure',
    'RestartSec=10',
    // Agents start dev servers and watchers; stopping the unit must not leave them behind.
    'KillMode=control-group',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

export interface InstallServiceOptions extends UnitOptions {
  /** `~/.config/systemd/user` by default. */
  unitDir?: string;
  /** Runs `systemctl --user <args>`; injectable for tests. */
  systemctl: (args: string[]) => { code: number; stderr: string };
}

export function installService(options: InstallServiceOptions): string {
  const unitDir = options.unitDir ?? join(homedir(), '.config', 'systemd', 'user');
  mkdirSync(unitDir, { recursive: true });
  const unitPath = join(unitDir, SYSTEMD_UNIT_NAME);
  writeFileSync(unitPath, systemdUnit(options), { mode: 0o644 });
  for (const args of [['daemon-reload'], ['enable', '--now', SYSTEMD_UNIT_NAME]]) {
    const run = options.systemctl(args);
    if (run.code !== 0) throw new Error(`systemctl --user ${args.join(' ')} failed: ${run.stderr.trim()}`);
  }
  return unitPath;
}
