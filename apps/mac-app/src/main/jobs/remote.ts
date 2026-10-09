import { type HttpDeps, PaperclipHttpError, paperclipRequest } from '../paperclip/client.js';
import { MissingKeyError, type PollTarget } from './poller.js';
import { sanitizeJobError } from './sanitize.js';
import type { JobExtras, JobOutcome, MachineJob, SkillFile } from './types.js';
import { validateJobPayload } from './validate.js';

const JOBS_PATH = '/api/plugins/crew.core/api/machine-jobs';
const SETUP_RUNS_PATH = '/api/plugins/crew.core/api/setup-runs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SKILL_FILES = 500;

export interface RemoteDeps extends HttpDeps {
  /** Board key theo origin (Keychain), đọc lại cho mỗi request; `null` = chưa đăng nhập. */
  readKey: (origin: string) => Promise<string | null>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Phần app nói chuyện với Paperclip của hàng đợi máy (Main, có board key). */
export function createJobsRemote(deps: RemoteDeps) {
  const id = encodeURIComponent;

  async function call<T>(target: PollTarget, method: string, path: string, body?: unknown): Promise<T> {
    const key = await deps.readKey(target.url);
    if (!key) throw new MissingKeyError();
    return paperclipRequest<T>(target.url, deps, { method, path, body, key });
  }

  async function projectIdOf(target: PollTarget, setupRunId: string | null): Promise<string | null> {
    if (!setupRunId || !UUID.test(setupRunId)) return null;
    try {
      const run = await call<{ projectId?: unknown } | undefined>(
        target,
        'GET',
        `${SETUP_RUNS_PATH}/${id(setupRunId)}?companyId=${id(target.companyId)}`,
      );
      return typeof run?.projectId === 'string' && UUID.test(run.projectId) ? run.projectId : null;
    } catch {
      return null;
    }
  }

  async function skillFiles(target: PollTarget, skillId: string, slug: string): Promise<SkillFile[]> {
    const base = `/api/companies/${id(target.companyId)}/skills/${id(skillId)}`;
    const detail = await call<{ slug?: unknown; fileInventory?: unknown } | undefined>(target, 'GET', base);
    if (detail?.slug !== slug) throw new Error(`Skill trên Paperclip không phải ${slug}`);
    const inventory = Array.isArray(detail.fileInventory) ? detail.fileInventory : [];
    if (inventory.length === 0 || inventory.length > MAX_SKILL_FILES) {
      throw new Error('Danh sách file của skill không hợp lệ');
    }
    const files: SkillFile[] = [];
    for (const entry of inventory) {
      if (!isRecord(entry) || typeof entry.path !== 'string')
        throw new Error('Danh sách file của skill không hợp lệ');
      const file = await call<Record<string, unknown> | undefined>(
        target,
        'GET',
        `${base}/files?path=${id(entry.path)}`,
      );
      if (!isRecord(file) || typeof file.content !== 'string') {
        throw new Error(`Không đọc được file ${entry.path} của skill`);
      }
      files.push({
        path: entry.path,
        content: file.content,
        encoding: file.encoding === 'base64' ? 'base64' : 'utf8',
        executable: file.executable === true,
      });
    }
    return files;
  }

  return {
    async claim(target: PollTarget, machineId: string): Promise<MachineJob | null> {
      const job = await call<MachineJob | undefined>(target, 'POST', `${JOBS_PATH}/claim`, {
        companyId: target.companyId,
        machineId,
      });
      return isRecord(job) ? job : null;
    },

    /**
     * Báo kết quả. Lỗi đã làm sạch lần nữa ở đây. `check` thất bại gửi kèm danh sách mục kiểm; plugin không nhận
     * `result` khi `failed` (400) thì gửi lại không có `result`.
     */
    async submit(target: PollTarget, machineId: string, jobId: string, outcome: JobOutcome): Promise<void> {
      const path = `${JOBS_PATH}/${id(jobId)}/result`;
      const base = { companyId: target.companyId, machineId };
      if (outcome.status === 'done') {
        await call(target, 'POST', path, { ...base, status: 'done', result: outcome.result });
        return;
      }
      const body = {
        ...base,
        status: 'failed',
        errorCode: outcome.errorCode,
        errorText: sanitizeJobError(outcome.errorText),
      };
      if (!outcome.result) {
        await call(target, 'POST', path, body);
        return;
      }
      try {
        await call(target, 'POST', path, { ...body, result: outcome.result });
      } catch (error) {
        if (!(error instanceof PaperclipHttpError) || error.status !== 400) throw error;
        await call(target, 'POST', path, body);
      }
    },

    /**
     * Kiểm payload rồi lấy trước những gì cần board key: `projectId` của setup run (để thêm repo vào bản tin docs),
     * file của skill. Trả `outcome` khi việc thất bại ngay ở Main.
     */
    async prepare(
      target: PollTarget,
      job: MachineJob,
    ): Promise<{ extras: JobExtras } | { outcome: JobOutcome }> {
      const payload = validateJobPayload(job.kind, job.payload);
      if (typeof payload === 'string') {
        return {
          outcome: { status: 'failed', errorCode: 'app_error', errorText: `Việc không hợp lệ: ${payload}` },
        };
      }
      if (payload.kind === 'prepare-checkouts') {
        return { extras: { projectId: await projectIdOf(target, job.setupRunId) } };
      }
      if (payload.kind === 'skill-sync') {
        try {
          return {
            extras: { projectId: null, skillFiles: await skillFiles(target, payload.skillId, payload.slug) },
          };
        } catch (error) {
          if (error instanceof MissingKeyError) throw error;
          const message = error instanceof Error ? error.message : String(error);
          return {
            outcome: {
              status: 'failed',
              errorCode: 'skill_fetch_failed',
              errorText: sanitizeJobError(`Không lấy được skill ${payload.slug}: ${message}`),
            },
          };
        }
      }
      return { extras: { projectId: null } };
    },
  };
}
