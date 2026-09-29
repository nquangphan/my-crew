import type { BmadProfile, Project } from '@crew/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch, renderWithApp } from '../test/render';
import { ProjectSettingsPage } from './project-settings';

const PROFILE: BmadProfile = {
  version: '6.12.0',
  lastUpdated: '2026-09-24T15:27:41.562Z',
  modules: ['core', 'bmm', 'tea'],
  tools: ['claude-code', 'codex'],
  communicationLanguage: 'Vietnamese',
  documentOutputLanguage: 'English',
  outputFolder: '_bmad-output',
  settings: [{ module: 'bmm', key: 'project_knowledge', value: '{project-root}/docs' }],
};

function project(bmadProfile: BmadProfile | null): Project {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    key: 'SHOP',
    name: 'Shop API',
    description: 'API bán hàng',
    repoUrl: 'https://github.com/2p/shop-api.git',
    defaultBranch: 'main',
    ownerMachineId: null,
    docsStatus: 'ready',
    platform: 'web',
    uiTestMcp: { maestro: 'maestro', playwright: 'playwright' },
    maxChildrenPerTicket: 8,
    ticketTreeBudgetUsd: null,
    dailyBudgetUsd: null,
    bmadProfile,
    createdAt: '2026-09-28T00:00:00.000Z',
    updatedAt: '2026-09-28T00:00:00.000Z',
  };
}

const setup = (bmadProfile: BmadProfile | null) =>
  mockFetch([
    ['GET /v1/projects', () => ({ body: { items: [project(bmadProfile)] } })],
    ['GET /v1/machines', () => ({ body: { items: [] } })],
  ]);

describe('ProjectSettingsPage: BMAD profile', () => {
  it('shows the reported BMAD profile read-only', async () => {
    setup(PROFILE);
    renderWithApp(<ProjectSettingsPage projectKey="SHOP" />);
    const section = await screen.findByRole('region', { name: 'BMAD' });
    const text = within(section);
    expect(text.getByText(/^6\.12\.0 \(cài lúc/)).toBeInTheDocument();
    expect(text.getByText('core, bmm, tea')).toBeInTheDocument();
    expect(text.getByText('claude-code, codex')).toBeInTheDocument();
    expect(text.getByText('Vietnamese')).toBeInTheDocument();
    expect(text.getByText('English')).toBeInTheDocument();
    expect(text.getByText('_bmad-output')).toBeInTheDocument();
    expect(text.getByText('1 giá trị')).toBeInTheDocument();
    expect(within(section).queryByRole('button')).toBeNull();
  });

  it('says when no machine holding the project reported a BMAD setup', async () => {
    setup(null);
    renderWithApp(<ProjectSettingsPage projectKey="SHOP" />);
    const section = await screen.findByRole('region', { name: 'BMAD' });
    expect(section).toHaveTextContent('Chưa có cấu hình BMAD (máy đang giữ project chưa có BMAD).');
  });
});
