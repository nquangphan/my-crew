/** Kiểm số run mỗi 10 giây trong lúc chờ máy rảnh. */
export const DRAIN_POLL_MS = 10_000;
/** Chờ tối đa 30 phút rồi hỏi owner. */
export const DRAIN_MAX_MS = 30 * 60_000;
/** Gửi quit cho Bug Finding xong, chờ app thoát tối đa 30 giây. */
export const BUG_FINDING_QUIT_MS = 30_000;
/** Kiểm Bug Finding đã thoát chưa mỗi 1 giây. */
const BUG_FINDING_QUIT_POLL_MS = 1_000;
/** Lý do chờ hiện ở màn hình Cập nhật khi Bug Finding còn lượt review đang chạy. */
export const BUG_FINDING_WAIT_REASON = 'Chờ Bug Finding review xong';
/** Lý do chờ khi Bug Finding rảnh nhưng không thoát sau 30 giây. */
export const BUG_FINDING_QUIT_REASON = 'Chờ Bug Finding thoát';

export type DrainAnswer = 'now' | 'later';

/**
 * App Bug Finding nhúng trong `2P Crew.app/Contents/Resources`: cài bản mới thay cả nó, nên phải chờ nó hết lượt review
 * và thoát nó trước.
 */
export interface BugFindingDrain {
  /** `running` của `heartbeat.json` (0 khi app không chạy). Ném = không biết, coi như đang review. */
  runningReviews(): Promise<number>;
  /** Bản nhúng đang chạy (theo tiến trình, không theo heartbeat). Ném = không biết, coi như chưa thoát. */
  isRunning(): Promise<boolean>;
  /** `osascript -e 'quit app id "local.mrreviewqueue"'`; có thể không trả về cho tới khi app thoát. */
  quit(): Promise<void>;
  /** Cờ `reopenBugFinding` trong `app.json`: bản mới mở lại Bug Finding khi khởi động. */
  setReopen(on: boolean): Promise<void>;
  /**
   * Đóng cổng mở Bug Finding (việc `bug-finding-review`, nút Mở) và chờ các lần mở đang chạy xong: từ lúc drain bắt đầu
   * tới khi cài hay hủy, không gì mở lại Bug Finding.
   */
  hold(): Promise<void>;
  /** Mở lại cổng (drain trả `'later'`, cài bị hủy). */
  release(): void;
}

export interface DrainDeps {
  /** `supervisor.pause()`: TERM listener của app, phiên SSH đang chạy vẫn sống; run mới chờ `queued` trên Paperclip. */
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Số run `claude -p` đang chạy. Ném khi không đọc được bảng process. */
  activeRuns(): Promise<number>;
  /** Hỏi owner "Cài ngay, run vẫn chạy" / "Để sau"; `null` = không đọc được số run. */
  ask(activeRuns: number | null): Promise<DrainAnswer>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Không có (bản cũ, test): bỏ qua điều kiện Bug Finding. */
  bugFinding?: BugFindingDrain;
  /** Mỗi lượt kiểm: lý do đang chờ vì Bug Finding, `null` khi Bug Finding không giữ việc cài. */
  onWait?(reason: string | null): void;
}

/**
 * Thoát Bug Finding trước khi cài: không chạy thì thôi; đang chạy thì đặt cờ mở lại, gửi quit (`onSent`) và chờ tối đa
 * 30 giây. Không thoát kịp thì `false` (không cài lúc này: thay bundle của app đang chạy); cờ mở lại giữ nguyên vì app
 * đã nhận quit và có thể thoát ngay sau đó. Lỗi (`ps`, ghi `app.json`) lan ra cho người gọi.
 */
async function quitBugFinding(
  bf: BugFindingDrain,
  deps: Pick<DrainDeps, 'sleep' | 'now'>,
  onSent: () => void,
): Promise<boolean> {
  if (!(await bf.isRunning())) return true;
  await bf.setReopen(true);
  onSent();
  // Không chờ `osascript`: AppleScript đợi app trả lời, có thể lâu hơn hạn 30 giây.
  void bf.quit().catch(() => undefined);
  const deadline = deps.now() + BUG_FINDING_QUIT_MS;
  while (deps.now() < deadline) {
    await deps.sleep(BUG_FINDING_QUIT_POLL_MS);
    if (!(await bf.isRunning())) return true;
  }
  return false;
}

/**
 * `runningReviews` của `BugFindingDrain` từ heartbeat: `read` trả `running` của heartbeat mới, `null` khi không có hay
 * cũ (ném khi hỏng). Không có heartbeat mới mà bản nhúng vẫn chạy (vừa mở, bận, treo) thì chưa rõ: ném.
 */
