/** How the app stops the daemon when the owner quits. */
export type QuitDecision = 'drain' | 'requeue' | 'cancel';

export type AskQuit = (runningJobs: number) => Promise<'wait' | 'stop' | 'cancel'>;

/**
 * Quitting while jobs run asks first: wait for them to finish (no new jobs start meanwhile), stop now and
 * resume them on the next start, or cancel. With no running job the app stops at once.
 */
export async function decideQuit(runningJobs: number, ask: AskQuit): Promise<QuitDecision> {
  if (runningJobs <= 0) return 'requeue';
  const answer = await ask(runningJobs);
  if (answer === 'wait') return 'drain';
  if (answer === 'stop') return 'requeue';
  return 'cancel';
}

export const QUIT_BUTTONS = ['Chờ job xong rồi thoát', 'Dừng ngay, chạy tiếp lần sau', 'Huỷ'] as const;

export function quitMessage(runningJobs: number): { message: string; detail: string } {
  return {
    message: `Có ${runningJobs} job đang chạy trên máy này.`,
    detail:
      'Chờ job xong: máy không nhận job mới và thoát khi các job hiện tại kết thúc. Dừng ngay: các job được dừng an toàn và chạy tiếp (cùng phiên) ở lần mở app sau.',
  };
}
