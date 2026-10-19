const JSON_TIMEOUT_MS = 45_000;
const CONTENT_TIMEOUT_MS = 60_000;

export interface AttachmentMeta {
  id: string;
  issueId: string;
  issueCommentId: string | null;
  contentType: string;
  byteSize: number;
  sha256: string;
  originalFilename: string | null;
  createdAt: string;
}

export interface CommentMeta {
  id: string;
  body: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  createdAt: string;
}

export interface BridgeClient {
  issue(id: string): Promise<{
    id: string;
    identifier: string;
    description: string | null;
    parentId: string | null;
    createdAt: string;
  }>;
  heartbeatContext(id: string): Promise<{ ancestors: { id: string; identifier: string }[] }>;
  comments(id: string): Promise<CommentMeta[]>;
  attachments(id: string): Promise<AttachmentMeta[]>;
  /** Trả luồng byte; ném `BridgeError` khi gọi (HTTP lỗi, quá hạn) hoặc khi đọc (vượt `maxBytes`). */
  content(attachmentId: string, maxBytes: number): Promise<AsyncIterable<Uint8Array>>;
}

/** Lỗi chỉ mang mã và trạng thái HTTP; thân phản hồi của server không bao giờ vào message. */
export class BridgeError extends Error {
  readonly code: 'http' | 'timeout' | 'network' | 'too_large';
  readonly status: number | null;
  constructor(code: BridgeError['code'], status: number | null = null) {
    super(`bridge ${code}${status === null ? '' : ` ${status}`}`);
    this.name = 'BridgeError';
    this.code = code;
    this.status = status;
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function malformed(): never {
  throw new BridgeError('network');
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) return malformed();
  return value;
}

export function createBridgeClient(
  env: { PAPERCLIP_API_URL: string; PAPERCLIP_API_KEY: string },
  fetchImpl: typeof fetch = fetch,
): BridgeClient {
  const base = env.PAPERCLIP_API_URL.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${env.PAPERCLIP_API_KEY}` };
  const seg = (id: string) => encodeURIComponent(id);

  /** Gọi bridge với hạn chờ; hết hạn thì hủy bằng AbortController (chạy được dưới đồng hồ giả). */
  async function request(
    path: string,
    timeoutMs: number,
  ): Promise<{ response: Response; done: () => void; aborted: () => boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const done = () => clearTimeout(timer);
    try {
      const response = await fetchImpl(`${base}${path}`, { headers, signal: controller.signal });
      if (!response.ok) {
        done();
        void response.body?.cancel().catch(() => undefined);
        throw new BridgeError('http', response.status);
      }
      return { response, done, aborted: () => controller.signal.aborted };
    } catch (error) {
      done();
      if (error instanceof BridgeError) throw error;
      throw new BridgeError(controller.signal.aborted ? 'timeout' : 'network');
    }
  }

  async function getJson(path: string): Promise<unknown> {
    const { response, done, aborted } = await request(path, JSON_TIMEOUT_MS);
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new BridgeError(aborted() ? 'timeout' : 'network');
    } finally {
      done();
    }
  }

  return {
    async issue(id) {
      const o = record(await getJson(`/api/issues/${seg(id)}`)) ?? malformed();
      return {
        id: str(o.id) || id,
        identifier: str(o.identifier),
        description: strOrNull(o.description),
        parentId: strOrNull(o.parentId),
        createdAt: str(o.createdAt),
      };
    },
    async heartbeatContext(id) {
      const o = record(await getJson(`/api/issues/${seg(id)}/heartbeat-context`)) ?? malformed();
      const ancestors = Array.isArray(o.ancestors) ? o.ancestors : [];
      return {
        ancestors: ancestors.flatMap((entry) => {
          const a = record(entry);
          return a && str(a.id) ? [{ id: str(a.id), identifier: str(a.identifier) }] : [];
        }),
      };
    },
    async comments(id) {
      return array(await getJson(`/api/issues/${seg(id)}/comments?order=asc`)).flatMap((entry) => {
        const c = record(entry);
        return c && str(c.id)
          ? [
              {
                id: str(c.id),
                body: str(c.body),
                authorAgentId: strOrNull(c.authorAgentId),
                authorUserId: strOrNull(c.authorUserId),
                createdAt: str(c.createdAt),
              },
            ]
          : [];
      });
    },
    async attachments(id) {
      return array(await getJson(`/api/issues/${seg(id)}/attachments`)).flatMap((entry) => {
        const a = record(entry);
        return a && str(a.id)
          ? [
              {
                id: str(a.id),
                issueId: str(a.issueId) || id,
                issueCommentId: strOrNull(a.issueCommentId),
                contentType: str(a.contentType),
                byteSize: typeof a.byteSize === 'number' ? a.byteSize : 0,
                sha256: str(a.sha256).toLowerCase(),
                originalFilename: strOrNull(a.originalFilename),
                createdAt: str(a.createdAt),
              },
            ]
          : [];
      });
    },
    async content(attachmentId, maxBytes) {
      const { response, done, aborted } = await request(
        `/api/attachments/${seg(attachmentId)}/content`,
        CONTENT_TIMEOUT_MS,
      );
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        done();
        void response.body?.cancel().catch(() => undefined);
        throw new BridgeError('too_large');
      }
      const body = response.body;
      return (async function* () {
        if (!body) {
          done();
          return;
        }
        const reader = body.getReader();
        let total = 0;
        try {
          for (;;) {
            const { value, done: finished } = await reader.read();
            if (finished) return;
            total += value.byteLength;
            if (total > maxBytes) throw new BridgeError('too_large');
            yield value;
          }
        } catch (error) {
          if (error instanceof BridgeError) throw error;
          throw new BridgeError(aborted() ? 'timeout' : 'network');
        } finally {
          done();
          void reader.cancel().catch(() => undefined);
        }
      })();
    },
  };
}
