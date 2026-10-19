import { type HttpDeps, normalizeOrigin, paperclipRequest } from './client.js';

export type LoginStatus = 'pending' | 'approved' | 'expired' | 'cancelled';

export interface LoginDeps extends HttpDeps {
  /** Lưu board key vào Keychain (gọi đúng một lần khi owner duyệt). */
  saveKey: (origin: string, key: string) => Promise<void>;
  /** Sau khi đã lưu key: ghi origin vào trạng thái app. */
  onApproved?: (origin: string) => Promise<void> | void;
  hostname: string;
}

interface Pending {
  origin: string;
  id: string;
  token: string;
  boardApiToken: string;
}

interface ChallengeAnswer {
  id: string;
  token: string;
  boardApiToken: string;
  approvalPath: string;
  approvalUrl: string | null;
}

/**
 * Đăng nhập Paperclip bằng luồng `cli-auth` stock: tạo thử thách, owner duyệt trên web, poll tới khi duyệt.
 * Board key chờ duyệt và token thử thách chỉ nằm trong bộ nhớ Main tới khi xong; duyệt xong thì lưu vào Keychain
 * và quên ngay.
 */
export function createLoginFlow(deps: LoginDeps) {
  let pending: Pending | null = null;
  let last: LoginStatus = 'expired';

  return {
    async start(originInput: string, companyId?: string): Promise<{ approvalUrl: string }> {
      const origin = normalizeOrigin(originInput);
      pending = null;
      const answer = await paperclipRequest<ChallengeAnswer>(origin, deps, {
        method: 'POST',
        path: '/api/cli-auth/challenges',
        body: {
          command: '2P Crew app',
          clientName: `2P Crew trên ${deps.hostname}`.slice(0, 120),
          requestedAccess: 'board',
          ...(companyId ? { requestedCompanyId: companyId } : {}),
        },
      });
      if (!answer?.id || !answer.token || !answer.boardApiToken || typeof answer.approvalPath !== 'string') {
        throw new Error('Paperclip trả thử thách đăng nhập thiếu trường');
      }
      pending = { origin, id: answer.id, token: answer.token, boardApiToken: answer.boardApiToken };
      last = 'pending';
      deps.log?.('paperclip-login-started', { origin });
      return { approvalUrl: approvalUrlFor(origin, answer) };
    },

    async poll(): Promise<LoginStatus> {
      const current = pending;
      if (!current) return last;
      const answer = await paperclipRequest<{ status?: string } | null>(current.origin, deps, {
        method: 'GET',
        path: `/api/cli-auth/challenges/${encodeURIComponent(current.id)}?token=${encodeURIComponent(current.token)}`,
        notFoundNull: true,
      });
      // Lần poll khác đã kết thúc thử thách trong lúc chờ.
      if (pending !== current) return last;
      const status = answer?.status;
      if (status === 'pending') return 'pending';
      pending = null;
      if (status === 'approved') {
        try {
          await deps.saveKey(current.origin, current.boardApiToken);
        } catch (error) {
          // Không lưu được thì key đã duyệt bị bỏ; owner đăng nhập lại.
          last = 'expired';
          throw error;
        }
        last = 'approved';
        deps.log?.('paperclip-login-approved', { origin: current.origin });
        await deps.onApproved?.(current.origin);
        return last;
      }
      last = status === 'cancelled' ? 'cancelled' : 'expired';
      deps.log?.('paperclip-login-ended', { origin: current.origin, status: last });
      return last;
    },
  };
}

export type LoginFlow = ReturnType<typeof createLoginFlow>;

/** Mở đúng server owner đã nhập: `approvalUrl` của server chỉ dùng khi cùng origin. */
function approvalUrlFor(origin: string, answer: ChallengeAnswer): string {
  if (answer.approvalUrl) {
    try {
      if (new URL(answer.approvalUrl).origin === origin) return answer.approvalUrl;
    } catch {
      // rơi xuống dựng từ approvalPath
    }
  }
  return new URL(answer.approvalPath, origin).toString();
}
