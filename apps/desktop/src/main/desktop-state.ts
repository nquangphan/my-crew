import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** App-only state kept next to the daemon config (`~/.crew/desktop.json`). */
const DesktopState = z.object({
  setupCompletedAt: z.string().nullable().default(null),
  /** "Tạm dừng nhận việc" survives an app or host restart. */
  paused: z.boolean().default(false),
});
export type DesktopState = z.infer<typeof DesktopState>;

export class DesktopStateStore {
  private readonly file: string;

  constructor(home: string) {
    this.file = join(home, 'desktop.json');
  }

  read(): DesktopState {
    if (!existsSync(this.file)) return DesktopState.parse({});
    try {
      return DesktopState.parse(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      return DesktopState.parse({});
    }
  }

  update(patch: Partial<DesktopState>): DesktopState {
    const next = { ...this.read(), ...patch };
    mkdirSync(join(this.file, '..'), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.file);
    return next;
  }
}
