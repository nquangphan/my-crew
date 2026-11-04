import { join } from 'node:path';

/**
 * Đường dẫn cầu nối file giữa 2P Crew và app Bug Finding (bundle `local.mrreviewqueue`). Khớp `CrewBridgePaths` của
 * repo `bug-finding` (`apps/mr-review-queue/Sources/MRQueueCore/CrewBridge.swift`): thư mục dữ liệu của app, thư mục
 * con `crew/` chứa danh sách project, yêu cầu review, phản hồi và heartbeat.
 */
export interface BugFindingPaths {
  dataDir: string;
  bridgeDir: string;
  projectsFile: string;
  requestsDir: string;
  responsesDir: string;
  heartbeatFile: string;
}

export function bugFindingPaths(home: string): BugFindingPaths {
  const dataDir = join(home, 'Library', 'Application Support', 'MRReviewQueue');
  const bridgeDir = join(dataDir, 'crew');
  return {
    dataDir,
    bridgeDir,
    projectsFile: join(bridgeDir, 'projects.json'),
    requestsDir: join(bridgeDir, 'requests'),
    responsesDir: join(bridgeDir, 'responses'),
    heartbeatFile: join(bridgeDir, 'heartbeat.json'),
  };
}

export const BUG_FINDING_APP_NAME = 'Bug Finding.app';

/** Bản cài riêng cũ (cài tay trước khi Bug Finding đi kèm 2P Crew). Cùng bundle id với bản nhúng. */
export const STANDALONE_APP_PATH = join('/Applications', BUG_FINDING_APP_NAME);

/** Đuôi dòng lệnh của tiến trình Bug Finding, dùng cho `pgrep -fl`. */
export const BUG_FINDING_PROCESS_SUFFIX = '/Contents/MacOS/MRReviewQueue';

/** Bản nhúng: `2P Crew.app/Contents/Resources/Bug Finding.app` (`extraResources` của `electron-builder.yml`). */
export function embeddedAppPath(resourcesPath: string): string {
  return join(resourcesPath, BUG_FINDING_APP_NAME);
}

/**
 * Đường dẫn app Bug Finding mà 2P Crew dùng. Bản đóng gói: app nhúng. Bản dev (`!app.isPackaged`): biến
 * `CREW_BUG_FINDING_APP`, không có thì `null` (coi như chưa cài).
 */
export function resolveAppPath(input: {
  isPackaged: boolean;
  resourcesPath: string;
  env: Record<string, string | undefined>;
}): string | null {
  if (input.isPackaged) return embeddedAppPath(input.resourcesPath);
  const dev = input.env.CREW_BUG_FINDING_APP?.trim();
  return dev ? dev : null;
}
