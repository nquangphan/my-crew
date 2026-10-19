import { describe, expect, it, vi } from 'vitest';
import type { ProjectProgress } from '../src/main/app-state.js';
import { createProjectsIpc } from '../src/main/projects/ipc.js';
import type { ProjectDeps } from '../src/main/projects/progress.js';

const addProject = vi.hoisted(() => vi.fn());
vi.mock('../src/main/projects/add-project.js', () => ({ addProject }));

const input = {
  key: 'solar',
  name: 'Solar',
  folder: '/Volumes/CORSAIR/Projects/solar',
  executors: 2 as const,
};
const progress = (error: string | null): ProjectProgress => ({
  key: 'solar',
  folder: input.folder,
  projectId: 'p1',
  done: [],
  agents: {},
  error,
});

function ipcWith(onAdded = vi.fn()) {
  return { ipc: createProjectsIpc({ deps: () => ({}) as ProjectDeps, onAdded }), onAdded };
}

describe('projects:add báo bản tin máy', () => {
  it('thêm xong không lỗi thì nhờ gửi bản tin đúng một lần', async () => {
    addProject.mockResolvedValueOnce(progress(null));
    const { ipc, onAdded } = ipcWith();
    await expect(ipc.add(input)).resolves.toMatchObject({ key: 'solar', error: null });
    expect(onAdded).toHaveBeenCalledExactlyOnceWith('solar');
  });

  it('thêm dở (có progress.error) thì không nhờ gửi', async () => {
    addProject.mockResolvedValueOnce(progress('Paperclip trả 500'));
    const { ipc, onAdded } = ipcWith();
    await ipc.add(input);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('thêm ném lỗi thì không nhờ gửi và lỗi vẫn tới người gọi', async () => {
    addProject.mockRejectedValueOnce(new Error('Chưa chọn folder project'));
    const { ipc, onAdded } = ipcWith();
    await expect(ipc.add(input)).rejects.toThrow('Chưa chọn folder project');
    expect(onAdded).not.toHaveBeenCalled();
  });
});
