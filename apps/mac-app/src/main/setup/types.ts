/** Kết quả một bước của wizard trước khi gắn `next`. `state` là chi tiết riêng của bước (ví dụ quyền ổ đĩa). */
export interface StepOutcome {
  ok: boolean;
  message: string;
  state?: string;
  /** Chỉ hỏi trạng thái: không đi tiếp, không đổi tiến độ trong `app.json`. */
  stay?: boolean;
}

export type StepRun = (input: unknown) => Promise<StepOutcome>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