export async function reviewsFromHeartbeat(
  read: () => number | null,
  isRunning: () => Promise<boolean>,
): Promise<number> {
  const running = read();
  if (running !== null) return running;
  if (await isRunning()) throw new Error('Bug Finding đang chạy mà heartbeat không mới');
  return 0;
}

async function bugFindingReviews(bf: BugFindingDrain | undefined): Promise<number | null> {
  if (!bf) return 0;
  try {
    return await bf.runningReviews();
  } catch {
    return null;
  }
}

/**
 * Chờ máy rảnh trước khi cài: dừng listener (không nhận run mới) và đóng cổng mở Bug Finding (không nhận lượt review
 * mới), đếm run mỗi 10 giây. Hết run và Bug Finding không còn lượt review (`running == 0` trong heartbeat) thì thoát
 * Bug Finding rồi `'install'` (cổng vẫn đóng, updater mở lại nếu cài hỏng); Bug Finding còn review hay chưa rõ thì báo
 * "Chờ Bug Finding review xong" và chờ tiếp. Không bao giờ gửi tín hiệu cho phiên SSH hay `claude`. Quá 30 phút: mở lại
 * listener; Bug Finding vẫn đang review (hay không thoát) thì `'later'` không hỏi (cài lúc đó sẽ thay binary Bug Finding
 * giữa lượt review), ngược lại hỏi owner (hộp thoại có thể chờ rất lâu, máy không được đứng im trong lúc đó): "Cài
 * ngay" thì thoát Bug Finding rồi `'install'`, "Để sau" thì `'later'`. Mọi đường `'later'` và mọi lỗi đều mở lại
 * listener và cổng.
 */
export async function drainForUpdate(deps: DrainDeps): Promise<'install' | 'later'> {
  const bf = deps.bugFinding;
  let resumed = false;
  let quitSent = false;
  const resume = async () => {
    if (resumed) return;
    resumed = true;
    await deps.resume();
  };
  /** Thoát Bug Finding; lỗi giữa chừng = chưa thoát được, chờ tiếp. */
  const quit = async (): Promise<boolean> => {
    if (!bf) return true;
    try {
      return await quitBugFinding(bf, deps, () => {
        quitSent = true;
      });
    } catch {
      return false;
    }
  };
  const later = async (): Promise<'later'> => {
    try {
      await resume();
    } finally {
      if (bf) {
        bf.release();
        if (quitSent) await bf.setReopen(false).catch(() => undefined);
      }
    }
    return 'later';
  };

  await deps.pause();
  try {
    await bf?.hold();
    const deadline = deps.now() + DRAIN_MAX_MS;
    let runs: number | null = null;
    let bugFindingBlocked = false;
    for (;;) {
      try {
        runs = await deps.activeRuns();
      } catch {
        runs = null;
      }
      const reviews = await bugFindingReviews(bf);
      bugFindingBlocked = reviews !== 0;
      deps.onWait?.(bugFindingBlocked ? BUG_FINDING_WAIT_REASON : null);
      if (runs === 0 && !bugFindingBlocked) {
        if (await quit()) return 'install';
        bugFindingBlocked = true;
        deps.onWait?.(BUG_FINDING_QUIT_REASON);
      }
      if (deps.now() >= deadline) break;
      await deps.sleep(DRAIN_POLL_MS);
    }
    await resume();
    if (bugFindingBlocked) return await later();
    if ((await deps.ask(runs)) !== 'now') return await later();
    if ((await bugFindingReviews(bf)) !== 0) return await later();
    if (!(await quit())) return await later();
    return 'install';
  } catch (error) {
    await later().catch(() => undefined);
    throw error;
  }
}

export interface ReopenDeps {
  /** Cờ `reopenBugFinding` của `app.json`. */
  pending(): boolean;
  clear(): Promise<void>;
  /** `launchBugFinding(..., opts)`. */
  launch(opts: { background: boolean }): Promise<{ ok: boolean }>;
}

/**
 * Bản mới vừa khởi động: trước khi cài Bug Finding đang mở thì mở lại nó chạy nền (`open -g`) rồi xóa cờ. Mở lỗi vẫn
 * xóa cờ (không thử lại ở mọi lần khởi động); job review sau tự mở Bug Finding khi cần. Bản cài riêng đang chạy
 * (`standalone_running`) hay thiếu app nhúng cũng là `'failed'`.
 */
export async function reopenBugFindingAfterUpdate(deps: ReopenDeps): Promise<'none' | 'reopened' | 'failed'> {
  if (!deps.pending()) return 'none';
  try {
    return (await deps.launch({ background: true })).ok ? 'reopened' : 'failed';
  } catch {
    return 'failed';
  } finally {
    await deps.clear();
  }
}
