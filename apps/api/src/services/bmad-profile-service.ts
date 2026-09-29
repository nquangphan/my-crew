import type { BmadProfile, PutBmadProfileResponse } from '@crew/shared';
import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { projects } from '../db/schema.js';
import { ApiError, notFound } from '../errors.js';

/**
 * Stores the BMAD profile the owning machine read from its checkout. Only the machine that owns the project may
 * set it. The newest install wins: a profile older than the stored one (a machine that took the project over
 * with an outdated `_bmad`) is not stored, so it cannot hide the setup the "Cài BMAD" button reproduces.
 */
export async function putBmadProfile(
  db: Executor,
  machineId: string,
  projectKey: string,
  profile: BmadProfile,
): Promise<PutBmadProfileResponse> {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.key, projectKey)).for('update');
    if (!project) throw notFound('project');
    if (project.ownerMachineId !== machineId) {
      throw new ApiError(
        'FORBIDDEN',
        `only the machine that owns project ${projectKey} may set its BMAD profile`,
      );
    }
    const current = project.bmadProfile;
    if (current && Date.parse(current.lastUpdated) > Date.parse(profile.lastUpdated)) {
      return { stored: false, profile: current };
    }
    await tx
      .update(projects)
      .set({ bmadProfile: profile, updatedAt: new Date() })
      .where(eq(projects.id, project.id));
    return { stored: true, profile };
  });
}
