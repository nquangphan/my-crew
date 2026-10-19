import { readFileSync } from 'node:fs';

export const UPDATE_STATES = [
  'idle',
  'downloading',
  'waiting-idle',
  'installing',
  'probation',
  'rolled-back',
] as const;

/** Phần của `app.json` mà bản tin máy gửi lên; crew-mac không import kiểu từ app. */
export interface AppReport {
  version: string;
  sshdOwner: 'app' | 'launchd';
  updateState: (typeof UPDATE_STATES)[number];
}

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Đọc ba trường từ `app.json`; file thiếu, hỏng hay sai dạng thì null (bản tin không có trường `app`). */
export function readAppState(path: string): AppReport | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { appVersion, sshdOwner, updateState } = raw as Record<string, unknown>;
  if (typeof appVersion !== 'string' || appVersion.length > 32 || !SEMVER.test(appVersion)) return null;
  if (sshdOwner !== 'app' && sshdOwner !== 'launchd') return null;
  if (!UPDATE_STATES.includes(updateState as AppReport['updateState'])) return null;
  return { version: appVersion, sshdOwner, updateState: updateState as AppReport['updateState'] };
}

/** App 2P Crew ghi mỗi lần hỏi hàng đợi việc trên máy; thiếu nghĩa là app không nhận việc. */
export interface JobsAgentReport {
  version: string;
  lastPollAt: string;
}

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?(Z|[+-]\d\d:\d\d)$/;

/** Đọc `jobsAgent` của `app.json`, độc lập với ba trường của `readAppState`; thiếu hay sai dạng thì null. */
export function readJobsAgent(path: string): JobsAgentReport | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>).jobsAgent;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { version, lastPollAt } = value as Record<string, unknown>;
  if (typeof version !== 'string' || version.length > 32 || !SEMVER.test(version)) return null;
  if (typeof lastPollAt !== 'string' || !ISO.test(lastPollAt) || !Number.isFinite(Date.parse(lastPollAt)))
    return null;
  return { version, lastPollAt };
}
