import { MissingKeyError, type PollTarget, type SkippedTarget } from './poller.js';

/** Đích bản tin của crew-mac: URL gửi bản tin (có thể là địa chỉ Tailscale) và company. */
export interface StatusTarget {
  url: string;
  companyId: string;
}

export interface TargetResolverDeps {
  statusTargets(): Promise<{ machineId: string | null; targets: StatusTarget[] }>;
  /** Origin board đã đăng nhập (`setup.paperclipOrigin`); `null` = chưa đăng nhập. */
  origin(): string | null;
  /** Company board key của origin thấy được. Ném `MissingKeyError` khi chưa có key, `PaperclipAuthError` khi 401. */
  companies(origin: string): Promise<Array<{ id: string; name: string }>>;
  now?: () => number;
  ttlMs?: number;
}

export const COMPANIES_TTL_MS = 60_000;

/**
 * Chọn nơi app hỏi hàng đợi việc. Đích bản tin chỉ cho biết company nào có máy này; API hàng đợi luôn gọi ở origin
 * board đã đăng nhập bằng key của origin đó (key lưu theo origin, còn URL đích bản tin có thể là địa chỉ khác của cùng
 * server, vd. Tailscale). Company tài khoản không thấy được thì bỏ qua kèm lý do, không hỏi để khỏi nhận 403 mãi.
 */
export function createTargetResolver(deps: TargetResolverDeps) {
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? COMPANIES_TTL_MS;
  let cache: { origin: string; at: number; list: Array<{ id: string; name: string }> } | null = null;

  async function companiesOf(origin: string) {
    if (cache && cache.origin === origin && now() - cache.at < ttl) return cache.list;
    const list = await deps.companies(origin);
    cache = { origin, at: now(), list };
    return list;
  }

  return {
    async resolve(): Promise<{ machineId: string | null; targets: PollTarget[]; skipped: SkippedTarget[] }> {
      const { machineId, targets: statusTargets } = await deps.statusTargets();
      const ids = [...new Set(statusTargets.map((target) => target.companyId.toLowerCase()))];
      if (ids.length === 0) return { machineId, targets: [], skipped: [] };
      const origin = deps.origin();
      if (!origin) throw new MissingKeyError();
      const visible = new Map((await companiesOf(origin)).map((c) => [c.id.toLowerCase(), c]));
      const targets: PollTarget[] = [];
      const skipped: SkippedTarget[] = [];
      for (const id of ids) {
        const company = visible.get(id);
        if (company) targets.push({ url: origin, companyId: company.id, name: company.name });
        else
          skipped.push({
            companyId: id,
            reason: `Tài khoản đã đăng nhập ở ${origin} không có quyền với company này (hoặc company không ở server đó): không nhận việc của company này.`,
          });
      }
      return { machineId, targets, skipped };
    },
    /** Đọc lại danh sách company ở lần sau (sau khi đăng nhập lại hoặc gặp 403). */
    invalidate() {
      cache = null;
    },
  };
}
